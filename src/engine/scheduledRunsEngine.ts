import { AppConfig, OverallVerdict, RunRecord } from './types';
import {
  GLOBAL_EXECUTION_POPS,
  TestCaseDefinition,
  getPropertyTestSuite,
} from '../config/template.config';
import { PropertyGateSummary } from './workbenchModel';

export type ScheduleTimeRange = '1h' | '6h' | '24h' | '7d' | '30d';
export type ScheduleGraphMode =
  | 'timeseries'
  | 'scatterplot'
  | 'breakdown'
  | 'cwv-cache'
  | 'sla-availability';

export type ScheduleIntervalMinutes = 1 | 5 | 10 | 15 | 30 | 60;

export type PopDistributionStrategy =
  | 'round-robin'
  | 'all-pops'
  | 'primary-regional';

export type EdgeCacheState =
  | 'TCP_HIT'
  | 'TCP_MEM_HIT'
  | 'TCP_MISS'
  | 'TCP_REFRESH_HIT';

export interface MaintenanceWindowConfig {
  id: string;
  label: string;
  startOffsetPct: number; // 0-100 across window
  endOffsetPct: number;
  reason: string;
}

export interface SchedulePolicyConfig {
  id: string;
  appId: string;
  name: string;
  enabled: boolean;
  intervalMinutes: ScheduleIntervalMinutes;
  cronExpression: string;
  strategy: PopDistributionStrategy;
  assignedPops: string[];
  targetMode: 'staging-vs-prod' | 'staging-only' | 'prod-only';
  slaTargetPct: number;
  slaWarningMs: number;
  slaCriticalMs: number;
  alertOnHeaderDrift: boolean;
  alertOnCookieDrift: boolean;
  alertOnVisualDiff: boolean;
  maintenanceWindows: MaintenanceWindowConfig[];
}

export interface ScheduledCheckSnapshot {
  testId: string;
  testName: string;
  path: string;
  status: number;
  verdict: OverallVerdict;
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  transferMs: number;
  totalMs: number;
  baselineTotalMs: number;
  headerDiffs: number;
  cookieDiffs: number;
  visualDiff: boolean;
  visualDriftPct: number;
  cacheState: EdgeCacheState;
  lcpMs: number;
  fcpMs: number;
  inpMs: number;
  clsScore: number;
  payloadKb: number;
}

export interface ScheduledRunPoint {
  runId: string;
  index: number;
  timestampMs: number;
  timestampIso: string;
  timeLabel: string;
  shortDateLabel: string;
  appId: string;
  popId: string;
  popCode: string;
  popCity: string;
  regionGroup: string;
  verdict: OverallVerdict;
  availabilityPct: number;
  passedChecks: number;
  totalChecks: number;
  headerDiffs: number;
  cookieDiffs: number;
  visualDiffs: number;
  maxVisualDriftPct: number;
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  transferMs: number;
  totalMs: number;
  baselineTotalMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lcpMs: number;
  fcpMs: number;
  inpMs: number;
  clsScore: number;
  apdexScore: number;
  cacheHitRatioPct: number;
  originOffloadPct: number;
  payloadKb: number;
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
  errorRatePct: number;
  slaBreached: boolean;
  inMaintenanceWindow: boolean;
  maintenanceLabel?: string;
  deploymentMarker?: string;
  triggeredBy: 'scheduler-cron' | 'manual-trigger' | 'ci-webhook' | 'live-probe';
  checkSnapshots: ScheduledCheckSnapshot[];
}

export interface ScheduledPopPerformanceItem {
  popId: string;
  popCode: string;
  city: string;
  regionGroup: string;
  runCount: number;
  availabilityPct: number;
  avgTotalMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  cacheHitRatioPct: number;
  apdexScore: number;
  noGoCount: number;
  reviewCount: number;
  goCount: number;
}

export interface ScheduledSlaAnalytics {
  totalRuns: number;
  evaluatedRuns: number;
  excludedMaintenanceRuns: number;
  rawAvailabilityPct: number;
  purgedAvailabilityPct: number;
  effectiveAvailabilityPct: number;
  slaTargetPct: number;
  slaMet: boolean;
  errorBudgetRemainingPct: number;
  burnRateMultiplier: number;
  goCount: number;
  reviewCount: number;
  noGoCount: number;
  slaBreachCount: number;
  avgTotalMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  p99TotalMs: number;
  avgBaselineMs: number;
  avgDnsMs: number;
  avgTcpMs: number;
  avgTlsMs: number;
  avgTtfbMs: number;
  avgTransferMs: number;
  avgCacheHitRatioPct: number;
  avgOriginOffloadPct: number;
  avgApdexScore: number;
  avgLcpMs: number;
  avgFcpMs: number;
  avgInpMs: number;
  avgClsScore: number;
  status2xxTotal: number;
  status3xxTotal: number;
  status4xxTotal: number;
  status5xxTotal: number;
  popBreakdown: ScheduledPopPerformanceItem[];
}

export interface FleetTimelineBucket {
  index: number;
  timestampMs: number;
  timeLabel: string;
  shortDateLabel: string;
  availabilityPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  baselineMs: number;
  cacheHitRatioPct: number;
  apdexScore: number;
  noGoCount: number;
  reviewCount: number;
  goCount: number;
}

export interface FleetPropertyTelemetryRow extends PropertyGateSummary {
  availabilityPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  baselineP95Ms: number;
  p95DeltaMs: number;
  cacheHitRatioPct: number;
  apdexScore: number;
  lcpMs: number;
  cwvPassPct: number;
  errorBudgetRemainingPct: number;
  burnRateMultiplier: number;
  totalDiffCount: number;
  recentVerdicts: OverallVerdict[];
  recentLatenciesMs: number[];
}

export interface FleetRegionalPopSummary {
  popId: string;
  popCode: string;
  city: string;
  regionGroup: string;
  propertyCount: number;
  availabilityPct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  cacheHitRatioPct: number;
  apdexScore: number;
  incidentCount: number;
}

export interface FleetDashboardAnalytics {
  fleetKpis: {
    totalProperties: number;
    goCount: number;
    reviewCount: number;
    noGoCount: number;
    fleetAvailabilityPct: number;
    fleetP50Ms: number;
    fleetP95Ms: number;
    fleetP99Ms: number;
    fleetBaselineP95Ms: number;
    fleetCacheHitRatioPct: number;
    fleetApdex: number;
    fleetCwvPassPct: number;
    totalHeaderDiffs: number;
    totalCookieDiffs: number;
    totalVisualDiffs: number;
    activeBlockersCount: number;
    sloErrorBudgetRemainingPct: number;
  };
  fleetTimeline: FleetTimelineBucket[];
  propertyTelemetryRows: FleetPropertyTelemetryRow[];
  regionalPopTelemetry: FleetRegionalPopSummary[];
}

export function intervalToCronExpression(intervalMinutes: ScheduleIntervalMinutes): string {
  if (intervalMinutes === 1) return '* * * * *';
  if (intervalMinutes === 60) return '0 * * * *';
  return `*/${intervalMinutes} * * * *`;
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const weight = rank - lo;
  return Math.round(sorted[lo] * (1 - weight) + sorted[hi] * weight);
}

function computeApdexFromChecks(checks: ScheduledCheckSnapshot[], targetMs = 135): number {
  if (checks.length === 0) return 1.0;
  const frustratedMs = targetMs * 3.2;
  let satisfied = 0;
  let tolerating = 0;
  for (const c of checks) {
    if (c.status >= 500) continue;
    if (c.totalMs <= targetMs) satisfied++;
    else if (c.totalMs <= frustratedMs) tolerating++;
  }
  return Number(((satisfied + tolerating * 0.5) / checks.length).toFixed(2));
}

export function buildDefaultSchedulePolicy(app: AppConfig): SchedulePolicyConfig {
  const intervalMinutes: ScheduleIntervalMinutes =
    (app.envs[0]?.scheduleIntervalMin as ScheduleIntervalMinutes) || 5;
  const h = deterministicHash(app.id);
  const defaultPops = [
    GLOBAL_EXECUTION_POPS[h % GLOBAL_EXECUTION_POPS.length]?.id || 'iad',
    GLOBAL_EXECUTION_POPS[(h + 2) % GLOBAL_EXECUTION_POPS.length]?.id || 'lhr',
    GLOBAL_EXECUTION_POPS[(h + 4) % GLOBAL_EXECUTION_POPS.length]?.id || 'nrt',
  ];

  return {
    id: `sched-${app.id}`,
    appId: app.id,
    name: `${app.id.toUpperCase()} Edge Parity Canary`,
    enabled: true,
    intervalMinutes,
    cronExpression: intervalToCronExpression(intervalMinutes),
    strategy: 'round-robin',
    assignedPops: Array.from(new Set(defaultPops)),
    targetMode: 'staging-vs-prod',
    slaTargetPct: 99.5,
    slaWarningMs: app.envs[0]?.alertThresholdMs || 220,
    slaCriticalMs: 360,
    alertOnHeaderDrift: true,
    alertOnCookieDrift: true,
    alertOnVisualDiff: true,
    maintenanceWindows: [
      {
        id: `mw-${app.id}-1`,
        label: 'Akamai Staging Config Rollout Window',
        startOffsetPct: 34,
        endOffsetPct: 43,
        reason: 'Planned staging edge metadata propagation & cache purge',
      },
    ],
  };
}

export function getRangeConfig(range: ScheduleTimeRange): {
  pointCount: number;
  stepMinutes: number;
  label: string;
} {
  if (range === '1h') return { pointCount: 24, stepMinutes: 2.5, label: 'Last 1 Hour' };
  if (range === '6h') return { pointCount: 36, stepMinutes: 10, label: 'Last 6 Hours' };
  if (range === '7d') return { pointCount: 42, stepMinutes: 240, label: 'Last 7 Days' };
  if (range === '30d') return { pointCount: 48, stepMinutes: 900, label: 'Last 30 Days' };
  return { pointCount: 36, stepMinutes: 40, label: 'Last 24 Hours' };
}

function formatTimeLabels(tsMs: number, range: ScheduleTimeRange): {
  timeLabel: string;
  shortDateLabel: string;
} {
  const d = new Date(tsMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ];
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (range === '7d' || range === '30d') {
    return {
      timeLabel: `${mon} ${day} ${hh}:${mm}`,
      shortDateLabel: `${mon} ${day}`,
    };
  }
  return {
    timeLabel: `${hh}:${mm} UTC`,
    shortDateLabel: `${mon} ${day} ${hh}:${mm}`,
  };
}

function summarizeRunFromCheckSnapshots(params: {
  runId: string;
  index: number;
  timestampMs: number;
  timeLabel: string;
  shortDateLabel: string;
  appId: string;
  popId: string;
  popCode: string;
  popCity: string;
  regionGroup: string;
  policy: SchedulePolicyConfig;
  inMaintenanceWindow: boolean;
  maintenanceLabel?: string;
  deploymentMarker?: string;
  triggeredBy: ScheduledRunPoint['triggeredBy'];
  checkSnapshots: ScheduledCheckSnapshot[];
}): ScheduledRunPoint {
  const {
    runId,
    index,
    timestampMs,
    timeLabel,
    shortDateLabel,
    appId,
    popId,
    popCode,
    popCity,
    regionGroup,
    policy,
    inMaintenanceWindow,
    maintenanceLabel,
    deploymentMarker,
    triggeredBy,
    checkSnapshots,
  } = params;

  const totalChecks = Math.max(1, checkSnapshots.length);
  const passedChecks = checkSnapshots.filter(
    (c) => c.status < 400 && c.verdict !== 'NO-GO'
  ).length;
  const availabilityPct = Number(((passedChecks / totalChecks) * 100).toFixed(1));

  const headerDiffs = checkSnapshots.reduce((acc, c) => acc + c.headerDiffs, 0);
  const cookieDiffs = checkSnapshots.reduce((acc, c) => acc + c.cookieDiffs, 0);
  const visualDiffs = checkSnapshots.filter((c) => c.visualDiff).length;
  const maxVisualDriftPct = Number(
    Math.max(0, ...checkSnapshots.map((c) => c.visualDriftPct || 0)).toFixed(2)
  );

  const avg = (fn: (c: ScheduledCheckSnapshot) => number) =>
    Math.round(checkSnapshots.reduce((acc, c) => acc + fn(c), 0) / totalChecks);

  const dnsMs = avg((c) => c.dnsMs);
  const tcpMs = avg((c) => c.tcpMs);
  const tlsMs = avg((c) => c.tlsMs);
  const ttfbMs = avg((c) => c.ttfbMs);
  const transferMs = avg((c) => c.transferMs);
  const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + transferMs;
  const baselineTotalMs = avg((c) => c.baselineTotalMs);

  const sortedCheckTotals = [...checkSnapshots.map((c) => c.totalMs)].sort((a, b) => a - b);
  const p50Ms = Math.max(totalMs - 8, percentile(sortedCheckTotals, 50));
  const p95Ms = Math.max(totalMs, percentile(sortedCheckTotals, 95));
  const p99Ms = Math.max(p95Ms + 6, percentile(sortedCheckTotals, 99) + 9);

  const lcpMs = avg((c) => c.lcpMs);
  const fcpMs = avg((c) => c.fcpMs);
  const inpMs = avg((c) => c.inpMs);
  const clsScore = Number(
    (checkSnapshots.reduce((acc, c) => acc + c.clsScore, 0) / totalChecks).toFixed(3)
  );
  const apdexScore = computeApdexFromChecks(checkSnapshots, Math.round(policy.slaWarningMs * 0.65));

  const hitCount = checkSnapshots.filter(
    (c) => c.cacheState === 'TCP_HIT' || c.cacheState === 'TCP_MEM_HIT'
  ).length;
  const refreshCount = checkSnapshots.filter((c) => c.cacheState === 'TCP_REFRESH_HIT').length;
  const cacheHitRatioPct = Number(((hitCount / totalChecks) * 100).toFixed(1));
  const originOffloadPct = Number(
    (((hitCount + refreshCount * 0.65) / totalChecks) * 100).toFixed(1)
  );
  const payloadKb = avg((c) => c.payloadKb);

  const status2xxCount = checkSnapshots.filter((c) => c.status >= 200 && c.status < 300).length;
  const status3xxCount = checkSnapshots.filter((c) => c.status >= 300 && c.status < 400).length;
  const status4xxCount = checkSnapshots.filter((c) => c.status >= 400 && c.status < 500).length;
  const status5xxCount = checkSnapshots.filter((c) => c.status >= 500).length;
  const errorRatePct = Number(
    (((status4xxCount + status5xxCount) / totalChecks) * 100).toFixed(1)
  );

  const slaBreached = totalMs > policy.slaWarningMs || availabilityPct < 100;

  let verdict: OverallVerdict = 'GO';
  if (headerDiffs > 0 || availabilityPct < 100 || totalMs >= policy.slaCriticalMs) {
    verdict = 'NO-GO';
  } else if (cookieDiffs > 0 || visualDiffs > 0 || totalMs > policy.slaWarningMs) {
    verdict = 'REVIEW';
  }

  return {
    runId,
    index,
    timestampMs,
    timestampIso: new Date(timestampMs).toISOString(),
    timeLabel,
    shortDateLabel,
    appId,
    popId,
    popCode,
    popCity,
    regionGroup,
    verdict,
    availabilityPct,
    passedChecks,
    totalChecks: checkSnapshots.length,
    headerDiffs,
    cookieDiffs,
    visualDiffs,
    maxVisualDriftPct,
    dnsMs,
    tcpMs,
    tlsMs,
    ttfbMs,
    transferMs,
    totalMs,
    baselineTotalMs,
    p50Ms,
    p95Ms,
    p99Ms,
    lcpMs,
    fcpMs,
    inpMs,
    clsScore,
    apdexScore,
    cacheHitRatioPct,
    originOffloadPct,
    payloadKb,
    status2xxCount,
    status3xxCount,
    status4xxCount,
    status5xxCount,
    errorRatePct,
    slaBreached,
    inMaintenanceWindow,
    maintenanceLabel,
    deploymentMarker,
    triggeredBy,
    checkSnapshots,
  };
}

export function buildScheduledRunsDataset(params: {
  appId: string;
  suite: TestCaseDefinition[];
  policy: SchedulePolicyConfig;
  range: ScheduleTimeRange;
  referenceTimeMs?: number;
}): ScheduledRunPoint[] {
  const {
    appId,
    suite,
    policy,
    range,
    referenceTimeMs = Date.UTC(2026, 10, 15, 11, 55, 0),
  } = params;

  const { pointCount, stepMinutes } = getRangeConfig(range);
  const stepMs = stepMinutes * 60 * 1000;
  const activeSuite =
    Array.isArray(suite) && suite.length > 0
      ? suite
      : [{ id: 'T01', name: 'Home', path: '/', expectedStatus: '200' }];
  const popPool =
    policy.assignedPops.length > 0
      ? GLOBAL_EXECUTION_POPS.filter((p) => policy.assignedPops.includes(p.id))
      : GLOBAL_EXECUTION_POPS.slice(0, 3);
  const effectivePops = popPool.length > 0 ? popPool : [GLOBAL_EXECUTION_POPS[0]];

  const points: ScheduledRunPoint[] = [];

  for (let i = 0; i < pointCount; i++) {
    const progressPct = (i / Math.max(1, pointCount - 1)) * 100;
    const tsMs = referenceTimeMs - (pointCount - 1 - i) * stepMs;
    const { timeLabel, shortDateLabel } = formatTimeLabels(tsMs, range);
    const pop = effectivePops[i % effectivePops.length];
    const seed = deterministicHash(`${appId}:${range}:${i}:${pop.id}`);

    const matchedMw = policy.maintenanceWindows.find(
      (mw) => progressPct >= mw.startOffsetPct && progressPct <= mw.endOffsetPct
    );
    const inMaintenanceWindow = Boolean(matchedMw);

    // Deployment markers at specific timeline points
    let deploymentMarker: string | undefined;
    if (i === Math.floor(pointCount * 0.35)) {
      deploymentMarker = 'Staging PAPI v42 Rollout';
    } else if (i === Math.floor(pointCount * 0.78)) {
      deploymentMarker = 'Edge Cache-Control Hotfix';
    }

    // Anomaly / regression window around 35%-45% and occasional outlier spike at ~72%
    const isOutlierSpike = i === Math.floor(pointCount * 0.72) || i === pointCount - 1;
    const isMaintenanceDrift = inMaintenanceWindow;
    const diurnalWave = Math.round(Math.sin((i / Math.max(1, pointCount)) * Math.PI * 2.5) * 6);

    const checkSnapshots: ScheduledCheckSnapshot[] = activeSuite.map((tc, tcIdx) => {
      const cSeed = deterministicHash(`${seed}:${tc.id}:${tcIdx}`);
      const baseDns = 8 + (cSeed % 9);
      const baseTcp = 11 + ((cSeed >> 3) % 10);
      const baseTls = 18 + ((cSeed >> 6) % 14);
      const baseTtfb = 34 + ((cSeed >> 9) % 28) + tcIdx * 4;
      const baseTransfer = 12 + ((cSeed >> 12) % 15);
      const baselineTotalMs = baseDns + baseTcp + baseTls + baseTtfb + baseTransfer;

      const spikeFactor =
        isOutlierSpike && tcIdx < 2
          ? 95 + (cSeed % 55)
          : isMaintenanceDrift && tcIdx === 0
          ? 70 + (cSeed % 40)
          : (cSeed % 19) - 6 + diurnalWave;

      const dnsMs = Math.max(4, baseDns + (isMaintenanceDrift ? 8 : (cSeed % 4) - 1));
      const tcpMs = Math.max(6, baseTcp + ((cSeed >> 2) % 5) - 2);
      const tlsMs = Math.max(
        10,
        baseTls + (isOutlierSpike && tcIdx === 0 ? 24 : ((cSeed >> 4) % 6) - 2)
      );
      const ttfbMs = Math.max(18, baseTtfb + spikeFactor);
      const transferMs = Math.max(7, baseTransfer + ((cSeed >> 5) % 6) - 2);
      const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + transferMs;

      const hasHeaderDiff =
        (isOutlierSpike && tcIdx === 0) || (isMaintenanceDrift && tcIdx <= 1) ? 1 : 0;
      const hasCookieDiff =
        (isOutlierSpike && tcIdx === 1) || (i === pointCount - 1 && tcIdx === 1) ? 1 : 0;
      const hasVisualDiff = isMaintenanceDrift && tcIdx === 0 && cSeed % 2 === 0;
      const visualDriftPct = hasVisualDiff
        ? Number((2.4 + (cSeed % 65) * 0.12).toFixed(2))
        : Number(((cSeed % 7) * 0.01).toFixed(2));

      const expectedCode = parseInt(tc.expectedStatus || '200', 10) || 200;
      const status =
        isMaintenanceDrift && tcIdx === 0 && i === Math.floor(pointCount * 0.38)
          ? 503
          : expectedCode;

      const cacheMissTriggered =
        hasHeaderDiff > 0 || isMaintenanceDrift || (cSeed % 11 === 0 && tcIdx > 2);
      const cacheState: EdgeCacheState = cacheMissTriggered
        ? isMaintenanceDrift
          ? 'TCP_MISS'
          : 'TCP_REFRESH_HIT'
        : cSeed % 3 === 0
        ? 'TCP_MEM_HIT'
        : 'TCP_HIT';

      const fcpMs = Math.round(440 + ttfbMs * 2.15 + (cacheMissTriggered ? 280 : 0));
      const lcpMs = Math.round(
        fcpMs + 520 + transferMs * 4.5 + (cacheMissTriggered ? 540 : 0) + (status >= 500 ? 1100 : 0)
      );
      const inpMs = Math.round(38 + (cacheMissTriggered ? 46 : 14) + (cSeed % 28));
      const clsScore = hasVisualDiff
        ? Number((0.12 + (cSeed % 9) * 0.015).toFixed(3))
        : Number((0.004 + (cSeed % 8) * 0.002).toFixed(3));
      const payloadKb = 115 + ((cSeed >> 7) % 340);

      let checkVerdict: OverallVerdict = 'GO';
      if (status >= 500 || hasHeaderDiff > 0) {
        checkVerdict = 'NO-GO';
      } else if (hasCookieDiff > 0 || hasVisualDiff || totalMs > policy.slaWarningMs) {
        checkVerdict = 'REVIEW';
      }

      return {
        testId: tc.id,
        testName: tc.name,
        path: tc.path,
        status,
        verdict: checkVerdict,
        dnsMs,
        tcpMs,
        tlsMs,
        ttfbMs,
        transferMs,
        totalMs,
        baselineTotalMs,
        headerDiffs: hasHeaderDiff,
        cookieDiffs: hasCookieDiff,
        visualDiff: hasVisualDiff,
        visualDriftPct,
        cacheState,
        lcpMs,
        fcpMs,
        inpMs,
        clsScore,
        payloadKb,
      };
    });

    points.push(
      summarizeRunFromCheckSnapshots({
        runId: `SR-${appId.toUpperCase()}-${String(1000 + i)}`,
        index: i,
        timestampMs: tsMs,
        timeLabel,
        shortDateLabel,
        appId,
        popId: pop.id,
        popCode: pop.popCode,
        popCity: pop.city,
        regionGroup: pop.regionGroup,
        policy,
        inMaintenanceWindow,
        maintenanceLabel: matchedMw?.label,
        deploymentMarker,
        triggeredBy: deploymentMarker ? 'ci-webhook' : 'scheduler-cron',
        checkSnapshots,
      })
    );
  }

  return points;
}

export function ingestRealPortalRunsIntoSchedule(params: {
  basePoints: ScheduledRunPoint[];
  runs: RunRecord[];
  appId: string;
  suite: TestCaseDefinition[];
  policy: SchedulePolicyConfig;
}): ScheduledRunPoint[] {
  const { basePoints, runs, appId, suite, policy } = params;
  if (!Array.isArray(runs) || runs.length === 0) return basePoints;

  const candidateRuns = runs.filter(
    (r) =>
      r.target.toLowerCase().startsWith(`${appId.toLowerCase()}.`) &&
      r.target.toLowerCase().endsWith('.staging') &&
      Array.isArray(r.results) &&
      r.results.length > 0 &&
      (r.key.includes('live') || r.label?.toLowerCase().includes('live'))
  );

  if (candidateRuns.length === 0) return basePoints;

  const baselineRun = runs.find(
    (r) =>
      r.target.toLowerCase().startsWith(`${appId.toLowerCase()}.`) &&
      r.target.toLowerCase().endsWith('.prod')
  );

  const activeSuite =
    Array.isArray(suite) && suite.length > 0
      ? suite
      : [{ id: 'T01', name: 'Home', path: '/', expectedStatus: '200' }];

  const latestCandRun = candidateRuns[0];
  const runId = `SR-${appId.toUpperCase()}-LIVE`;
  if (basePoints.some((p) => p.runId === runId)) return basePoints;

  const popPool =
    policy.assignedPops.length > 0
      ? GLOBAL_EXECUTION_POPS.filter((p) => policy.assignedPops.includes(p.id))
      : GLOBAL_EXECUTION_POPS;
  const pop = popPool[basePoints.length % Math.max(1, popPool.length)] || GLOBAL_EXECUTION_POPS[0];

  const lastTs = basePoints[basePoints.length - 1]?.timestampMs || Date.now();
  const nowMs = lastTs + policy.intervalMinutes * 60_000;
  const d = new Date(nowMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');

  const checkSnapshots: ScheduledCheckSnapshot[] = activeSuite.map((tc, rIdx) => {
    const res =
      latestCandRun.results.find((r) => r.id === tc.id) ||
      latestCandRun.results[rIdx % latestCandRun.results.length];
    const baseRes =
      baselineRun?.results?.find((b) => b.id === tc.id) ||
      baselineRun?.results?.[rIdx % Math.max(1, baselineRun?.results?.length || 1)];

    const rawTotal = Math.max(
      48,
      Math.min(480, res?.httpFlowSummary?.totalDurationMs || res?.durationMs || 96 + rIdx * 6)
    );
    const dnsMs = Math.max(5, res?.httpFlowSummary?.totalDnsMs || Math.round(rawTotal * 0.1));
    const tcpMs = Math.max(8, Math.round(rawTotal * 0.12));
    const tlsMs = Math.max(14, Math.round(rawTotal * 0.18));
    const transferMs = Math.max(9, Math.round(rawTotal * 0.14));
    const ttfbMs = Math.max(18, rawTotal - (dnsMs + tcpMs + tlsMs + transferMs));
    const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + transferMs;
    const baselineTotalMs = Math.max(
      45,
      Math.min(
        420,
        baseRes?.httpFlowSummary?.totalDurationMs || baseRes?.durationMs || totalMs - 6
      )
    );

    const xCache = String(
      res?.capturedHeaders?.['x-cache'] ||
        res?.capturedHeaders?.['x-check-cacheable'] ||
        'TCP_HIT'
    ).toUpperCase();
    const cacheState: EdgeCacheState = xCache.includes('MEM_HIT')
      ? 'TCP_MEM_HIT'
      : xCache.includes('REFRESH')
      ? 'TCP_REFRESH_HIT'
      : xCache.includes('MISS') || xCache === 'NO'
      ? 'TCP_MISS'
      : 'TCP_HIT';

    const status = res?.actualStatus || parseInt(tc.expectedStatus || '200', 10) || 200;
    const statusMismatch = baseRes && baseRes.actualStatus !== status ? 1 : 0;
    const cacheMismatch =
      baseRes &&
      res &&
      baseRes.capturedHeaders?.['x-check-cacheable'] !==
        res.capturedHeaders?.['x-check-cacheable']
        ? 1
        : 0;
    const headerDiffs = statusMismatch + cacheMismatch;

    let verdict: OverallVerdict = 'GO';
    if (status >= 500 || headerDiffs > 0) verdict = 'NO-GO';
    else if (totalMs > policy.slaWarningMs) verdict = 'REVIEW';

    return {
      testId: tc.id,
      testName: tc.name,
      path: tc.path,
      status,
      verdict,
      dnsMs,
      tcpMs,
      tlsMs,
      ttfbMs,
      transferMs,
      totalMs,
      baselineTotalMs,
      headerDiffs,
      cookieDiffs: 0,
      visualDiff: false,
      visualDriftPct: 0,
      cacheState,
      fcpMs: Math.round(450 + ttfbMs * 2.1),
      lcpMs: Math.round(980 + totalMs * 3.1 + rIdx * 16),
      inpMs: 44 + rIdx * 3,
      clsScore: 0.006,
      payloadKb: 140 + rIdx * 18,
    };
  });

  const livePoint = summarizeRunFromCheckSnapshots({
    runId,
    index: basePoints.length,
    timestampMs: nowMs,
    timeLabel: `${hh}:${mm} UTC`,
    shortDateLabel: `Live Probe ${hh}:${mm}`,
    appId,
    popId: pop.id,
    popCode: pop.popCode,
    popCity: pop.city,
    regionGroup: pop.regionGroup,
    policy,
    inMaintenanceWindow: false,
    deploymentMarker: 'Live Gate Probe',
    triggeredBy: 'live-probe',
    checkSnapshots,
  });

  return [...basePoints, livePoint];
}

export function filterScheduledPoints(params: {
  points: ScheduledRunPoint[];
  popFilter: string;
  verdictFilter: 'ALL' | 'NO-GO' | 'REVIEW' | 'GO';
  checkIdFilter: string;
}): ScheduledRunPoint[] {
  const { points, popFilter, verdictFilter, checkIdFilter } = params;

  return points
    .filter((pt) => {
      if (popFilter !== 'ALL' && pt.popId !== popFilter) return false;
      if (verdictFilter !== 'ALL' && pt.verdict !== verdictFilter) return false;
      return true;
    })
    .map((pt) => {
      if (!checkIdFilter || checkIdFilter === 'ALL') return pt;
      const snap = pt.checkSnapshots.find((c) => c.testId === checkIdFilter);
      if (!snap) return pt;
      const isHit = snap.cacheState === 'TCP_HIT' || snap.cacheState === 'TCP_MEM_HIT';
      return {
        ...pt,
        verdict: snap.verdict,
        availabilityPct: snap.status < 400 && snap.verdict !== 'NO-GO' ? 100 : 0,
        passedChecks: snap.status < 400 && snap.verdict !== 'NO-GO' ? 1 : 0,
        totalChecks: 1,
        headerDiffs: snap.headerDiffs,
        cookieDiffs: snap.cookieDiffs,
        visualDiffs: snap.visualDiff ? 1 : 0,
        maxVisualDriftPct: snap.visualDriftPct,
        dnsMs: snap.dnsMs,
        tcpMs: snap.tcpMs,
        tlsMs: snap.tlsMs,
        ttfbMs: snap.ttfbMs,
        transferMs: snap.transferMs,
        totalMs: snap.totalMs,
        baselineTotalMs: snap.baselineTotalMs,
        p50Ms: snap.totalMs,
        p95Ms: snap.totalMs,
        p99Ms: snap.totalMs,
        lcpMs: snap.lcpMs,
        fcpMs: snap.fcpMs,
        inpMs: snap.inpMs,
        clsScore: snap.clsScore,
        cacheHitRatioPct: isHit ? 100 : 0,
        originOffloadPct: isHit ? 100 : snap.cacheState === 'TCP_REFRESH_HIT' ? 65 : 0,
      };
    });
}

export function computeScheduledSlaAnalytics(params: {
  points: ScheduledRunPoint[];
  policy: SchedulePolicyConfig;
  excludeMaintenanceWindows: boolean;
}): ScheduledSlaAnalytics {
  const { points, policy, excludeMaintenanceWindows } = params;
  if (points.length === 0) {
    return {
      totalRuns: 0,
      evaluatedRuns: 0,
      excludedMaintenanceRuns: 0,
      rawAvailabilityPct: 100,
      purgedAvailabilityPct: 100,
      effectiveAvailabilityPct: 100,
      slaTargetPct: policy.slaTargetPct,
      slaMet: true,
      errorBudgetRemainingPct: 100,
      burnRateMultiplier: 0,
      goCount: 0,
      reviewCount: 0,
      noGoCount: 0,
      slaBreachCount: 0,
      avgTotalMs: 0,
      p50TotalMs: 0,
      p95TotalMs: 0,
      p99TotalMs: 0,
      avgBaselineMs: 0,
      avgDnsMs: 0,
      avgTcpMs: 0,
      avgTlsMs: 0,
      avgTtfbMs: 0,
      avgTransferMs: 0,
      avgCacheHitRatioPct: 100,
      avgOriginOffloadPct: 100,
      avgApdexScore: 1,
      avgLcpMs: 0,
      avgFcpMs: 0,
      avgInpMs: 0,
      avgClsScore: 0,
      status2xxTotal: 0,
      status3xxTotal: 0,
      status4xxTotal: 0,
      status5xxTotal: 0,
      popBreakdown: [],
    };
  }

  const nonMaintPoints = points.filter((p) => !p.inMaintenanceWindow);
  const evaluated =
    excludeMaintenanceWindows && nonMaintPoints.length > 0 ? nonMaintPoints : points;

  const rawAvail =
    points.reduce((acc, p) => acc + p.availabilityPct, 0) / Math.max(1, points.length);
  const purgedAvail =
    nonMaintPoints.length > 0
      ? nonMaintPoints.reduce((acc, p) => acc + p.availabilityPct, 0) / nonMaintPoints.length
      : rawAvail;
  const effectiveAvailabilityPct = Number(
    (excludeMaintenanceWindows ? purgedAvail : rawAvail).toFixed(2)
  );

  const allowedDowntimePct = Math.max(0.05, 100 - policy.slaTargetPct);
  const actualDowntimePct = Math.max(0, 100 - effectiveAvailabilityPct);
  const errorBudgetRemainingPct = Number(
    Math.max(
      0,
      Math.min(100, ((allowedDowntimePct - actualDowntimePct) / allowedDowntimePct) * 100)
    ).toFixed(1)
  );
  const burnRateMultiplier = Number((actualDowntimePct / allowedDowntimePct).toFixed(2));

  const sortedTotals = [...evaluated.map((p) => p.totalMs)].sort((a, b) => a - b);
  const avg = (fn: (p: ScheduledRunPoint) => number) =>
    Math.round(evaluated.reduce((acc, p) => acc + fn(p), 0) / Math.max(1, evaluated.length));
  const avgFloat = (fn: (p: ScheduledRunPoint) => number, digits = 2) =>
    Number(
      (evaluated.reduce((acc, p) => acc + fn(p), 0) / Math.max(1, evaluated.length)).toFixed(
        digits
      )
    );

  // Build PoP breakdown across evaluated points
  const byPop = new Map<string, ScheduledRunPoint[]>();
  for (const pt of evaluated) {
    const list = byPop.get(pt.popId) || [];
    list.push(pt);
    byPop.set(pt.popId, list);
  }

  const popBreakdown: ScheduledPopPerformanceItem[] = Array.from(byPop.entries()).map(
    ([popId, popPts]) => {
      const first = popPts[0];
      const sortedPop = [...popPts.map((p) => p.totalMs)].sort((a, b) => a - b);
      const popAvail = Number(
        (popPts.reduce((acc, p) => acc + p.availabilityPct, 0) / popPts.length).toFixed(1)
      );
      const popCache = Number(
        (popPts.reduce((acc, p) => acc + p.cacheHitRatioPct, 0) / popPts.length).toFixed(1)
      );
      const popApdex = Number(
        (popPts.reduce((acc, p) => acc + p.apdexScore, 0) / popPts.length).toFixed(2)
      );
      return {
        popId,
        popCode: first.popCode,
        city: first.popCity,
        regionGroup: first.regionGroup,
        runCount: popPts.length,
        availabilityPct: popAvail,
        avgTotalMs: Math.round(popPts.reduce((acc, p) => acc + p.totalMs, 0) / popPts.length),
        p50Ms: percentile(sortedPop, 50),
        p95Ms: percentile(sortedPop, 95),
        p99Ms: percentile(sortedPop, 99),
        cacheHitRatioPct: popCache,
        apdexScore: popApdex,
        noGoCount: popPts.filter((p) => p.verdict === 'NO-GO').length,
        reviewCount: popPts.filter((p) => p.verdict === 'REVIEW').length,
        goCount: popPts.filter((p) => p.verdict === 'GO').length,
      };
    }
  );

  return {
    totalRuns: points.length,
    evaluatedRuns: evaluated.length,
    excludedMaintenanceRuns: points.length - nonMaintPoints.length,
    rawAvailabilityPct: Number(rawAvail.toFixed(2)),
    purgedAvailabilityPct: Number(purgedAvail.toFixed(2)),
    effectiveAvailabilityPct,
    slaTargetPct: policy.slaTargetPct,
    slaMet: effectiveAvailabilityPct >= policy.slaTargetPct,
    errorBudgetRemainingPct,
    burnRateMultiplier,
    goCount: evaluated.filter((p) => p.verdict === 'GO').length,
    reviewCount: evaluated.filter((p) => p.verdict === 'REVIEW').length,
    noGoCount: evaluated.filter((p) => p.verdict === 'NO-GO').length,
    slaBreachCount: evaluated.filter((p) => p.slaBreached).length,
    avgTotalMs: avg((p) => p.totalMs),
    p50TotalMs: percentile(sortedTotals, 50),
    p95TotalMs: percentile(sortedTotals, 95),
    p99TotalMs: percentile(sortedTotals, 99),
    avgBaselineMs: avg((p) => p.baselineTotalMs),
    avgDnsMs: avg((p) => p.dnsMs),
    avgTcpMs: avg((p) => p.tcpMs),
    avgTlsMs: avg((p) => p.tlsMs),
    avgTtfbMs: avg((p) => p.ttfbMs),
    avgTransferMs: avg((p) => p.transferMs),
    avgCacheHitRatioPct: avgFloat((p) => p.cacheHitRatioPct, 1),
    avgOriginOffloadPct: avgFloat((p) => p.originOffloadPct, 1),
    avgApdexScore: avgFloat((p) => p.apdexScore, 2),
    avgLcpMs: avg((p) => p.lcpMs),
    avgFcpMs: avg((p) => p.fcpMs),
    avgInpMs: avg((p) => p.inpMs),
    avgClsScore: avgFloat((p) => p.clsScore, 3),
    status2xxTotal: evaluated.reduce((acc, p) => acc + p.status2xxCount, 0),
    status3xxTotal: evaluated.reduce((acc, p) => acc + p.status3xxCount, 0),
    status4xxTotal: evaluated.reduce((acc, p) => acc + p.status4xxCount, 0),
    status5xxTotal: evaluated.reduce((acc, p) => acc + p.status5xxCount, 0),
    popBreakdown,
  };
}

export function appendLiveScheduledRunTick(params: {
  existingPoints: ScheduledRunPoint[];
  appId: string;
  suite: TestCaseDefinition[];
  policy: SchedulePolicyConfig;
  triggeredBy?: 'scheduler-cron' | 'manual-trigger';
  nowMs?: number;
}): ScheduledRunPoint {
  const {
    existingPoints,
    appId,
    suite,
    policy,
    triggeredBy = 'manual-trigger',
    nowMs = Date.now(),
  } = params;

  const nextIdx = existingPoints.length;
  const popPool =
    policy.assignedPops.length > 0
      ? GLOBAL_EXECUTION_POPS.filter((p) => policy.assignedPops.includes(p.id))
      : GLOBAL_EXECUTION_POPS;
  const pop = popPool[nextIdx % popPool.length] || GLOBAL_EXECUTION_POPS[0];
  const seed = deterministicHash(`${appId}:live:${nextIdx}:${nowMs}`);

  const d = new Date(nowMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');

  const activeSuite =
    suite.length > 0 ? suite : [{ id: 'T01', name: 'Home', path: '/', expectedStatus: '200' }];
  const checkSnapshots: ScheduledCheckSnapshot[] = activeSuite.map((tc, idx) => {
    const cSeed = deterministicHash(`${seed}:${tc.id}:${idx}`);
    const dnsMs = 8 + (cSeed % 7);
    const tcpMs = 11 + ((cSeed >> 2) % 8);
    const tlsMs = 17 + ((cSeed >> 4) % 11);
    const ttfbMs = 35 + ((cSeed >> 6) % 24) + idx * 3;
    const transferMs = 11 + ((cSeed >> 8) % 12);
    const totalMs = dnsMs + tcpMs + tlsMs + ttfbMs + transferMs;
    const baselineTotalMs = Math.max(45, totalMs - 4 + ((cSeed >> 10) % 9));
    const cacheState: EdgeCacheState = idx % 4 === 0 ? 'TCP_MEM_HIT' : 'TCP_HIT';

    return {
      testId: tc.id,
      testName: tc.name,
      path: tc.path,
      status: parseInt(tc.expectedStatus || '200', 10) || 200,
      verdict: totalMs > policy.slaWarningMs ? 'REVIEW' : 'GO',
      dnsMs,
      tcpMs,
      tlsMs,
      ttfbMs,
      transferMs,
      totalMs,
      baselineTotalMs,
      headerDiffs: 0,
      cookieDiffs: 0,
      visualDiff: false,
      visualDriftPct: 0,
      cacheState,
      fcpMs: Math.round(430 + ttfbMs * 2.05),
      lcpMs: Math.round(940 + totalMs * 3.1 + idx * 14),
      inpMs: 42 + (cSeed % 18),
      clsScore: 0.005,
      payloadKb: 120 + ((cSeed >> 5) % 210),
    };
  });

  return summarizeRunFromCheckSnapshots({
    runId: `SR-${appId.toUpperCase()}-${String(1000 + nextIdx)}`,
    index: nextIdx,
    timestampMs: nowMs,
    timeLabel: `${hh}:${mm}:${ss} UTC`,
    shortDateLabel: `Live ${hh}:${mm}:${ss}`,
    appId,
    popId: pop.id,
    popCode: pop.popCode,
    popCity: pop.city,
    regionGroup: pop.regionGroup,
    policy,
    inMaintenanceWindow: false,
    deploymentMarker: triggeredBy === 'manual-trigger' ? 'Manual Scheduled Trigger' : undefined,
    triggeredBy,
    checkSnapshots,
  });
}

export function buildFleetDashboardAnalytics(params: {
  summaries: PropertyGateSummary[];
  apps: AppConfig[];
  suitesByAppId?: Record<string, TestCaseDefinition[]>;
  schedulePoliciesByAppId?: Record<string, SchedulePolicyConfig>;
  range?: ScheduleTimeRange;
  referenceTimeMs?: number;
}): FleetDashboardAnalytics {
  const {
    summaries,
    apps,
    suitesByAppId = {},
    schedulePoliciesByAppId = {},
    range = '24h',
    referenceTimeMs = Date.UTC(2026, 10, 15, 11, 55, 0),
  } = params;

  const sampleSummaries = summaries.slice(0, 16);
  const datasetsByProp = new Map<string, { points: ScheduledRunPoint[]; sla: ScheduledSlaAnalytics }>();

  for (const s of sampleSummaries) {
    const appObj = apps.find((a) => a.id === s.appId) ||
      apps[0] || {
        id: s.appId,
        name: s.name,
        envs: [{ id: 'prod', label: 'Prod', scheduleIntervalMin: 5, alertThresholdMs: 220 }],
      };
    const policy = schedulePoliciesByAppId[s.appId] || buildDefaultSchedulePolicy(appObj);
    const suite = suitesByAppId[s.appId] || getPropertyTestSuite(s.appId);
    const points = buildScheduledRunsDataset({
      appId: s.appId,
      suite,
      policy,
      range,
      referenceTimeMs,
    });
    const sla = computeScheduledSlaAnalytics({
      points,
      policy,
      excludeMaintenanceWindows: true,
    });
    datasetsByProp.set(s.appId, { points, sla });
  }

  const propertyTelemetryRows: FleetPropertyTelemetryRow[] = summaries.map((s, idx) => {
    const cached = datasetsByProp.get(s.appId);
    const seed = deterministicHash(`${s.appId}:${range}:${idx}`);
    const totalDiffCount = s.headerDiffCount + s.cookieDiffCount + s.visualDiffCount;

    if (cached) {
      const { points, sla } = cached;
      const penaltyMs = s.verdict === 'NO-GO' ? 28 : s.verdict === 'REVIEW' ? 12 : 0;
      const p50Ms = sla.p50TotalMs + Math.round(penaltyMs * 0.5);
      const p95Ms = sla.p95TotalMs + penaltyMs;
      const p99Ms = sla.p99TotalMs + Math.round(penaltyMs * 1.25);
      const baselineP95Ms = Math.max(68, sla.avgBaselineMs + 14);
      const cwvPassPct = Math.max(
        62,
        Math.min(100, 100 - s.headerDiffCount * 8 - s.visualDiffCount * 11)
      );
      return {
        ...s,
        availabilityPct:
          s.verdict === 'NO-GO'
            ? Number(Math.max(96.4, sla.effectiveAvailabilityPct - 0.8).toFixed(2))
            : sla.effectiveAvailabilityPct,
        p50Ms,
        p95Ms,
        p99Ms,
        baselineP95Ms,
        p95DeltaMs: p95Ms - baselineP95Ms,
        cacheHitRatioPct:
          s.headerDiffCount > 0
            ? Number(Math.max(64, sla.avgCacheHitRatioPct - 14).toFixed(1))
            : sla.avgCacheHitRatioPct,
        apdexScore:
          s.verdict === 'NO-GO'
            ? Number(Math.max(0.74, sla.avgApdexScore - 0.11).toFixed(2))
            : sla.avgApdexScore,
        lcpMs: sla.avgLcpMs + penaltyMs * 6,
        cwvPassPct,
        errorBudgetRemainingPct:
          s.verdict === 'NO-GO'
            ? Number(Math.max(18, sla.errorBudgetRemainingPct - 24).toFixed(1))
            : sla.errorBudgetRemainingPct,
        burnRateMultiplier:
          s.verdict === 'NO-GO'
            ? Number((sla.burnRateMultiplier + 1.8).toFixed(2))
            : sla.burnRateMultiplier,
        totalDiffCount,
        recentVerdicts: points.slice(-10).map((p) => p.verdict),
        recentLatenciesMs: points.slice(-10).map((p) => p.totalMs),
      };
    }

    // Fast deterministic fallback when scaled to 50+ properties
    const p50Ms = 78 + (seed % 34) + (s.verdict === 'NO-GO' ? 22 : 0);
    const p95Ms = p50Ms + 34 + ((seed >> 3) % 42) + (s.verdict === 'NO-GO' ? 35 : 0);
    const p99Ms = p95Ms + 24 + ((seed >> 5) % 28);
    const baselineP95Ms = p50Ms + 28 + ((seed >> 4) % 24);
    const availabilityPct =
      s.verdict === 'NO-GO'
        ? Number((97.2 + (seed % 18) * 0.1).toFixed(2))
        : Number((99.6 + (seed % 4) * 0.1).toFixed(2));
    return {
      ...s,
      availabilityPct,
      p50Ms,
      p95Ms,
      p99Ms,
      baselineP95Ms,
      p95DeltaMs: p95Ms - baselineP95Ms,
      cacheHitRatioPct: Number((84 + (seed % 15) - s.headerDiffCount * 6).toFixed(1)),
      apdexScore: Number((s.verdict === 'NO-GO' ? 0.81 : 0.96 - (seed % 5) * 0.01).toFixed(2)),
      lcpMs: 1180 + p95Ms * 4,
      cwvPassPct: Math.max(68, 100 - totalDiffCount * 7),
      errorBudgetRemainingPct: s.verdict === 'NO-GO' ? 42.5 : 91.4,
      burnRateMultiplier: s.verdict === 'NO-GO' ? 2.4 : 0.35,
      totalDiffCount,
      recentVerdicts: ['GO', 'GO', 'REVIEW', 'GO', s.verdict, 'GO', 'GO', s.verdict],
      recentLatenciesMs: [p50Ms - 4, p50Ms + 3, p95Ms - 8, p50Ms, p95Ms, p50Ms + 2, p50Ms - 2, p50Ms],
    };
  });

  // Build Fleet Timeline across the active range
  const firstDataset = Array.from(datasetsByProp.values())[0]?.points || [];
  const allSampleSeries = Array.from(datasetsByProp.values()).map((d) => d.points);
  const fleetTimeline: FleetTimelineBucket[] = firstDataset.map((refPt, idx) => {
    const slicePts = allSampleSeries
      .map((series) => series[idx])
      .filter((p): p is ScheduledRunPoint => Boolean(p));
    const count = Math.max(1, slicePts.length);
    const avail = Number(
      (slicePts.reduce((acc, p) => acc + p.availabilityPct, 0) / count).toFixed(2)
    );
    const p50Ms = Math.round(slicePts.reduce((acc, p) => acc + p.p50Ms, 0) / count);
    const p95Ms = Math.round(slicePts.reduce((acc, p) => acc + p.p95Ms, 0) / count);
    const p99Ms = Math.round(slicePts.reduce((acc, p) => acc + p.p99Ms, 0) / count);
    const baselineMs = Math.round(slicePts.reduce((acc, p) => acc + p.baselineTotalMs, 0) / count);
    const cacheHitRatioPct = Number(
      (slicePts.reduce((acc, p) => acc + p.cacheHitRatioPct, 0) / count).toFixed(1)
    );
    const apdexScore = Number(
      (slicePts.reduce((acc, p) => acc + p.apdexScore, 0) / count).toFixed(2)
    );
    return {
      index: idx,
      timestampMs: refPt.timestampMs,
      timeLabel: refPt.timeLabel,
      shortDateLabel: refPt.shortDateLabel,
      availabilityPct: avail,
      p50Ms,
      p95Ms,
      p99Ms,
      baselineMs,
      cacheHitRatioPct,
      apdexScore,
      noGoCount: slicePts.filter((p) => p.verdict === 'NO-GO').length,
      reviewCount: slicePts.filter((p) => p.verdict === 'REVIEW').length,
      goCount: slicePts.filter((p) => p.verdict === 'GO').length,
    };
  });

  // Build Regional PoP Telemetry across all 6 global PoPs
  const regionalPopTelemetry: FleetRegionalPopSummary[] = GLOBAL_EXECUTION_POPS.map((pop, pIdx) => {
    const matchingRows = propertyTelemetryRows.filter(
      (r) => r.popCode.toLowerCase() === pop.popCode.toLowerCase()
    );
    const seed = deterministicHash(`pop:${pop.id}:${range}:${pIdx}`);
    const baseP50 =
      matchingRows.length > 0
        ? Math.round(matchingRows.reduce((a, r) => a + r.p50Ms, 0) / matchingRows.length)
        : 82 + (seed % 24);
    const baseP95 =
      matchingRows.length > 0
        ? Math.round(matchingRows.reduce((a, r) => a + r.p95Ms, 0) / matchingRows.length)
        : baseP50 + 44 + (seed % 26);
    const baseP99 =
      matchingRows.length > 0
        ? Math.round(matchingRows.reduce((a, r) => a + r.p99Ms, 0) / matchingRows.length)
        : baseP95 + 28 + (seed % 20);
    const avail =
      matchingRows.length > 0
        ? Number(
            (
              matchingRows.reduce((a, r) => a + r.availabilityPct, 0) / matchingRows.length
            ).toFixed(2)
          )
        : Number((99.45 + (seed % 50) * 0.01).toFixed(2));
    const cacheHit =
      matchingRows.length > 0
        ? Number(
            (
              matchingRows.reduce((a, r) => a + r.cacheHitRatioPct, 0) / matchingRows.length
            ).toFixed(1)
          )
        : Number((88.5 + (seed % 95) * 0.1).toFixed(1));
    const apdex =
      matchingRows.length > 0
        ? Number(
            (matchingRows.reduce((a, r) => a + r.apdexScore, 0) / matchingRows.length).toFixed(2)
          )
        : Number((0.92 + (seed % 7) * 0.01).toFixed(2));
    const incidents = matchingRows.filter((r) => r.verdict === 'NO-GO').length;

    return {
      popId: pop.id,
      popCode: pop.popCode,
      city: pop.city,
      regionGroup: pop.regionGroup,
      propertyCount: Math.max(1, matchingRows.length),
      availabilityPct: avail,
      p50Ms: baseP50,
      p95Ms: baseP95,
      p99Ms: baseP99,
      cacheHitRatioPct: cacheHit,
      apdexScore: apdex,
      incidentCount: incidents,
    };
  });

  const propCount = Math.max(1, propertyTelemetryRows.length);
  const goCount = propertyTelemetryRows.filter((r) => r.verdict === 'GO').length;
  const reviewCount = propertyTelemetryRows.filter((r) => r.verdict === 'REVIEW').length;
  const noGoCount = propertyTelemetryRows.filter((r) => r.verdict === 'NO-GO').length;

  return {
    fleetKpis: {
      totalProperties: propertyTelemetryRows.length,
      goCount,
      reviewCount,
      noGoCount,
      fleetAvailabilityPct: Number(
        (
          propertyTelemetryRows.reduce((a, r) => a + r.availabilityPct, 0) / propCount
        ).toFixed(2)
      ),
      fleetP50Ms: Math.round(propertyTelemetryRows.reduce((a, r) => a + r.p50Ms, 0) / propCount),
      fleetP95Ms: Math.round(propertyTelemetryRows.reduce((a, r) => a + r.p95Ms, 0) / propCount),
      fleetP99Ms: Math.round(propertyTelemetryRows.reduce((a, r) => a + r.p99Ms, 0) / propCount),
      fleetBaselineP95Ms: Math.round(
        propertyTelemetryRows.reduce((a, r) => a + r.baselineP95Ms, 0) / propCount
      ),
      fleetCacheHitRatioPct: Number(
        (
          propertyTelemetryRows.reduce((a, r) => a + r.cacheHitRatioPct, 0) / propCount
        ).toFixed(1)
      ),
      fleetApdex: Number(
        (propertyTelemetryRows.reduce((a, r) => a + r.apdexScore, 0) / propCount).toFixed(2)
      ),
      fleetCwvPassPct: Math.round(
        propertyTelemetryRows.reduce((a, r) => a + r.cwvPassPct, 0) / propCount
      ),
      totalHeaderDiffs: propertyTelemetryRows.reduce((a, r) => a + r.headerDiffCount, 0),
      totalCookieDiffs: propertyTelemetryRows.reduce((a, r) => a + r.cookieDiffCount, 0),
      totalVisualDiffs: propertyTelemetryRows.reduce((a, r) => a + r.visualDiffCount, 0),
      activeBlockersCount: noGoCount,
      sloErrorBudgetRemainingPct: Number(
        (
          propertyTelemetryRows.reduce((a, r) => a + r.errorBudgetRemainingPct, 0) / propCount
        ).toFixed(1)
      ),
    },
    fleetTimeline,
    propertyTelemetryRows,
    regionalPopTelemetry,
  };
}
