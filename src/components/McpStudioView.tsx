import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  KeyRound,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  MCP_PROMPTS,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_RESOURCE_TEMPLATES,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOLS,
  buildMcpClientSnippets,
  type JsonSchemaProperty,
  type McpToolDefinition,
} from '../engine/mcpProtocol';
import type {
  McpAuditEvent,
  McpAuthPolicy,
  McpScope,
  McpScopeMeta,
  McpTokenPublicView,
} from '../engine/mcpAuth';
import {
  InspectorDimensionTab,
  PropertyGateSummary,
} from '../engine/workbenchModel';

export interface McpStudioViewProps {
  activeAppId: string;
  propertySummaries: PropertyGateSummary[];
  onOpenWorkbench: () => void;
  onInspectPropertyInWorkbench: (
    appId: string,
    testId?: string,
    tab?: InspectorDimensionTab
  ) => void;
  onConfigMutated?: () => void;
}

type McpSubTab = 'studio' | 'resources' | 'tokens' | 'clients';
type RpcAuthTestMode = 'studio' | 'bearer' | 'unauthenticated';
type TokenRightPaneMode = 'tokens' | 'audit';

interface ToolPreset {
  label: string;
  args: Record<string, unknown>;
}

const FALLBACK_MCP_SCOPES: McpScopeMeta[] = [
  {
    scope: 'mcp:read',
    label: 'Read & Inspect',
    description: 'Read properties, envs, suites, policies, verdicts, evidence, and resources.',
    tools: ['list_akamai_properties', 'get_fleet_status', 'get_property_gate', 'compare_targets'],
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

const TOKEN_ROLE_PRESETS: Array<{ label: string; scopes: McpScope[] }> = [
  { label: 'Read-Only Auditor', scopes: ['mcp:read'] },
  {
    label: 'Env & Test Author',
    scopes: ['mcp:read', 'mcp:write:env', 'mcp:write:tests', 'mcp:write:policies'],
  },
  { label: 'Full Admin', scopes: ['mcp:admin'] },
];

const DEFAULT_POLICY_VIEW: McpAuthPolicy = {
  enforceAuth: false,
  requireAuthForReads: false,
  allowSameOriginStudio: true,
  defaultRateLimitRpm: 120,
  updatedAt: '',
  updatedBy: 'system',
};

function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatExpiryLabel(expiresAt: string | null, isExpired: boolean): string {
  if (!expiresAt) return 'Never';
  if (isExpired) return 'Expired';
  const diffDays = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 1) return '<1d';
  return `${diffDays}d`;
}

const ACTION_PARAM_MAP: Record<string, Record<string, string[]>> = {
  manage_environment: {
    list: ['action', 'appId'],
    get: ['action', 'appId', 'envId'],
    add: ['action', 'appId', 'envId', 'name', 'tier', 'hostMap', 'networks'],
    update: ['action', 'appId', 'envId', 'name', 'tier', 'hostMap', 'networks'],
    patch: ['action', 'appId', 'envId', 'name', 'tier', 'description'],
    clone: ['action', 'appId', 'envId', 'newEnvId', 'name'],
    delete: ['action', 'appId', 'envId'],
    reorder: ['action', 'appId', 'envId', 'direction'],
    set_host_map: ['action', 'appId', 'envId', 'hostMap', 'canonicalHost', 'targetHost', 'merge'],
    remove_host_map_key: ['action', 'appId', 'envId', 'canonicalHost'],
    set_edge_ips: ['action', 'appId', 'envId', 'stagingEdgeIp', 'prodEdgeIp'],
    set_networks: ['action', 'appId', 'envId', 'networks'],
    set_headers: ['action', 'appId', 'envId', 'headers', 'merge'],
    set_variables: ['action', 'appId', 'envId', 'variables', 'merge'],
    set_schedule: ['action', 'appId', 'envId', 'scheduleIntervalMin', 'alertThresholdMs', 'defaultPopId'],
    pin_baseline: ['action', 'appId', 'envId', 'pinnedBaselineRunKey'],
  },
  manage_test_suite: {
    list: ['action', 'appId', 'search', 'filterFolderId', 'filterTestType'],
    get: ['action', 'appId', 'testId'],
    create: ['action', 'appId', 'testId', 'name', 'path', 'testType', 'httpMethod', 'expectedStatus'],
    upsert: ['action', 'appId', 'testId', 'name', 'path', 'testType', 'httpMethod', 'expectedStatus'],
    patch: ['action', 'appId', 'testId', 'name', 'path', 'assertions'],
    update: ['action', 'appId', 'testId', 'name', 'path', 'testType', 'expectedStatus'],
    delete: ['action', 'appId', 'testId'],
    clone: ['action', 'appId', 'testId', 'newTestId', 'name'],
    toggle_enabled: ['action', 'appId', 'testId', 'enabled'],
    toggle_visual_gate: ['action', 'appId', 'testId', 'enabled'],
    toggle_critical: ['action', 'appId', 'testId', 'enabled'],
    reorder: ['action', 'appId', 'testId', 'direction'],
    move_to_position: ['action', 'appId', 'testId', 'position'],
    bulk_upsert: ['action', 'appId', 'tests'],
    bulk_delete: ['action', 'appId', 'testIds'],
    bulk_toggle: ['action', 'appId', 'testIds', 'enabled'],
    bulk_assign_folder: ['action', 'appId', 'testIds', 'folderId'],
    set_headers: ['action', 'appId', 'testId', 'requestHeaders', 'merge'],
    set_assertions: ['action', 'appId', 'testId', 'assertions'],
    set_transaction_steps: ['action', 'appId', 'testId', 'transactionSteps'],
    set_script: ['action', 'appId', 'testId', 'scriptEngine', 'scriptContent'],
    set_tags: ['action', 'appId', 'testId', 'tags'],
    export_csv: ['action', 'appId'],
    reset_defaults: ['action', 'appId'],
  },
  manage_property: {
    list: ['action', 'search'],
    get: ['action', 'appId'],
    create: ['action', 'appId', 'name', 'canonicalHost', 'division', 'tags'],
    update: ['action', 'appId', 'name', 'division', 'description', 'tags'],
    patch: ['action', 'appId', 'name', 'description', 'tags', 'headers', 'merge'],
    clone: ['action', 'appId', 'newAppId', 'name', 'cloneSuite'],
    delete: ['action', 'appId'],
  },
  manage_test_folders: {
    list: ['action'],
    get: ['action', 'folderId'],
    create: ['action', 'folderId', 'name', 'color', 'description'],
    update: ['action', 'folderId', 'name', 'color', 'description'],
    delete: ['action', 'folderId', 'reassignToFolderId'],
    reorder: ['action', 'folderId', 'direction'],
    assign_tests: ['action', 'appId', 'folderId', 'testIds'],
    reset_defaults: ['action'],
  },
  manage_gate_policies: {
    list: ['action'],
    add_header_rule: ['action', 'field', 'appId', 'enabled', 'note'],
    toggle_header_rule: ['action', 'ruleId', 'field', 'enabled'],
    update_header_rule: ['action', 'ruleId', 'field', 'enabled', 'note'],
    delete_header_rule: ['action', 'ruleId', 'field'],
    add_cookie_waiver: ['action', 'cookieName'],
    remove_cookie_waiver: ['action', 'cookieName'],
    add_visual_waiver: ['action', 'testId'],
    remove_visual_waiver: ['action', 'testId'],
    add_visual_param_waiver: ['action', 'appId', 'testId', 'paramId'],
    remove_visual_param_waiver: ['action', 'appId', 'testId', 'paramId'],
    set_ignore_accepted: ['action', 'ignoreAcceptedDiffs'],
    reset_defaults: ['action'],
  },
  manage_runs: {
    list: ['action', 'appId', 'target', 'limit'],
    get: ['action', 'runKey'],
    pin_baseline: ['action', 'runKey', 'pinned'],
    delete: ['action', 'runKey'],
    purge_target: ['action', 'target', 'keepLatest'],
    seed_fleet: ['action'],
  },
};

function getVisibleKeysForAction(
  toolName: string,
  actionValue: unknown
): Set<string> | null {
  const toolMap = ACTION_PARAM_MAP[toolName];
  if (!toolMap) return null;
  const actionKey = typeof actionValue === 'string' ? actionValue.trim().toLowerCase() : '';
  const keys = toolMap[actionKey];
  return keys ? new Set(keys) : null;
}

function buildToolPresets(toolName: string, appId: string): ToolPreset[] {
  const site = appId || 'www';
  const host = site === 'www' ? 'www.salesforce.com' : `${site}.salesforce.com`;
  if (toolName === 'manage_environment') {
    return [
      { label: 'List Envs', args: { action: 'list', appId: site } },
      {
        label: 'Add QA Env',
        args: {
          action: 'add',
          appId: site,
          envId: 'qa',
          name: 'QA Edge',
          tier: 'qa',
          hostMap: { [host]: `qa.${host}` },
          networks: ['staging', 'prod'],
        },
      },
      {
        label: 'Set HostMap',
        args: {
          action: 'set_host_map',
          appId: site,
          envId: 'uat',
          hostMap: { [host]: `uat.${host}` },
          merge: true,
        },
      },
      {
        label: 'Set Edge IPs',
        args: {
          action: 'set_edge_ips',
          appId: site,
          envId: 'prod',
          stagingEdgeIp: '23.192.228.80',
          prodEdgeIp: '23.192.228.84',
        },
      },
      {
        label: 'Set Headers',
        args: {
          action: 'set_headers',
          appId: site,
          envId: 'prod',
          headers: { 'x-release-ring': 'canary' },
          merge: true,
        },
      },
      {
        label: 'Clone Env',
        args: {
          action: 'clone',
          appId: site,
          envId: 'prod',
          newEnvId: 'canary',
          name: 'Canary Ring',
        },
      },
    ];
  }
  if (toolName === 'manage_test_suite') {
    return [
      { label: 'List Checks', args: { action: 'list', appId: site } },
      {
        label: 'Upsert API Check',
        args: {
          action: 'upsert',
          appId: site,
          name: 'Edge Health Check',
          path: '/api/health',
          testType: 'api',
          httpMethod: 'GET',
          expectedStatus: 200,
          enabled: true,
          visualGate: false,
        },
      },
      {
        label: 'Patch Assertions',
        args: {
          action: 'patch',
          appId: site,
          testId: 'T01',
          assertions: {
            expectedBodyMatch: 'Salesforce',
            maxLatencyMs: 1200,
            minTlsVersion: 'TLSv1.3',
          },
        },
      },
      { label: 'Clone T01', args: { action: 'clone', appId: site, testId: 'T01' } },
      {
        label: 'Toggle Visual',
        args: {
          action: 'toggle_visual_gate',
          appId: site,
          testId: 'T01',
          enabled: true,
        },
      },
      {
        label: 'Reorder',
        args: { action: 'reorder', appId: site, testId: 'T02', direction: 'up' },
      },
      { label: 'Export CSV', args: { action: 'export_csv', appId: site } },
    ];
  }
  if (toolName === 'manage_property') {
    return [
      { label: 'List Sites', args: { action: 'list' } },
      { label: 'Get Site', args: { action: 'get', appId: site } },
      {
        label: 'Patch Tags',
        args: {
          action: 'patch',
          appId: site,
          tags: ['tier-0', 'akamai-edge'],
        },
      },
      {
        label: 'Clone Site',
        args: {
          action: 'clone',
          appId: site,
          newAppId: `${site}-canary`,
          name: `${site.toUpperCase()} Canary`,
          cloneSuite: true,
        },
      },
    ];
  }
  if (toolName === 'manage_test_folders') {
    return [
      { label: 'List Folders', args: { action: 'list' } },
      {
        label: 'Create Folder',
        args: {
          action: 'create',
          folderId: 'release-smoke',
          name: 'Release Smoke',
          color: 'sky',
          description: 'Critical pre-release edge checks',
        },
      },
      {
        label: 'Assign Tests',
        args: {
          action: 'assign_tests',
          appId: site,
          folderId: 'core-web',
          testIds: ['T01', 'T02'],
        },
      },
    ];
  }
  if (toolName === 'manage_gate_policies') {
    return [
      { label: 'List Policies', args: { action: 'list' } },
      {
        label: 'Add Header Rule',
        args: {
          action: 'add_header_rule',
          field: 'x-release-ring',
          appId: site,
          enabled: true,
          note: 'Accepted canary routing header',
        },
      },
      {
        label: 'Waive Cookie',
        args: { action: 'add_cookie_waiver', cookieName: 'OptanonConsent' },
      },
      {
        label: 'Waive Visual',
        args: { action: 'add_visual_waiver', testId: 'T03' },
      },
    ];
  }
  if (toolName === 'manage_runs') {
    return [
      { label: 'List Runs', args: { action: 'list', appId: site, limit: 15 } },
      { label: 'Seed Fleet', args: { action: 'seed_fleet' } },
    ];
  }
  return [];
}

function pruneToolArguments(
  tool: McpToolDefinition,
  rawArgs: Record<string, unknown>
): Record<string, unknown> {
  const requiredSet = new Set(tool.inputSchema.required || []);
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    const val = rawArgs[key];
    if (val === undefined || val === null) continue;
    if (typeof val === 'string') {
      if (val.trim() === '' && !requiredSet.has(key)) continue;
      out[key] = val;
      continue;
    }
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) continue;
      out[key] = prop.type === 'integer' ? Math.trunc(val) : val;
      continue;
    }
    out[key] = val;
  }
  return out;
}

export const McpStudioView: React.FC<McpStudioViewProps> = ({
  activeAppId,
  propertySummaries,
  onOpenWorkbench,
  onConfigMutated,
}) => {
  const [subTab, setSubTab] = useState<McpSubTab>('studio');
  const [toolQuery, setToolQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [selectedToolName, setSelectedToolName] = useState<string>(
    'manage_environment'
  );
  const [showAllParams, setShowAllParams] = useState<boolean>(false);
  const [rawJsonDrafts, setRawJsonDrafts] = useState<Record<string, string>>({});
  const [jsonFieldErrors, setJsonFieldErrors] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Per-tool editable argument state seeded from tool defaults + activeAppId
  const [argsByTool, setArgsByTool] = useState<
    Record<string, Record<string, unknown>>
  >(() => {
    const initial: Record<string, Record<string, unknown>> = {};
    for (const tool of MCP_TOOLS) {
      initial[tool.name] = { ...tool.sampleArguments };
    }
    return initial;
  });

  // Handshake state
  const [handshakeStatus, setHandshakeStatus] = useState<{
    checked: boolean;
    ok: boolean;
    latencyMs?: number;
    sessionId?: string;
    serverName?: string;
    protocolVersion?: string;
    error?: string;
  }>({ checked: false, ok: false });
  const [isHandshaking, setIsHandshaking] = useState(false);

  // RPC Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [rpcResult, setRpcResult] = useState<{
    statusCode: number;
    latencyMs: number;
    sessionId?: string;
    rateLimitRemaining?: string;
    rateLimitLimit?: string;
    payload: unknown;
    executedAt: string;
  } | null>(null);

  // Access Tokens, Policy, Audit & In-Memory Secret State (NEVER persisted to storage)
  const [authPolicy, setAuthPolicy] = useState<McpAuthPolicy>(DEFAULT_POLICY_VIEW);
  const [scopesCatalog, setScopesCatalog] = useState<McpScopeMeta[]>(FALLBACK_MCP_SCOPES);
  const [tokens, setTokens] = useState<McpTokenPublicView[]>([]);
  const [auditLog, setAuditLog] = useState<McpAuditEvent[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokenActionError, setTokenActionError] = useState<string | null>(null);
  const [policySavingKey, setPolicySavingKey] = useState<string | null>(null);
  const [tokenRightPane, setTokenRightPane] = useState<TokenRightPaneMode>('tokens');
  const [auditDecisionFilter, setAuditDecisionFilter] = useState<'all' | 'allowed' | 'denied'>('all');

  // Newly generated / rotated secret held strictly in memory
  const [revealedSecret, setRevealedSecret] = useState<{
    rawToken: string;
    tokenName: string;
    prefix: string;
    notice: string;
  } | null>(null);
  const [activeBearerToken, setActiveBearerToken] = useState<string>('');
  const [rpcAuthMode, setRpcAuthMode] = useState<RpcAuthTestMode>('studio');
  const [injectTokenInSnippets, setInjectTokenInSnippets] = useState<boolean>(false);

  // Create Token Form State
  const [newTokenName, setNewTokenName] = useState<string>('');
  const [newTokenScopes, setNewTokenScopes] = useState<McpScope[]>([
    'mcp:read',
    'mcp:write:env',
    'mcp:write:tests',
  ]);
  const [newTokenAllSites, setNewTokenAllSites] = useState<boolean>(true);
  const [newTokenAppIds, setNewTokenAppIds] = useState<string[]>([]);
  const [newTokenExpiryDays, setNewTokenExpiryDays] = useState<string>('90');
  const [newTokenRpm, setNewTokenRpm] = useState<number>(120);
  const [isCreatingToken, setIsCreatingToken] = useState<boolean>(false);
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);

  // Resources & Prompts state
  const [selectedResourceUri, setSelectedResourceUri] = useState<string>(
    MCP_RESOURCES[0].uri
  );
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceResponse, setResourceResponse] = useState<{
    uri: string;
    latencyMs: number;
    payload: unknown;
  } | null>(null);

  const [selectedPromptName, setSelectedPromptName] = useState<string>(
    MCP_PROMPTS[0].name
  );
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({
    appId: activeAppId || 'www',
    testId: 'T01',
  });
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptResponse, setPromptResponse] = useState<unknown>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:3000';

  const clientSnippets = useMemo(
    () =>
      buildMcpClientSnippets(
        origin,
        undefined,
        injectTokenInSnippets && activeBearerToken.trim()
          ? activeBearerToken.trim()
          : undefined
      ),
    [origin, injectTokenInSnippets, activeBearerToken]
  );

  const activeTool: McpToolDefinition = useMemo(
    () =>
      MCP_TOOLS.find((t) => t.name === selectedToolName) || MCP_TOOLS[0],
    [selectedToolName]
  );

  const activeArgs = useMemo(
    () => argsByTool[activeTool.name] || activeTool.sampleArguments,
    [argsByTool, activeTool]
  );

  const cleanedActiveArgs = useMemo(
    () => pruneToolArguments(activeTool, activeArgs),
    [activeTool, activeArgs]
  );

  const activeToolPresets = useMemo(
    () => buildToolPresets(activeTool.name, activeAppId),
    [activeTool.name, activeAppId]
  );

  const activeToolJsonErrors = useMemo(() => {
    const prefix = `${activeTool.name}:`;
    return Object.entries(jsonFieldErrors).filter(
      ([k, v]) => k.startsWith(prefix) && Boolean(v)
    );
  }, [activeTool.name, jsonFieldErrors]);

  const filteredTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    return MCP_TOOLS.filter((tool) => {
      if (categoryFilter !== 'All' && tool.category !== categoryFilter) {
        return false;
      }
      if (q) {
        const hay = `${tool.name} ${tool.title} ${tool.description} ${tool.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [toolQuery, categoryFilter]);

  const jsonRpcRequestObject = useMemo(
    () => ({
      jsonrpc: '2.0',
      id: `mcp-${activeTool.name}`,
      method: 'tools/call',
      params: {
        name: activeTool.name,
        arguments: cleanedActiveArgs,
      },
    }),
    [activeTool.name, cleanedActiveArgs]
  );

  const jsonRpcCurl = useMemo(() => {
    const lines = [
      `curl -sS -X POST "${origin}/api/v1/mcp/rpc" \\`,
      `  -H "Content-Type: application/json" \\`,
    ];
    if (rpcAuthMode === 'bearer' && activeBearerToken.trim()) {
      lines.push(`  -H "Authorization: Bearer ${activeBearerToken.trim()}" \\`);
    } else if (authPolicy.enforceAuth && rpcAuthMode !== 'unauthenticated') {
      lines.push(`  -H "Authorization: Bearer \${RELEASE_GATE_MCP_TOKEN}" \\`);
    }
    lines.push(`  -d '${JSON.stringify(jsonRpcRequestObject)}'`);
    return lines.join('\n');
  }, [origin, jsonRpcRequestObject, rpcAuthMode, activeBearerToken, authPolicy.enforceAuth]);

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  };

  const updateToolArg = (field: string, value: unknown) => {
    setArgsByTool((prev) => {
      const nextToolArgs = {
        ...(prev[activeTool.name] || activeTool.sampleArguments),
      };
      if (value === undefined) {
        delete nextToolArgs[field];
      } else {
        nextToolArgs[field] = value;
      }
      return {
        ...prev,
        [activeTool.name]: nextToolArgs,
      };
    });
  };

  const applyToolPreset = (presetArgs: Record<string, unknown>) => {
    setArgsByTool((prev) => ({
      ...prev,
      [activeTool.name]: { ...presetArgs },
    }));
    const prefix = `${activeTool.name}:`;
    setRawJsonDrafts((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(prefix)) delete next[k];
      }
      return next;
    });
    setJsonFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(prefix)) delete next[k];
      }
      return next;
    });
  };

  const handleJsonFieldChange = (
    field: string,
    prop: JsonSchemaProperty,
    rawText: string
  ) => {
    const draftKey = `${activeTool.name}:${field}`;
    setRawJsonDrafts((prev) => ({ ...prev, [draftKey]: rawText }));
    if (rawText.trim() === '') {
      setJsonFieldErrors((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      updateToolArg(field, undefined);
      return;
    }
    try {
      const parsed = JSON.parse(rawText);
      if (prop.type === 'array' && !Array.isArray(parsed)) {
        setJsonFieldErrors((prev) => ({
          ...prev,
          [draftKey]: 'Expected a JSON array (e.g. ["a", "b"])',
        }));
        return;
      }
      if (
        prop.type === 'object' &&
        (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      ) {
        setJsonFieldErrors((prev) => ({
          ...prev,
          [draftKey]: 'Expected a JSON object (e.g. {"key": "value"})',
        }));
        return;
      }
      setJsonFieldErrors((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      updateToolArg(field, parsed);
    } catch {
      setJsonFieldErrors((prev) => ({
        ...prev,
        [draftKey]: `Invalid JSON ${prop.type}`,
      }));
    }
  };

  const buildRpcHeaders = useCallback(
    (extra?: Record<string, string>): Record<string, string> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(extra || {}),
      };
      if (rpcAuthMode === 'bearer' && activeBearerToken.trim()) {
        headers.Authorization = `Bearer ${activeBearerToken.trim()}`;
      } else if (rpcAuthMode === 'studio') {
        headers['X-MCP-Studio-Origin'] = 'same-origin';
      }
      return headers;
    },
    [rpcAuthMode, activeBearerToken]
  );

  const fetchMcpTokensAndAudit = useCallback(async () => {
    setTokensLoading(true);
    try {
      const resp = await fetch('/api/v1/mcp/tokens');
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.policy) setAuthPolicy(data.policy);
      if (Array.isArray(data?.scopesCatalog) && data.scopesCatalog.length > 0) {
        setScopesCatalog(data.scopesCatalog);
      }
      if (Array.isArray(data?.tokens)) setTokens(data.tokens);
      if (Array.isArray(data?.auditLog)) setAuditLog(data.auditLog);
    } catch {
      // Non-fatal in transient disconnect
    } finally {
      setTokensLoading(false);
    }
  }, []);

  const handleToggleAuthPolicy = async (
    key: 'enforceAuth' | 'requireAuthForReads' | 'allowSameOriginStudio',
    nextValue: boolean
  ) => {
    setPolicySavingKey(key);
    setTokenActionError(null);
    try {
      const resp = await fetch('/api/v1/mcp/auth-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: nextValue }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setTokenActionError(data?.error || 'Failed to update auth policy');
        return;
      }
      if (data?.policy) setAuthPolicy(data.policy);
    } catch (err: unknown) {
      setTokenActionError(err instanceof Error ? err.message : 'Policy update failed');
    } finally {
      setPolicySavingKey(null);
    }
  };

  const handleToggleNewScope = (scope: McpScope) => {
    setNewTokenScopes((prev) => {
      if (scope === 'mcp:admin') {
        return prev.includes('mcp:admin') ? ['mcp:read'] : ['mcp:admin'];
      }
      const withoutAdmin = prev.filter((s) => s !== 'mcp:admin');
      if (withoutAdmin.includes(scope)) {
        const next = withoutAdmin.filter((s) => s !== scope);
        return next.length > 0 ? next : ['mcp:read'];
      }
      return [...withoutAdmin, scope];
    });
  };

  const handleToggleNewAppId = (appId: string) => {
    setNewTokenAllSites(false);
    setNewTokenAppIds((prev) =>
      prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId]
    );
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newTokenName.trim();
    if (cleanName.length < 2) {
      setTokenActionError('Enter a token name (at least 2 characters).');
      return;
    }
    setIsCreatingToken(true);
    setTokenActionError(null);
    try {
      const allowedAppIds =
        newTokenAllSites || newTokenAppIds.length === 0 ? ['*'] : newTokenAppIds;
      const expiresInDays =
        newTokenExpiryDays === 'never' ? null : Number(newTokenExpiryDays);
      const resp = await fetch('/api/v1/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          scopes: newTokenScopes,
          allowedAppIds,
          expiresInDays,
          rateLimitRpm: newTokenRpm,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setTokenActionError(data?.error || 'Failed to generate token');
        return;
      }
      setRevealedSecret({
        rawToken: data.rawToken,
        tokenName: data.token.name,
        prefix: data.token.prefix,
        notice: data.oneTimeNotice || 'Copy this token now. It will not be shown again.',
      });
      setNewTokenName('');
      await fetchMcpTokensAndAudit();
    } catch (err: unknown) {
      setTokenActionError(err instanceof Error ? err.message : 'Token generation failed');
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleToggleTokenDisabled = async (token: McpTokenPublicView) => {
    setBusyTokenId(token.id);
    setTokenActionError(null);
    try {
      const nextStatus = token.status === 'active' ? 'disabled' : 'active';
      const resp = await fetch(`/api/v1/mcp/tokens/${encodeURIComponent(token.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setTokenActionError(data?.error || 'Failed to update token status');
        return;
      }
      await fetchMcpTokensAndAudit();
    } finally {
      setBusyTokenId(null);
    }
  };

  const handleRotateToken = async (token: McpTokenPublicView) => {
    setBusyTokenId(token.id);
    setTokenActionError(null);
    try {
      const resp = await fetch(
        `/api/v1/mcp/tokens/${encodeURIComponent(token.id)}/rotate`,
        { method: 'POST' }
      );
      const data = await resp.json();
      if (!resp.ok) {
        setTokenActionError(data?.error || 'Failed to rotate token');
        return;
      }
      setRevealedSecret({
        rawToken: data.rawToken,
        tokenName: data.token.name,
        prefix: data.token.prefix,
        notice:
          data.oneTimeNotice ||
          'Previous secret invalidated immediately. Copy the rotated token now.',
      });
      await fetchMcpTokensAndAudit();
    } finally {
      setBusyTokenId(null);
    }
  };

  const handleRevokeToken = async (token: McpTokenPublicView) => {
    setBusyTokenId(token.id);
    setTokenActionError(null);
    try {
      const resp = await fetch(
        `/api/v1/mcp/tokens/${encodeURIComponent(token.id)}/revoke`,
        { method: 'POST' }
      );
      const data = await resp.json();
      if (!resp.ok) {
        setTokenActionError(data?.error || 'Failed to revoke token');
        return;
      }
      await fetchMcpTokensAndAudit();
    } finally {
      setBusyTokenId(null);
    }
  };

  const handleDeleteToken = async (token: McpTokenPublicView) => {
    setBusyTokenId(token.id);
    setTokenActionError(null);
    try {
      const resp = await fetch(`/api/v1/mcp/tokens/${encodeURIComponent(token.id)}`, {
        method: 'DELETE',
      });
      const data = await resp.json();
      if (!resp.ok) {
        setTokenActionError(data?.error || 'Failed to delete token');
        return;
      }
      await fetchMcpTokensAndAudit();
    } finally {
      setBusyTokenId(null);
    }
  };

  const handleUseRevealedToken = (rawToken: string) => {
    setActiveBearerToken(rawToken);
    setRpcAuthMode('bearer');
    setInjectTokenInSnippets(true);
  };

  const handleRunHandshake = async () => {
    setIsHandshaking(true);
    const t0 = performance.now();
    try {
      const initRes = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: buildRpcHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'ui-init',
          method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'release-gate-studio', version: '1.0.0' },
          },
        }),
      });
      const sessionId = initRes.headers.get('mcp-session-id') || undefined;
      const initJson = await initRes.json();
      await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: buildRpcHeaders(sessionId ? { 'Mcp-Session-Id': sessionId } : undefined),
        body: JSON.stringify({ jsonrpc: '2.0', id: 'ui-ping', method: 'ping' }),
      });
      const latencyMs = Math.round(performance.now() - t0);
      setHandshakeStatus({
        checked: true,
        ok: initRes.ok && Boolean(initJson?.result?.protocolVersion),
        latencyMs,
        sessionId,
        serverName: initJson?.result?.serverInfo?.name || MCP_SERVER_NAME,
        protocolVersion: initJson?.result?.protocolVersion || MCP_PROTOCOL_VERSION,
        error: initRes.ok ? undefined : initJson?.error?.message || `HTTP ${initRes.status}`,
      });
    } catch (err: unknown) {
      setHandshakeStatus({
        checked: true,
        ok: false,
        error: err instanceof Error ? err.message : 'Handshake failed',
      });
    } finally {
      setIsHandshaking(false);
    }
  };

  const executeMcpTool = async (
    toolName: string,
    args: Record<string, unknown>
  ) => {
    const toolMeta = MCP_TOOLS.find((t) => t.name === toolName);
    const sanitizedArgs = toolMeta ? pruneToolArguments(toolMeta, args) : args;
    setIsExecuting(true);
    const t0 = performance.now();
    try {
      const resp = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: buildRpcHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `mcp-${toolName}`,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: sanitizedArgs,
          },
        }),
      });
      const sessionId = resp.headers.get('mcp-session-id') || undefined;
      const rateLimitRemaining = resp.headers.get('x-ratelimit-remaining') || undefined;
      const rateLimitLimit = resp.headers.get('x-ratelimit-limit') || undefined;
      const body = await resp.json();
      const latencyMs = Math.round(performance.now() - t0);
      const executedAt = new Date().toLocaleTimeString();
      setRpcResult({
        statusCode: resp.status,
        latencyMs,
        sessionId,
        rateLimitRemaining,
        rateLimitLimit,
        payload: body,
        executedAt,
      });
      const succeeded = resp.ok && !body?.error && !body?.result?.isError;
      if (succeeded && toolMeta && !toolMeta.readOnlyHint) {
        onConfigMutated?.();
        setLastSyncedAt(executedAt);
      }
      void fetchMcpTokensAndAudit();
    } catch (err: unknown) {
      setRpcResult({
        statusCode: 500,
        latencyMs: Math.round(performance.now() - t0),
        payload: {
          error: err instanceof Error ? err.message : 'Request failed',
        },
        executedAt: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReadResource = async (uri: string) => {
    setSelectedResourceUri(uri);
    setResourceLoading(true);
    const t0 = performance.now();
    try {
      const resp = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: buildRpcHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'res-read',
          method: 'resources/read',
          params: { uri },
        }),
      });
      const data = await resp.json();
      setResourceResponse({
        uri,
        latencyMs: Math.round(performance.now() - t0),
        payload: data,
      });
      void fetchMcpTokensAndAudit();
    } finally {
      setResourceLoading(false);
    }
  };

  const handleGetPrompt = async (promptName: string) => {
    setSelectedPromptName(promptName);
    setPromptLoading(true);
    try {
      const resp = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: buildRpcHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-get',
          method: 'prompts/get',
          params: { name: promptName, arguments: promptArgs },
        }),
      });
      const data = await resp.json();
      setPromptResponse(data);
      void fetchMcpTokensAndAudit();
    } finally {
      setPromptLoading(false);
    }
  };

  useEffect(() => {
    void fetchMcpTokensAndAudit();
    void handleRunHandshake();
    void executeMcpTool('manage_environment', {
      action: 'list',
      appId: activeAppId || 'www',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTokensCount = useMemo(
    () => tokens.filter((t) => t.status === 'active' && !t.isExpired).length,
    [tokens]
  );

  const revokedTokensCount = useMemo(
    () => tokens.filter((t) => t.status === 'revoked').length,
    [tokens]
  );

  const deniedAuditCount = useMemo(
    () => auditLog.filter((e) => e.decision === 'denied').length,
    [auditLog]
  );

  const filteredAuditLog = useMemo(() => {
    if (auditDecisionFilter === 'all') return auditLog;
    return auditLog.filter((e) => e.decision === auditDecisionFilter);
  }, [auditLog, auditDecisionFilter]);

  const availableSiteOptions = useMemo(() => {
    if (propertySummaries.length > 0) {
      return propertySummaries.map((p) => ({ id: p.appId, name: p.name }));
    }
    return [
      { id: 'www', name: 'Salesforce WWW' },
      { id: 'login', name: 'Salesforce Login' },
      { id: 'help', name: 'Salesforce Help' },
      { id: 'trailhead', name: 'Trailhead' },
    ];
  }, [propertySummaries]);

  const categories = [
    'All',
    'Envs & Properties',
    'Tests & Suites',
    'Policies & Waivers',
    'Gate Evaluation',
    'Evidence & Repro',
    'Live Execution',
  ];

  const allToolParamEntries = useMemo(
    () => Object.entries(activeTool.inputSchema.properties),
    [activeTool]
  );

  const visibleToolParamEntries = useMemo(() => {
    if (showAllParams || allToolParamEntries.length <= 6) {
      return allToolParamEntries;
    }
    const reqSet = new Set(activeTool.inputSchema.required || []);
    const actionKeys = getVisibleKeysForAction(
      activeTool.name,
      activeArgs.action ?? activeTool.inputSchema.properties.action?.default
    );
    return allToolParamEntries.filter(([key]) => {
      if (reqSet.has(key)) return true;
      if (activeArgs[key] !== undefined && activeArgs[key] !== '') return true;
      if (rawJsonDrafts[`${activeTool.name}:${key}`] !== undefined) return true;
      if (actionKeys) return actionKeys.has(key);
      return false;
    });
  }, [activeTool, allToolParamEntries, activeArgs, rawJsonDrafts, showAllParams]);

  const hiddenParamCount =
    allToolParamEntries.length - visibleToolParamEntries.length;

  const rpcTextPreview = useMemo(() => {
    if (!rpcResult) return '';
    return JSON.stringify(rpcResult.payload, null, 2);
  }, [rpcResult]);

  return (
    <div className="w-full px-3 sm:px-4 py-2.5 space-y-2.5">
      {/* Compact Single-Row MCP Header + Sub-tabs + Handshake */}
      <section className="rounded-lg border border-border bg-card px-3.5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="font-mono text-xs font-semibold text-foreground">
                /api/v1/mcp/rpc
              </span>
              <button
                type="button"
                onClick={() => copyText('rpc-endpoint', `${origin}/api/v1/mcp/rpc`)}
                aria-label="Copy MCP endpoint URL"
                title={`Copy ${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} endpoint`}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                {copiedKey === 'rpc-endpoint' ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>

            <span className="hidden sm:inline text-border" aria-hidden="true">|</span>

            <div
              role="tablist"
              aria-label="MCP Studio sections"
              className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs"
            >
              {(
                [
                  { id: 'studio', label: 'RPC Studio', count: MCP_TOOLS.length },
                  {
                    id: 'resources',
                    label: 'Resources & Prompts',
                    count: MCP_RESOURCES.length + MCP_PROMPTS.length,
                  },
                  {
                    id: 'tokens',
                    label: 'Access Tokens',
                    count: activeTokensCount,
                  },
                  {
                    id: 'clients',
                    label: 'Client Setup',
                    count: clientSnippets.length,
                  },
                ] as const
              ).map((tab) => {
                const active = subTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`mcp-tab-${tab.id}`}
                    onClick={() => setSubTab(tab.id)}
                    className={`inline-flex h-6.5 items-center gap-1.5 rounded px-2.5 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      active
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'font-medium text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        active ? 'text-primary-foreground/85' : 'text-muted-foreground'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {handshakeStatus.checked && (
              <span
                data-testid="mcp-handshake-status"
                className={`font-mono text-[11px] font-medium tabular-nums mr-1 ${
                  handshakeStatus.ok
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {handshakeStatus.ok
                  ? `MCP ${handshakeStatus.protocolVersion} · ${handshakeStatus.latencyMs}ms`
                  : handshakeStatus.error || 'Handshake Failed'}
              </span>
            )}

            <button
              type="button"
              onClick={handleRunHandshake}
              disabled={isHandshaking}
              data-testid="mcp-handshake-btn"
              className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              {isHandshaking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>Ping / Initialize</span>
            </button>

            <button
              type="button"
              onClick={onOpenWorkbench}
              data-testid="mcp-open-workbench"
              className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted whitespace-nowrap cursor-pointer"
            >
              <span>Open Compare</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </section>

      {/* TAB 1: Interactive MCP JSON-RPC 2.0 Tool Studio */}
      {subTab === 'studio' && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[290px_1fr]">
          {/* Left: Tool Directory */}
          <aside className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">
            <div className="border-b border-border p-2.5 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={toolQuery}
                  onChange={(e) => setToolQuery(e.target.value)}
                  placeholder="Filter MCP tools…"
                  aria-label="Filter MCP tools"
                  data-testid="mcp-tool-search"
                  className="h-7.5 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                {toolQuery && (
                  <button
                    type="button"
                    onClick={() => setToolQuery('')}
                    aria-label="Clear tool filter"
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {categories.map((cat) => {
                  const active = categoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`h-6.5 rounded border px-2 text-[11px] font-medium cursor-pointer transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-border/70 max-h-[calc(100vh-14rem)] overflow-y-auto">
              {filteredTools.map((tool) => {
                const active = tool.name === activeTool.name;
                return (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => setSelectedToolName(tool.name)}
                    data-testid={`mcp-tool-item-${tool.name}`}
                    className={`w-full px-3 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-accent/70 text-foreground border-l-2 border-l-primary'
                        : 'hover:bg-muted/40 text-foreground border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-mono text-xs font-semibold truncate ${
                          active ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {tool.name}
                      </span>
                      <span className="font-mono text-[10px] font-semibold uppercase text-muted-foreground shrink-0">
                        {tool.readOnlyHint ? 'READ' : 'EXEC'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-foreground/85 truncate">
                      {tool.title}
                    </div>
                  </button>
                );
              })}

              {filteredTools.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No MCP tools match "{toolQuery}".
                </div>
              )}
            </div>
          </aside>

          {/* Right: Active Tool Parameters + Live RPC Output */}
          <div className="space-y-3 min-w-0">
            <section className="rounded-lg border border-border bg-card p-3.5 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary shrink-0" />
                    <h2 className="font-mono text-sm font-bold text-foreground">
                      {activeTool.name}
                    </h2>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      · {activeTool.category}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                      · {activeTool.readOnlyHint ? 'readOnly' : 'mutating'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {activeTool.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {'appId' in activeTool.inputSchema.properties && (
                    <button
                      type="button"
                      onClick={() => {
                        updateToolArg('appId', activeAppId);
                        if ('candidateTarget' in activeTool.inputSchema.properties) {
                          updateToolArg('candidateTarget', `${activeAppId}.prod.staging`);
                        }
                        if ('baselineTarget' in activeTool.inputSchema.properties) {
                          updateToolArg('baselineTarget', `${activeAppId}.prod.prod`);
                        }
                      }}
                      className="inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted whitespace-nowrap cursor-pointer"
                    >
                      Use "{activeAppId}"
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      executeMcpTool(activeTool.name, cleanedActiveArgs)
                    }
                    disabled={isExecuting || activeToolJsonErrors.length > 0}
                    data-testid="mcp-execute-btn"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                  >
                    {isExecuting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3 fill-current" />
                    )}
                    <span>Execute MCP Call</span>
                  </button>
                </div>
              </div>

              {/* Compact Auth Header / Token Tester Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-muted-foreground mr-0.5">Auth:</span>
                  {(
                    [
                      { id: 'studio', label: 'Studio Session' },
                      { id: 'bearer', label: 'Bearer Token' },
                      { id: 'unauthenticated', label: 'Unauthenticated' },
                    ] as const
                  ).map((mode) => {
                    const active = rpcAuthMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        data-testid={`mcp-rpc-auth-${mode.id}`}
                        onClick={() => setRpcAuthMode(mode.id)}
                        className={`h-6 rounded border px-2 font-medium cursor-pointer transition-colors ${
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}

                  {rpcAuthMode === 'bearer' && (
                    <input
                      type="password"
                      value={activeBearerToken}
                      onChange={(e) => setActiveBearerToken(e.target.value)}
                      placeholder="Paste rg_mcp_… token"
                      aria-label="Bearer token for RPC test"
                      data-testid="mcp-rpc-bearer-input"
                      className="h-6 w-52 rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span
                    className={
                      authPolicy.enforceAuth
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        : 'text-muted-foreground'
                    }
                  >
                    {authPolicy.enforceAuth ? 'Policy: Auth Enforced' : 'Policy: Open Dev'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubTab('tokens')}
                    className="text-primary hover:underline cursor-pointer font-sans font-medium"
                  >
                    Manage Tokens
                  </button>
                </div>
              </div>

              {/* Quick Operation Presets */}
              {activeToolPresets.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                  <span className="text-[11px] font-medium text-muted-foreground mr-1">
                    Presets:
                  </span>
                  {activeToolPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyToolPreset(preset.args)}
                      data-testid={`mcp-preset-${preset.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      className="inline-flex h-6.5 items-center rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Typed Schema Input Controls */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {visibleToolParamEntries.map(([key, prop]) => {
                  const isReq =
                    activeTool.inputSchema.required?.includes(key) ?? false;
                  const rawVal = activeArgs[key];
                  const currentVal = rawVal ?? prop.default ?? '';
                  const draftKey = `${activeTool.name}:${key}`;

                  if (prop.type === 'boolean') {
                    return (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-semibold text-foreground">
                            {key}
                            {isReq ? ' *' : ''}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {prop.description}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(rawVal ?? prop.default ?? false)}
                          onChange={(e) =>
                            updateToolArg(key, e.target.checked)
                          }
                          className="h-4 w-4 accent-primary cursor-pointer"
                        />
                      </label>
                    );
                  }

                  if (prop.type === 'object' || prop.type === 'array') {
                    const displayJson =
                      rawJsonDrafts[draftKey] ??
                      (rawVal !== undefined
                        ? JSON.stringify(rawVal, null, 2)
                        : '');
                    const fieldError = jsonFieldErrors[draftKey];
                    return (
                      <div key={key} className="space-y-1 sm:col-span-2">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor={`arg-${activeTool.name}-${key}`}
                            className="block font-mono text-[11px] font-semibold text-foreground"
                          >
                            {key}
                            {isReq ? ' *' : ''}{' '}
                            <span className="font-normal text-muted-foreground">
                              ({prop.type === 'array' ? 'JSON array' : 'JSON object'})
                            </span>
                          </label>
                          {fieldError && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {fieldError}
                            </span>
                          )}
                        </div>
                        <textarea
                          id={`arg-${activeTool.name}-${key}`}
                          rows={2}
                          value={displayJson}
                          placeholder={prop.description}
                          onChange={(e) =>
                            handleJsonFieldChange(key, prop, e.target.value)
                          }
                          className={`w-full rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none ${
                            fieldError
                              ? 'border-rose-500 focus:border-rose-500'
                              : 'border-border focus:border-primary'
                          }`}
                        />
                      </div>
                    );
                  }

                  if (prop.enum && prop.enum.length > 0) {
                    const selectVal =
                      rawVal !== undefined
                        ? String(rawVal)
                        : isReq && prop.default !== undefined
                        ? String(prop.default)
                        : '';
                    return (
                      <div key={key} className="space-y-1">
                        <label
                          htmlFor={`arg-${activeTool.name}-${key}`}
                          className="block font-mono text-[11px] font-semibold text-foreground"
                        >
                          {key}
                          {isReq ? ' *' : ''}
                        </label>
                        <select
                          id={`arg-${activeTool.name}-${key}`}
                          value={selectVal}
                          onChange={(e) =>
                            updateToolArg(
                              key,
                              e.target.value === '' ? undefined : e.target.value
                            )
                          }
                          className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          {!isReq && <option value="">— optional —</option>}
                          {prop.enum.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  const isNumeric =
                    prop.type === 'number' || prop.type === 'integer';
                  return (
                    <div key={key} className="space-y-1">
                      <label
                        htmlFor={`arg-${activeTool.name}-${key}`}
                        className="block font-mono text-[11px] font-semibold text-foreground"
                      >
                        {key}
                        {isReq ? ' *' : ''}
                      </label>
                      <input
                        id={`arg-${activeTool.name}-${key}`}
                        type={isNumeric ? 'number' : 'text'}
                        step={
                          prop.type === 'integer'
                            ? '1'
                            : prop.type === 'number'
                            ? '0.01'
                            : undefined
                        }
                        value={
                          rawVal !== undefined
                            ? String(rawVal)
                            : isReq
                            ? String(currentVal)
                            : ''
                        }
                        placeholder={prop.description}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') {
                            updateToolArg(key, undefined);
                            return;
                          }
                          if (isNumeric) {
                            const parsed = Number(v);
                            updateToolArg(
                              key,
                              Number.isFinite(parsed)
                                ? prop.type === 'integer'
                                  ? Math.trunc(parsed)
                                  : parsed
                                : undefined
                            );
                          } else {
                            updateToolArg(key, v);
                          }
                        }}
                        className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>

              {allToolParamEntries.length > 6 && (
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAllParams((v) => !v)}
                    data-testid="mcp-toggle-all-params"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                  >
                    {showAllParams ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span>Show action parameters</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>
                          Show all {allToolParamEntries.length} parameters (+
                          {hiddenParamCount} optional)
                        </span>
                      </>
                    )}
                  </button>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {Object.keys(cleanedActiveArgs).length} active args
                  </span>
                </div>
              )}

            </section>

            {/* Side-by-Side JSON-RPC Request & Live Response */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <section className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3.5 py-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    JSON-RPC 2.0 Request
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'rpc-json',
                          JSON.stringify(jsonRpcRequestObject, null, 2)
                        )
                      }
                      className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                    >
                      {copiedKey === 'rpc-json' ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span>{copiedKey === 'rpc-json' ? 'Copied' : 'JSON-RPC'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => copyText('rpc-curl', jsonRpcCurl)}
                      className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                    >
                      {copiedKey === 'rpc-curl' ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span>{copiedKey === 'rpc-curl' ? 'Copied' : 'cURL'}</span>
                    </button>
                  </div>
                </div>
                <pre className="flex-1 max-h-[380px] overflow-auto p-3.5 font-mono text-xs text-foreground leading-relaxed">
                  {JSON.stringify(jsonRpcRequestObject, null, 2)}
                </pre>
              </section>

              {/* Live Response Viewer */}
              <section
                data-testid="mcp-response-viewer"
                className="rounded-lg border border-border bg-card overflow-hidden flex flex-col"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3.5 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-semibold text-foreground">
                      MCP Tool Response
                    </span>
                    {rpcResult && (
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          rpcResult.statusCode < 400
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        HTTP {rpcResult.statusCode} · {rpcResult.latencyMs}ms
                        {rpcResult.rateLimitLimit
                          ? ` · ${rpcResult.rateLimitRemaining ?? '?'}/${rpcResult.rateLimitLimit} rpm`
                          : ''}
                      </span>
                    )}
                    {lastSyncedAt && rpcResult?.executedAt === lastSyncedAt && (
                      <span className="font-mono text-[11px] font-medium text-primary">
                        · Synced to workspace
                      </span>
                    )}
                  </div>
                  {rpcTextPreview && (
                    <button
                      type="button"
                      onClick={() => copyText('rpc-resp', rpcTextPreview)}
                      className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                    >
                      {copiedKey === 'rpc-resp' ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span>{copiedKey === 'rpc-resp' ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>

                {rpcResult ? (
                  <pre className="flex-1 max-h-[380px] overflow-auto p-3.5 font-mono text-xs text-foreground leading-relaxed">
                    {rpcTextPreview}
                  </pre>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    Click <span className="font-semibold text-foreground">Execute MCP Call</span>{' '}
                    above to invoke <span className="font-mono text-foreground">{activeTool.name}</span>{' '}
                    over JSON-RPC 2.0 and inspect live telemetry.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Live MCP Resources & Prompt Templates */}
      {subTab === 'resources' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Resources Column */}
          <section className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                MCP Resources (resources/read)
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {MCP_RESOURCES.length} static + {MCP_RESOURCE_TEMPLATES.length} templates
              </span>
            </div>

            <div className="divide-y divide-border/70">
              {MCP_RESOURCES.map((res) => {
                const active = selectedResourceUri === res.uri;
                return (
                  <div
                    key={res.uri}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                      active ? 'bg-accent/50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-foreground truncate">
                        {res.uri}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {res.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReadResource(res.uri)}
                      data-testid={`mcp-read-resource-${res.uri.replace(/[^a-z0-9]/gi, '-')}`}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted shrink-0 cursor-pointer"
                    >
                      Read
                    </button>
                  </div>
                );
              })}

              {MCP_RESOURCE_TEMPLATES.filter((tpl) => {
                const resolvedUri = tpl.uriTemplate.replace(
                  '{appId}',
                  activeAppId || 'www'
                );
                return !MCP_RESOURCES.some((r) => r.uri === resolvedUri);
              }).map((tpl) => {
                const resolvedUri = tpl.uriTemplate.replace(
                  '{appId}',
                  activeAppId || 'www'
                );
                const active = selectedResourceUri === resolvedUri;
                return (
                  <div
                    key={tpl.uriTemplate}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/20 ${
                      active ? 'bg-accent/50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-foreground truncate">
                        {resolvedUri}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {tpl.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReadResource(resolvedUri)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted shrink-0 cursor-pointer"
                    >
                      Read Active
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border p-4 bg-background/50">
              <div className="mb-2 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>
                  {resourceLoading
                    ? 'Reading resource…'
                    : resourceResponse
                    ? `${resourceResponse.uri} · ${resourceResponse.latencyMs}ms`
                    : 'Select a resource above and click Read'}
                </span>
              </div>
              {resourceResponse && (
                <pre
                  data-testid="mcp-resource-output"
                  className="max-h-72 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs text-foreground"
                >
                  {JSON.stringify(resourceResponse.payload, null, 2)}
                </pre>
              )}
            </div>
          </section>

          {/* Prompts Column */}
          <section className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                MCP Prompt Workflows (prompts/get)
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {MCP_PROMPTS.length} templates
              </span>
            </div>

            <div className="border-b border-border p-3 grid grid-cols-2 gap-2.5 bg-background/40">
              <div>
                <label
                  htmlFor="mcp-prompt-appId"
                  className="block font-mono text-[11px] font-semibold text-foreground mb-1"
                >
                  appId
                </label>
                <input
                  id="mcp-prompt-appId"
                  type="text"
                  value={promptArgs.appId}
                  onChange={(e) =>
                    setPromptArgs((p) => ({ ...p, appId: e.target.value }))
                  }
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="mcp-prompt-testId"
                  className="block font-mono text-[11px] font-semibold text-foreground mb-1"
                >
                  testId
                </label>
                <input
                  id="mcp-prompt-testId"
                  type="text"
                  value={promptArgs.testId}
                  onChange={(e) =>
                    setPromptArgs((p) => ({ ...p, testId: e.target.value }))
                  }
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="divide-y divide-border/70">
              {MCP_PROMPTS.map((pr) => {
                const active = selectedPromptName === pr.name;
                return (
                  <div
                    key={pr.name}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                      active ? 'bg-accent/50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-foreground">
                        {pr.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {pr.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleGetPrompt(pr.name)}
                      className="inline-flex h-7 items-center rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted shrink-0 cursor-pointer"
                    >
                      Render
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border p-4 bg-background/50">
              <div className="mb-2 text-[11px] font-mono text-muted-foreground">
                {promptLoading
                  ? 'Rendering prompt…'
                  : Boolean(promptResponse)
                  ? `Prompt payload: ${selectedPromptName}`
                  : 'Select a workflow prompt and click Render'}
              </div>
              {Boolean(promptResponse) && (
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs text-foreground">
                  {JSON.stringify(promptResponse, null, 2)}
                </pre>
              )}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: MCP Access Tokens, Auth Policy & Audit Trail */}
      {subTab === 'tokens' && (
        <div className="space-y-2.5" data-testid="mcp-tokens-view">
          {/* Compact Auth Policy & Telemetry Strip */}
          <section className="rounded-lg border border-border bg-card px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  {authPolicy.enforceAuth ? (
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span>Auth Policy</span>
                </div>

                {(
                  [
                    {
                      key: 'enforceAuth',
                      label: 'Require Bearer Auth',
                      checked: authPolicy.enforceAuth,
                    },
                    {
                      key: 'requireAuthForReads',
                      label: 'Auth on Reads',
                      checked: authPolicy.requireAuthForReads,
                    },
                    {
                      key: 'allowSameOriginStudio',
                      label: 'Same-Origin Studio',
                      checked: authPolicy.allowSameOriginStudio,
                    },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.key}
                    className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={policySavingKey === item.key}
                      data-testid={`mcp-policy-${item.key}`}
                      onChange={(e) =>
                        void handleToggleAuthPolicy(item.key, e.target.checked)
                      }
                      className="h-3.5 w-3.5 accent-primary cursor-pointer"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    <strong className="text-foreground">{activeTokensCount}</strong> active
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    <strong className="text-foreground">{revokedTokensCount}</strong> revoked
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    <strong className="text-foreground">{auditLog.length}</strong> events
                  </span>
                  {deniedAuditCount > 0 && (
                    <>
                      <span className="text-border">·</span>
                      <span className="text-rose-700 dark:text-rose-400 font-semibold">
                        {deniedAuditCount} denied
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void fetchMcpTokensAndAudit()}
                  disabled={tokensLoading}
                  data-testid="mcp-tokens-refresh"
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3 w-3 text-muted-foreground ${
                      tokensLoading ? 'animate-spin' : ''
                    }`}
                  />
                  <span>Refresh</span>
                </button>
              </div>
            </div>
          </section>

          {/* One-Time In-Memory Secret Reveal Banner */}
          {revealedSecret && (
            <section
              data-testid="mcp-token-reveal-banner"
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3.5 py-2.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <KeyRound className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <span className="font-semibold text-foreground">
                    One-Time Token Secret — {revealedSecret.tokenName}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {revealedSecret.notice}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setRevealedSecret(null)}
                  aria-label="Dismiss one-time secret banner"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <code
                  data-testid="mcp-revealed-token-value"
                  className="flex-1 min-w-[260px] rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground select-all break-all"
                >
                  {revealedSecret.rawToken}
                </code>

                <button
                  type="button"
                  data-testid="mcp-copy-revealed-token"
                  onClick={() => copyText('revealed-secret', revealedSecret.rawToken)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 cursor-pointer whitespace-nowrap"
                >
                  {copiedKey === 'revealed-secret' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === 'revealed-secret' ? 'Copied' : 'Copy Token'}</span>
                </button>

                <button
                  type="button"
                  data-testid="mcp-use-revealed-token"
                  onClick={() => handleUseRevealedToken(revealedSecret.rawToken)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span>
                    {activeBearerToken === revealedSecret.rawToken
                      ? 'Active in Studio & Snippets'
                      : 'Use in Studio & Client Setup'}
                  </span>
                </button>
              </div>
            </section>
          )}

          {tokenActionError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-400"
            >
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{tokenActionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setTokenActionError(null)}
                className="text-rose-700/80 hover:text-rose-700 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Main 2-Column Governance Workspace */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[360px_1fr]">
            {/* Left: Generate Scoped Token Form */}
            <form
              onSubmit={handleCreateToken}
              data-testid="mcp-token-create-form"
              className="rounded-lg border border-border bg-card p-3.5 space-y-3 h-fit"
            >
              <div className="flex items-center justify-between border-b border-border/70 pb-2">
                <div className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-xs font-semibold text-foreground">
                    Generate Scoped Token
                  </h2>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  SHA-256 · 256-bit
                </span>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="mcp-new-token-name"
                  className="block text-[11px] font-semibold text-foreground"
                >
                  Token Name
                </label>
                <input
                  id="mcp-new-token-name"
                  type="text"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="e.g. Cursor IDE — WWW Release"
                  data-testid="mcp-token-name-input"
                  className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground">
                    Role Presets
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {newTokenScopes.length} selected
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {TOKEN_ROLE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      data-testid={`mcp-role-preset-${preset.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      onClick={() => setNewTokenScopes([...preset.scopes])}
                      className="h-6 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-[11px] font-semibold text-foreground">
                  RBAC Scopes
                </span>
                <div className="divide-y divide-border/60 rounded-md border border-border bg-background">
                  {scopesCatalog.map((meta) => {
                    const checked = newTokenScopes.includes(meta.scope);
                    return (
                      <label
                        key={meta.scope}
                        className="flex items-start gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted/30"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          data-testid={`mcp-scope-${meta.scope}`}
                          onChange={() => handleToggleNewScope(meta.scope)}
                          className="mt-0.5 h-3.5 w-3.5 accent-primary cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 leading-tight">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-foreground">
                              {meta.scope}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {meta.label}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground">
                    Site Allowlist
                  </span>
                  <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newTokenAllSites}
                      onChange={(e) => {
                        setNewTokenAllSites(e.target.checked);
                        if (e.target.checked) setNewTokenAppIds([]);
                      }}
                      className="h-3 w-3 accent-primary cursor-pointer"
                    />
                    <span>All Sites (*)</span>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableSiteOptions.map((site) => {
                    const selected = !newTokenAllSites && newTokenAppIds.includes(site.id);
                    return (
                      <button
                        key={site.id}
                        type="button"
                        data-testid={`mcp-site-allow-${site.id}`}
                        onClick={() => handleToggleNewAppId(site.id)}
                        className={`h-6 rounded border px-2 font-mono text-[11px] cursor-pointer transition-colors ${
                          selected
                            ? 'border-primary bg-primary text-primary-foreground font-semibold'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {site.id}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor="mcp-token-expiry"
                    className="block text-[11px] font-semibold text-foreground"
                  >
                    Expiration
                  </label>
                  <select
                    id="mcp-token-expiry"
                    value={newTokenExpiryDays}
                    onChange={(e) => setNewTokenExpiryDays(e.target.value)}
                    data-testid="mcp-token-expiry-select"
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">365 days</option>
                    <option value="never">Never expires</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="mcp-token-rpm"
                    className="block text-[11px] font-semibold text-foreground"
                  >
                    Rate Limit (RPM)
                  </label>
                  <input
                    id="mcp-token-rpm"
                    type="number"
                    min={5}
                    max={6000}
                    value={newTokenRpm}
                    onChange={(e) =>
                      setNewTokenRpm(Math.max(5, Math.min(6000, Number(e.target.value) || 120)))
                    }
                    data-testid="mcp-token-rpm-input"
                    className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreatingToken || newTokenName.trim().length < 2}
                data-testid="mcp-generate-token-btn"
                className="inline-flex h-8.5 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {isCreatingToken ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                <span>Generate Scoped Token</span>
              </button>
            </form>

            {/* Right: Tokens Table & Live Audit Log Switcher */}
            <section className="rounded-lg border border-border bg-card overflow-hidden flex flex-col min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3.5 py-2">
                <div
                  role="tablist"
                  aria-label="Token registry and audit log"
                  className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tokenRightPane === 'tokens'}
                    data-testid="mcp-subpane-tokens"
                    onClick={() => setTokenRightPane('tokens')}
                    className={`inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] cursor-pointer transition-colors ${
                      tokenRightPane === 'tokens'
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'font-medium text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>Issued Tokens</span>
                    <span className="font-mono text-[10px] tabular-nums opacity-85">
                      {tokens.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tokenRightPane === 'audit'}
                    data-testid="mcp-subpane-audit"
                    onClick={() => setTokenRightPane('audit')}
                    className={`inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] cursor-pointer transition-colors ${
                      tokenRightPane === 'audit'
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'font-medium text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>Live Audit Log</span>
                    <span className="font-mono text-[10px] tabular-nums opacity-85">
                      {auditLog.length}
                    </span>
                  </button>
                </div>

                {tokenRightPane === 'audit' ? (
                  <div className="flex items-center gap-1 text-[11px]">
                    {(['all', 'allowed', 'denied'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        data-testid={`mcp-audit-filter-${f}`}
                        onClick={() => setAuditDecisionFilter(f)}
                        className={`h-6 rounded border px-2 capitalize cursor-pointer ${
                          auditDecisionFilter === f
                            ? 'border-primary bg-primary text-primary-foreground font-semibold'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Only SHA-256 digests stored · Timing-safe verification
                  </span>
                )}
              </div>

              {tokenRightPane === 'tokens' && (
                <div className="overflow-x-auto">
                  {tokens.length === 0 ? (
                    <div className="px-6 py-12 text-center space-y-1.5">
                      <KeyRound className="mx-auto h-6 w-6 text-muted-foreground/60" />
                      <div className="text-xs font-semibold text-foreground">
                        No MCP Access Tokens Issued
                      </div>
                      <p className="text-xs text-muted-foreground max-w-md mx-auto">
                        Create a scoped token on the left for Cursor, Claude Code, Gemini CLI, or CI runners, then switch on{' '}
                        <span className="font-semibold text-foreground">Require Bearer Auth</span> to enforce RBAC.
                      </p>
                    </div>
                  ) : (
                    <table
                      data-testid="mcp-tokens-table"
                      className="w-full text-left border-collapse text-xs"
                    >
                      <thead>
                        <tr className="border-b border-border bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2">Token</th>
                          <th className="px-3 py-2">Scopes</th>
                          <th className="px-3 py-2">Sites</th>
                          <th className="px-3 py-2">Limits</th>
                          <th className="px-3 py-2">Usage</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {tokens.map((tok) => {
                          const isBusy = busyTokenId === tok.id;
                          const effectiveStatus =
                            tok.status === 'revoked'
                              ? 'Revoked'
                              : tok.isExpired
                              ? 'Expired'
                              : tok.status === 'disabled'
                              ? 'Disabled'
                              : 'Active';
                          const statusColor =
                            effectiveStatus === 'Active'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : effectiveStatus === 'Disabled'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-rose-700 dark:text-rose-400';

                          return (
                            <tr
                              key={tok.id}
                              data-testid={`mcp-token-row-${tok.id}`}
                              className="hover:bg-muted/25 align-top"
                            >
                              <td className="px-3 py-2.5">
                                <div className="font-semibold text-foreground">
                                  {tok.name}
                                </div>
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  {tok.prefix}…
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {tok.scopes.map((sc) => (
                                    <span
                                      key={sc}
                                      className="font-mono text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded"
                                    >
                                      {sc.replace(/^mcp:/, '')}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-foreground">
                                {tok.allowedAppIds.includes('*')
                                  ? '*'
                                  : tok.allowedAppIds.join(', ')}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                                <div>{tok.rateLimitRpm}/m</div>
                                <div>exp {formatExpiryLabel(tok.expiresAt, tok.isExpired)}</div>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                                <div className="text-foreground font-medium">
                                  {tok.usageCount} calls
                                </div>
                                <div className="truncate max-w-[120px]">
                                  {tok.lastToolUsed || 'never used'}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span
                                  className={`font-mono text-[11px] font-semibold ${statusColor}`}
                                >
                                  {effectiveStatus}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  {tok.status !== 'revoked' && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        title={
                                          tok.status === 'active'
                                            ? 'Disable token temporarily'
                                            : 'Re-enable token'
                                        }
                                        data-testid={`mcp-token-toggle-${tok.id}`}
                                        onClick={() => void handleToggleTokenDisabled(tok)}
                                        className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-1.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                                      >
                                        {tok.status === 'active' ? (
                                          <Pause className="h-3 w-3 text-muted-foreground" />
                                        ) : (
                                          <Play className="h-3 w-3 text-emerald-600" />
                                        )}
                                        <span>
                                          {tok.status === 'active' ? 'Pause' : 'Enable'}
                                        </span>
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        title="Rotate secret immediately"
                                        data-testid={`mcp-token-rotate-${tok.id}`}
                                        onClick={() => void handleRotateToken(tok)}
                                        className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-1.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                                      >
                                        <RotateCw className="h-3 w-3 text-muted-foreground" />
                                        <span>Rotate</span>
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        title="Permanently revoke token"
                                        data-testid={`mcp-token-revoke-${tok.id}`}
                                        onClick={() => void handleRevokeToken(tok)}
                                        className="inline-flex h-6.5 items-center gap-1 rounded border border-rose-500/30 bg-background px-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 cursor-pointer"
                                      >
                                        <Ban className="h-3 w-3" />
                                        <span>Revoke</span>
                                      </button>
                                    </>
                                  )}

                                  {tok.status === 'revoked' && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      title="Remove revoked record"
                                      data-testid={`mcp-token-delete-${tok.id}`}
                                      onClick={() => void handleDeleteToken(tok)}
                                      className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:text-rose-700 hover:border-rose-500/30 disabled:opacity-50 cursor-pointer"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      <span>Remove</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tokenRightPane === 'audit' && (
                <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                  {filteredAuditLog.length === 0 ? (
                    <div className="px-6 py-12 text-center text-xs text-muted-foreground">
                      No MCP audit events recorded yet. Run an RPC call to see live authorization telemetry.
                    </div>
                  ) : (
                    <table
                      data-testid="mcp-audit-table"
                      className="w-full text-left border-collapse text-xs"
                    >
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="border-b border-border bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2">Principal</th>
                          <th className="px-3 py-2">RPC / Tool</th>
                          <th className="px-3 py-2">Site</th>
                          <th className="px-3 py-2">Scope</th>
                          <th className="px-3 py-2">Decision</th>
                          <th className="px-3 py-2 text-right">Latency</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {filteredAuditLog.map((evt) => (
                          <tr key={evt.id} className="hover:bg-muted/25 align-top">
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {formatShortTime(evt.timestamp)}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-mono text-[11px] text-foreground">
                                {evt.tokenPrefix ? `${evt.tokenPrefix}…` : evt.authMode}
                              </div>
                              {evt.tokenName && (
                                <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                  {evt.tokenName}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-foreground">
                              <div>{evt.toolName || evt.method}</div>
                              {evt.action && (
                                <div className="text-[10px] text-muted-foreground">
                                  action={evt.action}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                              {evt.appId || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                              {evt.requiredScope}
                            </td>
                            <td className="px-3 py-2">
                              <div
                                className={`font-mono text-[11px] font-semibold whitespace-nowrap ${
                                  evt.decision === 'allowed'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-rose-700 dark:text-rose-400'
                                }`}
                              >
                                {evt.decision.toUpperCase()} · {evt.statusCode}
                              </div>
                              {evt.reason && (
                                <div className="text-[10px] text-rose-700/90 dark:text-rose-400/90 max-w-[220px] truncate" title={evt.reason}>
                                  {evt.reason}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {evt.latencyMs !== undefined ? `${evt.latencyMs}ms` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* TAB 4: Zero-Friction IDE & CLI Client Setup */}
      {subTab === 'clients' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                Discovery, OAuth Protected Resource Metadata & Bearer Setup
              </div>
              <div className="text-muted-foreground">
                Compatible with Cursor, VS Code Copilot, Claude Code/Desktop, Gemini CLI, and OpenAI Codex CLI.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
              <a
                href="/.well-known/mcp.json"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                /.well-known/mcp.json
              </a>
              <span className="text-border">·</span>
              <a
                href="/.well-known/oauth-protected-resource"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                /.well-known/oauth-protected-resource
              </a>
              <span className="text-border">·</span>
              <a
                href="/api/v1/mcp/manifest"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                /api/v1/mcp/manifest
              </a>
              <span className="text-border">·</span>
              <a
                href="/api/v1/openapi.json"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                /api/v1/openapi.json
              </a>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="font-semibold text-foreground">Snippet Authorization Header:</span>
              <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-[11px]">
                <button
                  type="button"
                  data-testid="mcp-client-token-placeholder"
                  onClick={() => setInjectTokenInSnippets(false)}
                  className={`h-6 rounded px-2 font-medium cursor-pointer ${
                    !injectTokenInSnippets
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Use ${'{RELEASE_GATE_MCP_TOKEN}'}
                </button>
                <button
                  type="button"
                  disabled={!activeBearerToken.trim()}
                  data-testid="mcp-client-token-inject"
                  onClick={() => setInjectTokenInSnippets(true)}
                  className={`h-6 rounded px-2 font-medium cursor-pointer disabled:opacity-45 ${
                    injectTokenInSnippets && activeBearerToken.trim()
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Inject Active Token
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {activeBearerToken.trim() ? (
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  In-memory token ready ({activeBearerToken.slice(0, 15)}…)
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setSubTab('tokens')}
                  className="text-primary font-medium hover:underline cursor-pointer"
                >
                  Generate a token in Access Tokens →
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {clientSnippets.map((snippet) => (
              <article
                key={snippet.id}
                data-testid={`mcp-client-card-${snippet.id}`}
                className="rounded-lg border border-border bg-card overflow-hidden flex flex-col"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">
                      {snippet.name}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground truncate">
                      {snippet.filename}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(`client-${snippet.id}`, snippet.code)
                    }
                    data-testid={`mcp-copy-client-${snippet.id}`}
                    className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted shrink-0 cursor-pointer"
                  >
                    {copiedKey === `client-${snippet.id}` ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span>
                      {copiedKey === `client-${snippet.id}` ? 'Copied' : 'Copy'}
                    </span>
                  </button>
                </div>
                <div className="px-4 py-2 text-[11px] text-muted-foreground">
                  {snippet.instructions}
                </div>
                <pre className="mx-4 mb-4 flex-1 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
                  {snippet.code}
                </pre>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
