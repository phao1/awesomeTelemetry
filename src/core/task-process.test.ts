import { describe,expect,it } from 'vitest';
import { deriveTaskProcess,flattenTaskProcess,fitTimeRange,isProcessGroup,processInterval,zoomTimeRange,type ProcessGroup } from './task-process.js';
import type { TaskRecord,TaskRecordPage,TaskNativeRef } from './task-types.js';
import type { TraceEventSlim } from './trace-types.js';
const native=(kind:TaskNativeRef['kind'],value:string):TaskNativeRef=>({namespace:'agent:codex',kind,value,scope:'s'});
const item=(id:string,n:number,options:Partial<TraceEventSlim>={}):TaskRecord=>({id:'s:event:'+id,memberId:'agent',memberName:'Agent',sessionKey:'s',event:{id,sessionId:'s',sequence:n,kind:'tool',phase:'implement',title:id,startedAt:'2026-10-26T00:00:00.000Z',durationMs:0,status:'unknown',actor:'assistant',tool:null,tokens:null,error:null,hasInput:false,hasOutput:false,hasRaw:false,model:null,turnKey:'decision',...options},importedTurn:null});
const page=(items:TaskRecord[]):TaskRecordPage=>({context:{task:{id:'collected:s'} as TaskRecordPage['context']['task'],members:[],importSession:null,warnings:[]},items,total:items.length,offset:0,limit:200,hasMore:false,hasPrevious:false,window:'fixed',warnings:[]});
const walk=(groups:ProcessGroup[]):ProcessGroup[]=>groups.flatMap(group=>[group,...walk(group.children.filter(isProcessGroup))]);
describe('evidence-based task process',()=>{
  it('starts a new user round after a response-only observation even without visible assistant text',()=>{
    const first=item('u1',1,{kind:'user_prompt'}),carrier=item('usage',2,{kind:'system',title:''}),second=item('u2',3,{kind:'user_prompt'});
    const value=page([first,carrier,second]);value.structure={records:[{recordId:carrier.id,round:null,attempt:native('response','r'),tool:null,pairing:'unavailable',relatedRecordIds:[]}],leading:[],warnings:[]};
    expect(deriveTaskProcess(value)).toHaveLength(2);
  });
  it('keeps a native response-only observation inspectable without fabricating assistant output or completion',()=>{
    const carrier=item('usage',1,{kind:'system',title:'',hasOutput:false}),tool=item('call',2,{kind:'tool',tool:'Read',hasInput:true});
    const value=page([carrier,tool]);value.structure={records:[{recordId:carrier.id,round:null,attempt:native('response','response-only'),tool:null,pairing:'unavailable',relatedRecordIds:[]}],leading:[],warnings:[]};
    const attempt=walk(deriveTaskProcess(value)).find(group=>group.kind==='attempt');
    expect(attempt).toMatchObject({result:null,basis:'decision_key',native:{value:'response-only'}});
    expect(attempt?.records).toEqual([carrier]);
    expect(attempt?.records.every(record=>!record.event?.hasOutput)).toBe(true);
  });
  it('labels a unique step-level response association without inventing direct event identity',()=>{
    const model=item('m',1,{kind:'llm',tool:null,hasOutput:true}),carrier=item('usage',2,{kind:'system',title:''});
    const value=page([model,carrier]);value.structure={records:[{recordId:carrier.id,round:null,attempt:native('response','r'),tool:null,pairing:'unavailable',relatedRecordIds:[]}],leading:[],warnings:[]};
    const groups=walk(deriveTaskProcess(value)),attempt=groups.find(group=>group.kind==='attempt');
    expect(attempt).toMatchObject({basis:'decision_key',native:{value:'r'}});
    expect(attempt?.records.map(record=>record.id)).toEqual([model.id,carrier.id]);
    const expanded=new Set(groups.map(group=>'open:'+group.key));
    expect(flattenTaskProcess(deriveTaskProcess(value),expanded,null).filter(row=>row.record)).toHaveLength(2);
  });
  it('organizes one input round into decision steps, model observations and exactly paired tools without duplicating original rows',()=>{
    const input=item('u',1,{kind:'user_prompt',tool:null,title:'Fix the bug'}),model=item('m',2,{kind:'llm',tool:null}),call=item('c',3,{kind:'tool',tool:'Read',hasInput:true,hasOutput:false}),result=item('r',4,{kind:'tool',tool:'Read',hasInput:false,hasOutput:true});
    const value=page([input,model,call,result]);value.structure={records:[call,result].map(record=>({recordId:record.id,round:null,attempt:null,tool:native('tool_call','call'),pairing:'exact',relatedRecordIds:[call.id,result.id]})),leading:[],warnings:[]};
    const groups=deriveTaskProcess(value),all=walk(groups),tools=all.filter(group=>group.kind==='tool');
    expect(groups).toHaveLength(1);expect(all.filter(group=>group.kind==='step')).toHaveLength(1);expect(tools).toHaveLength(1);expect(tools[0]?.records).toHaveLength(2);
    const expanded=new Set(all.map(group=>'open:'+group.key));
    expect(flattenTaskProcess(groups,expanded,null).flatMap(row=>row.record?[row.record.id]:[]).sort()).toEqual(value.items.map(record=>record.id).sort());
  });
  it('does not pair same-name tools or invent attempts from successive model outputs',()=>{
    const value=page([item('a',1,{kind:'llm',tool:null}),item('c',2,{kind:'tool',tool:'Read'}),item('d',3,{kind:'tool',tool:'Read'}),item('b',4,{kind:'llm',tool:null})]);
    const groups=walk(deriveTaskProcess(value));expect(groups.filter(group=>group.kind==='tool')).toHaveLength(2);expect(groups.filter(group=>group.kind==='attempt')).toHaveLength(0);expect(groups.filter(group=>group.kind==='model')).toHaveLength(2);
  });
  it('retains failed observations after native response recovery without finishing the round',()=>{
    const failure=item('a',1,{kind:'llm',tool:null,status:'error',hasOutput:true}),success=item('b',2,{kind:'llm',tool:null,status:'success',hasOutput:true});
    const value=page([failure,success]);value.structure={records:[failure,success].map(record=>({recordId:record.id,round:native('turn','round'),attempt:native('response','response'),tool:null,pairing:'unavailable',relatedRecordIds:[]})),leading:[],warnings:[]};
    const groups=walk(deriveTaskProcess(value)),attempt=groups.find(group=>group.kind==='attempt');expect(attempt).toMatchObject({result:'success',errorCount:1});expect(attempt?.records).toHaveLength(2);
    expect(groups[0]).toMatchObject({kind:'round',result:null});
  });
  it('retains preceding round context, page boundaries and independent member order',()=>{
    const a=item('a',21,{kind:'tool'}),b={...item('b',2,{kind:'llm',tool:null}),memberId:'other',memberName:'Other'};
    const value=page([a,b]);value.hasPrevious=true;value.structure={records:[],warnings:[],leading:[{memberId:'agent',recordId:'s:event:prior',sequence:1,title:'Original input',startedAt:a.event!.startedAt}]};
    const groups=deriveTaskProcess(value);expect(groups).toHaveLength(2);expect(groups.find(group=>group.memberId==='agent')).toMatchObject({basis:'continued',title:'Original input',partial:true});
    expect(groups.every(group=>new Set(group.records.map(record=>record.memberId)).size===1)).toBe(true);
  });
  it('supports explicit folding while preserving selection and original identity',()=>{
    const record=item('a',1,{kind:'llm',tool:null}),groups=deriveTaskProcess(page([record])),all=walk(groups);
    expect(flattenTaskProcess(groups,new Set(),record.id).some(row=>row.record?.id===record.id)).toBe(true);
    expect(flattenTaskProcess(groups,new Set([all[0]!.key]),record.id)).toHaveLength(1);
  });
});
describe('task time geometry',()=>{
  it('clamps zoom and pan while keeping real idle gaps and a stable anchor',()=>{
    expect(zoomTimeRange([0,10000],[0,10000],0.5)).toEqual([2500,7500]);
    expect(zoomTimeRange([0,10000],[0,10000],0.5,0)).toEqual([0,5000]);
    expect(fitTimeRange([0,10000],[8000,13000])).toEqual([5000,10000]);
    expect(fitTimeRange([0,10000],[-1000,2000])).toEqual([0,3000]);
  });
  it('renders incomplete/unknown durations as start markers and keeps untimed records out of the clock',()=>{
    const running=item('a',1,{durationMs:5000,status:'running'});expect(processInterval(running)?.[1]).toBe(processInterval(running)?.[0]);
    running.event!.startedAt='unknown';expect(processInterval(running)).toBeNull();
    const input=item('input',2,{kind:'user_prompt',durationMs:100000});expect(processInterval(input)?.[1]).toBe(processInterval(input)?.[0]);
    const output=item('result',3,{kind:'tool',hasInput:false,hasOutput:true,durationMs:100000});expect(processInterval(output)?.[1]).toBe(processInterval(output)?.[0]);
  });
});
