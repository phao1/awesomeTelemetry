import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { TelemetrySpan } from '../../src/core/telemetry-types.js';
import type { TraceEvent, TraceSession, TokenUsage } from '../../src/core/trace-types.js';
import { computeMetrics } from '../../src/core/metrics.js';
import { cachedStmt } from './stmt-cache.js';
import { upsertEvents, upsertSessionFromTrace, upsertMetrics, deleteSession } from './writers.js';
import { limit, TelemetryError } from '../telemetry/mapping.js';
export const TELEMETRY_SPAN_COLS = 'id,group_id,trace_key,metadata_json,span_json';
export const TELEMETRY_SESSION_COLS = 'session_id,root_id,parent_id,source,origin,warnings_json';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const traceKey = (s: TelemetrySpan, origin: string) => digest([origin, s.source, s.traceId]);
export const telemetryEventId = (s: TelemetrySpan, origin: string) => digest([origin, s.source, s.traceId, s.spanId]);
const groupId = (s: TelemetrySpan, origin: string) => digest([origin, s.source, s.group ? ['session', s.group] : ['trace', s.traceId]]);
interface Stored { id: string; group_id: string; trace_key: string; span_json: string }
const tokens = (s: TelemetrySpan): TokenUsage | null => {
  if (s.usage.input === null || s.usage.output === null || s.usage.total === null) return null;
  return { input: s.usage.input ?? 0, output: s.usage.output ?? 0, cacheRead: s.usage.cacheRead ?? 0, cacheWrite: s.usage.cacheWrite ?? 0, reasoning: s.usage.reasoning ?? 0, netInput: s.usage.input ?? 0, total: s.usage.total };
};
const quotaLimit = (reason: string): never => { throw new TelemetryError(413, 'TELEMETRY_QUOTA', 'Telemetry quota full: ' + reason); };
const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, netInput: 0, total: 0 });
/** All callers serialize admission. Bounded normalized spans are the only read/rebuild input. */
export function storeTelemetry(db: Database, incoming: TelemetrySpan[], origin: 'collected' | 'imported', now = new Date().toISOString()): { taskIds: string[]; changed: string[] } {
  const traceKeys = [...new Set(incoming.map(s => traceKey(s, origin)))];
  const retained = cachedStmt(db, `SELECT ${TELEMETRY_SPAN_COLS} FROM telemetry_spans WHERE trace_key IN (SELECT value FROM json_each(?)) LIMIT 2001`).all(JSON.stringify(traceKeys)) as Stored[];
  if(retained.length>2000 || retained.reduce((n,r)=>n+Buffer.byteLength(r.span_json),0)>2*1024*1024)limit();
  const retainedById=new Map(retained.map(r=>[r.id,r]));
  if(incoming.every(s=>retainedById.get(telemetryEventId(s,origin))?.span_json===JSON.stringify(s)))return {taskIds:[...new Set(incoming.map(s=>'collected:otel:'+retainedById.get(telemetryEventId(s,origin))!.group_id))],changed:[]};
  const spans = new Map(retained.map(r => [r.id, JSON.parse(r.span_json) as TelemetrySpan]));
  for (const span of incoming) spans.set(telemetryEventId(span, origin), span);
  // Conversation evidence only propagates when unique within a trace, including prior batches.
  const traceGroups = new Map<string, Set<string>>();
  for (const s of spans.values()) if (s.group) { const key = traceKey(s, origin), groups = traceGroups.get(key) ?? new Set(); groups.add(s.group); traceGroups.set(key, groups); }
  const resolvedGroup=(s:TelemetrySpan)=>{const groups=traceGroups.get(traceKey(s,origin));return groupId(!s.group&&groups?.size===1?{...s,group:[...groups][0]!}:s,origin);};
  const affected = [...new Set([...retained.map(r => r.group_id), ...[...spans.values()].map(resolvedGroup)])];
  const old = cachedStmt(db, `SELECT ${TELEMETRY_SPAN_COLS} FROM telemetry_spans WHERE group_id IN (SELECT value FROM json_each(?)) LIMIT 2001`).all(JSON.stringify(affected)) as Stored[];
  if(old.length>2000 || old.reduce((n,r)=>n+Buffer.byteLength(r.span_json),0)>2*1024*1024)limit();
  const oldGroups=new Map(old.map(r=>[r.id,r.group_id]));
  const all = new Map(old.map(r => [r.id, JSON.parse(r.span_json) as TelemetrySpan]));
  for (const [id, s] of spans) all.set(id, s);
  const updates = [...all].map(([id, s]) => ({ id, group: spans.has(id)?resolvedGroup(s):oldGroups.get(id)!, trace: traceKey(s, origin), json: JSON.stringify(s), span: s }));
  if(updates.length>2000 || updates.reduce((n,r)=>n+Buffer.byteLength(r.json),0)>2*1024*1024)limit();
  const previous = new Map(old.map(r => [r.id, r]));
  const dirty = updates.filter(r => previous.get(r.id)?.span_json !== r.json || previous.get(r.id)?.group_id !== r.group);
  const tasks = [...new Set(updates.map(r => r.group))];
  if (!dirty.length) return { taskIds: tasks.map(id => 'collected:otel:' + id), changed: [] };
  const counts = cachedStmt(db, 'SELECT span_count AS n,bytes FROM telemetry_quota WHERE id=1').get() as { n: number; bytes: number };
  if (counts.n + updates.filter(r => !previous.has(r.id)).length > 20000) quotaLimit('retained span limit is 20000');
  if (counts.bytes + dirty.reduce((n, r) => n + Buffer.byteLength(r.json) - Buffer.byteLength(previous.get(r.id)?.span_json ?? ''), 0) > 32 * 1024 * 1024) quotaLimit('normalized telemetry JSON byte limit is 33554432 (32 MiB)');
  const existingGroups = cachedStmt(db, 'SELECT COUNT(DISTINCT root_id) AS n FROM telemetry_sessions').get() as { n: number };
  if (existingGroups.n + tasks.filter(id => !old.some(r => r.group_id === id)).length - new Set(old.filter(r=>!tasks.includes(r.group_id)).map(r=>r.group_id)).size > 256) quotaLimit('retained task limit is 256');
  for (const id of tasks) if (updates.filter(r => r.group === id).length > 2000) quotaLimit('per-task span limit is 2000');
  const insert = cachedStmt(db, `INSERT INTO telemetry_spans(${TELEMETRY_SPAN_COLS}) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,trace_key=excluded.trace_key,metadata_json=excluded.metadata_json,span_json=excluded.span_json`);
  const memberStmt = cachedStmt(db, `INSERT INTO telemetry_sessions(${TELEMETRY_SESSION_COLS}) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET root_id=excluded.root_id,parent_id=excluded.parent_id,source=excluded.source,origin=excluded.origin,warnings_json=excluded.warnings_json`);
  const changed: string[] = [];
  db.transaction(() => {
    cachedStmt(db, 'UPDATE telemetry_quota SET span_count=span_count+?,bytes=bytes+? WHERE id=1').run(updates.filter(r=>!previous.has(r.id)).length,dirty.reduce((n,r)=>n+Buffer.byteLength(r.json)-Buffer.byteLength(previous.get(r.id)?.span_json??''),0));
    for (const row of dirty) { const metadata = { ...row.span }; delete (metadata as Partial<TelemetrySpan>).input; delete (metadata as Partial<TelemetrySpan>).output; insert.run(row.id, row.group, row.trace, JSON.stringify(metadata), row.json); }
    for (const group of affected) {
      const root = 'otel:' + group, entries = updates.filter(r => r.group === group);
      const oldMembers = cachedStmt(db, 'SELECT session_id FROM telemetry_sessions WHERE root_id=?').all(root) as { session_id: string }[];
      if (!entries.length) { for (const row of oldMembers) deleteSession(db, row.session_id); continue; }
      const byEventId = new Map(entries.map(e=>[e.id,e.span]));
      const byRef = new Map(entries.map(e => [JSON.stringify([e.span.traceId, e.span.spanId]), e]));
      const invalidAncestors=new Set<string>(),warnings=new Set<string>();
      for(const entry of entries){
        let current:typeof entry|undefined=entry;const visited=new Set<string>();
        for(let depth=0;current;depth++){
          if(visited.has(current.id)){invalidAncestors.add(entry.id);warnings.add('telemetry_parent_cycle');break;}
          if(depth>=64){invalidAncestors.add(entry.id);warnings.add('telemetry_parent_depth');break;}
          visited.add(current.id);
          if(!current.span.parentSpanId)break;
          current=byRef.get(JSON.stringify([current.span.traceId,current.span.parentSpanId]));
          if(!current)warnings.add('telemetry_parent_unresolved');
        }
      }
      const agents = entries.filter(e => !invalidAncestors.has(e.id) && (e.span.operation === 'invoke_agent' || e.span.operation === 'AGENT'));
      const agentIds = new Set(agents.map(a => a.id));
      const parentAgent = (entry: typeof entries[number], includeSelf: boolean) => {
        if(invalidAncestors.has(entry.id))return null;
        let current: typeof entry | undefined = entry; const seen = new Set<string>();
        for (let i = 0; current && i < 64; i++) {
          if (seen.has(current.id)) return null; seen.add(current.id);
          if ((includeSelf || current.id !== entry.id) && agentIds.has(current.id)) return current;
          current = current.span.parentSpanId ? byRef.get(JSON.stringify([current.span.traceId, current.span.parentSpanId])) : undefined;
        }
        return null;
      };
      const top = agents.filter(a => !parentAgent(a, false)).sort((a,b) => (a.span.start ?? '').localeCompare(b.span.start ?? '') || a.id.localeCompare(b.id));
      const mainAgent = top[0];
      const memberKey = (agent: typeof mainAgent | null) => !agent || agent.id === mainAgent?.id ? root : root + ':' + agent.id;
      const members = new Map<string, { agent: typeof mainAgent | null; events: TraceEvent[] }>([[root, { agent: mainAgent ?? null, events: [] }]]);
      for (const a of agents) members.set(memberKey(a), { agent: a, events: [] });
      if (members.size > 100) quotaLimit('per-task member limit is 100');
      for (const entry of [...entries].sort((a,b) => (a.span.start ?? '').localeCompare(b.span.start ?? '') || a.id.localeCompare(b.id))) {
        const s = entry.span, key = memberKey(parentAgent(entry, true)), member = members.get(key)!;
        member.events.push({ id: entry.id, sessionId: key, sequence: member.events.length + 1, turnKey: null,
          kind: s.kind, phase: s.status === 'error' ? 'debug' : 'understand', title: s.name, startedAt: s.start ? new Date(s.start).toISOString() : '', durationMs: s.durationMs ?? 0,
          status: s.status, actor: s.agentName ?? s.source, tool: s.toolName, tokens: tokens(s), error: s.error, hasInput: s.input !== null, hasOutput: s.output !== null, hasRaw: false,
          model: s.model, inputSummary: s.input, outputSummary: s.output });
      }
      for (const [key, member] of members) {
        const events = member.events, times = events.map(e => Date.parse(e.startedAt)).filter(Number.isFinite);
        const start = times.length ? Math.min(...times) : null;
        const end = times.length ? Math.max(...events.filter(e => Number.isFinite(Date.parse(e.startedAt))).map(e => Date.parse(e.startedAt) + e.durationMs)) : null;
        const usage = emptyTokens(); for (const e of events) if (e.kind === 'llm' && e.tokens) for (const k of Object.keys(usage) as (keyof TokenUsage)[]) usage[k] += e.tokens[k];
        const source = entries[0]!.span.source;
        const session: TraceSession = { id: key, provider: 'opentelemetry', sourceAgent: member.agent?.span.agentName ?? member.agent?.span.name ?? source,
          title: (member.agent?.span.name ?? entries[0]!.span.name).slice(0,200), startedAt: start === null ? '' : new Date(start).toISOString(), updatedAt: now,
          status: events.some(e => e.status === 'error') ? 'error' : events.length && events.every(e => e.status === 'success') ? 'success' : 'unknown', cwd: null, messageCount: events.filter(e => e.kind === 'llm').length,
          eventCount: events.length, tokenUsage: usage, costUsd: 0, costSource: 'unknown', systemPrompt: null, dataSource: 'scan', sourcePath: `telemetry:${source}:${group}`, totalDurationMs: start === null || end === null ? 0 : end - start,
          durationSource: events.length && events.every(e => byEventId.get(e.id)?.durationMs !== null) ? 'measured' : 'unknown', isSubagent: key !== root, primaryModel: events.find(e => e.model)?.model ?? null };
        upsertSessionFromTrace(db, session); cachedStmt(db, 'UPDATE sessions SET detail_loaded=1,source_agent=? WHERE id=?').run(session.sourceAgent,key);
        const parent=member.agent?parentAgent(member.agent,false):null;
        memberStmt.run(key, root, key===root||!parent?null:memberKey(parent), source, origin,JSON.stringify([...warnings]));
        upsertEvents(db, key, events); upsertMetrics(db, key, computeMetrics({ session, events, tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' }, turnKeySource: 'unavailable' })); changed.push(key);
      }
      for (const row of oldMembers) if (!members.has(row.session_id)) { deleteSession(db, row.session_id); changed.push(row.session_id); }
    }
  })();
  return { taskIds: tasks.map(id => 'collected:otel:' + id), changed };
}
/** Metadata-only exported spans for a selected telemetry session; explicit export action. */
export function telemetrySpans(db: Database, sessionKey: string): TelemetrySpan[] {
  const group = cachedStmt(db, 'SELECT root_id FROM telemetry_sessions WHERE session_id=?').get(sessionKey) as { root_id: string } | undefined;
  if (!group) throw new TelemetryError(404, 'SESSION_NOT_FOUND', 'Telemetry session unavailable');
  return (cachedStmt(db, 'SELECT metadata_json FROM telemetry_spans WHERE group_id=? ORDER BY id').all(group.root_id.slice(5)) as { metadata_json: string }[]).map(r => JSON.parse(r.metadata_json) as TelemetrySpan);
}

/** One metadata batch per opened page, never bodies or per-record queries. */
export function attachTelemetry<T extends {id:string}>(db:Database, events:T[]): void {
  const rows=cachedStmt(db,'SELECT id,metadata_json FROM telemetry_spans WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(events.map(e=>e.id))) as {id:string;metadata_json:string}[];
  const byId=new Map(rows.map(r=>[r.id,JSON.parse(r.metadata_json) as TelemetrySpan]));
  for(const event of events){const metadata=byId.get(event.id);if(metadata)Object.assign(event,{telemetry:metadata,hasRaw:false});}
}
