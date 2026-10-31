import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { buildToolInvestigation } from '../core/tool-investigation.js';
import type { LinkedExecutionPage, TraceEventRaw, TraceEvent, TraceEventSlim, ToolInspectionGroup } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import { Drawer } from './ui/Modal.js';
import { NativeToolObservationsPanel } from './NativeToolObservationsPanel.js';

const copy = {
  zh: { title: '工具执行调查台', intro: '沿日志顺序查看过程，按原生工具 ID 核对输入与输出。', hint: '只读日志证据；记录分组不等于执行次数，输出与状态不证明任务成功。', process: '本页执行过程', tools: '工具记录组', all: '全部过程', onlyTools: '仅工具', errors: '仅错误', search: '筛选本页工具名 / 原生 ID / 标题', refresh: '刷新证据', previous: '上一页', next: '下一页', scope: '事件范围', partial: '这是局部事件页；同一 ID 的其他记录可能在别页，缺少输出不代表未执行。', native_id: '同一原生 ID · 本页记录', missing_identity: '无明确原生 ID · 独立记录', incomplete: '身份依据不完整 · 独立记录', ambiguous_identity: '身份冲突 · 独立记录', inputs: '含输入', outputs: '含输出', missing: '本页未见输出 · 结果未知', choose: '选择工具组或过程事件查看详情', records: '保留事件', read: '读取事件正文', raw: '读取此事件 Raw', input: '输入', output: '输出', source: '原生身份与定位', time: '规范化日志区间', timeHint: '逐事件测量来源未知；不相减、不求和为工具实测耗时。', status: '日志状态', empty: '当前页没有符合条件的工具记录', noEvents: '没有保留事件', loading: '正在读取本地证据…', error: '证据读取失败', retry: '重试读取', timeout: '本地读取超过 5 秒，请显式重试。', stale: '来源已变化，旧证据已隐藏，请刷新。', local: '筛选仅作用于当前页元数据，不搜索正文', unknown: '未知', success: 'success（日志）', cancelled: 'cancelled（日志）', running: 'running（日志）', errorStatus: 'error（日志）', rawAbsent: '没有保留 Raw', bounded: '正文初始显示最多 64 KiB；原始事件记录保持不变。', more: '显示所选事件的其余已返回文本', capture: '打开已匹配抓包', context: '上下文事件', original: '原始事件 ID', selected: '选中事件', returned: '没有已返回的正文', noIdentity: '不从工具名、相邻位置或事件 ID 形态猜测原生身份。' },
  en: { title: 'Tool execution investigation', intro: 'Follow the recorded process and inspect inputs and outputs by native tool ID.', hint: 'Read-only log evidence. Groups are not execution counts; outputs and statuses do not prove task success.', process: 'Process on this page', tools: 'Tool record groups', all: 'Full process', onlyTools: 'Tools only', errors: 'Errors only', search: 'Filter loaded tool / native ID / title', refresh: 'Refresh evidence', previous: 'Previous page', next: 'Next page', scope: 'Event coverage', partial: 'This is a local event page. Other records for an ID may be elsewhere; absent output does not establish non-execution.', native_id: 'Same native ID · page records', missing_identity: 'No exact native ID · separate record', incomplete: 'Incomplete identity · separate record', ambiguous_identity: 'Conflicting identity · separate record', inputs: 'Input retained', outputs: 'Output retained', missing: 'No output on this page · outcome unknown', choose: 'Select a tool group or process event', records: 'Retained events', read: 'Read event body', raw: 'Read this event Raw', input: 'Input', output: 'Output', source: 'Native identity and locator', time: 'Normalized log interval', timeHint: 'Per-event measurement provenance is unknown. No subtraction or sum claims measured tool execution.', status: 'Log status', empty: 'No matching tool record on this page', noEvents: 'No retained event', loading: 'Reading local evidence…', error: 'Evidence read failed', retry: 'Retry local read', timeout: 'The local read exceeded 5 seconds. Retry explicitly.', stale: 'Source changed. Old evidence is hidden; refresh explicitly.', local: 'Filters use this page metadata, never body text', unknown: 'Unknown', success: 'success (log)', cancelled: 'cancelled (log)', running: 'running (log)', errorStatus: 'error (log)', rawAbsent: 'No retained Raw', bounded: 'Initial text is bounded to 64 KiB. Original event records stay unchanged.', more: 'Show remaining returned text for this event', capture: 'Open matched capture', context: 'Context event', original: 'Original event ID', selected: 'Selected event', returned: 'No returned body text', noIdentity: 'Tool names, adjacency and event-ID shapes never supply a native identity.' },
} as const;

function useOwnedRead<T>() {
  const [value, setValue] = useState<T | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const owner = useRef(0), abort = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => { owner.current++; abort.current?.abort(); abort.current = null; if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const reset = useCallback(() => { cancel(); setValue(null); setError(null); setBusy(false); }, [cancel]);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(async (load: (signal: AbortSignal) => Promise<T>) => {
    cancel(); const at = owner.current, controller = new AbortController(); abort.current = controller;
    setValue(null); setError(null); setBusy(true);
    timer.current = setTimeout(() => { if (owner.current === at) { cancel(); setBusy(false); setError('TIMEOUT'); } }, 5000);
    try { const result = await load(controller.signal); if (owner.current === at && !controller.signal.aborted) setValue(result); }
    catch (cause) { if (owner.current === at && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (owner.current === at) { cancel(); setBusy(false); } }
  }, [cancel]);
  return { value, error, busy, reset, run };
}

function Process({ events, selected, onSelect, label }: { events: TraceEventSlim[]; selected: string | null; onSelect: (event: TraceEventSlim) => void; label: string }) {
  const { containerRef, range, onScroll } = useVirtualList(events.length, 44, 5, 308);
  return <nav className="tool-process" aria-label={label} ref={containerRef} onScroll={onScroll} style={{ height: 308, overflow: 'auto' }}>
    <div style={{ height: range.totalHeight }}><div style={{ transform: 'translateY(' + range.offsetY + 'px)' }}>
      {events.slice(range.startIndex, range.endIndex).map(event => <button type="button" className={'tool-process-row' + (event.id === selected ? ' is-selected' : '')} key={event.id} onClick={() => onSelect(event)} title={event.id}>
        <span className="mono">#{event.sequence}</span><span>{event.kind}</span><strong>{event.tool ?? event.title}</strong><span>{event.status === 'error' ? '!' : '·'}</span>
      </button>)}
    </div></div>
  </nav>;
}

type Props = { sessionKey: string; locale: Locale; invalidateKey?: number; onClose: () => void; onOpenRequest: (id: number) => void };
export function ToolExecutionPanel(props: Props): React.JSX.Element { return <Investigation key={props.sessionKey} {...props} />; }
function Investigation({ sessionKey, locale, invalidateKey = 0, onClose, onOpenRequest }: Props) {
  const c = copy[locale], page = useOwnedRead<LinkedExecutionPage>(), body = useOwnedRead<TraceEvent | TraceEventRaw>();
  const [offset, setOffset] = useState(0), [history, setHistory] = useState<number[]>([]);
  const [groupKey, setGroupKey] = useState<string | null>(null), [selected, setSelected] = useState<TraceEventSlim | null>(null);
  const [observationsOpen, setObservationsOpen] = useState(false);
  const [query, setQuery] = useState(''), [mode, setMode] = useState('all'), [raw, setRaw] = useState(false), [font, setFont] = useState(14), [expandedText, setExpandedText] = useState(false);
  const [stale, setStale] = useState(false), version = useRef(invalidateKey), previous = useRef(invalidateKey); version.current = invalidateKey;
  const load = useCallback(async (at: number) => {
    setOffset(at); setGroupKey(null); setSelected(null); setObservationsOpen(false); body.reset(); setStale(false);
    await page.run(async signal => {
      const value = await api.linkedExecution(sessionKey, { eventOffset: at, eventLimit: 100, captureLimit: 20 }, signal);
      if (value.sessionKey !== sessionKey || value.eventOffset !== at) throw new Error('OWNER_MISMATCH');
      return value;
    });
  }, [page.run, body.reset, sessionKey]);
  useEffect(() => { void load(0); }, [load]);
  useEffect(() => { if (previous.current !== invalidateKey) { previous.current = invalidateKey; page.reset(); body.reset(); setStale(true); setSelected(null); setGroupKey(null); } }, [invalidateKey, page.reset, body.reset]);
  const snapshot = stale ? null : page.value;
  const groups = snapshot === null ? [] : buildToolInvestigation(snapshot);
  const search = useDeferredValue(query).toLocaleLowerCase();
  const shown = groups.filter(group => (mode !== 'errors' || group.events.some(event => event.status === 'error' || event.error !== null)) &&
    (group.events.some(event => ((event.tool ?? '') + ' ' + event.title).toLocaleLowerCase().includes(search)) || group.identities.some(identity => identity.value.toLocaleLowerCase().includes(search))));
  const group = groups.find(item => item.key === groupKey);
  const inspect = (event: TraceEventSlim): void => { body.reset(); setSelected(event); setRaw(false); setExpandedText(false); };
  const selectGroup = (value: ToolInspectionGroup): void => { setObservationsOpen(false); setGroupKey(value.key); inspect(value.events[0]!); };
  const readBody = (includeRaw: boolean): void => {
    if (selected === null) return; setRaw(includeRaw); setExpandedText(false);
    const id = selected.id, atVersion = version.current;
    void body.run(async signal => {
      const value = await api.eventDetail(sessionKey, id, includeRaw, signal);
      if (value.id !== id || value.sessionId !== sessionKey || version.current !== atVersion) throw new Error('OWNER_MISMATCH');
      return value;
    });
  };
  const status = (event: TraceEventSlim): string => event.status === 'error' ? c.errorStatus : c[event.status];
  const value = body.value;
  const text = (source: string | null): string => source === null ? '—' : expandedText ? source : new TextDecoder().decode(new TextEncoder().encode(source).subarray(0, 65536));
  const hasMoreText = value !== null && [value.inputSummary, value.outputSummary, 'raw' in value ? value.raw : null].some(content => content !== null && new TextEncoder().encode(content).byteLength > 65536);
  return <Drawer open title={c.title} onClose={onClose} className="tool-investigation" width={1220}>
    <header className="tool-intro"><span className="family-eyebrow">NATIVE TOOL EVIDENCE</span><h2>{c.intro}</h2><p>{c.hint}</p></header>
    <div className="tool-toolbar"><button className="btn" type="button" disabled={page.busy} onClick={() => void load(offset)}>{c.refresh}</button>
      <button className="btn" type="button" disabled={page.busy || history.length === 0} onClick={() => { const next = [...history]; const at = next.pop()!; setHistory(next); void load(at); }}>{c.previous}</button>
      <button className="btn" type="button" disabled={page.busy || snapshot === null || !snapshot.eventsHasMore || snapshot.events.length === 0} onClick={() => { if (snapshot !== null) { setHistory(old => [...old, offset]); void load(offset + snapshot.events.length); } }}>{c.next}</button>
      <span className="mono">{c.scope} · {snapshot === null ? '—' : (snapshot.events.length === 0 ? 0 : offset + 1) + '–' + (offset + snapshot.events.length) + ' / ' + snapshot.eventTotal}</span>
    </div>
    {stale && <p role="status" className="tool-notice">{c.stale}</p>}
    {page.busy && <p role="status">{c.loading}</p>}
    {page.error !== null && <div role="alert" className="tool-notice">{c.error} · {page.error === 'TIMEOUT' ? c.timeout : page.error}<button className="btn" type="button" onClick={() => void load(offset)}>{c.retry}</button></div>}
    {snapshot !== null && <div className="tool-layout"><aside className="tool-sidebar">
      <h3>{c.process}</h3><p className="hint">{c.partial}</p>
      <div className="tool-filters"><label><span className="sr-only">{c.search}</span><input value={query} placeholder={c.search} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label={c.tools} value={mode} onChange={event => setMode(event.target.value)}><option value="all">{c.all}</option><option value="tools">{c.onlyTools}</option><option value="errors">{c.errors}</option></select></div>
      <p className="hint">{c.local}</p>
      <Process events={mode === 'all' && search === '' ? snapshot.events : snapshot.events.filter(event => shown.some(item => item.events.some(member => member.id === event.id)))} selected={selected?.id ?? null} label={c.process} onSelect={event => { setObservationsOpen(false); setGroupKey(groups.find(item => item.events.some(member => member.id === event.id))?.key ?? null); inspect(event); }} />
      <h3>{c.tools} · {shown.length}</h3><div className="tool-groups">{shown.map(item => <button type="button" className={'tool-group' + (groupKey === item.key ? ' is-selected' : '')} key={item.key} onClick={() => selectGroup(item)}>
        <strong>{item.events[0]!.tool ?? item.events[0]!.title}</strong><span>{item.events.map(event => '#' + event.sequence).join(' · ')}{item.events.some(event => event.status === 'error') ? ' · !' : ''}</span><code>{item.reason === 'native_id' ? item.identities[0]!.value : c[item.reason]}</code>
      </button>)}</div>{shown.length === 0 && <p className="tool-notice">{snapshot.events.length === 0 ? c.noEvents : c.empty}</p>}
    </aside><main className="tool-detail">
      {selected === null ? <p className="tool-notice">{c.choose}</p> : <>
        <span className="family-eyebrow">{selected.kind === 'tool' ? c.tools : c.context}</span><h2>{selected.tool ?? selected.title}</h2>
        {group !== undefined && <><p className="tool-notice">{c[group.reason]}{!group.events.some(event => event.hasOutput) && <><br />{c.missing}</>}</p>
          <div className="tool-members" aria-label={c.records}>{group.events.map(event => <button className={'btn' + (selected.id === event.id ? ' is-selected' : '')} key={event.id} type="button" onClick={() => inspect(event)}>#{event.sequence} · {event.hasInput ? c.inputs : ''}{event.hasInput && event.hasOutput ? ' / ' : ''}{event.hasOutput ? c.outputs : ''} · {status(event)}</button>)}</div>
          <details className="tool-source"><summary>{c.source}</summary>{group.identities.map(identity => <p className="mono" key={identity.id}>{identity.namespace} · {identity.value}<br />scope: {identity.scope ?? '—'}<br />{identity.eventId} · {identity.sourcePath}</p>)}{group.identities.length === 0 && <p>{c.noIdentity}</p>}</details>
        </>}
        {group?.reason === 'native_id' && group.identities[0]?.scope != null && <>
          <button className="btn" type="button" aria-expanded={observationsOpen} onClick={() => setObservationsOpen(open => !open)}>{locale === 'zh' ? '查看同一原生 ID 的跨页证据' : 'Inspect cross-page evidence for this native ID'}</button>
          {observationsOpen && <NativeToolObservationsPanel key={group.key} sessionKey={sessionKey} locale={locale} identity={{ namespace: group.identities[0].namespace, value: group.identities[0].value, scope: group.identities[0].scope }} onSelect={inspect} />}
        </>}
        <dl className="tool-facts"><dt>{c.original}</dt><dd className="mono">{selected.id}</dd><dt>{c.status}</dt><dd>{status(selected)}</dd><dt>{c.time}</dt><dd className="mono">{selected.durationMs} ms · {selected.startedAt}</dd></dl>
        <p className="hint">{c.timeHint}</p>{selected.error !== null && <p role="note" className="tool-record-error">{selected.error}</p>}
        <div className="tool-actions"><button className="btn ui-btn-primary" type="button" disabled={body.busy} onClick={() => readBody(false)}>{c.read}</button><button className="btn" type="button" disabled={!selected.hasRaw || body.busy} onClick={() => readBody(true)}>{c.raw}</button></div>
        {snapshot.attempts.filter(attempt => attempt.matches.some(match => match.eventId === selected.id)).map(attempt => <button className="btn" type="button" key={attempt.request.id} onClick={() => { onClose(); onOpenRequest(attempt.request.id); }}>{c.capture} #{attempt.request.id}</button>)}
        {body.busy && <p role="status">{c.loading}</p>}{body.error !== null && <div role="alert">{c.error} · {body.error === 'TIMEOUT' ? c.timeout : body.error}<button className="btn" type="button" onClick={() => readBody(raw)}>{c.retry}</button></div>}
        {value !== null && <section className="tool-body" aria-label={c.selected}><div className="tool-actions"><button className="btn" type="button" onClick={() => setFont(size => Math.max(8, size - 1))}>A−</button><button className="btn" type="button" onClick={() => setFont(size => Math.min(28, size + 1))}>A+</button><button className="btn" type="button" onClick={() => setFont(14)}>R</button></div><p className="hint">{c.bounded}</p>
          {raw ? <><h3>Raw</h3><pre style={{ fontSize: font }}>{'raw' in value ? text(value.raw) : c.rawAbsent}</pre></> : <div className="tool-body-columns"><section><h3>{c.input}</h3><pre style={{ fontSize: font }}>{text(value.inputSummary)}</pre></section><section><h3>{c.output}</h3><pre style={{ fontSize: font }}>{text(value.outputSummary)}</pre></section></div>}
          {hasMoreText && !expandedText && <button className="btn" type="button" onClick={() => setExpandedText(true)}>{c.more}</button>}
        </section>}
      </>}
    </main></div>}
  </Drawer>;
}
