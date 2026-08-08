import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TraceEvent, TraceEventRaw, TurnMessage } from '../../core/trace-types.js';
import { eventDetailCache } from '../../cache/caches.js';
import { MessageCard } from './MessageCard.js';
import { isCallShapedId } from './ToolCallBlock.js';

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

function fullEvent(over: Partial<TraceEvent>): TraceEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    sequence: 1,
    turnKey: null,
    kind: 'tool',
    phase: 'implement',
    title: 'Bash: npm test',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: 'Bash',
    tokens: null,
    error: null,
    hasInput: true,
    hasOutput: true,
    hasRaw: true,
    inputSummary: 'npm test',
    outputSummary: 'PASS 1 test',
    ...over,
  };
}

function toolMessage(over: Partial<TurnMessage> = {}): TurnMessage {
  return {
    eventId: 'toolu_0117nwDWENk6VtST1KBHjGxX',
    sequence: 2,
    role: 'tool',
    kind: 'tool',
    title: 'Bash',
    tool: 'Bash',
    startedAt: '2026-08-01T00:00:01.000Z',
    durationMs: 50,
    status: 'success',
    tokens: null,
    hasInput: true,
    hasOutput: true,
    hasRaw: true,
    error: null,
    ...over,
  };
}

describe('MessageCard（D4 / D12）', () => {
  it('正文首扩恰好一次请求，折叠再展开零请求；Raw 恰好一次（D16）', async () => {
    const loadDetail = vi.fn(async () => fullEvent({}));
    const loadRaw = vi.fn(async (): Promise<TraceEventRaw> => ({ ...fullEvent({}), raw: '{"raw":1}' }));
    const { html, unmount } = mount(
      <MessageCard
        locale="zh"
        sessionKey="s1"
        message={toolMessage()}
        loadDetail={loadDetail}
        loadRaw={loadRaw}
      />,
    );
    // 首扩 → 1 次 body 请求
    act(() => {
      (document.querySelector('.message-card-header button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(html()).toContain('PASS 1 test');
    // 折叠再展开 → 零新请求（LRU 缓存）
    act(() => {
      (document.querySelector('.message-card-header button') as HTMLButtonElement).click();
    });
    act(() => {
      (document.querySelector('.message-card-header button') as HTMLButtonElement).click();
    });
    expect(loadDetail).toHaveBeenCalledTimes(1);
    // Raw → 恰好一次
    act(() => {
      const rawButton = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Raw',
      );
      (rawButton as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadRaw).toHaveBeenCalledTimes(1);
    expect(html()).toContain('{"raw":1}');
    // Raw 再来一次 → 零新请求
    act(() => {
      const sourceButton = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === '渲染',
      );
      (sourceButton as HTMLButtonElement).click();
    });
    act(() => {
      const rawButton = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Raw',
      );
      (rawButton as HTMLButtonElement).click();
    });
    expect(loadRaw).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('assistant 卡：reasoning 折叠 + 回复 + 两个嵌套调用块（D4，不是两张工具卡）', async () => {
    const llm: TurnMessage = {
      eventId: 'call_00_abc',
      sequence: 1,
      role: 'assistant',
      kind: 'llm',
      title: 'let me check',
      tool: null,
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'success',
      tokens: null,
      hasInput: true,
      hasOutput: true,
      hasRaw: true,
      error: null,
    };
    const reasoning: TurnMessage = { ...llm, eventId: 'reason-1', sequence: 0, role: 'reasoning', kind: 'reasoning', title: 'thinking' };
    const tool1 = toolMessage({ eventId: 'toolu_aa', sequence: 2, title: 'Read' });
    const tool2 = toolMessage({ eventId: 'toolu_bb', sequence: 3, title: 'Bash' });
    const loadDetail = vi.fn(async (key: string, eventId: string): Promise<TraceEvent> => {
      if (eventId === 'reason-1') {
        return fullEvent({ id: 'reason-1', kind: 'reasoning', outputSummary: 'step by step' });
      }
      if (eventId === 'toolu_aa') {
        return fullEvent({ id: 'toolu_aa', tool: 'Read', inputSummary: '{"path":"a.ts"}' });
      }
      if (eventId === 'toolu_bb') {
        return fullEvent({ id: 'toolu_bb', tool: 'Bash', inputSummary: 'npm test' });
      }
      return fullEvent({ id: eventId, kind: 'llm', outputSummary: 'done' });
    });
    const { html, unmount } = mount(
      <MessageCard
        locale="zh"
        sessionKey="s1"
        message={llm}
        assistant={{ members: [reasoning, llm], toolCalls: [tool1, tool2] }}
        loadDetail={loadDetail}
      />,
    );
    act(() => {
      (document.querySelector('.message-card-header button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const card = document.querySelector('.message-card-role-assistant');
    expect(card).not.toBeNull();
    // 嵌套调用块在 assistant 卡内部，不是兄弟卡
    expect(card!.querySelectorAll('.tool-call-block').length).toBe(2);
    expect(card!.querySelectorAll('.tool-call-block-id').length).toBe(2);
    // reasoning 默认折叠（details 未 open）
    const reasoningDetails = card!.querySelector('.message-card-reasoning');
    expect(reasoningDetails).not.toBeNull();
    expect((reasoningDetails as HTMLDetailsElement).open).toBe(false);
    // 回复与调用 id 原样展示
    expect(html()).toContain('done');
    expect(html()).toContain('toolu_aa');
    expect(html()).toContain('toolu_bb');
    unmount();
  });

  it('hasOutput=false 的工具结果卡渲染 EmptyState，不发起正文请求（边例表）', () => {
    const loadDetail = vi.fn();
    const msg = toolMessage({ hasOutput: false });
    const { html, unmount } = mount(
      <MessageCard locale="zh" sessionKey="s1" message={msg} loadDetail={loadDetail} />,
    );
    act(() => {
      (document.querySelector('.message-card-header button') as HTMLButtonElement).click();
    });
    expect(html()).toContain('无结果记录');
    expect(loadDetail).not.toHaveBeenCalled();
    unmount();
  });

  it('compact 卡：单行、不展开（D4 rule 4）', () => {
    const compactMsg: TurnMessage = {
      eventId: 'compact-1',
      sequence: 9,
      role: 'compact',
      kind: 'compact',
      title: 'context compacted',
      tool: null,
      startedAt: '2026-08-01T00:00:09.000Z',
      durationMs: 0,
      status: 'success',
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 1200 },
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      error: null,
    };
    const { html, unmount } = mount(
      <MessageCard locale="zh" sessionKey="s1" message={compactMsg} />,
    );
    expect(html()).toContain('上下文已压缩');
    expect(document.querySelector('.message-card-header button')).toBeNull();
    unmount();
  });

  it('正文失败显示错误 + 重试；重试成功后渲染正文（四态）', async () => {
    const loadDetail = vi
      .fn<(key: string, eventId: string) => Promise<TraceEvent>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(fullEvent({}));
    const { html, unmount } = mount(
      <MessageCard locale="zh" sessionKey="s1" message={toolMessage()} loadDetail={loadDetail} />,
    );
    act(() => {
      (document.querySelector('.message-card-header button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('boom');
    act(() => {
      (document.querySelector('.ui-error button') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('PASS 1 test');
    unmount();
  });

  it('durationSource=derived 时 assistant 卡渲染推导口径行（D7）', () => {
    const llm: TurnMessage = {
      eventId: 'call_00_abc',
      sequence: 1,
      role: 'assistant',
      kind: 'llm',
      title: 't',
      tool: null,
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 100,
      status: 'success',
      tokens: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      error: null,
    };
    const { html, unmount } = mount(
      <MessageCard locale="zh" sessionKey="s1" message={llm} durationSource="derived" />,
    );
    expect(html()).toContain('时长由相邻时间戳推导');
    unmount();
  });

  it('D5：调用 id 原样展示；非调用形回退 #sequence', () => {
    expect(isCallShapedId('toolu_0117nwDWENk6VtST1KBHjGxX')).toBe(true);
    expect(isCallShapedId('call_00_FUHEa1XZOVIWinblpRnH4144')).toBe(true);
    expect(isCallShapedId('msg_e5a6706dd001EO50ARXbYTFmlW-1')).toBe(true);
    expect(isCallShapedId('not-a-call-id')).toBe(false);
  });
});
