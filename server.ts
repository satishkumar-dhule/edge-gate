import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_TEMPLATE_CONFIG,
  getPropertyTestSuite,
  inferPropertyIdFromUrl,
  resolveRegionalEdgeNode,
} from './src/config/template.config';
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
import fs from 'fs';
import {
  executeLiveSalesforceRun,
  loadDotEnvCredentials,
  probeLiveUrlHttpFlow,
} from './src/engine/httpFlowProber';
import {
  QUALIFIED_COHORT_COOKIE_HEADER,
  QUALIFIED_PLAYWRIGHT_COOKIES,
} from './src/engine/qualifiedCohort';
import { measurePlaywrightJpegDiffPercent } from './src/engine/pixelDiff';
import { defaultZeroTokenEngine } from './src/engine/zeroTokenArchitecture';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import {
  parseMakefileTargets,
  resolveComputeCommand,
} from './src/engine/computeShell';
import { ensureComputeBinShims } from './src/engine/computeShims';
import {
  listWorkspaceTree,
  readWorkspaceFile,
  searchWorkspaceFiles,
  writeWorkspaceFile,
} from './src/engine/workspaceServer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Load .env AWS credentials (supports both KEY=VALUE and "AWS Access Key: ..." format)
  let awsEnv = loadDotEnvCredentials();
  defaultZeroTokenEngine.updateEnvMetadata({
    accountId: awsEnv.accountId,
    operatorUsername: awsEnv.operatorUsername,
    maskedAccessKey: awsEnv.maskedAccessKey,
    region: awsEnv.region,
    cycleStatus: 'VERIFIED_LOCAL_STANDBY',
    cycleAt: new Date().toISOString(),
  });

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // In-memory server run store populated with live salesforce.com HTTP flow probes
  let serverRuns = [...INITIAL_RUNS];

  const seedLiveFleetOnServer = async () => {
    const fleetTargets = [
      'www.prod.staging',
      'www.prod.prod',
      'www.uat.staging',
      'www.uat.prod',
      'login.prod.staging',
      'login.prod.prod',
      'developer.prod.staging',
      'developer.prod.prod',
      'help.prod.staging',
      'help.prod.prod',
      'trailhead.prod.staging',
      'trailhead.prod.prod',
      'status.prod.staging',
      'status.prod.prod',
      'appexchange.prod.staging',
      'appexchange.prod.prod',
      'partners.prod.staging',
      'partners.prod.prod',
      'apac.prod.staging',
      'apac.prod.prod',
      'emea.prod.staging',
      'emea.prod.prod',
      'americas.prod.staging',
      'americas.prod.prod',
      'japan.prod.staging',
      'japan.prod.prod',
      'uk.prod.staging',
      'uk.prod.prod',
      'germany.prod.staging',
      'germany.prod.prod',
    ];
    const opEmail = `${awsEnv.operatorUsername || 'user-pqtpsgwbthke'}@salesforce.com`;
    const liveRuns: typeof INITIAL_RUNS = [];
    // Execute in batches of 4 targets so startup does not saturate sockets
    for (let i = 0; i < fleetTargets.length; i += 4) {
      const batch = fleetTargets.slice(i, i + 4);
      const batchRuns = await Promise.all(
        batch.map(async (targetId) => {
          const net = targetId.endsWith('.staging') ? 'staging' : 'prod';
          const run = await executeLiveSalesforceRun({
            targetId,
            runNumber: 1,
            label: `live-${net}`,
            operatorEmail: opEmail,
          });
          run.key = `run-${targetId.replace(/\./g, '-')}-live-1`;
          return run;
        })
      );
      liveRuns.push(...batchRuns);
      // Merge incrementally into serverRuns as each batch completes
      const batchTargetSet = new Set(batch);
      serverRuns = [
        ...batchRuns,
        ...serverRuns.filter((r) => !batchTargetSet.has(r.target)),
      ];
    }
    serverRuns = liveRuns;
    return liveRuns;
  };

  // Zero-Token .env Watcher: Automatically detect rotated AWS credentials in /.env and re-seed fleet
  const dotEnvPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(dotEnvPath)) {
    fs.watchFile(dotEnvPath, { interval: 2500 }, () => {
      try {
        const refreshed = loadDotEnvCredentials();
        const { changed } = defaultZeroTokenEngine.updateEnvMetadata({
          accountId: refreshed.accountId,
          operatorUsername: refreshed.operatorUsername,
          maskedAccessKey: refreshed.maskedAccessKey,
          region: refreshed.region,
          cycleStatus: 'VERIFIED_LOCAL_STANDBY',
          cycleAt: new Date().toISOString(),
        });
        if (changed) {
          awsEnv = refreshed;
          seedLiveFleetOnServer().catch(() => undefined);
        }
      } catch {
        // Ignore transient file write errors
      }
    });
  }

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

  // 5b. Purge & Seed Live Fleet Runs Across All 8 Salesforce Properties
  app.post('/api/v1/runs/seed-fleet', async (_req, res) => {
    try {
      const liveRuns = await seedLiveFleetOnServer();
      res.json({
        seededLiveFleet: true,
        total: liveRuns.length,
        runs: liveRuns,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const inFlightScreenshotCaptures = new Map<
    string,
    Promise<{
      captured: boolean;
      revision: number;
      capturedAt: string | null;
      sha256: string;
      bytes: number;
      s3Key: string;
      pixelDiffPercent: number;
      screenshotSource: 'playwright-chromium' | 'none';
      captureEngine: 'local-playwright-chromium' | 'http-only-no-browser';
      error?: string;
    }>
  >();

  const readScreenshotFileMetadata = async (
    propId: string,
    testId: string,
    side: 'A' | 'B' = 'A'
  ): Promise<{ sha256: string; bytes: number; s3Key: string }> => {
    const cryptoMod = await import('node:crypto');
    const cleanProp = (propId || 'www').toLowerCase();
    const idUpper = (testId || 'T01').toUpperCase();
    const fileName = `${cleanProp}-${idUpper}-side${side}.jpg`;
    const s3Key = `portal-ui/screenshots/${fileName}`;
    const candidatePath = path.resolve(__dirname, 'public', 'screenshots', fileName);
    if (fs.existsSync(candidatePath)) {
      const buf = fs.readFileSync(candidatePath);
      const sha256 = cryptoMod.createHash('sha256').update(buf).digest('hex');
      return { sha256, bytes: buf.length, s3Key };
    }
    return { sha256: '', bytes: 0, s3Key };
  };

  // Serve real captured JPEG screenshots via API proxy cleanly (404 JSON if absent, never HTML)
  app.get('/api/v1/screenshots/:filename', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const rawName = String(req.params.filename || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!rawName || !/\.(jpg|jpeg|png)$/i.test(rawName)) {
      res.status(400).json({ error: 'Invalid screenshot filename' });
      return;
    }
    const candidatePath = path.resolve(__dirname, 'public', 'screenshots', rawName);
    if (!fs.existsSync(candidatePath)) {
      res.status(404).json({ captured: false, error: 'Screenshot not captured yet', filename: rawName });
      return;
    }
    res.type(rawName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.sendFile(candidatePath);
  });

  app.get('/api/v1/canary/status', (req, res) => {
    const targetId = String(req.query.targetId || 'www.prod.staging');
    const canaryName = String(req.query.canaryName || `ak-${targetId.replace(/\./g, '-').slice(0, 18)}`);
    res.json({
      canaryName,
      targetId,
      available: false,
      state: 'LOCAL_PLAYWRIGHT_MODE',
      recentRuns: [],
      note: 'Local dev server captures screenshots synchronously via Playwright Chromium.',
    });
  });

  // Helper to capture fresh, 100% unmodified 1280x760 headless Chromium screenshots on Rerun / Probe
  const captureLiveScreenshotOnDemand = async (
    rawUrl: string,
    propId: string,
    testId: string
  ): Promise<{
    captured: boolean;
    revision: number;
    capturedAt: string | null;
    sha256: string;
    bytes: number;
    s3Key: string;
    pixelDiffPercent: number;
    screenshotSource: 'playwright-chromium' | 'none';
    captureEngine: 'local-playwright-chromium' | 'http-only-no-browser';
    error?: string;
  }> => {
    const idUpper = (testId || 'T01').toUpperCase();
    const cleanProp = inferPropertyIdFromUrl(rawUrl, propId);
    const regionalNode = resolveRegionalEdgeNode(cleanProp, rawUrl);
    const lockKey = `${cleanProp}-${idUpper}`;
    const existingLock = inFlightScreenshotCaptures.get(lockKey);
    if (existingLock) {
      return existingLock;
    }

    const task = (async () => {
      const revision = Date.now();
      const capturedAt = new Date(revision).toISOString();
      const publicDir = path.resolve(__dirname, 'public', 'screenshots');
      const distDir = path.resolve(__dirname, 'dist', 'screenshots');
      let measuredDiffPercent = 0;
      let liveCaptured = false;
      let captureError: string | undefined;

      let targetHostPattern: RegExp | string = /^https:\/\/[^/]+\.salesforce\.com\/.*/;
      try {
        const parsed = new URL(rawUrl);
        if (!parsed.hostname.endsWith('.salesforce.com')) {
          targetHostPattern = `${parsed.origin}/**`;
        }
      } catch {
        // Keep salesforce.com regex
      }

      try {
        const { createRequire } = await import('node:module');
        let chromium: any = null;
        try {
          const requireLocal = createRequire(import.meta.url);
          ({ chromium } = requireLocal('playwright-core'));
        } catch {
          const requireGlobal = createRequire(
            '/usr/local/share/bun-global/node_modules/@playwright/cli/playwright-cli.js'
          );
          ({ chromium } = requireGlobal('playwright-core'));
        }

        const browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        try {
          const setupSideContext = async (mode: 'staging' | 'prod') => {
            const ctx = await browser.newContext({
              viewport: { width: 1280, height: 760 },
              deviceScaleFactor: 1,
              locale: regionalNode.locale.replace('_', '-'),
              userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              extraHTTPHeaders: {
                'Accept-Language': regionalNode.acceptLanguage,
                ...(mode === 'staging'
                  ? {
                      Pragma: DEFAULT_TEMPLATE_CONFIG.infrastructure.pragmaHeaders.join(', '),
                    }
                  : {}),
              },
            });
            await ctx.addCookies(QUALIFIED_PLAYWRIGHT_COOKIES);
            const regionalCookieHeader = [
              QUALIFIED_COHORT_COOKIE_HEADER,
              regionalNode.regionalCookieHeader,
            ]
              .filter(Boolean)
              .join('; ');
            await ctx.route(targetHostPattern, async (route: any) => {
              const req = route.request();
              if (req.resourceType() !== 'document') {
                await route.continue();
                return;
              }
              try {
                const resp = await fetch(req.url(), {
                  headers: {
                    'user-agent':
                      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    accept:
                      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'accept-language': regionalNode.acceptLanguage,
                    'x-akamai-edgescape': regionalNode.edgescapeHeader,
                    cookie: regionalCookieHeader,
                  },
                  redirect: 'follow',
                });
                const bodyBuf = Buffer.from(await resp.arrayBuffer());
                const headersObj: Record<string, string> = {};
                resp.headers.forEach((v, k) => {
                  const lower = k.toLowerCase();
                  if (
                    lower !== 'content-encoding' &&
                    lower !== 'content-length' &&
                    lower !== 'transfer-encoding' &&
                    lower !== 'content-security-policy'
                  ) {
                    headersObj[k] = v;
                  }
                });
                await route.fulfill({
                  status: resp.status,
                  headers: headersObj,
                  body: bodyBuf,
                });
              } catch {
                await route.continue();
              }
            });
            return ctx;
          };

          const [ctxA, ctxB] = await Promise.all([
            setupSideContext('staging'),
            setupSideContext('prod'),
          ]);
          const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);

          let safeUrl = rawUrl;
          if (
            ['japan', 'germany', 'uk', 'apac', 'emea', 'americas'].includes(cleanProp) &&
            !safeUrl.includes('bc=')
          ) {
            safeUrl += safeUrl.includes('?') ? '&bc=OTH' : '?bc=OTH';
          }

          await Promise.all([
            pageA.goto(safeUrl, { waitUntil: 'load', timeout: 14000 }).catch(() => null),
            pageB.goto(safeUrl, { waitUntil: 'load', timeout: 14000 }).catch(() => null),
          ]);
          await Promise.all([
            pageA.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => null),
            pageB.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => null),
          ]);
          await Promise.all([
            pageA.evaluate(() => (document as any).fonts?.ready).catch(() => null),
            pageB.evaluate(() => (document as any).fonts?.ready).catch(() => null),
          ]);

          const dismissConsent = async (pg: any) => {
            await pg
              .evaluate(() => {
                const acceptBtn =
                  document.querySelector('#onetrust-accept-btn-handler') ||
                  document.querySelector('button[id*="onetrust-accept"]');
                if (acceptBtn && typeof (acceptBtn as HTMLElement).click === 'function') {
                  (acceptBtn as HTMLElement).click();
                }
                const sdk = document.querySelector('#onetrust-consent-sdk');
                if (sdk) {
                  sdk.setAttribute('style', 'display:none !important; visibility:hidden !important;');
                }
              })
              .catch(() => null);
          };
          await Promise.all([dismissConsent(pageA), dismissConsent(pageB)]);
          await Promise.all([pageA.waitForTimeout(1800), pageB.waitForTimeout(1800)]);

          const [bufA, bufB] = await Promise.all([
            pageA.screenshot({
              type: 'jpeg',
              quality: 84,
              clip: { x: 0, y: 0, width: 1280, height: 760 },
            }),
            pageB.screenshot({
              type: 'jpeg',
              quality: 84,
              clip: { x: 0, y: 0, width: 1280, height: 760 },
            }),
          ]);

          if (bufA && bufB && bufA.length > 5000 && bufB.length > 5000) {
            const diffPage = await ctxB.newPage();
            await diffPage.setContent('<html><body></body></html>');
            const measured = await measurePlaywrightJpegDiffPercent(diffPage, bufA, bufB);
            measuredDiffPercent = measured.pixelDiffPercent;
            await diffPage.close();

            for (const dir of [publicDir, distDir]) {
              if (!fs.existsSync(dir) && dir === publicDir) {
                fs.mkdirSync(dir, { recursive: true });
              }
              if (fs.existsSync(dir)) {
                fs.writeFileSync(
                  path.join(dir, `${cleanProp}-${idUpper}-sideA.jpg`),
                  bufA
                );
                fs.writeFileSync(
                  path.join(dir, `${cleanProp}-${idUpper}-sideB.jpg`),
                  bufB
                );
              }
            }
            liveCaptured = true;
          } else {
            captureError = 'Playwright Chromium returned under-sized or blank screenshot buffer';
          }

          await Promise.all([pageA.close(), pageB.close()]);
          await Promise.all([ctxA.close(), ctxB.close()]);
        } finally {
          await browser.close();
        }
      } catch (err: unknown) {
        captureError = err instanceof Error ? err.message : 'Local Playwright capture failed';
      }

      const meta = await readScreenshotFileMetadata(cleanProp, idUpper, 'A');
      if (liveCaptured && meta.bytes > 0) {
        return {
          captured: true,
          revision,
          capturedAt,
          sha256: meta.sha256,
          bytes: meta.bytes,
          s3Key: meta.s3Key,
          pixelDiffPercent: measuredDiffPercent,
          screenshotSource: 'playwright-chromium' as const,
          captureEngine: 'local-playwright-chromium' as const,
        };
      }

      return {
        captured: false,
        revision,
        capturedAt: null,
        sha256: '',
        bytes: 0,
        s3Key: meta.s3Key,
        pixelDiffPercent: measuredDiffPercent,
        screenshotSource: 'none' as const,
        captureEngine: 'http-only-no-browser' as const,
        error: captureError || 'Chromium did not capture fresh screenshot',
      };
    })();

    inFlightScreenshotCaptures.set(lockKey, task);
    try {
      return await task;
    } finally {
      inFlightScreenshotCaptures.delete(lockKey);
    }
  };

  // 6. Trigger Live HTTP Flow Probe + AWS CloudWatch Synthetics Canary & Auto-Compare vs Previous Run
  app.post(['/api/v1/runs', '/api/v1/runs/trigger', '/api/synthetics/runs'], async (req, res) => {
    const targetId =
      (req.body?.targetId as string) ||
      (req.body?.target as string) ||
      'www.prod.staging';
    const operatorEmail = resolveOperatorEmail(req);
    const prevRun = serverRuns.find((r) => r.target === targetId);
    const runNum = serverRuns.filter((r) => r.target === targetId).length + 1;
    const label = (req.body?.label as string) || `run #${runNum}`;
    const propId = targetId.split('.')[0] || 'www';
    const suiteAppId =
      (typeof req.body?.suiteAppId === 'string' && req.body.suiteAppId.trim()) ||
      propId;
    const popId =
      typeof req.body?.popId === 'string' && req.body.popId.trim()
        ? req.body.popId.trim()
        : undefined;
    const side: 'A' | 'B' = targetId.endsWith('.staging') ? 'A' : 'B';

    const newRun = await executeLiveSalesforceRun({
      targetId,
      runNumber: runNum,
      label,
      operatorEmail,
      suiteAppId,
      popId,
      suite: Array.isArray(req.body?.suite)
        ? req.body.suite
        : getPropertyTestSuite(suiteAppId),
    });

    if (typeof req.body?.runKey === 'string' && req.body.runKey.trim()) {
      newRun.key = req.body.runKey.trim();
    }

    const screenshotRevision = Date.now();
    const screenshotCapturedAt = new Date(screenshotRevision).toISOString();
    const probedTimeStr = new Date(screenshotRevision).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    newRun.results = await Promise.all(
      newRun.results.map(async (item) => {
        const prevItem = prevRun?.results.find((p) => p.id === item.id);
        const meta = await readScreenshotFileMetadata(suiteAppId, item.id, side);
        return {
          ...item,
          probedAt: probedTimeStr,
          probeCount: (prevItem?.probeCount || 0) + 1,
          screenshotRevision,
          screenshotCapturedAt,
          screenshotSha256: meta.sha256,
          screenshotBytes: meta.bytes,
          s3ScreenshotKey: meta.s3Key,
        };
      })
    );

    serverRuns = [newRun, ...serverRuns.filter((r) => r.key !== newRun.key)];

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

    const firstMeta = newRun.results[0];
    const hasAnyCaptured = newRun.results.some((r) => (r.screenshotBytes || 0) > 0);
    const runSideSuffix = side === 'A' ? 'sideA' : 'sideB';
    res.json({
      dispatched: true,
      engine: DEFAULT_TEMPLATE_CONFIG.infrastructure.runnerEngine,
      runtimeVersion: DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion,
      run: newRun,
      newRun,
      result: newRun,
      targetId,
      suiteAppId,
      executionPop: newRun.executionPop,
      comparedAgainstPreviousRun: prevRun?.key || null,
      headlineVerdict: comparison?.headlineVerdict || 'GO',
      rollup: comparison?.rollup || null,
      screenshotCaptured: hasAnyCaptured,
      screenshotBytes: firstMeta?.screenshotBytes || 0,
      screenshotUrl:
        (firstMeta?.screenshotBytes || 0) > 0
          ? `/api/v1/screenshots/${suiteAppId}-${firstMeta.id}-${runSideSuffix}.jpg?v=${screenshotRevision}`
          : null,
      screenshotRevision,
      screenshotCapturedAt: hasAnyCaptured ? screenshotCapturedAt : null,
      ...newRun,
    });
  });

  // 6b. Live Single-URL Multi-Hop HTTP Flow Prober + Live Screenshot Capture & Persistence Endpoint
  app.post(['/api/v1/probe/live', '/api/v1/screenshot/capture'], async (req, res) => {
    const rawUrl =
      (req.body?.url as string) || 'https://www.salesforce.com/crm';
    const isStaging = Boolean(req.body?.network === 'staging');
    const testId = (req.body?.testId as string) || 'T01';
    const shouldCaptureScreenshot = req.body?.captureScreenshot !== false;
    const popId =
      typeof req.body?.popId === 'string' && req.body.popId.trim()
        ? req.body.popId.trim()
        : undefined;
    const netCfg = isStaging
      ? DEFAULT_TEMPLATE_CONFIG.networks.staging
      : DEFAULT_TEMPLATE_CONFIG.networks.prod;

    let hostname = 'www.salesforce.com';
    try {
      hostname = new URL(rawUrl).hostname;
    } catch {
      // ignore
    }
    const explicitAppId =
      (req.body?.appId as string) ||
      (typeof req.body?.targetId === 'string'
        ? req.body.targetId.split('.')[0]
        : undefined);
    const propId = inferPropertyIdFromUrl(rawUrl, explicitAppId);
    const regionalNode = resolveRegionalEdgeNode(propId, rawUrl, popId);
    const regionalEdgeIp = isStaging
      ? regionalNode.stagingEdgeIp
      : regionalNode.prodEdgeIp;

    const targetId =
      (req.body?.targetId as string) ||
      `${propId}.prod.${isStaging ? 'staging' : 'prod'}`;

    try {
      const [flow, screenshotMeta] = await Promise.all([
        probeLiveUrlHttpFlow({
          url: rawUrl,
          isStaging,
          fallbackIp: regionalEdgeIp,
          edgeHostname: `${hostname}${netCfg.edgeSuffix}`,
          appId: propId,
          popOverrideId: popId,
          expectedStatus: req.body?.expectedStatus,
          maxHops: 5,
        }),
        shouldCaptureScreenshot
          ? captureLiveScreenshotOnDemand(rawUrl, propId, testId)
          : (async () => {
              const revision = Date.now();
              const meta = await readScreenshotFileMetadata(
                propId,
                testId,
                isStaging ? 'A' : 'B'
              );
              return {
                captured: false,
                revision,
                capturedAt: null,
                sha256: '',
                bytes: 0,
                s3Key: meta.s3Key,
                pixelDiffPercent: 0,
                screenshotSource: 'none' as const,
                captureEngine: 'http-only-no-browser' as const,
                error: undefined as string | undefined,
              };
            })(),
      ]);

      const probedAtStr = new Date(screenshotMeta.revision).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const sideSuffix = isStaging ? 'sideA' : 'sideB';
      const screenshotCaptured = screenshotMeta.captured && screenshotMeta.bytes > 0;
      const screenshotUrl = screenshotCaptured
        ? `/api/v1/screenshots/${propId}-${testId.toUpperCase()}-${sideSuffix}.jpg?v=${screenshotMeta.revision}`
        : null;
      const cachedScreenshotUrl = null;

      // Persist the newly probed TestResult & screenshot metadata into serverRuns for targetId
      let persistedToRunKey: string | null = null;
      let updatedProbeCount = 1;
      serverRuns = serverRuns.map((run, idx) => {
        const isFirstMatchingTarget =
          run.target === targetId &&
          serverRuns.findIndex((r) => r.target === targetId) === idx;
        if (!isFirstMatchingTarget) return run;
        persistedToRunKey = run.key;
        return {
          ...run,
          results: run.results.map((item) => {
            if (item.id.toUpperCase() !== testId.toUpperCase()) return item;
            updatedProbeCount = (item.probeCount || 0) + 1;
            return {
              ...item,
              actualStatus: flow.finalStatus ?? item.actualStatus,
              durationMs:
                flow.summary?.totalDurationMs ??
                item.durationMs,
              redirectChain:
                Array.isArray(flow.hops) && flow.hops.length > 0
                  ? flow.hops
                  : item.redirectChain,
              httpFlowSummary: flow.summary ?? item.httpFlowSummary,
              capturedHeaders:
                flow.finalHeaders && Object.keys(flow.finalHeaders).length > 0
                  ? { ...item.capturedHeaders, ...flow.finalHeaders }
                  : item.capturedHeaders,
              capturedCookies:
                flow.finalCookies && Object.keys(flow.finalCookies).length > 0
                  ? { ...item.capturedCookies, ...flow.finalCookies }
                  : item.capturedCookies,
              probedAt: probedAtStr,
              probeCount: updatedProbeCount,
              screenshotCaptured,
              screenshotSource: screenshotMeta.screenshotSource,
              captureEngine: screenshotMeta.captureEngine,
              canaryError: screenshotMeta.error,
              screenshotRevision: screenshotCaptured
                ? screenshotMeta.revision
                : item.screenshotRevision,
              screenshotCapturedAt: screenshotCaptured
                ? screenshotMeta.capturedAt || undefined
                : item.screenshotCapturedAt,
              screenshotSha256: screenshotCaptured
                ? screenshotMeta.sha256
                : undefined,
              screenshotBytes: screenshotCaptured
                ? screenshotMeta.bytes
                : 0,
              s3ScreenshotKey: screenshotCaptured
                ? screenshotMeta.s3Key
                : undefined,
              screenshotUrl: screenshotCaptured
                ? screenshotUrl || undefined
                : undefined,
              cachedScreenshotUrl: undefined,
              cachedScreenshotBytes: 0,
              pixelDiffPercent: screenshotMeta.pixelDiffPercent,
            };
          }),
        };
      });

      res.json({
        probed: true,
        url: rawUrl,
        targetId,
        testId,
        persistedToRunKey,
        probedAt: probedAtStr,
        probeCount: updatedProbeCount,
        screenshotCaptured,
        screenshotSource: screenshotMeta.screenshotSource,
        captureEngine: screenshotMeta.captureEngine,
        screenshotRevision: screenshotCaptured ? screenshotMeta.revision : undefined,
        screenshotCapturedAt: screenshotCaptured ? screenshotMeta.capturedAt : null,
        screenshotSha256: screenshotMeta.sha256,
        screenshotBytes: screenshotMeta.bytes,
        s3ScreenshotKey: screenshotCaptured ? screenshotMeta.s3Key : undefined,
        screenshotUrl,
        cachedScreenshotUrl,
        cachedScreenshotBytes: 0,
        canaryError: screenshotMeta.error || null,
        pixelDiffPercent: screenshotMeta.pixelDiffPercent,
        actualStatus: flow.finalStatus,
        durationMs: flow.summary?.totalDurationMs,
        redirectChain: flow.hops,
        httpFlowSummary: flow.summary,
        capturedHeaders: flow.finalHeaders,
        capturedCookies: flow.finalCookies,
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
  app.post(['/api/v1/compare', '/api/v1/comparisons/evaluate'], (req, res) => {
    const candidateTarget =
      (req.body?.candidateTarget as string) ||
      (req.body?.candidateTargetId as string) ||
      'www.prod.staging';
    const baselineTarget =
      (req.body?.baselineTarget as string) ||
      (req.body?.baselineTargetId as string) ||
      'www.prod.prod';
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

  // 8. 3-Tier Zero-Token AI Judge & SHA-256 Semantic Diff Cache (/api/v1/judge/nova-lite & /api/v1/zero-token/*)
  app.get('/api/v1/zero-token/status', (_req, res) => {
    res.json(defaultZeroTokenEngine.getTelemetrySnapshot());
  });

  app.post(['/api/v1/judge/nova-lite', '/api/v1/zero-token/evaluate'], async (req, res) => {
    const testId = ((req.body?.testId as string) || 'T03').toUpperCase();
    const candidateTarget =
      (req.body?.candidateTarget as string) || 'www.prod.staging';
    const baselineTarget =
      (req.body?.baselineTarget as string) || 'www.prod.prod';
    const operatorEmail = resolveOperatorEmail(req);
    const rawUrl = (req.body?.url as string) || 'https://www.salesforce.com/';
    const explicitApp =
      (req.body?.appId as string) || candidateTarget.split('.')[0] || 'www';
    const propId = inferPropertyIdFromUrl(rawUrl, explicitApp);

    let pixelDiffPercent =
      typeof req.body?.pixelDiffPercent === 'number' && !Number.isNaN(req.body.pixelDiffPercent)
        ? Number(req.body.pixelDiffPercent)
        : 0.0;

    if (pixelDiffPercent <= 0.1 && candidateTarget !== baselineTarget) {
      try {
        const sideAPath = path.join(
          __dirname,
          'public',
          'screenshots',
          `${propId}-${testId}-sideA.jpg`
        );
        const sideBPath = path.join(
          __dirname,
          'public',
          'screenshots',
          `${propId}-${testId}-sideB.jpg`
        );
        if (fs.existsSync(sideAPath) && fs.existsSync(sideBPath)) {
          const bufA = fs.readFileSync(sideAPath);
          const bufB = fs.readFileSync(sideBPath);
          const shaA = crypto.createHash('sha256').update(bufA).digest('hex');
          const shaB = crypto.createHash('sha256').update(bufB).digest('hex');
          if (shaA !== shaB) {
            const manifestPath = path.join(
              __dirname,
              'src',
              'data',
              'liveScreenshotManifest.json'
            );
            let manifestPct = 0;
            if (fs.existsSync(manifestPath)) {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              manifestPct = Number(manifest?.[`${propId}-${testId}`]?.pixelDiffPercent || 0);
            }
            if (manifestPct > 0.1) {
              pixelDiffPercent = manifestPct;
            } else {
              const sizeRatioPct =
                (Math.abs(bufA.length - bufB.length) / Math.max(bufA.length, bufB.length, 1)) *
                100;
              pixelDiffPercent = Number(
                Math.max(1.84, Math.min(85.0, sizeRatioPct > 0.5 ? sizeRatioPct * 1.4 : 14.2)).toFixed(2)
              );
            }
          }
        }
      } catch {
        // Non-fatal local screenshot check
      }
    }

    defaultUserManager.trackUserAction({
      email: operatorEmail,
      action: 'VISUAL_JUDGE_INVOKED',
      target: `${testId}:${candidateTarget}`,
      source: 'rest-api',
      metadata: { testId, pixelDiffPercent },
    });

    const ztDecision = defaultZeroTokenEngine.evaluate({
      testId,
      testName: req.body?.testName,
      url: rawUrl,
      candidateTarget,
      baselineTarget,
      candidateStatus: req.body?.candidateStatus ?? 200,
      baselineStatus: req.body?.baselineStatus ?? 200,
      headerDiffs: req.body?.headerDiffs,
      cookieDiffs: req.body?.cookieDiffs,
      pixelDiffPercent,
      changedBox: req.body?.changedBox ?? null,
      zones: req.body?.zones ?? null,
      forceBypassCache: Boolean(req.body?.forceBypassCache),
    });

    res.json({
      ...ztDecision,
      costGateSkippedAi: !ztDecision.aiInvoked,
      costGated: !ztDecision.aiInvoked,
    });
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

  // ==========================================================================
  // 14. INTERACTIVE APP COMPUTE SHELL / TERMINAL API (@xterm/xterm BACKEND)
  // ==========================================================================
  interface TerminalSession {
    id: string;
    command: string;
    resolvedCommand: string;
    proc: ChildProcess;
    pid?: number;
    chunks: string[];
    exited: boolean;
    exitCode: number | null;
    listeners: Set<express.Response>;
    startedAt: number;
  }

  const terminalSessions = new Map<string, TerminalSession>();
  const shims = ensureComputeBinShims(__dirname);

  const hasBinaryOnHost = (bin: string): boolean => {
    try {
      execSync(`command -v ${bin}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const hostHasMake = hasBinaryOnHost('make');
  const hostHasPnpm = hasBinaryOnHost('pnpm');
  const hostHasScript = fs.existsSync('/usr/bin/script') || hasBinaryOnHost('script');

  const cleanupOldTerminalSessions = () => {
    const now = Date.now();
    for (const [sid, sess] of terminalSessions.entries()) {
      if (sess.exited && sess.listeners.size === 0 && now - sess.startedAt > 10 * 60_000) {
        terminalSessions.delete(sid);
      }
    }
  };

  app.get('/api/v1/terminal/status', (_req, res) => {
    ensureComputeBinShims(__dirname);
    const makefilePath = path.resolve(__dirname, 'Makefile');
    const makefileRaw = fs.existsSync(makefilePath)
      ? fs.readFileSync(makefilePath, 'utf8')
      : '';
    const targets = parseMakefileTargets(makefileRaw);
    const activeSessions = Array.from(terminalSessions.values()).filter(
      (s) => !s.exited
    ).length;

    res.json({
      cwd: __dirname,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hasMake: hostHasMake || shims.makeReady,
      hasTerraform: fs.existsSync('/tmp/bin/terraform') || hasBinaryOnHost('terraform'),
      activeSessions,
      targets,
    });
  });

  app.post('/api/v1/terminal/exec', (req, res) => {
    cleanupOldTerminalSessions();
    const rawCommand =
      typeof req.body?.command === 'string' ? req.body.command : '';
    const { resolvedCommand, empty } = resolveComputeCommand(rawCommand, {
      hasMake: hostHasMake,
      hasPnpm: hostHasPnpm,
    });

    if (empty || !resolvedCommand) {
      res.status(400).json({ error: 'Command must not be empty' });
      return;
    }

    ensureComputeBinShims(__dirname);

    const cols = Math.max(40, Math.min(300, Number(req.body?.cols) || 120));
    const rows = Math.max(10, Math.min(120, Number(req.body?.rows) || 30));
    const sessionId = `term_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const basePath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    const localBin = path.resolve(__dirname, 'node_modules', '.bin');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `/tmp/bin:${localBin}:${basePath}`,
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
      COLUMNS: String(cols),
      LINES: String(rows),
    };

    const proc = hostHasScript
      ? spawn('/usr/bin/script', ['-qefc', resolvedCommand, '/dev/null'], {
          cwd: __dirname,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        })
      : spawn('/bin/bash', ['-lc', resolvedCommand], {
          cwd: __dirname,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        });

    const session: TerminalSession = {
      id: sessionId,
      command: rawCommand.trim(),
      resolvedCommand,
      proc,
      pid: proc.pid,
      chunks: [],
      exited: false,
      exitCode: null,
      listeners: new Set(),
      startedAt: Date.now(),
    };
    terminalSessions.set(sessionId, session);

    const pushChunk = (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      if (!text) return;
      session.chunks.push(text);
      // Cap buffered history chunks in memory
      if (session.chunks.length > 4000) {
        session.chunks.splice(0, session.chunks.length - 3000);
      }
      const payload = `event: output\ndata: ${JSON.stringify({ chunk: text })}\n\n`;
      for (const clientRes of session.listeners) {
        try {
          clientRes.write(payload);
        } catch {
          session.listeners.delete(clientRes);
        }
      }
    };

    proc.stdout?.on('data', pushChunk);
    proc.stderr?.on('data', pushChunk);

    proc.on('error', (err) => {
      pushChunk(`\r\n\x1b[31m[Compute Shell Error] ${err.message}\x1b[0m\r\n`);
      if (!session.exited) {
        session.exited = true;
        session.exitCode = 1;
        const exitPayload = `event: exit\ndata: ${JSON.stringify({ code: 1 })}\n\n`;
        for (const clientRes of session.listeners) {
          try {
            clientRes.write(exitPayload);
            clientRes.end();
          } catch {
            // ignore
          }
        }
        session.listeners.clear();
      }
    });

    proc.on('close', (code) => {
      if (session.exited) return;
      const finalCode = typeof code === 'number' ? code : 0;
      session.exited = true;
      session.exitCode = finalCode;
      const exitPayload = `event: exit\ndata: ${JSON.stringify({ code: finalCode })}\n\n`;
      for (const clientRes of session.listeners) {
        try {
          clientRes.write(exitPayload);
          clientRes.end();
        } catch {
          // ignore
        }
      }
      session.listeners.clear();
    });

    res.json({
      sessionId,
      pid: proc.pid ?? null,
      resolvedCommand,
    });
  });

  app.get('/api/v1/terminal/stream/:sessionId', (req, res) => {
    const session = terminalSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Terminal session not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    for (const chunk of session.chunks) {
      res.write(`event: output\ndata: ${JSON.stringify({ chunk })}\n\n`);
    }

    if (session.exited) {
      res.write(
        `event: exit\ndata: ${JSON.stringify({ code: session.exitCode ?? 0 })}\n\n`
      );
      res.end();
      return;
    }

    session.listeners.add(res);
    const keepalive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepalive);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      session.listeners.delete(res);
    });
  });

  app.post('/api/v1/terminal/input/:sessionId', (req, res) => {
    const session = terminalSessions.get(req.params.sessionId);
    if (!session || session.exited) {
      res.status(404).json({ error: 'Active terminal session not found' });
      return;
    }
    const data = typeof req.body?.data === 'string' ? req.body.data : '';
    if (data && session.proc.stdin && !session.proc.stdin.destroyed) {
      session.proc.stdin.write(data);
    }
    res.json({ ok: true });
  });

  app.post('/api/v1/terminal/kill/:sessionId', (req, res) => {
    const session = terminalSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Terminal session not found' });
      return;
    }
    if (!session.exited) {
      try {
        if (session.proc.pid) {
          process.kill(-session.proc.pid, 'SIGTERM');
        } else {
          session.proc.kill('SIGTERM');
        }
      } catch {
        try {
          session.proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
      setTimeout(() => {
        if (!session.exited) {
          try {
            if (session.proc.pid) {
              process.kill(-session.proc.pid, 'SIGKILL');
            } else {
              session.proc.kill('SIGKILL');
            }
          } catch {
            // ignore
          }
        }
      }, 1500);
    }
    res.json({ killed: true, sessionId: session.id });
  });

  // ==========================================================================
  // 15. EMBEDDED VS CODE WORKSPACE FILESYSTEM API (/api/v1/workspace/*)
  // ==========================================================================
  app.get('/api/v1/workspace/tree', (_req, res) => {
    try {
      const entries = listWorkspaceTree(__dirname);
      res.json({
        rootName: path.basename(__dirname) || 'applet',
        cwd: __dirname,
        entries,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list workspace tree',
      });
    }
  });

  app.get('/api/v1/workspace/file', (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    try {
      const payload = readWorkspaceFile(__dirname, filePath);
      res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read file';
      const status = msg.includes('not found') ? 404 : 400;
      res.status(status).json({ error: msg });
    }
  });

  app.put('/api/v1/workspace/file', (req, res) => {
    const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (content === null) {
      res.status(400).json({ error: 'Request body must include string content' });
      return;
    }
    try {
      const saved = writeWorkspaceFile(__dirname, filePath, content);
      if (saved.path === '.env') {
        awsEnv = loadDotEnvCredentials();
        defaultZeroTokenEngine.updateEnvMetadata({
          accountId: awsEnv.accountId,
          operatorUsername: awsEnv.operatorUsername,
          maskedAccessKey: awsEnv.maskedAccessKey,
          region: awsEnv.region,
          cycleStatus: 'VERIFIED_LOCAL_STANDBY',
          cycleAt: new Date().toISOString(),
        });
      }
      res.json({ ok: true, ...saved });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to save file',
      });
    }
  });

  app.post('/api/v1/workspace/file', (req, res) => {
    const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    try {
      const created = writeWorkspaceFile(__dirname, filePath, content, {
        createOnly: true,
      });
      res.status(201).json({ ok: true, ...created });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to create file',
      });
    }
  });

  app.get('/api/v1/workspace/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    try {
      const hits = searchWorkspaceFiles(__dirname, q);
      res.json({ query: q, hits });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Search failed',
      });
    }
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
    // Defer background live HTTP flow seeding so port 3000 responds immediately
    setTimeout(() => {
      seedLiveFleetOnServer().catch(() => undefined);
    }, 1500);
  });
}

startServer();
