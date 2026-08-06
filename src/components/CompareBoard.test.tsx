import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionIndexEntry } from '../core/trace-types.js';
import { CompareBoard } from './CompareBoard.js';
import { makeResult } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
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
    html: () => container.innerHTML,
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

const baseProps = {
  sessions: [] as SessionIndexEntry[],
  locale: 'zh' as const,
  leftKey: '',
  rightKey: '',
  onLeftChange: () => undefined,
  onRightChange: () => undefined,
};

describe('CompareBoard 壳（REQ-019 / 可用性）', () => {
  it('会话列表加载中显示骨架，不误显示「暂无数据」', () => {
    const { html, unmount } = mount(
      <CompareBoard {...baseProps} sessionsLoading={true} />,
    );
    expect(html()).toContain('ui-skeleton');
    expect(html()).not.toContain('选择两个会话');
    unmount();
  });

  it('空状态带「选择左侧会话」按钮，点击直接打开左侧选择器（REQ-019）', () => {
    const { html, unmount } = mount(<CompareBoard {...baseProps} />);
    expect(html()).toContain('选择左侧会话');
    const picker = document.querySelectorAll('.compare-picker')[0] as HTMLButtonElement;
    expect(picker.getAttribute('aria-expanded')).toBe('false');
    const button = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('选择左侧会话'),
    ) as HTMLButtonElement;
    act(() => button.click());
    expect((document.querySelectorAll('.compare-picker')[0] as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    unmount();
  });

  it('加载后区块带编号标题（4–10，REQ-105 顺序）', async () => {
    const result = makeResult();
    const { html, unmount } = mount(
      <CompareBoard
        sessions={[]}
        locale="zh"
        leftKey="left"
        rightKey="right"
        onLeftChange={() => undefined}
        onRightChange={() => undefined}
        loadCompare={async () => result}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (document.querySelector('.compare-speed') !== null) {
          break;
        }
      }
    });
    const out = html();
    expect(out).toContain('4. 速度指标');
    expect(out).toContain('5. 可视化图表');
    expect(out).toContain('7. 时间构成与阶段');
    expect(out).toContain('10. 详细指标表');
    unmount();
  });

  it('Hero Header 渲染渐变 + provider 标识 + Verdict 比率摘要（REQ-104）', async () => {
    const result = makeResult();
    const { html, unmount } = mount(
      <CompareBoard
        sessions={[]}
        locale="zh"
        leftKey="left"
        rightKey="right"
        onLeftChange={() => undefined}
        onRightChange={() => undefined}
        loadCompare={async () => result}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (document.querySelector('.compare-hero') !== null) {
          break;
        }
      }
    });
    const out = html();
    expect(out).toContain('compare-hero');
    expect(out).toContain('linear-gradient(135deg, var(--provider-codex-subtle) 0%, var(--provider-codex-subtle) 100%)');
    expect(out).toContain('快 1.7×');
    unmount();
  });

  it('section 顺序：Hero → Verdict → KPI → Speed → Charts → Dims → Time&Phase（REQ-105）', async () => {
    const result = makeResult();
    const { unmount } = mount(
      <CompareBoard
        sessions={[]}
        locale="zh"
        leftKey="left"
        rightKey="right"
        onLeftChange={() => undefined}
        onRightChange={() => undefined}
        loadCompare={async () => result}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (document.querySelector('.compare-charts') !== null) {
          break;
        }
      }
    });
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id^="compare-"]'))
      .map((el) => el.id)
      .filter((id) =>
        ['compare-hero', 'compare-verdict', 'compare-kpi', 'compare-speed', 'compare-charts', 'compare-dims', 'compare-time-phase', 'compare-tools', 'compare-timelines', 'compare-metrics'].includes(id),
      );
    expect(ids).toEqual([
      'compare-hero',
      'compare-verdict',
      'compare-kpi',
      'compare-speed',
      'compare-charts',
      'compare-dims',
      'compare-time-phase',
      'compare-tools',
      'compare-timelines',
      'compare-metrics',
    ]);
    unmount();
  });
});
