import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach,describe,it,expect } from 'vitest';
import { RSI_SCHEMA_SQL } from '../storage/schema.js';
import { defaultRsiConfig } from '../../src/core/rsi-validation.js';
import { RsiStore } from './queue.js';
import { issueAgentSession,revokeAgentSession,consecutiveNoSubmissions,selfReportedTokens,runOptimizerSession,stopOptimizer,IdleWatch,sessionEndReason,captureProcesses,agentOutputTail } from './optimizer-session.js';
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
    await store.put({event:'task_put',payload:{id:'task',repository:'local',baselineCommit:'a'.repeat(40),datasetHash:'b'.repeat(64),mainMetric:'passed_count',config:defaultRsiConfig(),state:'created',pauseReason:null,delta:null,baselineTrainScore:null,baselineSealedScore:null,sealedQueriesUsed:0,tokenUsage:0,iterationCount:0,monitorCalibration:null,currentParentId:null,taskTokenHash:'c'.repeat(64),createdAt:at,updatedAt:at}},'human');
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
  const calls:string[][]=[],recording:DockerClient={run:async(argv,options)=>{calls.push(argv);return client.run(argv,options);}};
  await importSessionBundle({root} as RsiStore,recording,s,'request',commit);
  // A shallow clone cannot bundle everything: only what is new on top of the parent the mirror already has.
  const bundled=calls.find(argv=>argv.includes('bundle'))!;expect(bundled).toContain(`^${baseline}`);expect(bundled).not.toContain('--all');
  expect((await git(['--git-dir',mirror,'rev-parse',commit])).toString().trim()).toBe(commit);
  expect((await git(['--git-dir',mirror,'config','core.hooksPath'])).toString().trim()).toBe('/dev/null');
  await importSessionBundle({root} as RsiStore,{run:async()=>{throw new Error('durable import must be reused');}},s,'request',commit);
  await expect(importSessionBundle({root} as RsiStore,client,s,'other-request',commit)).rejects.toThrow('identity changed');
});
const exited=(code:number)=>({code,stdout:Buffer.from('true'),stderr:Buffer.alloc(0),timedOut:false,cancelled:false,overflow:false});
it('gives a killed optimizer process time to finish exiting on a busy machine',async()=>{
  let checks=0;
  const client:DockerClient={run:async argv=>argv[0]==='inspect'?exited(0):exited(++checks<3?125:0)};
  await stopOptimizer(client,'optimizer',1);
  expect(checks).toBe(3);
});
it('still fails when a process really survives every attempt',async()=>{
  const client:DockerClient={run:async argv=>exited(argv[0]==='inspect'?0:125)};
  await expect(stopOptimizer(client,'optimizer',1)).rejects.toThrow('Optimizer processes did not stop');
});
describe('a hung optimizer ends early and leaves evidence',()=>{
  const watch=(cpu:(number|null)[],limit=1000)=>{let at=0,sampled=0;const w=new IdleWatch(limit,async()=>{sampled++;const value=cpu.shift();return value===undefined?0:value;},()=>at);return{w,move:(ms:number)=>{at+=ms;},samples:()=>sampled};};
  it('needs both no model requests and a quiet CPU across three samples',async()=>{
    const {w,move,samples}=watch([0,1,0]);expect(await w.idle(5)).toBe(false);
    move(999);expect(await w.idle(5)).toBe(false);expect(samples()).toBe(0);
    move(1);expect(await w.idle(5)).toBe(false);move(1000);expect(await w.idle(5)).toBe(false);move(1000);expect(await w.idle(5)).toBe(true);expect(samples()).toBe(3);
  });
  it('a new model request restarts the window and forgets earlier quiet samples',async()=>{
    const {w,move}=watch([0,0,0,0,0]);await w.idle(1);move(1000);await w.idle(1);move(1000);await w.idle(1);
    move(1000);expect(await w.idle(2)).toBe(false);move(999);expect(await w.idle(2)).toBe(false);
    move(1);expect(await w.idle(2)).toBe(false);move(1000);expect(await w.idle(2)).toBe(false);move(1000);expect(await w.idle(2)).toBe(true);
  });
  it('leaves a busy process such as a long test run alone, and never kills on a failed sample',async()=>{
    const {w,move}=watch([55,null,1.9,1.9,1.9]);await w.idle(1);
    move(1000);expect(await w.idle(1)).toBe(false);move(999);expect(await w.idle(1)).toBe(false);
    move(1);expect(await w.idle(1)).toBe(false);move(1000);expect(await w.idle(1)).toBe(false);move(1000);expect(await w.idle(1)).toBe(false);move(1000);expect(await w.idle(1)).toBe(true);
  });
  it('samples at most every 20 seconds once a long window has passed',async()=>{
    const {w,move,samples}=watch([0,0,0],600000);await w.idle(0);move(600000);await w.idle(0);expect(samples()).toBe(1);move(19999);await w.idle(0);expect(samples()).toBe(1);move(1);await w.idle(0);expect(samples()).toBe(2);
  });
  it('names the one reason a round ended, with a submission beating everything else',()=>{
    const none={action:null,idled:false,timedOut:false,tokenCapped:false,interrupted:false};
    expect(sessionEndReason({...none,action:'submit',idled:true,timedOut:true,tokenCapped:true})).toBe('submitted');
    expect(sessionEndReason({...none,action:'declare_stuck',timedOut:true})).toBe('declared_stuck');
    expect(sessionEndReason({...none,idled:true,timedOut:true})).toBe('idle');expect(sessionEndReason({...none,timedOut:true,tokenCapped:true})).toBe('deadline');
    expect(sessionEndReason({...none,tokenCapped:true,interrupted:true})).toBe('token_limit');expect(sessionEndReason({...none,interrupted:true})).toBe('interrupted');expect(sessionEndReason(none)).toBe('agent_exited');
  });
  const exited=(stdout:string|Buffer,code=0)=>({code,stdout:Buffer.from(stdout),stderr:Buffer.alloc(0),timedOut:false,cancelled:false,overflow:false});
  it('reads processes from the engine, not from inside the container, and redacts session tokens',async()=>{
    const calls:string[][]=[],client:DockerClient={run:async argv=>{calls.push(argv);return exited(argv[0]==='top'?'PID ARGS\n7 opencode --token SECRET-ONE\n':'{"CPUPerc":"0.01%"}');}};
    const v=await captureProcesses(client,'box',['SECRET-ONE']);
    expect(v.processes).toContain('--token [redacted]');expect(v.processes).not.toContain('SECRET-ONE');expect(v.containerStats).toContain('CPUPerc');
    expect(calls.map(c=>c[0]).sort()).toEqual(['stats','top']);expect(calls.flat()).not.toContain('exec');
  });
  it('a failed look at the processes is reported as nothing rather than failing the round',async()=>{
    expect(await captureProcesses({run:async()=>{throw new Error('docker gone');}},'box',[])).toEqual({processes:null,containerStats:null});
    expect(await captureProcesses({run:async()=>exited('',1)},'box',[])).toEqual({processes:null,containerStats:null});
  });
  it('keeps only the tail of the agent output, redacted, and tolerates anything unexpected',async()=>{
    const {packFiles}=await import('./artifacts.js');const big='x'.repeat(200000)+'END token-abc';
    const client=(stdout:Buffer,code=0):DockerClient=>({run:async()=>exited(stdout,code)});
    const tail=await agentOutputTail(client(packFiles(new Map([['agent-output.log',Buffer.from(big)]]))),'box','/tmp/x',['token-abc']);
    expect(tail!.length).toBe(131072-'token-abc'.length+'[redacted]'.length);expect(tail!.endsWith('END [redacted]')).toBe(true);
    expect(await agentOutputTail(client(Buffer.alloc(0),1),'box','/tmp/x',[])).toBeNull();
    expect(await agentOutputTail(client(Buffer.from('not a tar'.repeat(100))),'box','/tmp/x',[])).toBeNull();
    expect(await agentOutputTail(client(packFiles(new Map([['a',Buffer.from('1')],['b',Buffer.from('2')]]))),'box','/tmp/x',[])).toBeNull();
    expect(await agentOutputTail({run:async()=>{throw new Error('gone');}},'box','/tmp/x',[])).toBeNull();
  });
});
