import { useCallback, useEffect, useRef, useState } from 'react';
/** Abortable resource preserves its last good value during SSE refresh. */
export function useRsiRead<T>(key: string | null, read: (signal: AbortSignal) => Promise<T>, revision = 0) {
  const [state,setState]=useState<{key:string;value:T|null;error:unknown;loading:boolean}>({key:'',value:null,error:null,loading:true});
  const [retryKey,setRetry]=useState(0), current=useRef(read);current.current=read;
  useEffect(()=>{
    if(key===null)return;
    const controller=new AbortController();setState(old=>({key,value:old.key===key?old.value:null,error:null,loading:true}));
    void current.current(controller.signal).then(value=>{if(!controller.signal.aborted)setState({key,value,error:null,loading:false});}).catch((error:unknown)=>{if(!controller.signal.aborted)setState(old=>({...old,key,error,loading:false}));});
    return ()=>controller.abort();
  },[key,revision,retryKey]);
  return {value:state.key===key?state.value:null,error:state.key===key?state.error:null,loading:key!==null&&(state.key!==key||state.loading),retry:useCallback(()=>setRetry(n=>n+1),[])};
}
