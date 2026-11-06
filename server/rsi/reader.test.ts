import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,it,expect } from 'vitest';
import { privateWrite } from './artifacts.js';
import { trajectory,safeArtifact } from './reader.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('pages sanitized UTF8 trajectories within bounds and rejects mid-codepoint offsets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rsi-trajectory-'));dirs.push(root);
 await privateWrite(join(root,'artifacts/run/proxy/responses.jsonl'),JSON.stringify({requestId:'r',assistant:[{index:0,text:'你好世界'.repeat(50),tool_calls:[],privateEvidence:'hidden'}],dictionary:'private'})+'\n');
 let offset=0,content='';let count=0;
 do{const p=await trajectory(root,'artifacts/run',new URLSearchParams({limit:'17',offset:String(offset)}),true);expect(p.content).not.toContain('\uFFFD');expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(1048576);content+=p.content;offset=p.nextOffset??-1;count++;}while(offset>=0);
 expect(count).toBeGreaterThan(2);expect(content).toContain('你好世界');expect(content).not.toContain('hidden');expect(content).not.toContain('dictionary');
 const raw=Buffer.from(content),at=raw.indexOf(Buffer.from('你好'))+1;
 await expect(trajectory(root,'artifacts/run',new URLSearchParams({offset:String(at)}),true)).rejects.toMatchObject({status:400});
 await expect(trajectory(root,'artifacts/run',new URLSearchParams({limit:'65537'}),true)).rejects.toMatchObject({status:400});
});
it('never resolves artifact references outside the trusted root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rsi-artifact-root-'));dirs.push(root);await privateWrite(join(root,'private.json'),'{}');
 await expect(safeArtifact(join(root,'nested'),'../private.json')).rejects.toThrow();
 const empty=await trajectory(root,'artifacts/missing',new URLSearchParams(),true);expect(empty.content).toBe('');expect(empty.nextOffset).toBeNull();
});
it('binds process evidence to the actual iteration submission and returns null for missing traces or another task',async()=>{
 const {createHash}=await import('node:crypto'),{defaultRsiConfig}=await import('../../src/core/rsi-validation.js'),{RsiStore,enqueue}=await import('./queue.js'),{RSI_SCHEMA_SQL}=await import('../storage/schema.js'),{StoredOptimizerSessionReader}=await import('./reader.js');
 const {default:Database}=await import('better-sqlite3');
 const root=await mkdtemp(join(tmpdir(),'rsi-process-reader-'));dirs.push(root);const db=new Database(':memory:');db.exec(RSI_SCHEMA_SQL);const store=new RsiStore(db,root,'task'),at=new Date().toISOString(),commit='a'.repeat(40),prd={observation:'observed',hypothesis:'one cause',changes:['agent.mjs'],expectedImpact:'more passes'};
 try{
  await store.put({event:'task_put',payload:{id:'task',repository:'local',baselineCommit:commit,datasetHash:'b'.repeat(64),mainMetric:'passed_count',config:defaultRsiConfig(),state:'created',pauseReason:null,delta:null,baselineTrainScore:null,baselineSealedScore:null,sealedQueriesUsed:0,tokenUsage:0,iterationCount:0,monitorCalibration:null,currentParentId:null,taskTokenHash:'c'.repeat(64),createdAt:at,updatedAt:at}},'human');
  const session={id:'session',taskId:'task',seq:1,parentId:null,commit,state:'running' as const,submissionId:null,accounting:'proxy' as const,tokens:null,artifactPath:'artifacts/optimizer/session',startedAt:at,endedAt:null};await store.put({event:'session_put',payload:session});
  await enqueue(store,{action:'submit',commit,prd,parentId:null},'optimizer','first');
  await store.put({event:'session_put',payload:{...session,state:'submitted',submissionId:'first',endedAt:at}});
  const iteration={id:createHash('sha256').update('iteration:first').digest('hex'),taskId:'task',seq:1,parentId:null,commit,prd,packageSha256:null,state:'draft' as const,holdReasons:[],resumeState:null,approvals:[],trainScore:null,sealedScore:null,createdAt:at,updatedAt:at};await store.put({event:'iteration_put',payload:iteration},'optimizer');
  const reader=new StoredOptimizerSessionReader(store);expect(await reader.read(iteration)).toBeNull();
  await privateWrite(join(root,session.artifactPath,'proxy/responses.jsonl'),JSON.stringify({requestId:'model',assistant:[{text:'action trace'}]})+'\n');
  await privateWrite(join(root,session.artifactPath,'proxy/last-request.json'),JSON.stringify({messages:[{role:'user',content:'hypothesis'}]}));
  expect(await reader.read(iteration)).toMatchObject({prd,trajectory:expect.stringContaining('action trace')});
  expect(await reader.read({...iteration,taskId:'other'})).toBeNull();expect(await reader.read({...iteration,commit:'d'.repeat(40)})).toBeNull();
 }finally{db.close();}
});
