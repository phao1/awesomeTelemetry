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
  it.each(['en','zh']as const)('WB-003: observed differences never become a global Agent win or measured correctness (%s)',locale=>{
    const result=makeResult();
    const verdict=computeVerdict(result,locale);
    expect(verdict.dims.find(dim=>dim.key==='quality')?.winner).toBe('unavailable');
    const {html,unmount}=mount(<CompareVerdict result={result} locale={locale}/>);
    try {
      expect(html()).not.toContain('compare-verdict-scoreline');
      expect(html()).not.toContain('compare-verdict-bar');
      expect(html()).toContain(locale==='en'?'No overall winner':'不判定整体胜负');
      expect(html()).not.toMatch(/better code quality|代码质量更好/);
    } finally {unmount();}
  });
  it('WB-003: paged/no-step evidence has unavailable verification ratios, not a quality tie',()=>{
    const result=makeResult();result.left.hasMore=true;result.left.eventTotal=5000;
    result.right.events=[makeEvent({kind:'user_prompt',phase:'understand'})];
    const verdict=computeVerdict(result,'en');
    expect(verdict.summary.leftCoveragePct).toBeNull();expect(verdict.summary.rightCoveragePct).toBeNull();
    expect(verdict.dims.find(dim=>dim.key==='quality')?.winner).toBe('unavailable');
  });
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
  it('keeps a lower wall-clock/token observation without awarding an overall score', () => {
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
    expect(html()).not.toContain('compare-verdict-bar');
    expect(html()).toContain('L 的记录值较低');
    expect(html()).toContain('不判定整体胜负');
    expect(computeVerdict(result,'zh').summary.fastRatio).toBeCloseTo(5/3);
    expect(computeVerdict(result,'zh').dims.find(dim=>dim.key==='quality')?.winner).toBe('unavailable');
    unmount();
  });

  it('keeps opposing observed differences separate, never a 50/50 quality verdict', () => {
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
    expect(html()).toContain('L 的记录值较低');
    expect(html()).toContain('R 的记录值较低');
    expect(html()).not.toContain('width: 50%');
    expect(html()).toContain('未测量答案正确性');
    unmount();
  });

  it('verification activity remains a measured event ratio, not a quality winner', () => {
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
    expect(html()).toContain('验证活动 33% vs 100%');
    expect(computeVerdict(result,'zh').dims.find(dim=>dim.key==='quality')?.winner).toBe('unavailable');
    unmount();
  });
});
