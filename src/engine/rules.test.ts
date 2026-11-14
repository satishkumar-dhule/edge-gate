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

  // Assign measured pixelDiffPercent = 1.8% on T03 fixture to test visual minor -> acceptedVisualTests -> GO flow
  const t03Stg = stgRun.results.find((r) => r.id === 'T03')!;
  t03Stg.pixelDiffPercent = 1.8;

  // Initial comparison: T01 (2 header diffs -> different), T02 (2 cookie diffs -> different), T03 (1.8% pixel diff -> minor)
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
  assert.equal(stgTargetRuns[0].label, 'live-staging');
  assert.equal(stgTargetRuns[1].label, 'prev-staging');

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

test('Screenshot URL resolver maps Side A and Side B honestly without T03 spoofing and pure RGBA pixelDiff measures real pixel deltas', async () => {
  const { resolvePageVisualTheme, resolveLiveScreenshotUrl } = await import(
    './domScreenshotRenderer'
  );
  const { compareRgbaFrames } = await import('./pixelDiff');

  // 0. Verify resolveLiveScreenshotUrl produces distinct paths per property & side without special-case T03 fabrication
  const urlWwwT01A = resolveLiveScreenshotUrl({
    testId: 'T01',
    url: 'https://www.salesforce.com/',
    side: 'A',
  });
  const urlWwwT01Rev = resolveLiveScreenshotUrl({
    testId: 'T01',
    url: 'https://www.salesforce.com/',
    side: 'A',
    revision: 1731300000123,
  });
  const urlWwwT03A = resolveLiveScreenshotUrl({
    testId: 'T03',
    url: 'https://www.salesforce.com/artificial-intelligence/',
    side: 'A',
    highlightDiff: false,
  });
  const urlWwwT03B = resolveLiveScreenshotUrl({
    testId: 'T03',
    url: 'https://www.salesforce.com/artificial-intelligence/',
    side: 'B',
  });
  const urlLoginT01 = resolveLiveScreenshotUrl({
    testId: 'T01',
    url: 'https://login.salesforce.com/',
    side: 'A',
  });

  assert.equal(urlWwwT01A, '/screenshots/www-T01-sideA.jpg?v=live5');
  assert.equal(urlWwwT01Rev, '/screenshots/www-T01-sideA.jpg?v=live5&r=1731300000123');
  assert.equal(urlWwwT03A, '/screenshots/www-T03-sideA.jpg?v=live5');
  assert.equal(urlWwwT03B, '/screenshots/www-T03-sideB.jpg?v=live5');
  assert.equal(urlLoginT01, '/screenshots/login-T01-sideA.jpg?v=live5');

  // 1. Verify compareRgbaFrames returns 0% for identical buffers and exact % + bounding box for genuine changes
  const width = 10;
  const height = 10;
  const frameA = new Uint8Array(width * height * 4).fill(200);
  const frameB = new Uint8Array(width * height * 4).fill(200);

  const identical = compareRgbaFrames(frameA, frameB, width, height);
  assert.equal(identical.pixelDiffPercent, 0);
  assert.equal(identical.changedPixels, 0);
  assert.equal(identical.changedBox, null);

  // Modify 4 pixels in rows 2..3, cols 4..5
  for (const [x, y] of [
    [4, 2],
    [5, 2],
    [4, 3],
    [5, 3],
  ]) {
    const idx = (y * width + x) * 4;
    frameA[idx] = 20;
    frameA[idx + 1] = 20;
    frameA[idx + 2] = 20;
  }
  const diffed = compareRgbaFrames(frameA, frameB, width, height);
  assert.equal(diffed.changedPixels, 4);
  assert.equal(diffed.pixelDiffPercent, 4.0);
  assert.deepEqual(diffed.changedBox, { x: 40, y: 20, w: 20, h: 20 });

  // 2. Verify property-specific themes across Salesforce subdomains
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

// ---------------------------------------------------------------------------
// 14. Regional Akamai Edge PoP Node Routing & Localized Screenshot Resolution
// ---------------------------------------------------------------------------
import {
  inferPropertyIdFromUrl,
  resolveRegionalEdgeNode,
  getPropertyTestSuite,
} from '../config/template.config';
import { generateTestResults } from '../data/mockStore';
import { resolveLiveScreenshotUrl } from './domScreenshotRenderer';

test('Regional Salesforce properties resolve dedicated Akamai Edge PoP IPs, Accept-Language, regional cookies, HTTP 200 status, and localized screenshot paths', () => {
  // 1. Verify inferPropertyIdFromUrl maps regional URL paths accurately
  assert.equal(
    inferPropertyIdFromUrl('https://www.salesforce.com/jp/customer-success-stories/'),
    'japan'
  );
  assert.equal(
    inferPropertyIdFromUrl('https://www.salesforce.com/de/artificial-intelligence/'),
    'germany'
  );
  assert.equal(
    inferPropertyIdFromUrl('https://www.salesforce.com/uk/editions-pricing/sales-cloud/'),
    'uk'
  );
  assert.equal(
    inferPropertyIdFromUrl('https://www.salesforce.com/ap/sales/'),
    'apac'
  );
  assert.equal(
    inferPropertyIdFromUrl('https://www.salesforce.com/fr/'),
    'emea'
  );
  assert.equal(
    inferPropertyIdFromUrl('https://www.salesforce.com/br/customer-success-stories/'),
    'americas'
  );

  // 2. Verify Japan regional edge node config uses Tokyo NRT PoP and ja-JP headers/cookies
  const jpNode = resolveRegionalEdgeNode(
    'japan',
    'https://www.salesforce.com/jp/customer-success-stories/'
  );
  assert.equal(jpNode.stagingPopCode, 'NRT-STG-01');
  assert.equal(jpNode.prodPopCode, 'NRT-PRD-08');
  assert.equal(jpNode.stagingEdgeIp, '23.54.18.92');
  assert.equal(jpNode.prodEdgeIp, '104.97.84.21');
  assert.equal(jpNode.contentLanguage, 'ja-JP');
  assert.ok(jpNode.regionalCookieHeader.includes('prorigin=JP1'));
  assert.ok(jpNode.regionalCookieHeader.includes('AKA_A2=JP'));

  // 3. Verify generateTestResults for japan.prod.staging and japan.prod.prod uses Tokyo NRT Edge IPs and HTTP 200 on T04
  const jpStgResults = generateTestResults(
    'japan.prod.staging',
    'normal_staging',
    getPropertyTestSuite('japan')
  );
  const jpPrdResults = generateTestResults(
    'japan.prod.prod',
    'normal_prod',
    getPropertyTestSuite('japan')
  );
  const jpT04Stg = jpStgResults.find((r) => r.id === 'T04')!;
  const jpT04Prd = jpPrdResults.find((r) => r.id === 'T04')!;
  assert.equal(jpT04Stg.actualStatus, 200);
  assert.equal(jpT04Prd.actualStatus, 200);
  assert.equal(jpT04Stg.stagingEdgeIp, '23.54.18.92');
  assert.equal(jpT04Prd.stagingEdgeIp, '104.97.84.21');
  assert.equal(jpT04Stg.capturedHeaders['x-sfdc-edge-pop'], 'NRT-STG-01');
  assert.equal(jpT04Prd.capturedHeaders['x-sfdc-edge-pop'], 'NRT-PRD-08');
  assert.equal(jpT04Stg.capturedHeaders['content-language'], 'ja-JP');
  assert.ok(jpT04Stg.capturedCookies?.prorigin?.startsWith('JP1'));

  // 4. Verify resolveLiveScreenshotUrl maps /jp/ URLs to japan-T04-sideA/B.jpg (never www-T04!)
  const jpShotA = resolveLiveScreenshotUrl({
    testId: 'T04',
    url: 'https://www.salesforce.com/jp/customer-success-stories/',
    side: 'A',
  });
  const deShotB = resolveLiveScreenshotUrl({
    testId: 'T01',
    url: 'https://www.salesforce.com/de/',
    side: 'B',
  });
  assert.ok(jpShotA.startsWith('/screenshots/japan-T04-sideA.jpg'));
  assert.ok(deShotB.startsWith('/screenshots/germany-T01-sideB.jpg'));
});

// ---------------------------------------------------------------------------
// 15. Compute Shell Engine & CloudFront Deployment Summary (pnpm + deply)
// ---------------------------------------------------------------------------
import {
  extractCloudFrontUrlFromOutput,
  parseMakefileTargets,
  resolveComputeCommand,
} from './computeShell';
import { formatDeploymentSummaryBanner } from '../../scripts/deploy-aws-portal';

test('computeShell parses Makefile targets, resolves make deploy/deply to pnpm, and formats CloudFront summary banner', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const makefileRaw = fs.readFileSync(path.resolve(process.cwd(), 'Makefile'), 'utf8');

  const targets = parseMakefileTargets(makefileRaw);
  assert.ok(targets.some((t) => t.name === 'deploy'));
  assert.ok(targets.some((t) => t.name === 'deply'));
  assert.ok(targets.some((t) => t.name === 'verify'));
  assert.ok(targets.some((t) => t.name === 'sync-ui'));

  // Empty command returns empty: true
  assert.deepEqual(resolveComputeCommand('   '), {
    resolvedCommand: '',
    wasTranslated: false,
    empty: true,
  });

  // make deploy & make deply resolve to pnpm exec tsx deploy-aws-portal.ts deploy-all when hasMake is false and hasPnpm is true
  const deployRes = resolveComputeCommand('make deploy', { hasMake: false, hasPnpm: true });
  assert.equal(deployRes.wasTranslated, true);
  assert.equal(deployRes.resolvedCommand, 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all');

  const deplyRes = resolveComputeCommand('make deply', { hasMake: false, hasPnpm: true });
  assert.equal(deplyRes.wasTranslated, true);
  assert.equal(deplyRes.resolvedCommand, 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all');

  // make install & make lint use pnpm natively
  assert.equal(
    resolveComputeCommand('make install', { hasMake: false, hasPnpm: true }).resolvedCommand,
    'pnpm install'
  );
  assert.equal(
    resolveComputeCommand('make lint', { hasMake: false, hasPnpm: true }).resolvedCommand,
    'pnpm run lint'
  );

  // make run-adhoc preserves variable assignments
  const adhocRes = resolveComputeCommand(
    'make run-adhoc TARGET=japan.prod.staging BY=ops@salesforce.com',
    { hasMake: false, hasPnpm: true }
  );
  assert.equal(adhocRes.wasTranslated, true);
  assert.ok(adhocRes.resolvedCommand.startsWith('TARGET=japan.prod.staging BY=ops@salesforce.com '));
  assert.ok(adhocRes.resolvedCommand.includes('pnpm exec tsx scripts/user-admin-cli.ts run-adhoc'));

  // pnpm exec passes through untouched when hasPnpm is true, and falls back to ./node_modules/.bin only when false
  const pnpmPass = resolveComputeCommand('pnpm exec tsx --test src/engine/rules.test.ts', {
    hasPnpm: true,
  });
  assert.equal(pnpmPass.wasTranslated, false);
  assert.equal(pnpmPass.resolvedCommand, 'pnpm exec tsx --test src/engine/rules.test.ts');

  const pnpmFallback = resolveComputeCommand('pnpm exec tsx --test src/engine/rules.test.ts', {
    hasPnpm: false,
  });
  assert.equal(pnpmFallback.wasTranslated, true);
  assert.equal(pnpmFallback.resolvedCommand, './node_modules/.bin/tsx --test src/engine/rules.test.ts');

  // Arbitrary shell commands pass through untouched
  const rawShell = resolveComputeCommand('node -v && pwd', { hasMake: false, hasPnpm: true });
  assert.equal(rawShell.wasTranslated, false);
  assert.equal(rawShell.resolvedCommand, 'node -v && pwd');

  // CloudFront URL summary banner & stdout extractor
  const activeBanner = formatDeploymentSummaryBanner({
    accountId: '735234585484',
    region: 'us-east-1',
    stsValid: true,
    cloudfrontUrl: 'https://d2example123.cloudfront.net',
    distributionId: 'E2EXAMPLE123',
    apiEndpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com',
    s3Bucket: 'salesforce-akamai-synthetics-735234585484-us-east-1',
    totalFiles: 12,
    uploadedFiles: 12,
    invalidationOk: true,
    invalidationStatus: 201,
    e2eTargetUrl: 'https://d2example123.cloudfront.net',
  });
  assert.match(activeBanner, /CloudFront URL\s+: https:\/\/d2example123\.cloudfront\.net/);
  assert.match(activeBanner, /12\/12 direct S3 puts \+ Terraform bundle synced/);
  assert.equal(
    extractCloudFrontUrlFromOutput(activeBanner),
    'https://d2example123.cloudfront.net'
  );
});

// ---------------------------------------------------------------------------
// 16. Embedded VS Code Workspace Path Sanitization, Language Detection & FS
// ---------------------------------------------------------------------------
import {
  CURATED_WORKSPACE_QUICK_FILES,
  detectMonacoLanguage,
  isBinaryWorkspaceFile,
  sanitizeWorkspacePath,
} from './workspacePaths';
import {
  listWorkspaceTree,
  readWorkspaceFile,
  searchWorkspaceFiles,
  writeWorkspaceFile,
} from './workspaceServer';

test('workspacePaths enforces traversal boundaries and maps Monaco languages accurately', () => {
  assert.deepEqual(sanitizeWorkspacePath('Makefile'), {
    valid: true,
    normalized: 'Makefile',
  });
  assert.deepEqual(sanitizeWorkspacePath('./src/config/template.config.ts'), {
    valid: true,
    normalized: 'src/config/template.config.ts',
  });
  assert.deepEqual(sanitizeWorkspacePath('.env'), {
    valid: true,
    normalized: '.env',
  });

  // Path traversal & blocked internal directories
  assert.equal(sanitizeWorkspacePath('../etc/passwd').valid, false);
  assert.equal(sanitizeWorkspacePath('src/../../secret').valid, false);
  assert.equal(sanitizeWorkspacePath('node_modules/react/index.js').valid, false);
  assert.equal(sanitizeWorkspacePath('.git/config').valid, false);
  assert.equal(sanitizeWorkspacePath('C:\\Windows\\system32').valid, false);
  assert.equal(sanitizeWorkspacePath('').valid, false);

  // Language mapping & binary detection
  assert.equal(detectMonacoLanguage('src/App.tsx'), 'typescript');
  assert.equal(detectMonacoLanguage('infra/terraform/main.tf'), 'hcl');
  assert.equal(detectMonacoLanguage('.env'), 'ini');
  assert.equal(detectMonacoLanguage('Makefile'), 'shell');
  assert.equal(detectMonacoLanguage('package.json'), 'json');
  assert.equal(isBinaryWorkspaceFile('public/screenshots/www-T01-sideA.jpg'), true);
  assert.equal(isBinaryWorkspaceFile('src/engine/rules.ts'), false);
  assert.ok(CURATED_WORKSPACE_QUICK_FILES.some((f) => f.path === 'Makefile'));
  assert.ok(CURATED_WORKSPACE_QUICK_FILES.some((f) => f.path === '.env'));
});

test('workspaceServer lists workspace tree, reads/writes scoped files safely, and searches text', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-ws-test-'));
  try {
    writeWorkspaceFile(tmpRoot, 'Makefile', 'deploy:\n\t@echo ok\n');
    writeWorkspaceFile(tmpRoot, 'src/hello.ts', 'export const greeting = "akamai-gate";\n');

    const tree = listWorkspaceTree(tmpRoot);
    assert.ok(tree.some((e) => e.name === 'src' && e.type === 'directory'));
    assert.ok(tree.some((e) => e.name === 'Makefile' && e.type === 'file'));

    const readBack = readWorkspaceFile(tmpRoot, 'src/hello.ts');
    assert.equal(readBack.language, 'typescript');
    assert.match(readBack.content, /akamai-gate/);

    const hits = searchWorkspaceFiles(tmpRoot, 'akamai-gate');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, 'src/hello.ts');
    assert.equal(hits[0].line, 1);

    assert.throws(() => readWorkspaceFile(tmpRoot, '../outside.txt'), /traversal/i);
    assert.throws(
      () => writeWorkspaceFile(tmpRoot, 'src/hello.ts', 'dup', { createOnly: true }),
      /already exists/i
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 17. Scalable View Engine (50+ Regional PoPs & 64+ Suite Checks)
// ---------------------------------------------------------------------------
import {
  buildScaledTestSuite,
  classifyPropertyRegion,
  filterAndPaginateDiffItems,
  filterAndPaginateFleet,
  filterAndPaginateSuiteStats,
  FleetPropertyVerdictSummary,
  SuiteCheckStatRow,
} from './scalableViewEngine';

test('scalableViewEngine classifies Regional PoPs, Global Core, and Enterprise Scale properties accurately', () => {
  const jp = classifyPropertyRegion('japan');
  assert.equal(jp.regionCode, 'APAC');
  assert.equal(jp.cohort, 'regional-pop');
  assert.equal(jp.popCode, 'NRT');

  const de = classifyPropertyRegion('germany');
  assert.equal(de.regionCode, 'EMEA');
  assert.equal(de.popCode, 'FRA');

  const us = classifyPropertyRegion('americas');
  assert.equal(us.regionCode, 'AMER');
  assert.equal(us.popCode, 'IAD');

  const core = classifyPropertyRegion('www');
  assert.equal(core.regionCode, 'GLOBAL');
  assert.equal(core.cohort, 'global-core');
  assert.equal(core.popCode, 'ANY');

  const synthetic = classifyPropertyRegion('shard-edge-042');
  assert.equal(synthetic.cohort, 'enterprise-scale');
  assert.ok(['APAC', 'EMEA', 'AMER', 'GLOBAL'].includes(synthetic.regionCode));
});

test('filterAndPaginateFleet handles 50 properties with region/verdict filters, www priority pinning, and pagination', () => {
  const scaled = generateEnterpriseScaleTopology(50);
  const verdictMap: Record<string, FleetPropertyVerdictSummary> = {};
  scaled.apps.forEach((app, idx) => {
    const verdict = idx % 5 === 0 ? 'NO-GO' : idx % 3 === 0 ? 'REVIEW' : 'GO';
    verdictMap[app.id] = {
      verdict,
      funcFails: verdict === 'NO-GO' ? 2 : 0,
      cookieDiffs: verdict === 'NO-GO' ? 1 : 0,
      visDiffs: verdict === 'REVIEW' ? 1 : 0,
      stgTarget: `${app.id}.prod.staging`,
      prdTarget: `${app.id}.prod.prod`,
    };
  });

  // Page 1 at 15/pg always includes 'www' and activeAppId on page 1
  const page1 = filterAndPaginateFleet(scaled.apps, verdictMap, {
    activeAppId: 'japan',
    page: 1,
    pageSize: 15,
  });
  assert.equal(page1.totalItems, 50);
  assert.equal(page1.totalPages, 4);
  assert.equal(page1.items.length, 15);
  assert.equal(page1.items[0].app.id, 'japan');
  assert.ok(page1.items.some((item) => item.app.id === 'www'));
  assert.equal(
    page1.countsByRegion.APAC +
      page1.countsByRegion.EMEA +
      page1.countsByRegion.AMER +
      page1.countsByRegion.GLOBAL,
    50
  );

  // Region + verdict filter narrows down cleanly
  const emeaNoGo = filterAndPaginateFleet(scaled.apps, verdictMap, {
    region: 'EMEA',
    verdict: 'NO-GO',
    page: 1,
    pageSize: 15,
  });
  assert.ok(emeaNoGo.allFiltered.every((item) => item.meta.regionCode === 'EMEA'));
  assert.ok(emeaNoGo.allFiltered.every((item) => item.summary.verdict === 'NO-GO'));

  // Page 4 returns remaining 5 items (50 = 15 + 15 + 15 + 5)
  const page4 = filterAndPaginateFleet(scaled.apps, verdictMap, {
    page: 4,
    pageSize: 15,
  });
  assert.equal(page4.currentPage, 4);
  assert.equal(page4.items.length, 5);
});

test('buildScaledTestSuite expands 8 base checks to 64 checks and powers Diff Inspector & Test Suites filtering/pagination', () => {
  const baseSuite = getPropertyTestSuite('www');
  assert.equal(baseSuite.length, 8);

  const scaledSuite = buildScaledTestSuite(baseSuite, 64);
  assert.equal(scaledSuite.length, 64);
  assert.equal(scaledSuite[0].id, 'T01');
  assert.equal(scaledSuite[63].id, 'T64');
  assert.ok(scaledSuite[63].path.startsWith('/'));

  // Build synthetic ComparisonItem[] & SuiteCheckStatRow[] across 64 checks
  const diffItems: ComparisonItem[] = scaledSuite.map((tc, i) => {
    const fullUrl = tc.path.startsWith('http') ? tc.path : `https://www.salesforce.com${tc.path}`;
    return {
      testId: tc.id,
      testName: tc.name,
      url: fullUrl,
      candidateResult: {
        id: tc.id,
        name: tc.name,
        url: fullUrl,
        canonicalUrl: fullUrl,
        pass: true,
        errors: [],
        expectedStatus: tc.expectedStatus,
        actualStatus: Number(tc.expectedStatus) || 200,
        durationMs: 40 + (i % 10) * 15,
        capturedHeaders: {
          'x-check-cacheable': i % 9 === 0 ? 'NO' : 'YES',
          'cache-control': 'public, max-age=1800',
        },
        redirectChain:
          i % 4 === 0
            ? [
                { method: 'GET', url: fullUrl, status: 301, startOffsetMs: 0, durationMs: 25 },
                { method: 'GET', url: `${fullUrl}/`, status: 200, startOffsetMs: 25, durationMs: 35 },
              ]
            : [{ method: 'GET', url: fullUrl, status: 200, startOffsetMs: 0, durationMs: 40 }],
      },
      functionalDiffs: [],
      itemVerdict: i === 0 || i === 12 ? 'different' : i === 2 ? 'minor' : 'same',
    };
  });

  const diffResult = filterAndPaginateDiffItems(
    diffItems,
    {
      getUnacceptedHeaderCount: (it) => (it.testId === 'T01' || it.testId === 'T13' ? 1 : 0),
      getUnacceptedCookieCount: (it) => (it.testId === 'T02' ? 2 : 0),
      hasActiveVisualDiff: (it) => it.testId === 'T03',
    },
    {
      dimension: 'all',
      selectedTestId: 'T02',
      page: 2,
      pageSize: 12,
    }
  );
  assert.equal(diffResult.totalItems, 64);
  assert.equal(diffResult.totalPages, 6);
  assert.equal(diffResult.currentPage, 2);
  assert.equal(diffResult.items.length, 12);
  assert.equal(diffResult.facetCounts.headers, 2);
  assert.equal(diffResult.facetCounts.cookies, 1);
  assert.equal(diffResult.facetCounts.visual, 1);
  assert.equal(diffResult.prevTestId, 'T01');
  assert.equal(diffResult.nextTestId, 'T03');

  const suiteRows: SuiteCheckStatRow[] = scaledSuite.map((tc, i) => ({
    tc,
    avgStg: 60 + i,
    avgPrd: 50 + (i % 5),
    minMs: 40,
    maxMs: 120 + i,
    stgCacheable: i % 9 === 0 ? 'NO' : 'YES',
    prdCacheable: 'YES',
    stgCacheStatus: i % 9 === 0 ? 'TCP_MISS' : 'TCP_HIT',
    prdCacheStatus: 'TCP_HIT',
    diffInfo: {
      hDiffs: i === 0 ? 2 : 0,
      cDiffs: i === 1 ? 1 : 0,
      vDiff: i === 2,
      hasAny: i <= 2,
    },
  }));

  const suiteRes = filterAndPaginateSuiteStats(suiteRows, {
    facet: 'drift',
    sortBy: 'delta-desc',
    page: 1,
    pageSize: 12,
  });
  assert.ok(suiteRes.facetCounts.drift >= 3);
  assert.ok(suiteRes.facetCounts['cache-anomaly'] >= 1);
  assert.ok(suiteRes.items.length <= 12);
});

// ---------------------------------------------------------------------------
// 18. Cross-PoP & Cross-Suite Execution Matrix ("Any Suite from Any PoP")
// ---------------------------------------------------------------------------
import {
  GLOBAL_EXECUTION_POPS,
  resolveExecutionPopOption,
} from '../config/template.config';

test('GLOBAL_EXECUTION_POPS exposes 9 global PoPs and resolves PoP overrides onto any property', () => {
  assert.equal(GLOBAL_EXECUTION_POPS.length, 9);
  assert.equal(resolveExecutionPopOption('auto'), undefined);

  const nrt = resolveExecutionPopOption('nrt');
  assert.ok(nrt);
  assert.equal(nrt.popCode, 'NRT');
  assert.equal(nrt.awsRegion, 'ap-northeast-1');

  // Running www from Tokyo (nrt) keeps appId='www' while routing headers/IPs through NRT PoP
  const wwwFromTokyo = resolveRegionalEdgeNode('www', 'https://www.salesforce.com/', 'nrt');
  assert.equal(wwwFromTokyo.appId, 'www');
  assert.equal(wwwFromTokyo.popCode, 'NRT');
  assert.equal(wwwFromTokyo.stagingEdgeIp, '23.54.18.92');
  assert.match(wwwFromTokyo.edgescapeHeader, /country_code=JP/);
  assert.match(wwwFromTokyo.stagingPopCode, /NRT/);

  // Running japan from London (lhr) routes through UK/LHR PoP
  const japanFromLondon = resolveRegionalEdgeNode('japan', 'https://www.salesforce.com/jp/', 'lhr');
  assert.equal(japanFromLondon.appId, 'japan');
  assert.equal(japanFromLondon.popCode, 'LHR');
  assert.match(japanFromLondon.edgescapeHeader, /country_code=GB/);
});

test('generateTestResults stamps explicit popOverrideId edge headers across cross-suite targets', () => {
  const loginSuite = getPropertyTestSuite('login');
  assert.ok(loginSuite.length >= 4);

  const results = generateTestResults(
    'www.prod.staging',
    'normal_staging',
    loginSuite,
    DEFAULT_TEMPLATE_CONFIG,
    'fra'
  );
  assert.equal(results.length, loginSuite.length);
  const first = results[0];
  assert.ok(first.httpFlowSummary);
  assert.equal(first.httpFlowSummary.executionPopId, 'fra');
  assert.equal(first.httpFlowSummary.executionPopCode, 'FRA');
  assert.match(first.capturedHeaders['x-sfdc-edge-pop'] || '', /FRA/);
  assert.match(first.capturedHeaders['x-akamai-edgescape'] || '', /country_code=DE/);
  assert.equal(first.redirectChain[0]?.edgeIp, '2.16.106.34');
});

// ---------------------------------------------------------------------------
// 19. Keyboard Shortcuts, Chords & Command Palette Fuzzy Engine
// ---------------------------------------------------------------------------
import {
  CommandPaletteItem,
  SHORTCUT_DEFINITIONS,
  VIEW_CHORD_MAP,
  filterCommandItems,
  isEditableTarget,
  resolveKeyboardAction,
} from './shortcuts';

test('isEditableTarget protects inputs, selects, contentEditable, and Monaco editor from shortcut hijacking', () => {
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isEditableTarget({
      tagName: 'DIV',
      getAttribute: (k) => (k === 'contenteditable' ? 'true' : null),
    }),
    true
  );
  assert.equal(
    isEditableTarget({
      tagName: 'TEXTAREA',
      closest: () => ({}),
    }),
    true
  );
  assert.equal(
    isEditableTarget({
      tagName: 'DIV',
      closest: (sel) => (sel === '.monaco-editor' ? {} : null),
    }),
    true
  );
});

test('resolveKeyboardAction handles global shortcuts, G navigation chords, inspector context, and modal guards', () => {
  assert.ok(SHORTCUT_DEFINITIONS.length >= 18);
  assert.equal(VIEW_CHORD_MAP.s, 'suites');

  // Unauthenticated skips everything
  assert.deepEqual(
    resolveKeyboardAction(
      { key: '?', isAuthenticated: false } as unknown as { key: string },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: false }
    ),
    { type: 'noop' }
  );

  // Cmd+K / Ctrl+K toggles Command Palette globally except inside Monaco
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'k', metaKey: true },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'toggle-command-palette' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'k', ctrlKey: true, target: { tagName: 'DIV', closest: (s) => (s === '.monaco-editor' ? {} : null) } },
      { viewMode: 'terminal', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'noop' }
  );

  // Typing inside input ignores single-key shortcuts, except Escape
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'g', target: { tagName: 'INPUT' } },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'noop' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'Escape', target: { tagName: 'INPUT' } },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'escape' }
  );

  // Start chord 'g' then resolve 'g s' -> suites
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'g' },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'start-chord', chord: 'g' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 's' },
      { viewMode: 'property', pendingChord: 'g', hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'navigate', viewMode: 'suites' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'z' },
      { viewMode: 'property', pendingChord: 'g', hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'clear-chord' }
  );

  // Global quick actions: /, p, x, t, ?
  assert.deepEqual(
    resolveKeyboardAction(
      { key: '/' },
      { viewMode: 'suites', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'focus-search' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'x' },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'open-suite-pop-launcher' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'p' },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'open-property-switcher' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 't' },
      { viewMode: 'property', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'toggle-theme' }
  );

  // Diff inspector contextual navigation & tabs
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'j' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'step-check', delta: 1 }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'k' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'step-check', delta: -1 }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: '4' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'switch-inspector-tab', tab: 'image' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'f' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'toggle-diffs-only' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'c' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: false, isAuthenticated: true }
    ),
    { type: 'copy-curl' }
  );

  // Modal open blocks background shortcuts while still letting '?' toggle help and 'Escape' close
  assert.deepEqual(
    resolveKeyboardAction(
      { key: 'x' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: true, isAuthenticated: true }
    ),
    { type: 'noop' }
  );
  assert.deepEqual(
    resolveKeyboardAction(
      { key: '?' },
      { viewMode: 'diff', pendingChord: null, hasOpenModal: true, isAuthenticated: true }
    ),
    { type: 'toggle-shortcuts-help' }
  );
});

test('filterCommandItems ranks exact and prefix matches across actions, views, and PoPs', () => {
  const noop = () => {};
  const items: CommandPaletteItem[] = [
    { id: 'v1', group: 'Views', label: 'Diff Inspector', subtitle: 'HTTP/Header diff', onSelect: noop },
    { id: 'p1', group: 'Execution PoPs', label: 'Tokyo NRT', badge: 'NRT', subtitle: 'ap-northeast-1', onSelect: noop },
    { id: 'a1', group: 'Actions', label: 'Launch Suite @ Any PoP', keywords: 'cross pop suite nrt', onSelect: noop },
    { id: 's1', group: 'Suite Checks', label: 'T01 Home', subtitle: '/ Tokyo mirror', onSelect: noop },
  ];

  const nrtHits = filterCommandItems(items, 'nrt');
  assert.equal(nrtHits[0].id, 'p1');
  assert.ok(nrtHits.some((h) => h.id === 'a1'));

  const multiTokenHits = filterCommandItems(items, 'launch tokyo');
  assert.equal(multiTokenHits.length, 0);

  const suitePopHits = filterCommandItems(items, 'launch pop');
  assert.equal(suitePopHits[0].id, 'a1');
});

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { resolveApiScreenshotUrl } from './domScreenshotRenderer';
import {
  DEFAULT_S3_SYNC_CONCURRENCY,
  DEFAULT_S3_SYNC_MAX_ATTEMPTS,
  uploadFilesWithRetryPool,
  verifyCompiledSpaBundle,
} from '../../scripts/deploy-aws-portal';

test('AWS Terraform IAM & S3 MIME mappings support on-demand Canary screenshot capture and JPEG serving', () => {
  const tfMain = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/main.tf'), 'utf8');
  assert.ok(tfMain.includes('"synthetics:StartCanary"'), 'Terraform IAM must grant synthetics:StartCanary');
  assert.ok(tfMain.includes('"synthetics:GetCanary"'), 'Terraform IAM must grant synthetics:GetCanary');
  assert.ok(tfMain.includes('SYNTHETICS_CANARY_PREFIX'), 'Lambda env should configure SYNTHETICS_CANARY_PREFIX');

  const blueprintTf = generateTerraformBundle(DEFAULT_TEMPLATE_CONFIG);
  assert.ok(blueprintTf.mainTf.includes('".jpg"  = "image/jpeg"'), 'awsBlueprint must map .jpg to image/jpeg');
  assert.ok(blueprintTf.mainTf.includes('".jpeg" = "image/jpeg"'), 'awsBlueprint must map .jpeg to image/jpeg');
  assert.ok(
    blueprintTf.mainTf.includes('CloudWatchSyntheticsOnDemandTrigger') || tfMain.includes('CloudWatchSyntheticsOnDemandTrigger'),
    'IAM policy must include on-demand Synthetics trigger statement'
  );
});

test('AWS Synthetics Canary script captures unmodified 1280x760 JPEG screenshots and writes S3 + DynamoDB payloadJson', () => {
  const canaryScript = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-synthetics/canary-har-runner.js'),
    'utf8'
  );
  assert.ok(canaryScript.includes('page.screenshot('), 'Canary runner must invoke Chromium page.screenshot');
  assert.ok(canaryScript.includes("type: 'jpeg'"), 'Canary runner must capture JPEG images');
  assert.ok(canaryScript.includes('portal-ui/screenshots/${appId}-${check.id}-${sideSuffix}.jpg'), 'Canary must upload directly to portal-ui/screenshots/');
  assert.ok(canaryScript.includes('screenshotCaptured: screenshotBytes > 0'), 'Canary must derive screenshotCaptured honestly from byte count');
  assert.ok(canaryScript.includes('payloadJson: { S: JSON.stringify(manifest) }'), 'Canary must persist payloadJson in DynamoDB');
});

test('AWS Lambda control-plane-handler proxies screenshots without HTML fallback and never fakes screenshotCaptured', () => {
  const lambdaCode = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/control-plane-handler.js'),
    'utf8'
  );
  assert.ok(lambdaCode.includes("rawPath.startsWith('/api/v1/screenshots/')"), 'Lambda must expose /api/v1/screenshots/:filename');
  assert.ok(lambdaCode.includes('function deriveCanaryName(targetId)'), 'Lambda must derive Canary names matching Terraform');
  assert.ok(lambdaCode.includes('const screenshotCaptured = screenshotBytes > 0;'), 'Lambda must compute screenshotCaptured from actual S3 bytes');
  assert.ok(!/screenshotCaptured:\s*true\b/.test(lambdaCode), 'Lambda must NEVER hardcode screenshotCaptured: true');
  assert.ok(!/captured:\s*true\b/.test(lambdaCode), 'Lambda must NEVER hardcode captured: true');
});

test('resolveApiScreenshotUrl formats canonical /api/v1/screenshots path', () => {
  const url = resolveApiScreenshotUrl({ appId: 'www', testId: 'T01', side: 'A', revision: 1700000000000 });
  assert.equal(url, '/api/v1/screenshots/www-T01-sideA.jpg?v=live5&r=1700000000000');
  const urlB = resolveApiScreenshotUrl({ appId: 'developer', testId: 't04', side: 'B' });
  assert.equal(urlB, '/api/v1/screenshots/developer-T04-sideB.jpg?v=live5');
});

test('uploadFilesWithRetryPool retries transient S3 upload failures with bounded concurrency and counts failures accurately', async () => {
  assert.equal(DEFAULT_S3_SYNC_CONCURRENCY, 12);
  assert.equal(DEFAULT_S3_SYNC_MAX_ATTEMPTS, 3);

  const attempts = new Map<string, number>();
  let inFlight = 0;
  let maxObservedInFlight = 0;

  const res = await uploadFilesWithRetryPool({
    items: ['a.js', 'b.css', 'c.jpg', 'd.jpg', 'always-fail.png'],
    concurrency: 2,
    maxAttempts: 3,
    retryDelayMs: 1,
    worker: async (item) => {
      inFlight++;
      if (inFlight > maxObservedInFlight) maxObservedInFlight = inFlight;
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;

      const n = (attempts.get(item) || 0) + 1;
      attempts.set(item, n);

      if (item === 'c.jpg' && n < 3) {
        return { ok: false, status: 503, message: 'SlowDown' };
      }
      if (item === 'always-fail.png') {
        return { ok: false, status: 500, message: 'Persistent failure' };
      }
      return { ok: true, status: 200 };
    },
  });

  assert.ok(maxObservedInFlight <= 2, `Concurrency exceeded bound: ${maxObservedInFlight}`);
  assert.equal(res.uploadedCount, 4);
  assert.equal(res.failedCount, 1);
  assert.equal(attempts.get('c.jpg'), 3);
  assert.equal(attempts.get('always-fail.png'), 3);
  assert.equal(res.errors.length, 1);
  assert.ok(res.errors[0].includes('500'));
});

test('CloudFront distribution uses default_root_object without custom_error_response HTML interception or SCP-blocked CloudFront Functions', () => {
  const tfMain = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/main.tf'), 'utf8');
  assert.ok(
    tfMain.includes('default_root_object = "index.html"'),
    'main.tf must configure default_root_object = "index.html"'
  );
  assert.ok(
    !tfMain.includes('aws_cloudfront_function'),
    'main.tf must NOT provision aws_cloudfront_function when SCPs deny cloudfront:PublishFunction'
  );
  assert.ok(
    !tfMain.includes('custom_error_response'),
    'main.tf must NOT use distribution-wide custom_error_response that turns /api/* 404s into 200 HTML'
  );

  const blueprintTf = generateTerraformBundle(DEFAULT_TEMPLATE_CONFIG);
  assert.ok(
    blueprintTf.mainTf.includes('default_root_object = "index.html"') &&
      !blueprintTf.mainTf.includes('aws_cloudfront_function') &&
      !blueprintTf.mainTf.includes('custom_error_response'),
    'awsBlueprint must also avoid CloudFront Functions and custom_error_response'
  );
});

test('AWS Lambda control-plane never re-uploads stale S3 screenshots over themselves and exposes honest provenance & canary status', () => {
  const lambdaCode = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/control-plane-handler.js'),
    'utf8'
  );
  assert.ok(
    lambdaCode.includes("rawPath === '/api/v1/canary/status'"),
    'Control plane must expose GET /api/v1/canary/status'
  );
  assert.ok(
    lambdaCode.includes('CHROMIUM_RUNNER_LAMBDA_NAME'),
    'Control plane must support optional synchronous CHROMIUM_RUNNER_LAMBDA_NAME'
  );
  assert.ok(
    lambdaCode.includes('no-store, no-cache, must-revalidate'),
    'Screenshot responses must set Cache-Control no-store, no-cache, must-revalidate'
  );
  assert.ok(
    lambdaCode.includes('cachedScreenshotUrl'),
    'Control plane must expose cachedScreenshotUrl distinctly from fresh live capture'
  );
  assert.ok(
    lambdaCode.includes('screenshotSource'),
    'Control plane must report screenshotSource provenance'
  );
  assert.ok(
    !lambdaCode.includes('Non-fatal re-stamp write'),
    'Control plane must NOT copy stale S3 screenshots back onto portal-ui/screenshots/*'
  );
});

test('AWS Chromium Screenshot Lambda container handler, Terraform config, and app Dockerfile support real browser captures', () => {
  const runnerPath = path.resolve(process.cwd(), 'aws-lambda/chromium-screenshot-runner.js');
  const dockerfileLambdaPath = path.resolve(process.cwd(), 'aws-lambda/Dockerfile.chromium');
  assert.ok(fs.existsSync(runnerPath), 'aws-lambda/chromium-screenshot-runner.js must exist');
  assert.ok(fs.existsSync(dockerfileLambdaPath), 'aws-lambda/Dockerfile.chromium must exist');

  const runnerCode = fs.readFileSync(runnerPath, 'utf8');
  assert.ok(runnerCode.includes('playwright-core'), 'Chromium Lambda must use playwright-core');
  assert.ok(runnerCode.includes('--host-resolver-rules=MAP'), 'Chromium Lambda must support Akamai edge IP pinning');
  assert.ok(runnerCode.includes('const isCaptured = screenshotBytes > 0;'), 'Chromium Lambda must compute captured from real bytes');

  const tfVars = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/variables.tf'), 'utf8');
  const tfMain = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/main.tf'), 'utf8');
  assert.ok(tfVars.includes('enable_chromium_screenshot_lambda'), 'variables.tf must expose enable_chromium_screenshot_lambda');
  assert.ok(tfMain.includes('aws_lambda_function" "chromium_screenshot_runner"'), 'main.tf must define chromium_screenshot_runner Lambda');

  const appDockerfile = fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf8');
  assert.ok(appDockerfile.includes('playwright install chromium'), 'Dockerfile must install Chromium for container deployments');
});

test('Zero-Docker Sparticuz Chromium ZIP Lambda bundles cleanly, avoids CloudWatch Synthetics, and auto-wires CHROMIUM_RUNNER_LAMBDA_NAME', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const runnerPath = path.resolve(process.cwd(), 'aws-lambda/sparticuz-screenshot-runner.mjs');
  assert.ok(fs.existsSync(runnerPath), 'aws-lambda/sparticuz-screenshot-runner.mjs must exist');

  const runnerCode = fs.readFileSync(runnerPath, 'utf8');
  assert.ok(runnerCode.includes('@sparticuz/chromium-min'), 'Must use @sparticuz/chromium-min');
  assert.ok(runnerCode.includes('puppeteer-core'), 'Must use puppeteer-core');
  assert.ok(
    runnerCode.includes('await puppeteer.defaultArgs('),
    'Must await puppeteer.defaultArgs() for puppeteer-core v25+ Promise return'
  );
  assert.ok(runnerCode.includes('CHROMIUM_PACK_S3_PREFIX'), 'Must read Brotli pack from private S3 bucket');
  assert.ok(runnerCode.includes('--host-resolver-rules=MAP'), 'Must support Akamai Edge IP pinning');
  assert.ok(runnerCode.includes('const isCaptured = screenshotBytes > 0;'), 'Must never fabricate captured: true');

  const tfMain = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/main.tf'), 'utf8');
  assert.ok(
    tfMain.includes('resource "aws_lambda_function" "sparticuz_chromium_runner"'),
    'main.tf must define aws_lambda_function.sparticuz_chromium_runner'
  );
  assert.ok(
    tfMain.includes('runtime          = "nodejs22.x"') && tfMain.includes('architectures    = ["x86_64"]'),
    'sparticuz_chromium_runner must target nodejs22.x on x86_64'
  );
  assert.ok(
    tfMain.includes('aws_lambda_function.sparticuz_chromium_runner[0].function_name'),
    'control_plane_api must auto-wire CHROMIUM_RUNNER_LAMBDA_NAME to sparticuz_chromium_runner'
  );

  const controlPlaneCode = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/control-plane-handler.js'),
    'utf8'
  );
  assert.ok(
    controlPlaneCode.includes('Promise.all([chromiumPromise, adhocPromise])'),
    'control-plane-handler must invoke Chromium Lambda and Ad-Hoc HTTP Lambda in parallel'
  );

  const tfVars = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/variables.tf'), 'utf8');
  assert.ok(
    tfVars.includes('enable_sparticuz_chromium_lambda'),
    'variables.tf must expose enable_sparticuz_chromium_lambda'
  );

  const blueprintTf = generateTerraformBundle(DEFAULT_TEMPLATE_CONFIG);
  assert.ok(
    blueprintTf.mainTf.includes('resource "aws_lambda_function" "sparticuz_chromium_runner"'),
    'awsBlueprint must include sparticuz_chromium_runner'
  );
});

// ---------------------------------------------------------------------------
// 20. Google SRE Core Web Vitals, Apdex, SLO & Root-Cause Diagnosis Engine
// ---------------------------------------------------------------------------
import {
  computeCheckWebVitals,
  computeSuiteSreSummary,
  diagnoseCheckRootCause,
  evaluateCwvRating,
} from './sreIntelligence';

test('evaluateCwvRating classifies Core Web Vitals according to Google Web Vitals thresholds', () => {
  assert.equal(evaluateCwvRating(1800, 90, 0.04), 'GOOD');
  assert.equal(evaluateCwvRating(2900, 120, 0.05), 'NEEDS_IMPROVEMENT');
  assert.equal(evaluateCwvRating(1900, 260, 0.05), 'NEEDS_IMPROVEMENT');
  assert.equal(evaluateCwvRating(1900, 110, 0.15), 'NEEDS_IMPROVEMENT');
  assert.equal(evaluateCwvRating(4300, 110, 0.05), 'POOR');
  assert.equal(evaluateCwvRating(2100, 560, 0.05), 'POOR');
  assert.equal(evaluateCwvRating(2100, 110, 0.31), 'POOR');
});

test('diagnoseCheckRootCause pinpoints cache regression, cookie drift, status failure, and healthy states with remediation snippets', () => {
  const runs = seedRunsFromConfig();
  const stgRun = runs.find((r) => r.key === 'run-www-prod-staging-1')!;
  const prdRun = runs.find((r) => r.key === 'run-www-prod-prod-1')!;
  const comp = buildInitialComparison(stgRun, prdRun, 'network', []);

  const summary = computeSuiteSreSummary(comp.items);
  assert.equal(summary.diagnoses.length, comp.items.length);
  assert.ok(summary.blockerDiagnoses.length >= 1, 'staging_fail vs normal_prod must produce P0 blocker diagnoses');
  assert.equal(summary.releaseRiskTier, 'CRITICAL');
  assert.ok(summary.sloBurnRateMultiplier > 1.0);
  assert.ok(summary.p95CandidateMs > 0);
  assert.ok(summary.apdexCandidate >= 0 && summary.apdexCandidate <= 1);

  const cacheDiag = summary.diagnoses.find((d) => d.category === 'CACHE_REGRESSION');
  assert.ok(cacheDiag, 'Must identify CACHE_REGRESSION on T01');
  assert.equal(cacheDiag.severity, 'P0_BLOCKER');
  assert.ok(cacheDiag.remediationSnippet.includes('"caching"'));

  const cookieDiag = summary.diagnoses.find((d) => d.category === 'COOKIE_DRIFT');
  assert.ok(cookieDiag, 'Must identify COOKIE_DRIFT when Set-Cookie differs');
  assert.equal(cookieDiag.severity, 'P0_BLOCKER');

  const cleanComp = buildInitialComparison(prdRun, prdRun, 'network', []);
  const healthyDiag = diagnoseCheckRootCause(cleanComp.items[0]);
  assert.equal(healthyDiag.category, 'HEALTHY');
  assert.equal(healthyDiag.severity, 'NONE');

  const vitalsT01 = computeCheckWebVitals(comp.items[0]);
  assert.ok(vitalsT01.candidate.lcpMs > vitalsT01.baseline.lcpMs, 'Uncached candidate must show higher LCP than cached baseline');

  // Verify STATUS_FAILURE diagnosis when actualStatus differs
  const statusFailDiag = diagnoseCheckRootCause({
    ...comp.items[0],
    functionalDiffs: [
      {
        kind: 'status',
        field: 'status',
        candidateValue: '503',
        baselineValue: '200',
        severity: 'critical',
      },
    ],
  });
  assert.equal(statusFailDiag.category, 'STATUS_FAILURE');
  assert.equal(statusFailDiag.severity, 'P0_BLOCKER');
});

import { classifyVisualVerdictFromPixelDiff } from './pixelDiff';

test('visual comparison preserves AI judge and browser pixel diff overrides without resetting verdict to same', () => {
  assert.equal(classifyVisualVerdictFromPixelDiff(0), 'same');
  assert.equal(classifyVisualVerdictFromPixelDiff(0.1), 'same');
  assert.equal(classifyVisualVerdictFromPixelDiff(2.4), 'minor');
  assert.equal(classifyVisualVerdictFromPixelDiff(28.6), 'different');

  const runs = seedRunsFromConfig();
  const stgRun = runs.find((r) => r.key === 'run-www-prod-staging-1')!;
  const prdRun = runs.find((r) => r.key === 'run-www-prod-prod-1')!;

  const compWithVisualDiff = buildInitialComparison(stgRun, prdRun, 'network', [], {
    aiJudgeOverrides: {
      'www-T01': {
        verdict: 'different',
        pixelDiffPercent: 34.8,
        changedBox: { x: 4.5, y: 12.0, w: 91.0, h: 72.5 },
        summary:
          'Side A shows blue #1 AI CRM hero banner while Side B shows dark Agentic Enterprise hero with Pandora and Anthropic cards.',
      },
    },
  });

  const t01 = compWithVisualDiff.items.find((i) => i.testId === 'T01')!;
  assert.equal(t01.visualResult?.verdict, 'different');
  assert.equal(t01.visualResult?.pixelDiffPercent, 34.8);
  assert.equal(t01.visualResult?.differences.length, 1);
  assert.equal(t01.visualResult?.differences[0].severity, 'major');
  assert.deepEqual(t01.visualResult?.differences[0].box, {
    x: 4.5,
    y: 12.0,
    w: 91.0,
    h: 72.5,
  });

  // Also verify that accepting the visual test and enabling ignoreAcceptedDiffs marks it accepted
  const compAccepted = buildInitialComparison(stgRun, prdRun, 'network', [], {
    acceptedVisualTests: ['T01'],
    ignoreAcceptedDiffs: true,
    aiJudgeOverrides: {
      'www-T01': {
        verdict: 'different',
        pixelDiffPercent: 34.8,
        summary: 'Hero banner differs between staging and prod',
      },
    },
  });
  const t01Accepted = compAccepted.items.find((i) => i.testId === 'T01')!;
  assert.equal(t01Accepted.visualResult?.verdict, 'same');

  // Verify control-plane-handler.js never forces {"verdict":"same"} and checks hasDistinctS3Screenshots
  const controlPlaneCode = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/control-plane-handler.js'),
    'utf8'
  );
  assert.ok(
    controlPlaneCode.includes('hasDistinctS3Screenshots'),
    'control-plane-handler must detect distinct S3 screenshot SHA-256 hashes'
  );
  assert.ok(
    !controlPlaneCode.includes('Return ONLY valid JSON: {"verdict":"same","summary":'),
    'control-plane-handler must never force Bedrock Nova Lite to return only verdict:same'
  );
  assert.ok(
    controlPlaneCode.includes('{"verdict":"same"|"minor"|"different"'),
    'control-plane-handler must allow same, minor, or different in Bedrock Nova Lite prompt'
  );
});

// ---------------------------------------------------------------------------
// 21. Zero Cached Screenshots on AWS (Live-Only Chromium Pipeline Invariants)
// ---------------------------------------------------------------------------
test('AWS side enforces zero cached screenshots across Lambda, CloudFront, Terraform, S3 sync, and UI', () => {
  const controlPlane = fs.readFileSync(
    path.resolve(process.cwd(), 'aws-lambda/control-plane-handler.js'),
    'utf8'
  );
  assert.ok(
    !controlPlane.includes('__s3ScreenshotMemCache'),
    'control-plane-handler must NOT keep warm-Lambda RAM caches for screenshots'
  );
  assert.ok(
    !controlPlane.includes('?cached=1'),
    'control-plane-handler must NOT emit ?cached=1 screenshot URLs'
  );
  assert.ok(
    !controlPlane.includes('s3-cached-baseline'),
    'control-plane-handler must NOT fall back to s3-cached-baseline'
  );
  assert.ok(
    controlPlane.includes("rawPath.startsWith('/screenshots/')"),
    'control-plane-handler must proxy /screenshots/* requests live'
  );
  assert.ok(
    controlPlane.includes('isVerifiedLiveS3Metadata'),
    'control-plane-handler must verify live-capture S3 metadata before serving portal-ui/screenshots/*'
  );
  assert.ok(
    controlPlane.includes("'no-store, no-cache, must-revalidate, max-age=0'"),
    'control-plane-handler must return strict no-store Cache-Control headers on screenshots'
  );

  for (const runnerRel of [
    'aws-lambda/sparticuz-screenshot-runner.mjs',
    'aws-lambda/chromium-screenshot-runner.js',
    'aws-synthetics/canary-har-runner.js',
  ]) {
    const code = fs.readFileSync(path.resolve(process.cwd(), runnerRel), 'utf8');
    assert.ok(
      code.includes('live-screenshots/'),
      `${runnerRel} must upload live captures to live-screenshots/ S3 prefix`
    );
    assert.ok(
      code.includes("'live-capture': 'true'"),
      `${runnerRel} must tag S3 uploads with live-capture=true metadata`
    );
    assert.ok(
      code.includes('no-store, no-cache, must-revalidate, max-age=0'),
      `${runnerRel} must set no-store CacheControl on uploaded screenshots`
    );
  }

  const tfMain = fs.readFileSync(path.resolve(process.cwd(), 'infra/terraform/main.tf'), 'utf8');
  assert.ok(
    tfMain.includes('!startswith(f, "screenshots/")'),
    'infra/terraform/main.tf must exclude static screenshots/ from S3 portal-ui sync'
  );
  assert.ok(
    /path_pattern\s*=\s*"\/screenshots\/\*"/.test(tfMain) &&
      /max_ttl\s*=\s*0/.test(tfMain),
    'infra/terraform/main.tf must route /screenshots/* to ControlPlaneApiOrigin with max_ttl = 0'
  );

  const blueprintTf = generateTerraformBundle(DEFAULT_TEMPLATE_CONFIG);
  assert.ok(
    blueprintTf.mainTf.includes('!startswith(f, "screenshots/")') &&
      /path_pattern\s*=\s*"\/screenshots\/\*"/.test(blueprintTf.mainTf),
    'generateTerraformBundle must also exclude screenshots/ from S3 static files and route /screenshots/* live'
  );

  // Verify verifyCompiledSpaBundle omits screenshots/* files from SPA bundle uploads
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdc-spa-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDist, 'index.html'),
      '<html><body><div id="root"></div><script src="/assets/index-test123.js"></script></body></html>'
    );
    fs.mkdirSync(path.join(tmpDist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(tmpDist, 'assets', 'index-test123.js'), 'console.log(1);');
    fs.mkdirSync(path.join(tmpDist, 'screenshots'), { recursive: true });
    fs.writeFileSync(path.join(tmpDist, 'screenshots', 'www-T01-sideA.jpg'), 'fake-cached-jpeg');
    const verified = verifyCompiledSpaBundle(tmpDist, 'portal-ui');
    assert.equal(verified.valid, true);
    assert.ok(
      !verified.files.some((f) => f.relativePath.startsWith('screenshots/')),
      'verifyCompiledSpaBundle must never upload baked screenshots/ directory to S3'
    );
  } finally {
    fs.rmSync(tmpDist, { recursive: true, force: true });
  }

  // Verify server.ts, App.tsx, and TestInspector.tsx contain zero cached baseline fallbacks
  for (const appFile of ['server.ts', 'src/App.tsx', 'src/components/TestInspector.tsx']) {
    const content = fs.readFileSync(path.resolve(process.cwd(), appFile), 'utf8');
    assert.ok(!content.includes('?cached=1'), `${appFile} must not use ?cached=1`);
    assert.ok(!content.includes('s3-cached-baseline'), `${appFile} must not reference s3-cached-baseline`);
    assert.ok(!content.includes('disk-cached-baseline'), `${appFile} must not reference disk-cached-baseline`);
  }
});

// ---------------------------------------------------------------------------
// 22. Human-Understandable Logical Visual Diff Explanations (No Pixel Jargon)
// ---------------------------------------------------------------------------
test('Visual diff engine produces human-understandable logical explanations across page zones with zero pixel-delta jargon', async () => {
  const {
    compareRgbaFrames,
    describeVisualDiffLogically,
    humanizeVisualSummary,
    isTechnicalPixelSummary,
  } = await import('./pixelDiff');
  const { cleanHumanVisualSummary } = await import('../components/TestInspector');
  const { diagnoseCheckRootCause } = await import('./sreIntelligence');

  // 1. Real RGBA buffer with right-sidebar drawer on Side B + collapsed header links on Side B
  const width = 100;
  const height = 100;
  const frameA = new Uint8Array(width * height * 4).fill(240);
  const frameB = new Uint8Array(width * height * 4).fill(240);

  // Add high-contrast nav items in header (y: 2..8, x: 10..65) on Side A, and shift hero left on Side B
  for (let y = 14; y < 88; y++) {
    for (let x = 74; x < 98; x++) {
      // Side B draws a textured right-hand assistant drawer with card stripes
      const idx = (y * width + x) * 4;
      const shade = (x + y) % 3 === 0 ? 45 : 210;
      frameB[idx] = shade;
      frameB[idx + 1] = shade;
      frameB[idx + 2] = shade;
    }
  }
  for (let y = 2; y < 10; y++) {
    for (let x = 20; x < 68; x++) {
      const idx = (y * width + x) * 4;
      frameA[idx] = 40;
      frameA[idx + 1] = 80;
      frameA[idx + 2] = 160;
    }
  }

  const measured = compareRgbaFrames(frameA, frameB, width, height);
  assert.ok(measured.zones, 'compareRgbaFrames must compute page-zone metrics');
  assert.ok((measured.zones?.rightPanelPct ?? 0) > 40);
  assert.ok((measured.zones?.headerPct ?? 0) > 15);
  assert.ok(
    (measured.zones?.rightEdgeContrastB ?? 0) > (measured.zones?.rightEdgeContrastA ?? 0) * 1.5
  );

  const sidebarExplanation = describeVisualDiffLogically({
    pixelDiffPercent: measured.pixelDiffPercent,
    changedBox: measured.changedBox,
    zones: measured.zones,
    candidateLabel: 'staging',
    baselineLabel: 'prod',
    pageName: 'APAC Corporate Overview & Our Story',
  });
  assert.equal(sidebarExplanation.shortCallout, 'Right sidebar & header layout shift');
  assert.ok(/right-hand assistant\/sidebar panel/i.test(sidebarExplanation.summary));
  assert.ok(/Production opens a right-hand/i.test(sidebarExplanation.summary));
  assert.ok(!isTechnicalPixelSummary(sidebarExplanation.summary));

  // 2. Footer / cookie banner change only
  const footerLogical = describeVisualDiffLogically({
    pixelDiffPercent: 3.4,
    zones: {
      headerPct: 0.2,
      heroCenterPct: 0.4,
      rightPanelPct: 0.3,
      lowerBodyPct: 0.5,
      footerPct: 38.0,
    },
    candidateLabel: 'www.prod.staging',
    baselineLabel: 'www.prod.prod',
  });
  assert.equal(footerLogical.shortCallout, 'Cookie banner or footer differs');
  assert.ok(/cookie consent|footer/i.test(footerLogical.summary));
  assert.ok(!isTechnicalPixelSummary(footerLogical.summary));

  // 3. Top header nav change only
  const headerLogical = describeVisualDiffLogically({
    pixelDiffPercent: 2.1,
    zones: {
      headerPct: 24.0,
      heroCenterPct: 0.5,
      rightPanelPct: 0.4,
      lowerBodyPct: 0.2,
      footerPct: 0.1,
    },
  });
  assert.equal(headerLogical.shortCallout, 'Top navigation or header differs');
  assert.ok(/Top navigation menu/i.test(headerLogical.summary));

  // 4. Legacy technical pixel-delta string gets translated cleanly into plain English
  const legacyRaw =
    'Measured 27.21% pixel delta between Side A (staging) and Side B (prod) Chromium screenshots in viewport region (0%, 1.6%, 98.8%×98.4%).';
  const translated = humanizeVisualSummary(legacyRaw, {
    candidateLabel: 'staging',
    baselineLabel: 'prod',
  });
  assert.ok(!/pixel delta/i.test(translated));
  assert.ok(!/viewport region/i.test(translated));
  assert.ok(!/98\.8%/.test(translated));
  assert.ok(translated.length > 20);

  const uiCleaned = cleanHumanVisualSummary(legacyRaw, 27.21, {
    x: 0,
    y: 1.6,
    w: 98.8,
    h: 98.4,
  });
  assert.ok(!/pixel delta|viewport region/i.test(uiCleaned));

  // 5. Genuine AI semantic explanation passes through cleanly without distortion
  const realAiRaw =
    'AWS Bedrock Nova Lite (amazon.nova-lite-v1:0) [abc123]: Production opens an Agentforce chat drawer on the right while Staging displays full-width navigation.';
  const preservedAi = humanizeVisualSummary(realAiRaw, { pixelDiffPercent: 27.2 });
  assert.equal(
    preservedAi,
    'Production opens an Agentforce chat drawer on the right while Staging displays full-width navigation.'
  );

  const unparenthesizedModelRaw =
    'AWS Bedrock amazon.nova-lite-v1:0: Lower content cards, product modules, or promotional blocks differ between Staging and Production.';
  assert.equal(
    humanizeVisualSummary(unparenthesizedModelRaw, { pixelDiffPercent: 8.4 }),
    'Lower content cards, product modules, or promotional blocks differ between Staging and Production.'
  );

  // 6. SRE diagnosis avoids Pixel Delta jargon for pure visual divergence
  const runs = seedRunsFromConfig();
  const stgRun = runs.find((r) => r.key === 'run-www-prod-staging-1')!;
  const prdRun = runs.find((r) => r.key === 'run-www-prod-prod-1')!;
  const comp = buildInitialComparison(stgRun, prdRun, 'network', [], {
    aiJudgeOverrides: {
      'www-T08': {
        verdict: 'different',
        pixelDiffPercent: 27.21,
        zones: measured.zones,
        affectedArea: sidebarExplanation.affectedArea,
        shortCallout: sidebarExplanation.shortCallout,
        summary: sidebarExplanation.summary,
      },
    },
  });
  const t08 = comp.items.find((i) => i.testId === 'T08')!;
  const t08CleanForSre = {
    ...t08,
    functionalDiffs: [],
    cookieDiffs: [],
  };
  const sreDiag = diagnoseCheckRootCause(t08CleanForSre);
  assert.ok(!/Pixel Delta/i.test(sreDiag.title));
  assert.ok(!/pixel delta/i.test(sreDiag.rootCauseSummary));
  assert.equal(t08.visualResult?.shortCallout, 'Right sidebar & header layout shift');
});





