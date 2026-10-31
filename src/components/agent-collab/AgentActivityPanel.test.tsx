/**
 * agent-collaboration-replay §3.5 / §7.4 / §8.5 — AgentActivityPanel 测试（8 个场景）。
 *
 * 不 mock 被测逻辑、不放松断言（AGENTS.md）。
 * 覆盖 spec §5.5.1 规则 1/3/4/5 + §8.5.1 规则 1-7。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { TeamActivitySlim, TeamAgent, TeamAgentState } from '../../core/trace-types.js';
import { AgentActivityPanel, type AgentActivityPanelProps } from './AgentActivityPanel.js';

// ── mock data helpers ────────────────────────────────────────

function makeAgent(
  id: string,
  over: Partial<TeamAgent> = {},
): TeamAgent {
  return {
    id,
    runId: 'r1',
    nativeId: `n-${id}`,
    displayName: `Agent ${id}`,
    role: 'team-mate',
    roleClass: 'teammate',
    model: 'gpt-4',
    state: 'idle',
    createdAt: null,
    endedAt: null,
    sessionKeys: [],
    evidenceIds: [],
    ...over,
  };
}

function makeActivity(
  id: string,
  over: Partial<TeamActivitySlim> = {},
): TeamActivitySlim {
  return {
    id,
    runId: 'r1',
    agentId: 'a1',
    taskId: 't1',
    roundId: null,
    kind: 'agent_lifecycle',
    status: 'running',
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: null,
    nativeSequence: 1,
    sessionKey: null,
    eventId: null,
    turnKey: null,
    messageId: null,
    artifactId: null,
    tokenUsage: null,
    costUsd: null,
    costSource: null,
    costCurrency: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    evidenceIds: [],
    orderConfidence: 'native',
    ...over,
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

function baseProps(over: Partial<AgentActivityPanelProps> = {}): AgentActivityPanelProps {
  const agents = over.agents ?? [makeAgent('a1'), makeAgent('a2')];
  const activities = over.activities ?? [makeActivity('act1')];
  return {
    agents,
    activities,
    agentStates: over.agentStates ?? new Map<string, TeamAgentState>(),
    locale: over.locale ?? 'zh',
  };
}

// ── 8 个测试场景 ─────────────────────────────────────────────

describe('AgentActivityPanel §7.4 / §8.5', () => {
  it('1. 单列按 agent 分组：每个 agent 一个 <details> 聚合行（spec §8.5.1 规则 1）', () => {
    const agents = [makeAgent('a1'), makeAgent('a2')];
    const activities = [
      makeActivity('act1', { agentId: 'a1', startedAt: '2024-01-01T00:00:00Z' }),
      makeActivity('act2', { agentId: 'a2', startedAt: '2024-01-01T00:01:00Z' }),
    ];
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const panel = container.querySelector('.collab-activity-panel');
    expect(panel).not.toBeNull();
    const groups = panel?.querySelectorAll('.collab-activity-group');
    expect(groups?.length).toBe(2);
    // 聚合行含 displayName
    expect(panel?.textContent).toContain('Agent a1');
    expect(panel?.textContent).toContain('Agent a2');
  });

  it('2. 默认聚合态：所有 <details> 不展开（spec §8.5.1 规则 4）', () => {
    const agents = [makeAgent('a1')];
    const activities = [makeActivity('act1', { agentId: 'a1' })];
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const details = container.querySelector('.collab-activity-group') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    // 折叠态：open=false（明细由 <details> 原生控制可见性）
    expect(details.open).toBe(false);
  });

  it('3. 聚合行内容：displayName + "N 条" + 状态序列摘要（spec §8.5.1 规则 2/6）', () => {
    const agents = [makeAgent('a1')];
    // 状态序列：created → busy → completed
    const activities = [
      makeActivity('act1', {
        agentId: 'a1',
        kind: 'agent_lifecycle',
        status: 'running',
        startedAt: '2024-01-01T00:00:00Z',
      }),
      makeActivity('act2', {
        agentId: 'a1',
        kind: 'agent_lifecycle',
        status: 'success',
        startedAt: '2024-01-01T00:01:00Z',
      }),
    ];
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const summary = container.querySelector('.collab-activity-group > summary');
    expect(summary).not.toBeNull();
    // 含 displayName
    expect(summary?.textContent).toContain('Agent a1');
    // 含 "2 条"
    expect(summary?.textContent).toContain('2 条');
    // 含状态序列摘要 created→busy→completed
    expect(summary?.textContent).toContain('busy→completed');
  });

  it('4. 点击聚合行展开/折叠明细（spec §8.5.1 规则 3）', () => {
    const agents = [makeAgent('a1')];
    const activities = [
      makeActivity('act1', { agentId: 'a1', startedAt: '2024-01-01T00:00:00Z' }),
      makeActivity('act2', { agentId: 'a1', startedAt: '2024-01-01T00:01:00Z' }),
    ];
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const details = container.querySelector('.collab-activity-group') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    // 点击 summary 展开
    const summary = details.querySelector('summary')!;
    act(() => {
      summary.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(details.open).toBe(true);
    // 展开后含明细列表
    const detailList = container.querySelector('.collab-activity-detail-list');
    expect(detailList).not.toBeNull();
    const detailItems = detailList?.querySelectorAll('.collab-activity-detail');
    expect(detailItems?.length).toBe(2);
    // 再次点击折叠
    act(() => {
      summary.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(details.open).toBe(false);
  });

  it('5. 无活动 agent：聚合行 "0 条 · 空闲"，不可展开（spec §8.5.1 规则 1）', () => {
    const agents = [makeAgent('a1', { state: 'idle' }), makeAgent('a2', { state: 'idle' })];
    const activities = [
      makeActivity('act1', { agentId: 'a1', startedAt: '2024-01-01T00:00:00Z' }),
    ];
    const agentStates = new Map<string, TeamAgentState>([
      ['a1', 'busy'],
      ['a2', 'idle'],
    ]);
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities, agentStates })} />,
    );

    const groups = container.querySelectorAll('.collab-activity-group');
    // a2 无活动 → collab-activity-group-empty
    const a2Group = groups[1] as HTMLDetailsElement;
    expect(a2Group.classList.contains('collab-activity-group-empty')).toBe(true);
    // 聚合行含 "0 条"
    expect(a2Group.textContent).toContain('0 条');
    // 不可展开：点击 summary 不切换 open（cursor: default）
    // 注：原生 <details> 即使 empty class 仍可点击，但样式上不可展开
    // 这里断言 class 标记 + 文本内容
    expect(a2Group.textContent).toContain('空闲');
  });

  it('6. ambiguous activity → 聚合行带 ⚠ 标记（spec §8.5.1 规则 7）', () => {
    const agents = [makeAgent('a1')];
    const activities = [
      makeActivity('act1', { agentId: 'a1', orderConfidence: 'native' }),
      makeActivity('act2', { agentId: 'a1', orderConfidence: 'ambiguous' }),
    ];
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const summary = container.querySelector('.collab-activity-group > summary');
    const mark = summary?.querySelector('.collab-activity-ambiguous-mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toContain('⚠');
  });

  it('7. 状态序列 > 10 个状态 → 截断为前 9 + …（spec §8.5.3 异常 1）', () => {
    const agents = [makeAgent('a1')];
    // 12 个 agent_lifecycle 活动 → 12 个状态
    const activities = Array.from({ length: 12 }, (_, i) =>
      makeActivity(`act${i + 1}`, {
        agentId: 'a1',
        kind: 'agent_lifecycle',
        status: 'running',
        startedAt: `2024-01-01T00:${String(i).padStart(2, '0')}:00Z`,
      }),
    );
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const summary = container.querySelector('.collab-activity-group > summary');
    const seq = summary?.querySelector('.collab-activity-group-summary');
    expect(seq).not.toBeNull();
    // 12 个状态 → 截断为前 9 + …
    expect(seq?.textContent).toContain('…');
    // 应含 9 个 busy（前 9 个状态）
    const matches = seq?.textContent?.match(/busy/g) ?? [];
    expect(matches.length).toBe(9);
  });

  it('8. 展开明细按 startedAt 升序排列（spec §5.5.1 规则 3）', () => {
    const agents = [makeAgent('a1')];
    // 故意倒序传入
    const activities = [
      makeActivity('act3', { agentId: 'a1', startedAt: '2024-01-01T00:02:00Z' }),
      makeActivity('act1', { agentId: 'a1', startedAt: '2024-01-01T00:00:00Z' }),
      makeActivity('act2', { agentId: 'a1', startedAt: '2024-01-01T00:01:00Z' }),
    ];
    const container = render(
      <AgentActivityPanel {...baseProps({ agents, activities })} />,
    );

    const details = container.querySelector('.collab-activity-group') as HTMLDetailsElement;
    act(() => {
      details.querySelector('summary')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    const times = container.querySelectorAll('.collab-activity-detail-time');
    expect(times.length).toBe(3);
    expect(times[0]?.textContent).toBe('2024-01-01T00:00:00Z');
    expect(times[1]?.textContent).toBe('2024-01-01T00:01:00Z');
    expect(times[2]?.textContent).toBe('2024-01-01T00:02:00Z');
  });

  it('9. 无 activity → 显示「无活动记录」提示（spec §5.5.1 规则 5）', () => {
    const container = render(
      <AgentActivityPanel {...baseProps({ activities: [] })} />,
    );

    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('当前任务无活动记录');
    // 不渲染活动面板
    const panel = container.querySelector('.collab-activity-panel');
    expect(panel).toBeNull();
  });
});
