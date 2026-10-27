import type { TaskNativeRef, TaskRecord, TaskRecordPage, TaskRecordStructure } from './task-types.js';
import type { TraceStatus } from './trace-types.js';

export interface ProcessGroup {
  key: string;
  kind: 'round' | 'step' | 'attempt' | 'model' | 'tool' | 'context';
  memberId: string;
  memberName: string;
  title: string;
  basis: 'native' | 'user_input' | 'continued' | 'decision_key' | 'unavailable';
  native: TaskNativeRef | null;
  records: TaskRecord[];
  children: Array<ProcessGroup | TaskRecord>;
  partial: boolean;
  related: string[];
  errorCount: number;
  result: TraceStatus | null;
}
export interface ProcessRow { key: string; depth: number; group: ProcessGroup | null; record: TaskRecord | null }
export const isProcessGroup = (value: ProcessGroup | TaskRecord): value is ProcessGroup => 'children' in value;
export const processTime = (value: TaskRecord): number | null => {
  const time = Date.parse(value.event?.startedAt ?? value.importedTurn?.requestTime ?? ''); return Number.isFinite(time) ? time : null;
};
export function processInterval(value: TaskRecord): [number,number] | null {
  const start = processTime(value); if (start===null) return null;
  if (value.importedTurn) { const end=Date.parse(value.importedTurn.responseTime??''); return [start,Number.isFinite(end)&&end>=start?end:start]; }
  const event=value.event;
  const point=event?.status==='running'||Boolean(event&&(['user_prompt','system','agent','subagent_prompt'].includes(event.kind)||event.title==='token_count'||event.kind==='reasoning'&&!event.title&&!event.hasOutput||['tool','file_read','file_write','bash','test'].includes(event.kind)&&event.hasOutput&&!event.hasInput));
  const duration=point?0:event?.durationMs??0;
  return [start,start+(Number.isFinite(duration)&&duration>0?duration:0)];
}
export const processRecordTitle = (value: TaskRecord): string => value.event?.title || value.event?.tool || value.event?.kind || value.importedTurn?.turnId || value.importedTurn?.model || `#${value.importedTurn?.sequence ?? ''}`;
const nativeKey = (value: TaskNativeRef): string => JSON.stringify([value.namespace,value.kind,value.value,value.scope]);
const sequence = (value: TaskRecord) => value.event?.sequence ?? value.importedTurn?.sequence ?? 0;
const isModel = (value: TaskRecord) => !value.event || ['llm','reasoning','message'].includes(value.event.kind);
const isTool = (value: TaskRecord) => value.event && ['tool','bash','file_read','file_write','test'].includes(value.event.kind);
const isInput = (value: TaskRecord) => value.event?.kind==='user_prompt';
const isContext = (value: TaskRecord) => value.event?.kind==='system' || value.event?.kind==='agent' || value.event?.title==='token_count' || value.event?.kind==='reasoning'&&!value.event.title&&!value.event.hasOutput;
const error = (value: TaskRecord) => value.event?.status==='error'||value.importedTurn?.isError===true;
const wrapping = (title: string) => /^<(?:environment_context|in-app-browser-context|external_codex_apps|send_user_message_question_reply|turn_aborted)/.test(title);

/** Pure page projection. It preserves native sequence within each member, never
 * infers retries/causality and never parses opaque decision/event IDs. TP-004. */
export function deriveTaskProcess(page: TaskRecordPage): ProcessGroup[] {
  const facts=new Map(page.structure?.records.map(value=>[value.recordId,value]));
  const seeds=new Map(page.structure?.leading.map(value=>[value.memberId,value]));
  const byMember=new Map<string,TaskRecord[]>();
  for (const item of page.items) { const list=byMember.get(item.memberId)??[];list.push(item);byMember.set(item.memberId,list); }
  const roots: ProcessGroup[]=[];
  const make=(kind:ProcessGroup['kind'],key:string,item:TaskRecord,basis:ProcessGroup['basis'],native:TaskNativeRef|null=null):ProcessGroup=>({key,kind,memberId:item.memberId,memberName:item.memberName,title:'',basis,native,records:[],children:[],partial:page.hasPrevious||page.hasMore||page.total>page.items.length,related:[],errorCount:0,result:null});
  for (const [member,records] of byMember) {
    records.sort((a,b)=>sequence(a)-sequence(b));
    let round:ProcessGroup|null=null, step:ProcessGroup|null=null, model:ProcessGroup|null=null, stepKey:string|null=null;
    let worked=false;
    const blocks=new Map<string,ProcessGroup>();
    const seed=seeds.get(member);
    const beginRound=(item:TaskRecord,basis:ProcessGroup['basis'],ref:TaskNativeRef|null,key:string,title:string)=>{
      round=make('round',key,item,basis,ref);round.title=title;roots.push(round);step=null;model=null;stepKey=null;worked=false;blocks.clear();
    };
    for (const item of records) {
      const fact:TaskRecordStructure|undefined=facts.get(item.id);
      if (!round) beginRound(item,isInput(item)?'user_input':seed?'continued':fact?.round?'native':'unavailable',fact?.round??null,
        'round:'+member+':'+(isInput(item)?item.id:seed?.recordId??item.id),isInput(item)?processRecordTitle(item):seed?.title??'');
      let current=round! as ProcessGroup;
      const nativeChanged=fact?.round&&current.native&&nativeKey(fact.round)!==nativeKey(current.native);
      if (nativeChanged || isInput(item)&&worked) {
        beginRound(item,isInput(item)?'user_input':'native',fact?.round??null,'round:'+member+':'+item.id,isInput(item)?processRecordTitle(item):'');current=round!;
      }
      if (fact?.round&&!current.native) current.native=fact.round;
      if (item.importedTurn) { if (current.records.length) {beginRound(item,'native',null,'round:'+member+':'+item.id,processRecordTitle(item));current=round!;} }
      current.records.push(item);
      if (isInput(item)) {
        current.children.push(item);
        if (!current.title||wrapping(current.title)&&!wrapping(processRecordTitle(item))) current.title=processRecordTitle(item);
        model=null;continue;
      }
      const nextKey=item.event?.turnKey??null;
      if (!step || nextKey!==null&&nextKey!==stepKey) {
        step=make('step','step:'+member+':'+(nextKey??item.id),item,nextKey?'decision_key':'unavailable');
        current.children.push(step);stepKey=nextKey;model=null;blocks.clear();
      }
      const activeStep=step as ProcessGroup;activeStep.records.push(item);
      if (isContext(item)) {
        if (fact?.attempt) worked=true;
        const k='context:'+activeStep.key;
        let group=blocks.get(k);if (!group){group=make('context',k,item,'unavailable');blocks.set(k,group);activeStep.children.push(group);}
        group.records.push(item);group.children.push(item);continue;
      }
      worked=true;
      if (isModel(item)) {
        const k=fact?.attempt?'attempt:'+member+':'+activeStep.key+':'+nativeKey(fact.attempt):null;
        if (k) {model=blocks.get(k)??make('attempt',k,item,'native',fact!.attempt);if(!blocks.has(k)){blocks.set(k,model);activeStep.children.push(model);}}
        else if (!model||model.kind==='attempt') {model=make('model','model:'+item.id,item,'unavailable');activeStep.children.push(model);}
        model.records.push(item);model.children.push(item);if(item.event?.kind!=='reasoning')model.title=processRecordTitle(item);
      } else if (isTool(item)) {
        model=null;
        const k=fact?.tool&&fact.pairing==='exact'?'tool:'+member+':'+activeStep.key+':'+nativeKey(fact.tool):'tool:'+item.id;
        let group=blocks.get(k);if(!group){group=make('tool',k,item,fact?.tool&&fact.pairing==='exact'?'native':'unavailable',fact?.tool??null);const title=processRecordTitle(item),tool=item.event?.tool;group.title=tool&&title!==tool?`${tool} · ${title}`:tool??title;blocks.set(k,group);activeStep.children.push(group);}
        group.records.push(item);group.children.push(item);group.related=fact?.pairing==='exact'?fact.relatedRecordIds:[];
        if(group.related.some(id=>!page.items.some(value=>value.id===id)))group.partial=true;
      } else { model=null;activeStep.children.push(item); }
    }
  }
  const settle=(group:ProcessGroup):void=>{
    if(group.kind==='step'&&group.basis==='decision_key'){
      const models=group.children.filter(isProcessGroup).filter(child=>child.kind==='model');
      const candidates=new Map(group.records.flatMap(item=>{const candidate=facts.get(item.id)?.attempt;return candidate?[[nativeKey(candidate),candidate] as const]:[];}));
      // A unique response/request on a bookkeeping row can associate ONE model
      // observation block in the same declared step. This is labelled association,
      // never direct identity or a count of invisible provider retries.
      if(models.length<=1&&candidates.size===1&&!group.children.some(child=>isProcessGroup(child)&&child.kind==='attempt')&&(models.length===1||group.records.some(item=>facts.get(item.id)?.attempt&&isContext(item)))){
        const native=[...candidates.values()][0]!;
        const carriers=group.records.filter(item=>facts.get(item.id)?.attempt&&isContext(item));
        const model=models[0]??{...group,key:'response:'+group.key,kind:'attempt' as const,title:`${native.kind} ${native.value}`,records:[],children:[],related:[]};
        if(models.length===0)group.children.unshift(model);
        model.kind='attempt';model.basis='decision_key';model.native=native;
        if(carriers.length){
          const ids=new Set(carriers.map(item=>item.id));
          for(const child of group.children)if(isProcessGroup(child)&&child.kind==='context'){child.records=child.records.filter(item=>!ids.has(item.id));child.children=child.children.filter(item=>isProcessGroup(item)||!ids.has(item.id));}
          group.children=group.children.filter(child=>!isProcessGroup(child)||child===model||child.records.length>0);
          model.records.push(...carriers);model.records.sort((a,b)=>sequence(a)-sequence(b));
          model.children.push({ ...model, key:'identity:'+model.key, kind:'context', records:carriers, children:carriers, native:null, related:[] });
        }
      }
    }
    group.errorCount=group.records.filter(error).length;
    const outputs=group.records.filter(item=>item.event?.hasOutput||item.importedTurn?.hasOutput);
    const last=outputs.at(-1);group.result=['attempt','model','tool'].includes(group.kind)?last?.event?.status??(last?.importedTurn?.isError===true?'error':last?.importedTurn?.isError===false?'success':null):null;
    for(const child of group.children)if(isProcessGroup(child))settle(child);
    if((group.kind==='attempt'||group.kind==='model')&&!group.title)group.title=group.records.find(item=>!isContext(item))?.event?.title??'';
    if(group.kind==='step')group.title=group.children.filter(isProcessGroup).find(child=>['attempt','model'].includes(child.kind)&&child.title)?.title??group.records.find(item=>!isContext(item))?.event?.title??'';
  };
  roots.forEach(settle);
  return roots.sort((a,b)=>(processTime(a.records[0]!)??Infinity)-(processTime(b.records[0]!)??Infinity)||a.memberName.localeCompare(b.memberName));
}

/** Parent headers survive filters. Only retained original rows are selectable. */
export function flattenTaskProcess(groups:ProcessGroup[],collapsed:ReadonlySet<string>,selected:string|null):ProcessRow[] {
  const rows:ProcessRow[]=[];
  const visit=(group:ProcessGroup,depth:number)=>{
    rows.push({key:group.key,depth,group,record:null});
    const contains=selected!==null&&group.records.some(item=>item.id===selected);
    const closed=collapsed.has(group.key)||(!collapsed.has('open:'+group.key)&&['model','attempt','tool','context'].includes(group.kind));
    if(collapsed.has(group.key)||closed&&!contains)return;
    for(const child of group.children)if(isProcessGroup(child))visit(child,depth+1);else rows.push({key:child.id,depth:depth+1,group:null,record:child});
  };
  for(const group of groups)visit(group,0);return rows;
}

/** Stable clock-domain operations, shared by pointer, wheel and keyboard input. */
export function fitTimeRange(domain:[number,number],range:[number,number]):[number,number] {
  const span=Math.max(1,domain[1]-domain[0]),width=Math.min(span,Math.max(1,range[1]-range[0]));
  const start=Math.max(domain[0],Math.min(domain[1]-width,range[0]));return[start,start+width];
}
export function zoomTimeRange(domain:[number,number],view:[number,number],factor:number,anchor=0.5):[number,number] {
  const width=Math.max(Math.min(10,domain[1]-domain[0]),Math.min(domain[1]-domain[0],(view[1]-view[0])*factor));
  const point=view[0]+(view[1]-view[0])*anchor;return fitTimeRange(domain,[point-width*anchor,point+width*(1-anchor)]);
}
