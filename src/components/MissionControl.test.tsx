import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { MissionResponse } from '../core/trace-types.js';
import {
  LEGACY_SECTION_ROLE,
  MissionControl,
  redirectLegacyMissionHash,
  type MissionRange,
} from './MissionControl.js';

function makeResponse(): MissionResponse {
  const widget = (id: string, available: boolean): unknown => ({
    id,
    criteria: `custom-criteria-${id}`,
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
    promptHabits: widget('promptHabits', false),
    activity: widget('activity', false),
  };
  const quality = {
    closure: widget('closure', false),
    costEfficiency: widget('costEfficiency', false),
    toolFailure: widget('toolFailure', false),
    tokenTrend: widget('tokenTrend', false),
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
  };
  return {
    meta: {
      range: '7d',
      generatedAt: '2026-08-05T01:02:03.000Z',
      tz: 480,
      widgetCount: 21,
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
      expect(text).toContain('21'); // widgetCount
      expect(text).toContain('events.tool 按调用数聚合 TOP 10'); // 8.7：criteria 经 i18n 字典渲染
      expect(text).toContain('该指标当前不可用'); // unavailable EmptyState
      // REQ-117：A/B/C 标签页移除后，21 个 widget 一次性按角色分组全量呈现
      expect(host.querySelectorAll('.mission-widget').length).toBe(21);
      expect(host.querySelector('.mission-chips')).toBeNull();
      expect(host.querySelector('[role="tablist"]')).toBeNull();
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });

  it('REQ-109：角色侧边栏渲染三组，点击平滑滚动到对应 section', async () => {
    const load = vi.fn(async (_range: MissionRange) => makeResponse());
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
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
      const items = [...host.querySelectorAll<HTMLButtonElement>('.mission-nav-item')];
      expect(items.length).toBe(3);
      expect(host.textContent).toContain('管理者');
      expect(host.textContent).toContain('工程师');
      expect(host.textContent).toContain('运维');
      expect(host.querySelector('#mission-role-manager')).not.toBeNull();
      act(() => items[1]!.click());
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });

  it('REQ-109：`[` 键折叠/展开侧边栏', async () => {
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
      expect(host.querySelector('.mission-nav-list')).not.toBeNull();
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
      });
      expect(host.querySelector('.mission-nav-list')).toBeNull();
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
      });
      expect(host.querySelector('.mission-nav-list')).not.toBeNull();
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });

  it('REQ-109：滚动后当前可见角色高亮', async () => {
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
      const main = host.querySelector('.mission-view') as HTMLElement;
      const tops: Record<string, number> = {
        'mission-role-manager': 0,
        'mission-role-engineer': 400,
        'mission-role-ops': 800,
      };
      for (const [id, top] of Object.entries(tops)) {
        const el = host.querySelector(`#${id}`)!;
        Object.defineProperty(el, 'offsetTop', { configurable: true, value: top });
      }
      main.scrollTop = 300;
      act(() => {
        main.dispatchEvent(new Event('scroll'));
      });
      const active = host.querySelector('.mission-nav-item-on');
      expect(active?.textContent).toContain('工程师');
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

  it('9.4 定价缺失路径：unknown 成本的模型显示 —，不渲染 $0.0000', async () => {
    const base = makeResponse();
    const withModels: MissionResponse = {
      ...base,
      usage: {
        ...base.usage,
        toolTop: {
          id: 'toolTop',
          criteria: 'mission.criteria.toolTop',
          available: true,
          unavailableReason: null,
          data: [],
        },
      },
      quality: {
        ...base.quality,
        models: {
          id: 'models',
          criteria: 'mission.criteria.models',
          available: true,
          unavailableReason: null,
          data: [
            { model: 'glm-4-plus', calls: 3, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, costUsd: 0, costSource: 'unknown' },
            { model: 'claude-opus-4-8', calls: 1, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, costUsd: 0.5, costSource: 'estimated' },
          ],
        },
      },
    };
    const load = vi.fn(async (_range: MissionRange) => withModels);
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
      // REQ-117：models widget 不再需要切 B 标签页，角色分组下直接可见
      const text = host.textContent ?? '';
      expect(text).toContain('glm-4-plus');
      expect(text).toContain('—');
      expect(text).not.toContain('$0.0000');
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });
});

describe('REQ-117 导航去冗余', () => {
  it('A/B/C 标签页彻底移除，角色分组是唯一导航', async () => {
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
      expect(host.querySelector('.mission-chips')).toBeNull();
      expect(host.querySelectorAll('[role="tab"]').length).toBe(0);
      expect(host.querySelectorAll('.mission-nav-item').length).toBe(3);
      // 默认选中「管理者」
      const active = host.querySelector('.mission-nav-item-on');
      expect(active?.textContent).toContain('管理者');
      // 三个角色 section 全部存在
      for (const role of ['manager', 'engineer', 'ops']) {
        expect(host.querySelector(`#mission-role-${role}`)).not.toBeNull();
      }
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });

  it('redirectLegacyMissionHash：#mission-a|b|c → #mission-role-<role>，其余返回 null', () => {
    expect(redirectLegacyMissionHash('#mission-a')).toBe('#mission-role-manager');
    expect(redirectLegacyMissionHash('#mission-b')).toBe('#mission-role-engineer');
    expect(redirectLegacyMissionHash('#mission-c')).toBe('#mission-role-ops');
    expect(redirectLegacyMissionHash('#/mission?range=7d')).toBeNull();
    // 已经是角色锚点时不再改写
    expect(redirectLegacyMissionHash('#mission-role-ops')).toBeNull();
    expect(LEGACY_SECTION_ROLE.a).toBe('manager');
  });

  it('挂载时把旧锚点重定向到角色锚点并高亮该角色', async () => {
    history.replaceState(null, '', '#mission-c');
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
      expect(window.location.hash).toBe('#mission-role-ops');
      expect(host.querySelector('.mission-nav-item-on')?.textContent).toContain('运维');
    } finally {
      act(() => root?.unmount());
      host.remove();
      history.replaceState(null, '', '#');
    }
  });
});
