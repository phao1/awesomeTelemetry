import { extractRequestTitle, isAttachedFilesPrompt, REQUEST_TITLE_VERSION } from '../../src/core/request-titles.js';
import { USER_PROMPT_POLICY_VERSION } from '../../src/core/user-prompts.js';
import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import type { AlertThresholds, TaskContext, TaskMetrics, TaskRequest, TaskRequestList } from '../../src/core/task-types.js';
import { isGenuineUserRecord } from '../../src/core/system-records.js';
import { redactHealthText } from '../../src/core/task-health/render.js';
import { modelPricingRevision } from '../../src/core/pricing.js';
import { taskAlerts, DEFAULT_ALERT_THRESHOLDS } from '../../src/core/task-alerts.js';
import { sessionUsage } from './task-summary.js';
import { cachedStmt } from './stmt-cache.js';

export class TaskRequestChangedError extends Error { readonly code='SOURCE_CHANGED'; }
const changeStamp=(db:Database)=>JSON.stringify([db.pragma('data_version',{simple:true}),cachedStmt(db,'SELECT total_changes() AS n').get()]);
interface Prompt { id: string; sequence: number; title: string; started_at: string }
export function requestBoundaries(db: Database, context: TaskContext): Prompt[] {
  if (!context.task.rootSessionKey) return [];
  const rows = cachedStmt(db, "SELECT id,sequence,title,started_at FROM events WHERE session_id=? AND kind='user_prompt' ORDER BY sequence").all(context.task.rootSessionKey) as Prompt[];
  const valid=rows.filter(r => Number.isFinite(Date.parse(r.started_at)) && isGenuineUserRecord({ kind:'user_prompt',title:r.title,hasInput:true,hasOutput:false }));
  if(valid.some((r,i)=>i>0&&r.started_at<valid[i-1]!.started_at))return [];
  return valid;
}
export const requestId = (context: TaskContext, prompt: Prompt) => 'request:' + context.task.rootSessionKey + ':event:' + prompt.id;
export function resolveTaskRequest(db: Database, context: TaskContext, id: string) {
  const prompts = requestBoundaries(db, context), index = prompts.findIndex(p => requestId(context,p) === id);
  if (index < 0) throw new Error('Invalid task request');
  const prompt = prompts[index]!, next = prompts[index+1];
  return { prompt, next, from: prompt.started_at, to: next ? next.started_at : null };
}
export const requestBoundaryKey=(request:ReturnType<typeof resolveTaskRequest>)=>JSON.stringify([request.prompt.sequence,request.from,request.next?.sequence??null,request.next?.started_at??null]);
const titleFunctions=new WeakSet<Database>();
/** Only attached-file prompts need the retained body; SQLite returns a safe title only. */
function attachedFileTitles(db:Database,context:TaskContext,prompts:Prompt[]):Map<string,string>{
  const ids=prompts.filter(p=>isAttachedFilesPrompt(p.title)).map(p=>p.id);
  if(!ids.length)return new Map();
  if(!titleFunctions.has(db)){
    db.function('task_request_attached_files_title',{deterministic:true},value=>extractRequestTitle(typeof value==='string'?value:'# Files mentioned by the user:'));
    titleFunctions.add(db);
  }
  const rows=cachedStmt(db,`SELECT id,task_request_attached_files_title(input_summary) AS title FROM events WHERE session_id=? AND id IN (SELECT value FROM json_each(?))`).all(context.task.rootSessionKey,JSON.stringify(ids)) as {id:string;title:string}[];
  return new Map(rows.map(row=>[row.id,row.title]));
}
const cache = new WeakMap<Database, Map<string, { revision: string; value: TaskRequestList }>>();
export async function taskRequests(db: Database, context: TaskContext, thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): Promise<TaskRequestList> {
  const stamp=changeStamp(db);
  const revision = createHash('sha256').update(JSON.stringify([USER_PROMPT_POLICY_VERSION,REQUEST_TITLE_VERSION,db.pragma('data_version',{simple:true}), cachedStmt(db,'SELECT total_changes() AS n').get(),context.task,context.members,modelPricingRevision()])).digest('hex');
  let entries = cache.get(db); if (!entries) { entries=new Map();cache.set(db,entries); }
  const hit=entries.get(context.task.id);
  if(hit?.revision===revision)return {...structuredClone(hit.value),items:hit.value.items.map(r=>({...structuredClone(r),alerts:taskAlerts(r.metrics,thresholds)}))};
  const prompts=requestBoundaries(db,context);
  const attachedTitles=attachedFileTitles(db,context,prompts);
  const items: TaskRequest[]=prompts.map((p,i)=>({id:requestId(context,p),ordinal:i+1,title:attachedTitles.get(p.id)??redactHealthText(p.title.split(/\r?\n/,1)[0]??'').slice(0,200),startedAt:p.started_at,endedAt:p.started_at,nextStartedAt:prompts[i+1]?.started_at??null,eventCount:0,metrics:{durationMs:0,toolCalls:0,errors:0,toolResults:0,toolFailures:0,input:null,output:null,cacheRead:null,correctedTotal:null,costUsd:null,models:[]} as TaskMetrics,alerts:[]}));
  const modelsByMember=items.map(()=>new Set<string>());
  const usage=items.map(()=>new Map<string,{input:number;output:number;cacheRead:number;cacheWrite:number;seen:Set<string>}>());
  const providers=new Map((cachedStmt(db,'SELECT id,provider FROM sessions WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(context.members.flatMap(m=>m.sessionKey?[m.sessionKey]:[]))) as {id:string;provider:string}[]).map(r=>[r.id,r.provider]));
  if(items.length)for(const member of context.members){
    if(!member.sessionKey||!member.detailLoaded)continue;
    let last=-1;
    while(true){
      const page=cachedStmt(db,`SELECT id,sequence,started_at,kind,status,input_len,output_len,tokens_json,model FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 200`).all(member.sessionKey,last) as {id:string;sequence:number;started_at:string;kind:string;status:string;input_len:number;output_len:number;tokens_json:string|null;model:string|null}[];
      for(const row of page){
        let lo=0,hi=prompts.length;
        while(lo<hi){const mid=(lo+hi)>>>1,p=prompts[mid]!;if(p.started_at<row.started_at||p.started_at===row.started_at&&(member.sessionKey!==context.task.rootSessionKey||p.sequence<=row.sequence))lo=mid+1;else hi=mid;}
        const i=lo-1,r=items[i];if(!r||!Number.isFinite(Date.parse(row.started_at)))continue;
        r.eventCount++;if(row.started_at>r.endedAt)r.endedAt=row.started_at;
        if(row.kind==='tool'&&row.input_len>0)r.metrics.toolCalls!++;
        if(row.status==='error')r.metrics.errors!++;
        if(row.kind==='tool'&&row.output_len>0&&['success','error'].includes(row.status)){r.metrics.toolResults!++;if(row.status==='error')r.metrics.toolFailures!++;}
        if(row.model)modelsByMember[i]!.add(member.id);
        if(row.model&&!r.metrics.models.includes(row.model))r.metrics.models.push(row.model);
        if(row.tokens_json){
          const tokens=JSON.parse(row.tokens_json) as Record<string,unknown>;
          let u=usage[i]!.get(member.id);if(!u){u={input:0,output:0,cacheRead:0,cacheWrite:0,seen:new Set()};usage[i]!.set(member.id,u);}
          for(const key of ['input','output','cacheRead','cacheWrite'] as const){const n=tokens[key];if(typeof n==='number'&&Number.isSafeInteger(n)&&n>=0){u[key]+=n;u.seen.add(key);}}
        }
      }
      await yieldLoop();if(page.length<200)break;last=page.at(-1)!.sequence;
    }
  }
  for(const [i,r] of items.entries()){
    r.metrics.durationMs=Date.parse(r.endedAt)-Date.parse(r.startedAt);
    const values=context.members.map(member=>{
      const u=usage[i]!.get(member.id);
      const provider=member.sessionKey?providers.get(member.sessionKey):'';
      return {member,usage:u?sessionUsage({provider:provider??'',token_input:u.seen.has('input')?u.input:0,token_output:u.seen.has('output')?u.output:0,token_cache_read:u.seen.has('cacheRead')?u.cacheRead:0,token_cache_write:u.seen.has('cacheWrite')?u.cacheWrite:0}):null};
    });
    // Same partial-known aggregation/explicit coverage as Phase A; never divide session totals.
    r.metrics.coverage={} as NonNullable<TaskMetrics['coverage']>;
    for(const key of ['input','output','cacheRead','correctedTotal','models'] as const){
      const field=key==='correctedTotal'?'total':key;
      const known=values.filter(v=>field==='models'?modelsByMember[i]!.has(v.member.id):v.usage?.[field]!=null);
      r.metrics.coverage[key]={known:known.length,total:context.task.memberCount,missing:values.filter(v=>!known.includes(v)).map(v=>({memberId:v.member.id,name:v.member.name,reason:!v.member.detailLoaded?'detail_not_loaded':'not_reported'}))};
      if(key!=='models'){const total=known.reduce((n,v)=>n+v.usage![field as 'input'|'output'|'cacheRead'|'total']!,0);r.metrics[key]=known.length&&Number.isSafeInteger(total)?total:null;}
    }
    if(context.task.memberCount>context.members.length||context.members.some(m=>!m.detailLoaded)){r.metrics.toolCalls=null;r.metrics.errors=null;r.metrics.toolResults=null;r.metrics.toolFailures=null;}
    r.alerts=taskAlerts(r.metrics,thresholds);
  }
  if(changeStamp(db)!==stamp)throw new TaskRequestChangedError('Task changed during request projection');
  const value={taskId:context.task.id,revision,items};
  if(entries.size>=24)entries.delete(entries.keys().next().value!);entries.set(context.task.id,{revision,value:structuredClone(value)});
  return value;
}
