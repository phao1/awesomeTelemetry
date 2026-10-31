import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {LocalSettings} from './LocalSettings.js';
import {DEFAULT_ALERT_THRESHOLDS} from '../../core/task-alerts.js';
afterEach(()=>vi.unstubAllGlobals());
it('loads only on expansion, validates a source and saves currency prices and disabled/enabled thresholds explicitly',async()=>{
 const requests:Array<{path:string;body:unknown}>=[],price={input:1,output:2,cacheRead:0,cacheWrite:0,contextWindow:100,source:'fixture 2026-10-31',currency:'CNY'};
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input),body=init?.body?JSON.parse(String(init.body)) as unknown:null;requests.push({path,body});return new Response(JSON.stringify(path.includes('model-pricing')?body??{model:price}:body??DEFAULT_ALERT_THRESHOLDS));}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),saved=vi.fn(),dirty=vi.fn();
 const edit=async(label:string,value:string)=>{await act(async()=>{const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});};
 try{
 act(()=>root.render(<LocalSettings locale="en" onSaved={saved} onDirty={dirty}/>));expect(requests).toHaveLength(0);
 await act(async()=>{const detail=host.querySelector('details')!;detail.open=true;detail.dispatchEvent(new Event('toggle'));await new Promise(r=>setTimeout(r,10));});expect(requests).toHaveLength(2);
 await act(async()=>{const select=host.querySelector<HTMLSelectElement>('[aria-label="Existing model"]')!;select.value='model';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await edit('Price source','');await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Save model price')!.click());expect(host.textContent).toContain('Enter a model, source');expect(requests).toHaveLength(2);
 await edit('Price source',price.source);await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Save model price')!.click();await new Promise(r=>setTimeout(r,10));});expect(requests[2]!.body).toEqual({model:price});expect(saved).toHaveBeenCalledOnce();
 await edit('Alert errors','2');await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Save alert thresholds')!.click();await new Promise(r=>setTimeout(r,10));});expect(requests[3]!.body).toEqual({...DEFAULT_ALERT_THRESHOLDS,errors:2});expect(saved).toHaveBeenCalledTimes(2);expect(dirty).toHaveBeenCalledWith(true);
 }finally{act(()=>root.unmount());host.remove();}
});

it.each(['model-pricing','alert-thresholds'] as const)('opens, scrolls and focuses the requested %s section without a save',async section=>{
 const fetcher=vi.fn(async(path:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify(String(path).includes('model-pricing')?{}:DEFAULT_ALERT_THRESHOLDS)));vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),saved=vi.fn();
 try{
 await act(async()=>{root.render(<LocalSettings locale="en" target={{section,...(section==='model-pricing'?{model:'unknown-model'}:{})}} onSaved={saved} onDirty={()=>{}}/>);await new Promise(r=>setTimeout(r,40));});
 await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 expect(host.querySelector('details')!.open).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
 const field=host.querySelector<HTMLInputElement>(section==='model-pricing'?'#settings-model-pricing input':'#settings-alert-thresholds input')!;expect(document.activeElement).toBe(field);
 if(section==='model-pricing'){expect(field.value).toBe('unknown-model');expect(host.querySelector<HTMLInputElement>('[aria-label="Price input"]')!.value).toBe('');}
 expect(saved).not.toHaveBeenCalled();expect(fetcher.mock.calls.some(([,init])=>init?.method==='PUT')).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
