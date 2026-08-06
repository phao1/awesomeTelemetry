import { describe, expect, it } from 'vitest';

import type { TraceEvent } from './trace-types.js';
import { eventContentHash, fnv1a64 } from './event-hash.js';

function event(over: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    sequence: 1,
    kind: 'tool',
    phase: 'implement',
    title: 'npm test',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 1000,
    status: 'success',
    actor: 'assistant',
    tool: 'Bash',
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: true,
    inputSummary: null,
    outputSummary: null,
    ...over,
  };
}

describe('eventContentHash（fix-session-detail-display 1.5）', () => {
  it('FNV-1a 64bit 输出固定 16 位 hex', () => {
    expect(fnv1a64('')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('abc')).toBe(fnv1a64('abc'));
    expect(fnv1a64('abc')).not.toBe(fnv1a64('abd'));
  });

  it('内容不变 → 哈希不变', () => {
    const a = event();
    const b = event();
    expect(eventContentHash(a)).toBe(eventContentHash(b));
  });

  it('任一可变列变化 → 哈希变化', () => {
    const base = event();
    const mutators: Array<Partial<TraceEvent>> = [
      { kind: 'llm' },
      { phase: 'debug' },
      { title: 'other' },
      { startedAt: '2026-08-01T00:00:01.000Z' },
      { durationMs: 2000 },
      { status: 'error' },
      { actor: 'user' },
      { tool: 'Read' },
      { inputSummary: 'in' },
      { outputSummary: 'out' },
      { tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1, total: 2 } },
      { error: 'boom' },
      { model: 'gpt-5' },
    ];
    const baseHash = eventContentHash(base);
    for (const m of mutators) {
      expect(eventContentHash(event(m)), JSON.stringify(m)).not.toBe(baseHash);
    }
  });
});
