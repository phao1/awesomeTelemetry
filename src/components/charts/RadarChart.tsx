/** REQ-119：可复用雷达图 —— 从 CompareCharts.tsx 提取，props 标准化为 N 个系列。 */

export interface RadarAxis {
  /** 轴标签（外圈文字）。 */
  axis: string;
  /** 每个系列在该轴上的归一化值（0..1），下标与 `colors` 对齐。 */
  values: number[];
}

export interface RadarChartProps {
  data: RadarAxis[];
  /** 每个系列的描边色（token 变量字符串，如 `var(--accent-fg)`）。 */
  colors: string[];
  /** 每个系列的填充色；缺省沿用 `colors` 同下标的值。 */
  fills?: string[];
  /** SVG 渲染高度（宽度始终 100%）。 */
  size?: number;
  ariaLabel?: string;
}

const VIEWBOX = 200;
const CENTER = 100;
const RADIUS = 72;
const RINGS = [0.25, 0.5, 0.75, 1];

/**
 * 8 轴（或任意轴数）× N 系列雷达图。纯 SVG，无依赖。
 * 归一化由调用方完成 —— 组件只负责几何与绘制，颜色全部来自 token 变量。
 */
export function RadarChart({
  data,
  colors,
  fills,
  size = 220,
  ariaLabel = 'radar chart',
}: RadarChartProps): React.JSX.Element {
  const n = data.length;
  const pointAt = (value: number, i: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [CENTER + Math.cos(angle) * RADIUS * value, CENTER + Math.sin(angle) * RADIUS * value];
  };
  const seriesPoints = (index: number): string =>
    data
      .map((axis, i) => {
        const [x, y] = pointAt(axis.values[index] ?? 0, i);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const ringPoints = (scale: number): string =>
    data
      .map((_, i) => {
        const [x, y] = pointAt(scale, i);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} width="100%" height={size} role="img" aria-label={ariaLabel}>
      {RINGS.map((scale) => (
        <polygon
          key={scale}
          points={ringPoints(scale)}
          fill="none"
          stroke="var(--border-muted)"
          strokeWidth={0.8}
        />
      ))}
      {data.map((axis, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return (
          <line
            key={axis.axis}
            x1={CENTER}
            y1={CENTER}
            x2={CENTER + Math.cos(angle) * RADIUS}
            y2={CENTER + Math.sin(angle) * RADIUS}
            stroke="var(--border-muted)"
            strokeWidth={0.8}
          />
        );
      })}
      {colors.map((stroke, index) => (
        <polygon
          key={`series-${index}`}
          points={seriesPoints(index)}
          fill={fills?.[index] ?? stroke}
          stroke={stroke}
          strokeWidth={1.5}
        />
      ))}
      {data.map((axis, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = CENTER + Math.cos(angle) * (RADIUS + 14);
        const ly = CENTER + Math.sin(angle) * (RADIUS + 14);
        const anchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle';
        return (
          <text
            key={axis.axis}
            x={lx}
            y={ly}
            fontSize={7.5}
            fill="var(--fg-muted)"
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {axis.axis}
          </text>
        );
      })}
    </svg>
  );
}
