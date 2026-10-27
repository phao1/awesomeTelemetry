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
it('reads paired tool input/output from their exact original records only when the corresponding tab is chosen',async()=>{
  act(()=>root.render(<TaskEvidence context={context} record={output} relatedRecords={[input,output]} locale="en" initialRaw={false} onClose={()=>{}} onLocate={()=>{}} onOpenRequest={()=>{}} onOpenSession={()=>{}}/>));await settle();expect(calls).toHaveLength(0);
  act(()=>tab('Input').click());await settle();expect(host.textContent).toContain('EXACT INPUT');expect(calls).toHaveLength(1);expect(calls[0]).toContain('/events/input');
  act(()=>tab('Output').click());await settle();expect(host.textContent).toContain('EXACT OUTPUT');expect(calls).toHaveLength(2);expect(calls[1]).toContain('/events/output');
  act(()=>tab('Input').click());await settle();expect(calls).toHaveLength(2);
  act(()=>tab('Original').click());await settle();expect(calls.at(-1)).toContain('/events/output');expect(host.textContent).toContain('ORIGINAL OUTPUT');
});
it('does not invent an input relationship when only the selected result record is available',async()=>{
  act(()=>root.render(<TaskEvidence context={context} record={output} locale="en" initialRaw={false} onClose={()=>{}} onLocate={()=>{}} onOpenRequest={()=>{}} onOpenSession={()=>{}}/>));
  act(()=>tab('Input').click());await settle();expect(calls).toHaveLength(1);expect(calls[0]).toContain('/events/output');expect(host.textContent).toContain('This field was not provided');
});
