import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerdictBreakdownText,
  computeFleetAggregateMetrics,
  computePropertyGateSummary,
  exportFleetGateCsv,
  filterEvidenceKeys,
  getFirstDiffTab,
  getItemDiffCounts,
  normalizeWorkbenchViewMode,
  resolveSafeAreaLabel,
  sortPropertySummaries,
  type PropertyGateSummary,
} from './workbenchModel';
import { DEFAULT_TEMPLATE_CONFIG } from '../config/template.config';
import { INITIAL_RULES, INITIAL_RUNS, buildInitialComparison } from '../data/mockStore';

describe('workbenchModel pure logic', () => {
  it('normalizes legacy and consolidated 4-workspace view modes cleanly', () => {
    assert.equal(normalizeWorkbenchViewMode('synthetics'), 'synthetics');
    assert.equal(normalizeWorkbenchViewMode('canaries'), 'synthetics');
    assert.equal(normalizeWorkbenchViewMode('fleet'), 'synthetics');
    assert.equal(normalizeWorkbenchViewMode('suites'), 'synthetics');
    assert.equal(normalizeWorkbenchViewMode('compare'), 'workbench');
    assert.equal(normalizeWorkbenchViewMode('workbench'), 'workbench');
    assert.equal(normalizeWorkbenchViewMode('property'), 'workbench');
    assert.equal(normalizeWorkbenchViewMode('diff'), 'workbench');
    assert.equal(normalizeWorkbenchViewMode('run'), 'workbench');
    assert.equal(normalizeWorkbenchViewMode('schedules'), 'workbench');
    assert.equal(normalizeWorkbenchViewMode('config'), 'config');
    assert.equal(normalizeWorkbenchViewMode('policies'), 'config');
    assert.equal(normalizeWorkbenchViewMode('settings'), 'config');
    assert.equal(normalizeWorkbenchViewMode('setup'), 'config');
    assert.equal(normalizeWorkbenchViewMode('studio'), 'studio');
    assert.equal(normalizeWorkbenchViewMode('mcp'), 'studio');
    assert.equal(normalizeWorkbenchViewMode('rpc'), 'studio');
    assert.equal(normalizeWorkbenchViewMode('protocol'), 'studio');
    assert.equal(normalizeWorkbenchViewMode('vscode'), 'vscode');
    assert.equal(normalizeWorkbenchViewMode('ide'), 'vscode');
    assert.equal(normalizeWorkbenchViewMode('code'), 'vscode');
    assert.equal(normalizeWorkbenchViewMode('terminal'), 'vscode');
    assert.equal(normalizeWorkbenchViewMode('unknown'), 'synthetics');
  });

  it('replaces None affectedArea with meaningful visual status label', () => {
    assert.equal(resolveSafeAreaLabel('None', 'same'), 'Visual Layout Aligned');
    assert.equal(resolveSafeAreaLabel('none', 'minor'), 'Primary Viewport');
    assert.equal(resolveSafeAreaLabel('Hero Banner', 'different'), 'Hero Banner');
  });

  it('computes www property summary transitioning from NO-GO to GO when all detected blockers are accepted', () => {
    const wwwApp = DEFAULT_TEMPLATE_CONFIG.properties.find((p) => p.id === 'www')!;
    const candRun = INITIAL_RUNS.find((r) => r.target === 'www.prod.staging')!;
    const baseRun = INITIAL_RUNS.find((r) => r.target === 'www.prod.prod')!;
    const initialComp = buildInitialComparison(candRun, baseRun, 'network', INITIAL_RULES, {
      acceptedCookies: ['_abck', 'bm_sz', 'ak_bmsc', 'ew_renderer_id', 'akacd_smb_overview_split', 'edge_region'],
      acceptedVisualTests: [],
      ignoreAcceptedDiffs: true,
    });

    const allDiffKinds = Array.from(
      new Set(
        initialComp.items.flatMap((it) =>
          it.functionalDiffs.map((d) => (d.field || d.kind).toLowerCase())
        )
      )
    );

    const dynamicRules = [
      ...INITIAL_RULES,
      ...allDiffKinds.map((k, idx) => ({
        id: `acc-${idx}`,
        appId: 'www',
        comparisonId: 'all',
        kind: k,
        enabled: true,
        by: 'test',
        at: new Date().toISOString(),
      })),
    ];

    const after = computePropertyGateSummary({
      app: wwwApp,
      runs: INITIAL_RUNS,
      rules: dynamicRules,
      acceptedCookies: ['_abck', 'bm_sz', 'ak_bmsc', 'ew_renderer_id', 'akacd_smb_overview_split', 'edge_region', 'edge_cache_bypass'],
      acceptedVisualTests: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'],
      ignoreAcceptedDiffs: true,
      templateConfig: DEFAULT_TEMPLATE_CONFIG,
    });

    assert.equal(after.headerDiffCount, 0);
    assert.equal(after.cookieDiffCount, 0);
    assert.equal(after.visualDiffCount, 0);
    assert.equal(after.verdict, 'GO');
  });

  it('picks the right first diff tab and formats verdict breakdown text', () => {
    const mockItem = {
      testId: 'T02',
      testName: 'Pricing',
      url: 'https://www.salesforce.com/pricing',
      functionalDiffs: [],
      cookieDiffs: [{ kind: 'cookie' as const, field: 'geo', candidateValue: 'US', baselineValue: 'EU', severity: 'minor' as const }],
      visualResult: {
        verdict: 'same' as const,
        costGate: 'identical-bytes' as const,
        costGateSkippedAi: true,
        summary: 'Match',
        differences: [],
        primaryModel: 'amazon.nova-lite-v1:0',
      },
      itemVerdict: 'minor' as const,
      candidateFailed: false,
      baselineFailed: false,
    };
    const counts = getItemDiffCounts(mockItem, true);
    assert.equal(counts.cookieDiffs, 1);
    assert.equal(getFirstDiffTab(mockItem, true), 'cookies');
    assert.equal(
      buildVerdictBreakdownText({ headerDiffs: 2, cookieDiffs: 1, visualDiffs: 0, totalChecks: 8 }),
      '2 headers · 1 cookie'
    );
    assert.equal(
      buildVerdictBreakdownText({ headerDiffs: 0, cookieDiffs: 0, visualDiffs: 0, totalChecks: 8 }),
      'All 8 checks aligned'
    );
  });

  it('sorts fleet summaries, aggregates totals, exports CSV, and filters evidence keys', () => {
    const sampleSummaries: PropertyGateSummary[] = [
      {
        appId: 'help',
        name: 'Help Portal',
        canonicalHost: 'help.salesforce.com',
        popCode: 'ANY',
        regionCode: 'GLOBAL',
        envId: 'prod',
        candidateTarget: 'help.prod.staging',
        baselineTarget: 'help.prod.prod',
        verdict: 'GO',
        headerDiffCount: 0,
        cookieDiffCount: 0,
        visualDiffCount: 0,
        failCount: 0,
        totalChecks: 6,
        firstDiffTestId: 'T01',
        firstDiffTab: 'headers',
      },
      {
        appId: 'www',
        name: 'Global, Marketing',
        canonicalHost: 'www.salesforce.com',
        popCode: 'IAD',
        regionCode: 'AMER',
        envId: 'prod',
        candidateTarget: 'www.prod.staging',
        baselineTarget: 'www.prod.prod',
        verdict: 'NO-GO',
        headerDiffCount: 2,
        cookieDiffCount: 1,
        visualDiffCount: 1,
        failCount: 1,
        totalChecks: 8,
        firstDiffTestId: 'T01',
        firstDiffTab: 'headers',
      },
      {
        appId: 'login',
        name: 'Core Identity',
        canonicalHost: 'login.salesforce.com',
        popCode: 'FRA',
        regionCode: 'EMEA',
        envId: 'prod',
        candidateTarget: 'login.prod.staging',
        baselineTarget: 'login.prod.prod',
        verdict: 'REVIEW',
        headerDiffCount: 0,
        cookieDiffCount: 2,
        visualDiffCount: 0,
        failCount: 0,
        totalChecks: 5,
        firstDiffTestId: 'T02',
        firstDiffTab: 'cookies',
      },
    ];

    const byVerdictDesc = sortPropertySummaries(sampleSummaries, 'verdict', 'desc');
    assert.deepEqual(
      byVerdictDesc.map((s) => s.appId),
      ['www', 'login', 'help']
    );

    const byDiffsDesc = sortPropertySummaries(sampleSummaries, 'diffs', 'desc');
    assert.deepEqual(
      byDiffsDesc.map((s) => s.appId),
      ['www', 'login', 'help']
    );

    const agg = computeFleetAggregateMetrics(sampleSummaries);
    assert.equal(agg.total, 3);
    assert.equal(agg.noGo, 1);
    assert.equal(agg.review, 1);
    assert.equal(agg.go, 1);
    assert.equal(agg.totalDiffs, 6);
    assert.equal(agg.totalChecks, 19);

    const csv = exportFleetGateCsv(sampleSummaries);
    assert.ok(csv.includes('"Global, Marketing"'));
    assert.ok(csv.includes('Property ID,Property Name'));

    const filteredKeys = filterEvidenceKeys({
      keys: ['cache-control', 'x-check-cacheable', 'server'],
      query: 'akamaighost',
      candValues: { server: 'AkamaiGHost', 'cache-control': 'no-cache' },
      baseValues: { server: 'AkamaiGHost', 'cache-control': 'max-age=300' },
    });
    assert.deepEqual(filteredKeys, ['server']);
  });
});
