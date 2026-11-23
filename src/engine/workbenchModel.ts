import { AcceptedRule, AppConfig, ComparisonItem, OverallVerdict, RunRecord } from './types';
import { TemplateConfig, resolvePropertyHostname } from '../config/template.config';
import { buildInitialComparison, BuildComparisonOptions } from '../data/mockStore';
import { classifyPropertyRegion } from './scalableViewEngine';
import { humanizeVisualSummary, type LogicalVisualDiffInput } from './pixelDiff';

export type WorkbenchViewMode = 'synthetics' | 'workbench' | 'config' | 'studio' | 'vscode';
export type InspectorDimensionTab = 'headers' | 'cookies' | 'image' | 'flow';

export function normalizeWorkbenchViewMode(raw?: string): WorkbenchViewMode {
  if (raw === 'synthetics' || raw === 'canaries' || raw === 'fanout' || raw === 'aws' || raw === 'fleet' || raw === 'suites') {
    return 'synthetics';
  }
  if (raw === 'workbench' || raw === 'compare' || raw === 'property' || raw === 'diff' || raw === 'run' || raw === 'schedules') {
    return 'workbench';
  }
  if (raw === 'config' || raw === 'setup' || raw === 'settings' || raw === 'policies') {
    return 'config';
  }
  if (raw === 'vscode' || raw === 'ide' || raw === 'code' || raw === 'terminal') {
    return 'vscode';
  }
  if (raw === 'studio' || raw === 'mcp' || raw === 'rpc' || raw === 'protocol') {
    return 'studio';
  }
  return 'synthetics';
}

export function cleanHumanVisualSummary(
  summary?: string,
  pixelDiffOrContext: number | Partial<LogicalVisualDiffInput> = {},
  changedBox?: { x: number; y: number; w: number; h: number } | null
): string {
  const ctx: Partial<LogicalVisualDiffInput> =
    typeof pixelDiffOrContext === 'number'
      ? { pixelDiffPercent: pixelDiffOrContext, changedBox: changedBox ?? null }
      : pixelDiffOrContext;
  return humanizeVisualSummary(summary, ctx);
}

export function resolveSafeAreaLabel(
  rawArea?: string | null,
  verdict?: string
): string {
  if (rawArea && rawArea.trim() && rawArea.toLowerCase() !== 'none') {
    return rawArea.trim();
  }
  return verdict === 'same' ? 'Visual Layout Aligned' : 'Primary Viewport';
}

export interface ItemDiffCounts {
  headerDiffs: number;
  cookieDiffs: number;
  hasVisualDiff: boolean;
  rawHeaderDiffs: number;
  rawCookieDiffs: number;
  rawVisualDiff: boolean;
  hasAny: boolean;
  totalDiffs: number;
}

export function getItemDiffCounts(
  item: ComparisonItem,
  ignoreAccepted: boolean
): ItemDiffCounts {
  const rawHeaderDiffs = item.functionalDiffs.length;
  const rawCookieDiffs = (item.cookieDiffs || []).length;
  const rawVisualDiff =
    item.visualResult?.verdict === 'different' ||
    item.visualResult?.verdict === 'minor';

  const headerDiffs = ignoreAccepted
    ? item.functionalDiffs.filter((d) => !d.accepted).length
    : rawHeaderDiffs;

  const cookieDiffs = ignoreAccepted
    ? (item.cookieDiffs || []).filter((d) => !d.accepted).length
    : rawCookieDiffs;

  const hasVisualDiff = ignoreAccepted
    ? rawVisualDiff && !(item.visualResult?.acceptedRulesAppliedCount && item.visualResult.verdict === 'same')
    : rawVisualDiff;

  const effectiveVisualDiff =
    item.visualResult?.verdict === 'different' ||
    item.visualResult?.verdict === 'minor';

  const visFlag = ignoreAccepted ? effectiveVisualDiff : rawVisualDiff;

  return {
    headerDiffs,
    cookieDiffs,
    hasVisualDiff: visFlag || (ignoreAccepted ? false : hasVisualDiff),
    rawHeaderDiffs,
    rawCookieDiffs,
    rawVisualDiff,
    hasAny: headerDiffs > 0 || cookieDiffs > 0 || visFlag,
    totalDiffs: headerDiffs + cookieDiffs + (visFlag ? 1 : 0),
  };
}

export function getFirstDiffTab(
  item: ComparisonItem | undefined,
  ignoreAccepted: boolean
): InspectorDimensionTab {
  if (!item) return 'headers';
  const counts = getItemDiffCounts(item, ignoreAccepted);
  if (counts.headerDiffs > 0) return 'headers';
  if (counts.cookieDiffs > 0) return 'cookies';
  if (counts.hasVisualDiff) return 'image';
  return 'headers';
}

export interface PropertyGateSummary {
  appId: string;
  name: string;
  canonicalHost: string;
  popCode: string;
  regionCode: string;
  envId: string;
  candidateTarget: string;
  baselineTarget: string;
  verdict: OverallVerdict;
  headerDiffCount: number;
  cookieDiffCount: number;
  visualDiffCount: number;
  failCount: number;
  totalChecks: number;
  firstDiffTestId: string;
  firstDiffTab: InspectorDimensionTab;
}

export function computePropertyGateSummary(params: {
  app: AppConfig;
  runs: RunRecord[];
  rules: AcceptedRule[];
  acceptedCookies: string[];
  acceptedVisualTests: string[];
  ignoreAcceptedDiffs: boolean;
  templateConfig: TemplateConfig;
  aiJudgeOverrides?: BuildComparisonOptions['aiJudgeOverrides'];
  apps?: AppConfig[];
}): PropertyGateSummary {
  const {
    app,
    runs,
    rules,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    templateConfig,
    aiJudgeOverrides,
    apps,
  } = params;

  const envId = app.envs[0]?.id || 'prod';
  const candidateTarget = `${app.id}.${envId}.staging`;
  const baselineTarget = `${app.id}.${envId}.prod`;
  const candRun = runs.find((r) => r.target === candidateTarget);
  const baseRun = runs.find((r) => r.target === baselineTarget);
  const regionMeta = classifyPropertyRegion(app.id);
  const canonicalHost = resolvePropertyHostname(app.id, 'prod', templateConfig);

  if (!candRun || !baseRun) {
    return {
      appId: app.id,
      name: app.name,
      canonicalHost,
      popCode: regionMeta.popCode,
      regionCode: regionMeta.regionCode,
      envId,
      candidateTarget,
      baselineTarget,
      verdict: 'NONE',
      headerDiffCount: 0,
      cookieDiffCount: 0,
      visualDiffCount: 0,
      failCount: 0,
      totalChecks: 0,
      firstDiffTestId: 'T01',
      firstDiffTab: 'headers',
    };
  }

  const comparison = buildInitialComparison(candRun, baseRun, 'network', rules, {
    apps,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    aiJudgeOverrides,
  });

  let headerDiffCount = 0;
  let cookieDiffCount = 0;
  let visualDiffCount = 0;
  let firstDiffItem: ComparisonItem | undefined;

  for (const item of comparison.items) {
    const counts = getItemDiffCounts(item, ignoreAcceptedDiffs);
    headerDiffCount += counts.headerDiffs;
    cookieDiffCount += counts.cookieDiffs;
    if (counts.hasVisualDiff) visualDiffCount += 1;
    if (!firstDiffItem && counts.hasAny) {
      firstDiffItem = item;
    }
  }

  return {
    appId: app.id,
    name: app.name,
    canonicalHost,
    popCode: regionMeta.popCode,
    regionCode: regionMeta.regionCode,
    envId,
    candidateTarget,
    baselineTarget,
    verdict: comparison.headlineVerdict,
    headerDiffCount,
    cookieDiffCount,
    visualDiffCount,
    failCount: comparison.rollup.failingOnCandidate,
    totalChecks: comparison.items.length,
    firstDiffTestId: firstDiffItem?.testId || comparison.items[0]?.testId || 'T01',
    firstDiffTab: getFirstDiffTab(firstDiffItem || comparison.items[0], ignoreAcceptedDiffs),
  };
}

export function buildVerdictBreakdownText(params: {
  headerDiffs: number;
  cookieDiffs: number;
  visualDiffs: number;
  totalChecks: number;
}): string {
  const parts: string[] = [];
  if (params.headerDiffs > 0) {
    parts.push(`${params.headerDiffs} header${params.headerDiffs === 1 ? '' : 's'}`);
  }
  if (params.cookieDiffs > 0) {
    parts.push(`${params.cookieDiffs} cookie${params.cookieDiffs === 1 ? '' : 's'}`);
  }
  if (params.visualDiffs > 0) {
    parts.push(`${params.visualDiffs} visual`);
  }
  if (parts.length === 0) {
    return `All ${params.totalChecks} checks aligned`;
  }
  return parts.join(' · ');
}

export type FleetSortKey = 'appId' | 'verdict' | 'diffs' | 'region' | 'checks';
export type FleetSortDirection = 'asc' | 'desc';

const VERDICT_SEVERITY_RANK: Record<OverallVerdict, number> = {
  'NO-GO': 4,
  REVIEW: 3,
  PARTIAL: 2,
  COMPARING: 1,
  NONE: 0,
  GO: 0,
};

export function sortPropertySummaries(
  summaries: PropertyGateSummary[],
  sortKey: FleetSortKey,
  sortDir: FleetSortDirection
): PropertyGateSummary[] {
  const factor = sortDir === 'asc' ? 1 : -1;
  return [...summaries].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'appId') {
      cmp = a.appId.localeCompare(b.appId);
    } else if (sortKey === 'verdict') {
      cmp = VERDICT_SEVERITY_RANK[a.verdict] - VERDICT_SEVERITY_RANK[b.verdict];
    } else if (sortKey === 'diffs') {
      const aTotal = a.headerDiffCount + a.cookieDiffCount + a.visualDiffCount;
      const bTotal = b.headerDiffCount + b.cookieDiffCount + b.visualDiffCount;
      cmp = aTotal - bTotal;
    } else if (sortKey === 'region') {
      cmp = `${a.regionCode}:${a.popCode}`.localeCompare(`${b.regionCode}:${b.popCode}`);
    } else if (sortKey === 'checks') {
      cmp = a.totalChecks - b.totalChecks;
    }
    if (cmp === 0) {
      return a.appId.localeCompare(b.appId);
    }
    return cmp * factor;
  });
}

export interface FleetAggregateMetrics {
  total: number;
  noGo: number;
  review: number;
  go: number;
  headerDiffs: number;
  cookieDiffs: number;
  visualDiffs: number;
  totalDiffs: number;
  totalChecks: number;
}

export function computeFleetAggregateMetrics(
  summaries: PropertyGateSummary[]
): FleetAggregateMetrics {
  let noGo = 0;
  let review = 0;
  let go = 0;
  let headerDiffs = 0;
  let cookieDiffs = 0;
  let visualDiffs = 0;
  let totalChecks = 0;

  for (const s of summaries) {
    if (s.verdict === 'NO-GO') noGo += 1;
    else if (s.verdict === 'REVIEW') review += 1;
    else if (s.verdict === 'GO') go += 1;
    headerDiffs += s.headerDiffCount;
    cookieDiffs += s.cookieDiffCount;
    visualDiffs += s.visualDiffCount;
    totalChecks += s.totalChecks;
  }

  return {
    total: summaries.length,
    noGo,
    review,
    go,
    headerDiffs,
    cookieDiffs,
    visualDiffs,
    totalDiffs: headerDiffs + cookieDiffs + visualDiffs,
    totalChecks,
  };
}

function escapeCsvCell(val: string | number): string {
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportFleetGateCsv(summaries: PropertyGateSummary[]): string {
  const header = [
    'Property ID',
    'Property Name',
    'Canonical Host',
    'Region',
    'PoP',
    'Verdict',
    'Header Diffs',
    'Cookie Diffs',
    'Visual Diffs',
    'Total Checks',
    'First Blocker Check',
  ];
  const rows = summaries.map((s) =>
    [
      s.appId,
      s.name,
      s.canonicalHost,
      s.regionCode,
      s.popCode,
      s.verdict,
      s.headerDiffCount,
      s.cookieDiffCount,
      s.visualDiffCount,
      s.totalChecks,
      s.firstDiffTestId,
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

export function filterEvidenceKeys(params: {
  keys: string[];
  query: string;
  candValues?: Record<string, string | undefined>;
  baseValues?: Record<string, string | undefined>;
}): string[] {
  const q = params.query.trim().toLowerCase();
  if (!q) return params.keys;
  return params.keys.filter((k) => {
    if (k.toLowerCase().includes(q)) return true;
    const cVal = params.candValues?.[k]?.toLowerCase() || '';
    const bVal = params.baseValues?.[k]?.toLowerCase() || '';
    return cVal.includes(q) || bVal.includes(q);
  });
}

