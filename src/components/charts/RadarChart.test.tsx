import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { RadarChart } from './RadarChart.js';

const containers: HTMLDivElement[] = [];

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

afterEach(() => {
  while (containers.length > 0) {
    containers.pop()?.remove();
  }
});

const axes4 = [
  { axis: 'a', values: [1, 0] },
  { axis: 'b', values: [0.5, 1] },
  { axis: 'c', values: [0, 0.25] },
  { axis: 'd', values: [0.75, 0.75] },
];

describe('REQ-119 可复用 RadarChart', () => {
  it('渲染 4 圈参考多边形 + N 条轴线 + N 个轴标签', () => {
    const container = render(<RadarChart data={axes4} colors={['var(--accent-fg)']} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    // 4 圈参考多边形 + 1 个系列多边形
    expect(svg.querySelectorAll('polygon').length).toBe(5);
    expect(svg.querySelectorAll('line').length).toBe(4);
    expect(svg.querySelectorAll('text').length).toBe(4);
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('支持 N 个系列：每个系列一条多边形，颜色/填充按下标取', () => {
    const container = render(
      <RadarChart
        data={axes4}
        colors={['var(--accent-fg)', 'var(--attention-fg)', 'var(--success-fg)']}
        fills={['var(--accent-subtle)', 'var(--attention-subtle)', 'var(--success-subtle)']}
      />,
    );
    const polygons = [...container.querySelectorAll('polygon')];
    // 前 4 个是参考圈（fill=none），后 3 个是系列
    const series = polygons.slice(4);
    expect(series.length).toBe(3);
    expect(series[0]!.getAttribute('stroke')).toBe('var(--accent-fg)');
    expect(series[0]!.getAttribute('fill')).toBe('var(--accent-subtle)');
    expect(series[2]!.getAttribute('stroke')).toBe('var(--success-fg)');
    expect(series[2]!.getAttribute('fill')).toBe('var(--success-subtle)');
  });

  it('几何与提取前一致：第 0 轴 value=1 落在正上方 (100, 28)', () => {
    const container = render(
      <RadarChart data={[{ axis: 'top', values: [1] }, { axis: 'x', values: [0] }]} colors={['var(--accent-fg)']} />,
    );
    const series = [...container.querySelectorAll('polygon')].slice(4)[0]!;
    // cx=100, cy=100, radius=72 → 第 0 轴（-90°）满值点为 100,28
    expect(series.getAttribute('points')!.split(' ')[0]).toBe('100.0,28.0');
  });

  it('fills 缺省时回退为 colors 同下标值', () => {
    const container = render(<RadarChart data={axes4} colors={['var(--accent-fg)']} />);
    const series = [...container.querySelectorAll('polygon')].slice(4)[0]!;
    expect(series.getAttribute('fill')).toBe('var(--accent-fg)');
  });
});
