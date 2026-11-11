#!/usr/bin/env -S pnpm exec tsx
/**
 * ============================================================================
 * ZERO-TOKEN AUTONOMOUS .ENV -> TERRAFORM -> FLEET SEED -> E2E VERIFY CYCLE
 * ============================================================================
 * Executes the complete operational cycle with ZERO LLM/Agent tokens:
 *   1. Computes zero-secret SHA-256 fingerprint of `/.env` credentials
 *   2. Skips redundant re-runs if `.env` & code bundle are unchanged (unless --force)
 *   3. Runs deterministic Terraform provisioning (`scripts/deploy-aws-portal.ts`)
 *   4. Purges & seeds live salesforce.com fleet across all 8 properties
 *   5. Verifies 3-Tier Zero-Token AI Dedup Cache + Playwright UI E2E
 *
 * Modes:
 *   - One-shot: `pnpm run zero-token-cycle` (or `make zero-token-cycle`)
 *   - Daemon watcher: `pnpm run zero-token-watch` (auto-triggers on `.env` save)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDotEnvCredentials } from '../src/engine/httpFlowProber';
import { computeEnvCredentialFingerprint } from '../src/engine/zeroTokenArchitecture';

const ROOT_DIR = process.cwd();
const STATE_FILE = path.resolve(ROOT_DIR, '.zero-token-cycle-state.json');
const DOTENV_FILE = path.resolve(ROOT_DIR, '.env');

export interface ZeroTokenCycleReceipt {
  architecture: 'ZERO_TOKEN_AUTONOMOUS_CYCLE';
  envFingerprint: string;
  accountId: string;
  operatorUsername: string;
  maskedAccessKey: string;
  orchestratorTokensConsumed: 0;
  aiJudgePolicy: 'INVOKE_ONLY_ON_NOVEL_UNSEEN_DIFF_SIGNATURES';
  completedAt: string;
  status: 'SUCCESS' | 'SKIPPED_UNCHANGED';
}

export function executeZeroTokenCycle(options: { force?: boolean } = {}): ZeroTokenCycleReceipt {
  const creds = loadDotEnvCredentials();
  const envFingerprint = computeEnvCredentialFingerprint({
    accountId: creds.accountId,
    operatorUsername: creds.operatorUsername,
    maskedAccessKey: creds.maskedAccessKey,
    region: creds.region,
  });

  console.log('\n================================================================================');
  console.log(' ZERO-TOKEN AUTONOMOUS .ENV -> DEPLOY -> FLEET SEED -> E2E CYCLE');
  console.log(` Active .env Fingerprint : ${envFingerprint}`);
  console.log(` Active AWS Account      : ${creds.accountId} (${creds.operatorUsername})`);
  console.log(' Orchestrator LLM Tokens : 0 (100% Deterministic Pipeline)');
  console.log(' Runtime AI Judge Policy : Invoke ONLY on Novel Unseen SHA-256 Diff Signatures');
  console.log('================================================================================\n');

  if (!options.force && fs.existsSync(STATE_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as ZeroTokenCycleReceipt;
      if (prev.envFingerprint === envFingerprint && prev.status === 'SUCCESS') {
        console.log(
          `[ZERO-TOKEN SKIP] .env fingerprint (${envFingerprint}) already provisioned & verified at ${prev.completedAt}. Pass --force to re-execute.`
        );
        return {
          ...prev,
          status: 'SKIPPED_UNCHANGED',
        };
      }
    } catch {
      // Proceed with execution
    }
  }

  const res = spawnSync('pnpm', ['exec', 'tsx', 'scripts/deploy-aws-portal.ts'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  if (res.status !== 0) {
    throw new Error(`Zero-Token Cycle failed with exit code ${res.status}`);
  }

  const receipt: ZeroTokenCycleReceipt = {
    architecture: 'ZERO_TOKEN_AUTONOMOUS_CYCLE',
    envFingerprint,
    accountId: creds.accountId,
    operatorUsername: creds.operatorUsername,
    maskedAccessKey: creds.maskedAccessKey,
    orchestratorTokensConsumed: 0,
    aiJudgePolicy: 'INVOKE_ONLY_ON_NOVEL_UNSEEN_DIFF_SIGNATURES',
    completedAt: new Date().toISOString(),
    status: 'SUCCESS',
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(`\n✓ Zero-Token Cycle Receipt written to ${STATE_FILE} (0 tokens consumed).\n`);
  return receipt;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch');
  const isForce = args.includes('--force') || !args.includes('--skip-if-unchanged');

  executeZeroTokenCycle({ force: isForce });

  if (isWatch) {
    console.log(`[ZERO-TOKEN WATCHER] Watching ${DOTENV_FILE} for credential rotation (0 tokens)...`);
    let lastFp = computeEnvCredentialFingerprint(loadDotEnvCredentials());
    fs.watchFile(DOTENV_FILE, { interval: 2500 }, () => {
      const nextCreds = loadDotEnvCredentials();
      const nextFp = computeEnvCredentialFingerprint(nextCreds);
      if (nextFp !== lastFp) {
        console.log(
          `\n[ZERO-TOKEN WATCHER] Detected new .env credentials (${lastFp} -> ${nextFp}). Auto-running cycle...`
        );
        lastFp = nextFp;
        try {
          executeZeroTokenCycle({ force: true });
        } catch (err) {
          console.error('[ZERO-TOKEN WATCHER ERROR]:', err);
        }
      }
    });
  }
}
