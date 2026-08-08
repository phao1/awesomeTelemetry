import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LAYOUT_KEYS } from '../../layout.js';
import { TrajectoryRail } from './TrajectoryRail.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      root.unmount();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      media: '(max-width: 1023px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

describe('TrajectoryRail（D2）', () => {
  it('渲染 rail 与 turn 区域；宽度来自 awesome-telemetry.trajectory.railWidth', () => {
    stubMatchMedia(false);
    localStorage.setItem(LAYOUT_KEYS.trajectoryRailWidth, '280');
    const { unmount } = mount(
      <TrajectoryRail
        rail={<div className="rail-content-marker" />}
        turnArea={<div className="turn-area-marker" />}
        collapsed={false}
        onToggleCollapse={() => undefined}
      />,
    );
    expect(document.querySelector('.rail-content-marker')).not.toBeNull();
    expect(document.querySelector('.turn-area-marker')).not.toBeNull();
    const panes = document.querySelectorAll('.ui-split-pane');
    expect((panes[0] as HTMLElement).style.width).toBe('280px');
    unmount();
  });

  it('<1024px 视口自动折叠 rail，turn 区域保持可用（D2）', () => {
    stubMatchMedia(true);
    localStorage.setItem(LAYOUT_KEYS.trajectoryRailWidth, '280');
    const { unmount } = mount(
      <TrajectoryRail
        rail={<div className="rail-content-marker" />}
        turnArea={<div className="turn-area-marker" />}
        collapsed={false}
        onToggleCollapse={() => undefined}
      />,
    );
    const panes = document.querySelectorAll('.ui-split-pane');
    expect((panes[0] as HTMLElement).style.width).toBe('0px');
    expect(document.querySelector('.turn-area-marker')).not.toBeNull();
    unmount();
  });

  it('用户折叠（collapsed=true）同样收起 rail 而不影响 turn 区域', () => {
    stubMatchMedia(false);
    const { unmount } = mount(
      <TrajectoryRail
        rail={<div className="rail-content-marker" />}
        turnArea={<div className="turn-area-marker" />}
        collapsed
        onToggleCollapse={() => undefined}
      />,
    );
    const panes = document.querySelectorAll('.ui-split-pane');
    expect((panes[0] as HTMLElement).style.width).toBe('0px');
    expect(document.querySelector('.turn-area-marker')).not.toBeNull();
    unmount();
  });
});
