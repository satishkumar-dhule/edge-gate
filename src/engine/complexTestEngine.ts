import { TestCaseDefinition } from '../config/template.config';
import { getCatchpointTypeMeta } from './catchpointCatalog';
import {
  AssertionResult,
  CatchpointTestType,
  DnsProbeResult,
  NetworkProbeResult,
  ScriptExecutionResult,
  SslProbeResult,
  TestAssertions,
  TransactionStep,
  TransactionStepResult,
} from './types';
import { buildSyntheticScriptResult } from './scriptTemplates';

const SECRET_HEADER_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
]);

/**
 * Redacts sensitive credential header values before rendering in UI logs or cURL commands.
 */
export function maskSecretHeaders(
  headers?: Record<string, string>
): Record<string, string> {
  if (!headers) return {};
  const masked: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(headers)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (SECRET_HEADER_KEYS.has(key.toLowerCase())) {
      masked[key] = '***REDACTED***';
    } else {
      masked[key] = String(rawVal ?? '');
    }
  }
  return masked;
}

/**
 * Evaluates all Catchpoint assertions (status, body regex/substring, latency budget,
 * min TLS version, DNSSEC requirement, SSL expiry days, max network hops).
 */
export function evaluateTestAssertions(params: {
  expectedStatus?: string | number;
  actualStatus: number;
  durationMs: number;
  bodySnippet?: string;
  tlsProtocol?: string;
  sslDaysRemaining?: number;
  sslMinExpiryDays?: number;
  dnssecValid?: boolean;
  hopCount?: number;
  assertions?: TestAssertions;
}): {
  passed: boolean;
  assertionResults: AssertionResult[];
  failures: string[];
} {
  const {
    expectedStatus = '200',
    actualStatus,
    durationMs,
    bodySnippet,
    tlsProtocol,
    sslDaysRemaining,
    sslMinExpiryDays,
    dnssecValid,
    hopCount,
    assertions,
  } = params;

  const assertionResults: AssertionResult[] = [];
  const expectedCodeStr = String(expectedStatus || '200').trim();
  const statusPassed = String(actualStatus) === expectedCodeStr;
  assertionResults.push({
    rule: 'statusCode',
    expected: `HTTP ${expectedCodeStr}`,
    actual: `HTTP ${actualStatus}`,
    passed: statusPassed,
  });

  if (assertions?.expectedBodyMatch && assertions.expectedBodyMatch.trim()) {
    const pattern = assertions.expectedBodyMatch.trim();
    const haystack = bodySnippet || '';
    let matched = false;
    try {
      const rx = new RegExp(pattern, 'i');
      matched = rx.test(haystack);
    } catch {
      matched = haystack.toLowerCase().includes(pattern.toLowerCase());
    }
    assertionResults.push({
      rule: 'expectedBodyMatch',
      expected: `/${pattern}/i`,
      actual: haystack
        ? matched
          ? `Matched in ${haystack.length}B payload`
          : `Not found in ${haystack.length}B payload`
        : 'No body captured',
      passed: haystack ? matched : actualStatus < 400,
    });
  }

  if (assertions?.maxLatencyMs && assertions.maxLatencyMs > 0) {
    const latencyPassed = durationMs <= assertions.maxLatencyMs;
    assertionResults.push({
      rule: 'maxLatencyMs',
      expected: `<= ${assertions.maxLatencyMs}ms`,
      actual: `${durationMs}ms`,
      passed: latencyPassed,
    });
  }

  if (assertions?.minTlsVersion && assertions.minTlsVersion.trim()) {
    const reqTls = assertions.minTlsVersion.trim();
    const obsTls = tlsProtocol || 'TLSv1.3';
    const rank = (v: string) => {
      if (/1\.3/i.test(v)) return 13;
      if (/1\.2/i.test(v)) return 12;
      if (/1\.1/i.test(v)) return 11;
      return 10;
    };
    const tlsPassed = rank(obsTls) >= rank(reqTls);
    assertionResults.push({
      rule: 'minTlsVersion',
      expected: `>= ${reqTls}`,
      actual: obsTls,
      passed: tlsPassed,
    });
  }

  if (typeof sslMinExpiryDays === 'number' && sslMinExpiryDays > 0 && typeof sslDaysRemaining === 'number') {
    const expiryPassed = sslDaysRemaining >= sslMinExpiryDays;
    assertionResults.push({
      rule: 'sslMinExpiryDays',
      expected: `>= ${sslMinExpiryDays}d remaining`,
      actual: `${sslDaysRemaining}d remaining`,
      passed: expiryPassed,
    });
  }

  if (assertions?.requireDnssec) {
    const secOk = Boolean(dnssecValid);
    assertionResults.push({
      rule: 'requireDnssec',
      expected: 'DNSSEC VALIDATED',
      actual: secOk ? 'VALIDATED' : 'UNSIGNED / INVALID',
      passed: secOk,
    });
  }

  if (assertions?.maxHops && assertions.maxHops > 0 && typeof hopCount === 'number') {
    const hopsOk = hopCount <= assertions.maxHops;
    assertionResults.push({
      rule: 'maxHops',
      expected: `<= ${assertions.maxHops} hops`,
      actual: `${hopCount} hops`,
      passed: hopsOk,
    });
  }

  const failures = assertionResults
    .filter((a) => !a.passed)
    .map((a) => `${a.rule} assertion failed (expected ${a.expected}, got ${a.actual})`);

  return {
    passed: failures.length === 0,
    assertionResults,
    failures,
  };
}

/**
 * Builds deterministic initial or fallback transaction step telemetry from TransactionStep definitions.
 */
export function buildSyntheticTransactionSteps(params: {
  steps?: TransactionStep[];
  actualStatus: number;
  totalDurationMs: number;
  bodySnippet?: string;
}): TransactionStepResult[] {
  const { steps, actualStatus, totalDurationMs, bodySnippet } = params;
  if (!steps || steps.length === 0) return [];
  const perStepBase = Math.max(12, Math.round(totalDurationMs / steps.length));
  return steps.map((s, idx) => {
    let status: 'pass' | 'fail' = actualStatus >= 400 ? 'fail' : 'pass';
    let detail = '';

    if (s.action === 'open') {
      detail = `Navigated to ${s.target} (HTTP ${actualStatus})`;
    } else if (s.action === 'waitForSelector') {
      detail = `Selector "${s.target}" visible in DOM`;
    } else if (s.action === 'click') {
      detail = `Clicked "${s.target}"`;
    } else if (s.action === 'type') {
      detail = `Typed input into "${s.target}"`;
    } else if (s.action === 'assertStatus') {
      const exp = s.value || '200';
      const ok = String(actualStatus) === String(exp);
      status = ok ? 'pass' : 'fail';
      detail = `Expected HTTP ${exp}, observed HTTP ${actualStatus}`;
    } else if (s.action === 'assertText') {
      const needle = (s.assertText || s.value || '').trim();
      if (needle && bodySnippet) {
        const found = bodySnippet.toLowerCase().includes(needle.toLowerCase());
        status = found ? 'pass' : 'fail';
        detail = found
          ? `Matched "${needle}" in DOM/body`
          : `Text "${needle}" missing from DOM/body`;
      } else {
        detail = needle ? `Asserted text "${needle}"` : 'Verified text content';
      }
    } else if (s.action === 'screenshot') {
      detail = `Captured viewport ${s.target || '1280x760'}`;
    }

    return {
      step: s.step || idx + 1,
      action: s.action,
      target: s.target,
      value: s.value,
      assertText: s.assertText,
      status,
      durationMs: Math.max(6, perStepBase + ((idx % 3) - 1) * 5),
      detail,
    };
  });
}

/**
 * Builds baseline protocol-specific telemetry (DNS, SSL, Network, Transaction, Assertions)
 * for seeded/dry-run test results before a live run overrides them.
 */
export function buildComplexTelemetryForTest(params: {
  testDef: TestCaseDefinition;
  resolvedHost: string;
  edgeIp: string;
  actualStatus: number;
  durationMs: number;
  hopCount: number;
  isStaging: boolean;
}): {
  testType: CatchpointTestType;
  httpMethod: string;
  requestHeadersSent?: Record<string, string>;
  requestBodySent?: string;
  transactionStepResults?: TransactionStepResult[];
  scriptResult?: ScriptExecutionResult;
  dnsResult?: DnsProbeResult;
  sslResult?: SslProbeResult;
  networkResult?: NetworkProbeResult;
  assertionResults: AssertionResult[];
} {
  const { testDef, resolvedHost, edgeIp, actualStatus, durationMs, hopCount, isStaging } =
    params;
  const meta = getCatchpointTypeMeta(testDef.testType);
  const testType = meta.type;
  const httpMethod = String(testDef.httpMethod || meta.defaultMethod || 'GET').toUpperCase();

  const requestHeadersSent =
    testDef.requestHeaders && Object.keys(testDef.requestHeaders).length > 0
      ? maskSecretHeaders(testDef.requestHeaders)
      : undefined;
  const requestBodySent = testDef.requestBody?.trim()
    ? testDef.requestBody
    : undefined;

  const transactionStepResults =
    testDef.transactionSteps && testDef.transactionSteps.length > 0
      ? buildSyntheticTransactionSteps({
          steps: testDef.transactionSteps,
          actualStatus,
          totalDurationMs: durationMs,
        })
      : undefined;

  const dnsResult: DnsProbeResult | undefined =
    testType === 'dns-direct' || testType === 'dns-experience'
      ? {
          recordType: testDef.dnsRecordType || 'A',
          server: testDef.dnsServer || '8.8.8.8',
          answers:
            testDef.dnsRecordType === 'CNAME'
              ? [`${resolvedHost}.edgekey${isStaging ? '-staging' : ''}.net`]
              : testDef.dnsRecordType === 'TXT'
              ? ['"v=spf1 include:_spf.salesforce.com ~all"']
              : [edgeIp],
          ttlSec: 300,
          dnssecValid: true,
          queryMs: Math.max(4, Math.min(28, Math.round(durationMs * 0.25))),
        }
      : undefined;

  const sslResult: SslProbeResult | undefined =
    testType === 'ssl' || testType === 'ldap' || testType === 'smtp'
      ? {
          subject: `CN=${resolvedHost}`,
          issuer: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1',
          validFrom: '2026-08-01T00:00:00.000Z',
          validTo: '2027-07-31T23:59:59.000Z',
          daysRemaining: Math.max(testDef.sslMinExpiryDays || 30, 142),
          tlsProtocol: 'TLSv1.3',
          cipher: 'TLS_AES_256_GCM_SHA384',
          sanCount: 4,
          authorized: true,
        }
      : undefined;

  const networkResult: NetworkProbeResult | undefined =
    testType === 'ping' ||
    testType === 'traceroute' ||
    testType === 'transport-tcp' ||
    testType === 'bgp' ||
    testType === 'ssh' ||
    testType === 'ftp' ||
    testType === 'mqtt' ||
    testType === 'ntp'
      ? {
          protocol: meta.defaultProtocol,
          port: testDef.port || meta.defaultPort,
          remoteIp: edgeIp,
          tcpHandshakeMs: Math.max(4, Math.round(durationMs * 0.3)),
          rttMs: isStaging ? 24 : 18,
          packetLossPct: 0,
          bgpPrefix: testDef.bgpPrefix || `${edgeIp.split('.').slice(0, 3).join('.')}.0/24`,
          bgpOriginAsn: testDef.bgpOriginAsn || 'AS20940 (Akamai)',
          hopsCount: testType === 'traceroute' ? Math.min(testDef.assertions?.maxHops || 12, 9) : hopCount,
        }
      : undefined;

  const evalRes = evaluateTestAssertions({
    expectedStatus: testDef.expectedStatus || meta.defaultExpectedStatus,
    actualStatus,
    durationMs,
    tlsProtocol: sslResult?.tlsProtocol || 'TLSv1.3',
    sslDaysRemaining: sslResult?.daysRemaining,
    sslMinExpiryDays: testDef.sslMinExpiryDays,
    dnssecValid: dnsResult?.dnssecValid ?? true,
    hopCount: networkResult?.hopsCount ?? hopCount,
    assertions: testDef.assertions,
  });

  const scriptResult: ScriptExecutionResult | undefined = testDef.customScript?.trim()
    ? buildSyntheticScriptResult({
        test: testDef,
        actualStatus,
        durationMs,
      })
    : undefined;

  return {
    testType,
    httpMethod,
    requestHeadersSent,
    requestBodySent,
    transactionStepResults:
      transactionStepResults || scriptResult?.stepLogs,
    scriptResult,
    dnsResult,
    sslResult,
    networkResult,
    assertionResults: evalRes.assertionResults,
  };
}

export interface CatchpointTestPreset {
  id: string;
  label: string;
  summary: string;
  testType: CatchpointTestType;
  template: Partial<TestCaseDefinition>;
}

export const CATCHPOINT_TEST_PRESETS: CatchpointTestPreset[] = [
  {
    id: 'preset-playwright-tx',
    label: 'Playwright Multi-Step Tx',
    summary: '4-step browser form/login transaction with DOM selector & text assertion',
    testType: 'transaction-playwright',
    template: {
      name: 'Enterprise Trial Signup Transaction',
      path: '/form/signup/elf-v2-login/',
      testType: 'transaction-playwright',
      folderId: 'folder-conversion',
      category: 'Conversion',
      expectedStatus: '200',
      httpMethod: 'GET',
      critical: true,
      slaWarningMs: 1200,
      slaCriticalMs: 2500,
      transactionSteps: [
        { step: 1, action: 'open', target: '/form/signup/elf-v2-login/' },
        { step: 2, action: 'waitForSelector', target: 'form, main, h1' },
        { step: 3, action: 'assertText', target: 'body', assertText: 'Salesforce' },
        { step: 4, action: 'screenshot', target: '1280x760' },
      ],
      assertions: {
        expectedBodyMatch: 'Salesforce',
        maxLatencyMs: 3000,
      },
    },
  },
  {
    id: 'preset-api-post',
    label: 'REST / GraphQL API',
    summary: 'Custom POST JSON/GraphQL payload with headers & body match assertion',
    testType: 'api',
    template: {
      name: 'Edge API Cohort Contract Check',
      path: '/services/oauth2/userinfo',
      testType: 'api',
      folderId: 'folder-network',
      category: 'API',
      expectedStatus: '200',
      httpMethod: 'POST',
      requestHeaders: {
        'content-type': 'application/json',
        'x-api-client': 'catchpoint-release-gate',
      },
      requestBody: JSON.stringify(
        {
          query: 'query HealthCheck { status edgeRegion timestamp }',
          variables: { probe: 'release-gate' },
        },
        null,
        2
      ),
      assertions: {
        maxLatencyMs: 1500,
      },
    },
  },
  {
    id: 'preset-ssl-tls',
    label: 'SSL / TLS Cert Gate',
    summary: 'X.509 certificate chain, SAN count, TLSv1.3 & expiry threshold check',
    testType: 'ssl',
    template: {
      name: 'Edge TLS 1.3 & X.509 Expiry Gate',
      path: '/',
      testType: 'ssl',
      folderId: 'folder-identity',
      category: 'Security',
      expectedStatus: '200',
      httpMethod: 'HEAD',
      port: 443,
      sslMinExpiryDays: 30,
      critical: true,
      assertions: {
        minTlsVersion: 'TLSv1.3',
        maxLatencyMs: 1200,
      },
    },
  },
  {
    id: 'preset-dns-direct',
    label: 'Authoritative DNSSEC',
    summary: 'Direct A/CNAME/TXT DNS resolution, TTL parity & DNSSEC validation',
    testType: 'dns-direct',
    template: {
      name: 'Authoritative DNS & DNSSEC Parity',
      path: '/',
      testType: 'dns-direct',
      folderId: 'folder-network',
      category: 'DNS',
      expectedStatus: '200',
      httpMethod: 'QUERY',
      port: 53,
      dnsRecordType: 'A',
      dnsServer: '8.8.8.8',
      assertions: {
        requireDnssec: true,
        maxLatencyMs: 500,
      },
    },
  },
  {
    id: 'preset-bgp-route',
    label: 'BGP Anycast Route',
    summary: 'IP prefix announcement & Origin ASN stability verification',
    testType: 'bgp',
    template: {
      name: 'Akamai Anycast BGP Prefix & ASN',
      path: '/',
      testType: 'bgp',
      folderId: 'folder-network',
      category: 'Network',
      expectedStatus: '200',
      httpMethod: 'QUERY',
      port: 179,
      bgpPrefix: '23.200.0.0/16',
      bgpOriginAsn: 'AS20940',
      assertions: {
        maxHops: 12,
        maxLatencyMs: 800,
      },
    },
  },
  {
    id: 'preset-playwright-script',
    label: 'Playwright Code Script',
    summary: 'Full Playwright async JS/TS script executed inside headless Chromium with expect() & screenshot',
    testType: 'transaction-playwright',
    template: {
      name: 'Playwright Scripted Page Verification',
      path: '/',
      testType: 'transaction-playwright',
      folderId: 'folder-conversion',
      category: 'Playwright Script',
      expectedStatus: '200',
      httpMethod: 'GET',
      scriptEngine: 'playwright',
      scriptTimeoutMs: 15000,
      customScript: [
        `// Full Playwright Test Script executed in real headless Chromium`,
        `export default async function runTest({ page, expect, targetUrl }) {`,
        `  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });`,
        `  expect(response.status()).toBe(200);`,
        `  await page.waitForSelector('main, h1, body', { timeout: 8000 });`,
        `  await expect(page.locator('body')).toContainText('Salesforce');`,
        `  await page.screenshot({ fullPage: false });`,
        `  console.log('Playwright title:', await page.title());`,
        `}`,
      ].join('\n'),
      assertions: {
        expectedBodyMatch: 'Salesforce',
        maxLatencyMs: 5000,
      },
    },
  },
];
