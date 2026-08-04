import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  TraceEvent,
  TraceEventRaw,
  TraceEventSlim,
} from '../core/trace-types.js';
import { api } from '../api/client.js';
import { eventDetailCache } from '../cache/caches.js';
import { ErrorState, Skeleton } from './ui/States.js';
import { Tabs } from './ui/Tabs.js';

export interface EventInspectorProps {
  sessionKey: string;
  event: TraceEventSlim | null;
  locale: Locale;
  fontPx: number;
  width: number;
  collapsed: boolean;
  onResize: (width: number) => void;
  onToggleCollapse: () => void;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent | TraceEventRaw>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
  onOpenTranscript: (event: TraceEventSlim) => void;
  onOpenTokens: (event: TraceEventSlim) => void;
  onClose: () => void;
}

type InspectorTab = 'summary' | 'input' | 'output' | 'raw' | 'tokens';

/** REQ-017 ⑤：右侧详情面板。分页签 Summary/Input/Output/Raw/Tokens；Raw 按需拉取。 */
export function EventInspector({
  sessionKey,
  event,
  locale,
  fontPx,
  width,
  collapsed,
  onResize,
  onToggleCollapse,
  loadDetail = (key, eventId) => api.eventDetail(key, eventId),
  loadRaw = (key, eventId) => api.eventDetail(key, eventId, true) as Promise<TraceEventRaw>,
  onOpenTranscript,
  onOpenTokens,
  onClose,
}: EventInspectorProps): React.JSX.Element {
  const [detail, setDetail] = useState<TraceEvent | TraceEventRaw | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [tab, setTab] = useState<InspectorTab>('summary');
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (event === null) {
      setDetail(null);
      setRaw(null);
      setTab('summary');
      setError(null);
      return;
    }
    const cached = eventDetailCache.get(`${sessionKey}:${event.id}`);
    if (cached !== undefined) {
      setDetail(cached);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      void loadDetail(sessionKey, event.id)
        .then((loaded) => {
          eventDetailCache.set(`${sessionKey}:${event.id}`, loaded);
          setDetail(loaded);
          setError(null);
        })
        .catch((err: unknown) => {
          console.error('[inspector] 事件正文加载失败:', err);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [sessionKey, event, loadDetail]);

  // REQ-017 ⑤：Raw 页签切到才请求（include=raw）
  useEffect(() => {
    if (tab !== 'raw' || event === null || raw !== null || rawLoading) {
      return;
    }
    setRawLoading(true);
    void loadRaw(sessionKey, event.id)
      .then((loaded) => {
        setRaw(loaded.raw);
        setRawLoading(false);
      })
      .catch((err: unknown) => {
        console.error('[inspector] raw 拉取失败:', err);
        setRawLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [tab, raw, rawLoading, sessionKey, event, loadRaw]);

  const onMouseDown = (e: ReactMouseEvent<HTMLElement>): void => {
    if (collapsed) {
      return;
    }
    dragRef.current = { startX: e.clientX, startWidth: width };
    const onMove = (ev: globalThis.MouseEvent): void => {
      if (dragRef.current !== null) {
        onResize(
          Math.max(280, Math.min(900, dragRef.current.startWidth + (dragRef.current.startX - ev.clientX))),
        );
      }
    };
    const onUp = (): void => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (event === null) {
    return (
      <aside className="inspector" style={{ width: collapsed ? 0 : width }}>
        <div className="drag-handle" onMouseDown={onMouseDown} />
        <p className="hint">{t('common.empty', locale)}</p>
      </aside>
    );
  }

  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'input', label: t('event.input', locale) },
    { id: 'output', label: t('event.output', locale) },
    { id: 'raw', label: t('event.raw', locale) },
    { id: 'tokens', label: t('event.tokens', locale) },
  ];

  const retry = (): void => {
    setError(null);
    setDetail(null);
    void loadDetail(sessionKey, event.id)
      .then((loaded) => {
        eventDetailCache.set(`${sessionKey}:${event.id}`, loaded);
        setDetail(loaded);
      })
      .catch((err: unknown) => {
        console.error('[inspector] 重试失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <aside className="inspector" style={{ width: collapsed ? 0 : width }}>
      <div className="drag-handle" onMouseDown={onMouseDown} />
      <header className="inspector-header">
        <span className="mono">#{event.sequence}</span>
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
          <button type="button" className="ui-icon-btn ui-btn-sm" aria-label="collapse panel" onClick={onToggleCollapse}>
            ⇥
          </button>
          <button type="button" className="ui-icon-btn ui-btn-sm" aria-label="close" onClick={onClose}>
            ×
          </button>
        </span>
      </header>
      <div className="inspector-tabs">
        <Tabs
          variant="underline"
          activeId={tab}
          onChange={(id) => setTab(id as InspectorTab)}
          items={tabs}
        />
      </div>
      <div className="inspector-body" style={{ fontSize: fontPx }}>
        <h4 className="inspector-title">{event.title}</h4>
        <p className="meta">
          {event.kind} · {event.phase} · {event.status} · {event.durationMs}ms
        </p>
        {error !== null && <ErrorState code="EVENT_DETAIL_FAILED" message={error} onRetry={retry} />}
        {error === null && detail === null && <Skeleton variant="block" count={2} />}
        {error === null && detail !== null && (
          <>
            {tab === 'summary' && (
              <div>
                <p>{event.actor} · {event.tool ?? '—'}</p>
                {event.error !== null && (
                  <section>
                    <h5>{t('event.error', locale)}</h5>
                    <pre className="mono">{event.error}</pre>
                  </section>
                )}
                <div className="inspector-actions">
                  <button type="button" className="btn" onClick={() => onOpenTranscript(event)}>
                    {t('transcript.title', locale)}
                  </button>
                  <button type="button" className="btn" onClick={() => onOpenTokens(event)}>
                    {t('token.title', locale)}
                  </button>
                </div>
              </div>
            )}
            {tab === 'input' &&
              (detail.inputSummary === null ? (
                <p className="hint">{t('common.empty', locale)}</p>
              ) : (
                <pre>{detail.inputSummary}</pre>
              ))}
            {tab === 'output' &&
              (detail.outputSummary === null ? (
                <p className="hint">{t('common.empty', locale)}</p>
              ) : (
                <pre>{detail.outputSummary}</pre>
              ))}
            {tab === 'raw' &&
              (rawLoading ? (
                <Skeleton variant="block" count={1} />
              ) : raw === null ? (
                <p className="hint">{t('common.empty', locale)}</p>
              ) : (
                <pre className="mono">{raw}</pre>
              ))}
            {tab === 'tokens' &&
              (event.tokens === null ? (
                <p className="hint">{t('common.empty', locale)}</p>
              ) : (
                <table className="ui-table ui-table-compact">
                  <tbody>
                    {(['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total'] as const).map((key) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td className="mono">{event.tokens![key]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </>
        )}
      </div>
    </aside>
  );
}
