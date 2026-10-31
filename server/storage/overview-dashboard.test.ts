import Database from 'better-sqlite3';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {initSchema} from './schema.js';
import {overviewDashboard,overviewPoint} from './overview-dashboard.js';
import {DEFAULT_ALERT_THRESHOLDS} from '../../src/core/task-alerts.js';
import type {TaskSummary} from '../../src/core/task-types.js';
let db:Database.Database;
const now=Date.parse('2026-11-01T12:00:00.000Z');
beforeEach(()=>{db=new Database(':memory:');initSchema(db);});afterEach(()=>db.close());
function insert(id:string,start:string,provider='codex',status='success') {
 db.prepare(`INSERT INTO sessions(id,provider,source_agent,source_path,title,started_at,updated_at,status,detail_loaded,token_input,token_output,token_cache_read,token_cache_write,primary_model) VALUES(?,?,?,'/never-read',?,?,?, ?,1,60,20,30,10,'model')`).run(id,provider,provider,id,start,start,status);
}
it('uses UTC activity dates, weighted cache and corrected Token rather than session token_total',async()=>{
 insert('current','2026-11-01T01:00:00.000Z');insert('previous','2026-10-24T01:00:00.000Z');
 db.prepare("UPDATE sessions SET token_total=999999 WHERE id='current'").run();
 db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status,tool,output_len) VALUES('current','r',0,'tool','implement','2026-11-01T02:00:00.000Z','error','read',2)").run();
 db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status,tool,output_len) VALUES('current','pending',1,'tool','implement','2026-11-01T02:00:00.000Z','error','read',0)").run();
 const value=await overviewDashboard(db,{...DEFAULT_ALERT_THRESHOLDS,errors:0},'7d','',now);
 expect(value.current).toMatchObject({tasks:1,tokens:120,cacheHitRate:0.3,cacheWrite:10,toolFailurePct:100,alerts:1});
 expect(value.daily).toHaveLength(7);expect(value.daily.at(-1)!.day).toBe('2026-11-01T00:00:00.000Z');expect(value.previous!.tasks).toBe(1);
 expect(value.tools).toEqual([{tool:'read',failures:1,results:1}]);expect(value.models).toEqual([{label:'model',value:120}]);expect(value.alerts[0]!.id).toBe('collected:current');
 expect(JSON.stringify(value)).not.toMatch(/raw|inputSummary|outputSummary|999999|never-read|costUsd/);
});
it('keeps missing counters unavailable, adds continuous empty slots, and filters provider before aggregation',async()=>{
 insert('codex','2026-11-01T01:00:00.000Z');insert('claude','2026-10-31T01:00:00.000Z','claude');db.prepare("UPDATE sessions SET token_input=0,token_output=0,token_cache_read=0,token_cache_write=0 WHERE id='codex'").run();
 const value=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'24h','codex',now);
 expect(value.current).toMatchObject({tasks:1,tokens:null,cacheHitRate:null,cacheWrite:null});expect(value.providers.map(p=>p.label)).toEqual(['claude','codex']);expect(value.daily).toHaveLength(2);
 const empty=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'all','missing',now);expect(empty.current.tasks).toBe(0);expect(empty.current.tokens).toBeNull();expect(empty.daily).toEqual([]);expect(empty.previous).toBeNull();
});
it('has revision/threshold/time scoped bounded cache, isolates DBs, and never hydrates missing sources',async()=>{
 insert('a','2026-11-01T01:00:00.000Z');const first=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now);
 const prepare=vi.spyOn(db,'prepare');const start=performance.now();const second=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now);expect(second).toEqual(first);expect(performance.now()-start).toBeLessThan(30);expect(prepare).not.toHaveBeenCalled();
 insert('b','2026-11-01T02:00:00.000Z');expect((await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now)).current.tasks).toBe(2);
 const other=new Database(':memory:');try{initSchema(other);expect((await overviewDashboard(other,DEFAULT_ALERT_THRESHOLDS,'7d','',now)).current.tasks).toBe(0);}finally{other.close();}
});
it('rejects invalid filters and keeps incomplete status/tool/Token coverage explicit',async()=>{
 await expect(overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'99d')).rejects.toMatchObject({code:'BAD_REQUEST'});await expect(overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','x'.repeat(129))).rejects.toMatchObject({code:'BAD_REQUEST'});
 const task={recordedStatus:'unknown',memberCount:2,metrics:{input:null,output:null,cacheRead:null,correctedTotal:null,promptInput:null,cacheHitRate:null}} as TaskSummary;
 expect(overviewPoint([task],DEFAULT_ALERT_THRESHOLDS,'2026-11-01T00:00:00.000Z')).toMatchObject({tasks:1,statusKnownTasks:0,toolKnownTasks:0,failurePct:null,toolFailurePct:null,tokens:null,cacheKnownMembers:0,cacheTotalMembers:2});
});
it('keeps warm500-task overview reads inside80ms without reading member/event metadata again',async()=>{
 const add=db.prepare(`INSERT INTO sessions(id,provider,source_agent,source_path,title,started_at,updated_at,status,detail_loaded,token_input,token_output,token_cache_read,token_cache_write) VALUES(?,'codex','Codex','/not-readable','Task','2026-11-01T01:00:00.000Z','2026-11-01T01:00:00.000Z','success',1,60,20,30,10)`);
 db.transaction(()=>{for(let i=0;i<500;i++)add.run('perf-'+i);})();
 const coldStarted=performance.now();await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now);expect(performance.now()-coldStarted).toBeLessThan(400);
 const statements:string[]=[];db.pragma('query_only = ON');
 const original=db.prepare.bind(db);vi.spyOn(db,'prepare').mockImplementation(sql=>{statements.push(sql);return original(sql);});
 const started=performance.now();const value=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now);
 expect(performance.now()-started).toBeLessThan(80);expect(value.current.tasks).toBe(500);expect(value.daily).toHaveLength(7);expect(statements).toEqual([]);expect(JSON.stringify(value).length).toBeLessThan(80000);
});
it('includes long-running tasks, deduplicates root activity by event date, and assigns lifetime snapshots once to last activity',async()=>{
 insert('ongoing','2026-10-01T00:00:00.000Z');insert('old','2026-10-01T00:00:00.000Z');
 db.prepare("UPDATE sessions SET updated_at='2026-11-01T10:00:00.000Z',event_count=3 WHERE id='ongoing'").run();
 const event=db.prepare("INSERT INTO events(session_id,id,sequence,kind,phase,started_at,status) VALUES('ongoing',?,?,'llm','implement',?,'success')");event.run('a',0,'2026-10-28T01:00:00.000Z');event.run('b',1,'2026-10-28T02:00:00.000Z');event.run('c',2,'2026-10-30T01:00:00.000Z');
 const result=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now);
 expect(result.current.tasks).toBe(1);expect(result.daily.map(p=>p.day.slice(0,10))).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
 expect(result.daily.map(p=>p.tasks)).toEqual([0,0,1,0,1,0,1]);expect(result.daily.map(p=>p.tokens)).toEqual([0,0,0,0,0,0,120]);expect(result.daily[0]!.cacheHitRate).toBeNull();expect(result.daily.at(-1)!.cacheHitRate).toBe(0.3);expect(result.previous!.tokens).toBeNull();expect(result.criteria.en).toContain('not daily increments');
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT session_id,started_at FROM events INDEXED BY idx_events_session_time WHERE session_id=? AND started_at>=? AND started_at<?").all('ongoing','2026-10-26','2026-11-02') as Array<{detail:string}>;
 expect(plan.map(p=>p.detail).join(' ')).toContain('USING COVERING INDEX idx_events_session_time');
});
it('returns30consecutive slots and switches all-history to UTC Monday weeks after60dates',async()=>{
 insert('first','2026-08-01T00:00:00.000Z');insert('last','2026-11-01T01:00:00.000Z');
 const month=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'30d','',now);expect(month.daily).toHaveLength(30);expect(month.daily[0]!.day).toBe('2026-10-03T00:00:00.000Z');expect(month.daily.at(-1)!.day).toBe('2026-11-01T00:00:00.000Z');
 const all=await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'all','',now);expect(all.daily.length).toBeGreaterThan(1);expect(all.daily.length).toBeLessThan(60);expect(all.daily.every(p=>new Date(p.day).getUTCDay()===1)).toBe(true);expect(all.daily.reduce((n,p)=>n+p.tokens!,0)).toBe(240);for(let i=1;i<all.daily.length;i++)expect(Date.parse(all.daily[i]!.day)-Date.parse(all.daily[i-1]!.day)).toBe(7*86400000);
});
it('keeps the generatedAt upper boundary exclusive instead of certifying future or equal-time starts',async()=>{
 insert('at-end',new Date(now).toISOString());expect((await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now)).current.tasks).toBe(0);
 expect((await overviewDashboard(db,DEFAULT_ALERT_THRESHOLDS,'7d','',now+60000)).current.tasks).toBe(1);
});
