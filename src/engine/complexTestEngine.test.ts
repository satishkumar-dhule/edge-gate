import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComplexTelemetryForTest,
  buildSyntheticTransactionSteps,
  CATCHPOINT_TEST_PRESETS,
  evaluateTestAssertions,
  maskSecretHeaders,
} from './complexTestEngine';
import {
  CATCHPOINT_TEST_TYPES,
  cloneTestInSuite,
  getCatchpointTypeMeta,
  normalizeTestCaseWithCatchpointDefaults,
  reorderTestInSuite,
  validateTestDraft,
} from './catchpointCatalog';
import { generateReproduceCurl } from './rules';
import { evaluateLiveTransactionSteps } from './httpFlowProber';
import { TestCaseDefinition } from '../config/template.config';

test('maskSecretHeaders redacts Authorization, Cookie, and x-api-key while preserving custom non-secret headers', () => {
  const masked = maskSecretHeaders({
    Authorization: 'Bearer super-secret-jwt',
    Cookie: 'session=abc123',
    'x-api-key': 'sk-live-999',
    'x-api-client': 'release-gate',
    'content-type': 'application/json',
  });
  assert.equal(masked.Authorization, '***REDACTED***');
  assert.equal(masked.Cookie, '***REDACTED***');
  assert.equal(masked['x-api-key'], '***REDACTED***');
  assert.equal(masked['x-api-client'], 'release-gate');
  assert.equal(masked['content-type'], 'application/json');
});

test('evaluateTestAssertions validates status, body regex, latency budget, TLS version, SSL expiry, DNSSEC, and max hops', () => {
  const passEval = evaluateTestAssertions({
    expectedStatus: '200',
    actualStatus: 200,
    durationMs: 240,
    bodySnippet: '<html><body><main>Salesforce Edge Release</main></body></html>',
    tlsProtocol: 'TLSv1.3',
    sslDaysRemaining: 112,
    sslMinExpiryDays: 30,
    dnssecValid: true,
    hopCount: 3,
    assertions: {
      expectedBodyMatch: 'Salesforce|CRM',
      maxLatencyMs: 800,
      minTlsVersion: 'TLSv1.3',
      requireDnssec: true,
      maxHops: 5,
    },
  });
  assert.equal(passEval.passed, true);
  assert.equal(passEval.failures.length, 0);
  assert.equal(passEval.assertionResults.length, 7);

  const failEval = evaluateTestAssertions({
    expectedStatus: '200',
    actualStatus: 200,
    durationMs: 1450,
    bodySnippet: '<html><body>Maintenance</body></html>',
    tlsProtocol: 'TLSv1.2',
    sslDaysRemaining: 9,
    sslMinExpiryDays: 30,
    dnssecValid: false,
    hopCount: 9,
    assertions: {
      expectedBodyMatch: 'Salesforce',
      maxLatencyMs: 800,
      minTlsVersion: 'TLSv1.3',
      requireDnssec: true,
      maxHops: 4,
    },
  });
  assert.equal(failEval.passed, false);
  assert.equal(failEval.failures.length, 6);
});

test('generateReproduceCurl preserves HTTP method & JSON body while strictly omitting secret headers', () => {
  const curl = generateReproduceCurl({
    id: 'T19',
    name: 'GraphQL Health Mutation',
    url: 'https://www.salesforce.com/services/oauth2/userinfo',
    canonicalUrl: 'https://www.salesforce.com/services/oauth2/userinfo',
    pass: true,
    errors: [],
    expectedStatus: '200',
    actualStatus: 200,
    durationMs: 90,
    testType: 'api',
    httpMethod: 'POST',
    requestHeadersSent: {
      Authorization: '***REDACTED***',
      'x-api-client': 'release-gate',
    },
    requestBodySent: '{"query":"{ ok }"}',
    capturedHeaders: {},
    redirectChain: [],
    stagingEdgeIp: '23.200.0.10',
  });

  assert.match(curl, /-X POST/);
  assert.match(curl, /-H "x-api-client: release-gate"/);
  assert.match(curl, /-d '\{"query":"\{ ok \}"\}'/);
  assert.doesNotMatch(curl, /Authorization/i);
  assert.doesNotMatch(curl, /REDACTED/);
});

test('All 25 Catchpoint monitor types & 6 presets validate cleanly and build complex telemetry', () => {
  assert.equal(CATCHPOINT_TEST_TYPES.length, 25);
  assert.equal(CATCHPOINT_TEST_PRESETS.length, 6);

  for (const preset of CATCHPOINT_TEST_PRESETS) {
    const def = normalizeTestCaseWithCatchpointDefaults({
      id: 'T99',
      name: preset.template.name || preset.label,
      path: preset.template.path || '/',
      expectedStatus: preset.template.expectedStatus || '200',
      ...preset.template,
    });
    const validation = validateTestDraft(def);
    assert.equal(validation.valid, true, `Preset ${preset.id} should be valid`);

    const telemetry = buildComplexTelemetryForTest({
      testDef: def,
      resolvedHost: 'www.salesforce.com',
      edgeIp: '23.200.0.10',
      actualStatus: 200,
      durationMs: 110,
      hopCount: 1,
      isStaging: true,
    });
    assert.equal(telemetry.testType, preset.testType);
    assert.ok(telemetry.assertionResults.length >= 1);
  }
});

test('Multi-step Playwright transaction evaluator verifies selectors and text against live HTML', () => {
  const steps = buildSyntheticTransactionSteps({
    steps: [
      { step: 1, action: 'open', target: '/form/signup/' },
      { step: 2, action: 'waitForSelector', target: 'form#signup' },
      { step: 3, action: 'assertText', target: 'body', assertText: 'Free Trial' },
      { step: 4, action: 'assertStatus', target: '/form/signup/', value: '200' },
    ],
    actualStatus: 200,
    totalDurationMs: 280,
    bodySnippet: '<html><body><form id="signup">Start Free Trial</form></body></html>',
  });
  assert.equal(steps.length, 4);
  assert.ok(steps.every((s) => s.status === 'pass'));

  const liveEval = evaluateLiveTransactionSteps({
    steps: [
      { step: 1, action: 'open', target: '/' },
      { step: 2, action: 'waitForSelector', target: 'main' },
      { step: 3, action: 'assertText', target: 'body', assertText: 'MissingTokenXYZ' },
    ],
    actualStatus: 200,
    totalDurationMs: 200,
    bodySnippet: '<html><body><main>Salesforce Home</main></body></html>',
  });
  assert.equal(liveEval[1].status, 'pass');
  assert.equal(liveEval[2].status, 'fail');
});

test('cloneTestInSuite and reorderTestInSuite preserve Catchpoint complex fields', () => {
  const baseSuite: TestCaseDefinition[] = [
    normalizeTestCaseWithCatchpointDefaults({
      id: 'T01',
      name: 'Home',
      path: '/',
      expectedStatus: '200',
    }),
    normalizeTestCaseWithCatchpointDefaults({
      id: 'T02',
      name: 'SSL Gate',
      path: '/',
      expectedStatus: '200',
      testType: 'ssl',
      sslMinExpiryDays: 45,
      assertions: { minTlsVersion: 'TLSv1.3' },
    }),
  ];

  const { suite: clonedSuite, cloned } = cloneTestInSuite(baseSuite, 'T02');
  assert.equal(clonedSuite.length, 3);
  assert.equal(cloned?.id, 'T03');
  assert.equal(cloned?.testType, 'ssl');
  assert.equal(cloned?.sslMinExpiryDays, 45);
  assert.equal(getCatchpointTypeMeta(cloned?.testType).family, 'network');

  const reordered = reorderTestInSuite(clonedSuite, 'T03', 'up');
  assert.deepEqual(
    reordered.map((t) => t.id),
    ['T01', 'T03', 'T02']
  );
});
