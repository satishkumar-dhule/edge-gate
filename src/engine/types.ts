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

export interface HostMap {
  [canonicalHost: string]: string;
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  hostMap: HostMap;
  networks?: ('staging' | 'prod')[];
  pinnedBaselineRunKey?: string;
}

export interface AppConfig {
  id: string;
  name: string;
  suitePath: string;
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
}

export interface RunRecord {
  key: string;
  target: string; // e.g. "www.prod.staging"
  appId: string;
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
  description: string;
  severity: 'major' | 'minor';
  box?: { x: number; y: number; w: number; h: number }; // percentage 0-100
  accepted?: boolean;
}

export interface VisualJudgeResult {
  verdict: VisualVerdict;
  costGate: 'identical-bytes' | 'pixel-gate-passed' | 'ai-judged';
  costGateSkippedAi: boolean;
  pixelDiffPercent?: number;
  summary: string;
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
