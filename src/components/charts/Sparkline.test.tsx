import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { Sparkline, type SparklineSeries } from './Sparkline.js';

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

const series: SparklineSeries[] = [
  {
    label: 'L',
    color: 'var(--provider-claude)',
    points: [
      { value: 10, label: 'first', at: '2026-08-01 00:00' },
      { value: 30, label: 'second', at: '2026-08-02 00:00' },
      { value: 20, label: 'third', at: '2026-08-03 00:00' },
    ],
  },
  {
    label: 'R',
    color: 'var(--provider-codex)',
    points: [
      { value: 5, label: 'r1', at: '2026-08-01 00:00' },
      { value: 8, label: 'r2', at: '2026-08-02 00:00' },
      { value: 40, label: 'r3', at: '2026-08-03 00:00' },
    ],
  },
];

describe('REQ-122 Sparkline', () => {
  it('每个系列一条 path，颜色取自 token 变量', () => {
    const container = render(<Sparkline series={series} />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths.length).toBe(2);
    expect(paths[0]!.getAttribute('stroke')).toBe('var(--provider-claude)');
    expect(paths[1]!.getAttribute('stroke')).toBe('var(--provider-codex)');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it('所有系列共享同一纵轴：全局最大值在顶、最小值在底', () => {
    const container = render(<Sparkline series={series} width={100} height={20} />);
    const dots = [...container.querySelectorAll('circle')];
    expect(dots.length).toBe(6);
    const ys = dots.map((d) => Number(d.getAttribute('cy')));
    // 全局最小 5（R 的第 1 点）→ 最靠下；全局最大 40（R 的第 3 点）→ 最靠上
    expect(Math.max(...ys)).toBeCloseTo(ys[3]!, 6);
    expect(Math.min(...ys)).toBeCloseTo(ys[5]!, 6);
  });

  it('每个点带 title（会话标题 + 值 + 时间）', () => {
    const container = render(<Sparkline series={series} />);
    const titles = [...container.querySelectorAll('title')].map((el) => el.textContent);
    expect(titles[0]).toBe('L · first · 10 · 2026-08-01 00:00');
    expect(titles[5]).toBe('R · r3 · 40 · 2026-08-03 00:00');
  });

  it('hover 数据点显示 tooltip，移出后消失', () => {
    const container = render(<Sparkline series={series} />);
    expect(container.querySelector('.sparkline-tip')).toBeNull();
    const dot = container.querySelectorAll('circle')[1]!;
    act(() => {
      dot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = container.querySelector('.sparkline-tip');
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('second');
    expect(tip!.textContent).toContain('30');
    act(() => {
      dot.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(container.querySelector('.sparkline-tip')).toBeNull();
  });

  it('单点系列不报错，点居中', () => {
    const container = render(
      <Sparkline series={[{ label: 'L', color: 'var(--accent-fg)', points: [{ value: 1 }] }]} width={100} />,
    );
    expect(container.querySelectorAll('circle').length).toBe(1);
    expect(Number(container.querySelector('circle')!.getAttribute('cx'))).toBe(50);
  });
});
