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
