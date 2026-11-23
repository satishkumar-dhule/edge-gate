export type OverallVerdict = 'GO' | 'REVIEW' | 'NO-GO' | 'COMPARING' | 'PARTIAL' | 'NONE';
export type ItemVerdict = 'same' | 'minor' | 'different' | 'error';
export type VisualVerdict = 'same' | 'minor' | 'different' | 'error';
export type ComparisonKind = 'network' | 'env' | 'adhoc';
export type TargetState = 'ready' | 'running' | 'failed';

export type TestClass =
  | 'stable'
  | 'failing in all'
  | 'regressed'
  | 'flaky'
  | 'n/N failed';

export type CatchpointMonitorFamily =
  | 'web'
  | 'transaction'
  | 'api'
  | 'dns'
  | 'network'
  | 'infra';

export type CatchpointTestType =
  | 'web-chrome'
  | 'web-mobile'
  | 'http-object'
  | 'playback'
  | 'streaming'
  | 'transaction-playwright'
  | 'transaction-selenium'
  | 'api'
  | 'grpc'
  | 'websocket'
  | 'dns-direct'
  | 'dns-experience'
  | 'ping'
  | 'traceroute'
  | 'ssl'
  | 'transport-tcp'
  | 'bgp'
  | 'ftp'
  | 'smtp'
  | 'mqtt'
  | 'ntp'
  | 'ldap'
  | 'ssh'
  | 'rum'
  | 'custom';

export type TestScriptEngine =
  | 'playwright'
  | 'puppeteer'
  | 'catchpoint'
  | 'selenium'
  | 'k6'
  | 'node-fetch';

export interface TransactionStep {
  step: number;
  action: 'open' | 'click' | 'type' | 'waitForSelector' | 'assertText' | 'assertStatus' | 'screenshot';
  target: string;
  value?: string;
  assertText?: string;
}

export interface ScriptExecutionResult {
  engine: TestScriptEngine;
  executionMode: 'real-chromium-playwright' | 'emulated-script-runner';
  passed: boolean;
  durationMs: number;
  finalUrl?: string;
  pageTitle?: string;
  stepLogs: TransactionStepResult[];
  consoleLogs: string[];
  metrics?: {
    domContentLoadedMs?: number;
    loadEventMs?: number;
    lcpMs?: number;
    resourceCount?: number;
  };
  error?: string;
}

export interface TestAssertions {
  expectedBodyMatch?: string;
  maxLatencyMs?: number;
  minTlsVersion?: string;
  requireDnssec?: boolean;
  maxHops?: number;
}

export interface TestFolder {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  color?: 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
  order?: number;
}

export interface HostMap {
  [canonicalHost: string]: string;
}

export type EnvironmentTier = 'prod' | 'staging' | 'uat' | 'qa' | 'dev' | 'canary' | 'dr';

export interface EnvironmentConfig {
  id: string;
  name: string;
  tier?: EnvironmentTier;
  description?: string;
  hostMap: HostMap;
  networks?: ('staging' | 'prod')[];
  edgeIps?: {
    staging?: string;
    prod?: string;
  };
  defaultPopId?: string;
  headers?: Record<string, string>;
  variables?: Record<string, string>;
  scheduleIntervalMin?: number;
  alertThresholdMs?: number;
  pinnedBaselineRunKey?: string;
  order?: number;
}

export interface AppConfig {
  id: string;
  name: string;
  suitePath: string;
  division?: string;
  folder?: string;
  description?: string;
  tags?: string[];
  defaultNetworks: ('staging' | 'prod')[];
  envs: EnvironmentConfig[];
  headers?: Record<string, string>;
}

export interface HttpHopTimings {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  transferMs: number;
  totalMs: number;
}

export interface RedirectHop {
  hopNumber?: number;
  method: string;
  url: string;
  protocol?: string;
  status: number;
  statusText?: string;
  startOffsetMs: number;
  durationMs: number;
  timings?: HttpHopTimings;
  edgeIp?: string;
  edgeCname?: string;
  tlsProtocol?: string;
  tlsCipher?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  cookiesSet?: string[];
  redirectLocation?: string;
  bytesTransferred?: number;
}

export interface HttpFlowSummary {
  totalHops: number;
  redirectCount: number;
  totalDnsMs: number;
  totalTcpMs: number;
  totalTlsMs: number;
  totalTtfbMs: number;
  totalTransferMs: number;
  totalDurationMs: number;
  finalUrl: string;
  protocol: string;
  tlsVersion: string;
  tlsCipher?: string;
  resolvedEdgeIp?: string;
  resolvedEdgeCname?: string;
  liveCaptured?: boolean;
  capturedAt?: string;
  executionPopId?: string;
  executionPopCode?: string;
}

export interface ExecutionPopMeta {
  id: string;
  popCode: string;
  regionLabel: string;
  awsRegion: string;
  stagingPopCode: string;
  prodPopCode: string;
  stagingEdgeIp: string;
  prodEdgeIp: string;
}

export interface TransactionStepResult {
  step: number;
  action: TransactionStep['action'];
  target: string;
  value?: string;
  assertText?: string;
  status: 'pass' | 'fail';
  durationMs: number;
  detail?: string;
}

export interface DnsProbeResult {
  recordType: string;
  server: string;
  answers: string[];
  ttlSec?: number;
  dnssecValid?: boolean;
  queryMs: number;
}

export interface SslProbeResult {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  tlsProtocol: string;
  cipher: string;
  sanCount: number;
  authorized?: boolean;
}

export interface NetworkProbeResult {
  protocol: string;
  port: number;
  remoteIp?: string;
  tcpHandshakeMs: number;
  rttMs?: number;
  packetLossPct?: number;
  bgpPrefix?: string;
  bgpOriginAsn?: string;
  hopsCount?: number;
}

export interface AssertionResult {
  rule: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface TestResult {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string;
  pass: boolean;
  acceptedPass?: boolean; // After applying accepted rules
  errors: string[];
  expectedStatus: string;
  actualStatus: number;
  durationMs: number;
  testType?: CatchpointTestType;
  httpMethod?: string;
  requestHeadersSent?: Record<string, string>;
  requestBodySent?: string;
  transactionStepResults?: TransactionStepResult[];
  scriptResult?: ScriptExecutionResult;
  dnsResult?: DnsProbeResult;
  sslResult?: SslProbeResult;
  networkResult?: NetworkProbeResult;
  assertionResults?: AssertionResult[];
  responseBodySnippet?: string;
  capturedHeaders: {
    location?: string;
    'content-type'?: string;
    'cache-control'?: string;
    'x-check-cacheable'?: string;
    'x-sfdc-content-source'?: string;
    'x-cache'?: string;
    'x-cache-key'?: string;
    'x-true-cache-key'?: string;
    'x-akamai-request-id'?: string;
    [key: string]: string | undefined;
  };
  capturedCookies?: Record<string, string>;
  redirectChain: RedirectHop[];
  httpFlowSummary?: HttpFlowSummary;
  screenshotUrl?: string;
  stagingEdgeIp?: string;
  edgeHostname?: string;
  note?: string;
  probedAt?: string;
  probeCount?: number;
  screenshotCaptured?: boolean;
  screenshotRevision?: number;
  screenshotCapturedAt?: string;
  screenshotSha256?: string;
  screenshotBytes?: number;
  s3ScreenshotKey?: string;
  screenshotSource?:
    | 'playwright-chromium'
    | 'aws-lambda-chromium'
    | 'aws-cloudwatch-synthetics-canary'
    | 'canary-async-pending'
    | 'none';
  captureEngine?: string;
  canaryDispatched?: boolean;
  canaryName?: string;
  canaryError?: string;
  pixelDiffPercent?: number;
  changedBox?: { x: number; y: number; w: number; h: number } | null;
  zones?: {
    headerPct: number;
    heroCenterPct: number;
    rightPanelPct: number;
    lowerBodyPct: number;
    footerPct: number;
    headerEdgeContrastA?: number;
    headerEdgeContrastB?: number;
    rightEdgeContrastA?: number;
    rightEdgeContrastB?: number;
    meanLumDiff?: number;
  } | null;
}

export interface RunRecord {
  key: string;
  target: string; // e.g. "www.prod.staging"
  appId: string;
  suiteAppId?: string;
  envId: string;
  network: 'staging' | 'prod';
  suiteKey: string;
  suiteSha256: string;
  suiteRowCount: number;
  startTime: string;
  finishTime?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  by: string;
  label?: string;
  pinnedAsBaseline?: boolean;
  executionPop?: ExecutionPopMeta;
  results: TestResult[];
}

export type DifferenceKind =
  | 'status'
  | 'assertions'
  | 'only_ran_on'
  | 'header'
  | 'cookie'
  | 'visual';

export interface DifferenceItem {
  kind: DifferenceKind;
  field?: string; // e.g., "x-check-cacheable", "location", "cache-control", "content-type"
  candidateValue: string;
  baselineValue: string;
  severity: 'critical' | 'major' | 'minor';
  accepted?: boolean;
  acceptedRuleId?: string;
  isHostNormalizedMatch?: boolean;
}

export interface VisualDifferenceRegion {
  id?: string;
  region?: string;
  rationale?: string;
  parameterOrigin?: 'ai-page-derived' | 'bedrock-nova-lite' | 'gemini-multimodal';
  description: string;
  severity: 'major' | 'minor' | 'match';
  stagingObservation?: string;
  prodObservation?: string;
  impact?: string;
  zoneDeltaPct?: number;
  box?: { x: number; y: number; w: number; h: number }; // percentage 0-100
  accepted?: boolean;
}

export interface VisualJudgeResult {
  verdict: VisualVerdict;
  costGate: 'identical-bytes' | 'pixel-gate-passed' | 'ai-judged';
  costGateSkippedAi: boolean;
  pixelDiffPercent?: number;
  changedBox?: { x: number; y: number; w: number; h: number } | null;
  zones?: {
    headerPct: number;
    heroCenterPct: number;
    rightPanelPct: number;
    lowerBodyPct: number;
    footerPct: number;
    headerEdgeContrastA?: number;
    headerEdgeContrastB?: number;
    rightEdgeContrastA?: number;
    rightEdgeContrastB?: number;
    meanLumDiff?: number;
  } | null;
  summary: string;
  affectedArea?: string;
  shortCallout?: string;
  differences: VisualDifferenceRegion[];
  primaryModel: string;
  shadowModel?: string;
  shadowVerdict?: VisualVerdict;
  shadowAgreed?: boolean;
  acceptedRulesAppliedCount?: number;
}

export interface ComparisonItem {
  testId: string;
  testName: string;
  url: string;
  candidateResult?: TestResult;
  baselineResult?: TestResult;
  functionalDiffs: DifferenceItem[];
  cookieDiffs?: DifferenceItem[];
  visualResult?: VisualJudgeResult;
  itemVerdict: ItemVerdict; // Recomputed dynamically after applying accepted rules
  rawItemVerdict?: ItemVerdict; // Before rules
  candidateFailed?: boolean;
  baselineFailed?: boolean;
}

export interface AcceptedRule {
  id: string;
  appId: string;
  comparisonId: string; // specific comparison ID or "all"
  testId?: string; // specific test ID or undefined for all tests
  kind: string; // e.g. "x-check-cacheable", "cache-control", "status", "visual: cookie banner"
  enabled: boolean;
  by: string;
  at: string;
  note?: string;
}

export interface ComparisonRecord {
  comparisonId: string;
  appId: string;
  kind: ComparisonKind;
  candidateTarget: string;
  baselineTarget: string;
  candidateRunKey: string;
  baselineRunKey: string;
  candidateStartTime: string;
  baselineStartTime: string;
  candidateLabel?: string;
  isPinnedBaseline: boolean;
  pairingTimeGapMinutes: number;
  isPartial: boolean;
  headlineVerdict: OverallVerdict;
  counts: {
    same: number;
    minor: number;
    different: number;
    error: number;
    skipped: number;
    pending: number;
  };
  rollup: {
    functional: number;
    critical: number;
    visual: number;
    minor: number;
    error: number;
    failingOnCandidate: number;
  };
  items: ComparisonItem[];
}
