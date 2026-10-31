import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from './schema.js';
import { writeNativeIdentities } from './trace-links.js';
import { getTask, getTaskTimeline, taskRecords } from './task-workbench.js';
import { TASK_ROUND_SEED_SQL, TASK_TOOL_REFS_SQL } from './task-process.js';
let db: Database.Database;
const at = (seconds: number) => new Date(Date.UTC(2026,9,26)+seconds*1000).toISOString();
function source() { db.prepare('INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES(?,?,?,?,?,?,?,1)').run('s','codex','Codex','Task',at(0),at(50),'/fixture'); }
function event(id: string, sequence: number, kind='tool', seconds=sequence, options: { input?: boolean; output?: boolean; turn?: string; duration?: number; status?: string; title?: string }={}) {
  db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,title,started_at,duration_ms,status,actor,tool,turn_key,input_summary,output_summary,input_len,output_len) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('s',id,sequence,kind,'implement',options.title??id,at(seconds),options.duration??0,options.status??'success','assistant',kind==='tool'?'Read':null,options.turn??'step-1',options.input?'SECRET INPUT':null,options.output?'SECRET OUTPUT':null,options.input?12:0,options.output?13:0);
}
function identities(entries: Array<{ event: string; kind?: 'turn'|'response'|'tool_call'; value: string }>, complete=true) {
  writeNativeIdentities(db,{source:'scan',key:'s'},{parserVersion:3,items:entries.map(value=>({namespace:'agent:codex',kind:value.kind??'tool_call',value:value.value,scope:'native-s',eventId:value.event,sourcePath:'fixture.'+value.event})),completeness:{complete,omittedCount:complete?0:1,reasons:complete?[]:['limit']}},at(50));
}
beforeEach(()=>{db=new Database(':memory:');initSchema(db);source();});
afterEach(()=>db.close());
describe('task structure facts',()=>{
  it('looks up the preceding input once per member and seeks the exact sequence',()=>{
    event('prompt',1,'user_prompt');event('tool',2);
    const plan=db.prepare('EXPLAIN QUERY PLAN '+TASK_ROUND_SEED_SQL).all(JSON.stringify([['s',2]])) as {detail:string}[];
    expect(plan.some(row=>/SEARCH e .*sequence=\?/.test(row.detail))).toBe(true);
    const toolPlan=db.prepare('EXPLAIN QUERY PLAN '+TASK_TOOL_REFS_SQL).all(JSON.stringify([['agent:codex','call','native-s','scan:s']])) as {detail:string}[];
    const sourceLookup=toolPlan.findIndex(row=>row.detail.includes('SEARCH i USING INDEX idx_trace_identities_source'));
    expect(sourceLookup).toBeGreaterThanOrEqual(0);
    expect(toolPlan.findIndex(row=>row.detail==='SCAN q')).toBeGreaterThan(sourceLookup);
  });
  it('retains exact scoped native pairs and off-page locators without reading bodies',()=>{
    event('call',1,'tool',1,{input:true});event('result',2,'tool',2,{output:true});
    identities([{event:'call',value:'native-call'},{event:'result',value:'native-call'}]);
    const page=taskRecords(db,getTask(db,'collected:s'),{offset:1,limit:1,structure:true});
    expect(page.structure?.records[0]?.pairing).toBe('exact');
    expect(page.structure?.records[0]?.relatedRecordIds.sort()).toEqual(['s:event:call','s:event:result']);
    expect(JSON.stringify(page)).not.toContain('SECRET');
  });
  it('rejects same-ID grouping across decision keys and incomplete identity manifests',()=>{
    event('call',1,'tool',1,{input:true,turn:'a'});event('result',2,'tool',2,{output:true,turn:'b'});
    identities([{event:'call',value:'reused'},{event:'result',value:'reused'}]);
    const read=()=>taskRecords(db,getTask(db,'collected:s'),{structure:true}).structure!;
    expect(read().records.every(value=>value.pairing==='ambiguous'&&value.tool===null)).toBe(true);
    identities([{event:'call',value:'reused'},{event:'result',value:'reused'}],false);
    expect(read().records.every(value=>value.pairing==='incomplete'&&value.tool===null)).toBe(true);
  });
  it('keeps preceding user context outside a filtered page without counting it as a match',()=>{
    event('prompt',1,'user_prompt',0,{title:'Inspect the source'});event('call',2,'tool',2,{input:true,title:'Find target'});
    identities([{event:'call',value:'c'}]);
    const page=taskRecords(db,getTask(db,'collected:s'),{q:'target',structure:true});
    expect(page.total).toBe(1);expect(page.items).toHaveLength(1);
    expect(page.structure?.leading[0]).toMatchObject({recordId:'s:event:prompt',title:'Inspect the source'});
  });
  it('exposes native round/response identities only when retained and unambiguous',()=>{
    event('output',1,'llm');identities([{event:'output',kind:'turn',value:'round'},{event:'output',kind:'response',value:'response'}]);
    const facts=taskRecords(db,getTask(db,'collected:s'),{structure:true}).structure!.records[0]!;
    expect(facts.round?.value).toBe('round');expect(facts.attempt?.value).toBe('response');
  });
});
describe('full-window task time navigation',()=>{
  it('retains the full domain through record filters and frozen paging',()=>{
    event('early',1,'user_prompt',0);event('late',2,'tool',10,{duration:2000});
    const context=getTask(db,'collected:s'),page=taskRecords(db,context,{q:'late',limit:1});
    event('new',3,'llm',30);
    const timeline=getTaskTimeline(db,context,'main',page.window);
    expect(timeline.total).toBe(2);expect(timeline.from).toBe(at(0));expect(timeline.to).toBe(at(12));
    expect(timeline.lanes[0]?.bins.reduce((sum,bin)=>sum+bin.input+bin.model+bin.tool+bin.other,0)).toBe(2);
    expect(()=>getTaskTimeline(db,context,'all',page.window)).toThrow('scope mismatch');
  });
  it('loads every overlap in an inclusive time range without treating running duration as a completed span',()=>{
    event('crossing',1,'tool',0,{duration:10000});event('running',2,'llm',0,{duration:10000,status:'running'});event('point',3,'llm',5);event('input',4,'user_prompt',0,{duration:100000});event('output',5,'tool',0,{duration:100000,output:true});
    const context=getTask(db,'collected:s'),page=taskRecords(db,context,{from:at(5),to:at(5)});
    expect(page.items.map(item=>item.event?.id).sort()).toEqual(['crossing','point']);
    expect(taskRecords(db,context,{from:at(10),to:at(10)}).items.map(item=>item.event?.id)).toEqual(['crossing']);
    expect(()=>taskRecords(db,context,{from:''})).toThrow('UTC task time');
    expect(()=>taskRecords(db,context,{from:at(4),to:at(5),window:page.window})).toThrow('scope mismatch');
    expect(()=>taskRecords(db,context,{from:at(5)})).toThrow('UTC task time');
    expect(()=>taskRecords(db,context,{from:at(6),to:at(5)})).toThrow('UTC task time');
  });
  it('keeps untimed observations explicit and never reads raw evidence for the overview',()=>{
    event('a',1);db.prepare("UPDATE events SET started_at='unknown' WHERE id='a'").run();
    const context=getTask(db,'collected:s'),page=taskRecords(db,context,{}),timeline=getTaskTimeline(db,context,'main',page.window);
    expect(timeline).toMatchObject({total:1,untimed:1,from:null,to:null,lanes:[]});
    expect(()=>getTaskTimeline(db,context,'main','bad')).toThrow('timeline window');
  });
});
