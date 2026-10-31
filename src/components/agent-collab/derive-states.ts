/**
 * agent-collaboration-replay §3.5.3 / §3.6 — 状态推导纯函数。
 *
 * 从 `AgentActivityPanel` 内部 `useMemo` 抽出，提升到 `AgentCollabReplay` 主组件，
 * 因为 `TopologyGraph`（§3.1.5）也需同一份 `agentStates`，避免重复推导。
 *
 * 纯函数：相同输入 → 相同输出，无副作用，可独立单测。
 */

import type {
  TeamActivitySlim,
  TeamAgent,
  TeamAgentState,
  TeamTask,
} from '../../core/trace-types.js';

// ── TraceStatus → TeamAgentState 映射（agent_lifecycle 活动推导） ──

export function mapTraceStatusToAgentState(status: TeamActivitySlim['status']): TeamAgentState {
  switch (status) {
    case 'success':
      return 'completed';
    case 'running':
      return 'busy';
    case 'error':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'unknown':
    default:
      return 'unknown';
  }
}

// ── 排序：startedAt 升序，null 排最后 ───────────────────────

function sortByStartedAtAsc(a: TeamActivitySlim, b: TeamActivitySlim): number {
  if (a.startedAt === null && b.startedAt === null) return 0;
  if (a.startedAt === null) return 1;
  if (b.startedAt === null) return -1;
  return a.startedAt.localeCompare(b.startedAt);
}

// ── deriveAgentStates ────────────────────────────────────────

/**
 * 按 agent 推导最新状态（design §3.5.3）。
 *
 * 1. 初始化为 agent 自身的 `state` 字段
 * 2. 按 startedAt 升序遍历 `agent_lifecycle` 活动，后出现的覆盖先出现的
 * 3. 返回 `Map<agentId, TeamAgentState>`
 *
 * 纯函数，无副作用。
 */
export function deriveAgentStates(
  agents: readonly TeamAgent[],
  currentActivities: readonly TeamActivitySlim[],
): Map<string, TeamAgentState> {
  const states = new Map<string, TeamAgentState>();
  // 1. 初始化为 agent 自身的 state
  for (const agent of agents) {
    states.set(agent.id, agent.state);
  }
  // 2. 按 startedAt 升序遍历 agent_lifecycle 活动，后覆盖前
  const sorted = [...currentActivities].sort(sortByStartedAtAsc);
  for (const activity of sorted) {
    if (activity.kind === 'agent_lifecycle' && activity.agentId !== null) {
      const derived = mapTraceStatusToAgentState(activity.status);
      states.set(activity.agentId, derived);
    }
  }
  return states;
}

// ── countActivitiesPerTask ───────────────────────────────────

/**
 * 统计每个 task 的活动数（design §3.5.3）。
 *
 * 一次遍历 + Map 累加，O(activities.length)，避免 N×M。
 * 返回数组与 `sortedTasks` 顺序对齐：`result[i]` = `sortedTasks[i]` 的活动数。
 *
 * 纯函数，无副作用。
 */
export function countActivitiesPerTask(
  sortedTasks: readonly TeamTask[],
  activities: readonly TeamActivitySlim[],
): number[] {
  // 1. 一次遍历 activities，按 taskId 累加
  const countsByTaskId = new Map<string, number>();
  for (const activity of activities) {
    if (activity.taskId === null) continue;
    const cur = countsByTaskId.get(activity.taskId) ?? 0;
    countsByTaskId.set(activity.taskId, cur + 1);
  }
  // 2. 按 sortedTasks 顺序输出
  return sortedTasks.map((task) => countsByTaskId.get(task.id) ?? 0);
}
