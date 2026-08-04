import { describe, expect, it } from 'vitest';

import type { TraceRecord } from './trace-types.js';
import { computeSpeedMetrics } from './speed-metrics.js';

function makeRecord(): TraceRecord {
  return {
    session: {
      id: 's1',
      provider: 'codex',
      sourceAgent: 'Codex',
      title: 'speed',
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:20.000Z',
      status: 'success',
      cwd: null,
      messageCount: 3,
      eventCount: 4,
      tokenUsage: { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2, total: 165 },
      costUsd: 0.01,
      systemPrompt: null,
      dataSource: 'scan',
      sourcePath: '/tmp/s1.jsonl',
      totalDurationMs: 20_000,
      isSubagent: false,
    },
    events: [
      {
        id: 'e1', sessionId: 's1', sequence: 1, kind: 'user_prompt', phase: 'understand',
        title: 'q1', startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0,
        status: 'success', actor: 'user', tool: null, tokens: null, error: null,
        hasInput: true, hasOutput: false, hasRaw: false, inputSummary: 'q1', outputSummary: null,
      },
      {
        id: 'e2', sessionId: 's1', sequence: 2, kind: 'llm', phase: 'implement',
        title: 'a1', startedAt: '2026-08-01T00:00:01.000Z', durationMs: 200,
        status: 'success', actor: 'assistant', tool: null,
        tokens: { input: 50, output: 30, reasoning: 5, cacheRead: 0, cacheWrite: 0, total: 85 },
        error: null, hasInput: false, hasOutput: true, hasRaw: false, inputSummary: null, outputSummary: 'a1',
      },
      {
        id: 'e3', sessionId: 's1', sequence: 3, kind: 'user_prompt', phase: 'understand',
        title: 'q2', startedAt: '2026-08-01T00:00:10.000Z', durationMs: 0,
        status: 'success', actor: 'user', tool: null, tokens: null, error: null,
        hasInput: true, hasOutput: false, hasRaw: false, inputSummary: 'q2', outputSummary: null,
      },
      {
        id: 'e4', sessionId: 's1', sequence: 4, kind: 'llm', phase: 'implement',
        title: 'a2', startedAt: '2026-08-01T00:00:12.000Z', durationMs: 300,
        status: 'success', actor: 'assistant', tool: null,
        tokens: { input: 50, output: 20, reasoning: 5, cacheRead: 0, cacheWrite: 0, total: 75 },
        error: null, hasInput: false, hasOutput: true, hasRaw: false, inputSummary: null, outputSummary: 'a2',
      },
    ],
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
  };
}

describe('REQ-006 speed metrics', () => {
  it('TTFT/TPS/TPOT/E2E/turnGap/pureInferenceMs', () => {
    const s = computeSpeedMetrics(makeRecord());
    expect(s.ttftMs).toBe(200);
    expect(s.tps).toBeCloseTo((50 / 500) * 1000);
    expect(s.tpotMs).toBeCloseTo(500 / 50);
    expect(s.e2eMs).toBe(20_000);
    expect(s.turnGapMedianMs).toBe(10_000);
    expect(s.pureInferenceMs).toBe(500); // 只累计 llm，不含 tool
  });

  it('无 llm 事件时 ttft/tps/tpot 为 null', () => {
    const record = makeRecord();
    record.events = record.events.filter((e) => e.kind !== 'llm');
    const s = computeSpeedMetrics(record);
    expect(s.ttftMs).toBeNull();
    expect(s.tps).toBeNull();
    expect(s.tpotMs).toBeNull();
    expect(s.pureInferenceMs).toBe(0);
  });
});
