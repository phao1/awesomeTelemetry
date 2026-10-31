import { RequestExpansion } from './TaskRequests.js';
import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LocalSettingsTarget, TaskHydrationProgress, TaskHydrationReason, TaskSummary } from '../../core/task-types.js';
import type { Locale } from '../../i18n.js';
import { ALERT_LABELS, formatCacheHitRate } from '../../core/task-alerts.js';
import { formatDuration } from '../../core/task-health/format.js';

const REASONS: Record<TaskHydrationReason, [string,string]> = {
  source_missing:['原生文件已不存在，保留任务记录。','The native file is missing; the task record is retained.'],
  source_unreadable:['原生文件不可读取。','The native file is not readable.'],
  parse_failed:['详情解析失败，可刷新后重试。','Detail parsing failed; refresh to retry.'],
  member_unavailable:['成员记录缺失或超出读取上限。','Member metadata is unavailable or exceeds the read limit.'],
  cancelled:['后台加载已取消，可刷新后重试。','Background loading was cancelled; refresh to retry.'],
  request_failed:['后台加载连接不可用，可刷新后重试。','Background loading is unavailable; refresh to retry.'],
};
export function TaskHealthList({items,locale,checked,onCheck,onSelect,onHealth,onIntake,onRequest,progress={},refreshError=false}:{items:TaskSummary[];locale:Locale;checked:string[];onCheck:(id:string,shift:boolean)=>void;onSelect:(task:TaskSummary)=>void;onHealth:(task:TaskSummary)=>void;onIntake:()=>void;onRequest?:(task:TaskSummary,request:string)=>void;onSettings?:(target:LocalSettingsTarget)=>void;progress?:Record<string,TaskHydrationProgress>;refreshError?:boolean}) {
  const zh=locale==='zh',parent=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState<TaskSummary|null>(null);
  useEffect(()=>setExpanded(old=>old?items.find(task=>task.id===old.id)??null:null),[items]);
  const [narrow,setNarrow]=useState(()=>window.innerWidth<=640);
  useEffect(()=>{if(typeof window.matchMedia!=='function')return;const media=window.matchMedia('(max-width: 640px)'),change=()=>setNarrow(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const list=useVirtualizer({count:items.length,getScrollElement:()=>parent.current,estimateSize:()=>narrow?280:96,overscan:3,initialRect:{width:1200,height:600}});
  useEffect(()=>list.measure(),[narrow,list]);
  const unknown=zh?'未知':'Unknown',loading=zh?'加载中':'Loading';
  if(!items.length)return <div className="task-empty"><h2>{zh?'当前范围没有任务':'No tasks in this range'}</h2><p>{zh?'调整筛选，或从数据接入选择日志来源。':'Adjust filters or choose a log source in Data intake.'}</p><button className="btn" onClick={onIntake}>{zh?'数据接入':'Data intake'}</button></div>;
  return <section className="task-health-list" aria-label={zh?'任务健康列表':'Task health list'}>
    {expanded&&<RequestExpansion task={expanded} locale={locale} onSelect={request=>onRequest?.(expanded,request)} open />}
    <div className="task-health-columns">{(zh?['选择','标题 / 工具','开始 / 时长','成员 / 工具输入 / 错误记录','修正 Token / 缓存命中','最近标准报告 / 告警','健康监测']:['Select','Title / Tool','Start / Duration','Members / Tool inputs / Error records','Corrected tokens / Cache hit','Latest saved report / Alerts','Health']).map(label=><span key={label}>{label}</span>)}</div>
    <div className="task-health-scroll" ref={parent}><div style={{height:list.getTotalSize(),position:'relative'}}>{list.getVirtualItems().map(row=>{
      const task=items[row.index]!,m=task.metrics,report=task.latestHealth,p=progress[task.id];
      const pending=Boolean(p&&(p.pending>0||p.loaded>task.loadedMemberCount&&!refreshError));
      const reason=refreshError?(zh?'摘要刷新失败，可重试读取。':'Summary refresh failed; retry the read.'):p?.reasons.length?p.reasons.map(code=>REASONS[code]?.[zh?0:1]??code).join('\n'):task.loadedMemberCount<task.memberCount?(zh?'成员详情覆盖不足，尚无法完整汇总。':'Member details are incomplete; full totals are unavailable.'):(zh?'来源未提供可信用量、时长或计数。':'The source did not provide trusted usage, duration or counts.');
      const value=(n:number|null|undefined)=>n==null?(pending?loading:unknown):n.toLocaleString();
      const tooltip=task.alerts?.map(a=>`${ALERT_LABELS[a.rule][zh?0:1]}: ${a.actual.toLocaleString()} > ${a.threshold.toLocaleString()}`).join('\n');
      const coverage=m?.coverage?.correctedTotal;
      const tokens=value(m?.correctedTotal)+(m?.correctedTotal!=null&&coverage&&coverage.known<coverage.total?(zh?` · 部分（${coverage.known}/${coverage.total} 成员）`:` · Partial (${coverage.known}/${coverage.total} members)`):'');
      return <div className="task-health-row" onClick={e=>{if(!(e.target as HTMLElement).closest('button,input,select,a'))onSelect(task);}} key={task.id} style={{position:'absolute',width:'100%',height:row.size,transform:`translateY(${row.start}px)`}}>
        <input type="checkbox" aria-label={(zh?'选择 ':'Select ')+(task.title||task.id)} checked={checked.includes(task.id)} onChange={e=>onCheck(task.id,(e.nativeEvent as MouseEvent).shiftKey)}/>
        <span><button type="button" className="task-health-title" onClick={()=>onSelect(task)}><strong>{task.title||task.id}</strong><small>{task.provider}</small></button><button type="button" className="btn" onClick={()=>setExpanded(expanded?.id===task.id?null:task)}>{zh?'请求':'Requests'} ▾</button></span>
        <span title={m?.durationMs==null?reason:undefined}>{narrow&&<small className="task-row-label">{zh?'开始 / 时长':'Start / Duration'}</small>}{task.startedAt?new Date(task.startedAt).toLocaleString(zh?'zh-CN':'en-NZ'):unknown}<small>{m?.durationMs==null?value(null):formatDuration(m.durationMs,locale)}</small></span>
        <span title={m?.toolCalls==null||m?.errors==null?reason:undefined}>{narrow&&<small className="task-row-label">{zh?'成员 / 工具输入 / 错误记录':'Members / Tool inputs / Error records'}</small>}{task.memberCount} / {value(m?.toolCalls)} / {value(m?.errors)}</span>
        <span title={[m?.correctedTotal==null||coverage&&coverage.known<coverage.total?reason:undefined,coverage?.missing.map(member=>`${member.name}: ${member.reason}`).join('\n')].filter(Boolean).join('\n')}>{narrow&&<small className="task-row-label">{zh?'修正 Token / 缓存命中':'Corrected tokens / Cache hit'}</small>}{tokens}
          <small className="task-cache-cell" title={m?.cacheHitRate==null?reason:undefined}>{pending&&m?.cacheHitRate==null?loading:formatCacheHitRate(m,zh)}</small>
        </span>
        <span>{report?<><button type="button" className="btn" onClick={()=>onHealth(task)}>{(zh?{findings:'发现问题',not_observed:'未观察到问题',insufficient:'证据不足'}:{findings:'Findings',not_observed:'Not observed',insufficient:'Insufficient evidence'})[report.conclusion]} · {report.issues}</button><small title={[report.revision,report.scope?.member,report.scope?.from,report.scope?.to].filter(Boolean).join(' · ')}>{new Date(report.generatedAt).toLocaleString()} · {zh?'历史报告':'Saved report'}</small></>:<small>{zh?'暂无已存标准报告':'No saved standard report'}</small>}{Boolean(task.alerts?.length)&&<span className="task-alert-badge" title={tooltip}>⚠ {task.alerts!.length} {zh?'告警':'alerts'}</span>}</span>
        <button type="button" className="btn" onClick={()=>onHealth(task)}>{zh?'健康监测':'Health monitoring'}</button>
      </div>;
    })}</div></div>
  </section>;
}
