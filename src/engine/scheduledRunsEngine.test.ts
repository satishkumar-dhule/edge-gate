import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE_CONFIG } from '../config/template.config';
import {
  appendLiveScheduledRunTick,
  buildDefaultSchedulePolicy,
  buildFleetDashboardAnalytics,
  buildScheduledRunsDataset,
  computeScheduledSlaAnalytics,
  filterScheduledPoints,
  ingestRealPortalRunsIntoSchedule,
  intervalToCronExpression,
} from './scheduledRunsEngine';
import { PropertyGateSummary } from './workbenchModel';
import { RunRecord } from './types';

test('scheduledRunsEngine pure logic', async (t) => {
  const wwwApp = DEFAULT_TEMPLATE_CONFIG.properties[0];
  const suite = DEFAULT_TEMPLATE_CONFIG.testSuite;
  const policy = buildDefaultSchedulePolicy(wwwApp);

  await t.test('builds valid default schedule policy and cron expressions', () => {
    assert.equal(policy.appId, 'www');
    assert.equal(intervalToCronExpression(1), '* * * * *');
    assert.equal(intervalToCronExpression(5), '*/5 * * * *');
    assert.equal(intervalToCronExpression(15), '*/15 * * * *');
    assert.equal(intervalToCronExpression(60), '0 * * * *');
    assert.ok(policy.assignedPops.length >= 2);
  });

  await t.test('generates deterministic scheduled run time-series with exact phase breakdown sums and enriched telemetry', () => {
    const dataset24h = buildScheduledRunsDataset({
      appId: 'www',
      suite,
      policy,
      range: '24h',
    });
    assert.equal(dataset24h.length, 36);

    for (const pt of dataset24h) {
      assert.equal(
        pt.dnsMs + pt.tcpMs + pt.tlsMs + pt.ttfbMs + pt.transferMs,
        pt.totalMs,
        `Run ${pt.runId} phase timings must sum to totalMs`
      );
      assert.equal(pt.checkSnapshots.length, suite.length);
      assert.ok(pt.p50Ms > 0 && pt.p95Ms >= pt.p50Ms && pt.p99Ms >= pt.p95Ms);
      assert.ok(pt.cacheHitRatioPct >= 0 && pt.cacheHitRatioPct <= 100);
      assert.ok(pt.apdexScore >= 0 && pt.apdexScore <= 1);
      assert.ok(pt.lcpMs >= pt.fcpMs);
      assert.equal(
        pt.status2xxCount + pt.status3xxCount + pt.status4xxCount + pt.status5xxCount,
        pt.totalChecks
      );
    }

    // Verify 30d range works as well
    const dataset30d = buildScheduledRunsDataset({
      appId: 'www',
      suite,
      policy,
      range: '30d',
    });
    assert.equal(dataset30d.length, 48);

    // Verify maintenance window points and deployment markers exist
    assert.ok(dataset24h.some((p) => p.inMaintenanceWindow));
    assert.ok(dataset24h.some((p) => Boolean(p.deploymentMarker)));
  });

  await t.test('SLA availability purging excludes maintenance window dips and computes PoP breakdown', () => {
    const dataset = buildScheduledRunsDataset({
      appId: 'www',
      suite,
      policy,
      range: '24h',
    });
    const rawSla = computeScheduledSlaAnalytics({
      points: dataset,
      policy,
      excludeMaintenanceWindows: false,
    });
    const purgedSla = computeScheduledSlaAnalytics({
      points: dataset,
      policy,
      excludeMaintenanceWindows: true,
    });

    assert.ok(purgedSla.excludedMaintenanceRuns > 0);
    assert.ok(
      purgedSla.effectiveAvailabilityPct >= rawSla.effectiveAvailabilityPct,
      'Purging maintenance window failures must improve or preserve official SLA availability'
    );
    assert.ok(purgedSla.popBreakdown.length >= 2);
    assert.ok(purgedSla.avgCacheHitRatioPct > 0);
    assert.ok(purgedSla.avgApdexScore > 0);
  });

  await t.test('filters scheduled points by PoP, verdict, and individual check ID', () => {
    const dataset = buildScheduledRunsDataset({
      appId: 'www',
      suite,
      policy,
      range: '6h',
    });
    const onlyNoGo = filterScheduledPoints({
      points: dataset,
      popFilter: 'ALL',
      verdictFilter: 'NO-GO',
      checkIdFilter: 'ALL',
    });
    assert.ok(onlyNoGo.every((p) => p.verdict === 'NO-GO'));

    const singleCheck = filterScheduledPoints({
      points: dataset,
      popFilter: 'ALL',
      verdictFilter: 'ALL',
      checkIdFilter: 'T04',
    });
    assert.equal(singleCheck.length, dataset.length);
    assert.ok(singleCheck.every((p) => p.totalChecks === 1));
  });

  await t.test('appendLiveScheduledRunTick creates a fresh live scheduled run point', () => {
    const dataset = buildScheduledRunsDataset({
      appId: 'www',
      suite,
      policy,
      range: '1h',
    });
    const livePoint = appendLiveScheduledRunTick({
      existingPoints: dataset,
      appId: 'www',
      suite,
      policy,
      triggeredBy: 'manual-trigger',
    });
    assert.equal(livePoint.index, dataset.length);
    assert.equal(livePoint.availabilityPct, 100);
    assert.equal(
      livePoint.dnsMs + livePoint.tcpMs + livePoint.tlsMs + livePoint.ttfbMs + livePoint.transferMs,
      livePoint.totalMs
    );
    assert.ok(livePoint.cacheHitRatioPct > 0);
  });

  await t.test('ingestRealPortalRunsIntoSchedule converts live RunRecord probes into scheduled telemetry points', () => {
    const basePoints = buildScheduledRunsDataset({
      appId: 'www',
      suite,
      policy,
      range: '1h',
    });
    const mockLiveRuns: RunRecord[] = [
      {
        key: 'live-www-stg-999',
        label: 'live-stg #9 · 10:15:00 UTC',
        target: 'www.prod.staging',
        appId: 'www',
        envId: 'prod',
        network: 'staging',
        suiteKey: 'suite-www',
        suiteSha256: 'abc123',
        suiteRowCount: 1,
        startTime: '10:15:00 UTC',
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        by: 'sre@salesforce.com',
        results: [
          {
            id: 'T01',
            name: 'Home',
            url: 'https://www.salesforce.com/',
            canonicalUrl: 'https://www.salesforce.com/',
            pass: true,
            errors: [],
            expectedStatus: '200',
            actualStatus: 200,
            durationMs: 92,
            redirectChain: [],
            capturedHeaders: {
              'x-cache': 'TCP_HIT',
              'x-check-cacheable': 'YES',
            },
          },
        ],
      },
      {
        key: 'live-www-prd-999',
        label: 'live-prd #9 · 10:15:00 UTC',
        target: 'www.prod.prod',
        appId: 'www',
        envId: 'prod',
        network: 'prod',
        suiteKey: 'suite-www',
        suiteSha256: 'abc123',
        suiteRowCount: 1,
        startTime: '10:15:00 UTC',
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        by: 'sre@salesforce.com',
        results: [
          {
            id: 'T01',
            name: 'Home',
            url: 'https://www.salesforce.com/',
            canonicalUrl: 'https://www.salesforce.com/',
            pass: true,
            errors: [],
            expectedStatus: '200',
            actualStatus: 200,
            durationMs: 88,
            redirectChain: [],
            capturedHeaders: {
              'x-cache': 'TCP_HIT',
              'x-check-cacheable': 'YES',
            },
          },
        ],
      },
    ];

    const merged = ingestRealPortalRunsIntoSchedule({
      basePoints,
      runs: mockLiveRuns,
      appId: 'www',
      suite,
      policy,
    });
    assert.equal(merged.length, basePoints.length + 1);
    const added = merged[merged.length - 1];
    assert.equal(added.triggeredBy, 'live-probe');
    assert.equal(added.cacheHitRatioPct, 100);
    assert.equal(added.dnsMs + added.tcpMs + added.tlsMs + added.ttfbMs + added.transferMs, added.totalMs);
  });

  await t.test('buildFleetDashboardAnalytics aggregates cross-property KPIs, timeline, and regional PoPs', () => {
    const summaries: PropertyGateSummary[] = DEFAULT_TEMPLATE_CONFIG.properties.slice(0, 4).map((p, i) => ({
      appId: p.id,
      name: p.name,
      canonicalHost: `${p.id}.salesforce.com`,
      popCode: i % 2 === 0 ? 'IAD-US-EAST' : 'LHR-EU-WEST',
      regionCode: i % 2 === 0 ? 'AMER' : 'EMEA',
      envId: 'prod',
      candidateTarget: `${p.id}.prod.staging`,
      baselineTarget: `${p.id}.prod.prod`,
      verdict: i === 0 ? 'NO-GO' : i === 1 ? 'REVIEW' : 'GO',
      headerDiffCount: i === 0 ? 2 : 0,
      cookieDiffCount: i === 1 ? 1 : 0,
      visualDiffCount: i === 0 ? 1 : 0,
      failCount: i === 0 ? 2 : 0,
      totalChecks: 9,
      firstDiffTestId: 'T01',
      firstDiffTab: 'headers',
    }));

    const fleetAnalytics = buildFleetDashboardAnalytics({
      summaries,
      apps: DEFAULT_TEMPLATE_CONFIG.properties,
      range: '24h',
    });

    assert.equal(fleetAnalytics.fleetKpis.totalProperties, 4);
    assert.equal(fleetAnalytics.fleetKpis.noGoCount, 1);
    assert.equal(fleetAnalytics.fleetKpis.reviewCount, 1);
    assert.equal(fleetAnalytics.fleetKpis.goCount, 2);
    assert.ok(fleetAnalytics.fleetTimeline.length === 36);
    assert.equal(fleetAnalytics.propertyTelemetryRows.length, 4);
    assert.equal(fleetAnalytics.regionalPopTelemetry.length, 9);
  });
});
