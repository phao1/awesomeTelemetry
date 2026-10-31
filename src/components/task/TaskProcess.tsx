import { RequestNavigator } from './TaskRequests.js';
import { isSystemRecord } from '../../core/system-records.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TaskSummaryBar } from './TaskSummaryBar.js';
import { ArchitectureReadError } from '../agent-folding/ArchitectureReadError.js';
import { HealthButton } from './health/HealthButton.js';
import { HealthDrawer } from './health/HealthDrawer.js';
import { healthCopy } from './health/health-copy.js';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TaskContext, TaskRecord, TaskRecordQuery, TaskTimeline } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import type { TaskMode, TaskRoute } from '../../task-route.js';
import { copy } from './copy.js';
import { taskApi, useTaskRead } from './task-data.js';
import { ProcessLedger, type ProcessLedgerHandle } from './ProcessLedger.js';
import { TaskArchitecture } from '../agent-folding/TaskArchitecture.js';
import { architectureApi } from '../agent-folding/architecture-client.js';
import { ArchitectureDiagnosisPanel } from '../diagnosis/ArchitectureDiagnosisPanel.js';
import type { TaskChanges } from './TaskWorkbench.js';
const TaskEvidence = lazy(() => import('./TaskEvidence.js').then(module => ({ default: module.TaskEvidence })));
const TaskTimeNavigator = lazy(() => import('./TaskTimeNavigator.js').then(module => ({ default: module.TaskTimeNavigator })));
const stamp = (value: string | null, locale: Locale) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const recordTitle = (record: TaskRecord) => record.event ? record.event.title || record.event.tool || record.event.kind : record.importedTurn?.turnId ?? `${record.importedTurn?.model ?? 'TraceLog'} · #${record.importedTurn?.sequence ?? ''}`;
const recordTime = (record: TaskRecord) => record.event?.startedAt ?? record.importedTurn?.requestTime ?? null;
const hasError = (record: TaskRecord) => record.event?.status === 'error' || record.importedTurn?.isError === true;


export function TaskProcess({ context, route, onRoute, locale, changes, onRefreshContext, onOpenRequest, onNotice, diagnosisInvalidateKey }: {
  context: TaskContext; route: TaskRoute; onRoute: (route: TaskRoute) => void; locale: Locale; changes: TaskChanges;
  onRefreshContext: () => void; onOpenRequest: (id: number) => void; onNotice: (value: string) => void;
  diagnosisInvalidateKey: number;
}): React.JSX.Element {
  const auditRead = useCallback((signal: AbortSignal) => architectureApi.scope({ taskIds: [context.task.id] }, signal), [context.task.id]);
  const audit = useTaskRead(context.task.origin === 'collected' && !route.request && route.mode === 'architecture' ? context.task.id : null, auditRead, 35000);
  const c = copy(locale), [membersOpen, setMembersOpen] = useState(false), [q, setQ] = useState(route.q ?? ''), [search, setSearch] = useState(route.q ?? ''), [errors, setErrors] = useState(route.errors === true);
  const [paging, setPaging] = useState<{ offset?: number; window?: string }>({}), [revision, setRevision] = useState(0), [stale, setStale] = useState(false), [playing, setPlaying] = useState(false), [following, setFollowing] = useState(false);
  const [savedRecord, setSavedRecord] = useState<TaskRecord | null>(null), [timeRange, setTimeRange] = useState<[number, number] | null>(() => route.from && route.to ? [Date.parse(route.from), Date.parse(route.to)] : null);
  const [showSystem, setShowSystem] = useState(false);
  const [diagnosisRevision, setDiagnosisRevision] = useState(0);
  const seenChanges = useRef(changes.version);
  const resetVersion = useRef(0);
  if (changes.reset && changes.version > resetVersion.current) resetVersion.current = changes.version;
  const currentRoute = useRef(route); currentRoute.current = route;
  useEffect(() => { setQ(route.q ?? ''); setSearch(route.q ?? ''); setErrors(route.errors === true); setTimeRange(route.from && route.to ? [Date.parse(route.from), Date.parse(route.to)] : null); }, [route.q, route.errors, route.from, route.to]);
  const rootReturn = useRef<TaskRoute | null>(null), scroller = useRef<HTMLDivElement>(null), userScroll = useRef(false);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const titleElement = useRef<HTMLElement>(null), timeElement = useRef<HTMLDivElement>(null);
  const [stickySize, setStickySize] = useState({ title: 40, total: 130, viewport: 600 });
  const [recordOffset, setRecordOffset] = useState(0);
  useLayoutEffect(() => {
    if (!scrollElement) return;
    const measure = () => {
      const title = titleElement.current?.getBoundingClientRect().height ?? 40;
      const total = title + (timeElement.current?.getBoundingClientRect().height ?? 90);
      const viewport = scrollElement.clientHeight;
      setStickySize(previous => previous.title === title && previous.total === total && previous.viewport === viewport ? previous : { title, total, viewport });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    if (titleElement.current) observer.observe(titleElement.current);
    if (timeElement.current) observer.observe(timeElement.current);
    return () => observer.disconnect();
  }, [scrollElement]);
  const mainMember = context.members.find(member => member.role === 'main'), memberRef = useRef(route.member);
  useEffect(() => { if (q === search) return; const timer = setTimeout(() => { setSearch(q); onRoute({ ...currentRoute.current, q, event: null }); setPaging({}); setAnchor(null); setPlaying(false); }, 250); return () => clearTimeout(timer); }, [q, search]);
  useEffect(() => { if (memberRef.current !== route.member) { memberRef.current = route.member; setPaging({}); setSavedRecord(null); setPlaying(false); setTimeRange(null); } }, [route.member]);
  const query: TaskRecordQuery = useMemo(() => ({ request:route.request, member: route.member, q: search, status: errors ? 'error' : undefined, from: route.from, to: route.to, structure: true, ...paging, limit: 200 }), [route.request, route.member, search, errors, paging, route.from, route.to]);
  // Selecting an already-loaded row does not change the request. An external anchor does.
  const anchorRef = useRef(route.event);
  const [anchor, setAnchor] = useState(route.event);
  const filterKey = JSON.stringify([route.request,route.member,search,errors,route.from,route.to]);
  const previousFilter = useRef(filterKey);
  useEffect(() => { if (previousFilter.current===filterKey) return; previousFilter.current=filterKey; setPaging({}); setAnchor(route.event); setPlaying(false); },[filterKey,route.event]);
  const pageRef = useRef<Set<string>>(new Set());
  useEffect(() => { if (route.event !== anchorRef.current && route.event && !pageRef.current.has(route.event)) { setAnchor(route.event); setPaging({}); } anchorRef.current = route.event; }, [route.event]);
  const requestQuery = useMemo(() => ({ ...query, anchor: paging.offset === undefined ? anchor ?? undefined : undefined }), [query, anchor, paging.offset]);
  const readPage = useCallback((signal: AbortSignal) => taskApi.records(context.task.id, requestQuery, signal), [context.task.id, requestQuery]);
  const records = useTaskRead(JSON.stringify([context.task.id, requestQuery, revision]), readPage);
  const page = records.value;
  const displayContext = page?.context ?? context;
  const ledgerRef = useRef<ProcessLedgerHandle>(null);
  const readTimeline = useCallback((signal: AbortSignal) => taskApi.timeline(context.task.id, route.member, page!.window, signal), [context.task.id, route.member, page]);
  const timeline = useTaskRead(page ? JSON.stringify([context.task.id, route.member, page.window]) : null, readTimeline, 10000);
  const retainedTimeline = useRef<TaskTimeline | null>(null);
  if (retainedTimeline.current?.window!==page?.window || retainedTimeline.current?.member !== route.member || retainedTimeline.current.taskId !== context.task.id) retainedTimeline.current = null;
  if (timeline.value) retainedTimeline.current = timeline.value;

  useEffect(() => { pageRef.current = new Set(page?.items.map(item => item.id)); }, [page]);
  const selected = page?.items.find(item => item.id === route.event) ?? (savedRecord?.id === route.event ? savedRecord : null);
  const baseReaderRecords = useMemo(() => (page?.items ?? []).filter(item => showSystem || !isSystemRecord(item.event)), [page, showSystem]);
  const readerRecords = useMemo(() => !route.event || baseReaderRecords.some(item => item.id === route.event) ? baseReaderRecords : (page?.items ?? []).filter(item => baseReaderRecords.some(visible => visible.id === item.id) || item.id === route.event), [baseReaderRecords, page, route.event]);
  const visibleRecordIds = useMemo(() => new Set(readerRecords.map(item => item.id)), [readerRecords]);
  const visible = useMemo(() => (page?.items ?? []).filter(item => {
    const event = item.event;
    if (route.mode !== 'raw' && event && (event.kind === 'system' || event.title === 'token_count' || event.kind === 'reasoning' && !event.title)) return false;
    if (route.mode === 'conversation' && event && !['user_prompt', 'llm', 'reasoning'].includes(event.kind)) return false;
    return true;
  }), [page, route.mode]);
  // Reading controls must advance through the same records as the active view.
  // readerRecords also includes an explicitly anchored hidden record, allowing
  // playback to continue after that exact position without revisiting noise.
  const playbackRecords = route.mode === 'trajectory' ? readerRecords : visible;
  const segmentNumbers = useMemo(() => { const keys = new Map<string, number>(); for (const item of page?.items ?? []) if (item.event?.turnKey && !keys.has(item.event.turnKey)) keys.set(item.event.turnKey, keys.size + 1); return keys; }, [page]);
  const rowHeight = route.mode === 'raw' ? 44 : route.mode === 'conversation' ? 106 : 72;
  const list = useVirtualizer({ count: route.mode === 'trajectory' ? 0 : visible.length, getScrollElement: () => scrollElement, estimateSize: () => rowHeight, overscan: 5, getItemKey: index => visible[index]!.id, scrollMargin: recordOffset, scrollPaddingStart: stickySize.total });
  useLayoutEffect(() => { list.measure(); }, [list, rowHeight]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!scrollElement || !node) return;
    const measure = () => { const offset = node.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop; setRecordOffset(previous => Math.abs(previous - offset) < 0.5 ? previous : offset); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(scrollElement); observer?.observe(node); const ledger = node.closest('.task-ledger'); if (ledger) observer?.observe(ledger);
    scrollElement.addEventListener('scroll', measure, { passive: true });
    return () => { observer?.disconnect(); scrollElement.removeEventListener('scroll', measure); };
  }, [scrollElement, route.mode, page, stickySize.total, membersOpen, stale, records.loading]);
  useEffect(() => {
    if (!page || route.mode === 'trajectory') return;
    const index = visible.findIndex(item => item.id === route.event);
    if (index >= 0 && !userScroll.current) list.scrollToIndex(index, { align: 'center' });
    else if (!route.event && !userScroll.current) scrollElement?.scrollTo({ top: 0 });
  }, [page, visible, list, route.event, scrollElement, route.mode]);
  useEffect(() => {
    if (changes.version <= seenChanges.current || context.task.origin === 'imported') return;
    seenChanges.current = changes.version;
    if (changes.reset || changes.keys.some(key => context.members.some(member => member.sessionKey === key)) || context.task.runId && changes.runIds.includes(context.task.runId)) {
      setStale(true);
      setDiagnosisRevision(value => value + 1);
    }
  }, [changes, context]);
  const refresh = useCallback(() => { setPlaying(false); setPaging({}); setAnchor(null); setRevision(value => value + 1); setStale(false); userScroll.current = false; onRefreshContext(); }, [onRefreshContext]);
  useEffect(() => { if (stale && following && !playing && route.event === null) { const timer = setTimeout(refresh, 500); return () => clearTimeout(timer); } }, [stale, following, playing, route.event, refresh]);
  const selectRecord = useCallback((item: TaskRecord) => { setSavedRecord(item); onRoute({ ...route, task: context.task.id, event: item.id }); }, [route, onRoute, context.task.id]);
  useEffect(() => {
    if (!playing || !page) return;
    const timer = setInterval(() => {
      if (document.hidden) { setPlaying(false); return; }
      const index = playbackRecords.findIndex(item => item.id === route.event), next = playbackRecords[index + 1];
      if (!next) { setPlaying(false); return; }
      userScroll.current = false; selectRecord(next);
    }, 1300);
    return () => clearInterval(timer);
  }, [playing, page, playbackRecords, route.event, selectRecord]);
  const changeMember = (id: string) => {
    if (route.member === 'main' || route.member === mainMember?.id) rootReturn.current = route;
    setPlaying(false); setFollowing(false); setPaging({}); setAnchor(null); setTimeRange(null); userScroll.current = false;
    onRoute({ ...route, task: context.task.id, member: id, event: null, from: undefined, to: undefined, mode: id === 'all' && route.mode === 'conversation' ? 'trajectory' : route.mode });
  };
  const changeMode = (mode: TaskMode) => { setPlaying(false); onRoute({ ...route, task: context.task.id, mode, ...(mode === 'conversation' && route.member === 'all' ? { member: 'main', event: null, from: undefined, to: undefined } : {}) }); };
  const paginate = (next: number) => { setPlaying(false); setFollowing(false); setPaging({ offset: next, window: page?.window }); setTimeRange(null); onRoute({ ...route, from: undefined, to: undefined }); userScroll.current = false; };
  const at = page?.offset ?? 0, total = page?.total ?? 0;
  const status = (item: TaskRecord) => hasError(item) ? c.statusError : item.event?.status === 'success' ? c.statusSuccess : item.event?.status === 'running' ? c.statusRunning : c.statusUnknown;
  const goLatest = () => { setFollowing(true); setTimeRange(null); onRoute({ ...route, event: null, from: undefined, to: undefined }); refresh(); };
  const changeTimeRange = (value: [number, number] | null) => { setTimeRange(value); setPaging({}); setAnchor(null); setPlaying(false); setFollowing(false); onRoute({ ...route, event: null, from: value ? new Date(value[0]).toISOString() : undefined, to: value ? new Date(value[1]).toISOString() : undefined }); };
  const openAnchor = (id: string) => { setPaging({}); setAnchor(id); setTimeRange(null); setPlaying(false); onRoute({ ...route, event: id, q: undefined, errors: undefined, from: undefined, to: undefined }); };

  return <div className="health-workspace"><div className="task-process" ref={setScrollElement} style={{ '--task-title-height': `${stickySize.title}px`, '--task-sticky-height': `${stickySize.total}px`, '--task-reader-height': `${stickySize.viewport}px` } as React.CSSProperties}
    onWheel={() => { userScroll.current = true; setFollowing(false); }} onTouchStart={() => { userScroll.current = true; setFollowing(false); }}>
    <header className="task-context-header" ref={titleElement}>
      <h1 title={displayContext.task.title}>{displayContext.task.title || displayContext.task.provider}</h1>
      <select className="task-member-select" aria-label={c.scope} value={route.member} onChange={event => changeMember(event.target.value)}><option value="main">{c.main}</option>{displayContext.members.length > 1 && <option value="all">{c.all} · {displayContext.members.length}</option>}{displayContext.members.filter(item => item.role !== 'main').map(member => <option key={member.id} value={member.id} disabled={!member.sessionKey}>{member.name}</option>)}</select>
      {route.member !== 'main' && <button type="button" className="ui-icon-btn task-return-main" title={rootReturn.current?.event ? c.parent : c.returnMain} aria-label={rootReturn.current?.event ? c.parent : c.returnMain} onClick={() => { const target = rootReturn.current; setPaging({}); setAnchor(target?.event ?? null); userScroll.current = false; onRoute(target ?? { ...route, member: 'main', event: null, from: undefined, to: undefined }); }}>↩</button>}
      <details className="task-info"><summary aria-label={locale === 'zh' ? '任务信息与来源' : 'Task information and source'} title={locale === 'zh' ? '任务信息与来源' : 'Task information and source'}>ⓘ</summary><div className="task-info-popover">
        <span className="task-badge">{displayContext.task.provenanceKnown ? c[displayContext.task.origin] : c.originUnknown}</span><span>{displayContext.task.memberCount > 1 ? `${c.multi} · ${displayContext.task.memberCount}` : c.single}</span><span>{c.coverage} · {displayContext.task.loadedMemberCount}/{displayContext.task.memberCount} {c.parsed}</span><span>{c.occurred} {stamp(displayContext.task.startedAt, locale)}</span><span>{displayContext.task.origin === 'imported' ? c.importedAt : c.received} {stamp(displayContext.task.updatedAt, locale)}</span><span>{c.recordState} · {displayContext.task.recordedStatus}</span><p>{c.readBoundary}</p>
        <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => onNotice(c.copied)).catch(() => onNotice(c.copyFailed))}>{c.share} ↗</button>
      </div></details>
      <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => onNotice(c.copied)).catch(() => onNotice(c.copyFailed))}>{healthCopy(locale).share} ↗</button>
      <HealthButton locale={locale} open={Boolean(route.health)} onClick={() => onRoute({ ...route, health: route.health ? undefined : 'new' })}/>
    </header>
    {route.mode!=='architecture'&&<RequestNavigator context={displayContext} request={route.request} locale={locale} onSelect={request=>onRoute({...route,request,member:'all',event:null,health:undefined,from:undefined,to:undefined})} />}
    {!route.request&&<TaskSummaryBar context={displayContext} locale={locale} />}
    <div className="task-reading-toolbar">
      <div className="task-mode-tabs" role="tablist" aria-label={c.trajectory}>{(['trajectory', 'conversation', 'raw', 'architecture'] as const).map(mode => <button type="button" role="tab" disabled={mode==='architecture'&&Boolean(route.request)} aria-selected={route.mode === mode} key={mode} onClick={() => changeMode(mode)}>{mode === 'architecture' ? (locale === 'zh' ? '架构' : 'Architecture') : c[mode]}</button>)}</div>
      <div className="task-record-filters" hidden={route.mode === 'architecture'}><input maxLength={200} aria-label={c.metadataSearch} placeholder={locale === 'zh' ? '搜索记录…' : 'Search records…'} value={q} onChange={event => setQ(event.target.value)} /><label title={c.errors}><input type="checkbox" checked={errors} onChange={event => { setErrors(event.target.checked); onRoute({ ...route, errors: event.target.checked, event: null }); setPaging({}); setAnchor(null); setPlaying(false); }} />{c.errors}</label></div>
      <div className="task-playback" hidden={route.mode === 'architecture'}><button type="button" className="ui-icon-btn" title={playing ? c.pause : c.play} aria-label={playing ? c.pause : c.play} disabled={!playbackRecords.length || route.mode !== 'trajectory'} onClick={() => { setFollowing(false); if (!playing && playbackRecords[0] && (playbackRecords.findIndex(item => item.id === route.event) < 0 || playbackRecords.at(-1)?.id === route.event)) selectRecord(playbackRecords[0]); setPlaying(!playing); }}>{playing ? 'Ⅱ' : '▷'}</button><button type="button" className="ui-icon-btn" title={c.step} aria-label={c.step} disabled={!playbackRecords.length} onClick={() => { setPlaying(false); const index = playbackRecords.findIndex(item => item.id === route.event); const next = playbackRecords[index + 1]; if (next) { userScroll.current = false; selectRecord(next); } }}>›</button><button type="button" className="ui-icon-btn" title={c.latest} aria-label={c.latest} onClick={goLatest}>↓</button>
      {displayContext.members.length > 1 && <button type="button" className="ui-icon-btn" title={c.membersToggle} aria-label={c.membersToggle} aria-expanded={membersOpen} onClick={() => setMembersOpen(!membersOpen)}>⑂</button>}</div>
    </div>
    {route.mode === 'architecture' ? <section className="architecture-panel">{route.request&&<p>{locale==='zh'?'架构分析使用全任务范围。':'Architecture analysis uses whole-task scope.'}<button className="btn" onClick={()=>onRoute({...route,request:undefined})}>{locale==='zh'?'回到全任务':'Whole task'}</button></p>}{audit.loading && <p role="status">{locale === 'zh' ? '正在审计本地记录…' : 'Reading local records…'}</p>}{audit.error && <ArchitectureReadError error={audit.errorInfo ?? audit.error} locale={locale} retry={audit.retry} />}{audit.value && <TaskArchitecture key={audit.value.sources[0]?.revision} project={audit.value} locale={locale} onLocate={(task, session, event) => onRoute({ ...route, task, mode: 'trajectory', member: 'all', event: session && event ? `${session}:event:${event}` : null })} />}
      {displayContext.task.origin === 'collected' && !route.request && <ArchitectureDiagnosisPanel taskId={displayContext.task.id} member={route.member} locale={locale}
        invalidateKey={JSON.stringify([displayContext.task, displayContext.members, page?.window, revision, diagnosisRevision, diagnosisInvalidateKey])}
        onLocate={ref => {
          if (ref.source !== 'native_event') { if (ref.captureId !== null) onOpenRequest(ref.captureId); return; }
          if (!ref.sessionKey || !ref.eventId) return;
          userScroll.current = false; setFollowing(false);
          const id = `${ref.sessionKey}:event:${ref.eventId}`; setAnchor(id); onRoute({ ...route, mode: 'trajectory', member: 'all', event: id });
        }}
      />}
    </section> : <>
    {membersOpen && <section className="task-members" aria-label={c.hierarchy}><div className="task-member-strip">{[...displayContext.members].sort((a, b) => Number(b.role === 'main') - Number(a.role === 'main')).map(member => <button type="button" className={`task-member ${member.id === route.member ? 'is-selected' : ''}`} key={member.id} disabled={!member.sessionKey && displayContext.task.origin !== 'imported'} onClick={() => changeMember(member.role === 'main' ? 'main' : member.id)} title={member.parentId ? `${displayContext.members.find(item => item.id === member.parentId)?.name ?? member.parentId} → ${member.name}` : c.main}><span className="task-avatar">{member.role === 'main' ? 'M' : member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.parentId ? `${displayContext.members.find(item => item.id === member.parentId)?.name ?? '?'} → ` : ''}{member.role === 'main' ? c.main : member.role} · {member.detailLoaded ? `${member.eventCount} ${c.records}` : c.indexPending}</small></span></button>)}</div><p className="hint">{c.graphHint}</p></section>}
    <div className="task-time-sticky" ref={timeElement}>
      <Suspense fallback={<div className="process-time-loading" role="status">{c.loading}</div>}><TaskTimeNavigator key={context.task.id + ':' + route.member} timeline={timeline.value ?? retainedTimeline.current} loading={records.loading || timeline.loading} error={timeline.error} onRetry={timeline.retry}
        structure={page?.structure} records={route.mode === 'trajectory' ? readerRecords : visible} locale={locale} selected={route.event} range={timeRange} mainMemberId={mainMember?.id}
        toolbar={<><button type="button" title={locale === 'zh' ? '折叠或展开轮次' : 'Collapse or expand rounds'} onClick={() => ledgerRef.current?.toggle('round')}>{locale === 'zh' ? '⊟ 轮次' : '⊟ Rounds'}</button><button type="button" title={locale === 'zh' ? '折叠或展开调用' : 'Collapse or expand calls'} onClick={() => ledgerRef.current?.toggle('call')}>{locale === 'zh' ? '⊟ 调用' : '⊟ Calls'}</button><label className="task-system-filter" title={locale === 'zh' ? '显示来源技术事件；默认聚焦输入、思考、输出和工具。原始事件始终完整可读。' : 'Show source bookkeeping. Default reading focuses on prompts, reasoning, output and tools. Raw events remain available.'}><input type="checkbox" checked={showSystem} onChange={event => setShowSystem(event.target.checked)} />{locale === 'zh' ? '系统记录' : 'System records'}</label><span className="task-page-controls" title={c.partial}><button type="button" aria-label={c.previous} disabled={!page?.hasPrevious} onClick={() => paginate(Math.max(0, at - 200))}>‹</button><span>{at + (page?.items.length ? 1 : 0)}–{at + (page?.items.length ?? 0)} / {total.toLocaleString()}</span><button type="button" aria-label={c.next} disabled={!page?.hasMore} onClick={() => paginate(at + (page?.items.length ?? 200))}>›</button></span></>}
        onSelect={item => { setPlaying(false); setFollowing(false); userScroll.current = false; selectRecord(item); if (route.mode === 'trajectory') ledgerRef.current?.locate(item.id); else { const index = visible.findIndex(value => value.id === item.id); if (index >= 0) list.scrollToIndex(index, { align: 'start' }); } }} onRangeChange={changeTimeRange} /></Suspense>
    </div>
    <div className="task-process-body"><section className="task-ledger">
      {stale && <div className="task-new-records" role="status"><span>● {c.newer}</span><button type="button" onClick={refresh}>{c.update} ↻</button></div>}
      {([...context.warnings, ...(page?.warnings ?? [])].some(warning => warning !== 'origin_unconfirmed')) && <details className="task-warning"><summary>{c.warnings}</summary><span className="mono">{[...new Set([...context.warnings, ...(page?.warnings ?? [])])].join(' · ')}</span></details>}
      {records.loading && <div className="task-loading" role="status">{c.loadingScope}</div>}{records.error && <div className="task-inline-state" role="alert"><p>{records.error}</p><button type="button" className="btn" onClick={() => { setAnchor(null); onRoute({ ...route, event: null }); records.retry(); }}>{c.retry}</button></div>}
      {page && <>
        {route.mode === 'raw' && <div className="task-raw-head"><span>{c.sequence}</span><span>{c.member}</span><span>{c.type}</span><span>{c.title}</span><span>{c.time}</span></div>}
        {route.mode === 'trajectory' ? <ProcessLedger page={page} selected={route.event} locale={locale} ref={ledgerRef} scrollElement={scrollElement} stickyOffset={stickySize.total} visibleRecordIds={visibleRecordIds} onSelect={item => { setFollowing(false); selectRecord(item); }} onAnchor={openAnchor} onUserScroll={() => { userScroll.current = true; setFollowing(false); }} /> : <div className="task-record-scroll" ref={scroller}>
          {visible.length === 0 && <div className="task-inline-state">{c.noRecords}</div>}
          <div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(row => {
            const item = visible[row.index]!, event = item.event;
            return <div key={item.id} style={{ position: 'absolute', width: '100%', height: row.size, transform: `translateY(${row.start - recordOffset}px)` }}>
              <button type="button" data-record-id={item.id} className={`task-record task-record-${route.mode} ${route.event === item.id ? 'is-selected' : ''} ${hasError(item) ? 'has-error' : ''}`} onClick={() => { setFollowing(false); userScroll.current = true; selectRecord(item); }} aria-label={`${c.inspect}: ${recordTitle(item)}`} aria-current={route.event === item.id ? 'true' : undefined}>
                {route.mode === 'raw' ? <><span className="mono">{event?.sequence ?? item.importedTurn?.sequence}</span><span>{item.memberName}</span><span className="mono">{event?.kind ?? 'TraceLog'}</span><strong>{recordTitle(item)}</strong><time>{stamp(recordTime(item), locale)}</time></> : <><span className={`task-record-marker ${event?.kind ?? ''}`}>{event?.tool ? '⌘' : event?.actor === 'user' ? 'U' : event?.kind === 'llm' ? '✦' : '·'}</span><span className="task-record-copy"><span className="task-record-meta"><span>{item.memberName}</span><span>{event?.tool ?? event?.kind ?? 'TraceLog'}</span>{event?.turnKey && <span title={event.turnKey}>↳ {c.segment} {segmentNumbers.get(event.turnKey)}</span>}<time>{stamp(recordTime(item), locale)}</time></span><strong>{recordTitle(item)}</strong></span><span className="task-record-state"><span className={`task-state-dot ${hasError(item) ? 'error' : ''}`} title={status(item)} />{event?.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : '—'}<span aria-hidden="true">›</span></span></>}
              </button>
            </div>;
          })}</div>
        </div>}
        <footer className="task-record-pager"><button type="button" className="btn" disabled={!page.hasPrevious} onClick={() => paginate(Math.max(0, page.offset - 200))}>↑ {c.previous}</button><span>{playing ? c.replayHint : c.partial}</span><button type="button" className="btn" disabled={!page.hasMore} onClick={() => paginate(page.offset + page.items.length)}>{c.next} ↓</button></footer>
      </>}
    </section>
    {selected ? <Suspense fallback={<aside className="task-evidence"><header><h3>{recordTitle(selected)}</h3></header><div className="task-evidence-content"><code>{selected.id}</code>{selected.event?.error && <p className="task-evidence-error" role="alert">{selected.event.error}</p>}<p role="status">{c.loading}</p></div></aside>}><TaskEvidence key={selected.id + (route.mode === 'raw' ? ':raw' : '') + ':' + revision + ':' + resetVersion.current} context={displayContext} record={selected} locale={locale} initialRaw={route.mode === 'raw'} onSelectRelated={selectRecord}
      relatedRecords={page?.structure?.records.find(value=>value.recordId===selected.id&&value.pairing==='exact')?.relatedRecordIds.flatMap(id=>page.items.filter(item=>item.id===id)) ?? []}
      onClose={() => onRoute({ ...route, event: null })} onLocate={() => { userScroll.current = false; const index = visible.findIndex(item => item.id === selected.id); if (route.mode === 'trajectory' && ledgerRef.current?.locate(selected.id)) return; if (index >= 0) list.scrollToIndex(index, { align: 'center' }); else { setTimeRange(null); setQ(''); setSearch(''); setErrors(false); setPaging({}); setAnchor(selected.id); onRoute({ ...route, q: undefined, errors: undefined, from: undefined, to: undefined }); } }} onOpenRequest={onOpenRequest}
      onOpenSession={key => { const member = displayContext.members.find(item => item.sessionKey === key); if (member) changeMember(member.id); else onRoute({ ...route, task: 'collected:' + key, member: 'main', event: null, q: undefined, errors: undefined, from: undefined, to: undefined }); }} /></Suspense>
      : null}
    </div></> }
  </div>
    {route.health && <HealthDrawer key={context.task.id} context={displayContext} request={route.request} locale={locale} reportId={route.health} from={route.from} to={route.to} sourceVersion={diagnosisRevision + diagnosisInvalidateKey}
      evidenceUnavailable={Boolean(route.event && !records.loading && (records.error || page && !page.items.some(item => item.id === route.event)))}
      onReport={id => onRoute({ ...currentRoute.current, health: id })} onClose={() => onRoute({ ...currentRoute.current, health: undefined })}
      onLocate={(_evidence, id,request) => { userScroll.current = false; setFollowing(false); setPlaying(false); setPaging({}); setAnchor(id); onRoute({ ...route, request,mode: 'trajectory', member: 'all', event: id, q: undefined, errors: undefined, from: undefined, to: undefined }); }}/>}
  </div>;
}
