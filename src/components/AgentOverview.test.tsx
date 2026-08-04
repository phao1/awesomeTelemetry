import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentOverviewRow } from '../core/trace-types.js';
import { AgentOverview } from './AgentOverview.js';

const rows: AgentOverviewRow[] = [
  {
    provider: 'codex',
    sourceAgent: 'Codex',
    sessionCount: 2,
    eventCount: 10,
    tokenInput: 100,
    tokenOutput: 50,
    tokenTotal: 150,
    costUsd: 0.02,
    avgWallClockMs: 1000,
    latestUpdatedAt: '2026-08-01T00:00:00.000Z',
    avgToolDurationMs: 100,
    errorRate: 0.1,
    verificationCoverage: 0.5,
    debugEntryRate: 0,
  },
];

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

describe('REQ-003 Agent 视图', () => {
  it('只发 1 个请求（重渲染不重拉）', async () => {
    let calls = 0;
    const load = async (): Promise<{ rows: AgentOverviewRow[]; stamp: string; cached: boolean }> => {
      calls += 1;
      return { rows, stamp: 's1', cached: false };
    };
    const { unmount } = mount(<AgentOverview locale="zh" load={load} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toBe(1);

    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    unmount();
  });

  it('渲染聚合表格', async () => {
    const { unmount } = mount(
      <AgentOverview locale="en" load={async () => ({ rows, stamp: 's1', cached: true })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Codex');
    expect(document.body.textContent).toContain('150');
    unmount();
  });
});
