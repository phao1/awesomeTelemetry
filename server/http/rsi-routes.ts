import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdir, open } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { watch } from 'chokidar';
import type { Router, RouteHandler } from './router.js';
import { sendJson } from './send-json.js';
import { openWritable } from '../storage/db.js';
import { RSI_TASK_COLS } from '../storage/columns.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { getRsiLedgerHead } from '../storage/rsi.js';
import { RsiStore } from '../rsi/queue.js';
import { authenticateAgent, brief, optimizerResults, agentMutation, runTrajectory } from '../rsi/agent-api.js';
import { createTask, humanCommand } from '../rsi/commands.js';
import type { CreateTaskInput } from '../rsi/commands.js';
import { defaultWorkerSettings } from '../rsi/cli.js';
import { boundedJson, notFound, page, RsiError, safeArtifact, strictObject, trajectory, validId } from '../rsi/reader.js';
import type { RsiCommand } from '../../src/core/rsi-types.js';
import { RSI_PHASES } from '../../src/core/rsi-types.js';
import { eventBus } from '../realtime/event-bus.js';

export function localPageRequest(req: IncomingMessage): boolean {
  try {
    const remote = req.socket.remoteAddress;
    if (remote && remote !== '::1' && !remote.startsWith('127.') && !remote.startsWith('::ffff:127.')) return false;
    const host = new URL(`http://${req.headers.host ?? ''}`);
    if (!['localhost','127.0.0.1','[::1]'].includes(host.hostname) || host.username || host.password || host.pathname !== '/') return false;
    if (req.headers.origin !== undefined && req.headers.origin !== host.origin) return false;
    return req.headers['sec-fetch-site'] === undefined || ['same-origin','none'].includes(String(req.headers['sec-fetch-site']));
  } catch { return false; }
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new RsiError(400,'RSI_INVALID_REQUEST');
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[];let size=0,settled=false;
    const cleanup=():void=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('aborted',bad);req.off('error',bad);};
    const fail=(status:number,code:string):void=>{if(settled)return;settled=true;cleanup();req.resume();reject(new RsiError(status,code));};
    const bad=():void=>fail(400,'RSI_INVALID_REQUEST');
    const data=(value:Buffer):void=>{size+=value.length;if(size>65536){fail(413,'RSI_LIMIT');return;}chunks.push(Buffer.from(value));};
    const end=():void=>{
      if(settled)return;settled=true;cleanup();
      try{const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const bearer=req.headers.authorization?.replace(/^Bearer /,'');if(bearer&&text.includes(bearer))throw new Error('credential');resolve(JSON.parse(text));}
      catch{reject(new RsiError(400,'RSI_INVALID_REQUEST'));}
    };
    const timer=setTimeout(bad,5000);timer.unref();
    req.on('data',data);req.on('end',end);req.on('aborted',bad);req.on('error',bad);
  });
}
function checkQuery(q: URLSearchParams, allowed: string[]): void {
  for(const key of q.keys()) if(!allowed.includes(key)||q.getAll(key).length!==1)throw new RsiError(400,'RSI_INVALID_REQUEST');
}
function pageTokenMatches(actual: string, expected: string): boolean {
  const a=Buffer.from(actual),b=Buffer.from(expected); return a.length===b.length && timingSafeEqual(a,b);
}
/** Separate RSI cache, cross-process ledger watcher, no execution in handlers. */
export function registerRsiRoutes(router: Router, dataRoot: string): () => Promise<void> {
  const pageToken=randomBytes(32).toString('hex'), db=openWritable(join(dataRoot,'index.db'));
  let closing=false;const active=new Set<Promise<void>>(), pending=new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed=(file:string):void=>{if(closing)return;if(basename(file)!=='ledger.jsonl')return;const id=basename(dirname(file));if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))return;pending.add(id);if(timer===undefined){timer=setTimeout(()=>{timer=undefined;const taskIds=[...pending].sort();pending.clear();eventBus.emit('rsi_changed',{taskIds});},200);timer.unref();}};
  const watcher=watch(dataRoot,{ignoreInitial:true,depth:1,usePolling:true,interval:100});watcher.on('add',changed);watcher.on('change',changed);
  // Surface watcher faults through endpoint503 rather than crashing or silently stopping.
  let watcherError=false;watcher.on('error',()=>{watcherError=true;});
  const stores=async():Promise<RsiStore[]>=>{
    let entries:string[]=[];try{entries=await readdir(dataRoot);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const result:RsiStore[]=[];
    for(const id of entries.filter(id=>/^[A-Za-z0-9_-]{1,128}$/.test(id)).sort()){
      const store=new RsiStore(db,join(dataRoot,id),id);
      try{await store.refresh();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
      if(store.list('task_put').length)result.push(store);
    }
    return result;
  };
  const register=(method:string,path:string,agent:boolean,handler:(store:RsiStore|null,req:IncomingMessage,p:Record<string,string>,q:URLSearchParams)=>Promise<unknown>,status=200,query:string[]=[]):void=>{
    const route:RouteHandler=(req,res,p)=>{
      const work=(async()=>{
        res.setHeader('cache-control','no-store');
        try{
          if(closing||watcherError)throw new RsiError(503,'RSI_BUSY');
          const auth=req.headers.authorization??'',token=auth.startsWith('Bearer ')?auth.slice(7):'';
          if(!agent&&!localPageRequest(req))throw new RsiError(403,'RSI_FORBIDDEN');
          let store:RsiStore|null=null;
          if(path==='/api/rsi/session'&&token&&!pageTokenMatches(token,pageToken)){
            if(await authenticateAgent(await stores(),token))throw new RsiError(403,'RSI_FORBIDDEN');
            throw new RsiError(401,'RSI_AUTH_REQUIRED');
          }
          if(agent){
            if(!token)throw new RsiError(401,'RSI_AUTH_REQUIRED');
            if(pageTokenMatches(token,pageToken))throw new RsiError(403,'RSI_FORBIDDEN');
            store=await authenticateAgent(await stores(),token);if(!store)throw new RsiError(401,'RSI_AUTH_REQUIRED');
          }else if(path!=='/api/rsi/session'){
            if(!token)throw new RsiError(401,'RSI_AUTH_REQUIRED');
            if(!pageTokenMatches(token,pageToken)){
              if(await authenticateAgent(await stores(),token))throw new RsiError(403,'RSI_FORBIDDEN');
              throw new RsiError(401,'RSI_AUTH_REQUIRED');
            }
            if(p.taskId){validId(p.taskId);const selected=new RsiStore(db,join(dataRoot,p.taskId),p.taskId);await selected.refresh();if(!selected.list('task_put').length)return notFound();store=selected;}
          }
          if(method==='GET'&&(Number(req.headers['content-length']??0)>0||req.headers['transfer-encoding']!==undefined)){req.resume();throw new RsiError(400,'RSI_INVALID_REQUEST');}
          const q=new URL(req.url??'','http://localhost').searchParams;checkQuery(q,query);
          const result=await handler(store,req,p,q);if(Buffer.byteLength(JSON.stringify(result))>1048576)throw new RsiError(413,'RSI_LIMIT');sendJson(res,status,result,req);
        }catch(error){
          const e=error as NodeJS.ErrnoException;
          const code=error instanceof RsiError?error.code:e.code==='ENOENT'?'RSI_NOT_FOUND':/lock unavailable/.test(e.message??'')?'RSI_BUSY':/idempotency conflict|already reserved|immutable|Stale|transition/.test(e.message??'')?'RSI_CONFLICT':/Invalid|Full commit/.test(e.message??'')?'RSI_INVALID_REQUEST':/ledger|anchor|chain|partial_tail/i.test(e.message??'')?'RSI_LEDGER_INVALID':'INTERNAL_ERROR';
          const status=error instanceof RsiError?error.status:code==='RSI_NOT_FOUND'?404:code==='RSI_INVALID_REQUEST'?400:code==='RSI_CONFLICT'?409:code==='RSI_BUSY'||code==='RSI_LEDGER_INVALID'?503:500;
          if(!res.destroyed)sendJson(res,status,{error:{code,message:code==='INTERNAL_ERROR'?'Internal request failure':'RSI request rejected'}},req);
        }
      })();active.add(work);void work.finally(()=>active.delete(work));return work;
    };router.register(method,path,route);
  };
  register('GET','/api/rsi/session',false,async()=>({token:pageToken}));
  register('GET','/api/rsi/agent/brief',true,async s=>brief(s!));
  register('GET','/api/rsi/agent/iterations/:seq/results',true,async(s,_r,p,q)=>optimizerResults(s!,p.seq!,q),200,['cursor','limit']);
  register('GET','/api/rsi/agent/runs/:runId/trajectory',true,async(s,_r,p,q)=>runTrajectory(s!,p.runId!,q,true),200,['file','offset','limit']);
  register('POST','/api/rsi/agent/iterations',true,async(s,r)=>agentMutation(s!,'submit',await body(r)),202);
  register('POST','/api/rsi/agent/stuck',true,async(s,r)=>agentMutation(s!,'declare_stuck',await body(r)),202);
  register('GET','/api/rsi/tasks',false,async(_s,_r,_p,q)=>{
    const items=(await stores()).map(s=>{const {taskTokenHash:_hash,...view}=s.task();return view;});return page(items,q);
  },200,['cursor','limit']);
  register('POST','/api/rsi/tasks',false,async(_s,r)=>{
    const o=strictObject(await body(r),['requestId','repository','baselineCommit','agentProfile','optimizerProfile','bank','config'],['subset']);
    validId(o.requestId as string);const id=(o.requestId as string).length<=123?`task-${o.requestId as string}`:`task-${createHash('sha256').update(o.requestId as string).digest('hex')}`,store=new RsiStore(db,join(dataRoot,id),id);
    return createTask(store,o as unknown as CreateTaskInput,defaultWorkerSettings());
  },202);
  register('GET','/api/rsi/tasks/:taskId',false,async s=>{const {taskTokenHash:_hash,...task}=s!.task();return{task,head:getRsiLedgerHead(db,s!.taskId)};});
  register('GET','/api/rsi/tasks/:taskId/calibration',false,async s=>({monitorCalibration:s!.task().monitorCalibration,latestReport:s!.task().monitorCalibration}));
  const lists=[['iterations','iteration_put'],['evaluations','evaluation_put'],['findings','finding_put'],['decisions','decision_put'],['instructions','instruction_put'],['queue','queue_put'],['sessions','session_put']] as const;
  for(const [path,event] of lists)register('GET',`/api/rsi/tasks/:taskId/${path}`,false,async(s,_r,_p,q)=>{
    let items=s!.list(event) as {id:string;phase?:string;iterationId?:string;audit?:boolean;command?:RsiCommand}[];
    if(event==='queue_put')items=items.map(q=>({...q,audit:q.command?.action==='review'&&q.command.audit===true}));
    if(q.has('phase')){if(!RSI_PHASES.includes(q.get('phase') as never))throw new RsiError(400,'RSI_INVALID_REQUEST');items=items.filter(i=>i.phase===q.get('phase'));}
    if(q.has('iterationId')){validId(q.get('iterationId')!);items=items.filter(i=>i.iterationId===q.get('iterationId'));}return page(items,q);
  },200,['cursor','limit',...(path==='evaluations'?['phase']:path==='findings'||path==='decisions'?['iterationId']:[])]);
  const iteration=(s:RsiStore,seq:string)=>{if(!/^[1-9]\d*$/.test(seq))throw new RsiError(400,'RSI_INVALID_REQUEST');return s.list('iteration_put').find(i=>i.seq===Number(seq))??notFound();};
  register('GET','/api/rsi/tasks/:taskId/iterations/:seq',false,async(s,_r,p)=>({iteration:iteration(s!,p.seq!)}));
  register('GET','/api/rsi/tasks/:taskId/iterations/:seq/findings',false,async(s,_r,p,q)=>page(s!.list('finding_put').filter(f=>f.iterationId===iteration(s!,p.seq!).id),q),200,['cursor','limit']);
  register('GET','/api/rsi/tasks/:taskId/iterations/:seq/diff',false,async(s,_r,p)=>{
    const i=iteration(s!,p.seq!),handle=await open(await safeArtifact(s!.root,`artifacts/${i.id}/diff.patch`),'r');
    try{if((await handle.stat()).size>262144)throw new RsiError(413,'RSI_LIMIT');return{diff:await handle.readFile('utf8'),quality:await boundedJson(s!.root,`artifacts/${i.id}/quality.json`)};}finally{await handle.close();}
  });
  register('GET','/api/rsi/tasks/:taskId/evaluations/:evaluationId/runs',false,async(s,_r,p,q)=>{validId(p.evaluationId!);if(!s!.list('evaluation_put').some(e=>e.id===p.evaluationId))return notFound();return page(s!.list('run_put').filter(r=>r.evaluationId===p.evaluationId),q);},200,['cursor','limit']);
  register('GET','/api/rsi/tasks/:taskId/runs/:runId/trajectory',false,async(s,_r,p,q)=>runTrajectory(s!,p.runId!,q,false),200,['file','offset','limit']);
  register('GET','/api/rsi/tasks/:taskId/sessions/:sessionId/trajectory',false,async(s,_r,p,q)=>{const v=s!.list('session_put').find(v=>v.id===validId(p.sessionId!));if(!v)return notFound();return trajectory(s!.root,v.artifactPath,q,false);},200,['file','offset','limit']);
  register('GET','/api/rsi/tasks/:taskId/worker',false,async s=>{
    try{const v=await boundedJson(s!.root,'private/worker.json',4096) as {pid:number;at:string;phase:string;lastError?:string|null};let live=false;try{process.kill(v.pid,0);live=true;}catch{live=false;}return{...v,running:live&&v.phase!=='stopped'&&Date.now()-Date.parse(v.at)<15000};}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{pid:null,at:null,phase:null,lastError:null,running:false};throw e;}
  });
  register('POST','/api/rsi/tasks/:taskId/commands',false,async(s,r)=>{const o=strictObject(await body(r),['requestId','iterationId','command']);const q=await humanCommand(s!,o.command as RsiCommand,o.requestId as string,o.iterationId as string|null);return{taskId:s!.taskId,queueId:q.id,status:'queued'};},202);
  // Prime metadata statement outside request loops; all task reads use explicit columns.
  cachedStmt(db,`SELECT ${RSI_TASK_COLS} FROM rsi_tasks ORDER BY id`);
  return async()=>{closing=true;clearTimeout(timer);pending.clear();await watcher.close();await Promise.allSettled(active);db.close();};
}
