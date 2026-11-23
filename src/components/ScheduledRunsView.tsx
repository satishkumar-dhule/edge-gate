import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { AppConfig, OverallVerdict, RunRecord } from '../engine/types';
import { GLOBAL_EXECUTION_POPS, TestCaseDefinition } from '../config/template.config';
import {
  appendLiveScheduledRunTick,
  buildScheduledRunsDataset,
  computeScheduledSlaAnalytics,
  filterScheduledPoints,
  ingestRealPortalRunsIntoSchedule,
  intervalToCronExpression,
  PopDistributionStrategy,
  ScheduleGraphMode,
  ScheduleIntervalMinutes,
  SchedulePolicyConfig,
  ScheduledRunPoint,
  ScheduleTimeRange,
} from '../engine/scheduledRunsEngine';
import {
  ScheduleCheckHeatmapEChart,
  ScheduledRunsEChart,
} from './charts/EChartsTelemetry';

export interface ScheduledRunsViewProps {
  activeApp: AppConfig;
  activeSuite: TestCaseDefinition[];
  policy: SchedulePolicyConfig;
  onUpdatePolicy: (nextPolicy: SchedulePolicyConfig) => void;
  livePoints: ScheduledRunPoint[];
  onAppendLivePoint: (point: ScheduledRunPoint) => void;
  portalRuns?: RunRecord[];
  initialCheckFilter?: string;
  externalGraphMode?: ScheduleGraphMode;
  externalTimeRange?: ScheduleTimeRange;
  externalPopFilter?: string;
  onInspectCheckInWorkbench: (testId: string) => void;
}

const TIME_RANGES: Array<{ id: ScheduleTimeRange; label: string }> = [
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

const GRAPH_MODES: Array<{ id: ScheduleGraphMode; label: string; short: string }> = [
  { id: 'timeseries', label: 'Trend & P95', short: 'Trend' },
  { id: 'scatterplot', label: 'PoP Scatter', short: 'Scatter' },
  { id: 'breakdown', label: 'Phase Waterfall', short: 'Phases' },
  { id: 'cwv-cache', label: 'CWV & Cache', short: 'CWV' },
  { id: 'sla-availability', label: 'SLA Heatmap', short: 'SLA Matrix' },
];

function verdictTextClass(verdict: OverallVerdict): string {
  if (verdict === 'NO-GO') return 'text-rose-600 dark:text-rose-400';
  if (verdict === 'REVIEW') return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export const ScheduledRunsView: React.FC<ScheduledRunsViewProps> = ({
  activeApp,
  activeSuite,
  policy,
  onUpdatePolicy,
  livePoints,
  onAppendLivePoint,
  portalRuns = [],
  initialCheckFilter = 'ALL',
  externalGraphMode,
  externalTimeRange,
  externalPopFilter,
  onInspectCheckInWorkbench,
}) => {
  const [timeRange, setTimeRange] = useState<ScheduleTimeRange>(externalTimeRange || '24h');
  const [graphMode, setGraphMode] = useState<ScheduleGraphMode>(externalGraphMode || 'timeseries');
  const [popFilter, setPopFilter] = useState<string>(externalPopFilter || 'ALL');
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | 'NO-GO' | 'REVIEW' | 'GO'>('ALL');
  const [checkIdFilter, setCheckIdFilter] = useState<string>(initialCheckFilter || 'ALL');
  const [excludeMaintenanceWindows, setExcludeMaintenanceWindows] = useState<boolean>(true);
  const [autoSchedulerActive, setAutoSchedulerActive] = useState<boolean>(false);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [hoveredRunId, setHoveredRunId] = useState<string | null>(null);

  useEffect(() => {
    if (initialCheckFilter) {
      setCheckIdFilter(initialCheckFilter);
    }
  }, [initialCheckFilter]);

  useEffect(() => {
    if (externalGraphMode) setGraphMode(externalGraphMode);
  }, [externalGraphMode]);

  useEffect(() => {
    if (externalTimeRange) setTimeRange(externalTimeRange);
  }, [externalTimeRange]);

  useEffect(() => {
    if (externalPopFilter) setPopFilter(externalPopFilter);
  }, [externalPopFilter]);

  const baseDataset = useMemo(() => {
    const generated = buildScheduledRunsDataset({
      appId: activeApp.id,
      suite: activeSuite,
      policy,
      range: timeRange,
    });
    const withRealRuns = ingestRealPortalRunsIntoSchedule({
      basePoints: generated,
      runs: portalRuns,
      appId: activeApp.id,
      suite: activeSuite,
      policy,
    });
    return [...withRealRuns, ...livePoints];
  }, [activeApp.id, activeSuite, policy, timeRange, portalRuns, livePoints]);

  const filteredPoints = useMemo(
    () =>
      filterScheduledPoints({
        points: baseDataset,
        popFilter,
        verdictFilter,
        checkIdFilter,
      }),
    [baseDataset, popFilter, verdictFilter, checkIdFilter]
  );

  const slaAnalytics = useMemo(
    () =>
      computeScheduledSlaAnalytics({
        points: filteredPoints,
        policy,
        excludeMaintenanceWindows,
      }),
    [filteredPoints, policy, excludeMaintenanceWindows]
  );

  useEffect(() => {
    if (!autoSchedulerActive || !policy.enabled) return;
    const timer = window.setInterval(() => {
      const nextPt = appendLiveScheduledRunTick({
        existingPoints: baseDataset,
        appId: activeApp.id,
        suite: activeSuite,
        policy,
        triggeredBy: 'scheduler-cron',
      });
      onAppendLivePoint(nextPt);
      setSelectedRunId(nextPt.runId);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [autoSchedulerActive, policy, baseDataset, activeApp.id, activeSuite, onAppendLivePoint]);

  const selectedRun: ScheduledRunPoint | undefined = useMemo(() => {
    if (hoveredRunId) {
      const hov = filteredPoints.find((p) => p.runId === hoveredRunId);
      if (hov) return hov;
    }
    if (selectedRunId) {
      const sel = filteredPoints.find((p) => p.runId === selectedRunId);
      if (sel) return sel;
    }
    const latestNoGo = [...filteredPoints].reverse().find((p) => p.verdict === 'NO-GO');
    return latestNoGo || filteredPoints[filteredPoints.length - 1];
  }, [filteredPoints, selectedRunId, hoveredRunId]);

  const handleTriggerScheduledRunNow = () => {
    const nextPt = appendLiveScheduledRunTick({
      existingPoints: baseDataset,
      appId: activeApp.id,
      suite: activeSuite,
      policy,
      triggeredBy: 'manual-trigger',
    });
    onAppendLivePoint(nextPt);
    setSelectedRunId(nextPt.runId);
  };

  const handleIntervalChange = (mins: ScheduleIntervalMinutes) => {
    onUpdatePolicy({
      ...policy,
      intervalMinutes: mins,
      cronExpression: intervalToCronExpression(mins),
    });
  };

  const handleTogglePopInPolicy = (popId: string) => {
    const exists = policy.assignedPops.includes(popId);
    const next = exists
      ? policy.assignedPops.filter((id) => id !== popId)
      : [...policy.assignedPops, popId];
    if (next.length === 0) return;
    onUpdatePolicy({
      ...policy,
      assignedPops: next,
    });
  };

  return (
    <div
      data-testid="scheduled-runs-view"
      className="flex flex-1 flex-col bg-background min-h-[calc(100vh-34px)]"
    >
      {/* 32px Single-Line Telemetry & Schedule Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-2.5 py-1 sm:px-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-mono text-xs font-bold text-foreground">
              {activeApp.id}
            </span>
            <span
              data-testid="schedule-active-badge"
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                policy.enabled
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-border bg-muted text-muted-foreground'
              }`}
            >
              {policy.enabled
                ? `CRON ${policy.cronExpression} (${policy.intervalMinutes}m)`
                : 'PAUSED'}
            </span>
          </div>

          <div className="h-3.5 w-px bg-border hidden sm:block" />

          {/* Graph Mode Switcher */}
          <div
            role="tablist"
            aria-label="Scheduled graph mode"
            className="inline-flex rounded border border-border bg-background p-0.5 text-[11px]"
          >
            {GRAPH_MODES.map((m) => {
              const active = graphMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setGraphMode(m.id)}
                  data-testid={`graph-mode-${m.id}`}
                  className={`rounded-sm px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="hidden lg:inline">{m.label}</span>
                  <span className="lg:hidden">{m.short}</span>
                </button>
              );
            })}
          </div>

          {/* Time Range Selector */}
          <div
            role="group"
            aria-label="Timeframe"
            className="inline-flex rounded border border-border bg-background p-0.5 font-mono text-[10px]"
          >
            {TIME_RANGES.map((r) => {
              const active = timeRange === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setTimeRange(r.id)}
                  data-testid={`schedule-range-${r.id}`}
                  className={`rounded-sm px-1.5 py-0.5 font-semibold cursor-pointer ${
                    active
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Compact Filters & Live Scheduler Trigger */}
        <div className="flex flex-wrap items-center gap-1">
          <select
            aria-label="Filter scheduled graph by check"
            value={checkIdFilter}
            onChange={(e) => setCheckIdFilter(e.target.value)}
            data-testid="schedule-filter-check"
            className="h-6 max-w-[135px] truncate rounded border border-border bg-background px-1.5 font-mono text-[10px] text-foreground focus:border-primary focus:outline-none"
          >
            <option value="ALL">All Checks ({activeSuite.length})</option>
            {activeSuite.map((tc) => (
              <option key={tc.id} value={tc.id}>
                {tc.id} · {tc.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter scheduled graph by Edge PoP"
            value={popFilter}
            onChange={(e) => setPopFilter(e.target.value)}
            data-testid="schedule-filter-pop"
            className="h-6 max-w-[125px] truncate rounded border border-border bg-background px-1.5 font-mono text-[10px] text-foreground focus:border-primary focus:outline-none"
          >
            <option value="ALL">All PoPs ({policy.assignedPops.length})</option>
            {GLOBAL_EXECUTION_POPS.map((pop) => (
              <option key={pop.id} value={pop.id}>
                {pop.popCode} ({pop.city})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter scheduled graph by verdict"
            value={verdictFilter}
            onChange={(e) =>
              setVerdictFilter(e.target.value as 'ALL' | 'NO-GO' | 'REVIEW' | 'GO')
            }
            data-testid="schedule-filter-verdict"
            className="h-6 max-w-[104px] rounded border border-border bg-background px-1.5 font-mono text-[10px] text-foreground focus:border-primary focus:outline-none"
          >
            <option value="ALL">All Verdicts</option>
            <option value="NO-GO">NO-GO Only</option>
            <option value="REVIEW">REVIEW Only</option>
            <option value="GO">GO Only</option>
          </select>

          <button
            type="button"
            onClick={() => setExcludeMaintenanceWindows(!excludeMaintenanceWindows)}
            data-testid="toggle-purge-maintenance"
            title="Exclude planned maintenance windows from official SLA Availability %"
            className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-mono font-medium cursor-pointer transition-colors ${
              excludeMaintenanceWindows
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldCheck className="h-3 w-3" />
            <span>Purge Maint ({slaAnalytics.excludedMaintenanceRuns})</span>
          </button>

          <button
            type="button"
            onClick={() => setAutoSchedulerActive(!autoSchedulerActive)}
            data-testid="toggle-auto-scheduler"
            className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-mono font-medium cursor-pointer transition-colors ${
              autoSchedulerActive
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${autoSchedulerActive ? 'animate-spin' : ''}`} />
            <span>{autoSchedulerActive ? 'Auto-Tick ON' : 'Auto-Tick'}</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerScheduledRunNow}
            data-testid="btn-trigger-scheduled-run"
            className="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
          >
            <Play className="h-2.5 w-2.5 fill-current" />
            <span>Trigger Run Now</span>
          </button>
        </div>
      </div>

      {/* Main Split: Collapsible 220px Schedule Policy & SLA Rail + Graph & Snapshot Workspace */}
      <div className="flex flex-1 flex-col lg:flex-row min-h-0">
        {railCollapsed ? (
          <aside
            aria-label="Collapsed schedule policy rail"
            className="hidden lg:flex lg:w-9 shrink-0 flex-col items-center border-r border-border bg-card py-1.5 gap-2"
          >
            <button
              type="button"
              onClick={() => setRailCollapsed(false)}
              data-testid="btn-toggle-schedule-rail"
              title="Expand schedule policy & SLA rail"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
            <div className="h-px w-5 bg-border" />
            <span
              className={`font-mono text-[9px] font-bold [writing-mode:vertical-rl] rotate-180 ${
                slaAnalytics.slaMet
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              SLA {slaAnalytics.effectiveAvailabilityPct}%
            </span>
          </aside>
        ) : (
          <aside
            aria-label="Schedule policy and SLA analytics"
            className="w-full lg:w-56 xl:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-border bg-card flex flex-col justify-between text-xs"
          >
            <div className="divide-y divide-border">
              {/* SLA & Error Budget Rollup */}
              <div className="p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    SLA & Error Budget
                  </span>
                  <button
                    type="button"
                    onClick={() => setRailCollapsed(true)}
                    data-testid="btn-toggle-schedule-rail"
                    title="Collapse schedule policy rail"
                    className="hidden lg:inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <PanelLeftClose className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <div
                      data-testid="sla-effective-availability"
                      className={`font-mono text-lg font-bold tabular-nums leading-none ${
                        slaAnalytics.slaMet
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {slaAnalytics.effectiveAvailabilityPct}%
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                      Target SLO {policy.slaTargetPct}% · Burn {slaAnalytics.burnRateMultiplier}x
                    </div>
                  </div>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                      slaAnalytics.slaMet
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {slaAnalytics.slaMet ? 'SLO MET' : 'BREACH'}
                  </span>
                </div>

                {/* Error budget progress bar */}
                <div className="space-y-0.5 pt-0.5">
                  <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
                    <span className="text-muted-foreground">Error Budget Left</span>
                    <span className="font-semibold text-foreground">
                      {slaAnalytics.errorBudgetRemainingPct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        slaAnalytics.errorBudgetRemainingPct > 40
                          ? 'bg-emerald-500'
                          : slaAnalytics.errorBudgetRemainingPct > 15
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${slaAnalytics.errorBudgetRemainingPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground pt-0.5 tabular-nums">
                    <span>Raw: {slaAnalytics.rawAvailabilityPct}%</span>
                    <span>Purged: {slaAnalytics.purgedAvailabilityPct}%</span>
                  </div>
                </div>
              </div>

              {/* Percentiles, Cache Offload & Core Web Vitals */}
              <div className="p-2.5 space-y-1.5">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Latency, Cache & CWV
                </div>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] tabular-nums">
                  <div className="rounded border border-border/70 bg-background px-2 py-1">
                    <div className="text-[9px] text-muted-foreground">P50 / AVG</div>
                    <div className="font-semibold text-foreground">
                      {slaAnalytics.p50TotalMs}ms / {slaAnalytics.avgTotalMs}ms
                    </div>
                  </div>
                  <div className="rounded border border-border/70 bg-background px-2 py-1">
                    <div className="text-[9px] text-muted-foreground">P95 / P99</div>
                    <div className="font-semibold text-foreground">
                      {slaAnalytics.p95TotalMs}ms / {slaAnalytics.p99TotalMs}ms
                    </div>
                  </div>
                  <div className="rounded border border-border/70 bg-background px-2 py-1">
                    <div className="text-[9px] text-muted-foreground">CACHE HIT / OFFLOAD</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {slaAnalytics.avgCacheHitRatioPct}% / {slaAnalytics.avgOriginOffloadPct}%
                    </div>
                  </div>
                  <div className="rounded border border-border/70 bg-background px-2 py-1">
                    <div className="text-[9px] text-muted-foreground">APDEX / LCP</div>
                    <div className="font-semibold text-foreground">
                      {slaAnalytics.avgApdexScore.toFixed(2)} / {slaAnalytics.avgLcpMs}ms
                    </div>
                  </div>
                </div>

                <div className="space-y-1 pt-0.5 font-mono text-[10px] tabular-nums">
                  {[
                    { label: 'DNS Lookup', val: slaAnalytics.avgDnsMs, color: 'bg-sky-500' },
                    { label: 'TCP Connect', val: slaAnalytics.avgTcpMs, color: 'bg-indigo-500' },
                    { label: 'TLS Handshake', val: slaAnalytics.avgTlsMs, color: 'bg-violet-500' },
                    { label: 'TTFB (Origin)', val: slaAnalytics.avgTtfbMs, color: 'bg-amber-500' },
                    { label: 'Transfer', val: slaAnalytics.avgTransferMs, color: 'bg-emerald-500' },
                  ].map((phase) => (
                    <div key={phase.label} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className={`h-2 w-2 rounded-xs ${phase.color}`} />
                        {phase.label}
                      </span>
                      <span className="font-semibold text-foreground">{phase.val}ms</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-PoP Regional Telemetry Rollup */}
              {slaAnalytics.popBreakdown.length > 0 && (
                <div className="p-2.5 space-y-1">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Edge PoP Performance
                  </div>
                  <div className="space-y-1 font-mono text-[10px] tabular-nums">
                    {slaAnalytics.popBreakdown.map((p) => (
                      <div
                        key={p.popId}
                        className="flex items-center justify-between rounded border border-border/60 bg-background px-1.5 py-0.5"
                      >
                        <span className="font-semibold text-foreground">
                          {p.popCode.split('-')[0]}{' '}
                          <span className="font-normal text-muted-foreground">({p.city})</span>
                        </span>
                        <span className="text-muted-foreground">
                          P95 <strong className="text-foreground">{p.p95Ms}ms</strong> ·{' '}
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {p.cacheHitRatioPct}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Editable Schedule Cadence & Edge PoP Policy */}
              <div className="p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Schedule Cadence
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdatePolicy({ ...policy, enabled: !policy.enabled })}
                    data-testid="toggle-schedule-enabled"
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${
                      policy.enabled
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-border bg-muted text-muted-foreground'
                    }`}
                  >
                    {policy.enabled ? 'ACTIVE' : 'PAUSED'}
                  </button>
                </div>

                <div className="grid grid-cols-6 gap-1 font-mono text-[10px]">
                  {([1, 5, 10, 15, 30, 60] as ScheduleIntervalMinutes[]).map((mins) => {
                    const active = policy.intervalMinutes === mins;
                    return (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => handleIntervalChange(mins)}
                        data-testid={`schedule-interval-${mins}m`}
                        className={`rounded border py-0.5 text-center font-semibold cursor-pointer ${
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {mins}m
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5">
                    PoP Distribution Strategy
                  </label>
                  <select
                    aria-label="PoP Distribution Strategy"
                    value={policy.strategy}
                    onChange={(e) =>
                      onUpdatePolicy({
                        ...policy,
                        strategy: e.target.value as PopDistributionStrategy,
                      })
                    }
                    data-testid="schedule-strategy-select"
                    className="h-6 w-full rounded border border-border bg-background px-1.5 font-mono text-[11px] text-foreground"
                  >
                    <option value="round-robin">Round-Robin Edge PoPs</option>
                    <option value="all-pops">Simultaneous All PoPs</option>
                    <option value="primary-regional">Primary Regional Pin</option>
                  </select>
                </div>

                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">
                    Assigned Edge PoPs ({policy.assignedPops.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {GLOBAL_EXECUTION_POPS.map((pop) => {
                      const active = policy.assignedPops.includes(pop.id);
                      return (
                        <button
                          key={pop.id}
                          type="button"
                          onClick={() => handleTogglePopInPolicy(pop.id)}
                          data-testid={`policy-pop-${pop.id}`}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${
                            active
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border bg-background text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {pop.popCode.split('-')[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[10px] text-muted-foreground">
                      SLA Warn (ms)
                    </label>
                    <input
                      type="number"
                      aria-label="SLA Warning Threshold ms"
                      value={policy.slaWarningMs}
                      onChange={(e) =>
                        onUpdatePolicy({
                          ...policy,
                          slaWarningMs: Math.max(50, Number(e.target.value) || 220),
                        })
                      }
                      className="h-6 w-full rounded border border-border bg-background px-1.5 font-mono text-[11px] text-foreground tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground">
                      SLA Crit (ms)
                    </label>
                    <input
                      type="number"
                      aria-label="SLA Critical Threshold ms"
                      value={policy.slaCriticalMs}
                      onChange={(e) =>
                        onUpdatePolicy({
                          ...policy,
                          slaCriticalMs: Math.max(100, Number(e.target.value) || 360),
                        })
                      }
                      className="h-6 w-full rounded border border-border bg-background px-1.5 font-mono text-[11px] text-foreground tabular-nums"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border bg-muted/20 p-2 font-mono text-[10px] text-muted-foreground tabular-nums">
              Runs: {slaAnalytics.goCount} GO · {slaAnalytics.reviewCount} REV ·{' '}
              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                {slaAnalytics.noGoCount} NO-GO
              </span>
            </div>
          </aside>
        )}

        {/* Primary Telemetry Graph & Selected Run Snapshot Workspace */}
        <main className="flex-1 flex flex-col min-w-0 p-2 sm:p-2.5 gap-2">
          {/* Interactive ECharts Card */}
          <section
            aria-label="Scheduled runs telemetry graph"
            data-testid="scheduled-runs-graph-card"
            className="rounded border border-border bg-card p-2.5 flex flex-col gap-1.5"
          >
            {/* Header & Active Selected Run Callout */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-display font-semibold text-foreground">
                  {GRAPH_MODES.find((m) => m.id === graphMode)?.label}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {filteredPoints.length} buckets · P50 {slaAnalytics.p50TotalMs}ms · P95{' '}
                  {slaAnalytics.p95TotalMs}ms · P99 {slaAnalytics.p99TotalMs}ms · Cache Hit{' '}
                  {slaAnalytics.avgCacheHitRatioPct}%
                </span>
              </div>

              {selectedRun && (
                <div
                  data-testid="graph-selected-run-pill"
                  className="flex flex-wrap items-center gap-2 font-mono text-[10px] bg-muted/50 px-2 py-0.5 rounded border border-border/70 tabular-nums"
                >
                  <span className="font-bold text-foreground">{selectedRun.runId}</span>
                  <span className="text-muted-foreground">{selectedRun.timeLabel}</span>
                  <span className="text-primary font-semibold">{selectedRun.popCode}</span>
                  <span className="text-foreground font-semibold">
                    {selectedRun.totalMs}ms (P95 {selectedRun.p95Ms}ms · Base{' '}
                    {selectedRun.baselineTotalMs}ms)
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Hit {selectedRun.cacheHitRatioPct}%
                  </span>
                  <span className={`font-bold ${verdictTextClass(selectedRun.verdict)}`}>
                    {selectedRun.verdict}
                  </span>
                </div>
              )}
            </div>

            {/* Graph Canvas: Modes 1-4 render Apache ECharts; Mode 5 renders ECharts Heatmap + SLA Matrix */}
            {graphMode !== 'sla-availability' ? (
              <div className="relative w-full">
                <ScheduledRunsEChart
                  points={filteredPoints}
                  policy={policy}
                  graphMode={graphMode}
                  excludeMaintenanceWindows={excludeMaintenanceWindows}
                  selectedRunId={selectedRun?.runId}
                  onSelectRun={(id) => setSelectedRunId(id)}
                  onHoverRun={(id) => setHoveredRunId(id)}
                />
              </div>
            ) : (
              /* MODE 5: SLA AVAILABILITY & CHECK × TIME DRIFT HEATMAP MATRIX */
              <div
                data-testid="sla-availability-matrix"
                className="space-y-2 overflow-x-auto pt-1"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs tabular-nums">
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">
                      OFFICIAL SLA AVAILABILITY
                    </div>
                    <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                      {slaAnalytics.effectiveAvailabilityPct}%{' '}
                      <span className="text-[10px] font-normal text-muted-foreground">
                        (Target {policy.slaTargetPct}%)
                      </span>
                    </div>
                  </div>
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">
                      RAW vs PURGED AVAILABILITY
                    </div>
                    <div className="text-base font-bold text-foreground">
                      {slaAnalytics.rawAvailabilityPct}% → {slaAnalytics.purgedAvailabilityPct}%
                    </div>
                  </div>
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">
                      HTTP STATUS DISTRIBUTION
                    </div>
                    <div className="text-sm font-bold text-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {slaAnalytics.status2xxTotal} 2xx
                      </span>{' '}
                      · {slaAnalytics.status3xxTotal} 3xx ·{' '}
                      <span className="text-rose-600 dark:text-rose-400">
                        {slaAnalytics.status4xxTotal + slaAnalytics.status5xxTotal} 4xx/5xx
                      </span>
                    </div>
                  </div>
                  <div className="rounded border border-border bg-background p-2">
                    <div className="text-[10px] text-muted-foreground">
                      SLA BREACHES & BURN RATE
                    </div>
                    <div className="text-base font-bold text-rose-600 dark:text-rose-400">
                      {slaAnalytics.slaBreachCount} runs ({slaAnalytics.burnRateMultiplier}x burn)
                    </div>
                  </div>
                </div>

                {/* ECharts Interactive Check × Run Latency Heatmap */}
                <div className="rounded border border-border bg-background p-2">
                  <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    ECharts Check × Execution Latency Heatmap (ms)
                  </div>
                  <ScheduleCheckHeatmapEChart
                    points={filteredPoints}
                    suite={activeSuite}
                    onSelectCell={(runId, testId) => {
                      setSelectedRunId(runId);
                      setCheckIdFilter(testId);
                    }}
                  />
                </div>

                <div className="rounded border border-border bg-background p-2 overflow-x-auto">
                  <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Per-Check × Scheduled Execution Drift Matrix (Click any cell to inspect run)
                  </div>
                  <table className="w-full border-collapse font-mono text-[10px] tabular-nums">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-1 pr-2 text-left w-36">Check</th>
                        {filteredPoints.slice(-18).map((pt, colIdx) => (
                          <th
                            key={`${pt.runId}-${colIdx}`}
                            className="px-0.5 py-1 text-center font-normal text-[9px]"
                            title={`${pt.runId} · ${pt.timeLabel} · ${pt.popCode}`}
                          >
                            {pt.timeLabel.replace(' UTC', '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {activeSuite.map((tc) => (
                        <tr key={tc.id}>
                          <td className="py-1 pr-2 font-semibold text-foreground truncate max-w-[140px]">
                            <span className="text-primary">{tc.id}</span> {tc.name}
                          </td>
                          {filteredPoints.slice(-18).map((pt, colIdx) => {
                            const snap = pt.checkSnapshots.find((c) => c.testId === tc.id);
                            const v = snap?.verdict || 'GO';
                            const isMaint = pt.inMaintenanceWindow && excludeMaintenanceWindows;
                            const bgClass = isMaint
                              ? 'bg-slate-400/30 text-muted-foreground'
                              : v === 'NO-GO'
                              ? 'bg-rose-500/85 text-white'
                              : v === 'REVIEW'
                              ? 'bg-amber-500/80 text-white'
                              : 'bg-emerald-500/75 text-white';
                            return (
                              <td key={`${pt.runId}-${colIdx}-${tc.id}`} className="p-0.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRunId(pt.runId);
                                    setCheckIdFilter(tc.id);
                                  }}
                                  title={`${pt.runId} (${pt.timeLabel}) · ${tc.id}: ${snap?.totalMs}ms · ${v}`}
                                  className={`h-4 w-full min-w-[18px] rounded-xs text-[8px] font-bold cursor-pointer ${bgClass}`}
                                >
                                  {isMaint ? 'M' : snap?.totalMs}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* Selected Scheduled Run Snapshot Breakdown Table */}
          {selectedRun && (
            <section
              aria-label="Selected scheduled run snapshot"
              data-testid="selected-scheduled-run-inspector"
              className="rounded border border-border bg-card overflow-hidden flex-1 flex flex-col"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-2.5 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
                  <span className="font-bold text-primary">{selectedRun.runId}</span>
                  <span className="text-foreground">
                    {selectedRun.shortDateLabel} ({selectedRun.timeLabel})
                  </span>
                  <span className="text-muted-foreground">
                    PoP: <strong className="text-foreground">{selectedRun.popCode}</strong> ({selectedRun.popCity})
                  </span>
                  <span className="text-muted-foreground">
                    Trigger: {selectedRun.triggeredBy}
                  </span>
                  {selectedRun.inMaintenanceWindow && (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                      {selectedRun.maintenanceLabel}
                    </span>
                  )}
                  {selectedRun.deploymentMarker && (
                    <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                      Deploy: {selectedRun.deploymentMarker}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
                  <span>
                    DNS <strong className="text-foreground">{selectedRun.dnsMs}ms</strong> · TCP{' '}
                    <strong className="text-foreground">{selectedRun.tcpMs}ms</strong> · TLS{' '}
                    <strong className="text-foreground">{selectedRun.tlsMs}ms</strong> · TTFB{' '}
                    <strong className="text-foreground">{selectedRun.ttfbMs}ms</strong> · Xfer{' '}
                    <strong className="text-foreground">{selectedRun.transferMs}ms</strong>
                  </span>
                  <span className="text-muted-foreground">
                    LCP <strong className="text-foreground">{selectedRun.lcpMs}ms</strong> · Apdex{' '}
                    <strong className="text-foreground">{selectedRun.apdexScore.toFixed(2)}</strong>
                  </span>
                  <span className={`font-bold ${verdictTextClass(selectedRun.verdict)}`}>
                    {selectedRun.verdict} ({selectedRun.availabilityPct}% Avail)
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20 font-mono text-[10px] uppercase text-muted-foreground">
                      <th className="px-2.5 py-1.5">Check</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">Cache State</th>
                      <th className="px-2 py-1.5">Verdict</th>
                      <th className="px-2 py-1.5 text-right">DNS</th>
                      <th className="px-2 py-1.5 text-right">TCP</th>
                      <th className="px-2 py-1.5 text-right">TLS</th>
                      <th className="px-2 py-1.5 text-right">TTFB</th>
                      <th className="px-2 py-1.5 text-right">LCP</th>
                      <th className="px-2 py-1.5 text-right">Total vs Base</th>
                      <th className="px-2 py-1.5">Contract Drift</th>
                      <th className="px-2.5 py-1.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 font-mono text-[11px] tabular-nums">
                    {selectedRun.checkSnapshots.map((snap, snapIdx) => {
                      const deltaMs = snap.totalMs - snap.baselineTotalMs;
                      const isHit =
                        snap.cacheState === 'TCP_HIT' || snap.cacheState === 'TCP_MEM_HIT';
                      return (
                        <tr
                          key={`${snap.testId || 'chk'}-${snapIdx}`}
                          className={
                            snap.verdict === 'NO-GO'
                              ? 'bg-rose-500/5'
                              : snap.verdict === 'REVIEW'
                              ? 'bg-amber-500/5'
                              : 'hover:bg-muted/40'
                          }
                        >
                          <td className="px-2.5 py-1.5">
                            <span className="font-bold text-primary">{snap.testId}</span>{' '}
                            <span className="font-sans font-medium text-foreground">
                              {snap.testName}
                            </span>{' '}
                            <span className="text-[10px] text-muted-foreground">
                              {snap.path}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={
                                snap.status >= 400
                                  ? 'text-rose-600 dark:text-rose-400 font-bold'
                                  : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              }
                            >
                              HTTP {snap.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-[10px]">
                            <span
                              className={
                                isHit
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : 'text-amber-600 dark:text-amber-400 font-semibold'
                              }
                            >
                              {snap.cacheState}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`font-bold ${verdictTextClass(snap.verdict)}`}>
                              {snap.verdict}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {snap.dnsMs}ms
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {snap.tcpMs}ms
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {snap.tlsMs}ms
                          </td>
                          <td className="px-2 py-1.5 text-right text-foreground font-medium">
                            {snap.ttfbMs}ms
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {snap.lcpMs}ms
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="font-bold text-foreground">{snap.totalMs}ms</span>{' '}
                            <span
                              className={`text-[10px] ${
                                deltaMs > 25
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              ({deltaMs >= 0 ? `+${deltaMs}` : deltaMs}ms)
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-[10px]">
                            {snap.headerDiffs === 0 &&
                            snap.cookieDiffs === 0 &&
                            !snap.visualDiff ? (
                              <span className="text-muted-foreground">Aligned</span>
                            ) : (
                              <div className="flex items-center gap-1">
                                {snap.headerDiffs > 0 && (
                                  <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                    {snap.headerDiffs}H
                                  </span>
                                )}
                                {snap.cookieDiffs > 0 && (
                                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                    {snap.cookieDiffs}C
                                  </span>
                                )}
                                {snap.visualDiff && (
                                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                    1V ({snap.visualDriftPct}%)
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => onInspectCheckInWorkbench(snap.testId)}
                              data-testid={`btn-inspect-scheduled-check-${snap.testId}`}
                              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium text-foreground hover:bg-muted cursor-pointer"
                            >
                              <span>Inspect</span>
                              <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
