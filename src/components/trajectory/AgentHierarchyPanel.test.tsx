import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry, SessionMergeGroupInfo, TraceSession } from '../../core/trace-types.js';
import { AgentHierarchyPanel } from './AgentHierarchyPanel.js';

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
  vi.restoreAllMocks();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function session(id: string, over: Partial<TraceSession> = {}): TraceSession {
  return {
    id,
    provider: 'codearts',
    sourceAgent: 'CodeArts',
    title: `session ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 3,
    eventCount: 5,
    tokenUsage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 1, total: 2 },
    costUsd: 0.01,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    totalDurationMs: 1000,
    isSubagent: false,
    ...over,
  };
}

function indexEntry(id: string, over: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    id,
    provider: 'codearts',
    sourceAgent: 'CodeArts',
    title: `member ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    eventCount: 10,
    messageCount: 2,
    tokenTotal: 100,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    detailLoaded: true,
    mergeGroupId: null,
    hasSystemPrompt: false,
    tags: [],
    ...over,
  };
}

function group(id: string, mergedKeys: string[]): SessionMergeGroupInfo {
  return {
    id,
    primaryKey: mergedKeys[0]!,
    title: 'group',
    sourceAgent: 'CodeArts',
    mergedKeys,
    reason: 'config',
  };
}

describe('AgentHierarchyPanel（D9）', () => {
  it('多成员组：恰好一次批量 keys 拉取（绝不逐成员），根 + 子节点渲染', async () => {
    const groups: SessionMergeGroupInfo[] = [group('g1', ['main-1', 'sub-1', 'sub-2'])];
    const members = [indexEntry('main-1', { title: 'Main Agent' }), indexEntry('sub-1'), indexEntry('sub-2')];
    const fetchGroups = vi.fn(async () => ({ groups }));
    const fetchMembers = vi.fn(async (keys: string[]) => ({ items: members.filter((m) => keys.includes(m.id)) }));
    const { html, unmount } = mount(
      <AgentHierarchyPanel
        locale="zh"
        sessionKey="main-1"
        session={session('main-1')}
        turnCount={7}
        onSelectAgent={() => undefined}
        fetchGroups={fetchGroups}
        fetchMembers={fetchMembers}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchMembers).toHaveBeenCalledTimes(1);
    expect(fetchMembers).toHaveBeenCalledWith(['main-1', 'sub-1', 'sub-2']);
    const nodes = document.querySelectorAll('.agent-node');
    expect(nodes.length).toBe(3);
    expect(html()).toContain('Main Agent');
    // 根节点 = 主 agent；选中节点带 accent 指示
    expect(nodes[0]!.classList.contains('agent-node-selected')).toBe(true);
    expect(nodes[0]!.querySelector('.agent-node-indicator')).not.toBeNull();
    unmount();
  });

  it('单 agent 会话：单一根节点，不发批量拉取（边例表）', async () => {
    const fetchGroups = vi.fn(async () => ({ groups: [] }));
    const fetchMembers = vi.fn(async () => ({ items: [] }));
    const { unmount } = mount(
      <AgentHierarchyPanel
        locale="zh"
        sessionKey="solo-1"
        session={session('solo-1')}
        turnCount={3}
        onSelectAgent={() => undefined}
        fetchGroups={fetchGroups}
        fetchMembers={fetchMembers}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMembers).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.agent-node').length).toBe(1);
    expect(document.querySelector('.agent-node')?.textContent).toContain('Main agent');
    unmount();
  });

  it('切换 agent：点击子节点回调 onSelectAgent（重载 turn 区域）', async () => {
    const groups: SessionMergeGroupInfo[] = [group('g1', ['main-1', 'sub-1'])];
    const fetchGroups = vi.fn(async () => ({ groups }));
    const fetchMembers = vi.fn(async () => ({ items: [indexEntry('main-1'), indexEntry('sub-1')] }));
    const onSelectAgent = vi.fn();
    const { unmount } = mount(
      <AgentHierarchyPanel
        locale="zh"
        sessionKey="main-1"
        session={session('main-1')}
        turnCount={7}
        onSelectAgent={onSelectAgent}
        fetchGroups={fetchGroups}
        fetchMembers={fetchMembers}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const nodes = document.querySelectorAll('.agent-node');
    act(() => {
      (nodes[1] as HTMLButtonElement).click();
    });
    expect(onSelectAgent).toHaveBeenCalledWith('sub-1');
    unmount();
  });

  it('未知子类型渲染 Unknown + 启发式 tooltip，不从标题猜测（design-system）', async () => {
    const groups: SessionMergeGroupInfo[] = [group('g1', ['main-1', 'sub-1'])];
    const fetchGroups = vi.fn(async () => ({ groups }));
    const fetchMembers = vi.fn(async () => ({
      items: [indexEntry('main-1'), indexEntry('sub-1', { title: 'some vague title' })],
    }));
    const { html, unmount } = mount(
      <AgentHierarchyPanel
        locale="zh"
        sessionKey="main-1"
        session={session('main-1')}
        turnCount={7}
        onSelectAgent={() => undefined}
        fetchGroups={fetchGroups}
        fetchMembers={fetchMembers}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const nodes = document.querySelectorAll('.agent-node');
    const subType = nodes[1]!.querySelector('.agent-node-type');
    expect(subType?.textContent).toContain('Unknown');
    expect(subType?.getAttribute('title')).toContain('启发式');
    expect(html()).not.toContain('some vague title — type');
    unmount();
  });

  it('加载失败 → 错误态 + 重试（四态）', async () => {
    const fetchGroups = vi.fn().mockRejectedValueOnce(new Error('net down'));
    const fetchMembers = vi.fn();
    const { html, unmount } = mount(
      <AgentHierarchyPanel
        locale="zh"
        sessionKey="main-1"
        session={session('main-1')}
        turnCount={null}
        onSelectAgent={() => undefined}
        fetchGroups={fetchGroups}
        fetchMembers={fetchMembers}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(html()).toContain('net down');
    expect(document.querySelector('.ui-error')).not.toBeNull();
    unmount();
  });
});
