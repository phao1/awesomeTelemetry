import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TaskEvidence} from './TaskEvidence.js';
import type {TaskContext,TaskRecord} from '../../core/task-types.js';
import {makeEvent,makeMessage} from '../trajectory/investigation-test-fixtures.js';
let host:HTMLDivElement,root:Root,calls:string[];
const input:TaskRecord={id:'s:event:input',memberId:'a',memberName:'Agent',sessionKey:'s',event:makeEvent(makeMessage('input',1,{kind:'tool',tool:'Read',hasInput:true,hasOutput:false})),importedTurn:null};
const output:TaskRecord={...input,id:'s:event:output',event:makeEvent(makeMessage('output',2,{kind:'tool',tool:'Read',hasInput:false,hasOutput:true}))};
const context:TaskContext={task:{id:'collected:s',origin:'collected',provider:'codex'} as TaskContext['task'],members:[],importSession:null,warnings:[]};
const settle=()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});
const tab=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(node=>node.textContent===name)!;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);calls=[];vi.stubGlobal('fetch',vi.fn(async(request:RequestInfo|URL)=>{const path=String(request);calls.push(path);const isInput=path.includes('/events/input');return{ok:true,text:async()=>JSON.stringify({...(isInput?input.event:output.event),inputSummary:isInput?'EXACT INPUT':null,outputSummary:isInput?null:'EXACT OUTPUT',raw:'ORIGINAL OUTPUT'})} as Response;}));});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('opens selected tool parameters and result immediately from their exact records and reuses those bodies across tabs',async()=>{
  act(()=>root.render(<TaskEvidence context={context} record={output} relatedRecords={[input,output]} locale="en" initialRaw={false} onClose={()=>{}} onLocate={()=>{}} onOpenRequest={()=>{}} onOpenSession={()=>{}}/>));await settle();
  expect(calls).toHaveLength(2);expect(calls.some(path=>path.includes('/events/input'))).toBe(true);expect(calls.some(path=>path.includes('/events/output'))).toBe(true);
  expect(host.textContent).toContain('EXACT INPUT');expect(host.textContent).toContain('EXACT OUTPUT');expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Summary');
  expect(calls.every(path=>!path.includes('include=raw'))).toBe(true);
  act(()=>tab('Input').click());await settle();expect(host.textContent).toContain('EXACT INPUT');expect(calls).toHaveLength(2);
  act(()=>tab('Output').click());await settle();expect(host.textContent).toContain('EXACT OUTPUT');expect(calls).toHaveLength(2);
  act(()=>tab('Input').click());await settle();expect(calls).toHaveLength(2);
  act(()=>tab('Original').click());await settle();expect(calls).toHaveLength(3);expect(calls.at(-1)).toContain('/events/output');expect(calls.at(-1)).toContain('include=raw');expect(host.textContent).toContain('ORIGINAL OUTPUT');
});
it('does not invent an input relationship when only the selected result record is available',async()=>{
  act(()=>root.render(<TaskEvidence context={context} record={output} locale="en" initialRaw={false} onClose={()=>{}} onLocate={()=>{}} onOpenRequest={()=>{}} onOpenSession={()=>{}}/>));
  act(()=>tab('Input').click());await settle();expect(calls).toHaveLength(1);expect(calls[0]).toContain('/events/output');expect(host.textContent).toContain('This field was not provided');
});
it('keeps a paired field pending rather than claiming it is missing before the exact read completes',async()=>{
  const original=fetch;let finish:((value:Response)=>void)|undefined;
  vi.stubGlobal('fetch',vi.fn((request:RequestInfo|URL,init?:RequestInit)=>String(request).includes('/events/input')?new Promise<Response>(resolve=>{finish=resolve;}):original(request,init)));
  act(()=>root.render(<TaskEvidence context={context} record={output} relatedRecords={[input,output]} locale="en" initialRaw={false} onClose={()=>{}} onLocate={()=>{}} onOpenRequest={()=>{}} onOpenSession={()=>{}}/>));await settle();
  expect(host.textContent).toContain('EXACT OUTPUT');expect(host.textContent).not.toContain('This field was not provided');expect(host.querySelector('[role=status]')).not.toBeNull();
  await act(async()=>finish!({ok:true,text:async()=>JSON.stringify({...input.event,inputSummary:'LATE EXACT INPUT',outputSummary:null})} as Response));await settle();
  expect(host.textContent).toContain('LATE EXACT INPUT');expect(host.querySelector('[role=status]')).toBeNull();
});
it('aborts a retired selected body and suppresses its late result without reading originals',async()=>{
  const original=fetch;let finish:((value:Response)=>void)|undefined,signal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn((request:RequestInfo|URL,init?:RequestInit)=>{
    if(String(request).includes('/events/output')){signal=init?.signal as AbortSignal;return new Promise<Response>(resolve=>{finish=resolve;});}
    return original(request,init);
  }));
  const render=(record:TaskRecord)=>root.render(<TaskEvidence context={context} record={record} locale="en" initialRaw={false} onClose={()=>{}} onLocate={()=>{}} onOpenRequest={()=>{}} onOpenSession={()=>{}}/>);
  act(()=>render(output));await settle();act(()=>render(input));await settle();expect(signal?.aborted).toBe(true);expect(host.textContent).toContain('EXACT INPUT');
  await act(async()=>finish!({ok:true,text:async()=>JSON.stringify({...output.event,outputSummary:'RETIRED BODY'})} as Response));await settle();
  expect(host.textContent).not.toContain('RETIRED BODY');expect(calls.every(path=>!path.includes('include=raw'))).toBe(true);
});
