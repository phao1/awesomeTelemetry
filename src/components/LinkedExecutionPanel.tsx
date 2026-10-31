import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { LinkedExecutionPage, TraceEvent, TraceEventSlim } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { t, type Locale } from '../i18n.js';
import { ErrorState, Skeleton } from './ui/States.js';
import { CaptureTimingPanel } from './CaptureTimingPanel.js';

const timingCopy = {
  en: { title: 'Native and proxy timing', native: 'Normalized log duration', declaration: 'Session declaration',
    hint: 'This is the retained session declaration, not provenance for each event. Per-event measurement provenance is unknown. Zero does not prove a measured zero; it can also mean an absent endpoint or no derived interval.',
    separate: 'Values are independent observations, not proof of the same call or measured tool execution. No cross-clock subtraction, speed ratio or billing deduction is made.',
    select: 'Select a native event to show its normalized log duration beside the selected capture.', derived: 'derived', measured: 'measured', unknown: 'unknown' },
  zh: { title: '原生与代理时序', native: '规范化日志时长', declaration: '会话来源声明',
    hint: '此处仅为保留的会话级声明，不是每条事件的测量证明；逐事件测量来源未知。0 不证明实测为零，也可能表示缺少结束点或没有推导区间。',
    separate: '两侧为独立观测，不证明同一次调用或工具实测耗时；不跨时钟相减、不计算速度倍数或推断计费身份。',
    select: '选择一条原生事件，在选定抓包旁查看其规范化日志时长。', derived: '推导（derived）', measured: '测量（measured）', unknown: '未知（unknown）' },
} as const;

type PageParams = { eventOffset?: number; captureCursor?: number };
interface Props {
  sessionKey: string;
  locale: Locale;
  onOpenRequest: (id: number) => void;
  invalidateKey?: number;
}

/** Mounted by explicit exploration only; changing source drops all owned evidence. */
export function LinkedExecutionPanel(props: Props): React.JSX.Element {
  return <Execution key={props.sessionKey} {...props} />;
}

function NativeEvents({ events, locale, onSelect }: {
  events: TraceEventSlim[]; locale: Locale; onSelect: (event: TraceEventSlim) => void;
}): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(events.length, 32, 10, 320);
  return <div ref={containerRef} onScroll={onScroll} tabIndex={0}
    aria-label={t('trace.execution.events', locale)} style={{ height: 320, overflow: 'auto' }}>
    <div style={{ height: range.totalHeight, position: 'relative' }}>
      <div style={{ transform: `translateY(${range.offsetY}px)` }}>
        {events.slice(range.startIndex, range.endIndex).map(event => <button key={event.id}
          type="button" className="btn mono" data-execution-event={event.id}
          title={`${event.startedAt ?? '—'} · ${event.turnKey ?? '—'} · ${event.title}`}
          style={{ display: 'block', width: '100%', height: 32, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onClick={() => onSelect(event)}>
          #{event.sequence} · {event.kind} · {event.title} · {event.durationMs === null ? '—' : `${event.durationMs} ms`}
        </button>)}
      </div>
    </div>
  </div>;
}

function Matches({ matches }: { matches: LinkedExecutionPage['attempts'][number]['matches'] }): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(matches.length, 64, 10, 256);
  return <div ref={containerRef} onScroll={onScroll} tabIndex={0} style={{ height: Math.min(256, matches.length * 64), overflow: 'auto' }}>
    <div style={{ height: range.totalHeight }}><div style={{ transform: `translateY(${range.offsetY}px)` }}>
      {matches.slice(range.startIndex, range.endIndex).map(match => <div className="mono" key={`${match.scanIdentityId}:${match.proxyIdentityId}`}
        style={{ height: 64, overflow: 'hidden' }} title={`${match.eventId} · ${match.namespace} · ${match.kind} · ${match.value} · scope: ${match.scope}\nscan: ${match.scanIdentityId} · proxy: ${match.proxyIdentityId}`}>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{match.eventId} · {match.namespace} · {match.kind} · {match.value} · scope: {match.scope}</div>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>scan: {match.scanIdentityId}</div>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>proxy: {match.proxyIdentityId}</div>
      </div>)}
    </div></div>
  </div>;
}

function Execution({ sessionKey, locale, onOpenRequest, invalidateKey = 0 }: Props): React.JSX.Element {
  const [page, setPage] = useState<LinkedExecutionPage | null>(null);
  const [params, setParams] = useState<PageParams>({});
  const [loadedVersion, setLoadedVersion] = useState(invalidateKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TraceEventSlim | null>(null);
  const [detail, setDetail] = useState<TraceEvent | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const version = useRef(invalidateKey);
  version.current = invalidateKey;
  const pageGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const pageController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopDetail = useCallback(() => {
    detailGeneration.current += 1;
    detailController.current?.abort(); detailController.current = null;
    if (detailTimer.current !== null) clearTimeout(detailTimer.current);
    detailTimer.current = null;
  }, []);
  const stopPage = useCallback(() => {
    pageGeneration.current += 1;
    pageController.current?.abort(); pageController.current = null;
    if (pageTimer.current !== null) clearTimeout(pageTimer.current);
    pageTimer.current = null;
  }, []);
  const load = useCallback(async (next: PageParams = {}) => {
    stopPage(); stopDetail();
    const generation = pageGeneration.current; const atVersion = version.current;
    const controller = new AbortController(); pageController.current = controller;
    setPage(null); setSelected(null); setDetail(null); setDetailError(null); setDetailBusy(false);
    setAttemptId(null); setParams(next); setError(null); setBusy(true);
    pageTimer.current = setTimeout(() => {
      if (pageGeneration.current !== generation) return;
      stopPage(); setBusy(false); setError('EXECUTION_TIMEOUT');
    }, 5000);
    try {
      const result = await api.linkedExecution(sessionKey, next, controller.signal);
      if (pageGeneration.current !== generation || version.current !== atVersion || controller.signal.aborted) return;
      setPage(result); setLoadedVersion(atVersion);
    } catch (cause: unknown) {
      if (pageGeneration.current === generation && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pageGeneration.current === generation) { stopPage(); setBusy(false); }
    }
  }, [sessionKey, stopDetail, stopPage]);
  useEffect(() => {
    stopPage(); stopDetail(); setBusy(false); setDetailBusy(false);
    // Do not automatically refresh a revoked/changed relation or keep its body open.
    setSelected(null); setDetail(null); setAttemptId(null);
  }, [invalidateKey, stopPage, stopDetail]);
  useEffect(() => { void load(); return () => { stopPage(); stopDetail(); }; }, [load, stopPage, stopDetail]);

  const openEvent = async (event: TraceEventSlim): Promise<void> => {
    stopDetail();
    const generation = detailGeneration.current; const atVersion = version.current;
    const controller = new AbortController(); detailController.current = controller;
    setSelected(event); setDetail(null); setDetailError(null); setDetailBusy(true);
    detailTimer.current = setTimeout(() => {
      if (detailGeneration.current !== generation) return;
      stopDetail(); setDetailBusy(false); setDetailError('EVENT_TIMEOUT');
    }, 5000);
    try {
      const value = await api.eventDetail(sessionKey, event.id, false, controller.signal);
      if (detailGeneration.current !== generation || version.current !== atVersion || controller.signal.aborted) return;
      setDetail(value);
    } catch (cause: unknown) {
      if (detailGeneration.current === generation && !controller.signal.aborted) setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (detailGeneration.current === generation) { stopDetail(); setDetailBusy(false); }
    }
  };
  const stale = loadedVersion !== invalidateKey;
  const shown = stale ? null : page;
  const attempt = shown?.attempts.find(item => item.request.id === attemptId);
  const copy = timingCopy[locale];
  return <section aria-label={t('trace.execution.title', locale)}>
    <h3>{t('trace.execution.title', locale)}</h3>
    <p className="hint">{t('trace.execution.hint', locale)}</p>
    <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{t('trace.execution.refresh', locale)}</button>
    {stale && <p role="status">{t('trace.links.stale', locale)}</p>}
    {busy && <Skeleton count={2} />}
    {error !== null && <ErrorState code="EXECUTION_FAILED" message={error === 'EXECUTION_TIMEOUT' ? t('trace.execution.timeout', locale) : error} onRetry={() => void load(params)} />}
    {shown !== null && <>
      {!shown.identityCompleteness.complete && <p role="status">{t('trace.links.incomplete', locale)}: {shown.identityCompleteness.reasons.join(', ')}</p>}
      <h4>{t('trace.execution.events', locale)} · {shown.eventOffset + shown.events.length}/{shown.eventTotal}</h4>
      <p className="hint">{t('trace.execution.nativeHint', locale)}</p>
      <p className="hint">{copy.declaration}: {copy[shown.sessionDurationSource]} · {copy.hint}</p>
      {shown.events.length === 0 ? <p>{t('trace.execution.noEvents', locale)}</p> : <NativeEvents key={shown.eventOffset} events={shown.events} locale={locale} onSelect={event => void openEvent(event)} />}
      {shown.eventsHasMore && <button className="btn" type="button" onClick={() => void load({ ...params, eventOffset: shown.eventOffset + shown.events.length })}>{t('trace.execution.nextEvents', locale)}</button>}
      {selected !== null && <section aria-label={t('trace.execution.detail', locale)}>
        <h4>{selected.title}</h4>
        <p className="mono">{selected.id} · {selected.kind} · {selected.status} · {selected.startedAt ?? '—'}</p>
        <p className="mono">turnKey: {selected.turnKey ?? '—'}</p>
        {detailBusy && <Skeleton count={1} />}
        {detailError !== null && <ErrorState code="EVENT_DETAIL_FAILED" message={detailError === 'EVENT_TIMEOUT' ? t('trace.execution.timeout', locale) : detailError} onRetry={() => void openEvent(selected)} />}
        {detail !== null && <><h5>{t('event.input', locale)}</h5><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.inputSummary ?? '—'}</pre>
          <h5>{t('event.output', locale)}</h5><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.outputSummary ?? '—'}</pre></>}
      </section>}
      <h4>{t('trace.execution.captures', locale)} · {shown.attempts.length}</h4>
      {shown.attempts.length === 0 && <p>{t('trace.links.empty', locale)}</p>}
      {shown.attempts.map(item => <div key={item.association.id}>
        <button className="btn mono" type="button" onClick={() => onOpenRequest(item.request.id)}>#{item.request.id} · {item.request.model ?? '—'} · {item.request.hostname}</button>
        <button className="btn" type="button" aria-expanded={attemptId === item.request.id} onClick={() => setAttemptId(attemptId === item.request.id ? null : item.request.id)}>
          {t(item.association.state === 'direct' ? 'trace.links.direct' : 'trace.links.confirmed', locale)} · {t('trace.execution.matches', locale)}: {item.matches.length}
        </button>
      </div>)}
      {shown.capturesHasMore && shown.nextCaptureCursor !== null && <button className="btn" type="button" onClick={() => void load({ ...params, captureCursor: shown.nextCaptureCursor! })}>{t('trace.execution.nextCaptures', locale)}</button>}
      {attempt !== undefined && <section aria-label={t('trace.execution.matches', locale)}>
        <p className="hint mono">{attempt.association.reason} · {attempt.association.evidenceIds.join(', ') || '—'}</p>
        <p className="hint">{t('trace.execution.matchHint', locale)}</p>
        {attempt.matches.length === 0 && <p>{t('trace.execution.unbound', locale)}</p>}
        <Matches matches={attempt.matches} />
        <section aria-label={copy.title}>
          <h4>{copy.title}</h4>
          <p className="hint">{copy.separate}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <section aria-label={copy.native}>
              <h5>{copy.native}</h5>
              {selected === null ? <p>{copy.select}</p> : <p className="mono">{selected.id} · {selected.durationMs} ms</p>}
              <p>{copy.declaration}: {copy[shown.sessionDurationSource]}</p>
              <p className="hint">{copy.hint}</p>
            </section>
            <CaptureTimingPanel timing={attempt.transport?.timing} locale={locale} />
          </div>
        </section>
      </section>}
    </>}
  </section>;
}
