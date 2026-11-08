/**
 * ============================================================================
 * DEEP MODULE: CLI & API USER MANAGEMENT, PASSWORD RESET & ACTIVITY TRACKING
 * ============================================================================
 * Headless (API + CLI + Makefile only, zero UI screens) operator management,
 * salted SHA-256 / PBKDF2 password hashing, password reset lifecycle, and
 * per-user synthetic execution & release gate telemetry tracking.
 *
 * Storage:
 * - In AWS Production: DynamoDB (`__USER__` and `__USER_AUDIT__` partitions in
 *   `AkamaiReleaseGateRuns` table with `PAY_PER_REQUEST` $0/idle billing).
 * - In Local Server / CLI: Synchronized with `.data/users-store.json` so
 *   `make user-add`, `make user-reset-password`, `make user-stats`, and REST
 *   endpoints (`/api/v1/users/*`) share state immediately.
 * ============================================================================
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_TEMPLATE_CONFIG } from '../config/template.config';

export type UserStatus = 'active' | 'disabled' | 'locked';

export type UserActionType =
  | 'USER_CREATED'
  | 'PASSWORD_RESET'
  | 'USER_LOGIN'
  | 'USER_LOGIN_FAILED'
  | 'USER_STATUS_CHANGED'
  | 'SYNTHETIC_RUN_TRIGGERED'
  | 'COMPARISON_EVALUATED'
  | 'VISUAL_JUDGE_INVOKED'
  | 'MCP_TOOL_INVOKED'
  | 'CLI_COMMAND_EXECUTED';

export interface UserActivityMetrics {
  runsTriggered: number;
  comparisonsEvaluated: number;
  visualJudgeInvocations: number;
  mcpToolCalls: number;
  cliCommandsRun: number;
  loginCount: number;
  failedLoginCount: number;
  passwordResetCount: number;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
  lastTargetEvaluated: string | null;
}

export interface UserRecord {
  userId: string;
  email: string;
  name: string;
  role: string;
  account: string;
  status: UserStatus;
  passwordHash: string;
  passwordSalt: string;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
  stats: UserActivityMetrics;
}

export interface PublicUserView {
  userId: string;
  email: string;
  name: string;
  role: string;
  account: string;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
  stats: UserActivityMetrics;
}

export interface UserAuditEvent {
  eventId: string;
  timestamp: string;
  email: string;
  action: UserActionType;
  target?: string;
  actor: string;
  source: 'cli' | 'rest-api' | 'lambda' | 'mcp';
  metadata?: Record<string, string | number | boolean>;
}

export interface UserStatsSummary {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  totalRunsTriggeredAcrossUsers: number;
  totalComparisonsAcrossUsers: number;
  totalVisualJudgeCallsAcrossUsers: number;
  totalMcpCallsAcrossUsers: number;
  totalPasswordResetsAcrossUsers: number;
  totalAuditEvents: number;
  users: PublicUserView[];
  recentAuditEvents: UserAuditEvent[];
}

export interface UserStoreState {
  users: Record<string, UserRecord>;
  auditEvents: UserAuditEvent[];
}

const DEFAULT_STORE_FILE = path.resolve(process.cwd(), '.data', 'users-store.json');

/**
 * Pure PBKDF2-HMAC-SHA256 password hash generator (never stores plaintext passwords).
 */
export function hashUserPassword(
  password: string,
  existingSalt?: string
): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 32, 'sha256')
    .toString('hex');
  return { salt, hash };
}

/**
 * Constant-time password verification against a stored salt and PBKDF2 hash.
 */
export function verifyUserPassword(
  password: string,
  salt: string,
  expectedHash: string
): boolean {
  const { hash } = hashUserPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Strips sensitive `passwordHash` and `passwordSalt` fields before returning user objects
 * over REST APIs, MCP responses, or CLI outputs.
 */
export function toPublicUserView(user: UserRecord): PublicUserView {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    account: user.account,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordUpdatedAt: user.passwordUpdatedAt,
    stats: { ...user.stats },
  };
}

/**
 * Creates the initial seeded user store with default enterprise operators.
 */
export function createInitialUserStore(): UserStoreState {
  const op = DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator;
  const primaryPass = hashUserPassword('AkamaiGate#2026!');
  const srePass = hashUserPassword('EdgeSRE#2026!');
  const releaseMgrPass = hashUserPassword('ReleaseMgr#2026!');

  const now = '2026-11-08T04:00:00.000Z';

  const users: Record<string, UserRecord> = {
    [op.email.toLowerCase()]: {
      userId: 'usr-01-principal',
      email: op.email.toLowerCase(),
      name: 'Principal Edge Architect',
      role: op.role,
      account: op.account,
      status: 'active',
      passwordHash: primaryPass.hash,
      passwordSalt: primaryPass.salt,
      mustChangePassword: false,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: now,
      passwordUpdatedAt: '2026-10-15T10:00:00.000Z',
      stats: {
        runsTriggered: 18,
        comparisonsEvaluated: 24,
        visualJudgeInvocations: 9,
        mcpToolCalls: 14,
        cliCommandsRun: 11,
        loginCount: 32,
        failedLoginCount: 0,
        passwordResetCount: 1,
        lastActiveAt: now,
        lastLoginAt: now,
        lastTargetEvaluated: 'www.prod.staging',
      },
    },
    'sre-oncall@company.com': {
      userId: 'usr-02-sre-oncall',
      email: 'sre-oncall@company.com',
      name: 'Edge SRE On-Call',
      role: 'Staff Edge Reliability Engineer',
      account: op.account,
      status: 'active',
      passwordHash: srePass.hash,
      passwordSalt: srePass.salt,
      mustChangePassword: false,
      createdAt: '2026-10-05T09:30:00.000Z',
      updatedAt: now,
      passwordUpdatedAt: '2026-10-05T09:30:00.000Z',
      stats: {
        runsTriggered: 12,
        comparisonsEvaluated: 15,
        visualJudgeInvocations: 4,
        mcpToolCalls: 6,
        cliCommandsRun: 19,
        loginCount: 14,
        failedLoginCount: 1,
        passwordResetCount: 0,
        lastActiveAt: '2026-11-08T03:45:00.000Z',
        lastLoginAt: '2026-11-08T02:10:00.000Z',
        lastTargetEvaluated: 'checkout.prod.staging',
      },
    },
    'release-bot@company.com': {
      userId: 'usr-03-cicd-bot',
      email: 'release-bot@company.com',
      name: 'GitHub Actions / Terraform Release Bot',
      role: 'Automated CI/CD Service Account',
      account: op.account,
      status: 'active',
      passwordHash: releaseMgrPass.hash,
      passwordSalt: releaseMgrPass.salt,
      mustChangePassword: false,
      createdAt: '2026-10-10T12:00:00.000Z',
      updatedAt: now,
      passwordUpdatedAt: '2026-10-10T12:00:00.000Z',
      stats: {
        runsTriggered: 42,
        comparisonsEvaluated: 42,
        visualJudgeInvocations: 12,
        mcpToolCalls: 30,
        cliCommandsRun: 42,
        loginCount: 42,
        failedLoginCount: 0,
        passwordResetCount: 0,
        lastActiveAt: '2026-11-08T04:15:00.000Z',
        lastLoginAt: '2026-11-08T04:15:00.000Z',
        lastTargetEvaluated: 'api.prod.staging',
      },
    },
  };

  const auditEvents: UserAuditEvent[] = [
    {
      eventId: 'evt-init-1',
      timestamp: '2026-11-08T04:15:00.000Z',
      email: 'release-bot@company.com',
      action: 'SYNTHETIC_RUN_TRIGGERED',
      target: 'api.prod.staging',
      actor: 'release-bot@company.com',
      source: 'cli',
      metadata: { engine: 'aws-lambda-adhoc', passRatePct: 100 },
    },
    {
      eventId: 'evt-init-2',
      timestamp: '2026-11-08T04:00:00.000Z',
      email: op.email.toLowerCase(),
      action: 'COMPARISON_EVALUATED',
      target: 'www.prod.staging vs www.prod.prod',
      actor: op.email.toLowerCase(),
      source: 'rest-api',
      metadata: { verdict: 'NO-GO', functionalDiffs: 2 },
    },
    {
      eventId: 'evt-init-3',
      timestamp: '2026-11-08T03:45:00.000Z',
      email: 'sre-oncall@company.com',
      action: 'VISUAL_JUDGE_INVOKED',
      target: 'T03 (www.prod.staging)',
      actor: 'sre-oncall@company.com',
      source: 'mcp',
      metadata: { model: 'amazon.nova-lite-v1:0', pixelDiffPct: 1.8 },
    },
  ];

  return { users, auditEvents };
}

export class UserManager {
  private state: UserStoreState;
  private storeFilePath: string | null;

  constructor(options?: { persistToFile?: boolean; customFilePath?: string }) {
    const shouldPersist = options?.persistToFile ?? true;
    this.storeFilePath = shouldPersist
      ? options?.customFilePath || DEFAULT_STORE_FILE
      : null;
    this.state = this.loadState();
  }

  private loadState(): UserStoreState {
    if (this.storeFilePath && fs.existsSync(this.storeFilePath)) {
      try {
        const raw = fs.readFileSync(this.storeFilePath, 'utf8');
        const parsed = JSON.parse(raw) as UserStoreState;
        if (parsed && parsed.users && parsed.auditEvents) {
          return parsed;
        }
      } catch {
        // Fallback to seeded state
      }
    }
    const initial = createInitialUserStore();
    this.saveState(initial);
    return initial;
  }

  private saveState(nextState: UserStoreState = this.state): void {
    this.state = nextState;
    if (!this.storeFilePath) return;
    try {
      const dir = path.dirname(this.storeFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.storeFilePath,
        JSON.stringify(this.state, null, 2),
        'utf8'
      );
    } catch {
      // Non-fatal in read-only environments
    }
  }

  public reloadFromDisk(): void {
    if (!this.storeFilePath) return;
    this.state = this.loadState();
  }

  public listUsers(): PublicUserView[] {
    this.reloadFromDisk();
    return Object.values(this.state.users)
      .sort((a, b) => a.email.localeCompare(b.email))
      .map(toPublicUserView);
  }

  public getUser(email: string): PublicUserView | null {
    this.reloadFromDisk();
    const key = email.trim().toLowerCase();
    const found = this.state.users[key];
    return found ? toPublicUserView(found) : null;
  }

  public createUser(input: {
    email: string;
    name?: string;
    role?: string;
    account?: string;
    password: string;
    mustChangePassword?: boolean;
    actor?: string;
    source?: UserAuditEvent['source'];
  }): PublicUserView {
    this.reloadFromDisk();
    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new Error(`Invalid email address: "${input.email}"`);
    }
    if (!input.password || input.password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    if (this.state.users[normalizedEmail]) {
      throw new Error(`User "${normalizedEmail}" already exists.`);
    }

    const { salt, hash } = hashUserPassword(input.password);
    const now = new Date().toISOString();
    const userId = `usr-${crypto.randomBytes(4).toString('hex')}`;

    const newUser: UserRecord = {
      userId,
      email: normalizedEmail,
      name:
        input.name?.trim() ||
        normalizedEmail
          .split('@')[0]
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase()),
      role: input.role?.trim() || 'Edge Release Engineer',
      account:
        input.account?.trim() ||
        DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.account,
      status: 'active',
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: input.mustChangePassword ?? false,
      createdAt: now,
      updatedAt: now,
      passwordUpdatedAt: now,
      stats: {
        runsTriggered: 0,
        comparisonsEvaluated: 0,
        visualJudgeInvocations: 0,
        mcpToolCalls: 0,
        cliCommandsRun: 0,
        loginCount: 0,
        failedLoginCount: 0,
        passwordResetCount: 0,
        lastActiveAt: now,
        lastLoginAt: null,
        lastTargetEvaluated: null,
      },
    };

    this.state.users[normalizedEmail] = newUser;
    this.appendAudit({
      email: normalizedEmail,
      action: 'USER_CREATED',
      actor: input.actor || 'cli-admin',
      source: input.source || 'cli',
      metadata: { role: newUser.role, account: newUser.account },
    });
    this.saveState();
    return toPublicUserView(newUser);
  }

  public resetPassword(input: {
    email: string;
    newPassword: string;
    mustChangePassword?: boolean;
    actor?: string;
    source?: UserAuditEvent['source'];
  }): {
    user: PublicUserView;
    resetTimestamp: string;
    passwordResetCount: number;
  } {
    this.reloadFromDisk();
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = this.state.users[normalizedEmail];
    if (!user) {
      throw new Error(`User "${normalizedEmail}" not found.`);
    }
    if (!input.newPassword || input.newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }

    const { salt, hash } = hashUserPassword(input.newPassword);
    const now = new Date().toISOString();

    user.passwordSalt = salt;
    user.passwordHash = hash;
    user.passwordUpdatedAt = now;
    user.updatedAt = now;
    user.mustChangePassword = input.mustChangePassword ?? false;
    user.status = 'active';
    user.stats.passwordResetCount += 1;
    user.stats.lastActiveAt = now;

    this.appendAudit({
      email: normalizedEmail,
      action: 'PASSWORD_RESET',
      actor: input.actor || 'cli-admin',
      source: input.source || 'cli',
      metadata: {
        passwordResetCount: user.stats.passwordResetCount,
        mustChangePassword: user.mustChangePassword,
      },
    });
    this.saveState();

    return {
      user: toPublicUserView(user),
      resetTimestamp: now,
      passwordResetCount: user.stats.passwordResetCount,
    };
  }

  public updateUserStatusOrRole(input: {
    email: string;
    status?: UserStatus;
    role?: string;
    actor?: string;
    source?: UserAuditEvent['source'];
  }): PublicUserView {
    this.reloadFromDisk();
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = this.state.users[normalizedEmail];
    if (!user) {
      throw new Error(`User "${normalizedEmail}" not found.`);
    }
    const now = new Date().toISOString();
    if (input.status) {
      user.status = input.status;
    }
    if (input.role) {
      user.role = input.role;
    }
    user.updatedAt = now;

    this.appendAudit({
      email: normalizedEmail,
      action: 'USER_STATUS_CHANGED',
      actor: input.actor || 'cli-admin',
      source: input.source || 'cli',
      metadata: { status: user.status, role: user.role },
    });
    this.saveState();
    return toPublicUserView(user);
  }

  public deleteUser(
    email: string,
    actor = 'cli-admin',
    source: UserAuditEvent['source'] = 'cli'
  ): boolean {
    this.reloadFromDisk();
    const normalizedEmail = email.trim().toLowerCase();
    if (!this.state.users[normalizedEmail]) {
      return false;
    }
    delete this.state.users[normalizedEmail];
    this.appendAudit({
      email: normalizedEmail,
      action: 'USER_STATUS_CHANGED',
      actor,
      source,
      metadata: { deleted: true },
    });
    this.saveState();
    return true;
  }

  public authenticateUser(input: {
    email: string;
    password: string;
    source?: UserAuditEvent['source'];
  }): {
    authenticated: boolean;
    reason?: string;
    sessionToken?: string;
    user?: PublicUserView;
  } {
    this.reloadFromDisk();
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = this.state.users[normalizedEmail];
    const now = new Date().toISOString();

    if (!user) {
      return { authenticated: false, reason: 'USER_NOT_FOUND' };
    }
    if (user.status !== 'active') {
      return { authenticated: false, reason: `USER_${user.status.toUpperCase()}` };
    }

    const valid = verifyUserPassword(
      input.password,
      user.passwordSalt,
      user.passwordHash
    );
    if (!valid) {
      user.stats.failedLoginCount += 1;
      user.updatedAt = now;
      this.appendAudit({
        email: normalizedEmail,
        action: 'USER_LOGIN_FAILED',
        actor: normalizedEmail,
        source: input.source || 'cli',
        metadata: { failedLoginCount: user.stats.failedLoginCount },
      });
      this.saveState();
      return { authenticated: false, reason: 'INVALID_CREDENTIALS' };
    }

    user.stats.loginCount += 1;
    user.stats.lastLoginAt = now;
    user.stats.lastActiveAt = now;
    user.updatedAt = now;

    const sessionToken = `akg_sess_${crypto.randomBytes(16).toString('hex')}`;
    this.appendAudit({
      email: normalizedEmail,
      action: 'USER_LOGIN',
      actor: normalizedEmail,
      source: input.source || 'cli',
      metadata: { loginCount: user.stats.loginCount },
    });
    this.saveState();

    return {
      authenticated: true,
      sessionToken,
      user: toPublicUserView(user),
    };
  }

  public trackUserAction(input: {
    email: string;
    action: UserActionType;
    target?: string;
    source?: UserAuditEvent['source'];
    metadata?: Record<string, string | number | boolean>;
  }): PublicUserView {
    this.reloadFromDisk();
    const normalizedEmail = (
      input.email || DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email
    )
      .trim()
      .toLowerCase();

    let user = this.state.users[normalizedEmail];
    const now = new Date().toISOString();

    // Auto-provision tracking profile if an external CI/CD or SSO operator triggers an action
    if (!user) {
      const autoPass = hashUserPassword(crypto.randomBytes(16).toString('hex'));
      user = {
        userId: `usr-${crypto.randomBytes(4).toString('hex')}`,
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
        role: 'Ad-Hoc CLI / API Operator',
        account: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.account,
        status: 'active',
        passwordHash: autoPass.hash,
        passwordSalt: autoPass.salt,
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
        passwordUpdatedAt: now,
        stats: {
          runsTriggered: 0,
          comparisonsEvaluated: 0,
          visualJudgeInvocations: 0,
          mcpToolCalls: 0,
          cliCommandsRun: 0,
          loginCount: 0,
          failedLoginCount: 0,
          passwordResetCount: 0,
          lastActiveAt: now,
          lastLoginAt: null,
          lastTargetEvaluated: null,
        },
      };
      this.state.users[normalizedEmail] = user;
    }

    user.stats.lastActiveAt = now;
    user.updatedAt = now;
    if (input.target) {
      user.stats.lastTargetEvaluated = input.target;
    }

    if (input.action === 'SYNTHETIC_RUN_TRIGGERED') {
      user.stats.runsTriggered += 1;
    } else if (input.action === 'COMPARISON_EVALUATED') {
      user.stats.comparisonsEvaluated += 1;
    } else if (input.action === 'VISUAL_JUDGE_INVOKED') {
      user.stats.visualJudgeInvocations += 1;
    } else if (input.action === 'MCP_TOOL_INVOKED') {
      user.stats.mcpToolCalls += 1;
    } else if (input.action === 'CLI_COMMAND_EXECUTED') {
      user.stats.cliCommandsRun += 1;
    }

    this.appendAudit({
      email: normalizedEmail,
      action: input.action,
      target: input.target,
      actor: normalizedEmail,
      source: input.source || 'rest-api',
      metadata: input.metadata,
    });
    this.saveState();
    return toPublicUserView(user);
  }

  public getStatsSummary(filterEmail?: string): UserStatsSummary {
    this.reloadFromDisk();
    const allUsers = Object.values(this.state.users)
      .sort((a, b) => b.stats.runsTriggered - a.stats.runsTriggered)
      .map(toPublicUserView);

    const normalizedFilter = filterEmail?.trim().toLowerCase();
    const filteredUsers = normalizedFilter
      ? allUsers.filter((u) => u.email === normalizedFilter)
      : allUsers;

    const filteredAudit = normalizedFilter
      ? this.state.auditEvents.filter((e) => e.email === normalizedFilter)
      : this.state.auditEvents;

    return {
      totalUsers: allUsers.length,
      activeUsers: allUsers.filter((u) => u.status === 'active').length,
      disabledUsers: allUsers.filter((u) => u.status !== 'active').length,
      totalRunsTriggeredAcrossUsers: allUsers.reduce(
        (acc, u) => acc + u.stats.runsTriggered,
        0
      ),
      totalComparisonsAcrossUsers: allUsers.reduce(
        (acc, u) => acc + u.stats.comparisonsEvaluated,
        0
      ),
      totalVisualJudgeCallsAcrossUsers: allUsers.reduce(
        (acc, u) => acc + u.stats.visualJudgeInvocations,
        0
      ),
      totalMcpCallsAcrossUsers: allUsers.reduce(
        (acc, u) => acc + u.stats.mcpToolCalls,
        0
      ),
      totalPasswordResetsAcrossUsers: allUsers.reduce(
        (acc, u) => acc + u.stats.passwordResetCount,
        0
      ),
      totalAuditEvents: filteredAudit.length,
      users: filteredUsers,
      recentAuditEvents: filteredAudit.slice(0, 50),
    };
  }

  private appendAudit(params: {
    email: string;
    action: UserActionType;
    target?: string;
    actor: string;
    source: UserAuditEvent['source'];
    metadata?: Record<string, string | number | boolean>;
  }): void {
    const evt: UserAuditEvent = {
      eventId: `evt-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      timestamp: new Date().toISOString(),
      email: params.email,
      action: params.action,
      target: params.target,
      actor: params.actor,
      source: params.source,
      metadata: params.metadata,
    };
    this.state.auditEvents = [evt, ...this.state.auditEvents].slice(0, 250);
  }
}

export const defaultUserManager = new UserManager({ persistToFile: true });
