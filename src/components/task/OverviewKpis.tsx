import { useCallback } from 'react';
import { fetchJson } from '../../api/client.js';
import type { TaskKpis } from '../../core/task-types.js';
import type { TaskRoute } from '../../task-route.js';
import type { Locale } from '../../i18n.js';
import { formatCacheHitRate } from '../../core/task-alerts.js';
import { useTaskRead } from './task-data.js';
export function OverviewKpis({locale,invalidateKey,onNavigate,onConfigureThresholds}:{locale:Locale;invalidateKey:number;onNavigate:(route:Partial<TaskRoute>)=>void;onConfigureThresholds?:()=>void}){
  const read=useCallback(async(signal:AbortSignal)=>{const value=await fetchJson<TaskKpis>('/task-kpis',{signal});if(!value||!Number.isSafeInteger(value.tasks)||!Number.isSafeInteger(value.statusKnownTasks)||!Number.isSafeInteger(value.toolKnownTasks)||!(value.cacheHitRate===null||typeof value.cacheHitRate==='number'))throw new Error('Invalid task metrics response');return value;},[]),state=useTaskRead('kpis:'+invalidateKey,read,10000),zh=locale==='zh',k=state.value;
  const pct=(n:number|null|undefined)=>n==null?'—':n.toFixed(1)+'%';
  const rows:Array<[string,string,Partial<TaskRoute>]>=[
    [zh?'近 7 天任务':'Tasks · last 7 days',k?String(k.tasks):'—',{}],
    [zh?'失败率':'Failure rate',pct(k?.failurePct)+(k&&k.statusKnownTasks<k.tasks?(zh?' · 部分':' · Partial'):''),{homeFilter:'failed'}],
    [zh?'工具失败率':'Tool failure rate',pct(k?.toolFailurePct)+(k&&k.toolKnownTasks<k.tasks?(zh?' · 部分':' · Partial'):''),{homeFilter:'toolFailures'}],
    ['Token',k?.tokens==null?'—':k.tokens.toLocaleString()+(k.tokenKnownTasks<k.tasks?(zh?' · 部分':' · Partial'):''),{homeSort:'tokens'}],
    [zh?'缓存命中率':'Cache hit rate',k?formatCacheHitRate({cacheHitRate:k.cacheHitRate},zh)+(k.cacheKnownMembers<k.cacheTotalMembers?` · ${zh?'部分':'Partial'} (${k.cacheKnownMembers}/${k.cacheTotalMembers} ${zh?'成员':'members'})`:''):'—',{homeSort:'cacheHitRate'}],
    [zh?'告警任务':'Tasks with alerts',k?String(k.alerts):'—',{homeFilter:'alerts'}],
  ];
  return <section aria-label={zh?'近 7 天关键指标':'Key metrics · last 7 days'} className="overview-kpis">
    {state.error?<p role="alert">{state.error} <button className="btn" onClick={state.retry}>{zh?'重试':'Retry'}</button></p>:rows.map(([title,value,route])=><div className="overview-kpi-group" key={title}><button className="overview-kpi" key={title} onClick={()=>onNavigate({...route,homeRange:'7d'})} disabled={!k}><span>{title}</span><strong>{value}</strong></button>{route.homeFilter==='alerts'&&onConfigureThresholds&&<button type="button" className="btn overview-threshold-link" onClick={onConfigureThresholds}>{zh?'配置阈值':'Configure thresholds'}</button>}</div>)}
    {state.loading&&<span role="status">{zh?'读取指标…':'Loading metrics…'}</span>}
  </section>;
}
