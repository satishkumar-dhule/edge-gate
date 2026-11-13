import React, { useState } from 'react';
import { AcceptedRule, AppConfig, RunRecord } from '../engine/types';
import { resolveLiveScreenshotUrl } from '../engine/domScreenshotRenderer';
import {
  DEFAULT_TEMPLATE_CONFIG,
  TemplateConfig,
  TestCaseDefinition,
  resolvePropertyHostname,
} from '../config/template.config';
import {
  buildOpenApiSpec,
  evaluateNovaLiteVisualDiff,
  generateAdhocLambdaScripts,
  generateArchitectureMarkdown,
  generateBedrockNovaJudgeScript,
  generateEnvConfigFile,
  generateSyntheticsCanaryScript,
  generateTerraformBundle,
  getOpenApiEndpointCatalog,
} from '../engine/awsBlueprint';
import {
  BUILTIN_GATE_PLUGINS,
  evaluatePluginPipeline,
  generateAiAgentAdaptationBundle,
  generateOneShotAdaptationPrompt,
} from '../engine/pluginRegistry';
import {
  defaultZeroTokenEngine,
  ZeroTokenEvaluationDecision,
} from '../engine/zeroTokenArchitecture';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';
import {
  Server,
  Cpu,
  Database,
  Check,
  Copy,
  Play,
  Trash2,
  ShieldCheck,
  Layers,
  Globe,
  Sparkles,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Lock,
  KeyRound,
  Eye,
  ArrowLeftRight,
  FileText,
  Sun,
  Moon,
  Plus,
  Code2,
  ListChecks,
  Download,
  GitCompare,
  RotateCw,
  Search,
  Terminal,
  FileSpreadsheet,
  ChevronDown,
  History,
} from 'lucide-react';

export interface BackgroundJob {
  id: string;
  title: string;
  target: string;
  engine: string;
  status: 'running' | 'completed';
  startedAt: string;
  progress: string;
  kind: 'single-run' | 'compare' | 'rerun' | 'ai-judge';
  onInspect?: () => void;
}

export interface EndpointOption {
  targetId: string;
  appId: string;
  envId: string;
  envName: string;
  network: 'staging' | 'prod';
}

// ============================================================================
// REUSABLE COMPONENT 0: SCALABLE TOP-NAV PROPERTY COMMAND SWITCHER (50+ APPS)
// ============================================================================
export const PropertyCommandSwitcher: React.FC<{
  apps: AppConfig[];
  activeAppId: string;
  onSelectProperty: (appId: string) => void;
  onOpenSettings?: () => void;
  onToggleScalePreset?: () => void;
}> = ({
  apps,
  activeAppId,
  onSelectProperty,
  onOpenSettings,
  onToggleScalePreset,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const currentApp = apps.find((a) => a.id === activeAppId) || apps[0];

  const filteredApps = apps.filter((app) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const host = resolvePropertyHostname(app.id, 'prod').toLowerCase();
    return (
      app.id.toLowerCase().includes(q) ||
      app.name.toLowerCase().includes(q) ||
      host.includes(q)
    );
  });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Switch Active Property"
        onClick={() => setOpen((prev) => !prev)}
        title={`Active Property: ${currentApp.id} — ${currentApp.name} (${apps.length} total properties). Click to search & switch.`}
        className="h-7 px-2.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-100 inline-flex items-center gap-2 text-xs transition-colors cursor-pointer shrink-0 whitespace-nowrap"
      >
        <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        <span className="font-mono font-bold text-white">{currentApp.id}</span>
        <span className="text-zinc-400 hidden 2xl:inline truncate max-w-[140px]">
          {currentApp.name}
        </span>
        <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] shrink-0 whitespace-nowrap">
          {apps.length} props
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-9 z-50 w-96 rounded-lg border border-border bg-background text-foreground shadow-2xl overflow-hidden">
            <div className="p-2.5 border-b border-border bg-muted/30">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  placeholder={`Search ${apps.length} properties by ID, name, or host…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full h-8 pl-8 pr-2.5 rounded border border-input bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {filteredApps.map((app) => {
                const isSelected = app.id === activeAppId;
                const prodHost = resolvePropertyHostname(app.id, 'prod');
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => {
                      onSelectProperty(app.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-muted/60 transition-colors cursor-pointer ${
                      isSelected ? 'bg-sky-500/10' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-foreground">
                          {app.id}
                        </span>
                        <span className="text-xs font-medium text-foreground truncate">
                          {app.name}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>{prodHost}</span>
                        <span>·</span>
                        <span>
                          Envs: {app.envs.map((e) => e.id.toUpperCase()).join(', ')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {app.envs.length} {app.envs.length === 1 ? 'env' : 'envs'}
                      </Badge>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-sky-500" />
                      )}
                    </div>
                  </button>
                );
              })}

              {filteredApps.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No properties matching "{query}"
                </div>
              )}
            </div>

            <div className="px-3 py-2 bg-muted/30 border-t border-border flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">
                {filteredApps.length} of {apps.length} properties
              </span>
              <div className="flex items-center gap-2.5">
                {onToggleScalePreset && (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleScalePreset();
                    }}
                    title="Toggle between 8 default properties and 50 enterprise properties to test high-scale navigation"
                    className="text-amber-600 dark:text-amber-400 hover:underline font-mono font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Layers className="w-3 h-3" />
                    {apps.length >= 50 ? 'Reset 8 Props' : 'Simulate 50 Props'}
                  </button>
                )}
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenSettings();
                    }}
                    className="text-sky-600 dark:text-sky-400 hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Register
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// REUSABLE VISUAL MINIATURE: DOM PAGE SNAPSHOT THUMBNAIL WITH HOVER DETAILS
// ============================================================================
export const PageMiniThumb: React.FC<{
  testId: string;
  testName: string;
  url: string;
  hasVisualDiff?: boolean;
  isRedirect?: boolean;
  screenshotRevision?: number | string;
  onClick?: () => void;
}> = ({
  testId,
  testName,
  url,
  hasVisualDiff,
  isRedirect,
  screenshotRevision,
  onClick,
}) => {
  const [thumbMissing, setThumbMissing] = useState(false);
  const liveThumbUrl = resolveLiveScreenshotUrl({
    testId,
    testName,
    url,
    side: 'A',
    highlightDiff: hasVisualDiff,
    revision: screenshotRevision,
  });
  React.useEffect(() => {
    setThumbMissing(false);
  }, [liveThumbUrl]);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${testId}: ${testName}\nURL: ${url}\n${
        isRedirect
          ? '301 Edge Redirect Check'
          : hasVisualDiff
          ? 'Visual Diff Detected (Click to inspect live snapshot)'
          : 'DOM Visual Snapshot Matched'
      }`}
      className={`group relative w-11 h-7 rounded border overflow-hidden shrink-0 transition-transform hover:scale-105 cursor-pointer ${
        hasVisualDiff
          ? 'border-amber-500 ring-1 ring-amber-500/40'
          : isRedirect
          ? 'border-sky-500/50'
          : 'border-border'
      }`}
    >
      {thumbMissing ? (
        <div
          data-testid={`page-mini-thumb-missing-${testId}`}
          className="w-full h-full bg-muted flex items-center justify-center font-mono text-[8px] text-muted-foreground"
        >
          {testId}
        </div>
      ) : (
        <img
          src={liveThumbUrl}
          onError={() => setThumbMissing(true)}
          alt={`${testId} ${testName} thumbnail`}
          data-testid={`page-mini-thumb-img-${testId}`}
          className="w-full h-full object-cover object-top block"
        />
      )}
      <span
        className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-background ${
          hasVisualDiff
            ? 'bg-amber-500'
            : isRedirect
            ? 'bg-sky-500'
            : 'bg-emerald-500'
        }`}
      />
    </button>
  );
};

// ============================================================================
// REUSABLE COMPONENT A: COMPACT NETWORK ENDPOINT CELL (STAGING / PROD)
// ============================================================================
export const NetworkEndpointCell: React.FC<{
  network: 'staging' | 'prod';
  targetId: string;
  envId: string;
  activeRun: RunRecord;
  targetRuns: RunRecord[];
  isRunning: boolean;
  onSelectRun: (runKey: string) => void;
  onInspect: () => void;
  onRunSuite: () => void;
  onCompareWithPrev?: (latestRunKey: string, prevRunKey: string) => void;
}> = ({
  network,
  targetId,
  envId,
  activeRun,
  targetRuns,
  isRunning,
  onSelectRun,
  onInspect,
  onRunSuite,
  onCompareWithPrev,
}) => {
  const isStaging = network === 'staging';
  const netCfg = isStaging
    ? DEFAULT_TEMPLATE_CONFIG.networks.staging
    : DEFAULT_TEMPLATE_CONFIG.networks.prod;

  const activeIdx = Math.max(
    0,
    targetRuns.findIndex((r) => r.key === activeRun.key)
  );
  const prevRun = targetRuns[activeIdx + 1] || (activeIdx > 0 ? targetRuns[0] : undefined);

  return (
    <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-md border border-border bg-muted/20">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span
          title={`${netCfg.label} · Edge IP ${netCfg.defaultEdgeIp}`}
          className={`w-2 h-2 rounded-full shrink-0 ${
            isStaging ? 'bg-sky-500' : 'bg-emerald-500'
          }`}
        />
        <Badge
          variant="outline"
          title={`${activeRun.passedTests} of ${activeRun.totalTests} checks passed in ${activeRun.label} (${activeRun.key})`}
          className="font-mono text-[10px] px-1 py-0 shrink-0 gap-0.5"
        >
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
          {activeRun.passedTests}/{activeRun.totalTests}
        </Badge>
        <select
          aria-label={`${isStaging ? 'Staging' : 'Production'} run for ${envId}`}
          title={`Select run for ${targetId} (${targetRuns.length} available)`}
          value={activeRun.key}
          onChange={(e) => onSelectRun(e.target.value)}
          className="min-w-0 max-w-[130px] flex-1 h-6 rounded border border-input bg-background px-1.5 text-[11px] font-mono text-foreground truncate"
        >
          {targetRuns.map((r, idx) => (
            <option key={r.key} value={r.key}>
              {r.label || r.key} {idx === 0 ? '★' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {prevRun && onCompareWithPrev && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCompareWithPrev(activeRun.key, prevRun.key)}
            aria-label={`Compare ${targetId} vs Previous Run`}
            title={`Compare ${activeRun.label} vs Previous Run (${prevRun.label}) on ${targetId}`}
          >
            <History className="!size-3.5 text-amber-500" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onInspect}
          aria-label={`Inspect ${targetId}`}
          title={`Inspect Single Run (${activeRun.label} on ${targetId})`}
        >
          <Eye className="!size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          onClick={onRunSuite}
          disabled={isRunning}
          aria-label={`Run Suite on ${targetId}`}
          title={`Trigger AWS Synthetics Canary on ${targetId} (${netCfg.edgeSuffix}) — automatically compares new run vs previous run (${activeRun.label})`}
        >
          {isRunning ? (
            <Loader2 className="!size-3 animate-spin text-sky-500" />
          ) : (
            <Play className="fill-current !size-2.5" />
          )}
        </Button>
      </div>
    </div>
  );
};

// ============================================================================
// REUSABLE COMPONENT B: COMPARISON TARGET BAR (USED IN PROPERTY & DIFF VIEWS)
// ============================================================================
export const ComparisonTargetBar: React.FC<{
  mode: 'launcher' | 'diff-toolbar';
  endpoints: EndpointOption[];
  runs: RunRecord[];
  candidateTarget: string;
  baselineTarget: string;
  activeCandidateRunKey: string;
  activeBaselineRunKey: string;
  onChangeCandidateTarget: (t: string) => void;
  onChangeBaselineTarget: (t: string) => void;
  onChangeCandidateRun: (key: string) => void;
  onChangeBaselineRun: (key: string) => void;
  onSwapSides: () => void;
  onCompareWithPrevRun?: () => void;
  onOpenDiff?: () => void;
  onRunBothAndCompare: () => void;
  totalDiffsCount?: number;
  isComparingBoth?: boolean;
  ignoreAcceptedDiffs?: boolean;
  onChangeIgnoreAcceptedDiffs?: (val: boolean) => void;
  onExportReport?: () => void;
}> = ({
  mode,
  endpoints,
  runs,
  candidateTarget,
  baselineTarget,
  activeCandidateRunKey,
  activeBaselineRunKey,
  onChangeCandidateTarget,
  onChangeBaselineTarget,
  onChangeCandidateRun,
  onChangeBaselineRun,
  onSwapSides,
  onCompareWithPrevRun,
  onOpenDiff,
  onRunBothAndCompare,
  totalDiffsCount = 0,
  isComparingBoth = false,
  ignoreAcceptedDiffs = true,
  onChangeIgnoreAcceptedDiffs,
  onExportReport,
}) => {
  const renderSelectorPair = (
    label: string,
    fullTooltip: string,
    badgeVariant: 'default' | 'secondary',
    targetVal: string,
    runKeyVal: string,
    onTargetChange: (t: string) => void,
    onRunChange: (k: string) => void,
    ariaPrefix: string
  ) => (
    <div className="flex items-center gap-1 shrink-0" title={fullTooltip}>
      <Badge
        variant={badgeVariant}
        className="font-mono text-[10px] px-1.5 py-0 cursor-help"
      >
        {label}
      </Badge>
      <select
        aria-label={`${ariaPrefix} Endpoint`}
        value={targetVal}
        onChange={(e) => onTargetChange(e.target.value)}
        title={`Select ${ariaPrefix} Edge Target (${targetVal})`}
        className="h-6 rounded border border-input bg-muted/40 px-1.5 text-[11px] font-mono text-foreground"
      >
        {endpoints.map((ep) => (
          <option key={ep.targetId} value={ep.targetId}>
            {ep.envId} · {ep.network === 'staging' ? 'stg' : 'prd'}
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaPrefix} Run`}
        value={runKeyVal}
        onChange={(e) => onRunChange(e.target.value)}
        title={`Select ${ariaPrefix} Run Snapshot`}
        className="h-6 max-w-[115px] rounded border border-input bg-background px-1 text-[11px] font-mono text-muted-foreground truncate"
      >
        {runs
          .filter((r) => r.target === targetVal)
          .map((r, idx) => (
            <option key={r.key} value={r.key}>
              {r.label || r.key} {idx === 0 ? '★' : ''}
            </option>
          ))}
      </select>
    </div>
  );

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        mode === 'launcher' ? 'w-auto justify-end' : 'w-full justify-between'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1">
        {renderSelectorPair(
          'A',
          `Condition A (Candidate Target: ${candidateTarget})`,
          'default',
          candidateTarget,
          activeCandidateRunKey,
          onChangeCandidateTarget,
          onChangeCandidateRun,
          mode === 'launcher' ? 'Condition A' : 'Side A'
        )}

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onSwapSides}
          aria-label="Swap Side A and Side B"
          title="Swap Side A (Candidate) and Side B (Baseline)"
        >
          <ArrowLeftRight className="!size-3" />
        </Button>

        {onCompareWithPrevRun && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onCompareWithPrevRun}
            aria-label="Compare Side A vs Previous Run"
            title={`Set Side B to Previous Run on ${candidateTarget}`}
          >
            <History className="!size-3.5 text-amber-500" />
          </Button>
        )}

        {renderSelectorPair(
          'B',
          `Condition B (Baseline Target: ${baselineTarget})`,
          'secondary',
          baselineTarget,
          activeBaselineRunKey,
          onChangeBaselineTarget,
          onChangeBaselineRun,
          mode === 'launcher' ? 'Condition B' : 'Side B'
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {mode === 'launcher' ? (
          <>
            {onOpenDiff && (
              <Button
                variant="outline"
                size="xs"
                onClick={onOpenDiff}
                title={`Open comparative diff viewer (${candidateTarget} vs ${baselineTarget})`}
              >
                <GitCompare className="!size-3 text-sky-500" />
                Diff ({totalDiffsCount})
              </Button>
            )}
            <Button
              size="xs"
              onClick={onRunBothAndCompare}
              disabled={isComparingBoth}
              title={`Execute AWS Synthetics Canary on both ${candidateTarget} and ${baselineTarget} and compare`}
            >
              <Play className="fill-current !size-2.5" />
              {isComparingBoth ? 'Running…' : 'Run & Compare'}
            </Button>
          </>
        ) : (
          <>
            {onChangeIgnoreAcceptedDiffs && (
              <label
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer mr-1"
                title="When enabled, accepted Header, Cookie, and Visual rules are suppressed from diff counts"
              >
                <Switch
                  checked={ignoreAcceptedDiffs}
                  onCheckedChange={onChangeIgnoreAcceptedDiffs}
                />
                <span>Ignore Accepted</span>
              </label>
            )}

            {onExportReport && (
              <Button
                variant="outline"
                size="icon-xs"
                onClick={onExportReport}
                aria-label="Export Markdown Report"
                title="Copy Markdown release-gate comparative report to clipboard"
              >
                <FileText className="!size-3.5" />
              </Button>
            )}

            <Button
              size="xs"
              data-testid="toolbar-rerun-btn"
              onClick={onRunBothAndCompare}
              disabled={isComparingBoth}
              title={`Re-execute AWS Synthetics Canary on ${candidateTarget} and ${baselineTarget}`}
            >
              {isComparingBoth ? (
                <Loader2 className="!size-3 animate-spin" />
              ) : (
                <Play className="fill-current !size-2.5" />
              )}
              {isComparingBoth ? 'Running…' : 'Rerun'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 0. CONTROL CENTER LOGIN SCREEN (CONFIG-DRIVEN)
// ============================================================================
export const LoginView: React.FC<{
  config?: TemplateConfig;
  onSignIn: (user: { email: string; role: string; account: string }) => void;
}> = ({ config = DEFAULT_TEMPLATE_CONFIG, onSignIn }) => {
  const [email, setEmail] = useState(config.branding.defaultOperator.email);
  const [account, setAccount] = useState(
    config.branding.defaultOperator.account
  );
  const [role, setRole] = useState(config.branding.defaultOperator.role);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSignIn({ email, role, account });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-6 font-sans">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center space-y-1.5">
          <div className="w-9 h-9 rounded-lg bg-sky-500 text-zinc-950 flex items-center justify-center font-mono font-bold text-base shadow">
            {config.branding.logoMark}
          </div>
          <h1 className="text-base font-semibold tracking-tight">
            {config.branding.controlPlaneTitle}
          </h1>
          <p className="text-xs text-muted-foreground">
            {config.branding.productSubtitle}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3 border-b border-border bg-muted/20">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="w-4 h-4 text-sky-500" />
              Enterprise Operator Sign-In
            </CardTitle>
            <CardDescription>
              Authenticate via Enterprise SSO or AWS IAM Federation.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Operator Email / SSO Identity
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs font-mono text-foreground"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Contract & Account SwitchKey
                </label>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs font-mono text-foreground"
                >
                  {config.branding.accountOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  IAM / RBAC Role
                </label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs font-mono text-foreground"
                />
              </div>

              <Button type="submit" className="w-full h-8">
                <KeyRound className="!size-3.5" />
                Sign In to Control Center
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-[11px] font-mono text-muted-foreground">
          Connected to {config.infrastructure.runnerEngine} (
          {config.infrastructure.awsRegion}) · MCP Ready
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 1. NOTIFICATION / BACKGROUND JOBS POPOVER PANEL
// ============================================================================
export const BackgroundJobsPopover: React.FC<{
  jobs: BackgroundJob[];
  onClose: () => void;
  onClearCompleted: () => void;
}> = ({ jobs, onClose, onClearCompleted }) => {
  const runningCount = jobs.filter((j) => j.status === 'running').length;

  return (
    <div
      role="dialog"
      aria-label="Background Tasks and Notifications"
      className="absolute right-4 top-11 z-50 w-96 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden"
    >
      <div className="px-3.5 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">
            AWS Synthetics Background Jobs
          </span>
          {runningCount > 0 && (
            <Badge variant="default" className="font-mono text-[10px]">
              {runningCount} running
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {jobs.some((j) => j.status === 'completed') && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Clear done
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground font-mono px-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto divide-y divide-border">
        {jobs.length === 0 ? (
          <div className="p-5 text-center text-xs text-muted-foreground">
            No active or recent AWS Synthetics jobs.
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="p-3 space-y-1 hover:bg-muted/20">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {job.status === 'running' ? (
                    <Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  )}
                  <span className="text-xs font-semibold truncate">
                    {job.title}
                  </span>
                </div>
                <Badge
                  variant={job.status === 'running' ? 'warning' : 'secondary'}
                  className="font-mono text-[10px] shrink-0"
                >
                  {job.status === 'running' ? job.progress : 'Done'}
                </Badge>
              </div>

              <div className="pl-5 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>
                  {job.target} · {job.engine}
                </span>
                <span>{job.startedAt}</span>
              </div>

              {job.status === 'completed' && job.onInspect && (
                <div className="pl-5 pt-1">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      job.onInspect?.();
                      onClose();
                    }}
                  >
                    <ExternalLink className="!size-2.5" />
                    Open Result
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 2. MCP SERVER, OPENAPI 3.1 SWAGGER UI & AWS TERRAFORM / SYNTHETICS BACKEND
// ============================================================================
export const McpAndAwsBackendView: React.FC<{
  config?: TemplateConfig;
  apps: AppConfig[];
  testSuite?: TestCaseDefinition[];
  runs: RunRecord[];
  onTriggerMcpSuite: (targetId: string) => void;
  onTriggerMcpCompare: (targetA: string, targetB: string) => void;
}> = ({
  config = DEFAULT_TEMPLATE_CONFIG,
  apps,
  testSuite = DEFAULT_TEMPLATE_CONFIG.testSuite,
  runs,
  onTriggerMcpSuite,
  onTriggerMcpCompare,
}) => {
  const effectiveConfig: TemplateConfig = {
    ...config,
    properties: apps,
    testSuite,
  };

  const [activeSubTab, setActiveSubTab] = useState<
    'swagger' | 'terraform' | 'mcp' | 'plugins_skills'
  >('swagger');
  const firstApp = apps[0]?.id || 'www';

  // --- Sub-tab 4: AI Skills, Plugins & Clone-Adapt Studio State ---
  const aiSkillBundle = generateAiAgentAdaptationBundle(effectiveConfig);
  const [selectedSkillFileId, setSelectedSkillFileId] = useState<string>(
    aiSkillBundle[0].id
  );
  const activeSkillFile =
    aiSkillBundle.find((s) => s.id === selectedSkillFileId) || aiSkillBundle[0];
  const [copiedSkillFile, setCopiedSkillFile] = useState<boolean>(false);
  const [copiedOneShotPrompt, setCopiedOneShotPrompt] = useState<boolean>(false);

  const [adaptOrgName, setAdaptOrgName] = useState<string>('GlobalFin Edge');
  const [adaptDomain, setAdaptDomain] = useState<string>(
    effectiveConfig.branding.defaultDomain
  );
  const [adaptCdnProvider, setAdaptCdnProvider] = useState<
    'Akamai Edge' | 'AWS CloudFront' | 'Fastly' | 'Cloudflare'
  >('Akamai Edge');
  const [adaptAwsRegion, setAdaptAwsRegion] = useState<string>(
    effectiveConfig.infrastructure.awsRegion
  );
  const [adaptS3Bucket, setAdaptS3Bucket] = useState<string>(
    effectiveConfig.infrastructure.s3Bucket
  );
  const [adaptPropsCsv, setAdaptPropsCsv] = useState<string>(
    apps.map((a) => a.id).join(', ')
  );
  const [adaptEnvsCsv, setAdaptEnvsCsv] = useState<string>('prod, uat');

  const [enabledPluginIds, setEnabledPluginIds] = useState<string[]>(() =>
    BUILTIN_GATE_PLUGINS.filter((p) => p.enabledByDefault).map((p) => p.id)
  );
  const [selectedPluginScenario, setSelectedPluginScenario] = useState<
    'T02_CACHE_DRIFT' | 'T03_VISUAL_MINOR' | 'T05_COOKIE_DRIFT' | 'T01_CLEAN'
  >('T02_CACHE_DRIFT');
  const [zeroTokenDecision, setZeroTokenDecision] =
    useState<ZeroTokenEvaluationDecision | null>(() =>
      defaultZeroTokenEngine.evaluate({
        testId: 'T01',
        url: 'https://www.salesforce.com/',
        pixelDiffPercent: 0.0,
      })
    );
  const zeroTokenSnap = defaultZeroTokenEngine.getTelemetrySnapshot();

  const handleRunZeroTokenTest = (
    testId: string,
    url: string,
    pixelDiffPercent: number,
    forceBypassCache = false
  ) => {
    const dec = defaultZeroTokenEngine.evaluate({
      testId,
      url,
      pixelDiffPercent,
      forceBypassCache,
    });
    setZeroTokenDecision({ ...dec });
    fetch('/api/v1/zero-token/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId,
        url,
        pixelDiffPercent,
        forceBypassCache,
      }),
    }).catch(() => undefined);
  };

  const togglePluginId = (pluginId: string) => {
    setEnabledPluginIds((prev) =>
      prev.includes(pluginId)
        ? prev.filter((id) => id !== pluginId)
        : [...prev, pluginId]
    );
  };

  const scenarioInputMap = {
    T02_CACHE_DRIFT: {
      testId: 'T02',
      testName: 'Product Catalog Page (Cacheability Drift)',
      path: '/products/cloud-security',
      candidateTarget: `${firstApp}.prod.staging`,
      baselineTarget: `${firstApp}.prod.prod`,
      candidateStatus: 200,
      baselineStatus: 200,
      candidateLatencyMs: 118,
      baselineLatencyMs: 64,
      candidateHeaders: {
        'x-check-cacheable': 'NO',
        'cache-control': 'max-age=1800',
      },
      baselineHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      candidateCookies: { geo_region: 'US-EAST' },
      baselineCookies: { geo_region: 'US-EAST' },
      pixelDiffPercent: 0.02,
      enabledPluginIds,
    },
    T03_VISUAL_MINOR: {
      testId: 'T03',
      testName: 'Hero Carousel Banner (Nova Lite Minor Jitter)',
      path: '/campaigns/hero-spotlight',
      candidateTarget: `${firstApp}.prod.staging`,
      baselineTarget: `${firstApp}.prod.prod`,
      candidateStatus: 200,
      baselineStatus: 200,
      candidateLatencyMs: 92,
      baselineLatencyMs: 74,
      candidateHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      baselineHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      candidateCookies: { geo_region: 'US-EAST' },
      baselineCookies: { geo_region: 'US-EAST' },
      pixelDiffPercent: 1.8,
      enabledPluginIds,
    },
    T05_COOKIE_DRIFT: {
      testId: 'T05',
      testName: 'Edge Auth Session Handshake (Cookie Drift)',
      path: '/auth/session-init',
      candidateTarget: `${firstApp}.prod.staging`,
      baselineTarget: `${firstApp}.prod.prod`,
      candidateStatus: 200,
      baselineStatus: 200,
      candidateLatencyMs: 215,
      baselineLatencyMs: 70,
      candidateHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      baselineHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      candidateCookies: {
        geo_region: 'US-EAST',
        ak_bmsc: 'stg-token-9981',
      },
      baselineCookies: {
        geo_region: 'US-EAST',
        ak_bmsc: 'prd-token-4410',
      },
      pixelDiffPercent: 0.0,
      enabledPluginIds,
    },
    T01_CLEAN: {
      testId: 'T01',
      testName: 'Global Landing Page (100% Parity)',
      path: '/',
      candidateTarget: `${firstApp}.prod.staging`,
      baselineTarget: `${firstApp}.prod.prod`,
      candidateStatus: 200,
      baselineStatus: 200,
      candidateLatencyMs: 68,
      baselineLatencyMs: 62,
      candidateHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=1800',
      },
      baselineHeaders: {
        'x-check-cacheable': 'YES',
        'cache-control': 'max-age=3600',
      },
      candidateCookies: { geo_region: 'US-EAST' },
      baselineCookies: { geo_region: 'US-EAST' },
      pixelDiffPercent: 0.0,
      enabledPluginIds,
    },
  };

  const livePluginReport = evaluatePluginPipeline(
    scenarioInputMap[selectedPluginScenario],
    effectiveConfig
  );

  const generatedOneShotPrompt = generateOneShotAdaptationPrompt({
    organizationName: adaptOrgName,
    primaryDomain: adaptDomain,
    cdnProvider: adaptCdnProvider,
    stagingEdgeSuffix: effectiveConfig.networks.staging.edgeSuffix,
    stagingEdgeIp: effectiveConfig.networks.staging.defaultEdgeIp,
    prodEdgeSuffix: effectiveConfig.networks.prod.edgeSuffix,
    prodEdgeIp: effectiveConfig.networks.prod.defaultEdgeIp,
    awsRegion: adaptAwsRegion,
    s3Bucket: adaptS3Bucket,
    propertiesCsv: adaptPropsCsv,
    environmentsCsv: adaptEnvsCsv,
  });

  // --- Sub-tab 1: OpenAPI 3.1 / Swagger UI Interactive Explorer State ---
  const endpoints = getOpenApiEndpointCatalog(effectiveConfig);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(endpoints[0].id);
  const activeEndpoint =
    endpoints.find((e) => e.id === selectedEndpointId) || endpoints[0];

  const formatQueryRecord = (q?: Record<string, string>) =>
    q ? new URLSearchParams(q).toString() : '';

  const buildPreviewResponse = (ep: typeof activeEndpoint) => ({
    status: 'READY_TO_EXECUTE',
    endpoint: `${ep.method} ${ep.path}`,
    tag: ep.tag,
    summary: ep.summary,
    bedrockJudgeModel: effectiveConfig.infrastructure.visualJudgeModel,
    awsRegion: effectiveConfig.infrastructure.awsRegion,
    note: 'Click "Execute (Try it out)" to send a live HTTP request to server.ts.',
  });

  const [customRequestBody, setCustomRequestBody] = useState<string>(() =>
    activeEndpoint.sampleBody
      ? JSON.stringify(activeEndpoint.sampleBody, null, 2)
      : ''
  );
  const [customQueryString, setCustomQueryString] = useState<string>(() =>
    formatQueryRecord(activeEndpoint.sampleQuery)
  );
  const [swaggerResponse, setSwaggerResponse] = useState<{
    status: number;
    latencyMs: number;
    url: string;
    body: string;
  }>(() => ({
    status: 200,
    latencyMs: 12,
    url: activeEndpoint.path,
    body: JSON.stringify(buildPreviewResponse(activeEndpoint), null, 2),
  }));
  const [isExecutingSwagger, setIsExecutingSwagger] = useState<boolean>(false);
  const [showRawOpenApiSpec, setShowRawOpenApiSpec] = useState<boolean>(false);
  const [copiedOpenApi, setCopiedOpenApi] = useState<boolean>(false);

  const handleSelectEndpoint = (epId: string) => {
    setSelectedEndpointId(epId);
    const found = endpoints.find((e) => e.id === epId) || endpoints[0];
    const qStr = formatQueryRecord(found.sampleQuery);
    setCustomQueryString(qStr);
    setCustomRequestBody(
      found.sampleBody ? JSON.stringify(found.sampleBody, null, 2) : ''
    );
    setSwaggerResponse({
      status: 200,
      latencyMs: 14,
      url: found.path + (qStr ? `?${qStr}` : ''),
      body: JSON.stringify(buildPreviewResponse(found), null, 2),
    });
  };

  const handleExecuteSwaggerRequest = async () => {
    setIsExecutingSwagger(true);
    const started = performance.now();
    const querySuffix =
      activeEndpoint.method === 'GET' && customQueryString.trim()
        ? `?${customQueryString.trim().replace(/^\?/, '')}`
        : '';
    const requestUrl = `${activeEndpoint.path}${querySuffix}`;

    try {
      const fetchInit: RequestInit = {
        method: activeEndpoint.method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (activeEndpoint.method === 'POST' && customRequestBody.trim()) {
        fetchInit.body = customRequestBody;
      }

      const res = await fetch(requestUrl, fetchInit);
      const elapsed = Math.max(4, Math.round(performance.now() - started));
      const json = await res.json();
      setSwaggerResponse({
        status: res.status,
        latencyMs: elapsed,
        url: requestUrl,
        body: JSON.stringify(json, null, 2),
      });

      // Also sync portal state if user triggered a suite or comparison from Swagger UI
      if (activeEndpoint.id === 'post-trigger-run') {
        try {
          const parsed = JSON.parse(customRequestBody || '{}');
          if (parsed.targetId) onTriggerMcpSuite(parsed.targetId);
        } catch {
          // ignore
        }
      }
    } catch {
      const elapsed = Math.max(5, Math.round(performance.now() - started));
      setSwaggerResponse({
        status: 200,
        latencyMs: elapsed,
        url: requestUrl,
        body: JSON.stringify(buildPreviewResponse(activeEndpoint), null, 2),
      });
    } finally {
      setIsExecutingSwagger(false);
    }
  };

  // --- Sub-tab 2: Terraform IaC & AWS Synthetics / Bedrock Nova Lite Files ---
  const tfBundle = generateTerraformBundle(effectiveConfig);
  const lambdaBundle = generateAdhocLambdaScripts(effectiveConfig);
  const canaryScript = generateSyntheticsCanaryScript(effectiveConfig);
  const bedrockJudgeScript = generateBedrockNovaJudgeScript(effectiveConfig);
  const envFileContent = generateEnvConfigFile(effectiveConfig);

  const iacFiles = [
    {
      id: 'main.tf',
      label: 'infra/terraform/main.tf',
      badge: 'Terraform HCL ($0/idle)',
      description:
        'Provisions Scale-to-Zero AWS Lambda Control Plane + Ad-Hoc Edge Runner, API Gateway v2, Run-Once Canaries (rate(0 minutes)), S3, SSM, DynamoDB On-Demand, and Bedrock Nova Lite IAM.',
      content: tfBundle.mainTf,
    },
    {
      id: 'variables.tf',
      label: 'infra/terraform/variables.tf',
      badge: 'Terraform Vars',
      description:
        'Input variables for Scale-to-Zero Lambda (arm64 Graviton2), Run-Once Canaries (start_canaries_on_apply=false), S3, DynamoDB, Bedrock Nova Lite (amazon.nova-lite-v1:0), and properties.',
      content: tfBundle.variablesTf,
    },
    {
      id: 'terraform.tfvars',
      label: 'infra/terraform/terraform.tfvars',
      badge: 'Live Topology Vars',
      description:
        'Auto-generated tfvars synced with your current Portal Properties, Staging/Prod Edge Networks, Scale-to-Zero Lambda settings, and AWS Nova Lite judge configuration.',
      content: tfBundle.tfvars,
    },
    {
      id: 'outputs.tf',
      label: 'infra/terraform/outputs.tf',
      badge: 'Terraform Outputs',
      description:
        'Outputs Control Plane Lambda Function URL, API Gateway v2 HTTP API endpoint, Ad-Hoc Edge Runner Lambda name, S3 bucket, DynamoDB table, and SSM Parameter paths.',
      content: tfBundle.outputsTf,
    },
    {
      id: 'control-plane-handler.js',
      label: 'aws-lambda/control-plane-handler.js',
      badge: 'Lambda Control Plane',
      description:
        'Scale-to-Zero ($0/idle) AWS Lambda handler (nodejs20.x / arm64 Graviton2) serving the REST API (/api/v1/*), OpenAPI 3.1 spec, and MCP JSON-RPC 2.0 server.',
      content: lambdaBundle.controlPlaneHandlerJs,
    },
    {
      id: 'adhoc-edge-runner.js',
      label: 'aws-lambda/adhoc-edge-runner.js',
      badge: 'Lambda Edge Runner',
      description:
        'Scale-to-Zero ($0/idle) on-demand AWS Lambda runner that probes Akamai Staging vs Prod edge IPs with TLS SNI pinning and Pragma headers, writing to S3 and DynamoDB.',
      content: lambdaBundle.adhocEdgeRunnerJs,
    },
    {
      id: 'canary-har-runner.js',
      label: 'aws-synthetics/canary-har-runner.js',
      badge: 'Run-Once Canary',
      description:
        'Run-Once (rate(0 minutes)) CloudWatch Synthetics Puppeteer handler using --host-resolver-rules to capture full 1440x900 DOM screenshots only when triggered on demand.',
      content: canaryScript,
    },
    {
      id: 'bedrock-nova-lite-judge.ts',
      label: 'aws-synthetics/bedrock-nova-lite-judge.ts',
      badge: 'Bedrock Nova Lite',
      description:
        'Cost-gated Multimodal AI Visual Regression Judge invoking Amazon Bedrock Nova Lite (amazon.nova-lite-v1:0) via ConverseCommand only when pixel diff > 0.1%.',
      content: bedrockJudgeScript,
    },
    {
      id: '.env.production',
      label: '.env.example / .env.production',
      badge: 'Env & Networks',
      description:
        'Environment configuration for Staging & Prod Akamai edge networks, Scale-to-Zero AWS Lambda, S3/DynamoDB, Amazon Bedrock Nova Lite, and OpenAPI/MCP server endpoints.',
      content: envFileContent,
    },
    {
      id: 'deploy-aws.sh',
      label: 'scripts/deploy-aws.sh',
      badge: 'Deploy Script',
      description:
        'One-command deployment script running terraform init, terraform validate, and terraform apply to provision the $0/idle Scale-to-Zero AWS Lambda stack.',
      content: tfBundle.deployScript,
    },
    {
      id: 'ARCHITECTURE.md',
      label: 'ARCHITECTURE.md',
      badge: 'System Design',
      description:
        'Complete system design & architecture documentation covering Scale-to-Zero AWS Lambda, Run-Once CloudWatch Synthetics, 3-dimension diff rules, and Bedrock Nova Lite.',
      content: generateArchitectureMarkdown(effectiveConfig),
    },
  ];
  const [selectedIacFileId, setSelectedIacFileId] = useState<string>('main.tf');
  const [copiedIacFile, setCopiedIacFile] = useState<boolean>(false);
  const activeIacFile =
    iacFiles.find((f) => f.id === selectedIacFileId) || iacFiles[0];

  // --- Sub-tab 3: MCP Server Tool Inspector State ---
  const [selectedTool, setSelectedTool] = useState<string>(
    'evaluate_visual_diff_nova_lite'
  );
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);

  const [toolOutput, setToolOutput] = useState<string>(() =>
    JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 1,
        result: evaluateNovaLiteVisualDiff(
          {
            testId: 'T03',
            candidateTarget: `${firstApp}.prod.staging`,
            baselineTarget: `${firstApp}.prod.prod`,
            pixelDiffPercent: 1.8,
          },
          effectiveConfig
        ),
      },
      null,
      2
    )
  );

  const mcpTools = [
    {
      name: 'evaluate_visual_diff_nova_lite',
      description:
        'Invoke AWS Bedrock Nova Lite (amazon.nova-lite-v1:0) Vision Judge on S3-captured DOM screenshots.',
      samplePayload: {
        testId: 'T03',
        model: effectiveConfig.infrastructure.visualJudgeModel,
        provider: effectiveConfig.infrastructure.visualJudgeProvider,
        candidateTarget: `${firstApp}.prod.staging`,
        baselineTarget: `${firstApp}.prod.prod`,
        pixelDiffPercent: 1.8,
        s3CandidateUri: `s3://${effectiveConfig.infrastructure.s3Bucket}/runs/${firstApp}.prod.staging/T03.png`,
        s3BaselineUri: `s3://${effectiveConfig.infrastructure.s3Bucket}/runs/${firstApp}.prod.prod/T03.png`,
      },
    },
    {
      name: 'compare_akamai_runs',
      description:
        'Compare Functional Headers, Set-Cookie values, and AWS Nova Lite Visual DOM snapshots across any two runs.',
      samplePayload: {
        candidateTarget: `${firstApp}.prod.staging`,
        baselineTarget: `${firstApp}.prod.prod`,
        dimensions: ['headers', 'cookies', 'image_ai'],
        judgeModel: effectiveConfig.infrastructure.visualJudgeModel,
      },
    },
    {
      name: 'run_aws_synthetics_suite',
      description:
        'Dispatch an AWS CloudWatch Synthetics canary run against a Staging or Prod edge endpoint.',
      samplePayload: {
        target: `${firstApp}.prod.staging`,
        edgeResolve: `${firstApp}.${effectiveConfig.branding.defaultDomain}${effectiveConfig.networks.staging.edgeSuffix}`,
        edgeIp: effectiveConfig.networks.staging.defaultEdgeIp,
        pragmaHeaders: effectiveConfig.infrastructure.pragmaHeaders.slice(0, 2),
      },
    },
    {
      name: 'list_akamai_properties',
      description:
        'List all configured properties, environments (prod, uat), and staging/prod network targets.',
      samplePayload: { filter: 'all' },
    },
    {
      name: 'list_ai_skills_and_plugins',
      description:
        'Discover all repository AI Agent Skills (/skills/*/SKILL.md, CLAUDE.md, AGENTS.md) and Release Gate Evaluator Plugins.',
      samplePayload: { includeContent: false },
    },
    {
      name: 'run_gate_plugin_pipeline',
      description:
        'Execute the modular Release Gate Plugin Pipeline (Cache Physics, Security Headers, Cookies, Latency Budget, Bedrock Nova Lite).',
      samplePayload: {
        testId: 'T02',
        candidateTarget: `${firstApp}.prod.staging`,
        baselineTarget: `${firstApp}.prod.prod`,
        enabledPluginIds,
      },
    },
  ];

  const activeToolObj =
    mcpTools.find((t) => t.name === selectedTool) || mcpTools[0];

  const handleExecuteMcpTool = async () => {
    if (selectedTool === 'run_aws_synthetics_suite') {
      onTriggerMcpSuite(`${firstApp}.prod.staging`);
    } else if (selectedTool === 'compare_akamai_runs') {
      onTriggerMcpCompare(`${firstApp}.prod.staging`, `${firstApp}.prod.prod`);
    }

    try {
      const res = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: selectedTool,
            arguments: activeToolObj.samplePayload,
          },
        }),
      });
      const data = await res.json();
      setToolOutput(JSON.stringify(data, null, 2));
    } catch {
      setToolOutput(
        JSON.stringify(
          {
            jsonrpc: '2.0',
            id: Date.now(),
            result: evaluateNovaLiteVisualDiff(
              {
                testId: 'T03',
                candidateTarget: `${firstApp}.prod.staging`,
                baselineTarget: `${firstApp}.prod.prod`,
                pixelDiffPercent: 1.8,
              },
              effectiveConfig
            ),
          },
          null,
          2
        )
      );
    }
  };

  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        'akamai-aws-synthetics': {
          command: 'pnpm',
          args: ['dlx', effectiveConfig.infrastructure.mcpNpmPackage],
          env: {
            AWS_REGION: effectiveConfig.infrastructure.awsRegion,
            SYNTHETICS_S3_BUCKET: effectiveConfig.infrastructure.s3Bucket,
            DYNAMODB_RUNS_TABLE: effectiveConfig.infrastructure.dynamodbTable,
            BEDROCK_MODEL_ID: effectiveConfig.infrastructure.visualJudgeModel,
            AKAMAI_STAGING_EDGE_IP: effectiveConfig.networks.staging.defaultEdgeIp,
            AKAMAI_PROD_EDGE_IP: effectiveConfig.networks.prod.defaultEdgeIp,
          },
        },
      },
    },
    null,
    2
  );

  const openApiSpecJson = JSON.stringify(
    buildOpenApiSpec(effectiveConfig),
    null,
    2
  );

  return (
    <main className="px-4 py-3 space-y-3 w-full">
      {/* Top Architecture Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
        <Card>
          <CardHeader className="py-2 px-3.5 pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-500" />
                Ad-Hoc AWS Lambda ($0/Idle)
              </CardTitle>
              <Badge variant="success" className="font-mono text-[9px] px-1 py-0">
                Scale-to-Zero · {effectiveConfig.infrastructure.awsRegion}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-3.5 pb-2.5 space-y-0.5 text-xs">
            <div className="font-mono text-foreground font-semibold truncate">
              Graviton2 arm64 Lambda + Run-Once Canary
            </div>
            <p className="text-muted-foreground text-[11px]">
              Staging <code className="font-mono">{effectiveConfig.networks.staging.defaultEdgeIp}</code>{' '}
              ↔ Prod <code className="font-mono">{effectiveConfig.networks.prod.defaultEdgeIp}</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3.5 pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                AI Visual Judge (AWS)
              </CardTitle>
              <Badge variant="warning" className="font-mono text-[9px] px-1 py-0">
                Bedrock Nova Lite
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-3.5 pb-2.5 space-y-0.5 text-xs">
            <div className="font-mono text-foreground font-semibold truncate">
              {effectiveConfig.infrastructure.visualJudgeModel}
            </div>
            <p className="text-muted-foreground text-[11px]">
              Multimodal DOM diff judge via Bedrock <code className="font-mono">ConverseCommand</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3.5 pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-500" />
                S3 & DynamoDB Store
              </CardTitle>
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                {runs.length} runs
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-3.5 pb-2.5 space-y-0.5 text-xs">
            <div className="font-mono text-foreground font-semibold truncate">
              {effectiveConfig.infrastructure.s3Bucket}
            </div>
            <p className="text-muted-foreground text-[11px] truncate">
              Table: <code className="font-mono">{effectiveConfig.infrastructure.dynamodbTable}</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3.5 pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-indigo-500" />
                OpenAPI 3.1 & MCP RPC
              </CardTitle>
              <Badge variant="success" className="font-mono text-[9px] px-1 py-0">
                {endpoints.length} ROUTES LIVE
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-3.5 pb-2.5 space-y-0.5 text-xs">
            <div className="font-mono text-foreground font-semibold truncate">
              {effectiveConfig.infrastructure.openApiSpecPath}
            </div>
            <p className="text-muted-foreground text-[11px] truncate">
              MCP JSON-RPC: <code className="font-mono">/api/v1/mcp/rpc</code>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sub-navigation bar for Swagger UI, Terraform IaC, MCP Inspector, and AI Skills & Plugins */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2">
        <Tabs
          value={activeSubTab}
          onValueChange={(v) =>
            setActiveSubTab(
              v as 'swagger' | 'terraform' | 'mcp' | 'plugins_skills'
            )
          }
        >
          <TabsList className="h-8 flex-wrap">
            <TabsTrigger value="swagger" className="text-xs gap-1.5">
              <Globe className="w-3.5 h-3.5 text-emerald-500" />
              <span>OpenAPI 3.1 / Swagger UI</span>
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                {endpoints.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="terraform" className="text-xs gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-sky-500" />
              <span>Terraform IaC & AWS Synthetics</span>
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                {iacFiles.length} files
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="mcp" className="text-xs gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-500" />
              <span>MCP Server & Nova Lite Judge</span>
            </TabsTrigger>
            <TabsTrigger value="plugins_skills" className="text-xs gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>AI Skills, Plugins & Clone-Adapt</span>
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                {BUILTIN_GATE_PLUGINS.length} plugins · {aiSkillBundle.length} skills
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span>Judge Model:</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {effectiveConfig.infrastructure.visualJudgeModel}
          </Badge>
        </div>
      </div>

      {/* =====================================================================
          SUB-TAB 1: INTERACTIVE OPENAPI 3.1 / SWAGGER UI EXPLORER
         ===================================================================== */}
      {activeSubTab === 'swagger' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {/* Left: Endpoint Catalog */}
          <Card className="lg:col-span-5">
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <span>Swagger UI — Endpoint Catalog</span>
                  <Badge variant="success" className="font-mono text-[10px]">
                    OAS 3.1.0
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Select an endpoint to inspect schema and execute live requests against{' '}
                  <code className="font-mono">server.ts</code>.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowRawOpenApiSpec((prev) => !prev)}
              >
                <Code2 className="!size-3" />
                {showRawOpenApiSpec ? 'Hide OAS JSON' : 'openapi.json'}
              </Button>
            </CardHeader>

            <CardContent className="p-3 space-y-2">
              {showRawOpenApiSpec && (
                <div className="mb-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      GET {effectiveConfig.infrastructure.openApiSpecPath}
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        navigator.clipboard.writeText(openApiSpecJson);
                        setCopiedOpenApi(true);
                        setTimeout(() => setCopiedOpenApi(false), 2000);
                      }}
                    >
                      {copiedOpenApi ? (
                        <Check className="!size-3 text-emerald-500" />
                      ) : (
                        <Copy className="!size-3" />
                      )}
                      {copiedOpenApi ? 'Copied Spec' : 'Copy OAS 3.1'}
                    </Button>
                  </div>
                  <pre className="p-2.5 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[10px] overflow-x-auto max-h-56 border border-border">
                    {openApiSpecJson}
                  </pre>
                </div>
              )}

              <div className="space-y-1.5">
                {endpoints.map((ep) => {
                  const isSelected = ep.id === activeEndpoint.id;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => handleSelectEndpoint(ep.id)}
                      className={`w-full p-2.5 rounded-md border text-left transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              ep.method === 'GET'
                                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {ep.method}
                          </span>
                          <span className="font-mono text-xs font-semibold text-foreground truncate">
                            {ep.path}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1">
                          {ep.summary}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="font-mono text-[9px] shrink-0"
                      >
                        {ep.tag}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Right: Interactive "Try it out" Request & Live Response Console */}
          <Card className="lg:col-span-7">
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between space-y-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      activeEndpoint.method === 'GET'
                        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {activeEndpoint.method}
                  </span>
                  <CardTitle className="text-sm font-mono truncate">
                    {activeEndpoint.path}
                  </CardTitle>
                </div>
                <CardDescription className="mt-0.5">
                  {activeEndpoint.description}
                </CardDescription>
              </div>
              <Button
                size="xs"
                onClick={handleExecuteSwaggerRequest}
                disabled={isExecutingSwagger}
              >
                <Play className="fill-current !size-2.5" />
                {isExecutingSwagger ? 'Executing…' : 'Execute (Try it out)'}
              </Button>
            </CardHeader>

            <CardContent className="p-4 space-y-3">
              {activeEndpoint.method === 'GET' && (
                <div>
                  <label className="block text-[11px] font-mono uppercase text-muted-foreground mb-1">
                    Query Parameters (Optional)
                  </label>
                  <input
                    type="text"
                    value={customQueryString}
                    onChange={(e) => setCustomQueryString(e.target.value)}
                    placeholder="e.g. target=www.prod.staging"
                    className="w-full h-8 px-2.5 rounded-md border border-border bg-background font-mono text-xs text-foreground"
                  />
                </div>
              )}

              {activeEndpoint.method === 'POST' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono uppercase text-muted-foreground">
                      Request Body (application/json)
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      Editable JSON payload
                    </span>
                  </div>
                  <textarea
                    value={customRequestBody}
                    onChange={(e) => setCustomRequestBody(e.target.value)}
                    rows={7}
                    className="w-full p-2.5 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[11px] border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-mono uppercase text-muted-foreground">
                    Live Server Response ({swaggerResponse.url})
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        swaggerResponse.status >= 200 &&
                        swaggerResponse.status < 300
                          ? 'success'
                          : 'destructive'
                      }
                      className="font-mono text-[10px]"
                    >
                      HTTP {swaggerResponse.status}
                    </Badge>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {swaggerResponse.latencyMs}ms
                    </span>
                  </div>
                </div>
                <pre className="p-3 rounded-md bg-zinc-950 text-emerald-400 font-mono text-[11px] overflow-x-auto max-h-72 border border-border">
                  {swaggerResponse.body}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: TERRAFORM IaC & AWS SYNTHETICS / NOVA LITE CODE BUNDLE
         ===================================================================== */}
      {activeSubTab === 'terraform' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {/* Left: File Selector & AWS Deployment Checklist */}
          <Card className="lg:col-span-4">
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4">
              <CardTitle className="text-sm">
                AWS Terraform & Synthetics Bundle
              </CardTitle>
              <CardDescription>
                Dynamically synced with your {apps.length} configured properties
                and {testSuite.length} canary checks.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 space-y-2">
              <div className="space-y-1.5">
                {iacFiles.map((file) => {
                  const isSelected = file.id === activeIacFile.id;
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setSelectedIacFileId(file.id)}
                      className={`w-full p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-foreground truncate">
                          {file.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="font-mono text-[9px] shrink-0"
                        >
                          {file.badge}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                        {file.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="p-2.5 rounded-md bg-muted/30 border border-border space-y-1.5 text-[11px]">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>100% Terraform-Managed Config Matrix</span>
                  <Badge variant="success" className="font-mono text-[9px] px-1 py-0">
                    12 / 12 IaC Domains
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] font-mono text-muted-foreground">
                  <span>✓ S3 Bucket + Lifecycle</span>
                  <span>✓ S3 Suites (CSV + JSON)</span>
                  <span>✓ S3 Runtime Config JSON</span>
                  <span>✓ SSM Parameter Store (3)</span>
                  <span>✓ DynamoDB + Seeded Rules</span>
                  <span>✓ Canary ZIP + HostMaps</span>
                  <span>✓ Viewport & Timeouts</span>
                  <span>✓ Bedrock Nova Lite Config</span>
                  <span>✓ CW Logs & Pass Alarms</span>
                  <span>✓ SNS Alert Topic</span>
                  <span>✓ ECR & App Runner Env</span>
                  <span>✓ Auto .env.terraform</span>
                </div>
                <pre className="p-2 rounded bg-zinc-950 text-zinc-200 font-mono text-[10px] overflow-x-auto mt-1">
                  {`cd infra/terraform
terraform init
terraform validate
terraform apply -auto-approve`}
                </pre>
              </div>
            </CardContent>
          </Card>

          {/* Right: Active IaC / Canary Script Code Viewer */}
          <Card className="lg:col-span-8">
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between space-y-0">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-mono">
                    {activeIacFile.label}
                  </CardTitle>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {activeIacFile.badge}
                  </Badge>
                </div>
                <CardDescription className="mt-0.5">
                  {activeIacFile.description}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  navigator.clipboard.writeText(activeIacFile.content);
                  setCopiedIacFile(true);
                  setTimeout(() => setCopiedIacFile(false), 2000);
                }}
              >
                {copiedIacFile ? (
                  <Check className="text-emerald-500 !size-3" />
                ) : (
                  <Copy className="!size-3" />
                )}
                {copiedIacFile ? 'Copied File' : 'Copy File'}
              </Button>
            </CardHeader>
            <CardContent className="p-3">
              <pre className="p-3 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto max-h-[520px] border border-border leading-relaxed">
                {activeIacFile.content}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: MCP SERVER TOOL INSPECTOR & CLIENT CONFIG
         ===================================================================== */}
      {activeSubTab === 'mcp' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          <Card className="lg:col-span-7">
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">
                  MCP Server Tool Inspector (JSON-RPC 2.0)
                </CardTitle>
                <CardDescription>
                  Test MCP tool calls against <code className="font-mono">POST /api/v1/mcp/rpc</code>{' '}
                  and AWS Bedrock Nova Lite (<code className="font-mono">{effectiveConfig.infrastructure.visualJudgeModel}</code>).
                </CardDescription>
              </div>
              <Button size="xs" onClick={handleExecuteMcpTool}>
                <Play className="fill-current !size-2.5" />
                Invoke MCP Tool
              </Button>
            </CardHeader>

            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mcpTools.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => setSelectedTool(tool.name)}
                    className={`p-2 rounded-md border text-left transition-colors cursor-pointer ${
                      selectedTool === tool.name
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/40'
                    }`}
                  >
                    <div className="font-mono text-xs font-semibold text-foreground">
                      {tool.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {tool.description}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase text-muted-foreground mb-1">
                    Request Payload (params)
                  </div>
                  <pre className="p-3 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto h-48 border border-border">
                    {JSON.stringify(activeToolObj.samplePayload, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] font-mono uppercase text-muted-foreground mb-1">
                    JSON-RPC Response
                  </div>
                  <pre className="p-3 rounded-md bg-zinc-950 text-emerald-400 font-mono text-[11px] overflow-x-auto h-48 border border-border">
                    {toolOutput}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">MCP Client Configuration</CardTitle>
                <CardDescription>
                  Add to <code className="font-mono">claude_desktop_config.json</code>{' '}
                  or Cursor MCP settings.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  navigator.clipboard.writeText(mcpConfigJson);
                  setCopiedConfig(true);
                  setTimeout(() => setCopiedConfig(false), 2000);
                }}
              >
                {copiedConfig ? (
                  <Check className="text-emerald-600 dark:text-emerald-400 !size-3" />
                ) : (
                  <Copy className="!size-3" />
                )}
                {copiedConfig ? 'Copied' : 'Copy JSON'}
              </Button>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <pre className="p-3 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto border border-border">
                {mcpConfigJson}
              </pre>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <strong className="text-foreground">Supported Transports:</strong>{' '}
                  HTTP JSON-RPC (<code className="font-mono">/api/v1/mcp/rpc</code>) & SSE (<code className="font-mono">/api/mcp/sse</code>)
                </p>
                <p>
                  <strong className="text-foreground">Bedrock Model ARN:</strong>{' '}
                  <code className="font-mono">{effectiveConfig.infrastructure.bedrockModelArn}</code>
                </p>
                <p>
                  <strong className="text-foreground">IAM Role:</strong>{' '}
                  <code className="font-mono">{effectiveConfig.infrastructure.iamRoleArn}</code>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 4: AI SKILLS, PLUGINS & ONE-SHOT CLONE-ADAPT STUDIO
         ===================================================================== */}
      {activeSubTab === 'plugins_skills' && (
        <div className="space-y-3">
          {/* Top Row: One-Shot AI Clone & Adapt Prompt Generator + Included SKILL.md Explorer */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
            {/* Left 6 cols: Interactive "Clone & Adapt with AI" Prompt Generator */}
            <Card className="lg:col-span-6">
              <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>One-Shot AI "Clone & Adapt" Prompt Builder</span>
                  </CardTitle>
                  <CardDescription>
                    Configure your target organization below and copy the generated prompt into Claude Code, Cursor, Copilot, or Gemini CLI right after <code className="font-mono">git clone</code>.
                  </CardDescription>
                </div>
                <Button
                  size="xs"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedOneShotPrompt);
                    setCopiedOneShotPrompt(true);
                    setTimeout(() => setCopiedOneShotPrompt(false), 2000);
                  }}
                >
                  {copiedOneShotPrompt ? (
                    <Check className="!size-3" />
                  ) : (
                    <Copy className="!size-3" />
                  )}
                  {copiedOneShotPrompt ? 'Copied AI Prompt' : 'Copy AI Prompt'}
                </Button>
              </CardHeader>

              <CardContent className="p-3.5 space-y-3">
                {/* 1-Click Industry Presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-muted-foreground mr-1">
                    Presets:
                  </span>
                  {[
                    {
                      label: 'Global Bank',
                      org: 'GlobalBank Edge',
                      domain: 'edge.globalbank.com',
                      cdn: 'Akamai Edge' as const,
                      region: 'us-east-1',
                      bucket: 'globalbank-synthetics-artifacts-prod',
                      props: 'ibanking, payments, wealth, fx-api',
                      envs: 'prod, uat, dr',
                    },
                    {
                      label: 'Retail Commerce',
                      org: 'OmniRetail CDN',
                      domain: 'shop.omniretail.io',
                      cdn: 'Akamai Edge' as const,
                      region: 'eu-west-1',
                      bucket: 'omniretail-release-gate-eu',
                      props: 'storefront, checkout, cart-api, catalog',
                      envs: 'prod, staging-eu, qa',
                    },
                    {
                      label: 'CloudFront SaaS',
                      org: 'CloudPulse SaaS',
                      domain: 'app.cloudpulse.dev',
                      cdn: 'AWS CloudFront' as const,
                      region: 'us-west-2',
                      bucket: 'cloudpulse-synthetics-usw2',
                      props: 'dashboard, auth-sso, graphql, billing',
                      envs: 'prod, preprod',
                    },
                  ].map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setAdaptOrgName(preset.org);
                        setAdaptDomain(preset.domain);
                        setAdaptCdnProvider(preset.cdn);
                        setAdaptAwsRegion(preset.region);
                        setAdaptS3Bucket(preset.bucket);
                        setAdaptPropsCsv(preset.props);
                        setAdaptEnvsCsv(preset.envs);
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>

                {/* Form Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      Organization Title
                    </label>
                    <input
                      type="text"
                      value={adaptOrgName}
                      onChange={(e) => setAdaptOrgName(e.target.value)}
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      Primary Domain
                    </label>
                    <input
                      type="text"
                      value={adaptDomain}
                      onChange={(e) => setAdaptDomain(e.target.value)}
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      CDN Edge Provider
                    </label>
                    <select
                      value={adaptCdnProvider}
                      onChange={(e) =>
                        setAdaptCdnProvider(
                          e.target.value as
                            | 'Akamai Edge'
                            | 'AWS CloudFront'
                            | 'Fastly'
                            | 'Cloudflare'
                        )
                      }
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    >
                      <option value="Akamai Edge">Akamai Edge</option>
                      <option value="AWS CloudFront">AWS CloudFront</option>
                      <option value="Fastly">Fastly</option>
                      <option value="Cloudflare">Cloudflare</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      AWS Region
                    </label>
                    <input
                      type="text"
                      value={adaptAwsRegion}
                      onChange={(e) => setAdaptAwsRegion(e.target.value)}
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      S3 Artifact Bucket
                    </label>
                    <input
                      type="text"
                      value={adaptS3Bucket}
                      onChange={(e) => setAdaptS3Bucket(e.target.value)}
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      Properties (comma-separated IDs)
                    </label>
                    <input
                      type="text"
                      value={adaptPropsCsv}
                      onChange={(e) => setAdaptPropsCsv(e.target.value)}
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-muted-foreground block mb-1">
                      Environments
                    </label>
                    <input
                      type="text"
                      value={adaptEnvsCsv}
                      onChange={(e) => setAdaptEnvsCsv(e.target.value)}
                      className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-mono uppercase text-muted-foreground mb-1">
                    Generated One-Shot AI Agent Prompt (Paste into Claude Code / Cursor / Copilot)
                  </div>
                  <pre className="p-3 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto max-h-60 border border-border leading-relaxed whitespace-pre-wrap">
                    {generatedOneShotPrompt}
                  </pre>
                </div>
              </CardContent>
            </Card>

            {/* Right 6 cols: Repository AI Context Files & Modular SKILL.md Explorer */}
            <Card className="lg:col-span-6">
              <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-sky-500" />
                    <span>Repository AI Skills & Agent Playbooks on Disk</span>
                  </CardTitle>
                  <CardDescription>
                    Built-in <code className="font-mono">CLAUDE.md</code>, <code className="font-mono">AGENTS.md</code>, <code className="font-mono">.cursorrules</code>, and <code className="font-mono">/skills/*/SKILL.md</code> files so AI coding agents understand the repo immediately.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    navigator.clipboard.writeText(activeSkillFile.content);
                    setCopiedSkillFile(true);
                    setTimeout(() => setCopiedSkillFile(false), 2000);
                  }}
                >
                  {copiedSkillFile ? (
                    <Check className="text-emerald-500 !size-3" />
                  ) : (
                    <Copy className="!size-3" />
                  )}
                  {copiedSkillFile ? 'Copied File' : `Copy ${activeSkillFile.filename}`}
                </Button>
              </CardHeader>

              <CardContent className="p-3.5 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {aiSkillBundle.map((skill) => {
                    const isSelected = skill.id === activeSkillFile.id;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => setSelectedSkillFileId(skill.id)}
                        className={`px-2.5 py-1.5 rounded-md border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-semibold text-foreground">
                            {skill.filename}
                          </span>
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] px-1 py-0"
                          >
                            {skill.badge}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded border border-border flex items-center justify-between gap-2">
                  <span>{activeSkillFile.description}</span>
                  <Badge variant="secondary" className="font-mono text-[10px] shrink-0">
                    {activeSkillFile.category}
                  </Badge>
                </div>

                <pre className="p-3 rounded-md bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto max-h-64 border border-border leading-relaxed whitespace-pre-wrap">
                  {activeSkillFile.content}
                </pre>
              </CardContent>
            </Card>
          </div>

          {/* Middle Row: 3-Tier Zero-Token AI Dedup Funnel & Autonomous .env Cycle */}
          <Card className="border-sky-500/30">
            <CardHeader className="border-b border-border bg-sky-500/5 py-2.5 px-4 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-500" />
                  <span>
                    3-Tier Zero-Token AI Architecture & SHA-256 Diff Dedup Cache (
                    <code className="font-mono text-xs">
                      src/engine/zeroTokenArchitecture.ts
                    </code>
                    )
                  </span>
                  <Badge variant="success" className="font-mono text-[10px]">
                    Zero-Token Savings: {zeroTokenSnap.zeroTokenHitRatePercent}% ({zeroTokenSnap.totalTokensSaved} tokens saved)
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Invokes Amazon Bedrock Nova Lite (<code className="font-mono">amazon.nova-lite-v1:0</code>) <strong>only</strong> on genuinely novel unseen visual/structural diff signatures. Routine <code className="font-mono">.env</code> credential rotation, Terraform provisioning, 8-property fleet seeding, and known diffs run at <strong>0 tokens ($0.00)</strong>.
                </CardDescription>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    handleRunZeroTokenTest('T01', 'https://www.salesforce.com/', 0.0)
                  }
                >
                  Tier 1: 0.0% Delta (0 Tokens)
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    handleRunZeroTokenTest(
                      'T03',
                      'https://www.salesforce.com/ai/',
                      2.4,
                      false
                    )
                  }
                >
                  Evaluate T03 2.4% Diff (1st=AI, 2nd=0-Token Cache Hit)
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    defaultZeroTokenEngine.clearCache();
                    handleRunZeroTokenTest(
                      'T03',
                      'https://www.salesforce.com/ai/',
                      2.4,
                      true
                    );
                  }}
                >
                  Simulate Brand-New Unseen Diff (Tier 3 AI)
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-3.5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-lg border border-border bg-muted/15 space-y-1">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">
                    Tier 1 · Deterministic Cost-Gate (&le;0.1%)
                  </div>
                  <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {zeroTokenSnap.tier1DeterministicSkips} skips · 0 Tokens
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Identical DOM snapshots &amp; header/cookie parity rules skip AI completely.
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-border bg-muted/15 space-y-1">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">
                    Tier 2 · SHA-256 Diff Cache (__AI_VERDICT_CACHE__)
                  </div>
                  <div className="text-sm font-bold font-mono text-sky-600 dark:text-sky-400">
                    {zeroTokenSnap.tier2FingerprintCacheHits} hits · 0 Tokens
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {zeroTokenSnap.cachedSignaturesCount} verified SHA-256 diff signature(s) cached for instant 0-token reuse.
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-border bg-muted/15 space-y-1">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">
                    Tier 3 · Novel Unseen Delta Only (Nova Lite)
                  </div>
                  <div className="text-sm font-bold font-mono text-amber-600 dark:text-amber-400">
                    {zeroTokenSnap.tier3NovelAiInvocations} novel call(s)
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    AI invoked strictly once per unique unseen visual regression signature.
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-border bg-muted/15 space-y-1">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">
                    Autonomous .env Lifecycle Reconciler
                  </div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    {zeroTokenSnap.activeEnvFingerprint}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    Run: <code>pnpm run zero-token-cycle</code> (0 Agent Tokens)
                  </div>
                </div>
              </div>

              {zeroTokenDecision && (
                <div className="p-2.5 rounded-md border border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={
                        zeroTokenDecision.aiInvoked ? 'warning' : 'success'
                      }
                      className="font-mono text-[10px]"
                    >
                      {zeroTokenDecision.tier}
                    </Badge>
                    <span className="font-semibold text-foreground">
                      [{zeroTokenDecision.fingerprint}]
                    </span>
                    <span className="text-muted-foreground">
                      {zeroTokenDecision.summary}
                    </span>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Tokens Consumed: {zeroTokenDecision.tokensConsumed} · Saved: {zeroTokenDecision.tokensSaved}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bottom Row: Pluggable Release Gate Engine & Live Plugin Sandbox */}
          <Card>
            <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>
                    Modular Release Gate Plugin Pipeline (
                    <code className="font-mono text-xs">
                      src/engine/pluginRegistry.ts
                    </code>
                    )
                  </span>
                  <Badge
                    variant={
                      livePluginReport.overallPipelineVerdict === 'GO'
                        ? 'success'
                        : livePluginReport.overallPipelineVerdict === 'REVIEW'
                        ? 'warning'
                        : 'destructive'
                    }
                    className="font-mono text-[10px]"
                  >
                    Pipeline Verdict: {livePluginReport.overallPipelineVerdict}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Toggle release gate plugins on/off and test them against live edge comparison scenarios. Extend with custom rules by following <code className="font-mono">skills/create-gate-plugin/SKILL.md</code>.
                </CardDescription>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-mono text-muted-foreground">
                  Test Scenario:
                </span>
                {(
                  [
                    {
                      id: 'T02_CACHE_DRIFT',
                      label: 'T02: Cacheability Drift (NO-GO)',
                    },
                    {
                      id: 'T03_VISUAL_MINOR',
                      label: 'T03: Nova Lite Minor Diff (REVIEW)',
                    },
                    {
                      id: 'T05_COOKIE_DRIFT',
                      label: 'T05: Cookie & Latency Drift',
                    },
                    {
                      id: 'T01_CLEAN',
                      label: 'T01: 100% Edge Parity (GO)',
                    },
                  ] as const
                ).map((scen) => (
                  <Button
                    key={scen.id}
                    variant={
                      selectedPluginScenario === scen.id ? 'default' : 'outline'
                    }
                    size="xs"
                    onClick={() => setSelectedPluginScenario(scen.id)}
                  >
                    {scen.label}
                  </Button>
                ))}
              </div>
            </CardHeader>

            <CardContent className="p-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {BUILTIN_GATE_PLUGINS.map((plugin) => {
                  const isEnabled = enabledPluginIds.includes(plugin.id);
                  const evalResult = livePluginReport.results.find(
                    (r) => r.pluginId === plugin.id
                  );

                  return (
                    <div
                      key={plugin.id}
                      className={`p-3 rounded-lg border transition-colors flex flex-col justify-between gap-2 ${
                        isEnabled
                          ? 'border-border bg-card'
                          : 'border-border/50 bg-muted/20 opacity-65'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                              <span>{plugin.name}</span>
                              <Badge
                                variant="outline"
                                className="font-mono text-[9px] px-1 py-0"
                              >
                                v{plugin.version}
                              </Badge>
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                              Hook: <code>{plugin.hookPoint}</code> ·{' '}
                              {plugin.blockingOnFailure
                                ? 'Blocking (NO-GO)'
                                : 'Advisory (REVIEW)'}
                            </div>
                          </div>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={() => togglePluginId(plugin.id)}
                            aria-label={`Toggle ${plugin.name}`}
                          />
                        </div>

                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {plugin.description}
                        </p>
                      </div>

                      {isEnabled && evalResult ? (
                        <div className="pt-2 border-t border-border/70 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <Badge
                              variant={
                                evalResult.verdict === 'PASS'
                                  ? 'success'
                                  : evalResult.verdict === 'WARN'
                                  ? 'warning'
                                  : 'destructive'
                              }
                              className="font-mono text-[9px]"
                            >
                              {evalResult.verdict}
                            </Badge>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {evalResult.executionTimeMs}ms
                            </span>
                          </div>
                          <div className="text-[11px] font-medium text-foreground">
                            {evalResult.summary}
                          </div>
                          <ul className="text-[10px] font-mono text-muted-foreground space-y-0.5 list-disc pl-3.5">
                            {evalResult.findings.map((f, idx) => (
                              <li key={idx}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-border/50 text-[10px] font-mono text-muted-foreground">
                          Plugin disabled in pipeline
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
};

// ============================================================================
// 3. SETTINGS & LIVE TEMPLATE CONFIGURATION BUILDER
// ============================================================================
export const SettingsView: React.FC<{
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  apps: AppConfig[];
  testSuite: TestCaseDefinition[];
  onAddProperty: (id: string, name: string, envList: string[]) => void;
  onAddTestCase: (tc: TestCaseDefinition) => void;
  acceptedRules: AcceptedRule[];
  onRemoveRule: (id: string) => void;
  onAddRule: (field: string) => void;
  acceptedCookies: string[];
  onToggleAcceptCookie: (cookieName: string) => void;
  acceptedVisualTests: string[];
  onToggleAcceptVisual: (testId: string) => void;
  ignoreAcceptedDiffs: boolean;
  onChangeIgnoreAcceptedDiffs: (val: boolean) => void;
  dataSourceMode?: 'template-seed' | 'remote-api';
  onChangeDataSourceMode?: (mode: 'template-seed' | 'remote-api') => void;
  remoteApiBaseUrl?: string;
  onChangeRemoteApiBaseUrl?: (url: string) => void;
  onToggleScalePreset?: () => void;
  onResetPortalState?: () => void;
}> = ({
  theme,
  onToggleTheme,
  apps,
  testSuite,
  onAddProperty,
  onAddTestCase,
  acceptedRules,
  onRemoveRule,
  onAddRule,
  acceptedCookies,
  onToggleAcceptCookie,
  acceptedVisualTests,
  onToggleAcceptVisual,
  ignoreAcceptedDiffs,
  onChangeIgnoreAcceptedDiffs,
  dataSourceMode = 'template-seed',
  onChangeDataSourceMode,
  remoteApiBaseUrl = '/api/synthetics',
  onChangeRemoteApiBaseUrl,
  onToggleScalePreset,
  onResetPortalState,
}) => {
  const [awsRegion, setAwsRegion] = useState(
    DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion
  );
  const [s3Bucket, setS3Bucket] = useState(
    DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket
  );
  const [injectPragma, setInjectPragma] = useState(true);
  const [autoAiJudge, setAutoAiJudge] = useState(true);
  const [newRuleField, setNewRuleField] = useState('');

  // Live Template Property Builder state
  const [newAppId, setNewAppId] = useState('');
  const [newAppName, setNewAppName] = useState('');
  const [newAppEnvs, setNewAppEnvs] = useState('prod, uat');

  // Live Template Test Suite Builder state
  const [newTestName, setNewTestName] = useState('');
  const [newTestPath, setNewTestPath] = useState('/api/health');
  const [newTestStatus, setNewTestStatus] = useState('200');
  const [copiedTemplateJson, setCopiedTemplateJson] = useState(false);

  const handleCopyTemplateConfig = () => {
    const exportedConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      properties: apps,
      testSuite,
    };
    navigator.clipboard.writeText(JSON.stringify(exportedConfig, null, 2));
    setCopiedTemplateJson(true);
    setTimeout(() => setCopiedTemplateJson(false), 2000);
  };

  return (
    <main className="px-4 py-3 space-y-3 w-full">
      {/* Row 1: Template Adaptation Builder (Add Properties & Test Cases Live or Export Config) */}
      <Card>
        <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
              <Code2 className="w-4 h-4 text-sky-500" />
              <span>
                Template Adaptation & Live Topology Builder (
                <code className="font-mono text-xs">
                  src/config/template.config.ts
                </code>
                )
              </span>
              <Badge
                variant="success"
                className="font-mono text-[10px]"
                title="All changes, accepted rules, and triggered runs are automatically persisted in browser storage across reloads"
              >
                State Auto-Persisted
              </Badge>
            </CardTitle>
            <CardDescription>
              Adapt this template to your organization by adding Properties, Environments, or Canary Check URLs below, or edit{' '}
              <code className="font-mono">src/config/template.config.ts</code> and{' '}
              <code className="font-mono">src/adapters/syntheticsAdapter.ts</code>.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {onToggleScalePreset && (
              <Button
                variant="outline"
                size="xs"
                onClick={onToggleScalePreset}
                title="Toggle between 8 default properties and 50 enterprise properties to test high-scale UI/UX"
              >
                <Layers className="!size-3 text-amber-500" />
                {apps.length >= 50
                  ? 'Restore 8 Default Properties'
                  : 'Simulate 50 Properties'}
              </Button>
            )}
            <Button variant="outline" size="xs" onClick={handleCopyTemplateConfig}>
              {copiedTemplateJson ? (
                <Check className="text-emerald-600 dark:text-emerald-400 !size-3" />
              ) : (
                <Copy className="!size-3" />
              )}
              {copiedTemplateJson
                ? 'Copied Config JSON'
                : 'Export template.config.json'}
            </Button>
            {onResetPortalState && (
              <Button
                variant="outline"
                size="xs"
                onClick={onResetPortalState}
                title="Clear browser storage and reset properties, runs, and accepted rules back to clean template defaults"
              >
                <RotateCw className="!size-3 text-rose-500" />
                Reset Portal State
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          {/* 1. Add Property Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cleanId = newAppId
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '');
              if (!cleanId || !newAppName.trim()) return;
              const envList = newAppEnvs
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
              onAddProperty(
                cleanId,
                newAppName.trim(),
                envList.length > 0 ? envList : ['prod']
              );
              setNewAppId('');
              setNewAppName('');
            }}
            className="p-3 rounded-md border border-border bg-muted/10 space-y-2.5 flex flex-col justify-between"
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  1. Register New Property & Envs
                </span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {apps.length} properties
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="ID (e.g. billing)"
                  value={newAppId}
                  onChange={(e) => setNewAppId(e.target.value)}
                  className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                />
                <input
                  type="text"
                  placeholder="Name (e.g. Billing Hub)"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="h-7 rounded border border-input bg-background px-2 text-xs"
                />
                <input
                  type="text"
                  placeholder="Envs (prod, uat)"
                  value={newAppEnvs}
                  onChange={(e) => setNewAppEnvs(e.target.value)}
                  className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[180px]">
                {apps.slice(0, 4).map((a) => a.id).join(', ')}
                {apps.length > 4 ? ` +${apps.length - 4} more` : ''}
              </span>
              <Button type="submit" size="xs">
                <Plus className="!size-3" />
                Add Property
              </Button>
            </div>
          </form>

          {/* 2. Add Canary Check URL Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTestName.trim() || !newTestPath.trim()) return;
              const nextNum = testSuite.length + 1;
              const nextId = `T${String(nextNum).padStart(2, '0')}`;
              const cleanPath = newTestPath.trim().startsWith('/')
                ? newTestPath.trim()
                : `/${newTestPath.trim()}`;
              onAddTestCase({
                id: nextId,
                name: newTestName.trim(),
                path: cleanPath,
                expectedStatus: newTestStatus,
                category: 'Edge Cache',
                visualGate: 'standard',
                enabled: true,
              });
              setNewTestName('');
              setNewTestPath('/api/health');
            }}
            className="p-3 rounded-md border border-border bg-muted/10 space-y-2.5 flex flex-col justify-between"
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  2. Add Canary Journey Check URL
                </span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {testSuite.length} checks
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Check Name (e.g. Cart API)"
                  value={newTestName}
                  onChange={(e) => setNewTestName(e.target.value)}
                  className="h-7 rounded border border-input bg-background px-2 text-xs"
                />
                <input
                  type="text"
                  placeholder="/path (e.g. /cart)"
                  value={newTestPath}
                  onChange={(e) => setNewTestPath(e.target.value)}
                  className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                />
                <select
                  value={newTestStatus}
                  onChange={(e) => setNewTestStatus(e.target.value)}
                  className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="200">HTTP 200</option>
                  <option value="301">HTTP 301</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[180px]">
                {testSuite.map((t) => t.id).join(', ')}
              </span>
              <Button type="submit" size="xs">
                <Plus className="!size-3" />
                Add Check
              </Button>
            </div>
          </form>

          {/* 3. Pluggable Execution Adapter Config */}
          <div className="p-3 rounded-md border border-border bg-muted/10 space-y-2 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  3. Pluggable Synthetics Adapter
                </span>
                <Badge
                  variant={dataSourceMode === 'remote-api' ? 'warning' : 'success'}
                  className="font-mono text-[10px]"
                >
                  {dataSourceMode === 'remote-api' ? 'Remote API' : 'Template Seed'}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  aria-label="Data Source Adapter Mode"
                  value={dataSourceMode}
                  onChange={(e) =>
                    onChangeDataSourceMode?.(
                      e.target.value as 'template-seed' | 'remote-api'
                    )
                  }
                  className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="template-seed">
                    Mode: Local Template Seed
                  </option>
                  <option value="remote-api">
                    Mode: Remote AWS / MCP API
                  </option>
                </select>
                <input
                  type="text"
                  aria-label="Remote API Base URL"
                  value={remoteApiBaseUrl}
                  onChange={(e) => onChangeRemoteApiBaseUrl?.(e.target.value)}
                  placeholder="/api/synthetics"
                  className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border font-mono text-[10px] text-muted-foreground">
              <span>Adapter: src/adapters/syntheticsAdapter.ts</span>
              <span className="text-sky-600 dark:text-sky-400">
                {DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Row 2: Appearance/Runner Policy + Accepted Diff Baselines */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4">
            <CardTitle className="text-sm">
              Appearance, AWS Synthetics & Diff Evaluation Policy
            </CardTitle>
            <CardDescription>
              Interface theme, headless Chromium canary parameters, and baseline diff filtering.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3.5 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <div className="font-semibold text-foreground">
                  Control Center Color Theme
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Switch between sober Light and high-contrast Dark theme.
                </div>
              </div>
              <Button variant="outline" size="xs" onClick={onToggleTheme}>
                {theme === 'dark' ? (
                  <>
                    <Sun className="!size-3 text-amber-400" />
                    Light Mode
                  </>
                ) : (
                  <>
                    <Moon className="!size-3" />
                    Dark Mode
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <div className="font-semibold text-foreground">
                  Ignore Accepted Diffs During Comparison
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Automatically exclude accepted header, cookie, and AI visual diffs from active diff counts.
                </div>
              </div>
              <Switch
                checked={ignoreAcceptedDiffs}
                onCheckedChange={onChangeIgnoreAcceptedDiffs}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-foreground block">
                  AWS Synthetics Region
                </label>
                <select
                  value={awsRegion}
                  onChange={(e) => setAwsRegion(e.target.value)}
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                >
                  {DEFAULT_TEMPLATE_CONFIG.infrastructure.availableRegions.map(
                    (reg) => (
                      <option key={reg.id} value={reg.id}>
                        {reg.label}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground block">
                  S3 Artifact Bucket URI
                </label>
                <input
                  type="text"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <div className="font-semibold text-foreground">
                  Inject Edge Debug Pragma Headers
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Send <code className="font-mono">akamai-x-cache-on, akamai-x-check-cacheable</code>
                </div>
              </div>
              <Switch checked={injectPragma} onCheckedChange={setInjectPragma} />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div>
                <div className="font-semibold text-foreground">
                  Auto-Run AI Visual Judge on Screenshot Delta
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Invoke{' '}
                  <code className="font-mono">
                    {DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel}
                  </code>{' '}
                  when pixel diff &gt; 0.1%
                </div>
              </div>
              <Switch checked={autoAiJudge} onCheckedChange={setAutoAiJudge} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4">
            <CardTitle className="text-sm">
              Accepted Diff Baselines (Headers, Cookies & Visual AI)
            </CardTitle>
            <CardDescription>
              Manage rules that mark known header, cookie, or visual differences as expected.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newRuleField.trim()) return;
                onAddRule(newRuleField.trim().toLowerCase());
                setNewRuleField('');
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                placeholder="Add header rule (e.g. x-check-cacheable)"
                value={newRuleField}
                onChange={(e) => setNewRuleField(e.target.value)}
                className="flex-1 h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
              />
              <Button type="submit" size="sm">
                Add Rule
              </Button>
            </form>

            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="py-2">Dimension</TableHead>
                    <TableHead className="py-2">Field / Test ID</TableHead>
                    <TableHead className="text-right py-2">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-xs">
                  {acceptedRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="py-2">
                        <Badge variant="outline">Header</Badge>
                      </TableCell>
                      <TableCell className="py-2 font-semibold">{rule.kind}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onRemoveRule(rule.id)}
                        >
                          <Trash2 className="text-rose-600 dark:text-rose-400 !size-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {acceptedCookies.map((cookie) => (
                    <TableRow key={`cookie-${cookie}`}>
                      <TableCell className="py-2">
                        <Badge variant="warning">Cookie</Badge>
                      </TableCell>
                      <TableCell className="py-2 font-semibold">{cookie}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onToggleAcceptCookie(cookie)}
                        >
                          <Trash2 className="text-rose-600 dark:text-rose-400 !size-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {acceptedVisualTests.map((testId) => (
                    <TableRow key={`visual-${testId}`}>
                      <TableCell className="py-2">
                        <Badge variant="success">Visual AI</Badge>
                      </TableCell>
                      <TableCell className="py-2 font-semibold">{testId}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onToggleAcceptVisual(testId)}
                        >
                          <Trash2 className="text-rose-600 dark:text-rose-400 !size-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {acceptedRules.length === 0 &&
                    acceptedCookies.length === 0 &&
                    acceptedVisualTests.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="text-center py-4 font-sans text-muted-foreground"
                        >
                          No accepted diff rules configured.
                        </TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

// ============================================================================
// 4. ABOUT & TEMPLATE ADAPTATION GUIDE SCREEN
// ============================================================================
export const AboutView: React.FC = () => {
  return (
    <main className="px-4 py-3 space-y-3 w-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Code2 className="w-4 h-4 text-sky-500" />
              1. Single-File Template Config
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              All Properties, Environments, Edge Network suffixes, Test Suites, and AWS/MCP settings live in{' '}
              <code className="font-mono text-foreground">
                src/config/template.config.ts
              </code>.
            </p>
            <p>
              To adapt this template for any team or CDN (Akamai, CloudFront, Fastly, Cloudflare), edit{' '}
              <code className="font-mono text-foreground">
                DEFAULT_TEMPLATE_CONFIG
              </code>{' '}
              or use the live builder in <strong>Settings</strong>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-500" />
              2. 3-Dimension Comparison Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Pure, unit-tested comparison rules (<code className="font-mono text-foreground">src/engine/rules.ts</code>) evaluate every test across:
            </p>
            <ul className="list-disc pl-4 space-y-1 text-foreground">
              <li>
                <strong>Functional Headers:</strong> Status, redirects, TTL-normalized <code className="font-mono">cache-control</code>, and <code className="font-mono">x-check-cacheable</code>.
              </li>
              <li>
                <strong>Cookies:</strong> <code className="font-mono">Set-Cookie</code> session and edge routing cookies.
              </li>
              <li>
                <strong>Visual Image (AI):</strong> DOM screenshot comparison with baseline acceptance.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              3. Pluggable Execution Adapter
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              The execution layer (<code className="font-mono text-foreground">src/data/mockStore.ts</code>) is decoupled from the React UI.
            </p>
            <p>
              Swap <code className="font-mono text-foreground">generateTestResults()</code> with your real AWS CloudWatch Synthetics / Playwright / MCP endpoint without touching a single UI component.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            End-to-End Execution Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
          <div className="font-mono text-foreground bg-muted/40 p-3 rounded border border-border">
            template.config.ts  ──▶  AWS CloudWatch Synthetics (Playwright)  ──▶  Edge Network (--resolve staging/prod)  ──▶  S3 Artifact Store  ──▶  3-Dimension Diff & AI Visual Judge
          </div>
          <p>
            Every test case also generates a zero-secret <code className="font-mono text-foreground">curl --resolve</code> command so engineers can reproduce any edge header or cookie discrepancy locally from their terminal.
          </p>
        </CardContent>
      </Card>
    </main>
  );
};

// ============================================================================
// 5. AWS SYNTHETICS SUITE & RUN TELEMETRY STATS SCREEN
// ============================================================================
export interface TestSuitesViewProps {
  apps: AppConfig[];
  activeAppId: string;
  onSelectProperty: (appId: string) => void;
  runs: RunRecord[];
  testSuite: TestCaseDefinition[];
  onRunSuiteOnTarget: (targetId: string) => void;
  onRunAndCompareTargets: (targetA: string, targetB: string) => void;
  onOpenTestInDiff: (
    testId: string,
    explicitTab?: 'flow' | 'headers' | 'cookies' | 'image'
  ) => void;
  onOpenTestInSingleRun: (testId: string, targetId: string) => void;
  onOpenDiffPair: (
    targetA: string,
    targetB: string,
    runKeyA?: string,
    runKeyB?: string
  ) => void;
  liveDiffSummaryByTestId: Record<
    string,
    {
      hDiffs: number;
      cDiffs: number;
      vDiff: boolean;
      hasAny: boolean;
    }
  >;
}

export const TestSuitesView: React.FC<TestSuitesViewProps> = ({
  apps,
  activeAppId,
  onSelectProperty,
  runs,
  testSuite,
  onRunSuiteOnTarget,
  onRunAndCompareTargets,
  onOpenTestInDiff,
  onOpenTestInSingleRun,
  onOpenDiffPair,
  liveDiffSummaryByTestId,
}) => {
  const currentApp = apps.find((a) => a.id === activeAppId) || apps[0];
  const [selectedEnvFilter, setSelectedEnvFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const firstEnv = currentApp.envs[0]?.id || 'prod';
  const stagingTarget = `${currentApp.id}.${firstEnv}.staging`;
  const prodTarget = `${currentApp.id}.${firstEnv}.prod`;

  // Filter runs belonging to the selected property (and optional environment filter)
  const propertyRuns = runs.filter(
    (r) =>
      r.appId === currentApp.id &&
      (selectedEnvFilter === 'ALL' || r.envId === selectedEnvFilter)
  );

  const stagingRuns = propertyRuns.filter((r) => r.network === 'staging');
  const prodRuns = propertyRuns.filter((r) => r.network === 'prod');

  // Flatten all test executions across ingested runs
  const allExecutions = propertyRuns.flatMap((r) =>
    r.results.map((res) => ({ ...res, network: r.network, envId: r.envId, runKey: r.key }))
  );
  const stagingExecutions = stagingRuns.flatMap((r) => r.results);
  const prodExecutions = prodRuns.flatMap((r) => r.results);

  const totalRunsCount = propertyRuns.length;
  const totalExecutionsCount = allExecutions.length;
  const passedExecutionsCount = allExecutions.filter((e) => e.pass).length;
  const overallPassRate =
    totalExecutionsCount > 0
      ? ((passedExecutionsCount / totalExecutionsCount) * 100).toFixed(1)
      : '100.0';

  const calcAvgMs = (items: { durationMs: number }[]) =>
    items.length > 0
      ? Math.round(items.reduce((sum, i) => sum + i.durationMs, 0) / items.length)
      : 0;

  const calcP95Ms = (items: { durationMs: number }[]) => {
    if (items.length === 0) return 0;
    const sorted = [...items].map((i) => i.durationMs).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
  };

  const stgAvgMs = calcAvgMs(stagingExecutions);
  const prdAvgMs = calcAvgMs(prodExecutions);
  const stgP95Ms = calcP95Ms(stagingExecutions);
  const prdP95Ms = calcP95Ms(prodExecutions);
  const latencyDeltaMs = stgAvgMs - prdAvgMs;

  // Edge Cacheability & TCP_HIT stats from captured headers across runs
  const stgCacheableCount = stagingExecutions.filter(
    (e) => e.capturedHeaders?.['x-check-cacheable'] === 'YES'
  ).length;
  const prdCacheableCount = prodExecutions.filter(
    (e) => e.capturedHeaders?.['x-check-cacheable'] === 'YES'
  ).length;
  const prdHitCount = prodExecutions.filter((e) =>
    (e.capturedHeaders?.['x-cache'] || '').includes('TCP_HIT')
  ).length;

  const stgCacheablePct =
    stagingExecutions.length > 0
      ? Math.round((stgCacheableCount / stagingExecutions.length) * 100)
      : 100;
  const prdCacheablePct =
    prodExecutions.length > 0
      ? Math.round((prdCacheableCount / prodExecutions.length) * 100)
      : 100;
  const prdHitPct =
    prodExecutions.length > 0
      ? Math.round((prdHitCount / prodExecutions.length) * 100)
      : 100;

  // Per-Test-Case Aggregated Stats across all ingested AWS Synthetics runs
  const perTestStats = testSuite
    .map((tc) => {
      const testRunsAll = allExecutions.filter((e) => e.id === tc.id);
      const testRunsStg = stagingExecutions.filter((e) => e.id === tc.id);
      const testRunsPrd = prodExecutions.filter((e) => e.id === tc.id);

      const passCount = testRunsAll.filter((e) => e.pass).length;
      const avgStg = calcAvgMs(testRunsStg);
      const avgPrd = calcAvgMs(testRunsPrd);
      const minMs =
        testRunsAll.length > 0
          ? Math.min(...testRunsAll.map((e) => e.durationMs))
          : 0;
      const maxMs =
        testRunsAll.length > 0
          ? Math.max(...testRunsAll.map((e) => e.durationMs))
          : 0;

      const latestStg = testRunsStg[0];
      const latestPrd = testRunsPrd[0];

      const stgCacheable =
        latestStg?.capturedHeaders?.['x-check-cacheable'] || 'YES';
      const prdCacheable =
        latestPrd?.capturedHeaders?.['x-check-cacheable'] || 'YES';
      const stgCacheStatus = (latestStg?.capturedHeaders?.['x-cache'] || '').includes(
        'TCP_HIT'
      )
        ? 'TCP_HIT'
        : 'TCP_MISS';
      const prdCacheStatus = (latestPrd?.capturedHeaders?.['x-cache'] || '').includes(
        'TCP_HIT'
      )
        ? 'TCP_HIT'
        : 'TCP_MISS';

      const diffInfo = liveDiffSummaryByTestId[tc.id];
      const hopCount = latestStg?.redirectChain?.length || 1;
      const hopSummary = (latestStg?.redirectChain || [])
        .map((h) => `${h.method} ${h.status} (${h.durationMs}ms)`)
        .join(' -> ');

      return {
        tc,
        runsCount: testRunsAll.length,
        passCount,
        passRatePct:
          testRunsAll.length > 0
            ? Math.round((passCount / testRunsAll.length) * 100)
            : 100,
        avgStg,
        avgPrd,
        minMs,
        maxMs,
        stgCacheable,
        prdCacheable,
        stgCacheStatus,
        prdCacheStatus,
        actualStatus: latestStg?.actualStatus || Number(tc.expectedStatus),
        hopCount,
        hopSummary,
        canonicalUrl:
          latestStg?.canonicalUrl ||
          `https://${resolvePropertyHostname(currentApp.id, firstEnv)}${tc.path}`,
        diffInfo,
      };
    })
    .filter((row) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        row.tc.id.toLowerCase().includes(q) ||
        row.tc.name.toLowerCase().includes(q) ||
        row.tc.path.toLowerCase().includes(q) ||
        (row.tc.category || '').toLowerCase().includes(q)
      );
    });

  const testsWithDriftCount = Object.values(liveDiffSummaryByTestId).filter(
    (d) => d.hasAny
  ).length;
  const testsMatchedCount = Math.max(0, testSuite.length - testsWithDriftCount);

  return (
    <div className="flex flex-col w-full">
      {/* SUB-BAR: ACTIVE PROPERTY SUMMARY + ENV FILTER + AWS SYNTHETICS CANARY TRIGGERS */}
      <div className="bg-background border-b border-border px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs px-2 py-0.5">
              {currentApp.id}
            </Badge>
            <span className="text-xs font-semibold text-foreground">
              {currentApp.name}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Env Filter:
            </span>
            <button
              type="button"
              onClick={() => setSelectedEnvFilter('ALL')}
              className={`px-2 py-0.5 rounded font-mono text-[11px] cursor-pointer ${
                selectedEnvFilter === 'ALL'
                  ? 'bg-foreground text-background font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ALL ({runs.filter((r) => r.appId === currentApp.id).length} runs)
            </button>
            {currentApp.envs.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => setSelectedEnvFilter(env.id)}
                className={`px-2 py-0.5 rounded font-mono uppercase text-[11px] cursor-pointer ${
                  selectedEnvFilter === env.id
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {env.id}
              </button>
            ))}
          </div>

          <div className="hidden xl:flex items-center gap-1.5 text-xs font-mono">
            <Badge variant="outline" className="font-mono text-[10px]">
              AWS Canary: akamai-gate-{currentApp.id}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() => onRunSuiteOnTarget(stagingTarget)}
            title={`Trigger AWS Synthetics Canary on ${stagingTarget}`}
          >
            <Play className="fill-current !size-2.5 text-sky-500" />
            Run Staging
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onRunSuiteOnTarget(prodTarget)}
            title={`Trigger AWS Synthetics Canary on ${prodTarget}`}
          >
            <Play className="fill-current !size-2.5 text-emerald-500" />
            Run Prod
          </Button>
          <Button
            size="xs"
            onClick={() => onRunAndCompareTargets(stagingTarget, prodTarget)}
          >
            <GitCompare className="!size-3" />
            Run & Compare
          </Button>
        </div>
      </div>

      <main className="px-4 py-3 space-y-3 w-full">
        {/* ROW 1: 4 COMPACT ICON-FIRST TELEMETRY KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card
            title={`Staging: ${stagingRuns.length} runs (${stagingExecutions.length} tests) · Production: ${prodRuns.length} runs (${prodExecutions.length} tests)`}
          >
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Synthetics Runs
                </div>
                <div className="text-lg font-bold font-mono text-foreground">
                  {totalRunsCount} Runs · {totalExecutionsCount} Checks
                </div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  {overallPassRate}% Pass ({stagingRuns.length} STG / {prodRuns.length} PRD)
                </div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center shrink-0">
                <Server className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          <Card
            title={`P95 Latency: ${stgP95Ms}ms on Staging (.edgekey-staging.net) vs ${prdP95Ms}ms on Production (.edgekey.net)`}
          >
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Edge Latency (STG / PRD)
                </div>
                <div className="text-lg font-bold font-mono text-foreground">
                  {stgAvgMs}ms <span className="text-xs font-normal text-muted-foreground">/</span> {prdAvgMs}ms
                </div>
                <div className="text-[11px] font-mono text-muted-foreground">
                  P95: {stgP95Ms}ms / {prdP95Ms}ms ({latencyDeltaMs >= 0 ? `+${latencyDeltaMs}ms` : `${latencyDeltaMs}ms`})
                </div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          <Card
            title="Evaluated from Akamai Pragma headers: x-check-cacheable and x-cache (TCP_HIT vs TCP_MISS)"
          >
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Cacheability & Hit
                </div>
                <div className="text-lg font-bold font-mono text-foreground">
                  {stgCacheablePct}% STG · {prdCacheablePct}% PRD
                </div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  Prod Edge Hit: {prdHitPct}% (TCP_HIT)
                </div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                <Database className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          <Card
            title={`Artifact Source: ${DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket}/runs/${currentApp.id}/`}
          >
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  4-Dimension Gate Drift
                </div>
                <div className="text-lg font-bold font-mono text-foreground">
                  {testsMatchedCount} Match · {testsWithDriftCount} Drift
                </div>
                <div className="text-[11px] font-mono text-muted-foreground truncate">
                  S3: /runs/{currentApp.id}/
                </div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ROW 2: CONDENSED PER-TEST TELEMETRY WITH HTTP FLOW HOPS & HOVER TOOLTIPS */}
        <Card>
          <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">
                Canary Check & HTTP Flow Telemetry ({currentApp.id} · {perTestStats.length} Checks)
              </CardTitle>
              <span className="text-[11px] text-muted-foreground hidden md:inline">
                Click any HTTP Flow badge, cache badge, or diff icon to inspect full request-to-response trace.
              </span>
            </div>
            <div className="relative">
              <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter checks…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 pl-6 pr-2 rounded border border-input bg-background text-xs font-mono w-48"
              />
            </div>
          </CardHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 py-2">Preview</TableHead>
                <TableHead className="py-2">Canary Journey</TableHead>
                <TableHead className="w-36 py-2">HTTP Flow & Status</TableHead>
                <TableHead className="w-48 py-2">
                  Latency (STG / PRD)
                </TableHead>
                <TableHead className="w-44 py-2">
                  Edge Cache (STG / PRD)
                </TableHead>
                <TableHead className="w-36 py-2">
                  Gate Drift
                </TableHead>
                <TableHead className="text-right w-24 py-2">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perTestStats.map((row) => {
                const { tc, diffInfo } = row;
                const cacheDrift = row.stgCacheable !== row.prdCacheable;
                return (
                  <TableRow
                    key={tc.id}
                    onClick={() => onOpenTestInDiff(tc.id)}
                    className="cursor-pointer"
                  >
                    <TableCell
                      className="py-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTestInDiff(tc.id, 'image');
                      }}
                    >
                      <PageMiniThumb
                        testId={tc.id}
                        testName={tc.name}
                        url={row.canonicalUrl}
                        hasVisualDiff={diffInfo?.vDiff}
                        isRedirect={row.actualStatus === 301}
                        onClick={() => onOpenTestInDiff(tc.id, 'image')}
                      />
                    </TableCell>

                    <TableCell
                      className="py-1.5"
                      title={`${tc.id} — ${tc.name}\nURL: ${row.canonicalUrl}\nCategory: ${tc.category || 'Edge Check'}\nClick to open in Comparative Inspector`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs text-foreground">
                          {tc.id}
                        </span>
                        <span className="font-medium text-xs text-foreground truncate max-w-[220px]">
                          {tc.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 hidden sm:inline-flex"
                        >
                          {tc.category || 'Edge'}
                        </Badge>
                      </div>
                      <div className="font-mono text-[10px] text-sky-600 dark:text-sky-400 truncate max-w-[260px]">
                        {tc.path}
                      </div>
                    </TableCell>

                    <TableCell
                      className="py-1.5 font-mono text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTestInDiff(tc.id, 'flow');
                      }}
                      title={`HTTP Flow (${row.hopCount} hop(s)): ${row.hopSummary}\n${row.passCount} of ${row.runsCount} runs passed (${row.passRatePct}%) — Click to inspect full HTTP Flow waterfall`}
                    >
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge
                          variant={row.hopCount > 1 ? 'warning' : 'outline'}
                          className="font-mono text-[10px] px-1.5 py-0"
                        >
                          {row.hopCount} {row.hopCount === 1 ? 'Hop' : 'Hops'}
                        </Badge>
                        <Badge
                          variant="success"
                          className="font-mono text-[10px] px-1.5 py-0"
                        >
                          {row.actualStatus}
                        </Badge>
                      </div>
                    </TableCell>

                    <TableCell
                      className="py-1.5 font-mono text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTestInDiff(tc.id, 'flow');
                      }}
                      title={`Staging Avg: ${row.avgStg}ms · Production Avg: ${row.avgPrd}ms · Range across runs: ${row.minMs}ms – ${row.maxMs}ms — Click to inspect HTTP Flow`}
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-sky-600 dark:text-sky-400">
                          {row.avgStg}ms
                        </span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {row.avgPrd}ms
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          Δ{row.avgStg - row.avgPrd}ms
                        </span>
                      </div>
                      <div className="w-full h-1 bg-muted rounded-full overflow-hidden flex mt-1">
                        <div
                          className="bg-sky-500 h-full"
                          style={{
                            width: `${Math.min(100, Math.round((row.avgStg / 160) * 100))}%`,
                          }}
                        />
                      </div>
                    </TableCell>

                    <TableCell
                      className="py-1.5 font-mono text-[10px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTestInDiff(tc.id, 'headers');
                      }}
                      title={`Staging: ${row.stgCacheStatus} (x-check-cacheable: ${row.stgCacheable})\nProduction: ${row.prdCacheStatus} (x-check-cacheable: ${row.prdCacheable}) — Click to inspect Cache Headers`}
                    >
                      <div className="inline-flex items-center gap-1">
                        <Badge
                          variant={
                            row.stgCacheable === 'NO' ? 'destructive' : 'outline'
                          }
                          className="text-[10px] px-1.5 py-0"
                        >
                          STG:{row.stgCacheStatus.replace('TCP_', '')}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 text-emerald-600 dark:text-emerald-400"
                        >
                          PRD:{row.prdCacheStatus.replace('TCP_', '')}
                        </Badge>
                        {cacheDrift && (
                          <span
                            title="Cacheability drift between Staging and Production"
                            className="w-2 h-2 rounded-full bg-rose-500 shrink-0"
                          />
                        )}
                      </div>
                    </TableCell>

                    <TableCell
                      className="py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {diffInfo?.hasAny ? (
                        <div className="inline-flex items-center gap-1">
                          {diffInfo.hDiffs > 0 && (
                            <Badge
                              variant="destructive"
                              onClick={() => onOpenTestInDiff(tc.id, 'headers')}
                              title={`${diffInfo.hDiffs} Functional Header Diff(s) — Click to open Headers tab directly`}
                              className="text-[10px] px-1.5 py-0 gap-0.5 cursor-pointer"
                            >
                              <Code2 className="w-2.5 h-2.5" />
                              {diffInfo.hDiffs}
                            </Badge>
                          )}
                          {diffInfo.cDiffs > 0 && (
                            <Badge
                              variant="warning"
                              onClick={() => onOpenTestInDiff(tc.id, 'cookies')}
                              title={`${diffInfo.cDiffs} Cookie Diff(s) — Click to open Cookies tab directly`}
                              className="text-[10px] px-1.5 py-0 gap-0.5 cursor-pointer"
                            >
                              <KeyRound className="w-2.5 h-2.5" />
                              {diffInfo.cDiffs}
                            </Badge>
                          )}
                          {diffInfo.vDiff && (
                            <Badge
                              variant="warning"
                              onClick={() => onOpenTestInDiff(tc.id, 'image')}
                              title="AI Visual Layout Diff Detected — Click to open Image AI tab directly"
                              className="text-[10px] px-1.5 py-0 gap-0.5 cursor-pointer"
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              AI
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenTestInDiff(tc.id, 'flow')}
                          title="All dimensions matched — Click to inspect HTTP Flow"
                          className="cursor-pointer"
                        >
                          <Badge variant="success" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            OK
                          </Badge>
                        </button>
                      )}
                    </TableCell>

                    <TableCell
                      className="py-1.5 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="icon-xs"
                          onClick={() => onOpenTestInDiff(tc.id, 'flow')}
                          aria-label={`Open Flow & Diff for ${tc.id}`}
                          title={`Open HTTP Flow & Comparative Diff for ${tc.id} (${tc.name})`}
                        >
                          <GitCompare className="!size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() =>
                            onOpenTestInSingleRun(tc.id, stagingTarget)
                          }
                          aria-label={`Inspect Run for ${tc.id}`}
                          title={`Inspect Single Run Artifact & HTTP Flow for ${tc.id} on ${stagingTarget}`}
                        >
                          <Eye className="!size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        {/* ROW 3: CONDENSED AWS SYNTHETICS RUN HISTORY */}
        <Card className="overflow-hidden">
          <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">
              Ingested AWS Synthetics Run History ({currentApp.id} · {propertyRuns.length} Runs)
            </CardTitle>
            <Badge
              variant="outline"
              title={`Runner: ${DEFAULT_TEMPLATE_CONFIG.infrastructure.runnerEngine} · Bucket: ${DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket}`}
              className="font-mono text-[10px]"
            >
              {DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion}
            </Badge>
          </CardHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40 py-2">Run Label</TableHead>
                <TableHead className="w-40 py-2">Target</TableHead>
                <TableHead className="w-28 py-2">Passed</TableHead>
                <TableHead className="w-36 py-2">Latency (Avg/P95)</TableHead>
                <TableHead className="w-32 py-2">Cacheable</TableHead>
                <TableHead className="w-28 py-2">S3 Artifact</TableHead>
                <TableHead className="text-right w-28 py-2">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs font-mono">
              {propertyRuns.map((run) => {
                const avgMs = calcAvgMs(run.results);
                const p95Ms = calcP95Ms(run.results);
                const cacheableCount = run.results.filter(
                  (r) => r.capturedHeaders?.['x-check-cacheable'] === 'YES'
                ).length;
                const cacheablePct =
                  run.results.length > 0
                    ? Math.round((cacheableCount / run.results.length) * 100)
                    : 100;
                const oppositeNetwork =
                  run.network === 'staging' ? 'prod' : 'staging';
                const counterpartTarget = `${run.appId}.${run.envId}.${oppositeNetwork}`;
                const sameTargetRuns = runs.filter((r) => r.target === run.target);
                const idxInTarget = sameTargetRuns.findIndex((r) => r.key === run.key);
                const prevRunOnTarget = sameTargetRuns[idxInTarget + 1];
                const s3Uri = `${DEFAULT_TEMPLATE_CONFIG.infrastructure.s3Bucket}/runs/${run.target}/${run.key}/`;

                return (
                  <TableRow key={run.key}>
                    <TableCell className="py-1.5" title={`Run Key: ${run.key} · Started: ${run.startTime}`}>
                      <span className="font-bold text-foreground">
                        {run.label || run.key}
                      </span>
                    </TableCell>

                    <TableCell className="py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            run.network === 'staging'
                              ? 'bg-sky-500'
                              : 'bg-emerald-500'
                          }`}
                        />
                        <span>{run.target}</span>
                      </div>
                    </TableCell>

                    <TableCell className="py-1.5">
                      <Badge variant="success" className="font-mono text-[10px] px-1.5 py-0">
                        {run.passedTests}/{run.totalTests}
                      </Badge>
                    </TableCell>

                    <TableCell className="py-1.5">
                      {avgMs}ms <span className="text-muted-foreground">/ {p95Ms}ms</span>
                    </TableCell>

                    <TableCell className="py-1.5">
                      <Badge
                        variant={cacheablePct < 100 ? 'warning' : 'outline'}
                        title={`${cacheableCount} of ${run.results.length} responses returned x-check-cacheable: YES`}
                        className="font-mono text-[10px] px-1.5 py-0"
                      >
                        {cacheablePct}%
                      </Badge>
                    </TableCell>

                    <TableCell className="py-1.5 font-sans">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => navigator.clipboard.writeText(s3Uri)}
                        title={`${s3Uri}\nClick to copy S3 artifact URI`}
                        className="font-mono text-[10px] h-6 px-1.5"
                      >
                        <Database className="!size-3 text-sky-500" />
                        S3 URI
                      </Button>
                    </TableCell>

                    <TableCell className="py-1.5 text-right whitespace-nowrap font-sans">
                      <div className="inline-flex items-center justify-end gap-1">
                        {prevRunOnTarget && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              onOpenDiffPair(
                                run.target,
                                run.target,
                                run.key,
                                prevRunOnTarget.key
                              )
                            }
                            aria-label={`Compare ${run.label} vs Previous Run ${prevRunOnTarget.label}`}
                            title={`Compare ${run.label} vs Previous Run (${prevRunOnTarget.label}) on ${run.target}`}
                          >
                            <History className="!size-3.5 text-amber-500" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() =>
                            onOpenTestInSingleRun(
                              run.results[0]?.id || 'T01',
                              run.target
                            )
                          }
                          title={`Inspect Run ${run.label} (${run.target})`}
                        >
                          <Eye className="!size-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-xs"
                          onClick={() =>
                            onOpenDiffPair(
                              run.network === 'staging'
                                ? run.target
                                : counterpartTarget,
                              run.network === 'prod'
                                ? run.target
                                : counterpartTarget
                            )
                          }
                          title={`Compare ${run.target} vs ${counterpartTarget}`}
                        >
                          <GitCompare className="!size-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  );
};
