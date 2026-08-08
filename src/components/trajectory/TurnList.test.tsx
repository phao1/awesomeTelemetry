import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TraceEvent, TraceTurn, TurnMessage, TurnModel } from '../../core/trace-types.js';
import { eventDetailCache } from '../../cache/caches.js';
import { TurnList } from './TurnList.js';
import { groupMessages } from './TurnCard.js';

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
  vi.restoreAllMocks();
  eventDetailCache.clear();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function message(
  id: string,
  role: TurnMessage['role'],
  sequence: number,
  over: Partial<TurnMessage> = {},
): TurnMessage {
  return {
    eventId: id,
    sequence,
    role,
    kind: (role === 'tool' ? 'tool' : role === 'assistant' ? 'llm' : role) as TurnMessage['kind'],
    title: `${role} ${id}`,
    tool: role === 'tool' ? 'Bash' : null,
    startedAt: `2026-08-01T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    durationMs: 100,
    status: 'success',
    tokens: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    error: null,
    ...over,
  };
}

function turn(index: number, messages: TurnMessage[], over: Partial<TraceTurn> = {}): TraceTurn {
  const tokens = { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 10, total: 15 };
  return {
    index,
    kind: 'cycle',
    startedAt: messages[0]!.startedAt,
    durationMs: 1000,
    tokens,
    model: 'gpt-x',
    messageCount: messages.length,
    toolCount: messages.filter((m) => m.tool !== null).length,
    status: 'success',
    badges: [],
    messages,
    ...over,
  };
}

function model(turns: TraceTurn[], over: Partial<TurnModel> = {}): TurnModel {
  return {
    turns,
    segmentationSource: 'turn_key',
    complete: true,
    omittedEventCount: 0,
    ...over,
  };
}

describe('TurnList（D12）', () => {
  it('不完整模型渲染常驻 banner，命名省略事件数（D17）', () => {
    const m = model([turn(1, [message('e1', 'assistant', 1)])], {
      complete: false,
      omittedEventCount: 42,
    });
    const { html, unmount } = mount(<TurnList model={m} sessionKey="s1" locale="zh" expandedIndex={null} onToggleTurn={() => undefined} />);
    expect(html()).toContain('42');
    expect(html()).toContain('未载入');
    unmount();
  });

  it('回合展开：assistant 卡 + 2 个嵌套调用块 + 2 张结果卡，顺序正确（D4/C15）', async () => {
    const llm = message('call_00_a', 'assistant', 1);
    const tool1 = message('toolu_1', 'tool', 2);
    const tool2 = message('toolu_2', 'tool', 3);
    const t = turn(1, [llm, tool1, tool2]);
    const m = model([t]);
    const loadDetail = vi.fn(async (key: string, eventId: string): Promise<TraceEvent> => ({
      id: eventId,
      sessionId: 's1',
      sequence: 2,
      turnKey: null,
      kind: 'tool',
      phase: 'implement',
      title: eventId,
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'success',
      actor: 'assistant',
      tool: 'Bash',
      tokens: null,
      error: null,
      hasInput: true,
      hasOutput: true,
      hasRaw: false,
      inputSummary: `args ${eventId}`,
      outputSummary: `result ${eventId}`,
    }));
    const { html, unmount } = mount(
      <TurnList
        model={m}
        sessionKey="s1"
        locale="zh"
        expandedIndex={1}
        onToggleTurn={() => undefined}
        loadDetail={loadDetail}
      />,
    );
    // 展开 assistant 卡正文（首扩触发成员事件拉取）
    act(() => {
      (document.querySelector('.message-card-role-assistant .message-card-header button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const cards = Array.from(document.querySelectorAll('.turn-card > article'));
    expect(cards.length).toBe(3);
    expect(cards[0]!.classList.contains('message-card-role-assistant')).toBe(true);
    // 调用块嵌套在 assistant 卡内
    expect(cards[0]!.querySelectorAll('.tool-call-block').length).toBe(2);
    expect(cards[1]!.classList.contains('message-card-role-tool')).toBe(true);
    expect(cards[2]!.classList.contains('message-card-role-tool')).toBe(true);
    expect(html()).toContain('toolu_1');
    expect(html()).toContain('toolu_2');
    unmount();
  });

  it('虚拟滚动：200 回合只挂载可视窗口 + buffer，数量稳定（D20）', async () => {
    const turns = Array.from({ length: 200 }, (_, i) =>
      turn(i + 1, [message(`e${i}`, 'assistant', i + 1)]),
    );
    const m = model(turns);
    const loadDetail = vi.fn(async () => ({}) as TraceEvent);
    const { unmount } = mount(
      <TurnList model={m} sessionKey="s1" locale="zh" expandedIndex={null} onToggleTurn={() => undefined} loadDetail={loadDetail} />,
    );
    const mounted = document.querySelectorAll('.turn-row').length;
    expect(mounted).toBeLessThan(200);
    expect(mounted).toBeGreaterThan(0);
    // 滚动后数量保持稳定（虚拟化不因滚动膨胀）
    const scrollEl = document.querySelector('.turn-list-scroll') as HTMLDivElement;
    act(() => {
      scrollEl.scrollTop = 44 * 100;
      scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const afterScroll = document.querySelectorAll('.turn-row').length;
    expect(afterScroll).toBeLessThan(200);
    unmount();
  });

  it('≤50 回合不虚拟化：全部渲染（阈值边界）', () => {
    const turns = Array.from({ length: 50 }, (_, i) =>
      turn(i + 1, [message(`e${i}`, 'assistant', i + 1)]),
    );
    const m = model(turns);
    const { unmount } = mount(
      <TurnList model={m} sessionKey="s1" locale="zh" expandedIndex={null} onToggleTurn={() => undefined} />,
    );
    expect(document.querySelectorAll('.turn-row').length).toBe(50);
    unmount();
  });

  it('回合行键盘可展开/折叠（aria-expanded）', () => {
    const t = turn(1, [message('e1', 'assistant', 1)]);
    const m = model([t]);
    let toggled = 0;
    const { unmount } = mount(
      <TurnList model={m} sessionKey="s1" locale="zh" expandedIndex={null} onToggleTurn={() => { toggled += 1; }} />,
    );
    const row = document.querySelector('.turn-row') as HTMLButtonElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    act(() => row.click());
    expect(toggled).toBe(1);
    unmount();
  });

  it('groupMessages：工具结果在 assistant 卡之后、其余角色按序成卡（D4）', () => {
    const system = message('sys', 'system', 1);
    const llm = message('call_00_a', 'assistant', 2);
    const tool1 = message('toolu_1', 'tool', 3);
    const compact = message('cmp', 'compact', 4);
    const items = groupMessages([system, llm, tool1, compact]);
    expect(items.map((item) => item.kind)).toEqual(['message', 'assistant', 'message', 'message']);
    const assistantItem = items[1];
    expect(assistantItem).toMatchObject({ kind: 'assistant' });
    if (assistantItem !== undefined && assistantItem.kind === 'assistant') {
      expect(assistantItem.toolCalls.map((m) => m.eventId)).toEqual(['toolu_1']);
    }
  });
});
