import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEMPLATE_CONFIG,
  PROPERTY_TEST_SUITES,
} from '../config/template.config';
import { INITIAL_RUNS } from '../data/mockStore';
import {
  buildAwsCanarySpecification,
  buildAwsCreateCanaryApiPayload,
  buildCanaryDeepDiveReport,
  buildFleetCanaryInventory,
  computeSuiteFingerprint,
  deriveAwsCanaryName,
  planFanOutExecution,
} from './awsSyntheticsOrchestrator';

test('deriveAwsCanaryName enforces AWS 21-char lowercase alphanumeric/hyphen invariant without stg/prd collision', () => {
  assert.equal(deriveAwsCanaryName('www.prod.staging'), 'ak-www-prod-stg');
  assert.equal(deriveAwsCanaryName('www.prod.prod'), 'ak-www-prod-prd');

  const longStg = deriveAwsCanaryName('appexchange-enterprise.staging.staging');
  const longPrd = deriveAwsCanaryName('appexchange-enterprise.staging.prod');
  assert.ok(longStg.length <= 21, `Expected <=21 chars, got ${longStg.length}: ${longStg}`);
  assert.ok(longPrd.length <= 21, `Expected <=21 chars, got ${longPrd.length}: ${longPrd}`);
  assert.notEqual(longStg, longPrd);
  assert.match(longStg, /^[0-9a-z_-]+$/);
  assert.match(longPrd, /^[0-9a-z_-]+$/);
});

test('buildAwsCanarySpecification produces AWS CloudWatch Synthetics spec with zero secrets', () => {
  const wwwApp = DEFAULT_TEMPLATE_CONFIG.properties.find((p) => p.id === 'www')!;
  const suite = PROPERTY_TEST_SUITES.www || DEFAULT_TEMPLATE_CONFIG.testSuite;
  const spec = buildAwsCanarySpecification({
    app: wwwApp,
    envId: 'prod',
    network: 'staging',
    suite,
    accountId: '735234585484',
  });

  assert.equal(spec.canaryName, 'ak-www-prod-stg');
  assert.equal(spec.targetId, 'www.prod.staging');
  assert.equal(spec.runtimeVersion, DEFAULT_TEMPLATE_CONFIG.infrastructure.runtimeVersion);
  assert.equal(spec.handler, 'canary-har-runner.handler');
  assert.ok(spec.artifactS3Location.startsWith('s3://'));
  assert.ok(spec.artifactS3Location.endsWith('/runs/www.prod.staging/'));
  assert.equal(spec.logGroupName, '/aws/lambda/cwsyn-ak-www-prod-stg');
  assert.equal(spec.environmentVariables.BEDROCK_NOVA_LITE_MODEL_ID, 'amazon.nova-lite-v1:0');
  assert.equal(spec.environmentVariables.VISUAL_JUDGE_COST_GATE_PCT, '0.1');
  assert.ok(spec.environmentVariables.SUITE_CHECKS_JSON.includes('T01'));

  for (const key of Object.keys(spec.environmentVariables)) {
    assert.ok(
      !/(secret|token|password|api[_-]?key|authorization|cookie)/i.test(key),
      `Unexpected secret-like env var exposed in Canary spec: ${key}`
    );
  }

  const createPayload = buildAwsCreateCanaryApiPayload(spec) as Record<string, any>;
  assert.equal(createPayload.Name, 'ak-www-prod-stg');
  assert.equal(createPayload.Code.Handler, 'canary-har-runner.handler');
  assert.equal(createPayload.Tags.ExecutionPlane, 'AWSCloudWatchSynthetics');
});

test('buildFleetCanaryInventory organizes all properties and detects suite drift accurately', () => {
  const suitesByAppId: Record<string, typeof DEFAULT_TEMPLATE_CONFIG.testSuite> = {};
  for (const app of DEFAULT_TEMPLATE_CONFIG.properties) {
    suitesByAppId[app.id] = PROPERTY_TEST_SUITES[app.id] || DEFAULT_TEMPLATE_CONFIG.testSuite;
  }

  const wwwHash = computeSuiteFingerprint(suitesByAppId.www);
  const inventory = buildFleetCanaryInventory({
    apps: DEFAULT_TEMPLATE_CONFIG.properties,
    suitesByAppId,
    runs: INITIAL_RUNS,
    syncStateByCanaryName: {
      'ak-www-prod-stg': {
        canaryName: 'ak-www-prod-stg',
        targetId: 'www.prod.staging',
        suiteHash: wwwHash,
        syncStatus: 'AWS_LIVE_SYNCED',
        runtimeState: 'READY',
        lastSyncedAt: '2026-11-19T12:00:00.000Z',
      },
      'ak-www-prod-prd': {
        canaryName: 'ak-www-prod-prd',
        targetId: 'www.prod.prod',
        suiteHash: '00000000',
        syncStatus: 'AWS_LIVE_SYNCED',
        runtimeState: 'READY',
        lastSyncedAt: '2026-11-19T12:00:00.000Z',
      },
    },
  });

  assert.ok(inventory.length >= 28, `Expected >=28 Canaries across 14 properties, got ${inventory.length}`);
  const stg = inventory.find((c) => c.canaryName === 'ak-www-prod-stg')!;
  const prd = inventory.find((c) => c.canaryName === 'ak-www-prod-prd')!;
  assert.equal(stg.syncStatus, 'AWS_LIVE_SYNCED');
  assert.equal(prd.syncStatus, 'DRIFT_PENDING_SYNC');
  assert.ok(stg.checkCount >= 8);
});

test('planFanOutExecution plans bounded-concurrency batches across property-pair, region, nogo-blockers, fleet-all, and custom scopes', () => {
  const suitesByAppId: Record<string, typeof DEFAULT_TEMPLATE_CONFIG.testSuite> = {};
  for (const app of DEFAULT_TEMPLATE_CONFIG.properties) {
    suitesByAppId[app.id] = PROPERTY_TEST_SUITES[app.id] || DEFAULT_TEMPLATE_CONFIG.testSuite;
  }
  const inventory = buildFleetCanaryInventory({
    apps: DEFAULT_TEMPLATE_CONFIG.properties,
    suitesByAppId,
    runs: INITIAL_RUNS,
  });

  const propPlan = planFanOutExecution({
    scope: 'property-pair',
    canaries: inventory,
    appId: 'www',
  });
  assert.equal(propPlan.totalCanaries, 2);
  assert.deepEqual(propPlan.affectedAppIds, ['www']);
  assert.equal(propPlan.concurrency, 2);

  const fleetPlan = planFanOutExecution({
    scope: 'fleet-all',
    canaries: inventory,
    maxConcurrency: 6,
  });
  assert.equal(fleetPlan.affectedAppIds.length, DEFAULT_TEMPLATE_CONFIG.properties.length);
  assert.equal(fleetPlan.concurrency, 6);

  const customPlan = planFanOutExecution({
    scope: 'custom',
    canaries: inventory,
    canaryNames: ['ak-www-prod-stg', 'ak-login-prod-stg', 'ak-www-prod-stg'],
  });
  assert.equal(customPlan.totalCanaries, 2);
});

test('buildCanaryDeepDiveReport includes paired comparison Canary, check results, run history, and AWS CLI commands', () => {
  const suitesByAppId: Record<string, typeof DEFAULT_TEMPLATE_CONFIG.testSuite> = {};
  for (const app of DEFAULT_TEMPLATE_CONFIG.properties) {
    suitesByAppId[app.id] = PROPERTY_TEST_SUITES[app.id] || DEFAULT_TEMPLATE_CONFIG.testSuite;
  }
  const inventory = buildFleetCanaryInventory({
    apps: DEFAULT_TEMPLATE_CONFIG.properties,
    suitesByAppId,
    runs: INITIAL_RUNS,
  });
  const wwwStg = inventory.find((c) => c.canaryName === 'ak-www-prod-stg')!;

  const deepDive = buildCanaryDeepDiveReport({
    canary: wwwStg,
    allCanaries: inventory,
    suite: suitesByAppId.www,
    runs: INITIAL_RUNS,
  });

  assert.equal(deepDive.pairedCanaryName, 'ak-www-prod-prd');
  assert.equal(deepDive.pairedTargetId, 'www.prod.prod');
  assert.ok(deepDive.checks.length >= 8);
  assert.ok(deepDive.runHistory.length >= 1);
  assert.ok(deepDive.awsCliCommands.startCanary.includes('aws synthetics start-canary --name ak-www-prod-stg'));
  assert.ok(deepDive.awsCliCommands.listS3Artifacts.includes('s3://'));
});
