import type { ChartTone } from './types.js';

export interface HeatmapGridProps {
  /** 7×24 网格，grid[weekday][hour]，weekday 0=周一。 */
  grid: number[][];
  peak?: number;
  tone?: ChartTone;
  cellSize?: number;
  gap?: number;
  /** 7 个 weekday 标签（缺省用周一…周日）。 */
  rowLabels?: string[];
}

/** 时间×类目 → 热力图（design-system REQ-010）。纯 SVG，无依赖。 */
export function HeatmapGrid({
  grid,
  peak,
  tone = 'accent',
  cellSize = 12,
  gap = 2,
  rowLabels,
}: HeatmapGridProps): React.JSX.Element {
  const max = peak ?? Math.max(0, ...grid.flat(), 1);
  const labelWidth = rowLabels !== undefined && rowLabels.length > 0 ? 24 : 0;
  const width = labelWidth + 24 * (cellSize + gap);
  const height = 7 * (cellSize + gap) + 4;
  const labels = rowLabels ?? ['一', '二', '三', '四', '五', '六', '日'];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="activity heatmap">
      {grid.map((row, weekday) =>
        row.map((value, hour) => {
          const opacity = value > 0 ? Math.max(0.12, Math.min(1, value / max)) : 0;
          return (
            <rect
              key={`${weekday}-${hour}`}
              x={labelWidth + hour * (cellSize + gap)}
              y={2 + weekday * (cellSize + gap)}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={value > 0 ? `var(--${tone}-emphasis)` : 'var(--canvas-subtle)'}
              fillOpacity={value > 0 ? opacity : 1}
            />
          );
        }),
      )}
      {labels.map((label, i) => (
        <text key={label} x={0} y={14 + i * (cellSize + gap)} fill="var(--fg-muted)" fontSize={9}>
          {label}
        </text>
      ))}
    </svg>
  );
}
