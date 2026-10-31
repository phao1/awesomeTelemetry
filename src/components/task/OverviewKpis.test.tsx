import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {OverviewKpis} from './OverviewKpis.js';
it('reads one aggregate and maps all six metrics into the shared task-route filters',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({tasks:4,statusKnownTasks:4,toolKnownTasks:4,failedTasks:1,failurePct:25,toolFailurePct:50,tokens:100,tokenKnownTasks:3,costs:{amounts:[{currency:'USD',amount:1,source:'reported'}],known:1,total:4},alerts:2})));vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div'),root=createRoot(host),navigate=vi.fn();try{
 await act(async()=>{root.render(<OverviewKpis locale="en" invalidateKey={0} onNavigate={navigate}/>);await new Promise(r=>setTimeout(r,10));});
 expect(fetcher).toHaveBeenCalledOnce();const buttons=host.querySelectorAll<HTMLButtonElement>('.overview-kpi');expect(buttons).toHaveLength(6);expect(host.textContent).toContain('100 · Partial');
 act(()=>buttons.forEach(b=>b.click()));expect(navigate.mock.calls.map(c=>c[0])).toEqual([{homeRange:'7d'},{homeFilter:'failed',homeRange:'7d'},{homeFilter:'toolFailures',homeRange:'7d'},{homeSort:'tokens',homeRange:'7d'},{homeSort:'cost',homeRange:'7d'},{homeFilter:'alerts',homeRange:'7d'}]);
 }finally{act(()=>root.unmount());vi.unstubAllGlobals();}
});
