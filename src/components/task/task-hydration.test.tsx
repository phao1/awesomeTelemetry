import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import type {TaskHydrationFrame,TaskSummary} from '../../core/task-types.js';
import {streamTaskHydration,useTaskHydration} from './task-hydration.js';
const task=(id:string)=>({id,origin:'collected',memberCount:1,loadedMemberCount:0} as TaskSummary);
const frame=(id:string,pending:number,done=false):TaskHydrationFrame=>({items:[{taskId:id,pending,loaded:pending?0:1,reasons:[]}],done});
const line=(value:TaskHydrationFrame)=>new TextEncoder().encode(JSON.stringify(value)+'\n');
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('uses one page stream, coalesces SSE/completion refreshes and aborts on page change, ignoring late frames',async()=>{
 const streams:ReadableStreamDefaultController<Uint8Array>[]=[],signals:AbortSignal[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_path:RequestInfo|URL,init?:RequestInit)=>{signals.push(init!.signal as AbortSignal);return new Response(new ReadableStream<Uint8Array>({start(controller){streams.push(controller);}}));}));
 const host=document.createElement('div'),root=createRoot(host),refresh=vi.fn();let restart:()=>void=()=>{};
 function Home({id,scope,version=0}:{id:string;scope:string|null;version?:number}){const state=useTaskHydration([task(id)],scope,version,refresh);restart=state.restart;return <pre>{JSON.stringify(state.progress)}</pre>;}
 try{
 await act(async()=>{root.render(<Home id="collected:a" scope="page1"/>);await Promise.resolve();});expect(fetch).toHaveBeenCalledTimes(1);
 await act(async()=>{streams[0]!.enqueue(line(frame('collected:a',1)));root.render(<Home id="collected:a" scope="page1" version={1}/>);await Promise.resolve();});
 await act(async()=>{root.render(<Home id="collected:b" scope="page2"/>);await Promise.resolve();});expect(signals[0]!.aborted).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);
 await act(async()=>{streams[0]!.enqueue(line(frame('collected:a',0,true)));streams[1]!.enqueue(line(frame('collected:b',0,true)));await new Promise(r=>setTimeout(r,220));});
 expect(host.textContent).not.toContain('collected:a');expect(host.textContent).toContain('collected:b');expect(refresh).toHaveBeenCalledOnce();
 await act(async()=>{root.render(<Home id="collected:b" scope="page2" version={2}/>);await new Promise(r=>setTimeout(r,220));});expect(refresh).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledTimes(2);
 await act(async()=>{restart();await Promise.resolve();});expect(fetch).toHaveBeenCalledTimes(3);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(signals[2]!.aborted).toBe(true);
 act(()=>root.render(<Home id="collected:b" scope={null}/>));streams[2]!.close();
 }finally{act(()=>root.unmount());}
});
it('rejects incomplete/malformed/oversized streams without treating missing evidence as a successful load',async()=>{
 const controller=new AbortController();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(frame('collected:a',1))+'\n')));
 await expect(streamTaskHydration(['collected:a'],controller.signal,()=>{})).rejects.toThrow('INTERRUPTED');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({items:[{taskId:'foreign',pending:0,loaded:1,reasons:[]}],done:true})+'\n')));
 await expect(streamTaskHydration(['collected:a'],controller.signal,()=>{})).rejects.toThrow('INVALID');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(524289))));await expect(streamTaskHydration(['collected:a'],controller.signal,()=>{})).rejects.toThrow('LIMIT');
});
