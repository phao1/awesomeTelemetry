/**
 * agent-collaboration-replay §2.1.3 / §3.6 — Agent 协作回放主组件。
 *
 * 编排数据拉取（getTeamRunBySessionKey → teamApi.runSnapshot +
 * teamApi.listActivities）并组合三个已实现子面板（TopologyGraph +
 * TaskReplayControls + AgentActivityPanel），实现章节显隐、loading、
 * 错误降级与 task 前进/后退切换。
 *
 * 数据流：
 * 1. sessionKey → getTeamRunBySessionKey → runIds
 * 2. runIds 为空数组 → 返回 null（章节隐藏，spec §5.1.1 规则 2）
 * 3. runIds 非空 → 选第一个 runId，并行 runSnapshot + listActivities
 * 4. snapshot + activities → 传给三个子组件
 * 5. 用户点击前进/后退/段 → 更新 taskCursor → 重新过滤 activities
 *
 * §3.6 串联层：
 * - `deriveAgentStates(snapshot.agents, currentActivities)` → 传给 TopologyGraph + AgentActivityPanel
 * - `countActivitiesPerTask(sortedTasks, activities)` → 传给 TaskReplayControls
 * - `onJump(index)` → setTaskCursor(index)
 * - `onSkipEmpty()` → 跳到下一个 taskActivityCounts[i] > 0 的 task
 * - `<AgentActivityPanel key={currentTaskId} ... />` 强制重挂，切换 task 时所有 <details> 回到折叠态
 *
 * 安全性（spec §4.3）：只使用 TeamRunSnapshot / TeamActivitySlim 的 slim 字段，
 * 不展示 raw / inputSummary / outputSummary / toolInput / toolOutput /
 * reasoning / message body / artifact body。本组件不直接读取这些字段，
 * 子面板已遵循 slim 策略。
 *
 * 无新 runtime dependency：纯 React + 复用已实现子面板。
 */

import '../styles/components/agent-collab.css';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { TeamActivitySlim, TeamRunSnapshot } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { getTeamRunBySessionKey } from '../api/team-run-by-session.js';
import { teamApi } from './team/team-client.js';
import { TopologyGraph } from './agent-collab/TopologyGraph.js';
import { TaskReplayControls } from './agent-collab/TaskReplayControls.js';
import { AgentActivityPanel } from './agent-collab/AgentActivityPanel.js';
const StageReplay = lazy(() => import('./agent-collab/StageReplay.js').then(module => ({ default: module.StageReplay })));
import { TeamWorkbench } from './team/TeamWorkbench.js';
import type { TeamSelection } from './team/team-client.js';
import {
  countActivitiesPerTask,
  deriveAgentStates,
} from './agent-collab/derive-states.js';
import { Skeleton, ErrorState } from './ui/States.js';

// ── Props ────────────────────────────────────────────────────

export interface AgentCollabReplayProps {
  sessionKey: string;
  locale: Locale;
}

// ── activities 翻页合并 ──────────────────────────────────────

/**
 * activities 一次性拉取（limit=500），hasMore 则翻页合并。
 * 最多 10 页 = 5000 条，避免无限循环。
 */
async function fetchAllActivities(runId: string): Promise<{ items: TeamActivitySlim[]; hasMore: boolean }> {
  const all: TeamActivitySlim[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 10;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const res = await teamApi.listActivities(runId, {
      limit: 500,
      cursor: cursor ?? undefined,
    });
    all.push(...res.items);
    if (!res.hasMore || res.nextCursor === null) {
      return { items: all, hasMore: res.hasMore };
    }
    cursor = res.nextCursor;
  }
  return { items: all, hasMore: true };
}

// ── task 排序：startedAt 升序，null 排最后 ───────────────────

function sortByStartedAtAsc<T extends { startedAt: string | null }>(a: T, b: T): number {
  if (a.startedAt === null && b.startedAt === null) return 0;
  if (a.startedAt === null) return 1;
  if (b.startedAt === null) return -1;
  return a.startedAt.localeCompare(b.startedAt);
}

// ── 组件 ─────────────────────────────────────────────────────

export function AgentCollabReplay({
  sessionKey,
  locale,
}: AgentCollabReplayProps): React.JSX.Element | null {
  const [runIds, setRunIds] = useState<string[] | null>(null);
  const [snapshot, setSnapshot] = useState<TeamRunSnapshot | null>(null);
  const [activities, setActivities] = useState<TeamActivitySlim[]>([]);
  const [taskCursor, setTaskCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityCoverage, setActivityCoverage] = useState<'complete' | 'partial' | 'unavailable'>('unavailable');
  const [selection, setSelection] = useState<TeamSelection | null>(null);
  const [retry, setRetry] = useState(0);

  // 1. session key → team run ids
  useEffect(() => {
    let cancelled = false;
    setRunIds(null);
    setSnapshotError(null);
    setActivityError(null);
    getTeamRunBySessionKey(sessionKey)
      .then((res) => {
        if (!cancelled) {
          // 防御非预期 JSON（fetch mock / 网络层可能返回不匹配的 body）：
          // runIds 不是数组 → 视为无关联，隐藏章节（spec §5.1.3 异常 1）
          const ids = res?.runIds;
          setRunIds(Array.isArray(ids) ? ids : []);
        }
      })
      .catch((err: unknown) => {
        // spec §5.1.3 异常 1：session→run 查询失败 → 隐藏章节（不弹错误）
        console.error('[agent-collab-replay] session→run 查询失败:', err);
        if (!cancelled) {
          setRunIds([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey, retry]);

  // 2. runIds[0] → snapshot + activities（并行，分别处理错误）
  const selectedRunId = runIds?.[0] ?? null;
  useEffect(() => {
    if (selectedRunId === null) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSnapshotError(null);
    setActivityError(null);
    setSnapshot(null);
    setActivities([]);
    setTaskCursor(0);
    setSelection(null);
    setActivityCoverage('unavailable');

    // 用 allSettled 区分 snapshot 错误与 activities 错误（spec §5.2.3 / §5.4.3）
    Promise.allSettled([
      teamApi.runSnapshot(selectedRunId),
      fetchAllActivities(selectedRunId),
    ])
      .then(([snapResult, actResult]) => {
        if (cancelled) {
          return;
        }
        if (snapResult.status === 'fulfilled') {
          setSnapshot(snapResult.value.snapshot);
        } else {
          const reason = snapResult.reason;
          setSnapshotError(reason instanceof Error ? reason.message : String(reason));
        }
        if (actResult.status === 'fulfilled') {
          setActivities(actResult.value.items);
          setActivityCoverage(actResult.value.hasMore ? 'partial' : 'complete');
        } else {
          const reason = actResult.reason;
          setActivityError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  // 3. 渲染分支
  // runIds === null → loading（session→run 查询中）
  if (runIds === null) {
    return (
      <div className="agent-collab-replay-loading" role="status" aria-live="polite">
        <Skeleton />
        <span className="agent-collab-replay-loading-text">
          {t('session.teamReplay.loading', locale)}
        </span>
      </div>
    );
  }

  // runIds 为空数组 → 章节隐藏（spec §5.1.1 规则 2）
  if (runIds.length === 0) {
    return null;
  }

  // snapshot 加载中且尚未拿到 snapshot → loading
  if (loading && snapshot === null && snapshotError === null) {
    return (
      <div className="agent-collab-replay-loading" role="status" aria-live="polite">
        <Skeleton />
        <span className="agent-collab-replay-loading-text">
          {t('session.teamReplay.loading', locale)}
        </span>
      </div>
    );
  }

  // snapshot 加载失败且无旧数据 → 错误提示 + 重试（spec §5.2.3 异常 1）
  if (snapshotError !== null && snapshot === null) {
    return (
      <ErrorState
        code="TEAM_PANEL_FAILED"
        message={snapshotError}
        onRetry={() => {
          // 重置 runIds 触发完整重新拉取
          setRunIds(null);
          setRetry(value => value + 1);
        }}
      />
    );
  }

  // snapshot 为 null 且无错误（理论上不会到这里，TS 收窄需要）
  if (snapshot === null) {
    return null;
  }

  // 4. 正常渲染（snapshot 已拿到）
  // 有序 tasks（按 startedAt 升序，null 排最后）
  const sortedTasks = [...snapshot.tasks].sort(sortByStartedAtAsc);

  // 防御性 cursor：避免 taskCursor 超出 sortedTasks 范围
  const safeCursor =
    sortedTasks.length === 0 ? 0 : Math.min(taskCursor, sortedTasks.length - 1);
  const currentTask = sortedTasks[safeCursor] ?? null;
  const currentTaskId = currentTask?.id ?? null;

  // 当前 task 的 activities（按 taskId 过滤）
  const currentActivities =
    currentTaskId === null ? [] : activities.filter((a) => a.taskId === currentTaskId);

  // 活跃 agent ids（当前 task 期间有活动的 agent）
  const activeAgentIds = new Set<string>();
  for (const activity of currentActivities) {
    if (activity.agentId !== null) {
      activeAgentIds.add(activity.agentId);
    }
  }

  // §3.6 串联：agentStates（TopologyGraph + AgentActivityPanel 共用同一份）
  const agentStates = deriveAgentStates(snapshot.agents, currentActivities);

  // §3.6 串联：taskActivityCounts（TaskReplayControls 分段进度条 + 跳过空 task）
  const taskActivityCounts = countActivitiesPerTask(sortedTasks, activities);

  // 边消息计数：TeamActivitySlim 不含 from/to agent 信息，暂为空 Map。
  // 后续若需展示边消息计数，可从 TeamCommunication 单独拉取。
  const edgeMessageCounts = new Map<string, number>();

  // §3.6 onSkipEmpty：跳到下一个 taskActivityCounts[i] > 0 的 task
  const handleSkipEmpty = () => {
    for (let i = safeCursor + 1; i < sortedTasks.length; i += 1) {
      if (taskActivityCounts[i]! > 0) {
        setTaskCursor(i);
        return;
      }
    }
    // 向前找
    for (let i = safeCursor - 1; i >= 0; i -= 1) {
      if (taskActivityCounts[i]! > 0) {
        setTaskCursor(i);
        return;
      }
    }
    // 全部为空 → 保持原位
  };

  return (
    <div className="agent-collab-replay">
      <Suspense fallback={<Skeleton />}><StageReplay snapshot={snapshot} activities={activities} coverage={activityCoverage} onSelect={setSelection} locale={locale} /></Suspense>
      <details className="collab-secondary"><summary>{locale === 'zh' ? '当前快照 · 成员与任务概览' : 'Current snapshot · members and tasks'}</summary>
      <TeamWorkbench snapshot={snapshot} activities={activities} activityCoverage={activityCoverage}
        selection={selection} onSelect={next => {
          setSelection(next);
          if (next?.kind === 'task') {
            const index = sortedTasks.findIndex(task => task.id === next.id);
            if (index >= 0) setTaskCursor(index);
          }
        }} locale={locale} />
      </details>
      <details className="collab-secondary">
      <summary>{locale === 'zh' ? '关系图 · 辅助查看结构' : 'Relationship graph · structural reference'}</summary>
      <TopologyGraph
        agents={snapshot.agents}
        edges={snapshot.agentEdges}
        activeAgentIds={activeAgentIds}
        agentStates={agentStates}
        selectedAgentId={selection?.kind === 'agent' ? selection.id : null}
        onSelectAgent={id => setSelection(id === null ? null : { kind: 'agent', id })}
        edgeMessageCounts={edgeMessageCounts}
        locale={locale}
      />
      </details>
      <details className="collab-secondary">
      <summary>{locale === 'zh' ? '逐任务执行回放 · 已加载活动' : 'Task-by-task replay · loaded activities'}</summary>
      <TaskReplayControls
        tasks={sortedTasks}
        cursor={safeCursor}
        totalActivities={currentActivities.length}
        taskActivityCounts={taskActivityCounts}
        onPrev={() => setTaskCursor((c) => Math.max(0, c - 1))}
        onNext={() =>
          setTaskCursor((c) => Math.min(Math.max(0, sortedTasks.length - 1), c + 1))
        }
        onJump={index => { setTaskCursor(index); const task = sortedTasks[index]; if (task) setSelection({ kind: 'task', id: task.id }); }}
        onSkipEmpty={handleSkipEmpty}
        locale={locale}
      />
      {activityError !== null ? (
        <ErrorState
          code="TEAM_ACTIVITY_FAILED"
          message={activityError}
          onRetry={() => {
            // 重置 runIds 触发完整重新拉取
            setRunIds(null);
            setRetry(value => value + 1);
          }}
        />
      ) : (
        // §3.6 key={currentTaskId} 强制重挂：切换 task 时所有 <details> 回到默认折叠态
        <AgentActivityPanel
          key={currentTaskId ?? 'no-task'}
          agents={snapshot.agents}
          activities={currentActivities}
          agentStates={agentStates}
          locale={locale}
        />
      )}
      </details>
    </div>
  );
}
