import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CompareTimeline } from './CompareTimeline.js';
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
