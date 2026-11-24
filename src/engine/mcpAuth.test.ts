import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MCP_SCOPES_CATALOG,
  constantTimeHashEquals,
  createInitialMcpAuthState,
  createMcpToken,
  deleteMcpToken,
  evaluateMcpRequestAuth,
  extractBearerToken,
  hashMcpToken,
  recordMcpAuditEvent,
  resolveRequiredMcpScope,
  revokeMcpToken,
  rotateMcpToken,
  toPublicTokenView,
  touchMcpTokenUsage,
  updateMcpAuthPolicy,
  updateMcpToken,
} from './mcpAuth';

describe('MCP Access Token, RBAC Scope, Rate-Limit & Audit Engine', () => {
  it('generates high-entropy rg_mcp tokens, stores only SHA-256 digests, and strips tokenHash in public view', () => {
    const init = createInitialMcpAuthState();
    const now = Date.parse('2026-11-24T00:00:00.000Z');
    const created = createMcpToken(
      init,
      {
        name: 'Cursor IDE — WWW',
        scopes: ['mcp:read', 'mcp:write:env'],
        allowedAppIds: ['www'],
        expiresInDays: 30,
        rateLimitRpm: 60,
        createdBy: 'qa@salesforce.com',
      },
      now
    );

    assert.match(created.rawToken, /^rg_mcp_[0-9a-f]{8}_[0-9a-f]{48}$/);
    assert.equal(created.token.prefix, created.rawToken.slice(0, 15));
    assert.equal('tokenHash' in created.token, false);
    assert.equal(created.token.isExpired, false);
    assert.equal(created.state.tokens.length, 1);
    assert.equal(created.state.tokens[0].tokenHash, hashMcpToken(created.rawToken));
    assert.notEqual(created.state.tokens[0].tokenHash, created.rawToken);

    const pubAfterExpiry = toPublicTokenView(
      created.state.tokens[0],
      now + 31 * 24 * 60 * 60 * 1000
    );
    assert.equal(pubAfterExpiry.isExpired, true);
  });

  it('compares hashes in constant time and rejects mismatched or invalid digests', () => {
    const h1 = hashMcpToken('rg_mcp_12345678_abcdef');
    const h2 = hashMcpToken('rg_mcp_12345678_abcdef');
    const h3 = hashMcpToken('rg_mcp_12345678_abcdee');

    assert.equal(constantTimeHashEquals(h1, h2), true);
    assert.equal(constantTimeHashEquals(h1, h3), false);
    assert.equal(constantTimeHashEquals(h1, 'short'), false);
    assert.equal(constantTimeHashEquals('', ''), false);
  });

  it('extracts Bearer and X-MCP-Token credentials cleanly', () => {
    assert.equal(extractBearerToken('Bearer rg_mcp_abc_123'), 'rg_mcp_abc_123');
    assert.equal(extractBearerToken('bearer   rg_mcp_xyz_999  '), 'rg_mcp_xyz_999');
    assert.equal(extractBearerToken(undefined, 'rg_mcp_hdr_001'), 'rg_mcp_hdr_001');
    assert.equal(extractBearerToken('Basic abc123'), null);
    assert.equal(extractBearerToken(undefined, undefined), null);
  });

  it('maps every MCP method and tool action to the exact required RBAC scope and targetAppId', () => {
    assert.deepEqual(resolveRequiredMcpScope('initialize'), {
      scope: 'mcp:read',
      isReadOnly: true,
      targetAppId: undefined,
    });
    assert.deepEqual(
      resolveRequiredMcpScope('tools/call', 'manage_environment', {
        action: 'list',
        appId: 'www',
      }),
      { scope: 'mcp:read', isReadOnly: true, targetAppId: 'www' }
    );
    assert.deepEqual(
      resolveRequiredMcpScope('tools/call', 'manage_environment', {
        action: 'add',
        appId: 'www',
      }),
      { scope: 'mcp:write:env', isReadOnly: false, targetAppId: 'www' }
    );
    assert.deepEqual(
      resolveRequiredMcpScope('tools/call', 'manage_test_suite', {
        action: 'upsert',
        appId: 'login',
      }),
      { scope: 'mcp:write:tests', isReadOnly: false, targetAppId: 'login' }
    );
    assert.deepEqual(
      resolveRequiredMcpScope('tools/call', 'manage_gate_policies', {
        action: 'add_header_rule',
        appId: 'www',
      }),
      { scope: 'mcp:write:policies', isReadOnly: false, targetAppId: 'www' }
    );
    assert.deepEqual(
      resolveRequiredMcpScope('tools/call', 'run_live_gate', {
        candidateTarget: 'help.prod.staging',
      }),
      { scope: 'mcp:exec', isReadOnly: false, targetAppId: 'help' }
    );
    assert.deepEqual(
      resolveRequiredMcpScope(
        'resources/read',
        undefined,
        undefined,
        'gate://property/trailhead/suite'
      ),
      { scope: 'mcp:read', isReadOnly: true, targetAppId: 'trailhead' }
    );
  });

  it('enforces RBAC scopes, property allowlists, token disable, rotation, expiration, and revocation', () => {
    const buckets = new Map<string, number[]>();
    const baseTime = Date.parse('2026-11-24T12:00:00.000Z');
    let state = createInitialMcpAuthState();
    state = updateMcpAuthPolicy(state, {
      enforceAuth: true,
      requireAuthForReads: true,
      allowSameOriginStudio: true,
    }).state;

    // 1. Unauthenticated external call is rejected with 401 + WWW-Authenticate
    const unauth = evaluateMcpRequestAuth(
      state,
      {
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'add', appId: 'www' },
        nowMs: baseTime,
      },
      buckets
    );
    assert.equal(unauth.allowed, false);
    assert.equal(unauth.statusCode, 401);
    assert.match(unauth.wwwAuthenticate || '', /Bearer realm=/);

    // 2. Same-origin studio call is permitted when allowSameOriginStudio is true
    const studioAllowed = evaluateMcpRequestAuth(
      state,
      {
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'add', appId: 'www' },
        isSameOriginStudioRequest: true,
        nowMs: baseTime,
      },
      buckets
    );
    assert.equal(studioAllowed.allowed, true);
    assert.equal(studioAllowed.authMode, 'same-origin-studio');

    // 3. Create scoped token limited to www + read/write:env
    const created = createMcpToken(
      state,
      {
        name: 'WWW Env Automation',
        scopes: ['mcp:read', 'mcp:write:env'],
        allowedAppIds: ['www'],
        expiresInDays: 7,
        rateLimitRpm: 10,
      },
      baseTime
    );
    state = created.state;

    // Allowed: write env on www
    const okEnv = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'add', appId: 'www' },
        nowMs: baseTime + 1000,
      },
      buckets
    );
    assert.equal(okEnv.allowed, true);
    assert.equal(okEnv.statusCode, 200);
    assert.equal(okEnv.rateLimitLimit, 10);
    assert.equal(okEnv.rateLimitRemaining, 9);

    // Denied 403: insufficient scope (write:tests not granted)
    const deniedScope = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_test_suite',
        args: { action: 'upsert', appId: 'www' },
        nowMs: baseTime + 2000,
      },
      buckets
    );
    assert.equal(deniedScope.allowed, false);
    assert.equal(deniedScope.statusCode, 403);
    assert.match(deniedScope.wwwAuthenticate || '', /insufficient_scope/);

    // Denied 403: wrong property (login not in allowedAppIds)
    const deniedApp = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'add', appId: 'login' },
        nowMs: baseTime + 3000,
      },
      buckets
    );
    assert.equal(deniedApp.allowed, false);
    assert.equal(deniedApp.statusCode, 403);

    // Pause/disable token -> 403
    state = updateMcpToken(state, created.token.id, { status: 'disabled' }, baseTime + 4000).state;
    const paused = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'list', appId: 'www' },
        nowMs: baseTime + 4000,
      },
      buckets
    );
    assert.equal(paused.allowed, false);
    assert.equal(paused.statusCode, 403);

    // Re-enable & rotate -> old secret rejected (401), new secret accepted (200)
    state = updateMcpToken(state, created.token.id, { status: 'active' }, baseTime + 5000).state;
    const rotated = rotateMcpToken(state, created.token.id, baseTime + 5000);
    state = rotated.state;
    assert.notEqual(rotated.rawToken, created.rawToken);

    const oldRejected = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'list', appId: 'www' },
        nowMs: baseTime + 6000,
      },
      buckets
    );
    assert.equal(oldRejected.allowed, false);
    assert.equal(oldRejected.statusCode, 401);

    const newAccepted = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${rotated.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'list', appId: 'www' },
        nowMs: baseTime + 6000,
      },
      buckets
    );
    assert.equal(newAccepted.allowed, true);

    // Expired token -> 401
    const expiredCall = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${rotated.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'list', appId: 'www' },
        nowMs: baseTime + 8 * 24 * 60 * 60 * 1000,
      },
      buckets
    );
    assert.equal(expiredCall.allowed, false);
    assert.equal(expiredCall.statusCode, 401);

    // Revoke token -> 401 & cannot rotate revoked token; delete removes record
    state = revokeMcpToken(state, created.token.id, baseTime + 7000).state;
    const revokedCall = evaluateMcpRequestAuth(
      state,
      {
        authorizationHeader: `Bearer ${rotated.rawToken}`,
        method: 'tools/call',
        toolName: 'manage_environment',
        args: { action: 'list', appId: 'www' },
        nowMs: baseTime + 7000,
      },
      buckets
    );
    assert.equal(revokedCall.allowed, false);
    assert.equal(revokedCall.statusCode, 401);
    assert.throws(() => rotateMcpToken(state, created.token.id), /revoked/i);

    const deleted = deleteMcpToken(state, created.token.id);
    assert.equal(deleted.state.tokens.length, 0);
  });

  it('enforces sliding-window 60s RPM rate limit and recovers once window slides', () => {
    const buckets = new Map<string, number[]>();
    const t0 = Date.parse('2026-11-24T13:00:00.000Z');
    const created = createMcpToken(
      createInitialMcpAuthState(),
      {
        name: 'Tight RPM Token',
        scopes: ['mcp:admin'],
        rateLimitRpm: 5,
      },
      t0
    );

    for (let i = 0; i < 5; i += 1) {
      const dec = evaluateMcpRequestAuth(
        created.state,
        {
          authorizationHeader: `Bearer ${created.rawToken}`,
          method: 'tools/call',
          toolName: 'run_live_gate',
          args: { candidateTarget: 'www.prod.staging' },
          nowMs: t0 + i * 1000,
        },
        buckets
      );
      assert.equal(dec.allowed, true);
    }

    const limited = evaluateMcpRequestAuth(
      created.state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'run_live_gate',
        args: { candidateTarget: 'www.prod.staging' },
        nowMs: t0 + 10_000,
      },
      buckets
    );
    assert.equal(limited.allowed, false);
    assert.equal(limited.statusCode, 429);
    assert.ok((limited.retryAfterSec || 0) >= 45);

    const recovered = evaluateMcpRequestAuth(
      created.state,
      {
        authorizationHeader: `Bearer ${created.rawToken}`,
        method: 'tools/call',
        toolName: 'run_live_gate',
        args: { candidateTarget: 'www.prod.staging' },
        nowMs: t0 + 62_000,
      },
      buckets
    );
    assert.equal(recovered.allowed, true);
  });

  it('tracks token usage and records bounded zero-secret audit trail entries', () => {
    const t0 = Date.parse('2026-11-24T14:00:00.000Z');
    const created = createMcpToken(
      createInitialMcpAuthState(),
      {
        name: 'Audit Test Token',
        scopes: ['mcp:read'],
      },
      t0
    );

    let state = touchMcpTokenUsage(
      created.state,
      created.token.id,
      'get_fleet_status',
      t0 + 500
    );
    assert.equal(state.tokens[0].usageCount, 1);
    assert.equal(state.tokens[0].lastToolUsed, 'get_fleet_status');

    state = recordMcpAuditEvent(
      state,
      {
        method: 'tools/call',
        toolName: 'get_fleet_status',
        requiredScope: 'mcp:read',
        decision: 'allowed',
        statusCode: 200,
        tokenId: created.token.id,
        tokenName: created.token.name,
        tokenPrefix: created.token.prefix,
        authMode: 'bearer-token',
        latencyMs: 14,
      },
      t0 + 600,
      3
    );

    assert.equal(state.auditLog.length, 1);
    assert.equal(JSON.stringify(state.auditLog).includes(created.rawToken), false);
    assert.equal(MCP_SCOPES_CATALOG.length, 6);
  });
});
