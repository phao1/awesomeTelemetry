/**
 * agent-collaboration-replay §4.1 / §8.1 — Sugiyama 风格分层布局纯函数。
 *
 * 输入 `TeamAgent[]` + `TeamAgentEdge[]`，输出节点坐标 + 边路径，供
 * `TopologyGraph` 渲染原生 SVG。纯函数，无副作用，无 DOM 依赖。
 *
 * 算法步骤：
 * 1. **分层**：仅用 `created` / `supervises` 结构边构建 DAG；BFS 从 root 分配 level
 * 2. **排序**：同层节点按 `displayName` 字典序排列（稳定排序）
 * 3. **坐标**：节点为圆角矩形卡片，(x, y) 为左上角；y = padding + level * levelGap；
 *    同层节点等距排列 + 同层整体居中对齐父层中心
 * 4. **节点尺寸**：width = max(cardMinWidth, displayName.length * 8 + 16)，
 *    height = cardHeight（spec §8.1.1 规则 1-2，文本不截断）
 * 5. **边路径**：三次贝塞尔曲线，起点 = 父节点底部中点 (x + width/2, y + height)，
 *    终点 = 子节点顶部中点 (x + width/2, y)，控制点在两层中点
 * 6. **尺寸**：width / height 由最大层宽 × level 数推导
 *
 * 降级处理：
 * - 环检测 → 断开成环的边，加 `degraded` 标记（不静默修复，§8.2）
 * - 孤立节点（无边）→ 放在最底层
 * - 空 agents → 返回 `width=0, height=0`
 *
 * 复用 `TopologyView.tsx` 的 DFS 环检测思路（§8.1），但本模块为纯几何计算，
 * 不依赖 React / snapshot，可独立测试。
 */

import type { TeamAgent, TeamAgentEdge, TeamAgentEdgeKind } from '../../core/trace-types.js';

// ── 常量 ──────────────────────────────────────────────────────

/** 仅 created / supervises 边参与结构树（design D5，与 TopologyView 一致）。 */
const STRUCTURAL_EDGE_KINDS: ReadonlySet<TeamAgentEdgeKind> = new Set(['created', 'supervises']);

/** active 边（validTo === null）。 */
function isActiveEdge(edge: TeamAgentEdge): boolean {
  return edge.validTo === null;
}

/** 默认布局参数（spec §8.1 / design §3.1.3）。 */
const DEFAULT_LEVEL_GAP = 100;
const DEFAULT_NODE_GAP = 160;
const DEFAULT_CARD_MIN_WIDTH = 80;
const DEFAULT_CARD_HEIGHT = 44;
const PADDING = 40;
/** 每字符近似宽度（px），用于卡片宽度自适应。 */
const CHAR_WIDTH = 8;
/** 卡片内边距（左右合计，px）。 */
const CARD_TEXT_PADDING = 16;

// ── 公开类型 ─────────────────────────────────────────────────

export interface LayoutNode {
  agentId: string;
  /** 左上角 x（原为圆心 x，§8.1 改为左上角）。 */
  x: number;
  /** 左上角 y（原为圆心 y，§8.1 改为左上角）。 */
  y: number;
  /** 卡片宽度（按 displayName 自适应，spec §8.1.1 规则 1-2）。 */
  width: number;
  /** 卡片高度（固定 2 行：name + badge，spec §8.1.1 规则 3）。 */
  height: number;
  /** 0 = root，递增向下。 */
  level: number;
}

export interface LayoutEdge {
  edge: TeamAgentEdge;
  /** SVG path d 属性（三次贝塞尔）。 */
  path: string;
  /** 消息计数标签位置（边中点）。 */
  midpoint: { x: number; y: number };
  /** 环检测断开的边标记。 */
  degraded: boolean;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** 层间距，默认 100（原 120，卡片高度 44 < 圆直径 64，可收紧）。 */
  levelGap?: number;
  /** 同层节点间距，默认 160。 */
  nodeGap?: number;
  /** 卡片最小宽度，默认 80。 */
  cardMinWidth?: number;
  /** 卡片高度，默认 44。 */
  cardHeight?: number;
}

// ── 辅助：结构边推导 ─────────────────────────────────────────

function isStructuralActiveEdge(edge: TeamAgentEdge): boolean {
  return STRUCTURAL_EDGE_KINDS.has(edge.kind) && isActiveEdge(edge);
}

/** parent → children 映射（仅结构 active 边）。 */
function deriveChildrenMap(
  agentIds: Set<string>,
  edges: readonly TeamAgentEdge[],
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!isStructuralActiveEdge(edge)) {
      continue;
    }
    if (!agentIds.has(edge.fromAgentId) || !agentIds.has(edge.toAgentId)) {
      continue;
    }
    const list = children.get(edge.fromAgentId);
    if (list === undefined) {
      children.set(edge.fromAgentId, [edge.toAgentId]);
    } else if (!list.includes(edge.toAgentId)) {
      list.push(edge.toAgentId);
    }
  }
  return children;
}

/** child → parents 映射（用于找 root）。 */
function deriveParentsMap(
  agentIds: Set<string>,
  edges: readonly TeamAgentEdge[],
): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if (!isStructuralActiveEdge(edge)) {
      continue;
    }
    if (!agentIds.has(edge.fromAgentId) || !agentIds.has(edge.toAgentId)) {
      continue;
    }
    const list = parents.get(edge.toAgentId);
    if (list === undefined) {
      parents.set(edge.toAgentId, [edge.fromAgentId]);
    } else if (!list.includes(edge.fromAgentId)) {
      list.push(edge.fromAgentId);
    }
  }
  return parents;
}

// ── 环检测（DFS，复用 TopologyView §8.1 思路） ───────────────

/**
 * DFS 检测环，返回环上的 agent id 序列或 null。
 * 同时返回参与环的结构边 id 集合（用于标记 degraded）。
 */
function detectCycleEdges(
  agentIds: Set<string>,
  childrenMap: Map<string, string[]>,
  edges: readonly TeamAgentEdge[],
): Set<string> {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of agentIds) {
    color.set(id, WHITE);
  }
  const stack: string[] = [];
  const cycleEdgeIds = new Set<string>();

  // 构建 (from, to) → edgeId 索引，用于定位环边
  const edgeIndex = new Map<string, string>();
  for (const edge of edges) {
    if (isStructuralActiveEdge(edge)) {
      edgeIndex.set(`${edge.fromAgentId}\u0001${edge.toAgentId}`, edge.id);
    }
  }

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    stack.push(id);
    const children = childrenMap.get(id) ?? [];
    for (const childId of children) {
      const c = color.get(childId);
      if (c === GRAY) {
        // 找到环：标记环上所有边
        const idx = stack.indexOf(childId);
        const cyclePath = stack.slice(idx);
        for (let i = 0; i < cyclePath.length; i += 1) {
          const from = cyclePath[i]!;
          const to = cyclePath[(i + 1) % cyclePath.length]!;
          const edgeId = edgeIndex.get(`${from}\u0001${to}`);
          if (edgeId !== undefined) {
            cycleEdgeIds.add(edgeId);
          }
        }
        // 也标记当前 id → childId 这条边
        const closingEdgeId = edgeIndex.get(`${id}\u0001${childId}`);
        if (closingEdgeId !== undefined) {
          cycleEdgeIds.add(closingEdgeId);
        }
        return true;
      }
      if (c === WHITE && dfs(childId)) {
        return true;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return false;
  }

  for (const id of agentIds) {
    if (color.get(id) === WHITE) {
      if (dfs(id)) {
        break;
      }
    }
  }
  return cycleEdgeIds;
}

// ── BFS 分层 ─────────────────────────────────────────────────

/** 找 root 节点（无结构父的 agent）。 */
function findRoots(agentIds: Set<string>, parentsMap: Map<string, string[]>): string[] {
  const roots: string[] = [];
  for (const id of agentIds) {
    if ((parentsMap.get(id) ?? []).length === 0) {
      roots.push(id);
    }
  }
  return roots;
}

/**
 * BFS 计算每个 agent 的 level（从 roots 出发）。
 * 孤立节点（不在任何结构边中）单独处理：放在最底层。
 */
function computeLevels(
  agents: readonly TeamAgent[],
  childrenMap: Map<string, string[]>,
  parentsMap: Map<string, string[]>,
  _degradedEdgeIds: Set<string>,
): Map<string, number> {
  // 构建不含 degraded 边的 children/parents
  const cleanChildren = new Map<string, string[]>();
  const cleanParents = new Map<string, string[]>();
  for (const [from, tos] of childrenMap) {
    cleanChildren.set(from, tos);
  }
  for (const [to, froms] of parentsMap) {
    cleanParents.set(to, froms);
  }

  const roots = findRoots(new Set(agents.map((a) => a.id)), cleanParents);
  const levels = new Map<string, number>();
  const queue: Array<{ id: string; level: number }> = roots.map((r) => ({ id: r, level: 0 }));
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    const existing = levels.get(id);
    if (existing !== undefined && existing <= level) {
      continue;
    }
    levels.set(id, level);
    const children = cleanChildren.get(id) ?? [];
    for (const childId of children) {
      queue.push({ id: childId, level: level + 1 });
    }
  }

  // 找最大 level（已分层节点中）
  let maxLevel = 0;
  for (const l of levels.values()) {
    if (l > maxLevel) maxLevel = l;
  }

  // 孤立节点（既无父也无子，且未被 BFS 访问）放在最底层
  for (const agent of agents) {
    if (!levels.has(agent.id)) {
      const hasParent = (cleanParents.get(agent.id) ?? []).length > 0;
      const hasChild = (cleanChildren.get(agent.id) ?? []).length > 0;
      if (!hasParent && !hasChild) {
        // 真正孤立的节点：若已有分层节点，放最底层 +1；否则 level 0
        levels.set(agent.id, levels.size > 0 ? maxLevel + 1 : 0);
      } else {
        // 有边但未被访问（可能因 degraded 断开）→ 兜底放最底层
        levels.set(agent.id, maxLevel + 1);
      }
    }
  }

  return levels;
}

// ── 卡片宽度自适应（spec §8.1.1 规则 1-2） ───────────────────

/**
 * 节点宽度按 displayName 自适应：`max(cardMinWidth, displayName.length * 8 + 16)`。
 * 文本不截断，节点宽度随文本扩展（design §3.1.2）。
 */
export function computeCardWidth(displayName: string, cardMinWidth: number): number {
  return Math.max(cardMinWidth, displayName.length * CHAR_WIDTH + CARD_TEXT_PADDING);
}

// ── 主函数 ───────────────────────────────────────────────────

/**
 * 计算 Sugiyama 风格分层布局。
 *
 * 纯函数：相同输入 → 相同输出，无副作用，无 DOM 依赖。
 * 空 agents → `{ nodes: [], edges: [], width: 0, height: 0 }`。
 */
export function computeLayout(
  agents: readonly TeamAgent[],
  edges: readonly TeamAgentEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  if (agents.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const levelGap = options.levelGap ?? DEFAULT_LEVEL_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const cardMinWidth = options.cardMinWidth ?? DEFAULT_CARD_MIN_WIDTH;
  const cardHeight = options.cardHeight ?? DEFAULT_CARD_HEIGHT;

  const agentIds = new Set(agents.map((a) => a.id));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  // 1. 环检测 → 标记 degraded 边
  const childrenMap = deriveChildrenMap(agentIds, edges);
  const parentsMap = deriveParentsMap(agentIds, edges);
  const degradedEdgeIds = detectCycleEdges(agentIds, childrenMap, edges);

  // 2. 分层（不含 degraded 边）
  const levels = computeLevels(agents, childrenMap, parentsMap, degradedEdgeIds);

  // 3. 按 level 分组 + 同层按 displayName 字典序排列（稳定排序）
  const maxLevel = Math.max(...levels.values());
  const levelGroups: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const agent of agents) {
    const lvl = levels.get(agent.id) ?? 0;
    levelGroups[lvl]!.push(agent.id);
  }
  for (const group of levelGroups) {
    group.sort((a, b) => {
      const na = agentById.get(a)?.displayName ?? a;
      const nb = agentById.get(b)?.displayName ?? b;
      return na.localeCompare(nb);
    });
  }

  // 4. 计算每个节点的卡片宽度
  const cardWidthById = new Map<string, number>();
  for (const agent of agents) {
    cardWidthById.set(agent.id, computeCardWidth(agent.displayName, cardMinWidth));
  }

  // 5. 计算坐标：每层整体居中对齐父层中心
  //    同层节点等距排列，间距取 nodeGap（同层最宽节点之间的水平间距）
  //    每层整体水平居中：以最大层总宽为画布宽，其他层偏移使其中心对齐
  const layerTotalWidths = levelGroups.map((group) => {
    if (group.length === 0) return 0;
    const cardsWidth = group.reduce(
      (sum, id) => sum + (cardWidthById.get(id) ?? cardMinWidth),
      0,
    );
    // 节点之间留 nodeGap 间距
    return cardsWidth + (group.length - 1) * nodeGap;
  });
  const maxLayerWidth = Math.max(...layerTotalWidths);

  const nodes: LayoutNode[] = [];
  for (let lvl = 0; lvl < levelGroups.length; lvl += 1) {
    const group = levelGroups[lvl]!;
    const y = PADDING + lvl * levelGap;
    const layerWidth = layerTotalWidths[lvl] ?? 0;
    // 同层整体居中：偏移使本层中心对齐画布中心
    const xOffset = PADDING + (maxLayerWidth - layerWidth) / 2;
    let cursor = xOffset;
    for (let i = 0; i < group.length; i += 1) {
      const agentId = group[i]!;
      const w = cardWidthById.get(agentId) ?? cardMinWidth;
      nodes.push({ agentId, x: cursor, y, width: w, height: cardHeight, level: lvl });
      cursor += w + nodeGap;
    }
  }

  // 6. 生成边路径（三次贝塞尔，端点为卡片底部/顶部中点）
  const nodePos = new Map(nodes.map((n) => [n.agentId, n]));
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    const from = nodePos.get(edge.fromAgentId);
    const to = nodePos.get(edge.toAgentId);
    if (from === undefined || to === undefined) {
      continue;
    }
    const degraded = degradedEdgeIds.has(edge.id);
    // 起点 = 父节点底部中点 (x + width/2, y + height)
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height;
    // 终点 = 子节点顶部中点 (x + width/2, y)
    const endX = to.x + to.width / 2;
    const endY = to.y;
    // 控制点在两层中点
    const midY = (startY + endY) / 2;
    const path = `M ${startX},${startY} C ${startX},${midY} ${endX},${midY} ${endX},${endY}`;
    layoutEdges.push({
      edge,
      path,
      midpoint: { x: (startX + endX) / 2, y: midY },
      degraded,
    });
  }

  // 7. 尺寸
  const width = maxLayerWidth + 2 * PADDING;
  const height = (maxLevel + 1) * levelGap + cardHeight + 2 * PADDING - levelGap;

  return { nodes, edges: layoutEdges, width, height };
}
