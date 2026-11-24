import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEMPLATE_CONFIG,
  PROPERTY_TEST_SUITES,
  TestCaseDefinition,
} from '../config/template.config';
import {
  DEFAULT_TEST_FOLDERS,
  normalizeSuiteWithCatchpointDefaults,
} from './catchpointCatalog';
import {
  McpPolicyState,
  McpStateStore,
  executeManageEnvironment,
  executeManageGatePolicies,
  executeManageProperty,
  executeManageRuns,
  executeManageTestFolders,
  executeManageTestSuite,
  isPrivateOrLoopbackHost,
  redactSensitiveHeadersForOutput,
  sanitizeHostMap,
  sanitizeSafeId,
  sanitizeStringRecord,
  validatePublicEdgeIp,
} from './mcpOperations';
import {
  MCP_PROMPTS,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_RESOURCE_TEMPLATES,
  MCP_SERVER_VERSION,
  MCP_TOOLS,
  buildMcpClientSnippets,
  dispatchMcpJsonRpc,
} from './mcpProtocol';
import { RunRecord } from './types';

const DEFAULT_POLICIES: McpPolicyState = {
  acceptedRules: [
    {
      id: 'rule-cache',
      appId: 'all',
      comparisonId: 'all',
      kind: 'x-check-cacheable',
      enabled: false,
      by: 'test@salesforce.com',
      at: '2026-01-01T00:00:00Z',
      note: 'Seeded header rule',
    },
  ],
  acceptedCookies: ['OptanonConsent'],
  acceptedVisualTests: [],
  acceptedVisualParams: {},
  ignoreAcceptedDiffs: true,
};

function createTestState(): McpStateStore {
  const suitesByAppId: Record<string, TestCaseDefinition[]> = {};
  for (const prop of DEFAULT_TEMPLATE_CONFIG.properties) {
    const raw = PROPERTY_TEST_SUITES[prop.id] || PROPERTY_TEST_SUITES.www || [];
    suitesByAppId[prop.id] = normalizeSuiteWithCatchpointDefaults(
      structuredClone(raw)
    );
  }
  const sampleRuns: RunRecord[] = [
    {
      key: 'run-www-staging-1',
      target: 'www.prod.staging',
      appId: 'www',
      envId: 'prod',
      network: 'staging',
      suiteKey: 'www-suite',
      suiteSha256: 'abc123',
      suiteRowCount: suitesByAppId.www.length,
      startTime: '2026-06-01T10:00:00Z',
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      by: 'test-runner',
      results: [],
    },
    {
      key: 'run-www-prod-1',
      target: 'www.prod.prod',
      appId: 'www',
      envId: 'prod',
      network: 'prod',
      suiteKey: 'www-suite',
      suiteSha256: 'abc123',
      suiteRowCount: suitesByAppId.www.length,
      startTime: '2026-06-01T10:01:00Z',
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      by: 'test-runner',
      results: [],
    },
  ];
  return {
    properties: structuredClone(DEFAULT_TEMPLATE_CONFIG.properties),
    suitesByAppId,
    folders: structuredClone(DEFAULT_TEST_FOLDERS),
    policies: structuredClone(DEFAULT_POLICIES),
    runs: sampleRuns,
  };
}

test('MCP protocol catalog exposes all 17 tools, 9 static resources, 4 templates, 4 prompts, and valid RPC dispatch', async () => {
  assert.equal(MCP_SERVER_VERSION, '3.0.0');
  assert.equal(MCP_TOOLS.length, 17);
  assert.equal(MCP_RESOURCES.length, 9);
  assert.equal(MCP_RESOURCE_TEMPLATES.length, 4);
  assert.equal(MCP_PROMPTS.length, 4);

  const names = new Set(MCP_TOOLS.map((t) => t.name));
  for (const requiredTool of [
    'list_akamai_properties',
    'manage_property',
    'manage_environment',
    'manage_test_suite',
    'manage_test_folders',
    'manage_gate_policies',
    'get_fleet_status',
    'get_property_gate',
    'compare_targets',
    'manage_runs',
    'manage_synthetics_canaries',
  ]) {
    assert.ok(names.has(requiredTool), `Missing MCP tool ${requiredTool}`);
  }

  const snippets = buildMcpClientSnippets('http://localhost:3000');
  assert.ok(snippets.length >= 4);
  assert.ok(
    snippets.some(
      (s) => s.instructions.includes('17') || s.code.includes('manage_environment')
    )
  );

  const init = await dispatchMcpJsonRpc(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    {
      executeTool: () => ({ ok: true }),
      readResource: () => null,
    }
  );
  assert.equal(init.statusCode, 200);
  const initBody = init.body as { result: { protocolVersion: string } };
  assert.equal(initBody.result.protocolVersion, MCP_PROTOCOL_VERSION);

  const list = await dispatchMcpJsonRpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      executeTool: () => ({ ok: true }),
      readResource: () => null,
    }
  );
  const listBody = list.body as { result: { tools: Array<{ name: string }> } };
  assert.equal(listBody.result.tools.length, 17);

  const promptRes = await dispatchMcpJsonRpc(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'prompts/get',
      params: { name: 'configure_env_and_tests', arguments: { appId: 'www' } },
    },
    {
      executeTool: () => ({ ok: true }),
      readResource: () => null,
    }
  );
  assert.equal(promptRes.statusCode, 200);
});

test('manage_property supports list, get, create, update, patch, clone, delete, and last-property protection', () => {
  let state = createTestState();

  const listed = executeManageProperty(state, { action: 'list' });
  assert.equal(listed.mutated, false);
  assert.ok(Array.isArray(listed.result.properties));

  const created = executeManageProperty(state, {
    action: 'create',
    appId: 'commerce',
    name: 'Commerce Cloud',
    canonicalHost: 'commerce.salesforce.com',
    division: 'Commerce',
    tags: ['tier-1', 'akamai'],
    headers: { 'x-team': 'commerce' },
  });
  assert.equal(created.mutated, true);
  state = created.state;
  assert.ok(state.properties.some((p) => p.id === 'commerce'));

  const patched = executeManageProperty(state, {
    action: 'patch',
    appId: 'commerce',
    description: 'Updated description',
    tags: ['tier-0'],
    headers: { 'x-ring': 'canary' },
    merge: true,
  });
  state = patched.state;
  const commerce = state.properties.find((p) => p.id === 'commerce');
  assert.equal(commerce?.description, 'Updated description');
  assert.deepEqual(commerce?.tags, ['tier-0']);
  assert.equal(commerce?.headers?.['x-team'], 'commerce');
  assert.equal(commerce?.headers?.['x-ring'], 'canary');

  const cloned = executeManageProperty(state, {
    action: 'clone',
    appId: 'www',
    newAppId: 'www-canary',
    name: 'WWW Canary',
    cloneSuite: true,
  });
  state = cloned.state;
  assert.ok(state.properties.some((p) => p.id === 'www-canary'));
  assert.equal(
    state.suitesByAppId['www-canary']?.length,
    state.suitesByAppId.www.length
  );

  const deleted = executeManageProperty(state, {
    action: 'delete',
    appId: 'www-canary',
  });
  state = deleted.state;
  assert.ok(!state.properties.some((p) => p.id === 'www-canary'));

  const singleState: McpStateStore = {
    ...state,
    properties: [state.properties[0]],
  };
  assert.throws(
    () =>
      executeManageProperty(singleState, {
        action: 'delete',
        appId: singleState.properties[0].id,
      }),
    /last remaining property/i
  );
});

test('manage_environment supports all 16 environment & hostMap manipulations', () => {
  let state = createTestState();

  const listed = executeManageEnvironment(state, {
    action: 'list',
    appId: 'www',
  });
  assert.equal(listed.mutated, false);
  const initialCount = (listed.result.environments as unknown[]).length;
  assert.ok(initialCount >= 1);

  // add
  const added = executeManageEnvironment(state, {
    action: 'add',
    appId: 'www',
    envId: 'qa',
    name: 'QA Edge',
    tier: 'qa',
    hostMap: { 'www.salesforce.com': 'qa.salesforce.com' },
    networks: ['staging', 'prod'],
    stagingEdgeIp: '23.192.228.80',
    prodEdgeIp: '23.192.228.84',
    headers: { 'x-env': 'qa', authorization: 'Bearer super-secret' },
    variables: { region: 'us-west-2' },
    scheduleIntervalMin: 15,
    alertThresholdMs: 1400,
  });
  assert.equal(added.mutated, true);
  state = added.state;
  const returnedEnv = added.result.environment as {
    headers?: Record<string, string>;
  };
  assert.equal(returnedEnv.headers?.authorization, '[REDACTED]');

  // get
  const got = executeManageEnvironment(state, {
    action: 'get',
    appId: 'www',
    envId: 'qa',
  });
  assert.equal((got.result.environment as { id: string }).id, 'qa');

  // set_host_map (merge)
  const hm = executeManageEnvironment(state, {
    action: 'set_host_map',
    appId: 'www',
    envId: 'qa',
    hostMap: { 'c1.sfdcstatic.com': 'qa-c1.sfdcstatic.com' },
    merge: true,
  });
  state = hm.state;
  let qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.hostMap['www.salesforce.com'], 'qa.salesforce.com');
  assert.equal(qaEnv?.hostMap['c1.sfdcstatic.com'], 'qa-c1.sfdcstatic.com');

  // remove_host_map_key
  const rmHm = executeManageEnvironment(state, {
    action: 'remove_host_map_key',
    appId: 'www',
    envId: 'qa',
    canonicalHost: 'c1.sfdcstatic.com',
  });
  state = rmHm.state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.hostMap['c1.sfdcstatic.com'], undefined);

  // set_edge_ips
  state = executeManageEnvironment(state, {
    action: 'set_edge_ips',
    appId: 'www',
    envId: 'qa',
    stagingEdgeIp: '23.192.228.90',
    prodEdgeIp: '23.192.228.91',
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.edgeIps?.staging, '23.192.228.90');
  assert.equal(qaEnv?.edgeIps?.prod, '23.192.228.91');

  // set_networks
  state = executeManageEnvironment(state, {
    action: 'set_networks',
    appId: 'www',
    envId: 'qa',
    networks: ['staging'],
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.deepEqual(qaEnv?.networks, ['staging']);

  // set_headers
  state = executeManageEnvironment(state, {
    action: 'set_headers',
    appId: 'www',
    envId: 'qa',
    headers: { 'x-canary': 'true' },
    merge: true,
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.headers?.['x-canary'], 'true');

  // set_variables
  state = executeManageEnvironment(state, {
    action: 'set_variables',
    appId: 'www',
    envId: 'qa',
    variables: { tenant: 'sandbox' },
    merge: true,
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.variables?.tenant, 'sandbox');
  assert.equal(qaEnv?.variables?.region, 'us-west-2');

  // set_schedule
  state = executeManageEnvironment(state, {
    action: 'set_schedule',
    appId: 'www',
    envId: 'qa',
    scheduleIntervalMin: 5,
    alertThresholdMs: 950,
    defaultPopId: 'us-west-sjc',
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.scheduleIntervalMin, 5);
  assert.equal(qaEnv?.alertThresholdMs, 950);
  assert.equal(qaEnv?.defaultPopId, 'us-west-sjc');

  // pin_baseline
  state = executeManageEnvironment(state, {
    action: 'pin_baseline',
    appId: 'www',
    envId: 'qa',
    pinnedBaselineRunKey: 'run-www-prod-1',
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.pinnedBaselineRunKey, 'run-www-prod-1');

  // patch
  state = executeManageEnvironment(state, {
    action: 'patch',
    appId: 'www',
    envId: 'qa',
    description: 'Patched QA',
  }).state;
  qaEnv = state.properties
    .find((p) => p.id === 'www')
    ?.envs.find((e) => e.id === 'qa');
  assert.equal(qaEnv?.description, 'Patched QA');

  // clone
  state = executeManageEnvironment(state, {
    action: 'clone',
    appId: 'www',
    envId: 'qa',
    newEnvId: 'dr',
    name: 'DR Failover',
  }).state;
  assert.ok(
    state.properties
      .find((p) => p.id === 'www')
      ?.envs.some((e) => e.id === 'dr')
  );

  // reorder
  state = executeManageEnvironment(state, {
    action: 'reorder',
    appId: 'www',
    envId: 'dr',
    direction: 'up',
  }).state;

  // delete
  state = executeManageEnvironment(state, {
    action: 'delete',
    appId: 'www',
    envId: 'dr',
  }).state;
  assert.ok(
    !state.properties
      .find((p) => p.id === 'www')
      ?.envs.some((e) => e.id === 'dr')
  );

  // Protect deleting the last environment
  const oneEnvState = structuredClone(state);
  const wwwProp = oneEnvState.properties.find((p) => p.id === 'www')!;
  wwwProp.envs = [wwwProp.envs[0]];
  assert.throws(
    () =>
      executeManageEnvironment(oneEnvState, {
        action: 'delete',
        appId: 'www',
        envId: wwwProp.envs[0].id,
      }),
    /at least one environment/i
  );
});

test('manage_test_suite supports all test CRUD, assertions, scripts, steps, toggles, ordering, bulk ops, CSV export, and reset', () => {
  let state = createTestState();

  // create API check
  const created = executeManageTestSuite(state, {
    action: 'create',
    appId: 'www',
    name: 'Pricing API Health',
    path: '/api/v1/pricing',
    testType: 'api',
    httpMethod: 'POST',
    requestBody: '{"sku":"enterprise"}',
    expectedStatus: 200,
    critical: true,
    visualGate: false,
    requestHeaders: { 'x-client': 'synthetic', 'x-api-key': 'secret-token' },
    tags: ['api', 'pricing'],
  });
  assert.equal(created.mutated, true);
  state = created.state;
  const upserted = created.result.upserted as {
    id: string;
    requestHeaders?: Record<string, string>;
  };
  const newId = String(upserted.id);
  assert.ok(newId.startsWith('T'));
  assert.equal(upserted.requestHeaders?.['x-api-key'], '[REDACTED]');

  // patch
  state = executeManageTestSuite(state, {
    action: 'patch',
    appId: 'www',
    testId: newId,
    scheduleIntervalMin: 10,
    category: 'Pricing APIs',
  }).state;
  let item = state.suitesByAppId.www.find((t) => t.id === newId)!;
  assert.equal(item.scheduleIntervalMin, 10);
  assert.equal(item.category, 'Pricing APIs');

  // set_assertions
  state = executeManageTestSuite(state, {
    action: 'set_assertions',
    appId: 'www',
    testId: newId,
    assertions: {
      expectedBodyMatch: 'enterprise',
      maxLatencyMs: 900,
      minTlsVersion: 'TLSv1.3',
    },
  }).state;
  item = state.suitesByAppId.www.find((t) => t.id === newId)!;
  assert.equal(item.assertions?.expectedBodyMatch, 'enterprise');
  assert.equal(item.assertions?.maxLatencyMs, 900);

  // set_headers
  state = executeManageTestSuite(state, {
    action: 'set_headers',
    appId: 'www',
    testId: newId,
    requestHeaders: { 'x-trace': 'mcp' },
    merge: true,
  }).state;
  item = state.suitesByAppId.www.find((t) => t.id === newId)!;
  assert.equal(item.requestHeaders?.['x-trace'], 'mcp');

  // set_transaction_steps
  state = executeManageTestSuite(state, {
    action: 'set_transaction_steps',
    appId: 'www',
    testId: newId,
    transactionSteps: [
      { step: 1, action: 'open', target: '/pricing' },
      { step: 2, action: 'assertText', target: 'h1', assertText: 'Enterprise' },
    ],
  }).state;
  item = state.suitesByAppId.www.find((t) => t.id === newId)!;
  assert.equal(item.transactionSteps?.length, 2);

  // set_script
  state = executeManageTestSuite(state, {
    action: 'set_script',
    appId: 'www',
    testId: newId,
    scriptEngine: 'playwright',
    scriptContent: 'await page.goto("https://www.salesforce.com/pricing");',
  }).state;
  item = state.suitesByAppId.www.find((t) => t.id === newId)!;
  assert.equal(item.scriptEngine, 'playwright');

  // set_tags
  state = executeManageTestSuite(state, {
    action: 'set_tags',
    appId: 'www',
    testId: newId,
    tags: ['p0', 'edge'],
  }).state;
  item = state.suitesByAppId.www.find((t) => t.id === newId)!;
  assert.deepEqual(item.tags, ['p0', 'edge']);

  // toggles
  state = executeManageTestSuite(state, {
    action: 'toggle_enabled',
    appId: 'www',
    testId: newId,
    enabled: false,
  }).state;
  assert.equal(
    state.suitesByAppId.www.find((t) => t.id === newId)?.enabled,
    false
  );

  state = executeManageTestSuite(state, {
    action: 'toggle_visual_gate',
    appId: 'www',
    testId: newId,
    enabled: true,
  }).state;
  assert.equal(
    state.suitesByAppId.www.find((t) => t.id === newId)?.visualGate,
    true
  );

  state = executeManageTestSuite(state, {
    action: 'toggle_critical',
    appId: 'www',
    testId: newId,
    enabled: false,
  }).state;
  assert.equal(
    state.suitesByAppId.www.find((t) => t.id === newId)?.critical,
    false
  );

  // clone & move_to_position & reorder
  const cloned = executeManageTestSuite(state, {
    action: 'clone',
    appId: 'www',
    testId: newId,
  });
  state = cloned.state;
  const cloneId = String((cloned.result.cloned as { id: string }).id);
  assert.notEqual(cloneId, newId);

  state = executeManageTestSuite(state, {
    action: 'move_to_position',
    appId: 'www',
    testId: cloneId,
    position: 0,
  }).state;
  assert.equal(state.suitesByAppId.www[0].id, cloneId);

  state = executeManageTestSuite(state, {
    action: 'reorder',
    appId: 'www',
    testId: cloneId,
    direction: 'down',
  }).state;
  assert.equal(state.suitesByAppId.www[1].id, cloneId);

  // bulk_toggle, bulk_assign_folder, bulk_upsert, bulk_delete
  state = executeManageTestSuite(state, {
    action: 'bulk_toggle',
    appId: 'www',
    testIds: [newId, cloneId],
    enabled: true,
  }).state;
  assert.equal(
    state.suitesByAppId.www.find((t) => t.id === newId)?.enabled,
    true
  );

  state = executeManageTestSuite(state, {
    action: 'bulk_assign_folder',
    appId: 'www',
    testIds: [newId, cloneId],
    folderId: 'api-integrations',
  }).state;
  assert.equal(
    state.suitesByAppId.www.find((t) => t.id === newId)?.folderId,
    'api-integrations'
  );

  state = executeManageTestSuite(state, {
    action: 'bulk_upsert',
    appId: 'www',
    tests: [
      {
        id: 'T90',
        name: 'DNS Lookup',
        path: '/',
        testType: 'dns-direct',
        dnsRecordType: 'A',
      },
      {
        id: 'T91',
        name: 'SSL Cert Expiry',
        path: '/',
        testType: 'ssl',
        port: 443,
      },
    ],
  }).state;
  assert.ok(state.suitesByAppId.www.some((t) => t.id === 'T90'));
  assert.ok(state.suitesByAppId.www.some((t) => t.id === 'T91'));

  // export_csv
  const csvOut = executeManageTestSuite(state, {
    action: 'export_csv',
    appId: 'www',
  });
  assert.ok(typeof csvOut.result.csv === 'string');
  assert.ok((csvOut.result.csv as string).includes('T90'));

  // bulk_delete
  state = executeManageTestSuite(state, {
    action: 'bulk_delete',
    appId: 'www',
    testIds: ['T90', 'T91', cloneId],
  }).state;
  assert.ok(!state.suitesByAppId.www.some((t) => t.id === 'T90'));

  // delete single
  state = executeManageTestSuite(state, {
    action: 'delete',
    appId: 'www',
    testId: newId,
  }).state;
  assert.ok(!state.suitesByAppId.www.some((t) => t.id === newId));

  // reset_defaults
  const reset = executeManageTestSuite(state, {
    action: 'reset_defaults',
    appId: 'www',
  });
  assert.equal(reset.mutated, true);
  assert.ok(reset.state.suitesByAppId.www.length >= 6);
});

test('manage_test_folders, manage_gate_policies, and manage_runs cover full CRUD and resets', () => {
  let state = createTestState();

  // Folders
  state = executeManageTestFolders(state, {
    action: 'create',
    folderId: 'release-smoke',
    name: 'Release Smoke',
    color: 'emerald',
    description: 'Pre-flight checks',
  }).state;
  assert.ok(state.folders.some((f) => f.id === 'release-smoke'));

  state = executeManageTestFolders(state, {
    action: 'assign_tests',
    appId: 'www',
    folderId: 'release-smoke',
    testIds: ['T01'],
  }).state;
  assert.equal(
    state.suitesByAppId.www.find((t) => t.id === 'T01')?.folderId,
    'release-smoke'
  );

  state = executeManageTestFolders(state, {
    action: 'delete',
    folderId: 'release-smoke',
  }).state;
  assert.ok(!state.folders.some((f) => f.id === 'release-smoke'));
  assert.notEqual(
    state.suitesByAppId.www.find((t) => t.id === 'T01')?.folderId,
    'release-smoke'
  );

  // Policies
  state = executeManageGatePolicies(
    state,
    {
      action: 'add_header_rule',
      field: 'x-release-ring',
      appId: 'www',
      enabled: true,
      note: 'Accept canary ring header',
    },
    DEFAULT_POLICIES
  ).state;
  assert.ok(
    state.policies.acceptedRules.some((r) => r.kind === 'x-release-ring')
  );

  state = executeManageGatePolicies(
    state,
    { action: 'toggle_header_rule', field: 'x-release-ring', enabled: false },
    DEFAULT_POLICIES
  ).state;
  assert.equal(
    state.policies.acceptedRules.find((r) => r.kind === 'x-release-ring')
      ?.enabled,
    false
  );

  state = executeManageGatePolicies(
    state,
    { action: 'add_cookie_waiver', cookieName: 'sfdc-session' },
    DEFAULT_POLICIES
  ).state;
  assert.ok(state.policies.acceptedCookies.includes('sfdc-session'));

  state = executeManageGatePolicies(
    state,
    { action: 'add_visual_waiver', testId: 'T03' },
    DEFAULT_POLICIES
  ).state;
  assert.ok(state.policies.acceptedVisualTests.includes('T03'));

  state = executeManageGatePolicies(
    state,
    {
      action: 'add_visual_param_waiver',
      appId: 'www',
      testId: 'T01',
      paramId: 'hero-banner',
    },
    DEFAULT_POLICIES
  ).state;
  assert.ok(
    state.policies.acceptedVisualParams['www:T01']?.includes('hero-banner')
  );

  state = executeManageGatePolicies(
    state,
    { action: 'set_ignore_accepted', ignoreAcceptedDiffs: false },
    DEFAULT_POLICIES
  ).state;
  assert.equal(state.policies.ignoreAcceptedDiffs, false);

  state = executeManageGatePolicies(
    state,
    { action: 'reset_defaults' },
    DEFAULT_POLICIES
  ).state;
  assert.equal(state.policies.ignoreAcceptedDiffs, true);
  assert.equal(state.policies.acceptedVisualTests.length, 0);

  // Runs
  const runList = executeManageRuns(state, { action: 'list', appId: 'www' });
  assert.equal((runList.result.runs as unknown[]).length, 2);

  state = executeManageRuns(state, {
    action: 'pin_baseline',
    runKey: 'run-www-prod-1',
    pinned: true,
  }).state;
  assert.equal(
    state.runs.find((r) => r.key === 'run-www-prod-1')?.pinnedAsBaseline,
    true
  );

  state = executeManageRuns(state, {
    action: 'delete',
    runKey: 'run-www-staging-1',
  }).state;
  assert.equal(state.runs.length, 1);

  state = executeManageRuns(state, {
    action: 'purge_target',
    target: 'www.prod.prod',
    keepLatest: 0,
  }).state;
  assert.equal(state.runs.length, 0);
});

test('MCP security guardrails reject SSRF hosts/IPs, prototype pollution keys, invalid IDs, and redact secrets', () => {
  assert.equal(isPrivateOrLoopbackHost('localhost'), true);
  assert.equal(isPrivateOrLoopbackHost('127.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('169.254.169.254'), true);
  assert.equal(isPrivateOrLoopbackHost('10.0.1.5'), true);
  assert.equal(isPrivateOrLoopbackHost('192.168.1.10'), true);
  assert.equal(isPrivateOrLoopbackHost('internal.local'), true);
  assert.equal(isPrivateOrLoopbackHost('www.salesforce.com'), false);

  assert.throws(() => validatePublicEdgeIp('127.0.0.1'), /private|loopback/i);
  assert.throws(
    () => validatePublicEdgeIp('169.254.169.254'),
    /private|loopback/i
  );
  assert.throws(() => validatePublicEdgeIp('not-an-ip'), /valid IPv4/i);
  assert.equal(validatePublicEdgeIp('23.192.228.80'), '23.192.228.80');

  assert.throws(() => sanitizeSafeId('__proto__'), /Invalid id|Disallowed/i);
  assert.throws(() => sanitizeSafeId('constructor'), /Disallowed/i);
  assert.throws(() => sanitizeSafeId('../etc/passwd'), /alphanumeric/i);

  assert.throws(
    () => sanitizeHostMap({ 'www.salesforce.com': '169.254.169.254' }),
    /private|loopback/i
  );

  const protoPayload = JSON.parse(
    '{"__proto__":"evil","constructor":"bad","x-safe":"ok"}'
  );
  const cleaned = sanitizeStringRecord(protoPayload);
  assert.equal(cleaned['x-safe'], 'ok');
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, '__proto__'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(cleaned, 'constructor'),
    false
  );

  const redacted = redactSensitiveHeadersForOutput({
    Authorization: 'Bearer top-secret',
    Cookie: 'sid=123',
    'x-api-key': 'ak_live_999',
    'x-release-ring': 'canary',
  });
  assert.equal(redacted?.Authorization, '[REDACTED]');
  assert.equal(redacted?.Cookie, '[REDACTED]');
  assert.equal(redacted?.['x-api-key'], '[REDACTED]');
  assert.equal(redacted?.['x-release-ring'], 'canary');
});
