import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRIPT_ENGINE_LIST,
  buildSyntheticScriptResult,
  generateDefaultScriptForTest,
  getScriptEngineMeta,
  inferScriptEngineForTest,
  parseScriptToSteps,
  validateScriptSyntaxQuick,
} from './scriptTemplates';
import { prepareUserScriptRunner } from './liveScriptExecutor';
import { TestCaseDefinition } from '../config/template.config';

const sampleTest: TestCaseDefinition = {
  id: 'T99',
  name: 'Enterprise Trial Signup Flow',
  path: '/form/signup/',
  expectedStatus: '200',
  testType: 'transaction-playwright',
  requestHeaders: {
    Accept: 'text/html',
    Authorization: 'Bearer super-secret-jwt-token',
    'x-api-key': 'private-api-key-value',
  },
  transactionSteps: [
    { step: 1, action: 'open', target: '/form/signup/' },
    { step: 2, action: 'waitForSelector', target: 'main, body' },
    { step: 3, action: 'type', target: 'input[name="CompanyName"]', value: 'Acme Corp' },
    { step: 4, action: 'click', target: 'button[type="submit"]' },
    { step: 5, action: 'assertText', target: 'body', value: 'Salesforce' },
    { step: 6, action: 'screenshot', target: 'viewport' },
  ],
};

test('SCRIPT_ENGINE_LIST exposes all 6 supported programmable test engines', () => {
  assert.equal(SCRIPT_ENGINE_LIST.length, 6);
  const ids = SCRIPT_ENGINE_LIST.map((e) => e.id);
  assert.deepEqual(ids, [
    'playwright',
    'puppeteer',
    'catchpoint',
    'selenium',
    'k6',
    'node-fetch',
  ]);
  assert.equal(getScriptEngineMeta('playwright').shortBadge, 'PW');
  assert.equal(getScriptEngineMeta('k6').shortBadge, 'K6');
});

test('inferScriptEngineForTest maps monitor types to default script engines', () => {
  assert.equal(
    inferScriptEngineForTest({ id: 'T1', name: 'S', path: '/', expectedStatus: '200', testType: 'transaction-selenium' }),
    'selenium'
  );
  assert.equal(
    inferScriptEngineForTest({ id: 'T2', name: 'A', path: '/api', expectedStatus: '200', testType: 'api' }),
    'k6'
  );
  assert.equal(
    inferScriptEngineForTest({ id: 'T3', name: 'W', path: '/', expectedStatus: '200', testType: 'web-chrome' }),
    'playwright'
  );
});

test('generateDefaultScriptForTest generates valid scripts for all 6 engines without exposing secrets', () => {
  for (const meta of SCRIPT_ENGINE_LIST) {
    const code = generateDefaultScriptForTest(sampleTest, meta.id);
    assert.ok(code.length > 80, `Expected non-empty script for ${meta.id}`);
    assert.ok(!code.includes('super-secret-jwt-token'), `Leaked Authorization in ${meta.id}`);
    assert.ok(!code.includes('private-api-key-value'), `Leaked x-api-key in ${meta.id}`);
    const syntax = validateScriptSyntaxQuick(code);
    assert.equal(syntax.valid, true, `Generated ${meta.id} script failed syntax check: ${syntax.error}`);
  }
});

test('parseScriptToSteps extracts transaction steps from Playwright, Catchpoint, and Selenium scripts', () => {
  const pwCode = generateDefaultScriptForTest(sampleTest, 'playwright');
  const pwSteps = parseScriptToSteps(pwCode, 'playwright');
  assert.ok(pwSteps.length >= 4);
  assert.equal(pwSteps[0].action, 'open');
  assert.ok(pwSteps.some((s) => s.action === 'waitForSelector'));
  assert.ok(pwSteps.some((s) => s.action === 'type' && s.value === 'Acme Corp'));
  assert.ok(pwSteps.some((s) => s.action === 'click'));

  const cpCode = generateDefaultScriptForTest(sampleTest, 'catchpoint');
  const cpSteps = parseScriptToSteps(cpCode, 'catchpoint');
  assert.ok(cpSteps.length >= 4);
  assert.equal(cpSteps[0].action, 'open');
  assert.ok(cpSteps.some((s) => s.action === 'assertText'));
});

test('validateScriptSyntaxQuick rejects dangerous system calls and unbalanced delimiters', () => {
  const badImport = validateScriptSyntaxQuick(`const cp = require('child_process');`);
  assert.equal(badImport.valid, false);

  const unbalanced = validateScriptSyntaxQuick(`export default async function({ page }) {\n  await page.goto('https://example.com');\n`);
  assert.equal(unbalanced.valid, false);
  assert.match(unbalanced.error || '', /Unclosed/);
});

test('prepareUserScriptRunner compiles export default async function and top-level await scripts', async () => {
  const fnExport = prepareUserScriptRunner(`
    export default async function runTest({ targetUrl, console }) {
      console.log('visiting ' + targetUrl);
    }
  `);
  const logs: string[] = [];
  await fnExport({
    targetUrl: 'https://www.salesforce.com/',
    console: { log: (m: string) => logs.push(m) },
  });
  assert.deepEqual(logs, ['visiting https://www.salesforce.com/']);

  const topLevel = prepareUserScriptRunner(`
    console.log('top-level ' + baseUrl);
  `);
  await topLevel({
    baseUrl: 'https://www.salesforce.com',
    console: { log: (m: string) => logs.push(m) },
  });
  assert.equal(logs[1], 'top-level https://www.salesforce.com');
});

test('buildSyntheticScriptResult returns deterministic script telemetry when test has customScript', () => {
  const withScript: TestCaseDefinition = {
    ...sampleTest,
    scriptEngine: 'playwright',
    customScript: generateDefaultScriptForTest(sampleTest, 'playwright'),
  };
  const res = buildSyntheticScriptResult({
    test: withScript,
    actualStatus: 200,
    durationMs: 180,
    bodySnippet: '<html><body>Salesforce Enterprise Trial</body></html>',
  });
  assert.ok(res);
  assert.equal(res?.engine, 'playwright');
  assert.equal(res?.passed, true);
  assert.ok((res?.stepLogs.length || 0) >= 4);
});
