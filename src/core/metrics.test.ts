import { describe, expect, it } from 'vitest';

import type { TraceEvent, TraceRecord } from './trace-types.js';
import { cleanPromptText, computeMetrics, isGenuineUserPrompt } from './metrics.js';

function makeRecord(
  id: string,
  over: {
    eventStatuses?: Array<'success' | 'error'>;
    phases?: string[];
    toolDurations?: number[];
    costUsd?: number;
  } = {},
): TraceRecord {
  const phases = over.phases ?? ['implement'];
  const statuses = over.eventStatuses ?? ['success'];
  const events: TraceEvent[] = phases.map((phase, i) => ({
    id: `${id}-e${i}`,
    sessionId: id,
    sequence: i + 1,
    kind: (phase === 'verify' ? 'test' : 'tool') as TraceEvent['kind'],
    phase: phase as TraceEvent['phase'],
    title: `ev ${i}`,
    startedAt: `2026-08-01T00:00:0${i}.000Z`,
    durationMs: over.toolDurations?.[i] ?? 100,
    status: (statuses[i] ?? 'success') as TraceEvent['status'],
    actor: 'assistant',
    tool: 'Bash',
    tokens: { input: 10, output: 5, reasoning: 1, cacheRead: 0, cacheWrite: 0, total: 16 },
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
  }));
  return {
    session: {
      id,
      provider: 'codex',
      sourceAgent: 'Codex',
      title: `s ${id}`,
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:10.000Z',
      status: 'success',
      cwd: null,
      messageCount: 1,
      eventCount: events.length,
      tokenUsage: { input: 10 * events.length, output: 5 * events.length, reasoning: events.length, cacheRead: 0, cacheWrite: 0, total: 16 * events.length },
      costUsd: over.costUsd ?? 0.01,
      systemPrompt: null,
      dataSource: 'scan',
      sourcePath: `/tmp/${id}.jsonl`,
      totalDurationMs: 10_000,
      isSubagent: false,
    },
    events,
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
  };
}

describe('REQ-004 computeMetrics', () => {
  it('计算四维指标与基础指标', () => {
    const record = makeRecord('s1', {
      phases: ['implement', 'implement', 'verify'],
      eventStatuses: ['success', 'error', 'success'],
      toolDurations: [100, 200, 50],
      costUsd: 0.5,
    });
    const m = computeMetrics(record);
    expect(m.totalSteps).toBe(3);
    expect(m.durationByPhase.implement).toBe(300);
    expect(m.durationByPhase.verify).toBe(50);
    expect(m.toolCallCount).toBe(3);
    expect(m.verificationPresent).toBe(true);
    expect(m.verificationCoverage).toBe(1);
    expect(m.enteredDebug).toBe(false);
    expect(m.errorRate).toBeCloseTo(1 / 3);
    expect(m.avgToolDurationMs).toBeCloseTo(350 / 3);
    expect(m.tokensPerStep).toBeCloseTo(16);
    expect(m.costUsd).toBe(0.5);
    expect(m.calcVersion).toBe(1);
  });

  it('verificationCoverage 单会话为 0 或 1', () => {
    expect(computeMetrics(makeRecord('a', { phases: ['implement'] })).verificationCoverage).toBe(0);
    expect(computeMetrics(makeRecord('b', { phases: ['implement', 'verify'] })).verificationCoverage).toBe(1);
  });
});

describe('REQ-010 user_prompt 过滤', () => {
  it('过滤系统注入', () => {
    expect(isGenuineUserPrompt('fix the bug')).toBe(true);
    expect(isGenuineUserPrompt('<system-reminder>ignore previous</system-reminder>')).toBe(false);
  });
  it('清理标签', () => {
    expect(cleanPromptText('<user_query> optimize </user_query>')).toBe('optimize');
    expect(cleanPromptText('<system-reminder>meta</system-reminder>real')).toBe('real');
  });
});
