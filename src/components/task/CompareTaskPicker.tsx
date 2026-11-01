import { useCallback, useEffect, useState } from 'react';
import type { TaskSummary } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import { formatRelativeTime, formatTokens } from '../../core/format.js';
import { taskApi, useTaskRead } from './task-data.js';
import { Card, CardBody, CardHeader } from '../ui/Display.js';
import { MultiCombobox, Select } from '../ui/Select.js';
import { SegmentedControl } from '../ui/Controls.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { ArchitectureReadError } from '../agent-folding/ArchitectureReadError.js';
export function CompareRequestPicker({taskId,value,label,exclude,locale,onSelect}:{taskId?:string;value?:string;label:string;exclude?:string;locale:Locale;onSelect:(value:string|undefined)=>void}) {
 const read=useCallback((signal:AbortSignal)=>taskApi.requests(taskId!,signal),[taskId]);
 const result=useTaskRead(taskId??null,read,10000),zh=locale==='zh';
 if(!taskId)return null;
 return <div className="compare-request-picker">{result.loading&&<PageSkeleton compact variant="table"/>}{result.error&&<ArchitectureReadError error={result.errorInfo??result.error} locale={locale} retry={result.retry}/>}{result.value&&<Select locale={locale} closeKey={taskId+':'+value} aria-label={label+' request'} prefix={label+' · '+(zh?'请求':'Request')} value={value??''} options={[{value:'',label:zh?'全任务':'Whole task'},...result.value.items.filter(r=>r.id!==exclude).map(r=>({value:r.id,label:`${r.ordinal}. ${r.title}`,description:formatRelativeTime(r.startedAt,locale)+' · '+formatTokens(r.metrics.correctedTotal)+' Token'}))]} onChange={e=>onSelect(e.target.value||undefined)}/>}</div>;
}
export function CompareTaskPicker({side,ids,other,selected,locale,onChange,request,onRequest,closeKey}:{closeKey?:string;side:'A'|'B';ids:string[];other:string[];selected:TaskSummary[];locale:Locale;onChange:(ids:string[])=>void;request?:string;onRequest:(id:string|undefined)=>void}) {
 const zh=locale==='zh',name=side==='A'?(zh?'基线':'Baseline'):(zh?'改进':'Improvement');
 const [origin,setOrigin]=useState<'collected'|'imported'>('collected'),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[loaded,setLoaded]=useState<TaskSummary[]>([]),[remembered,setRemembered]=useState<TaskSummary[]>([]);
 useEffect(()=>{if(query===search)return;const timer=setTimeout(()=>{setSearch(query);setOffset(0);setLoaded([]);},250);return()=>clearTimeout(timer);},[query,search]);
 const read=useCallback((signal:AbortSignal)=>taskApi.list({q:search,origin,offset,limit:50,summary:true},signal),[search,origin,offset]);
 const tasks=useTaskRead(JSON.stringify([search,origin,offset]),read,35000);
 useEffect(()=>{if(!tasks.value)return;const items=tasks.value.items;setLoaded(previous=>offset?[...previous,...items.filter(t=>!previous.some(p=>p.id===t.id))]:items);setRemembered(previous=>[...previous.filter(t=>!items.some(i=>i.id===t.id)),...items]);},[tasks.value,offset]);
 const known=[...new Map([...remembered,...selected,...loaded].map(t=>[t.id,t])).values()];
 const options=[...ids.filter(id=>!loaded.some(t=>t.id===id)).map(id=>known.find(t=>t.id===id)??({id,title:id,provider:'',updatedAt:'',metrics:undefined} as TaskSummary)),...loaded];
 return <Card className={`task-compare-picker compare-side-${side.toLowerCase()}`}><CardHeader title={`${side} · ${name}`} description={`${ids.length}/40 ${zh?'个任务':'tasks'}`}/><CardBody>
 <MultiCombobox popupClassName="task-compare-picker-popup" locale={locale} closeKey={closeKey} label={`${name} ${zh?'搜索任务':'search tasks'}`} placeholder={zh?'选择任务':'Choose tasks'} value={ids} onChange={onChange} remoteSearch onSearchChange={setQuery} options={options.map(t=>({hidden:!loaded.some(item=>item.id===t.id),value:t.id,label:t.title||t.id,description:`${t.provider} · ${t.updatedAt?formatRelativeTime(t.updatedAt,locale):'—'} · ${formatTokens(t.metrics?.correctedTotal)} Token`,disabled:other.includes(t.id)||!ids.includes(t.id)&&ids.length>=40}))} popupHeader={<SegmentedControl activeId={origin} onChange={value=>{if(value===origin)return;setOrigin(value as typeof origin);setOffset(0);setLoaded([]);}} items={[{id:'collected',label:zh?'采集':'Collected'},{id:'imported',label:zh?'导入':'Imported'}]}/>} loading={tasks.loading} onLoadMore={tasks.value?.hasMore?()=>setOffset(offset+50):undefined} loadMoreLabel={zh?'加载更多':'Load more'}/>
 {tasks.error&&<ArchitectureReadError error={tasks.errorInfo??tasks.error} locale={locale} retry={tasks.retry}/>}
 {ids.length===1&&<CompareRequestPicker taskId={ids[0]} value={request} label={side} locale={locale} onSelect={onRequest}/>}
 </CardBody></Card>;
}
