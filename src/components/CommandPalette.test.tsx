import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionIndexEntry } from '../core/trace-types.js';
import { CommandPalette, type PaletteAction } from './CommandPalette.js';

const sessions: SessionIndexEntry[] = [
  {
    id: 'codex-1',
    provider: 'codex',
    sourceAgent: 'Codex',
    title: 'fix build',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    status: 'success',
    cwd: '/tmp',
    eventCount: 5,
    messageCount: 2,
    tokenTotal: 100,
    costUsd: 0,
    dataSource: 'scan',
    sourcePath: '/tmp/a.jsonl',
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  },
];

const containers: HTMLDivElement[] = [];

afterEach(() => {
  while (containers.length > 0) {
    containers.pop()?.remove();
  }
});

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

describe('REQ-025 命令面板', () => {
  it('复用共享 store：会话按标题模糊匹配，点击触发 session action 且不发请求', () => {
    const actions: PaletteAction[] = [];
    const container = render(
      <CommandPalette
        sessions={sessions}
        locale="zh"
        onClose={() => undefined}
        onAction={(action) => actions.push(action)}
      />,
    );
    expect(container.textContent).toContain('fix build');
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'fix');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const row = Array.from(container.querySelectorAll('.palette-row')).find((el) =>
      el.textContent?.includes('fix build'),
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    act(() => row.click());
    expect(actions).toEqual([{ type: 'session', key: 'codex-1' }]);
  });

  it('静态命令：切视图/主题/语言/扫描/设置', () => {
    const actions: PaletteAction[] = [];
    const container = render(
      <CommandPalette
        sessions={[]}
        locale="en"
        onClose={() => undefined}
        onAction={(action) => actions.push(action)}
      />,
    );
    const rows = Array.from(container.querySelectorAll('.palette-row'));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const scan = rows.find((row) => row.textContent?.includes('Trigger scan')) as HTMLButtonElement;
    act(() => scan.click());
    expect(actions).toContainEqual({ type: 'scan' });
  });

  it('REQ-110：/act 前缀只显示动作类，动作条目带 IconChevronRight', () => {
    const container = render(
      <CommandPalette
        sessions={sessions}
        locale="zh"
        onClose={() => undefined}
        onAction={() => undefined}
      />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, '/act 导出');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const rows = Array.from(container.querySelectorAll('.palette-row'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('导出报告');
    expect(container.querySelector('.palette-row-icon')).not.toBeNull();
  });

  it('REQ-110：/nav 只显示导航，/s 只显示会话', () => {
    const container = render(
      <CommandPalette
        sessions={sessions}
        locale="zh"
        onClose={() => undefined}
        onAction={() => undefined}
      />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    const setValue = (value: string): void => {
      act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    setValue('/nav');
    const navRows = Array.from(container.querySelectorAll('.palette-row'));
    expect(navRows.length).toBe(5);
    const navHints = navRows.map((row) => row.querySelector('.palette-row-hint')?.textContent);
    expect(navHints.every((hint) => hint === 'nav')).toBe(true);
    setValue('/s fix');
    const sessionRows = Array.from(container.querySelectorAll('.palette-row'));
    expect(sessionRows.length).toBe(1);
    expect(sessionRows[0]!.textContent).toContain('fix build');
  });
});
