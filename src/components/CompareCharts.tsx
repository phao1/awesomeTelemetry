import { ta } from '../i18n.js';
import { useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import { TRACE_KINDS, TRACE_PHASES } from '../core/trace-types.js';
import {
  compareSideStats,
  eventKindCounts,
  phaseDurations,
} from './compare-stats.js';
import type { CompareResult } from './compare-types.js';
import { TokenTextModal, type TokenClass } from './TokenTextModal.js';
import { RadarChart as RadarChartBase } from './charts/RadarChart.js';
import { DonutRing } from './charts/DonutChart.js';
import type { ChartSlice, ChartTone } from './charts/types.js';

/** 建议 1-① + REQ-119：8 轴综合能力雷达图（速度/省Token/工具/LLM/写入/读取/稳定性/验证）。
 * 归一化在此完成，几何绘制委托给可复用的 `charts/RadarChart`。 */
export function RadarChart({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const speed = result.speed;
  const ls = compareSideStats(leftEvents, speed.left, result.left.session);
  const rs = compareSideStats(rightEvents, speed.right, result.right.session);
  const lErr = leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.status === 'error').length / leftEvents.length;
  const rErr = rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.status === 'error').length / rightEvents.length;
  const lVerify = leftEvents.length === 0 ? 0 : leftEvents.filter((e) => e.phase === 'verify').length / leftEvents.length;
  const rVerify = rightEvents.length === 0 ? 0 : rightEvents.filter((e) => e.phase === 'verify').length / rightEvents.length;
  const avgTool = (events: TraceEventSlim[]): number => {
    const tools = events.filter((e) => e.tool !== null);
    return tools.length === 0 ? 0 : tools.reduce((sum, e) => sum + e.durationMs, 0) / tools.length;
  };

  const axes = useMemo(() => {
    const defs: Array<{ label: string; lv: number; rv: number; lowerBetter: boolean }> = [
      { label: t('metric.speed', locale), lv: speed.left.e2eMs ?? 0, rv: speed.right.e2eMs ?? 0, lowerBetter: true },
      { label: t('session.tokens', locale), lv: result.left.session.tokenUsage.total, rv: result.right.session.tokenUsage.total, lowerBetter: true },
      { label: t('compare.radar.tool', locale), lv: avgTool(leftEvents), rv: avgTool(rightEvents), lowerBetter: true },
      { label: t('compare.radar.llm', locale), lv: speed.left.tps ?? 0, rv: speed.right.tps ?? 0, lowerBetter: false },
      { label: t('compare.radar.write', locale), lv: ls.fileWrites, rv: rs.fileWrites, lowerBetter: false },
      { label: t('compare.radar.read', locale), lv: ls.fileReads, rv: rs.fileReads, lowerBetter: false },
      { label: t('compare.radar.stability', locale), lv: 1 - lErr, rv: 1 - rErr, lowerBetter: false },
      { label: t('compare.radar.verify', locale), lv: lVerify, rv: rVerify, lowerBetter: false },
    ];
    return defs.map((d) => {
      const max = Math.max(d.lv, d.rv, 0.001);
      const norm = (v: number): number => (d.lowerBetter ? (max - v) / max : v / max);
      return { ...d, l: norm(d.lv), r: norm(d.rv) };
    });
  }, [result, speed, ls, rs, lErr, rErr, lVerify, rVerify, locale]);

  return (
    <RadarChartBase
      data={axes.map((axis) => ({ axis: axis.label, values: [axis.l, axis.r] }))}
      colors={['var(--accent-fg)', 'var(--attention-fg)']}
      fills={['var(--accent-subtle)', 'var(--attention-subtle)']}
      size={220}
      ariaLabel={t('compare.radar', locale)}
    />
  );
}

const TOKEN_CLASSES = ['system', 'input', 'reasoning', 'output'] as const;
const TOKEN_CLASS_TONE: Record<(typeof TOKEN_CLASSES)[number], ChartTone> = {
  system: 'accent',
  input: 'neutral',
  reasoning: 'done',
  output: 'success',
};

function sideTokenValues(result: CompareResult, side: 'left' | 'right'): Record<(typeof TOKEN_CLASSES)[number], number> {
  const session = result[side].session;
  const speed = result.speed[side];
  return {
    system: speed.systemPromptTokensEstimate ?? 0,
    input: session.tokenUsage.input,
    reasoning: session.tokenUsage.reasoning,
    output: session.tokenUsage.output,
  };
}

/**
 * 建议 1-② + REQ-101 + REQ-120：双环 Token 构成环形图（内环 L / 外环 R，
 * system/input/reasoning/output），段可点击打开 TokenTextModal。
 * 弧段几何委托给 `charts/DonutChart` 的 `DonutRing` 原语，不再重复实现。
 */
export function TokenDonutChart({
  result,
  locale,
  onSegmentClick,
}: {
  result: CompareResult;
  locale: Locale;
  onSegmentClick?: (side: 'left' | 'right', tokenClass: TokenClass) => void;
}): React.JSX.Element {
  const left = sideTokenValues(result, 'left');
  const right = sideTokenValues(result, 'right');
  const maxTotal = Math.max(
    1,
    TOKEN_CLASSES.reduce((s, k) => s + left[k], 0),
    TOKEN_CLASSES.reduce((s, k) => s + right[k], 0),
  );
  // 双环共享同一刻度与同一弧长基准（保持与重构前逐像素一致）。
  const CIRC = 2 * Math.PI * 50;
  const slicesOf = (
    values: Record<(typeof TOKEN_CLASSES)[number], number>,
  ): ChartSlice[] =>
    TOKEN_CLASSES.map((cls) => ({ label: cls, value: values[cls], tone: TOKEN_CLASS_TONE[cls] }));
  const ring = (
    values: Record<(typeof TOKEN_CLASSES)[number], number>,
    r: number,
    thickness: number,
    side: 'left' | 'right',
  ): React.JSX.Element => (
    <DonutRing
      slices={slicesOf(values)}
      cx={120}
      cy={110}
      r={r}
      thickness={thickness}
      total={maxTotal}
      circumference={CIRC}
      segmentClassName="compare-chart-donut-seg"
      ariaLabelPrefix={side === 'left' ? 'L' : 'R'}
      onSliceClick={
        onSegmentClick === undefined
          ? undefined
          : (label) => onSegmentClick(side, label as TokenClass)
      }
    />
  );

  return (
    <div className="compare-chart-donut">
      <svg viewBox="0 0 240 220" width="100%" height={220} role="img" aria-label={t('compare.charts.tokenDonut', locale)}>
        <circle cx={120} cy={110} r={50} fill="none" stroke="var(--canvas-subtle)" strokeWidth={12} />
        {ring(left, 50, 12, 'left')}
        <circle cx={120} cy={110} r={68} fill="none" stroke="var(--canvas-subtle)" strokeWidth={12} />
        {ring(right, 68, 12, 'right')}
        <text x={120} y={104} textAnchor="middle" fill="var(--fg-default)" fontSize={11} fontWeight={600}>
          L
        </text>
        <text x={120} y={120} textAnchor="middle" fill="var(--fg-muted)" fontSize={8}>
          {TOKEN_CLASSES.reduce((s, k) => s + left[k], 0).toLocaleString()}
        </text>
        <text x={120} y={150} textAnchor="middle" fill="var(--fg-muted)" fontSize={8}>
          R
        </text>
        <text x={120} y={162} textAnchor="middle" fill="var(--fg-default)" fontSize={10} fontWeight={600}>
          {TOKEN_CLASSES.reduce((s, k) => s + right[k], 0).toLocaleString()}
        </text>
      </svg>
      <ul className="compare-chart-legend">
        {TOKEN_CLASSES.map((cls) => (
          <li key={cls}>
            <span className="compare-chart-swatch" style={{ background: `var(--${TOKEN_CLASS_TONE[cls]}-emphasis)` }} />
            <span>{t(`compare.charts.tokenClass.${cls}`, locale)}</span>
            <span className="mono">{left[cls].toLocaleString()}</span>
            <span className="mono">{right[cls].toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 建议 1-③：6 阶段双向耗时条形图（SVG 发散条，左 accent / 右 attention）。 */
export function PhaseBarChart({
  result,
}: {
  result: CompareResult;
}): React.JSX.Element {
  const left = phaseDurations(result.left.events as TraceEventSlim[]);
  const right = phaseDurations(result.right.events as TraceEventSlim[]);
  const max = Math.max(
    1,
    ...TRACE_PHASES.map((phase) => Math.max(left[phase], right[phase])),
  );
  const rowHeight = 26;
  const axisX = 170;
  const barMax = 130;
  const height = TRACE_PHASES.length * rowHeight + 8;

  return (
    <svg viewBox={`0 0 440 ${height}`} width="100%" height={height} role="img" aria-label={ta('a11y.phaseDurationChart')}>
      <line x1={axisX} y1={4} x2={axisX} y2={height - 4} stroke="var(--border-default)" strokeWidth={1} />
      {TRACE_PHASES.map((phase, i) => {
        const y = 8 + i * rowHeight;
        const lw = (left[phase] / max) * barMax;
        const rw = (right[phase] / max) * barMax;
        return (
          <g key={phase}>
            <circle cx={8} cy={y + 5} r={3} fill={`var(--phase-${phase})`} />
            <text x={16} y={y + 8} fill="var(--fg-muted)" fontSize={9}>
              {phase}
            </text>
            <text x={axisX - 5} y={y + 8} textAnchor="end" fill="var(--accent-fg)" fontSize={8} className="mono">
              {(left[phase] / 1000).toFixed(1)}s
            </text>
            <rect x={axisX - lw} y={y} width={lw} height={7} rx={2} fill="var(--accent-emphasis)" />
            <rect x={axisX} y={y} width={rw} height={7} rx={2} fill="var(--attention-emphasis)" />
            <text x={axisX + rw + 5} y={y + 8} fill="var(--attention-fg)" fontSize={8} className="mono">
              {(right[phase] / 1000).toFixed(1)}s
            </text>
          </g>
        );
      })}
      <text x={axisX - 5} y={height - 2} textAnchor="end" fill="var(--accent-fg)" fontSize={8}>
        L
      </text>
      <text x={axisX + 5} y={height - 2} fill="var(--attention-fg)" fontSize={8}>
        R
      </text>
    </svg>
  );
}

/** 建议 1-④：事件类型分布（10+ 种 kind 横向条形，左 accent / 右 attention）。 */
export function EventKindChart({
  result,
}: {
  result: CompareResult;
}): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const lKinds = eventKindCounts(leftEvents);
  const rKinds = eventKindCounts(rightEvents);
  const kindMax = Math.max(1, ...TRACE_KINDS.map((k) => Math.max(lKinds.get(k) ?? 0, rKinds.get(k) ?? 0)));
  return (
    <div className="compare-dist">
      {TRACE_KINDS.map((kind) => {
        const lc = lKinds.get(kind) ?? 0;
        const rc = rKinds.get(kind) ?? 0;
        if (lc === 0 && rc === 0) {
          return null;
        }
        return (
          <div key={kind} className="compare-dist-row">
            <span className="mono compare-dist-label">{kind}</span>
            <div className="compare-dist-bars">
              <div className="ui-bar-meter">
                <div className="ui-bar-meter-fill" style={{ width: `${(lc / kindMax) * 100}%`, background: 'var(--accent-emphasis)' }} />
              </div>
              <div className="ui-bar-meter">
                <div className="ui-bar-meter-fill" style={{ width: `${(rc / kindMax) * 100}%`, background: 'var(--attention-emphasis)' }} />
              </div>
            </div>
            <span className="mono compare-dist-count">{lc} / {rc}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 建议 1：Compare 图表 section（雷达 + 双环 + 阶段条 + 事件分布）。 */
export function CompareCharts({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const [openToken, setOpenToken] = useState<{ side: 'left' | 'right'; tokenClass: TokenClass } | null>(null);
  const side = openToken === null ? null : result[openToken.side];
  return (
    <>
      <div className="compare-charts">
        <div className="compare-chart">
          <h4>{t('compare.radar', locale)}</h4>
          <RadarChart result={result} locale={locale} />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.radar', locale)}</p>
        </div>
        <div className="compare-chart">
          <h4>{t('compare.charts.tokenDonut', locale)}</h4>
          <TokenDonutChart
            result={result}
            locale={locale}
            onSegmentClick={(s, tokenClass) => setOpenToken({ side: s, tokenClass })}
          />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.tokenDonut', locale)}</p>
        </div>
        <div className="compare-chart">
          <h4>{t('compare.charts.phaseBar', locale)}</h4>
          <PhaseBarChart result={result} />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.phaseBar', locale)}</p>
        </div>
        <div className="compare-chart">
          <h4>{t('compare.distribution', locale)}</h4>
          <EventKindChart result={result} />
          <p className="compare-chart-criteria">{t('compare.charts.criteria.distribution', locale)}</p>
        </div>
      </div>
      {side !== null && openToken !== null && (
        <TokenTextModal
          sessionKey={side.session.id}
          provider={side.session.provider}
          agentName={side.session.sourceAgent}
          tokenClass={openToken.tokenClass}
          tokenCount={(() => {
            const cls = openToken.tokenClass;
            if (cls === 'system') {
              return result.speed[openToken.side].systemPromptTokensEstimate ?? 0;
            }
            return side.session.tokenUsage[cls];
          })()}
          locale={locale}
          onClose={() => setOpenToken(null)}
        />
      )}
    </>
  );
}
