import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeToolObservationPage } from '../core/native-tool-observations.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { fetchNativeToolObservations } from '../api/native-tool-observations.js';

const copy = {
  zh: { title: '同一原生 ID 的跨页证据', hint: '这是保留引用，不证明完整执行、重试、成功或实测耗时。仅选中会话与明确 scope；正文仍需单独读取。', retained_reference: '保留引用一致', incomplete: '证据不完整', ambiguous: '引用存在歧义', unresolved: '未找到绑定事件', loading: '正在读取跨页元数据…', refresh: '刷新跨页证据', previous: '上一组证据', next: '下一组证据', cancel: '取消读取', cancelled: '已取消读取，请显式刷新。', timeout: '读取超过 5 秒，请显式刷新。', failed: '跨页读取失败', empty: '本页没有保留成员', choose: '选择原始事件', total: '全部匹配事件', selected: '选择', locators: '本页原生定位', retry: '重试跨页读取' },
  en: { title: 'Cross-page evidence for the same native ID', hint: 'Retained references do not prove complete execution, retry, success or measured latency. Only the selected session and exact scope are searched. Read each body separately.', retained_reference: 'Consistent retained references', incomplete: 'Incomplete evidence', ambiguous: 'Ambiguous references', unresolved: 'No bound event found', loading: 'Reading cross-page metadata…', refresh: 'Refresh cross-page evidence', previous: 'Previous evidence page', next: 'Next evidence page', cancel: 'Cancel read', cancelled: 'Read cancelled. Refresh explicitly.', timeout: 'Read exceeded 5 seconds. Refresh explicitly.', failed: 'Cross-page read failed', empty: 'No retained member on this page', choose: 'Select original event', total: 'All matching events', selected: 'Select', locators: 'Native locators on this page', retry: 'Retry cross-page read' },
} as const;
type Props = { sessionKey: string; identity: NativeToolObservationPage['identity']; locale: Locale; onSelect: (event: TraceEventSlim) => void };

/** The owner unmounts this panel on source invalidation or native group change. */
export function NativeToolObservationsPanel({ sessionKey, identity, locale, onSelect }: Props) {
  const c = copy[locale];
  const [page, setPage] = useState<NativeToolObservationPage | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0), [history, setHistory] = useState<number[]>([]);
  const ownership = useRef(0), controller = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => { ownership.current++; controller.current?.abort(); controller.current = null; if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const { namespace, value, scope } = identity;
  const load = useCallback(async (at: number) => {
    cancel(); const owner = ownership.current, abort = new AbortController(); controller.current = abort;
    setCursor(at); setPage(null); setError(null); setBusy(true);
    timer.current = setTimeout(() => { if (ownership.current === owner) { cancel(); setBusy(false); setError('TIMEOUT'); } }, 5000);
    try {
      const result = await fetchNativeToolObservations(sessionKey, { namespace, value, scope }, at, abort.signal);
      if (ownership.current === owner && !abort.signal.aborted) setPage(result);
    } catch (cause) { if (ownership.current === owner && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'READ_FAILED'); }
    finally { if (ownership.current === owner) { cancel(); setBusy(false); } }
  }, [cancel, sessionKey, namespace, value, scope]);
  useEffect(() => { setHistory([]); void load(0); return cancel; }, [load, cancel]);
  return <section className="native-tool-observations" aria-label={c.title}>
    <h3>{c.title}</h3><p className="hint">{c.hint}</p>
    <p className="mono">{namespace} · {value}<br />scope: {scope}</p>
    <div className="native-tool-actions">
      <button className="btn" type="button" disabled={busy} onClick={() => void load(cursor)}>{c.refresh}</button>
      <button className="btn" type="button" disabled={busy || history.length === 0} onClick={() => { const previous = [...history]; const at = previous.pop()!; setHistory(previous); void load(at); }}>{c.previous}</button>
      <button className="btn" type="button" disabled={busy || page?.hasMore !== true} onClick={() => { if (page?.nextCursor !== null && page?.nextCursor !== undefined) { setHistory(old => [...old, cursor]); void load(page.nextCursor); } }}>{c.next}</button>
      {busy && <button className="btn" type="button" onClick={() => { cancel(); setBusy(false); setError('CANCELLED'); }}>{c.cancel}</button>}
    </div>
    {busy && <p role="status">{c.loading}</p>}
    {error !== null && <div role="alert"><p>{error === 'TIMEOUT' ? c.timeout : error === 'CANCELLED' ? c.cancelled : c.failed + ' · ' + error}</p><button className="btn" type="button" onClick={() => void load(cursor)}>{c.retry}</button></div>}
    {page !== null && <>
      <p role="status">{c[page.state]} · {c.total}: {page.eventTotal} · {page.events.length === 0 ? '0' : '#' + page.events[0]!.sequence + '–#' + page.events.at(-1)!.sequence}</p>
      {!page.completeness.complete && <p className="tool-notice">{c.incomplete} · {page.completeness.reasons.join(' · ')}</p>}
      <nav aria-label={c.choose} className="native-tool-members">{page.events.map(event => <button className="btn" type="button" key={event.id} onClick={() => onSelect(event)}>
        {c.selected} #{event.sequence} · {event.tool ?? event.title} · {event.status}<code>{event.id}</code>
      </button>)}</nav>
      {page.events.length === 0 && <p>{c.empty}</p>}
      <details><summary>{c.locators} · {page.identities.length}</summary>{page.identities.map(item => <p className="mono" key={item.id}>{item.eventId} · {item.sourcePath}</p>)}</details>
    </>}
  </section>;
}
