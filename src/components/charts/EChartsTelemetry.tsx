import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';
import { GLOBAL_EXECUTION_POPS, TestCaseDefinition } from '../../config/template.config';
import {
  FleetPropertyTelemetryRow,
  FleetRegionalPopSummary,
  FleetTimelineBucket,
  ScheduleGraphMode,
  SchedulePolicyConfig,
  ScheduledRunPoint,
} from '../../engine/scheduledRunsEngine';

const POP_PALETTE: Record<string, string> = {
  iad: '#0284c7',
  sjc: '#2563eb',
  ord: '#0891b2',
  lhr: '#7c3aed',
  fra: '#db2777',
  ams: '#9333ea',
  nrt: '#ea580c',
  sin: '#0d9488',
  syd: '#16a34a',
};

function useIsDarkDocument(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

interface BaseEChartsSurfaceProps {
  option: EChartsOption;
  heightClassName?: string;
  testId?: string;
  ariaLabel: string;
  onDataIndexClick?: (dataIndex: number, seriesName?: string) => void;
  onDataIndexHover?: (dataIndex: number | null) => void;
}

export const BaseEChartsSurface: React.FC<BaseEChartsSurfaceProps> = ({
  option,
  heightClassName = 'h-64',
  testId,
  ariaLabel,
  onDataIndexClick,
  onDataIndexHover,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const clickCallbackRef = useRef(onDataIndexClick);
  const hoverCallbackRef = useRef(onDataIndexHover);

  useEffect(() => {
    clickCallbackRef.current = onDataIndexClick;
    hoverCallbackRef.current = onDataIndexHover;
  }, [onDataIndexClick, onDataIndexHover]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const instance = echarts.init(el, undefined, {
      renderer: 'canvas',
    });
    chartRef.current = instance;

    instance.on('click', (params: unknown) => {
      const p = params as { dataIndex?: number; seriesName?: string; value?: unknown };
      if (typeof p?.dataIndex === 'number' && clickCallbackRef.current) {
        clickCallbackRef.current(p.dataIndex, p.seriesName);
      }
    });

    instance.on('mouseover', (params: unknown) => {
      const p = params as { dataIndex?: number };
      if (typeof p?.dataIndex === 'number' && hoverCallbackRef.current) {
        hoverCallbackRef.current(p.dataIndex);
      }
    });

    instance.on('globalout', () => {
      if (hoverCallbackRef.current) {
        hoverCallbackRef.current(null);
      }
    });

    const ro = new ResizeObserver(() => {
      instance.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      className={`w-full select-none ${heightClassName}`}
    />
  );
};

function getThemeTokens(isDark: boolean) {
  return {
    textPrimary: isDark ? '#f1f5f9' : '#0f172a',
    textMuted: isDark ? '#94a3b8' : '#64748b',
    gridLine: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
    axisLine: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(15, 23, 42, 0.16)',
    tooltipBg: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
    tooltipBorder: isDark ? '#334155' : '#cbd5e1',
    cardBg: isDark ? '#0f172a' : '#ffffff',
  };
}

export interface ScheduledRunsEChartProps {
  points: ScheduledRunPoint[];
  policy: SchedulePolicyConfig;
  graphMode: Exclude<ScheduleGraphMode, 'sla-availability'>;
  excludeMaintenanceWindows: boolean;
  selectedRunId?: string | null;
  onSelectRun: (runId: string) => void;
  onHoverRun: (runId: string | null) => void;
}

export const ScheduledRunsEChart: React.FC<ScheduledRunsEChartProps> = ({
  points,
  policy,
  graphMode,
  excludeMaintenanceWindows,
  selectedRunId,
  onSelectRun,
  onHoverRun,
}) => {
  const isDark = useIsDarkDocument();
  const tokens = getThemeTokens(isDark);

  const option = useMemo<EChartsOption>(() => {
    const xLabels = points.map((p) => p.timeLabel);

    // Build Maintenance Window MarkArea
    const markAreaData: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
    for (const mw of policy.maintenanceWindows) {
      if (points.length < 2) continue;
      const startIdx = Math.max(
        0,
        Math.min(points.length - 1, Math.floor((mw.startOffsetPct / 100) * (points.length - 1)))
      );
      const endIdx = Math.max(
        startIdx,
        Math.min(points.length - 1, Math.ceil((mw.endOffsetPct / 100) * (points.length - 1)))
      );
      markAreaData.push([
        {
          name: excludeMaintenanceWindows ? 'Maint. (SLA Purged)' : 'Maint. Window',
          xAxis: xLabels[startIdx],
          itemStyle: {
            color: isDark ? 'rgba(245, 158, 11, 0.10)' : 'rgba(245, 158, 11, 0.12)',
            borderColor: 'rgba(245, 158, 11, 0.35)',
            borderWidth: 1,
            borderType: 'dashed',
          },
          label: {
            color: isDark ? '#fbbf24' : '#b45309',
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            position: 'insideTopLeft',
          },
        },
        {
          xAxis: xLabels[endIdx],
        },
      ]);
    }

    // Build Deployment Marker MarkLines
    const deployMarkLines = points
      .filter((p) => Boolean(p.deploymentMarker))
      .map((p) => ({
        name: p.deploymentMarker || 'Deploy',
        xAxis: p.timeLabel,
        lineStyle: {
          color: '#6366f1',
          type: 'dotted' as const,
          width: 1.5,
        },
        label: {
          formatter: `▼ ${p.deploymentMarker}`,
          color: isDark ? '#a5b4fc' : '#4f46e5',
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          position: 'insideEndTop' as const,
        },
      }));

    const baseGrid = {
      top: 34,
      right: 52,
      bottom: 28,
      left: 48,
      containLabel: false,
    };

    const commonTooltip = {
      trigger: 'axis' as const,
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.tooltipBorder,
      borderWidth: 1,
      textStyle: {
        color: tokens.textPrimary,
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      axisPointer: {
        type: 'cross' as const,
        lineStyle: { color: tokens.axisLine, width: 1, type: 'dashed' as const },
        crossStyle: { color: tokens.axisLine, width: 1 },
      },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number } | undefined;
        const idx = typeof first?.dataIndex === 'number' ? first.dataIndex : 0;
        const pt = points[idx];
        if (!pt) return '';
        const verdictColor =
          pt.verdict === 'NO-GO'
            ? '#e11d48'
            : pt.verdict === 'REVIEW'
            ? '#d97706'
            : '#10b981';
        const diffSummary =
          pt.headerDiffs + pt.cookieDiffs + pt.visualDiffs === 0
            ? '0 contract diffs'
            : `${pt.headerDiffs}H · ${pt.cookieDiffs}C · ${pt.visualDiffs}V`;

        return [
          `<div style="font-family:JetBrains Mono,monospace;font-size:11px;line-height:1.45;min-width:230px">`,
          `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${tokens.tooltipBorder};padding-bottom:4px;margin-bottom:4px">`,
          `<strong>${pt.runId}</strong>`,
          `<span style="color:${verdictColor};font-weight:700">${pt.verdict} (${pt.availabilityPct}%)</span>`,
          `</div>`,
          `<div style="color:${tokens.textMuted};font-size:10px;margin-bottom:4px">${pt.shortDateLabel} · ${pt.popCode} (${pt.popCity})</div>`,
          `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px">`,
          `<span>Candidate: <strong>${pt.totalMs}ms</strong></span>`,
          `<span>Baseline: <strong>${pt.baselineTotalMs}ms</strong></span>`,
          `<span>P95 / P99: <strong>${pt.p95Ms} / ${pt.p99Ms}ms</strong></span>`,
          `<span>Cache Hit: <strong>${pt.cacheHitRatioPct}%</strong></span>`,
          `<span>LCP / FCP: <strong>${pt.lcpMs} / ${pt.fcpMs}ms</strong></span>`,
          `<span>Apdex: <strong>${pt.apdexScore.toFixed(2)}</strong></span>`,
          `</div>`,
          `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed ${tokens.tooltipBorder};font-size:10px">`,
          `DNS ${pt.dnsMs}ms · TCP ${pt.tcpMs}ms · TLS ${pt.tlsMs}ms · TTFB ${pt.ttfbMs}ms · Xfer ${pt.transferMs}ms<br/>`,
          `<span style="color:${tokens.textMuted}">Drift: ${diffSummary}${
            pt.deploymentMarker ? ` · ${pt.deploymentMarker}` : ''
          }</span>`,
          `</div>`,
          `</div>`,
        ].join('');
      },
    };

    if (graphMode === 'timeseries') {
      return {
        animationDuration: 260,
        grid: baseGrid,
        tooltip: commonTooltip,
        legend: {
          top: 2,
          left: 48,
          itemWidth: 12,
          itemHeight: 8,
          textStyle: {
            color: tokens.textMuted,
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
          },
        },
        dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
        xAxis: {
          type: 'category',
          data: xLabels,
          boundaryGap: false,
          axisLine: { lineStyle: { color: tokens.axisLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            hideOverlap: true,
          },
        },
        yAxis: [
          {
            type: 'value',
            splitLine: { lineStyle: { color: tokens.gridLine } },
            axisLabel: {
              color: tokens.textMuted,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
              formatter: '{value}ms',
            },
          },
          {
            type: 'value',
            min: 0,
            max: 100,
            splitLine: { show: false },
            axisLabel: {
              color: tokens.textMuted,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
              formatter: '{value}%',
            },
          },
        ],
        series: [
          {
            name: 'Candidate (ms)',
            type: 'line',
            smooth: 0.2,
            symbol: 'circle',
            symbolSize: (_val: unknown, params: { dataIndex: number }) => {
              const pt = points[params.dataIndex];
              if (!pt) return 5;
              if (pt.runId === selectedRunId) return 9;
              return pt.verdict === 'NO-GO' ? 7 : 5;
            },
            itemStyle: {
              color: (params: { dataIndex: number }) => {
                const pt = points[params.dataIndex];
                if (!pt) return '#0284c7';
                if (pt.verdict === 'NO-GO') return '#e11d48';
                if (pt.verdict === 'REVIEW') return '#d97706';
                return '#0284c7';
              },
              borderColor: tokens.cardBg,
              borderWidth: 1.5,
            },
            lineStyle: { color: '#0284c7', width: 2.2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(2, 132, 199, 0.24)' },
                { offset: 1, color: 'rgba(2, 132, 199, 0.01)' },
              ]),
            },
            data: points.map((p) => p.totalMs),
            markArea: markAreaData.length > 0 ? { silent: true, data: markAreaData } : undefined,
            markLine: {
              symbol: ['none', 'none'],
              silent: true,
              data: [
                {
                  name: 'SLA Warn',
                  yAxis: policy.slaWarningMs,
                  lineStyle: { color: '#d97706', type: 'dashed', width: 1.2 },
                  label: {
                    formatter: `Warn ${policy.slaWarningMs}ms`,
                    color: '#d97706',
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono, monospace',
                    position: 'insideEndTop',
                  },
                },
                {
                  name: 'SLA Crit',
                  yAxis: policy.slaCriticalMs,
                  lineStyle: { color: '#e11d48', type: 'dashed', width: 1.2 },
                  label: {
                    formatter: `Crit ${policy.slaCriticalMs}ms`,
                    color: '#e11d48',
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono, monospace',
                    position: 'insideEndTop',
                  },
                },
                ...deployMarkLines,
              ],
            },
          },
          {
            name: 'P95 Tail (ms)',
            type: 'line',
            smooth: 0.2,
            showSymbol: false,
            lineStyle: { color: '#8b5cf6', width: 1.4, type: 'dotted' },
            itemStyle: { color: '#8b5cf6' },
            data: points.map((p) => p.p95Ms),
          },
          {
            name: 'Prod Baseline (ms)',
            type: 'line',
            smooth: 0.2,
            showSymbol: false,
            lineStyle: { color: '#64748b', width: 1.5, type: 'dashed' },
            itemStyle: { color: '#64748b' },
            data: points.map((p) => p.baselineTotalMs),
          },
          {
            name: 'Cache Hit %',
            type: 'line',
            yAxisIndex: 1,
            smooth: 0.25,
            showSymbol: false,
            lineStyle: { color: '#10b981', width: 1.3, opacity: 0.8 },
            itemStyle: { color: '#10b981' },
            data: points.map((p) => p.cacheHitRatioPct),
          },
        ],
      };
    }

    if (graphMode === 'scatterplot') {
      // Group points by Edge PoP for distinct legend + outlier effectScatter
      const activePops = GLOBAL_EXECUTION_POPS.filter((pop) =>
        points.some((pt) => pt.popId === pop.id)
      );
      const popScatterSeries = activePops.map((pop) => ({
        name: pop.popCode.split('-')[0],
        type: 'scatter' as const,
        symbolSize: (val: number[]) => {
          const idx = val[0];
          const pt = points[idx];
          if (!pt) return 8;
          if (pt.runId === selectedRunId) return 13;
          const diffs = pt.headerDiffs + pt.cookieDiffs + pt.visualDiffs;
          return Math.min(16, 8 + diffs * 2.5);
        },
        itemStyle: {
          color: POP_PALETTE[pop.id] || '#0284c7',
          borderColor: tokens.cardBg,
          borderWidth: 1,
        },
        data: points
          .map((pt, idx) =>
            pt.popId === pop.id
              ? {
                  value: [idx, pt.totalMs],
                  itemStyle: {
                    color: POP_PALETTE[pop.id] || '#0284c7',
                    borderColor: pt.verdict === 'NO-GO' ? '#e11d48' : tokens.cardBg,
                    borderWidth: pt.verdict === 'NO-GO' ? 2.5 : 1,
                  },
                }
              : null
          )
          .filter((v): v is NonNullable<typeof v> => v !== null),
      }));

      return {
        animationDuration: 240,
        grid: baseGrid,
        tooltip: commonTooltip,
        legend: {
          top: 2,
          left: 48,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: {
            color: tokens.textMuted,
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
          },
        },
        xAxis: {
          type: 'category',
          data: xLabels,
          axisLine: { lineStyle: { color: tokens.axisLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            hideOverlap: true,
          },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: tokens.gridLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}ms',
          },
        },
        series: [
          ...popScatterSeries,
          {
            name: 'Prod Baseline',
            type: 'line',
            showSymbol: false,
            lineStyle: { color: '#64748b', width: 1.4, type: 'dashed' },
            itemStyle: { color: '#64748b' },
            data: points.map((p) => p.baselineTotalMs),
          },
        ],
      };
    }

    if (graphMode === 'cwv-cache') {
      return {
        animationDuration: 260,
        grid: baseGrid,
        tooltip: commonTooltip,
        legend: {
          top: 2,
          left: 48,
          itemWidth: 12,
          itemHeight: 8,
          textStyle: {
            color: tokens.textMuted,
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
          },
        },
        dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
        xAxis: {
          type: 'category',
          data: xLabels,
          axisLine: { lineStyle: { color: tokens.axisLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            hideOverlap: true,
          },
        },
        yAxis: [
          {
            type: 'value',
            splitLine: { lineStyle: { color: tokens.gridLine } },
            axisLabel: {
              color: tokens.textMuted,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
              formatter: '{value}ms',
            },
          },
          {
            type: 'value',
            min: 0,
            max: 100,
            splitLine: { show: false },
            axisLabel: {
              color: tokens.textMuted,
              fontSize: 9,
              fontFamily: 'JetBrains Mono, monospace',
              formatter: '{value}%',
            },
          },
        ],
        series: [
          {
            name: 'LCP (ms)',
            type: 'bar',
            barMaxWidth: 14,
            itemStyle: {
              color: (params: { dataIndex: number }) => {
                const pt = points[params.dataIndex];
                if (!pt) return '#0284c7';
                return pt.lcpMs > 2500 ? '#e11d48' : pt.lcpMs > 1800 ? '#f59e0b' : '#0284c7';
              },
              borderRadius: [2, 2, 0, 0],
            },
            data: points.map((p) => p.lcpMs),
            markLine: {
              symbol: ['none', 'none'],
              silent: true,
              data: [
                {
                  name: 'CWV Good LCP (2500ms)',
                  yAxis: 2500,
                  lineStyle: { color: '#10b981', type: 'dashed', width: 1.2 },
                  label: {
                    formatter: 'CWV Good LCP ≤ 2500ms',
                    color: '#10b981',
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono, monospace',
                    position: 'insideEndTop',
                  },
                },
              ],
            },
          },
          {
            name: 'FCP (ms)',
            type: 'line',
            smooth: 0.2,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: { color: '#6366f1', width: 1.8 },
            itemStyle: { color: '#6366f1' },
            data: points.map((p) => p.fcpMs),
          },
          {
            name: 'Cache Hit %',
            type: 'line',
            yAxisIndex: 1,
            smooth: 0.25,
            symbol: 'none',
            lineStyle: { color: '#10b981', width: 2 },
            itemStyle: { color: '#10b981' },
            data: points.map((p) => p.cacheHitRatioPct),
          },
          {
            name: 'Apdex × 100',
            type: 'line',
            yAxisIndex: 1,
            smooth: 0.25,
            symbol: 'none',
            lineStyle: { color: '#f59e0b', width: 1.5, type: 'dotted' },
            itemStyle: { color: '#f59e0b' },
            data: points.map((p) => Math.round(p.apdexScore * 100)),
          },
        ],
      };
    }

    // Mode: 'breakdown' (Stacked Network Phase Waterfall + Baseline + Cache Offload)
    return {
      animationDuration: 240,
      grid: baseGrid,
      tooltip: commonTooltip,
      legend: {
        top: 2,
        left: 48,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: {
          color: tokens.textMuted,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: tokens.axisLine } },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          hideOverlap: true,
        },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: tokens.gridLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}ms',
          },
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          splitLine: { show: false },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}%',
          },
        },
      ],
      series: [
        {
          name: 'DNS',
          type: 'bar',
          stack: 'phases',
          barMaxWidth: 16,
          itemStyle: { color: '#0ea5e9' },
          data: points.map((p) => p.dnsMs),
        },
        {
          name: 'TCP',
          type: 'bar',
          stack: 'phases',
          barMaxWidth: 16,
          itemStyle: { color: '#6366f1' },
          data: points.map((p) => p.tcpMs),
        },
        {
          name: 'TLS',
          type: 'bar',
          stack: 'phases',
          barMaxWidth: 16,
          itemStyle: { color: '#8b5cf6' },
          data: points.map((p) => p.tlsMs),
        },
        {
          name: 'TTFB',
          type: 'bar',
          stack: 'phases',
          barMaxWidth: 16,
          itemStyle: { color: '#f59e0b' },
          data: points.map((p) => p.ttfbMs),
        },
        {
          name: 'Transfer',
          type: 'bar',
          stack: 'phases',
          barMaxWidth: 16,
          itemStyle: { color: '#10b981', borderRadius: [2, 2, 0, 0] },
          data: points.map((p) => p.transferMs),
        },
        {
          name: 'Prod Baseline',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#64748b', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#64748b' },
          data: points.map((p) => p.baselineTotalMs),
        },
        {
          name: 'Origin Offload %',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#14b8a6', width: 1.4, type: 'dotted' },
          itemStyle: { color: '#14b8a6' },
          data: points.map((p) => p.originOffloadPct),
        },
      ],
    };
  }, [points, policy, graphMode, excludeMaintenanceWindows, selectedRunId, isDark, tokens]);

  return (
    <BaseEChartsSurface
      option={option}
      heightClassName="h-60 sm:h-64"
      testId="scheduled-runs-echart"
      ariaLabel={`Scheduled runs ${graphMode} interactive telemetry chart`}
      onDataIndexClick={(idx) => {
        const pt = points[idx];
        if (pt) onSelectRun(pt.runId);
      }}
      onDataIndexHover={(idx) => {
        if (idx === null) {
          onHoverRun(null);
          return;
        }
        const pt = points[idx];
        onHoverRun(pt ? pt.runId : null);
      }}
    />
  );
};

export interface ScheduleCheckHeatmapEChartProps {
  points: ScheduledRunPoint[];
  suite: TestCaseDefinition[];
  onSelectCell: (runId: string, testId: string) => void;
}

export const ScheduleCheckHeatmapEChart: React.FC<ScheduleCheckHeatmapEChartProps> = ({
  points,
  suite,
  onSelectCell,
}) => {
  const isDark = useIsDarkDocument();
  const tokens = getThemeTokens(isDark);
  const recentPoints = useMemo(() => points.slice(-24), [points]);

  const option = useMemo<EChartsOption>(() => {
    const xLabels = recentPoints.map((p) => p.timeLabel.replace(' UTC', ''));
    const yLabels = suite.map((tc) => `${tc.id} ${tc.name.slice(0, 14)}`);
    const heatmapData: Array<[number, number, number]> = [];

    recentPoints.forEach((pt, xIdx) => {
      suite.forEach((tc, yIdx) => {
        const snap = pt.checkSnapshots.find((c) => c.testId === tc.id);
        heatmapData.push([xIdx, yIdx, snap?.totalMs ?? pt.totalMs]);
      });
    });

    return {
      animationDuration: 200,
      grid: { top: 10, right: 56, bottom: 24, left: 112 },
      tooltip: {
        position: 'top',
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          color: tokens.textPrimary,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
        },
        formatter: (params: unknown) => {
          const p = params as { value?: [number, number, number] };
          const [xIdx = 0, yIdx = 0, ms = 0] = p.value || [];
          const pt = recentPoints[xIdx];
          const tc = suite[yIdx];
          if (!pt || !tc) return '';
          const snap = pt.checkSnapshots.find((c) => c.testId === tc.id);
          return `${pt.runId} (${pt.timeLabel})<br/><strong>${tc.id} ${tc.name}</strong>: ${ms}ms · ${
            snap?.verdict || pt.verdict
          } · ${snap?.cacheState || 'TCP_HIT'}`;
        },
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        splitArea: { show: true },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 8.5,
          fontFamily: 'JetBrains Mono, monospace',
          hideOverlap: true,
        },
      },
      yAxis: {
        type: 'category',
        data: yLabels,
        splitArea: { show: true },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      visualMap: {
        min: 50,
        max: 260,
        calculable: false,
        orient: 'vertical',
        right: 2,
        top: 'center',
        itemWidth: 10,
        itemHeight: 80,
        textStyle: {
          color: tokens.textMuted,
          fontSize: 8.5,
          fontFamily: 'JetBrains Mono, monospace',
        },
        inRange: {
          color: ['#10b981', '#0ea5e9', '#f59e0b', '#e11d48'],
        },
      },
      series: [
        {
          name: 'Check Latency Heatmap',
          type: 'heatmap',
          data: heatmapData,
          label: {
            show: recentPoints.length <= 18 && suite.length <= 10,
            fontSize: 8,
            fontFamily: 'JetBrains Mono, monospace',
            color: '#ffffff',
          },
          itemStyle: {
            borderColor: tokens.cardBg,
            borderWidth: 1.5,
            borderRadius: 2,
          },
        },
      ],
    };
  }, [recentPoints, suite, tokens]);

  return (
    <BaseEChartsSurface
      option={option}
      heightClassName="h-52"
      testId="schedule-sla-heatmap-echart"
      ariaLabel="Check by scheduled run latency heatmap"
      onDataIndexClick={(dataIndex) => {
        const totalY = Math.max(1, suite.length);
        const xIdx = Math.floor(dataIndex / totalY);
        const yIdx = dataIndex % totalY;
        const pt = recentPoints[xIdx];
        const tc = suite[yIdx];
        if (pt && tc) {
          onSelectCell(pt.runId, tc.id);
        }
      }}
    />
  );
};

export interface FleetTimelineEChartProps {
  timeline: FleetTimelineBucket[];
}

export const FleetTimelineEChart: React.FC<FleetTimelineEChartProps> = ({ timeline }) => {
  const isDark = useIsDarkDocument();
  const tokens = getThemeTokens(isDark);

  const option = useMemo<EChartsOption>(() => {
    const xLabels = timeline.map((b) => b.timeLabel);
    return {
      animationDuration: 240,
      grid: { top: 28, right: 44, bottom: 22, left: 42 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          color: tokens.textPrimary,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      legend: {
        top: 0,
        left: 42,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: {
          color: tokens.textMuted,
          fontSize: 9.5,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: tokens.axisLine } },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 8.5,
          fontFamily: 'JetBrains Mono, monospace',
          hideOverlap: true,
        },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: tokens.gridLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}ms',
          },
        },
        {
          type: 'value',
          min: 90,
          max: 100,
          splitLine: { show: false },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}%',
          },
        },
      ],
      series: [
        {
          name: 'P95 (ms)',
          type: 'line',
          smooth: 0.25,
          showSymbol: false,
          lineStyle: { color: '#0284c7', width: 2 },
          itemStyle: { color: '#0284c7' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(2, 132, 199, 0.22)' },
              { offset: 1, color: 'rgba(2, 132, 199, 0.01)' },
            ]),
          },
          data: timeline.map((b) => b.p95Ms),
        },
        {
          name: 'P50 (ms)',
          type: 'line',
          smooth: 0.25,
          showSymbol: false,
          lineStyle: { color: '#6366f1', width: 1.5 },
          itemStyle: { color: '#6366f1' },
          data: timeline.map((b) => b.p50Ms),
        },
        {
          name: 'Baseline (ms)',
          type: 'line',
          smooth: 0.25,
          showSymbol: false,
          lineStyle: { color: '#64748b', width: 1.3, type: 'dashed' },
          itemStyle: { color: '#64748b' },
          data: timeline.map((b) => b.baselineMs),
        },
        {
          name: 'Availability %',
          type: 'line',
          yAxisIndex: 1,
          smooth: 0.25,
          showSymbol: false,
          lineStyle: { color: '#10b981', width: 1.6 },
          itemStyle: { color: '#10b981' },
          data: timeline.map((b) => b.availabilityPct),
        },
      ],
    };
  }, [timeline, tokens]);

  return (
    <BaseEChartsSurface
      option={option}
      heightClassName="h-44"
      testId="fleet-timeline-echart"
      ariaLabel="Fleet P50 P95 latency and availability trend chart"
    />
  );
};

export interface FleetPropertyComparisonEChartProps {
  rows: FleetPropertyTelemetryRow[];
  onSelectProperty: (appId: string) => void;
}

export const FleetPropertyComparisonEChart: React.FC<FleetPropertyComparisonEChartProps> = ({
  rows,
  onSelectProperty,
}) => {
  const isDark = useIsDarkDocument();
  const tokens = getThemeTokens(isDark);
  const topRows = useMemo(() => rows.slice(0, 14), [rows]);

  const option = useMemo<EChartsOption>(() => {
    const xLabels = topRows.map((r) => r.appId);
    return {
      animationDuration: 240,
      grid: { top: 28, right: 44, bottom: 24, left: 34 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          color: tokens.textPrimary,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      legend: {
        top: 0,
        left: 34,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: {
          color: tokens.textMuted,
          fontSize: 9.5,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: tokens.axisLine } },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          interval: 0,
          rotate: topRows.length > 8 ? 22 : 0,
        },
      },
      yAxis: [
        {
          type: 'value',
          minInterval: 1,
          splitLine: { lineStyle: { color: tokens.gridLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono, monospace',
          },
        },
        {
          type: 'value',
          splitLine: { show: false },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}ms',
          },
        },
      ],
      series: [
        {
          name: 'Header Diffs',
          type: 'bar',
          stack: 'diffs',
          barMaxWidth: 16,
          itemStyle: { color: '#e11d48' },
          data: topRows.map((r) => r.headerDiffCount),
        },
        {
          name: 'Cookie Diffs',
          type: 'bar',
          stack: 'diffs',
          barMaxWidth: 16,
          itemStyle: { color: '#f59e0b' },
          data: topRows.map((r) => r.cookieDiffCount),
        },
        {
          name: 'Visual Diffs',
          type: 'bar',
          stack: 'diffs',
          barMaxWidth: 16,
          itemStyle: { color: '#8b5cf6', borderRadius: [2, 2, 0, 0] },
          data: topRows.map((r) => r.visualDiffCount),
        },
        {
          name: 'P95 Latency (ms)',
          type: 'line',
          yAxisIndex: 1,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#0284c7', width: 1.8 },
          itemStyle: { color: '#0284c7' },
          data: topRows.map((r) => r.p95Ms),
        },
      ],
    };
  }, [topRows, tokens]);

  return (
    <BaseEChartsSurface
      option={option}
      heightClassName="h-44"
      testId="fleet-property-comparison-echart"
      ariaLabel="Fleet property contract diffs and P95 latency comparison chart"
      onDataIndexClick={(idx) => {
        const row = topRows[idx];
        if (row) onSelectProperty(row.appId);
      }}
    />
  );
};

export interface FleetRegionalPopEChartProps {
  pops: FleetRegionalPopSummary[];
}

export const FleetRegionalPopEChart: React.FC<FleetRegionalPopEChartProps> = ({ pops }) => {
  const isDark = useIsDarkDocument();
  const tokens = getThemeTokens(isDark);

  const option = useMemo<EChartsOption>(() => {
    const xLabels = pops.map((p) => p.popCode.split('-')[0]);
    return {
      animationDuration: 240,
      grid: { top: 28, right: 42, bottom: 22, left: 42 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          color: tokens.textPrimary,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      legend: {
        top: 0,
        left: 42,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: {
          color: tokens.textMuted,
          fontSize: 9.5,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: tokens.axisLine } },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
        },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: tokens.gridLine } },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}ms',
          },
        },
        {
          type: 'value',
          min: 50,
          max: 100,
          splitLine: { show: false },
          axisLabel: {
            color: tokens.textMuted,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: '{value}%',
          },
        },
      ],
      series: [
        {
          name: 'P50 (ms)',
          type: 'bar',
          barMaxWidth: 12,
          itemStyle: { color: '#0ea5e9', borderRadius: [2, 2, 0, 0] },
          data: pops.map((p) => p.p50Ms),
        },
        {
          name: 'P95 (ms)',
          type: 'bar',
          barMaxWidth: 12,
          itemStyle: { color: '#6366f1', borderRadius: [2, 2, 0, 0] },
          data: pops.map((p) => p.p95Ms),
        },
        {
          name: 'Cache Hit %',
          type: 'line',
          yAxisIndex: 1,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#10b981', width: 1.8 },
          itemStyle: { color: '#10b981' },
          data: pops.map((p) => p.cacheHitRatioPct),
        },
      ],
    };
  }, [pops, tokens]);

  return (
    <BaseEChartsSurface
      option={option}
      heightClassName="h-44"
      testId="fleet-regional-pop-echart"
      ariaLabel="Global Edge PoP P50 P95 latency and cache hit ratio chart"
    />
  );
};
