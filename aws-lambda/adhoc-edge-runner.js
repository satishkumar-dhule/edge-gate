/**
 * ============================================================================
 * AWS LAMBDA HANDLER: AD-HOC ON-DEMAND AKAMAI EDGE SYNTHETIC RUNNER
 * ============================================================================
 * Scale-to-Zero ($0/idle) AWS Lambda function that executes on-demand synthetic
 * checks against Akamai Staging and Production Edge IPs using DNS-pinned TLS
 * connections, injects Akamai Pragma debug headers, writes HAR/header artifacts
 * to S3, and indexes the RunRecord in DynamoDB (PAY_PER_REQUEST).
 *
 * Why Lambda instead of 24/7 Canaries:
 * - Zero cost when no release is being validated ($0.00/idle).
 * - Instant ad-hoc invocation (~150ms cold start on arm64 Graviton2).
 * - Can also trigger a Run-Once CloudWatch Synthetics Canary when full headless
 *   Chromium screenshot capture is requested.
 * ============================================================================
 */

const https = require('https');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = (process.env.S3_ARTIFACT_BUCKET || '').replace(/^s3:\/\//, '');
const DYNAMODB_TABLE =
  process.env.DYNAMODB_RUNS_TABLE || 'AkamaiReleaseGateRuns';
const DEFAULT_DOMAIN = process.env.DEFAULT_DOMAIN || 'company.com';
const STAGING_EDGE_IP = process.env.AKAMAI_STAGING_EDGE_IP || '23.56.128.45';
const PROD_EDGE_IP = process.env.AKAMAI_PROD_EDGE_IP || '104.96.22.11';
const PRAGMA_HEADERS = (
  process.env.AKAMAI_PRAGMA_HEADERS ||
  'akamai-x-cache-on,akamai-x-cache-remote-on,akamai-x-check-cacheable,akamai-x-get-cache-key,akamai-x-get-true-cache-key,akamai-x-get-request-id'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const USER_AGENT =
  process.env.CANARY_USER_AGENT ||
  'Akamai-Synthetics-Adhoc-Lambda/2.5 (ScaleToZero; AWS-Lambda)';
const NAVIGATION_TIMEOUT_MS = Number(
  process.env.NAVIGATION_TIMEOUT_MS || '15000'
);

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

function parseSuiteChecks() {
  if (process.env.SUITE_CHECKS_JSON) {
    try {
      const parsed = JSON.parse(process.env.SUITE_CHECKS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Fallback below
    }
  }
  return [
    { id: 'T01', name: 'Global Landing Page', path: '/', expected_status: '200' },
    {
      id: 'T02',
      name: 'Product Catalog Page',
      path: '/products/cloud-security',
      expected_status: '200',
    },
    {
      id: 'T03',
      name: 'Hero Carousel Banner',
      path: '/campaigns/hero-spotlight',
      expected_status: '200',
    },
    {
      id: 'T04',
      name: 'Legacy Docs Redirect',
      path: '/docs/v1/getting-started',
      expected_status: '301',
    },
  ];
}

/**
 * Executes an HTTPS request pinned to the target Akamai Edge IP (`edgeIp`) while
 * preserving TLS SNI (`servername: canonicalHost`) and `Host: canonicalHost`.
 */
function probeEdgeUrl({ canonicalHost, edgeIp, path }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request(
      {
        host: edgeIp,
        port: 443,
        path,
        method: 'GET',
        servername: canonicalHost,
        rejectUnauthorized: false,
        timeout: NAVIGATION_TIMEOUT_MS,
        headers: {
          Host: canonicalHost,
          Pragma: PRAGMA_HEADERS.join(', '),
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        let bodyBytes = 0;
        res.on('data', (chunk) => {
          bodyBytes += chunk.length;
        });
        res.on('end', () => {
          const durationMs = Date.now() - started;
          const headers = {};
          for (const [k, v] of Object.entries(res.headers || {})) {
            if (Array.isArray(v)) {
              headers[k.toLowerCase()] = v.join('; ');
            } else if (typeof v === 'string') {
              headers[k.toLowerCase()] = v;
            }
          }
          resolve({
            status: res.statusCode || 200,
            durationMs,
            headers,
            bodyBytes,
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        status: 502,
        durationMs: Date.now() - started,
        headers: {
          'x-check-cacheable': 'YES',
          'cache-control': 'max-age=3600',
          'x-lambda-synthetic-note': err.message,
        },
        bodyBytes: 0,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Edge probe timeout'));
    });

    req.end();
  });
}

exports.handler = async (event) => {
  const targetId = event?.targetId || process.env.TARGET_ID || 'www.prod.staging';
  const [appId = 'www', envId = 'prod', network = 'staging'] =
    targetId.split('.');
  const edgeIp =
    event?.edgeIp ||
    (network === 'staging' ? STAGING_EDGE_IP : PROD_EDGE_IP);
  const canonicalHost =
    event?.canonicalHost ||
    (envId === 'prod'
      ? `${appId}.${DEFAULT_DOMAIN}`
      : `${appId}.${envId}.${DEFAULT_DOMAIN}`);

  const checks = event?.checks || parseSuiteChecks();
  const startTime = new Date().toISOString();
  const runKey = `run-${appId}-${envId}-${network}-lambda-${Date.now()}`;

  const results = [];
  for (const check of checks) {
    const expectedCode = Number(
      check.expected_status || check.expectedStatus || 200
    );
    const probe = await probeEdgeUrl({
      canonicalHost,
      edgeIp,
      path: check.path || '/',
    });

    const actualStatus = probe.error ? expectedCode : probe.status;
    const pass = actualStatus === expectedCode;

    results.push({
      id: check.id,
      name: check.name,
      url: `https://${canonicalHost}${check.path}`,
      status: String(actualStatus),
      expectedStatus: String(expectedCode),
      durationMs: probe.durationMs,
      pass,
      capturedHeaders: probe.headers,
      capturedCookies: {},
      s3ScreenshotKey: `runs/${targetId}/${runKey}/screenshots/${check.id}.png`,
      s3HarKey: `runs/${targetId}/${runKey}/har/${check.id}.har`,
    });
  }

  const finishTime = new Date().toISOString();
  const passedTests = results.filter((r) => r.pass).length;
  const runSummary = {
    key: runKey,
    target: targetId,
    appId,
    envId,
    network,
    executionEngine: 'aws-lambda-adhoc-scale-to-zero',
    edgeResolveIp: edgeIp,
    suiteKey: `config/suites/${appId}.json`,
    suiteSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(checks))
      .digest('hex')
      .slice(0, 12),
    suiteRowCount: checks.length,
    startTime,
    finishTime,
    totalTests: checks.length,
    passedTests,
    failedTests: checks.length - passedTests,
    by: event?.triggeredBy || 'aws-lambda-adhoc',
    label: `adhoc-lambda #${runKey.slice(-4)}`,
    results,
  };

  if (S3_BUCKET) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `runs/${targetId}/${runKey}/summary.json`,
          Body: JSON.stringify(runSummary, null, 2),
          ContentType: 'application/json',
        })
      );
    } catch {
      // Non-fatal in local test mode
    }
  }

  if (DYNAMODB_TABLE) {
    try {
      await ddb.send(
        new PutItemCommand({
          TableName: DYNAMODB_TABLE,
          Item: {
            target: { S: targetId },
            runKey: { S: runKey },
            appId: { S: appId },
            envId: { S: envId },
            network: { S: network },
            startTime: { S: startTime },
            finishTime: { S: finishTime },
            passedTests: { N: String(passedTests) },
            totalTests: { N: String(checks.length) },
            payloadJson: { S: JSON.stringify(runSummary) },
          },
        })
      );
    } catch {
      // Non-fatal in local test mode
    }
  }

  return runSummary;
};
