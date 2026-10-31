import { describe, expect, it } from 'vitest';

import type { TeamTask, TeamTaskDependency } from './trace-types.js';
import {
  assignTaskLevels,
  computeCriticalPath,
  projectTaskDependencies,
  validateTaskDag,
} from './team-dag.js';

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
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:10.000Z',
    cancelledAt: null,
    failedAt: null,
    resultAvailable: true,
    evidenceIds: [],
    ...overrides,
  };
}

function dep(
  id: string,
  upstreamTaskId: string,
  downstreamTaskId: string,
  overrides: Partial<TeamTaskDependency> = {},
): TeamTaskDependency {
  return {
    id,
    runId: 'run1',
    upstreamTaskId,
    downstreamTaskId,
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
    ...overrides,
  };
}

describe('§5.5 task-DAG 校验与 level 赋值', () => {
  it('稳定 level：链 A→B→C 得 level 0/1/2', () => {
    const { levels, anomalies } = assignTaskLevels(
      [task('a'), task('b'), task('c')],
      [dep('d1', 'a', 'b'), dep('d2', 'b', 'c')],
    );
    expect(levels.get('a')).toBe(0);
    expect(levels.get('b')).toBe(1);
    expect(levels.get('c')).toBe(2);
    expect(anomalies).toHaveLength(0);
  });

  it('稳定：相同输入恒定输出（两次一致）', () => {
    const tasks = [task('a'), task('b'), task('c')];
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'b', 'c')];
    const first = assignTaskLevels(tasks, deps);
    const second = assignTaskLevels(tasks, deps);
    expect([...second.levels.entries()]).toEqual([...first.levels.entries()]);
  });

  it('缺节点 anomaly', () => {
    const { anomalies } = assignTaskLevels([task('a')], [dep('d1', 'ghost', 'a')]);
    expect(anomalies.some((a) => a.kind === 'missing_task')).toBe(true);
  });

  it('自环 anomaly', () => {
    const { anomalies } = assignTaskLevels([task('a')], [dep('d1', 'a', 'a')]);
    expect(anomalies.some((a) => a.kind === 'self_dependency')).toBe(true);
  });

  it('环：环内节点不赋 level + anomaly', () => {
    const { levels, anomalies, cyclicTaskIds } = assignTaskLevels(
      [task('a'), task('b')],
      [dep('d1', 'a', 'b'), dep('d2', 'b', 'a')],
    );
    expect(anomalies.some((a) => a.kind === 'dependency_cycle')).toBe(true);
    expect(cyclicTaskIds).toContain('a');
    expect(levels.size).toBe(0);
  });

  it('动态依赖投影：validTo 过滤', () => {
    const deps = [
      dep('d1', 'a', 'b', { validFrom: '2026-01-01T00:00:00.000Z', validTo: null }),
      dep('d2', 'a', 'c', { validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-01-10T00:00:00.000Z' }),
    ];
    expect(projectTaskDependencies(deps, null).map((d) => d.id)).toEqual(['d1']);
    expect(projectTaskDependencies(deps, '2026-01-05T00:00:00.000Z').map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    expect(projectTaskDependencies(deps, '2026-01-15T00:00:00.000Z').map((d) => d.id)).toEqual(['d1']);
  });

  it('validateTaskDag 不改写源数据', () => {
    const tasks = [task('a'), task('b')];
    const deps = [dep('d1', 'a', 'b')];
    const before = JSON.stringify(tasks);
    validateTaskDag(tasks, deps);
    expect(JSON.stringify(tasks)).toBe(before);
  });
});

describe('§5.6 关键路径', () => {
  it('hand-computed DAG：B→C = 25s', () => {
    const tasks = [
      task('a', { startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:10.000Z' }),
      task('b', { startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:20.000Z' }),
      task('c', { startedAt: '2026-01-01T00:00:20.000Z', completedAt: '2026-01-01T00:00:25.000Z' }),
    ];
    const deps = [dep('d1', 'a', 'c'), dep('d2', 'b', 'c')];
    const result = computeCriticalPath(tasks, deps);
    expect(result.available).toBe(true);
    expect(result.totalMs).toBe(25_000);
    expect(result.taskIds).toEqual(['b', 'c']);
  });

  it('环 → unavailable + anomaly', () => {
    const result = computeCriticalPath(
      [task('a'), task('b')],
      [dep('d1', 'a', 'b'), dep('d2', 'b', 'a')],
    );
    expect(result.available).toBe(false);
    expect(result.totalMs).toBeNull();
    expect(result.anomalies.some((a) => a.kind === 'dependency_cycle')).toBe(true);
  });

  it('缺时长 → unavailable + anomaly', () => {
    const result = computeCriticalPath(
      [task('a'), task('b', { startedAt: null, completedAt: null })],
      [dep('d1', 'a', 'b')],
    );
    expect(result.available).toBe(false);
    expect(result.anomalies.some((a) => a.kind === 'missing_duration')).toBe(true);
  });

  it('乱序（completedAt < startedAt）→ unavailable + anomaly', () => {
    const result = computeCriticalPath(
      [task('a', { startedAt: '2026-01-01T00:00:10.000Z', completedAt: '2026-01-01T00:00:00.000Z' })],
      [],
    );
    expect(result.available).toBe(false);
    expect(result.anomalies.some((a) => a.kind === 'invalid_duration')).toBe(true);
  });
});
