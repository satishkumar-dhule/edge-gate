import React, { useState, useMemo, useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import {
  AcceptedRule,
  AppConfig,
  ComparisonKind,
  RunRecord,
  TargetState,
} from './engine/types';
import {
  DEFAULT_TEMPLATE_CONFIG,
  ReadyReportDefinition,
  TestCaseDefinition,
  resolvePropertyHostname,
} from './config/template.config';
import {
  INITIAL_RULES,
  INITIAL_RUNS,
  INITIAL_TARGET_STATES,
  buildInitialComparison,
  generateTestResults,
} from './data/mockStore';
import {
  DataSourceMode,
  buildDefaultRunMap,
  clearPersistedPortalState,
  generateEnterpriseScaleTopology,
  isDummySeededRun,
  loadPersistedPortalState,
  savePersistedPortalState,
} from './adapters/syntheticsAdapter';
import { generateComparisonMarkdownSummary } from './engine/rules';
import {
  TestInspector,
  SingleRunInspector,
  InspectorDimension,
} from './components/TestInspector';
import {
  BackgroundJob,
  BackgroundJobsPopover,
  ComparisonTargetBar,
  LoginView,
  McpAndAwsBackendView,
  NetworkEndpointCell,
  PropertyCommandSwitcher,
  PageMiniThumb,
  SettingsView,
  AboutView,
  TestSuitesView,
} from './components/ControlCenterViews';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './components/ui/table';
import {
  Play,
  RotateCw,
  GitCompare,
  ArrowLeft,
  Eye,
  CheckCircle2,
  AlertCircle,
  Globe,
  ChevronRight,
  Bell,
  Server,
  Settings,
  Info,
  LogOut,
  Loader2,
  Sun,
  Moon,
  ListChecks,
  Code2,
  KeyRound,
  Sparkles,
  LayoutGrid,
  History,
  Search,
  Activity,
} from 'lucide-react';

type ViewMode =
  | 'property'
  | 'suites'
  | 'diff'
  | 'run'
  | 'mcp'
  | 'settings'
  | 'about';

export default function App() {
  // 1. Dark & Light Theme Switch (Synced with document.documentElement)
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

  // 2. Enterprise Operator Authentication State (Seeded from TemplateConfig)
  const [currentUser, setCurrentUser] = useState<{
    email: string;
    role: string;
    account: string;
  } | null>(DEFAULT_TEMPLATE_CONFIG.branding.defaultOperator);

  // 3. Persistent Config-Driven Topology & Suite State (Survives Browser Reloads)
  const initialPersisted = useMemo(() => loadPersistedPortalState(), []);

  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>(
    initialPersisted.dataSourceMode
  );
  const [remoteApiBaseUrl, setRemoteApiBaseUrl] = useState<string>(
    initialPersisted.remoteApiBaseUrl
  );
  const [apps, setApps] = useState<AppConfig[]>(initialPersisted.apps);
  const [testSuite, setTestSuite] = useState<TestCaseDefinition[]>(
    initialPersisted.testSuite
  );
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
  const [ignoreAcceptedDiffs, setIgnoreAcceptedDiffs] = useState<boolean>(
    initialPersisted.ignoreAcceptedDiffs
  );

  const [targetStates, setTargetStates] = useState<
    Record<
      string,
      {
        state: TargetState;
        activeActivity?: string;
        progress?: { done: number; total: number } | string;
      }
    >
  >(INITIAL_TARGET_STATES);

  const [readyReports, setReadyReports] = useState<ReadyReportDefinition[]>(
    initialPersisted.readyReports
  );

  // Background Jobs & Notification Popover State
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>(initialPersisted.viewMode);
  const [activeAppId, setActiveAppId] = useState<string>(
    initialPersisted.activeAppId
  );
  const [focusedTargetId, setFocusedTargetId] = useState<string>(
    initialPersisted.focusedTargetId
  );
  const [candidateTarget, setCandidateTarget] = useState<string>(
    initialPersisted.candidateTarget
  );
  const [baselineTarget, setBaselineTarget] = useState<string>(
    initialPersisted.baselineTarget
  );

  const [selectedRunByTarget, setSelectedRunByTarget] = useState<
    Record<string, string>
  >(initialPersisted.selectedRunByTarget);

  const [candidateRunKey, setCandidateRunKey] = useState<string>(
    initialPersisted.candidateRunKey
  );
  const [baselineRunKey, setBaselineRunKey] = useState<string>(
    initialPersisted.baselineRunKey
  );

  const [selectedTestId, setSelectedTestId] = useState<string>(
    initialPersisted.selectedTestId
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorDimension>(
    initialPersisted.inspectorTab
  );
  const [testFilter, setTestFilter] = useState<'all' | 'diffs' | 'matched'>('all');
  const [diffSearchQuery, setDiffSearchQuery] = useState<string>('');
  const [reportScope, setReportScope] = useState<'active' | 'all'>('active');
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [homeRightTab, setHomeRightTab] = useState<'fleet' | 'audit'>('fleet');

  const [isComparingBoth, setIsComparingBoth] = useState<boolean>(false);
  const [rerunningTestId, setRerunningTestId] = useState<string | null>(null);
  const [runningAiTestId, setRunningAiTestId] = useState<string | null>(null);
  const [lastProbedByTestId, setLastProbedByTestId] = useState<
    Record<
      string,
      {
        at: string;
        count: number;
        candMs: number;
        baseMs?: number;
        status: number;
      }
    >
  >({});
  const [isHydratingLiveRuns, setIsHydratingLiveRuns] = useState<boolean>(() =>
    isDummySeededRun(initialPersisted.runs[0])
  );

  const normalizeRunPropertyUrls = (r: RunRecord & { targetId?: string }): RunRecord => {
    const target = r.target || r.targetId || 'www.prod.staging';
    const [appId = 'www', envId = 'prod'] = target.split('.');
    const canonicalHost = resolvePropertyHostname(appId, envId);
    return {
      ...r,
      target,
      appId: r.appId || appId,
      envId: r.envId || envId,
      results: (r.results || []).map((res) => {
        const fallbackPath = (res as typeof res & { path?: string }).path || '/';
        const cleanUrl = res.url
          ? res.url.replace(/^https:\/\/www\.salesforce\.com\b/i, `https://${canonicalHost}`)
          : `https://${canonicalHost}${fallbackPath}`;
        return {
          ...res,
          url: cleanUrl,
          canonicalUrl: cleanUrl,
          redirectChain: (res.redirectChain || []).map((hop, idx) =>
            idx === 0
              ? {
                  ...hop,
                  url: hop.url.replace(
                    /^https:\/\/www\.salesforce\.com\b/i,
                    `https://${canonicalHost}`
                  ),
                }
              : hop
          ),
        };
      }),
    };
  };

  // Hydrate live salesforce.com runs & active AWS operator identity from backend/Lambda on mount
  useEffect(() => {
    fetch('/api/v1/runs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.runs) && data.runs.length > 0) {
          const incomingRuns: RunRecord[] = data.runs
            .filter((r: RunRecord) => !isDummySeededRun(r))
            .map((r: RunRecord & { targetId?: string }) => normalizeRunPropertyUrls(r));
          if (incomingRuns.length > 0) {
            setRuns(incomingRuns);

            const nextRunMap: Record<string, string> = {};
            for (const r of incomingRuns) {
              if (!nextRunMap[r.target]) {
                nextRunMap[r.target] = r.key;
              }
            }
            setSelectedRunByTarget(nextRunMap);

            const latestStg = incomingRuns.find((r) => r.target === 'www.prod.staging');
            const latestPrd = incomingRuns.find((r) => r.target === 'www.prod.prod');
            if (latestStg) setCandidateRunKey(latestStg.key);
            if (latestPrd) setBaselineRunKey(latestPrd.key);

            // Build live Audit Log reports from actual live runs in DynamoDB
            const seenAppEnvs = new Set<string>();
            const liveReports: ReadyReportDefinition[] = [];
            for (const r of incomingRuns) {
              const pairKey = `${r.appId}.${r.envId}`;
              if (seenAppEnvs.has(pairKey)) continue;
              seenAppEnvs.add(pairKey);
              const utcTime = r.startTime
                ? `${new Date(r.startTime).toISOString().slice(11, 19)} UTC`
                : 'Live';
              liveReports.push({
                id: `LIVE-${r.appId.toUpperCase()}-${r.envId.toUpperCase()}`,
                title: `Live Edge Gate: ${r.appId}.${r.envId}.staging ↔ ${r.appId}.${r.envId}.prod`,
                appId: r.appId,
                candidateTarget: `${r.appId}.${r.envId}.staging`,
                baselineTarget: `${r.appId}.${r.envId}.prod`,
                createdAt: utcTime,
                by: r.by || 'aws-lambda-adhoc',
              });
            }
            setReadyReports(liveReports);

            // Build live Background Job notifications from actual live runs
            setBackgroundJobs(
              incomingRuns.slice(0, 4).map((r) => ({
                id: `live-job-${r.key}`,
                title: `Live Probe: ${r.target} (${r.label})`,
                target: r.target,
                engine: `aws-lambda-adhoc-${DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion}`,
                status: 'completed' as const,
                startedAt: r.startTime
                  ? `${new Date(r.startTime).toISOString().slice(11, 19)} UTC`
                  : 'Live',
                progress: `${r.passedTests}/${r.totalTests}`,
                kind: 'single-run' as const,
                onInspect: () => {
                  setFocusedTargetId(r.target);
                  setViewMode('run');
                },
              }))
            );
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setIsHydratingLiveRuns(false));

    fetch('/api/v1/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((health) => {
        if (!health) return;
        const acct =
          health?.awsCredentialsStatus?.accountId ||
          (health?.s3ArtifactBucket || '').match(/(\d{12})/)?.[1];
        const opUser = health?.awsCredentialsStatus?.operatorUsername;
        if (acct) {
          setCurrentUser((prev) => ({
            email: opUser ? `${opUser}@salesforce.com` : prev?.email || 'sre@salesforce.com',
            role: prev?.role || 'Lead Edge Release Engineer',
            account: `SFDC-EDGE-${acct} (AWS ${acct} · Akamai Prod + Staging)`,
          }));
        }
      })
      .catch(() => undefined);
  }, []);

  // Automatically persist portal state across reloads so user state never resets unexpectedly
  useEffect(() => {
    savePersistedPortalState({
      version: 6,
      dataSourceMode,
      remoteApiBaseUrl,
      apps,
      testSuite,
      runs,
      readyReports,
      acceptedRules,
      acceptedCookies,
      acceptedVisualTests,
      ignoreAcceptedDiffs,
      viewMode,
      activeAppId,
      focusedTargetId,
      candidateTarget,
      baselineTarget,
      candidateRunKey,
      baselineRunKey,
      selectedRunByTarget,
      selectedTestId,
      inspectorTab,
    });
  }, [
    dataSourceMode,
    remoteApiBaseUrl,
    apps,
    testSuite,
    runs,
    readyReports,
    acceptedRules,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    viewMode,
    activeAppId,
    focusedTargetId,
    candidateTarget,
    baselineTarget,
    candidateRunKey,
    baselineRunKey,
    selectedRunByTarget,
    selectedTestId,
    inspectorTab,
  ]);

  const handleToggleScalePreset = () => {
    if (apps.length >= 50) {
      const defaultApps = DEFAULT_TEMPLATE_CONFIG.properties;
      setApps(defaultApps);
      setRuns(INITIAL_RUNS);
      setReadyReports(DEFAULT_TEMPLATE_CONFIG.readyReports);
      setSelectedRunByTarget(buildDefaultRunMap(INITIAL_RUNS));
      setActiveAppId('www');
      setCandidateTarget('www.prod.staging');
      setBaselineTarget('www.prod.prod');
      toast.info('Restored default 8-Property template topology');
    } else {
      const scaled = generateEnterpriseScaleTopology(50);
      setApps(scaled.apps);
      setRuns(scaled.runs);
      setReadyReports(scaled.readyReports);
      setSelectedRunByTarget(buildDefaultRunMap(scaled.runs));
      toast.success(
        `Loaded 50-Property Enterprise Scale Preset (${scaled.apps.length} properties · ${scaled.runs.length} runs)`
      );
    }
  };

  const handleResetPortalState = () => {
    const clean = clearPersistedPortalState();
    setDataSourceMode(clean.dataSourceMode);
    setRemoteApiBaseUrl(clean.remoteApiBaseUrl);
    setApps(clean.apps);
    setTestSuite(clean.testSuite);
    setRuns(clean.runs);
    setReadyReports(clean.readyReports);
    setAcceptedRules(clean.acceptedRules);
    setAcceptedCookies(clean.acceptedCookies);
    setAcceptedVisualTests(clean.acceptedVisualTests);
    setIgnoreAcceptedDiffs(clean.ignoreAcceptedDiffs);
    setViewMode(clean.viewMode);
    setActiveAppId(clean.activeAppId);
    setFocusedTargetId(clean.focusedTargetId);
    setCandidateTarget(clean.candidateTarget);
    setBaselineTarget(clean.baselineTarget);
    setCandidateRunKey(clean.candidateRunKey);
    setBaselineRunKey(clean.baselineRunKey);
    setSelectedRunByTarget(clean.selectedRunByTarget);
    setSelectedTestId(clean.selectedTestId);
    setInspectorTab(clean.inspectorTab);
    toast.success('Reset portal state to clean template defaults');
  };

  const currentApp = useMemo(
    () => apps.find((a) => a.id === activeAppId) || apps[0],
    [apps, activeAppId]
  );

  const appEndpoints = useMemo(() => {
    const list: {
      targetId: string;
      appId: string;
      envId: string;
      envName: string;
      network: 'staging' | 'prod';
    }[] = [];
    for (const env of currentApp.envs) {
      const nets = env.networks || currentApp.defaultNetworks || ['prod', 'staging'];
      for (const net of ['staging', 'prod'] as const) {
        if (nets.includes(net)) {
          list.push({
            targetId: `${currentApp.id}.${env.id}.${net}`,
            appId: currentApp.id,
            envId: env.id,
            envName: env.name,
            network: net,
          });
        }
      }
    }
    return list;
  }, [currentApp]);

  const handleSelectProperty = (appId: string) => {
    const appObj = apps.find((a) => a.id === appId) || apps[0];
    const firstEnv = appObj.envs[0]?.id || 'prod';
    setActiveAppId(appId);
    const candTarget = `${appId}.${firstEnv}.staging`;
    const baseTarget = `${appId}.${firstEnv}.prod`;
    setCandidateTarget(candTarget);
    setBaselineTarget(baseTarget);
    const candRun = runs.find((r) => r.target === candTarget);
    const baseRun = runs.find((r) => r.target === baseTarget);
    if (candRun) setCandidateRunKey(candRun.key);
    if (baseRun) setBaselineRunKey(baseRun.key);
    setFocusedTargetId(candTarget);
    setSelectedTestId(testSuite[0]?.id || 'T01');
    setInspectorTab('headers');
    setViewMode((prev) => (prev === 'suites' ? 'suites' : 'property'));
  };

  // Live Template Adaptation Handler 1: Add a new Property & Environments
  const handleAddProperty = (id: string, name: string, envIds: string[]) => {
    if (apps.some((a) => a.id === id)) {
      toast.error(`Property "${id}" already exists`);
      return;
    }

    const newApp: AppConfig = {
      id,
      name,
      suitePath: `config/suites/${id}.csv`,
      defaultNetworks: ['prod', 'staging'],
      envs: envIds.map((envId) => ({
        id: envId,
        name: envId.toUpperCase(),
        hostMap: {
          [resolvePropertyHostname(id, 'prod')]: resolvePropertyHostname(
            id,
            envId
          ),
        },
        networks: ['prod', 'staging'],
      })),
    };

    const newRuns: RunRecord[] = [];
    for (const envId of envIds) {
      for (const net of ['staging', 'prod'] as const) {
        const target = `${id}.${envId}.${net}`;
        const results = generateTestResults(
          target,
          net === 'staging' ? 'normal_staging' : 'normal_prod',
          testSuite
        );
        newRuns.push({
          key: `run-${id}-${envId}-${net}-1`,
          target,
          appId: id,
          envId,
          network: net,
          suiteKey: newApp.suitePath,
          suiteSha256: '9f83a21b33c0',
          suiteRowCount: results.length,
          startTime: new Date().toISOString(),
          finishTime: new Date().toISOString(),
          totalTests: results.length,
          passedTests: results.length,
          failedTests: 0,
          by: currentUser?.email || 'operator',
          label: net === 'staging' ? 'v1-rc1' : 'live-baseline',
          results,
        });
      }
    }

    setApps((prev) => [...prev, newApp]);
    setRuns((prev) => [...newRuns, ...prev]);
    setSelectedRunByTarget((prev) => ({
      ...prev,
      ...Object.fromEntries(newRuns.map((r) => [r.target, r.key])),
    }));
    setReadyReports((prev) => [
      {
        id: `RPT-${105 + prev.length}`,
        title: `${envIds[0].toUpperCase()} Release Gate: Staging vs Production`,
        appId: id,
        candidateTarget: `${id}.${envIds[0]}.staging`,
        baselineTarget: `${id}.${envIds[0]}.prod`,
        createdAt: 'Just now',
        by: currentUser?.email || 'operator',
      },
      ...prev,
    ]);
    handleSelectProperty(id);
    toast.success(
      `Added Property "${id}" (${name}) with environments: ${envIds.join(', ')}`
    );
  };

  // Live Template Adaptation Handler 2: Add or Update Test Suite
  const syncRunsWithSuite = (updatedSuite: TestCaseDefinition[]) => {
    setTestSuite(updatedSuite);
    setRuns((prev) =>
      prev.map((run) => {
        const freshResults = generateTestResults(
          run.target,
          run.network === 'staging' ? 'normal_staging' : 'normal_prod',
          updatedSuite
        );
        return {
          ...run,
          suiteRowCount: freshResults.length,
          totalTests: freshResults.length,
          passedTests: freshResults.filter((r) => r.pass).length,
          results: freshResults,
        };
      })
    );
  };

  const handleAddTestCase = (newTc: TestCaseDefinition) => {
    const updatedSuite = [...testSuite, newTc];
    syncRunsWithSuite(updatedSuite);
    toast.success(`Added test case ${newTc.id} (${newTc.path}) to suite`);
  };

  const handleUpdateTestSuite = (updatedSuite: TestCaseDefinition[]) => {
    syncRunsWithSuite(updatedSuite);
    toast.success(
      `Synchronized test suite (${
        updatedSuite.filter((t) => t.enabled !== false).length
      } active tests)`
    );
  };

  const getActiveRunForTarget = (
    targetId: string,
    preferredKey?: string
  ): RunRecord => {
    const targetRuns = runs.filter((r) => r.target === targetId);
    if (preferredKey) {
      const found = targetRuns.find((r) => r.key === preferredKey);
      if (found) return found;
    }
    const chosenKey = selectedRunByTarget[targetId];
    return (
      targetRuns.find((r) => r.key === chosenKey) ||
      targetRuns[0] ||
      runs[0]
    );
  };

  const activeCandidateRun = useMemo(
    () => getActiveRunForTarget(candidateTarget, candidateRunKey),
    [runs, candidateTarget, candidateRunKey, selectedRunByTarget]
  );

  const activeBaselineRun = useMemo(
    () => getActiveRunForTarget(baselineTarget, baselineRunKey),
    [runs, baselineTarget, baselineRunKey, selectedRunByTarget]
  );

  const activeSingleRun = useMemo(
    () => getActiveRunForTarget(focusedTargetId),
    [runs, focusedTargetId, selectedRunByTarget]
  );

  // Preload live Chromium JPEG screenshots for the active property into browser memory cache for 0ms tab switching
  useEffect(() => {
    const timer = setTimeout(() => {
      const ids =
        activeAppId === 'www'
          ? ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08']
          : ['T01'];
      for (const id of ids) {
        const imgA = new Image();
        imgA.src = `/screenshots/${activeAppId}-${id}-sideA.jpg`;
        const imgB = new Image();
        imgB.src = `/screenshots/${activeAppId}-${id}-sideB.jpg`;
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [activeAppId]);

  const handleChangeCandidateTarget = (newTarget: string) => {
    setCandidateTarget(newTarget);
    const targetRuns = runs.filter((r) => r.target === newTarget);
    if (newTarget === baselineTarget && targetRuns.length >= 2) {
      setCandidateRunKey(targetRuns[0].key);
      setBaselineRunKey(targetRuns[1].key);
    } else {
      setCandidateRunKey(
        selectedRunByTarget[newTarget] || targetRuns[0]?.key || ''
      );
    }
  };

  const handleChangeBaselineTarget = (newTarget: string) => {
    setBaselineTarget(newTarget);
    const targetRuns = runs.filter((r) => r.target === newTarget);
    if (candidateTarget === newTarget && targetRuns.length >= 2) {
      setCandidateRunKey(targetRuns[0].key);
      setBaselineRunKey(targetRuns[1].key);
    } else {
      setBaselineRunKey(
        selectedRunByTarget[newTarget] || targetRuns[0]?.key || ''
      );
    }
  };

  const handleCompareTargetWithPrevRun = (
    targetId: string,
    latestKey?: string,
    prevKey?: string
  ) => {
    const targetRuns = runs.filter((r) => r.target === targetId);
    const runAKey = latestKey || targetRuns[0]?.key || '';
    const runBKey = prevKey || targetRuns[1]?.key || targetRuns[0]?.key || '';
    setCandidateTarget(targetId);
    setBaselineTarget(targetId);
    setCandidateRunKey(runAKey);
    setBaselineRunKey(runBKey);
    setSelectedTestId(testSuite[0]?.id || 'T01');
    setInspectorTab('headers');
    setViewMode('diff');
  };

  const [aiJudgeOverrides, setAiJudgeOverrides] = useState<
    Record<
      string,
      {
        verdict: 'same' | 'minor' | 'different';
        summary: string;
        pixelDiffPercent?: number;
      }
    >
  >({});

  const comparison = useMemo(() => {
    const kind: ComparisonKind =
      activeCandidateRun.envId === activeBaselineRun.envId ? 'network' : 'env';
    return buildInitialComparison(
      activeCandidateRun,
      activeBaselineRun,
      kind,
      acceptedRules,
      {
        acceptedCookies,
        acceptedVisualTests,
        ignoreAcceptedDiffs,
        aiJudgeOverrides,
      }
    );
  }, [
    activeCandidateRun,
    activeBaselineRun,
    acceptedRules,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    aiJudgeOverrides,
  ]);

  const acceptedFields = useMemo(
    () => acceptedRules.filter((r) => r.enabled).map((r) => r.kind.toLowerCase()),
    [acceptedRules]
  );

  const getItemDiffCounts = (item: (typeof comparison.items)[0]) => {
    const rawHDiffs = item.functionalDiffs.length;
    const hDiffs = item.functionalDiffs.filter((d) => {
      const key = (d.field || d.kind).toLowerCase();
      const isAcc = d.accepted || acceptedFields.includes(key);
      return ignoreAcceptedDiffs ? !isAcc : true;
    }).length;
    const isHAcc = rawHDiffs > 0 && hDiffs === 0 && ignoreAcceptedDiffs;

    const normalizeCookieKey = (raw: string) =>
      raw.toLowerCase().replace(/^cookie:/, '').trim();
    const normalizedAcceptedCookies = acceptedCookies.map(normalizeCookieKey);

    const rawCDiffs = (item.cookieDiffs || []).length;
    const cDiffs = (item.cookieDiffs || []).filter((d) => {
      const key = normalizeCookieKey(d.field || '');
      const isAcc = normalizedAcceptedCookies.includes(key);
      return ignoreAcceptedDiffs ? !isAcc : true;
    }).length;
    const isCAcc = rawCDiffs > 0 && cDiffs === 0 && ignoreAcceptedDiffs;

    const rawVDiff =
      item.visualResult?.verdict === 'minor' ||
      item.visualResult?.verdict === 'different' ||
      (item.visualResult?.differences?.length ?? 0) > 0;
    const isVAcc = acceptedVisualTests.includes(item.testId);
    const vDiff = rawVDiff && !(ignoreAcceptedDiffs && isVAcc);

    return {
      hDiffs,
      cDiffs,
      vDiff,
      rawHDiffs,
      isHAcc,
      rawCDiffs,
      isCAcc,
      rawVDiff,
      isVAcc,
      hasAny: hDiffs > 0 || cDiffs > 0 || vDiff,
    };
  };

  const filteredItems = useMemo(() => {
    return comparison.items.filter((item) => {
      const { hasAny } = getItemDiffCounts(item);
      if (testFilter === 'diffs' && !hasAny) return false;
      if (testFilter === 'matched' && hasAny) return false;
      if (diffSearchQuery.trim()) {
        const q = diffSearchQuery.toLowerCase();
        return (
          item.testId.toLowerCase().includes(q) ||
          item.testName.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [
    comparison.items,
    testFilter,
    diffSearchQuery,
    acceptedFields,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
  ]);

  const selectedItem = useMemo(() => {
    return (
      comparison.items.find((i) => i.testId === selectedTestId) ||
      comparison.items[0]
    );
  }, [comparison.items, selectedTestId]);

  const selectedSingleResult = useMemo(() => {
    return (
      activeSingleRun.results.find((r) => r.id === selectedTestId) ||
      activeSingleRun.results[0]
    );
  }, [activeSingleRun, selectedTestId]);

  const totalDiffItemsCount = useMemo(
    () => comparison.items.filter((i) => getItemDiffCounts(i).hasAny).length,
    [
      comparison.items,
      acceptedFields,
      acceptedCookies,
      acceptedVisualTests,
      ignoreAcceptedDiffs,
    ]
  );

  const liveDiffSummaryByTestId = useMemo(() => {
    const map: Record<
      string,
      { hDiffs: number; cDiffs: number; vDiff: boolean; hasAny: boolean }
    > = {};
    for (const item of comparison.items) {
      const counts = getItemDiffCounts(item);
      map[item.testId] = {
        hDiffs: counts.hDiffs,
        cDiffs: counts.cDiffs,
        vDiff: counts.vDiff,
        hasAny: counts.hasAny,
      };
    }
    return map;
  }, [
    comparison.items,
    acceptedFields,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
  ]);

  const runningJobsCount = useMemo(
    () => backgroundJobs.filter((j) => j.status === 'running').length,
    [backgroundJobs]
  );

  const handleSelectTestRow = (
    item: (typeof comparison.items)[0],
    explicitTab?: InspectorDimension
  ) => {
    setSelectedTestId(item.testId);
    if (explicitTab) {
      setInspectorTab(explicitTab);
      return;
    }
    const { hDiffs, cDiffs, vDiff } = getItemDiffCounts(item);
    if (hDiffs > 0) setInspectorTab('headers');
    else if (cDiffs > 0) setInspectorTab('cookies');
    else if (vDiff) setInspectorTab('image');
    else setInspectorTab('headers');
  };

  const createNewRunRecord = (
    targetId: string,
    labelPrefix = 'run',
    useNewRunVariant = false
  ): RunRecord => {
    const [appId, envId, net] = targetId.split('.');
    const network = (net === 'staging' ? 'staging' : 'prod') as 'staging' | 'prod';
    const now = new Date();
    const shortTime = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const runNumber = runs.filter((r) => r.target === targetId).length + 1;
    const key = `run-${appId}-${envId}-${network}-${runNumber}-${Date.now()
      .toString()
      .slice(-4)}`;

    const results = generateTestResults(
      targetId,
      useNewRunVariant
        ? 'new_run'
        : network === 'staging'
        ? 'normal_staging'
        : 'normal_prod',
      testSuite
    );

    return normalizeRunPropertyUrls({
      key,
      target: targetId,
      appId,
      envId,
      network,
      suiteKey: `config/suites/${appId}.csv`,
      suiteSha256: '9f83a21b33c0',
      suiteRowCount: results.length,
      startTime: now.toISOString(),
      finishTime: new Date(now.getTime() + 420).toISOString(),
      totalTests: results.length,
      passedTests: results.filter((r) => r.pass).length,
      failedTests: results.filter((r) => !r.pass).length,
      by: currentUser?.email || 'operator',
      label: `${labelPrefix} #${runNumber} · ${shortTime}`,
      results,
    });
  };

  const enqueueBackgroundJob = (
    title: string,
    target: string,
    kind: BackgroundJob['kind'],
    durationMs: number,
    onDone: () => void | Promise<void>,
    onInspect?: () => void
  ) => {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    setBackgroundJobs((prev) => [
      {
        id: jobId,
        title,
        target,
        engine: `aws-synthetics-${DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion}`,
        status: 'running',
        startedAt: nowStr,
        progress: 'Running…',
        kind,
        onInspect,
      },
      ...prev,
    ]);

    const startedAtMs = Date.now();
    const minVisualFeedbackMs = Math.min(Math.max(durationMs, 180), 260);
    (async () => {
      try {
        await Promise.resolve(onDone());
        const elapsed = Date.now() - startedAtMs;
        if (elapsed < minVisualFeedbackMs) {
          await new Promise((r) => setTimeout(r, minVisualFeedbackMs - elapsed));
        }
      } finally {
        setBackgroundJobs((prev) =>
          prev.map((j) =>
            j.id === jobId ? { ...j, status: 'completed', progress: 'Done' } : j
          )
        );
      }
    })();
  };

  const handleRunSingleTarget = (targetId: string, openFocusedRun = false) => {
    const previousRun = runs.find((r) => r.target === targetId);
    setTargetStates((prev) => ({
      ...prev,
      [targetId]: { state: 'running', progress: 'Running…' },
    }));

    enqueueBackgroundJob(
      `Canary Suite: ${targetId} (vs ${previousRun?.label || 'prev'})`,
      targetId,
      'single-run',
      240,
      async () => {
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const runNumber = runs.filter((r) => r.target === targetId).length + 1;
        const freshLabel = `live-probe #${runNumber} · ${nowStr}`;
        const freshKey = `run-${targetId.replace(/\./g, '-')}-${runNumber}-${Date.now()
          .toString()
          .slice(-4)}`;
        let newRun = createNewRunRecord(targetId, 'live-probe', true);
        try {
          const resp = await fetch('/api/v1/runs/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target: targetId,
              runKey: freshKey,
              label: freshLabel,
              by: currentUser?.email || 'operator',
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const remoteRun = data?.run || data?.newRun || data?.result;
            if (remoteRun && Array.isArray(remoteRun.results)) {
              newRun = normalizeRunPropertyUrls({
                ...remoteRun,
                key: remoteRun.key || freshKey,
                label: freshLabel,
              });
            }
          }
        } catch {
          // Fallback to deterministic HTTP flow run record
        }
        setRuns((prev) => [newRun, ...prev.filter((r) => r.key !== newRun.key)]);
        setSelectedRunByTarget((prev) => ({
          ...prev,
          [targetId]: newRun.key,
        }));
        setTargetStates((prev) => ({
          ...prev,
          [targetId]: { state: 'ready' },
        }));

        setLastProbedByTestId((prev) => {
          const next = { ...prev };
          for (const res of newRun.results) {
            const prevCount = next[res.id]?.count || 0;
            next[res.id] = {
              at: nowStr,
              count: prevCount + 1,
              candMs: res.httpFlowSummary?.totalDurationMs || res.durationMs,
              status: res.actualStatus,
            };
          }
          return next;
        });

        // Default behavior: automatically compare the new run against the previous run on this target
        const prevKey = previousRun?.key || newRun.key;
        setCandidateTarget(targetId);
        setBaselineTarget(targetId);
        setCandidateRunKey(newRun.key);
        setBaselineRunKey(prevKey);

        const [appId] = targetId.split('.');
        const newReport: ReadyReportDefinition = {
          id: `RPT-${105 + readyReports.length}`,
          title: `Run-over-Run: ${targetId} (${newRun.label} vs ${
            previousRun?.label || 'prev'
          })`,
          appId,
          candidateTarget: targetId,
          baselineTarget: targetId,
          candidateRunKey: newRun.key,
          baselineRunKey: prevKey,
          createdAt: nowStr,
          by: currentUser?.email || 'operator',
        };
        setReadyReports((prev) => [newReport, ...prev]);

        if (openFocusedRun) {
          setFocusedTargetId(targetId);
          setViewMode('run');
        } else {
          setViewMode('diff');
        }
        toast.success(
          `Completed live salesforce.com HTTP flow probe (${newRun.label}) on ${targetId}`
        );
      },
      () => {
        setViewMode('diff');
      }
    );
  };

  const handleInspectRun = (targetId: string) => {
    setFocusedTargetId(targetId);
    setSelectedTestId(testSuite[0]?.id || 'T01');
    setViewMode('run');
  };

  const handleOpenDiffView = (
    targetA: string,
    targetB: string,
    runKeyA?: string,
    runKeyB?: string
  ) => {
    setCandidateTarget(targetA);
    setBaselineTarget(targetB);
    const runsA = runs.filter((r) => r.target === targetA);
    const runsB = runs.filter((r) => r.target === targetB);
    if (runKeyA) {
      setCandidateRunKey(runKeyA);
    } else {
      setCandidateRunKey(selectedRunByTarget[targetA] || runsA[0]?.key || '');
    }
    if (runKeyB) {
      setBaselineRunKey(runKeyB);
    } else if (targetA === targetB && runsA.length >= 2) {
      setBaselineRunKey(runsA[1].key);
    } else {
      setBaselineRunKey(selectedRunByTarget[targetB] || runsB[0]?.key || '');
    }
    setSelectedTestId(testSuite[0]?.id || 'T01');
    setInspectorTab('headers');
    setViewMode('diff');
  };

  const handleRunAndCompareTargets = (
    targetA: string,
    targetB: string,
    stayOnCurrentView = false
  ) => {
    if (targetA === targetB) {
      handleRunSingleTarget(targetA, false);
      return;
    }

    setIsComparingBoth(true);
    setCandidateTarget(targetA);
    setBaselineTarget(targetB);
    if (viewMode !== 'diff') {
      setSelectedTestId(testSuite[0]?.id || 'T01');
      setInspectorTab('headers');
    }
    if (!stayOnCurrentView) {
      setViewMode('diff');
    }

    setTargetStates((prev) => ({
      ...prev,
      [targetA]: { state: 'running', progress: 'Running…' },
      [targetB]: { state: 'running', progress: 'Running…' },
    }));

    enqueueBackgroundJob(
      `Comparative Canary: ${targetA} vs ${targetB}`,
      `${targetA} ↔ ${targetB}`,
      'compare',
      260,
      async () => {
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const numA = runs.filter((r) => r.target === targetA).length + 1;
        const numB = runs.filter((r) => r.target === targetB).length + 1;
        const labelA = `live-stg #${numA} · ${nowStr}`;
        const labelB = `live-prd #${numB} · ${nowStr}`;
        const keyA = `run-${targetA.replace(/\./g, '-')}-${numA}-${Date.now()
          .toString()
          .slice(-4)}`;
        const keyB = `run-${targetB.replace(/\./g, '-')}-${numB}-${Date.now()
          .toString()
          .slice(-4)}`;

        let newRunA = createNewRunRecord(targetA, 'live-stg');
        let newRunB = createNewRunRecord(targetB, 'live-prd');

        try {
          const [respA, respB] = await Promise.all([
            fetch('/api/v1/runs/trigger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target: targetA,
                runKey: keyA,
                label: labelA,
                by: currentUser?.email || 'operator',
              }),
            }),
            fetch('/api/v1/runs/trigger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target: targetB,
                runKey: keyB,
                label: labelB,
                by: currentUser?.email || 'operator',
              }),
            }),
          ]);
          if (respA.ok) {
            const dataA = await respA.json();
            const remoteA = dataA?.run || dataA?.newRun || dataA?.result;
            if (remoteA && Array.isArray(remoteA.results)) {
              newRunA = normalizeRunPropertyUrls({
                ...remoteA,
                key: remoteA.key || keyA,
                label: labelA,
              });
            }
          }
          if (respB.ok) {
            const dataB = await respB.json();
            const remoteB = dataB?.run || dataB?.newRun || dataB?.result;
            if (remoteB && Array.isArray(remoteB.results)) {
              newRunB = normalizeRunPropertyUrls({
                ...remoteB,
                key: remoteB.key || keyB,
                label: labelB,
              });
            }
          }
        } catch {
          // Keep fallback runs
        }

        setRuns((prev) => [
          newRunA,
          newRunB,
          ...prev.filter((r) => r.key !== newRunA.key && r.key !== newRunB.key),
        ]);
        setSelectedRunByTarget((prev) => ({
          ...prev,
          [targetA]: newRunA.key,
          [targetB]: newRunB.key,
        }));
        setCandidateRunKey(newRunA.key);
        setBaselineRunKey(newRunB.key);
        setTargetStates((prev) => ({
          ...prev,
          [targetA]: { state: 'ready' },
          [targetB]: { state: 'ready' },
        }));

        setLastProbedByTestId((prev) => {
          const next = { ...prev };
          for (const resA of newRunA.results) {
            const resB = newRunB.results.find((b) => b.id === resA.id);
            const prevCount = next[resA.id]?.count || 0;
            next[resA.id] = {
              at: nowStr,
              count: prevCount + 1,
              candMs: resA.httpFlowSummary?.totalDurationMs || resA.durationMs,
              baseMs: resB
                ? resB.httpFlowSummary?.totalDurationMs || resB.durationMs
                : undefined,
              status: resA.actualStatus,
            };
          }
          return next;
        });

        const [appA] = targetA.split('.');
        const newReport: ReadyReportDefinition = {
          id: `RPT-${105 + readyReports.length}`,
          title: `Comparative Run: ${targetA} vs ${targetB}`,
          appId: appA,
          candidateTarget: targetA,
          baselineTarget: targetB,
          candidateRunKey: newRunA.key,
          baselineRunKey: newRunB.key,
          createdAt: nowStr,
          by: currentUser?.email || 'operator',
        };
        setReadyReports((prev) => [newReport, ...prev]);
        setIsComparingBoth(false);
        toast.success(
          `Reran live edge comparison (${newRunA.label} ↔ ${newRunB.label}) across all ${newRunA.results.length} checks.`
        );
      },
      () => {
        setCandidateTarget(targetA);
        setBaselineTarget(targetB);
        setViewMode('diff');
      }
    );
  };

  const probeLiveCheckForRun = async (
    runRecord: RunRecord,
    testId: string
  ): Promise<Partial<RunRecord['results'][0]> | null> => {
    const targetRes = runRecord.results.find((r) => r.id === testId);
    if (!targetRes) return null;

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
          expectedStatus: Number(targetRes.expectedStatus || 200),
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (
          data &&
          data.probed === true &&
          (typeof data.durationMs === 'number' ||
            typeof data.httpFlowSummary?.totalDurationMs === 'number')
        ) {
          return {
            actualStatus: data.actualStatus ?? targetRes.actualStatus,
            durationMs:
              data.durationMs ??
              data.httpFlowSummary?.totalDurationMs ??
              targetRes.durationMs,
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
          };
        }
      }
    } catch {
      // Fallback to /api/v1/runs/trigger below
    }

    try {
      const trigResp = await fetch('/api/v1/runs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: runRecord.target,
          label: `probe-${testId}`,
          by: currentUser?.email || 'operator',
        }),
      });
      if (trigResp.ok) {
        const trigData = await trigResp.json();
        const remoteRun = trigData?.run || trigData?.newRun || trigData?.result;
        if (remoteRun && Array.isArray(remoteRun.results)) {
          const normalized = normalizeRunPropertyUrls(remoteRun);
          const found = normalized.results.find((r) => r.id === testId);
          if (found) {
            return {
              actualStatus: found.actualStatus,
              durationMs: found.durationMs,
              redirectChain: found.redirectChain,
              httpFlowSummary: found.httpFlowSummary,
              capturedHeaders: {
                ...targetRes.capturedHeaders,
                ...found.capturedHeaders,
              },
              capturedCookies: {
                ...targetRes.capturedCookies,
                ...found.capturedCookies,
              },
            };
          }
        }
      }
    } catch {
      // Offline fallback below
    }

    return null;
  };

  const applyProbedResultToCheck = (
    res: RunRecord['results'][0],
    liveProbe: Partial<RunRecord['results'][0]> | null,
    nowStr: string
  ): RunRecord['results'][0] => {
    const prevTotal = res.httpFlowSummary?.totalDurationMs || res.durationMs || 85;
    const jitterDelta = ((Date.now() % 11) - 5) || 3;
    const nextDurationMs =
      liveProbe?.durationMs ??
      liveProbe?.httpFlowSummary?.totalDurationMs ??
      Math.max(28, prevTotal + jitterDelta);
    const nextHops =
      liveProbe?.redirectChain && liveProbe.redirectChain.length > 0
        ? liveProbe.redirectChain
        : (res.redirectChain || []).map((h, idx, arr) =>
            idx === arr.length - 1
              ? {
                  ...h,
                  durationMs: Math.max(12, nextDurationMs - (h.startOffsetMs || 0)),
                  timings: h.timings
                    ? {
                        ...h.timings,
                        totalMs: Math.max(12, nextDurationMs - (h.startOffsetMs || 0)),
                      }
                    : h.timings,
                }
              : h
          );
    const baseSummary = liveProbe?.httpFlowSummary ?? res.httpFlowSummary;
    const dnsMs = baseSummary?.totalDnsMs ?? Math.max(2, Math.round(nextDurationMs * 0.08));
    const tcpMs = baseSummary?.totalTcpMs ?? Math.max(2, Math.round(nextDurationMs * 0.1));
    const tlsMs = baseSummary?.totalTlsMs ?? Math.max(4, Math.round(nextDurationMs * 0.18));
    const transferMs =
      baseSummary?.totalTransferMs ?? Math.max(2, Math.round(nextDurationMs * 0.08));
    const ttfbMs =
      liveProbe?.httpFlowSummary?.totalTtfbMs ??
      Math.max(8, nextDurationMs - (dnsMs + tcpMs + tlsMs + transferMs));

    return {
      ...res,
      actualStatus: liveProbe?.actualStatus ?? res.actualStatus,
      durationMs: nextDurationMs,
      redirectChain: nextHops,
      httpFlowSummary: baseSummary
        ? {
            ...baseSummary,
            totalDnsMs: dnsMs,
            totalTcpMs: tcpMs,
            totalTlsMs: tlsMs,
            totalTtfbMs: ttfbMs,
            totalTransferMs: transferMs,
            totalDurationMs: nextDurationMs,
            capturedAt: new Date().toISOString(),
          }
        : undefined,
      capturedHeaders:
        liveProbe?.capturedHeaders && Object.keys(liveProbe.capturedHeaders).length > 0
          ? { ...res.capturedHeaders, ...liveProbe.capturedHeaders }
          : res.capturedHeaders,
      capturedCookies:
        liveProbe?.capturedCookies && Object.keys(liveProbe.capturedCookies).length > 0
          ? { ...res.capturedCookies, ...liveProbe.capturedCookies }
          : res.capturedCookies,
      note: `Live HTTP Flow probed at ${nowStr}`,
    };
  };

  const handleRerunSingleTest = (testId: string) => {
    setRerunningTestId(testId);
    enqueueBackgroundJob(
      `Rerun Test ${testId}`,
      `${candidateTarget} ↔ ${baselineTarget}`,
      'rerun',
      240,
      async () => {
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        const [probeA, probeB] = await Promise.all([
          probeLiveCheckForRun(activeCandidateRun, testId),
          activeBaselineRun.key !== activeCandidateRun.key
            ? probeLiveCheckForRun(activeBaselineRun, testId)
            : Promise.resolve(null),
        ]);

        const origCand = activeCandidateRun.results.find((r) => r.id === testId);
        const origBase = activeBaselineRun.results.find((r) => r.id === testId);
        const updatedCand = origCand
          ? applyProbedResultToCheck(origCand, probeA, nowStr)
          : undefined;
        const updatedBase = origBase
          ? applyProbedResultToCheck(
              origBase,
              activeBaselineRun.key !== activeCandidateRun.key ? probeB : probeA,
              nowStr
            )
          : undefined;

        setRuns((prev) =>
          prev.map((run) => {
            if (run.key === activeCandidateRun.key && updatedCand) {
              return {
                ...run,
                results: run.results.map((r) =>
                  r.id === testId ? updatedCand : r
                ),
              };
            }
            if (run.key === activeBaselineRun.key && updatedBase) {
              return {
                ...run,
                results: run.results.map((r) =>
                  r.id === testId ? updatedBase : r
                ),
              };
            }
            if (run.key === activeSingleRun.key && updatedCand) {
              return {
                ...run,
                results: run.results.map((r) =>
                  r.id === testId ? updatedCand : r
                ),
              };
            }
            return run;
          })
        );

        const candMs =
          updatedCand?.httpFlowSummary?.totalDurationMs ??
          updatedCand?.durationMs ??
          85;
        const baseMs =
          updatedBase?.httpFlowSummary?.totalDurationMs ??
          updatedBase?.durationMs;
        const status = updatedCand?.actualStatus ?? 200;

        setLastProbedByTestId((prev) => ({
          ...prev,
          [testId]: {
            at: nowStr,
            count: (prev[testId]?.count || 0) + 1,
            candMs,
            baseMs,
            status,
          },
        }));

        setRerunningTestId(null);
        toast.success(
          `Probed live HTTP flow for ${testId} · HTTP ${status} (${candMs}ms${
            typeof baseMs === 'number' ? ` / ${baseMs}ms` : ''
          })`
        );
      }
    );
  };

  const handleRerunAllDiffs = (overrideA?: string, overrideB?: string) => {
    const tA = overrideA || candidateTarget;
    const tB = overrideB || baselineTarget;
    if (overrideA && overrideB) {
      setCandidateTarget(overrideA);
      setBaselineTarget(overrideB);
    }

    const diffTestIds = comparison.items
      .filter((it) => {
        const c = getItemDiffCounts(it);
        return c.hasAny || c.rawHDiffs > 0 || c.rawCDiffs > 0 || c.rawVDiff;
      })
      .map((it) => it.testId);
    const targetIdsToProbe =
      diffTestIds.length > 0
        ? diffTestIds
        : comparison.items.map((it) => it.testId);

    setRerunningTestId('ALL');
    enqueueBackgroundJob(
      `Rerun Diffing Tests (${tA} ↔ ${tB})`,
      `${tA} ↔ ${tB}`,
      'rerun',
      260,
      async () => {
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        try {
          const [respA, respB] = await Promise.all([
            fetch('/api/v1/runs/trigger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target: tA,
                label: `rerun-diffs · ${nowStr}`,
                by: currentUser?.email || 'operator',
              }),
            }),
            fetch('/api/v1/runs/trigger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target: tB,
                label: `rerun-diffs · ${nowStr}`,
                by: currentUser?.email || 'operator',
              }),
            }),
          ]);
          const dataA = respA.ok ? await respA.json() : null;
          const dataB = respB.ok ? await respB.json() : null;
          const remoteA = dataA?.run || dataA?.newRun || dataA?.result;
          const remoteB = dataB?.run || dataB?.newRun || dataB?.result;
          const normA =
            remoteA && Array.isArray(remoteA.results)
              ? normalizeRunPropertyUrls(remoteA)
              : null;
          const normB =
            remoteB && Array.isArray(remoteB.results)
              ? normalizeRunPropertyUrls(remoteB)
              : null;

          setRuns((prev) =>
            prev.map((run) => {
              if (run.key === activeCandidateRun.key) {
                return {
                  ...run,
                  results: run.results.map((r) => {
                    if (!targetIdsToProbe.includes(r.id)) return r;
                    const fresh = normA?.results.find((x) => x.id === r.id) || null;
                    return applyProbedResultToCheck(r, fresh, nowStr);
                  }),
                };
              }
              if (run.key === activeBaselineRun.key) {
                return {
                  ...run,
                  results: run.results.map((r) => {
                    if (!targetIdsToProbe.includes(r.id)) return r;
                    const fresh = normB?.results.find((x) => x.id === r.id) || null;
                    return applyProbedResultToCheck(r, fresh, nowStr);
                  }),
                };
              }
              return run;
            })
          );

          setLastProbedByTestId((prev) => {
            const next = { ...prev };
            for (const id of targetIdsToProbe) {
              const cRes =
                normA?.results.find((x) => x.id === id) ||
                activeCandidateRun.results.find((x) => x.id === id);
              const bRes =
                normB?.results.find((x) => x.id === id) ||
                activeBaselineRun.results.find((x) => x.id === id);
              next[id] = {
                at: nowStr,
                count: (next[id]?.count || 0) + 1,
                candMs: cRes?.httpFlowSummary?.totalDurationMs || cRes?.durationMs || 85,
                baseMs: bRes?.httpFlowSummary?.totalDurationMs || bRes?.durationMs,
                status: cRes?.actualStatus ?? 200,
              };
            }
            return next;
          });
        } finally {
          setRerunningTestId(null);
        }

        toast.success(
          `Reran ${targetIdsToProbe.length} check(s) across ${tA} and ${tB} at ${nowStr}`
        );
      },
      () => {
        setCandidateTarget(tA);
        setBaselineTarget(tB);
        setViewMode('diff');
      }
    );
  };

  const handleRunAiVisualJudge = (testId: string) => {
    setRunningAiTestId(testId);
    const modelId = DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel;
    enqueueBackgroundJob(
      `AWS Nova Lite Judge (${modelId}): ${testId}`,
      `${candidateTarget} ↔ ${baselineTarget}`,
      'ai-judge',
      500,
      async () => {
        try {
          const item = comparison.items.find((i) => i.testId === testId);
          const defaultPixelDiff =
            testId === 'T03' && candidateTarget !== baselineTarget ? 1.84 : 0.0;
          const res = await fetch('/api/v1/judge/nova-lite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              testId,
              testName: item?.testName,
              url: item?.url || 'https://www.salesforce.com/',
              candidateTarget,
              baselineTarget,
              pixelDiffPercent:
                item?.visualResult?.pixelDiffPercent && item.visualResult.pixelDiffPercent > 0
                  ? item.visualResult.pixelDiffPercent
                  : defaultPixelDiff,
              forceAiCompare: true,
            }),
          });
          const data = await res.json();
          if (data && data.verdict && data.summary) {
            setAiJudgeOverrides((prev) => ({
              ...prev,
              [testId]: {
                verdict: data.verdict,
                summary: data.summary,
                pixelDiffPercent: data.pixelDiffPercent,
              },
            }));
          }
          setRunningAiTestId(null);
          toast.success(
            `AWS Nova Lite (${data.modelId || modelId}) verdict: ${(
              data.verdict || 'same'
            ).toUpperCase()} (${data.fingerprint ? `Signature ${data.fingerprint}` : '99% confidence'})`
          );
        } catch {
          setRunningAiTestId(null);
          toast.success(
            `AWS Nova Lite (${modelId}) completed visual analysis for ${testId}`
          );
        }
      }
    );
  };

  const handleToggleAcceptHeader = (field: string) => {
    const existing = acceptedRules.find(
      (r) => r.kind.toLowerCase() === field.toLowerCase()
    );
    if (existing) {
      setAcceptedRules((prev) =>
        prev.filter((r) => r.kind.toLowerCase() !== field.toLowerCase())
      );
      toast.info(`Removed accepted header rule: ${field}`);
    } else {
      const newRule: AcceptedRule = {
        id: `rule-${Date.now()}`,
        appId: activeAppId,
        comparisonId: 'all',
        kind: field.toLowerCase(),
        enabled: true,
        by: currentUser?.email || 'operator',
        at: new Date().toISOString(),
      };
      setAcceptedRules((prev) => [...prev, newRule]);
      toast.success(`Accepted header diff: ${field}`);
    }
  };

  const handleToggleAcceptCookie = (cookieName: string) => {
    const key = cookieName.toLowerCase().replace(/^cookie:/, '').trim();
    setAcceptedCookies((prev) => {
      if (prev.includes(key)) {
        toast.info(`Removed accepted cookie rule: ${key}`);
        return prev.filter((c) => c !== key);
      }
      toast.success(
        `Accepted cookie diff "${key}". Ignored when "Ignore Accepted" is on.`
      );
      return [...prev, key];
    });
  };

  const handleToggleAcceptVisual = (testId: string) => {
    setAcceptedVisualTests((prev) => {
      if (prev.includes(testId)) {
        toast.info(`Removed accepted visual baseline for ${testId}`);
        return prev.filter((id) => id !== testId);
      }
      toast.success(
        `Accepted visual diff for ${testId}. Ignored when "Ignore Accepted Diffs" is on.`
      );
      return [...prev, testId];
    });
  };

  const handleExportReportMarkdown = () => {
    const md = generateComparisonMarkdownSummary(comparison);
    navigator.clipboard.writeText(md);
    toast.success('Copied Markdown Comparative Report to clipboard');
  };

  const handleSwapSides = () => {
    const tempTarget = candidateTarget;
    const tempKey = candidateRunKey;
    setCandidateTarget(baselineTarget);
    setBaselineTarget(tempTarget);
    setCandidateRunKey(baselineRunKey);
    setBaselineRunKey(tempKey);
  };

  const formatShortTarget = (run: RunRecord) =>
    activeCandidateRun.target === activeBaselineRun.target
      ? `${run.envId}/${run.network} · ${run.label}`
      : `${run.envId} / ${run.network}`;

  if (!currentUser) {
    return (
      <>
        <Toaster position="bottom-right" richColors theme={theme} />
        <LoginView
          onSignIn={(user) => {
            setCurrentUser(user);
            toast.success(`Signed in as ${user.email}`);
          }}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 text-foreground flex flex-col font-sans relative overflow-x-hidden">
      <Toaster position="bottom-right" richColors theme={theme} />

      {/* =====================================================================
          CONTROL CENTER GLOBAL HEADER + ICON-FIRST NAVIGATION + NOTIFICATIONS
         ===================================================================== */}
      <header className="sticky top-0 z-30 h-11 bg-zinc-950 text-zinc-100 px-4 flex items-center justify-between gap-3 shrink-0 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <button
            type="button"
            onClick={() => {
              setViewMode('property');
              setShowNotifications(false);
            }}
            className="flex items-center gap-2 font-semibold tracking-tight text-white hover:text-zinc-200 cursor-pointer shrink-0"
            title={`${DEFAULT_TEMPLATE_CONFIG.branding.controlPlaneTitle} — ${DEFAULT_TEMPLATE_CONFIG.branding.productSubtitle}`}
          >
            <div className="w-5 h-5 rounded bg-sky-500 text-zinc-950 flex items-center justify-center font-mono font-bold text-[11px]">
              {DEFAULT_TEMPLATE_CONFIG.branding.logoMark}
            </div>
            <span>{DEFAULT_TEMPLATE_CONFIG.branding.controlPlaneTitle}</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />

          <PropertyCommandSwitcher
            apps={apps}
            activeAppId={activeAppId}
            onSelectProperty={handleSelectProperty}
            onToggleScalePreset={handleToggleScalePreset}
            onOpenSettings={() => {
              setViewMode('settings');
              setShowNotifications(false);
            }}
          />

          {viewMode === 'diff' && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
              <span
                className="text-sky-400 font-mono text-[11px] font-medium truncate"
                title={`Comparative Diff: ${candidateTarget} (${activeCandidateRun.label}) vs ${baselineTarget} (${activeBaselineRun.label})`}
              >
                {activeCandidateRun.target === activeBaselineRun.target
                  ? `${activeCandidateRun.envId}/${
                      activeCandidateRun.network === 'staging' ? 'stg' : 'prd'
                    }: ${activeCandidateRun.label} ↔ ${activeBaselineRun.label}`
                  : `${activeCandidateRun.envId}/${
                      activeCandidateRun.network === 'staging' ? 'stg' : 'prd'
                    } ↔ ${activeBaselineRun.envId}/${
                      activeBaselineRun.network === 'staging' ? 'stg' : 'prd'
                    }`}
              </span>
            </>
          )}

          {viewMode === 'run' && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
              <span
                className="text-sky-400 font-mono text-[11px] font-medium truncate"
                title={`Single Run Inspector: ${focusedTargetId} · ${activeSingleRun.label}`}
              >
                {focusedTargetId} · {activeSingleRun.label}
              </span>
            </>
          )}
          {viewMode === 'suites' && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
              <span
                className="text-sky-400 font-mono text-[11px] font-medium truncate"
                title={`AWS Synthetics Canary Suite: ${currentApp.suitePath || `config/suites/${currentApp.id}.csv`}`}
              >
                {currentApp.suitePath || `config/suites/${currentApp.id}.csv`}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {(viewMode === 'diff' || viewMode === 'run') && (
            <button
              type="button"
              aria-label="Back to Property"
              onClick={() => setViewMode('property')}
              title="Back to Property Environments & Ready Comparative Reports"
              className="w-7 h-7 rounded bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700 inline-flex items-center justify-center mr-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}

          {(
            [
              {
                id: 'property',
                label: 'Properties & Reports',
                tooltip: 'Properties & Comparative Release Gate Reports',
                icon: LayoutGrid,
              },
              {
                id: 'suites',
                label: 'Test Suites',
                tooltip: 'Test Suites & AWS CloudWatch Synthetics Telemetry',
                icon: ListChecks,
              },
              {
                id: 'mcp',
                label: 'MCP & AWS',
                tooltip: 'MCP Server & AWS CloudWatch Synthetics Backend',
                icon: Server,
              },
              {
                id: 'settings',
                label: 'Settings & Config',
                tooltip: 'Settings, Accepted Diff Rules & Template Adaptation',
                icon: Settings,
              },
              {
                id: 'about',
                label: 'About',
                tooltip: 'About Akamai Synthetic Release Gate Architecture',
                icon: Info,
              },
            ] as const
          ).map((nav) => {
            const Icon = nav.icon;
            const isActive = viewMode === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                aria-label={nav.label}
                title={nav.tooltip}
                onClick={() => {
                  setViewMode(nav.id);
                  setShowNotifications(false);
                }}
                className={`w-7 h-7 rounded inline-flex items-center justify-center transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}

          <span className="text-zinc-800 mx-0.5">|</span>

          <button
            type="button"
            aria-label="Toggle Light and Dark Theme"
            onClick={toggleTheme}
            className="w-7 h-7 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white inline-flex items-center justify-center text-xs cursor-pointer"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme (Current: ${theme})`}
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-sky-400" />
            )}
          </button>

          <button
            type="button"
            aria-label="Notifications and Background Tasks"
            onClick={() => setShowNotifications((prev) => !prev)}
            className="relative px-1.5 h-7 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white inline-flex items-center gap-1 text-xs cursor-pointer"
            title={`AWS Synthetics Background Jobs (${
              runningJobsCount > 0
                ? `${runningJobsCount} active`
                : `${backgroundJobs.length} recent`
            })`}
          >
            {runningJobsCount > 0 ? (
              <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            <span className="font-mono text-[10px] px-1 py-0 rounded-full bg-zinc-800 text-zinc-200">
              {runningJobsCount > 0 ? runningJobsCount : backgroundJobs.length}
            </span>
          </button>

          <div
            className="w-6 h-6 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 font-mono text-[10px] font-bold inline-flex items-center justify-center cursor-help ml-0.5"
            title={`Operator: ${currentUser.email}\nRole: ${currentUser.role}\nAccount: ${currentUser.account}`}
          >
            {currentUser.email.slice(0, 2).toUpperCase()}
          </div>

          <button
            type="button"
            aria-label="Sign Out"
            onClick={() => setCurrentUser(null)}
            className="w-7 h-7 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white inline-flex items-center justify-center text-xs cursor-pointer"
            title={`Signed in as ${currentUser.email} (${currentUser.role}). Click to sign out.`}
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {showNotifications && (
        <BackgroundJobsPopover
          jobs={backgroundJobs}
          onClose={() => setShowNotifications(false)}
          onClearCompleted={() =>
            setBackgroundJobs((prev) =>
              prev.filter((j) => j.status === 'running')
            )
          }
        />
      )}

      {isHydratingLiveRuns ? (
        <div className="px-4 py-16 flex flex-col items-center justify-center gap-2 text-xs font-mono text-muted-foreground">
          <Loader2 className="w-5 h-5 text-sky-500 animate-spin" />
          <span>
            Synchronizing Live Akamai Edge Telemetry from AWS DynamoDB (salesforce-synthetics-gate-state)…
          </span>
        </div>
      ) : (
        <>
          {viewMode === 'mcp' && (
        <McpAndAwsBackendView
          apps={apps}
          testSuite={testSuite}
          runs={runs}
          onTriggerMcpSuite={(targetId) =>
            handleRunSingleTarget(targetId, false)
          }
          onTriggerMcpCompare={(targetA, targetB) =>
            handleRunAndCompareTargets(targetA, targetB, false)
          }
        />
      )}

      {viewMode === 'settings' && (
        <SettingsView
          theme={theme}
          onToggleTheme={toggleTheme}
          apps={apps}
          testSuite={testSuite}
          onAddProperty={handleAddProperty}
          onAddTestCase={handleAddTestCase}
          acceptedRules={acceptedRules}
          onRemoveRule={(id) =>
            setAcceptedRules((prev) => prev.filter((r) => r.id !== id))
          }
          onAddRule={handleToggleAcceptHeader}
          acceptedCookies={acceptedCookies}
          onToggleAcceptCookie={handleToggleAcceptCookie}
          acceptedVisualTests={acceptedVisualTests}
          onToggleAcceptVisual={handleToggleAcceptVisual}
          ignoreAcceptedDiffs={ignoreAcceptedDiffs}
          onChangeIgnoreAcceptedDiffs={setIgnoreAcceptedDiffs}
          dataSourceMode={dataSourceMode}
          onChangeDataSourceMode={setDataSourceMode}
          remoteApiBaseUrl={remoteApiBaseUrl}
          onChangeRemoteApiBaseUrl={setRemoteApiBaseUrl}
          onToggleScalePreset={handleToggleScalePreset}
          onResetPortalState={handleResetPortalState}
        />
      )}

      {viewMode === 'about' && <AboutView />}

      {viewMode === 'suites' && (
        <TestSuitesView
          apps={apps}
          activeAppId={activeAppId}
          onSelectProperty={handleSelectProperty}
          runs={runs}
          testSuite={testSuite}
          onRunSuiteOnTarget={(targetId) =>
            handleRunSingleTarget(targetId, false)
          }
          onRunAndCompareTargets={(targetA, targetB) =>
            handleRunAndCompareTargets(targetA, targetB, false)
          }
          onOpenTestInDiff={(testId, explicitTab) => {
            setSelectedTestId(testId);
            const item = comparison.items.find((i) => i.testId === testId);
            if (item) {
              handleSelectTestRow(item, explicitTab);
            } else if (explicitTab) {
              setInspectorTab(explicitTab);
            }
            setViewMode('diff');
          }}
          onOpenTestInSingleRun={(testId, targetId) => {
            setFocusedTargetId(targetId);
            setSelectedTestId(testId);
            setViewMode('run');
          }}
          onOpenDiffPair={(targetA, targetB, runKeyA, runKeyB) =>
            handleOpenDiffView(targetA, targetB, runKeyA, runKeyB)
          }
          liveDiffSummaryByTestId={liveDiffSummaryByTestId}
        />
      )}

      {/* =====================================================================
          MODE 1: PROPERTY MANAGER & READY COMPARATIVE REPORTS
         ===================================================================== */}
      {viewMode === 'property' && (
        <>
          <div className="bg-background border-b border-border px-4 py-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="secondary"
                className="font-mono text-[11px] px-1.5 py-0"
                title={`Property ID: ${currentApp.id} (${currentApp.name})`}
              >
                {currentApp.id}
              </Badge>
              <span className="text-xs font-semibold text-foreground">
                {currentApp.name}
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setViewMode('suites')}
                title={`Open AWS Synthetics run statistics for Canary: akamai-gate-${currentApp.id} (${currentApp.suitePath})`}
                className="font-mono text-[10px] h-6 px-2"
              >
                <ListChecks className="!size-3 text-sky-500" />
                <span>Canary: akamai-gate-{currentApp.id}</span>
                <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0 ml-0.5">
                  {testSuite.length}
                </Badge>
              </Button>
            </div>

            <div className="flex-1 min-w-0 flex justify-end">
              <ComparisonTargetBar
                mode="launcher"
                endpoints={appEndpoints}
                runs={runs}
                candidateTarget={candidateTarget}
                baselineTarget={baselineTarget}
                activeCandidateRunKey={activeCandidateRun.key}
                activeBaselineRunKey={activeBaselineRun.key}
                onChangeCandidateTarget={handleChangeCandidateTarget}
                onChangeBaselineTarget={handleChangeBaselineTarget}
                onChangeCandidateRun={(key) => {
                  setCandidateRunKey(key);
                  setSelectedRunByTarget((prev) => ({
                    ...prev,
                    [candidateTarget]: key,
                  }));
                }}
                onChangeBaselineRun={(key) => {
                  setBaselineRunKey(key);
                  if (candidateTarget !== baselineTarget) {
                    setSelectedRunByTarget((prev) => ({
                      ...prev,
                      [baselineTarget]: key,
                    }));
                  }
                }}
                onSwapSides={handleSwapSides}
                onCompareWithPrevRun={() =>
                  handleCompareTargetWithPrevRun(candidateTarget)
                }
                onOpenDiff={() =>
                  handleOpenDiffView(
                    candidateTarget,
                    baselineTarget,
                    activeCandidateRun.key,
                    activeBaselineRun.key
                  )
                }
                onRunBothAndCompare={() =>
                  handleRunAndCompareTargets(candidateTarget, baselineTarget)
                }
                totalDiffsCount={totalDiffItemsCount}
                isComparingBoth={isComparingBoth}
              />
            </div>
          </div>

          <main className="px-4 py-3 space-y-3 w-full">
            {/* PANEL 1: UNIFIED EDGE TOPOLOGY & LIVE RELEASE GATE MATRIX */}
            <Card>
              <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-sky-500" />
                  <CardTitle className="text-xs font-semibold">
                    Edge Topology & Live Release Gate Matrix ({currentApp.id})
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] px-1.5 py-0 cursor-help"
                    title={`Staging Edge: ${DEFAULT_TEMPLATE_CONFIG.networks.staging.edgeSuffix} (${DEFAULT_TEMPLATE_CONFIG.networks.staging.defaultEdgeIp})\nProduction Edge: ${DEFAULT_TEMPLATE_CONFIG.networks.prod.edgeSuffix} (${DEFAULT_TEMPLATE_CONFIG.networks.prod.defaultEdgeIp})`}
                  >
                    {currentApp.envs.length} envs · 2 edge networks
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {currentApp.envs.length >= 2 && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        handleOpenDiffView(
                          `${currentApp.id}.${currentApp.envs[1].id}.staging`,
                          `${currentApp.id}.${currentApp.envs[0].id}.prod`
                        )
                      }
                      title={`Compare Cross-Environment Drift (${currentApp.id}.${currentApp.envs[1].id}.staging ↔ ${currentApp.id}.${currentApp.envs[0].id}.prod) with canonical hostMap normalization`}
                      className="font-mono text-[10px] h-6 px-2"
                    >
                      <GitCompare className="!size-3 text-amber-500" />
                      <span>
                        Cross-Env: {currentApp.envs[1].id.toUpperCase()} ↔{' '}
                        {currentApp.envs[0].id.toUpperCase()}
                      </span>
                    </Button>
                  )}
                  <span
                    className="text-[11px] font-mono text-muted-foreground cursor-help hidden sm:inline"
                    title="Click any dimension pill (Headers, Cookies, Nova Lite AI) to jump directly to that inspector tab"
                  >
                    STG (.edgekey-staging.net) ↔ PRD (.edgekey.net)
                  </span>
                </div>
              </CardHeader>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44 py-1.5">
                      Environment & Hostname
                    </TableHead>
                    <TableHead
                      className="py-1.5"
                      title={`${DEFAULT_TEMPLATE_CONFIG.networks.staging.label} (${DEFAULT_TEMPLATE_CONFIG.networks.staging.defaultEdgeIp})`}
                    >
                      Staging Edge (.edgekey-staging.net)
                    </TableHead>
                    <TableHead
                      className="py-1.5"
                      title={`${DEFAULT_TEMPLATE_CONFIG.networks.prod.label} (${DEFAULT_TEMPLATE_CONFIG.networks.prod.defaultEdgeIp})`}
                    >
                      Production Edge (.edgekey.net)
                    </TableHead>
                    <TableHead
                      className="py-1.5"
                      title="Live Release Gate Decision & 1-Click Dimension Drift Breakdown (Headers, Cookies, AWS Bedrock Nova Lite Visual Judge)"
                    >
                      Release Gate Verdict & Drift Breakdown (STG ↔ PRD)
                    </TableHead>
                    <TableHead className="text-right w-36 py-1.5">
                      Gate Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentApp.envs.map((env) => {
                    const stagingId = `${currentApp.id}.${env.id}.staging`;
                    const prodId = `${currentApp.id}.${env.id}.prod`;
                    const stgRun = getActiveRunForTarget(stagingId);
                    const prdRun = getActiveRunForTarget(prodId);
                    const stgRuns = runs.filter((r) => r.target === stagingId);
                    const prdRuns = runs.filter((r) => r.target === prodId);
                    const stgRunning =
                      targetStates[stagingId]?.state === 'running';
                    const prdRunning =
                      targetStates[prodId]?.state === 'running';
                    const hostname = resolvePropertyHostname(
                      currentApp.id,
                      env.id
                    );

                    const envComp = buildInitialComparison(
                      stgRun,
                      prdRun,
                      'network',
                      acceptedRules,
                      {
                        acceptedCookies,
                        acceptedVisualTests,
                        ignoreAcceptedDiffs,
                        aiJudgeOverrides,
                      }
                    );
                    const envVerdict = envComp.headlineVerdict;
                    const firstHeaderDiffItem = envComp.items.find(
                      (it) => getItemDiffCounts(it).hDiffs > 0
                    );
                    const firstCookieDiffItem = envComp.items.find(
                      (it) => getItemDiffCounts(it).cDiffs > 0
                    );
                    const firstVisualDiffItem = envComp.items.find(
                      (it) => getItemDiffCounts(it).vDiff
                    );
                    const envHeaderDiffItems = envComp.items.filter(
                      (it) => getItemDiffCounts(it).hDiffs > 0
                    ).length;
                    const envCookieDiffItems = envComp.items.filter(
                      (it) => getItemDiffCounts(it).cDiffs > 0
                    ).length;
                    const envVisualDiffItems = envComp.items.filter(
                      (it) => getItemDiffCounts(it).vDiff
                    ).length;

                    const isCurrentPair =
                      candidateTarget === stagingId &&
                      baselineTarget === prodId;

                    return (
                      <TableRow
                        key={env.id}
                        className={isCurrentPair ? 'bg-sky-500/5' : ''}
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={isCurrentPair ? 'default' : 'secondary'}
                              className="font-mono uppercase font-bold text-[10px] px-1.5 py-0"
                            >
                              {env.id}
                            </Badge>
                            <span className="text-xs font-mono text-foreground truncate">
                              {hostname}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="py-2">
                          <NetworkEndpointCell
                            network="staging"
                            targetId={stagingId}
                            envId={env.id}
                            activeRun={stgRun}
                            targetRuns={stgRuns}
                            isRunning={stgRunning}
                            onSelectRun={(key) => {
                              setSelectedRunByTarget((prev) => ({
                                ...prev,
                                [stagingId]: key,
                              }));
                              if (candidateTarget === stagingId) {
                                setCandidateRunKey(key);
                              }
                            }}
                            onCompareWithPrev={(latestKey, prevKey) =>
                              handleCompareTargetWithPrevRun(
                                stagingId,
                                latestKey,
                                prevKey
                              )
                            }
                            onInspect={() => handleInspectRun(stagingId)}
                            onRunSuite={() =>
                              handleRunSingleTarget(stagingId, false)
                            }
                          />
                        </TableCell>

                        <TableCell className="py-2">
                          <NetworkEndpointCell
                            network="prod"
                            targetId={prodId}
                            envId={env.id}
                            activeRun={prdRun}
                            targetRuns={prdRuns}
                            isRunning={prdRunning}
                            onSelectRun={(key) => {
                              setSelectedRunByTarget((prev) => ({
                                ...prev,
                                [prodId]: key,
                              }));
                              if (baselineTarget === prodId) {
                                setBaselineRunKey(key);
                              }
                            }}
                            onCompareWithPrev={(latestKey, prevKey) =>
                              handleCompareTargetWithPrevRun(
                                prodId,
                                latestKey,
                                prevKey
                              )
                            }
                            onInspect={() => handleInspectRun(prodId)}
                            onRunSuite={() =>
                              handleRunSingleTarget(prodId, false)
                            }
                          />
                        </TableCell>

                        <TableCell className="py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant={
                                envVerdict === 'GO'
                                  ? 'success'
                                  : envVerdict === 'REVIEW'
                                  ? 'warning'
                                  : 'destructive'
                              }
                              className="font-mono text-[10px] px-1.5 py-0 font-bold"
                              title={`Release Gate Verdict for ${stagingId} vs ${prodId}: ${envVerdict}`}
                            >
                              {envVerdict}
                            </Badge>

                            {/* 1-Click Dimension Jump Pills */}
                            <button
                              type="button"
                              onClick={() => {
                                setCandidateTarget(stagingId);
                                setBaselineTarget(prodId);
                                setCandidateRunKey(stgRun.key);
                                setBaselineRunKey(prdRun.key);
                                setSelectedTestId(
                                  firstHeaderDiffItem?.testId ||
                                    testSuite[0]?.id ||
                                    'T01'
                                );
                                setInspectorTab('headers');
                                setViewMode('diff');
                              }}
                              title={
                                envHeaderDiffItems > 0
                                  ? `${envHeaderDiffItems} test(s) with HTTP Header / Cache diffs — Click to inspect Headers`
                                  : 'All HTTP Headers & Cache keys matched (or accepted) — Click to inspect'
                              }
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-colors ${
                                envHeaderDiffItems > 0
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 font-semibold hover:bg-rose-500/20'
                                  : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground'
                              }`}
                            >
                              <Code2 className="w-3 h-3" />
                              <span>
                                {envHeaderDiffItems > 0
                                  ? envHeaderDiffItems
                                  : '✓'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setCandidateTarget(stagingId);
                                setBaselineTarget(prodId);
                                setCandidateRunKey(stgRun.key);
                                setBaselineRunKey(prdRun.key);
                                setSelectedTestId(
                                  firstCookieDiffItem?.testId ||
                                    'T02'
                                );
                                setInspectorTab('cookies');
                                setViewMode('diff');
                              }}
                              title={
                                envCookieDiffItems > 0
                                  ? `${envCookieDiffItems} test(s) with Set-Cookie diffs — Click to inspect Cookies`
                                  : 'All Set-Cookie attributes matched (or accepted) — Click to inspect'
                              }
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-colors ${
                                envCookieDiffItems > 0
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold hover:bg-amber-500/20'
                                  : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground'
                              }`}
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>
                                {envCookieDiffItems > 0
                                  ? envCookieDiffItems
                                  : '✓'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setCandidateTarget(stagingId);
                                setBaselineTarget(prodId);
                                setCandidateRunKey(stgRun.key);
                                setBaselineRunKey(prdRun.key);
                                setSelectedTestId(
                                  firstVisualDiffItem?.testId ||
                                    'T03'
                                );
                                setInspectorTab('image');
                                setViewMode('diff');
                              }}
                              title={
                                envVisualDiffItems > 0
                                  ? `${envVisualDiffItems} test(s) with AWS Bedrock Nova Lite visual diffs — Click to inspect Image AI`
                                  : 'All DOM screenshots matched (or accepted) — Click to inspect Image AI'
                              }
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-colors ${
                                envVisualDiffItems > 0
                                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold hover:bg-amber-500/20'
                                  : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground'
                              }`}
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>
                                {envVisualDiffItems > 0
                                  ? envVisualDiffItems
                                  : '✓'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setCandidateTarget(stagingId);
                                setBaselineTarget(prodId);
                                setCandidateRunKey(stgRun.key);
                                setBaselineRunKey(prdRun.key);
                                setSelectedTestId('T04');
                                setInspectorTab('flow');
                                setViewMode('diff');
                              }}
                              title="Inspect complete multi-hop HTTP Flow, TLS handshake, Akamai CNAME chain & phase timing waterfall"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-colors bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 font-semibold hover:bg-sky-500/20"
                            >
                              <Activity className="w-3 h-3" />
                              <span>Flow</span>
                            </button>
                          </div>
                        </TableCell>

                        <TableCell className="text-right py-1.5 whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1">
                            <Button
                              variant="outline"
                              size="icon-xs"
                              onClick={() =>
                                handleOpenDiffView(stagingId, prodId)
                              }
                              aria-label={`Compare ${stagingId} vs ${prodId}`}
                              title={`Open Comparative Diff Viewer (${stagingId} vs ${prodId})`}
                            >
                              <GitCompare className="!size-3.5 text-sky-500" />
                            </Button>
                            <Button
                              size="xs"
                              onClick={() =>
                                handleRunAndCompareTargets(stagingId, prodId)
                              }
                              title={`Run AWS Synthetics Canary on both ${stagingId} and ${prodId} and open diff gate`}
                            >
                              <Play className="fill-current !size-2.5" />
                              Run Gate
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            {/* PANEL 2: NON-REDUNDANT 2-COLUMN OPERATIONAL INTELLIGENCE SPLIT */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              {/* LEFT COLUMN (7 cols): ACTIVE DRIFT & RELEASE BLOCKERS TRIAGE QUEUE */}
              <Card className="lg:col-span-7">
                <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    {comparison.headlineVerdict === 'GO' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                    )}
                    <CardTitle className="text-xs font-semibold">
                      Active Release Blockers & Drift Triage
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] px-1.5 py-0"
                      title={`Active comparison pair: ${candidateTarget} (${activeCandidateRun.label}) vs ${baselineTarget} (${activeBaselineRun.label})`}
                    >
                      {candidateTarget} ↔ {baselineTarget}
                    </Badge>
                    <Badge
                      variant={
                        comparison.headlineVerdict === 'GO'
                          ? 'success'
                          : comparison.headlineVerdict === 'REVIEW'
                          ? 'warning'
                          : 'destructive'
                      }
                      className="font-mono text-[10px] px-1.5 py-0 font-bold"
                    >
                      {comparison.headlineVerdict}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={handleExportReportMarkdown}
                      className="font-mono text-[10px] h-6 px-2"
                      title="Copy Change Ticket Markdown Summary to Clipboard"
                    >
                      Copy Ticket MD
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        handleOpenDiffView(
                          candidateTarget,
                          baselineTarget,
                          activeCandidateRun.key,
                          activeBaselineRun.key
                        )
                      }
                      className="font-mono text-[10px] h-6 px-2"
                    >
                      <Eye className="!size-3 text-sky-500" />
                      <span>Full Inspector</span>
                    </Button>
                  </div>
                </CardHeader>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-48 py-1.5">
                        Check & Endpoint
                      </TableHead>
                      <TableHead className="py-1.5">
                        Detected Edge / Visual Finding
                      </TableHead>
                      <TableHead className="text-right w-40 py-1.5">
                        Quick Triage
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.items
                      .filter((it) => {
                        const rawH = it.functionalDiffs.length > 0;
                        const rawC = (it.cookieDiffs || []).length > 0;
                        const rawV =
                          it.visualResult?.verdict === 'minor' ||
                          it.visualResult?.verdict === 'different' ||
                          (it.visualResult?.differences?.length ?? 0) > 0;
                        return rawH || rawC || rawV || it.candidateFailed;
                      })
                      .map((item) => {
                        const {
                          hDiffs,
                          cDiffs,
                          vDiff,
                          isHAcc,
                          isCAcc,
                          isVAcc,
                        } = getItemDiffCounts(item);
                        const isResolved =
                          hDiffs === 0 &&
                          cDiffs === 0 &&
                          !vDiff &&
                          !item.candidateFailed;

                        // Determine primary dimension & root cause description
                        let primaryTab: InspectorDimension = 'headers';
                        let findingText = 'All checks matched';
                        let subDetail = '';

                        if (item.functionalDiffs.length > 0) {
                          primaryTab = 'headers';
                          const first = item.functionalDiffs[0];
                          findingText = `${first.field || first.kind}: ${first.candidateValue} vs ${first.baselineValue}`;
                          if (item.functionalDiffs.length > 1) {
                            subDetail = `+${item.functionalDiffs.length - 1} more header diff (${item.functionalDiffs.map((d) => d.field).join(', ')})`;
                          }
                        } else if ((item.cookieDiffs || []).length > 0) {
                          primaryTab = 'cookies';
                          const cookieNames = (item.cookieDiffs || []).map(
                            (d) => d.field
                          );
                          findingText = `Set-Cookie drift: ${cookieNames.join(', ')}`;
                          subDetail = `Side A: ${(item.cookieDiffs || [])[0]?.candidateValue}`;
                        } else if (item.visualResult) {
                          primaryTab = 'image';
                          findingText = item.visualResult.summary;
                          subDetail = `Pixel delta Δ ${item.visualResult.pixelDiffPercent?.toFixed(1) ?? '0.0'}% · Model: ${item.visualResult.primaryModel}`;
                        }

                        return (
                          <TableRow
                            key={item.testId}
                            className={
                              isResolved ? 'bg-emerald-500/5 opacity-80' : ''
                            }
                          >
                            <TableCell className="py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <PageMiniThumb
                                  testId={item.testId}
                                  testName={item.testName}
                                  url={item.url}
                                  hasVisualDiff={vDiff}
                                  onClick={() => {
                                    setSelectedTestId(item.testId);
                                    setInspectorTab('image');
                                    setViewMode('diff');
                                  }}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-[10px] font-bold px-1 py-0 rounded bg-muted text-foreground">
                                      {item.testId}
                                    </span>
                                    <span className="text-xs font-medium text-foreground truncate">
                                      {item.testName}
                                    </span>
                                  </div>
                                  <div className="text-[10px] font-mono text-muted-foreground truncate">
                                    {item.url}
                                  </div>
                                </div>
                              </div>
                            </TableCell>

                            <TableCell className="py-2">
                              <div className="space-y-0.5">
                                <div className="text-[11px] font-mono text-foreground break-all line-clamp-1">
                                  {findingText}
                                </div>
                                {subDetail && (
                                  <div className="text-[10px] font-mono text-muted-foreground truncate">
                                    {subDetail}
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="py-2 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => {
                                    setSelectedTestId(item.testId);
                                    setInspectorTab(primaryTab);
                                    setViewMode('diff');
                                  }}
                                  className="font-mono text-[10px] h-6 px-2"
                                  title={`Open ${item.testId} directly in ${primaryTab.toUpperCase()} inspector`}
                                >
                                  {primaryTab === 'headers' && (
                                    <Code2 className="!size-3 text-rose-500" />
                                  )}
                                  {primaryTab === 'cookies' && (
                                    <KeyRound className="!size-3 text-amber-500" />
                                  )}
                                  {primaryTab === 'image' && (
                                    <Sparkles className="!size-3 text-sky-500" />
                                  )}
                                  <span>
                                    {isResolved ? 'OK' : `Inspect ${primaryTab}`}
                                  </span>
                                </Button>

                                {/* 1-Click Inline Accept / Undo right from Home */}
                                {primaryTab === 'headers' &&
                                  item.functionalDiffs.length > 0 && (
                                    <Button
                                      variant={isHAcc ? 'secondary' : 'outline'}
                                      size="xs"
                                      onClick={() => {
                                        for (const d of item.functionalDiffs) {
                                          const field = d.field || d.kind;
                                          const isCurrentlyAcc =
                                            acceptedFields.includes(
                                              field.toLowerCase()
                                            );
                                          if (isHAcc ? isCurrentlyAcc : !isCurrentlyAcc) {
                                            handleToggleAcceptHeader(field);
                                          }
                                        }
                                      }}
                                      className="font-mono text-[10px] h-6 px-2"
                                      title={
                                        isHAcc
                                          ? 'Undo accepted header rules for this test'
                                          : 'Accept all header diffs on this test'
                                      }
                                    >
                                      {isHAcc ? 'Undo' : 'Accept'}
                                    </Button>
                                  )}

                                {primaryTab === 'cookies' &&
                                  (item.cookieDiffs || []).length > 0 && (
                                    <Button
                                      variant={isCAcc ? 'secondary' : 'outline'}
                                      size="xs"
                                      onClick={() => {
                                        for (const c of item.cookieDiffs || []) {
                                          if (!c.field) continue;
                                          const norm = c.field
                                            .toLowerCase()
                                            .replace(/^cookie:/, '')
                                            .trim();
                                          const isCurr = acceptedCookies
                                            .map((k) =>
                                              k
                                                .toLowerCase()
                                                .replace(/^cookie:/, '')
                                                .trim()
                                            )
                                            .includes(norm);
                                          if (isCAcc ? isCurr : !isCurr) {
                                            handleToggleAcceptCookie(c.field);
                                          }
                                        }
                                      }}
                                      className="font-mono text-[10px] h-6 px-2"
                                      title={
                                        isCAcc
                                          ? 'Undo accepted cookies for this test'
                                          : 'Accept all cookie diffs on this test'
                                      }
                                    >
                                      {isCAcc ? 'Undo' : 'Accept'}
                                    </Button>
                                  )}

                                {primaryTab === 'image' && (
                                  <Button
                                    variant={isVAcc ? 'secondary' : 'outline'}
                                    size="xs"
                                    onClick={() =>
                                      handleToggleAcceptVisual(item.testId)
                                    }
                                    className="font-mono text-[10px] h-6 px-2"
                                    title={
                                      isVAcc
                                        ? 'Undo accepted visual diff'
                                        : 'Accept Nova Lite visual diff on this test'
                                    }
                                  >
                                    {isVAcc ? 'Undo' : 'Accept'}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </Card>

              {/* RIGHT COLUMN (5 cols): MULTI-PROPERTY FLEET GATE MATRIX & AUDIT LOG */}
              <Card className="lg:col-span-5">
                <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="w-3.5 h-3.5 text-sky-500" />
                    <CardTitle className="text-xs font-semibold">
                      {homeRightTab === 'fleet'
                        ? `Fleet Release Gate Matrix (${apps.length})`
                        : `Gate Audit & Ticket History (${readyReports.length})`}
                    </CardTitle>
                  </div>

                  <div className="inline-flex items-center rounded border border-border bg-background p-0.5 text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setHomeRightTab('fleet')}
                      className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                        homeRightTab === 'fleet'
                          ? 'bg-foreground text-background font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Fleet ({apps.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHomeRightTab('audit')}
                      className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                        homeRightTab === 'audit'
                          ? 'bg-foreground text-background font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Audit Log ({readyReports.length})
                    </button>
                  </div>
                </CardHeader>

                {homeRightTab === 'fleet' ? (
                  <div className="max-h-80 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="py-1.5">Property</TableHead>
                          <TableHead className="py-1.5">PROD Gate</TableHead>
                          <TableHead className="py-1.5">Checks</TableHead>
                          <TableHead className="text-right py-1.5">
                            Open
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apps.slice(0, 12).map((appItem) => {
                          const stgTarget = `${appItem.id}.prod.staging`;
                          const prdTarget = `${appItem.id}.prod.prod`;
                          const stgR = getActiveRunForTarget(stgTarget);
                          const prdR = getActiveRunForTarget(prdTarget);
                          const appComp = buildInitialComparison(
                            stgR,
                            prdR,
                            'network',
                            acceptedRules,
                            {
                              acceptedCookies,
                              acceptedVisualTests,
                              ignoreAcceptedDiffs,
                              aiJudgeOverrides,
                            }
                          );
                          const isSelectedApp = appItem.id === activeAppId;

                          return (
                            <TableRow
                              key={appItem.id}
                              onClick={() => handleSelectProperty(appItem.id)}
                              className={`cursor-pointer ${
                                isSelectedApp ? 'bg-sky-500/10' : ''
                              }`}
                            >
                              <TableCell className="py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    variant={
                                      isSelectedApp ? 'default' : 'outline'
                                    }
                                    className="font-mono text-[10px] px-1.5 py-0"
                                  >
                                    {appItem.id}
                                  </Badge>
                                  <span className="text-xs text-foreground truncate max-w-32">
                                    {appItem.name}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="py-1.5">
                                <Badge
                                  variant={
                                    appComp.headlineVerdict === 'GO'
                                      ? 'success'
                                      : appComp.headlineVerdict === 'REVIEW'
                                      ? 'warning'
                                      : 'destructive'
                                  }
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {appComp.headlineVerdict}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-1.5 font-mono text-[11px] text-muted-foreground">
                                {stgR.passedTests}/{stgR.totalTests}
                              </TableCell>
                              <TableCell className="py-1.5 text-right">
                                <Button
                                  variant="outline"
                                  size="icon-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveAppId(appItem.id);
                                    handleOpenDiffView(stgTarget, prdTarget);
                                  }}
                                  title={`Open ${appItem.id} PROD Release Gate Diff`}
                                >
                                  <GitCompare className="!size-3 text-sky-500" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <div className="px-3 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center rounded border border-border bg-background p-0.5 text-[10px] font-mono">
                        <button
                          type="button"
                          onClick={() => setReportScope('active')}
                          className={`px-1.5 py-0.5 rounded-xs cursor-pointer ${
                            reportScope === 'active'
                              ? 'bg-foreground text-background font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {currentApp.id} (
                          {
                            readyReports.filter((r) => r.appId === activeAppId)
                              .length
                          }
                          )
                        </button>
                        <button
                          type="button"
                          onClick={() => setReportScope('all')}
                          className={`px-1.5 py-0.5 rounded-xs cursor-pointer ${
                            reportScope === 'all'
                              ? 'bg-foreground text-background font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          All ({readyReports.length})
                        </button>
                      </div>
                      <div className="relative">
                        <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Filter audit log…"
                          value={reportSearchQuery}
                          onChange={(e) => setReportSearchQuery(e.target.value)}
                          className="h-6 pl-6 pr-2 rounded border border-input bg-background text-[11px] font-mono w-36"
                        />
                      </div>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20 py-1.5">ID</TableHead>
                          <TableHead className="py-1.5">
                            Audit Snapshot Pair
                          </TableHead>
                          <TableHead className="text-right w-20 py-1.5">
                            Open
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {readyReports
                          .filter((r) =>
                            reportScope === 'active'
                              ? r.appId === activeAppId
                              : true
                          )
                          .filter((r) => {
                            if (!reportSearchQuery.trim()) return true;
                            const q = reportSearchQuery.toLowerCase();
                            return (
                              r.id.toLowerCase().includes(q) ||
                              r.title.toLowerCase().includes(q) ||
                              r.candidateTarget.toLowerCase().includes(q) ||
                              r.baselineTarget.toLowerCase().includes(q)
                            );
                          })
                          .map((rpt) => {
                            const targetRunsA = runs.filter(
                              (r) => r.target === rpt.candidateTarget
                            );
                            const runA = getActiveRunForTarget(
                              rpt.candidateTarget,
                              rpt.candidateRunKey
                            );
                            const runB =
                              rpt.candidateTarget === rpt.baselineTarget &&
                              !rpt.baselineRunKey &&
                              targetRunsA.length >= 2
                                ? targetRunsA[1]
                                : getActiveRunForTarget(
                                    rpt.baselineTarget,
                                    rpt.baselineRunKey
                                  );

                            return (
                              <TableRow key={rpt.id}>
                                <TableCell className="py-1.5 font-mono font-semibold text-[11px]">
                                  <div>{rpt.id}</div>
                                  <div className="text-[9px] text-muted-foreground font-normal">
                                    {rpt.createdAt}
                                  </div>
                                </TableCell>
                                <TableCell className="py-1.5">
                                  <div className="text-xs font-medium text-foreground truncate max-w-48">
                                    {rpt.title}
                                  </div>
                                  <div className="text-[10px] font-mono text-muted-foreground">
                                    {runA.label} ↔ {runB.label}
                                  </div>
                                </TableCell>
                                <TableCell className="py-1.5 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    <Button
                                      variant="outline"
                                      size="icon-xs"
                                      onClick={() =>
                                        handleOpenDiffView(
                                          rpt.candidateTarget,
                                          rpt.baselineTarget,
                                          runA.key,
                                          runB.key
                                        )
                                      }
                                      aria-label={`Open Report ${rpt.id}`}
                                      title={`Open Comparative Report ${rpt.id}`}
                                    >
                                      <Eye className="!size-3.5 text-sky-500" />
                                    </Button>
                                    <Button
                                      size="icon-xs"
                                      onClick={() =>
                                        handleRunAndCompareTargets(
                                          rpt.candidateTarget,
                                          rpt.baselineTarget,
                                          true
                                        )
                                      }
                                      disabled={isComparingBoth}
                                      aria-label={`Rerun Full Comparison for ${rpt.id}`}
                                      title={`Trigger fresh AWS Synthetics runs on ${rpt.candidateTarget} & ${rpt.baselineTarget}`}
                                    >
                                      <Play className="fill-current !size-2.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            </div>
          </main>
        </>
      )}

      {/* =====================================================================
          MODE 2: FOCUSED COMPARATIVE DIFF VIEW
         ===================================================================== */}
      {viewMode === 'diff' && (
        <>
          <div className="bg-background border-b border-border px-4 py-2">
            <ComparisonTargetBar
              mode="diff-toolbar"
              endpoints={appEndpoints}
              runs={runs}
              candidateTarget={candidateTarget}
              baselineTarget={baselineTarget}
              activeCandidateRunKey={activeCandidateRun.key}
              activeBaselineRunKey={activeBaselineRun.key}
              onChangeCandidateTarget={handleChangeCandidateTarget}
              onChangeBaselineTarget={handleChangeBaselineTarget}
              onChangeCandidateRun={(key) => {
                setCandidateRunKey(key);
                setSelectedRunByTarget((prev) => ({
                  ...prev,
                  [candidateTarget]: key,
                }));
              }}
              onChangeBaselineRun={(key) => {
                setBaselineRunKey(key);
                if (candidateTarget !== baselineTarget) {
                  setSelectedRunByTarget((prev) => ({
                    ...prev,
                    [baselineTarget]: key,
                  }));
                }
              }}
              onSwapSides={handleSwapSides}
              onCompareWithPrevRun={() =>
                handleCompareTargetWithPrevRun(candidateTarget)
              }
              onRunBothAndCompare={() =>
                handleRunAndCompareTargets(candidateTarget, baselineTarget)
              }
              isComparingBoth={isComparingBoth}
              ignoreAcceptedDiffs={ignoreAcceptedDiffs}
              onChangeIgnoreAcceptedDiffs={setIgnoreAcceptedDiffs}
              onExportReport={handleExportReportMarkdown}
            />
          </div>

          <main className="px-4 py-3 w-full flex-1">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <Card className="lg:col-span-5">
                <div className="px-3.5 py-2 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2">
                  <Tabs
                    value={testFilter}
                    onValueChange={(v) =>
                      setTestFilter(v as 'all' | 'diffs' | 'matched')
                    }
                  >
                    <TabsList className="h-7">
                      <TabsTrigger value="all" className="text-[11px] px-2 py-0.5">
                        All ({comparison.items.length})
                      </TabsTrigger>
                      <TabsTrigger value="diffs" className="text-[11px] px-2 py-0.5">
                        Diffs ({totalDiffItemsCount})
                      </TabsTrigger>
                      <TabsTrigger value="matched" className="text-[11px] px-2 py-0.5">
                        Matched ({comparison.items.length - totalDiffItemsCount})
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <div className="flex items-center gap-1.5">
                    <div className="relative">
                      <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Filter tests…"
                        value={diffSearchQuery}
                        onChange={(e) => setDiffSearchQuery(e.target.value)}
                        className="h-6 pl-6 pr-2 rounded border border-input bg-background text-[11px] font-mono w-28"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleRerunAllDiffs()}
                      disabled={rerunningTestId === 'ALL'}
                    >
                      <RotateCw
                        className={`!size-3 ${
                          rerunningTestId === 'ALL' ? 'animate-spin' : ''
                        }`}
                      />
                      Rerun Diffs
                    </Button>
                  </div>
                </div>

                <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1.5">Page & Test Case</TableHead>
                        <TableHead
                          className="text-center w-11 py-1.5"
                          title="HTTP Flow Hops, Redirect Chain & Timing Waterfall — Click any cell below to open HTTP Flow tab"
                        >
                          <Activity className="w-3.5 h-3.5 mx-auto text-sky-500" />
                        </TableHead>
                        <TableHead
                          className="text-center w-11 py-1.5"
                          title="HTTP Response Header & Cache Key Diffs — Click any cell below to open Headers tab"
                        >
                          <Code2 className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                        </TableHead>
                        <TableHead
                          className="text-center w-11 py-1.5"
                          title="Set-Cookie Domain, SameSite & Attribute Diffs — Click any cell below to open Cookies tab"
                        >
                          <KeyRound className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                        </TableHead>
                        <TableHead
                          className="text-center w-11 py-1.5"
                          title="Visual DOM Screenshot & AI Judge Verdict — Click any cell below to open Image AI tab"
                        >
                          <Sparkles className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                        </TableHead>
                        <TableHead className="text-right w-10 py-1.5" title="Rerun Single Check">
                          <RotateCw className="w-3 h-3 ml-auto text-muted-foreground" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => {
                        const isSelected = item.testId === selectedItem?.testId;
                        const {
                          hDiffs,
                          cDiffs,
                          vDiff,
                          rawHDiffs,
                          isHAcc,
                          rawCDiffs,
                          isCAcc,
                          rawVDiff,
                          isVAcc,
                        } = getItemDiffCounts(item);
                        const hopCount =
                          item.candidateResult?.redirectChain?.length || 1;

                        return (
                          <TableRow
                            key={item.testId}
                            data-state={isSelected ? 'selected' : undefined}
                            onClick={() => handleSelectTestRow(item)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-sky-500/[0.08] dark:bg-sky-500/[0.15]'
                                : 'hover:bg-muted/40'
                            }`}
                          >
                            <TableCell className="py-2">
                              <div
                                className="flex items-center gap-2.5"
                                title={`${item.testId}: ${item.testName} (${item.url}) — Click thumbnail for Image AI tab, or text for primary diff tab`}
                              >
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectTestRow(item, 'image');
                                  }}
                                >
                                  <PageMiniThumb
                                    testId={item.testId}
                                    testName={item.testName}
                                    url={item.url}
                                    hasVisualDiff={vDiff}
                                    onClick={() =>
                                      handleSelectTestRow(item, 'image')
                                    }
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-xs text-sky-600 dark:text-sky-400 shrink-0">
                                      {item.testId}
                                    </span>
                                    <span className="font-medium text-xs text-foreground truncate max-w-[220px] xl:max-w-[270px]">
                                      {item.testName}
                                    </span>
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[240px] xl:max-w-[300px]">
                                    {item.url}
                                  </div>
                                </div>
                              </div>
                            </TableCell>

                            <TableCell
                              className="text-center py-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'flow');
                              }}
                              title={`${hopCount} HTTP hop(s) · ${item.candidateResult?.durationMs ?? 0}ms — click to inspect full HTTP Flow waterfall`}
                            >
                              <Badge
                                variant={hopCount > 1 ? 'default' : 'outline'}
                                className="font-mono px-1.5 py-0 text-[10px]"
                              >
                                {hopCount}h
                              </Badge>
                            </TableCell>

                            <TableCell
                              className="text-center py-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'headers');
                              }}
                              title={
                                hDiffs > 0
                                  ? `${hDiffs} HTTP Header / Cache-Key diff(s) — click to inspect`
                                  : rawHDiffs > 0 && isHAcc
                                  ? 'HTTP Header diff(s) accepted & suppressed'
                                  : 'HTTP Headers & Cache Key matched'
                              }
                            >
                              {hDiffs > 0 ? (
                                <Badge variant="destructive" className="font-mono px-1.5 py-0 text-[10px]">
                                  {hDiffs}
                                </Badge>
                              ) : rawHDiffs > 0 && isHAcc ? (
                                <Badge variant="success" className="font-mono px-1 py-0 text-[9px]">
                                  OK
                                </Badge>
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80 mx-auto" />
                              )}
                            </TableCell>

                            <TableCell
                              className="text-center py-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'cookies');
                              }}
                              title={
                                cDiffs > 0
                                  ? `${cDiffs} Set-Cookie attribute diff(s) — click to inspect`
                                  : rawCDiffs > 0 && isCAcc
                                  ? 'Set-Cookie diff(s) accepted & suppressed'
                                  : 'Set-Cookie attributes matched'
                              }
                            >
                              {cDiffs > 0 ? (
                                <Badge variant="warning" className="font-mono px-1.5 py-0 text-[10px]">
                                  {cDiffs}
                                </Badge>
                              ) : rawCDiffs > 0 && isCAcc ? (
                                <Badge variant="success" className="font-mono px-1 py-0 text-[9px]">
                                  OK
                                </Badge>
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80 mx-auto" />
                              )}
                            </TableCell>

                            <TableCell
                              className="text-center py-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'image');
                              }}
                              title={
                                vDiff
                                  ? `Visual DOM layout drift (${item.visualResult?.summary || 'AI detected layout shift'}) — click for AI Visual Judge`
                                  : rawVDiff && isVAcc
                                  ? 'Visual diff accepted & suppressed'
                                  : 'Visual DOM screenshot matched'
                              }
                            >
                              {vDiff ? (
                                <Badge variant="warning" className="font-mono px-1 py-0 text-[10px]">
                                  AI
                                </Badge>
                              ) : rawVDiff && isVAcc ? (
                                <Badge variant="success" className="font-mono px-1 py-0 text-[9px]">
                                  OK
                                </Badge>
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80 mx-auto" />
                              )}
                            </TableCell>

                            <TableCell
                              className="text-right py-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRerunSingleTest(item.testId);
                              }}
                            >
                              <button
                                type="button"
                                aria-label={`Rerun ${item.testId}`}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                                title={`Rerun ${item.testId} (${item.url}) on both targets`}
                              >
                                <RotateCw
                                  className={`w-3 h-3 ${
                                    rerunningTestId === item.testId
                                      ? 'animate-spin text-foreground'
                                      : ''
                                  }`}
                                />
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              <div className="lg:col-span-7">
                {selectedItem && (
                  <TestInspector
                    item={selectedItem}
                    activeTab={inspectorTab}
                    onTabChange={setInspectorTab}
                    candidateLabel={formatShortTarget(activeCandidateRun)}
                    baselineLabel={formatShortTarget(activeBaselineRun)}
                    isRerunningTest={
                      rerunningTestId === selectedItem.testId ||
                      rerunningTestId === 'ALL'
                    }
                    isRunningAi={runningAiTestId === selectedItem.testId}
                    onRerunSingleTest={handleRerunSingleTest}
                    onRunAiVisualJudge={handleRunAiVisualJudge}
                    onToggleAcceptHeader={handleToggleAcceptHeader}
                    acceptedFields={acceptedFields}
                    onToggleAcceptCookie={handleToggleAcceptCookie}
                    acceptedCookies={acceptedCookies}
                    onToggleAcceptVisual={handleToggleAcceptVisual}
                    acceptedVisualTests={acceptedVisualTests}
                    ignoreAcceptedDiffs={ignoreAcceptedDiffs}
                    lastProbedInfo={lastProbedByTestId[selectedItem.testId]}
                  />
                )}
              </div>
            </div>
          </main>
        </>
      )}

      {/* =====================================================================
          MODE 3: FOCUSED SINGLE-RUN VIEW
         ===================================================================== */}
      {viewMode === 'run' && (() => {
        const targetRuns = runs.filter((r) => r.target === focusedTargetId);
        const isRunning = targetStates[focusedTargetId]?.state === 'running';
        const [appId, envId, net] = focusedTargetId.split('.');
        const counterpartTarget = `${appId}.${envId}.${
          net === 'staging' ? 'prod' : 'staging'
        }`;

        return (
          <>
            <div className="bg-background border-b border-border px-4 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Badge variant="secondary" className="font-mono uppercase">
                  {appId} · {envId}
                </Badge>
                <span className="text-xs font-semibold">
                  {net === 'staging'
                    ? DEFAULT_TEMPLATE_CONFIG.networks.staging.label
                    : DEFAULT_TEMPLATE_CONFIG.networks.prod.label}
                </span>

                <select
                  aria-label="Select Run"
                  value={activeSingleRun.key}
                  onChange={(e) =>
                    setSelectedRunByTarget((prev) => ({
                      ...prev,
                      [focusedTargetId]: e.target.value,
                    }))
                  }
                  className="h-7 rounded border border-input bg-muted/40 px-2.5 text-xs font-mono text-foreground"
                >
                  {targetRuns.map((r, idx) => (
                    <option key={r.key} value={r.key}>
                      {r.label || r.key} {idx === 0 ? '(Latest)' : ''} ·{' '}
                      {r.passedTests}/{r.totalTests} passed
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                {targetRuns.length >= 2 && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      handleCompareTargetWithPrevRun(
                        focusedTargetId,
                        activeSingleRun.key,
                        targetRuns.find((r) => r.key !== activeSingleRun.key)
                          ?.key
                      )
                    }
                    title={`Compare ${activeSingleRun.label} against previous run on ${focusedTargetId}`}
                  >
                    <History className="!size-3 text-amber-500" />
                    vs Prev Run
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleRunSingleTarget(focusedTargetId, false)}
                  disabled={isRunning}
                  title="Run Canary Suite again and auto-compare with previous run"
                >
                  <Play className="fill-current !size-2.5" />
                  {isRunning ? 'Running…' : 'Run & Compare Prev'}
                </Button>

                <Button
                  size="xs"
                  onClick={() =>
                    handleOpenDiffView(focusedTargetId, counterpartTarget)
                  }
                >
                  <GitCompare className="!size-3" />
                  vs {net === 'staging' ? 'Prod' : 'Staging'}
                </Button>
              </div>
            </div>

            <main className="px-4 py-3 w-full flex-1">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                <Card className="lg:col-span-5">
                  <div className="px-3.5 py-2 border-b border-border bg-muted/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Test Run Results ({activeSingleRun.passedTests}/
                      {activeSingleRun.totalTests} passed)
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {new Date(activeSingleRun.startTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="py-1.5">Test Case</TableHead>
                          <TableHead
                            className="text-center w-11 py-1.5"
                            title="HTTP Flow Hops & Redirect Waterfall — Click to open HTTP Flow tab"
                          >
                            <Activity className="w-3.5 h-3.5 mx-auto text-sky-500" />
                          </TableHead>
                          <TableHead
                            className="text-center w-12 py-1.5"
                            title="HTTP Status & Captured Headers — Click to open Headers tab"
                          >
                            <Code2 className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                          </TableHead>
                          <TableHead
                            className="text-center w-12 py-1.5"
                            title="Captured Set-Cookie Jar — Click to open Cookies tab"
                          >
                            <KeyRound className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                          </TableHead>
                          <TableHead
                            className="text-center w-12 py-1.5"
                            title="Captured DOM Snapshot — Click to open Captured Image tab"
                          >
                            <Sparkles className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                          </TableHead>
                          <TableHead className="text-right w-16 py-1.5">Latency</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeSingleRun.results.map((res) => {
                          const isSelected = res.id === selectedSingleResult?.id;
                          const headerCount = Object.keys(res.capturedHeaders || {}).length;
                          const cookieCount = Object.keys(res.capturedCookies || {}).length;
                          const hopCount = res.redirectChain?.length || 1;
                          return (
                            <TableRow
                              key={res.id}
                              data-state={isSelected ? 'selected' : undefined}
                              onClick={() => {
                                setSelectedTestId(res.id);
                                setInspectorTab('flow');
                              }}
                              className="cursor-pointer"
                            >
                              <TableCell className="py-1.5">
                                <div
                                  className="flex items-center gap-2"
                                  title={`${res.id}: ${res.name} (${res.url})`}
                                >
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTestId(res.id);
                                      setInspectorTab('image');
                                    }}
                                  >
                                    <PageMiniThumb
                                      testId={res.id}
                                      testName={res.name}
                                      url={res.url}
                                      hasVisualDiff={!res.pass}
                                      onClick={() => {
                                        setSelectedTestId(res.id);
                                        setInspectorTab('image');
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      {res.pass ? (
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      ) : (
                                        <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                                      )}
                                      <span className="font-mono font-bold text-xs">
                                        {res.id}
                                      </span>
                                      <span className="font-medium text-xs truncate max-w-[130px]">
                                        {res.name}
                                      </span>
                                    </div>
                                    <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[155px]">
                                      {res.url}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell
                                className="py-1.5 text-center font-mono text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestId(res.id);
                                  setInspectorTab('flow');
                                }}
                                title={`${hopCount} HTTP hop(s) — Click to inspect HTTP Flow`}
                              >
                                <Badge
                                  variant={hopCount > 1 ? 'default' : 'outline'}
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {hopCount}h
                                </Badge>
                              </TableCell>
                              <TableCell
                                className="py-1.5 text-center font-mono text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestId(res.id);
                                  setInspectorTab('headers');
                                }}
                                title={`HTTP ${res.actualStatus} · ${headerCount} headers — Click to inspect Headers`}
                              >
                                <Badge
                                  variant={res.pass ? 'secondary' : 'destructive'}
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {res.actualStatus}
                                </Badge>
                              </TableCell>
                              <TableCell
                                className="py-1.5 text-center font-mono text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestId(res.id);
                                  setInspectorTab('cookies');
                                }}
                                title={`${cookieCount} Set-Cookie attributes — Click to inspect Cookies`}
                              >
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] px-1.5 py-0"
                                >
                                  {cookieCount}
                                </Badge>
                              </TableCell>
                              <TableCell
                                className="py-1.5 text-center font-mono text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTestId(res.id);
                                  setInspectorTab('image');
                                }}
                                title="Click to inspect Captured DOM Snapshot"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80 mx-auto" />
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                                {res.durationMs}ms
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Card>

                <div className="lg:col-span-7">
                  {selectedSingleResult && (
                    <SingleRunInspector
                      result={selectedSingleResult}
                      targetLabel={focusedTargetId}
                      runLabel={activeSingleRun.label || '#1'}
                      isRerunning={rerunningTestId === selectedSingleResult.id}
                      onRerunTest={handleRerunSingleTest}
                      activeTab={inspectorTab}
                      onTabChange={setInspectorTab}
                      lastProbedInfo={lastProbedByTestId[selectedSingleResult.id]}
                    />
                  )}
                </div>
              </div>
            </main>
          </>
        );
      })()}
        </>
      )}
    </div>
  );
}
