import type { TaskOrigin } from './core/task-types.js';
export type TaskMode = 'trajectory' | 'conversation' | 'raw';
export interface TaskRoute { task: string | null; origin: TaskOrigin; member: string; mode: TaskMode; event: string | null; q?: string; errors?: boolean; from?: string; to?: string }
export const DEFAULT_TASK_ROUTE: TaskRoute = { task: null, origin: 'collected', member: 'main', mode: 'trajectory', event: null };
/** Legacy session/team references retain their native identity until server resolution. */
export function parseTaskRoute(hash: string): TaskRoute {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(search), mode = q.get('mode');
  const task = q.get('task') ?? (path === 'session' && q.has('key') ? 'collected:' + q.get('key') : path === 'team' && q.has('runId') ? 'run:' + q.get('runId') : null);
  const from = q.get('from'), to = q.get('to');
  const time = from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) && Date.parse(from) <= Date.parse(to) ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {};
  return { ...time, ...(q.has('q') ? { q: q.get('q')!.slice(0, 200) } : {}), ...(q.get('errors') === '1' ? { errors: true } : {}), task, origin: q.get('origin') === 'imported' || task?.startsWith('imported:') ? 'imported' : 'collected',
    member: q.get('member') ?? q.get('replayAgent') ?? (q.get('sel')?.startsWith('agent:') ? q.get('sel')!.slice(6) : 'main'),
    mode: mode === 'conversation' || mode === 'raw' ? mode : q.get('panel') === 'ledger' ? 'raw' : 'trajectory', event: q.get('event') };
}
export function serializeTaskRoute(route: TaskRoute): string {
  const q = new URLSearchParams({ origin: route.origin });
  if (route.task) q.set('task', route.task);
  if (route.member !== 'main') q.set('member', route.member);
  if (route.mode !== 'trajectory') q.set('mode', route.mode);
  if (route.event) q.set('event', route.event);
  if (route.q) q.set('q', route.q);
  if (route.errors) q.set('errors', '1');
  if (route.from && route.to) { q.set('from', route.from); q.set('to', route.to); }
  return '#/task?' + q.toString();
}
