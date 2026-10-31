import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASK_ROUTE, parseTaskRoute, serializeTaskRoute } from './task-route.js';
describe('task location', () => {
  it('round-trips an imported event without mixing source identities', () => {
    const route = { task: 'imported:abc', origin: 'imported' as const, member: 'main', mode: 'raw' as const, event: 'import:42' };
    expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  });
  it('retains legacy native session and team member identities', () => {
    expect(parseTaskRoute('#/session?key=codex-x').task).toBe('collected:codex-x');
    const route = parseTaskRoute('#/team?runId=team%3Acodex%3Arun%3Ax&replayAgent=member-x&panel=ledger');
    expect(parseTaskRoute('#/team?runId=x&sel=agent%3Ateam%3Acodex%3Aagent%3Ay').member).toBe('team:codex:agent:y');
    expect(route).toMatchObject({ task: 'run:team:codex:run:x', member: 'member-x', mode: 'raw' });
  });
});

it('restores evidence filters and an explicit UTC time interval', () => {
  const route = { task: 'collected:root', origin: 'collected' as const, member: 'all', mode: 'trajectory' as const, event: null, q: 'Read', errors: true, from: '2026-10-25T00:00:00.000Z', to: '2026-10-25T01:00:00.000Z' };
  expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  expect(parseTaskRoute('#/task?from=bad&to=bad').from).toBeUndefined();
});

it('round-trips architecture scope and disjoint repeated comparison groups', () => {
  const route = { task: null, origin: 'collected' as const, member: 'main', mode: 'architecture' as const, event: null, overview: true, compareA: ['collected:a', 'collected:b'], compareB: ['collected:c'] };
  expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  for (const query of ['a=collected:a&b=collected:a', 'a=bogus', 'a=collected:a&a=collected:a', Array.from({ length: 41 }, (_, i) => `a=collected:${i}`).join('&')]) {
    const parsed = parseTaskRoute('#/task?' + query); expect(parsed.compareA).toBeUndefined(); expect(parsed.compareB).toBeUndefined();
  }
  expect(parseTaskRoute('#/task?mode=broken&overview=x')).toMatchObject({ mode: 'trajectory' });
});

it('round-trips a shared health report and its exact evidence record', () => {
  for (const health of ['new', 'e48979c8-1988-47ce-8838-0e1cded73cbb']) {
    const route = { task: 'collected:main', origin: 'collected' as const, member: 'all', mode: 'trajectory' as const, event: 'main:event:e13', health };
    expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  }
  expect(parseTaskRoute('#/task?health=').health).toBeUndefined();
});

it('Phase B restores home filters/sorting and retains old session evidence anchors',()=>{
 const route={...DEFAULT_TASK_ROUTE,homeProvider:'codex' as const,homeSort:'cacheHitRate' as const,homeRange:'7d' as const,homeFilter:'alerts' as const,homeDirection:'asc' as const};
 expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
 expect(parseTaskRoute('#/task?key=native&eventId=e')).toMatchObject({task:'collected:native',event:'native:event:e'});
 expect(parseTaskRoute('#/task?sort=invalid&filter=bad&direction=wrong')).toEqual(DEFAULT_TASK_ROUTE);
});

it('Phase C restores legacy session pairs, preserves groups and process selection in share URLs',async()=>{
 const {serializeComparisonRoute}=await import('./task-route.js');
 const legacy=parseTaskRoute('#/compare?left=child&right=root');
 expect(legacy.compareA).toEqual(['collected:child']);expect(legacy.compareB).toEqual(['collected:root']);
 const route={...legacy,compareA:['collected:a','imported:b'],processA:'imported:b',processB:'collected:root'};
 const hash=serializeComparisonRoute(route);expect(hash).toContain('pa=imported%3Ab');expect(hash).not.toContain('left=');
 expect(parseTaskRoute(hash)).toMatchObject({compareA:route.compareA,compareB:route.compareB,processA:route.processA,processB:route.processB});
 expect(serializeComparisonRoute({...route,processA:'collected:outside'})).not.toContain('pa=');
});
it('Phase C stores only10 recent valid URL definitions and tolerates storage failures',async()=>{
 const {rememberComparison,readRecentComparisons}=await import('./task-route.js');
 localStorage.clear();for(let i=0;i<12;i++)rememberComparison({...parseTaskRoute('#/compare'),compareA:['collected:a'+i],compareB:['collected:b']});
 expect(readRecentComparisons()).toHaveLength(10);expect(readRecentComparisons()[0]).toContain('a11');
 const diagnostic=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{localStorage.setItem('task-comparison.recent.v1','invalid');expect(readRecentComparisons()).toEqual([]);expect(diagnostic).toHaveBeenCalledExactlyOnceWith('[task-comparison] Failed to read recent comparisons:',expect.any(SyntaxError));}finally{diagnostic.mockRestore();}
});

it('Phase C storage failures are diagnosed without preventing URL-defined comparison',async()=>{
 const {rememberComparison,readRecentComparisons}=await import('./task-route.js');
 localStorage.clear();
 const readError=new Error('disabled'),writeError=new Error('quota');
 const diagnostic=vi.spyOn(console,'error').mockImplementation(()=>{});
 const read=vi.spyOn(localStorage,'getItem').mockImplementation(()=>{throw readError;});
 const write=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw writeError;});
 try{
  expect(readRecentComparisons()).toEqual([]);
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith('[task-comparison] Failed to read recent comparisons:',readError);
  read.mockRestore();diagnostic.mockClear();
  expect(()=>rememberComparison({...DEFAULT_TASK_ROUTE,compareA:['collected:a'],compareB:['collected:b']})).not.toThrow();
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith('[task-comparison] Failed to save recent comparisons:',writeError);
 }finally{read.mockRestore();write.mockRestore();diagnostic.mockRestore();}
});

it('round-trips request selection and comparison references while keeping old links whole-task',async()=>{
  const {serializeComparisonRoute}=await import('./task-route.js');
  const route={...DEFAULT_TASK_ROUTE,task:'collected:root',request:'request:root:event:prompt/1'};
  expect(parseTaskRoute(serializeTaskRoute(route))).toEqual(route);
  expect(parseTaskRoute('#/task?task=collected:root').request).toBeUndefined();
  const compare={...DEFAULT_TASK_ROUTE,compareA:['collected:root'],compareB:['collected:root'],requestA:'request:root:event:one',requestB:'request:root:event:two'};
  expect(parseTaskRoute(serializeComparisonRoute(compare))).toEqual(compare);
  expect(parseTaskRoute('#/compare?a=collected:a&b=collected:b').requestA).toBeUndefined();
});

it('ignores retired currency and monetary sort parameters during canonicalization',()=>{
 const parsed=parseTaskRoute('#/task?sort=cost&currency=CNY');expect(parsed).toEqual(DEFAULT_TASK_ROUTE);
 expect(serializeTaskRoute(parsed)).not.toMatch(/currency|cost/);
 expect(parseTaskRoute('#/task?currency=invalid&sort=cacheHitRate').homeSort).toBe('cacheHitRate');
});
