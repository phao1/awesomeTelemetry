import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentOverviewRow, SessionIndexEntry } from '../core/trace-types.js';
import { AGENT_VIEW_KEY, AgentOverview } from './AgentOverview.js';

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
    durationByPhase: {
      understand: 100,
      plan: 200,
      implement: 300,
      debug: 400,
      verify: 500,
      report: 600,
    },
  },
];

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
  localStorage.removeItem(AGENT_VIEW_KEY);
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

  it('建议 4：每行渲染堆叠 Phase 条（6 段，宽度=耗时占比）', async () => {
    const { unmount } = mount(
      <AgentOverview locale="zh" load={async () => ({ rows, stamp: 's1', cached: true })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const stack = document.querySelector('.agent-phase-stack');
    expect(stack).not.toBeNull();
    const segs = stack!.querySelectorAll('.agent-phase-stack-seg');
    expect(segs.length).toBe(6);
    const first = segs[0] as HTMLElement;
    expect(Number.parseFloat(first.style.width)).toBeCloseTo((100 / 2100) * 100);
    unmount();
  });

  it('REQ-018：展开行复用共享 store 列出最近会话，点击跳转且不产生新请求', async () => {
    let calls = 0;
    const load = async (): Promise<{ rows: AgentOverviewRow[]; stamp: string; cached: boolean }> => {
      calls += 1;
      return { rows, stamp: 's1', cached: false };
    };
    const selected: string[] = [];
    const sessions = [
      { id: 'codex-recent-1', provider: 'codex', title: 'recent one', eventCount: 5 } as unknown as SessionIndexEntry,
      { id: 'codex-recent-2', provider: 'codex', title: 'recent two', eventCount: 8 } as unknown as SessionIndexEntry,
    ];
    const { unmount } = mount(
      <AgentOverview
        locale="zh"
        load={load}
        sessions={sessions}
        onSelectSession={(key) => selected.push(key)}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    const expandButton = document.querySelector('button[aria-label="expand"]') as HTMLButtonElement;
    expect(expandButton).not.toBeNull();
    act(() => expandButton.click());
    expect(document.body.textContent).toContain('recent one');
    expect(document.body.textContent).toContain('recent two');
    const row = Array.from(document.querySelectorAll('.overview-expand-row')).find(
      (el) => el.textContent?.includes('recent two'),
    ) as HTMLButtonElement;
    act(() => row.click());
    expect(selected).toEqual(['codex-recent-2']);
    expect(calls).toBe(1); // 展开与点击不产生新请求（G11.9）
    unmount();
  });

  it('REQ-107：默认表格视图；点击「卡片」切换卡片网格并持久化', async () => {
    const { html, unmount } = mount(
      <AgentOverview locale="zh" load={async () => ({ rows, stamp: 's1', cached: true })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.agent-card-grid')).toBeNull();
    const cardsBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('卡片'));
    expect(cardsBtn).toBeDefined();
    act(() => {
      cardsBtn!.click();
    });
    expect(document.querySelector('.agent-card-grid')).not.toBeNull();
    expect(html()).toContain('Codex');
    expect(localStorage.getItem(AGENT_VIEW_KEY)).toBe('cards');
    unmount();
  });

  it('REQ-107：卡片含 6 指标 + 堆叠 Phase 条 + 阶段分解', async () => {
    localStorage.setItem(AGENT_VIEW_KEY, 'cards');
    const { html, unmount } = mount(
      <AgentOverview locale="zh" load={async () => ({ rows, stamp: 's1', cached: true })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.agent-card-grid')).not.toBeNull();
    expect(document.querySelectorAll('.agent-card-metric').length).toBe(6);
    expect(document.querySelector('.agent-phase-stack')).not.toBeNull();
    expect(document.querySelectorAll('.agent-card-phase-list li').length).toBe(6);
    expect(html()).toContain('阶段分解');
    unmount();
  });
});
