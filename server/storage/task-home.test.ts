import Database from 'better-sqlite3';
import { beforeEach,afterEach,expect,it } from 'vitest';
import { initSchema } from './schema.js';
import { listTaskHome,taskKpis } from './task-home.js';
import { getTask } from './task-workbench.js';
import { DEFAULT_ALERT_THRESHOLDS } from '../../src/core/task-alerts.js';
let db:Database.Database,queries:string[];
beforeEach(()=>{queries=[];db=new Database(':memory:',{verbose:sql=>queries.push(String(sql))});initSchema(db);});
afterEach(()=>{db.close();});
function seed(n=60){
  const insert=db.prepare(`INSERT INTO sessions(id,provider,source_agent,source_path,started_at,updated_at,detail_loaded,token_input,token_output,token_cache_read,token_cache_write,primary_model,cost_source,cost_usd,cost_currency,total_duration_ms,duration_source,status) VALUES(?,?,'Codex','/not-read',?,?,1,60,20,30,0,'test-model','reported',?,'USD',?,'derived',?)`);
  const event=db.prepare(`INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status,input_len,output_len) VALUES(?, ?, ?, 'tool','implement',? ,?, ?, ?)`);
  db.transaction(()=>{for(let i=0;i<n;i++){const id='s'+i;insert.run(id,i%2?'claude':'codex',new Date(Date.now()-i*60000).toISOString(),new Date().toISOString(),i,i*1000,i%2?'success':'error');event.run(id,'call',0,new Date().toISOString(),'success',10,0);event.run(id,'result',1,new Date().toISOString(),i%2?'success':'error',0,10);}})();
}
it('provides global sorting/filtering before bounded paging, preserves Phase A metrics and never reads bodies',async()=>{
 seed();const page=await listTaskHome(db,{summary:true,sort:'errors',limit:50},DEFAULT_ALERT_THRESHOLDS);
 expect(page.items).toHaveLength(50);expect(page.total).toBe(60);expect(page.hasMore).toBe(true);
 expect(page.items[0]!.metrics).toEqual(getTask(db,page.items[0]!.id).metrics);
 expect(page.items[0]!.metrics).toMatchObject({toolCalls:1,errors:1,toolResults:1,toolFailures:1,correctedTotal:110});
 const high=await listTaskHome(db,{sort:'cacheHitRate',limit:1},DEFAULT_ALERT_THRESHOLDS);expect(high.items[0]!.id).toBe('collected:s0');
 const low=await listTaskHome(db,{sort:'cacheHitRate',direction:'asc',offset:1,limit:1},DEFAULT_ALERT_THRESHOLDS);expect(low.items[0]!.id).toBe('collected:s10');
 expect((await listTaskHome(db,{provider:'claude',errors:true},DEFAULT_ALERT_THRESHOLDS)).total).toBe(0);
 expect((await listTaskHome(db,{failed:true},DEFAULT_ALERT_THRESHOLDS)).total).toBe(30);
 expect((await listTaskHome(db,{toolFailures:true},DEFAULT_ALERT_THRESHOLDS)).total).toBe(30);
 await expect(listTaskHome(db,{limit:51},DEFAULT_ALERT_THRESHOLDS)).rejects.toThrow('pagination');
 const reads=queries.filter(q=>q.startsWith('SELECT')||q.startsWith('WITH'));expect(reads.some(q=>/input_summary|output_summary|event_raw|source_path/.test(q))).toBe(false);
});
it('skips aggregation/count reads on unchanged revision; writes and prices invalidate; cold50<200ms warm<50ms',async()=>{
 seed(50);let start=performance.now();await listTaskHome(db,{},DEFAULT_ALERT_THRESHOLDS);expect(performance.now()-start).toBeLessThan(200);
 queries.length=0;start=performance.now();const warm=await listTaskHome(db,{},DEFAULT_ALERT_THRESHOLDS);expect(performance.now()-start).toBeLessThan(50);expect(warm.items).toHaveLength(50);
 expect(queries.every(q=>q.includes('data_version')||q.includes('total_changes'))).toBe(true);
 db.prepare("UPDATE sessions SET token_input=70 WHERE id='s0'").run();expect((await listTaskHome(db,{q:'s0'},DEFAULT_ALERT_THRESHOLDS)).items[0]!.metrics!.correctedTotal).toBe(120);

});
it('preserves unknown values, partitions currencies and estimated/report provenance, defaults off and alerts only from eligible data',async()=>{
 seed(3);db.prepare("UPDATE sessions SET token_cache_write=10 WHERE id='s1'").run();db.prepare("UPDATE sessions SET cost_source='unknown',primary_model='unknown-model',detail_loaded=0 WHERE id='s0'").run();
 db.prepare("UPDATE sessions SET cost_currency='CNY' WHERE id='s1'").run();
 db.prepare("UPDATE sessions SET cost_source='unknown' WHERE id='s2'").run();
 const page=await listTaskHome(db,{sort:'tokens'},DEFAULT_ALERT_THRESHOLDS);expect(page.items.at(-1)!.id).toBe('collected:s0');expect(page.items.at(-1)!.metrics).toMatchObject({correctedTotal:null,errors:null,cacheHitRate:null});
 expect(page.items.find(t=>t.id==='collected:s2')!.metrics!.cacheHitRate).toBeCloseTo(1/3);
 expect((await listTaskHome(db,{alerts:true},DEFAULT_ALERT_THRESHOLDS)).total).toBe(0);
 const limits={...DEFAULT_ALERT_THRESHOLDS,errors:0,toolFailurePct:20,tokens:100};
 const alerted=await listTaskHome(db,{alerts:true},limits);expect(alerted.total).toBe(2);expect(alerted.items.find(t=>t.id==='collected:s2')!.alerts).toContainEqual({rule:'toolFailurePct',threshold:20,actual:100});
 const k=await taskKpis(db,limits);expect(k).toMatchObject({tasks:3,failedTasks:2,alerts:2,toolFailurePct:50,tokenKnownTasks:2});expect(k.cacheHitRate).toBeCloseTo(60/190);
});
it('counts only terminal tool results and uses per-LLM context windows; unknown windows do not trigger',async()=>{
 seed(1);
 const event=db.prepare(`INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status,model,tokens_json) VALUES('s0',?,?,'llm','implement',?,'success',?,?)`);
 event.run('llm',2,new Date().toISOString(),'claude-haiku-4-5',JSON.stringify({input:120000,cacheRead:60000,cacheWrite:0}));
 event.run('unknown',3,new Date().toISOString(),'no-window',JSON.stringify({input:99999}));
 const t=(await listTaskHome(db,{}, {...DEFAULT_ALERT_THRESHOLDS,contextPressurePct:80})).items[0]!;
 expect(t.metrics!.contextPressurePct).toBe(90);expect(t.alerts).toEqual([{rule:'contextPressurePct',threshold:80,actual:90}]);
 for(const sql of ["SELECT COUNT(1) FROM events INDEXED BY idx_events_task_results WHERE session_id='s0' AND kind='tool' AND output_len>0 AND status IN ('success','error')","SELECT model,tokens_json FROM events INDEXED BY idx_events_task_context WHERE session_id='s0' AND kind='llm'"]){const plan=JSON.stringify(db.prepare('EXPLAIN QUERY PLAN '+sql).all());expect(plan).toContain('COVERING INDEX');expect(plan).not.toContain('SCAN events');}
});
it('keeps partial member usage and reported currencies identical to selected context, retaining unlinked members',async()=>{
 seed(2);db.prepare("UPDATE sessions SET token_input=0,detail_loaded=0,cost_source='unknown' WHERE id='s1'").run();
 const when=new Date().toISOString();db.prepare('INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES(?,?,?,?,?)').run('run','codex','native-root',when,when);
 const agent=db.prepare('INSERT INTO team_agents(id,run_id,native_id,display_name,role_class,session_keys_json) VALUES(?,?,?,?,?,?)');
 agent.run('a-root','run','native-root','Main','leader','["s0"]');agent.run('a-child','run','child','Ada','subagent','["s1"]');agent.run('a-missing','run','missing','Missing','subagent','[]');
 const page=await listTaskHome(db,{},DEFAULT_ALERT_THRESHOLDS);expect(page.total).toBe(1);expect(page.items[0]!.memberCount).toBe(3);
 const list=page.items[0]!.metrics!,context=getTask(db,'collected:s0').metrics!;
 expect(list).toMatchObject({correctedTotal:110,cacheHitRate:1/3,toolCalls:null,errors:null});expect(list.correctedTotal).toBe(context.correctedTotal);expect(list.cacheHitRate).toEqual(context.cacheHitRate);
 expect(list.coverage!.correctedTotal).toMatchObject({known:1,total:3});expect(list.coverage!.correctedTotal.missing).toHaveLength(1);expect(context.coverage!.correctedTotal.missing).toHaveLength(2);
});
it('Phase C resolves child sessions to root tasks in one batch and reuses the Phase B summary unchanged',async()=>{
 const {taskComparisonSnapshot}=await import('./task-home.js');seed(3);
 const when=new Date().toISOString();db.prepare('INSERT INTO team_runs(id,provider,native_run_id,updated_at,stamp) VALUES(?,?,?,?,?)').run('run','codex','native-root',when,when);
 const insert=db.prepare('INSERT INTO team_agents(id,run_id,native_id,display_name,role_class,session_keys_json) VALUES(?,?,?,?,?,?)');
 insert.run('root','run','native-root','Main','leader','["s0"]');insert.run('child','run','child','Ada','subagent','["s1"]');
 const result=await taskComparisonSnapshot(db,['collected:s1'],['collected:s2'],DEFAULT_ALERT_THRESHOLDS);
 expect(result.a[0]!.id).toBe('collected:s0');expect(result.a[0]!.metrics).toEqual((await listTaskHome(db,{},DEFAULT_ALERT_THRESHOLDS)).items.find(t=>t.id==='collected:s0')!.metrics);
 await expect(taskComparisonSnapshot(db,['collected:s0'],['collected:s1'],DEFAULT_ALERT_THRESHOLDS)).rejects.toThrow('distinct root tasks');
 await expect(taskComparisonSnapshot(db,['collected:missing'],['collected:s2'],DEFAULT_ALERT_THRESHOLDS)).rejects.toThrow('Task not found');
});
