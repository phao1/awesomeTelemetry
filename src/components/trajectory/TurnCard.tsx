import { useMemo } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { DurationSource, TraceEvent, TraceEventRaw, TraceTurn, TurnMessage } from '../../core/trace-types.js';
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
  const items = useMemo(() => groupMessages(turn.messages), [turn.messages]);
  const meta = useMemo(() => {
    let input = 0;
    let cacheRead = 0;
    let output = 0;
    for (const message of turn.messages) {
      if (message.tokens !== null) {
        input += message.tokens.input;
        cacheRead += message.tokens.cacheRead;
        output += message.tokens.output;
      }
    }
    return { input, cacheRead, output };
  }, [turn.messages]);

  return (
    <div
      className="turn-card"
      role="region"
      aria-label={t('trajectory.turn.title', locale).replace('{index}', String(turn.index))}
    >
      <div className="trajectory-turn-meta mono">
        {t('trajectory.pill.input', locale)} {meta.input.toLocaleString()} ·{' '}
        {t('trajectory.pill.cacheRate', locale)} {meta.cacheRead.toLocaleString()} ·{' '}
        {t('trajectory.pill.output', locale)} {meta.output.toLocaleString()} ·{' '}
        {t('trajectory.turn.messages', locale).replace('{n}', String(turn.messageCount))}
      </div>
      {items.length === 0 && (
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
            durationSource={durationSource}
            loadDetail={loadDetail}
            loadRaw={loadRaw}
          />
        ),
      )}
    </div>
  );
}
