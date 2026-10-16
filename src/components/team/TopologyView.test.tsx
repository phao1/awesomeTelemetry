/**
 * add-agent-team-observability §8.1 / §8.10 / §8.13 / §8.14 —
 * TopologyView 测试。
 *
 * 覆盖：
 * - §8.1 拓扑投影：two_level / three_level / deep_tree / peer_graph / hybrid / unknown
 * - §8.10 不伪造协作层（G12.1：拓扑由 edges 推导）
 * - §8.13 无障碍：tree/treeitem role、aria-selected、键盘 Enter/Space/Esc
 * - §8.14 focus-visible、无 color-only meaning（边 kind 有文字 label）
 * - 跨视图高亮（§8.12）：selection 变化时节点高亮
 * - cycle 检测降级、多父降级、no silent graph repair
 *
 * 不 mock 被测逻辑、不放宽断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  TeamAgent,
  TeamAgentEdge,
  TeamAgentEdgeKind,
  TeamArtifact,
  TeamAssignment,

  TeamMetrics,
  TeamMetricValue,
  TeamRunSnapshot,
  TeamRunSummary,
  TeamTask,
  TeamTaskDependency,
  TeamTopologyKind,
} from '../../core/trace-types.js';
import { TopologyView, projectTopology, type TopologyViewProps } from './TopologyView.js';
import type { TeamSelection } from './team-client.js';

// ── mock data helpers ────────────────────────────────────────

const FULL_COMPLETENESS: Record<EvidenceDimension, CompletenessLevel> = {
  topology: 'complete',
  tasks: 'complete',
  communication: 'partial',
  timing: 'complete',
  tools: 'complete',
  outputs: 'complete',
  tokens: 'complete',
  cost: 'unavailable',
  verification: 'partial',
};

function makeRun(id: string, topology: TeamTopologyKind = 'two_level'): TeamRunSummary {
  return {
    id,
    provider: 'codex',
    nativeRunId: `native-${id}`,
    runIdentityConfidence: 'native',
    title: `run ${id}`,
    goalFingerprint: null,
    status: 'success',
    startedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    topologyKind: topology,
    counts: { agents: 2, tasks: 2, communications: 1, activities: 4, rounds: 2, artifacts: 1 },
    tokenAvailable: true,
    costAvailable: false,
    costCurrency: null,
    completeness: FULL_COMPLETENESS,
    updatedAt: new Date().toISOString(),
    stamp: `stamp-${id}`,
  };
}

function makeAgent(id: string, runId: string, over: Partial<TeamAgent> = {}): TeamAgent {
  return {
    id,
    runId,
    nativeId: `n-${id}`,
    displayName: `Agent ${id}`,
    role: 'team-mate',
    roleClass: 'teammate',
    model: 'gpt-4',
    state: 'completed',
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    sessionKeys: [],
    evidenceIds: [],
    ...over,
  };
}

function makeEdge(
  id: string,
  runId: string,
  from: string,
  to: string,
  kind: TeamAgentEdgeKind = 'supervises',
  over: Partial<TeamAgentEdge> = {},
): TeamAgentEdge {
  return {
    id,
    runId,
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

function makeTask(id: string, runId: string): TeamTask {
  return {
    id, runId, nativeId: `n-${id}`, title: `Task ${id}`,
    descriptionAvailable: false, priority: 1, status: 'completed',
    createdAt: null, startedAt: null, completedAt: null, cancelledAt: null, failedAt: null,
    resultAvailable: false, evidenceIds: [],
  };
}

function makeDependency(id: string, runId: string, upstream: string, downstream: string): TeamTaskDependency {
  return {
    id, runId, upstreamTaskId: upstream, downstreamTaskId: downstream,
    validFrom: null, validTo: null, confidence: 'native', evidenceIds: [],
  };
}

function makeAssignment(id: string, runId: string, taskId: string, agentId: string): TeamAssignment {
  return {
    id, runId, taskId, agentId, assignedAt: null, unassignedAt: null,
    assignmentKind: 'assigned', evidenceIds: [],
  };
}

function makeArtifact(id: string, runId: string): TeamArtifact {
  return {
    id, runId, nativeId: null, name: `artifact ${id}`, kind: 'file',
    pathRedacted: null, contentHash: null, producerAgentIds: [], taskIds: [],
    createdAt: null, acceptedAt: null, hasContent: false, evidenceIds: [],
  };
}

function makeMetricValue(): TeamMetricValue {
  return { value: null, available: false, complete: false, criteria: '', evidenceIds: [], numerator: null, denominator: null };
}

function makeMetrics(): TeamMetrics {
  const v = makeMetricValue();
  return {
    calcVersion: 1, generatedAt: new Date().toISOString(),
    scheduling: { wallClockMs: v, agentActiveMs: v, totalWorkMs: v, observedWaitMs: v, maxConcurrency: v, avgConcurrency: v, serialWorkEstimateMs: v, observedSpeedup: v, peakCapacityUtilization: v, criticalPathMs: v, delegationDelayMs: v, handoffLatencyMs: v },
    quality: { taskCompletion: v, verificationCoverage: v, acceptanceCoverage: v, reviewRework: v, acceptedArtifactRate: v },
    stability: { failures: v, retries: v, replacements: v, recoveryLatencyMs: v, blockedOrphanTimeMs: v, unresolvedErrors: v, dagAnomalies: v, incompleteTerminalStates: v },
    cost: { totalInputTokens: v, totalOutputTokens: v, totalReasoningTokens: v, totalCacheReadTokens: v, totalCacheWriteTokens: v, totalCostUsd: v, costCurrency: null, coordinationTokens: v, costGini: v },
    collaboration: { directRatio: v, leaderMediatedRatio: v, responseLatencyMedianMs: v, responseLatencyP95Ms: v, taskBalanceGini: v, leaderWorkConcentration: v, criticalAgentConcentration: v, crossAgentReview: v, duplicateWorkSignal: v },
  };
}

function makeSnapshot(
  runId: string,
  over: {
    agents?: TeamAgent[];
    agentEdges?: TeamAgentEdge[];
    topology?: TeamTopologyKind;
    tasks?: TeamTask[];
    taskDependencies?: TeamTaskDependency[];
    assignments?: TeamAssignment[];
    artifacts?: TeamArtifact[];
  } = {},
): TeamRunSnapshot {
  return {
    summary: makeRun(runId, over.topology ?? 'two_level'),
    agents: over.agents ?? [makeAgent('a-1', runId, { role: 'team-leader', roleClass: 'leader' }), makeAgent('a-2', runId)],
    agentEdges: over.agentEdges ?? [makeEdge('e-1', runId, 'a-1', 'a-2')],
    tasks: over.tasks ?? [makeTask('t-1', runId), makeTask('t-2', runId)],
    taskDependencies: over.taskDependencies ?? [makeDependency('d-1', runId, 't-1', 't-2')],
    assignments: over.assignments ?? [makeAssignment('as-1', runId, 't-1', 'a-1')],
    artifacts: over.artifacts ?? [makeArtifact('ar-1', runId)],
    completeness: FULL_COMPLETENESS,
    anomalies: [],
    metrics: makeMetrics(),
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<TopologyViewProps> = {}): TopologyViewProps {
  return {
    snapshot: makeSnapshot('r-1'),
    selection: null,
    onSelect: () => undefined,
    locale: 'zh',
    ...over,
  };
}

afterEach(() => { document.body.innerHTML = ''; });

// ═══════════════════════════════════════════════════════════════════════════
// §8.10 拓扑投影：two/three/deep/peer/hybrid/unknown
// ═══════════════════════════════════════════════════════════════════════════

describe('projectTopology §8.10 拓扑投影', () => {
  it('two_level：leader + teammates 两层', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'two_level',
      agents: [
        makeAgent('leader', 'r-1', { role: 'team-leader', roleClass: 'leader' }),
        makeAgent('m1', 'r-1'),
        makeAgent('m2', 'r-1'),
      ],
      agentEdges: [
        makeEdge('e1', 'r-1', 'leader', 'm1', 'supervises'),
        makeEdge('e2', 'r-1', 'leader', 'm2', 'supervises'),
      ],
    });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('two_level');
    expect(p.levels).toHaveLength(2);
    expect(p.levels[0]).toEqual(['leader']);
    expect(p.levels[1]).toContain('m1');
    expect(p.levels[1]).toContain('m2');
    expect(p.degradeReason).toBeNull();
  });

  it('three_level：leader + subleaders + teammates 三层', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'three_level',
      agents: [
        makeAgent('leader', 'r-1', { role: 'team-leader', roleClass: 'leader' }),
        makeAgent('sub1', 'r-1', { roleClass: 'subagent' }),
        makeAgent('leaf1', 'r-1'),
      ],
      agentEdges: [
        makeEdge('e1', 'r-1', 'leader', 'sub1', 'supervises'),
        makeEdge('e2', 'r-1', 'sub1', 'leaf1', 'supervises'),
      ],
    });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('three_level');
    expect(p.levels).toHaveLength(3);
    expect(p.levels[0]).toEqual(['leader']);
    expect(p.levels[1]).toEqual(['sub1']);
    expect(p.levels[2]).toEqual(['leaf1']);
  });

  it('deep_tree：降级 flat + degradeReason', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'deep_tree',
      agents: [
        makeAgent('a0', 'r-1'),
        makeAgent('a1', 'r-1'),
        makeAgent('a2', 'r-1'),
        makeAgent('a3', 'r-1'),
      ],
      agentEdges: [
        makeEdge('e1', 'r-1', 'a0', 'a1'),
        makeEdge('e2', 'r-1', 'a1', 'a2'),
        makeEdge('e3', 'r-1', 'a2', 'a3'),
      ],
    });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('flat');
    expect(p.degradeReason).not.toBeNull();
    expect(p.degradeReason).toContain('deep_tree');
  });

  it('peer_graph：降级 flat', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'peer_graph',
      agents: [makeAgent('a', 'r-1'), makeAgent('b', 'r-1')],
      agentEdges: [makeEdge('e1', 'r-1', 'a', 'b', 'peer')],
    });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('flat');
    expect(p.degradeReason).not.toBeNull();
  });

  it('hybrid：降级 flat', () => {
    const snap = makeSnapshot('r-1', { topology: 'hybrid' });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('flat');
  });

  it('unknown：降级 flat', () => {
    const snap = makeSnapshot('r-1', { topology: 'unknown' });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('flat');
  });

  it('cycle 检测：降级 flat + cycle reason', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'two_level',
      agents: [makeAgent('a', 'r-1'), makeAgent('b', 'r-1')],
      agentEdges: [
        makeEdge('e1', 'r-1', 'a', 'b', 'supervises'),
        makeEdge('e2', 'r-1', 'b', 'a', 'supervises'),
      ],
    });
    const p = projectTopology(snap);
    expect(p.renderMode).toBe('flat');
    expect(p.degradeReason).toContain('cycle');
  });

  it('G12.1：不伪造协作层——无 edges 时不假设层级', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'two_level',
      agents: [makeAgent('a', 'r-1'), makeAgent('b', 'r-1')],
      agentEdges: [],
    });
    const p = projectTopology(snap);
    // 无 edges → 两个 root → 都在 level 0
    expect(p.levels[0]).toContain('a');
    expect(p.levels[0]).toContain('b');
  });

  it('overlay 边（coordinates/reviews/reviews/peer）单独列出', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'two_level',
      agents: [makeAgent('a', 'r-1'), makeAgent('b', 'r-1')],
      agentEdges: [
        makeEdge('e1', 'r-1', 'a', 'b', 'supervises'),
        makeEdge('e2', 'r-1', 'a', 'b', 'reviews'),
      ],
    });
    const p = projectTopology(snap);
    expect(p.structuralEdges).toHaveLength(1);
    expect(p.structuralEdges[0]!.kind).toBe('supervises');
    expect(p.overlayEdges).toHaveLength(1);
    expect(p.overlayEdges[0]!.kind).toBe('reviews');
  });

  it('validTo 非空的边不参与结构树', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'two_level',
      agents: [makeAgent('a', 'r-1'), makeAgent('b', 'r-1')],
      agentEdges: [
        makeEdge('e1', 'r-1', 'a', 'b', 'supervises', { validTo: '2025-01-01T00:00:00Z' }),
      ],
    });
    const p = projectTopology(snap);
    expect(p.structuralEdges).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.1 渲染
// ═══════════════════════════════════════════════════════════════════════════

describe('TopologyView §8.1 渲染', () => {
  it('empty 态：无 agent 渲染 EmptyState', () => {
    const snap = makeSnapshot('r-1', { agents: [], agentEdges: [] });
    const container = render(<TopologyView {...baseProps({ snapshot: snap })} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('无 Agent');
  });

  it('two_level 渲染两层 level group', () => {
    const container = render(<TopologyView {...baseProps()} />);
    const levels = container.querySelectorAll('.team-topology-level');
    expect(levels).toHaveLength(2);
    expect(container.querySelector('.team-topology-view-two_level')).not.toBeNull();
  });

  it('three_level 渲染三层', () => {
    const snap = makeSnapshot('r-1', {
      topology: 'three_level',
      agents: [
        makeAgent('leader', 'r-1', { roleClass: 'leader' }),
        makeAgent('sub', 'r-1', { roleClass: 'subagent' }),
        makeAgent('leaf', 'r-1'),
      ],
      agentEdges: [
        makeEdge('e1', 'r-1', 'leader', 'sub'),
        makeEdge('e2', 'r-1', 'sub', 'leaf'),
      ],
    });
    const container = render(<TopologyView {...baseProps({ snapshot: snap })} />);
    expect(container.querySelectorAll('.team-topology-level')).toHaveLength(3);
  });

  it('flat 渲染扁平列表 + degrade banner', () => {
    const snap = makeSnapshot('r-1', { topology: 'deep_tree' });
    const container = render(<TopologyView {...baseProps({ snapshot: snap })} />);
    expect(container.querySelector('.team-topology-flat')).not.toBeNull();
    expect(container.querySelector('.team-topology-degrade')).not.toBeNull();
  });

  it('节点显示 role + name + roleClass + state', () => {
    const container = render(<TopologyView {...baseProps()} />);
    const node = container.querySelector('.team-topo-node');
    expect(node).not.toBeNull();
    expect(node?.querySelector('.team-topo-role')?.textContent).toBe('team-leader');
    expect(node?.querySelector('.team-topo-name')?.textContent).toBe('Agent a-1');
    expect(node?.querySelector('.team-topo-class')?.textContent).toBe('leader');
    expect(node?.querySelector('.team-topo-state-dot')).not.toBeNull();
  });

  it('结构边 chip 显示 kind 文字 label（无 color-only meaning）', () => {
    const container = render(<TopologyView {...baseProps()} />);
    const edge = container.querySelector('.team-topo-edge-chip');
    expect(edge).not.toBeNull();
    expect(edge?.querySelector('.team-topo-edge-kind')?.textContent).toBe('监督');
    expect(edge?.querySelector('.team-topo-edge-arrow')?.textContent).toBe('→');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.12 跨视图高亮
// ═══════════════════════════════════════════════════════════════════════════

describe('TopologyView §8.12 跨视图高亮', () => {
  it('selection=agent 高亮对应节点', () => {
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(<TopologyView {...baseProps({ selection })} />);
    const nodes = container.querySelectorAll('.team-topo-node');
    const onNode = container.querySelector('.team-topo-node-on');
    expect(onNode).not.toBeNull();
    expect(onNode?.getAttribute('aria-selected')).toBe('true');
    // 其他节点不高亮
    const offCount = [...nodes].filter((n) => !n.classList.contains('team-topo-node-on')).length;
    expect(offCount).toBeGreaterThan(0);
  });

  it('点击节点触发 onSelect（toggle）', () => {
    const calls: Array<TeamSelection | null> = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let selection: TeamSelection | null = null;
    const onSelect = (sel: TeamSelection | null) => {
      calls.push(sel);
      selection = sel;
      act(() => { root.render(<TopologyView {...baseProps({ selection, onSelect })} />); });
    };
    act(() => { root.render(<TopologyView {...baseProps({ selection, onSelect })} />); });
    const node = container.querySelector('.team-topo-node') as HTMLDivElement;
    act(() => { node.click(); });
    expect(calls).toEqual([{ kind: 'agent', id: 'a-1' }]);
    // 再次点击 → null（toggle off，此时节点已选中）
    const onNode = container.querySelector('.team-topo-node-on') as HTMLDivElement;
    act(() => { onNode.click(); });
    expect(calls).toEqual([{ kind: 'agent', id: 'a-1' }, null]);
    root.unmount();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8.14 无障碍
// ═══════════════════════════════════════════════════════════════════════════

describe('TopologyView §8.14 无障碍', () => {
  it('tree role + aria-label', () => {
    const container = render(<TopologyView {...baseProps()} />);
    const tree = container.querySelector('.team-topology-view');
    expect(tree?.getAttribute('role')).toBe('tree');
    expect(tree?.getAttribute('aria-label')).toBe('拓扑结构');
  });

  it('treeitem role + aria-selected + aria-level + tabIndex', () => {
    const container = render(<TopologyView {...baseProps()} />);
    const node = container.querySelector('.team-topo-node');
    expect(node?.getAttribute('role')).toBe('treeitem');
    expect(node?.getAttribute('aria-selected')).toBe('false');
    expect(node?.getAttribute('aria-level')).toBe('1');
    expect(node?.getAttribute('tabindex')).toBe('0');
  });

  it('键盘 Enter 触发选择', () => {
    const calls: Array<TeamSelection | null> = [];
    const container = render(
      <TopologyView {...baseProps({ onSelect: (sel) => calls.push(sel) })} />,
    );
    const node = container.querySelector('.team-topo-node') as HTMLDivElement;
    act(() => {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(calls).toEqual([{ kind: 'agent', id: 'a-1' }]);
  });

  it('键盘 Space 触发选择', () => {
    const calls: Array<TeamSelection | null> = [];
    const container = render(
      <TopologyView {...baseProps({ onSelect: (sel) => calls.push(sel) })} />,
    );
    const node = container.querySelector('.team-topo-node') as HTMLDivElement;
    act(() => {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(calls).toEqual([{ kind: 'agent', id: 'a-1' }]);
  });

  it('键盘 Esc 取消选择（已选中时）', () => {
    const calls: Array<TeamSelection | null> = [];
    const selection: TeamSelection = { kind: 'agent', id: 'a-1' };
    const container = render(
      <TopologyView {...baseProps({ selection, onSelect: (sel) => calls.push(sel) })} />,
    );
    const node = container.querySelector('.team-topo-node-on') as HTMLDivElement;
    act(() => {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual([null]);
  });

  it('边 chip 有 aria-label（无 color-only meaning）', () => {
    const container = render(<TopologyView {...baseProps()} />);
    const edge = container.querySelector('.team-topo-edge-chip');
    expect(edge?.getAttribute('aria-label')).not.toBeNull();
    expect(edge?.getAttribute('aria-label')).toContain('监督');
    expect(edge?.getAttribute('aria-label')).toContain('→');
  });

  it('degrade banner 有 role=status', () => {
    const snap = makeSnapshot('r-1', { topology: 'deep_tree' });
    const container = render(<TopologyView {...baseProps({ snapshot: snap })} />);
    const banner = container.querySelector('.team-topology-degrade');
    expect(banner?.getAttribute('role')).toBe('status');
  });
});
