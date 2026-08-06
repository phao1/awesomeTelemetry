import type { ChartTone } from './types.js';

export interface HeatmapChartProps {
  /** 每桶的量值（按时间顺序）。 */
  buckets: number[];
  /** 峰值（缺省取 buckets 最大值）；用于色阶归一化。 */
  peak?: number;
  /** 每行列数，超出换行。 */
  columns?: number;
  tone?: ChartTone;
  cellSize?: number;
  gap?: number;
  /** 每个格子的 title（hover 提示），下标与 buckets 对齐。 */
  titles?: string[];
  ariaLabel?: string;
}

/**
 * REQ-121：一维时间桶密度热力图（与 7×24 的 `HeatmapGrid` 互补）。
 * 纯 SVG，无依赖；色阶用 tone 的 `--*-emphasis` + 不透明度，不硬编码 hex。
 */
export function HeatmapChart({
  buckets,
  peak,
  columns = 30,
  tone = 'accent',
  cellSize = 14,
  gap = 3,
  titles,
  ariaLabel = 'density heatmap',
}: HeatmapChartProps): React.JSX.Element {
  const max = Math.max(1, peak ?? Math.max(0, ...buckets));
  const cols = Math.max(1, Math.min(columns, Math.max(1, buckets.length)));
  const rows = Math.max(1, Math.ceil(buckets.length / cols));
  const width = cols * (cellSize + gap);
  const height = rows * (cellSize + gap);
  return (
    <svg
      className="heatmap-chart"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={ariaLabel}
    >
      {buckets.map((value, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return (
          <rect
            key={i}
            x={col * (cellSize + gap)}
            y={row * (cellSize + gap)}
            width={cellSize}
            height={cellSize}
            rx={2}
            fill={value > 0 ? `var(--${tone}-emphasis)` : 'var(--canvas-subtle)'}
            fillOpacity={value > 0 ? Math.max(0.15, Math.min(1, value / max)) : 1}
          >
            {titles?.[i] !== undefined && <title>{titles[i]}</title>}
          </rect>
        );
      })}
    </svg>
  );
}
