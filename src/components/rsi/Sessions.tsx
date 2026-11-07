import { useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { RsiMetrics, RsiSessionMetric } from '../../core/rsi-api-client.js';
import { rsiApi } from '../../core/rsi-api-client.js';
import { formatDuration } from '../../core/format.js';
import { Card, CardHeader, KeyValue, Callout } from '../ui/Display.js';
import { Table } from '../ui/Table.js';
import { Sheet } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/States.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { IconList } from '../icons/index.js';
import { useRsiRead } from './data.js';
import { Numeric, Reason, ReadError, Status, Time } from './Shared.js';
import { Trajectory } from './Trajectory.js';
import { copy } from './copy.js';

const duration=(s:RsiSessionMetric,locale:Locale)=>s.endedAt?formatDuration(Date.parse(s.endedAt)-Date.parse(s.startedAt),locale):'—';
function Ending({session,locale}:{session:RsiSessionMetric;locale:Locale}) {
  // Rounds recorded before end reasons existed only have their state.
  return session.endReason?<Reason code={`end_${session.endReason}`} locale={locale}/>:<Status value={session.state} locale={locale}/>;
}
/** docker top pads every column; only the last one, the command, may contain spaces. */
export function parseProcesses(text:string):{pid:string;state:string;elapsed:string;cpu:string;command:string}[]|null {
  const [head,...lines]=text.trim().split('\n');
  if(head?.trim().split(/\s+/).join(' ')!=='PID PPID STAT ELAPSED TIME COMMAND')return null;
  return lines.map(line=>{const v=line.trim().split(/\s+/);return{pid:v[0]??'',state:v[2]??'',elapsed:v[3]??'',cpu:v[4]??'',command:v.slice(5).join(' ')};});
}
function Processes({text,locale}:{text:string;locale:Locale}) {
  const rows=parseProcesses(text);if(!rows)return <pre className="rsi-output">{text}</pre>;
  return <Table locale={locale} label={copy(locale,'结束前的进程','Processes before it ended')} rows={rows} rowKey={r=>r.pid} columns={[
    {key:'pid',label:'PID',render:r=><span className="num">{r.pid}</span>},{key:'state',label:copy(locale,'状态','State'),render:r=>r.state},
    {key:'elapsed',label:copy(locale,'已运行','Elapsed'),render:r=><span className="num">{r.elapsed}</span>},{key:'cpu',label:copy(locale,'CPU 时间','CPU time'),render:r=><span className="num">{r.cpu}</span>},
    {key:'command',label:copy(locale,'命令','Command'),render:r=><span className="rsi-mono">{r.command}</span>},
  ]}/>;
}
function ContainerStats({text,locale}:{text:string;locale:Locale}) {
  let stats:Record<string,unknown>|null=null;
  try {const value:unknown=JSON.parse(text);if(value&&typeof value==='object')stats=value as Record<string,unknown>;}catch {stats=null;}
  if(!stats)return <pre className="rsi-output">{text}</pre>;
  const field=(key:string)=>typeof stats?.[key]==='string'?stats[key]:'—';
  return <KeyValue items={[{label:'CPU',value:field('CPUPerc')},{label:copy(locale,'内存','Memory'),value:field('MemUsage')},{label:copy(locale,'进程数','Processes'),value:field('PIDs')},{label:copy(locale,'网络','Network'),value:field('NetIO')},{label:copy(locale,'磁盘','Disk'),value:field('BlockIO')}]}/>;
}
export function Sessions({taskId,metrics,locale,onOpenIteration}:{taskId:string;metrics:RsiMetrics|null;locale:Locale;onOpenIteration:(seq:number)=>void}) {
  const [open,setOpen]=useState<string|null>(null),rows=[...(metrics?.sessions??[])].sort((a,b)=>b.seq-a.seq),selected=rows.find(s=>s.id===open)??null;
  return <><Card><CardHeader title={copy(locale,'优化者会话','Optimizer sessions')} description={copy(locale,'每轮优化者做了什么、为什么结束。没有提交改动的轮次也在这里','What each optimizer round did and why it ended, including rounds that submitted nothing')}/>
    <Table locale={locale} label={copy(locale,'优化者会话','Optimizer sessions')} rows={rows} rowKey={s=>s.id} onRowClick={s=>setOpen(s.id)} rowTone={s=>s.iterationSeq===null&&!['running','interrupted'].includes(s.state)?'attention':undefined} columns={[
      {key:'seq',label:'#',render:s=><strong className="num">{s.seq}</strong>},
      {key:'ending',label:copy(locale,'结束方式','Ending'),render:s=><Ending session={s} locale={locale}/>},
      {key:'iteration',label:copy(locale,'产出','Result'),render:s=>s.iterationSeq===null?'—':<Button variant="link" size="sm" onClick={e=>{e.stopPropagation();onOpenIteration(s.iterationSeq!);}}>{copy(locale,'迭代','Iteration')} #{s.iterationSeq}</Button>},
      {key:'requests',label:copy(locale,'模型请求','Model requests'),align:'right',render:s=><Numeric value={s.requests} locale={locale}/>},
      {key:'tokens',label:'Token',align:'right',render:s=><Numeric value={s.tokens} kind="tokens"/>},
      {key:'duration',label:copy(locale,'耗时','Duration'),align:'right',render:s=><span className="num">{duration(s,locale)}</span>},
      {key:'time',label:copy(locale,'开始时间','Started'),render:s=><Time at={s.startedAt} locale={locale}/>},
    ]} emptyState={<EmptyState icon={<IconList/>} title={copy(locale,'还没有优化者会话','No optimizer sessions yet')}/>}/></Card>
    {selected&&<SessionSheet taskId={taskId} session={selected} locale={locale} onClose={()=>setOpen(null)}/>}</>;
}
function SessionSheet({taskId,session,locale,onClose}:{taskId:string;session:RsiSessionMetric;locale:Locale;onClose:()=>void}) {
  const read=useRsiRead(`${taskId}:session:${session.id}`,signal=>rsiApi.session(taskId,session.id,signal)),[trace,setTrace]=useState<'responses'|'last-request'|null>(null),report=read.value?.report??null;
  return <Sheet open className="rsi-sheet" title={`${copy(locale,'优化者会话','Optimizer session')} #${session.seq}`} onClose={onClose}>
    <KeyValue items={[{label:copy(locale,'结束方式','Ending'),value:<Ending session={session} locale={locale}/>},{label:copy(locale,'模型请求','Model requests'),value:<Numeric value={session.requests} locale={locale}/>},
      {label:'Token',value:<><Numeric value={session.tokens} kind="tokens"/>{session.tokenLimit!==null&&<> / <Numeric value={session.tokenLimit} kind="tokens"/></>}</>},{label:copy(locale,'耗时','Duration'),value:duration(session,locale)}]}/>
    {session.endReason==='idle'&&report&&<Callout tone="attention" title={copy(locale,`连续 ${Math.round(report.idleLimitMs/60000)} 分钟没有模型请求，CPU 也接近 0`,`No model requests for ${Math.round(report.idleLimitMs/60000)} minutes and almost no CPU`)}>{copy(locale,'平台判定优化者挂起并提前结束了这一轮。下面是结束前的进程和输出，可以用来定位原因。','The platform treated the optimizer as hung and ended the round early. The processes and output below show its last state.')}</Callout>}
    {session.endReason==='token_limit'&&<Callout tone="attention" title={copy(locale,'这一轮用完了 Token 上限','This round used its token limit')}>{copy(locale,'缓存命中的 Token 也计入上限，大仓库很容易到顶。可以在“调整预算”里调高，下一轮生效。','Cached tokens count, so large repositories reach it quickly. Raise it under Adjust budget; it applies from the next round.')}</Callout>}
    <div className="rsi-session-actions"><Button onClick={()=>setTrace('responses')}>{copy(locale,'查看模型轨迹','View model trajectory')}</Button></div>
    {read.loading&&!read.value&&<PageSkeleton compact/>}{Boolean(read.error)&&<ReadError error={read.error} locale={locale} retry={read.retry}/>}
    {report?.processes&&<section className="rsi-session-block"><h3>{copy(locale,'结束前的进程','Processes before it ended')}</h3><Processes text={report.processes} locale={locale}/></section>}
    {report?.containerStats&&<section className="rsi-session-block"><h3>{copy(locale,'结束前的容器资源','Container resources before it ended')}</h3><ContainerStats text={report.containerStats} locale={locale}/></section>}
    {read.value&&<section className="rsi-session-block"><h3>{copy(locale,'优化者输出（最后 128 KB）','Optimizer output (last 128 KB)')}</h3>{read.value.output?<pre className="rsi-output">{read.value.output}</pre>:<EmptyState icon={<IconList/>} title={copy(locale,'这一轮没有保存输出','No output was saved for this round')}/>}</section>}
    {trace&&<Trajectory taskId={taskId} entity={session.id} kind="sessions" file={trace} locale={locale} onFile={setTrace} onClose={()=>setTrace(null)}/>}
  </Sheet>;
}
