import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
interface Options<T> {
  enabled?: boolean;
  prefix: string;
  load: (signal?: AbortSignal) => Promise<unknown>;
  save: (value: T, signal?: AbortSignal) => Promise<unknown>;
  validate: (value: unknown) => value is T;
}
/** Own each metadata read/write, preserving drafts and uncertainty until explicit reload. */
export function useSettingsDraft<T>({enabled=true,...options}:Options<T>) {
  const current=useRef(options);current.current=options;
  const [draft,setDraft]=useState<T|null>(null),[baseline,setBaseline]=useState<T|null>(null);
  const [busy,setBusy]=useState<'load'|'save'|null>(null),[error,setError]=useState(''),[errorKind,setErrorKind]=useState<'load'|'save'>('load'),[uncertain,setUncertain]=useState(false);
  const owner=useRef<{controller:AbortController;timer:ReturnType<typeof setTimeout>;release:()=>void}|null>(null),started=useRef(false);
  const cancel=useCallback(()=>{const active=owner.current;owner.current=null;if(active){clearTimeout(active.timer);active.controller.abort();active.release();}},[]);
  const run=useCallback(async(kind:'load'|'save'):Promise<boolean>=>{
    if(owner.current)return false;
    const value=draft,config=current.current;
    if(kind==='save'&&(value===null||uncertain))return false;
    setBusy(kind);setError('');setErrorKind(kind);
    const controller=new AbortController();
    let release!:()=>void;const deadline=new Promise<undefined>(resolve=>{release=()=>resolve(undefined);});
    const active={controller,release,timer:setTimeout(()=>{if(owner.current!==active)return;owner.current=null;controller.abort();setBusy(null);setError(config.prefix+(kind==='load'?'_READ_TIMEOUT':'_SAVE_TIMEOUT'));if(kind==='save')setUncertain(true);release();},kind==='load'?5000:10000)};
    owner.current=active;
    try {
      const response=await Promise.race([kind==='load'?config.load(controller.signal):config.save(value!,controller.signal),deadline]);
      if(owner.current!==active)return false;
      if(!config.validate(response))throw new Error(config.prefix+'_RESPONSE_INVALID');
      setDraft(response);setBaseline(response);setUncertain(false);return true;
    } catch(cause) {
      if(owner.current!==active)return false;
      console.error('[settings] '+kind+' failed',cause);
      setError(cause instanceof ApiError?cause.code:cause instanceof Error&&cause.message===config.prefix+'_RESPONSE_INVALID'?cause.message:config.prefix+(kind==='load'?'_LOAD_FAILED':'_SAVE_FAILED'));
      if(kind==='save'&&!(cause instanceof ApiError))setUncertain(true);
      return false;
    } finally { clearTimeout(active.timer);if(owner.current===active){owner.current=null;setBusy(null);} }
  },[draft,uncertain]);
  const runner=useRef(run);runner.current=run;
  useEffect(()=>{if(enabled&&!started.current){started.current=true;void runner.current('load');}},[enabled]);
  useEffect(()=>()=>{cancel();started.current=false;},[cancel]);
  const dirty=draft!==null&&JSON.stringify(draft)!==JSON.stringify(baseline);
  const discard=useCallback(()=>{if(owner.current||uncertain)return;setDraft(baseline);setError('');},[baseline,uncertain]);
  return {draft,setDraft,dirty,busy,error,errorKind,uncertain,load:()=>run('load'),save:()=>run('save'),discard};
}
