import { describe, expect, it } from 'vitest';

import type { TraceEventSlim } from './trace-types.js';
import { computePhaseTrends } from './phase-trend.js';

function event(id: string, phase: string, startedAt: string, durationMs: number): TraceEventSlim {
  return {
    id,
    sessionId: 's1',
    sequence: 1,
    kind: 'llm',
    phase: phase as TraceEventSlim['phase'],
    title: '',
    startedAt,
    durationMs,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
  };
}

describe('computePhaseTrends（建议 10）', () => {
  it('空事件返回全空数组', () => {
    const out = computePhaseTrends([]);
    for (const phase of Object.keys(out)) {
      expect(out[phase as keyof typeof out]).toEqual([]);
    }
  });

  it('按时间桶累计各阶段时长', () => {
    const out = computePhaseTrends(
      [
        event('a', 'implement', '2026-08-01T00:00:00.000Z', 100),
        event('b', 'implement', '2026-08-01T00:00:10.000Z', 200),
        event('c', 'verify', '2026-08-01T00:00:20.000Z', 300),
      ],
      4,
    );
    expect(out.implement.length).toBe(4);
    expect(out.implement.reduce((a, b) => a + b, 0)).toBe(300);
    expect(out.verify.reduce((a, b) => a + b, 0)).toBe(300);
    expect(out.understand.every((v) => v === 0)).toBe(true);
  });
});
