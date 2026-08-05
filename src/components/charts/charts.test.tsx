import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { CalendarGrid } from './CalendarGrid.js';
import { ComboBarLine } from './ComboBarLine.js';
import { DonutChart } from './DonutChart.js';
import { HBarChart } from './HBarChart.js';
import { HeatmapGrid } from './HeatmapGrid.js';
import { Histogram } from './Histogram.js';
import { StackedAreaChart } from './StackedAreaChart.js';

describe('add-mission-control §8.1：7 个 SVG 图表原子', () => {
  it('全部原子都能渲染（冒烟，无 NaN/空 svg）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: ReturnType<typeof createRoot> | undefined;
    try {
      act(() => {
        root = createRoot(host);
        root.render(
          <>
            <HBarChart rows={[{ label: 'Bash', value: 42 }, { label: 'Read', value: 7 }]} />
            <DonutChart slices={[{ label: 'a', value: 3 }, { label: 'b', value: 1 }]} />
            <HeatmapGrid grid={[[1, 0, 2], [0, 0, 0], [3, 4, 5], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]} />
            <StackedAreaChart series={[{ label: 'in', points: [1, 2, 3] }, { label: 'out', points: [1, 1, 1] }]} />
            <Histogram buckets={[{ label: '0', value: 5 }, { label: '1-5', value: 3 }]} />
            <CalendarGrid days={[{ day: '2026-08-01', sessions: 2, hasError: true }, { day: '2026-08-02', sessions: 0, hasError: false }]} />
            <ComboBarLine bars={[1, 2, 3]} line={[3, 2, 1]} labels={['a', 'b', 'c']} />
          </>,
        );
      });
      expect(host.querySelectorAll('svg').length).toBe(7);
      expect(host.querySelectorAll('rect').length).toBeGreaterThanOrEqual(2 + 21 + 2 + 3);
      expect(host.querySelectorAll('circle').length).toBeGreaterThan(1);
      expect(host.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
      expect(host.querySelectorAll('polyline').length).toBe(1);
    } finally {
      act(() => {
        root?.unmount();
      });
      host.remove();
    }
  });
});
