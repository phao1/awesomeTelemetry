import type { Database } from 'better-sqlite3';
import type { TaskContext, TaskNativeRef, TaskRecord, TaskStructure, TaskTimeline } from '../../src/core/task-types.js';
import { cachedStmt } from './stmt-cache.js';

type Identity = { source_id: string; event_id: string | null; namespace: string; kind: TaskNativeRef['kind']; value: string; scope: string | null };
const tuple = (value: TaskNativeRef): string => JSON.stringify([value.namespace, value.kind, value.value, value.scope]);
const ref = (value: Identity): TaskNativeRef | null => value.scope && value.value ? { namespace: value.namespace, kind: value.kind, value: value.value, scope: value.scope } : null;
const key = (source: string, event: string): string => JSON.stringify([source, event]);
/** Match client clock semantics: inputs/bookkeeping/results are observations at a
 * timestamp, not a claim that they ran until the next log entry. Originals stay intact. */
export const TASK_LOG_DURATION_SQL = `CASE WHEN e.duration_ms>0 AND e.status<>'running'
  AND e.kind NOT IN ('user_prompt','system','agent','subagent_prompt') AND e.title<>'token_count'
  AND NOT (e.kind='reasoning' AND e.title='' AND e.output_len=0)
  AND NOT (e.kind IN ('tool','file_read','file_write','bash','test') AND e.output_len>0 AND e.input_len=0)
  THEN e.duration_ms ELSE 0 END`;
export const TASK_ROUND_SEED_SQL = `SELECT e.session_id,e.id,e.sequence,e.title,e.started_at
  FROM json_each(?) p CROSS JOIN events e INDEXED BY idx_events_session_seq
  WHERE e.session_id=json_extract(p.value,'$[0]') AND e.sequence=(
    SELECT MAX(prior.sequence) FROM events prior INDEXED BY idx_events_session_seq WHERE prior.session_id=json_extract(p.value,'$[0]')
    AND prior.kind='user_prompt' AND prior.sequence<json_extract(p.value,'$[1]'))`;
/** Materialize bounded requested tuples once, then scan each involved source
 * once. A tuple-first join repeats the source scan for every tool call. */
export const TASK_TOOL_REFS_SQL = `WITH wanted AS MATERIALIZED (
    SELECT json_extract(value,'$[0]') AS namespace,json_extract(value,'$[1]') AS value,
      json_extract(value,'$[2]') AS scope,json_extract(value,'$[3]') AS source FROM json_each(?))
  SELECT i.source_id,i.event_id,i.namespace,i.kind,i.value,i.scope,e.turn_key,
    CASE WHEN e.input_len>0 THEN 1 ELSE 0 END AS has_input
  FROM trace_identities i INDEXED BY idx_trace_identities_source CROSS JOIN wanted q
  LEFT JOIN events e ON e.session_id=substr(i.source_id,6) AND e.id=i.event_id
  WHERE i.source_id IN (SELECT source FROM wanted) AND i.kind='tool_call'
    AND i.namespace=q.namespace AND i.value=q.value AND i.scope=q.scope AND i.source_id=q.source LIMIT 2401`;

/** Retained metadata facts only. Round/step/attempt presentation is a client projection. */
export function taskStructure(db: Database, items: TaskRecord[]): TaskStructure {
  const native = items.filter(item => item.event && item.sessionKey);
  if (!native.length) return { records: [], leading: [], warnings: [] };
  const sessions = [...new Set(native.map(item => item.sessionKey!))];
  const sources = cachedStmt(db, 'SELECT id,complete FROM trace_identity_sources WHERE session_key IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(sessions)) as { id: string; complete: number }[];
  const complete = new Set(sources.filter(source => source.complete === 1).map(source => source.id));
  const identities = cachedStmt(db, `SELECT source_id,event_id,namespace,kind,value,scope FROM trace_identities INDEXED BY idx_trace_identities_source
    WHERE source_id IN (SELECT value FROM json_each(?)) AND event_id IN (SELECT value FROM json_each(?))
    AND kind IN ('turn','request','response','tool_call') LIMIT 2001`)
    .all(JSON.stringify(sessions.map(id => 'scan:' + id)), JSON.stringify(native.map(item => item.event!.id))) as Identity[];
  const overflow = identities.length > 2000, byEvent = new Map<string, Identity[]>();
  for (const identity of identities.slice(0, 2000)) if (identity.event_id) {
    const k = key(identity.source_id, identity.event_id), rows = byEvent.get(k) ?? [];
    rows.push(identity); byEvent.set(k, rows);
  }
  const unique = (identities: Identity[], kinds: string[]): TaskNativeRef | null => {
    const values = new Map(identities.filter(value => kinds.includes(value.kind)).flatMap(value => { const r = ref(value); return r ? [[tuple(r), r] as const] : []; }));
    return values.size === 1 ? [...values.values()][0]! : null;
  };
  const records: TaskStructure['records'] = native.map(item => {
    const source = 'scan:' + item.sessionKey, rows = byEvent.get(key(source, item.event!.id)) ?? [], trusted = !overflow && complete.has(source);
    const tool = trusted ? unique(rows, ['tool_call']) : null;
    return { recordId: item.id, round: trusted ? unique(rows, ['turn']) : null,
      attempt: trusted ? unique(rows, ['response']) ?? unique(rows, ['request']) : null,
      tool, pairing: !trusted ? 'incomplete' : tool ? 'exact' : rows.some(row => row.kind === 'tool_call') ? 'ambiguous' : 'unavailable', relatedRecordIds: [] };
  });
  // One batched same-identity lookup checks off-page conflicts as well.
  const queries = new Map<string, string[]>();
  records.forEach((value, i) => { if (value.tool) { const item = native[i]!; queries.set(key(item.sessionKey!, tuple(value.tool)), [value.tool.namespace, value.tool.value, value.tool.scope, 'scan:' + item.sessionKey]); } });
  const refs = cachedStmt(db, TASK_TOOL_REFS_SQL)
    .all(JSON.stringify([...queries.values()])) as (Identity & { turn_key: string | null; has_input: number })[];
  const related = new Map<string, typeof refs>();
  for (const row of refs.slice(0, 2400)) { const r = ref(row); if (!r) continue; const k = key(row.source_id.slice(5), tuple(r)), rows = related.get(k) ?? []; rows.push(row); related.set(k, rows); }
  records.forEach((value, i) => {
    if (!value.tool) return;
    const rows = related.get(key(native[i]!.sessionKey!, tuple(value.tool))) ?? [];
    const eventIds = new Set(rows.map(row => row.event_id)), turns = new Set(rows.flatMap(row => row.turn_key ? [row.turn_key] : []));
    const inputs = new Set(rows.filter(row => row.has_input).map(row => row.event_id));
    if (refs.length > 2400 || eventIds.size > 12) value.pairing = 'incomplete';
    else if (eventIds.has(null) || turns.size > 1 || inputs.size > 1) value.pairing = 'ambiguous';
    if (value.pairing !== 'exact') { value.tool = null; return; }
    value.relatedRecordIds = [...eventIds].map(id => native[i]!.sessionKey + ':event:' + id!);
  });
  const first = new Map<string, number>();
  for (const item of native) first.set(item.sessionKey!, Math.min(first.get(item.sessionKey!) ?? Infinity, item.event!.sequence));
  const leading = cachedStmt(db, TASK_ROUND_SEED_SQL)
    .all(JSON.stringify([...first])) as { session_id: string; id: string; sequence: number; title: string; started_at: string }[];
  const owner = new Map(native.map(item => [item.sessionKey, item.memberId]));
  return { records, leading: leading.map(row => ({ memberId: owner.get(row.session_id)!, recordId: row.session_id + ':event:' + row.id, sequence: row.sequence, title: row.title, startedAt: row.started_at })),
    warnings: [...(overflow || refs.length > 2400 ? ['structure_limit'] : []), ...(sessions.some(id => !complete.has('scan:' + id)) ? ['identity_incomplete'] : [])] };
}

/** Full fixed-window start density. No source parsing, raw data or event bodies. */
export function taskTimeline(db: Database, context: TaskContext, member: string, window: string, ceilings: [string, number][]): TaskTimeline {
  const bins = 160;
  const from = context.importSession ? `FROM trace_log_turns e WHERE e.import_id=?` : `FROM json_each(?) c CROSS JOIN events e ON e.session_id=json_extract(c.value,'$[0]') AND e.sequence<=json_extract(c.value,'$[1]') WHERE 1=1`;
  const source = context.importSession ? context.importSession.id : JSON.stringify(ceilings);
  const time = context.importSession ? "json_extract(e.metadata_json,'$.requestTime')" : 'e.started_at';
  const kind = context.importSession ? "'llm'" : "CASE WHEN (e.kind='llm' AND e.title='token_count' AND e.output_len=0) OR (e.kind='reasoning' AND e.title='' AND e.output_len=0) THEN 'system' ELSE e.kind END";
  const status = context.importSession ? "CASE WHEN json_extract(e.metadata_json,'$.isError')=1 THEN 'error' ELSE 'unknown' END" : 'e.status';
  const owner = context.importSession ? "'main'" : 'e.session_id';
  const endTime = context.importSession ? `MAX(julianday(${time}),COALESCE(julianday(json_extract(e.metadata_json,'$.responseTime')),julianday(${time})))` : `julianday(${time})+(${TASK_LOG_DURATION_SQL})/86400000.0`;
  const range = cachedStmt(db, `SELECT MIN(julianday(${time})) AS start,MAX(${endTime}) AS end,COUNT(1) AS n,COUNT(julianday(${time})) AS timed ${from}`)
    .get(source) as { start: number | null; end: number | null; n: number; timed: number };
  const result: TaskTimeline = { taskId: context.task.id, member, window, from: null, to: null, bins, total: range.n, untimed: range.n - range.timed, lanes: [], coverage: { loadedMembers: context.task.loadedMemberCount, totalMembers: context.task.memberCount } };
  if (range.start === null || range.end === null) return result;
  const start = Math.round((range.start - 2440587.5) * 86400000), end = Math.round((range.end - 2440587.5) * 86400000);
  result.from = new Date(start).toISOString(); result.to = new Date(Math.max(start + 1, end)).toISOString();
  const width = Math.max((range.end - range.start) / bins, 1 / 86400000);
  const rows = cachedStmt(db, `SELECT ${owner} AS owner,MIN(159,MAX(0,CAST((julianday(${time})-?)/? AS INTEGER))) AS bin,
    SUM(CASE WHEN ${kind}='user_prompt' THEN 1 ELSE 0 END) AS input,
    SUM(CASE WHEN ${kind} IN ('llm','reasoning','message') THEN 1 ELSE 0 END) AS model,
    SUM(CASE WHEN ${kind} IN ('tool','bash','file_read','file_write','test') THEN 1 ELSE 0 END) AS tool,
    SUM(CASE WHEN ${kind} NOT IN ('user_prompt','llm','reasoning','message','tool','bash','file_read','file_write','test') THEN 1 ELSE 0 END) AS other,
    SUM(CASE WHEN ${status}='error' THEN 1 ELSE 0 END) AS errors,COUNT(1) AS n
    ${from} AND julianday(${time}) IS NOT NULL GROUP BY owner,bin`)
    .all(range.start, width, source) as { owner: string; bin: number; input: number; model: number; tool: number; other: number; errors: number; n: number }[];
  const byKey = new Map(context.members.map(value => [value.sessionKey ?? 'main', value]));
  const lanes = new Map<string, TaskTimeline['lanes'][number]>();
  for (const row of rows) {
    const person = byKey.get(row.owner); if (!person) continue;
    const lane = lanes.get(row.owner) ?? { memberId: person.id, name: person.name, total: 0, bins: [] };
    lane.total += row.n; lane.bins.push({ index: row.bin, input: row.input, model: row.model, tool: row.tool, other: row.other, errors: row.errors }); lanes.set(row.owner, lane);
  }
  result.lanes = [...lanes.values()]; return result;
}
