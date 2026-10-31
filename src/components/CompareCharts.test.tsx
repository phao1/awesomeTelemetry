import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('WB-003: token rings retain native totals, include caches and exclude separate system estimates',()=>{
    const result=makeResult();result.speed.left.systemPromptTokensEstimate=900;
    const view=mount(<TokenDonutChart result={result} locale="en" onSegmentClick={vi.fn()}/>);
    expect([...document.querySelectorAll('svg text')].map(node=>node.textContent).filter(value=>/^\d/.test(value??''))).toEqual(['210','210']);
    expect(document.querySelector('[aria-label="L system"]')).toBeNull();
    expect(view.html()).toContain('Cache read');expect(view.html()).toContain('Cache write');
    expect(view.html()).toContain('900');view.unmount();
  });

  it('WB-003: each token ring uses its own actual circumference',()=>{
    const view=mount(<TokenDonutChart result={makeResult()} locale="en"/>);
    for(const circle of document.querySelectorAll('circle[stroke-dasharray]')) {
      const [segment,rest]=circle.getAttribute('stroke-dasharray')!.split(' ').map(Number);
      expect(segment!+rest!).toBeCloseTo(2*Math.PI*Number(circle.getAttribute('r')),6);
    }
    view.unmount();
  });

  it('WB-003: non-additive token observations stay numeric but do not draw a fabricated composition',()=>{
    const result=makeResult();result.left.session.tokenUsage.total=190;
    const view=mount(<TokenDonutChart result={result} locale="en" onSegmentClick={vi.fn()}/>);
    expect(document.querySelector('circle[role="button"][aria-label="L output"]')).toBeNull();
    expect(view.html()).toContain('190');expect(view.html()).toContain('do not reconcile');
    expect(document.querySelector('circle[role="button"][aria-label="R output"]')).not.toBeNull();view.unmount();
  });
  it('WB-003: partial event-derived axes are omitted with readable raw observations, not scored at zero', () => {
    const result=makeResult();result.left.hasMore=true;result.left.eventTotal=200;
    const view=mount(<RadarChart result={result} locale="en"/>);
    expect(document.querySelectorAll('svg line')).toHaveLength(0);
    expect(view.html()).toContain('Fewer than three comparable axes');
    expect(document.querySelector('.compare-profile-values')).not.toBeNull();
    expect(document.querySelector<HTMLDetailsElement>('.compare-profile-values')?.open).toBe(true);
    expect(view.html()).toContain('Not a quality score');
    const rows=[...document.querySelectorAll('.compare-profile-values tbody tr')];
    const writes=rows.find(row=>row.querySelector('th')?.textContent==='Writes')!;
    expect(writes.querySelectorAll('td')[0]?.textContent).toBe('—');
    expect(view.html()).toContain('partial');view.unmount();
  });

  it('WB-003: profile shows recorded magnitudes and step-based activity, never inverted superiority', () => {
    const result=makeResult();result.left.session.durationSource='measured';result.right.session.durationSource='measured';
    result.left.session.tokenUsage.total=100;result.right.session.tokenUsage.total=200;
    const view=mount(<RadarChart result={result} locale="en"/>);
    const rows=[...document.querySelectorAll('.compare-profile-values tbody tr')];
    const tokens=rows.find(row=>row.querySelector('th')?.textContent==='Tokens')!;
    expect(tokens).toBeDefined();expect([...tokens.querySelectorAll('td')].slice(0,2).map(td=>td.textContent)).toEqual(['100','200']);
    expect(view.html()).toContain('L / R');expect(view.html()).not.toContain('lower-better inverted');
    view.unmount();
  });
  it('does not award full tool-speed credit for absent samples, while preserving a real measured zero', () => {
    const result = makeResult(); result.left.session.durationSource = 'measured'; result.right.session.durationSource = 'measured';
    result.left.events = []; result.left.eventTotal = 0; const first = mount(<RadarChart result={result} locale="en" />);
    expect(document.querySelectorAll('svg line')).toHaveLength(5); expect(first.html()).toContain('Tools');
    const tools=[...document.querySelectorAll('.compare-profile-values tbody tr')].find(row=>row.querySelector('th')?.textContent==='Tools (recorded interval)')!;
    expect(tools.querySelector('td')?.textContent).toBe('—');first.unmount();
    result.left.events = [makeEvent({ tool: 'Bash', durationMs: 0 })]; result.left.eventTotal = 1; const second = mount(<RadarChart result={result} locale="en" />);
    expect(document.querySelectorAll('svg line')).toHaveLength(8); second.unmount();
  });
  it('omits inadmissible timing axes instead of giving unknown or mixed-basis measurements a zero advantage', () => {
    const result = makeResult(); result.speed.left.tps = null;
    const { html, unmount } = mount(<RadarChart result={result} locale="en" />);
    expect(document.querySelectorAll('svg line')).toHaveLength(6);
    expect(html()).toContain('Not comparable'); unmount();
  });
  it('雷达图渲染 8 轴并带 L/R 多边形', () => {
    // Eight axes require actual matching declarations; the default historical fixture remains unknown.
    const result = makeResult(); result.left.session.durationSource = 'measured'; result.right.session.durationSource = 'measured';
    const { html, unmount } = mount(<RadarChart result={result} locale="zh" />);
    const lines = html().match(/<line /g) ?? [];
    expect(lines.length).toBe(8);
    expect(html()).toContain('fill="var(--accent-subtle)"');
    expect(html()).toContain('fill="var(--attention-subtle)"');
    unmount();
  });

  it('REQ-119/120: preserves radar geometry and gives each reconciled token ring its real circumference', () => {
    const result = makeResult(); result.left.session.durationSource = 'measured'; result.right.session.durationSource = 'measured';
    const radar = mount(<RadarChart result={result} locale="zh" />);
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
    // WB-003 supersedes the legacy outer-ring 50px baseline: each whole is 2πr.
    for (const c of circles.filter((el) => el.getAttribute('stroke-dasharray') !== null)) {
      const [len, rest] = c.getAttribute('stroke-dasharray')!.split(' ').map(Number);
      expect(len! + rest!).toBeCloseTo(2 * Math.PI * Number(c.getAttribute('r')), 6);
    }
    donut.unmount();
  });

  it('omits mixed and partial event bases but retains independently comparable wall-clock', () => {
    for (const cause of ['mixed', 'partial']) {
      const result = makeResult(); result.left.session.durationSource = 'measured'; result.right.session.durationSource = cause === 'mixed' ? 'derived' : 'measured';
      if (cause === 'partial') result.left.hasMore = true;
      const { html, unmount } = mount(<RadarChart result={result} locale="en" />);
      expect(document.querySelectorAll('svg line')).toHaveLength(cause === 'partial' ? 0 : 6); expect(html()).toContain('Not comparable');
      const wallClock=[...document.querySelectorAll('.compare-profile-values tbody tr')].find(row=>row.querySelector('th')?.textContent==='Wall-clock interval')!;
      expect([...wallClock.querySelectorAll('td')].slice(0,2).map(td=>td.textContent)).toEqual(['5,000 ms','3,000 ms']);unmount();
    }
  });

  it('draws five recorded token components per ring and an explicit value table', () => {
    const { html, unmount } = mount(<TokenDonutChart result={makeResult()} locale="zh" />);
    expect((html().match(/<circle /g) ?? []).length).toBe(12); // 2 base rings + 5 actual components each
    expect(document.querySelectorAll('[data-token-part]')).toHaveLength(5);
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
