import type { Database } from 'better-sqlite3';
import type { TaskContext, TaskListQuery, TaskMember, TaskPage, TaskRecordPage, TaskRecordQuery, TaskSummary, TaskTimeline } from '../../src/core/task-types.js';
import type { TraceEventSlim, TraceLogTurn } from '../../src/core/trace-types.js';
import { cachedStmt } from './stmt-cache.js';
import { importManifest } from './trace-import.js';
import { EVENT_SLIM_COLS } from './columns.js';
import { mapEvent } from './query-engine.js';
import { taskStructure, taskTimeline, TASK_LOG_DURATION_SQL } from './task-process.js';

type Row = Record<string, unknown>;
/** Only a unique explicit root may absorb member sessions. Ambiguity remains visible. */
export const TASK_BINDINGS_SQL = `WITH RECURSIVE agent_sessions AS (
 SELECT a.run_id,a.id AS agent_id,a.native_id,a.display_name,a.role_class,k.value AS session_id
 FROM team_agents a JOIN json_each(a.session_keys_json) k JOIN sessions s ON s.id=k.value AND s.data_source='scan'
), root_candidates AS (
 SELECT a.run_id,a.session_id FROM agent_sessions a JOIN team_runs r ON r.id=a.run_id
 WHERE a.native_id=r.native_run_id
 UNION
 SELECT a.run_id,a.session_id FROM agent_sessions a WHERE a.role_class='leader'
 AND NOT EXISTS(SELECT 1 FROM agent_sessions x JOIN team_runs r ON r.id=x.run_id WHERE x.run_id=a.run_id AND x.native_id=r.native_run_id)
), roots AS (
 SELECT run_id,MIN(session_id) AS root_id,COUNT(DISTINCT session_id) AS root_count FROM root_candidates GROUP BY run_id
), native_keys AS (
 SELECT s.id AS source_id,s.session_key,i.namespace,MIN(i.value) AS value,COUNT(DISTINCT i.value) AS native_count
 FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id
 JOIN sessions n ON n.id=s.session_key AND n.data_source='scan'
 WHERE s.complete=1 AND i.kind='session' AND i.scope IS NULL AND i.namespace LIKE 'agent:%'
 GROUP BY s.id,i.namespace
), native_owner_counts AS (
 SELECT namespace,value,COUNT(DISTINCT session_key) AS owners FROM native_keys WHERE native_count=1 GROUP BY namespace,value
), parent_candidates AS (
 SELECT c.session_key AS child,p.session_key AS parent
 FROM native_keys c JOIN trace_identities i ON i.source_id=c.source_id AND i.kind='parent_session' AND i.namespace=c.namespace AND i.scope=c.value
 JOIN native_keys p ON p.namespace=i.namespace AND p.value=i.value AND p.native_count=1
 JOIN native_owner_counts o ON o.namespace=p.namespace AND o.value=p.value AND o.owners=1
 WHERE c.native_count=1 AND c.session_key<>p.session_key
 AND (SELECT COUNT(DISTINCT json_array(ref.namespace,ref.value,ref.scope)) FROM trace_identities ref WHERE ref.source_id=c.source_id AND ref.kind='parent_session')=1
), declared_parents AS (
 SELECT child,MIN(parent) AS parent FROM parent_candidates GROUP BY child HAVING COUNT(DISTINCT parent)=1
), ancestor_walk(start,current,path,depth) AS (
 SELECT child,parent,json_array(child,parent),1 FROM declared_parents
 UNION ALL
 SELECT w.start,p.parent,json_insert(w.path,'$[#]',p.parent),w.depth+1
 FROM ancestor_walk w JOIN declared_parents p ON p.child=w.current
 WHERE w.depth<32 AND NOT EXISTS(SELECT 1 FROM json_each(w.path) visited WHERE visited.value=p.parent)
), native_roots AS (
 SELECT w.start AS child,w.current AS root_id FROM ancestor_walk w
 WHERE NOT EXISTS(SELECT 1 FROM declared_parents p WHERE p.child=w.current)
 AND NOT EXISTS(SELECT 1 FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id WHERE s.session_key=w.current AND i.kind='parent_session')
), membership AS (
 SELECT a.session_id,r.root_id,a.run_id FROM agent_sessions a JOIN roots r ON r.run_id=a.run_id AND r.root_count=1
 UNION
 SELECT child,root_id,NULL FROM native_roots
), bindings AS (
 SELECT s.id AS session_id,CASE WHEN COUNT(DISTINCT m.root_id)=1 THEN MIN(m.root_id) ELSE s.id END AS root_id,
 CASE WHEN COUNT(DISTINCT m.run_id)=1 THEN MIN(m.run_id) ELSE NULL END AS run_id,
 COUNT(DISTINCT m.root_id) AS root_count
 FROM sessions s LEFT JOIN membership m ON m.session_id=s.id WHERE s.data_source='scan' GROUP BY s.id
)`;
const SUMMARY_COLS = `b.root_id,s.title,s.provider,s.started_at,MAX(m.updated_at) AS updated_at,s.status,
 COUNT(DISTINCT b.session_id) AS member_count,SUM(m.event_count) AS event_count,SUM(m.detail_loaded) AS loaded_count,
 CASE WHEN COUNT(DISTINCT b.run_id)=1 THEN MIN(b.run_id) ELSE NULL END AS run_id,
 EXISTS(SELECT 1 FROM scan_state ss WHERE ss.session_id=s.id) AS provenance_known`;
const SUMMARY_FROM = `FROM bindings b JOIN sessions s ON s.id=b.root_id JOIN sessions m ON m.id=b.session_id`;
export class TaskReadError extends Error {
  readonly code: 'BAD_REQUEST' | 'SESSION_NOT_FOUND';
  constructor(code: 'BAD_REQUEST' | 'SESSION_NOT_FOUND', message: string) { super(message); this.code = code; }
}
const invalid = (message: string): never => { throw new TaskReadError('BAD_REQUEST', message); };
const missing = (): never => { throw new TaskReadError('SESSION_NOT_FOUND', 'Task or record is unavailable'); };
function summary(row: Row): TaskSummary {
  return { id: 'collected:' + row.root_id, origin: 'collected', provenanceKnown: row.provenance_known === 1,
    rootSessionKey: row.root_id as string, runId: row.run_id as string | null, title: row.title as string,
    provider: row.provider as string, startedAt: row.started_at as string, updatedAt: row.updated_at as string,
    recordedStatus: row.status as string, memberCount: Number(row.member_count), eventCount: Number(row.event_count), loadedMemberCount: Number(row.loaded_count) };
}
function importedTask(session: NonNullable<ReturnType<typeof importManifest>>['session']): TaskSummary {
  return { id: 'imported:' + session.id, origin: 'imported', provenanceKnown: true, rootSessionKey: null, runId: null,
    title: session.title ?? session.fileName, provider: session.ideType ?? 'TraceLog', startedAt: session.startedAt,
    updatedAt: session.importedAt, recordedStatus: 'historical', memberCount: 1, eventCount: session.turnCount, loadedMemberCount: 1 };
}
function integer(value: number | undefined, fallback: number, max: number): number {
  const n = value ?? fallback; if (!Number.isSafeInteger(n) || n < 0 || n > max) invalid('Invalid task pagination'); return n;
}
export function listTasks(db: Database, query: TaskListQuery): TaskPage {
  const offset = integer(query.offset, 0, 100000), limit = integer(query.limit, 50, 100);
  if (limit < 1 || (query.q?.length ?? 0) > 200) invalid('Invalid task list filter');
  const text = (query.q ?? '').toLocaleLowerCase();
  if (query.origin === 'imported') {
    const where = `WHERE (?='' OR lower(COALESCE(json_extract(metadata_json,'$.title'),'') || ' ' || json_extract(metadata_json,'$.fileName') || ' ' || id) LIKE ? ESCAPE '\\')`;
    const needle = '%' + text.replace(/[\\%_]/g, '\\$&') + '%';
    const count = cachedStmt(db, `SELECT COUNT(1) AS n FROM trace_log_imports ${where}`).get(text, needle) as { n: number };
    const rows = cachedStmt(db, `SELECT id FROM trace_log_imports ${where} ORDER BY imported_at DESC,id LIMIT ? OFFSET ?`).all(text, needle, limit + 1, offset) as { id: string }[];
    // Metadata is read in one batch; never query each imported task separately.
    const ids = rows.slice(0, limit).map(row => row.id);
    const manifests = cachedStmt(db, 'SELECT id,metadata_json FROM trace_log_imports WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { id: string; metadata_json: string }[];
    const byId = new Map(manifests.map(row => [row.id, importedTask(JSON.parse(row.metadata_json))]));
    return { items: ids.map(id => byId.get(id)!), total: count.n, offset, limit, hasMore: rows.length > limit };
  }
  const since = query.range === undefined || query.range === 'all' ? '' : new Date(Date.now() - (query.range === 'today' ? 1 : query.range === '7d' ? 7 : 30) * 86400000).toISOString();
  const needle = '%' + text.replace(/[\\%_]/g, '\\$&') + '%';
  const where = `WHERE (?='' OR lower(s.title || ' ' || s.id) LIKE ? ESCAPE '\\') AND (?='' OR s.provider=?)`;
  const aggregate = `SELECT ${SUMMARY_COLS} ${SUMMARY_FROM} ${where} GROUP BY b.root_id HAVING MAX(m.updated_at)>=?`;
  const params = [text, needle, query.provider ?? '', query.provider ?? '', since];
  const count = cachedStmt(db, `${TASK_BINDINGS_SQL} SELECT COUNT(1) AS n FROM (${aggregate})`).get(...params) as { n: number };
  const rows = cachedStmt(db, `${TASK_BINDINGS_SQL} ${aggregate} ORDER BY updated_at DESC,b.root_id LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as Row[];
  return { items: rows.slice(0, limit).map(summary), total: count.n, offset, limit, hasMore: rows.length > limit };
}
export function getTask(db: Database, id: string): TaskContext {
  if (id.length > 1024) invalid('Task identity too long');
  if (id.startsWith('imported:')) {
    const entry = importManifest(db, id.slice(9)); if (entry === null) return missing();
    return { task: importedTask(entry.session), members: [{ id: 'main', name: entry.session.ideType ?? 'TraceLog', role: 'main', sessionKey: null, parentId: null, detailLoaded: true, eventCount: entry.session.turnCount }], importSession: entry.session, warnings: [] };
  }
  let key = id.startsWith('collected:') ? id.slice(10) : '';
  if (id.startsWith('run:')) {
    const roots = cachedStmt(db, `${TASK_BINDINGS_SQL} SELECT root_id FROM roots WHERE run_id=? AND root_count=1`).all(id.slice(4)) as { root_id: string }[];
    if (roots.length !== 1) invalid('Run has no unique main session'); key = roots[0]!.root_id;
  }
  if (key === '') invalid('Unknown task namespace');
  const binding = cachedStmt(db, `${TASK_BINDINGS_SQL} SELECT b.root_id,b.root_count,CASE WHEN b.root_id=b.session_id AND EXISTS(SELECT 1 FROM trace_identity_sources ns JOIN trace_identities ni ON ni.source_id=ns.id WHERE ns.session_key=b.session_id AND ni.kind='parent_session') THEN 1 ELSE 0 END AS unresolved_parent FROM bindings b WHERE b.session_id=?`).get(key) as { root_id: string; root_count: number; unresolved_parent: number } | undefined;
  if (binding === undefined) return missing();
  const row = cachedStmt(db, `${TASK_BINDINGS_SQL} SELECT ${SUMMARY_COLS} ${SUMMARY_FROM} WHERE b.root_id=? GROUP BY b.root_id`).get(binding.root_id) as Row;
  const task = summary(row);
  const rows = cachedStmt(db, `${TASK_BINDINGS_SQL} SELECT s.id,s.source_agent,s.detail_loaded,s.event_count,(SELECT p.parent FROM declared_parents p WHERE p.child=s.id) AS parent_id FROM bindings b JOIN sessions s ON s.id=b.session_id WHERE b.root_id=? ORDER BY s.id LIMIT 101`).all(binding.root_id) as Row[];
  const agents = task.runId === null ? [] : cachedStmt(db, `SELECT a.id,a.display_name,a.role_class,a.session_keys_json,
    (SELECT e.from_agent_id FROM team_agent_edges e WHERE e.to_agent_id=a.id AND e.valid_to IS NULL ORDER BY e.id LIMIT 1) AS parent_id
    FROM team_agents a WHERE a.run_id=? ORDER BY a.id LIMIT 101`).all(task.runId) as Row[];
  const byKey = new Map<string, Row>();
  for (const agent of agents) for (const sessionKey of JSON.parse(agent.session_keys_json as string) as string[]) if (!byKey.has(sessionKey)) byKey.set(sessionKey, agent);
  const members: TaskMember[] = rows.slice(0, 100).map(item => {
    const agent = byKey.get(item.id as string);
    return { id: agent?.id as string ?? item.id as string, name: agent?.display_name as string || item.source_agent as string,
      role: item.id === task.rootSessionKey ? 'main' : agent?.role_class as string ?? (item.parent_id ? 'subagent' : 'unknown'), sessionKey: item.id as string,
      parentId: agent?.parent_id as string | null ?? (item.parent_id ? byKey.get(item.parent_id as string)?.id as string ?? item.parent_id as string : null), detailLoaded: item.detail_loaded === 1, eventCount: Number(item.event_count) };
  });
  const represented = new Set(members.map(member => member.id));
  for (const agent of agents) if (!represented.has(agent.id as string) && members.length < 100) members.push({ id: agent.id as string, name: agent.display_name as string, role: agent.role_class as string, sessionKey: null, parentId: agent.parent_id as string | null, detailLoaded: false, eventCount: 0 });
  const warnings = [!task.provenanceKnown ? 'origin_unconfirmed' : '', rows.length > 100 || agents.length > 100 ? 'member_limit' : '', binding.root_count > 1 ? 'relationship_conflict' : '', binding.unresolved_parent ? 'relationship_unresolved' : ''].filter(Boolean);
  return { task: { ...task, memberCount: Math.max(task.memberCount, members.length) }, members, importSession: null, warnings };
}
interface WindowCut { task: string; member: string; q: string; status: string; from: string; to: string; ceilings: [string, number][] }
export function validateTaskRange(query: Pick<TaskRecordQuery, 'from' | 'to'>): { from: string; to: string } {
  if (query.from===undefined && query.to===undefined) return { from: '', to: '' };
  if (!query.from || !query.to || !query.from.endsWith('Z') || !query.to.endsWith('Z') || !Number.isFinite(Date.parse(query.from)) || !Number.isFinite(Date.parse(query.to)) || Date.parse(query.from)>Date.parse(query.to)) invalid('Invalid UTC task time range');
  return { from: new Date(query.from!).toISOString(), to: new Date(query.to!).toISOString() };
}
export function getTaskTimeline(db: Database, context: TaskContext, member: string, window: string): TaskTimeline {
  const members = recordMembers(context, member), keys = members.flatMap(item => item.sessionKey ? [item.sessionKey] : []);
  if (!window || window.length>32768) return invalid('Invalid timeline window');
  let cut: WindowCut | unknown[];
  try { cut=JSON.parse(Buffer.from(window,'base64url').toString()) as WindowCut | unknown[]; } catch { return invalid('Invalid timeline window'); }
  if (context.importSession) {
    if (!Array.isArray(cut) || cut[0]!==context.task.id || cut[1]!==member) return invalid('Timeline window scope mismatch');
    return taskTimeline(db,context,member,window,[]);
  }
  if (!cut || Array.isArray(cut) || cut.task!==context.task.id || cut.member!==member || !Array.isArray(cut.ceilings) || cut.ceilings.length>100 || new Set(cut.ceilings.map(value=>Array.isArray(value)?value[0]:null)).size!==cut.ceilings.length || cut.ceilings.some(value=>!Array.isArray(value)||value.length!==2||!keys.includes(value[0])||!Number.isSafeInteger(value[1])||value[1]<0)) return invalid('Timeline window scope mismatch');
  return taskTimeline(db,context,member,window,cut.ceilings);
}
export function recordMembers(context: TaskContext, member = 'main'): TaskMember[] {
  if (member === 'all') return context.members;
  const match = context.members.find(item => member === 'main' ? item.role === 'main' : item.id === member);
  if (!match) return invalid('Member does not belong to this task'); return [match];
}
export function taskRecords(db: Database, context: TaskContext, query: TaskRecordQuery): TaskRecordPage {
  const limit = integer(query.limit, 200, 200); if (limit < 1 || (query.q?.length ?? 0) > 200) invalid('Invalid record filters');
  const selected = recordMembers(context, query.member), member = query.member ?? 'main';
  const time = validateTaskRange(query);
  if (context.importSession !== null) {
    const window = Buffer.from(JSON.stringify([context.task.id, member, query.q ?? '', query.status ?? '', time.from, time.to])).toString('base64url');
    if (query.window && query.window !== window) invalid('Record window scope mismatch');
    const needle = '%' + (query.q ?? '').toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
    const from = `FROM trace_log_turns WHERE import_id=? AND (?<>1 OR json_extract(metadata_json,'$.isError')=1)
      AND (?='' OR lower(COALESCE(json_extract(metadata_json,'$.turnId'),'') || ' ' || COALESCE(json_extract(metadata_json,'$.model'),'') || ' ' || sequence) LIKE ? ESCAPE '\\')
      ${time.from ? "AND ROUND((julianday(json_extract(metadata_json,'$.requestTime'))-2440587.5)*86400000)<=? AND ROUND((MAX(julianday(json_extract(metadata_json,'$.requestTime')),COALESCE(julianday(json_extract(metadata_json,'$.responseTime')),julianday(json_extract(metadata_json,'$.requestTime'))))-2440587.5)*86400000)>=?" : ''}`;
    const params = [context.importSession.id, query.status === 'error' ? 1 : 0, query.q ?? '', needle, ...(time.from ? [Date.parse(time.to),Date.parse(time.from)] : [])];
    const total = (cachedStmt(db, `SELECT COUNT(1) AS n ${from}`).get(...params) as { n: number }).n;
    let offset = integer(query.offset, Math.max(0, total - limit), 100000);
    if (query.anchor) {
      if (!/^import:\d+$/.test(query.anchor)) return missing();
      const sequence = Number(query.anchor.slice(7));
      if (!Number.isSafeInteger(sequence) || !cachedStmt(db, `SELECT sequence ${from} AND sequence=?`).get(...params, sequence)) return missing();
      const before = (cachedStmt(db, `SELECT COUNT(1) AS n ${from} AND sequence<?`).get(...params, sequence) as { n: number }).n;
      offset = Math.max(0, before - 40);
    }
    const rows = cachedStmt(db, `SELECT metadata_json ${from} ORDER BY sequence LIMIT ? OFFSET ?`).all(...params, limit, offset) as { metadata_json: string }[];
    return { context, items: rows.map(row => { const turn = JSON.parse(row.metadata_json) as TraceLogTurn; return { id: `import:${turn.sequence}`, memberId: 'main', memberName: context.importSession!.ideType ?? 'TraceLog', sessionKey: null, event: null, importedTurn: turn }; }), total, offset, limit, hasMore: offset + limit < total, hasPrevious: offset > 0, window, warnings: [] };
  }
  const keys = selected.flatMap(item => item.sessionKey === null ? [] : [item.sessionKey]);
  const shape = { task: context.task.id, member, q: query.q ?? '', status: query.status ?? '', ...time };
  let cut: WindowCut;
  if (query.window) {
    if (query.window.length > 32768) invalid('Record window too large');
    try { cut = JSON.parse(Buffer.from(query.window, 'base64url').toString()) as WindowCut; } catch { return invalid('Invalid record window'); }
    if (cut === null || Object.entries(shape).some(([key, value]) => (cut[key as keyof typeof shape] ?? '') !== value)
      || !Array.isArray(cut.ceilings) || cut.ceilings.length > 100 || new Set(cut.ceilings.map(entry => Array.isArray(entry) ? entry[0] : null)).size !== cut.ceilings.length || cut.ceilings.some(entry => !Array.isArray(entry) || entry.length !== 2 || !keys.includes(entry[0]) || !Number.isSafeInteger(entry[1]) || entry[1] < 0)) invalid('Record window scope mismatch');
  } else {
    const rows = cachedStmt(db, 'SELECT session_id,MAX(sequence) AS n FROM events WHERE session_id IN (SELECT value FROM json_each(?)) GROUP BY session_id').all(JSON.stringify(keys)) as { session_id: string; n: number }[];
    cut = { ...shape, ceilings: rows.map(row => [row.session_id, row.n]) };
  }
  const needle = '%' + shape.q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
  // Omit inactive filters so COUNT can stay on the covering session/sequence index.
  const from = `FROM json_each(?) c CROSS JOIN events e ON e.session_id=json_extract(c.value,'$[0]') AND e.sequence<=json_extract(c.value,'$[1]')
    WHERE 1=1 ${shape.q ? "AND lower(e.title || ' ' || COALESCE(e.tool,'') || ' ' || e.actor) LIKE ? ESCAPE '\\'" : ''} ${shape.status ? 'AND e.status=?' : ''}
    ${time.from ? `AND ROUND((julianday(e.started_at)-2440587.5)*86400000)<=? AND ROUND((julianday(e.started_at)-2440587.5)*86400000)+(${TASK_LOG_DURATION_SQL})>=?` : ''}`;
  const params = [JSON.stringify(cut.ceilings), ...(shape.q ? [needle] : []), ...(shape.status ? [shape.status] : []), ...(time.from ? [Date.parse(time.to),Date.parse(time.from)] : [])];
  const total = (cachedStmt(db, `SELECT COUNT(1) AS n ${from}`).get(...params) as { n: number }).n;
  let offset = integer(query.offset, Math.max(0, total - limit), 100000);
  if (query.anchor) {
    const ref = query.anchor; const target = cachedStmt(db, `SELECT e.started_at,e.session_id,e.sequence ${from} AND e.session_id || ':event:' || e.id=?`).get(...params, ref) as { started_at: string; session_id: string; sequence: number } | undefined;
    if (!target) return missing();
    const before = (cachedStmt(db, `SELECT COUNT(1) AS n ${from} AND (e.started_at,e.session_id,e.sequence)<(?,?,?)`).get(...params, target.started_at, target.session_id, target.sequence) as { n: number }).n;
    offset = Math.max(0, before - 40);
  }
  const cols = EVENT_SLIM_COLS.split(', ').map(col => col.startsWith('CASE') ? col : 'e.' + col).join(', ');
  // Limit identity rows before evaluating body-availability flags on the selected page.
  const rows = cachedStmt(db, `WITH page AS MATERIALIZED (
    SELECT e.session_id,e.id,e.started_at,e.sequence ${from} ORDER BY e.started_at,e.session_id,e.sequence LIMIT ? OFFSET ?
  ) SELECT ${cols} FROM page p JOIN events e ON e.session_id=p.session_id AND e.id=p.id
    ORDER BY p.started_at,p.session_id,p.sequence`).all(...params, limit, offset) as Row[];
  const byKey = new Map(selected.map(item => [item.sessionKey, item]));
  const items = rows.map(row => { const event = mapEvent(row, false) as TraceEventSlim, owner = byKey.get(event.sessionId)!;
    return { id: event.sessionId + ':event:' + event.id, memberId: owner.id, memberName: owner.name, sessionKey: event.sessionId, event, importedTurn: null }; });
  return { context, items, ...(query.structure ? { structure: taskStructure(db,items) } : {}),
    total, offset, limit, hasMore: offset + limit < total, hasPrevious: offset > 0,
    window: Buffer.from(JSON.stringify(cut)).toString('base64url'), warnings: context.warnings };
}
