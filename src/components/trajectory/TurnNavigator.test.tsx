import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { TraceTurn, TurnModel } from '../../core/trace-types.js';
import { TurnNavigator } from './TurnNavigator.js';

function turn(index: number, ms = 100, toolCount = 1, error = false): TraceTurn {
  return { index, kind: 'cycle', startedAt: '2026-10-15T00:00:00Z', durationMs: ms,
    model: 'gpt', messageCount: toolCount, toolCount, status: error ? 'error' : 'success', badges: [],
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, netInput: 1, total: 2 },
    messages: Array.from({ length: toolCount }, (_, n) => ({
      eventId: `tool-${index}-${n}`, sequence: index * 10 + n, role: 'tool' as const, kind: 'tool' as const,
      title: 'exec', tool: 'exec', startedAt: '2026-10-15T00:00:00Z', durationMs: ms,
      status: error ? 'error' as const : 'success' as const, tokens: null,
      hasInput: true, hasOutput: true, hasRaw: true, error: error ? 'exit 1' : null,
    })) };
}

function model(turns: TraceTurn[]): TurnModel {
  return { turns, complete: true, omittedEventCount: 0, segmentationSource: 'turn_key' };
}

describe('single-row turn navigator', () => {
  it('virtualizes 1200 turns, keeps the active turn visible, and accepts repeated clicks', () => {
    const el = document.createElement('div'); document.body.append(el);
    const root = createRoot(el); const onActivate = vi.fn();
    act(() => root.render(<TurnNavigator model={model(Array.from({ length: 1200 }, (_, i) => turn(i)))}
      locale="zh" activeTurnIndex={1199} onActivate={onActivate} />));
    expect(el.querySelectorAll('.turn-mark').length).toBeLessThan(30);
    const target = el.querySelector('.turn-mark-active') as HTMLButtonElement;
    expect(target.textContent).toBe('1199');
    act(() => { target.click(); target.click(); });
    expect(onActivate.mock.calls).toEqual([[1199], [1199]]);
    act(() => root.unmount()); el.remove();
  });

  it('renders exactly one separated mark per turn, including turns with multiple tool calls', () => {
    const el = document.createElement('div'); document.body.append(el);
    const root = createRoot(el);
    act(() => root.render(<TurnNavigator model={model([turn(0, 10, 0), turn(1, 100, 2, true), turn(2, 40000, 1)])}
      locale="zh" activeTurnIndex={0} onActivate={() => undefined} />));
    const marks = [...el.querySelectorAll<HTMLButtonElement>('.turn-mark')];
    expect(marks).toHaveLength(3);
    expect(marks.map((mark) => mark.textContent)).toEqual(['0', '1', '2']);
    expect(marks.map((mark) => mark.style.width)).toEqual(['44px', '44px', '44px']);
    expect(marks.map((mark) => mark.style.left)).toEqual(['0px', '48px', '96px']);
    expect(marks[1]?.getAttribute('aria-label')).toContain('2 次工具调用');
    expect(marks[1]?.getAttribute('aria-label')).toContain('错误');
    expect(marks[2]?.getAttribute('aria-label')).toContain('40.0s');
    expect(el.querySelector('.turn-navigator-controls')).toBeNull();
    expect(el.querySelector('[role="tooltip"]')).toBeNull();
    act(() => root.unmount()); el.remove();
  });
});
