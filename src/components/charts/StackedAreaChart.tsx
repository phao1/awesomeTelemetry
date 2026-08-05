import type { ChartTone, StackSeries } from './types.js';

export interface StackedAreaChartProps {
  series: StackSeries[];
  width?: number;
  height?: number;
  tones?: ChartTone[];
  xLabels?: string[];
}

/** 趋势 → 堆叠面积图（design-system REQ-010）。纯 SVG，无依赖。 */
export function StackedAreaChart({
  series,
  width = 520,
  height = 180,
  tones = ['accent', 'success', 'attention', 'danger', 'neutral'],
  xLabels,
}: StackedAreaChartProps): React.JSX.Element {
  const count = Math.max(0, ...series.map((s) => s.points.length));
  if (count < 2) {
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="stacked area chart" />
    );
  }
  const step = width / (count - 1);
  const stacks: number[] = new Array(count).fill(0);
  const areas = series.map((s, si) => {
    const cumulative = s.points.map((p, i) => {
      stacks[i]! += Math.max(0, p);
      return stacks[i]!;
    });
    const total = Math.max(...stacks, 1);
    const top = cumulative
      .map((p, i) => `${(i * step).toFixed(1)},${(height - 2 - (p / total) * (height - 6)).toFixed(1)}`)
      .join(' ');
    return {
      label: s.label,
      path: `M 0,${height - 2} L ${top} L ${(width).toFixed(1)},${height - 2} Z`,
      fill: `var(--${tones[si % tones.length]}-emphasis)`,
    };
  });
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="stacked area chart">
      {areas.map((area) => (
        <path key={area.label} d={area.path} fill={area.fill} fillOpacity={0.55} />
      ))}
      {xLabels !== undefined &&
        xLabels.map((label, i) => (
          <text key={`${label}-${i}`} x={i * step} y={height - 2} fill="var(--fg-muted)" fontSize={9} textAnchor="middle">
            {label}
          </text>
        ))}
    </svg>
  );
}
