import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { TaskContext, TaskRequest } from '../../core/task-types.js';
import { RequestNavigator, RequestExpansion, RequestPicker } from './TaskRequests.js';
const context:TaskContext={task:{id:'collected:root',origin:'collected',rootSessionKey:'root',runId:null,title:'Thread',provider:'codex',provenanceKnown:true,startedAt:null,updatedAt:'2026-10-30T00:00:00.000Z',recordedStatus:'success',memberCount:1,loadedMemberCount:1,eventCount:9},members:[],importSession:null,warnings:[]};
const items:TaskRequest[]=[1,2].map(n=>({id:'request:root:event:p'+n,ordinal:n,title:'Question '+n,startedAt:`2026-10-30T00:00:0${n}.000Z`,endedAt:`2026-10-30T00:00:0${n+1}.000Z`,nextStartedAt:null,eventCount:n,metrics:{durationMs:n*1000,toolCalls:n,errors:0,input:10*n,output:20*n,cacheRead:30*n,correctedTotal:60*n,promptInput:100,cacheHitRate:0.3,models:[]},alerts:[]}));
let host:HTMLDivElement,root:Root;
const settle=async()=>{await act(async()=>{for(let n=0;n<15;n++)await Promise.resolve();});};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({taskId:context.task.id,revision:'rev',items}),{status:200})));});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('navigates requests and returns to whole-task with the selected request summary',async()=>{
  function Harness(){const [request,setRequest]=useState<string|undefined>(items[0]!.id);return <RequestNavigator context={context} request={request} locale="en" onSelect={setRequest}/>;}
  act(()=>root.render(<Harness/>));await settle();
  expect(host.querySelector('[role=combobox]')!.textContent).toContain('Question 1');expect(host.querySelector('.task-f3-request-title')!.textContent).toBe('1 / 2');act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());expect(document.querySelector('.ui-combo-search input')).not.toBeNull();expect(document.querySelector('[role=listbox]')!.textContent).toContain('Question 2');act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());expect(host.querySelector('.task-f3-metrics')!.textContent).toContain('60');
  act(()=>[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Next')!.click());await settle();expect(host.querySelector('[role=combobox]')!.textContent).toContain('Question 2');expect(host.querySelector('.task-f3-metrics')!.textContent).toContain('120');
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Whole task')!.click());await settle();expect(host.querySelector('[role=combobox]')).toBeNull();expect(host.querySelector('.task-f3-metrics')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});
it('expands only on demand and exposes request metrics and alerts',async()=>{
  const onSelect=vi.fn();act(()=>root.render(<RequestExpansion task={context.task} locale="en" onSelect={onSelect}/>));await settle();expect(fetch).not.toHaveBeenCalled();
  act(()=>host.querySelector<HTMLButtonElement>('.ui-accordion > button')!.click());await settle();expect(fetch).toHaveBeenCalledTimes(1);expect(host.querySelector('tbody')!.textContent).toContain('60');
  act(()=>host.querySelector('tbody button')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(onSelect).toHaveBeenCalledWith(items[0]!.id);
});
it('offers distinct same-task request choices for comparison',async()=>{
  const onSelect=vi.fn();act(()=>root.render(<RequestPicker taskId={context.task.id} exclude={items[0]!.id} label="B" locale="en" onSelect={onSelect}/>));await settle();
  act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());expect(document.querySelectorAll('[role=option]')).toHaveLength(2);expect(document.querySelector('[role=listbox]')!.textContent).not.toContain('Question 1');expect(document.querySelector('[role=listbox]')!.textContent).toContain('Question 2');
  act(()=>document.querySelectorAll<HTMLButtonElement>('[role=option]')[1]!.click());expect(onSelect).toHaveBeenCalledWith(items[1]!.id);
});

const validList={taskId:context.task.id,revision:'rev',items};
const malformedLists:unknown[]=[
  null,{}, {items:{}}, {...validList,items:[null]},
  {...validList,items:[{...items[0],metrics:undefined}]},
  {...validList,items:[{...items[0],metrics:{...items[0]!.metrics,models:null}}]},
  {...validList,items:[{...items[0],metrics:{...items[0]!.metrics,coverage:{}}}]},
  {...validList,items:[{...items[0],metrics:{...items[0]!.metrics,cacheHitRate:1.1}}]},
  {...validList,items:[{...items[0],alerts:null}]},
  {...validList,items:[{...items[0],alerts:[null]}]},
];
for(const consumer of ['picker','navigator','expansion'] as const){
  const render=(onSelect=vi.fn())=>act(()=>root.render(<><h1>Task page still works</h1>{consumer==='picker'?<RequestPicker taskId={context.task.id} label="A" locale="en" onSelect={onSelect}/>:consumer==='navigator'?<RequestNavigator context={context} locale="en" onSelect={onSelect}/>:<RequestExpansion task={context.task} locale="en" onSelect={onSelect} open/>}</>));
  it.each(malformedLists)(`${consumer}: invalid request-list shape %# degrades locally without breaking the page`,async body=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body),{status:200}));const onSelect=vi.fn();render(onSelect);await settle();
    expect(host.textContent).toContain('Task page still works');expect(host.textContent).toContain('Requests unavailable');expect(host.querySelector('select')).toBeNull();expect(host.querySelector('li')).toBeNull();expect(onSelect).not.toHaveBeenCalled();
  });
  it(`${consumer}: request failure offers explicit retry and recovers without an automatic retry`,async()=>{
    const onSelect=vi.fn();vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failed'));render(onSelect);await settle();
    expect(host.textContent).toContain('Requests unavailable');expect(fetch).toHaveBeenCalledTimes(1);
    act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry')!.click());await settle();
    expect(fetch).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain('Requests unavailable');if(consumer==='navigator'){const choose=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='By request')!;expect(choose.disabled).toBe(false);act(()=>choose.click());expect(onSelect).toHaveBeenCalledWith(items[0]!.id);}else if(consumer==='picker'){act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());expect(document.querySelector('[role=listbox]')!.textContent).toContain('Question 1');}else expect(host.textContent).toContain('Question 1');
  });
  it(`${consumer}: loading and timeout hide the selector and suppress late success`,async()=>{
    vi.useFakeTimers();let finish!:(response:Response)=>void;vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    try{
      render();await settle();expect(host.querySelector('[role=status]')).not.toBeNull();expect(host.querySelector('select')).toBeNull();
      act(()=>vi.advanceTimersByTime(10000));await settle();expect(host.textContent).toContain('Requests unavailable');
      finish(new Response(JSON.stringify(validList),{status:200}));await settle();expect(host.querySelector('select')).toBeNull();expect(host.textContent).not.toContain('Question 1');
    }finally{vi.useRealTimers();}
  });
  it(`${consumer}: a valid empty imported request list is a local empty state`,async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({taskId:'imported:trace',revision:'rev',items:[]}),{status:200}));render();await settle();
    expect(host.textContent).toContain('No requests available');expect(host.querySelector('select')).toBeNull();expect(host.textContent).toContain('Task page still works');
  });
}
it('keeps an explicit whole-task escape when selected request metadata is unavailable',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:200}));const onSelect=vi.fn();
  act(()=>root.render(<RequestNavigator context={context} request={items[0]!.id} locale="en" onSelect={onSelect}/>));await settle();
  expect(onSelect).not.toHaveBeenCalled();act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Whole task')!.click());expect(onSelect).toHaveBeenCalledWith(undefined);
});
it('does not read optional requests before a comparison task has been selected',async()=>{
  act(()=>root.render(<RequestPicker label="A" locale="en" onSelect={()=>{}}/>));await settle();expect(fetch).not.toHaveBeenCalled();expect(host.querySelector('select')).toBeNull();
});
