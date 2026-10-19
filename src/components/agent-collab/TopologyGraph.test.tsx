/**
 * agent-collaboration-replay §4.2 / §7.2 / §8.1 — TopologyGraph 测试（8 个场景）。
 *
 * 不 mock 被测逻辑、不放松断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { TeamAgent, TeamAgentEdge, TeamAgentState } from '../../core/trace-types.js';
import { TopologyGraph, type TopologyGraphProps } from './TopologyGraph.js';

// ── mock data helpers ────────────────────────────────────────

function makeAgent(id: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id,
    runId: 'r1',
    nativeId: `n-${id}`,
    displayName: `Agent ${id}`,
    role: 'team-mate',
    roleClass: 'teammate',
    model: 'gpt-4',
    state: 'busy',
    createdAt: null,
    endedAt: null,
    sessionKeys: [],
    evidenceIds: [],
    ...over,
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  over: Partial<TeamAgentEdge> = {},
): TeamAgentEdge {
  return {
    id,
    runId: 'r1',
    fromAgentId: from,
    toAgentId: to,
    kind: 'supervises',
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
    ...over,
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<TopologyGraphProps> = {}): TopologyGraphProps {
  const agents = over.agents ?? [makeAgent('a1'), makeAgent('a2')];
  const edges = over.edges ?? [makeEdge('e1', 'a1', 'a2')];
  return {
    agents,
    edges,
    activeAgentIds: over.activeAgentIds ?? new Set<string>(),
    agentStates: over.agentStates ?? new Map<string, TeamAgentState>(),
    selectedAgentId: over.selectedAgentId ?? null,
    onSelectAgent: over.onSelectAgent ?? (() => undefined),
    edgeMessageCounts: over.edgeMessageCounts ?? new Map<string, number>(),
    locale: over.locale ?? 'zh',
  };
}

// ── 8 个测试场景 ─────────────────────────────────────────────

describe('TopologyGraph §7.2 / §8.1', () => {
  it('keeps a 30-agent intrinsic canvas and a named keyboard-focusable scroll region', () => {
    const agents = Array.from({ length: 30 }, (_, index) => makeAgent(`a${index}`));
    const edges = agents.slice(1).map((agent, index) => makeEdge(`e${index}`, agents[0]!.id, agent.id));
    const container = render(<TopologyGraph {...baseProps({ agents, edges })}/>);
    const region = container.querySelector('.collab-topology-wrap')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toContain('横向滚动');
    const svg = region.querySelector('svg')!;
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(width).toBeGreaterThan(1280);
    expect(svg.getAttribute('width')).toBe(String(width));
    expect(svg.getAttribute('height')).toBe(String(height));
    expect(container.querySelectorAll('.collab-node')).toHaveLength(30);
    act(() => (region as HTMLElement).focus());
    expect(document.activeElement).toBe(region);
  });
  it('1. 渲染 SVG + title + desc，role="img"，aria-label 正确', () => {
    const container = render(<TopologyGraph {...baseProps()} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Agent 拓扑结构图');
    const title = svg?.querySelector('title');
    expect(title?.textContent).toBe('Agent 拓扑结构');
    const desc = svg?.querySelector('desc');
    expect(desc?.textContent).toContain('2 nodes');
    expect(desc?.textContent).toContain('1 edges');
  });

  it('2. 节点点击触发 onSelectAgent', () => {
    const onSelect = vi.fn();
    const container = render(<TopologyGraph {...baseProps({ onSelectAgent: onSelect })} />);
    const node = container.querySelector('.collab-node');
    expect(node).not.toBeNull();
    act(() => {
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    // 首次点击传入选中的 agent id
    expect(onSelect.mock.calls[0]![0]).toBe('a1');
  });

  it('3. 节点为 <rect> 圆角矩形卡片（非 <circle>），含 displayName 完整文本', () => {
    const container = render(<TopologyGraph {...baseProps()} />);
    // 节点卡片为 <rect>，不再是 <circle>
    const card = container.querySelector('.collab-node-card');
    expect(card).not.toBeNull();
    expect(card?.tagName.toLowerCase()).toBe('rect');
    expect(card?.getAttribute('rx')).toBe('4');
    expect(card?.getAttribute('ry')).toBe('4');
    // 不应有 circle
    const circle = container.querySelector('.collab-node circle');
    expect(circle).toBeNull();
    // displayName 完整显示
    const nameText = container.querySelector('.collab-node-name');
    expect(nameText?.textContent).toBe('Agent a1');
  });

  it('4. 角色 badge：leader 与 mate 颜色不同（spec §8.1.1 规则 3）', () => {
    const agents = [
      makeAgent('leader', { role: 'team-leader', roleClass: 'leader' }),
      makeAgent('mate', { role: 'team-mate', roleClass: 'teammate' }),
    ];
    const container = render(<TopologyGraph {...baseProps({ agents, edges: [] })} />);
    const badges = container.querySelectorAll('.collab-node-badge');
    expect(badges.length).toBe(2);
    const leaderBadge = badges[0] as SVGRectElement;
    const mateBadge = badges[1] as SVGRectElement;
    // leader 用 --accent-emphasis，mate 用 --neutral-subtle，二者填充不同
    expect(leaderBadge.getAttribute('fill')).toBe('var(--accent-emphasis)');
    expect(mateBadge.getAttribute('fill')).toBe('var(--neutral-subtle)');
    expect(leaderBadge.getAttribute('fill')).not.toBe(mateBadge.getAttribute('fill'));
  });

  it('5. 状态色：busy 活跃 / idle 空闲 / failed 失败 → 三态填充互不相同（spec §8.1.1 规则 4-5）', () => {
    const agents = [
      makeAgent('a', { state: 'busy' }),
      makeAgent('b', { state: 'idle' }),
      makeAgent('c', { state: 'failed' }),
    ];
    const activeAgentIds = new Set<string>(['a']); // 仅 a 有活动
    const agentStates = new Map<string, TeamAgentState>([
      ['a', 'busy'],
      ['b', 'idle'],
      ['c', 'failed'],
    ]);
    const container = render(
      <TopologyGraph
        {...baseProps({ agents, edges: [], activeAgentIds, agentStates })}
      />,
    );
    const cards = container.querySelectorAll('.collab-node-card');
    expect(cards.length).toBe(3);
    const aFill = (cards[0] as SVGRectElement).getAttribute('fill');
    const bFill = (cards[1] as SVGRectElement).getAttribute('fill');
    const cFill = (cards[2] as SVGRectElement).getAttribute('fill');
    // 三态填充互不相同
    expect(aFill).not.toBe(bFill);
    expect(bFill).not.toBe(cFill);
    expect(aFill).not.toBe(cFill);
    // a 活跃 → accent-subtle，c 失败 → danger-subtle
    expect(aFill).toBe('var(--accent-subtle)');
    expect(cFill).toBe('var(--danger-subtle)');
    // 节点 class 含状态
    const nodes = container.querySelectorAll('.collab-node');
    expect(nodes[0]?.classList.contains('collab-node-status-active')).toBe(true);
    expect(nodes[1]?.classList.contains('collab-node-status-idle')).toBe(true);
    expect(nodes[2]?.classList.contains('collab-node-status-failed')).toBe(true);
  });

  it('6. 边消息计数渲染 → <text> 含正确数字', () => {
    const container = render(
      <TopologyGraph
        {...baseProps({
          edgeMessageCounts: new Map([['a1:a2', 7]]),
        })}
      />,
    );
    const countText = container.querySelector('.collab-edge-count');
    expect(countText).not.toBeNull();
    expect(countText?.textContent).toBe('7');
  });

  it('7. 图例含活跃/空闲/失败三色样 + 文本（spec §8.1.1 规则 8）', () => {
    const container = render(<TopologyGraph {...baseProps()} />);
    const legend = container.querySelector('.collab-legend');
    expect(legend).not.toBeNull();
    const swatches = legend?.querySelectorAll('.collab-legend-swatch');
    expect(swatches?.length).toBe(3);
    const labels = legend?.querySelectorAll('.collab-legend-label');
    expect(labels?.length).toBe(3);
    // 三色样填充分别为 accent-emphasis / fg-subtle / danger-emphasis
    expect((swatches?.[0] as SVGRectElement).getAttribute('fill')).toBe('var(--accent-emphasis)');
    expect((swatches?.[1] as SVGRectElement).getAttribute('fill')).toBe('var(--fg-subtle)');
    expect((swatches?.[2] as SVGRectElement).getAttribute('fill')).toBe('var(--danger-emphasis)');
    // 文本含活跃/空闲/失败
    const labelTexts = Array.from(labels ?? []).map((l) => l.textContent);
    expect(labelTexts).toContain('活跃');
    expect(labelTexts).toContain('空闲');
    expect(labelTexts).toContain('失败');
  });

  it('8. 空 agents → EmptyState，不渲染 <svg>', () => {
    const container = render(
      <TopologyGraph {...baseProps({ agents: [], edges: [] })} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('无 Agent 数据');
  });

  it('9. 拓扑外层包 .collab-topology-wrap 支持水平滚动（spec §8.1.3 异常 1）', () => {
    const container = render(<TopologyGraph {...baseProps()} />);
    const wrap = container.querySelector('.collab-topology-wrap');
    expect(wrap).not.toBeNull();
    const svg = wrap?.querySelector('svg');
    expect(svg).not.toBeNull();
    // viewBox 自适应
    expect(svg?.getAttribute('viewBox')).not.toBeNull();
  });
});
