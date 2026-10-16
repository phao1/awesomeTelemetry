/**
 * agent-collaboration-replay §3.4 / §5 / §8.2 — 回放控制条。
 *
 * 两行布局 + 分段进度条（spec §8.2.1）：
 * - 第 1 行：◀ 后退 + "3 / 17" 进度文本 + ▶ 前进 + （空 task 时）[跳过空 task] 次级按钮
 * - 第 2 行：taskTitle · 状态 badge · "N 条活动"
 * - 第 3 行：分段进度条，N 个 <button> 段，四态着色（已完成/当前/未开始/无活动）
 *
 * 空 task 处理（spec §8.2.1 规则 2-3）：
 * - totalActivities === 0 且 tasks.length > 1 → 前进/后退 disabled，显示 [跳过空 task]
 * - totalActivities === 0 且 tasks.length === 1 → 两按钮均 disabled，无跳过按钮
 * - totalActivities > 0 → 正常 canPrev / canNext 逻辑
 *
 * 键盘快捷键：ArrowLeft = 后退，ArrowRight = 前进（组件聚焦时）
 * 空 tasks → EmptyState
 */

import { useCallback, type KeyboardEvent } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { TeamTask } from '../../core/trace-types.js';
import { EmptyState } from '../ui/States.js';

// ── Props ────────────────────────────────────────────────────

export interface TaskReplayControlsProps {
  /** 有序（按 startedAt 升序，null 排最后）。 */
  tasks: TeamTask[];
  cursor: number;
  /** 当前 task 的活动数。 */
  totalActivities: number;
  /** 每个 task 的活动计数（用于分段进度条四态着色 + 跳过空 task）。 */
  taskActivityCounts: number[];
  onPrev: () => void;
  onNext: () => void;
  onJump: (index: number) => void;
  /** 跳到下一个有活动的 task（spec §8.2.1 规则 3）。 */
  onSkipEmpty: () => void;
  locale: Locale;
}

// ── 分段进度条段状态（design §3.2.3） ────────────────────────

export type SegmentState = 'completed' | 'current' | 'pending' | 'empty';

function classifySegment(
  index: number,
  cursor: number,
  activityCount: number,
): SegmentState {
  if (activityCount === 0) {
    return 'empty';
  }
  if (index === cursor) {
    return 'current';
  }
  if (index < cursor) {
    return 'completed';
  }
  return 'pending';
}

// ── 组件 ─────────────────────────────────────────────────────

export function TaskReplayControls({
  tasks,
  cursor,
  totalActivities,
  taskActivityCounts,
  onPrev,
  onNext,
  onJump,
  onSkipEmpty,
  locale,
}: TaskReplayControlsProps): React.JSX.Element {
  // 空 tasks → EmptyState
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">∅</span>}
        title={t('session.teamReplay.noTasks', locale)}
      />
    );
  }

  // 空 task 处理（spec §8.2.1 规则 2-3）
  const isEmptyTask = totalActivities === 0;
  const hasMultipleTasks = tasks.length > 1;
  // 空 task 且多 task → 禁用前后按钮，显示跳过按钮；空 task 且单 task → 禁用两按钮，无跳过
  const disableNavDueToEmpty = isEmptyTask && hasMultipleTasks;
  const showSkipButton = disableNavDueToEmpty;

  const canPrev = cursor > 0 && !disableNavDueToEmpty;
  const canNext = cursor < tasks.length - 1 && !disableNavDueToEmpty;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' && canPrev) {
        event.preventDefault();
        onPrev();
      } else if (event.key === 'ArrowRight' && canNext) {
        event.preventDefault();
        onNext();
      }
    },
    [canPrev, canNext, onPrev, onNext],
  );

  const currentTask = tasks[cursor];
  const taskTitle = currentTask?.title ?? '';
  const taskStatus = currentTask?.status ?? 'unknown';
  const progressText = t('session.teamReplay.taskProgress', locale)
    .replace('{current}', String(cursor + 1))
    .replace('{total}', String(tasks.length));
  const activityCountText = t('session.teamReplay.activityCount', locale).replace(
    '{count}',
    String(totalActivities),
  );

  return (
    <div
      className="collab-replay-controls"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="group"
      aria-label={t('session.teamReplay.replayControls', locale)}
    >
      {/* 第 1 行：导航 */}
      <div className="collab-replay-row collab-replay-nav">
        <button
          type="button"
          className="collab-replay-prev"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label={t('session.teamReplay.prevTask', locale)}
        >
          ◀
        </button>
        <span className="collab-replay-progress">{progressText}</span>
        <button
          type="button"
          className="collab-replay-next"
          onClick={onNext}
          disabled={!canNext}
          aria-label={t('session.teamReplay.nextTask', locale)}
        >
          ▶
        </button>
        {showSkipButton && (
          <button
            type="button"
            className="collab-replay-skip-empty"
            onClick={onSkipEmpty}
            aria-label={t('session.teamReplay.skipEmpty', locale)}
          >
            {t('session.teamReplay.skipEmpty', locale)}
          </button>
        )}
      </div>

      {/* 第 2 行：任务信息（taskTitle · 状态 badge · N 条活动） */}
      <div className="collab-replay-row collab-replay-info">
        <span className="collab-replay-task-title">{taskTitle}</span>
        <span className="collab-replay-sep" aria-hidden="true">·</span>
        <span className={`collab-replay-task-status collab-task-status-${taskStatus}`}>
          {taskStatus}
        </span>
        <span className="collab-replay-sep" aria-hidden="true">·</span>
        <span className="collab-replay-activity-count">{activityCountText}</span>
      </div>

      {/* 第 3 行：分段进度条（替换 <input type="range">，spec §8.2.1 规则 4-6） */}
      <div
        className="collab-replay-segments"
        role="tablist"
        aria-label={t('session.teamReplay.replayControls', locale)}
      >
        {tasks.map((task, index) => {
          const activityCount = taskActivityCounts[index] ?? 0;
          const segState = classifySegment(index, cursor, activityCount);
          const segClassName = [
            'collab-replay-seg',
            `collab-replay-seg-${segState}`,
          ].join(' ');
          const segAriaLabel = `Task ${index + 1}: ${task.title}`;
          return (
            <button
              key={task.id}
              type="button"
              className={segClassName}
              onClick={() => onJump(index)}
              aria-label={segAriaLabel}
              title={task.title}
              role="tab"
              aria-selected={index === cursor}
            />
          );
        })}
      </div>
    </div>
  );
}
