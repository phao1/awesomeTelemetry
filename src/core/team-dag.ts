/**
 * Task DAG derivation (add-agent-team-observability §5.5–5.6, design D6).
 *
 * 纯函数模块：只接收规范输入、输出规范类型，不读 DB、不发请求、不写文件。
 * 任务与依赖是版本化实体；当前 task 状态是生命周期事件的派生投影，源历史永不被
 * 覆盖（design D6）。校验只报告 anomaly，绝不改写源数据。
 *
 * 关键路径只在完整无环组件上计算；有环 / 缺时长 / 乱序时输出 anomaly，不伪造。
 */
import type {
  TeamAnomaly,
  TeamTask,
  TeamTaskDependency,
} from './trace-types.js';

/** task-DAG 校验发现的异常 kind 集合（闭合）。 */
export const DAG_ANOMALY_KINDS = [
  'missing_task',
  'self_dependency',
  'dependency_cycle',
  'missing_duration',
  'invalid_duration',
  'dependency_order_violation',
] as const;

export type DagAnomalyKind = (typeof DAG_ANOMALY_KINDS)[number];

function anomaly(
  kind: DagAnomalyKind,
  message: string,
  entityIds: string[],
  evidenceIds: string[],
  severity: 'info' | 'warning' = 'warning',
): TeamAnomaly {
  return { kind, dimension: 'tasks', severity, message, entityIds, evidenceIds };
}

// ── 动态依赖投影（design D6：versioned DAG edge） ────────────

/**
 * 动态依赖投影：返回在 `at` 时刻 active 的依赖边。
 * `at = null` 表示「当前」：只保留 `validTo === null` 的边。
 */
export function projectTaskDependencies(
  dependencies: readonly TeamTaskDependency[],
  at: string | null = null,
): TeamTaskDependency[] {
  if (at === null) {
    return dependencies.filter((dep) => dep.validTo === null);
  }
  return dependencies.filter((dep) => {
    if (dep.validFrom !== null && dep.validFrom > at) {
      return false;
    }
    if (dep.validTo !== null && dep.validTo <= at) {
      return false;
    }
    return true;
  });
}

// ── 稳定 level 赋值（Kahn 拓扑排序，level 0 = 无上游） ───────

export interface TaskLevelsResult {
  /** taskId → level（无上游 = 0）。环内节点不赋值。 */
  levels: ReadonlyMap<string, number>;
  anomalies: TeamAnomaly[];
  /** 环内（无法赋 level 的）task id。 */
  cyclicTaskIds: string[];
}

/**
 * 稳定 level 赋值：Kahn 拓扑排序，level = max(上游 level) + 1。
 * 缺节点 / 自环 / 环被报告为 anomaly；环内节点排除在 level 之外。
 * 确定性：每轮按 task id 升序出队，相同输入恒定输出。
 */
export function assignTaskLevels(
  tasks: readonly TeamTask[],
  dependencies: readonly TeamTaskDependency[],
): TaskLevelsResult {
  const taskIds = new Set(tasks.map((task) => task.id));
  const anomalies: TeamAnomaly[] = [];

  // 缺节点 + 自环
  const validDeps: TeamTaskDependency[] = [];
  for (const dep of dependencies) {
    if (!taskIds.has(dep.upstreamTaskId)) {
      anomalies.push(
        anomaly('missing_task', `dependency references unknown upstream task`, [dep.upstreamTaskId], dep.evidenceIds),
      );
      continue;
    }
    if (!taskIds.has(dep.downstreamTaskId)) {
      anomalies.push(
        anomaly('missing_task', `dependency references unknown downstream task`, [dep.downstreamTaskId], dep.evidenceIds),
      );
      continue;
    }
    if (dep.upstreamTaskId === dep.downstreamTaskId) {
      anomalies.push(
        anomaly('self_dependency', 'task depends on itself', [dep.upstreamTaskId], dep.evidenceIds),
      );
      continue;
    }
    validDeps.push(dep);
  }

  // 去重（同上游→下游重边只保留一条用于拓扑，重边在 topology 层已报告）
  const unique = new Set<string>();
  const edges: { up: string; down: string; evidenceIds: string[] }[] = [];
  for (const dep of validDeps) {
    const key = `${dep.upstreamTaskId}\u0000${dep.downstreamTaskId}`;
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);
    edges.push({ up: dep.upstreamTaskId, down: dep.downstreamTaskId, evidenceIds: dep.evidenceIds });
  }

  // 构建入度 + 邻接
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of taskIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    inDegree.set(edge.down, (inDegree.get(edge.down) ?? 0) + 1);
    adjacency.get(edge.up)!.push(edge.down);
  }

  // Kahn（确定性：按 id 排序）
  const levels = new Map<string, number>();
  const queue = [...taskIds].filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
  for (const root of queue) {
    levels.set(root, 0);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) ?? 0;
    const children = (adjacency.get(current) ?? []).slice().sort();
    for (const child of children) {
      const nextIn = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, nextIn);
      const nextLevel = currentLevel + 1;
      if ((levels.get(child) ?? -1) < nextLevel) {
        levels.set(child, nextLevel);
      }
      if (nextIn === 0) {
        queue.push(child);
      }
    }
  }

  // 环内节点
  const cyclicTaskIds = [...taskIds]
    .filter((id) => !levels.has(id))
    .sort();
  if (cyclicTaskIds.length > 0) {
    anomalies.push(
      anomaly('dependency_cycle', 'task dependency cycle detected', cyclicTaskIds, []),
    );
  }

  return { levels, anomalies, cyclicTaskIds };
}

// ── 关键路径（§5.6：只在完整无环组件上算） ───────────────────

export interface CriticalPathResult {
  available: boolean;
  /** 最长加权路径总时长（ms）；unavailable 时为 null。 */
  totalMs: number | null;
  /** 关键路径上的 task id（根 → 叶）。 */
  taskIds: string[];
  anomalies: TeamAnomaly[];
}

function durationMs(task: TeamTask): number | null {
  if (task.startedAt === null || task.completedAt === null) {
    return null;
  }
  const start = Date.parse(task.startedAt);
  const end = Date.parse(task.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return end - start;
}

/**
 * 关键路径：完整无环 Task DAG 上的最长加权路径（权重 = task active duration）。
 * 有环 / 缺时长 / 乱序时 available=false 并输出 anomaly，绝不伪造。
 * 乱序（startedAt > completedAt）产生负 duration，同样使结果不可用。
 */
export function computeCriticalPath(
  tasks: readonly TeamTask[],
  dependencies: readonly TeamTaskDependency[],
): CriticalPathResult {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const anomalies: TeamAnomaly[] = [];

  // 缺节点 / 自环
  const validDeps: { up: TeamTask; down: TeamTask; dep: TeamTaskDependency }[] = [];
  let hasStructuralAnomaly = false;
  for (const dep of dependencies) {
    const up = taskById.get(dep.upstreamTaskId);
    const down = taskById.get(dep.downstreamTaskId);
    if (!up || !down) {
      anomalies.push(
        anomaly('missing_task', 'dependency references unknown task', [dep.id], dep.evidenceIds),
      );
      hasStructuralAnomaly = true;
      continue;
    }
    if (up.id === down.id) {
      anomalies.push(
        anomaly('self_dependency', 'task depends on itself', [up.id], dep.evidenceIds),
      );
      hasStructuralAnomaly = true;
      continue;
    }
    validDeps.push({ up, down, dep });
  }

  // 环检测（复用拓扑思想：Kahn 未处理节点 = 环）
  const nodeSet = new Set(tasks.map((task) => task.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodeSet) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const { up, down } of validDeps) {
    inDegree.set(down.id, (inDegree.get(down.id) ?? 0) + 1);
    adjacency.get(up.id)!.push(down.id);
  }
  const order: string[] = [];
  const queue = [...nodeSet].filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const child of (adjacency.get(current) ?? []).slice().sort()) {
      const nextIn = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, nextIn);
      if (nextIn === 0) {
        queue.push(child);
      }
    }
  }
  if (order.length !== nodeSet.size) {
    const cyclic = [...nodeSet].filter((id) => !order.includes(id)).sort();
    anomalies.push(
      anomaly('dependency_cycle', 'task dependency cycle detected', cyclic, []),
    );
    return { available: false, totalMs: null, taskIds: [], anomalies };
  }

  // 时长完整性 + 乱序
  const durations = new Map<string, number>();
  let hasInvalidDuration = false;
  for (const task of tasks) {
    const duration = durationMs(task);
    if (duration === null) {
      anomalies.push(
        anomaly(
          'missing_duration',
          'task missing startedAt/completedAt duration',
          [task.id],
          task.evidenceIds,
        ),
      );
      hasInvalidDuration = true;
      continue;
    }
    if (duration < 0) {
      anomalies.push(
        anomaly(
          'invalid_duration',
          'task completedAt precedes startedAt',
          [task.id],
          task.evidenceIds,
        ),
      );
      hasInvalidDuration = true;
      continue;
    }
    durations.set(task.id, duration);
  }

  // 依赖顺序违规（upstream 完成晚于 downstream 开始）——报告但不必然阻止关键路径。
  for (const { up, down } of validDeps) {
    if (up.completedAt === null || down.startedAt === null) {
      continue;
    }
    if (up.completedAt > down.startedAt) {
      anomalies.push(
        anomaly(
          'dependency_order_violation',
          `task starts before required dependency completes`,
          [down.id, up.id],
          [],
          'info',
        ),
      );
    }
  }

  if (hasStructuralAnomaly || hasInvalidDuration) {
    return { available: false, totalMs: null, taskIds: [], anomalies };
  }

  // DP 最长路径（拓扑序，确定性）
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  let bestTask: string | null = null;
  let bestDist = -Infinity;
  for (const id of order) {

    const duration = durations.get(id)!;
    let maxUpstream = 0;
    let maxUpstreamId: string | null = null;
    for (const { up, down } of validDeps) {
      if (down.id !== id) {
        continue;
      }
      const upstreamDist = dist.get(up.id) ?? 0;
      if (upstreamDist > maxUpstream) {
        maxUpstream = upstreamDist;
        maxUpstreamId = up.id;
      }
    }
    const total = duration + maxUpstream;
    dist.set(id, total);
    prev.set(id, maxUpstreamId);
    if (total > bestDist) {
      bestDist = total;
      bestTask = id;
    }
  }

  // 回溯路径（根 → 叶）
  const path: string[] = [];
  let cursor: string | null = bestTask;
  while (cursor !== null) {
    path.push(cursor);
    cursor = prev.get(cursor) ?? null;
  }
  path.reverse();

  return { available: true, totalMs: bestTask === null ? 0 : bestDist, taskIds: path, anomalies };
}

// ── 综合校验（§5.5） ────────────────────────────────────────

export interface TaskDagResult {
  /** taskId → level（无上游 = 0）。 */
  levels: ReadonlyMap<string, number>;
  anomalies: TeamAnomaly[];
  /** 当前时间点的 active 依赖投影（validTo === null）。 */
  activeDependencies: TeamTaskDependency[];
  criticalPath: CriticalPathResult;
}

/**
 * 综合 task-DAG 校验：动态投影 → 稳定 level 赋值 → 关键路径。
 * 不改写任何源数据；所有发现以 anomaly 输出。
 */
export function validateTaskDag(
  tasks: readonly TeamTask[],
  dependencies: readonly TeamTaskDependency[],
): TaskDagResult {
  const activeDependencies = projectTaskDependencies(dependencies, null);
  const { levels, anomalies: levelAnomalies } = assignTaskLevels(tasks, activeDependencies);
  const criticalPath = computeCriticalPath(tasks, activeDependencies);
  // 合并 anomaly（level 异常 + 关键路径异常，去重：关键路径会重复报告部分异常）。
  const seen = new Set<string>();
  const anomalies: TeamAnomaly[] = [];
  for (const a of [...levelAnomalies, ...criticalPath.anomalies]) {
    const key = `${a.kind}\u0000${a.entityIds.join(',')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    anomalies.push(a);
  }
  return { levels, anomalies, activeDependencies, criticalPath };
}
