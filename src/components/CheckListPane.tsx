import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { ComparisonItem } from '../engine/types';
import { DiffDimensionFilter, FilteredDiffItemsResult } from '../engine/scalableViewEngine';
import { ActiveRunStreamState } from '../engine/runStreamEngine';
import { InspectorDimensionTab, getItemDiffCounts } from '../engine/workbenchModel';
import { getCatchpointTypeMeta } from '../engine/catchpointCatalog';
import { getScriptEngineMeta } from '../engine/scriptTemplates';

export interface CheckListPaneProps {
  filteredResult: FilteredDiffItemsResult;
  selectedTestId: string;
  onSelectTest: (testId: string, preferredTab?: InspectorDimensionTab) => void;
  dimensionFilter: DiffDimensionFilter;
  onChangeDimensionFilter: (dim: DiffDimensionFilter) => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  page: number;
  onChangePage: (p: number) => void;
  ignoreAcceptedDiffs: boolean;
  runStreamState: ActiveRunStreamState | null;
  onOpenManageTests?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const FILTER_TABS: Array<{ id: DiffDimensionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'any-diff', label: 'Diffs' },
  { id: 'headers', label: 'Headers' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'visual', label: 'Visual' },
];

export const CheckListPane: React.FC<CheckListPaneProps> = ({
  filteredResult,
  selectedTestId,
  onSelectTest,
  dimensionFilter,
  onChangeDimensionFilter,
  searchQuery,
  onChangeSearchQuery,
  page,
  onChangePage,
  ignoreAcceptedDiffs,
  runStreamState,
  onOpenManageTests,
  collapsed = false,
  onToggleCollapsed,
}) => {
  const { items, totalItems, totalPages, facetCounts } = filteredResult;

  const pickBestTabForItem = (item: ComparisonItem): InspectorDimensionTab => {
    const counts = getItemDiffCounts(item, ignoreAcceptedDiffs);
    if (dimensionFilter === 'headers' && counts.headerDiffs > 0) return 'headers';
    if (dimensionFilter === 'cookies' && counts.cookieDiffs > 0) return 'cookies';
    if (dimensionFilter === 'visual' && counts.hasVisualDiff) return 'image';
    if (counts.headerDiffs > 0) return 'headers';
    if (counts.cookieDiffs > 0) return 'cookies';
    if (counts.hasVisualDiff) return 'image';
    return 'headers';
  };

  if (collapsed) {
    return (
      <section
        aria-label="Check queue collapsed"
        className="flex flex-row lg:flex-col items-center justify-between lg:justify-start border-b border-border bg-card lg:border-b-0 lg:border-r px-2 py-2 lg:px-1.5 lg:py-2.5 gap-2"
      >
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            data-testid="btn-toggle-queue-rail"
            title="Expand check queue"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer shrink-0"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-row lg:flex-col items-center gap-1.5 overflow-x-auto lg:overflow-y-auto max-w-full">
          {items.map((item) => {
            const active = item.testId === selectedTestId;
            const counts = getItemDiffCounts(item, ignoreAcceptedDiffs);
            const hasAnyDiff =
              counts.headerDiffs > 0 || counts.cookieDiffs > 0 || counts.hasVisualDiff;
            return (
              <button
                key={item.testId}
                type="button"
                onClick={() => onSelectTest(item.testId, pickBestTabForItem(item))}
                data-testid={`check-row-${item.testId}`}
                title={`${item.testId} · ${item.testName}`}
                className={`inline-flex h-7 w-9 items-center justify-center rounded font-mono text-[11px] font-semibold transition-colors cursor-pointer shrink-0 ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : hasAnyDiff
                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item.testId}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Check queue"
      className="flex flex-col border-b border-border bg-card lg:border-b-0 lg:border-r lg:min-h-0 lg:h-full lg:overflow-hidden"
    >
      <div className="border-b border-border px-2.5 pt-2 pb-0 space-y-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              placeholder="Filter checks…"
              aria-label="Filter checks"
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onChangeSearchQuery('')}
                aria-label="Clear check filter"
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {onOpenManageTests && (
            <button
              type="button"
              onClick={onOpenManageTests}
              data-testid="btn-quick-manage-tests"
              title="Add, edit, or remove test checks"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-primary" />
              <span>Test</span>
            </button>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              data-testid="btn-toggle-queue-rail"
              title="Collapse check queue to maximize inspector"
              className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 cursor-pointer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {FILTER_TABS.map((tab) => {
            const active = dimensionFilter === tab.id;
            const count = facetCounts[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeDimensionFilter(tab.id)}
                data-testid={`filter-dim-${tab.id}`}
                className={`relative inline-flex items-center gap-1 pb-2 text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {count}
                </span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 max-h-[220px] lg:max-h-none overflow-y-auto divide-y divide-border/60">
        {items.map((item) => {
          const active = item.testId === selectedTestId;
          const counts = getItemDiffCounts(item, ignoreAcceptedDiffs);
          const streamItem = runStreamState?.active
            ? runStreamState.byTestId[item.testId]
            : undefined;
          const candStatus = item.candidateResult?.actualStatus ?? 200;
          const latency = item.candidateResult?.durationMs ?? 0;
          const statusIsErr = candStatus >= 400 || item.candidateFailed;
          const testType = item.candidateResult?.testType;
          const typeMeta = testType ? getCatchpointTypeMeta(testType) : null;
          const scriptEngine = item.candidateResult?.scriptResult?.engine;
          const scriptMeta = scriptEngine ? getScriptEngineMeta(scriptEngine) : null;
          const stepCount = item.candidateResult?.transactionStepResults?.length || 0;
          const failedAssertions = (item.candidateResult?.assertionResults || []).filter(
            (a) => !a.passed
          ).length;

          return (
            <div
              key={item.testId}
              data-testid={`check-row-${item.testId}`}
              className={`flex items-start justify-between gap-1.5 px-2.5 py-2 transition-colors ${
                active
                  ? 'bg-accent/65 ring-1 ring-inset ring-primary/25'
                  : 'hover:bg-muted/50'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectTest(item.testId, pickBestTabForItem(item))}
                className="min-w-0 flex-1 text-left cursor-pointer focus:outline-none"
              >
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`font-mono text-[11px] font-semibold shrink-0 ${
                      active ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    {item.testId}
                  </span>
                  <span className="text-xs font-medium text-foreground leading-snug line-clamp-1">
                    {item.testName}
                  </span>
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground font-mono">
                  <span
                    className={`tabular-nums ${
                      statusIsErr
                        ? 'text-rose-600 dark:text-rose-400 font-semibold'
                        : ''
                    }`}
                  >
                    {candStatus}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{latency}ms</span>
                  {typeMeta && typeMeta.type !== 'web-chrome' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-foreground/80">{typeMeta.shortLabel}</span>
                    </>
                  )}
                  {scriptMeta && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-primary font-semibold">{scriptMeta.shortBadge}</span>
                    </>
                  )}
                  {stepCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{stepCount} steps</span>
                    </>
                  )}
                  {failedAssertions > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {failedAssertions} fail
                      </span>
                    </>
                  )}
                  {streamItem && streamItem.phase !== 'completed' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-primary">{streamItem.shortBadge}</span>
                    </>
                  )}
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0 font-mono text-[11px] tabular-nums pt-0.5">
                {counts.headerDiffs === 0 &&
                counts.cookieDiffs === 0 &&
                !counts.hasVisualDiff ? (
                  <span className="text-[11px] font-sans font-medium text-emerald-700 dark:text-emerald-400 px-1">
                    Match
                  </span>
                ) : (
                  <>
                    {counts.headerDiffs > 0 && (
                      <button
                        type="button"
                        title={`${counts.headerDiffs} header differences — click to inspect`}
                        onClick={() => onSelectTest(item.testId, 'headers')}
                        data-testid={`cell-h-${item.testId}`}
                        className="cursor-pointer rounded px-1.5 py-0.5 font-semibold text-rose-700 dark:text-rose-400 hover:bg-muted"
                      >
                        Hdr {counts.headerDiffs}
                      </button>
                    )}

                    {counts.cookieDiffs > 0 && (
                      <button
                        type="button"
                        title={`${counts.cookieDiffs} cookie differences — click to inspect`}
                        onClick={() => onSelectTest(item.testId, 'cookies')}
                        data-testid={`cell-c-${item.testId}`}
                        className="cursor-pointer rounded px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400 hover:bg-muted"
                      >
                        Cki {counts.cookieDiffs}
                      </button>
                    )}

                    {counts.hasVisualDiff && (
                      <button
                        type="button"
                        title="Visual difference detected — click to inspect"
                        onClick={() => onSelectTest(item.testId, 'image')}
                        data-testid={`cell-v-${item.testId}`}
                        className="cursor-pointer rounded px-1.5 py-0.5 font-semibold text-primary hover:bg-muted"
                      >
                        Vis
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="px-4 py-8 text-center space-y-2">
            <div className="text-xs font-medium text-foreground">No checks match this filter</div>
            {(searchQuery || dimensionFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  onChangeSearchQuery('');
                  onChangeDimensionFilter('all');
                }}
                className="text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                Reset check filters
              </button>
            )}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            Page {page} of {totalPages} · {totalItems} checks
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onChangePage(page - 1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background hover:bg-muted disabled:opacity-40 cursor-pointer"
              aria-label="Previous check page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onChangePage(page + 1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background hover:bg-muted disabled:opacity-40 cursor-pointer"
              aria-label="Next check page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
