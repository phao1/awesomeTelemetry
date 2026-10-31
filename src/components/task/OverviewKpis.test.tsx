import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {OverviewKpis,overviewChange} from './OverviewKpis.js';
import type {OverviewPoint,OverviewSnapshot} from '../../core/overview-types.js';
const point:OverviewPoint={day:'2026-11-01T00:00:00.000Z',tasks:4,statusKnownTasks:4,toolKnownTasks:4,failedTasks:1,failurePct:25,toolFailurePct:50,tokens:100,tokenKnownTasks:3,cacheHitRate:0.3,cacheKnownMembers:1,cacheTotalMembers:4,alerts:2,input:50,output:20,cacheRead:30,cacheWrite:null};
const response:OverviewSnapshot={range:'7d',provider:'',generatedAt:point.day,current:point,previous:null,daily:[point],providers:[{label:'codex',value:4}],models:[],tools:[],alerts:[],criteria:{zh:'根任务 UTC 口径',en:'ROOT UTC BASIS'}};
afterEach(()=>{vi.unstubAllGlobals();history.replaceState(null,'','#/overview');});
it('reads one real aggregate, renders six StatCards and preserves range/provider/alert navigation',async()=>{
 history.replaceState(null,'','#/overview?overviewRange=30d&overviewProvider=codex');
 const fetcher=vi.fn(async(_url:RequestInfo|URL)=>new Response(JSON.stringify(response)));vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div'),root=createRoot(host),navigate=vi.fn();
 try{await act(async()=>{root.render(<OverviewKpis locale="en" invalidateKey={0} onNavigate={navigate}/>);});
 expect(fetcher).toHaveBeenCalledOnce();expect(String(fetcher.mock.calls[0]?.[0])).toContain('range=30d&provider=codex');
 const cards=host.querySelectorAll<HTMLElement>('.overview-stat');expect(cards).toHaveLength(6);expect(host.textContent).toContain('Partial 3/4');expect(host.querySelectorAll('.ui-stat-sparkline')).toHaveLength(6);
 act(()=>cards.forEach(b=>b.click()));expect(navigate.mock.calls.map(c=>c[0])).toEqual([{homeRange:'30d',homeProvider:'codex'},{homeSort:'tokens',homeRange:'30d',homeProvider:'codex'},{homeSort:'cacheHitRate',homeRange:'30d',homeProvider:'codex'},{homeFilter:'failed',homeRange:'30d',homeProvider:'codex'},{homeFilter:'toolFailures',homeRange:'30d',homeProvider:'codex'},{homeFilter:'alerts',homeRange:'30d',homeProvider:'codex'}]);
 expect(host.textContent).not.toContain('vs previous period');expect(host.querySelector('.ui-stat-footer .ui-badge')).toBeNull();
 }finally{act(()=>root.unmount());}
});
it('hides unreliable/zero-baseline changes and gives lower failure rates a success direction',async()=>{
 expect(overviewChange(20,10,true)).toBe(1);expect(overviewChange(20,10,false)).toBeUndefined();expect(overviewChange(0,0,true)).toBeUndefined();expect(overviewChange(null,2,true)).toBeUndefined();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...response,current:{...point,statusKnownTasks:4,failurePct:25},previous:{...point,failurePct:50}}))));
 const host=document.createElement('div'),root=createRoot(host);try{await act(async()=>root.render(<OverviewKpis locale="zh" invalidateKey={0} onNavigate={()=>{}}/>));
 const failure=host.querySelectorAll('.overview-stat')[3]!;expect(failure.textContent).toContain('较前一周期');expect(failure.querySelector('.ui-badge-success')).not.toBeNull();expect(host.querySelectorAll('.overview-stat')[1]!.textContent).not.toContain('较前一周期');
 }finally{act(()=>root.unmount());}
});
it('renders unknown counters and empty distributions without inventing zeros and owns URL tabs',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...response,current:{...point,tokens:null,cacheHitRate:null},daily:[],providers:[],models:[],tools:[],alerts:[]}))));
 const host=document.createElement('div'),root=createRoot(host);try{await act(async()=>root.render(<OverviewKpis locale="en" invalidateKey={0} onNavigate={()=>{}}>UNIQUE AGENT METRICS</OverviewKpis>));
 expect(host.querySelectorAll('.ui-stat-value')[1]!.textContent).toContain('—');expect(host.textContent).toContain('No tasks in this range');expect(host.querySelector('svg[aria-label="Token usage trend"]')).toBeNull();
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b=>b.textContent==='Agent perspective')!.click());expect(host.textContent).toContain('UNIQUE AGENT METRICS');expect(location.hash).toContain('overviewTab=agent');
 }finally{act(()=>root.unmount());}
});
it('opens recent alert tasks by keyboard and allows retry after a failed read',async()=>{
 let fail=true;vi.stubGlobal('fetch',vi.fn(async()=>{if(fail)throw new Error('network');return new Response(JSON.stringify({...response,alerts:[{id:'collected:real',title:'REAL TASK',updatedAt:point.day,alerts:[{rule:'errors',actual:2,threshold:1}]}]}));}));
 const host=document.createElement('div'),root=createRoot(host),navigate=vi.fn();try{await act(async()=>root.render(<OverviewKpis locale="en" invalidateKey={0} onNavigate={navigate}/>));expect(host.querySelector('[role=alert]')).not.toBeNull();fail=false;
 await act(async()=>host.querySelector<HTMLButtonElement>('.ui-error button')!.click());act(()=>host.querySelector('tbody tr')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(navigate).toHaveBeenCalledWith(expect.objectContaining({task:'collected:real'}));
 }finally{act(()=>root.unmount());}
});

it.each([['zh','11/1'],['en','Nov 1']] as const)('uses short UTC dates in %s charts',async(locale,label)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(response))));const host=document.createElement('div'),root=createRoot(host);
 try{await act(async()=>root.render(<OverviewKpis locale={locale} invalidateKey={0} onNavigate={()=>{}}/>));const labels=[...host.querySelectorAll('.instrument-chart svg text')].map(node=>node.textContent);expect(labels).toContain(label);expect(labels).not.toContain('2026-11-01');}finally{act(()=>root.unmount());}
});
