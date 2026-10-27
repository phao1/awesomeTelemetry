import { act,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { TaskTimeNavigator } from './TaskTimeNavigator.js';
import type { TaskRecord,TaskTimeline } from '../../core/task-types.js';
import { makeEvent,makeMessage } from '../trajectory/investigation-test-fixtures.js';
let host:HTMLDivElement,root:Root;
const start=Date.UTC(2026,9,26),at=(ms:number)=>new Date(start+ms).toISOString();
const record:TaskRecord={id:'s:event:record',memberId:'a',memberName:'Agent',sessionKey:'s',event:{...makeEvent(makeMessage('record',1,{kind:'tool',tool:'Read',title:'Exact record'})),startedAt:at(5000),durationMs:1000},importedTurn:null};
const timeline:TaskTimeline={taskId:'collected:s',member:'main',window:'fixed',from:at(0),to:at(20000),bins:160,total:5000,untimed:0,coverage:{loadedMembers:1,totalMembers:1},lanes:[{memberId:'a',name:'Agent',total:5000,bins:[{index:40,input:0,model:0,tool:5000,other:0,errors:0}]}]};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:1000,bottom:100,width:1000,height:100,toJSON(){}});});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
const pointer=(node:Element,type:string,x:number)=>{const event=new MouseEvent(type,{bubbles:true,clientX:x,button:0});Object.defineProperty(event,'pointerId',{value:1});node.dispatchEvent(event);};
describe('time navigation',()=>{
  it('keeps the full domain through range filtering; pointer and accessible range controls agree',()=>{
    let selected:[number,number]|null=null;
    function Harness(){const[range,setRange]=useState<[number,number]|null>(null);return<TaskTimeNavigator timeline={timeline} loading={false} error={null} onRetry={()=>{}} records={range?[]:[record]} selected={null} range={range} onRangeChange={value=>{selected=value;setRange(value);}} onSelect={()=>{}} locale="en"/>;}
    act(()=>root.render(<Harness/>));
    act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Full time range')!.click());const track=host.querySelector('.process-time-track')!;
    act(()=>{pointer(track,'pointerdown',200);pointer(track,'pointermove',400);pointer(track,'pointerup',400);});
    expect(selected).toEqual([start+4000,start+8000]);expect(host.textContent).toContain('5,000');
    const axis=host.querySelector('.process-time-axis')!.textContent;
    expect(axis).toContain(new Date(start+20000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
  });
  it('selects an exact loaded mark rather than a nearby density observation',()=>{
    const onSelect=vi.fn(),onRangeChange=vi.fn();act(()=>root.render(<TaskTimeNavigator timeline={timeline} loading={false} error={null} onRetry={()=>{}} records={[record]} selected={null} range={null} onRangeChange={onRangeChange} onSelect={onSelect} locale="en"/>));
    const mark=host.querySelector('[data-record-id]')!;act(()=>{pointer(mark,'pointerdown',260);pointer(mark,'pointerup',260);mark.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));});
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(record);expect(onRangeChange).not.toHaveBeenCalled();
    onSelect.mockClear();
    act(()=>mark.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:0})));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(record);expect(onRangeChange).not.toHaveBeenCalled();
  });
  it('offers keyboard zoom/reset without selecting records or issuing reads; cancelled drags never filter',()=>{
    const onSelect=vi.fn(),onRangeChange=vi.fn();act(()=>root.render(<TaskTimeNavigator timeline={timeline} loading={false} error={null} onRetry={()=>{}} records={[record]} selected={null} range={null} onRangeChange={onRangeChange} onSelect={onSelect} locale="en"/>));
    const track=host.querySelector('.process-time-track')!;act(()=>track.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));
    act(()=>track.dispatchEvent(new KeyboardEvent('keydown',{key:'+',bubbles:true})));expect(host.querySelector('.process-viewport')?.getAttribute('width')).toBe('500');
    act(()=>track.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));expect(host.querySelector('.process-viewport')?.getAttribute('width')).toBe('1000');
    act(()=>{pointer(track,'pointerdown',100);pointer(track,'pointermove',400);pointer(track,'pointercancel',400);});
    expect(onRangeChange).not.toHaveBeenCalled();expect(onSelect).not.toHaveBeenCalled();
  });
  it('keeps the final timestamp marker inside the clickable plot boundary',()=>{
    const latest={...record,event:{...record.event!,startedAt:at(20000),durationMs:0}};
    act(()=>root.render(<TaskTimeNavigator timeline={timeline} loading={false} error={null} onRetry={()=>{}} records={[latest]} selected={null} range={null} onRangeChange={()=>{}} onSelect={()=>{}} locale="en"/>));
    const mark=host.querySelector('[data-record-id]')!;
    expect(Number(mark.getAttribute('x'))+Number(mark.getAttribute('width'))).toBeLessThanOrEqual(1000);
  });
});
