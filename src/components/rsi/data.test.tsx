import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useRsiRead } from './data.js';
import { WorkerPill } from './Shared.js';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();document.body.replaceChildren();});
it('preserves a successful section during SSE invalidation and aborts old reads on unmount',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),signals:AbortSignal[]=[];let complete:(value:string)=>void=()=>undefined;
 const read=(signal:AbortSignal)=>{signals.push(signal);return new Promise<string>(resolve=>{complete=resolve;});};
 function Section({version}:{version:number}){const data=useRsiRead('task',read,version);return <output>{data.value??'skeleton'}</output>;}
 try {await act(async()=>root.render(<Section version={0}/>));await act(async()=>complete('retained evidence'));expect(host.textContent).toBe('retained evidence');await act(async()=>root.render(<Section version={1}/>));expect(signals[0]!.aborted).toBe(true);expect(host.textContent).toBe('retained evidence');act(()=>root.unmount());expect(signals[1]!.aborted).toBe(true);await act(async()=>complete('late response'));expect(host.textContent).toBe('');}finally{host.remove();}
});
it('cleans worker heartbeat polling and aborts an outstanding status read',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{if(String(url).endsWith('/session'))return new Response(JSON.stringify({token:'page'}));signal=init?.signal??undefined;return new Promise<Response>(()=>undefined);}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<WorkerPill status={null} taskId="task" locale="zh"/>));await act(async()=>vi.advanceTimersByTime(5000));expect(signal).toBeDefined();act(()=>root.unmount());expect(signal!.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);host.remove();
});
