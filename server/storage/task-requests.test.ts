import Database from 'better-sqlite3';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { initSchema } from './schema.js';
import { getTask, taskRecords } from './task-workbench.js';
import { taskRequests } from './task-requests.js';
import { collectTaskHealth } from '../task-health/collector.js';
import { validateHealthRequest } from '../http/task-health-routes.js';
let db:Database.Database;
const at=(n:number)=>new Date(Date.parse('2026-10-30T00:00:00.000Z')+n*1000).toISOString();
beforeEach(()=>{db=new Database(':memory:');initSchema(db);db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('root','codex','Codex','Root',?,?,'/fixture/missing',1)").run(at(0),at(100));});
afterEach(()=>db.close());
function add(n:number,kind='tool',session='root',title='Read',tokens:string|null=null){
  db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,duration_ms,status,actor,input_len,output_len,tokens_json) VALUES(?,?,?,?,?,?,?,0,?,?,1,1,?)').run(session,'e'+n,n,kind,'implement',title,at(n),n===3?'error':'success','Codex',tokens);
}
const context=()=>getTask(db,'collected:root');
it('splits multiple prompts, preserves stable record-derived IDs and first-line redaction',async()=>{
  add(1,'user_prompt','root','Fix password=SECRET\nSecond line');add(2);add(4,'user_prompt','root','Release rc3');add(5);
  const list=await taskRequests(db,context());expect(list.items.map(r=>r.eventCount)).toEqual([2,2]);
  expect(list.items[0]!.title).not.toContain('SECRET');expect(list.items[0]!.title).not.toContain('Second line');
  expect(list.items[0]!.id).toBe('request:root:event:e1');add(6);
  expect((await taskRequests(db,context())).items[0]!.id).toBe(list.items[0]!.id);
});
it('returns one request for one genuine prompt and none when only bookkeeping exists',async()=>{
  add(0,'system');add(1,'user_prompt','root','<system-reminder>injected</system-reminder>');add(2,'subagent_prompt');
  expect((await taskRequests(db,context())).items).toEqual([]);add(3,'user_prompt','root','Real question');add(4);
  expect((await taskRequests(db,context())).items.map(r=>r.eventCount)).toEqual([2]);
});
it('excludes bookkeeping markers from boundaries without discarding their activity',async()=>{
  add(1,'user_prompt','root','Real');add(2,'user_prompt','root','task_started');add(3,'user_prompt','root','token_count');
  expect((await taskRequests(db,context())).items.map(r=>r.eventCount)).toEqual([3]);
});
it('assigns child activity by time and never opens requests on child prompts',async()=>{
  add(1,'user_prompt');add(4,'user_prompt');
  db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('child','codex','Codex','child',?,?,'/missing',1)").run(at(0),at(100));
  const c=context();c.members.push({id:'child',name:'child',role:'subagent',sessionKey:'child',parentId:'root',detailLoaded:true,eventCount:2});c.task.memberCount=2;
  add(2,'user_prompt','child');add(5,'tool','child');
  expect((await taskRequests(db,c)).items.map(r=>r.eventCount)).toEqual([2,2]);
});
it('aggregates incremental usage with Phase A corrected accounting and unknown cost',async()=>{
  add(1,'user_prompt');add(2,'llm','root','answer',JSON.stringify({input:10,output:20,reasoning:5,cacheRead:30,cacheWrite:0}));add(3,'llm','root','answer',JSON.stringify({input:10,output:20,cacheRead:30,cacheWrite:0}));
  const r=(await taskRequests(db,context())).items[0]!;
  expect(r.metrics).toMatchObject({input:20,output:40,cacheRead:60,correctedTotal:120,errors:1,costUsd:null});expect(r.metrics.coverage!.correctedTotal).toMatchObject({known:1,total:1});
});
it('filters before trajectory pagination and binds the opaque page window to request',()=>{
  add(1,'user_prompt');for(let n=2;n<8;n++)add(n);add(8,'user_prompt');add(9);
  const c=context(),id='request:root:event:e1';const page=taskRecords(db,c,{request:id,offset:0,limit:3});
  expect(page.total).toBe(7);expect(page.items.map(r=>r.event!.sequence)).toEqual([1,2,3]);
  expect(taskRecords(db,c,{request:id,offset:3,limit:3,window:page.window}).items.map(r=>r.event!.sequence)).toEqual([4,5,6]);
  expect(()=>taskRecords(db,c,{request:'request:root:event:e8',window:page.window})).toThrow('scope mismatch');
  expect(()=>taskRecords(db,c,{request:'request:foreign:event:e1'})).toThrow('Invalid task request');
});
it('collects request scope before event limits and preserves a stable reuse scope',async()=>{
  add(1,'user_prompt');add(2);add(4,'user_prompt');add(5);
  const id='request:root:event:e4';const a=await collectTaskHealth(db,'collected:root',{member:'all',from:null,to:null,request:id});
  expect(a.records.map(r=>r.event!.sequence)).toEqual([4,5]);expect(a.t0).toBe(at(4));expect(a.scope).toEqual({member:'all',from:at(4),to:null,request:id});
  const b=await collectTaskHealth(db,'collected:root',{member:'all',from:null,to:null,request:id});expect(b.scope).toEqual(a.scope);
  const prior=await collectTaskHealth(db,'collected:root',{member:'all',from:null,to:null,request:'request:root:event:e1'});expect(prior.records.map(r=>r.event!.sequence)).toEqual([1,2]);
});
it('validates request health scope strictly and retains legacy scope shape',()=>{
  expect(validateHealthRequest({mode:'standard',member:'all',scope:'request',request:'request:root:event:e1'},new URLSearchParams()).scope.request).toBe('request:root:event:e1');
  for(const body of [{member:'main',scope:'request',request:'x'},{member:'all',scope:'request'},{member:'all',request:'x'},{member:'all',scope:'request',request:'x',from:at(0),to:at(1)}])expect(()=>validateHealthRequest({mode:'standard',...body},new URLSearchParams())).toThrow();
  expect(validateHealthRequest({mode:'standard',member:'all'},new URLSearchParams()).scope).toEqual({member:'all',from:null,to:null});
});
it('25,000-event perf: indexed pages, revision cache and late-request collection',async()=>{
  const insert=db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,duration_ms,status,actor,input_len) VALUES('root',?,?,?,'implement',?,?,0,'success','Codex',1)");
  db.transaction(()=>{for(let n=0;n<25000;n++)insert.run('e'+n,n,n%5000===0?'user_prompt':'tool','record',at(n));})();
  const histogram=monitorEventLoopDelay({resolution:1});histogram.enable();await delay(5);
  const c=context(),start=performance.now(),value=await taskRequests(db,c),cold=performance.now()-start;
  const warmStart=performance.now();expect((await taskRequests(db,c)).revision).toBe(value.revision);const warm=performance.now()-warmStart;
  expect(value.items.map(r=>r.eventCount)).toEqual([5000,5000,5000,5000,5000]);expect(cold).toBeLessThan(250);expect(warm).toBeLessThan(20);
  await delay(5);histogram.disable();expect(histogram.count).toBeGreaterThan(0);expect(histogram.percentile(99)/1e6).toBeLessThan(50);
  console.info('[request perf]',JSON.stringify({events:25000,coldMs:cold,warmMs:warm,loopP99Ms:histogram.percentile(99)/1e6}));
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id,sequence,started_at,kind FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 200').all('root',-1);expect(JSON.stringify(plan)).toContain('idx_events_session_seq');expect(JSON.stringify(plan)).not.toContain('SCAN events');
  const input=await collectTaskHealth(db,c.task.id,{member:'all',from:null,to:null,request:value.items[4]!.id});expect(input.records).toHaveLength(5000);expect(input.limits).not.toContain('events');
});
it('uses root sequence to disambiguate equal-clock prompts consistently across summaries, pages and health',async()=>{
  add(1,'user_prompt');add(2);add(3,'user_prompt');add(4);
  db.prepare('UPDATE events SET started_at=?').run(at(1));
  const c=context(),list=await taskRequests(db,c);expect(list.items.map(r=>r.eventCount)).toEqual([2,2]);
  for(const r of list.items){
    const page=taskRecords(db,c,{request:r.id,offset:0});expect(page.total).toBe(r.eventCount);
    const input=await collectTaskHealth(db,c.task.id,{member:'all',from:null,to:null,request:r.id});expect(input.records.map(r=>r.recordId)).toEqual(page.items.map(r=>r.id));
  }
});
it('keeps the retained timeline inside request membership',async()=>{
  const {getTaskTimeline}=await import('./task-workbench.js');add(1,'user_prompt');add(2);add(5,'user_prompt');add(6);
  const c=context(),page=taskRecords(db,c,{request:'request:root:event:e1',offset:0});
  const timeline=getTaskTimeline(db,c,'main',page.window);expect(timeline.total).toBe(2);expect(timeline.from).toBe(at(1));expect(timeline.lanes[0]!.total).toBe(2);
});
it('invalidates a yielding metadata snapshot on concurrent source writes',async()=>{
  add(1,'user_prompt');add(2);const pending=taskRequests(db,context());add(3);
  await expect(pending).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  expect((await taskRequests(db,context())).items[0]!.eventCount).toBe(3);
});
it('d01f 15-message sequence opens exactly eight requests and goal continuation never becomes a title',async()=>{
  const {D01F_USER_MESSAGES,D01F_QUESTION_POSITIONS}=await import('../../src/core/__fixtures__/user-prompts.js');
  D01F_USER_MESSAGES.forEach((text,i)=>add(i+1,'user_prompt','root',text.split('\n')[0]!));
  for(let n=16;n<91;n++)add(n,'user_prompt','root','<codex_internal_context source="goal">Continue</codex_internal_context>');
  const list=await taskRequests(db,context());
  expect(list.items.map(r=>r.id)).toEqual(D01F_QUESTION_POSITIONS.map(n=>'request:root:event:e'+n));
  expect(list.items.map(r=>r.title)).toEqual(D01F_QUESTION_POSITIONS.map(n=>D01F_USER_MESSAGES[n-1]!.split('\n')[0]));
  expect(list.items.at(-1)!.eventCount).toBe(77);expect(list.items.some(r=>r.title.startsWith('<')||r.title.startsWith('# AGENTS.md'))).toBe(false);
  const input=await collectTaskHealth(db,context().task.id,{member:'all',from:null,to:null});expect(input.t0).toBe(at(3));
});
it('extracts attached-file request titles without altering IDs, boundaries, events or original stored titles',async()=>{
  const {requestBoundaries}=await import('./task-requests.js');
  const header='# Files mentioned by the user:';
  add(1,'user_prompt','root',header);add(2);add(3,'user_prompt','root',header);add(4);
  const update=db.prepare('UPDATE events SET input_summary=? WHERE session_id=? AND id=?');
  update.run(header+'\n## private.ts: /private/private.ts\n```\nFILE_BODY_SECRET\n```\n## My request for Codex:\n修复 password=TOP_SECRET 导致的问题\n第二行','root','e1');
  update.run(header+'\n## one.ts: /private/one.ts\nFILE_BODY_SECRET\n## two.ts: /private/two.ts\nANOTHER_FILE_SECRET','root','e3');
  const c=context(),before=requestBoundaries(db,c),list=await taskRequests(db,c);
  expect(list.items).toHaveLength(2);expect(list.items.map(r=>r.id)).toEqual(['request:root:event:e1','request:root:event:e3']);
  expect(list.items[0]!.title).toContain('修复');expect(list.items[0]!.title).not.toContain('TOP_SECRET');expect(list.items[1]!.title).toBe('附带文件的提问（2 个文件）');
  expect(JSON.stringify(list)).not.toMatch(/FILE_BODY_SECRET|ANOTHER_FILE_SECRET|private\.ts|\/private\/|inputSummary|outputSummary/);
  expect(list.items.map(r=>r.eventCount)).toEqual([2,2]);expect(requestBoundaries(db,c)).toEqual(before);
  expect(db.prepare('SELECT title FROM events WHERE session_id=? AND id=?').get('root','e1')).toEqual({title:header});
  expect((await taskRequests(db,c)).items.map(r=>r.title)).toEqual(list.items.map(r=>r.title));
});
