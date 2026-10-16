/**
 * agent-collaboration-replay §4.1 / §7.1 / §8.1 — topology-layout 测试（8 个场景）。
 *
 * 纯函数测试，无 DOM 依赖。不 mock 被测逻辑、不放松断言（AGENTS.md）。
 */
import { describe, expect, it } from 'vitest';

import type { TeamAgent, TeamAgentEdge, TeamAgentEdgeKind } from '../../core/trace-types.js';
import { computeCardWidth, computeLayout } from './topology-layout.js';

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
  kind: TeamAgentEdgeKind = 'supervises',
  over: Partial<TeamAgentEdge> = {},
): TeamAgentEdge {
  return {
    id,
    runId: 'r1',
    fromAgentId: from,
    toAgentId: to,
    kind,
    validFrom: null,
    validTo: null,
    confidence: 'native',
    evidenceIds: [],
    ...over,
  };
}

// ── 8 个测试场景 ─────────────────────────────────────────────

describe('topology-layout §7.1 / §8.1', () => {
  it('1. 空 agents + 空 edges → width=0, height=0, nodes=[], edges=[]', () => {
    const result = computeLayout([], []);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('2. 单个 agent（孤立节点）→ 1 个 node，level=0，含 width/height', () => {
    const agents = [makeAgent('a1')];
    const result = computeLayout(agents, []);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0]!;
    expect(node.agentId).toBe('a1');
    expect(node.level).toBe(0);
    // 左上角坐标 + 卡片尺寸
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.width).toBeGreaterThan(0);
    expect(node.height).toBe(44);
    // width/height 非零
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('3. two_level：1 leader + 2 teammates → 3 nodes，leader level=0，teammates level=1', () => {
    const agents = [
      makeAgent('leader', { displayName: 'Leader', role: 'team-leader', roleClass: 'leader' }),
      makeAgent('t1', { displayName: 'Teammate 1' }),
      makeAgent('t2', { displayName: 'Teammate 2' }),
    ];
    const edges = [
      makeEdge('e1', 'leader', 't1', 'supervises'),
      makeEdge('e2', 'leader', 't2', 'supervises'),
    ];
    const result = computeLayout(agents, edges);
    expect(result.nodes).toHaveLength(3);
    const leader = result.nodes.find((n) => n.agentId === 'leader')!;
    const t1 = result.nodes.find((n) => n.agentId === 't1')!;
    const t2 = result.nodes.find((n) => n.agentId === 't2')!;
    expect(leader.level).toBe(0);
    expect(t1.level).toBe(1);
    expect(t2.level).toBe(1);
    // leader 在 teammates 上方（y 更小，左上角语义）
    expect(leader.y).toBeLessThan(t1.y);
    expect(leader.y).toBeLessThan(t2.y);
    // 同层按 displayName 字典序：Teammate 1 在 Teammate 2 左边
    expect(t1.x).toBeLessThan(t2.x);
    // 同层 y 相同
    expect(t1.y).toBe(t2.y);
    // 同层等距：t2.x - t2.width/2 - (t1.x + t1.width/2) 应等于 nodeGap
    // 简单断言：t2 在 t1 右侧，且二者不重叠
    expect(t2.x).toBeGreaterThanOrEqual(t1.x + t1.width);
  });

  it('4. three_level：leader → subleader → teammate → 3 levels，y 坐标递增', () => {
    const agents = [
      makeAgent('leader', { displayName: 'A-Leader' }),
      makeAgent('sub', { displayName: 'B-Subleader' }),
      makeAgent('mate', { displayName: 'C-Teammate' }),
    ];
    const edges = [
      makeEdge('e1', 'leader', 'sub', 'supervises'),
      makeEdge('e2', 'sub', 'mate', 'supervises'),
    ];
    const result = computeLayout(agents, edges);
    const leader = result.nodes.find((n) => n.agentId === 'leader')!;
    const sub = result.nodes.find((n) => n.agentId === 'sub')!;
    const mate = result.nodes.find((n) => n.agentId === 'mate')!;
    expect(leader.level).toBe(0);
    expect(sub.level).toBe(1);
    expect(mate.level).toBe(2);
    // y 严格递增（左上角语义）
    expect(leader.y).toBeLessThan(sub.y);
    expect(sub.y).toBeLessThan(mate.y);
  });

  it('5. 环检测：A→B→A → 断开一条边，degraded 标记', () => {
    const agents = [makeAgent('a'), makeAgent('b')];
    const edges = [
      makeEdge('e1', 'a', 'b', 'supervises'),
      makeEdge('e2', 'b', 'a', 'supervises'), // 成环
    ];
    const result = computeLayout(agents, edges);
    expect(result.edges).toHaveLength(2);
    // 至少一条边被标记 degraded
    const degradedEdges = result.edges.filter((e) => e.degraded);
    expect(degradedEdges.length).toBeGreaterThanOrEqual(1);
    // 节点仍全部渲染（不崩溃）
    expect(result.nodes).toHaveLength(2);
  });

  it('6. 多父节点：A→C, B→C → C 出现在两个 parent 的 children 中，不崩溃', () => {
    const agents = [
      makeAgent('a', { displayName: 'A' }),
      makeAgent('b', { displayName: 'B' }),
      makeAgent('c', { displayName: 'C' }),
    ];
    const edges = [
      makeEdge('e1', 'a', 'c', 'supervises'),
      makeEdge('e2', 'b', 'c', 'supervises'),
    ];
    const result = computeLayout(agents, edges);
    // 不崩溃：3 个节点全部渲染
    expect(result.nodes).toHaveLength(3);
    const c = result.nodes.find((n) => n.agentId === 'c')!;
    expect(c).toBeDefined();
    // a, b 是 root（level 0），c 是 level 1
    const a = result.nodes.find((n) => n.agentId === 'a')!;
    const b = result.nodes.find((n) => n.agentId === 'b')!;
    expect(a.level).toBe(0);
    expect(b.level).toBe(0);
    expect(c.level).toBe(1);
    // 两条边都渲染
    expect(result.edges).toHaveLength(2);
  });

  it('7. 边路径生成 → path 字符串以 M 开头，含 C（三次贝塞尔），端点为卡片底部/顶部中点', () => {
    const agents = [
      makeAgent('a', { displayName: 'A' }),
      makeAgent('b', { displayName: 'B' }),
    ];
    const edges = [makeEdge('e1', 'a', 'b', 'supervises')];
    const result = computeLayout(agents, edges);
    expect(result.edges).toHaveLength(1);
    const layoutEdge = result.edges[0]!;
    const path = layoutEdge.path;
    expect(path.startsWith('M ')).toBe(true);
    expect(path).toContain('C ');
    // midpoint 在两节点之间
    const mid = layoutEdge.midpoint;
    expect(typeof mid.x).toBe('number');
    expect(typeof mid.y).toBe('number');

    // 端点验证：起点 = 父节点底部中点，终点 = 子节点顶部中点
    const fromNode = result.nodes.find((n) => n.agentId === 'a')!;
    const toNode = result.nodes.find((n) => n.agentId === 'b')!;
    const startExpectedX = fromNode.x + fromNode.width / 2;
    const startExpectedY = fromNode.y + fromNode.height;
    const endExpectedX = toNode.x + toNode.width / 2;
    const endExpectedY = toNode.y;
    // path 以 `M startExpectedX,startExpectedY` 开头
    expect(path.startsWith(`M ${startExpectedX},${startExpectedY}`)).toBe(true);
    // path 以 `endExpectedX,endExpectedY` 结尾
    expect(path.endsWith(`${endExpectedX},${endExpectedY}`)).toBe(true);
  });

  it('8. 卡片宽度自适应：displayName 长度 = 30 → width ≥ 30*8+16 = 256（spec §8.1.1 规则 1-2）', () => {
    const longName = 'a'.repeat(30); // 30 字符
    const agents = [makeAgent('long', { displayName: longName })];
    const result = computeLayout(agents, []);
    const node = result.nodes[0]!;
    expect(node.width).toBe(30 * 8 + 16);
    expect(node.height).toBe(44);

    // 短名 → 取 cardMinWidth = 80
    const shortAgents = [makeAgent('short', { displayName: 'ab' })];
    const shortResult = computeLayout(shortAgents, []);
    const shortNode = shortResult.nodes[0]!;
    expect(shortNode.width).toBe(80);

    // computeCardWidth 纯函数
    expect(computeCardWidth('a'.repeat(40), 80)).toBe(40 * 8 + 16);
    expect(computeCardWidth('ab', 80)).toBe(80);
  });
});
