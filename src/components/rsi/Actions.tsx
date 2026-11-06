import { useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { RsiCommand, RsiIteration, RsiApprovalCategory } from '../../core/rsi-types.js';
import type { RsiTaskView } from '../../core/rsi-api-client.js';
import { rsiApi, RsiApiError } from '../../core/rsi-api-client.js';
import { Dialog } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Input } from '../ui/Input.js';
import { Checkbox } from '../ui/Controls.js';
import { Callout } from '../ui/Display.js';
import { Reason, WriteError } from './Shared.js';
import { copy, reasonLabel } from './copy.js';
export type HumanAction = 'approve'|'reject'|'retry_review'|'retry_evaluation'|'rollback'|'pause'|'resume'|'stop'|'set_budget'|'set_target'|'final'|'adopt'|'instruction';
export const ACTION_COPY: Record<HumanAction,readonly [string,string]>={approve:['批准','Approve'],reject:['拒绝','Reject'],retry_review:['重新审查','Retry review'],retry_evaluation:['重新评测','Retry evaluation'],rollback:['回退','Roll back'],pause:['暂停','Pause'],resume:['继续','Resume'],stop:['终止','Stop'],set_budget:['调整预算','Adjust budget'],set_target:['放宽目标','Adjust target'],final:['最终验收','Final acceptance'],adopt:['采纳','Adopt'],instruction:['添加指令','Add instruction']};
export const actionLabel=(action:HumanAction,locale:Locale)=>ACTION_COPY[action][locale==='zh'?0:1];
const allowed: RsiApprovalCategory[]=['dependency_change','l3_suspicious','l4_suspicious','token_growth'];
export function approvalAllowed(iteration:RsiIteration,checked:string[],reason:string):boolean {return iteration.state==='held'&&iteration.holdReasons.length>0&&iteration.holdReasons.every(c=>allowed.includes(c as RsiApprovalCategory)&&checked.includes(c))&&Boolean(reason.trim());}
export function ActionDialog({action,task,iteration,locale,onClose,onSuccess,parentId}:{action:HumanAction;task:RsiTaskView;iteration:RsiIteration|null;locale:Locale;onClose:()=>void;onSuccess:()=>void;parentId?:string|null}) {
  const [reason,setReason]=useState(''),[checked,setChecked]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<RsiApiError|null>(null),[otherError,setOtherError]=useState(false);
  const [budget,setBudget]=useState({...task.config}),lock=useRef(false),request=useRef<string|null>(null);
  const approvalBlocked=action==='approve'&&(!iteration||iteration.holdReasons.some(c=>!allowed.includes(c as RsiApprovalCategory)));
  const valid=action==='approve'?!!iteration&&approvalAllowed(iteration,checked,reason):Boolean(reason.trim());
  const submit=async()=>{
    if(lock.current||!valid)return;lock.current=true;setBusy(true);setError(null);setOtherError(false);
    let command:RsiCommand;
    if(action==='approve')command={action,categories:checked as RsiApprovalCategory[],reason:reason.trim()};
    else if(action==='rollback')command={action,parentId:parentId??null,reason:reason.trim()};
    else if(action==='set_budget')command={action,maxTaskTokens:budget.maxTaskTokens,maxIterations:budget.maxIterations,sealedQueryBudget:budget.sealedQueryBudget,reason:reason.trim()};
    else if(action==='set_target')command={action,targetPassedCount:budget.targetPassedCount,reason:reason.trim()};
    else if(action==='instruction')command={action,kind:'idea',text:reason.trim(),effectiveFromSeq:task.iterationCount+1};
    else command={action,reason:reason.trim()};
    try {await rsiApi.command(task.id,['approve','reject','retry_review','retry_evaluation','final','adopt'].includes(action)?iteration?.id??null:null,command,request.current??=crypto.randomUUID());onSuccess();}
    catch(err){if(err instanceof RsiApiError)setError(err);else setOtherError(true);}
    finally {lock.current=false;setBusy(false);}
  };
  const change=()=>{request.current=null;};
  return <Dialog title={actionLabel(action,locale)} onClose={()=>{if(!lock.current)onClose();}} footer={<><Button disabled={busy} onClick={onClose}>{copy(locale,'取消','Cancel')}</Button><Button variant={['reject','stop'].includes(action)?'danger':'primary'} loading={busy} disabled={!valid||approvalBlocked} onClick={()=>void submit()}>{actionLabel(action,locale)}</Button></>}>
    <div className="rsi-form">
      {action==='approve'&&iteration&&<><Callout tone="attention" title={copy(locale,'逐项确认挂起原因，并写明理由','Acknowledge every hold reason and explain your decision')}/>{iteration.holdReasons.map(c=><Checkbox key={c} checked={checked.includes(c)} disabled={!allowed.includes(c as RsiApprovalCategory)||busy} label={<Reason code={c} locale={locale}/>} onChange={event=>{change();setChecked(old=>event.target.checked?[...old,c]:old.filter(v=>v!==c));}}/>)}{approvalBlocked&&<Callout tone="danger" title={copy(locale,'缺失证据不能批准，请重新审查或重新评测','Missing evidence cannot be approved; retry review or evaluation')}/>}</>}
      {action==='final'&&<Callout tone="attention" title={copy(locale,'每个版本只能预约一次最终留出集验收','Final holdout acceptance can be reserved only once per version')}/>}
      {action==='adopt'&&<Callout title={copy(locale,'采纳将生成本地补丁和版本引用','Adoption creates a local patch and version reference')}/>}
      {action==='set_budget'&&(['maxTaskTokens','maxIterations','sealedQueryBudget'] as const).map((key,index)=><Field key={key} label={copy(locale,['任务 Token 预算','最大迭代数','封存集查询次数'][index]!,['Task token budget','Maximum iterations','Sealed queries'][index]!)} error={error?.details?.field===key?reasonLabel(error.details.reason,locale):undefined}><Input type="number" min={key==='sealedQueryBudget'?task.sealedQueriesUsed:1} value={budget[key]} disabled={busy} onChange={e=>{change();setBudget({...budget,[key]:Number(e.target.value)});}}/></Field>)}
      {action==='set_target'&&<Field label={copy(locale,'目标通过数','Target passes')}><Input type="number" min={1} value={budget.targetPassedCount} disabled={busy} onChange={e=>{change();setBudget({...budget,targetPassedCount:Number(e.target.value)});}}/></Field>}
      <Field label={copy(locale,action==='instruction'?'思路':'理由（必填）',action==='instruction'?'Idea':'Reason (required)')} error={error?.details?.field==='reason'?reasonLabel(error.details.reason,locale):undefined}><textarea className="rsi-textarea" value={reason} disabled={busy} onChange={e=>{change();setReason(e.target.value);}} rows={4}/></Field>
      {(error||otherError)&&<WriteError error={error} locale={locale}/>}
    </div>
  </Dialog>;
}
