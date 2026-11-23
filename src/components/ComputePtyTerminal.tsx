import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Cpu,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  RotateCcw,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  stripAnsiEscapeCodes,
  type ComputeHostInfo,
  type PtySessionDescriptor,
} from '../engine/computeShell';

export interface ComputePtyTerminalHandle {
  sendInput: (data: string) => void;
  runCommand: (command: string) => void;
  writeNotice: (text: string) => void;
}

export interface ComputePtyTerminalProps {
  theme: 'light' | 'dark';
  computeInfo: ComputeHostInfo | null;
  maximized: boolean;
  onToggleMaximize: () => void;
  onHide: () => void;
  onWorkspaceMutated?: () => void;
}

interface PtyTabRecord {
  tabId: string;
  label: string;
  sessionId: string | null;
  tty: string;
  pid: number | null;
  cwd: string;
  cols: number;
  rows: number;
  status: 'connecting' | 'connected' | 'exited' | 'error';
  exitCode: number | null;
  transcript: string;
}

const TTY_PRESETS = [
  { label: 'tty & host', cmd: 'tty && uname -a && id && node -v' },
  { label: 'ls -la', cmd: 'pwd && ls -la' },
  { label: 'Unit Tests', cmd: 'npm test' },
  { label: 'make deploy', cmd: 'make deploy' },
  { label: 'MCP Status', cmd: 'curl -s http://localhost:3000/.well-known/mcp.json | head -c 450; echo' },
];

const LIGHT_XTERM_THEME = {
  background: '#ffffff',
  foreground: '#0f172a',
  cursor: '#0284c7',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(2, 132, 199, 0.22)',
  black: '#1e293b',
  red: '#dc2626',
  green: '#15803d',
  yellow: '#b45309',
  blue: '#1d4ed8',
  magenta: '#9333ea',
  cyan: '#0e7490',
  white: '#e2e8f0',
  brightBlack: '#64748b',
  brightRed: '#ef4444',
  brightGreen: '#16a34a',
  brightYellow: '#d97706',
  brightBlue: '#2563eb',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#f8fafc',
};

const DARK_XTERM_THEME = {
  background: '#0b1120',
  foreground: '#e2e8f0',
  cursor: '#38bdf8',
  cursorAccent: '#0b1120',
  selectionBackground: 'rgba(56, 189, 248, 0.28)',
  black: '#0f172a',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#cbd5e1',
  brightBlack: '#64748b',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
};

interface MountedPtyInstance {
  term: XTerm;
  fitAddon: FitAddon;
  eventSource: EventSource | null;
  sessionId: string | null;
  inputQueue: Promise<void>;
  resizeTimer: ReturnType<typeof setTimeout> | null;
}

export const ComputePtyTerminal = forwardRef<ComputePtyTerminalHandle, ComputePtyTerminalProps>(
  ({ theme, computeInfo, maximized, onToggleMaximize, onHide, onWorkspaceMutated }, ref) => {
    const [tabs, setTabs] = useState<PtyTabRecord[]>([]);
    const [activeTabId, setActiveTabId] = useState<string>('');
    const [quickCmd, setQuickCmd] = useState<string>('');

    const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const instancesRef = useRef<Record<string, MountedPtyInstance>>({});
    const activeTabIdRef = useRef<string>('');
    const tabCounterRef = useRef<number>(0);
    const initializedRef = useRef<boolean>(false);

    useEffect(() => {
      activeTabIdRef.current = activeTabId;
    }, [activeTabId]);

    const sendRawToTab = useCallback((tabId: string, data: string) => {
      const inst = instancesRef.current[tabId];
      if (!inst || !inst.sessionId || !data) return;
      const sid = inst.sessionId;
      inst.inputQueue = inst.inputQueue
        .then(async () => {
          await fetch(`/api/v1/terminal/pty/input/${encodeURIComponent(sid)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
          });
        })
        .catch(() => undefined);
    }, []);

    const syncResizeToTab = useCallback((tabId: string) => {
      const inst = instancesRef.current[tabId];
      const container = containerRefs.current[tabId];
      if (!inst || !container || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }
      try {
        inst.fitAddon.fit();
      } catch {
        return;
      }
      const cols = inst.term.cols;
      const rows = inst.term.rows;
      setTabs((prev) =>
        prev.map((t) => (t.tabId === tabId ? { ...t, cols, rows } : t))
      );
      if (inst.sessionId) {
        if (inst.resizeTimer) clearTimeout(inst.resizeTimer);
        const sid = inst.sessionId;
        inst.resizeTimer = setTimeout(() => {
          fetch(`/api/v1/terminal/pty/resize/${encodeURIComponent(sid)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols, rows }),
          }).catch(() => undefined);
        }, 60);
      }
    }, []);

    const connectTabToPty = useCallback(
      async (tabId: string) => {
        const inst = instancesRef.current[tabId];
        if (!inst) return;

        inst.eventSource?.close();
        inst.eventSource = null;

        try {
          inst.fitAddon.fit();
        } catch {
          // ignore initial layout race
        }

        const cols = inst.term.cols || 120;
        const rows = inst.term.rows || 24;

        setTabs((prev) =>
          prev.map((t) =>
            t.tabId === tabId ? { ...t, status: 'connecting', exitCode: null } : t
          )
        );

        try {
          const res = await fetch('/api/v1/terminal/pty/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols, rows }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(err.error || `HTTP ${res.status}`);
          }
          const created = (await res.json()) as PtySessionDescriptor;
          inst.sessionId = created.sessionId;

          setTabs((prev) =>
            prev.map((t) =>
              t.tabId === tabId
                ? {
                    ...t,
                    sessionId: created.sessionId,
                    tty: created.tty || '/dev/pts/0',
                    pid: created.pid,
                    cwd: created.cwd || '/app/applet',
                    cols: created.cols,
                    rows: created.rows,
                    status: 'connected',
                  }
                : t
            )
          );

          const es = new EventSource(
            `/api/v1/terminal/pty/stream/${encodeURIComponent(created.sessionId)}`
          );
          inst.eventSource = es;

          es.addEventListener('ready', (ev) => {
            try {
              const parsed = JSON.parse((ev as MessageEvent).data) as {
                tty?: string;
                pid?: number;
                cwd?: string;
              };
              setTabs((prev) =>
                prev.map((t) =>
                  t.tabId === tabId
                    ? {
                        ...t,
                        tty: parsed.tty || t.tty,
                        pid: parsed.pid ?? t.pid,
                        cwd: parsed.cwd || t.cwd,
                        status: 'connected',
                      }
                    : t
                )
              );
            } catch {
              // ignore
            }
          });

          es.addEventListener('output', (ev) => {
            try {
              const parsed = JSON.parse((ev as MessageEvent).data) as { data?: string };
              if (parsed.data) {
                inst.term.write(parsed.data);
                const plain = stripAnsiEscapeCodes(parsed.data);
                if (plain) {
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.tabId === tabId
                        ? {
                            ...t,
                            transcript: (t.transcript + plain).slice(-12000),
                          }
                        : t
                    )
                  );
                }
              }
            } catch {
              // ignore
            }
          });

          es.addEventListener('exit', (ev) => {
            let code = 0;
            try {
              const parsed = JSON.parse((ev as MessageEvent).data) as { code?: number };
              code = parsed.code ?? 0;
            } catch {
              // ignore
            }
            inst.term.writeln(`\r\n\x1b[33m[TTY exited with code ${code} — click Restart TTY to respawn]\x1b[0m`);
            es.close();
            inst.eventSource = null;
            setTabs((prev) =>
              prev.map((t) =>
                t.tabId === tabId
                  ? { ...t, status: 'exited', exitCode: code }
                  : t
              )
            );
          });

          es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) {
              setTabs((prev) =>
                prev.map((t) =>
                  t.tabId === tabId && t.status === 'connected'
                    ? { ...t, status: 'exited' }
                    : t
                )
              );
            }
          };

          setTimeout(() => {
            syncResizeToTab(tabId);
            if (activeTabIdRef.current === tabId) {
              inst.term.focus();
            }
          }, 80);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          inst.term.writeln(`\r\n\x1b[31m[PTY connection failed: ${msg}]\x1b[0m`);
          setTabs((prev) =>
            prev.map((t) => (t.tabId === tabId ? { ...t, status: 'error' } : t))
          );
        }
      },
      [syncResizeToTab]
    );

    const createNewTab = useCallback(() => {
      tabCounterRef.current += 1;
      const num = tabCounterRef.current;
      const tabId = `tty-${Date.now().toString(36)}-${num}`;
      const record: PtyTabRecord = {
        tabId,
        label: `tty #${num}`,
        sessionId: null,
        tty: '/dev/pts/…',
        pid: null,
        cwd: computeInfo?.cwd || '/app/applet',
        cols: 120,
        rows: 24,
        status: 'connecting',
        exitCode: null,
        transcript: '',
      };
      setTabs((prev) => [...prev, record]);
      setActiveTabId(tabId);
      return tabId;
    }, [computeInfo?.cwd]);

    // Auto-create first PTY tab once on mount
    useEffect(() => {
      if (!initializedRef.current) {
        initializedRef.current = true;
        createNewTab();
      }
    }, [createNewTab]);

    // Mount xterm instances for any new tabs
    useEffect(() => {
      for (const tab of tabs) {
        if (instancesRef.current[tab.tabId]) continue;
        const container = containerRefs.current[tab.tabId];
        if (!container) continue;

        const term = new XTerm({
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: 12.5,
          lineHeight: 1.25,
          fontFamily:
            '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          scrollback: 5000,
          convertEol: false,
          theme: theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME,
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(container);

        instancesRef.current[tab.tabId] = {
          term,
          fitAddon,
          eventSource: null,
          sessionId: null,
          inputQueue: Promise.resolve(),
          resizeTimer: null,
        };

        term.onData((data) => {
          sendRawToTab(tab.tabId, data);
        });

        connectTabToPty(tab.tabId);
      }
    }, [tabs, theme, sendRawToTab, connectTabToPty]);

    // Sync xterm color theme dynamically when app theme changes
    useEffect(() => {
      const nextTheme = theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME;
      for (const inst of Object.values(instancesRef.current)) {
        inst.term.options.theme = nextTheme;
      }
    }, [theme]);

    // Refit active terminal on tab switch, maximize toggle, or viewport resize
    useEffect(() => {
      if (!activeTabId) return;
      const timer = setTimeout(() => {
        syncResizeToTab(activeTabId);
        instancesRef.current[activeTabId]?.term.focus();
      }, 60);

      const container = containerRefs.current[activeTabId];
      let observer: ResizeObserver | null = null;
      if (container && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          syncResizeToTab(activeTabId);
        });
        observer.observe(container);
      }
      return () => {
        clearTimeout(timer);
        observer?.disconnect();
      };
    }, [activeTabId, maximized, syncResizeToTab]);

    // Cleanup all PTY sessions on unmount
    useEffect(() => {
      const instMap = instancesRef.current;
      return () => {
        for (const inst of Object.values(instMap)) {
          if (inst.resizeTimer) clearTimeout(inst.resizeTimer);
          inst.eventSource?.close();
          if (inst.sessionId) {
            fetch(`/api/v1/terminal/pty/kill/${encodeURIComponent(inst.sessionId)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ signal: 'SIGTERM' }),
            }).catch(() => undefined);
          }
          inst.term.dispose();
        }
      };
    }, []);

    const handleCloseTab = (tabId: string) => {
      const inst = instancesRef.current[tabId];
      if (inst) {
        if (inst.resizeTimer) clearTimeout(inst.resizeTimer);
        inst.eventSource?.close();
        if (inst.sessionId) {
          fetch(`/api/v1/terminal/pty/kill/${encodeURIComponent(inst.sessionId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signal: 'SIGTERM' }),
          }).catch(() => undefined);
        }
        inst.term.dispose();
        delete instancesRef.current[tabId];
      }
      setTabs((prev) => {
        const next = prev.filter((t) => t.tabId !== tabId);
        if (next.length === 0) {
          setTimeout(() => createNewTab(), 0);
        } else if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1].tabId);
        }
        return next;
      });
    };

    const handleRestartTab = (tabId: string) => {
      const inst = instancesRef.current[tabId];
      if (!inst) return;
      if (inst.sessionId) {
        fetch(`/api/v1/terminal/pty/kill/${encodeURIComponent(inst.sessionId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signal: 'SIGTERM' }),
        }).catch(() => undefined);
      }
      inst.term.clear();
      setTabs((prev) =>
        prev.map((t) => (t.tabId === tabId ? { ...t, transcript: '' } : t))
      );
      connectTabToPty(tabId);
    };

    const handleSendQuickCommand = (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed || !activeTabId) return;
      sendRawToTab(activeTabId, `${trimmed}\r`);
      instancesRef.current[activeTabId]?.term.focus();
      setQuickCmd('');
      if (onWorkspaceMutated) {
        setTimeout(onWorkspaceMutated, 900);
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        sendInput: (data: string) => {
          if (activeTabIdRef.current) {
            sendRawToTab(activeTabIdRef.current, data);
          }
        },
        runCommand: (command: string) => {
          if (activeTabIdRef.current) {
            sendRawToTab(activeTabIdRef.current, `${command}\r`);
          }
        },
        writeNotice: (text: string) => {
          const inst = instancesRef.current[activeTabIdRef.current];
          if (inst) {
            inst.term.writeln(`\r\n${text}`);
          }
        },
      }),
      [sendRawToTab]
    );

    const activeTab = tabs.find((t) => t.tabId === activeTabId) || tabs[0];

    return (
      <div
        data-testid="vscode-terminal-panel"
        className={`flex flex-col border-t border-border bg-card shrink-0 transition-all ${
          maximized ? 'h-[68%]' : 'h-64 sm:h-72'
        }`}
      >
        {/* Terminal Header Bar: Single Compact Row with Kernel PTY Tabs + Host Telemetry + Controls */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1 bg-muted/30 overflow-x-auto">
          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap shrink-0">
            <div className="flex items-center gap-1 pr-1.5 border-r border-border">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono text-[11px] font-semibold text-foreground">
                Full TTY
              </span>
            </div>

            {/* Multi-Tab Real Kernel PTY Sessions */}
            <div className="flex items-center gap-1">
              {tabs.map((tab) => {
                const isActive = tab.tabId === activeTab?.tabId;
                return (
                  <div
                    key={tab.tabId}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      isActive
                        ? 'border-primary/50 bg-primary/10 text-foreground font-semibold'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveTabId(tab.tabId)}
                      data-testid={`vscode-tty-tab-${tab.label.replace(/\s+/g, '-')}`}
                      className="inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          tab.status === 'connected'
                            ? 'bg-emerald-500'
                            : tab.status === 'connecting'
                            ? 'bg-amber-500 animate-pulse'
                            : 'bg-rose-500'
                        }`}
                      />
                      <span>{tab.label}</span>
                      <span className="text-[9px] text-muted-foreground">{tab.tty}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCloseTab(tab.tabId)}
                      aria-label={`Close ${tab.label}`}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={createNewTab}
                data-testid="vscode-terminal-new-shell"
                title="Spawn new kernel /dev/pts TTY shell (/bin/bash -i)"
                className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>

            {/* Underlying Compute Telemetry Badge */}
            <div
              data-testid="vscode-compute-host-badge"
              className="hidden lg:inline-flex items-center gap-1.5 rounded border border-border bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              <Cpu className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span className="text-foreground font-medium">
                {computeInfo
                  ? `${computeInfo.user}@${computeInfo.hostname}`
                  : 'root@compute'}
              </span>
              <span>·</span>
              <span className="text-primary font-semibold" data-testid="vscode-tty-device">
                {activeTab?.tty || '/dev/pts/0'}
              </span>
              {activeTab && (
                <>
                  <span>·</span>
                  <span>
                    {activeTab.cols}×{activeTab.rows}
                  </span>
                </>
              )}
              {computeInfo && (
                <>
                  <span>·</span>
                  <span>
                    {computeInfo.platform}/{computeInfo.arch} · {computeInfo.nodeVersion}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right Controls: Presets + Ctrl+C / Ctrl+D / Restart / Clear / Maximize / Hide */}
          <div className="flex items-center gap-1 whitespace-nowrap shrink-0">
            <div className="hidden 2xl:flex items-center gap-1 mr-1">
              {TTY_PRESETS.slice(0, 4).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleSendQuickCommand(preset.cmd)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => activeTab && sendRawToTab(activeTab.tabId, '\x03')}
              data-testid="vscode-terminal-sigint"
              title="Send Ctrl+C (SIGINT) to active TTY"
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
            >
              Ctrl+C
            </button>
            <button
              type="button"
              onClick={() => activeTab && sendRawToTab(activeTab.tabId, '\x04')}
              data-testid="vscode-terminal-eof"
              title="Send Ctrl+D (EOF) to active TTY"
              className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Ctrl+D
            </button>
            <button
              type="button"
              onClick={() => activeTab && handleRestartTab(activeTab.tabId)}
              data-testid="vscode-terminal-restart"
              title="Restart /bin/bash TTY session"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTab) {
                  instancesRef.current[activeTab.tabId]?.term.clear();
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.tabId === activeTab.tabId ? { ...t, transcript: '' } : t
                    )
                  );
                }
              }}
              aria-label="Clear terminal screen"
              title="Clear terminal screen"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onToggleMaximize}
              aria-label={maximized ? 'Restore terminal size' : 'Maximize terminal'}
              title={maximized ? 'Restore terminal size' : 'Maximize terminal'}
              data-testid="vscode-terminal-maximize"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {maximized ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={onHide}
              aria-label="Hide terminal"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Real @xterm/xterm Interactive VT100/PTY Canvas Area */}
        <div
          className="relative flex-1 min-h-0 w-full overflow-hidden"
          style={{ backgroundColor: theme === 'dark' ? '#0b1120' : '#ffffff' }}
          onClick={() => activeTab && instancesRef.current[activeTab.tabId]?.term.focus()}
        >
          {tabs.map((tab) => {
            const isVisible = tab.tabId === activeTab?.tabId;
            return (
              <div
                key={tab.tabId}
                ref={(el) => {
                  containerRefs.current[tab.tabId] = el;
                }}
                data-testid={isVisible ? 'vscode-xterm-container' : undefined}
                className={`absolute inset-0 px-2 py-1 ${
                  isVisible ? 'block' : 'hidden'
                }`}
              />
            );
          })}

          {/* Accessible plain-text transcript mirror for copy/automation inspection */}
          <pre
            data-testid="vscode-terminal-output"
            aria-hidden="true"
            className="sr-only"
          >
            {activeTab?.transcript || ''}
          </pre>
        </div>

        {/* Quick Send Bar (injects directly into the live /dev/pts/N TTY stdin) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendQuickCommand(quickCmd);
          }}
          className="flex items-center gap-2 border-t border-border px-2.5 py-1 bg-card"
        >
          <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
            {activeTab?.tty || 'tty'} &gt;
          </span>
          <input
            type="text"
            value={quickCmd}
            onChange={(e) => setQuickCmd(e.target.value)}
            placeholder="Click terminal above for direct TTY keystrokes (vim, nano, top, python3, Tab, Ctrl+C) — or send a command here…"
            aria-label="Quick send command to TTY"
            data-testid="vscode-terminal-input"
            className="flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            data-testid="vscode-terminal-run"
            className="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
          >
            <Play className="h-2.5 w-2.5 fill-current" />
            <span>Send</span>
          </button>
        </form>
      </div>
    );
  }
);

ComputePtyTerminal.displayName = 'ComputePtyTerminal';
