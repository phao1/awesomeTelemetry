import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fetchJson } from '../../api/client.js';
import type { OverviewPoint, OverviewRange, OverviewSnapshot } from '../../core/overview-types.js';
import type { ProviderKey } from '../../core/trace-types.js';
import type { TaskRoute } from '../../task-route.js';
import type { Locale } from '../../i18n.js';
import { formatCount, formatCoverage, formatPercent, formatRelativeTime, formatTokens } from '../../core/format.js';
import { useTaskRead } from './task-data.js';
import { overviewCopy } from './overview-copy.js';
import { PageHeader } from '../PageHeader.js';
import { Card, CardBody, CardHeader, StatCard } from '../ui/Display.js';
import { IconButton } from '../ui/Button.js';
import { SegmentedControl } from '../ui/Controls.js';
import { Select } from '../ui/Select.js';
import { Tabs } from '../ui/Tabs.js';
import { EmptyState, ErrorState } from '../ui/States.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { Tooltip } from '../ui/Overlay.js';
import { IconInfo, IconRefresh, IconDashboard } from '../icons/index.js';
import { BarChart } from '../charts/BarChart.js';
import { LineChart } from '../charts/LineChart.js';
import { DonutChart } from '../charts/DonutChart.js';
import { BarList } from '../charts/BarList.js';
import '../../styles/components/overview-dashboard.css';

export function overviewChange(current: number | null, previous: number | null, reliable: boolean): number | undefined {
  return reliable && current != null && previous != null && previous > 0 ? (current - previous) / previous : undefined;
}
function filters() { const q = new URLSearchParams(window.location.hash.split('?')[1]); const value = q.get('overviewRange') ?? q.get('range') ?? '7d'; return { range: (['24h','7d','30d','all'].includes(value) ? value : '7d') as OverviewRange, provider: q.get('overviewProvider') ?? '', tab: q.get('overviewTab') === 'agent' ? 'agent' : 'overview' }; }
export function OverviewKpis({locale,invalidateKey,onNavigate,onConfigureThresholds,children,onSearch,onMenu}:{locale:Locale;invalidateKey:number;onNavigate:(route:Partial<TaskRoute>)=>void;onConfigureThresholds?:()=>void;children?:ReactNode;onSearch?:()=>void;onMenu?:()=>void}) {
 const c=overviewCopy(locale),[filter,setFilter]=useState(filters);
 useEffect(()=>{const changed=()=>setFilter(filters());window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
 const update=(next:Partial<typeof filter>)=>{const value={...filter,...next};setFilter(value);const [path,query]=window.location.hash.split('?'),q=new URLSearchParams(query);q.set('overviewRange',value.range);q.set('overviewTab',value.tab);if(value.provider)q.set('overviewProvider',value.provider);else q.delete('overviewProvider');window.history.replaceState(null,'',path+'?'+q);};
 const read=useCallback(async(signal:AbortSignal)=>{const q=new URLSearchParams({overview:'1',range:filter.range,provider:filter.provider});const value=await fetchJson<OverviewSnapshot>('/task-kpis?'+q,{signal});if(!value?.current||!Array.isArray(value.daily)||!Array.isArray(value.tools))throw new Error('INVALID_OVERVIEW');return value;},[filter.range,filter.provider]);
 const state=useTaskRead(JSON.stringify([filter.range,filter.provider,invalidateKey]),read,35000),k=state.value;
 const navigate=(patch:Partial<TaskRoute>)=>onNavigate({...patch,homeRange:filter.range==='24h'?'today':filter.range,homeProvider:(filter.provider||undefined) as ProviderKey|undefined});
 const values=(p:OverviewPoint)=>([p.tasks,p.tokens,p.cacheHitRate,p.failurePct==null?null:p.failurePct/100,p.toolFailurePct==null?null:p.toolFailurePct/100,p.alerts]);
 const complete=(p:OverviewPoint,index:number)=>index!==5&&p.tasks>0&&(index===1?p.tokenKnownTasks===p.tasks:index===2?p.cacheKnownMembers===p.cacheTotalMembers&&p.cacheTotalMembers>0:index===3?p.statusKnownTasks===p.tasks:index===4?p.toolKnownTasks===p.tasks:true);
 const chart=(index:number,body:ReactNode)=><Card key={index}><CardHeader title={c.charts[index]} description={c.descriptions[index]} actions={<Tooltip label={k?.criteria[locale]??c.unknown}><IconButton label={c.criteria} icon={<IconInfo/>}/></Tooltip>}/><CardBody>{body}</CardBody></Card>;
 const empty=<EmptyState icon={<IconDashboard/>} title={c.empty} description={c.reason}/>;
 const daily=k?.daily??[],labels=daily.map(p=>p.day.slice(0,10));
 return <div className="overview-dashboard"><PageHeader title={c.title} locale={locale} onSearch={onSearch} onMenu={onMenu} actions={<><SegmentedControl activeId={filter.range} onChange={range=>update({range:range as OverviewRange})} items={(['24h','7d','30d','all'] as const).map((id,i)=>({id,label:locale==='zh'?['24 小时','7 天','30 天','全部'][i]:['24 hours','7 days','30 days','All'][i]}))}/><Select locale={locale} aria-label={c.tools} value={filter.provider} options={[{value:'',label:c.tools},...(k?.providers??[]).map(p=>({value:p.label,label:p.label,color:`var(--provider-${p.label})`}))]} onChange={e=>update({provider:e.target.value})}/><IconButton label={c.refresh} icon={<IconRefresh/>} onClick={state.retry}/></>}/>
 <div className="overview-content"><Tabs activeId={filter.tab} onChange={tab=>update({tab})} items={[{id:'overview',label:c.title},{id:'agent',label:c.agent}]}/>
 {filter.tab==='agent'?children:<>{state.loading&&<PageSkeleton locale={locale}/ >}{state.error&&<ErrorState code="OVERVIEW_READ_FAILED" message={state.error} onRetry={state.retry}/>}
 {k&&<><div className="overview-stat-grid">{c.labels.map((label,index)=>{const value=values(k.current)[index]??null,prior=k.previous?values(k.previous)[index]??null:null,change=overviewChange(value,prior,complete(k.current,index)&&!!k.previous&&complete(k.previous,index));const coverage=index===1?formatCoverage(k.current.tokenKnownTasks,k.current.tasks,locale):index===2?formatCoverage(k.current.cacheKnownMembers,k.current.cacheTotalMembers,locale):index===3?formatCoverage(k.current.statusKnownTasks,k.current.tasks,locale):index===4?formatCoverage(k.current.toolKnownTasks,k.current.tasks,locale):'';const patch:Partial<TaskRoute>=index===5?{homeFilter:'alerts'}:index===3?{homeFilter:'failed'}:index===4?{homeFilter:'toolFailures'}:index===1?{homeSort:'tokens'}:index===2?{homeSort:'cacheHitRate'}:{};return <div key={label} className="overview-stat" role="link" tabIndex={0} aria-label={label} onClick={()=>navigate(patch)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();navigate(patch);}}}><StatCard label={label} value={index===1?formatTokens(value):index>=2&&index<=4?formatPercent(value):formatCount(value,locale)} higherIsBetter={index<3} change={change} comparison={change===undefined?coverage:c.previous} unknownReason={value===null||coverage?c.unknown:undefined} points={daily.every(p=>values(p)[index]!=null)?daily.map(p=>values(p)[index]!):undefined}/></div>;})}</div>
 <div className="overview-chart-grid">
 {chart(0,daily.length?<BarChart locale={locale} label={c.charts[0]} stacked labels={labels} series={(['input','output','cacheRead','cacheWrite'] as const).filter(key=>daily.some(p=>p[key]!=null)).map((key)=>({label:c[key],points:daily.map(p=>p[key]),color:`var(--token-${({input:'input',output:'output',cacheRead:'cache-read',cacheWrite:'cache-write'})[key]})`}))}/>:empty)}
 {chart(1,daily.length?<BarChart locale={locale} label={c.charts[1]} labels={labels} series={[{label:c.labels[0]!,points:daily.map(p=>p.tasks),color:'var(--chart-1)'},{label:c.failed,points:daily.map(p=>p.failedTasks),color:'var(--danger-emphasis)'}]}/>:empty)}
 {chart(2,daily.length&&daily.some(p=>p.cacheHitRate!=null)?<LineChart locale={locale} label={c.charts[2]} yAxis="percent" labels={labels} series={[{label:c.labels[2]!,points:daily.map(p=>p.cacheHitRate),color:'var(--token-cache-read)'}]}/>:<EmptyState icon={<IconInfo/>} title="—" description={c.unknown}/>)}
 {chart(3,<BarList locale={locale} label={c.charts[3]} items={k.tools.map(t=>({label:`${t.tool} · ${t.failures}/${t.results}`,value:t.failures/t.results,color:'var(--danger-emphasis)'}))} format={formatPercent}/>)}
 {chart(4,k.models.length?<DonutChart locale={locale} slices={k.models} centerLabel={formatTokens(k.models.reduce((n,p)=>n+p.value,0))}/>:<EmptyState icon={<IconInfo/>} title="—" description={c.models}/>)}
 {chart(5,<DonutChart locale={locale} slices={k.providers.filter(p=>p.value>0)} centerLabel={formatCount(k.current.tasks,locale)}/>)}
 {chart(6,k.alerts.length?<div className="overview-table"><table className="ui-table"><thead><tr><th>{c.task}</th><th>{c.alerts}</th><th>{c.time}</th></tr></thead><tbody>{k.alerts.map(t=><tr key={t.id} tabIndex={0} onClick={()=>navigate({task:t.id})} onKeyDown={e=>{if(e.key==='Enter')navigate({task:t.id});}}><th>{t.title||t.id}</th><td className="num">{t.alerts?.length}</td><td title={t.updatedAt}>{formatRelativeTime(t.updatedAt,locale)}</td></tr>)}</tbody></table></div>:<EmptyState icon={<IconDashboard/>} title={c.noAlerts} action={onConfigureThresholds&&<IconButton label={locale==='zh'?'配置阈值':'Configure thresholds'} icon={<IconInfo/>} onClick={onConfigureThresholds}/>}/>)}
 </div></> }</>}
 </div></div>;
}
