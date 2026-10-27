import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { TaskRecord, TaskTimeBin, TaskTimeline } from '../../core/task-types.js';
import { fitTimeRange, processInterval, processRecordTitle, zoomTimeRange } from '../../core/task-process.js';
import type { Locale } from '../../i18n.js';
import { processCopy } from './process-copy.js';

type Range=[number,number];
type Category='input'|'model'|'tool'|'other';
interface Lane { id:string;label:string;bins:TaskTimeBin[];category?:Category }
interface Gesture { pointer:number;x:number;time:number;view:Range;pan:boolean;record:string|null }
const categories:Category[]=['input','model','tool','other'];
const count=(bin:TaskTimeBin)=>bin.input+bin.model+bin.tool+bin.other;
const format=(time:number,locale:Locale)=>new Date(time).toLocaleTimeString(locale==='zh'?'zh-CN':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const category=(record:TaskRecord):Category=>record.event?.kind==='user_prompt'?'input':record.event&&((record.event.kind==='llm'&&record.event.title==='token_count'&&!record.event.hasOutput)||(record.event.kind==='reasoning'&&!record.event.title&&!record.event.hasOutput))?'other':!record.event||['llm','reasoning','message'].includes(record.event.kind)?'model':['tool','bash','file_read','file_write','test'].includes(record.event.kind)?'tool':'other';

/** DSH-inspired overview/detail composition, with full-scope density distinct
 * from exact loaded records. All gesture modes share one unclipped clock model. */
export function TaskTimeNavigator({timeline,loading,error,onRetry,records,selected,range,onRangeChange,onSelect,locale,mainMemberId}:{
  timeline:TaskTimeline|null;loading:boolean;error:string|null;onRetry:()=>void;
  records:TaskRecord[];selected:string|null;range:Range|null;onRangeChange:(range:Range|null)=>void;
  onSelect:(item:TaskRecord)=>void;locale:Locale;mainMemberId?:string;
}) {
  const c=processCopy(locale),track=useRef<SVGSVGElement>(null),gesture=useRef<Gesture|null>(null);
  const initialFocus=useRef(false),pointerClick=useRef(false);
  const [view,setView]=useState<Range|null>(null),[draft,setDraft]=useState<Range|null>(null),[mode,setMode]=useState<'activity'|'members'>('activity'),[memberPage,setMemberPage]=useState(0),[showOther,setShowOther]=useState(false),[hover,setHover]=useState<{time:number;id:string|null}|null>(null);
  const autoMode=useRef(false),adjusted=useRef(false);
  const [tooltip,setTooltip]=useState<TaskRecord|null>(null);
  useEffect(()=>{
    setTooltip(null);if(!hover?.id)return;
    const record=records.find(value=>value.id===hover.id);if(!record)return;
    const timer=setTimeout(()=>setTooltip(record),300);return()=>clearTimeout(timer);
  },[hover?.id,records]);
  const timed=useMemo(()=>records.flatMap(record=>{const interval=processInterval(record);return interval?[{record,interval}]:[];}).sort((a,b)=>a.interval[0]-b.interval[0]),[records]);
  const domain=useMemo<Range>(()=>{
    const start=Date.parse(timeline?.from??''),end=Date.parse(timeline?.to??'');
    if(Number.isFinite(start)&&Number.isFinite(end))return[start,Math.max(start+1,end)];
    if(!timed.length)return[0,1];
    return[Math.min(...timed.map(value=>value.interval[0])),Math.max(...timed.map(value=>value.interval[1]),timed[0]!.interval[0]+1)];
  },[timeline?.from,timeline?.to,timed]);
  const current=view?fitTimeRange(domain,view):domain,width=Math.max(1,current[1]-current[0]),fullWidth=Math.max(1,domain[1]-domain[0]);
  const state=useRef({domain,current});state.current={domain,current};
  const selectedRecord=timed.find(value=>value.record.id===selected);
  const memberLanes=useMemo(()=>[...(timeline?.lanes??[])].sort((a,b)=>Number(b.memberId===mainMemberId)-Number(a.memberId===mainMemberId)||a.name.localeCompare(b.name)),[timeline?.lanes,mainMemberId]);
  const combined=useMemo(()=>{
    const bins=new Map<number,TaskTimeBin>();
    for(const lane of timeline?.lanes??[])for(const value of lane.bins){const bin=bins.get(value.index)??{index:value.index,input:0,model:0,tool:0,other:0,errors:0};for(const kind of [...categories,'errors'] as const)bin[kind]+=value[kind];bins.set(bin.index,bin);}
    return[...bins.values()].sort((a,b)=>a.index-b.index);
  },[timeline?.lanes]);
  useEffect(()=>{if(timeline&&!autoMode.current){autoMode.current=true;if(timeline.lanes.length>1)setMode('members');}},[timeline]);
  useEffect(()=>{setView(value=>adjusted.current&&value?fitTimeRange(domain,value):null);},[domain]);
  useEffect(()=>{
    if(!selectedRecord)return;
    const [start,end]=selectedRecord.interval;
    setView(value=>{if(!value||end>=value[0]&&start<=value[1])return value;const span=value[1]-value[0];return fitTimeRange(domain,[start-span/2,start+span/2]);});
    const member=memberLanes.findIndex(lane=>lane.memberId===selectedRecord.record.memberId);if(member>=0)setMemberPage(Math.floor(member/3));
  },[selected,selectedRecord?.interval[0],domain,memberLanes]);
  useEffect(()=>{
    const node=track.current;if(!node)return;
    const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();const rect=node.getBoundingClientRect(),anchor=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));adjusted.current=true;setView(zoomTimeRange(state.current.domain,state.current.current,Math.exp(Math.max(-1,Math.min(1,event.deltaY*0.003))),anchor));};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[timeline?.from,timed.length]);
  useEffect(()=>{
    if(initialFocus.current||!timeline?.from||!timed.length)return;
    initialFocus.current=true;
    const first=Math.min(...timed.map(value=>value.interval[0])),last=Math.max(...timed.map(value=>value.interval[1])),span=Math.max(1000,last-first);
    if(last-first<fullWidth*0.8){adjusted.current=true;setView(fitTimeRange(domain,[first-span*0.06,last+span*0.06]));}
  },[timeline?.from,timed,domain,fullWidth]);
  const reset=()=>{adjusted.current=false;setView(null);setDraft(null);};
  const zoom=(factor:number)=>{adjusted.current=true;setView(zoomTimeRange(domain,current,factor));};
  const pan=(direction:number)=>{adjusted.current=true;setView(fitTimeRange(domain,[current[0]+direction*width/4,current[1]+direction*width/4]));};
  const fraction=(x:number)=>{const rect=track.current?.getBoundingClientRect();return Math.max(0,Math.min(1,(x-(rect?.left??0))/Math.max(1,rect?.width??1)));};
  const timeAt=(x:number)=>current[0]+fraction(x)*width;
  const elementRecord=(event:PointerEvent<SVGSVGElement>)=>event.target instanceof Element?event.target.closest('[data-record-id]')?.getAttribute('data-record-id')??null:null;
  const down=(event:PointerEvent<SVGSVGElement>)=>{
    if(event.button!==0&&event.button!==2)return;event.preventDefault();
    event.currentTarget.focus();pointerClick.current=false;
    gesture.current={pointer:event.pointerId,x:event.clientX,time:timeAt(event.clientX),view:current,pan:event.button===2||event.altKey,record:elementRecord(event)};
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move=(event:PointerEvent<SVGSVGElement>)=>{
    const active=gesture.current;setHover({time:timeAt(event.clientX),id:elementRecord(event)});
    if(!active||active.pointer!==event.pointerId)return;
    if(active.pan){const rect=event.currentTarget.getBoundingClientRect(),delta=(event.clientX-active.x)/Math.max(1,rect.width)*(active.view[1]-active.view[0]);adjusted.current=true;setView(fitTimeRange(domain,[active.view[0]-delta,active.view[1]-delta]));}
    else if(Math.abs(event.clientX-active.x)>=4){const at=timeAt(event.clientX);setDraft([Math.min(active.time,at),Math.max(active.time,at)]);}
  };
  const finish=(event:PointerEvent<SVGSVGElement>)=>{
    const active=gesture.current;if(!active||active.pointer!==event.pointerId)return;gesture.current=null;setDraft(null);pointerClick.current=true;
    if(active.pan)return;
    if(Math.abs(event.clientX-active.x)<4){
      const exact=records.find(item=>item.id===active.record);if(exact){onSelect(exact);return;}
      const bucket=fullWidth/(timeline?.bins??160),index=Math.min(159,Math.max(0,Math.floor((active.time-domain[0])/bucket)));
      onRangeChange([Math.floor(domain[0]+index*bucket),Math.ceil(Math.min(domain[1],domain[0]+(index+1)*bucket))]);
    }else{const at=timeAt(event.clientX);onRangeChange([Math.floor(Math.min(active.time,at)),Math.ceil(Math.max(active.time,at))]);}
  };
  const keyDown=(event:KeyboardEvent<SVGSVGElement>)=>{
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(0.5);}else if(event.key==='-'){event.preventDefault();zoom(2);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();pan(event.key==='ArrowLeft'?-1:1);}
    else if(event.key==='Home'||event.key==='0'){event.preventDefault();reset();}
    else if(event.key==='Escape'){event.preventDefault();gesture.current=null;setDraft(null);onRangeChange(null);}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const at=timed.findIndex(value=>value.record.id===selected),next=timed[Math.max(0,Math.min(timed.length-1,at+(event.key==='ArrowUp'?-1:1)))];if(next)onSelect(next.record);}
  };
  const lanes:Lane[]=mode==='members'&&memberLanes.length?memberLanes.slice(memberPage*3,memberPage*3+3).map(lane=>({id:lane.memberId,label:lane.name,bins:lane.bins})):(showOther?categories:categories.slice(0,3)).map(kind=>({id:kind,label:c[kind],bins:combined,category:kind}));
  const height=Math.max(1,lanes.length)*22,activeRange=draft??range;
  const visibleCount=(bin:TaskTimeBin)=>bin.input+bin.model+bin.tool+(showOther?bin.other:0);
  const paths=(lane:Lane,row:number):Record<Category,string>=>{
    const result={input:'',model:'',tool:'',other:''},maximum=Math.max(1,...lane.bins.map(bin=>lane.category?bin[lane.category]:visibleCount(bin)));
    for(const bin of lane.bins){const start=domain[0]+fullWidth*bin.index/160,end=domain[0]+fullWidth*(bin.index+1)/160;if(end<current[0]||start>current[1])continue;const x=Math.max(0,(start-current[0])/width*1000),right=Math.min(1000,(end-current[0])/width*1000);let y=row*22+19;
      for(const kind of lane.category?[lane.category]:(showOther?categories:categories.slice(0,3))){const n=bin[kind];if(!n)continue;const h=Math.max(0.7,n/maximum*14);result[kind]+=`M${x.toFixed(2)},${y.toFixed(2)}h${Math.max(0.5,right-x).toFixed(2)}v-${h.toFixed(2)}h-${Math.max(0.5,right-x).toFixed(2)}Z`;y-=h;}}
    return result;
  };
  const overviewMax=Math.max(1,...combined.map(visibleCount)),overviewPath=combined.map(bin=>{const h=visibleCount(bin)/overviewMax*14;return`M${bin.index/160*1000},16h6.25v-${h}h-6.25Z`;}).join('');
  const currentMarks=timed.flatMap(value=>{if(!showOther&&category(value.record)==='other'&&value.record.id!==selected)return[];const lane=lanes.findIndex(lane=>mode==='members'?lane.id===value.record.memberId:lane.id===category(value.record));if(lane<0||value.interval[1]<current[0]||value.interval[0]>current[1])return[];return[{...value,lane}];});
  const hoverRecord=records.find(value=>value.id===hover?.id),hoverIndex=hover?Math.min(159,Math.max(0,Math.floor((hover.time-domain[0])/fullWidth*160))):-1,hoverCount=combined.find(bin=>bin.index===hoverIndex);
  const available=Boolean(timeline?.from)||timed.length>0;
  return <section className="process-time-navigator" aria-label={c.overview}>
    <header><div><strong>{timeline?c.overview:c.pageTime}</strong><span>{timeline?`${timeline.total.toLocaleString()} ${c.observation}`:`${records.length} ${c.observation}`}</span>{timeline&&<span>{c.coverage} {timeline.coverage.loadedMembers}/{timeline.coverage.totalMembers}</span>}</div><div className="process-time-controls"><button type="button" aria-pressed={mode==='activity'} onClick={()=>setMode('activity')}>{c.activity}</button><button type="button" aria-pressed={mode==='members'} disabled={memberLanes.length<2} onClick={()=>setMode('members')}>{c.members}</button><button type="button" aria-label={c.zoomIn} title={c.zoomIn} disabled={!available} onClick={()=>zoom(0.5)}>＋</button><button type="button" aria-label={c.zoomOut} title={c.zoomOut} disabled={!available} onClick={()=>zoom(2)}>−</button><button type="button" aria-label={c.panLeft} title={c.panLeft} disabled={!available} onClick={()=>pan(-1)}>←</button><button type="button" aria-label={c.panRight} title={c.panRight} disabled={!available} onClick={()=>pan(1)}>→</button><button type="button" onClick={reset} disabled={!available}>{c.full}</button></div></header>
    {loading&&<span className="process-time-loading" role="status">{c.loading}</span>}{error&&<div className="process-time-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>{c.retry}</button></div>}
    {available?<><div className="process-time-overview"><span>{c.density}</span><svg viewBox="0 0 1000 18" preserveAspectRatio="none" role="button" tabIndex={0} aria-label={c.fit} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();reset();}}} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect(),center=domain[0]+Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)))*fullWidth;adjusted.current=true;setView(fitTimeRange(domain,[center-width/2,center+width/2]));}}><path d={overviewPath} className="process-density"/><rect x={(current[0]-domain[0])/fullWidth*1000} width={width/fullWidth*1000} y="0" height="18" className="process-viewport"/>{range&&<rect x={(range[0]-domain[0])/fullWidth*1000} width={Math.max(1,(range[1]-range[0])/fullWidth*1000)} y="0" height="18" className="process-global-selection"/>}</svg></div>
      <div className="process-time-chart"><div className="process-lane-labels">{lanes.map(lane=><span key={lane.id} title={lane.label}>{lane.label}</span>)}</div><svg ref={track} className="process-time-track" style={{height}} viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" tabIndex={0} role="group" aria-label={`${c.overview}. ${c.keyboard}`} onKeyDown={keyDown} onClick={()=>{pointerClick.current=false;}} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setDraft(null);}} onPointerLeave={()=>{if(!gesture.current)setHover(null);}} onContextMenu={event=>event.preventDefault()} onDoubleClick={()=>{reset();onRangeChange(null);}}>
        {Array.from({length:6},(_,i)=><line key={i} x1={i*200} x2={i*200} y1="0" y2={height} className="process-grid"/>)}
        {lanes.map((lane,i)=><g key={lane.id}>{categories.map(kind=><path key={kind} d={paths(lane,i)[kind]} className={`process-histogram ${kind}`}/>)}<line x1="0" x2="1000" y1={(i+1)*22} y2={(i+1)*22} className="process-grid"/></g>)}
        {currentMarks.map(({record,interval,lane})=>{const x=Math.max(0,(interval[0]-current[0])/width*1000),right=Math.min(1000,(interval[1]-current[0])/width*1000),point=interval[0]===interval[1],isSelected=record.id===selected;return<rect key={record.id} data-record-id={record.id} role="button" aria-label={`${c.marks}: ${processRecordTitle(record)}`} tabIndex={isSelected?0:-1} onClick={()=>{if(!pointerClick.current)onSelect(record);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onSelect(record);}}} x={Math.min(x,1000-Math.max(point?3:2,right-x))} y={lane*22+6} width={Math.max(point?3:2,right-x)} height="9" rx={point?1.5:0.7} className={`process-exact ${category(record)} ${isSelected?'is-selected':''} ${record.event?.status==='error'||record.importedTurn?.isError?'has-error':''} ${point?'is-point':''}`}/>;})}
        {activeRange&&<rect className="process-time-selection" x={Math.max(0,(activeRange[0]-current[0])/width*1000)} y="0" width={Math.max(1,Math.min(1000,(activeRange[1]-current[0])/width*1000)-Math.max(0,(activeRange[0]-current[0])/width*1000))} height={height}/>}
        {hover&&<line x1={(hover.time-current[0])/width*1000} x2={(hover.time-current[0])/width*1000} y1="0" y2={height} className="process-hover-line"/>}
      </svg></div><div className="process-time-axis"><span/>{Array.from({length:5},(_,i)=><time key={i}>{width>86400000?new Date(current[0]+width*i/4).toLocaleString(locale==='zh'?'zh-CN':'en-GB',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):format(current[0]+width*i/4,locale)}</time>)}</div>
      <div className="process-time-footer"><span title={`${c.histogram} ${c.logTiming}`}>{hover?`${format(hover.time,locale)} · ${hoverRecord?processRecordTitle(hoverRecord):`${hoverCount?count(hoverCount):0} ${c.observation}`}`:`${new Date(current[0]).toLocaleDateString(locale==='zh'?'zh-CN':'en-GB',{month:'short',day:'numeric'})} · ${c.help}`}</span>{mode==='members'&&memberLanes.length>3&&<div><button type="button" aria-label={`${c.panLeft} ${c.members}`} disabled={memberPage===0} onClick={()=>setMemberPage(value=>value-1)}>‹</button><span>{memberPage*3+1}–{Math.min(memberLanes.length,memberPage*3+3)}/{memberLanes.length}</span><button type="button" aria-label={`${c.panRight} ${c.members}`} disabled={(memberPage+1)*3>=memberLanes.length} onClick={()=>setMemberPage(value=>value+1)}>›</button></div>}</div>
      <div className="process-time-range-controls">{range&&<><span>{c.timeSelected}: {format(range[0],locale)} — {format(range[1],locale)}</span><button type="button" onClick={()=>{adjusted.current=true;setView(fitTimeRange(domain,range));}}>{c.focus}</button><button type="button" onClick={()=>onRangeChange(null)}>{c.clear}</button></>}
        <details><summary>{c.range}</summary><label>{c.from}<input type="range" min="0" max="1000" value={Math.max(0,Math.min(1000,((range?.[0]??domain[0])-domain[0])/fullWidth*1000))} onChange={event=>onRangeChange([Math.min(range?.[1]??domain[1],Math.round(domain[0]+Number(event.target.value)/1000*fullWidth)),range?.[1]??domain[1]])}/></label><label>{c.to}<input type="range" min="0" max="1000" value={Math.max(0,Math.min(1000,((range?.[1]??domain[1])-domain[0])/fullWidth*1000))} onChange={event=>onRangeChange([range?.[0]??domain[0],Math.max(range?.[0]??domain[0],Math.round(domain[0]+Number(event.target.value)/1000*fullWidth))])}/></label></details>
        {<label><input type="checkbox" checked={showOther} onChange={event=>setShowOther(event.target.checked)}/>{c.other}</label>}
        {(timeline?.untimed??records.length-timed.length)>0&&<span>{timeline?.untimed??records.length-timed.length} {c.unknownTime}</span>}
    </div></>:<p className="process-time-empty">{loading?c.loading:c.noTime}</p>}
    {tooltip&&<div role="tooltip" className="process-time-tooltip"><strong>{tooltip.memberName} · {processRecordTitle(tooltip)}</strong><code>{new Date(processInterval(tooltip)![0]).toLocaleString(locale==='zh'?'zh-CN':'en-GB',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3})}{processInterval(tooltip)![1]>processInterval(tooltip)![0]?` → ${new Date(processInterval(tooltip)![1]).toLocaleTimeString(locale==='zh'?'zh-CN':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3})}`:''}</code><span>{c.logTiming}</span></div>}
  </section>;
}
