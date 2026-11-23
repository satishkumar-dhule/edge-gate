import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { CommandPaletteItem, filterCommandItems } from '../engine/shortcuts';

export interface QuickPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
}

export const QuickPalette: React.FC<QuickPaletteProps> = ({
  open,
  onClose,
  items,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const filtered = useMemo(
    () => filterCommandItems(items, query, 28),
    [items, query]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-16 sm:pt-20 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl rounded-lg border border-border bg-popover shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(filtered.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter' && filtered[cursor]) {
                e.preventDefault();
                filtered[cursor].onSelect();
                onClose();
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Jump to property, check ID, PoP, view, or run action…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCursor(0);
                inputRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Close command palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
          {filtered.map((item, idx) => {
            const active = idx === cursor;
            return (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setCursor(idx)}
                onClick={() => {
                  item.onSelect();
                  onClose();
                }}
                className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs cursor-pointer transition-colors ${
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">
                    {item.label}
                  </div>
                  {item.subtitle && (
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {item.subtitle}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {item.badge || item.group}
                  </span>
                  {active && (
                    <CornerDownLeft className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              No matching commands or targets for &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3.5 py-2 font-mono text-[10px] text-muted-foreground">
          <span>↑↓ Navigate · ↵ Open · Esc Close</span>
          <span>? Keyboard Shortcuts</span>
        </div>
      </div>
    </div>
  );
};

export interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_ROWS = [
  { keys: '⌘K', label: 'Open Command Palette' },
  { keys: '/', label: 'Switch Active Property' },
  { keys: 'J / K', label: 'Next / Previous Check' },
  { keys: '1 / 2 / 3 / 4', label: 'Switch Inspector Tab (Headers / Cookies / Visual / Flow)' },
  { keys: 'R', label: 'Re-run Active Check' },
  { keys: 'C', label: 'Copy Zero-Secret cURL' },
  { keys: 'T', label: 'Toggle Light / Dark Theme' },
  { keys: 'Esc', label: 'Close Modals / Drawers' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md rounded-lg border border-border bg-popover p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="font-display text-sm font-semibold text-foreground">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Close shortcuts"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 divide-y divide-border/60 text-xs">
          {SHORTCUT_ROWS.map((row) => (
            <div
              key={row.keys}
              className="flex items-center justify-between py-2.5 gap-4"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground shrink-0">
                {row.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
