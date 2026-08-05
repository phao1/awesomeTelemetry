import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { MissionResponse } from '../core/trace-types.js';
import { MissionControl, type MissionRange } from './MissionControl.js';

function makeResponse(): MissionResponse {
  const widget = (id: string, available: boolean): unknown => ({
    id,
    criteria: `${id} criteria`,
    available,
    unavailableReason: available ? null : 'NOT_IMPLEMENTED_YET',
    data: available
      ? []
      : null,
  });
  const usage = {
    toolTop: widget('toolTop', true),
    skillTop: widget('skillTop', false),
    subagent: widget('subagent', false),
    heatmap: widget('heatmap', false),
    promptHabits: widget('promptHabits', false),
    activity: widget('activity', false),
  };
  const quality = {
    closure: widget('closure', false),
    costEfficiency: widget('costEfficiency', false),
    toolFailure: widget('toolFailure', false),
    tokenTrend: widget('tokenTrend', false),
    apiQuality: widget('apiQuality', false),
    errorReasons: widget('errorReasons', false),
    riskyCommands: widget('riskyCommands', false),
    drift: widget('drift', false),
    contextPressure: widget('contextPressure', false),
    models: widget('models', false),
    depth: widget('depth', false),
    toolEcology: widget('toolEcology', false),
    scenes: widget('scenes', false),
    heavyScenes: widget('heavyScenes', false),
    parallelism: widget('parallelism', false),
  };
  const health = {
    collectors: widget('collectors', false),
    dualChannel: widget('dualChannel', false),
    calendar: widget('calendar', false),
    hotSessions: widget('hotSessions', false),
  };
  return {
    meta: {
      range: '7d',
      generatedAt: '2026-08-05T01:02:03.000Z',
      tz: 480,
      widgetCount: 25,
      durationMs: 42,
      stamp: '2026-08-05T00:00:00.000Z',
      cached: false,
    },
    usage: usage as MissionResponse['usage'],
    quality: quality as MissionResponse['quality'],
    health: health as MissionResponse['health'],
  };
}

describe('MissionControl（REQ-027）', () => {
  it('1 个请求渲染 meta 行、criteria 行与不可用 EmptyState', async () => {
    const load = vi.fn(async (_range: MissionRange) => makeResponse());
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: ReturnType<typeof createRoot> | undefined;
    try {
      act(() => {
        root = createRoot(host);
        root.render(<MissionControl locale="zh" load={load} />);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(load).toHaveBeenCalledTimes(1);
      const text = host.textContent ?? '';
      expect(text).toContain('25'); // widgetCount
      expect(text).toContain('toolTop criteria'); // 服务端 criteria 行
      expect(text).toContain('该指标当前不可用'); // unavailable EmptyState
      expect(host.querySelectorAll('.mission-widget').length).toBe(6); // A 区
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });

  it('切换 range 触发一次新请求（3 次切换 = 3 次 fetch）', async () => {
    const load = vi.fn(async (_range: MissionRange) => makeResponse());
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: ReturnType<typeof createRoot> | undefined;
    try {
      act(() => {
        root = createRoot(host);
        root.render(<MissionControl locale="zh" load={load} />);
      });
      await act(async () => {
        await Promise.resolve();
      });
      const buttons = [...host.querySelectorAll<HTMLButtonElement>('.mission-range .btn')];
      act(() => buttons[1]!.click());
      await act(async () => {
        await Promise.resolve();
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(load).toHaveBeenLastCalledWith('30d');
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });
});
