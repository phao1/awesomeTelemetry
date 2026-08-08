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
    // fix-adapter-turn-semantics 5.5：事件契约新增必填 turnKey（null 合法）。
    turnKey: null,
    kind: (phase === 'verify' ? 'test' : 'tool') as TraceEvent['kind'],
    phase: phase as TraceEvent['phase'],
    title: `ev ${i}`,
    startedAt: `2026-08-01T00:00:0${i}.000Z`,
    durationMs: over.toolDurations?.[i] ?? 100,
    status: (statuses[i] ?? 'success') as TraceEvent['status'],
    actor: 'assistant',
    tool: 'Bash',
    tokens: { input: 10, output: 5, reasoning: 1, cacheRead: 0, cacheWrite: 0, netInput: 10, total: 16 },
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
      tokenUsage: { input: 10 * events.length, output: 5 * events.length, reasoning: events.length, cacheRead: 0, cacheWrite: 0, netInput: 10 * events.length, total: 16 * events.length },
      costUsd: over.costUsd ?? 0.01,
      systemPrompt: null,
      dataSource: 'scan',
      sourcePath: `/tmp/${id}.jsonl`,
      totalDurationMs: 10_000,
      isSubagent: false,
    },
    events,
    tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
    // fix-adapter-turn-semantics A5：fixture 无边界信号，声明 unavailable。
    turnKeySource: 'unavailable',
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
    expect(m.calcVersion).toBe(4); // v4（calibrate-tokens §4）：TraceMetrics 五新字段
    expect(m.e2eMs).toBe(10_000);
  });

  it('v4 五个新字段：工具总耗时 / llm 调用数 / 用户轮次 / 单元测试 / 失败命令数', () => {
    const record = makeRecord('v4', { phases: ['implement'], eventStatuses: ['error'] });
    const evt = (
      id: string,
      sequence: number,
      kind: TraceEvent['kind'],
      status: TraceEvent['status'],
      over: Partial<TraceEvent> = {},
    ): TraceEvent => ({
      id,
      sessionId: 'v4',
      sequence,
      turnKey: null,
      kind,
      phase: kind === 'user_prompt' ? 'understand' : 'implement',
      title: 't',
      startedAt: `2026-08-01T00:00:0${sequence}.000Z`,
      durationMs: 0,
      status,
      actor: kind === 'user_prompt' ? 'user' : 'assistant',
      tool: null,
      tokens: null,
      error: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      inputSummary: null,
      outputSummary: null,
      ...over,
    });
    record.events = [
      evt('u1', 1, 'user_prompt', 'success', { title: 'run tests' }),
      evt('t1', 2, 'tool', 'success', { durationMs: 100, tool: 'Read' }),
      evt('t2', 3, 'file_read', 'success', { durationMs: 50, tool: 'Grep' }),
      evt('b1', 4, 'bash', 'success', {
        title: 'npm test',
        phase: 'verify',
        durationMs: 30,
        tool: 'Bash',
      }),
      evt('b2', 5, 'bash', 'error', { tool: 'Bash', error: 'exit 1' }),
      evt('e1', 6, 'llm', 'error', { error: 'model error' }), // llm 失败不计入 failedCommandCount
      evt('u2', 7, 'user_prompt', 'success', { title: 'again' }),
    ];
    const m = computeMetrics(record);
    expect(m.totalToolDurationMs).toBe(180); // 100 + 50 + 30（tool 事件）
    expect(m.llmCallCount).toBe(1);
    expect(m.userInteractionRounds).toBe(2);
    expect(m.hasUnitTests).toBe(true); // verify + npm test
    expect(m.failedCommandCount).toBe(1); // 只有 b2；llm error 不计

    const noTests = makeRecord('v4b', { phases: ['implement'] });
    noTests.events = [evt('b1', 1, 'bash', 'success', { title: 'npm test', phase: 'implement' })];
    expect(computeMetrics(noTests).hasUnitTests).toBe(false); // 非 verify 不算
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
      turnKey: null,
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
      title: 'q', turnKey: null, startedAt: '2026-08-01T00:00:02.000Z', durationMs: 0,
      status: 'error', actor: 'user', tool: null, tokens: null, error: 'x',
      hasInput: true, hasOutput: false, hasRaw: false, inputSummary: 'q', outputSummary: null,
    });
    const m = computeMetrics(record);
    expect(m.totalSteps).toBe(1);
    expect(m.errorRate).toBe(1); // 只有步骤错误计入分子分母
  });

  /**
   * fix-adapter-turn-semantics A8/5.9：compact 是基础设施，不是 agent 工作——
   * 从 avgToolDurationMs 与 errorRate（分子分母）显式排除。
   * 即使 compact 事件携带 tool 名与 error 状态，也不得计入（与 overview.ts 的
   * SQL 聚合路径同口径，consistency.test.ts REQ-011 锁定两路一致）。
   */
  it('compact 从 avgToolDurationMs 与 errorRate 中排除（即使带 tool 名和 error 状态）', () => {
    const record = makeRecord('s-compact', { phases: ['implement'], eventStatuses: ['success'] });
    record.events = [
      {
        id: 'c-tool', sessionId: 's-compact', sequence: 1, turnKey: 'c1',
        kind: 'tool', phase: 'understand', title: 'Read', startedAt: '2026-08-01T00:00:00.000Z',
        durationMs: 100, status: 'success', actor: 'assistant', tool: 'Read',
        tokens: null, error: null, hasInput: false, hasOutput: false, hasRaw: false,
        inputSummary: null, outputSummary: null,
      },
      {
        id: 'c-compact', sessionId: 's-compact', sequence: 2, turnKey: 'c1',
        kind: 'compact', phase: 'understand', title: 'context_compacted', startedAt: '2026-08-01T00:00:01.000Z',
        durationMs: 200, status: 'error', actor: 'system', tool: 'compact',
        tokens: null, error: null, hasInput: false, hasOutput: false, hasRaw: false,
        inputSummary: null, outputSummary: null,
      },
      {
        id: 'c-llm', sessionId: 's-compact', sequence: 3, turnKey: 'c1',
        kind: 'llm', phase: 'implement', title: 'reply', startedAt: '2026-08-01T00:00:02.000Z',
        durationMs: 0, status: 'success', actor: 'assistant', tool: null,
        tokens: null, error: null, hasInput: false, hasOutput: false, hasRaw: false,
        inputSummary: null, outputSummary: null,
      },
    ];
    const m = computeMetrics(record);
    expect(m.avgToolDurationMs).toBe(100); // compact 的 200ms 不计入
    expect(m.errorRate).toBe(0); // compact 的 error 状态不计入分子/分母
    expect(m.totalSteps).toBe(2); // tool + llm；compact 不是步骤
    expect(m.durationByPhase.understand).toBe(300); // 阶段耗时仍统计（口径只影响 avg/errorRate）
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
