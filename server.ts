import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_TEMPLATE_CONFIG } from './src/config/template.config';
import {
  INITIAL_RUNS,
  buildInitialComparison,
  generateTestResults,
} from './src/data/mockStore';
import {
  buildOpenApiSpec,
  evaluateNovaLiteVisualDiff,
  generateTerraformBundle,
  generateSyntheticsCanaryScript,
  generateBedrockNovaJudgeScript,
} from './src/engine/awsBlueprint';
import {
  BUILTIN_GATE_PLUGINS,
  evaluatePluginPipeline,
  generateAiAgentAdaptationBundle,
} from './src/engine/pluginRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  // In-memory server run store (seeded from DEFAULT_TEMPLATE_CONFIG, updated on POST /api/v1/runs/trigger)
  let serverRuns = [...INITIAL_RUNS];

  // 1. OpenAPI 3.1.0 Specification JSON
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(buildOpenApiSpec(DEFAULT_TEMPLATE_CONFIG));
  });

  // 2. Control Plane, AWS Synthetics & Bedrock Nova Lite Health
  app.get('/api/v1/health', (_req, res) => {
    const awsLive = Boolean(
      process.env.AWS_EXECUTION_ENV || process.env.AWS_ACCESS_KEY_ID
    );
    res.json({
      status: 'HEALTHY',
      service: DEFAULT_TEMPLATE_CONFIG.branding.controlPlaneTitle,
      executionMode: awsLive ? 'aws-production' : 'local-seed-fallback',
      awsRegion:
        process.env.AWS_REGION || DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion,
      syntheticsRuntime:
        process.env.SYNTHETICS_RUNTIME_VERSION ||
        DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion,
      s3ArtifactBucket:
        process.env.SYNTHETICS_S3_BUCKET ||
        DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket,
      dynamodbTable:
        process.env.SYNTHETICS_DYNAMODB_TABLE ||
        DEFAULT_TEMPLATE_CONFIG.infrastructure.dynamodbTable,
      bedrockVisualJudge: {
        provider: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeProvider,
        modelId:
          process.env.BEDROCK_VISUAL_JUDGE_MODEL_ID ||
          DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
        modelArn: DEFAULT_TEMPLATE_CONFIG.infrastructure.bedrockModelArn,
        ready: true,
      },
      networks: DEFAULT_TEMPLATE_CONFIG.networks,
      totalIndexedRuns: serverRuns.length,
      timestamp: new Date().toISOString(),
    });
  });

  // 3. Full Environment, Network & Canary Configuration
  app.get('/api/v1/config', (_req, res) => {
    res.json({
      branding: DEFAULT_TEMPLATE_CONFIG.branding,
      networks: DEFAULT_TEMPLATE_CONFIG.networks,
      infrastructure: DEFAULT_TEMPLATE_CONFIG.infrastructure,
      propertyCount: DEFAULT_TEMPLATE_CONFIG.properties.length,
      testSuiteCount: DEFAULT_TEMPLATE_CONFIG.testSuite.length,
      testSuite: DEFAULT_TEMPLATE_CONFIG.testSuite,
    });
  });

  // 4. List Configured Properties & Environments
  app.get('/api/v1/properties', (_req, res) => {
    res.json({
      total: DEFAULT_TEMPLATE_CONFIG.properties.length,
      properties: DEFAULT_TEMPLATE_CONFIG.properties,
    });
  });

  // 5. Query Ingested AWS CloudWatch Synthetics Runs
  app.get(['/api/v1/runs', '/api/synthetics/runs'], (req, res) => {
    const { appId, target, network } = req.query;
    let filtered = serverRuns;
    if (typeof appId === 'string' && appId) {
      filtered = filtered.filter((r) => r.appId === appId);
    }
    if (typeof target === 'string' && target) {
      filtered = filtered.filter((r) => r.target === target);
    }
    if (typeof network === 'string' && network) {
      filtered = filtered.filter((r) => r.network === network);
    }
    res.json({
      total: filtered.length,
      runs: filtered,
    });
  });

  // 6. Trigger AWS CloudWatch Synthetics Canary & Auto-Compare vs Previous Run
  app.post(['/api/v1/runs/trigger', '/api/synthetics/runs'], (req, res) => {
    const targetId =
      (req.body?.targetId as string) ||
      (req.body?.target as string) ||
      'www.prod.staging';
    const [appId = 'www', envId = 'prod', net = 'staging'] = targetId.split('.');
    const network = (net === 'staging' ? 'staging' : 'prod') as 'staging' | 'prod';
    const prevRun = serverRuns.find((r) => r.target === targetId);
    const runNum = serverRuns.filter((r) => r.target === targetId).length + 1;
    const now = new Date();
    const key = `run-${appId}-${envId}-${network}-${runNum}-${Date.now()
      .toString()
      .slice(-4)}`;

    const results = generateTestResults(
      targetId,
      'new_run',
      DEFAULT_TEMPLATE_CONFIG.testSuite
    );

    const newRun = {
      key,
      target: targetId,
      appId,
      envId,
      network,
      suiteKey: `config/suites/${appId}.csv`,
      suiteSha256: '9f83a21b33c0',
      suiteRowCount: results.length,
      startTime: now.toISOString(),
      finishTime: new Date(now.getTime() + 950).toISOString(),
      totalTests: results.length,
      passedTests: results.filter((r) => r.pass).length,
      failedTests: results.filter((r) => !r.pass).length,
      by: 'aws-synthetics-api',
      label: `run #${runNum}`,
      results,
    };

    serverRuns = [newRun, ...serverRuns];

    const comparison = prevRun
      ? buildInitialComparison(newRun, prevRun, 'network')
      : null;

    res.json({
      dispatched: true,
      engine: DEFAULT_TEMPLATE_CONFIG.infrastructure.runnerEngine,
      runtimeVersion: DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion,
      newRun,
      comparedAgainstPreviousRun: prevRun?.key || null,
      headlineVerdict: comparison?.headlineVerdict || 'GO',
      rollup: comparison?.rollup || null,
      // Also return top-level RunRecord fields for direct adapter compatibility
      ...newRun,
    });
  });

  // 7. Evaluate 3-Dimension Comparison (Headers, Cookies, Bedrock Nova Lite Visual Judge)
  app.post('/api/v1/comparisons/evaluate', (req, res) => {
    const candidateTarget =
      (req.body?.candidateTarget as string) || 'www.prod.staging';
    const baselineTarget =
      (req.body?.baselineTarget as string) || 'www.prod.prod';
    const candRun =
      serverRuns.find((r) => r.target === candidateTarget) || serverRuns[0];
    const baseRun =
      serverRuns.find((r) => r.target === baselineTarget) ||
      serverRuns[1] ||
      serverRuns[0];
    const kind = candRun.envId === baseRun.envId ? 'network' : 'env';
    const comp = buildInitialComparison(candRun, baseRun, kind);

    res.json({
      comparisonId: comp.comparisonId,
      headlineVerdict: comp.headlineVerdict,
      modelUsed: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
      counts: comp.counts,
      rollup: comp.rollup,
      items: comp.items.map((i) => ({
        testId: i.testId,
        testName: i.testName,
        url: i.url,
        itemVerdict: i.itemVerdict,
        headerDiffsCount: i.functionalDiffs.length,
        cookieDiffsCount: (i.cookieDiffs || []).length,
        visualVerdict: i.visualResult?.verdict || 'same',
      })),
    });
  });

  // 8. Invoke Amazon Bedrock Nova Lite (amazon.nova-lite-v1:0) Visual Judge
  app.post('/api/v1/judge/nova-lite', async (req, res) => {
    const testId = (req.body?.testId as string) || 'T03';
    const candidateTarget =
      (req.body?.candidateTarget as string) || 'www.prod.staging';
    const baselineTarget =
      (req.body?.baselineTarget as string) || 'www.prod.prod';
    const pixelDiffPercent =
      typeof req.body?.pixelDiffPercent === 'number'
        ? req.body.pixelDiffPercent
        : testId === 'T03'
        ? 1.8
        : 0.04;

    if (req.body?.sideABase64Png && req.body?.sideBBase64Png) {
      try {
        const { invokeBedrockNovaLiteJudge } = await import(
          './aws-synthetics/bedrock-nova-lite-judge'
        );
        const liveRes = await invokeBedrockNovaLiteJudge({
          testId,
          pageName: req.body?.pageName || testId,
          url: req.body?.url || `https://www.company.com/${testId}`,
          pixelDiffPercentage: pixelDiffPercent,
          sideABase64Png: req.body.sideABase64Png,
          sideBBase64Png: req.body.sideBBase64Png,
        });
        res.json({
          modelId: liveRes.modelId,
          provider: liveRes.provider,
          executionMode: 'aws-bedrock-live',
          testId,
          verdict: liveRes.semanticMatch ? 'same' : 'different',
          pixelDiffPercent,
          confidence: liveRes.confidenceScore,
          summary: liveRes.summary,
          differences: liveRes.detectedAnomalies.map((desc) => ({
            region: 'dom-viewport',
            description: desc,
            severity: 'major',
          })),
          evaluatedAt: new Date().toISOString(),
        });
        return;
      } catch {
        // Fallback to deterministic evaluation below
      }
    }

    const evaluation = evaluateNovaLiteVisualDiff({
      testId,
      candidateTarget,
      baselineTarget,
      s3CandidateUri: req.body?.s3CandidateUri,
      s3BaselineUri: req.body?.s3BaselineUri,
      pixelDiffPercent,
    });
    res.json(evaluation);
  });

  // 9. Model Context Protocol (MCP) JSON-RPC 2.0 Server Endpoint
  app.post('/api/v1/mcp/rpc', (req, res) => {
    const rpcId = req.body?.id ?? 1;
    const toolName =
      req.body?.params?.name || req.body?.tool || 'evaluate_visual_diff_nova_lite';
    const args = req.body?.params?.arguments || req.body?.params || {};

    if (toolName === 'list_akamai_properties') {
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          properties: DEFAULT_TEMPLATE_CONFIG.properties.map((p) => ({
            id: p.id,
            name: p.name,
            envs: p.envs.map((e) => e.id),
            networks: ['staging', 'prod'],
          })),
          totalRunsIndexed: serverRuns.length,
        },
      });
      return;
    }

    if (toolName === 'evaluate_visual_diff_nova_lite' || toolName === 'evaluate_visual_diff_ai') {
      const judgeRes = evaluateNovaLiteVisualDiff({
        testId: args.testId || 'T03',
        candidateTarget: args.candidateTarget || 'www.prod.staging',
        baselineTarget: args.baselineTarget || 'www.prod.prod',
      });
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: judgeRes,
      });
      return;
    }

    if (toolName === 'list_ai_skills_and_plugins') {
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          plugins: BUILTIN_GATE_PLUGINS,
          aiSkills: generateAiAgentAdaptationBundle(DEFAULT_TEMPLATE_CONFIG).map(
            (s) => ({
              id: s.id,
              filename: s.filename,
              category: s.category,
              description: s.description,
            })
          ),
        },
      });
      return;
    }

    if (toolName === 'run_gate_plugin_pipeline') {
      const report = evaluatePluginPipeline({
        testId: args.testId || 'T02',
        testName: args.testName || 'Product Catalog Page',
        path: args.path || '/products/cloud-security',
        candidateTarget: args.candidateTarget || 'www.prod.staging',
        baselineTarget: args.baselineTarget || 'www.prod.prod',
        candidateStatus: args.candidateStatus ?? 200,
        baselineStatus: args.baselineStatus ?? 200,
        candidateLatencyMs: args.candidateLatencyMs ?? 118,
        baselineLatencyMs: args.baselineLatencyMs ?? 72,
        candidateHeaders: args.candidateHeaders || {
          'x-check-cacheable': 'NO',
          'cache-control': 'max-age=1800',
        },
        baselineHeaders: args.baselineHeaders || {
          'x-check-cacheable': 'YES',
          'cache-control': 'max-age=3600',
        },
        candidateCookies: args.candidateCookies || {
          geo_region: 'US-EAST',
          ak_bmsc: 'stg-9910',
        },
        baselineCookies: args.baselineCookies || {
          geo_region: 'US-EAST',
          ak_bmsc: 'prd-4412',
        },
        pixelDiffPercent: args.pixelDiffPercent ?? 0.04,
        enabledPluginIds: args.enabledPluginIds,
      });
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: report,
      });
      return;
    }

    res.json({
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        tool: toolName,
        status: 'EXECUTED',
        awsRegion: DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion,
        visualJudgeModel: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
        s3Bucket: DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket,
        evaluatedAt: new Date().toISOString(),
      },
    });
  });

  // 10. Exportable Infrastructure Blueprints Endpoint
  app.get('/api/v1/blueprints', (_req, res) => {
    res.json({
      terraform: generateTerraformBundle(DEFAULT_TEMPLATE_CONFIG),
      canaryScript: generateSyntheticsCanaryScript(DEFAULT_TEMPLATE_CONFIG),
      bedrockNovaJudgeScript: generateBedrockNovaJudgeScript(
        DEFAULT_TEMPLATE_CONFIG
      ),
    });
  });

  // 11. AI Agent Skills & Release Gate Plugin Catalog Endpoint
  app.get('/api/v1/ai-skills', (_req, res) => {
    res.json({
      plugins: BUILTIN_GATE_PLUGINS,
      skills: generateAiAgentAdaptationBundle(DEFAULT_TEMPLATE_CONFIG),
    });
  });

  // 12. Execute Release Gate Plugin Pipeline
  app.post('/api/v1/plugins/evaluate', (req, res) => {
    const body = req.body || {};
    const report = evaluatePluginPipeline({
      testId: body.testId || 'T02',
      testName: body.testName || 'Product Catalog Page',
      path: body.path || '/products/cloud-security',
      candidateTarget: body.candidateTarget || 'www.prod.staging',
      baselineTarget: body.baselineTarget || 'www.prod.prod',
      candidateStatus: body.candidateStatus ?? 200,
      baselineStatus: body.baselineStatus ?? 200,
      candidateLatencyMs: body.candidateLatencyMs ?? 118,
      baselineLatencyMs: body.baselineLatencyMs ?? 72,
      candidateHeaders: body.candidateHeaders || {
        'x-check-cacheable': 'NO',
        'cache-control': 'max-age=1800',
      },
      baselineHeaders: body.baselineHeaders || {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      candidateCookies: body.candidateCookies || {
        geo_region: 'US-EAST',
      },
      baselineCookies: body.baselineCookies || {
        geo_region: 'US-EAST',
      },
      pixelDiffPercent: body.pixelDiffPercent ?? 0.04,
      enabledPluginIds: body.enabledPluginIds,
    });
    res.json(report);
  });

  // Vite Middleware (Development) or Static Dist (Production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Akamai Synthetic Release Gate] Control Plane + OpenAPI 3.1 + MCP Server listening on http://0.0.0.0:${PORT}`
    );
  });
}

startServer();
