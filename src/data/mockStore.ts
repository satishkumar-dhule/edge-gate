/**
 * ============================================================================
 * CONFIG-DRIVEN SYNTHETICS ADAPTER & SEED GENERATOR
 * ============================================================================
 * Automatically generates initial runs, target states, and 3-dimension
 * comparisons from `src/config/template.config.ts` (or any custom TemplateConfig).
 * To connect a real backend, replace `generateTestResults` with an API call
 * to your AWS CloudWatch Synthetics / S3 / MCP endpoint.
 * ============================================================================
 */

import {
  AcceptedRule,
  AppConfig,
  ComparisonItem,
  ComparisonKind,
  ComparisonRecord,
  DifferenceItem,
  RunRecord,
  TargetState,
  TestResult,
} from '../engine/types';
import {
  applyRulesToItem,
  calculateFunctionalDiffs,
  calculateHeadlineVerdict,
  calculateItemVerdict,
} from '../engine/rules';
import {
  DEFAULT_TEMPLATE_CONFIG,
  TemplateConfig,
  TestCaseDefinition,
  resolvePropertyHostname,
} from '../config/template.config';

export const INITIAL_APPS: AppConfig[] = DEFAULT_TEMPLATE_CONFIG.properties;
export const SAMPLE_TEST_DEFINITIONS: TestCaseDefinition[] =
  DEFAULT_TEMPLATE_CONFIG.testSuite;
export const INITIAL_RULES: AcceptedRule[] = [];

/**
 * Generates synthetic test results for any target `<appId>.<envId>.<network>`
 * using the configured testSuite definitions and network metadata.
 */
export function generateTestResults(
  target: string,
  variant:
    | 'normal_prod'
    | 'normal_staging'
    | 'prev_prod'
    | 'prev_staging'
    | 'new_run'
    | 'uat_prod'
    | 'uat_staging'
    | 'clean_match' = 'normal_prod',
  suiteDefs: TestCaseDefinition[] = DEFAULT_TEMPLATE_CONFIG.testSuite,
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): TestResult[] {
  const [appId = 'www', envId = 'prod', net = 'prod'] = target.split('.');
  const isStaging = net === 'staging';
  const netCfg = isStaging ? config.networks.staging : config.networks.prod;
  const edgeIp = netCfg.defaultEdgeIp;
  const baseDomain = resolvePropertyHostname(
    appId,
    envId,
    config.branding.defaultDomain
  );
  const edgeHost = `${baseDomain}${netCfg.edgeSuffix}`;

  const activeDefs = suiteDefs.filter((def) => def.enabled !== false);
  return activeDefs.map((def, idx) => {
    const status = def.expectedStatus === '301' ? 301 : 200;
    const pass = true;
    const errors: string[] = [];

    const capturedHeaders: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-cache': isStaging
        ? `TCP_MISS from a${edgeIp.replace(/\./g, '-')}.deploy.akamaitechnologies.com`
        : `TCP_HIT from a${edgeIp.replace(/\./g, '-')}.deploy.akamaitechnologies.com`,
      'x-check-cacheable': 'YES',
      'x-akamai-request-id': `ak-${envId}-${isStaging ? 'stg' : 'prd'}-0${idx + 1}`,
      'x-sfdc-content-source': 'origin-edge-v4',
    };

    const capturedCookies: Record<string, string> = {
      ak_bmsc: 'valid-bot-manager-token; Path=/; Secure; HttpOnly',
      edge_region: 'us-east; Path=/; SameSite=Lax; Secure',
      session_tier: `${envId}-standard; Path=/; Secure; HttpOnly`,
    };

    if (status === 301) {
      capturedHeaders['location'] = `https://${baseDomain}/worldwide`;
    }

    // Seed realistic 3-dimension differences on staging vs prod
    if (
      variant === 'normal_staging' ||
      variant === 'prev_staging' ||
      (isStaging && variant !== 'clean_match' && variant !== 'new_run')
    ) {
      if (idx === 0) {
        capturedHeaders['x-check-cacheable'] = 'NO';
        capturedHeaders['cache-control'] = 'no-store, max-age=0';
      }
      if (idx === 1) {
        capturedCookies['edge_cache_bypass'] =
          'staging-debug=1; Path=/; SameSite=None';
        capturedCookies['edge_region'] = 'us-west-staging; Path=/; SameSite=Lax';
      }
      if (idx === 2) {
        capturedHeaders['cache-control'] = 'public, max-age=1800';
      }
    }

    // Previous-run baseline variations so Latest vs Previous Run comparisons show realistic delta
    if (variant === 'prev_staging' || variant === 'prev_prod') {
      if (idx === 4) {
        capturedHeaders['x-sfdc-content-source'] = 'origin-edge-v3';
      }
      if (idx === 6) {
        capturedCookies['session_tier'] = `${envId}-legacy; Path=/; Secure; HttpOnly`;
      }
    }

    // Freshly triggered run variations so New Run vs Previous Run shows immediate evolution
    if (variant === 'new_run') {
      if (isStaging && idx === 1) {
        capturedCookies['edge_cache_bypass'] =
          'staging-debug=1; Path=/; SameSite=None';
      }
      if (idx === 5) {
        capturedHeaders['x-sfdc-content-source'] = 'origin-edge-v5-canary';
      }
    }

    return {
      id: def.id,
      name: def.name,
      url: `https://${baseDomain}${def.path}`,
      canonicalUrl: `https://${baseDomain}${def.path}`,
      pass,
      errors,
      expectedStatus: def.expectedStatus,
      actualStatus: status,
      durationMs: isStaging
        ? 82 + ((idx * 19) % 64)
        : 58 + ((idx * 15) % 48),
      capturedHeaders,
      capturedCookies,
      redirectChain:
        status === 301
          ? [
              {
                method: 'GET',
                url: `https://${baseDomain}${def.path}`,
                status: 301,
                startOffsetMs: 0,
                durationMs: 42,
                edgeIp,
                location: capturedHeaders['location'],
              },
            ]
          : [],
      stagingEdgeIp: isStaging ? edgeIp : undefined,
      edgeHostname: edgeHost,
      fallbackDns: false,
      screenshotKey: `screenshots/${target}/latest/${def.id}.jpg`,
      loadingFlag: 'ready',
    };
  });
}

/**
 * Programmatically seeds initial runs (Latest + Previous Run) for every
 * Property + Environment + Network defined in `TemplateConfig`.
 */
export function seedRunsFromConfig(
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): RunRecord[] {
  const seeded: RunRecord[] = [];

  for (const app of config.properties) {
    for (const env of app.envs) {
      const networks = env.networks || app.defaultNetworks || ['staging', 'prod'];
      for (const network of ['staging', 'prod'] as const) {
        if (!networks.includes(network)) continue;
        const target = `${app.id}.${env.id}.${network}`;
        const isStaging = network === 'staging';
        const latestVariant =
          app.id === 'help'
            ? 'clean_match'
            : isStaging
            ? 'normal_staging'
            : 'normal_prod';
        const prevVariant =
          app.id === 'help'
            ? 'clean_match'
            : isStaging
            ? 'prev_staging'
            : 'prev_prod';

        const latestResults = generateTestResults(
          target,
          latestVariant,
          config.testSuite,
          config
        );
        const prevResults = generateTestResults(
          target,
          prevVariant,
          config.testSuite,
          config
        );

        const latestLabel =
          env.id === 'prod'
            ? isStaging
              ? 'v2026.11-rc1'
              : 'live-baseline'
            : isStaging
            ? `${env.id}-edge-test`
            : `${env.id}-baseline`;

        const prevLabel =
          env.id === 'prod'
            ? isStaging
              ? 'v2026.10-prev'
              : 'prev-baseline'
            : isStaging
            ? `${env.id}-edge-prev`
            : `${env.id}-prev`;

        // 1. Latest Run
        seeded.push({
          key: `run-${app.id}-${env.id}-${network}-1`,
          target,
          appId: app.id,
          envId: env.id,
          network,
          suiteKey: app.suitePath || `config/suites/${app.id}.csv`,
          suiteSha256: '9f83a21b33c0',
          suiteRowCount: latestResults.length,
          startTime: '2026-11-07T08:30:00Z',
          finishTime: '2026-11-07T08:30:48Z',
          totalTests: latestResults.length,
          passedTests: latestResults.filter((r) => r.pass).length,
          failedTests: latestResults.filter((r) => !r.pass).length,
          by: config.branding.defaultOperator.email,
          label: latestLabel,
          results: latestResults,
        });

        // 2. Previous Run (enables out-of-the-box Run-over-Run comparison)
        seeded.push({
          key: `run-${app.id}-${env.id}-${network}-0`,
          target,
          appId: app.id,
          envId: env.id,
          network,
          suiteKey: app.suitePath || `config/suites/${app.id}.csv`,
          suiteSha256: '8e72b10a22b9',
          suiteRowCount: prevResults.length,
          startTime: '2026-11-07T07:15:00Z',
          finishTime: '2026-11-07T07:15:46Z',
          totalTests: prevResults.length,
          passedTests: prevResults.filter((r) => r.pass).length,
          failedTests: prevResults.filter((r) => !r.pass).length,
          by: config.branding.defaultOperator.email,
          label: prevLabel,
          results: prevResults,
        });
      }
    }
  }

  return seeded;
}

export const INITIAL_RUNS: RunRecord[] = seedRunsFromConfig(
  DEFAULT_TEMPLATE_CONFIG
);

export const INITIAL_TARGET_STATES: Record<
  string,
  {
    state: TargetState;
    activeActivity?: string;
    progress?: { done: number; total: number } | string;
  }
> = Object.fromEntries(
  INITIAL_RUNS.map((r) => [r.target, { state: 'ready' as TargetState }])
);

export function calculateCookieDiffs(
  candidate?: TestResult,
  baseline?: TestResult
): DifferenceItem[] {
  if (!candidate || !baseline) return [];
  const candCookies = candidate.capturedCookies || {};
  const baseCookies = baseline.capturedCookies || {};
  const allNames = Array.from(
    new Set([...Object.keys(candCookies), ...Object.keys(baseCookies)])
  );

  const diffs: DifferenceItem[] = [];
  for (const name of allNames) {
    const cVal = candCookies[name] ?? '(not set)';
    const bVal = baseCookies[name] ?? '(not set)';
    if (cVal !== bVal) {
      diffs.push({
        kind: 'cookie',
        field: name,
        candidateValue: cVal,
        baselineValue: bVal,
        severity: 'minor',
      });
    }
  }
  return diffs;
}

export interface BuildComparisonOptions {
  acceptedCookies?: string[];
  acceptedVisualTests?: string[];
  ignoreAcceptedDiffs?: boolean;
  aiJudgeOverrides?: Record<
    string,
    {
      verdict: 'same' | 'minor' | 'different';
      summary: string;
      pixelDiffPercent?: number;
    }
  >;
}

export function buildInitialComparison(
  candidateRun: RunRecord,
  baselineRun: RunRecord,
  kind: ComparisonKind,
  rules: AcceptedRule[] = [],
  options: BuildComparisonOptions = {}
): ComparisonRecord {
  const candidateResultsMap = new Map(
    candidateRun.results.map((r) => [r.id, r])
  );
  const baselineResultsMap = new Map(baselineRun.results.map((r) => [r.id, r]));
  const allIds = Array.from(
    new Set([...candidateResultsMap.keys(), ...baselineResultsMap.keys()])
  );

  const isSameRun = candidateRun.key === baselineRun.key;

  const candidateProp = DEFAULT_TEMPLATE_CONFIG.properties.find(
    (p) => p.id === candidateRun.appId
  );
  const baselineProp = DEFAULT_TEMPLATE_CONFIG.properties.find(
    (p) => p.id === baselineRun.appId
  );
  const candidateHostMap =
    candidateProp?.envs.find((e) => e.id === candidateRun.envId)?.hostMap || {};
  const baselineHostMap =
    baselineProp?.envs.find((e) => e.id === baselineRun.envId)?.hostMap || {};

  const items: ComparisonItem[] = allIds.map((testId, index) => {
    const cand = candidateResultsMap.get(testId);
    const base = baselineResultsMap.get(testId);
    const name = cand?.name || base?.name || testId;
    const url = cand?.url || base?.url || '';

    const diffs = calculateFunctionalDiffs(cand, base, {
      candidateHostMap,
      baselineHostMap,
    });
    const cookieDiffs = calculateCookieDiffs(cand, base);

    let visualResult = undefined;
    if (cand?.screenshotKey && base?.screenshotKey) {
      if (
        !isSameRun &&
        (testId === 'T03' || index === 2) &&
        candidateRun.network !== baselineRun.network
      ) {
        visualResult = {
          verdict: 'minor' as const,
          costGate: 'ai-judged' as const,
          costGateSkippedAi: false,
          pixelDiffPercent: 1.8,
          summary:
            'AWS Bedrock Nova Lite (amazon.nova-lite-v1:0) detected a 14px hero callout spacing shift and updated badge contrast on Staging.',
          differences: [
            {
              description:
                'Hero callout container shifted down 14px; CTA button alignment intact',
              severity: 'minor' as const,
            },
          ],
          primaryModel: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
          tileRegionsHint: ['hero-center'],
        };
      } else {
        visualResult = {
          verdict: 'same' as const,
          costGate: 'pixel-identical' as const,
          costGateSkippedAi: true,
          pixelDiffPercent: 0.0,
          summary:
            'AWS Bedrock Nova Lite (amazon.nova-lite-v1:0): Screenshots are pixel-identical (0.0% pixel delta).',
          differences: [],
          primaryModel: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
        };
      }

      const override = options.aiJudgeOverrides?.[testId];
      if (override && visualResult) {
        visualResult = {
          ...visualResult,
          verdict: override.verdict,
          costGate: 'ai-judged' as const,
          costGateSkippedAi: false,
          pixelDiffPercent:
            override.pixelDiffPercent ?? visualResult.pixelDiffPercent,
          summary: override.summary,
        };
      }
    }

    const combinedDiffs = [...diffs, ...cookieDiffs];
    const rawVerdict = calculateItemVerdict(
      combinedDiffs,
      visualResult?.verdict ?? 'same',
      kind
    );

    const rawItem: ComparisonItem = {
      testId,
      testName: name,
      url,
      candidateResult: cand,
      baselineResult: base,
      functionalDiffs: diffs,
      cookieDiffs,
      visualResult,
      itemVerdict: rawVerdict,
      originalVerdict: rawVerdict,
      candidateFailed: cand ? !cand.pass : false,
      baselineFailed: base ? !base.pass : false,
    };

    const compId = `${candidateRun.target}-vs-${baselineRun.target}`;
    return applyRulesToItem(rawItem, compId, rules, kind, {
      acceptedCookies: options.acceptedCookies,
      acceptedVisualTests: options.acceptedVisualTests,
      ignoreAcceptedDiffs: options.ignoreAcceptedDiffs,
    });
  });

  const ignoreAccepted = options.ignoreAcceptedDiffs ?? true;
  const counts = {
    different: items.filter((i) => i.itemVerdict === 'different').length,
    error: items.filter((i) => i.itemVerdict === 'error').length,
    minor: items.filter((i) => i.itemVerdict === 'minor').length,
    same: items.filter((i) => i.itemVerdict === 'same').length,
  };

  const rollup = {
    functional: items.filter(
      (i) =>
        i.functionalDiffs.some((d) => (ignoreAccepted ? !d.accepted : true)) ||
        (i.cookieDiffs || []).some((d) => (ignoreAccepted ? !d.accepted : true))
    ).length,
    critical: items.filter((i) =>
      i.functionalDiffs.some(
        (d) =>
          (ignoreAccepted ? !d.accepted : true) &&
          (d.kind === 'status' || d.kind === 'assertions')
      )
    ).length,
    visual: items.filter(
      (i) =>
        i.visualResult?.verdict === 'different' ||
        i.visualResult?.verdict === 'minor'
    ).length,
    minor: counts.minor,
    error: counts.error,
    failingOnCandidate: items.filter((i) => i.candidateFailed).length,
  };

  const headlineVerdict = calculateHeadlineVerdict(items, kind, false, false);

  return {
    key: `comparisons/${candidateRun.key}__${baselineRun.key}.json`,
    comparisonId: `${candidateRun.target}-vs-${baselineRun.target}`,
    appId: candidateRun.appId,
    kind,
    candidateRunKey: candidateRun.key,
    baselineRunKey: baselineRun.key,
    candidateTarget: candidateRun.target,
    baselineTarget: baselineRun.target,
    candidateStartTime: candidateRun.startTime,
    baselineStartTime: baselineRun.startTime,
    candidateLabel: candidateRun.label,
    isPinnedBaseline: false,
    pairingTimeGapMinutes: 0,
    isPartial: false,
    version: 1,
    headlineVerdict,
    counts,
    rollup,
    suitesDiffer: false,
    candidateSuiteHash: candidateRun.suiteSha256,
    baselineSuiteHash: baselineRun.suiteSha256,
    modelUsed: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
    items: items.sort((a, b) => {
      const order = { different: 0, error: 1, minor: 2, same: 3 };
      return order[a.itemVerdict] - order[b.itemVerdict];
    }),
  };
}
