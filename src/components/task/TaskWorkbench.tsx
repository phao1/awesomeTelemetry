import { RequestExpansion } from './TaskRequests.js';
import { useTaskHydration } from './task-hydration.js';
import { loadBool, storeBool, LAYOUT_KEYS } from '../../layout.js';
import { TaskHealthList } from './TaskHealthList.js';
import { ArchitectureReadError } from '../agent-folding/ArchitectureReadError.js';
import '../../styles/task-health.css';
import '../../styles/task-workbench.css';
import '../../styles/task-process.css';
import '../../styles/task-reader.css';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LocalSettingsTarget, TaskSummary, TaskPage } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import type { ProviderKey } from '../../core/trace-types.js';
import { PROVIDER_KEYS } from '../../core/trace-types.js';
import { type TaskRoute } from '../../task-route.js';
import { copy } from './copy.js';
import { taskApi, useTaskRead } from './task-data.js';
const TaskArchitecture=lazy(()=>import('../agent-folding/TaskArchitecture.js').then(m=>({default:m.TaskArchitecture})));
const ImportedArchitectureCompare=lazy(()=>import('../agent-folding/ArchitectureCompare.js').then(m=>({default:m.ImportedArchitectureCompare})));
const TaskProcess=lazy(()=>import('./TaskProcess.js').then(m=>({default:m.TaskProcess})));

export interface TaskChanges { version: number; keys: string[]; runIds: string[]; reset?: boolean }
export interface TaskWorkbenchProps {
  onSettings?: (target: LocalSettingsTarget) => void;
  settingsRevision?: number;
  onLegacyCompare?: () => void;
  providerPreset?: ProviderKey | ''; onProviderPresetChange?: (provider: ProviderKey | '') => void;
  locale: Locale; route: TaskRoute; onRoute: (route: TaskRoute) => void; changes: TaskChanges;
  onIntake: () => void; onOpenRequest: (id: number) => void;
  diagnosisInvalidateKey?: number;
}
const stamp = (value: string | null, locale: Locale) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function TaskList({ items, selected, locale, onSelect, checked, onCheck,onRequest }: { onRequest:(task:TaskSummary,request:string)=>void;items: TaskSummary[]; selected: string | null; locale: Locale; onSelect: (task: TaskSummary) => void; checked: string[]; onCheck: (id: string, shift: boolean) => void }) {
  const [expanded,setExpanded]=useState<TaskSummary|null>(null);
  useEffect(()=>setExpanded(old=>old?items.find(task=>task.id===old.id)??null:null),[items]);
  const parent = useRef<HTMLDivElement>(null), c = copy(locale);
  const list = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => 112, overscan: 3 });
  return <><div className="task-list-scroll" ref={parent} role="list" aria-label={c.tasks}>
    <div style={{ height: list.getTotalSize(), position: 'relative' }}>{list.getVirtualItems().map(row => {
      const task = items[row.index]!;
      return <div key={task.id} role="listitem" style={{ position: 'absolute', width: '100%', height: row.size, transform: `translateY(${row.start}px)` }}>
        <button type="button" className={`task-list-item ${selected === task.id ? 'is-selected' : ''}`} onClick={() => onSelect(task)} aria-current={selected === task.id ? 'true' : undefined}>
          <span className="task-list-meta"><span className="task-provider">{task.provider}</span><span>{stamp(task.updatedAt, locale)}</span></span>
          <strong title={task.title}>{task.title || task.provider}</strong>
          <span className="task-list-meta"><span>{task.memberCount > 1 ? `${task.memberCount} ${c.members}` : c.single}</span><span>{task.eventCount.toLocaleString()} {c.records}</span></span>
        </button><button type="button" className="ui-icon-btn" style={{position:'absolute',bottom:'var(--space-1)',right:'var(--space-2)'}} aria-label={(locale==='zh'?'展开请求 ':'Expand requests ')+task.title} onClick={()=>setExpanded(expanded?.id===task.id?null:task)}>▾</button><input className="architecture-select" type="checkbox" aria-label={`选择 ${task.title || task.id}`} checked={checked.includes(task.id)} onChange={event => onCheck(task.id, (event.nativeEvent as MouseEvent).shiftKey)} />
      </div>;
    })}</div>
  </div>{expanded&&<RequestExpansion key={expanded.id} task={expanded} locale={locale} onSelect={request=>onRequest(expanded,request)} open/>}</>;
}

/** Task-scoped reading state. App retains global navigation, locale, runtime and SSE ownership. */
export function TaskWorkbench({ locale, route, onRoute, changes, onIntake, onOpenRequest, providerPreset, onProviderPresetChange, diagnosisInvalidateKey = 0, onLegacyCompare, settingsRevision=0, onSettings }: TaskWorkbenchProps): React.JSX.Element {
  const c = copy(locale), [q, setQ] = useState(route.task?'':route.q??''), [localProvider, setLocalProvider] = useState(''), [localRange, setLocalRange] = useState<'all' | '7d' | '30d' | 'today'>('all');
  const range=route.homeRange??localRange, setRange=(value:typeof localRange)=>{setLocalRange(value);onRoute({...route,homeRange:value});};
  const [checked, setChecked] = useState<string[]>([]), lastCheck = useRef<string | null>(null);
  const comparing = route.compareImport;
  const provider = providerPreset ?? localProvider;
  const setProvider = (value: string) => { if (onProviderPresetChange) onProviderPresetChange(value as ProviderKey | ''); else setLocalProvider(value); };
  const [offset, setOffset] = useState(0), [listQuery, setListQuery] = useState(''), [collapsed, setCollapsed] = useState(()=>loadBool(LAYOUT_KEYS.railCollapsed,false));
  const [listStale, setListStale] = useState(false), [notice, setNotice] = useState('');
  const homeRoute=useRef(route);homeRoute.current=route;
  const routeWriter=useRef(onRoute);routeWriter.current=onRoute;
  useEffect(() => { const timer = setTimeout(() => { setListQuery(q); setOffset(0); if(!homeRoute.current.task)routeWriter.current({...homeRoute.current,q:q||undefined}); }, 250); return () => clearTimeout(timer); }, [q]);
  const readList = useCallback((signal: AbortSignal) => taskApi.list({ origin: route.origin, q: listQuery, provider: provider === '' ? undefined : provider as ProviderKey, range, offset, limit: 50, summary:true, sort:route.homeSort, direction:route.homeDirection, currency:route.homeCurrency, alerts:route.homeFilter==='alerts',errors:route.homeFilter==='errors',failed:route.homeFilter==='failed',toolFailures:route.homeFilter==='toolFailures' }, signal), [route.origin, listQuery, provider, range, offset, route.homeSort, route.homeDirection, route.homeCurrency, route.homeFilter]);
  const tasks = useTaskRead(JSON.stringify([route.origin, listQuery, provider, range, offset, route.homeSort, route.homeDirection, route.homeCurrency, route.homeFilter,settingsRevision]), readList, 10000);
  const pageScope=JSON.stringify([route.origin,listQuery,provider,range,offset,route.homeSort,route.homeDirection,route.homeCurrency,route.homeFilter]);
  const retainedPage=useRef<{scope:string;value:TaskPage}|null>(null);
  if(tasks.value)retainedPage.current={scope:pageScope,value:tasks.value};
  const listPage=tasks.value??(retainedPage.current?.scope===pageScope?retainedPage.current.value:null);
  const hydration=useTaskHydration(listPage?.items,!route.task&&!comparing?pageScope:null,changes.version,tasks.retry);
  const onCheck = (id: string, shift: boolean) => { const ids = listPage?.items.map(t => t.id) ?? []; const start = ids.indexOf(lastCheck.current ?? ''), end = ids.indexOf(id); const range = shift && start >= 0 ? ids.slice(Math.min(start, end), Math.max(start, end) + 1) : [id]; setChecked(old => old.includes(id) ? old.filter(x => !range.includes(x)) : [...new Set([...old, ...range])].slice(0, 40)); lastCheck.current = id; };
  useEffect(()=>{storeBool(LAYOUT_KEYS.railCollapsed,collapsed);},[collapsed]);
  useEffect(()=>{const search=(event:KeyboardEvent)=>{if(event.key!=='/'||event.metaKey||event.ctrlKey||event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement)return;event.preventDefault();setCollapsed(false);setTimeout(()=>document.querySelector<HTMLInputElement>('.task-list-filters input')?.focus(),0);};document.addEventListener('keydown',search);return()=>document.removeEventListener('keydown',search);},[]);
  useEffect(()=>{if(changes.reset){tasks.retry();setListStale(false);}},[changes.reset,changes.version,tasks.retry]);
  const wasSelected=useRef(Boolean(route.task));
  useEffect(()=>{if(wasSelected.current&&!route.task)tasks.retry();wasSelected.current=Boolean(route.task);},[route.task,tasks.retry]);
  const assignGroup=(group:'A'|'B')=>{onRoute({...route,overview:undefined,[group==='A'?'compareA':'compareB']:checked,[group==='A'?'compareB':'compareA']:(group==='A'?route.compareB:route.compareA)?.filter(id=>!checked.includes(id))});setChecked([]);};
  const [auditCwd, setAuditCwd] = useState('');
  const overviewRead = useCallback(async(signal: AbortSignal) => (await import('../agent-folding/architecture-client.js')).architectureApi.scope({ provider: provider === 'codex' ? 'codex' : 'claude', ...(checked.length ? { taskIds: checked } : {}), ...(auditCwd ? { cwd: auditCwd } : {}), ...(range !== 'all' ? { from: new Date(Date.now() - (range === 'today' ? 1 : range === '7d' ? 7 : 30) * 86400000).toISOString() } : {}) }, signal), [provider, checked, range, auditCwd]);
  const overview = useTaskRead(route.overview ? JSON.stringify([provider, checked, range, auditCwd]) : null, overviewRead, 35000);
  const locateArchitecture = (task: string, sessionKey: string | null = null, eventId: string | null = null) => onRoute({ ...route, overview: undefined, compareImport: undefined, compareA: undefined, compareB: undefined, task, member: sessionKey ? 'all' : 'main', mode: 'trajectory', event: sessionKey && eventId ? `${sessionKey}:event:${eventId}` : null });
  const readContext = useCallback((signal: AbortSignal) => taskApi.context(route.task!, signal), [route.task]);
  const context = useTaskRead(route.task ? route.task+':'+settingsRevision : null, readContext, 10000);
  useEffect(() => { if (changes.version > 0) setListStale(true); }, [changes.version]);
  const nativeMember = context.value && route.member === 'main' && route.task?.startsWith('collected:') && route.task !== context.value.task.id ? context.value.members.find(member => member.sessionKey === route.task!.slice(10)) : null;
  const resolvedRoute = nativeMember ? { ...route, member: nativeMember.id } : route;
  const changeOrigin = (origin: TaskRoute['origin']) => { setOffset(0); onRoute({ ...route, origin, task: null, health: undefined, event: null, member: 'main', q: undefined, errors: undefined, from: undefined, to: undefined }); };
  const selectTask = (task: TaskSummary) => { setNotice(''); onRoute({ ...route, overview: undefined, compareImport: undefined, compareA: undefined, compareB: undefined, task: task.id, request:undefined, health: undefined, origin: task.origin, member: 'main', event: null, q: undefined, errors: undefined, from: undefined, to: undefined }); };
  const refresh = () => { tasks.retry(); hydration.restart(); context.retry(); setListStale(false); };
  return <div className={`task-workbench ${collapsed ? 'task-list-collapsed' : ''}`}>
    <aside className="task-sidebar" aria-busy={tasks.loading}>
      <header><div><span className="task-eyebrow">WORKSPACE</span><h2>{c.tasks}</h2></div><button type="button" className="ui-icon-btn" onClick={() => setCollapsed(true)} aria-label={c.foldList}>‹</button></header>
      <div className="task-origin-tabs" role="tablist" aria-label={c.source}>{(['collected', 'imported'] as const).map(origin => <button type="button" role="tab" aria-selected={route.origin === origin} key={origin} onClick={() => changeOrigin(origin)}>{c[origin]}</button>)}</div>
      <div className="task-list-filters"><input maxLength={200} aria-label={c.searchTasks} placeholder={c.searchTasks} value={q} onChange={event => setQ(event.target.value)} />
        <div><select aria-label={c.provider} value={provider} onChange={event => { setProvider(event.target.value); setOffset(0); }} disabled={route.origin === 'imported'}><option value="">{c.allProviders}</option>{PROVIDER_KEYS.map(key => <option key={key} value={key}>{key}</option>)}</select><select aria-label={c.time} value={range} onChange={event => { setRange(event.target.value as typeof range); setOffset(0); }} disabled={route.origin === 'imported'}><option value="all">{c.allTime}</option><option value="today">{c.today}</option><option value="7d">{c.recent}</option><option value="30d">{c.month}</option></select></div>
      </div>
      <div className="task-list-count"><span>{listPage?.total ?? '—'} {c.taskCount}</span><button type="button" onClick={refresh}>{listStale ? `${c.newer} ↻` : c.refresh}</button></div>
      <div className="architecture-toolbar"><button className="btn" onClick={() => onRoute({ ...route, overview: true })}>架构概况</button><span>{checked.length} 已选</span>{(['A', 'B'] as const).map(group => <button className="btn" key={group} disabled={!checked.length} onClick={()=>assignGroup(group)}>{locale==='zh'?'设为':'Set as'} {group==='A'?(locale==='zh'?'基线':'Baseline'):(locale==='zh'?'改进':'Improvement')}</button>)}<small>{locale==='zh'?'基线':'Baseline'} {route.compareA?.length ?? 0} / {locale==='zh'?'改进':'Improvement'} {route.compareB?.length ?? 0}</small><button className="btn" onClick={onLegacyCompare}>{locale==='zh'?'进入对比':'Open comparison'}</button></div>
      {tasks.loading && <p role="status" className="task-inline-state">{c.loading}</p>}
      {tasks.error && <div className="task-inline-state" role="alert"><p>{tasks.error}</p><button type="button" className="btn" onClick={tasks.retry}>{c.retry}</button></div>}
      {listPage && <TaskList items={listPage.items} selected={context.value?.task.id ?? route.task} locale={locale} onSelect={selectTask} checked={checked} onCheck={onCheck} onRequest={(task,request)=>onRoute({...route,task:task.id,origin:task.origin,request,member:'all',event:null,health:undefined})} />}
      {listPage?.items.length === 0 && <div className="task-inline-state"><p>{c.empty}</p><button type="button" className="btn" onClick={() => { setQ(''); setProvider(''); setRange('all'); }}>{c.clear}</button></div>}
      <footer><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>←</button><span>{offset + (listPage?.items.length ? 1 : 0)}–{offset + (listPage?.items.length ?? 0)}</span><button type="button" disabled={!listPage?.hasMore} onClick={() => setOffset(offset + 50)}>→</button><button type="button" className="btn" onClick={onIntake}>＋ {c.intake}</button></footer>
    </aside>
    <main className="task-main"><Suspense fallback={<p role="status">{c.loading}</p>}>
      {route.task && <button type="button" className="btn task-mobile-back" onClick={() => onRoute({ ...route, task: null, event: null, member: 'main' })}>← {c.showList}</button>}
      {collapsed && <button type="button" className="task-restore-list btn" onClick={() => setCollapsed(false)}>☰ {c.showList}</button>}
      {context.loading && <div className="task-loading" role="status">{c.loading}</div>}
      {context.error && <div className="task-empty" role="alert"><h2>{context.error}</h2><button type="button" className="btn" onClick={context.retry}>{c.retry}</button></div>}
      {!route.task && !comparing && <>
        <div className="task-home-toolbar"><h1>{locale==='zh'?'任务健康':'Task health'}</h1>
          <input aria-label={locale==='zh'?'健康列表搜索':'Search health list'} placeholder={c.searchTasks} maxLength={200} value={q} onChange={e=>setQ(e.target.value)}/>
          <select aria-label={locale==='zh'?'健康列表工具':'Health list tool'} value={provider} disabled={route.origin==='imported'} onChange={e=>{setProvider(e.target.value);setOffset(0);}}><option value="">{c.allProviders}</option>{PROVIDER_KEYS.map(key=><option key={key}>{key}</option>)}</select>
          <select aria-label={locale==='zh'?'健康列表时间':'Health list time'} value={range} onChange={e=>{setRange(e.target.value as typeof range);setOffset(0);}}>{(['all','today','7d','30d'] as const).map((value,i)=><option key={value} value={value}>{[c.allTime,c.today,c.recent,c.month][i]}</option>)}</select>

          <label>{locale==='zh'?'排序':'Sort'} <select aria-label={locale==='zh'?'健康列表排序':'Health list sort'} value={route.homeSort??'time'} onChange={e=>{setOffset(0);onRoute({...route,homeSort:e.target.value as TaskRoute['homeSort']});}}>{(['time','duration','errors','tokens','cost'] as const).map((sort,i)=><option key={sort} value={sort}>{(locale==='zh'?['时间','时长','错误数','Token','费用']:['Time','Duration','Errors','Tokens','Cost'])[i]}</option>)}</select></label>
          <button className="btn" onClick={()=>{setOffset(0);onRoute({...route,homeDirection:route.homeDirection==='asc'?'desc':'asc'});}}>{route.homeDirection==='asc'?'↑':'↓'}</button>
          <label>{locale==='zh'?'币种':'Currency'} <select aria-label={locale==='zh'?'费用排序币种':'Cost sorting currency'} value={route.homeCurrency??'USD'} onChange={e=>{setOffset(0);onRoute({...route,homeCurrency:e.target.value as 'USD'|'CNY'});}}><option>USD</option><option>CNY</option></select></label>
          <label>{locale==='zh'?'筛选':'Filter'} <select aria-label={locale==='zh'?'健康列表筛选':'Health list filter'} value={route.homeFilter??'all'} onChange={e=>{setOffset(0);onRoute({...route,homeFilter:e.target.value as TaskRoute['homeFilter']});}}>{(['all','alerts','errors','failed','toolFailures'] as const).map((filter,i)=><option key={filter} value={filter}>{(locale==='zh'?['全部','仅看有告警','仅看有错误','主会话记录失败','有工具失败结果']:['All','With alerts','With errors','Recorded failure','Tool failure results'])[i]}</option>)}</select></label>
          {onSettings&&<button type="button" className="btn" onClick={()=>onSettings({section:'alert-thresholds'})}>{locale==='zh'?'配置阈值':'Configure thresholds'}</button>}
          <button className="btn" onClick={onLegacyCompare}>{locale==='zh'?'进入对比':'Open comparison'}</button>
        </div>
        <div className="task-home-toolbar"><span>{listPage?.total??'—'} {c.taskCount} · {checked.length} {locale==='zh'?'已选':'selected'}</span>{(['A','B'] as const).map(group=><button className="btn" key={group} disabled={!checked.length} onClick={()=>assignGroup(group)}>{locale==='zh'?'设为':'Set as'} {group==='A'?(locale==='zh'?'基线':'Baseline'):(locale==='zh'?'改进':'Improvement')}</button>)}<small>{locale==='zh'?'基线':'Baseline'} {route.compareA?.length??0} / {locale==='zh'?'改进':'Improvement'} {route.compareB?.length??0}</small><button className="btn" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>←</button><span>{offset+(listPage?.items.length?1:0)}–{offset+(listPage?.items.length??0)}</span><button className="btn" disabled={!listPage?.hasMore} onClick={()=>setOffset(offset+50)}>→</button><button className="btn" onClick={refresh}>{listStale?c.newer:c.refresh}</button></div>
        {listPage&&<TaskHealthList onRequest={(task,request)=>onRoute({...route,task:task.id,origin:task.origin,request,member:'all',event:null,health:undefined})} refreshError={Boolean(tasks.error)} progress={hydration.progress} onSettings={onSettings} items={listPage.items} locale={locale} checked={checked} onCheck={onCheck} onSelect={selectTask} onIntake={onIntake} onHealth={task=>{selectTask(task);onRoute({...route,task:task.id,origin:task.origin,member:'all',event:null,health:task.latestHealth?.id??'new'});}}/>}
        {tasks.loading&&<p role="status">{c.loading}</p>}
        {tasks.error&&<p role="alert">{tasks.error}<button className="btn" onClick={tasks.retry}>{c.retry}</button></p>}
      </>}
      {route.compareImport && <ImportedArchitectureCompare locale={locale} onLocate={locateArchitecture} onClose={() => onRoute({ ...route, compareImport: undefined })} />}
      {context.value && !comparing && <TaskProcess key={context.value.task.id+':'+(route.request??'')} context={context.value} route={resolvedRoute} onRoute={onRoute} locale={locale} changes={changes}
        diagnosisInvalidateKey={diagnosisInvalidateKey} onRefreshContext={context.retry} onOpenRequest={onOpenRequest} onNotice={setNotice} />}
      {route.overview && <aside className="architecture-drawer" aria-label="架构概况"><header><strong>架构概况 · {provider === 'codex' ? 'Codex' : 'Claude'}</strong><button className="btn" onClick={() => onRoute({ ...route, overview: undefined })}>{locale === 'zh' ? '关闭' : 'Close'}</button></header><p>使用左侧工具、时间和已选任务限定审计范围。</p><label>项目目录<input aria-label="审计项目目录" value={auditCwd} maxLength={4096} onChange={e => setAuditCwd(e.target.value)} /></label>{overview.loading && <p role="status">{locale === 'zh' ? '读取本地记录…' : 'Reading local records…'}</p>}{overview.error && <ArchitectureReadError error={overview.errorInfo ?? overview.error} locale={locale} retry={overview.retry} />}{overview.value && <TaskArchitecture key={overview.value.sources[0]?.revision} project={overview.value} locale={locale} onLocate={locateArchitecture} />}</aside>}
      {notice && <div className="task-toast" role="status">{notice}</div>}
    </Suspense></main>
  </div>;
}
