import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CompareVerdict, computeVerdict } from './CompareVerdict.js';
import {
  makeEvent,
  makeResult,
  makeSession,
  makeTokenUsage,
} from './compare-test-fixtures.js';

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

describe('CompareVerdict（建议 9）', () => {
  it('retains valid positive wall-clock observations when their descriptive ratio overflows', () => {
    const result = makeResult(); result.speed.left.e2eMs = Number.MIN_VALUE; result.speed.right.e2eMs = 1;
    expect(() => computeVerdict(result, 'en')).not.toThrow();
    expect(computeVerdict(result, 'en').summary.fastRatio).toBeNull();
    const { html, unmount } = mount(<CompareVerdict result={result} locale="en" />); expect(html()).not.toContain('Infinity'); unmount();
  });
  it('does not award a speed winner or ratio to zero/invalid/non-scan/pending wall-clock evidence', () => {
    for (const cause of ['zero', 'negative', 'nan', 'source', 'pending']) {
      const result = makeResult();
      if (cause === 'zero') result.speed.left.e2eMs = 0;
      if (cause === 'negative') result.speed.left.e2eMs = -1;
      if (cause === 'nan') result.speed.left.e2eMs = NaN;
      if (cause === 'source') result.left.session.dataSource = 'proxy';
      if (cause === 'pending') result.left.pending = true;
      const verdict = computeVerdict(result, 'en');
      expect(verdict.summary.fastRatio).toBeNull();
      expect(verdict.dims.find(dim => dim.key === 'fast')!.winner).toBe('unavailable');
      const { html, unmount } = mount(<CompareVerdict result={result} locale="en" />);
      expect(html()).not.toContain('× faster'); expect(html()).toContain('Not comparable'); unmount();
    }
  });
  it('渲染胜负评分条，宽度 = wins:losses', () => {
    // left 更快更省，质量持平 → 2:0
    const verify = makeEvent({ id: 'v', phase: 'verify' });
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [verify, makeEvent({ id: 'l', tool: 'Bash' })],
        session: makeSession('left', { tokenUsage: makeTokenUsage({ total: 100 }) }),
      },
      right: {
        ...makeResult().right,
        events: [verify, makeEvent({ id: 'r', phase: 'implement' })],
      },
      speed: {
        left: { ...makeResult().speed.left, e2eMs: 3000 },
        right: { ...makeResult().speed.right, e2eMs: 5000 },
      },
    });
    const { html, unmount } = mount(<CompareVerdict result={result} locale="zh" />);
    expect(html()).toContain('compare-verdict-bar');
    expect(html()).toContain('L 2');
    expect(html()).toContain('0 R');
    expect(html()).toContain('width: 100%');
    unmount();
  });

  it('双方各胜一维时评分条为 50/50', () => {
    // right 更快（fast→R），left 更省（frugal→L），质量持平 → 1:1
    const verify = makeEvent({ id: 'v', phase: 'verify' });
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [verify, makeEvent({ id: 'l', tool: 'Bash' })],
        session: makeSession('left', { tokenUsage: makeTokenUsage({ total: 100 }) }),
      },
      right: {
        ...makeResult().right,
        events: [verify, makeEvent({ id: 'r', phase: 'implement' })],
      },
      speed: {
        left: { ...makeResult().speed.left, e2eMs: 5000 },
        right: { ...makeResult().speed.right, e2eMs: 3000 },
      },
    });
    const { html, unmount } = mount(<CompareVerdict result={result} locale="zh" />);
    expect(html()).toContain('width: 50%');
    unmount();
  });

  it('验证事件差异影响 quality 维度', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'v1', phase: 'verify' }),
          makeEvent({ id: 'v2', phase: 'implement' }),
          makeEvent({ id: 'v3', phase: 'implement' }),
        ],
      },
      right: {
        ...makeResult().right,
        events: [makeEvent({ id: 'w1', phase: 'verify' })],
      },
    });
    const { html, unmount } = mount(<CompareVerdict result={result} locale="zh" />);
    // left 验证覆盖 1/3 < right 1/1 → quality 归 R
    expect(html()).toContain('验证覆盖 33% vs 100%');
    unmount();
  });
});
