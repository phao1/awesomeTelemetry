import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CompareDimensions } from './CompareDimensions.js';
import { makeEvent, makeResult, makeSpeed } from './compare-test-fixtures.js';

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
  it('WB-003: incomplete activity stays unavailable rather than winning with partial counts or missing-as-no',()=>{
    const result=makeResult();result.left.hasMore=true;result.left.eventTotal=5000;
    const {unmount}=mount(<CompareDimensions result={result} locale="en"/>);
    try {
      const card=document.querySelectorAll('.compare-dim-card')[2]!;
      const values=Array.from(card.querySelectorAll('.compare-dim-row-value'));
      expect(values.length).toBeGreaterThan(0);
      for(let i=0;i<values.length;i+=2)expect(values[i]?.textContent).toBe('—');
      expect(card.textContent).toContain('Recorded activity');
      expect(card.innerHTML).not.toContain('var(--success-emphasis)');
      expect(card.innerHTML).not.toContain('var(--danger-emphasis)');
    } finally {unmount();}
  });
  it('unknown event basis leaves raw timing rows visible without difference bars', () => {
    const { unmount } = mount(<CompareDimensions result={makeResult()} locale="en" />);
    const rows = Array.from(document.querySelectorAll('.compare-dim-card:first-child .compare-dim-row'));
    const ttft = rows.find((row) => row.textContent?.includes('TTFT'));
    expect(ttft?.textContent).toContain('0.1s');
    expect(ttft?.textContent).toContain('Unknown duration declaration');
    expect(ttft?.querySelector('.compare-diff-fill')).toBeNull();
    unmount();
  });

  it('null and nonfinite speed values are not zero, equality, or difference bars', () => {
    const { unmount } = mount(<CompareDimensions result={makeResult({ speed: {
      // Malformed runtime boundary: the declared non-null E2E must not become 0.
      left: makeSpeed({ e2eMs: null as unknown as number, ttftMs: NaN, tps: -1, tpotMs: null }), right: makeSpeed(),
    } })} locale="en" />);
    const card = document.querySelector('.compare-dim-card');
    expect(card?.textContent).not.toContain('NaN');
    expect(card?.textContent).toContain('Missing value');
    expect(card?.textContent).toContain('Invalid value');
    expect(card?.querySelector('.compare-diff-fill')).toBeNull();
    expect(card?.querySelector('.compare-dim-row-value')?.textContent).toBe('—');
    unmount();
  });

  it('partial event rows have no bars while observed E2E stays independent', () => {
    const result = makeResult();
    result.left.session = { ...result.left.session, durationSource: 'derived' };
    result.right.session = { ...result.right.session, durationSource: 'derived' };
    result.right.hasMore = true;
    const { unmount } = mount(<CompareDimensions result={result} locale="en" />);
    const rows = Array.from(document.querySelectorAll('.compare-dim-card:first-child .compare-dim-row'));
    const ttft = rows.find((row) => row.textContent?.includes('TTFT'));
    expect(ttft?.textContent).toContain('Incomplete or pending event evidence');
    expect(ttft?.querySelector('.compare-diff-fill')).toBeNull();
    expect(rows[0]?.querySelector('.compare-diff-fill')).not.toBeNull();
    unmount();
  });
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
