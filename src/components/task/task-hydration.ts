import { useEffect, useRef, useState } from 'react';
import type { TaskHydrationFrame, TaskHydrationProgress, TaskSummary } from '../../core/task-types.js';

/** One cancellable metadata stream per page; no per-session fetches or polling. */
export async function streamTaskHydration(taskIds: string[], signal: AbortSignal, frame: (value: TaskHydrationFrame) => void): Promise<void> {
  const response = await fetch('/api/task-home/hydrate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskIds}),signal});
  if(!response.ok || !response.body)throw new Error('TASK_HYDRATION_UNAVAILABLE');
  const reader=response.body.getReader(),decoder=new TextDecoder(),pending=new Map<string,number>();let buffer='',bytes=0,done=false;
  try {
    while(!signal.aborted){
      const chunk=await reader.read();if(chunk.done)break;
      bytes+=chunk.value.byteLength;if(bytes>524288)throw new Error('TASK_HYDRATION_LIMIT');
      buffer+=decoder.decode(chunk.value,{stream:true});
      let newline:number;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
        const value=JSON.parse(line) as TaskHydrationFrame;
        if(!value||!Array.isArray(value.items)||value.items.length>50||typeof value.done!=='boolean'||value.items.some(item=>!taskIds.includes(item.taskId)||!Number.isSafeInteger(item.pending)||item.pending<0||item.pending>100||!Number.isSafeInteger(item.loaded)||item.loaded<0||item.loaded>100||!Array.isArray(item.reasons)||item.reasons.length>7||item.reasons.some(reason=>!['source_missing','source_unreadable','parse_failed','member_unavailable','cancelled','request_failed'].includes(reason))))throw new Error('TASK_HYDRATION_INVALID');
        if(new Set(value.items.map(item=>item.taskId)).size!==value.items.length)throw new Error('TASK_HYDRATION_INVALID');
        for(const item of value.items)pending.set(item.taskId,item.pending);
        if(value.done&&taskIds.some(id=>pending.get(id)!==0))throw new Error('TASK_HYDRATION_INVALID');
        if(!signal.aborted)frame(value);done=value.done;
        if(done)return;
      }
      if(buffer.length>262144)throw new Error('TASK_HYDRATION_LIMIT');
    }
    if(!signal.aborted&&!done)throw new Error('TASK_HYDRATION_INTERRUPTED');
  } finally {await reader.cancel().catch(error=>{if(!signal.aborted)console.error('[task-home] Progress reader cancellation failed',error);});reader.releaseLock();}
}

export function useTaskHydration(items: TaskSummary[] | undefined, scope: string | null, version: number, refresh: () => void) {
  const [visible,setVisible]=useState(()=>document.visibilityState!=='hidden');
  useEffect(()=>{const update=()=>setVisible(document.visibilityState!=='hidden');document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  const [retry,setRetry]=useState(0),[state,setState]=useState<{key:string;items:Record<string,TaskHydrationProgress>}>({key:'',items:{}});
  const ids=(items??[]).filter(t=>t.origin==='collected').map(t=>t.id),key=scope===null||!ids.length||!visible?null:JSON.stringify([scope,ids,retry]);
  const page=useRef(items);page.current=items;
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  const hints=useRef<(()=>void)|null>(null);
  useEffect(()=>{hints.current?.();},[version]);
  useEffect(()=>{
    if(key===null)return;
    const initial=page.current?.filter(t=>t.origin==='collected')??[];
    // Known pages need no lease and cannot trigger parsing on a mere rerender.
    if(!initial.some(t=>t.loadedMemberCount<t.memberCount)){setState({key,items:{}});return;}
    let current=true,dirty=false,lastRefresh=0;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const initialStates=Object.fromEntries(initial.map(t=>[t.id,{taskId:t.id,pending:Math.max(0,t.memberCount-t.loadedMemberCount),loaded:t.loadedMemberCount,reasons:[]} as TaskHydrationProgress]));
    setState({key,items:initialStates});
    const schedule=()=>{
      if(!current||timer||!dirty)return;
      timer=setTimeout(()=>{timer=undefined;if(current&&dirty){dirty=false;lastRefresh=Date.now();refreshRef.current();}},Math.max(200,3000-(Date.now()-lastRefresh)));
    };
    hints.current=()=>{if(current){dirty=true;schedule();}};
    const timeout=setTimeout(()=>controller.abort(),125000);
    void streamTaskHydration(initial.map(t=>t.id),controller.signal,value=>{
      if(!current)return;
      setState(old=>({key,items:{...(old.key===key?old.items:{}),...Object.fromEntries(value.items.map(item=>[item.taskId,item]))}}));
      if(value.items.some(item=>item.pending===0)){dirty=true;schedule();}
      if(value.done)hints.current=null;
    }).catch(error=>{
      if(!current)return;
      hints.current=null;
      console.error('[task-home] Page hydration unavailable',error);
      setState(old=>({key,items:Object.fromEntries(Object.entries(old.key===key?old.items:initialStates).map(([id,item])=>[id,item.pending?{...item,pending:0,reasons:['request_failed']}:item]))}));
    }).finally(()=>clearTimeout(timeout));
    return()=>{current=false;controller.abort();clearTimeout(timeout);clearTimeout(timer);hints.current=null;};
  },[key]);
  return {progress:state.key===key?state.items:{},restart:()=>setRetry(n=>n+1)};
}
