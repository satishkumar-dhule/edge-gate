import {
  AppConfig,
  CatchpointMonitorFamily,
  CatchpointTestType,
  EnvironmentConfig,
  EnvironmentTier,
  TestFolder,
} from './types';
import {
  TestCaseDefinition,
  resolvePropertyHostname,
} from '../config/template.config';
import { validateScriptSyntaxQuick } from './scriptTemplates';

export interface CatchpointTestTypeMeta {
  type: CatchpointTestType;
  label: string;
  shortLabel: string;
  family: CatchpointMonitorFamily;
  familyLabel: string;
  defaultProtocol: string;
  defaultMethod: TestCaseDefinition['httpMethod'];
  defaultMonitor: string;
  defaultPort: number;
  defaultExpectedStatus: string;
  supportsVisualScreenshot: boolean;
  configSections: Array<
    | 'http'
    | 'headers'
    | 'body'
    | 'dns'
    | 'ssl'
    | 'port'
    | 'bgp'
    | 'transaction'
    | 'script'
    | 'assertions'
  >;
  description: string;
}

export const CATCHPOINT_FAMILY_META: Array<{
  id: CatchpointMonitorFamily;
  label: string;
}> = [
  { id: 'web', label: 'Web & Browser' },
  { id: 'transaction', label: 'Transactions' },
  { id: 'api', label: 'API & Streaming' },
  { id: 'dns', label: 'DNS & DNSSEC' },
  { id: 'network', label: 'Network & SSL' },
  { id: 'infra', label: 'Infra, Mail & RUM' },
];

/**
 * Exhaustive catalog of all synthetic, network, DNS, API, protocol, and RUM
 * monitor types supported by Catchpoint Control Center.
 */
export const CATCHPOINT_TEST_TYPES: CatchpointTestTypeMeta[] = [
  {
    type: 'web-chrome',
    label: 'Web (Chrome Real Browser)',
    shortLabel: 'Web Chrome',
    family: 'web',
    familyLabel: 'Web & Browser',
    defaultProtocol: 'HTTPS / HTTP2',
    defaultMethod: 'GET',
    defaultMonitor: 'Chrome 130 Desktop',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'script', 'assertions'],
    description:
      'Full headless Chromium page load with DOM rendering, Core Web Vitals (LCP/INP/CLS), waterfall, headers, cookies, and 1280×760 visual capture.',
  },
  {
    type: 'web-mobile',
    label: 'Mobile Web (Emulated)',
    shortLabel: 'Mobile Web',
    family: 'web',
    familyLabel: 'Web & Browser',
    defaultProtocol: 'HTTPS / HTTP2',
    defaultMethod: 'GET',
    defaultMonitor: 'Chrome Mobile (390×844)',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'script', 'assertions'],
    description:
      'Responsive mobile viewport synthetic check with touch User-Agent, mobile LCP/CLS thresholds, and layout screenshot.',
  },
  {
    type: 'http-object',
    label: 'Single Object (HTTP / HTTPS)',
    shortLabel: 'HTTP Object',
    family: 'web',
    familyLabel: 'Web & Browser',
    defaultProtocol: 'HTTPS / HTTP2',
    defaultMethod: 'GET',
    defaultMonitor: 'Edge HTTP Prober',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'body', 'script', 'assertions'],
    description:
      'Single-request HTTP(S) probe measuring DNS, TCP, TLS, TTFB, redirect hops, cacheability headers, and Set-Cookie parity without JS overhead.',
  },
  {
    type: 'playback',
    label: 'Playback (Chrome Visual Session)',
    shortLabel: 'Playback',
    family: 'web',
    familyLabel: 'Web & Browser',
    defaultProtocol: 'HTTPS',
    defaultMethod: 'GET',
    defaultMonitor: 'Chrome Playback',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'transaction', 'script', 'assertions'],
    description:
      'Recorded browser journey playback with frame capture, layout shift validation, and Bedrock AI visual diff.',
  },
  {
    type: 'streaming',
    label: 'Streaming Media (HLS / DASH)',
    shortLabel: 'Streaming',
    family: 'api',
    familyLabel: 'API & Streaming',
    defaultProtocol: 'HLS / DASH',
    defaultMethod: 'GET',
    defaultMonitor: 'Media Edge Prober',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'assertions'],
    description:
      'Manifest (.m3u8/.mpd) & segment TTFB verification, CDN cache hit rate, and playback readiness check.',
  },
  {
    type: 'transaction-playwright',
    label: 'Transaction (Playwright Multi-Step)',
    shortLabel: 'Playwright Tx',
    family: 'transaction',
    familyLabel: 'Transactions',
    defaultProtocol: 'HTTPS / Playwright',
    defaultMethod: 'GET',
    defaultMonitor: 'Playwright Chromium',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'transaction', 'script', 'assertions'],
    description:
      'Multi-step scripted browser user flow (open, type, click, waitForSelector, assertText) or custom Playwright Chromium JS/TS script.',
  },
  {
    type: 'transaction-selenium',
    label: 'Transaction (Selenium / WebDriver)',
    shortLabel: 'Selenium Tx',
    family: 'transaction',
    familyLabel: 'Transactions',
    defaultProtocol: 'HTTPS / WebDriver',
    defaultMethod: 'GET',
    defaultMonitor: 'Selenium Chrome',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'transaction', 'script', 'assertions'],
    description:
      'Catchpoint Selenium/WebDriver multi-step script for authenticated customer journeys and form submissions.',
  },
  {
    type: 'api',
    label: 'API (REST / GraphQL / SOAP)',
    shortLabel: 'REST / GraphQL API',
    family: 'api',
    familyLabel: 'API & Streaming',
    defaultProtocol: 'HTTPS / JSON',
    defaultMethod: 'POST',
    defaultMonitor: 'Catchpoint API Engine',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'body', 'transaction', 'script', 'assertions'],
    description:
      'HTTP REST, GraphQL, or SOAP XML endpoint monitor with custom method, headers, payload body, script checks, and assertions.',
  },
  {
    type: 'grpc',
    label: 'gRPC (HTTP/2 Protobuf)',
    shortLabel: 'gRPC',
    family: 'api',
    familyLabel: 'API & Streaming',
    defaultProtocol: 'gRPC / HTTP2',
    defaultMethod: 'POST',
    defaultMonitor: 'gRPC Channel Prober',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'headers', 'body', 'assertions'],
    description:
      'HTTP/2 gRPC unary health & service call with TLS ALPN negotiation and protobuf status validation.',
  },
  {
    type: 'websocket',
    label: 'WebSocket (WS / WSS)',
    shortLabel: 'WebSocket',
    family: 'api',
    familyLabel: 'API & Streaming',
    defaultProtocol: 'WSS / RFC6455',
    defaultMethod: 'GET',
    defaultMonitor: 'WebSocket Prober',
    defaultPort: 443,
    defaultExpectedStatus: '101',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'headers', 'body', 'assertions'],
    description:
      'Validates WebSocket Upgrade handshake (101 Switching Protocols), bidirectional message exchange, and ping RTT.',
  },
  {
    type: 'dns-direct',
    label: 'DNS Direct (Authoritative Query)',
    shortLabel: 'DNS Direct',
    family: 'dns',
    familyLabel: 'DNS & DNSSEC',
    defaultProtocol: 'DNS / UDP+TCP',
    defaultMethod: 'QUERY',
    defaultMonitor: 'Direct DNS Resolver',
    defaultPort: 53,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['dns', 'port', 'assertions'],
    description:
      'Queries authoritative nameservers directly for A, AAAA, CNAME, MX, TXT, NS, SRV, or CAA records and TTL parity.',
  },
  {
    type: 'dns-experience',
    label: 'DNS Experience (Recursive + DNSSEC)',
    shortLabel: 'DNS Experience',
    family: 'dns',
    familyLabel: 'DNS & DNSSEC',
    defaultProtocol: 'DNSSEC / DoH',
    defaultMethod: 'QUERY',
    defaultMonitor: 'Recursive DNS Agent',
    defaultPort: 53,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['dns', 'assertions'],
    description:
      'Measures end-to-end recursive resolution time, CNAME chain hops, Akamai Edge DNS routing, and DNSSEC validation.',
  },
  {
    type: 'ping',
    label: 'Ping (ICMP / TCP Echo)',
    shortLabel: 'Ping',
    family: 'network',
    familyLabel: 'Network & SSL',
    defaultProtocol: 'ICMP / TCP',
    defaultMethod: 'HEAD',
    defaultMonitor: 'Network Ping Agent',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'assertions'],
    description:
      'Measures edge node reachability, round-trip latency (min/avg/max), jitter, and packet loss rate.',
  },
  {
    type: 'traceroute',
    label: 'Traceroute (Hop-by-Hop Path)',
    shortLabel: 'Traceroute',
    family: 'network',
    familyLabel: 'Network & SSL',
    defaultProtocol: 'TCP / ICMP Trace',
    defaultMethod: 'HEAD',
    defaultMonitor: 'MTR Path Analyzer',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'assertions'],
    description:
      'Captures intermediate network hops, AS numbers, and per-hop RTT between AWS PoP agents and Akamai Edge IPs.',
  },
  {
    type: 'ssl',
    label: 'SSL / TLS Certificate Monitor',
    shortLabel: 'SSL / TLS',
    family: 'network',
    familyLabel: 'Network & SSL',
    defaultProtocol: 'TLSv1.3 / X.509',
    defaultMethod: 'HEAD',
    defaultMonitor: 'TLS Handshake Inspector',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'ssl', 'assertions'],
    description:
      'Verifies TLS certificate chain, SANs, cipher strength, OCSP stapling, and days until expiration across staging/prod.',
  },
  {
    type: 'transport-tcp',
    label: 'Transport (TCP / UDP Socket)',
    shortLabel: 'TCP Socket',
    family: 'network',
    familyLabel: 'Network & SSL',
    defaultProtocol: 'TCP Socket',
    defaultMethod: 'HEAD',
    defaultMonitor: 'Transport Socket Agent',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'assertions'],
    description:
      'Measures raw TCP 3-way handshake establish time and optional socket banner exchange on any port.',
  },
  {
    type: 'bgp',
    label: 'BGP (Routing & Prefix Hijack)',
    shortLabel: 'BGP Route',
    family: 'network',
    familyLabel: 'Network & SSL',
    defaultProtocol: 'BGP4 / Anycast',
    defaultMethod: 'QUERY',
    defaultMonitor: 'BGP Route Collector',
    defaultPort: 179,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['bgp', 'assertions'],
    description:
      'Monitors IP prefix visibility, Origin ASN (e.g. AS20940 Akamai / AS14340 Salesforce), and Anycast route stability.',
  },
  {
    type: 'ftp',
    label: 'FTP / SFTP File Transfer',
    shortLabel: 'FTP / SFTP',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'SFTP / FTPS',
    defaultMethod: 'GET',
    defaultMonitor: 'File Transfer Agent',
    defaultPort: 22,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'assertions'],
    description:
      'Tests FTP/SFTP endpoint connect, directory listing response time, and transfer throughput.',
  },
  {
    type: 'smtp',
    label: 'SMTP / Mail (IMAP / POP3)',
    shortLabel: 'SMTP Mail',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'SMTP + STARTTLS',
    defaultMethod: 'QUERY',
    defaultMonitor: 'Mail Relay Prober',
    defaultPort: 587,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'ssl', 'assertions'],
    description:
      'Validates SMTP relay banner (220), STARTTLS upgrade, and mail exchange latency.',
  },
  {
    type: 'mqtt',
    label: 'MQTT (IoT Pub/Sub Broker)',
    shortLabel: 'MQTT',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'MQTTS / TLS',
    defaultMethod: 'POST',
    defaultMonitor: 'MQTT Broker Agent',
    defaultPort: 8883,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'body', 'assertions'],
    description:
      'Connects over TLS to MQTT broker, publishes test telemetry payload, and validates topic acknowledgment latency.',
  },
  {
    type: 'ntp',
    label: 'NTP (Clock Stratum & Drift)',
    shortLabel: 'NTP',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'NTP / UDP 123',
    defaultMethod: 'QUERY',
    defaultMonitor: 'NTP Time Sync Agent',
    defaultPort: 123,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'assertions'],
    description:
      'Checks NTP time server stratum level and clock drift offset in milliseconds.',
  },
  {
    type: 'ldap',
    label: 'LDAP / LDAPS Directory',
    shortLabel: 'LDAP',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'LDAPS / TLS',
    defaultMethod: 'QUERY',
    defaultMonitor: 'Directory Bind Prober',
    defaultPort: 636,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'ssl', 'assertions'],
    description:
      'Validates LDAPS TLS handshake, directory bind availability, and identity lookup RTT.',
  },
  {
    type: 'ssh',
    label: 'SSH (Bastion Key Exchange)',
    shortLabel: 'SSH',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'SSH-2.0',
    defaultMethod: 'HEAD',
    defaultMonitor: 'SSH Banner Prober',
    defaultPort: 22,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'port', 'assertions'],
    description:
      'Probes SSH bastion TCP reachability, protocol version banner, and key exchange latency.',
  },
  {
    type: 'rum',
    label: 'RUM (Real User Monitoring Tag)',
    shortLabel: 'RUM Telemetry',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'HTTPS / Beacon',
    defaultMethod: 'GET',
    defaultMonitor: 'RUM Beacon & Vitals',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'assertions'],
    description:
      'Verifies RUM collector tag delivery, beacon endpoint availability, and Web Vitals collection headers.',
  },
  {
    type: 'custom',
    label: 'Custom Monitor / Node & Playwright Script',
    shortLabel: 'Custom Script',
    family: 'infra',
    familyLabel: 'Infra, Mail & RUM',
    defaultProtocol: 'Playwright / Node',
    defaultMethod: 'GET',
    defaultMonitor: 'Scriptable Runner',
    defaultPort: 443,
    defaultExpectedStatus: '200',
    supportsVisualScreenshot: true,
    configSections: ['http', 'headers', 'body', 'transaction', 'script', 'assertions'],
    description:
      'Custom Playwright, Puppeteer, Catchpoint, k6, Selenium, or Node/Fetch test script integrated with HTTP flow and visual gate.',
  },
];

export const DEFAULT_TEST_FOLDERS: TestFolder[] = [
  {
    id: 'folder-core',
    name: 'Core Experience & Edge Caching',
    description: 'Primary customer-facing web pages and CDN cache parity checks',
    color: 'sky',
    order: 1,
  },
  {
    id: 'folder-identity',
    name: 'Identity, Redirects & SSL',
    description: 'Edge redirects, auth gateways, SSL certificates, and DNSSEC checks',
    color: 'emerald',
    order: 2,
  },
  {
    id: 'folder-conversion',
    name: 'Transactions & Conversion Flows',
    description: 'Multi-step Playwright/Selenium lead capture, forms, and pricing journeys',
    color: 'amber',
    order: 3,
  },
  {
    id: 'folder-network',
    name: 'APIs, DNS & Network Protocols',
    description: 'REST/GraphQL/gRPC APIs, DNS Direct, Ping, Traceroute, BGP, and RUM tags',
    color: 'violet',
    order: 4,
  },
];

export function getCatchpointTypeMeta(
  type?: CatchpointTestType
): CatchpointTestTypeMeta {
  return (
    CATCHPOINT_TEST_TYPES.find((t) => t.type === (type || 'web-chrome')) ||
    CATCHPOINT_TEST_TYPES[0]
  );
}

/**
 * Infers sensible Catchpoint defaults (testType, folderId, monitorEngine, method)
 * for any existing or newly created test case definition.
 */
export function normalizeTestCaseWithCatchpointDefaults(
  tc: TestCaseDefinition,
  idx: number = 0
): TestCaseDefinition {
  const lowerPath = (tc.path || '').toLowerCase();
  const lowerCat = (tc.category || '').toLowerCase();

  let inferredType: CatchpointTestType = tc.testType || 'web-chrome';
  if (!tc.testType) {
    if (tc.expectedStatus === '301' || tc.expectedStatus === '302') {
      inferredType = 'http-object';
    } else if (
      lowerPath.includes('/api/') ||
      lowerPath.includes('oauth') ||
      lowerPath.includes('.well-known') ||
      lowerCat.includes('api')
    ) {
      inferredType = 'api';
    } else if (
      lowerPath.includes('signup') ||
      lowerPath.includes('form') ||
      lowerCat.includes('conversion')
    ) {
      inferredType = 'transaction-playwright';
    } else if (lowerPath.includes('health') || lowerCat.includes('telemetry')) {
      inferredType = 'http-object';
    }
  }

  let inferredFolder = tc.folderId;
  if (!inferredFolder) {
    if (
      inferredType === 'dns-direct' ||
      inferredType === 'dns-experience' ||
      inferredType === 'ping' ||
      inferredType === 'traceroute' ||
      inferredType === 'bgp' ||
      inferredType === 'api' ||
      inferredType === 'grpc' ||
      inferredType === 'websocket'
    ) {
      inferredFolder = 'folder-network';
    } else if (
      inferredType === 'transaction-playwright' ||
      inferredType === 'transaction-selenium' ||
      inferredType === 'playback'
    ) {
      inferredFolder = 'folder-conversion';
    } else if (
      inferredType === 'ssl' ||
      tc.expectedStatus === '301' ||
      tc.expectedStatus === '302' ||
      lowerCat.includes('identity') ||
      lowerCat.includes('trust') ||
      lowerCat.includes('redirect')
    ) {
      inferredFolder = 'folder-identity';
    } else {
      inferredFolder = 'folder-core';
    }
  }

  const meta = getCatchpointTypeMeta(inferredType);

  return {
    ...tc,
    testType: inferredType,
    monitorEngine: tc.monitorEngine || meta.defaultMonitor,
    folderId: inferredFolder,
    httpMethod: tc.httpMethod || meta.defaultMethod || 'GET',
    port: tc.port ?? meta.defaultPort,
    scheduleIntervalMin: tc.scheduleIntervalMin ?? 5,
    slaWarningMs: tc.slaWarningMs ?? 800,
    slaCriticalMs: tc.slaCriticalMs ?? 2000,
    enabled: tc.enabled !== false,
    order: tc.order ?? idx + 1,
    dnsRecordType:
      tc.dnsRecordType ||
      (inferredType === 'dns-direct' || inferredType === 'dns-experience'
        ? 'A'
        : undefined),
    sslMinExpiryDays:
      tc.sslMinExpiryDays ?? (inferredType === 'ssl' ? 30 : undefined),
    transactionSteps:
      tc.transactionSteps && tc.transactionSteps.length > 0
        ? tc.transactionSteps
        : inferredType === 'transaction-playwright' ||
          inferredType === 'transaction-selenium'
        ? [
            { step: 1, action: 'open', target: tc.path || '/' },
            {
              step: 2,
              action: 'waitForSelector',
              target: 'main, form, h1',
            },
            {
              step: 3,
              action: 'assertStatus',
              target: tc.path || '/',
              value: tc.expectedStatus || '200',
            },
            { step: 4, action: 'screenshot', target: '1280x760' },
          ]
        : tc.transactionSteps,
  };
}

export function normalizeSuiteWithCatchpointDefaults(
  suite: TestCaseDefinition[]
): TestCaseDefinition[] {
  return suite.map((tc, idx) => normalizeTestCaseWithCatchpointDefaults(tc, idx));
}

export function validateTestDraft(draft: Partial<TestCaseDefinition>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const cleanId = (draft.id || '').trim();
  const cleanName = (draft.name || '').trim();
  const cleanPath = (draft.path || '').trim();
  const testType = draft.testType || 'web-chrome';

  if (!cleanId) {
    errors.id = 'Test ID is required (e.g. T09)';
  } else if (!/^[A-Za-z0-9_-]{2,24}$/.test(cleanId)) {
    errors.id = 'Test ID must be 2–24 alphanumeric, hyphen, or underscore characters';
  }

  if (!cleanName) {
    errors.name = 'Test name is required';
  }

  if (testType === 'bgp') {
    if (!(draft.bgpPrefix || cleanPath || draft.targetHost || '').trim()) {
      errors.bgpPrefix = 'BGP prefix or target host is required';
    }
  } else if (!cleanPath && !(draft.targetHost || '').trim()) {
    errors.path = 'Target path or host is required';
  }

  if (draft.port !== undefined && (Number.isNaN(draft.port) || draft.port < 1 || draft.port > 65535)) {
    errors.port = 'Port must be between 1 and 65535';
  }

  if (
    draft.slaWarningMs !== undefined &&
    draft.slaCriticalMs !== undefined &&
    draft.slaWarningMs > draft.slaCriticalMs
  ) {
    errors.slaCriticalMs = 'Critical SLA threshold must be ≥ Warning threshold';
  }

  if (draft.customScript?.trim()) {
    const scriptCheck = validateScriptSyntaxQuick(draft.customScript);
    if (!scriptCheck.valid && scriptCheck.error) {
      errors.customScript = scriptCheck.error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateEnvironmentDraft(draft: Partial<EnvironmentConfig>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const cleanId = (draft.id || '').trim().toLowerCase();
  const cleanName = (draft.name || '').trim();

  if (!cleanId) {
    errors.id = 'Environment ID is required (e.g. qa, uat, prod)';
  } else if (!/^[a-z0-9-]{2,24}$/.test(cleanId)) {
    errors.id = 'Environment ID must be lowercase alphanumeric or hyphens (2–24 chars)';
  }

  if (!cleanName) {
    errors.name = 'Display name is required';
  }

  const hostEntries = Object.entries(draft.hostMap || {}).filter(
    ([k, v]) => k.trim() && v.trim()
  );
  if (hostEntries.length === 0) {
    errors.hostMap = 'At least one canonical → target host mapping is required';
  }

  const nets = draft.networks || [];
  if (nets.length === 0) {
    errors.networks = 'Select at least one edge network (staging or prod)';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function generateNextTestId(suite: TestCaseDefinition[]): string {
  let maxNum = 0;
  for (const tc of suite) {
    const match = tc.id.match(/^T(\d+)$/i);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  const next = Math.max(suite.length + 1, maxNum + 1);
  return `T${String(next).padStart(2, '0')}`;
}

export function upsertTestInSuite(
  suite: TestCaseDefinition[],
  draft: TestCaseDefinition,
  originalId?: string
): TestCaseDefinition[] {
  const normalized = normalizeTestCaseWithCatchpointDefaults(
    {
      ...draft,
      id: draft.id.trim().toUpperCase(),
      name: draft.name.trim(),
      path: draft.path.trim()
        ? draft.path.trim().startsWith('/') || /^https?:\/\//i.test(draft.path.trim())
          ? draft.path.trim()
          : `/${draft.path.trim()}`
        : '/',
    },
    suite.length
  );

  const matchKey = (originalId || normalized.id).toUpperCase();
  const existingIdx = suite.findIndex((t) => t.id.toUpperCase() === matchKey);

  if (existingIdx >= 0) {
    return suite.map((t, i) => (i === existingIdx ? normalized : t));
  }
  return [...suite, normalized];
}

export function cloneTestInSuite(
  suite: TestCaseDefinition[],
  testId: string
): { suite: TestCaseDefinition[]; cloned?: TestCaseDefinition } {
  const src = suite.find((t) => t.id === testId);
  if (!src) return { suite };
  const nextId = generateNextTestId(suite);
  const cloned = normalizeTestCaseWithCatchpointDefaults(
    {
      ...src,
      id: nextId,
      name: `${src.name} (Copy)`,
      order: suite.length + 1,
    },
    suite.length
  );
  return {
    suite: [...suite, cloned],
    cloned,
  };
}

export function deleteTestsFromSuite(
  suite: TestCaseDefinition[],
  ids: string[]
): TestCaseDefinition[] {
  const idSet = new Set(ids.map((id) => id.toUpperCase()));
  return suite.filter((t) => !idSet.has(t.id.toUpperCase()));
}

export function moveTestsToFolder(
  suite: TestCaseDefinition[],
  ids: string[],
  folderId: string
): TestCaseDefinition[] {
  const idSet = new Set(ids.map((id) => id.toUpperCase()));
  return suite.map((t) =>
    idSet.has(t.id.toUpperCase()) ? { ...t, folderId } : t
  );
}

export function toggleTestsEnabled(
  suite: TestCaseDefinition[],
  ids: string[],
  enabled: boolean
): TestCaseDefinition[] {
  const idSet = new Set(ids.map((id) => id.toUpperCase()));
  return suite.map((t) =>
    idSet.has(t.id.toUpperCase()) ? { ...t, enabled } : t
  );
}

export function reorderTestInSuite(
  suite: TestCaseDefinition[],
  testId: string,
  direction: 'up' | 'down'
): TestCaseDefinition[] {
  const idx = suite.findIndex((t) => t.id === testId);
  if (idx < 0) return suite;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= suite.length) return suite;
  const next = [...suite];
  const [moved] = next.splice(idx, 1);
  next.splice(swapIdx, 0, moved);
  return next.map((t, i) => ({ ...t, order: i + 1 }));
}

export function upsertEnvironmentInApp(
  app: AppConfig,
  envDraft: EnvironmentConfig,
  originalEnvId?: string
): AppConfig {
  const cleanId = envDraft.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const canonicalHost = resolvePropertyHostname(app.id, 'prod');
  const cleanHostMap =
    Object.keys(envDraft.hostMap || {}).length > 0
      ? envDraft.hostMap
      : { [canonicalHost]: canonicalHost };

  const normalizedEnv: EnvironmentConfig = {
    ...envDraft,
    id: cleanId,
    name: envDraft.name.trim() || cleanId.toUpperCase(),
    tier: envDraft.tier || (cleanId === 'prod' ? 'prod' : (cleanId as EnvironmentTier) || 'uat'),
    hostMap: cleanHostMap,
    networks:
      envDraft.networks && envDraft.networks.length > 0
        ? envDraft.networks
        : ['prod', 'staging'],
    scheduleIntervalMin: envDraft.scheduleIntervalMin ?? 5,
    alertThresholdMs: envDraft.alertThresholdMs ?? 1200,
  };

  const matchId = (originalEnvId || cleanId).toLowerCase();
  const idx = app.envs.findIndex((e) => e.id.toLowerCase() === matchId);
  const nextEnvs =
    idx >= 0
      ? app.envs.map((e, i) => (i === idx ? normalizedEnv : e))
      : [...app.envs, { ...normalizedEnv, order: app.envs.length + 1 }];

  return {
    ...app,
    envs: nextEnvs.map((e, i) => ({ ...e, order: i + 1 })),
  };
}

export function deleteEnvironmentFromApp(
  app: AppConfig,
  envId: string
): { app: AppConfig; deleted: boolean; error?: string } {
  if (app.envs.length <= 1) {
    return {
      app,
      deleted: false,
      error: 'A property must retain at least one environment',
    };
  }
  const nextEnvs = app.envs.filter((e) => e.id !== envId);
  return {
    app: {
      ...app,
      envs: nextEnvs.map((e, i) => ({ ...e, order: i + 1 })),
    },
    deleted: nextEnvs.length < app.envs.length,
  };
}

export function reorderEnvironmentInApp(
  app: AppConfig,
  envId: string,
  direction: 'up' | 'down'
): AppConfig {
  const idx = app.envs.findIndex((e) => e.id === envId);
  if (idx < 0) return app;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= app.envs.length) return app;
  const nextEnvs = [...app.envs];
  const [moved] = nextEnvs.splice(idx, 1);
  nextEnvs.splice(swapIdx, 0, moved);
  return {
    ...app,
    envs: nextEnvs.map((e, i) => ({ ...e, order: i + 1 })),
  };
}

export function upsertFolder(
  folders: TestFolder[],
  draft: TestFolder
): TestFolder[] {
  const cleanId =
    draft.id.trim() ||
    `folder-${draft.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}`;
  const nextDraft: TestFolder = {
    ...draft,
    id: cleanId,
    name: draft.name.trim(),
    color: draft.color || 'sky',
  };
  const idx = folders.findIndex((f) => f.id === nextDraft.id);
  if (idx >= 0) {
    return folders.map((f, i) => (i === idx ? nextDraft : f));
  }
  return [...folders, { ...nextDraft, order: folders.length + 1 }];
}

export function deleteFolderAndReassign(
  folders: TestFolder[],
  suite: TestCaseDefinition[],
  folderId: string,
  fallbackFolderId: string = 'folder-core'
): { folders: TestFolder[]; suite: TestCaseDefinition[] } {
  const remaining = folders.filter((f) => f.id !== folderId);
  const safeFallback =
    remaining.find((f) => f.id === fallbackFolderId)?.id ||
    remaining[0]?.id ||
    'folder-core';
  return {
    folders: remaining,
    suite: suite.map((t) =>
      t.folderId === folderId ? { ...t, folderId: safeFallback } : t
    ),
  };
}
