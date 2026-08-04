import type { ReactNode } from 'react';

/** REQ-005：Kbd —— 渲染键位（⌘K / j / Esc）。 */
export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="ui-kbd">{children}</kbd>;
}

export type MetricTone = 'accent' | 'success' | 'attention' | 'danger' | 'neutral';

export interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  tone?: MetricTone;
}

/** REQ-005：MetricCard —— 快准稳省 KPI。 */
export function MetricCard({
  icon,
  label,
  value,
  unit,
  trend,
  tone = 'accent',
}: MetricCardProps): React.JSX.Element {
  return (
    <div className="ui-metric-card">
      <div className="ui-metric-card-header">
        <span style={{ color: `var(--${tone}-fg)` }}>{icon}</span>
        {label}
      </div>
      <div className="ui-metric-card-value">
        {value}
        {unit !== undefined && <span className="ui-metric-card-unit"> {unit}</span>}
      </div>
      {trend !== undefined && <div className="ui-metric-card-trend">{trend}</div>}
    </div>
  );
}

export interface BarMeterProps {
  value: number;
  max: number;
  tone?: MetricTone;
}

/** REQ-005：BarMeter —— 表格内联条形图（百分比宽度，禁止 px 字面量）。 */
export function BarMeter({ value, max, tone = 'neutral' }: BarMeterProps): React.JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="ui-bar-meter" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="ui-bar-meter-fill"
        style={{ width: `${pct}%`, background: `var(--${tone}-emphasis)` }}
      />
    </div>
  );
}

export interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
}

/** REQ-005：Sparkline —— 内联 SVG，无依赖。 */
export function Sparkline({ points, width = 100, height = 24 }: SparklineProps): React.JSX.Element {
  if (points.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="sparkline">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
        />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / span) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="sparkline">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
