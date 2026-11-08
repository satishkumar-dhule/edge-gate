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

  // 3. Config-Driven Topology & Suite State (Can be edited in template.config.ts or live in Settings)
  const [apps, setApps] = useState<AppConfig[]>(
    DEFAULT_TEMPLATE_CONFIG.properties
  );
  const [testSuite, setTestSuite] = useState<TestCaseDefinition[]>(
    DEFAULT_TEMPLATE_CONFIG.testSuite
  );
  const [runs, setRuns] = useState<RunRecord[]>(INITIAL_RUNS);
  const [acceptedRules, setAcceptedRules] = useState<AcceptedRule[]>(INITIAL_RULES);
  const [acceptedCookies, setAcceptedCookies] = useState<string[]>([]);
  const [acceptedVisualTests, setAcceptedVisualTests] = useState<string[]>([]);
  const [ignoreAcceptedDiffs, setIgnoreAcceptedDiffs] = useState<boolean>(true);

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
    DEFAULT_TEMPLATE_CONFIG.readyReports
  );

  // Background Jobs & Notification Popover State
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([
    {
      id: 'job-init-1',
      title: 'Comparative Canary: www.prod.staging vs www.prod.prod',
      target: 'www.prod',
      engine: `aws-synthetics-${DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion}`,
      status: 'completed',
      startedAt: '08:30 AM',
      progress: '8/8',
      kind: 'compare',
      onInspect: () => {
        setCandidateTarget('www.prod.staging');
        setBaselineTarget('www.prod.prod');
        setViewMode('diff');
      },
    },
    {
      id: 'job-init-2',
      title: 'Edge Canary Suite: www.uat.staging',
      target: 'www.uat.staging',
      engine: `aws-synthetics-${DEFAULT_TEMPLATE_CONFIG.infrastructure.awsRegion}`,
      status: 'completed',
      startedAt: '08:15 AM',
      progress: '8/8',
      kind: 'single-run',
      onInspect: () => {
        setFocusedTargetId('www.uat.staging');
        setViewMode('run');
      },
    },
  ]);

  const [viewMode, setViewMode] = useState<ViewMode>('property');
  const [activeAppId, setActiveAppId] = useState<string>(
    DEFAULT_TEMPLATE_CONFIG.properties[0]?.id || 'www'
  );
  const [focusedTargetId, setFocusedTargetId] = useState<string>('www.prod.staging');
  const [candidateTarget, setCandidateTarget] = useState<string>('www.prod.staging');
  const [baselineTarget, setBaselineTarget] = useState<string>('www.prod.prod');

  const [selectedRunByTarget, setSelectedRunByTarget] = useState<
    Record<string, string>
  >(() => {
    const map: Record<string, string> = {};
    for (const r of INITIAL_RUNS) {
      if (!map[r.target]) {
        map[r.target] = r.key;
      }
    }
    return map;
  });

  const [candidateRunKey, setCandidateRunKey] = useState<string>(
    () => INITIAL_RUNS.find((r) => r.target === 'www.prod.staging')?.key || ''
  );
  const [baselineRunKey, setBaselineRunKey] = useState<string>(
    () => INITIAL_RUNS.find((r) => r.target === 'www.prod.prod')?.key || ''
  );

  const [selectedTestId, setSelectedTestId] = useState<string>(
    DEFAULT_TEMPLATE_CONFIG.testSuite[0]?.id || 'T01'
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorDimension>('headers');
  const [testFilter, setTestFilter] = useState<'all' | 'diffs' | 'matched'>('all');

  const [isComparingBoth, setIsComparingBoth] = useState<boolean>(false);
  const [rerunningTestId, setRerunningTestId] = useState<string | null>(null);
  const [runningAiTestId, setRunningAiTestId] = useState<string | null>(null);

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

  const comparison = useMemo(() => {
    const kind: ComparisonKind =
      activeCandidateRun.envId === activeBaselineRun.envId ? 'network' : 'env';
    return buildInitialComparison(
      activeCandidateRun,
      activeBaselineRun,
      kind,
      acceptedRules
    );
  }, [activeCandidateRun, activeBaselineRun, acceptedRules]);

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
      item.visualResult?.verdict === 'different';
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
      if (testFilter === 'diffs') return hasAny;
      if (testFilter === 'matched') return !hasAny;
      return true;
    });
  }, [
    comparison.items,
    testFilter,
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

    return {
      key,
      target: targetId,
      appId,
      envId,
      network,
      suiteKey: `config/suites/${appId}.csv`,
      suiteSha256: '9f83a21b33c0',
      suiteRowCount: results.length,
      startTime: now.toISOString(),
      finishTime: new Date(now.getTime() + 1200).toISOString(),
      totalTests: results.length,
      passedTests: results.filter((r) => r.pass).length,
      failedTests: results.filter((r) => !r.pass).length,
      by: currentUser?.email || 'operator',
      label: `${labelPrefix} #${runNumber}`,
      results,
    };
  };

  const enqueueBackgroundJob = (
    title: string,
    target: string,
    kind: BackgroundJob['kind'],
    durationMs: number,
    onDone: () => void,
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

    setTimeout(() => {
      onDone();
      setBackgroundJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'completed', progress: 'Done' } : j
        )
      );
    }, durationMs);
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
      500,
      () => {
        const newRun = createNewRunRecord(targetId, 'run', true);
        setRuns((prev) => [newRun, ...prev]);
        setSelectedRunByTarget((prev) => ({
          ...prev,
          [targetId]: newRun.key,
        }));
        setTargetStates((prev) => ({
          ...prev,
          [targetId]: { state: 'ready' },
        }));

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
          createdAt: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
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
          `Completed ${newRun.label} on ${targetId} — comparing against previous run (${
            previousRun?.label || 'baseline'
          })`
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
    setSelectedTestId(testSuite[0]?.id || 'T01');
    setInspectorTab('headers');
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
      600,
      () => {
        const newRunA = createNewRunRecord(targetA, 'cmp');
        const newRunB = createNewRunRecord(targetB, 'cmp');

        setRuns((prev) => [newRunA, newRunB, ...prev]);
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

        const [appA] = targetA.split('.');
        const newReport: ReadyReportDefinition = {
          id: `RPT-${105 + readyReports.length}`,
          title: `Comparative Run: ${targetA} vs ${targetB}`,
          appId: appA,
          candidateTarget: targetA,
          baselineTarget: targetB,
          candidateRunKey: newRunA.key,
          baselineRunKey: newRunB.key,
          createdAt: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          by: currentUser?.email || 'operator',
        };
        setReadyReports((prev) => [newReport, ...prev]);
        setIsComparingBoth(false);
        toast.success(`Finished comparative run on ${targetA} and ${targetB}.`);
      },
      () => {
        setCandidateTarget(targetA);
        setBaselineTarget(targetB);
        setViewMode('diff');
      }
    );
  };

  const handleRerunSingleTest = (testId: string) => {
    setRerunningTestId(testId);
    enqueueBackgroundJob(
      `Rerun Test ${testId}`,
      `${candidateTarget} ↔ ${baselineTarget}`,
      'rerun',
      400,
      () => {
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setRuns((prev) =>
          prev.map((run) => {
            if (
              run.key !== activeCandidateRun.key &&
              run.key !== activeBaselineRun.key &&
              run.key !== activeSingleRun.key
            ) {
              return run;
            }
            return {
              ...run,
              results: run.results.map((res) =>
                res.id === testId
                  ? {
                      ...res,
                      durationMs: Math.max(42, res.durationMs - 4),
                      note: `Reran at ${nowStr}`,
                    }
                  : res
              ),
            };
          })
        );
        setRerunningTestId(null);
        toast.success(`Reran test ${testId}`);
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

    setRerunningTestId('ALL');
    enqueueBackgroundJob(
      `Rerun Diffing Tests (${tA} ↔ ${tB})`,
      `${tA} ↔ ${tB}`,
      'rerun',
      500,
      () => {
        setRerunningTestId(null);
        toast.success(`Reran all differing tests between ${tA} and ${tB}`);
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
    enqueueBackgroundJob(
      `AI Visual Judge: ${testId}`,
      `${candidateTarget} ↔ ${baselineTarget}`,
      'ai-judge',
      500,
      () => {
        setRunningAiTestId(null);
        toast.success(`AI Visual Judge completed analysis for ${testId}`);
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
    <div className="min-h-screen bg-muted/20 text-foreground flex flex-col font-sans relative">
      <Toaster position="bottom-right" richColors theme={theme} />

      {/* =====================================================================
          CONTROL CENTER GLOBAL HEADER + ICON-FIRST NAVIGATION + NOTIFICATIONS
         ===================================================================== */}
      <header className="h-11 bg-zinc-950 text-zinc-100 px-4 flex items-center justify-between gap-3 shrink-0 border-b border-zinc-800">
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

      {viewMode === 'mcp' && (
        <McpAndAwsBackendView
          apps={apps}
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
            <Card className="overflow-hidden">
              <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-sky-500" />
                  <CardTitle className="text-xs font-semibold">
                    Edge Environments ({currentApp.id})
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] px-1.5 py-0 cursor-help"
                    title={`Staging Edge: ${DEFAULT_TEMPLATE_CONFIG.networks.staging.edgeSuffix} (${DEFAULT_TEMPLATE_CONFIG.networks.staging.defaultEdgeIp})\nProduction Edge: ${DEFAULT_TEMPLATE_CONFIG.networks.prod.edgeSuffix} (${DEFAULT_TEMPLATE_CONFIG.networks.prod.defaultEdgeIp})`}
                  >
                    {currentApp.envs.length} envs · 2 edge networks
                  </Badge>
                </div>
                <span
                  className="text-[11px] font-mono text-muted-foreground cursor-help"
                  title="Hover any run pill or action icon for full edge IP, cache hit/miss, and AWS Canary details"
                >
                  STG (.edgekey-staging.net) ↔ PRD (.edgekey.net)
                </span>
              </CardHeader>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48 py-1.5">Environment & Hostname</TableHead>
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
                    <TableHead className="text-right w-40 py-1.5">
                      Staging vs Prod Gate
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

                    return (
                      <TableRow key={env.id}>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="secondary"
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

            <Card className="overflow-hidden">
              <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                  <GitCompare className="w-3.5 h-3.5 text-sky-500" />
                  <CardTitle className="text-xs font-semibold">
                    Ready Comparative Reports ({currentApp.id})
                  </CardTitle>
                </div>
                <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                  {readyReports.filter((r) => r.appId === activeAppId).length}{' '}
                  ready
                </Badge>
              </CardHeader>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24 py-1.5">Report</TableHead>
                    <TableHead className="py-1.5">Release Gate & Edge Pair</TableHead>
                    <TableHead className="w-64 py-1.5">Snapshots (A ↔ B)</TableHead>
                    <TableHead className="w-24 py-1.5">Time</TableHead>
                    <TableHead className="text-right w-28 py-1.5">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readyReports
                    .filter((r) => r.appId === activeAppId)
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
                          <TableCell className="py-1.5 font-mono font-semibold text-xs">
                            <span title={`Triggered by ${rpt.by}`}>
                              {rpt.id}
                            </span>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-xs text-foreground">
                                {rpt.title}
                              </span>
                              <Badge
                                variant="outline"
                                className="font-mono text-[10px] px-1.5 py-0 text-muted-foreground"
                                title={`Candidate: ${rpt.candidateTarget} vs Baseline: ${rpt.baselineTarget}`}
                              >
                                {rpt.candidateTarget} ↔ {rpt.baselineTarget}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5 whitespace-nowrap">
                            <div
                              className="inline-flex items-center gap-1 font-mono text-[10px] whitespace-nowrap"
                              title={`Side A: ${runA.key} (${runA.passedTests}/${runA.totalTests} passed)\nSide B: ${runB.key} (${runB.passedTests}/${runB.totalTests} passed)`}
                            >
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap">
                                {runA.network === 'staging' ? 'STG' : 'PRD'}{' '}
                                {runA.label}
                              </span>
                              <span className="text-muted-foreground">↔</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                                {runB.network === 'staging' ? 'STG' : 'PRD'}{' '}
                                {runB.label}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell
                            className="py-1.5 font-mono text-[11px] text-muted-foreground"
                            title={`Generated by ${rpt.by} at ${rpt.createdAt}`}
                          >
                            {rpt.createdAt}
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
                                title={`Open Comparative Report ${rpt.id} (${runA.label} ↔ ${runB.label})`}
                              >
                                <Eye className="!size-3.5 text-sky-500" />
                              </Button>

                              <Button
                                variant="outline"
                                size="icon-xs"
                                onClick={() =>
                                  handleRerunAllDiffs(
                                    rpt.candidateTarget,
                                    rpt.baselineTarget
                                  )
                                }
                                disabled={rerunningTestId === 'ALL'}
                                aria-label={`Rerun Diffs for ${rpt.id}`}
                                title="Rerun only the differing test cases from this report"
                              >
                                <RotateCw
                                  className={`!size-3 ${
                                    rerunningTestId === 'ALL'
                                      ? 'animate-spin'
                                      : ''
                                  }`}
                                />
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
            </Card>
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
              <Card className="lg:col-span-5 overflow-hidden">
                <div className="px-3.5 py-2 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
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

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-1.5">Page & Test Case</TableHead>
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

                      return (
                        <TableRow
                          key={item.testId}
                          data-state={isSelected ? 'selected' : undefined}
                          onClick={() => handleSelectTestRow(item)}
                          className="cursor-pointer"
                        >
                          <TableCell className="py-1.5">
                            <div
                              className="flex items-center gap-2"
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
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-xs text-foreground">
                                    {item.testId}
                                  </span>
                                  <span className="font-medium text-xs text-foreground truncate max-w-[145px]">
                                    {item.testName}
                                  </span>
                                </div>
                                <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[175px]">
                                  {item.url}
                                </div>
                              </div>
                            </div>
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
              </Card>

              <div className="lg:col-span-7">
                {selectedItem && (
                  <TestInspector
                    item={selectedItem}
                    activeTab={inspectorTab}
                    onTabChange={setInspectorTab}
                    candidateLabel={formatShortTarget(activeCandidateRun)}
                    baselineLabel={formatShortTarget(activeBaselineRun)}
                    isRerunningTest={rerunningTestId === selectedItem.testId}
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
                <Card className="lg:col-span-5 overflow-hidden">
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

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-2">Test Case</TableHead>
                        <TableHead className="text-right w-20 py-2">Status</TableHead>
                        <TableHead className="text-right w-20 py-2">Latency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeSingleRun.results.map((res) => {
                        const isSelected = res.id === selectedSingleResult?.id;
                        return (
                          <TableRow
                            key={res.id}
                            data-state={isSelected ? 'selected' : undefined}
                            onClick={() => setSelectedTestId(res.id)}
                            className="cursor-pointer"
                          >
                            <TableCell className="py-1.5">
                              <div
                                className="flex items-center gap-2"
                                title={`${res.id}: ${res.name} (${res.url})`}
                              >
                                <PageMiniThumb
                                  testId={res.id}
                                  testName={res.name}
                                  url={res.url}
                                  hasVisualDiff={!res.pass}
                                />
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
                                    <span className="font-medium text-xs truncate max-w-[140px]">
                                      {res.name}
                                    </span>
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[175px]">
                                    {res.url}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono text-xs">
                              <Badge
                                variant={res.pass ? 'secondary' : 'destructive'}
                                className="font-mono text-[10px] px-1.5 py-0"
                              >
                                {res.actualStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                              {res.durationMs}ms
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>

                <div className="lg:col-span-7">
                  {selectedSingleResult && (
                    <SingleRunInspector
                      result={selectedSingleResult}
                      targetLabel={focusedTargetId}
                      runLabel={activeSingleRun.label || '#1'}
                      isRerunning={rerunningTestId === selectedSingleResult.id}
                      onRerunTest={handleRerunSingleTest}
                    />
                  )}
                </div>
              </div>
            </main>
          </>
        );
      })()}
    </div>
  );
}
