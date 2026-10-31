/**
 * add-agent-team-observability §8.6 / §8.9 / §8.12 / §8.13 / §8.14 —
 * CommunicationView：通信图可视化组件。
 *
 * 从 messages 渲染 sender → recipient 有向图 + 虚拟化消息表。
 * - **mode 着色**（direct/leader_mediated/broadcast/unknown，token 色 + 文字 label）
 * - **category 着色**（assignment/coordination/question/.../unknown，文字 label）
 * - **unavailable 不伪造**（G12.2）：completeness.communication === 'unavailable'
 *   时显示提示，不伪造消息
 * - **reply correlation**：replyToId 非空时显示回复链
 * - **latency 仅在有证据时显示**（receivedAt - sentAt，correlated 才显示）
 * - **虚拟化消息表**（复用 useVirtualList）
 *
 * **跨视图高亮**（§8.12）：选中 message 高亮行，选中 agent 高亮其消息。
 * **无障碍**（§8.14）：list/listitem role、aria-selected、键盘、文字 label。
 * **无新 runtime dependency**。
 *
 * **i18n**：新键在组件内局部双语映射。
 */

import '../../styles/components/team.css';
import '../../styles/components/team-views.css';

import { useCallback, useMemo } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  TeamCommunication,
  TeamMessageCategory,
  TeamMessageMode,
  TeamRunSnapshot,
} from '../../core/trace-types.js';
import { useVirtualList } from '../../hooks/useVirtualList.js';
import { EmptyState } from '../ui/States.js';
import type { TeamSelection } from './team-client.js';

// ── 局部双语文字映射 ────────────────────────────────────────

const TT = {
  mode: {
    direct: { zh: '直接', en: 'direct' },
    leader_mediated: { zh: '中介', en: 'leader-mediated' },
    broadcast: { zh: '广播', en: 'broadcast' },
    unknown: { zh: '未知', en: 'unknown' },
  } as Record<TeamMessageMode, { zh: string; en: string }>,
  category: {
    assignment: { zh: '指派', en: 'assignment' },
    coordination: { zh: '协调', en: 'coordination' },
    question: { zh: '提问', en: 'question' },
    answer: { zh: '回答', en: 'answer' },
    handoff: { zh: '交接', en: 'handoff' },
    status: { zh: '状态', en: 'status' },
    blocker: { zh: '阻塞', en: 'blocker' },
    review: { zh: '评审', en: 'review' },
    correction: { zh: '纠正', en: 'correction' },
    result: { zh: '结果', en: 'result' },
    system: { zh: '系统', en: 'system' },
    unknown: { zh: '未知', en: 'unknown' },
  } as Record<TeamMessageCategory, { zh: string; en: string }>,
  sender: { zh: '发送方', en: 'sender' },
  recipient: { zh: '接收方', en: 'recipient' },
  recipients: { zh: '接收方', en: 'recipients' },
  modeLabel: { zh: '模式', en: 'mode' },
  categoryLabel: { zh: '类别', en: 'category' },
  latency: { zh: '延迟', en: 'latency' },
  replyTo: { zh: '回复', en: 'reply to' },
  sentAt: { zh: '发送时间', en: 'sent at' },
  noMessages: { zh: '无消息记录', en: 'no messages' },
  bodyAvailable: { zh: '有正文', en: 'body available' },
  bodyUnavailable: { zh: '无正文', en: 'no body' },
  directedGraph: { zh: '有向图', en: 'directed graph' },
  messageTable: { zh: '消息表', en: 'message table' },
  correlatedLatency: { zh: '关联延迟', en: 'correlated latency' },
  noProofLatency: { zh: '延迟需关联证据，不显示', en: 'latency requires correlated proof, not shown' },
  total: { zh: '总计', en: 'total' },
} as const;

function tt(entry: { zh: string; en: string }, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en;
}

// ── 延迟计算（仅 correlated 证据时显示） ────────────────────

/** 计算延迟 ms，仅当 sentAt/receivedAt 均存在且 received >= sent。 */
function computeLatencyMs(msg: TeamCommunication): number | null {
  if (msg.sentAt === null || msg.receivedAt === null) return null;
  const s = Date.parse(msg.sentAt);
  const e = Date.parse(msg.receivedAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return e - s;
}

// ── 有向图边聚合 ────────────────────────────────────────────

export interface CommunicationEdge {
  senderId: string;
  recipientId: string;
  count: number;
  modes: Set<TeamMessageMode>;
  categories: Set<TeamMessageCategory>;
}

/** 聚合 sender → recipient 边（含计数与 mode/category 集合）。 */
function aggregateEdges(messages: TeamCommunication[]): CommunicationEdge[] {
  const map = new Map<string, CommunicationEdge>();
  for (const msg of messages) {
    for (const recipientId of msg.recipientAgentIds) {
      const key = `${msg.senderAgentId}→${recipientId}`;
      let edge = map.get(key);
      if (edge === undefined) {
        edge = {
          senderId: msg.senderAgentId,
          recipientId,
          count: 0,
          modes: new Set(),
          categories: new Set(),
        };
        map.set(key, edge);
      }
      edge.count += 1;
      edge.modes.add(msg.mode);
      edge.categories.add(msg.category);
    }
  }
  return [...map.values()];
}

// ── 虚拟化行高 ──────────────────────────────────────────────

const ROW_HEIGHT = 36;

// ── 子组件：消息行 ──────────────────────────────────────────

function MessageRow({
  msg,
  selected,
  agentNames,
  onSelect,
  locale,
  ariaPosInSet,
  ariaSetSize,
}: {
  msg: TeamCommunication;
  selected: boolean;
  agentNames: Map<string, string>;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
  ariaPosInSet: number;
  ariaSetSize: number;
}): React.JSX.Element {
  const senderName = agentNames.get(msg.senderAgentId) ?? msg.senderAgentId;
  const recipientNames = msg.recipientAgentIds.map((id) => agentNames.get(id) ?? id).join(', ');
  const modeLabel = tt(TT.mode[msg.mode], locale);
  const categoryLabel = tt(TT.category[msg.category], locale);
  const latencyMs = computeLatencyMs(msg);
  const handleClick = useCallback(() => {
    onSelect(selected ? null : { kind: 'message', id: msg.id });
  }, [selected, onSelect, msg.id]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(selected ? null : { kind: 'message', id: msg.id });
      } else if (event.key === 'Escape' && selected) {
        event.preventDefault();
        onSelect(null);
      }
    },
    [selected, onSelect, msg.id],
  );
  const ariaLabel = `${modeLabel} ${categoryLabel}: ${senderName} → ${recipientNames}${latencyMs !== null ? `, ${tt(TT.latency, locale)} ${latencyMs}ms` : ''}${msg.replyToId !== null ? `, ${tt(TT.replyTo, locale)} ${msg.replyToId}` : ''}`;
  return (
    <div
      className={`team-comm-row ${selected ? 'team-comm-row-on' : ''} team-comm-mode-${msg.mode}`}
      role="listitem"
      aria-selected={selected}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
    >
      <span className={`team-comm-mode-badge team-comm-mode-${msg.mode}`}>{modeLabel}</span>
      <span className={`team-comm-category-badge team-comm-category-${msg.category}`}>{categoryLabel}</span>
      <span className="team-comm-sender">{senderName}</span>
      <span className="team-comm-arrow" aria-hidden="true">→</span>
      <span className="team-comm-recipients">{recipientNames}</span>
      {latencyMs !== null && (
        <span className="team-comm-latency">{tt(TT.latency, locale)}: {latencyMs}ms</span>
      )}
      {msg.replyToId !== null && (
        <span className="team-comm-reply">{tt(TT.replyTo, locale)}: {msg.replyToId.slice(-6)}</span>
      )}
      <span className="team-comm-time">{msg.sentAt?.slice(11, 19) ?? '—'}</span>
    </div>
  );
}

// ── CommunicationViewProps ──────────────────────────────────

export interface CommunicationViewProps {
  snapshot: TeamRunSnapshot;
  /** 消息列表（由 TeamShell 拉取，§7.3 ledger 按 kind=message_sent/received 投影）。 */
  messages: TeamCommunication[];
  selection: TeamSelection | null;
  onSelect: (sel: TeamSelection | null) => void;
  locale: Locale;
}

// ── CommunicationView ───────────────────────────────────────

export function CommunicationView({
  snapshot,
  messages,
  selection,
  onSelect,
  locale,
}: CommunicationViewProps): React.JSX.Element {
  const commCompleteness = snapshot.completeness.communication;
  const agentNames = useMemo(
    () => new Map(snapshot.agents.map((a) => [a.id, a.displayName])),
    [snapshot.agents],
  );
  const edges = useMemo(() => aggregateEdges(messages), [messages]);

  const { containerRef, range: virtualRange, onScroll } = useVirtualList(
    messages.length,
    ROW_HEIGHT,
  );

  // G12.2：unavailable 不伪造
  if (commCompleteness === 'unavailable') {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.unavailableTitle', locale)}
        description={t('team.communicationUnavailableHint', locale)}
      />
    );
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={tt(TT.noMessages, locale)}
        description={t('team.communicationSeeLedger', locale)}
      />
    );
  }

  return (
    <div className="team-comm-view" aria-label={t('team.communicationLabel', locale)}>
      {/* 有向图 */}
      <div
        className="team-comm-graph"
        role="list"
        aria-label={tt(TT.directedGraph, locale)}
      >
        <div className="team-comm-graph-title">{tt(TT.directedGraph, locale)}</div>
        {edges.map((edge) => {
          const senderName = agentNames.get(edge.senderId) ?? edge.senderId;
          const recipientName = agentNames.get(edge.recipientId) ?? edge.recipientId;
          const modesLabel = [...edge.modes].map((m) => tt(TT.mode[m], locale)).join(', ');
          const categoriesLabel = [...edge.categories].map((c) => tt(TT.category[c], locale)).join(', ');
          return (
            <div
              key={`${edge.senderId}→${edge.recipientId}`}
              className="team-comm-edge"
              role="listitem"
              aria-label={`${senderName} → ${recipientName}, ${edge.count} ${tt(TT.total, locale)}, ${modesLabel}, ${categoriesLabel}`}
            >
              <span className="team-comm-edge-from">{senderName}</span>
              <span className="team-comm-edge-arrow" aria-hidden="true">→</span>
              <span className="team-comm-edge-to">{recipientName}</span>
              <span className="team-comm-edge-count">×{edge.count}</span>
              <span className="team-comm-edge-modes">{modesLabel}</span>
              <span className="team-comm-edge-categories">{categoriesLabel}</span>
            </div>
          );
        })}
      </div>

      {/* 虚拟化消息表 */}
      <div
        className="team-comm-table"
        role="list"
        aria-label={tt(TT.messageTable, locale)}
      >
        <div className="team-comm-table-title">{tt(TT.messageTable, locale)}</div>
        <div
          ref={containerRef}
          className="team-comm-table-body"
          style={{ height: '100%', overflowY: 'auto', position: 'relative' }}
          onScroll={onScroll}
        >
          <div style={{ height: virtualRange.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${virtualRange.offsetY}px)` }}>
              {messages
                .slice(virtualRange.startIndex, virtualRange.endIndex)
                .map((msg, idx) => {
                  const realIdx = virtualRange.startIndex + idx;
                  const selected =
                    selection !== null && selection.kind === 'message' && selection.id === msg.id;
                  return (
                    <MessageRow
                      key={msg.id}
                      msg={msg}
                      selected={selected}
                      agentNames={agentNames}
                      onSelect={onSelect}
                      locale={locale}
                      ariaPosInSet={realIdx + 1}
                      ariaSetSize={messages.length}
                    />
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
