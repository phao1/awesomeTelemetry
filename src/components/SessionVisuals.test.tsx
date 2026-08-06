import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionDetailResponse, TraceEventSlim } from '../core/trace-types.js';
import { SessionVisuals } from './SessionVisuals.js';
import { makeEvent, makeResult, makeSession } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { unmount: () => root.unmount(), html: () => container.innerHTML };
}

afterEach(() => {
  while (containers.length > 0) {
    containers.pop()?.remove();
  }
});

function detailWith(events: TraceEventSlim[], totalDurationMs = 5000): SessionDetailResponse {
  return {
    ...makeResult().left,
    session: makeSession('s1', { totalDurationMs }),
    events,
    mode: 'slim',
  } as SessionDetailResponse;
}

describe('REQ-121 SessionVisuals（Heatmap + Radar）', () => {
  it('渲染热力图与 8 轴雷达图两个区块', () => {
    const events = [
      makeEvent({ id: 'a', startedAt: '2026-08-01T00:00:00.000Z' }),
      makeEvent({ id: 'b', startedAt: '2026-08-01T00:01:00.000Z' }),
      makeEvent({ id: 'c', startedAt: '2026-08-01T00:02:00.000Z' }),
    ];
    const { unmount } = mount(<SessionVisuals detail={detailWith(events)} locale="zh" />);
    const heatmap = document.querySelector('.session-heatmap');
    const radar = document.querySelector('.session-radar');
    expect(heatmap).not.toBeNull();
    expect(radar).not.toBeNull();
    // 短会话 → 1 分钟桶，3 个桶
    expect(heatmap!.querySelectorAll('rect').length).toBe(3);
    expect(heatmap!.textContent).toContain('1 分钟/桶');
    // 8 轴：8 条轴线 + 8 个轴标签
    expect(radar!.querySelectorAll('line').length).toBe(8);
    expect(radar!.querySelectorAll('text').length).toBe(8);
    expect(radar!.textContent).toContain('TTFT');
    unmount();
  });

  it('长会话（60 分钟）桶大小提升到 2 分钟', () => {
    const events = [
      makeEvent({ id: 'a', startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0 }),
      makeEvent({ id: 'z', startedAt: '2026-08-01T00:59:00.000Z', durationMs: 0 }),
    ];
    const { unmount } = mount(
      <SessionVisuals detail={detailWith(events, 60 * 60_000)} locale="zh" />,
    );
    const heatmap = document.querySelector('.session-heatmap')!;
    expect(heatmap.textContent).toContain('2 分钟/桶');
    expect(heatmap.querySelectorAll('rect').length).toBe(30);
    unmount();
  });

  it('无事件时整块不渲染', () => {
    const { unmount } = mount(<SessionVisuals detail={detailWith([])} locale="zh" />);
    expect(document.querySelector('.session-visuals')).toBeNull();
    unmount();
  });

  it('颜色全部走 token 变量，不出现字面量 hex', () => {
    const events = [makeEvent({ id: 'a' })];
    const { html, unmount } = mount(<SessionVisuals detail={detailWith(events)} locale="en" />);
    expect(html()).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html()).toContain('var(--accent-emphasis)');
    unmount();
  });
});
