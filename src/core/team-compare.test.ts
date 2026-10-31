import { describe, expect, it } from 'vitest';

import type { TeamComparisonBasis } from './trace-types.js';
import { compareTeams, buildComparisonDimensions, TEAM_MATERIALITY_THRESHOLD } from './team-compare.js';
import { computeTeamMetrics, TEAM_METRICS_CALC_VERSION } from './team-metrics.js';

const T0 = '2026-01-01T00:00:00.000Z';

function ms(offset: number): string {
  return new Date(Date.parse(T0) + offset).toISOString();
}

function makeInput(startedAt: string | null, endedAt: string | null) {
  return {
    runId: 'run1',
    runStatus: 'success' as const,
    startedAt,
    endedAt,
    costCurrency: 'USD' as const,
    agents: [],
    tasks: [],
    dependencies: [],
    assignments: [],
    activities: [],
    communications: [],
    artifacts: [],
    rounds: [],
    completeness: {
      topology: 'complete',
      tasks: 'complete',
      communication: 'complete',
      timing: 'complete',
      tools: 'complete',
      outputs: 'complete',
      tokens: 'complete',
      cost: 'complete',
      verification: 'complete',
    } as const,
  };
}

const basis: TeamComparisonBasis = {
  match: 'matched',
  goalMatch: true,
  criteriaMatch: true,
  projectMatch: true,
  revisionMatch: true,
  environmentMatch: true,
  modelMatch: true,
  templateMatch: true,
  completenessDelta: false,
  userDeclared: false,
  reasons: [],
};

describe('§5.15 calculation-version 与一致性', () => {
  it('同输入两次计算 → 深相等（full-ledger 与 persisted aggregate 一致）', () => {
    const input = makeInput(T0, ms(10_000));
    const first = computeTeamMetrics(input, T0);
    const second = computeTeamMetrics(input, T0);
    expect(second).toEqual(first);
  });

  it('metrics.calcVersion 绑定 TEAM_METRICS_CALC_VERSION', () => {
    const metrics = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    expect(metrics.calcVersion).toBe(TEAM_METRICS_CALC_VERSION);
  });

  it('比较输入直接引用持久化 aggregate（值不丢失）', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const dimensions = buildComparisonDimensions(left, right);
    const wallClock = dimensions[0]!.rows.find((row) => row.metricId === 'wallClockMs')!;
    expect(wallClock.left.value).toBe(10_000);
    expect(wallClock.right.value).toBe(5_000);
  });
});

describe('§6.7 维度行', () => {
  it('五维齐全且顺序确定', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const dimensions = buildComparisonDimensions(left, right);
    expect(dimensions.map((d) => d.dimension)).toEqual([
      'speed',
      'accuracy',
      'stability',
      'cost',
      'collaboration',
    ]);
  });

  it('delta = right − left；relativeDelta 仅 left 有限非零', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const dimensions = buildComparisonDimensions(left, right);
    const wallClock = dimensions[0]!.rows.find((row) => row.metricId === 'wallClockMs')!;
    expect(wallClock.delta).toBe(-5_000);
    expect(wallClock.relativeDelta).toBeCloseTo(-0.5);
    expect(wallClock.direction).toBe('lower_better');
    expect(wallClock.material).toBe(true);
  });

  it('left 为 0 时 relativeDelta 为 null（禁止 0/0 与 infinity）', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(0)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const dimensions = buildComparisonDimensions(left, right);
    const wallClock = dimensions[0]!.rows.find((row) => row.metricId === 'wallClockMs')!;
    expect(wallClock.relativeDelta).toBeNull();
    expect(wallClock.delta).toBe(10_000);
  });

  it('相对变化 < 阈值 → 非 material', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(10_500)), T0); // 5% 变化
    const dimensions = buildComparisonDimensions(left, right);
    const wallClock = dimensions[0]!.rows.find((row) => row.metricId === 'wallClockMs')!;
    expect(Math.abs(wallClock.relativeDelta!)).toBeLessThan(TEAM_MATERIALITY_THRESHOLD);
    expect(wallClock.material).toBe(false);
  });
});

describe('§6.8 确定性 verdicts', () => {
  it('无 winner / 无 score（契约禁止）', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const result = compareTeams({
      leftRunId: 'l',
      rightRunId: 'r',
      left,
      right,
      basis,
      generatedAt: T0,
    });
    expect(result).not.toHaveProperty('winner');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('verdict');
  });

  it('lower_better 且右更小 → strength；反向 → weakness', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const result = compareTeams({
      leftRunId: 'l',
      rightRunId: 'r',
      left,
      right,
      basis,
      generatedAt: T0,
    });
    expect(result.strengths.some((s) => s.startsWith('wallClockMs'))).toBe(true);
    expect(result.weaknesses.some((s) => s.startsWith('wallClockMs'))).toBe(false);
  });

  it('确定性：同输入两次 → 相同输出', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const args = { leftRunId: 'l', rightRunId: 'r', left, right, basis, generatedAt: T0 };
    expect(compareTeams(args)).toEqual(compareTeams(args));
  });

  it('unmatched basis 仍是成功响应，且保留 userDeclared 标记', () => {
    const left = computeTeamMetrics(makeInput(T0, ms(10_000)), T0);
    const right = computeTeamMetrics(makeInput(T0, ms(5_000)), T0);
    const unmatchedBasis: TeamComparisonBasis = {
      ...basis,
      match: 'unmatched',
      goalMatch: false,
      userDeclared: true,
      reasons: ['different goal'],
    };
    const result = compareTeams({
      leftRunId: 'l',
      rightRunId: 'r',
      left,
      right,
      basis: unmatchedBasis,
      generatedAt: T0,
    });
    expect(result.basis.match).toBe('unmatched');
    expect(result.basis.userDeclared).toBe(true);
    expect(result.basis.reasons).toContain('different goal');
    // 差异仍被保留，不被 userDeclared 抹除。
    expect(result.basis.goalMatch).toBe(false);
  });
});
