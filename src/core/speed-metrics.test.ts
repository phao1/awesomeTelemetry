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
  it('TTFT/TPS/TPOT/E2E/turnGap/pureInference/avgLlmResponseLatency', () => {
    const s = computeSpeedMetrics(makeRecord());
    // #1：TTFT = 首个 user_prompt(00:00:00) → 首个 llm(00:00:01) 时间差
    expect(s.ttftMs).toBe(1000);
    // #11：TPS = 每事件 TPS 平均：e2 = 30/0.2 = 150，e4 = 20/0.3 ≈ 66.67
    expect(s.tps).toBeCloseTo((150 + 20 / 0.3) / 2);
    // #13：TPOT 只统计有效 llm 事件（此处两个都有效）
    expect(s.tpotMs).toBeCloseTo(500 / 50);
    expect(s.e2eMs).toBe(20_000);
    expect(s.turnGapMedianMs).toBe(10_000);
    expect(s.pureInferenceMs).toBe(500); // 只累计 llm，不含 tool
    // #12：q1→e2 = 1000ms，q2→e4 = 2000ms，均值 1500ms
    expect(s.avgLlmResponseLatencyMs).toBe(1500);
  });

  it('无 llm 事件时 ttft/tps/tpot 为 null', () => {
    const record = makeRecord();
    record.events = record.events.filter((e) => e.kind !== 'llm');
    const s = computeSpeedMetrics(record);
    expect(s.ttftMs).toBeNull();
    expect(s.tps).toBeNull();
    expect(s.tpotMs).toBeNull();
    expect(s.pureInferenceMs).toBe(0);
    expect(s.avgLlmResponseLatencyMs).toBeNull();
  });

  it('#13 零输出/零时长 llm 事件不参与 TPS/TPOT，但计入 pureInferenceMs', () => {
    const record = makeRecord();
    record.events.push({
      id: 'e5', sessionId: 's1', sequence: 5, kind: 'llm', phase: 'implement',
      title: 'empty', startedAt: '2026-08-01T00:00:13.000Z', durationMs: 0,
      status: 'error', actor: 'assistant', tool: null,
      tokens: { input: 10, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10 },
      error: 'empty response', hasInput: false, hasOutput: false, hasRaw: false,
      inputSummary: null, outputSummary: null,
    });
    const s = computeSpeedMetrics(record);
    // 有效事件仍只有 e2/e4，TPS/TPOT 不变
    expect(s.tps).toBeCloseTo((150 + 20 / 0.3) / 2);
    expect(s.tpotMs).toBeCloseTo(500 / 50);
    // pureInferenceMs 累计全部 llm duration（500 + 0 = 500）
    expect(s.pureInferenceMs).toBe(500);
  });
});
