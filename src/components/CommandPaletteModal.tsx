import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Command,
  Keyboard,
  Globe,
  Play,
  GitCompare,
  Sparkles,
  ArrowRight,
  Check,
  X,
  CornerDownLeft,
  Layers,
} from 'lucide-react';
import {
  CommandPaletteItem,
  filterCommandItems,
  SHORTCUT_DEFINITIONS,
} from '../engine/shortcuts';
import {
  DEFAULT_TEMPLATE_CONFIG,
  GLOBAL_EXECUTION_POPS,
  getPropertyTestSuite,
} from '../config/template.config';
import { AppConfig } from '../engine/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

// ============================================================================
// REUSABLE KEYCAP PRIMITIVE
// ============================================================================
export const Kbd: React.FC<{
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'dark-surface';
}> = ({ children, className = '', tone = 'default' }) => (
  <kbd
    className={`inline-flex items-center justify-center min-w-[1.25rem] h-[18px] px-1.5 rounded-[4px] font-mono text-[10px] font-medium leading-none select-none shrink-0 ${
      tone === 'dark-surface'
        ? 'bg-zinc-800/90 text-zinc-200 border border-zinc-700/90 shadow-[0_1px_0_0_rgba(0,0,0,0.45)]'
        : 'bg-muted/80 text-muted-foreground border border-border/90 shadow-[0_1px_0_0_rgba(15,23,42,0.08)] dark:shadow-[0_1px_0_0_rgba(0,0,0,0.35)]'
    } ${className}`}
  >
    {children}
  </kbd>
);

// ============================================================================
// SPOTLIGHT COMMAND PALETTE MODAL (Cmd/Ctrl + K)
// ============================================================================
export const CommandPaletteModal: React.FC<{
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  activeAppId: string;
  activePopLabel: string;
}> = ({ open, onClose, items, activeAppId, activePopLabel }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(
    () => filterCommandItems(items, query, 42),
    [items, query]
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(
      `[data-cmd-index="${activeIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filtered.length > 0 ? (prev + 1) % filtered.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filtered.length > 0
          ? (prev - 1 + filtered.length) % filtered.length
          : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filtered[activeIndex];
      if (chosen) {
        onClose();
        chosen.onSelect();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Group filtered results cleanly while preserving order
  const groupsOrder: CommandPaletteItem['group'][] = [
    'Actions',
    'Views',
    'Execution PoPs',
    'Properties',
    'Suite Checks',
  ];

  let runningFlatIndex = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global Command Palette"
      data-testid="command-palette-modal"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-start justify-center pt-[10vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Top Search Input Row */}
        <div className="px-3.5 py-2.5 border-b border-border flex items-center gap-2.5 bg-muted/20">
          <Search className="w-4 h-4 text-sky-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to view, property (japan, login…), PoP (NRT, FRA…), check (T01…), or action…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none font-sans"
          />
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-muted border border-border">
              {activeAppId} · {activePopLabel}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Command Palette"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Grouped Command List */}
        <div
          ref={listRef}
          className="max-h-[56vh] overflow-y-auto divide-y divide-border/60 p-1.5 space-y-1"
        >
          {filtered.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-1.5">
              <div className="text-sm font-medium text-foreground">
                No matching commands for “{query}”
              </div>
              <div className="text-xs text-muted-foreground">
                Try typing a view name (diff, suites), PoP code (NRT, FRA, LHR), property ID (japan, login), or check (T01).
              </div>
            </div>
          ) : (
            groupsOrder.map((groupName) => {
              const groupItems = filtered.filter((it) => it.group === groupName);
              if (groupItems.length === 0) return null;
              return (
                <div key={groupName} className="pt-1 pb-0.5 first:pt-0">
                  <div className="px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupName}
                  </div>
                  <div className="space-y-0.5">
                    {groupItems.map((item) => {
                      runningFlatIndex += 1;
                      const idx = runningFlatIndex;
                      const isActive = idx === activeIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-cmd-index={idx}
                          data-testid={`cmd-item-${item.id}`}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => {
                            onClose();
                            item.onSelect();
                          }}
                          className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-sky-500/12 text-foreground ring-1 ring-sky-500/35'
                              : 'hover:bg-muted/60 text-foreground'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold truncate">
                                {item.label}
                              </span>
                              {item.badge && (
                                <Badge
                                  variant={item.badgeVariant || 'outline'}
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {item.badge}
                                </Badge>
                              )}
                            </div>
                            {item.subtitle && (
                              <div className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                                {item.subtitle}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.shortcutKeys && item.shortcutKeys.length > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                {item.shortcutKeys.map((k, ki) => (
                                  <Kbd key={ki}>{k}</Kbd>
                                ))}
                              </span>
                            )}
                            {isActive && (
                              <CornerDownLeft className="w-3.5 h-3.5 text-sky-500" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Telemetry / Key Hints */}
        <div className="px-3.5 py-2 border-t border-border bg-muted/25 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground font-mono">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>Navigate</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              <span>Execute</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </span>
          </div>
          <span>
            {filtered.length} command{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// KEYBOARD SHORTCUTS REFERENCE MODAL (?)
// ============================================================================
export const ShortcutsHelpModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  if (!open) return null;

  const categories: Array<
    (typeof SHORTCUT_DEFINITIONS)[number]['category']
  > = [
    'Global & Command Palette',
    'Navigation Chords (G then Key)',
    'Diff & Run Inspector',
    'Fleet & Release Actions',
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts Reference"
      data-testid="shortcuts-help-modal"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2.5 border-b border-border bg-muted/25 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
              <Keyboard className="w-4 h-4 text-sky-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Keyboard Shortcuts & Quick Navigation
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Automatically paused while typing inside inputs, search boxes, or VS Code Monaco editor.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close Shortcuts Reference"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-3.5 max-h-[78vh] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
          {categories.map((cat) => {
            const rows = SHORTCUT_DEFINITIONS.filter((s) => s.category === cat);
            return (
              <div
                key={cat}
                className="rounded-lg border border-border bg-background/60 overflow-hidden"
              >
                <div className="px-3 py-1.5 border-b border-border bg-muted/25 text-[10px] font-mono font-semibold uppercase tracking-wider text-foreground">
                  {cat}
                </div>
                <div className="divide-y divide-border/70">
                  {rows.map((sc) => (
                    <div
                      key={sc.id}
                      className="px-3 py-1.5 flex items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground text-[11.5px]">
                          {sc.label}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground leading-snug">
                          {sc.description}
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-1 shrink-0">
                        {sc.keys.map((keyLabel, i) => (
                          <React.Fragment key={i}>
                            {sc.chordPrefix && i === 1 && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                then
                              </span>
                            )}
                            <Kbd>{keyLabel}</Kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2.5 border-t border-border bg-muted/25 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
          <span>
            Tip: Press <Kbd>⌘K</Kbd> / <Kbd>Ctrl+K</Kbd> anytime for the searchable Command Palette.
          </span>
          <Button variant="outline" size="xs" onClick={onClose}>
            Done <Kbd className="ml-1">Esc</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// RUN ANY SUITE FROM ANY POP LAUNCHER MODAL (X shortcut or Launcher CTA)
// ============================================================================
export const SuitePopLauncherModal: React.FC<{
  open: boolean;
  onClose: () => void;
  apps: AppConfig[];
  initialSuiteAppId: string;
  initialTargetAppId: string;
  initialPopId: string;
  suiteScaleCount: number;
  onLaunch: (params: {
    suiteAppId: string;
    targetAppId: string;
    envId: string;
    popId: string;
    mode: 'compare' | 'staging' | 'prod';
  }) => void;
}> = ({
  open,
  onClose,
  apps,
  initialSuiteAppId,
  initialTargetAppId,
  initialPopId,
  suiteScaleCount,
  onLaunch,
}) => {
  const [suiteAppId, setSuiteAppId] = useState(initialSuiteAppId);
  const [targetAppId, setTargetAppId] = useState(initialTargetAppId);
  const [envId, setEnvId] = useState('prod');
  const [popId, setPopId] = useState(
    initialPopId === 'auto' ? 'nrt' : initialPopId
  );
  const [mode, setMode] = useState<'compare' | 'staging' | 'prod'>('compare');

  useEffect(() => {
    if (open) {
      setSuiteAppId(initialSuiteAppId);
      setTargetAppId(initialTargetAppId);
      const selectedTargetApp = apps.find((a) => a.id === initialTargetAppId);
      setEnvId(selectedTargetApp?.envs[0]?.id || 'prod');
      setPopId(initialPopId && initialPopId !== 'auto' ? initialPopId : 'nrt');
      setMode('compare');
    }
  }, [open, initialSuiteAppId, initialTargetAppId, initialPopId, apps]);

  if (!open) return null;

  const targetApp = apps.find((a) => a.id === targetAppId) || apps[0];
  const suiteApp = apps.find((a) => a.id === suiteAppId) || apps[0];
  const selectedPop =
    GLOBAL_EXECUTION_POPS.find((p) => p.id === popId) ||
    GLOBAL_EXECUTION_POPS[0];
  const previewSuite = getPropertyTestSuite(suiteAppId, DEFAULT_TEMPLATE_CONFIG);
  const effectiveChecksCount =
    suiteScaleCount > 8 ? suiteScaleCount : previewSuite.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Run Any Suite From Any PoP"
      data-testid="suite-pop-launcher-modal"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border bg-muted/25 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
              <Globe className="w-4 h-4 text-sky-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Execute Any Suite From Any Global Edge PoP
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Mix and match any property suite with any target host and regional AWS Synthetics / Akamai Edge PoP.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close Suite @ PoP Launcher"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* Row 1: Suite + Target Host */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-sky-500" />
                1. Test Suite ({effectiveChecksCount} checks)
              </label>
              <select
                aria-label="Select Suite to Run"
                data-testid="launcher-suite-select"
                value={suiteAppId}
                onChange={(e) => setSuiteAppId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-xs font-mono text-foreground"
              >
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.id} — {app.suitePath || `config/suites/${app.id}.csv`}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-muted-foreground truncate">
                {suiteApp?.name}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-emerald-500" />
                2. Target Property & Env
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Select Target Property"
                  data-testid="launcher-target-select"
                  value={targetAppId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setTargetAppId(nextId);
                    const nextApp = apps.find((a) => a.id === nextId);
                    if (nextApp && !nextApp.envs.some((ev) => ev.id === envId)) {
                      setEnvId(nextApp.envs[0]?.id || 'prod');
                    }
                  }}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-2.5 text-xs font-mono text-foreground"
                >
                  {apps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.id} ({app.envs.map((e) => e.id).join('/')})
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Select Target Environment"
                  data-testid="launcher-env-select"
                  value={envId}
                  onChange={(e) => setEnvId(e.target.value)}
                  className="w-24 h-9 rounded-md border border-input bg-background px-2 text-xs font-mono uppercase text-foreground"
                >
                  {(targetApp?.envs || [{ id: 'prod', name: 'PROD' }]).map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-[11px] font-mono text-muted-foreground truncate">
                Target: {targetAppId}.{envId}.staging / prod
              </div>
            </div>
          </div>

          {/* Row 2: Global Execution PoP Matrix Picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono font-semibold uppercase text-muted-foreground">
                3. Origin Execution PoP (AWS Synthetics Region + Akamai Edge IP)
              </label>
              <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400 font-semibold">
                {selectedPop.stagingPopCode} ↔ {selectedPop.prodPopCode}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {GLOBAL_EXECUTION_POPS.map((pop) => {
                const isSelected = pop.id === popId;
                return (
                  <button
                    key={pop.id}
                    type="button"
                    data-testid={`launcher-pop-card-${pop.id}`}
                    onClick={() => setPopId(pop.id)}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-sky-500 bg-sky-500/12 ring-1 ring-sky-500/40'
                        : 'border-border bg-background hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-bold text-xs text-foreground">
                        {pop.popCode} · {pop.city.split(',')[0]}
                      </span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                      {pop.awsRegion} · {pop.stagingEdgeIp}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Gate Execution Mode */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono font-semibold uppercase text-muted-foreground">
              4. Execution Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  {
                    id: 'compare',
                    title: 'Staging ↔ Prod Gate',
                    desc: 'Run both networks from this PoP & open Diff',
                  },
                  {
                    id: 'staging',
                    title: 'Staging Edge Only',
                    desc: `Probe ${selectedPop.stagingPopCode} vs previous run`,
                  },
                  {
                    id: 'prod',
                    title: 'Production Edge Only',
                    desc: `Probe ${selectedPop.prodPopCode} vs previous run`,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                    mode === opt.id
                      ? 'border-foreground bg-muted/50'
                      : 'border-border bg-background hover:bg-muted/30'
                  }`}
                >
                  <div className="text-xs font-semibold text-foreground">
                    {opt.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border bg-muted/25 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
            <span>{suiteAppId}.csv</span>
            <ArrowRight className="w-3 h-3" />
            <span>{targetAppId}.{envId}</span>
            <ArrowRight className="w-3 h-3" />
            <span className="text-sky-600 dark:text-sky-400 font-semibold">
              {selectedPop.popCode} ({selectedPop.awsRegion})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              data-testid="launcher-execute-btn"
              onClick={() => {
                onLaunch({
                  suiteAppId,
                  targetAppId,
                  envId,
                  popId,
                  mode,
                });
                onClose();
              }}
            >
              {mode === 'compare' ? (
                <GitCompare className="!size-3.5" />
              ) : (
                <Play className="fill-current !size-3" />
              )}
              Run {suiteAppId} Suite @ {selectedPop.popCode}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
