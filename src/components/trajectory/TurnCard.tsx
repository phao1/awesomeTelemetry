import { useMemo } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { DurationSource, TraceEvent, TraceEventRaw, TraceTurn, TurnMessage } from '../../core/trace-types.js';
import { SLOW_TURN_THRESHOLD_MS } from '../../core/turn-analysis.js';
import { MessageCard } from './MessageCard.js';

export interface TurnCardProps {
  turn: TraceTurn;
  sessionKey: string;
  locale: Locale;
  durationSource?: DurationSource;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
}

export type TurnCardItem =
  | { kind: 'assistant'; members: TurnMessage[]; toolCalls: TurnMessage[] }
  | { kind: 'message'; message: TurnMessage };

/**
 * D4 消息分组：llm/reasoning 聚合成一张 assistant 卡；tool 事件的两个渲染面
 * —— 调用块（嵌套在 assistant 卡内）+ 结果卡（紧跟其后）。其余角色各自成卡。
 * 一个事件只产生一个 `TurnMessage`，但渲染两处（C15：与参考截图一致）。
 */
export function groupMessages(messages: readonly TurnMessage[]): TurnCardItem[] {
  const cards: TurnCardItem[] = [];
  let assistant: { members: TurnMessage[]; toolCalls: TurnMessage[] } | null = null;
  let pendingToolResults: TurnMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' || message.role === 'reasoning') {
      if (assistant === null) {
        const entry: TurnCardItem & { kind: 'assistant' } = {
          kind: 'assistant',
          members: [],
          toolCalls: [],
        };
        assistant = entry;
        cards.push(entry);
      }
      assistant.members.push(message);
    } else if (message.role === 'tool') {
      if (assistant !== null) {
        assistant.toolCalls.push(message);
      }
      pendingToolResults.push(message);
    } else {
      for (const toolMessage of pendingToolResults) {
        cards.push({ kind: 'message', message: toolMessage });
      }
      pendingToolResults = [];
      cards.push({ kind: 'message', message });
    }
  }
  for (const toolMessage of pendingToolResults) {
    cards.push({ kind: 'message', message: toolMessage });
  }
  return cards;
}

/** D4/D12 展开回合：消息卡有序列表，回合级 token 元信息行。 */
export function TurnCard({
  turn,
  sessionKey,
  locale,
  durationSource,
  loadDetail,
  loadRaw,
}: TurnCardProps): React.JSX.Element {
  const isMetadata = (m: TurnMessage): boolean => !m.hasInput && !m.hasOutput && m.error === null && m.status !== 'error' &&
    (m.role === 'system' || m.role === 'reasoning' || (m.role === 'assistant' && m.title === 'token_count'));
  const metadata = turn.messages.filter(isMetadata);
  const items = useMemo(() => groupMessages(turn.messages.filter((m) => !isMetadata(m))), [turn.messages]);

  return (
    <div
      className="turn-card"
      role="region"
      aria-label={t('trajectory.turn.title', locale).replace('{index}', String(turn.index))}
    >
      <div className="trajectory-turn-meta">
        <span>{t('trajectory.turn.execution', locale)}</span>
        <span className="mono">{t('trajectory.toolCounts', locale)
          .replace('{calls}', String(turn.messages.filter((m) => m.role === 'tool' && m.hasInput).length))
          .replace('{results}', String(turn.messages.filter((m) => m.role === 'tool' && m.hasOutput && !m.hasInput).length))}</span>
        <span className="hint">{t(durationSource === 'derived' ? 'trajectory.timing.derived' : 'trajectory.timing.recorded', locale)}</span>
      </div>
      {durationSource === 'derived' && turn.durationMs >= SLOW_TURN_THRESHOLD_MS && !turn.messages.some((m) => m.role === 'tool' && m.hasInput) &&
        <p className="trajectory-unattributed-gap">{t('trajectory.unattributedGap', locale)}</p>}
      {items.length === 0 && metadata.length === 0 && (
        <p className="turn-card-empty">{t('trajectory.turn.empty', locale)}</p>
      )}
      {items.map((item, index) =>
        item.kind === 'assistant' ? (
          <MessageCard
            key={`assistant-${index}`}
            locale={locale}
            sessionKey={sessionKey}
            message={item.members[0]!}
            assistant={item}
            durationSource={durationSource}
            loadDetail={loadDetail}
            loadRaw={loadRaw}
          />
        ) : (
          <MessageCard
            key={item.message.eventId}
            locale={locale}
            sessionKey={sessionKey}
            message={item.message}
            initialView={item.message.role === 'tool' && item.message.hasInput && !item.message.hasOutput ? 'input' : 'rendered'}
            durationSource={durationSource}
            loadDetail={loadDetail}
            loadRaw={loadRaw}
          />
        ),
      )}
      {metadata.length > 0 && <details className="turn-metadata">
        <summary>{t('trajectory.metadata', locale).replace('{n}', String(metadata.length))}</summary>
        <p className="hint">{t('trajectory.metadata.explanation', locale)}</p>
        {metadata.map((message) => <MessageCard key={message.eventId} locale={locale} sessionKey={sessionKey}
          message={message} loadDetail={loadDetail} loadRaw={loadRaw} />)}
      </details>}
    </div>
  );
}
