import { describe, it, expect, vi } from 'vitest';
import { mapOtlpSpan, parseOtlp, detectImport, utc, TelemetryError } from './mapping.js';
import type { LinkedExecutionPage } from '../../src/core/trace-types.js';
import { buildLinkedTraceExport } from '../../src/core/linked-trace-export.js';
import { buildTraceExport } from '../../src/core/trace-export.js';
import { exportTelemetry } from './export.js';
import { attributes, span, batch } from './test-fixtures.js';
describe('pure telemetry mapping',()=>{
  it.each([['chat','llm'],['text_completion','llm'],['embeddings','llm'],['execute_tool','tool'],['invoke_agent','agent'],['create_agent','agent'],['custom','system']])('maps GenAI %s', (operation,kind)=>{
    expect(mapOtlpSpan(span('1',{'gen_ai.operation.name':operation,'gen_ai.request.model':'request','gen_ai.response.model':'response','gen_ai.usage.input_tokens':0,'gen_ai.usage.output_tokens':5,'gen_ai.usage.cache_read.input_tokens':2,'gen_ai.tool.name':'search','gen_ai.tool.call.id':'call','gen_ai.agent.name':'helper','gen_ai.agent.id':'agent','gen_ai.conversation.id':'conversation'}))).toMatchObject({kind,group:'conversation',model:'response',toolName:'search',toolCallId:'call',agentName:'helper',agentId:'agent',durationMs:1000,usage:{input:0,output:5,cacheRead:2,cacheWrite:null,total:null,reasoning:null}});
  });
  it.each([['LLM','llm'],['TOOL','tool'],['AGENT','agent'],['CHAIN','system'],['RETRIEVER','system'],['EMBEDDING','llm'],['RERANKER','system'],['GUARDRAIL','system']])('maps OpenInference %s',(type,kind)=>{
    expect(mapOtlpSpan(span('1',{'openinference.span.kind':type,'llm.model_name':'local-model','llm.token_count.prompt':4,'llm.token_count.completion':6,'llm.token_count.total':10,'tool.name':'lookup','input.value':'hello','output.value':'world','session.id':'s','user.id':'u'}))).toMatchObject({kind,model:'local-model',group:'s',input:'hello',output:'world',userId:'u',usage:{input:4,output:6,total:10}});
  });
  it('retains unknown steps, missing timestamps/usage and unset status without fabrication',()=>{
    expect(mapOtlpSpan({traceId:'A'.repeat(32),spanId:'B'.repeat(16),name:'step',attributes:[]})).toMatchObject({kind:'system',traceId:'a'.repeat(32),start:null,end:null,durationMs:null,status:'unknown',usage:{input:null,output:null,total:null}});
    expect(mapOtlpSpan({...span(),endTimeUnixNano:'1'}).durationMs).toBeNull();
    expect(()=>mapOtlpSpan({})).toThrow(TelemetryError);
  });
  it('maps exception events and message events, redacts before clipping',()=>{
    const s=mapOtlpSpan({...span(),status:{code:0},events:[{name:'exception',attributes:attributes({'exception.message':'failed'})},{name:'gen_ai.user.message',attributes:attributes({content:'hello alice@example.com'})}]});
    expect(s.status).toBe('error');expect(s.error).toBe('failed');expect(s.input).toContain('hello');expect(s.input).not.toContain('alice@example.com');
  });
  it('rejects oversized attributes, attributes count, nesting and invalid IDs',()=>{
    expect(()=>mapOtlpSpan(span('1',{content:'a'.repeat(65537)}))).toThrow(TelemetryError);
    expect(()=>mapOtlpSpan({...span(),attributes:Array.from({length:129},()=>attributes({x:1})[0])})).toThrow(TelemetryError);
    expect(()=>mapOtlpSpan({...span(),traceId:'0'.repeat(32)})).toThrow(TelemetryError);
    expect(()=>parseOtlp(batch(Array.from({length:1001},()=>span())))).toThrow(TelemetryError);
  });
  it('imports repository scan export unchanged without promoting observation points to measured intervals',()=>{
    const exported=buildTraceExport({session:{id:'native',provider:'codex',updatedAt:'2026-11-01T00:00:00.000Z',durationSource:'derived'},detailLoaded:true,declaredEventCount:1,eventTotal:1,offset:0,limit:100,events:[{id:'e',sequence:1,kind:'tool',phase:'implement',startedAt:'2026-11-01T00:00:00.000Z',durationMs:150,status:'success'}]},{traceId:'a'.repeat(32),spanId:()=> 'b'.repeat(16)},'2026-11-01T00:00:00.000Z');
    expect(detectImport(exported).spans[0]).toMatchObject({kind:'tool',group:'native',status:'success',start:'2026-11-01T00:00:00.000Z',durationMs:null,end:null});
  });
  it('imports the repository linked OTLP document with native observations unchanged',()=>{
    const stamp='2026-11-01T00:00:00.123456789Z';
    const page={session:{id:'native',provider:'codex' as const,updatedAt:stamp,durationSource:'derived' as const},detailLoaded:true,declaredEventCount:1,eventTotal:1,offset:0,limit:100,events:[{id:'event',sequence:1,kind:'tool' as const,phase:'implement' as const,startedAt:stamp,durationMs:3,status:'success' as const}]};
    const linked:LinkedExecutionPage={sessionKey:'native',sessionDurationSource:'derived',events:page.events.map(e=>({...e,sessionId:'native',turnKey:null,title:'source',actor:'agent',tool:null,tokens:null,error:null,hasInput:false,hasOutput:false,hasRaw:false})),eventOffset:0,eventLimit:100,eventTotal:1,eventsHasMore:false,identities:[],identityCompleteness:{complete:true,omittedCount:0,reasons:[]},nextCaptureCursor:null,capturesHasMore:false,attempts:[]};
    const exported=buildLinkedTraceExport(page,linked,{eventOffset:0,eventLimit:100,captureLimit:20},{scan:{traceId:'a'.repeat(32),spanId:()=> 'b'.repeat(16)},network:()=>({traceId:'c'.repeat(32),spanId:'d'.repeat(16)})},stamp);
    expect(detectImport(exported).spans[0]).toMatchObject({kind:'tool',group:'native',start:stamp,end:null,durationMs:null});
  });
  it('roundtrips telemetry metadata, parent tree, zero usage and unknowns',()=>{
    const spans=[mapOtlpSpan(span('1',{'gen_ai.operation.name':'invoke_agent','gen_ai.conversation.id':'s'})),mapOtlpSpan(span('2',{'gen_ai.operation.name':'chat','gen_ai.usage.input_tokens':0},'1'))];
    const returned=parseOtlp(exportTelemetry(spans,0,100));
    expect(returned.map(s=>[s.traceId,s.spanId,s.parentSpanId,s.kind,s.start,s.end,s.usage])).toEqual(spans.map(s=>[s.traceId,s.spanId,s.parentSpanId,s.kind,s.start,s.end,s.usage]));
  });
  it.each([
    [{traces:[{id:'trace',sessionId:'session'}],observations:[{id:'child',traceId:'trace',parentObservationId:'parent',type:'GENERATION',model:'test',usageDetails:{input:4,output:6,total:10},startTime:'2026-11-01T01:00:00+01:00',endTime:'2026-11-01T00:00:01Z'}]},'Langfuse','session','parent'],
    [{runs:[{id:'run',trace_id:'trace',parent_run_id:'parent',run_type:'llm',start_time:'2026-11-01T00:00:00Z',end_time:'2026-11-01T00:00:01Z',usage_metadata:{input_tokens:4,output_tokens:6,total_tokens:10},extra:{metadata:{thread_id:'session',ls_model_name:'test'}}}]},'LangSmith','session','parent']
  ])('reads documented vendor fields', (value,format,group,parent)=>{
    const parsed=detectImport(value);expect(parsed.format).toBe(format);expect(parsed.spans[0]).toMatchObject({group,parentSpanId:parent,kind:'llm',model:'test',durationMs:1000,usage:{input:4,output:6,total:10}});
  });
  it.each(['America/Los_Angeles','Pacific/Auckland'])('interprets timezone-free LangSmith ISO dates as UTC, independent of %s',timezone=>{
    vi.stubEnv('TZ',timezone);
    try {
      const parsed=detectImport({runs:[{id:'run',trace_id:'trace',run_type:'llm',start_time:'2026-11-01T10:00:00.123456',end_time:'2026-11-01T10:00:00.923456'}]});
      expect(parsed.spans[0]).toMatchObject({start:'2026-11-01T10:00:00.123Z',end:'2026-11-01T10:00:00.923Z',durationMs:800,status:'unknown'});
    }finally{vi.unstubAllEnvs();}
  });
  it.each([
    ['2026-11-01T10:00:00','2026-11-01T10:00:09','2026-11-01T10:00:00.000Z',9000],
    ['2026-11-01T10:00:00Z','2026-11-01T10:00:09Z','2026-11-01T10:00:00.000Z',9000],
    ['2026-11-01T10:00:00+08:00','2026-11-01T10:00:09+08:00','2026-11-01T02:00:00.000Z',9000],
    ['2026-11-01T10:00:00','2026-11-01T10:00:01Z','2026-11-01T10:00:00.000Z',1000],
    ['2026-11-01T10:00:09','2026-11-01T10:00:00','2026-11-01T10:00:09.000Z',null],
    ['2026-02-30T10:00:00','2026-02-30T10:00:01',null,null],
    ['2026-11-01T25:00:00','2026-11-01T25:00:01',null,null],
    ['2026-11-01','not a date',null,null]
  ])('normalizes LangSmith dates without changing explicit timezone meaning: %s', (start,end,expected,durationMs)=>{
    expect(detectImport([{id:'run',run_type:'tool',start_time:start,end_time:end}]).spans[0]).toMatchObject({start:expected,durationMs});
  });
  it('still requires timezone evidence for Langfuse and the shared UTC parser',()=>{
    const start='2026-11-01T10:00:00',end='2026-11-01T10:00:09';
    expect(utc(start)).toBeNull();
    expect(detectImport({observations:[{id:'observation',traceId:'trace',type:'TOOL',startTime:start,endTime:end}]}).spans[0]).toMatchObject({start:null,end:null,durationMs:null});
  });
  it('clearly rejects unrecognized and mixed formats',()=>{expect(()=>detectImport({hello:true})).toThrow('Unrecognized format');expect(()=>detectImport([{id:'x',run_type:'llm'},{id:'y',type:'TOOL',traceId:'z'}])).toThrow('Unrecognized format');});
});
