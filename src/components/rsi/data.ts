import { useCallback, useEffect, useRef, useState } from 'react';
import { rsiApi } from '../../core/rsi-api-client.js';
import type { RsiCliInfo } from '../../core/rsi-api-client.js';
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
/** The CLI invocation for the data this server shows. Loaded once; commands use placeholders until it arrives. */
let cliRequest: Promise<RsiCliInfo> | null = null;
export function useRsiCli(): RsiCliInfo {
  const [cli,setCli]=useState<RsiCliInfo>({bin:'rsi',root:'<config-root>',scripts:'scripts'});
  useEffect(()=>{
    let active=true;
    cliRequest??=rsiApi.options().then(options=>options.cli);
    cliRequest.then(value=>{if(active)setCli(value);},()=>{cliRequest=null;});
    return ()=>{active=false;};
  },[]);
  return cli;
}
export const workerCommand=(cli:RsiCliInfo,task:string):string=>`${cli.bin} worker --execute --watch --task ${task} --root ${cli.root} --docker-context colima-rsi`;
/** The monitor must be another model family: an OpenAI optimizer is watched through Claude, every other family through Codex. */
export const monitorCommand=(cli:RsiCliInfo,family:string|null):string=>family==='openai'?`PROXY_PORT=4318 PROXY_TOKEN=$RSI_MONITOR_API_KEY node ${cli.scripts}/claude-monitor-proxy.mjs`:`PROXY_PORT=4317 PROXY_TOKEN=$RSI_MONITOR_API_KEY node ${cli.scripts}/codex-health-proxy.mjs`;
export const calibrateCommand=(cli:RsiCliInfo,task:string):string=>`${cli.bin} calibrate --task ${task} --root ${cli.root}`;
