import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Command, Loader2, Moon, Play, Search, Sun } from 'lucide-react';
import { OverallVerdict } from '../engine/types';
import { PropertyGateSummary, WorkbenchViewMode } from '../engine/workbenchModel';

export interface TopBarProps {
  viewMode: WorkbenchViewMode;
  onSelectView: (mode: WorkbenchViewMode) => void;
  onRunLiveGate: () => void;
  isRunningGate: boolean;
  runningProgressText?: string;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  activeAppId?: string;
  propertySummaries?: PropertyGateSummary[];
  onSelectProperty?: (appId: string) => void;
  propertySwitcherOpen?: boolean;
  onSetPropertySwitcherOpen?: (open: boolean) => void;
  onOpenManageProperties?: () => void;
  onOpenCommandPalette?: () => void;
}

const NAV_ITEMS: Array<{ id: WorkbenchViewMode; label: string }> = [
  { id: 'synthetics', label: 'Sites' },
  { id: 'workbench', label: 'Compare' },
  { id: 'config', label: 'Settings' },
  { id: 'studio', label: 'Developer' },
];

function verdictColor(verdict: OverallVerdict): string {
  if (verdict === 'NO-GO') return 'text-rose-700 dark:text-rose-400';
  if (verdict === 'REVIEW') return 'text-amber-700 dark:text-amber-400';
  if (verdict === 'GO') return 'text-emerald-700 dark:text-emerald-400';
  return 'text-muted-foreground';
}

export const TopBar: React.FC<TopBarProps> = ({
  viewMode,
  onSelectView,
  onRunLiveGate,
  isRunningGate,
  runningProgressText,
  theme = 'light',
  onToggleTheme,
  activeAppId,
  propertySummaries = [],
  onSelectProperty,
  propertySwitcherOpen,
  onSetPropertySwitcherOpen,
  onOpenManageProperties,
  onOpenCommandPalette,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isOpen =
    typeof propertySwitcherOpen === 'boolean' ? propertySwitcherOpen : internalOpen;

  const setOpen = (next: boolean) => {
    if (onSetPropertySwitcherOpen) onSetPropertySwitcherOpen(next);
    else setInternalOpen(next);
  };

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const t = setTimeout(() => searchInputRef.current?.focus(), 15);
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const filteredProps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return propertySummaries;
    return propertySummaries.filter(
      (p) =>
        p.appId.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.canonicalHost.toLowerCase().includes(q)
    );
  }, [propertySummaries, query]);

  const activePropSummary = propertySummaries.find((p) => p.appId === activeAppId);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="flex h-12 items-center justify-between gap-4 px-3 sm:px-5">
        {/* Zone 1: Brand & Breadcrumb Property Switcher */}
        <div className="flex items-center gap-2 shrink-0 min-w-0" ref={containerRef}>
          <button
            type="button"
            onClick={() => onSelectView('synthetics')}
            data-testid="topbar-brand-home"
            className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 cursor-pointer rounded py-1 pr-1"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="text-primary shrink-0"
            >
              <path d="M4 5H10V19H4V5Z" stroke="currentColor" strokeWidth="2.2" />
              <path d="M14 5H20V19H14V5Z" stroke="currentColor" strokeWidth="2.2" />
              <path
                d="M10 12H14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="square"
              />
            </svg>
            <span className="font-display text-sm font-bold tracking-tight text-foreground">
              Release Gate
            </span>
          </button>

          {activeAppId && onSelectProperty && (
            <div className="relative flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-sm text-border select-none" aria-hidden="true">
                /
              </span>
              <button
                type="button"
                onClick={() => setOpen(!isOpen)}
                data-testid="property-switcher-trigger"
                aria-expanded={isOpen}
                aria-label={`Active site ${activeAppId}. Click to switch site`}
                title="Switch active site (/)"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-mono font-semibold text-foreground hover:border-border hover:bg-muted/70 transition-colors cursor-pointer whitespace-nowrap"
              >
                <span className="truncate max-w-[110px] sm:max-w-[150px]">{activeAppId}</span>
                {activePropSummary && (
                  <span
                    className={`hidden xl:inline font-sans text-[11px] font-medium ${verdictColor(
                      activePropSummary.verdict
                    )}`}
                  >
                    · {activePropSummary.verdict === 'NO-GO' ? 'Blocked' : activePropSummary.verdict === 'GO' ? 'Ready' : activePropSummary.verdict}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>

              {isOpen && (
                <div
                  data-testid="property-switcher-popover"
                  className="absolute left-0 top-10 z-50 w-80 sm:w-96 rounded-md border border-border bg-popover shadow-lg overflow-hidden"
                >
                  <div className="border-b border-border p-2.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && filteredProps[0]) {
                            e.preventDefault();
                            onSelectProperty(filteredProps[0].appId);
                            setOpen(false);
                          }
                        }}
                        placeholder="Filter properties by ID, name, or host…"
                        aria-label="Search properties"
                        data-testid="property-switcher-search"
                        className="h-8 w-full rounded border border-border bg-background pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-border/50">
                    {filteredProps.map((item) => {
                      const active = item.appId === activeAppId;
                      return (
                        <button
                          key={item.appId}
                          type="button"
                          onClick={() => {
                            onSelectProperty(item.appId);
                            setOpen(false);
                          }}
                          data-testid={`switcher-prop-${item.appId}`}
                          className={`flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                            active
                              ? 'bg-accent/70 text-foreground'
                              : 'hover:bg-muted/60 text-foreground'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-mono font-semibold ${
                                  active ? 'text-primary' : 'text-foreground'
                                }`}
                              >
                                {item.appId}
                              </span>
                              {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                              <span className="text-[11px] text-muted-foreground truncate">
                                {item.canonicalHost}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {item.name}
                            </div>
                          </div>
                          <span
                            className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 ${verdictColor(
                              item.verdict
                            )}`}
                          >
                            {item.verdict}
                          </span>
                        </button>
                      );
                    })}

                    {filteredProps.length === 0 && (
                      <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                        No properties match "{query}"
                      </div>
                    )}
                  </div>

                  {onOpenManageProperties && (
                    <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                        {propertySummaries.length} properties configured
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onOpenManageProperties();
                        }}
                        className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                      >
                        Manage Properties →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Zone 2: Clean Single-Line Primary Navigation (MCP First) */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6 h-full">
          {NAV_ITEMS.map((item) => {
            const active =
              viewMode === item.id || (item.id === 'studio' && viewMode === 'vscode');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                data-testid={`nav-${item.id}`}
                className={`relative inline-flex h-full items-center text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Quick Command, Theme & Primary Gate Action */}
        <div className="flex items-center gap-2 shrink-0">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              data-testid="topbar-command-palette"
              aria-label="Open command palette"
              title="Command Palette (⌘K)"
              className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Command className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Quick Jump</span>
              <kbd className="font-mono text-[10px] text-muted-foreground/90">⌘K</kbd>
            </button>
          )}

          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              data-testid="topbar-theme-toggle"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (T)`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          )}

          <button
            type="button"
            onClick={onRunLiveGate}
            disabled={isRunningGate}
            data-testid="run-live-gate-cta"
            title="Test Staging vs Production for the active site"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 whitespace-nowrap shrink-0 transition-opacity cursor-pointer"
          >
            {isRunningGate ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3 w-3 fill-current" />
            )}
            <span>
              {isRunningGate && runningProgressText ? runningProgressText : 'Run Check'}
            </span>
          </button>
        </div>
      </div>

      {/* Compact Mobile Navigation (< 15% sticky viewport budget) */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-around overflow-x-auto border-t border-border/70 px-1 md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const active =
            viewMode === item.id || (item.id === 'studio' && viewMode === 'vscode');
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              data-testid={`mobile-nav-${item.id}`}
              className={`relative h-9 px-2 text-[11px] font-medium text-center transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                active
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1.5 bottom-0 h-0.5 bg-primary"
                />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
