/**
 * add-agent-team-observability §8.2 / §8.5 / §8.13 / §8.14 —
 * TaskDagView 测试。
 *
 * 覆盖：
 * - §8.2 task-DAG：Kahn level 排列、依赖箭头、owner 投影、critical path
 * - §8.5 cycle 降级为扁平列表（no silent graph repair）
 * - §8.13 无障碍：list/listitem role、aria-selected、键盘
 * - §8.14 focus-visible、无 color-only meaning（状态 dot + 文字 label）
 * - §8.12 跨视图高亮
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  TeamAgent,

  TeamAssignment,
  TeamMetrics,
  TeamMetricValue,
  TeamRunSnapshot,
  TeamRunSummary,
  TeamTask,
  TeamTaskDependency,
} from '../../core/trace-types.js';
import { TaskDagView, projectTaskDag, type TaskDagViewProps } from './TaskDagView.js';
import type { TeamSelection } from './team-client.js';

// ── mock data helpers（精简版，仅 task DAG 所需） ────────────

const FULL_COMPLETENESS: Record<EvidenceDimension, CompletenessLevel> = {
  topology: 'complete', tasks: 'complete', communication: 'partial',
  timing: 'complete', tools: 'complete', outputs: 'complete',
  tokens: 'complete', cost: 'unavailable', verification: 'partial',
};

function makeRun(id: string): TeamRunSummary {
  return {
    id, provider: 'codex', nativeRunId: `n-${id}`, runIdentityConfidence: 'native',
    title: `run ${id}`, goalFingerprint: null, status: 'success',
    startedAt: null, endedAt: null, topologyKind: 'two_level',
    counts: { agents: 1, tasks: 2, communications: 0, activities: 0, rounds: 0, artifacts: 0 },
    tokenAvailable: true, costAvailable: false, costCurrency: null,
    completeness: FULL_COMPLETENESS, updatedAt: new Date().toISOString(), stamp: 's',
  };
}

function makeAgent(id: string, runId: string): TeamAgent {
  return {
    id, runId, nativeId: `n-${id}`, displayName: `Agent ${id}`,
    role: 'team-mate', roleClass: 'teammate', model: null, state: 'completed',
    createdAt: null, endedAt: null, sessionKeys: [], evidenceIds: [],
  };
}

function makeTask(id: string, runId: string, over: Partial<TeamTask> = {}): TeamTask {
  return {
    id, runId, nativeId: `n-${id}`, title: `Task ${id}`,
    descriptionAvailable: false, priority: 1, status: 'completed',
    createdAt: null, startedAt: null, completedAt: null, cancelledAt: null, failedAt: null,
    resultAvailable: false, evidenceIds: [], ...over,
  };
}

function makeDep(id: string, runId: string, upstream: string, downstream: string): TeamTaskDependency {
  return {
    id, runId, upstreamTaskId: upstream, downstreamTaskId: downstream,
    validFrom: null, validTo: null, confidence: 'native', evidenceIds: [],
  };
}

function makeAssignment(id: string, runId: string, taskId: string, agentId: string): TeamAssignment {
  return {
    id, runId, taskId, agentId, assignedAt: null, unassignedAt: null,
    assignmentKind: 'assigned', evidenceIds: [],
  };
}

function makeMetricValue(): TeamMetricValue {
  return { value: null, available: false, complete: false, criteria: '', evidenceIds: [], numerator: null, denominator: null };
}

function makeMetrics(): TeamMetrics {
  const v = makeMetricValue();
  return {
    calcVersion: 1, generatedAt: new Date().toISOString(),
    scheduling: { wallClockMs: v, agentActiveMs: v, totalWorkMs: v, observedWaitMs: v, maxConcurrency: v, avgConcurrency: v, serialWorkEstimateMs: v, observedSpeedup: v, peakCapacityUtilization: v, criticalPathMs: v, delegationDelayMs: v, handoffLatencyMs: v },
    quality: { taskCompletion: v, verificationCoverage: v, acceptanceCoverage: v, reviewRework: v, acceptedArtifactRate: v },
    stability: { failures: v, retries: v, replacements: v, recoveryLatencyMs: v, blockedOrphanTimeMs: v, unresolvedErrors: v, dagAnomalies: v, incompleteTerminalStates: v },
    cost: { totalInputTokens: v, totalOutputTokens: v, totalReasoningTokens: v, totalCacheReadTokens: v, totalCacheWriteTokens: v, totalCostUsd: v, costCurrency: null, coordinationTokens: v, costGini: v },
    collaboration: { directRatio: v, leaderMediatedRatio: v, responseLatencyMedianMs: v, responseLatencyP95Ms: v, taskBalanceGini: v, leaderWorkConcentration: v, criticalAgentConcentration: v, crossAgentReview: v, duplicateWorkSignal: v },
  };
}

function makeSnapshot(
  runId: string,
  over: {
    tasks?: TeamTask[];
    taskDependencies?: TeamTaskDependency[];
    assignments?: TeamAssignment[];
    agents?: TeamAgent[];
  } = {},
): TeamRunSnapshot {
  return {
    summary: makeRun(runId),
    agents: over.agents ?? [makeAgent('a-1', runId)],
    agentEdges: [],
    tasks: over.tasks ?? [makeTask('t-1', runId), makeTask('t-2', runId)],
    taskDependencies: over.taskDependencies ?? [makeDep('d-1', runId, 't-1', 't-2')],
    assignments: over.assignments ?? [],
    artifacts: [],
    completeness: FULL_COMPLETENESS,
    anomalies: [],
    metrics: makeMetrics(),
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<TaskDagViewProps> = {}): TaskDagViewProps {
  return {
    snapshot: makeSnapshot('r-1'),
    selection: null,
    onSelect: () => undefined,
    locale: 'zh',
    ...over,
  };
}

afterEach(() => { document.body.innerHTML = ''; });

// ═══════════════════════════════════════════════════════════════════════════
// §8.2 Kahn level 排列
// ═══════════════════════════════════════════════════════════════════════════

describe('projectTaskDag §8.2 Kahn level', () => {
  it('线性依赖：t1 → t2 → t3 三层', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1'), makeTask('t3', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 't2'), makeDep('d2', 'r-1', 't2', 't3')],
    });
    const p = projectTaskDag(snap);
    expect(p.renderMode).toBe('dag');
    expect(p.levels).toEqual([['t1'], ['t2'], ['t3']]);
    expect(p.degradeReason).toBeNull();
  });

  it('菱形依赖：t1 → {t2, t3} → t4', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1'), makeTask('t3', 'r-1'), makeTask('t4', 'r-1')],
      taskDependencies: [
        makeDep('d1', 'r-1', 't1', 't2'), makeDep('d2', 'r-1', 't1', 't3'),
        makeDep('d3', 'r-1', 't2', 't4'), makeDep('d4', 'r-1', 't3', 't4'),
      ],
    });
    const p = projectTaskDag(snap);
    expect(p.renderMode).toBe('dag');
    expect(p.levels[0]).toEqual(['t1']);
    expect(p.levels[1]).toContain('t2');
    expect(p.levels[1]).toContain('t3');
    expect(p.levels[2]).toEqual(['t4']);
  });

  it('无依赖：全部在 level 0', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [],
    });
    const p = projectTaskDag(snap);
    expect(p.levels).toEqual([['t1', 't2']]);
  });

  it('§8.5 cycle 检测：降级 flat + reason', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 't2'), makeDep('d2', 'r-1', 't2', 't1')],
    });
    const p = projectTaskDag(snap);
    expect(p.renderMode).toBe('flat');
    expect(p.degradeReason).toContain('cycle');
    expect(p.degradeReason).toContain('t1');
    expect(p.degradeReason).toContain('t2');
  });

  it('validTo 非空的边不参与 DAG', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [
        { ...makeDep('d1', 'r-1', 't1', 't2'), validTo: '2025-01-01T00:00:00Z' },
      ],
    });
    const p = projectTaskDag(snap);
    expect(p.activeDeps).toHaveLength(0);
    expect(p.levels).toEqual([['t1', 't2']]);
  });

  it('两端 task 不存在的边被过滤', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 'ghost'), makeDep('d2', 'r-1', 'ghost', 't1')],
    });
    const p = projectTaskDag(snap);
    expect(p.activeDeps).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.2 渲染
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskDagView §8.2 渲染', () => {
  it('empty 态：无 task 渲染 EmptyState', () => {
    const snap = makeSnapshot('r-1', { tasks: [], taskDependencies: [] });
    const container = render(<TaskDagView {...baseProps({ snapshot: snap })} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('无任务');
  });

  it('dag 渲染分层 level group', () => {
    const container = render(<TaskDagView {...baseProps()} />);
    expect(container.querySelector('.team-taskdag-view-dag')).not.toBeNull();
    expect(container.querySelectorAll('.team-taskdag-level').length).toBeGreaterThan(0);
  });

  it('cycle 渲染 flat + degrade alert', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 't2'), makeDep('d2', 'r-1', 't2', 't1')],
    });
    const container = render(<TaskDagView {...baseProps({ snapshot: snap })} />);
    expect(container.querySelector('.team-taskdag-flat')).not.toBeNull();
    const degrade = container.querySelector('.team-taskdag-degrade');
    expect(degrade?.getAttribute('role')).toBe('alert');
  });

  it('task 节点显示 title + status label + owner + deps count', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 't2')],
      assignments: [makeAssignment('a1', 'r-1', 't2', 'a-1')],
      agents: [makeAgent('a-1', 'r-1')],
    });
    const container = render(<TaskDagView {...baseProps({ snapshot: snap })} />);
    const nodes = container.querySelectorAll('.team-task-node');
    expect(nodes).toHaveLength(2);
    const t2Node = [...nodes].find((n) => n.querySelector('.team-task-node-title')?.textContent === 'Task t2');
    expect(t2Node).not.toBeUndefined();
    expect(t2Node?.querySelector('.team-task-node-status')?.textContent).toBe('已完成');
    expect(t2Node?.querySelector('.team-task-node-owner')?.textContent).toContain('Agent a-1');
    expect(t2Node?.querySelector('.team-task-node-deps')?.textContent).toContain('↑1');
  });

  it('critical path 高亮（仅当传入 criticalTaskIds）', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 't2')],
    });
    const container = render(
      <TaskDagView {...baseProps({ snapshot: snap, criticalTaskIds: new Set(['t1']) })} />,
    );
    const criticalNode = container.querySelector('.team-task-node-critical');
    expect(criticalNode).not.toBeNull();
    expect(criticalNode?.querySelector('.team-task-node-critical-badge')?.textContent).toBe('关键路径');
  });

  it('不传 criticalTaskIds 时不高亮（绝不自行计算/伪造）', () => {
    const container = render(<TaskDagView {...baseProps()} />);
    expect(container.querySelector('.team-task-node-critical')).toBeNull();
  });

  it('状态 dot + 文字 label（无 color-only meaning）', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1', { status: 'running' })],
      taskDependencies: [],
    });
    const container = render(<TaskDagView {...baseProps({ snapshot: snap })} />);
    const node = container.querySelector('.team-task-node');
    expect(node?.querySelector('.team-task-status-dot.team-task-status-running')).not.toBeNull();
    expect(node?.querySelector('.team-task-node-status')?.textContent).toBe('运行中');
  });

  it('依赖列表显示 upstream → downstream', () => {
    const container = render(<TaskDagView {...baseProps()} />);
    const dep = container.querySelector('.team-taskdag-dep');
    expect(dep).not.toBeNull();
    expect(dep?.querySelector('.team-taskdag-dep-upstream')?.textContent).toBe('Task t-1');
    expect(dep?.querySelector('.team-taskdag-dep-arrow')?.textContent).toBe('→');
    expect(dep?.querySelector('.team-taskdag-dep-downstream')?.textContent).toBe('Task t-2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.12 跨视图高亮
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskDagView §8.12 跨视图高亮', () => {
  it('selection=task 高亮对应节点', () => {
    const selection: TeamSelection = { kind: 'task', id: 't-1' };
    const container = render(<TaskDagView {...baseProps({ selection })} />);
    const onNode = container.querySelector('.team-task-node-on');
    expect(onNode).not.toBeNull();
    expect(onNode?.getAttribute('aria-selected')).toBe('true');
  });

  it('点击 task 节点触发 onSelect（toggle）', () => {
    const calls: Array<TeamSelection | null> = [];
    const container = render(
      <TaskDagView {...baseProps({ onSelect: (sel) => calls.push(sel) })} />,
    );
    const node = container.querySelector('.team-task-node') as HTMLDivElement;
    act(() => { node.click(); });
    expect(calls).toEqual([{ kind: 'task', id: 't-1' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.14 无障碍
// ═══════════════════════════════════════════════════════════════════════════

describe('TaskDagView §8.14 无障碍', () => {
  it('list role + aria-label', () => {
    const container = render(<TaskDagView {...baseProps()} />);
    const view = container.querySelector('.team-taskdag-view');
    expect(view?.getAttribute('role')).toBe('list');
    expect(view?.getAttribute('aria-label')).toBe('任务 DAG');
  });

  it('listitem role + aria-selected + tabIndex', () => {
    const container = render(<TaskDagView {...baseProps()} />);
    const node = container.querySelector('.team-task-node');
    expect(node?.getAttribute('role')).toBe('listitem');
    expect(node?.getAttribute('aria-selected')).toBe('false');
    expect(node?.getAttribute('tabindex')).toBe('0');
  });

  it('键盘 Enter 触发选择', () => {
    const calls: Array<TeamSelection | null> = [];
    const container = render(
      <TaskDagView {...baseProps({ onSelect: (sel) => calls.push(sel) })} />,
    );
    const node = container.querySelector('.team-task-node') as HTMLDivElement;
    act(() => {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(calls).toEqual([{ kind: 'task', id: 't-1' }]);
  });

  it('键盘 Esc 取消选择（已选中时）', () => {
    const calls: Array<TeamSelection | null> = [];
    const selection: TeamSelection = { kind: 'task', id: 't-1' };
    const container = render(
      <TaskDagView {...baseProps({ selection, onSelect: (sel) => calls.push(sel) })} />,
    );
    const node = container.querySelector('.team-task-node-on') as HTMLDivElement;
    act(() => {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual([null]);
  });

  it('degrade banner role=alert', () => {
    const snap = makeSnapshot('r-1', {
      tasks: [makeTask('t1', 'r-1'), makeTask('t2', 'r-1')],
      taskDependencies: [makeDep('d1', 'r-1', 't1', 't2'), makeDep('d2', 'r-1', 't2', 't1')],
    });
    const container = render(<TaskDagView {...baseProps({ snapshot: snap })} />);
    expect(container.querySelector('.team-taskdag-degrade')?.getAttribute('role')).toBe('alert');
  });
});
