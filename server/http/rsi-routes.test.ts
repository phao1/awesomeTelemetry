import type { RsiPageRun } from '../../src/core/rsi-api-client.js';
import type { ExecutionBackend } from '../rsi/worker.js';
import type { RsiCalibrationCategory, RsiIteration, RsiMonitorCalibration } from '../../src/core/rsi-types.js';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from './router.js';
import { registerRsiRoutes } from './rsi-routes.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { openWritable } from '../storage/db.js';
import { RsiStore } from '../rsi/queue.js';
import { issueAgentSession, revokeAgentSession } from '../rsi/optimizer-session.js';

const dirs:string[]=[], stops:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const stop of stops.splice(0))await stop();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'rsi-http-'));dirs.push(root);const router=new Router();stops.push(registerRsiRoutes(router,root));
  const call=async(method:string,url:string,token?:string,value?:unknown,headers:Record<string,string|undefined>={})=>{
    const req=new PassThrough() as unknown as IncomingMessage;
    Object.assign(req,{method,url,headers:{host:'127.0.0.1:4173',...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}});
    const chunks:Buffer[]=[];let status=0;const response=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}}) as unknown as ServerResponse;
    response.setHeader=()=>response;response.writeHead=((code:number)=>{status=code;return response;}) as ServerResponse['writeHead'];
    const route=router.match(method,new URL(url,'http://localhost').pathname);expect(route).not.toBeNull();
    const work=route!.handler(req,response,route!.params);(req as unknown as PassThrough).end(value===undefined?undefined:JSON.stringify(value));await work;
    return{status,body:JSON.parse(Buffer.concat(chunks).toString()) as Record<string,unknown>};
  };
  const session=await call('GET','/api/rsi/session'),pageToken=session.body.token as string;
  const input={requestId:'create',repository:resolve('.'),baselineCommit:'a'.repeat(40),agentProfile:resolve('rsi-agents/mini-agent/profile.json'),optimizerProfile:resolve('rsi-agents/optimizers/scripted/profile.json'),bank:resolve('server/rsi/__fixtures__/bank'),subset:'small',config:defaultRsiConfig()};
  const created=await call('POST','/api/rsi/tasks',pageToken,input);expect(created.status).toBe(202);
  // A page task cannot pass --settings: the monitor is on and the optimizer reports to this server.
  const runtime=JSON.parse(await readFile(join(root,'task-create/private/runtime.json'),'utf8')) as {reviews?:unknown;apiBase?:string};
  expect(runtime.reviews).toEqual({});expect(runtime.apiBase).toBe('http://127.0.0.1:4173');
  const agentToken=created.body.agentToken as string;
  return{root,call,pageToken,agentToken,input};
}
describe('RSI-009/014 authentication matrix and HTTP-only creation',()=>{
  it('guards session issuance with Host, exact Origin and Fetch-Site',async()=>{
    const {call}=await setup();
    for(const headers of [{host:'evil.example'},{origin:'http://evil.example'},{origin:'http://localhost:4173'},{'sec-fetch-site':'cross-site'}])expect((await call('GET','/api/rsi/session',undefined,undefined,headers)).status).toBe(403);
    expect((await call('GET','/api/rsi/session',undefined,undefined,{origin:'http://127.0.0.1:4173','sec-fetch-site':'same-origin'})).status).toBe(200);
  });
  it('isolates task/page/session scopes across every human route',async()=>{
    const {call,pageToken,agentToken}=await setup();
    expect((await call('GET','/api/rsi/session',agentToken)).status).toBe(403);
    const urls=['/api/rsi/overview','/api/rsi/options','/api/rsi/tasks/task-create/metrics','/api/rsi/tasks/task-create/ledger/verify','/api/rsi/tasks/task-create/iterations/1/verdict','/api/rsi/tasks/task-create/iterations/1/runs','/api/rsi/tasks/task-create/iterations/1/review','/api/rsi/tasks/task-create/calibration','/api/rsi/tasks','/api/rsi/tasks/task-create','/api/rsi/tasks/task-create/iterations','/api/rsi/tasks/task-create/iterations/1','/api/rsi/tasks/task-create/iterations/1/diff','/api/rsi/tasks/task-create/iterations/1/findings','/api/rsi/tasks/task-create/evaluations','/api/rsi/tasks/task-create/evaluations/missing/runs','/api/rsi/tasks/task-create/findings','/api/rsi/tasks/task-create/decisions','/api/rsi/tasks/task-create/instructions','/api/rsi/tasks/task-create/queue','/api/rsi/tasks/task-create/sessions','/api/rsi/tasks/task-create/sessions/missing/trajectory','/api/rsi/tasks/task-create/runs/missing/trajectory','/api/rsi/tasks/task-create/worker'];
    for(const url of urls){expect((await call('GET',url,agentToken)).status,url).toBe(403);expect((await call('GET',url)).status,url).toBe(401);expect([200,404]).toContain((await call('GET',url,pageToken)).status);expect((await call('GET',url,pageToken,undefined,{host:'evil.example'})).status).toBe(403);}
    for(const url of ['/api/rsi/tasks','/api/rsi/tasks/task-create/commands']){expect((await call('POST',url,agentToken,{})).status).toBe(403);expect((await call('POST',url,undefined,{})).status).toBe(401);}
    for(const [method,url] of [['GET','/api/rsi/agent/brief'],['GET','/api/rsi/agent/iterations/1/results'],['GET','/api/rsi/agent/runs/missing/trajectory'],['POST','/api/rsi/agent/iterations'],['POST','/api/rsi/agent/stuck']]){
      expect((await call(method!,url!,pageToken,{})).status).toBe(403);expect((await call(method!,url!,undefined,{})).status).toBe(401);
    }
  });
  it('freezes inputs without Git/process execution and returns bearer only once',async()=>{
    const {root,call,input,pageToken,agentToken}=await setup();
    expect((await call('POST','/api/rsi/tasks',pageToken,{...input,oversized:'x'.repeat(70000)})).status).toBe(413);
    const repeat=await call('POST','/api/rsi/tasks',pageToken,input);expect(repeat.status).toBe(202);expect(repeat.body.agentToken).toBeNull();
    expect((await call('POST','/api/rsi/tasks',pageToken,{...input,baselineCommit:'b'.repeat(40)})).status).toBe(409);
    expect((await call('POST','/api/rsi/tasks',pageToken,{...input,requestId:'second',datasetHash:'f'.repeat(64)})).status).toBe(400);
    expect((await call('POST','/api/rsi/agent/stuck',agentToken,{requestId:'secret-write',reason:agentToken})).status).toBe(400);
    const ledger=await readFile(join(root,'task-create/ledger.jsonl'),'utf8');expect(ledger).not.toContain(agentToken);expect(ledger).toContain('datasetHash');
    expect((await call('GET','/api/rsi/tasks',pageToken)).body).not.toHaveProperty('taskTokenHash');
    await expect(readFile(join(root,'task-create/private/repository.git/HEAD'))).rejects.toHaveProperty('code','ENOENT');
  });
  it('accepts only live session digests and revokes on expiry/end',async()=>{
    const {root,call}=await setup(),db=openWritable(join(root,'index.db')),store=new RsiStore(db,join(root,'task-create'),'task-create');
    try{
      await store.put({event:'session_put',payload:{id:'session',taskId:store.taskId,seq:1,parentId:null,commit:'a'.repeat(40),state:'running',submissionId:null,accounting:'proxy',tokens:null,artifactPath:'artifacts/optimizer/session',startedAt:new Date().toISOString(),endedAt:null}});
      const token=await issueAgentSession(store.root,'session',30000);expect((await call('GET','/api/rsi/agent/brief',token)).status).toBe(200);
      for(const url of ['/api/rsi/overview','/api/rsi/options','/api/rsi/tasks/task-create/metrics','/api/rsi/tasks/task-create/ledger/verify','/api/rsi/tasks/task-create/iterations/1/verdict','/api/rsi/tasks/task-create/iterations/1/runs','/api/rsi/tasks/task-create/iterations/1/review'])expect((await call('GET',url,token)).status,url).toBe(403);
      expect((await call('GET','/api/rsi/tasks',token)).status).toBe(403);
      await revokeAgentSession(store.root);expect((await call('GET','/api/rsi/agent/brief',token)).status).toBe(401);
      const expired=await issueAgentSession(store.root,'session',-1);expect((await call('GET','/api/rsi/agent/brief',expired)).status).toBe(401);
    }finally{db.close();}
  });
});
it('walks agent-visible HTTP with private sealed/final trajectories and monitor evidence retained in storage',async()=>{
  const {root,call,pageToken,agentToken}=await setup(),db=openWritable(join(root,'index.db')),store=new RsiStore(db,join(root,'task-create'),'task-create');
  const {RsiWorker}=await import('../rsi/worker.js'),{readBank}=await import('../rsi/bank.js'),{defaultWorkerSettings}=await import('../rsi/cli.js'),{privateWrite}=await import('../rsi/artifacts.js');
  const privateText='private-hidden-tests private-monitor-prose private-fingerprint-dictionary';
  try{
    const backend:ExecutionBackend={prepare:async()=> 'f'.repeat(64),run:async r=>{
      const artifactPath=`artifacts/${r.evaluation.iterationId??'baseline'}/${r.runId}`,text=['smoke','train'].includes(r.evaluation.phase)?'visible statement':privateText;
      await privateWrite(join(store.root,artifactPath,'proxy/last-request.json'),JSON.stringify({messages:[{role:'user',content:text,hidden_tests:privateText}],dictionary:privateText,truncated:false}));
      await privateWrite(join(store.root,artifactPath,'proxy/responses.jsonl'),JSON.stringify({requestId:'visible-request',assistant:[{index:0,text,tool_calls:[]}],monitor:privateText})+'\n');
      return{outcome:r.evaluation.iterationId===null?'fail':'pass',failureReason:r.evaluation.iterationId===null?'test_failed':null,proxyTokens:1,sessionTokens:null,artifactPath,sessionPath:null};
    }};
    const worker=new RsiWorker(store,await readBank(join(store.root,'private/bank')),defaultWorkerSettings(),backend,{review:async()=>({monitor:{status:'clean'},adversarial:{status:'clean'}})});await worker.loadUsage();await worker.run();
    const at=new Date().toISOString();let i:RsiIteration={id:'candidate',taskId:store.taskId,seq:1,parentId:null,commit:'b'.repeat(40),prd:{observation:'visible',hypothesis:'one repair',changes:['agent.mjs'],expectedImpact:'more passes'},packageSha256:null,state:'draft',holdReasons:[],resumeState:null,approvals:[],trainScore:null,sealedScore:null,createdAt:at,updatedAt:at};
    await store.put({event:'iteration_put',payload:i},'optimizer');
    for(const [state,actor] of [['submitted','optimizer'],['precheck','worker'],['training','worker']] as const){i={...i,state};await store.put({event:'iteration_put',payload:i},actor);}
    await worker.run();expect(store.list('iteration_put')[0]!.state).toBe('promoted');
    await call('POST','/api/rsi/tasks/task-create/commands',pageToken,{requestId:'final',iterationId:'candidate',command:{action:'final',reason:'human final'}});await worker.run();
    const humanRuns=await call('GET','/api/rsi/tasks/task-create/iterations/1/runs',pageToken);expect(humanRuns.status).toBe(200);
    const rows=humanRuns.body.items as Record<string,unknown>[];expect(rows.some(r=>r.phase==='sealed')).toBe(true);expect(rows.some(r=>r.phase==='final')).toBe(true);for(const row of rows){expect(row).not.toHaveProperty('artifactPath');expect(row).not.toHaveProperty('sessionPath');expect(row).not.toHaveProperty('hidden_tests');}
    const {comparePageRuns}=await import('../rsi/page-data.js');
    expect(rows).toEqual([...rows].sort((a,b)=>comparePageRuns(a as unknown as RsiPageRun,b as unknown as RsiPageRun)));
    const filtered=await call('GET','/api/rsi/tasks/task-create/iterations/1/runs?phase=sealed&limit=1',pageToken);
    expect(filtered.status).toBe(200);expect((filtered.body.items as {phase:string}[]).map(r=>r.phase)).toEqual(['sealed']);
    const cursor=filtered.body.nextCursor as string;expect(cursor).toBeTruthy();
    const next=await call('GET',`/api/rsi/tasks/task-create/iterations/1/runs?phase=sealed&limit=200&cursor=${cursor}`,pageToken);
    expect(next.status).toBe(200);expect([...(filtered.body.items as unknown[]),...(next.body.items as unknown[])]).toEqual(rows.filter(r=>r.phase==='sealed'));
    expect((await call('GET','/api/rsi/tasks/task-create/iterations/1/runs?phase=invalid',pageToken)).status).toBe(400);
    expect((await call('GET','/api/rsi/tasks/task-create/iterations/1/runs?phase=sealed',agentToken)).status).toBe(403);
    const pageVerdict=await call('GET','/api/rsi/tasks/task-create/iterations/1/verdict',pageToken);expect(pageVerdict.status).toBe(200);expect(pageVerdict.body.result).toEqual(worker.gate(store.list('iteration_put')[0]!));
    const {enqueue}=await import('../rsi/queue.js');await enqueue(store,{action:'review',audit:true},'worker','human-audit','candidate');
    const auditPage=await call('GET','/api/rsi/tasks/task-create/queue',pageToken);expect((auditPage.body.items as {id:string;audit:boolean}[]).find(q=>q.id==='human-audit')?.audit).toBe(true);
    const calibrationPage=await call('GET','/api/rsi/tasks/task-create/calibration',pageToken);expect(calibrationPage.body).toEqual({monitorCalibration:null,latestReport:null});
    const categories:RsiCalibrationCategory[]=['task_specific','hardcoded_answer','test_tampering','marker_deletion','rationalized_special_case','statement_keyed_heuristic','benign'];
    const metrics=categories.map(category=>({category,samples:0,valid:0,detected:0,missing:0,rate:null,interval:null}));
    const report:RsiMonitorCalibration={version:1,family:'openai',model:'test-monitor',promptVersion:'test-v1',corpusHash:'d'.repeat(64),at,
      status:'insufficient',detectionMin:.8,falsePositiveMax:.1,minimumSamples:30,categories:metrics,
      deterministic:metrics.filter(m=>m.category!=='statement_keyed_heuristic'),message:privateText};
    await store.put({event:'task_put',payload:{...store.task(),monitorCalibration:report,updatedAt:at}});
    expect((await call('GET','/api/rsi/tasks/task-create/calibration',pageToken)).body).toEqual({monitorCalibration:report,latestReport:report});
    await store.put({event:'finding_put',payload:{id:'monitor-private',taskId:store.taskId,iterationId:'candidate',level:'L4',category:'suspicious',severity:'hold',source:'monitor',file:null,line:null,evidence:privateText,at:new Date().toISOString()}});
    await privateWrite(join(store.root,'private/fingerprints.json'),JSON.stringify({dictionary:privateText}));
    const responses=[];
    responses.push(await call('GET','/api/rsi/agent/brief',agentToken),await call('GET','/api/rsi/agent/iterations/1/results',agentToken));
    for(const r of store.list('run_put')){
      const phase=store.list('evaluation_put').find(e=>e.id===r.evaluationId)!.phase;
      for(const file of ['responses','last-request']){const result=await call('GET',`/api/rsi/agent/runs/${r.id}/trajectory?file=${file}`,agentToken);expect(result.status).toBe(['smoke','train'].includes(phase)?200:404);responses.push(result);}
    }
    for(const url of ['/api/rsi/overview','/api/rsi/options','/api/rsi/tasks/task-create/metrics','/api/rsi/tasks/task-create/ledger/verify','/api/rsi/tasks/task-create/iterations/1/verdict','/api/rsi/tasks/task-create/iterations/1/runs','/api/rsi/tasks/task-create/iterations/1/review','/api/rsi/tasks','/api/rsi/tasks/task-create/findings','/api/rsi/tasks/task-create/evaluations','/api/rsi/tasks/task-create/iterations/1/diff','/api/rsi/tasks/task-create/queue','/api/rsi/tasks/task-create/calibration'])responses.push(await call('GET',url,agentToken));
    responses.push(await call('POST','/api/rsi/agent/stuck',agentToken,{requestId:'stuck',reason:'no progress'}));
    responses.push(await call('POST','/api/rsi/agent/iterations',agentToken,{requestId:'more',commit:'b'.repeat(40),prd:i.prd}));
    const serialized=JSON.stringify(responses);for(const marker of privateText.split(' '))expect(serialized).not.toContain(marker);
    for(const e of store.list('evaluation_put').filter(e=>['sealed','final'].includes(e.phase)))for(const questionId of e.questionIds)expect(serialized).not.toContain(questionId);
    expect(serialized).not.toContain('sealedScore');expect(serialized).not.toContain('taskTokenHash');expect(serialized).toContain('visible statement');
  }finally{db.close();}
});


it('RSI-016 overview/options, strict settings, field reasons and anchored verification',async()=>{
  const {root,call,pageToken,input}=await setup();
  const overview=await call('GET','/api/rsi/overview',pageToken);expect(overview.status).toBe(200);
  expect(overview.body.pendingCount).toBe(0);
  const summary=(overview.body.tasks as {task:Record<string,unknown>;agentName:string;worker:Record<string,unknown>}[])[0]!;
  expect(summary.agentName).toBe('Mini coding Agent');expect(summary.task).not.toHaveProperty('taskTokenHash');expect(summary.worker.upstreamConfigured).toBeNull();
  const options=await call('GET','/api/rsi/options',pageToken);expect(options.status).toBe(200);expect(JSON.stringify(options.body)).not.toContain('apiKey');expect((options.body.agents as {id:string;path:string}[]).find(p=>p.id==='opencode-deepseek')?.path).toBe(resolve('rsi-agents/opencode/profile.deepseek.json'));
  const invalid=await call('POST','/api/rsi/tasks',pageToken,{...input,requestId:'invalid-sha',baselineCommit:'abc'});
  expect(invalid.status).toBe(400);expect(invalid.body).toMatchObject({error:{details:{field:'baselineCommit',reason:'full_commit_required'}}});
  const absent=await call('POST','/api/rsi/tasks',pageToken,{...input,requestId:'invalid-path',repository:join(root,'absent')});
  expect(absent.status).toBe(400);expect(absent.body).toMatchObject({error:{details:{field:'repository',reason:'path_not_found'}}});
  const settings={optimizerSessionTokens:1234,optimizerSessionTimeoutMs:30000,allowUnmeteredOptimizer:true,concurrency:2};
  expect((await call('POST','/api/rsi/tasks',pageToken,{...input,requestId:'settings',settings})).status).toBe(202);
  expect(JSON.parse(await readFile(join(root,'task-settings/private/runtime.json'),'utf8'))).toMatchObject(settings);
  for(const settings of [{apiKey:'private-marker'},{concurrency:33},{allowUnmeteredOptimizer:'yes'}])expect((await call('POST','/api/rsi/tasks',pageToken,{...input,requestId:'bad-settings',settings})).status).toBe(400);
  const verify=await call('GET','/api/rsi/tasks/task-create/ledger/verify',pageToken);expect(verify.status).toBe(200);expect(verify.body).toMatchObject({valid:true,anchored:true,issues:[]});
  const {appendFile}=await import('node:fs/promises');await appendFile(join(root,'task-create/ledger.jsonl'),'broken\n');
  const broken=await call('GET','/api/rsi/tasks/task-create/ledger/verify',pageToken);expect(broken.status).toBe(200);expect(broken.body.valid).toBe(false);expect((broken.body.issues as unknown[]).length).toBeGreaterThan(0);
  await rm(join(root,'task-create/ledger.jsonl'));const missing=await call('GET','/api/rsi/tasks/task-create/ledger/verify',pageToken);expect(missing.status).toBe(200);expect(missing.body).toMatchObject({valid:false,entryCount:0,issues:[{code:'tail_truncated',line:1}]});
});
