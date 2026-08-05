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
    // #15：coverage = verify 事件数 / 步骤数 = 1/3
    expect(m.verificationCoverage).toBeCloseTo(1 / 3);
    expect(m.enteredDebug).toBe(false);
    // #14：errorRate 分母为步骤事件数（3 个都是步骤）＝ 1/3
    expect(m.errorRate).toBeCloseTo(1 / 3);
    expect(m.avgToolDurationMs).toBeCloseTo(350 / 3);
    expect(m.tokensPerStep).toBeCloseTo(16);
    expect(m.costUsd).toBe(0.5);
    expect(m.calcVersion).toBe(3); // v3（add-mission-control）：ttft/e2e 持久化
    expect(m.e2eMs).toBe(10_000);
  });

  it('#15 verificationCoverage 是 verify 事件数 / 步骤数比例', () => {
    expect(computeMetrics(makeRecord('a', { phases: ['implement'] })).verificationCoverage).toBe(0);
    expect(computeMetrics(makeRecord('b', { phases: ['implement', 'verify'] })).verificationCoverage).toBeCloseTo(0.5);
    expect(computeMetrics(makeRecord('c', { phases: ['verify', 'verify'] })).verificationCoverage).toBe(1);
  });

  it('v3 repairLoop：W-F-W-F-W 命中，W-F-W 不命中', () => {
    const evt = (
      id: string,
      sequence: number,
      kind: TraceEvent['kind'],
      status: TraceEvent['status'],
      tool: string | null,
    ): TraceEvent => ({
      id,
      sessionId: 'repair',
      sequence,
      kind,
      phase: 'implement',
      title: 't',
      startedAt: `2026-08-01T00:00:0${sequence}.000Z`,
      durationMs: 100,
      status,
      actor: 'assistant',
      tool,
      tokens: null,
      error: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      inputSummary: null,
      outputSummary: null,
    });
    const hit = makeRecord('repair-hit', {});
    hit.events = [
      evt('w1', 1, 'file_write', 'success', 'Write'),
      evt('f2', 2, 'bash', 'error', 'Bash'),
      evt('w3', 3, 'file_write', 'success', 'Write'),
      evt('f4', 4, 'test', 'error', 'Test'),
      evt('w5', 5, 'file_write', 'success', 'Write'),
    ];
    expect(computeMetrics(hit).repairLoop).toBe(true);
    const miss = makeRecord('repair-miss', {});
    miss.events = [
      evt('w1', 1, 'file_write', 'success', 'Write'),
      evt('f2', 2, 'bash', 'error', 'Bash'),
      evt('w3', 3, 'file_write', 'success', 'Write'),
    ];
    expect(computeMetrics(miss).repairLoop).toBe(false);
  });

  it('#14 errorRate 分母只算步骤事件，用户/消息事件不计入', () => {
    const record = makeRecord('s2', { phases: ['implement'], eventStatuses: ['error'] });
    record.events.push({
      id: 'user-err', sessionId: 's2', sequence: 2, kind: 'user_prompt', phase: 'understand',
      title: 'q', startedAt: '2026-08-01T00:00:02.000Z', durationMs: 0,
      status: 'error', actor: 'user', tool: null, tokens: null, error: 'x',
      hasInput: true, hasOutput: false, hasRaw: false, inputSummary: 'q', outputSummary: null,
    });
    const m = computeMetrics(record);
    expect(m.totalSteps).toBe(1);
    expect(m.errorRate).toBe(1); // 只有步骤错误计入分子分母
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
