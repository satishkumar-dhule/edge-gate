/**
 * ============================================================================
 * COMPUTE SHELL & MAKEFILE RUNNER ENGINE (PURE LOGIC + SHIM PROVISIONER)
 * ============================================================================
 * Powers the interactive `@xterm/xterm` Compute Terminal so operators can run
 * `make deploy`, `make verify`, `make sync-ui`, `make test-e2e`, Terraform,
 * screenshot capture, and arbitrary shell commands directly on the app's compute.
 * Pure browser + Node isomorphic logic (no Node built-in imports).
 * ============================================================================
 */

export interface MakefileTargetInfo {
  name: string;
  description: string;
}

export interface ComputeCommandPreset {
  id: string;
  label: string;
  command: string;
  description: string;
  category: 'deploy' | 'verify' | 'aws' | 'utility';
}

export interface ComputeHostInfo {
  hostname: string;
  user: string;
  platform: string;
  arch: string;
  release: string;
  cwd: string;
  rootCwd: string;
  shell: string;
  nodeVersion: string;
  cpus: number;
  cpuModel: string;
  totalMemMb: number;
  freeMemMb: number;
  uptimeSec: number;
  pid: number;
  hasMake: boolean;
  hasPnpm: boolean;
  hasTerraform: boolean;
  hasGit: boolean;
  activeSessions: number;
  targets: MakefileTargetInfo[];
}

export interface ComputeShellTab {
  id: string;
  label: string;
  cwd: string;
  output: string;
  running: boolean;
  runningSessionId: string | null;
  pid: number | null;
  lastExitCode: number | null;
  history: string[];
  historyIndex: number;
}

export const COMPUTE_PRESET_COMMANDS: ComputeCommandPreset[] = [
  {
    id: 'compute-uname',
    label: 'Compute Host Info',
    command: 'uname -a && id && node -v',
    description: 'Inspect underlying Linux kernel, user identity, and Node.js runtime',
    category: 'utility',
  },
  {
    id: 'compute-ls',
    label: 'pwd && ls -la',
    command: 'pwd && ls -la',
    description: 'List current working directory and full file permissions on compute',
    category: 'utility',
  },
  {
    id: 'unit-tests',
    label: 'Unit Tests',
    command: 'pnpm test',
    description: 'Execute all node:test unit suites on the compute container',
    category: 'verify',
  },
  {
    id: 'typecheck',
    label: 'Typecheck',
    command: 'pnpm run lint',
    description: 'Run tsc --noEmit across the workspace',
    category: 'verify',
  },
  {
    id: 'mcp-manifest',
    label: 'MCP Discovery',
    command: 'curl -s http://localhost:3000/.well-known/mcp.json | head -c 600',
    description: 'Query local MCP JSON-RPC 2.0 discovery manifest',
    category: 'utility',
  },
  {
    id: 'make-verify',
    label: 'make verify',
    command: 'make verify',
    description: 'Run pnpm unit tests, TypeScript check, SPA build & Lambda syntax checks',
    category: 'verify',
  },
  {
    id: 'make-deploy',
    label: 'make deploy',
    command: 'make deploy',
    description:
      'Run pnpm test + lint + build, terraform apply, S3 sync, print CloudFront URL & E2E verification',
    category: 'deploy',
  },
  {
    id: 'make-help',
    label: 'make help',
    command: 'make help',
    description: 'Display all available Makefile targets and variables',
    category: 'utility',
  },
];

export const COMPUTE_CWD_SENTINEL_PREFIX = '__COMPUTE_CWD__:';
export const COMPUTE_CWD_SENTINEL_SUFFIX = '__';

/**
 * Formats a canonical shell prompt reflecting the active user, hostname, and live working directory.
 */
export function formatComputeShellPrompt(
  user: string,
  hostname: string,
  cwd: string,
  rootCwd?: string
): string {
  const cleanUser = (user || 'operator').trim() || 'operator';
  const cleanHost = (hostname || 'compute').trim() || 'compute';
  const cleanCwd = (cwd || '/app/applet').trim() || '/app/applet';
  let displayPath = cleanCwd;
  if (rootCwd && cleanCwd === rootCwd) {
    displayPath = '~';
  } else if (rootCwd && cleanCwd.startsWith(`${rootCwd}/`)) {
    displayPath = `~/${cleanCwd.slice(rootCwd.length + 1)}`;
  }
  return `${cleanUser}@${cleanHost}:${displayPath}$`;
}

/**
 * Wraps a resolved bash command so that directory changes (`cd ...`) emit a trailing
 * sentinel with the physical working directory while preserving the command's exit code.
 */
export function buildStatefulBashPayload(resolvedCommand: string): string {
  return `${resolvedCommand}\n__COMPUTE_EC=$?\nprintf "\\n${COMPUTE_CWD_SENTINEL_PREFIX}%s${COMPUTE_CWD_SENTINEL_SUFFIX}\\n" "$(pwd -P 2>/dev/null || pwd)"\nexit $__COMPUTE_EC`;
}

/**
 * Extracts and strips any `__COMPUTE_CWD__:<path>__` sentinel from a stdout/stderr chunk.
 */
export function extractStatefulCwdSentinel(chunk: string): {
  cleanedChunk: string;
  detectedCwd: string | null;
} {
  if (!chunk) {
    return { cleanedChunk: '', detectedCwd: null };
  }
  let detectedCwd: string | null = null;
  const regex = /\r?\n?__COMPUTE_CWD__:([^\r\n]+)__\r?\n?/g;
  const cleanedChunk = chunk.replace(regex, (_match, capturedPath: string) => {
    if (capturedPath && capturedPath.trim()) {
      detectedCwd = capturedPath.trim();
    }
    return '\n';
  });
  return { cleanedChunk, detectedCwd };
}

/**
 * Strips ANSI CSI/OSC escape codes from terminal output for clean readable display in DOM views.
 */
export function stripAnsiEscapeCodes(input: string): string {
  if (!input) return '';
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export interface PtySessionDescriptor {
  sessionId: string;
  pid: number | null;
  tty: string;
  cwd: string;
  cols: number;
  rows: number;
  shell: string;
  exited?: boolean;
  exitCode?: number | null;
}

export type PtyBridgeEvent =
  | { type: 'ready'; pid: number; tty: string; cwd: string; cols: number; rows: number }
  | { type: 'data'; b64: string }
  | { type: 'exit'; code: number };

/**
 * Clamps PTY terminal grid dimensions to safe bounds for ioctl(TIOCSWINSZ).
 */
export function clampPtyDimensions(
  cols: unknown,
  rows: unknown
): { cols: number; rows: number } {
  const parsedCols = Number(cols);
  const parsedRows = Number(rows);
  return {
    cols: Number.isFinite(parsedCols) ? Math.max(20, Math.min(400, Math.round(parsedCols))) : 120,
    rows: Number.isFinite(parsedRows) ? Math.max(5, Math.min(200, Math.round(parsedRows))) : 30,
  };
}

/**
 * Parses a single JSON line emitted by scripts/pty-bridge.py.
 */
export function parsePtyBridgeLine(line: string): PtyBridgeEvent | null {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.type === 'ready' && typeof obj.tty === 'string') {
      return {
        type: 'ready',
        pid: typeof obj.pid === 'number' ? obj.pid : 0,
        tty: obj.tty,
        cwd: typeof obj.cwd === 'string' ? obj.cwd : '',
        cols: typeof obj.cols === 'number' ? obj.cols : 120,
        rows: typeof obj.rows === 'number' ? obj.rows : 30,
      };
    }
    if (obj.type === 'data' && typeof obj.b64 === 'string') {
      return { type: 'data', b64: obj.b64 };
    }
    if (obj.type === 'exit') {
      return { type: 'exit', code: typeof obj.code === 'number' ? obj.code : 0 };
    }
  } catch {
    return null;
  }
  return null;
}

const MAKEFILE_TARGET_TRANSLATIONS: Record<string, string> = {
  all: 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all',
  deploy: 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all',
  deply: 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all',
  'deploy-all': 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all',
  'deploy-cloudfront': 'pnpm exec tsx scripts/deploy-aws-portal.ts deploy-all',
  install: 'pnpm install',
  build: 'pnpm exec tsx scripts/deploy-aws-portal.ts build',
  'verify-bundle': 'pnpm exec tsx scripts/deploy-aws-portal.ts verify-bundle',
  test: 'pnpm exec tsx --test src/engine/rules.test.ts',
  lint: 'pnpm run lint',
  verify:
    'pnpm exec tsx --test src/engine/rules.test.ts && pnpm run lint && pnpm exec tsx scripts/deploy-aws-portal.ts build && node --check aws-synthetics/canary-har-runner.js && node --check aws-lambda/control-plane-handler.js && node --check aws-lambda/adhoc-edge-runner.js',
  'tf-init': 'pnpm exec tsx scripts/deploy-aws-portal.ts tf-init',
  'tf-validate': 'pnpm exec tsx scripts/deploy-aws-portal.ts tf-validate',
  'tf-plan': 'pnpm exec tsx scripts/deploy-aws-portal.ts tf-plan',
  'tf-apply': 'pnpm exec tsx scripts/deploy-aws-portal.ts tf-apply',
  'sync-ui': 'pnpm exec tsx scripts/deploy-aws-portal.ts sync-ui',
  'invalidate-cloudfront':
    'pnpm exec tsx scripts/deploy-aws-portal.ts invalidate-cloudfront',
  'test-e2e': 'pnpm exec tsx scripts/verify-cloudfront-e2e.ts',
  'verify-cloudfront': 'pnpm exec tsx scripts/verify-cloudfront-e2e.ts',
  'zero-token-cycle': 'pnpm exec tsx scripts/zero-token-cycle.ts',
  'zero-token-watch': 'pnpm exec tsx scripts/zero-token-cycle.ts --watch',
  'user-list': 'pnpm exec tsx scripts/user-admin-cli.ts list',
  'user-stats': 'pnpm exec tsx scripts/user-admin-cli.ts stats',
  'user-audit': 'pnpm exec tsx scripts/user-admin-cli.ts audit',
};

/**
 * Pure parser that extracts declared targets from a Makefile.
 */
export function parseMakefileTargets(makefileContent: string): MakefileTargetInfo[] {
  const results: MakefileTargetInfo[] = [];
  const seen = new Set<string>();
  const lines = String(makefileContent || '').split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const name = match[1];
    if (seen.has(name) || name.startsWith('.')) continue;
    seen.add(name);

    const prevLine = i > 0 ? lines[i - 1].trim() : '';
    const desc = prevLine.startsWith('#')
      ? prevLine.replace(/^#+\s*/, '')
      : MAKEFILE_TARGET_TRANSLATIONS[name] || 'Makefile target';
    results.push({ name, description: desc });
  }
  return results;
}

/**
 * Extracts a deployed `https://*.cloudfront.net` URL from terminal stdout chunks if present.
 */
export function extractCloudFrontUrlFromOutput(text: string): string | null {
  const match = String(text || '').match(/https:\/\/[a-z0-9-]+\.cloudfront\.net\b/i);
  return match ? match[0] : null;
}

/**
 * Resolves a user-entered shell command for execution on the app's compute.
 * Translates `make <target> [VAR=val]` (including `make deploy` and `make deply`)
 * into native `pnpm` invocations when GNU `make` is absent, and falls back to
 * `./node_modules/.bin/*` only when global `pnpm` is unavailable.
 */
export function resolveComputeCommand(
  rawCommand: string,
  options: { hasMake?: boolean; hasPnpm?: boolean } = {}
): {
  resolvedCommand: string;
  wasTranslated: boolean;
  empty: boolean;
} {
  const trimmed = String(rawCommand || '').trim();
  if (!trimmed) {
    return { resolvedCommand: '', wasTranslated: false, empty: true };
  }

  const hasPnpm = options.hasPnpm !== false;
  const fallbackNoPnpm = (cmd: string): string => {
    if (hasPnpm) return cmd;
    return cmd
      .replace(/\bpnpm exec\s+/g, './node_modules/.bin/')
      .replace(/\bpnpm run lint\b/g, './node_modules/.bin/tsc --noEmit')
      .replace(/\bpnpm run build\b/g, './node_modules/.bin/vite build');
  };

  // Handle plain `make` or `make <target> [VAR=VAL ...]` when GNU make isn't installed
  if (!options.hasMake && /^make(\s|$)/.test(trimmed)) {
    const tokens =
      trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const rest = tokens.slice(1);
    const envAssigns: string[] = [];
    let target = 'all';

    for (const tok of rest) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
        envAssigns.push(tok);
      } else if (!tok.startsWith('-')) {
        target = tok;
      }
    }

    const prefix = envAssigns.length > 0 ? `${envAssigns.join(' ')} ` : '';

    if (target === 'help') {
      return {
        resolvedCommand: `awk '/^help:/{flag=1;next}/^[a-zA-Z0-9_-]+:|^# ---/{flag=0}flag' Makefile | sed 's/^\\t@echo //' | sed 's/^"//;s/"$//'`,
        wasTranslated: true,
        empty: false,
      };
    }

    if (target === 'run-adhoc') {
      const base = fallbackNoPnpm(
        `pnpm exec tsx scripts/user-admin-cli.ts run-adhoc --target="\${TARGET:-www.prod.staging}" --by="\${BY:-operator@salesforce.com}"`
      );
      return {
        resolvedCommand: `${prefix}${base}`,
        wasTranslated: true,
        empty: false,
      };
    }

    if (target === 'compare') {
      const base = fallbackNoPnpm(
        `pnpm exec tsx scripts/user-admin-cli.ts compare --candidate="\${CANDIDATE:-www.prod.staging}" --baseline="\${BASELINE:-www.prod.prod}" --by="\${BY:-operator@salesforce.com}"`
      );
      return {
        resolvedCommand: `${prefix}${base}`,
        wasTranslated: true,
        empty: false,
      };
    }

    if (target === 'user-add') {
      const base = fallbackNoPnpm(
        `pnpm exec tsx scripts/user-admin-cli.ts add --email="\${EMAIL}" --password="\${PASSWORD}" --name="\${NAME}" --role="\${ROLE}" --account="\${ACCOUNT}" --by="\${BY}"`
      );
      return {
        resolvedCommand: `${prefix}${base}`,
        wasTranslated: true,
        empty: false,
      };
    }

    const direct = MAKEFILE_TARGET_TRANSLATIONS[target];
    if (direct) {
      return {
        resolvedCommand: `${prefix}${fallbackNoPnpm(direct)}`,
        wasTranslated: true,
        empty: false,
      };
    }
  }

  // Handle `pnpm exec ...` / `pnpm run ...` only when global `pnpm` is genuinely missing
  if (options.hasPnpm === false) {
    if (trimmed.startsWith('pnpm exec ')) {
      return {
        resolvedCommand: `./node_modules/.bin/${trimmed.slice('pnpm exec '.length)}`,
        wasTranslated: true,
        empty: false,
      };
    }
    if (trimmed === 'pnpm run lint') {
      return {
        resolvedCommand: './node_modules/.bin/tsc --noEmit',
        wasTranslated: true,
        empty: false,
      };
    }
    if (trimmed === 'pnpm run build') {
      return {
        resolvedCommand: './node_modules/.bin/vite build',
        wasTranslated: true,
        empty: false,
      };
    }
  }

  return {
    resolvedCommand: trimmed,
    wasTranslated: false,
    empty: false,
  };
}
