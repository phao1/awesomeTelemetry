import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { TraceEvent, TraceEventRaw, TraceSession, TurnMessage } from '../../core/trace-types.js';
import { t, type Locale } from '../../i18n.js';
import { LAYOUT_KEYS, LAYOUT_RANGES, loadNumber, storeNumber } from '../../layout.js';
import { pushOverlay } from '../../keyboard.js';
import { IconClose } from '../icons/index.js';
import { MessageCard } from './MessageCard.js';
import { eventDetailCache } from '../../cache/caches.js';

export interface RecordInspectorProps {
  sessionKey: string;
  session: TraceSession;
  message: TurnMessage;
  locale: Locale;
  onClose: () => void;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** Additive selected-record evidence panel; it never expands/fetches sibling messages. */
export function RecordInspector({ sessionKey, session, message, locale, onClose, loadDetail, loadRaw, restoreFocusRef }: RecordInspectorProps): React.JSX.Element {
  const [width, setWidth] = useState(() => loadNumber(LAYOUT_KEYS.inspectorWidth, 420, LAYOUT_RANGES.inspectorWidth));
  const [revision, setRevision] = useState(0);
  const [maxHeight, setMaxHeight] = useState(Math.max(160,window.innerHeight - 116));
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const maximum = useCallback((): number => {
    const narrow = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 70em)').matches : window.innerWidth <= 1120;
    return Math.min(900, narrow ? window.innerWidth * 0.9 : (panelRef.current?.parentElement?.clientWidth || window.innerWidth) * 0.6);
  }, []);
  const clamp = useCallback((value: number): number => Math.max(Math.min(280, maximum()), Math.min(maximum(), value)), [maximum]);

  useEffect(() => { storeNumber(LAYOUT_KEYS.inspectorWidth, width); }, [width]);
  useEffect(() => pushOverlay(onClose), [onClose]);
  useLayoutEffect(() => {
    const update = (): void => {
      setWidth(value => clamp(value));
      const tokens = getComputedStyle(document.documentElement);
      const footer = Number.parseFloat(tokens.getPropertyValue('--statusbar-height')) || 28;
      const gap = Number.parseFloat(tokens.getPropertyValue('--space-2')) || 8;
      const top = panelRef.current?.getBoundingClientRect().top ?? 0;
      setMaxHeight(Math.max(160,Math.floor(window.innerHeight - Math.max(0,top) - footer - gap)));
    };
    update(); window.addEventListener('resize', update);
    const scroller = document.querySelector('.session-scroll');
    let frame = 0;
    const schedule = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    scroller?.addEventListener('scroll',schedule,{passive:true});
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const parent = panelRef.current?.parentElement;
    if (parent) observer?.observe(parent);
    return () => { window.removeEventListener('resize', update); scroller?.removeEventListener('scroll',schedule); cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [clamp]);
  useEffect(() => {
    const previous = restoreFocusRef?.current ?? document.activeElement;
    closeRef.current?.focus();
    return () => {
      stopDrag.current?.();
      const target = restoreFocusRef?.current ?? previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [restoreFocusRef]);

  return <aside ref={panelRef} className="record-inspector" aria-label={t('investigation.inspector', locale)} style={{ width, maxHeight }}>
    <div className="record-inspector-resize" role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={t('investigation.resize', locale)} aria-valuemin={Math.min(280,maximum())} aria-valuemax={Math.round(maximum())} aria-valuenow={Math.round(width)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        setWidth(value => clamp(event.key === 'Home' ? 280 : event.key === 'End' ? 900 : value + (event.key === 'ArrowLeft' ? 16 : -16)));
      }}
      onMouseDown={event => {
        event.preventDefault(); stopDrag.current?.();
        const startX = event.clientX; const initial = width;
        const move = (next: MouseEvent): void => setWidth(clamp(initial + startX - next.clientX));
        const stop = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); stopDrag.current = null; };
        stopDrag.current = stop;
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
      }} />
    <header className="record-inspector-head">
      <div><h3>{t('investigation.inspector', locale)}</h3><span className="mono">#{message.sequence} · {message.tool ?? message.kind}</span></div>
      <button type="button" className="btn ui-btn-sm" onClick={() => {
        eventDetailCache.delete(`${sessionKey}:${message.eventId}`);
        eventDetailCache.delete(`${sessionKey}:${message.eventId}:raw`);
        setRevision(value => value + 1);
      }}>{t('investigation.refresh', locale)}</button>
      <button ref={closeRef} type="button" className="ui-icon-btn" aria-label={t('investigation.close', locale)} title={t('investigation.close', locale)} onClick={onClose}><IconClose size={16} /></button>
    </header>
    <div className="record-inspector-title" title={message.title}>{message.title || message.eventId}</div>
    <div className="record-inspector-id mono" aria-label={t('investigation.eventId', locale)}>{message.eventId}</div>
    <details className="record-inspector-source">
      <summary>{session.dataSource}/{session.provider} · {t('investigation.sourceDetails',locale)}</summary>
    <dl className="record-inspector-meta">
      <div><dt>{t('investigation.recordedAt', locale)}</dt><dd className="mono">{message.startedAt}</dd></div>
      <div><dt>{t('investigation.source', locale)}</dt><dd>{session.dataSource} / {session.provider} / {session.sourceAgent}</dd></div>
    </dl>
    <p className="record-inspector-boundary">{t('investigation.snapshot', locale)}</p>
    </details>
    <p className="record-inspector-boundary">{t('investigation.durationBoundary', locale)}</p>
    <p className="record-inspector-boundary">{t('investigation.snapshotShort', locale)}</p>
    <div className="record-inspector-body">
      <MessageCard key={`${sessionKey}:${message.eventId}:${revision}`} sessionKey={sessionKey} message={message} locale={locale}
        durationSource={session.durationSource} initialExpanded showHeader={false} initialView={message.hasInput && !message.hasOutput ? 'input' : 'rendered'}
        loadDetail={loadDetail} loadRaw={loadRaw} />
    </div>
  </aside>;
}
