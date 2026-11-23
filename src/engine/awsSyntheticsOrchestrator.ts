/**
 * ============================================================================
 * AWS CLOUDWATCH SYNTHETICS ORCHESTRATION ENGINE (PURE LOGIC)
 * ============================================================================
 * Separation of Concerns:
 *   - EXECUTION PLANE: AWS CloudWatch Synthetics Canaries (`aws_synthetics_canary`)
 *     run every test check, write HAR/screenshots/manifests to S3, and index runs
 *     in DynamoDB.
 *   - CONTROL PLANE (PORTAL): Orchestrates Canary creation/sync (`CreateCanary` /
 *     `UpdateCanary`), organizes Canaries by property/env/network/region, triggers
 *     parallel Fan-Out runs (`StartCanary`), ingests results, compares Candidate
 *     vs Baseline, and powers Canary-to-Check Deep Dive inspection.
 * ============================================================================
 */

import {
  DEFAULT_TEMPLATE_CONFIG,
  TemplateConfig,
  TestCaseDefinition,
  resolvePropertyHostname,
} from '../config/template.config';
import { AppConfig, OverallVerdict, RunRecord } from './types';
import { classifyPropertyRegion, RegionCode } from './scalableViewEngine';
import {
  InspectorDimensionTab,
  PropertyGateSummary,
  computePropertyGateSummary,
} from './workbenchModel';

export type CanarySyncStatus =
  | 'AWS_LIVE_SYNCED'
  | 'AWS_SPEC_STAGED'
  | 'DRIFT_PENDING_SYNC'
  | 'SYNC_ERROR';

export type CanaryRuntimeState =
  | 'READY'
  | 'RUNNING'
  | 'STARTING'
  | 'STOPPING'
  | 'STOPPED'
  | 'UPDATING'
  | 'ERROR';

export interface AwsCanarySpecification {
  canaryName: string;
  targetId: string;
  appId: string;
  appName: string;
  envId: string;
  network: 'staging' | 'prod';
  region: string;
  accountId: string;
  arn: string;
  runtimeVersion: string;
  handler: string;
  executionRoleArn: string;
  artifactS3Location: string;
  codeS3Bucket: string;
  codeS3Key: string;
  suiteS3Key: string;
  logGroupName: string;
  scheduleExpression: string;
  timeoutInSeconds: number;
  memoryInMB: number;
  edgeHostname: string;
  edgeIp: string;
  canonicalHost: string;
  hostMap: Record<string, string>;
  checkCount: number;
  suiteHash: string;
  environmentVariables: Record<string, string>;
  tags: Record<string, string>;
}

export interface ManagedSyntheticsCanary {
  canaryName: string;
  targetId: string;
  appId: string;
  appName: string;
  envId: string;
  network: 'staging' | 'prod';
  regionCode: RegionCode;
  popCode: string;
  awsRegion: string;
  arn: string;
  runtimeVersion: string;
  artifactS3Location: string;
  suiteS3Key: string;
  logGroupName: string;
  executionRoleArn: string;
  edgeHostname: string;
  edgeIp: string;
  canonicalHost: string;
  checkCount: number;
  suiteHash: string;
  runtimeState: CanaryRuntimeState;
  syncStatus: CanarySyncStatus;
  lastSyncedAt?: string;
  lastAwsMessage?: string;
  lastRunKey?: string;
  lastRunAt?: string;
  lastRunPassed?: number;
  lastRunTotal?: number;
  lastRunFailed?: number;
  lastRunDurationMs?: number;
  s3ManifestKey?: string;
  gateVerdict: OverallVerdict;
  headerDiffs: number;
  cookieDiffs: number;
  visualDiffs: number;
  firstDiffTestId: string;
  firstDiffTab: InspectorDimensionTab;
  spec: AwsCanarySpecification;
}

export type FanOutScope =
  | 'property-pair'
  | 'nogo-blockers'
  | 'region'
  | 'fleet-all'
  | 'custom';

export interface FanOutPlanInput {
  scope: FanOutScope;
  canaries: ManagedSyntheticsCanary[];
  appId?: string;
  regionCode?: RegionCode;
  canaryNames?: string[];
  networks?: Array<'staging' | 'prod'>;
  maxConcurrency?: number;
}

export interface FanOutExecutionPlan {
  scope: FanOutScope;
  concurrency: number;
  totalCanaries: number;
  affectedAppIds: string[];
  targets: Array<{
    canaryName: string;
    targetId: string;
    appId: string;
    envId: string;
    network: 'staging' | 'prod';
    regionCode: RegionCode;
    popCode: string;
  }>;
}

export interface FanOutCanaryResult {
  canaryName: string;
  targetId: string;
  appId: string;
  envId: string;
  network: 'staging' | 'prod';
  status: 'COMPLETED' | 'DISPATCHED_AWS' | 'FAILED';
  awsStartDispatched: boolean;
  awsMessage?: string;
  runKey?: string;
  s3ManifestKey?: string;
  passedTests: number;
  failedTests: number;
  totalTests: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  error?: string;
}

export interface FanOutBatchRecord {
  batchId: string;
  scope: FanOutScope;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL_FAILURE';
  concurrency: number;
  totalCanaries: number;
  completedCanaries: number;
  failedCanaries: number;
  affectedAppIds: string[];
  results: FanOutCanaryResult[];
  propertyVerdicts: Array<{
    appId: string;
    verdict: OverallVerdict;
    headerDiffs: number;
    cookieDiffs: number;
    visualDiffs: number;
    firstDiffTestId: string;
    firstDiffTab: InspectorDimensionTab;
  }>;
}

export interface CanaryDeepDiveReport {
  canary: ManagedSyntheticsCanary;
  pairedCanaryName: string | null;
  pairedTargetId: string | null;
  checks: Array<{
    id: string;
    name: string;
    path: string;
    expectedStatus: string;
    category: string;
    testType: string;
    folderId: string;
    enabled: boolean;
    lastActualStatus?: number;
    lastPass?: boolean;
    lastDurationMs?: number;
    screenshotUrl?: string | null;
  }>;
  runHistory: Array<{
    runKey: string;
    label: string;
    startTime: string;
    finishTime: string;
    passedTests: number;
    failedTests: number;
    totalTests: number;
    by: string;
    s3ManifestKey: string;
    executionEngine: string;
  }>;
  awsCliCommands: {
    describeCanary: string;
    startCanary: string;
    getCanaryRuns: string;
    listS3Artifacts: string;
  };
  createCanaryPayloadPreview: Record<string, unknown>;
}

const SECRET_ENV_PATTERN = /(secret|token|password|api[_-]?key|authorization|cookie)/i;

/**
 * Deterministic lightweight FNV-1a hex hash for suite drift detection (browser + Node safe).
 */
export function computeSuiteFingerprint(suite: TestCaseDefinition[]): string {
  const canonical = suite
    .filter((tc) => tc.enabled !== false)
    .map((tc) => ({
      id: tc.id,
      name: tc.name,
      path: tc.path,
      expectedStatus: tc.expectedStatus,
      httpMethod: tc.httpMethod || 'GET',
      testType: tc.testType || 'web-chrome',
      targetHost: tc.targetHost || '',
    }));
  const str = JSON.stringify(canonical);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Derives an AWS CloudWatch Synthetics compliant canary name:
 *   - Must match ^[0-9a-z_\-]+$
 *   - Maximum length 21 characters
 * Matches Terraform `infra/terraform/main.tf` convention:
 *   `ak-${prop.id}-${env.id}-${net == "staging" ? "stg" : "prd"}`
 */
export function deriveAwsCanaryName(targetId: string, prefix = 'ak'): string {
  const parts = String(targetId || 'www.prod.staging').split('.');
  const rawApp = (parts[0] || 'www').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const rawEnv = (parts[1] || 'prod').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const rawNet = (parts[2] || 'staging').toLowerCase();
  const netCode = rawNet === 'staging' ? 'stg' : 'prd';
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'ak';

  const full = `${cleanPrefix}-${rawApp}-${rawEnv}-${netCode}`.replace(/-+/g, '-');
  if (full.length <= 21) return full;

  // Preserve prefix + env + network suffix while truncating app segment cleanly so staging/prod never collide
  const suffix = `-${rawEnv.slice(0, 4)}-${netCode}`;
  const maxAppLen = Math.max(2, 21 - cleanPrefix.length - 1 - suffix.length);
  const compactApp = rawApp.slice(0, maxAppLen).replace(/-+$/, '') || 'app';
  return `${cleanPrefix}-${compactApp}${suffix}`.slice(0, 21).replace(/-+$/, '');
}

/**
 * Resolves the canonical S3 bucket name (without s3:// prefix) from TemplateConfig.
 */
export function resolveSyntheticsBucketName(
  templateConfig: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): string {
  return (templateConfig.infrastructure.s3Bucket || 'salesforce-akamai-synthetics-735234585484-us-east-1')
    .replace(/^s3:\/\//, '')
    .split('/')[0];
}

/**
 * Builds the complete AWS CloudWatch Synthetics `CreateCanary` / `UpdateCanary`
 * specification for one `<app>.<env>.<net>` target. Zero secrets are ever included.
 */
export function buildAwsCanarySpecification(params: {
  app: AppConfig;
  envId: string;
  network: 'staging' | 'prod';
  suite: TestCaseDefinition[];
  templateConfig?: TemplateConfig;
  accountId?: string;
  executionRoleArn?: string;
}): AwsCanarySpecification {
  const {
    app,
    envId,
    network,
    suite,
    templateConfig = DEFAULT_TEMPLATE_CONFIG,
    accountId = '735234585484',
    executionRoleArn,
  } = params;

  const targetId = `${app.id}.${envId}.${network}`;
  const canaryName = deriveAwsCanaryName(targetId);
  const region = templateConfig.infrastructure.awsRegion || 'us-east-1';
  const bucket = resolveSyntheticsBucketName(templateConfig);
  const envObj = app.envs.find((e) => e.id === envId) || app.envs[0];
  const hostMap = envObj?.hostMap || {};
  const canonicalHost = resolvePropertyHostname(app.id, 'prod', templateConfig);
  const mappedHost = hostMap[canonicalHost] || resolvePropertyHostname(app.id, envId, templateConfig);

  const netCfg =
    network === 'staging'
      ? templateConfig.networks.staging
      : templateConfig.networks.prod;

  const edgeIp = netCfg.defaultEdgeIp;
  const edgeSuffix = netCfg.edgeSuffix;
  const edgeHostname = `${mappedHost}${edgeSuffix}`;
  const runtimeVersion =
    templateConfig.infrastructure.runtimeVersion || 'syn-nodejs-puppeteer-9.1';
  const roleArn =
    executionRoleArn ||
    `arn:aws:iam::${accountId}:role/AkamaiSyntheticsReleaseGateRole-prod-${region}`;
  const arn = `arn:aws:synthetics:${region}:${accountId}:canary:${canaryName}`;
  const artifactS3Location = `s3://${bucket}/runs/${targetId}/`;
  const suiteS3Key = `config/suites/${app.id}.json`;
  const codeS3Key = 'canary-code/canary-har-runner.zip';
  const logGroupName = `/aws/lambda/cwsyn-${canaryName}`;

  const enabledChecks = suite.filter((tc) => tc.enabled !== false);
  const compactSuiteChecks = enabledChecks.map((tc) => ({
    id: tc.id,
    name: tc.name,
    path: tc.path,
    expectedStatus: tc.expectedStatus || '200',
    httpMethod: tc.httpMethod || 'GET',
    critical: tc.critical !== false,
  }));
  const suiteHash = computeSuiteFingerprint(suite);

  const rawEnvVars: Record<string, string> = {
    TARGET_AWS_REGION: region,
    ENVIRONMENT: envId,
    TARGET_ID: targetId,
    APP_ID: app.id,
    ENV_ID: envId,
    EDGE_NETWORK: network,
    EDGE_RESOLVE_IP: edgeIp,
    EDGE_HOST_SUFFIX: edgeSuffix,
    DEFAULT_DOMAIN: templateConfig.branding.defaultDomain,
    HOST_MAP_JSON: JSON.stringify(hostMap),
    SUITE_S3_KEY: suiteS3Key,
    SUITE_CHECKS_JSON: JSON.stringify(compactSuiteChecks).slice(0, 3200),
    S3_ARTIFACT_BUCKET: bucket,
    DYNAMODB_RUNS_TABLE: templateConfig.infrastructure.dynamodbTable,
    BEDROCK_NOVA_LITE_MODEL_ID: templateConfig.infrastructure.visualJudgeModel,
    VISUAL_JUDGE_COST_GATE_PCT: '0.1',
    VIEWPORT_WIDTH: '1280',
    VIEWPORT_HEIGHT: '760',
    NAVIGATION_TIMEOUT_MS: '30000',
  };

  // Enforce zero-secret invariant on Canary environment variables
  const environmentVariables: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEnvVars)) {
    if (!SECRET_ENV_PATTERN.test(k)) {
      environmentVariables[k] = v;
    }
  }

  return {
    canaryName,
    targetId,
    appId: app.id,
    appName: app.name,
    envId,
    network,
    region,
    accountId,
    arn,
    runtimeVersion,
    handler: 'canary-har-runner.handler',
    executionRoleArn: roleArn,
    artifactS3Location,
    codeS3Bucket: bucket,
    codeS3Key,
    suiteS3Key,
    logGroupName,
    scheduleExpression: 'rate(0 minutes)',
    timeoutInSeconds: 120,
    memoryInMB: 2048,
    edgeHostname,
    edgeIp,
    canonicalHost,
    hostMap,
    checkCount: enabledChecks.length,
    suiteHash,
    environmentVariables,
    tags: {
      ManagedBy: 'ReleaseGateControlPlane',
      ExecutionPlane: 'AWSCloudWatchSynthetics',
      AppId: app.id,
      Environment: envId,
      EdgeNetwork: network,
      SuiteHash: suiteHash,
    },
  };
}

/**
 * Builds the exact AWS CloudWatch Synthetics REST API body for `POST /canary` (`CreateCanary`).
 */
export function buildAwsCreateCanaryApiPayload(spec: AwsCanarySpecification): Record<string, unknown> {
  return {
    Name: spec.canaryName,
    Code: {
      S3Bucket: spec.codeS3Bucket,
      S3Key: spec.codeS3Key,
      Handler: spec.handler,
    },
    ArtifactS3Location: spec.artifactS3Location,
    ExecutionRoleArn: spec.executionRoleArn,
    Schedule: {
      Expression: spec.scheduleExpression,
      DurationInSeconds: 0,
    },
    RunConfig: {
      TimeoutInSeconds: spec.timeoutInSeconds,
      MemoryInMB: spec.memoryInMB,
      ActiveTracing: true,
      EnvironmentVariables: spec.environmentVariables,
    },
    SuccessRetentionPeriodInDays: 31,
    FailureRetentionPeriodInDays: 31,
    RuntimeVersion: spec.runtimeVersion,
    Tags: spec.tags,
  };
}

export interface CanarySyncRecord {
  canaryName: string;
  targetId: string;
  suiteHash: string;
  syncStatus: CanarySyncStatus;
  runtimeState: CanaryRuntimeState;
  lastSyncedAt: string;
  lastAwsMessage?: string;
}

/**
 * Organizes the full fleet of AWS CloudWatch Synthetics Canaries from the active
 * properties, test suites, indexed runs, and live/persisted AWS Canary sync state.
 */
export function buildFleetCanaryInventory(params: {
  apps: AppConfig[];
  suitesByAppId: Record<string, TestCaseDefinition[]>;
  runs: RunRecord[];
  templateConfig?: TemplateConfig;
  syncStateByCanaryName?: Record<string, CanarySyncRecord>;
  propertySummariesByAppId?: Record<string, PropertyGateSummary>;
  accountId?: string;
  executionRoleArn?: string;
}): ManagedSyntheticsCanary[] {
  const {
    apps,
    suitesByAppId,
    runs,
    templateConfig = DEFAULT_TEMPLATE_CONFIG,
    syncStateByCanaryName = {},
    propertySummariesByAppId = {},
    accountId = '735234585484',
    executionRoleArn,
  } = params;

  const canaries: ManagedSyntheticsCanary[] = [];

  for (const app of apps) {
    const suite = suitesByAppId[app.id] || templateConfig.testSuite;
    const regionMeta = classifyPropertyRegion(app.id);
    const propSummary =
      propertySummariesByAppId[app.id] ||
      computePropertyGateSummary({
        app,
        runs,
        rules: [],
        acceptedCookies: [],
        acceptedVisualTests: [],
        ignoreAcceptedDiffs: true,
        templateConfig,
        apps,
      });

    for (const env of app.envs) {
      const networks = env.networks && env.networks.length > 0 ? env.networks : (['staging', 'prod'] as const);
      for (const net of networks) {
        const network: 'staging' | 'prod' = net === 'staging' ? 'staging' : 'prod';
        const spec = buildAwsCanarySpecification({
          app,
          envId: env.id,
          network,
          suite,
          templateConfig,
          accountId,
          executionRoleArn,
        });

        const latestRun = runs.find((r) => r.target === spec.targetId);
        const synced = syncStateByCanaryName[spec.canaryName];

        let syncStatus: CanarySyncStatus = 'AWS_SPEC_STAGED';
        if (synced) {
          if (synced.suiteHash !== spec.suiteHash) {
            syncStatus = 'DRIFT_PENDING_SYNC';
          } else {
            syncStatus = synced.syncStatus;
          }
        }

        const totalDurationMs = latestRun
          ? latestRun.results.reduce((acc, r) => acc + (r.durationMs || 0), 0)
          : undefined;

        canaries.push({
          canaryName: spec.canaryName,
          targetId: spec.targetId,
          appId: app.id,
          appName: app.name,
          envId: env.id,
          network,
          regionCode: regionMeta.regionCode,
          popCode: regionMeta.popCode,
          awsRegion: spec.region,
          arn: spec.arn,
          runtimeVersion: spec.runtimeVersion,
          artifactS3Location: spec.artifactS3Location,
          suiteS3Key: spec.suiteS3Key,
          logGroupName: spec.logGroupName,
          executionRoleArn: spec.executionRoleArn,
          edgeHostname: spec.edgeHostname,
          edgeIp: spec.edgeIp,
          canonicalHost: spec.canonicalHost,
          checkCount: spec.checkCount,
          suiteHash: spec.suiteHash,
          runtimeState: synced?.runtimeState || 'READY',
          syncStatus,
          lastSyncedAt: synced?.lastSyncedAt,
          lastAwsMessage: synced?.lastAwsMessage,
          lastRunKey: latestRun?.key,
          lastRunAt: latestRun?.finishTime || latestRun?.startTime,
          lastRunPassed: latestRun?.passedTests,
          lastRunTotal: latestRun?.totalTests,
          lastRunFailed: latestRun?.failedTests,
          lastRunDurationMs: totalDurationMs,
          s3ManifestKey: latestRun
            ? `runs/${spec.targetId}/${latestRun.key}/manifest.json`
            : undefined,
          gateVerdict: propSummary.verdict,
          headerDiffs: propSummary.headerDiffCount,
          cookieDiffs: propSummary.cookieDiffCount,
          visualDiffs: propSummary.visualDiffCount,
          firstDiffTestId: propSummary.firstDiffTestId,
          firstDiffTab: propSummary.firstDiffTab,
          spec,
        });
      }
    }
  }

  return canaries;
}

/**
 * Pure Fan-Out Planner: selects and deduplicates the exact AWS CloudWatch Synthetics
 * Canaries to dispatch in parallel for a given orchestration scope.
 */
export function planFanOutExecution(input: FanOutPlanInput): FanOutExecutionPlan {
  const {
    scope,
    canaries,
    appId,
    regionCode,
    canaryNames,
    networks,
    maxConcurrency = 6,
  } = input;

  const netFilter =
    Array.isArray(networks) && networks.length > 0 ? new Set(networks) : null;

  let selected: ManagedSyntheticsCanary[] = [];

  if (scope === 'property-pair') {
    const cleanApp = (appId || '').toLowerCase();
    selected = canaries.filter(
      (c) => c.appId.toLowerCase() === cleanApp && c.envId === 'prod'
    );
    if (selected.length === 0) {
      selected = canaries.filter((c) => c.appId.toLowerCase() === cleanApp);
    }
  } else if (scope === 'nogo-blockers') {
    selected = canaries.filter((c) => c.gateVerdict === 'NO-GO' && c.envId === 'prod');
    if (selected.length === 0) {
      selected = canaries.filter((c) => c.gateVerdict === 'NO-GO');
    }
  } else if (scope === 'region') {
    const targetRegion = regionCode || 'GLOBAL';
    selected = canaries.filter(
      (c) => c.regionCode === targetRegion && c.envId === 'prod'
    );
  } else if (scope === 'custom') {
    const nameSet = new Set((canaryNames || []).map((n) => n.trim().toLowerCase()));
    selected = canaries.filter(
      (c) =>
        nameSet.has(c.canaryName.toLowerCase()) ||
        nameSet.has(c.targetId.toLowerCase())
    );
  } else {
    // fleet-all: primary prod env staging + prod canaries across every property
    selected = canaries.filter((c) => c.envId === 'prod');
    if (selected.length === 0) selected = [...canaries];
  }

  if (netFilter) {
    selected = selected.filter((c) => netFilter.has(c.network));
  }

  // Deduplicate by canaryName preserving stable order (staging before prod per app)
  const seen = new Set<string>();
  const uniqueTargets: FanOutExecutionPlan['targets'] = [];
  const appIdSet = new Set<string>();

  for (const c of selected) {
    if (seen.has(c.canaryName)) continue;
    seen.add(c.canaryName);
    appIdSet.add(c.appId);
    uniqueTargets.push({
      canaryName: c.canaryName,
      targetId: c.targetId,
      appId: c.appId,
      envId: c.envId,
      network: c.network,
      regionCode: c.regionCode,
      popCode: c.popCode,
    });
  }

  const boundedConcurrency = Math.max(
    1,
    Math.min(12, Math.floor(maxConcurrency || 6), Math.max(1, uniqueTargets.length))
  );

  return {
    scope,
    concurrency: boundedConcurrency,
    totalCanaries: uniqueTargets.length,
    affectedAppIds: Array.from(appIdSet),
    targets: uniqueTargets,
  };
}

/**
 * Builds the Canary Deep Dive inspection payload combining AWS Canary configuration,
 * paired comparison Canary, check-level results, historical runs, and AWS CLI commands.
 */
export function buildCanaryDeepDiveReport(params: {
  canary: ManagedSyntheticsCanary;
  allCanaries: ManagedSyntheticsCanary[];
  suite: TestCaseDefinition[];
  runs: RunRecord[];
}): CanaryDeepDiveReport {
  const { canary, allCanaries, suite, runs } = params;

  const oppositeNetwork: 'staging' | 'prod' =
    canary.network === 'staging' ? 'prod' : 'staging';
  const pairedTargetId = `${canary.appId}.${canary.envId}.${oppositeNetwork}`;
  const paired = allCanaries.find((c) => c.targetId === pairedTargetId) || null;

  const targetRuns = runs.filter((r) => r.target === canary.targetId);
  const latestRun = targetRuns[0];

  const checks = suite.map((tc) => {
    const matchedRes = latestRun?.results.find((r) => r.id === tc.id);
    return {
      id: tc.id,
      name: tc.name,
      path: tc.path,
      expectedStatus: tc.expectedStatus || '200',
      category: tc.category || 'Edge',
      testType: tc.testType || 'web-chrome',
      folderId: tc.folderId || 'folder-core',
      enabled: tc.enabled !== false,
      lastActualStatus: matchedRes?.actualStatus,
      lastPass: matchedRes?.pass,
      lastDurationMs: matchedRes?.durationMs,
      screenshotUrl: matchedRes?.screenshotUrl || null,
    };
  });

  const runHistory = targetRuns.slice(0, 15).map((r) => ({
    runKey: r.key,
    label: r.label || r.key,
    startTime: r.startTime || '',
    finishTime: r.finishTime ?? r.startTime ?? '',
    passedTests: r.passedTests,
    failedTests: r.failedTests,
    totalTests: r.totalTests,
    by: r.by,
    s3ManifestKey: `runs/${canary.targetId}/${r.key}/manifest.json`,
    executionEngine: 'aws-cloudwatch-synthetics-canary',
  }));

  return {
    canary,
    pairedCanaryName: paired?.canaryName || null,
    pairedTargetId: paired ? paired.targetId : null,
    checks,
    runHistory,
    awsCliCommands: {
      describeCanary: `aws synthetics get-canary --name ${canary.canaryName} --region ${canary.awsRegion}`,
      startCanary: `aws synthetics start-canary --name ${canary.canaryName} --region ${canary.awsRegion}`,
      getCanaryRuns: `aws synthetics get-canary-runs --name ${canary.canaryName} --max-results 10 --region ${canary.awsRegion}`,
      listS3Artifacts: `aws s3 ls ${canary.artifactS3Location} --recursive --region ${canary.awsRegion}`,
    },
    createCanaryPayloadPreview: buildAwsCreateCanaryApiPayload(canary.spec),
  };
}
