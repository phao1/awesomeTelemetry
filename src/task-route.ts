import { PROVIDER_KEYS, type ProviderKey } from './core/trace-types.js';
import type { TaskSort, TaskOrigin } from './core/task-types.js';
export type TaskMode = 'trajectory' | 'conversation' | 'raw' | 'architecture';
export interface TaskRoute { processA?: string; processB?: string; homeProvider?: ProviderKey; homeSort?: TaskSort; homeDirection?: 'asc' | 'desc'; homeRange?: 'all' | 'today' | '7d' | '30d'; homeFilter?: 'all' | 'alerts' | 'errors' | 'failed' | 'toolFailures'; homeCurrency?: 'USD' | 'CNY'; health?: string; overview?: boolean; compareA?: string[]; compareB?: string[]; compareImport?: boolean; task: string | null; origin: TaskOrigin; member: string; mode: TaskMode; event: string | null; q?: string; errors?: boolean; from?: string; to?: string }
export const DEFAULT_TASK_ROUTE: TaskRoute = { task: null, origin: 'collected', member: 'main', mode: 'trajectory', event: null };
/** Legacy session/team references retain their native identity until server resolution. */
export function parseTaskRoute(hash: string): TaskRoute {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(search), mode = q.get('mode');
  const task = q.get('task') ?? (['task','session','sessions'].includes(path??'') && q.has('key') ? 'collected:' + q.get('key') : path === 'team' && q.has('runId') ? 'run:' + q.get('runId') : null);
  const a = q.getAll('a'), b = q.getAll('b');
  if(path==='compare'){if(!a.length&&q.get('left'))a.push('collected:'+q.get('left'));if(!b.length&&q.get('right'))b.push('collected:'+q.get('right'));}
  const valid = (ids: string[]) => ids.length <= 40 && new Set(ids).size === ids.length && ids.every(id => /^(collected|imported):[^\s]+$/.test(id) && id.length <= 1024);
  const groups = valid(a) && valid(b) && !a.some(id => b.includes(id)) ? { ...(a.length ? { compareA: a } : {}), ...(b.length ? { compareB: b } : {}) } : {};
  const from = q.get('from'), to = q.get('to');
  const time = from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) && Date.parse(from) <= Date.parse(to) ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {};
  const provider=q.get('provider')?.split(',')[0];
  const home = {
    ...(provider&&(PROVIDER_KEYS as readonly string[]).includes(provider)?{homeProvider:provider as ProviderKey}:{}),
    ...(['time','duration','errors','tokens','cost'].includes(q.get('sort')??'')?{homeSort:q.get('sort') as TaskSort}:{}),
    ...(q.get('direction')==='asc'?{homeDirection:'asc' as const}:{}),
    ...(['today','7d','30d','all'].includes(q.get('range')??'')?{homeRange:q.get('range') as TaskRoute['homeRange']}:{}),
    ...(['alerts','errors','failed','toolFailures'].includes(q.get('filter')??'')?{homeFilter:q.get('filter') as TaskRoute['homeFilter']}:{}),
    ...(q.get('currency')==='CNY'?{homeCurrency:'CNY' as const}:{}),
  };
  return { ...(q.get('pa')?{processA:q.get('pa')!}:{}),...(q.get('pb')?{processB:q.get('pb')!}:{}), ...home, ...(q.get('health') ? { health: q.get('health')!.slice(0, 128) } : {}), ...groups, ...(q.get('overview') === '1' ? { overview: true } : {}), ...(q.get('compareImport') === '1' ? { compareImport: true } : {}), ...time, ...(q.has('q') ? { q: q.get('q')!.slice(0, 200) } : {}), ...(q.get('errors') === '1' ? { errors: true } : {}), task, origin: q.get('origin') === 'imported' || task?.startsWith('imported:') ? 'imported' : 'collected',
    member: q.get('member') ?? q.get('replayAgent') ?? (q.get('sel')?.startsWith('agent:') ? q.get('sel')!.slice(6) : 'main'),
    mode: mode === 'architecture' || mode === 'conversation' || mode === 'raw' ? mode : q.get('panel') === 'ledger' ? 'raw' : 'trajectory', event: q.get('event') ?? (q.has('key') && q.has('eventId') ? q.get('key')+':event:'+q.get('eventId') : null) };
}
export function serializeTaskRoute(route: TaskRoute): string {
  const q = new URLSearchParams({ origin: route.origin });
  if(route.processA)q.set('pa',route.processA);
  if(route.processB)q.set('pb',route.processB);
  if(route.homeProvider)q.set('provider',route.homeProvider);
  if(route.homeSort)q.set('sort',route.homeSort);
  if(route.homeDirection)q.set('direction',route.homeDirection);
  if(route.homeRange)q.set('range',route.homeRange);
  if(route.homeFilter)q.set('filter',route.homeFilter);
  if(route.homeCurrency)q.set('currency',route.homeCurrency);
  if (route.health) q.set('health', route.health);
  if (route.overview) q.set('overview', '1');
  if (route.compareImport) q.set('compareImport', '1');
  for (const id of route.compareA ?? []) q.append('a', id);
  for (const id of route.compareB ?? []) q.append('b', id);
  if (route.task) q.set('task', route.task);
  if (route.member !== 'main') q.set('member', route.member);
  if (route.mode !== 'trajectory') q.set('mode', route.mode);
  if (route.event) q.set('event', route.event);
  if (route.q) q.set('q', route.q);
  if (route.errors) q.set('errors', '1');
  if (route.from && route.to) { q.set('from', route.from); q.set('to', route.to); }
  return '#/task?' + q.toString();
}

/** TC-001/005: only the definition, never list filters or evidence state. */
export function serializeComparisonRoute(route:TaskRoute):string{
  const q=new URLSearchParams();
  for(const id of route.compareA??[])q.append('a',id);
  for(const id of route.compareB??[])q.append('b',id);
  if(route.processA&&route.compareA?.includes(route.processA))q.set('pa',route.processA);
  if(route.processB&&route.compareB?.includes(route.processB))q.set('pb',route.processB);
  if(route.compareImport)q.set('compareImport','1');
  return '#/compare'+(q.size?'?'+q.toString():'');
}
export function readRecentComparisons():string[]{
  try{const value:unknown=JSON.parse(localStorage.getItem('task-comparison.recent.v1')??'[]');return Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'&&v.startsWith('#/compare?')&&v.length<=180000&&Boolean(parseTaskRoute(v).compareA?.length&&parseTaskRoute(v).compareB?.length)).slice(0,10):[];}catch(error){
    console.error('[task-comparison] Failed to read recent comparisons:',error);
    return [];
  }
}
export function rememberComparison(route:TaskRoute):void{
  if(!route.compareA?.length||!route.compareB?.length)return;
  try{const hash=serializeComparisonRoute(route);localStorage.setItem('task-comparison.recent.v1',JSON.stringify([hash,...readRecentComparisons().filter(v=>v!==hash)].slice(0,10)));}catch(error){
    console.error('[task-comparison] Failed to save recent comparisons:',error);
  }
}
