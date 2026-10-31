import type { Database } from 'better-sqlite3';
import type { AlertThresholds, TaskContext, TaskKpis, TaskListQuery, TaskPage, TaskSummary } from '../../src/core/task-types.js';
import { taskAlerts } from '../../src/core/task-alerts.js';
import { cachedStmt } from './stmt-cache.js';
import { TASK_BINDINGS_SQL, importedTask, TaskReadError } from './task-workbench.js';
import { readSummarySessions, taskMetrics } from './task-summary.js';
export class TaskHomeChangedError extends Error { readonly code='SOURCE_CHANGED'; constructor(){super('Task metadata changed; refresh the list');} }
const cache = new WeakMap<Database,{revision:string;promise:Promise<TaskSummary[]>}>();
const revision=(db:Database,includePressure=false)=>`${db.pragma('data_version',{simple:true})}:${(cachedStmt(db,'SELECT total_changes() AS n').get() as {n:number}).n}:${includePressure}`;
export async function snapshot(db:Database,includePressure=false):Promise<TaskSummary[]> {
  const stamp=revision(db,includePressure), hit=cache.get(db); if(hit?.revision===stamp)return structuredClone(await hit.promise);
  const promise=(async()=>{
    const bindings=cachedStmt(db,`${TASK_BINDINGS_SQL} SELECT b.root_id,b.run_id,s.id,s.source_agent,s.title,s.provider,s.started_at,s.updated_at,s.status,s.event_count,s.detail_loaded,(EXISTS(SELECT 1 FROM scan_state ss WHERE ss.session_id=s.id) OR EXISTS(SELECT 1 FROM telemetry_sessions t WHERE t.session_id=s.id)) AS provenance,(SELECT origin FROM telemetry_sessions t WHERE t.session_id=s.id) AS telemetry_origin,(SELECT source FROM telemetry_sessions t WHERE t.session_id=s.id) AS telemetry_source FROM bindings b JOIN sessions s ON s.id=b.session_id ORDER BY b.root_id,s.id`).all() as Array<{root_id:string;run_id:string|null;id:string;source_agent:string;title:string;provider:string;started_at:string;updated_at:string;status:string;event_count:number;detail_loaded:number;provenance:number;telemetry_origin:string|null;telemetry_source:string|null}>;
    const groups=new Map<string,typeof bindings>();for(const b of bindings){const g=groups.get(b.root_id)??[];g.push(b);groups.set(b.root_id,g);}
    const result:TaskSummary[]=[];
    const allGroups=[...groups];
    const agents=cachedStmt(db,'SELECT run_id,id,display_name,session_keys_json FROM team_agents ORDER BY id').all() as Array<{run_id:string;id:string;display_name:string;session_keys_json:string}>;
    for(let offset=0;offset<allGroups.length;offset+=25){
    const batch=allGroups.slice(offset,offset+25);
    const keys=batch.flatMap(([,group])=>group.slice(0,100).map(r=>r.id));
    const sessionRows:ReturnType<typeof readSummarySessions>=[];
    const chunkSize=includePressure?1:25;
    for(let k=0;k<keys.length;k+=chunkSize){sessionRows.push(...readSummarySessions(db,keys.slice(k,k+chunkSize),includePressure));await new Promise<void>(resolve=>setTimeout(resolve,0));}
    const sessionMap=new Map(sessionRows.map(row=>[row.id,row]));
    for(const [rootId,group] of batch){
      const root=group.find(r=>r.id===rootId);if(!root)continue;
      const task:TaskSummary={id:'collected:'+rootId,origin:root.telemetry_origin==='imported'?'imported':'collected',provenanceKnown:root.provenance===1,rootSessionKey:rootId,runId:new Set(group.flatMap(r=>r.run_id?[r.run_id]:[])).size===1?group.find(r=>r.run_id)?.run_id??null:null,title:root.title,provider:root.telemetry_source??root.provider,startedAt:root.started_at||null,updatedAt:group.reduce((a,b)=>a>b.updated_at?a:b.updated_at,''),recordedStatus:root.status,memberCount:group.length,eventCount:group.reduce((n,r)=>n+r.event_count,0),loadedMemberCount:group.filter(r=>r.detail_loaded===1).length};
      const selected=group.slice(0,100);
      const context:TaskContext={task,members:selected.map(r=>({id:r.id,name:r.source_agent,role:r.id===rootId?'main':'unknown',sessionKey:r.id,parentId:null,detailLoaded:r.detail_loaded===1,eventCount:r.event_count})),importSession:null,warnings:[]};
      // Preserve unlinked declared members in the completeness denominator,
      // matching readTask; do not invent an associated session for them.
      const represented=new Set<string>();
      const taskAgents=task.runId?agents.filter(a=>a.run_id===task.runId):[];
      for(const member of context.members){const agent=taskAgents.find(a=>(JSON.parse(a.session_keys_json) as string[]).includes(member.sessionKey!));if(agent){member.id=agent.id;member.name=agent.display_name;represented.add(agent.id);}}
      for(const agent of taskAgents)if(!represented.has(agent.id)&&context.members.length<100)context.members.push({id:agent.id,name:agent.display_name,role:'unknown',sessionKey:null,parentId:null,detailLoaded:false,eventCount:0});
      task.memberCount=Math.max(task.memberCount,context.members.length);
      task.metrics=taskMetrics(db,context,selected.flatMap(r=>sessionMap.has(r.id)?[sessionMap.get(r.id)!]:[]));
      result.push(task);
    }
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    const imports=cachedStmt(db,'SELECT id,metadata_json FROM trace_log_imports ORDER BY id').all() as Array<{id:string;metadata_json:string}>;
    for(const row of imports){const session=JSON.parse(row.metadata_json) as NonNullable<TaskContext['importSession']>,task=importedTask(session);task.metrics=taskMetrics(db,{task,members:[],importSession:session,warnings:[]},[]);result.push(task);}
    if(revision(db,includePressure)!==stamp)throw new TaskHomeChangedError();
    return result;
  })();cache.set(db,{revision:stamp,promise});
  try{return structuredClone(await promise);}catch(error){if(cache.get(db)?.revision===stamp)cache.delete(db);throw error;}
}
export async function listTaskHome(db:Database,query:TaskListQuery,thresholds:AlertThresholds):Promise<TaskPage>{
  const limit=query.limit??50,offset=query.offset??0;
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)||offset<0||offset>100000||(query.q?.length??0)>200)throw new TaskReadError('BAD_REQUEST','Invalid task pagination');
  const since=query.range===undefined||query.range==='all'?0:Date.now()-(query.range==='today'?1:query.range==='7d'?7:30)*86400000;
  let items=(await snapshot(db,thresholds.contextPressurePct!==null)).filter(t=>t.origin===(query.origin??'collected')&&(!query.provider||t.provider===query.provider)&&(!query.q||(t.title+' '+t.id).toLowerCase().includes(query.q.toLowerCase()))&&(since===0||t.startedAt!==null&&Date.parse(t.startedAt)>=since)).map(t=>({...t,alerts:taskAlerts(t.metrics!,thresholds)}));
  if(query.failed)items=items.filter(t=>t.recordedStatus==='error');
  if(query.toolFailures)items=items.filter(t=>(t.metrics?.toolFailures??0)>0);
  if(query.errors)items=items.filter(t=>t.metrics!.errors!==null&&t.metrics!.errors!>0);
  if(query.alerts)items=items.filter(t=>t.alerts.length>0);
  const value=(t:TaskSummary):number|null=>{
    const m=t.metrics!;switch(query.sort){case'duration':return m.durationMs;case'errors':return m.errors;case'tokens':return m.correctedTotal;case'cacheHitRate':return m.cacheHitRate;default:return t.startedAt?Date.parse(t.startedAt):null;}
  };
  items.sort((a,b)=>{const x=value(a),y=value(b);return (x==null||!Number.isFinite(x)?y==null?0:1:y==null||!Number.isFinite(y)?-1:(x-y)*(query.direction==='asc'?1:-1))||a.id.localeCompare(b.id);});
  const page=items.slice(offset,offset+limit);
  for(const task of page){const m=task.metrics!;m.models=m.models.slice(0,3);if(m.coverage)for(const c of Object.values(m.coverage))c.missing=c.missing.slice(0,1).map(member=>({...member,name:member.name.slice(0,128)}));}
  return {items:page,total:items.length,offset,limit,hasMore:offset+limit<items.length};
}
export async function taskKpis(db:Database,thresholds:AlertThresholds):Promise<TaskKpis>{
  const items=(await snapshot(db,thresholds.contextPressurePct!==null)).filter(t=>t.origin==='collected'&&t.startedAt&&Date.parse(t.startedAt)>=Date.now()-7*86400000),failedTasks=items.filter(t=>t.recordedStatus==='error').length;
  const statusKnownTasks=items.filter(t=>['success','error'].includes(t.recordedStatus)).length;
  const out:TaskKpis={tasks:items.length,statusKnownTasks,toolKnownTasks:0,failedTasks,failurePct:statusKnownTasks?100*failedTasks/statusKnownTasks:null,toolFailurePct:null,tokens:null,tokenKnownTasks:0,cacheHitRate:null,cacheKnownMembers:0,cacheTotalMembers:0,alerts:0};
  let results=0,failures=0,cacheRead=0,promptInput=0;
  for(const t of items){const m=t.metrics!;if(m.correctedTotal!==null){out.tokens=(out.tokens??0)+m.correctedTotal;if(m.coverage?.correctedTotal.known===m.coverage?.correctedTotal.total)out.tokenKnownTasks++;}if(m.toolResults!=null&&m.toolFailures!=null){results+=m.toolResults;failures+=m.toolFailures;out.toolKnownTasks++;}out.alerts+=taskAlerts(m,thresholds).length?1:0;out.cacheTotalMembers+=t.memberCount;out.cacheKnownMembers+=m.coverage?.cacheHitRate.known??0;if(m.cacheHitRate!==null&&m.promptInput!==null){promptInput+=m.promptInput;cacheRead+=m.cacheHitRate*m.promptInput;}}
  out.cacheHitRate=promptInput>0?cacheRead/promptInput:null;
  out.toolFailurePct=results?100*failures/results:null;return out;
}

/** TC-002: resolve session aliases in one binding query, then reuse Phase B projection. */
export async function taskComparisonSnapshot(db:Database,a:string[],b:string[],thresholds:AlertThresholds,distinctRequests=false){
  const aliases=cachedStmt(db,`${TASK_BINDINGS_SQL} SELECT session_id,root_id FROM bindings WHERE session_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...a,...b].filter(id=>id.startsWith('collected:')).map(id=>id.slice(10)))) as Array<{session_id:string;root_id:string}>;
  const roots=new Map(aliases.map(row=>['collected:'+row.session_id,'collected:'+row.root_id]));
  const aa=a.map(id=>roots.get(id)??id),bb=b.map(id=>roots.get(id)??id);
  if(new Set([...aa,...bb]).size!==aa.length+bb.length&&!(distinctRequests&&aa.length===1&&bb.length===1))throw new TaskReadError('BAD_REQUEST','Select distinct root tasks');
  const tasks=new Map((await snapshot(db,thresholds.contextPressurePct!==null)).map(task=>[task.id,task]));
  const group=(ids:string[])=>ids.map(id=>{const task=tasks.get(id);if(!task)throw new TaskReadError('SESSION_NOT_FOUND','Task not found');return {...task,alerts:taskAlerts(task.metrics!,thresholds)};});
  return {a:group(aa),b:group(bb)};
}
