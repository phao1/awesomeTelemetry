import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CompareCharts,
  EventKindChart,
  PhaseBarChart,
  RadarChart,
  TokenDonutChart,
} from './CompareCharts.js';
import { makeEvent, makeResult } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      root.unmount();
    },
    html: () => container.innerHTML,
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

describe('CompareCharts（建议 1）', () => {
  it('雷达图渲染 8 轴并带 L/R 多边形', () => {
    const { html, unmount } = mount(<RadarChart result={makeResult()} locale="zh" />);
    const lines = html().match(/<line /g) ?? [];
    expect(lines.length).toBe(8);
    expect(html()).toContain('fill="var(--accent-subtle)"');
    expect(html()).toContain('fill="var(--attention-subtle)"');
    unmount();
  });

  it('REQ-119/120：重构后仍逐像素一致（雷达几何 + 双环 dasharray 基准）', () => {
    const radar = mount(<RadarChart result={makeResult()} locale="zh" />);
    const svg = document.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');
    expect(svg.getAttribute('height')).toBe('220');
    // 4 圈参考多边形 + L/R 两条系列多边形
    expect(svg.querySelectorAll('polygon').length).toBe(6);
    const strokes = [...svg.querySelectorAll('polygon')].slice(4).map((p) => p.getAttribute('stroke'));
    expect(strokes).toEqual(['var(--accent-fg)', 'var(--attention-fg)']);
    radar.unmount();

    const donut = mount(<TokenDonutChart result={makeResult()} locale="zh" />);
    const circles = [...document.querySelectorAll('circle')];
    // 双环共享 2π*50 的弧长基准（与重构前一致）
    const circ = 2 * Math.PI * 50;
    for (const c of circles.filter((el) => el.getAttribute('stroke-dasharray') !== null)) {
      const [len, rest] = c.getAttribute('stroke-dasharray')!.split(' ').map(Number);
      expect(len! + rest!).toBeCloseTo(circ, 6);
    }
    donut.unmount();
  });

  it('双环 Token 环形图渲染 8 个圆环分段 + 图例', () => {
    const { html, unmount } = mount(<TokenDonutChart result={makeResult()} locale="zh" />);
    expect((html().match(/<circle /g) ?? []).length).toBe(10); // 2 底环 + 8 分段
    expect(html()).toContain('Token 构成');
    unmount();
  });

  it('阶段条形图渲染 6 阶段双向条', () => {
    const { html, unmount } = mount(<PhaseBarChart result={makeResult()} />);
    expect((html().match(/<rect /g) ?? []).length).toBe(12);
    expect(html()).toContain('implement');
    unmount();
  });

  it('事件分布图渲染非零 kind 行', () => {
    const result = makeResult({
      left: { ...makeResult().left, events: [makeEvent({ id: 'a', kind: 'tool', tool: 'Bash' })] },
    });
    const { html, unmount } = mount(<EventKindChart result={result} />);
    expect(html()).toContain('tool');
    unmount();
  });

  it('CompareCharts 组合渲染四个区块', () => {
    const { html, unmount } = mount(<CompareCharts result={makeResult()} locale="zh" />);
    expect(html()).toContain('雷达图');
    expect(html()).toContain('Token 构成');
    expect(html()).toContain('阶段耗时对比');
    expect(html()).toContain('事件类型分布');
    expect(html()).toContain('compare-chart-criteria'); // 口径说明（observability-designer 数据溯源）
    unmount();
  });

  it('点击环形图 token 段打开 TokenTextModal（REQ-101）', () => {
    const { html, unmount } = mount(<CompareCharts result={makeResult()} locale="zh" />);
    const seg = document.querySelector<SVGCircleElement>('circle[role="button"][aria-label="L output"]');
    expect(seg).toBeDefined();
    act(() => {
      seg!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(html()).toContain('Token 文本');
    unmount();
  });
});
