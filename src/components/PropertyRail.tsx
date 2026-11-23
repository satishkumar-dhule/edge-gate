import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { OverallVerdict } from '../engine/types';
import { PropertyGateSummary } from '../engine/workbenchModel';

export interface PropertyRailProps {
  summaries: PropertyGateSummary[];
  activeAppId: string;
  onSelectProperty: (appId: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

function verdictTextColor(verdict: OverallVerdict): string {
  if (verdict === 'NO-GO') return 'text-rose-700 dark:text-rose-400';
  if (verdict === 'REVIEW') return 'text-amber-700 dark:text-amber-400';
  if (verdict === 'GO') return 'text-emerald-700 dark:text-emerald-400';
  return 'text-muted-foreground';
}

export const PropertyRail: React.FC<PropertyRailProps> = ({
  summaries,
  activeAppId,
  onSelectProperty,
  mobileOpen,
  onCloseMobile,
  searchInputRef,
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (s) =>
        s.appId.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.canonicalHost.toLowerCase().includes(q) ||
        s.popCode.toLowerCase().includes(q) ||
        s.regionCode.toLowerCase().includes(q)
    );
  }, [summaries, query]);

  const railContent = (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Properties ({summaries.length})
        </span>
        {mobileOpen && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground lg:hidden cursor-pointer"
            aria-label="Close property rail"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="border-b border-border p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter properties…"
            aria-label="Filter properties"
            className="h-7.5 w-full rounded border border-border bg-background pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {filtered.map((item) => {
          const active = item.appId === activeAppId;
          const totalBlockers =
            item.headerDiffCount + item.cookieDiffCount + item.visualDiffCount;

          return (
            <button
              key={item.appId}
              type="button"
              onClick={() => {
                onSelectProperty(item.appId);
                onCloseMobile();
              }}
              data-testid={`rail-prop-${item.appId}`}
              className={`w-full px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-accent/70 text-foreground shadow-[inset_2px_0_0_var(--bg-primary)]'
                  : 'hover:bg-muted/50 text-foreground'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-mono text-xs font-semibold truncate ${
                    active ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {item.appId}
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 ${verdictTextColor(
                    item.verdict
                  )}`}
                >
                  {item.verdict}
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{item.canonicalHost}</span>
                <span className="font-mono tabular-nums shrink-0">
                  {totalBlockers > 0 ? `${totalBlockers}d` : item.popCode}
                </span>
              </div>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No properties match "{query}"
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-60 shrink-0 border-r border-border bg-card">
        <div className="sticky top-13 h-[calc(100vh-3.25rem)]">{railContent}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 w-72 max-w-[82vw] h-full border-r border-border bg-card shadow-xl">
            {railContent}
          </div>
        </div>
      )}
    </>
  );
};
