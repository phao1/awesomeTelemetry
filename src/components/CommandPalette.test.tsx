import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionIndexEntry, TraceEventSlim } from '../core/trace-types.js';
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

const twoSessions: SessionIndexEntry[] = [
  sessions[0]!,
  { ...sessions[0]!, id: 'claude-2', provider: 'claude', title: 'add auth', startedAt: '2026-08-02T00:00:00.000Z' },
];

function makeEvent(overrides: Partial<TraceEventSlim>): TraceEventSlim {
  return {
    id: 'e1',
    sessionId: 'codex-1',
    sequence: 1,
    turnKey: null,
    kind: 'tool',
    phase: 'implement',
    status: 'success',
    actor: 'assistant',
    tool: 'Edit',
    title: 'edit index.ts',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 10,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...overrides,
  };
}

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

function typeInto(container: HTMLElement, value: string): void {
  const input = container.querySelector('input') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function rowsOf(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('.palette-row')) as HTMLButtonElement[];
}

describe('REQ-111 /compare 发起对比', () => {
  it('/compare 展开最近会话列表，选中两个后触发 compare action', () => {
    const actions: PaletteAction[] = [];
    let closed = 0;
    const container = render(
      <CommandPalette
        sessions={twoSessions}
        locale="zh"
        onClose={() => {
          closed += 1;
        }}
        onAction={(action) => actions.push(action)}
      />,
    );
    typeInto(container, '/compare');
    const opener = rowsOf(container);
    expect(opener.length).toBe(1);
    expect(opener[0]!.textContent).toContain('对比两个会话');
    act(() => opener[0]!.click());
    // 挑选模式：最近 10 个会话（此处 2 个），按 startedAt 倒序
    const picks = rowsOf(container);
    expect(picks.length).toBe(2);
    expect(picks[0]!.textContent).toContain('add auth');
    act(() => picks[0]!.click());
    expect(actions).toEqual([]);
    act(() => rowsOf(container)[1]!.click());
    expect(actions).toEqual([{ type: 'compare', left: 'claude-2', right: 'codex-1' }]);
    expect(closed).toBe(1);
  });

  it('无会话时 /compare 为禁用态', () => {
    const container = render(
      <CommandPalette sessions={[]} locale="zh" onClose={() => undefined} onAction={() => undefined} />,
    );
    typeInto(container, '/compare');
    const rows = rowsOf(container);
    expect(rows.length).toBe(1);
    expect(rows[0]!.disabled).toBe(true);
    expect(rows[0]!.textContent).toContain('无可用会话');
  });
});

describe('REQ-112 /goto 跳转事件', () => {
  const events: TraceEventSlim[] = [
    makeEvent({ id: 'e1', sequence: 1, title: 'read config' }),
    makeEvent({ id: 'e2', sequence: 2, title: 'edit index.ts' }),
    makeEvent({ id: 'e12', sequence: 12, title: 'run tests' }),
  ];

  it('数字按序号定位，点击触发 goto action', () => {
    const actions: PaletteAction[] = [];
    const container = render(
      <CommandPalette
        sessions={sessions}
        events={events}
        view="session"
        locale="zh"
        onClose={() => undefined}
        onAction={(action) => actions.push(action)}
      />,
    );
    typeInto(container, '/goto 12');
    const rows = rowsOf(container);
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('#12 run tests');
    act(() => rows[0]!.click());
    expect(actions).toEqual([{ type: 'goto', eventId: 'e12' }]);
  });

  it('关键词按事件标题搜索', () => {
    const container = render(
      <CommandPalette
        sessions={sessions}
        events={events}
        view="session"
        locale="zh"
        onClose={() => undefined}
        onAction={() => undefined}
      />,
    );
    typeInto(container, '/goto index');
    const rows = rowsOf(container);
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('edit index.ts');
  });

  it('非 Session 视图时禁用', () => {
    const container = render(
      <CommandPalette
        sessions={sessions}
        events={events}
        view="mission"
        locale="zh"
        onClose={() => undefined}
        onAction={() => undefined}
      />,
    );
    typeInto(container, '/goto');
    const rows = rowsOf(container);
    expect(rows.length).toBe(1);
    expect(rows[0]!.disabled).toBe(true);
    expect(rows[0]!.textContent).toContain('需先打开会话');
  });
});

describe('REQ-113 /filter 按 provider 过滤', () => {
  it('列出 9 个 provider，带字母章，点击触发 filter action', () => {
    const actions: PaletteAction[] = [];
    const container = render(
      <CommandPalette
        sessions={sessions}
        locale="zh"
        onClose={() => undefined}
        onAction={(action) => actions.push(action)}
      />,
    );
    typeInto(container, '/filter');
    const rows = rowsOf(container);
    expect(rows.length).toBe(9);
    expect(container.querySelectorAll('.ui-provider-badge').length).toBe(9);
    act(() => rows[0]!.click());
    expect(actions).toEqual([{ type: 'filter', provider: 'claude' }]);
  });

  it('已启用的 provider 显示开启态', () => {
    const container = render(
      <CommandPalette
        sessions={sessions}
        providerFilter={['codex']}
        locale="en"
        onClose={() => undefined}
        onAction={() => undefined}
      />,
    );
    typeInto(container, '/filter codex');
    const rows = rowsOf(container);
    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelector('.palette-row-hint')?.textContent).toBe('on');
    expect(rows[0]!.className).toContain('palette-row-on');
  });
});
