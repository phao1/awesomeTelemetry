import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TaskRecord, TaskRecordPage } from '../../core/task-types.js';
import { deriveTaskProcess, flattenTaskProcess, isProcessGroup, processInterval, processRecordTitle, type ProcessGroup } from '../../core/task-process.js';
import type { Locale } from '../../i18n.js';
import { processCopy } from './process-copy.js';

export interface ProcessLedgerHandle { locate: (id:string)=>boolean }
const stamp=(value:string|undefined,locale:Locale)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleTimeString(locale==='zh'?'zh-CN':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';

/** A single virtual row stream. Disclosures never load original bodies. */
export function ProcessLedger({page,selected,locale,onSelect,onAnchor,onUserScroll,ref}:{
  page:TaskRecordPage;selected:string|null;locale:Locale;onSelect:(item:TaskRecord)=>void;
  onAnchor:(id:string)=>void;onUserScroll:()=>void;ref?:Ref<ProcessLedgerHandle>;
}) {
  const c=processCopy(locale),parent=useRef<HTMLDivElement>(null),[folded,setFolded]=useState<Set<string>>(new Set());
  const groups=useMemo(()=>deriveTaskProcess(page),[page]);
  const all=useMemo(()=>{const values:ProcessGroup[]=[];const visit=(group:ProcessGroup)=>{values.push(group);group.children.forEach(child=>{if(isProcessGroup(child))visit(child);});};groups.forEach(visit);return values;},[groups]);
  const numbers=useMemo(()=>{const map=new Map<string,number>();groups.forEach((round,index)=>{map.set(round.key,index+1);round.children.filter(isProcessGroup).filter(group=>group.kind==='step').forEach((step,n)=>map.set(step.key,n+1));});return map;},[groups]);
  const rows=useMemo(()=>flattenTaskProcess(groups,folded,selected),[groups,folded,selected]);
  const list=useVirtualizer({count:rows.length,getScrollElement:()=>parent.current,estimateSize:index=>rows[index]?.group?.kind==='step'?32:44,overscan:5,getItemKey:index=>rows[index]!.key});
  const lastSelected=useRef<string|null>(null),lastWindow=useRef(''),positioned=useRef(''),focused=useRef<string|null>(null),pendingLocate=useRef<string|null>(null);
  useEffect(()=>{
    if(lastWindow.current!==page.window){lastWindow.current=page.window;setFolded(new Set());}
  },[page.window]);
  useEffect(()=>{
    if(selected&&selected!==lastSelected.current){setFolded(current=>{const next=new Set(current);for(const group of all)if(group.records.some(item=>item.id===selected)){next.delete(group.key);next.add('open:'+group.key);}return next;});}
    lastSelected.current=selected;
  },[all,selected]);
  useEffect(()=>{
    const identity=page.window+':'+page.offset,target=pendingLocate.current??selected;
    if(positioned.current===identity&&focused.current===selected&&!pendingLocate.current)return;
    if(target){const at=rows.findIndex(row=>row.record?.id===target);if(at<0)return;list.scrollToIndex(at,{align:'auto'});}
    else if(rows.length)list.scrollToIndex(rows.length-1,{align:'end'});
    positioned.current=identity;focused.current=selected;pendingLocate.current=null;
  },[selected,rows,list,page.window,page.offset]);
  useImperativeHandle(ref,()=>({locate:(id)=>{
    const related=all.filter(group=>group.records.some(item=>item.id===id));if(!related.length)return false;
    pendingLocate.current=id;
    setFolded(current=>{const next=new Set(current);related.forEach(group=>{next.delete(group.key);next.add('open:'+group.key);});return next;});
    const at=rows.findIndex(row=>row.record?.id===id);if(at>=0)list.scrollToIndex(at,{align:'center'});return true;
  }}),[all,rows,list]);
  const toggle=(group:ProcessGroup)=>{
    const at=rows.findIndex(row=>row.key===group.key),open=at>=0&&rows[at+1]!==undefined&&rows[at+1]!.depth>rows[at]!.depth;
    setFolded(current=>{const next=new Set(current);if(open){next.add(group.key);next.delete('open:'+group.key);}else{next.delete(group.key);next.add('open:'+group.key);}return next;});
  };
  const name=(group:ProcessGroup)=>group.kind==='round'?`${group.records[0]?.importedTurn?c.importedRound:group.basis==='continued'?c.continued:group.basis==='unavailable'?c.noRound:c.round} ${numbers.get(group.key)}`:group.kind==='step'?group.basis==='decision_key'?`${c.step} ${numbers.get(group.key)}`:c.noStep:group.kind==='attempt'?c.attempt:group.kind==='model'?c.model:group.kind==='tool'?c.tool:c.context;
  const inspected=(group:ProcessGroup)=>group.records.filter(item=>item.event?.hasOutput||item.importedTurn?.hasOutput).at(-1)??group.records[0]!;
  return <><div className="process-ledger-summary"><span>{page.items.length} {c.rows} · <b>{groups.length}</b> {c.roundCount} · <b>{all.filter(group=>group.kind==='step').length}</b> {c.stepCount} · {all.some(group=>group.kind==='attempt')?<><b>{all.filter(group=>group.kind==='attempt').length}</b> {c.attempts}</>:c.noAttempt}</span><div><button type="button" onClick={()=>setFolded(new Set(all.map(group=>'open:'+group.key)))}>{c.expandAll}</button><button type="button" onClick={()=>setFolded(new Set(all.map(group=>group.key)))}>{c.collapseAll}</button></div></div>
    <div className="task-record-scroll process-ledger" ref={parent} onWheel={onUserScroll} onTouchStart={onUserScroll} role="region" aria-label={c.process}>
      <div style={{height:list.getTotalSize(),position:'relative'}}>{list.getVirtualItems().map(row=>{
        const value=rows[row.index]!,group=value.group,item=value.record;
        const open=group&&row.index+1<rows.length&&rows[row.index+1]!.depth>value.depth;
        const usage=group?.records.filter(record=>Number.isFinite(record.event?.tokens?.total)&&(record.event?.tokens?.total??-1)>=0)??[];
        const intervals=group?.records.flatMap(record=>{const value=processInterval(record);return value?[value]:[];})??[];
        const span=intervals.length?Math.max(...intervals.map(value=>value[1]))-Math.min(...intervals.map(value=>value[0])):0;
        return <div key={value.key} className={`process-row ${group?'process-group process-'+group.kind:'process-observation'} ${item?.id===selected?'is-selected':''}`} style={{position:'absolute',width:'100%',height:row.size,transform:`translateY(${row.start}px)`,paddingInlineStart:`${Math.min(3,value.depth)*0.75+0.75}rem`}}>
          {group?<><button type="button" className="process-fold" aria-label={`${open?c.fold:c.unfold} ${name(group)} ${group.title}`} aria-expanded={Boolean(open)} onClick={()=>toggle(group)}>{open?'⌄':'›'}</button><span className="process-group-kind">{name(group)}</span>
            <button type="button" className="process-group-title" title={group.title||group.native?.value} onClick={()=>onSelect(inspected(group))} aria-label={`${c.inspect}: ${processRecordTitle(inspected(group))}`}><strong>{group.title||group.memberName}</strong><small>{group.memberName}{group.kind==='step'?` · ${group.basis==='decision_key'?c.decision:c.noStep}`:group.kind==='model'?` · ${c.noAttempt}`:group.kind==='attempt'&&!group.records.some(item=>item.event?.hasOutput||item.importedTurn?.hasOutput)?` · ${c.noModelText}`:group.kind==='tool'?` · ${group.records.filter(item=>item.event?.hasInput).length} ${c.inputRecords} / ${group.records.filter(item=>item.event?.hasOutput).length} ${c.outputRecords}${group.basis==='unavailable'?` · ${c.unpaired}`:''}`:''}</small></button>
            {group.errorCount>0&&<span className="process-error-count">! {group.errorCount} {c.errors}</span>}
            {['attempt','model','tool'].includes(group.kind)&&<span className="process-group-metrics" title={c.logTiming}>{usage.length===1?<span title={c.tokensSource}>{usage[0]!.event!.tokens!.total.toLocaleString()} Tok</span>:usage.length>1?<span>{usage.length} {c.usageRecords}</span>:null}{span>0&&group.records.some(item=>item.event?.hasInput||item.event?.hasOutput||item.importedTurn?.hasOutput)&&<span>{c.logSpan} {(span/1000).toFixed(1)}s</span>}{group.result&&<span className={group.result==='error'?'process-result-error':group.result==='success'?'process-result':'process-result-unknown'} title={group.result==='success'?c.resultSuccess:group.result==='error'?c.resultError:c.resultUnknown}>{group.result==='success'?'✓':group.result==='error'?'!':'◷'}</span>}</span>}
            {group.native&&<span className="process-native" title={`${group.basis==='decision_key'?c.derived+' · ':''}${JSON.stringify(group.native)}`}>{group.basis==='decision_key'?c.associated:c.exact}</span>}
            {group.related.some(id=>!page.items.some(item=>item.id===id))&&<button type="button" className="process-original-link" title={c.earlier} aria-label={c.earlier} onClick={()=>{const id=group.related.find(id=>!page.items.some(item=>item.id===id));if(id)onAnchor(id);}}>↗</button>}{group.partial&&<span className="process-partial" title={c.scope}>◐</span>}<span className="process-count">{group.records.length}</span>
          </>:item&&<><span className={`process-kind-icon ${item.event?.kind??'llm'}`}>{item.event?.kind==='user_prompt'?'U':item.event?.tool?'⌘':item.event?.kind==='reasoning'?'◇':'✦'}</span><button type="button" className="process-record-button" data-record-id={item.id} aria-label={`${c.inspect}: ${processRecordTitle(item)}`} aria-current={item.id===selected?'true':undefined} onClick={()=>onSelect(item)}><span>{processRecordTitle(item)}</span><small>{item.memberName} · #{item.event?.sequence??item.importedTurn?.sequence}{item.event?.hasInput?` · ${c.input}`:''}{item.event?.hasOutput?` · ${c.result}`:''}</small></button><time>{stamp(item.event?.startedAt??item.importedTurn?.requestTime??undefined,locale)}</time>{item.event?.status==='error'&&<span className="process-error-count">!</span>}
            {all.find(group=>group.kind==='tool'&&group.records.some(value=>value.id===item.id))?.related.some(id=>!page.items.some(value=>value.id===id))&&<button type="button" className="process-original-link" title={c.earlier} onClick={()=>{const group=all.find(group=>group.kind==='tool'&&group.records.some(value=>value.id===item.id));const target=group?.related.find(id=>!page.items.some(value=>value.id===id));if(target)onAnchor(target);}}>↗</button>}
          </>}
        </div>;
      })}</div>
    </div><p className="process-scope-note">{c.scope}</p></>;
}
