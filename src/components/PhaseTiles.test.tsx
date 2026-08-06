import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { TRACE_PHASES } from '../core/trace-types.js';
import { PhaseTiles } from './PhaseTiles.js';

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

const zeroCounts = Object.fromEntries(TRACE_PHASES.map((p) => [p, 0])) as Record<
  (typeof TRACE_PHASES)[number],
  number
>;

describe('PhaseTiles（建议 10）', () => {
  it('有趋势数据的阶段渲染 sparkline，无数据阶段不渲染', () => {
    const counts = { ...zeroCounts, implement: 5, verify: 0 };
    const trends = {
      ...Object.fromEntries(TRACE_PHASES.map((p) => [p, [0, 0, 0, 0]])),
      implement: [0, 100, 200, 50],
    } as Record<(typeof TRACE_PHASES)[number], number[]>;
    const { html, unmount } = mount(
      <PhaseTiles
        active={[...TRACE_PHASES]}
        onToggle={() => undefined}
        locale="zh"
        counts={counts}
        visibleCount={5}
        onSelectAll={() => undefined}
        onClearAll={() => undefined}
        trends={trends}
      />,
    );
    expect(html()).toContain('phase-tile-trend');
    unmount();
  });

  it('findingPhases 渲染异常点', () => {
    const counts = { ...zeroCounts, verify: 3 };
    const { html, unmount } = mount(
      <PhaseTiles
        active={['verify']}
        onToggle={() => undefined}
        locale="zh"
        counts={counts}
        visibleCount={3}
        onSelectAll={() => undefined}
        onClearAll={() => undefined}
        findingPhases={['verify']}
      />,
    );
    expect(html()).toContain('phase-tile-dot');
    unmount();
  });
});
