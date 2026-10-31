/**
 * add-agent-team-observability §8.1 / §8.10 / §8.13 / §8.14 —
 * TopologyView：拓扑投影可视化组件。
 *
 * 从 `TeamRunSnapshot.agents` + `agentEdges` 渲染层级图：
 * - **two_level**：leader 一行 + teammates 一行（两行）
 * - **three_level**：leader + subleaders + teammates（三行）
 * - **deep_tree / peer_graph / hybrid / unknown**：降级为带提示的扁平列表
 *   （G12.1：拓扑由 edges 推导，绝不按 provider 名假设；不伪造协作层）
 *
 * **跨视图高亮**（§8.12）：选中 agent 时节点高亮，纯 prop 传递，零请求。
 * **无障碍**（§8.14）：tree role、treeitem role、aria-selected、键盘
 * Enter/Space 选择、Esc 取消、focus-visible 轮廓、边 kind 用文字 label +
 * 颜色（无 color-only meaning）。
 * **无新 runtime dependency**：纯 React + 既有 ui/* + tokens.css。
 *
 * **i18n**：本组件需要的新键（edgeKind/agentState/confidence/topologyLevel
 * 等）不在 `src/i18n.ts` 现有键集合内，而任务约束禁止修改 i18n.ts
 * （不在 target_files 内）。故在此定义局部双语文字映射 `TT`，覆盖 zh/en，
 * 满足 AGENTS.md「All strings land in both locales」与无 color-only meaning。
 * 已有 team.* 键仍通过 `t()` 复用。
 */

import '../../styles/components/team.css';
import '../../styles/components/team-views.css';

import { useCallback, useMemo, useRef } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  EvidenceConfidence,
  TeamAgent,
  TeamAgentEdge,
  TeamAgentEdgeKind,
  TeamAgentState,
  TeamRunSnapshot,
  TeamTopologyKind,
} from '../../core/trace-types.js';
import { EmptyState } from '../ui/States.js';
import type { TeamSelection } from './team-client.js';

// ── 局部双语文字映射（不修改 i18n.ts，见文件头注释） ─────────

const TT = {
  edgeKind: {
    created: { zh: '创建', en: 'created' },
    supervises: { zh: '监督', en: 'supervises' },
    coordinates: { zh: '协调', en: 'coordinates' },
    reviews: { zh: '评审', en: 'reviews' },
    replaces: { zh: '替换', en: 'replaces' },
    peer: { zh: '对等', en: 'peer' },
  } as Record<TeamAgentEdgeKind, { zh: string; en: string }>,
  agentState: {
    created: { zh: '已创建', en: 'created' },
    ready: { zh: '就绪', en: 'ready' },
    busy: { zh: '忙碌', en: 'busy' },
    blocked: { zh: '阻塞', en: 'blocked' },
    idle: { zh: '空闲', en: 'idle' },
    failed: { zh: '失败', en: 'failed' },
    replaced: { zh: '已替换', en: 'replaced' },
    cancelled: { zh: '已取消', en: 'cancelled' },
    completed: { zh: '已完成', en: 'completed' },
    unknown: { zh: '未知', en: 'unknown' },
  } as Record<TeamAgentState, { zh: string; en: string }>,
  confidence: {
    native: { zh: '原生', en: 'native' },
    correlated: { zh: '关联', en: 'correlated' },
    inferred: { zh: '推断', en: 'inferred' },
    unavailable: { zh: '不可用', en: 'unavailable' },
  } as Record<EvidenceConfidence, { zh: string; en: string }>,
  topologyLevel: {
    0: { zh: '第 0 层（根）', en: 'Level 0 (root)' },
    1: { zh: '第 1 层', en: 'Level 1' },
    2: { zh: '第 2 层', en: 'Level 2' },
  } as Record<number, { zh: string; en: string }>,
  structuralEdges: { zh: '结构边', en: 'Structural edges' },
  overlayEdges: { zh: '覆盖边', en: 'Overlay edges' },
  degradeHint: { zh: '已降级为扁平列表，原始边保留供检查', en: 'Degraded to flat list; raw edges retained for inspection' },
  noInventedLayer: { zh: '不伪造协作层', en: 'No invented collaborative layer' },
} as const;

function tt(entry: { zh: string; en: string }, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en;
}

// ── §8.1 拓扑投影算法 ───────────────────────────────────────

/** 仅 created / supervises 边参与结构树（design D5）。 */
const STRUCTURAL_EDGE_KINDS: ReadonlySet<TeamAgentEdgeKind> = new Set(['created', 'supervises']);

/** active 边（validTo === null）。 */
function isActiveEdge(edge: TeamAgentEdge): boolean {
  return edge.validTo === null;
}

/**
 * 推导 parent → children 映射（仅结构边）。返回的 Map 不含空数组键。
 * 多父情况：child 出现在多个 parent 的 children 数组里（DAG 而非树）。
 */
function deriveChildrenMap(agents: TeamAgent[], edges: TeamAgentEdge[]): Map<string, string[]> {
  const agentIds = new Set(agents.map((a) => a.id));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!STRUCTURAL_EDGE_KINDS.has(edge.kind) || !isActiveEdge(edge)) {
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

/** 推导 child → parents 映射（用于找 root 与多父检测）。 */
function deriveParentsMap(agents: TeamAgent[], edges: TeamAgentEdge[]): Map<string, string[]> {
  const agentIds = new Set(agents.map((a) => a.id));
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if (!STRUCTURAL_EDGE_KINDS.has(edge.kind) || !isActiveEdge(edge)) {
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

/** 找根节点（无结构父的 agent）。可能多个（peer_graph / forest）。 */
function findRoots(agents: TeamAgent[], parentsMap: Map<string, string[]>): TeamAgent[] {
  return agents.filter((a) => (parentsMap.get(a.id) ?? []).length === 0);
}

/** BFS 计算每个 agent 的深度（从 roots 出发）。 */
function computeDepths(
  agents: TeamAgent[],
  childrenMap: Map<string, string[]>,
  roots: TeamAgent[],
): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = roots.map((r) => ({ id: r.id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const existing = depths.get(id);
    if (existing !== undefined && existing <= depth) {
      continue;
    }
    depths.set(id, depth);
    const children = childrenMap.get(id) ?? [];
    for (const childId of children) {
      queue.push({ id: childId, depth: depth + 1 });
    }
  }
  // 兜底：未访问到的 agent（孤立节点）深度 0
  for (const agent of agents) {
    if (!depths.has(agent.id)) {
      depths.set(agent.id, 0);
    }
  }
  return depths;
}

/** 最大深度（0 = 单层，1 = two_level，2 = three_level，≥3 = deep_tree）。 */
function maxDepth(depths: Map<string, number>): number {
  let max = 0;
  for (const d of depths.values()) {
    if (d > max) max = d;
  }
  return max;
}

// ── 投影结果 ────────────────────────────────────────────────

export interface TopologyProjection {
  /** 按 level 分组的 agent id（level 0 = root 行）。 */
  levels: string[][];
  /** 父→子结构边（仅 active 结构边）。 */
  structuralEdges: TeamAgentEdge[];
  /** 覆盖层边（coordinates/reviews/replaces/peer，跨树/对等）。 */
  overlayEdges: TeamAgentEdge[];
  /** 实际渲染模式：与 topologyKind 一致，但若数据矛盾则降级。 */
  renderMode: 'two_level' | 'three_level' | 'flat';
  /** 数据矛盾原因（如 cycle、多父、深度突变）。null = 无降级。 */
  degradeReason: string | null;
}

/**
 * 计算拓扑投影。**绝不修复数据**（§8.2 no silent graph repair）：
 * 检测到 cycle / 多父 / 深度突变时返回 `degradeReason` 并降级为 flat，
 * 但保留原始 edges 供 inspector 查看。
 */
export function projectTopology(snapshot: TeamRunSnapshot): TopologyProjection {
  const { agents, agentEdges, summary } = snapshot;
  const childrenMap = deriveChildrenMap(agents, agentEdges);
  const parentsMap = deriveParentsMap(agents, agentEdges);
  const roots = findRoots(agents, parentsMap);
  const depths = computeDepths(agents, childrenMap, roots);
  const maxD = maxDepth(depths);

  const structuralEdges = agentEdges.filter(
    (e) => STRUCTURAL_EDGE_KINDS.has(e.kind) && isActiveEdge(e),
  );
  const overlayEdges = agentEdges.filter(
    (e) => !STRUCTURAL_EDGE_KINDS.has(e.kind) || !isActiveEdge(e),
  );

  // 检测 cycle：DFS 找环
  const cycle = detectCycle(agents, childrenMap);
  // 检测多父
  const multiParent = agents.filter((a) => (parentsMap.get(a.id) ?? []).length > 1);

  const topoKind: TeamTopologyKind = summary.topologyKind;

  // 降级判定
  let degradeReason: string | null = null;
  if (cycle !== null) {
    degradeReason = `cycle: ${cycle.join(' → ')}`;
  } else if (multiParent.length > 0 && topoKind !== 'peer_graph' && topoKind !== 'hybrid') {
    degradeReason = `multi-parent: ${multiParent.map((a) => a.id).join(', ')}`;
  }

  // 决定 renderMode：严格按 topologyKind，数据矛盾时降级
  let renderMode: TopologyProjection['renderMode'];
  if (degradeReason !== null) {
    renderMode = 'flat';
  } else if (topoKind === 'two_level' && maxD <= 1) {
    renderMode = 'two_level';
  } else if (topoKind === 'three_level' && maxD <= 2) {
    renderMode = 'three_level';
  } else if (topoKind === 'two_level' || topoKind === 'three_level') {
    // topology kind 与实际深度矛盾 → 降级（no silent graph repair）
    renderMode = 'flat';
    degradeReason = `topology ${topoKind} but observed max depth ${maxD}`;
  } else {
    // deep_tree / peer_graph / hybrid / unknown → 降级 flat + 提示
    renderMode = 'flat';
    degradeReason = `topology ${topoKind} rendered as flat`;
  }

  // 按 level 分组
  const levelCount = renderMode === 'two_level' ? 2 : renderMode === 'three_level' ? 3 : 1;
  const levels: string[][] = Array.from({ length: levelCount }, () => []);
  for (const agent of agents) {
    const d = depths.get(agent.id) ?? 0;
    const clamped = Math.min(d, levelCount - 1);
    levels[clamped]!.push(agent.id);
  }

  return { levels, structuralEdges, overlayEdges, renderMode, degradeReason };
}

/** DFS 检测环，返回环上的 agent id 序列或 null。 */
function detectCycle(
  agents: TeamAgent[],
  childrenMap: Map<string, string[]>,
): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const a of agents) {
    color.set(a.id, WHITE);
  }
  const stack: string[] = [];
  let result: string[] | null = null;

  function dfs(id: string): boolean {
    color.set(id, GRAY);
    stack.push(id);
    const children = childrenMap.get(id) ?? [];
    for (const childId of children) {
      const c = color.get(childId);
      if (c === GRAY) {
        // 找到环：从 stack 中 childId 位置开始
        const idx = stack.indexOf(childId);
        result = [...stack.slice(idx), childId];
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

  for (const a of agents) {
    if (color.get(a.id) === WHITE) {
      if (dfs(a.id)) {
        return result;
      }
    }
  }
  return null;
}

// ── 子组件：节点 ────────────────────────────────────────────

function TopologyNode({
  agent,
  selected,
  onSelect,
  locale,
  ariaPosInSet,
  ariaSetSize,
  ariaLevel,
}: {
  agent: TeamAgent;
  selected: boolean;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
  ariaPosInSet: number;
  ariaSetSize: number;
  ariaLevel: number;
}): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(selected ? null : { kind: 'agent', id: agent.id });
  }, [selected, onSelect, agent.id]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(selected ? null : { kind: 'agent', id: agent.id });
      } else if (event.key === 'Escape' && selected) {
        event.preventDefault();
        onSelect(null);
      }
    },
    [selected, onSelect, agent.id],
  );
  const stateLabel = tt(TT.agentState[agent.state], locale);
  return (
    <div
      className={`team-topo-node ${selected ? 'team-topo-node-on' : ''}`}
      role="treeitem"
      aria-selected={selected}
      aria-level={ariaLevel}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="team-topo-role">{agent.role}</span>
      <span className="team-topo-name">{agent.displayName}</span>
      <span className="team-topo-class">{agent.roleClass}</span>
      <span className="team-topo-state">
        <span className={`team-topo-state-dot team-topo-state-${agent.state}`} aria-hidden="true" />
        {stateLabel}
      </span>
    </div>
  );
}

// ── 子组件：边 ──────────────────────────────────────────────

function TopologyEdgeChip({
  edge,
  fromAgent,
  toAgent,
  locale,
}: {
  edge: TeamAgentEdge;
  fromAgent: TeamAgent | undefined;
  toAgent: TeamAgent | undefined;
  locale: Locale;
}): React.JSX.Element {
  const kindLabel = tt(TT.edgeKind[edge.kind], locale);
  const confLabel = tt(TT.confidence[edge.confidence], locale);
  const fromName = fromAgent?.displayName ?? edge.fromAgentId;
  const toName = toAgent?.displayName ?? edge.toAgentId;
  return (
    <div
      className={`team-topo-edge-chip team-topo-edge-${edge.kind}`}
      role="listitem"
      aria-label={`${kindLabel}: ${fromName} → ${toName} (${confLabel})`}
    >
      <span className="team-topo-edge-kind">{kindLabel}</span>
      <span className="team-topo-edge-arrow" aria-hidden="true">→</span>
      <span className="team-topo-edge-from">{fromName}</span>
      <span className="team-topo-edge-to">{toName}</span>
      <span className="team-topo-edge-conf">{confLabel}</span>
    </div>
  );
}

// ── TopologyViewProps ───────────────────────────────────────

export interface TopologyViewProps {
  snapshot: TeamRunSnapshot;
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}

// ── TopologyView ────────────────────────────────────────────

export function TopologyView({
  snapshot,
  selection,
  onSelect,
  locale,
}: TopologyViewProps): React.JSX.Element {
  const projection = useMemo(() => projectTopology(snapshot), [snapshot]);
  const agentById = useMemo(
    () => new Map(snapshot.agents.map((a) => [a.id, a])),
    [snapshot.agents],
  );
  const treeRef = useRef<HTMLDivElement | null>(null);

  if (snapshot.agents.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.topologyEmpty', locale)}
        description={t('team.topologyEmptyHint', locale)}
      />
    );
  }

  const totalNodes = snapshot.agents.length;
  let posInSet = 0;

  return (
    <div
      ref={treeRef}
      className={`team-topology-view team-topology-view-${projection.renderMode}`}
      role="tree"
      aria-label={t('team.topologyLabel', locale)}
    >
      {projection.degradeReason !== null && (
        <div className="team-topology-degrade" role="status">
          <span className="team-topology-degrade-icon" aria-hidden="true">⚠</span>
          <span className="team-topology-degrade-text">{projection.degradeReason}</span>
          <span className="team-topology-degrade-hint">{tt(TT.degradeHint, locale)}</span>
        </div>
      )}

      {projection.renderMode === 'flat' ? (
        <div className="team-topology-flat" role="list" aria-label={t('team.topologyLabel', locale)}>
          {snapshot.agents.map((agent) => {
            const selected = selection !== null && selection.kind === 'agent' && selection.id === agent.id;
            posInSet += 1;
            return (
              <TopologyNode
                key={agent.id}
                agent={agent}
                selected={selected}
                onSelect={onSelect}
                locale={locale}
                ariaPosInSet={posInSet}
                ariaSetSize={totalNodes}
                ariaLevel={1}
              />
            );
          })}
        </div>
      ) : (
        <div className="team-topology-levels">
          {projection.levels.map((levelAgents, levelIdx) => {
            const levelEntry = TT.topologyLevel[levelIdx] ?? TT.topologyLevel[0] ?? { zh: `第 ${levelIdx} 层`, en: `Level ${levelIdx}` };
            return (
            <div
              key={levelIdx}
              className={`team-topology-level team-topology-level-${levelIdx}`}
              role="group"
              aria-label={tt(levelEntry, locale)}
            >
              <div className="team-topology-level-label">
                {tt(levelEntry, locale)}
              </div>
              <div className="team-topology-level-nodes">
                {levelAgents.map((agentId) => {
                  const agent = agentById.get(agentId);
                  if (agent === undefined) return null;
                  const selected =
                    selection !== null && selection.kind === 'agent' && selection.id === agentId;
                  posInSet += 1;
                  return (
                    <TopologyNode
                      key={agentId}
                      agent={agent}
                      selected={selected}
                      onSelect={onSelect}
                      locale={locale}
                      ariaPosInSet={posInSet}
                      ariaSetSize={totalNodes}
                      ariaLevel={levelIdx + 1}
                    />
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {projection.structuralEdges.length > 0 && (
        <div
          className="team-topo-edges team-topo-edges-structural"
          role="list"
          aria-label={tt(TT.structuralEdges, locale)}
        >
          <div className="team-topo-edges-title">{tt(TT.structuralEdges, locale)}</div>
          {projection.structuralEdges.map((edge) => (
            <TopologyEdgeChip
              key={edge.id}
              edge={edge}
              fromAgent={agentById.get(edge.fromAgentId)}
              toAgent={agentById.get(edge.toAgentId)}
              locale={locale}
            />
          ))}
        </div>
      )}

      {projection.overlayEdges.length > 0 && (
        <div
          className="team-topo-edges team-topo-edges-overlay"
          role="list"
          aria-label={tt(TT.overlayEdges, locale)}
        >
          <div className="team-topo-edges-title">{tt(TT.overlayEdges, locale)}</div>
          {projection.overlayEdges.map((edge) => (
            <TopologyEdgeChip
              key={edge.id}
              edge={edge}
              fromAgent={agentById.get(edge.fromAgentId)}
              toAgent={agentById.get(edge.toAgentId)}
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  );
}
