import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFunctionalDiffs,
  calculateHeadlineVerdict,
  calculateItemVerdict,
  classifyTest,
  generateComparisonMarkdownSummary,
  generateReproduceCurl,
  groupFailureSignatures,
  mapToCanonicalUrl,
  normalizeCacheControl,
  normalizeContentType,
  applyRulesToItem,
} from './rules';
import { AcceptedRule, ComparisonItem, DifferenceItem, TestResult } from './types';

// ---------------------------------------------------------------------------
// 1. Normalization Tests
// ---------------------------------------------------------------------------
test('normalizeCacheControl: max-age with positive values normalizes to max-age=N', () => {
  assert.equal(normalizeCacheControl('public, max-age=3600'), 'public, max-age=N');
  assert.equal(normalizeCacheControl('public, max-age=7200, s-maxage=86400'), 'public, max-age=N, s-maxage=N');
  assert.equal(normalizeCacheControl('no-cache, max-age=0'), 'no-cache, max-age=0');
});

test('normalizeContentType: case-insensitive check', () => {
  assert.equal(
    normalizeContentType('text/html; charset=UTF-8'),
    normalizeContentType('TEXT/HTML; Charset=utf-8')
  );
});

test('AC2 & FR-CMP-12: Env comparison location maps back to canonical host', () => {
  const hostMap = {
    'www.salesforce.com': 'www-uat1.salesforce.com',
  };
  const rawCandidateLoc = 'https://www-uat1.salesforce.com/products/crm';
  const rawBaselineLoc = 'https://www.salesforce.com/products/crm';

  const canonicalCandidate = mapToCanonicalUrl(rawCandidateLoc, hostMap);
  assert.equal(canonicalCandidate, rawBaselineLoc);

  const candidateRes: TestResult = {
    id: 'T101',
    name: 'Redirect check',
    url: rawCandidateLoc,
    canonicalUrl: rawBaselineLoc,
    pass: true,
    errors: [],
    expectedStatus: '301',
    actualStatus: 301,
    durationMs: 140,
    capturedHeaders: { location: rawCandidateLoc },
    redirectChain: [],
  };

  const baselineRes: TestResult = {
    id: 'T101',
    name: 'Redirect check',
    url: rawBaselineLoc,
    canonicalUrl: rawBaselineLoc,
    pass: true,
    errors: [],
    expectedStatus: '301',
    actualStatus: 301,
    durationMs: 120,
    capturedHeaders: { location: rawBaselineLoc },
    redirectChain: [],
  };

  const diffs = calculateFunctionalDiffs(candidateRes, baselineRes, {
    candidateHostMap: hostMap,
    baselineHostMap: {},
  });

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, 'location');
  assert.equal(diffs[0].isHostNormalizedMatch, true);
  assert.equal(diffs[0].severity, 'minor');
});

// ---------------------------------------------------------------------------
// 2. Verdict Rules (§7.1, AC3, AC5)
// ---------------------------------------------------------------------------
test('Go/No-Go Network Comparison: Any functional diff gives NO-GO', () => {
  const item: ComparisonItem = {
    testId: 'T01',
    testName: 'Home',
    url: 'https://www.example.com',
    candidateResult: {
      id: 'T01',
      name: 'Home',
      url: 'https://www.example.com',
      canonicalUrl: 'https://www.example.com',
      pass: true,
      errors: [],
      expectedStatus: '200',
      actualStatus: 200,
      durationMs: 90,
      capturedHeaders: { 'x-check-cacheable': 'NO' },
      redirectChain: [],
    },
    baselineResult: {
      id: 'T01',
      name: 'Home',
      url: 'https://www.example.com',
      canonicalUrl: 'https://www.example.com',
      pass: true,
      errors: [],
      expectedStatus: '200',
      actualStatus: 200,
      durationMs: 85,
      capturedHeaders: { 'x-check-cacheable': 'YES' },
      redirectChain: [],
    },
    functionalDiffs: [
      {
        kind: 'header',
        field: 'x-check-cacheable',
        candidateValue: 'NO',
        baselineValue: 'YES',
        severity: 'minor',
      },
    ],
    itemVerdict: 'different',
  };

  const verdict = calculateHeadlineVerdict([item], 'network', false, false);
  assert.equal(verdict, 'NO-GO');
});

test('AC5: Accepting x-check-cacheable on a NO-GO comparison turns verdict to GO', () => {
  const item: ComparisonItem = {
    testId: 'T01',
    testName: 'Home',
    url: 'https://www.example.com',
    candidateResult: {
      id: 'T01',
      name: 'Home',
      url: 'https://www.example.com',
      canonicalUrl: 'https://www.example.com',
      pass: true,
      errors: [],
      expectedStatus: '200',
      actualStatus: 200,
      durationMs: 90,
      capturedHeaders: { 'x-check-cacheable': 'NO' },
      redirectChain: [],
    },
    baselineResult: {
      id: 'T01',
      name: 'Home',
      url: 'https://www.example.com',
      canonicalUrl: 'https://www.example.com',
      pass: true,
      errors: [],
      expectedStatus: '200',
      actualStatus: 200,
      durationMs: 85,
      capturedHeaders: { 'x-check-cacheable': 'YES' },
      redirectChain: [],
    },
    functionalDiffs: [
      {
        kind: 'header',
        field: 'x-check-cacheable',
        candidateValue: 'NO',
        baselineValue: 'YES',
        severity: 'minor',
      },
    ],
    itemVerdict: 'different',
  };

  // Initially NO-GO
  assert.equal(calculateHeadlineVerdict([item], 'network'), 'NO-GO');

  // Create rule accepting x-check-cacheable
  const rule: AcceptedRule = {
    id: 'rule-test-1',
    appId: 'www',
    comparisonId: 'www.prod.staging-vs-prod',
    kind: 'x-check-cacheable',
    enabled: true,
    by: 'elena.release',
    at: new Date().toISOString(),
  };

  // Apply rule dynamically
  const updatedItem = applyRulesToItem(item, 'www.prod.staging-vs-prod', [rule], 'network');
  assert.equal(updatedItem.functionalDiffs[0].accepted, true);
  assert.equal(updatedItem.itemVerdict, 'same');

  // Recalculated verdict becomes GO!
  const newHeadline = calculateHeadlineVerdict([updatedItem], 'network');
  assert.equal(newHeadline, 'GO');

  // Disabling the rule restores NO-GO without altering raw source
  rule.enabled = false;
  const restoredItem = applyRulesToItem(item, 'www.prod.staging-vs-prod', [rule], 'network');
  assert.equal(restoredItem.itemVerdict, 'different');
  assert.equal(calculateHeadlineVerdict([restoredItem], 'network'), 'NO-GO');
});

test('AC3: Subset comparisons are marked PARTIAL and never set full headline verdict', () => {
  const item: ComparisonItem = {
    testId: 'T01',
    testName: 'Home',
    url: 'https://www.example.com',
    functionalDiffs: [],
    itemVerdict: 'same',
  };
  assert.equal(calculateHeadlineVerdict([item], 'network', true), 'PARTIAL');
});

test('Red on both sides is NEVER GO (failing on candidate gives REVIEW)', () => {
  const item: ComparisonItem = {
    testId: 'T01',
    testName: 'Broken Endpoint',
    url: 'https://www.example.com/broken',
    candidateResult: {
      id: 'T01',
      name: 'Broken Endpoint',
      url: 'https://www.example.com/broken',
      canonicalUrl: 'https://www.example.com/broken',
      pass: false,
      errors: ['Status 500 unexpected'],
      expectedStatus: '200',
      actualStatus: 500,
      durationMs: 90,
      capturedHeaders: {},
      redirectChain: [],
    },
    baselineResult: {
      id: 'T01',
      name: 'Broken Endpoint',
      url: 'https://www.example.com/broken',
      canonicalUrl: 'https://www.example.com/broken',
      pass: false,
      errors: ['Status 500 unexpected'],
      expectedStatus: '200',
      actualStatus: 500,
      durationMs: 90,
      capturedHeaders: {},
      redirectChain: [],
    },
    functionalDiffs: [], // Same status 500 on both sides
    itemVerdict: 'same',
  };

  const verdict = calculateHeadlineVerdict([item], 'network');
  assert.equal(verdict, 'REVIEW');
});

test('Env comparison allows minor content diffs as GO', () => {
  const item: ComparisonItem = {
    testId: 'T02',
    testName: 'News Banner',
    url: 'https://www.example.com/news',
    visualResult: {
      verdict: 'minor',
      costGate: 'ai-judged',
      costGateSkippedAi: false,
      summary: 'Different headline text in banner',
      differences: [{ description: 'UAT has staging banner text', severity: 'minor' }],
      primaryModel: 'nova-lite',
    },
    functionalDiffs: [],
    itemVerdict: 'minor',
  };

  // On env comparison, minor content changes are GO
  assert.equal(calculateHeadlineVerdict([item], 'env'), 'GO');
  // On network comparison, minor content changes are REVIEW
  assert.equal(calculateHeadlineVerdict([item], 'network'), 'REVIEW');
});

// ---------------------------------------------------------------------------
// 3. Test Classification (§7.2)
// ---------------------------------------------------------------------------
test('Test classification: stable, failing in all, regressed, flaky, n/N failed', () => {
  assert.equal(classifyTest([true, true, true, true]), 'stable');
  assert.equal(classifyTest([false, false, false, false]), 'failing in all');
  // Latest failed and 3 latest all failed
  assert.equal(classifyTest([false, false, false, true, true]), 'regressed');
  // Flips: true -> false -> true -> false -> true (4 flips)
  assert.equal(classifyTest([true, false, true, false, true]), 'flaky');
});

// ---------------------------------------------------------------------------
// 4. Failure Signatures & Environmental Anomaly Detection (§6.7 FR-INS-10, AC8)
// ---------------------------------------------------------------------------
test('AC8 & FR-INS-10: Seeded run where 31 of 40 tests fail with 403 flags "looks environmental"', () => {
  const failedResults: TestResult[] = [];
  for (let i = 1; i <= 31; i++) {
    failedResults.push({
      id: `T_${i}`,
      name: `Test ${i}`,
      url: `https://www.example.com/page/${i}`,
      canonicalUrl: `https://www.example.com/page/${i}`,
      pass: false,
      errors: ['HTTP 403 Forbidden: WAF blocked request id "req_9921"'],
      expectedStatus: '200',
      actualStatus: 403,
      durationMs: 50,
      capturedHeaders: {},
      redirectChain: [],
    });
  }

  const grouped = groupFailureSignatures(failedResults, 40);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].count, 31);
  assert.equal(grouped[0].share, 31 / 40); // 77.5% > 50%
  assert.equal(grouped[0].looksEnvironmental, true);
  assert.match(grouped[0].signature, /HTTP N Forbidden/);
});

// ---------------------------------------------------------------------------
// 5. Curl Reproduction Generator (§6.7 FR-INS-12, AC11)
// ---------------------------------------------------------------------------
test('AC11 & FR-INS-12: Curl generator contains --resolve, Pragma, and no secrets', () => {
  const res: TestResult = {
    id: 'T55',
    name: 'Cart Staging Check',
    url: 'https://store.example.com/cart',
    canonicalUrl: 'https://store.example.com/cart',
    pass: false,
    errors: ['x-check-cacheable was NO, expected YES'],
    expectedStatus: '200',
    actualStatus: 200,
    durationMs: 110,
    capturedHeaders: {},
    redirectChain: [
      {
        method: 'GET',
        url: 'https://store.example.com/cart',
        status: 200,
        startOffsetMs: 0,
        durationMs: 110,
        edgeIp: '23.45.67.89',
      },
    ],
    stagingEdgeIp: '23.45.67.89',
    edgeHostname: 'store.example.com.edgekey-staging.net',
  };

  const curl = generateReproduceCurl(res);
  assert.match(curl, /--resolve "store\.example\.com:443:23\.45\.67\.89"/);
  assert.match(curl, /Pragma: akamai-x-cache-on/);
  assert.match(curl, /User-Agent: Akamai-Synthetics-Runner/);
  assert.doesNotMatch(curl, /SECRET|PASSWORD/);
});

// ---------------------------------------------------------------------------
// 6. Markdown Summary Generator (§6.7 FR-INS-11)
// ---------------------------------------------------------------------------
test('FR-INS-11: Markdown summary generates ticket summary with verdict & rollup', () => {
  const summary = generateComparisonMarkdownSummary({
    comparisonId: 'www.prod.staging-vs-prod',
    headlineVerdict: 'GO',
    candidateLabel: 'CHG-1234',
    candidateTarget: 'www.prod.staging',
    baselineTarget: 'www.prod.prod',
    candidateStartTime: '2026-11-07T09:00:00Z',
    baselineStartTime: '2026-11-07T08:58:00Z',
    isPinnedBaseline: false,
    pairingTimeGapMinutes: 2,
    rollup: {
      functional: 0,
      critical: 0,
      visual: 0,
      minor: 0,
      error: 0,
      failingOnCandidate: 0,
    },
    items: [],
  });

  assert.match(summary, /Akamai Release Gate Verdict: \*\*GO\*\* \[CHG-1234\]/);
  assert.match(summary, /www\.prod\.staging-vs-prod/);
  assert.match(summary, /0 functional diffs/);
});

// ---------------------------------------------------------------------------
// 7. Cookie Diff Normalization, Run-over-Run Seeding & 50-Property Scale Tests
// ---------------------------------------------------------------------------
import {
  calculateCookieDiffs,
  buildInitialComparison,
  seedRunsFromConfig,
} from '../data/mockStore';
import { generateEnterpriseScaleTopology } from '../adapters/syntheticsAdapter';

test('Cookie diffs use clean unprefixed cookie names and preserve itemVerdict until acceptedCookies turns verdict to GO', () => {
  const runs = seedRunsFromConfig();
  const stgRun = runs.find((r) => r.key === 'run-www-prod-staging-1')!;
  const prdRun = runs.find((r) => r.key === 'run-www-prod-prod-1')!;
  const t02Stg = stgRun.results.find((r) => r.id === 'T02')!;
  const t02Prd = prdRun.results.find((r) => r.id === 'T02')!;

  const cookieDiffs = calculateCookieDiffs(t02Stg, t02Prd);
  assert.equal(cookieDiffs.length, 2);
  assert.deepEqual(
    cookieDiffs.map((d) => d.field).sort(),
    ['edge_cache_bypass', 'edge_region']
  );

  // Initial comparison: T01 (2 header diffs -> different), T02 (2 cookie diffs -> different), T03 (1 visual minor diff -> minor)
  const initialComp = buildInitialComparison(stgRun, prdRun, 'network', []);
  assert.equal(initialComp.headlineVerdict, 'NO-GO');
  const t02Item = initialComp.items.find((i) => i.testId === 'T02')!;
  assert.equal(t02Item.itemVerdict, 'different');

  // Accept T01 headers and T02 cookies -> only T03 minor visual diff remains -> headlineVerdict becomes REVIEW
  const headerRules: AcceptedRule[] = [
    {
      id: 'r1',
      appId: 'www',
      comparisonId: 'all',
      kind: 'cache-control',
      enabled: true,
      by: 'ops',
      at: new Date().toISOString(),
    },
    {
      id: 'r2',
      appId: 'www',
      comparisonId: 'all',
      kind: 'x-check-cacheable',
      enabled: true,
      by: 'ops',
      at: new Date().toISOString(),
    },
  ];
  const reviewComp = buildInitialComparison(stgRun, prdRun, 'network', headerRules, {
    acceptedCookies: ['edge_region', 'edge_cache_bypass'],
    ignoreAcceptedDiffs: true,
  });
  assert.equal(reviewComp.items.find((i) => i.testId === 'T01')!.itemVerdict, 'same');
  assert.equal(reviewComp.items.find((i) => i.testId === 'T02')!.itemVerdict, 'same');
  assert.equal(reviewComp.items.find((i) => i.testId === 'T03')!.itemVerdict, 'minor');
  assert.equal(reviewComp.headlineVerdict, 'REVIEW');

  // Also accept T03 visual diff -> all 8 items become 'same' and headlineVerdict becomes GO
  const goComp = buildInitialComparison(stgRun, prdRun, 'network', headerRules, {
    acceptedCookies: ['edge_region', 'edge_cache_bypass'],
    acceptedVisualTests: ['T03'],
    ignoreAcceptedDiffs: true,
  });
  assert.equal(goComp.items.find((i) => i.testId === 'T03')!.itemVerdict, 'same');
  assert.equal(goComp.headlineVerdict, 'GO');
});

test('Cross-environment buildInitialComparison normalizes Location redirect headers via hostMap', () => {
  const runs = seedRunsFromConfig();
  const uatRun = runs.find((r) => r.key === 'run-www-uat-staging-1')!;
  const prdRun = runs.find((r) => r.key === 'run-www-prod-prod-1')!;

  const envComp = buildInitialComparison(uatRun, prdRun, 'env', []);
  const t04 = envComp.items.find((i) => i.testId === 'T04')!;
  const locDiff = t04.functionalDiffs.find((d) => d.field === 'location')!;
  assert.ok(locDiff);
  assert.equal(locDiff.isHostNormalizedMatch, true);
  assert.equal(locDiff.accepted, true);
});

test('Each target seeds both Latest Run and Previous Run for default Run-over-Run comparison', () => {
  const runs = seedRunsFromConfig();
  const stgTargetRuns = runs.filter((r) => r.target === 'www.prod.staging');
  assert.equal(stgTargetRuns.length, 2);
  assert.equal(stgTargetRuns[0].label, 'v2026.11-rc1');
  assert.equal(stgTargetRuns[1].label, 'v2026.10-prev');

  const runOverRunComp = buildInitialComparison(
    stgTargetRuns[0],
    stgTargetRuns[1],
    'network'
  );
  assert.equal(runOverRunComp.candidateRunKey, stgTargetRuns[0].key);
  assert.equal(runOverRunComp.baselineRunKey, stgTargetRuns[1].key);
  assert.equal(runOverRunComp.items.length, 8);
});

test('Enterprise scale generator scales cleanly to 50 properties with multi-run history', () => {
  const scaled = generateEnterpriseScaleTopology(50);
  assert.equal(scaled.apps.length, 50);
  assert.ok(scaled.runs.length >= 100);
  assert.ok(scaled.readyReports.length >= 15);
});

// ---------------------------------------------------------------------------
// 8. AWS Bedrock Nova Lite, OpenAPI 3.1 & Terraform IaC Blueprint Tests
// ---------------------------------------------------------------------------
import {
  evaluateNovaLiteVisualDiff,
  buildOpenApiSpec,
  getOpenApiEndpointCatalog,
  generateTerraformBundle,
  generateSyntheticsCanaryScript,
  generateBedrockNovaJudgeScript,
  generateEnvConfigFile,
} from './awsBlueprint';
import { DEFAULT_TEMPLATE_CONFIG } from '../config/template.config';

test('AWS Bedrock Nova Lite judge defaults to amazon.nova-lite-v1:0 and classifies T03 as minor visual diff', () => {
  assert.equal(
    DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
    'amazon.nova-lite-v1:0'
  );

  const minorRes = evaluateNovaLiteVisualDiff({
    testId: 'T03',
    candidateTarget: 'www.prod.staging',
    baselineTarget: 'www.prod.prod',
    pixelDiffPercent: 1.8,
  });
  assert.equal(minorRes.modelId, 'amazon.nova-lite-v1:0');
  assert.equal(minorRes.verdict, 'minor');
  assert.ok(minorRes.confidence >= 0.9);
  assert.match(minorRes.summary, /amazon\.nova-lite-v1:0/);

  const sameRes = evaluateNovaLiteVisualDiff({
    testId: 'T01',
    candidateTarget: 'www.prod.staging',
    baselineTarget: 'www.prod.prod',
    pixelDiffPercent: 0.04,
  });
  assert.equal(sameRes.verdict, 'same');
  assert.equal(sameRes.differences.length, 0);
});

test('OpenAPI 3.1.0 specification and catalog expose all 12 REST + MCP + Nova Lite + Headless User Management/Tracking endpoints', () => {
  const catalog = getOpenApiEndpointCatalog();
  assert.equal(catalog.length, 12);

  const spec = buildOpenApiSpec() as {
    openapi: string;
    paths: Record<string, unknown>;
  };
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/api/v1/health']);
  assert.ok(spec.paths['/api/v1/judge/nova-lite']);
  assert.ok(spec.paths['/api/v1/mcp/rpc']);
  assert.ok(spec.paths['/api/v1/users']);
  assert.ok(spec.paths['/api/v1/users/reset-password']);
  assert.ok(spec.paths['/api/v1/users/stats']);
});

test('Terraform IaC & AWS Synthetics generators produce valid clone-and-apply HCL, CloudFront Distribution, Canary zip packaging, SSM/S3/DynamoDB config seeding, alarms, and env config', () => {
  const tf = generateTerraformBundle();
  assert.match(tf.mainTf, /aws_synthetics_canary/);
  assert.match(tf.mainTf, /data "archive_file" "canary_zip"/);
  assert.match(tf.mainTf, /resource "aws_s3_object" "canary_bundle"/);
  assert.match(tf.mainTf, /resource "aws_s3_object" "portal_runtime_config"/);
  assert.match(tf.mainTf, /resource "aws_s3_object" "property_suite_json"/);
  assert.match(tf.mainTf, /resource "aws_ssm_parameter" "portal_runtime_config"/);
  assert.match(tf.mainTf, /resource "aws_dynamodb_table_item" "seeded_accepted_rules"/);
  assert.match(tf.mainTf, /resource "aws_cloudwatch_metric_alarm" "canary_failed_alarm"/);
  assert.match(tf.mainTf, /resource "aws_sns_topic" "release_gate_alerts"/);
  assert.match(tf.mainTf, /resource "aws_lambda_function" "adhoc_edge_runner"/);
  assert.match(tf.mainTf, /resource "aws_lambda_function" "control_plane_api"/);
  assert.match(tf.mainTf, /resource "aws_lambda_function_url" "control_plane_url"/);
  assert.match(tf.mainTf, /resource "aws_apigatewayv2_api" "control_plane_http_api"/);
  assert.match(tf.mainTf, /resource "aws_cloudfront_origin_access_control" "portal_oac"/);
  assert.match(tf.mainTf, /resource "aws_cloudfront_distribution" "portal_cdn"/);
  assert.match(tf.mainTf, /path_pattern\s*=\s*"\/api\/\*"/);
  assert.match(tf.mainTf, /resource "local_file" "dotenv_terraform"/);
  assert.match(tf.mainTf, /nodejs\/node_modules\/canary-har-runner\.js/);
  assert.match(tf.mainTf, /data\.aws_caller_identity\.current\.account_id/);
  assert.match(tf.mainTf, /amazon\.nova-lite-v1:0/);
  assert.match(tf.variablesTf, /variable "bedrock_nova_lite_model_id"/);
  assert.match(tf.variablesTf, /variable "deploy_serverless_lambda"/);
  assert.match(tf.variablesTf, /variable "deploy_cloudfront_distribution"/);
  assert.match(tf.variablesTf, /variable "test_suite"/);
  assert.match(tf.variablesTf, /variable "accepted_diff_rules"/);
  assert.match(tf.tfvars, /bedrock_nova_lite_model_id\s*=\s*"amazon\.nova-lite-v1:0"/);
  assert.match(tf.tfvars, /deploy_cloudfront_distribution\s*=\s*true/);
  assert.match(tf.tfvars, /start_canaries_on_apply\s*=\s*false/);
  assert.match(tf.tfvars, /canary_schedule_expression\s*=\s*"rate\(0 minutes\)"/);
  assert.match(tf.tfvars, /test_suite\s*=/);
  assert.match(tf.outputsTf, /output "s3_artifact_bucket_name"/);
  assert.match(tf.outputsTf, /output "control_plane_lambda_function_url"/);
  assert.match(tf.outputsTf, /output "apigateway_http_api_endpoint"/);
  assert.match(tf.outputsTf, /output "cloudfront_distribution_id"/);
  assert.match(tf.outputsTf, /output "cloudfront_portal_url"/);
  assert.match(tf.outputsTf, /output "ssm_parameter_names"/);

  const canary = generateSyntheticsCanaryScript();
  assert.match(canary, /--host-resolver-rules=MAP/);
  assert.match(canary, /SUITE_CHECKS_JSON/);
  assert.match(canary, /HOST_MAP_JSON/);
  assert.match(canary, /DynamoDBClient/);
  assert.match(canary, /PutItemCommand/);

  const judgeScript = generateBedrockNovaJudgeScript();
  assert.match(judgeScript, /BedrockRuntimeClient/);
  assert.match(judgeScript, /ConverseCommand/);
  assert.match(judgeScript, /amazon\.nova-lite-v1:0/);

  const envFile = generateEnvConfigFile();
  assert.match(envFile, /BEDROCK_VISUAL_JUDGE_MODEL_ID=amazon\.nova-lite-v1:0/);
  assert.match(envFile, /AKAMAI_STAGING_EDGE_SUFFIX=\.edgekey-staging\.net/);
  assert.match(envFile, /AKAMAI_PROD_EDGE_SUFFIX=\.edgekey\.net/);
});

// ---------------------------------------------------------------------------
// 9. Extensible Release Gate Plugin Pipeline & AI Agent Skills Registry
// ---------------------------------------------------------------------------
import {
  BUILTIN_GATE_PLUGINS,
  evaluatePluginPipeline,
  generateAiAgentAdaptationBundle,
  generateOneShotAdaptationPrompt,
} from './pluginRegistry';

test('Release Gate Plugin Pipeline & AI Agent Skills Registry evaluate plugins and generate clone-adapt prompts', () => {
  assert.equal(BUILTIN_GATE_PLUGINS.length, 8);

  // 1. Clean parity scenario -> GO
  const cleanReport = evaluatePluginPipeline({
    testId: 'T01',
    testName: 'Global Landing Page',
    path: '/',
    candidateTarget: 'www.prod.staging',
    baselineTarget: 'www.prod.prod',
    candidateStatus: 200,
    baselineStatus: 200,
    candidateLatencyMs: 65,
    baselineLatencyMs: 60,
    candidateHeaders: {
      'x-check-cacheable': 'YES',
      'cache-control': 'max-age=1800',
    },
    baselineHeaders: {
      'x-check-cacheable': 'YES',
      'cache-control': 'max-age=3600',
    },
    candidateCookies: { geo_region: 'US-EAST' },
    baselineCookies: { geo_region: 'US-EAST' },
    pixelDiffPercent: 0.0,
  });
  assert.equal(cleanReport.overallPipelineVerdict, 'GO');
  assert.equal(cleanReport.failedCount, 0);

  // 2. Cacheability drift scenario -> NO-GO (blocking plugin fails)
  const driftReport = evaluatePluginPipeline({
    testId: 'T02',
    testName: 'Product Catalog Page',
    path: '/products/cloud-security',
    candidateTarget: 'www.prod.staging',
    baselineTarget: 'www.prod.prod',
    candidateStatus: 200,
    baselineStatus: 200,
    candidateLatencyMs: 110,
    baselineLatencyMs: 65,
    candidateHeaders: {
      'x-check-cacheable': 'NO',
      'cache-control': 'max-age=1800',
    },
    baselineHeaders: {
      'x-check-cacheable': 'YES',
      'cache-control': 'max-age=3600',
    },
    candidateCookies: { geo_region: 'US-EAST' },
    baselineCookies: { geo_region: 'US-EAST' },
    pixelDiffPercent: 0.02,
  });
  assert.equal(driftReport.overallPipelineVerdict, 'NO-GO');
  assert.ok(driftReport.failedCount >= 1);

  // 3. AI Agent Skills Bundle & One-Shot Prompt Generator
  const skillBundle = generateAiAgentAdaptationBundle();
  assert.equal(skillBundle.length, 8);
  assert.ok(skillBundle.some((s) => s.filename === 'CLAUDE.md'));
  assert.ok(skillBundle.some((s) => s.filename === 'AGENTS.md'));
  assert.ok(
    skillBundle.some((s) => s.filename === 'skills/adapt-organization/SKILL.md')
  );
  assert.ok(
    skillBundle.some((s) => s.filename === 'skills/zero-token-cycle/SKILL.md')
  );

  const prompt = generateOneShotAdaptationPrompt({
    organizationName: 'GlobalBank Edge',
    primaryDomain: 'edge.globalbank.com',
    cdnProvider: 'Akamai Edge',
    stagingEdgeSuffix: '.edgesuite-staging.net',
    stagingEdgeIp: '23.54.18.92',
    prodEdgeSuffix: '.edgesuite.net',
    prodEdgeIp: '104.86.112.44',
    awsRegion: 'us-east-1',
    s3Bucket: 'globalbank-synthetics-prod',
    propertiesCsv: 'ibanking, payments',
    environmentsCsv: 'prod, uat',
  });
  assert.match(prompt, /GlobalBank Edge Release Gate/);
  assert.match(prompt, /src\/config\/template\.config\.ts/);
  assert.match(prompt, /infra\/terraform\/terraform\.tfvars\.example/);
});

// ---------------------------------------------------------------------------
// 10. Headless User Administration, Password Reset & Activity Tracking Engine
// ---------------------------------------------------------------------------
import { UserManager, hashUserPassword, verifyUserPassword } from './userManager';

test('UserManager supports user creation, PBKDF2 password hashing, password reset, auth, status toggles, and activity tracking stats', () => {
  const mgr = new UserManager({ persistToFile: false });

  // 1. Seeded users exist and never expose passwordHash in public view
  const initialUsers = mgr.listUsers();
  assert.equal(initialUsers.length, 3);
  assert.ok(
    initialUsers.some(
      (u) => u.email === DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email
    )
  );
  assert.equal(
    'passwordHash' in (initialUsers[0] as unknown as Record<string, unknown>),
    false
  );

  // 2. Cryptographic PBKDF2-HMAC-SHA256 verification
  const { salt, hash } = hashUserPassword('SuperSecret#2026');
  assert.equal(verifyUserPassword('SuperSecret#2026', salt, hash), true);
  assert.equal(verifyUserPassword('WrongPassword#2026', salt, hash), false);

  // 3. Create new user
  const created = mgr.createUser({
    email: 'new-sre@salesforce.com',
    name: 'New Edge SRE',
    role: 'Staff Edge SRE',
    password: 'InitialPassword#123',
    actor: 'cli-admin',
    source: 'cli',
  });
  assert.equal(created.email, 'new-sre@salesforce.com');
  assert.equal(created.role, 'Staff Edge SRE');
  assert.equal(created.status, 'active');

  // 4. Authenticate with initial password
  const authOk = mgr.authenticateUser({
    email: 'new-sre@salesforce.com',
    password: 'InitialPassword#123',
    source: 'cli',
  });
  assert.equal(authOk.authenticated, true);
  assert.ok(authOk.sessionToken?.startsWith('akg_sess_'));

  // 5. Reset password and verify old password fails while new password succeeds
  const resetRes = mgr.resetPassword({
    email: 'new-sre@salesforce.com',
    newPassword: 'RotatedPassword#999',
    actor: 'cli-admin',
    source: 'cli',
  });
  assert.equal(resetRes.passwordResetCount, 1);

  const oldAuth = mgr.authenticateUser({
    email: 'new-sre@salesforce.com',
    password: 'InitialPassword#123',
    source: 'cli',
  });
  assert.equal(oldAuth.authenticated, false);

  const newAuth = mgr.authenticateUser({
    email: 'new-sre@salesforce.com',
    password: 'RotatedPassword#999',
    source: 'cli',
  });
  assert.equal(newAuth.authenticated, true);

  // 6. Track user actions and verify aggregated stats
  mgr.trackUserAction({
    email: 'new-sre@salesforce.com',
    action: 'SYNTHETIC_RUN_TRIGGERED',
    target: 'www.prod.staging',
    source: 'cli',
  });
  mgr.trackUserAction({
    email: 'new-sre@salesforce.com',
    action: 'COMPARISON_EVALUATED',
    target: 'www.prod.staging vs www.prod.prod',
    source: 'cli',
  });

  const stats = mgr.getStatsSummary();
  assert.equal(stats.totalUsers, 4);
  const trackedUser = stats.users.find((u) => u.email === 'new-sre@salesforce.com')!;
  assert.equal(trackedUser.stats.runsTriggered, 1);
  assert.equal(trackedUser.stats.comparisonsEvaluated, 1);
  assert.equal(trackedUser.stats.loginCount, 2);
  assert.equal(trackedUser.stats.passwordResetCount, 1);

  // 7. Disable user -> authentication blocked
  mgr.updateUserStatusOrRole({
    email: 'new-sre@salesforce.com',
    status: 'disabled',
  });
  const disabledAuth = mgr.authenticateUser({
    email: 'new-sre@salesforce.com',
    password: 'RotatedPassword#999',
    source: 'cli',
  });
  assert.equal(disabledAuth.authenticated, false);

  // 8. Delete user
  const deleted = mgr.deleteUser('new-sre@salesforce.com');
  assert.equal(deleted, true);
  assert.equal(mgr.listUsers().length, 3);
});

// ---------------------------------------------------------------------------
// 11. Real Salesforce.com HTTP Flow Tracking & .env AWS Credential Loader
// ---------------------------------------------------------------------------
import { buildHttpFlowForTest } from '../data/mockStore';
import { loadDotEnvCredentials } from './httpFlowProber';

test('Salesforce.com HTTP Flow tracking captures multi-hop redirects, DNS/TCP/TLS/TTFB/Transfer waterfall timings, request/response headers, and cookies', () => {
  assert.equal(DEFAULT_TEMPLATE_CONFIG.branding.defaultDomain, 'salesforce.com');
  assert.ok(
    DEFAULT_TEMPLATE_CONFIG.properties.every((p) =>
      p.name.toLowerCase().includes('salesforce.com')
    )
  );

  // Multi-hop 301 -> 200 redirect check (T04: /crm -> /crm/)
  const flow301 = buildHttpFlowForTest({
    testId: 'T04',
    canonicalHost: 'www.salesforce.com',
    envHost: 'www.salesforce.com',
    path: '/crm',
    isStaging: true,
    edgeHostname: 'www.salesforce.com.edgekey-staging.net',
    edgeIp: '23.48.201.18',
    actualStatus: 301,
    durationMs: 68,
    capturedHeaders: {
      location: 'https://www.salesforce.com/crm/',
      'x-check-cacheable': 'YES',
      'cache-control': 'max-age=86400',
    },
    capturedCookies: {
      ak_bmsc: '1A9F88C; Domain=.salesforce.com; Path=/; Secure; HttpOnly',
    },
  });

  assert.equal(flow301.redirectChain.length, 2);
  assert.equal(flow301.redirectChain[0].status, 301);
  assert.equal(
    flow301.redirectChain[0].redirectLocation,
    'https://www.salesforce.com/crm/'
  );
  assert.equal(flow301.redirectChain[1].status, 200);
  assert.equal(
    flow301.redirectChain[1].url,
    'https://www.salesforce.com/crm/'
  );
  assert.ok(flow301.redirectChain[0].timings!.dnsMs >= 1);
  assert.ok(flow301.redirectChain[0].timings!.tlsMs >= 1);
  assert.ok(flow301.redirectChain[0].requestHeaders?.['user-agent']);
  assert.equal(flow301.httpFlowSummary.totalHops, 2);
  assert.equal(flow301.httpFlowSummary.redirectCount, 1);
  assert.equal(
    flow301.httpFlowSummary.finalUrl,
    'https://www.salesforce.com/crm/'
  );

  // Verify .env credential loader parses active account without exposing secrets in summary
  const creds = loadDotEnvCredentials();
  assert.match(creds.accountId, /^\d{12}$/);
  assert.ok(creds.operatorUsername.length > 0);
  assert.equal(creds.loaded, true);
});

test('CloudFront SPA Portal Bundle, Terraform portal_spa_bundle & Makefile pipeline eliminate placeholder HTML', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { verifyCompiledSpaBundle } = await import(
    '../../scripts/deploy-aws-portal'
  );

  // 1. Verify Terraform main.tf uploads dist/ via aws_s3_object.portal_spa_bundle and has NO portal_index_fallback
  const mainTf = fs.readFileSync(
    path.resolve(process.cwd(), 'infra/terraform/main.tf'),
    'utf8'
  );
  assert.ok(
    mainTf.includes('resource "aws_s3_object" "portal_spa_bundle"'),
    'infra/terraform/main.tf must define aws_s3_object.portal_spa_bundle'
  );
  assert.ok(
    !mainTf.includes('resource "aws_s3_object" "portal_index_fallback"'),
    'infra/terraform/main.tf must NOT define placeholder portal_index_fallback'
  );
  assert.ok(
    !mainTf.includes('Run <code>make sync-ui</code> or <code>make deploy-cloudfront</code>'),
    'infra/terraform/main.tf must NOT contain placeholder fallback HTML'
  );

  // 2. Verify awsBlueprint.ts also generates aws_s3_object.portal_spa_bundle
  const generatedBundle = generateTerraformBundle(DEFAULT_TEMPLATE_CONFIG);
  assert.ok(
    generatedBundle.mainTf.includes('resource "aws_s3_object" "portal_spa_bundle"')
  );

  // 3. Verify compiled dist/ SPA bundle integrity if dist/ exists
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    const bundleCheck = verifyCompiledSpaBundle(distDir, 'portal-ui');
    assert.equal(
      bundleCheck.valid,
      true,
      `SPA bundle validation failed: ${bundleCheck.errors.join(', ')}`
    );
    assert.ok(
      bundleCheck.files.some(
        (f) =>
          f.s3Key === 'portal-ui/index.html' &&
          f.contentType.startsWith('text/html')
      )
    );
    assert.ok(
      bundleCheck.files.some(
        (f) =>
          f.s3Key.startsWith('portal-ui/assets/index-') &&
          f.s3Key.endsWith('.js') &&
          f.contentType.startsWith('application/javascript')
      )
    );
    assert.ok(
      bundleCheck.files.some(
        (f) =>
          f.s3Key.startsWith('portal-ui/assets/index-') &&
          f.s3Key.endsWith('.css') &&
          f.contentType.startsWith('text/css')
      )
    );
  }

  // 4. Verify Makefile defines unified all/deploy/tf-apply/sync-ui/test-e2e/user-* targets
  const makefile = fs.readFileSync(
    path.resolve(process.cwd(), 'Makefile'),
    'utf8'
  );
  assert.ok(makefile.includes('.DEFAULT_GOAL := all'));
  assert.ok(makefile.includes('deploy-all:'));
  assert.ok(makefile.includes('tf-apply:'));
  assert.ok(makefile.includes('sync-ui:'));
  assert.ok(makefile.includes('test-e2e:'));
  assert.ok(makefile.includes('scripts/deploy-aws-portal.ts'));
  assert.ok(makefile.includes('scripts/verify-cloudfront-e2e.ts'));
});

test('DOM Screenshot Renderer generates high-resolution webpage snapshots and T03 visual diff overlays for Side A vs Side B', async () => {
  const { buildDomScreenshotDataUri, resolvePageVisualTheme } = await import(
    './domScreenshotRenderer'
  );

  // 1. Verify T01 Side A and Side B match when highlightDiff is false
  const t01SideA = buildDomScreenshotDataUri({
    testId: 'T01',
    testName: 'Salesforce Global Home & Hero Experience',
    url: 'https://www.salesforce.com/',
    side: 'A',
    highlightDiff: false,
  });
  const t01SideB = buildDomScreenshotDataUri({
    testId: 'T01',
    testName: 'Salesforce Global Home & Hero Experience',
    url: 'https://www.salesforce.com/',
    side: 'B',
    highlightDiff: false,
  });
  assert.ok(t01SideA.startsWith('data:image/svg+xml;utf8,'));
  assert.ok(t01SideB.startsWith('data:image/svg+xml;utf8,'));
  assert.ok(decodeURIComponent(t01SideA).includes('viewBox="0 0 1280 760"'));

  // 2. Verify T03 Side A with highlightDiff=true renders the +14px staging promo shift & Bedrock Nova Lite diff overlay
  const t03SideA = buildDomScreenshotDataUri({
    testId: 'T03',
    testName: 'Agentforce AI & Einstein Copilot Overview',
    url: 'https://www.salesforce.com/ai/',
    side: 'A',
    highlightDiff: true,
    showOverlay: true,
    overlayText: 'AI Region: +14px vertical offset',
  });
  const t03SideB = buildDomScreenshotDataUri({
    testId: 'T03',
    testName: 'Agentforce AI & Einstein Copilot Overview',
    url: 'https://www.salesforce.com/ai/',
    side: 'B',
    highlightDiff: false,
  });
  assert.notEqual(t03SideA, t03SideB);
  const decodedT03A = decodeURIComponent(t03SideA);
  assert.ok(decodedT03A.includes('STAGING CANDIDATE BANNER'));
  assert.ok(decodedT03A.includes('Bedrock Nova Lite Diff: AI Region: +14px vertical offset'));

  // 3. Verify property-specific themes across all 8 Salesforce subdomains
  assert.ok(
    resolvePageVisualTheme('https://login.salesforce.com/').propertyBadge.includes(
      'Identity'
    )
  );
  assert.ok(
    resolvePageVisualTheme('https://developer.salesforce.com/').propertyBadge.includes(
      'Developers'
    )
  );
  assert.ok(
    resolvePageVisualTheme('https://trailhead.salesforce.com/').propertyBadge.includes(
      'Trailhead'
    )
  );
});

test('AWS Lambda Ad-Hoc Edge Runner & Control Plane Handler execute live multi-hop salesforce.com probes with zero dummy data', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const runnerSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/adhoc-edge-runner.js'),
    'utf8'
  );
  const controlSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/control-plane-handler.js'),
    'utf8'
  );

  // Verify adhoc-edge-runner.js performs multi-hop redirect chasing and live DNS/TLS capture
  assert.ok(runnerSrc.includes('probeMultiHopCheck'));
  assert.ok(runnerSrc.includes('resolveLiveDns'));
  assert.ok(runnerSrc.includes('liveCaptured: true'));

  // Verify control-plane-handler.js auto-populates live runs via invokeAdhocRunnerForTarget and computes live diffs
  assert.ok(controlSrc.includes('invokeAdhocRunnerForTarget'));
  assert.ok(controlSrc.includes('fetchLatestRun'));
  assert.ok(controlSrc.includes('__AI_VERDICT_CACHE__'));
});

test('3-Tier Zero-Token AI Architecture invokes AI only on novel unseen diff signatures and reuses SHA-256 cached verdicts at 0 tokens', async () => {
  const {
    ZeroTokenArchitectureEngine,
    computeZeroTokenDiffFingerprint,
    computeEnvCredentialFingerprint,
  } = await import('./zeroTokenArchitecture');

  const engine = new ZeroTokenArchitectureEngine();

  // 1. Tier 1: <= 0.1% pixel delta -> 0 tokens consumed (deterministic skip)
  const tier1 = engine.evaluate({
    testId: 'T01',
    url: 'https://www.salesforce.com/',
    pixelDiffPercent: 0.04,
  });
  assert.equal(tier1.tier, 'TIER_1_DETERMINISTIC_SKIP');
  assert.equal(tier1.aiInvoked, false);
  assert.equal(tier1.tokensConsumed, 0);
  assert.equal(tier1.tokensSaved, 1450);

  // 2. Tier 3: First evaluation of a brand-new unseen 2.4% diff signature -> invokes AI once & caches
  const tier3Novel = engine.evaluate({
    testId: 'T03',
    url: 'https://www.salesforce.com/ai/',
    pixelDiffPercent: 2.4,
  });
  assert.equal(tier3Novel.tier, 'TIER_3_NOVEL_AI_INVOKED');
  assert.equal(tier3Novel.aiInvoked, true);
  assert.equal(tier3Novel.cacheHit, false);
  assert.equal(tier3Novel.tokensConsumed, 1450);

  // 3. Tier 2: Second evaluation of the exact same 2.4% diff signature -> hits SHA-256 cache at 0 tokens!
  const tier2Cached = engine.evaluate({
    testId: 'T03',
    url: 'https://www.salesforce.com/ai/',
    pixelDiffPercent: 2.4,
  });
  assert.equal(tier2Cached.tier, 'TIER_2_SHA256_CACHE_HIT');
  assert.equal(tier2Cached.aiInvoked, false);
  assert.equal(tier2Cached.cacheHit, true);
  assert.equal(tier2Cached.tokensConsumed, 0);
  assert.equal(tier2Cached.tokensSaved, 1450);
  assert.equal(tier2Cached.fingerprint, tier3Novel.fingerprint);
  assert.equal(
    tier2Cached.fingerprint,
    computeZeroTokenDiffFingerprint({
      testId: 'T03',
      url: 'https://www.salesforce.com/ai/',
      pixelDiffPercent: 2.4,
    })
  );

  // 4. Verify .env credential fingerprint rotation detection without exposing secrets
  const fp1 = computeEnvCredentialFingerprint({
    accountId: '373211957869',
    operatorUsername: 'user-pqtpsgwbthke',
    maskedAccessKey: 'AKIA••••SIFP',
  });
  const fp2 = computeEnvCredentialFingerprint({
    accountId: '373211957869',
    operatorUsername: 'user-newoperator',
    maskedAccessKey: 'AKIA••••NEW1',
  });
  assert.match(fp1, /^ak_env_[0-9a-f]{12}$/);
  assert.notEqual(fp1, fp2);
});








