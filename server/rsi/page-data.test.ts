import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { RSI_SCHEMA_SQL } from '../storage/schema.js';
import { RsiStore, now, enqueue } from './queue.js';
import { createTask } from './commands.js';
import { defaultWorkerSettings } from './cli.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import type { RsiIteration, RsiPhase } from '../../src/core/rsi-types.js';
import { overview, verdict, metrics, reviewEvidence, runTelemetry, cachedPage, comparePageRuns } from './page-data.js';
import { page } from './reader.js';
import type { RsiPageRun } from '../../src/core/rsi-api-client.js';
import { privateWrite } from './artifacts.js';
const roots:string[]=[],dbs:Database.Database[]=[];
afterEach(async()=>{for(const db of dbs.splice(0))db.close();await Promise.all(roots.splice(0).map(root=>rm(root,{force:true,recursive:true})));});
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'rsi-page-'));roots.push(root);const db=new Database(':memory:');dbs.push(db);db.pragma('foreign_keys=ON');db.exec(RSI_SCHEMA_SQL);const store=new RsiStore(db,join(root,'task'),'task');
  await createTask(store,{requestId:'create',repository:resolve('.'),baselineCommit:'a'.repeat(40),agentProfile:resolve('rsi-agents/mini-agent/profile.json'),optimizerProfile:resolve('rsi-agents/optimizers/scripted/profile.json'),bank:resolve('server/rsi/__fixtures__/bank'),config:defaultRsiConfig()},defaultWorkerSettings());
  const at=now();let i:RsiIteration={id:'iteration',taskId:'task',seq:1,parentId:null,commit:'b'.repeat(40),prd:{observation:'issue',hypothesis:'repair',changes:['agent.ts'],expectedImpact:'gain'},packageSha256:null,state:'draft',holdReasons:[],resumeState:null,approvals:[],trainScore:null,sealedScore:null,createdAt:at,updatedAt:at};await store.put({event:'iteration_put',payload:i},'optimizer');
  return {root,store,i,set:async(state:RsiIteration['state'],actor:'worker'|'optimizer'='worker',extra:Partial<RsiIteration>={})=>{i={...i,state,...extra,updatedAt:now()};await store.put({event:'iteration_put',payload:i},actor);return i;}};
}
describe('RSI-016 bounded human page projections',()=>{
  it('does not turn an empty finding list or missing usage into a pass or zero',async()=>{
    const {store,i}=await setup(),v=await verdict(store,i);expect(v.defenses.find(d=>d.level==='L0')!.state).toBe('not_reached');expect(v.defenses.find(d=>d.level==='L2')!.state).toBe('not_reached');expect(v.defenses.find(d=>d.level==='L3')!.state).toBe('missing');expect(v.defenses.find(d=>d.level==='L5')!.state).toBe('missing');
    const m=await metrics(store);expect(m.iterations[0]).toMatchObject({targetTokens:null,optimizerTokens:null,reviewTokens:null,cacheHitRate:null,durationMs:null});expect(m.cacheHitRate).toBeNull();
  });
  it('aggregates held items and audit intents, with no task bearer hash in summaries',async()=>{
    const {store,set}=await setup();await set('submitted','optimizer');await set('precheck');await set('held','worker',{holdReasons:['dependency_change'],resumeState:'training'});await enqueue(store,{action:'review',audit:true},'worker','audit','iteration');
    const result=await overview([store]);expect(result.pendingCount).toBe(2);expect(result.reviews.map(r=>r.kind).sort()).toEqual(['audit','held']);expect(result.tasks[0]!.pendingCount).toBe(2);expect(result.tasks[0]!.trainCount).toBe(3);expect(result.tasks[0]!.task).not.toHaveProperty('taskTokenHash');
  });
  it('projects only current review evidence and never returns variant hidden tests or source',async()=>{
    const {store,i}=await setup(),scope='e'.repeat(64),root=`private/reviews/${i.id}/${scope}`;
    const secret='HIDDEN_TEST_BODY_NEVER_ON_PAGE';
    await privateWrite(join(store.root,root,'monitor.json'),JSON.stringify({status:'missing',reason:'invalid_output',model:'test',promptVersion:'v1',conclusions:[],prompt:secret}));
    await privateWrite(join(store.root,root,'process.json'),JSON.stringify({status:'missing',reason:'session_missing',evidence:[],raw:secret}));
    await privateWrite(join(store.root,root,'variants/q.json'),JSON.stringify({questionId:'q',reason:'generation_invalid',reference:[],original:[],draft:{hiddenTests:[{content:secret}]},variant:null,hash:null}));
    const result=await reviewEvidence(store,i);expect(result.scope).toBe(scope);expect(result.monitor).toEqual({status:'missing',reason:'invalid_output',model:'test',promptVersion:'v1',conclusions:[]});expect(result.discarded).toEqual([{questionId:'q',reason:'generation_invalid'}]);expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(result)).not.toContain('hiddenTests');
  });
  it('reads settled usage, deduplicates reservations and keeps unknown counters null',async()=>{
    const root=await mkdtemp(join(tmpdir(),'rsi-usage-'));roots.push(root);await mkdir(join(root,'run/proxy'),{recursive:true});await writeFile(join(root,'run/target.json'),JSON.stringify({memoryPeakBytes:4096,sessionTokens:45,hidden:'private'}));
    const row={requestId:'request',stage:'settled',complete:true,usage:{input:40,cached:20,total:50}};await writeFile(join(root,'run/proxy/usage.jsonl'),JSON.stringify({...row,stage:'reserved'})+'\n'+JSON.stringify(row)+'\n');
    expect(await runTelemetry(root,'run')).toEqual({memoryPeakBytes:4096,sessionTokens:45,input:40,cached:20,requests:[{requestId:'request',tokens:50,cacheHitRate:.5}]});
    await writeFile(join(root,'run/proxy/usage.jsonl'),JSON.stringify({...row,usage:{input:40,total:50}})+'\n');expect(await runTelemetry(root,'run')).toMatchObject({input:null,cached:null,requests:null});
  });
  it('returns independent cached values and enforces response bounds',async()=>{
    const value=await cachedPage('independent',async()=>({items:[1]}));value.items.push(2);expect(await cachedPage('independent',async()=>({items:[3]}))).toEqual({items:[1]});await expect(cachedPage('oversized',async()=>({text:'x'.repeat(1048576)}))).rejects.toMatchObject({code:'RSI_LIMIT'});
  });
});

it('orders human runs across page boundaries by phase, question and repetition',()=>{
 const row=(id:string,phase:RsiPhase,questionId:string,repetition=0,attempt=0):RsiPageRun=>({id,phase,questionId,repetition,attempt,language:null,outcome:'pass',failureReason:null,tokens:null,durationMs:0,memoryPeakBytes:null,sessionTokens:null,tokenDifference:null,at:'2026-11-07T00:00:00.000Z'});
 const rows=[row('a','final','a'),row('b','ablation','a'),row('c','adversarial','a'),row('d','sealed','a'),row('e','train','b'),row('f','smoke','b'),row('g','train','a',1),row('h','train','a',0,1),row('i','train','a',0)];
 const first=page(rows,new URLSearchParams('limit=3'),comparePageRuns);expect(first.items.map(r=>r.id)).toEqual(['f','i','h']);expect(first.nextCursor).toBe('h');
 const second=page(rows,new URLSearchParams('limit=3&cursor=h'),comparePageRuns);expect(second.items.map(r=>r.id)).toEqual(['g','e','d']);
 const last=page(rows,new URLSearchParams('limit=3&cursor=d'),comparePageRuns);expect(last.items.map(r=>r.phase)).toEqual(['adversarial','ablation','final']);expect(last.nextCursor).toBeNull();
 expect(()=>page(rows,new URLSearchParams('cursor=absent'),comparePageRuns)).toThrow();
});
