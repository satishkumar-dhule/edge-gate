import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import type * as MonacoTypes from 'monaco-editor';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  Loader2,
  Maximize2,
  Minimize2,
  PanelBottom,
  Play,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  CURATED_WORKSPACE_QUICK_FILES,
  detectMonacoLanguage,
  type WorkspaceEntry,
} from '../engine/workspacePaths';
import {
  COMPUTE_PRESET_COMMANDS,
  extractCloudFrontUrlFromOutput,
} from '../engine/computeShell';

// Configure self-hosted Vite Monaco workers (zero external CDN calls)
if (typeof window !== 'undefined') {
  const g = window as unknown as {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker;
    };
  };
  if (!g.MonacoEnvironment) {
    g.MonacoEnvironment = {
      getWorker(_moduleId: string, label: string) {
        if (label === 'json') return new jsonWorker();
        if (label === 'css' || label === 'scss' || label === 'less') {
          return new cssWorker();
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return new htmlWorker();
        }
        if (label === 'typescript' || label === 'javascript') {
          return new tsWorker();
        }
        return new editorWorker();
      },
    };
  }
  loader.config({ monaco });
}

interface OpenTab {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  sizeBytes?: number;
  loading?: boolean;
  error?: string;
}

interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

interface VsCodeWorkspaceProps {
  theme: 'light' | 'dark';
}

function getFileBadge(name: string): { label: string; colorClass: string } {
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.')) {
    return { label: 'ENV', colorClass: 'text-amber-500' };
  }
  if (lower === 'makefile') {
    return { label: 'MK', colorClass: 'text-rose-500' };
  }
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) {
    return { label: 'TS', colorClass: 'text-sky-500' };
  }
  if (lower.endsWith('.tf') || lower.endsWith('.tfvars')) {
    return { label: 'TF', colorClass: 'text-violet-500' };
  }
  if (lower.endsWith('.json')) {
    return { label: '{}', colorClass: 'text-amber-500' };
  }
  if (lower.endsWith('.css')) {
    return { label: 'CSS', colorClass: 'text-cyan-500' };
  }
  if (lower.endsWith('.md')) {
    return { label: 'MD', colorClass: 'text-emerald-500' };
  }
  if (lower.endsWith('.sh')) {
    return { label: 'SH', colorClass: 'text-emerald-500' };
  }
  return { label: '·', colorClass: 'text-muted-foreground' };
}

export const VsCodeWorkspace: React.FC<VsCodeWorkspaceProps> = ({ theme }) => {
  // Workbench Sidebar & Layout State
  const [sidebarMode, setSidebarMode] = useState<'explorer' | 'search' | null>('explorer');
  const [treeEntries, setTreeEntries] = useState<WorkspaceEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(true);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({
    src: true,
    'src/config': true,
    infra: true,
    'infra/terraform': true,
    scripts: true,
  });

  // New File Inline Creation
  const [creatingFile, setCreatingFile] = useState<boolean>(false);
  const [newFilePath, setNewFilePath] = useState<string>('');

  // Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState<boolean>(false);

  // Editor Tabs & Active File State
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string>('Makefile');
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({
    line: 1,
    col: 1,
  });
  const [pendingRevealLine, setPendingRevealLine] = useState<number | null>(null);

  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const activeTabRef = useRef<OpenTab | undefined>(undefined);
  const saveFileRef = useRef<(pathToSave?: string) => Promise<void>>(async () => {});

  // Integrated Bottom Terminal (@xterm/xterm) State
  const [terminalOpen, setTerminalOpen] = useState<boolean>(true);
  const [terminalMaximized, setTerminalMaximized] = useState<boolean>(false);
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const currentLineRef = useRef<string>('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const runCommandRef = useRef<(cmd: string) => void>(() => {});

  const [cmdInput, setCmdInput] = useState<string>('make deploy');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activePid, setActivePid] = useState<number | null>(null);
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [detectedCfUrl, setDetectedCfUrl] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.path === activePath);
  activeTabRef.current = activeTab;

  // Fetch workspace directory tree
  const loadWorkspaceTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch('/api/v1/workspace/tree');
      if (!res.ok) throw new Error('Failed to fetch workspace tree');
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setTreeEntries(data.entries);
      }
    } catch {
      toast.error('Could not load workspace directory tree');
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // Open a workspace file into tabs
  const openFile = useCallback(async (relPath: string, revealLine?: number) => {
    setActivePath(relPath);
    if (typeof revealLine === 'number') {
      setPendingRevealLine(revealLine);
    }

    setTabs((prev) => {
      const existing = prev.find((t) => t.path === relPath);
      if (existing) return prev;
      return [
        ...prev,
        {
          path: relPath,
          content: '',
          savedContent: '',
          language: detectMonacoLanguage(relPath),
          loading: true,
        },
      ];
    });

    try {
      const res = await fetch(`/api/v1/workspace/file?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Failed to open ${relPath}`);
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.path === relPath
            ? {
                ...t,
                content: data.content ?? '',
                savedContent: t.content !== t.savedContent ? t.savedContent : data.content ?? '',
                language: data.language || detectMonacoLanguage(relPath),
                sizeBytes: data.sizeBytes,
                loading: false,
                error: undefined,
              }
            : t
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to open file';
      setTabs((prev) =>
        prev.map((t) =>
          t.path === relPath ? { ...t, loading: false, error: msg } : t
        )
      );
    }
  }, []);

  // Save a tab to disk via PUT /api/v1/workspace/file
  const saveFile = useCallback(async (targetPath?: string) => {
    const tab = targetPath
      ? tabs.find((t) => t.path === targetPath)
      : activeTabRef.current;
    if (!tab || tab.loading || tab.error) return;

    setSavingPath(tab.path);
    try {
      const res = await fetch('/api/v1/workspace/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: tab.path,
          content: tab.content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save file');
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.path === tab.path
            ? { ...t, savedContent: t.content, sizeBytes: data.sizeBytes }
            : t
        )
      );
      toast.success(`Saved ${tab.path}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPath(null);
    }
  }, [tabs]);

  saveFileRef.current = saveFile;

  const closeTab = (relPath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== relPath);
      if (activePath === relPath) {
        setActivePath(next[next.length - 1]?.path || '');
      }
      return next;
    });
  };

  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFilePath.trim();
    if (!cleaned) return;
    try {
      const res = await fetch('/api/v1/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: cleaned, content: '' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create file');
      }
      setCreatingFile(false);
      setNewFilePath('');
      await loadWorkspaceTree();
      await openFile(data.path);
      toast.success(`Created ${data.path}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create file');
    }
  };

  // Initial load: fetch tree & open Makefile + .env + template.config.ts
  useEffect(() => {
    void loadWorkspaceTree();
    void openFile('Makefile');
    void openFile('src/config/template.config.ts');
  }, [loadWorkspaceTree, openFile]);

  // Workspace search effect
  useEffect(() => {
    if (sidebarMode !== 'search') return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/v1/workspace/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (Array.isArray(data.hits)) {
          setSearchHits(data.hits);
        }
      } catch {
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery, sidebarMode]);

  // Reveal line inside Monaco when jumping from search hits
  useEffect(() => {
    if (pendingRevealLine && editorRef.current && activeTab && !activeTab.loading) {
      editorRef.current.revealLineInCenter(pendingRevealLine);
      editorRef.current.setPosition({ lineNumber: pendingRevealLine, column: 1 });
      editorRef.current.focus();
      setPendingRevealLine(null);
    }
  }, [pendingRevealLine, activeTab]);

  // Keyboard shortcut Ctrl+S / Ctrl+` across IDE
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        void saveFileRef.current();
      } else if (ev.ctrlKey && ev.key === '`') {
        ev.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Monaco beforeMount configuration (disable noisy semantic missing-module squiggles while preserving syntax diagnostics)
  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    const monacoNs = monacoInstance as unknown as {
      typescript?: {
        typescriptDefaults?: { setDiagnosticsOptions?: (opts: Record<string, unknown>) => void };
        javascriptDefaults?: { setDiagnosticsOptions?: (opts: Record<string, unknown>) => void };
      };
      languages?: {
        typescript?: {
          typescriptDefaults?: { setDiagnosticsOptions?: (opts: Record<string, unknown>) => void };
          javascriptDefaults?: { setDiagnosticsOptions?: (opts: Record<string, unknown>) => void };
        };
      };
    };
    const rootTs =
      (monaco as unknown as typeof monacoNs).typescript ??
      monacoNs?.typescript ??
      monacoNs?.languages?.typescript;
    rootTs?.typescriptDefaults?.setDiagnosticsOptions?.({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    rootTs?.javascriptDefaults?.setDiagnosticsOptions?.({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
  };

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      void saveFileRef.current();
    });
    editor.onDidChangeCursorPosition((ev) => {
      setCursorPos({
        line: ev.position.lineNumber,
        col: ev.position.column,
      });
    });
  };

  // ============================================================================
  // INTEGRATED @xterm/xterm TERMINAL ENGINE (BACKED BY /api/v1/terminal/*)
  // ============================================================================
  const writePrompt = (term?: XTerm | null) => {
    const t = term || xtermRef.current;
    if (!t) return;
    t.write('\r\n\x1b[1;36mvscode-compute\x1b[0m:\x1b[1;34m/app/applet\x1b[0m$ ');
  };

  const executeOnCompute = async (rawCommand: string) => {
    const trimmed = rawCommand.trim();
    const term = xtermRef.current;
    if (!trimmed) return;

    if (!terminalOpen) {
      setTerminalOpen(true);
    }
    if (!term) return;

    if (trimmed === 'clear') {
      term.clear();
      writePrompt(term);
      return;
    }

    if (activeSessionIdRef.current) {
      term.writeln('\r\n\x1b[33m[Busy] Wait for running command or click Stop.\x1b[0m');
      return;
    }

    if (historyRef.current[0] !== trimmed) {
      historyRef.current = [trimmed, ...historyRef.current].slice(0, 50);
    }
    historyIndexRef.current = -1;

    setIsRunning(true);
    setLastExitCode(null);
    term.writeln(`\r\n\x1b[90m▶ Running:\x1b[0m \x1b[1;37m${trimmed}\x1b[0m`);

    try {
      const cols = term.cols || 120;
      const rows = term.rows || 20;
      const res = await fetch('/api/v1/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed, cols, rows }),
      });

      const data = await res.json();
      if (!res.ok || !data?.sessionId) {
        term.writeln(`\x1b[31mError: ${data?.error || 'Failed to start command'}\x1b[0m`);
        setIsRunning(false);
        setLastExitCode(1);
        writePrompt(term);
        return;
      }

      const sid = String(data.sessionId);
      activeSessionIdRef.current = sid;
      setActivePid(typeof data.pid === 'number' ? data.pid : null);

      if (data.resolvedCommand && data.resolvedCommand !== trimmed) {
        term.writeln(`\x1b[90m  ↳ ${data.resolvedCommand}\x1b[0m`);
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      const es = new EventSource(`/api/v1/terminal/stream/${encodeURIComponent(sid)}`);
      eventSourceRef.current = es;

      es.addEventListener('output', (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data);
          if (typeof parsed.chunk === 'string') {
            term.write(parsed.chunk);
            const foundCf = extractCloudFrontUrlFromOutput(parsed.chunk);
            if (foundCf) setDetectedCfUrl(foundCf);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('exit', (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data);
          const code = typeof parsed.code === 'number' ? parsed.code : 0;
          setLastExitCode(code);
          if (code === 0) {
            term.writeln('\r\n\x1b[32m✓ Process exited with code 0\x1b[0m');
          } else {
            term.writeln(`\r\n\x1b[31m✗ Process exited with code ${code}\x1b[0m`);
          }
        } catch {
          // ignore
        } finally {
          es.close();
          eventSourceRef.current = null;
          activeSessionIdRef.current = null;
          setActivePid(null);
          setIsRunning(false);
          writePrompt(term);
        }
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          activeSessionIdRef.current = null;
          setActivePid(null);
          setIsRunning(false);
        }
      };
    } catch (err) {
      term.writeln(
        `\r\n\x1b[31mNetwork error: ${
          err instanceof Error ? err.message : String(err)
        }\x1b[0m`
      );
      activeSessionIdRef.current = null;
      setActivePid(null);
      setIsRunning(false);
      writePrompt(term);
    }
  };

  runCommandRef.current = (cmd: string) => {
    void executeOnCompute(cmd);
  };

  const handleStopCommand = async () => {
    const sid = activeSessionIdRef.current;
    if (!sid) return;
    await fetch(`/api/v1/terminal/kill/${encodeURIComponent(sid)}`, {
      method: 'POST',
    }).catch(() => null);
  };

  useEffect(() => {
    const host = termContainerRef.current;
    if (!host) return;

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      fontSize: 12.5,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      theme: {
        background: '#0b101b',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: '#1e3a5f',
        black: '#0f172a',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln(
      '\x1b[1;36m● VS Code Integrated Terminal (@xterm/xterm · pnpm 12)\x1b[0m'
    );
    term.writeln(
      '\x1b[90m  Edit .env or Terraform above, Save (Ctrl+S), and run `make deploy` / `make deply` below.\x1b[0m'
    );
    writePrompt(term);

    const onDataDisposable = term.onData((data) => {
      const sid = activeSessionIdRef.current;
      if (sid) {
        if (data === '\x03') {
          void fetch(`/api/v1/terminal/kill/${encodeURIComponent(sid)}`, {
            method: 'POST',
          });
          return;
        }
        void fetch(`/api/v1/terminal/input/${encodeURIComponent(sid)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        });
        return;
      }

      if (data === '\r') {
        const toRun = currentLineRef.current;
        currentLineRef.current = '';
        if (!toRun.trim()) {
          writePrompt(term);
        } else {
          setCmdInput(toRun);
          runCommandRef.current(toRun);
        }
      } else if (data === '\x7f' || data === '\b') {
        if (currentLineRef.current.length > 0) {
          currentLineRef.current = currentLineRef.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (data === '\x0c') {
        term.clear();
        currentLineRef.current = '';
        writePrompt(term);
      } else if (data === '\x1b[A') {
        const hist = historyRef.current;
        if (hist.length > 0 && historyIndexRef.current < hist.length - 1) {
          historyIndexRef.current += 1;
          const nextCmd = hist[historyIndexRef.current];
          while (currentLineRef.current.length > 0) {
            currentLineRef.current = currentLineRef.current.slice(0, -1);
            term.write('\b \b');
          }
          currentLineRef.current = nextCmd;
          term.write(nextCmd);
        }
      } else if (data === '\x1b[B') {
        const hist = historyRef.current;
        if (historyIndexRef.current > 0) {
          historyIndexRef.current -= 1;
          const nextCmd = hist[historyIndexRef.current];
          while (currentLineRef.current.length > 0) {
            currentLineRef.current = currentLineRef.current.slice(0, -1);
            term.write('\b \b');
          }
          currentLineRef.current = nextCmd;
          term.write(nextCmd);
        } else if (historyIndexRef.current === 0) {
          historyIndexRef.current = -1;
          while (currentLineRef.current.length > 0) {
            currentLineRef.current = currentLineRef.current.slice(0, -1);
            term.write('\b \b');
          }
        }
      } else if (data >= ' ' && data !== '\x7f') {
        currentLineRef.current += data;
        term.write(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      eventSourceRef.current?.close();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (terminalOpen) {
      const t = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
        }
      }, 60);
      return () => clearTimeout(t);
    }
  }, [terminalOpen, terminalMaximized]);

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  };

  const renderTreeNodes = (nodes: WorkspaceEntry[], depth = 0): React.ReactNode => {
    return nodes.map((entry) => {
      if (entry.type === 'directory') {
        const isOpen = Boolean(expandedDirs[entry.path]);
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => toggleDir(entry.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className="w-full flex items-center gap-1.5 pr-2 py-1 text-left text-xs text-foreground/90 hover:bg-muted/70 rounded-sm cursor-pointer truncate"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              {isOpen ? (
                <FolderOpen className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-sky-500/80 shrink-0" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && entry.children && entry.children.length > 0 && (
              <div>{renderTreeNodes(entry.children, depth + 1)}</div>
            )}
          </div>
        );
      }

      const badge = getFileBadge(entry.name);
      const isSelected = activePath === entry.path;
      return (
        <button
          key={entry.path}
          type="button"
          data-testid={`vscode-tree-file-${entry.path}`}
          disabled={entry.isBinary}
          onClick={() => !entry.isBinary && void openFile(entry.path)}
          style={{ paddingLeft: `${22 + depth * 12}px` }}
          title={entry.isBinary ? `${entry.path} (binary asset)` : entry.path}
          className={`w-full flex items-center gap-1.5 pr-2 py-1 text-left text-xs rounded-sm truncate ${
            entry.isBinary
              ? 'opacity-45 cursor-not-allowed text-muted-foreground'
              : isSelected
              ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 font-medium cursor-pointer'
              : 'text-foreground/85 hover:bg-muted/70 cursor-pointer'
          }`}
        >
          <span
            className={`font-mono text-[9px] font-bold w-5 shrink-0 text-center ${badge.colorClass}`}
          >
            {badge.label}
          </span>
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });
  };

  const activeIsDirty = Boolean(
    activeTab && !activeTab.loading && activeTab.content !== activeTab.savedContent
  );

  return (
    <div
      data-testid="vscode-workbench"
      className="px-3 py-2 max-w-[1680px] mx-auto w-full flex-1 flex flex-col"
    >
      <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col h-[calc(100vh-116px)] min-h-[620px] shadow-xs">
        {/* Main Workbench Row: Activity Bar + Sidebar + Editor/Terminal Stack */}
        <div className="flex-1 min-h-0 flex">
          {/* 1. VS Code Activity Bar */}
          <div className="w-11 shrink-0 border-r border-border bg-muted/40 flex flex-col items-center py-2 gap-1.5">
            <button
              type="button"
              aria-label="VS Code Explorer"
              data-testid="vscode-activity-explorer"
              title="Explorer (Workspace Files)"
              onClick={() =>
                setSidebarMode((prev) => (prev === 'explorer' ? null : 'explorer'))
              }
              className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer transition-colors ${
                sidebarMode === 'explorer'
                  ? 'bg-sky-500/15 text-sky-500 border-l-2 border-sky-500'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Files className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="VS Code Search"
              data-testid="vscode-activity-search"
              title="Search across Workspace"
              onClick={() =>
                setSidebarMode((prev) => (prev === 'search' ? null : 'search'))
              }
              className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer transition-colors ${
                sidebarMode === 'search'
                  ? 'bg-sky-500/15 text-sky-500 border-l-2 border-sky-500'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Toggle Integrated Terminal"
              data-testid="vscode-activity-terminal"
              title="Toggle Integrated Terminal (Ctrl+`)"
              onClick={() => setTerminalOpen((prev) => !prev)}
              className={`w-8 h-8 rounded flex items-center justify-center cursor-pointer transition-colors ${
                terminalOpen
                  ? 'bg-sky-500/15 text-sky-500'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <TerminalIcon className="w-4 h-4" />
            </button>
          </div>

          {/* 2. Collapsible Explorer / Search Sidebar */}
          {sidebarMode && (
            <aside
              data-testid="vscode-sidebar"
              className="w-64 shrink-0 border-r border-border bg-muted/15 flex flex-col min-h-0"
            >
              {sidebarMode === 'explorer' ? (
                <>
                  <div className="h-9 px-3 border-b border-border flex items-center justify-between shrink-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Explorer
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="New File"
                        data-testid="vscode-new-file-btn"
                        title="New Workspace File"
                        onClick={() => setCreatingFile((prev) => !prev)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <FilePlus2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Refresh Explorer"
                        title="Refresh Workspace Tree"
                        onClick={() => void loadWorkspaceTree()}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {creatingFile && (
                    <form
                      onSubmit={handleCreateNewFile}
                      className="p-2 border-b border-border bg-background space-y-1.5"
                    >
                      <input
                        type="text"
                        autoFocus
                        data-testid="vscode-new-file-input"
                        value={newFilePath}
                        onChange={(e) => setNewFilePath(e.target.value)}
                        placeholder="e.g. infra/notes.md"
                        className="w-full h-7 px-2 rounded border border-border bg-background text-xs font-mono outline-none focus:border-sky-500"
                      />
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setCreatingFile(false);
                            setNewFilePath('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" size="xs">
                          Create
                        </Button>
                      </div>
                    </form>
                  )}

                  <div className="flex-1 overflow-y-auto py-1.5 space-y-2">
                    {/* Quick Access Pinned Files */}
                    <div>
                      <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Quick Access
                      </div>
                      <div className="space-y-0.5 px-1">
                        {CURATED_WORKSPACE_QUICK_FILES.map((qf) => {
                          const badge = getFileBadge(qf.label);
                          const isSelected = activePath === qf.path;
                          return (
                            <button
                              key={qf.path}
                              type="button"
                              data-testid={`vscode-quick-${qf.path}`}
                              title={qf.description}
                              onClick={() => void openFile(qf.path)}
                              className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs rounded-sm cursor-pointer truncate ${
                                isSelected
                                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 font-medium'
                                  : 'text-foreground/85 hover:bg-muted/70'
                              }`}
                            >
                              <span
                                className={`font-mono text-[9px] font-bold w-5 shrink-0 text-center ${badge.colorClass}`}
                              >
                                {badge.label}
                              </span>
                              <span className="truncate">{qf.path}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Full Workspace Tree */}
                    <div>
                      <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Workspace (/app/applet)
                      </div>
                      {treeLoading ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Loading files…
                        </div>
                      ) : (
                        <div className="px-1">{renderTreeNodes(treeEntries)}</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-9 px-3 border-b border-border flex items-center justify-between shrink-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Search
                    </span>
                  </div>
                  <div className="p-2 border-b border-border">
                    <input
                      type="text"
                      autoFocus
                      data-testid="vscode-search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search files (min 2 chars)…"
                      className="w-full h-7 px-2 rounded border border-border bg-background text-xs font-mono outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                    {searching ? (
                      <div className="p-2 text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Searching…
                      </div>
                    ) : searchQuery.trim().length < 2 ? (
                      <div className="p-2 text-xs text-muted-foreground">
                        Type at least 2 characters to search across source, Terraform, and scripts.
                      </div>
                    ) : searchHits.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground">
                        No matches found.
                      </div>
                    ) : (
                      searchHits.map((hit, idx) => (
                        <button
                          key={`${hit.path}:${hit.line}:${idx}`}
                          type="button"
                          onClick={() => void openFile(hit.path, hit.line)}
                          className="w-full text-left p-1.5 rounded hover:bg-muted/70 cursor-pointer space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-1 text-[11px] font-mono text-sky-600 dark:text-sky-400">
                            <span className="truncate">{hit.path}</span>
                            <span className="shrink-0 text-muted-foreground">:{hit.line}</span>
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground truncate">
                            {hit.preview}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </aside>
          )}

          {/* 3. Main Editor + Integrated Terminal Column */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {/* Open Editor Tabs Bar + Actions */}
            <div className="h-9 border-b border-border bg-muted/25 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center overflow-x-auto no-scrollbar h-full min-w-0">
                {tabs.map((tab) => {
                  const isActive = tab.path === activePath;
                  const isDirty = !tab.loading && tab.content !== tab.savedContent;
                  const fileName = tab.path.split('/').pop() || tab.path;
                  const badge = getFileBadge(fileName);

                  return (
                    <div
                      key={tab.path}
                      role="tab"
                      aria-selected={isActive}
                      data-testid={`vscode-tab-${tab.path}`}
                      onClick={() => setActivePath(tab.path)}
                      className={`group h-full px-3 border-r border-border flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0 ${
                        isActive
                          ? 'bg-background text-foreground border-t-2 border-t-sky-500 font-medium'
                          : 'text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      <span className={`font-mono text-[9px] font-bold ${badge.colorClass}`}>
                        {badge.label}
                      </span>
                      <span className="font-mono text-[11.5px]">{fileName}</span>
                      {isDirty ? (
                        <span
                          title="Unsaved changes"
                          className="w-2 h-2 rounded-full bg-amber-500 ml-0.5"
                        />
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Close ${fileName}`}
                        onClick={(e) => closeTab(tab.path, e)}
                        className="ml-1 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground opacity-70 group-hover:opacity-100 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 px-2 shrink-0">
                <Button
                  type="button"
                  size="xs"
                  variant={activeIsDirty ? 'default' : 'outline'}
                  disabled={!activeTab || !activeIsDirty || savingPath === activeTab?.path}
                  data-testid="vscode-save-btn"
                  onClick={() => void saveFile()}
                  title="Save active file to workspace disk (Ctrl+S)"
                >
                  <Save className="!size-3" />
                  {savingPath === activeTab?.path ? 'Saving…' : 'Save'}
                </Button>

                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  disabled={isRunning}
                  data-testid="vscode-quick-deploy-btn"
                  onClick={() => void executeOnCompute('make deploy')}
                  title="Run make deploy in Integrated Terminal"
                >
                  <Rocket className="!size-3" />
                  make deploy
                </Button>

                <Button
                  type="button"
                  size="xs"
                  variant={terminalOpen ? 'secondary' : 'outline'}
                  data-testid="vscode-toggle-terminal-btn"
                  onClick={() => setTerminalOpen((prev) => !prev)}
                  title="Toggle Integrated Terminal (Ctrl+`)"
                >
                  <PanelBottom className="!size-3" />
                  Terminal
                </Button>
              </div>
            </div>

            {/* Active File Breadcrumb */}
            {activeTab && (
              <div className="h-6 px-3 border-b border-border bg-background flex items-center justify-between text-[11px] font-mono text-muted-foreground shrink-0">
                <div className="flex items-center gap-1 truncate">
                  <FileCode2 className="w-3 h-3 text-sky-500 shrink-0" />
                  <span className="truncate">{activeTab.path}</span>
                  {activeIsDirty && (
                    <span className="text-amber-500 ml-1">(modified)</span>
                  )}
                </div>
                <span className="shrink-0">
                  {activeTab.language}
                  {typeof activeTab.sizeBytes === 'number'
                    ? ` · ${(activeTab.sizeBytes / 1024).toFixed(1)} KB`
                    : ''}
                </span>
              </div>
            )}

            {/* Monaco Editor Surface */}
            <div
              data-testid="monaco-editor-container"
              className="flex-1 min-h-0 relative bg-background"
            >
              {!activeTab ? (
                <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2 p-6">
                  <FileCode2 className="w-8 h-8 text-sky-500/60" />
                  <p>Select any file from the Explorer or Quick Access to edit in VS Code.</p>
                </div>
              ) : activeTab.loading ? (
                <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                  Loading {activeTab.path}…
                </div>
              ) : activeTab.error ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-rose-500 p-6">
                  <XCircle className="w-6 h-6" />
                  <span>{activeTab.error}</span>
                </div>
              ) : (
                <Editor
                  height="100%"
                  path={activeTab.path}
                  language={activeTab.language}
                  value={activeTab.content}
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  beforeMount={handleBeforeMount}
                  onMount={handleEditorMount}
                  onChange={(val) => {
                    const updated = val ?? '';
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === activeTab.path ? { ...t, content: updated } : t
                      )
                    );
                  }}
                  options={{
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineHeight: 20,
                    tabSize: 2,
                    wordWrap: 'off',
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    bracketPairColorization: { enabled: true },
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    padding: { top: 8, bottom: 8 },
                  }}
                />
              )}
            </div>

            {/* Integrated Bottom Terminal Panel (@xterm/xterm) */}
            <div
              data-testid="vscode-terminal-panel"
              className={`border-t border-border bg-[#0b101b] flex flex-col shrink-0 transition-all ${
                terminalOpen
                  ? terminalMaximized
                    ? 'h-[380px]'
                    : 'h-60'
                  : 'hidden'
              }`}
            >
              {/* Terminal Panel Toolbar */}
              <div className="h-9 px-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between gap-2 text-xs text-zinc-200 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-[11px] uppercase tracking-wider text-sky-400 border-b border-sky-400 pb-0.5 shrink-0">
                    Terminal
                  </span>

                  {isRunning ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 shrink-0">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      PID {activePid ?? '…'}
                    </span>
                  ) : lastExitCode !== null ? (
                    <span
                      data-testid="compute-exit-badge"
                      className={`inline-flex items-center gap-1 font-mono text-[10.5px] px-1.5 py-0.5 rounded shrink-0 ${
                        lastExitCode === 0
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {lastExitCode === 0 ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      exit {lastExitCode}
                    </span>
                  ) : null}

                  {detectedCfUrl && (
                    <a
                      href={detectedCfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="detected-cloudfront-url"
                      className="inline-flex items-center gap-1 font-mono text-[10.5px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:underline shrink-0"
                    >
                      {detectedCfUrl}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  <div className="hidden xl:flex items-center gap-1 ml-1">
                    {COMPUTE_PRESET_COMMANDS.slice(0, 4).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isRunning}
                        data-testid={`preset-${preset.id}`}
                        title={preset.description}
                        onClick={() => {
                          setCmdInput(preset.command);
                          void executeOnCompute(preset.command);
                        }}
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[10.5px] cursor-pointer disabled:opacity-50"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void executeOnCompute(cmdInput);
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="text"
                      aria-label="Compute command input"
                      data-testid="compute-cmd-input"
                      value={cmdInput}
                      onChange={(e) => setCmdInput(e.target.value)}
                      placeholder="make deploy | make deply"
                      className="w-44 sm:w-56 h-6 px-2 rounded bg-zinc-950 border border-zinc-700 text-[11px] font-mono text-zinc-100 outline-none focus:border-sky-500"
                    />
                    <button
                      type="submit"
                      disabled={isRunning || !cmdInput.trim()}
                      data-testid="compute-run-btn"
                      title="Run command on compute"
                      className="h-6 px-2 rounded bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Play className="w-3 h-3" />
                      Run
                    </button>
                  </form>

                  <button
                    type="button"
                    disabled={!isRunning}
                    data-testid="compute-stop-btn"
                    onClick={handleStopCommand}
                    title="Stop running command"
                    className="h-6 px-1.5 rounded bg-zinc-800 hover:bg-rose-600 text-zinc-200 text-[11px] inline-flex items-center cursor-pointer disabled:opacity-40"
                  >
                    <Square className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    data-testid="compute-clear-btn"
                    onClick={() => {
                      xtermRef.current?.clear();
                      if (!isRunning) writePrompt();
                    }}
                    title="Clear terminal"
                    className="h-6 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] inline-flex items-center cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    aria-label={terminalMaximized ? 'Restore terminal height' : 'Maximize terminal height'}
                    onClick={() => setTerminalMaximized((prev) => !prev)}
                    className="h-6 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center cursor-pointer"
                  >
                    {terminalMaximized ? (
                      <Minimize2 className="w-3 h-3" />
                    ) : (
                      <Maximize2 className="w-3 h-3" />
                    )}
                  </button>

                  <button
                    type="button"
                    aria-label="Hide terminal"
                    onClick={() => setTerminalOpen(false)}
                    className="h-6 px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* @xterm/xterm Terminal Mount */}
              <div
                ref={termContainerRef}
                data-testid="xterm-terminal-container"
                className="flex-1 min-h-0 w-full px-2 py-1 overflow-hidden"
              />
            </div>
          </div>
        </div>

        {/* 4. VS Code Bottom Status Bar */}
        <div className="h-6 px-3 bg-sky-600 dark:bg-sky-700 text-white flex items-center justify-between text-[11px] font-mono shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span className="font-semibold">VS Code Web</span>
            <span className="opacity-85">/app/applet</span>
            <span className="opacity-85">pnpm 12</span>
          </div>
          <div className="flex items-center gap-3">
            {activeTab && (
              <>
                <span>
                  Ln {cursorPos.line}, Col {cursorPos.col}
                </span>
                <span>UTF-8</span>
                <span>{activeTab.language}</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setTerminalOpen((prev) => !prev)}
              className="hover:underline cursor-pointer"
            >
              {terminalOpen ? 'Terminal: Open' : 'Terminal: Hidden'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
