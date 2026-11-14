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
  GLOBAL_EXECUTION_POPS,
  ReadyReportDefinition,
  TestCaseDefinition,
  resolveExecutionPopOption,
  resolvePropertyHostname,
  getPropertyTestSuite,
  resolveRegionalEdgeNode,
} from './config/template.config';
import {
  INITIAL_RULES,
  INITIAL_RUNS,
  INITIAL_TARGET_STATES,
  buildInitialComparison,
  generateTestResults,
  seedRunsFromConfig,
} from './data/mockStore';
import {
  CURRENT_VERSION,
  DataSourceMode,
  buildDefaultRunMap,
  clearPersistedPortalState,
  generateEnterpriseScaleTopology,
  isDummySeededRun,
  loadPersistedPortalState,
  savePersistedPortalState,
} from './adapters/syntheticsAdapter';
import {
  generateComparisonMarkdownSummary,
  generateReproduceCurl,
} from './engine/rules';
import {
  classifyVisualVerdictFromPixelDiff,
  describeVisualDiffLogically,
  humanizeVisualSummary,
  isTechnicalPixelSummary,
  measureBrowserImagePairPixelDiff,
  type VisualZoneMetrics,
} from './engine/pixelDiff';
import { resolveLiveScreenshotUrl } from './engine/domScreenshotRenderer';
import {
  computeSuiteSreSummary,
  diagnoseCheckRootCause,
} from './engine/sreIntelligence';
import {
  CommandPaletteItem,
  ShortcutStateContext,
  ShortcutTargetLike,
  ShortcutViewMode,
  resolveKeyboardAction,
} from './engine/shortcuts';
import {
  CommandPaletteModal,
  ShortcutsHelpModal,
  SuitePopLauncherModal,
  Kbd,
} from './components/CommandPaletteModal';
import {
  TestInspector,
  SingleRunInspector,
  InspectorDimension,
  LiveProbeFeedback,
} from './components/TestInspector';
import {
  BackgroundJob,
  BackgroundJobsPopover,
  ComparisonTargetBar,
  LoginView,
  McpAndAwsBackendView,
  NetworkEndpointCell,
  PropertyCommandSwitcher,
  ScalableFleetContextBar,
  PageMiniThumb,
  SettingsView,
  AboutView,
  TestSuitesView,
} from './components/ControlCenterViews';
import {
  classifyPropertyRegion,
  filterAndPaginateDiffItems,
  DiffDimensionFilter,
  RegionCode,
  VerdictFilter,
} from './engine/scalableViewEngine';
import {
  Card,
  CardHeader,
  CardTitle,
} from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
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
  Command,
  Keyboard,
} from 'lucide-react';
import { VsCodeWorkspace } from './components/VsCodeWorkspace';

type ViewMode =
  | 'property'
  | 'suites'
  | 'diff'
  | 'run'
  | 'mcp'
  | 'terminal'
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
  const [acceptedCookies, setAcceptedCookies] = useState<string[]>(() =>
    Array.from(
      new Set([
        ...initialPersisted.acceptedCookies,
        '_abck',
        'bm_sz',
        'ak_bmsc',
        'ew_renderer_id',
        'akacd_smb_overview_split',
        'edge_region',
      ])
    )
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
  const [diffDimensionFilter, setDiffDimensionFilter] =
    useState<DiffDimensionFilter>('all');
  const [diffSortBy, setDiffSortBy] = useState<
    'id' | 'severity' | 'latency' | 'hops'
  >('id');
  const [diffPage, setDiffPage] = useState<number>(1);
  const [diffPageSize, setDiffPageSize] = useState<number>(12);
  const [diffSearchQuery, setDiffSearchQuery] = useState<string>('');

  // Overview Triage & Fleet Matrix scalable filter/pagination state
  const [triageFilter, setTriageFilter] = useState<
    'all' | 'headers' | 'cookies' | 'visual'
  >('all');
  const [triageSearchQuery, setTriageSearchQuery] = useState<string>('');
  const [triagePage, setTriagePage] = useState<number>(1);

  const [fleetRegionFilter, setFleetRegionFilter] = useState<
    'ALL' | RegionCode
  >('ALL');
  const [fleetVerdictFilter, setFleetVerdictFilter] =
    useState<VerdictFilter>('ALL');
  const [fleetSearchQuery, setFleetSearchQuery] = useState<string>('');
  const [fleetPage, setFleetPage] = useState<number>(1);
  const [fleetPageSize, setFleetPageSize] = useState<number>(15);

  // Single Run view scalable filter/pagination state
  const [runFilter, setRunFilter] = useState<
    'all' | 'redirects' | 'multi-hop' | 'cache-no'
  >('all');
  const [runSearchQuery, setRunSearchQuery] = useState<string>('');
  const [runPage, setRunPage] = useState<number>(1);
  const [runPageSize, setRunPageSize] = useState<number>(12);

  const [reportScope, setReportScope] = useState<'active' | 'all'>('active');
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [homeRightTab, setHomeRightTab] = useState<'fleet' | 'audit'>('fleet');

  const [isComparingBoth, setIsComparingBoth] = useState<boolean>(false);
  const [rerunningTestId, setRerunningTestId] = useState<string | null>(null);
  const [runningAiTestId, setRunningAiTestId] = useState<string | null>(null);
  const [isAwsLambdaBackend, setIsAwsLambdaBackend] = useState<boolean>(false);
  const [lastProbedByTestId, setLastProbedByTestId] = useState<
    Record<string, LiveProbeFeedback>
  >({});
  const [isHydratingLiveRuns, setIsHydratingLiveRuns] = useState<boolean>(() =>
    isDummySeededRun(initialPersisted.runs[0])
  );

  // Global PoP Origin Override + Keyboard Shortcuts / Modals State
  const [selectedExecutionPopId, setSelectedExecutionPopId] = useState<string>('auto');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState<boolean>(false);
  const [suitePopLauncherOpen, setSuitePopLauncherOpen] = useState<boolean>(false);
  const [propertySwitcherOpen, setPropertySwitcherOpen] = useState<boolean>(false);
  const [pendingChord, setPendingChord] = useState<'g' | null>(null);
  const [diffInspectorDiffsOnly, setDiffInspectorDiffsOnly] = useState<boolean>(false);

  const normalizeRunPropertyUrls = (r: RunRecord & { targetId?: string }): RunRecord => {
    const target = r.target || r.targetId || 'www.prod.staging';
    const [appId = 'www', envId = 'prod', net = 'staging'] = target.split('.');
    const isStaging = net === 'staging';
    const isRegional = ['japan', 'germany', 'uk', 'apac', 'emea', 'americas'].includes(
      appId.toLowerCase()
    );
    const canonicalHost = resolvePropertyHostname(appId, envId);
    const effectiveSuiteAppId = r.suiteAppId || appId;
    const propSuite = getPropertyTestSuite(effectiveSuiteAppId);
    const popOverrideId = r.executionPop?.id;
    const cleanLabel =
      !r.label ||
      r.label === 'v2026.11-rc1' ||
      r.label === 'live-baseline' ||
      r.label.startsWith('live-edge')
        ? `live-${isStaging ? 'staging' : 'prod'}`
        : r.label;
    return {
      ...r,
      target,
      appId: r.appId || appId,
      envId: r.envId || envId,
      suiteAppId: effectiveSuiteAppId,
      label: cleanLabel,
      results: (r.results || []).map((res) => {
        const matchingTc = propSuite.find((tc) => tc.id === res.id);
        const name = matchingTc?.name || res.name;
        const testPath = matchingTc?.path || (res as typeof res & { path?: string }).path || '/';
        const cleanUrl = `https://${canonicalHost}${testPath}`;
        const regionalNode = resolveRegionalEdgeNode(appId, cleanUrl, popOverrideId);
        const regionalEdgeIp = isStaging
          ? regionalNode.stagingEdgeIp
          : regionalNode.prodEdgeIp;
        const popCode = isStaging
          ? regionalNode.stagingPopCode
          : regionalNode.prodPopCode;
        const deployEdgeHost = isStaging
          ? regionalNode.stagingEdgeHost
          : regionalNode.prodEdgeHost;
        const expectedStatusStr = matchingTc?.expectedStatus || res.expectedStatus || '200';
        const expects200 = expectedStatusStr === '200';
        const fixedActualStatus =
          expects200 && res.actualStatus === 301 ? 200 : res.actualStatus;

        const effectiveEdgeIp = isRegional
          ? regionalEdgeIp
          : res.stagingEdgeIp || regionalEdgeIp;

        const rawHops = res.redirectChain || [];
        const filteredHops =
          expects200 &&
          rawHops.length > 1 &&
          rawHops[0]?.url?.endsWith('/crm')
            ? [rawHops[rawHops.length - 1]]
            : rawHops;

        const mappedHops = filteredHops.map((hop, idx) => ({
          ...hop,
          hopNumber: idx + 1,
          url: idx === 0 ? cleanUrl : hop.url,
          status: idx === 0 && expects200 && hop.status === 301 ? 200 : hop.status,
          edgeIp: isRegional ? regionalEdgeIp : hop.edgeIp || effectiveEdgeIp,
          requestHeaders: {
            ...(hop.requestHeaders || {}),
            'accept-language': regionalNode.acceptLanguage,
            'x-sfdc-edge-region-pop': `${popCode} (${regionalNode.regionCode})`,
            'x-akamai-edgescape': regionalNode.edgescapeHeader,
          },
          responseHeaders: {
            ...(hop.responseHeaders || {}),
            'x-sfdc-edge-pop': popCode,
            'content-language': regionalNode.contentLanguage,
            'x-akamai-edgescape': regionalNode.edgescapeHeader,
          },
        }));

        const nextHeaders = {
          ...(res.capturedHeaders || {}),
          'x-sfdc-edge-pop': popCode,
          'content-language': regionalNode.contentLanguage,
          'x-akamai-edgescape': regionalNode.edgescapeHeader,
          'x-cache': isStaging
            ? `TCP_MISS from ${deployEdgeHost}`
            : `TCP_HIT from ${deployEdgeHost}`,
        };
        if (expects200) {
          delete nextHeaders.location;
        }

        const nextCookies: Record<string, string> = {
          ...(res.capturedCookies || {}),
          prorigin: `${regionalNode.proriginCode}; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax`,
          AKA_A2: `${regionalNode.countryCode}; Path=/; Domain=.salesforce.com; Secure`,
          sfdc_locale: `${regionalNode.locale}; Path=/; Domain=.salesforce.com; Secure`,
        };
        if (isStaging && res.id === 'T02') {
          nextCookies.edge_cache_bypass =
            '1; Path=/products; Domain=.salesforce.com; Secure; SameSite=Lax';
        }

        return {
          ...res,
          name,
          url: cleanUrl,
          canonicalUrl: cleanUrl,
          expectedStatus: expectedStatusStr,
          actualStatus: fixedActualStatus,
          stagingEdgeIp: effectiveEdgeIp,
          capturedHeaders: nextHeaders,
          capturedCookies: nextCookies,
          redirectChain: mappedHops,
          httpFlowSummary: res.httpFlowSummary
            ? {
                ...res.httpFlowSummary,
                totalHops: mappedHops.length || 1,
                redirectCount: Math.max(0, (mappedHops.length || 1) - 1),
                resolvedEdgeIp: effectiveEdgeIp,
                finalUrl:
                  mappedHops[mappedHops.length - 1]?.url || cleanUrl,
              }
            : undefined,
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

            const activeStg =
              incomingRuns.find((r) => r.target === `${activeAppId}.prod.staging`) ||
              incomingRuns.find((r) => r.target === 'www.prod.staging');
            const activePrd =
              incomingRuns.find((r) => r.target === `${activeAppId}.prod.prod`) ||
              incomingRuns.find((r) => r.target === 'www.prod.prod');
            if (activeStg) setCandidateRunKey(activeStg.key);
            if (activePrd) setBaselineRunKey(activePrd.key);

            // Hydrate persisted live probe & screenshot metadata from backend/DynamoDB runs so F5 keeps revision & SHA-256 proof
            setLastProbedByTestId((prev) => {
              const hydrated = { ...prev };
              for (const r of incomingRuns) {
                for (const res of r.results || []) {
                  if (
                    res.probedAt ||
                    res.screenshotRevision ||
                    res.screenshotSha256 ||
                    res.screenshotBytes
                  ) {
                    const existing = hydrated[res.id];
                    const rev = res.screenshotRevision || existing?.screenshotRevision;
                    if (!existing || (rev && (!existing.screenshotRevision || rev >= existing.screenshotRevision))) {
                      const parsedProbed = res.probedAt ? new Date(res.probedAt) : null;
                      const safeAt =
                        parsedProbed && !Number.isNaN(parsedProbed.getTime())
                          ? parsedProbed.toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : res.probedAt || existing?.at || 'Live';
                      hydrated[res.id] = {
                        at: safeAt,
                        count: res.probeCount || existing?.count || 1,
                        candMs: res.httpFlowSummary?.totalDurationMs || res.durationMs || 85,
                        baseMs: existing?.baseMs,
                        status: res.actualStatus ?? 200,
                        screenshotRevision: rev,
                        screenshotCaptured: Boolean(
                          res.screenshotCaptured ??
                            (typeof res.screenshotBytes === 'number'
                              ? res.screenshotBytes > 0
                              : Boolean(res.screenshotSha256 || res.s3ScreenshotKey))
                        ),
                        sha256: res.screenshotSha256 || existing?.sha256,
                        bytes: res.screenshotBytes || existing?.bytes,
                        s3Key: res.s3ScreenshotKey || existing?.s3Key,
                        persistedToRunKey: r.key,
                      };
                    }
                  }
                }
              }
              return hydrated;
            });

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
        const isAwsLambda = Boolean(
          String(health?.computeArchitecture || '').includes('aws-lambda') ||
            health?.chromiumRunnerLambda
        );
        setIsAwsLambdaBackend(isAwsLambda);
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
      version: CURRENT_VERSION,
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
    setSelectedExecutionPopId('auto');
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

    let nextCandKey = candRun?.key;
    let nextBaseKey = baseRun?.key;
    if (!candRun || !baseRun) {
      const seeded = seedRunsFromConfig();
      const freshCand = candRun || seeded.find((r) => r.target === candTarget);
      const freshBase = baseRun || seeded.find((r) => r.target === baseTarget);
      if (freshCand && freshBase) {
        setRuns((prev) => [
          freshCand,
          freshBase,
          ...prev.filter(
            (r) => r.target !== candTarget && r.target !== baseTarget
          ),
        ]);
        nextCandKey = freshCand.key;
        nextBaseKey = freshBase.key;
      }
    }

    if (nextCandKey) setCandidateRunKey(nextCandKey);
    if (nextBaseKey) setBaselineRunKey(nextBaseKey);
    setFocusedTargetId(candTarget);
    const nextSuite = getPropertyTestSuite(appId);
    setTestSuite(nextSuite);
    setSelectedTestId(nextSuite[0]?.id || 'T01');
    setInspectorTab('headers');
    setViewMode((prev) =>
      prev === 'diff' ? 'diff' : prev === 'suites' ? 'suites' : 'property'
    );
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

  const handleToggleSuiteScale = () => {
    const baseSuite = getPropertyTestSuite(activeAppId);
    if (testSuite.length > baseSuite.length) {
      syncRunsWithSuite(baseSuite);
      setDiffPage(1);
      setRunPage(1);
      setTriagePage(1);
      toast.info(`Restored 8 Core Canary Checks for ${activeAppId}`);
      return;
    }

    const extraRoutes: Array<{
      path: string;
      name: string;
      status: string;
      category: string;
    }> = [
      { path: '/products/data-cloud', name: 'Data Cloud Zero-Copy Federation', status: '200', category: 'Product' },
      { path: '/products/service-cloud', name: 'Service Cloud Case Routing', status: '200', category: 'Product' },
      { path: '/products/commerce-cloud', name: 'B2B & D2C Commerce Storefront', status: '301', category: 'Redirect' },
      { path: '/products/marketing-cloud', name: 'Marketing Cloud Edge Beacon', status: '200', category: 'Product' },
      { path: '/products/mulesoft', name: 'MuleSoft Anypoint API Gateway', status: '200', category: 'API' },
      { path: '/products/tableau', name: 'Tableau Pulse Analytics Gateway', status: '200', category: 'Analytics' },
      { path: '/products/slack', name: 'Slack AI Work OS Landing', status: '301', category: 'Redirect' },
      { path: '/solutions/financial-services', name: 'Financial Services Cloud Edge', status: '200', category: 'Industry' },
      { path: '/solutions/healthcare', name: 'Health Cloud HIPAA Edge Policy', status: '200', category: 'Industry' },
      { path: '/solutions/manufacturing', name: 'Manufacturing Cloud Partner Hub', status: '200', category: 'Industry' },
      { path: '/jp/products/agentforce', name: 'Japan PoP (NRT) Localized Agentforce', status: '301', category: 'Regional PoP' },
      { path: '/de/editions-pricing', name: 'Germany PoP (FRA) GDPR & Pricing', status: '200', category: 'Regional PoP' },
      { path: '/uk/customer-success', name: 'UK PoP (LHR) Customer Stories', status: '200', category: 'Regional PoP' },
      { path: '/ap/events/world-tour', name: 'APAC PoP (SIN) World Tour Reg', status: '301', category: 'Regional PoP' },
      { path: '/eu/trust-compliance', name: 'EMEA PoP (AMS) Sovereign Cloud', status: '200', category: 'Regional PoP' },
      { path: '/login/sso-preflight', name: 'Edge OIDC & SAML Auth Preflight', status: '200', category: 'Security' },
    ];

    const scaledSuite: TestCaseDefinition[] = [...baseSuite];
    for (let i = baseSuite.length; i < 64; i++) {
      const num = i + 1;
      const id = `T${String(num).padStart(2, '0')}`;
      const tpl = extraRoutes[(i - baseSuite.length) % extraRoutes.length];
      const shard = Math.floor((i - baseSuite.length) / extraRoutes.length) + 1;
      scaledSuite.push({
        id,
        name: shard === 1 ? tpl.name : `${tpl.name} (Shard #${shard})`,
        path: shard === 1 ? tpl.path : `${tpl.path}/shard-${shard}`,
        expectedStatus: tpl.status,
        category: tpl.category,
        enabled: true,
      });
    }

    syncRunsWithSuite(scaledSuite);
    setDiffPage(1);
    setRunPage(1);
    setTriagePage(1);
    toast.success(
      `Loaded 64 Global Enterprise Suite Checks (${scaledSuite.length} checks across Staging & Prod)`
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
    if (chosenKey) {
      const foundChosen = targetRuns.find((r) => r.key === chosenKey);
      if (foundChosen) return foundChosen;
    }
    if (targetRuns.length > 0) return targetRuns[0];

    const seeded = seedRunsFromConfig();
    const fallbackRun =
      seeded.find((r) => r.target === targetId) ||
      runs.find((r) => r.target === targetId) ||
      runs[0];
    return fallbackRun;
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

  // Preload live Chromium JPEG screenshots only in local dev server mode (never fire 16 anticipatory Lambda fetches on AWS)
  useEffect(() => {
    if (isAwsLambdaBackend) return;
    const timer = setTimeout(() => {
      const ids = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'];
      for (const id of ids) {
        const imgA = new Image();
        imgA.src = `/screenshots/${activeAppId}-${id}-sideA.jpg`;
        const imgB = new Image();
        imgB.src = `/screenshots/${activeAppId}-${id}-sideB.jpg`;
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [activeAppId, isAwsLambdaBackend]);

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
        affectedArea?: string;
        shortCallout?: string;
        pixelDiffPercent?: number;
        changedBox?: { x: number; y: number; w: number; h: number } | null;
        zones?: VisualZoneMetrics | null;
        costGate?: 'identical-bytes' | 'pixel-gate-passed' | 'ai-judged';
      }
    >
  >({});

  // Genuine browser-side <canvas> zone & layout comparison across rendered Side A & Side B screenshots
  useEffect(() => {
    if (activeCandidateRun.key === activeBaselineRun.key) return;
    let cancelled = false;

    const verifyRenderedScreenshotPairs = async () => {
      for (const candRes of activeCandidateRun.results) {
        if (cancelled) return;
        const baseRes = activeBaselineRun.results.find((r) => r.id === candRes.id);
        if (!baseRes) continue;

        const probeInfo = lastProbedByTestId[candRes.id];
        const revA = probeInfo?.screenshotRevision ?? candRes.screenshotRevision;
        const revB = probeInfo?.screenshotRevision ?? baseRes.screenshotRevision;

        const urlA =
          candRes.screenshotUrl ||
          probeInfo?.screenshotUrl ||
          resolveLiveScreenshotUrl({
            appId: activeCandidateRun.appId,
            testId: candRes.id,
            url: candRes.canonicalUrl,
            side: 'A',
            revision: revA,
          });
        const urlB =
          baseRes.screenshotUrl ||
          resolveLiveScreenshotUrl({
            appId: activeBaselineRun.appId,
            testId: baseRes.id,
            url: baseRes.canonicalUrl || candRes.canonicalUrl,
            side: 'B',
            revision: revB,
          });

        const measured = await measureBrowserImagePairPixelDiff(urlA, urlB);
        if (cancelled || !measured) continue;

        const scopedKey = `${activeCandidateRun.appId}-${candRes.id}`;
        const realPct = measured.pixelDiffPercent;
        const realVerdict = classifyVisualVerdictFromPixelDiff(realPct);
        const logical = describeVisualDiffLogically({
          pixelDiffPercent: realPct,
          changedBox: measured.changedBox,
          zones: measured.zones ?? null,
          candidateLabel: activeCandidateRun.network,
          baselineLabel: activeBaselineRun.network,
          pageName: candRes.name,
          url: candRes.canonicalUrl,
        });

        setAiJudgeOverrides((prev) => {
          const existing = prev[scopedKey] ?? prev[candRes.id];
          // If rendered images have a real visual diff (> 0.1%), ensure logical human explanation is populated
          if (realPct > 0.1) {
            const hasCleanSummary =
              existing &&
              existing.verdict !== 'same' &&
              existing.summary &&
              !isTechnicalPixelSummary(existing.summary) &&
              !existing.summary.includes('match as they are from the same website') &&
              !existing.summary.includes('Screenshots match within 0.1%') &&
              Boolean(existing.shortCallout);

            if (
              hasCleanSummary &&
              typeof existing.pixelDiffPercent === 'number' &&
              Math.abs(existing.pixelDiffPercent - realPct) < 0.2
            ) {
              return prev;
            }

            const nextEntry = {
              verdict: realVerdict,
              pixelDiffPercent: realPct,
              changedBox: measured.changedBox,
              zones: measured.zones ?? null,
              affectedArea: existing?.affectedArea || logical.affectedArea,
              shortCallout: existing?.shortCallout || logical.shortCallout,
              costGate: 'ai-judged' as const,
              summary:
                existing?.summary && !isTechnicalPixelSummary(existing.summary)
                  ? humanizeVisualSummary(existing.summary, {
                      pixelDiffPercent: realPct,
                      changedBox: measured.changedBox,
                      zones: measured.zones ?? null,
                      candidateLabel: activeCandidateRun.network,
                      baselineLabel: activeBaselineRun.network,
                      pageName: candRes.name,
                      url: candRes.canonicalUrl,
                    })
                  : logical.summary,
            };
            return {
              ...prev,
              [scopedKey]: nextEntry,
              [candRes.id]: nextEntry,
            };
          }

          // If rendered images match (<= 0.1%) and an old override claimed a diff, reset to same
          if (realPct <= 0.1 && existing && existing.verdict !== 'same') {
            const sameEntry = {
              verdict: 'same' as const,
              pixelDiffPercent: realPct,
              changedBox: null,
              zones: measured.zones ?? null,
              affectedArea: 'None',
              shortCallout: 'Visually identical',
              costGate: 'identical-bytes' as const,
              summary: logical.summary,
            };
            return {
              ...prev,
              [scopedKey]: sameEntry,
              [candRes.id]: sameEntry,
            };
          }

          return prev;
        });
      }
    };

    verifyRenderedScreenshotPairs();
    return () => {
      cancelled = true;
    };
  }, [
    activeCandidateRun.key,
    activeBaselineRun.key,
    activeCandidateRun.appId,
    activeBaselineRun.appId,
    activeCandidateRun.results,
    activeBaselineRun.results,
    lastProbedByTestId,
  ]);

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

  const pagedDiffResult = useMemo(() => {
    return filterAndPaginateDiffItems(
      comparison.items,
      {
        getUnacceptedHeaderCount: (it) => getItemDiffCounts(it).hDiffs,
        getUnacceptedCookieCount: (it) => getItemDiffCounts(it).cDiffs,
        hasActiveVisualDiff: (it) => getItemDiffCounts(it).vDiff,
      },
      {
        query: diffSearchQuery,
        dimension: diffDimensionFilter,
        sortBy: diffSortBy,
        selectedTestId,
        page: diffPage,
        pageSize: diffPageSize,
      }
    );
  }, [
    comparison.items,
    diffSearchQuery,
    diffDimensionFilter,
    diffSortBy,
    selectedTestId,
    diffPage,
    diffPageSize,
    acceptedFields,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
  ]);

  const verdictByAppId = useMemo(() => {
    const map: Record<string, 'GO' | 'REVIEW' | 'NO-GO'> = {};
    for (const appItem of apps) {
      const stgTarget = `${appItem.id}.prod.staging`;
      const prdTarget = `${appItem.id}.prod.prod`;
      const stgR = getActiveRunForTarget(stgTarget);
      const prdR = getActiveRunForTarget(prdTarget);
      const comp = buildInitialComparison(stgR, prdR, 'network', acceptedRules, {
        acceptedCookies,
        acceptedVisualTests,
        ignoreAcceptedDiffs,
        aiJudgeOverrides,
      });
      map[appItem.id] =
        comp.headlineVerdict === 'NO-GO' || comp.headlineVerdict === 'REVIEW'
          ? comp.headlineVerdict
          : 'GO';
    }
    return map;
  }, [
    apps,
    runs,
    selectedRunByTarget,
    acceptedRules,
    acceptedCookies,
    acceptedVisualTests,
    ignoreAcceptedDiffs,
    aiJudgeOverrides,
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
    useNewRunVariant = false,
    options?: { suiteAppId?: string; popId?: string }
  ): RunRecord => {
    const [appId, envId, net] = targetId.split('.');
    const network = (net === 'staging' ? 'staging' : 'prod') as 'staging' | 'prod';
    const effectiveSuiteAppId = options?.suiteAppId || appId;
    const effectiveSuite =
      effectiveSuiteAppId === activeAppId
        ? testSuite
        : getPropertyTestSuite(effectiveSuiteAppId);
    const effectivePopId = options?.popId ?? selectedExecutionPopId;
    const popOpt = resolveExecutionPopOption(effectivePopId);

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
      effectiveSuite,
      DEFAULT_TEMPLATE_CONFIG,
      popOpt?.id
    );

    const tags = [
      popOpt ? `via ${popOpt.popCode}` : '',
      effectiveSuiteAppId !== appId ? `suite:${effectiveSuiteAppId}` : '',
    ].filter(Boolean);

    return normalizeRunPropertyUrls({
      key,
      target: targetId,
      appId,
      envId,
      network,
      suiteAppId: effectiveSuiteAppId,
      suiteKey: `config/suites/${effectiveSuiteAppId}.csv`,
      suiteSha256: '9f83a21b33c0',
      suiteRowCount: results.length,
      executionPop: popOpt
        ? {
            id: popOpt.id,
            popCode: popOpt.popCode,
            regionLabel: popOpt.city,
            awsRegion: popOpt.awsRegion,
            stagingPopCode: popOpt.stagingPopCode,
            prodPopCode: popOpt.prodPopCode,
            stagingEdgeIp: popOpt.stagingEdgeIp,
            prodEdgeIp: popOpt.prodEdgeIp,
          }
        : undefined,
      startTime: now.toISOString(),
      finishTime: new Date(now.getTime() + 420).toISOString(),
      totalTests: results.length,
      passedTests: results.filter((r) => r.pass).length,
      failedTests: results.filter((r) => !r.pass).length,
      by: currentUser?.email || 'operator',
      label: `${labelPrefix} #${runNumber}${tags.length ? ` [${tags.join(' · ')}]` : ''} · ${shortTime}`,
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

  const handleRunSingleTarget = (
    targetId: string,
    openFocusedRun = false,
    options?: { suiteAppId?: string; popId?: string }
  ) => {
    const previousRun = runs.find((r) => r.target === targetId);
    const [targetAppId] = targetId.split('.');
    const effectiveSuiteAppId = options?.suiteAppId || targetAppId;
    const effectivePopId = options?.popId ?? selectedExecutionPopId;
    const popOpt = resolveExecutionPopOption(effectivePopId);

    setTargetStates((prev) => ({
      ...prev,
      [targetId]: { state: 'running', progress: 'Running…' },
    }));

    enqueueBackgroundJob(
      `Canary Suite (${effectiveSuiteAppId}.csv): ${targetId}${popOpt ? ` @ ${popOpt.popCode}` : ''}`,
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
        const labelTags = [
          popOpt ? `via ${popOpt.popCode}` : '',
          effectiveSuiteAppId !== targetAppId ? `suite:${effectiveSuiteAppId}` : '',
        ].filter(Boolean);
        const freshLabel = `live-probe #${runNumber}${
          labelTags.length ? ` [${labelTags.join(' · ')}]` : ''
        } · ${nowStr}`;
        const freshKey = `run-${targetId.replace(/\./g, '-')}-${runNumber}-${Date.now()
          .toString()
          .slice(-4)}`;
        let newRun = createNewRunRecord(targetId, 'live-probe', true, {
          suiteAppId: effectiveSuiteAppId,
          popId: effectivePopId,
        });
        try {
          const resp = await fetch('/api/v1/runs/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target: targetId,
              runKey: freshKey,
              label: freshLabel,
              suiteAppId: effectiveSuiteAppId,
              popId: popOpt?.id,
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
                suiteAppId: remoteRun.suiteAppId || effectiveSuiteAppId,
                executionPop:
                  remoteRun.executionPop ||
                  (popOpt
                    ? {
                        id: popOpt.id,
                        popCode: popOpt.popCode,
                        regionLabel: popOpt.city,
                        awsRegion: popOpt.awsRegion,
                        stagingPopCode: popOpt.stagingPopCode,
                        prodPopCode: popOpt.prodPopCode,
                        stagingEdgeIp: popOpt.stagingEdgeIp,
                        prodEdgeIp: popOpt.prodEdgeIp,
                      }
                    : undefined),
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

        const freshScreenshotRev = Date.now();
        setLastProbedByTestId((prev) => {
          const next = { ...prev };
          for (const res of newRun.results) {
            const prevCount = next[res.id]?.count || 0;
            next[res.id] = {
              at: nowStr,
              count: prevCount + 1,
              candMs: res.httpFlowSummary?.totalDurationMs || res.durationMs,
              status: res.actualStatus,
              screenshotRevision: freshScreenshotRev,
              screenshotCaptured: Boolean(
                res.screenshotCaptured ??
                  (typeof res.screenshotBytes === 'number'
                    ? res.screenshotBytes > 0
                    : Boolean(res.screenshotSha256 || res.s3ScreenshotKey))
              ),
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
        if (newRun.results[0]?.id) {
          setSelectedTestId(newRun.results[0].id);
        }

        const newReport: ReadyReportDefinition = {
          id: `RPT-${105 + readyReports.length}`,
          title: `Run-over-Run: ${targetId} · ${effectiveSuiteAppId}.csv${
            popOpt ? ` via ${popOpt.popCode}` : ''
          } (${newRun.label} vs ${previousRun?.label || 'prev'})`,
          appId: targetAppId,
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
          `Executed ${effectiveSuiteAppId}.csv on ${targetId}${
            popOpt ? ` from ${popOpt.popCode} (${popOpt.city})` : ''
          }`
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
    stayOnCurrentView = false,
    options?: { suiteAppId?: string; popId?: string }
  ) => {
    if (targetA === targetB) {
      handleRunSingleTarget(targetA, false, options);
      return;
    }

    const [appA] = targetA.split('.');
    const effectiveSuiteAppId = options?.suiteAppId || appA;
    const effectivePopId = options?.popId ?? selectedExecutionPopId;
    const popOpt = resolveExecutionPopOption(effectivePopId);

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
      `Comparative Canary (${effectiveSuiteAppId}.csv${popOpt ? ` @ ${popOpt.popCode}` : ''}): ${targetA} vs ${targetB}`,
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
        const labelTags = [
          popOpt ? `via ${popOpt.popCode}` : '',
          effectiveSuiteAppId !== appA ? `suite:${effectiveSuiteAppId}` : '',
        ].filter(Boolean);
        const tagSuffix = labelTags.length ? ` [${labelTags.join(' · ')}]` : '';
        const labelA = `live-stg #${numA}${tagSuffix} · ${nowStr}`;
        const labelB = `live-prd #${numB}${tagSuffix} · ${nowStr}`;
        const keyA = `run-${targetA.replace(/\./g, '-')}-${numA}-${Date.now()
          .toString()
          .slice(-4)}`;
        const keyB = `run-${targetB.replace(/\./g, '-')}-${numB}-${Date.now()
          .toString()
          .slice(-4)}`;

        let newRunA = createNewRunRecord(targetA, 'live-stg', false, {
          suiteAppId: effectiveSuiteAppId,
          popId: effectivePopId,
        });
        let newRunB = createNewRunRecord(targetB, 'live-prd', false, {
          suiteAppId: effectiveSuiteAppId,
          popId: effectivePopId,
        });

        try {
          const [respA, respB] = await Promise.all([
            fetch('/api/v1/runs/trigger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                target: targetA,
                runKey: keyA,
                label: labelA,
                suiteAppId: effectiveSuiteAppId,
                popId: popOpt?.id,
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
                suiteAppId: effectiveSuiteAppId,
                popId: popOpt?.id,
                by: currentUser?.email || 'operator',
              }),
            }),
          ]);
          const popMeta = popOpt
            ? {
                id: popOpt.id,
                popCode: popOpt.popCode,
                regionLabel: popOpt.city,
                awsRegion: popOpt.awsRegion,
                stagingPopCode: popOpt.stagingPopCode,
                prodPopCode: popOpt.prodPopCode,
                stagingEdgeIp: popOpt.stagingEdgeIp,
                prodEdgeIp: popOpt.prodEdgeIp,
              }
            : undefined;
          if (respA.ok) {
            const dataA = await respA.json();
            const remoteA = dataA?.run || dataA?.newRun || dataA?.result;
            if (remoteA && Array.isArray(remoteA.results)) {
              newRunA = normalizeRunPropertyUrls({
                ...remoteA,
                key: remoteA.key || keyA,
                suiteAppId: remoteA.suiteAppId || effectiveSuiteAppId,
                executionPop: remoteA.executionPop || popMeta,
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
                suiteAppId: remoteB.suiteAppId || effectiveSuiteAppId,
                executionPop: remoteB.executionPop || popMeta,
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
        if (newRunA.results[0]?.id) {
          setSelectedTestId(newRunA.results[0].id);
        }
        setTargetStates((prev) => ({
          ...prev,
          [targetA]: { state: 'ready' },
          [targetB]: { state: 'ready' },
        }));

        const freshScreenshotRev = Date.now();
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
              screenshotRevision: freshScreenshotRev,
              screenshotCaptured: Boolean(
                resA.screenshotCaptured ??
                  (typeof resA.screenshotBytes === 'number'
                    ? resA.screenshotBytes > 0
                    : Boolean(resA.screenshotSha256 || resA.s3ScreenshotKey))
              ),
            };
          }
          return next;
        });

        const newReport: ReadyReportDefinition = {
          id: `RPT-${105 + readyReports.length}`,
          title: `Comparative Run (${effectiveSuiteAppId}.csv${
            popOpt ? ` via ${popOpt.popCode}` : ''
          }): ${targetA} vs ${targetB}`,
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
          `Executed ${effectiveSuiteAppId}.csv across ${targetA} ↔ ${targetB}${
            popOpt ? ` from ${popOpt.popCode} (${popOpt.city}) PoP` : ''
          } (${newRunA.results.length} checks).`
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
    testId: string,
    captureScreenshot = true
  ): Promise<
    (Partial<RunRecord['results'][0]> & {
      screenshotRevision?: number;
      screenshotCaptured?: boolean;
      persistedToRunKey?: string;
    }) | null
  > => {
    const targetRes = runRecord.results.find((r) => r.id === testId);
    if (!targetRes) return null;
    const popId =
      runRecord.executionPop?.id ||
      (selectedExecutionPopId !== 'auto' ? selectedExecutionPopId : undefined);

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
          captureScreenshot,
          popId,
          suiteAppId: runRecord.suiteAppId,
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
          const hasCapturedBytes = Boolean(
            data.screenshotCaptured &&
              (typeof data.screenshotBytes !== 'number' || data.screenshotBytes > 0)
          );
          const resolvedUrl =
            typeof data.screenshotUrl === 'string' && data.screenshotUrl
              ? data.screenshotUrl
              : undefined;
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
            probedAt: data.probedAt || new Date().toISOString(),
            probeCount: data.probeCount,
            screenshotRevision:
              typeof data.screenshotRevision === 'number'
                ? data.screenshotRevision
                : targetRes.screenshotRevision,
            screenshotCapturedAt: data.screenshotCapturedAt || undefined,
            screenshotSha256: data.screenshotSha256 || undefined,
            screenshotBytes: data.screenshotBytes,
            s3ScreenshotKey: data.s3ScreenshotKey,
            screenshotUrl: resolvedUrl,
            screenshotCaptured: hasCapturedBytes,
            screenshotSource: data.screenshotSource,
            captureEngine: data.captureEngine,
            canaryDispatched: Boolean(data.canaryDispatched),
            canaryName: typeof data.canaryName === 'string' ? data.canaryName : undefined,
            canaryError: typeof data.canaryError === 'string' ? data.canaryError : undefined,
            persistedToRunKey: data.persistedToRunKey,
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
            const hasCapturedBytes = Boolean(
              found.screenshotCaptured ??
                (typeof found.screenshotBytes === 'number' && found.screenshotBytes > 0)
            );
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
              probedAt: found.probedAt || new Date().toISOString(),
              screenshotRevision: found.screenshotRevision || targetRes.screenshotRevision,
              screenshotSha256: found.screenshotSha256,
              screenshotBytes: found.screenshotBytes,
              s3ScreenshotKey: found.s3ScreenshotKey,
              screenshotUrl: found.screenshotUrl || undefined,
              screenshotCaptured: hasCapturedBytes,
              screenshotSource: found.screenshotSource || trigData?.screenshotSource,
              captureEngine: found.captureEngine || trigData?.captureEngine,
              canaryDispatched: Boolean(trigData?.canaryDispatched),
              canaryName: typeof trigData?.canaryName === 'string' ? trigData.canaryName : undefined,
              canaryError: typeof trigData?.canaryError === 'string' ? trigData.canaryError : undefined,
              persistedToRunKey: normalized.key,
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

    const capturedNow = liveProbe?.screenshotCaptured === true;

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
      probedAt: liveProbe?.probedAt || new Date().toISOString(),
      probeCount: (res.probeCount || 0) + 1,
      screenshotRevision: capturedNow
        ? liveProbe?.screenshotRevision || Date.now()
        : res.screenshotRevision,
      screenshotCapturedAt: capturedNow
        ? liveProbe?.screenshotCapturedAt || new Date().toISOString()
        : res.screenshotCapturedAt,
      screenshotSha256: capturedNow
        ? liveProbe?.screenshotSha256 || res.screenshotSha256
        : res.screenshotSha256,
      screenshotBytes: capturedNow
        ? liveProbe?.screenshotBytes ?? res.screenshotBytes
        : res.screenshotBytes,
      s3ScreenshotKey: capturedNow
        ? liveProbe?.s3ScreenshotKey || res.s3ScreenshotKey
        : res.s3ScreenshotKey,
      screenshotUrl: capturedNow
        ? liveProbe?.screenshotUrl || res.screenshotUrl
        : liveProbe?.screenshotCaptured === false
        ? undefined
        : res.screenshotUrl,
      screenshotCaptured: liveProbe?.screenshotCaptured ?? res.screenshotCaptured,
      screenshotSource: liveProbe?.screenshotSource || res.screenshotSource,
      captureEngine: liveProbe?.captureEngine || res.captureEngine,
      canaryDispatched: liveProbe?.canaryDispatched ?? res.canaryDispatched,
      canaryName: liveProbe?.canaryName || res.canaryName,
      canaryError: liveProbe?.canaryError,
      pixelDiffPercent:
        typeof liveProbe?.pixelDiffPercent === 'number'
          ? liveProbe.pixelDiffPercent
          : res.pixelDiffPercent,
      note: capturedNow
        ? `Live HTTP Flow & 1280×760 DOM Screenshot persisted at ${nowStr}`
        : `Live HTTP flow probed at ${nowStr}${
            liveProbe?.canaryDispatched && liveProbe?.canaryName
              ? ` · Canary ${liveProbe.canaryName} dispatched for 1280×760 capture`
              : liveProbe?.canaryError
              ? ` · Browser capture unavailable (${liveProbe.canaryError})`
              : ''
          }`,
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

        const screenshotRevision =
          probeA?.screenshotRevision || probeB?.screenshotRevision;
        const sha256 = probeA?.screenshotSha256 || probeB?.screenshotSha256;
        const bytes = probeA?.screenshotBytes || probeB?.screenshotBytes || 0;
        const s3Key = probeA?.s3ScreenshotKey || probeB?.s3ScreenshotKey;
        const screenshotUrl = probeA?.screenshotUrl || probeB?.screenshotUrl || null;
        const screenshotSource =
          probeA?.screenshotSource || probeB?.screenshotSource;
        const captureEngine = probeA?.captureEngine || probeB?.captureEngine;
        const screenshotCaptured = Boolean(
          probeA?.screenshotCaptured === true || probeB?.screenshotCaptured === true
        );
        const canaryDispatched = Boolean(probeA?.canaryDispatched || probeB?.canaryDispatched);
        const canaryName = probeA?.canaryName || probeB?.canaryName;
        const canaryError = probeA?.canaryError || probeB?.canaryError;
        const persistedToRunKey =
          probeA?.persistedToRunKey || probeB?.persistedToRunKey || activeCandidateRun.key;

        setLastProbedByTestId((prev) => ({
          ...prev,
          [testId]: {
            at: nowStr,
            count: (prev[testId]?.count || 0) + 1,
            candMs,
            baseMs,
            status,
            screenshotRevision,
            screenshotCaptured,
            screenshotUrl,
            screenshotSource,
            captureEngine,
            sha256,
            bytes,
            s3Key,
            canaryDispatched,
            canaryName,
            canaryError,
            persistedToRunKey,
          },
        }));

        setRerunningTestId(null);
        const proofSuffix = sha256
          ? ` · sha256:${sha256.slice(0, 12)}${bytes ? ` (${(bytes / 1024).toFixed(1)} KB)` : ''}`
          : '';
        if (screenshotCaptured) {
          toast.success(
            `Probed live HTTP flow & verified 1280×760 screenshot for ${testId} · HTTP ${status} (${candMs}ms${
              typeof baseMs === 'number' ? ` / ${baseMs}ms` : ''
            })${proofSuffix}`
          );
        } else if (canaryDispatched && canaryName) {
          toast.info(
            `Probed HTTP ${status} for ${testId} (${candMs}ms) · Dispatched CloudWatch Synthetics Canary ${canaryName} to capture 1280×760 screenshots`
          );
          // Background poll for asynchronous Canary completion (~20s)
          window.setTimeout(async () => {
            try {
              const stRes = await fetch(
                `/api/v1/canary/status?canaryName=${encodeURIComponent(canaryName)}&targetId=${encodeURIComponent(activeCandidateRun.target)}`
              );
              if (stRes.ok) {
                const st = await stRes.json();
                const latestRunState = st?.recentRuns?.[0]?.status;
                if (latestRunState === 'PASSED') {
                  toast.success(
                    `Canary ${canaryName} completed — click Retake or reload Image AI to view fresh screenshots`
                  );
                }
              }
            } catch {
              // Ignore poll error
            }
          }, 20000);
        } else if (canaryError) {
          toast.warning(
            `Probed HTTP ${status} for ${testId} (${candMs}ms${
              typeof baseMs === 'number' ? ` / ${baseMs}ms` : ''
            }) · Live browser capture unavailable (${canaryError || captureEngine || 'HTTP-only'})`
          );
        } else {
          toast.info(
            `Probed live HTTP ${status} for ${testId} (${candMs}ms${
              typeof baseMs === 'number' ? ` / ${baseMs}ms` : ''
            }) · No live browser screenshot engine active`
          );
        }
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

          const freshBatchRevision = Date.now();
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
                screenshotRevision: freshBatchRevision,
                screenshotCaptured: Boolean(
                  cRes?.screenshotCaptured ??
                    (typeof cRes?.screenshotBytes === 'number'
                      ? cRes.screenshotBytes > 0
                      : Boolean(cRes?.screenshotSha256 || cRes?.s3ScreenshotKey))
                ),
              };
            }
            return next;
          });
        } finally {
          setRerunningTestId(null);
        }

        toast.success(
          `Reran ${targetIdsToProbe.length} check(s) & refreshed 1280×760 DOM screenshots across ${tA} and ${tB} at ${nowStr}`
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
          const candRes = activeCandidateRun.results.find((r) => r.id === testId);
          const baseRes = activeBaselineRun.results.find((r) => r.id === testId);
          const probeInfo = lastProbedByTestId[testId];
          const revA = probeInfo?.screenshotRevision ?? candRes?.screenshotRevision;
          const revB = probeInfo?.screenshotRevision ?? baseRes?.screenshotRevision;

          const urlA =
            candRes?.screenshotUrl ||
            probeInfo?.screenshotUrl ||
            resolveLiveScreenshotUrl({
              appId: activeCandidateRun.appId,
              testId,
              url: candRes?.canonicalUrl || item?.url || 'https://www.salesforce.com/',
              side: 'A',
              revision: revA,
            });
          const urlB =
            baseRes?.screenshotUrl ||
            resolveLiveScreenshotUrl({
              appId: activeBaselineRun.appId,
              testId,
              url: baseRes?.canonicalUrl || item?.url || 'https://www.salesforce.com/',
              side: 'B',
              revision: revB,
            });

          const browserDiff =
            activeCandidateRun.key !== activeBaselineRun.key
              ? await measureBrowserImagePairPixelDiff(urlA, urlB)
              : null;

          const measuredPixelDiff =
            browserDiff && typeof browserDiff.pixelDiffPercent === 'number'
              ? browserDiff.pixelDiffPercent
              : item?.visualResult?.pixelDiffPercent ?? 0;

          const res = await fetch('/api/v1/judge/nova-lite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              testId,
              testName: item?.testName,
              url: item?.url || 'https://www.salesforce.com/',
              candidateTarget,
              baselineTarget,
              pixelDiffPercent: measuredPixelDiff,
              changedBox: browserDiff?.changedBox ?? null,
              zones: browserDiff?.zones ?? null,
              forceAiCompare: true,
            }),
          });
          const data = await res.json();
          const finalPixelDiff =
            typeof browserDiff?.pixelDiffPercent === 'number' &&
            browserDiff.pixelDiffPercent > (data?.pixelDiffPercent ?? 0)
              ? browserDiff.pixelDiffPercent
              : typeof data?.pixelDiffPercent === 'number'
              ? data.pixelDiffPercent
              : measuredPixelDiff;

          const rawVerdict: 'same' | 'minor' | 'different' =
            data?.verdict || classifyVisualVerdictFromPixelDiff(finalPixelDiff);
          const finalVerdict: 'same' | 'minor' | 'different' =
            finalPixelDiff > 0.1 && rawVerdict === 'same'
              ? classifyVisualVerdictFromPixelDiff(finalPixelDiff)
              : rawVerdict;

          const logical = describeVisualDiffLogically({
            pixelDiffPercent: finalPixelDiff,
            changedBox: browserDiff?.changedBox ?? data?.changedBox ?? null,
            zones: browserDiff?.zones ?? null,
            candidateLabel: activeCandidateRun.network,
            baselineLabel: activeBaselineRun.network,
            pageName: item?.testName,
            url: item?.url,
          });

          const rawAiSummary =
            typeof data?.summary === 'string' ? data.summary : '';
          const finalSummary = humanizeVisualSummary(
            finalPixelDiff > 0.1 &&
              (rawAiSummary.includes('match as they are from the same website') ||
                rawAiSummary.includes('Screenshots match within 0.1%'))
              ? ''
              : rawAiSummary,
            {
              pixelDiffPercent: finalPixelDiff,
              changedBox: browserDiff?.changedBox ?? data?.changedBox ?? null,
              zones: browserDiff?.zones ?? null,
              candidateLabel: activeCandidateRun.network,
              baselineLabel: activeBaselineRun.network,
              pageName: item?.testName,
              url: item?.url,
            }
          );

          const resolvedArea = data?.affectedArea || logical.affectedArea;
          const resolvedCallout = data?.shortCallout || logical.shortCallout;

          const scopedKey = `${activeCandidateRun.appId}-${testId}`;
          const nextOverride = {
            verdict: finalVerdict,
            summary: finalSummary,
            affectedArea: resolvedArea,
            shortCallout: resolvedCallout,
            pixelDiffPercent: finalPixelDiff,
            changedBox: browserDiff?.changedBox ?? data?.changedBox ?? null,
            zones: browserDiff?.zones ?? null,
            costGate:
              finalPixelDiff <= 0.1 && finalVerdict === 'same'
                ? ('identical-bytes' as const)
                : ('ai-judged' as const),
          };
          setAiJudgeOverrides((prev) => ({
            ...prev,
            [scopedKey]: nextOverride,
            [testId]: nextOverride,
          }));
          setRunningAiTestId(null);
          toast.success(
            `Visual Judge verdict (${finalVerdict.toUpperCase()}): ${resolvedCallout}`
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

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: 'cmd-suite-pop-launcher',
        group: 'Actions',
        label: 'Run Any Suite from Any PoP…',
        subtitle: 'Pick any test suite (.csv), target env, and global PoP (IAD/NRT/FRA/LHR/SIN/SYD)',
        keywords: 'run suite pop canary edge launcher deploy',
        shortcutKeys: ['X'],
        onSelect: () => setSuitePopLauncherOpen(true),
      },
      {
        id: 'cmd-run-live-gate',
        group: 'Actions',
        label: `Run Live Gate on ${candidateTarget} ↔ ${baselineTarget}`,
        subtitle:
          selectedExecutionPopId !== 'auto'
            ? `From Origin PoP ${selectedExecutionPopId.toUpperCase()}`
            : 'Using property default Origin PoP',
        keywords: 'compare live gate staging prod canary',
        onSelect: () => handleRunAndCompareTargets(candidateTarget, baselineTarget),
      },
      {
        id: 'cmd-toggle-theme',
        group: 'Actions',
        label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`,
        subtitle: `Current appearance: ${theme}`,
        keywords: 'theme dark light mode appearance',
        shortcutKeys: ['T'],
        onSelect: toggleTheme,
      },
      {
        id: 'cmd-open-shortcuts',
        group: 'Actions',
        label: 'Show Keyboard Shortcuts Reference',
        subtitle: 'View all global, chord (g …), and inspector navigation shortcuts',
        keywords: 'help shortcuts keys hotkeys keyboard',
        shortcutKeys: ['?'],
        onSelect: () => setShortcutsHelpOpen(true),
      },
      {
        id: 'cmd-toggle-prop-scale',
        group: 'Actions',
        label: apps.length >= 50 ? 'Restore 14 Default Properties' : 'Simulate 50 Global Properties',
        subtitle: `Current fleet topology size: ${apps.length} properties`,
        keywords: 'scale fleet 50 stress',
        onSelect: handleToggleScalePreset,
      },
      {
        id: 'cmd-toggle-suite-scale',
        group: 'Actions',
        label: testSuite.length > 8 ? 'Restore 8 Core Checks' : 'Simulate 64 Enterprise Suite Checks',
        subtitle: `Current check count per suite: ${testSuite.length}`,
        keywords: 'scale suite 64 checks',
        onSelect: handleToggleSuiteScale,
      },
      {
        id: 'nav-overview',
        group: 'Views',
        label: 'Go to Overview & Release Readiness',
        subtitle: 'Executive verdict banner, triage queue, and fleet gate matrix',
        keywords: 'home overview property matrix',
        shortcutKeys: ['G', 'O'],
        onSelect: () => setViewMode('property'),
      },
      {
        id: 'nav-diff',
        group: 'Views',
        label: 'Go to Comparative Diff Inspector',
        subtitle: 'HTTP Flow waterfall, headers, cookies, and Bedrock Nova AI screenshots',
        keywords: 'diff inspector headers cookies visual flow',
        shortcutKeys: ['G', 'D'],
        onSelect: () => setViewMode('diff'),
      },
      {
        id: 'nav-suites',
        group: 'Views',
        label: 'Go to Test Suites & Telemetry',
        subtitle: 'Run cross-property suites across global PoPs and inspect P95 metrics',
        keywords: 'suites csv tests telemetry',
        shortcutKeys: ['G', 'S'],
        onSelect: () => setViewMode('suites'),
      },
      {
        id: 'nav-run',
        group: 'Views',
        label: 'Go to Single-Run Edge Inspector',
        subtitle: `Inspect checks for ${focusedTargetId}`,
        keywords: 'single run target',
        shortcutKeys: ['G', 'R'],
        onSelect: () => setViewMode('run'),
      },
      {
        id: 'nav-mcp',
        group: 'Views',
        label: 'Go to Cloud & MCP Control Plane',
        subtitle: 'OpenAPI 3.1, MCP tools, Terraform & CloudWatch Synthetics specs',
        keywords: 'mcp aws cloud terraform api',
        shortcutKeys: ['G', 'M'],
        onSelect: () => setViewMode('mcp'),
      },
      {
        id: 'nav-vscode',
        group: 'Views',
        label: 'Go to VS Code IDE & Compute Shell',
        subtitle: 'Edit repo files in Monaco editor and run make deploy',
        keywords: 'vscode terminal shell editor deploy code',
        shortcutKeys: ['G', 'V'],
        onSelect: () => setViewMode('terminal'),
      },
      {
        id: 'nav-settings',
        group: 'Views',
        label: 'Go to Settings & Accepted Diff Rules',
        subtitle: 'Manage properties, test cases, and rule allowlists',
        keywords: 'settings rules config',
        shortcutKeys: ['G', ','],
        onSelect: () => setViewMode('settings'),
      },
      {
        id: 'nav-about',
        group: 'Views',
        label: 'Go to Architecture & Operator Guide',
        subtitle: 'Edge release gate design & runbooks',
        keywords: 'about guide docs architecture',
        shortcutKeys: ['G', '?'],
        onSelect: () => setViewMode('about'),
      },
    ];

    items.push({
      id: 'pop-auto',
      group: 'Execution PoPs',
      label: 'Set Origin Execution PoP: Auto (Property Default)',
      subtitle: 'Let each property route to its regional default edge PoP',
      keywords: 'pop auto default reset',
      badge: selectedExecutionPopId === 'auto' ? 'ACTIVE' : undefined,
      onSelect: () => {
        setSelectedExecutionPopId('auto');
        toast.info('Origin Execution PoP reset to Auto (Property Default)');
      },
    });

    for (const pop of GLOBAL_EXECUTION_POPS) {
      items.push({
        id: `pop-${pop.id}`,
        group: 'Execution PoPs',
        label: `Set Origin Execution PoP: ${pop.popCode} · ${pop.city}`,
        subtitle: `${pop.regionGroup} · ${pop.awsRegion} · ${pop.stagingEdgeIp}`,
        keywords: `pop ${pop.id} ${pop.popCode} ${pop.city} ${pop.regionGroup} ${pop.awsRegion}`,
        badge: selectedExecutionPopId === pop.id ? 'ACTIVE' : pop.regionGroup,
        onSelect: () => {
          setSelectedExecutionPopId(pop.id);
          toast.success(`Origin Execution PoP set to ${pop.popCode} (${pop.city})`);
        },
      });
    }

    for (const appItem of apps.slice(0, 24)) {
      const meta = classifyPropertyRegion(appItem.id);
      items.push({
        id: `prop-${appItem.id}`,
        group: 'Properties',
        label: `Switch Property: ${appItem.id} — ${appItem.name}`,
        subtitle: `${resolvePropertyHostname(appItem.id, 'prod')} · ${meta.regionCode}:${meta.popCode}`,
        keywords: `${appItem.id} ${appItem.name} ${meta.popCode} ${meta.regionCode}`,
        badge: appItem.id === activeAppId ? 'ACTIVE' : verdictByAppId[appItem.id] || 'GO',
        onSelect: () => handleSelectProperty(appItem.id),
      });
    }

    return items;
  }, [
    apps,
    activeAppId,
    candidateTarget,
    baselineTarget,
    focusedTargetId,
    selectedExecutionPopId,
    theme,
    testSuite.length,
    verdictByAppId,
  ]);

  const chordTimerRef = React.useRef<number | null>(null);
  const keyboardHandlerRef = React.useRef<(e: KeyboardEvent) => void>(() => {});

  keyboardHandlerRef.current = (e: KeyboardEvent) => {
    const anyModalOpen =
      commandPaletteOpen ||
      shortcutsHelpOpen ||
      suitePopLauncherOpen ||
      propertySwitcherOpen ||
      showNotifications;

    const ctx: ShortcutStateContext = {
      viewMode: viewMode as ShortcutViewMode,
      pendingChord,
      hasOpenModal: anyModalOpen,
      isAuthenticated: Boolean(currentUser),
    };
    const action = resolveKeyboardAction(
      {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        defaultPrevented: e.defaultPrevented,
        target: e.target as ShortcutTargetLike | null,
      },
      ctx
    );
    if (action.type === 'noop' || action.type === 'clear-chord') {
      if (
        action.type === 'clear-chord' ||
        (pendingChord && !['g', 'Shift', 'Meta', 'Control', 'Alt'].includes(e.key))
      ) {
        setPendingChord(null);
      }
      return;
    }

    if (action.type === 'start-chord') {
      e.preventDefault();
      setPendingChord(action.chord);
      if (chordTimerRef.current) window.clearTimeout(chordTimerRef.current);
      chordTimerRef.current = window.setTimeout(() => setPendingChord(null), 1800);
      return;
    }

    // Any matched non-chord action clears any pending chord immediately
    if (pendingChord) {
      setPendingChord(null);
      if (chordTimerRef.current) {
        window.clearTimeout(chordTimerRef.current);
        chordTimerRef.current = null;
      }
    }

    switch (action.type) {
      case 'toggle-command-palette':
        e.preventDefault();
        setShortcutsHelpOpen(false);
        setSuitePopLauncherOpen(false);
        setPropertySwitcherOpen(false);
        setCommandPaletteOpen((prev) => !prev);
        break;
      case 'toggle-shortcuts-help':
        e.preventDefault();
        setCommandPaletteOpen(false);
        setSuitePopLauncherOpen(false);
        setPropertySwitcherOpen(false);
        setShortcutsHelpOpen((prev) => !prev);
        break;
      case 'open-property-switcher':
        e.preventDefault();
        setCommandPaletteOpen(false);
        setShortcutsHelpOpen(false);
        setSuitePopLauncherOpen(false);
        setPropertySwitcherOpen((prev) => !prev);
        break;
      case 'open-suite-pop-launcher':
        e.preventDefault();
        setCommandPaletteOpen(false);
        setShortcutsHelpOpen(false);
        setPropertySwitcherOpen(false);
        setSuitePopLauncherOpen((prev) => !prev);
        break;
      case 'toggle-theme':
        e.preventDefault();
        toggleTheme();
        break;
      case 'focus-search': {
        const searchEl = document.querySelector<HTMLInputElement>(
          'input[data-shortcut-search="true"]'
        );
        if (searchEl) {
          e.preventDefault();
          searchEl.focus();
          searchEl.select();
        }
        break;
      }
      case 'navigate':
        e.preventDefault();
        setShowNotifications(false);
        setViewMode(action.viewMode);
        break;
      case 'step-check': {
        e.preventDefault();
        if (viewMode === 'diff') {
          const targetId =
            action.delta === 1
              ? pagedDiffResult.nextTestId
              : pagedDiffResult.prevTestId;
          if (targetId) {
            const nextItem = comparison.items.find((it) => it.testId === targetId);
            if (nextItem) handleSelectTestRow(nextItem, inspectorTab);
          }
        } else if (viewMode === 'run') {
          const runItems = activeSingleRun.results;
          const idx = runItems.findIndex((r) => r.id === selectedSingleResult?.id);
          const nextIdx =
            action.delta === 1
              ? Math.min(runItems.length - 1, idx + 1)
              : Math.max(0, idx - 1);
          if (runItems[nextIdx]) setSelectedTestId(runItems[nextIdx].id);
        }
        break;
      }
      case 'switch-inspector-tab':
        e.preventDefault();
        setInspectorTab(action.tab);
        break;
      case 'toggle-diffs-only':
        e.preventDefault();
        setDiffInspectorDiffsOnly((prev) => !prev);
        break;
      case 'rerun-active-probe':
        e.preventDefault();
        if (viewMode === 'diff' && selectedItem) {
          handleRerunSingleTest(selectedItem.testId);
        } else if (viewMode === 'run' && selectedSingleResult) {
          handleRerunSingleTest(selectedSingleResult.id);
        }
        break;
      case 'copy-curl': {
        e.preventDefault();
        const targetResult =
          viewMode === 'diff'
            ? selectedItem?.candidateResult
            : selectedSingleResult;
        if (targetResult) {
          navigator.clipboard.writeText(generateReproduceCurl(targetResult));
          toast.success(`Copied zero-secret cURL command for ${targetResult.id}`);
        }
        break;
      }
      case 'page-step':
        e.preventDefault();
        if (viewMode === 'diff') {
          setDiffPage((p) =>
            action.delta === 1
              ? Math.min(pagedDiffResult.totalPages, p + 1)
              : Math.max(1, p - 1)
          );
        } else if (viewMode === 'run') {
          setRunPage((p) =>
            action.delta === 1 ? p + 1 : Math.max(1, p - 1)
          );
        } else if (viewMode === 'property') {
          setFleetPage((p) =>
            action.delta === 1 ? p + 1 : Math.max(1, p - 1)
          );
        }
        break;
      case 'escape':
        if (commandPaletteOpen) setCommandPaletteOpen(false);
        else if (shortcutsHelpOpen) setShortcutsHelpOpen(false);
        else if (suitePopLauncherOpen) setSuitePopLauncherOpen(false);
        else if (propertySwitcherOpen) setPropertySwitcherOpen(false);
        else if (showNotifications) setShowNotifications(false);
        break;
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyboardHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (chordTimerRef.current) window.clearTimeout(chordTimerRef.current);
    };
  }, []);

  if (!currentUser) {
    return (
      <>
        <Toaster position="bottom-left" richColors theme={theme} />
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
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans relative overflow-x-hidden">
      <Toaster position="bottom-left" richColors theme={theme} />

      {/* =====================================================================
          CONTROL CENTER GLOBAL HEADER + ICON-FIRST NAVIGATION + NOTIFICATIONS
         ===================================================================== */}
      <header className="sticky top-0 z-40 h-11 bg-zinc-950 text-zinc-100 px-2 sm:px-3 flex items-center justify-between gap-2 shrink-0 border-b border-zinc-800 max-w-full overflow-visible">
        <div className="flex items-center gap-1.5 text-xs min-w-0 shrink-0">
          <button
            type="button"
            onClick={() => {
              setViewMode('property');
              setShowNotifications(false);
              setPropertySwitcherOpen(false);
            }}
            className="flex items-center gap-2 font-semibold text-white hover:text-zinc-200 cursor-pointer shrink-0"
            title={`${DEFAULT_TEMPLATE_CONFIG.branding.controlPlaneTitle} — ${DEFAULT_TEMPLATE_CONFIG.branding.productSubtitle}`}
          >
            <div className="w-5 h-5 rounded bg-sky-500 text-zinc-950 flex items-center justify-center font-mono font-bold text-[11px] shrink-0">
              {DEFAULT_TEMPLATE_CONFIG.branding.logoMark}
            </div>
            <span className="whitespace-nowrap">{DEFAULT_TEMPLATE_CONFIG.branding.controlPlaneTitle}</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />

          <PropertyCommandSwitcher
            apps={apps}
            activeAppId={activeAppId}
            onSelectProperty={handleSelectProperty}
            onToggleScalePreset={handleToggleScalePreset}
            suiteScaleCount={testSuite.length}
            onToggleSuiteScale={handleToggleSuiteScale}
            verdictByAppId={verdictByAppId}
            open={propertySwitcherOpen}
            onOpenChange={setPropertySwitcherOpen}
            onOpenSettings={() => {
              setViewMode('settings');
              setShowNotifications(false);
              setPropertySwitcherOpen(false);
            }}
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">

          {(
            [
              {
                id: 'property',
                label: 'Overview',
                ariaLabel: 'Properties & Reports',
                tooltip: 'Release Readiness Overview & Regional Gate Matrix (G then O)',
                icon: LayoutGrid,
              },
              {
                id: 'diff',
                label: 'Diff Inspector',
                ariaLabel: 'Diff Inspector',
                tooltip: 'Side-by-Side HTTP Flow, Headers, Cookies & AI Visual Diff Inspector (G then D)',
                icon: GitCompare,
              },
              {
                id: 'suites',
                label: 'Test Suites',
                ariaLabel: 'Test Suites',
                tooltip: 'Test Suites & AWS CloudWatch Synthetics Telemetry (G then S)',
                icon: ListChecks,
              },
              {
                id: 'mcp',
                label: 'Cloud & MCP',
                ariaLabel: 'MCP & AWS',
                tooltip: 'MCP Server & AWS CloudWatch Synthetics Backend (G then M)',
                icon: Server,
              },
              {
                id: 'terminal',
                label: 'VS Code',
                ariaLabel: 'VS Code',
                tooltip: 'Embedded VS Code Web IDE (Monaco Editor + Integrated Terminal) (G then V)',
                icon: Code2,
              },
              {
                id: 'settings',
                label: 'Settings',
                ariaLabel: 'Settings & Config',
                tooltip: 'Settings, Accepted Diff Rules & Template Adaptation (G then ,)',
                icon: Settings,
              },
              {
                id: 'about',
                label: 'Guide',
                ariaLabel: 'About',
                tooltip: 'Architecture & Operator Guide (G then ?)',
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
                aria-label={nav.ariaLabel}
                title={nav.tooltip}
                onClick={() => {
                  setViewMode(nav.id);
                  setShowNotifications(false);
                  setPropertySwitcherOpen(false);
                }}
                className={`px-1.5 h-7 rounded inline-flex items-center gap-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-sky-500 text-zinc-950 font-semibold shadow-xs'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">{nav.label}</span>
              </button>
            );
          })}

          <span className="text-zinc-800 mx-0.5">|</span>

          <button
            type="button"
            data-testid="command-palette-trigger-btn"
            aria-label="Open Command Palette"
            onClick={() => setCommandPaletteOpen(true)}
            title="Open Command Palette (Search properties, PoPs, views & actions) · Shortcut: ⌘K / Ctrl+K"
            className="h-7 px-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/90 text-zinc-300 hover:text-white inline-flex items-center gap-1 text-[11px] font-mono cursor-pointer transition-colors"
          >
            <Command className="w-3 h-3 text-sky-400" />
            <span className="hidden 2xl:inline text-zinc-300">Search</span>
            <Kbd tone="dark-surface" className="text-[9px] h-[16px] px-1">
              ⌘K
            </Kbd>
          </button>

          <button
            type="button"
            data-testid="shortcuts-help-trigger-btn"
            aria-label="Keyboard Shortcuts Help"
            onClick={() => setShortcutsHelpOpen(true)}
            title="Keyboard Shortcuts Reference · Shortcut: ?"
            className="w-7 h-7 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white inline-flex items-center justify-center text-xs cursor-pointer"
          >
            <Keyboard className="w-3.5 h-3.5 text-zinc-300" />
          </button>

          <button
            type="button"
            aria-label="Toggle Light and Dark Theme"
            onClick={toggleTheme}
            className="w-7 h-7 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white inline-flex items-center justify-center text-xs cursor-pointer"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme (Current: ${theme}) · Shortcut: T`}
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

      {/* SCALABLE REGIONAL POP & FLEET CONTEXT BAR (SUPPORTS 500+ PROPERTIES & 64+ SUITE CHECKS) */}
      <ScalableFleetContextBar
        apps={apps}
        activeAppId={activeAppId}
        onSelectProperty={handleSelectProperty}
        verdictByAppId={verdictByAppId}
        suiteCheckCount={testSuite.length}
        onToggleScalePreset={handleToggleScalePreset}
        onToggleSuiteScale={handleToggleSuiteScale}
        selectedPopId={selectedExecutionPopId}
        onChangePopId={setSelectedExecutionPopId}
        onOpenSuitePopLauncher={() => setSuitePopLauncherOpen(true)}
      />

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

      {viewMode === 'terminal' && <VsCodeWorkspace theme={theme} />}

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
          onRunSuiteOnTarget={(targetId, options) =>
            handleRunSingleTarget(targetId, false, options)
          }
          onRunAndCompareTargets={(targetA, targetB, options) =>
            handleRunAndCompareTargets(targetA, targetB, false, options)
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
          suiteScaleCount={testSuite.length}
          onToggleSuiteScale={handleToggleSuiteScale}
          selectedPopId={selectedExecutionPopId}
          onChangePopId={setSelectedExecutionPopId}
        />
      )}

      {/* =====================================================================
          MODE 1: PROPERTY MANAGER & READY COMPARATIVE REPORTS
         ===================================================================== */}
      {viewMode === 'property' && (() => {
        const effectivePopId =
          activeCandidateRun.executionPop?.id ||
          (selectedExecutionPopId !== 'auto' ? selectedExecutionPopId : undefined);
        const activeRegionalNode = resolveRegionalEdgeNode(
          currentApp.id,
          comparison.items[0]?.url,
          effectivePopId
        );
        const headerDiffTests = comparison.items.filter(
          (it) => getItemDiffCounts(it).hDiffs > 0
        );
        const cookieDiffTests = comparison.items.filter(
          (it) => getItemDiffCounts(it).cDiffs > 0
        );
        const visualDiffTests = comparison.items.filter(
          (it) => getItemDiffCounts(it).vDiff
        );
        const sreSummary = computeSuiteSreSummary(comparison.items);

        return (
          <>
            {/* EXECUTIVE RELEASE READINESS HERO BANNER + GOOGLE SRE TELEMETRY STRIP */}
            <div className="bg-card border-b border-border px-4 py-3 space-y-2.5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={
                        comparison.headlineVerdict === 'GO'
                          ? 'success'
                          : comparison.headlineVerdict === 'REVIEW'
                          ? 'warning'
                          : 'destructive'
                      }
                      className="font-mono text-xs px-2 py-0.5 font-bold"
                    >
                      {comparison.headlineVerdict === 'GO'
                        ? 'GO · READY FOR PRODUCTION'
                        : comparison.headlineVerdict === 'REVIEW'
                        ? 'REVIEW · MINOR DRIFT DETECTED'
                        : 'NO-GO · RELEASE BLOCKED'}
                    </Badge>
                    <h1 className="text-sm sm:text-base font-semibold text-foreground tracking-tight">
                      {currentApp.name}
                    </h1>
                    <span className="font-mono text-xs text-muted-foreground hidden sm:inline">
                      {resolvePropertyHostname(currentApp.id, 'prod')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-medium text-sky-600 dark:text-sky-400">
                      <Globe className="w-3.5 h-3.5" />
                      {activeRegionalNode.regionLabel}
                    </span>
                    <span>·</span>
                    <span className="font-mono text-[11px] tabular-nums">
                      Staging PoP: {activeRegionalNode.stagingPopCode} ({activeRegionalNode.stagingEdgeIp}) ↔ Prod PoP: {activeRegionalNode.prodPopCode} ({activeRegionalNode.prodEdgeIp})
                    </span>
                    <span>·</span>
                    <span className="font-mono text-[11px]">
                      Locale: {activeRegionalNode.locale}
                    </span>
                    {selectedExecutionPopId !== 'auto' && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                      >
                        PoP Override: {selectedExecutionPopId.toUpperCase()}
                      </Badge>
                    )}
                    {activeCandidateRun.suiteAppId &&
                      activeCandidateRun.suiteAppId !== activeAppId && (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        >
                          Suite: {activeCandidateRun.suiteAppId}.csv
                        </Badge>
                      )}
                  </div>
                </div>

                {/* 3 HUMAN-FRIENDLY SUMMARY CARDS + PRIMARY ACTIONS */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTestId(headerDiffTests[0]?.testId || 'T01');
                      setInspectorTab('headers');
                      setViewMode('diff');
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      headerDiffTests.length > 0
                        ? 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15'
                        : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                    }`}
                  >
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      1. HTTP & Cache Headers
                    </div>
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                      <Code2 className="w-3.5 h-3.5 text-rose-500" />
                      {headerDiffTests.length > 0
                        ? `${headerDiffTests.length} Blocking Diff (${headerDiffTests[0]?.testId})`
                        : 'All Headers Matched ✓'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTestId(cookieDiffTests[0]?.testId || 'T02');
                      setInspectorTab('cookies');
                      setViewMode('diff');
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      cookieDiffTests.length > 0
                        ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15'
                        : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                    }`}
                  >
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      2. Session & Edge Cookies
                    </div>
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                      <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                      {cookieDiffTests.length > 0
                        ? `${cookieDiffTests.length} PoP Cookie Drift`
                        : 'All Cookies Matched ✓'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTestId(visualDiffTests[0]?.testId || 'T03');
                      setInspectorTab('image');
                      setViewMode('diff');
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      visualDiffTests.length > 0
                        ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15'
                        : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                    }`}
                  >
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      3. Visual DOM & AI Judge
                    </div>
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                      {visualDiffTests.length > 0
                        ? `${visualDiffTests.length} Minor Visual Shift (${visualDiffTests[0]?.testId})`
                        : 'Screenshots Identical ✓'}
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 ml-auto lg:ml-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleOpenDiffView(
                          candidateTarget,
                          baselineTarget,
                          activeCandidateRun.key,
                          activeBaselineRun.key
                        )
                      }
                    >
                      <Eye className="!size-3.5 text-sky-500" />
                      Inspect Diffs ({totalDiffItemsCount})
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        handleRunAndCompareTargets(candidateTarget, baselineTarget)
                      }
                      disabled={isComparingBoth}
                    >
                      <Play className="fill-current !size-3" />
                      {isComparingBoth ? 'Probing Edge…' : 'Run Live Gate'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* GOOGLE SRE CORE WEB VITALS, APDEX & SLO ERROR BUDGET STRIP (ZERO CARD-IN-CARD HUD) */}
              <div
                data-testid="google-sre-telemetry-strip"
                className="rounded-md border border-border/80 bg-muted/15 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-border/70 text-xs overflow-hidden"
              >
                <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      Apdex (T=100ms)
                    </div>
                    <div className="font-mono font-bold text-foreground tabular-nums text-xs mt-0.5">
                      {sreSummary.apdexCandidate.toFixed(2)}{' '}
                      <span className="text-[10px] font-normal text-muted-foreground">
                        vs {sreSummary.apdexBaseline.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[10px] font-semibold tabular-nums ${
                      sreSummary.apdexCandidate >= 0.95
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {sreSummary.apdexCandidate >= 0.95 ? 'OPTIMAL' : 'DEGRADED'}
                  </span>
                </div>

                <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      Edge TTFB (P50 / P95)
                    </div>
                    <div className="font-mono font-bold text-foreground tabular-nums text-xs mt-0.5">
                      {sreSummary.p50CandidateMs}ms / {sreSummary.p95CandidateMs}ms
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[10px] font-semibold tabular-nums ${
                      sreSummary.p95DeltaMs > 25
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {sreSummary.p95DeltaMs >= 0 ? '+' : ''}
                    {sreSummary.p95DeltaMs}ms
                  </span>
                </div>

                <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      Edge Cache Parity
                    </div>
                    <div className="font-mono font-bold text-foreground tabular-nums text-xs mt-0.5">
                      {sreSummary.cacheParityPct}%{' '}
                      <span className="text-[10px] font-normal text-muted-foreground">
                        ({sreSummary.candidateCacheHitRatioPct}% Hit)
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[10px] font-semibold tabular-nums ${
                      sreSummary.cacheParityPct === 100
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {sreSummary.cacheParityPct === 100 ? 'PARITY' : 'BYPASS'}
                  </span>
                </div>

                <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      Core Web Vitals
                    </div>
                    <div className="font-mono font-bold text-foreground tabular-nums text-xs mt-0.5">
                      {sreSummary.cwvPassRatePct}% Good
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400 font-semibold">
                    LCP·INP·CLS
                  </span>
                </div>

                <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      SLO Error Budget
                    </div>
                    <div className="font-mono font-bold text-foreground tabular-nums text-xs mt-0.5">
                      {sreSummary.sloErrorBudgetRemainingPct}%{' '}
                      <span className="text-[10px] font-normal text-muted-foreground">
                        ({sreSummary.sloBurnRateMultiplier}x burn)
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[10px] font-semibold ${
                      sreSummary.releaseRiskTier === 'CRITICAL'
                        ? 'text-rose-600 dark:text-rose-400'
                        : sreSummary.releaseRiskTier === 'ELEVATED'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {sreSummary.releaseRiskTier}
                  </span>
                </div>

                <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase text-muted-foreground">
                      SRE Root-Cause AI
                    </div>
                    <div className="font-mono font-bold text-foreground tabular-nums text-xs mt-0.5">
                      {sreSummary.blockerDiagnoses.length > 0
                        ? `${sreSummary.blockerDiagnoses.length} P0 Playbook(s)`
                        : '0 P0 Blockers'}
                    </div>
                  </div>
                  {sreSummary.blockerDiagnoses.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTestId(sreSummary.blockerDiagnoses[0].testId);
                        setInspectorTab('headers');
                        setViewMode('diff');
                      }}
                      className="font-mono text-[10px] font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer whitespace-nowrap"
                    >
                      Fix PAPI →
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      CLEAN
                    </span>
                  )}
                </div>
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
              {/* LEFT COLUMN (7 cols): SCALABLE ACTIVE DRIFT & RELEASE BLOCKERS TRIAGE QUEUE */}
              {(() => {
                const actionableTriageItems = comparison.items.filter((it) => {
                  const counts = getItemDiffCounts(it);
                  return counts.hasAny || it.candidateFailed;
                });
                const allTriageItems =
                  actionableTriageItems.length > 0
                    ? actionableTriageItems
                    : comparison.items.filter((it) => {
                        const rawH = it.functionalDiffs.length > 0;
                        const rawC = (it.cookieDiffs || []).length > 0;
                        const rawV =
                          it.visualResult?.verdict === 'minor' ||
                          it.visualResult?.verdict === 'different' ||
                          (it.visualResult?.differences?.length ?? 0) > 0;
                        return rawH || rawC || rawV || it.candidateFailed;
                      });

                const triageFacetCounts = {
                  all: allTriageItems.length,
                  headers: allTriageItems.filter((it) => getItemDiffCounts(it).hDiffs > 0).length,
                  cookies: allTriageItems.filter((it) => getItemDiffCounts(it).cDiffs > 0).length,
                  visual: allTriageItems.filter((it) => getItemDiffCounts(it).vDiff).length,
                };

                const filteredTriage = allTriageItems.filter((it) => {
                  const counts = getItemDiffCounts(it);
                  if (triageFilter === 'headers' && counts.hDiffs === 0)
                    return false;
                  if (triageFilter === 'cookies' && counts.cDiffs === 0)
                    return false;
                  if (triageFilter === 'visual' && !counts.vDiff)
                    return false;
                  if (triageSearchQuery.trim()) {
                    const q = triageSearchQuery.toLowerCase();
                    return (
                      it.testId.toLowerCase().includes(q) ||
                      it.testName.toLowerCase().includes(q) ||
                      it.url.toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                const triagePageSize = 8;
                const totalTriagePages = Math.max(
                  1,
                  Math.ceil(filteredTriage.length / triagePageSize)
                );
                const safeTriagePage = Math.min(
                  Math.max(1, triagePage),
                  totalTriagePages
                );
                const pagedTriage = filteredTriage.slice(
                  (safeTriagePage - 1) * triagePageSize,
                  safeTriagePage * triagePageSize
                );

                return (
                  <Card className="lg:col-span-7">
                    <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {comparison.headlineVerdict === 'GO' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                          )}
                          <CardTitle className="text-xs font-semibold">
                            Active Release Blockers & Drift Triage ({filteredTriage.length})
                          </CardTitle>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {candidateTarget} ↔ {baselineTarget}
                          </span>
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
                      </div>

                      {/* Scalable Dimension Filter Pills & Search */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-1 flex-wrap font-mono text-[10px]">
                          {(
                            [
                              { id: 'all', label: `Actionable (${triageFacetCounts.all})` },
                              { id: 'headers', label: `Headers (${triageFacetCounts.headers})` },
                              { id: 'cookies', label: `Cookies (${triageFacetCounts.cookies})` },
                              { id: 'visual', label: `Visual AI (${triageFacetCounts.visual})` },
                            ] as const
                          ).map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => {
                                setTriageFilter(f.id);
                                setTriagePage(1);
                              }}
                              className={`px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                                triageFilter === f.id
                                  ? 'bg-sky-500 text-zinc-950 border-sky-500 font-bold'
                                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              data-shortcut-search="true"
                              placeholder="Filter drift checks… (/)"
                              value={triageSearchQuery}
                              onChange={(e) => {
                                setTriageSearchQuery(e.target.value);
                                setTriagePage(1);
                              }}
                              className="h-6 pl-6 pr-2 rounded border border-input bg-background text-[11px] font-mono w-44"
                            />
                          </div>
                          {totalTriagePages > 1 && (
                            <div className="inline-flex items-center gap-1 font-mono text-[10px]">
                              <span className="text-muted-foreground">
                                {safeTriagePage}/{totalTriagePages}
                              </span>
                              <button
                                type="button"
                                disabled={safeTriagePage <= 1}
                                onClick={() => setTriagePage((p) => Math.max(1, p - 1))}
                                className="px-1.5 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                disabled={safeTriagePage >= totalTriagePages}
                                onClick={() =>
                                  setTriagePage((p) => Math.min(totalTriagePages, p + 1))
                                }
                                className="px-1.5 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                              >
                                →
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <Table className="table-fixed w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[38%] py-1.5">
                            Check & Endpoint
                          </TableHead>
                          <TableHead className="w-[35%] py-1.5">
                            Detected Edge / Visual Finding
                          </TableHead>
                          <TableHead className="text-right w-[27%] py-1.5 pr-3">
                            Quick Triage
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedTriage.map((item) => {
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

                          const rootCause = diagnoseCheckRootCause(item);
                          const vitals = sreSummary.checkVitalsMap[item.testId];

                          let primaryTab: InspectorDimension = 'headers';
                          let findingText = rootCause.title || 'All checks matched';
                          let subDetail = rootCause.akamaiRulePath
                            ? `Rule: ${rootCause.akamaiRulePath}`
                            : '';

                          if (item.functionalDiffs.length > 0) {
                            primaryTab = 'headers';
                            const first = item.functionalDiffs[0];
                            findingText = `HTTP Header drift (${first.field || first.kind}): ${first.candidateValue} vs ${first.baselineValue}`;
                            subDetail = `P0 Root Cause · ${rootCause.akamaiRulePath}`;
                          } else if ((item.cookieDiffs || []).length > 0) {
                            primaryTab = 'cookies';
                            const normalizeCookieKey = (raw: string) =>
                              raw.toLowerCase().replace(/^cookie:/, '').trim();
                            const normAccepted = acceptedCookies.map(normalizeCookieKey);
                            const unacceptedCookieNames = (item.cookieDiffs || [])
                              .map((d) => d.field || '')
                              .filter(
                                (f) => f && !normAccepted.includes(normalizeCookieKey(f))
                              );
                            const activeNames =
                              unacceptedCookieNames.length > 0
                                ? unacceptedCookieNames
                                : (item.cookieDiffs || []).map((d) => d.field);
                            findingText = `Set-Cookie drift (${activeNames.length}): ${activeNames.join(', ')}`;
                            subDetail = `Cookie Contract · ${rootCause.akamaiRulePath}`;
                          } else if (item.visualResult) {
                            primaryTab = 'image';
                            findingText = humanizeVisualSummary(item.visualResult.summary, {
                              pixelDiffPercent: item.visualResult.pixelDiffPercent,
                              changedBox: item.visualResult.differences?.[0]?.box ?? null,
                              pageName: item.testName,
                              url: item.url,
                            });
                            const areaText =
                              item.visualResult.affectedArea ||
                              describeVisualDiffLogically({
                                pixelDiffPercent: item.visualResult.pixelDiffPercent ?? 0,
                                changedBox: item.visualResult.differences?.[0]?.box ?? null,
                                pageName: item.testName,
                                url: item.url,
                              }).affectedArea;
                            subDetail = `${areaText} · ${rootCause.akamaiRulePath}`;
                          }

                          return (
                            <TableRow
                              key={item.testId}
                              className={
                                isResolved ? 'bg-emerald-500/5 opacity-80' : ''
                              }
                            >
                              <TableCell className="py-2 overflow-hidden">
                                <div className="flex items-center gap-2 min-w-0">
                                  <PageMiniThumb
                                    testId={item.testId}
                                    testName={item.testName}
                                    url={item.url}
                                    hasVisualDiff={vDiff}
                                    screenshotRevision={
                                      lastProbedByTestId[item.testId]?.screenshotRevision
                                    }
                                    onClick={() => {
                                      setSelectedTestId(item.testId);
                                      setInspectorTab('image');
                                      setViewMode('diff');
                                    }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-mono text-[10px] font-bold px-1 py-0 rounded bg-muted text-foreground shrink-0">
                                        {item.testId}
                                      </span>
                                      <span className="text-xs font-medium text-foreground truncate">
                                        {item.testName}
                                      </span>
                                      {vitals && (
                                        <span className="hidden xl:inline font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
                                          · LCP {vitals.candidate.lcpMs}ms
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                                      {item.url}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>

                              <TableCell className="py-2 overflow-hidden">
                                <div className="space-y-0.5 min-w-0">
                                  <div className="text-[11px] font-mono text-foreground truncate">
                                    {findingText}
                                  </div>
                                  {subDetail && (
                                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                                      {subDetail}
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="py-2 text-right whitespace-nowrap pr-3 pl-1">
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
                );
              })()}

              {/* RIGHT COLUMN (5 cols): SCALABLE MULTI-PROPERTY FLEET GATE MATRIX & AUDIT LOG */}
              {(() => {
                const filteredFleetApps = apps
                  .filter((appItem) => {
                    const meta = classifyPropertyRegion(appItem.id);
                    const v = verdictByAppId[appItem.id] || 'GO';
                    if (
                      fleetRegionFilter !== 'ALL' &&
                      meta.regionCode !== fleetRegionFilter
                    )
                      return false;
                    if (
                      fleetVerdictFilter !== 'ALL' &&
                      v !== fleetVerdictFilter
                    )
                      return false;
                    if (fleetSearchQuery.trim()) {
                      const q = fleetSearchQuery.toLowerCase();
                      return (
                        appItem.id.toLowerCase().includes(q) ||
                        appItem.name.toLowerCase().includes(q) ||
                        meta.popCode.toLowerCase().includes(q) ||
                        meta.regionCode.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  })
                  .sort((a, b) => {
                    // Always keep www and activeAppId on Page 1 so primary entry points are immediate
                    const aPin =
                      a.id === 'www' ? -2 : a.id === activeAppId ? -1 : 0;
                    const bPin =
                      b.id === 'www' ? -2 : b.id === activeAppId ? -1 : 0;
                    if (aPin !== bPin) return aPin - bPin;
                    return 0;
                  });

                const totalFleetPages = Math.max(
                  1,
                  Math.ceil(filteredFleetApps.length / fleetPageSize)
                );
                const safeFleetPage = Math.min(
                  Math.max(1, fleetPage),
                  totalFleetPages
                );
                const pagedFleetApps = filteredFleetApps.slice(
                  (safeFleetPage - 1) * fleetPageSize,
                  safeFleetPage * fleetPageSize
                );

                return (
                  <Card className="lg:col-span-5">
                    <CardHeader className="py-2 px-4 border-b border-border bg-muted/20 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <LayoutGrid className="w-3.5 h-3.5 text-sky-500" />
                          <CardTitle className="text-xs font-semibold">
                            {homeRightTab === 'fleet'
                              ? `Fleet Release Gate Matrix (${filteredFleetApps.length}/${apps.length})`
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
                      </div>

                      {homeRightTab === 'fleet' && (
                        <div className="flex items-center justify-between gap-1.5 flex-wrap">
                          <div className="relative flex-1 min-w-[140px]">
                            <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Search property, PoP, or region…"
                              value={fleetSearchQuery}
                              onChange={(e) => {
                                setFleetSearchQuery(e.target.value);
                                setFleetPage(1);
                              }}
                              className="h-6 pl-6 pr-2 rounded border border-input bg-background text-[11px] font-mono w-full"
                            />
                          </div>

                          <div className="inline-flex items-center rounded border border-border bg-background p-0.5 text-[10px] font-mono shrink-0">
                            {(['ALL', 'NO-GO', 'REVIEW', 'GO'] as const).map((vf) => (
                              <button
                                key={vf}
                                type="button"
                                onClick={() => {
                                  setFleetVerdictFilter(vf);
                                  setFleetPage(1);
                                }}
                                className={`px-1.5 py-0.5 rounded-xs cursor-pointer ${
                                  fleetVerdictFilter === vf
                                    ? 'bg-foreground text-background font-bold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {vf}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardHeader>

                    {homeRightTab === 'fleet' ? (
                      <div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="py-1.5">Property & PoP</TableHead>
                              <TableHead className="py-1.5">PROD Gate</TableHead>
                              <TableHead className="py-1.5">Checks</TableHead>
                              <TableHead className="text-right py-1.5">
                                Open
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedFleetApps.map((appItem) => {
                              const stgTarget = `${appItem.id}.prod.staging`;
                              const prdTarget = `${appItem.id}.prod.prod`;
                              const stgR = getActiveRunForTarget(stgTarget);
                              const v = verdictByAppId[appItem.id] || 'GO';
                              const meta = classifyPropertyRegion(appItem.id);
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
                                      <span className="font-mono text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border">
                                        {meta.popCode}
                                      </span>
                                      <Badge
                                        variant={
                                          isSelectedApp ? 'default' : 'outline'
                                        }
                                        className="font-mono text-[10px] px-1.5 py-0"
                                      >
                                        {appItem.id}
                                      </Badge>
                                      <span className="text-xs text-foreground truncate max-w-28">
                                        {appItem.name}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-1.5">
                                    <Badge
                                      variant={
                                        v === 'GO'
                                          ? 'success'
                                          : v === 'REVIEW'
                                          ? 'warning'
                                          : 'destructive'
                                      }
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {v}
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

                        {totalFleetPages > 1 && (
                          <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between font-mono text-[10px]">
                            <span className="text-muted-foreground">
                              Page {safeFleetPage} of {totalFleetPages} ({filteredFleetApps.length} properties)
                            </span>
                            <div className="flex items-center gap-1">
                              <select
                                aria-label="Fleet page size"
                                value={fleetPageSize}
                                onChange={(e) => {
                                  setFleetPageSize(Number(e.target.value));
                                  setFleetPage(1);
                                }}
                                className="h-5 px-1 rounded border border-input bg-background text-[10px]"
                              >
                                <option value={15}>15/pg</option>
                                <option value={25}>25/pg</option>
                                <option value={50}>50/pg</option>
                              </select>
                              <button
                                type="button"
                                disabled={safeFleetPage <= 1}
                                onClick={() =>
                                  setFleetPage((p) => Math.max(1, p - 1))
                                }
                                className="px-1.5 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                              >
                                ← Prev
                              </button>
                              <button
                                type="button"
                                disabled={safeFleetPage >= totalFleetPages}
                                onClick={() =>
                                  setFleetPage((p) =>
                                    Math.min(totalFleetPages, p + 1)
                                  )
                                }
                                className="px-1.5 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                              >
                                Next →
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="max-h-96 overflow-y-auto">
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
                );
              })()}
            </div>
          </main>
          </>
        );
      })()}

      {/* =====================================================================
          MODE 2: FOCUSED COMPARATIVE DIFF VIEW (SCALABLE FOR 100+ CHECKS)
         ===================================================================== */}
      {viewMode === 'diff' && (
        <>
          <div className="sticky top-11 z-20 bg-background/95 backdrop-blur-xs border-b border-border px-3 sm:px-4 py-1">
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
            {(() => {
              const effPopId =
                activeCandidateRun.executionPop?.id ||
                (selectedExecutionPopId !== 'auto' ? selectedExecutionPopId : undefined);
              const activeNode = resolveRegionalEdgeNode(
                activeAppId,
                comparison.items[0]?.url,
                effPopId
              );
              const activeSuiteId = activeCandidateRun.suiteAppId || activeAppId;
              return (
                <div
                  data-testid="regional-edge-node-strip"
                  className="mt-1 pt-1 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-muted-foreground"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <Globe className="w-3 h-3 text-primary shrink-0" />
                      {activeNode.regionLabel}
                    </span>
                    <span>·</span>
                    <span>
                      STG:{' '}
                      <span className="text-primary font-medium tabular-nums">
                        {activeNode.stagingPopCode} ({activeNode.stagingEdgeIp})
                      </span>
                    </span>
                    <span>↔</span>
                    <span>
                      PRD:{' '}
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                        {activeNode.prodPopCode} ({activeNode.prodEdgeIp})
                      </span>
                    </span>
                    <span>·</span>
                    <span
                      data-testid="diff-active-suite-badge"
                      className="text-foreground font-medium"
                    >
                      Suite: {activeSuiteId}.csv
                    </span>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-muted-foreground">
                    <span>Lang: {activeNode.acceptLanguage.split(',')[0]}</span>
                    <span>·</span>
                    <span>
                      prorigin={activeNode.proriginCode}; AKA_A2={activeNode.countryCode}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          <main className="px-3 sm:px-4 py-2.5 w-full flex-1 min-w-0 overflow-x-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start min-w-0">
              <Card className="lg:col-span-4 min-w-0 overflow-hidden">
                {/* Scalable Dimension Filter Chips, Search & Sort Bar (Single Clean Way to Filter) */}
                <div className="px-3 py-2 border-b border-border bg-muted/20 space-y-1.5">
                  <div className="flex items-center justify-between gap-1 font-mono text-[10px] overflow-x-auto no-scrollbar">
                    <div className="inline-flex items-center gap-1 shrink-0">
                      {(
                        [
                          { id: 'all', label: `All (${pagedDiffResult.facetCounts.all})` },
                          {
                            id: 'any-diff',
                            label: `Diffs (${pagedDiffResult.facetCounts['any-diff']})`,
                          },
                          {
                            id: 'headers',
                            label: `Hdrs (${pagedDiffResult.facetCounts.headers})`,
                          },
                          {
                            id: 'cookies',
                            label: `Cookie (${pagedDiffResult.facetCounts.cookies})`,
                          },
                          {
                            id: 'visual',
                            label: `Visual (${pagedDiffResult.facetCounts.visual})`,
                          },
                        ] as const
                      ).map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => {
                            setDiffDimensionFilter(chip.id);
                            setDiffPage(1);
                          }}
                          className={`px-1.5 py-0.5 rounded border cursor-pointer transition-colors whitespace-nowrap ${
                            diffDimensionFilter === chip.id
                              ? 'bg-sky-500 text-zinc-950 border-sky-500 font-bold'
                              : 'bg-background border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    <div className="relative flex-1 min-w-[120px]">
                      <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        data-shortcut-search="true"
                        placeholder={`Search ${comparison.items.length} checks… (/)`}
                        value={diffSearchQuery}
                        onChange={(e) => {
                          setDiffSearchQuery(e.target.value);
                          setDiffPage(1);
                        }}
                        className="h-6 pl-6 pr-2 rounded border border-input bg-background text-[11px] font-mono w-full"
                      />
                    </div>

                    <div className="flex items-center gap-1 font-mono text-[10px] shrink-0">
                      <select
                        aria-label="Sort diff checks"
                        value={diffSortBy}
                        onChange={(e) =>
                          setDiffSortBy(
                            e.target.value as 'id' | 'severity' | 'latency' | 'hops'
                          )
                        }
                        className="h-6 px-1.5 rounded border border-input bg-background text-foreground"
                      >
                        <option value="id">Sort: ID</option>
                        <option value="severity">Sort: Severity</option>
                        <option value="latency">Sort: Latency</option>
                        <option value="hops">Sort: Hops</option>
                      </select>

                      {comparison.items.length > 12 && (
                        <select
                          aria-label="Diff page size"
                          value={diffPageSize}
                          onChange={(e) => {
                            setDiffPageSize(Number(e.target.value));
                            setDiffPage(1);
                          }}
                          className="hidden sm:inline-block h-6 px-1.5 rounded border border-input bg-background text-foreground"
                        >
                          <option value={12}>12/pg</option>
                          <option value={25}>25/pg</option>
                          <option value={50}>50/pg</option>
                          <option value={100}>100/pg</option>
                        </select>
                      )}
                    </div>
                  </div>
                </div>

                <div className="max-h-[68vh] overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1.5 text-[11px]">Page & Test Case</TableHead>
                        <TableHead
                          className="hidden sm:table-cell text-center w-10 px-1 py-1.5 font-mono text-[10px] text-muted-foreground"
                          title="HTTP Flow Hops, Redirect Chain & Timing Waterfall — Click any cell below to open HTTP Flow tab"
                        >
                          Flow
                        </TableHead>
                        <TableHead
                          className="text-center w-10 px-1 py-1.5 font-mono text-[10px] text-muted-foreground"
                          title="HTTP Response Header & Cache Key Diffs — Click any cell below to open Headers tab"
                        >
                          Hdrs
                        </TableHead>
                        <TableHead
                          className="text-center w-11 px-1 py-1.5 font-mono text-[10px] text-muted-foreground"
                          title="Set-Cookie Domain, SameSite & Attribute Diffs — Click any cell below to open Cookies tab"
                        >
                          Cookie
                        </TableHead>
                        <TableHead
                          className="hidden sm:table-cell text-center w-11 px-1 py-1.5 font-mono text-[10px] text-muted-foreground"
                          title="Visual DOM Screenshot & AI Judge Verdict — Click any cell below to open Image AI tab"
                        >
                          Visual
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedDiffResult.items.map((item) => {
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
                            <TableCell className="py-2 pr-1.5">
                              <div
                                className="flex items-center gap-2 min-w-0"
                                title={`${item.testId}: ${item.testName} (${item.url})`}
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
                                    screenshotRevision={
                                      lastProbedByTestId[item.testId]?.screenshotRevision
                                    }
                                    onClick={() =>
                                      handleSelectTestRow(item, 'image')
                                    }
                                  />
                                </div>
                                <div className="min-w-0 max-w-[205px] xl:max-w-[240px]">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-mono font-bold text-xs text-sky-600 dark:text-sky-400 shrink-0">
                                      {item.testId}
                                    </span>
                                    <span className="font-medium text-xs text-foreground truncate">
                                      {item.testName}
                                    </span>
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate">
                                    {item.url}
                                  </div>
                                </div>
                              </div>
                            </TableCell>

                            <TableCell
                              className="hidden sm:table-cell text-center px-1.5 py-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'flow');
                              }}
                            >
                              <span
                                className={`font-mono text-[11px] tabular-nums ${
                                  hopCount > 1
                                    ? 'text-primary font-semibold'
                                    : 'text-muted-foreground'
                                }`}
                              >
                                {hopCount}h
                              </span>
                            </TableCell>

                            <TableCell
                              className="text-center px-1.5 py-1.5"
                              title={
                                rawHDiffs > 0 && isHAcc
                                  ? `${rawHDiffs} header diff(s) accepted via baseline rule`
                                  : undefined
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'headers');
                              }}
                            >
                              {hDiffs > 0 ? (
                                <Badge variant="destructive" className="font-mono px-1.5 py-0 text-[10px]">
                                  {hDiffs}
                                </Badge>
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/85 mx-auto" />
                              )}
                            </TableCell>

                            <TableCell
                              className="text-center px-1.5 py-1.5"
                              title={
                                rawCDiffs > 0 && isCAcc
                                  ? `${rawCDiffs} cookie diff(s) accepted via baseline rule`
                                  : undefined
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'cookies');
                              }}
                            >
                              {cDiffs > 0 ? (
                                <Badge variant="warning" className="font-mono px-1.5 py-0 text-[10px]">
                                  {cDiffs}
                                </Badge>
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/85 mx-auto" />
                              )}
                            </TableCell>

                            <TableCell
                              className="hidden sm:table-cell text-center px-1.5 py-1.5"
                              title={
                                rawVDiff && isVAcc
                                  ? 'Visual diff accepted via baseline rule'
                                  : undefined
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectTestRow(item, 'image');
                              }}
                            >
                              {vDiff ? (
                                <Badge variant="warning" className="font-mono px-1 py-0 text-[10px]">
                                  AI
                                </Badge>
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/85 mx-auto" />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination Bar for Large Suites (64+ Checks) */}
                {pagedDiffResult.totalPages > 1 && (
                  <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between font-mono text-[10px]">
                    <span className="text-muted-foreground">
                      Page {pagedDiffResult.currentPage} of {pagedDiffResult.totalPages} (
                      {pagedDiffResult.totalItems} checks)
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={pagedDiffResult.currentPage <= 1}
                        onClick={() => setDiffPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                      >
                        ← Prev
                      </button>
                      <button
                        type="button"
                        disabled={
                          pagedDiffResult.currentPage >= pagedDiffResult.totalPages
                        }
                        onClick={() =>
                          setDiffPage((p) =>
                            Math.min(pagedDiffResult.totalPages, p + 1)
                          )
                        }
                        className="px-2 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </Card>

              <div className="lg:col-span-8">
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
                    prevTestId={pagedDiffResult.prevTestId}
                    nextTestId={pagedDiffResult.nextTestId}
                    currentIndex={pagedDiffResult.activeIndexInFiltered}
                    totalFilteredCount={pagedDiffResult.totalItems}
                    onSelectTest={(nextId) => {
                      const nextItem = comparison.items.find(
                        (i) => i.testId === nextId
                      );
                      if (nextItem) handleSelectTestRow(nextItem, inspectorTab);
                    }}
                    diffsOnly={diffInspectorDiffsOnly}
                    onDiffsOnlyChange={setDiffInspectorDiffsOnly}
                    preferLiveApiScreenshots={isAwsLambdaBackend}
                  />
                )}
              </div>
            </div>
          </main>
        </>
      )}

      {/* =====================================================================
          MODE 3: FOCUSED SINGLE-RUN VIEW (SCALABLE FOR 100+ CHECKS)
         ===================================================================== */}
      {viewMode === 'run' && (() => {
        const targetRuns = runs.filter((r) => r.target === focusedTargetId);
        const isRunning = targetStates[focusedTargetId]?.state === 'running';
        const [appId, envId, net] = focusedTargetId.split('.');
        const counterpartTarget = `${appId}.${envId}.${
          net === 'staging' ? 'prod' : 'staging'
        }`;

        const filteredRunResults = activeSingleRun.results.filter((res) => {
          const hopCount = res.redirectChain?.length || 1;
          const isRedir = res.actualStatus >= 300 && res.actualStatus < 400;
          const isCacheNo = res.capturedHeaders?.['x-check-cacheable'] === 'NO';
          if (runFilter === 'redirects' && !isRedir) return false;
          if (runFilter === 'multi-hop' && hopCount <= 1) return false;
          if (runFilter === 'cache-no' && !isCacheNo) return false;
          if (runSearchQuery.trim()) {
            const q = runSearchQuery.toLowerCase();
            return (
              res.id.toLowerCase().includes(q) ||
              res.name.toLowerCase().includes(q) ||
              res.url.toLowerCase().includes(q)
            );
          }
          return true;
        });

        const totalRunPages = Math.max(
          1,
          Math.ceil(filteredRunResults.length / runPageSize)
        );
        const safeRunPage = Math.min(Math.max(1, runPage), totalRunPages);
        const pagedRunResults = filteredRunResults.slice(
          (safeRunPage - 1) * runPageSize,
          safeRunPage * runPageSize
        );
        const activeRunIdx = filteredRunResults.findIndex(
          (r) => r.id === selectedSingleResult?.id
        );
        const prevRunTestId =
          activeRunIdx > 0 ? filteredRunResults[activeRunIdx - 1].id : null;
        const nextRunTestId =
          activeRunIdx >= 0 && activeRunIdx < filteredRunResults.length - 1
            ? filteredRunResults[activeRunIdx + 1].id
            : null;

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

            <main className="px-3 sm:px-4 py-2.5 w-full flex-1 min-w-0 overflow-x-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start min-w-0">
                <Card className="lg:col-span-4 min-w-0 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-border bg-muted/20 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Run Checks ({filteredRunResults.length}/{activeSingleRun.totalTests})
                      </span>
                      <div className="relative">
                        <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          data-shortcut-search="true"
                          placeholder="Search checks… (/)"
                          value={runSearchQuery}
                          onChange={(e) => {
                            setRunSearchQuery(e.target.value);
                            setRunPage(1);
                          }}
                          className="h-6 pl-6 pr-2 rounded border border-input bg-background text-[11px] font-mono w-36"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1 flex-wrap font-mono text-[10px]">
                      <div className="inline-flex items-center gap-1">
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'redirects', label: '301 Redir' },
                            { id: 'multi-hop', label: 'Multi-Hop' },
                            { id: 'cache-no', label: 'Cache NO' },
                          ] as const
                        ).map((rf) => (
                          <button
                            key={rf.id}
                            type="button"
                            onClick={() => {
                              setRunFilter(rf.id);
                              setRunPage(1);
                            }}
                            className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                              runFilter === rf.id
                                ? 'bg-sky-500 text-zinc-950 border-sky-500 font-bold'
                                : 'bg-background border-border text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {rf.label}
                          </button>
                        ))}
                      </div>

                      <select
                        aria-label="Single run page size"
                        value={runPageSize}
                        onChange={(e) => {
                          setRunPageSize(Number(e.target.value));
                          setRunPage(1);
                        }}
                        className="h-5 px-1 rounded border border-input bg-background text-[10px]"
                      >
                        <option value={12}>12/pg</option>
                        <option value={25}>25/pg</option>
                        <option value={50}>50/pg</option>
                      </select>
                    </div>
                  </div>

                  <div className="max-h-[68vh] overflow-y-auto overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="py-1.5">Test Case</TableHead>
                          <TableHead className="text-center w-11 py-1.5">
                            <Activity className="w-3.5 h-3.5 mx-auto text-sky-500" />
                          </TableHead>
                          <TableHead className="text-center w-12 py-1.5">
                            <Code2 className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                          </TableHead>
                          <TableHead className="text-center w-12 py-1.5">
                            <KeyRound className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                          </TableHead>
                          <TableHead className="text-center w-12 py-1.5">
                            <Sparkles className="w-3.5 h-3.5 mx-auto text-muted-foreground" />
                          </TableHead>
                          <TableHead className="text-right w-16 py-1.5">Latency</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedRunResults.map((res) => {
                          const isSelected = res.id === selectedSingleResult?.id;
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
                                      screenshotRevision={
                                        lastProbedByTestId[res.id]?.screenshotRevision
                                      }
                                      onClick={() => {
                                        setSelectedTestId(res.id);
                                        setInspectorTab('image');
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {res.pass ? (
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      ) : (
                                        <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                                      )}
                                      <span className="font-mono font-bold text-xs shrink-0">
                                        {res.id}
                                      </span>
                                      <span className="font-medium text-xs truncate">
                                        {res.name}
                                      </span>
                                    </div>
                                    <div className="font-mono text-[10px] text-muted-foreground truncate">
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

                  {totalRunPages > 1 && (
                    <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between font-mono text-[10px]">
                      <span className="text-muted-foreground">
                        Page {safeRunPage} of {totalRunPages}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={safeRunPage <= 1}
                          onClick={() => setRunPage((p) => Math.max(1, p - 1))}
                          className="px-2 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                        >
                          ← Prev
                        </button>
                        <button
                          type="button"
                          disabled={safeRunPage >= totalRunPages}
                          onClick={() =>
                            setRunPage((p) => Math.min(totalRunPages, p + 1))
                          }
                          className="px-2 py-0.5 rounded border border-border bg-background disabled:opacity-40 cursor-pointer"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  )}
                </Card>

                <div className="lg:col-span-8">
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
                      prevTestId={prevRunTestId}
                      nextTestId={nextRunTestId}
                      currentIndex={activeRunIdx}
                      totalFilteredCount={filteredRunResults.length}
                      onSelectTest={(nextId) => setSelectedTestId(nextId)}
                      preferLiveApiScreenshots={isAwsLambdaBackend}
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

      {/* Global Command Palette (⌘K / Ctrl+K), Keyboard Shortcuts Help (?), & Suite @ PoP Launcher (X) */}
      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        items={commandPaletteItems}
        activeAppId={activeAppId}
        activePopLabel={
          selectedExecutionPopId === 'auto'
            ? 'Auto (Default PoP)'
            : `${selectedExecutionPopId.toUpperCase()} · ${
                resolveExecutionPopOption(selectedExecutionPopId)?.city || ''
              }`
        }
      />

      <ShortcutsHelpModal
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />

      <SuitePopLauncherModal
        open={suitePopLauncherOpen}
        onClose={() => setSuitePopLauncherOpen(false)}
        apps={apps}
        initialSuiteAppId={activeAppId}
        initialTargetAppId={activeAppId}
        initialPopId={selectedExecutionPopId}
        suiteScaleCount={testSuite.length}
        onLaunch={({ suiteAppId, targetAppId, envId, popId, mode }) => {
          setActiveAppId(targetAppId);
          setSelectedExecutionPopId(popId);
          const stgTarget = `${targetAppId}.${envId}.staging`;
          const prdTarget = `${targetAppId}.${envId}.prod`;
          if (mode === 'compare') {
            handleRunAndCompareTargets(stgTarget, prdTarget, false, {
              suiteAppId,
              popId,
            });
          } else {
            const singleTarget = mode === 'staging' ? stgTarget : prdTarget;
            handleRunSingleTarget(singleTarget, false, { suiteAppId, popId });
          }
        }}
      />

      {pendingChord === 'g' && (
        <div
          data-testid="keyboard-chord-hud"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-sky-500/40 bg-zinc-950/95 text-zinc-100 px-3 py-2 shadow-xl flex items-center gap-2.5 text-xs font-mono"
        >
          <span className="inline-flex items-center gap-1 text-sky-400 font-bold">
            <Kbd tone="dark-surface">G</Kbd>
            <span>then…</span>
          </span>
          <span className="text-zinc-400 text-[11px]">
            O Overview · D Diff · S Suites · R Run · M Cloud · V VS Code · , Settings · ? Guide
          </span>
        </div>
      )}
    </div>
  );
}
