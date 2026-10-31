import Database from 'better-sqlite3';
import { describe,it,expect } from 'vitest';
import { initSchema } from './schema.js';
import { storeTelemetry } from './telemetry.js';
import { mapOtlpSpan } from '../telemetry/mapping.js';
import { span } from '../telemetry/test-fixtures.js';
import { getTask,listTasks,taskRecords } from './task-workbench.js';
const fixture=()=>{const db=new Database(':memory:');db.pragma('foreign_keys=ON');initSchema(db);return db;};
describe('telemetry session storage and membership',()=>{
  it('groups explicit conversation/session across traces, otherwise keeps traces separate',()=>{
    const db=fixture();try{const rows=[span('1',{'gen_ai.conversation.id':'conversation'}),{...span('2',{'gen_ai.conversation.id':'conversation'}),traceId:'b'.repeat(32)},span('3',{'session.id':'session'}),{...span('4'),traceId:'c'.repeat(32)}];storeTelemetry(db,rows.map(s=>mapOtlpSpan(s)),'collected');const tasks=listTasks(db,{range:'all'});expect(tasks.total).toBe(3);expect(tasks.items.map(t=>t.eventCount).sort()).toEqual([1,1,2]);}finally{db.close();}
  });
  it('resolves late parents/members and conversation groups, retains span IDs and skips exact retransmission writes',()=>{
    const db=fixture();try{
      const child=mapOtlpSpan(span('3',{'gen_ai.operation.name':'execute_tool'},'2'));storeTelemetry(db,[child],'collected');
      const root=mapOtlpSpan(span('1',{'gen_ai.operation.name':'invoke_agent','gen_ai.conversation.id':'conversation','gen_ai.agent.name':'main'}));
      const member=mapOtlpSpan(span('2',{'gen_ai.operation.name':'invoke_agent','gen_ai.agent.name':'child'},'1'));
      const saved=storeTelemetry(db,[root,member],'collected');const task=getTask(db,saved.taskIds[0]!);expect(listTasks(db,{}).total).toBe(1);expect(task.members).toHaveLength(2);expect(task.members.find(m=>m.role==='subagent')?.name).toBe('child');
      const records=taskRecords(db,task,{member:'all',offset:0});expect(records.items).toHaveLength(3);expect(records.items.find(r=>r.event?.kind==='tool')?.event?.telemetry?.parentSpanId).toBe(member.spanId);
      const before=db.prepare('SELECT total_changes() AS n').get();expect(storeTelemetry(db,[root,member,child],'collected').changed).toEqual([]);expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      expect(db.prepare('SELECT span_count FROM telemetry_quota').get()).toEqual({span_count:3});
    }finally{db.close();}
  });
  it('does not preserve an inferred conversation when later explicit groups conflict',()=>{
    const db=fixture();try{const orphan=mapOtlpSpan(span('3'));storeTelemetry(db,[mapOtlpSpan(span('1',{'session.id':'a'})),orphan],'collected');expect(listTasks(db,{}).total).toBe(1);storeTelemetry(db,[mapOtlpSpan(span('2',{'session.id':'b'}))],'collected');expect(listTasks(db,{}).total).toBe(3);}finally{db.close();}
  });
  it('keeps parent identifiers scoped to trace IDs and file/receiver provenance independent',()=>{
    const db=fixture();try{
      const root=mapOtlpSpan(span('1',{'gen_ai.operation.name':'invoke_agent','session.id':'s'}));const child=mapOtlpSpan({...span('2',{'gen_ai.operation.name':'execute_tool','session.id':'s'},'1'),traceId:'b'.repeat(32)});
      const saved=storeTelemetry(db,[root,child],'collected');const task=getTask(db,saved.taskIds[0]!);expect(task.members).toHaveLength(1);storeTelemetry(db,[root,child],'imported');expect(listTasks(db,{}).total).toBe(1);expect(listTasks(db,{origin:'imported'}).total).toBe(1);
    }finally{db.close();}
  });
  it('rejects retained span/quota and member excess atomically without touching native rows',()=>{
    const db=fixture();try{
      storeTelemetry(db,[mapOtlpSpan(span())],'collected');const before=db.prepare('SELECT COUNT(1) AS n FROM events').get();
      db.prepare('UPDATE telemetry_quota SET span_count=20000').run();expect(()=>storeTelemetry(db,[mapOtlpSpan(span('2'))],'collected')).toThrow('quota');expect(db.prepare('SELECT COUNT(1) AS n FROM events').get()).toEqual(before);
      db.prepare('UPDATE telemetry_quota SET span_count=1').run();const agents=Array.from({length:101},(_,i)=>mapOtlpSpan(span((i+2).toString(16),{'gen_ai.operation.name':'invoke_agent','session.id':'many'})));expect(()=>storeTelemetry(db,agents,'collected')).toThrow('quota');expect(db.prepare('SELECT COUNT(1) AS n FROM telemetry_spans').get()).toEqual({n:1});expect(db.prepare('SELECT span_count FROM telemetry_quota').get()).toEqual({span_count:1});
    }finally{db.close();}
  });
  it('does not fabricate parent members for cycles and reports dangling ancestry',()=>{
    const db=fixture();try{
      const saved=storeTelemetry(db,[mapOtlpSpan(span('1',{'gen_ai.operation.name':'invoke_agent'},'2')),mapOtlpSpan(span('2',{'gen_ai.operation.name':'invoke_agent'},'1')),mapOtlpSpan(span('3',{},'4'))],'collected');
      const context=getTask(db,saved.taskIds[0]!);expect(context.members).toHaveLength(1);expect(context.members[0]?.parentId).toBeNull();expect(context.warnings).toContain('telemetry_parent_cycle');expect(context.warnings).toContain('telemetry_parent_unresolved');expect(context.task.eventCount).toBe(3);
    }finally{db.close();}
  });
  it('keeps cost/accounting/context unknown even for priced models, counts completed tool errors without prose',()=>{
    const db=fixture();try{
      const saved=storeTelemetry(db,[mapOtlpSpan(span('1',{'gen_ai.operation.name':'chat','gen_ai.response.model':'claude-sonnet-4-6','gen_ai.usage.input_tokens':4,'gen_ai.usage.output_tokens':6,'llm.token_count.total':10})),mapOtlpSpan({...span('2',{'gen_ai.operation.name':'execute_tool'}),status:{code:2}})],'collected');
      const context=getTask(db,saved.taskIds[0]!);expect(context.metrics).toMatchObject({input:4,output:6,correctedTotal:10,cacheHitRate:null,contextPressurePct:null,toolCalls:1,toolFailures:1,errors:1});
    }finally{db.close();}
  });
  it('rolls back additive schema24 tables/indexes when its version write fails',()=>{
    const db=fixture();try{db.exec("DROP TABLE telemetry_sessions;DROP TABLE telemetry_spans;DROP TABLE telemetry_quota;UPDATE _meta SET value='23' WHERE key='schema_version';CREATE TRIGGER reject_telemetry BEFORE UPDATE ON _meta WHEN NEW.value='24' BEGIN SELECT RAISE(ABORT,'telemetry migration refused');END");expect(()=>initSchema(db)).toThrow('telemetry migration refused');expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({value:'23'});expect(db.prepare("SELECT name FROM sqlite_master WHERE name='telemetry_spans'").get()).toBeUndefined();db.exec('DROP TRIGGER reject_telemetry');initSchema(db);expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({value:'24'});}finally{db.close();}
  });
  it('migrates v23 additively and keeps repeated initialization idempotent',()=>{
    const db=fixture();try{db.exec("DROP TABLE telemetry_sessions;DROP TABLE telemetry_spans;DROP TABLE telemetry_quota;UPDATE _meta SET value='23' WHERE key='schema_version'");initSchema(db);initSchema(db);expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({value:'24'});expect(db.prepare('SELECT span_count,bytes FROM telemetry_quota').get()).toEqual({span_count:0,bytes:0});}finally{db.close();}
  });
});
