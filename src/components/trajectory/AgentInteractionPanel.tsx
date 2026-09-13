import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { AgentEdgeKind, AgentGraph, AgentGraphNode } from '../../core/agent-graph.js';
import { MAIN_AGENT_ID } from '../../core/agent-graph.js';
import { IconUnderstand, IconWarning } from '../icons/index.js';
import { ti } from './interact-i18n.js';

export interface AgentInteractionPanelProps {
  locale: Locale;
  graph: AgentGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onFocusEvent: (eventId: string) => void;
}

function fmtDur(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function edgeVerb(kind: AgentEdgeKind, locale: Locale): string {
  if (kind === 'spawn') {
    return ti('spawn', locale);
  }
  if (kind === 'handoff') {
    return ti('handoff', locale);
  }
  return ti('return', locale);
}

function nodeTitle(node: AgentGraphNode): string {
  return node.type !== 'unknown' && node.type !== node.label
    ? `${node.label} · ${node.type}`
    : node.label;
}

/**
 * Session-local agent interaction list.
 *
 * Complements AgentHierarchyPanel (which only sees merge-group *sessions*).
 * This panel is the DSH-style "who talked to whom" surface: spawn / handoff /
 * return edges over the current event stream, zero extra requests.
 */
export function AgentInteractionPanel({
  locale,
  graph,
  selectedNodeId,
  onSelectNode,
  onFocusEvent,
}: AgentInteractionPanelProps): React.JSX.Element {
  const title = ti('title', locale);
  const selected = selectedNodeId ?? MAIN_AGENT_ID;

  return (
    <section className="trajectory-rail-panel" aria-label={title}>
      <h3 className="trajectory-rail-panel-title">
        <IconUnderstand size={12} />
        {title}
      </h3>
      <p className="trajectory-criteria">
        {graph.singleAgent
          ? ti('single', locale)
          : ti('summary', locale)
              .replace('{agents}', String(graph.nodes.length))
              .replace('{edges}', String(graph.edges.length))
              .replace('{ratio}', graph.parallelismRatio.toFixed(2))}
      </p>
      <div className="agent-interact-nodes" role="list">
        {graph.nodes.map((node) => {
          const isOn = node.id === selected;
          return (
            <button
              key={node.id}
              type="button"
              className={`agent-interact-node ${isOn ? 'agent-interact-node-selected' : ''}`}
              role="listitem"
              aria-pressed={isOn}
              onClick={() => {
                onSelectNode(node.id);
                if (node.firstEventId !== null) {
                  onFocusEvent(node.firstEventId);
                }
              }}
            >
              <span className="agent-node-name" title={nodeTitle(node)}>
                {node.label}
              </span>
              <span className="agent-node-type">
                {node.kind === 'main'
                  ? t('trajectory.agent.main', locale)
                  : t('trajectory.agent.subagent', locale)}
              </span>
              <span className="agent-node-count mono">
                {node.eventCount} · {fmtDur(node.durationMs)}
              </span>
            </button>
          );
        })}
      </div>
      {graph.edges.length > 0 && (
        <ol className="agent-interact-edges">
          {graph.edges.map((edge) => {
            const from = graph.nodes.find((n) => n.id === edge.fromId);
            const to = graph.nodes.find((n) => n.id === edge.toId);
            return (
              <li key={edge.id}>
                <button
                  type="button"
                  className="agent-edge"
                  onClick={() => onFocusEvent(edge.eventId)}
                >
                  <span className="agent-edge-kind">{edgeVerb(edge.kind, locale)}</span>
                  <span className="agent-edge-path">
                    {from?.label ?? edge.fromId}
                    {' → '}
                    {to?.label ?? edge.toId}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="trajectory-criteria">
        <IconWarning size={12} />
        {ti('criteria', locale)}
      </p>
    </section>
  );
}
