import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalProviderTable } from './LocalProviderTable.js';
import { PROVIDER_KEYS } from '../../core/trace-types.js';
const cleanups:Array<()=>void>=[];
afterEach(()=>{cleanups.splice(0).forEach(cleanup=>cleanup());vi.unstubAllGlobals();});
const config={providers:Object.fromEntries(PROVIDER_KEYS.map(key=>[key,{key,enabled:true,path:'/fixture/'+key,label:key,sourceKind:'jsonl',watchStrategy:'chokidar',pollIntervalMs:0}])),traeKeyPath:null,prewarmRecent:0};
async function mount(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);cleanups.push(()=>{act(()=>root.unmount());host.remove();});await act(async()=>{root.render(<LocalProviderTable locale="en"/>);for(let i=0;i<12;i++)await Promise.resolve();});return host;}
it('reads provider config and one aggregate, shows nine rows and explicitly scans only the selected provider',async()=>{
 const calls:Array<{path:string;body:unknown}>=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const path=String(input);calls.push({path,body:init?.body?JSON.parse(String(init.body)):null});return new Response(JSON.stringify(path.endsWith('/config/providers')?config:path.endsWith('/providers/status')?{providers:PROVIDER_KEYS.map(key=>({key,sessionCount:3,lastScanAt:'2026-10-31T00:00:00Z',enabled:true,ready:true,blockedBy:null,pathExists:true}))}:{}));}));
 const host=await mount();expect(calls).toHaveLength(2);expect(host.querySelectorAll('[data-table-row]')).toHaveLength(9);expect(host.textContent).toContain('/fixture/codex');expect(host.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-31T00:00:00Z');expect(host.querySelector('time')!.getAttribute('title')).toBe('2026-10-31T00:00:00Z');expect(host.querySelector('time')!.textContent).not.toContain('2026-10-31T');expect(host.textContent).toContain('Codex');
 const codex=[...host.querySelectorAll('[data-table-row]')].find(row=>row.textContent?.includes('/fixture/codex'))!;
 await act(async()=>{codex.querySelector<HTMLButtonElement>('button')!.click();for(let i=0;i<12;i++)await Promise.resolve();});
 expect(calls.filter(call=>call.path==='/api/scan')).toEqual([{path:'/api/scan',body:{provider:'codex',force:false}}]);expect(calls.some(call=>call.path.includes('/sessions/'))).toBe(false);
});
it('retains configured provider paths with unknown counts if the aggregate is unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith('/config/providers')?config:{}))));const host=await mount();expect(host.querySelectorAll('[data-table-row]')).toHaveLength(9);expect(host.textContent).toContain('/fixture/codex');expect(host.querySelectorAll('[data-table-row]')[0]!.textContent).toContain('—');
});
it('labels disabled, missing and unavailable path evidence distinctly',async()=>{
 const configured={...config,providers:{...config.providers,codex:{...config.providers.codex,enabled:false}}};
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith('/config/providers')?configured:{providers:PROVIDER_KEYS.map(key=>({key,enabled:key!=='codex',sessionCount:0,lastScanAt:null,ready:key!=='trae',blockedBy:key==='trae'?'TRAE_KEY_MISSING':null,pathExists:key==='claude'||key==='codex'?false:null}))}))));
 const host=await mount();const row=(provider:string)=>[...host.querySelectorAll('[data-table-row]')].find(node=>node.textContent?.includes('/fixture/'+provider))!;
 expect(row('codex').textContent).toContain('Disabled');expect(row('claude').textContent).toContain('Path not found');expect(row('workbuddy').textContent).toContain('Enabled');expect(row('workbuddy').textContent).not.toContain('Path not found');expect(row('trae').textContent).toContain('Setup required');
});
