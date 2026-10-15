import { useEffect, useMemo, useRef, useState } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  DurationSource,
  TraceEvent,
  TraceEventRaw,
  TurnMessage,
} from '../../core/trace-types.js';
import { api } from '../../api/client.js';
import { eventDetailCache } from '../../cache/caches.js';
import { extractSubagentType } from '../../core/subagent-type.js';
import { ErrorState, Skeleton } from '../ui/States.js';
import { resolveToolRenderer } from './renderers/index.js';
import { ToolCallBlock, isCallShapedId } from './ToolCallBlock.js';
import { EventBody, readableContent } from './EventBody.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconCommand,
  IconCopy,
  IconGear,
  IconError,
  IconMessage,
  IconSuccess,
  IconThought,
  IconTool,
  IconUnderstand,
  type IconProps,
} from '../icons/index.js';

type CardView = 'rendered' | 'input' | 'output' | 'source' | 'raw';

const ROLE_ICON: Record<TurnMessage['role'], (props: IconProps) => React.JSX.Element> = {
  system: IconGear,
  user: IconCommand,
  assistant: IconMessage,
  tool: IconTool,
  reasoning: IconThought,
  compact: IconChevronDown,
  subagent: IconUnderstand,
};

const ROLE_NAME_KEY: Record<TurnMessage['role'], I18nKey> = {
  system: 'trajectory.role.system',
  user: 'trajectory.role.user',
  assistant: 'trajectory.role.assistant',
  tool: 'trajectory.role.tool',
  reasoning: 'trajectory.role.reasoning',
  compact: 'trajectory.role.compact',
  subagent: 'trajectory.role.subagent',
};

const VIEW_KEYS: Record<CardView, I18nKey> = {
  rendered: 'trajectory.view.rendered',
  input: 'trajectory.view.input',
  output: 'trajectory.view.output',
  source: 'trajectory.view.source',
  raw: 'trajectory.view.raw',
};

const defaultLoadDetail = (key: string, eventId: string): Promise<TraceEvent> =>
  api.eventDetail(key, eventId);
const defaultLoadRaw = (key: string, eventId: string): Promise<TraceEventRaw> =>
  api.eventDetail(key, eventId, true) as Promise<TraceEventRaw>;

function fmtDur(ms: number | null): string {
  return ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

function fmtTokens(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

export interface MessageCardProps {
  locale: Locale;
  sessionKey: string;
  /** 本卡对应的一条消息（一个事件）。 */
  message: TurnMessage;
  /** D4 assistant 卡聚合：同回合内其余 llm/reasoning 成员 + tool 消息。 */
  assistant?: { members: TurnMessage[]; toolCalls: TurnMessage[] };
  /** D7：时长口径行 —— durationSource !== 'native' 时渲染推导行。 */
  durationSource?: DurationSource;
  initialView?: 'rendered' | 'input' | 'output';
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
}

/**
 * D4/D12 消息卡。assistant 卡携带 reasoning（默认折叠）+ 回复 + 嵌套的
 * ToolCallBlock；tool 结果作为独立卡在 assistant 卡之后（同一个事件的两个
 * 渲染面，C15）。三态视图控制（渲染 / 源码 / Raw）替代被删除的 EventInspector：
 * 正文按事件首扩时拉取（100 项 LRU），Raw 单独按需拉取一次并同样缓存。
 * 四个状态（loading / empty / error+retry / success）全覆盖。
 */
export function MessageCard({
  locale,
  sessionKey,
  message,
  assistant,
  initialView = 'rendered',
  durationSource,
  loadDetail = defaultLoadDetail,
  loadRaw = defaultLoadRaw,
}: MessageCardProps): React.JSX.Element {
  const role = assistant !== undefined ? 'assistant' : message.role;
  const eventIds = useMemo(() => {
    if (assistant !== undefined) {
      return [...assistant.members, ...assistant.toolCalls].map((m) => m.eventId);
    }
    return [message.eventId];
  }, [assistant, message.eventId]);

  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<CardView>(initialView);
  const [details, setDetails] = useState<Map<string, TraceEvent>>(new Map());
  const [raws, setRaws] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [rawLoading, setRawLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** 首扩/重试触发一次拉取；重试时 +1 重新拉。 */
  const [loadToken, setLoadToken] = useState(0);
  const detailsRef = useRef<Map<string, TraceEvent>>(new Map());
  const rawsRef = useRef<Map<string, string>>(new Map());

  // compact 卡是单行，永不展开（D4 rule 4）。
  const isCompact = message.role === 'compact';
  const readableMembers = assistant ? [...assistant.members, ...assistant.toolCalls] : [message];
  const hasInput = readableMembers.some((m) => m.hasInput);
  const hasOutput = readableMembers.some((m) => m.hasOutput);
  const metadataOnly = !hasInput && !hasOutput && (assistant?.toolCalls.length ?? 0) === 0;
  const toolResultEmpty = role === 'tool' && !message.hasOutput && view === 'rendered';

  useEffect(() => {
    if (!expanded || isCompact || toolResultEmpty || metadataOnly) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const missing = eventIds.filter((id) => !detailsRef.current.has(id));
    if (missing.length === 0) {
      setLoading(false);
      return;
    }
    void Promise.all(
      missing.map((id) => {
        const cached = eventDetailCache.get(`${sessionKey}:${id}`);
        if (cached !== undefined) {
          detailsRef.current.set(id, cached);
          setDetails(new Map(detailsRef.current));
          return Promise.resolve();
        }
        return loadDetail(sessionKey, id)
          .then((loaded) => {
            eventDetailCache.set(`${sessionKey}:${id}`, loaded);
            if (!cancelled) {
              detailsRef.current.set(id, loaded);
              setDetails(new Map(detailsRef.current));
            }
          })
          .catch((err: unknown) => {
            console.error('[message-card] 事件正文加载失败:', err);
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err));
            }
          });
      }),
    ).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, isCompact, toolResultEmpty, eventIds, loadToken, sessionKey, loadDetail, metadataOnly]);

  useEffect(() => {
    if (!expanded || view !== 'raw' || isCompact) {
      return;
    }
    let cancelled = false;
    const missing = eventIds.filter((id) => !rawsRef.current.has(id));
    if (missing.length === 0) {
      return;
    }
    setRawLoading(true);
    void Promise.all(
      missing.map((id) => {
        const cached = eventDetailCache.get(`${sessionKey}:${id}:raw`);
        if (cached !== undefined && 'raw' in cached && cached.raw !== null) {
          rawsRef.current.set(id, cached.raw ?? '');
          setRaws(new Map(rawsRef.current));
          return Promise.resolve();
        }
        return loadRaw(sessionKey, id)
          .then((loaded) => {
            eventDetailCache.set(`${sessionKey}:${id}:raw`, loaded);
            if (!cancelled) {
              rawsRef.current.set(id, loaded.raw ?? '');
              setRaws(new Map(rawsRef.current));
            }
          })
          .catch((err: unknown) => {
            console.error('[message-card] raw 拉取失败:', err);
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err));
            }
          });
      }),
    ).finally(() => { if (!cancelled) setRawLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [expanded, view, isCompact, eventIds, loadToken, sessionKey, loadRaw]);

  const retry = (): void => {
    detailsRef.current = new Map();
    rawsRef.current = new Map();
    setDetails(new Map());
    setRaws(new Map());
    setError(null);
    setLoading(true);
    setLoadToken((prev) => prev + 1);
  };

  const copyText = (text: string): void => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((err: unknown) => {
        console.error('[message-card] 复制失败:', err);
      });
  };

  const RoleIcon = ROLE_ICON[role];

  // ---- 单行 compact 卡（D4 rule 4） ----
  if (isCompact) {
    return (
      <article className="message-card message-card-role-compact">
        <header className="message-card-header">
          <span className="message-card-role-marker">
            <RoleIcon size={12} />
            {t(ROLE_NAME_KEY.compact, locale)}
          </span>
          <span className="gantt-title" title={message.title}>
            {message.title}
          </span>
          <span className="message-card-meta mono">
            {message.tokens === null
              ? '—'
              : t('trajectory.compact.summary', locale).replace(
                  '{d}',
                  message.tokens !== null && message.tokens.total > 0
                    ? t('trajectory.compact.delta', locale).replace('{n}', message.tokens.total.toLocaleString())
                    : '',
                )}
          </span>
        </header>
      </article>
    );
  }

  const members = assistant !== undefined ? assistant.members : [message];
  const detailOf = (id: string): TraceEvent | null => details.get(id) ?? null;
  const rawOf = (id: string): string | null => raws.get(id) ?? null;

  const reasoningText = assistant
    ?.members.filter((m) => m.role === 'reasoning')
    .map((m) => detailOf(m.eventId)?.outputSummary ?? null)
    .filter((text): text is string => text !== null)
    .join('\n\n') ?? null;
  const replyText =
    members
      .filter((m) => m.role === 'assistant')
      .map((m) => detailOf(m.eventId)?.outputSummary ?? null)
      .filter((text): text is string => text !== null)
      .join('\n\n') ?? null;

  const bodyText = (() => {
    if (assistant !== undefined) {
      return eventIds
        .map((id) => {
          const d = detailOf(id);
          return [d?.inputSummary, d?.outputSummary].filter((s): s is string => s !== null);
        })
        .flat()
        .join('\n\n');
    }
    const d = detailOf(message.eventId);
    return [d?.inputSummary, d?.outputSummary].filter((s): s is string => s !== null).join('\n\n');
  })();

  const renderIO = (which?: 'input' | 'output'): React.JSX.Element => (
    <div className="message-card-io">
      {eventIds.map((id) => {
        const detail = detailOf(id);
        return <section key={id}>
          {eventIds.length > 1 && <h4 className="mono">{detail?.tool ?? detail?.title ?? id}</h4>}
          {which !== 'output' && (which === 'input' || readableMembers.find((m) => m.eventId === id)?.hasInput) && <><h4>{t('trajectory.view.input', locale)}</h4>
            {which ? <EventBody text={detail?.inputSummary ?? t('trajectory.body.notRecorded', locale)} /> : <pre className="mono">{detail?.inputSummary ?? t('trajectory.body.notRecorded', locale)}</pre>}</>}
          {which !== 'input' && (which === 'output' || readableMembers.find((m) => m.eventId === id)?.hasOutput) && <><h4>{t('trajectory.view.output', locale)}</h4>
            {which ? <EventBody text={detail?.outputSummary ?? t('trajectory.body.notRecorded', locale)} prose={role !== 'tool'} /> : <pre className="mono">{detail?.outputSummary ?? t('trajectory.body.notRecorded', locale)}</pre>}</>}
        </section>;
      })}
    </div>
  );

  const renderToolResult = (): React.JSX.Element => {
    const d = detailOf(message.eventId);
    const text = d?.outputSummary ?? null;
    if (!message.hasOutput && view === 'rendered') {
      return <p className="message-card-empty">{t('trajectory.toolResult.empty', locale)}</p>;
    }
    if (text === null) {
      return <p className="message-card-empty">{t('trajectory.toolResult.empty', locale)}</p>;
    }
    const renderer = resolveToolRenderer(message.tool);
    const rendered = renderer !== null ? renderer.renderResult(readableContent(text)) : null;
    if (rendered !== null && rendered.kind === 'ok') {
      return <div>{rendered.node}</div>;
    }
    return (
      <>
        {rendered?.kind === 'fallback' && (
          <span className="message-card-raw-marker">{t('trajectory.rawMarker', locale)}</span>
        )}
        <EventBody text={text} prose={role !== 'tool'} />
      </>
    );
  };

  const renderRendered = (): React.JSX.Element => {
    if (role === 'tool') {
      return renderToolResult();
    }
    if (role === 'subagent') {
      const d = detailOf(message.eventId);
      const type = extractSubagentType(d?.inputSummary ?? message.title);
      return (
        <p className="message-card-empty">
          {type === 'unknown' ? t('trajectory.agent.unknown', locale) : type}
          {' · '}
          {message.title}
        </p>
      );
    }
    if (role === 'assistant') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {reasoningText !== null && reasoningText !== '' && (
            <details className="message-card-reasoning">
              <summary>
                <IconThought size={12} />
                {t('trajectory.reasoning.section', locale)}
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--fg-muted)' }}>
                  {t('trajectory.reasoning.tokens', locale).replace(
                    '{n}',
                    fmtTokens(
                      assistant
                        ?.members.filter((m) => m.role === 'reasoning')
                        .reduce(
                          (sum, m) => sum + (m.tokens === null ? 0 : m.tokens.total),
                          0,
                        ) ?? null,
                    ),
                  )}
                </span>
              </summary>
              <div className="message-card-body">
                <pre className="mono">{reasoningText}</pre>
              </div>
            </details>
          )}
          {replyText !== null && replyText !== '' ? (
            <EventBody text={replyText} prose />
          ) : (
            reasoningText === null && !assistant?.toolCalls.length && (
              <p className="message-card-empty">{t('trajectory.turn.empty', locale)}</p>
            )
          )}
          {assistant?.toolCalls.map((toolMessage) => (
            <ToolCallBlock
              key={toolMessage.eventId}
              message={toolMessage}
              sessionKey={sessionKey}
              locale={locale}
              detail={detailOf(toolMessage.eventId)}
              loading={loading}
              error={error}
              onRetry={retry}
            />
          ))}
        </div>
      );
    }
    const d = detailOf(message.eventId);
    const text =
      role === 'user'
        ? d?.inputSummary ?? null
        : d?.outputSummary ?? d?.inputSummary ?? null;
    if (text === null || text === '') {
      return <p className="message-card-empty">{t('trajectory.turn.empty', locale)}</p>;
    }
    return <EventBody text={text} prose />;
  };

  const rawText = eventIds.map((id) => rawOf(id)).filter((s): s is string => s !== null).join('\n\n');

  const isRawView = view === 'raw';

  return (
    <article className={`message-card message-card-role-${role} ${message.status === 'error' ? 'message-card-failed' : ''} ${metadataOnly ? 'message-card-metadata' : ''}`}>
      <header className="message-card-header">
        <button
          type="button"
          className="message-card-toggle"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('trajectory.turn.collapse', locale).replace('{index}', String(message.sequence))
              : t('trajectory.turn.expand', locale).replace('{index}', String(message.sequence))
          }
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        <span className="message-card-role-marker">
          <RoleIcon size={12} />
          {t(ROLE_NAME_KEY[role], locale)}
        </span>
        <span className="gantt-title" title={message.title}>
          {message.title || t(role === 'assistant' || role === 'reasoning' ? 'trajectory.reasoning.unavailable' : 'trajectory.metadata.event', locale)}
        </span>
        <span className="message-card-meta">
          {!(role === 'tool' && message.hasOutput && !message.hasInput) && <span className="mono" title={durationSource === 'derived' ? t('trajectory.criteria.durationDerived', locale) : undefined}>{fmtDur(message.durationMs)}</span>}
          {message.tokens !== null && <span className="mono">{fmtTokens(message.tokens.output)} tok</span>}
          {message.status === 'error' && <span className="message-status-error"><IconError size={12} />{t('trajectory.filter.errors', locale)}</span>}
          {role === 'tool' && <span className="message-card-direction">{t(message.hasInput && !message.hasOutput ? 'trajectory.tool.arguments' : 'trajectory.tool.result', locale)}</span>}
          <span className="message-event-id" title={message.eventId}>{isCallShapedId(message.eventId) ? message.eventId : `#${message.sequence}`}</span>
        </span>


        </button>
        {(['input', 'output'] as const).filter((target) => target === 'input' ? hasInput : hasOutput).map((target) => (
          <button key={target} type="button" className="btn ui-btn-sm"
            onClick={() => { setView(target); setExpanded(true); }}>
            {t(VIEW_KEYS[target], locale)}
          </button>
        ))}
      </header>
      {message.error && <p className="message-error-summary" role="status">{message.error}</p>}
      {expanded && (
        <div className="message-card-view-control" role="group" aria-label={t('trajectory.view.label', locale)}>
          {(['rendered', 'input', 'output', 'source', 'raw'] as const).filter((key) => key === 'raw' ? message.hasRaw : metadataOnly ? key === 'rendered' : key === 'input' ? hasInput : key === 'output' ? hasOutput : true).map((key) => (
            <button
              key={key}
              type="button"
              className={`timeline-chip ${view === key ? 'timeline-chip-on' : ''}`}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {t(VIEW_KEYS[key], locale)}
            </button>
          ))}
          {view === 'source' && bodyText !== '' && (
            <button
              type="button"
              className="ui-icon-btn ui-btn-sm"
              aria-label={t('trajectory.card.copy', locale)}
              onClick={() => copyText(bodyText)}
            >
              {copied ? <IconSuccess size={12} /> : <IconCopy size={12} />}
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="message-card-body">
          {error !== null && (
            <ErrorState code="EVENT_DETAIL_FAILED" message={error} onRetry={retry} />
          )}
          {error === null && (loading || (isRawView && rawLoading)) && !toolResultEmpty && <Skeleton variant="block" count={2} />}
          {error === null && !loading && !rawLoading && !toolResultEmpty && isRawView && (
            rawText === '' ? (
              <p className="hint">{t('common.empty', locale)}</p>
            ) : (
              <pre className="mono">{rawText}</pre>
            )
          )}
          {error === null && !loading && view === 'rendered' && (metadataOnly ? <p className="hint">{t(message.role === 'reasoning' ? 'trajectory.reasoning.unavailable' : message.title === 'token_count' ? 'trajectory.usageOnly' : 'trajectory.metadata.event', locale)}</p> : renderRendered())}
          {error === null && !loading && view === 'source' && renderIO()}
          {error === null && !loading && view === 'input' && renderIO('input')}
          {error === null && !loading && view === 'output' && renderIO('output')}
        </div>
      )}
    </article>
  );
}
