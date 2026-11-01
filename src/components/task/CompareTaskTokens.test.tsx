import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import type {TaskComparisonSnapshot,TaskSummary} from '../../core/task-types.js';
import {CompareTaskTokens} from './CompareTaskTokens.js';
import {compareTokenRows} from './compare-token-model.js';
const c={known:1,total:1,missing:[]};
const task:TaskSummary={id:'collected:a',requestId:'request:a',title:'Task',provider:'codex',origin:'collected',provenanceKnown:true,rootSessionKey:'a',runId:null,startedAt:null,updatedAt:'2026-11-01T00:00:00Z',recordedStatus:'success',memberCount:1,eventCount:1,loadedMemberCount:1,metrics:{durationMs:1,toolCalls:0,errors:0,input:10,output:20,cacheRead:100000,correctedTotal:100030,promptInput:100010,cacheHitRate:.9,models:['model'],coverage:{input:c,output:c,cacheRead:c,correctedTotal:c,promptInput:c,cacheHitRate:c,models:c}}};
it('renders two normalized fixed-token-color bars, hover values/shares, four exact/compact rows and cache meters',()=>{
 const snapshot:TaskComparisonSnapshot={a:[task],b:[{...task,id:'collected:b',requestId:'request:b',metrics:{...task.metrics!,input:5}}]},host=document.createElement('div'),root=createRoot(host);
 try{act(()=>root.render(<CompareTaskTokens snapshot={snapshot} locale="en"/>));const bars=host.querySelectorAll('.compare-token-stack');expect(bars).toHaveLength(2);
 for(const bar of bars){const parts=[...bar.querySelectorAll<HTMLElement>('span')];expect(parts.reduce((sum,p)=>sum+Number.parseFloat(p.style.width),0)).toBeCloseTo(100);expect(parts.map(p=>p.style.background)).toEqual(['var(--token-input)','var(--token-output)','var(--token-cache-read)']);expect(parts[2]!.title).toContain('100,000');expect(parts[2]!.title).toContain('%');}
 expect(host.querySelectorAll('tbody tr')).toHaveLength(4);expect(host.querySelectorAll('tbody tr')[2]!.textContent).toContain('100K');expect(host.querySelectorAll('tbody tr')[3]!.textContent).toContain('—');expect(host.querySelectorAll('[role=meter]')).toHaveLength(2);expect(compareTokenRows(snapshot,null,'en')[0]).toMatchObject({a:10,b:5,delta:-5,ratio:.5});
 const mixed={...snapshot,b:[{...snapshot.b[0]!,provider:'claude'}]};expect(compareTokenRows(mixed,null,'en')[0]).toMatchObject({a:10,b:5,delta:null,ratio:null});
 }finally{act(()=>root.unmount());}
});
