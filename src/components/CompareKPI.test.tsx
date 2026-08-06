import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionIndexEntry } from '../core/trace-types.js';
import { CompareKPI, MIN_TREND_SESSIONS } from './CompareKPI.js';
import { makeEvent, makeResult } from './compare-test-fixtures.js';

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

function clickByLabel(html: () => string, label: string): void {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.getAttribute('aria-label') === label,
  );
  expect(button).toBeDefined();
  act(() => {
    button!.click();
  });
  expect(html()).toContain('compare-kpi-detail');
}

describe('CompareKPI（建议 7 drill-down）', () => {
  it('e2e 卡片点击展开速度构成明细', () => {
    const { html, unmount } = mount(<CompareKPI result={makeResult()} locale="zh" />);
    clickByLabel(html, '快 点击展开构成明细');
    expect(html()).toContain('TTFT');
    expect(html()).toContain('纯推理时间');
    unmount();
  });

  it('Token 卡片点击展开 Top-10 token 事件双列对比（REQ-100）', () => {
    const tokenEvent = (id: string): ReturnType<typeof makeEvent> =>
      makeEvent({
        id,
        kind: 'llm',
        title: `big call ${id}`,
        tokens: { input: 100, output: 300, reasoning: 50, cacheRead: 0, cacheWrite: 0, netInput: 100, total: 450 },
      });
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [tokenEvent('l1'), makeEvent({ id: 'l2', kind: 'llm', title: 'small call', tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1, total: 2 } })],
      },
      right: {
        ...makeResult().right,
        events: [tokenEvent('r1')],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, 'Token 点击展开构成明细');
    expect(html()).toContain('Token 消耗 TOP 10');
    expect(html()).toContain('big call l1');
    expect(html()).toContain('450');
    unmount();
  });

  it('Events 卡片展开事件类型分布双条形图（REQ-100）', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'a1', kind: 'bash', title: 'run' }),
          makeEvent({ id: 'a2', kind: 'bash', title: 'run 2' }),
          makeEvent({ id: 'a3', kind: 'llm', title: 'think' }),
        ],
      },
      right: {
        ...makeResult().right,
        events: [makeEvent({ id: 'b1', kind: 'llm', title: 'think' })],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '事件 点击展开构成明细');
    expect(html()).toContain('事件类型分布');
    expect(html()).toContain('kpi-drilldown-events');
    unmount();
  });

  it('Failures 卡片展开失败事件明细（标题 + 错误类型 + 时间）（REQ-100）', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'f1', tool: 'Bash', status: 'error', error: 'ETIMEDOUT', startedAt: '2026-08-01T01:02:03.000Z' }),
          makeEvent({ id: 'f2', status: 'success', title: 'ok' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '失败事件 点击展开构成明细');
    expect(html()).toContain('失败事件明细');
    expect(html()).toContain('timeout');
    expect(html()).toContain('01:02:03');
    unmount();
  });

  it('LLM Calls 卡片展开双 TraceTimeline compact（REQ-100）', () => {
    const llm = Array.from({ length: 25 }, (_, i) =>
      makeEvent({ id: `llm-${i}`, kind: 'llm', title: `call ${i}` }),
    );
    const result = makeResult({
      left: { ...makeResult().left, events: llm },
      right: { ...makeResult().right, events: llm.slice(0, 5) },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, 'LLM 调用数 点击展开构成明细');
    expect(html()).toContain('LLM 时间线');
    expect(html()).toContain('kpi-drilldown-duration');
    unmount();
  });

  it('手风琴模式：同一时刻仅一张卡展开（REQ-100）', () => {
    const { html, unmount } = mount(<CompareKPI result={makeResult()} locale="zh" />);
    clickByLabel(html, 'Token 点击展开构成明细');
    const openButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"]'));
    expect(openButtons.length).toBe(1);
    clickByLabel(html, '事件 点击展开构成明细');
    const openButtonsAfter = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"]'));
    expect(openButtonsAfter.length).toBe(1);
    expect(openButtonsAfter[0]?.getAttribute('aria-label')).toContain('事件');
    unmount();
  });

  it('修复循环卡片展开失败分布（按动作分组）', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'e1', tool: 'Bash', status: 'error', error: 'timeout' }),
          makeEvent({ id: 'e2', tool: 'Read', status: 'error', error: 'ENOENT' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '修复循环数 点击展开构成明细');
    expect(html()).toContain('Bash');
    expect(html()).toContain('Read');
    unmount();
  });

  it('建议 7：错误率卡片展开按动作分组的错误分布', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'e1', tool: 'Bash', status: 'error', error: 'timeout' }),
          makeEvent({ id: 'e2', tool: 'Read', status: 'error', error: 'ENOENT' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '错误率 点击展开构成明细');
    expect(html()).toContain('Bash');
    expect(html()).toContain('Read');
    unmount();
  });

  it('建议 7：验证覆盖率卡片展开验证事件列表', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'v1', phase: 'verify', title: 'vitest run' }),
          makeEvent({ id: 'v2', phase: 'implement' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '验证覆盖率 点击展开构成明细');
    expect(html()).toContain('vitest run');
    unmount();
  });
});

function historySessions(
  provider: 'codex' | 'claude',
  sourceAgent: string,
  n: number,
): SessionIndexEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${provider}-${i}`,
    provider,
    sourceAgent,
    title: `session ${i}`,
    startedAt: `2026-08-0${i + 1}T00:00:00.000Z`,
    updatedAt: `2026-08-0${i + 1}T00:10:00.000Z`,
    status: 'success',
    cwd: '/tmp',
    eventCount: 10 * (i + 1),
    messageCount: i + 1,
    tokenTotal: 1000 * (i + 1),
    costUsd: 0.01 * (i + 1),
    dataSource: 'scan',
    sourcePath: `/tmp/${provider}-${i}.jsonl`,
    detailLoaded: true,
    mergeGroupId: null,
    hasSystemPrompt: false,
  })) as SessionIndexEntry[];
}

describe('REQ-122 KPI 跨会话趋势 sparkline', () => {
  it('两侧各 >= 3 个历史会话时，events/tokens/cost/userRounds 卡显示双线 sparkline', () => {
    const result = makeResult();
    const sessions = [
      ...historySessions('codex', result.left.session.sourceAgent, 3),
      ...historySessions('claude', 'Claude Code', 4),
    ];
    // 右侧 fixture 也是 codex/Codex，历史会话与左侧共用
    const { unmount } = mount(<CompareKPI result={result} locale="en" sessions={sessions} />);
    const trends = document.querySelectorAll('.compare-kpi-trend:not(.compare-kpi-trend-empty)');
    expect(trends.length).toBe(4); // events / tokens / cost / userRounds
    // 每张卡两条线（L + R）
    expect(trends[0]!.querySelectorAll('path').length).toBe(2);
    expect(document.querySelector('.compare-kpi-trend path')?.getAttribute('stroke')).toBe(
      `var(--provider-${result.left.session.provider})`,
    );
    unmount();
  });

  it('历史会话不足 3 个时显示 Need 3+ sessions for trend，不画空图', () => {
    const result = makeResult();
    const sessions = historySessions('codex', result.left.session.sourceAgent, 2);
    const { unmount } = mount(<CompareKPI result={result} locale="en" sessions={sessions} />);
    const empties = document.querySelectorAll('.compare-kpi-trend-empty');
    expect(empties.length).toBe(4);
    expect(empties[0]!.textContent).toBe(`Need ${MIN_TREND_SESSIONS}+ sessions for trend`);
    expect(document.querySelector('.compare-kpi-trend path')).toBeNull();
    unmount();
  });

  it('无历史数据的 KPI 卡不渲染趋势区（不编造数据）', () => {
    const result = makeResult();
    const sessions = historySessions('codex', result.left.session.sourceAgent, 5);
    const { unmount } = mount(<CompareKPI result={result} locale="en" sessions={sessions} />);
    const cells = document.querySelectorAll('.compare-kpi-cell');
    const withTrend = document.querySelectorAll('.compare-kpi-trend');
    expect(cells.length).toBeGreaterThan(withTrend.length);
    unmount();
  });

  it('不传 sessions 时完全不渲染趋势（向后兼容）', () => {
    const { unmount } = mount(<CompareKPI result={makeResult()} locale="zh" />);
    expect(document.querySelectorAll('.compare-kpi-trend').length).toBe(4);
    expect(document.querySelectorAll('.compare-kpi-trend-empty').length).toBe(4);
    unmount();
  });
});
