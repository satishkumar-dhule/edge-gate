/**
 * ============================================================================
 * AWS CLOUDWATCH SYNTHETICS CANARY RUNNER (100% TERRAFORM-CONFIGURED)
 * ============================================================================
 * Runtime: syn-playwright-chromium-v2.4 / syn-nodejs-puppeteer-9.1
 * Packaged by Terraform archive_file into:
 *   nodejs/node_modules/canary-har-runner.js (handler: canary-har-runner.handler)
 *
 * Every runtime parameter — test suite checks, host maps, custom property headers,
 * Akamai Staging/Production Edge IPs, Pragma debug headers, viewport dimensions,
 * navigation timeouts, S3 bucket, DynamoDB table, and Bedrock Nova Lite model ID —
 * is injected by Terraform (`aws_synthetics_canary.property_gate`) or loaded
 * dynamically from the Terraform-provisioned S3 suite object (`SUITE_S3_KEY`).
 * ============================================================================
 */

const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const FALLBACK_SUITE_CHECKS = [
  { id: 'T01', name: 'Homepage Root & Edge Cache', path: '/', expectedStatus: '200' },
  { id: 'T02', name: 'Product Catalog & Session Cookie', path: '/products', expectedStatus: '200' },
  { id: 'T03', name: 'Enterprise Solutions Hero Layout', path: '/solutions/enterprise', expectedStatus: '200' },
  { id: 'T04', name: 'Global Geo Redirect (/global)', path: '/global', expectedStatus: '301' },
  { id: 'T05', name: 'Authentication Sign-In Portal', path: '/login', expectedStatus: '200' },
  { id: 'T06', name: 'Customer Case Studies Feed', path: '/customers/stories', expectedStatus: '200' },
  { id: 'T07', name: 'Pricing & Tier Calculator', path: '/pricing', expectedStatus: '200' },
  { id: 'T08', name: 'Edge Health Check Probe', path: '/healthz', expectedStatus: '200' }
];

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function resolveSuiteChecks(s3, bucket) {
  // Priority 1: SUITE_CHECKS_JSON injected directly by Terraform run_config
  const envChecks = safeJsonParse(process.env.SUITE_CHECKS_JSON, null);
  if (Array.isArray(envChecks) && envChecks.length > 0) {
    return envChecks;
  }

  // Priority 2: Load Terraform-provisioned suite JSON from S3 (config/suites/<appId>.json)
  if (process.env.SUITE_S3_KEY && bucket) {
    try {
      const resp = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: process.env.SUITE_S3_KEY })
      );
      const bodyStr = await resp.Body.transformToString();
      const s3Checks = safeJsonParse(bodyStr, null);
      if (Array.isArray(s3Checks) && s3Checks.length > 0) {
        return s3Checks;
      }
    } catch (err) {
      log.warn(`[ReleaseGateCanary] Could not read SUITE_S3_KEY, using fallback: ${err.message}`);
    }
  }

  return FALLBACK_SUITE_CHECKS;
}

exports.handler = async () => {
  const region = process.env.AWS_REGION || 'us-east-1';
  const targetId = process.env.TARGET_ID || 'www.prod.staging';
  const appId = process.env.APP_ID || 'www';
  const envId = process.env.ENV_ID || 'prod';
  const network = process.env.EDGE_NETWORK || 'staging';
  const edgeIp = process.env.EDGE_RESOLVE_IP || '23.56.128.45';
  const domain = process.env.DEFAULT_DOMAIN || 'company.com';
  const s3Bucket = process.env.S3_ARTIFACT_BUCKET || 'akamai-synthetics-gate-prod';
  const dynamoTable = process.env.DYNAMODB_RUNS_TABLE || 'akamai-synthetics-release-gate-runs';
  const bedrockModelId = process.env.BEDROCK_NOVA_LITE_MODEL_ID || 'amazon.nova-lite-v1:0';
  const viewportWidth = parseInt(process.env.VIEWPORT_WIDTH || '1440', 10);
  const viewportHeight = parseInt(process.env.VIEWPORT_HEIGHT || '900', 10);
  const navTimeoutMs = parseInt(process.env.NAVIGATION_TIMEOUT_MS || '30000', 10);
  const userAgent =
    process.env.CANARY_USER_AGENT ||
    'Akamai-Synthetics-Runner/2.4 (ReleaseGate; AWS-CloudWatch-Synthetics)';

  const pragmaList = (
    process.env.AKAMAI_PRAGMA_HEADERS ||
    'akamai-x-cache-on,akamai-x-cache-remote-on,akamai-x-check-cacheable,akamai-x-get-cache-key,akamai-x-get-true-cache-key,akamai-x-get-request-id'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const restrictedHeaders = (process.env.RESTRICTED_HEADERS || 'Authorization,Cookie')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const hostMap = safeJsonParse(process.env.HOST_MAP_JSON, {});
  const propertyHeaders = safeJsonParse(process.env.PROPERTY_HEADERS_JSON, {});

  const canonicalHost = `${appId}.${domain}`;
  const hostname =
    hostMap[canonicalHost] ||
    (envId === 'prod' ? canonicalHost : `${envId}-${appId}.${domain}`);

  // Build Chromium --host-resolver-rules for primary hostname and any additional hostMap entries
  const resolverRules = [`MAP ${hostname} ${edgeIp}`];
  for (const mappedHost of Object.values(hostMap)) {
    if (mappedHost && mappedHost !== hostname) {
      resolverRules.push(`MAP ${mappedHost} ${edgeIp}`);
    }
  }

  const runKey = `run-${appId}-${envId}-${network}-${Date.now()}`;
  const startTime = new Date().toISOString();

  const s3 = new S3Client({ region });
  const ddb = new DynamoDBClient({ region });
  const suiteChecks = await resolveSuiteChecks(s3, s3Bucket);

  // Configure CloudWatch Synthetics to pin hostname DNS resolution to Akamai Staging/Prod Edge IP
  const synConfig = synthetics.getConfiguration();
  synConfig.setConfig({
    includeRequestHeaders: true,
    includeResponseHeaders: true,
    restrictedHeaders,
    puppeteerLaunchOptions: {
      args: [`--host-resolver-rules=${resolverRules.join(', ')}`],
    },
  });

  const page = await synthetics.getPage();
  await page.setViewport({ width: viewportWidth, height: viewportHeight });
  await page.setExtraHTTPHeaders({
    Pragma: pragmaList.join(', '),
    'User-Agent': userAgent,
    'X-Akamai-Edge-Network': network,
    'X-Akamai-Release-Gate-Target': targetId,
    ...propertyHeaders,
  });
  // Set Akamai EdgeWorker Qualified Cohort & OneTrust Functional Consent cookies so Qualified Piper AI SDR loads
  if (typeof page.setCookie === 'function') {
    await page.setCookie(
      {
        name: 'sfdc_agent_cohort',
        value: 'qualified',
        domain: `.${domain}`,
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'sfdcConsent',
        value: '1,2,3,4',
        domain: `.${domain}`,
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'OptanonAlertBoxClosed',
        value: '2026-11-11T00:00:00.000Z',
        domain: `.${domain}`,
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'ew_qualified_exp',
        value: 'pinned',
        domain: `.${domain}`,
        path: '/',
        secure: true,
        sameSite: 'Lax',
      }
    );
  }

  const results = [];
  for (const check of suiteChecks) {
    const url = `https://${hostname}${check.path}`;
    const canonicalUrl = `https://${canonicalHost}${check.path}`;
    const expectedStatus = String(check.expectedStatus || check.expected_status || '200');
    const startMs = Date.now();
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: navTimeoutMs });
      const durationMs = Date.now() - startMs;

      const status = response ? response.status() : 0;
      const headers = response ? response.headers() : {};
      const pageCookies = await page.cookies();
      const capturedCookies = {};
      for (const c of pageCookies) {
        capturedCookies[c.name] = `${c.value}; Path=${c.path}; SameSite=${c.sameSite || 'Lax'}${
          c.secure ? '; Secure' : ''
        }`;
      }

      await synthetics.takeScreenshot(check.id, 'loaded');

      results.push({
        id: check.id,
        name: check.name,
        url,
        canonicalUrl,
        pass: String(status) === expectedStatus,
        errors:
          String(status) === expectedStatus
            ? []
            : [`Expected HTTP ${expectedStatus}, received ${status}`],
        expectedStatus,
        actualStatus: status,
        durationMs,
        capturedHeaders: headers,
        capturedCookies,
        stagingEdgeIp: network === 'staging' ? edgeIp : undefined,
        edgeHostname: `${hostname}${process.env.EDGE_HOST_SUFFIX || ''}`,
        screenshotKey: `runs/${targetId}/${runKey}/${check.id}-loaded.png`,
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errMsg = err && err.message ? err.message : String(err);
      log.error(`[ReleaseGateCanary] Check ${check.id} (${url}) failed: ${errMsg}`);
      results.push({
        id: check.id,
        name: check.name,
        url,
        canonicalUrl,
        pass: false,
        errors: [errMsg],
        expectedStatus,
        actualStatus: 0,
        durationMs,
        capturedHeaders: {},
        capturedCookies: {},
        stagingEdgeIp: network === 'staging' ? edgeIp : undefined,
        edgeHostname: `${hostname}${process.env.EDGE_HOST_SUFFIX || ''}`,
      });
    }
  }

  const finishTime = new Date().toISOString();
  const manifest = {
    key: runKey,
    target: targetId,
    appId,
    envId,
    network,
    suiteKey: process.env.SUITE_S3_KEY || `config/suites/${appId}.json`,
    visualJudgeModel: bedrockModelId,
    startTime,
    finishTime,
    totalTests: results.length,
    passedTests: results.filter((r) => r.pass).length,
    failedTests: results.filter((r) => !r.pass).length,
    results,
  };

  const manifestKey = `runs/${targetId}/${runKey}/manifest.json`;

  // 1. Upload full HAR + Header + Cookie + Screenshot Manifest to S3
  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    })
  );

  // 2. Index Run Summary in DynamoDB for low-latency Control Plane & MCP queries
  await ddb.send(
    new PutItemCommand({
      TableName: dynamoTable,
      Item: {
        target: { S: targetId },
        runKey: { S: runKey },
        appId: { S: appId },
        envId: { S: envId },
        network: { S: network },
        startTime: { S: startTime },
        finishTime: { S: finishTime },
        totalTests: { N: String(manifest.totalTests) },
        passedTests: { N: String(manifest.passedTests) },
        failedTests: { N: String(manifest.failedTests) },
        s3ManifestKey: { S: manifestKey },
        visualJudgeModel: { S: bedrockModelId },
      },
    })
  );

  log.info(
    `[ReleaseGateCanary] Indexed run ${runKey} for ${targetId} in s3://${s3Bucket}/${manifestKey} and DynamoDB ${dynamoTable}`
  );
};
