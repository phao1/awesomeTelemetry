import type { ChartSlice, ChartTone } from './types.js';

export interface DonutChartProps {
  slices: ChartSlice[];
  size?: number;
  thickness?: number;
  tone?: ChartTone;
  /** 中心主数字（缺省 = 总和）。 */
  centerLabel?: string;
}

const CIRCUMFERENCE = 2 * Math.PI * 50;

/** 占比 → 环形图（design-system REQ-010）。纯 SVG，无依赖。 */
export function DonutChart({
  slices,
  size = 160,
  thickness = 18,
  tone = 'accent',
  centerLabel,
}: DonutChartProps): React.JSX.Element {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="donut chart">
      <circle cx={60} cy={60} r={50} fill="none" stroke="var(--canvas-subtle)" strokeWidth={thickness} />
      {slices.map((slice) => {
        const length = (slice.value / total) * CIRCUMFERENCE;
        const el = (
          <circle
            key={slice.label}
            cx={60}
            cy={60}
            r={50}
            fill="none"
            stroke={`var(--${slice.tone ?? tone}-emphasis)`}
            strokeWidth={thickness}
            strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
            strokeDashoffset={-offset}
          />
        );
        offset += length;
        return el;
      })}
      <text x={60} y={58} textAnchor="middle" fill="var(--fg-default)" fontSize={16} fontWeight={600}>
        {centerLabel ?? total.toLocaleString()}
      </text>
      <text x={60} y={74} textAnchor="middle" fill="var(--fg-muted)" fontSize={10}>
        total
      </text>
    </svg>
  );
}
