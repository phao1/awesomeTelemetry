import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import Sqlite, { type Database } from 'better-sqlite3';
import type { BenchmarkUsage } from '../../src/core/benchmark-types.js';
import type { CaptureTransportResult, DurationSource, ProviderKey, TraceEventSlim, TraceLogTurn } from '../../src/core/trace-types.js';
import type { TaskRecord } from '../../src/core/task-types.js';
import type { HealthInput, HealthRecord, HealthReport, HealthScope, HealthThresholds } from '../../src/core/task-health/types.js';
import { analyzeTaskHealth, renderFinding, HEALTH_CALC_VERSION, HEALTH_RULE_VERSION } from '../../src/core/task-health/report.js';
import { buildSnapshot, located } from '../../src/core/task-health/snapshot.js';
import { computeMetrics, evidenceId } from '../../src/core/task-health/metrics.js';
import { partition, intersect, unionDuration } from '../../src/core/task-health/intervals.js';
import { validateHealthThresholds } from '../../src/core/task-health/thresholds.js';
import { coverageRules } from '../../src/core/task-health/rules/coverage.js';
import { perceivedRules } from '../../src/core/task-health/rules/perceived.js';
import { planRules } from '../../src/core/task-health/rules/plan.js';
import { actRules } from '../../src/core/task-health/rules/act.js';
import { modelRules } from '../../src/core/task-health/rules/model.js';
import { startupRules } from '../../src/core/task-health/rules/startup.js';
import { qualityRules } from '../../src/core/task-health/rules/quality.js';
import { redactHealthText } from '../../src/core/task-health/render.js';
import { timestampSemantics } from '../../src/core/task-health/semantics.js';
import { getTask, recordMembers, validateTaskRange } from '../storage/task-workbench.js';
import { taskStructure } from '../storage/task-process.js';
import { mapEvent } from '../storage/query-engine.js';
import { HEALTH_EVENT_SLIM_COLS } from '../storage/columns.js';
import { cachedStmt } from '../storage/stmt-cache.js';

export class HealthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 503) { super(code); this.code = code; this.status = status; }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const date = (v: unknown): string | null => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const blankNative = (): HealthRecord['native'] => ({ modelCall: null, toolStartedAt: null, toolCompletedAt: null, modelStartedAt: null, modelCompletedAt: null, firstContentAt: null, command: null, targets: [], cwd: null, delegateMemberId: null, requestsUserInput: null, environmentReset: null, reasoning: 'unknown', usage: null });
interface SessionRow { id: string; provider: ProviderKey; duration_source: DurationSource; cwd: string | null; source_path: string; detail_loaded: number }
async function fingerprints(rows: SessionRow[]) {
  return Promise.all(rows.map(async row => [row.id, ...await Promise.all([row.source_path, row.source_path + '-wal'].map(async path => {
    try { const value = await stat(path); return [value.size, value.mtimeMs, value.ctimeMs]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new HealthError('HEALTH_SOURCE_UNAVAILABLE'); }
  }))]));
}
const counter = (db: Database) => (cachedStmt(db, 'SELECT total_changes() AS n').get() as { n: number }).n;
/** All metadata, membership, ceilings, import identity and capture links bind the revision.
 * Same-connection writes invalidate a job; unrelated writes through another
 * connection do not invalidate stable task revisions. */
export async function healthRevision(db: Database, taskId: string): Promise<string> {
  const context = getTask(db, taskId), keys = context.members.flatMap(m => m.sessionKey ? [m.sessionKey] : []);
  const rows = cachedStmt(db, 'SELECT id,provider,duration_source,cwd,source_path,detail_loaded FROM sessions WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify(keys)) as SessionRow[];
  const ceilings = cachedStmt(db, 'SELECT session_id,MAX(sequence) AS n FROM events WHERE session_id IN (SELECT value FROM json_each(?)) GROUP BY session_id').all(JSON.stringify(keys));
  const sources = cachedStmt(db, 'SELECT id,content_sha256,updated_at,complete FROM trace_identity_sources WHERE session_key IN (SELECT value FROM json_each(?)) OR proxy_id IN (SELECT proxy_id FROM trace_associations WHERE session_key IN (SELECT value FROM json_each(?))) ORDER BY id').all(JSON.stringify(keys), JSON.stringify(keys));
  const links = cachedStmt(db, 'SELECT a.id,a.state,a.updated_at,p.started_at,t.result_json FROM trace_associations a JOIN proxy_requests p ON p.id=a.proxy_id LEFT JOIN proxy_capture_transport t ON t.proxy_id=p.id WHERE a.session_key IN (SELECT value FROM json_each(?)) ORDER BY a.id').all(JSON.stringify(keys));
  const imported = context.importSession ? cachedStmt(db, 'SELECT COUNT(1) AS n,MAX(sequence) AS ceiling,MIN(body_sha256) AS first,MAX(body_sha256) AS last FROM trace_log_turns WHERE import_id=?').all(context.importSession.id) : [];
  return hash([context, rows, ceilings, sources, links, imported, await fingerprints(rows)]);
}

/** Bounded streaming enrichment. Retains identities/arguments/usage, never prose. */
async function enrich(row: SessionRow, records: HealthRecord[], budget: { bytes: number }, reasons: string[], limits: string[], signal?: AbortSignal, delegates = new Map<string, string>()) {
  if (!['codex', 'claude', 'codeagent'].includes(row.provider) || !records.length) return;
  const byEvent = new Map(records.map(r => [r.event!.id, r]));
  const byTool = new Map<string, HealthRecord[]>();
  for (const r of records) if (r.tool) { const group = byTool.get(r.tool.value) ?? []; group.push(r); byTool.set(r.tool.value, group); }
  const remaining = 32 * 1024 * 1024 - budget.bytes;
  if (remaining <= 0) { limits.push('native_bytes'); return; }
  const stream = createReadStream(row.source_path, { signal, highWaterMark: 65536, end: remaining - 1 });
  stream.on('data', chunk => { budget.bytes += Buffer.byteLength(chunk); if (budget.bytes >= 32 * 1024 * 1024) limits.push('native_bytes'); });
  const lines = createInterface({ input: stream, crlfDelay: Infinity }); let n = 0;
  const byRound = new Map<string, HealthRecord[]>();
  for (const r of records) if (r.event?.turnKey) { const list = byRound.get(r.event.turnKey) ?? []; list.push(r); byRound.set(r.event.turnKey, list); }
  let cycle: string | null = null, previous: string | null = null, rowIndex = 0;
  const increments: Record<string, unknown>[] = [], spawns = new Set<string>();
  const resultTypes = new Set(['function_call_output', 'custom_tool_call_output', 'tool_search_output']);
  const flushUsage = () => {
    if (row.provider !== 'codex' || cycle === null || !increments.length) { increments.length = 0; return; }
    const group = byRound.get(row.id + ':' + cycle) ?? [];
    const r = group.find(r => r.event?.tokens && ['llm','message'].includes(r.event.kind)) ?? group.find(r => r.event?.tokens);
    if (r) {
      const total = (key: string) => increments.every(u => count(u[key]) !== null) ? (() => { const n = increments.reduce((n,u) => n + count(u[key])!, 0); return Number.isSafeInteger(n) ? n : null; })() : null;
      r.native.usage = { input: total('input_tokens'), output: total('output_tokens'), reasoning: total('reasoning_output_tokens'), cacheRead: total('cached_input_tokens'), cacheWrite: total('cache_write_input_tokens'), inputIncludesCache: true, outputIncludesReasoning: true, cacheWriteReported: increments.every(u => Object.hasOwn(u,'cache_write_input_tokens')) ? true : null };
      r.native.reasoning = r.native.usage.reasoning === 0 ? 'zero' : (r.native.usage.reasoning ?? 0) > 0 ? 'present' : 'unknown';
    }
    increments.length = 0;
  };
  const args = (r: HealthRecord, value: unknown) => {
    let a = obj(value); if (typeof value === 'string') { try { a = obj(JSON.parse(value)); } catch { return; } }
    r.native.command = typeof a.command === 'string' ? a.command.slice(0, 2000) : typeof a.cmd === 'string' ? a.cmd.slice(0, 2000) : null;
    r.native.cwd = typeof a.cwd === 'string' ? a.cwd.slice(0, 1024) : typeof a.workdir === 'string' ? a.workdir.slice(0, 1024) : row.cwd;
    r.native.targets = ['file_path', 'path', 'file', 'url'].flatMap(key => typeof a[key] === 'string' ? [(a[key] as string).slice(0, 1024)] : []);
  };
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      if (++n % 100 === 0) await yieldLoop();
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) { reasons.push('native_line_limit'); break; }
      if (!line.trim()) continue;
      let value: Record<string, unknown>; try { value = obj(JSON.parse(line)); } catch { if (!limits.includes('native_bytes')) reasons.push('native_metadata_invalid'); break; }
      const payload = obj(value.payload), message = obj(value.message), at = date(value.timestamp);
      if (row.provider === 'codex') {
        // Copy the adapter's source-based cycle boundary, then join the opaque
        // persisted turnKey verbatim; never recover identity by parsing IDs.
        if (value.type === 'response_item') {
          const type = typeof payload.type === 'string' ? payload.type : '';
          if (cycle === null || previous !== null && resultTypes.has(previous) && !resultTypes.has(type)) {
            flushUsage(); cycle = typeof payload.id === 'string' && payload.id ? payload.id : typeof payload.call_id === 'string' && payload.call_id ? payload.call_id : `codex-${rowIndex}`;
          }
          previous = type;
          if (typeof payload.call_id === 'string') {
            const group = byTool.get(payload.call_id) ?? [];
            if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
              if (typeof payload.name === 'string' && /(?:^|__)spawn_agent$/.test(payload.name)) spawns.add(payload.call_id);
              for (const r of group.filter(r => r.event?.hasInput)) {
                args(r, payload.arguments ?? payload.input); r.native.toolStartedAt = at;
                if (payload.name === 'request_user_input') r.native.requestsUserInput = true;
              }
            }
            if (resultTypes.has(type) && spawns.has(payload.call_id)) {
              let output = obj(payload.output); if (typeof payload.output === 'string') { try { output = obj(JSON.parse(payload.output)); } catch { /* prose is not a delegation identity */ } }
              const target = typeof output.agent_id === 'string' ? delegates.get(output.agent_id) : undefined;
              if (target) for (const r of group) if (r.pairing === 'exact') r.native.delegateMemberId = target;
            }
          }
        }
        if (payload.type === 'token_count' && obj(payload.info).last_token_usage !== undefined) increments.push(obj(obj(payload.info).last_token_usage));
      }
      rowIndex++;
      if (row.provider !== 'codex') {
        const parts = Array.isArray(message.content) ? message.content.map(obj) : [];
        for (const [i, part] of parts.entries()) {
          if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
            for (const r of byTool.get(part.tool_use_id) ?? []) if (r.pairing === 'exact') r.native.toolCompletedAt = at;
          }
          if (value.type !== 'assistant' || typeof message.id !== 'string') continue;
          const r = byEvent.get(typeof part.id === 'string' ? part.id : `${message.id}-${i + 1}`); if (!r) continue;
          if (part.type === 'tool_use') { args(r, part.input); r.native.toolStartedAt = at; }
          r.native.modelCall = { namespace: 'protocol:anthropic', kind: 'response', value: message.id, scope: typeof value.sessionId === 'string' ? value.sessionId : r.tool?.scope ?? row.id };
          const u = obj(message.usage);
          const usage: BenchmarkUsage = { input: count(u.input_tokens), output: count(u.output_tokens), reasoning: count(obj(u.output_tokens_details).thinking_tokens), cacheRead: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens), inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported: Object.hasOwn(u, 'cache_creation_input_tokens') ? true : null };
          r.native.usage = usage; r.native.reasoning = usage.reasoning === 0 ? 'zero' : (usage.reasoning ?? 0) > 0 ? 'present' : 'unknown';
        }
      }
    }
    // A capped native prefix cannot certify its final cycle's usage.
    if (!limits.includes('native_bytes') && !reasons.includes('native_line_limit') && !reasons.includes('native_metadata_invalid')) flushUsage();
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof HealthError && error.code === 'NATIVE_BYTES_LIMIT') limits.push('native_bytes');
    else if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EACCES') reasons.push('native_metadata_unavailable');
    else throw new HealthError('HEALTH_SOURCE_UNAVAILABLE');
  } finally { lines.close(); stream.destroy(); }
}

/** Same accepted-link, scoped unique request/response/message rules as getLinkedExecution;
 * implemented as a batch because getLinkedExecution's event projection reads summaries. */
async function captureTimings(db: Database, input: HealthInput, signal?: AbortSignal) {
  const keys = input.members.flatMap(m => m.sessionKey ? [m.sessionKey] : []);
  const rows = cachedStmt(db, `SELECT a.session_key,p.id,p.started_at,p.output_tokens,t.result_json,
    i.event_id,i.namespace,i.kind,i.value,i.scope FROM trace_associations a
    JOIN proxy_requests p ON p.id=a.proxy_id JOIN proxy_capture_transport t ON t.proxy_id=p.id
    JOIN trace_identity_sources ss ON ss.id='scan:'||a.session_key AND ss.complete=1
    JOIN trace_identity_sources ps ON ps.id='proxy:'||p.id AND ps.complete=1
    JOIN trace_identities pi ON pi.source_id=ps.id AND pi.kind IN ('request','response','message') AND pi.scope IS NOT NULL AND pi.scope<>''
    JOIN trace_identities i ON i.source_id=ss.id AND i.namespace=pi.namespace AND i.kind=pi.kind AND i.value=pi.value AND i.scope=pi.scope
    WHERE a.state IN ('direct','confirmed') AND a.session_key IN (SELECT value FROM json_each(?))
    AND NOT EXISTS(SELECT 1 FROM trace_associations other WHERE other.proxy_id=p.id AND other.session_key<>a.session_key AND other.state IN ('direct','confirmed'))
    AND (SELECT COUNT(DISTINCT ni.event_id) FROM trace_identities ni WHERE ni.source_id=ss.id AND ni.namespace=i.namespace AND ni.kind=i.kind AND ni.value=i.value AND ni.scope=i.scope)=1
    AND NOT EXISTS(SELECT 1 FROM trace_identities ni WHERE ni.source_id=ss.id AND ni.namespace=i.namespace AND ni.kind=i.kind AND ni.value=i.value AND ni.scope=i.scope AND ni.event_id IS NULL)
    ORDER BY p.id,i.id LIMIT 2001`).all(JSON.stringify(keys)) as { session_key: string; id: number; started_at: string; output_tokens: number | null; result_json: string; event_id: string; namespace: string; kind: string; value: string; scope: string }[];
  if (rows.length > 2000) input.limits.push('capture_matches');
  const retained = new Map(input.records.map(r => [r.recordId, r])), groups = new Map<number, typeof rows>();
  for (const row of rows.slice(0, 2000)) { const g = groups.get(row.id) ?? []; g.push(row); groups.set(row.id, g); }
  for (const group of groups.values()) {
    signal?.throwIfAborted();
    const row = group[0]!, ids = [...new Set(group.map(r => r.session_key + ':event:' + r.event_id))];
    const owners = new Set(ids.map(id => { const r = retained.get(id); return r?.native.modelCall ? JSON.stringify(r.native.modelCall) : r?.attempt ? JSON.stringify([r.memberId, r.attempt]) : id; }));
    if (owners.size !== 1 || ids.some(id => !retained.has(id))) continue;
    const timing = (JSON.parse(row.result_json) as CaptureTransportResult).timing;
    if (!timing || typeof timing.firstContentMs !== 'number' || !Number.isFinite(timing.firstContentMs) || typeof timing.completedMs !== 'number' || !Number.isFinite(timing.completedMs) || timing.contentTimingStatus !== 'observed' || timing.firstContentBasis !== 'sse_event_dispatch' || timing.firstContentMs === null || timing.completedMs === null) continue;
    const start = Date.parse(row.started_at) - Date.parse(input.t0);
    if (!Number.isFinite(start) || start < 0 || timing.firstContentMs < 0 || timing.firstContentMs > timing.completedMs) { input.reasons.push('invalid_capture_clock'); continue; }
    input.captures.push({ id: String(row.id), recordIds: ids, startedMs: start, firstContentMs: start + timing.firstContentMs, completedMs: start + timing.completedMs, outputTokens: count(row.output_tokens), layer: 'proxy' });
    await yieldLoop();
  }
}

/** A bounded in-memory metadata projection lets the unchanged taskStructure
 * queries use a covering index. The original source index lacks event_id and
 * otherwise rescans wide identity rows for every 200-event page. Nothing is
 * written to the source DB. Off-page tool identities/partners remain included. */
async function pairRecords(db: Database, input: HealthInput, signal?: AbortSignal): Promise<void> {
  if (!input.records.some(r => r.event)) return;
  const keys = input.members.flatMap(m => m.sessionKey && m.detailLoaded ? [m.sessionKey] : []), encoded = JSON.stringify(keys);
  const sources = cachedStmt(db, 'SELECT id,session_key,complete FROM trace_identity_sources WHERE session_key IN (SELECT value FROM json_each(?))').all(encoded) as { id: string; session_key: string; complete: number }[];
  const identities = cachedStmt(db, `SELECT source_id,event_id,namespace,kind,value,scope FROM trace_identities WHERE source_id IN (SELECT value FROM json_each(?)) AND kind IN ('turn','request','response','tool_call') LIMIT 100001`).all(JSON.stringify(sources.map(s => s.id))) as { source_id: string; event_id: string | null; namespace: string; kind: string; value: string; scope: string | null }[];
  const overflow = identities.length > 100000;
  if (overflow) input.limits.push('identity_projection');
  const projection = new Sqlite(':memory:');
  try {
    projection.exec(`CREATE TABLE trace_identity_sources(id TEXT PRIMARY KEY,session_key TEXT,complete INTEGER);
      CREATE TABLE trace_identities(source_id TEXT,event_id TEXT,namespace TEXT,kind TEXT,value TEXT,scope TEXT);
      CREATE INDEX idx_trace_identities_source ON trace_identities(source_id,event_id,namespace,kind,value,scope);
      CREATE TABLE events(session_id TEXT,id TEXT,sequence INTEGER,title TEXT,started_at TEXT,kind TEXT,input_len INTEGER,turn_key TEXT,PRIMARY KEY(session_id,id));
      CREATE INDEX idx_events_session_seq ON events(session_id,sequence);`);
    const insertSource = cachedStmt(projection, 'INSERT INTO trace_identity_sources(id,session_key,complete) VALUES(?,?,?)');
    const insertIdentity = cachedStmt(projection, 'INSERT INTO trace_identities(source_id,event_id,namespace,kind,value,scope) VALUES(?,?,?,?,?,?)');
    const insertEvent = cachedStmt(projection, 'INSERT OR IGNORE INTO events(session_id,id,sequence,title,started_at,kind,input_len,turn_key) VALUES(?,?,?,?,?,?,?,?)');
    for (const source of sources) insertSource.run(source.id, source.session_key, overflow ? 0 : source.complete);
    // Include off-page partners/conflicts, not just the retained health prefix.
    const eventIds = new Map<string, Set<string>>();
    for (const row of identities.slice(0, 100000)) if (row.event_id) { const ids = eventIds.get(row.source_id.slice(5)) ?? new Set<string>(); ids.add(row.event_id); eventIds.set(row.source_id.slice(5), ids); }
    const byEvent = new Map<string, typeof identities>(), byTool = new Map<string, typeof identities>();
    const eventKey = (source: string, id: string | null) => JSON.stringify([source, id]);
    const toolKey = (r: typeof identities[number]) => JSON.stringify([r.source_id,r.namespace,r.value,r.scope]);
    for (const r of identities.slice(0, 100000)) {
      const key = eventKey(r.source_id, r.event_id), group = byEvent.get(key) ?? []; group.push(r); byEvent.set(key, group);
      if (r.kind === 'tool_call') { const key = toolKey(r), tools = byTool.get(key) ?? []; tools.push(r); byTool.set(key, tools); }
    }
    const clearIdentities = cachedStmt(projection, 'DELETE FROM trace_identities');
    const readEvents = cachedStmt(db, `SELECT session_id,id,sequence,title,started_at,kind,input_len,turn_key FROM events WHERE session_id=? AND id IN (SELECT value FROM json_each(?))`);
    for (const [key, ids] of eventIds) {
      const list = [...ids];
      for (let i = 0; i < list.length; i += 200) {
        signal?.throwIfAborted(); const rows = readEvents.all(key, JSON.stringify(list.slice(i, i + 200))) as { session_id: string; id: string; sequence: number; title: string; started_at: string; kind: string; input_len: number; turn_key: string | null }[];
        projection.transaction(() => { for (const row of rows) insertEvent.run(row.session_id,row.id,row.sequence,row.title,row.started_at,row.kind,row.input_len,row.turn_key); })(); await yieldLoop();
      }
    }
    for (let i = 0; i < input.records.length; i += 200) {
      projection.transaction(() => { for (const r of input.records.slice(i, i + 200)) if (r.event) insertEvent.run(r.event.sessionId,r.event.id,r.event.sequence,r.event.title,r.event.startedAt,r.event.kind,r.inputLen ?? 0,r.event.turnKey ?? null); })();
      await yieldLoop(); signal?.throwIfAborted();
    }
    for (let i = 0; i < input.records.length; i += 200) {
      const page = input.records.slice(i, i + 200), items: TaskRecord[] = page.map(r => ({ id: r.recordId, memberId: r.memberId, memberName: '', sessionKey: r.event?.sessionId ?? null, event: r.event, importedTurn: r.importedTurn }));
      // Retain this page's identities AND every off-page occurrence of its tool
      // tuples. This is exactly the query closure used by taskStructure; unrelated
      // tuples cannot affect pairing and need not be rescanned on each page.
      const wanted = new Set<typeof identities[number]>();
      for (const item of items) for (const row of byEvent.get(eventKey('scan:' + item.sessionKey, item.event!.id)) ?? []) {
        wanted.add(row); if (row.kind === 'tool_call') for (const related of byTool.get(toolKey(row)) ?? []) wanted.add(related);
      }
      projection.transaction(() => { clearIdentities.run(); for (const row of wanted) insertIdentity.run(row.source_id,row.event_id,row.namespace,row.kind,row.value,row.scope); })();
      const structure = taskStructure(projection, items), refs = new Map(structure.records.map(r => [r.recordId, r]));
      for (const r of page) { const ref = refs.get(r.recordId); if (ref) { r.round = ref.round; r.attempt = ref.attempt; r.tool = ref.tool; r.pairing = ref.pairing; r.relatedRecordIds = ref.relatedRecordIds; } }
      input.reasons.push(...structure.warnings); await yieldLoop(); signal?.throwIfAborted();
    }
  } finally { projection.close(); }
}

export async function collectTaskHealth(db: Database, taskId: string, scope: HealthScope = { member: 'all', from: null, to: null }, signal?: AbortSignal): Promise<HealthInput> {
  signal?.throwIfAborted();
  if (!scope.member || scope.member.length > 512) throw new HealthError('BAD_REQUEST', 400);
  const range = validateTaskRange({ ...(scope.from === null ? {} : { from: scope.from }), ...(scope.to === null ? {} : { to: scope.to }) });
  const before = JSON.stringify(counter(db)), revision = await healthRevision(db, taskId), context = getTask(db, taskId);
  const selected = recordMembers(context, scope.member), keys = selected.flatMap(m => m.sessionKey ? [m.sessionKey] : []);
  const rows = cachedStmt(db, 'SELECT id,provider,duration_source,cwd,source_path,detail_loaded FROM sessions WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').all(JSON.stringify(selected.flatMap(m => m.sessionKey ? [m.sessionKey] : []))) as SessionRow[];
  const byKey = new Map(rows.map(r => [r.id, r]));
  const ceilings = cachedStmt(db, 'SELECT session_id,MAX(sequence) AS n FROM events WHERE session_id IN (SELECT value FROM json_each(?)) GROUP BY session_id').all(JSON.stringify(keys)) as { session_id: string; n: number }[];
  const importMax = context.importSession ? (cachedStmt(db, 'SELECT MAX(sequence) AS n FROM trace_log_turns WHERE import_id=?').get(context.importSession.id) as { n: number | null }).n : null;
  const snapshotAt = new Date().toISOString();
  const input: HealthInput = { version: 1, taskId: context.task.id, t0: snapshotAt, scope: { member: scope.member, from: range.from || null, to: range.to || null }, revision, snapshotAt,
    running: context.task.recordedStatus === 'running', recordedStatus: ['success', 'error', 'running', 'cancelled', 'unknown'].includes(context.task.recordedStatus) ? context.task.recordedStatus as HealthInput['recordedStatus'] : 'unknown',
    window: Buffer.from(JSON.stringify({ task: context.task.id, member: scope.member, ceilings: ceilings.map(r => [r.session_id, r.n]), importMax })).toString('base64url'),
    members: selected.map(m => { const row = m.sessionKey ? byKey.get(m.sessionKey) : null; const provider = row?.provider ?? null, durationSource = row?.duration_source ?? 'unknown'; return { id: m.id, parentId: m.parentId, role: m.role, sessionKey: m.sessionKey, provider, detailLoaded: m.detailLoaded, durationSource,
      tokenSemantics: provider === 'codex' ? { cacheRead: 'incremental', reasoning: 'incremental', reasoningInTotal: false } : provider === 'claude' || provider === 'codeagent' ? { cacheRead: 'incremental', reasoning: 'incremental' } : null,
      // Session measured flags cannot certify every OpenCode part's native endpoints.
      timestampSemantics: provider && ['opencode', 'codearts', 'codeagent2'].includes(provider) ? 'start' : timestampSemantics(provider, durationSource), cwd: row?.cwd ?? null }; }),
    records: [], captures: [], limits: context.warnings.includes('member_limit') ? ['members'] : [], reasons: [...context.warnings] };
  if (scope.member === 'all' && context.task.memberCount > selected.length) input.reasons.push('selected_member_total:' + context.task.memberCount);
  if (selected.some(m => !m.detailLoaded)) input.reasons.push('native_detail_not_loaded');
  const addPage = async (items: TaskRecord[], lengths: Map<string, [number | null, number | null]>) => {
    for (const item of items) { const len = lengths.get(item.id); input.records.push({ recordId: item.id, memberId: item.memberId, event: item.event, importedTurn: item.importedTurn, inputLen: len?.[0] ?? null, outputLen: len?.[1] ?? null, round: null, attempt: null, tool: null, pairing: 'unavailable', relatedRecordIds: [], native: blankNative() }); }
    await yieldLoop(); signal?.throwIfAborted();
  };
  // Read full prefixes/partners before the engine clips completion-semantic intervals.
  for (const member of selected) {
    if (!member.detailLoaded) continue;
    const ceiling = ceilings.find(r => r.session_id === member.sessionKey)?.n;
    if (context.importSession) {
      let offset = 0;
      while (input.records.length < 20000) {
        signal?.throwIfAborted();
        const page = cachedStmt(db, 'SELECT metadata_json FROM trace_log_turns WHERE import_id=? AND sequence<=? ORDER BY sequence LIMIT 200 OFFSET ?').all(context.importSession.id, importMax ?? -1, offset) as { metadata_json: string }[];
        await addPage(page.map(r => { const turn = JSON.parse(r.metadata_json) as TraceLogTurn; return { id: 'import:' + turn.sequence, memberId: member.id, memberName: member.name, sessionKey: null, event: null, importedTurn: turn }; }), new Map()); offset += page.length;
        if (page.length < 200) break;
      }
    } else if (member.sessionKey && ceiling !== undefined) {
      let last = -1;
      while (input.records.length < 20000) {
        signal?.throwIfAborted();
        const page = cachedStmt(db, `SELECT ${HEALTH_EVENT_SLIM_COLS} FROM events WHERE session_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`).all(member.sessionKey, last, ceiling, Math.min(200, 20000 - input.records.length)) as Record<string, unknown>[];
        const lengths = new Map<string, [number | null, number | null]>();
        const items = page.map(row => { const event = mapEvent(row, false) as TraceEventSlim, id = member.sessionKey + ':event:' + event.id; lengths.set(id, [row.input_len as number, row.output_len as number]); return { id, memberId: member.id, memberName: member.name, sessionKey: member.sessionKey, event, importedTurn: null }; });
        await addPage(items, lengths); if (page.length < 200) break; last = page.at(-1)!.sequence as number;
      }
    }
  }
  if (input.records.length >= 20000) input.limits.push('events');
  const allKeys = context.members.flatMap(m => m.sessionKey ? [m.sessionKey] : []);
  const origin = context.importSession
    ? (cachedStmt(db, "SELECT MIN(json_extract(metadata_json,'$.requestTime')) AS at FROM trace_log_turns WHERE import_id=?").get(context.importSession.id) as { at: string | null }).at
    : (cachedStmt(db, "SELECT MIN(started_at) AS at FROM events WHERE session_id IN (SELECT value FROM json_each(?)) AND kind='user_prompt'").get(JSON.stringify(allKeys)) as { at: string | null }).at;
  if (origin && date(origin)) input.t0 = date(origin)!; else input.reasons.push('missing_origin');
  await pairRecords(db, input, signal);
  const nativeMembers = cachedStmt(db, `SELECT s.session_key,i.value FROM trace_identity_sources s JOIN trace_identities i ON i.source_id=s.id WHERE s.complete=1 AND s.session_key IN (SELECT value FROM json_each(?)) AND i.kind='session' AND i.scope IS NULL AND i.namespace='agent:codex' AND NOT EXISTS(SELECT 1 FROM trace_identities other INDEXED BY idx_trace_identities_native JOIN trace_identity_sources owner ON owner.id=other.source_id WHERE other.kind='session' AND other.scope IS NULL AND other.namespace=i.namespace AND other.value=i.value AND owner.session_key<>s.session_key)`).all(JSON.stringify(allKeys)) as { session_key: string; value: string }[];
  const owners = new Map<string, Set<string>>();
  for (const row of nativeMembers) { const ids = owners.get(row.value) ?? new Set<string>(); ids.add(row.session_key); owners.set(row.value, ids); }
  const delegates = new Map<string, string>();
  for (const [value, ids] of owners) if (ids.size === 1) { const member = input.members.find(m => ids.has(m.sessionKey ?? '')); if (member) delegates.set(value, member.id); }
  const budget = { bytes: 0 };
  for (const row of rows.filter(r => r.detail_loaded === 1)) { signal?.throwIfAborted(); await enrich(row, input.records.filter(r => r.event?.sessionId === row.id), budget, input.reasons, input.limits, signal, delegates); }
  await captureTimings(db, input, signal);
  input.reasons = [...new Set(input.reasons)]; input.limits = [...new Set(input.limits)];
  if (before !== JSON.stringify(counter(db)) || revision !== await healthRevision(db, taskId)) throw new HealthError('SOURCE_CHANGED', 409);
  signal?.throwIfAborted(); return input;
}

/** Drop only unreferenced public evidence to fit storage; all omissions stay explicit. */
export function boundHealthReport(report: HealthReport): HealthReport {
  const bytes = () => Buffer.byteLength(JSON.stringify(report));
  if (bytes() <= 1024 * 1024) return report;
  const needed = new Set([...report.metrics.flatMap(m => m.evidenceIds), ...report.findings.flatMap(f => f.evidenceIds)]);
  report.evidence = report.evidence.filter(e => needed.has(e.id));
  report.coverage.limits = [...new Set([...report.coverage.limits, 'report_bytes'])];
  report.coverage.reasons.push('unreferenced_evidence_omitted'); report.limitations.push('Unreferenced evidence omitted to fit 1MiB; coverage is partial.');
  for (const key of Object.keys(report.dimensions) as (keyof HealthReport['dimensions'])[]) if (report.dimensions[key] === 'not_observed') report.dimensions[key] = 'insufficient';
  for (const m of report.metrics) if (m.coverage === 'complete') { m.coverage = 'partial'; m.reason = m.reason ?? 'report_bytes'; }
  if (bytes() > 1024 * 1024) throw new HealthError('HEALTH_SIZE_LIMIT');
  return report;
}
/** Public report projection preserves references and removes credential text. */
function publicReport(report: HealthReport, input: HealthInput): HealthReport {
  const total = input.reasons.find(r => r.startsWith('selected_member_total:'));
  if (total) report.coverage.members.total = Number(total.slice('selected_member_total:'.length));
  for (const e of report.evidence) { e.title = redactHealthText(e.title).slice(0, 200); const summary = e.summary === null ? null : redactHealthText(e.summary); e.summary = summary?.slice(0, 1500) ?? null; if (summary !== null && summary.length > 1500) e.truncated = true; }
  for (const span of report.spans) span.title = redactHealthText(span.title).slice(0, 200);
  for (const m of report.metrics) for (const [key,value] of Object.entries(m.facets)) m.facets[key] = key === 'fingerprint' ? hash(value) : redactHealthText(value);
  for (const f of report.findings) {
    f.id = 'finding:' + hash(f.id);
    for (const [key,value] of Object.entries(f.facts)) if (typeof value === 'string') f.facts[key] = key === 'fingerprint' ? hash(value) : redactHealthText(value);
    f.recommendation.action = redactHealthText(f.recommendation.action); f.recommendation.conditions = redactHealthText(f.recommendation.conditions);
  }
  return boundHealthReport(report);
}

/** P2a's full-evidence serializer can reject before returning its report. Reuse
 * its snapshot/metrics/rules on the SAME full input, with a bounded public
 * evidence projection. Numeric values and sample denominators are never sampled. */
export function calculateHealthReport(input: HealthInput, thresholds?: Partial<HealthThresholds>): HealthReport {
  const meta = { id: randomUUID(), generatedAt: new Date().toISOString() };
  if (input.records.length <= 4000) {
    try { return publicReport(analyzeTaskHealth(input, thresholds, meta), input); }
    catch (error) { if (!(error instanceof RangeError) || error.message !== 'Health report exceeds 1MiB') throw error; }
  }
  const resolved = validateHealthThresholds(thresholds), snapshot = buildSnapshot(input), metrics = computeMetrics(snapshot, resolved);
  const context = { snapshot, metrics, thresholds: resolved };
  const findings = [perceivedRules, planRules, actRules, modelRules, startupRules, qualityRules].flatMap(rule => rule(context)).map(renderFinding);
  snapshot.limits = [...new Set([...snapshot.limits, 'report_bytes'])];
  findings.push(...coverageRules(context).map(renderFinding));
  for (const m of metrics) if (m.coverage === 'complete') { m.coverage = 'partial'; m.reason = 'public_projection_omitted'; }
  findings.sort((a, b) => unionDuration(b.intervalMs ?? []) - unionDuration(a.intervalMs ?? []) || a.id.localeCompare(b.id));
  for (const item of [...metrics, ...findings]) item.evidenceIds = [...new Set(item.evidenceIds)].slice(0, 16);
  const needed = new Set([...metrics, ...findings].flatMap(v => v.evidenceIds));
  const evidenceTiming = new Map<string, HealthReport['evidence'][number]['timing']>();
  for (const tool of snapshot.tools) for (const record of tool.records) evidenceTiming.set(record.recordId, tool.span.timing);
  for (const span of snapshot.spans) if (span.recordId && !evidenceTiming.has(span.recordId)) evidenceTiming.set(span.recordId, span.timing);
  const evidence = snapshot.records.filter(r => needed.has(evidenceId(r.recordId))).map(r => ({ id: evidenceId(r.recordId), memberId: r.memberId, recordIds: [r.recordId], captureIds: input.captures.filter(c => c.recordIds.includes(r.recordId)).map(c => c.id), title: (r.event?.title ?? r.importedTurn?.turnId ?? 'record').slice(0, 200), summary: null, truncated: true, intervalMs: null, timing: evidenceTiming.get(r.recordId) ?? (r.importedTurn ? 'reported' as const : 'observed' as const) }));
  const models = snapshot.spans.filter(s => s.kind === 'model').flatMap(s => { const value = located(s); return value ? [value] : []; });
  const tools = snapshot.tools.filter(t => t.span.kind === 'tool').flatMap(t => { const value = located(t.span); return value ? [value] : []; });
  const overlap = models.flatMap(m => tools.flatMap(t => { const value = intersect(m, t); return value ? [value] : []; }));
  const result: HealthReport = { version: 1, id: meta.id, taskId: input.taskId, mode: 'standard', scope: input.scope, revision: input.revision, generatedAt: meta.generatedAt, snapshotAt: input.snapshotAt, running: input.running, thresholds: resolved, calcVersion: HEALTH_CALC_VERSION, ruleVersion: HEALTH_RULE_VERSION,
    coverage: { members: { loaded: snapshot.members.filter(m => m.detailLoaded).length, total: snapshot.totalMembers }, timing: { measured: 0, observed: 0, derived: 0, reported: 0, model_judged: 0, unknown: 0, unavailable: 0 }, limits: snapshot.limits, reasons: [...new Set([...snapshot.reasons, 'public_projection_omitted'])] },
    metrics, findings, evidence, spans: [], rounds: snapshot.rounds.map(r => ({ ...r, toolSpanIds: [] })), dimensions: { perceived: 'insufficient', plan: 'insufficient', act: 'insufficient', model: 'insufficient', startup: 'insufficient', quality: 'insufficient', coverage: 'insufficient' },
    partition: snapshot.bounds && snapshot.members.every(m => m.timestampSemantics !== 'unknown') ? partition(snapshot.bounds, [{ key: 'userWait', intervals: snapshot.userWait }, { key: 'delegateWait', intervals: snapshot.delegateWait }, { key: 'undivided', intervals: snapshot.undivided }, { key: 'overlap', intervals: overlap }, { key: 'modelOnly', intervals: models }, { key: 'toolOnly', intervals: tools }], 'unattributed') : null,
    limitations: [...snapshot.reasons, 'Partial public projection: all statistics use retained full input; spans and round span links omitted; each metric/finding retains at most 16 evidence references; evidence titles only. Quality acceptance remains unknown.'] };
  for (const span of snapshot.spans) result.coverage.timing[span.timing]++;
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new HealthError('HEALTH_SIZE_LIMIT');
  return publicReport(result, input);
}
// A dedicated worker isolates the existing synchronous pure engine from forwarding.
// The module remains an ordinary export-only entry when bundled with the server/CLI.
if (!isMainThread && workerData?.taskHealth === true) {
  let input: HealthInput;
  parentPort!.on('message', (message: { input?: HealthInput; records?: HealthRecord[]; thresholds?: Partial<HealthThresholds>; run?: boolean }) => {
    if (message.input) input = message.input;
    if (message.records) input.records.push(...message.records);
    if (message.run) {
      try { const report = calculateHealthReport(input, message.thresholds); parentPort!.postMessage({ report }); }
      catch (error) { parentPort!.postMessage({ code: error instanceof HealthError ? error.code : 'HEALTH_SOURCE_UNAVAILABLE' }); }
      parentPort!.close();
    }
  });
}
export async function generateHealthReport(input: HealthInput, thresholds?: Partial<HealthThresholds>, signal?: AbortSignal): Promise<HealthReport> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL(import.meta.url), { workerData: { taskHealth: true }, execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')) });
  const abort = () => { void worker.terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = new Promise<HealthReport>((resolve, reject) => {
      worker.once('error', reject); worker.once('exit', () => reject(new HealthError('HEALTH_SOURCE_UNAVAILABLE')));
      worker.once('message', (value: { report?: HealthReport; code?: string }) => value.report ? resolve(value.report) : reject(new HealthError(value.code ?? 'HEALTH_SOURCE_UNAVAILABLE')));
    });
    // Attach immediately, including while batches are sent, to own early worker failures.
    void result.catch(() => {});
    worker.postMessage({ input: { ...input, records: [] } });
    for (let i = 0; i < input.records.length; i += 200) { signal?.throwIfAborted(); worker.postMessage({ records: input.records.slice(i, i + 200) }); await yieldLoop(); }
    worker.postMessage({ run: true, thresholds });
    return await result;
  } finally { signal?.removeEventListener('abort', abort); await worker.terminate(); }
}
