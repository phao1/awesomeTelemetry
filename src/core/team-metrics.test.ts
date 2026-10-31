import { describe, expect, it } from 'vitest';

import type {
  TeamActivitySlim,
  TeamAgent,
  TeamArtifact,

  TeamCommunication,
  TeamCompleteness,
  TeamTask,
  TurnModel,
} from './trace-types.js';
import {
  computeTeamMetrics,
  mapAgentRounds,
  orderLedger,
  TEAM_METRICS_CALC_VERSION,
} from './team-metrics.js';

const T0 = '2026-01-01T00:00:00.000Z';

function ms(offset: number): string {
  return new Date(Date.parse(T0) + offset).toISOString();
}

function activity(id: string, overrides: Partial<TeamActivitySlim> = {}): TeamActivitySlim {
  return {
    id,
    runId: 'run1',
    agentId: null,
    taskId: null,
    roundId: null,
    kind: 'tool_call',
    status: 'success',
    startedAt: null,
    endedAt: null,
    nativeSequence: null,
    sessionKey: null,
    eventId: null,
    turnKey: null,
    messageId: null,
    artifactId: null,
    tokenUsage: null,
    costUsd: null,
    costSource: null,
    costCurrency: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    evidenceIds: [`ev-${id}`],
    orderConfidence: 'native',
    ...overrides,
  };
}

function agent(id: string, roleClass = 'teammate'): TeamAgent {
  return {
    id,
    runId: 'run1',
    nativeId: id,
    displayName: id,
    role: roleClass,
    roleClass,
    model: null,
    state: 'ready',
    createdAt: null,
    endedAt: null,
    sessionKeys: [],
    evidenceIds: [],
  };
}

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    runId: 'run1',
    nativeId: id,
    title: id,
    descriptionAvailable: false,
    priority: null,
    status: 'completed',
    createdAt: null,
    startedAt: ms(0),
    completedAt: ms(1000),
    cancelledAt: null,
    failedAt: null,
    resultAvailable: true,
    evidenceIds: [],
    ...overrides,
  };
}

function communication(id: string, overrides: Partial<TeamCommunication> = {}): TeamCommunication {
  return {
    id,
    runId: 'run1',
    senderAgentId: 'a',
    recipientAgentIds: ['b'],
    mode: 'direct',
    category: 'coordination',
    taskId: null,
    correlationId: null,
    replyToId: null,
    sentAt: ms(0),
    receivedAt: ms(100),
    bodyAvailable: false,
    bodyChars: null,
    bodyBytes: null,
    contentHash: null,
    evidenceIds: [],
    ...overrides,
  };
}

const COMPLETE: TeamCompleteness = {
  topology: 'complete',
  tasks: 'complete',
  communication: 'complete',
  timing: 'complete',
  tools: 'complete',
  outputs: 'complete',
  tokens: 'complete',
  cost: 'complete',
  verification: 'complete',
};

describe('§5.7 账本排序', () => {
  it('同源按 native sequence', () => {
    const ordered = orderLedger([
      activity('a2', { nativeSequence: 2 }),
      activity('a1', { nativeSequence: 1 }),
    ]);
    expect(ordered.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(ordered.every((a) => a.orderConfidence === 'native')).toBe(true);
  });

  it('跨源无共享序列 → 按 startedAt 且标记 ambiguous', () => {
    const resolve = (a: TeamActivitySlim) => ({
      sourceKey: a.id.startsWith('x') ? 'X' : 'Y',
      priority: 0,
    });
    const ordered = orderLedger(
      [
        activity('y1', { startedAt: ms(20) }),
        activity('x1', { startedAt: ms(10) }),
      ],
      resolve,
    );
    expect(ordered.map((a) => a.id)).toEqual(['x1', 'y1']);
    expect(ordered.every((a) => a.orderConfidence === 'ambiguous')).toBe(true);
  });

  it('source priority 与 id tie-break', () => {
    const resolve = (a: TeamActivitySlim) => ({
      sourceKey: a.id.startsWith('hi') ? 'hi' : 'lo',
      priority: a.id.startsWith('hi') ? 0 : 1,
    });
    const ordered = orderLedger(
      [activity('lo1'), activity('hi1')],
      resolve,
    );
    expect(ordered.map((a) => a.id)).toEqual(['hi1', 'lo1']);
  });
});

describe('§5.8 per-agent 轮次映射', () => {
  it('native round 优先级最高', () => {
    const rounds = mapAgentRounds({
      runId: 'run1',
      agents: [agent('a')],
      activities: [
        activity('a1', { agentId: 'a', roundId: 'r1', startedAt: ms(0), endedAt: ms(100) }),
        activity('a2', { agentId: 'a', roundId: 'r1', startedAt: ms(200), endedAt: ms(300) }),
      ],
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.segmentationSource).toBe('native_round');
    expect(rounds[0]!.index).toBe(1);
  });

  it('session turn 第二优先级', () => {
    const rounds = mapAgentRounds({
      runId: 'run1',
      agents: [agent('a')],
      activities: [
        activity('a1', { agentId: 'a', turnKey: 't1', startedAt: ms(0), endedAt: ms(100) }),
      ],
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.segmentationSource).toBe('session_turn');
  });

  it('turn_model 第三优先级', () => {
    const model: TurnModel = {
      turns: [],
      segmentationSource: 'turn_key',
      complete: true,
      omittedEventCount: 0,
    };
    const rounds = mapAgentRounds({
      runId: 'run1',
      agents: [agent('a')],
      activities: [
        activity('a1', { agentId: 'a', sessionKey: 's1', startedAt: ms(0), endedAt: ms(100) }),
      ],
      turnModels: new Map([['s1', model]]),
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.segmentationSource).toBe('turn_model');
  });

  it('无边界信号 → 不生成轮次（禁止时间/计数切分伪造）', () => {
    const rounds = mapAgentRounds({
      runId: 'run1',
      agents: [agent('a')],
      activities: [
        activity('a1', { agentId: 'a', startedAt: ms(0), endedAt: ms(100) }),
        activity('a2', { agentId: 'a', startedAt: ms(5000), endedAt: ms(5100) }),
      ],
    });
    expect(rounds).toHaveLength(0);
  });
});

describe('§5.9 时间聚合（hand-computed）', () => {
  const input = {
    runId: 'run1',
    runStatus: 'success' as const,
    startedAt: T0,
    endedAt: ms(10_000),
    costCurrency: 'USD' as const,
    agents: [agent('a', 'leader'), agent('b')],
    tasks: [],
    dependencies: [],
    assignments: [],
    activities: [
      activity('a1', { agentId: 'a', startedAt: ms(0), endedAt: ms(4000) }),
      activity('a2', { agentId: 'a', startedAt: ms(6000), endedAt: ms(8000) }),
      activity('b1', { agentId: 'b', startedAt: ms(2000), endedAt: ms(6000) }),
    ],
    communications: [],
    artifacts: [],
    rounds: [],
    completeness: COMPLETE,
  };

  it('wallClock / totalWork / concurrency', () => {
    const metrics = computeTeamMetrics(input, T0);
    expect(metrics.scheduling.wallClockMs.value).toBe(10_000);
    expect(metrics.scheduling.totalWorkMs.value).toBe(10_000);
    expect(metrics.scheduling.maxConcurrency.value).toBe(2);
    expect(metrics.scheduling.avgConcurrency.value).toBeCloseTo(1);
  });

  it('running team：wallClock unavailable', () => {
    const metrics = computeTeamMetrics({ ...input, endedAt: null }, T0);
    expect(metrics.scheduling.wallClockMs.value).toBeNull();
    expect(metrics.scheduling.wallClockMs.available).toBe(false);
  });
});

describe('§5.10/5.11 质量与成本', () => {
  it('taskCompletion = completed / terminal', () => {
    const metrics = computeTeamMetrics(
      {
        runId: 'run1',
        runStatus: 'success',
        startedAt: T0,
        endedAt: ms(1000),
        costCurrency: 'USD',
        agents: [agent('a')],
        tasks: [
          task('t1', { status: 'completed' }),
          task('t2', { status: 'failed' }),
          task('t3', { status: 'cancelled' }),
        ],
        dependencies: [],
        assignments: [],
        activities: [],
        communications: [],
        artifacts: [],
        rounds: [],
        completeness: COMPLETE,
      },
      T0,
    );
    expect(metrics.quality.taskCompletion.value).toBeCloseTo(1 / 3);
    expect(metrics.quality.taskCompletion.numerator).toBe(1);
    expect(metrics.quality.taskCompletion.denominator).toBe(3);
  });

  it('零分母 → unavailable（禁止 0 冒充）', () => {
    const metrics = computeTeamMetrics(
      {
        runId: 'run1',
        runStatus: 'success',
        startedAt: T0,
        endedAt: ms(1000),
        costCurrency: 'USD',
        agents: [agent('a')],
        tasks: [],
        dependencies: [],
        assignments: [],
        activities: [],
        communications: [],
        artifacts: [],
        rounds: [],
        completeness: COMPLETE,
      },
      T0,
    );
    expect(metrics.quality.taskCompletion.value).toBeNull();
    expect(metrics.quality.taskCompletion.available).toBe(false);
  });

  it('tokens-known / cost-unknown：token 有值，cost unavailable', () => {
    const completeness: TeamCompleteness = { ...COMPLETE, cost: 'unavailable' };
    const metrics = computeTeamMetrics(
      {
        runId: 'run1',
        runStatus: 'success',
        startedAt: T0,
        endedAt: ms(1000),
        costCurrency: null,
        agents: [agent('a')],
        tasks: [],
        dependencies: [],
        assignments: [],
        activities: [
          activity('a1', {
            tokenUsage: { input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2, netInput: 95, total: 165 },
            costUsd: null,
          }),
        ],
        communications: [],
        artifacts: [],
        rounds: [],
        completeness,
      },
      T0,
    );
    expect(metrics.cost.totalInputTokens.value).toBe(100);
    expect(metrics.cost.totalCostUsd.value).toBeNull();
    expect(metrics.cost.costCurrency).toBeNull();
  });
});

describe('§5.12 协作', () => {
  it('direct ratio', () => {
    const metrics = computeTeamMetrics(
      {
        runId: 'run1',
        runStatus: 'success',
        startedAt: T0,
        endedAt: ms(1000),
        costCurrency: 'USD',
        agents: [agent('a', 'leader'), agent('b')],
        tasks: [],
        dependencies: [],
        assignments: [],
        activities: [],
        communications: [
          communication('c1', { mode: 'direct' }),
          communication('c2', { mode: 'direct' }),
          communication('c3', { mode: 'leader_mediated' }),
          communication('c4', { mode: 'unknown' }),
        ],
        artifacts: [],
        rounds: [],
        completeness: COMPLETE,
      },
      T0,
    );
    expect(metrics.collaboration.directRatio.value).toBeCloseTo(2 / 3);
    expect(metrics.collaboration.leaderMediatedRatio.value).toBeCloseTo(1 / 3);
  });

  it('缺消息 → ratio unavailable', () => {
    const completeness: TeamCompleteness = { ...COMPLETE, communication: 'unavailable' };
    const metrics = computeTeamMetrics(
      {
        runId: 'run1',
        runStatus: 'success',
        startedAt: T0,
        endedAt: ms(1000),
        costCurrency: 'USD',
        agents: [agent('a')],
        tasks: [],
        dependencies: [],
        assignments: [],
        activities: [],
        communications: [],
        artifacts: [],
        rounds: [],
        completeness,
      },
      T0,
    );
    expect(metrics.collaboration.directRatio.value).toBeNull();
  });
});

describe('§5.13 统一信封', () => {
  it('每个指标都携带 availability/completeness/criteria/evidence', () => {
    const metrics = computeTeamMetrics(
      {
        runId: 'run1',
        runStatus: 'success',
        startedAt: T0,
        endedAt: ms(1000),
        costCurrency: 'USD',
        agents: [agent('a', 'leader'), agent('b')],
        tasks: [task('t1'), task('t2')],
        dependencies: [],
        assignments: [],
        activities: [],
        communications: [communication('c1')],
        artifacts: [{
          id: 'art1',
          runId: 'run1',
          nativeId: null,
          name: 'f',
          kind: 'file',
          pathRedacted: null,
          contentHash: null,
          producerAgentIds: ['a'],
          taskIds: ['t1'],
          createdAt: null,
          acceptedAt: null,
          hasContent: false,
          evidenceIds: [],
        } satisfies TeamArtifact],
        rounds: [],
        completeness: COMPLETE,
      },
      T0,
    );
    expect(metrics.calcVersion).toBe(TEAM_METRICS_CALC_VERSION);
    const all = [
      ...Object.values(metrics.scheduling),
      ...Object.values(metrics.quality),
      ...Object.values(metrics.stability),
      ...Object.values(metrics.cost).filter((v) => typeof v === 'object' && v !== null && 'available' in v),
      ...Object.values(metrics.collaboration),
    ] as const;
    for (const value of all) {
      expect(typeof value.available).toBe('boolean');
      expect(typeof value.complete).toBe('boolean');
      expect(typeof value.criteria).toBe('string');
      expect(Array.isArray(value.evidenceIds)).toBe(true);
    }
  });
});
