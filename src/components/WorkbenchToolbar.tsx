import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  Command,
  Copy,
  Keyboard,
  Moon,
  MoreHorizontal,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { OverallVerdict, RunRecord } from '../engine/types';
import { GLOBAL_EXECUTION_POPS } from '../config/template.config';
import { SuiteSreTelemetry } from '../engine/sreIntelligence';
import { ActiveRunStreamState } from '../engine/runStreamEngine';
import { buildVerdictBreakdownText } from '../engine/workbenchModel';

export interface BackgroundJobLite {
  id: string;
  label: string;
  status: 'running' | 'completed';
  progress: string;
}

export interface WorkbenchToolbarProps {
  activeAppId: string;
  activeAppName: string;
  canonicalHost: string;
  headlineVerdict: OverallVerdict;
  headerDiffs: number;
  cookieDiffs: number;
  visualDiffs: number;
  totalChecks: number;
  compareMode: 'compare' | 'single';
  onSetCompareMode: (mode: 'compare' | 'single') => void;
  candidateTarget: string;
  baselineTarget: string;
  availableTargets: string[];
  runs: RunRecord[];
  candidateRunKey: string;
  baselineRunKey: string;
  onChangeCandidateTarget: (t: string) => void;
  onChangeBaselineTarget: (t: string) => void;
  onChangeCandidateRunKey: (k: string) => void;
  onChangeBaselineRunKey: (k: string) => void;
  onSwapSides: () => void;
  selectedExecutionPopId: string;
  onChangeExecutionPopId: (id: string) => void;
  sreSummary: SuiteSreTelemetry;
  ignoreAcceptedDiffs: boolean;
  onToggleIgnoreAccepted: () => void;
  onCopyMarkdown: () => void;
  onRerunAllDiffs: () => void;
  onRunSingleTarget: (targetId: string) => void;
  onTogglePropScale: () => void;
  propCount: number;
  onToggleSuiteScale: () => void;
  suiteCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
  onOpenShortcuts: () => void;
  backgroundJobs: BackgroundJobLite[];
  runStreamState: ActiveRunStreamState | null;
  onOpenSetup?: (tab: 'suite' | 'envs') => void;
  onOpenVsCode?: () => void;
  onOpenSynthetics?: () => void;
}

function verdictAppearance(verdict: OverallVerdict): {
  badgeClass: string;
  icon: React.ReactNode;
} {
  if (verdict === 'NO-GO') {
    return {
      badgeClass:
        'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      icon: <ShieldAlert className="h-3.5 w-3.5 shrink-0" />,
    };
  }
  if (verdict === 'REVIEW') {
    return {
      badgeClass:
        'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
    };
  }
  if (verdict === 'GO') {
    return {
      badgeClass:
        'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      icon: <ShieldCheck className="h-3.5 w-3.5 shrink-0" />,
    };
  }
  return {
    badgeClass: 'border-border bg-muted text-foreground',
    icon: null,
  };
}

export const WorkbenchToolbar: React.FC<WorkbenchToolbarProps> = ({
  activeAppId,
  activeAppName,
  canonicalHost,
  headlineVerdict,
  headerDiffs,
  cookieDiffs,
  visualDiffs,
  totalChecks,
  compareMode,
  onSetCompareMode,
  candidateTarget,
  baselineTarget,
  availableTargets,
  runs,
  candidateRunKey,
  baselineRunKey,
  onChangeCandidateTarget,
  onChangeBaselineTarget,
  onChangeCandidateRunKey,
  onChangeBaselineRunKey,
  onSwapSides,
  selectedExecutionPopId,
  onChangeExecutionPopId,
  sreSummary,
  ignoreAcceptedDiffs,
  onToggleIgnoreAccepted,
  onCopyMarkdown,
  onRerunAllDiffs,
  onRunSingleTarget,
  onTogglePropScale,
  propCount,
  onToggleSuiteScale,
  suiteCount,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenShortcuts,
  backgroundJobs,
  runStreamState,
  onOpenSetup,
  onOpenVsCode,
  onOpenSynthetics,
}) => {
  const [openMenu, setOpenMenu] = useState<'compare' | 'sre' | 'more' | null>(null);
  const [copiedPapi, setCopiedPapi] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const vApp = verdictAppearance(headlineVerdict);
  const breakdown = buildVerdictBreakdownText({
    headerDiffs,
    cookieDiffs,
    visualDiffs,
    totalChecks,
  });

  const activePopObj = GLOBAL_EXECUTION_POPS.find((p) => p.id === selectedExecutionPopId);
  const popShort = activePopObj ? activePopObj.popCode : 'Auto';

  const candRuns = runs.filter((r) => r.target === candidateTarget);
  const baseRuns = runs.filter((r) => r.target === baselineTarget);
  const topDiagnosis = sreSummary.blockerDiagnoses[0] || sreSummary.diagnoses[0];

  const shortTarget = (t: string) => {
    const parts = t.split('.');
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : t;
  };

  const showCanonicalHost = !activeAppName.toLowerCase().includes(canonicalHost.toLowerCase());
  const totalUnaccepted = headerDiffs + cookieDiffs + visualDiffs;

  return (
    <div className="relative border-b border-border bg-card px-3 py-1.5 sm:px-4 min-w-0 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        {/* Left: All Sites + Verdict + Inline Site Name & Diff Summary */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onOpenSynthetics && (
            <button
              type="button"
              onClick={onOpenSynthetics}
              data-testid="btn-back-to-fleet"
              title="Back to All Sites"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">All Sites</span>
            </button>
          )}

          <span
            data-testid="headline-verdict"
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-xs font-bold tracking-tight tabular-nums whitespace-nowrap shrink-0 ${vApp.badgeClass}`}
          >
            {vApp.icon}
            <span>{headlineVerdict}</span>
          </span>

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 flex-1">
            <h1 className="font-display text-sm font-semibold text-foreground truncate max-w-[340px]">
              {activeAppName}
            </h1>
            {showCanonicalHost && (
              <span className="hidden 2xl:inline font-mono text-[11px] text-muted-foreground truncate">
                {canonicalHost}
              </span>
            )}
            <span className="hidden lg:inline text-border" aria-hidden="true">|</span>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground tabular-nums whitespace-nowrap">
              <span>{breakdown}</span>
              <span aria-hidden="true">·</span>
              <span>
                {totalChecks} {totalChecks === 1 ? 'check' : 'checks'}
              </span>
              {compareMode === 'single' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-primary font-medium">
                    {shortTarget(candidateTarget)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Streamlined 3-Control Workbench Bar */}
        <div
          ref={menuContainerRef}
          className="relative flex flex-wrap items-center gap-1.5 shrink-0"
        >
          {/* 1. Unified Target Pair + Edge PoP Selector */}
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'compare' ? null : 'compare')}
            data-testid="btn-compare-popover"
            title="Switch environments, run snapshots, or edge region"
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              openMenu === 'compare'
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted'
            }`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {compareMode === 'single'
                ? shortTarget(candidateTarget)
                : candidateTarget.endsWith('.staging') && baselineTarget.endsWith('.prod')
                ? 'Staging vs Prod'
                : `${shortTarget(candidateTarget)} vs ${shortTarget(baselineTarget)}`}
            </span>
            {popShort !== 'Auto' && (
              <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">
                · {popShort}
              </span>
            )}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {/* 2. Hide Accepted Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={ignoreAcceptedDiffs}
            onClick={onToggleIgnoreAccepted}
            data-testid="toggle-ignore-accepted"
            title="Hide differences that have already been accepted"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <span
              className={`inline-block h-3 w-5 rounded-full transition-colors relative ${
                ignoreAcceptedDiffs ? 'bg-primary' : 'bg-muted-foreground/40'
              }`}
            >
              <span
                className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-transform ${
                  ignoreAcceptedDiffs ? 'left-2.5' : 'left-0.5'
                }`}
              />
            </span>
            <span className="hidden md:inline">Hide Accepted</span>
          </button>

          {/* 3. Overflow Menu */}
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')}
            data-testid="btn-more-popover"
            aria-label="More options"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors cursor-pointer ${
              openMenu === 'more' || openMenu === 'sre'
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted'
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {/* Unified Targets & Edge PoP Popover */}
          {openMenu === 'compare' && (
            <div className="absolute right-0 top-9.5 z-40 w-80 rounded-md border border-border bg-popover p-3.5 shadow-lg">
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <span className="text-xs font-semibold text-foreground">
                  Targets &amp; Edge PoP ({activeAppId})
                </span>
                <div className="inline-flex rounded border border-border bg-background p-0.5">
                  <button
                    type="button"
                    onClick={() => onSetCompareMode('compare')}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                      compareMode === 'compare'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Compare
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetCompareMode('single')}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                      compareMode === 'single'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Single Run
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2.5 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    {compareMode === 'single' ? 'Target Environment' : 'Candidate (Staging)'}
                  </label>
                  <select
                    value={candidateTarget}
                    onChange={(e) => onChangeCandidateTarget(e.target.value)}
                    className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                  >
                    {availableTargets.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {candRuns.length > 0 && (
                    <select
                      value={candidateRunKey}
                      onChange={(e) => onChangeCandidateRunKey(e.target.value)}
                      className="mt-1.5 h-7.5 w-full rounded border border-border bg-muted/50 px-2 font-mono text-[11px] text-foreground"
                    >
                      {candRuns.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {compareMode === 'compare' && (
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Baseline (Production)
                    </label>
                    <select
                      value={baselineTarget}
                      onChange={(e) => onChangeBaselineTarget(e.target.value)}
                      className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                    >
                      {availableTargets.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {baseRuns.length > 0 && (
                      <select
                        value={baselineRunKey}
                        onChange={(e) => onChangeBaselineRunKey(e.target.value)}
                        className="mt-1.5 h-7.5 w-full rounded border border-border bg-muted/50 px-2 font-mono text-[11px] text-foreground"
                      >
                        {baseRuns.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Edge Execution PoP
                  </label>
                  <select
                    value={selectedExecutionPopId}
                    onChange={(e) => onChangeExecutionPopId(e.target.value)}
                    data-testid="select-execution-pop"
                    className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                  >
                    <option value="auto">Auto (Property Default)</option>
                    {GLOBAL_EXECUTION_POPS.map((pop) => (
                      <option key={pop.id} value={pop.id}>
                        {pop.popCode} — {pop.city} ({pop.regionGroup})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/70">
                  {compareMode === 'compare' ? (
                    <button
                      type="button"
                      onClick={onSwapSides}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2.5 text-[11px] font-medium hover:bg-muted cursor-pointer"
                    >
                      <ArrowLeftRight className="h-3 w-3" />
                      Swap Sides
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onRunSingleTarget(candidateTarget);
                        setOpenMenu(null);
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground cursor-pointer"
                    >
                      Run {shortTarget(candidateTarget)}
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    {onOpenSetup && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          onOpenSetup('envs');
                        }}
                        data-testid="btn-popover-manage-envs"
                        className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                      >
                        Manage Envs
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenMenu(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SRE Performance Detail Popover (launched from More menu) */}
          {openMenu === 'sre' && (
            <div className="absolute right-0 top-9.5 z-40 w-96 max-w-[92vw] rounded-md border border-border bg-popover p-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-semibold text-foreground">
                  Edge SRE &amp; Performance Telemetry
                </span>
                <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                  Risk: {sreSummary.releaseRiskTier}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-[11px] text-muted-foreground">Apdex</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {sreSummary.apdexCandidate.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">P50 / P95</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {sreSummary.p50CandidateMs} / {sreSummary.p95CandidateMs}ms
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Cache Parity</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {sreSummary.cacheParityPct}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">CWV Good</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {sreSummary.cwvPassRatePct}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">SLO Budget</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {sreSummary.sloErrorBudgetRemainingPct}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Burn Rate</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {sreSummary.sloBurnRateMultiplier}x
                  </div>
                </div>
              </div>

              {topDiagnosis && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="text-[11px] font-semibold text-muted-foreground">
                    Top Diagnosis · {topDiagnosis.testId}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-foreground">
                    {topDiagnosis.title}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {topDiagnosis.rootCauseSummary}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {topDiagnosis.remediationTitle}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(topDiagnosis.remediationSnippet);
                        setCopiedPapi(true);
                        setTimeout(() => setCopiedPapi(false), 1800);
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted shrink-0 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedPapi ? 'Copied' : 'Copy PAPI'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Overflow Menu */}
          {openMenu === 'more' && (
            <div className="absolute right-0 top-9.5 z-40 w-64 rounded-md border border-border bg-popover p-1.5 shadow-lg text-xs">
              <button
                type="button"
                onClick={() => setOpenMenu('sre')}
                data-testid="btn-sre-popover"
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  <span>SRE Telemetry</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  P95 {sreSummary.p95CandidateMs}ms
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onCopyMarkdown();
                  setOpenMenu(null);
                }}
                data-testid="btn-copy-markdown"
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Export Markdown Summary</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onRerunAllDiffs();
                  setOpenMenu(null);
                }}
                data-testid="btn-rerun-all-diffs"
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <RotateCw className="h-3.5 w-3.5 text-primary" />
                  <span>Re-run Diffing Checks</span>
                </span>
                {totalUnaccepted > 0 && (
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {totalUnaccepted}
                  </span>
                )}
              </button>

              {(onOpenSetup || onOpenVsCode) && (
                <>
                  <div className="my-1 border-t border-border" />
                  {onOpenSetup && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenSetup('suite');
                        setOpenMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
                    >
                      <span>Manage Checks &amp; Envs</span>
                      <span className="font-mono text-[11px] text-primary">Config</span>
                    </button>
                  )}
                  {onOpenVsCode && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenVsCode();
                        setOpenMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
                    >
                      <span>Open Code Editor</span>
                      <span className="font-mono text-[11px] text-primary">Studio</span>
                    </button>
                  )}
                </>
              )}

              <div className="my-1 border-t border-border" />

              <button
                type="button"
                onClick={() => {
                  onToggleTheme();
                  setOpenMenu(null);
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  {theme === 'dark' ? (
                    <Sun className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Moon className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                </span>
                <kbd className="font-mono text-[11px] text-muted-foreground">T</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  onOpenCommandPalette();
                  setOpenMenu(null);
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Command className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Quick Jump</span>
                </span>
                <kbd className="font-mono text-[11px] text-muted-foreground">⌘K</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  onOpenShortcuts();
                  setOpenMenu(null);
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Keyboard Shortcuts</span>
                </span>
                <kbd className="font-mono text-[11px] text-muted-foreground">?</kbd>
              </button>

              <div className="my-1 border-t border-border" />

              <button
                type="button"
                onClick={() => {
                  onTogglePropScale();
                  setOpenMenu(null);
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span>{propCount >= 50 ? 'Restore 14 Properties' : 'Simulate 50 Properties'}</span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{propCount}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onToggleSuiteScale();
                  setOpenMenu(null);
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left hover:bg-muted cursor-pointer"
              >
                <span>{suiteCount >= 64 ? 'Restore Core Checks' : 'Scale to 64 Checks'}</span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{suiteCount}</span>
              </button>

              {backgroundJobs.length > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <div className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                    Recent Runs ({backgroundJobs.length})
                  </div>
                  {backgroundJobs.slice(0, 3).map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      <span className="truncate pr-2">{job.label}</span>
                      <span className="font-mono shrink-0 tabular-nums">{job.progress}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {runStreamState?.active && (
        <div className="mt-2 flex items-center gap-3 border-t border-border/60 pt-2 text-xs">
          <span className="font-mono text-foreground truncate">
            {runStreamState.headlineStatus}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${runStreamState.progressPercent}%` }}
            />
          </div>
          <span className="font-mono text-muted-foreground tabular-nums shrink-0">
            {runStreamState.completedCount}/{runStreamState.totalCount}
          </span>
        </div>
      )}
    </div>
  );
};
