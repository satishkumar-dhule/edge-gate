#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * CLI TOOL: USER ADMINISTRATION, PASSWORD RESET, TRACKING & AD-HOC RUNNER
 * ============================================================================
 * Headless CLI (no UI screens) invoked by `Makefile` targets:
 *   - `make user-list`
 *   - `make user-add EMAIL=... NAME="..." ROLE="..." PASSWORD=...`
 *   - `make user-reset-password EMAIL=... NEW_PASSWORD=...`
 *   - `make user-disable EMAIL=...`
 *   - `make user-enable EMAIL=...`
 *   - `make user-delete EMAIL=...`
 *   - `make user-auth EMAIL=... PASSWORD=...`
 *   - `make user-stats [EMAIL=...]`
 *   - `make user-audit [EMAIL=...]`
 *   - `make run-adhoc TARGET=www.prod.staging BY=ops@company.com`
 *   - `make compare CANDIDATE=www.prod.staging BASELINE=www.prod.prod BY=ops@company.com`
 * ============================================================================
 */

import { defaultUserManager, UserActionType, UserStatus } from '../src/engine/userManager';
import { DEFAULT_TEMPLATE_CONFIG } from '../src/config/template.config';
import {
  INITIAL_RUNS,
  buildInitialComparison,
  generateTestResults,
} from '../src/data/mockStore';

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = 'true';
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0] || 'help', positional, flags };
}

function pad(str: string, width: number): string {
  const s = String(str ?? '');
  return s.length >= width ? s.slice(0, width - 1) + '…' : s.padEnd(width, ' ');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const jsonOutput = flags.json === 'true';

  try {
    if (command === 'list') {
      const users = defaultUserManager.listUsers();
      if (jsonOutput) {
        console.log(JSON.stringify({ total: users.length, users }, null, 2));
        return;
      }
      console.log(
        '\n========================================================================================================='
      );
      console.log(
        ` AKAMAI SYNTHETIC RELEASE GATE — REGISTERED OPERATORS (${users.length} users)`
      );
      console.log(
        '========================================================================================================='
      );
      console.log(
        `${pad('EMAIL', 30)} ${pad('ROLE', 28)} ${pad('STATUS', 10)} ${pad(
          'RUNS',
          7
        )} ${pad('COMPS', 7)} ${pad('RESETS', 7)} ${pad('LAST ACTIVE', 22)}`
      );
      console.log(
        '---------------------------------------------------------------------------------------------------------'
      );
      for (const u of users) {
        console.log(
          `${pad(u.email, 30)} ${pad(u.role, 28)} ${pad(
            u.status.toUpperCase(),
            10
          )} ${pad(String(u.stats.runsTriggered), 7)} ${pad(
            String(u.stats.comparisonsEvaluated),
            7
          )} ${pad(String(u.stats.passwordResetCount), 7)} ${pad(
            u.stats.lastActiveAt || 'never',
            22
          )}`
        );
      }
      console.log(
        '=========================================================================================================\n'
      );
      return;
    }

    if (command === 'add') {
      const email = flags.email || process.env.EMAIL || '';
      const password = flags.password || process.env.PASSWORD || '';
      const name = flags.name || process.env.NAME;
      const role = flags.role || process.env.ROLE || 'Edge Release Engineer';
      const account =
        flags.account ||
        process.env.ACCOUNT ||
        DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.account;

      if (!email || !password) {
        console.error(
          'Usage: make user-add EMAIL=user@company.com PASSWORD=SecretPass#123 [NAME="Jane Doe"] [ROLE="Staff SRE"]'
        );
        process.exit(1);
      }

      const created = defaultUserManager.createUser({
        email,
        name,
        role,
        account,
        password,
        actor: flags.by || process.env.BY || 'cli-admin',
        source: 'cli',
      });

      if (jsonOutput) {
        console.log(JSON.stringify({ status: 'CREATED', user: created }, null, 2));
      } else {
        console.log(`\n[OK] User created successfully via CLI:`);
        console.log(`  User ID : ${created.userId}`);
        console.log(`  Email   : ${created.email}`);
        console.log(`  Name    : ${created.name}`);
        console.log(`  Role    : ${created.role}`);
        console.log(`  Account : ${created.account}`);
        console.log(`  Status  : ${created.status}\n`);
      }
      return;
    }

    if (command === 'reset-password') {
      const email = flags.email || process.env.EMAIL || '';
      const newPassword =
        flags['new-password'] ||
        flags.password ||
        process.env.NEW_PASSWORD ||
        process.env.PASSWORD ||
        '';

      if (!email || !newPassword) {
        console.error(
          'Usage: make user-reset-password EMAIL=user@company.com NEW_PASSWORD=NewStrongPass#2026'
        );
        process.exit(1);
      }

      const res = defaultUserManager.resetPassword({
        email,
        newPassword,
        mustChangePassword: flags['must-change'] === 'true',
        actor: flags.by || process.env.BY || 'cli-admin',
        source: 'cli',
      });

      if (jsonOutput) {
        console.log(JSON.stringify({ status: 'PASSWORD_RESET', ...res }, null, 2));
      } else {
        console.log(`\n[OK] Password reset completed for ${res.user.email}:`);
        console.log(`  Updated At          : ${res.resetTimestamp}`);
        console.log(`  Password Reset Count: ${res.passwordResetCount}`);
        console.log(`  Account Status      : ${res.user.status}\n`);
      }
      return;
    }

    if (command === 'status') {
      const email = flags.email || process.env.EMAIL || '';
      const status = (flags.status || process.env.STATUS || 'active') as UserStatus;
      const role = flags.role || process.env.ROLE;

      if (!email) {
        console.error(
          'Usage: make user-disable EMAIL=user@company.com  OR  make user-enable EMAIL=user@company.com'
        );
        process.exit(1);
      }

      const updated = defaultUserManager.updateUserStatusOrRole({
        email,
        status,
        role,
        actor: flags.by || process.env.BY || 'cli-admin',
        source: 'cli',
      });

      console.log(
        `\n[OK] Updated user ${updated.email} -> status=${updated.status}, role="${updated.role}"\n`
      );
      return;
    }

    if (command === 'delete') {
      const email = flags.email || process.env.EMAIL || '';
      if (!email) {
        console.error('Usage: make user-delete EMAIL=user@company.com');
        process.exit(1);
      }
      const deleted = defaultUserManager.deleteUser(email, 'cli-admin', 'cli');
      if (!deleted) {
        console.error(`[ERROR] User "${email}" not found.`);
        process.exit(1);
      }
      console.log(`\n[OK] Deleted user ${email}\n`);
      return;
    }

    if (command === 'auth') {
      const email = flags.email || process.env.EMAIL || '';
      const password = flags.password || process.env.PASSWORD || '';
      if (!email || !password) {
        console.error(
          'Usage: make user-auth EMAIL=user@company.com PASSWORD=SecretPass#123'
        );
        process.exit(1);
      }
      const res = defaultUserManager.authenticateUser({
        email,
        password,
        source: 'cli',
      });
      if (!res.authenticated || !res.user) {
        console.error(
          `\n[AUTH FAILED] ${email}: ${res.reason || 'INVALID_CREDENTIALS'}\n`
        );
        process.exit(1);
      }
      console.log(`\n[AUTH OK] Authenticated ${res.user.email} (${res.user.role})`);
      console.log(`  Session Token : ${res.sessionToken}`);
      console.log(`  Total Logins  : ${res.user.stats.loginCount}\n`);
      return;
    }

    if (command === 'track') {
      const email =
        flags.email ||
        process.env.EMAIL ||
        DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email;
      const action = (flags.action ||
        process.env.ACTION ||
        'CLI_COMMAND_EXECUTED') as UserActionType;
      const target = flags.target || process.env.TARGET || 'www.prod.staging';

      const user = defaultUserManager.trackUserAction({
        email,
        action,
        target,
        source: 'cli',
      });
      console.log(
        `\n[TRACKED] ${user.email} -> ${action} on ${target} (runs=${user.stats.runsTriggered}, comps=${user.stats.comparisonsEvaluated})\n`
      );
      return;
    }

    if (command === 'stats' || command === 'audit') {
      const emailFilter = flags.email || process.env.EMAIL;
      const summary = defaultUserManager.getStatsSummary(emailFilter);
      if (jsonOutput) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(
        '\n========================================================================================================='
      );
      console.log(
        ' AKAMAI SYNTHETIC RELEASE GATE — USER ACTIVITY TRACKING & TELEMETRY STATS'
      );
      console.log(
        '========================================================================================================='
      );
      console.log(
        ` Total Users: ${summary.totalUsers} (Active: ${summary.activeUsers}, Disabled: ${summary.disabledUsers})`
      );
      console.log(
        ` Total Runs Triggered: ${summary.totalRunsTriggeredAcrossUsers} | Comparisons: ${summary.totalComparisonsAcrossUsers} | Bedrock Nova Lite Calls: ${summary.totalVisualJudgeCallsAcrossUsers} | MCP Calls: ${summary.totalMcpCallsAcrossUsers} | Password Resets: ${summary.totalPasswordResetsAcrossUsers}`
      );
      console.log(
        '---------------------------------------------------------------------------------------------------------'
      );
      console.log(
        `${pad('EMAIL', 28)} ${pad('RUNS', 6)} ${pad('COMPS', 6)} ${pad(
          'NOVA_AI',
          8
        )} ${pad('MCP', 6)} ${pad('CLI', 6)} ${pad('LOGINS', 7)} ${pad(
          'RESETS',
          7
        )} ${pad('LAST TARGET', 20)}`
      );
      console.log(
        '---------------------------------------------------------------------------------------------------------'
      );
      for (const u of summary.users) {
        console.log(
          `${pad(u.email, 28)} ${pad(String(u.stats.runsTriggered), 6)} ${pad(
            String(u.stats.comparisonsEvaluated),
            6
          )} ${pad(String(u.stats.visualJudgeInvocations), 8)} ${pad(
            String(u.stats.mcpToolCalls),
            6
          )} ${pad(String(u.stats.cliCommandsRun), 6)} ${pad(
            String(u.stats.loginCount),
            7
          )} ${pad(String(u.stats.passwordResetCount), 7)} ${pad(
            u.stats.lastTargetEvaluated || '-',
            20
          )}`
        );
      }

      console.log(
        '\n---------------------------------------------------------------------------------------------------------'
      );
      console.log(
        ` RECENT AUDIT TRAIL (${Math.min(12, summary.recentAuditEvents.length)} of ${
          summary.totalAuditEvents
        } events)`
      );
      console.log(
        '---------------------------------------------------------------------------------------------------------'
      );
      for (const evt of summary.recentAuditEvents.slice(0, 12)) {
        console.log(
          ` [${evt.timestamp}] ${pad(evt.email, 26)} ${pad(
            evt.action,
            25
          )} (${evt.source}) ${evt.target ? `-> ${evt.target}` : ''}`
        );
      }
      console.log(
        '=========================================================================================================\n'
      );
      return;
    }

    if (command === 'run-adhoc') {
      const targetId =
        flags.target || process.env.TARGET || 'www.prod.staging';
      const by =
        flags.by ||
        process.env.BY ||
        DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email;

      const results = generateTestResults(
        targetId,
        'new_run',
        DEFAULT_TEMPLATE_CONFIG.testSuite
      );
      const passed = results.filter((r) => r.pass).length;
      const user = defaultUserManager.trackUserAction({
        email: by,
        action: 'SYNTHETIC_RUN_TRIGGERED',
        target: targetId,
        source: 'cli',
        metadata: { passed, total: results.length },
      });

      console.log(
        `\n[AD-HOC LAMBDA SYNTHETIC RUN COMPLETED] Target: ${targetId}`
      );
      console.log(
        `  Operator       : ${user.email} (Total Runs Triggered: ${user.stats.runsTriggered})`
      );
      console.log(
        `  Compute Engine : AWS Lambda Ad-Hoc Scale-to-Zero ($0/idle)`
      );
      console.log(`  Pass Rate      : ${passed}/${results.length} checks passed\n`);
      return;
    }

    if (command === 'compare') {
      const candidateTarget =
        flags.candidate || process.env.CANDIDATE || 'www.prod.staging';
      const baselineTarget =
        flags.baseline || process.env.BASELINE || 'www.prod.prod';
      const by =
        flags.by ||
        process.env.BY ||
        DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email;

      const candRun =
        INITIAL_RUNS.find((r) => r.target === candidateTarget) ||
        INITIAL_RUNS[0];
      const baseRun =
        INITIAL_RUNS.find((r) => r.target === baselineTarget) ||
        INITIAL_RUNS[1];
      const comp = buildInitialComparison(
        candRun,
        baseRun,
        candRun.envId === baseRun.envId ? 'network' : 'env'
      );

      const user = defaultUserManager.trackUserAction({
        email: by,
        action: 'COMPARISON_EVALUATED',
        target: `${candidateTarget} vs ${baselineTarget}`,
        source: 'cli',
        metadata: {
          verdict: comp.headlineVerdict,
          functionalDiffs: comp.rollup.functional,
        },
      });

      console.log(
        `\n[3-DIMENSION RELEASE GATE COMPARISON] ${candidateTarget} vs ${baselineTarget}`
      );
      console.log(`  Headline Verdict : ${comp.headlineVerdict}`);
      console.log(
        `  Rollup           : ${comp.rollup.functional} functional diffs | ${comp.rollup.visual} visual diffs | ${comp.rollup.minor} minor`
      );
      console.log(
        `  Tracked Operator : ${user.email} (Total Comparisons: ${user.stats.comparisonsEvaluated})\n`
      );
      return;
    }

    console.log(`
Akamai Synthetic Release Gate — Headless User & Operations CLI
Commands:
  list                                  List all users and summary counters
  add --email=... --password=...        Create a new user
  reset-password --email=... --new-password=...  Reset a user's password
  status --email=... --status=active|disabled    Enable or disable a user
  delete --email=...                    Delete a user
  auth --email=... --password=...       Verify user credentials and record login
  stats [--email=...]                   Display user tracking & activity telemetry
  audit [--email=...]                   Display user audit trail
  run-adhoc --target=www.prod.staging   Trigger an ad-hoc synthetic run & track user
  compare --candidate=... --baseline=...Run 3-dimension release gate comparison & track user
`);
  } catch (err) {
    console.error(`\n[CLI ERROR] ${(err as Error).message}\n`);
    process.exit(1);
  }
}

main();
