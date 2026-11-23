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
export const MCP_SERVER_VERSION = '2.4.0';

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  default?: unknown;
  enum?: string[];
}

export interface McpToolDefinition {
  name: string;
  title: string;
  category: 'Gate Evaluation' | 'Evidence & Repro' | 'Live Execution' | 'Suite & Config';
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
    name: 'list_akamai_properties',
    title: 'List Akamai Properties & HostMaps',
    category: 'Suite & Config',
    description:
      'Lists all configured Akamai properties, environment hostMaps, edge networks (.edgekey-staging.net / .edgekey.net), and indexed synthetic runs.',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Optional substring filter on property ID or name.',
          default: '',
        },
      },
    },
    sampleArguments: { search: '' },
  },
  {
    name: 'get_property_gate',
    title: 'Evaluate 3-Dim Property Gate',
    category: 'Gate Evaluation',
    description:
      'Evaluates Staging vs Production parity across Functional Headers, Set-Cookie attributes, HTTP Flow, and Visual Diff for a property.',
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
    name: 'manage_test_suite',
    title: 'List or Upsert Suite Checks',
    category: 'Suite & Config',
    description:
      'Lists synthetic checks for a property, or creates/updates a check definition in the live suite registry.',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Operation to perform on the property suite.',
          enum: ['list', 'upsert', 'delete'],
          default: 'list',
        },
        appId: {
          type: 'string',
          description: 'Property ID.',
          default: 'www',
        },
        testId: {
          type: 'string',
          description: 'Check ID (required for delete; auto-generated if omitted on upsert).',
          default: 'T01',
        },
        name: {
          type: 'string',
          description: 'Human-readable check name (used on upsert).',
        },
        path: {
          type: 'string',
          description: 'Path or full URL to check (used on upsert).',
        },
        expectedStatus: {
          type: 'string',
          description: 'Expected HTTP status code (e.g. 200, 301).',
          default: '200',
        },
      },
      required: ['action', 'appId'],
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
    description: 'Synthetic check definitions and expected statuses for {appId}.',
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
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): McpClientSnippet[] {
  const cleanOrigin = (origin || 'http://localhost:3000').replace(/\/$/, '');
  const rpcUrl = `${cleanOrigin}${config.infrastructure.mcpEndpoint || '/api/v1/mcp/rpc'}`;

  return [
    {
      id: 'cursor',
      name: 'Cursor IDE',
      filename: '.cursor/mcp.json',
      instructions: 'Add to .cursor/mcp.json in your project root or global Cursor settings.',
      code: JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: {
              url: rpcUrl,
              transport: 'http',
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
      instructions: 'Save to .vscode/mcp.json to expose all 10 Release Gate tools in Copilot Agent Mode.',
      code: JSON.stringify(
        {
          servers: {
            [MCP_SERVER_NAME]: {
              type: 'http',
              url: rpcUrl,
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
        `# Claude Code CLI (Streamable HTTP)`,
        `claude mcp add --transport http ${MCP_SERVER_NAME} ${rpcUrl}`,
        ``,
        `# Or claude_desktop_config.json`,
        JSON.stringify(
          {
            mcpServers: {
              [MCP_SERVER_NAME]: {
                command: 'npx',
                args: ['-y', 'mcp-remote', rpcUrl],
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
      instructions: 'Register the HTTP MCP endpoint inside Gemini CLI settings.',
      code: JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: {
              httpUrl: rpcUrl,
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
        `enabled_tools = ["get_fleet_status", "get_property_gate", "inspect_check_evidence", "get_curl_reproduction"]`,
      ].join('\n'),
    },
    {
      id: 'curl',
      name: 'HTTP JSON-RPC (cURL)',
      filename: 'terminal',
      instructions: 'Invoke any Release Gate MCP tool directly over HTTP POST.',
      code: [
        `curl -sS -X POST "${rpcUrl}" \\`,
        `  -H "Content-Type: application/json" \\`,
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
            'Use get_fleet_status and get_property_gate to assess 3-dimensional Akamai Staging vs Prod readiness, inspect_check_evidence to inspect header/cookie diffs, and get_curl_reproduction for zero-secret CLI reproduction.',
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
