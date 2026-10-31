import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalSettings} from './LocalSettings.js';
import {DEFAULT_ALERT_THRESHOLDS} from '../../core/task-alerts.js';
afterEach(()=>vi.unstubAllGlobals());
it('loads thresholds only on expansion and explicitly saves dirty changes',async()=>{
 const requests:Array<{path:string;body:unknown}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input),body=init?.body?JSON.parse(String(init.body)) as unknown:null;requests.push({path,body});return new Response(JSON.stringify(body??DEFAULT_ALERT_THRESHOLDS));}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),saved=vi.fn(),dirty=vi.fn();
 try{
 act(()=>root.render(<LocalSettings locale="en" onSaved={saved} onDirty={dirty}/>));expect(requests).toHaveLength(0);
 await act(async()=>{const detail=host.querySelector('details')!;detail.open=true;detail.dispatchEvent(new Event('toggle'));await new Promise(r=>setTimeout(r,10));});expect(requests).toHaveLength(1);
 expect(host.textContent).not.toMatch(/price|currency|USD|CNY/i);
 await act(async()=>{const input=host.querySelector<HTMLInputElement>('[aria-label="Alert errors"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Save alert thresholds')!.click();await new Promise(r=>setTimeout(r,10));});
 expect(requests[1]!.body).toEqual({...DEFAULT_ALERT_THRESHOLDS,errors:2});expect(saved).toHaveBeenCalledOnce();expect(dirty).toHaveBeenCalledWith(true);
 expect(requests.every(r=>r.path.endsWith('/alert-thresholds'))).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});

it.each(['alert-thresholds'] as const)('opens, scrolls and focuses the requested %s section without a save',async section=>{
 const fetcher=vi.fn(async(_path:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify(DEFAULT_ALERT_THRESHOLDS)));vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),saved=vi.fn();
 try{
 await act(async()=>{root.render(<LocalSettings locale="en" target={{section}} onSaved={saved} onDirty={()=>{}}/>);await new Promise(r=>setTimeout(r,40));});
 await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 expect(host.querySelector('details')!.open).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
 const field=host.querySelector<HTMLInputElement>('#settings-alert-thresholds input')!;expect(document.activeElement).toBe(field);
 expect(saved).not.toHaveBeenCalled();expect(fetcher.mock.calls.some(([,init])=>init?.method==='PUT')).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
