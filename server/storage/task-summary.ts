import type { Database } from 'better-sqlite3';
import type { TaskContext, TaskMetrics, TaskMetricKey } from '../../src/core/task-types.js';
import { computeCost, lookupModelPrice, lookupContextWindow, modelPricingRevision } from '../../src/core/pricing.js';
import { correctedUsage } from '../../src/core/benchmark-analysis.js';
import { cachedStmt } from './stmt-cache.js';
export type SummarySession = { id: string; provider: string; started_at: string; total_duration_ms: number; duration_source: string; detail_loaded: number; token_input: number; token_output: number; token_cache_read: number; token_cache_write: number; cost_usd: number; cost_source: string; cost_currency: string; primary_model: string | null; tools: number; errors: number; results: number; failures: number; pressure: number | null };
const cache = new WeakMap<Database, Map<string, { revision: string; value: TaskMetrics }>>();
const known = (n: number) => Number.isSafeInteger(n) && n > 0 ? n : null;
const sum = (values: Array<number | null>): number | null => values.length && values.every(v => v !== null) && Number.isSafeInteger(values.reduce<number>((n, v) => n + (v ?? 0), 0)) ? values.reduce<number>((n, v) => n + v!, 0) : null;
/** Session counters are normalized by adapters: input excludes cache, Codex output includes reasoning.
 * Legacy zero defaults cannot establish that a counter was reported. */
export function sessionUsage(row: Pick<SummarySession, 'provider' | 'token_input' | 'token_output' | 'token_cache_read' | 'token_cache_write'>) {
  const input = known(row.token_input), output = known(row.token_output), cacheRead = known(row.token_cache_read);
  const convention = ['codex', 'claude', 'codeagent', 'workbuddy'].includes(row.provider);
  const cacheWriteReported = row.token_cache_write > 0 ? true : row.provider === 'codex' && row.token_cache_write === 0 ? false : null;
  return { input, output, cacheRead, total: convention ? correctedUsage({ input, output, cacheRead, cacheWrite: known(row.token_cache_write), reasoning: null, inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported }).total : null };
}
export const SESSION_METRIC_COLS = 's.id,s.provider,s.started_at,s.total_duration_ms,s.duration_source,s.detail_loaded,s.token_input,s.token_output,s.token_cache_read,s.token_cache_write,s.cost_usd,s.cost_source,s.cost_currency,s.primary_model';
/** Correlated counts stay on covering indexes; body columns are never acquired. */
export function readSummarySessions(db: Database, keys: string[], includePressure = false): SummarySession[] {
  const rows = cachedStmt(db, `SELECT ${SESSION_METRIC_COLS},
    (SELECT COUNT(1) FROM events e WHERE e.session_id=s.id AND e.kind='tool' AND e.input_len>0) AS tools,
    (SELECT COUNT(1) FROM events e WHERE e.session_id=s.id AND e.status='error') AS errors,
    (SELECT COUNT(1) FROM events e INDEXED BY idx_events_task_results WHERE e.session_id=s.id AND e.kind='tool' AND e.output_len>0 AND e.status IN ('success','error')) AS results,
    (SELECT COUNT(1) FROM events e INDEXED BY idx_events_task_results WHERE e.session_id=s.id AND e.kind='tool' AND e.output_len>0 AND e.status='error') AS failures
    FROM sessions s WHERE s.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(keys)) as SummarySession[];
  if(!includePressure)return rows.map(row=>({...row,pressure:null}));
  const context = cachedStmt(db, `SELECT session_id,model,MAX(COALESCE(json_extract(CASE WHEN json_valid(tokens_json) THEN tokens_json ELSE '{}' END,'$.input'),0)+COALESCE(json_extract(CASE WHEN json_valid(tokens_json) THEN tokens_json ELSE '{}' END,'$.cacheRead'),0)+COALESCE(json_extract(CASE WHEN json_valid(tokens_json) THEN tokens_json ELSE '{}' END,'$.cacheWrite'),0)) AS n
    FROM events INDEXED BY idx_events_task_context WHERE session_id IN (SELECT value FROM json_each(?)) AND kind='llm' AND model IS NOT NULL AND tokens_json IS NOT NULL
    AND (json_type(CASE WHEN json_valid(tokens_json) THEN tokens_json ELSE '{}' END,'$.input') IN ('integer','real') OR json_type(CASE WHEN json_valid(tokens_json) THEN tokens_json ELSE '{}' END,'$.cacheRead') IN ('integer','real') OR json_type(CASE WHEN json_valid(tokens_json) THEN tokens_json ELSE '{}' END,'$.cacheWrite') IN ('integer','real')) GROUP BY session_id,model`).all(JSON.stringify(keys)) as Array<{session_id:string;model:string;n:number}>;
  const pressure = new Map<string, number>();
  for (const r of context) { const window = lookupContextWindow(r.model); if (window && Number.isFinite(r.n) && r.n >= 0) pressure.set(r.session_id, Math.max(pressure.get(r.session_id) ?? 0, 100*r.n/window)); }
  return rows.map(row => ({ ...row, pressure: pressure.get(row.id) ?? null }));
}
export function taskMetrics(db: Database, context: TaskContext, supplied?: SummarySession[]): TaskMetrics {
  const revision = supplied ? '' : String(db.pragma('data_version', { simple: true })) + ':' + (cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number }).n + ':' + modelPricingRevision();
  let entries = cache.get(db); if (!entries) { entries = new Map(); cache.set(db, entries); }
  const hit = entries.get(context.task.id); if (!supplied && hit?.revision === revision) return structuredClone(hit.value);
  const value: TaskMetrics = { durationMs: null, toolCalls: null, errors: null, input: null, output: null, cacheRead: null, correctedTotal: null, costUsd: null, models: [] };
  if (context.importSession) {
    const s = context.importSession, start = Date.parse(s.startedAt ?? ''), end = Date.parse(s.endedAt ?? '');
    value.durationMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
    value.models = s.model ? [s.model] : [];
  } else {
    const keys = JSON.stringify(context.members.flatMap(m => m.sessionKey ? [m.sessionKey] : []));
    const rows = supplied ?? readSummarySessions(db, JSON.parse(keys) as string[]);
    const complete = rows.length === context.task.memberCount && rows.every(r => r.detail_loaded === 1);
    const byKey = new Map(rows.map(row => [row.id, row]));
    const members = context.members.map(member => {
      const row = member.sessionKey ? byKey.get(member.sessionKey) : undefined;
      return { member, row, usage: row?.detail_loaded === 1 ? sessionUsage(row) : null };
    });
    const metricKeys: TaskMetricKey[] = ['input', 'output', 'cacheRead', 'correctedTotal', 'models'];
    const coverage = {} as NonNullable<TaskMetrics['coverage']>;
    for (const key of metricKeys) {
      const metric = key === 'correctedTotal' ? 'total' : key;
      const knownValues: number[] = [];
      const missing: typeof coverage[typeof key]['missing'] = [];
      const models: string[] = [];
      for (const { member, row, usage } of members) {
        const observed = metric === 'models' ? row?.primary_model || null : usage?.[metric] ?? null;
        if (observed === null) {
          const reason = !row ? 'session_unavailable' : key !== 'models' && row.detail_loaded !== 1 ? 'detail_not_loaded' : key === 'correctedTotal' && !['codex', 'claude', 'codeagent', 'workbuddy'].includes(row.provider) ? 'accounting_unknown' : 'not_reported';
          missing.push({ memberId: member.id, name: member.name, reason });
        } else if (typeof observed === 'number') knownValues.push(observed);
        else models.push(observed);
      }
      coverage[key] = { known: key === 'models' ? models.length : knownValues.length, total: context.task.memberCount, missing };
      if (key === 'models') value.models = [...new Set(models)];
      else value[key] = sum(knownValues);
    }
    value.coverage = coverage;
    if (complete) {
      value.toolCalls = rows.reduce((n,r) => n+r.tools,0); value.errors = rows.reduce((n,r) => n+r.errors,0);
      value.toolResults = rows.reduce((n,r) => n+r.results,0); value.toolFailures = rows.reduce((n,r) => n+r.failures,0);
      const starts = rows.map(r => Date.parse(r.started_at));
      if (starts.every(Number.isFinite) && rows.every(r => ['measured', 'derived'].includes(r.duration_source) && r.total_duration_ms >= 0)) value.durationMs = Math.max(...rows.map((r, i) => starts[i]! + r.total_duration_ms)) - Math.min(...starts);
    }
    const amounts: NonNullable<TaskMetrics['costs']>['amounts'] = [];
    let costKnown = 0;
    const missingPrices=new Set<string>(),missingReasons=new Set<NonNullable<NonNullable<TaskMetrics['costs']>['missingReasons']>[number]>();
    if(rows.length<context.task.memberCount)missingReasons.add('session_unavailable');
    for (const r of rows) {
      let amount: number | null = null, currency: 'USD' | 'CNY' = r.cost_currency === 'CNY' ? 'CNY' : 'USD', source: 'reported' | 'estimated' = 'reported';
      if (r.cost_source === 'reported' && ['USD','CNY'].includes(r.cost_currency) && Number.isFinite(r.cost_usd) && r.cost_usd >= 0) amount = r.cost_usd;
      else if (r.detail_loaded === 1 && sessionUsage(r).total !== null) {
        const result = computeCost({ input:r.token_input,output:r.token_output,cacheRead:r.token_cache_read,cacheWrite:r.token_cache_write,reasoning:0,netInput:r.token_input,total:sessionUsage(r).total! },r.primary_model);
        if (result.costSource !== 'unknown') { amount=result.cost; currency=result.currency; source='estimated'; }
      }
      if (amount === null) {
        if(r.detail_loaded!==1)missingReasons.add('detail_not_loaded');
        if(r.detail_loaded===1&&!r.primary_model)missingReasons.add('model_unknown');
        else if(r.detail_loaded===1&&r.primary_model&&!lookupModelPrice(r.primary_model)){missingPrices.add(r.primary_model);missingReasons.add('model_unpriced');}
        if(r.detail_loaded===1&&sessionUsage(r).total===null)missingReasons.add('usage_unknown');
        continue;
      }
      costKnown++; const entry=amounts.find(a=>a.currency===currency);
      if (entry) { entry.amount+=amount; if(entry.source!==source)entry.source='mixed'; } else amounts.push({currency,amount,source});
    }
    value.costs={amounts,known:costKnown,total:context.task.memberCount,...(missingPrices.size?{missingPrices:[...missingPrices]}:{}),...(missingReasons.size?{missingReasons:[...missingReasons]}:{})};
    value.costUsd=costKnown===context.task.memberCount && amounts.length===1 && amounts[0]!.currency==='USD' ? amounts[0]!.amount : null;
    const pressures=rows.flatMap(r=>r.pressure===null?[]:[r.pressure]);
    value.contextPressurePct=pressures.length ? Math.max(...pressures) : null;
  }
  if(supplied)return value;
  if (entries.size >= 32) entries.delete(entries.keys().next().value!);
  entries.set(context.task.id, { revision, value }); return structuredClone(value);
}
