/**
 * ============================================================================
 * PORTAL AGENT SKILLS & MODULAR ACTION ENGINE
 * ============================================================================
 * Pure, modular skills registry and action planner so the built-in AI Agent
 * can run tests, manage scheduled runs & telemetry graphs, edit environments
 * and Catchpoint/Playwright suites, triage/accept diffs, audit Fleet health,
 * and navigate all portal views cleanly.
 * ============================================================================
 */

import type { CatchpointTestType, TestScriptEngine } from './types';
import type {
  PopDistributionStrategy,
  ScheduleGraphMode,
  ScheduleIntervalMinutes,
  ScheduledRunPoint,
  ScheduleTimeRange,
} from './scheduledRunsEngine';
import type { InspectorDimensionTab, WorkbenchViewMode } from './workbenchModel';

export type AgentSkillCategory =
  | 'execution'
  | 'scheduling'
  | 'configuration'
  | 'governance'
  | 'ide'
  | 'observability';

export interface AgentSkillDefinition {
  id: string;
  name: string;
  category: AgentSkillCategory;
  shortLabel: string;
  description: string;
  triggers: string[];
  capabilities: string[];
  toolNames: string[];
  starterPrompt: string;
}

export type AgentPortalAction =
  | {
      type: 'switch_view';
      viewMode: WorkbenchViewMode;
      setupTab?: 'suite' | 'envs';
    }
  | {
      type: 'select_property';
      appId: string;
    }
  | {
      type: 'select_check';
      testId: string;
      tab?: InspectorDimensionTab;
    }
  | {
      type: 'set_comparison_targets';
      compareMode?: 'compare' | 'single';
      candidateTarget?: string;
      baselineTarget?: string;
      executionPopId?: string;
      ignoreAcceptedDiffs?: boolean;
    }
  | {
      type: 'run_live_gate';
      appId?: string;
    }
  | {
      type: 'rerun_check';
      testId: string; // 'T01'..'T08' or 'ALL_DIFFS'
    }
  | {
      type: 'run_ai_visual_judge';
      testId: string;
    }
  | {
      type: 'trigger_scheduled_run';
      appId?: string;
      popId?: string;
      switchToSchedulesView?: boolean;
      point?: ScheduledRunPoint;
    }
  | {
      type: 'update_schedule_policy';
      appId?: string;
      enabled?: boolean;
      intervalMinutes?: ScheduleIntervalMinutes;
      strategy?: PopDistributionStrategy;
      assignedPops?: string[];
      slaTargetPct?: number;
      slaWarningMs?: number;
      slaCriticalMs?: number;
    }
  | {
      type: 'inspect_schedule_graph';
      graphMode?: ScheduleGraphMode;
      timeRange?: ScheduleTimeRange;
      checkFilter?: string;
      popFilter?: string;
    }
  | {
      type: 'create_property';
      id: string;
      name: string;
      canonicalHost: string;
      envName?: string;
    }
  | {
      type: 'upsert_environment';
      appId?: string;
      envId: string;
      envName: string;
      stagingHost?: string;
      prodHost?: string;
      stagingEdgeIp?: string;
      prodEdgeIp?: string;
      networks?: ('staging' | 'prod')[];
    }
  | {
      type: 'create_or_update_test';
      appId?: string;
      testId?: string;
      name: string;
      path: string;
      testType?: CatchpointTestType;
      httpMethod?: 'GET' | 'POST' | 'PUT' | 'HEAD' | 'OPTIONS';
      expectedStatus?: string;
      scriptEngine?: TestScriptEngine;
      customScript?: string;
    }
  | {
      type: 'delete_test';
      appId?: string;
      testId: string;
    }
  | {
      type: 'toggle_accept_header';
      field: string;
    }
  | {
      type: 'toggle_accept_cookie';
      cookieName: string;
    }
  | {
      type: 'toggle_accept_visual';
      testId: string;
    }
  | {
      type: 'reset_policies';
    }
  | {
      type: 'copy_gate_report';
    };

export interface AgentPortalContextCheck {
  testId: string;
  testName: string;
  path: string;
  url: string;
  verdict: string;
  candStatus: number;
  baseStatus?: number;
  headerDiffsCount: number;
  cookieDiffsCount: number;
  visualVerdict?: string;
  testType?: string;
}

export interface AgentPortalContext {
  activeAppId: string;
  activeAppName: string;
  viewMode: WorkbenchViewMode;
  compareMode: 'compare' | 'single';
  candidateTarget: string;
  baselineTarget: string;
  selectedTestId: string;
  inspectorTab: InspectorDimensionTab;
  selectedExecutionPopId: string;
  headlineVerdict: string;
  counts: {
    headerDiffs: number;
    cookieDiffs: number;
    visualDiffs: number;
    totalChecks: number;
  };
  properties: Array<{
    id: string;
    name: string;
    canonicalHost: string;
    verdict?: string;
    envs: string[];
  }>;
  checks: AgentPortalContextCheck[];
  acceptedHeaders: string[];
  acceptedCookies: string[];
  acceptedVisualTests: string[];
  schedulePolicy: {
    enabled: boolean;
    intervalMinutes: ScheduleIntervalMinutes;
    cronExpression: string;
    strategy: PopDistributionStrategy;
    assignedPops: string[];
    slaTargetPct: number;
    slaWarningMs: number;
    slaCriticalMs: number;
  };
}

export interface FallbackAgentPlan {
  reply: string;
  matchedSkills: string[];
  actions: AgentPortalAction[];
}

export const PORTAL_AGENT_SKILLS: AgentSkillDefinition[] = [
  {
    id: 'release-gate-runner',
    name: 'Release Gate Runner',
    category: 'execution',
    shortLabel: 'Live Gate & Probes',
    description:
      'Execute Live Release Gate across staging vs production, re-run individual checks or failed diffs, run AI Visual Judge, and switch regional Akamai PoPs.',
    triggers: [
      'run live gate',
      're-run',
      'rerun',
      'visual judge',
      'ai judge',
      'pop',
      'probe',
      'execute',
    ],
    capabilities: [
      'Run full Live Gate suite for any property',
      'Re-run single checks (T01..T08) or all diff checks',
      'Invoke multimodal AI Visual Judge',
      'Switch candidate/baseline targets & edge PoPs',
    ],
    toolNames: [
      'run_live_gate',
      'rerun_check',
      'run_ai_visual_judge',
      'set_comparison_targets',
      'select_property',
      'select_check',
    ],
    starterPrompt: 'Run Live Gate on the active property and judge visual diffs',
  },
  {
    id: 'scheduled-runs-ops',
    name: 'Scheduled Runs & SLA Ops',
    category: 'scheduling',
    shortLabel: 'Schedules & Graphs',
    description:
      'Trigger ad-hoc scheduled runs, switch between Trend, Scatterplot, Phase Breakdown, and SLA Matrix charts, and configure cron intervals, PoP distribution, and SLA budgets.',
    triggers: [
      'schedule',
      'cron',
      'interval',
      'graph',
      'chart',
      'scatter',
      'timeseries',
      'sla',
      'breakdown',
      'maintenance',
    ],
    capabilities: [
      'Trigger immediate scheduled synthetic run',
      'Switch schedule graph mode & timeframe (1h/6h/24h/7d)',
      'Update cron interval (1m–60m) & PoP strategy',
      'Adjust SLA availability target & warning thresholds',
    ],
    toolNames: [
      'trigger_scheduled_run',
      'update_schedule_policy',
      'inspect_schedule_graph',
      'get_schedule_analytics',
    ],
    starterPrompt:
      'Trigger a scheduled run on www, open the Schedules view, and show the SLA Matrix graph',
  },
  {
    id: 'environment-test-architect',
    name: 'Environments & Test Architect',
    category: 'configuration',
    shortLabel: 'CRUD & Catchpoint',
    description:
      'Create or edit monitored properties, staging/prod hostMap environments, and all 25 Catchpoint test types including Playwright transactions, API, DNS, SSL, and BGP checks.',
    triggers: [
      'create',
      'add',
      'delete',
      'remove',
      'property',
      'environment',
      'env',
      'test',
      'check',
      'playwright',
      'catchpoint',
      'setup',
    ],
    capabilities: [
      'Create/switch properties with canonical hostnames',
      'Add or update environments & edge hostMaps',
      'Create Catchpoint Web, Playwright Tx, API, DNS & SSL checks',
      'Delete checks from a suite',
    ],
    toolNames: [
      'create_property',
      'upsert_environment',
      'create_or_update_test',
      'delete_test',
      'switch_view',
    ],
    starterPrompt:
      'Add a Playwright transaction check T09 for /form/signup/freetrial-sales/ on the active property',
  },
  {
    id: 'diff-triage-governance',
    name: 'Diff Triage & Policy Governance',
    category: 'governance',
    shortLabel: 'Triage & Policies',
    description:
      'Inspect GO/NO-GO release blockers, accept or undo expected header diffs, allowlist edge cookies, approve visual baselines, and manage policy rules.',
    triggers: [
      'accept',
      'allowlist',
      'undo',
      'policy',
      'policies',
      'cookie',
      'header',
      'visual',
      'blocker',
      'diff',
      'triage',
      'reset',
    ],
    capabilities: [
      'Accept or undo header drift rules (e.g. cache-control)',
      'Allowlist or remove cookies (e.g. ak_bmsc, bm_sz)',
      'Accept visual baseline for a specific check',
      'Audit blockers & reset factory policies',
    ],
    toolNames: [
      'toggle_accept_header',
      'toggle_accept_cookie',
      'toggle_accept_visual',
      'reset_policies',
      'switch_view',
    ],
    starterPrompt:
      'Summarize current NO-GO blockers and explain which diffs are safe to accept',
  },
  {
    id: 'ide-script-author',
    name: 'VS Code & Script Author',
    category: 'ide',
    shortLabel: 'Playwright IDE',
    description:
      'Open the built-in VS Code workspace IDE and generate or customize Playwright, Puppeteer, Selenium, or k6 scripts attached to synthetic checks.',
    triggers: ['vscode', 'vs code', 'ide', 'script', 'code', 'file', 'terminal'],
    capabilities: [
      'Open embedded VS Code workspace IDE',
      'Generate Playwright / Puppeteer / Catchpoint transaction scripts',
      'Attach custom scripts to suite checks',
    ],
    toolNames: ['switch_view', 'create_or_update_test', 'select_check'],
    starterPrompt:
      'Open VS Code workspace and create a Playwright health check script for T01',
  },
  {
    id: 'fleet-health-auditor',
    name: 'Fleet & Release Gate Auditor',
    category: 'observability',
    shortLabel: 'Fleet & Reports',
    description:
      'Audit global Fleet Matrix parity across all Salesforce properties, inspect live comparison metrics, and export Markdown release gate reports.',
    triggers: ['fleet', 'report', 'markdown', 'export', 'summary', 'health', 'status', 'all properties'],
    capabilities: [
      'Open Fleet Matrix & inspect all properties',
      'Summarize GO / REVIEW / NO-GO parity metrics',
      'Copy Markdown Release Gate report to clipboard',
    ],
    toolNames: ['switch_view', 'copy_gate_report', 'select_property'],
    starterPrompt: 'Open the Fleet Matrix and summarize release readiness across properties',
  },
];

export interface PortalToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<
      string,
      {
        type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ARRAY';
        description: string;
        enum?: string[];
        items?: { type: 'STRING' };
      }
    >;
    required?: string[];
  };
}

export const PORTAL_TOOL_SCHEMAS: PortalToolSchema[] = [
  {
    name: 'get_portal_state',
    description:
      'Inspect live Release Gate portal state including active property, verdict, failing checks, scheduled policy, and accepted rules.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'switch_view',
    description:
      'Navigate the portal UI to one of the main views: workbench, schedules, fleet, policies, setup, or vscode.',
    parameters: {
      type: 'OBJECT',
      properties: {
        viewMode: {
          type: 'STRING',
          enum: ['workbench', 'schedules', 'fleet', 'policies', 'setup', 'vscode'],
          description: 'Target portal view to open.',
        },
        setupTab: {
          type: 'STRING',
          enum: ['suite', 'envs'],
          description: 'Optional tab when viewMode is setup.',
        },
      },
      required: ['viewMode'],
    },
  },
  {
    name: 'select_property',
    description: 'Switch the active monitored property (e.g. www, login, developer, japan, uk).',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: {
          type: 'STRING',
          description: 'Property ID to activate.',
        },
      },
      required: ['appId'],
    },
  },
  {
    name: 'select_check',
    description: 'Focus a specific check ID (e.g. T01..T08) and optionally open an evidence tab.',
    parameters: {
      type: 'OBJECT',
      properties: {
        testId: {
          type: 'STRING',
          description: 'Check ID such as T01, T02, T03.',
        },
        tab: {
          type: 'STRING',
          enum: ['headers', 'cookies', 'image', 'flow'],
          description: 'Optional inspector tab to display.',
        },
      },
      required: ['testId'],
    },
  },
  {
    name: 'set_comparison_targets',
    description:
      'Configure compare mode, candidate/baseline targets, Akamai execution PoP, or accepted-diff filtering.',
    parameters: {
      type: 'OBJECT',
      properties: {
        compareMode: {
          type: 'STRING',
          enum: ['compare', 'single'],
          description: 'Side-by-side comparison or single target run.',
        },
        candidateTarget: {
          type: 'STRING',
          description: 'Candidate target ID like www.prod.staging.',
        },
        baselineTarget: {
          type: 'STRING',
          description: 'Baseline target ID like www.prod.prod.',
        },
        executionPopId: {
          type: 'STRING',
          description: 'Edge PoP ID (auto, iad, lhr, fra, nrt, sin, syd, sjc, gru, bom, ewr).',
        },
        ignoreAcceptedDiffs: {
          type: 'BOOLEAN',
          description: 'Whether accepted rules are suppressed from GO/NO-GO blockers.',
        },
      },
    },
  },
  {
    name: 'run_live_gate',
    description:
      'Execute a full Live Release Gate run (HTTP flow probes + live screenshots + AI judge) for the active or specified property.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: {
          type: 'STRING',
          description: 'Optional property ID; defaults to active property.',
        },
      },
    },
  },
  {
    name: 'rerun_check',
    description:
      'Re-run a single check (T01..T08) or ALL_DIFFS to capture fresh headers, cookies, HTTP waterfall, and live screenshot.',
    parameters: {
      type: 'OBJECT',
      properties: {
        testId: {
          type: 'STRING',
          description: 'Check ID (e.g. T01) or ALL_DIFFS.',
        },
      },
      required: ['testId'],
    },
  },
  {
    name: 'run_ai_visual_judge',
    description: 'Run the AI Visual Judge comparison on a specific check ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        testId: {
          type: 'STRING',
          description: 'Check ID (e.g. T01).',
        },
      },
      required: ['testId'],
    },
  },
  {
    name: 'get_schedule_analytics',
    description:
      'Query scheduled runs dataset, SLA availability %, raw vs maintenance-purged availability, p50/p95/p99 latency, and active policy for a property.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: {
          type: 'STRING',
          description: 'Property ID (defaults to active property).',
        },
        range: {
          type: 'STRING',
          enum: ['1h', '6h', '24h', '7d'],
          description: 'Time window for SLA calculation.',
        },
      },
    },
  },
  {
    name: 'trigger_scheduled_run',
    description:
      'Immediately trigger a scheduled synthetic run tick for a property and append the result to the scheduled telemetry series.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: {
          type: 'STRING',
          description: 'Property ID (defaults to active property).',
        },
        popId: {
          type: 'STRING',
          description: 'Optional PoP ID override (iad, lhr, fra, nrt, sin, etc.).',
        },
        switchToSchedulesView: {
          type: 'BOOLEAN',
          description: 'Navigate to Schedules view after triggering.',
        },
      },
    },
  },
  {
    name: 'update_schedule_policy',
    description:
      'Update scheduled run policy settings: intervalMinutes (1, 5, 10, 15, 30, 60), strategy, enabled, assignedPops, SLA targets.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: {
          type: 'STRING',
          description: 'Property ID (defaults to active property).',
        },
        enabled: {
          type: 'BOOLEAN',
          description: 'Enable or pause automated cron schedule.',
        },
        intervalMinutes: {
          type: 'NUMBER',
          description: 'Cron frequency in minutes (1, 5, 10, 15, 30, or 60).',
        },
        strategy: {
          type: 'STRING',
          enum: ['round-robin', 'all-pops', 'primary-regional'],
          description: 'PoP distribution strategy.',
        },
        assignedPops: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'List of PoP IDs (e.g. ["iad","lhr","nrt"]).',
        },
        slaTargetPct: {
          type: 'NUMBER',
          description: 'Target SLA availability percentage (e.g. 99.5).',
        },
        slaWarningMs: {
          type: 'NUMBER',
          description: 'Warning latency threshold in ms.',
        },
      },
    },
  },
  {
    name: 'inspect_schedule_graph',
    description:
      'Open the Schedules view and configure its graph visualization mode, timeframe, check filter, or PoP filter.',
    parameters: {
      type: 'OBJECT',
      properties: {
        graphMode: {
          type: 'STRING',
          enum: ['timeseries', 'scatterplot', 'breakdown', 'sla-availability'],
          description: 'Visualization mode.',
        },
        timeRange: {
          type: 'STRING',
          enum: ['1h', '6h', '24h', '7d'],
          description: 'Graph time window.',
        },
        checkFilter: {
          type: 'STRING',
          description: 'ALL or check ID like T01.',
        },
        popFilter: {
          type: 'STRING',
          description: 'ALL or PoP ID like iad, lhr, nrt.',
        },
      },
    },
  },
  {
    name: 'create_property',
    description: 'Create a new monitored web property in the portal topology.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: {
          type: 'STRING',
          description: 'Lowercase slug ID (e.g. commerce).',
        },
        name: {
          type: 'STRING',
          description: 'Human readable property name.',
        },
        canonicalHost: {
          type: 'STRING',
          description: 'Canonical hostname (e.g. commerce.salesforce.com).',
        },
      },
      required: ['id', 'name', 'canonicalHost'],
    },
  },
  {
    name: 'upsert_environment',
    description: 'Add or update an environment configuration on a property (hostMap, edge IPs, networks).',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: { type: 'STRING', description: 'Property ID (defaults to active property).' },
        envId: { type: 'STRING', description: 'Environment ID (e.g. uat, qa, staging).' },
        envName: { type: 'STRING', description: 'Display name (e.g. UAT).' },
        stagingHost: { type: 'STRING', description: 'Optional staging hostname override.' },
        prodHost: { type: 'STRING', description: 'Canonical hostname.' },
        stagingEdgeIp: { type: 'STRING', description: 'Optional Akamai staging edge IP.' },
        prodEdgeIp: { type: 'STRING', description: 'Optional Akamai prod edge IP.' },
      },
      required: ['envId', 'envName'],
    },
  },
  {
    name: 'create_or_update_test',
    description:
      'Create or update a Catchpoint / Playwright / API / DNS / SSL test check in the property test suite.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: { type: 'STRING', description: 'Property ID (defaults to active property).' },
        testId: { type: 'STRING', description: 'Optional ID like T09 (auto-generated if omitted).' },
        name: { type: 'STRING', description: 'Check display name.' },
        path: { type: 'STRING', description: 'URL path or full URL (e.g. /checkout/ or https://...).' },
        testType: {
          type: 'STRING',
          description:
            'Catchpoint type (e.g. web-chrome, transaction-playwright, api, http-object, dns-direct, ssl, bgp).',
        },
        httpMethod: {
          type: 'STRING',
          enum: ['GET', 'POST', 'PUT', 'HEAD', 'OPTIONS'],
          description: 'HTTP request method.',
        },
        expectedStatus: {
          type: 'STRING',
          description: 'Expected HTTP status code string (e.g. "200" or "301").',
        },
        scriptEngine: {
          type: 'STRING',
          enum: ['playwright', 'puppeteer', 'catchpoint', 'selenium', 'k6', 'node-fetch'],
          description: 'Programmable test script engine.',
        },
        customScript: {
          type: 'STRING',
          description: 'Optional Playwright or custom script source code.',
        },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'delete_test',
    description: 'Delete a test check from the property suite by testId.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appId: { type: 'STRING', description: 'Property ID.' },
        testId: { type: 'STRING', description: 'Check ID to remove.' },
      },
      required: ['testId'],
    },
  },
  {
    name: 'toggle_accept_header',
    description: 'Accept or undo an accepted policy rule for a specific HTTP header (e.g. cache-control, x-check-cacheable, vary).',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: { type: 'STRING', description: 'Lowercase HTTP header name.' },
      },
      required: ['field'],
    },
  },
  {
    name: 'toggle_accept_cookie',
    description: 'Allowlist or un-allowlist a cookie name in portal policy rules (e.g. ak_bmsc, bm_sz, geo_region).',
    parameters: {
      type: 'OBJECT',
      properties: {
        cookieName: { type: 'STRING', description: 'Cookie name to toggle in allowlist.' },
      },
      required: ['cookieName'],
    },
  },
  {
    name: 'toggle_accept_visual',
    description: 'Accept or revoke the visual diff baseline for a specific check ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        testId: { type: 'STRING', description: 'Check ID (e.g. T01).' },
      },
      required: ['testId'],
    },
  },
  {
    name: 'reset_policies',
    description: 'Reset all accepted headers, cookies, and visual rules back to factory defaults.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'copy_gate_report',
    description: 'Generate and copy the Markdown Release Gate report for the current comparison.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
];

export function matchAgentSkills(
  prompt: string,
  enabledSkillIds?: string[]
): AgentSkillDefinition[] {
  const lower = (prompt || '').toLowerCase();
  const pool = enabledSkillIds
    ? PORTAL_AGENT_SKILLS.filter((s) => enabledSkillIds.includes(s.id))
    : PORTAL_AGENT_SKILLS;
  const matched = pool.filter((skill) =>
    skill.triggers.some((t) => lower.includes(t))
  );
  return matched.length > 0 ? matched : pool.slice(0, 2);
}

export function buildAgentSystemInstruction(
  ctx: AgentPortalContext,
  activeSkills: AgentSkillDefinition[]
): string {
  const skillSummary = activeSkills
    .map((s) => `- ${s.name} (${s.id}): ${s.description}`)
    .join('\n');

  const checks = Array.isArray(ctx.checks) ? ctx.checks : [];
  const props = Array.isArray(ctx.properties) ? ctx.properties : [];
  const counts = ctx.counts || { headerDiffs: 0, cookieDiffs: 0, visualDiffs: 0, totalChecks: checks.length };
  const sched = ctx.schedulePolicy || {
    enabled: true,
    intervalMinutes: 15,
    cronExpression: '*/15 * * * *',
    strategy: 'round-robin',
    assignedPops: ['iad-us-east'],
    slaTargetPct: 99.9,
    slaWarningMs: 1200,
    slaCriticalMs: 3000,
  };

  const failingChecks = checks
    .filter((c) => c.verdict !== 'same' || c.candStatus >= 400)
    .slice(0, 10)
    .map(
      (c) =>
        `  * ${c.testId} (${c.testName}) [${c.path}] HTTP ${c.candStatus} -> verdict=${c.verdict}, hdr=${c.headerDiffsCount}, ck=${c.cookieDiffsCount}, visual=${c.visualVerdict || 'same'}`
    )
    .join('\n');

  return [
    `You are the built-in AI Portal Agent for the Salesforce Akamai Synthetic Release Gate.`,
    `You have live tool functions that execute EVERYTHING the portal offers (running Live Gates, re-running checks, running AI Visual Judge, triggering scheduled runs, updating schedule intervals/cron & SLA graphs, creating/editing properties, environments, Catchpoint checks & Playwright scripts, accepting header/cookie/visual diffs, auditing Fleet Matrix, and switching views).`,
    `Active Skills enabled for this request:\n${skillSummary}`,
    `Live Portal Snapshot:`,
    `- Active Property: ${ctx.activeAppId || 'www'} (${ctx.activeAppName || 'www'})`,
    `- Active View: ${ctx.viewMode || 'workbench'} · Compare Mode: ${ctx.compareMode || 'compare'}`,
    `- Candidate vs Baseline: ${ctx.candidateTarget || 'staging'} <-> ${ctx.baselineTarget || 'prod'} (PoP: ${ctx.selectedExecutionPopId || 'auto'})`,
    `- Selected Check: ${ctx.selectedTestId || 'T01'} (Tab: ${ctx.inspectorTab || 'headers'})`,
    `- Headline Verdict: ${ctx.headlineVerdict || 'REVIEW'} (${counts.headerDiffs} header diffs, ${counts.cookieDiffs} cookie diffs, ${counts.visualDiffs} visual diffs across ${counts.totalChecks} checks)`,
    `- Schedule Policy: ${sched.enabled ? 'ENABLED' : 'PAUSED'} · cron="${sched.cronExpression}" (${sched.intervalMinutes}m) · strategy=${sched.strategy} · SLA target=${sched.slaTargetPct}% · PoPs=${(sched.assignedPops || []).join(',')}`,
    `- Known Properties: ${props.map((p) => `${p.id}(${p.verdict || 'READY'})`).join(', ')}`,
    failingChecks ? `- Diff/Blocked Checks:\n${failingChecks}` : `- All checks currently passing.`,
    `Instructions:`,
    `1. Whenever the user asks to perform an action (run, schedule, switch view/property/graph, create/edit/delete test or env, accept/undo rule, open VS Code), ALWAYS call the matching tool(s) rather than merely describing how to click buttons.`,
    `2. You may chain multiple tool calls (for example, trigger_scheduled_run AND inspect_schedule_graph AND switch_view) to complete compound workflows in one turn.`,
    `3. Use the Live Portal Snapshot above directly; do NOT call get_portal_state before executing requested actions.`,
    `4. Be concise, accurate, and ground every answer in the live tool responses and portal context.`,
  ].join('\n');
}

function extractTestIdFromText(prompt: string): string | undefined {
  const m = prompt.match(/\b(T\d{2,3})\b/i);
  return m ? m[1].toUpperCase() : undefined;
}

function extractPropertyIdFromText(
  prompt: string,
  properties: AgentPortalContext['properties'] = []
): string | undefined {
  const lower = prompt.toLowerCase();
  // Explicit exact token match against configured property IDs
  for (const prop of properties) {
    const escaped = prop.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lower)) return prop.id;
  }
  return undefined;
}

const KNOWN_HTTP_HEADER_FIELDS = [
  'x-check-cacheable',
  'cache-control',
  'strict-transport-security',
  'content-type',
  'location',
  'x-frame-options',
  'content-security-policy',
  'x-cache',
  'x-cache-key',
  'x-true-cache-key',
  'vary',
  'set-cookie',
];

function isGreetingOrHelpIntent(lower: string): { isGreeting: boolean; isHelp: boolean } {
  const clean = lower.replace(/[^a-z0-9?\s]/g, '').trim();
  const isGreeting =
    /^(hi+|he+y+|he+ll+o+|he+ll+p+|yo+|sup|hola|greetings|good\s*(morning|afternoon|evening)|howdy)$/i.test(
      clean
    ) || /^(hi|hello|hey)\s+(there|agent|bot|portal)/i.test(clean);
  const isHelp =
    /\b(he+lp+|hellp|what can you do|how do i|how to use|capabilities|commands|skills|menu|options|guide|instructions|who are you)\b/i.test(
      clean
    ) || clean === '?';
  return { isGreeting, isHelp };
}

function isDiagnosticQuestionIntent(lower: string): boolean {
  return (
    /\b(why|what|which|explain|analyze|analyse|diagnose|status|summary|overview|blockers?|diffs?|differences?|wrong|fail(?:ed|ing|ures?)?|broken|issue|problem|root\s*cause|safe to (?:deploy|release)|go or no-?go|compare)\b/i.test(
      lower
    ) || lower.endsWith('?')
  );
}

function buildCheckDiagnosticDetail(
  check: AgentPortalContext['checks'][number],
  ctx: AgentPortalContext
): string {
  const parts: string[] = [];
  parts.push(
    `**${check.testId} — ${check.testName}** (\`${check.path}\` · ${check.testType || 'web-chrome'})`
  );
  parts.push(
    `- **Verdict:** \`${check.verdict.toUpperCase()}\` · Candidate HTTP **${check.candStatus}**${
      check.baseStatus ? ` vs Baseline HTTP **${check.baseStatus}**` : ''
    }`
  );
  parts.push(
    `- **Drift Breakdown:** **${check.headerDiffsCount}** header diff(s) · **${check.cookieDiffsCount}** cookie diff(s) · Visual AI: **${(
      check.visualVerdict || 'same'
    ).toUpperCase()}**`
  );
  const suggestions: string[] = [];
  if (check.headerDiffsCount > 0) {
    suggestions.push(`\`accept header x-check-cacheable\` or \`accept header cache-control\``);
  }
  if (check.cookieDiffsCount > 0) {
    suggestions.push(`\`accept cookie ak_bmsc\``);
  }
  if (check.visualVerdict && check.visualVerdict !== 'same') {
    suggestions.push(`\`run AI visual judge on ${check.testId}\` or \`accept visual ${check.testId}\``);
  }
  suggestions.push(`\`re-run ${check.testId}\``);
  parts.push(`- **Next Steps:** Try ${suggestions.join(', ')}.`);
  return parts.join('\n');
}

/**
 * Deterministic conversational & action planner used when Gemini API key is unavailable,
 * rate-limited, or running in serverless fallback mode.
 * Understands greetings, typos ("hellp"), diagnostic questions ("why is it NO-GO?"),
 * check-specific root cause queries, and all 19 portal actions.
 */
export function planFallbackAgentResponse(
  prompt: string,
  ctx: AgentPortalContext,
  enabledSkillIds?: string[]
): FallbackAgentPlan {
  const rawPrompt = (prompt || '').trim();
  const lower = rawPrompt.toLowerCase();
  const activeSkills = matchAgentSkills(rawPrompt, enabledSkillIds);
  const actions: AgentPortalAction[] = [];
  const notes: string[] = [];

  const checks = Array.isArray(ctx.checks) ? ctx.checks : [];
  const props = Array.isArray(ctx.properties) ? ctx.properties : [];
  const counts = ctx.counts || {
    headerDiffs: 0,
    cookieDiffs: 0,
    visualDiffs: 0,
    totalChecks: checks.length || 8,
  };
  const sched = ctx.schedulePolicy || {
    enabled: true,
    intervalMinutes: 15,
    cronExpression: '*/15 * * * *',
    strategy: 'round-robin' as PopDistributionStrategy,
    assignedPops: ['iad-us-east'],
    slaTargetPct: 99.9,
    slaWarningMs: 1200,
    slaCriticalMs: 3000,
  };

  const { isGreeting, isHelp } = isGreetingOrHelpIntent(lower);
  const isDiagnostic = isDiagnosticQuestionIntent(lower);

  const targetProp = extractPropertyIdFromText(rawPrompt, props) || ctx.activeAppId || 'www';
  if (
    targetProp &&
    targetProp !== ctx.activeAppId &&
    /\b(on|for|switch|inspect|select|open|run|schedule|property|check|test|why|status)\b/.test(lower)
  ) {
    actions.push({ type: 'select_property', appId: targetProp });
    notes.push(`Switched active property to **${targetProp}**.`);
  }

  // 1. Schedule interval / policy updates
  const intervalMatch = lower.match(/\b(1|5|10|15|30|60)\s*(?:min|minute|minutes|m)\b/);
  const hasScheduleIntent =
    lower.includes('schedule') ||
    lower.includes('cron') ||
    lower.includes('sla') ||
    lower.includes('scatter') ||
    lower.includes('breakdown') ||
    lower.includes('timeseries');

  if (
    hasScheduleIntent &&
    (intervalMatch ||
      lower.includes('pause') ||
      lower.includes('disable') ||
      lower.includes('enable') ||
      lower.includes('resume') ||
      lower.includes('round-robin') ||
      lower.includes('all-pops') ||
      lower.includes('all pop') ||
      lower.includes('primary-regional'))
  ) {
    const intervalVal = intervalMatch
      ? (Number(intervalMatch[1]) as ScheduleIntervalMinutes)
      : undefined;
    const strategy: PopDistributionStrategy | undefined =
      lower.includes('all-pops') || lower.includes('all pop')
        ? 'all-pops'
        : lower.includes('primary')
        ? 'primary-regional'
        : lower.includes('round-robin')
        ? 'round-robin'
        : undefined;
    const enabled =
      lower.includes('pause') || lower.includes('disable')
        ? false
        : lower.includes('enable') || lower.includes('resume')
        ? true
        : undefined;
    actions.push({
      type: 'update_schedule_policy',
      appId: targetProp,
      ...(intervalVal ? { intervalMinutes: intervalVal } : {}),
      ...(strategy ? { strategy } : {}),
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
    });
    notes.push(
      `Updated schedule policy for **${targetProp}**${
        intervalVal ? ` (${intervalVal}m cadence)` : ''
      }${strategy ? ` (${strategy})` : ''}${
        typeof enabled === 'boolean' ? ` (${enabled ? 'enabled' : 'paused'})` : ''
      }.`
    );
  }

  // 2. Trigger scheduled run
  if (
    hasScheduleIntent &&
    /\b(run|trigger|execute|start|fire|now|tick)\b/.test(lower)
  ) {
    actions.push({
      type: 'trigger_scheduled_run',
      appId: targetProp,
      switchToSchedulesView: true,
    });
    notes.push(`Triggered a live scheduled run tick for **${targetProp}**.`);
  }

  // 3. Schedule graph mode / timeframe
  if (
    hasScheduleIntent ||
    lower.includes('scatter') ||
    lower.includes('sla matrix') ||
    lower.includes('breakdown') ||
    lower.includes('phase breakdown') ||
    lower.includes('cwv') ||
    lower.includes('web vitals')
  ) {
    const graphMode: ScheduleGraphMode | undefined = lower.includes('scatter')
      ? 'scatterplot'
      : lower.includes('breakdown') || lower.includes('phase')
      ? 'breakdown'
      : lower.includes('cwv') || lower.includes('web vitals') || lower.includes('lcp')
      ? 'cwv-cache'
      : lower.includes('sla') || lower.includes('heatmap')
      ? 'sla-availability'
      : lower.includes('trend') || lower.includes('timeseries')
      ? 'timeseries'
      : undefined;
    const timeRange: ScheduleTimeRange | undefined = /\b1h\b/.test(lower)
      ? '1h'
      : /\b6h\b/.test(lower)
      ? '6h'
      : /\b30d\b/.test(lower)
      ? '30d'
      : /\b7d\b/.test(lower)
      ? '7d'
      : /\b24h\b/.test(lower)
      ? '24h'
      : undefined;

    if (graphMode || timeRange || lower.includes('graph') || lower.includes('chart') || lower.includes('open schedule') || lower.includes('show schedule')) {
      actions.push({
        type: 'inspect_schedule_graph',
        ...(graphMode ? { graphMode } : {}),
        ...(timeRange ? { timeRange } : {}),
      });
      notes.push(
        `Opened **Schedules** telemetry${graphMode ? ` in **${graphMode}** view` : ''}${
          timeRange ? ` (${timeRange})` : ''
        }.`
      );
    }
  }

  // 4. Create new Property / Environment / Playwright or Catchpoint Test / Delete Test
  if (
    /\b(create|add|new)\b/.test(lower) &&
    lower.includes('property')
  ) {
    const propMatch = rawPrompt.match(/property\s+([a-zA-Z0-9_-]+)/i);
    const newId = (propMatch ? propMatch[1] : 'checkout').toLowerCase();
    const hostMatch = rawPrompt.match(/([a-z0-9.-]+\.[a-z]{2,})/i);
    const canonicalHost = hostMatch ? hostMatch[1].toLowerCase() : `${newId}.salesforce.com`;
    actions.push({
      type: 'create_property',
      id: newId,
      name: `Salesforce ${newId.toUpperCase()} Property`,
      canonicalHost,
    });
    notes.push(`Created property **${newId}** (\`${canonicalHost}\`).`);
  } else if (
    /\b(create|add|new|upsert)\b/.test(lower) &&
    /\b(env|environment|uat|preprod|qa|canary)\b/.test(lower)
  ) {
    const envMatch = lower.match(/\b(uat|preprod|qa|canary|stage|dev|sandbox)\b/);
    const envId = envMatch ? envMatch[1] : 'uat';
    actions.push({
      type: 'upsert_environment',
      appId: targetProp,
      envId,
      envName: envId.toUpperCase(),
      networks: ['staging', 'prod'],
    });
    notes.push(`Added environment **${envId.toUpperCase()}** on property **${targetProp}**.`);
  } else if (
    /\b(create|add|new)\b/.test(lower) &&
    /\b(test|check|monitor|playwright|script|api|dns|ssl)\b/.test(lower)
  ) {
    const explicitPathMatch = rawPrompt.match(/(\/[a-zA-Z0-9_./-]*)/);
    const testId = extractTestIdFromText(rawPrompt);
    const isPlaywright = lower.includes('playwright') || lower.includes('transaction');
    const isApi = /\bapi\b/.test(lower);
    const isDns = /\bdns\b/.test(lower);
    const isSsl = /\bssl\b/.test(lower);
    const testType: CatchpointTestType = isPlaywright
      ? 'transaction-playwright'
      : isApi
      ? 'api'
      : isDns
      ? 'dns-direct'
      : isSsl
      ? 'ssl'
      : 'web-chrome';
    const path = explicitPathMatch ? explicitPathMatch[1] : isApi ? '/api/health' : '/sales/';
    const name = isPlaywright
      ? `Playwright E2E Flow (${path})`
      : isApi
      ? `API Health Probe (${path})`
      : `Synthetic Monitor (${path})`;
    actions.push({
      type: 'create_or_update_test',
      appId: targetProp,
      testId,
      name,
      path,
      testType,
      httpMethod: isApi && lower.includes('post') ? 'POST' : 'GET',
      expectedStatus: '200',
      scriptEngine: isPlaywright ? 'playwright' : undefined,
      customScript: isPlaywright
        ? `// Playwright check for ${path}\nawait page.goto(url, { waitUntil: 'domcontentloaded' });\nawait expect(page).toHaveURL(/.*/);\n`
        : undefined,
    });
    notes.push(`Created **${testType}** check **${name}** on **${targetProp}**.`);
  } else if (
    /\b(delete|remove)\b/.test(lower) &&
    extractTestIdFromText(rawPrompt)
  ) {
    const delId = extractTestIdFromText(rawPrompt)!;
    actions.push({
      type: 'delete_test',
      appId: targetProp,
      testId: delId,
    });
    notes.push(`Deleted check **${delId}** from **${targetProp}**.`);
  }

  // 5. Run Live Gate / Re-run All Diffs
  if (
    /\b(run|execute|start|trigger|re-?run)\b/.test(lower) &&
    (lower.includes('live gate') ||
      lower.includes('full gate') ||
      lower.includes('all checks') ||
      lower === 'run gate' ||
      lower === 'run tests' ||
      lower === 'run test')
  ) {
    actions.push({ type: 'run_live_gate', appId: targetProp });
    notes.push(`Started **Run Live Gate** across all checks on **${targetProp}**.`);
  } else if (
    /\b(re-?run|retry|reprobe|re-probe)\b/.test(lower) &&
    /\b(all|diffs?|failed|failures|blockers)\b/.test(lower)
  ) {
    actions.push({ type: 'rerun_check', testId: 'ALL_DIFFS' });
    notes.push(`Re-running all drifting/failed checks on **${targetProp}**.`);
  }

  // 6. Re-run specific check / AI Visual Judge / Focus check or tab
  const mentionedTestId = extractTestIdFromText(rawPrompt);
  if (
    (mentionedTestId || lower.includes('visual judge') || lower.includes('ai judge')) &&
    (lower.includes('ai') || lower.includes('visual judge') || lower.includes('judge')) &&
    !lower.includes('accept')
  ) {
    const tid = mentionedTestId || ctx.selectedTestId || 'T01';
    actions.push({ type: 'select_check', testId: tid, tab: 'image' });
    actions.push({ type: 'run_ai_visual_judge', testId: tid });
    notes.push(`Ran **AI Visual Judge** on **${tid}** and opened the **Visual AI** tab.`);
  } else if (
    mentionedTestId &&
    /\b(re-?run|probe|retry)\b/.test(lower)
  ) {
    actions.push({ type: 'select_check', testId: mentionedTestId });
    actions.push({ type: 'rerun_check', testId: mentionedTestId });
    notes.push(`Re-ran live HTTP + DOM probe for **${mentionedTestId}**.`);
  } else if (
    mentionedTestId &&
    !actions.some((a) => a.type === 'create_or_update_test' || a.type === 'delete_test')
  ) {
    const tab: InspectorDimensionTab | undefined = lower.includes('cookie')
      ? 'cookies'
      : lower.includes('visual') || lower.includes('image') || lower.includes('screenshot')
      ? 'image'
      : lower.includes('flow') || lower.includes('waterfall') || lower.includes('script')
      ? 'flow'
      : lower.includes('header') || lower.includes('cache')
      ? 'headers'
      : undefined;
    actions.push({ type: 'select_check', testId: mentionedTestId, tab });
    notes.push(
      `Selected check **${mentionedTestId}**${tab ? ` (**${tab}** tab)` : ''}.`
    );
  } else if (
    !mentionedTestId &&
    /\b(show|open|switch to|inspect|view)\b/.test(lower) &&
    /\b(headers?|cookies?|visual|screenshots?|http flow|waterfall)\b/.test(lower)
  ) {
    const tab: InspectorDimensionTab = lower.includes('cookie')
      ? 'cookies'
      : lower.includes('visual') || lower.includes('screenshot')
      ? 'image'
      : lower.includes('flow') || lower.includes('waterfall')
      ? 'flow'
      : 'headers';
    const tid = ctx.selectedTestId || 'T01';
    actions.push({ type: 'select_check', testId: tid, tab });
    notes.push(`Switched **${tid}** inspector to the **${tab}** tab.`);
  }

  // 7. Accept / Undo Policies (Single or Bulk)
  if (lower.includes('reset polic')) {
    actions.push({ type: 'reset_policies' });
    notes.push('Reset all accepted header, cookie, and visual policies to factory defaults.');
  } else if (
    /\b(accept|allowlist|ignore|approve|clear|fix)\b/.test(lower) &&
    /\b(all|everything|blockers|diffs|no-?go)\b/.test(lower)
  ) {
    actions.push({ type: 'toggle_accept_header', field: 'x-check-cacheable' });
    actions.push({ type: 'toggle_accept_header', field: 'cache-control' });
    actions.push({ type: 'toggle_accept_cookie', cookieName: 'sfdc-edge-sess' });
    actions.push({ type: 'toggle_accept_cookie', cookieName: 'ak_bmsc' });
    const visualDriftChecks = checks.filter(
      (c) => c.visualVerdict === 'different' || c.visualVerdict === 'minor'
    );
    for (const vc of visualDriftChecks) {
      actions.push({ type: 'toggle_accept_visual', testId: vc.testId });
    }
    notes.push(
      `Accepted active header (\`x-check-cacheable\`, \`cache-control\`), cookie, and visual diffs (${
        visualDriftChecks.map((c) => c.testId).join(', ') || 'all'
      }) to clear release blockers.`
    );
  } else if (/\b(accept|allowlist|ignore|approve)\b/.test(lower)) {
    const cookieMatch = rawPrompt.match(/cookie\s+([a-zA-Z0-9_-]+)/i);
    if (cookieMatch) {
      actions.push({ type: 'toggle_accept_cookie', cookieName: cookieMatch[1] });
      notes.push(`Toggled cookie allowlist for **${cookieMatch[1]}**.`);
    }
    const headerMatch = rawPrompt.match(/header\s+([a-zA-Z0-9_-]+)/i);
    const directHeader = KNOWN_HTTP_HEADER_FIELDS.find((h) => lower.includes(h));
    const headerField = headerMatch ? headerMatch[1].toLowerCase() : directHeader;
    if (headerField) {
      actions.push({ type: 'toggle_accept_header', field: headerField });
      notes.push(`Toggled accepted policy for header **${headerField}**.`);
    }
    if (lower.includes('visual')) {
      const vTid = mentionedTestId || ctx.selectedTestId || 'T01';
      actions.push({ type: 'toggle_accept_visual', testId: vTid });
      notes.push(`Toggled visual baseline acceptance for **${vTid}**.`);
    }
  }

  // 8. Navigation views (only when explicit navigation or view keyword is used, not when asking "why did staging environment fail?")
  if (!hasScheduleIntent && !isDiagnostic) {
    if (lower.includes('fleet') || lower.includes('synthetics') || lower.includes('canary')) {
      actions.push({ type: 'switch_view', viewMode: 'synthetics' });
      notes.push('Opened unified **Synthetics** Control Plane & Fleet Matrix.');
    } else if (lower.includes('vscode') || lower.includes('vs code') || /\bide\b/.test(lower) || lower.includes('terminal')) {
      actions.push({ type: 'switch_view', viewMode: 'vscode' });
      notes.push('Opened **VS Code** Workspace Editor & Full Kernel TTY.');
    } else if (lower.includes('mcp') || lower.includes('studio')) {
      actions.push({ type: 'switch_view', viewMode: 'studio' });
      notes.push('Opened **Studio** (MCP Server Console).');
    } else if (lower.includes('policies') || lower.includes('policy')) {
      actions.push({ type: 'switch_view', viewMode: 'config' });
      notes.push('Opened **Config** Gate Policies & Waivers view.');
    } else if (lower.includes('setup') || /\bmanage\s+(?:envs?|environments?|suite|properties)\b/.test(lower)) {
      actions.push({
        type: 'switch_view',
        viewMode: 'config',
        setupTab: lower.includes('env') ? 'envs' : 'suite',
      });
      notes.push('Opened **Config** Properties & AWS Tests view.');
    } else if (lower.includes('workbench') || lower.includes('compare')) {
      actions.push({ type: 'switch_view', viewMode: 'workbench' });
      notes.push('Switched to **Compare** Workbench view.');
    }
  } else if (!hasScheduleIntent && isDiagnostic) {
    // Allow explicit "open fleet" or "open vscode" even if combined with a question
    if (/\b(open|show|go to)\s+(?:fleet|synthetics)\b/.test(lower)) {
      actions.push({ type: 'switch_view', viewMode: 'synthetics' });
      notes.push('Opened unified **Synthetics** Control Plane.');
    } else if (/\b(open|show|go to)\s+(?:vs\s*code|vscode|ide|terminal)\b/.test(lower)) {
      actions.push({ type: 'switch_view', viewMode: 'vscode' });
      notes.push('Opened **VS Code** workspace.');
    } else if (/\b(open|show|go to)\s+(?:studio|mcp)\b/.test(lower)) {
      actions.push({ type: 'switch_view', viewMode: 'studio' });
      notes.push('Opened **Studio** workspace.');
    }
  }

  // 9. Copy Markdown report
  if (
    /\b(copy|export|download)\b/.test(lower) ||
    lower.includes('markdown') ||
    /\breport\b/.test(lower)
  ) {
    if (/\b(copy|export|markdown|report)\b/.test(lower) && !lower.startsWith('why')) {
      actions.push({ type: 'copy_gate_report' });
      notes.push('Copied Markdown Release Gate summary to clipboard.');
    }
  }

  // 10. Build rich, context-aware conversational response
  const diffChecks = checks.filter(
    (c) =>
      c.verdict !== 'same' ||
      c.candStatus >= 400 ||
      c.headerDiffsCount > 0 ||
      c.cookieDiffsCount > 0 ||
      (c.visualVerdict && c.visualVerdict !== 'same')
  );

  const topDiffLines = diffChecks.slice(0, 6).map((c) => {
    const tags: string[] = [];
    if (c.headerDiffsCount > 0) tags.push(`${c.headerDiffsCount} header`);
    if (c.cookieDiffsCount > 0) tags.push(`${c.cookieDiffsCount} cookie`);
    if (c.visualVerdict && c.visualVerdict !== 'same') tags.push(`visual ${c.visualVerdict}`);
    return `- **${c.testId}** (${c.testName}): HTTP ${c.candStatus} · \`${c.verdict.toUpperCase()}\`${
      tags.length > 0 ? ` — ${tags.join(', ')}` : ''
    }`;
  });

  // Case A: Greeting or Help ("hi", "hello", "hellp", "help", "what can you do")
  if (isGreeting || isHelp) {
    const greetingHeader = isGreeting && !isHelp
      ? `Hello! I'm your **Portal AI Release Gate Operator** for **${ctx.activeAppId || 'www'}** (\`${ctx.candidateTarget}\` ↔ \`${ctx.baselineTarget}\`).`
      : `Here is what I can do as your **Portal AI Release Gate Operator** (${activeSkills.length} skills active):`;

    const statusLine = `**Live Gate Status:** \`${ctx.headlineVerdict}\` — **${counts.headerDiffs}** header diff(s), **${counts.cookieDiffs}** cookie diff(s), and **${counts.visualDiffs}** visual diff(s) across **${counts.totalChecks}** synthetic checks.`;

    const helpSections = [
      greetingHeader,
      statusLine,
      ...(topDiffLines.length > 0
        ? [`\n**Active Drift / Blockers on \`${ctx.activeAppId}\`:**\n${topDiffLines.join('\n')}`]
        : [`\nAll checks on \`${ctx.activeAppId}\` are currently clean (\`GO\`).`]),
      `\n**Commands you can run right now:**`,
      `- **Diagnose & Explain:** *"Why is ${ctx.activeAppId} NO-GO?"*, *"Explain T01"*, *"What headers drifted?"*`,
      `- **Run & Probe:** *"Run Live Gate"*, *"Re-run T01"*, *"Re-run all diffs"*, *"Run AI Visual Judge on T01"*`,
      `- **Schedules & Graphs:** *"Trigger a scheduled run"*, *"Show scatterplot for 6h"*, *"Open SLA Matrix"*, *"Set schedule to 5m all-pops"*`,
      `- **Accept & Fix Blockers:** *"Accept header x-check-cacheable"*, *"Accept cookie ak_bmsc"*, *"Accept visual T01"*, *"Accept all diffs"*`,
      `- **Author & Navigate:** *"Add Playwright test /checkout"*, *"Switch to login"*, *"Open Fleet Matrix"*, *"Open VS Code"*`,
    ];

    return {
      reply: helpSections.join('\n'),
      matchedSkills: activeSkills.map((s) => s.id),
      actions,
    };
  }

  // Case B: Specific Check Diagnostic ("explain T01", "what is wrong with T02", or selecting a check)
  if (mentionedTestId) {
    const matchedCheck = checks.find((c) => c.testId.toUpperCase() === mentionedTestId);
    if (matchedCheck && (isDiagnostic || notes.length <= 1)) {
      const detail = buildCheckDiagnosticDetail(matchedCheck, ctx);
      const replyParts = [...notes, detail];
      return {
        reply: replyParts.join('\n\n'),
        matchedSkills: activeSkills.map((s) => s.id),
        actions,
      };
    }
  }

  // Case C: Property-wide Diagnostic / Why NO-GO / Diffs / Status Question
  if (isDiagnostic) {
    const verdictReason =
      ctx.headlineVerdict === 'NO-GO'
        ? `**Why \`${ctx.activeAppId}\` is \`NO-GO\`:** Staging (\`${ctx.candidateTarget}\`) has unaccepted contract or visual drift compared to Production (\`${ctx.baselineTarget}\`) — specifically **${counts.headerDiffs}** header diff(s), **${counts.cookieDiffs}** cookie diff(s), and **${counts.visualDiffs}** visual diff(s).`
        : ctx.headlineVerdict === 'REVIEW'
        ? `**Why \`${ctx.activeAppId}\` is in \`REVIEW\`:** Minor drift or non-blocking telemetry variance was detected across **${diffChecks.length}** check(s).`
        : `**\`${ctx.activeAppId}\` is \`GO\`:** All HTTP status codes, headers, cookies, and visual checks meet release gate thresholds.`;

    const diagLines = [
      ...(notes.length > 0 ? [notes.join(' ')] : []),
      verdictReason,
      topDiffLines.length > 0
        ? `\n**Checks Requiring Attention (${diffChecks.length}/${counts.totalChecks}):**\n${topDiffLines.join('\n')}`
        : `\n**Checks:** All ${counts.totalChecks} checks match baseline expectations.`,
      `\n**Schedule & SLA:** ${sched.enabled ? 'Active' : 'Paused'} (\`${sched.cronExpression}\` · ${sched.strategy}) · SLA target **${sched.slaTargetPct}%** across PoPs \`${(sched.assignedPops || []).join(', ')}\`.`,
      ctx.headlineVerdict !== 'GO'
        ? `\n**How to resolve:** Ask me to *"Accept all diffs"* to approve known staging drift, *"Accept header x-check-cacheable"*, or *"Re-run all diffs"* to re-probe live edges.`
        : `\n**Next steps:** Ask me to *"Trigger a scheduled run"*, *"Run Live Gate"*, or *"Open Fleet Matrix"*.`,
    ];

    return {
      reply: diagLines.join('\n'),
      matchedSkills: activeSkills.map((s) => s.id),
      actions,
    };
  }

  // Case D: Action(s) executed — return clear confirmation + live context summary
  if (notes.length > 0) {
    const contextFooter = `\n\n**Current Gate Context:** \`${targetProp}\` · Verdict \`${ctx.headlineVerdict}\` (${counts.headerDiffs}H / ${counts.cookieDiffs}C / ${counts.visualDiffs}V across ${counts.totalChecks} checks).`;
    return {
      reply: `${notes.join('\n')}${contextFooter}`,
      matchedSkills: activeSkills.map((s) => s.id),
      actions,
    };
  }

  // Case E: Unrecognized free-form input — provide helpful status + actionable suggestions
  const fallbackLines = [
    `I inspected **${ctx.activeAppId}** (\`${ctx.candidateTarget}\` ↔ \`${ctx.baselineTarget}\`) for *"${rawPrompt}"*:`,
    `- **Headline Verdict:** \`${ctx.headlineVerdict}\` (**${counts.headerDiffs}** header · **${counts.cookieDiffs}** cookie · **${counts.visualDiffs}** visual diffs across **${counts.totalChecks}** checks)`,
    `- **Schedule:** ${sched.enabled ? 'Active' : 'Paused'} · \`${sched.cronExpression}\` · SLA target **${sched.slaTargetPct}%**`,
    topDiffLines.length > 0
      ? `\n**Active Diffs on \`${ctx.activeAppId}\`:**\n${topDiffLines.join('\n')}`
      : `\nAll checks on \`${ctx.activeAppId}\` are passing.`,
    `\n**Try asking me:** *"Why is ${ctx.activeAppId} NO-GO?"*, *"Explain T01"*, *"Run Live Gate"*, *"Trigger a scheduled run"*, *"Accept all diffs"*, or *"Add Playwright test /checkout"*.`,
  ];

  return {
    reply: fallbackLines.join('\n'),
    matchedSkills: activeSkills.map((s) => s.id),
    actions: [],
  };
}
