import { useMemo } from 'react';

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

/** 建议 1-①：8 轴综合能力雷达图（速度/省Token/工具/LLM/写入/读取/稳定性/验证）。 */
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

  const n = axes.length;
  const cx = 100;
  const cy = 100;
  const radius = 72;
  const pointAt = (value: number, i: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value];
  };
  const points = (side: 'l' | 'r'): string =>
    axes.map((axis, i) => {
      const [x, y] = pointAt(axis[side], i);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  const ringPoints = (scale: number): string =>
    axes.map((_, i) => {
      const [x, y] = pointAt(scale, i);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  return (
    <svg viewBox="0 0 200 200" width="100%" height={220} role="img" aria-label={t('compare.radar', locale)}>
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon
          key={scale}
          points={ringPoints(scale)}
          fill="none"
          stroke="var(--border-muted)"
          strokeWidth={0.8}
        />
      ))}
      {axes.map((axis, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return (
          <line
            key={axis.label}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(angle) * radius}
            y2={cy + Math.sin(angle) * radius}
            stroke="var(--border-muted)"
            strokeWidth={0.8}
          />
        );
      })}
      <polygon points={points('l')} fill="var(--accent-subtle)" stroke="var(--accent-fg)" strokeWidth={1.5} />
      <polygon points={points('r')} fill="var(--attention-subtle)" stroke="var(--attention-fg)" strokeWidth={1.5} />
      {axes.map((axis, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (radius + 14);
        const ly = cy + Math.sin(angle) * (radius + 14);
        const anchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle';
        return (
          <text
            key={axis.label}
            x={lx}
            y={ly}
            fontSize={7.5}
            fill="var(--fg-muted)"
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {axis.label}
          </text>
        );
      })}
    </svg>
  );
}

const TOKEN_CLASSES = ['system', 'input', 'reasoning', 'output'] as const;
const TOKEN_CLASS_TONE: Record<(typeof TOKEN_CLASSES)[number], string> = {
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

/** 建议 1-②：双环 Token 构成环形图（内环 L / 外环 R，system/input/reasoning/output）。 */
export function TokenDonutChart({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const left = sideTokenValues(result, 'left');
  const right = sideTokenValues(result, 'right');
  const maxTotal = Math.max(
    1,
    TOKEN_CLASSES.reduce((s, k) => s + left[k], 0),
    TOKEN_CLASSES.reduce((s, k) => s + right[k], 0),
  );
  const CIRC = 2 * Math.PI * 50;
  const ring = (values: Record<(typeof TOKEN_CLASSES)[number], number>, r: number, thickness: number): React.JSX.Element[] => {
    let offset = 0;
    return TOKEN_CLASSES.map((cls) => {
      const length = (values[cls] / maxTotal) * CIRC;
      const el = (
        <circle
          key={cls}
          cx={120}
          cy={110}
          r={r}
          fill="none"
          stroke={`var(--${TOKEN_CLASS_TONE[cls]}-emphasis)`}
          strokeWidth={thickness}
          strokeDasharray={`${length} ${CIRC - length}`}
          strokeDashoffset={-offset}
        />
      );
      offset += length;
      return el;
    });
  };

  return (
    <div className="compare-chart-donut">
      <svg viewBox="0 0 240 220" width="100%" height={220} role="img" aria-label={t('compare.charts.tokenDonut', locale)}>
        <circle cx={120} cy={110} r={50} fill="none" stroke="var(--canvas-subtle)" strokeWidth={12} />
        {ring(left, 50, 12)}
        <circle cx={120} cy={110} r={68} fill="none" stroke="var(--canvas-subtle)" strokeWidth={12} />
        {ring(right, 68, 12)}
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
    <svg viewBox={`0 0 440 ${height}`} width="100%" height={height} role="img" aria-label="phase duration compare">
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
  return (
    <div className="compare-charts">
      <div className="compare-chart">
        <h4>{t('compare.radar', locale)}</h4>
        <RadarChart result={result} locale={locale} />
      </div>
      <div className="compare-chart">
        <h4>{t('compare.charts.tokenDonut', locale)}</h4>
        <TokenDonutChart result={result} locale={locale} />
      </div>
      <div className="compare-chart">
        <h4>{t('compare.charts.phaseBar', locale)}</h4>
        <PhaseBarChart result={result} />
      </div>
      <div className="compare-chart">
        <h4>{t('compare.distribution', locale)}</h4>
        <EventKindChart result={result} />
      </div>
    </div>
  );
}
