import type { ChartSlice, ChartTone } from './types.js';

export interface HistogramProps {
  buckets: ChartSlice[];
  tone?: ChartTone;
  width?: number;
  height?: number;
}

/** 分布 → 直方图（design-system REQ-010）。纯 SVG，无依赖。 */
export function Histogram({
  buckets,
  tone = 'accent',
  width = 520,
  height = 160,
}: HistogramProps): React.JSX.Element {
  const max = Math.max(0, ...buckets.map((b) => b.value), 1);
  const slot = width / Math.max(buckets.length, 1);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="histogram">
      {buckets.map((b, i) => {
        const barHeight = Math.max(1, (b.value / max) * (height - 24));
        const x = i * slot + slot * 0.15;
        return (
          <g key={b.label}>
            <rect
              x={x}
              y={height - 18 - barHeight}
              width={slot * 0.7}
              height={barHeight}
              rx={2}
              fill={`var(--${b.tone ?? tone}-emphasis)`}
            />
            <text x={x + slot * 0.35} y={height - 4} fill="var(--fg-muted)" fontSize={9} textAnchor="middle">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
