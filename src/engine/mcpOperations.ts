/**
 * ============================================================================
 * PURE MCP OPERATIONS ENGINE (PROPERTIES, ENVS, TESTS, FOLDERS, POLICIES, RUNS)
 * ============================================================================
 * Decoupled, deterministic, strictly validated state-mutation engine shared by:
 *   1. Express MCP JSON-RPC 2.0 handler (`server.ts`)
 *   2. Fast `node:test` unit tests (`src/engine/mcpOperations.test.ts`)
 *
 * Security invariants:
 *   - Blocks prototype-pollution keys (`__proto__`, `constructor`, `prototype`)
 *   - Strictly validates IDs, hostnames, paths, and public edge IPs
 *   - Redacts sensitive header values (`authorization`, `cookie`, `x-api-key`)
 *   - Never executes user-supplied script text with `eval` or `new Function`
 * ============================================================================
 */

import {
  DEFAULT_TEMPLATE_CONFIG,
  PROPERTY_TEST_SUITES,
  TestCaseDefinition,
  getPropertyTestSuite,
  resolvePropertyHostname,
} from '../config/template.config';
import {
  DEFAULT_TEST_FOLDERS,
  cloneTestInSuite,
  deleteEnvironmentFromApp,
  deleteFolderAndReassign,
  deleteTestsFromSuite,
  generateNextTestId,
  moveTestsToFolder,
  normalizeSuiteWithCatchpointDefaults,
  normalizeTestCaseWithCatchpointDefaults,
  reorderEnvironmentInApp,
  reorderTestInSuite,
  toggleTestsEnabled,
  upsertEnvironmentInApp,
  upsertFolder,
  upsertTestInSuite,
  validateEnvironmentDraft,
  validateTestDraft,
} from './catchpointCatalog';
import {
  AcceptedRule,
  AppConfig,
  CatchpointTestType,
  EnvironmentConfig,
  EnvironmentTier,
  HostMap,
  RunRecord,
  TestAssertions,
  TestFolder,
  TestScriptEngine,
  TransactionStep,
} from './types';

export interface McpPolicyState {
  acceptedRules: AcceptedRule[];
  acceptedCookies: string[];
  acceptedVisualTests: string[];
  acceptedVisualParams: Record<string, string[]>;
  ignoreAcceptedDiffs: boolean;
}

export interface McpStateStore {
  properties: AppConfig[];
  suitesByAppId: Record<string, TestCaseDefinition[]>;
  folders: TestFolder[];
  policies: McpPolicyState;
  runs: RunRecord[];
}

export interface McpOperationOutcome<T = Record<string, unknown>> {
  state: McpStateStore;
  result: T;
  mutated: boolean;
}

const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-amz-security-token',
]);

const VALID_TIERS = new Set<EnvironmentTier>([
  'prod',
  'staging',
  'uat',
  'qa',
  'dev',
  'canary',
  'dr',
]);

const VALID_NETWORKS = new Set<'staging' | 'prod'>(['staging', 'prod']);

const VALID_FOLDER_COLORS = new Set<NonNullable<TestFolder['color']>>([
  'sky',
  'emerald',
  'amber',
  'rose',
  'violet',
  'slate',
]);

const VALID_HTTP_METHODS = new Set<NonNullable<TestCaseDefinition['httpMethod']>>([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'QUERY',
]);

const VALID_DNS_RECORD_TYPES = new Set<NonNullable<TestCaseDefinition['dnsRecordType']>>([
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SRV',
  'CAA',
]);

const VALID_SCRIPT_ENGINES = new Set<TestScriptEngine>([
  'playwright',
  'puppeteer',
  'catchpoint',
  'selenium',
  'k6',
  'node-fetch',
]);

export function sanitizeSafeId(raw: unknown, label = 'id'): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) {
    throw new Error(`${label} is required`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(value)) {
    throw new Error(
      `Invalid ${label} "${value}": must be 2–32 chars (lowercase alphanumeric, hyphen, or underscore)`
    );
  }
  if (BLOCKED_OBJECT_KEYS.has(value)) {
    throw new Error(`Disallowed ${label}: "${value}"`);
  }
  return value;
}

export function sanitizeTestId(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!value) {
    throw new Error('testId is required');
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(value)) {
    throw new Error(
      `Invalid testId "${value}": must be 2–24 alphanumeric, hyphen, or underscore characters`
    );
  }
  return value;
}

export function isPrivateOrLoopbackHost(host: string): boolean {
  const clean = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) return true;
  if (
    clean === 'localhost' ||
    clean === '::1' ||
    clean === '0.0.0.0' ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4 = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map((n) => Number(n));
    if (octets.some((o) => o < 0 || o > 255)) return true;
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function validatePublicEdgeIp(rawIp: unknown, label = 'edgeIp'): string | undefined {
  if (rawIp === undefined || rawIp === null || rawIp === '') return undefined;
  const ip = String(rawIp).trim();
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    throw new Error(`Invalid ${label} "${ip}": must be a valid IPv4 address`);
  }
  if (isPrivateOrLoopbackHost(ip)) {
    throw new Error(`Invalid ${label} "${ip}": loopback, metadata, and private IPs are blocked`);
  }
  return ip;
}

export function sanitizeHostname(rawHost: unknown, label = 'hostname'): string {
  const host = String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0];
  if (!host || !/^[a-z0-9.-]{3,253}$/.test(host) || !host.includes('.')) {
    throw new Error(`Invalid ${label}: "${String(rawHost || '')}"`);
  }
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error(`Disallowed ${label} "${host}": loopback/private hosts are blocked`);
  }
  return host;
}

export function sanitizeHostMap(raw: unknown): HostMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('hostMap must be an object mapping canonicalHost -> targetHost');
  }
  const out: HostMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (BLOCKED_OBJECT_KEYS.has(k)) continue;
    const canon = sanitizeHostname(k, 'hostMap canonical host');
    const target = sanitizeHostname(v, `hostMap target for ${canon}`);
    out[canon] = target;
  }
  if (Object.keys(out).length === 0) {
    throw new Error('hostMap must include at least one canonicalHost -> targetHost mapping');
  }
  return out;
}

export function sanitizeStringRecord(
  raw: unknown,
  options: { redactSecrets?: boolean; label?: string } = {}
): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${options.label || 'map'} must be a key-value JSON object`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key || BLOCKED_OBJECT_KEYS.has(key)) continue;
    if (v === undefined || v === null) continue;
    const val = String(v).trim();
    if (options.redactSecrets && SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function redactSensitiveHeadersForOutput(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function sanitizeNetworks(raw: unknown, fallback: ('staging' | 'prod')[] = ['prod', 'staging']): ('staging' | 'prod')[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const unique = Array.from(
    new Set(
      raw
        .map((n) => String(n).trim().toLowerCase())
        .filter((n): n is 'staging' | 'prod' => VALID_NETWORKS.has(n as 'staging' | 'prod'))
    )
  );
  if (unique.length === 0) {
    throw new Error('networks must include at least one of "staging" or "prod"');
  }
  return unique;
}

function sanitizeTags(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    throw new Error('tags must be an array of strings');
  }
  return Array.from(
    new Set(
      raw
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0 && t.length <= 48)
    )
  );
}

function sanitizePathOrUrl(raw: unknown): string {
  const val = String(raw || '').trim();
  if (!val) return '/';
  if (/^https?:\/\//i.test(val)) {
    let parsed: URL;
    try {
      parsed = new URL(val);
    } catch {
      throw new Error(`Invalid URL: "${val}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported URL protocol: "${parsed.protocol}"`);
    }
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
      throw new Error(`Disallowed URL host "${parsed.hostname}": loopback/private hosts are blocked`);
    }
    return parsed.toString();
  }
  if (/^(javascript|data|file|vbscript):/i.test(val)) {
    throw new Error(`Disallowed URI scheme in path: "${val}"`);
  }
  return val.startsWith('/') ? val : `/${val}`;
}

function sanitizeAssertions(raw: unknown): TestAssertions | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('assertions must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const next: TestAssertions = {};
  if (obj.expectedBodyMatch !== undefined && String(obj.expectedBodyMatch).trim()) {
    next.expectedBodyMatch = String(obj.expectedBodyMatch).trim();
  }
  if (obj.maxLatencyMs !== undefined && obj.maxLatencyMs !== '') {
    const n = Number(obj.maxLatencyMs);
    if (!Number.isFinite(n) || n < 10 || n > 120000) {
      throw new Error('assertions.maxLatencyMs must be between 10 and 120000');
    }
    next.maxLatencyMs = Math.round(n);
  }
  if (obj.minTlsVersion !== undefined && String(obj.minTlsVersion).trim()) {
    next.minTlsVersion = String(obj.minTlsVersion).trim();
  }
  if (obj.requireDnssec !== undefined) {
    next.requireDnssec = Boolean(obj.requireDnssec);
  }
  if (obj.maxHops !== undefined && obj.maxHops !== '') {
    const n = Number(obj.maxHops);
    if (!Number.isFinite(n) || n < 1 || n > 64) {
      throw new Error('assertions.maxHops must be between 1 and 64');
    }
    next.maxHops = Math.round(n);
  }
  return next;
}

const VALID_STEP_ACTIONS = new Set<TransactionStep['action']>([
  'open',
  'click',
  'type',
  'waitForSelector',
  'assertText',
  'assertStatus',
  'screenshot',
]);

function sanitizeTransactionSteps(raw: unknown): TransactionStep[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error('transactionSteps must be an array of step objects');
  }
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`transactionSteps[${idx}] must be an object`);
    }
    const rec = item as Record<string, unknown>;
    const action = String(rec.action || 'open') as TransactionStep['action'];
    if (!VALID_STEP_ACTIONS.has(action)) {
      throw new Error(`Invalid transaction step action "${action}" at index ${idx}`);
    }
    const target = String(rec.target || '').trim();
    if (!target) {
      throw new Error(`transactionSteps[${idx}].target is required`);
    }
    return {
      step: typeof rec.step === 'number' && rec.step > 0 ? Math.round(rec.step) : idx + 1,
      action,
      target,
      ...(rec.value !== undefined ? { value: String(rec.value) } : {}),
      ...(rec.assertText !== undefined ? { assertText: String(rec.assertText) } : {}),
    };
  });
}

function getSuiteForAppFromState(state: McpStateStore, appId: string): TestCaseDefinition[] {
  if (state.suitesByAppId[appId]) {
    return [...state.suitesByAppId[appId]];
  }
  return normalizeSuiteWithCatchpointDefaults(
    getPropertyTestSuite(appId, {
      ...DEFAULT_TEMPLATE_CONFIG,
      properties: state.properties,
    })
  );
}

function findPropertyOrThrow(state: McpStateStore, rawAppId: unknown): AppConfig {
  const appId = sanitizeSafeId(rawAppId, 'appId');
  const found = state.properties.find((p) => p.id.toLowerCase() === appId);
  if (!found) {
    throw new Error(
      `Property "${appId}" not found. Available properties: ${state.properties
        .map((p) => p.id)
        .join(', ')}`
    );
  }
  return found;
}

function sanitizeTestForOutput(tc: TestCaseDefinition): TestCaseDefinition {
  return {
    ...tc,
    ...(tc.requestHeaders
      ? { requestHeaders: redactSensitiveHeadersForOutput(tc.requestHeaders) }
      : {}),
  };
}

function sanitizeEnvForOutput(env: EnvironmentConfig): EnvironmentConfig {
  return {
    ...env,
    ...(env.headers ? { headers: redactSensitiveHeadersForOutput(env.headers) } : {}),
  };
}

function sanitizePropertyForOutput(prop: AppConfig): AppConfig {
  return {
    ...prop,
    ...(prop.headers ? { headers: redactSensitiveHeadersForOutput(prop.headers) } : {}),
    envs: prop.envs.map(sanitizeEnvForOutput),
  };
}

/**
 * 1. MANAGE PROPERTY (list | get | create | update | patch | delete | clone)
 */
export function executeManageProperty(
  state: McpStateStore,
  args: Record<string, unknown>
): McpOperationOutcome {
  const action = String(args.action || 'list').trim().toLowerCase();

  if (action === 'list') {
    const q = String(args.search || '').trim().toLowerCase();
    const tag = String(args.tag || '').trim().toLowerCase();
    const list = state.properties.filter((p) => {
      if (q && !`${p.id} ${p.name} ${p.division || ''} ${p.description || ''}`.toLowerCase().includes(q)) {
        return false;
      }
      if (tag && !(p.tags || []).some((t) => t.toLowerCase() === tag)) {
        return false;
      }
      return true;
    });
    return {
      state,
      mutated: false,
      result: {
        action: 'list',
        totalProperties: list.length,
        properties: list.map((p) => ({
          ...sanitizePropertyForOutput(p),
          suiteCount: getSuiteForAppFromState(state, p.id).length,
          runCount: state.runs.filter((r) => r.appId === p.id).length,
        })),
      },
    };
  }

  if (action === 'get') {
    const prop = findPropertyOrThrow(state, args.appId);
    const suite = getSuiteForAppFromState(state, prop.id);
    return {
      state,
      mutated: false,
      result: {
        action: 'get',
        property: sanitizePropertyForOutput(prop),
        suiteCount: suite.length,
        enabledChecks: suite.filter((c) => c.enabled !== false).length,
        runCount: state.runs.filter((r) => r.appId === prop.id).length,
      },
    };
  }

  if (action === 'create') {
    const appId = sanitizeSafeId(args.appId, 'appId');
    if (state.properties.some((p) => p.id.toLowerCase() === appId)) {
      throw new Error(`Property "${appId}" already exists. Use action "update" or "patch" instead.`);
    }
    const defaultHost = `${appId}.${DEFAULT_TEMPLATE_CONFIG.branding.defaultDomain}`;
    const canonicalHost = args.canonicalHost
      ? sanitizeHostname(args.canonicalHost, 'canonicalHost')
      : defaultHost;
    const defaultNetworks = sanitizeNetworks(args.defaultNetworks, ['prod', 'staging']);
    const envs: EnvironmentConfig[] = Array.isArray(args.envs) && args.envs.length > 0
      ? (args.envs as Record<string, unknown>[]).map((rawEnv, idx) => {
          const eId = sanitizeSafeId(rawEnv.id || (idx === 0 ? 'prod' : `env-${idx + 1}`), 'env.id');
          const envHostMap = rawEnv.hostMap
            ? sanitizeHostMap(rawEnv.hostMap)
            : { [canonicalHost]: eId === 'prod' ? canonicalHost : `${appId}-${eId}.${DEFAULT_TEMPLATE_CONFIG.branding.defaultDomain}` };
          return {
            id: eId,
            name: String(rawEnv.name || eId.toUpperCase()).trim(),
            tier: VALID_TIERS.has(rawEnv.tier as EnvironmentTier)
              ? (rawEnv.tier as EnvironmentTier)
              : eId === 'prod'
              ? 'prod'
              : 'uat',
            description: rawEnv.description ? String(rawEnv.description).trim() : undefined,
            hostMap: envHostMap,
            networks: sanitizeNetworks(rawEnv.networks, defaultNetworks),
            order: idx + 1,
          };
        })
      : [
          {
            id: 'prod',
            name: 'PROD',
            tier: 'prod',
            hostMap: { [canonicalHost]: canonicalHost },
            networks: defaultNetworks,
            order: 1,
          },
        ];

    const newProp: AppConfig = {
      id: appId,
      name: String(args.name || `${appId.toUpperCase()} (${canonicalHost})`).trim(),
      suitePath: `config/suites/${appId}.csv`,
      division: args.division ? String(args.division).trim() : undefined,
      folder: args.folder ? String(args.folder).trim() : undefined,
      description: args.description ? String(args.description).trim() : undefined,
      tags: sanitizeTags(args.tags),
      defaultNetworks,
      envs,
      headers: args.headers ? sanitizeStringRecord(args.headers, { label: 'headers' }) : undefined,
    };

    const initialSuite = normalizeSuiteWithCatchpointDefaults([
      {
        id: 'T01',
        name: `${newProp.name} Home & Edge Health`,
        path: '/',
        expectedStatus: '200',
        category: 'Core Experience',
        testType: 'web-chrome',
        enabled: true,
      },
    ]);

    const nextState: McpStateStore = {
      ...state,
      properties: [...state.properties, newProp],
      suitesByAppId: {
        ...state.suitesByAppId,
        [appId]: initialSuite,
      },
    };
    return {
      state: nextState,
      mutated: true,
      result: {
        action: 'create',
        created: sanitizePropertyForOutput(newProp),
        suiteCount: initialSuite.length,
        totalProperties: nextState.properties.length,
      },
    };
  }

  if (action === 'update' || action === 'patch') {
    const existing = findPropertyOrThrow(state, args.appId);
    const updated: AppConfig = {
      ...existing,
      ...(args.name !== undefined ? { name: String(args.name).trim() || existing.name } : {}),
      ...(args.division !== undefined ? { division: String(args.division).trim() || undefined } : {}),
      ...(args.folder !== undefined ? { folder: String(args.folder).trim() || undefined } : {}),
      ...(args.description !== undefined ? { description: String(args.description).trim() || undefined } : {}),
      ...(args.tags !== undefined ? { tags: sanitizeTags(args.tags) } : {}),
      ...(args.defaultNetworks !== undefined
        ? { defaultNetworks: sanitizeNetworks(args.defaultNetworks, existing.defaultNetworks) }
        : {}),
      ...(args.headers !== undefined
        ? {
            headers:
              args.merge === true
                ? { ...(existing.headers || {}), ...sanitizeStringRecord(args.headers, { label: 'headers' }) }
                : sanitizeStringRecord(args.headers, { label: 'headers' }),
          }
        : {}),
    };

    if (Array.isArray(args.envs) && args.envs.length > 0) {
      updated.envs = (args.envs as Record<string, unknown>[]).map((rawEnv, idx) => {
        const eId = sanitizeSafeId(rawEnv.id, `envs[${idx}].id`);
        return {
          id: eId,
          name: String(rawEnv.name || eId.toUpperCase()).trim(),
          tier: VALID_TIERS.has(rawEnv.tier as EnvironmentTier)
            ? (rawEnv.tier as EnvironmentTier)
            : eId === 'prod'
            ? 'prod'
            : 'uat',
          description: rawEnv.description ? String(rawEnv.description).trim() : undefined,
          hostMap: sanitizeHostMap(rawEnv.hostMap),
          networks: sanitizeNetworks(rawEnv.networks, updated.defaultNetworks),
          order: idx + 1,
        };
      });
    }

    const nextState: McpStateStore = {
      ...state,
      properties: state.properties.map((p) => (p.id === existing.id ? updated : p)),
    };
    return {
      state: nextState,
      mutated: true,
      result: {
        action,
        updated: sanitizePropertyForOutput(updated),
        totalProperties: nextState.properties.length,
      },
    };
  }

  if (action === 'clone') {
    const source = findPropertyOrThrow(state, args.appId);
    const newAppId = sanitizeSafeId(args.newAppId, 'newAppId');
    if (state.properties.some((p) => p.id.toLowerCase() === newAppId)) {
      throw new Error(`Target property "${newAppId}" already exists`);
    }
    const clonedProp: AppConfig = {
      ...source,
      id: newAppId,
      name: String(args.name || `${source.name} (Clone)`).trim(),
      suitePath: `config/suites/${newAppId}.csv`,
      envs: source.envs.map((e) => ({
        ...e,
        hostMap: { ...e.hostMap },
        networks: e.networks ? [...e.networks] : ['prod', 'staging'],
        ...(e.edgeIps ? { edgeIps: { ...e.edgeIps } } : {}),
        ...(e.headers ? { headers: { ...e.headers } } : {}),
        ...(e.variables ? { variables: { ...e.variables } } : {}),
      })),
    };
    const cloneSuite = args.cloneSuite !== false;
    const sourceSuite = getSuiteForAppFromState(state, source.id);
    const clonedSuite = cloneSuite
      ? sourceSuite.map((tc) => ({ ...tc }))
      : normalizeSuiteWithCatchpointDefaults([
          {
            id: 'T01',
            name: `${clonedProp.name} Home Check`,
            path: '/',
            expectedStatus: '200',
            category: 'Core Experience',
          },
        ]);

    const nextState: McpStateStore = {
      ...state,
      properties: [...state.properties, clonedProp],
      suitesByAppId: {
        ...state.suitesByAppId,
        [newAppId]: clonedSuite,
      },
    };
    return {
      state: nextState,
      mutated: true,
      result: {
        action: 'clone',
        sourceAppId: source.id,
        cloned: sanitizePropertyForOutput(clonedProp),
        suiteCount: clonedSuite.length,
        totalProperties: nextState.properties.length,
      },
    };
  }

  if (action === 'delete') {
    const existing = findPropertyOrThrow(state, args.appId);
    if (state.properties.length <= 1) {
      throw new Error('Cannot delete the last remaining property');
    }
    const nextSuites = { ...state.suitesByAppId };
    delete nextSuites[existing.id];
    const nextState: McpStateStore = {
      ...state,
      properties: state.properties.filter((p) => p.id !== existing.id),
      suitesByAppId: nextSuites,
    };
    return {
      state: nextState,
      mutated: true,
      result: {
        action: 'delete',
        deletedAppId: existing.id,
        totalProperties: nextState.properties.length,
      },
    };
  }

  throw new Error(
    `Unsupported manage_property action "${action}". Allowed: list, get, create, update, patch, delete, clone`
  );
}

/**
 * 2. MANAGE ENVIRONMENT (list | get | add | update | patch | delete | clone | reorder |
 *    set_host_map | remove_host_map_key | set_edge_ips | set_networks |
 *    set_headers | set_variables | set_schedule | pin_baseline)
 */
export function executeManageEnvironment(
  state: McpStateStore,
  args: Record<string, unknown>
): McpOperationOutcome {
  const action = String(args.action || 'list').trim().toLowerCase();
  const prop = findPropertyOrThrow(state, args.appId || 'www');

  const commitProp = (nextProp: AppConfig): McpStateStore => ({
    ...state,
    properties: state.properties.map((p) => (p.id === prop.id ? nextProp : p)),
  });

  if (action === 'list') {
    return {
      state,
      mutated: false,
      result: {
        action: 'list',
        appId: prop.id,
        totalEnvironments: prop.envs.length,
        environments: prop.envs.map(sanitizeEnvForOutput),
      },
    };
  }

  if (action === 'get') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const env = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!env) {
      throw new Error(`Environment "${envId}" not found on property "${prop.id}"`);
    }
    return {
      state,
      mutated: false,
      result: {
        action: 'get',
        appId: prop.id,
        environment: sanitizeEnvForOutput(env),
        targets: (env.networks || prop.defaultNetworks || ['prod', 'staging']).map(
          (net) => `${prop.id}.${env.id}.${net}`
        ),
      },
    };
  }

  if (action === 'add' || action === 'create' || action === 'update' || action === 'upsert' || action === 'patch') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if ((action === 'add' || action === 'create') && existing) {
      throw new Error(
        `Environment "${envId}" already exists on "${prop.id}". Use action "update" or "patch".`
      );
    }
    if ((action === 'update' || action === 'patch') && !existing) {
      throw new Error(
        `Environment "${envId}" not found on "${prop.id}". Use action "add" to create it.`
      );
    }

    const canonicalFallback = resolvePropertyHostname(prop.id, 'prod', {
      ...DEFAULT_TEMPLATE_CONFIG,
      properties: state.properties,
    });

    let nextHostMap: HostMap = existing?.hostMap
      ? { ...existing.hostMap }
      : {
          [canonicalFallback]:
            envId === 'prod'
              ? canonicalFallback
              : `${prop.id}-${envId}.${DEFAULT_TEMPLATE_CONFIG.branding.defaultDomain}`,
        };

    if (args.hostMap !== undefined) {
      const parsedMap = sanitizeHostMap(args.hostMap);
      nextHostMap = args.merge === true ? { ...nextHostMap, ...parsedMap } : parsedMap;
    }
    if (args.canonicalHost && args.targetHost) {
      const canon = sanitizeHostname(args.canonicalHost, 'canonicalHost');
      const target = sanitizeHostname(args.targetHost, 'targetHost');
      nextHostMap = { ...nextHostMap, [canon]: target };
    }

    const nextEdgeIps = {
      ...(existing?.edgeIps || {}),
      ...(args.stagingEdgeIp !== undefined
        ? { staging: validatePublicEdgeIp(args.stagingEdgeIp, 'stagingEdgeIp') }
        : {}),
      ...(args.prodEdgeIp !== undefined
        ? { prod: validatePublicEdgeIp(args.prodEdgeIp, 'prodEdgeIp') }
        : {}),
    };

    const rawTier = args.tier !== undefined ? String(args.tier).trim().toLowerCase() : existing?.tier;
    const tier: EnvironmentTier = VALID_TIERS.has(rawTier as EnvironmentTier)
      ? (rawTier as EnvironmentTier)
      : envId === 'prod'
      ? 'prod'
      : 'uat';

    const draft: EnvironmentConfig = {
      ...(existing || { id: envId, name: envId.toUpperCase(), hostMap: nextHostMap }),
      id: envId,
      name:
        args.name !== undefined
          ? String(args.name).trim() || envId.toUpperCase()
          : existing?.name || envId.toUpperCase(),
      tier,
      ...(args.description !== undefined
        ? { description: String(args.description).trim() || undefined }
        : {}),
      hostMap: nextHostMap,
      networks:
        args.networks !== undefined
          ? sanitizeNetworks(args.networks, existing?.networks || ['prod', 'staging'])
          : existing?.networks || ['prod', 'staging'],
      ...(Object.values(nextEdgeIps).some(Boolean) ? { edgeIps: nextEdgeIps } : {}),
      ...(args.defaultPopId !== undefined
        ? { defaultPopId: String(args.defaultPopId).trim().toLowerCase() || undefined }
        : {}),
      ...(args.headers !== undefined
        ? {
            headers:
              args.merge === true
                ? { ...(existing?.headers || {}), ...sanitizeStringRecord(args.headers, { label: 'headers' }) }
                : sanitizeStringRecord(args.headers, { label: 'headers' }),
          }
        : {}),
      ...(args.variables !== undefined
        ? {
            variables:
              args.merge === true
                ? { ...(existing?.variables || {}), ...sanitizeStringRecord(args.variables, { label: 'variables' }) }
                : sanitizeStringRecord(args.variables, { label: 'variables' }),
          }
        : {}),
      ...(args.scheduleIntervalMin !== undefined
        ? { scheduleIntervalMin: Math.max(1, Math.min(1440, Math.round(Number(args.scheduleIntervalMin)))) }
        : {}),
      ...(args.alertThresholdMs !== undefined
        ? { alertThresholdMs: Math.max(50, Math.min(60000, Math.round(Number(args.alertThresholdMs)))) }
        : {}),
      ...(args.pinnedBaselineRunKey !== undefined
        ? { pinnedBaselineRunKey: String(args.pinnedBaselineRunKey).trim() || undefined }
        : {}),
    };

    const validation = validateEnvironmentDraft(draft);
    if (!validation.valid) {
      throw new Error(`Invalid environment configuration: ${Object.values(validation.errors).join('; ')}`);
    }

    const nextProp = upsertEnvironmentInApp(prop, draft, existing?.id);
    const saved = nextProp.envs.find((e) => e.id === envId)!;
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action,
        appId: prop.id,
        environment: sanitizeEnvForOutput(saved),
        totalEnvironments: nextProp.envs.length,
      },
    };
  }

  if (action === 'clone') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const newEnvId = sanitizeSafeId(args.newEnvId, 'newEnvId');
    const src = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!src) {
      throw new Error(`Source environment "${envId}" not found on "${prop.id}"`);
    }
    if (prop.envs.some((e) => e.id.toLowerCase() === newEnvId)) {
      throw new Error(`Environment "${newEnvId}" already exists on "${prop.id}"`);
    }
    const clonedHostMap = args.hostMap ? sanitizeHostMap(args.hostMap) : { ...src.hostMap };
    const clonedEnv: EnvironmentConfig = {
      ...src,
      id: newEnvId,
      name: String(args.name || `${src.name} (${newEnvId.toUpperCase()})`).trim(),
      tier: VALID_TIERS.has(args.tier as EnvironmentTier)
        ? (args.tier as EnvironmentTier)
        : VALID_TIERS.has(newEnvId as EnvironmentTier)
        ? (newEnvId as EnvironmentTier)
        : src.tier,
      hostMap: clonedHostMap,
      networks: src.networks ? [...src.networks] : ['prod', 'staging'],
      ...(src.edgeIps ? { edgeIps: { ...src.edgeIps } } : {}),
      ...(src.headers ? { headers: { ...src.headers } } : {}),
      ...(src.variables ? { variables: { ...src.variables } } : {}),
    };
    const nextProp = upsertEnvironmentInApp(prop, clonedEnv);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'clone',
        appId: prop.id,
        sourceEnvId: envId,
        cloned: sanitizeEnvForOutput(nextProp.envs.find((e) => e.id === newEnvId)!),
        totalEnvironments: nextProp.envs.length,
      },
    };
  }

  if (action === 'delete') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const { app: nextProp, deleted, error } = deleteEnvironmentFromApp(prop, envId);
    if (error) throw new Error(error);
    if (!deleted) {
      throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    }
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'delete',
        appId: prop.id,
        deletedEnvId: envId,
        totalEnvironments: nextProp.envs.length,
        remainingEnvIds: nextProp.envs.map((e) => e.id),
      },
    };
  }

  if (action === 'reorder') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const direction = args.direction === 'down' ? 'down' : 'up';
    if (!prop.envs.some((e) => e.id === envId)) {
      throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    }
    const nextProp = reorderEnvironmentInApp(prop, envId, direction);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'reorder',
        appId: prop.id,
        envId,
        direction,
        order: nextProp.envs.map((e) => e.id),
      },
    };
  }

  if (action === 'set_host_map') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    let nextMap: HostMap;
    if (args.hostMap !== undefined) {
      const cleanMap = sanitizeHostMap(args.hostMap);
      nextMap = args.merge === true ? { ...existing.hostMap, ...cleanMap } : cleanMap;
    } else if (args.canonicalHost && args.targetHost) {
      const canon = sanitizeHostname(args.canonicalHost, 'canonicalHost');
      const target = sanitizeHostname(args.targetHost, 'targetHost');
      nextMap = { ...existing.hostMap, [canon]: target };
    } else {
      throw new Error('Provide either hostMap object or both canonicalHost and targetHost');
    }
    const nextProp = upsertEnvironmentInApp(prop, { ...existing, hostMap: nextMap }, existing.id);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'set_host_map',
        appId: prop.id,
        envId,
        hostMap: nextMap,
      },
    };
  }

  if (action === 'remove_host_map_key') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const key = sanitizeHostname(args.canonicalHost, 'canonicalHost');
    const nextMap = { ...existing.hostMap };
    if (!(key in nextMap)) {
      throw new Error(`hostMap key "${key}" not found on ${prop.id}.${envId}`);
    }
    delete nextMap[key];
    if (Object.keys(nextMap).length === 0) {
      throw new Error('Cannot remove the last hostMap mapping on an environment');
    }
    const nextProp = upsertEnvironmentInApp(prop, { ...existing, hostMap: nextMap }, existing.id);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'remove_host_map_key',
        appId: prop.id,
        envId,
        removedKey: key,
        hostMap: nextMap,
      },
    };
  }

  if (action === 'set_edge_ips') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const nextEdgeIps = {
      ...(existing.edgeIps || {}),
      ...(args.stagingEdgeIp !== undefined
        ? { staging: validatePublicEdgeIp(args.stagingEdgeIp, 'stagingEdgeIp') }
        : {}),
      ...(args.prodEdgeIp !== undefined
        ? { prod: validatePublicEdgeIp(args.prodEdgeIp, 'prodEdgeIp') }
        : {}),
    };
    const nextProp = upsertEnvironmentInApp(prop, { ...existing, edgeIps: nextEdgeIps }, existing.id);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'set_edge_ips',
        appId: prop.id,
        envId,
        edgeIps: nextEdgeIps,
      },
    };
  }

  if (action === 'set_networks') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const networks = sanitizeNetworks(args.networks);
    const nextProp = upsertEnvironmentInApp(prop, { ...existing, networks }, existing.id);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'set_networks',
        appId: prop.id,
        envId,
        networks,
      },
    };
  }

  if (action === 'set_headers') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const incoming = sanitizeStringRecord(args.headers, { label: 'headers' });
    const nextHeaders = args.merge === true ? { ...(existing.headers || {}), ...incoming } : incoming;
    const nextProp = upsertEnvironmentInApp(prop, { ...existing, headers: nextHeaders }, existing.id);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'set_headers',
        appId: prop.id,
        envId,
        headers: redactSensitiveHeadersForOutput(nextHeaders),
      },
    };
  }

  if (action === 'set_variables') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const incoming = sanitizeStringRecord(args.variables, { label: 'variables' });
    const nextVars = args.merge === true ? { ...(existing.variables || {}), ...incoming } : incoming;
    const nextProp = upsertEnvironmentInApp(prop, { ...existing, variables: nextVars }, existing.id);
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'set_variables',
        appId: prop.id,
        envId,
        variables: nextVars,
      },
    };
  }

  if (action === 'set_schedule') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const scheduleIntervalMin =
      args.scheduleIntervalMin !== undefined
        ? Math.max(1, Math.min(1440, Math.round(Number(args.scheduleIntervalMin))))
        : existing.scheduleIntervalMin ?? 5;
    const alertThresholdMs =
      args.alertThresholdMs !== undefined
        ? Math.max(50, Math.min(60000, Math.round(Number(args.alertThresholdMs))))
        : existing.alertThresholdMs ?? 1200;
    const defaultPopId =
      args.defaultPopId !== undefined
        ? String(args.defaultPopId).trim().toLowerCase() || undefined
        : existing.defaultPopId;
    const nextProp = upsertEnvironmentInApp(
      prop,
      { ...existing, scheduleIntervalMin, alertThresholdMs, defaultPopId },
      existing.id
    );
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'set_schedule',
        appId: prop.id,
        envId,
        scheduleIntervalMin,
        alertThresholdMs,
        defaultPopId,
      },
    };
  }

  if (action === 'pin_baseline') {
    const envId = sanitizeSafeId(args.envId, 'envId');
    const existing = prop.envs.find((e) => e.id.toLowerCase() === envId);
    if (!existing) throw new Error(`Environment "${envId}" not found on "${prop.id}"`);
    const pinnedBaselineRunKey = args.pinnedBaselineRunKey
      ? String(args.pinnedBaselineRunKey).trim()
      : undefined;
    const nextProp = upsertEnvironmentInApp(
      prop,
      { ...existing, pinnedBaselineRunKey },
      existing.id
    );
    return {
      state: commitProp(nextProp),
      mutated: true,
      result: {
        action: 'pin_baseline',
        appId: prop.id,
        envId,
        pinnedBaselineRunKey: pinnedBaselineRunKey || null,
      },
    };
  }

  throw new Error(
    `Unsupported manage_environment action "${action}". Allowed: list, get, add, update, patch, delete, clone, reorder, set_host_map, remove_host_map_key, set_edge_ips, set_networks, set_headers, set_variables, set_schedule, pin_baseline`
  );
}

function buildTestCaseDraftFromArgs(
  args: Record<string, unknown>,
  existing: TestCaseDefinition | undefined,
  fallbackId: string
): TestCaseDefinition {
  const testId = args.testId !== undefined && String(args.testId).trim()
    ? sanitizeTestId(args.testId)
    : existing?.id || fallbackId;

  const rawMethod = args.httpMethod !== undefined
    ? String(args.httpMethod).trim().toUpperCase()
    : existing?.httpMethod;
  if (rawMethod && !VALID_HTTP_METHODS.has(rawMethod as NonNullable<TestCaseDefinition['httpMethod']>)) {
    throw new Error(`Invalid httpMethod "${rawMethod}"`);
  }

  const rawDnsType = args.dnsRecordType !== undefined
    ? String(args.dnsRecordType).trim().toUpperCase()
    : existing?.dnsRecordType;
  if (rawDnsType && !VALID_DNS_RECORD_TYPES.has(rawDnsType as NonNullable<TestCaseDefinition['dnsRecordType']>)) {
    throw new Error(`Invalid dnsRecordType "${rawDnsType}"`);
  }

  const rawScriptEngine = args.scriptEngine !== undefined
    ? String(args.scriptEngine).trim().toLowerCase()
    : existing?.scriptEngine;
  if (rawScriptEngine && !VALID_SCRIPT_ENGINES.has(rawScriptEngine as TestScriptEngine)) {
    throw new Error(`Invalid scriptEngine "${rawScriptEngine}"`);
  }

  const draft: TestCaseDefinition = {
    ...(existing || {
      id: testId,
      name: `Synthetic Check ${testId}`,
      path: '/',
      expectedStatus: '200',
    }),
    id: testId,
    name:
      args.name !== undefined
        ? String(args.name).trim()
        : existing?.name || `Synthetic Check ${testId}`,
    path:
      args.path !== undefined
        ? sanitizePathOrUrl(args.path)
        : existing?.path || '/',
    expectedStatus:
      args.expectedStatus !== undefined
        ? String(args.expectedStatus).trim()
        : existing?.expectedStatus || '200',
    ...(args.category !== undefined ? { category: String(args.category).trim() || undefined } : {}),
    ...(args.enabled !== undefined ? { enabled: Boolean(args.enabled) } : {}),
    ...(args.visualGate !== undefined ? { visualGate: Boolean(args.visualGate) } : {}),
    ...(args.critical !== undefined ? { critical: Boolean(args.critical) } : {}),
    ...(args.testType !== undefined ? { testType: String(args.testType).trim() as CatchpointTestType } : {}),
    ...(args.monitorEngine !== undefined ? { monitorEngine: String(args.monitorEngine).trim() } : {}),
    ...(args.folderId !== undefined ? { folderId: String(args.folderId).trim() } : {}),
    ...(args.description !== undefined ? { description: String(args.description).trim() } : {}),
    ...(args.targetHost !== undefined
      ? { targetHost: args.targetHost ? sanitizeHostname(args.targetHost, 'targetHost') : undefined }
      : {}),
    ...(rawMethod ? { httpMethod: rawMethod as TestCaseDefinition['httpMethod'] } : {}),
    ...(args.requestHeaders !== undefined
      ? {
          requestHeaders:
            args.merge === true
              ? {
                  ...(existing?.requestHeaders || {}),
                  ...sanitizeStringRecord(args.requestHeaders, { label: 'requestHeaders' }),
                }
              : sanitizeStringRecord(args.requestHeaders, { label: 'requestHeaders' }),
        }
      : {}),
    ...(args.requestBody !== undefined ? { requestBody: String(args.requestBody) } : {}),
    ...(args.port !== undefined && args.port !== '' ? { port: Math.round(Number(args.port)) } : {}),
    ...(rawDnsType ? { dnsRecordType: rawDnsType as TestCaseDefinition['dnsRecordType'] } : {}),
    ...(args.dnsServer !== undefined ? { dnsServer: String(args.dnsServer).trim() } : {}),
    ...(args.sslMinExpiryDays !== undefined && args.sslMinExpiryDays !== ''
      ? { sslMinExpiryDays: Math.max(1, Math.round(Number(args.sslMinExpiryDays))) }
      : {}),
    ...(args.bgpPrefix !== undefined ? { bgpPrefix: String(args.bgpPrefix).trim() } : {}),
    ...(args.bgpOriginAsn !== undefined ? { bgpOriginAsn: String(args.bgpOriginAsn).trim() } : {}),
    ...(args.transactionSteps !== undefined
      ? { transactionSteps: sanitizeTransactionSteps(args.transactionSteps) }
      : {}),
    ...(rawScriptEngine ? { scriptEngine: rawScriptEngine as TestScriptEngine } : {}),
    ...(args.customScript !== undefined ? { customScript: String(args.customScript) } : {}),
    ...(args.scriptTimeoutMs !== undefined && args.scriptTimeoutMs !== ''
      ? { scriptTimeoutMs: Math.max(500, Math.min(120000, Math.round(Number(args.scriptTimeoutMs)))) }
      : {}),
    ...(args.assertions !== undefined
      ? {
          assertions:
            args.merge === true
              ? { ...(existing?.assertions || {}), ...(sanitizeAssertions(args.assertions) || {}) }
              : sanitizeAssertions(args.assertions),
        }
      : {}),
    ...(args.scheduleIntervalMin !== undefined && args.scheduleIntervalMin !== ''
      ? { scheduleIntervalMin: Math.max(1, Math.min(1440, Math.round(Number(args.scheduleIntervalMin)))) }
      : {}),
    ...(args.slaWarningMs !== undefined && args.slaWarningMs !== ''
      ? { slaWarningMs: Math.max(50, Math.round(Number(args.slaWarningMs))) }
      : {}),
    ...(args.slaCriticalMs !== undefined && args.slaCriticalMs !== ''
      ? { slaCriticalMs: Math.max(100, Math.round(Number(args.slaCriticalMs))) }
      : {}),
    ...(args.tags !== undefined ? { tags: sanitizeTags(args.tags) } : {}),
  };

  const validation = validateTestDraft(draft);
  if (!validation.valid) {
    throw new Error(`Invalid test definition: ${Object.values(validation.errors).join('; ')}`);
  }

  return normalizeTestCaseWithCatchpointDefaults(draft);
}

/**
 * 3. MANAGE TEST SUITE (Full CRUD + Bulk + Catchpoint Protocol + Script + Reorder + Export)
 */
export function executeManageTestSuite(
  state: McpStateStore,
  args: Record<string, unknown>
): McpOperationOutcome {
  const action = String(args.action || 'list').trim().toLowerCase();
  const appId = sanitizeSafeId(args.appId || 'www', 'appId');
  const currentSuite = getSuiteForAppFromState(state, appId);

  const commitSuite = (nextSuite: TestCaseDefinition[]): McpStateStore => ({
    ...state,
    suitesByAppId: {
      ...state.suitesByAppId,
      [appId]: nextSuite,
    },
  });

  if (action === 'list') {
    const q = String(args.search || '').trim().toLowerCase();
    const filterFolder = args.filterFolderId ? String(args.filterFolderId).trim() : '';
    const filterType = args.filterTestType ? String(args.filterTestType).trim().toLowerCase() : '';
    const filterEnabled =
      typeof args.filterEnabled === 'boolean' ? args.filterEnabled : undefined;

    const filtered = currentSuite.filter((c) => {
      if (filterFolder && c.folderId !== filterFolder) return false;
      if (filterType && (c.testType || 'web-chrome').toLowerCase() !== filterType) return false;
      if (filterEnabled !== undefined && (c.enabled !== false) !== filterEnabled) return false;
      if (q && !`${c.id} ${c.name} ${c.path} ${c.category || ''} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    return {
      state,
      mutated: false,
      result: {
        action: 'list',
        appId,
        totalChecks: currentSuite.length,
        matchedChecks: filtered.length,
        enabledChecks: currentSuite.filter((c) => c.enabled !== false).length,
        checks: filtered.map(sanitizeTestForOutput),
      },
    };
  }

  if (action === 'get') {
    const testId = sanitizeTestId(args.testId);
    const check = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!check) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    return {
      state,
      mutated: false,
      result: {
        action: 'get',
        appId,
        check: sanitizeTestForOutput(check),
      },
    };
  }

  if (action === 'upsert' || action === 'create') {
    const nextId =
      args.testId !== undefined && String(args.testId).trim()
        ? sanitizeTestId(args.testId)
        : generateNextTestId(currentSuite);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === nextId);
    if (action === 'create' && existing) {
      throw new Error(`Check "${nextId}" already exists in suite "${appId}". Use "upsert" or "patch".`);
    }
    const draft = buildTestCaseDraftFromArgs({ ...args, testId: nextId }, existing, nextId);
    const nextSuite = upsertTestInSuite(currentSuite, draft, existing?.id);
    const saved = nextSuite.find((c) => c.id.toUpperCase() === nextId)!;
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action,
        appId,
        upserted: sanitizeTestForOutput(saved),
        totalChecks: nextSuite.length,
      },
    };
  }

  if (action === 'patch' || action === 'update') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const nextId = args.newTestId ? sanitizeTestId(args.newTestId) : existing.id;
    const draft = buildTestCaseDraftFromArgs({ ...args, testId: nextId }, existing, nextId);
    const nextSuite = upsertTestInSuite(currentSuite, draft, existing.id);
    const saved = nextSuite.find((c) => c.id.toUpperCase() === nextId)!;
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action,
        appId,
        updated: sanitizeTestForOutput(saved),
        totalChecks: nextSuite.length,
      },
    };
  }

  if (action === 'delete') {
    const testId = sanitizeTestId(args.testId);
    if (!currentSuite.some((c) => c.id.toUpperCase() === testId)) {
      throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    }
    const nextSuite = deleteTestsFromSuite(currentSuite, [testId]);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'delete',
        appId,
        deleted: testId,
        totalChecks: nextSuite.length,
      },
    };
  }

  if (action === 'clone') {
    const testId = sanitizeTestId(args.testId);
    const { suite: nextSuiteRaw, cloned } = cloneTestInSuite(currentSuite, testId);
    if (!cloned) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    let finalSuite = nextSuiteRaw;
    let finalCloned = cloned;
    if (args.newTestId || args.name || args.path) {
      const targetId = args.newTestId ? sanitizeTestId(args.newTestId) : cloned.id;
      const customDraft = buildTestCaseDraftFromArgs(
        {
          ...args,
          testId: targetId,
          name: args.name !== undefined ? args.name : cloned.name,
          path: args.path !== undefined ? args.path : cloned.path,
        },
        cloned,
        targetId
      );
      finalSuite = upsertTestInSuite(nextSuiteRaw, customDraft, cloned.id);
      finalCloned = finalSuite.find((c) => c.id === targetId)!;
    }
    return {
      state: commitSuite(finalSuite),
      mutated: true,
      result: {
        action: 'clone',
        appId,
        sourceTestId: testId,
        cloned: sanitizeTestForOutput(finalCloned),
        totalChecks: finalSuite.length,
      },
    };
  }

  if (action === 'toggle_enabled') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const nextEnabled =
      typeof args.enabled === 'boolean' ? args.enabled : existing.enabled === false;
    const nextSuite = toggleTestsEnabled(currentSuite, [testId], nextEnabled);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'toggle_enabled',
        appId,
        testId,
        enabled: nextEnabled,
      },
    };
  }

  if (action === 'toggle_visual_gate') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const nextVisualGate =
      typeof args.visualGate === 'boolean'
        ? args.visualGate
        : existing.visualGate === false;
    const nextSuite = currentSuite.map((c) =>
      c.id.toUpperCase() === testId ? { ...c, visualGate: nextVisualGate } : c
    );
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'toggle_visual_gate',
        appId,
        testId,
        visualGate: nextVisualGate,
      },
    };
  }

  if (action === 'toggle_critical') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const nextCritical =
      typeof args.critical === 'boolean' ? args.critical : !existing.critical;
    const nextSuite = currentSuite.map((c) =>
      c.id.toUpperCase() === testId ? { ...c, critical: nextCritical } : c
    );
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'toggle_critical',
        appId,
        testId,
        critical: nextCritical,
      },
    };
  }

  if (action === 'reorder') {
    const testId = sanitizeTestId(args.testId);
    const direction = args.direction === 'down' ? 'down' : 'up';
    if (!currentSuite.some((c) => c.id.toUpperCase() === testId)) {
      throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    }
    const nextSuite = reorderTestInSuite(currentSuite, testId, direction);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'reorder',
        appId,
        testId,
        direction,
        order: nextSuite.map((c) => c.id),
      },
    };
  }

  if (action === 'move_to_position') {
    const testId = sanitizeTestId(args.testId);
    const idx = currentSuite.findIndex((c) => c.id.toUpperCase() === testId);
    if (idx < 0) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const rawPos = Number(args.position);
    if (!Number.isFinite(rawPos)) throw new Error('position (1-based integer) is required');
    const targetIdx = Math.max(0, Math.min(currentSuite.length - 1, Math.round(rawPos) - 1));
    const next = [...currentSuite];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    const reindexed = next.map((c, i) => ({ ...c, order: i + 1 }));
    return {
      state: commitSuite(reindexed),
      mutated: true,
      result: {
        action: 'move_to_position',
        appId,
        testId,
        position: targetIdx + 1,
        order: reindexed.map((c) => c.id),
      },
    };
  }

  if (action === 'bulk_upsert') {
    if (!Array.isArray(args.tests) || args.tests.length === 0) {
      throw new Error('tests[] array is required for bulk_upsert');
    }
    let nextSuite = [...currentSuite];
    const upsertedIds: string[] = [];
    for (const rawItem of args.tests) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const itemObj = rawItem as Record<string, unknown>;
      const id =
        itemObj.id || itemObj.testId
          ? sanitizeTestId(itemObj.id || itemObj.testId)
          : generateNextTestId(nextSuite);
      const existing = nextSuite.find((c) => c.id.toUpperCase() === id);
      const draft = buildTestCaseDraftFromArgs({ ...itemObj, testId: id }, existing, id);
      nextSuite = upsertTestInSuite(nextSuite, draft, existing?.id);
      upsertedIds.push(id);
    }
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'bulk_upsert',
        appId,
        upsertedCount: upsertedIds.length,
        upsertedIds,
        totalChecks: nextSuite.length,
      },
    };
  }

  if (action === 'bulk_delete') {
    if (!Array.isArray(args.testIds) || args.testIds.length === 0) {
      throw new Error('testIds[] array is required for bulk_delete');
    }
    const cleanIds = args.testIds.map(sanitizeTestId);
    const nextSuite = deleteTestsFromSuite(currentSuite, cleanIds);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'bulk_delete',
        appId,
        deletedCount: currentSuite.length - nextSuite.length,
        deletedIds: cleanIds,
        totalChecks: nextSuite.length,
      },
    };
  }

  if (action === 'bulk_toggle') {
    if (!Array.isArray(args.testIds) || args.testIds.length === 0) {
      throw new Error('testIds[] array is required for bulk_toggle');
    }
    const cleanIds = args.testIds.map(sanitizeTestId);
    const enabled = args.enabled !== false;
    const nextSuite = toggleTestsEnabled(currentSuite, cleanIds, enabled);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'bulk_toggle',
        appId,
        testIds: cleanIds,
        enabled,
      },
    };
  }

  if (action === 'bulk_assign_folder') {
    if (!Array.isArray(args.testIds) || args.testIds.length === 0) {
      throw new Error('testIds[] array is required for bulk_assign_folder');
    }
    const folderId = sanitizeSafeId(args.folderId, 'folderId');
    const cleanIds = args.testIds.map(sanitizeTestId);
    const nextSuite = moveTestsToFolder(currentSuite, cleanIds, folderId);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'bulk_assign_folder',
        appId,
        folderId,
        assignedTestIds: cleanIds,
      },
    };
  }

  if (action === 'set_headers') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const incoming = sanitizeStringRecord(args.requestHeaders, { label: 'requestHeaders' });
    const nextHeaders =
      args.merge === true ? { ...(existing.requestHeaders || {}), ...incoming } : incoming;
    const nextSuite = currentSuite.map((c) =>
      c.id.toUpperCase() === testId ? { ...c, requestHeaders: nextHeaders } : c
    );
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'set_headers',
        appId,
        testId,
        requestHeaders: redactSensitiveHeadersForOutput(nextHeaders),
      },
    };
  }

  if (action === 'set_assertions') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const incoming = sanitizeAssertions(args.assertions) || {};
    const nextAssertions =
      args.merge === true ? { ...(existing.assertions || {}), ...incoming } : incoming;
    const nextSuite = currentSuite.map((c) =>
      c.id.toUpperCase() === testId ? { ...c, assertions: nextAssertions } : c
    );
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'set_assertions',
        appId,
        testId,
        assertions: nextAssertions,
      },
    };
  }

  if (action === 'set_transaction_steps') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const steps = sanitizeTransactionSteps(args.transactionSteps) || [];
    const nextSuite = currentSuite.map((c) =>
      c.id.toUpperCase() === testId ? { ...c, transactionSteps: steps } : c
    );
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'set_transaction_steps',
        appId,
        testId,
        stepCount: steps.length,
        transactionSteps: steps,
      },
    };
  }

  if (action === 'set_script') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const updated = buildTestCaseDraftFromArgs(
      {
        testId,
        scriptEngine: args.scriptEngine || existing.scriptEngine || 'playwright',
        customScript: args.customScript ?? '',
        ...(args.scriptTimeoutMs !== undefined ? { scriptTimeoutMs: args.scriptTimeoutMs } : {}),
      },
      existing,
      testId
    );
    const nextSuite = upsertTestInSuite(currentSuite, updated, existing.id);
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'set_script',
        appId,
        testId,
        scriptEngine: updated.scriptEngine,
        scriptTimeoutMs: updated.scriptTimeoutMs,
        scriptLength: (updated.customScript || '').length,
      },
    };
  }

  if (action === 'set_tags') {
    const testId = sanitizeTestId(args.testId);
    const existing = currentSuite.find((c) => c.id.toUpperCase() === testId);
    if (!existing) throw new Error(`Check "${testId}" not found in suite "${appId}"`);
    const incomingTags = sanitizeTags(args.tags) || [];
    const nextTags =
      args.merge === true
        ? Array.from(new Set([...(existing.tags || []), ...incomingTags]))
        : incomingTags;
    const nextSuite = currentSuite.map((c) =>
      c.id.toUpperCase() === testId ? { ...c, tags: nextTags } : c
    );
    return {
      state: commitSuite(nextSuite),
      mutated: true,
      result: {
        action: 'set_tags',
        appId,
        testId,
        tags: nextTags,
      },
    };
  }

  if (action === 'export_csv') {
    const header = 'id,name,path,expectedStatus,testType,httpMethod,enabled,folderId,category';
    const escCsv = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = currentSuite.map((c) =>
      [
        c.id,
        c.name,
        c.path,
        c.expectedStatus,
        c.testType || 'web-chrome',
        c.httpMethod || 'GET',
        c.enabled !== false,
        c.folderId || 'folder-core',
        c.category || '',
      ]
        .map(escCsv)
        .join(',')
    );
    return {
      state,
      mutated: false,
      result: {
        action: 'export_csv',
        appId,
        rowCount: currentSuite.length,
        csv: [header, ...rows].join('\n'),
      },
    };
  }

  if (action === 'reset_defaults') {
    const defaults = normalizeSuiteWithCatchpointDefaults(
      PROPERTY_TEST_SUITES[appId] || DEFAULT_TEMPLATE_CONFIG.testSuite
    );
    return {
      state: commitSuite(defaults),
      mutated: true,
      result: {
        action: 'reset_defaults',
        appId,
        totalChecks: defaults.length,
        checkIds: defaults.map((c) => c.id),
      },
    };
  }

  throw new Error(
    `Unsupported manage_test_suite action "${action}". Allowed: list, get, upsert, create, patch, update, delete, clone, toggle_enabled, toggle_visual_gate, toggle_critical, reorder, move_to_position, bulk_upsert, bulk_delete, bulk_toggle, bulk_assign_folder, set_headers, set_assertions, set_transaction_steps, set_script, set_tags, export_csv, reset_defaults`
  );
}

/**
 * 4. MANAGE TEST FOLDERS (list | get | create | update | delete | reorder | assign_tests | reset_defaults)
 */
export function executeManageTestFolders(
  state: McpStateStore,
  args: Record<string, unknown>
): McpOperationOutcome {
  const action = String(args.action || 'list').trim().toLowerCase();

  if (action === 'list') {
    return {
      state,
      mutated: false,
      result: {
        action: 'list',
        totalFolders: state.folders.length,
        folders: state.folders,
      },
    };
  }

  if (action === 'get') {
    const folderId = sanitizeSafeId(args.folderId, 'folderId');
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error(`Folder "${folderId}" not found`);
    return {
      state,
      mutated: false,
      result: { action: 'get', folder },
    };
  }

  if (action === 'create' || action === 'update' || action === 'upsert') {
    const name = String(args.name || '').trim();
    const rawId = args.folderId ? sanitizeSafeId(args.folderId, 'folderId') : '';
    const existing = rawId ? state.folders.find((f) => f.id === rawId) : undefined;
    if (action === 'update' && !existing) {
      throw new Error(`Folder "${rawId}" not found`);
    }
    if (!name && !existing) {
      throw new Error('name is required to create a folder');
    }
    const color =
      args.color && VALID_FOLDER_COLORS.has(args.color as NonNullable<TestFolder['color']>)
        ? (args.color as NonNullable<TestFolder['color']>)
        : existing?.color || 'sky';
    const nextFolders = upsertFolder(state.folders, {
      id: rawId || existing?.id || '',
      name: name || existing!.name,
      description:
        args.description !== undefined
          ? String(args.description).trim()
          : existing?.description,
      color,
      parentId: args.parentId !== undefined ? (args.parentId ? String(args.parentId) : null) : existing?.parentId,
    });
    const saved =
      nextFolders.find((f) => (rawId ? f.id === rawId : f.name === (name || existing?.name))) ||
      nextFolders[nextFolders.length - 1];
    return {
      state: { ...state, folders: nextFolders },
      mutated: true,
      result: {
        action,
        folder: saved,
        totalFolders: nextFolders.length,
      },
    };
  }

  if (action === 'delete') {
    const folderId = sanitizeSafeId(args.folderId, 'folderId');
    if (!state.folders.some((f) => f.id === folderId)) {
      throw new Error(`Folder "${folderId}" not found`);
    }
    if (state.folders.length <= 1) {
      throw new Error('Cannot delete the last remaining folder');
    }
    const fallback = args.fallbackFolderId
      ? sanitizeSafeId(args.fallbackFolderId, 'fallbackFolderId')
      : 'folder-core';
    let nextFolders = state.folders;
    const nextSuites: Record<string, TestCaseDefinition[]> = {};
    for (const [aId, suite] of Object.entries(state.suitesByAppId)) {
      const reassigned = deleteFolderAndReassign(state.folders, suite, folderId, fallback);
      nextFolders = reassigned.folders;
      nextSuites[aId] = reassigned.suite;
    }
    return {
      state: { ...state, folders: nextFolders, suitesByAppId: nextSuites },
      mutated: true,
      result: {
        action: 'delete',
        deletedFolderId: folderId,
        totalFolders: nextFolders.length,
      },
    };
  }

  if (action === 'reorder') {
    const folderId = sanitizeSafeId(args.folderId, 'folderId');
    const idx = state.folders.findIndex((f) => f.id === folderId);
    if (idx < 0) throw new Error(`Folder "${folderId}" not found`);
    const swapIdx = args.direction === 'down' ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= state.folders.length) {
      return {
        state,
        mutated: false,
        result: { action: 'reorder', folderId, order: state.folders.map((f) => f.id) },
      };
    }
    const next = [...state.folders];
    const [moved] = next.splice(idx, 1);
    next.splice(swapIdx, 0, moved);
    const reindexed = next.map((f, i) => ({ ...f, order: i + 1 }));
    return {
      state: { ...state, folders: reindexed },
      mutated: true,
      result: { action: 'reorder', folderId, order: reindexed.map((f) => f.id) },
    };
  }

  if (action === 'assign_tests') {
    const appId = sanitizeSafeId(args.appId || 'www', 'appId');
    const folderId = sanitizeSafeId(args.folderId, 'folderId');
    if (!state.folders.some((f) => f.id === folderId)) {
      throw new Error(`Folder "${folderId}" not found`);
    }
    if (!Array.isArray(args.testIds) || args.testIds.length === 0) {
      throw new Error('testIds[] array is required for assign_tests');
    }
    const cleanIds = args.testIds.map(sanitizeTestId);
    const suite = getSuiteForAppFromState(state, appId);
    const nextSuite = moveTestsToFolder(suite, cleanIds, folderId);
    return {
      state: {
        ...state,
        suitesByAppId: { ...state.suitesByAppId, [appId]: nextSuite },
      },
      mutated: true,
      result: {
        action: 'assign_tests',
        appId,
        folderId,
        assignedTestIds: cleanIds,
      },
    };
  }

  if (action === 'reset_defaults') {
    return {
      state: { ...state, folders: [...DEFAULT_TEST_FOLDERS] },
      mutated: true,
      result: {
        action: 'reset_defaults',
        totalFolders: DEFAULT_TEST_FOLDERS.length,
        folders: DEFAULT_TEST_FOLDERS,
      },
    };
  }

  throw new Error(
    `Unsupported manage_test_folders action "${action}". Allowed: list, get, create, update, delete, reorder, assign_tests, reset_defaults`
  );
}

/**
 * 5. MANAGE GATE POLICIES & WAIVERS
 */
export function executeManageGatePolicies(
  state: McpStateStore,
  args: Record<string, unknown>,
  defaults: McpPolicyState,
  operatorEmail = 'mcp-agent@salesforce.com'
): McpOperationOutcome {
  const action = String(args.action || 'list').trim().toLowerCase();
  const policies = state.policies;

  const commitPolicies = (nextPolicies: McpPolicyState): McpStateStore => ({
    ...state,
    policies: nextPolicies,
  });

  if (action === 'list') {
    return {
      state,
      mutated: false,
      result: {
        action: 'list',
        ignoreAcceptedDiffs: policies.ignoreAcceptedDiffs,
        headerRulesCount: policies.acceptedRules.length,
        activeHeaderRulesCount: policies.acceptedRules.filter((r) => r.enabled).length,
        acceptedCookiesCount: policies.acceptedCookies.length,
        acceptedVisualTestsCount: policies.acceptedVisualTests.length,
        acceptedRules: policies.acceptedRules,
        acceptedCookies: policies.acceptedCookies,
        acceptedVisualTests: policies.acceptedVisualTests,
        acceptedVisualParams: policies.acceptedVisualParams,
      },
    };
  }

  if (action === 'add_header_rule') {
    const field = String(args.field || '').trim().toLowerCase();
    if (!field || !/^[a-z0-9:._\s-]{2,64}$/i.test(field)) {
      throw new Error('field (header or diff kind, e.g. x-check-cacheable, cache-control) is required');
    }
    const appId = args.appId ? sanitizeSafeId(args.appId, 'appId') : 'all';
    const comparisonId = String(args.comparisonId || 'all').trim() || 'all';
    const testId = args.testId ? sanitizeTestId(args.testId) : undefined;
    const rule: AcceptedRule = {
      id:
        args.ruleId && String(args.ruleId).trim()
          ? String(args.ruleId).trim()
          : `rule-${field.replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`,
      appId,
      comparisonId,
      ...(testId ? { testId } : {}),
      kind: field,
      enabled: args.enabled !== false,
      by: operatorEmail,
      at: new Date().toISOString(),
      note: args.note ? String(args.note).trim() : '',
    };
    const nextRules = [...policies.acceptedRules.filter((r) => r.id !== rule.id), rule];
    return {
      state: commitPolicies({ ...policies, acceptedRules: nextRules }),
      mutated: true,
      result: {
        action: 'add_header_rule',
        rule,
        headerRulesCount: nextRules.length,
      },
    };
  }

  if (action === 'toggle_header_rule') {
    const ruleId = String(args.ruleId || '').trim();
    const field = String(args.field || '').trim().toLowerCase();
    const target = policies.acceptedRules.find(
      (r) => (ruleId && r.id === ruleId) || (field && r.kind.toLowerCase() === field)
    );
    if (!target) {
      throw new Error(`Header rule not found (ruleId="${ruleId}", field="${field}")`);
    }
    const nextEnabled = typeof args.enabled === 'boolean' ? args.enabled : !target.enabled;
    const nextRules = policies.acceptedRules.map((r) =>
      r.id === target.id ? { ...r, enabled: nextEnabled } : r
    );
    return {
      state: commitPolicies({ ...policies, acceptedRules: nextRules }),
      mutated: true,
      result: {
        action: 'toggle_header_rule',
        ruleId: target.id,
        field: target.kind,
        enabled: nextEnabled,
      },
    };
  }

  if (action === 'update_header_rule') {
    const ruleId = String(args.ruleId || '').trim();
    const target = policies.acceptedRules.find((r) => r.id === ruleId);
    if (!target) throw new Error(`Header rule "${ruleId}" not found`);
    const updated: AcceptedRule = {
      ...target,
      ...(args.field !== undefined ? { kind: String(args.field).trim().toLowerCase() || target.kind } : {}),
      ...(args.appId !== undefined ? { appId: sanitizeSafeId(args.appId, 'appId') } : {}),
      ...(args.testId !== undefined ? { testId: args.testId ? sanitizeTestId(args.testId) : undefined } : {}),
      ...(args.note !== undefined ? { note: String(args.note).trim() } : {}),
      ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
    };
    const nextRules = policies.acceptedRules.map((r) => (r.id === ruleId ? updated : r));
    return {
      state: commitPolicies({ ...policies, acceptedRules: nextRules }),
      mutated: true,
      result: { action: 'update_header_rule', rule: updated },
    };
  }

  if (action === 'delete_header_rule') {
    const ruleId = String(args.ruleId || '').trim();
    const field = String(args.field || '').trim().toLowerCase();
    const target = policies.acceptedRules.find(
      (r) => (ruleId && r.id === ruleId) || (field && r.kind.toLowerCase() === field)
    );
    if (!target) {
      throw new Error(`Header rule not found (ruleId="${ruleId}", field="${field}")`);
    }
    const nextRules = policies.acceptedRules.filter((r) => r.id !== target.id);
    return {
      state: commitPolicies({ ...policies, acceptedRules: nextRules }),
      mutated: true,
      result: {
        action: 'delete_header_rule',
        deletedRuleId: target.id,
        headerRulesCount: nextRules.length,
      },
    };
  }

  if (action === 'add_cookie_waiver') {
    const names: string[] = [];
    if (args.cookieName) names.push(String(args.cookieName));
    if (Array.isArray(args.cookieNames)) {
      for (const n of args.cookieNames) names.push(String(n));
    }
    const cleanNames = names
      .map((n) => n.trim().toLowerCase())
      .filter((n) => /^[a-z0-9_.-]{1,64}$/.test(n));
    if (cleanNames.length === 0) {
      throw new Error('Provide a valid cookieName or cookieNames[]');
    }
    const nextCookies = Array.from(new Set([...policies.acceptedCookies, ...cleanNames]));
    return {
      state: commitPolicies({ ...policies, acceptedCookies: nextCookies }),
      mutated: true,
      result: {
        action: 'add_cookie_waiver',
        added: cleanNames,
        acceptedCookies: nextCookies,
      },
    };
  }

  if (action === 'remove_cookie_waiver') {
    const cookieName = String(args.cookieName || '').trim().toLowerCase();
    if (!cookieName) throw new Error('cookieName is required');
    const nextCookies = policies.acceptedCookies.filter((c) => c.toLowerCase() !== cookieName);
    return {
      state: commitPolicies({ ...policies, acceptedCookies: nextCookies }),
      mutated: true,
      result: {
        action: 'remove_cookie_waiver',
        removed: cookieName,
        acceptedCookies: nextCookies,
      },
    };
  }

  if (action === 'add_visual_waiver') {
    const testId = sanitizeTestId(args.testId);
    const nextVisuals = Array.from(new Set([...policies.acceptedVisualTests, testId]));
    return {
      state: commitPolicies({ ...policies, acceptedVisualTests: nextVisuals }),
      mutated: true,
      result: {
        action: 'add_visual_waiver',
        testId,
        acceptedVisualTests: nextVisuals,
      },
    };
  }

  if (action === 'remove_visual_waiver') {
    const testId = sanitizeTestId(args.testId);
    const nextVisuals = policies.acceptedVisualTests.filter((id) => id.toUpperCase() !== testId);
    const nextParams = { ...policies.acceptedVisualParams };
    delete nextParams[testId];
    return {
      state: commitPolicies({
        ...policies,
        acceptedVisualTests: nextVisuals,
        acceptedVisualParams: nextParams,
      }),
      mutated: true,
      result: {
        action: 'remove_visual_waiver',
        removed: testId,
        acceptedVisualTests: nextVisuals,
      },
    };
  }

  if (action === 'add_visual_param_waiver') {
    const appId = sanitizeSafeId(args.appId || 'www', 'appId');
    const testId = sanitizeTestId(args.testId);
    const paramId = String(args.paramId || '').trim();
    if (!paramId) throw new Error('paramId is required');
    const key = `${appId}:${testId}`;
    const existing = policies.acceptedVisualParams[key] || [];
    const nextParams = {
      ...policies.acceptedVisualParams,
      [key]: Array.from(new Set([...existing, paramId])),
    };
    return {
      state: commitPolicies({ ...policies, acceptedVisualParams: nextParams }),
      mutated: true,
      result: {
        action: 'add_visual_param_waiver',
        key,
        acceptedParamIds: nextParams[key],
      },
    };
  }

  if (action === 'remove_visual_param_waiver') {
    const appId = sanitizeSafeId(args.appId || 'www', 'appId');
    const testId = sanitizeTestId(args.testId);
    const paramId = String(args.paramId || '').trim();
    if (!paramId) throw new Error('paramId is required');
    const key = `${appId}:${testId}`;
    const existing = policies.acceptedVisualParams[key] || [];
    const filtered = existing.filter((p) => p !== paramId);
    const nextParams = { ...policies.acceptedVisualParams };
    if (filtered.length === 0) delete nextParams[key];
    else nextParams[key] = filtered;
    return {
      state: commitPolicies({ ...policies, acceptedVisualParams: nextParams }),
      mutated: true,
      result: {
        action: 'remove_visual_param_waiver',
        key,
        acceptedParamIds: nextParams[key] || [],
      },
    };
  }

  if (action === 'set_ignore_accepted') {
    const nextVal =
      typeof args.ignoreAcceptedDiffs === 'boolean'
        ? args.ignoreAcceptedDiffs
        : !policies.ignoreAcceptedDiffs;
    return {
      state: commitPolicies({ ...policies, ignoreAcceptedDiffs: nextVal }),
      mutated: true,
      result: {
        action: 'set_ignore_accepted',
        ignoreAcceptedDiffs: nextVal,
      },
    };
  }

  if (action === 'reset_defaults') {
    const fresh: McpPolicyState = {
      acceptedRules: defaults.acceptedRules.map((r) => ({ ...r })),
      acceptedCookies: [...defaults.acceptedCookies],
      acceptedVisualTests: [...defaults.acceptedVisualTests],
      acceptedVisualParams: { ...defaults.acceptedVisualParams },
      ignoreAcceptedDiffs: defaults.ignoreAcceptedDiffs,
    };
    return {
      state: commitPolicies(fresh),
      mutated: true,
      result: {
        action: 'reset_defaults',
        headerRulesCount: fresh.acceptedRules.length,
        acceptedCookiesCount: fresh.acceptedCookies.length,
        ignoreAcceptedDiffs: fresh.ignoreAcceptedDiffs,
      },
    };
  }

  throw new Error(
    `Unsupported manage_gate_policies action "${action}". Allowed: list, add_header_rule, toggle_header_rule, update_header_rule, delete_header_rule, add_cookie_waiver, remove_cookie_waiver, add_visual_waiver, remove_visual_waiver, add_visual_param_waiver, remove_visual_param_waiver, set_ignore_accepted, reset_defaults`
  );
}

/**
 * 6. MANAGE RUNS (list | get | delete | pin_baseline | purge_target)
 * Note: async `seed_fleet` is handled in server.ts/Lambda wrapper around this pure core.
 */
export function executeManageRuns(
  state: McpStateStore,
  args: Record<string, unknown>
): McpOperationOutcome {
  const action = String(args.action || 'list').trim().toLowerCase();

  if (action === 'list') {
    const appId = args.appId ? String(args.appId).trim().toLowerCase() : '';
    const target = args.target ? String(args.target).trim().toLowerCase() : '';
    const limit = Math.max(1, Math.min(200, Math.round(Number(args.limit || 50))));
    const filtered = state.runs.filter((r) => {
      if (appId && r.appId.toLowerCase() !== appId) return false;
      if (target && r.target.toLowerCase() !== target) return false;
      return true;
    });
    return {
      state,
      mutated: false,
      result: {
        action: 'list',
        totalRuns: filtered.length,
        runs: filtered.slice(0, limit).map((r) => ({
          key: r.key,
          target: r.target,
          appId: r.appId,
          envId: r.envId,
          network: r.network,
          startTime: r.startTime,
          totalTests: r.totalTests,
          passedTests: r.passedTests,
          failedTests: r.failedTests,
          label: r.label,
          pinnedAsBaseline: Boolean(r.pinnedAsBaseline),
          by: r.by,
        })),
      },
    };
  }

  if (action === 'get') {
    const runKey = String(args.runKey || '').trim();
    const run = state.runs.find((r) => r.key === runKey);
    if (!run) throw new Error(`Run "${runKey}" not found`);
    return {
      state,
      mutated: false,
      result: {
        action: 'get',
        run: {
          ...run,
          results: run.results.map((res) => ({
            ...res,
            requestHeadersSent: redactSensitiveHeadersForOutput(res.requestHeadersSent),
          })),
        },
      },
    };
  }

  if (action === 'pin_baseline') {
    const runKey = String(args.runKey || '').trim();
    const run = state.runs.find((r) => r.key === runKey);
    if (!run) throw new Error(`Run "${runKey}" not found`);
    const pinned = args.pinned !== false;
    const nextRuns = state.runs.map((r) => {
      if (r.target !== run.target) return r;
      if (r.key === run.key) return { ...r, pinnedAsBaseline: pinned };
      return pinned ? { ...r, pinnedAsBaseline: false } : r;
    });
    return {
      state: { ...state, runs: nextRuns },
      mutated: true,
      result: {
        action: 'pin_baseline',
        runKey: run.key,
        target: run.target,
        pinnedAsBaseline: pinned,
      },
    };
  }

  if (action === 'delete') {
    const runKey = String(args.runKey || '').trim();
    if (!runKey) throw new Error('runKey is required to delete a run');
    const exists = state.runs.some((r) => r.key === runKey);
    if (!exists) throw new Error(`Run "${runKey}" not found`);
    const nextRuns = state.runs.filter((r) => r.key !== runKey);
    return {
      state: { ...state, runs: nextRuns },
      mutated: true,
      result: {
        action: 'delete',
        deletedRunKey: runKey,
        remainingRuns: nextRuns.length,
      },
    };
  }

  if (action === 'purge_target') {
    const target = String(args.target || '').trim().toLowerCase();
    if (!target) throw new Error('target (e.g. www.prod.staging) is required for purge_target');
    const keepLatest = Math.max(0, Math.round(Number(args.keepLatest ?? 1)));
    const matching = state.runs.filter((r) => r.target.toLowerCase() === target);
    const keepKeys = new Set(matching.slice(0, keepLatest).map((r) => r.key));
    const nextRuns = state.runs.filter(
      (r) => r.target.toLowerCase() !== target || keepKeys.has(r.key)
    );
    return {
      state: { ...state, runs: nextRuns },
      mutated: matching.length > keepKeys.size,
      result: {
        action: 'purge_target',
        target,
        purgedCount: state.runs.length - nextRuns.length,
        keptCount: keepKeys.size,
      },
    };
  }

  throw new Error(
    `Unsupported manage_runs action "${action}". Allowed: list, get, pin_baseline, delete, purge_target, seed_fleet`
  );
}
