import type { Database } from 'better-sqlite3';
import type { AlertThresholds, TaskSummary } from '../../src/core/task-types.js';
import type { OverviewPoint, OverviewRange, OverviewSnapshot } from '../../src/core/overview-types.js';
import { taskAlerts } from '../../src/core/task-alerts.js';
import { snapshot, TaskHomeChangedError } from './task-home.js';
import { cachedStmt } from './stmt-cache.js';
import { TASK_BINDINGS_SQL, TaskReadError } from './task-workbench.js';

const caches = new WeakMap<Database, Map<string, OverviewSnapshot>>();
const revision = (db: Database) => `${db.pragma('data_version', { simple: true })}:${(cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number }).n}`;
/** Root-task projection: never add overlapping session totals to task totals. */
export function overviewPoint(items: TaskSummary[], thresholds: AlertThresholds, day: string): OverviewPoint {
  const known = items.filter(t => ['success', 'error'].includes(t.recordedStatus));
  const sum = (key: 'input' | 'output' | 'cacheRead' | 'correctedTotal') => {
    const values = items.flatMap(t => t.metrics?.[key] == null ? [] : [t.metrics[key]!]);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  let results = 0, failures = 0, toolKnownTasks = 0, prompt = 0, read = 0;
  for (const t of items) {
    const m = t.metrics;
    if (m?.toolResults != null && m.toolFailures != null) { results += m.toolResults; failures += m.toolFailures; toolKnownTasks++; }
    if (m?.promptInput != null && m.cacheHitRate != null) { prompt += m.promptInput; read += m.promptInput * m.cacheHitRate; }
  }
  const failedTasks = known.filter(t => t.recordedStatus === 'error').length;
  return { day, tasks: items.length, statusKnownTasks: known.length, failedTasks, failurePct: known.length ? failedTasks / known.length * 100 : null,
    toolKnownTasks, toolFailurePct: results ? failures / results * 100 : null, tokens: sum('correctedTotal'),
    tokenKnownTasks: items.filter(t => { const c = t.metrics?.coverage?.correctedTotal; return c && c.total > 0 && c.known === c.total; }).length,
    cacheHitRate: prompt > 0 ? read / prompt : null, cacheKnownMembers: items.reduce((n, t) => n + (t.metrics?.coverage?.cacheHitRate.known ?? 0), 0), cacheTotalMembers: items.reduce((n, t) => n + t.memberCount, 0),
    alerts: items.filter(t => t.metrics && taskAlerts(t.metrics, thresholds).length).length, input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: null };
}
export async function overviewDashboard(db: Database, thresholds: AlertThresholds, range: string = '7d', provider = '', now = Date.now()): Promise<OverviewSnapshot> {
  if (!['24h', '7d', '30d', 'all'].includes(range) || provider.length > 128) throw new TaskReadError('BAD_REQUEST', 'Invalid overview filter');
  const stamp = revision(db), cacheKey = JSON.stringify([stamp, thresholds, range, provider, Math.floor(now / 60000)]);
  let cache = caches.get(db); if (!cache) { cache = new Map(); caches.set(db, cache); }
  const hit = cache.get(cacheKey); if (hit) return structuredClone(hit);
  const all = (await snapshot(db, thresholds.contextPressurePct !== null)).filter(t => t.origin === 'collected');
  const midnight=Math.floor(now/86400000)*86400000;
  const start=range==='all'?-Infinity:range==='24h'?now-86400000:midnight-((range==='7d'?7:30)-1)*86400000;
  const width=now-start;
  const last=(t:TaskSummary)=>Date.parse(t.updatedAt||t.startedAt||'');
  const inWindow = (t: TaskSummary, end: number, from:number) => { const activity=last(t),first=Date.parse(t.startedAt??'');return Number.isFinite(activity)&&activity>=from&&(Number.isFinite(first)?first<end:activity<end); };
  const selected = all.filter(t => !provider || t.provider === provider), items = selected.filter(t => inWindow(t,now,start));
  const generatedAt = new Date(now).toISOString();
  const buckets = new Map<string, TaskSummary[]>();
  const dayOf=(time:number)=>new Date(time).toISOString().slice(0,10)+'T00:00:00.000Z';
  for(const t of items){const time=last(t);if(time<start||time>=now)continue;const day=dayOf(time),group=buckets.get(day)??[];group.push(t);buckets.set(day,group);}
  const providers = [...new Set(all.map(t => t.provider))].sort().map(label => ({ label, value: items.filter(t => t.provider === label).length }));
  const models = new Map<string, number>();
  for (const t of items) { const m = t.metrics, c = m?.coverage?.correctedTotal; if (m?.models.length === 1 && m.correctedTotal != null && c?.known === c?.total && c) models.set(m.models[0]!, (models.get(m.models[0]!) ?? 0) + m.correctedTotal); }
  const writeRows=cachedStmt(db,`${TASK_BINDINGS_SQL} SELECT b.root_id,s.id,s.detail_loaded,s.token_cache_write FROM bindings b JOIN sessions s ON s.id=b.session_id WHERE b.root_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(selected.map(t=>t.rootSessionKey))) as Array<{root_id:string;id:string;detail_loaded:number;token_cache_write:number}>;
  const writes=new Map<string,number>(),writeMembers=new Map<string,typeof writeRows>();
  for(const row of writeRows){const group=writeMembers.get(row.root_id)??[];group.push(row);writeMembers.set(row.root_id,group);}
  for(const task of selected){const members=writeMembers.get(task.rootSessionKey??'')??[];if(members.length===task.memberCount&&members.every(r=>r.detail_loaded===1&&r.token_cache_write>0))writes.set(task.id,members.reduce((n,r)=>n+r.token_cache_write,0));}
  const point=(tasks:TaskSummary[],day:string)=>{const p=overviewPoint(tasks,thresholds,day);p.cacheWrite=tasks.length&&tasks.every(t=>writes.has(t.id))?tasks.reduce((n,t)=>n+writes.get(t.id)!,0):null;return p;};
  const tools = new Map<string, { tool: string; failures: number; results: number }>();
  // Bind selected roots once. Event lookup uses the covering result index, in yielded25-root batches.
  const stmt = cachedStmt(db, `${TASK_BINDINGS_SQL} SELECT e.tool,COUNT(1) AS results,SUM(CASE WHEN e.status='error' THEN 1 ELSE 0 END) AS failures FROM bindings b JOIN sessions s ON s.id=b.session_id JOIN events e INDEXED BY idx_events_task_results ON e.session_id=s.id AND e.kind='tool' WHERE b.root_id IN (SELECT value FROM json_each(?)) AND (e.output_len>0 OR (s.provider='opentelemetry' AND EXISTS(SELECT 1 FROM telemetry_spans t WHERE t.id=e.id AND json_type(t.metadata_json,'$.end')='text'))) AND e.status IN ('success','error') AND e.tool IS NOT NULL GROUP BY e.tool`);
  for (let offset = 0; offset < items.length; offset += 25) {
    const rows = stmt.all(JSON.stringify(items.slice(offset, offset + 25).map(t => t.rootSessionKey))) as Array<{ tool: string; failures: number; results: number }>;
    for (const row of rows) { const value = tools.get(row.tool) ?? { tool: row.tool, failures: 0, results: 0 }; value.failures += row.failures; value.results += row.results; tools.set(row.tool, value); }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (stamp !== revision(db)) throw new TaskHomeChangedError();
  const activityByDay=new Map<string,Set<string>>();
  const mark=(day:string,root:string)=>{const roots=activityByDay.get(day)??new Set<string>();roots.add(root);activityByDay.set(day,roots);};
  // Last-activity metadata also covers unloaded or eventless tasks without inventing event days.
  for(const [day,tasks] of buckets)for(const task of tasks)mark(day,task.id);
  const selectedRoots=new Set(items.map(t=>t.rootSessionKey));
  const members=writeRows.filter(r=>selectedRoots.has(r.root_id));
  const roots=new Map(members.map(r=>[r.id,'collected:'+r.root_id]));
  const activityStmt=cachedStmt(db,`SELECT session_id,substr(started_at,1,10) AS day FROM events INDEXED BY idx_events_session_time WHERE session_id IN (SELECT value FROM json_each(?)) AND started_at>=? AND started_at<? GROUP BY session_id,substr(started_at,1,10)`);
  for(let offset=0;offset<members.length;offset+=25){
    const rows=activityStmt.all(JSON.stringify(members.slice(offset,offset+25).map(r=>r.id)),Number.isFinite(start)?new Date(start).toISOString():'0000',generatedAt) as Array<{session_id:string;day:string}>;
    for(const row of rows)if(/^\d{4}-\d{2}-\d{2}$/.test(row.day))mark(row.day+'T00:00:00.000Z',roots.get(row.session_id)!);
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  const observed=[...activityByDay.keys()].sort();
  const first=range==='all'?Date.parse(observed[0]??''):Math.floor(start/86400000)*86400000;
  const final=range==='all'?Date.parse(observed.at(-1)??''):midnight;
  const weekly=range==='all'&&(final-first)/86400000+1>60;
  const weekStart=(n:number)=>n-((new Date(n).getUTCDay()+6)%7)*86400000;
  const step=(weekly?7:1)*86400000,from=weekly?weekStart(first):first;
  const daily:OverviewPoint[]=[];
  for(let time=from;Number.isFinite(time)&&time<=final;time+=step){
    const tasks:TaskSummary[]=[],active=new Set<string>();
    for(let day=time;day<time+step&&day<=final;day+=86400000){const key=dayOf(day);tasks.push(...(buckets.get(key)??[]));for(const root of activityByDay.get(key)??[])active.add(root);}
    const p=point(tasks,dayOf(time));p.tasks=active.size;
    if(!tasks.length){p.tokens=0;p.input=0;p.output=0;p.cacheRead=0;p.cacheWrite=0;}
    daily.push(p);
  }
  const priorTasks=range==='all'?[]:selected.filter(t=>inWindow(t,start,start-width));
  const previous=range==='all'?null:overviewPoint([],thresholds,new Date(start-width).toISOString());
  if(previous)previous.tasks=priorTasks.length;
  if(stamp!==revision(db))throw new TaskHomeChangedError();
  const value: OverviewSnapshot = { range: range as OverviewRange, provider, generatedAt, current: point(items, generatedAt), previous,
    daily, providers,
    models: [...models].map(([label, value]) => ({ label, value })), tools: [...tools.values()].sort((a, b) => b.failures / b.results - a.failures / a.results),
    alerts: items.filter(t => t.metrics && taskAlerts(t.metrics, thresholds).length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map(t => {const {metrics,...metadata}=t;return {...metadata,alerts:taskAlerts(metrics!,thresholds)};}),
    criteria: {zh:'范围任务按开始至最近活动区间相交计入。日任务数按事件 UTC 日期及最近活动元数据去重；7/30 天含今日连续日期，超过 60 日按 UTC 周一合并。Token、缓存、失败及告警是当前完整任务快照，仅归属最近活动日，并非当天增量；不重建历史快照变化。默认零计数不视为可靠上报。模型仅含完整单模型任务。',en:'Tasks intersect the window by start-to-last-activity interval. Daily task activity deduplicates root tasks by event UTC date plus last-activity metadata. Continuous7/30calendar dates include today; beyond60dates use UTC Monday weeks. Tokens, cache, failures and alerts are current whole-task snapshots assigned once to last activity, not daily increments; historical snapshot changes are unavailable. Default zero counters are not reliable reports. Models include complete single-model tasks only.'} };
  cache.set(cacheKey, value); if (cache.size > 8) cache.delete(cache.keys().next().value!); return structuredClone(value);
}
