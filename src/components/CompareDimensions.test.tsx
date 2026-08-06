import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CompareDimensions } from './CompareDimensions.js';
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

describe('CompareDimensions（L2 三维对比）', () => {
  it('渲染快/省/质三张卡片', () => {
    const { html, unmount } = mount(<CompareDimensions result={makeResult()} locale="zh" />);
    const out = html();
    expect(out).toContain('compare-dim-card');
    expect(out).toContain('质量');
    unmount();
  });

  it('分母为 0 的指标显示 —（readWriteRatio 无写入时不冒充 0）', () => {
    const result = makeResult({
      left: { ...makeResult().left, events: [makeEvent({ id: 'a', kind: 'llm' })] },
      right: { ...makeResult().right, events: [makeEvent({ id: 'b', kind: 'llm' })] },
    });
    const { html, unmount } = mount(<CompareDimensions result={result} locale="zh" />);
    expect(html()).toContain('—');
    unmount();
  });
});
