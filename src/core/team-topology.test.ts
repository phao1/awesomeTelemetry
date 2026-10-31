import { describe, expect, it } from 'vitest';

import type {
  TeamAgent,
  TeamAgentEdge,
  TeamAgentEdgeKind,
} from './trace-types.js';
import {
  computeTeamCompleteness,
  filterByConfidence,
  classifyTopology,
  resolveCompletenessLevel,
} from './team-topology.js';

function agent(id: string, roleClass = 'teammate'): TeamAgent {
  return {
    id,
    runId: 'run1',
    nativeId: id,
    displayName: id,
    role: roleClass,
    roleClass,
    model: null,
    state: 'ready',
    createdAt: null,
    endedAt: null,
    sessionKeys: [],
    evidenceIds: [`ev-${id}`],
  };
}

function edge(
  id: string,
  fromAgentId: string,
  toAgentId: string,
  kind: TeamAgentEdgeKind,
  confidence: TeamAgentEdge['confidence'] = 'native',
  overrides: Partial<TeamAgentEdge> = {},
): TeamAgentEdge {
  return {
    id,
    runId: 'run1',
    fromAgentId,
    toAgentId,
    kind,
    validFrom: null,
    validTo: null,
    confidence,
    evidenceIds: [`ev-${id}`],
    ...overrides,
  };
}

describe('§5.1 证据过滤', () => {
  const edges = [
    edge('n', 'a', 'b', 'created', 'native'),
    edge('c', 'a', 'c', 'created', 'correlated'),
    edge('i', 'a', 'd', 'created', 'inferred'),
    edge('u', 'a', 'e', 'created', 'unavailable'),
  ];

  it('默认只保留 native + correlated', () => {
    const result = filterByConfidence(edges);
    expect(result.map((e) => e.id)).toEqual(['n', 'c']);
  });

  it('includeInferred 作为可选 overlay 加入 inferred', () => {
    const result = filterByConfidence(edges, { includeInferred: true });
    expect(result.map((e) => e.id)).toEqual(['n', 'c', 'i']);
  });

  it('unavailable 恒被排除', () => {
    const result = filterByConfidence(edges, { includeInferred: true });
    expect(result.map((e) => e.id)).not.toContain('u');
  });
});

describe('§5.1 completeness 传播', () => {
  it('无证据 → unavailable', () => {
    expect(resolveCompletenessLevel({ dimension: 'tasks', hasEvidence: false, conflicted: false, complete: false })).toBe('unavailable');
  });

  it('冲突优先于完整 → conflicted', () => {
    expect(resolveCompletenessLevel({ dimension: 'topology', hasEvidence: true, conflicted: true, complete: true })).toBe('conflicted');
  });

  it('完整无冲突 → complete；有证据但不完整 → partial', () => {
    expect(resolveCompletenessLevel({ dimension: 'tokens', hasEvidence: true, conflicted: false, complete: true })).toBe('complete');
    expect(resolveCompletenessLevel({ dimension: 'timing', hasEvidence: true, conflicted: false, complete: false })).toBe('partial');
  });

  it('九维独立传播，缺省维度为 unavailable', () => {
    const completeness = computeTeamCompleteness([
      { dimension: 'topology', hasEvidence: true, conflicted: false, complete: true },
    ]);
    expect(completeness.topology).toBe('complete');
    expect(completeness.tasks).toBe('unavailable');
    expect(completeness.cost).toBe('unavailable');
  });
});

describe('§5.2 拓扑校验', () => {
  it('缺节点', () => {
    const result = classifyTopology({
      agents: [agent('a')],
      edges: [edge('e1', 'a', 'ghost', 'created')],
    });
    expect(result.anomalies.some((a) => a.kind === 'missing_node')).toBe(true);
  });

  it('自环', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'a', 'created'), edge('e2', 'a', 'b', 'created')],
    });
    expect(result.anomalies.some((a) => a.kind === 'self_edge')).toBe(true);
  });

  it('重边', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [
        edge('e1', 'a', 'b', 'created'),
        edge('e2', 'a', 'b', 'created'),
      ],
    });
    expect(result.anomalies.some((a) => a.kind === 'duplicate_edge')).toBe(true);
  });

  it('valid-time 无效', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'created', 'native', { validFrom: '2026-01-10T00:00:00.000Z', validTo: '2026-01-01T00:00:00.000Z' })],
    });
    expect(result.anomalies.some((a) => a.kind === 'valid_time_invalid')).toBe(true);
  });

  it('环 → unknown', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'created'), edge('e2', 'b', 'a', 'supervises')],
    });
    expect(result.anomalies.some((a) => a.kind === 'cycle')).toBe(true);
    expect(result.kind).toBe('unknown');
  });

  it('多根 → unknown', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b'), agent('c'), agent('d')],
      edges: [edge('e1', 'a', 'b', 'created'), edge('e2', 'c', 'd', 'created')],
    });
    expect(result.anomalies.some((a) => a.kind === 'multi_root')).toBe(true);
    expect(result.kind).toBe('unknown');
  });

  it('多父冲突 → unknown', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b'), agent('c')],
      edges: [edge('e1', 'a', 'c', 'created'), edge('e2', 'b', 'c', 'created')],
    });
    expect(result.anomalies.some((a) => a.kind === 'multi_parent')).toBe(true);
    expect(result.kind).toBe('unknown');
  });

  it('valid-time 切片排除不活跃边', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'created', 'native', { validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-01-10T00:00:00.000Z' })],
      timeSlice: { from: '2026-02-01T00:00:00.000Z', to: null },
    });
    expect(result.structuralEdges).toHaveLength(0);
    expect(result.kind).toBe('unknown');
  });
});

describe('§5.3 六类分类', () => {
  it('two_level（root + 1 层）', () => {
    const result = classifyTopology({
      agents: [agent('a', 'leader'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'created')],
    });
    expect(result.kind).toBe('two_level');
    expect(result.levels.get('a')).toBe(1);
    expect(result.levels.get('b')).toBe(2);
  });

  it('three_level', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b'), agent('c')],
      edges: [edge('e1', 'a', 'b', 'created'), edge('e2', 'b', 'c', 'supervises')],
    });
    expect(result.kind).toBe('three_level');
  });

  it('deep_tree（>3 层）', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b'), agent('c'), agent('d')],
      edges: [
        edge('e1', 'a', 'b', 'created'),
        edge('e2', 'b', 'c', 'created'),
        edge('e3', 'c', 'd', 'created'),
      ],
    });
    expect(result.kind).toBe('deep_tree');
  });

  it('peer_graph（无 structural，有 peer）', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'peer')],
    });
    expect(result.kind).toBe('peer_graph');
  });

  it('unknown（无 structural 无 peer）', () => {
    const result = classifyTopology({ agents: [agent('a'), agent('b')], edges: [] });
    expect(result.kind).toBe('unknown');
  });

  it('hybrid（tree + material overlay）', () => {
    const result = classifyTopology({
      agents: [agent('a', 'leader'), agent('b'), agent('c')],
      edges: [
        edge('e1', 'a', 'b', 'created'),
        edge('e2', 'a', 'c', 'created'),
        edge('e3', 'b', 'c', 'peer'),
      ],
      materialOverlayEdgeIds: new Set(['e3']),
    });
    expect(result.kind).toBe('hybrid');
  });

  it('非 material overlay 不改变 tree 分类', () => {
    const result = classifyTopology({
      agents: [agent('a', 'leader'), agent('b'), agent('c')],
      edges: [
        edge('e1', 'a', 'b', 'created'),
        edge('e2', 'a', 'c', 'created'),
        edge('e3', 'b', 'c', 'peer'),
      ],
    });
    expect(result.kind).toBe('two_level');
  });
});

describe('§5.4 各类场景', () => {
  it('single-agent non-team → unknown', () => {
    const result = classifyTopology({ agents: [agent('a')], edges: [] });
    expect(result.kind).toBe('unknown');
  });

  it('直接 peer 通信 → peer_graph', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'peer'), edge('e2', 'b', 'a', 'peer')],
    });
    expect(result.kind).toBe('peer_graph');
  });

  it('时变 membership：成员边过期后降级 unknown', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'created', 'native', { validTo: '2026-01-01T00:00:00.000Z' })],
      timeSlice: { from: '2026-02-01T00:00:00.000Z', to: null },
    });
    expect(result.kind).toBe('unknown');
  });

  it('inferred 边默认排除，includeInferred 后恢复', () => {
    const base = {
      agents: [agent('a', 'leader'), agent('b')],
      edges: [edge('e1', 'a', 'b', 'created', 'inferred')],
    };
    expect(classifyTopology(base).kind).toBe('unknown');
    expect(classifyTopology({ ...base, includeInferred: true }).kind).toBe('two_level');
  });

  it('冲突（多父）→ unknown + anomaly', () => {
    const result = classifyTopology({
      agents: [agent('a'), agent('b'), agent('c')],
      edges: [edge('e1', 'a', 'c', 'created'), edge('e2', 'b', 'c', 'supervises')],
    });
    expect(result.kind).toBe('unknown');
    expect(result.anomalies.some((a) => a.kind === 'multi_parent')).toBe(true);
  });
});
