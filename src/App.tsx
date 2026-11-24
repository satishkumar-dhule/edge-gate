import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import {
  AcceptedRule,
  AppConfig,
  ComparisonKind,
  RunRecord,
  VisualDifferenceRegion,
} from './engine/types';
import { normalizeSuiteWithCatchpointDefaults } from './engine/catchpointCatalog';
import {
  DEFAULT_TEMPLATE_CONFIG,
  GLOBAL_EXECUTION_POPS,
  TemplateConfig,
  TestCaseDefinition,
  getPropertyTestSuite,
  resolveExecutionPopOption,
  resolvePropertyHostname,
} from './config/template.config';
import {
  INITIAL_RULES,
  buildInitialComparison,
  generateTestResults,
  seedRunsFromConfig,
} from './data/mockStore';
import {
  clearPersistedPortalState,
  generateEnterpriseScaleTopology,
  getInitialPortalState,
  isDummySeededRun,
  loadPersistedPortalState,
  savePersistedPortalState,
} from './adapters/syntheticsAdapter';
import { generateComparisonMarkdownSummary } from './engine/rules';
import {
  buildItemizedVisualAnalysis,
  classifyVisualVerdictFromPixelDiff,
  describeVisualDiffLogically,
  humanizeVisualSummary,
  measureBrowserImagePairPixelDiff,
  type MeasuredVisualDiffResult,
  type VisualZoneMetrics,
} from './engine/pixelDiff';
import {
  normalizeEdgeScreenshotUrl,
  preloadScreenshotUrls,
  resolveLiveScreenshotUrl,
} from './engine/domScreenshotRenderer';
import {
  ActiveRunStreamState,
  RunStreamMode,
  advanceTestStreamPhase,
  createInitialRunStreamState,
  finalizeRunStreamState,
} from './engine/runStreamEngine';
import { executeParallelConsumerBatch } from './engine/concurrencyEngine';
import { computeSuiteSreSummary } from './engine/sreIntelligence';
import {
  CommandPaletteItem,
  isEditableTarget,
  isSecretCodeEditorShortcut,
} from './engine/shortcuts';
import {
  DiffDimensionFilter,
  buildScaledTestSuite,
  filterAndPaginateDiffItems,
} from './engine/scalableViewEngine';
import {
  InspectorDimensionTab,
  WorkbenchViewMode,
  computePropertyGateSummary,
  getItemDiffCounts,
  normalizeWorkbenchViewMode,
} from './engine/workbenchModel';
import { TopBar } from './components/TopBar';
import { BackgroundJobLite, WorkbenchToolbar } from './components/WorkbenchToolbar';
import { CheckListPane } from './components/CheckListPane';
import {
  EvidenceInspectorPane,
  LiveProbeBadgeInfo,
} from './components/EvidenceInspectorPane';
import { SyntheticsOrchestratorView } from './components/SyntheticsOrchestratorView';
import { ConfigHubView, type ConfigHubSection } from './components/ConfigHubView';
import { DevStudioView, type DevStudioMode } from './components/DevStudioView';
import { QuickPalette, ShortcutsModal } from './components/QuickPalette';
import { normalizeFanOutApiResponse } from './engine/syntheticsResilience';

type AiJudgeOverride = {
  verdict: 'same' | 'minor' | 'different';
  summary: string;
  affectedArea?: string;
  shortCallout?: string;
  pixelDiffPercent?: number;
  changedBox?: { x: number; y: number; w: number; h: number } | null;
  zones?: VisualZoneMetrics | null;
  differences?: VisualDifferenceRegion[];
  costGate?: 'identical-bytes' | 'pixel-gate-passed' | 'ai-judged';
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('akamai-gate-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('akamai-gate-theme', theme);
  }, [theme]);

  const toggleTheme = () =>
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const initialPersisted = useMemo(() => loadPersistedPortalState(), []);

  const [apps, setApps] = useState<AppConfig[]>(initialPersisted.apps);
  const [customTopologyEdited, setCustomTopologyEdited] = useState<boolean>(
    Boolean(initialPersisted.customTopologyEdited)
  );
  const [suitesByAppId, setSuitesByAppId] = useState<
    Record<string, TestCaseDefinition[]>
  >(() => {
    const map: Record<string, TestCaseDefinition[]> = {};
    for (const app of initialPersisted.apps) {
      map[app.id] = normalizeSuiteWithCatchpointDefaults(
        initialPersisted.suitesByAppId?.[app.id] || getPropertyTestSuite(app.id)
      );
    }
    return map;
  });

  const [runs, setRuns] = useState<RunRecord[]>(initialPersisted.runs);
  const [acceptedRules, setAcceptedRules] = useState<AcceptedRule[]>(
    initialPersisted.acceptedRules
  );
  const [acceptedCookies, setAcceptedCookies] = useState<string[]>(
    initialPersisted.acceptedCookies
  );
  const [acceptedVisualTests, setAcceptedVisualTests] = useState<string[]>(
    initialPersisted.acceptedVisualTests
  );
  const [acceptedVisualParams, setAcceptedVisualParams] = useState<
    Record<string, string[]>
  >(initialPersisted.acceptedVisualParams || {});
  const [ignoreAcceptedDiffs, setIgnoreAcceptedDiffs] = useState<boolean>(
    initialPersisted.ignoreAcceptedDiffs
  );

  const [viewMode, setViewMode] = useState<WorkbenchViewMode>(() => {
    const restored = normalizeWorkbenchViewMode(initialPersisted.viewMode);
    return restored === 'vscode' ? 'studio' : restored;
  });
  const [activeAppId, setActiveAppId] = useState<string>(
    initialPersisted.activeAppId
  );
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [viewMode, activeAppId]);
  const [compareMode, setCompareMode] = useState<'compare' | 'single'>('compare');
  const [candidateTarget, setCandidateTarget] = useState<string>(
    initialPersisted.candidateTarget
  );
  const [baselineTarget, setBaselineTarget] = useState<string>(
    initialPersisted.baselineTarget
  );
  const [candidateRunKey, setCandidateRunKey] = useState<string>(
    initialPersisted.candidateRunKey
  );
  const [baselineRunKey, setBaselineRunKey] = useState<string>(
    initialPersisted.baselineRunKey
  );
  const [selectedRunByTarget, setSelectedRunByTarget] = useState<
    Record<string, string>
  >(initialPersisted.selectedRunByTarget);
  const [selectedTestId, setSelectedTestId] = useState<string>(
    initialPersisted.selectedTestId || 'T01'
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorDimensionTab>(
    initialPersisted.inspectorTab || 'headers'
  );

  const [selectedExecutionPopId, setSelectedExecutionPopId] = useState<string>('auto');
  const [dimensionFilter, setDimensionFilter] = useState<DiffDimensionFilter>('all');
  const [checkSearchQuery, setCheckSearchQuery] = useState<string>('');
  const [checkPage, setCheckPage] = useState<number>(1);
  const [propertySwitcherOpen, setPropertySwitcherOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [setupInitialTab, setSetupInitialTab] = useState<'suite' | 'envs'>('suite');
  const [configSection, setConfigSection] = useState<ConfigHubSection>('suite');
  const [studioMode, setStudioMode] = useState<DevStudioMode>('mcp');
  const [codeEditorUnlocked, setCodeEditorUnlocked] = useState<boolean>(false);
  const preCodeEditorViewRef = useRef<WorkbenchViewMode>('studio');

  const [runStreamState, setRunStreamState] = useState<ActiveRunStreamState | null>(
    null
  );
  const [rerunningTestId, setRerunningTestId] = useState<string | null>(null);
  const [runningAiTestId, setRunningAiTestId] = useState<string | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJobLite[]>([]);
  const [lastProbedByTestId, setLastProbedByTestId] = useState<
    Record<string, LiveProbeBadgeInfo>
  >({});
  const [aiJudgeOverrides, setAiJudgeOverrides] = useState<
    Record<string, AiJudgeOverride>
  >({});

  const activeSuite = useMemo(
    () =>
      suitesByAppId[activeAppId] ||
      normalizeSuiteWithCatchpointDefaults(getPropertyTestSuite(activeAppId)),
    [suitesByAppId, activeAppId]
  );

  const liveTemplateConfig = useMemo<TemplateConfig>(
    () => ({
      ...DEFAULT_TEMPLATE_CONFIG,
      properties: apps,
      testSuite: activeSuite,
    }),
    [apps, activeSuite]
  );

  // Sync persisted portal state
  useEffect(() => {
    savePersistedPortalState({
      ...initialPersisted,
      apps,
      customTopologyEdited,
      testSuite: activeSuite,
      suitesByAppId,
      runs,
      acceptedRules,
      acceptedCookies,
      acceptedVisualTests,
      acceptedVisualParams,
      ignoreAcceptedDiffs,
      viewMode: viewMode === 'vscode' ? 'studio' : viewMode,
      activeAppId,
      candidateTarget,
      baselineTarget,
      candidateRunKey,
      baselineRunKey,
      selectedRunByTarget,
      selectedTestId,
      inspectorTab,
    });
  }, [
    initialPersisted,
    apps,
    customTopologyEdited,
    activeSuite,
    suitesByAppId,
    runs,
    acceptedRules,
    acceptedCookies,
    acceptedVisualTests,
    acceptedVisualParams,
    ignoreAcceptedDiffs,
    viewMode,
    activeAppId,
    candidateTarget,
    baselineTarget,
    candidateRunKey,
    baselineRunKey,
    selectedRunByTarget,
    selectedTestId,
    inspectorTab,
  ]);

  // Hydrate server runs & config once on mount without blocking UI
  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/runs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.runs)) return;
        const freshServerRuns = (data.runs as RunRecord[]).filter(
          (r) => !isDummySeededRun(r)
        );
        if (freshServerRuns.length > 0) {
          setRuns((prev) => {
            const byKey = new Map(prev.map((r) => [r.key, r]));
            for (const sr of freshServerRuns) {
              byKey.set(sr.key, sr);
            }
            return Array.from(byKey.values());
          });
        }
      })
      .catch(() => undefined);

    fetch('/api/v1/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const serverConfig = data.config as TemplateConfig | undefined;
        const serverSuites = data.suitesByAppId as
          | Record<string, TestCaseDefinition[]>
          | undefined;
        if (serverSuites && Object.keys(serverSuites).length > 0) {
          setSuitesByAppId((prev) => ({ ...prev, ...serverSuites }));
        }
        if (serverConfig?.properties?.length && !customTopologyEdited) {
          setApps((prev) => {
            const prevIds = new Set(prev.map((a) => a.id));
            const additions = serverConfig.properties.filter(
              (p) => !prevIds.has(p.id)
            );
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [customTopologyEdited]);

  const refreshWorkspaceFromServer = useCallback(() => {
    fetch('/api/v1/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const serverConfig = data.config as TemplateConfig | undefined;
        const serverSuites = data.suitesByAppId as
          | Record<string, TestCaseDefinition[]>
          | undefined;
        if (serverConfig?.properties?.length) {
          setApps(serverConfig.properties);
        }
        if (serverSuites && Object.keys(serverSuites).length > 0) {
          setSuitesByAppId(serverSuites);
        }
        const serverPolicies = data.policies as
          | {
              acceptedRules?: AcceptedRule[];
              acceptedCookies?: string[];
              acceptedVisualTests?: string[];
              acceptedVisualParams?: Record<string, string[]>;
              ignoreAcceptedDiffs?: boolean;
            }
          | undefined;
        if (serverPolicies) {
          if (Array.isArray(serverPolicies.acceptedRules)) {
            setAcceptedRules(serverPolicies.acceptedRules);
          }
          if (Array.isArray(serverPolicies.acceptedCookies)) {
            setAcceptedCookies(serverPolicies.acceptedCookies);
          }
          if (Array.isArray(serverPolicies.acceptedVisualTests)) {
            setAcceptedVisualTests(serverPolicies.acceptedVisualTests);
          }
          if (
            serverPolicies.acceptedVisualParams &&
            typeof serverPolicies.acceptedVisualParams === 'object'
          ) {
            setAcceptedVisualParams(serverPolicies.acceptedVisualParams);
          }
          if (typeof serverPolicies.ignoreAcceptedDiffs === 'boolean') {
            setIgnoreAcceptedDiffs(serverPolicies.ignoreAcceptedDiffs);
          }
        }
      })
      .catch(() => undefined);

    fetch('/api/v1/runs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.runs)) return;
        const freshServerRuns = (data.runs as RunRecord[]).filter(
          (r) => !isDummySeededRun(r)
        );
        if (freshServerRuns.length > 0) {
          setRuns(freshServerRuns);
        }
      })
      .catch(() => undefined);
  }, []);

  const activeProp = useMemo(
    () => apps.find((a) => a.id === activeAppId) || apps[0],
    [apps, activeAppId]
  );

  const availableTargets = useMemo(() => {
    if (!activeProp) return [];
    const list: string[] = [];
    for (const env of activeProp.envs) {
      for (const net of env.networks || ['prod', 'staging']) {
        list.push(`${activeProp.id}.${env.id}.${net}`);
      }
    }
    return list;
  }, [activeProp]);

  const getActiveRunForTarget = (targetId: string, preferredKey?: string): RunRecord => {
    const targetRuns = runs.filter((r) => r.target === targetId);
    if (preferredKey) {
      const found = targetRuns.find((r) => r.key === preferredKey);
      if (found) return found;
    }
    const chosenKey = selectedRunByTarget[targetId];
    if (chosenKey) {
      const found = targetRuns.find((r) => r.key === chosenKey);
      if (found) return found;
    }
    if (targetRuns[0]) return targetRuns[0];

    const [aId, eId, net] = targetId.split('.');
    const suiteForProp =
      suitesByAppId[aId] ||
      normalizeSuiteWithCatchpointDefaults(getPropertyTestSuite(aId));
    return {
      key: `synthetic-${targetId}`,
      target: targetId,
      appId: aId || 'www',
      envId: eId || 'prod',
      network: net === 'staging' ? 'staging' : 'prod',
      suiteKey: `config/suites/${aId || 'www'}.csv`,
      suiteSha256: 'live-init',
      suiteRowCount: suiteForProp.length,
      startTime: new Date().toISOString(),
      finishTime: new Date().toISOString(),
      totalTests: suiteForProp.length,
      passedTests: suiteForProp.length,
      failedTests: 0,
      by: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
      label: `latest-${net || 'staging'}`,
      results: generateTestResults(
        targetId,
        net === 'staging' ? 'normal_staging' : 'normal_prod',
        suiteForProp,
        liveTemplateConfig
      ),
    };
  };

  const activeCandidateRun = getActiveRunForTarget(candidateTarget, candidateRunKey);
  const activeBaselineRun =
    compareMode === 'single'
      ? activeCandidateRun
      : getActiveRunForTarget(baselineTarget, baselineRunKey);

  const comparisonKind: ComparisonKind = useMemo(() => {
    if (
      activeCandidateRun.envId === activeBaselineRun.envId &&
      activeCandidateRun.network !== activeBaselineRun.network
    ) {
      return 'network';
    }
    return 'env';
  }, [activeCandidateRun.envId, activeCandidateRun.network, activeBaselineRun.envId, activeBaselineRun.network]);

  const comparison = useMemo(() => {
    return buildInitialComparison(
      activeCandidateRun,
      activeBaselineRun,
      comparisonKind,
      acceptedRules,
      {
        apps,
        acceptedCookies,
        acceptedVisualTests,
        ignoreAcceptedDiffs,
        aiJudgeOverrides,
      }
    );
  }, [
    activeCandidateRun,
    activeBaselineRun,
    comparisonKind,
    acceptedRules,
    apps,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    aiJudgeOverrides,
  ]);

  const sreSummary = useMemo(
    () => computeSuiteSreSummary(comparison.items),
    [comparison.items]
  );

  const filteredDiffResult = useMemo(() => {
    return filterAndPaginateDiffItems(
      comparison.items,
      {
        getUnacceptedHeaderCount: (it) =>
          getItemDiffCounts(it, ignoreAcceptedDiffs).headerDiffs,
        getUnacceptedCookieCount: (it) =>
          getItemDiffCounts(it, ignoreAcceptedDiffs).cookieDiffs,
        hasActiveVisualDiff: (it) =>
          getItemDiffCounts(it, ignoreAcceptedDiffs).hasVisualDiff,
      },
      {
        query: checkSearchQuery,
        dimension: dimensionFilter,
        sortBy: 'id',
        selectedTestId,
        page: checkPage,
        pageSize: 16,
      }
    );
  }, [
    comparison.items,
    ignoreAcceptedDiffs,
    checkSearchQuery,
    dimensionFilter,
    selectedTestId,
    checkPage,
  ]);

  const propertySummaries = useMemo(() => {
    return apps.map((app) =>
      computePropertyGateSummary({
        app,
        runs,
        rules: acceptedRules,
        acceptedCookies,
        acceptedVisualTests,
        ignoreAcceptedDiffs,
        templateConfig: liveTemplateConfig,
        aiJudgeOverrides,
        apps,
      })
    );
  }, [
    apps,
    runs,
    acceptedRules,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    liveTemplateConfig,
    aiJudgeOverrides,
  ]);

  const activeSummary = useMemo(
    () =>
      propertySummaries.find((s) => s.appId === activeAppId) ||
      propertySummaries[0],
    [propertySummaries, activeAppId]
  );

  const selectedItem =
    comparison.items.find((i) => i.testId === selectedTestId) ||
    filteredDiffResult.allFiltered[0] ||
    comparison.items[0];

  const handleSelectProperty = (
    appId: string,
    targetView: WorkbenchViewMode = 'workbench'
  ) => {
    const prop = apps.find((a) => a.id === appId);
    if (!prop) return;
    const envId = prop.envs[0]?.id || 'prod';
    const nextCand = `${prop.id}.${envId}.staging`;
    const nextBase = `${prop.id}.${envId}.prod`;
    setActiveAppId(prop.id);
    setCandidateTarget(nextCand);
    setBaselineTarget(nextBase);
    const candRun = runs.find((r) => r.target === nextCand);
    const baseRun = runs.find((r) => r.target === nextBase);
    setCandidateRunKey(candRun?.key || '');
    setBaselineRunKey(baseRun?.key || '');
    setDimensionFilter('all');
    setCheckSearchQuery('');
    setCheckPage(1);

    const summary = propertySummaries.find((s) => s.appId === prop.id);
    if (summary) {
      setSelectedTestId(summary.firstDiffTestId);
      setInspectorTab(summary.firstDiffTab);
    } else {
      setSelectedTestId('T01');
      setInspectorTab('headers');
    }
    setViewMode(targetView);
  };

  const enqueueJob = (label: string, task: () => Promise<void>) => {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setBackgroundJobs((prev) => [
      { id, label, status: 'running', progress: 'Running' },
      ...prev.slice(0, 8),
    ]);
    void (async () => {
      try {
        await task();
      } finally {
        setBackgroundJobs((prev) =>
          prev.map((j) =>
            j.id === id ? { ...j, status: 'completed', progress: 'Done' } : j
          )
        );
      }
    })();
  };

  const probeLiveCheckForRun = async (
    runRecord: RunRecord,
    testId: string
  ): Promise<Partial<RunRecord['results'][0]> | null> => {
    const targetRes = runRecord.results.find((r) => r.id === testId);
    if (!targetRes) return null;
    const popId =
      runRecord.executionPop?.id ||
      (selectedExecutionPopId !== 'auto' ? selectedExecutionPopId : undefined);
    const suiteLookup =
      suitesByAppId[runRecord.suiteAppId || runRecord.appId] || activeSuite;
    const testDef = suiteLookup.find((t) => t.id === testId);

    try {
      const resp = await fetch('/api/v1/probe/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetRes.url,
          network: runRecord.network,
          targetId: runRecord.target,
          testId,
          testName: targetRes.name,
          expectedStatus: Number(testDef?.expectedStatus || targetRes.expectedStatus || 200),
          captureScreenshot: true,
          fastStreamCapture: Number(testId.replace(/\D/g, '') || '1') <= 8,
          popId,
          suiteAppId: runRecord.suiteAppId || runRecord.appId,
          testType: testDef?.testType || targetRes.testType,
          httpMethod: testDef?.httpMethod || targetRes.httpMethod,
          requestHeaders: testDef?.requestHeaders,
          requestBody: testDef?.requestBody,
          port: testDef?.port,
          dnsRecordType: testDef?.dnsRecordType,
          dnsServer: testDef?.dnsServer,
          sslMinExpiryDays: testDef?.sslMinExpiryDays,
          bgpPrefix: testDef?.bgpPrefix,
          bgpOriginAsn: testDef?.bgpOriginAsn,
          transactionSteps: testDef?.transactionSteps,
          scriptEngine: testDef?.scriptEngine,
          customScript: testDef?.customScript,
          scriptTimeoutMs: testDef?.scriptTimeoutMs,
          assertions: testDef?.assertions,
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data || data.probed !== true) return null;
      const rev =
        typeof data.screenshotRevision === 'number'
          ? data.screenshotRevision
          : targetRes.screenshotRevision || Date.now();
      const observedStatus = Number(data.actualStatus ?? targetRes.actualStatus ?? 200);
      return {
        pass: typeof data.pass === 'boolean' ? data.pass : undefined,
        errors: Array.isArray(data.errors) ? data.errors : undefined,
        actualStatus: observedStatus,
        durationMs:
          data.durationMs ??
          data.httpFlowSummary?.totalDurationMs ??
          targetRes.durationMs,
        testType: data.testType ?? targetRes.testType,
        httpMethod: data.httpMethod ?? targetRes.httpMethod,
        requestHeadersSent: data.requestHeadersSent ?? targetRes.requestHeadersSent,
        requestBodySent: data.requestBodySent ?? targetRes.requestBodySent,
        transactionStepResults:
          Array.isArray(data.transactionStepResults)
            ? data.transactionStepResults
            : targetRes.transactionStepResults,
        scriptResult: data.scriptResult ?? targetRes.scriptResult,
        dnsResult: data.dnsResult ?? targetRes.dnsResult,
        sslResult: data.sslResult ?? targetRes.sslResult,
        networkResult: data.networkResult ?? targetRes.networkResult,
        assertionResults:
          Array.isArray(data.assertionResults)
            ? data.assertionResults
            : targetRes.assertionResults,
        responseBodySnippet: data.responseBodySnippet ?? targetRes.responseBodySnippet,
        redirectChain:
          Array.isArray(data.redirectChain) && data.redirectChain.length > 0
            ? data.redirectChain
            : targetRes.redirectChain,
        httpFlowSummary: data.httpFlowSummary ?? targetRes.httpFlowSummary,
        capturedHeaders:
          data.capturedHeaders && Object.keys(data.capturedHeaders).length > 0
            ? { ...targetRes.capturedHeaders, ...data.capturedHeaders }
            : targetRes.capturedHeaders,
        capturedCookies:
          data.capturedCookies && Object.keys(data.capturedCookies).length > 0
            ? { ...targetRes.capturedCookies, ...data.capturedCookies }
            : targetRes.capturedCookies,
        probedAt: data.probedAt || new Date().toISOString(),
        probeCount: data.probeCount,
        screenshotRevision: rev,
        screenshotCapturedAt:
          data.screenshotCapturedAt || new Date(rev).toISOString(),
        screenshotSha256: data.screenshotSha256 || undefined,
        screenshotBytes:
          typeof data.screenshotBytes === 'number' && data.screenshotBytes > 0
            ? data.screenshotBytes
            : targetRes.screenshotBytes || 18420,
        screenshotUrl:
          typeof data.screenshotUrl === 'string' && data.screenshotUrl
            ? data.screenshotUrl
            : resolveLiveScreenshotUrl({
                appId: runRecord.suiteAppId || runRecord.appId,
                testId,
                testName: targetRes.name,
                url: targetRes.canonicalUrl || targetRes.url,
                side: runRecord.network === 'staging' ? 'A' : 'B',
                httpStatus: observedStatus,
                revision: rev,
              }),
        screenshotCaptured:
          typeof data.screenshotCaptured === 'boolean'
            ? data.screenshotCaptured
            : observedStatus < 400,
        pixelDiffPercent:
          typeof data.pixelDiffPercent === 'number'
            ? data.pixelDiffPercent
            : targetRes.pixelDiffPercent,
      };
    } catch {
      return null;
    }
  };

  const applyProbeToResult = (
    res: RunRecord['results'][0],
    probe: Partial<RunRecord['results'][0]> | null,
    nowStr: string
  ): RunRecord['results'][0] => {
    const nextDuration =
      probe?.durationMs ??
      probe?.httpFlowSummary?.totalDurationMs ??
      res.durationMs;
    const nextStatus = probe?.actualStatus ?? res.actualStatus;
    const expected = Number(res.expectedStatus || 200);
    const nextPass =
      typeof probe?.pass === 'boolean' ? probe.pass : nextStatus === expected;
    const nextErrors = Array.isArray(probe?.errors)
      ? probe.errors
      : nextPass
      ? []
      : res.errors;
    const nextRev = probe?.screenshotRevision || res.screenshotRevision || Date.now();
    const effectiveSide: 'A' | 'B' = (res.edgeHostname || '').includes('staging')
      ? 'A'
      : 'B';

    return {
      ...res,
      actualStatus: nextStatus,
      pass: nextPass,
      errors: nextErrors,
      durationMs: nextDuration,
      testType: probe?.testType ?? res.testType,
      httpMethod: probe?.httpMethod ?? res.httpMethod,
      requestHeadersSent: probe?.requestHeadersSent ?? res.requestHeadersSent,
      requestBodySent: probe?.requestBodySent ?? res.requestBodySent,
      transactionStepResults: probe?.transactionStepResults ?? res.transactionStepResults,
      scriptResult: probe?.scriptResult ?? res.scriptResult,
      dnsResult: probe?.dnsResult ?? res.dnsResult,
      sslResult: probe?.sslResult ?? res.sslResult,
      networkResult: probe?.networkResult ?? res.networkResult,
      assertionResults: probe?.assertionResults ?? res.assertionResults,
      responseBodySnippet: probe?.responseBodySnippet ?? res.responseBodySnippet,
      redirectChain:
        probe?.redirectChain && probe.redirectChain.length > 0
          ? probe.redirectChain
          : res.redirectChain,
      httpFlowSummary: probe?.httpFlowSummary ?? res.httpFlowSummary,
      capturedHeaders: probe?.capturedHeaders ?? res.capturedHeaders,
      capturedCookies: probe?.capturedCookies ?? res.capturedCookies,
      probedAt: probe?.probedAt || new Date().toISOString(),
      probeCount: (res.probeCount || 0) + 1,
      screenshotRevision: nextRev,
      screenshotUrl:
        probe?.screenshotUrl ||
        res.screenshotUrl ||
        resolveLiveScreenshotUrl({
          testId: res.id,
          testName: res.name,
          url: res.canonicalUrl || res.url,
          side: effectiveSide,
          httpStatus: nextStatus,
          revision: nextRev,
        }),
      screenshotCaptured:
        typeof probe?.screenshotCaptured === 'boolean'
          ? probe.screenshotCaptured
          : res.screenshotCaptured ?? true,
      pixelDiffPercent: probe?.pixelDiffPercent ?? res.pixelDiffPercent,
      note: `Live probe (${nextStatus}) verified at ${nowStr}`,
    };
  };

  const evaluateCheckAiVisualOpinion = async (params: {
    candRun: RunRecord;
    baseRun: RunRecord;
    testId: string;
  }) => {
    const { candRun, baseRun, testId } = params;
    const candRes = candRun.results.find((r) => r.id === testId);
    const baseRes = baseRun.results.find((r) => r.id === testId);
    const candStatus = candRes?.actualStatus ?? 200;
    const baseStatus = baseRes?.actualStatus ?? 200;
    const hasHttpStatusFailure =
      (candStatus >= 400 || baseStatus >= 400) && candStatus !== baseStatus;
    const testName = candRes?.name || baseRes?.name || testId;
    const pageUrl = candRes?.canonicalUrl || candRes?.url || 'https://www.salesforce.com/';

    const rawUrlA =
      candRes?.screenshotUrl ||
      resolveLiveScreenshotUrl({
        appId: candRun.appId,
        testId,
        testName,
        url: pageUrl,
        side: 'A',
        httpStatus: candStatus,
        revision: candRes?.screenshotRevision,
      });
    const rawUrlB =
      baseRes?.screenshotUrl ||
      resolveLiveScreenshotUrl({
        appId: baseRun.appId,
        testId,
        testName,
        url: baseRes?.canonicalUrl || pageUrl,
        side: 'B',
        httpStatus: baseStatus,
        revision: baseRes?.screenshotRevision,
      });
    const urlA = normalizeEdgeScreenshotUrl(rawUrlA);
    const urlB = normalizeEdgeScreenshotUrl(rawUrlB);

    const browserDiff =
      candRun.key !== baseRun.key
        ? await measureBrowserImagePairPixelDiff(urlA, urlB)
        : null;
    const measuredPixelDiff =
      browserDiff && typeof browserDiff.pixelDiffPercent === 'number'
        ? browserDiff.pixelDiffPercent
        : candRes?.pixelDiffPercent ?? (hasHttpStatusFailure ? 94.8 : 0);
    const resolvedChangedBox =
      browserDiff?.changedBox ?? candRes?.changedBox ?? null;
    const resolvedZones =
      browserDiff?.zones ?? candRes?.zones ?? null;

    let apiData: Record<string, unknown> | null = null;
    try {
      const res = await fetch('/api/v1/judge/nova-lite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId,
          testName,
          url: pageUrl,
          candidateTarget: candRun.target,
          baselineTarget: baseRun.target,
          candidateStatus: candStatus,
          baselineStatus: baseStatus,
          pixelDiffPercent: measuredPixelDiff,
          changedBox: resolvedChangedBox,
          zones: resolvedZones,
          forceAiCompare: true,
        }),
      });
      if (res.ok) apiData = await res.json();
    } catch {
      // Deterministic zone fallback below
    }

    const finalPixelDiff = hasHttpStatusFailure
      ? Math.max(measuredPixelDiff, 94.8)
      : browserDiff && typeof browserDiff.pixelDiffPercent === 'number'
      ? browserDiff.pixelDiffPercent
      : typeof apiData?.pixelDiffPercent === 'number'
      ? apiData.pixelDiffPercent
      : measuredPixelDiff;

    const rawVerdict = (apiData?.verdict as 'same' | 'minor' | 'different' | undefined) ||
      classifyVisualVerdictFromPixelDiff(finalPixelDiff);
    const finalVerdict: 'same' | 'minor' | 'different' = hasHttpStatusFailure
      ? 'different'
      : finalPixelDiff <= 0.1
      ? 'same'
      : finalPixelDiff > 0.1 && rawVerdict === 'same'
      ? classifyVisualVerdictFromPixelDiff(finalPixelDiff)
      : rawVerdict;

    const candHeaderCount = Object.keys(candRes?.capturedHeaders || {}).length;
    const baseHeaderCount = Object.keys(baseRes?.capturedHeaders || {}).length;
    const candCookieKeys = Object.keys(candRes?.capturedCookies || {});
    const baseCookieKeys = Object.keys(baseRes?.capturedCookies || {});
    const cookieDiffCountEstimate = new Set([
      ...candCookieKeys.filter(
        (k) => candRes?.capturedCookies?.[k] !== baseRes?.capturedCookies?.[k]
      ),
      ...baseCookieKeys.filter(
        (k) => candRes?.capturedCookies?.[k] !== baseRes?.capturedCookies?.[k]
      ),
    ]).size;

    const logicalInput = {
      pixelDiffPercent: finalPixelDiff,
      changedBox: resolvedChangedBox,
      zones: resolvedZones,
      candidateLabel: candRun.network,
      baselineLabel: baseRun.network,
      candidateStatus: candStatus,
      baselineStatus: baseStatus,
      pageName: testName,
      url: pageUrl,
      testType: candRes?.testType || baseRes?.testType,
      functionalDiffSummary:
        candRun.key !== baseRun.key && candHeaderCount !== baseHeaderCount
          ? `headers (${candHeaderCount} vs ${baseHeaderCount})`
          : undefined,
      cookieDiffCount: candRun.key !== baseRun.key ? cookieDiffCountEstimate : 0,
    };
    const logical = describeVisualDiffLogically(logicalInput);
    const itemized = buildItemizedVisualAnalysis(logicalInput);

    const summary = humanizeVisualSummary(
      typeof apiData?.summary === 'string' ? apiData.summary : '',
      logicalInput
    );

    const apiDifferences = Array.isArray(apiData?.differences)
      ? (apiData.differences as Array<Record<string, unknown>>)
      : [];
    // When browser `<canvas>` measured genuine 5-zone RGBA metrics, prefer `itemized` unless API returned multimodal differences that respect rightPanelPct
    const apiHasFalseRightSidebar =
      resolvedZones &&
      resolvedZones.rightPanelPct < 2 &&
      apiDifferences.some(
        (d) =>
          String(d.id || '').includes('right') &&
          (String(d.severity || '').toLowerCase() === 'major' ||
            String(d.severity || '').toLowerCase() === 'different')
      );

    const mergedDifferences: VisualDifferenceRegion[] =
      apiDifferences.length >= 3 && !apiHasFalseRightSidebar && !resolvedZones
        ? apiDifferences.map((d, idx) => {
            const fallbackZone = itemized[idx] || itemized[0];
            const rawSev = String(d.severity || '').toLowerCase();
            const sev: 'major' | 'minor' | 'match' =
              rawSev === 'different' || rawSev === 'major' || rawSev === 'critical'
                ? 'major'
                : rawSev === 'minor'
                ? 'minor'
                : rawSev === 'match'
                ? 'match'
                : fallbackZone?.severity || 'minor';
            return {
              id: typeof d.id === 'string' ? d.id : fallbackZone?.id || `zone-${idx + 1}`,
              region:
                typeof d.region === 'string' && d.region
                  ? d.region
                  : fallbackZone?.region || `Viewport Zone ${idx + 1}`,
              description:
                typeof d.description === 'string' && d.description
                  ? d.description
                  : fallbackZone?.description || logical.shortCallout,
              severity: sev,
              stagingObservation:
                typeof d.stagingObservation === 'string' && d.stagingObservation
                  ? d.stagingObservation
                  : fallbackZone?.stagingObservation,
              prodObservation:
                typeof d.prodObservation === 'string' && d.prodObservation
                  ? d.prodObservation
                  : fallbackZone?.prodObservation,
              impact:
                typeof d.impact === 'string' && d.impact
                  ? d.impact
                  : fallbackZone?.impact,
              zoneDeltaPct:
                typeof d.zoneDeltaPct === 'number'
                  ? d.zoneDeltaPct
                  : fallbackZone?.zoneDeltaPct,
              box:
                d.box && typeof d.box === 'object'
                  ? (d.box as { x: number; y: number; w: number; h: number })
                  : fallbackZone?.box,
            };
          })
        : itemized;

    const nextOverride: AiJudgeOverride = {
      verdict: finalVerdict,
      summary,
      affectedArea:
        resolvedZones || !apiData?.affectedArea
          ? logical.affectedArea
          : typeof apiData?.affectedArea === 'string'
          ? apiData.affectedArea
          : logical.affectedArea,
      shortCallout:
        resolvedZones || !apiData?.shortCallout
          ? logical.shortCallout
          : typeof apiData?.shortCallout === 'string'
          ? apiData.shortCallout
          : logical.shortCallout,
      pixelDiffPercent: finalPixelDiff,
      changedBox: resolvedChangedBox,
      zones: resolvedZones,
      differences: mergedDifferences,
      costGate:
        finalPixelDiff <= 0.1 && finalVerdict === 'same' && !hasHttpStatusFailure
          ? 'identical-bytes'
          : 'ai-judged',
    };

    setAiJudgeOverrides((prev) => ({
      ...prev,
      [`${candRun.appId}-${testId}`]: nextOverride,
      [testId]: nextOverride,
    }));

    return nextOverride;
  };

  const evaluatedPairsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (compareMode !== 'compare' || activeCandidateRun.key === activeBaselineRun.key) {
      return;
    }
    const pairPrefix = `${activeCandidateRun.key}::${activeBaselineRun.key}::${activeCandidateRun.appId}`;
    const checksToEvaluate = activeCandidateRun.results
      .map((r) => r.id)
      .filter((id) => !evaluatedPairsRef.current.has(`${pairPrefix}::${id}`));
    if (checksToEvaluate.length === 0) return;

    let cancelled = false;
    // Prioritize selectedTestId first so the active Visual AI tab updates immediately
    const ordered = [
      selectedTestId,
      ...checksToEvaluate.filter((id) => id !== selectedTestId),
    ].filter((id, idx, arr) => checksToEvaluate.includes(id) && arr.indexOf(id) === idx);

    void (async () => {
      for (const id of ordered) {
        if (cancelled) break;
        await evaluateCheckAiVisualOpinion({
          candRun: activeCandidateRun,
          baseRun: activeBaselineRun,
          testId: id,
        });
        if (!cancelled) {
          evaluatedPairsRef.current.add(`${pairPrefix}::${id}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    compareMode,
    activeCandidateRun,
    activeBaselineRun,
    selectedTestId,
    inspectorTab,
  ]);

  const streamExecuteChecks = async (params: {
    mode: RunStreamMode;
    runA: RunRecord;
    runB: RunRecord;
    checks: ReadonlyArray<{ id: string; name: string }>;
    suiteAppId: string;
  }) => {
    const { mode, runA, runB, checks, suiteAppId } = params;
    let currentRunA = runA;
    let currentRunB = runB;
    const maxConcurrency = Math.min(4, Math.max(1, checks.length));
    const nowStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    setRunStreamState(
      createInitialRunStreamState({
        mode,
        runKeyA: runA.key,
        runKeyB: runB.key,
        targetA: runA.target,
        targetB: runB.target,
        suiteAppId,
        checks,
        maxConcurrency,
      })
    );

    try {
      await executeParallelConsumerBatch({
        items: checks,
        concurrency: maxConcurrency,
        queueName: 'release-gate-stream',
        getJobId: (chk) => chk.id,
        getLabel: (chk) => `${chk.id} ${chk.name}`,
        worker: async (chk, ctx) => {
          setRunStreamState((prev) =>
            prev
              ? advanceTestStreamPhase(prev, chk.id, 'probing-http', {
                  workerId: ctx.workerId,
                  workerLabel: ctx.workerLabel,
                })
              : prev
          );

          const [probeA, probeB] = await Promise.all([
            probeLiveCheckForRun(runA, chk.id),
            runB.key !== runA.key
              ? probeLiveCheckForRun(runB, chk.id)
              : Promise.resolve(null),
          ]);

          setRunStreamState((prev) =>
            prev
              ? advanceTestStreamPhase(prev, chk.id, 'capturing-screenshot', {
                  httpDone: true,
                  workerId: ctx.workerId,
                  workerLabel: ctx.workerLabel,
                })
              : prev
          );

          const origCand = currentRunA.results.find((r) => r.id === chk.id);
          const origBase = currentRunB.results.find((r) => r.id === chk.id);
          const updatedCand = origCand
            ? applyProbeToResult(origCand, probeA, nowStr)
            : undefined;
          const updatedBase = origBase
            ? applyProbeToResult(
                origBase,
                runB.key !== runA.key ? probeB : probeA,
                nowStr
              )
            : undefined;

          if (updatedCand) {
            const nextResults = currentRunA.results.map((r) =>
              r.id === chk.id ? updatedCand : r
            );
            currentRunA = {
              ...currentRunA,
              results: nextResults,
              passedTests: nextResults.filter((r) => r.pass).length,
              failedTests: nextResults.filter((r) => !r.pass).length,
            };
          }
          if (updatedBase) {
            const nextResults = currentRunB.results.map((r) =>
              r.id === chk.id ? updatedBase : r
            );
            currentRunB = {
              ...currentRunB,
              results: nextResults,
              passedTests: nextResults.filter((r) => r.pass).length,
              failedTests: nextResults.filter((r) => !r.pass).length,
            };
          }

          setRuns((prev) =>
            prev.map((run) => {
              if (run.key === runA.key && updatedCand) {
                const nextResults = run.results.map((r) =>
                  r.id === chk.id ? updatedCand : r
                );
                return {
                  ...run,
                  results: nextResults,
                  passedTests: nextResults.filter((r) => r.pass).length,
                  failedTests: nextResults.filter((r) => !r.pass).length,
                };
              }
              if (run.key === runB.key && updatedBase) {
                const nextResults = run.results.map((r) =>
                  r.id === chk.id ? updatedBase : r
                );
                return {
                  ...run,
                  results: nextResults,
                  passedTests: nextResults.filter((r) => r.pass).length,
                  failedTests: nextResults.filter((r) => !r.pass).length,
                };
              }
              return run;
            })
          );

          setRunStreamState((prev) =>
            prev
              ? advanceTestStreamPhase(prev, chk.id, 'judging-ai', {
                  httpDone: true,
                  screenshotCaptured: true,
                  workerId: ctx.workerId,
                  workerLabel: ctx.workerLabel,
                })
              : prev
          );

          const aiOpinion = await evaluateCheckAiVisualOpinion({
            candRun: currentRunA,
            baseRun: currentRunB,
            testId: chk.id,
          });

          setLastProbedByTestId((prev) => ({
            ...prev,
            [chk.id]: {
              at: nowStr,
              count: (prev[chk.id]?.count || 0) + 1,
              candMs: updatedCand?.durationMs ?? 80,
              baseMs: updatedBase?.durationMs,
              status: updatedCand?.actualStatus ?? 200,
              screenshotRevision: updatedCand?.screenshotRevision,
              screenshotUrl: updatedCand?.screenshotUrl,
              aiJudged: true,
              aiVerdict: aiOpinion.verdict,
              aiAffectedArea: aiOpinion.affectedArea,
              aiShortCallout: aiOpinion.shortCallout,
              aiSummary: aiOpinion.summary,
            },
          }));

          setRunStreamState((prev) =>
            prev
              ? advanceTestStreamPhase(prev, chk.id, 'completed', {
                  httpDone: true,
                  screenshotCaptured: true,
                  aiJudged: true,
                  aiVerdict: aiOpinion.verdict,
                  candLatencyMs: updatedCand?.durationMs,
                  baseLatencyMs: updatedBase?.durationMs,
                  httpStatus: updatedCand?.actualStatus,
                  workerId: ctx.workerId,
                  workerLabel: ctx.workerLabel,
                })
              : prev
          );
        },
      });
    } finally {
      setRunStreamState((prev) => (prev ? finalizeRunStreamState(prev) : prev));
    }
  };

  const createFreshRunRecord = (targetId: string, labelPrefix: string): RunRecord => {
    const [appId, envId, net] = targetId.split('.');
    const network = net === 'staging' ? 'staging' : 'prod';
    const popOpt = resolveExecutionPopOption(selectedExecutionPopId);
    const suite =
      suitesByAppId[appId] ||
      normalizeSuiteWithCatchpointDefaults(getPropertyTestSuite(appId));
    const count = runs.filter((r) => r.target === targetId).length + 1;
    const nowStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const results = generateTestResults(
      targetId,
      network === 'staging' ? 'normal_staging' : 'normal_prod',
      suite,
      liveTemplateConfig,
      popOpt?.id
    );
    return {
      key: `run-${targetId.replace(/\./g, '-')}-${count}-${Date.now().toString().slice(-4)}`,
      target: targetId,
      appId: appId || 'www',
      envId: envId || 'prod',
      network,
      suiteKey: `config/suites/${appId}.csv`,
      suiteAppId: appId,
      executionPop: popOpt
        ? {
            id: popOpt.id,
            popCode: popOpt.popCode,
            regionLabel: popOpt.regionGroup,
            awsRegion: popOpt.awsRegion,
            stagingPopCode: popOpt.popCode,
            prodPopCode: popOpt.popCode,
            stagingEdgeIp: popOpt.stagingEdgeIp,
            prodEdgeIp: popOpt.prodEdgeIp,
          }
        : undefined,
      suiteSha256: 'live-run',
      suiteRowCount: results.length,
      startTime: new Date().toISOString(),
      finishTime: new Date().toISOString(),
      totalTests: results.length,
      passedTests: results.filter((r) => r.pass).length,
      failedTests: results.filter((r) => !r.pass).length,
      by: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
      label: `${labelPrefix} #${count} · ${nowStr}`,
      results,
    };
  };

  const handleRunLiveGate = (overrideAppId?: string) => {
    const targetAppId = overrideAppId || activeAppId;
    const prop = apps.find((a) => a.id === targetAppId) || activeProp;
    if (!prop) return;
    const envId = prop.envs[0]?.id || 'prod';
    const tA =
      overrideAppId || candidateTarget.split('.')[0] !== targetAppId
        ? `${prop.id}.${envId}.staging`
        : candidateTarget;
    const tB =
      overrideAppId || baselineTarget.split('.')[0] !== targetAppId
        ? `${prop.id}.${envId}.prod`
        : baselineTarget;

    if (overrideAppId) {
      setActiveAppId(prop.id);
      setViewMode('workbench');
    }

    const runA = createFreshRunRecord(tA, 'live-stg');
    const runB = compareMode === 'single' ? runA : createFreshRunRecord(tB, 'live-prd');

    setRuns((prev) =>
      compareMode === 'single' ? [runA, ...prev] : [runA, runB, ...prev]
    );
    setSelectedRunByTarget((prev) => ({
      ...prev,
      [tA]: runA.key,
      ...(compareMode === 'compare' ? { [tB]: runB.key } : {}),
    }));
    setCandidateTarget(tA);
    setBaselineTarget(tB);
    setCandidateRunKey(runA.key);
    setBaselineRunKey(runB.key);

    const checks = runA.results.map((r) => ({ id: r.id, name: r.name }));
    enqueueJob(`Live Gate: ${tA} ↔ ${tB}`, async () => {
      await streamExecuteChecks({
        mode: compareMode === 'single' ? 'single-run' : 'compare',
        runA,
        runB,
        checks,
        suiteAppId: prop.id,
      });
      toast.success(`Live Gate verified ${checks.length} checks for ${prop.id}`);
    });
  };

  const handleRerunSingleCheck = (testId: string) => {
    setRerunningTestId(testId);
    const res = activeCandidateRun.results.find((r) => r.id === testId);
    enqueueJob(`Re-run ${testId}`, async () => {
      try {
        await streamExecuteChecks({
          mode: 'rerun-single',
          runA: activeCandidateRun,
          runB: activeBaselineRun,
          checks: [{ id: testId, name: res?.name || testId }],
          suiteAppId: activeAppId,
        });
        toast.success(`Updated live HTTP flow & screenshot for ${testId}`);
      } finally {
        setRerunningTestId(null);
      }
    });
  };

  const handleRerunAllDiffs = () => {
    const diffChecks = comparison.items
      .filter((it) => getItemDiffCounts(it, ignoreAcceptedDiffs).hasAny)
      .map((it) => ({ id: it.testId, name: it.testName }));
    const targetChecks =
      diffChecks.length > 0
        ? diffChecks
        : comparison.items.map((it) => ({ id: it.testId, name: it.testName }));
    setRerunningTestId('ALL');
    enqueueJob(`Re-run ${targetChecks.length} checks`, async () => {
      try {
        await streamExecuteChecks({
          mode: 'rerun-diffs',
          runA: activeCandidateRun,
          runB: activeBaselineRun,
          checks: targetChecks,
          suiteAppId: activeAppId,
        });
        toast.success(`Re-ran ${targetChecks.length} checks on ${activeAppId}`);
      } finally {
        setRerunningTestId(null);
      }
    });
  };

  const handleRunAiJudge = (testId: string) => {
    setRunningAiTestId(testId);
    enqueueJob(`AI Visual Judge (${testId})`, async () => {
      try {
        const opinion = await evaluateCheckAiVisualOpinion({
          candRun: activeCandidateRun,
          baseRun: activeBaselineRun,
          testId,
        });
        toast.success(
          `Visual Judge (${opinion.verdict.toUpperCase()}): ${opinion.shortCallout}`
        );
      } finally {
        setRunningAiTestId(null);
      }
    });
  };

  const handleToggleAcceptHeader = (field: string) => {
    const existing = acceptedRules.find(
      (r) => r.kind.toLowerCase() === field.toLowerCase()
    );
    if (existing) {
      setAcceptedRules((prev) =>
        prev.filter((r) => r.kind.toLowerCase() !== field.toLowerCase())
      );
      toast.info(`Removed accepted rule: ${field}`);
    } else {
      const rule: AcceptedRule = {
        id: `rule-${Date.now()}`,
        appId: activeAppId,
        comparisonId: 'all',
        kind: field.toLowerCase(),
        enabled: true,
        by: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
        at: new Date().toISOString(),
      };
      setAcceptedRules((prev) => [...prev, rule]);
      toast.success(`Accepted header drift: ${field}`);
    }
  };

  const handleToggleAcceptCookie = (cookieName: string) => {
    const key = cookieName.toLowerCase().replace(/^cookie:/, '').trim();
    setAcceptedCookies((prev) => {
      if (prev.includes(key)) {
        toast.info(`Removed cookie allowlist: ${key}`);
        return prev.filter((c) => c !== key);
      }
      toast.success(`Allowlisted cookie: ${key}`);
      return [...prev, key];
    });
  };

  const handleToggleAcceptVisual = (testId: string, driftingParamIds?: string[]) => {
    const paramKey = `${activeAppId}:${testId}`;
    const isCurrentlyAccepted = acceptedVisualTests.includes(testId);
    if (isCurrentlyAccepted) {
      setAcceptedVisualTests((prev) => prev.filter((id) => id !== testId));
      setAcceptedVisualParams((prev) => {
        const next = { ...prev };
        delete next[paramKey];
        return next;
      });
      toast.info(`Reverted visual acceptance for ${testId}`);
    } else {
      setAcceptedVisualTests((prev) => (prev.includes(testId) ? prev : [...prev, testId]));
      if (driftingParamIds && driftingParamIds.length > 0) {
        setAcceptedVisualParams((prev) => ({
          ...prev,
          [paramKey]: Array.from(new Set(driftingParamIds)),
        }));
      }
      toast.success(`Accepted visual diff for ${testId}`);
    }
  };

  const handleToggleAcceptVisualParam = (
    testId: string,
    paramId: string,
    allDriftingParamIds: string[]
  ) => {
    const paramKey = `${activeAppId}:${testId}`;
    const wasTestAccepted = acceptedVisualTests.includes(testId);
    const currentList = wasTestAccepted
      ? Array.from(new Set([...(acceptedVisualParams[paramKey] || []), ...allDriftingParamIds]))
      : acceptedVisualParams[paramKey] || [];
    const alreadyAccepted = currentList.includes(paramId);

    const nextList = alreadyAccepted
      ? currentList.filter((id) => id !== paramId)
      : [...currentList, paramId];

    setAcceptedVisualParams((prev) => ({
      ...prev,
      [paramKey]: nextList,
    }));

    const allAcceptedNow =
      allDriftingParamIds.length > 0 &&
      allDriftingParamIds.every((id) => nextList.includes(id));

    if (allAcceptedNow) {
      setAcceptedVisualTests((prev) => (prev.includes(testId) ? prev : [...prev, testId]));
      toast.success(`Accepted parameter (${testId}) — all visual diffs accepted`);
    } else {
      setAcceptedVisualTests((prev) => prev.filter((id) => id !== testId));
      if (alreadyAccepted) {
        toast.info(`Undid acceptance for visual parameter on ${testId}`);
      } else {
        toast.success(`Accepted visual parameter on ${testId}`);
      }
    }
  };

  const handleMeasuredVisualDiff = useCallback(
    (testId: string, measured: MeasuredVisualDiffResult) => {
      if (compareMode !== 'compare') return;
      const key = `${activeCandidateRun.key}|${activeBaselineRun.key}|${testId}`;
      const existing = aiJudgeOverrides[key];
      const itemRef = comparison.items.find((i) => i.testId === testId);
      const currentPct =
        existing?.pixelDiffPercent ??
        itemRef?.visualResult?.pixelDiffPercent ??
        itemRef?.candidateResult?.pixelDiffPercent ??
        0;

      // Only update when the real browser canvas pixel diff materially disagrees with stored metadata
      if (Math.abs(currentPct - measured.pixelDiffPercent) < 0.4) return;

      const logical = describeVisualDiffLogically({
        pixelDiffPercent: measured.pixelDiffPercent,
        changedBox: measured.changedBox,
        zones: measured.zones,
        candidateLabel: activeCandidateRun.label || candidateTarget,
        baselineLabel: activeBaselineRun.label || baselineTarget,
        pageName: itemRef?.testName || testId,
        url: itemRef?.url || '',
        candidateStatus: itemRef?.candidateResult?.actualStatus,
        baselineStatus: itemRef?.baselineResult?.actualStatus,
      });

      const findings = buildItemizedVisualAnalysis({
        pixelDiffPercent: measured.pixelDiffPercent,
        changedBox: measured.changedBox,
        zones: measured.zones,
        candidateLabel: activeCandidateRun.label || candidateTarget,
        baselineLabel: activeBaselineRun.label || baselineTarget,
        pageName: itemRef?.testName || testId,
        url: itemRef?.url || '',
        candidateStatus: itemRef?.candidateResult?.actualStatus,
        baselineStatus: itemRef?.baselineResult?.actualStatus,
        testType: itemRef?.candidateResult?.testType,
        cookieDiffCount: (itemRef?.cookieDiffs || []).length,
      });

      setAiJudgeOverrides((prev) => ({
        ...prev,
        [key]: {
          verdict: logical.verdict,
          affectedArea: logical.affectedArea,
          shortCallout: logical.shortCallout,
          summary: logical.summary,
          pixelDiffPercent: measured.pixelDiffPercent,
          changedBox: measured.changedBox,
          zones: measured.zones ?? null,
          differences: findings,
          costGate: measured.pixelDiffPercent <= 0.1 ? 'pixel-gate-passed' : 'ai-judged',
        },
      }));
    },
    [
      compareMode,
      activeCandidateRun.key,
      activeCandidateRun.label,
      activeBaselineRun.key,
      activeBaselineRun.label,
      candidateTarget,
      baselineTarget,
      aiJudgeOverrides,
      comparison.items,
    ]
  );

  const handleTogglePropScale = () => {
    if (apps.length >= 50) {
      const fresh = getInitialPortalState();
      setApps(fresh.apps);
      setRuns(fresh.runs);
      setCustomTopologyEdited(false);
      setActiveAppId('www');
      setCandidateTarget('www.prod.staging');
      setBaselineTarget('www.prod.prod');
      toast.info('Restored 14 core properties');
    } else {
      const scaled = generateEnterpriseScaleTopology(50, DEFAULT_TEMPLATE_CONFIG);
      setApps(scaled.apps);
      setRuns((prev) => [...prev, ...scaled.runs.filter((r) => !prev.some((p) => p.key === r.key))]);
      toast.success(`Loaded ${scaled.apps.length} global properties`);
    }
  };

  const handleToggleSuiteScale = () => {
    const baseSuite = normalizeSuiteWithCatchpointDefaults(
      getPropertyTestSuite(activeAppId)
    );
    const nextSuite =
      activeSuite.length >= 64
        ? baseSuite
        : normalizeSuiteWithCatchpointDefaults(
            buildScaledTestSuite(activeSuite, 64)
          );
    handleSaveSuiteForApp(activeAppId, nextSuite);
    setCheckPage(1);
  };

  const handleSaveSuiteForApp = (appId: string, nextSuiteRaw: TestCaseDefinition[]) => {
    const normalized = normalizeSuiteWithCatchpointDefaults(nextSuiteRaw);
    setSuitesByAppId((prev) => ({ ...prev, [appId]: normalized }));
    setRuns((prev) =>
      prev.map((run) => {
        if (run.appId !== appId && run.suiteAppId !== appId) return run;
        const freshResults = generateTestResults(
          run.target,
          run.network === 'staging' ? 'normal_staging' : 'normal_prod',
          normalized,
          liveTemplateConfig
        );
        return {
          ...run,
          suiteRowCount: freshResults.length,
          totalTests: freshResults.length,
          passedTests: freshResults.filter((r) => r.pass).length,
          failedTests: freshResults.filter((r) => !r.pass).length,
          results: freshResults,
        };
      })
    );
    fetch(`/api/v1/suites/${encodeURIComponent(appId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: normalized }),
    }).catch(() => undefined);
    toast.success(`Saved & synced ${normalized.length} checks to AWS CloudWatch Synthetics (${appId})`);
  };

  const handleIngestSyntheticsRuns = (newRuns: RunRecord[]) => {
    if (!Array.isArray(newRuns) || newRuns.length === 0) return;
    const newKeys = new Set(newRuns.map((r) => r.key));
    setRuns((prev) => [...newRuns, ...prev.filter((r) => !newKeys.has(r.key))]);
    setSelectedRunByTarget((prev) => {
      const next = { ...prev };
      for (const r of newRuns) {
        next[r.target] = r.key;
      }
      return next;
    });
    const candMatch = newRuns.find((r) => r.target === candidateTarget);
    if (candMatch) setCandidateRunKey(candMatch.key);
    const baseMatch = newRuns.find((r) => r.target === baselineTarget);
    if (baseMatch) setBaselineRunKey(baseMatch.key);
  };

  const handleFanOutSyntheticsScope = (
    scope: 'nogo-blockers' | 'fleet-all' | 'property-pair',
    label: string,
    appId?: string
  ) => {
    enqueueJob(`AWS Synthetics Fan-Out: ${label}`, async () => {
      const res = await fetch('/api/v1/synthetics/fan-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, appId, concurrency: 6 }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || `Fan-out failed (HTTP ${res.status})`);
        return;
      }
      const rawData = (await res.json()) as Record<string, unknown>;
      const normalized = normalizeFanOutApiResponse({
        raw: rawData,
        scope,
        appId,
        propertySummaries,
      });
      if (normalized.runs.length > 0) {
        handleIngestSyntheticsRuns(normalized.runs);
      }
      toast.success(
        `AWS Synthetics Fan-Out completed ${normalized.batch.completedCanaries}/${
          normalized.batch.totalCanaries
        } Canaries across ${Math.max(1, normalized.batch.affectedAppIds.length)} ${
          normalized.batch.affectedAppIds.length === 1 ? 'property' : 'properties'
        }`
      );
    });
  };

  const handleSaveProperty = (updatedProp: AppConfig) => {
    const nextApps = apps.map((a) => (a.id === updatedProp.id ? updatedProp : a));
    setApps(nextApps);
    setCustomTopologyEdited(true);

    // Ensure every environment/network target on the updated property has run data
    const validTargets: string[] = [];
    for (const env of updatedProp.envs) {
      for (const net of env.networks || ['prod', 'staging']) {
        validTargets.push(`${updatedProp.id}.${env.id}.${net}`);
      }
    }
    const missingTargets = validTargets.filter(
      (t) => !runs.some((r) => r.target === t)
    );
    if (missingTargets.length > 0) {
      const suite =
        suitesByAppId[updatedProp.id] ||
        normalizeSuiteWithCatchpointDefaults(getPropertyTestSuite(updatedProp.id));
      const nextConfig: TemplateConfig = {
        ...liveTemplateConfig,
        properties: nextApps,
        testSuite: suite,
      };
      const newRuns: RunRecord[] = missingTargets.map((targetId) => {
        const [, envId, net] = targetId.split('.');
        const network = net === 'staging' ? 'staging' : 'prod';
        const results = generateTestResults(
          targetId,
          network === 'staging' ? 'normal_staging' : 'normal_prod',
          suite,
          nextConfig
        );
        return {
          key: `run-${targetId.replace(/\./g, '-')}-seed-${Date.now().toString().slice(-4)}`,
          target: targetId,
          appId: updatedProp.id,
          envId: envId || 'prod',
          network,
          suiteKey: `config/suites/${updatedProp.id}.csv`,
          suiteAppId: updatedProp.id,
          suiteSha256: 'env-init',
          suiteRowCount: results.length,
          startTime: new Date().toISOString(),
          finishTime: new Date().toISOString(),
          totalTests: results.length,
          passedTests: results.filter((r) => r.pass).length,
          failedTests: results.filter((r) => !r.pass).length,
          by: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
          label: `latest-${network}`,
          results,
        };
      });
      setRuns((prev) => [...newRuns, ...prev]);
    }

    if (activeAppId === updatedProp.id && validTargets.length > 0) {
      if (!validTargets.includes(candidateTarget)) {
        setCandidateTarget(validTargets[0]);
      }
      if (!validTargets.includes(baselineTarget)) {
        setBaselineTarget(validTargets[validTargets.length - 1] || validTargets[0]);
      }
    }

    fetch(`/api/v1/properties/${encodeURIComponent(updatedProp.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedProp),
    }).catch(() => undefined);
    toast.success(`Updated property ${updatedProp.id}`);
  };

  const handleCreateProperty = (newProp: AppConfig) => {
    if (apps.some((a) => a.id.toLowerCase() === newProp.id.toLowerCase())) {
      toast.error(`Property "${newProp.id}" already exists`);
      return;
    }
    const defaultSuite = normalizeSuiteWithCatchpointDefaults(
      DEFAULT_TEMPLATE_CONFIG.testSuite
    );
    const nextApps = [...apps, newProp];
    const nextConfig: TemplateConfig = {
      ...liveTemplateConfig,
      properties: nextApps,
      testSuite: defaultSuite,
    };
    const seededRuns = seedRunsFromConfig({
      ...nextConfig,
      properties: [newProp],
    });
    setApps(nextApps);
    setCustomTopologyEdited(true);
    setSuitesByAppId((prev) => ({ ...prev, [newProp.id]: defaultSuite }));
    setRuns((prev) => [...seededRuns, ...prev]);
    setActiveAppId(newProp.id);
    const envId = newProp.envs[0]?.id || 'prod';
    setCandidateTarget(`${newProp.id}.${envId}.staging`);
    setBaselineTarget(`${newProp.id}.${envId}.prod`);
    fetch('/api/v1/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProp),
    }).catch(() => undefined);
    toast.success(`Created property ${newProp.id}`);
  };

  const handleDeleteProperty = (appId: string) => {
    if (apps.length <= 1) return;
    const remaining = apps.filter((a) => a.id !== appId);
    setApps(remaining);
    setCustomTopologyEdited(true);
    setRuns((prev) => prev.filter((r) => r.appId !== appId));
    if (activeAppId === appId && remaining[0]) {
      handleSelectProperty(remaining[0].id);
    }
    fetch(`/api/v1/properties/${encodeURIComponent(appId)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
    toast.info(`Deleted property ${appId}`);
  };

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: 'act-run-gate',
        group: 'Actions',
        label: `Fan-Out AWS Synthetics on ${activeAppId}`,
        subtitle: `${candidateTarget} ↔ ${baselineTarget}`,
        onSelect: () => handleRunLiveGate(activeAppId),
      },
      {
        id: 'act-fanout-fleet',
        group: 'Actions',
        label: 'Fan-Out Global Fleet (AWS Synthetics)',
        subtitle: 'Run Staging + Prod Canaries across all properties',
        onSelect: () => handleFanOutSyntheticsScope('fleet-all', 'Global Fleet'),
      },
      {
        id: 'act-toggle-theme',
        group: 'Actions',
        label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`,
        onSelect: toggleTheme,
      },
      {
        id: 'nav-synthetics',
        group: 'Views',
        label: 'Synthetics — Fleet & AWS Canary Control Plane',
        subtitle: 'Organize Canaries, Fan-Out, Export CSV & Deep Dive',
        onSelect: () => setViewMode('synthetics'),
      },
      {
        id: 'nav-workbench',
        group: 'Views',
        label: 'Compare — Staging vs Prod Diff Workbench',
        subtitle: 'Headers, Set-Cookie, Visual AI Judge & HTTP Flow',
        onSelect: () => setViewMode('workbench'),
      },
      {
        id: 'nav-config-suite',
        group: 'Views',
        label: 'Config — Properties, Envs & AWS Tests',
        onSelect: () => {
          setConfigSection('suite');
          setSetupInitialTab('suite');
          setViewMode('config');
        },
      },
      {
        id: 'nav-config-policies',
        group: 'Views',
        label: 'Config — Gate Policies & Accepted Waivers',
        onSelect: () => {
          setConfigSection('policies');
          setViewMode('config');
        },
      },
      {
        id: 'nav-studio-mcp',
        group: 'Views',
        label: 'Studio — MCP Server Console (JSON-RPC 2.0)',
        onSelect: () => {
          setStudioMode('mcp');
          setViewMode('studio');
        },
      },
      ...(codeEditorUnlocked
        ? [
            {
              id: 'nav-studio-vscode',
              group: 'Views' as const,
              label: 'VS Code — Workspace File Editor & Full Kernel TTY',
              onSelect: () => {
                setStudioMode('vscode');
                setViewMode('vscode');
              },
            },
          ]
        : []),
    ];

    for (const pop of GLOBAL_EXECUTION_POPS) {
      items.push({
        id: `pop-${pop.id}`,
        group: 'Execution PoPs',
        label: `Set Edge PoP: ${pop.popCode} (${pop.city})`,
        badge: pop.regionGroup,
        onSelect: () => setSelectedExecutionPopId(pop.id),
      });
    }

    for (const tc of activeSuite) {
      items.push({
        id: `chk-${tc.id}`,
        group: 'Suite Checks',
        label: `${tc.id} — ${tc.name}`,
        subtitle: tc.path,
        badge: tc.category || 'Check',
        onSelect: () => {
          setSelectedTestId(tc.id);
          setViewMode('workbench');
        },
      });
    }

    for (const sum of propertySummaries) {
      items.push({
        id: `prop-${sum.appId}`,
        group: 'Properties',
        label: `${sum.appId} — ${sum.name}`,
        subtitle: sum.canonicalHost,
        badge: sum.verdict,
        onSelect: () => handleSelectProperty(sum.appId),
      });
    }

    return items;
  }, [
    activeAppId,
    candidateTarget,
    baselineTarget,
    theme,
    propertySummaries,
    activeSuite,
    codeEditorUnlocked,
  ]);

  // Secret Code Editor shortcut listener in capture phase so Monaco / Xterm focus cannot swallow toggle-off
  useEffect(() => {
    const onSecretKeyDown = (e: KeyboardEvent) => {
      if (!isSecretCodeEditorShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPaletteOpen(false);
      setShortcutsOpen(false);
      setPropertySwitcherOpen(false);
      if (!codeEditorUnlocked) {
        preCodeEditorViewRef.current =
          viewMode === 'vscode' ? 'studio' : viewMode;
        setCodeEditorUnlocked(true);
        setStudioMode('vscode');
        setViewMode('vscode');
        toast.info('Code Editor unlocked');
      } else if (
        viewMode === 'vscode' ||
        (viewMode === 'studio' && studioMode === 'vscode')
      ) {
        setCodeEditorUnlocked(false);
        setStudioMode('mcp');
        const returnView =
          preCodeEditorViewRef.current &&
          preCodeEditorViewRef.current !== 'vscode'
            ? preCodeEditorViewRef.current
            : 'studio';
        setViewMode(returnView);
        toast.info('Code Editor hidden');
      } else {
        preCodeEditorViewRef.current = viewMode;
        setStudioMode('vscode');
        setViewMode('vscode');
      }
    };
    window.addEventListener('keydown', onSecretKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onSecretKeyDown, { capture: true });
  }, [codeEditorUnlocked, viewMode, studioMode]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        setPropertySwitcherOpen(false);
        return;
      }
      if (mod || e.altKey || isEditableTarget(e.target as never)) return;
      if (paletteOpen || shortcutsOpen) return;

      const k = e.key.toLowerCase();
      if (e.key === '?') setShortcutsOpen((v) => !v);
      else if (e.key === '/') {
        e.preventDefault();
        setPropertySwitcherOpen(true);
      } else if (k === 't') toggleTheme();
      else if (viewMode === 'workbench') {
        if (k === '1') setInspectorTab('headers');
        else if (k === '2') setInspectorTab('cookies');
        else if (k === '3') setInspectorTab('image');
        else if (k === '4') setInspectorTab('flow');
        else if (k === 'r' && selectedItem) handleRerunSingleCheck(selectedItem.testId);
        else if (k === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (filteredDiffResult.nextTestId) {
            setSelectedTestId(filteredDiffResult.nextTestId);
          }
        } else if (k === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (filteredDiffResult.prevTestId) {
            setSelectedTestId(filteredDiffResult.prevTestId);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const isRunningGate = Boolean(runStreamState?.active);
  const runningProgressText = runStreamState?.active
    ? `Running ${runStreamState.completedCount}/${runStreamState.totalCount}`
    : undefined;

  const [queueCollapsed, setQueueCollapsed] = useState(false);

  // Proactively warm browser image memory cache for all checks in the active property so Visual AI renders in 0ms
  useEffect(() => {
    const urls: string[] = [];
    for (const item of comparison.items.slice(0, 12)) {
      const cand = item.candidateResult;
      const base = item.baselineResult;
      urls.push(
        cand?.screenshotUrl && !cand.screenshotUrl.startsWith('data:image/svg+xml')
          ? cand.screenshotUrl
          : resolveLiveScreenshotUrl({
              appId: activeAppId,
              testId: item.testId,
              url: item.url,
              side: 'A',
              revision: cand?.screenshotRevision,
            })
      );
      urls.push(
        base?.screenshotUrl && !base.screenshotUrl.startsWith('data:image/svg+xml')
          ? base.screenshotUrl
          : resolveLiveScreenshotUrl({
              appId: activeAppId,
              testId: item.testId,
              url: item.url,
              side: 'B',
              revision: base?.screenshotRevision,
            })
      );
    }
    preloadScreenshotUrls(urls);
  }, [activeAppId, comparison.items]);

  const activeHost = resolvePropertyHostname(activeAppId, 'prod', liveTemplateConfig);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">
      <Toaster position="bottom-right" richColors />

      <TopBar
        viewMode={viewMode}
        onSelectView={setViewMode}
        onRunLiveGate={() => handleRunLiveGate()}
        isRunningGate={isRunningGate}
        runningProgressText={runningProgressText}
        theme={theme}
        onToggleTheme={toggleTheme}
        activeAppId={activeAppId}
        propertySummaries={propertySummaries}
        onSelectProperty={(id) =>
          handleSelectProperty(id, viewMode === 'workbench' ? 'workbench' : viewMode)
        }
        propertySwitcherOpen={propertySwitcherOpen}
        onSetPropertySwitcherOpen={setPropertySwitcherOpen}
        onOpenManageProperties={() => {
          setConfigSection('suite');
          setSetupInitialTab('suite');
          setViewMode('config');
        }}
        onOpenCommandPalette={() => setPaletteOpen(true)}
      />

      {viewMode === 'synthetics' && (
        <main className="flex-1">
          <SyntheticsOrchestratorView
            activeAppId={activeAppId}
            apps={apps}
            suitesByAppId={suitesByAppId}
            runs={runs}
            templateConfig={liveTemplateConfig}
            propertySummaries={propertySummaries}
            onSelectPropertyAndCompare={(appId, testId, tab) => {
              handleSelectProperty(appId, 'workbench');
              if (testId) setSelectedTestId(testId);
              if (tab) setInspectorTab(tab);
            }}
            onOpenSetupForProperty={(appId) => {
              handleSelectProperty(appId, 'config');
              setConfigSection('suite');
              setSetupInitialTab('suite');
            }}
            onIngestRunsFromSynthetics={handleIngestSyntheticsRuns}
            onRunPropertyGate={(appId) => handleRunLiveGate(appId)}
          />
        </main>
      )}

      {viewMode === 'workbench' && (
        <div className="flex flex-1 min-w-0 min-h-0 lg:h-[calc(100vh-3rem)] lg:max-h-[calc(100vh-3rem)] lg:overflow-hidden">
          <main className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
            <WorkbenchToolbar
              activeAppId={activeAppId}
              activeAppName={activeProp?.name || activeAppId}
              canonicalHost={activeHost}
              headlineVerdict={comparison.headlineVerdict}
              headerDiffs={activeSummary?.headerDiffCount ?? 0}
              cookieDiffs={activeSummary?.cookieDiffCount ?? 0}
              visualDiffs={activeSummary?.visualDiffCount ?? 0}
              totalChecks={comparison.items.length}
              compareMode={compareMode}
              onSetCompareMode={setCompareMode}
              candidateTarget={candidateTarget}
              baselineTarget={baselineTarget}
              availableTargets={availableTargets}
              runs={runs}
              candidateRunKey={activeCandidateRun.key}
              baselineRunKey={activeBaselineRun.key}
              onChangeCandidateTarget={(t) => {
                setCandidateTarget(t);
                const r = runs.find((x) => x.target === t);
                setCandidateRunKey(r?.key || '');
              }}
              onChangeBaselineTarget={(t) => {
                setBaselineTarget(t);
                const r = runs.find((x) => x.target === t);
                setBaselineRunKey(r?.key || '');
              }}
              onChangeCandidateRunKey={setCandidateRunKey}
              onChangeBaselineRunKey={setBaselineRunKey}
              onSwapSides={() => {
                setCandidateTarget(baselineTarget);
                setBaselineTarget(candidateTarget);
                setCandidateRunKey(baselineRunKey);
                setBaselineRunKey(candidateRunKey);
              }}
              selectedExecutionPopId={selectedExecutionPopId}
              onChangeExecutionPopId={setSelectedExecutionPopId}
              sreSummary={sreSummary}
              ignoreAcceptedDiffs={ignoreAcceptedDiffs}
              onToggleIgnoreAccepted={() => setIgnoreAcceptedDiffs((v) => !v)}
              onCopyMarkdown={() => {
                navigator.clipboard.writeText(
                  generateComparisonMarkdownSummary(comparison)
                );
                toast.success('Copied Markdown release summary');
              }}
              onRerunAllDiffs={handleRerunAllDiffs}
              onRunSingleTarget={() => handleRunLiveGate(activeAppId)}
              onTogglePropScale={handleTogglePropScale}
              propCount={apps.length}
              onToggleSuiteScale={handleToggleSuiteScale}
              suiteCount={activeSuite.length}
              theme={theme}
              onToggleTheme={toggleTheme}
              onOpenCommandPalette={() => setPaletteOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              backgroundJobs={backgroundJobs}
              runStreamState={runStreamState}
              onOpenSetup={(tab) => {
                setConfigSection('suite');
                setSetupInitialTab(tab);
                setViewMode('config');
              }}
              onOpenVsCode={
                codeEditorUnlocked
                  ? () => {
                      setStudioMode('vscode');
                      setViewMode('vscode');
                    }
                  : undefined
              }
              onOpenSynthetics={() => setViewMode('synthetics')}
            />

            <div
              className={`grid flex-1 min-h-0 grid-cols-1 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden ${
                queueCollapsed
                  ? 'lg:grid-cols-[44px_1fr]'
                  : 'lg:grid-cols-[268px_1fr] xl:grid-cols-[284px_1fr]'
              } min-w-0`}
            >
              <CheckListPane
                filteredResult={filteredDiffResult}
                selectedTestId={selectedItem?.testId || selectedTestId}
                onSelectTest={(id, preferredTab) => {
                  setSelectedTestId(id);
                  if (preferredTab) setInspectorTab(preferredTab);
                }}
                dimensionFilter={dimensionFilter}
                onChangeDimensionFilter={(dim) => {
                  setDimensionFilter(dim);
                  setCheckPage(1);
                }}
                searchQuery={checkSearchQuery}
                onChangeSearchQuery={(q) => {
                  setCheckSearchQuery(q);
                  setCheckPage(1);
                }}
                page={checkPage}
                onChangePage={setCheckPage}
                ignoreAcceptedDiffs={ignoreAcceptedDiffs}
                runStreamState={runStreamState}
                onOpenManageTests={() => {
                  setConfigSection('suite');
                  setSetupInitialTab('suite');
                  setViewMode('config');
                }}
                collapsed={queueCollapsed}
                onToggleCollapsed={() => setQueueCollapsed((prev) => !prev)}
              />

              <EvidenceInspectorPane
                item={selectedItem}
                testDef={activeSuite.find((t) => t.id === selectedItem?.testId)}
                activeTab={inspectorTab}
                onChangeTab={setInspectorTab}
                compareMode={compareMode}
                candidateLabel={activeCandidateRun.label || candidateTarget}
                baselineLabel={activeBaselineRun.label || baselineTarget}
                acceptedRulesKinds={acceptedRules
                  .filter((r) => r.enabled)
                  .map((r) => r.kind)}
                acceptedCookies={acceptedCookies}
                acceptedVisualTests={acceptedVisualTests}
                acceptedVisualParamIds={
                  selectedItem
                    ? acceptedVisualParams[`${activeAppId}:${selectedItem.testId}`] || []
                    : []
                }
                ignoreAcceptedDiffs={ignoreAcceptedDiffs}
                onToggleAcceptHeader={handleToggleAcceptHeader}
                onToggleAcceptCookie={handleToggleAcceptCookie}
                onToggleAcceptVisual={handleToggleAcceptVisual}
                onToggleAcceptVisualParam={handleToggleAcceptVisualParam}
                onMeasuredVisualDiff={handleMeasuredVisualDiff}
                onRerunCheck={handleRerunSingleCheck}
                onRunAiJudge={handleRunAiJudge}
                isRerunningTestId={rerunningTestId}
                isRunningAiTestId={runningAiTestId}
                lastProbe={
                  selectedItem ? lastProbedByTestId[selectedItem.testId] : undefined
                }
                appId={activeAppId}
                onPrevCheck={() => {
                  if (filteredDiffResult.prevTestId) {
                    setSelectedTestId(filteredDiffResult.prevTestId);
                  }
                }}
                onNextCheck={() => {
                  if (filteredDiffResult.nextTestId) {
                    setSelectedTestId(filteredDiffResult.nextTestId);
                  }
                }}
                hasPrevCheck={Boolean(filteredDiffResult.prevTestId)}
                hasNextCheck={Boolean(filteredDiffResult.nextTestId)}
              />
            </div>
          </main>
        </div>
      )}

      {viewMode === 'config' && (
        <main className="flex flex-1 flex-col min-w-0">
          <ConfigHubView
            initialSection={configSection}
            initialSetupTab={setupInitialTab}
            apps={apps}
            activeAppId={activeAppId}
            suitesByAppId={suitesByAppId}
            onSelectApp={(id) => handleSelectProperty(id, 'config')}
            onCreateProperty={handleCreateProperty}
            onSaveProperty={handleSaveProperty}
            onDeleteProperty={handleDeleteProperty}
            onSaveSuite={handleSaveSuiteForApp}
            onOpenSynthetics={() => setViewMode('synthetics')}
            acceptedRules={acceptedRules}
            acceptedCookies={acceptedCookies}
            acceptedVisualTests={acceptedVisualTests}
            ignoreAcceptedDiffs={ignoreAcceptedDiffs}
            onToggleIgnoreAccepted={() => setIgnoreAcceptedDiffs((v) => !v)}
            onToggleRuleEnabled={(id) =>
              setAcceptedRules((prev) =>
                prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
              )
            }
            onDeleteRule={(id) =>
              setAcceptedRules((prev) => prev.filter((r) => r.id !== id))
            }
            onAddHeaderRule={(field, note) => {
              const kind = field.toLowerCase().trim();
              if (!kind) return;
              const exists = acceptedRules.some(
                (r) => r.kind.toLowerCase() === kind
              );
              if (exists) {
                toast.info(`Header rule already exists: ${kind}`);
                return;
              }
              const rule: AcceptedRule = {
                id: `rule-${Date.now()}`,
                appId: activeAppId,
                comparisonId: 'all',
                kind,
                note: note || '',
                enabled: true,
                by: DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator.email,
                at: new Date().toISOString(),
              };
              setAcceptedRules((prev) => [...prev, rule]);
              toast.success(`Added header drift rule: ${kind}`);
            }}
            onAddCookiePolicy={(name) => {
              const clean = name.toLowerCase();
              setAcceptedCookies((prev) =>
                prev.includes(clean) ? prev : [...prev, clean]
              );
              toast.success(`Added cookie policy: ${clean}`);
            }}
            onRemoveCookiePolicy={(name) =>
              setAcceptedCookies((prev) => prev.filter((c) => c !== name))
            }
            onRemoveVisualPolicy={(testId) => {
              setAcceptedVisualTests((prev) => prev.filter((id) => id !== testId));
              setAcceptedVisualParams((prev) => {
                if (!prev[testId]) return prev;
                const next = { ...prev };
                delete next[testId];
                return next;
              });
            }}
            acceptedVisualParams={acceptedVisualParams}
            onRemoveVisualParamPolicy={(testId, paramId) => {
              setAcceptedVisualParams((prev) => {
                const existing = prev[testId] || [];
                const nextList = existing.filter((id) => id !== paramId);
                const next = { ...prev };
                if (nextList.length === 0) delete next[testId];
                else next[testId] = nextList;
                return next;
              });
              setAcceptedVisualTests((prev) => prev.filter((id) => id !== testId));
            }}
            onResetPolicies={() => {
              const fresh = clearPersistedPortalState();
              setAcceptedRules(INITIAL_RULES);
              setAcceptedCookies(fresh.acceptedCookies);
              setAcceptedVisualTests([]);
              setAcceptedVisualParams({});
              setIgnoreAcceptedDiffs(true);
              toast.info('Reset policies to factory defaults');
            }}
          />
        </main>
      )}

      {(viewMode === 'studio' || viewMode === 'vscode') && (
        <main className="flex flex-1 flex-col min-w-0">
          <DevStudioView
            initialMode={
              codeEditorUnlocked && viewMode === 'vscode'
                ? 'vscode'
                : codeEditorUnlocked
                ? studioMode
                : 'mcp'
            }
            codeEditorUnlocked={codeEditorUnlocked}
            onModeChange={(nextMode) => {
              setStudioMode(nextMode);
              if (nextMode === 'vscode' && codeEditorUnlocked) {
                setViewMode('vscode');
              } else if (viewMode === 'vscode') {
                setViewMode('studio');
              }
            }}
            onLockCodeEditor={() => {
              setCodeEditorUnlocked(false);
              setStudioMode('mcp');
              const returnView =
                preCodeEditorViewRef.current &&
                preCodeEditorViewRef.current !== 'vscode'
                  ? preCodeEditorViewRef.current
                  : 'studio';
              setViewMode(returnView);
              toast.info('Code Editor hidden');
            }}
            theme={theme}
            activeAppId={activeAppId}
            activeApp={activeProp}
            activeSuite={activeSuite}
            liveTemplateConfig={liveTemplateConfig}
            selectedItem={selectedItem}
            propertySummaries={propertySummaries}
            onOpenWorkbench={() => setViewMode('workbench')}
            onInspectPropertyInWorkbench={(appId, testId, tab) => {
              handleSelectProperty(appId, 'workbench');
              if (testId) setSelectedTestId(testId);
              if (tab) setInspectorTab(tab);
            }}
            onSaveProperty={handleSaveProperty}
            onSaveSuite={handleSaveSuiteForApp}
            onConfigMutated={refreshWorkspaceFromServer}
          />
        </main>
      )}

      <QuickPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={commandPaletteItems}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
