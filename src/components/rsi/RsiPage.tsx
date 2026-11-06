import { Sheet } from '../ui/Modal.js';
import { CopyField, KeyValue, Callout } from '../ui/Display.js';
import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { rsiApi } from '../../core/rsi-api-client.js';
import type { RsiOverview, RsiSummary, RsiTaskView } from '../../core/rsi-api-client.js';
import type { RsiIteration } from '../../core/rsi-types.js';
import { PageHeader } from '../PageHeader.js';
import { Tabs } from '../ui/Tabs.js';
import { Table } from '../ui/Table.js';
import { Button, IconButton } from '../ui/Button.js';
import { SearchInput } from '../ui/Input.js';
import { SegmentedControl } from '../ui/Controls.js';
import { Badge } from '../ui/Badge.js';
import { Card, Meter } from '../ui/Display.js';
import { Tooltip, DropdownMenu } from '../ui/Overlay.js';
import { EmptyState, Toast } from '../ui/States.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { Sparkline } from '../charts/index.js';
import { IconPlus, IconSparkles, IconMoreHorizontal, IconCopy } from '../icons/index.js';
import { copy, reasonLabel, pauseReasonLabel } from './copy.js';
import { parseRsiRoute, serializeRsiRoute, type RsiRoute } from './route.js';
import { Numeric, Time, Status, Reason, WorkerPill, ReadError, EmptyIcon } from './Shared.js';
import { ActionDialog, actionLabel, type HumanAction } from './Actions.js';
import { CreateTask } from './CreateTask.js';
import { TaskDetail, TaskMetrics, TaskAttention, Decisions } from './TaskDetail.js';
import { IterationDetail } from './IterationDetail.js';
import { Calibration } from './Calibration.js';
import { useRsiCli, useRsiRead } from './data.js';
import '../../styles/components/rsi.css';
export interface RsiChanges { version:number; taskIds:string[] }
interface Props {locale:Locale;onMenu?:()=>void;onSearch?:()=>void;overview:RsiOverview|null;overviewError:unknown;onRefresh:()=>void;changes:RsiChanges}
export function RsiPage({locale,onMenu,onSearch,overview,overviewError,onRefresh,changes}:Props) {
  const cli=useRsiCli();
  const [route,setRoute]=useState(()=>parseRsiRoute(window.location.hash)),[toast,setToast]=useState<string|null>(null),[action,setAction]=useState<{action:HumanAction;task:RsiTaskView;iteration:RsiIteration|null;parentId?:string|null}|null>(null);
  useEffect(()=>{const changed=()=>setRoute(parseRsiRoute(window.location.hash));window.addEventListener('hashchange',changed);return ()=>window.removeEventListener('hashchange',changed);},[]);
  const navigate=(patch:Partial<RsiRoute>)=>{const context=patch.task!==undefined&&patch.task!==route.task||patch.iter!==undefined&&patch.iter!==route.iter||patch.view!==undefined&&patch.view!==route.view;const next={...route,...(context?{file:null,run:null,tab:'',cursor:null,phase:'all' as const,trajectory:'runs' as const,traceFile:'responses' as const}:{}),...patch};const hash=serializeRsiRoute(next);setRoute(next);if(window.location.hash!==hash)window.location.hash=hash;};
  const success=()=>{setAction(null);setToast(copy(locale,'已加入队列','Added to queue')+(overview?.tasks.some(t=>t.task.id===(action?.task.id??route.task)&&!t.worker.running)?copy(locale,'；请启动执行器','; start the executor'):''));onRefresh();};
  const summaries=overview?.tasks??[],summary=summaries.find(s=>s.task.id===route.task),worker=summary?.worker??summaries.find(s=>s.worker.running)?.worker??null;
  const open=(task:RsiTaskView,iteration:RsiIteration|null,action:HumanAction,parentId?:string|null)=>setAction({task,iteration,action,parentId});
  const global=route.view!=='tasks'||!route.task;
  return <article className={`rsi-page num${global?'':' rsi-detail-page'}`}>
    {global?<><PageHeader title={copy(locale,'自优化','Self-improvement')} titleBadge={overview?<Badge>{summaries.length}</Badge>:undefined} locale={locale} onMenu={onMenu} onSearch={onSearch} actions={<><WorkerPill status={worker} taskId={route.task??summaries.find(s=>s.worker.running)?.task.id??summaries[0]?.task.id??null} locale={locale}/><Button variant="primary" icon={<IconPlus/>} onClick={()=>navigate({create:true})}>{copy(locale,'新建任务','New task')}</Button></>}/>
      <div className="rsi-content"><div className="rsi-tabs"><Tabs activeId={route.view} onChange={view=>navigate({view:view as RsiRoute['view'],iter:null,task:view==='calibration'?route.task:null,tab:'',cursor:null})} items={[{id:'tasks',label:copy(locale,'任务','Tasks')},{id:'review',label:<span className="rsi-inline">{copy(locale,'待审','Review')}<Badge tone={overview?.pendingCount?'attention':'neutral'}>{overview?.pendingCount??'—'}</Badge></span>},{id:'calibration',label:copy(locale,'监控校准','Calibration')}]}/></div>
        {!overview&&!overviewError&&<PageSkeleton/>}{Boolean(overviewError)&&<ReadError error={overviewError} locale={locale} retry={onRefresh}/>}
        {overview&&route.view==='tasks'&&<TaskList summaries={summaries} locale={locale} route={route} onRoute={navigate} onAction={(task,action)=>open(task,null,action)} onCreate={()=>navigate({create:true})} onCopy={()=>setToast(copy(locale,'已复制','Copied'))}/>}
        {overview&&route.view==='review'&&<ReviewQueue overview={overview} locale={locale} route={route} onRoute={navigate}/>}
        {overview&&route.view==='calibration'&&<Calibration tasks={summaries} taskId={route.task} locale={locale} onTask={task=>navigate({task})} revision={changes.version}/>}
      </div></>:<TaskWorkspace taskId={route.task!} summary={summary??null} locale={locale} route={route} onRoute={navigate} changes={changes} onMenu={onMenu} onSearch={onSearch} onAction={open} onSuccess={success}/>}
    {route.guide&&<Sheet open className="rsi-sheet" title={copy(locale,'接入自己的 Agent','Connect your Agent')} onClose={()=>navigate({guide:false})}><div className="rsi-stack"><Callout title={copy(locale,'从一个可信档案开始','Start with a trusted profile')}/><KeyValue items={[{label:copy(locale,'准备档案','Prepare a profile'),value:copy(locale,'参考 rsi-agents/mini-agent，编写自己的档案和容器构建文件。','Use rsi-agents/mini-agent as a reference for your profile and container build file.')},{label:copy(locale,'检查环境','Check the environment'),value:copy(locale,'先校验档案并检查本机容器环境，再创建任务。','Validate the profile and check the local container environment before creating a task.')},{label:copy(locale,'设置模型','Configure the model'),value:copy(locale,'上游模型配置只交给手动启动的执行器；密钥不填入档案。','Supply upstream model settings only to the manually started executor; keep keys out of profiles.')} ]}/><CopyField locale={locale} label={copy(locale,'校验档案','Validate profile')} value={`${cli.bin} agent validate /path/to/profile.json`}/><CopyField locale={locale} label={copy(locale,'检查环境','Check environment')} value={`${cli.bin} doctor`}/><Button variant="primary" onClick={()=>navigate({guide:false,create:true})}>{copy(locale,'新建任务','New task')}</Button></div></Sheet>}
    {route.create&&<CreateTask locale={locale} worker={worker} onClose={()=>navigate({create:false})} onCreated={onRefresh} onOpen={task=>navigate({task,create:false,view:'tasks',iter:null,tab:''})}/>}
    {action&&<ActionDialog key={`${action.task.id}:${action.iteration?.id}:${action.action}`} {...action} locale={locale} onClose={()=>setAction(null)} onSuccess={success}/>}
    {toast&&<Toast title={toast} onDismiss={()=>setToast(null)}/>}
  </article>;
}
function RowMenu({summary,locale,onAction,onCopy}:{summary:RsiSummary;locale:Locale;onAction:(action:HumanAction)=>void;onCopy:()=>void}) {
  const [open,setOpen]=useState(false),[copyError,setCopyError]=useState(false),state=summary.task.state;
  return <><DropdownMenu open={open} onOpenChange={setOpen} trigger={props=><IconButton {...props} label={copy(locale,'任务操作','Task actions')} icon={<IconMoreHorizontal/>}/>} items={[
    ...(['running','calibrating'].includes(state)?[{id:'pause',label:actionLabel('pause',locale),onSelect:()=>onAction('pause')}]:['paused','needs_help'].includes(state)?[{id:'resume',label:actionLabel('resume',locale),onSelect:()=>onAction('resume')}]:[]),
    {id:'stop',label:actionLabel('stop',locale),disabled:['completed','stopped'].includes(state),danger:true,onSelect:()=>onAction('stop')},
    {id:'copy',label:copy(locale,'复制链接','Copy link'),icon:<IconCopy/>,onSelect:()=>{void navigator.clipboard.writeText(window.location.href.split('#')[0]+serializeRsiRoute({task:summary.task.id})).then(onCopy).catch(()=>setCopyError(true));}},
  ]}/>{copyError&&<Toast tone="error" title={copy(locale,'复制失败','Copy failed')} onDismiss={()=>setCopyError(false)}/>}</>;
}
function TaskList({summaries,locale,route,onRoute,onAction,onCreate,onCopy}:{summaries:RsiSummary[];locale:Locale;route:RsiRoute;onRoute:(r:Partial<RsiRoute>)=>void;onAction:(task:RsiTaskView,action:HumanAction)=>void;onCreate:()=>void;onCopy:()=>void}) {
  const q=route.q.toLowerCase(),rows=summaries.filter(s=>`${s.agentName} ${s.optimizerName} ${s.repositoryName}`.toLowerCase().includes(q));
  return <><div className="rsi-toolbar"><SearchInput aria-label={copy(locale,'搜索调优任务','Search tuning tasks')} placeholder={copy(locale,'搜索任务…','Search tasks…')} value={route.q} onChange={e=>onRoute({q:e.target.value})}/></div><Card><Table className="rsi-task-table" locale={locale} label={copy(locale,'调优任务','Tuning tasks')} rows={rows} rowKey={s=>s.task.id} stickyFirst onRowClick={s=>onRoute({task:s.task.id,iter:null,tab:'',cursor:null})} rowTone={s=>s.task.state==='needs_help'?'danger':s.pendingCount?'attention':undefined} rowActions={s=><RowMenu summary={s} locale={locale} onAction={action=>onAction(s.task,action)} onCopy={onCopy}/>} columns={[
    {key:'task',label:copy(locale,'任务','Task'),render:s=><div className="rsi-task-name"><Tooltip label={`${s.agentName??'—'} · ${s.repositoryName}`}><strong tabIndex={0}>{s.agentName??'—'} · {s.repositoryName}</strong></Tooltip><small>{s.agentName??'—'} · {s.optimizerName??'—'}</small></div>},
    {key:'state',label:copy(locale,'状态','Status'),render:s=><Tooltip label={s.task.pauseReason?pauseReasonLabel(s.task.pauseReason,locale):reasonLabel(s.task.state,locale)}><span tabIndex={0}><Status value={s.task.state} locale={locale}/></span></Tooltip>},
    {key:'iterations',label:copy(locale,'迭代','Iteration'),align:'right',render:s=>`#${s.task.iterationCount}`},{key:'pending',label:copy(locale,'待审','Review'),align:'right',render:s=><Badge tone={s.pendingCount?'attention':'neutral'}><Numeric value={s.pendingCount} locale={locale}/></Badge>},
    {key:'passes',label:copy(locale,'通过数','Passes'),render:s=><div className="rsi-score-cell"><span className="rsi-mobile-label">{copy(locale,'通过数','Passes')}</span><span><Numeric value={s.task.baselineTrainScore} locale={locale}/> → <Numeric value={s.bestTrainScore} locale={locale}/> / <Numeric value={s.trainCount} locale={locale}/></span><Sparkline series={[{label:copy(locale,'训练分数','Training score'),color:'var(--chart-1)',points:s.trainScores.filter(p=>p.score!==null).map(p=>({value:p.score!}))}]} height={32} width={64}/></div>},
    {key:'sealed',label:copy(locale,'封存集余量','Sealed remaining'),render:s=><div className="rsi-meter-cell"><span>{s.sealedRemaining}/{s.task.config.sealedQueryBudget}</span><Meter label={copy(locale,'封存集余量','Sealed remaining')} value={s.sealedRemaining} max={s.task.config.sealedQueryBudget}/></div>},
    {key:'tokens',label:'Token',align:'right',render:s=><div className="rsi-meter-cell"><span className="rsi-mobile-label">Token</span><span><Numeric value={s.tokenUsage} kind="tokens"/> / <Numeric value={s.tokenBudget} kind="tokens"/></span><Meter label="Token" value={s.tokenUsage} max={s.tokenBudget}/></div>},{key:'activity',label:copy(locale,'最近活动','Activity'),render:s=><Time at={s.lastActivity} locale={locale}/>},
  ]} emptyState={<EmptyState icon={<EmptyIcon/>} title={copy(locale,route.q?'没有匹配的调优任务':'还没有调优任务',route.q?'No matching tuning tasks':'No tuning tasks yet')} description={copy(locale,'让优化者自动改进你的 Agent，每一轮都经过评测和防作弊检查','Let an optimizer improve your Agent, with evaluation and anti-cheating checks every round')} action={<div className="rsi-empty-actions"><Button variant="primary" onClick={onCreate}>{copy(locale,'新建任务','New task')}</Button><a href="#/rsi?guide=1" className="rsi-link">{copy(locale,'接入自己的 Agent','Connect your Agent')}</a></div>}/>}/></Card></>;
}
function ReviewQueue({overview,locale,route,onRoute}:{overview:RsiOverview;locale:Locale;route:RsiRoute;onRoute:(r:Partial<RsiRoute>)=>void}) {return <><div className="rsi-toolbar"><SegmentedControl activeId={route.filter} onChange={filter=>onRoute({filter:filter as RsiRoute['filter']})} items={[{id:'all',label:copy(locale,'全部','All')},{id:'held',label:copy(locale,'挂起','Held')},{id:'audit',label:copy(locale,'抽检','Audit')}]}/></div><Card><Table className="rsi-review-table" locale={locale} label={copy(locale,'待审队列','Review queue')} rows={overview.reviews.filter(r=>route.filter==='all'||route.filter===r.kind)} rowKey={r=>r.id} stickyFirst onRowClick={r=>onRoute({view:'tasks',task:r.taskId,iter:r.iteration.seq,tab:'',cursor:null})} columns={[
  {key:'task',label:copy(locale,'任务','Task'),render:r=>r.taskName},{key:'iteration',label:copy(locale,'迭代','Iteration'),render:r=>'#'+r.iteration.seq},{key:'kind',label:copy(locale,'类型','Type'),render:r=><Badge tone={r.kind==='held'?'attention':'accent'}><Reason code={r.kind} locale={locale}/></Badge>},{key:'reason',label:copy(locale,'原因','Reason'),render:r=>r.kind==='audit'?'—':<span className="rsi-inline">{r.reasons.map(code=><Badge key={code}><Reason code={code} locale={locale}/></Badge>)}</span>},{key:'wait',label:copy(locale,'等待时间','Waiting since'),render:r=><Time at={r.at} locale={locale}/>},{key:'hypothesis',label:copy(locale,'假设','Hypothesis'),render:r=>r.iteration.prd.hypothesis},
]} emptyState={<EmptyState icon={<IconSparkles/>} title={copy(locale,'没有待处理的审查','No pending reviews')} description={copy(locale,'系统通过的迭代中会随机抽一部分让你检查','Some promoted iterations are randomly selected for your review')}/>}/></Card></>;}
function TaskWorkspace({taskId,summary,locale,route,onRoute,changes,onMenu,onSearch,onAction,onSuccess}:{taskId:string;summary:RsiSummary|null;locale:Locale;route:RsiRoute;onRoute:(r:Partial<RsiRoute>)=>void;changes:RsiChanges;onMenu?:()=>void;onSearch?:()=>void;onAction:(task:RsiTaskView,iteration:RsiIteration|null,action:HumanAction,parentId?:string|null)=>void;onSuccess:()=>void}) {
  const [revision,setRevision]=useState(changes.version),[menu,setMenu]=useState(false),[verifyRevision,setVerifyRevision]=useState(0);
  useEffect(()=>{if(!changes.taskIds.length||changes.taskIds.includes(taskId))setRevision(changes.version);},[changes,taskId]);
  const taskRead=useRsiRead(taskId,signal=>rsiApi.task(taskId,signal),revision),metrics=useRsiRead(taskId+':metrics',signal=>rsiApi.metrics(taskId,signal),revision);
  const iteration=useRsiRead(route.iter?taskId+':iteration:'+route.iter:null,signal=>rsiApi.iteration(taskId,route.iter!,signal),revision);
  const task=taskRead.value?.task,i=iteration.value?.iteration??null,name=summary?`${summary.agentName??'—'} · ${summary.repositoryName}`:taskId;
  const metric=metrics.value?.iterations.find(m=>m.iterationId===i?.id)??null;
  const action=(a:HumanAction,parentId?:string|null)=>{if(task)onAction(task,i,a,parentId);};
  const controls:{id:string;label:string;variant?:'primary'|'danger';onSelect:()=>void}[]=i?.state==='held'?[
    {id:'approve',label:copy(locale,'批准','Approve'),variant:'primary',onSelect:()=>action('approve')},
    {id:'reject',label:copy(locale,'拒绝','Reject'),variant:'danger',onSelect:()=>action('reject')},
    ...(i.holdReasons.some(r=>r==='missing_monitor'||r==='missing_adversarial')?[{id:'retry_review',label:copy(locale,'重新审查','Retry review'),onSelect:()=>action('retry_review')}]:[]),
    ...(i.holdReasons.includes('incomplete_comparison')?[{id:'retry_evaluation',label:copy(locale,'重新评测','Retry evaluation'),onSelect:()=>action('retry_evaluation')}]:[]),
  ]:i?.state==='promoted'?[
    ...(metric?.finalState==='not_requested'?[{id:'final',label:copy(locale,'最终验收','Final acceptance'),onSelect:()=>action('final')}]:[]),
    ...(metric?.finalState==='completed'?[{id:'adopt',label:copy(locale,'采纳','Adopt'),variant:'primary' as const,onSelect:()=>action('adopt')}]:[]),
    {id:'rollback',label:copy(locale,'回退到此版本','Roll back here'),onSelect:()=>action('rollback',i.id)},
  ]:i?.state==='rejected'?[{id:'rollback',label:copy(locale,'回退到父代','Roll back to parent'),onSelect:()=>action('rollback',i.parentId)}]:[];
  return <><PageHeader title={i?`#${i.seq} · ${i.prd.hypothesis}`:name} breadcrumb={<><Button variant="link" size="sm" onClick={()=>onRoute({task:null,iter:null,tab:'',cursor:null})}>{copy(locale,'自优化','Self-improvement')}</Button><span>/</span><Button variant="link" size="sm" onClick={()=>onRoute({iter:null,tab:'',cursor:null})}>{name}</Button>{i&&<span>/ #{i.seq}</span>}</>} locale={locale} onMenu={onMenu} onSearch={onSearch} actions={<><WorkerPill status={summary?.worker??null} taskId={taskId} locale={locale}/><span className="rsi-header-actions">{controls.map((control,index)=><Button key={control.id} className={index>=(i?.state==='held'?2:1)?'rsi-extra-action':undefined} variant={control.variant} onClick={control.onSelect}>{control.label}</Button>)}{!route.iter&&<Button onClick={()=>onRoute({tab:'instructions'})}>{copy(locale,'添加指令','Add instruction')}</Button>}</span><DropdownMenu open={menu} onOpenChange={setMenu} trigger={props=><IconButton {...props} label={copy(locale,'任务操作','Task actions')} icon={<IconMoreHorizontal/>}/>} items={[
    ...controls.filter(control=>control.id!=='rollback'),
    ...(!route.iter?[{id:'instruction',label:copy(locale,'添加指令','Add instruction'),onSelect:()=>onRoute({tab:'instructions'})}]:[]),
    ...(task&&['running','calibrating'].includes(task.state)?[{id:'pause',label:actionLabel('pause',locale),onSelect:()=>action('pause')}]:task&&['paused','needs_help'].includes(task.state)?[{id:'resume',label:actionLabel('resume',locale),onSelect:()=>action('resume')}]:[]),
    {id:'budget',label:actionLabel('set_budget',locale),onSelect:()=>action('set_budget')},
    ...(i?.state==='promoted'?[{id:'rollback',label:copy(locale,'回退到此版本','Roll back to this version'),onSelect:()=>action('rollback',i.id)}]:i?.state==='rejected'?[{id:'rollback',label:copy(locale,'回退到父代','Roll back to parent'),onSelect:()=>action('rollback',i.parentId)}]:[{id:'rollback',label:copy(locale,'回退到基线','Roll back to baseline'),onSelect:()=>action('rollback',null)}]),
    {id:'verify',label:copy(locale,'校验账本','Verify ledger'),onSelect:()=>{setVerifyRevision(n=>n+1);onRoute({iter:null,tab:'decisions'});}},{id:'stop',label:actionLabel('stop',locale),danger:true,disabled:task&&['stopped','completed'].includes(task.state),onSelect:()=>action('stop')},
  ]}/></>}/><div className="rsi-content">
    {taskRead.loading&&!task&&<PageSkeleton/>}{Boolean(taskRead.error)&&<ReadError error={taskRead.error} locale={locale} retry={taskRead.retry}/>}
    {!task&&route.tab==='decisions'&&<Decisions taskId={taskId} locale={locale} revision={revision} verifyRevision={verifyRevision} iterations={[]} cursor={route.cursor} onCursor={cursor=>onRoute({cursor})}/>}
    {task&&<>{!route.iter&&<TaskAttention task={task} metrics={metrics.value} workerRunning={summary?.worker.running??false} workerError={summary?.worker.lastError??null} locale={locale} onAction={action}/>} {Boolean(metrics.error)&&<ReadError error={metrics.error} locale={locale} retry={metrics.retry}/>}
      {!route.iter&&<><TaskMetrics task={task} metrics={metrics.value} best={summary?.bestTrainScore??null} locale={locale}/>      <TaskDetail verifyRevision={verifyRevision} task={task} iterations={metrics.value?.iterations.map(m=>m.iteration)??[]} metrics={metrics.value} locale={locale} route={route} onRoute={onRoute} onSuccess={onSuccess} revision={revision} onOpen={i=>onRoute({iter:i.seq,tab:'',cursor:null})}/>
      </>}
      {route.iter&&<>{iteration.loading&&!i&&<PageSkeleton/>}{Boolean(iteration.error)&&<ReadError error={iteration.error} locale={locale} retry={iteration.retry}/>} {i&&<IterationDetail key={i.id} taskId={taskId} iteration={i} parentSeq={metrics.value?.iterations.find(m=>m.iterationId===i.parentId)?.seq??null} metric={metric} locale={locale} route={route} onRoute={onRoute} revision={revision}/>}</>}
    </>}
  </div></>;
}
