import type { Database } from 'better-sqlite3';
import type { TaskContext, TaskMetrics, TaskMetricKey } from '../../src/core/task-types.js';
import { correctedUsage } from '../../src/core/benchmark-analysis.js';
import { cachedStmt } from './stmt-cache.js';
type Session = { id: string; provider: string; started_at: string; total_duration_ms: number; duration_source: string; detail_loaded: number; token_input: number; token_output: number; token_cache_read: number; token_cache_write: number; cost_usd: number; cost_source: string; cost_currency: string; primary_model: string | null };
const cache = new WeakMap<Database, Map<string, { revision: string; value: TaskMetrics }>>();
const known = (n: number) => Number.isSafeInteger(n) && n > 0 ? n : null;
const sum = (values: Array<number | null>): number | null => values.length && values.every(v => v !== null) && Number.isSafeInteger(values.reduce<number>((n, v) => n + (v ?? 0), 0)) ? values.reduce<number>((n, v) => n + v!, 0) : null;
/** Session counters are normalized by adapters: input excludes cache, Codex output includes reasoning.
 * Legacy zero defaults cannot establish that a counter was reported. */
export function sessionUsage(row: Pick<Session, 'provider' | 'token_input' | 'token_output' | 'token_cache_read' | 'token_cache_write'>) {
  const input = known(row.token_input), output = known(row.token_output), cacheRead = known(row.token_cache_read);
  const convention = ['codex', 'claude', 'codeagent', 'workbuddy'].includes(row.provider);
  const cacheWriteReported = row.token_cache_write > 0 ? true : row.provider === 'codex' && row.token_cache_write === 0 ? false : null;
  return { input, output, cacheRead, total: convention ? correctedUsage({ input, output, cacheRead, cacheWrite: known(row.token_cache_write), reasoning: null, inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported }).total : null };
}
export function taskMetrics(db: Database, context: TaskContext): TaskMetrics {
  const revision = String(db.pragma('data_version', { simple: true })) + ':' + (cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number }).n;
  let entries = cache.get(db); if (!entries) { entries = new Map(); cache.set(db, entries); }
  const hit = entries.get(context.task.id); if (hit?.revision === revision) return structuredClone(hit.value);
  const value: TaskMetrics = { durationMs: null, toolCalls: null, errors: null, input: null, output: null, cacheRead: null, correctedTotal: null, costUsd: null, models: [] };
  if (context.importSession) {
    const s = context.importSession, start = Date.parse(s.startedAt ?? ''), end = Date.parse(s.endedAt ?? '');
    value.durationMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
    value.models = s.model ? [s.model] : [];
  } else {
    const keys = JSON.stringify(context.members.flatMap(m => m.sessionKey ? [m.sessionKey] : []));
    const rows = cachedStmt(db, `SELECT id,provider,started_at,total_duration_ms,duration_source,detail_loaded,token_input,token_output,token_cache_read,token_cache_write,cost_usd,cost_source,cost_currency,primary_model FROM sessions WHERE id IN (SELECT value FROM json_each(?))`).all(keys) as Session[];
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
      const counts = cachedStmt(db, `SELECT (SELECT COUNT(1) FROM events WHERE session_id IN (SELECT value FROM json_each(?)) AND kind='tool' AND input_len>0) AS tools, (SELECT COUNT(1) FROM events WHERE session_id IN (SELECT value FROM json_each(?)) AND status='error') AS errors`).get(keys, keys) as { tools: number; errors: number };
      value.toolCalls = counts.tools; value.errors = counts.errors;
      if (rows.every(r => r.cost_source === 'reported' && r.cost_currency === 'USD' && Number.isFinite(r.cost_usd) && r.cost_usd >= 0)) value.costUsd = rows.reduce((n, r) => n + r.cost_usd, 0);
      const starts = rows.map(r => Date.parse(r.started_at));
      if (starts.every(Number.isFinite) && rows.every(r => ['measured', 'derived'].includes(r.duration_source) && r.total_duration_ms >= 0)) value.durationMs = Math.max(...rows.map((r, i) => starts[i]! + r.total_duration_ms)) - Math.min(...starts);
    }
  }
  if (entries.size >= 32) entries.delete(entries.keys().next().value!);
  entries.set(context.task.id, { revision, value }); return structuredClone(value);
}
