/**
 * ============================================================================
 * SERVER-ONLY COMPUTE BIN SHIM PROVISIONER
 * ============================================================================
 * Ensures `/tmp/bin/make` invokes `pnpm` natively (supporting both `make deploy`
 * and `make deply`), and removes any stale `/tmp/bin/pnpm` shim whenever real
 * `/usr/local/bin/pnpm` is installed on the host.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function hasRealPnpmOutsideTmpBin(): boolean {
  try {
    const cleanPath = (process.env.PATH || '')
      .split(':')
      .filter((p) => p && p !== '/tmp/bin')
      .join(':');
    execSync('command -v pnpm', {
      stdio: 'ignore',
      env: { ...process.env, PATH: cleanPath || '/usr/local/bin:/usr/bin:/bin' },
    });
    return true;
  } catch {
    return fs.existsSync('/usr/local/bin/pnpm');
  }
}

export function ensureComputeBinShims(workspaceRoot: string = process.cwd()): {
  shimDir: string;
  makeReady: boolean;
  pnpmReady: boolean;
} {
  const shimDir = '/tmp/bin';
  try {
    fs.mkdirSync(shimDir, { recursive: true });
    const pnpmShim = path.join(shimDir, 'pnpm');
    const hasRealPnpm = hasRealPnpmOutsideTmpBin();

    if (hasRealPnpm) {
      if (fs.existsSync(pnpmShim)) {
        fs.rmSync(pnpmShim, { force: true });
      }
    } else {
      const shimContent = `#!/usr/bin/env bash
set -e
if [ "$1" = "exec" ]; then
  shift
  CMD="$1"
  shift || true
  if [ -x "${workspaceRoot}/node_modules/.bin/$CMD" ]; then
    exec "${workspaceRoot}/node_modules/.bin/$CMD" "$@"
  else
    exec "$CMD" "$@"
  fi
elif [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  exec "${workspaceRoot}/node_modules/.bin/tsc" --noEmit
elif [ "$1" = "run" ] && [ "$2" = "build" ]; then
  exec "${workspaceRoot}/node_modules/.bin/vite" build
else
  exec "${workspaceRoot}/node_modules/.bin/tsx" "$@"
fi
`;
      if (!fs.existsSync(pnpmShim) || fs.readFileSync(pnpmShim, 'utf8') !== shimContent) {
        fs.writeFileSync(pnpmShim, shimContent, { mode: 0o755 });
        fs.chmodSync(pnpmShim, 0o755);
      }
    }

    const makeShim = path.join(shimDir, 'make');
    const makeShimContent = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
let target = 'deploy-all';
for (const a of args) {
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
    const idx = a.indexOf('=');
    process.env[a.slice(0, idx)] = a.slice(idx + 1);
  } else if (!a.startsWith('-')) {
    target = a;
  }
}
const map = {
  all: ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'deploy-all']],
  deploy: ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'deploy-all']],
  deply: ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'deploy-all']],
  'deploy-all': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'deploy-all']],
  'deploy-cloudfront': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'deploy-all']],
  install: ['pnpm', ['install']],
  build: ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'build']],
  'verify-bundle': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'verify-bundle']],
  'tf-init': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'tf-init']],
  'tf-validate': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'tf-validate']],
  'tf-plan': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'tf-plan']],
  'tf-apply': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'tf-apply']],
  'sync-ui': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'sync-ui']],
  'invalidate-cloudfront': ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'invalidate-cloudfront']],
  'test-e2e': ['pnpm', ['exec', 'tsx', 'scripts/verify-cloudfront-e2e.ts']],
  test: ['pnpm', ['exec', 'tsx', '--test', 'src/engine/rules.test.ts']],
  lint: ['pnpm', ['run', 'lint']],
  'user-list': ['pnpm', ['exec', 'tsx', 'scripts/user-admin-cli.ts', 'list']],
  'user-stats': ['pnpm', ['exec', 'tsx', 'scripts/user-admin-cli.ts', 'stats']],
  'user-audit': ['pnpm', ['exec', 'tsx', 'scripts/user-admin-cli.ts', 'audit']],
};
if (target === 'verify') {
  const steps = [
    ['pnpm', ['exec', 'tsx', '--test', 'src/engine/rules.test.ts']],
    ['pnpm', ['run', 'lint']],
    ['pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts', 'build']],
    ['node', ['--check', 'aws-synthetics/canary-har-runner.js']],
    ['node', ['--check', 'aws-lambda/control-plane-handler.js']],
    ['node', ['--check', 'aws-lambda/adhoc-edge-runner.js']],
  ];
  for (const [cmd, cArgs] of steps) {
    const r = spawnSync(cmd, cArgs, { cwd: '${workspaceRoot}', stdio: 'inherit', env: process.env });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  process.exit(0);
}
if (target === 'help') {
  console.log('Available targets: ' + Object.keys(map).concat(['verify', 'help']).join(', '));
  process.exit(0);
}
const entry = map[target];
if (!entry) {
  console.error('Unknown make target:', target);
  process.exit(2);
}
const res = spawnSync(entry[0], entry[1], { cwd: '${workspaceRoot}', stdio: 'inherit', env: process.env });
process.exit(res.status ?? 0);
`;
    if (!fs.existsSync(makeShim) || fs.readFileSync(makeShim, 'utf8') !== makeShimContent) {
      fs.writeFileSync(makeShim, makeShimContent, { mode: 0o755 });
      fs.chmodSync(makeShim, 0o755);
    }

    return { shimDir, makeReady: true, pnpmReady: true };
  } catch {
    return { shimDir, makeReady: false, pnpmReady: false };
  }
}
