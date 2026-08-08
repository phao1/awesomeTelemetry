import { describe, expect, it } from 'vitest';

import type { TraceEvent } from '../core/trace-types.js';
import {
  aggregateTokenUsage,
  deriveDurations,
  orderEventsByTime,
  pickPrimaryModel,
  titleFromText,
  DERIVED_DURATION_CAP_MS,
} from './helpers.js';

function ev(
  id: string,
  startedAt: string,
  partial: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    id,
    sessionId: 's1',
    sequence: 1,
    turnKey: null,
    kind: 'llm',
    phase: 'implement',
    title: '',
    startedAt,
    durationMs: 0,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
    ...partial,
  };
}

describe('orderEventsByTime（fix-adapter-turn-semantics A11）', () => {
  it('同时间戳事件以源顺序为 tie-break，不按 sequence 重排', () => {
    const out = orderEventsByTime([
      ev('c', '2026-08-01T00:00:00.000Z', { sequence: 3 }),
      ev('a', '2026-08-01T00:00:00.000Z', { sequence: 1 }),
      ev('b', '2026-08-01T00:00:00.000Z', { sequence: 2 }),
    ]);
    // A11：同时间戳 = 同一条消息的多个 part，源顺序必须保留；
    // sequence 由排序后的位置重新赋值（1-based 连续）。
    expect(out.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(out.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('不同时间戳仍按时间排序', () => {
    const out = orderEventsByTime([
      ev('b', '2026-08-01T00:00:02.000Z'),
      ev('a', '2026-08-01T00:00:01.000Z'),
    ]);
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('deriveDurations（add-mission-control §1 P0-A）', () => {
  it('按时间排序后 durationMs = next − this，末事件为 0', () => {
    const out = deriveDurations([
      ev('a', '2026-08-01T00:00:00.000Z'),
      ev('b', '2026-08-01T00:00:03.000Z'),
      ev('c', '2026-08-01T00:00:08.000Z'),
    ]);
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get('a')!.durationMs).toBe(3000);
    expect(byId.get('b')!.durationMs).toBe(5000);
    expect(byId.get('c')!.durationMs).toBe(0);
  });

  it('user_prompt 不参与推导（其后间隔归 userWait，不算模型/工具耗时）', () => {
    const out = deriveDurations([
      ev('u1', '2026-08-01T00:00:00.000Z', { kind: 'user_prompt', actor: 'user' }),
      ev('a1', '2026-08-01T00:00:04.000Z'),
      ev('a2', '2026-08-01T00:00:07.000Z'),
    ]);
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get('u1')!.durationMs).toBe(0); // user_prompt 跳过
    expect(byId.get('a1')!.durationMs).toBe(3000);
    expect(byId.get('a2')!.durationMs).toBe(0);
  });

  it('超过 5 分钟的间隔被截断到 DERIVED_DURATION_CAP_MS', () => {
    const out = deriveDurations([
      ev('a', '2026-08-01T00:00:00.000Z'),
      ev('b', '2026-08-01T01:00:00.000Z'),
    ]);
    expect(out[0]!.durationMs).toBe(DERIVED_DURATION_CAP_MS);
    expect(out[1]!.durationMs).toBe(0);
  });

  it('已有测量时长的事件不被覆盖', () => {
    const out = deriveDurations([
      ev('a', '2026-08-01T00:00:00.000Z', { durationMs: 9000 }),
      ev('b', '2026-08-01T00:00:05.000Z'),
    ]);
    expect(out[0]!.durationMs).toBe(9000);
  });

  it('空数组不抛错', () => {
    expect(deriveDurations([])).toEqual([]);
  });
});

describe('aggregateTokenUsage（calibrate-tokens-and-compare-report §3）', () => {
  it('netInput = max(0, input − cacheRead)，下限 0', () => {
    const events = [
      ev('a', '2026-08-01T00:00:00.000Z', {
        tokens: { input: 100, output: 10, reasoning: 0, cacheRead: 30, cacheWrite: 5, netInput: 70, total: 145 },
      }),
      ev('b', '2026-08-01T00:00:01.000Z', {
        tokens: { input: 20, output: 10, reasoning: 0, cacheRead: 60, cacheWrite: 0, netInput: 0, total: 90 },
      }),
    ];
    const agg = aggregateTokenUsage(events, { cacheRead: 'incremental', reasoning: 'incremental' });
    // input 120 − cacheRead 90 = 30；若只按单事件看 b 是 0，聚合口径用聚合后的 input/cacheRead
    expect(agg.netInput).toBe(30);
    expect(agg.cacheRead).toBe(90);
    expect(agg.total).toBe(120 + 20 + 90 + 5);
  });
});

describe('pickPrimaryModel（add-mission-control §1 P0-B）', () => {
  it('按 token 占比选主模型', () => {
    const events = [
      ev('a', '2026-08-01T00:00:00.000Z', { model: 'm1', tokens: { input: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 100, total: 100 } }),
      ev('b', '2026-08-01T00:00:01.000Z', { model: 'm2', tokens: { input: 30, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 30, total: 30 } }),
      ev('c', '2026-08-01T00:00:02.000Z', { model: 'm1', tokens: { input: 50, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 50, total: 50 } }),
    ];
    expect(pickPrimaryModel(events)).toBe('m1');
  });

  it('全部无 model 返回 null；空数组返回 null', () => {
    expect(pickPrimaryModel([ev('a', '2026-08-01T00:00:00.000Z', { model: null }), ev('b', '2026-08-01T00:00:01.000Z')])).toBeNull();
    expect(pickPrimaryModel([])).toBeNull();
  });
});

describe('titleFromText 健壮性', () => {
  it('非字符串 text（真实 codex JSONL 的 content.text 为对象）不抛错', () => {
    expect(titleFromText({ type: 'text' } as unknown as string)).toBe('{"type":"text"}');
    expect(titleFromText(42 as unknown as string)).toBe('42');
    expect(titleFromText(null)).toBe('');
    expect(titleFromText(undefined)).toBe('');
  });
});
