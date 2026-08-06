import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ProviderKey,
  SessionIndexEntry,
  SessionRange,
  TraceStatus,
} from '../core/trace-types.js';
import { SessionList } from './SessionList.js';

function entry(id: string, title: string): SessionIndexEntry {
  return {
    id,
    provider: 'codex',
    sourceAgent: 'Codex',
    title,
    startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    status: 'success',
    cwd: '/tmp',
    eventCount: 110,
    messageCount: 20,
    tokenTotal: 1900,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    detailLoaded: false,
    mergeGroupId: null,
    hasSystemPrompt: false,
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

const baseProps = {
  providerFilter: [] as ProviderKey[],
  statusFilter: [] as TraceStatus[],
  q: '',
  onQChange: () => undefined,
  range: 'today' as SessionRange,
  onRangeChange: () => undefined,
  total: 0,
  onProviderFilterChange: () => undefined,
  onStatusFilterChange: () => undefined,
  cursorIndex: -1,
  searchInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('REQ-016 会话列表', () => {
  it('44px 双行密排：标题 + ProviderBadge + 相对时间 + events/tokens 计数', () => {
    const container = render(
      <SessionList
        items={[entry('s1', 'fix build')]}
        selectedId={null}
        onSelect={() => undefined}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    const row = container.querySelector('.session-row')!;
    expect(row).not.toBeNull();
    expect(row.querySelector('.session-row-title')?.textContent).toBe('fix build');
    expect(row.querySelector('.ui-provider-badge')?.textContent).toBe('X');
    expect(row.textContent).toContain('110 ev');
    expect(row.textContent).toContain('1.9k tok');
    expect(row.textContent).toMatch(/小时前|h ago/);
  });

  it('点击行回调 onSelect；选中行 aria-selected + 左侧竖条类', () => {
    const calls: string[] = [];
    const container = render(
      <SessionList
        items={[entry('s1', 'a'), entry('s2', 'b')]}
        selectedId="s2"
        onSelect={(id) => calls.push(id)}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    const rows = container.querySelectorAll('.session-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute('aria-selected')).toBe('false');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]!.className).toContain('session-row-on');
    act(() => (rows[0] as HTMLElement).click());
    expect(calls).toEqual(['s1']);
  });

  it('搜索输入受控：输入触发 onQChange，本地不做已加载页过滤（服务端过滤）', () => {
    const calls: string[] = [];
    const container = render(
      <SessionList
        items={[entry('s1', 'fix build'), entry('s2', 'refactor api')]}
        selectedId={null}
        onSelect={() => undefined}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        onQChange={(q) => calls.push(q)}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'refactor');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(calls).toEqual(['refactor']);
    // 服务端过滤语义：已加载 items 原样渲染（不再只过滤已加载页）
    const rows = container.querySelectorAll('.session-row');
    expect(rows).toHaveLength(2);
  });

  it('时间范围分段控件：默认 today，点击回调 onRangeChange', () => {
    const calls: SessionRange[] = [];
    const container = render(
      <SessionList
        items={[entry('s1', 'a')]}
        selectedId={null}
        onSelect={() => undefined}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        range="today"
        onRangeChange={(r) => calls.push(r)}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    const buttons = Array.from(container.querySelectorAll('.session-range-btn'));
    expect(buttons).toHaveLength(4);
    expect(buttons[0]!.className).toContain('session-range-btn-on');
    act(() => (buttons[2] as HTMLElement).click());
    expect(calls).toEqual(['30d']);
    act(() => (buttons[3] as HTMLElement).click());
    expect(calls).toEqual(['30d', 'all']);
  });

  it('meta 行显示 session ID（mono、截断、title 完整）', () => {
    const container = render(
      <SessionList
        items={[entry('codearts-87fa32238de9b5', '财务看板')]}
        selectedId={null}
        onSelect={() => undefined}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    const idEl = container.querySelector('.session-row-id');
    expect(idEl).not.toBeNull();
    expect(idEl?.textContent).toBe('codearts-87fa32238de9b5');
    expect(idEl?.getAttribute('title')).toBe('codearts-87fa32238de9b5');
  });

  it('分页页脚：显示总数与加载更多按钮；无更多时按钮隐藏', () => {
    const container = render(
      <SessionList
        items={[entry('s1', 'a'), entry('s2', 'b')]}
        selectedId={null}
        onSelect={() => undefined}
        locale="zh"
        hasMore={true}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        total={120}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    expect(container.querySelector('.session-total')?.textContent).toContain('120');
    expect(container.querySelector('.session-list-footer button')).not.toBeNull();
  });

  it('hasMore=false 时页脚不渲染加载更多按钮', () => {
    const container = render(
      <SessionList
        items={[entry('s1', 'a')]}
        selectedId={null}
        onSelect={() => undefined}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        total={1}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    expect(container.querySelector('.session-list-footer button')).toBeNull();
  });

  it('建议 11：M 徽章点击懒加载合并成员，点击成员回调 onSelect', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const text = url.includes('/api/session-groups')
        ? JSON.stringify({
            groups: [{
              id: 'g1',
              primaryKey: 'main-1',
              title: 'merged title',
              sourceAgent: 'CodeArts',
              mergedKeys: ['sub-1', 'sub-2'],
              reason: 'test',
            }],
          })
        : JSON.stringify({
            items: [
              entry('sub-1', 'subagent one'),
              entry('sub-2', 'subagent two'),
            ],
            nextCursor: null,
            hasMore: false,
            total: 2,
          });
      return {
        ok: true,
        text: async () => text,
      };
    }));
    const merged = entry('main-1', 'merged title');
    merged.mergeGroupId = 'g1';
    const selected: string[] = [];
    const container = render(
      <SessionList
        items={[merged]}
        selectedId={null}
        onSelect={(id) => selected.push(id)}
        locale="zh"
        hasMore={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        offlineSamples={false}
        {...baseProps}
        width={300}
        collapsed={false}
        onResize={() => undefined}
        onToggleCollapse={() => undefined}
      />,
    );
    const badge = container.querySelector('.session-merge-badge') as HTMLButtonElement;
    expect(badge).not.toBeNull();
    act(() => {
      badge.click();
    });
    // 等待懒加载完成
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const members = container.querySelectorAll('.session-merge-member');
    expect(members.length).toBe(2);
    act(() => {
      (members[0] as HTMLButtonElement).click();
    });
    expect(selected).toEqual(['sub-1']);
  });
});
