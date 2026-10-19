/**
 * Team topology derivation (add-agent-team-observability §5.1–5.4, design D5).
 *
 * 纯函数模块：只接收规范输入、输出规范类型，不读 DB、不发请求、不写文件。
 * 拓扑分类精确为 two_level / three_level / deep_tree / peer_graph / hybrid /
 * unknown，只由 normalized edges 推导，绝不按 provider 名假设（G12.1）。
 *
 * 证据过滤与 completeness 传播相互独立（design D4）：
 * - 过滤：native/correlated 默认，inferred 是可选 overlay；
 * - completeness：九维独立报告，conflicted 只来自显式冲突，不因过滤改变。
 */
import type {
  CompletenessLevel,
  EvidenceConfidence,
  EvidenceDimension,
  TeamAgent,
  TeamAgentEdge,
  TeamAgentEdgeKind,
  TeamAnomaly,
  TeamCompleteness,
  TeamTopologyKind,
} from './trace-types.js';

/** 九个证据维度（data-model §12.1；九维独立报告，闭合集合）。 */
export const EVIDENCE_DIMENSIONS: readonly EvidenceDimension[] = [
  'topology',
  'tasks',
  'communication',
  'timing',
  'tools',
  'outputs',
  'tokens',
  'cost',
  'verification',
] as const;

/** 拓扑由 created / supervises 推导（design D5）。 */
export const STRUCTURAL_EDGE_KINDS: readonly TeamAgentEdgeKind[] = [
  'created',
  'supervises',
] as const;

/** 覆盖层边（coordinates/reviews/replaces/peer）不静默改变父边（design D5）。 */
export const OVERLAY_EDGE_KINDS: readonly TeamAgentEdgeKind[] = [
  'coordinates',
  'reviews',
  'replaces',
  'peer',
] as const;

/** 拓扑校验发现的异常 kind 集合（闭合；只报告不修复，design D5/D6）。 */
export const TOPOLOGY_ANOMALY_KINDS = [
  'missing_node',
  'self_edge',
  'duplicate_edge',
  'valid_time_invalid',
  'cycle',
  'multi_root',
  'multi_parent',
] as const;

export type TopologyAnomalyKind = (typeof TOPOLOGY_ANOMALY_KINDS)[number];

// ── §5.1 证据过滤 ────────────────────────────────────────────

export interface EvidenceFilterOptions {
  /** 是否包含 inferred 证据（默认 false：只保留 native + correlated）。 */
  includeInferred?: boolean;
}

/**
 * 证据过滤：默认保留 native + correlated，inferred 是可选 overlay。
 * `unavailable` 事实本就不作为实体存在，恒被过滤。
 */
export function filterByConfidence<T extends { confidence: EvidenceConfidence }>(
  items: readonly T[],
  options: EvidenceFilterOptions = {},
): T[] {
  const includeInferred = options.includeInferred === true;
  const result: T[] = [];
  for (const item of items) {
    if (item.confidence === 'native' || item.confidence === 'correlated') {
      result.push(item);
    } else if (item.confidence === 'inferred' && includeInferred) {
      result.push(item);
    }
  }
  return result;
}

// ── §5.1 completeness 传播 ──────────────────────────────────

export interface CompletenessDimensionInput {
  dimension: EvidenceDimension;
  /** 是否观测到至少一条 native/correlated 证据（过滤后）。 */
  hasEvidence: boolean;
  /** 是否存在冲突的 native/correlated 事实（如多父/环/矛盾状态）。 */
  conflicted: boolean;
  /** 是否完整覆盖该维度的期望事实（adapter capability 声明）。 */
  complete: boolean;
}

/**
 * 单维度 completeness 推导（design D4）：
 * 无证据 → unavailable；冲突 → conflicted；完整 → complete；否则 partial。
 * 冲突优先于完整：conflicting native/correlated facts coexist 时标记 conflicted。
 */
export function resolveCompletenessLevel(input: CompletenessDimensionInput): CompletenessLevel {
  if (!input.hasEvidence) {
    return 'unavailable';
  }
  if (input.conflicted) {
    return 'conflicted';
  }
  if (input.complete) {
    return 'complete';
  }
  return 'partial';
}

/**
 * 九维 completeness 独立传播。缺省的维度一律 `unavailable`（禁止用空当作零，
 * evidence §6）。
 */
export function computeTeamCompleteness(
  inputs: readonly CompletenessDimensionInput[],
): TeamCompleteness {
  const result = {} as TeamCompleteness;
  for (const dimension of EVIDENCE_DIMENSIONS) {
    const found = inputs.find((input) => input.dimension === dimension);
    result[dimension] = found ? resolveCompletenessLevel(found) : 'unavailable';
  }
  return result;
}

// ── §5.2/5.3 拓扑校验与分类 ─────────────────────────────────

export interface TopologyTimeSlice {
  /** 切片窗口起点（ISO，含）；null = 无下界。 */
  from: string | null;
  /** 切片窗口终点（ISO，含）；null = 无上界。 */
  to: string | null;
}

export interface TopologyInput {
  agents: readonly TeamAgent[];
  edges: readonly TeamAgentEdge[];
  /** 可选 valid-time 切片（membership/relationship 版本化，design D5）。 */
  timeSlice?: TopologyTimeSlice;
  /**
   * 标记为 material 的 overlay 边 id。material = 该边链接到 task / handoff /
   * review / blocker / result（design D5）；mere heartbeat/status chatter 不算。
   * 未提供时 overlay 边一律视为非 material，tree 不会被重新分类为 hybrid。
   */
  materialOverlayEdgeIds?: ReadonlySet<string>;
  /** 是否包含 inferred 证据（默认 false）。 */
  includeInferred?: boolean;
}

export interface TopologyResult {
  kind: TeamTopologyKind;
  anomalies: TeamAnomaly[];
  /** 过滤 + 切片后的全部边。 */
  activeEdges: TeamAgentEdge[];
  /** structural（created/supervises）边。 */
  structuralEdges: TeamAgentEdge[];
  /** overlay 边。 */
  overlayEdges: TeamAgentEdge[];
  /** 结构根（无 structural 入边的 agent id），按 id 升序稳定。 */
  roots: string[];
  /** agentId → level（根为 1）。仅当分类为 tree/hybrid 时有意义。 */
  levels: ReadonlyMap<string, number>;
}

function anomaly(
  kind: TopologyAnomalyKind,
  message: string,
  entityIds: string[],
  evidenceIds: string[],
  severity: 'info' | 'warning' = 'warning',
): TeamAnomaly {
  return { kind, dimension: 'topology', severity, message, entityIds, evidenceIds };
}

/** valid-time 切片：边在窗口内 active 即保留（design D5，versioned edges）。 */
function sliceEdges(
  edges: readonly TeamAgentEdge[],
  timeSlice: TopologyTimeSlice | undefined,
): TeamAgentEdge[] {
  if (!timeSlice) {
    return [...edges];
  }
  return edges.filter((edge) => {
    if (timeSlice.from !== null && edge.validTo !== null && edge.validTo < timeSlice.from) {
      return false;
    }
    if (timeSlice.to !== null && edge.validFrom !== null && edge.validFrom > timeSlice.to) {
      return false;
    }
    return true;
  });
}

/** 有向环检测（DFS 三色标记），返回环内节点 id（空 = 无环）。 */
function findCycleNodes(
  edges: readonly { fromAgentId: string; toAgentId: string }[],
  nodeIds: ReadonlySet<string>,
): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.fromAgentId === edge.toAgentId) {
      continue;
    }
    const list = adjacency.get(edge.fromAgentId) ?? [];
    list.push(edge.toAgentId);
    adjacency.set(edge.fromAgentId, list);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const dfs = (node: string): boolean => {
    color.set(node, GRAY);
    stack.push(node);
    const neighbors = (adjacency.get(node) ?? []).slice().sort();
    for (const next of neighbors) {
      if (!nodeIds.has(next)) {
        continue;
      }
      const c = color.get(next) ?? WHITE;
      if (c === WHITE) {
        if (dfs(next)) {
          return true;
        }
      } else if (c === GRAY) {
        // 找到环：回溯栈中从 next 开始的部分
        return true;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return false;
  };

  const orderedNodes = [...nodeIds].sort();
  for (const node of orderedNodes) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      if (dfs(node)) {
        return stack;
      }
    }
  }
  return [];
}

/** BFS 从根计算 level（根=1），返回 agentId → level。 */
function computeLevels(
  edges: readonly TeamAgentEdge[],
  rootId: string,
): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromAgentId) ?? [];
    list.push(edge.toAgentId);
    adjacency.set(edge.fromAgentId, list);
  }
  const levels = new Map<string, number>();
  levels.set(rootId, 1);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current)!;
    const children = (adjacency.get(current) ?? []).slice().sort();
    for (const child of children) {
      const existing = levels.get(child);
      const nextLevel = currentLevel + 1;
      if (existing === undefined || nextLevel < existing) {
        levels.set(child, nextLevel);
        queue.push(child);
      }
    }
  }
  return levels;
}

/**
 * 拓扑校验 + 六类分类（design D5）。只由 normalized edges 推导，绝不假设 provider。
 *
 * 算法：
 * 1. 过滤（native/correlated 默认）+ valid-time 切片；
 * 2. 校验缺节点 / 自环 / 重边 / valid-time 无效 / 环 / 多根 / 多父；
 * 3. structural 边缺失：有 peer → peer_graph；否则 unknown；
 * 4. 单根、无环、单父 = 树，按占用 level 数分类 two/three/deep_tree；
 * 5. 有效树 + material overlay 边 → hybrid；
 * 6. 环 / 不可调和多根 / 多父冲突 → unknown 并输出 anomaly。
 */
export function classifyTopology(input: TopologyInput): TopologyResult {
  const filtered = filterByConfidence(input.edges, {
    includeInferred: input.includeInferred,
  });
  const activeEdges = sliceEdges(filtered, input.timeSlice);
  const agentIds = new Set(input.agents.map((agent) => agent.id));

  const structuralEdges = activeEdges.filter((edge) =>
    STRUCTURAL_EDGE_KINDS.includes(edge.kind as TeamAgentEdgeKind),
  );
  const overlayEdges = activeEdges.filter((edge) =>
    OVERLAY_EDGE_KINDS.includes(edge.kind as TeamAgentEdgeKind),
  );

  const anomalies: TeamAnomaly[] = [];

  // 缺节点（引用不存在的 agent）
  for (const edge of activeEdges) {
    const missing: string[] = [];
    if (!agentIds.has(edge.fromAgentId)) {
      missing.push(edge.fromAgentId);
    }
    if (!agentIds.has(edge.toAgentId)) {
      missing.push(edge.toAgentId);
    }
    if (missing.length > 0) {
      anomalies.push(
        anomaly('missing_node', `edge references unknown agent(s)`, missing, edge.evidenceIds),
      );
    }
  }

  // valid-time 无效（validFrom > validTo）
  for (const edge of activeEdges) {
    if (
      edge.validFrom !== null &&
      edge.validTo !== null &&
      edge.validFrom > edge.validTo
    ) {
      anomalies.push(
        anomaly(
          'valid_time_invalid',
          `edge validFrom > validTo (${edge.validFrom} > ${edge.validTo})`,
          [edge.id],
          edge.evidenceIds,
        ),
      );
    }
  }

  // structural 自环 / 重边
  const structuralByKey = new Map<string, TeamAgentEdge[]>();
  for (const edge of structuralEdges) {
    if (edge.fromAgentId === edge.toAgentId) {
      anomalies.push(
        anomaly('self_edge', 'structural self-edge', [edge.id], edge.evidenceIds),
      );
      continue;
    }
    const key = `${edge.fromAgentId}\u0000${edge.toAgentId}\u0000${edge.kind}`;
    const bucket = structuralByKey.get(key) ?? [];
    bucket.push(edge);
    structuralByKey.set(key, bucket);
  }
  for (const [key, bucket] of structuralByKey) {
    if (bucket.length > 1) {
      const ids = bucket.map((edge) => edge.id);
      const [from, to] = key.split('\u0000') as [string, string, string];
      anomalies.push(
        anomaly(
          'duplicate_edge',
          `duplicate structural edge ${from} -> ${to}`,
          ids,
          bucket.flatMap((edge) => edge.evidenceIds),
          'info',
        ),
      );
    }
  }

  // 多父冲突（同一 child 有多个 active structural 父）
  const parents = new Map<string, string[]>();
  for (const edge of structuralEdges) {
    if (edge.fromAgentId === edge.toAgentId) {
      continue;
    }
    const list = parents.get(edge.toAgentId) ?? [];
    list.push(edge.fromAgentId);
    parents.set(edge.toAgentId, list);
  }
  const hasMultiParent = [...parents.values()].some((list) => list.length > 1);
  if (hasMultiParent) {
    for (const [child, parentList] of parents) {
      if (parentList.length > 1) {
        anomalies.push(
          anomaly(
            'multi_parent',
            `agent ${child} has multiple active structural parents`,
            [child, ...parentList],
            [],
          ),
        );
      }
    }
  }

  // 环检测（structural，忽略自环）
  const cycleNodes = findCycleNodes(structuralEdges, agentIds);
  const hasCycle = cycleNodes.length > 0;
  if (hasCycle) {
    anomalies.push(
      anomaly('cycle', 'structural edge cycle detected', cycleNodes, []),
    );
  }

  // 根检测（无 structural 入边）
  const inDegree = new Map<string, number>();
  for (const edge of structuralEdges) {
    if (edge.fromAgentId === edge.toAgentId) {
      continue;
    }
    inDegree.set(edge.toAgentId, (inDegree.get(edge.toAgentId) ?? 0) + 1);
  }
  const roots = [...agentIds]
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort();

  // structural 边缺失：peer → peer_graph；否则 unknown。
  if (structuralEdges.length === 0) {
    const hasPeer = overlayEdges.some((edge) => edge.kind === 'peer');
    return {
      kind: hasPeer ? 'peer_graph' : 'unknown',
      anomalies,
      activeEdges,
      structuralEdges,
      overlayEdges,
      roots,
      levels: new Map(),
    };
  }

  const hasMultiRoot = roots.length > 1;
  if (hasMultiRoot) {
    anomalies.push(
      anomaly('multi_root', `irreconcilable structural roots`, roots, []),
    );
  }

  // 环 / 多根 / 多父冲突 → unknown。
  if (hasCycle || hasMultiRoot || hasMultiParent) {
    return {
      kind: 'unknown',
      anomalies,
      activeEdges,
      structuralEdges,
      overlayEdges,
      roots,
      levels: new Map(),
    };
  }

  // 有效树：单根、无环、单父。
  const rootId = roots[0]!;
  const levels = computeLevels(structuralEdges, rootId);
  const occupiedLevels = levels.size === 0 ? 0 : Math.max(...levels.values());

  let kind: TeamTopologyKind;
  if (occupiedLevels === 2) {
    kind = 'two_level';
  } else if (occupiedLevels === 3) {
    kind = 'three_level';
  } else if (occupiedLevels > 3) {
    kind = 'deep_tree';
  } else {
    // 只有根自身（occupiedLevels === 1）：非团队结构。
    kind = 'unknown';
  }

  // material overlay 边 → hybrid（design D5：覆盖层不静默改变父边，但 material 覆盖层改变分类）。
  const materialOverlay = overlayEdges.filter((edge) =>
    (input.materialOverlayEdgeIds ?? new Set<string>()).has(edge.id),
  );
  if (kind !== 'unknown' && materialOverlay.length > 0) {
    kind = 'hybrid';
  }

  return {
    kind,
    anomalies,
    activeEdges,
    structuralEdges,
    overlayEdges,
    roots,
    levels,
  };
}
