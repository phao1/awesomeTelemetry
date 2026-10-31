import type { Locale } from '../../i18n.js';
import { useUiCopy } from '../ui/Locale.js';
import { EmptyState } from '../ui/States.js';
import { IconDashboard } from '../icons/index.js';
import type { KeyboardEvent } from 'react';

import type { ChartSlice, ChartTone } from './types.js';

export interface DonutRingProps {
  slices: ChartSlice[];
  cx: number;
  cy: number;
  r: number;
  thickness: number;
  /** Legacy concentric rings may opt out of the standard segment gap. */
  gap?: number;
  /** 归一化分母（缺省 = slices 之和）。多环共享同一刻度时由调用方传入。 */
  total?: number;
  /** 弧长基准周长（缺省 = 2πr）。多环共享同一基准时由调用方传入。 */
  circumference?: number;
  tone?: ChartTone;
  /** 段点击回调（传入 slice.label）；缺省时段不可交互。 */
  onSliceClick?: (label: string) => void;
  /** Omitted = all positive slices. Supplied labels may expose a real drill-down. */
  interactiveLabels?: readonly string[];
  /** 交互段的 class。 */
  segmentClassName?: string;
  /** 交互段 aria-label 前缀，如 "L" / "R"。 */
  ariaLabelPrefix?: string;
}

/**
 * REQ-120：环形弧段原语 —— DonutChart 与 CompareCharts 的 TokenDonutChart 共用，
 * 消除 strokeDasharray / strokeDashoffset 的重复实现。
 */
export function DonutRing({
  slices,
  cx,
  cy,
  r,
  thickness,
  gap: _gap = 2,
  total,
  circumference,
  tone: _tone = 'accent',
  onSliceClick,
  interactiveLabels,
  segmentClassName,
  ariaLabelPrefix,
}: DonutRingProps): React.JSX.Element {
  const sum = (total ?? slices.reduce((acc, s) => acc + s.value, 0)) || 1;
  const circ = circumference ?? 2 * Math.PI * r;
  let offset = 0;
  const segments = slices.map((slice, index) => {
    const length = (slice.value / sum) * circ;
    const interactive = onSliceClick !== undefined && length > 0
      && (interactiveLabels === undefined || interactiveLabels.includes(slice.label));
    const activate = (): void => {
      if (interactive) {
        onSliceClick(slice.label);
      }
    };
    const onKeyDown = (e: KeyboardEvent<SVGCircleElement>): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    };
    const el = (
      <circle
        key={slice.label}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={slice.tone ? `var(--${slice.tone}-emphasis)` : `var(--chart-${index % 8 + 1})`}
        strokeWidth={thickness}
        strokeDasharray={`${length} ${circ - length}`}
        strokeDashoffset={-offset}
        className={interactive ? segmentClassName : undefined}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          interactive
            ? ariaLabelPrefix === undefined
              ? slice.label
              : `${ariaLabelPrefix} ${slice.label}`
            : undefined
        }
        onClick={interactive ? activate : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
      />
    );
    offset += length;
    return el;
  });
  return <>{segments}</>;
}

export interface DonutChartProps {
  slices: ChartSlice[];
  size?: number;
  thickness?: number;
  tone?: ChartTone;
  /** 中心主数字（缺省 = 总和）。 */
  centerLabel?: string;
  locale?: Locale;
}

const CIRCUMFERENCE = 2 * Math.PI * 50;

/** 占比 → 环形图（design-system REQ-010）。纯 SVG，无依赖。 */
export function DonutChart({
  slices,
  size = 160,
  thickness = 18,
  tone = 'accent',
  centerLabel,locale,
}: DonutChartProps): React.JSX.Element {
  const copy=useUiCopy(locale);
  const total = slices.reduce((sum, s) => sum + Math.max(0,s.value), 0);
  if (!total) return <EmptyState icon={<IconDashboard/>} title={copy.empty}/>;
  return (
    <div className="chart-donut"><svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="donut chart">
      <circle cx={60} cy={60} r={50} fill="none" stroke="var(--canvas-subtle)" strokeWidth={thickness} />
      <DonutRing
        slices={slices}
        cx={60}
        cy={60}
        r={50}
        thickness={thickness}
        total={total}
        circumference={CIRCUMFERENCE}
        tone={tone}
      />
      <text x={60} y={58} textAnchor="middle" fill="var(--fg-default)" fontSize={20} fontWeight={600}>
        {centerLabel ?? total.toLocaleString()}
      </text>
      <text x={60} y={74} textAnchor="middle" fill="var(--fg-muted)" fontSize={10}>
        {copy.total}
      </text>
    </svg><div className="chart-donut-legend">{slices.map((s,i)=><div key={s.label}><i style={{background:s.tone?`var(--${s.tone}-emphasis)`:`var(--chart-${i%8+1})`}}/>{s.label}<strong className="num">{(s.value/total*100).toFixed(1)}%</strong></div>)}</div></div>
  );
}
