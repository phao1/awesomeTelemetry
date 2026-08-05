import type { ChartTone } from './types.js';

export interface ComboBarLineProps {
  /** 柱数据（主坐标轴）。 */
  bars: number[];
  /** 折线数据（独立坐标轴，避免被柱尺度压扁）。 */
  line: number[];
  labels?: string[];
  barTone?: ChartTone;
  lineTone?: ChartTone;
  width?: number;
  height?: number;
}

/** 柱 + 折线双轴（design-system REQ-010：A7 会话活跃曲线）。纯 SVG，无依赖。 */
export function ComboBarLine({
  bars,
  line,
  labels,
  barTone = 'accent',
  lineTone = 'success',
  width = 520,
  height = 180,
}: ComboBarLineProps): React.JSX.Element {
  const count = Math.max(bars.length, line.length);
  if (count === 0) {
    return <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="combo bar line chart" />;
  }
  const slot = width / count;
  const barMax = Math.max(0, ...bars, 1);
  const lineMax = Math.max(0, ...line, 1);
  const plotBottom = height - 18;
  const barW = Math.max(1, slot * 0.5);
  const linePoints = line
    .map((v, i) => {
      const x = i * slot + slot / 2;
      const y = plotBottom - (v / lineMax) * (height - 30);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="combo bar and line chart">
      {bars.map((v, i) => {
        const barHeight = Math.max(1, (v / barMax) * (height - 30));
        return (
          <rect
            key={`bar-${i}`}
            x={i * slot + (slot - barW) / 2}
            y={plotBottom - barHeight}
            width={barW}
            height={barHeight}
            rx={2}
            fill={`var(--${barTone}-emphasis)`}
            fillOpacity={0.7}
          />
        );
      })}
      {linePoints !== '' && (
        <polyline
          points={linePoints}
          fill="none"
          stroke={`var(--${lineTone}-emphasis)`}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {labels !== undefined &&
        labels.map((label, i) => (
          <text key={`${label}-${i}`} x={i * slot + slot / 2} y={height - 4} fill="var(--fg-muted)" fontSize={9} textAnchor="middle">
            {label}
          </text>
        ))}
    </svg>
  );
}
