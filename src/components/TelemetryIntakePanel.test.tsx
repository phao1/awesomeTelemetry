import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { TelemetryIntakePanel } from './TelemetryIntakePanel.js';
import { DataIntake } from './task/DataIntake.js';
import type { TelemetryStatus } from '../core/telemetry-types.js';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
const status:TelemetryStatus={enabled:false,requireToken:false,endpoint:'http://127.0.0.1:4318/v1/traces',spanCount:2,traceCount:1,rejectedCount:1,reasons:{TELEMETRY_LIMIT:1},lastReceivedAt:null};
const response=(v:unknown)=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
const settle=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
describe('telemetry intake controls',()=>{
  it('renders endpoint/stats without polling, enables optional token once, copies and disables explicitly',async()=>{
    let enabled=false;const requests:Array<{url:string;method:string;body:unknown}>=[];
    vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const method=init?.method??'GET';requests.push({url:String(input),method,body:init?.body?JSON.parse(init.body as string):null});if(method==='PUT'){enabled=(JSON.parse(init!.body as string) as {enabled:boolean}).enabled;return response({...status,enabled,requireToken:true,...(enabled?{token:'one-time-token'}:{})});}return response({...status,enabled,requireToken:enabled});});
    const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    act(()=>root.render(<TelemetryIntakePanel locale="en"/>));await settle();expect(host.querySelector<HTMLInputElement>('[aria-label="Receiver endpoint"]')!.value).toBe(status.endpoint);expect(host.textContent).toContain('TELEMETRY_LIMIT');expect(requests).toHaveLength(1);

    await act(async()=>host.querySelector<HTMLInputElement>('[role=switch][aria-label="Enable receiver"]')!.click());await settle();expect(requests.filter(r=>r.method==='PUT')[0]?.body).toEqual({enabled:true,requireToken:true});expect(host.querySelector<HTMLInputElement>('input[aria-label="One-time token"]')?.value).toBe('one-time-token');
    await act(async()=>host.querySelector<HTMLInputElement>('input[aria-label="One-time token"]')!.parentElement!.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!.click());expect(writeText).toHaveBeenCalledWith('one-time-token');expect(document.body.textContent).toContain('Copied');
    await act(async()=>host.querySelector<HTMLInputElement>('[role=switch][aria-label="Enable receiver"]')!.click());await settle();expect(host.querySelector('input[aria-label="One-time token"]')).toBeNull();expect(requests.filter(r=>r.method==='PUT')).toHaveLength(2);
  });
  it('imports a vendor JSONL file directly, shows clear errors and never enables collection',async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];
    vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{calls.push({url:String(input),init});return response({format:'LangSmith',spanCount:2,taskIds:['collected:otel:task']});});
    act(()=>root.render(<TelemetryIntakePanel locale="en" file/>));await settle();expect(calls).toHaveLength(0);
    const input=host.querySelector<HTMLInputElement>('input[type=file]')!;const file=new File(['{"id":"x","run_type":"llm"}'],'runs.jsonl');
    Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));await settle();
    expect(calls).toHaveLength(1);expect(calls[0]?.url).toBe('/api/telemetry/import');expect(calls[0]?.init).toMatchObject({method:'POST',headers:{'content-type':'application/x-ndjson'},body:file});expect(host.textContent).toContain('LangSmith');expect(host.textContent).toContain('Imported tasks');
  });
  it('adds an OpenTelemetry channel and keeps its status lazy',async()=>{
    const calls:string[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{calls.push(String(input));return response(String(input).includes('telemetry')?status:{enabled:false,state:'idle'});});
    act(()=>root.render(<DataIntake locale="en" onConfigure={()=>undefined} proxy={null} frida={null} onTasks={()=>undefined}/>));await settle();expect(calls).not.toContain('/api/telemetry');
    const channel=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.includes('OpenTelemetry'))!;await act(async()=>channel.click());await settle();expect(calls.filter(c=>c==='/api/telemetry')).toHaveLength(1);expect(host.textContent).toContain('Receiver disabled');
  });
  it('shows failed configuration and allows status refresh without secret recovery',async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>init?.method==='PUT'?new Response(JSON.stringify({error:{code:'TELEMETRY_CONFIG',message:'Cannot save local settings'}}),{status:503,headers:{'content-type':'application/json'}}):response(status));
    act(()=>root.render(<TelemetryIntakePanel locale="en"/>));await settle();const button=host.querySelector<HTMLInputElement>('[role=switch][aria-label="Enable receiver"]')!;await act(async()=>button.click());await settle();expect(host.querySelector('[role=alert]')?.textContent).toContain('Cannot save local settings');expect(host.querySelector('input[aria-label="One-time token"]')).toBeNull();
  });
});
it('names the intake page and avoids an ambiguous task action in its header',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(response({enabled:false,state:'idle'}));act(()=>root.render(<DataIntake locale="zh" onConfigure={()=>{}} onTasks={()=>{}} proxy={null} frida={null}/>));await settle();expect(host.querySelector('h1')!.textContent).toBe('数据接入');expect(host.querySelector('.page-heading p')!.textContent).toBe('选择数据来源，数据只保存在本机');expect(host.querySelector('.page-actions')!.textContent).not.toMatch(/任务/);
});
