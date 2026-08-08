import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TraceKind, TraceTurn, TurnMessage, TurnModel } from '../../core/trace-types.js';
import { TurnRibbon } from './TurnRibbon.js';

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

function turn(index: number, role: TurnMessage['role'], durationMs: number): TraceTurn {
  const tokens = { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 10, total: 15 };
  return {
    index,
    kind: index === 0 ? 'init' : 'cycle',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs,
    tokens,
    model: null,
    messageCount: 1,
    toolCount: role === 'tool' ? 1 : 0,
    status: 'success',
    badges: [],
    messages: [
      {
        eventId: `e${index}`,
        sequence: index + 1,
        role,
        kind: ROLE_KIND[role],
        title: `t${index}`,
        tool: role === 'tool' ? 'Bash' : null,
        startedAt: '2026-08-01T00:00:00.000Z',
        durationMs,
        status: 'success',
        tokens: null,
        hasInput: false,
        hasOutput: false,
        hasRaw: false,
        error: null,
      },
    ],
  };
}

function model(turns: TraceTurn[]): TurnModel {
  return {
    turns,
    segmentationSource: 'turn_key',
    complete: true,
    omittedEventCount: 0,
  };
}

describe('TurnRibbon（D10）', () => {
  it('图例 = 6 项（swatch + icon + 名称），颜色不单独承载含义', () => {
    const m = model([turn(1, 'assistant', 100)]);
    mount(<TurnRibbon model={m} mode="time" locale="zh" onActivate={() => undefined} />);
    const items = document.querySelectorAll('.turn-ribbon-legend-item');
    expect(items.length).toBe(6);
    for (const item of items) {
      expect(item.querySelector('.turn-ribbon-swatch')).not.toBeNull();
      expect(item.querySelector('svg')).not.toBeNull();
      expect(item.textContent?.trim().length).toBeGreaterThan(0);
    }
    const labels = Array.from(items).map((item) => item.textContent?.trim());
    expect(labels).toContain('系统');
    expect(labels).toContain('用户');
    expect(labels).toContain('助手');
    expect(labels).toContain('工具');
    expect(labels).toContain('思考');
    expect(labels).toContain('压缩');
  });

  it('每段带可访问标签（回合索引/范围、时长、token），键盘可激活', () => {
    const m = model([
      turn(1, 'assistant', 300),
      turn(2, 'tool', 700),
      turn(3, 'user', 200),
    ]);
    const onActivate = vi.fn();
    mount(<TurnRibbon model={m} mode="time" locale="zh" onActivate={onActivate} />);
    const segments = document.querySelectorAll('.turn-ribbon-segment');
    expect(segments.length).toBe(3);
    const labels = Array.from(segments).map((seg) => seg.getAttribute('aria-label'));
    expect(labels[0]).toContain('duration 300 ms');
    expect(labels[0]).toContain('tokens 15');
    act(() => {
      (segments[1] as HTMLButtonElement).click();
    });
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('activeTurnIndex 高亮对应段（--ribbon-active，双向高亮写回）', () => {
    const m = model([turn(1, 'assistant', 100), turn(2, 'tool', 100)]);
    const { unmount } = mount(
      <TurnRibbon model={m} mode="time" locale="zh" activeTurnIndex={2} onActivate={() => undefined} />,
    );
    const segments = Array.from(document.querySelectorAll('.turn-ribbon-segment'));
    expect(segments[1]!.classList.contains('turn-ribbon-segment-active')).toBe(true);
    expect(segments[0]!.classList.contains('turn-ribbon-segment-active')).toBe(false);
    unmount();
  });

  it('零回合渲染空容器，不崩溃（边例表）', () => {
    const m = model([]);
    const { unmount } = mount(<TurnRibbon model={m} mode="time" locale="zh" onActivate={() => undefined} />);
    expect(document.querySelectorAll('.turn-ribbon-segment').length).toBe(0);
    unmount();
  });
});
