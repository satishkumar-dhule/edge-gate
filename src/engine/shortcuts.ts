/**
 * Pure Keyboard Shortcuts, Chord Resolution & Command Palette Fuzzy Engine.
 * Decoupled from React/DOM globals so it runs cleanly under node:test.
 */

export type ShortcutViewMode =
  | 'property'
  | 'diff'
  | 'suites'
  | 'run'
  | 'mcp'
  | 'terminal'
  | 'settings'
  | 'about';

export type ShortcutInspectorTab = 'flow' | 'headers' | 'cookies' | 'image';

export interface ShortcutTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

export interface ShortcutKeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  target?: ShortcutTargetLike | null;
}

export interface ShortcutStateContext {
  viewMode: ShortcutViewMode;
  pendingChord: 'g' | null;
  hasOpenModal: boolean;
  isAuthenticated: boolean;
}

export type ResolvedShortcutAction =
  | { type: 'noop' }
  | { type: 'escape' }
  | { type: 'toggle-command-palette' }
  | { type: 'toggle-shortcuts-help' }
  | { type: 'open-property-switcher' }
  | { type: 'open-suite-pop-launcher' }
  | { type: 'toggle-theme' }
  | { type: 'focus-search' }
  | { type: 'start-chord'; chord: 'g' }
  | { type: 'clear-chord' }
  | { type: 'navigate'; viewMode: ShortcutViewMode }
  | { type: 'step-check'; delta: -1 | 1 }
  | { type: 'switch-inspector-tab'; tab: ShortcutInspectorTab }
  | { type: 'toggle-diffs-only' }
  | { type: 'rerun-active-probe' }
  | { type: 'copy-curl' }
  | { type: 'page-step'; delta: -1 | 1 };

export interface ShortcutDefinition {
  id: string;
  keys: string[];
  chordPrefix?: 'g';
  category:
    | 'Global & Command Palette'
    | 'Navigation Chords (G then Key)'
    | 'Diff & Run Inspector'
    | 'Fleet & Release Actions';
  label: string;
  description: string;
}

export const VIEW_CHORD_MAP: Record<string, ShortcutViewMode> = {
  o: 'property',
  d: 'diff',
  s: 'suites',
  r: 'run',
  m: 'mcp',
  v: 'terminal',
  ',': 'settings',
  '?': 'about',
};

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'command-palette',
    keys: ['⌘', 'K'],
    category: 'Global & Command Palette',
    label: 'Command Palette',
    description: 'Jump to any view, property, PoP, test check, or action',
  },
  {
    id: 'shortcuts-help',
    keys: ['?'],
    category: 'Global & Command Palette',
    label: 'Keyboard Shortcuts',
    description: 'Open or close this interactive keyboard reference',
  },
  {
    id: 'focus-search',
    keys: ['/'],
    category: 'Global & Command Palette',
    label: 'Focus View Search',
    description: 'Focus the active search or filter input on the current screen',
  },
  {
    id: 'property-switcher',
    keys: ['P'],
    category: 'Global & Command Palette',
    label: 'Property Switcher',
    description: 'Open the PoP / Global Core property selector',
  },
  {
    id: 'suite-pop-launcher',
    keys: ['X'],
    category: 'Global & Command Palette',
    label: 'Run Suite @ Any PoP',
    description: 'Launch any verification suite from any global Akamai/AWS PoP',
  },
  {
    id: 'toggle-theme',
    keys: ['T'],
    category: 'Global & Command Palette',
    label: 'Toggle Theme',
    description: 'Switch between Light and Dark studio surfaces',
  },
  {
    id: 'escape',
    keys: ['Esc'],
    category: 'Global & Command Palette',
    label: 'Dismiss / Back',
    description: 'Close open modals, popovers, lightbox, or clear pending chord',
  },

  // Navigation Chords
  {
    id: 'nav-overview',
    keys: ['G', 'O'],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'Overview Matrix',
    description: 'Jump to Executive Release Readiness & Edge Topology',
  },
  {
    id: 'nav-diff',
    keys: ['G', 'D'],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'Diff Inspector',
    description: 'Open 4-dimension Side-by-Side HTTP/Header/Cookie/Visual Diff',
  },
  {
    id: 'nav-suites',
    keys: ['G', 'S'],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'Test Suites',
    description: 'View suite latency/cacheability telemetry & canary runs',
  },
  {
    id: 'nav-run',
    keys: ['G', 'R'],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'Single Run View',
    description: 'Inspect focused single-target edge telemetry & screenshots',
  },
  {
    id: 'nav-mcp',
    keys: ['G', 'M'],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'Cloud & MCP',
    description: 'Open Terraform IaC, AWS Lambda & MCP JSON-RPC controls',
  },
  {
    id: 'nav-vscode',
    keys: ['G', 'V'],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'VS Code IDE',
    description: 'Open embedded Monaco Editor & integrated Compute Shell',
  },
  {
    id: 'nav-settings',
    keys: ['G', ','],
    chordPrefix: 'g',
    category: 'Navigation Chords (G then Key)',
    label: 'Settings & Rules',
    description: 'Manage properties, suites, and accepted drift rules',
  },

  // Diff & Run Inspector
  {
    id: 'step-next',
    keys: ['J'],
    category: 'Diff & Run Inspector',
    label: 'Next Check',
    description: 'Select the next test check in the filtered list (or ↓)',
  },
  {
    id: 'step-prev',
    keys: ['K'],
    category: 'Diff & Run Inspector',
    label: 'Previous Check',
    description: 'Select the previous test check in the filtered list (or ↑)',
  },
  {
    id: 'tab-flow',
    keys: ['1'],
    category: 'Diff & Run Inspector',
    label: 'HTTP Flow Tab',
    description: 'Switch inspector dimension to multi-hop HTTP trace & waterfall',
  },
  {
    id: 'tab-headers',
    keys: ['2'],
    category: 'Diff & Run Inspector',
    label: 'Headers Tab',
    description: 'Switch inspector dimension to HTTP & Akamai Pragma headers',
  },
  {
    id: 'tab-cookies',
    keys: ['3'],
    category: 'Diff & Run Inspector',
    label: 'Cookies Tab',
    description: 'Switch inspector dimension to Set-Cookie attributes & parity',
  },
  {
    id: 'tab-image',
    keys: ['4'],
    category: 'Diff & Run Inspector',
    label: 'Image AI Tab',
    description: 'Switch inspector dimension to live DOM screenshots & Nova Lite AI',
  },
  {
    id: 'toggle-diffs-only',
    keys: ['F'],
    category: 'Diff & Run Inspector',
    label: 'Toggle Diffs Only',
    description: 'Show only mismatching headers or cookies inside Diff Inspector',
  },
  {
    id: 'rerun-probe',
    keys: ['R'],
    category: 'Fleet & Release Actions',
    label: 'Rerun Active Probe',
    description: 'Re-probe live endpoint flow & refresh screenshot in Inspector',
  },
  {
    id: 'copy-curl',
    keys: ['C'],
    category: 'Fleet & Release Actions',
    label: 'Copy Zero-Secret cURL',
    description: 'Copy reproducible curl --resolve command for active check',
  },
  {
    id: 'page-step',
    keys: ['[', ']'],
    category: 'Fleet & Release Actions',
    label: 'Prev / Next Page',
    description: 'Step through paginated check, suite, or fleet matrix pages',
  },
];

/**
 * Returns true if the keyboard event target belongs to a text input, select,
 * contentEditable node, or embedded Monaco/code editor so typing is never hijacked.
 */
export function isEditableTarget(target: ShortcutTargetLike | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (typeof target.getAttribute === 'function') {
    const editableAttr = target.getAttribute('contenteditable');
    if (editableAttr === '' || editableAttr === 'true') return true;
  }
  if (typeof target.closest === 'function') {
    if (
      target.closest('.monaco-editor') ||
      target.closest('[data-ignore-shortcuts="true"]')
    ) {
      return true;
    }
  }
  return false;
}

export function resolveKeyboardAction(
  event: ShortcutKeyEventLike,
  ctx: ShortcutStateContext
): ResolvedShortcutAction {
  if (!ctx.isAuthenticated || event.defaultPrevented) {
    return { type: 'noop' };
  }

  const key = event.key || '';
  const lower = key.toLowerCase();
  const hasMod = Boolean(event.metaKey || event.ctrlKey);

  // Escape always closes modals / clears pending chord even from search inputs
  if (key === 'Escape') {
    return { type: 'escape' };
  }

  // Cmd+K / Ctrl+K toggles Command Palette globally (unless inside Monaco find widget)
  if (hasMod && !event.altKey && lower === 'k') {
    const inMonaco =
      typeof event.target?.closest === 'function' &&
      Boolean(event.target.closest('.monaco-editor'));
    if (!inMonaco) {
      return { type: 'toggle-command-palette' };
    }
    return { type: 'noop' };
  }

  // Ignore any modifier combos (Cmd+C, Ctrl+R, Cmd+S, Alt+...) from here on
  if (hasMod || event.altKey) {
    return { type: 'noop' };
  }

  // Suppress all single-key shortcuts when focused in editable elements or VS Code Monaco
  if (isEditableTarget(event.target)) {
    return { type: 'noop' };
  }

  // When a modal is already open, don't execute background single-key actions
  if (ctx.hasOpenModal) {
    if (key === '?') {
      return { type: 'toggle-shortcuts-help' };
    }
    return { type: 'noop' };
  }

  // Handle pending 'g' navigation chord
  if (ctx.pendingChord === 'g') {
    if (key === '?') {
      return { type: 'navigate', viewMode: 'about' };
    }
    const dest = VIEW_CHORD_MAP[lower];
    if (dest) {
      return { type: 'navigate', viewMode: dest };
    }
    return { type: 'clear-chord' };
  }

  if (key === '?') {
    return { type: 'toggle-shortcuts-help' };
  }

  if (key === '/') {
    return { type: 'focus-search' };
  }

  if (lower === 'g' && !event.shiftKey) {
    return { type: 'start-chord', chord: 'g' };
  }

  if (lower === 'p' && !event.shiftKey) {
    return { type: 'open-property-switcher' };
  }

  if (lower === 'x' && !event.shiftKey) {
    return { type: 'open-suite-pop-launcher' };
  }

  if (lower === 't' && !event.shiftKey) {
    return { type: 'toggle-theme' };
  }

  // Diff Inspector & Single Run contextual shortcuts
  if (ctx.viewMode === 'diff' || ctx.viewMode === 'run') {
    if (lower === 'j' || key === 'ArrowDown') {
      return { type: 'step-check', delta: 1 };
    }
    if (lower === 'k' || key === 'ArrowUp') {
      return { type: 'step-check', delta: -1 };
    }
    if (key === '1') return { type: 'switch-inspector-tab', tab: 'flow' };
    if (key === '2') return { type: 'switch-inspector-tab', tab: 'headers' };
    if (key === '3') return { type: 'switch-inspector-tab', tab: 'cookies' };
    if (key === '4') return { type: 'switch-inspector-tab', tab: 'image' };
    if (lower === 'f' && ctx.viewMode === 'diff') {
      return { type: 'toggle-diffs-only' };
    }
    if (lower === 'r' && !event.repeat) {
      return { type: 'rerun-active-probe' };
    }
    if (lower === 'c' && !event.repeat) {
      return { type: 'copy-curl' };
    }
  }

  if (key === '[') {
    return { type: 'page-step', delta: -1 };
  }
  if (key === ']') {
    return { type: 'page-step', delta: 1 };
  }

  return { type: 'noop' };
}

export interface CommandPaletteItem {
  id: string;
  group: 'Actions' | 'Views' | 'Execution PoPs' | 'Properties' | 'Suite Checks';
  label: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'destructive' | 'outline';
  shortcutKeys?: string[];
  keywords?: string;
  onSelect: () => void;
}

export function filterCommandItems(
  items: CommandPaletteItem[],
  rawQuery: string,
  limit = 40
): CommandPaletteItem[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) {
    return items.slice(0, limit);
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: CommandPaletteItem; score: number }> = [];

  for (const item of items) {
    const labelLower = item.label.toLowerCase();
    const subLower = (item.subtitle || '').toLowerCase();
    const kwLower = (item.keywords || '').toLowerCase();
    const badgeLower = (item.badge || '').toLowerCase();
    const combined = `${labelLower} ${subLower} ${kwLower} ${badgeLower}`;

    const matchesAll = tokens.every((tok) => combined.includes(tok));
    if (!matchesAll) continue;

    let score = 0;
    if (labelLower === q || badgeLower === q) score += 100;
    else if (labelLower.startsWith(q) || badgeLower.startsWith(q)) score += 60;
    else if (labelLower.includes(q)) score += 35;
    else if (subLower.includes(q)) score += 20;
    else score += 10;

    if (item.group === 'Actions') score += 8;
    else if (item.group === 'Views') score += 6;
    else if (item.group === 'Execution PoPs') score += 5;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
