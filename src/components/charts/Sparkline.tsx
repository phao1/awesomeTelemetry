import { useState } from 'react';

export interface SparklinePoint {
  value: number;
  /** hover tooltip 的标题行（如会话标题）。 */
  label?: string;
  /** hover tooltip 的时间行。 */
  at?: string;
}

export interface SparklineSeries {
  /** 系列名（图例 / tooltip 前缀）。 */
  label: string;
  points: SparklinePoint[];
  /** 线条颜色，必须是 token 变量字符串（如 `var(--provider-claude)`）。 */
  color: string;
}

export interface SparklineProps {
  series: SparklineSeries[];
  width?: number;
  height?: number;
  ariaLabel?: string;
  /** 数值格式化（tooltip 用）。 */
  format?: (value: number) => string;
}

const PAD = 2;

/**
 * REQ-122：多系列趋势 sparkline（跨会话指标趋势）。纯 SVG，无依赖。
 * 每个数据点带 `<title>`（原生 tooltip，测试可断言）+ hover 时的 HTML tooltip。
 * 所有系列共享同一纵轴刻度，便于左右直接比高低。
 */
export function Sparkline({
  series,
  width = 120,
  height = 28,
  ariaLabel = 'sparkline',
  format = (v) => v.toLocaleString(),
}: SparklineProps): React.JSX.Element {
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  const max = all.length === 0 ? 1 : Math.max(...all);
  const min = all.length === 0 ? 0 : Math.min(...all);
  const span = max - min || 1;
  const xAt = (i: number, n: number): number =>
    n <= 1 ? width / 2 : PAD + (i / (n - 1)) * (width - PAD * 2);
  const yAt = (value: number): number =>
    height - PAD - ((value - min) / span) * (height - PAD * 2);

  const hovered = hover === null ? null : series[hover.s]?.points[hover.i] ?? null;

  return (
    <span className="sparkline">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        {series.map((s, si) => {
          const n = s.points.length;
          if (n === 0) {
            return null;
          }
          const d = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i, n).toFixed(1)},${yAt(p.value).toFixed(1)}`)
            .join(' ');
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.2} />
              {s.points.map((p, i) => (
                <circle
                  key={i}
                  className="sparkline-dot"
                  cx={xAt(i, n)}
                  cy={yAt(p.value)}
                  r={hover?.s === si && hover.i === i ? 2.4 : 1.4}
                  fill={s.color}
                  onMouseEnter={() => setHover({ s: si, i })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {`${s.label} · ${p.label ?? ''} · ${format(p.value)}${p.at === undefined ? '' : ` · ${p.at}`}`}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {hovered !== null && (
        <span className="sparkline-tip" role="status">
          <span className="sparkline-tip-title">{hovered.label ?? series[hover!.s]!.label}</span>
          <span className="mono">{format(hovered.value)}</span>
          {hovered.at !== undefined && <span className="mono sparkline-tip-at">{hovered.at}</span>}
        </span>
      )}
    </span>
  );
}
