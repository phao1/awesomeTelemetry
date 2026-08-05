import type { ChartSlice, ChartTone } from './types.js';

export interface HBarChartProps {
  rows: ChartSlice[];
  /** 缺省 = 最大值；传入可让多图共用同一尺度。 */
  max?: number;
  tone?: ChartTone;
  width?: number;
  height?: number;
  /** 每行高度 px。 */
  rowHeight?: number;
  labelWidth?: number;
}

/** 排行 → 横向条形图（design-system REQ-010）。纯 SVG，无依赖。 */
export function HBarChart({
  rows,
  max,
  tone = 'accent',
  width = 520,
  height = 200,
  rowHeight = 18,
  labelWidth = 140,
}: HBarChartProps): React.JSX.Element {
  const peak = max ?? Math.max(0, ...rows.map((r) => r.value), 1);
  const barMax = Math.max(0, width - labelWidth - 42);
  return (
    <svg
      width="100%"
      height={Math.max(height, rows.length * (rowHeight + 6))}
      viewBox={`0 0 ${width} ${Math.max(height, rows.length * (rowHeight + 6))}`}
      role="img"
      aria-label="horizontal bar chart"
    >
      {rows.map((row, i) => {
        const y = 4 + i * (rowHeight + 6);
        const w = peak > 0 ? Math.max(1, (row.value / peak) * barMax) : 1;
        const fill = `var(--${row.tone ?? tone}-emphasis)`;
        return (
          <g key={row.label}>
            <text x={0} y={y + rowHeight - 5} fill="var(--fg-muted)" fontSize={11}>
              {row.label}
            </text>
            <rect
              x={labelWidth}
              y={y}
              width={w}
              height={rowHeight}
              rx={3}
              fill={fill}
            />
            <text x={labelWidth + w + 5} y={y + rowHeight - 5} fill="var(--fg-default)" fontSize={11}>
              {row.value.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
