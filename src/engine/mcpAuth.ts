/**
 * ============================================================================
 * PURE MCP ACCESS TOKEN, RBAC SCOPE, RATE-LIMIT & AUDIT ENGINE
 * ============================================================================
 * Zero DOM/Express dependencies so it runs identically in:
 *   1. Express MCP Control Plane (`server.ts`)
 *   2. Deterministic `node:test` unit tests (`src/engine/mcpAuth.test.ts`)
 *
 * Security invariants:
 *   - Tokens use 256+ bits of CSPRNG entropy (`rg_mcp_<8hex>_<48hex>`)
 *   - Only SHA-256 hex digests (`tokenHash`) are stored — never plaintext secrets
 *   - Digest verification uses `crypto.timingSafeEqual`
 *   - Fine-grained RBAC scopes + per-property allowlists + sliding-window RPM
 *   - Audit trail never records raw Bearer tokens
 * ============================================================================
 */

import crypto from 'node:crypto';

export type McpScope =
  | 'mcp:read'
  | 'mcp:write:env'
  | 'mcp:write:tests'
  | 'mcp:write:policies'
  | 'mcp:exec'
  | 'mcp:admin';

export type McpTokenStatus = 'active' | 'disabled' | 'revoked';

export interface McpScopeMeta {
  scope: McpScope;
  label: string;
  description: string;
  tools: string[];
}

export const MCP_SCOPES_CATALOG: McpScopeMeta[] = [
  {
    scope: 'mcp:read',
    label: 'Read & Inspect',
    description: 'Read properties, envs, suites, policies, verdicts, evidence, and resources.',
    tools: [
      'list_akamai_properties',
      'get_fleet_status',
      'get_property_gate',
      'compare_targets',
      'inspect_check_evidence',
      'get_curl_reproduction',
      'evaluate_visual_diff_nova_lite',
      'run_gate_plugin_pipeline',
    ],
  },
  {
    scope: 'mcp:write:env',
    label: 'Write Envs & Properties',
    description: 'Create, update, clone, reorder, and delete properties, environments, hostMaps, and edge IPs.',
    tools: ['manage_property', 'manage_environment'],
  },
  {
    scope: 'mcp:write:tests',
    label: 'Write Tests & Folders',
    description: 'Upsert, patch, clone, toggle, reorder, bulk-edit, and delete synthetic checks and folders.',
    tools: ['manage_test_suite', 'manage_test_folders'],
  },
  {
    scope: 'mcp:write:policies',
    label: 'Write Gate Policies',
    description: 'Manage accepted header rules, cookie waivers, visual waivers, and waiver toggles.',
    tools: ['manage_gate_policies'],
  },
  {
    scope: 'mcp:exec',
    label: 'Live Execution & Canaries',
    description: 'Trigger live edge probes, full property gates, run pinning/purging, and AWS Synthetics canaries.',
    tools: ['rerun_check', 'run_live_gate', 'manage_runs', 'manage_synthetics_canaries'],
  },
  {
    scope: 'mcp:admin',
    label: 'Full Admin (*)',
    description: 'Unrestricted access to all MCP tools, mutations, live executions, and resources.',
    tools: ['*'],
  },
];

const VALID_SCOPES = new Set<McpScope>(MCP_SCOPES_CATALOG.map((s) => s.scope));

export interface McpTokenRecord {
  id: string;
  name: string;
  prefix: string; // e.g. "rg_mcp_a1b2c3d4"
  tokenHash: string; // SHA-256 hex digest of raw token
  scopes: McpScope[];
  allowedAppIds: string[]; // ['*'] for all properties, or explicit appIds
  status: McpTokenStatus;
  rateLimitRpm: number;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastToolUsed: string | null;
  usageCount: number;
  rotatedAt?: string | null;
  revokedAt?: string | null;
  note?: string;
}

export type McpTokenPublicView = Omit<McpTokenRecord, 'tokenHash'> & {
  isExpired: boolean;
};

export interface McpAuthPolicy {
  enforceAuth: boolean;
  requireAuthForReads: boolean;
  allowSameOriginStudio: boolean;
  defaultRateLimitRpm: number;
  updatedAt: string;
  updatedBy: string;
}

export interface McpAuditEvent {
  id: string;
  timestamp: string;
  method: string;
  toolName?: string;
  action?: string;
  appId?: string;
  requiredScope: McpScope;
  decision: 'allowed' | 'denied';
  statusCode: number;
  reason?: string;
  tokenId?: string;
  tokenName?: string;
  tokenPrefix?: string;
  authMode: 'bearer-token' | 'same-origin-studio' | 'open-policy' | 'unauthenticated';
  latencyMs?: number;
}

export interface McpAuthStoreState {
  policy: McpAuthPolicy;
  tokens: McpTokenRecord[];
  auditLog: McpAuditEvent[];
}

export interface CreateMcpTokenInput {
  name: string;
  scopes: string[];
  allowedAppIds?: string[];
  expiresInDays?: number | null;
  rateLimitRpm?: number;
  note?: string;
  createdBy?: string;
}

export interface UpdateMcpTokenPatch {
  name?: string;
  scopes?: string[];
  allowedAppIds?: string[];
  rateLimitRpm?: number;
  status?: 'active' | 'disabled';
  note?: string;
}

export interface McpAuthContext {
  authorizationHeader?: string;
  xMcpTokenHeader?: string;
  isSameOriginStudioRequest?: boolean;
  method: string;
  toolName?: string;
  args?: Record<string, unknown>;
  resourceUri?: string;
  nowMs?: number;
}

export interface McpAuthDecision {
  allowed: boolean;
  statusCode: number;
  wwwAuthenticate?: string;
  error?: string;
  requiredScope: McpScope;
  targetAppId?: string;
  authMode: McpAuditEvent['authMode'];
  tokenId?: string;
  tokenName?: string;
  tokenPrefix?: string;
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  retryAfterSec?: number;
}

export const DEFAULT_MCP_AUTH_POLICY: McpAuthPolicy = {
  enforceAuth: false,
  requireAuthForReads: false,
  allowSameOriginStudio: true,
  defaultRateLimitRpm: 120,
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'system',
};

export function createInitialMcpAuthState(): McpAuthStoreState {
  return {
    policy: { ...DEFAULT_MCP_AUTH_POLICY },
    tokens: [],
    auditLog: [],
  };
}

export function hashMcpToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function constantTimeHashEquals(hashA: string, hashB: string): boolean {
  if (!hashA || !hashB || hashA.length !== hashB.length) return false;
  try {
    const bufA = Buffer.from(hashA, 'hex');
    const bufB = Buffer.from(hashB, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function generateMcpTokenSecret(): {
  rawToken: string;
  prefix: string;
  tokenHash: string;
} {
  const prefixBytes = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const secretBytes = crypto.randomBytes(24).toString('hex'); // 48 hex chars (192 bits)
  const prefix = `rg_mcp_${prefixBytes}`;
  const rawToken = `${prefix}_${secretBytes}`;
  return {
    rawToken,
    prefix,
    tokenHash: hashMcpToken(rawToken),
  };
}

export function toPublicTokenView(
  record: McpTokenRecord,
  nowMs = Date.now()
): McpTokenPublicView {
  const { tokenHash: _stripped, ...rest } = record;
  void _stripped;
  const isExpired =
    Boolean(record.expiresAt) && new Date(record.expiresAt!).getTime() <= nowMs;
  return {
    ...rest,
    isExpired,
  };
}

function sanitizeScopes(rawScopes: unknown): McpScope[] {
  if (!Array.isArray(rawScopes) || rawScopes.length === 0) {
    throw new Error('At least one valid MCP scope is required');
  }
  const unique = new Set<McpScope>();
  for (const item of rawScopes) {
    const val = String(item || '').trim() as McpScope;
    if (!VALID_SCOPES.has(val)) {
      throw new Error(`Invalid MCP scope: "${val}"`);
    }
    unique.add(val);
  }
  return Array.from(unique);
}

function sanitizeAllowedAppIds(rawApps: unknown): string[] {
  if (!Array.isArray(rawApps) || rawApps.length === 0) return ['*'];
  const cleaned = rawApps
    .map((a) => String(a || '').trim().toLowerCase())
    .filter(Boolean);
  if (cleaned.length === 0 || cleaned.includes('*')) return ['*'];
  for (const appId of cleaned) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(appId)) {
      throw new Error(`Invalid property allowlist ID: "${appId}"`);
    }
  }
  return Array.from(new Set(cleaned));
}

function sanitizeRateLimitRpm(raw: unknown, fallback = 120): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 5 || n > 6000) {
    throw new Error('rateLimitRpm must be an integer between 5 and 6000');
  }
  return n;
}

export function createMcpToken(
  state: McpAuthStoreState,
  input: CreateMcpTokenInput,
  nowMs = Date.now()
): { state: McpAuthStoreState; token: McpTokenPublicView; rawToken: string } {
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 80) {
    throw new Error('Token name must be between 2 and 80 characters');
  }
  const scopes = sanitizeScopes(input.scopes);
  const allowedAppIds = sanitizeAllowedAppIds(input.allowedAppIds);
  const rateLimitRpm = sanitizeRateLimitRpm(
    input.rateLimitRpm,
    state.policy.defaultRateLimitRpm
  );

  let expiresAt: string | null = null;
  if (
    input.expiresInDays !== undefined &&
    input.expiresInDays !== null &&
    Number(input.expiresInDays) > 0
  ) {
    const days = Math.min(3650, Math.max(1, Math.round(Number(input.expiresInDays))));
    expiresAt = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const secret = generateMcpTokenSecret();
  const record: McpTokenRecord = {
    id: `tok_${crypto.randomBytes(6).toString('hex')}`,
    name,
    prefix: secret.prefix,
    tokenHash: secret.tokenHash,
    scopes,
    allowedAppIds,
    status: 'active',
    rateLimitRpm,
    createdAt: new Date(nowMs).toISOString(),
    createdBy: String(input.createdBy || 'operator@salesforce.com').trim(),
    expiresAt,
    lastUsedAt: null,
    lastToolUsed: null,
    usageCount: 0,
    rotatedAt: null,
    revokedAt: null,
    note: input.note ? String(input.note).trim().slice(0, 240) : '',
  };

  return {
    state: {
      ...state,
      tokens: [record, ...state.tokens],
    },
    token: toPublicTokenView(record, nowMs),
    rawToken: secret.rawToken,
  };
}

export function rotateMcpToken(
  state: McpAuthStoreState,
  tokenId: string,
  nowMs = Date.now()
): { state: McpAuthStoreState; token: McpTokenPublicView; rawToken: string } {
  const existing = state.tokens.find((t) => t.id === tokenId);
  if (!existing) throw new Error(`MCP token "${tokenId}" not found`);
  if (existing.status === 'revoked') {
    throw new Error('Cannot rotate a permanently revoked token');
  }
  const secret = generateMcpTokenSecret();
  const updated: McpTokenRecord = {
    ...existing,
    prefix: secret.prefix,
    tokenHash: secret.tokenHash,
    rotatedAt: new Date(nowMs).toISOString(),
  };
  return {
    state: {
      ...state,
      tokens: state.tokens.map((t) => (t.id === tokenId ? updated : t)),
    },
    token: toPublicTokenView(updated, nowMs),
    rawToken: secret.rawToken,
  };
}

export function updateMcpToken(
  state: McpAuthStoreState,
  tokenId: string,
  patch: UpdateMcpTokenPatch,
  nowMs = Date.now()
): { state: McpAuthStoreState; token: McpTokenPublicView } {
  const existing = state.tokens.find((t) => t.id === tokenId);
  if (!existing) throw new Error(`MCP token "${tokenId}" not found`);
  if (existing.status === 'revoked') {
    throw new Error('Cannot modify a permanently revoked token');
  }

  const nextName =
    patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (nextName.length < 2 || nextName.length > 80) {
    throw new Error('Token name must be between 2 and 80 characters');
  }

  const nextScopes =
    patch.scopes !== undefined ? sanitizeScopes(patch.scopes) : existing.scopes;
  const nextApps =
    patch.allowedAppIds !== undefined
      ? sanitizeAllowedAppIds(patch.allowedAppIds)
      : existing.allowedAppIds;
  const nextRpm =
    patch.rateLimitRpm !== undefined
      ? sanitizeRateLimitRpm(patch.rateLimitRpm, existing.rateLimitRpm)
      : existing.rateLimitRpm;
  const nextStatus: McpTokenStatus =
    patch.status === 'active' || patch.status === 'disabled'
      ? patch.status
      : existing.status;

  const updated: McpTokenRecord = {
    ...existing,
    name: nextName,
    scopes: nextScopes,
    allowedAppIds: nextApps,
    rateLimitRpm: nextRpm,
    status: nextStatus,
    note:
      patch.note !== undefined
        ? String(patch.note).trim().slice(0, 240)
        : existing.note,
  };

  return {
    state: {
      ...state,
      tokens: state.tokens.map((t) => (t.id === tokenId ? updated : t)),
    },
    token: toPublicTokenView(updated, nowMs),
  };
}

export function revokeMcpToken(
  state: McpAuthStoreState,
  tokenId: string,
  nowMs = Date.now()
): { state: McpAuthStoreState; token: McpTokenPublicView } {
  const existing = state.tokens.find((t) => t.id === tokenId);
  if (!existing) throw new Error(`MCP token "${tokenId}" not found`);
  const updated: McpTokenRecord = {
    ...existing,
    status: 'revoked',
    revokedAt: existing.revokedAt || new Date(nowMs).toISOString(),
  };
  return {
    state: {
      ...state,
      tokens: state.tokens.map((t) => (t.id === tokenId ? updated : t)),
    },
    token: toPublicTokenView(updated, nowMs),
  };
}

export function deleteMcpToken(
  state: McpAuthStoreState,
  tokenId: string
): { state: McpAuthStoreState; deletedId: string } {
  const exists = state.tokens.some((t) => t.id === tokenId);
  if (!exists) throw new Error(`MCP token "${tokenId}" not found`);
  return {
    state: {
      ...state,
      tokens: state.tokens.filter((t) => t.id !== tokenId),
    },
    deletedId: tokenId,
  };
}

export function updateMcpAuthPolicy(
  state: McpAuthStoreState,
  patch: Partial<McpAuthPolicy>,
  operatorEmail = 'operator@salesforce.com',
  nowMs = Date.now()
): { state: McpAuthStoreState; policy: McpAuthPolicy } {
  const nextPolicy: McpAuthPolicy = {
    enforceAuth:
      typeof patch.enforceAuth === 'boolean'
        ? patch.enforceAuth
        : state.policy.enforceAuth,
    requireAuthForReads:
      typeof patch.requireAuthForReads === 'boolean'
        ? patch.requireAuthForReads
        : state.policy.requireAuthForReads,
    allowSameOriginStudio:
      typeof patch.allowSameOriginStudio === 'boolean'
        ? patch.allowSameOriginStudio
        : state.policy.allowSameOriginStudio,
    defaultRateLimitRpm:
      patch.defaultRateLimitRpm !== undefined
        ? sanitizeRateLimitRpm(
            patch.defaultRateLimitRpm,
            state.policy.defaultRateLimitRpm
          )
        : state.policy.defaultRateLimitRpm,
    updatedAt: new Date(nowMs).toISOString(),
    updatedBy: operatorEmail,
  };
  return {
    state: {
      ...state,
      policy: nextPolicy,
    },
    policy: nextPolicy,
  };
}

export function extractBearerToken(
  authorizationHeader?: string,
  xMcpTokenHeader?: string
): string | null {
  if (typeof authorizationHeader === 'string' && authorizationHeader.trim()) {
    const match = authorizationHeader.trim().match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim()) return match[1].trim();
  }
  if (typeof xMcpTokenHeader === 'string' && xMcpTokenHeader.trim()) {
    return xMcpTokenHeader.trim();
  }
  return null;
}

export function resolveRequiredMcpScope(
  method: string,
  toolName?: string,
  args?: Record<string, unknown>,
  resourceUri?: string
): { scope: McpScope; isReadOnly: boolean; targetAppId?: string } {
  const cleanMethod = String(method || '').trim();
  const cleanTool = String(toolName || '').trim();
  const action = String(args?.action || '').trim().toLowerCase();

  let targetAppId: string | undefined;
  if (typeof args?.appId === 'string' && args.appId.trim()) {
    targetAppId = args.appId.trim().toLowerCase();
  } else if (typeof args?.candidateTarget === 'string' && args.candidateTarget.includes('.')) {
    targetAppId = args.candidateTarget.split('.')[0].trim().toLowerCase();
  } else if (typeof args?.target === 'string' && args.target.includes('.')) {
    targetAppId = args.target.split('.')[0].trim().toLowerCase();
  } else if (typeof resourceUri === 'string') {
    const m = resourceUri.match(/^gate:\/\/property\/([a-z0-9_-]+)\//i);
    if (m) targetAppId = m[1].toLowerCase();
  }

  if (
    cleanMethod === 'initialize' ||
    cleanMethod === 'ping' ||
    cleanMethod.startsWith('notifications/') ||
    cleanMethod === 'tools/list' ||
    cleanMethod === 'resources/list' ||
    cleanMethod === 'resources/templates/list' ||
    cleanMethod === 'resources/read' ||
    cleanMethod === 'prompts/list' ||
    cleanMethod === 'prompts/get'
  ) {
    return { scope: 'mcp:read', isReadOnly: true, targetAppId };
  }

  if (cleanTool === 'manage_property' || cleanTool === 'manage_environment') {
    if (action === 'list' || action === 'get' || !action) {
      return { scope: 'mcp:read', isReadOnly: true, targetAppId };
    }
    return { scope: 'mcp:write:env', isReadOnly: false, targetAppId };
  }

  if (cleanTool === 'manage_test_suite' || cleanTool === 'manage_test_folders') {
    if (action === 'list' || action === 'get' || action === 'export_csv' || !action) {
      return { scope: 'mcp:read', isReadOnly: true, targetAppId };
    }
    return { scope: 'mcp:write:tests', isReadOnly: false, targetAppId };
  }

  if (cleanTool === 'manage_gate_policies') {
    if (action === 'list' || !action) {
      return { scope: 'mcp:read', isReadOnly: true, targetAppId };
    }
    return { scope: 'mcp:write:policies', isReadOnly: false, targetAppId };
  }

  if (
    cleanTool === 'rerun_check' ||
    cleanTool === 'run_live_gate' ||
    cleanTool === 'manage_runs' ||
    cleanTool === 'manage_synthetics_canaries'
  ) {
    if (
      (cleanTool === 'manage_runs' && (action === 'list' || action === 'get' || !action)) ||
      (cleanTool === 'manage_synthetics_canaries' &&
        (action === 'list' || action === 'status' || action === 'deep_dive' || !action))
    ) {
      return { scope: 'mcp:read', isReadOnly: true, targetAppId };
    }
    return { scope: 'mcp:exec', isReadOnly: false, targetAppId };
  }

  return { scope: 'mcp:read', isReadOnly: true, targetAppId };
}

function tokenHasScope(token: McpTokenRecord, required: McpScope): boolean {
  if (token.scopes.includes('mcp:admin')) return true;
  if (token.scopes.includes(required)) return true;
  return false;
}

function tokenAllowsApp(token: McpTokenRecord, targetAppId?: string): boolean {
  if (!targetAppId || targetAppId === 'all') return true;
  if (token.allowedAppIds.includes('*')) return true;
  return token.allowedAppIds.includes(targetAppId.toLowerCase());
}

export function evaluateMcpRequestAuth(
  state: McpAuthStoreState,
  ctx: McpAuthContext,
  rateLimitBuckets: Map<string, number[]>
): McpAuthDecision {
  const nowMs = ctx.nowMs ?? Date.now();
  const { scope: requiredScope, isReadOnly, targetAppId } = resolveRequiredMcpScope(
    ctx.method,
    ctx.toolName,
    ctx.args,
    ctx.resourceUri
  );
  const rawToken = extractBearerToken(
    ctx.authorizationHeader,
    ctx.xMcpTokenHeader
  );

  // If a Bearer token IS supplied, always validate it strictly (even if enforceAuth is false)
  if (rawToken) {
    const incomingHash = hashMcpToken(rawToken);
    const matched = state.tokens.find((t) =>
      constantTimeHashEquals(t.tokenHash, incomingHash)
    );
    if (!matched) {
      return {
        allowed: false,
        statusCode: 401,
        wwwAuthenticate:
          'Bearer realm="akamai-synthetic-release-gate", error="invalid_token", error_description="Unrecognized MCP access token"',
        error: 'Invalid MCP access token',
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
      };
    }
    if (matched.status === 'revoked') {
      return {
        allowed: false,
        statusCode: 401,
        wwwAuthenticate:
          'Bearer realm="akamai-synthetic-release-gate", error="invalid_token", error_description="Token has been revoked"',
        error: `MCP token "${matched.name}" (${matched.prefix}) has been revoked`,
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
        tokenId: matched.id,
        tokenName: matched.name,
        tokenPrefix: matched.prefix,
      };
    }
    if (matched.status === 'disabled') {
      return {
        allowed: false,
        statusCode: 403,
        wwwAuthenticate:
          'Bearer realm="akamai-synthetic-release-gate", error="invalid_token", error_description="Token is disabled"',
        error: `MCP token "${matched.name}" (${matched.prefix}) is disabled`,
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
        tokenId: matched.id,
        tokenName: matched.name,
        tokenPrefix: matched.prefix,
      };
    }
    if (matched.expiresAt && new Date(matched.expiresAt).getTime() <= nowMs) {
      return {
        allowed: false,
        statusCode: 401,
        wwwAuthenticate:
          'Bearer realm="akamai-synthetic-release-gate", error="invalid_token", error_description="Token expired"',
        error: `MCP token "${matched.name}" (${matched.prefix}) expired at ${matched.expiresAt}`,
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
        tokenId: matched.id,
        tokenName: matched.name,
        tokenPrefix: matched.prefix,
      };
    }
    if (!tokenHasScope(matched, requiredScope)) {
      return {
        allowed: false,
        statusCode: 403,
        wwwAuthenticate: `Bearer realm="akamai-synthetic-release-gate", error="insufficient_scope", scope="${requiredScope}"`,
        error: `Insufficient scope: token "${matched.name}" requires "${requiredScope}"`,
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
        tokenId: matched.id,
        tokenName: matched.name,
        tokenPrefix: matched.prefix,
      };
    }
    if (!tokenAllowsApp(matched, targetAppId)) {
      return {
        allowed: false,
        statusCode: 403,
        wwwAuthenticate:
          'Bearer realm="akamai-synthetic-release-gate", error="insufficient_scope"',
        error: `Property access denied: token "${matched.name}" is restricted to [${matched.allowedAppIds.join(', ')}] and cannot access "${targetAppId}"`,
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
        tokenId: matched.id,
        tokenName: matched.name,
        tokenPrefix: matched.prefix,
      };
    }

    // Per-token sliding-window 60s RPM rate limiting
    const windowStart = nowMs - 60_000;
    const timestamps = (rateLimitBuckets.get(matched.id) || []).filter(
      (ts) => ts > windowStart
    );
    if (timestamps.length >= matched.rateLimitRpm) {
      const oldest = timestamps[0] || nowMs;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + 60_000 - nowMs) / 1000));
      rateLimitBuckets.set(matched.id, timestamps);
      return {
        allowed: false,
        statusCode: 429,
        error: `Rate limit exceeded (${matched.rateLimitRpm} req/min) for token "${matched.name}". Retry after ${retryAfterSec}s.`,
        requiredScope,
        targetAppId,
        authMode: 'bearer-token',
        tokenId: matched.id,
        tokenName: matched.name,
        tokenPrefix: matched.prefix,
        rateLimitRemaining: 0,
        rateLimitLimit: matched.rateLimitRpm,
        retryAfterSec,
      };
    }
    timestamps.push(nowMs);
    rateLimitBuckets.set(matched.id, timestamps);

    return {
      allowed: true,
      statusCode: 200,
      requiredScope,
      targetAppId,
      authMode: 'bearer-token',
      tokenId: matched.id,
      tokenName: matched.name,
      tokenPrefix: matched.prefix,
      rateLimitRemaining: Math.max(0, matched.rateLimitRpm - timestamps.length),
      rateLimitLimit: matched.rateLimitRpm,
    };
  }

  // No Bearer token supplied
  const isDiscoveryMethod =
    ctx.method === 'initialize' ||
    ctx.method === 'ping' ||
    ctx.method.startsWith('notifications/') ||
    ctx.method === 'tools/list';

  if (!state.policy.enforceAuth) {
    return {
      allowed: true,
      statusCode: 200,
      requiredScope,
      targetAppId,
      authMode: ctx.isSameOriginStudioRequest ? 'same-origin-studio' : 'open-policy',
    };
  }

  if (ctx.isSameOriginStudioRequest && state.policy.allowSameOriginStudio) {
    return {
      allowed: true,
      statusCode: 200,
      requiredScope,
      targetAppId,
      authMode: 'same-origin-studio',
    };
  }

  // When enforceAuth is ON, allow unauthenticated discovery/reads only if requireAuthForReads is OFF
  if ((isDiscoveryMethod || isReadOnly) && !state.policy.requireAuthForReads) {
    return {
      allowed: true,
      statusCode: 200,
      requiredScope,
      targetAppId,
      authMode: 'open-policy',
    };
  }

  return {
    allowed: false,
    statusCode: 401,
    wwwAuthenticate: `Bearer realm="akamai-synthetic-release-gate", scope="${requiredScope}"`,
    error: `Authentication required: supply Authorization: Bearer <rg_mcp_...> token with scope "${requiredScope}"`,
    requiredScope,
    targetAppId,
    authMode: 'unauthenticated',
  };
}

export function touchMcpTokenUsage(
  state: McpAuthStoreState,
  tokenId: string,
  toolOrMethod: string,
  nowMs = Date.now()
): McpAuthStoreState {
  return {
    ...state,
    tokens: state.tokens.map((t) =>
      t.id === tokenId
        ? {
            ...t,
            usageCount: (t.usageCount || 0) + 1,
            lastUsedAt: new Date(nowMs).toISOString(),
            lastToolUsed: toolOrMethod,
          }
        : t
    ),
  };
}

export function recordMcpAuditEvent(
  state: McpAuthStoreState,
  event: Omit<McpAuditEvent, 'id' | 'timestamp'>,
  nowMs = Date.now(),
  maxEntries = 250
): McpAuthStoreState {
  const entry: McpAuditEvent = {
    id: `aud_${crypto.randomBytes(5).toString('hex')}`,
    timestamp: new Date(nowMs).toISOString(),
    ...event,
  };
  return {
    ...state,
    auditLog: [entry, ...state.auditLog].slice(0, maxEntries),
  };
}
