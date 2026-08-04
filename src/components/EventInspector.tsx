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

export interface EventInspectorProps {
  sessionKey: string;
  event: TraceEventSlim | null;
  locale: Locale;
  fontPx: number;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent | TraceEventRaw>;
  onOpenTranscript: (event: TraceEventSlim) => void;
  onOpenTokens: (event: TraceEventSlim) => void;
  onClose: () => void;
}

/** REQ-008/G7.1：右侧详情面板，可拖拽调宽，单 event 下钻（200ms 防抖）。 */
export function EventInspector({
  sessionKey,
  event,
  locale,
  fontPx,
  loadDetail = (key, eventId) => api.eventDetail(key, eventId),
  onOpenTranscript,
  onOpenTokens,
  onClose,
}: EventInspectorProps) {
  const [width, setWidth] = useState(420);
  const [detail, setDetail] = useState<TraceEvent | TraceEventRaw | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (event === null) {
      setDetail(null);
      setError(null);
      return;
    }
    const cached = eventDetailCache.get(`${sessionKey}:${event.id}`);
    if (cached !== undefined) {
      setDetail(cached);
      setError(null);
      return;
    }
    // 200ms 防抖（REQ-003）
    const timer = setTimeout(() => {
      void loadDetail(sessionKey, event.id)
        .then((loaded) => {
          eventDetailCache.set(`${sessionKey}:${event.id}`, loaded);
          setDetail(loaded);
          setError(null);
        })
        .catch((err: unknown) => {
          // REQ-022：正文加载失败必须可诊断，与「本来为空」区分
          console.error('[inspector] 事件正文加载失败:', err);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [sessionKey, event, loadDetail]);

  const onMouseDown = (e: ReactMouseEvent<HTMLElement>): void => {
    dragRef.current = { startX: e.clientX, startWidth: width };
    const onMove = (ev: globalThis.MouseEvent): void => {
      if (dragRef.current !== null) {
        setWidth(Math.max(260, Math.min(900, dragRef.current.startWidth + (dragRef.current.startX - ev.clientX))));
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
      <aside className="inspector" style={{ width }}>
        <div className="drag-handle" onMouseDown={onMouseDown} />
        <p className="hint">{t('common.empty', locale)}</p>
      </aside>
    );
  }

  const raw = (detail as TraceEventRaw | null)?.raw ?? null;
  return (
    <aside className="inspector" style={{ width }}>
      <div className="drag-handle" onMouseDown={onMouseDown} />
      <header className="inspector-header">
        <span className="mono">#{event.sequence} {event.id}</span>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close', locale)}
        </button>
      </header>
      <div className="inspector-body" style={{ fontSize: fontPx }}>
        <p>{event.title}</p>
        <p className="meta">{event.kind} · {event.phase} · {event.status} · {event.durationMs}ms</p>
        {error !== null && (
          <ErrorState
            code="EVENT_DETAIL_FAILED"
            message={error}
            onRetry={() => {
              const cached = eventDetailCache.get(`${sessionKey}:${event.id}`);
              if (cached !== undefined) {
                setDetail(cached);
                return;
              }
              setError(null);
              void loadDetail(sessionKey, event.id)
                .then((loaded) => {
                  eventDetailCache.set(`${sessionKey}:${event.id}`, loaded);
                  setDetail(loaded);
                })
                .catch((err: unknown) => {
                  console.error('[inspector] 重试失败:', err);
                  setError(err instanceof Error ? err.message : String(err));
                });
            }}
          />
        )}
        {error === null && detail === null && <Skeleton variant="block" count={2} />}
        <div className="inspector-actions">
          <button type="button" className="btn" onClick={() => onOpenTranscript(event)}>
            {t('transcript.title', locale)}
          </button>
          <button type="button" className="btn" onClick={() => onOpenTokens(event)}>
            {t('token.title', locale)}
          </button>
        </div>
        {detail?.inputSummary !== null && detail?.inputSummary !== undefined && (
          <section>
            <h4>{t('event.input', locale)}</h4>
            <pre>{detail.inputSummary}</pre>
          </section>
        )}
        {detail?.outputSummary !== null && detail?.outputSummary !== undefined && (
          <section>
            <h4>{t('event.output', locale)}</h4>
            <pre>{detail.outputSummary}</pre>
          </section>
        )}
        {event.error !== null && (
          <section>
            <h4>{t('event.error', locale)}</h4>
            <pre>{event.error}</pre>
          </section>
        )}
        {raw !== null && (
          <section>
            <h4>{t('event.raw', locale)}</h4>
            <pre className="mono">{raw}</pre>
          </section>
        )}
      </div>
    </aside>
  );
}
