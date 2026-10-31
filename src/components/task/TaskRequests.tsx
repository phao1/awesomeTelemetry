import { Tooltip } from '../ui/Overlay.js';
import { DataTable } from '../ui/DataTable.js';
import { Badge } from '../ui/Badge.js';
import { SegmentedControl } from '../ui/Controls.js';
import { Combobox } from '../ui/Select.js';
import { Button, IconButton } from '../ui/Button.js';
import { Accordion, Callout } from '../ui/Display.js';
import { Skeleton, EmptyState } from '../ui/States.js';
import { IconChevronLeft, IconChevronRight, IconMessageSquare } from '../icons/index.js';
import { formatTokens, formatAbsoluteTime, formatDuration } from '../../core/format.js';
import { formatCacheHitRate } from '../../core/task-alerts.js';
import { useCallback, useState, type ReactNode } from 'react';
import type { TaskContext, TaskSummary } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import { taskApi, useTaskRead } from './task-data.js';
import { TaskSummaryBar } from './TaskSummaryBar.js';

/** Optional request metadata must never take down the task/comparison page. */
export function RequestListNotice({loading,error,empty,locale,retry}:{loading:boolean;error:string|null;empty:boolean;locale:Locale;retry:()=>void}){
  const zh=locale==='zh';
  if(loading)return <Skeleton variant="row"/>;
  if(error)return <Callout title={zh?'请求不可用':'Requests unavailable'} tone="danger"><Button onClick={retry}>{zh?'重试':'Retry'}</Button></Callout>;
  return empty?<EmptyState icon={<IconMessageSquare/>} title={zh?'请求不可用：没有真实用户提问边界':'No requests available: no genuine user prompt boundaries'}/>:null;
}

export function RequestNavigator({context,request,locale,onSelect,controls}:{controls?:ReactNode;context:TaskContext;request?:string;locale:Locale;onSelect:(id:string|undefined)=>void}){
  const read=useCallback((signal:AbortSignal)=>taskApi.requests(context.task.id,signal),[context.task.id]);
  const result=useTaskRead(JSON.stringify([context.task.id,context.task.updatedAt,context.task.eventCount,context.task.loadedMemberCount]),read,10000),zh=locale==='zh';
  const items=result.value?.items??[],index=items.findIndex(r=>r.id===request),selected=items[index];
  return <section className="task-f3-requests" aria-label={zh?'请求导航':'Request navigation'}>
    <div className="task-f3-request-controls">{controls}<SegmentedControl activeId={request?'request':'all'} onChange={mode=>onSelect(mode==='all'?undefined:items[0]?.id)} items={[{id:'all',label:zh?'全任务':'Whole task'},{id:'request',label:zh?'按请求':'By request',disabled:!items.length}]}/>
    {request&&<><IconButton label={zh?'上一条':'Previous'} icon={<IconChevronLeft/>} disabled={index<=0} onClick={()=>onSelect(items[index-1]!.id)}/><Tooltip label={`${zh?'请求':'Request'} ${index+1} / ${items.length} · ${selected?.title??'—'}`}><span className="task-f3-request-title num" tabIndex={0}>{zh?'请求':'Request'} {index+1} / {items.length} · {selected?.title}</span></Tooltip><IconButton label={zh?'下一条':'Next'} icon={<IconChevronRight/>} disabled={index<0||index>=items.length-1} onClick={()=>onSelect(items[index+1]!.id)}/><Combobox label={zh?'选择请求':'Choose request'} value={request} options={items.map(r=>({value:r.id,label:`${r.ordinal}. ${r.title}`,description:`${formatAbsoluteTime(r.startedAt,locale)} · ${formatTokens(r.metrics.correctedTotal)} Token`}))} onChange={onSelect}/></>}
    </div><RequestListNotice loading={result.loading} error={result.error} empty={Boolean(result.value&&!items.length)} locale={locale} retry={result.retry}/>
    {request&&!selected&&result.value&&<p role="alert">{zh?'请求已不可用，请回到全任务。':'Request unavailable. Return to whole task.'}</p>}
    {selected&&<TaskSummaryBar context={{...context,metrics:selected.metrics,task:{...context.task,eventCount:selected.eventCount,title:selected.title,startedAt:selected.startedAt,recordedStatus:'unknown'}}} locale={locale}/>}
  </section>;
}
export function RequestExpansion({task,locale,onSelect,open=false}:{task:TaskSummary;locale:Locale;onSelect:(id:string)=>void;open?:boolean}){
  const [expanded,setExpanded]=useState(open),zh=locale==='zh';
  const read=useCallback((signal:AbortSignal)=>taskApi.requests(task.id,signal),[task.id]);
  const result=useTaskRead(expanded?JSON.stringify([task.id,task.updatedAt,task.eventCount,task.loadedMemberCount]):null,read,10000);
  const items=result.value?.items??[];
  return <Accordion open={expanded} onOpenChange={setExpanded} title={`${zh?'请求列表':'Requests'} (${items.length}) · ${task.title}`}>
    {expanded&&<RequestListNotice loading={result.loading} error={result.error} empty={Boolean(result.value&&!items.length)} locale={locale} retry={result.retry}/>}
    {items.length>0&&<DataTable locale={locale} label={zh?'请求列表':'Request list'} rows={items} rowKey={r=>r.id} density="compact" onRowClick={r=>onSelect(r.id)} columns={[
      {key:'request',label:zh?'请求':'Request',render:r=><Button variant="link" onClick={()=>onSelect(r.id)}>{r.ordinal}. {r.title}</Button>},
      {key:'duration',label:zh?'时长':'Duration',align:'right',render:r=>formatDuration(r.metrics.durationMs,locale)},
      {key:'tools',label:zh?'工具调用':'Tool calls',align:'right',render:r=>formatTokens(r.metrics.toolCalls)},
      {key:'errors',label:zh?'错误':'Errors',align:'right',render:r=>formatTokens(r.metrics.errors)},
      {key:'tokens',label:'Token',align:'right',render:r=><span>{formatTokens(r.metrics.correctedTotal)}{r.metrics.coverage&&r.metrics.coverage.correctedTotal.known<r.metrics.coverage.correctedTotal.total&&<Badge>{zh?'部分':'Partial'} {r.metrics.coverage.correctedTotal.known}/{r.metrics.coverage.correctedTotal.total}</Badge>}</span>},
      {key:'cache',label:zh?'缓存命中':'Cache hit',align:'right',render:r=>r.metrics.cacheHitRate==null?'—':formatCacheHitRate(r.metrics,zh)},
      {key:'alerts',label:zh?'告警':'Alerts',align:'right',render:r=><Badge tone={r.alerts.length?'attention':'neutral'}>{r.alerts.length}</Badge>}
    ]}/> }
  </Accordion>;
}

export function RequestPicker({taskId,value,label,exclude,locale,onSelect}:{exclude?:string;taskId?:string;value?:string;label:string;locale:Locale;onSelect:(id:string|undefined)=>void}){
  const read=useCallback((signal:AbortSignal)=>taskApi.requests(taskId!,signal),[taskId]);
  const result=useTaskRead(taskId??null,read,10000);
  const items=result.value?.items??[];
  if(!taskId)return null;
  return <div><RequestListNotice loading={result.loading} error={result.error} empty={Boolean(result.value&&!items.length)} locale={locale} retry={result.retry}/>
    {items.length>0&&<Combobox label={label+' request'} value={value??''} onChange={id=>onSelect(id||undefined)} options={[{value:'',label:locale==='zh'?'全任务':'Whole task'},...items.filter(r=>r.id!==exclude).map(r=>({value:r.id,label:`${r.ordinal}. ${r.title}`,description:`${formatAbsoluteTime(r.startedAt,locale)} · ${formatTokens(r.metrics.correctedTotal)} Token`}))]}/>}
    {!items.length&&value&&<Button variant="ghost" onClick={()=>onSelect(undefined)}>{locale==='zh'?'全任务':'Whole task'}</Button>}

  </div>;
}
