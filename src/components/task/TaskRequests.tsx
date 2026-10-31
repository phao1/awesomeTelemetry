import { useCallback, useState } from 'react';
import type { TaskContext, TaskSummary } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import { taskApi, useTaskRead } from './task-data.js';
import { TaskSummaryBar } from './TaskSummaryBar.js';
import { formatDuration } from '../../core/task-health/format.js';

/** Optional request metadata must never take down the task/comparison page. */
export function RequestListNotice({loading,error,empty,locale,retry}:{loading:boolean;error:string|null;empty:boolean;locale:Locale;retry:()=>void}){
  const zh=locale==='zh';
  if(loading)return <p role="status">{zh?'读取请求…':'Reading requests…'}</p>;
  if(error)return <p role="status">{zh?'请求不可用':'Requests unavailable'} <button className="btn" onClick={retry}>{zh?'重试':'Retry'}</button></p>;
  return empty?<p role="status">{zh?'请求不可用：没有真实用户提问边界':'No requests available: no genuine user prompt boundaries'}</p>:null;
}

export function RequestNavigator({context,request,locale,onSelect}:{context:TaskContext;request?:string;locale:Locale;onSelect:(id:string|undefined)=>void}){
  const read=useCallback((signal:AbortSignal)=>taskApi.requests(context.task.id,signal),[context.task.id]);
  const result=useTaskRead(JSON.stringify([context.task.id,context.task.updatedAt,context.task.eventCount,context.task.loadedMemberCount]),read,10000),zh=locale==='zh';
  const items=result.value?.items??[],index=items.findIndex(r=>r.id===request),selected=items[index];
  return <section aria-label={zh?'请求导航':'Request navigation'}>
    <RequestListNotice loading={result.loading} error={result.error} empty={Boolean(result.value&&!items.length)} locale={locale} retry={result.retry}/>
    {items.length>0&&<><button className="btn" disabled={index<=0} onClick={()=>onSelect(items[index-1]!.id)}>{zh?'上一条':'Previous'}</button>
    <select aria-label={zh?'选择请求':'Choose request'} value={request??''} onChange={e=>onSelect(e.target.value||undefined)}><option value="">{zh?'全任务':'Whole task'}</option>{items.map(r=><option key={r.id} value={r.id}>{r.ordinal}. {r.title}</option>)}</select>
    <button className="btn" disabled={index<0||index>=items.length-1} onClick={()=>onSelect(items[index+1]!.id)}>{zh?'下一条':'Next'}</button></>}
    {request&&<button className="btn" onClick={()=>onSelect(undefined)}>{zh?'回到全任务':'Whole task'}</button>}
    {request&&!selected&&result.value&&<p role="alert">{zh?'请求已不可用，请回到全任务。':'Request unavailable. Return to whole task.'}</p>}
    {selected&&<TaskSummaryBar context={{...context,metrics:selected.metrics,task:{...context.task,eventCount:selected.eventCount,title:selected.title,startedAt:selected.startedAt,recordedStatus:'unknown'}}} locale={locale}/>}
  </section>;
}
export function RequestExpansion({task,locale,onSelect,open=false}:{task:TaskSummary;locale:Locale;onSelect:(id:string)=>void;open?:boolean}){
  const [expanded,setExpanded]=useState(open),zh=locale==='zh';
  const read=useCallback((signal:AbortSignal)=>taskApi.requests(task.id,signal),[task.id]);
  const result=useTaskRead(expanded?JSON.stringify([task.id,task.updatedAt,task.eventCount,task.loadedMemberCount]):null,read,10000);
  const items=result.value?.items??[];
  return <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>{zh?'请求列表':'Requests'} · {task.title}</summary>
    {expanded&&<RequestListNotice loading={result.loading} error={result.error} empty={Boolean(result.value&&!items.length)} locale={locale} retry={result.retry}/>}
    <ul style={{maxHeight:'calc(var(--space-6) * 12)',overflow:'auto'}}>{items.map(r=><li key={r.id}><button className="btn" onClick={()=>onSelect(r.id)}>{r.ordinal}. {r.title}</button> · {formatDuration(r.metrics.durationMs,locale)} · {r.eventCount} {zh?'事件':'events'} · {r.metrics.toolCalls??'—'} {zh?'工具':'tools'} · {r.metrics.errors??'—'} {zh?'错误':'errors'} · Token {r.metrics.correctedTotal??'—'} {r.metrics.coverage&&r.metrics.coverage.correctedTotal.known<r.metrics.coverage.correctedTotal.total?`(${r.metrics.coverage.correctedTotal.known}/${r.metrics.coverage.correctedTotal.total} ${zh?'成员已知':'members known'})`:''} {r.alerts.length?`⚠ ${r.alerts.length}`:''}</li>)}</ul>
  </details>;
}

export function RequestPicker({taskId,value,label,exclude,locale,onSelect}:{exclude?:string;taskId?:string;value?:string;label:string;locale:Locale;onSelect:(id:string|undefined)=>void}){
  const read=useCallback((signal:AbortSignal)=>taskApi.requests(taskId!,signal),[taskId]);
  const result=useTaskRead(taskId??null,read,10000);
  const items=result.value?.items??[];
  if(!taskId)return null;
  return <div><RequestListNotice loading={result.loading} error={result.error} empty={Boolean(result.value&&!items.length)} locale={locale} retry={result.retry}/>
    {items.length>0&&<label>{label} · {locale==='zh'?'请求':'Request'}<select aria-label={label+' request'} value={value??''} onChange={e=>onSelect(e.target.value||undefined)}><option value="">{locale==='zh'?'全任务':'Whole task'}</option>{items.filter(r=>r.id!==exclude).map(r=><option key={r.id} value={r.id}>{r.ordinal}. {r.title}</option>)}</select></label>}
    {!items.length&&value&&<button className="btn" onClick={()=>onSelect(undefined)}>{locale==='zh'?'全任务':'Whole task'}</button>}
  </div>;
}
