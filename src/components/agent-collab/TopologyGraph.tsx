/**
 * agent-collaboration-replay §4.2 / §8.1 — SVG 拓扑图组件。
 *
 * 从 `agents` + `edges` 用 `computeLayout` 计算坐标，渲染原生 SVG：
 * - 边层（先渲染，在节点下方）：`<path>` + `<text>` 消息计数
 * - 节点层：`<g>` + `<rect rx="4" ry="4">` 圆角矩形卡片 + 2 行 `<text>`（displayName + 角色 badge）
 * - 角色 badge：team-leader 用 `var(--accent-emphasis)` 背景，team-mate 用 `var(--neutral-subtle)` 背景
 * - 状态色：三态描边 + 填充（活跃 / 空闲 / 失败），由 `classifyAgentStatus` 纯函数推导
 * - 图例：右上角 3 个色样 + 文本（活跃 / 空闲 / 失败）
 * - 选中 agent 时相连边高亮（加粗 + 着色，其他边 opacity 降低）
 * - 无障碍：`<title>` + `<desc>` + `role="img"` + `aria-label`
 * - 容器：`<svg viewBox>` 自适应，外层 `<div class="collab-topology-wrap">` 设 `overflow-x: auto`
 *
 * 无新 runtime dependency：纯 React + SVG。不引入第三方图形库。
 */

import { useCallback, useMemo } from 'react';


import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamAgent,
  TeamAgentEdge,
  TeamAgentState,
} from '../../core/trace-types.js';
import { EmptyState } from '../ui/States.js';
import { computeLayout } from './topology-layout.js';

// ── Props ────────────────────────────────────────────────────

export interface TopologyGraphProps {
  agents: TeamAgent[];
  edges: TeamAgentEdge[];
  /** 当前 task 期间活跃的 agent id 集合。 */
  activeAgentIds: Set<string>;
  /** agent → 最新状态（由 AgentCollabReplay 从 activities 推导后传入，design §3.1.5）。 */
  agentStates: Map<string, TeamAgentState>;
  /** 用户选中的 agent id（null = 未选中）。 */
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  /** 边的消息计数：key = `${fromAgentId}:${toAgentId}`。 */
  edgeMessageCounts: Map<string, number>;
  locale: Locale;
}

// ── 边 kind → CSS class 后缀（实线/虚线/点线/双向） ──────────

function edgeClassSuffix(kind: TeamAgentEdge['kind']): string {
  return kind;
}

// ── 状态分类（design §3.1.2，纯函数可单测） ──────────────────

export type AgentStatusClass = 'active' | 'idle' | 'failed';

/**
 * 按 agent 最新状态 + 是否有活动分类为三态之一（spec §8.1.1 规则 4-5）。
 *
 * - 活跃：有活动且最新状态 ∈ {busy, ready, created}
 * - 失败：最新状态 ∈ {failed, cancelled, replaced}
 * - 空闲：其余（含无活动、idle、completed、unknown 等）
 */
export function classifyAgentStatus(
  state: TeamAgentState | undefined,
  hasActivity: boolean,
): AgentStatusClass {
  if (state === 'failed' || state === 'cancelled' || state === 'replaced') {
    return 'failed';
  }
  if (hasActivity && (state === 'busy' || state === 'ready' || state === 'created')) {
    return 'active';
  }
  return 'idle';
}

// ── 角色 badge 颜色（design §3.1.2） ─────────────────────────

interface BadgeStyle {
  fill: string;
  textColor: string;
}

function roleBadgeStyle(roleClass: string): BadgeStyle {
  if (roleClass === 'leader' || roleClass === 'team-leader') {
    return { fill: 'var(--accent-emphasis)', textColor: 'var(--fg-on-emphasis)' };
  }
  return { fill: 'var(--neutral-subtle)', textColor: 'var(--fg-default)' };
}

// ── 状态色（design §3.1.2 三态表） ───────────────────────────

interface StatusStyle {
  stroke: string;
  strokeWidth: number;
  fill: string;
}

function statusStyle(cls: AgentStatusClass): StatusStyle {
  switch (cls) {
    case 'active':
      return { stroke: 'var(--accent-emphasis)', strokeWidth: 2, fill: 'var(--accent-subtle)' };
    case 'failed':
      return { stroke: 'var(--danger-emphasis)', strokeWidth: 1, fill: 'var(--danger-subtle)' };
    case 'idle':
    default:
      return { stroke: 'var(--fg-subtle)', strokeWidth: 1, fill: 'var(--canvas-default)' };
  }
}

// ── 组件 ─────────────────────────────────────────────────────

export function TopologyGraph({
  agents,
  edges,
  activeAgentIds,
  agentStates,
  selectedAgentId,
  onSelectAgent,
  edgeMessageCounts,
  locale,
}: TopologyGraphProps): React.JSX.Element {
  const layout = useMemo(
    () => computeLayout(agents, edges),
    [agents, edges],
  );

  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  /** 选中 agent 时，与之相连的边 id 集合（用于高亮）。 */
  const selectedEdgeIds = useMemo(() => {
    if (selectedAgentId === null) {
      return null;
    }
    const set = new Set<string>();
    for (const edge of edges) {
      if (edge.fromAgentId === selectedAgentId || edge.toAgentId === selectedAgentId) {
        set.add(edge.id);
      }
    }
    return set;
  }, [edges, selectedAgentId]);

  const handleNodeClick = useCallback(
    (agentId: string) => {
      onSelectAgent(selectedAgentId === agentId ? null : agentId);
    },
    [onSelectAgent, selectedAgentId],
  );

  // 空 agents → EmptyState（不渲染 <svg>）
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">○</span>}
        title={t('session.teamReplay.topologyEmpty', locale)}
      />
    );
  }

  const descText = `Agent topology: ${agents.length} nodes, ${edges.length} edges`;

  // 图例几何（右上角）
  const legendX = layout.width - 120;
  const legendY = 8;
  const legendLineHeight = 16;
  const legendSwatchSize = 10;

  return (
    <div className="collab-topology-wrap">
      <svg
        className="collab-topology-graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={t('session.teamReplay.topologyAriaLabel', locale)}
      >
        <title>{t('session.teamReplay.topologyTitle', locale)}</title>
        <desc>{descText}</desc>

        {/* 箭头 marker 定义 */}
        <defs>
          <marker
            id="collab-arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" />
          </marker>
        </defs>

        {/* 边层（先渲染，在节点下方） */}
        {layout.edges.map(({ edge, path, midpoint, degraded }) => {
          const isSelected = selectedEdgeIds?.has(edge.id) ?? false;
          const dimmed = selectedEdgeIds !== null && !isSelected;
          const countKey = `${edge.fromAgentId}:${edge.toAgentId}`;
          const count = edgeMessageCounts.get(countKey);
          const edgeClassName = [
            'collab-edge',
            `collab-edge-${edgeClassSuffix(edge.kind)}`,
            isSelected ? 'collab-edge-selected' : '',
            dimmed ? 'collab-edge-dimmed' : '',
            degraded ? 'collab-edge-degraded' : '',
          ].filter(Boolean).join(' ');
          return (
            <g key={edge.id} className="collab-edge-group">
              <path
                d={path}
                className={edgeClassName}
                markerEnd="url(#collab-arrowhead)"
              />
              {count !== undefined && count > 0 && (
                <text
                  x={midpoint.x}
                  y={midpoint.y}
                  className="collab-edge-count"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}

        {/* 节点层：圆角矩形卡片 + 2 行内容 */}
        {layout.nodes.map(({ agentId, x, y, width, height }) => {
          const agent = agentById.get(agentId);
          if (agent === undefined) {
            return null;
          }
          const hasActivity = activeAgentIds.has(agentId);
          const statusCls = classifyAgentStatus(agentStates.get(agentId), hasActivity);
          const isSelected = selectedAgentId === agentId;
          const sStyle = statusStyle(statusCls);
          const badge = roleBadgeStyle(agent.roleClass);
          const nodeClassName = [
            'collab-node',
            `collab-node-status-${statusCls}`,
            isSelected ? 'collab-node-selected' : '',
          ].filter(Boolean).join(' ');

          // 卡片内 2 行布局（垂直居中）
          const nameY = y + 18;
          const badgeRectY = y + 26;
          const badgeRectHeight = 14;
          // 角色 badge 文本：截断到 12 字符以适配卡片（role 通常很短）
          const roleText = agent.role.length > 12 ? `${agent.role.slice(0, 11)}…` : agent.role;
          const badgeTextWidth = roleText.length * 7 + 8;
          const badgeRectX = x + (width - badgeTextWidth) / 2;
          const badgeTextX = badgeRectX + badgeTextWidth / 2;
          const badgeTextY = badgeRectY + badgeRectHeight / 2;

          return (
            <g
              key={agentId}
              className={nodeClassName}
              onClick={() => handleNodeClick(agentId)}
              role="button"
              tabIndex={0}
              aria-label={`${agent.displayName} (${agent.role})`}
            >
              {/* 卡片背景：圆角矩形 + 状态色描边 + 填充 */}
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={4}
                ry={4}
                className="collab-node-card"
                fill={sStyle.fill}
                stroke={sStyle.stroke}
                strokeWidth={sStyle.strokeWidth}
              />
              {/* 第 1 行：displayName 完整显示（不截断，spec §8.1.1 规则 1-2） */}
              <text
                x={x + width / 2}
                y={nameY}
                className="collab-node-name"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--fg-default)"
              >
                {agent.displayName}
              </text>
              {/* 第 2 行：角色 badge（<rect> 背景 + <text>，spec §8.1.1 规则 3） */}
              <rect
                x={badgeRectX}
                y={badgeRectY}
                width={badgeTextWidth}
                height={badgeRectHeight}
                rx={2}
                ry={2}
                className={`collab-node-badge collab-node-badge-${agent.roleClass}`}
                fill={badge.fill}
              />
              <text
                x={badgeTextX}
                y={badgeTextY}
                className="collab-node-role"
                textAnchor="middle"
                dominantBaseline="middle"
                fill={badge.textColor}
              >
                {roleText}
              </text>
            </g>
          );
        })}

        {/* 图例（右上角，spec §8.1.1 规则 8） */}
        <g className="collab-legend">
          {/* 活跃 */}
          <rect
            x={legendX}
            y={legendY}
            width={legendSwatchSize}
            height={legendSwatchSize}
            className="collab-legend-swatch collab-legend-active"
            fill="var(--accent-emphasis)"
          />
          <text
            x={legendX + legendSwatchSize + 4}
            y={legendY + legendSwatchSize / 2}
            className="collab-legend-label"
            dominantBaseline="middle"
            fill="var(--fg-default)"
          >
            {t('session.teamReplay.legendActive', locale)}
          </text>
          {/* 空闲 */}
          <rect
            x={legendX}
            y={legendY + legendLineHeight}
            width={legendSwatchSize}
            height={legendSwatchSize}
            className="collab-legend-swatch collab-legend-idle"
            fill="var(--fg-subtle)"
          />
          <text
            x={legendX + legendSwatchSize + 4}
            y={legendY + legendLineHeight + legendSwatchSize / 2}
            className="collab-legend-label"
            dominantBaseline="middle"
            fill="var(--fg-default)"
          >
            {t('session.teamReplay.legendIdle', locale)}
          </text>
          {/* 失败 */}
          <rect
            x={legendX}
            y={legendY + legendLineHeight * 2}
            width={legendSwatchSize}
            height={legendSwatchSize}
            className="collab-legend-swatch collab-legend-failed"
            fill="var(--danger-emphasis)"
          />
          <text
            x={legendX + legendSwatchSize + 4}
            y={legendY + legendLineHeight * 2 + legendSwatchSize / 2}
            className="collab-legend-label"
            dominantBaseline="middle"
            fill="var(--fg-default)"
          >
            {t('session.teamReplay.legendFailed', locale)}
          </text>
        </g>
      </svg>
    </div>
  );
}
