import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TraceKind, TraceStatus, TraceTurn, TurnMessage, TurnModel } from '../../core/trace-types.js';
import { TrajectoryAnalysisPanel } from './TrajectoryAnalysisPanel.js';

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
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

const ROLE_KIND: Record<TurnMessage['role'], TraceKind> = {
  system: 'system',
  user: 'user_prompt',
  assistant: 'llm',
  tool: 'tool',
  reasoning: 'reasoning',
  compact: 'compact',
  subagent: 'subagent_prompt',
};

function message(id: string, role: TurnMessage['role'], status: TraceStatus = 'success'): TurnMessage {
  return {
    eventId: id,
    sequence: 1,
    role,
    kind: ROLE_KIND[role],
    title: id,
    tool: role === 'tool' ? 'Bash' : null,
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status,
    tokens: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    error: null,
  };
}

function turn(
  index: number,
  durationMs: number,
  input: number,
  messages: TurnMessage[],
  over: Partial<TraceTurn> = {},
): TraceTurn {
  return {
    index,
    kind: 'cycle',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs,
    tokens: { input, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: input, total: input + 5 },
    model: null,
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

describe('TrajectoryAnalysisPanel（§2 / 8.7）', () => {
  it('打开零网络请求（D16），渲染全部 section', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const m = model([
      turn(1, 31_000, 100, [message('e1', 'assistant')]),
      turn(2, 1_000, 51_000, [message('e2', 'tool'), message('e3', 'tool', 'error')]),
    ]);
    const { html, unmount } = mount(<TrajectoryAnalysisPanel model={m} locale="zh" />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(html()).toContain('执行概览');
    expect(html()).toContain('工具使用');
    expect(html()).toContain('耗时 TOP 10');
    expect(html()).toContain('Token TOP 10');
    expect(html()).toContain('缓存率趋势');
    expect(html()).toContain('异常');
    // 阈值：31s > 30s → slow_turn；51k input > 50k → high_input；tool error
    expect(html()).toContain('慢回合');
    expect(html()).toContain('高输入');
    expect(html()).toContain('工具错误');
    unmount();
  });

  it('不完整模型：banner + 所有总量为 —（禁止部分和冒充总量）', () => {
    const m = model([turn(1, 1000, 10, [message('e1', 'assistant')])], {
      complete: false,
      omittedEventCount: 12,
    });
    const { html, unmount } = mount(<TrajectoryAnalysisPanel model={m} locale="zh" />);
    expect(html()).toContain('12');
    expect(html()).toContain('未载入');
    unmount();
  });

  it('无异常时显示「未发现异常」；异常条目带图标 + 文字', () => {
    // cacheRead=20 / input=10 → rate 0.667 ≥ 0.5，无 low_cache 异常
    const t = turn(1, 100, 10, [message('e1', 'assistant')]);
    const m = model([{ ...t, tokens: { ...t.tokens, cacheRead: 20, total: 35 } }]);
    const { html, unmount } = mount(<TrajectoryAnalysisPanel model={m} locale="zh" />);
    expect(html()).toContain('未发现异常');
    unmount();
  });

  it('零回合：每节为空而不失败（metrics-analysis）', () => {
    const m = model([]);
    const { html, unmount } = mount(<TrajectoryAnalysisPanel model={m} locale="zh" />);
    expect(html()).toContain('执行概览');
    unmount();
  });
});
