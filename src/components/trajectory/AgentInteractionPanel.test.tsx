import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentGraph } from '../../core/agent-graph.js';
import { AgentInteractionPanel } from './AgentInteractionPanel.js';

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

function graph(over: Partial<AgentGraph> = {}): AgentGraph {
  return {
    nodes: [
      {
        id: 'main',
        label: 'Claude',
        kind: 'main',
        type: 'main',
        firstEventId: 'u1',
        lastEventId: 'l2',
        eventCount: 4,
        toolCount: 1,
        errorCount: 0,
        durationMs: 4000,
        turnIndices: [0, 1],
        status: 'success',
      },
      {
        id: 'spawn:sp',
        label: 'Explore',
        kind: 'subagent',
        type: 'Explore',
        firstEventId: 'sp',
        lastEventId: 'r1',
        eventCount: 2,
        toolCount: 1,
        errorCount: 0,
        durationMs: 2000,
        turnIndices: [1],
        status: 'success',
      },
    ],
    edges: [
      {
        id: 'edge-spawn-sp',
        fromId: 'main',
        toId: 'spawn:sp',
        kind: 'spawn',
        eventId: 'sp',
        turnIndex: 1,
        title: 'Task Explore',
        status: 'success',
      },
    ],
    spans: [],
    startMs: 0,
    endMs: 4000,
    parallelismRatio: 1.5,
    spawnCount: 1,
    singleAgent: false,
    ...over,
  };
}

describe('AgentInteractionPanel', () => {
  it('renders nodes and spawn edges, focuses event on click', () => {
    const onSelectNode = vi.fn();
    const onFocusEvent = vi.fn();
    const view = mount(
      <AgentInteractionPanel
        locale="zh"
        graph={graph()}
        selectedNodeId="main"
        onSelectNode={onSelectNode}
        onFocusEvent={onFocusEvent}
      />,
    );
    const html = view.html();
    expect(html).toContain('Explore');
    expect(html).toContain('Claude');
    expect(html).toContain('派发');
    const buttons = Array.from(document.querySelectorAll('button.agent-edge'));
    expect(buttons.length).toBe(1);
    act(() => {
      (buttons[0] as HTMLButtonElement).click();
    });
    expect(onFocusEvent).toHaveBeenCalledWith('sp');
    view.unmount();
  });

  it('single-agent copy when there are no children', () => {
    const view = mount(
      <AgentInteractionPanel
        locale="en"
        graph={graph({
          nodes: [
            {
              id: 'main',
              label: 'Codex',
              kind: 'main',
              type: 'main',
              firstEventId: null,
              lastEventId: null,
              eventCount: 1,
              toolCount: 0,
              errorCount: 0,
              durationMs: 0,
              turnIndices: [],
              status: 'success',
            },
          ],
          edges: [],
          singleAgent: true,
          spawnCount: 0,
        })}
        selectedNodeId={null}
        onSelectNode={() => undefined}
        onFocusEvent={() => undefined}
      />,
    );
    expect(view.html()).toContain('single agent');
    view.unmount();
  });
});
