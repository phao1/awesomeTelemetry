import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { ProviderKey, SessionIndexEntry, TraceStatus } from '../core/trace-types.js';
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
  onProviderFilterChange: () => undefined,
  onStatusFilterChange: () => undefined,
  cursorIndex: -1,
  searchInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
};

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

  it('搜索过滤标题与 id', () => {
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
    const rows = container.querySelectorAll('.session-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('refactor api');
  });
});
