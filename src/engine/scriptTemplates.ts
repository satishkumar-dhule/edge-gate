import { TestCaseDefinition } from '../config/template.config';
import {
  ScriptExecutionResult,
  TestScriptEngine,
  TransactionStep,
  TransactionStepResult,
} from './types';
import { maskSecretHeaders } from './complexTestEngine';

export interface ScriptEngineMeta {
  id: TestScriptEngine;
  label: string;
  shortBadge: string;
  fileExt: string;
  language: 'typescript' | 'javascript';
  runtimeLabel: string;
  description: string;
}

export const SCRIPT_ENGINE_LIST: ScriptEngineMeta[] = [
  {
    id: 'playwright',
    label: 'Playwright (@playwright/test)',
    shortBadge: 'PW',
    fileExt: '.spec.ts',
    language: 'typescript',
    runtimeLabel: 'Playwright Chromium',
    description:
      'async ({ page, expect, targetUrl }) => Playwright page navigation, locator assertions, network waits, and 1280x760 capture.',
  },
  {
    id: 'puppeteer',
    label: 'Puppeteer (Headless Chrome)',
    shortBadge: 'PUP',
    fileExt: '.pup.mjs',
    language: 'javascript',
    runtimeLabel: 'Puppeteer / DevTools',
    description:
      'Standard Puppeteer page.goto, waitForSelector, type, click, evaluate, and screenshot workflow.',
  },
  {
    id: 'catchpoint',
    label: 'Catchpoint Transaction Script',
    shortBadge: 'CP',
    fileExt: '.cp.js',
    language: 'javascript',
    runtimeLabel: 'Catchpoint Verb DSL',
    description:
      'Catchpoint synthetic transaction verbs: open(), waitForSelector(), type(), click(), assertText(), screenshot().',
  },
  {
    id: 'selenium',
    label: 'Selenium WebDriver (JS)',
    shortBadge: 'SEL',
    fileExt: '.wd.js',
    language: 'javascript',
    runtimeLabel: 'WebDriver Adapter',
    description:
      'Selenium driver.get, By.css locators, sendKeys, click, and WebDriver explicit waits executed over Chromium.',
  },
  {
    id: 'k6',
    label: 'Grafana k6 (HTTP / Checks)',
    shortBadge: 'K6',
    fileExt: '.k6.js',
    language: 'javascript',
    runtimeLabel: 'k6 HTTP Check Engine',
    description:
      'k6 HTTP request + check(res, { ... }) status, latency, and JSON/body contract assertions.',
  },
  {
    id: 'node-fetch',
    label: 'Node Fetch / Custom JS',
    shortBadge: 'JS',
    fileExt: '.check.mjs',
    language: 'javascript',
    runtimeLabel: 'Node 22 Fetch + Assert',
    description:
      'Lightweight Node async fetch() + JSON/HTML contract checks with zero browser overhead.',
  },
];

export function getScriptEngineMeta(engine?: TestScriptEngine): ScriptEngineMeta {
  return (
    SCRIPT_ENGINE_LIST.find((e) => e.id === (engine || 'playwright')) ||
    SCRIPT_ENGINE_LIST[0]
  );
}

export function inferScriptEngineForTest(
  test?: Partial<TestCaseDefinition>
): TestScriptEngine {
  if (test?.scriptEngine) return test.scriptEngine;
  if (test?.testType === 'transaction-selenium') return 'selenium';
  if (test?.testType === 'api' || test?.testType === 'grpc') return 'k6';
  if (test?.testType === 'http-object') return 'node-fetch';
  return 'playwright';
}

function escapeSingleQuote(s: string): string {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Generates runnable, idiomatic test code for any supported library engine
 * directly from a TestCaseDefinition (preserving zero-secret header masking).
 */
export function generateDefaultScriptForTest(
  test: Partial<TestCaseDefinition>,
  engineOverride?: TestScriptEngine
): string {
  const engine = engineOverride || inferScriptEngineForTest(test);
  const testName = test.name || test.id || 'Synthetic Release Gate Check';
  const testPath = test.path || '/';
  const method = (test.httpMethod || 'GET').toUpperCase();
  const expectedStatus = Number(test.expectedStatus || 200) || 200;
  const maskedHeaders = test.requestHeaders
    ? maskSecretHeaders(test.requestHeaders)
    : undefined;
  const steps: TransactionStep[] =
    test.transactionSteps && test.transactionSteps.length > 0
      ? test.transactionSteps
      : [
          { step: 1, action: 'open', target: testPath },
          { step: 2, action: 'waitForSelector', target: 'main, form, h1, body' },
          ...(test.assertions?.expectedBodyMatch
            ? [
                {
                  step: 3,
                  action: 'assertText' as const,
                  target: 'body',
                  assertText: test.assertions.expectedBodyMatch,
                },
              ]
            : []),
          { step: 4, action: 'screenshot', target: '1280x760' },
        ];

  if (engine === 'playwright') {
    const lines: string[] = [
      `// Playwright Synthetic Script — ${testName}`,
      `export default async function runTest({ page, expect, targetUrl, baseUrl }) {`,
    ];
    for (const s of steps) {
      if (s.action === 'open') {
        const dest =
          s.target === testPath || s.target === '/'
            ? 'targetUrl'
            : `new URL('${escapeSingleQuote(s.target)}', baseUrl).toString()`;
        lines.push(`  const response = await page.goto(${dest}, { waitUntil: 'domcontentloaded' });`);
        lines.push(`  expect(response.status()).toBe(${expectedStatus});`);
      } else if (s.action === 'waitForSelector') {
        lines.push(`  await page.waitForSelector('${escapeSingleQuote(s.target)}', { timeout: 8000 });`);
      } else if (s.action === 'click') {
        lines.push(`  await page.locator('${escapeSingleQuote(s.target)}').first().click();`);
      } else if (s.action === 'type') {
        lines.push(
          `  await page.locator('${escapeSingleQuote(s.target)}').first().fill('${escapeSingleQuote(s.value || '')}');`
        );
      } else if (s.action === 'assertText') {
        const needle = s.assertText || s.value || 'Salesforce';
        lines.push(
          `  await expect(page.locator('${escapeSingleQuote(s.target || 'body')}')).toContainText('${escapeSingleQuote(needle)}');`
        );
      } else if (s.action === 'assertStatus') {
        lines.push(
          `  expect(response?.status() ?? ${expectedStatus}).toBe(${Number(s.value || expectedStatus)});`
        );
      } else if (s.action === 'screenshot') {
        lines.push(`  await page.screenshot({ fullPage: false });`);
      }
    }
    if (test.assertions?.expectedBodyMatch && !steps.some((s) => s.action === 'assertText')) {
      lines.push(
        `  await expect(page.locator('body')).toContainText('${escapeSingleQuote(test.assertions.expectedBodyMatch)}');`
      );
    }
    lines.push(`  console.log('Verified title:', await page.title());`);
    lines.push(`}`);
    return lines.join('\n');
  }

  if (engine === 'puppeteer') {
    const lines: string[] = [
      `// Puppeteer Headless Chrome Script — ${testName}`,
      `export default async function runTest({ page, targetUrl }) {`,
    ];
    for (const s of steps) {
      if (s.action === 'open') {
        lines.push(`  const resp = await page.goto(targetUrl, { waitUntil: 'networkidle2' });`);
        lines.push(`  if (resp && resp.status() >= 400) throw new Error('HTTP ' + resp.status());`);
      } else if (s.action === 'waitForSelector') {
        lines.push(`  await page.waitForSelector('${escapeSingleQuote(s.target)}', { timeout: 8000 });`);
      } else if (s.action === 'click') {
        lines.push(`  await page.click('${escapeSingleQuote(s.target)}');`);
      } else if (s.action === 'type') {
        lines.push(
          `  await page.type('${escapeSingleQuote(s.target)}', '${escapeSingleQuote(s.value || '')}');`
        );
      } else if (s.action === 'assertText') {
        const needle = s.assertText || s.value || 'Salesforce';
        lines.push(`  const html = await page.content();`);
        lines.push(
          `  if (!html.includes('${escapeSingleQuote(needle)}')) throw new Error('Missing text: ${escapeSingleQuote(needle)}');`
        );
      } else if (s.action === 'screenshot') {
        lines.push(`  await page.screenshot({ type: 'jpeg', quality: 84 });`);
      }
    }
    lines.push(`  console.log('Puppeteer URL:', page.url());`);
    lines.push(`}`);
    return lines.join('\n');
  }

  if (engine === 'catchpoint') {
    const lines: string[] = [`// Catchpoint Transaction Script — ${testName}`];
    for (const s of steps) {
      if (s.action === 'open') {
        lines.push(`await open('${escapeSingleQuote(s.target || testPath)}');`);
      } else if (s.action === 'waitForSelector') {
        lines.push(`await waitForSelector('${escapeSingleQuote(s.target)}');`);
      } else if (s.action === 'click') {
        lines.push(`await click('${escapeSingleQuote(s.target)}');`);
      } else if (s.action === 'type') {
        lines.push(
          `await type('${escapeSingleQuote(s.target)}', '${escapeSingleQuote(s.value || '')}');`
        );
      } else if (s.action === 'assertText') {
        lines.push(
          `await assertText('${escapeSingleQuote(s.target || 'body')}', '${escapeSingleQuote(s.assertText || s.value || '')}');`
        );
      } else if (s.action === 'assertStatus') {
        lines.push(`await assertStatus(${Number(s.value || expectedStatus)});`);
      } else if (s.action === 'screenshot') {
        lines.push(`await screenshot('${escapeSingleQuote(s.target || '1280x760')}');`);
      }
    }
    return lines.join('\n');
  }

  if (engine === 'selenium') {
    const lines: string[] = [
      `// Selenium WebDriver Script — ${testName}`,
      `export default async function runTest({ driver, By, until, targetUrl }) {`,
    ];
    for (const s of steps) {
      if (s.action === 'open') {
        lines.push(`  await driver.get(targetUrl);`);
      } else if (s.action === 'waitForSelector') {
        lines.push(
          `  await driver.wait(until.elementLocated(By.css('${escapeSingleQuote(s.target)}')), 8000);`
        );
      } else if (s.action === 'click') {
        lines.push(`  await driver.findElement(By.css('${escapeSingleQuote(s.target)}')).click();`);
      } else if (s.action === 'type') {
        lines.push(
          `  await driver.findElement(By.css('${escapeSingleQuote(s.target)}')).sendKeys('${escapeSingleQuote(s.value || '')}');`
        );
      } else if (s.action === 'assertText') {
        const needle = s.assertText || s.value || 'Salesforce';
        lines.push(
          `  const txt = await driver.findElement(By.css('${escapeSingleQuote(s.target || 'body')}')).getText();`
        );
        lines.push(
          `  if (!txt.includes('${escapeSingleQuote(needle)}')) throw new Error('Expected ${escapeSingleQuote(needle)}');`
        );
      } else if (s.action === 'screenshot') {
        lines.push(`  await driver.takeScreenshot();`);
      }
    }
    lines.push(`}`);
    return lines.join('\n');
  }

  if (engine === 'k6') {
    const headersLiteral = maskedHeaders
      ? JSON.stringify(maskedHeaders, null, 2).replace(/\n/g, '\n    ')
      : `{ 'content-type': 'application/json' }`;
    const bodyArg =
      test.requestBody && method !== 'GET' && method !== 'HEAD'
        ? JSON.stringify(test.requestBody)
        : 'null';
    const maxLat = test.assertions?.maxLatencyMs || test.slaCriticalMs || 2000;
    const bodyMatch = test.assertions?.expectedBodyMatch;
    return [
      `// Grafana k6 Synthetic Check — ${testName}`,
      `export default async function runTest({ http, check, targetUrl }) {`,
      `  const res = await http.request('${method === 'QUERY' ? 'GET' : method}', targetUrl, ${bodyArg}, {`,
      `    headers: ${headersLiteral},`,
      `  });`,
      `  check(res, {`,
      `    'status is ${expectedStatus}': (r) => r.status === ${expectedStatus},`,
      `    'latency <= ${maxLat}ms': (r) => r.timings.duration <= ${maxLat},`,
      ...(bodyMatch
        ? [`    'body matches ${escapeSingleQuote(bodyMatch)}': (r) => r.body.includes('${escapeSingleQuote(bodyMatch)}'),`]
        : []),
      `  });`,
      `  console.log('k6 status:', res.status, 'durationMs:', res.timings.duration);`,
      `}`,
    ].join('\n');
  }

  // node-fetch
  const headersLiteral = maskedHeaders
    ? JSON.stringify(maskedHeaders, null, 2).replace(/\n/g, '\n    ')
    : `{ 'accept': 'application/json, text/html' }`;
  return [
    `// Node Fetch Contract Script — ${testName}`,
    `export default async function runTest({ fetch, expect, targetUrl }) {`,
    `  const res = await fetch(targetUrl, {`,
    `    method: '${method === 'QUERY' ? 'GET' : method}',`,
    `    headers: ${headersLiteral},`,
    ...(test.requestBody && method !== 'GET' && method !== 'HEAD'
      ? [`    body: ${JSON.stringify(test.requestBody)},`]
      : []),
    `  });`,
    `  expect(res.status).toBe(${expectedStatus});`,
    ...(test.assertions?.expectedBodyMatch
      ? [
          `  const body = await res.text();`,
          `  expect(body).toContain('${escapeSingleQuote(test.assertions.expectedBodyMatch)}');`,
        ]
      : []),
    `  console.log('Fetch verified HTTP', res.status, res.url);`,
    `}`,
  ].join('\n');
}

/**
 * Parses Playwright, Puppeteer, Catchpoint, Selenium, k6, or Fetch scripts
 * into normalized multi-step TransactionStep[] for UI inspection & fallback execution.
 */
export function parseScriptToSteps(
  script: string,
  _engine?: TestScriptEngine
): TransactionStep[] {
  if (!script || !script.trim()) return [];
  const steps: TransactionStep[] = [];
  const lines = script.split(/\r?\n/);
  let stepNum = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('/*')) {
      continue;
    }

    // Navigation: page.goto(...) / driver.get(...) / open(...) / http.get(...) / fetch(...)
    const gotoMatch =
      line.match(/(?:page\.goto|driver\.get|open)\(\s*(['"`])((?:(?!\1).)+)\1/) ||
      line.match(/(?:page\.goto|driver\.get)\(\s*targetUrl/);
    if (gotoMatch) {
      steps.push({
        step: stepNum++,
        action: 'open',
        target: gotoMatch[2] || '/',
      });
      continue;
    }

    const k6Match = line.match(/http\.(get|post|put|delete|request)\(\s*(['"`])((?:(?!\2).)+)\2/);
    if (k6Match) {
      steps.push({
        step: stepNum++,
        action: 'open',
        target: k6Match[3].startsWith('/') || k6Match[3].startsWith('http') ? k6Match[3] : '/',
      });
      continue;
    }

    // Wait for selector: page.waitForSelector('...') / By.css('...')
    const waitMatch =
      line.match(/waitForSelector\(\s*(['"`])((?:(?!\1).)+)\1/) ||
      line.match(/elementLocated\(\s*By\.css\(\s*(['"`])((?:(?!\1).)+)\1/);
    if (waitMatch) {
      steps.push({
        step: stepNum++,
        action: 'waitForSelector',
        target: waitMatch[2],
      });
      continue;
    }

    // Fill / type: locator('sel').fill('val') / page.fill('sel', 'val') / page.type('sel', 'val') / type('sel', 'val') / sendKeys('val')
    const locatorFill = line.match(
      /locator\(\s*(['"`])((?:(?!\1).)+)\1[^)]*\)(?:\.first\(\))?\.(?:fill|type)\(\s*(['"`])((?:(?!\3).)*)\3/
    );
    if (locatorFill) {
      steps.push({
        step: stepNum++,
        action: 'type',
        target: locatorFill[2],
        value: locatorFill[4],
      });
      continue;
    }

    const directType = line.match(
      /(?:page\.fill|page\.type|type)\(\s*(['"`])((?:(?!\1).)+)\1\s*,\s*(['"`])((?:(?!\3).)*)\3/
    );
    if (directType) {
      steps.push({
        step: stepNum++,
        action: 'type',
        target: directType[2],
        value: directType[4],
      });
      continue;
    }

    const seleniumSend = line.match(
      /By\.css\(\s*(['"`])((?:(?!\1).)+)\1\s*\)\)\.sendKeys\(\s*(['"`])((?:(?!\3).)*)\3/
    );
    if (seleniumSend) {
      steps.push({
        step: stepNum++,
        action: 'type',
        target: seleniumSend[2],
        value: seleniumSend[4],
      });
      continue;
    }

    // Click: locator('sel').click() / page.click('sel') / click('sel') / By.css('sel').click()
    const locatorClick =
      line.match(/locator\(\s*(['"`])((?:(?!\1).)+)\1[^)]*\)(?:\.first\(\))?\.click\(/) ||
      line.match(/(?:page\.click|click)\(\s*(['"`])((?:(?!\1).)+)\1/) ||
      line.match(/By\.css\(\s*(['"`])((?:(?!\1).)+)\1\s*\)\)\.click\(/);
    if (locatorClick) {
      steps.push({
        step: stepNum++,
        action: 'click',
        target: locatorClick[2],
      });
      continue;
    }

    // Assert text: toContainText('txt') / toHaveText('txt') / assertText('sel', 'txt') / toContain('txt')
    const assertTextMatch =
      line.match(/(?:toContainText|toHaveText|toContain)\(\s*(['"`])((?:(?!\1).)+)\1/) ||
      line.match(/assertText\(\s*(['"`])((?:(?!\1).)+)\1\s*,\s*(['"`])((?:(?!\3).)+)\3/);
    if (assertTextMatch) {
      const hasSel = assertTextMatch.length >= 5 && assertTextMatch[4];
      steps.push({
        step: stepNum++,
        action: 'assertText',
        target: hasSel ? assertTextMatch[2] : 'body',
        assertText: hasSel ? assertTextMatch[4] : assertTextMatch[2],
      });
      continue;
    }

    // Assert status: expect(...status...).toBe(200) / assertStatus(200)
    const statusMatch =
      line.match(/status[^)]*\)\.toBe\(\s*(\d{3})\s*\)/) ||
      line.match(/assertStatus\(\s*(\d{3})\s*\)/);
    if (statusMatch) {
      steps.push({
        step: stepNum++,
        action: 'assertStatus',
        target: '/',
        value: statusMatch[1],
      });
      continue;
    }

    // Screenshot: page.screenshot / takeScreenshot / screenshot
    if (/(?:page\.screenshot|takeScreenshot|\bscreenshot)\s*\(/.test(line)) {
      steps.push({
        step: stepNum++,
        action: 'screenshot',
        target: '1280x760',
      });
    }
  }

  return steps;
}

export function validateScriptSyntaxQuick(script: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = (script || '').trim();
  if (!trimmed) return { valid: true };
  if (trimmed.length > 32768) {
    return { valid: false, error: 'Script exceeds 32 KB safety limit' };
  }
  // Check forbidden dangerous Node primitives in browser-authored synthetic scripts
  if (/\b(?:child_process|fs\.rm|rmSync|unlinkSync|process\.exit)\b/.test(trimmed)) {
    return {
      valid: false,
      error: 'Synthetic scripts run in a sandboxed browser/HTTP runner and cannot invoke child_process or filesystem deletion',
    };
  }
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const prev = i > 0 ? trimmed[i - 1] : '';
    if (prev === '\\') continue;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inTemplate = true;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    if (parens < 0 || braces < 0 || brackets < 0) {
      return { valid: false, error: 'Unbalanced closing bracket or parenthesis in script' };
    }
  }
  if (parens !== 0 || braces !== 0 || brackets !== 0) {
    return { valid: false, error: 'Unclosed "(", "{", or "[" in synthetic script' };
  }
  return { valid: true };
}

export function buildSyntheticScriptResult(params: {
  test: Partial<TestCaseDefinition>;
  actualStatus: number;
  durationMs: number;
  bodySnippet?: string;
}): ScriptExecutionResult | undefined {
  const { test, actualStatus, durationMs, bodySnippet } = params;
  if (!test.customScript?.trim()) return undefined;
  const engine = inferScriptEngineForTest(test);
  const parsed = parseScriptToSteps(test.customScript, engine);
  const perStep = Math.max(18, Math.round(durationMs / Math.max(1, parsed.length)));
  const stepLogs: TransactionStepResult[] = parsed.map((s, idx) => {
    let status: 'pass' | 'fail' = actualStatus >= 400 ? 'fail' : 'pass';
    let detail = `${engine}: ${s.action} ${s.target}`;
    if (s.action === 'assertStatus') {
      const ok = String(actualStatus) === String(s.value || '200');
      status = ok ? 'pass' : 'fail';
      detail = `Expected HTTP ${s.value || '200'}, observed HTTP ${actualStatus}`;
    } else if (s.action === 'assertText' && bodySnippet && (s.assertText || s.value)) {
      const needle = s.assertText || s.value || '';
      const found = bodySnippet.toLowerCase().includes(needle.toLowerCase());
      status = found ? 'pass' : 'fail';
      detail = found ? `Matched "${needle}"` : `Text "${needle}" not present`;
    }
    return {
      ...s,
      step: idx + 1,
      status,
      durationMs: perStep,
      detail,
    };
  });

  const passed = stepLogs.every((s) => s.status === 'pass') && actualStatus < 400;
  return {
    engine,
    executionMode: 'emulated-script-runner',
    passed,
    durationMs,
    stepLogs,
    consoleLogs: [
      `[${engine}] Loaded synthetic test script (${test.customScript.split('\n').length} lines)`,
      `[${engine}] Completed ${stepLogs.length} scripted actions in ${durationMs}ms (HTTP ${actualStatus})`,
    ],
  };
}
