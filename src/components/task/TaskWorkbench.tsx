import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { LocalSettingsTarget, TaskSummary, TaskPage } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import { PROVIDER_KEYS, type ProviderKey } from '../../core/trace-types.js';
import { serializeTaskRoute, type TaskRoute } from '../../task-route.js';
import { taskApi, useTaskRead } from './task-data.js';
import { useTaskHydration } from './task-hydration.js';
import { TaskHealthList } from './TaskHealthList.js';
import { PageHeader } from '../PageHeader.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { Button, IconButton } from '../ui/Button.js';
import { Badge, ProviderBadge } from '../ui/Badge.js';
import { Callout } from '../ui/Display.js';
import { SearchInput } from '../ui/Input.js';
import { Select } from '../ui/Select.js';
import { SegmentedControl } from '../ui/Controls.js';
import { DropdownMenu, Tooltip } from '../ui/Overlay.js';
import { Toast } from '../ui/States.js';
import { IconRefresh, IconArrowUp, IconArrowDown, IconFilter, IconPanelLeft, IconChevronLeft, IconChevronRight, IconCopy, IconMoreHorizontal } from '../icons/index.js';
import { formatRelativeTime, formatTokens } from '../../core/format.js';
import { copy } from './copy.js';
import '../../styles/task-health.css';
import '../../styles/task-workbench.css';
import '../../styles/task-process.css';
import '../../styles/task-reader.css';
import '../../styles/task-f3.css';
const TaskProcess=lazy(()=>import('./TaskProcess.js').then(m=>({default:m.TaskProcess})));
export interface TaskChanges { version: number; keys: string[]; runIds: string[]; reset?: boolean }
export interface TaskWorkbenchProps {
 onSettings?: (target: LocalSettingsTarget) => void; settingsRevision?: number; onLegacyCompare?: () => void;
 providerPreset?: ProviderKey | ''; onProviderPresetChange?: (provider: ProviderKey | '') => void;
 locale: Locale; route: TaskRoute; onRoute: (route: TaskRoute) => void; changes: TaskChanges;
 onIntake: () => void; onOpenRequest: (id: number) => void; diagnosisInvalidateKey?: number;
 onSearch?:()=>void; onMenu?:()=>void;
}
const PANEL_KEY='agent-observability.task-panel';
function readPanel(){try{return localStorage.getItem(PANEL_KEY)==='true';}catch(error){console.error('[task-panel] read failed',error);return false;}}
export function TaskWorkbench({locale,route,onRoute,changes,onIntake,onOpenRequest,providerPreset,onProviderPresetChange,diagnosisInvalidateKey=0,onLegacyCompare,settingsRevision=0,onSettings,onSearch,onMenu}:TaskWorkbenchProps){
 const zh=locale==='zh',c=copy(locale),text=(cn:string,en:string)=>zh?cn:en;
 const [q,setQ]=useState(route.task?'':route.q??''),[listQuery,setListQuery]=useState(route.task?'':route.q??'');
 const [neighbor,setNeighbor]=useState<{offset:number;edge:'first'|'last'}|null>(null);
 const [checked,setChecked]=useState<string[]>([]),[panel,setPanel]=useState(readPanel),[notice,setNotice]=useState(''),[filterOpen,setFilterOpen]=useState(false),[menu,setMenu]=useState(false);
 const provider=route.homeProvider??providerPreset??'',range=route.homeRange??'all',size=route.homeSize??50,offset=(route.homePage??0)*size;
 const filters=route.homeFilters??(route.homeFilter&&route.homeFilter!=='all'?[route.homeFilter]:[]);
 const searchInput=useRef<HTMLInputElement>(null);
 const latest=useRef({route,onRoute});latest.current={route,onRoute};
 useEffect(()=>{const focus=(event:KeyboardEvent)=>{if(event.defaultPrevented||latest.current.route.task||event.key!=='/'||event.metaKey||event.ctrlKey||event.altKey||document.querySelector('[aria-modal=true]')||(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]')))return;event.preventDefault();searchInput.current?.focus();};document.addEventListener('keydown',focus);return()=>document.removeEventListener('keydown',focus);},[]);
 useEffect(()=>{if(!route.task){setQ(route.q??'');setListQuery(route.q??'');}},[route.q,route.task]);
 useEffect(()=>{if(q===listQuery)return;const timer=setTimeout(()=>{setListQuery(q);const {route:r,onRoute:write}=latest.current;if(!r.task)write({...r,q:q||undefined,homePage:0});},250);return()=>clearTimeout(timer);},[q,listQuery]);
 useEffect(()=>{try{localStorage.setItem(PANEL_KEY,String(panel));}catch(error){console.error('[task-panel] write failed',error);}},[panel]);
 const patch=(value:Partial<TaskRoute>)=>{const next={...latest.current.route,...value,homePage:0};latest.current.route=next;onRoute(next);};
 const setProvider=(value:string)=>{onProviderPresetChange?.(value as ProviderKey|'');patch({homeProvider:value as ProviderKey||undefined});};
 const filterKey=filters.join(',');
 const readList=useCallback((signal:AbortSignal)=>taskApi.list({origin:route.origin,q:listQuery,provider:provider as ProviderKey||undefined,range,offset,limit:size,summary:true,sort:route.homeSort??'activity',direction:route.homeDirection??'desc',alerts:filters.includes('alerts'),errors:filters.includes('errors'),failed:filters.includes('failed'),toolFailures:filters.includes('toolFailures')},signal),[route.origin,listQuery,provider,range,offset,size,route.homeSort,route.homeDirection,filterKey]);
 const scope=JSON.stringify([route.origin,listQuery,provider,range,offset,size,route.homeSort,route.homeDirection,filterKey]);
 const tasks=useTaskRead(scope+settingsRevision,readList,10000),retained=useRef<{scope:string;value:TaskPage}|null>(null);
 if(tasks.value)retained.current={scope,value:tasks.value};
 const page=tasks.value??(retained.current?.scope===scope?retained.current.value:null);
 const hydration=useTaskHydration(page?.items,!route.task?scope:null,changes.version,tasks.retry);
 const readContext=useCallback((signal:AbortSignal)=>taskApi.context(route.task!,signal),[route.task]);
 const context=useTaskRead(route.task?route.task+settingsRevision:null,readContext,10000);
 useEffect(()=>{if(changes.reset)tasks.retry();},[changes.reset,changes.version,tasks.retry]);
 const wasSelected=useRef(Boolean(route.task));useEffect(()=>{if(wasSelected.current&&!route.task)tasks.retry();wasSelected.current=Boolean(route.task);},[route.task,tasks.retry]);
 const nativeMember=context.value&&route.member==='main'&&route.task?.startsWith('collected:')&&route.task!==context.value.task.id?context.value.members.find(m=>m.sessionKey===route.task!.slice(10)):null;
 const selectTask=(task:TaskSummary)=>onRoute({...route,task:task.id,origin:task.origin,request:undefined,health:undefined,member:'main',event:null,q:undefined,errors:undefined,from:undefined,to:undefined,mode:'trajectory'});
 useEffect(()=>{if(!neighbor||!tasks.value||tasks.value.offset!==neighbor.offset)return;const target=neighbor.edge==='last'?tasks.value.items.at(-1):tasks.value.items[0];setNeighbor(null);if(target)onRoute({...latest.current.route,task:target.id,origin:target.origin,request:undefined,health:undefined,member:'main',event:null,q:undefined,errors:undefined,from:undefined,to:undefined,mode:'trajectory'});},[neighbor,tasks.value,onRoute]);
 const back=()=>onRoute({...route,task:null,request:undefined,health:undefined,event:null,member:'main',q:undefined,errors:undefined,from:undefined,to:undefined});
 const assign=(group:'A'|'B',ids=checked)=>{onRoute({...route,requestA:undefined,requestB:undefined,processA:undefined,processB:undefined,[group==='A'?'compareA':'compareB']:ids,[group==='A'?'compareB':'compareA']:(group==='A'?route.compareB:route.compareA)?.filter(id=>!ids.includes(id))});setChecked([]);setNotice(text('已设为','Set as ')+(group==='A'?text('基线','baseline'):text('改进','improvement')));};
 const compare=(ids=checked)=>{const a=ids.length?ids.slice(0,1):route.compareA,b=ids.length>1?ids.slice(1):route.compareB;onRoute({...route,requestA:undefined,requestB:undefined,processA:undefined,processB:undefined,compareA:a,compareB:b?.filter(id=>!a?.includes(id))});onLegacyCompare?.();};
 const share=async(href:string)=>{try{await navigator.clipboard.writeText(href);setNotice(c.copied);}catch(error){console.error('[task-share] Copy failed',error);setNotice(c.copyFailed);}};
 const refresh=()=>{tasks.retry();hydration.restart();context.retry();};
 const items=page?.items??[],active=items.findIndex(t=>t.id===(context.value?.task.id??route.task));
 const moveTask=(delta:-1|1)=>{if(active<0)return;const target=items[active+delta];if(target){selectTask(target);return;}const next=offset+delta*size;setNeighbor({offset:next,edge:delta<0?'last':'first'});onRoute({...route,homePage:next/size});};
 const origin=(value:string)=>{setQ('');setListQuery('');onRoute({...route,origin:value as TaskRoute['origin'],task:null,request:undefined,health:undefined,member:'main',event:null,q:undefined,errors:undefined,from:undefined,to:undefined,homePage:0});};
 const options=[['activity',text('最近活动','Recent activity')],['time',text('开始时间','Start time')],['duration',text('时长','Duration')],['errors',text('错误数','Errors')],['tokens','Token'],['cacheHitRate',text('缓存命中','Cache hit')]];
 const filterOptions=[['alerts',text('有告警','With alerts')],['errors',text('有错误','With errors')],['failed',text('主会话记录失败','Recorded failure')],['toolFailures',text('有工具失败结果','Tool failure results')]] as const;
 return <div className="task-workbench task-f3"><main className="task-main">
  <PageHeader breadcrumbOnly={Boolean(route.task)} title={route.task?context.value?.task.title??c.tasks:c.tasks} locale={locale} onSearch={onSearch} onMenu={onMenu} titleBadge={!route.task?<Badge>{page?.total??'—'}</Badge>:undefined} breadcrumb={route.task?<><Button variant="link" onClick={back}>{c.tasks}</Button><span>/</span><Tooltip label={context.value?.task.title??'—'}><span className="task-f3-breadcrumb-title" tabIndex={0}>{context.value?.task.title??'—'}</span></Tooltip></>:undefined} actions={route.task?<>
   <IconButton label={text('上一个任务','Previous task')} icon={<IconChevronLeft/>} disabled={tasks.loading||active<0||active===0&&offset===0} onClick={()=>moveTask(-1)}/><IconButton label={text('下一个任务','Next task')} icon={<IconChevronRight/>} disabled={tasks.loading||active<0||active>=items.length-1&&!page?.hasMore} onClick={()=>moveTask(1)}/>
   <IconButton label={c.showList} icon={<IconPanelLeft/>} aria-pressed={panel} onClick={()=>setPanel(!panel)}/><IconButton label={c.share} icon={<IconCopy/>} onClick={()=>void share(window.location.href)}/>
   <Button variant="primary" aria-expanded={Boolean(route.health)} aria-controls="task-health-drawer" onClick={()=>onRoute({...route,health:route.health?undefined:'new'})}>{text('健康监测','Health monitoring')}</Button>
   <DropdownMenu open={menu} onOpenChange={setMenu} trigger={props=><IconButton {...props} label={text('任务操作','Task actions')} icon={<IconMoreHorizontal/>}/>} items={[{id:'a',label:text('设为基线','Set as Baseline'),onSelect:()=>assign('A',[route.task!])},{id:'b',label:text('设为改进','Set as Improvement'),onSelect:()=>assign('B',[route.task!])},{id:'compare',label:text('在对比中打开','Open in comparison'),onSelect:()=>compare([route.task!])},{id:'export',label:text('导出','Export'),onSelect:()=>{const blob=new Blob([JSON.stringify(context.value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='task-summary.json';a.click();URL.revokeObjectURL(url);}}]}/>
  </>:<><Button variant="ghost" onClick={()=>onSettings?.({section:'alert-thresholds'})}>{text('健康阈值','Health thresholds')}</Button><IconButton label={c.refresh} icon={<IconRefresh/>} onClick={refresh}/></>}/>
  {!route.task?<div className="task-f3-content">
   <div className="task-f3-toolbar"><SearchInput inputRef={searchInput} aria-label={c.searchTasks} placeholder={c.searchTasks} maxLength={200} value={q} onChange={e=>setQ(e.target.value)}/>
    <SegmentedControl activeId={route.origin} onChange={origin} items={['collected','imported'].map(id=>({id,label:id==='collected'?c.collected:c.imported}))}/>
    <Select aria-label={c.provider} prefix={text('工具','Tool')} value={provider} onChange={e=>setProvider(e.target.value)} options={[{value:'',label:c.allProviders},...PROVIDER_KEYS.map(value=>({value,label:value,color:`var(--provider-${value})`}))]}/>
    <SegmentedControl activeId={range} onChange={value=>patch({homeRange:value as TaskRoute['homeRange']})} items={['today','7d','30d','all'].map((id,i)=>({id,label:[text('24 小时','24 hours'),text('7 天','7 days'),text('30 天','30 days'),c.allTime][i]}))}/>
    <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen} trigger={props=><Button {...props} icon={<IconFilter/>}>{text('筛选','Filter')}{filters.length>0&&<Badge>{filters.length}</Badge>}</Button>} items={filterOptions.map(([id,label])=>({id,label:`${filters.includes(id)?'✓ ':''}${label}`,onSelect:()=>patch({homeFilter:undefined,homeFilters:filters.includes(id)?filters.filter(f=>f!==id):[...filters,id]})}))}/>
    <Select aria-label={text('排序','Sort')} value={route.homeSort??'activity'} options={options.map(([value,label])=>({value:value!,label:label!}))} onChange={e=>patch({homeSort:e.target.value as TaskRoute['homeSort']})}/>
    <IconButton label={text('切换排序方向','Toggle sort direction')} icon={route.homeDirection==='asc'?<IconArrowUp/>:<IconArrowDown/>} onClick={()=>patch({homeDirection:route.homeDirection==='asc'?'desc':'asc'})}/>
   </div>
   {tasks.error&&<Callout title={tasks.error} tone="danger"><Button onClick={tasks.retry}>{c.retry}</Button></Callout>}
   {(!tasks.error||page)&&<TaskHealthList timeBasis={route.homeSort==='time'?'time':'activity'} items={items} locale={locale} checked={checked} onSelectionChange={setChecked} onCheck={id=>setChecked(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])} onSelect={selectTask} onIntake={onIntake} loading={tasks.loading&&!page} progress={hydration.progress} refreshError={Boolean(tasks.error)} onHealth={task=>onRoute({...route,task:task.id,origin:task.origin,member:'all',event:null,health:task.latestHealth?.id??'new'})} onRequest={(task,request)=>onRoute({...route,task:task.id,origin:task.origin,request,member:'all',event:null,health:undefined})} onAssign={assign} onShare={task=>{const link=new URL(window.location.href);link.hash=serializeTaskRoute({...route,task:task.id,event:null,request:undefined,health:undefined,member:'main',mode:'trajectory',q:undefined,errors:undefined,from:undefined,to:undefined});void share(link.href);}} bulkActions={<><Button variant="ghost" onClick={()=>assign('A')}>{text('设为基线','Set as Baseline')}</Button><Button variant="ghost" onClick={()=>assign('B')}>{text('设为改进','Set as Improvement')}</Button><Button variant="ghost" onClick={()=>compare()}>{text('对比','Compare')}</Button></>} pagination={{page:route.homePage??0,pageSize:size,total:page?.total??0,onPageChange:homePage=>onRoute({...latest.current.route,homePage}),onPageSizeChange:homeSize=>patch({homeSize}),pageSizes:[10,25,50],label:text(`共 ${page?.total??0} 个任务`,`${page?.total??0} tasks`)}}/>}
  </div>:<div className="task-f3-detail">
   {panel&&<aside className="task-f3-panel" aria-label={c.tasks}><SegmentedControl activeId={route.origin} onChange={origin} items={['collected','imported'].map(id=>({id,label:id==='collected'?c.collected:c.imported}))}/>{items.map(task=><Button key={task.id} className="task-f3-panel-item" variant={task.id===context.value?.task.id?'secondary':'ghost'} aria-current={task.id===context.value?.task.id?'true':undefined} onClick={()=>selectTask(task)}><strong title={task.title}>{task.title}</strong><span><ProviderBadge locale={locale} provider={task.provider as ProviderKey}/><time>{formatRelativeTime((route.homeSort==='time'?task.startedAt:task.updatedAt)??task.updatedAt,locale)}</time><span className="num">{formatTokens(task.metrics?.correctedTotal)}</span></span></Button>)}</aside>}
   {neighbor&&tasks.error&&<Callout title={tasks.error} tone="danger"><Button onClick={tasks.retry}>{c.retry}</Button></Callout>}{context.loading&&<PageSkeleton/>}{context.error&&<Callout title={context.error} tone="danger"><Button onClick={context.retry}>{c.retry}</Button></Callout>}
   {context.value&&<Suspense fallback={<PageSkeleton/>}><TaskProcess key={context.value.task.id+':'+(route.request??'')} context={context.value} route={nativeMember?{...route,member:nativeMember.id}:route} onRoute={onRoute} locale={locale} changes={changes} diagnosisInvalidateKey={diagnosisInvalidateKey} onRefreshContext={context.retry} onOpenRequest={onOpenRequest} onNotice={setNotice}/></Suspense>}
  </div>}
  {notice&&<Toast title={notice} onDismiss={()=>setNotice('')}/>}
 </main></div>;
}
