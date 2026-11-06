import { mkdtemp,rm,writeFile,readFile,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach,describe,it,expect } from 'vitest';
import Database from 'better-sqlite3';
import { RSI_SCHEMA_SQL } from '../storage/schema.js';
import { rebuildRsiIndexFromLedger } from '../storage/rsi.js';
import { RsiStore,now } from './queue.js';
import { createTask,humanCommand,agentCommand,selectedParent } from './commands.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { defaultWorkerSettings } from './cli.js';
import { RsiWorker } from './worker.js';
import type { ExecutionBackend } from './worker.js';
import { createMirror,git,importCommit } from './build.js';
import { brief,optimizerResults,runTrajectory } from './agent-api.js';
import { privateWrite } from './artifacts.js';
import { consecutiveNoSubmissions } from './optimizer-session.js';

const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const privateMarkers=['sealed-secret-question','sealed-score-93212','monitor-private-conclusion','fingerprint-private-dictionary','hidden-private-assertion'];
async function setup(clean=true){
  const root=await mkdtemp(join(tmpdir(),'rsi-commands-'));dirs.push(root);const source=join(root,'source');await mkdir(source);
  const commit=async(message:string)=>{await git(['-C',source,'add','-A']);await git(['-C',source,'-c','user.name=RSI','-c','user.email=rsi@localhost','commit','-qm',message]);return(await git(['-C',source,'rev-parse','HEAD'])).toString().trim();};
  await git(['-C',source,'init','-q']);await writeFile(join(source,'agent.mjs'),'export const value=0;\n');const baseline=await commit('baseline');
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(RSI_SCHEMA_SQL);const store=new RsiStore(db,join(root,'task'),'task');
  const config={...defaultRsiConfig(),targetPassedCount:100,maxIterations:10};const settings=defaultWorkerSettings();
  await createTask(store,{requestId:'create',repository:source,baselineCommit:baseline,bank:resolve('server/rsi/__fixtures__/bank'),agentProfile:resolve('rsi-agents/mini-agent/profile.json'),optimizerProfile:resolve('rsi-agents/optimizers/scripted/profile.json'),config},settings);
  await createMirror(source,join(store.root,'private/repository.git'));
  const bank=await import('./bank.js').then(m=>m.readBank(join(store.root,'private/bank')));
  const backend:ExecutionBackend={prepare:async()=> 'd'.repeat(64),run:async req=>{
    const path=`artifacts/${req.evaluation.iterationId??'baseline'}/${req.runId}`;
    const secret=['smoke','train'].includes(req.evaluation.phase)?'visible transcript':privateMarkers.join(' ');
    await privateWrite(join(store.root,path,'proxy/last-request.json'),JSON.stringify({messages:[{role:'user',content:secret,raw:privateMarkers}],hidden_tests:privateMarkers,truncated:false}));
    await privateWrite(join(store.root,path,'proxy/responses.jsonl'),JSON.stringify({requestId:'request',assistant:[{index:0,text:secret,tool_calls:[],raw:privateMarkers}],unknown:privateMarkers})+'\n');
    return{outcome:req.evaluation.iterationId===null?'fail':'pass',failureReason:req.evaluation.iterationId===null?'test_failed':null,proxyTokens:10,sessionTokens:null,artifactPath:path,sessionPath:null};
  }};
  const worker=new RsiWorker(store,bank,settings,backend,clean?{review:async()=>({monitor:{status:'clean'},adversarial:{status:'clean'}})}:undefined);
  await worker.loadUsage();await worker.run();
  const submit=async(request='candidate')=>{
    await writeFile(join(source,'agent.mjs'),'export const value=1;\n');const candidate=await commit(request);await importCommit(source,join(store.root,'private/repository.git'),candidate);
    await agentCommand(store,request,{action:'submit',commit:candidate,parentId:null,prd:{observation:'misses',hypothesis:'one fix',changes:['agent.mjs'],expectedImpact:'more passes'}});await worker.run();return store.list('iteration_put').at(-1)!;
  };
  return{db,store,worker,submit};
}
describe('human intervention and durable optimizer loop',()=>{
  it('rolls back only the next parent and activates instructions in the next brief',async()=>{
    const {db,store,worker,submit}=await setup();try{
      const i=await submit();expect(i.state).toBe('promoted');
      await humanCommand(store,{action:'rollback',parentId:null,reason:'compare baseline'},'rollback',null);await worker.run();
      expect(selectedParent(store)).toBeNull();expect(store.list('iteration_put')).toHaveLength(1);expect(store.list('iteration_put')[0]!.state).toBe('promoted');
      expect(store.list('decision_put').find(d=>d.actor==='human')).toMatchObject({verdict:'rollback',reason:'compare baseline',iterationId:i.id});
      await humanCommand(store,{action:'instruction',kind:'idea',text:'try a shared parsing rule',effectiveFromSeq:2},'idea',null);await worker.run();
      expect(JSON.stringify(await brief(store))).toContain('try a shared parsing rule');
      await expect(humanCommand(store,{action:'instruction',kind:'idea',text:'too late',effectiveFromSeq:1},'bad-idea',null)).rejects.toThrow();
      await expect(humanCommand(store,{action:'rollback',parentId:'unknown',reason:'bad'},'bad',null)).rejects.toThrow();
    }finally{db.close();}
  });
  it('requires locked complete final before adopt and creates idempotent patch/ref without merging',async()=>{
    const {db,store,worker,submit}=await setup();try{
      const i=await submit();
      const finals=await Promise.allSettled([humanCommand(store,{action:'final',reason:'finalize'},'final',i.id),humanCommand(store,{action:'final',reason:'duplicate'},'final-race',i.id)]);
      expect(finals.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(finals.filter(r=>r.status==='rejected')).toHaveLength(1);
      await worker.run();
      expect(store.list('evaluation_put').some(e=>e.phase==='final'&&e.locked)).toBe(true);
      await humanCommand(store,{action:'adopt',reason:'use result'},'adopt',i.id);await worker.run();
      const patch=await readFile(join(store.root,'artifacts/adopted/1.patch'),'utf8');expect(patch).toContain('+export const value=1');
      expect((await git(['--git-dir',join(store.root,'private/repository.git'),'rev-parse','refs/rsi/adopted/1'])).toString().trim()).toBe(i.commit);
      await humanCommand(store,{action:'adopt',reason:'repeat safely'},'adopt-again',i.id);await worker.run();expect(await readFile(join(store.root,'artifacts/adopted/1.patch'),'utf8')).toBe(patch);
    }finally{db.close();}
  });
  it('restores three no_submission records from the ledger and asks for help',async()=>{
    const {db,store,worker}=await setup();try{
      worker.optimizerSession=async()=>{
        const at=now(),seq=store.list('session_put').length+1,id=`session-${seq}`;
        const s={id,taskId:store.taskId,seq,parentId:null,commit:store.task().baselineCommit,state:'running' as const,submissionId:null,accounting:'proxy' as const,tokens:null,artifactPath:`artifacts/optimizer/${id}`,startedAt:at,endedAt:null};
        await store.put({event:'session_put',payload:s});await store.put({event:'session_put',payload:{...s,state:'no_submission',tokens:0,endedAt:now()}});
      };
      await worker.run();expect(store.task().state).toBe('needs_help');expect(consecutiveNoSubmissions(store.list('session_put'))).toBe(3);
      await rebuildRsiIndexFromLedger(db,store.taskId,store.ledgerPath);expect(store.list('session_put')).toHaveLength(3);
      await humanCommand(store,{action:'set_target',targetPassedCount:50,reason:'relax target'},'target',null);await worker.run();expect(store.task().config.targetPassedCount).toBe(50);
    }finally{db.close();}
  });
  it('allows only first submission in one session and preserves exact idempotency',async()=>{
    const {db,store}=await setup();try{
      const at=now();await store.put({event:'session_put',payload:{id:'session',taskId:store.taskId,seq:1,parentId:null,commit:store.task().baselineCommit,state:'running',submissionId:null,accounting:'proxy',tokens:null,artifactPath:'artifacts/optimizer/session',startedAt:at,endedAt:null}});
      const command={action:'submit' as const,commit:'d'.repeat(40),parentId:null,prd:{observation:'x',hypothesis:'y',changes:['agent.mjs'],expectedImpact:'z'}};
      const q=await agentCommand(store,'first',command);expect((await agentCommand(store,'first',command)).id).toBe(q.id);
      await expect(agentCommand(store,'second',command)).rejects.toThrow();await expect(agentCommand(store,'first',{...command,commit:'e'.repeat(40)})).rejects.toThrow();
    }finally{db.close();}
  });
  it('projects every optimizer view and trajectory without private phase/evidence/dictionary/test leakage',async()=>{
    const {db,store,submit}=await setup(false);try{
      const i=await submit();await store.put({event:'finding_put',payload:{id:'private-finding',taskId:store.taskId,iterationId:i.id,level:'L4',category:'suspicious',severity:'hold',source:'monitor',file:null,line:null,evidence:privateMarkers.join(' '),at:now()}});
      const responses=[await brief(store),await optimizerResults(store,'1',new URLSearchParams())];
      for(const r of store.list('run_put')){
        const e=store.list('evaluation_put').find(e=>e.id===r.evaluationId)!;
        for(const file of ['responses','last-request']){
          if(['smoke','train'].includes(e.phase))responses.push(await runTrajectory(store,r.id,new URLSearchParams({file}),true));
          else await expect(runTrajectory(store,r.id,new URLSearchParams({file}),true)).rejects.toMatchObject({status:404});
        }
      }
      const all=JSON.stringify(responses);for(const marker of privateMarkers)expect(all).not.toContain(marker);
      for(const e of store.list('evaluation_put').filter(e=>e.phase==='sealed'))for(const id of e.questionIds)expect(all).not.toContain(id);
      expect(all).not.toContain(store.task().taskTokenHash);expect(all).toContain('visible transcript');expect(all).not.toContain('artifactPath');
    }finally{db.close();}
  });
});
