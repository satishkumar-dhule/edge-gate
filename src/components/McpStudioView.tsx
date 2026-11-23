import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  FileCode2,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import {
  MCP_PROMPTS,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOLS,
  buildMcpClientSnippets,
  type McpToolDefinition,
} from '../engine/mcpProtocol';
import { OverallVerdict } from '../engine/types';
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
}

type McpSubTab = 'studio' | 'resources' | 'clients' | 'fleet';

function verdictTextClass(verdict: OverallVerdict): string {
  if (verdict === 'NO-GO') return 'text-rose-700 dark:text-rose-400';
  if (verdict === 'REVIEW') return 'text-amber-700 dark:text-amber-400';
  if (verdict === 'GO') return 'text-emerald-700 dark:text-emerald-400';
  return 'text-muted-foreground';
}

export const McpStudioView: React.FC<McpStudioViewProps> = ({
  activeAppId,
  propertySummaries,
  onOpenWorkbench,
  onInspectPropertyInWorkbench,
}) => {
  const [subTab, setSubTab] = useState<McpSubTab>('studio');
  const [toolQuery, setToolQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [selectedToolName, setSelectedToolName] = useState<string>(
    'get_property_gate'
  );

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
    payload: unknown;
    executedAt: string;
  } | null>(null);

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
    () => buildMcpClientSnippets(origin),
    [origin]
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
        arguments: activeArgs,
      },
    }),
    [activeTool.name, activeArgs]
  );

  const jsonRpcCurl = useMemo(
    () =>
      [
        `curl -sS -X POST "${origin}/api/v1/mcp/rpc" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${JSON.stringify(jsonRpcRequestObject)}'`,
      ].join('\n'),
    [origin, jsonRpcRequestObject]
  );

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 1500);
  };

  const updateToolArg = (field: string, value: unknown) => {
    setArgsByTool((prev) => ({
      ...prev,
      [activeTool.name]: {
        ...(prev[activeTool.name] || activeTool.sampleArguments),
        [field]: value,
      },
    }));
  };

  const handleRunHandshake = async () => {
    setIsHandshaking(true);
    const t0 = performance.now();
    try {
      const initRes = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        },
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
    setIsExecuting(true);
    const t0 = performance.now();
    try {
      const resp = await fetch('/api/v1/mcp/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `mcp-${toolName}`,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });
      const sessionId = resp.headers.get('mcp-session-id') || undefined;
      const body = await resp.json();
      const latencyMs = Math.round(performance.now() - t0);
      setRpcResult({
        statusCode: resp.status,
        latencyMs,
        sessionId,
        payload: body,
        executedAt: new Date().toLocaleTimeString(),
      });
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-get',
          method: 'prompts/get',
          params: { name: promptName, arguments: promptArgs },
        }),
      });
      const data = await resp.json();
      setPromptResponse(data);
    } finally {
      setPromptLoading(false);
    }
  };

  const handleInspectPropertyViaMcp = (appId: string) => {
    const nextArgs = {
      appId,
      candidateTarget: `${appId}.prod.staging`,
      baselineTarget: `${appId}.prod.prod`,
      ignoreAcceptedDiffs: true,
    };
    setSelectedToolName('get_property_gate');
    setArgsByTool((prev) => ({
      ...prev,
      get_property_gate: nextArgs,
    }));
    setSubTab('studio');
    void executeMcpTool('get_property_gate', nextArgs);
  };

  useEffect(() => {
    void handleRunHandshake();
    void executeMcpTool('get_property_gate', {
      appId: activeAppId || 'www',
      candidateTarget: `${activeAppId || 'www'}.prod.staging`,
      baselineTarget: `${activeAppId || 'www'}.prod.prod`,
      ignoreAcceptedDiffs: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = [
    'All',
    'Gate Evaluation',
    'Evidence & Repro',
    'Live Execution',
    'Suite & Config',
  ];

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
                    onClick={() => executeMcpTool(activeTool.name, activeArgs)}
                    disabled={isExecuting}
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

              {/* Typed Schema Input Controls */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Object.entries(activeTool.inputSchema.properties).map(
                  ([key, prop]) => {
                    const isReq =
                      activeTool.inputSchema.required?.includes(key) ?? false;
                    const currentVal = activeArgs[key] ?? prop.default ?? '';

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
                            checked={Boolean(currentVal)}
                            onChange={(e) =>
                              updateToolArg(key, e.target.checked)
                            }
                            className="h-4 w-4 accent-primary cursor-pointer"
                          />
                        </label>
                      );
                    }

                    if (prop.enum && prop.enum.length > 0) {
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
                            value={String(currentVal)}
                            onChange={(e) => updateToolArg(key, e.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                          >
                            {prop.enum.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }

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
                          type={prop.type === 'number' ? 'number' : 'text'}
                          step={prop.type === 'number' ? '0.01' : undefined}
                          value={String(currentVal)}
                          placeholder={prop.description}
                          onChange={(e) =>
                            updateToolArg(
                              key,
                              prop.type === 'number'
                                ? Number(e.target.value)
                                : e.target.value
                            )
                          }
                          className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                        />
                      </div>
                    );
                  }
                )}
              </div>

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
                {MCP_RESOURCES.length} static + 2 templates
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

              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/20">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-foreground truncate">
                    gate://property/{activeAppId}/verdict
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Templated live verdict for active property "{activeAppId}"
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleReadResource(`gate://property/${activeAppId}/verdict`)
                  }
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted shrink-0 cursor-pointer"
                >
                  Read Active
                </button>
              </div>
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

      {/* TAB 3: Zero-Friction IDE & CLI Client Setup */}
      {subTab === 'clients' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">
                Discovery & OpenAPI Specification URLs
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
