import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { TemplateConfig, TestCaseDefinition } from '../config/template.config';
import { AppConfig, OverallVerdict, RunRecord } from '../engine/types';
import { RegionCode, VerdictFilter } from '../engine/scalableViewEngine';
import {
  InspectorDimensionTab,
  PropertyGateSummary,
  computeFleetAggregateMetrics,
  exportFleetGateCsv,
} from '../engine/workbenchModel';
import {
  CanaryDeepDiveReport,
  FanOutBatchRecord,
  FanOutScope,
  ManagedSyntheticsCanary,
  buildCanaryDeepDiveReport,
} from '../engine/awsSyntheticsOrchestrator';
import {
  NormalizedCanariesInventory,
  normalizeCanariesApiResponse,
  normalizeFanOutApiResponse,
} from '../engine/syntheticsResilience';

export interface SyntheticsOrchestratorViewProps {
  activeAppId: string;
  apps?: AppConfig[];
  suitesByAppId?: Record<string, TestCaseDefinition[]>;
  runs?: RunRecord[];
  templateConfig?: TemplateConfig;
  propertySummaries?: PropertyGateSummary[];
  onSelectPropertyAndCompare: (
    appId: string,
    testId?: string,
    tab?: InspectorDimensionTab
  ) => void;
  onOpenSetupForProperty: (appId: string) => void;
  onIngestRunsFromSynthetics?: (newRuns: RunRecord[]) => void;
  onRunPropertyGate?: (appId: string) => void;
}

function verdictTextClass(verdict: OverallVerdict): string {
  if (verdict === 'NO-GO') return 'text-rose-700 dark:text-rose-400';
  if (verdict === 'REVIEW') return 'text-amber-700 dark:text-amber-400';
  if (verdict === 'GO') return 'text-emerald-700 dark:text-emerald-400';
  return 'text-muted-foreground';
}

function syncStatusMeta(status: ManagedSyntheticsCanary['syncStatus']): {
  label: string;
  cls: string;
} {
  if (status === 'AWS_LIVE_SYNCED') {
    return {
      label: 'AWS Live',
      cls: 'text-emerald-700 dark:text-emerald-400',
    };
  }
  if (status === 'DRIFT_PENDING_SYNC') {
    return {
      label: 'Sync Needed',
      cls: 'text-amber-700 dark:text-amber-400',
    };
  }
  if (status === 'SYNC_ERROR') {
    return {
      label: 'Sync Error',
      cls: 'text-rose-700 dark:text-rose-400',
    };
  }
  return {
    label: 'Ready',
    cls: 'text-sky-700 dark:text-sky-400',
  };
}

function formatFanOutScopeLabel(scope: string): string {
  switch (scope) {
    case 'property-pair':
      return 'Property Pair';
    case 'nogo-blockers':
      return 'NO-GO Blockers';
    case 'fleet-all':
      return 'All Properties';
    case 'region':
      return 'Regional';
    case 'custom':
      return 'Custom Selection';
    default:
      return scope;
  }
}

export const SyntheticsOrchestratorView: React.FC<SyntheticsOrchestratorViewProps> = ({
  activeAppId,
  apps = [],
  suitesByAppId = {},
  runs = [],
  templateConfig,
  propertySummaries = [],
  onSelectPropertyAndCompare,
  onOpenSetupForProperty,
  onIngestRunsFromSynthetics,
  onRunPropertyGate,
}) => {
  const [serverRawInventory, setServerRawInventory] = useState<Record<string, unknown> | null>(null);
  const [syncingScope, setSyncingScope] = useState<string | null>(null);
  const [fanningOutScope, setFanningOutScope] = useState<string | null>(null);
  const [startingCanary, setStartingCanary] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<FanOutBatchRecord | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Organization & Filter State
  const [viewLayout, setViewLayout] = useState<'grouped' | 'flat'>('grouped');
  const [query, setQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<RegionCode | 'ALL'>('ALL');
  const [networkFilter, setNetworkFilter] = useState<'ALL' | 'staging' | 'prod'>('ALL');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('ALL');
  const [sortBy, setSortBy] = useState<'verdict' | 'diffs' | 'appId'>('verdict');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedCanaryNames, setSelectedCanaryNames] = useState<string[]>([]);

  // Right-Hand Slide-Over Drawer State (NEVER renders below the table!)
  const [deepDiveCanaryName, setDeepDiveCanaryName] = useState<string | null>(null);
  const [deepDiveReport, setDeepDiveReport] = useState<CanaryDeepDiveReport | null>(null);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  // Default to 'checks' tab so engineers immediately see real endpoint checks & statuses instead of raw ARNs
  const [deepDiveTab, setDeepDiveTab] = useState<'checks' | 'runs' | 'overview' | 'spec'>('checks');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Immediately hydrated inventory: guaranteed non-empty even before server fetch or under AWS SCP
  const inventory: NormalizedCanariesInventory = useMemo(
    () =>
      normalizeCanariesApiResponse({
        raw: serverRawInventory,
        apps,
        suitesByAppId,
        runs,
        propertySummaries,
        templateConfig,
      }),
    [serverRawInventory, apps, suitesByAppId, runs, propertySummaries, templateConfig]
  );

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moreMenuOpen]);

  // Close Deep Dive Slide-Over Drawer on Escape key
  useEffect(() => {
    if (!deepDiveCanaryName) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDeepDiveCanaryName(null);
        setDeepDiveReport(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deepDiveCanaryName]);

  const loadInventory = useCallback(
    async (refreshAws = false) => {
      try {
        const url = refreshAws
          ? '/api/v1/synthetics/canaries?refreshAws=true'
          : '/api/v1/synthetics/canaries';
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, unknown>;
        setServerRawInventory(data);
        const normalized = normalizeCanariesApiResponse({
          raw: data,
          apps,
          suitesByAppId,
          runs,
          propertySummaries,
          templateConfig,
        });
        if (!activeBatch && normalized.recentBatches.length > 0) {
          setActiveBatch(normalized.recentBatches[0]);
        }
        if (refreshAws) {
          toast.success(`Refreshed ${normalized.totalCanaries} Synthetics canaries`);
        }
      } catch {
        // Keep hydrated client fleet intact without noisy errors
      }
    },
    [activeBatch, apps, suitesByAppId, runs, propertySummaries, templateConfig]
  );

  useEffect(() => {
    loadInventory(false);
  }, [loadInventory]);

  const openDeepDive = async (canaryName: string) => {
    setDeepDiveCanaryName(canaryName);
    setDeepDiveTab('checks');

    const localCanary = inventory.canaries.find(
      (c) => c.canaryName.toLowerCase() === canaryName.toLowerCase()
    );
    const localFallback = localCanary
      ? buildCanaryDeepDiveReport({
          canary: localCanary,
          allCanaries: inventory.canaries,
          suite: suitesByAppId[localCanary.appId] || [],
          runs,
        })
      : null;

    if (localFallback) {
      setDeepDiveReport(localFallback);
      setDeepDiveLoading(false);
    } else {
      setDeepDiveLoading(true);
    }

    try {
      const res = await fetch(
        `/api/v1/synthetics/canaries/${encodeURIComponent(canaryName)}/deep-dive`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const report = (await res.json()) as CanaryDeepDiveReport;
      if (report && report.canary && Array.isArray(report.checks)) {
        setDeepDiveReport(report);
      }
    } catch {
      if (!localFallback) {
        toast.error(`Unable to load canary details for ${canaryName}`);
      }
    } finally {
      setDeepDiveLoading(false);
    }
  };

  const handleSyncToAws = async (appId?: string) => {
    const scopeKey = appId || 'ALL';
    setSyncingScope(scopeKey);
    try {
      const res = await fetch('/api/v1/synthetics/canaries/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appId ? { appId } : { syncAll: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      if (Array.isArray(data.canaries) && data.canaries.length > 0) {
        setServerRawInventory((prev) => ({
          ...(prev || {}),
          canaries: data.canaries,
        }));
      }
      const syncedCount =
        typeof data.totalSyncedCanaries === 'number'
          ? data.totalSyncedCanaries
          : appId
          ? 2
          : inventory.totalCanaries;
      toast.success(
        appId
          ? `Synced ${syncedCount} AWS Synthetics canaries for ${appId}`
          : `Synced ${syncedCount} AWS Synthetics canaries across fleet`
      );
      if (deepDiveCanaryName) {
        openDeepDive(deepDiveCanaryName);
      }
    } catch (err) {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSyncingScope(null);
    }
  };

  const handleStartSingleCanary = async (canaryName: string) => {
    setStartingCanary(canaryName);
    try {
      const res = await fetch(
        `/api/v1/synthetics/canaries/${encodeURIComponent(canaryName)}/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.run && onIngestRunsFromSynthetics) {
        onIngestRunsFromSynthetics([data.run as RunRecord]);
      }
      await loadInventory(false);
      if (deepDiveCanaryName === canaryName) {
        await openDeepDive(canaryName);
      }
      toast.success(
        `Canary ${canaryName} finished (${data.run?.passedTests ?? 0}/${data.run?.totalTests ?? 0} passed)`
      );
    } catch {
      const matched = inventory.canaries.find(
        (c) => c.canaryName.toLowerCase() === canaryName.toLowerCase()
      );
      if (matched) {
        await handleTriggerFanOut({
          scope: 'property-pair',
          appId: matched.appId,
          label: `property:${matched.appId}`,
        });
      } else {
        toast.error(`Unable to start canary ${canaryName}`);
      }
    } finally {
      setStartingCanary(null);
    }
  };

  const handleTriggerFanOut = async (params: {
    scope: FanOutScope;
    appId?: string;
    regionCode?: RegionCode;
    canaryNames?: string[];
    label: string;
  }) => {
    setFanningOutScope(params.label);
    try {
      const res = await fetch('/api/v1/synthetics/fan-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: params.scope,
          appId: params.appId,
          regionCode: params.regionCode,
          canaryNames: params.canaryNames,
          concurrency: 6,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `HTTP ${res.status}`);
      }
      const rawData = (await res.json()) as Record<string, unknown>;
      const normalized = normalizeFanOutApiResponse({
        raw: rawData,
        scope: params.scope,
        appId: params.appId,
        propertySummaries,
      });

      setActiveBatch(normalized.batch);
      if (normalized.runs.length > 0 && onIngestRunsFromSynthetics) {
        onIngestRunsFromSynthetics(normalized.runs);
      }
      if (normalized.canaries && normalized.canaries.length > 0) {
        setServerRawInventory((prev) => ({
          ...(prev || {}),
          canaries: normalized.canaries,
          recentBatches: [
            normalized.batch,
            ...(inventory.recentBatches || []).filter(
              (b) => b.batchId !== normalized.batch.batchId
            ),
          ],
        }));
      }

      toast.success(
        `Completed ${normalized.batch.completedCanaries}/${normalized.batch.totalCanaries} canaries across ${Math.max(
          1,
          normalized.batch.affectedAppIds.length
        )} ${normalized.batch.affectedAppIds.length === 1 ? 'property' : 'properties'}`
      );
      if (params.scope === 'custom') {
        setSelectedCanaryNames([]);
      }
    } catch (err) {
      if (params.scope === 'property-pair' && params.appId && onRunPropertyGate) {
        onRunPropertyGate(params.appId);
      } else {
        toast.error(`Run failed: ${err instanceof Error ? err.message : 'Network error'}`);
      }
    } finally {
      setFanningOutScope(null);
    }
  };

  const canaries = inventory.canaries;

  const filteredCanaries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return canaries.filter((c) => {
      if (regionFilter !== 'ALL' && c.regionCode !== regionFilter) return false;
      if (viewLayout === 'flat' && networkFilter !== 'ALL' && c.network !== networkFilter) {
        return false;
      }
      if (verdictFilter !== 'ALL' && c.gateVerdict !== verdictFilter) return false;
      if (q) {
        const hay = `${c.canaryName} ${c.targetId} ${c.appId} ${c.appName} ${c.canonicalHost} ${c.edgeIp} ${c.regionCode} ${c.popCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [canaries, query, regionFilter, networkFilter, verdictFilter, viewLayout]);

  const summaryByAppId = useMemo(() => {
    const map = new Map<string, PropertyGateSummary>();
    for (const s of propertySummaries) map.set(s.appId, s);
    return map;
  }, [propertySummaries]);

  const groupedByProperty = useMemo(() => {
    const map = new Map<
      string,
      {
        appId: string;
        appName: string;
        canonicalHost: string;
        regionCode: RegionCode;
        popCode: string;
        verdict: OverallVerdict;
        headerDiffs: number;
        cookieDiffs: number;
        visualDiffs: number;
        firstDiffTestId: string;
        firstDiffTab: InspectorDimensionTab;
        staging?: ManagedSyntheticsCanary;
        prod?: ManagedSyntheticsCanary;
        extra: ManagedSyntheticsCanary[];
      }
    >();

    for (const c of filteredCanaries) {
      const liveSummary = summaryByAppId.get(c.appId);
      let grp = map.get(c.appId);
      if (!grp) {
        grp = {
          appId: c.appId,
          appName: liveSummary?.name || c.appName,
          canonicalHost: liveSummary?.canonicalHost || c.canonicalHost,
          regionCode: c.regionCode,
          popCode: c.popCode,
          verdict: liveSummary?.verdict || c.gateVerdict,
          headerDiffs: liveSummary ? liveSummary.headerDiffCount : c.headerDiffs,
          cookieDiffs: liveSummary ? liveSummary.cookieDiffCount : c.cookieDiffs,
          visualDiffs: liveSummary ? liveSummary.visualDiffCount : c.visualDiffs,
          firstDiffTestId: liveSummary?.firstDiffTestId || c.firstDiffTestId,
          firstDiffTab: liveSummary?.firstDiffTab || c.firstDiffTab,
          extra: [],
        };
        map.set(c.appId, grp);
      }
      if (c.envId === 'prod' && c.network === 'staging' && !grp.staging) {
        grp.staging = c;
      } else if (c.envId === 'prod' && c.network === 'prod' && !grp.prod) {
        grp.prod = c;
      } else {
        grp.extra.push(c);
      }
    }

    const verdictRank: Record<OverallVerdict, number> = {
      'NO-GO': 4,
      REVIEW: 3,
      PARTIAL: 2,
      COMPARING: 1,
      NONE: 0,
      GO: 0,
    };
    const factor = sortDir === 'asc' ? 1 : -1;
    return Array.from(map.values()).sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'appId') {
        cmp = a.appId.localeCompare(b.appId);
      } else if (sortBy === 'diffs') {
        cmp =
          a.headerDiffs +
          a.cookieDiffs +
          a.visualDiffs -
          (b.headerDiffs + b.cookieDiffs + b.visualDiffs);
      } else {
        cmp = verdictRank[a.verdict] - verdictRank[b.verdict];
      }
      if (cmp === 0) return a.appId.localeCompare(b.appId);
      return cmp * factor;
    });
  }, [filteredCanaries, summaryByAppId, sortBy, sortDir]);

  const toggleSort = (key: 'verdict' | 'diffs' | 'appId') => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'appId' ? 'asc' : 'desc');
    }
  };

  const fleetMetrics = useMemo(
    () => computeFleetAggregateMetrics(propertySummaries),
    [propertySummaries]
  );

  const noGoPropertyCount = useMemo(() => {
    if (propertySummaries.length > 0) return fleetMetrics.noGo;
    const set = new Set<string>();
    for (const c of canaries) {
      if (c.gateVerdict === 'NO-GO') set.add(c.appId);
    }
    return set.size;
  }, [canaries, propertySummaries.length, fleetMetrics.noGo]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    regionFilter !== 'ALL' ||
    verdictFilter !== 'ALL' ||
    networkFilter !== 'ALL';

  const resetFilters = () => {
    setQuery('');
    setRegionFilter('ALL');
    setVerdictFilter('ALL');
    setNetworkFilter('ALL');
  };

  const handleExportCsv = () => {
    const rowsToExport: PropertyGateSummary[] =
      propertySummaries.length > 0
        ? propertySummaries
        : groupedByProperty.map((g) => ({
            appId: g.appId,
            name: g.appName,
            canonicalHost: g.canonicalHost,
            popCode: g.popCode,
            regionCode: g.regionCode,
            envId: 'prod',
            candidateTarget: `${g.appId}.prod.staging`,
            baselineTarget: `${g.appId}.prod.prod`,
            verdict: g.verdict,
            headerDiffCount: g.headerDiffs,
            cookieDiffCount: g.cookieDiffs,
            visualDiffCount: g.visualDiffs,
            failCount: 0,
            totalChecks: g.staging?.checkCount || g.prod?.checkCount || 0,
            firstDiffTestId: g.firstDiffTestId,
            firstDiffTab: g.firstDiffTab,
          }));
    const csv = exportFleetGateCsv(rowsToExport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aws-synthetics-release-gate-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rowsToExport.length} properties to CSV`);
  };

  const toggleSelectCanary = (name: string) => {
    setSelectedCanaryNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  // Track which property row owns the currently inspected Canary so the row highlights visibly
  const inspectedAppId = useMemo(() => {
    if (!deepDiveCanaryName) return null;
    if (deepDiveReport?.canary?.appId) return deepDiveReport.canary.appId;
    const found = canaries.find(
      (c) => c.canaryName.toLowerCase() === deepDiveCanaryName.toLowerCase()
    );
    return found?.appId || null;
  }, [deepDiveCanaryName, deepDiveReport, canaries]);

  return (
    <div
      data-testid="synthetics-orchestrator-view"
      className="w-full px-3 sm:px-5 py-2.5 space-y-2"
    >
      {/* Single-Row Command Header: Title + Live Metrics + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-sm font-semibold tracking-tight text-foreground">
              Sites
            </h1>
            <span className="text-[11px] font-mono text-muted-foreground">
              {inventory.awsRegion}
            </span>
          </div>

          <span className="hidden sm:inline text-border" aria-hidden="true">|</span>

          {/* Inline Interactive Summary Metrics */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs tabular-nums">
            <button
              type="button"
              onClick={() => setVerdictFilter(verdictFilter === 'NO-GO' ? 'ALL' : 'NO-GO')}
              className="font-mono font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              {noGoPropertyCount} Blocked
            </button>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground font-mono">
              {fleetMetrics.review} Review
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-mono">
              {fleetMetrics.go} Ready
            </span>
            <span className="hidden md:inline text-border" aria-hidden="true">|</span>
            <span className="hidden md:inline font-mono text-muted-foreground">
              {inventory.totalProperties} sites · {inventory.totalChecksManaged} checks ·{' '}
              <span data-testid="synthetics-total-canaries" className="text-foreground font-medium">
                {inventory.totalCanaries}
              </span>{' '}
              canaries
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0" ref={moreMenuRef}>
          <button
            type="button"
            disabled={fanningOutScope !== null}
            onClick={() =>
              handleTriggerFanOut({
                scope: 'fleet-all',
                label: 'fleet-all',
              })
            }
            data-testid="btn-fanout-fleet-all"
            title="Re-test Staging & Production across all sites"
            className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {fanningOutScope === 'fleet-all' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>Test All</span>
          </button>

          {noGoPropertyCount > 0 ? (
            <button
              type="button"
              disabled={fanningOutScope !== null}
              onClick={() =>
                handleTriggerFanOut({
                  scope: 'nogo-blockers',
                  label: 'nogo-blockers',
                })
              }
              data-testid="btn-fanout-nogo-blockers"
              title={`Re-test all ${noGoPropertyCount} blocked sites`}
              className="inline-flex h-7.5 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {fanningOutScope === 'nogo-blockers' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              <span>Retest {noGoPropertyCount} Blocked</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={fanningOutScope !== null}
              onClick={() =>
                handleTriggerFanOut({
                  scope: 'property-pair',
                  appId: activeAppId,
                  label: `property:${activeAppId}`,
                })
              }
              data-testid="btn-fanout-active-property"
              className="inline-flex h-7.5 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {fanningOutScope === `property:${activeAppId}` ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              <span>Test {activeAppId}</span>
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreMenuOpen((v) => !v)}
              data-testid="btn-synthetics-more"
              aria-label="More site actions"
              aria-expanded={moreMenuOpen}
              className={`inline-flex h-7.5 w-7.5 items-center justify-center rounded-md border transition-colors cursor-pointer ${
                moreMenuOpen
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {moreMenuOpen && (
              <div className="absolute right-0 top-9 z-40 w-56 rounded-md border border-border bg-popover p-1.5 shadow-lg text-xs">
                <button
                  type="button"
                  disabled={fanningOutScope !== null}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleTriggerFanOut({
                      scope: 'property-pair',
                      appId: activeAppId,
                      label: `property:${activeAppId}`,
                    });
                  }}
                  data-testid="btn-fanout-active-property-menu"
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-muted disabled:opacity-50 cursor-pointer"
                >
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span>Test {activeAppId} Only</span>
                </button>

                <button
                  type="button"
                  disabled={syncingScope !== null}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleSyncToAws();
                  }}
                  data-testid="btn-sync-all-aws-synthetics"
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-muted disabled:opacity-50 cursor-pointer"
                >
                  <UploadCloud className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Sync Checks to AWS</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    loadInventory(true);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Refresh AWS Status</span>
                </button>

                <div className="my-1 border-t border-border" />

                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleExportCsv();
                  }}
                  data-testid="btn-export-fleet-csv"
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Export CSV Report</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slim Filter + Last Run Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-52 sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sites or domains…"
              aria-label="Filter sites"
              className="h-7.5 w-full rounded-md border border-border bg-card pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex h-7.5 items-center rounded-md border border-border bg-card p-0.5 text-xs">
            {(
              [
                { id: 'ALL', label: 'All' },
                { id: 'NO-GO', label: 'Blocked' },
                { id: 'REVIEW', label: 'Review' },
                { id: 'GO', label: 'Ready' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setVerdictFilter(opt.id)}
                className={`h-6.5 rounded px-2 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                  verdictFilter === opt.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value as RegionCode | 'ALL')}
            aria-label="Filter by region"
            className="h-7.5 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Regions</option>
            <option value="GLOBAL">Global</option>
            <option value="AMER">Americas</option>
            <option value="EMEA">EMEA</option>
            <option value="APAC">APAC</option>
          </select>

          {viewLayout === 'flat' && (
            <select
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value as 'ALL' | 'staging' | 'prod')}
              aria-label="Filter by environment"
              className="h-7.5 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Envs</option>
              <option value="staging">Staging</option>
              <option value="prod">Production</option>
            </select>
          )}

          {selectedCanaryNames.length > 0 && (
            <button
              type="button"
              disabled={fanningOutScope !== null}
              onClick={() =>
                handleTriggerFanOut({
                  scope: 'custom',
                  canaryNames: selectedCanaryNames,
                  label: `custom:${selectedCanaryNames.length}`,
                })
              }
              data-testid="btn-fanout-selected"
              className="inline-flex h-7.5 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Test Selected ({selectedCanaryNames.length})</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeBatch && (
            <div
              data-testid="fanout-batch-panel"
              className="inline-flex h-7.5 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[11px]"
            >
              <Zap className="h-3 w-3 text-primary shrink-0" />
              <span className="font-medium text-foreground">
                {formatFanOutScopeLabel(activeBatch.scope)}
              </span>
              <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {activeBatch.completedCanaries}/{activeBatch.totalCanaries}
              </span>
              {activeBatch.propertyVerdicts[0] && (
                <button
                  type="button"
                  onClick={() => {
                    const pv = activeBatch.propertyVerdicts[0];
                    onSelectPropertyAndCompare(pv.appId, pv.firstDiffTestId, pv.firstDiffTab);
                  }}
                  className="font-mono font-semibold text-primary hover:underline cursor-pointer"
                >
                  {activeBatch.propertyVerdicts[0].appId} →
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveBatch(null)}
                aria-label="Dismiss run summary"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="inline-flex h-7.5 items-center rounded-md border border-border bg-card p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewLayout('grouped')}
              data-testid="btn-layout-grouped"
              className={`h-6.5 rounded px-2.5 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                viewLayout === 'grouped'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sites ({groupedByProperty.length})
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('flat')}
              data-testid="btn-layout-flat"
              className={`h-6.5 rounded px-2.5 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                viewLayout === 'flat'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              AWS Canaries ({filteredCanaries.length})
            </button>
          </div>
        </div>
      </div>

      {/* High-Density 4-Column Full-Width Sites Table (All 14 Sites Above the Fold) */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card min-w-0">
        {viewLayout === 'grouped' ? (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/35 text-[11px] font-medium text-muted-foreground">
                <th className="px-3.5 py-2 w-[30%]">
                  <button
                    type="button"
                    onClick={() => toggleSort('appId')}
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    <span>Site &amp; Domain</span>
                    <ArrowUpDown className="h-3 w-3 opacity-60" />
                  </button>
                </th>
                <th className="px-3 py-2 w-[16%] hidden sm:table-cell">Scope</th>
                <th className="px-3 py-2 w-[34%]">
                  <button
                    type="button"
                    onClick={() => toggleSort('diffs')}
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                  >
                    <span>Status &amp; Differences</span>
                    <ArrowUpDown className="h-3 w-3 opacity-60" />
                  </button>
                </th>
                <th className="px-3.5 py-2 text-right w-[20%]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/65">
              {groupedByProperty.map((grp) => {
                const isActive = grp.appId === activeAppId;
                const isInspected = grp.appId === inspectedAppId;
                const isRunningThis = fanningOutScope === `property:${grp.appId}`;
                const checkTotal = grp.staging?.checkCount || grp.prod?.checkCount || 8;
                const totalDiffs = grp.headerDiffs + grp.cookieDiffs + grp.visualDiffs;
                const primaryCanary = grp.staging || grp.prod;
                const statusLabel =
                  grp.verdict === 'NO-GO'
                    ? 'Blocked'
                    : grp.verdict === 'REVIEW'
                    ? 'Needs Review'
                    : grp.verdict === 'GO'
                    ? 'Ready'
                    : grp.verdict;

                return (
                  <tr
                    key={grp.appId}
                    data-testid={`synthetics-prop-row-${grp.appId}`}
                    onClick={() =>
                      onSelectPropertyAndCompare(
                        grp.appId,
                        grp.firstDiffTestId,
                        grp.firstDiffTab
                      )
                    }
                    className={`transition-colors cursor-pointer ${
                      isInspected
                        ? 'bg-primary/[0.08] ring-1 ring-inset ring-primary/35'
                        : isActive
                        ? 'bg-accent/35 hover:bg-accent/55'
                        : 'hover:bg-muted/35'
                    }`}
                  >
                    {/* 1. Compact Single-Line Site + Domain */}
                    <td className="px-3.5 py-2 align-middle">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-foreground shrink-0">
                          {grp.appId}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {grp.canonicalHost}
                        </span>
                      </div>
                    </td>

                    {/* 2. Region & Checks Scope */}
                    <td className="px-3 py-2 align-middle whitespace-nowrap hidden sm:table-cell font-mono text-[11px] text-muted-foreground tabular-nums">
                      <span>{grp.regionCode}</span>
                      <span className="mx-1.5 text-border">·</span>
                      <span>{checkTotal} checks</span>
                    </td>

                    {/* 3. Plain-English Status & Clickable Differences */}
                    <td
                      className="px-3 py-2 align-middle whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2.5 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            onSelectPropertyAndCompare(
                              grp.appId,
                              grp.firstDiffTestId,
                              grp.firstDiffTab
                            )
                          }
                          title={`Release gate verdict: ${grp.verdict}`}
                          className={`inline-flex items-center gap-1 font-semibold cursor-pointer hover:underline ${verdictTextClass(
                            grp.verdict
                          )}`}
                        >
                          {grp.verdict === 'GO' ? (
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{statusLabel}</span>
                        </button>

                        <span className="text-border" aria-hidden="true">
                          |
                        </span>

                        {totalDiffs === 0 ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            Matches Production
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 tabular-nums">
                            {grp.headerDiffs > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectPropertyAndCompare(
                                    grp.appId,
                                    grp.firstDiffTestId,
                                    'headers'
                                  )
                                }
                                className="text-rose-700 dark:text-rose-400 font-medium hover:underline cursor-pointer"
                              >
                                {grp.headerDiffs} {grp.headerDiffs === 1 ? 'header' : 'headers'}
                              </button>
                            )}
                            {grp.headerDiffs > 0 &&
                              (grp.cookieDiffs > 0 || grp.visualDiffs > 0) && (
                                <span className="text-muted-foreground/50">·</span>
                              )}
                            {grp.cookieDiffs > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectPropertyAndCompare(
                                    grp.appId,
                                    grp.firstDiffTestId,
                                    'cookies'
                                  )
                                }
                                className="text-amber-700 dark:text-amber-400 font-medium hover:underline cursor-pointer"
                              >
                                {grp.cookieDiffs} {grp.cookieDiffs === 1 ? 'cookie' : 'cookies'}
                              </button>
                            )}
                            {grp.cookieDiffs > 0 && grp.visualDiffs > 0 && (
                              <span className="text-muted-foreground/50">·</span>
                            )}
                            {grp.visualDiffs > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectPropertyAndCompare(
                                    grp.appId,
                                    grp.firstDiffTestId,
                                    'image'
                                  )
                                }
                                className="text-primary font-medium hover:underline cursor-pointer"
                              >
                                {grp.visualDiffs} visual
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* 4. Compact Row Actions */}
                    <td
                      className="px-3.5 py-1.5 text-right whitespace-nowrap align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        {primaryCanary && (
                          <button
                            type="button"
                            onClick={() => openDeepDive(primaryCanary.canaryName)}
                            data-testid={`deepdive-btn-${primaryCanary.canaryName}`}
                            title={`Inspect Staging & Production AWS canaries for ${grp.appId}`}
                            className={`inline-flex h-6.5 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors cursor-pointer ${
                              isInspected
                                ? 'border-primary bg-accent text-primary'
                                : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                            }`}
                          >
                            <Server className="h-3 w-3" />
                            <span>Canary</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={fanningOutScope !== null}
                          onClick={() =>
                            handleTriggerFanOut({
                              scope: 'property-pair',
                              appId: grp.appId,
                              label: `property:${grp.appId}`,
                            })
                          }
                          data-testid={`fanout-pair-${grp.appId}`}
                          title={`Re-test ${grp.appId}`}
                          className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                        >
                          {isRunningThis ? (
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          ) : (
                            <Play className="h-2.5 w-2.5 fill-current text-muted-foreground" />
                          )}
                          <span>Retest</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onSelectPropertyAndCompare(
                              grp.appId,
                              grp.firstDiffTestId,
                              grp.firstDiffTab
                            )
                          }
                          data-testid={`compare-prop-${grp.appId}`}
                          className="inline-flex h-6.5 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
                        >
                          <span>Inspect</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {groupedByProperty.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center">
                    <div className="text-xs font-medium text-foreground">
                      No sites match these filters.
                    </div>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Reset filters</span>
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/35 text-[11px] font-medium text-muted-foreground">
                <th className="w-8 px-3 py-2.5" aria-label="Select" />
                <th className="px-3 py-2.5">AWS Canary</th>
                <th className="px-3 py-2.5">Site &amp; Environment</th>
                <th className="px-3 py-2.5">Checks</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Last Run</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {filteredCanaries.map((c) => {
                const selected = selectedCanaryNames.includes(c.canaryName);
                const syncMeta = syncStatusMeta(c.syncStatus);
                const isInspected =
                  deepDiveCanaryName?.toLowerCase() === c.canaryName.toLowerCase();
                return (
                  <tr
                    key={c.canaryName}
                    onClick={() => openDeepDive(c.canaryName)}
                    className={`transition-colors cursor-pointer ${
                      isInspected
                        ? 'bg-primary/[0.08] ring-1 ring-inset ring-primary/35'
                        : 'hover:bg-muted/35'
                    }`}
                  >
                    <td
                      className="px-3 py-2.5 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelectCanary(c.canaryName)}
                        aria-label={`Select Canary ${c.canaryName}`}
                        className="h-3.5 w-3.5 rounded border-border cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <button
                        type="button"
                        onClick={() => openDeepDive(c.canaryName)}
                        className="font-mono font-semibold text-primary hover:underline cursor-pointer"
                      >
                        {c.canaryName}
                      </button>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {c.edgeIp} · {c.regionCode}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="font-mono text-xs text-foreground">
                        {c.appId}{' '}
                        <span className="text-muted-foreground">
                          ({c.network === 'staging' ? 'Staging' : 'Production'})
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                        {c.canonicalHost}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums align-middle">
                      {c.checkCount}
                    </td>
                    <td className="px-3 py-2.5 text-xs align-middle">
                      <span className={syncMeta.cls}>{syncMeta.label}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums align-middle">
                      {typeof c.lastRunPassed === 'number' ? (
                        <span
                          className={
                            (c.lastRunFailed || 0) > 0
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          }
                        >
                          {c.lastRunPassed}/{c.lastRunTotal}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right whitespace-nowrap align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openDeepDive(c.canaryName)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted cursor-pointer"
                        >
                          <span>Details</span>
                          <ChevronRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={startingCanary === c.canaryName}
                          onClick={() => handleStartSingleCanary(c.canaryName)}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                        >
                          {startingCanary === c.canaryName ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-2.5 w-2.5 fill-current" />
                          )}
                          <span>Run</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredCanaries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="text-xs font-medium text-foreground">
                      No canaries match these filters.
                    </div>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Reset filters</span>
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Fixed Right-Hand Slide-Over Drawer for Canary Inspection (Always 100% visible in viewport!) */}
      {deepDiveCanaryName && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[1px]"
          onClick={() => {
            setDeepDiveCanaryName(null);
            setDeepDiveReport(null);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Canary Inspector ${deepDiveCanaryName}`}
            data-testid="canary-deep-dive-panel"
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-full w-full max-w-[520px] flex-col border-l border-border bg-card shadow-2xl"
          >
            {/* Slide-Over Header */}
            <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/25 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Server className="h-4 w-4 text-primary shrink-0" />
                  <h2 className="font-mono text-sm font-bold text-foreground truncate">
                    {deepDiveReport ? deepDiveReport.canary.appId : deepDiveCanaryName}
                  </h2>
                  {deepDiveReport && (
                    <span className="text-xs font-medium text-primary">
                      · {deepDiveReport.canary.network === 'staging' ? 'Staging Canary' : 'Production Canary'}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <span>{deepDiveCanaryName}</span>
                  {deepDiveReport && (
                    <>
                      <span>·</span>
                      <span>Edge {deepDiveReport.canary.edgeIp}</span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDeepDiveCanaryName(null);
                  setDeepDiveReport(null);
                }}
                aria-label="Close Canary inspector"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {deepDiveLoading || !deepDiveReport ? (
              <div className="flex flex-1 items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Loading canary details…</span>
              </div>
            ) : (
              <>
                {/* Instant Staging <-> Prod Switcher & Clear Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-card px-5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={startingCanary === deepDiveReport.canary.canaryName}
                      onClick={() => handleStartSingleCanary(deepDiveReport.canary.canaryName)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      {startingCanary === deepDiveReport.canary.canaryName ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3 fill-current" />
                      )}
                      <span>Run Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onSelectPropertyAndCompare(
                          deepDiveReport.canary.appId,
                          deepDiveReport.canary.firstDiffTestId,
                          deepDiveReport.canary.firstDiffTab
                        )
                      }
                      data-testid="deepdive-open-workbench-compare"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                    >
                      <span>Compare Diffs</span>
                      <ArrowRight className="h-3.5 w-3.5 text-primary" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {deepDiveReport.pairedCanaryName && (
                      <button
                        type="button"
                        onClick={() => openDeepDive(deepDiveReport.pairedCanaryName!)}
                        title={`Switch to ${deepDiveReport.canary.network === 'staging' ? 'Production' : 'Staging'} canary`}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-primary hover:bg-muted cursor-pointer"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        <span>
                          Switch to {deepDiveReport.canary.network === 'staging' ? 'Prod' : 'Staging'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenSetupForProperty(deepDiveReport.canary.appId)}
                      title="Edit checks in Settings"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>

                {/* Drawer Tabs — Plain English, Ordered by Operator Priority */}
                <div className="flex items-center gap-5 border-b border-border bg-muted/15 px-5 text-xs">
                  {(
                    [
                      { id: 'checks', label: `Checks (${deepDiveReport.checks.length})` },
                      { id: 'runs', label: `History (${deepDiveReport.runHistory.length})` },
                      { id: 'overview', label: 'AWS & CLI' },
                      { id: 'spec', label: 'JSON' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDeepDiveTab(t.id)}
                      className={`relative py-2.5 text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                        deepDiveTab === t.id
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t.label}
                      {deepDiveTab === t.id && (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Drawer Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs">
                  {deepDiveTab === 'checks' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {deepDiveReport.checks.length} synthetic checks executed on{' '}
                          <span className="font-mono text-foreground">
                            {deepDiveReport.canary.targetId}
                          </span>
                        </span>
                        <span>Click any check to compare</span>
                      </div>

                      <div className="divide-y divide-border/70 rounded-lg border border-border bg-background overflow-hidden">
                        {deepDiveReport.checks.map((chk) => {
                          const passed = chk.lastPass !== false;
                          return (
                            <div
                              key={chk.id}
                              onClick={() =>
                                onSelectPropertyAndCompare(
                                  deepDiveReport.canary.appId,
                                  chk.id,
                                  'headers'
                                )
                              }
                              className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-bold text-primary shrink-0">
                                    {chk.id}
                                  </span>
                                  <span className="font-medium text-foreground truncate">
                                    {chk.name}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                  <span className="truncate max-w-[230px]">{chk.path}</span>
                                  <span>·</span>
                                  <span
                                    className={
                                      passed
                                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                        : 'text-rose-600 dark:text-rose-400 font-semibold'
                                    }
                                  >
                                    HTTP {chk.lastActualStatus ?? chk.expectedStatus}
                                  </span>
                                  {typeof chk.lastDurationMs === 'number' && (
                                    <>
                                      <span>·</span>
                                      <span>{chk.lastDurationMs}ms</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium text-foreground">
                                <span>Inspect</span>
                                <ArrowRight className="h-3 w-3 text-primary" />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {deepDiveTab === 'runs' && (
                    <div className="divide-y divide-border/70 rounded-lg border border-border bg-background overflow-hidden">
                      {deepDiveReport.runHistory.map((run) => (
                        <div key={run.runKey} className="px-3.5 py-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 font-mono text-xs">
                            <span className="font-semibold text-foreground truncate">
                              {run.label}
                            </span>
                            <span
                              className={
                                run.failedTests > 0
                                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                  : 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              }
                            >
                              {run.passedTests}/{run.totalTests} passed
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground truncate">
                            s3://{inventory.s3Bucket}/{run.s3ManifestKey}
                          </div>
                        </div>
                      ))}
                      {deepDiveReport.runHistory.length === 0 && (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                          No runs recorded yet. Click Run Canary above.
                        </div>
                      )}
                    </div>
                  )}

                  {deepDiveTab === 'overview' && (
                    <div className="space-y-3">
                      <dl className="grid grid-cols-1 gap-2 font-mono text-[11px]">
                        <div className="rounded-md border border-border/80 bg-muted/20 p-3">
                          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Canary ARN
                          </dt>
                          <dd className="mt-1 break-all text-foreground">
                            {deepDiveReport.canary.arn}
                          </dd>
                        </div>
                        <div className="rounded-md border border-border/80 bg-muted/20 p-3">
                          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            S3 Artifact Store
                          </dt>
                          <dd className="mt-1 break-all text-foreground">
                            {deepDiveReport.canary.artifactS3Location}
                          </dd>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md border border-border/80 bg-muted/20 p-3">
                            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Edge Target IP
                            </dt>
                            <dd className="mt-1 text-foreground">
                              {deepDiveReport.canary.edgeIp}
                            </dd>
                          </div>
                          <div className="rounded-md border border-border/80 bg-muted/20 p-3">
                            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Paired Canary
                            </dt>
                            <dd className="mt-1 text-primary">
                              {deepDiveReport.pairedCanaryName || 'None'}
                            </dd>
                          </div>
                        </div>
                      </dl>

                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>AWS CLI Commands</span>
                          </div>
                          <button
                            type="button"
                            disabled={syncingScope !== null}
                            onClick={() => handleSyncToAws(deepDiveReport.canary.appId)}
                            className="inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-2 text-[10px] font-medium hover:bg-muted cursor-pointer"
                          >
                            <UploadCloud className="h-3 w-3 text-primary" />
                            <span>Sync Spec</span>
                          </button>
                        </div>
                        {(
                          [
                            ['start', 'StartCanary', deepDiveReport.awsCliCommands.startCanary],
                            ['runs', 'GetCanaryRuns', deepDiveReport.awsCliCommands.getCanaryRuns],
                            ['s3', 'List S3 Artifacts', deepDiveReport.awsCliCommands.listS3Artifacts],
                          ] as const
                        ).map(([k, label, cmd]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-background px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="text-[10px] font-medium text-muted-foreground">
                                {label}
                              </div>
                              <code className="block font-mono text-[10px] text-foreground truncate">
                                {cmd}
                              </code>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyText(k, cmd)}
                              aria-label={`Copy ${label} command`}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10px] hover:bg-muted cursor-pointer"
                            >
                              {copiedKey === k ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deepDiveTab === 'spec' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          CreateCanary Spec
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              'spec',
                              JSON.stringify(deepDiveReport.createCanaryPayloadPreview, null, 2)
                            )
                          }
                          className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted cursor-pointer"
                        >
                          {copiedKey === 'spec' ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === 'spec' ? 'Copied' : 'Copy JSON'}</span>
                        </button>
                      </div>
                      <pre className="rounded-lg border border-border bg-muted/30 p-3.5 font-mono text-[11px] leading-relaxed text-foreground overflow-x-auto">
                        {JSON.stringify(deepDiveReport.createCanaryPayloadPreview, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
