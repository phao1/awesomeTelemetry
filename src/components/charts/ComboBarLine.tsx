import type { Locale } from '../../i18n.js';
import { useComponentCopy } from '../ui/component-copy.js';
import { EmptyState } from '../ui/States.js';
import { IconDashboard } from '../icons/index.js';
import { niceAxis } from './axis.js';
import { useChartWidth } from './CartesianChart.js';
import type { ChartTone } from './types.js';

export interface ComboBarLineProps {
  locale?: Locale;
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
  locale,
  bars,
  line,
  labels,
  barTone,
  lineTone,
  width = 520,
  height = 180,
}: ComboBarLineProps): React.JSX.Element {
  const copy=useComponentCopy(locale);
  const [ref,responsiveWidth]=useChartWidth(width); width=responsiveWidth;
  const count = Math.max(bars.length, line.length);
  if (count === 0) {
    return <EmptyState icon={<IconDashboard/>} title={copy.empty}/>;
  }
  const slot = width / count;
  const barMax = niceAxis(Math.max(0, ...bars)).max;
  const lineMax = niceAxis(Math.max(0, ...line)).max;
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
    <div ref={ref} className="instrument-chart"><svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="combo bar and line chart">
      {[.25,.5,.75,1].map(t=><line key={t} x1={0} x2={width} y1={plotBottom-t*(height-30)} y2={plotBottom-t*(height-30)} stroke="var(--chart-grid)" strokeDasharray="3 4"/>)}
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
            fill={barTone?`var(--${barTone}-emphasis)`:"var(--chart-1)"}
            fillOpacity={0.7}
          />
        );
      })}
      {linePoints !== '' && (
        <polyline
          points={linePoints}
          fill="none"
          stroke={lineTone?`var(--${lineTone}-emphasis)`:"var(--chart-2)"}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {labels !== undefined &&
        labels.map((label, i) => (
          <text key={`${label}-${i}`} x={i * slot + slot / 2} y={height - 4} fill="var(--fg-muted)" className="chart-axis" textAnchor="middle">
            {label}
          </text>
        ))}
    </svg></div>
  );
}
