import React, { useState } from 'react';
import { ComparisonItem, RedirectHop, TestResult } from '../engine/types';
import { generateReproduceCurl } from '../engine/rules';
import { buildDomScreenshotDataUri, resolveLiveScreenshotUrl } from '../engine/domScreenshotRenderer';
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
  ArrowRight,
  Activity,
  Globe,
  Lock,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export type InspectorDimension = 'flow' | 'headers' | 'cookies' | 'image';

// ============================================================================
// SHARED REUSABLE PRIMITIVE 1: INSPECTOR HEADER (USED BY DIFF & SINGLE RUN)
// ============================================================================
export interface LiveProbeFeedback {
  at: string;
  count: number;
  candMs: number;
  baseMs?: number;
  status: number;
  screenshotRevision?: number;
  screenshotCaptured?: boolean;
  sha256?: string;
  bytes?: number;
  s3Key?: string;
  persistedToRunKey?: string;
}

export const InspectorActionHeader: React.FC<{
  testId: string;
  testName: string;
  subtitle: string;
  statusBadge?: { pass: boolean; status: number; durationMs: number };
  hopCount?: number;
  isRerunning: boolean;
  onRerun: () => void;
  curlTarget?: TestResult;
  lastProbedInfo?: LiveProbeFeedback;
}> = ({
  testId,
  testName,
  subtitle,
  statusBadge,
  hopCount,
  isRerunning,
  onRerun,
  curlTarget,
  lastProbedInfo,
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
    <CardHeader className="border-b border-border bg-muted/15 py-3 px-4 flex flex-row flex-wrap items-center justify-between space-y-0 gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
            {testId}
          </span>
          <CardTitle className="truncate text-sm font-semibold">
            {testName}
          </CardTitle>
          {lastProbedInfo && (
            <span
              data-testid="live-probe-badge"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold"
              title={`Live edge HTTP flow & 1280×760 DOM screenshot persisted at ${lastProbedInfo.at}${
                lastProbedInfo.sha256 ? ` · SHA-256: ${lastProbedInfo.sha256}` : ''
              }${lastProbedInfo.s3Key ? ` · S3: ${lastProbedInfo.s3Key}` : ''}`}
            >
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
              Probed #{lastProbedInfo.count} & Screenshot Saved · {lastProbedInfo.at} · HTTP {lastProbedInfo.status} ({lastProbedInfo.candMs}ms
              {typeof lastProbedInfo.baseMs === 'number' ? ` / ${lastProbedInfo.baseMs}ms` : ''})
              {lastProbedInfo.sha256 && (
                <span className="text-[9px] opacity-85">
                  · sha256:{lastProbedInfo.sha256.slice(0, 8)}
                </span>
              )}
              {typeof lastProbedInfo.bytes === 'number' && lastProbedInfo.bytes > 0 && (
                <span className="text-[9px] opacity-85">
                  ({(lastProbedInfo.bytes / 1024).toFixed(1)}KB)
                </span>
              )}
            </span>
          )}
        </div>
        <CardDescription className="font-mono text-[11px] truncate mt-1 flex items-center gap-1.5 text-muted-foreground">
          <span className="truncate">{subtitle}</span>
          {statusBadge && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={
                  statusBadge.pass
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-rose-600 dark:text-rose-400 font-semibold'
                }
              >
                HTTP {statusBadge.status}
              </span>
              <span aria-hidden="true">·</span>
              <span>{statusBadge.durationMs}ms</span>
            </>
          )}
          {typeof hopCount === 'number' && hopCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-foreground/80 font-medium">
                {hopCount} {hopCount === 1 ? 'HTTP Hop' : 'HTTP Hops'}
              </span>
            </>
          )}
        </CardDescription>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="outline"
          size="xs"
          data-testid="rerun-probe-btn"
          onClick={onRerun}
          disabled={isRerunning}
        >
          <RotateCw className={`!size-3 ${isRerunning ? 'animate-spin text-sky-500' : ''}`} />
          {isRerunning ? 'Probing…' : 'Rerun Probe'}
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
// SHARED REUSABLE PRIMITIVE 2: HTTP FLOW WATERFALL & HOP PIPELINE VIEWER
// ============================================================================
export const HttpFlowHopChainBanner: React.FC<{
  result?: TestResult;
  onInspectFlowTab: (hopIndex?: number) => void;
  activeTab: InspectorDimension;
  activeHopIndex?: number | null;
}> = ({ result, onInspectFlowTab, activeTab, activeHopIndex }) => {
  if (!result) return null;
  const hops = result.redirectChain || [];
  const summary = result.httpFlowSummary;
  const totalMs = summary?.totalDurationMs || result.durationMs || 1;
  const dnsMs = summary?.totalDnsMs ?? Math.round(totalMs * 0.08);
  const tcpMs = summary?.totalTcpMs ?? Math.round(totalMs * 0.1);
  const tlsMs = summary?.totalTlsMs ?? Math.round(totalMs * 0.18);
  const ttfbMs = summary?.totalTtfbMs ?? Math.round(totalMs * 0.5);
  const transferMs = Math.max(
    1,
    summary?.totalTransferMs ?? totalMs - (dnsMs + tcpMs + tlsMs + ttfbMs)
  );

  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/15 p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="font-mono text-[10px] gap-1 px-1.5 py-0">
            <Activity className="w-3 h-3 text-sky-500" />
            HTTP Flow Trace
          </Badge>
          {hops.map((hop, idx) => {
            const isFocusedHop = activeTab === 'flow' && activeHopIndex === idx;
            return (
              <React.Fragment key={idx}>
                <button
                  type="button"
                  onClick={() => onInspectFlowTab(idx)}
                  title={`Click to jump to Hop #${hop.hopNumber || idx + 1} (${hop.url}) and auto-collapse other sections`}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-all ${
                    hop.status >= 300 && hop.status < 400
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                      : hop.status >= 400
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/20'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                  } ${isFocusedHop ? 'ring-2 ring-sky-500/60 shadow-2xs' : ''}`}
                >
                  <span className="font-bold">
                    #{hop.hopNumber || idx + 1} {hop.method}
                  </span>
                  <span>{hop.status}</span>
                  <span className="text-muted-foreground">({hop.durationMs}ms)</span>
                </button>
                {idx < hops.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Lock className="w-2.5 h-2.5 text-emerald-500" />
            {summary?.protocol || 'HTTP/2'} · {summary?.tlsVersion || 'TLSv1.3'}
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Globe className="w-2.5 h-2.5 text-sky-500" />
            Edge IP: {summary?.resolvedEdgeIp || result.stagingEdgeIp || '23.48.201.18'}
          </span>
          {activeTab !== 'flow' && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => onInspectFlowTab(0)}
              className="h-5 px-1.5 text-[10px] font-mono"
            >
              Inspect Flow ({hops.length || 1})
            </Button>
          )}
        </div>
      </div>

      {/* Phase Timing Waterfall Bar */}
      <div className="space-y-1">
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
          <div
            style={{ width: `${Math.max(4, (dnsMs / totalMs) * 100)}%` }}
            className="bg-sky-500 h-full"
            title={`DNS Lookup: ${dnsMs}ms`}
          />
          <div
            style={{ width: `${Math.max(4, (tcpMs / totalMs) * 100)}%` }}
            className="bg-amber-500 h-full"
            title={`TCP Connect: ${tcpMs}ms`}
          />
          <div
            style={{ width: `${Math.max(5, (tlsMs / totalMs) * 100)}%` }}
            className="bg-purple-500 h-full"
            title={`TLS Handshake: ${tlsMs}ms`}
          />
          <div
            style={{ width: `${Math.max(15, (ttfbMs / totalMs) * 100)}%` }}
            className="bg-emerald-500 h-full"
            title={`Time to First Byte (TTFB): ${ttfbMs}ms`}
          />
          <div
            style={{ width: `${Math.max(5, (transferMs / totalMs) * 100)}%` }}
            className="bg-blue-500 h-full"
            title={`Content Transfer: ${transferMs}ms`}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-sky-500 inline-block" />
              DNS {dnsMs}ms
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" />
              TCP {tcpMs}ms
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-purple-500 inline-block" />
              TLS {tlsMs}ms
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" />
              TTFB {ttfbMs}ms
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-blue-500 inline-block" />
              Transfer {transferMs}ms
            </span>
          </div>
          <span>Total: {totalMs}ms</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SHARED REUSABLE PRIMITIVE 3: COLLAPSIBLE ZERO-NESTED-SCROLL HOP CARD
// ============================================================================
const PRIORITY_EDGE_HEADERS = new Set([
  'server',
  'location',
  'cache-control',
  'x-check-cacheable',
  'x-cache',
  'x-cache-remote',
  'x-true-cache-key',
  'x-akamai-Session-info',
  'content-type',
  'content-length',
  'strict-transport-security',
  'date',
  'expires',
]);

const HttpHopDetailCard: React.FC<{
  hop: RedirectHop;
  index: number;
  sideLabel?: string;
  hopKey?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onNextHop?: () => void;
  onPrevHop?: () => void;
}> = ({
  hop,
  index,
  sideLabel,
  hopKey,
  isExpanded = true,
  onToggleExpand,
  onNextHop,
  onPrevHop,
}) => {
  const [subView, setSubView] = useState<'response' | 'request' | 'cookies'>(
    'response'
  );
  const [showAllHeaders, setShowAllHeaders] = useState(false);
  const [headerFilter, setHeaderFilter] = useState('');

  const reqEntries = Object.entries(hop.requestHeaders || {});
  const allRespEntries = Object.entries(hop.responseHeaders || {}).sort(
    ([a], [b]) => {
      const aPri = PRIORITY_EDGE_HEADERS.has(a.toLowerCase()) ? 0 : 1;
      const bPri = PRIORITY_EDGE_HEADERS.has(b.toLowerCase()) ? 0 : 1;
      return aPri - bPri;
    }
  );
  const filteredRespEntries = headerFilter.trim()
    ? allRespEntries.filter(
        ([k, v]) =>
          k.toLowerCase().includes(headerFilter.toLowerCase()) ||
          String(v).toLowerCase().includes(headerFilter.toLowerCase())
      )
    : allRespEntries;
  const visibleRespEntries =
    showAllHeaders || headerFilter.trim()
      ? filteredRespEntries
      : filteredRespEntries.slice(0, 10);

  const cookiesList = hop.cookiesSet || [];
  const t = hop.timings || {
    dnsMs: 4,
    tcpMs: 5,
    tlsMs: 10,
    ttfbMs: Math.max(10, hop.durationMs - 24),
    transferMs: 5,
    totalMs: hop.durationMs,
  };

  return (
    <div
      id={hopKey ? `hop-card-${hopKey}` : undefined}
      data-scroll-section
      data-testid={hopKey ? `hop-card-${hopKey}` : `hop-card-${index}`}
      className={`rounded-lg border transition-all overflow-hidden ${
        isExpanded
          ? 'border-sky-500/45 bg-card shadow-xs'
          : 'border-border bg-card/60 hover:bg-muted/30'
      }`}
    >
      {/* Clickable Accordion Header — Clicking expands this hop & auto-collapses others */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand?.();
          }
        }}
        className={`px-3 py-2 flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none transition-colors ${
          isExpanded
            ? 'bg-sky-500/[0.06] dark:bg-sky-500/[0.12] border-b border-border'
            : 'hover:bg-muted/40'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
          <span
            className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-mono font-bold transition-transform ${
              isExpanded
                ? 'bg-sky-500 text-white'
                : 'bg-muted text-muted-foreground'
            }`}
            title={isExpanded ? 'Collapse Hop Details' : 'Expand Hop Details'}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
          {sideLabel && (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {sideLabel}
            </Badge>
          )}
          <Badge variant="outline" className="font-mono text-[10px] font-bold">
            Hop #{hop.hopNumber || index + 1}
          </Badge>
          <span className="font-mono text-xs font-bold text-foreground">
            {hop.method}
          </span>
          <Badge
            variant={
              hop.status >= 300 && hop.status < 400
                ? 'warning'
                : hop.status >= 400
                ? 'destructive'
                : 'success'
            }
            className="font-mono text-[10px]"
          >
            {hop.status} {hop.statusText || ''}
          </Badge>
          <span className="font-mono text-xs text-sky-600 dark:text-sky-400 truncate max-w-[340px] sm:max-w-[460px]" title={hop.url}>
            {hop.url}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground shrink-0">
          {!isExpanded && (
            <span className="hidden md:inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-muted/60 text-[10px]">
              <span>IP: {hop.edgeIp || '23.48.201.18'}</span>
              <span>·</span>
              <span>TTFB: {t.ttfbMs}ms</span>
              <span>·</span>
              <span>{allRespEntries.length} hdrs</span>
            </span>
          )}
          <span>+{hop.startOffsetMs}ms</span>
          <span>·</span>
          <span className="font-semibold text-foreground">{hop.durationMs}ms</span>
          {isExpanded && (onPrevHop || onNextHop) && (
            <div
              className="inline-flex items-center gap-1 ml-1 pl-2 border-l border-border"
              onClick={(e) => e.stopPropagation()}
            >
              {onPrevHop && (
                <button
                  type="button"
                  onClick={onPrevHop}
                  className="px-1.5 py-0.5 rounded border border-border bg-background hover:bg-muted text-[10px] text-foreground cursor-pointer"
                  title="Auto-collapse current hop and open previous hop"
                >
                  ↑ Prev
                </button>
              )}
              {onNextHop && (
                <button
                  type="button"
                  data-testid="next-hop-auto-collapse-btn"
                  onClick={onNextHop}
                  className="px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-[10px] text-sky-600 dark:text-sky-400 font-semibold cursor-pointer"
                  title="Auto-collapse current hop and advance to next hop"
                >
                  Next Hop ↓
                </button>
              )}
            </div>
          )}
          <span className="px-1.5 py-0.5 rounded border border-border bg-background text-[10px] text-foreground">
            {isExpanded ? 'Collapse' : 'Expand'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-2.5 text-xs">
          {/* Redirect Target Banner if 301/302 */}
          {hop.redirectLocation && (
            <div className="px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 font-mono text-[11px] flex items-center justify-between gap-2 text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-2 min-w-0">
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                <span className="font-semibold shrink-0">Redirect Location:</span>
                <span className="break-all">{hop.redirectLocation}</span>
              </div>
              {onNextHop && (
                <button
                  type="button"
                  onClick={onNextHop}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] font-semibold shrink-0 cursor-pointer"
                >
                  Follow Redirect →
                </button>
              )}
            </div>
          )}

          {/* Edge IP, CNAME, TLS & Phase Timings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono bg-muted/20 p-2 rounded border border-border">
            <div className="space-y-0.5 min-w-0">
              <div className="text-muted-foreground truncate">
                <strong className="text-foreground">Edge IP:</strong>{' '}
                {hop.edgeIp || '23.48.201.18'} ·{' '}
                <strong className="text-foreground">TLS:</strong>{' '}
                {hop.tlsProtocol || 'TLSv1.3'} ({hop.tlsCipher || 'TLS_AES_256_GCM_SHA384'})
              </div>
              {hop.edgeCname && (
                <div
                  className="text-[10px] text-muted-foreground truncate"
                  title={hop.edgeCname}
                >
                  <strong className="text-foreground">CNAME:</strong> {hop.edgeCname}
                </div>
              )}
            </div>
            <div className="flex items-center sm:justify-end gap-1.5 flex-wrap text-[10px]">
              <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">
                DNS: {t.dnsMs}ms
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                TCP: {t.tcpMs}ms
              </span>
              <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                TLS: {t.tlsMs}ms
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                TTFB: {t.ttfbMs}ms
              </span>
              <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                Xfer: {t.transferMs}ms
              </span>
            </div>
          </div>

          {/* Sub-selector for Hop Response Headers / Request Headers / Cookies Set */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setSubView('response')}
                className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                  subView === 'response'
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Response Headers ({allRespEntries.length})
              </button>
              <button
                type="button"
                onClick={() => setSubView('request')}
                className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                  subView === 'request'
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Request Headers ({reqEntries.length})
              </button>
              <button
                type="button"
                onClick={() => setSubView('cookies')}
                className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                  subView === 'cookies'
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Cookies Set ({cookiesList.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              {subView === 'response' && allRespEntries.length > 8 && (
                <input
                  type="text"
                  placeholder="Filter headers…"
                  value={headerFilter}
                  onChange={(e) => setHeaderFilter(e.target.value)}
                  className="h-6 px-2 rounded border border-input bg-background text-[10px] font-mono w-32"
                />
              )}
              {hop.bytesTransferred !== undefined && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  Payload: {(hop.bytesTransferred / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          </div>

          {/* ZERO NESTED VERTICAL SCROLLBAR: Clean inline table with one-click Expand All */}
          {subView === 'response' && (
            <div className="rounded border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44 py-1.5">Response Header</TableHead>
                    <TableHead className="py-1.5">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  {visibleRespEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-muted-foreground py-3 text-center">
                        No matching response headers for this hop.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleRespEntries.map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell className="py-1 font-medium text-foreground">{k}</TableCell>
                        <TableCell className="py-1 break-all text-muted-foreground">{v}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {!headerFilter.trim() && filteredRespEntries.length > 10 && (
                <div className="px-3 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground">
                    Showing {visibleRespEntries.length} of {filteredRespEntries.length} response headers
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllHeaders((prev) => !prev)}
                    className="text-sky-600 dark:text-sky-400 font-semibold hover:underline cursor-pointer"
                  >
                    {showAllHeaders
                      ? 'Compact to Top 10 Priority Headers ↑'
                      : `Show All ${filteredRespEntries.length} Headers ↓`}
                  </button>
                </div>
              )}
            </div>
          )}

          {subView === 'request' && (
            <div className="rounded border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44 py-1.5">Request Header</TableHead>
                    <TableHead className="py-1.5">Value Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  {reqEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-muted-foreground py-3 text-center">
                        Default HTTP/2 request headers sent.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reqEntries.map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell className="py-1 font-medium text-foreground">{k}</TableCell>
                        <TableCell className="py-1 break-all text-muted-foreground">{v}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {subView === 'cookies' && (
            <div className="rounded border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="py-1.5">
                      Set-Cookie Header Received at Hop #{hop.hopNumber || index + 1}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-[11px]">
                  {cookiesList.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground py-3 text-center">
                        No Set-Cookie headers emitted on this hop.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cookiesList.map((cookieLine, cIdx) => (
                      <TableRow key={cIdx}>
                        <TableCell className="py-1 break-all text-muted-foreground">
                          {cookieLine}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SHARED REUSABLE PRIMITIVE 4: DOM SNAPSHOT PREVIEW CARD (HIGH-RES IMAGE)
// ============================================================================
export const DomSnapshotCard: React.FC<{
  title: string;
  metaRight: string;
  testId?: string;
  testName?: string;
  url?: string;
  side?: 'A' | 'B' | 'single';
  highlightDiff?: boolean;
  overlayText?: string;
  httpStatus?: number;
  durationMs?: number;
  edgeHostname?: string;
  edgeIp?: string;
  cacheStatus?: string;
  footerLeft?: string;
  footerRight?: string;
  isRerunning?: boolean;
  screenshotRevision?: number | string;
  lastCapturedAt?: string;
  screenshotSha256?: string;
  screenshotBytes?: number;
  s3ScreenshotKey?: string;
}> = ({
  title,
  metaRight,
  testId = 'T01',
  testName = 'Salesforce Global Home & Hero Experience',
  url = 'https://www.salesforce.com/',
  side = 'A',
  highlightDiff,
  overlayText,
  httpStatus = 200,
  durationMs = 78,
  edgeHostname = 'www.salesforce.com.edgekey.net',
  edgeIp,
  cacheStatus = 'TCP_HIT',
  footerLeft,
  footerRight,
  isRerunning = false,
  screenshotRevision,
  lastCapturedAt,
  screenshotSha256,
  screenshotBytes,
  s3ScreenshotKey,
}) => {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [imgFallback, setImgFallback] = useState(false);
  const liveScreenshotUrl = resolveLiveScreenshotUrl({
    testId,
    testName,
    url,
    side,
    highlightDiff,
    revision: screenshotRevision,
  });
  React.useEffect(() => {
    setImgFallback(false);
  }, [liveScreenshotUrl]);
  const fallbackSvgDataUri = buildDomScreenshotDataUri({
    testId,
    testName,
    url,
    side,
    highlightDiff,
    showOverlay: Boolean(overlayText),
    overlayText,
    httpStatus,
    durationMs,
    edgeHostname,
    edgeIp,
    cacheStatus,
  });
  const activeImgSrc = imgFallback ? fallbackSvgDataUri : liveScreenshotUrl;

  return (
    <div className="border border-border rounded-lg p-3 bg-card space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-muted-foreground">
        <span className="font-semibold text-foreground truncate" title={title}>{title}</span>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {lastCapturedAt && (
            <span
              data-testid={`snapshot-saved-badge-${side}`}
              className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[9px] font-mono font-semibold"
              title={`Persisted 1280×760 screenshot captured at ${lastCapturedAt}${
                screenshotSha256 ? ` · SHA-256: ${screenshotSha256}` : ''
              }${s3ScreenshotKey ? ` · S3: ${s3ScreenshotKey}` : ''}`}
            >
              ● Saved {lastCapturedAt}
              {screenshotSha256 ? ` · #${screenshotSha256.slice(0, 6)}` : ''}
              {typeof screenshotBytes === 'number' && screenshotBytes > 0
                ? ` (${(screenshotBytes / 1024).toFixed(1)}KB)`
                : ''}
            </span>
          )}
          <span className="text-[10px]">{metaRight}</span>
          <button
            type="button"
            data-testid={`enlarge-snapshot-btn-${side}`}
            onClick={() => setZoomOpen((prev) => !prev)}
            className="px-2 py-0.5 rounded border border-border bg-background hover:bg-muted text-[10px] text-foreground cursor-pointer whitespace-nowrap shrink-0"
            title="Open high-resolution 1280×760 DOM screenshot inspection modal"
          >
            {zoomOpen ? 'Close' : 'Enlarge'}
          </button>
        </div>
      </div>

      <div
        className={`bg-background border rounded-md overflow-hidden transition-all ${
          highlightDiff
            ? 'border-amber-500/70 ring-1 ring-amber-500/25'
            : 'border-border'
        }`}
      >
        {/* Browser Chrome Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-2.5 py-1.5 bg-muted/25">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
            <span className="w-2 h-2 rounded-full bg-rose-400/80 shrink-0" />
            <span className="w-2 h-2 rounded-full bg-amber-400/80 shrink-0" />
            <span className="w-2 h-2 rounded-full bg-emerald-400/80 shrink-0" />
            <Lock className="w-2.5 h-2.5 text-emerald-500 ml-1 shrink-0" />
            {url && (
              <span
                className="font-mono text-[10px] text-muted-foreground truncate"
                title={url}
              >
                {url}
              </span>
            )}
          </div>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0 pl-2 border-l border-border/60">
            1280×760
          </span>
        </div>

        {/* Dedicated Non-Overlapping AI Region Callout Strip */}
        {overlayText && (
          <div className="px-2.5 py-1 bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-300 text-[10px] font-mono font-semibold flex items-center justify-between gap-2">
            <span>★ Bedrock Nova Lite Diff: {overlayText}</span>
            <span className="text-[9px] opacity-80 shrink-0">Top Banner Region</span>
          </div>
        )}

        {/* Rendered Real Webpage Screenshot Image (Full 16:10 Frame, No Cropping) */}
        <div
          className="relative w-full bg-slate-950 cursor-pointer group"
          onClick={() => setZoomOpen(true)}
          title="Click to inspect full 1280×760 high-resolution DOM screenshot"
        >
          <img
            src={activeImgSrc}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!imgFallback) setImgFallback(true);
            }}
            alt={`${title} Live Chromium Screenshot for ${testId} (${url})`}
            data-testid={`dom-snapshot-img-${side}`}
            className="w-full block aspect-[16/10] object-contain transition-opacity"
          />
          {overlayText && (
            <div className="pointer-events-none absolute inset-x-1.5 top-1 h-9 rounded border-2 border-dashed border-amber-400 bg-amber-500/10" />
          )}
          {isRerunning && (
            <div
              data-testid={`screenshot-capturing-overlay-${side}`}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-white font-mono text-xs px-4 text-center"
            >
              <RotateCw className="w-5 h-5 text-sky-400 animate-spin" />
              <span className="font-semibold">
                Capturing live 1280×760 Chromium screenshot…
              </span>
              <span className="text-[10px] text-slate-300 truncate max-w-full">
                {url}
              </span>
            </div>
          )}
        </div>

        {(footerLeft || footerRight) && (
          <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 border-t border-border bg-muted/15 text-[10px] font-mono text-muted-foreground">
            <span className="truncate min-w-0 flex-1" title={footerLeft}>
              {footerLeft}
            </span>
            <span className="shrink-0 pl-2 border-l border-border/60" title={footerRight}>
              {footerRight}
            </span>
          </div>
        )}
      </div>

      {/* Fullscreen High-Resolution 1280×760 Lightbox Modal */}
      {zoomOpen && (
        <div
          data-testid="dom-snapshot-lightbox"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setZoomOpen(false)}
        >
          <div
            className="w-full max-w-6xl rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden space-y-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <Badge variant="outline" className="font-mono text-xs border-zinc-700 text-sky-400">
                  {testId}
                </Badge>
                <span className="font-semibold text-sm text-white truncate">
                  {title} — {testName}
                </span>
                <span className="font-mono text-xs text-zinc-400 truncate hidden sm:inline">
                  ({url})
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-xs text-zinc-400">
                  1280×760 Native Viewport · {metaRight}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  data-testid="close-lightbox-btn"
                  onClick={() => setZoomOpen(false)}
                  className="bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800"
                >
                  Close
                </Button>
              </div>
            </div>
            <div className="relative bg-slate-950 p-3 flex items-center justify-center">
              <img
                src={activeImgSrc}
                alt={`${title} Fullscreen 1280×760 Screenshot`}
                className="max-h-[80vh] w-auto max-w-full rounded border border-zinc-800 object-contain"
              />
            </div>
            {(footerLeft || footerRight) && (
              <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-4 font-mono text-xs text-zinc-300">
                <span className="truncate">{footerLeft}</span>
                <span className="shrink-0">{footerRight}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPARATIVE 4-DIMENSION TEST INSPECTOR (HTTP FLOW, HEADERS, COOKIES, IMAGE AI)
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
  lastProbedInfo?: LiveProbeFeedback;
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
  lastProbedInfo,
}) => {
  const [showDiffOverlay, setShowDiffOverlay] = useState(true);
  const [diffsOnly, setDiffsOnly] = useState(false);
  const [flowSideFilter, setFlowSideFilter] = useState<'both' | 'A' | 'B'>('both');
  // Auto-collapse navigation state for HTTP Flow & Headers
  const [autoCollapse, setAutoCollapse] = useState(true);
  const [flowSummaryCollapsed, setFlowSummaryCollapsed] = useState(false);
  const [activeHopKey, setActiveHopKey] = useState<string>('cand-hop-0');
  const [expandAllHops, setExpandAllHops] = useState(false);
  const [showStandardHeaders, setShowStandardHeaders] = useState(true);

  const cand = item.candidateResult;
  const base = item.baselineResult;
  const candHops = cand?.redirectChain || [];
  const baseHops = base?.redirectChain || [];

  // Reset hop focus when test item changes
  React.useEffect(() => {
    setActiveHopKey('cand-hop-0');
    setFlowSummaryCollapsed(false);
    setExpandAllHops(false);
  }, [item.testId]);

  // Build ordered list of visible hop descriptors for auto-collapse stepping
  const visibleHopItems = React.useMemo(() => {
    const list: Array<{
      key: string;
      hop: RedirectHop;
      index: number;
      sideLabel: string;
    }> = [];
    if (flowSideFilter === 'both' || flowSideFilter === 'A') {
      candHops.forEach((hop, idx) => {
        list.push({
          key: `cand-hop-${idx}`,
          hop,
          index: idx,
          sideLabel: `Side A · ${candidateLabel}`,
        });
      });
    }
    if (flowSideFilter === 'both' || flowSideFilter === 'B') {
      baseHops.forEach((hop, idx) => {
        list.push({
          key: `base-hop-${idx}`,
          hop,
          index: idx,
          sideLabel: `Side B · ${baselineLabel}`,
        });
      });
    }
    return list;
  }, [flowSideFilter, candHops, baseHops, candidateLabel, baselineLabel]);

  const handleFocusHop = (hopKey: string, collapseSummary = true) => {
    setExpandAllHops(false);
    setActiveHopKey(hopKey);
    if (autoCollapse && collapseSummary) {
      setFlowSummaryCollapsed(true);
    }
  };

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

  const diffHeaderKeys = allHeaderKeys.filter((k) =>
    item.functionalDiffs.some(
      (d) => (d.field || d.kind).toLowerCase() === k.toLowerCase()
    )
  );
  const visibleHeaderKeys =
    diffsOnly && diffHeaderKeys.length > 0 ? diffHeaderKeys : allHeaderKeys;

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

  const diffCookieKeys = allCookieKeys.filter(
    (k) =>
      (cand?.capturedCookies?.[k] ?? '') !==
      (base?.capturedCookies?.[k] ?? '')
  );
  const visibleCookieKeys =
    diffsOnly && diffCookieKeys.length > 0 ? diffCookieKeys : allCookieKeys;

  const statusDiff = cand?.actualStatus !== base?.actualStatus;

  const activeHopNumericIdx = activeHopKey.startsWith('cand-hop-')
    ? Number(activeHopKey.replace('cand-hop-', ''))
    : null;

  return (
    <Card>
      <InspectorActionHeader
        testId={item.testId}
        testName={item.testName}
        subtitle={item.url}
        hopCount={candHops.length || 1}
        isRerunning={isRerunningTest}
        onRerun={() => onRerunSingleTest(item.testId)}
        curlTarget={cand}
        lastProbedInfo={lastProbedInfo}
      />

      <CardContent className="p-3.5">
        {/* Always-visible HTTP Flow & Timing Waterfall Banner */}
        <HttpFlowHopChainBanner
          result={cand}
          activeTab={activeTab}
          activeHopIndex={activeHopNumericIdx}
          onInspectFlowTab={(hopIdx) => {
            onTabChange('flow');
            if (typeof hopIdx === 'number') {
              handleFocusHop(`cand-hop-${hopIdx}`, hopIdx > 0);
            }
          }}
        />

        <Tabs
          value={activeTab}
          onValueChange={(v) => onTabChange(v as InspectorDimension)}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
            <TabsList className="h-8 flex-wrap">
              <TabsTrigger value="flow" className="gap-1.5 text-xs">
                <Activity className="w-3 h-3 text-sky-500" />
                <span>HTTP Flow</span>
                <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400 font-bold">
                  ({candHops.length || 1} {candHops.length === 1 ? 'hop' : 'hops'})
                </span>
              </TabsTrigger>

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

            {(activeTab === 'headers' || activeTab === 'cookies') && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Switch checked={diffsOnly} onCheckedChange={setDiffsOnly} />
                <span>Diffs only</span>
              </label>
            )}

            {activeTab === 'flow' && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  data-testid="auto-collapse-mode-toggle"
                  onClick={() => setAutoCollapse((prev) => !prev)}
                  title="When enabled, focusing a Hop card automatically collapses the previous hop and the Flow Metric Summary table so you never deal with complex nested scrolls"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono cursor-pointer transition-colors ${
                    autoCollapse
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-semibold'
                      : 'border-border bg-muted/20 text-muted-foreground'
                  }`}
                >
                  <Layers className="w-2.5 h-2.5" />
                  Auto-Collapse: {autoCollapse ? 'ON' : 'OFF'}
                </button>

                <button
                  type="button"
                  data-testid="expand-all-hops-btn"
                  onClick={() => {
                    const next = !expandAllHops;
                    setExpandAllHops(next);
                    if (next) setFlowSummaryCollapsed(false);
                  }}
                  className="px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted text-[10px] font-mono text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {expandAllHops ? 'Accordion Mode' : `Expand All (${visibleHopItems.length})`}
                </button>

                <div className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5 text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => setFlowSideFilter('both')}
                    className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                      flowSideFilter === 'both'
                        ? 'bg-foreground text-background font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Side A + B
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlowSideFilter('A')}
                    className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                      flowSideFilter === 'A'
                        ? 'bg-foreground text-background font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Side A ({candHops.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlowSideFilter('B')}
                    className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                      flowSideFilter === 'B'
                        ? 'bg-foreground text-background font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Side B ({baseHops.length})
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* TAB 0: COMPLETE MULTI-HOP HTTP FLOW & WATERFALL COMPARISON (ZERO NESTED SCROLLS + AUTO-COLLAPSE) */}
          <TabsContent value="flow" className="mt-0 space-y-3">
            {/* Section 1: Collapsible Edge Flow & Timing Summary */}
            <div
              data-scroll-section="flow-summary"
              className="rounded-md border border-border overflow-hidden bg-card"
            >
              <div
                role="button"
                tabIndex={0}
                data-testid="flow-summary-section-header"
                onClick={() => setFlowSummaryCollapsed((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setFlowSummaryCollapsed((prev) => !prev);
                  }
                }}
                className="px-3 py-1.5 bg-muted/25 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono cursor-pointer select-none hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">
                    1. Edge Flow & Timing Summary
                  </span>
                  <span className="text-muted-foreground">
                    · Side A: {candHops.length} hop(s), {cand?.durationMs}ms · Side B: {baseHops.length} hop(s), {base?.durationMs}ms
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{flowSummaryCollapsed ? 'Expand Summary' : 'Collapse Summary'}</span>
                  {flowSummaryCollapsed ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </div>
              </div>

              {!flowSummaryCollapsed && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40 py-1.5">Flow Metric</TableHead>
                        <TableHead className="py-1.5">Side A ({candidateLabel})</TableHead>
                        <TableHead className="py-1.5">Side B ({baselineLabel})</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="font-mono text-[11px]">
                      <TableRow>
                        <TableCell className="py-1.5 font-medium text-foreground">
                          HTTP Hops & Redirects
                        </TableCell>
                        <TableCell className="py-1.5">
                          {candHops.length} hop(s) ·{' '}
                          {cand?.httpFlowSummary?.redirectCount ?? Math.max(0, candHops.length - 1)} redirect(s)
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {baseHops.length} hop(s) ·{' '}
                          {base?.httpFlowSummary?.redirectCount ?? Math.max(0, baseHops.length - 1)} redirect(s)
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="py-1.5 font-medium text-foreground">
                          Resolved Edge IP & Host
                        </TableCell>
                        <TableCell className="py-1.5 break-all">
                          {cand?.httpFlowSummary?.resolvedEdgeIp || cand?.stagingEdgeIp} ({cand?.edgeHostname})
                        </TableCell>
                        <TableCell className="py-1.5 break-all text-muted-foreground">
                          {base?.httpFlowSummary?.resolvedEdgeIp || base?.stagingEdgeIp} ({base?.edgeHostname})
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="py-1.5 font-medium text-foreground">
                          Protocol & TLS Cipher
                        </TableCell>
                        <TableCell className="py-1.5">
                          {cand?.httpFlowSummary?.protocol || 'HTTP/2'} ·{' '}
                          {cand?.httpFlowSummary?.tlsVersion || 'TLSv1.3'} (
                          {cand?.httpFlowSummary?.tlsCipher || 'TLS_AES_256_GCM_SHA384'})
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {base?.httpFlowSummary?.protocol || 'HTTP/2'} ·{' '}
                          {base?.httpFlowSummary?.tlsVersion || 'TLSv1.3'} (
                          {base?.httpFlowSummary?.tlsCipher || 'TLS_AES_256_GCM_SHA384'})
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="py-1.5 font-medium text-foreground">
                          Phase Timings (DNS/TCP/TLS/TTFB)
                        </TableCell>
                        <TableCell className="py-1.5">
                          DNS {cand?.httpFlowSummary?.totalDnsMs ?? 6}ms · TCP{' '}
                          {cand?.httpFlowSummary?.totalTcpMs ?? 7}ms · TLS{' '}
                          {cand?.httpFlowSummary?.totalTlsMs ?? 12}ms · TTFB{' '}
                          {cand?.httpFlowSummary?.totalTtfbMs ?? 45}ms (Total {cand?.durationMs}ms)
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          DNS {base?.httpFlowSummary?.totalDnsMs ?? 4}ms · TCP{' '}
                          {base?.httpFlowSummary?.totalTcpMs ?? 5}ms · TLS{' '}
                          {base?.httpFlowSummary?.totalTlsMs ?? 10}ms · TTFB{' '}
                          {base?.httpFlowSummary?.totalTtfbMs ?? 32}ms (Total {base?.durationMs}ms)
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Section 2: Hop-by-Hop Accordion Trace (NO nested max-h scroll container) */}
            <div data-scroll-section="hop-accordion" className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-mono text-muted-foreground">
                <span>
                  2. Hop-by-Hop Edge Trace ({visibleHopItems.length} hop cards ·{' '}
                  {expandAllHops
                    ? 'All Expanded'
                    : autoCollapse
                    ? 'Auto-Collapse Active'
                    : 'Manual Toggle'})
                </span>
                {flowSummaryCollapsed && (
                  <button
                    type="button"
                    onClick={() => setFlowSummaryCollapsed(false)}
                    className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                  >
                    ↑ Show Flow Summary Table
                  </button>
                )}
              </div>

              {visibleHopItems.map((entry, vIdx) => {
                const isExpanded =
                  expandAllHops ||
                  (!autoCollapse && activeHopKey === entry.key) ||
                  (autoCollapse && activeHopKey === entry.key);
                const prevEntry = vIdx > 0 ? visibleHopItems[vIdx - 1] : null;
                const nextEntry =
                  vIdx < visibleHopItems.length - 1 ? visibleHopItems[vIdx + 1] : null;

                return (
                  <HttpHopDetailCard
                    key={entry.key}
                    hop={entry.hop}
                    index={entry.index}
                    sideLabel={entry.sideLabel}
                    isExpanded={isExpanded}
                    onToggleExpand={() => {
                      if (expandAllHops) {
                        setExpandAllHops(false);
                        setActiveHopKey(entry.key);
                        return;
                      }
                      if (activeHopKey === entry.key) {
                        setActiveHopKey('');
                      } else {
                        handleFocusHop(entry.key, true);
                      }
                    }}
                    onPrevHop={
                      prevEntry
                        ? () => handleFocusHop(prevEntry.key, prevEntry.index > 0)
                        : undefined
                    }
                    onNextHop={
                      nextEntry
                        ? () => handleFocusHop(nextEntry.key, true)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </TabsContent>

          {/* TAB 1: FUNCTIONAL HEADERS */}
          <TabsContent value="headers" className="mt-0 space-y-2">
            {!diffsOnly && diffHeaderKeys.length > 0 && visibleHeaderKeys.length > 8 && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-border bg-muted/20 text-[11px] font-mono">
                <span>
                  Showing {diffHeaderKeys.length} active header diff(s) at top ·{' '}
                  {visibleHeaderKeys.length - diffHeaderKeys.length} matching headers below
                </span>
                <button
                  type="button"
                  onClick={() => setShowStandardHeaders((prev) => !prev)}
                  className="text-sky-600 dark:text-sky-400 font-semibold hover:underline cursor-pointer"
                >
                  {showStandardHeaders
                    ? `Collapse ${visibleHeaderKeys.length - diffHeaderKeys.length} Matching Headers ↑`
                    : `Expand All ${visibleHeaderKeys.length} Headers ↓`}
                </button>
              </div>
            )}
            <div className="rounded-md border border-border overflow-x-auto">
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

                  {visibleHeaderKeys
                    .filter((key) => {
                      if (diffsOnly || showStandardHeaders) return true;
                      const isDiff = item.functionalDiffs.some(
                        (d) => (d.field || d.kind).toLowerCase() === key.toLowerCase()
                      );
                      return (
                        isDiff ||
                        key === 'x-check-cacheable' ||
                        key === 'x-cache' ||
                        key === 'cache-control'
                      );
                    })
                    .map((key) => {
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
            <div className="rounded-md border border-border overflow-x-auto">
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
                    <span aria-hidden="true" className="text-muted-foreground">·</span>
                    <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">
                      Δ {item.visualResult?.pixelDiffPercent?.toFixed(1) ?? '0.0'}%
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">·</span>
                    <span
                      className="font-mono text-[11px] font-normal text-muted-foreground"
                      title="Evaluated by Amazon Bedrock Nova Lite multimodal judge (arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0)"
                    >
                      AWS Nova Lite · amazon.nova-lite-v1:0
                    </span>
                    {isVisualAccepted && (
                      <>
                        <span aria-hidden="true" className="text-muted-foreground">·</span>
                        <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                          Accepted Visual Diff
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
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
                  variant="outline"
                  size="xs"
                  data-testid="retake-screenshot-btn"
                  onClick={() => onRerunSingleTest(item.testId)}
                  disabled={isRerunningTest}
                  title="Re-probe live salesforce.com URL and capture fresh 1280×760 headless Chromium DOM screenshots"
                >
                  <RotateCw
                    className={`!size-3 ${
                      isRerunningTest ? 'animate-spin text-sky-500' : ''
                    }`}
                  />
                  {isRerunningTest ? 'Capturing…' : 'Retake Screenshot'}
                </Button>

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
                testId={item.testId}
                testName={item.testName}
                url={cand?.url || item.url}
                side="A"
                httpStatus={cand?.actualStatus ?? 200}
                durationMs={cand?.durationMs ?? 78}
                edgeHostname={cand?.edgeHostname}
                edgeIp={cand?.httpFlowSummary?.resolvedEdgeIp || cand?.stagingEdgeIp}
                cacheStatus={cand?.capturedHeaders?.['x-cache']?.split(' ')[0] || 'TCP_HIT'}
                highlightDiff={rawVisualDiff}
                overlayText={
                  rawVisualDiff && showDiffOverlay
                    ? 'AI Region: +14px vertical offset'
                    : undefined
                }
                footerLeft={`HTTP ${cand?.actualStatus ?? 200} · ${cand?.edgeHostname || 'staging'}`}
                footerRight={`Edge IP: ${cand?.httpFlowSummary?.resolvedEdgeIp || cand?.stagingEdgeIp || '23.48.201.18'}`}
                isRerunning={isRerunningTest}
                screenshotRevision={lastProbedInfo?.screenshotRevision ?? cand?.screenshotRevision}
                lastCapturedAt={lastProbedInfo?.at ?? cand?.screenshotCapturedAt}
                screenshotSha256={lastProbedInfo?.sha256 ?? cand?.screenshotSha256}
                screenshotBytes={lastProbedInfo?.bytes ?? cand?.screenshotBytes}
                s3ScreenshotKey={lastProbedInfo?.s3Key ?? cand?.s3ScreenshotKey}
              />
              <DomSnapshotCard
                title={`Side B (${baselineLabel})`}
                metaRight={`${base?.durationMs ?? 72}ms`}
                testId={item.testId}
                testName={item.testName}
                url={base?.url || item.url}
                side="B"
                httpStatus={base?.actualStatus ?? 200}
                durationMs={base?.durationMs ?? 72}
                edgeHostname={base?.edgeHostname}
                edgeIp={base?.httpFlowSummary?.resolvedEdgeIp || base?.stagingEdgeIp}
                cacheStatus={base?.capturedHeaders?.['x-cache']?.split(' ')[0] || 'TCP_HIT'}
                footerLeft={`HTTP ${base?.actualStatus ?? 200} · ${base?.edgeHostname || 'prod'}`}
                footerRight={`Edge IP: ${base?.httpFlowSummary?.resolvedEdgeIp || base?.stagingEdgeIp || '23.212.251.15'}`}
                isRerunning={isRerunningTest}
                screenshotRevision={lastProbedInfo?.screenshotRevision ?? base?.screenshotRevision}
                lastCapturedAt={lastProbedInfo?.at ?? base?.screenshotCapturedAt}
                screenshotSha256={lastProbedInfo?.sha256 ?? base?.screenshotSha256}
                screenshotBytes={lastProbedInfo?.bytes ?? base?.screenshotBytes}
                s3ScreenshotKey={lastProbedInfo?.s3Key ?? base?.s3ScreenshotKey}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// SINGLE RUN 4-DIMENSION INSPECTOR (REUSES SHARED PRIMITIVES)
// ============================================================================
export const SingleRunInspector: React.FC<{
  result: TestResult;
  targetLabel: string;
  runLabel: string;
  isRerunning: boolean;
  onRerunTest: (testId: string) => void;
  activeTab?: InspectorDimension;
  onTabChange?: (tab: InspectorDimension) => void;
  lastProbedInfo?: LiveProbeFeedback;
}> = ({
  result,
  targetLabel,
  runLabel,
  isRerunning,
  onRerunTest,
  activeTab: controlledTab,
  onTabChange,
  lastProbedInfo,
}) => {
  const [internalTab, setInternalTab] = useState<InspectorDimension>('flow');
  const [activeHopIdx, setActiveHopIdx] = useState<number | null>(0);
  const activeTab = controlledTab ?? internalTab;
  const handleTabChange = (v: string) => {
    const next = v as InspectorDimension;
    setInternalTab(next);
    onTabChange?.(next);
  };

  React.useEffect(() => {
    setActiveHopIdx(0);
  }, [result.id]);

  const headers = Object.entries(result.capturedHeaders || {});
  const cookies = Object.entries(result.capturedCookies || {});
  const hops = result.redirectChain || [];

  return (
    <Card>
      <InspectorActionHeader
        testId={result.id}
        testName={result.name}
        subtitle={`${result.url} · Edge: ${result.edgeHostname}`}
        statusBadge={{
          pass: result.pass,
          status: result.actualStatus,
          durationMs: result.durationMs,
        }}
        hopCount={hops.length || 1}
        isRerunning={isRerunning}
        onRerun={() => onRerunTest(result.id)}
        curlTarget={result}
        lastProbedInfo={lastProbedInfo}
      />

      <CardContent className="p-3.5">
        <HttpFlowHopChainBanner
          result={result}
          activeTab={activeTab}
          activeHopIndex={activeHopIdx}
          onInspectFlowTab={(hopIdx) => {
            handleTabChange('flow');
            if (typeof hopIdx === 'number') setActiveHopIdx(hopIdx);
          }}
        />

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
            <TabsList className="h-8 flex-wrap">
              <TabsTrigger value="flow" className="gap-1.5 text-xs">
                <Activity className="w-3 h-3 text-sky-500" />
                <span>HTTP Flow ({hops.length || 1})</span>
              </TabsTrigger>
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

          <TabsContent value="flow" className="mt-0 space-y-2.5">
            {hops.map((hop, idx) => (
              <HttpHopDetailCard
                key={idx}
                hop={hop}
                index={idx}
                isExpanded={activeHopIdx === idx}
                onToggleExpand={() =>
                  setActiveHopIdx((prev) => (prev === idx ? null : idx))
                }
                onPrevHop={idx > 0 ? () => setActiveHopIdx(idx - 1) : undefined}
                onNextHop={
                  idx < hops.length - 1 ? () => setActiveHopIdx(idx + 1) : undefined
                }
              />
            ))}
          </TabsContent>

          <TabsContent value="headers" className="mt-0">
            <div className="rounded-md border border-border overflow-x-auto">
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
            <div className="rounded-md border border-border overflow-x-auto">
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
              title={`Captured DOM Snapshot (1280×760) · ${result.name}`}
              metaRight={`${result.edgeHostname} · ${result.durationMs}ms`}
              testId={result.id}
              testName={result.name}
              url={result.url}
              side="single"
              httpStatus={result.actualStatus}
              durationMs={result.durationMs}
              edgeHostname={result.edgeHostname}
              edgeIp={result.httpFlowSummary?.resolvedEdgeIp || result.stagingEdgeIp}
              footerLeft={`HTTP ${result.actualStatus} · ${result.edgeHostname}`}
              footerRight={`Cacheable: ${
                result.capturedHeaders['x-check-cacheable'] || 'YES'
              }`}
              isRerunning={isRerunning}
              screenshotRevision={lastProbedInfo?.screenshotRevision ?? result.screenshotRevision}
              lastCapturedAt={lastProbedInfo?.at ?? result.screenshotCapturedAt}
              screenshotSha256={lastProbedInfo?.sha256 ?? result.screenshotSha256}
              screenshotBytes={lastProbedInfo?.bytes ?? result.screenshotBytes}
              s3ScreenshotKey={lastProbedInfo?.s3Key ?? result.s3ScreenshotKey}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
