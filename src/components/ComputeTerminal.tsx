import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Play,
  Square,
  Trash2,
  Terminal as TerminalIcon,
  Rocket,
  CheckCircle2,
  XCircle,
  Loader2,
  Cpu,
  ExternalLink,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  COMPUTE_PRESET_COMMANDS,
  extractCloudFrontUrlFromOutput,
  type ComputeCommandPreset,
} from '../engine/computeShell';

interface ComputeStatus {
  cwd: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  hasMake: boolean;
  hasTerraform: boolean;
  activeSessions: number;
  targets: Array<{ name: string; description: string }>;
}

export const ComputeTerminal: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const [status, setStatus] = useState<ComputeStatus | null>(null);
  const [detectedCfUrl, setDetectedCfUrl] = useState<string | null>(null);

  const writePrompt = (term?: XTerm | null) => {
    const t = term || xtermRef.current;
    if (!t) return;
    t.write('\r\n\x1b[1;36mcompute\x1b[0m:\x1b[1;34m/app/applet\x1b[0m$ ');
  };

  useEffect(() => {
    fetch('/api/v1/terminal/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStatus(data);
      })
      .catch(() => null);
  }, []);

  const executeOnCompute = async (rawCommand: string) => {
    const trimmed = rawCommand.trim();
    const term = xtermRef.current;
    if (!trimmed || !term) return;

    if (trimmed === 'clear') {
      term.clear();
      writePrompt(term);
      return;
    }

    if (activeSessionIdRef.current) {
      term.writeln('\r\n\x1b[33m[Busy] Wait for running command or click Stop (Ctrl+C).\x1b[0m');
      return;
    }

    if (historyRef.current[0] !== trimmed) {
      historyRef.current = [trimmed, ...historyRef.current].slice(0, 50);
    }
    historyIndexRef.current = -1;

    setIsRunning(true);
    setLastExitCode(null);
    term.writeln(`\r\n\x1b[90m▶ Running on compute:\x1b[0m \x1b[1;37m${trimmed}\x1b[0m`);

    try {
      const cols = term.cols || 120;
      const rows = term.rows || 30;
      const res = await fetch('/api/v1/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed, cols, rows }),
      });

      const data = await res.json();
      if (!res.ok || !data?.sessionId) {
        term.writeln(`\x1b[31mError: ${data?.error || 'Failed to start compute command'}\x1b[0m`);
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
            term.writeln(`\r\n\x1b[32m✓ Process exited with code 0\x1b[0m`);
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
        `\r\n\x1b[31mNetwork error starting compute command: ${
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
    const host = containerRef.current;
    if (!host) return;

    const term = new XTerm({
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      theme: {
        background: '#090d16',
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

    term.writeln('\x1b[1;36m● App Compute Interactive Shell (@xterm/xterm · pnpm 12)\x1b[0m');
    term.writeln(
      '\x1b[90m  Type any command (`make deploy`, `make deply`, `make verify`, `pnpm run lint`, `ls`) or use the presets above.\x1b[0m'
    );
    writePrompt(term);

    const onDataDisposable = term.onData((data) => {
      const sid = activeSessionIdRef.current;
      // Forward raw keystrokes to active process if running
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

      // Local interactive shell line editor when idle
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
        // Arrow Up -> older history
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
        // Arrow Down -> newer history
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

  const handlePresetClick = (preset: ComputeCommandPreset) => {
    setCmdInput(preset.command);
    void executeOnCompute(preset.command);
  };

  return (
    <div className="px-4 py-3 max-w-[1600px] mx-auto space-y-3">
      {/* Header & Compute Environment Strip */}
      <div className="rounded-lg border border-border bg-card p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-sky-500" />
            <h1 className="text-sm font-semibold text-foreground">
              App Compute Shell &amp; Deployment Console
            </h1>
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              @xterm/xterm
            </span>
            {isRunning ? (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-500 font-semibold">
                <Loader2 className="w-3 h-3 animate-spin" />
                Running{activePid ? ` (PID ${activePid})` : ''}
              </span>
            ) : lastExitCode !== null ? (
              <span
                data-testid="compute-exit-badge"
                className={`inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded font-semibold ${
                  lastExitCode === 0
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : 'bg-rose-500/15 text-rose-500'
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
          </div>
          <p className="text-xs text-muted-foreground">
            Run <code className="font-mono text-foreground">make deploy</code>, Terraform, build, test, or shell commands directly inside the app compute container.
          </p>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground flex-wrap">
          {detectedCfUrl && (
            <a
              href={detectedCfUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="detected-cloudfront-url"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
            >
              {detectedCfUrl}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <span className="inline-flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-sky-500" />
            {status ? `${status.cwd} · Node ${status.nodeVersion} · ${status.platform}/${status.arch}` : '/app/applet'}
          </span>
        </div>
      </div>

      {/* Preset Command Strip + Direct Command Execution Bar */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {COMPUTE_PRESET_COMMANDS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="xs"
              variant={preset.id === 'make-deploy' ? 'default' : 'outline'}
              disabled={isRunning}
              data-testid={`preset-${preset.id}`}
              title={preset.description}
              onClick={() => handlePresetClick(preset)}
            >
              {preset.id === 'make-deploy' && <Rocket className="!size-3" />}
              {preset.label}
            </Button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void executeOnCompute(cmdInput);
          }}
          className="flex items-center gap-2"
        >
          <div className="flex-1 flex items-center rounded-md border border-border bg-background px-2.5 h-8 font-mono text-xs">
            <span className="text-sky-500 mr-2 select-none">$</span>
            <input
              type="text"
              aria-label="Compute command input"
              data-testid="compute-cmd-input"
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              placeholder="make deploy | make deply | make verify | pnpm exec tsx scripts/..."
              className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <Button
            type="submit"
            size="sm"
            disabled={isRunning || !cmdInput.trim()}
            data-testid="compute-run-btn"
          >
            <Play className="!size-3.5" />
            Run
          </Button>

          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!isRunning}
            data-testid="compute-stop-btn"
            onClick={handleStopCommand}
          >
            <Square className="!size-3.5" />
            Stop
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="compute-clear-btn"
            onClick={() => {
              xtermRef.current?.clear();
              if (!isRunning) writePrompt();
            }}
          >
            <Trash2 className="!size-3.5" />
            Clear
          </Button>
        </form>
      </div>

      {/* Live @xterm/xterm Terminal Canvas */}
      <div className="rounded-lg border border-zinc-800 bg-[#090d16] p-2 shadow-inner">
        <div
          ref={containerRef}
          data-testid="xterm-terminal-container"
          className="w-full h-[500px] overflow-hidden"
        />
      </div>
    </div>
  );
};
