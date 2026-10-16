/**
 * agent-collaboration-replay §3.5 / §5.3 / §8.5 — 当前 task 的 agent 活动状态面板。
 *
 * 单列按 agent 分组聚合（spec §8.5.1，design §3.5）：
 * - 每个 agent 一个原生 `<details class="collab-activity-group">`，`<summary>` 为聚合行
 * - 聚合行：displayName + "N 条" + 状态序列摘要（如 created→busy→completed，>10 截断为前 9 + …）
 * - 无活动 agent：聚合行 "0 条 · 空闲"，不可展开
 * - 含 orderConfidence === 'ambiguous' activity → 聚合行末尾加 ⚠
 * - 展开明细：该 agent 在当前 task 期间的 activity 列表，按 startedAt 升序，每行 时间 · kind · status
 *
 * 展开/折叠交互（原生 `<details>`，无 React state，spec §8.5.1 规则 3-4）：
 * - 默认所有 `<details>` 不加 `open` 属性 → 聚合态
 * - 用户点击 `<summary>` → 浏览器原生切换 `open`
 * - 切换 task 时由 `AgentCollabReplay` 用 `key={currentTaskId}` 强制重挂（§2.6）
 *
 * agentStates 从内部 useMemo 推导改为入参（design §3.5.3），
 * 与 TopologyGraph 共用同一份状态，避免重复推导。
 */

import { useMemo } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamActivityKind,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentState,
} from '../../core/trace-types.js';
import { EmptyState } from '../ui/States.js';

// ── Props ────────────────────────────────────────────────────

export interface AgentActivityPanelProps {
  agents: TeamAgent[];
  /** 当前 task 的活动（已过滤）。 */
  activities: TeamActivitySlim[];
  /** agent → 最新状态（由主组件传入，避免重复推导，design §3.5.3）。 */
  agentStates: Map<string, TeamAgentState>;
  locale: Locale;
}

// ── i18n key 映射 ────────────────────────────────────────────

const ACTIVITY_KIND_KEYS: Record<TeamActivityKind, I18nKey> = {
  agent_lifecycle: 'session.teamReplay.activityKind.agent_lifecycle',
  task_created: 'session.teamReplay.activityKind.task_created',
  task_dependency: 'session.teamReplay.activityKind.task_dependency',
  task_assignment: 'session.teamReplay.activityKind.task_assignment',
  task_status: 'session.teamReplay.activityKind.task_status',
  round: 'session.teamReplay.activityKind.round',
  message_sent: 'session.teamReplay.activityKind.message_sent',
  message_received: 'session.teamReplay.activityKind.message_received',
  tool_call: 'session.teamReplay.activityKind.tool_call',
  tool_result: 'session.teamReplay.activityKind.tool_result',
  artifact: 'session.teamReplay.activityKind.artifact',
  verification: 'session.teamReplay.activityKind.verification',
  handoff: 'session.teamReplay.activityKind.handoff',
  error: 'session.teamReplay.activityKind.error',
  recovery: 'session.teamReplay.activityKind.recovery',
  integration: 'session.teamReplay.activityKind.integration',
  unknown: 'session.teamReplay.activityKind.unknown',
};

const AGENT_STATE_KEYS: Record<TeamAgentState, I18nKey> = {
  created: 'session.teamReplay.agentState.created',
  ready: 'session.teamReplay.agentState.ready',
  busy: 'session.teamReplay.agentState.busy',
  blocked: 'session.teamReplay.agentState.blocked',
  idle: 'session.teamReplay.agentState.idle',
  failed: 'session.teamReplay.agentState.failed',
  replaced: 'session.teamReplay.agentState.replaced',
  cancelled: 'session.teamReplay.agentState.cancelled',
  completed: 'session.teamReplay.agentState.completed',
  unknown: 'session.teamReplay.agentState.unknown',
};

// ── 排序：startedAt 升序，null 排最后 ───────────────────────

function sortByStartedAtAsc(a: TeamActivitySlim, b: TeamActivitySlim): number {
  if (a.startedAt === null && b.startedAt === null) return 0;
  if (a.startedAt === null) return 1;
  if (b.startedAt === null) return -1;
  return a.startedAt.localeCompare(b.startedAt);
}

// ── 状态序列摘要（design §3.5.2） ───────────────────────────

/** 状态序列最大长度，超过则截断为前 9 + …。 */
const MAX_STATE_SEQ = 10;

/**
 * 构造 agent 的状态序列摘要：按 startedAt 升序遍历该 agent 的 agent_lifecycle 活动，
 * 收集状态序列；超过 10 个状态时截断为前 9 + …（spec §8.5.3 异常 1）。
 */
export function buildStateSequence(
  agentActivities: readonly TeamActivitySlim[],
): string {
  // 仅 agent_lifecycle 活动贡献状态序列
  const lifecycleActs = agentActivities
    .filter((a) => a.kind === 'agent_lifecycle')
    .sort(sortByStartedAtAsc);
  if (lifecycleActs.length === 0) {
    return '';
  }
  const states = lifecycleActs.map((a) => mapTraceStatusToAgentState(a.status));
  if (states.length > MAX_STATE_SEQ) {
    return `${states.slice(0, MAX_STATE_SEQ - 1).join('→')}→…`;
  }
  return states.join('→');
}

// ── 组件 ─────────────────────────────────────────────────────

export function AgentActivityPanel({
  agents,
  activities,
  agentStates,
  locale,
}: AgentActivityPanelProps): React.JSX.Element {
  // 按 startedAt 升序排列
  const sortedActivities = useMemo(
    () => [...activities].sort(sortByStartedAtAsc),
    [activities],
  );

  // 按 agent 分组（保留 agents 顺序，无活动的 agent 也显示聚合行）
  const activitiesByAgent = useMemo(() => {
    const map = new Map<string, TeamActivitySlim[]>();
    for (const agent of agents) {
      map.set(agent.id, []);
    }
    for (const activity of sortedActivities) {
      if (activity.agentId === null) continue;
      const list = map.get(activity.agentId);
      if (list === undefined) {
        // 未在 agents 列表中的 agent（防御）：新建条目
        map.set(activity.agentId, [activity]);
      } else {
        list.push(activity);
      }
    }
    return map;
  }, [agents, sortedActivities]);

  // 空活动 → EmptyState（spec §5.5.1 规则 5）
  if (sortedActivities.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">∅</span>}
        title={t('session.teamReplay.emptyActivity', locale)}
      />
    );
  }

  return (
    <div
      className="collab-activity-panel"
      role="list"
      aria-label={t('session.teamReplay.agentActivity', locale)}
    >
      {agents.map((agent) => {
        const agentActs = activitiesByAgent.get(agent.id) ?? [];
        const count = agentActs.length;
        const hasAmbiguous = agentActs.some((a) => a.orderConfidence === 'ambiguous');
        const stateSeq = buildStateSequence(agentActs);
        const groupClassName = [
          'collab-activity-group',
          count === 0 ? 'collab-activity-group-empty' : '',
        ].filter(Boolean).join(' ');

        // 聚合行文本
        const countText = t('session.teamReplay.activityCountShort', locale).replace(
          '{count}',
          String(count),
        );
        const stateLabel = t(
          AGENT_STATE_KEYS[agentStates.get(agent.id) ?? 'unknown'] as never,
          locale,
        );

        return (
          <details key={agent.id} className={groupClassName} role="listitem">
            <summary>
              <span className="collab-activity-group-name">{agent.displayName}</span>
              <span className="collab-activity-group-count">{countText}</span>
              {count === 0 ? (
                <>
                  <span className="collab-replay-sep" aria-hidden="true">·</span>
                  <span className="collab-activity-group-summary">{stateLabel}</span>
                </>
              ) : (
                <>
                  <span className="collab-replay-sep" aria-hidden="true">·</span>
                  <span className="collab-activity-group-summary">{stateSeq}</span>
                  {hasAmbiguous && (
                    <span
                      className="collab-activity-ambiguous-mark"
                      title={t('team.ambiguousOrder', locale)}
                      aria-label={t('team.ambiguousOrder', locale)}
                    >
                      ⚠
                    </span>
                  )}
                </>
              )}
            </summary>
            {count > 0 && (
              <div className="collab-activity-detail-list" role="list">
                {agentActs.map((activity) => {
                  const kindLabel = t(ACTIVITY_KIND_KEYS[activity.kind] as never, locale);
                  const time = activity.startedAt ?? '';
                  const isAmbiguous = activity.orderConfidence === 'ambiguous';
                  const detailClassName = [
                    'collab-activity-detail',
                    `collab-activity-kind-${activity.kind}`,
                    isAmbiguous ? 'collab-activity-ambiguous' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div key={activity.id} className={detailClassName} role="listitem">
                      <span className="collab-activity-detail-time">{time}</span>
                      <span className="collab-replay-sep" aria-hidden="true">·</span>
                      <span className="collab-activity-detail-kind">{kindLabel}</span>
                      <span className="collab-replay-sep" aria-hidden="true">·</span>
                      <span className="collab-activity-detail-status">{activity.status}</span>
                      {isAmbiguous && (
                        <span
                          className="collab-activity-ambiguous-mark"
                          title={t('team.ambiguousOrder', locale)}
                          aria-label={t('team.ambiguousOrder', locale)}
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

/** TraceStatus → TeamAgentState 映射（agent_lifecycle 活动推导）。 */
function mapTraceStatusToAgentState(status: TeamActivitySlim['status']): TeamAgentState {
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
