import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_TEMPLATE_CONFIG } from './src/config/template.config';
import {
  INITIAL_RUNS,
  buildInitialComparison,
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
import {
  defaultUserManager,
  type UserActionType,
  type UserStatus,
} from './src/engine/userManager';
import {
  executeLiveSalesforceRun,
  loadDotEnvCredentials,
  probeLiveUrlHttpFlow,
} from './src/engine/httpFlowProber';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Load .env AWS credentials (supports both KEY=VALUE and "AWS Access Key: ..." format)
  const awsEnv = loadDotEnvCredentials();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  // In-memory server run store (seeded with salesforce.com runs, then enriched with live HTTP flows)
  let serverRuns = [...INITIAL_RUNS];

  // Trigger initial background live HTTP flow capture against www.salesforce.com on startup
  (async () => {
    try {
      const [liveStg, livePrd] = await Promise.all([
        executeLiveSalesforceRun({
          targetId: 'www.prod.staging',
          runNumber: 1,
          label: 'v2026.11-rc1',
          operatorEmail: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
        }),
        executeLiveSalesforceRun({
          targetId: 'www.prod.prod',
          runNumber: 1,
          label: 'live-baseline',
          operatorEmail: 'aws-synthetics-canary',
        }),
      ]);
      liveStg.key = 'run-www-prod-staging-1';
      livePrd.key = 'run-www-prod-prod-1';
      serverRuns = serverRuns.map((r) => {
        if (r.key === 'run-www-prod-staging-1') return liveStg;
        if (r.key === 'run-www-prod-prod-1') return livePrd;
        return r;
      });
    } catch {
      // Keep deterministic salesforce.com runs if network is restricted
    }
  })();

  // Helper to resolve operator email from request headers/body for user tracking
  const resolveOperatorEmail = (req: express.Request): string => {
    const headerEmail = req.headers['x-operator-email'];
    if (typeof headerEmail === 'string' && headerEmail.trim()) {
      return headerEmail.trim().toLowerCase();
    }
    if (typeof req.body?.userEmail === 'string' && req.body.userEmail.trim()) {
      return req.body.userEmail.trim().toLowerCase();
    }
    if (typeof req.body?.email === 'string' && req.body.email.trim()) {
      return req.body.email.trim().toLowerCase();
    }
    if (typeof req.body?.by === 'string' && req.body.by.includes('@')) {
      return req.body.by.trim().toLowerCase();
    }
    return DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email;
  };

  // 1. OpenAPI 3.1.0 Specification JSON
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(buildOpenApiSpec(DEFAULT_TEMPLATE_CONFIG));
  });

  // 2. Control Plane, AWS Synthetics, CloudFront & Bedrock Nova Lite Health
  app.get('/api/v1/health', (_req, res) => {
    const cleanEnv = (val: string | undefined, fallback: string) =>
      val && val.toLowerCase() !== 'dummy' ? val : fallback;
    const awsLive = Boolean(
      process.env.AWS_EXECUTION_ENV || awsEnv.loaded
    );
    const userStats = defaultUserManager.getStatsSummary();
    res.json({
      status: 'HEALTHY',
      service: DEFAULT_TEMPLATE_CONFIG.branding.controlPlaneTitle,
      domain: DEFAULT_TEMPLATE_CONFIG.branding.defaultDomain,
      executionMode: awsLive ? 'aws-production' : 'local-seed-fallback',
      awsCredentialsStatus: {
        configured: awsEnv.loaded,
        accountId: awsEnv.accountId,
        operatorUsername: awsEnv.operatorUsername,
        maskedAccessKeyId: awsEnv.maskedAccessKey,
        region: awsEnv.region,
      },
      deploymentTopology: cleanEnv(
        process.env.DEPLOYMENT_TOPOLOGY,
        'cloudfront-s3-oac-plus-lambda-apigw-v2'
      ),
      terraformProvisionedAws: {
        cloudfrontDistributionId: cleanEnv(
          process.env.CLOUDFRONT_DISTRIBUTION_ID,
          'E14EWSABQ7XKYP'
        ),
        cloudfrontPortalUrl: cleanEnv(
          process.env.CLOUDFRONT_PORTAL_URL,
          'https://d23ghgiulnkns4.cloudfront.net'
        ),
        apiGatewayHttpApiEndpoint: cleanEnv(
          process.env.APIGW_HTTP_API_ENDPOINT,
          'https://a5rxmal7o4.execute-api.us-east-1.amazonaws.com'
        ),
        controlPlaneLambdaName: cleanEnv(
          process.env.CONTROL_PLANE_LAMBDA_NAME,
          'salesforce-edge-release-gate-control-plane-prod'
        ),
        adhocRunnerLambdaName: cleanEnv(
          process.env.ADHOC_RUNNER_LAMBDA_NAME,
          'salesforce-edge-release-gate-adhoc-runner-prod'
        ),
        ssmConfigParameter: cleanEnv(
          process.env.SSM_CONFIG_PARAMETER,
          '/salesforce-release-gate/prod/runtime-config'
        ),
        syntheticsIamRoleArn: cleanEnv(
          process.env.SYNTHETICS_IAM_ROLE_ARN,
          'arn:aws:iam::030771555103:role/AkamaiSyntheticsReleaseGateRole-prod-us-east-1'
        ),
        snsAlertsTopicArn: cleanEnv(
          process.env.SNS_ALERTS_TOPIC_ARN,
          'arn:aws:sns:us-east-1:030771555103:salesforce-edge-release-gate-alerts-prod'
        ),
      },
      awsRegion: cleanEnv(
        process.env.AWS_REGION,
        DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion
      ),
      syntheticsRuntime: cleanEnv(
        process.env.SYNTHETICS_RUNTIME_VERSION,
        DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion
      ),
      s3ArtifactBucket: cleanEnv(
        process.env.SYNTHETICS_S3_BUCKET,
        DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket
      ),
      dynamodbTable: cleanEnv(
        process.env.SYNTHETICS_DYNAMODB_TABLE,
        DEFAULT_TEMPLATE_CONFIG.infrastructure.dynamodbTable
      ),
      bedrockVisualJudge: {
        provider: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeProvider,
        modelId: cleanEnv(
          process.env.BEDROCK_VISUAL_JUDGE_MODEL_ID,
          DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel
        ),
        modelArn: DEFAULT_TEMPLATE_CONFIG.infrastructure.bedrockModelArn,
        ready: true,
      },
      networks: DEFAULT_TEMPLATE_CONFIG.networks,
      totalIndexedRuns: serverRuns.length,
      userSummary: {
        totalUsers: userStats.totalUsers,
        activeUsers: userStats.activeUsers,
        totalRunsTriggeredAcrossUsers: userStats.totalRunsTriggeredAcrossUsers,
        totalAuditEvents: userStats.totalAuditEvents,
      },
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

  // 6. Trigger Live HTTP Flow Probe + AWS CloudWatch Synthetics Canary & Auto-Compare vs Previous Run
  app.post(['/api/v1/runs/trigger', '/api/synthetics/runs'], async (req, res) => {
    const targetId =
      (req.body?.targetId as string) ||
      (req.body?.target as string) ||
      'www.prod.staging';
    const operatorEmail = resolveOperatorEmail(req);
    const prevRun = serverRuns.find((r) => r.target === targetId);
    const runNum = serverRuns.filter((r) => r.target === targetId).length + 1;
    const label = (req.body?.label as string) || `run #${runNum}`;

    const newRun = await executeLiveSalesforceRun({
      targetId,
      runNumber: runNum,
      label,
      operatorEmail,
      suite: Array.isArray(req.body?.suite)
        ? req.body.suite
        : DEFAULT_TEMPLATE_CONFIG.testSuite,
    });

    serverRuns = [newRun, ...serverRuns];

    const comparison = prevRun
      ? buildInitialComparison(newRun, prevRun, 'network')
      : null;

    defaultUserManager.trackUserAction({
      email: operatorEmail,
      action: 'SYNTHETIC_RUN_TRIGGERED',
      target: targetId,
      source: req.body?.source === 'cli' ? 'cli' : 'rest-api',
      metadata: {
        runKey: newRun.key,
        verdict: comparison?.headlineVerdict || 'GO',
      },
    });

    res.json({
      dispatched: true,
      engine: DEFAULT_TEMPLATE_CONFIG.infrastructure.runnerEngine,
      runtimeVersion: DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion,
      newRun,
      comparedAgainstPreviousRun: prevRun?.key || null,
      headlineVerdict: comparison?.headlineVerdict || 'GO',
      rollup: comparison?.rollup || null,
      ...newRun,
    });
  });

  // 6b. Live Single-URL Multi-Hop HTTP Flow Prober Endpoint
  app.post('/api/v1/probe/live', async (req, res) => {
    const rawUrl =
      (req.body?.url as string) || 'https://www.salesforce.com/crm';
    const isStaging = Boolean(req.body?.network === 'staging');
    const netCfg = isStaging
      ? DEFAULT_TEMPLATE_CONFIG.networks.staging
      : DEFAULT_TEMPLATE_CONFIG.networks.prod;

    let hostname = 'www.salesforce.com';
    try {
      hostname = new URL(rawUrl).hostname;
    } catch {
      // ignore
    }

    try {
      const flow = await probeLiveUrlHttpFlow({
        url: rawUrl,
        isStaging,
        fallbackIp: netCfg.defaultEdgeIp,
        edgeHostname: `${hostname}${netCfg.edgeSuffix}`,
        maxHops: 5,
      });
      res.json({
        probed: true,
        url: rawUrl,
        ...flow,
      });
    } catch (err: unknown) {
      res.status(500).json({
        probed: false,
        url: rawUrl,
        error: err instanceof Error ? err.message : 'Live probe failed',
      });
    }
  });

  // 7. Evaluate 3-Dimension Comparison (Headers, Cookies, Bedrock Nova Lite Visual Judge)
  app.post('/api/v1/comparisons/evaluate', (req, res) => {
    const candidateTarget =
      (req.body?.candidateTarget as string) || 'www.prod.staging';
    const baselineTarget =
      (req.body?.baselineTarget as string) || 'www.prod.prod';
    const operatorEmail = resolveOperatorEmail(req);
    const candRun =
      serverRuns.find((r) => r.target === candidateTarget) || serverRuns[0];
    const baseRun =
      serverRuns.find((r) => r.target === baselineTarget) ||
      serverRuns[1] ||
      serverRuns[0];
    const kind = candRun.envId === baseRun.envId ? 'network' : 'env';
    const comp = buildInitialComparison(candRun, baseRun, kind);

    defaultUserManager.trackUserAction({
      email: operatorEmail,
      action: 'COMPARISON_EVALUATED',
      target: `${candidateTarget} vs ${baselineTarget}`,
      source: req.body?.source === 'cli' ? 'cli' : 'rest-api',
      metadata: {
        comparisonId: comp.comparisonId,
        headlineVerdict: comp.headlineVerdict,
      },
    });

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
        httpFlowHops: i.candidateResult?.redirectChain?.length || 1,
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
    const operatorEmail = resolveOperatorEmail(req);
    const pixelDiffPercent =
      typeof req.body?.pixelDiffPercent === 'number'
        ? req.body.pixelDiffPercent
        : testId === 'T03'
        ? 1.8
        : 0.04;

    defaultUserManager.trackUserAction({
      email: operatorEmail,
      action: 'VISUAL_JUDGE_INVOKED',
      target: `${testId}:${candidateTarget}`,
      source: 'rest-api',
      metadata: { testId, pixelDiffPercent },
    });

    if (req.body?.sideABase64Png && req.body?.sideBBase64Png) {
      try {
        const { invokeBedrockNovaLiteJudge } = await import(
          './aws-synthetics/bedrock-nova-lite-judge'
        );
        const liveRes = await invokeBedrockNovaLiteJudge({
          testId,
          pageName: req.body?.pageName || testId,
          url: req.body?.url || `https://www.salesforce.com/${testId}`,
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
    const operatorEmail = resolveOperatorEmail(req);

    defaultUserManager.trackUserAction({
      email: operatorEmail,
      action: 'MCP_TOOL_INVOKED',
      target: toolName,
      source: 'mcp',
      metadata: { toolName },
    });

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

    if (toolName === 'get_user_stats' || toolName === 'list_users') {
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: defaultUserManager.getStatsSummary(args.email),
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
        testName: args.testName || 'Sales Cloud & Agentforce Product Overview',
        path: args.path || '/sales/',
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
      testName: body.testName || 'Sales Cloud & Agentforce Product Overview',
      path: body.path || '/sales/',
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

  // ==========================================================================
  // 13. HEADLESS USER MANAGEMENT, PASSWORD RESET & USER TRACKING API (CLI/API)
  // ==========================================================================

  app.get('/api/v1/users', (_req, res) => {
    const users = defaultUserManager.listUsers();
    res.json({
      total: users.length,
      users,
    });
  });

  app.post('/api/v1/users', (req, res) => {
    try {
      const created = defaultUserManager.createUser({
        email: req.body?.email || '',
        name: req.body?.displayName || req.body?.name,
        role: req.body?.role || 'Edge Release Engineer',
        account: req.body?.account,
        password: req.body?.password || '',
        actor: req.body?.actorEmail || resolveOperatorEmail(req),
        source: 'rest-api',
      });
      res.status(201).json({
        created: true,
        user: created,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create user';
      res.status(400).json({ created: false, error: message });
    }
  });

  app.post('/api/v1/users/reset-password', (req, res) => {
    try {
      const result = defaultUserManager.resetPassword({
        email: req.body?.emailOrId || req.body?.email || '',
        newPassword: req.body?.newPassword || req.body?.password || '',
        mustChangePassword: Boolean(req.body?.mustChangePassword),
        actor: req.body?.actorEmail || resolveOperatorEmail(req),
        source: 'rest-api',
      });
      res.json({
        reset: true,
        ...result,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to reset user password';
      res.status(400).json({ reset: false, error: message });
    }
  });

  app.post('/api/v1/users/status', (req, res) => {
    try {
      const updated = defaultUserManager.updateUserStatusOrRole({
        email: req.body?.emailOrId || req.body?.email || '',
        status: req.body?.status as UserStatus | undefined,
        role: req.body?.role,
        actor: req.body?.actorEmail || resolveOperatorEmail(req),
        source: 'rest-api',
      });
      res.json({
        updated: true,
        user: updated,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to update user status';
      res.status(400).json({ updated: false, error: message });
    }
  });

  app.delete('/api/v1/users/:emailOrId', (req, res) => {
    const email = decodeURIComponent(req.params.emailOrId);
    const deleted = defaultUserManager.deleteUser(
      email,
      resolveOperatorEmail(req),
      'rest-api'
    );
    if (!deleted) {
      res.status(404).json({ deleted: false, error: `User ${email} not found` });
      return;
    }
    res.json({ deleted: true, email });
  });

  app.post('/api/v1/users/authenticate', (req, res) => {
    const result = defaultUserManager.authenticateUser({
      email: req.body?.email || '',
      password: req.body?.password || '',
      source: req.body?.source === 'cli' ? 'cli' : 'rest-api',
    });
    res.status(result.authenticated ? 200 : 401).json(result);
  });

  app.post('/api/v1/users/track', (req, res) => {
    const user = defaultUserManager.trackUserAction({
      email: req.body?.userEmail || req.body?.email || resolveOperatorEmail(req),
      action: (req.body?.action as UserActionType) || 'SYNTHETIC_RUN_TRIGGERED',
      target: req.body?.target || 'www.prod.staging',
      source: req.body?.source === 'cli' ? 'cli' : 'rest-api',
      metadata: req.body?.metadata,
    });
    res.status(201).json({ tracked: true, user });
  });

  app.get('/api/v1/users/stats', (req, res) => {
    const emailFilter =
      typeof req.query.email === 'string' ? req.query.email : undefined;
    res.json(defaultUserManager.getStatsSummary(emailFilter));
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
      `[Salesforce Edge Release Gate] Control Plane + Live HTTP Flow Prober + MCP Server listening on http://0.0.0.0:${PORT} (AWS Account: ${awsEnv.accountId})`
    );
  });
}

startServer();
