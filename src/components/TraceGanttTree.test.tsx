import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { TraceEventSlim } from '../core/trace-types.js';
import { TraceGanttTree } from './TraceGanttTree.js';

function makeEvents(count: number): TraceEventSlim[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    sessionId: 's1',
    sequence: i + 1,
    kind: 'llm',
    phase: 'implement',
    title: `event ${i}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
  }));
}

const containers: HTMLDivElement[] = [];

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

describe('REQ-006 虚拟滚动', () => {
  it('9,590 events 只挂载视口窗口，DOM 节点 < 500', async () => {
    const events = makeEvents(9590);
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceGanttTree
          events={events}
          total={9590}
          hasMore={false}
          onLoadMore={() => {}}
          onSelectEvent={() => {}}
          selectedEventId={null}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const gantt = container.querySelector('.gantt');
    expect(gantt).not.toBeNull();
    const nodes = gantt?.querySelectorAll('*').length ?? 0;
    expect(nodes).toBeLessThan(500);
    const rows = gantt?.querySelectorAll('.gantt-row').length ?? 0;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(100);
    root.unmount();
  });

  it('接近末尾触发 onLoadMore（分页衔接）', async () => {
    let loadMoreCalls = 0;
    const events = makeEvents(10);
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceGanttTree
          events={events}
          total={3000}
          hasMore
          onLoadMore={() => {
            loadMoreCalls += 1;
          }}
          onSelectEvent={() => {}}
          selectedEventId={null}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadMoreCalls).toBeGreaterThan(0);
    root.unmount();
  });
});
