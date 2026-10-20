import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { LinkedExecutionPage, NativeSessionFamilyPage, TraceEvent } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import type { Locale } from '../i18n.js';
import { Drawer } from './ui/Modal.js';

const copy = {
  zh: { title: 'Agent 家族与尝试', intro: '沿原生父级声明浏览会话，逐条核对网络尝试与原始 Trace。', evidence: '仅展示原生声明，不把引用当作运行时派生或通信证明。', scope: '当前展开范围', parents: '父级引用', current: '中心会话', children: '子级声明', selected: '会话详情', overview: '关系概览', execution: '执行与尝试', open: '打开原生 Trace', capture: '打开抓包 Trace', center: '以此会话为中心', refresh: '刷新关系', next: '下一页子会话', expand: '展开子会话', collapse: '收起子会话', loading: '正在读取本地证据…', error: '本地证据读取失败', retry: '重试读取', timeout: '读取超过 5 秒，请重试这次本地读取。', stale: '关联依据已变化，旧结论已隐藏，请刷新。', empty: '尚无保留的父子关系', emptyHint: '没有声明不代表这是根会话，也不证明没有子 Agent。', noChildren: '本页没有子级声明', noParents: '没有保留的父级声明', details: '来源依据', source: '原生定位', native: '原生会话范围', resolved: '已解析', ambiguous: '多个候选', incomplete: '依据不完整', unresolved: '未解析', attempts: '关联网络尝试', noAttempts: '没有已确认关联的网络尝试', retryUnknown: '重试关系：未知', retryHint: '失败后成功、相同模型或相近时间均不作为重试证明；每次捕获独立保留。', events: '原生事件', noEvents: '没有保留的原生事件', nextEvents: '下一页原生事件', nextAttempts: '下一页网络尝试', inspect: '查看尝试详情', request: '请求', status: '网络状态', unknown: '未知', eventDetail: '原生事件详情', input: '输入', output: '输出', matching: '共享原生标识', unbound: '尚无明确事件对应', page: '本页', partial: '证据范围不完整', back: '回到起点', cycle: '循环引用已停止展开', read: '读取事件详情', failed: '网络失败', completed: '网络完成', cancelled: '已取消', interrupted: '已中断', http_error: 'HTTP 错误', timed_out: '超时', network_error: '网络失败', parentMore: '更多父级引用请在原生父会话入口按页查看。' },
  en: { title: 'Agent family & attempts', intro: 'Follow native parent declarations, then inspect individual network attempts and original traces.', evidence: 'Native declarations are retained references, not proof of runtime spawning or communication.', scope: 'Expanded scope', parents: 'Parent references', current: 'Center session', children: 'Child declarations', selected: 'Session details', overview: 'Relations', execution: 'Events & attempts', open: 'Open native Trace', capture: 'Open capture Trace', center: 'Center on this session', refresh: 'Refresh relations', next: 'Next children', expand: 'Expand children', collapse: 'Collapse children', loading: 'Reading local evidence…', error: 'Local evidence read failed', retry: 'Retry local read', timeout: 'The read exceeded 5 seconds. Retry this local read.', stale: 'Relation evidence changed. Old conclusions are hidden; refresh explicitly.', empty: 'No retained family relation', emptyHint: 'No declaration does not establish a root session or the absence of subagents.', noChildren: 'No child declaration on this page', noParents: 'No retained parent declaration', details: 'Source evidence', source: 'Native locator', native: 'Native session scope', resolved: 'Resolved', ambiguous: 'Multiple owners', incomplete: 'Incomplete', unresolved: 'Unresolved', attempts: 'Linked network attempts', noAttempts: 'No accepted linked network attempts', retryUnknown: 'Retry relation: unknown', retryHint: 'Failure followed by completion, equal models or nearby times do not establish a retry. Each capture stays independent.', events: 'Native events', noEvents: 'No retained native events', nextEvents: 'Next native events', nextAttempts: 'Next network attempts', inspect: 'Inspect attempt', request: 'Request', status: 'Network state', unknown: 'Unknown', eventDetail: 'Native event details', input: 'Input', output: 'Output', matching: 'Shared native identity', unbound: 'No exact event match', page: 'This page', partial: 'Incomplete evidence coverage', back: 'Back to starting session', cycle: 'Cyclic reference: expansion stopped', read: 'Read event details', failed: 'Network failure', completed: 'Network completed', cancelled: 'Cancelled', interrupted: 'Interrupted', http_error: 'HTTP error', timed_out: 'Timed out', network_error: 'Network failure', parentMore: 'Use the native-parent entry for more paged references.' },
} as const;
type Labels = { [K in keyof typeof copy.zh]: string };
type Metadata = NativeSessionFamilyPage['session'];
type Child = NativeSessionFamilyPage['children'][number];
type Props = { sessionKey: string; locale: Locale; invalidateKey?: number; onClose: () => void; onOpenSession?: (id: string) => void; onOpenRequest: (id: number) => void };

/** A wait owns its abort/deadline even when a mocked/unresponsive loader ignores abort. */
function useRead<T>() {
  const [value, setValue] = useState<T | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    generation.current += 1; controller.current?.abort(); controller.current = null;
    if (timer.current !== null) clearTimeout(timer.current); timer.current = null;
  }, []);
  const reset = useCallback(() => { cancel(); setValue(null); setError(null); setBusy(false); }, [cancel]);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(async (loader: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    cancel(); const token = generation.current, owned = new AbortController(); controller.current = owned;
    setValue(null); setError(null); setBusy(true);
    timer.current = setTimeout(() => { if (generation.current === token) { cancel(); setError('LOCAL_READ_TIMEOUT'); setBusy(false); } }, 5000);
    try {
      const next = await loader(owned.signal);
      if (generation.current !== token || owned.signal.aborted) return null;
      setValue(next); return next;
    } catch (cause: unknown) {
      if (generation.current === token && !owned.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally { if (generation.current === token) { cancel(); setBusy(false); } }
  }, [cancel]);
  return { value, busy, error, run, reset };
}
function ReadState({ read, labels, retry }: { read: { busy: boolean; error: string | null }; labels: Labels; retry: () => void }): React.JSX.Element {
  return <>{read.busy && <p role="status">{labels.loading}</p>}{read.error !== null && <div className="family-error" role="alert"><strong>{labels.error}</strong><p>{read.error === 'LOCAL_READ_TIMEOUT' ? labels.timeout : read.error}</p><button className="btn" type="button" onClick={retry}>{labels.retry}</button></div>}</>;
}

type TreeRow = { session: Metadata; state: Child['state']; relation: 'parents' | 'current' | 'children'; depth: number; path: string[]; cycle: boolean };
function FamilyTree({ rows, labels, expanded, selected, onSelect, onExpand }: { rows: TreeRow[]; labels: Labels; expanded: Set<string>; selected: string; onSelect: (id: string) => void; onExpand: (id: string) => void }): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(rows.length, 68, 4, 440);
  return <nav aria-label={labels.scope} ref={containerRef} onScroll={onScroll} className="family-tree" style={{ height: 440, overflow: 'auto' }}>
    <div style={{ height: range.totalHeight }}><div style={{ transform: `translateY(${range.offsetY}px)` }}>
      {rows.slice(range.startIndex, range.endIndex).map(row => <div key={row.relation + row.path.join('/')} className={'family-node' + (selected === row.session.id ? ' is-selected' : '')} style={{ paddingLeft: 10 + row.depth * 18 }} data-family-session={row.session.id}>
        {row.relation !== 'parents' && !row.cycle ? <button className="family-disclosure" type="button" aria-expanded={expanded.has(row.session.id)} aria-label={(expanded.has(row.session.id) ? labels.collapse : labels.expand) + ' ' + row.session.title} onClick={() => onExpand(row.session.id)}>{expanded.has(row.session.id) ? '▾' : '▸'}</button> : <span className="family-disclosure" aria-hidden="true">↳</span>}
        <button className="family-node-select" type="button" aria-pressed={selected === row.session.id} onClick={() => onSelect(row.session.id)} title={row.session.id}>
          <strong>{row.session.title || row.session.id}</strong><span>{row.session.sourceAgent} · {labels[row.relation]}{row.relation === 'current' ? '' : ' · ' + labels[row.state]}{row.cycle ? ' · ' + labels.cycle : ''}</span>
        </button>
      </div>)}
    </div></div>
  </nav>;
}

function AttemptEvidence({ sessionKey, locale, onOpenRequest }: { sessionKey: string; locale: Locale; onOpenRequest: (id: number) => void }): React.JSX.Element {
  const labels = copy[locale], read = useRead<LinkedExecutionPage>(), body = useRead<TraceEvent>();
  const run = read.run;
  const [params, setParams] = useState<{ eventOffset?: number; captureCursor?: number }>({});
  const [selected, setSelected] = useState<number | null>(null), [eventId, setEventId] = useState<string | null>(null), [fontSize, setFontSize] = useState(14);
  const load = useCallback(async (next: { eventOffset?: number; captureCursor?: number } = {}) => {
    setParams(next); setSelected(null); setEventId(null); body.reset();
    await run(signal => api.linkedExecution(sessionKey, { ...next, eventLimit: 20, captureLimit: 20 }, signal));
  }, [sessionKey, run, body.reset]);
  useEffect(() => { void load(); }, [load]);
  const event = (id: string): void => { setEventId(id); void body.run(signal => api.eventDetail(sessionKey, id, false, signal)); };
  const page = read.value, attempt = page?.attempts.find(value => value.request.id === selected);
  const state = attempt?.transport?.state;
  return <div className="family-evidence">
    <div className="family-notice"><strong>{labels.retryUnknown}</strong><p>{labels.retryHint}</p></div>
    <ReadState read={read} labels={labels} retry={() => void load(params)} />
    {page !== null && <>
      <h3>{labels.attempts} <span className="family-count">{labels.page} {page.attempts.length}</span></h3>
      {page.attempts.length === 0 && <div className="family-empty">{labels.noAttempts}</div>}
      <div className="family-attempt-list">{page.attempts.map(item => <button type="button" className={'family-attempt' + (selected === item.request.id ? ' is-selected' : '')} key={item.request.id} aria-expanded={selected === item.request.id} onClick={() => { setSelected(selected === item.request.id ? null : item.request.id); body.reset(); setEventId(null); }}>
        <strong>#{item.request.id} · {labels.inspect}</strong><span>{item.request.startedAt.replace('T', ' ').replace('.000Z', 'Z')}</span><span className={'family-state ' + (item.transport?.state === 'completed' ? 'is-ok' : 'is-unknown')}>{item.transport === null ? labels.unknown : labels[item.transport.state]}</span>
      </button>)}</div>
      {page.capturesHasMore && <button className="btn" type="button" onClick={() => void load({ ...params, captureCursor: page.nextCaptureCursor! })}>{labels.nextAttempts}</button>}
      {attempt !== undefined && <section className="family-attempt-detail" aria-label={labels.inspect}>
        <header><h3>{labels.request} #{attempt.request.id}</h3><button className="btn ui-btn-primary" type="button" onClick={() => onOpenRequest(attempt.request.id)}>{labels.capture} ↗</button></header>
        <dl><dt>{labels.status}</dt><dd>{state === undefined ? labels.unknown : labels[state]} · HTTP {attempt.transport?.statusCode ?? labels.unknown}</dd><dt>{labels.request}</dt><dd className="mono">{attempt.request.method} {attempt.request.hostname}</dd></dl>
        <h4>{labels.matching}</h4>{attempt.matches.length === 0 ? <p>{labels.unbound}</p> : attempt.matches.map(match => <button className="btn family-match" type="button" key={match.scanIdentityId + match.proxyIdentityId} onClick={() => event(match.eventId)}>{labels.read} · {match.eventId}<span className="mono">{match.namespace} · {match.kind} · {match.value}</span></button>)}
      </section>}
      <h3>{labels.events} <span className="family-count">{Math.min(page.eventOffset + page.events.length, page.eventTotal)}/{page.eventTotal}</span></h3>
      {page.events.length === 0 ? <div className="family-empty">{labels.noEvents}</div> : <div className="family-events">{page.events.map(item => <button className="family-event" type="button" key={item.id} onClick={() => event(item.id)}><span className="mono">#{item.sequence} · {item.kind}</span><strong>{item.title}</strong><span>{item.status}</span></button>)}</div>}
      {page.eventsHasMore && <button className="btn" type="button" onClick={() => void load({ ...params, eventOffset: page.eventOffset + page.events.length })}>{labels.nextEvents}</button>}
    </>}
    <ReadState read={body} labels={labels} retry={() => { if (eventId !== null) event(eventId); }} />
    {body.value !== null && <section className="family-body" aria-label={labels.eventDetail}><header><h3>{labels.eventDetail} · {body.value.title}</h3><div aria-label="Font"><button className="btn" type="button" onClick={() => setFontSize(size => Math.max(8, size - 1))}>A−</button><button className="btn" type="button" onClick={() => setFontSize(size => Math.min(28, size + 1))}>A+</button><button className="btn" type="button" onClick={() => setFontSize(14)}>R</button></div></header><h4>{labels.input}</h4><pre style={{ fontSize }}>{body.value.inputSummary ?? '—'}</pre><h4>{labels.output}</h4><pre style={{ fontSize }}>{body.value.outputSummary ?? '—'}</pre></section>}
  </div>;
}

export function SessionFamilyPanel(props: Props): React.JSX.Element { return <Family key={props.sessionKey} {...props} />; }
function Family({ sessionKey, locale, invalidateKey = 0, onClose, onOpenSession, onOpenRequest }: Props): React.JSX.Element {
  const labels = copy[locale], read = useRead<NativeSessionFamilyPage>(), run = read.run;
  const [pages, setPages] = useState<Map<string, NativeSessionFamilyPage>>(() => new Map()), [selected, setSelected] = useState(sessionKey), [center, setCenter] = useState(sessionKey);
  const [expanded, setExpanded] = useState(() => new Set([sessionKey])), [tab, setTab] = useState<'overview' | 'execution'>('overview'), [stale, setStale] = useState(false);
  const version = useRef(invalidateKey), previous = useRef(invalidateKey); version.current = invalidateKey;
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const protectedKeys = useRef(new Set<string>()); protectedKeys.current = new Set([sessionKey, center, selected]);
  const load = useCallback(async (key: string, cursor?: string): Promise<void> => {
    const atVersion = version.current;
    const value = await run(async signal => {
      const result = await api.nativeSessionFamily(key, cursor === undefined ? {} : { cursor }, signal);
      if (result.session.id !== key || result.parents.sessionKey !== key) throw new Error('FAMILY_OWNER_MISMATCH');
      return result;
    });
    if (value === null || atVersion !== version.current) return;
    setStale(false); setPages(old => { const next = new Map(old); if (next.size >= 10 && !next.has(key)) { for (const candidate of next.keys()) { if (!protectedKeys.current.has(candidate)) { next.delete(candidate); break; } } } next.set(key, value); return next; });
  }, [run]);
  useEffect(() => { void load(sessionKey); }, [sessionKey, load]);
  useEffect(() => {
    if (previous.current === invalidateKey) return;
    previous.current = invalidateKey; read.reset(); setPages(new Map()); setStale(true); setTab('overview');
  }, [invalidateKey, read.reset]);
  const select = (key: string): void => { setSelected(key); setTab('overview'); if (!pagesRef.current.has(key)) void load(key); };
  const toggle = (key: string): void => {
    if (!expanded.has(key) && !pagesRef.current.has(key)) void load(key);
    setExpanded(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const page = stale ? undefined : pages.get(selected), root = stale ? undefined : pages.get(center);
  const rows: TreeRow[] = [];
  if (root !== undefined) {
    const seenParents = new Set<string>();
    for (const reference of root.parents.items) for (const parent of reference.matches) {
      if (seenParents.has(parent.id)) continue; seenParents.add(parent.id);
      rows.push({ session: parent, state: reference.state, relation: 'parents', depth: 0, path: ['parent', parent.id], cycle: false });
    }
    const add = (session: Metadata, depth: number, path: string[], state: Child['state']): void => {
      const cycle = path.slice(0, -1).includes(session.id);
      rows.push({ session, depth, path, state, cycle, relation: depth === 0 ? 'current' : 'children' });
      if (cycle || depth >= 4 || !expanded.has(session.id)) return;
      for (const child of pages.get(session.id)?.children ?? []) add(child.session, depth + 1, [...path, child.session.id], child.state);
    };
    add(root.session, 0, [root.session.id], 'resolved');
  }
  return <Drawer open title={labels.title} onClose={onClose} className="session-family" width={1180}>
    <div className="family-intro"><span className="family-eyebrow">NATIVE RELATIONS</span><h2>{labels.intro}</h2><p>{labels.evidence}</p></div>
    <div className="family-toolbar"><button className="btn" type="button" disabled={read.busy} onClick={() => void load(selected)}>{labels.refresh}</button><button className="btn" type="button" onClick={() => { setCenter(sessionKey); setExpanded(new Set([sessionKey])); select(sessionKey); }}>{labels.back}</button>{stale && <span role="status">{labels.stale}</span>}</div>
    <ReadState read={read} labels={labels} retry={() => void load(selected)} />
    <div className="family-layout"><aside className="family-sidebar"><header><h3>{labels.scope}</h3><span className="family-count">{root?.children.length ?? '—'} {labels.children}</span></header>
      <FamilyTree rows={rows} labels={labels} expanded={expanded} selected={selected} onSelect={select} onExpand={toggle} />
      {root?.children.length === 0 && <p className="family-footnote">{labels.noChildren}</p>}
      {root?.hasMore && <button className="btn" type="button" onClick={() => void load(center, root.nextCursor!)}>{labels.next}</button>}
    </aside><main className="family-selected">
      {page !== undefined && <><div className="family-selection"><span className="family-eyebrow">{labels.selected} · {page.session.sourceAgent}</span><h2>{page.session.title || page.session.id}</h2><p className="mono">{page.session.id}</p><div className="family-actions"><button className="btn ui-btn-primary" type="button" disabled={onOpenSession === undefined} onClick={() => { onClose(); onOpenSession?.(selected); }}>{labels.open} ↗</button><button className="btn" type="button" onClick={() => { setCenter(selected); setExpanded(new Set([selected])); }}>{labels.center}</button></div></div>
        <div className="family-tabs" role="tablist" aria-label={labels.selected}><button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>{labels.overview}</button><button type="button" role="tab" aria-selected={tab === 'execution'} onClick={() => setTab('execution')}>{labels.execution}</button></div>
        {tab === 'overview' ? <section className="family-overview"><h3>{labels.details}</h3>{!page.completeness.complete && <p role="status" className="family-notice">{labels.partial} · {page.completeness.reasons.join(', ')}</p>}
          {page.parents.items.length === 0 ? <div className="family-empty"><strong>{labels.noParents}</strong><p>{labels.emptyHint}</p></div> : page.parents.items.map(reference => <div className="family-reference" key={reference.identity.id}><header><strong>{labels.parents}</strong><span className={'family-state ' + (reference.state === 'resolved' ? 'is-ok' : 'is-unknown')}>{labels[reference.state]}</span></header><dl><dt>{labels.native}</dt><dd className="mono">{reference.identity.scope ?? labels.unknown}</dd><dt>{labels.parents}</dt><dd className="mono">{reference.identity.value}</dd><dt>{labels.source}</dt><dd className="mono">{reference.identity.sourcePath}</dd></dl>{reference.matches.map(parent => <button className="btn" type="button" key={parent.id} onClick={() => select(parent.id)}>{parent.title || parent.id} ↗</button>)}</div>)}
          {page.parents.hasMore && <p>{labels.parentMore}</p>}
          {page.children.length === 0 && page.parents.items.length === 0 && <p className="family-footnote">{labels.empty}</p>}
          <div className="family-notice"><strong>{labels.retryUnknown}</strong><p>{labels.retryHint}</p><button className="btn" type="button" onClick={() => setTab('execution')}>{labels.execution} →</button></div>
        </section> : <AttemptEvidence key={selected} sessionKey={selected} locale={locale} onOpenRequest={id => { onClose(); onOpenRequest(id); }} />}
      </>}
    </main></div>
  </Drawer>;
}
