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

export const COMPUTE_PRESET_COMMANDS: ComputeCommandPreset[] = [
  {
    id: 'make-deploy',
    label: 'make deploy',
    command: 'make deploy',
    description:
      'Run pnpm test + lint + build, terraform apply, S3 sync, print CloudFront URL & E2E verification',
    category: 'deploy',
  },
  {
    id: 'make-verify',
    label: 'make verify',
    command: 'make verify',
    description: 'Run pnpm unit tests, TypeScript check, SPA build & Lambda syntax checks',
    category: 'verify',
  },
  {
    id: 'make-sync-ui',
    label: 'make sync-ui',
    command: 'make sync-ui',
    description: 'Build dist/ SPA bundle, upload to S3 /portal-ui/ & invalidate CloudFront',
    category: 'aws',
  },
  {
    id: 'make-invalidate',
    label: 'make invalidate-cloudfront',
    command: 'make invalidate-cloudfront',
    description: 'Create CloudFront /* cache invalidation via AWS SigV4',
    category: 'aws',
  },
  {
    id: 'make-test-e2e',
    label: 'make test-e2e',
    command: 'make test-e2e',
    description: 'Run Playwright E2E suite against CloudFront / localhost:3000',
    category: 'verify',
  },
  {
    id: 'capture-screenshots',
    label: 'Capture Live Screenshots',
    command: 'pnpm exec tsx scripts/capture-live-screenshots.ts www',
    description: 'Capture genuine unmodified 1280x760 Chromium screenshots for www',
    category: 'utility',
  },
  {
    id: 'make-help',
    label: 'make help',
    command: 'make help',
    description: 'Display all available Makefile targets and variables',
    category: 'utility',
  },
];

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
