import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentOverviewRow, SessionIndexEntry } from '../core/trace-types.js';
import { AGENT_VIEW_KEY, AgentOverview } from './AgentOverview.js';
import { ZH } from '../i18n.js';
import { ApiError } from '../api/client.js';

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
    pricedSessionCount: 2,
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

function mount(node: React.ReactNode): { unmount: () => void; html: () => string; container: HTMLDivElement; rerender: (next: React.ReactNode) => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      act(() => root.unmount());
    },
    html: () => container.innerHTML,
    container,
    rerender: next => act(() => root.render(next)),
  };
}

afterEach(() => {
  vi.useRealTimers();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
  localStorage.removeItem(AGENT_VIEW_KEY);
});

describe('WB-003 Agent overview evidence and ownership', () => {
  it('retains verify ratios above100% as raw observations with an explicit fixed bar cap, not a quality score', async () => {
    const { container, unmount } = mount(<AgentOverview locale="en" load={async () => ({ rows: [{ ...rows[0]!, verificationCoverage: 1.5 }], stamp: '2026-10-18T00:00:00.000Z', cached: false })} />);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('tbody')?.textContent).toContain('150.0%');
      expect(container.textContent).toContain('Bars stop at100%; raw values above that remain visible');
      act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Cards')!.click());
      expect(container.querySelector('.agent-card')?.textContent).toContain('150.0%');
    } finally { unmount(); }
  });
  it('treats a malformed successful response as an explicit error, not infinite loading', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn().mockResolvedValue(null);
    const { container, unmount } = mount(<AgentOverview locale="en" load={load} />);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('OVERVIEW_LOAD_FAILED');
      expect(container.querySelector('.ui-skeleton')).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);expect(log).toHaveBeenCalled();
    } finally { unmount();log.mockRestore(); }
  });
  it('reports actual sessions, not groups, without fabricated throughput/accuracy/stability winners', async () => {
    const { unmount } = mount(<AgentOverview locale="en" load={async () => ({ rows: [rows[0]!, { ...rows[0]!, sourceAgent: 'Other', sessionCount: 98, errorRate: null, verificationCoverage: null }], stamp: '2026-10-18T00:00:00.000Z', cached: true })} />);
    try {
      await act(async () => { await Promise.resolve(); });
      const summaries = [...document.querySelectorAll('.overview-kpis .ui-metric-card')].map(el => el.textContent);
      expect(summaries).toEqual(expect.arrayContaining([expect.stringContaining('100'), expect.stringContaining('2')]));
      expect(document.body.textContent).not.toMatch(/tool\/s|Fastest|Most stable|faster than|Accuracy|Stability/);
      expect(document.body.textContent).toContain('All-history scan');
      expect(document.body.textContent).toContain('eligible');
    } finally { unmount(); }
  });
  it('times out an abort-ignoring loader, aborts ownership and cannot restore a late success until explicit retry', async () => {
    vi.useFakeTimers();
    let resolve!: (value: { rows: AgentOverviewRow[]; stamp: string; cached: boolean }) => void;
    let signal: AbortSignal | undefined;
    const load = vi.fn((owned?: AbortSignal) => { signal = owned; return new Promise<{ rows: AgentOverviewRow[]; stamp: string; cached: boolean }>(done => { resolve = done; }); });
    const { unmount } = mount(<AgentOverview locale="en" load={load} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('OVERVIEW_TIMEOUT');
      expect(signal?.aborted).toBe(true);
      await act(async () => { resolve({ rows, stamp: 'late', cached: true }); await Promise.resolve(); });
      expect(document.querySelector('table')).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
      const retry = [...document.querySelectorAll('button')].find(button => button.textContent === 'Retry')!;
      act(() => retry.click());
      expect(load).toHaveBeenCalledTimes(2);
    } finally { unmount(); }
  });
  it('cancels local waiting without automatic retry and aborts on unmount', async () => {
    let signal: AbortSignal | undefined;
    const load = vi.fn((owned?: AbortSignal) => { signal = owned; return new Promise<never>(() => undefined); });
    const { unmount } = mount(<AgentOverview locale="en" load={load} />);
    try {
      const cancel = [...document.querySelectorAll('button')].find(button => button.textContent === 'Cancel waiting')!;
      expect(cancel).toBeDefined();
      act(() => cancel.click());
      expect(signal?.aborted).toBe(true);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('OVERVIEW_CANCELLED');
      expect(load).toHaveBeenCalledTimes(1);
    } finally { unmount(); }
  });
});

describe('REQ-003 Agent 视图', () => {
  it('shows tokens in both table/cards without money totals, columns or pricing coverage',async()=>{
    const {unmount}=mount(<AgentOverview locale="en" load={async()=>({rows:[{...rows[0]!,costUsd:456789.1234}],stamp:'s1',cached:false})}/>);
    try {
      await act(async()=>{await Promise.resolve();});expect(document.body.textContent).not.toMatch(/[$¥￥€£]\s*\d/);
      expect([...document.querySelectorAll('th')].map(el=>el.textContent)).not.toContain('Cost');
      const cards=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Cards')!;act(()=>cards.click());
      expect(document.body.textContent).not.toMatch(/[$¥￥€£]\s*\d/);expect(document.body.textContent).toContain('150');
    } finally {unmount();}
  });
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
    const sessions = [index('codex-recent-1', 'Codex', { title: 'recent one', eventCount: 5 }), index('codex-recent-2', 'Codex', { title: 'recent two', eventCount: 8 })];
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
    // Contextual, localized group identity replaces the ambiguous generic label.
    const expandButton = document.querySelector(
      `button[aria-label="${ZH['agent.recentLoaded']} · Codex · codex"]`,
    ) as HTMLButtonElement;
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

function index(id: string, sourceAgent: string, patch: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return { id, sourceAgent, provider: 'codex', title: id, startedAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z',
    status: 'success', cwd: null, eventCount: 2, messageCount: 0, tokenTotal: 3, costUsd: 0, dataSource: 'scan', sourcePath: '/synthetic/session',
    detailLoaded: false, mergeGroupId: null, hasSystemPrompt: false, tags: [], ...patch };
}

describe('Agent overview source-group navigation', () => {
  it('table and cards expose the same exact scan-group sessions and original key without extra reads', async () => {
    const load = vi.fn(async () => ({ rows, stamp: '2026-10-18T00:00:00.000Z', cached: false }));
    const selected = vi.fn();
    const browse = vi.fn();
    const { container, unmount } = mount(<AgentOverview locale="en" load={load} onSelectSession={selected} onBrowseSessions={browse}
      sessions={[index('right-key', 'Codex'), index('wrong-group', 'Other'), index('wrong-source', 'Codex', { dataSource: 'proxy' })]} />);
    try {
      await act(async () => { await Promise.resolve(); });
      act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
      const expanded = container.querySelector('.overview-expand')!;
      expect(expanded.textContent).toContain('right-key');
      expect(expanded.textContent).not.toMatch(/wrong-group|wrong-source/);
      expect(expanded.textContent).toContain('filtered/paged');
      expect(container.querySelector('td[colspan="10"]')).not.toBeNull();
      act(() => container.querySelector<HTMLButtonElement>('.overview-expand-row')!.click());
      expect(selected).toHaveBeenCalledWith('right-key');
      act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Cards')!.click());
      expect(container.querySelector('.agent-card .overview-expand-row')?.textContent).toContain('right-key');
      act(() => [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('Browse all sessions'))!.click());
      expect(browse).toHaveBeenCalledWith('codex');
      expect(load).toHaveBeenCalledTimes(1);
    } finally { unmount(); }
  });
  it('does not equate no loaded match with no source sessions, and comparison retains both group identities', async () => {
    const compare = vi.fn();
    const grouped = [rows[0]!, { ...rows[0]!, sourceAgent: 'Other/Agent' }];
    const { container, unmount } = mount(<AgentOverview locale="en" load={async () => ({ rows: grouped, stamp: 's1', cached: false })}
      sessions={[index('not-a-match', 'Third')]} onCompareProviders={compare} />);
    try {
      await act(async () => { await Promise.resolve(); });
      act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
      expect(container.querySelector('.overview-expand')?.textContent).toContain('does not mean the source has no sessions');
      const boxes = container.querySelectorAll<HTMLInputElement>('tbody input');
      expect(boxes[0]!.getAttribute('aria-label')).toContain('Codex');
      expect(boxes[1]!.getAttribute('aria-label')).toContain('Other/Agent');
      act(() => boxes[0]!.click());act(() => boxes[1]!.click());
      act(() => container.querySelector<HTMLButtonElement>('.compare-float-btn')!.click());
      expect(compare).toHaveBeenCalledWith('codex', 'codex', ['Codex', 'Other/Agent']);
    } finally { unmount(); }
  });
  it('sorts observed zero before null, supports descending and string order, and never refetches on locale/view/sort changes', async () => {
    const grouped = [{ ...rows[0]!, sourceAgent: 'Zulu', errorRate: null }, { ...rows[0]!, sourceAgent: 'Alpha', errorRate: 0 }];
    const load = vi.fn(async () => ({ rows: grouped, stamp: 's1', cached: true }));
    const { container, unmount, rerender } = mount(<AgentOverview locale="en" load={load} />);
    try {
      await act(async () => { await Promise.resolve(); });
      const errorSort = [...container.querySelectorAll<HTMLButtonElement>('th button')].find(button => button.textContent === 'Mean error-step ratio')!;
      act(() => errorSort.click());
      expect(container.querySelector('tbody .agent-provider-cell')?.textContent).toContain('Alpha');
      expect(errorSort.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
      act(() => errorSort.click());
      expect(container.querySelector('tbody .agent-provider-cell')?.textContent).toContain('Alpha');
      expect(container.querySelector('tbody')?.textContent).toContain('0.0%');
      rerender(<AgentOverview locale="zh" load={load} />);
      expect(container.textContent).toContain('错误步骤占比均值');
      act(() => [...container.querySelectorAll('button')].find(button => button.textContent === '卡片')!.click());
      expect(load).toHaveBeenCalledTimes(1);
    } finally { unmount(); }
  });
  it('rejects old-loader results and aborts a replaced or unmounted read', async () => {
    let complete!: (value: { rows: AgentOverviewRow[]; stamp: string; cached: boolean }) => void;
    let firstSignal: AbortSignal | undefined;
    const first = (signal?: AbortSignal): Promise<{ rows: AgentOverviewRow[]; stamp: string; cached: boolean }> => { firstSignal = signal; return new Promise(resolve => { complete = resolve; }); };
    const second = vi.fn(async () => ({ rows: [{ ...rows[0]!, sourceAgent: 'Current group' }], stamp: 'current', cached: false }));
    const { container, unmount, rerender } = mount(<AgentOverview locale="en" load={first} />);
    try {
      rerender(<AgentOverview locale="en" load={second} />);
      await act(async () => { await Promise.resolve(); complete({ rows, stamp: 'stale', cached: true }); await Promise.resolve(); });
      expect(firstSignal?.aborted).toBe(true);
      expect(container.querySelector('tbody')?.textContent).toContain('Current group');
      expect(container.textContent).not.toContain('stale');
    } finally { unmount(); }
  });
  it('retains an actual ApiError code and inert source message, then succeeds only on explicit retry', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValueOnce(new ApiError('SOURCE_UNAVAILABLE', '<img src=x onerror=alert(1)>', 503)).mockResolvedValue({ rows, stamp: 's1', cached: false });
    const { container, unmount } = mount(<AgentOverview locale="en" load={load} />);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('SOURCE_UNAVAILABLE');
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>');expect(container.querySelector('img')).toBeNull();
      expect(log).toHaveBeenCalled();expect(load).toHaveBeenCalledTimes(1);
      act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click());
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector('table')).not.toBeNull();expect(container.querySelector('[role="alert"]')).toBeNull();expect(load).toHaveBeenCalledTimes(2);
    } finally { unmount();log.mockRestore(); }
  });
  it('empty aggregation offers explicit source discovery without pretending the proxy list is empty', async () => {
    const browse = vi.fn();
    const load = vi.fn(async () => ({ rows: [], stamp: 's1', cached: false }));
    const { container, unmount } = mount(<AgentOverview locale="en" load={load} onBrowseSessions={browse} />);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(container.textContent).toContain('excludes the separate capture list');
      act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Browse scan sessions')!.click());
      expect(browse).toHaveBeenCalledTimes(1);expect(load).toHaveBeenCalledTimes(1);
    } finally { unmount(); }
  });
});

const twoRows: AgentOverviewRow[] = [
  rows[0]!,
  { ...rows[0]!, provider: 'claude', sourceAgent: 'Claude Code', tokenTotal: 300 },
];

describe('REQ-118 卡片视图 compare 复选框', () => {
  it('每张卡片带 compare 复选框，选中两个后出现 Compare selected 并可跳转', async () => {
    localStorage.setItem(AGENT_VIEW_KEY, 'cards');
    const compared: Array<[string, string]> = [];
    const { unmount } = mount(
      <AgentOverview
        locale="zh"
        load={async () => ({ rows: twoRows, stamp: 's1', cached: true })}
        onCompareProviders={(l, r) => compared.push([l, r])}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.agent-card-compare'));
    expect(boxes.length).toBe(2);
    expect(document.querySelector('.compare-float-btn')).toBeNull();
    act(() => boxes[0]!.click());
    act(() => boxes[1]!.click());
    expect(document.querySelectorAll('.agent-card-on').length).toBe(2);
    const cta = document.querySelector('.compare-float-btn') as HTMLButtonElement;
    expect(cta).not.toBeNull();
    act(() => cta.click());
    expect(compared).toEqual([['codex', 'claude']]);
    unmount();
  });

  it('卡片 ↔ 表格切换后选中态保持（共享同一 state）', async () => {
    localStorage.setItem(AGENT_VIEW_KEY, 'cards');
    const { unmount } = mount(
      <AgentOverview
        locale="zh"
        load={async () => ({ rows: twoRows, stamp: 's1', cached: true })}
        onCompareProviders={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const box = document.querySelector<HTMLInputElement>('.agent-card-compare')!;
    act(() => box.click());
    expect(document.querySelectorAll('.agent-card-on').length).toBe(1);

    const tableBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '表格');
    act(() => tableBtn!.click());
    const tableBoxes = Array.from(document.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
    expect(tableBoxes.filter((b) => b.checked).length).toBe(1);

    const cardsBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '卡片');
    act(() => cardsBtn!.click());
    expect(document.querySelectorAll('.agent-card-on').length).toBe(1);
    unmount();
  });
});
