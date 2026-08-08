import { beforeEach, describe, expect, it } from 'vitest';

import type { TraceEventSlim } from './trace-types.js';
import { computeTimeComposition } from './time-composition.js';

let seq = 0;
beforeEach(() => {
  seq = 0;
});
function ev(partial: Partial<TraceEventSlim>): TraceEventSlim {
  seq += 1;
  return {
    id: `e${seq}`,
    sessionId: 's1',
    sequence: seq,
    turnKey: null,
    kind: 'llm',
    phase: 'implement',
    title: '',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...partial,
  };
}

describe('computeTimeComposition', () => {
  it('模型与工具时长按 kind 归因', () => {
    const events = [
      ev({ startedAt: '2026-08-01T00:00:00.000Z', durationMs: 1000, kind: 'llm' }),
      ev({ startedAt: '2026-08-01T00:00:01.000Z', durationMs: 2000, kind: 'bash', tool: 'bash' }),
    ];
    const comp = computeTimeComposition(events);
    expect(comp.modelMs).toBe(1000);
    expect(comp.toolMs).toBe(2000);
    expect(comp.totalMs).toBe(3000);
  });

  it('事件之间的空档算空转', () => {
    const events = [
      ev({ startedAt: '2026-08-01T00:00:00.000Z', durationMs: 1000, kind: 'bash', tool: 'bash' }),
      ev({ startedAt: '2026-08-01T00:00:05.000Z', durationMs: 1000, kind: 'bash', tool: 'bash' }),
    ];
    const comp = computeTimeComposition(events);
    expect(comp.idleMs).toBe(4000);
  });

  it('user_prompt 之后的空档算用户等待', () => {
    const events = [
      ev({ startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0, kind: 'user_prompt', actor: 'user' }),
      ev({ startedAt: '2026-08-01T00:00:03.000Z', durationMs: 1000, kind: 'llm' }),
    ];
    const comp = computeTimeComposition(events);
    expect(comp.userWaitMs).toBe(3000);
    expect(comp.idleMs).toBe(0);
  });

  it('空数组返回全零', () => {
    expect(computeTimeComposition([])).toMatchObject({
      totalMs: 0,
      modelMs: 0,
      toolMs: 0,
      idleMs: 0,
      userWaitMs: 0,
      segments: [],
    });
  });

  it('回归（add-mission-control 1.6）：claude 推导时长后 userWait 归因与 totalMs 仍正确', () => {
    // 模拟 deriveDurations 的输出：user_prompt 无时长，后续事件时长 = 相邻时间戳差
    const events = [
      ev({ startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0, kind: 'user_prompt', actor: 'user' }),
      ev({ startedAt: '2026-08-01T00:00:05.000Z', durationMs: 5000, kind: 'llm' }),
      ev({ startedAt: '2026-08-01T00:00:11.000Z', durationMs: 4000, kind: 'bash', tool: 'bash' }),
    ];
    const comp = computeTimeComposition(events);
    expect(comp.userWaitMs).toBe(5000); // user_prompt 后的空档（0→5s）算用户等待
    expect(comp.idleMs).toBe(1000); // 5→11s 只有 5s 时长，剩余 1s 空转
    expect(comp.totalMs).toBe(15000); // span = 11s + 4s
    expect(comp.modelMs).toBe(5000);
    expect(comp.toolMs).toBe(4000);
  });
});
