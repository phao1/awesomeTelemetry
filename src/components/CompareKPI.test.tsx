import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '../core/trace-types.js';
import { CompareKPI, MIN_TREND_SESSIONS } from './CompareKPI.js';
import { makeDetail, makeEvent, makeResult } from './compare-test-fixtures.js';

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
  it('WB-003: scopes loaded counts, withholds incomplete ratios and has no Agent-winning arrows', () => {
    const result = makeResult();
    result.right.hasMore = true; result.right.eventTotal = 100;
    const view = mount(<CompareKPI result={result} locale="en" />);
    const cells = [...document.querySelectorAll('.compare-kpi-cell')];
    const verification = cells.find(cell => cell.querySelector('.compare-kpi-label')?.textContent === 'Verification activity / steps')!;
    expect(verification).toBeDefined();
    expect(verification.querySelector('.compare-kpi-values')?.textContent).toContain('R—');
    expect(document.querySelector('.compare-kpi-scope')?.textContent).toContain('1 / 100');
    expect(document.querySelector('.compare-delta-win, .compare-delta-lose')).toBeNull();
    expect(view.html()).not.toMatch(/← L|→ R/);
    view.unmount();
  });

  it('WB-003: verification uses steps, unknown step status does not become zero errors', () => {
    const result = makeResult({ left: makeDetail('left', [
      makeEvent({id:'prompt',kind:'user_prompt'}),
      makeEvent({id:'step1',phase:'verify',status:'unknown'}),
      makeEvent({id:'step2'}),
    ]) });
    const view = mount(<CompareKPI result={result} locale="en" />);
    const find = (key:string):Element => [...document.querySelectorAll('.compare-kpi-cell')].find(cell=>cell.querySelector('.compare-kpi-label')?.textContent===key)!;
    expect(find('Verification activity / steps').querySelector('.compare-kpi-values')?.textContent).toContain('L50.0%');
    expect(find('Error steps / steps').querySelector('.compare-kpi-values')?.textContent).toContain('L—');
    expect(view.html()).toContain('unknown step statuses');
    view.unmount();
  });

  it('WB-002: error and top-token records navigate by exact side/session/event, with no body reads on expansion', () => {
    const fetch = vi.spyOn(globalThis,'fetch');
    const onOpenRun = vi.fn();
    const event = makeEvent({id:'same-opaque-id',title:'Inspect retained record',status:'error',tokens:{input:1,output:1,reasoning:0,cacheRead:0,cacheWrite:0,netInput:1,total:2}});
    const result = makeResult({left:makeDetail('left-run',[event]),right:makeDetail('right-run',[event])});
    const view = mount(<CompareKPI result={result} locale="en" onOpenRun={onOpenRun}/>);
    try {
      clickByLabel(view.html,'Failures click to expand breakdown');
      const rightError = document.querySelector<HTMLButtonElement>('[data-evidence-session="right-run"][data-evidence-event="same-opaque-id"]')!;
      expect(rightError).not.toBeNull(); act(()=>rightError.click());
      expect(onOpenRun).toHaveBeenLastCalledWith('right-run','same-opaque-id');
      clickByLabel(view.html,'Tokens click to expand breakdown');
      const leftToken = document.querySelector<HTMLButtonElement>('[data-evidence-session="left-run"][data-evidence-event="same-opaque-id"]')!;
      expect(leftToken).not.toBeNull(); act(()=>leftToken.click());
      expect(onOpenRun).toHaveBeenLastCalledWith('left-run','same-opaque-id');
      expect(fetch).not.toHaveBeenCalled();
    } finally {view.unmount();fetch.mockRestore();}
  });

  it('WB-006: exposes six primary summaries and keeps additional activity metrics in a labelled closed disclosure', () => {
    const view=mount(<CompareKPI result={makeResult()} locale="en"/>);
    expect(document.querySelectorAll('.compare-kpi-primary > .compare-kpi-cell')).toHaveLength(6);
    const details=document.querySelector<HTMLDetailsElement>('.compare-kpi-more')!;
    expect(details).not.toBeNull();expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain('More recorded activity');
    expect(details.querySelectorAll('.compare-kpi-cell').length).toBeGreaterThan(0);
    view.unmount();
  });

  it('WB-003: reports signed R-minus-L observed differences, not minimum-based percent saved', () => {
    const result=makeResult();result.left.session.tokenUsage.total=100;result.right.session.tokenUsage.total=200;
    const view=mount(<CompareKPI result={result} locale="en"/>);
    const token=[...document.querySelectorAll('.compare-kpi-cell')].find(cell=>cell.querySelector('.compare-kpi-label')?.textContent==='Tokens')!;
    expect(token.querySelector('.compare-delta')?.textContent).toBe('R − L: +100');
    view.unmount();
  });

  it('WB-006: expanded evidence occupies a shared full-width row and Escape returns to its trigger',()=>{
    const view=mount(<CompareKPI result={makeResult()} locale="en"/>);
    const trigger=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.getAttribute('aria-label')==='Failures click to expand breakdown')!;
    act(()=>trigger.click());
    const panel=document.querySelector<HTMLElement>('.compare-kpi-expanded')!;
    expect(panel).not.toBeNull();expect(panel.closest('.compare-kpi-cell')).toBeNull();
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    act(()=>panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(document.querySelector('.compare-kpi-expanded')).toBeNull();expect(document.activeElement).toBe(trigger);
    view.unmount();
  });
  it('does not print an infinite percentage for individually finite wall-clock values', () => {
    const result = makeResult(); result.speed.left.e2eMs = Number.MAX_VALUE; result.speed.right.e2eMs = 1;
    const { html, unmount } = mount(<CompareKPI result={result} locale="en" />);
    expect(html()).not.toContain('Infinity%'); unmount();
  });
  it('keeps event-duration values but gives no winner or equality when the declaration is unknown or mixed', () => {
    const result = makeResult(); result.speed.left.avgLlmDurationMs = null;
    const { html, unmount } = mount(<CompareKPI result={result} locale="en" />);
    const cell = [...document.querySelectorAll('[data-scan-timing-reason]')];
    expect(cell.length).toBeGreaterThanOrEqual(2);
    expect(cell.every(node => !node.textContent!.includes('% ←') && !node.textContent!.includes('% →'))).toBe(true);
    expect(html()).toContain('Not comparable'); expect(html()).toContain('—'); unmount();
  });
  it('retains finite declared event durations and descriptive wall-clock comparisons but hides invalid drill-down rates', () => {
    const result = makeResult(); result.left.session.durationSource = 'measured'; result.right.session.durationSource = 'measured';
    result.speed.left.avgLlmDurationMs = 100; result.speed.right.avgLlmDurationMs = 200;
    result.speed.left.tps = NaN; result.speed.left.tpotMs = -1;
    const { html, unmount } = mount(<CompareKPI result={result} locale="en" />);
    expect(document.querySelectorAll('[data-scan-timing-reason]')).toHaveLength(0);
    const delta = [...document.querySelectorAll('.compare-kpi-cell')].find(node => node.querySelector('.compare-kpi-label')?.textContent?.includes('Avg LLM'))!;
    expect(delta.querySelector('.compare-delta')?.textContent).toBe('R − L: +0.1s');
    expect(delta.querySelector('.compare-delta-win, .compare-delta-lose')).toBeNull();
    const actualE2e = [...document.querySelectorAll<HTMLButtonElement>('.compare-kpi-cell button')].find(button => button.getAttribute('aria-label')?.startsWith('Wall-clock interval '))!;
    expect(actualE2e).toBeDefined();
    act(() => actualE2e.click()); expect(html()).not.toContain('NaN'); expect(html()).not.toContain('-1.0ms'); unmount();
  });
  it('e2e 卡片点击展开速度构成明细', () => {
    const { html, unmount } = mount(<CompareKPI result={makeResult()} locale="zh" />);
    clickByLabel(html, '墙钟间隔 点击展开构成明细');
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
    clickByLabel(html, '错误步骤 / 步骤 点击展开构成明细');
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
    clickByLabel(html, '验证活动 / 步骤 点击展开构成明细');
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
  it('两侧各 >= 3 个历史会话时，保留 events/tokens/userRounds 趋势，不再显示金额趋势', () => {
    const result = makeResult();
    const sessions = [
      ...historySessions('codex', result.left.session.sourceAgent, 3),
      ...historySessions('claude', 'Claude Code', 4),
    ];
    // 右侧 fixture 也是 codex/Codex，历史会话与左侧共用
    const { unmount } = mount(<CompareKPI result={result} locale="en" sessions={sessions} />);
    const trends = document.querySelectorAll('.compare-kpi-trend:not(.compare-kpi-trend-empty)');
    expect(trends.length).toBe(3); // events / tokens / userRounds; money intentionally removed
    expect([...document.querySelectorAll('.compare-kpi-label')].map(el=>el.textContent)).not.toContain('Cost');
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
    expect(empties.length).toBe(3);
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
    expect(document.querySelectorAll('.compare-kpi-trend').length).toBe(3);
    expect(document.querySelectorAll('.compare-kpi-trend-empty').length).toBe(3);
    unmount();
  });
});
