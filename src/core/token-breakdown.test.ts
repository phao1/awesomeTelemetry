import { describe, expect, it } from 'vitest';

import type { TraceEvent, TraceRecord } from './trace-types.js';
import { computeTokenBreakdown, extractTokenText } from './token-breakdown.js';

function ev(id: string, cacheRead: number): TraceEvent {
  return {
    id, sessionId: 's1', sequence: 1, kind: 'llm', phase: 'implement', title: '',
    startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0, status: 'success',
    actor: 'assistant', tool: null,
    tokens: { input: 1, output: 2, reasoning: 1, cacheRead, cacheWrite: 0, total: 1 + 2 + 1 + cacheRead },
    error: null, hasInput: false, hasOutput: false, hasRaw: false,
    inputSummary: null, outputSummary: null,
  };
}

const base: Omit<TraceRecord, 'events'> = {
  session: {
    id: 's1', provider: 'opencode', sourceAgent: 'OpenCode', title: '', startedAt: 'x',
    updatedAt: 'x', status: 'success', cwd: null, messageCount: 0, eventCount: 2,
    tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUsd: 0, systemPrompt: null, dataSource: 'scan', sourcePath: '/tmp/x', totalDurationMs: 0,
    isSubagent: false,
  },
  tokenSemantics: { cacheRead: 'cumulative', reasoning: 'incremental' },
};

describe('REQ-007 token 分解', () => {
  it('按 tokenSemantics 聚合', () => {
    const record: TraceRecord = { ...base, events: [ev('a', 10), ev('b', 30)] };
    const breakdown = computeTokenBreakdown(record);
    expect(breakdown.cacheRead).toBe(30); // cumulative → max
    expect(breakdown.input).toBe(2);
    expect(breakdown.output).toBe(4);
    expect(breakdown.reasoning).toBe(2);
    expect(breakdown.total).toBe(2 + 4 + 2 + 30);
  });

  it('extractTokenText 可读文本', () => {
    expect(extractTokenText({ input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, total: 10 })).toContain('total 10');
    expect(extractTokenText(null)).toBe('tokens: n/a');
  });
});
