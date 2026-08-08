import { useEffect, useRef, useState } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  SessionIndexEntry,
  SessionMergeGroupInfo,
  TraceSession,
} from '../../core/trace-types.js';
import { api } from '../../api/client.js';
import { ErrorState, Skeleton } from '../ui/States.js';
import { IconUnderstand, IconWarning } from '../icons/index.js';

export interface AgentHierarchyPanelProps {
  locale: Locale;
  sessionKey: string;
  session: TraceSession;
  /** 当前选中会话的派生回合数（D9：选中的节点显示真实回合数）。 */
  turnCount: number | null;
  onSelectAgent: (key: string) => void;
  /** 测试注入：默认走 api。 */
  fetchGroups?: () => Promise<{ groups: SessionMergeGroupInfo[] }>;
  fetchMembers?: (keys: string[]) => Promise<{ items: SessionIndexEntry[] }>;
}

interface AgentNode {
  key: string;
  title: string;
  /** 'main' 主 agent；'subagent' 子 agent；'unknown' 类型未知（不猜标题）。 */
  kind: 'main' | 'subagent' | 'unknown';
  depth: number;
  selected: boolean;
  /** 派生回合数；非选中会话在请求预算内拿不到 → null（渲染 —）。 */
  turnCount: number | null;
}

const defaultFetchGroups = (): Promise<{ groups: SessionMergeGroupInfo[] }> =>
  api.sessionGroups();
const defaultFetchMembers = (keys: string[]): Promise<{ items: SessionIndexEntry[] }> =>
  api.listSessions({ keys });

/** D9：合并组是扁平列表；根 = primaryKey，其余成员为 depth 1 子节点。 */
function buildTree(
  group: SessionMergeGroupInfo | null,
  members: SessionIndexEntry[],
  sessionKey: string,
  turnCount: number | null,
): AgentNode[] {
  if (group === null || group.mergedKeys.length <= 1) {
    const member = members.find((m) => m.id === sessionKey);
    return [
      {
        key: sessionKey,
        title: member?.title ?? sessionKey,
        kind: 'main',
        depth: 0,
        selected: true,
        turnCount,
      },
    ];
  }
  const byKey = new Map(members.map((m) => [m.id, m]));
  const root = byKey.get(group.primaryKey);
  const nodes: AgentNode[] = [
    {
      key: group.primaryKey,
      title: root?.title ?? group.primaryKey,
      kind: 'main',
      depth: 0,
      selected: sessionKey === group.primaryKey,
      turnCount: sessionKey === group.primaryKey ? turnCount : null,
    },
  ];
  for (const key of group.mergedKeys) {
    if (key === group.primaryKey) {
      continue;
    }
    const member = byKey.get(key);
    nodes.push({
      key,
      title: member?.title ?? key,
      // D9 + design-system：子 agent 类型标签来自 extractSubagentType；
      // 列表行没有 input_summary 可提取，且「不从标题猜测」→ unknown + 启发式 tooltip。
      kind: 'subagent',
      depth: Math.min(5, 1),
      selected: key === sessionKey,
      turnCount: key === sessionKey ? turnCount : null,
    });
  }
  return nodes;
}

/**
 * D9 Agent 层级面板：合并组解析（GET /api/session-groups，实例级缓存）、
 * 成员一次批量拉取（≥2 成员时恰好一次 GET /api/sessions?keys=…，绝不逐成员
 * 拉取 —— AGENTS.md #6）、depth-5 树、accent 选中（danger 绝不表示选中）、
 * 单 agent 会话渲染单一根节点。
 */
export function AgentHierarchyPanel({
  locale,
  sessionKey,
  session,
  turnCount,
  onSelectAgent,
  fetchGroups = defaultFetchGroups,
  fetchMembers = defaultFetchMembers,
}: AgentHierarchyPanelProps): React.JSX.Element {
  const [nodes, setNodes] = useState<AgentNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const groupsCacheRef = useRef<{ groups: SessionMergeGroupInfo[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNodes(null);
    const load = async (): Promise<void> => {
      let groups: SessionMergeGroupInfo[];
      if (groupsCacheRef.current !== null) {
        groups = groupsCacheRef.current.groups;
      } else {
        const res = await fetchGroups();
        groupsCacheRef.current = res;
        groups = res.groups;
      }
      if (cancelled) {
        return;
      }
      const group = groups.find((g) => g.mergedKeys.includes(sessionKey)) ?? null;
      if (group !== null && group.mergedKeys.length > 1) {
        const res = await fetchMembers(group.mergedKeys);
        if (!cancelled) {
          setNodes(buildTree(group, res.items, sessionKey, turnCount));
        }
      } else {
        if (!cancelled) {
          setNodes(buildTree(group, [], sessionKey, turnCount));
        }
      }
    };
    void load()
      .catch((err: unknown) => {
        console.error('[agent-hierarchy] 加载失败:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // sessionKey 变化重载；turnCount 只影响已渲染节点的计数显示。
  }, [sessionKey, reloadTick, fetchGroups, fetchMembers]);

  const retry = (): void => {
    groupsCacheRef.current = null;
    setError(null);
    setLoading(true);
    setReloadTick((tick) => tick + 1);
  };

  const title = t('trajectory.agent.title', locale);

  return (
    <section className="trajectory-rail-panel" aria-label={title}>
      <h3 className="trajectory-rail-panel-title">
        <IconUnderstand size={12} />
        {title}
      </h3>
      {loading && nodes === null && <Skeleton variant="row" count={3} />}
      {error !== null && (
        <ErrorState code="AGENT_HIERARCHY_FAILED" message={error} onRetry={retry} />
      )}
      {!loading && error === null && nodes !== null && nodes.length === 0 && (
        <p className="hint">{t('trajectory.agent.empty', locale)}</p>
      )}
      {!loading && error === null && nodes !== null && nodes.length > 0 && (
        <div className="agent-hierarchy">
          {nodes.map((node) => (
            <button
              key={node.key}
              type="button"
              className={`agent-node ${node.selected ? 'agent-node-selected' : ''}`}
              style={{ paddingLeft: `calc(var(--space-2) + var(--space-4) * ${node.depth})` }}
              aria-pressed={node.selected}
              onClick={() => onSelectAgent(node.key)}
            >
              <span
                className="agent-node-indicator"
                aria-hidden="true"
                style={{
                  width: 'var(--gantt-group-border)',
                  height: 'var(--row-md)',
                  background: node.selected ? 'var(--accent-emphasis)' : 'transparent',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
              <span className="agent-node-name" title={node.title}>
                {node.title}
              </span>
              <span
                className="agent-node-type"
                title={node.kind !== 'main' ? t('trajectory.agent.unknownTooltip', locale) : undefined}
              >
                {node.kind === 'main'
                  ? t('trajectory.agent.main', locale)
                  : t('trajectory.agent.unknown', locale)}
              </span>
              <span
                className="agent-node-count mono"
                title={
                  node.turnCount === null
                    ? t('trajectory.agent.countUnavailable', locale)
                    : undefined
                }
              >
                {node.turnCount === null ? '—' : `${node.turnCount} ${t('trajectory.pill.turns', locale)}`}
              </span>
            </button>
          ))}
        </div>
      )}
      {session.isSubagent && (
        <p className="trajectory-criteria">
          <IconWarning size={12} />
          {t('trajectory.agent.subagent', locale)}
        </p>
      )}
    </section>
  );
}
