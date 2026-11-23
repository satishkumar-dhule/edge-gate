import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MCP_PROMPTS,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_RESOURCE_TEMPLATES,
  MCP_SERVER_NAME,
  MCP_TOOLS,
  buildCheckMcpCallPayload,
  buildMcpClientSnippets,
  buildMcpManifest,
  buildMcpPromptMessages,
  dispatchMcpJsonRpc,
} from './mcpProtocol';

describe('mcpProtocol JSON-RPC 2.0 Engine', () => {
  it('exposes complete tool, resource, and prompt catalogs without schedules or AI chat bloat', () => {
    assert.equal(MCP_TOOLS.length, 10);
    assert.equal(MCP_RESOURCES.length, 6);
    assert.equal(MCP_RESOURCE_TEMPLATES.length, 2);
    assert.equal(MCP_PROMPTS.length, 3);

    for (const tool of MCP_TOOLS) {
      assert.ok(tool.name.length > 0);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.sampleArguments && typeof tool.sampleArguments === 'object');
    }
  });

  it('handles initialize, ping, notifications, and catalog listing according to MCP 2025-03-26', async () => {
    const handlers = {
      executeTool: () => ({ ok: true }),
      readResource: () => null,
    };

    const init = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      handlers
    );
    assert.equal(init.statusCode, 200);
    assert.equal((init.body as any).result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal((init.body as any).result.serverInfo.name, MCP_SERVER_NAME);

    const notif = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      handlers
    );
    assert.equal(notif.statusCode, 202);
    assert.equal(notif.isNotification, true);
    assert.equal(notif.body, null);

    const ping = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      handlers
    );
    assert.equal(ping.statusCode, 200);
    assert.deepEqual((ping.body as any).result, {});

    const toolsList = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      handlers
    );
    assert.equal((toolsList.body as any).result.tools.length, MCP_TOOLS.length);

    const resList = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 4, method: 'resources/list' },
      handlers
    );
    assert.equal((resList.body as any).result.resources.length, MCP_RESOURCES.length);

    const tplList = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 5, method: 'resources/templates/list' },
      handlers
    );
    assert.equal(
      (tplList.body as any).result.resourceTemplates.length,
      MCP_RESOURCE_TEMPLATES.length
    );

    const promptsList = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 6, method: 'prompts/list' },
      handlers
    );
    assert.equal((promptsList.body as any).result.prompts.length, MCP_PROMPTS.length);
  });

  it('executes tools/call returning MCP content + structuredContent and returns -32601 on unknown methods', async () => {
    const handlers = {
      executeTool: (name: string, args: Record<string, unknown>) => ({
        tool: name,
        appId: args.appId,
        verdict: 'GO',
      }),
      readResource: (uri: string) =>
        uri === 'gate://fleet/summary'
          ? { uri, mimeType: 'application/json', text: '{"total":14}' }
          : null,
    };

    const callRes = await dispatchMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'get_property_gate', arguments: { appId: 'www' } },
      },
      handlers
    );
    assert.equal(callRes.statusCode, 200);
    const result = (callRes.body as any).result;
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    assert.equal(result.structuredContent.verdict, 'GO');

    const readOk = await dispatchMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'res-1',
        method: 'resources/read',
        params: { uri: 'gate://fleet/summary' },
      },
      handlers
    );
    assert.equal(readOk.statusCode, 200);
    assert.equal((readOk.body as any).result.contents[0].uri, 'gate://fleet/summary');

    const readMissing = await dispatchMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 'res-404',
        method: 'resources/read',
        params: { uri: 'gate://missing' },
      },
      handlers
    );
    assert.equal(readMissing.statusCode, 404);
    assert.equal((readMissing.body as any).error.code, -32002);

    const unknownMethod = await dispatchMcpJsonRpc(
      { jsonrpc: '2.0', id: 99, method: 'nonexistent/method' },
      handlers
    );
    assert.equal(unknownMethod.statusCode, 404);
    assert.equal((unknownMethod.body as any).error.code, -32601);
  });

  it('builds prompt messages, manifest, client config snippets, and zero-secret per-check MCP payloads', () => {
    const prompt = buildMcpPromptMessages('triage_nogo_blockers', { appId: 'login' });
    assert.ok(prompt);
    assert.match(prompt!.messages[0].content.text, /login/);
    assert.equal(buildMcpPromptMessages('unknown_prompt'), null);

    const manifest = buildMcpManifest('https://gate.example.com');
    assert.equal(manifest.transport.endpoint, 'https://gate.example.com/api/v1/mcp/rpc');
    assert.equal(manifest.counts.tools, 10);

    const snippets = buildMcpClientSnippets('https://gate.example.com');
    assert.equal(snippets.length, 6);
    assert.ok(snippets.every((s) => s.code.includes('https://gate.example.com/api/v1/mcp/rpc')));
    assert.ok(snippets.every((s) => !/SECRET|PASSWORD|AKIA/i.test(s.code)));

    const payloadJson = buildCheckMcpCallPayload({
      appId: 'www',
      testId: 'T02',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
    });
    const parsed = JSON.parse(payloadJson);
    assert.equal(parsed.method, 'tools/call');
    assert.equal(parsed.params.name, 'inspect_check_evidence');
    assert.equal(parsed.params.arguments.appId, 'www');
    assert.equal(parsed.params.arguments.testId, 'T02');
  });
});
