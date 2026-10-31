import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type { MissionResponse } from '../core/trace-types.js';
import {
  LEGACY_SECTION_ROLE,
  MissionControl,
  redirectLegacyMissionHash,
  type MissionRange,
} from './MissionControl.js';

function makeResponse(): MissionResponse {
  const widget = (id: string, available: boolean): unknown => ({
    id,
    criteria: `custom-criteria-${id}`,
    available,
    unavailableReason: available ? null : 'NOT_IMPLEMENTED_YET',
    data: available
      ? []
      : null,
  });
  const usage = {
    toolTop: widget('toolTop', true),
    skillTop: widget('skillTop', false),
    subagent: widget('subagent', false),
    promptHabits: widget('promptHabits', false),
    activity: widget('activity', false),
  };
  const quality = {
    closure: widget('closure', false),
    toolFailure: widget('toolFailure', false),
    tokenTrend: widget('tokenTrend', false),
    errorReasons: widget('errorReasons', false),
    riskyCommands: widget('riskyCommands', false),
    drift: widget('drift', false),
    contextPressure: widget('contextPressure', false),
    models: widget('models', false),
    depth: widget('depth', false),
    toolEcology: widget('toolEcology', false),
    scenes: widget('scenes', false),
    heavyScenes: widget('heavyScenes', false),
    parallelism: widget('parallelism', false),
  };
  const health = {
    collectors: widget('collectors', false),
    dualChannel: widget('dualChannel', false),
  };
  return {
    meta: {
      range: '7d',
      generatedAt: '2026-08-05T01:02:03.000Z',
      tz: 480,
      widgetCount: 21,
      durationMs: 42,
      stamp: '2026-08-05T00:00:00.000Z',
      cached: false,
    },
    usage: usage as MissionResponse['usage'],
    quality: quality as MissionResponse['quality'],
    health: health as MissionResponse['health'],
  };
}


it('reads one aggregate, retains unique widgets as cards and removes role/sidebar/disclosure navigation',async()=>{
 const load=vi.fn(async(_range:MissionRange)=>makeResponse()),host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{await act(async()=>root.render(<MissionControl locale="zh" load={load}/>));expect(load).toHaveBeenCalledOnce();expect(host.querySelectorAll('.mission-widget')).toHaveLength(17);expect(host.querySelector('.mission-nav')).toBeNull();expect(host.querySelector('.mission-role-section')).toBeNull();expect(host.querySelector('details')).toBeNull();expect(host.textContent).toContain('该指标当前不可用');expect(host.querySelector('#widget-closure')).not.toBeNull();expect(host.querySelector('#widget-activity')).not.toBeNull();expect(host.querySelector('#widget-toolTop')).toBeNull();
 const info=host.querySelector<HTMLButtonElement>('#widget-closure button')!;act(()=>info.focus());await act(async()=>new Promise(resolve=>setTimeout(resolve,320)));expect(document.querySelector('[role=tooltip]')?.textContent).toBeTruthy();
 }finally{act(()=>root.unmount());host.remove();}
});
it('range changes read once and controlled hash range remains compatible',async()=>{
 const load=vi.fn(async(_range:MissionRange)=>makeResponse()),onRangeChange=vi.fn(),host=document.createElement('div'),root=createRoot(host);
 try{await act(async()=>root.render(<MissionControl locale="en" load={load} initialRange="7d" onRangeChange={onRangeChange}/>));await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role=tab]')[1]!.click());expect(onRangeChange).toHaveBeenCalledWith('30d');expect(load).toHaveBeenLastCalledWith('30d');expect(load).toHaveBeenCalledTimes(2);
 await act(async()=>root.render(<MissionControl locale="en" load={load} initialRange="all"/>));expect(load).toHaveBeenLastCalledWith('all');
 }finally{act(()=>root.unmount());}
});
it('retains multi-model raw component evidence, closure and measured drift as distinct Agent cards without money',async()=>{
 const response=makeResponse();response.quality.models={id:'models',criteria:'raw model attribution',available:true,unavailableReason:null,data:[{model:'glm-4-plus',calls:3,input:100,output:50,cacheRead:30,cacheWrite:10}]};response.quality.drift={id:'drift',criteria:'wall clock p95',available:true,unavailableReason:null,data:[{day:'2026-11-01',sessions:1,input:100,output:50,cacheRead:30,cacheWrite:10,cacheHitRate:0.3,cacheKnownMembers:1,cacheTotalMembers:1,errorEvents:0,successRate:1,e2eP95Ms:200}]};
 const host=document.createElement('div'),root=createRoot(host);try{await act(async()=>root.render(<MissionControl locale="zh" load={async()=>response}/>));expect(host.querySelector('#widget-models')?.textContent).toContain('glm-4-plus');expect(host.querySelector('#widget-models')?.textContent).toContain('输入 100');expect(host.querySelector('#widget-drift svg[role=img]')?.getAttribute('aria-label')).toBe('任务墙钟 P95');expect(host.textContent).not.toMatch(/[$¥￥€£]\s*\d/);expect(host.querySelector('#widget-costEfficiency')).toBeNull();}finally{act(()=>root.unmount());}
});
it('marks SSE invalidation stale, refreshes explicitly, and retries error without polling',async()=>{
 let fail=true;const load=vi.fn(async(_range:MissionRange)=>{if(fail)throw new Error('offline');return makeResponse();}),host=document.createElement('div'),root=createRoot(host);const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);
 try{await act(async()=>root.render(<MissionControl locale="en" load={load}/>));expect(host.querySelector('[role=alert]')).not.toBeNull();fail=false;await act(async()=>host.querySelector<HTMLButtonElement>('.ui-error button')!.click());expect(host.querySelectorAll('.mission-widget')).toHaveLength(17);await act(async()=>root.render(<MissionControl locale="en" load={load} invalidateKey={1}/>));expect(load).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('changed');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Refresh')!.click());expect(load).toHaveBeenCalledTimes(3);
 }finally{act(()=>root.unmount());log.mockRestore();}
});
it('ignores late results from a retired range and retains legacy hash mapping utility',async()=>{
 let finish:((value:MissionResponse)=>void)|undefined;const load=vi.fn((range:MissionRange)=>range==='7d'?new Promise<MissionResponse>(resolve=>{finish=resolve;}):Promise.resolve({...makeResponse(),meta:{...makeResponse().meta,generatedAt:'2026-11-01T00:00:00.000Z'}}));const host=document.createElement('div'),root=createRoot(host);
 try{await act(async()=>root.render(<MissionControl locale="en" load={load}/>));await act(async()=>root.render(<MissionControl locale="en" load={load} initialRange="all"/>));await act(async()=>finish!(makeResponse()));expect(host.textContent).toContain('2026-11-01');expect(host.textContent).not.toContain('2026-08-05');expect(redirectLegacyMissionHash('#mission-a')).toBe('#mission-role-manager');expect(redirectLegacyMissionHash('#mission-b')).toBe('#mission-role-engineer');expect(redirectLegacyMissionHash('#mission-c')).toBe('#mission-role-ops');expect(redirectLegacyMissionHash('#/overview')).toBeNull();expect(LEGACY_SECTION_ROLE.a).toBe('manager');
 }finally{act(()=>root.unmount());}
});
