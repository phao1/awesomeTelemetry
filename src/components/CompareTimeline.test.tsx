import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  COMPARE_TIMELINE_PAGE_SIZE,
  CompareTimeline,
  FPS_FALLBACK_THRESHOLD,
  measureFps,
} from './CompareTimeline.js';
import { makeEvent, makeResult } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void } {
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

describe('CompareTimeline（建议 8）', () => {
  it('左右各一套独立时间/序列模式切换按钮，互不影响', () => {
    const result = makeResult({
      left: { ...makeResult().left, events: [makeEvent({ id: 'a', title: 'left event' })] },
      right: { ...makeResult().right, events: [makeEvent({ id: 'b', title: 'right event' })] },
    });
    mount(<CompareTimeline result={result} locale="zh" />);
    const gantts = document.querySelectorAll('.compare-timeline .gantt-wrap');
    expect(gantts.length).toBe(2);
    const modeGroups = document.querySelectorAll('.compare-timeline .timeline-mode');
    expect(modeGroups.length).toBe(2);
    // 默认都是 time
    const firstChips = modeGroups[0]!.querySelectorAll('.timeline-chip');
    const secondChips = modeGroups[1]!.querySelectorAll('.timeline-chip');
    expect(firstChips[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(secondChips[0]?.getAttribute('aria-pressed')).toBe('true');
    // 左侧切到 sequence，右侧保持 time
    act(() => {
      (firstChips[1] as HTMLButtonElement).click();
    });
    expect(firstChips[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(firstChips[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(secondChips[0]?.getAttribute('aria-pressed')).toBe('true');
  });
});

function manyEvents(prefix: string, n: number): ReturnType<typeof makeEvent>[] {
  return Array.from({ length: n }, (_, i) =>
    makeEvent({
      id: `${prefix}-${i}`,
      sequence: i + 1,
      title: `${prefix} event ${i}`,
      startedAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
    }),
  );
}

describe('REQ-114 Compare Timeline 事件选择', () => {
  it('点击事件块 → 高亮 + 右侧 Inspector 面板；Esc 取消', () => {
    const base = makeResult();
    const result = makeResult({
      left: { ...base.left, events: [makeEvent({ id: 'a', title: 'left event' })] },
      right: { ...base.right, events: [makeEvent({ id: 'b', title: 'right event' })] },
    });
    mount(<CompareTimeline result={result} locale="zh" />);
    expect(document.querySelector('.timeline-inspector-panel')).toBeNull();
    const row = document.querySelector('.compare-timeline[data-side="left"] .gantt-row') as HTMLElement;
    act(() => row.click());
    expect(document.querySelector('.timeline-inspector-panel')).not.toBeNull();
    expect(document.querySelector('.gantt-row-on')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('.timeline-inspector-panel')).toBeNull();
  });

  it('同一事件 id 在 L/R 两侧同步高亮', () => {
    const base = makeResult();
    const shared = makeEvent({ id: 'same', title: 'shared event' });
    const result = makeResult({
      left: { ...base.left, events: [shared] },
      right: { ...base.right, events: [{ ...shared }] },
    });
    mount(<CompareTimeline result={result} locale="zh" />);
    const row = document.querySelector('.compare-timeline[data-side="left"] .gantt-row') as HTMLElement;
    act(() => row.click());
    expect(document.querySelectorAll('.gantt-row-on').length).toBe(2);
  });
});

describe('REQ-115 Compare Timeline 无硬上限', () => {
  it('事件数 > 200 时全部交给虚拟滚动，底部显示 Showing X of Y', () => {
    const base = makeResult();
    const left = manyEvents('l', 260);
    const result = makeResult({
      left: { ...base.left, events: left, eventTotal: 260 },
      right: { ...base.right, events: manyEvents('r', 5), eventTotal: 5 },
    });
    mount(<CompareTimeline result={result} locale="en" />);
    const foot = document.querySelector('.compare-timeline[data-side="left"] .compare-timeline-count');
    expect(foot?.textContent).toBe('Showing 260 of 260 events');
    // 虚拟滚动：DOM 里渲染的行数远小于 260（不是硬截断到 200）
    const rendered = document.querySelectorAll('.compare-timeline[data-side="left"] .gantt-row').length;
    expect(rendered).toBeLessThan(260);
    expect(document.querySelector('.compare-timeline-pager')).toBeNull();
  });

  it('FPS 不达标回退分页：每页 200 + 翻页按钮', () => {
    const base = makeResult();
    const result = makeResult({
      left: { ...base.left, events: manyEvents('l', 260), eventTotal: 260 },
      right: { ...base.right, events: manyEvents('r', 5), eventTotal: 5 },
    });
    mount(<CompareTimeline result={result} locale="en" initialPaged />);
    const count = document.querySelector('.compare-timeline[data-side="left"] .compare-timeline-count');
    expect(count?.textContent).toBe(`Showing ${COMPARE_TIMELINE_PAGE_SIZE} of 260 events`);
    const pager = document.querySelector('.compare-timeline[data-side="left"] .compare-timeline-pager');
    expect(pager?.textContent).toContain('Page 1 / 2');
    const next = pager!.querySelectorAll('button')[1] as HTMLButtonElement;
    act(() => next.click());
    const after = document.querySelector('.compare-timeline[data-side="left"] .compare-timeline-count');
    expect(after?.textContent).toBe('Showing 60 of 260 events');
    // 右侧只有 5 个事件，不出分页器
    expect(document.querySelector('.compare-timeline[data-side="right"] .compare-timeline-pager')).toBeNull();
  });

  it('measureFps：样本不足/零跨度返回 null，正常样本按平均帧间隔换算', () => {
    expect(measureFps([])).toBeNull();
    expect(measureFps([10])).toBeNull();
    expect(measureFps([10, 10])).toBeNull();
    // 5 帧、跨度 400ms → 4/0.4 = 10 FPS，低于阈值
    const slow = measureFps([0, 100, 200, 300, 400]);
    expect(slow).toBeCloseTo(10, 5);
    expect(slow!).toBeLessThan(FPS_FALLBACK_THRESHOLD);
    // 60 FPS
    expect(measureFps([0, 16.67, 33.34])).toBeGreaterThan(FPS_FALLBACK_THRESHOLD);
  });
});
