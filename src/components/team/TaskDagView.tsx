/**
 * add-agent-team-observability §8.2 / §8.5 / §8.13 / §8.14 —
 * TaskDagView：task-DAG 可视化组件。
 *
 * 从 `TeamRunSnapshot.tasks` + `taskDependencies` 渲染 DAG：
 * - **Kahn level 排列**：按入度分层，水平展开
 * - **状态 dot** 用 token 色（无 color-only meaning，配文字 label）
 * - **依赖箭头**：upstream → downstream
 * - **cycle 检测**：有环时降级为扁平列表 + 警示（no silent graph repair）
 * - **critical path**：当 server metadata 提供时高亮（不自行计算/伪造）
 * - **owners**：从 assignments 投影当前 owner
 *
 * **跨视图高亮**（§8.12）：选中 task 时节点高亮，纯 prop 传递，零请求。
 * **无障碍**（§8.14）：list/listitem role、aria-selected、键盘 Enter/Space/Esc、
 * focus-visible 轮廓、状态 dot + 文字 label（无 color-only meaning）。
 * **无新 runtime dependency**。
 *
 * **i18n**：新键在组件内局部双语映射（见 TopologyView 同样原因）。
 */

import { useCallback, useMemo } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamAssignment,
  TeamRunSnapshot,
  TeamTask,
  TeamTaskDependency,
  TeamTaskStatus,
} from '../../core/trace-types.js';
import { EmptyState } from '../ui/States.js';
import type { TeamSelection } from './team-client.js';

// ── 局部双语文字映射 ────────────────────────────────────────

const TT = {
  taskStatus: {
    pending: { zh: '待处理', en: 'pending' },
    ready: { zh: '就绪', en: 'ready' },
    claimed: { zh: '已认领', en: 'claimed' },
    running: { zh: '运行中', en: 'running' },
    blocked: { zh: '阻塞', en: 'blocked' },
    completed: { zh: '已完成', en: 'completed' },
    failed: { zh: '失败', en: 'failed' },
    cancelled: { zh: '已取消', en: 'cancelled' },
    unknown: { zh: '未知', en: 'unknown' },
  } as Record<TeamTaskStatus, { zh: string; en: string }>,
  level: { zh: '层级', en: 'Level' },
  deps: { zh: '依赖', en: 'dependencies' },
  owner: { zh: '负责人', en: 'owner' },
  noOwner: { zh: '未指派', en: 'unassigned' },
  criticalPath: { zh: '关键路径', en: 'critical path' },
  cycleWarning: { zh: '检测到依赖环，已降级为扁平列表', en: 'dependency cycle detected, degraded to flat list' },
  emptyDeps: { zh: '无依赖', en: 'no dependencies' },
} as const;

function tt(entry: { zh: string; en: string }, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en;
}

// ── §8.2 Kahn level 排列 ────────────────────────────────────

export interface TaskDagProjection {
  /** 按 level 分组的 task id（level 0 = 无依赖根）。 */
  levels: string[][];
  /** active 依赖边。 */
  activeDeps: TeamTaskDependency[];
  /** 渲染模式：dag（分层）或 flat（降级）。 */
  renderMode: 'dag' | 'flat';
  /** 降级原因（cycle）。null = 无降级。 */
  degradeReason: string | null;
}

/**
 * Kahn 算法分层。**绝不修复数据**（§8.2 no silent graph repair）：
 * 检测到 cycle 时返回 `degradeReason` 并降级为 flat，保留原始 deps。
 */
export function projectTaskDag(snapshot: TeamRunSnapshot): TaskDagProjection {
  const { tasks, taskDependencies } = snapshot;
  const taskIds = new Set(tasks.map((tk) => tk.id));

  // 仅 active 边 + 两端 task 存在
  const activeDeps = taskDependencies.filter(
    (d) => d.validTo === null && taskIds.has(d.upstreamTaskId) && taskIds.has(d.downstreamTaskId),
  );

  // 入度（downstream 视角）
  const inDegree = new Map<string, number>();
  for (const task of tasks) {
    inDegree.set(task.id, 0);
  }
  const adj = new Map<string, string[]>(); // upstream → downstreams
  for (const dep of activeDeps) {
    inDegree.set(dep.downstreamTaskId, (inDegree.get(dep.downstreamTaskId) ?? 0) + 1);
    const list = adj.get(dep.upstreamTaskId);
    if (list === undefined) {
      adj.set(dep.upstreamTaskId, [dep.downstreamTaskId]);
    } else {
      list.push(dep.downstreamTaskId);
    }
  }

  // Kahn
  const levels: string[][] = [];
  let queue: string[] = tasks.filter((tk) => (inDegree.get(tk.id) ?? 0) === 0).map((tk) => tk.id);
  const visited = new Set<string>();
  const remainingInDegree = new Map(inDegree);

  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      visited.add(id);
      for (const downstreamId of adj.get(id) ?? []) {
        const newDeg = (remainingInDegree.get(downstreamId) ?? 1) - 1;
        remainingInDegree.set(downstreamId, newDeg);
        if (newDeg === 0) {
          nextQueue.push(downstreamId);
        }
      }
    }
    queue = nextQueue;
  }

  // 检测 cycle：visited 数 < tasks 数 → 有环
  if (visited.size < tasks.length) {
    const cyclicTasks = tasks.filter((tk) => !visited.has(tk.id)).map((tk) => tk.id);
    return {
      levels: [tasks.map((tk) => tk.id)],
      activeDeps,
      renderMode: 'flat',
      degradeReason: `cycle: ${cyclicTasks.join(', ')}`,
    };
  }

  return { levels, activeDeps, renderMode: 'dag', degradeReason: null };
}

// ── owner 投影 ──────────────────────────────────────────────

/** 当前 owner（unassignedAt === null 的最新 assignment）。 */
function deriveOwnerMap(assignments: TeamAssignment[]): Map<string, string> {
  const owner = new Map<string, string>();
  // 按 assignedAt 排序，后赋值覆盖前（最新胜出）
  const sorted = [...assignments].sort((a, b) => {
    const ta = a.assignedAt ?? '';
    const tb = b.assignedAt ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  for (const a of sorted) {
    if (a.unassignedAt === null) {
      owner.set(a.taskId, a.agentId);
    }
  }
  return owner;
}

// ── 子组件：task 节点 ───────────────────────────────────────

function TaskNode({
  task,
  selected,
  ownerAgentName,
  upstreamCount,
  downstreamCount,
  isCritical,
  onSelect,
  locale,
  ariaPosInSet,
  ariaSetSize,
  ariaLevel,
}: {
  task: TeamTask;
  selected: boolean;
  ownerAgentName: string | null;
  upstreamCount: number;
  downstreamCount: number;
  isCritical: boolean;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
  ariaPosInSet: number;
  ariaSetSize: number;
  ariaLevel: number;
}): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(selected ? null : { kind: 'task', id: task.id });
  }, [selected, onSelect, task.id]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(selected ? null : { kind: 'task', id: task.id });
      } else if (event.key === 'Escape' && selected) {
        event.preventDefault();
        onSelect(null);
      }
    },
    [selected, onSelect, task.id],
  );
  const statusLabel = tt(TT.taskStatus[task.status], locale);
  const ownerLabel = ownerAgentName ?? tt(TT.noOwner, locale);
  return (
    <div
      className={`team-task-node ${selected ? 'team-task-node-on' : ''} ${isCritical ? 'team-task-node-critical' : ''}`}
      role="listitem"
      aria-selected={selected}
      aria-level={ariaLevel}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className={`team-task-status-dot team-task-status-${task.status}`} aria-hidden="true" />
      <span className="team-task-node-title">{task.title}</span>
      <span className="team-task-node-status">{statusLabel}</span>
      <span className="team-task-node-owner">
        {tt(TT.owner, locale)}: {ownerLabel}
      </span>
      <span className="team-task-node-deps" aria-label={tt(TT.deps, locale)}>
        ↑{upstreamCount} ↓{downstreamCount}
      </span>
      {isCritical && (
        <span className="team-task-node-critical-badge">{tt(TT.criticalPath, locale)}</span>
      )}
    </div>
  );
}

// ── TaskDagViewProps ────────────────────────────────────────

export interface TaskDagViewProps {
  snapshot: TeamRunSnapshot;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
  /**
   * 可选：server 计算的关键路径 task id 集合（design D15）。
   * 不传或空 = 不高亮关键路径（绝不自行计算/伪造）。
   */
  criticalTaskIds?: ReadonlySet<string> | null;
}

// ── TaskDagView ─────────────────────────────────────────────

export function TaskDagView({
  snapshot,
  selection,
  onSelect,
  locale,
  criticalTaskIds = null,
}: TaskDagViewProps): React.JSX.Element {
  const projection = useMemo(() => projectTaskDag(snapshot), [snapshot]);
  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((tk) => [tk.id, tk])),
    [snapshot.tasks],
  );
  const agentById = useMemo(
    () => new Map(snapshot.agents.map((a) => [a.id, a])),
    [snapshot.agents],
  );
  const ownerMap = useMemo(() => deriveOwnerMap(snapshot.assignments), [snapshot.assignments]);

  // upstream/downstream 计数
  const upstreamCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const dep of projection.activeDeps) {
      m.set(dep.downstreamTaskId, (m.get(dep.downstreamTaskId) ?? 0) + 1);
    }
    return m;
  }, [projection.activeDeps]);
  const downstreamCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const dep of projection.activeDeps) {
      m.set(dep.upstreamTaskId, (m.get(dep.upstreamTaskId) ?? 0) + 1);
    }
    return m;
  }, [projection.activeDeps]);

  if (snapshot.tasks.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.tasksEmpty', locale)}
        description={t('team.tasksEmptyHint', locale)}
      />
    );
  }

  const totalTasks = snapshot.tasks.length;
  let posInSet = 0;

  return (
    <div
      className={`team-taskdag-view team-taskdag-view-${projection.renderMode}`}
      role="list"
      aria-label={t('team.tasksLabel', locale)}
    >
      {projection.degradeReason !== null && (
        <div className="team-taskdag-degrade" role="alert">
          <span className="team-taskdag-degrade-icon" aria-hidden="true">⚠</span>
          <span className="team-taskdag-degrade-text">{tt(TT.cycleWarning, locale)}</span>
          <span className="team-taskdag-degrade-detail">{projection.degradeReason}</span>
        </div>
      )}

      {projection.renderMode === 'flat' ? (
        <div className="team-taskdag-flat">
          {snapshot.tasks.map((task) => {
            const selected = selection !== null && selection.kind === 'task' && selection.id === task.id;
            const ownerId = ownerMap.get(task.id);
            const ownerName = ownerId !== undefined ? (agentById.get(ownerId)?.displayName ?? ownerId) : null;
            const isCritical = criticalTaskIds?.has(task.id) ?? false;
            posInSet += 1;
            return (
              <TaskNode
                key={task.id}
                task={task}
                selected={selected}
                ownerAgentName={ownerName}
                upstreamCount={upstreamCount.get(task.id) ?? 0}
                downstreamCount={downstreamCount.get(task.id) ?? 0}
                isCritical={isCritical}
                onSelect={onSelect}
                locale={locale}
                ariaPosInSet={posInSet}
                ariaSetSize={totalTasks}
                ariaLevel={1}
              />
            );
          })}
        </div>
      ) : (
        <div className="team-taskdag-levels">
          {projection.levels.map((levelTasks, levelIdx) => (
            <div
              key={levelIdx}
              className={`team-taskdag-level team-taskdag-level-${levelIdx}`}
              role="group"
              aria-label={`${tt(TT.level, locale)} ${levelIdx}`}
            >
              <div className="team-taskdag-level-label">{`${tt(TT.level, locale)} ${levelIdx}`}</div>
              <div className="team-taskdag-level-nodes">
                {levelTasks.map((taskId) => {
                  const task = taskById.get(taskId);
                  if (task === undefined) return null;
                  const selected = selection !== null && selection.kind === 'task' && selection.id === taskId;
                  const ownerId = ownerMap.get(taskId);
                  const ownerName = ownerId !== undefined ? (agentById.get(ownerId)?.displayName ?? ownerId) : null;
                  const isCritical = criticalTaskIds?.has(taskId) ?? false;
                  posInSet += 1;
                  return (
                    <TaskNode
                      key={taskId}
                      task={task}
                      selected={selected}
                      ownerAgentName={ownerName}
                      upstreamCount={upstreamCount.get(taskId) ?? 0}
                      downstreamCount={downstreamCount.get(taskId) ?? 0}
                      isCritical={isCritical}
                      onSelect={onSelect}
                      locale={locale}
                      ariaPosInSet={posInSet}
                      ariaSetSize={totalTasks}
                      ariaLevel={levelIdx + 1}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {projection.activeDeps.length > 0 && (
        <div
          className="team-taskdag-deps"
          role="list"
          aria-label={tt(TT.deps, locale)}
        >
          <div className="team-taskdag-deps-title">{tt(TT.deps, locale)}</div>
          {projection.activeDeps.map((dep) => {
            const upstream = taskById.get(dep.upstreamTaskId);
            const downstream = taskById.get(dep.downstreamTaskId);
            const upstreamTitle = upstream?.title ?? dep.upstreamTaskId;
            const downstreamTitle = downstream?.title ?? dep.downstreamTaskId;
            return (
              <div
                key={dep.id}
                className="team-taskdag-dep"
                role="listitem"
                aria-label={`${upstreamTitle} → ${downstreamTitle}`}
              >
                <span className="team-taskdag-dep-upstream">{upstreamTitle}</span>
                <span className="team-taskdag-dep-arrow" aria-hidden="true">→</span>
                <span className="team-taskdag-dep-downstream">{downstreamTitle}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
