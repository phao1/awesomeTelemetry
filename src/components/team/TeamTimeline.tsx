/**
 * add-agent-team-observability §8.3 / §8.4 / §8.11 / §8.13 / §8.14 —
 * TeamTimeline：swimlane 时间线可视化组件。
 *
 * 每 agent 一条 lane，活动条按 startedAt/endedAt 在共享 wall-clock 上定位。
 * - **@tanstack/react-virtual 虚拟化 lane**（§8.4，复用既有 useVirtualList）
 * - **活动条**：按 kind 着色（token），最小宽度 point marker
 * - **ambiguous order 标记**（G12.4）：orderConfidence === 'ambiguous'
 * - **open ends**：endedAt === null 的活动条延伸到 now
 * - **unknown vs idle/blocked**：agent state 用文字 label 区分（无 color-only）
 * - **点击 → selection**（agent lane / activity）
 *
 * **跨视图高亮**（§8.12）：选中 agent 高亮 lane，选中 activity 高亮活动条。
 * **无障碍**（§8.14）：list/listitem role、aria-selected、aria-label 含时间、
 * 键盘 Enter/Space/Esc、focus-visible 轮廓。
 * **无新 runtime dependency**：复用既有 useVirtualList。
 *
 * **i18n**：新键在组件内局部双语映射。
 */

import { useCallback, useMemo } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamActivityKind,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentState,
  TeamRunSnapshot,
} from '../../core/trace-types.js';
import { useVirtualList } from '../../hooks/useVirtualList.js';
import { EmptyState } from '../ui/States.js';
import type { TeamSelection } from './team-client.js';

// ── 局部双语文字映射 ────────────────────────────────────────

const TT = {
  agentState: {
    created: { zh: '已创建', en: 'created' },
    ready: { zh: '就绪', en: 'ready' },
    busy: { zh: '忙碌', en: 'busy' },
    blocked: { zh: '阻塞', en: 'blocked' },
    idle: { zh: '空闲', en: 'idle' },
    failed: { zh: '失败', en: 'failed' },
    replaced: { zh: '已替换', en: 'replaced' },
    cancelled: { zh: '已取消', en: 'cancelled' },
    completed: { zh: '已完成', en: 'completed' },
    unknown: { zh: '未知', en: 'unknown' },
  } as Record<TeamAgentState, { zh: string; en: string }>,
  activityKind: {
    agent_lifecycle: { zh: 'Agent 生命周期', en: 'agent lifecycle' },
    task_created: { zh: '任务创建', en: 'task created' },
    task_dependency: { zh: '任务依赖', en: 'task dependency' },
    task_assignment: { zh: '任务指派', en: 'task assignment' },
    task_status: { zh: '任务状态', en: 'task status' },
    round: { zh: '轮次', en: 'round' },
    message_sent: { zh: '消息发送', en: 'message sent' },
    message_received: { zh: '消息接收', en: 'message received' },
    tool_call: { zh: '工具调用', en: 'tool call' },
    tool_result: { zh: '工具结果', en: 'tool result' },
    artifact: { zh: '产物', en: 'artifact' },
    verification: { zh: '验证', en: 'verification' },
    handoff: { zh: '交接', en: 'handoff' },
    error: { zh: '错误', en: 'error' },
    recovery: { zh: '恢复', en: 'recovery' },
    integration: { zh: '集成', en: 'integration' },
    unknown: { zh: '未知', en: 'unknown' },
  } as Record<TeamActivityKind, { zh: string; en: string }>,
  lane: { zh: '泳道', en: 'lane' },
  openEnd: { zh: '进行中', en: 'open-ended' },
  ambiguous: { zh: '顺序不确定', en: 'ambiguous order' },
  noActivities: { zh: '无活动', en: 'no activities' },
  concurrency: { zh: '并发', en: 'concurrency' },
  total: { zh: '总计', en: 'total' },
  omitted: { zh: '已省略', en: 'omitted' },
} as const;

function tt(entry: { zh: string; en: string }, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en;
}

// ── 时间归一化 ──────────────────────────────────────────────

/** 解析 ISO 时间为 ms epoch，null/非法返回 null。 */
function parseTime(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** 计算 wall-clock 范围 [min, max]。 */
function computeTimeRange(
  agents: TeamAgent[],
  activities: TeamActivitySlim[],
  now: number,
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const agent of agents) {
    const s = parseTime(agent.createdAt);
    const e = parseTime(agent.endedAt) ?? now;
    if (s !== null && s < min) min = s;
    if (e > max) max = e;
  }
  for (const act of activities) {
    const s = parseTime(act.startedAt);
    const e = parseTime(act.endedAt) ?? now;
    if (s !== null && s < min) min = s;
    if (e > max) max = e;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    // 兜底：空范围用 now 周围 1s
    return { min: now - 1000, max: now + 1000 };
  }
  return { min, max };
}

/** 将时间 ms 映射到 [0, 100] 百分比。 */
function timeToPercent(ms: number, min: number, max: number): number {
  if (max <= min) return 0;
  const p = ((ms - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, p));
}

// ── lane 数据结构 ───────────────────────────────────────────

export interface TimelineLane {
  agent: TeamAgent;
  activities: TeamActivitySlim[];
  /** 并发活动峰值（同时 active 的最大数）。 */
  peakConcurrency: number;
}

/** 按 agent 分组活动，计算并发峰值。 */
function buildLanes(
  agents: TeamAgent[],
  activities: TeamActivitySlim[],
  now: number,
): TimelineLane[] {
  return agents.map((agent) => {
    const laneActivities = activities.filter((a) => a.agentId === agent.id);
    // 计算并发峰值：扫描线
    const events: Array<{ time: number; delta: number }> = [];
    for (const a of laneActivities) {
      const s = parseTime(a.startedAt);
      const e = parseTime(a.endedAt) ?? now;
      if (s !== null) {
        events.push({ time: s, delta: 1 });
        events.push({ time: e, delta: -1 });
      }
    }
    events.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
    let current = 0;
    let peak = 0;
    for (const ev of events) {
      current += ev.delta;
      if (current > peak) peak = current;
    }
    return { agent, activities: laneActivities, peakConcurrency: peak };
  });
}

// ── 虚拟化行高（与 CSS --row-lg 一致） ──────────────────────

const LANE_HEIGHT = 44;

// ── 子组件：活动条 ──────────────────────────────────────────

function ActivityBar({
  activity,
  selected,
  timeRange,
  now,
  onSelect,
  locale,
}: {
  activity: TeamActivitySlim;
  selected: boolean;
  timeRange: { min: number; max: number };
  now: number;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}): React.JSX.Element {
  const startMs = parseTime(activity.startedAt);
  const endMs = parseTime(activity.endedAt) ?? now;
  const leftPct = startMs !== null ? timeToPercent(startMs, timeRange.min, timeRange.max) : 0;
  const widthPct = startMs !== null
    ? Math.max(0.5, timeToPercent(endMs, timeRange.min, timeRange.max) - leftPct)
    : 100;
  const isOpen = activity.endedAt === null;
  const isAmbiguous = activity.orderConfidence === 'ambiguous';
  const kindLabel = tt(TT.activityKind[activity.kind], locale);
  const handleClick = useCallback(() => {
    onSelect(selected ? null : { kind: 'activity', id: activity.id });
  }, [selected, onSelect, activity.id]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(selected ? null : { kind: 'activity', id: activity.id });
      } else if (event.key === 'Escape' && selected) {
        event.preventDefault();
        onSelect(null);
      }
    },
    [selected, onSelect, activity.id],
  );
  const ariaLabel = `${kindLabel}, ${activity.startedAt ?? '?'} → ${activity.endedAt ?? tt(TT.openEnd, locale)}${isAmbiguous ? `, ${tt(TT.ambiguous, locale)}` : ''}`;
  return (
    <div
      className={`team-timeline-activity team-timeline-activity-${activity.kind} ${selected ? 'team-timeline-activity-on' : ''} ${isOpen ? 'team-timeline-activity-open' : ''} ${isAmbiguous ? 'team-timeline-activity-ambiguous' : ''}`}
      role="listitem"
      aria-selected={selected}
      aria-label={ariaLabel}
      tabIndex={0}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="team-timeline-activity-kind" aria-hidden="true">{kindLabel}</span>
      {isAmbiguous && (
        <span className="team-timeline-activity-ambiguous-marker" aria-hidden="true">≈</span>
      )}
    </div>
  );
}

// ── TeamTimelineProps ───────────────────────────────────────

export interface TeamTimelineProps {
  snapshot: TeamRunSnapshot;
  /** 活动列表（由 TeamShell 在 timeline/ledger 视图时拉取，§7.3）。 */
  activities: TeamActivitySlim[];
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
  /** lane 虚拟化上限（超过则聚合显示 omitted 计数，§8.4）。 */
  laneCap?: number;
}

// ── TeamTimeline ────────────────────────────────────────────

export function TeamTimeline({
  snapshot,
  activities,
  selection,
  onSelect,
  locale,
  laneCap = 200,
}: TeamTimelineProps): React.JSX.Element {
  const now = useMemo(() => Date.now(), []);
  const timeRange = useMemo(
    () => computeTimeRange(snapshot.agents, activities, now),
    [snapshot.agents, activities, now],
  );
  const lanes = useMemo(
    () => buildLanes(snapshot.agents, activities, now),
    [snapshot.agents, activities, now],
  );

  // §8.4 聚合：超过 laneCap 的 lane 截断 + omitted 计数
  const visibleLanes = useMemo(() => {
    if (lanes.length <= laneCap) return { lanes, omitted: 0, total: lanes.length };
    return { lanes: lanes.slice(0, laneCap), omitted: lanes.length - laneCap, total: lanes.length };
  }, [lanes, laneCap]);

  const { containerRef, range: virtualRange, onScroll } = useVirtualList(
    visibleLanes.lanes.length,
    LANE_HEIGHT,
  );

  if (snapshot.agents.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.timelineEmpty', locale)}
        description={t('team.timelineEmptyHint', locale)}
      />
    );
  }

  return (
    <div
      className="team-timeline-view"
      role="list"
      aria-label={t('team.timelineLabel', locale)}
    >
      {/* wall-clock 刻度 */}
      <div className="team-timeline-axis" aria-hidden="true">
        <span className="team-timeline-axis-min">{new Date(timeRange.min).toISOString().slice(11, 19)}</span>
        <span className="team-timeline-axis-max">{new Date(timeRange.max).toISOString().slice(11, 19)}</span>
      </div>

      <div
        ref={containerRef}
        className="team-timeline-lanes"
        style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
        onScroll={onScroll}
      >
        <div style={{ height: virtualRange.totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${virtualRange.offsetY}px)` }}>
              {visibleLanes.lanes
                .slice(virtualRange.startIndex, virtualRange.endIndex)
                .map((lane) => {
                const agentSelected =
                  selection !== null && selection.kind === 'agent' && selection.id === lane.agent.id;
                const stateLabel = tt(TT.agentState[lane.agent.state], locale);
                const laneAriaLabel = `${tt(TT.lane, locale)} ${lane.agent.displayName}, ${stateLabel}, ${tt(TT.concurrency, locale)} ${lane.peakConcurrency}, ${lane.activities.length} ${tt(TT.total, locale)}`;
                return (
                  <div
                    key={lane.agent.id}
                    className={`team-timeline-lane ${agentSelected ? 'team-timeline-lane-on' : ''}`}
                    role="listitem"
                    aria-selected={agentSelected}
                    aria-label={laneAriaLabel}
                    style={{ height: LANE_HEIGHT }}
                  >
                    <button
                      type="button"
                      className={`team-timeline-lane-label ${agentSelected ? 'team-timeline-lane-label-on' : ''}`}
                      aria-pressed={agentSelected}
                      aria-label={`${lane.agent.displayName} (${stateLabel})`}
                      onClick={() => onSelect(agentSelected ? null : { kind: 'agent', id: lane.agent.id })}
                    >
                      <span className="team-timeline-lane-name">{lane.agent.displayName}</span>
                      <span className={`team-timeline-lane-state team-timeline-lane-state-${lane.agent.state}`}>
                        {stateLabel}
                      </span>
                      <span className="team-timeline-lane-conc">×{lane.peakConcurrency}</span>
                    </button>
                    <div
                      className="team-timeline-lane-track"
                      role="list"
                      aria-label={`${lane.agent.displayName} ${tt(TT.total, locale)}`}
                    >
                      {lane.activities.length === 0 ? (
                        <span className="team-timeline-lane-empty">{tt(TT.noActivities, locale)}</span>
                      ) : (
                        lane.activities.map((activity) => {
                          const actSelected =
                            selection !== null && selection.kind === 'activity' && selection.id === activity.id;
                          return (
                            <ActivityBar
                              key={activity.id}
                              activity={activity}
                              selected={actSelected}
                              timeRange={timeRange}
                              now={now}
                              onSelect={onSelect}
                              locale={locale}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {visibleLanes.omitted > 0 && (
        <div className="team-timeline-omitted" role="status">
          {tt(TT.omitted, locale)}: {visibleLanes.omitted} / {visibleLanes.total}
        </div>
      )}
    </div>
  );
}
