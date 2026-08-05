import type { ChartTone } from './types.js';

export interface CalendarDay {
  day: string;
  sessions: number;
  hasError: boolean;
}

export interface CalendarGridProps {
  days: CalendarDay[];
  tone?: ChartTone;
  cellSize?: number;
  gap?: number;
}

/** 日历 → 任务日历（design-system REQ-010）。纯 SVG，无依赖。 */
export function CalendarGrid({
  days,
  tone = 'accent',
  cellSize = 12,
  gap = 2,
}: CalendarGridProps): React.JSX.Element {
  const max = Math.max(0, ...days.map((d) => d.sessions), 1);
  const columns = Math.max(1, Math.ceil(days.length / 7));
  const width = columns * (cellSize + gap);
  const height = 7 * (cellSize + gap) + 4;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="task calendar">
      {days.map((day, i) => {
        const col = Math.floor(i / 7);
        const row = i % 7;
        const x = col * (cellSize + gap);
        const y = 2 + row * (cellSize + gap);
        const opacity = day.sessions > 0 ? Math.max(0.15, Math.min(1, day.sessions / max)) : 0;
        return (
          <g key={day.day}>
            <rect
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={day.sessions > 0 ? `var(--${tone}-emphasis)` : 'var(--canvas-subtle)'}
              fillOpacity={day.sessions > 0 ? opacity : 1}
            />
            {day.hasError && (
              <circle cx={x + cellSize - 1} cy={y + 1} r={1.8} fill="var(--danger-emphasis)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
