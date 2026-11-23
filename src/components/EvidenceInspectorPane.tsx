import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Maximize2,
  RefreshCw,
  RotateCw,
  Search,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { ComparisonItem, TestResult } from '../engine/types';
import { generateReproduceCurl } from '../engine/rules';
import { buildCheckMcpCallPayload } from '../engine/mcpProtocol';
import {
  buildScreenshotFallbackUrl,
  normalizeEdgeScreenshotUrl,
  resolveLiveScreenshotUrl,
} from '../engine/domScreenshotRenderer';
import {
  buildItemizedVisualAnalysis,
  classifyVisualVerdictFromPixelDiff,
  describeVisualDiffLogically,
  renderBrowserDiffHeatmapDataUrl,
  type ItemizedVisualFinding,
  type MeasuredBoxSpec,
  type MeasuredVisualDiffResult,
} from '../engine/pixelDiff';
import {
  cleanHumanVisualSummary,
  filterEvidenceKeys,
  InspectorDimensionTab,
  resolveSafeAreaLabel,
} from '../engine/workbenchModel';
import {
  DEFAULT_TEMPLATE_CONFIG,
  TestCaseDefinition,
} from '../config/template.config';
import { getCatchpointTypeMeta } from '../engine/catchpointCatalog';
import { getScriptEngineMeta } from '../engine/scriptTemplates';

export { cleanHumanVisualSummary };

export interface LiveProbeBadgeInfo {
  at: string;
  count: number;
  candMs: number;
  baseMs?: number;
  status: number;
  screenshotRevision?: number;
  screenshotUrl?: string | null;
  aiJudged?: boolean;
  aiVerdict?: 'same' | 'minor' | 'different';
  aiAffectedArea?: string;
  aiShortCallout?: string;
  aiSummary?: string;
}

export interface EvidenceInspectorPaneProps {
  item?: ComparisonItem;
  testDef?: TestCaseDefinition;
  activeTab: InspectorDimensionTab;
  onChangeTab: (tab: InspectorDimensionTab) => void;
  compareMode: 'compare' | 'single';
  candidateLabel: string;
  baselineLabel: string;
  acceptedRulesKinds: string[];
  acceptedCookies: string[];
  acceptedVisualTests: string[];
  acceptedVisualParamIds?: string[];
  ignoreAcceptedDiffs: boolean;
  onToggleAcceptHeader: (field: string) => void;
  onToggleAcceptCookie: (cookieName: string) => void;
  onToggleAcceptVisual: (testId: string, driftingParamIds?: string[]) => void;
  onToggleAcceptVisualParam?: (
    testId: string,
    paramId: string,
    allDriftingParamIds: string[]
  ) => void;
  onMeasuredVisualDiff?: (testId: string, measured: MeasuredVisualDiffResult) => void;
  onRerunCheck: (testId: string) => void;
  onRunAiJudge: (testId: string) => void;
  isRerunningTestId: string | null;
  isRunningAiTestId: string | null;
  lastProbe?: LiveProbeBadgeInfo;
  appId: string;
  onPrevCheck?: () => void;
  onNextCheck?: () => void;
  hasPrevCheck?: boolean;
  hasNextCheck?: boolean;
}

const KEY_HEADERS_ORDER = [
  'location',
  'cache-control',
  'x-check-cacheable',
  'x-cache',
  'content-type',
  'x-sfdc-content-source',
  'strict-transport-security',
  'x-akamai-request-id',
  'vary',
];

function collectHeaderKeys(
  cand?: TestResult,
  base?: TestResult
): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const k of KEY_HEADERS_ORDER) {
    if (
      cand?.capturedHeaders?.[k] !== undefined ||
      base?.capturedHeaders?.[k] !== undefined
    ) {
      seen.add(k);
      all.push(k);
    }
  }
  const extra = new Set([
    ...Object.keys(cand?.capturedHeaders || {}),
    ...Object.keys(base?.capturedHeaders || {}),
  ]);
  for (const k of Array.from(extra).sort()) {
    const low = k.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      all.push(k);
    }
  }
  return all;
}

function collectCookieKeys(cand?: TestResult, base?: TestResult): string[] {
  return Array.from(
    new Set([
      ...Object.keys(cand?.capturedCookies || {}),
      ...Object.keys(base?.capturedCookies || {}),
    ])
  ).sort();
}

function resolveStageScreenshotSrc(params: {
  rawUrl: string;
  stage: 0 | 1 | 2;
  retryNonce: number;
  targetUrl?: string;
}): string {
  const { rawUrl, stage, retryNonce, targetUrl } = params;
  if (!rawUrl) return '';
  if (stage === 0) {
    const cleanEdge = normalizeEdgeScreenshotUrl(rawUrl);
    return retryNonce
      ? buildScreenshotFallbackUrl(cleanEdge, { targetUrl, nonce: retryNonce })
      : cleanEdge;
  }
  if (stage === 1) {
    return buildScreenshotFallbackUrl(rawUrl, { targetUrl, nonce: retryNonce || Date.now() });
  }
  return '';
}

export const EvidenceInspectorPane: React.FC<EvidenceInspectorPaneProps> = ({
  item,
  testDef,
  activeTab,
  onChangeTab,
  compareMode,
  candidateLabel,
  baselineLabel,
  acceptedRulesKinds,
  acceptedCookies,
  acceptedVisualTests,
  acceptedVisualParamIds = [],
  ignoreAcceptedDiffs,
  onToggleAcceptHeader,
  onToggleAcceptCookie,
  onToggleAcceptVisual,
  onToggleAcceptVisualParam,
  onMeasuredVisualDiff,
  onRerunCheck,
  onRunAiJudge,
  isRerunningTestId,
  isRunningAiTestId,
  lastProbe,
  appId,
  onPrevCheck,
  onNextCheck,
  hasPrevCheck,
  hasNextCheck,
}) => {
  const [headerFilter, setHeaderFilter] = useState<'diffs' | 'all'>('all');
  const [headerQuery, setHeaderQuery] = useState('');
  const [cookieFilter, setCookieFilter] = useState<'diffs' | 'all'>('all');
  const [cookieQuery, setCookieQuery] = useState('');
  const [copiedCellKey, setCopiedCellKey] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [visualMode, setVisualMode] = useState<'wipe' | 'side' | 'heatmap'>('side');
  const [wipePercent, setWipePercent] = useState(50);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [fallbackStageA, setFallbackStageA] = useState<0 | 1 | 2>(0);
  const [fallbackStageB, setFallbackStageB] = useState<0 | 1 | 2>(0);
  const [retryNonceA, setRetryNonceA] = useState<number>(0);
  const [retryNonceB, setRetryNonceB] = useState<number>(0);
  const [highlightedZoneIndex, setHighlightedZoneIndex] = useState<number | null>(null);
  const [heatmapOverlayMode, setHeatmapOverlayMode] = useState<'pixel-heatmap' | 'zone-boxes'>('pixel-heatmap');
  const [heatmapDataUrl, setHeatmapDataUrl] = useState<string | null>(null);
  const [liveMeasuredState, setLiveMeasuredState] = useState<{
    pairKey: string;
    diff: MeasuredVisualDiffResult;
    measureBoxDeltas: (boxes: MeasuredBoxSpec[]) => Record<string, number>;
  } | null>(null);
  const onMeasuredVisualDiffRef = React.useRef(onMeasuredVisualDiff);
  onMeasuredVisualDiffRef.current = onMeasuredVisualDiff;

  const cand = item?.candidateResult;
  const base = item?.baselineResult;

  const curlSnippet = useMemo(() => {
    if (!cand) return '';
    return generateReproduceCurl(cand);
  }, [cand]);

  const mcpCallSnippet = useMemo(() => {
    if (!item) return '';
    return buildCheckMcpCallPayload({
      appId,
      testId: item.testId,
      candidateTarget: `${appId}.prod.staging`,
      baselineTarget: `${appId}.prod.prod`,
    });
  }, [appId, item]);

  React.useEffect(() => {
    setFallbackStageA(0);
    setFallbackStageB(0);
    setRetryNonceA(0);
    setRetryNonceB(0);
    setHighlightedZoneIndex(null);
    setLiveMeasuredState(null);
  }, [item?.testId, appId, lastProbe?.screenshotRevision]);

  const copyWithFeedback = (cellKey: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCellKey(cellKey);
    setTimeout(() => {
      setCopiedCellKey((curr) => (curr === cellKey ? null : curr));
    }, 1400);
  };

  if (!item || !cand) {
    return (
      <section className="flex flex-1 items-center justify-center bg-background p-8 text-sm text-muted-foreground">
        Select a check from the queue to inspect HTTP headers, cookies, and visual captures.
      </section>
    );
  }

  const headerKeys = collectHeaderKeys(cand, base);
  const cookieKeys = collectCookieKeys(cand, base);

  const sortedHeaderKeys = [...headerKeys].sort((a, b) => {
    const diffA = item.functionalDiffs.some((d) => d.field?.toLowerCase() === a.toLowerCase()) ? 1 : 0;
    const diffB = item.functionalDiffs.some((d) => d.field?.toLowerCase() === b.toLowerCase()) ? 1 : 0;
    return diffB - diffA;
  });
  const headerKeysByFilter = sortedHeaderKeys.filter((key) => {
    if (headerFilter === 'all') return true;
    return item.functionalDiffs.some(
      (d) =>
        d.field?.toLowerCase() === key.toLowerCase() ||
        d.kind.toLowerCase() === key.toLowerCase()
    );
  });
  const visibleHeaderKeys = filterEvidenceKeys({
    keys: headerKeysByFilter,
    query: headerQuery,
    candValues: cand.capturedHeaders,
    baseValues: base?.capturedHeaders,
  });

  const sortedCookieKeys = [...cookieKeys].sort((a, b) => {
    const diffA = (item.cookieDiffs || []).some((d) => d.field?.toLowerCase() === a.toLowerCase()) ? 1 : 0;
    const diffB = (item.cookieDiffs || []).some((d) => d.field?.toLowerCase() === b.toLowerCase()) ? 1 : 0;
    return diffB - diffA;
  });
  const cookieKeysByFilter = sortedCookieKeys.filter((key) => {
    if (cookieFilter === 'all') return true;
    return (item.cookieDiffs || []).some(
      (d) => d.field?.toLowerCase() === key.toLowerCase()
    );
  });
  const visibleCookieKeys = filterEvidenceKeys({
    keys: cookieKeysByFilter,
    query: cookieQuery,
    candValues: cand.capturedCookies,
    baseValues: base?.capturedCookies,
  });

  const unacceptedHeaderCount = ignoreAcceptedDiffs
    ? item.functionalDiffs.filter((d) => !d.accepted).length
    : item.functionalDiffs.length;
  const unacceptedCookieCount = ignoreAcceptedDiffs
    ? (item.cookieDiffs || []).filter((d) => !d.accepted).length
    : (item.cookieDiffs || []).length;
  const hasVisualDiff =
    item.visualResult?.verdict === 'different' ||
    item.visualResult?.verdict === 'minor';

  const rawSideAUrl =
    cand.screenshotUrl && !cand.screenshotUrl.startsWith('data:image/svg+xml')
      ? cand.screenshotUrl
      : resolveLiveScreenshotUrl({
          appId,
          testId: item.testId,
          testName: item.testName,
          url: item.url,
          side: 'A',
          httpStatus: cand.actualStatus,
          revision: lastProbe?.screenshotRevision ?? cand.screenshotRevision,
        });

  const sideBStatus = base?.actualStatus ?? 200;
  const rawSideBUrl =
    base?.screenshotUrl && !base.screenshotUrl.startsWith('data:image/svg+xml')
      ? base.screenshotUrl
      : resolveLiveScreenshotUrl({
          appId,
          testId: item.testId,
          testName: item.testName,
          url: item.url,
          side: 'B',
          httpStatus: sideBStatus,
          revision: lastProbe?.screenshotRevision ?? base?.screenshotRevision,
        });

  const sideAConsentImg = resolveStageScreenshotSrc({
    rawUrl: rawSideAUrl,
    stage: fallbackStageA,
    retryNonce: retryNonceA,
    targetUrl: item.url,
  });
  const sideBConsentImg = resolveStageScreenshotSrc({
    rawUrl: rawSideBUrl,
    stage: fallbackStageB,
    retryNonce: retryNonceB,
    targetUrl: item.url,
  });

  const handleImgErrorA = () => {
    setFallbackStageA((prev) => {
      if (prev === 0) {
        setRetryNonceA(Date.now());
        return 1;
      }
      return 2;
    });
  };

  const handleImgErrorB = () => {
    setFallbackStageB((prev) => {
      if (prev === 0) {
        setRetryNonceB(Date.now());
        return 1;
      }
      return 2;
    });
  };

  const isSideAUnavailable =
    fallbackStageA === 2 ||
    !sideAConsentImg ||
    sideAConsentImg.startsWith('data:image/svg+xml');
  const isSideBUnavailable =
    fallbackStageB === 2 ||
    !sideBConsentImg ||
    sideBConsentImg.startsWith('data:image/svg+xml');

  const currentPairKey = `${item.testId}:::${sideAConsentImg}:::${sideBConsentImg}`;
  const activeMeasuredDiff =
    compareMode === 'compare' &&
    liveMeasuredState &&
    liveMeasuredState.pairKey === currentPairKey
      ? liveMeasuredState.diff
      : null;
  const activeMeasureBoxDeltas =
    compareMode === 'compare' &&
    liveMeasuredState &&
    liveMeasuredState.pairKey === currentPairKey
      ? liveMeasuredState.measureBoxDeltas
      : null;

  const storedPixelDiff = item.visualResult?.pixelDiffPercent ?? cand.pixelDiffPercent ?? 0;
  // Ground truth: ALWAYS trust real pixel measurement of the actual two rendered screenshots
  // over stale 0.0% manifest/run metadata so the portal can NEVER lie when images visibly differ.
  const effectivePixelDiff = activeMeasuredDiff
    ? activeMeasuredDiff.pixelDiffPercent
    : storedPixelDiff;
  const resolvedChangedBox =
    activeMeasuredDiff
      ? activeMeasuredDiff.changedBox
      : item.visualResult?.changedBox ??
        cand.changedBox ??
        item.visualResult?.differences?.find((d) => d.severity !== 'match')?.box ??
        null;
  const resolvedZones =
    activeMeasuredDiff?.zones ?? item.visualResult?.zones ?? cand.zones ?? null;

  const liveLogicalExplanation = useMemo(() => {
    if (!activeMeasuredDiff) return null;
    return describeVisualDiffLogically({
      pixelDiffPercent: activeMeasuredDiff.pixelDiffPercent,
      changedBox: activeMeasuredDiff.changedBox,
      zones: activeMeasuredDiff.zones,
      candidateLabel,
      baselineLabel,
      pageName: item.testName,
      url: item.url,
      candidateStatus: cand.actualStatus,
      baselineStatus: base?.actualStatus,
    });
  }, [
    activeMeasuredDiff,
    candidateLabel,
    baselineLabel,
    item.testName,
    item.url,
    cand.actualStatus,
    base?.actualStatus,
  ]);

  const visualVerdict = activeMeasuredDiff
    ? classifyVisualVerdictFromPixelDiff(activeMeasuredDiff.pixelDiffPercent)
    : item.visualResult?.verdict || 'same';
  const rawArea = liveLogicalExplanation?.affectedArea || item.visualResult?.affectedArea || '';
  const safeArea = resolveSafeAreaLabel(rawArea, visualVerdict);

  const humanSummary = cleanHumanVisualSummary(
    liveLogicalExplanation?.summary || item.visualResult?.summary,
    {
      pixelDiffPercent: effectivePixelDiff,
      changedBox: resolvedChangedBox,
      zones: resolvedZones,
      candidateLabel,
      baselineLabel,
      pageName: item.testName,
      url: item.url,
      candidateStatus: cand.actualStatus,
      baselineStatus: base?.actualStatus,
    }
  );
  const isVisualAccepted = acceptedVisualTests.includes(item.testId);

  const functionalDiffSummary = useMemo(() => {
    if (!item.functionalDiffs || item.functionalDiffs.length === 0) return undefined;
    return item.functionalDiffs
      .slice(0, 2)
      .map((d) => `${d.field}: ${d.candidateValue || '—'} vs ${d.baselineValue || '—'}`)
      .join('; ');
  }, [item.functionalDiffs]);

  const itemizedFindings: ItemizedVisualFinding[] = useMemo(() => {
    const baseInput = {
      pixelDiffPercent: effectivePixelDiff,
      changedBox: resolvedChangedBox,
      zones: resolvedZones,
      candidateLabel,
      baselineLabel,
      pageName: item.testName,
      url: item.url,
      candidateStatus: cand.actualStatus,
      baselineStatus: base?.actualStatus,
      testType: cand.testType || testDef?.testType,
      functionalDiffSummary,
      cookieDiffCount: (item.cookieDiffs || []).length,
    };

    // Pass 1: derive the page-specific dynamic AI validation parameters and their boxes
    const initialDraft = buildItemizedVisualAnalysis(baseInput);

    // Pass 2: if we have live browser RGBA frames for Side A & Side B, measure exact real pixel
    // delta inside every single dynamic parameter's bounding box so no row ever lies
    const measuredBoxDeltas = activeMeasureBoxDeltas
      ? activeMeasureBoxDeltas(
          initialDraft.map((f) => ({ id: f.id, box: f.box }))
        )
      : null;

    const generated = measuredBoxDeltas
      ? buildItemizedVisualAnalysis({ ...baseInput, boxDeltas: measuredBoxDeltas })
      : initialDraft;

    const rawDiffs = item.visualResult?.differences || [];
    const hasAiInventedParams =
      rawDiffs.length >= 2 &&
      rawDiffs.some(
        (d) =>
          (d.parameterOrigin === 'bedrock-nova-lite' ||
            d.parameterOrigin === 'gemini-multimodal') &&
          Boolean(d.region && d.stagingObservation)
      );

    // If Bedrock Nova Lite or Gemini Multimodal returned genuine page-invented parameters,
    // display them AND ground every parameter's delta/severity against the real measured pixels
    if (hasAiInventedParams) {
      const normalizedAi = rawDiffs.map((d, idx) => {
        const fb = generated[idx] || generated[0];
        const id = d.id || fb?.id || `ai-param-${idx + 1}`;
        const box = d.box || fb?.box || { x: 0, y: Math.min(80, idx * 20), w: 100, h: 20 };
        return {
          id,
          region: d.region || fb?.region || `AI Criterion ${idx + 1}`,
          rationale: d.rationale || fb?.rationale,
          parameterOrigin: d.parameterOrigin,
          severity: d.severity || fb?.severity || 'minor',
          stagingObservation: d.stagingObservation || fb?.stagingObservation || 'Observed live DOM state',
          prodObservation: d.prodObservation || fb?.prodObservation || 'Baseline DOM state',
          description: d.description || fb?.description || humanSummary,
          impact: d.impact || fb?.impact || 'Visual layout comparison finding',
          zoneDeltaPct:
            typeof d.zoneDeltaPct === 'number'
              ? d.zoneDeltaPct
              : fb?.zoneDeltaPct ?? effectivePixelDiff,
          box,
          accepted: d.accepted,
        };
      });

      if (activeMeasureBoxDeltas) {
        const aiBoxDeltas = activeMeasureBoxDeltas(
          normalizedAi.map((f) => ({ id: f.id, box: f.box }))
        );
        return normalizedAi.map((f) => {
          const realDelta = aiBoxDeltas[f.id];
          if (typeof realDelta === 'number' && !Number.isNaN(realDelta)) {
            const groundedSeverity: 'major' | 'minor' | 'match' =
              realDelta > 10
                ? 'major'
                : realDelta > 0.8
                ? f.severity === 'major'
                  ? 'major'
                  : 'minor'
                : 'match';
            return {
              ...f,
              zoneDeltaPct: realDelta,
              severity: groundedSeverity,
            };
          }
          return f;
        });
      }
      return normalizedAi;
    }

    return generated.map((g, idx) => ({
      ...g,
      accepted: rawDiffs[idx]?.accepted ?? g.accepted,
    }));
  }, [
    effectivePixelDiff,
    resolvedChangedBox,
    resolvedZones,
    activeMeasureBoxDeltas,
    item.visualResult?.differences,
    candidateLabel,
    baselineLabel,
    item.testName,
    item.url,
    cand.actualStatus,
    base?.actualStatus,
    cand.testType,
    testDef?.testType,
    functionalDiffSummary,
    item.cookieDiffs,
    humanSummary,
  ]);

  const driftingVisualParamIds = useMemo(
    () => itemizedFindings.filter((f) => f.severity !== 'match').map((f) => f.id),
    [itemizedFindings]
  );

  const acceptedParamSet = useMemo(() => {
    const s = new Set<string>(acceptedVisualParamIds);
    if (isVisualAccepted) {
      for (const id of driftingVisualParamIds) s.add(id);
    }
    return s;
  }, [acceptedVisualParamIds, isVisualAccepted, driftingVisualParamIds]);

  const unacceptedDriftParamCount = useMemo(
    () => driftingVisualParamIds.filter((id) => !acceptedParamSet.has(id)).length,
    [driftingVisualParamIds, acceptedParamSet]
  );

  const diffBox =
    resolvedChangedBox ??
    itemizedFindings.find((d) => d.severity !== 'match')?.box;

  const activeHighlightedFinding =
    highlightedZoneIndex !== null ? itemizedFindings[highlightedZoneIndex] : null;

  React.useEffect(() => {
    if (
      activeTab !== 'image' ||
      isSideAUnavailable ||
      isSideBUnavailable ||
      !sideAConsentImg ||
      !sideBConsentImg
    ) {
      setHeatmapDataUrl(null);
      return;
    }
    let cancelled = false;
    const pairKey = `${item.testId}:::${sideAConsentImg}:::${sideBConsentImg}`;
    void renderBrowserDiffHeatmapDataUrl(sideAConsentImg, sideBConsentImg).then((res) => {
      if (!cancelled) {
        setHeatmapDataUrl(res?.heatmapDataUrl || null);
        if (res?.diff && compareMode === 'compare') {
          setLiveMeasuredState({
            pairKey,
            diff: res.diff,
            measureBoxDeltas: res.measureBoxDeltas,
          });
          // Sync real measured pixel diff upward so Check Queue (V! badge) & Release Gate stay 100% truthful
          onMeasuredVisualDiffRef.current?.(item.testId, res.diff);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    compareMode,
    item.testId,
    sideAConsentImg,
    sideBConsentImg,
    isSideAUnavailable,
    isSideBUnavailable,
  ]);

  const isRerunningThis =
    isRerunningTestId === item.testId || isRerunningTestId === 'ALL';
  const isAiRunning = isRunningAiTestId === item.testId;

  const resolvedTestType = cand.testType || testDef?.testType;
  const typeMeta = getCatchpointTypeMeta(resolvedTestType);
  const stepResults = cand.transactionStepResults || [];
  const assertions = cand.assertionResults || [];
  const failedAssertionCount = assertions.filter((a) => !a.passed).length;
  const hasComplexFlowTelemetry = Boolean(
    stepResults.length > 0 ||
      cand.scriptResult ||
      testDef?.customScript?.trim() ||
      cand.dnsResult ||
      cand.sslResult ||
      cand.networkResult
  );

  const tabs: Array<{
    id: InspectorDimensionTab;
    label: string;
    count?: number | string;
  }> = [
    {
      id: 'headers',
      label: 'Headers',
      count:
        unacceptedHeaderCount + failedAssertionCount > 0
          ? unacceptedHeaderCount + failedAssertionCount
          : undefined,
    },
    {
      id: 'cookies',
      label: 'Cookies',
      count: unacceptedCookieCount > 0 ? unacceptedCookieCount : undefined,
    },
    {
      id: 'image',
      label: 'Visual',
      count: hasVisualDiff ? '!' : undefined,
    },
    {
      id: 'flow',
      label: hasComplexFlowTelemetry ? 'Steps & Flow' : 'Flow',
      count:
        stepResults.length > 0
          ? `${stepResults.length}s`
          : cand.redirectChain?.length || 1,
    },
  ];

  const candMs = cand.httpFlowSummary?.totalDurationMs ?? cand.durationMs;
  const baseMs = base?.httpFlowSummary?.totalDurationMs ?? base?.durationMs;

  return (
    <section
      aria-label="Evidence inspector"
      className="flex flex-1 flex-col bg-background min-w-0 lg:min-h-0 lg:h-full lg:overflow-hidden"
    >
      {/* Tier 1: Compact Check Identity & Primary Actions */}
      <div className="shrink-0 border-b border-border/70 bg-card px-3.5 py-2 sm:px-4">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-primary shrink-0">
                {item.testId}
              </span>
              <h2 className="font-display text-sm font-semibold text-foreground leading-snug truncate">
                {item.testName}
              </h2>
              <span
                className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                  cand.actualStatus >= 400
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                HTTP {cand.actualStatus}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {candMs}ms{compareMode === 'compare' && baseMs ? ` vs ${baseMs}ms` : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/80">
                {cand.httpMethod || testDef?.httpMethod || typeMeta.defaultMethod}
              </span>
              <span className="break-all text-foreground/75">{item.url}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(item.url);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 1400);
                }}
                aria-label="Copy target URL"
                title="Copy target URL"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                {copiedUrl ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
              <span className="text-border">·</span>
              <span>{typeMeta.shortLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {(onPrevCheck || onNextCheck) && (
              <div className="inline-flex items-center rounded-md border border-border bg-background overflow-hidden">
                <button
                  type="button"
                  onClick={onPrevCheck}
                  disabled={!hasPrevCheck}
                  data-testid="btn-prev-check"
                  aria-label="Previous check"
                  title="Previous check (K)"
                  className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35 cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="h-4 w-px bg-border" />
                <button
                  type="button"
                  onClick={onNextCheck}
                  disabled={!hasNextCheck}
                  data-testid="btn-next-check"
                  aria-label="Next check"
                  title="Next check (J)"
                  className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35 cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => onRerunCheck(item.testId)}
              disabled={isRerunningThis}
              data-testid="btn-rerun-check"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <RotateCw
                className={`h-3.5 w-3.5 ${isRerunningThis ? 'animate-spin' : ''}`}
              />
              <span>Re-run</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(curlSnippet);
                setCopiedCurl(true);
                setTimeout(() => setCopiedCurl(false), 1800);
              }}
              data-testid="btn-copy-curl"
              title="Copy zero-secret cURL --resolve command"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted whitespace-nowrap cursor-pointer"
            >
              {copiedCurl ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>{copiedCurl ? 'Copied' : 'cURL'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(mcpCallSnippet);
                setCopiedMcp(true);
                setTimeout(() => setCopiedMcp(false), 1800);
              }}
              data-testid="btn-copy-mcp"
              title="Copy MCP JSON-RPC 2.0 inspect_check_evidence request"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted whitespace-nowrap cursor-pointer"
            >
              {copiedMcp ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>{copiedMcp ? 'Copied' : 'MCP'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tier 2: Full-width Dimension Tab Strip + Inline Filters */}
      <div className="shrink-0 border-b border-border bg-card/70 px-3.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Evidence dimensions" className="flex items-center gap-5 overflow-x-auto">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeTab(tab.id)}
                  data-testid={`inspector-tab-${tab.id}`}
                  className={`relative inline-flex items-center gap-1.5 py-2 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    active
                      ? 'font-semibold text-foreground'
                      : 'font-medium text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span className="font-mono text-[11px] tabular-nums text-primary font-semibold">
                      {tab.count}
                    </span>
                  )}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {activeTab === 'headers' && (
            <div className="flex flex-wrap items-center gap-1.5 py-1">
              <div className="relative w-44 sm:w-48">
                <Search className="pointer-events-none absolute left-2 top-1.75 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={headerQuery}
                  onChange={(e) => setHeaderQuery(e.target.value)}
                  placeholder="Filter headers…"
                  aria-label="Filter headers"
                  data-testid="inspector-header-search"
                  className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                {headerQuery && (
                  <button
                    type="button"
                    onClick={() => setHeaderQuery('')}
                    aria-label="Clear header search"
                    className="absolute right-1.5 top-1.75 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="inline-flex h-7 items-center rounded-md border border-border bg-background p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setHeaderFilter('diffs')}
                  className={`h-6 rounded px-2 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                    headerFilter === 'diffs'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Diffs ({item.functionalDiffs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHeaderFilter('all')}
                  className={`h-6 rounded px-2 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                    headerFilter === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All ({headerKeys.length})
                </button>
              </div>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="flex flex-wrap items-center gap-1.5 py-1">
              <div className="relative w-44 sm:w-48">
                <Search className="pointer-events-none absolute left-2 top-1.75 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={cookieQuery}
                  onChange={(e) => setCookieQuery(e.target.value)}
                  placeholder="Filter cookies…"
                  aria-label="Filter cookies"
                  data-testid="inspector-cookie-search"
                  className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                {cookieQuery && (
                  <button
                    type="button"
                    onClick={() => setCookieQuery('')}
                    aria-label="Clear cookie search"
                    className="absolute right-1.5 top-1.75 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="inline-flex h-7 items-center rounded-md border border-border bg-background p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCookieFilter('diffs')}
                  className={`h-6 rounded px-2 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                    cookieFilter === 'diffs'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Diffs ({(item.cookieDiffs || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setCookieFilter('all')}
                  className={`h-6 rounded px-2 font-medium cursor-pointer transition-colors whitespace-nowrap ${
                    cookieFilter === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All ({cookieKeys.length})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dimension Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
        {activeTab === 'headers' && (
          <div className="space-y-2.5">

            {assertions.length > 0 && (
              <div
                data-testid="inspector-assertions-panel"
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Catchpoint Assertions & SLA Gates ({assertions.length})</span>
                  <span
                    className={`font-mono ${
                      failedAssertionCount > 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {failedAssertionCount > 0
                      ? `${failedAssertionCount} FAILED`
                      : 'ALL PASSED'}
                  </span>
                </div>
                <div className="divide-y divide-border/60 font-mono text-xs">
                  {assertions.map((a, idx) => (
                    <div
                      key={`${a.rule}-${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{a.rule}</span>
                        <span className="text-muted-foreground">
                          expected {a.expected}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-foreground/90">{a.actual}</span>
                        <span
                          className={`font-semibold ${
                            a.passed
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {a.passed ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {((cand.requestHeadersSent &&
              Object.keys(cand.requestHeadersSent).length > 0) ||
              cand.requestBodySent) && (
              <div
                data-testid="inspector-request-payload"
                className="rounded-lg border border-border bg-card p-3.5 space-y-1.5 text-xs"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Outbound Request Config ({cand.httpMethod || 'GET'})
                </div>
                {cand.requestHeadersSent &&
                  Object.keys(cand.requestHeadersSent).length > 0 && (
                    <div className="font-mono text-xs space-y-0.5">
                      {Object.entries(cand.requestHeadersSent).map(([k, v]) => (
                        <div key={k} className="break-all">
                          <span className="text-muted-foreground">{k}:</span>{' '}
                          <span className="text-foreground">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                {cand.requestBodySent && (
                  <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-foreground">
                    {cand.requestBodySent}
                  </pre>
                )}
              </div>
            )}

            {item.functionalDiffs.some((d) => d.kind === 'status' || d.kind === 'assertions') && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/[0.06] px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    Critical Contract Drift Detected
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.functionalDiffs
                      .filter((d) => d.kind === 'status' || d.kind === 'assertions')
                      .map((d, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 font-mono text-xs"
                        >
                          <span>
                            {d.kind}: {d.candidateValue} vs {d.baselineValue}
                          </span>
                          <button
                            type="button"
                            onClick={() => onToggleAcceptHeader(d.kind)}
                            className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 font-sans text-[11px] font-medium hover:bg-muted cursor-pointer"
                          >
                            {d.accepted ? (
                              <>
                                <Undo2 className="h-3 w-3" /> Undo
                              </>
                            ) : (
                              <>
                                <Check className="h-3 w-3" /> Accept
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="w-[22%] px-3 py-2">Header</th>
                    <th className="w-[33%] px-3 py-2">Staging ({candidateLabel})</th>
                    {compareMode === 'compare' && (
                      <th className="w-[33%] px-3 py-2">Prod ({baselineLabel})</th>
                    )}
                    <th className="w-[12%] px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {visibleHeaderKeys.map((key) => {
                    const valA = cand.capturedHeaders?.[key] ?? '—';
                    const valB = base?.capturedHeaders?.[key] ?? '—';
                    const matchedDiff = item.functionalDiffs.find(
                      (d) => d.field?.toLowerCase() === key.toLowerCase()
                    );
                    const isRuleAccepted =
                      Boolean(matchedDiff?.accepted) ||
                      acceptedRulesKinds.some(
                        (k) => k.toLowerCase() === key.toLowerCase()
                      );
                    const isDiff = Boolean(matchedDiff);

                    return (
                      <tr
                        key={key}
                        className={
                          isDiff && !isRuleAccepted
                            ? 'bg-rose-500/[0.06]'
                            : isDiff && isRuleAccepted
                            ? 'bg-muted/25'
                            : 'hover:bg-muted/25'
                        }
                      >
                        <td className="px-3 py-2 font-mono font-medium text-foreground align-top break-words [overflow-wrap:anywhere]">
                          <div>{key}</div>
                          {isDiff && isRuleAccepted && (
                            <div className="mt-0.5 font-sans text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              Accepted by policy
                            </div>
                          )}
                        </td>
                        <td className="group px-3 py-2 font-mono text-foreground/90 break-words [overflow-wrap:anywhere] align-top">
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="min-w-0 flex-1">{valA}</span>
                            {valA !== '—' && (
                              <button
                                type="button"
                                onClick={() => copyWithFeedback(`hA-${key}`, valA)}
                                aria-label={`Copy staging ${key}`}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-opacity"
                              >
                                {copiedCellKey === `hA-${key}` ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        {compareMode === 'compare' && (
                          <td className="group px-3 py-2 font-mono text-muted-foreground break-words [overflow-wrap:anywhere] align-top">
                            <div className="flex items-start justify-between gap-1.5">
                              <span className="min-w-0 flex-1">{valB}</span>
                              {valB !== '—' && (
                                <button
                                  type="button"
                                  onClick={() => copyWithFeedback(`hB-${key}`, valB)}
                                  aria-label={`Copy prod ${key}`}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-opacity"
                                >
                                  {copiedCellKey === `hB-${key}` ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                          {isDiff ? (
                            <button
                              type="button"
                              onClick={() => onToggleAcceptHeader(key)}
                              data-testid={`accept-header-${key}`}
                              className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium cursor-pointer ${
                                isRuleAccepted
                                  ? 'border-border bg-muted text-muted-foreground hover:text-foreground'
                                  : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                              }`}
                            >
                              {isRuleAccepted ? (
                                <>
                                  <Undo2 className="h-3 w-3" /> Undo
                                </>
                              ) : (
                                <>
                                  <Check className="h-3 w-3" /> Accept
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              Match
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleHeaderKeys.length === 0 && (
                    <tr>
                      <td
                        colSpan={compareMode === 'compare' ? 4 : 3}
                        className="px-4 py-8 text-center text-xs text-muted-foreground"
                      >
                        No headers match the active filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'cookies' && (
          <div className="space-y-2.5">

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="w-[22%] px-3 py-2">Cookie Name</th>
                    <th className="w-[33%] px-3 py-2">Staging ({candidateLabel})</th>
                    {compareMode === 'compare' && (
                      <th className="w-[33%] px-3 py-2">Prod ({baselineLabel})</th>
                    )}
                    <th className="w-[12%] px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {visibleCookieKeys.map((cookieKey) => {
                    const valA = cand.capturedCookies?.[cookieKey] ?? '(not set)';
                    const valB = base?.capturedCookies?.[cookieKey] ?? '(not set)';
                    const matchedDiff = (item.cookieDiffs || []).find(
                      (d) => d.field?.toLowerCase() === cookieKey.toLowerCase()
                    );
                    const isAccepted =
                      Boolean(matchedDiff?.accepted) ||
                      acceptedCookies.includes(cookieKey.toLowerCase());
                    const isDiff = Boolean(matchedDiff);

                    return (
                      <tr
                        key={cookieKey}
                        className={
                          isDiff && !isAccepted
                            ? 'bg-amber-500/[0.06]'
                            : isDiff && isAccepted
                            ? 'bg-muted/25'
                            : 'hover:bg-muted/25'
                        }
                      >
                        <td className="px-3 py-2 font-mono font-medium text-foreground align-top break-words [overflow-wrap:anywhere]">
                          <div>{cookieKey}</div>
                          {isDiff && isAccepted && (
                            <div className="mt-0.5 font-sans text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                              Allowlisted by policy
                            </div>
                          )}
                        </td>
                        <td className="group px-3 py-2 font-mono text-foreground/90 break-words [overflow-wrap:anywhere] align-top">
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="min-w-0 flex-1">{valA}</span>
                            {valA !== '(not set)' && (
                              <button
                                type="button"
                                onClick={() => copyWithFeedback(`cA-${cookieKey}`, valA)}
                                aria-label={`Copy staging cookie ${cookieKey}`}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-opacity"
                              >
                                {copiedCellKey === `cA-${cookieKey}` ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        {compareMode === 'compare' && (
                          <td className="group px-3 py-2 font-mono text-muted-foreground break-words [overflow-wrap:anywhere] align-top">
                            <div className="flex items-start justify-between gap-1.5">
                              <span className="min-w-0 flex-1">{valB}</span>
                              {valB !== '(not set)' && (
                                <button
                                  type="button"
                                  onClick={() => copyWithFeedback(`cB-${cookieKey}`, valB)}
                                  aria-label={`Copy prod cookie ${cookieKey}`}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-opacity"
                                >
                                  {copiedCellKey === `cB-${cookieKey}` ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                          {isDiff ? (
                            <button
                              type="button"
                              onClick={() => onToggleAcceptCookie(cookieKey)}
                              data-testid={`accept-cookie-${cookieKey}`}
                              className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium cursor-pointer ${
                                isAccepted
                                  ? 'border-border bg-muted text-muted-foreground hover:text-foreground'
                                  : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                              }`}
                            >
                              {isAccepted ? (
                                <>
                                  <Undo2 className="h-3 w-3" /> Undo
                                </>
                              ) : (
                                <>
                                  <Check className="h-3 w-3" /> Accept
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              Match
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleCookieKeys.length === 0 && (
                    <tr>
                      <td
                        colSpan={compareMode === 'compare' ? 4 : 3}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        {cookieKeys.length === 0
                          ? 'No Set-Cookie headers recorded on this endpoint.'
                          : 'No cookies match the active filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'image' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
                <div className="inline-flex h-8 items-center rounded-md border border-border bg-background p-0.5 text-[11px] shrink-0">
                  {(
                    [
                      { id: 'wipe', label: 'Wipe Slider' },
                      { id: 'side', label: 'Side-by-Side' },
                      { id: 'heatmap', label: 'Diff Box' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setVisualMode(mode.id)}
                      data-testid={`visual-mode-${mode.id}`}
                      className={`h-7 rounded px-2.5 font-medium whitespace-nowrap cursor-pointer ${
                        visualMode === mode.id
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 text-xs min-w-0 truncate">
                  <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-semibold text-foreground shrink-0">{safeArea}:</span>
                  <span className="text-muted-foreground truncate" title={humanSummary}>
                    {humanSummary}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden xl:inline font-mono text-[11px] text-muted-foreground">
                  {DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel} ·{' '}
                  {visualVerdict.toUpperCase()}
                </span>

                <button
                  type="button"
                  onClick={() => onRunAiJudge(item.testId)}
                  disabled={isAiRunning}
                  data-testid="btn-run-ai-judge"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 whitespace-nowrap cursor-pointer"
                >
                  <Sparkles
                    className={`h-3.5 w-3.5 text-primary ${
                      isAiRunning ? 'animate-pulse' : ''
                    }`}
                  />
                  <span>{isAiRunning ? 'Analyzing…' : 'Run AI Judge'}</span>
                </button>

                {(hasVisualDiff || visualVerdict !== 'same' || isVisualAccepted) && (
                  <button
                    type="button"
                    onClick={() => onToggleAcceptVisual(item.testId, driftingVisualParamIds)}
                    data-testid="btn-accept-visual"
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                      isVisualAccepted
                        ? 'border-border bg-muted text-muted-foreground hover:text-foreground'
                        : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                    }`}
                  >
                    {isVisualAccepted ? (
                      <>
                        <Undo2 className="h-3.5 w-3.5" /> Undo All
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" /> Accept All
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted cursor-pointer"
                  aria-label="Expand screenshots"
                >
                  <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Dynamic Page-Specific AI Visual Validation Parameters Panel */}
            <div
              data-testid="ai-itemized-analysis-panel"
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    AI-Derived Page Validation Parameters
                  </span>
                  <span className="font-mono text-[11px] text-primary font-medium">
                    {DEFAULT_TEMPLATE_CONFIG.infrastructure.visualJudgeModel}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    · {itemizedFindings.filter((f) => f.severity === 'major').length} major ·{' '}
                    {itemizedFindings.filter((f) => f.severity === 'minor').length} minor ·{' '}
                    {itemizedFindings.filter((f) => f.severity === 'match').length} matched
                    {driftingVisualParamIds.length > 0 && acceptedParamSet.size > 0
                      ? ` · ${driftingVisualParamIds.filter((id) => acceptedParamSet.has(id)).length}/${driftingVisualParamIds.length} accepted`
                      : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {activeMeasuredDiff && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      Live Pixel Verified
                    </span>
                  )}
                  <span
                    data-testid="visual-overall-drift-pct"
                    className={
                      effectivePixelDiff > 5
                        ? 'font-semibold text-rose-600 dark:text-rose-400'
                        : effectivePixelDiff > 0.1
                        ? 'font-semibold text-amber-600 dark:text-amber-400'
                        : ''
                    }
                  >
                    Overall Drift: {effectivePixelDiff.toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 w-56">AI Validation Parameter</th>
                      <th className="px-2.5 py-2 w-24">Verdict</th>
                      <th className="px-3 py-2">Candidate ({candidateLabel})</th>
                      {compareMode === 'compare' && (
                        <th className="px-3 py-2">Baseline ({baselineLabel})</th>
                      )}
                      <th className="px-3 py-2">AI Finding & Layout Impact</th>
                      {compareMode === 'compare' && (
                        <th className="px-3 py-2 w-24 text-right">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {itemizedFindings.map((finding, idx) => {
                      const isDrifting = finding.severity !== 'match';
                      const isParamAccepted = isDrifting && acceptedParamSet.has(finding.id);

                      const badgeClass = isParamAccepted
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : finding.severity === 'major'
                        ? 'text-rose-600 dark:text-rose-400'
                        : finding.severity === 'minor'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400';
                      const badgeLabel = isParamAccepted
                        ? 'ACCEPTED'
                        : finding.severity === 'major'
                        ? 'DIFFERENT'
                        : finding.severity === 'minor'
                        ? 'MINOR'
                        : 'MATCH';

                      const isZoneHighlighted = highlightedZoneIndex === idx;

                      return (
                        <tr
                          key={finding.id || idx}
                          data-testid={`ai-itemized-row-${idx + 1}`}
                          onMouseEnter={() => setHighlightedZoneIndex(idx)}
                          onMouseLeave={() => setHighlightedZoneIndex(null)}
                          onClick={() =>
                            setHighlightedZoneIndex((prev) => (prev === idx ? null : idx))
                          }
                          className={`transition-colors cursor-pointer ${
                            isZoneHighlighted
                              ? 'bg-primary/10'
                              : isParamAccepted
                              ? 'bg-muted/25 opacity-80 hover:opacity-100'
                              : finding.severity === 'major'
                              ? 'bg-rose-500/[0.04] hover:bg-muted/40'
                              : 'hover:bg-muted/35'
                          }`}
                        >
                          <td className="px-3 py-2 align-top font-medium text-foreground">
                            <div className="flex items-start gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground tabular-nums mt-0.5">
                                #{idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="leading-snug">{finding.region}</div>
                                {finding.rationale && (
                                  <div className="mt-0.5 text-[10px] font-normal text-muted-foreground leading-tight">
                                    {finding.rationale}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2.5 py-2 align-top whitespace-nowrap">
                            <span
                              className={`font-mono text-[11px] font-semibold ${badgeClass}`}
                            >
                              {badgeLabel}
                            </span>
                            {finding.zoneDeltaPct > 0 && (
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                                {finding.zoneDeltaPct.toFixed(1)}% drift
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-foreground/90 leading-snug">
                            {finding.stagingObservation}
                          </td>
                          {compareMode === 'compare' && (
                            <td className="px-3 py-2 align-top text-xs text-foreground/90 leading-snug">
                              {finding.prodObservation}
                            </td>
                          )}
                          <td className="px-3 py-2 align-top text-xs leading-snug">
                            <div className="font-medium text-foreground">
                              {finding.description}
                            </div>
                            {finding.impact && (
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                Impact: {finding.impact}
                              </div>
                            )}
                          </td>
                          {compareMode === 'compare' && (
                            <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                              {isDrifting ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleAcceptVisualParam) {
                                      onToggleAcceptVisualParam(
                                        item.testId,
                                        finding.id,
                                        driftingVisualParamIds
                                      );
                                    } else {
                                      onToggleAcceptVisual(item.testId, driftingVisualParamIds);
                                    }
                                  }}
                                  data-testid={`accept-visual-param-${finding.id}`}
                                  className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium cursor-pointer ${
                                    isParamAccepted
                                      ? 'border-border bg-muted text-muted-foreground hover:text-foreground'
                                      : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                                  }`}
                                >
                                  {isParamAccepted ? (
                                    <>
                                      <Undo2 className="h-3 w-3" /> Undo
                                    </>
                                  ) : (
                                    <>
                                      <Check className="h-3 w-3" /> Accept
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  Match
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {compareMode === 'compare' &&
                driftingVisualParamIds.length > 0 &&
                unacceptedDriftParamCount === 0 && (
                  <div className="border-t border-emerald-500/20 bg-emerald-500/5 px-3.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                    <span>
                      All {driftingVisualParamIds.length} drifting AI parameters accepted for{' '}
                      {item.testId} — visual gate cleared.
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggleAcceptVisual(item.testId, driftingVisualParamIds)}
                      className="font-medium underline hover:opacity-80 cursor-pointer"
                    >
                      Undo All
                    </button>
                  </div>
                )}
            </div>

            {visualMode === 'wipe' && (
              <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                  <span>Staging ({candidateLabel})</span>
                  <span>Split: {wipePercent}%</span>
                  <span>Prod ({baselineLabel})</span>
                </div>

                {isSideAUnavailable || isSideBUnavailable ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {isSideAUnavailable ? (
                      <div
                        data-testid="screenshot-retry-card-A"
                        className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center"
                      >
                        <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                        <div className="text-xs font-semibold text-foreground">
                          Staging Live Screenshot Unavailable (HTTP {cand.actualStatus})
                        </div>
                        <p className="mt-1 max-w-md text-[11px] text-muted-foreground">
                          {cand.actualStatus >= 400
                            ? `Endpoint returned HTTP ${cand.actualStatus}. Dummy or synthetic mock fallback images are disabled.`
                            : 'Live Chromium screenshot was not captured or failed to load from the artifact store. Dummy/mock images are never shown.'}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            data-testid="btn-retry-screenshot-A"
                            disabled={isRerunningThis}
                            onClick={() => {
                              setFallbackStageA(0);
                              setRetryNonceA(Date.now());
                              onRerunCheck(item.testId);
                            }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
                          >
                            <RotateCw className={`h-3.5 w-3.5 ${isRerunningThis ? 'animate-spin' : ''}`} />
                            {isRerunningThis ? 'Capturing Live DOM…' : 'Retry Live Capture'}
                          </button>
                          <button
                            type="button"
                            data-testid="btn-reload-image-A"
                            onClick={() => {
                              setFallbackStageA(0);
                              setRetryNonceA(Date.now());
                            }}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Reload Image
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative aspect-[16/9.5] w-full overflow-hidden rounded-md border border-border bg-muted">
                        <img
                          src={sideAConsentImg}
                          alt={`${item.testName} Staging candidate`}
                          data-testid="dom-snapshot-img-A"
                          crossOrigin={sideAConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                          decoding="sync"
                          fetchPriority="high"
                          onError={handleImgErrorA}
                          className="h-full w-full object-cover object-top"
                        />
                      </div>
                    )}

                    {isSideBUnavailable ? (
                      <div
                        data-testid="screenshot-retry-card-B"
                        className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center"
                      >
                        <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                        <div className="text-xs font-semibold text-foreground">
                          Production Live Screenshot Unavailable (HTTP {sideBStatus})
                        </div>
                        <p className="mt-1 max-w-md text-[11px] text-muted-foreground">
                          {sideBStatus >= 400
                            ? `Endpoint returned HTTP ${sideBStatus}. Click Retry Live Capture to re-probe.`
                            : 'Live Chromium screenshot was not captured or failed to load from the artifact store.'}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            data-testid="btn-retry-screenshot-B"
                            disabled={isRerunningThis}
                            onClick={() => {
                              setFallbackStageB(0);
                              setRetryNonceB(Date.now());
                              onRerunCheck(item.testId);
                            }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
                          >
                            <RotateCw className={`h-3.5 w-3.5 ${isRerunningThis ? 'animate-spin' : ''}`} />
                            {isRerunningThis ? 'Capturing Live DOM…' : 'Retry Live Capture'}
                          </button>
                          <button
                            type="button"
                            data-testid="btn-reload-image-B"
                            onClick={() => {
                              setFallbackStageB(0);
                              setRetryNonceB(Date.now());
                            }}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Reload Image
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative aspect-[16/9.5] w-full overflow-hidden rounded-md border border-border bg-muted">
                        <img
                          src={sideBConsentImg}
                          alt={`${item.testName} Production baseline`}
                          data-testid="dom-snapshot-img-B"
                          crossOrigin={sideBConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                          decoding="sync"
                          fetchPriority="high"
                          onError={handleImgErrorB}
                          className="h-full w-full object-cover object-top"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="relative aspect-[16/9.5] w-full overflow-hidden rounded-md border border-border bg-muted">
                      <img
                        src={sideBConsentImg}
                        alt={`${item.testName} Production baseline`}
                        data-testid="dom-snapshot-img-B"
                        crossOrigin={sideBConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                        decoding="sync"
                        fetchPriority="high"
                        onError={handleImgErrorB}
                        className="h-full w-full object-cover object-top"
                      />
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ clipPath: `inset(0 ${100 - wipePercent}% 0 0)` }}
                      >
                        <img
                          src={sideAConsentImg}
                          alt={`${item.testName} Staging candidate`}
                          data-testid="dom-snapshot-img-A"
                          crossOrigin={sideAConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                          decoding="sync"
                          fetchPriority="high"
                          onError={handleImgErrorA}
                          className="h-full w-full object-cover object-top"
                        />
                      </div>
                      <div
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary shadow"
                        style={{ left: `${wipePercent}%` }}
                      />
                    </div>

                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={wipePercent}
                      onChange={(e) => setWipePercent(Number(e.target.value))}
                      aria-label="Visual comparison wipe slider"
                      className="w-full accent-primary cursor-ew-resize"
                    />
                  </>
                )}
              </div>
            )}

            {visualMode === 'side' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span>Staging ({candidateLabel})</span>
                    <span>HTTP {cand.actualStatus}</span>
                  </div>
                  {isSideAUnavailable ? (
                    <div
                      data-testid="screenshot-retry-card-A"
                      className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded border border-dashed border-border bg-muted/30 p-5 text-center"
                    >
                      <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                      <div className="text-xs font-semibold text-foreground">
                        Staging Live Screenshot Unavailable (HTTP {cand.actualStatus})
                      </div>
                      <p className="mt-1 max-w-md text-[11px] text-muted-foreground">
                        {cand.actualStatus >= 400
                          ? `Endpoint returned HTTP ${cand.actualStatus}. Dummy or synthetic mock fallback images are disabled.`
                          : 'Live Chromium screenshot was not captured or failed to load from the artifact store. Dummy/mock images are never shown.'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          data-testid="btn-retry-screenshot-A"
                          disabled={isRerunningThis}
                          onClick={() => {
                            setFallbackStageA(0);
                            setRetryNonceA(Date.now());
                            onRerunCheck(item.testId);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
                        >
                          <RotateCw className={`h-3.5 w-3.5 ${isRerunningThis ? 'animate-spin' : ''}`} />
                          {isRerunningThis ? 'Capturing Live DOM…' : 'Retry Live Capture'}
                        </button>
                        <button
                          type="button"
                          data-testid="btn-reload-image-A"
                          onClick={() => {
                            setFallbackStageA(0);
                            setRetryNonceA(Date.now());
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Reload Image
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative aspect-[16/9.5] w-full overflow-hidden rounded border border-border">
                      <img
                        src={sideAConsentImg}
                        alt={`${item.testName} Staging`}
                        data-testid="dom-snapshot-img-A"
                        crossOrigin={sideAConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                        decoding="sync"
                        fetchPriority="high"
                        onError={handleImgErrorA}
                        className="h-full w-full object-cover object-top"
                      />
                      {activeHighlightedFinding?.box && (
                        <div
                          className={`pointer-events-none absolute border-2 transition-all ${
                            activeHighlightedFinding.severity === 'major'
                              ? 'border-rose-500 bg-rose-500/20'
                              : activeHighlightedFinding.severity === 'minor'
                              ? 'border-amber-500 bg-amber-500/20'
                              : 'border-emerald-500 bg-emerald-500/15'
                          }`}
                          style={{
                            left: `${activeHighlightedFinding.box.x}%`,
                            top: `${activeHighlightedFinding.box.y}%`,
                            width: `${activeHighlightedFinding.box.w}%`,
                            height: `${activeHighlightedFinding.box.h}%`,
                          }}
                        >
                          <span className="inline-block bg-background/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground shadow">
                            #{highlightedZoneIndex! + 1} {activeHighlightedFinding.region} (
                            {activeHighlightedFinding.zoneDeltaPct.toFixed(1)}%)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span>Production ({baselineLabel})</span>
                    <span>HTTP {sideBStatus}</span>
                  </div>
                  {isSideBUnavailable ? (
                    <div
                      data-testid="screenshot-retry-card-B"
                      className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded border border-dashed border-border bg-muted/30 p-5 text-center"
                    >
                      <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                      <div className="text-xs font-semibold text-foreground">
                        Production Live Screenshot Unavailable (HTTP {sideBStatus})
                      </div>
                      <p className="mt-1 max-w-md text-[11px] text-muted-foreground">
                        {sideBStatus >= 400
                          ? `Endpoint returned HTTP ${sideBStatus}. Click Retry Live Capture to re-probe.`
                          : 'Live Chromium screenshot was not captured or failed to load from the artifact store.'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          data-testid="btn-retry-screenshot-B"
                          disabled={isRerunningThis}
                          onClick={() => {
                            setFallbackStageB(0);
                            setRetryNonceB(Date.now());
                            onRerunCheck(item.testId);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
                        >
                          <RotateCw className={`h-3.5 w-3.5 ${isRerunningThis ? 'animate-spin' : ''}`} />
                          {isRerunningThis ? 'Capturing Live DOM…' : 'Retry Live Capture'}
                        </button>
                        <button
                          type="button"
                          data-testid="btn-reload-image-B"
                          onClick={() => {
                            setFallbackStageB(0);
                            setRetryNonceB(Date.now());
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Reload Image
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative aspect-[16/9.5] w-full overflow-hidden rounded border border-border">
                      <img
                        src={sideBConsentImg}
                        alt={`${item.testName} Production`}
                        data-testid="dom-snapshot-img-B"
                        crossOrigin={sideBConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                        decoding="sync"
                        fetchPriority="high"
                        onError={handleImgErrorB}
                        className="h-full w-full object-cover object-top"
                      />
                      {activeHighlightedFinding?.box && (
                        <div
                          className={`pointer-events-none absolute border-2 transition-all ${
                            activeHighlightedFinding.severity === 'major'
                              ? 'border-rose-500 bg-rose-500/20'
                              : activeHighlightedFinding.severity === 'minor'
                              ? 'border-amber-500 bg-amber-500/20'
                              : 'border-emerald-500 bg-emerald-500/15'
                          }`}
                          style={{
                            left: `${activeHighlightedFinding.box.x}%`,
                            top: `${activeHighlightedFinding.box.y}%`,
                            width: `${activeHighlightedFinding.box.w}%`,
                            height: `${activeHighlightedFinding.box.h}%`,
                          }}
                        >
                          <span className="inline-block bg-background/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground shadow">
                            #{highlightedZoneIndex! + 1} {activeHighlightedFinding.region}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {visualMode === 'heatmap' && (
              <div className="rounded-lg border border-border bg-card p-3.5">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-muted-foreground">
                  <div className="flex items-center gap-2.5">
                    <span>RGBA Pixel Diff & Multi-Zone Overlay</span>
                    <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
                      <button
                        type="button"
                        data-testid="heatmap-submode-pixel"
                        onClick={() => setHeatmapOverlayMode('pixel-heatmap')}
                        className={`rounded px-2 py-0.5 font-sans font-medium cursor-pointer ${
                          heatmapOverlayMode === 'pixel-heatmap'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Pixel Heatmap
                      </button>
                      <button
                        type="button"
                        data-testid="heatmap-submode-zones"
                        onClick={() => setHeatmapOverlayMode('zone-boxes')}
                        className={`rounded px-2 py-0.5 font-sans font-medium cursor-pointer ${
                          heatmapOverlayMode === 'zone-boxes'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Staging + Zone Boxes
                      </button>
                    </div>
                  </div>
                  <span>
                    {diffBox
                      ? `Bounding Box (${diffBox.x}%, ${diffBox.y}%) · ${diffBox.w}% × ${diffBox.h}% · ${effectivePixelDiff.toFixed(2)}% pixel delta`
                      : '0.00% pixel delta — Visually identical'}
                  </span>
                </div>
                {isSideAUnavailable ? (
                  <div
                    data-testid="screenshot-retry-card-A"
                    className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center"
                  >
                    <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                    <div className="text-xs font-semibold text-foreground">
                      Staging Live Screenshot Unavailable (HTTP {cand.actualStatus})
                    </div>
                    <p className="mt-1 max-w-md text-[11px] text-muted-foreground">
                      Live Chromium screenshot was not captured or failed to load. Click Retry Live Capture to re-probe.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="btn-retry-screenshot-A"
                        disabled={isRerunningThis}
                        onClick={() => {
                          setFallbackStageA(0);
                          setRetryNonceA(Date.now());
                          onRerunCheck(item.testId);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
                      >
                        <RotateCw className={`h-3.5 w-3.5 ${isRerunningThis ? 'animate-spin' : ''}`} />
                        {isRerunningThis ? 'Capturing Live DOM…' : 'Retry Live Capture'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative aspect-[16/9.5] w-full overflow-hidden rounded-md border border-border bg-muted">
                    <img
                      src={
                        heatmapOverlayMode === 'pixel-heatmap' && heatmapDataUrl
                          ? heatmapDataUrl
                          : sideAConsentImg
                      }
                      alt={`${item.testName} diff overlay`}
                      data-testid="dom-snapshot-heatmap-img"
                      crossOrigin={
                        (heatmapOverlayMode === 'pixel-heatmap' && heatmapDataUrl) ||
                        sideAConsentImg.startsWith('data:')
                          ? undefined
                          : 'anonymous'
                      }
                      decoding="sync"
                      onError={handleImgErrorA}
                      className="h-full w-full object-cover object-top"
                    />
                    {diffBox && effectivePixelDiff > 0.1 && (
                      <div
                        data-testid="overall-diff-bounding-box"
                        className="pointer-events-none absolute border-2 border-dashed border-rose-500/80 bg-rose-500/5"
                        style={{
                          left: `${diffBox.x}%`,
                          top: `${diffBox.y}%`,
                          width: `${diffBox.w}%`,
                          height: `${diffBox.h}%`,
                        }}
                      />
                    )}
                    {itemizedFindings.map((finding, idx) => {
                      const isSelected = highlightedZoneIndex === idx;
                      if (finding.severity === 'match' && !isSelected) return null;
                      const b = finding.box;
                      if (!b) return null;
                      const boxColor =
                        finding.severity === 'major'
                          ? 'border-rose-500 bg-rose-500/15'
                          : finding.severity === 'minor'
                          ? 'border-amber-500 bg-amber-500/15'
                          : 'border-emerald-500 bg-emerald-500/15';
                      return (
                        <div
                          key={finding.id || idx}
                          data-testid={`heatmap-zone-box-${idx + 1}`}
                          className={`pointer-events-none absolute border-2 transition-all ${boxColor} ${
                            isSelected ? 'ring-2 ring-primary z-10' : ''
                          }`}
                          style={{
                            left: `${b.x}%`,
                            top: `${b.y}%`,
                            width: `${b.w}%`,
                            height: `${b.h}%`,
                          }}
                        >
                          <span className="inline-block bg-background/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground shadow">
                            #{idx + 1} {finding.region} ({finding.zoneDeltaPct.toFixed(1)}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'flow' && (
          <div className="space-y-4">
            {stepResults.length > 0 && (
              <div
                data-testid="inspector-tx-steps"
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Multi-Step Transaction Waterfall ({stepResults.length} steps)</span>
                  <span className="font-mono text-foreground">
                    {typeMeta.defaultMonitor}
                  </span>
                </div>
                <div className="divide-y divide-border/60 font-mono text-xs">
                  {stepResults.map((s) => (
                    <div
                      key={s.step}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-primary">#{s.step}</span>
                          <span className="font-semibold text-foreground">{s.action}</span>
                          <span className="text-muted-foreground truncate">{s.target}</span>
                        </div>
                        {s.detail && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {s.detail}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0 tabular-nums">
                        <span className="text-muted-foreground">{s.durationMs}ms</span>
                        <span
                          className={`font-semibold ${
                            s.status === 'pass'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {s.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(cand.scriptResult || testDef?.customScript?.trim()) && (
              <div
                data-testid="inspector-script-panel"
                className="rounded-lg border border-border bg-card p-3.5 text-xs space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Programmable Script Execution ({getScriptEngineMeta(cand.scriptResult?.engine || testDef?.scriptEngine || 'playwright').label})
                  </div>
                  {cand.scriptResult && (
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-muted-foreground">
                        {cand.scriptResult.executionMode === 'real-chromium-playwright'
                          ? 'Real Headless Chromium'
                          : 'Emulated Script Runner'}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums text-foreground">
                        {cand.scriptResult.durationMs}ms
                      </span>
                      <span>·</span>
                      <span
                        className={`font-semibold ${
                          cand.scriptResult.passed
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {cand.scriptResult.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                  )}
                </div>

                {cand.scriptResult?.metrics && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-[11px]">
                    {cand.scriptResult.pageTitle && (
                      <div className="col-span-2">
                        <div className="text-muted-foreground">Page Title</div>
                        <div className="text-foreground truncate">
                          {cand.scriptResult.pageTitle}
                        </div>
                      </div>
                    )}
                    {cand.scriptResult.metrics.domContentLoadedMs !== undefined && (
                      <div>
                        <div className="text-muted-foreground">DOMContentLoaded</div>
                        <div className="text-foreground tabular-nums">
                          {cand.scriptResult.metrics.domContentLoadedMs}ms
                        </div>
                      </div>
                    )}
                    {cand.scriptResult.metrics.loadEventMs !== undefined && (
                      <div>
                        <div className="text-muted-foreground">Load Event</div>
                        <div className="text-foreground tabular-nums">
                          {cand.scriptResult.metrics.loadEventMs}ms
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {cand.scriptResult?.error && (
                  <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 font-mono text-[11px] text-rose-700 dark:text-rose-300">
                    {cand.scriptResult.error}
                  </div>
                )}

                {cand.scriptResult && cand.scriptResult.consoleLogs.length > 0 && (
                  <div
                    data-testid="inspector-script-console"
                    className="rounded bg-muted/60 p-2.5 font-mono text-[11px] text-foreground space-y-0.5 max-h-36 overflow-y-auto"
                  >
                    {cand.scriptResult.consoleLogs.map((line, i) => (
                      <div key={i} className="break-all">
                        {line}
                      </div>
                    ))}
                  </div>
                )}

                {testDef?.customScript?.trim() && (
                  <details data-testid="inspector-script-source" className="pt-1">
                    <summary className="cursor-pointer font-mono text-[11px] text-primary hover:underline">
                      View Executed Test Script Source ({testDef.customScript.trim().split('\n').length} lines)
                    </summary>
                    <pre className="mt-1.5 max-h-60 overflow-auto rounded bg-muted/60 p-2.5 font-mono text-[11px] text-foreground whitespace-pre">
                      {testDef.customScript}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {cand.sslResult && (
              <div
                data-testid="inspector-ssl-panel"
                className="rounded-lg border border-border bg-card p-3.5 text-xs space-y-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  X.509 SSL / TLS Handshake Inspection
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 font-mono text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Subject</div>
                    <div className="text-foreground break-all">{cand.sslResult.subject}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Issuer CA</div>
                    <div className="text-foreground break-all">{cand.sslResult.issuer}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Expiry & SANs</div>
                    <div className="text-foreground tabular-nums">
                      {cand.sslResult.daysRemaining}d left · {cand.sslResult.sanCount} SANs
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">TLS Protocol</div>
                    <div className="text-foreground">{cand.sslResult.tlsProtocol}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-muted-foreground">Cipher Suite</div>
                    <div className="text-foreground break-all">{cand.sslResult.cipher}</div>
                  </div>
                </div>
              </div>
            )}

            {cand.dnsResult && (
              <div
                data-testid="inspector-dns-panel"
                className="rounded-lg border border-border bg-card p-3.5 text-xs space-y-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  DNS & DNSSEC Query Telemetry
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Record</div>
                    <div className="text-foreground font-semibold">{cand.dnsResult.recordType}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Resolver</div>
                    <div className="text-foreground">{cand.dnsResult.server}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Query Time</div>
                    <div className="text-foreground tabular-nums">{cand.dnsResult.queryMs}ms</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">DNSSEC</div>
                    <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {cand.dnsResult.dnssecValid ? 'VALIDATED' : 'UNSIGNED'}
                    </div>
                  </div>
                </div>
                <div className="rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground break-all">
                  {cand.dnsResult.answers.join(' · ')}
                </div>
              </div>
            )}

            {cand.networkResult && (
              <div
                data-testid="inspector-network-panel"
                className="rounded-lg border border-border bg-card p-3.5 text-xs space-y-2"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Network Socket & BGP Telemetry
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Protocol / Port</div>
                    <div className="text-foreground">
                      {cand.networkResult.protocol} :{cand.networkResult.port}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">TCP Handshake</div>
                    <div className="text-foreground tabular-nums">
                      {cand.networkResult.tcpHandshakeMs}ms
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">BGP Prefix</div>
                    <div className="text-foreground">{cand.networkResult.bgpPrefix || '—'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Origin ASN</div>
                    <div className="text-foreground">{cand.networkResult.bgpOriginAsn || '—'}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[
                {
                  label: `Staging (${candidateLabel})`,
                  result: cand,
                  fallbackEdge: 'edgekey-staging.net',
                },
                ...(compareMode === 'compare' && base
                  ? [
                      {
                        label: `Production (${baselineLabel})`,
                        result: base,
                        fallbackEdge: 'edgekey.net',
                      },
                    ]
                  : []),
              ].map((side) => (
                <div
                  key={side.label}
                  className="rounded-lg border border-border bg-card p-3.5 text-xs"
                >
                  <div className="font-semibold text-foreground">{side.label}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground space-y-0.5 tabular-nums">
                    <div>Edge: {side.result.edgeHostname || side.fallbackEdge}</div>
                    <div>Edge IP: {side.result.stagingEdgeIp || '—'}</div>
                    <div>
                      Total Duration:{' '}
                      <span className="font-semibold text-foreground">
                        {side.result.httpFlowSummary?.totalDurationMs ?? side.result.durationMs}ms
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(side.result.redirectChain || []).map((hop, idx) => {
                      const t = hop.timings;
                      const sumMs = t
                        ? Math.max(1, t.dnsMs + t.tcpMs + t.tlsMs + t.ttfbMs)
                        : 1;
                      return (
                        <div
                          key={hop.hopNumber ?? idx}
                          className="rounded-md border border-border bg-background p-2.5 font-mono text-[11px] space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground">
                              Hop {hop.hopNumber ?? idx + 1} · HTTP {hop.status}
                            </span>
                            <span className="tabular-nums font-semibold">{hop.durationMs}ms</span>
                          </div>
                          <div className="text-muted-foreground truncate">{hop.url}</div>
                          {t && (
                            <>
                              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="bg-sky-500"
                                  style={{ width: `${(t.dnsMs / sumMs) * 100}%` }}
                                  title={`DNS ${t.dnsMs}ms`}
                                />
                                <div
                                  className="bg-amber-500"
                                  style={{ width: `${(t.tcpMs / sumMs) * 100}%` }}
                                  title={`TCP ${t.tcpMs}ms`}
                                />
                                <div
                                  className="bg-indigo-500"
                                  style={{ width: `${(t.tlsMs / sumMs) * 100}%` }}
                                  title={`TLS ${t.tlsMs}ms`}
                                />
                                <div
                                  className="bg-emerald-500"
                                  style={{ width: `${(t.ttfbMs / sumMs) * 100}%` }}
                                  title={`TTFB ${t.ttfbMs}ms`}
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground tabular-nums">
                                <span className="inline-flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                                  DNS {t.dnsMs}ms
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                  TCP {t.tcpMs}ms
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                  TLS {t.tlsMs}ms
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  TTFB {t.ttfbMs}ms
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Zero-Secret Reproduction (curl --resolve)
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Pinned to the exact Akamai edge IP for local debugging — auth headers and session cookies are redacted.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(curlSnippet);
                    setCopiedCurl(true);
                    setTimeout(() => setCopiedCurl(false), 1800);
                  }}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedCurl ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-muted/60 p-2.5 font-mono text-[11px] text-foreground">
                {curlSnippet}
              </pre>
            </div>

            {cand.responseBodySnippet && (
              <details className="rounded-lg border border-border bg-card p-3.5 text-xs">
                <summary className="cursor-pointer font-semibold text-foreground">
                  Live Captured Response Body Snippet ({cand.responseBodySnippet.length} chars)
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/60 p-2.5 font-mono text-[11px] text-foreground whitespace-pre-wrap break-all">
                  {cand.responseBodySnippet.slice(0, 4000)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="w-full max-w-6xl rounded-lg border border-border bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-sm font-semibold text-foreground">
                {item.testId} · {item.testName}
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted cursor-pointer"
                aria-label="Close lightbox"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-mono text-muted-foreground">
                  Staging ({candidateLabel})
                </div>
                {isSideAUnavailable ? (
                  <div className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded border border-dashed border-border bg-muted/30 p-6 text-center">
                    <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                    <div className="text-xs font-semibold text-foreground">
                      Staging Live Screenshot Unavailable
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFallbackStageA(0);
                        setRetryNonceA(Date.now());
                        onRerunCheck(item.testId);
                      }}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Retry Live Capture
                    </button>
                  </div>
                ) : (
                  <img
                    src={sideAConsentImg}
                    alt="Staging full preview"
                    crossOrigin={sideAConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                    decoding="sync"
                    onError={handleImgErrorA}
                    className="w-full rounded border border-border"
                  />
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-mono text-muted-foreground">
                  Production ({baselineLabel})
                </div>
                {isSideBUnavailable ? (
                  <div className="flex aspect-[16/9.5] w-full flex-col items-center justify-center rounded border border-dashed border-border bg-muted/30 p-6 text-center">
                    <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
                    <div className="text-xs font-semibold text-foreground">
                      Production Live Screenshot Unavailable
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFallbackStageB(0);
                        setRetryNonceB(Date.now());
                        onRerunCheck(item.testId);
                      }}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Retry Live Capture
                    </button>
                  </div>
                ) : (
                  <img
                    src={sideBConsentImg}
                    alt="Production full preview"
                    crossOrigin={sideBConsentImg.startsWith('data:') ? undefined : 'anonymous'}
                    decoding="sync"
                    onError={handleImgErrorB}
                    className="w-full rounded border border-border"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
