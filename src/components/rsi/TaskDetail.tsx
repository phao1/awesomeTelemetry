import { Tooltip } from '../ui/Overlay.js';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { RsiTaskView, RsiMetrics } from '../../core/rsi-api-client.js';
import { rsiApi } from '../../core/rsi-api-client.js';
import type { RsiIteration, RsiInstruction } from '../../core/rsi-types.js';
import { Card, CardHeader, CardBody, MetricStrip, Meter, Callout } from '../ui/Display.js';
import { Tabs } from '../ui/Tabs.js';
import { Table } from '../ui/Table.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { SegmentedControl } from '../ui/Controls.js';
import { Badge } from '../ui/Badge.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { EmptyState } from '../ui/States.js';
import { IconMessage, IconList } from '../icons/index.js';
import type { HumanAction } from './Actions.js';
import type { RsiRoute } from './route.js';
import { useRsiRead } from './data.js';
import { Trends } from './Trend.js';
import { Numeric, Reason, ReadError, WriteError, Status, Time } from './Shared.js';
import { copy, reasonLabel, pauseReasonLabel } from './copy.js';
export function TaskAttention({task,metrics,workerRunning,workerError,locale,onAction}:{task:RsiTaskView;metrics:RsiMetrics|null;workerRunning:boolean;workerError:string|null;locale:Locale;onAction:(action:HumanAction)=>void}) {
  if(task.state==='needs_help')return <Callout tone="danger" title={copy(locale,'优化者需要帮助','The optimizer needs help')}><p>{metrics?.helpReason??copy(locale,'尚无求助理由','No help reason available')}</p><div className="rsi-inline"><Button onClick={()=>onAction('set_target')}>{copy(locale,'放宽目标','Adjust target')}</Button><Button onClick={()=>onAction('instruction')}>{copy(locale,'给思路','Give an idea')}</Button><Button variant="danger" onClick={()=>onAction('stop')}>{copy(locale,'终止','Stop')}</Button></div></Callout>;
  if(task.state==='paused')return <Callout tone="attention" title={pauseReasonLabel(task.pauseReason??'human',locale)}>{task.pauseReason==='infra_failed'&&workerError&&<p className="rsi-mono">{workerError}</p>}<div className="rsi-inline"><Button onClick={()=>onAction('set_budget')}>{copy(locale,'调整预算','Adjust budget')}</Button><Button onClick={()=>onAction('resume')}>{copy(locale,'继续','Resume')}</Button></div></Callout>;
  if(task.state==='calibrating')return <Callout title={copy(locale,'正在标定基线','Calibrating baseline')}><Numeric value={metrics?.baselineProgress?.completed} locale={locale}/> / <Numeric value={metrics?.baselineProgress?.planned} locale={locale}/></Callout>;
  if(!workerRunning&&!!metrics?.pendingCommands)return <Callout tone="attention" title={copy(locale,'队列中有待执行操作，请启动执行器','Queued actions are waiting; start the executor')}/>;
  return null;
}
export function TaskMetrics({task,metrics,best,locale}:{task:RsiTaskView;metrics:RsiMetrics|null;best:number|null;locale:Locale}) {return <MetricStrip items={[
  {label:copy(locale,'状态','Status'),value:<Status value={task.state} locale={locale}/>},{label:copy(locale,'基线通过数','Baseline passes'),value:<Numeric value={task.baselineTrainScore} locale={locale}/>},{label:copy(locale,'最优通过数','Best passes'),value:<Numeric value={best} locale={locale}/>},
  {label:copy(locale,'噪声带 δ','Noise band δ'),value:<Numeric value={task.delta} locale={locale}/>},{label:copy(locale,'迭代数','Iterations'),value:<Numeric value={task.iterationCount} locale={locale}/>},
  {label:copy(locale,'封存集余量','Sealed remaining'),value:<div className="rsi-meter-value"><span>{Math.max(0,task.config.sealedQueryBudget-task.sealedQueriesUsed)}/{task.config.sealedQueryBudget}</span><Meter label={copy(locale,'封存集余量','Sealed remaining')} value={Math.max(0,task.config.sealedQueryBudget-task.sealedQueriesUsed)} max={task.config.sealedQueryBudget}/></div>},
  {label:'Token',value:<div className="rsi-meter-value"><span><Numeric value={task.tokenUsage} kind="tokens"/> / <Numeric value={task.config.maxTaskTokens} kind="tokens"/></span><Meter label="Token" value={task.tokenUsage} max={task.config.maxTaskTokens} tone={task.tokenUsage>=task.config.maxTaskTokens?'attention':'accent'}/></div>},
  {label:copy(locale,'缓存命中率','Cache hit rate'),value:<div className="rsi-meter-value"><Numeric value={metrics?.cacheHitRate} kind="percent"/>{metrics?.cacheHitRate!=null&&<Meter label={copy(locale,'缓存命中率','Cache hit rate')} value={metrics.cacheHitRate} max={1}/>}</div>},
]}/>;}
function depth(i:RsiIteration,items:RsiIteration[]):number {let d=0,parent=i.parentId;const visited=new Set<string>();while(parent&&!visited.has(parent)){visited.add(parent);const p=items.find(v=>v.id===parent);if(!p)break;d++;parent=p.parentId;}return d;}
export function IterationTable({items,task,metrics,locale,onOpen,lineage=items}:{items:RsiIteration[];task:RsiTaskView;metrics:RsiMetrics|null;locale:Locale;onOpen:(i:RsiIteration)=>void;lineage?:RsiIteration[]}) {return <Table locale={locale} label={copy(locale,'迭代树','Iteration tree')} rows={[...items].sort((a,b)=>a.seq-b.seq)} rowKey={i=>i.id} onRowClick={onOpen} stickyFirst rowTone={i=>i.state==='held'?'attention':i.state==='rejected'?'danger':undefined} columns={[
  {key:'seq',label:'#',render:i=><span className="rsi-tree-node" style={{paddingInlineStart:`calc(var(--space-4) * ${depth(i,lineage)})`}}><span className="rsi-tree-branch" aria-hidden="true">{i.parentId?'↳':'·'}</span><strong className="num">#{i.seq}</strong>{i.parentId&&<small> ← #{lineage.find(p=>p.id===i.parentId)?.seq??'—'}</small>}</span>},
  {key:'hypothesis',label:copy(locale,'假设','Hypothesis'),render:i=><Tooltip label={i.prd.hypothesis}><span className="rsi-truncate" tabIndex={0}>{i.prd.hypothesis}</span></Tooltip>},
  {key:'state',label:copy(locale,'状态','Status'),render:i=><Status value={i.state} locale={locale}/>},
  {key:'train',label:copy(locale,'训练','Train'),align:'right',render:i=>{const parent=lineage.find(p=>p.id===i.parentId)?.trainScore??task.baselineTrainScore;return <span className="rsi-inline"><Numeric value={i.trainScore} locale={locale}/>{i.trainScore!==null&&parent!==null&&<Badge tone={i.trainScore>parent?'success':i.trainScore<parent?'danger':'neutral'}>{i.trainScore-parent>0?'+':''}<Numeric value={i.trainScore-parent} locale={locale}/></Badge>}</span>;}},
  {key:'sealed',label:copy(locale,'封存','Sealed'),render:i=>{const d=metrics?.iterations.find(m=>m.iterationId===i.id)?.defenses.find(d=>d.level==='L2');return d&&['pass','reject'].includes(d.state)?<Badge tone={d.state==='pass'?'success':'danger'}>{reasonLabel(d.state==='pass'?'accept':'reject',locale)}</Badge>:'—';}},
  {key:'defenses',label:copy(locale,'防线','Defenses'),render:i=><div className="rsi-defense-dots">{['L0','L1','L2','L3','L4','L5'].map(level=>{const defense=metrics?.iterations.find(m=>m.iterationId===i.id)?.defenses.find(d=>d.level===level);return <Tooltip key={level} label={`${level} · ${reasonLabel(defense?.reason??'evidence_missing',locale)}`}><span className={`rsi-defense-dot is-${defense?.state??'missing'}`} tabIndex={0}>{level}</span></Tooltip>;})}</div>},
  {key:'tokens',label:'Token',align:'right',render:i=>{const m=metrics?.iterations.find(m=>m.iterationId===i.id),values=[m?.targetTokens,m?.optimizerTokens,m?.reviewTokens];return <Numeric value={values.every(v=>v!=null)?values.reduce<number>((n,v)=>n+v!,0):null} kind="tokens"/>;}},
  {key:'duration',label:copy(locale,'耗时','Duration'),align:'right',render:i=><Numeric value={metrics?.iterations.find(m=>m.iterationId===i.id)?.durationMs} kind="duration" locale={locale}/>},
  {key:'time',label:copy(locale,'时间','Time'),render:i=><Time at={i.updatedAt} locale={locale}/>},
]} emptyState={<EmptyState icon={<IconList/>} title={copy(locale,'还没有迭代','No iterations yet')}/>}/>;}
export function Instructions({task,locale,revision,onSuccess,cursor,onCursor}:{task:RsiTaskView;locale:Locale;revision:number;onSuccess:()=>void;cursor:string|null;onCursor:(cursor:string|null)=>void}) {
  const read=useRsiRead(`${task.id}:instructions:${cursor}`,signal=>rsiApi.instructions(task.id,cursor,signal),revision);
  const [kind,setKind]=useState<'prohibition'|'idea'>('idea'),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),lock=useRef(false),request=useRef<string|null>(null);
  async function submit(){if(lock.current||!text.trim())return;lock.current=true;setBusy(true);setError(null);try{await rsiApi.command(task.id,null,{action:'instruction',kind,text:text.trim(),effectiveFromSeq:task.iterationCount+1},request.current??=crypto.randomUUID());setText('');request.current=null;read.retry();onSuccess();}catch(error){setError(error);}finally{lock.current=false;setBusy(false);}}
  return <div className="rsi-stack"><Card><CardHeader title={copy(locale,'添加指令','Add instruction')} description={copy(locale,'下一轮优化者开始时读取','Read when the optimizer starts the next round')}/><CardBody><div className="rsi-form"><SegmentedControl activeId={kind} onChange={v=>{request.current=null;setKind(v as typeof kind);}} items={[{id:'prohibition',label:copy(locale,'禁令','Prohibition')},{id:'idea',label:copy(locale,'思路','Idea')}]}/><Field label={copy(locale,'指令内容','Instruction')} hint={kind==='prohibition'?copy(locale,'能写成确定性规则的禁令，也请加入 Agent 档案','Add prohibitions that can be deterministic rules to the Agent profile as well'):undefined}><textarea className="rsi-textarea" rows={3} value={text} disabled={busy} onChange={e=>{request.current=null;setText(e.target.value);}}/></Field><Button variant="primary" loading={busy} disabled={!text.trim()} onClick={()=>void submit()}>{copy(locale,'添加','Add')}</Button>{Boolean(error)&&<WriteError error={error} locale={locale}/>}</div></CardBody></Card>
    {read.loading&&!read.value&&<PageSkeleton compact/>}{Boolean(read.error)&&<ReadError error={read.error} locale={locale} retry={read.retry}/>}
    {(['prohibition','idea'] as const).map(group=><Card key={group}><CardHeader title={reasonLabel(group,locale)}/><CardBody>{read.value?.items.filter(i=>i.kind===group).map(i=><InstructionRow key={i.id} value={i} locale={locale}/>)}{read.value&&!read.value.items.some(i=>i.kind===group)&&<EmptyState icon={<IconMessage/>} title={copy(locale,'暂无指令','No instructions')}/>}</CardBody></Card>)}
    <div className="rsi-inline"><Button disabled={!cursor} onClick={()=>onCursor(null)}>{copy(locale,'首页','First page')}</Button>{read.value?.nextCursor&&<Button onClick={()=>onCursor(read.value!.nextCursor)}>{copy(locale,'下一页','Next page')}</Button>}</div>
  </div>;
}
function InstructionRow({value,locale}:{value:RsiInstruction;locale:Locale}) {return <div className="rsi-instruction"><p>{value.text}</p><small>{copy(locale,'生效轮次','Effective iteration')} #{value.effectiveFromSeq} · <Time at={value.at} locale={locale}/></small></div>;}
export function Decisions({taskId,locale,revision,iterations,cursor,onCursor,verifyRevision=0}:{taskId:string;locale:Locale;revision:number;iterations:RsiIteration[];cursor:string|null;onCursor:(cursor:string|null)=>void;verifyRevision?:number}) {
  const read=useRsiRead(`${taskId}:decisions:${cursor}`,signal=>rsiApi.decisions(taskId,cursor,signal),revision),[verify,setVerify]=useState(0);
  useEffect(()=>{if(verifyRevision>0)setVerify(n=>n+1);},[verifyRevision]);
  const report=useRsiRead(verify?`${taskId}:verify:${verify}`:null,signal=>rsiApi.verify(taskId,signal));
  return <Card><CardHeader title={copy(locale,'决定记录','Decision log')} actions={<Button loading={report.loading} onClick={()=>setVerify(v=>v+1)}>{copy(locale,'校验账本','Verify ledger')}</Button>}/><CardBody>
    {Boolean(report.error)&&<ReadError error={report.error} locale={locale} retry={report.retry}/>}{report.value&&<div className="rsi-ledger-result"><Badge tone={report.value.valid&&report.value.anchored?'success':'attention'}>{copy(locale,report.value.valid&&report.value.anchored?'完整':'异常或缺少锚点',report.value.valid&&report.value.anchored?'Intact':'Issues or missing anchor')}</Badge><Numeric value={report.value.entryCount} locale={locale}/>{report.value.issues.map((i,n)=><div key={n}><Reason code={i.code} locale={locale}/> · {copy(locale,'行','Line')} <Numeric value={i.line} locale={locale}/></div>)}</div>}
    {read.loading&&!read.value&&<PageSkeleton compact/>}{Boolean(read.error)&&<ReadError error={read.error} locale={locale} retry={read.retry}/>}
    {read.value&&!read.value.items.length&&<EmptyState icon={<IconList/>} title={copy(locale,'暂无决定记录','No decisions yet')}/>}
    <ol className="rsi-timeline">{read.value?.items.map(d=><li key={d.id}><div className="rsi-inline"><Time at={d.at} locale={locale}/><Badge>{reasonLabel(d.actor,locale)}</Badge><Status value={d.verdict} locale={locale}/></div><p>{d.actor==='human'?d.reason:d.reason.split(',').map((code,n)=><span key={n}>{n?' · ':''}<Reason code={code} locale={locale}/></span>)}</p><small>{copy(locale,'迭代','Iteration')} · <span className="num">#{iterations.find(i=>i.id===d.iterationId)?.seq??'—'}</span></small></li>)}</ol>
    <div className="rsi-inline"><Button disabled={!cursor} onClick={()=>onCursor(null)}>{copy(locale,'首页','First page')}</Button>{read.value?.nextCursor&&<Button onClick={()=>onCursor(read.value!.nextCursor)}>{copy(locale,'下一页','Next page')}</Button>}</div>
  </CardBody></Card>;
}
export function TaskDetail({task,iterations,metrics,locale,route,onRoute,onSuccess,revision,onOpen,verifyRevision=0}:{task:RsiTaskView;iterations:RsiIteration[];metrics:RsiMetrics|null;locale:Locale;route:RsiRoute;onRoute:(r:Partial<RsiRoute>)=>void;onSuccess:()=>void;revision:number;onOpen:(i:RsiIteration)=>void;verifyRevision?:number}) {
  const sorted=[...iterations].sort((a,b)=>a.seq-b.seq),start=route.cursor?Math.max(0,sorted.findIndex(i=>i.id===route.cursor)+1):0,page=sorted.slice(start,start+100);
  const tab=['trend','iterations','instructions','decisions'].includes(route.tab)?route.tab:'trend';
  return <><Tabs activeId={tab} onChange={tab=>onRoute({tab,cursor:null})} items={[['trend','趋势','Trend'],['iterations','迭代','Iterations'],['instructions','指令','Instructions'],['decisions','决定记录','Decisions']].map(([id,zh,en])=>({id:id!,label:copy(locale,zh!,en!)}))}/>
    {tab==='trend'&&<Trends task={task} iterations={iterations} metrics={metrics} locale={locale} onOpen={onOpen}/>}
    {tab==='iterations'&&<Card><CardHeader title={copy(locale,'迭代树','Iteration tree')}/><IterationTable items={page} lineage={iterations} task={task} metrics={metrics} locale={locale} onOpen={onOpen}/><div className="rsi-inline rsi-pagination"><Button disabled={!route.cursor} onClick={()=>onRoute({cursor:null})}>{copy(locale,'首页','First page')}</Button>{start+100<sorted.length&&<Button onClick={()=>onRoute({cursor:page.at(-1)!.id})}>{copy(locale,'下一页','Next page')}</Button>}</div></Card>}
    {tab==='instructions'&&<Instructions cursor={route.cursor} onCursor={cursor=>onRoute({cursor})} task={task} locale={locale} revision={revision} onSuccess={onSuccess}/>}{tab==='decisions'&&<Decisions verifyRevision={verifyRevision} cursor={route.cursor} onCursor={cursor=>onRoute({cursor})} taskId={task.id} locale={locale} revision={revision} iterations={iterations}/>}
  </>;
}
