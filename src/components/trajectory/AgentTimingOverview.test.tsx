import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentGraph } from '../../core/agent-graph.js';
import { AgentTimingOverview } from './AgentTimingOverview.js';

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
    containers.pop()?.remove();
  }
});

const graph: AgentGraph = {
  nodes: [
    {
      id: 'main',
      label: 'Claude',
      kind: 'main',
      type: 'main',
      firstEventId: 'a',
      lastEventId: 'b',
      eventCount: 2,
      toolCount: 0,
      errorCount: 0,
      durationMs: 2000,
      turnIndices: [0],
      status: 'success',
    },
  ],
  edges: [],
  spans: [
    {
      nodeId: 'main',
      eventId: 'a',
      title: 'llm a',
      kind: 'llm',
      startMs: 0,
      endMs: 1000,
      status: 'success',
      turnIndex: 0,
    },
  ],
  startMs: 0,
  endMs: 1000,
  parallelismRatio: 1,
  spawnCount: 0,
  singleAgent: true,
};

describe('AgentTimingOverview', () => {
  it('renders a lane and focuses the clicked span', () => {
    const onFocusEvent = vi.fn();
    const view = mount(
      <AgentTimingOverview
        locale="en"
        graph={graph}
        selectedNodeId={null}
        activeTurnIndex={0}
        onFocusEvent={onFocusEvent}
      />,
    );
    expect(view.html()).toContain('Timing');
    expect(view.html()).toContain('Claude');
    const bar = document.querySelector('rect.agent-timing-bar') as SVGRectElement | null;
    expect(bar).not.toBeNull();
    act(() => {
      bar!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onFocusEvent).toHaveBeenCalledWith('a');
    view.unmount();
  });
});
