import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {CompareTaskPicker,CompareRequestPicker} from './CompareTaskPicker.js';
import {TaskComparison} from './TaskComparison.js';
import {DEFAULT_TASK_ROUTE,parseTaskRoute,serializeComparisonRoute} from '../../task-route.js';
const task=(id:string)=>({id:'imported:'+id,origin:'imported',title:'TASK '+id,provider:'codex',updatedAt:'2026-11-01T00:00:00.000Z',metrics:{correctedTotal:1234}});
afterEach(()=>{vi.unstubAllGlobals();document.body.replaceChildren();});
it('opens all first-page tasks immediately, searches server-side, appends pages, selects/removes chips and switches source in the popup',async()=>{
 const paths:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>{const path=String(url);paths.push(path);const q=new URL(path,'http://localhost').searchParams;
 const items=q.get('q')?[task('remote')]:q.get('offset')==='50'?[task('page2')]:[task('first'),task('blocked')];return new Response(JSON.stringify({items,total:51,hasMore:q.get('offset')==='0'&&!q.get('q'),offset:Number(q.get('offset')),limit:50}));}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let latest:string[]=[];
 function Demo(){const [ids,setIds]=useState<string[]>([]);return <CompareTaskPicker side="A" locale="en" ids={ids} other={['imported:blocked']} selected={[]} onChange={next=>{latest=next;setIds(next);}} onRequest={()=>{}}/>;}
 try{await act(async()=>root.render(<Demo/>));expect(host.querySelector('details')).toBeNull();act(()=>host.querySelector<HTMLElement>('[role=combobox]')!.click());expect(document.querySelectorAll('[role=option]')).toHaveLength(2);expect(document.querySelector('.ui-option-label small')!.textContent).toContain('1.2K Token');expect(document.querySelector<HTMLButtonElement>('[role=option][disabled]')).not.toBeNull();
 await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Load more')!.click());expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
 act(()=>document.querySelector<HTMLButtonElement>('[role=option]')!.click());expect(latest).toEqual(['imported:first']);expect(host.querySelector('.ui-chip')?.textContent).toContain('TASK first');
 act(()=>host.querySelector<HTMLButtonElement>('.ui-chip-remove')!.click());expect(latest).toEqual([]);
 const input=document.querySelector<HTMLInputElement>('.ui-combo-search input')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'remote');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,300));});expect(paths.some(p=>p.includes('q=remote'))).toBe(true);expect(document.querySelector('[role=option]')!.textContent).toContain('TASK remote');
 await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('.ui-choice-popup [role=tab]')].find(b=>b.textContent==='Imported')!.click());expect(paths.at(-1)).toContain('origin=imported');expect(paths.at(-1)).toContain('offset=0');
 }finally{act(()=>root.unmount());host.remove();}
});
it('swaps task, request and process URL references together; incomplete selection renders EmptyState',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const path=String(url);let value:unknown={items:[],total:0,hasMore:false,offset:0,limit:50};if(path==='/api/task-comparison'){const groups=JSON.parse(String(init?.body));value={a:groups.a.map((id:string)=>({...task('a'),id})),b:groups.b.map((id:string)=>({...task('b'),id}))};}return new Response(JSON.stringify(value));}));
 const route={...DEFAULT_TASK_ROUTE,compareA:['imported:a'],compareB:['imported:b'],requestA:'request:a',requestB:'request:b',processA:'imported:a',processB:'imported:b'},onRoute=vi.fn(),host=document.createElement('div'),root=createRoot(host);
 try{await act(async()=>root.render(<TaskComparison route={route} onRoute={onRoute} locale="en" onLocate={()=>{}}/>));act(()=>host.querySelector<HTMLButtonElement>('[aria-label=Swap]')!.click());const swapped=onRoute.mock.calls.at(-1)![0];expect(swapped).toMatchObject({compareA:route.compareB,compareB:route.compareA,requestA:route.requestB,requestB:route.requestA,processA:route.processB,processB:route.processA});expect(parseTaskRoute(serializeComparisonRoute(swapped))).toMatchObject({compareA:route.compareB,compareB:route.compareA,requestA:route.requestB,requestB:route.requestA});
 await act(async()=>root.render(<TaskComparison route={DEFAULT_TASK_ROUTE} onRoute={onRoute} locale="en" onLocate={()=>{}}/>));expect(host.textContent).toContain('Choose baseline and improvement tasks to compare');expect(host.querySelector('.task-compare-conclusions')).toBeNull();
 }finally{act(()=>root.unmount());}
});
it('single-task request Select uses actual request references and restores whole-task scope',async()=>{
 const metrics={durationMs:100,toolCalls:1,errors:0,input:10,output:3,cacheRead:2,correctedTotal:15,promptInput:12,cacheHitRate:1/6,models:['model']};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({taskId:'imported:a',revision:'r1',items:[{id:'request:REAL:event:p',ordinal:1,title:'REAL PROMPT',startedAt:'2026-11-01T00:00:00.000Z',endedAt:'2026-11-01T00:01:00.000Z',nextStartedAt:null,eventCount:3,metrics,alerts:[]}]}))));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),select=vi.fn();
 try{await act(async()=>root.render(<CompareRequestPicker taskId="imported:a" label="A" locale="en" onSelect={select}/>));act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());expect(document.querySelectorAll('[role=option]')).toHaveLength(2);act(()=>document.querySelectorAll<HTMLButtonElement>('[role=option]')[1]!.click());expect(select).toHaveBeenCalledWith('request:REAL:event:p');
 act(()=>host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());act(()=>document.querySelector<HTMLButtonElement>('[role=option]')!.click());expect(select).toHaveBeenLastCalledWith(undefined);
 }finally{act(()=>root.unmount());host.remove();}
});
it('retains early first-page results after the mount debounce and restores them when search is cleared',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>{const q=new URL(String(url),'http://localhost').searchParams;const items=q.get('q')?[task('remote')]:[task('one'),task('two')];return new Response(JSON.stringify({items,total:items.length,hasMore:false,offset:0,limit:50}));});vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<CompareTaskPicker side="A" ids={[]} other={[]} selected={[]} locale="en" onChange={()=>{}} onRequest={()=>{}}/>));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,320)));expect(fetcher).toHaveBeenCalledTimes(1);
 act(()=>host.querySelector<HTMLElement>('[role=combobox]')!.click());expect([...document.querySelectorAll('[role=option]')].map(n=>n.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('TASK one'),expect.stringContaining('TASK two')]));
 const input=document.querySelector<HTMLInputElement>('.ui-combo-search input')!;
 const search=async(value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,320));});};
 await search('remote');expect(document.querySelectorAll('[role=option]')).toHaveLength(1);expect(document.querySelector('[role=option]')!.textContent).toContain('TASK remote');
 await search('');expect(document.querySelectorAll('[role=option]')).toHaveLength(2);expect(document.querySelector('[role=listbox]')!.textContent).toContain('TASK one');expect(document.querySelector('[role=listbox]')!.textContent).toContain('TASK two');
 act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b=>b.textContent==='Collected')!.click());expect(document.querySelectorAll('[role=option]')).toHaveLength(2);
 }finally{act(()=>root.unmount());host.remove();}
});
it('shows skeleton options while loading and closes overlays on route change, closeKey change and unmount',async()=>{
 let finish:((value:Response)=>void)|undefined;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=(closeKey:string)=><CompareTaskPicker closeKey={closeKey} side="A" ids={[]} other={[]} selected={[]} locale="en" onChange={()=>{}} onRequest={()=>{}}/>;
 try{await act(async()=>root.render(render('first')));act(()=>host.querySelector<HTMLElement>('[role=combobox]')!.click());expect(document.querySelector('.ui-choice-popup .ui-skeleton')).not.toBeNull();expect(document.querySelector('.ui-choice-popup')!.textContent).not.toContain('No results');
 await act(async()=>finish!(new Response(JSON.stringify({items:[task('one')],total:1,hasMore:false,offset:0,limit:50}))));expect(document.querySelectorAll('[role=option]')).toHaveLength(1);
 act(()=>window.dispatchEvent(new Event('hashchange')));expect(document.querySelector('.ui-choice-popup')).toBeNull();
 act(()=>host.querySelector<HTMLElement>('[role=combobox]')!.click());await act(async()=>root.render(render('second')));expect(document.querySelector('.ui-choice-popup')).toBeNull();
 act(()=>host.querySelector<HTMLElement>('[role=combobox]')!.click());expect(document.querySelector('.ui-choice-popup')).not.toBeNull();
 }finally{act(()=>root.unmount());host.remove();}expect(document.querySelector('.ui-choice-popup')).toBeNull();
});
it('keeps off-page selected chips without letting them crowd out actual search results',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({items:[task('visible')],total:1,offset:0,limit:50,hasMore:false}))));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<CompareTaskPicker side="A" ids={['imported:off-page']} selected={[{...task('off-page'),origin:'imported',provenanceKnown:true,rootSessionKey:null,runId:null,startedAt:null,recordedStatus:'success',memberCount:1,eventCount:0,loadedMemberCount:1,metrics:undefined}]} other={[]} locale="en" onChange={()=>{}} onRequest={()=>{}}/>));expect(host.querySelector('.ui-chip')!.textContent).toContain('TASK off-page');act(()=>host.querySelector<HTMLElement>('.ui-multi-trigger')!.click());expect(document.querySelectorAll('[role=option]')).toHaveLength(1);expect(document.querySelector('[role=option]')!.textContent).toContain('TASK visible');
 }finally{act(()=>root.unmount());host.remove();}
});
