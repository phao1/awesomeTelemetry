import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach,it,expect } from 'vitest';
import { RSI_SCHEMA_SQL } from '../storage/schema.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { RsiStore } from './queue.js';
import { issueAgentSession,revokeAgentSession,consecutiveNoSubmissions,selfReportedTokens,runOptimizerSession } from './optimizer-session.js';
import { defaultWorkerSettings } from './cli.js';
import { readOptimizerProfile } from './optimizer-profile.js';
import type { DockerClient } from './docker.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('stores only session digest, mode0600, and revokes idempotently',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rsi-token-'));dirs.push(root);
  const token=await issueAgentSession(root,'session',1000),file=join(root,'private/agent-session.json'),text=await readFile(file,'utf8');
  expect(text).not.toContain(token);expect(JSON.parse(text).tokenHash).toHaveLength(64);expect((await stat(file)).mode&0o777).toBe(0o600);
  await revokeAgentSession(root);await revokeAgentSession(root);await expect(readFile(file)).rejects.toHaveProperty('code','ENOENT');
});
it('parses only native usage counters and returns null for missing/invalid evidence',async()=>{
  const input=(lines:unknown[])=>new Map([['session.jsonl',Buffer.from(lines.map(v=>JSON.stringify(v)).join('\n'))]]);
  expect(await selfReportedTokens(input([{payload:{type:'token_count',info:{total_token_usage:{total_tokens:10}}}},{payload:{type:'token_count',info:{total_token_usage:{total_tokens:30}}}}]),'openai')).toBe(30);
  const m={message:{id:'one',usage:{input_tokens:4,output_tokens:3,cache_read_input_tokens:2}}};
  expect(await selfReportedTokens(input([m,m,{message:{id:'two',usage:{output_tokens:1}}}]),'anthropic')).toBe(10);
  expect(await selfReportedTokens(input([{tokens:99999}]),'openai')).toBeNull();
});
it('counts only consecutive no_submission/timeout, not stuck/interrupted or scored attempts',()=>{
  const samples=['submitted','no_submission','timeout','no_submission'].map((state,i)=>({seq:i+1,state})) as Parameters<typeof consecutiveNoSubmissions>[0];
  expect(consecutiveNoSubmissions(samples)).toBe(3);expect(consecutiveNoSubmissions([...samples,{seq:5,state:'stuck'} as typeof samples[number]])).toBe(0);
});
it('times out during sidecar startup, revokes the bearer and records a durable timeout',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rsi-timeout-'));dirs.push(root);const db=new Database(':memory:');db.exec(RSI_SCHEMA_SQL);const store=new RsiStore(db,root,'task'),at=new Date().toISOString();
  try{
    await store.put({event:'task_put',payload:{id:'task',repository:'local',baselineCommit:'a'.repeat(40),datasetHash:'b'.repeat(64),mainMetric:'passed_count',config:defaultRsiConfig(),state:'created',pauseReason:null,delta:null,baselineTrainScore:null,baselineSealedScore:null,sealedQueriesUsed:0,tokenUsage:0,iterationCount:0,currentParentId:null,taskTokenHash:'c'.repeat(64),createdAt:at,updatedAt:at}},'human');
    const client:DockerClient={run:async(argv,options)=>{
      if(argv[0]==='exec'&&argv.includes('node'))await new Promise<void>(resolve=>{if(options?.signal?.aborted)resolve();else options?.signal?.addEventListener('abort',()=>resolve(),{once:true});});
      return{code:options?.signal?.aborted?1:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),timedOut:false,cancelled:options?.signal?.aborted??false,overflow:false};
    }};
    const {profile}=await readOptimizerProfile('rsi-agents/optimizers/scripted/profile.json');
    await expect(runOptimizerSession(store,client,profile,'image',{...defaultWorkerSettings(),proxy:{...defaultWorkerSettings().proxy,mode:'mock'},optimizerSessionTimeoutMs:15},async()=>{})).rejects.toThrow();
    expect(store.list('session_put')[0]!.state).toBe('timeout');await expect(readFile(join(root,'private/agent-session.json'))).rejects.toHaveProperty('code','ENOENT');
    expect((await readFile(store.ledgerPath,'utf8'))).not.toContain('tokenHash');
  }finally{db.close();}
});
it('rejects vendor execution unless explicitly enabled, before creating any session/container',async()=>{
  const {profile}=await readOptimizerProfile('rsi-agents/optimizers/codex/profile.json');let calls=0;
  const client={run:async()=>{calls++;throw new Error('must not run');}};
  await expect(runOptimizerSession({} as RsiStore,client,profile,'image',defaultWorkerSettings(),async()=>{})).rejects.toThrow('allowUnmeteredOptimizer');expect(calls).toBe(0);
});
it('imports the actual submitted Git bundle with hooks disabled and verifies its ancestry',async()=>{
  const {git,createMirror}=await import('./build.js');const {packFiles}=await import('./artifacts.js');const {importSessionBundle}=await import('./optimizer-session.js');
  const {mkdir,writeFile}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'rsi-bundle-'));dirs.push(root);const repository=join(root,'source'),mirror=join(root,'private/repository.git');await mkdir(repository);
  await git(['-C',repository,'init','-q']);await writeFile(join(repository,'source.js'),'first\n');await git(['-C',repository,'add','-A']);await git(['-C',repository,'-c','user.name=RSI','-c','user.email=rsi@localhost','commit','-qm','baseline']);
  const baseline=(await git(['-C',repository,'rev-parse','HEAD'])).toString().trim();await mkdir(join(root,'private'));await createMirror(repository,mirror);
  await writeFile(join(repository,'source.js'),'second\n');await git(['-C',repository,'add','-A']);await git(['-C',repository,'-c','user.name=RSI','-c','user.email=rsi@localhost','commit','-qm','candidate']);
  const commit=(await git(['-C',repository,'rev-parse','HEAD'])).toString().trim();const bundle=join(root,'candidate.bundle');await git(['-C',repository,'bundle','create',bundle,'HEAD']);
  const archive=packFiles(new Map([['candidate.bundle',await readFile(bundle)]]));
  const client:DockerClient={run:async argv=>({code:0,stdout:argv.includes('tar')?archive:argv[0]==='inspect'?Buffer.from('node'):argv.includes('id')?Buffer.from('1000'):argv.some(s=>s.startsWith('uid=$(id -u)'))?Buffer.from('/home/node'):Buffer.alloc(0),stderr:Buffer.alloc(0),timedOut:false,cancelled:false,overflow:false})};
  const s={id:'bundle-session',taskId:'task',seq:1,parentId:null,commit:baseline,state:'running' as const,submissionId:null,accounting:'proxy' as const,tokens:null,artifactPath:'artifacts/optimizer/bundle-session',startedAt:new Date().toISOString(),endedAt:null};
  await importSessionBundle({root} as RsiStore,client,s,'request',commit);
  expect((await git(['--git-dir',mirror,'rev-parse',commit])).toString().trim()).toBe(commit);
  expect((await git(['--git-dir',mirror,'config','core.hooksPath'])).toString().trim()).toBe('/dev/null');
  await importSessionBundle({root} as RsiStore,{run:async()=>{throw new Error('durable import must be reused');}},s,'request',commit);
  await expect(importSessionBundle({root} as RsiStore,client,s,'other-request',commit)).rejects.toThrow('identity changed');
});
