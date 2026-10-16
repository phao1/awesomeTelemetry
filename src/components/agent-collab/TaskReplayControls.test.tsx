/**
 * agent-collaboration-replay §3.4 / §7.3 / §8.2 — TaskReplayControls 测试（8 个场景）。
 *
 * 不 mock 被测逻辑、不放松断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { TeamTask } from '../../core/trace-types.js';
import { TaskReplayControls, type TaskReplayControlsProps } from './TaskReplayControls.js';

// ── mock data helpers ────────────────────────────────────────

function makeTask(id: string, over: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    runId: 'r1',
    nativeId: `n-${id}`,
    title: `Task ${id}`,
    descriptionAvailable: false,
    priority: 1,
    status: 'completed',
    createdAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    resultAvailable: false,
    evidenceIds: [],
    ...over,
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<TaskReplayControlsProps> = {}): TaskReplayControlsProps {
  const tasks = over.tasks ?? [makeTask('t1'), makeTask('t2'), makeTask('t3')];
  const taskCount = tasks.length;
  return {
    tasks,
    cursor: over.cursor ?? 0,
    totalActivities: over.totalActivities ?? 5,
    taskActivityCounts: over.taskActivityCounts ?? Array.from({ length: taskCount }, () => 1),
    onPrev: over.onPrev ?? (() => undefined),
    onNext: over.onNext ?? (() => undefined),
    onJump: over.onJump ?? (() => undefined),
    onSkipEmpty: over.onSkipEmpty ?? (() => undefined),
    locale: over.locale ?? 'zh',
  };
}

// ── 8 个测试场景 ─────────────────────────────────────────────

describe('TaskReplayControls §7.3 / §8.2', () => {
  it('1. cursor=0 时后退按钮 disabled', () => {
    const container = render(<TaskReplayControls {...baseProps({ cursor: 0 })} />);
    const prevBtn = container.querySelector('.collab-replay-prev') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
  });

  it('2. cursor=last 时前进按钮 disabled', () => {
    const container = render(<TaskReplayControls {...baseProps({ cursor: 2 })} />);
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    const prevBtn = container.querySelector('.collab-replay-prev') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);
  });

  it('3. 点击前进 → onNext', () => {
    const onNext = vi.fn();
    const container = render(
      <TaskReplayControls {...baseProps({ cursor: 0, onNext })} />,
    );
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('4. 两行布局：导航行 + 任务信息行 + 分段进度条（spec §8.2.1 规则 1）', () => {
    const container = render(<TaskReplayControls {...baseProps({ cursor: 0 })} />);
    // 第 1 行：导航
    const nav = container.querySelector('.collab-replay-nav');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('.collab-replay-prev')).not.toBeNull();
    expect(nav?.querySelector('.collab-replay-next')).not.toBeNull();
    expect(nav?.querySelector('.collab-replay-progress')?.textContent).toContain('1/3');
    // 第 2 行：任务信息
    const info = container.querySelector('.collab-replay-info');
    expect(info).not.toBeNull();
    expect(info?.querySelector('.collab-replay-task-title')?.textContent).toBe('Task t1');
    expect(info?.querySelector('.collab-replay-task-status')?.textContent).toBe('completed');
    expect(info?.querySelector('.collab-replay-activity-count')?.textContent).toContain('5');
    // 第 3 行：分段进度条
    const segments = container.querySelector('.collab-replay-segments');
    expect(segments).not.toBeNull();
    // 不再有 <input type="range">
    const slider = container.querySelector('.collab-replay-slider');
    expect(slider).toBeNull();
  });

  it('5. 分段进度条：段数 = tasks.length，点击段 K → onJump(K)（spec §8.2.1 规则 4-5）', () => {
    const onJump = vi.fn();
    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask(`t${i + 1}`, { title: `Task ${i + 1}` }),
    );
    const container = render(
      <TaskReplayControls
        {...baseProps({
          tasks,
          cursor: 2,
          taskActivityCounts: [1, 1, 1, 1, 1],
          onJump,
        })}
      />,
    );
    const segs = container.querySelectorAll('.collab-replay-seg');
    expect(segs.length).toBe(5);
    // 点击第 4 段（index=3）→ onJump(3)
    act(() => {
      segs[3]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onJump).toHaveBeenCalledWith(3);
    // aria-label 含 "Task K: title"
    expect(segs[3]?.getAttribute('aria-label')).toBe('Task 4: Task 4');
    expect(segs[3]?.getAttribute('title')).toBe('Task 4');
  });

  it('6. 四态着色：cursor=2 → 0-1 已完成、2 当前、3-4 未开始（spec §8.2.1 规则 4）', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => makeTask(`t${i + 1}`));
    const container = render(
      <TaskReplayControls
        {...baseProps({
          tasks,
          cursor: 2,
          taskActivityCounts: [1, 1, 1, 1, 1],
        })}
      />,
    );
    const segs = container.querySelectorAll('.collab-replay-seg');
    expect(segs[0]?.classList.contains('collab-replay-seg-completed')).toBe(true);
    expect(segs[1]?.classList.contains('collab-replay-seg-completed')).toBe(true);
    expect(segs[2]?.classList.contains('collab-replay-seg-current')).toBe(true);
    expect(segs[3]?.classList.contains('collab-replay-seg-pending')).toBe(true);
    expect(segs[4]?.classList.contains('collab-replay-seg-pending')).toBe(true);
  });

  it('7. 无活动 task 段 → collab-replay-seg-empty（spec §8.2.1 规则 4 无活动态）', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => makeTask(`t${i + 1}`));
    const container = render(
      <TaskReplayControls
        {...baseProps({
          tasks,
          cursor: 1,
          taskActivityCounts: [1, 0, 0],
        })}
      />,
    );
    const segs = container.querySelectorAll('.collab-replay-seg');
    // index=1 当前但无活动 → empty 优先
    expect(segs[1]?.classList.contains('collab-replay-seg-empty')).toBe(true);
    expect(segs[2]?.classList.contains('collab-replay-seg-empty')).toBe(true);
  });

  it('8. 空 task 处理：totalActivities=0 且多 task → 前后 disabled + 跳过按钮可见（spec §8.2.1 规则 2-3）', () => {
    const onSkipEmpty = vi.fn();
    const container = render(
      <TaskReplayControls
        {...baseProps({
          cursor: 1,
          totalActivities: 0,
          taskActivityCounts: [1, 0, 1],
          onSkipEmpty,
        })}
      />,
    );
    const prevBtn = container.querySelector('.collab-replay-prev') as HTMLButtonElement;
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(true);
    const skipBtn = container.querySelector('.collab-replay-skip-empty') as HTMLButtonElement;
    expect(skipBtn).not.toBeNull();
    act(() => {
      skipBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSkipEmpty).toHaveBeenCalledTimes(1);
  });

  it('9. 空 task 且单 task → 两按钮均 disabled，无跳过按钮（spec §8.2.1 规则 3）', () => {
    const container = render(
      <TaskReplayControls
        {...baseProps({
          tasks: [makeTask('only')],
          cursor: 0,
          totalActivities: 0,
          taskActivityCounts: [0],
        })}
      />,
    );
    const prevBtn = container.querySelector('.collab-replay-prev') as HTMLButtonElement;
    const nextBtn = container.querySelector('.collab-replay-next') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(true);
    const skipBtn = container.querySelector('.collab-replay-skip-empty');
    expect(skipBtn).toBeNull();
  });

  it('10. 空 tasks → EmptyState，不渲染控制条', () => {
    const container = render(
      <TaskReplayControls {...baseProps({ tasks: [], cursor: 0, taskActivityCounts: [] })} />,
    );
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('无团队任务');
    // 不渲染按钮
    const prevBtn = container.querySelector('.collab-replay-prev');
    expect(prevBtn).toBeNull();
  });
});
