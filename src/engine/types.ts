/**
 * Akamai Synthetic Release Gate - Domain Types & Data Contracts
 * Reflects PRD (synthetics-tests) specification
 */

export type Network = 'prod' | 'staging';

export type ComparisonKind = 'network' | 'env' | 'adhoc';

export type OverallVerdict = 'GO' | 'REVIEW' | 'NO-GO' | 'PARTIAL' | 'COMPARING' | 'NONE';

export type ItemVerdict = 'different' | 'error' | 'minor' | 'same';

export type VisualVerdict = 'same' | 'minor' | 'different' | 'error';

export type UserRole = 'viewer' | 'operator' | 'admin' | 'owner';

export type TargetState = 'ready' | 'starting' | 'running' | 'stopping' | 'crashed';

export type TestClass = 'stable' | 'failing in all' | 'regressed' | 'flaky' | 'n/N failed';

export interface HostMap {
  [canonicalHost: string]: string; // e.g. "www.salesforce.com" -> "www-uat1.salesforce.com"
}

export interface EnvConfig {
  id: string;
  name: string;
  hostMap: HostMap;
  headers?: Record<string, string>;
  networks?: Network[]; // defaults to ['prod', 'staging']
  runSchedule?: string;
  comparisonSchedule?: string;
}

export interface EnvComparisonConfig {
  candidateEnv: string;
  baselineEnv: string;
  network?: Network; // defaults to 'prod'
  schedule?: string;
}

export interface AppConfig {
  id: string; // ^[a-z][a-z0-9-]{0,11}$
  name: string;
  suitePath: string;
  defaultNetworks?: Network[];
  headers?: Record<string, string>;
  envs: EnvConfig[];
  compareEnvs?: EnvComparisonConfig[];
}

export interface TargetTopology {
  targetId: string; // <app>.<env>.<network>
  appId: string;
  envId: string;
  network: Network;
  runnerName: string; // prefix-app-env-p|s (<= 21 chars)
}

export interface ComparisonTopology {
  comparisonId: string; // <app>.<env>.staging-vs-prod or <app>.<cand>-vs-<base>.<net>
  appId: string;
  kind: ComparisonKind;
  candidateTarget: string;
  baselineTarget: string;
  name: string;
}

export interface Topology {
  versionHash: string;
  apps: AppConfig[];
  targets: TargetTopology[];
  comparisons: ComparisonTopology[];
  headerNames: string[];
}

export interface SuiteRow {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  body?: string;
  requestHeaders?: string;
  expectedStatus: string; // e.g. "200" or "301,302"
  expectedHeaders?: string;
  bodyContains?: string;
  runOn?: string; // all, bare prod, staging, net:x, env:y, uat.staging
  screenshot: 'yes' | 'no';
  screenshotDelay?: number;
  screenshotWaitFor?: string;
  enabled: boolean;
}

export interface RedirectHop {
  method: string;
  url: string;
  status: number;
  startOffsetMs: number;
  durationMs: number;
  edgeIp: string;
  cacheHeader?: string;
  location?: string;
}

export interface TestResult {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string;
  pass: boolean;
  acceptedPass?: boolean;
  errors: string[];
  expectedStatus: string;
  actualStatus: number;
  durationMs: number;
  capturedHeaders: Record<string, string>;
  capturedCookies?: Record<string, string>;
  redirectChain: RedirectHop[];
  stagingEdgeIp?: string;
  edgeHostname?: string;
  fallbackDns?: boolean;
  note?: string;
  screenshotKey?: string;
  screenshotUrl?: string;
  screenshotError?: string;
  loadingFlag?: 'ready' | 'still loading';
}

export interface RunRecord {
  key: string; // results/<app>/<env>/<network>/<ts>.json
  target: string;
  appId: string;
  envId: string;
  network: Network;
  suiteKey: string;
  suiteSha256: string;
  suiteRowCount: number;
  startTime: string;
  finishTime: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  subset?: string[]; // test IDs if subset run
  by: string; // user name or "schedule"
  label?: string; // e.g. "CHG-1234"
  pinnedBaselineKey?: string;
  results: TestResult[];
}

export interface DifferenceItem {
  kind: 'status' | 'header' | 'cookie' | 'assertions' | 'only_ran_on' | 'visual';
  field?: string;
  candidateValue: string;
  baselineValue: string;
  severity: 'minor' | 'major';
  isHostNormalizedMatch?: boolean;
  accepted?: boolean;
  acceptedRuleId?: string;
}

export interface VisualJudgeDifference {
  description: string;
  severity: 'minor' | 'major';
  accepted?: boolean;
  ruleTag?: string;
}

export interface VisualJudgeResult {
  verdict: VisualVerdict;
  costGate: 'pixel-identical' | 'visually-identical (<0.1%)' | 'ai-judged' | 'error';
  costGateSkippedAi: boolean;
  pixelDiffPercent?: number;
  summary: string;
  differences: VisualJudgeDifference[];
  primaryModel: string;
  verificationModel?: string;
  secondOpinionChecked?: boolean;
  firstOpinionVerdict?: VisualVerdict;
  tileRegionsHint?: string[];
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
  itemVerdict: ItemVerdict;
  originalVerdict?: ItemVerdict;
  isOnlyOnOneSide?: 'candidate_only' | 'baseline_only';
  candidateFailed?: boolean;
  baselineFailed?: boolean;
}

export interface ComparisonRecord {
  key: string;
  comparisonId: string;
  appId: string;
  kind: ComparisonKind;
  candidateRunKey: string;
  baselineRunKey: string;
  candidateTarget: string;
  baselineTarget: string;
  candidateStartTime: string;
  baselineStartTime: string;
  candidateLabel?: string;
  isPinnedBaseline: boolean;
  pairingTimeGapMinutes: number;
  isPartial: boolean;
  version: number;
  versionType?: 'initial' | 'rerun' | 'rejudge';
  versionAuthor?: string;
  versionTime?: string;
  headlineVerdict: OverallVerdict;
  counts: {
    different: number;
    error: number;
    minor: number;
    same: number;
  };
  rollup: {
    functional: number;
    critical: number;
    visual: number;
    minor: number;
    error: number;
    failingOnCandidate: number;
  };
  suitesDiffer: boolean;
  candidateSuiteHash: string;
  baselineSuiteHash: string;
  modelUsed: string;
  items: ComparisonItem[];
}

export interface AcceptedRule {
  id: string; // e.g. rule-174128...
  appId: string;
  comparisonId: string; // target comparison or "all"
  kind: string; // header name like "x-check-cacheable", "status", "assertions", "visual: <desc>", "error: <msg>"
  testId?: string; // specific test ID or undefined for all tests of the comparison
  enabled: boolean;
  example?: string;
  by: string;
  at: string;
}

export interface AuditEvent {
  id: string;
  time: string;
  user: string;
  role: UserRole;
  action: string;
  ok: boolean;
  status: number;
  scope?: {
    appId?: string;
    envId?: string;
    targetId?: string;
    comparisonId?: string;
  };
  detail: string;
  clientIp: string;
  userAgent: string;
  outcome?: string;
}

export interface UserAccount {
  username: string;
  role: UserRole;
  enabled: boolean;
  passwordHash: string;
  mustChangePassword?: boolean;
  lastLoginAt?: string;
}
