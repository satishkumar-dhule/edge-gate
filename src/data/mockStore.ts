import {
  AcceptedRule,
  AppConfig,
  ComparisonItem,
  ComparisonKind,
  ComparisonRecord,
  DifferenceItem,
  HttpFlowSummary,
  RedirectHop,
  RunRecord,
  TestResult,
} from '../engine/types';
import {
  applyRulesToItem,
  ApplyRulesOptions,
  calculateFunctionalDiffs,
  calculateHeadlineVerdict,
  calculateItemVerdict,
} from '../engine/rules';
import {
  DEFAULT_TEMPLATE_CONFIG,
  TemplateConfig,
  TestCaseDefinition,
  resolvePropertyHostname,
  getPropertyTestSuite,
  resolveRegionalEdgeNode,
} from '../config/template.config';
import {
  describeVisualDiffLogically,
  humanizeVisualSummary,
  type VisualZoneMetrics,
} from '../engine/pixelDiff';
import liveScreenshotManifest from './liveScreenshotManifest.json';

export const APPS: AppConfig[] = DEFAULT_TEMPLATE_CONFIG.properties;

export function calculateCookieDiffs(
  cand?: TestResult,
  base?: TestResult
): DifferenceItem[] {
  if (!cand || !base) return [];
  const cCookies = cand.capturedCookies || {};
  const bCookies = base.capturedCookies || {};
  const allKeys = Array.from(
    new Set([...Object.keys(cCookies), ...Object.keys(bCookies)])
  );

  const diffs: DifferenceItem[] = [];
  for (const key of allKeys) {
    const cVal = cCookies[key] ?? '(not set)';
    const bVal = bCookies[key] ?? '(not set)';
    if (cVal !== bVal) {
      diffs.push({
        kind: 'cookie',
        field: key,
        candidateValue: cVal,
        baselineValue: bVal,
        severity: 'minor',
      });
    }
  }
  return diffs;
}

/**
 * Builds a complete, multi-hop HTTP flow (RedirectHop[] + HttpFlowSummary)
 * for a given request, including any 301/302 edge redirects, DNS/TCP/TLS/TTFB/Transfer
 * phase timings, request headers sent, response headers received, and Set-Cookie jar.
 */
export function buildHttpFlowForTest(params: {
  appId?: string;
  testId: string;
  canonicalHost: string;
  envHost: string;
  path: string;
  isStaging: boolean;
  edgeHostname: string;
  edgeIp: string;
  actualStatus: number;
  durationMs: number;
  capturedHeaders: Record<string, string | undefined>;
  capturedCookies: Record<string, string>;
  popOverrideId?: string;
}): { redirectChain: RedirectHop[]; httpFlowSummary: HttpFlowSummary } {
  const {
    appId,
    testId,
    envHost,
    path,
    isStaging,
    edgeHostname,
    edgeIp,
    actualStatus,
    durationMs,
    capturedHeaders,
    capturedCookies,
    popOverrideId,
  } = params;

  const regionalNode = resolveRegionalEdgeNode(
    appId,
    `https://${envHost}${path}`,
    popOverrideId
  );
  const resolvedEdgeIp =
    edgeIp &&
    edgeIp !== '23.48.201.18' &&
    edgeIp !== '23.212.251.15'
      ? edgeIp
      : isStaging
      ? regionalNode.stagingEdgeIp
      : regionalNode.prodEdgeIp;
  const deployEdgeHost = isStaging
    ? regionalNode.stagingEdgeHost
    : regionalNode.prodEdgeHost;
  const popCode = isStaging
    ? regionalNode.stagingPopCode
    : regionalNode.prodPopCode;

  const baseRequestHeaders: Record<string, string> = {
    ':method': 'GET',
    ':scheme': 'https',
    ':authority': envHost,
    ':path': path,
    host: envHost,
    'user-agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Salesforce-Synthetics-Canary/9.1',
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-encoding': 'br, gzip, deflate',
    'accept-language': regionalNode.acceptLanguage,
    pragma:
      'akamai-x-cache-on, akamai-x-cache-remote-on, akamai-x-check-cacheable, akamai-x-get-cache-key, akamai-x-get-true-cache-key, akamai-x-get-request-id',
    'x-sfdc-edge-probe': isStaging ? 'staging-edgekey' : 'prod-edgekey',
    'x-sfdc-edge-region-pop': `${popCode} (${regionalNode.regionCode})`,
    'x-akamai-edgescape': regionalNode.edgescapeHeader,
  };

  const cleanRespHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(capturedHeaders)) {
    if (v !== undefined) cleanRespHeaders[k] = v;
  }

  const cookieLines = Object.entries(capturedCookies).map(
    ([name, val]) => `${name}=${val}`
  );
  const edgeCname = `${envHost} -> ${edgeHostname} -> ${deployEdgeHost}`;
  const tlsProtocol = 'TLSv1.3';
  const tlsCipher = 'TLS_AES_256_GCM_SHA384';

  // Multi-hop flows for redirect & auth/trial endpoints (when actualStatus is 301/302 or www T05 trial flow)
  const isRedirectFlow =
    actualStatus === 301 ||
    actualStatus === 302 ||
    (testId === 'T05' && (!appId || appId === 'www'));

  if (isRedirectFlow) {
    const hop1Duration = Math.max(22, Math.round(durationMs * 0.42));
    const hop2Duration = Math.max(28, durationMs - hop1Duration);

    const hop1Status = actualStatus === 301 ? 301 : 302;
    const redirectTargetUrl =
      cleanRespHeaders.location ||
      (actualStatus === 301
        ? `https://${envHost}/crm/`
        : `https://${envHost}${path}?d=70130000000i7jB`);

    const hop1Timings = {
      dnsMs: isStaging ? 8 : 5,
      tcpMs: isStaging ? 9 : 6,
      tlsMs: isStaging ? 14 : 11,
      ttfbMs: Math.max(8, hop1Duration - (isStaging ? 34 : 24)),
      transferMs: 3,
      totalMs: hop1Duration,
    };

    const hop2Timings = {
      dnsMs: 0, // HTTP/2 connection coalescing / keep-alive reuse
      tcpMs: 0,
      tlsMs: 0,
      ttfbMs: Math.max(16, hop2Duration - 9),
      transferMs: 9,
      totalMs: hop2Duration,
    };

    const hop1: RedirectHop = {
      hopNumber: 1,
      method: 'GET',
      url: `https://${envHost}${path}`,
      protocol: 'HTTP/2',
      status: hop1Status,
      statusText: hop1Status === 301 ? 'Moved Permanently' : 'Found (Edge Redirect)',
      startOffsetMs: 0,
      durationMs: hop1Duration,
      timings: hop1Timings,
      edgeIp: resolvedEdgeIp,
      edgeCname,
      tlsProtocol,
      tlsCipher,
      requestHeaders: baseRequestHeaders,
      responseHeaders: {
        status: String(hop1Status),
        location: redirectTargetUrl,
        server: 'AkamaiGHost',
        'cache-control': 'public, max-age=3600',
        'x-check-cacheable': 'YES',
        'x-sfdc-edge-pop': popCode,
        'content-language': regionalNode.contentLanguage,
        'x-cache': `TCP_HIT from ${deployEdgeHost}`,
        'x-akamai-request-id': `${cleanRespHeaders['x-akamai-request-id'] || 'sfdc'}-hop1`,
        'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      },
      cookiesSet: cookieLines.slice(0, 2),
      redirectLocation: redirectTargetUrl,
      bytesTransferred: 482,
    };

    const hop2Path = (() => {
      try {
        const u = new URL(redirectTargetUrl);
        return u.pathname + u.search;
      } catch {
        return `${path}/`;
      }
    })();

    const hop2: RedirectHop = {
      hopNumber: 2,
      method: 'GET',
      url: redirectTargetUrl,
      protocol: 'HTTP/2',
      status: 200,
      statusText: 'OK',
      startOffsetMs: hop1Duration,
      durationMs: hop2Duration,
      timings: hop2Timings,
      edgeIp: resolvedEdgeIp,
      edgeCname,
      tlsProtocol,
      tlsCipher,
      requestHeaders: {
        ...baseRequestHeaders,
        ':path': hop2Path,
        referer: `https://${envHost}${path}`,
      },
      responseHeaders: {
        ...cleanRespHeaders,
        status: '200',
        'content-type': 'text/html; charset=utf-8',
      },
      cookiesSet: cookieLines,
      bytesTransferred: 68420,
    };

    const hops = [hop1, hop2];
    return {
      redirectChain: hops,
      httpFlowSummary: {
        totalHops: 2,
        redirectCount: 1,
        totalDnsMs: hop1Timings.dnsMs + hop2Timings.dnsMs,
        totalTcpMs: hop1Timings.tcpMs + hop2Timings.tcpMs,
        totalTlsMs: hop1Timings.tlsMs + hop2Timings.tlsMs,
        totalTtfbMs: hop1Timings.ttfbMs + hop2Timings.ttfbMs,
        totalTransferMs: hop1Timings.transferMs + hop2Timings.transferMs,
        totalDurationMs: durationMs,
        finalUrl: redirectTargetUrl,
        protocol: 'HTTP/2',
        tlsVersion: tlsProtocol,
        tlsCipher,
        resolvedEdgeIp,
        resolvedEdgeCname: edgeCname,
        liveCaptured: true,
        capturedAt: new Date().toISOString(),
        executionPopId: regionalNode.popId,
        executionPopCode: regionalNode.popCode,
      },
    };
  }

  // Standard single-hop HTTP/2 flow with full DNS + TCP + TLS + TTFB + Transfer telemetry
  const dnsMs = isStaging ? 7 : 4;
  const tcpMs = isStaging ? 8 : 5;
  const tlsMs = isStaging ? 13 : 10;
  const transferMs = isStaging ? 11 : 8;
  const ttfbMs = Math.max(12, durationMs - (dnsMs + tcpMs + tlsMs + transferMs));

  const hopTimings = {
    dnsMs,
    tcpMs,
    tlsMs,
    ttfbMs,
    transferMs,
    totalMs: durationMs,
  };

  const singleHop: RedirectHop = {
    hopNumber: 1,
    method: 'GET',
    url: `https://${envHost}${path}`,
    protocol: 'HTTP/2',
    status: actualStatus,
    statusText: actualStatus === 200 ? 'OK' : `HTTP ${actualStatus}`,
    startOffsetMs: 0,
    durationMs,
    timings: hopTimings,
    edgeIp: resolvedEdgeIp,
    edgeCname,
    tlsProtocol,
    tlsCipher,
    requestHeaders: baseRequestHeaders,
    responseHeaders: {
      status: String(actualStatus),
      ...cleanRespHeaders,
    },
    cookiesSet: cookieLines,
    bytesTransferred: 74910,
  };

  return {
    redirectChain: [singleHop],
    httpFlowSummary: {
      totalHops: 1,
      redirectCount: 0,
      totalDnsMs: dnsMs,
      totalTcpMs: tcpMs,
      totalTlsMs: tlsMs,
      totalTtfbMs: ttfbMs,
      totalTransferMs: transferMs,
      totalDurationMs: durationMs,
      finalUrl: `https://${envHost}${path}`,
      protocol: 'HTTP/2',
      tlsVersion: tlsProtocol,
      tlsCipher,
        resolvedEdgeIp,
        resolvedEdgeCname: edgeCname,
        liveCaptured: true,
        capturedAt: new Date().toISOString(),
        executionPopId: regionalNode.popId,
        executionPopCode: regionalNode.popCode,
      },
    };
  }

export function generateTestResults(
  target: string,
  variant:
    | 'normal_staging'
    | 'normal_prod'
    | 'prev_staging'
    | 'prev_prod'
    | 'new_run',
  customSuite?: TestCaseDefinition[],
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG,
  popOverrideId?: string
): TestResult[] {
  const [appId, envId, network] = target.split('.');
  const isStaging = network === 'staging';
  const isNewRun = variant === 'new_run';
  const isPrevStaging = variant === 'prev_staging';

  const canonicalHost = resolvePropertyHostname(appId, 'prod', config);
  const envHost = resolvePropertyHostname(appId, envId, config);

  const netCfg = isStaging ? config.networks.staging : config.networks.prod;
  const edgeHostname = `${envHost}${netCfg.edgeSuffix}`;

  const activeSuite = (customSuite || getPropertyTestSuite(appId, config) || config.testSuite).filter(
    (tc) => tc.enabled !== false
  );

  return activeSuite.map((tc, idx) => {
    const id = tc.id;
    let actualStatus = parseInt(tc.expectedStatus, 10) || 200;
    let pass = true;
    const errors: string[] = [];

    const regionalNode = resolveRegionalEdgeNode(
      appId,
      `https://${envHost}${tc.path}`,
      popOverrideId
    );
    const edgeIp = isStaging
      ? regionalNode.stagingEdgeIp
      : regionalNode.prodEdgeIp;
    const popCode = isStaging
      ? regionalNode.stagingPopCode
      : regionalNode.prodPopCode;
    const deployEdgeHost = isStaging
      ? regionalNode.stagingEdgeHost
      : regionalNode.prodEdgeHost;
    const popPrefix = popCode.split('-')[0] || 'IAD';

    const capturedHeaders: TestResult['capturedHeaders'] = {
      'content-type': 'text/html; charset=utf-8',
      'content-language': regionalNode.contentLanguage,
      'cache-control': 'public, max-age=3600',
      'x-check-cacheable': 'YES',
      'x-sfdc-content-source': 'sfdc-experience-cloud-cms',
      'x-sfdc-edge-pop': popCode,
      'x-akamai-edgescape': regionalNode.edgescapeHeader,
      'x-sfdc-agent-cohort-apply-experiment': 'true',
      'x-sfdc-agent-cohort-decision': 'qualified',
      'x-sfdc-agent-cohort-source': 'cookie',
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
      server: 'AkamaiGHost',
      'x-cache': isStaging
        ? `TCP_MISS from ${deployEdgeHost}`
        : `TCP_HIT from ${deployEdgeHost}`,
      'x-cache-key': `/L/12844/542100/1d/${envHost}${tc.path}`,
      'x-true-cache-key': `/L/12844/542100/1d/${canonicalHost}${tc.path}`,
      'x-akamai-request-id': `${isStaging ? 'stg' : 'prd'}-${popPrefix.toLowerCase()}-${
        isNewRun ? '99f' : '41a'
      }0${idx + 1}`,
    };

    const capturedCookies: Record<string, string> = {
      sfdc_agent_cohort:
        'qualified; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax',
      sfdcConsent:
        '1,2,3,4; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax',
      prorigin: `${regionalNode.proriginCode}; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax`,
      AKA_A2: `${regionalNode.countryCode}; Path=/; Domain=.salesforce.com; Secure`,
      sfdc_locale: `${regionalNode.locale}; Path=/; Domain=.salesforce.com; Secure`,
      sfdc_session: `sid_${appId}_${envId}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      edge_region: isStaging
        ? `${popCode}-CANDIDATE; Path=/; Secure; SameSite=Lax`
        : `${popCode}-LIVE; Path=/; Secure; SameSite=Lax`,
      ak_bmsc: `bmsc_${appId}_v1; Domain=.${config.branding.defaultDomain}; Path=/; Secure`,
      CookieConsentPolicy: '0:1; Path=/; Max-Age=31536000; Secure',
    };

    if (id === 'T01') {
      if (isStaging && !isPrevStaging) {
        capturedHeaders['cache-control'] = 'public, max-age=1800';
        capturedHeaders['x-check-cacheable'] = 'NO';
      }
    }

    if (id === 'T02') {
      if (!isStaging) {
        capturedCookies['edge_region'] = `${popCode}-STAGE; Path=/; Secure; SameSite=Lax`;
      } else if (isPrevStaging) {
        capturedCookies['edge_region'] = `${popCode}-PREV; Path=/; Secure; SameSite=Lax`;
        capturedCookies['edge_cache_bypass'] = '0; Path=/; Secure; HttpOnly';
      } else {
        capturedCookies['edge_cache_bypass'] = '1; Path=/; Secure; HttpOnly';
      }
    }

    if (tc.expectedStatus === '301' || (id === 'T04' && appId === 'www')) {
      actualStatus = 301;
      capturedHeaders['location'] = `https://${envHost}/crm/`;
    }

    if (id === 'T05' && isNewRun && isStaging) {
      capturedHeaders['x-sfdc-content-source'] = 'sfdc-trial-origin-v2';
    }

    const durationMs = isStaging ? 82 + idx * 9 : 56 + idx * 6;
    const { redirectChain, httpFlowSummary } = buildHttpFlowForTest({
      appId,
      testId: id,
      canonicalHost,
      envHost,
      path: tc.path,
      isStaging,
      edgeHostname,
      edgeIp,
      actualStatus,
      durationMs,
      capturedHeaders,
      capturedCookies,
      popOverrideId,
    });

    return {
      id,
      name: tc.name,
      url: `https://${envHost}${tc.path}`,
      canonicalUrl: `https://${canonicalHost}${tc.path}`,
      pass,
      errors,
      expectedStatus: tc.expectedStatus,
      actualStatus,
      durationMs,
      capturedHeaders,
      capturedCookies,
      redirectChain,
      httpFlowSummary,
      stagingEdgeIp: edgeIp,
      edgeHostname,
      note: `HTTP/2 (${httpFlowSummary.totalHops} ${
        httpFlowSummary.totalHops === 1 ? 'hop' : 'hops'
      }) via ${popCode} (${edgeIp})`,
    };
  });
}

/**
 * Dynamically seeds run history for every configured Property and Environment.
 */
export function seedRunsFromConfig(
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): RunRecord[] {
  const runs: RunRecord[] = [];
  const baseTime = new Date('2026-11-07T09:14:00Z').getTime();
  let offsetIdx = 0;

  for (const prop of config.properties) {
    for (const env of prop.envs) {
      const networks = env.networks || prop.defaultNetworks || ['prod', 'staging'];
      for (const net of ['staging', 'prod'] as const) {
        if (!networks.includes(net)) continue;
        const target = `${prop.id}.${env.id}.${net}`;

        const latestStart = new Date(baseTime - offsetIdx * 120000);
        const latestFinish = new Date(latestStart.getTime() + 42000);
        const propSuite = getPropertyTestSuite(prop.id, config);
        const latestResults = generateTestResults(
          target,
          net === 'staging' ? 'normal_staging' : 'normal_prod',
          propSuite,
          config
        );

        runs.push({
          key: `run-${prop.id}-${env.id}-${net}-1`,
          target,
          appId: prop.id,
          envId: env.id,
          network: net,
          suiteKey: prop.suitePath,
          suiteSha256: 'a8e9104f92b1',
          suiteRowCount: latestResults.length,
          startTime: latestStart.toISOString(),
          finishTime: latestFinish.toISOString(),
          totalTests: latestResults.length,
          passedTests: latestResults.filter((r) => r.pass).length,
          failedTests: latestResults.filter((r) => !r.pass).length,
          by: config.branding.defaultOperator.email,
          label: `live-${net}`,
          pinnedAsBaseline: net === 'prod',
          results: latestResults,
        });

        const prevStart = new Date(latestStart.getTime() - 3600000);
        const prevFinish = new Date(prevStart.getTime() + 41000);
        const prevResults = generateTestResults(
          target,
          net === 'staging' ? 'prev_staging' : 'prev_prod',
          propSuite,
          config
        );

        runs.push({
          key: `run-${prop.id}-${env.id}-${net}-0`,
          target,
          appId: prop.id,
          envId: env.id,
          network: net,
          suiteKey: prop.suitePath,
          suiteSha256: 'a8e9104f92b1',
          suiteRowCount: prevResults.length,
          startTime: prevStart.toISOString(),
          finishTime: prevFinish.toISOString(),
          totalTests: prevResults.length,
          passedTests: prevResults.filter((r) => r.pass).length,
          failedTests: prevResults.filter((r) => !r.pass).length,
          by: config.branding.defaultOperator.email,
          label: `prev-${net}`,
          pinnedAsBaseline: false,
          results: prevResults,
        });

        offsetIdx++;
      }
    }
  }

  return runs;
}

export const INITIAL_RUNS: RunRecord[] = seedRunsFromConfig(
  DEFAULT_TEMPLATE_CONFIG
);

export const INITIAL_TARGET_STATES: Record<
  string,
  {
    state: 'ready' | 'running' | 'failed';
    activeActivity?: string;
    progress?: { done: number; total: number } | string;
  }
> = Object.fromEntries(
  INITIAL_RUNS.map((r) => [r.target, { state: 'ready' as const }])
);

export const INITIAL_RULES: AcceptedRule[] = [
  {
    id: 'rule-init-1',
    appId: 'www',
    comparisonId: 'all',
    kind: 'x-akamai-request-id',
    enabled: true,
    by: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
    at: '2026-11-06T12:00:00Z',
    note: 'Unique per-edge-request trace ID',
  },
];

export interface BuildComparisonOptions extends ApplyRulesOptions {
  aiJudgeOverrides?: Record<
    string,
    {
      verdict: 'same' | 'minor' | 'different';
      summary: string;
      affectedArea?: string;
      shortCallout?: string;
      pixelDiffPercent?: number;
      changedBox?: { x: number; y: number; w: number; h: number } | null;
      zones?: VisualZoneMetrics | null;
      costGate?: 'identical-bytes' | 'pixel-gate-passed' | 'ai-judged';
    }
  >;
}

export function buildInitialComparison(
  candidateRun: RunRecord,
  baselineRun: RunRecord,
  kind: ComparisonKind,
  rules: AcceptedRule[] = INITIAL_RULES,
  options: BuildComparisonOptions = {}
): ComparisonRecord {
  const comparisonId = `${candidateRun.target}-vs-${baselineRun.target}`;
  const appConfig = APPS.find((a) => a.id === candidateRun.appId);
  const candEnv = appConfig?.envs.find((e) => e.id === candidateRun.envId);
  const baseEnv = appConfig?.envs.find((e) => e.id === baselineRun.envId);

  const items: ComparisonItem[] = candidateRun.results.map((candRes) => {
    const baseRes = baselineRun.results.find((b) => b.id === candRes.id);

    const functionalDiffs = calculateFunctionalDiffs(candRes, baseRes, {
      candidateHostMap: candEnv?.hostMap,
      baselineHostMap: baseEnv?.hostMap,
    });

    const cookieDiffs = calculateCookieDiffs(candRes, baseRes);

    const manifestMap = liveScreenshotManifest as Record<
      string,
      {
        pixelDiffPercent?: number;
        changedBox?: { x: number; y: number; w: number; h: number } | null;
      }
    >;
    const manifestEntry = manifestMap[`${candidateRun.appId}-${candRes.id}`];
    const measuredDiff =
      candidateRun.key === baselineRun.key
        ? 0
        : typeof candRes.pixelDiffPercent === 'number'
        ? candRes.pixelDiffPercent
        : typeof manifestEntry?.pixelDiffPercent === 'number'
        ? manifestEntry.pixelDiffPercent
        : 0;

    const baseLogical = describeVisualDiffLogically({
      pixelDiffPercent: measuredDiff,
      changedBox: manifestEntry?.changedBox ?? null,
      candidateLabel: candidateRun.network,
      baselineLabel: baselineRun.network,
      pageName: candRes.name,
      url: candRes.canonicalUrl,
    });

    let visualResult: NonNullable<ComparisonItem['visualResult']> = {
      verdict: 'same',
      costGate: 'identical-bytes',
      costGateSkippedAi: true,
      pixelDiffPercent: measuredDiff,
      summary: baseLogical.summary,
      affectedArea: baseLogical.affectedArea,
      shortCallout: baseLogical.shortCallout,
      differences: [],
      primaryModel: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
    };

    if (measuredDiff > 0.1 && candidateRun.key !== baselineRun.key) {
      visualResult = {
        verdict: measuredDiff > 5.0 ? 'different' : 'minor',
        costGate: 'ai-judged',
        costGateSkippedAi: false,
        pixelDiffPercent: measuredDiff,
        summary: baseLogical.summary,
        affectedArea: baseLogical.affectedArea,
        shortCallout: baseLogical.shortCallout,
        differences: [
          {
            description: baseLogical.shortCallout,
            severity: measuredDiff > 5.0 ? 'major' : 'minor',
            ...(manifestEntry?.changedBox ? { box: manifestEntry.changedBox } : {}),
          },
        ],
        primaryModel: DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel,
      };
    }

    const aiOverride =
      options.aiJudgeOverrides?.[`${candidateRun.appId}-${candRes.id}`] ??
      options.aiJudgeOverrides?.[candRes.id];
    if (aiOverride && candidateRun.key !== baselineRun.key) {
      const effectivePixelDiff =
        typeof aiOverride.pixelDiffPercent === 'number'
          ? aiOverride.pixelDiffPercent
          : visualResult.pixelDiffPercent ?? 0;
      const effectiveBox = aiOverride.changedBox ?? manifestEntry?.changedBox ?? undefined;
      const overrideLogical = describeVisualDiffLogically({
        pixelDiffPercent: effectivePixelDiff,
        changedBox: effectiveBox ?? null,
        zones: aiOverride.zones ?? null,
        candidateLabel: candidateRun.network,
        baselineLabel: baselineRun.network,
        pageName: candRes.name,
        url: candRes.canonicalUrl,
      });
      const resolvedSummary = humanizeVisualSummary(aiOverride.summary, {
        pixelDiffPercent: effectivePixelDiff,
        changedBox: effectiveBox ?? null,
        zones: aiOverride.zones ?? null,
        candidateLabel: candidateRun.network,
        baselineLabel: baselineRun.network,
        pageName: candRes.name,
        url: candRes.canonicalUrl,
      });
      const resolvedShortCallout =
        aiOverride.shortCallout || overrideLogical.shortCallout;
      const resolvedArea =
        aiOverride.affectedArea || overrideLogical.affectedArea;
      const diffBadgeDescription =
        aiOverride.shortCallout ||
        (aiOverride.summary && aiOverride.summary.length <= 80 && !/pixel/i.test(aiOverride.summary)
          ? aiOverride.summary
          : resolvedShortCallout);

      const overrideDifferences =
        aiOverride.verdict === 'same'
          ? []
          : visualResult.differences && visualResult.differences.length > 0
          ? visualResult.differences.map((d, idx) =>
              idx === 0
                ? {
                    ...d,
                    description: diffBadgeDescription || d.description,
                    severity: aiOverride.verdict === 'different' ? ('major' as const) : ('minor' as const),
                    ...(effectiveBox ? { box: effectiveBox } : {}),
                  }
                : d
            )
          : [
              {
                description:
                  aiOverride.shortCallout ||
                  (aiOverride.summary && !/pixel/i.test(aiOverride.summary)
                    ? aiOverride.summary
                    : resolvedShortCallout),
                severity: aiOverride.verdict === 'different' ? ('major' as const) : ('minor' as const),
                ...(effectiveBox ? { box: effectiveBox } : {}),
              },
            ];

      visualResult = {
        ...visualResult,
        verdict: aiOverride.verdict,
        summary: resolvedSummary,
        affectedArea: resolvedArea,
        shortCallout: resolvedShortCallout,
        pixelDiffPercent: effectivePixelDiff,
        differences: overrideDifferences,
        costGate:
          aiOverride.costGate ??
          (aiOverride.verdict === 'same' && effectivePixelDiff <= 0.1
            ? 'identical-bytes'
            : 'ai-judged'),
        costGateSkippedAi: aiOverride.verdict === 'same' && effectivePixelDiff <= 0.1,
      };
    }

    const combinedDiffs = [...functionalDiffs, ...cookieDiffs];
    const rawVerdict = calculateItemVerdict(
      combinedDiffs,
      visualResult.verdict,
      kind
    );

    const rawItem: ComparisonItem = {
      testId: candRes.id,
      testName: candRes.name,
      url: candRes.canonicalUrl,
      candidateResult: candRes,
      baselineResult: baseRes,
      functionalDiffs,
      cookieDiffs,
      visualResult,
      itemVerdict: rawVerdict,
      rawItemVerdict: rawVerdict,
      candidateFailed: !candRes.pass,
      baselineFailed: baseRes ? !baseRes.pass : false,
    };

    return applyRulesToItem(rawItem, comparisonId, rules, kind, options);
  });

  const headlineVerdict = calculateHeadlineVerdict(items, kind, false, false);

  const counts = {
    same: items.filter((i) => i.itemVerdict === 'same').length,
    minor: items.filter((i) => i.itemVerdict === 'minor').length,
    different: items.filter((i) => i.itemVerdict === 'different').length,
    error: items.filter((i) => i.itemVerdict === 'error').length,
    skipped: 0,
    pending: 0,
  };

  const ignoreAcc = options.ignoreAcceptedDiffs ?? true;
  const rollup = {
    functional: items.filter(
      (i) =>
        i.functionalDiffs.some((d) => (ignoreAcc ? !d.accepted : true)) ||
        (i.cookieDiffs || []).some((d) => (ignoreAcc ? !d.accepted : true))
    ).length,
    critical: items.filter((i) =>
      i.functionalDiffs.some(
        (d) =>
          (ignoreAcc ? !d.accepted : true) &&
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

  const gapMs = Math.abs(
    new Date(candidateRun.startTime).getTime() -
      new Date(baselineRun.startTime).getTime()
  );

  return {
    comparisonId,
    appId: candidateRun.appId,
    kind,
    candidateTarget: candidateRun.target,
    baselineTarget: baselineRun.target,
    candidateRunKey: candidateRun.key,
    baselineRunKey: baselineRun.key,
    candidateStartTime: candidateRun.startTime,
    baselineStartTime: baselineRun.startTime,
    candidateLabel: candidateRun.label,
    isPinnedBaseline: Boolean(baselineRun.pinnedAsBaseline),
    pairingTimeGapMinutes: Math.round(gapMs / 60000),
    isPartial: false,
    headlineVerdict,
    counts,
    rollup,
    items,
  };
}
