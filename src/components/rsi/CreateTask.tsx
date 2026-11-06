import { useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { rsiApi, RsiApiError } from '../../core/rsi-api-client.js';
import type { RsiCreated, RsiOptions, RsiWorkerStatus } from '../../core/rsi-api-client.js';
import { Sheet } from '../ui/Modal.js';
import { Steps, Callout, Accordion, CopyField } from '../ui/Display.js';
import { Field } from '../ui/Field.js';
import { Input } from '../ui/Input.js';
import { Select } from '../ui/Select.js';
import { Checkbox, SegmentedControl } from '../ui/Controls.js';
import { Button } from '../ui/Button.js';
import { Table } from '../ui/Table.js';
import { Badge } from '../ui/Badge.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { monitorCommand, useRsiCli, useRsiRead, workerCommand } from './data.js';
import { copy, reasonLabel, shellArgument, fieldErrorLabel } from './copy.js';
import { ReadError, WriteError } from './Shared.js';
export function OptimizerWarning({locale,id,allow,onAllow}:{locale:Locale;id:string;allow:boolean;onAllow:(allow:boolean)=>void}) {const cli=useRsiCli();return <Callout tone="attention" title={copy(locale,'需登录 · 未实测','Login required · Not verified')}><p>{copy(locale,'用量无法硬限制。需要显式允许后才能运行；任务预算不包含自行报告的用量。','Usage cannot be hard-limited. Explicit opt-in is required; self-reported usage is excluded from the task budget.')}</p><CopyField locale={locale} label={copy(locale,'登录命令','Login command')} value={`${cli.bin} optimizer login --profile ${shellArgument(id)}`}/><Checkbox checked={allow} onChange={e=>onAllow(e.target.checked)} label={copy(locale,'允许无法硬限制用量的优化者','Allow an optimizer without hard usage limits')}/></Callout>;}
export function CreateTask({locale,worker,onClose,onOpen,onCreated}:{locale:Locale;worker:RsiWorkerStatus|null;onClose:()=>void;onOpen:(id:string)=>void;onCreated:()=>void}) {
  const read=useRsiRead('options',signal=>rsiApi.options(signal));
  return <Sheet open title={copy(locale,'新建调优任务','New tuning task')} onClose={onClose} className="rsi-sheet">{read.loading&&!read.value?<PageSkeleton compact/>:read.error?<ReadError error={read.error} locale={locale} retry={read.retry}/>:read.value?<CreateForm options={read.value} locale={locale} worker={worker} onOpen={onOpen} onCreated={onCreated} onClose={onClose}/>:null}</Sheet>;
}
export function CreateForm({options,locale,worker,onOpen,onCreated,onClose}:{options:RsiOptions;locale:Locale;worker:RsiWorkerStatus|null;onOpen:(id:string)=>void;onCreated:()=>void;onClose:()=>void}) {
  const [step,setStep]=useState(0),[agent,setAgent]=useState(options.agents[0]?.path??''),[optimizer,setOptimizer]=useState(options.optimizers.find(p=>p.id==='opencode-deepseek')?.path??options.optimizers[0]?.path??'');
  const [customAgent,setCustomAgent]=useState(''),[customOptimizer,setCustomOptimizer]=useState(''),[repository,setRepository]=useState(''),[commit,setCommit]=useState(''),[bank,setBank]=useState(options.bank?.path??'rsi-bank'),[subset,setSubset]=useState<'small'|'full'>('small');
  const trainCount=(selected:'small'|'full')=>options.bank?.[selected].find(r=>r.phase==='train')?.count;
  // The goal defaults to the whole training set of the chosen subset: a smaller default would finish at the baseline.
  const [config,setConfig]=useState({...options.defaults,targetPassedCount:trainCount('small')??options.defaults.targetPassedCount}),[settings,setSettings]=useState(options.settings),[created,setCreated]=useState<RsiCreated|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<RsiApiError|null>(null),[network,setNetwork]=useState(false);
  const request=useRef<string|null>(null),lock=useRef(false),changed=()=>{request.current=null;setError(null);};
  const selectedOptimizer=options.optimizers.find(p=>p.path===optimizer), unmetered=selectedOptimizer?.egress==='vendor-allowlist';
  const errorFor=(field:string)=>error?.details?.field===field||error?.details?.field?.startsWith(field+'.')?fieldErrorLabel(error.details.field??field,error.details.reason,locale):undefined;
  const validSteps=[Boolean((agent||customAgent)&&repository.startsWith('/')&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)),Boolean((optimizer||customOptimizer)&&(!unmetered||settings.allowUnmeteredOptimizer)),bank.startsWith('/'),config.targetPassedCount>0&&config.maxIterations>0&&config.maxTaskTokens>0];
  const submit=async()=>{
    if(lock.current||!validSteps.every(Boolean))return;lock.current=true;setBusy(true);setError(null);setNetwork(false);
    try {const result=await rsiApi.create({requestId:request.current??=crypto.randomUUID(),repository,baselineCommit:commit,agentProfile:agent||customAgent,optimizerProfile:optimizer||customOptimizer,bank,subset,config,settings});setCreated(result);onCreated();}
    catch(err){if(err instanceof RsiApiError){setError(err);const field=err.details?.field??'';setStep(field.startsWith('optimizer')?1:field==='bank'||field==='subset'?2:field.startsWith('config')||field.startsWith('settings')?3:0);}else setNetwork(true);}
    finally{lock.current=false;setBusy(false);}
  };
  const steps=[copy(locale,'被优化 Agent','Target Agent'),copy(locale,'优化者','Optimizer'),copy(locale,'题集','Question sets'),copy(locale,'目标和预算','Goal & budget')];
  const numberField=(key:keyof typeof config,zh:string,en:string,min=1)=>typeof config[key]==='number'?<Field key={key} label={copy(locale,zh,en)} error={errorFor('config.'+key)}><Input type="number" min={min} step={key==='tokenGrowthMaxRatio'?5:1} value={(config[key] as number)*(key==='tokenGrowthMaxRatio'?100:1)} disabled={busy} onChange={e=>{changed();setConfig({...config,[key]:Number(e.target.value)/(key==='tokenGrowthMaxRatio'?100:1)});}}/></Field>:null;
  if(created)return <div className="rsi-form" data-testid="rsi-created">
    <Callout tone="success" title={copy(locale,'任务已加入队列','Task queued')}/>
    {created.agentToken?<><Callout tone="attention" title={copy(locale,'这个令牌只显示这一次','This token is shown only once')}/><Field label={copy(locale,'任务令牌','Task token')}><CopyField locale={locale} label={copy(locale,'任务令牌','Task token')} value={created.agentToken} secret/></Field></>:<Callout tone="attention" title={copy(locale,'任务已创建，令牌无法再次读取','Task already created; the token cannot be retrieved again')}/>}
    <p>{copy(locale,'先设置 RSI_UPSTREAM_BASE_URL、RSI_UPSTREAM_MODEL、RSI_UPSTREAM_API_KEY 和 RSI_MONITOR_API_KEY（自定一个令牌）。监控没有启动时，迭代不会自动晋级，会停下来等人工审查。','First set RSI_UPSTREAM_BASE_URL, RSI_UPSTREAM_MODEL, RSI_UPSTREAM_API_KEY and RSI_MONITOR_API_KEY (any token you choose). Without the monitor, iterations are held for human review instead of being promoted.')}</p>
    <Field label={copy(locale,'启动监控','Start monitor')}><CopyField locale={locale} label={copy(locale,'启动监控','Start monitor')} value={monitorCommand(options.cli,selectedOptimizer?.family??null)}/></Field>
    <Field label={copy(locale,'启动执行器','Start executor')}><CopyField locale={locale} label={copy(locale,'启动执行器','Start executor')} value={workerCommand(options.cli,created.taskId)}/></Field>
    <Button variant="primary" onClick={()=>{const id=created.taskId;setCreated(null);onOpen(id);}}>{copy(locale,'打开任务','Open task')}</Button>
  </div>;
  return <div className="rsi-create"><Steps items={steps} current={step}/><div className="rsi-form">
    {step===0&&<>
      <Field label={steps[0]} error={errorFor('agentProfile')}><Select className="rsi-profile-choice" popupClassName="rsi-profile-popup" locale={locale} value={agent} options={[...options.agents.map(p=>({value:p.path,label:p.name,description:p.description??copy(locale,'在隔离环境中评测此 Agent','Evaluate this Agent in an isolated environment'),icon:p.verified?<Badge tone="success">{copy(locale,'已实测','Verified')}</Badge>:undefined})),{value:'',label:copy(locale,'自定义路径','Custom path')}]} onChange={e=>{changed();setAgent(e.target.value);}}/></Field>
      {!agent&&<Field label={copy(locale,'Agent 档案路径','Agent profile path')} error={errorFor('agentProfile')}><Input value={customAgent} onChange={e=>{changed();setCustomAgent(e.target.value);}}/></Field>}
      <Field label={copy(locale,'代码仓路径','Repository path')} error={errorFor('repository')}><Input value={repository} placeholder="/path/to/repository" onChange={e=>{changed();setRepository(e.target.value);}}/></Field>
      <Field label={copy(locale,'基线 commit','Baseline commit')} hint="git rev-parse HEAD" error={errorFor('baselineCommit')}><Input className="mono" value={commit} onChange={e=>{changed();setCommit(e.target.value);}}/></Field>
    </>}
    {step===1&&<>
      <Field label={steps[1]} error={errorFor('optimizerProfile')}><Select className="rsi-profile-choice" popupClassName="rsi-profile-popup" locale={locale} value={optimizer} options={[...options.optimizers.map(p=>({value:p.path,label:p.name,description:p.description??copy(locale,p.egress==='vendor-allowlist'?'使用登录授权的模型服务':'通过代理计量模型用量',p.egress==='vendor-allowlist'?'Uses an authenticated model service':'Model usage is measured through the proxy'),icon:<Badge tone={p.verified?'success':'attention'}>{copy(locale,p.verified?'已实测':p.loginRequired?'需登录 · 未实测':'未实测',p.verified?'Verified':p.loginRequired?'Login · Unverified':'Unverified')}</Badge>})),{value:'',label:copy(locale,'自定义路径','Custom path')}]} onChange={e=>{changed();setOptimizer(e.target.value);setSettings({...settings,allowUnmeteredOptimizer:false});}}/></Field>
      {!optimizer&&<Field label={copy(locale,'优化者档案路径','Optimizer profile path')} error={errorFor('optimizerProfile')}><Input value={customOptimizer} onChange={e=>{changed();setCustomOptimizer(e.target.value);}}/></Field>}
      {(unmetered||!optimizer)&&<OptimizerWarning locale={locale} id={selectedOptimizer?.id??customOptimizer} allow={settings.allowUnmeteredOptimizer} onAllow={allow=>{changed();setSettings({...settings,allowUnmeteredOptimizer:allow});}}/>}
    </>}
    {step===2&&<>
      <Field label={copy(locale,'题库路径','Question bank path')} error={errorFor('bank')}><Input value={bank} onChange={e=>{changed();setBank(e.target.value);}}/></Field>
      <SegmentedControl activeId={subset} onChange={value=>{changed();const selected=value as 'small'|'full';setSubset(selected);setConfig(old=>({...old,targetPassedCount:trainCount(selected)??old.targetPassedCount}));}} items={[{id:'small',label:copy(locale,'小题集（试用）','Small (trial)')},{id:'full',label:copy(locale,'完整','Full')}]}/>
      {bank===options.bank?.path?<Table locale={locale} rowKey={r=>r.phase} rows={options.bank[subset]} columns={[{key:'set',label:copy(locale,'集合','Set'),render:r=>reasonLabel(r.phase,locale)},{key:'count',label:copy(locale,'题数','Questions'),align:'right',render:r=>r.count},{key:'languages',label:copy(locale,'语言分布','Languages'),render:r=>Object.entries(r.languages).map(([language,count])=>`${reasonLabel(language,locale)} ${count}`).join(' · ')}]}/>:<Callout title={copy(locale,'创建时将校验自定义题库','The custom bank will be validated on creation')}/>}
    </>}
    {step===3&&<>
      {numberField('targetPassedCount','目标通过数','Target passes')}{numberField('maxIterations','最大迭代数','Maximum iterations')}{numberField('maxTaskTokens','任务 Token 预算','Task token budget')}
      <Accordion title={copy(locale,'高级','Advanced')}><div className="rsi-form">{numberField('runTokenBudget','单题 Token 预算','Question token budget')}
        <Field label={copy(locale,'优化者每轮 Token 上限','Optimizer tokens per round')} error={errorFor('settings.optimizerSessionTokens')}><Input type="number" min={1} value={settings.optimizerSessionTokens} onChange={e=>{changed();setSettings({...settings,optimizerSessionTokens:Number(e.target.value)});}}/></Field>
        <Field label={copy(locale,'优化者每轮时限（分钟）','Optimizer time limit (minutes)')}><Input type="number" min={1} value={settings.optimizerSessionTimeoutMs/60000} onChange={e=>{changed();setSettings({...settings,optimizerSessionTimeoutMs:Number(e.target.value)*60000});}}/></Field>
        <Field label={copy(locale,'并发数','Concurrency')}><Input type="number" min={1} max={32} value={settings.concurrency} onChange={e=>{changed();setSettings({...settings,concurrency:Number(e.target.value)});}}/></Field>
        {numberField('noiseRepeats','噪声带重复次数','Noise repetitions',2)}{numberField('sealedQueryBudget','封存集查询次数','Sealed queries',0)}{numberField('tokenGrowthMaxRatio','Token 增幅上限（%）','Maximum token growth (%)',0)}
      </div></Accordion>
    </>}
    {(error||network)&&<WriteError error={error} locale={locale}/>}
    <div className="rsi-config-status"><Badge tone={worker?.upstreamConfigured===true?'success':'neutral'}>{copy(locale,worker?.upstreamConfigured===true?'上游模型已配置':worker?.upstreamConfigured===false?'上游模型未配置':'上游模型配置未确认',worker?.upstreamConfigured===true?'Upstream configured':worker?.upstreamConfigured===false?'Upstream not configured':'Upstream configuration unconfirmed')}</Badge>{worker?.upstreamConfigured!==true&&<p>{copy(locale,'启动执行器时需要设置 RSI_UPSTREAM_BASE_URL、RSI_UPSTREAM_MODEL、RSI_UPSTREAM_API_KEY','Set RSI_UPSTREAM_BASE_URL, RSI_UPSTREAM_MODEL and RSI_UPSTREAM_API_KEY when starting the executor.')}</p>}</div>
  </div><div className="rsi-form-footer"><Button disabled={busy} onClick={step===0?onClose:()=>setStep(n=>n-1)}>{copy(locale,step===0?'取消':'上一步',step===0?'Cancel':'Back')}</Button><Button variant="primary" disabled={!validSteps[step]||busy} loading={busy} onClick={step<3?()=>setStep(n=>n+1):()=>void submit()}>{copy(locale,step<3?'下一步':'创建任务',step<3?'Next':'Create task')}</Button></div></div>;
}
