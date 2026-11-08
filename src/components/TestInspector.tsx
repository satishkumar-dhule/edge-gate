import React, { useState } from 'react';
import { ComparisonItem, TestResult } from '../engine/types';
import { generateReproduceCurl } from '../engine/rules';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';
import { Switch } from './ui/switch';
import {
  RotateCw,
  Terminal,
  Check,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export type InspectorDimension = 'headers' | 'cookies' | 'image';

// ============================================================================
// SHARED REUSABLE PRIMITIVE 1: INSPECTOR HEADER (USED BY DIFF & SINGLE RUN)
// ============================================================================
export const InspectorActionHeader: React.FC<{
  testId: string;
  testName: string;
  subtitle: string;
  statusBadge?: { pass: boolean; status: number; durationMs: number };
  isRerunning: boolean;
  onRerun: () => void;
  curlTarget?: TestResult;
}> = ({
  testId,
  testName,
  subtitle,
  statusBadge,
  isRerunning,
  onRerun,
  curlTarget,
}) => {
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleCopyCurl = () => {
    if (!curlTarget) return;
    const curl = generateReproduceCurl(curlTarget);
    navigator.clipboard.writeText(curl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <CardHeader className="border-b border-border bg-muted/20 py-2.5 px-4 flex flex-row items-center justify-between space-y-0 gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-mono text-[11px] px-1.5 py-0">
            {testId}
          </Badge>
          <CardTitle className="truncate text-sm">{testName}</CardTitle>
          {statusBadge && (
            <>
              <Badge
                variant={statusBadge.pass ? 'success' : 'destructive'}
                className="font-mono text-[10px] py-0"
              >
                HTTP {statusBadge.status}
              </Badge>
              <span className="text-[11px] font-mono text-muted-foreground">
                {statusBadge.durationMs}ms
              </span>
            </>
          )}
        </div>
        <CardDescription className="font-mono text-[11px] truncate mt-0.5">
          {subtitle}
        </CardDescription>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="outline"
          size="xs"
          onClick={onRerun}
          disabled={isRerunning}
        >
          <RotateCw className={`!size-3 ${isRerunning ? 'animate-spin' : ''}`} />
          {isRerunning ? 'Rerunning…' : 'Rerun Test'}
        </Button>

        {curlTarget && (
          <Button
            variant="outline"
            size="xs"
            onClick={handleCopyCurl}
            title="Copy cURL command for edge reproduction"
          >
            {copiedCurl ? (
              <Check className="text-emerald-600 dark:text-emerald-400 !size-3" />
            ) : (
              <Terminal className="text-muted-foreground !size-3" />
            )}
            {copiedCurl ? 'Copied' : 'cURL'}
          </Button>
        )}
      </div>
    </CardHeader>
  );
};

// ============================================================================
// SHARED REUSABLE PRIMITIVE 2: DOM SNAPSHOT PREVIEW CARD
// ============================================================================
export const DomSnapshotCard: React.FC<{
  title: string;
  metaRight: string;
  url?: string;
  highlightDiff?: boolean;
  overlayText?: string;
  footerLeft?: string;
  footerRight?: string;
}> = ({
  title,
  metaRight,
  url,
  highlightDiff,
  overlayText,
  footerLeft,
  footerRight,
}) => (
  <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-2">
    <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
      <span className="font-semibold text-foreground">{title}</span>
      <span>{metaRight}</span>
    </div>

    <div className="bg-background border border-border rounded p-3 h-36 flex flex-col justify-between">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-16 h-2 bg-foreground rounded-xs shrink-0" />
          {url && (
            <span className="font-mono text-[10px] text-muted-foreground truncate">
              {url}
            </span>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <div className="w-6 h-1.5 bg-muted rounded-xs" />
          <div className="w-6 h-1.5 bg-muted rounded-xs" />
        </div>
      </div>

      <div
        className={`rounded p-2.5 border transition-all ${
          highlightDiff
            ? 'bg-amber-500/10 border-amber-500/40'
            : 'bg-muted/20 border-border'
        }`}
      >
        <div className="w-32 h-2 bg-muted-foreground/40 rounded-xs mb-1.5" />
        <div className="w-48 h-2 bg-muted rounded-xs" />
        {overlayText && (
          <div className="mt-1.5 px-1.5 py-0.5 bg-amber-500/20 border border-amber-500/40 rounded-xs text-[10px] font-mono text-amber-800 dark:text-amber-300 inline-block">
            {overlayText}
          </div>
        )}
      </div>

      {footerLeft || footerRight ? (
        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>{footerLeft}</span>
          <span>{footerRight}</span>
        </div>
      ) : (
        <div className="w-full h-1.5 bg-muted/50 rounded-xs" />
      )}
    </div>
  </div>
);

// ============================================================================
// COMPARATIVE 3-DIMENSION TEST INSPECTOR (DIFF VIEW)
// ============================================================================
interface TestInspectorProps {
  item: ComparisonItem;
  activeTab: InspectorDimension;
  onTabChange: (tab: InspectorDimension) => void;
  candidateLabel: string;
  baselineLabel: string;
  isRerunningTest: boolean;
  isRunningAi: boolean;
  onRerunSingleTest: (testId: string) => void;
  onRunAiVisualJudge: (testId: string) => void;
  onToggleAcceptHeader: (field: string) => void;
  acceptedFields: string[];
  onToggleAcceptCookie: (cookieName: string) => void;
  acceptedCookies: string[];
  onToggleAcceptVisual: (testId: string) => void;
  acceptedVisualTests: string[];
  ignoreAcceptedDiffs: boolean;
}

export const TestInspector: React.FC<TestInspectorProps> = ({
  item,
  activeTab,
  onTabChange,
  candidateLabel,
  baselineLabel,
  isRerunningTest,
  isRunningAi,
  onRerunSingleTest,
  onRunAiVisualJudge,
  onToggleAcceptHeader,
  acceptedFields,
  onToggleAcceptCookie,
  acceptedCookies,
  onToggleAcceptVisual,
  acceptedVisualTests,
  ignoreAcceptedDiffs,
}) => {
  const [showDiffOverlay, setShowDiffOverlay] = useState(true);
  const [diffsOnly, setDiffsOnly] = useState(false);

  const cand = item.candidateResult;
  const base = item.baselineResult;

  const isVisualAccepted = acceptedVisualTests.includes(item.testId);
  const rawVisualDiff =
    item.visualResult?.verdict === 'minor' ||
    item.visualResult?.verdict === 'different' ||
    (item.visualResult?.differences?.length ?? 0) > 0;
  const hasVisualDiff =
    rawVisualDiff && !(ignoreAcceptedDiffs && isVisualAccepted);

  const rawHeaderDiffCount = item.functionalDiffs.length;
  const headerDiffCount = item.functionalDiffs.filter((d) => {
    const fieldKey = (d.field || d.kind).toLowerCase();
    const isAcc = d.accepted || acceptedFields.includes(fieldKey);
    return ignoreAcceptedDiffs ? !isAcc : true;
  }).length;
  const allHeadersAccepted = rawHeaderDiffCount > 0 && headerDiffCount === 0;

  const normalizeCookieKey = (raw: string) =>
    raw.toLowerCase().replace(/^cookie:/, '').trim();
  const normalizedAcceptedCookies = acceptedCookies.map(normalizeCookieKey);

  const rawCookieDiffCount = (item.cookieDiffs || []).length;
  const cookieDiffCount = (item.cookieDiffs || []).filter((d) => {
    const cookieKey = normalizeCookieKey(d.field || '');
    const isAcc = normalizedAcceptedCookies.includes(cookieKey);
    return ignoreAcceptedDiffs ? !isAcc : true;
  }).length;
  const allCookiesAccepted = rawCookieDiffCount > 0 && cookieDiffCount === 0;

  const allHeaderKeys = Array.from(
    new Set([
      ...Object.keys(cand?.capturedHeaders || {}),
      ...Object.keys(base?.capturedHeaders || {}),
    ])
  )
    .filter((k) => k !== 'x-akamai-request-id')
    .sort((a, b) => {
      const aDiff = item.functionalDiffs.some(
        (d) => (d.field || d.kind).toLowerCase() === a.toLowerCase()
      );
      const bDiff = item.functionalDiffs.some(
        (d) => (d.field || d.kind).toLowerCase() === b.toLowerCase()
      );
      return Number(bDiff) - Number(aDiff);
    });

  const visibleHeaderKeys = diffsOnly
    ? allHeaderKeys.filter((k) =>
        item.functionalDiffs.some(
          (d) => (d.field || d.kind).toLowerCase() === k.toLowerCase()
        )
      )
    : allHeaderKeys;

  const allCookieKeys = Array.from(
    new Set([
      ...Object.keys(cand?.capturedCookies || {}),
      ...Object.keys(base?.capturedCookies || {}),
    ])
  ).sort((a, b) => {
    const aDiff =
      (cand?.capturedCookies?.[a] ?? '') !== (base?.capturedCookies?.[a] ?? '');
    const bDiff =
      (cand?.capturedCookies?.[b] ?? '') !== (base?.capturedCookies?.[b] ?? '');
    return Number(bDiff) - Number(aDiff);
  });

  const visibleCookieKeys = diffsOnly
    ? allCookieKeys.filter(
        (k) =>
          (cand?.capturedCookies?.[k] ?? '') !==
          (base?.capturedCookies?.[k] ?? '')
      )
    : allCookieKeys;

  const statusDiff = cand?.actualStatus !== base?.actualStatus;

  return (
    <Card className="overflow-hidden">
      <InspectorActionHeader
        testId={item.testId}
        testName={item.testName}
        subtitle={item.url}
        isRerunning={isRerunningTest}
        onRerun={() => onRerunSingleTest(item.testId)}
        curlTarget={cand}
      />

      <CardContent className="p-3.5">
        <Tabs
          value={activeTab}
          onValueChange={(v) => onTabChange(v as InspectorDimension)}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
            <TabsList className="h-8">
              <TabsTrigger value="headers" className="gap-1.5 text-xs">
                <span>Headers</span>
                <span
                  className={`font-mono text-[10px] ${
                    headerDiffCount > 0
                      ? 'text-rose-600 dark:text-rose-400 font-bold'
                      : allHeadersAccepted
                      ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                      : 'text-muted-foreground'
                  }`}
                >
                  {headerDiffCount > 0
                    ? `(${headerDiffCount})`
                    : allHeadersAccepted
                    ? '(OK)'
                    : '✓'}
                </span>
              </TabsTrigger>

              <TabsTrigger value="cookies" className="gap-1.5 text-xs">
                <span>Cookies</span>
                <span
                  className={`font-mono text-[10px] ${
                    cookieDiffCount > 0
                      ? 'text-amber-700 dark:text-amber-400 font-bold'
                      : allCookiesAccepted
                      ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                      : 'text-muted-foreground'
                  }`}
                >
                  {cookieDiffCount > 0
                    ? `(${cookieDiffCount})`
                    : allCookiesAccepted
                    ? '(OK)'
                    : '✓'}
                </span>
              </TabsTrigger>

              <TabsTrigger value="image" className="gap-1.5 text-xs">
                <span>Image AI</span>
                <span
                  className={`font-mono text-[10px] ${
                    hasVisualDiff
                      ? 'text-amber-700 dark:text-amber-400 font-bold'
                      : rawVisualDiff && isVisualAccepted
                      ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                      : 'text-muted-foreground'
                  }`}
                >
                  {hasVisualDiff
                    ? '(Diff)'
                    : rawVisualDiff && isVisualAccepted
                    ? '(OK)'
                    : '✓'}
                </span>
              </TabsTrigger>
            </TabsList>

            {activeTab !== 'image' && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Switch checked={diffsOnly} onCheckedChange={setDiffsOnly} />
                <span>Diffs only</span>
              </label>
            )}
          </div>

          {/* TAB 1: FUNCTIONAL HEADERS */}
          <TabsContent value="headers" className="mt-0">
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40 py-2">Header</TableHead>
                    <TableHead className="py-2">Side A ({candidateLabel})</TableHead>
                    <TableHead className="py-2">Side B ({baselineLabel})</TableHead>
                    <TableHead className="text-right w-28 py-2">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  {(!diffsOnly || statusDiff) && (
                    <TableRow className={statusDiff ? 'bg-rose-500/10' : ''}>
                      <TableCell className="py-2 font-medium text-foreground">
                        http-status
                      </TableCell>
                      <TableCell className="py-2">{cand?.actualStatus ?? '—'}</TableCell>
                      <TableCell className="py-2">{base?.actualStatus ?? '—'}</TableCell>
                      <TableCell className="py-2 text-right font-sans">
                        {!statusDiff ? (
                          <span className="text-muted-foreground">Match</span>
                        ) : (
                          <Badge variant="destructive">Diff</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )}

                  {visibleHeaderKeys.map((key) => {
                    const cVal = cand?.capturedHeaders[key] ?? '(not present)';
                    const bVal = base?.capturedHeaders[key] ?? '(not present)';
                    const diffItem = item.functionalDiffs.find(
                      (d) => (d.field || d.kind).toLowerCase() === key.toLowerCase()
                    );
                    const isDiff = Boolean(diffItem);
                    const isAccepted =
                      diffItem?.accepted ||
                      acceptedFields.includes(key.toLowerCase());

                    return (
                      <TableRow
                        key={key}
                        className={
                          isDiff && !isAccepted
                            ? 'bg-rose-500/10'
                            : isDiff && isAccepted
                            ? 'bg-emerald-500/10'
                            : ''
                        }
                      >
                        <TableCell className="py-2 font-medium text-foreground">
                          {key}
                        </TableCell>
                        <TableCell
                          className={`py-2 break-all ${
                            isDiff && !isAccepted
                              ? 'text-rose-700 dark:text-rose-300 font-semibold'
                              : ''
                          }`}
                        >
                          {cVal}
                        </TableCell>
                        <TableCell className="py-2 break-all text-muted-foreground">
                          {bVal}
                        </TableCell>
                        <TableCell className="py-2 text-right font-sans whitespace-nowrap">
                          {isDiff ? (
                            <Button
                              variant={isAccepted ? 'secondary' : 'outline'}
                              size="xs"
                              onClick={() => onToggleAcceptHeader(key)}
                            >
                              {isAccepted ? 'Accepted (Undo)' : 'Accept Diff'}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">Match</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* TAB 2: COOKIES */}
          <TabsContent value="cookies" className="mt-0">
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40 py-2">Cookie</TableHead>
                    <TableHead className="py-2">Side A ({candidateLabel})</TableHead>
                    <TableHead className="py-2">Side B ({baselineLabel})</TableHead>
                    <TableHead className="text-right w-28 py-2">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  {visibleCookieKeys.map((cookieName) => {
                    const cVal = cand?.capturedCookies?.[cookieName] ?? '(not set)';
                    const bVal = base?.capturedCookies?.[cookieName] ?? '(not set)';
                    const isDiff = cVal !== bVal;
                    const isAccepted = normalizedAcceptedCookies.includes(
                      normalizeCookieKey(cookieName)
                    );

                    return (
                      <TableRow
                        key={cookieName}
                        className={
                          isDiff && !isAccepted
                            ? 'bg-amber-500/10'
                            : isDiff && isAccepted
                            ? 'bg-emerald-500/10'
                            : ''
                        }
                      >
                        <TableCell className="py-2 font-medium text-foreground">
                          {cookieName}
                        </TableCell>
                        <TableCell
                          className={`py-2 break-all ${
                            isDiff && !isAccepted
                              ? 'text-amber-800 dark:text-amber-300 font-semibold'
                              : ''
                          }`}
                        >
                          {cVal}
                        </TableCell>
                        <TableCell className="py-2 break-all text-muted-foreground">
                          {bVal}
                        </TableCell>
                        <TableCell className="py-2 text-right font-sans">
                          {isDiff ? (
                            <Button
                              variant={isAccepted ? 'secondary' : 'outline'}
                              size="xs"
                              onClick={() => onToggleAcceptCookie(cookieName)}
                            >
                              {isAccepted ? 'Accepted (Undo)' : 'Accept Cookie'}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">Match</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* TAB 3: VISUAL IMAGE (AI JUDGE) WITH ACCEPT VISUAL DIFF */}
          <TabsContent value="image" className="mt-0 space-y-2.5">
            <div
              className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                rawVisualDiff && !isVisualAccepted
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : rawVisualDiff && isVisualAccepted
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-muted/30 border-border'
              }`}
            >
              <div className="flex items-start gap-2">
                {rawVisualDiff && !isVisualAccepted ? (
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground flex items-center gap-2 flex-wrap">
                    <span>
                      AI Verdict: {item.visualResult?.verdict.toUpperCase() || 'SAME'}
                    </span>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px]"
                      title="Evaluated by Amazon Bedrock Nova Lite multimodal judge (arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0)"
                    >
                      AWS Nova Lite · amazon.nova-lite-v1:0
                    </Badge>
                    <Badge
                      variant={
                        rawVisualDiff && !isVisualAccepted ? 'warning' : 'secondary'
                      }
                      className="font-mono"
                    >
                      Δ {item.visualResult?.pixelDiffPercent?.toFixed(1) ?? '0.0'}%
                    </Badge>
                    {isVisualAccepted && (
                      <Badge variant="success" className="font-mono">
                        Accepted Visual Diff
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    {item.visualResult?.summary ||
                      'Rendered DOM and screenshots match across both environments.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {rawVisualDiff && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer mr-1">
                      <Switch
                        checked={showDiffOverlay}
                        onCheckedChange={setShowDiffOverlay}
                      />
                      <span>Overlay</span>
                    </label>

                    <Button
                      variant={isVisualAccepted ? 'secondary' : 'outline'}
                      size="xs"
                      onClick={() => onToggleAcceptVisual(item.testId)}
                    >
                      <Check className="!size-3" />
                      {isVisualAccepted
                        ? 'Visual Diff Accepted (Undo)'
                        : 'Accept Visual Diff'}
                    </Button>
                  </>
                )}

                <Button
                  size="xs"
                  onClick={() => onRunAiVisualJudge(item.testId)}
                  disabled={isRunningAi}
                  title="Invoke Amazon Bedrock Nova Lite (amazon.nova-lite-v1:0) visual diff judge via POST /api/v1/judge/nova-lite"
                >
                  <Sparkles className="!size-3" />
                  {isRunningAi ? 'Analyzing…' : 'Run Nova Lite Judge'}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <DomSnapshotCard
                title={`Side A (${candidateLabel})`}
                metaRight={`${cand?.durationMs ?? 78}ms`}
                highlightDiff={rawVisualDiff}
                overlayText={
                  rawVisualDiff && showDiffOverlay
                    ? 'AI Region: +14px vertical offset'
                    : undefined
                }
              />
              <DomSnapshotCard
                title={`Side B (${baselineLabel})`}
                metaRight={`${base?.durationMs ?? 72}ms`}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// SINGLE RUN 3-DIMENSION INSPECTOR (REUSES SHARED PRIMITIVES)
// ============================================================================
export const SingleRunInspector: React.FC<{
  result: TestResult;
  targetLabel: string;
  runLabel: string;
  isRerunning: boolean;
  onRerunTest: (testId: string) => void;
  activeTab?: InspectorDimension;
  onTabChange?: (tab: InspectorDimension) => void;
}> = ({
  result,
  targetLabel,
  runLabel,
  isRerunning,
  onRerunTest,
  activeTab: controlledTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<InspectorDimension>('headers');
  const activeTab = controlledTab ?? internalTab;
  const handleTabChange = (v: string) => {
    const next = v as InspectorDimension;
    setInternalTab(next);
    onTabChange?.(next);
  };

  const headers = Object.entries(result.capturedHeaders || {});
  const cookies = Object.entries(result.capturedCookies || {});

  return (
    <Card className="overflow-hidden">
      <InspectorActionHeader
        testId={result.id}
        testName={result.name}
        subtitle={`${result.url} · Edge: ${result.edgeHostname}`}
        statusBadge={{
          pass: result.pass,
          status: result.actualStatus,
          durationMs: result.durationMs,
        }}
        isRerunning={isRerunning}
        onRerun={() => onRerunTest(result.id)}
        curlTarget={result}
      />

      <CardContent className="p-3.5">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <TabsList className="h-8">
              <TabsTrigger value="headers" className="text-xs">
                Headers ({headers.length})
              </TabsTrigger>
              <TabsTrigger value="cookies" className="text-xs">
                Cookies ({cookies.length})
              </TabsTrigger>
              <TabsTrigger value="image" className="text-xs">
                Captured Image
              </TabsTrigger>
            </TabsList>

            <span className="text-[11px] font-mono text-muted-foreground">
              {targetLabel} · {runLabel}
            </span>
          </div>

          <TabsContent value="headers" className="mt-0">
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48 py-2">Header Name</TableHead>
                    <TableHead className="py-2">Captured Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  <TableRow>
                    <TableCell className="py-2 font-medium text-foreground">
                      http-status
                    </TableCell>
                    <TableCell className="py-2">{result.actualStatus}</TableCell>
                  </TableRow>
                  {headers.map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell className="py-2 font-medium text-foreground">
                        {key}
                      </TableCell>
                      <TableCell className="py-2 break-all text-muted-foreground">
                        {value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="cookies" className="mt-0">
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48 py-2">Cookie Name</TableHead>
                    <TableHead className="py-2">Captured Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  {cookies.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="text-muted-foreground text-center py-6"
                      >
                        No cookies set on this response.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cookies.map(([name, val]) => (
                      <TableRow key={name}>
                        <TableCell className="py-2 font-medium text-foreground">
                          {name}
                        </TableCell>
                        <TableCell className="py-2 break-all text-muted-foreground">
                          {val}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="image" className="mt-0">
            <DomSnapshotCard
              title={`Captured DOM Snapshot (1440×900) · ${result.name}`}
              metaRight={`${result.edgeHostname} · ${result.durationMs}ms`}
              url={result.url}
              footerLeft={`HTTP ${result.actualStatus}`}
              footerRight={`Cacheable: ${
                result.capturedHeaders['x-check-cacheable'] || 'YES'
              }`}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
