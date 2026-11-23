import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentPortalContext,
  PORTAL_AGENT_SKILLS,
  PORTAL_TOOL_SCHEMAS,
  buildAgentSystemInstruction,
  matchAgentSkills,
  planFallbackAgentResponse,
} from './agentSkills';

const SAMPLE_CONTEXT: AgentPortalContext = {
  activeAppId: 'www',
  activeAppName: 'Salesforce Global Marketing & Digital Experience',
  viewMode: 'workbench',
  compareMode: 'compare',
  candidateTarget: 'www.prod.staging',
  baselineTarget: 'www.prod.prod',
  selectedTestId: 'T01',
  inspectorTab: 'headers',
  selectedExecutionPopId: 'auto',
  headlineVerdict: 'NO-GO',
  counts: {
    headerDiffs: 10,
    cookieDiffs: 19,
    visualDiffs: 4,
    totalChecks: 8,
  },
  properties: [
    { id: 'www', name: 'Global Marketing', canonicalHost: 'www.salesforce.com', verdict: 'NO-GO', envs: ['prod'] },
    { id: 'login', name: 'Identity Login', canonicalHost: 'login.salesforce.com', verdict: 'GO', envs: ['prod'] },
    { id: 'developer', name: 'Developer Portal', canonicalHost: 'developer.salesforce.com', verdict: 'REVIEW', envs: ['prod'] },
  ],
  checks: [
    {
      testId: 'T01',
      testName: 'Salesforce Global Home & Hero Experience',
      path: '/',
      url: 'https://www.salesforce.com/',
      verdict: 'different',
      candStatus: 200,
      baseStatus: 200,
      headerDiffsCount: 2,
      cookieDiffsCount: 4,
      visualVerdict: 'different',
      testType: 'web-chrome',
    },
    {
      testId: 'T05',
      testName: 'Salesforce Free Trial Signup',
      path: '/form/signup/freetrial-sales/',
      url: 'https://www.salesforce.com/form/signup/freetrial-sales/',
      verdict: 'different',
      candStatus: 200,
      baseStatus: 200,
      headerDiffsCount: 2,
      cookieDiffsCount: 4,
      visualVerdict: 'same',
      testType: 'transaction-playwright',
    },
  ],
  acceptedHeaders: ['date'],
  acceptedCookies: ['OptanonConsent'],
  acceptedVisualTests: [],
  schedulePolicy: {
    enabled: true,
    intervalMinutes: 5,
    cronExpression: '*/5 * * * *',
    strategy: 'round-robin',
    assignedPops: ['iad', 'lhr', 'nrt'],
    slaTargetPct: 99.5,
    slaWarningMs: 900,
    slaCriticalMs: 1800,
  },
};

test('1. Portal Agent Skills catalog & tool schemas cover all portal capabilities', () => {
  assert.equal(PORTAL_AGENT_SKILLS.length, 6);
  const ids = PORTAL_AGENT_SKILLS.map((s) => s.id);
  assert.ok(ids.includes('release-gate-runner'));
  assert.ok(ids.includes('scheduled-runs-ops'));
  assert.ok(ids.includes('environment-test-architect'));
  assert.ok(ids.includes('diff-triage-governance'));
  assert.ok(ids.includes('ide-script-author'));
  assert.ok(ids.includes('fleet-health-auditor'));

  const toolNames = new Set(PORTAL_TOOL_SCHEMAS.map((t) => t.name));
  for (const requiredTool of [
    'get_portal_state',
    'switch_view',
    'select_property',
    'select_check',
    'run_live_gate',
    'rerun_check',
    'run_ai_visual_judge',
    'trigger_scheduled_run',
    'update_schedule_policy',
    'inspect_schedule_graph',
    'create_property',
    'upsert_environment',
    'create_or_update_test',
    'delete_test',
    'toggle_accept_header',
    'toggle_accept_cookie',
    'toggle_accept_visual',
    'reset_policies',
    'copy_gate_report',
  ]) {
    assert.ok(toolNames.has(requiredTool), `Missing schema for tool: ${requiredTool}`);
  }
});

test('2. Skill matching and system instruction grounding reflect live context', () => {
  const matched = matchAgentSkills('Trigger a scheduled run and open SLA Matrix graph');
  assert.ok(matched.some((s) => s.id === 'scheduled-runs-ops'));

  const instruction = buildAgentSystemInstruction(SAMPLE_CONTEXT, matched);
  assert.ok(instruction.includes('www.prod.staging <-> www.prod.prod'));
  assert.ok(instruction.includes('NO-GO'));
  assert.ok(instruction.includes('Scheduled Runs & SLA Ops'));
});

test('3. Planner handles Scheduled Runs, Cron Updates & Graph Switching', () => {
  const plan = planFallbackAgentResponse(
    'Trigger a scheduled run on login, set schedule interval to 15m round-robin, and show scatterplot graph for 6h',
    SAMPLE_CONTEXT
  );
  assert.ok(plan.actions.some((a) => a.type === 'select_property' && a.appId === 'login'));
  const upd = plan.actions.find((a) => a.type === 'update_schedule_policy');
  assert.ok(upd && upd.type === 'update_schedule_policy');
  assert.equal(upd.intervalMinutes, 15);
  assert.equal(upd.strategy, 'round-robin');

  const trig = plan.actions.find((a) => a.type === 'trigger_scheduled_run');
  assert.ok(trig && trig.type === 'trigger_scheduled_run');
  assert.equal(trig.appId, 'login');

  const graph = plan.actions.find((a) => a.type === 'inspect_schedule_graph');
  assert.ok(graph && graph.type === 'inspect_schedule_graph');
  assert.equal(graph.graphMode, 'scatterplot');
  assert.equal(graph.timeRange, '6h');
});

test('4. Planner handles Live Gate execution, Playwright check creation & Governance policies', () => {
  const gatePlan = planFallbackAgentResponse(
    'Run Live Gate on developer and judge T01 visually',
    SAMPLE_CONTEXT
  );
  assert.ok(gatePlan.actions.some((a) => a.type === 'select_property' && a.appId === 'developer'));
  assert.ok(gatePlan.actions.some((a) => a.type === 'run_live_gate' && a.appId === 'developer'));
  assert.ok(gatePlan.actions.some((a) => a.type === 'run_ai_visual_judge' && a.testId === 'T01'));

  const pwPlan = planFallbackAgentResponse(
    'Add a Playwright test T09 for /products/ai-cloud/',
    SAMPLE_CONTEXT
  );
  const createTest = pwPlan.actions.find((a) => a.type === 'create_or_update_test');
  assert.ok(createTest && createTest.type === 'create_or_update_test');
  assert.equal(createTest.testId, 'T09');
  assert.equal(createTest.path, '/products/ai-cloud/');
  assert.equal(createTest.testType, 'transaction-playwright');
  assert.equal(createTest.scriptEngine, 'playwright');

  const policyPlan = planFallbackAgentResponse(
    'Accept cookie ak_bmsc and accept header cache-control',
    SAMPLE_CONTEXT
  );
  assert.ok(
    policyPlan.actions.some((a) => a.type === 'toggle_accept_cookie' && a.cookieName === 'ak_bmsc')
  );
  assert.ok(
    policyPlan.actions.some(
      (a) => a.type === 'toggle_accept_header' && a.field === 'cache-control'
    )
  );
});

test('5. Planner handles Synthetics/Fleet, Studio/VS Code, Setup & Markdown report actions', () => {
  const fleetPlan = planFallbackAgentResponse(
    'Open Fleet Matrix and export Markdown report',
    SAMPLE_CONTEXT
  );
  assert.ok(fleetPlan.actions.some((a) => a.type === 'switch_view' && a.viewMode === 'synthetics'));
  assert.ok(fleetPlan.actions.some((a) => a.type === 'copy_gate_report'));

  const vscodePlan = planFallbackAgentResponse('Open VS Code workspace', SAMPLE_CONTEXT);
  assert.ok(vscodePlan.actions.some((a) => a.type === 'switch_view' && a.viewMode === 'vscode'));
});

test('6. Planner handles greetings ("hi"), typos ("hellp"), diagnostic root-cause queries, and bulk diff acceptance without ever returning "Done."', () => {
  const hiPlan = planFallbackAgentResponse('hi', SAMPLE_CONTEXT);
  assert.notEqual(hiPlan.reply.trim().toLowerCase(), 'done.');
  assert.ok(hiPlan.reply.includes('Portal AI Release Gate Operator'));
  assert.ok(hiPlan.reply.includes('NO-GO'));
  assert.ok(hiPlan.reply.includes('Commands you can run right now'));

  const hellpPlan = planFallbackAgentResponse('hellp', SAMPLE_CONTEXT);
  assert.notEqual(hellpPlan.reply.trim().toLowerCase(), 'done.');
  assert.ok(hellpPlan.reply.includes('Commands you can run right now'));
  assert.ok(hellpPlan.reply.includes('T01'));

  const whyPlan = planFallbackAgentResponse('Why is www NO-GO?', SAMPLE_CONTEXT);
  assert.ok(whyPlan.reply.includes('Why `www` is `NO-GO`'));
  assert.ok(whyPlan.reply.includes('T01'));
  assert.ok(whyPlan.reply.includes('Accept all diffs'));

  const explainT01 = planFallbackAgentResponse('Explain T01', SAMPLE_CONTEXT);
  assert.ok(explainT01.actions.some((a) => a.type === 'select_check' && a.testId === 'T01'));
  assert.ok(explainT01.reply.includes('T01 — Salesforce Global Home & Hero Experience'));
  assert.ok(explainT01.reply.includes('Drift Breakdown'));

  const acceptAll = planFallbackAgentResponse('Accept all diffs', SAMPLE_CONTEXT);
  assert.ok(
    acceptAll.actions.some(
      (a) => a.type === 'toggle_accept_header' && a.field === 'x-check-cacheable'
    )
  );
  assert.ok(
    acceptAll.actions.some((a) => a.type === 'toggle_accept_visual' && a.testId === 'T01')
  );
});

