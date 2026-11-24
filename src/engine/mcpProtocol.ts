/**
 * ============================================================================
 * PURE MODEL CONTEXT PROTOCOL (MCP 2025-03-26) JSON-RPC 2.0 ENGINE
 * ============================================================================
 * Zero DOM/Express dependencies so it runs identically in:
 *   1. `server.ts` HTTP JSON-RPC 2.0 / Streamable HTTP MCP transport
 *   2. Frontend `McpStudioView` interactive playground & client config generator
 *   3. `node:test` deterministic unit tests
 * ============================================================================
 */

import {
  DEFAULT_TEMPLATE_CONFIG,
  TemplateConfig,
} from '../config/template.config';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SERVER_NAME = 'akamai-synthetic-release-gate';
export const MCP_SERVER_VERSION = '3.0.0';

export type McpToolCategory =
  | 'Envs & Properties'
  | 'Tests & Suites'
  | 'Policies & Waivers'
  | 'Gate Evaluation'
  | 'Evidence & Repro'
  | 'Live Execution';

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  default?: unknown;
  enum?: string[];
}

export interface McpToolDefinition {
  name: string;
  title: string;
  category: McpToolCategory;
  description: string;
  readOnlyHint: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  sampleArguments: Record<string, unknown>;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceTemplateDefinition {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
}

export interface JsonRpcRequestLike {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
  tool?: string;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_akamai_properties',
    title: 'List Akamai Properties & HostMaps',
    category: 'Envs & Properties',
    description:
      'Lists all configured Akamai properties, environment hostMaps, edge networks (.edgekey-staging.net / .edgekey.net), suite counts, and indexed synthetic runs.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Optional substring filter on property ID, name, or division.',
          default: '',
        },
        tag: {
          type: 'string',
          description: 'Optional exact tag filter.',
          default: '',
        },
      },
    },
    sampleArguments: { search: '' },
  },
  {
    name: 'manage_property',
    title: 'Manage Properties (CRUD & Clone)',
    category: 'Envs & Properties',
    description:
      'Full lifecycle manipulation of Akamai properties/sites: list, get, create, update, patch, clone (with suite), or delete properties and metadata.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Property operation to execute.',
          enum: ['list', 'get', 'create', 'update', 'patch', 'clone', 'delete'],
          default: 'get',
        },
        appId: {
          type: 'string',
          description: 'Property ID (e.g. www, login, checkout).',
          default: 'www',
        },
        newAppId: {
          type: 'string',
          description: 'Target property ID when cloning (action=clone).',
        },
        name: {
          type: 'string',
          description: 'Human-readable display name for the property.',
        },
        canonicalHost: {
          type: 'string',
          description: 'Primary canonical hostname for default prod env (action=create).',
        },
        division: {
          type: 'string',
          description: 'Business division or owner group.',
        },
        description: {
          type: 'string',
          description: 'Optional property description.',
        },
        tags: {
          type: 'array',
          description: 'JSON array of string tags, e.g. ["tier-0", "global"].',
        },
        defaultNetworks: {
          type: 'array',
          description: 'Default edge networks, e.g. ["prod", "staging"].',
        },
        headers: {
          type: 'object',
          description: 'Default property-level request headers JSON object.',
        },
        envs: {
          type: 'array',
          description: 'Optional full array of environment definitions (EnvironmentConfig[]).',
        },
        cloneSuite: {
          type: 'boolean',
          description: 'Copy source property test suite when cloning (default true).',
          default: true,
        },
        merge: {
          type: 'boolean',
          description: 'Merge headers with existing headers on patch/update.',
          default: false,
        },
      },
      required: ['action'],
    },
    sampleArguments: {
      action: 'get',
      appId: 'www',
    },
  },
  {
    name: 'manage_environment',
    title: 'Manage Environments & HostMaps',
    category: 'Envs & Properties',
    description:
      'All environment operations on a property: list, get, add, update, patch, clone, delete, reorder, set_host_map, remove_host_map_key, set_edge_ips, set_networks, set_headers, set_variables, set_schedule, and pin_baseline.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Environment manipulation to execute.',
          enum: [
            'list',
            'get',
            'add',
            'update',
            'patch',
            'clone',
            'delete',
            'reorder',
            'set_host_map',
            'remove_host_map_key',
            'set_edge_ips',
            'set_networks',
            'set_headers',
            'set_variables',
            'set_schedule',
            'pin_baseline',
          ],
          default: 'list',
        },
        appId: {
          type: 'string',
          description: 'Property ID owning the environment.',
          default: 'www',
        },
        envId: {
          type: 'string',
          description: 'Environment ID (e.g. prod, uat, qa, canary, dr).',
          default: 'uat',
        },
        newEnvId: {
          type: 'string',
          description: 'Destination environment ID when cloning (action=clone).',
        },
        name: {
          type: 'string',
          description: 'Display name (e.g. "QA Staging", "UAT").',
        },
        tier: {
          type: 'string',
          description: 'Environment tier classification.',
          enum: ['prod', 'staging', 'uat', 'qa', 'dev', 'canary', 'dr'],
        },
        description: {
          type: 'string',
          description: 'Optional description for this environment.',
        },
        hostMap: {
          type: 'object',
          description: 'JSON object mapping canonicalHost -> targetHost (e.g. {"www.salesforce.com": "www-qa.salesforce.com"}).',
        },
        canonicalHost: {
          type: 'string',
          description: 'Shortcut canonical host key for single-entry set_host_map or remove_host_map_key.',
        },
        targetHost: {
          type: 'string',
          description: 'Shortcut target host value paired with canonicalHost.',
        },
        networks: {
          type: 'array',
          description: 'JSON array of active edge networks: ["prod", "staging"].',
        },
        stagingEdgeIp: {
          type: 'string',
          description: 'Public Akamai Staging Edge IPv4 override.',
        },
        prodEdgeIp: {
          type: 'string',
          description: 'Public Akamai Production Edge IPv4 override.',
        },
        defaultPopId: {
          type: 'string',
          description: 'Default execution PoP ID (e.g. iad, lhr, fra, nrt, sin).',
        },
        headers: {
          type: 'object',
          description: 'Environment-scoped custom HTTP headers JSON object.',
        },
        variables: {
          type: 'object',
          description: 'Environment-scoped key/value runtime variables JSON object.',
        },
        scheduleIntervalMin: {
          type: 'integer',
          description: 'Canary execution cadence in minutes (1–1440).',
        },
        alertThresholdMs: {
          type: 'integer',
          description: 'Latency alert threshold in milliseconds.',
        },
        pinnedBaselineRunKey: {
          type: 'string',
          description: 'Run key pinned as golden baseline for this environment.',
        },
        direction: {
          type: 'string',
          description: 'Reorder direction (action=reorder).',
          enum: ['up', 'down'],
        },
        merge: {
          type: 'boolean',
          description: 'Merge into existing hostMap/headers/variables instead of replacing.',
          default: false,
        },
      },
      required: ['action', 'appId'],
    },
    sampleArguments: {
      action: 'list',
      appId: 'www',
    },
  },
  {
    name: 'manage_test_suite',
    title: 'Manage Tests & Suite Manipulations',
    category: 'Tests & Suites',
    description:
      'Complete synthetic test manipulation: list, get, upsert, create, patch, delete, clone, toggle_enabled, toggle_visual_gate, toggle_critical, reorder, move_to_position, bulk_upsert, bulk_delete, bulk_toggle, bulk_assign_folder, set_headers, set_assertions, set_transaction_steps, set_script, set_tags, export_csv, and reset_defaults.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Operation to perform on tests in the property suite.',
          enum: [
            'list',
            'get',
            'upsert',
            'create',
            'patch',
            'delete',
            'clone',
            'toggle_enabled',
            'toggle_visual_gate',
            'toggle_critical',
            'reorder',
            'move_to_position',
            'bulk_upsert',
            'bulk_delete',
            'bulk_toggle',
            'bulk_assign_folder',
            'set_headers',
            'set_assertions',
            'set_transaction_steps',
            'set_script',
            'set_tags',
            'export_csv',
            'reset_defaults',
          ],
          default: 'list',
        },
        appId: {
          type: 'string',
          description: 'Property ID owning the suite.',
          default: 'www',
        },
        testId: {
          type: 'string',
          description: 'Check ID (e.g. T01, T09; auto-generated if omitted on upsert/create).',
        },
        newTestId: {
          type: 'string',
          description: 'New check ID for rename (patch) or clone.',
        },
        testIds: {
          type: 'array',
          description: 'JSON array of test IDs for bulk_delete, bulk_toggle, or bulk_assign_folder.',
        },
        name: {
          type: 'string',
          description: 'Human-readable check name.',
        },
        path: {
          type: 'string',
          description: 'Relative path (/sales/) or full https:// URL.',
        },
        expectedStatus: {
          type: 'string',
          description: 'Expected HTTP status code (e.g. 200, 301, 302).',
        },
        testType: {
          type: 'string',
          description: 'Catchpoint monitor type.',
          enum: [
            'web-chrome',
            'web-mobile',
            'http-object',
            'playback',
            'streaming',
            'transaction-playwright',
            'transaction-selenium',
            'api',
            'grpc',
            'websocket',
            'dns-direct',
            'dns-experience',
            'ping',
            'traceroute',
            'ssl',
            'transport-tcp',
            'bgp',
            'ftp',
            'smtp',
            'mqtt',
            'ntp',
            'ldap',
            'ssh',
            'rum',
            'custom',
          ],
        },
        httpMethod: {
          type: 'string',
          description: 'HTTP method for web/API checks.',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'],
        },
        category: {
          type: 'string',
          description: 'Check category label.',
        },
        folderId: {
          type: 'string',
          description: 'Folder ID (e.g. folder-core, folder-identity, folder-conversion, folder-network).',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable check execution.',
        },
        visualGate: {
          type: 'boolean',
          description: 'Enable or disable Visual AI gate for this check.',
        },
        critical: {
          type: 'boolean',
          description: 'Mark check as release-critical.',
        },
        requestHeaders: {
          type: 'object',
          description: 'Custom request headers JSON object.',
        },
        requestBody: {
          type: 'string',
          description: 'Optional request body payload for POST/PUT API checks.',
        },
        assertions: {
          type: 'object',
          description: 'Assertions JSON object: { expectedBodyMatch, maxLatencyMs, minTlsVersion, requireDnssec, maxHops }.',
        },
        transactionSteps: {
          type: 'array',
          description: 'Multi-step browser transaction JSON array ([{ step, action, target, value }]).',
        },
        scriptEngine: {
          type: 'string',
          description: 'Script runner engine.',
          enum: ['playwright', 'puppeteer', 'catchpoint', 'selenium', 'k6', 'node-fetch'],
        },
        customScript: {
          type: 'string',
          description: 'Custom synthetic test script source.',
        },
        port: {
          type: 'integer',
          description: 'Target TCP/UDP port (1–65535).',
        },
        dnsRecordType: {
          type: 'string',
          description: 'DNS query record type.',
          enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'],
        },
        dnsServer: {
          type: 'string',
          description: 'Optional authoritative DNS server for DNS Direct tests.',
        },
        sslMinExpiryDays: {
          type: 'integer',
          description: 'Minimum TLS certificate validity days remaining.',
        },
        slaWarningMs: {
          type: 'integer',
          description: 'Warning latency threshold in ms.',
        },
        slaCriticalMs: {
          type: 'integer',
          description: 'Critical latency threshold in ms.',
        },
        tags: {
          type: 'array',
          description: 'JSON array of string tags.',
        },
        direction: {
          type: 'string',
          description: 'Move check up or down (action=reorder).',
          enum: ['up', 'down'],
        },
        position: {
          type: 'integer',
          description: '1-based target index (action=move_to_position).',
        },
        tests: {
          type: 'array',
          description: 'JSON array of check definitions for action=bulk_upsert.',
        },
        merge: {
          type: 'boolean',
          description: 'Merge headers/assertions/tags instead of overwriting.',
          default: false,
        },
        search: {
          type: 'string',
          description: 'Optional filter substring for action=list.',
        },
      },
      required: ['action', 'appId'],
    },
    sampleArguments: {
      action: 'list',
      appId: 'www',
    },
  },
  {
    name: 'manage_test_folders',
    title: 'Manage Test Suite Folders',
    category: 'Tests & Suites',
    description:
      'Organize synthetic tests into Catchpoint-style folders: list, get, create, update, delete (with safe reassignment), reorder, assign_tests, or reset_defaults.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Folder operation to execute.',
          enum: ['list', 'get', 'create', 'update', 'delete', 'reorder', 'assign_tests', 'reset_defaults'],
          default: 'list',
        },
        folderId: {
          type: 'string',
          description: 'Folder ID (e.g. folder-core, folder-checkout).',
        },
        name: {
          type: 'string',
          description: 'Folder display name.',
        },
        description: {
          type: 'string',
          description: 'Optional folder description.',
        },
        color: {
          type: 'string',
          description: 'Folder badge color.',
          enum: ['sky', 'emerald', 'amber', 'rose', 'violet', 'slate'],
        },
        direction: {
          type: 'string',
          description: 'Reorder direction (action=reorder).',
          enum: ['up', 'down'],
        },
        appId: {
          type: 'string',
          description: 'Property ID when assigning tests (action=assign_tests).',
          default: 'www',
        },
        testIds: {
          type: 'array',
          description: 'JSON array of test IDs to assign into folderId.',
        },
        fallbackFolderId: {
          type: 'string',
          description: 'Destination folder ID for tests when deleting a folder.',
          default: 'folder-core',
        },
      },
      required: ['action'],
    },
    sampleArguments: {
      action: 'list',
    },
  },
  {
    name: 'manage_gate_policies',
    title: 'Manage Gate Policies & Waivers',
    category: 'Policies & Waivers',
    description:
      'Inspect and manipulate Release Gate waivers: list, add/update/toggle/delete accepted header rules, add/remove cookie waivers, add/remove visual test & region waivers, toggle ignoreAcceptedDiffs, or reset_defaults.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Policy or waiver mutation to perform.',
          enum: [
            'list',
            'add_header_rule',
            'toggle_header_rule',
            'update_header_rule',
            'delete_header_rule',
            'add_cookie_waiver',
            'remove_cookie_waiver',
            'add_visual_waiver',
            'remove_visual_waiver',
            'add_visual_param_waiver',
            'remove_visual_param_waiver',
            'set_ignore_accepted',
            'reset_defaults',
          ],
          default: 'list',
        },
        ruleId: {
          type: 'string',
          description: 'Header rule ID for toggle/update/delete.',
        },
        appId: {
          type: 'string',
          description: 'Property scope ("all" or specific appId).',
          default: 'www',
        },
        testId: {
          type: 'string',
          description: 'Check ID (optional for header rule; required for visual waiver).',
        },
        field: {
          type: 'string',
          description: 'Header/diff field name (e.g. x-check-cacheable, cache-control).',
        },
        note: {
          type: 'string',
          description: 'Justification or ticket reference for the waiver.',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable/disable state for header rule.',
        },
        cookieName: {
          type: 'string',
          description: 'Cookie name to allowlist or remove (e.g. sfdc-edge-sess).',
        },
        cookieNames: {
          type: 'array',
          description: 'JSON array of cookie names for bulk allowlisting.',
        },
        paramId: {
          type: 'string',
          description: 'Visual validation region/parameter ID.',
        },
        ignoreAcceptedDiffs: {
          type: 'boolean',
          description: 'Global toggle for applying accepted waivers during gate evaluation.',
        },
      },
      required: ['action'],
    },
    sampleArguments: {
      action: 'list',
    },
  },
  {
    name: 'get_fleet_status',
    title: 'Get Fleet Release Readiness',
    category: 'Gate Evaluation',
    description:
      'Returns the 3-dimensional Go/No-Go release verdict (Headers, Set-Cookie, Visual AI) and diff counts across all configured Akamai edge properties.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        verdictFilter: {
          type: 'string',
          description: 'Optional filter for property verdicts.',
          enum: ['all', 'NO-GO', 'REVIEW', 'GO'],
          default: 'all',
        },
      },
    },
    sampleArguments: { verdictFilter: 'all' },
  },
  {
    name: 'get_property_gate',
    title: 'Evaluate 3-Dim Property Gate',
    category: 'Gate Evaluation',
    description:
      'Evaluates Staging vs Production parity across Functional Headers, Set-Cookie attributes, HTTP Flow, and Visual Diff for a property using active policies.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Property ID (e.g. www, login, developer, japan).',
          default: 'www',
        },
        candidateTarget: {
          type: 'string',
          description: 'Optional candidate target override (<app>.<env>.<net>).',
          default: 'www.prod.staging',
        },
        baselineTarget: {
          type: 'string',
          description: 'Optional baseline target override (<app>.<env>.<net>).',
          default: 'www.prod.prod',
        },
        ignoreAcceptedDiffs: {
          type: 'boolean',
          description: 'Whether to exclude accepted header/cookie drift rules.',
          default: true,
        },
      },
      required: ['appId'],
    },
    sampleArguments: {
      appId: 'www',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      ignoreAcceptedDiffs: true,
    },
  },
  {
    name: 'compare_targets',
    title: 'Compare Any Two Targets or Runs',
    category: 'Gate Evaluation',
    description:
      'Compares any two targets or run keys (network Staging vs Prod, cross-env UAT vs Prod with hostMap normalization, or run-over-run) and optionally returns a ticket-ready Markdown summary.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        candidateTarget: {
          type: 'string',
          description: 'Candidate target (<app>.<env>.<net>).',
          default: 'www.prod.staging',
        },
        baselineTarget: {
          type: 'string',
          description: 'Baseline target (<app>.<env>.<net>).',
          default: 'www.prod.prod',
        },
        candidateRunKey: {
          type: 'string',
          description: 'Optional exact run key for candidate.',
        },
        baselineRunKey: {
          type: 'string',
          description: 'Optional exact run key for baseline.',
        },
        kind: {
          type: 'string',
          description: 'Comparison kind (auto-detected if omitted).',
          enum: ['network', 'env', 'adhoc'],
          default: 'network',
        },
        ignoreAcceptedDiffs: {
          type: 'boolean',
          description: 'Exclude accepted waivers from verdict.',
          default: true,
        },
        includeMarkdownSummary: {
          type: 'boolean',
          description: 'Include a ticket-ready Markdown release gate report.',
          default: true,
        },
      },
      required: ['candidateTarget', 'baselineTarget'],
    },
    sampleArguments: {
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      kind: 'network',
      ignoreAcceptedDiffs: true,
      includeMarkdownSummary: true,
    },
  },
  {
    name: 'evaluate_visual_diff_nova_lite',
    title: 'Cost-Gated Nova Lite Visual Judge',
    category: 'Gate Evaluation',
    description:
      'Runs the cost-gated Amazon Bedrock Nova Lite (amazon.nova-lite-v1:0) visual diff evaluator. Skips AI ($0 cost) when pixelDiffPercent <= 0.1%.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        testId: {
          type: 'string',
          description: 'Check ID to judge visually.',
          default: 'T03',
        },
        candidateTarget: {
          type: 'string',
          description: 'Candidate target.',
          default: 'www.prod.staging',
        },
        baselineTarget: {
          type: 'string',
          description: 'Baseline target.',
          default: 'www.prod.prod',
        },
        pixelDiffPercent: {
          type: 'number',
          description: 'Measured pixel delta percentage (<= 0.1 skips LLM).',
          default: 1.8,
        },
      },
      required: ['testId'],
    },
    sampleArguments: {
      testId: 'T03',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      pixelDiffPercent: 1.8,
    },
  },
  {
    name: 'run_gate_plugin_pipeline',
    title: 'Run Modular Gate Plugin Pipeline',
    category: 'Gate Evaluation',
    description:
      'Executes the extensible Release Gate plugin hooks (cache physics, security headers, cookie guard, latency SLO, Nova Lite visual, Zero-Token cache).',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        testId: {
          type: 'string',
          description: 'Check ID.',
          default: 'T02',
        },
        path: {
          type: 'string',
          description: 'Target URL path.',
          default: '/sales/',
        },
        candidateTarget: {
          type: 'string',
          description: 'Candidate target.',
          default: 'www.prod.staging',
        },
        baselineTarget: {
          type: 'string',
          description: 'Baseline target.',
          default: 'www.prod.prod',
        },
        pixelDiffPercent: {
          type: 'number',
          description: 'Pixel diff percent.',
          default: 0.04,
        },
      },
    },
    sampleArguments: {
      testId: 'T02',
      path: '/sales/',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      pixelDiffPercent: 0.04,
    },
  },
  {
    name: 'inspect_check_evidence',
    title: 'Inspect Check Diff & HTTP Trace',
    category: 'Evidence & Repro',
    description:
      'Returns granular header diffs, cookie parity mismatches, multi-hop HTTP flow hops, and zero-secret curl --resolve reproduction for one synthetic check.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Property ID owning the check.',
          default: 'www',
        },
        testId: {
          type: 'string',
          description: 'Synthetic check identifier (e.g. T01, T02, T03, T04).',
          default: 'T01',
        },
        candidateTarget: {
          type: 'string',
          description: 'Candidate target.',
          default: 'www.prod.staging',
        },
        baselineTarget: {
          type: 'string',
          description: 'Baseline target.',
          default: 'www.prod.prod',
        },
      },
      required: ['appId', 'testId'],
    },
    sampleArguments: {
      appId: 'www',
      testId: 'T01',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
    },
  },
  {
    name: 'get_curl_reproduction',
    title: 'Generate Zero-Secret Edge cURL',
    category: 'Evidence & Repro',
    description:
      'Builds a reproducible, zero-secret curl --resolve command pinned to the Akamai Staging or Production Edge IP with Pragma debug headers.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Property ID (e.g. www, login, japan).',
          default: 'www',
        },
        testId: {
          type: 'string',
          description: 'Test check ID (e.g. T01, T04).',
          default: 'T01',
        },
        envId: {
          type: 'string',
          description: 'Optional environment ID (e.g. prod, uat, qa).',
          default: 'prod',
        },
        network: {
          type: 'string',
          description: 'Target Akamai edge network.',
          enum: ['staging', 'prod'],
          default: 'staging',
        },
      },
      required: ['appId', 'testId'],
    },
    sampleArguments: {
      appId: 'www',
      testId: 'T01',
      envId: 'prod',
      network: 'staging',
    },
  },
  {
    name: 'rerun_check',
    title: 'Re-probe Live Edge Check',
    category: 'Live Execution',
    description:
      'Executes a live HTTP multi-hop edge probe against Staging/Production and updates the server run store with measured timings, headers, cookies, and status.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Property ID to probe.',
          default: 'www',
        },
        testId: {
          type: 'string',
          description: 'Check ID to probe (e.g. T01).',
          default: 'T01',
        },
        envId: {
          type: 'string',
          description: 'Environment ID (e.g. prod, uat).',
          default: 'prod',
        },
        network: {
          type: 'string',
          description: 'Edge network to probe.',
          enum: ['staging', 'prod'],
          default: 'staging',
        },
      },
      required: ['appId', 'testId'],
    },
    sampleArguments: {
      appId: 'www',
      testId: 'T01',
      envId: 'prod',
      network: 'staging',
    },
  },
  {
    name: 'run_live_gate',
    title: 'Trigger Full Property Gate Run',
    category: 'Live Execution',
    description:
      'Triggers a live AWS Synthetics / Edge HTTP probe suite run for a target (<app>.<env>.<net>) and evaluates the Release Gate against baseline.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        targetId: {
          type: 'string',
          description: 'Target identifier (<app>.<env>.<network>).',
          default: 'www.prod.staging',
        },
        popId: {
          type: 'string',
          description: 'Optional execution PoP override (iad, nrt, fra, sin, lhr).',
          default: 'iad',
        },
      },
      required: ['targetId'],
    },
    sampleArguments: {
      targetId: 'www.prod.staging',
      popId: 'iad',
    },
  },
  {
    name: 'manage_runs',
    title: 'Manage Synthetic Runs & Baselines',
    category: 'Live Execution',
    description:
      'List, inspect, pin as golden baseline, delete, purge historical runs for a target, or seed a live fleet run across properties.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Run store operation to perform.',
          enum: ['list', 'get', 'pin_baseline', 'delete', 'purge_target', 'seed_fleet'],
          default: 'list',
        },
        appId: {
          type: 'string',
          description: 'Optional property filter for action=list.',
        },
        target: {
          type: 'string',
          description: 'Target filter (<app>.<env>.<net>) for list or purge_target.',
        },
        runKey: {
          type: 'string',
          description: 'Exact run key for get, pin_baseline, or delete.',
        },
        pinned: {
          type: 'boolean',
          description: 'Pin or unpin run as golden baseline (action=pin_baseline).',
          default: true,
        },
        keepLatest: {
          type: 'integer',
          description: 'Number of most recent runs to retain during purge_target.',
          default: 1,
        },
        limit: {
          type: 'integer',
          description: 'Max runs returned by action=list (1–200).',
          default: 25,
        },
      },
      required: ['action'],
    },
    sampleArguments: {
      action: 'list',
      appId: 'www',
      limit: 10,
    },
  },
  {
    name: 'manage_synthetics_canaries',
    title: 'AWS Synthetics Canaries & Fan-Out',
    category: 'Live Execution',
    description:
      'Inspect AWS CloudWatch Synthetics canary inventory, view deep-dive blueprint specs, sync/start canaries, or trigger parallel fan-out batches (property, blockers, or full fleet).',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Synthetics canary orchestration command.',
          enum: ['list', 'status', 'deep_dive', 'sync', 'start', 'fan_out'],
          default: 'list',
        },
        appId: {
          type: 'string',
          description: 'Property ID for sync or property-scoped fan_out.',
          default: 'www',
        },
        canaryName: {
          type: 'string',
          description: 'Canary name for deep_dive or start.',
        },
        scope: {
          type: 'string',
          description: 'Fan-out execution scope (action=fan_out).',
          enum: ['property', 'blockers', 'all'],
          default: 'property',
        },
        network: {
          type: 'string',
          description: 'Edge network target for fan_out.',
          enum: ['staging', 'prod', 'both'],
          default: 'both',
        },
      },
      required: ['action'],
    },
    sampleArguments: {
      action: 'list',
      appId: 'www',
    },
  },
];

export const MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: 'gate://fleet/summary',
    name: 'Fleet Gate Readiness Summary',
    description: 'Live Go/No-Go verdicts and dimension diff counts across all properties.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://properties/catalog',
    name: 'Akamai Properties & Edge Networks',
    description: 'Single-source-of-truth hostMaps, edge suffixes, IPs, and AWS regions.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://policies/active',
    name: 'Active Gate Policies & Waivers',
    description: 'Accepted header rules, cookie allowlist, visual waivers, and global waiver toggle.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://folders/catalog',
    name: 'Synthetic Test Folders Catalog',
    description: 'Configured Catchpoint-style folders organizing test checks.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://property/www/environments',
    name: 'Primary Property Environments (www)',
    description: 'Configured environments, hostMaps, edge IPs, and networks for www.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://property/www/verdict',
    name: 'Primary Property Gate Verdict (www)',
    description: 'Detailed 3-dimension release gate verdict for www.salesforce.com.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://property/www/suite',
    name: 'Primary Property Test Suite (www)',
    description: 'Configured synthetic check definitions for www.salesforce.com.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://plugins/registry',
    name: 'Release Gate Plugin Registry',
    description: 'Modular pre-compare, per-dimension, and post-verdict gate plugins.',
    mimeType: 'application/json',
  },
  {
    uri: 'gate://openapi/spec',
    name: 'OpenAPI 3.1 Control Plane Specification',
    description: 'Full OpenAPI 3.1.0 schema synced with template.config.ts.',
    mimeType: 'application/json',
  },
];

export const MCP_RESOURCE_TEMPLATES: McpResourceTemplateDefinition[] = [
  {
    uriTemplate: 'gate://property/{appId}/verdict',
    name: 'Property 3-Dim Release Verdict',
    description: '3-dimension Go/No-Go gate evaluation for any configured property.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'gate://property/{appId}/suite',
    name: 'Property Synthetic Test Suite',
    description: 'Synthetic check definitions, Catchpoint monitor types, and assertions for {appId}.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'gate://property/{appId}/environments',
    name: 'Property Environments & HostMaps',
    description: 'Environments, canonical hostMaps, edge IPs, and networks for {appId}.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'gate://property/{appId}/runs',
    name: 'Property Run History',
    description: 'Indexed synthetic run history and pinned baselines for {appId}.',
    mimeType: 'application/json',
  },
];

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'triage_nogo_blockers',
    description:
      'Triage every NO-GO or REVIEW blocker on an Akamai property using live MCP tools and produce zero-secret curl reproductions.',
    arguments: [
      {
        name: 'appId',
        description: 'Target Akamai property ID (e.g. www, login, developer).',
        required: true,
      },
    ],
  },
  {
    name: 'audit_cache_headers',
    description:
      'Compare Akamai Pragma x-check-cacheable, Cache-Control TTLs, and Set-Cookie parity for a specific check.',
    arguments: [
      {
        name: 'appId',
        description: 'Property ID (e.g. www).',
        required: true,
      },
      {
        name: 'testId',
        description: 'Synthetic check ID (e.g. T01).',
        required: true,
      },
    ],
  },
  {
    name: 'review_visual_diff',
    description:
      'Evaluate a candidate vs baseline screenshot pair via the cost-gated Bedrock Nova Lite visual judge.',
    arguments: [
      {
        name: 'appId',
        description: 'Property ID (e.g. www).',
        required: true,
      },
      {
        name: 'testId',
        description: 'Synthetic check ID (e.g. T03).',
        required: true,
      },
    ],
  },
  {
    name: 'configure_env_and_tests',
    description:
      'Provision a new environment with hostMap overrides, author Catchpoint synthetic checks/assertions, and execute a live Staging vs Prod release gate.',
    arguments: [
      {
        name: 'appId',
        description: 'Target property ID (e.g. www).',
        required: true,
      },
      {
        name: 'envId',
        description: 'Environment ID to configure (e.g. qa, canary, uat).',
        required: true,
      },
    ],
  },
];

export function buildMcpPromptMessages(
  name: string,
  args: Record<string, string> = {}
): {
  description: string;
  messages: Array<{
    role: 'user';
    content: { type: 'text'; text: string };
  }>;
} | null {
  const appId = (args.appId || 'www').trim() || 'www';
  const testId = (args.testId || 'T01').trim().toUpperCase() || 'T01';
  const envId = (args.envId || 'qa').trim().toLowerCase() || 'qa';

  if (name === 'triage_nogo_blockers') {
    return {
      description: `Triage release blockers for property ${appId}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Evaluate the Akamai release gate for property "${appId}".`,
              `1. Call tool get_property_gate with {"appId": "${appId}", "ignoreAcceptedDiffs": true}.`,
              `2. For every check whose itemVerdict is not "same", call inspect_check_evidence with {"appId": "${appId}", "testId": "<id>"}.`,
              `3. Generate a concise Go/No-Go summary listing failing headers, cookie drifts, and zero-secret curl --resolve commands without exposing secrets.`,
            ].join('\n'),
          },
        },
      ],
    };
  }

  if (name === 'audit_cache_headers') {
    return {
      description: `Audit Akamai cacheability and Set-Cookie parity for ${appId}/${testId}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Perform a cacheability & header contract audit on ${appId} check ${testId}.`,
              `1. Call inspect_check_evidence with {"appId": "${appId}", "testId": "${testId}"}.`,
              `2. Call run_gate_plugin_pipeline with {"testId": "${testId}", "candidateTarget": "${appId}.prod.staging", "baselineTarget": "${appId}.prod.prod"}.`,
              `3. Report x-check-cacheable parity, normalized Cache-Control directives, and Set-Cookie drift.`,
            ].join('\n'),
          },
        },
      ],
    };
  }

  if (name === 'review_visual_diff') {
    return {
      description: `Review Bedrock Nova Lite visual diff for ${appId}/${testId}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Assess visual parity for ${appId} check ${testId}.`,
              `1. Call evaluate_visual_diff_nova_lite with {"testId": "${testId}", "candidateTarget": "${appId}.prod.staging", "baselineTarget": "${appId}.prod.prod"}.`,
              `2. Verify whether pixelDiffPercent exceeded the 0.1% Bedrock Nova Lite cost gate and summarize affected viewport regions.`,
            ].join('\n'),
          },
        },
      ],
    };
  }

  if (name === 'configure_env_and_tests') {
    return {
      description: `Configure ${envId} environment and synthetic checks for ${appId}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Configure environment "${envId}" and synthetic checks for property "${appId}".`,
              `1. Call manage_environment with {"action": "list", "appId": "${appId}"} to inspect existing hostMaps and edge IPs.`,
              `2. Call manage_environment with {"action": "add", "appId": "${appId}", "envId": "${envId}", "name": "${envId.toUpperCase()}", "tier": "${envId}", "hostMap": {"${appId}.salesforce.com": "${appId}-${envId}.salesforce.com"}}.`,
              `3. Call manage_test_suite with {"action": "upsert", "appId": "${appId}", "name": "Health Check", "path": "/", "testType": "web-chrome", "expectedStatus": "200", "assertions": {"maxLatencyMs": 1500}}.`,
              `4. Call run_live_gate with {"targetId": "${appId}.${envId}.staging"} and compare_targets against "${appId}.prod.prod".`,
            ].join('\n'),
          },
        },
      ],
    };
  }

  return null;
}

export function buildMcpManifest(
  origin = '',
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
) {
  const endpointPath = config.infrastructure.mcpEndpoint || '/api/v1/mcp/rpc';
  const cleanOrigin = origin.replace(/\/$/, '');
  const fullRpcUrl = cleanOrigin ? `${cleanOrigin}${endpointPath}` : endpointPath;

  return {
    name: MCP_SERVER_NAME,
    title: config.branding.controlPlaneTitle,
    version: MCP_SERVER_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: {
      type: 'streamable-http',
      endpoint: fullRpcUrl,
      manifestEndpoint: cleanOrigin
        ? `${cleanOrigin}/api/v1/mcp/manifest`
        : '/api/v1/mcp/manifest',
      wellKnownEndpoint: cleanOrigin
        ? `${cleanOrigin}/.well-known/mcp.json`
        : '/.well-known/mcp.json',
      npmPackage: config.infrastructure.mcpNpmPackage,
    },
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: true },
      prompts: { listChanged: false },
    },
    counts: {
      tools: MCP_TOOLS.length,
      resources: MCP_RESOURCES.length,
      resourceTemplates: MCP_RESOURCE_TEMPLATES.length,
      prompts: MCP_PROMPTS.length,
    },
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      category: t.category,
      description: t.description,
      readOnlyHint: t.readOnlyHint,
      inputSchema: t.inputSchema,
    })),
    resources: MCP_RESOURCES,
    resourceTemplates: MCP_RESOURCE_TEMPLATES,
    prompts: MCP_PROMPTS,
  };
}

export interface McpClientSnippet {
  id: 'cursor' | 'claude' | 'vscode' | 'gemini' | 'codex' | 'curl';
  name: string;
  filename: string;
  instructions: string;
  code: string;
}

export function buildMcpClientSnippets(
  origin = 'http://localhost:3000',
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG,
  bearerToken?: string
): McpClientSnippet[] {
  const cleanOrigin = (origin || 'http://localhost:3000').replace(/\/$/, '');
  const rpcUrl = `${cleanOrigin}${config.infrastructure.mcpEndpoint || '/api/v1/mcp/rpc'}`;
  const tokenValue =
    bearerToken && bearerToken.trim()
      ? bearerToken.trim()
      : '${RELEASE_GATE_MCP_TOKEN}';
  const authHeaderValue = `Bearer ${tokenValue}`;

  return [
    {
      id: 'cursor',
      name: 'Cursor IDE',
      filename: '.cursor/mcp.json',
      instructions: `Add to .cursor/mcp.json to expose all ${MCP_TOOLS.length} Release Gate tools with Bearer authentication.`,
      code: JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: {
              url: rpcUrl,
              transport: 'http',
              headers: {
                Authorization: authHeaderValue,
              },
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: 'vscode',
      name: 'VS Code Copilot',
      filename: '.vscode/mcp.json',
      instructions: `Save to .vscode/mcp.json to expose all ${MCP_TOOLS.length} Release Gate tools in Copilot Agent Mode.`,
      code: JSON.stringify(
        {
          servers: {
            [MCP_SERVER_NAME]: {
              type: 'http',
              url: rpcUrl,
              headers: {
                Authorization: authHeaderValue,
              },
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: 'claude',
      name: 'Claude Code & Desktop',
      filename: 'claude mcp add / claude_desktop_config.json',
      instructions: 'Register via Claude Code CLI or add to claude_desktop_config.json.',
      code: [
        `# Claude Code CLI (Streamable HTTP + Bearer Token)`,
        `claude mcp add --transport http ${MCP_SERVER_NAME} ${rpcUrl} \\`,
        `  --header "Authorization: ${authHeaderValue}"`,
        ``,
        `# Or claude_desktop_config.json`,
        JSON.stringify(
          {
            mcpServers: {
              [MCP_SERVER_NAME]: {
                command: 'npx',
                args: [
                  '-y',
                  'mcp-remote',
                  rpcUrl,
                  '--header',
                  `Authorization:${authHeaderValue}`,
                ],
              },
            },
          },
          null,
          2
        ),
      ].join('\n'),
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      filename: '~/.gemini/settings.json',
      instructions: 'Register the HTTP MCP endpoint inside Gemini CLI settings with Bearer auth.',
      code: JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: {
              httpUrl: rpcUrl,
              headers: {
                Authorization: authHeaderValue,
              },
              trust: true,
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      filename: '~/.codex/config.toml',
      instructions: 'Add this server block to your Codex CLI configuration.',
      code: [
        `[mcp_servers.${MCP_SERVER_NAME.replace(/-/g, '_')}]`,
        `url = "${rpcUrl}"`,
        `bearer_token_env_var = "RELEASE_GATE_MCP_TOKEN"`,
        `enabled_tools = ["manage_property", "manage_environment", "manage_test_suite", "manage_test_folders", "manage_gate_policies", "get_property_gate", "compare_targets", "run_live_gate"]`,
      ].join('\n'),
    },
    {
      id: 'curl',
      name: 'HTTP JSON-RPC (cURL)',
      filename: 'terminal',
      instructions: 'Invoke any Release Gate MCP tool directly over HTTP POST with Bearer auth.',
      code: [
        `curl -sS -X POST "${rpcUrl}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Authorization: ${authHeaderValue}" \\`,
        `  -d '${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_property_gate',
            arguments: { appId: 'www', ignoreAcceptedDiffs: true },
          },
        })}'`,
      ].join('\n'),
    },
  ];
}

export function buildCheckMcpCallPayload(params: {
  appId: string;
  testId: string;
  candidateTarget?: string;
  baselineTarget?: string;
  toolName?: 'inspect_check_evidence' | 'get_curl_reproduction' | 'rerun_check';
}): string {
  const toolName = params.toolName || 'inspect_check_evidence';
  const body = {
    jsonrpc: '2.0',
    id: `gate-${params.appId}-${params.testId}`,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments:
        toolName === 'get_curl_reproduction'
          ? { appId: params.appId, testId: params.testId, network: 'staging' }
          : toolName === 'rerun_check'
          ? { appId: params.appId, testId: params.testId, network: 'staging' }
          : {
              appId: params.appId,
              testId: params.testId,
              candidateTarget: params.candidateTarget || `${params.appId}.prod.staging`,
              baselineTarget: params.baselineTarget || `${params.appId}.prod.prod`,
            },
    },
  };
  return JSON.stringify(body, null, 2);
}

export function buildJsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

export function formatMcpToolResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent:
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : { value: payload },
    isError,
  };
}

export interface McpRuntimeHandlers {
  executeTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<unknown> | unknown;
  readResource: (
    uri: string
  ) => Promise<{ uri: string; mimeType: string; text: string } | null> | { uri: string; mimeType: string; text: string } | null;
  getServerConfig?: () => TemplateConfig;
}

/**
 * Spec-compliant MCP JSON-RPC 2.0 request dispatcher.
 * Supports standard MCP methods (`initialize`, `notifications/initialized`,
 * `ping`, `tools/list`, `tools/call`, `resources/list`,
 * `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`)
 * plus legacy shorthand (`{ tool, params }` without `method`).
 */
export async function dispatchMcpJsonRpc(
  rawRequest: JsonRpcRequestLike,
  handlers: McpRuntimeHandlers
): Promise<{ statusCode: number; body: JsonRpcResponse | null; isNotification?: boolean }> {
  if (!rawRequest || typeof rawRequest !== 'object') {
    return {
      statusCode: 400,
      body: buildJsonRpcError(null, -32600, 'Invalid Request: expected JSON-RPC object'),
    };
  }

  const rpcId = rawRequest.id !== undefined ? rawRequest.id : 1;
  const method = typeof rawRequest.method === 'string' ? rawRequest.method : '';

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return { statusCode: 202, body: null, isNotification: true };
  }

  if (method === 'ping') {
    return {
      statusCode: 200,
      body: { jsonrpc: '2.0', id: rpcId, result: {} },
    };
  }

  if (method === 'initialize') {
    const cfg = handlers.getServerConfig ? handlers.getServerConfig() : DEFAULT_TEMPLATE_CONFIG;
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: true },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            title: cfg.branding.controlPlaneTitle,
            version: MCP_SERVER_VERSION,
          },
          instructions:
            'Use manage_property, manage_environment, manage_test_suite, manage_test_folders, and manage_gate_policies to perform all configuration and suite manipulations; use get_fleet_status, get_property_gate, compare_targets, inspect_check_evidence, run_live_gate, manage_runs, and manage_synthetics_canaries to execute and triage 3-dimensional Akamai Staging vs Prod release gates.',
        },
      },
    };
  }

  if (method === 'tools/list') {
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              title: t.title,
              readOnlyHint: t.readOnlyHint,
            },
          })),
        },
      },
    };
  }

  if (method === 'resources/list') {
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          resources: MCP_RESOURCES,
        },
      },
    };
  }

  if (method === 'resources/templates/list') {
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          resourceTemplates: MCP_RESOURCE_TEMPLATES,
        },
      },
    };
  }

  if (method === 'resources/read') {
    const uri = typeof rawRequest.params?.uri === 'string' ? rawRequest.params.uri.trim() : '';
    if (!uri) {
      return {
        statusCode: 400,
        body: buildJsonRpcError(rpcId, -32602, 'Invalid params: "uri" string is required'),
      };
    }
    const readResult = await handlers.readResource(uri);
    if (!readResult) {
      return {
        statusCode: 404,
        body: buildJsonRpcError(rpcId, -32002, `MCP resource not found: ${uri}`),
      };
    }
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          contents: [readResult],
        },
      },
    };
  }

  if (method === 'prompts/list') {
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          prompts: MCP_PROMPTS,
        },
      },
    };
  }

  if (method === 'prompts/get') {
    const promptName = typeof rawRequest.params?.name === 'string' ? rawRequest.params.name.trim() : '';
    const promptArgs =
      rawRequest.params?.arguments && typeof rawRequest.params.arguments === 'object'
        ? (rawRequest.params.arguments as Record<string, string>)
        : {};
    const promptResult = buildMcpPromptMessages(promptName, promptArgs);
    if (!promptResult) {
      return {
        statusCode: 404,
        body: buildJsonRpcError(rpcId, -32602, `Unknown MCP prompt: ${promptName}`),
      };
    }
    return {
      statusCode: 200,
      body: {
        jsonrpc: '2.0',
        id: rpcId,
        result: promptResult,
      },
    };
  }

  // `tools/call` OR legacy shorthand (`{ tool: '...', params: {...} }`)
  if (method === 'tools/call' || !method) {
    const paramsObj =
      rawRequest.params && typeof rawRequest.params === 'object' ? rawRequest.params : {};
    const toolName =
      (typeof paramsObj.name === 'string' && paramsObj.name.trim()) ||
      (typeof rawRequest.tool === 'string' && rawRequest.tool.trim()) ||
      '';

    if (!toolName) {
      return {
        statusCode: 400,
        body: buildJsonRpcError(
          rpcId,
          -32602,
          'Invalid params: params.name (tool name) is required for tools/call'
        ),
      };
    }

    const args =
      paramsObj.arguments && typeof paramsObj.arguments === 'object'
        ? (paramsObj.arguments as Record<string, unknown>)
        : !method
        ? paramsObj
        : {};

    try {
      const output = await handlers.executeTool(toolName, args);
      if (method === 'tools/call') {
        return {
          statusCode: 200,
          body: {
            jsonrpc: '2.0',
            id: rpcId,
            result: formatMcpToolResult(output, false),
          },
        };
      }
      // Legacy bare-tool invocation compatibility
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id: rpcId,
          result: output,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'MCP tool execution failed';
      if (method === 'tools/call') {
        return {
          statusCode: 200,
          body: {
            jsonrpc: '2.0',
            id: rpcId,
            result: formatMcpToolResult({ error: msg }, true),
          },
        };
      }
      return {
        statusCode: 500,
        body: buildJsonRpcError(rpcId, -32603, msg),
      };
    }
  }

  return {
    statusCode: 404,
    body: buildJsonRpcError(rpcId, -32601, `Method not found: ${method}`),
  };
}
