import type { Database } from 'better-sqlite3';
import type { NativeToolObservationPage } from '../../src/core/native-tool-observations.js';
import type { TraceEventSlim, TraceSourceIdentity } from '../../src/core/trace-types.js';
import { EVENT_SLIM_COLS, TRACE_IDENTITY_COLS, TRACE_IDENTITY_SOURCE_COLS } from './columns.js';
import { cachedStmt } from './stmt-cache.js';
import { assertIdentityOwner, TraceLinkError } from './trace-links.js';
import { LinkedExecutionLimitError } from './linked-execution.js';

type Row = Record<string, unknown>;
export type ToolObservationOptions = NativeToolObservationPage['identity'] & { cursor?: number; limit?: number };
const columns = EVENT_SLIM_COLS.split(', ').map(value => value.startsWith('CASE ') ? value : 'e.' + value).join(', ');
const refs = "source_id=? AND kind='tool_call' AND namespace=? AND value=? AND scope=?";
export const TOOL_OBSERVATION_EVENTS_SQL = 'WITH refs AS (SELECT DISTINCT event_id FROM trace_identities INDEXED BY idx_trace_identities_source WHERE ' + refs + ' AND event_id IS NOT NULL) ' +
  'SELECT ' + columns + ', EXISTS(SELECT 1 FROM event_raw r WHERE r.session_id=e.session_id AND r.event_id=e.id) AS has_raw ' +
  'FROM refs JOIN events e ON e.session_id=? AND e.id=refs.event_id WHERE e.sequence>? ORDER BY e.sequence LIMIT ?';

function slim(row: Row): TraceEventSlim {
  return { id: row.id as string, sessionId: row.session_id as string, sequence: row.sequence as number,
    turnKey: row.turn_key as string | null, kind: row.kind as TraceEventSlim['kind'], phase: row.phase as TraceEventSlim['phase'],
    title: row.title as string, startedAt: row.started_at as string, durationMs: row.duration_ms as number,
    status: row.status as TraceEventSlim['status'], actor: row.actor as string, tool: row.tool as string | null,
    tokens: row.tokens_json === null ? null : JSON.parse(row.tokens_json as string) as TraceEventSlim['tokens'],
    error: row.error as string | null, hasInput: Boolean(row.has_input), hasOutput: Boolean(row.has_output), hasRaw: Boolean(row.has_raw), model: row.model as string | null };
}
function identifier(value: string, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !Array.from(value).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159));
}
export function getNativeToolObservations(db: Database, sessionKey: string, options: ToolObservationOptions): NativeToolObservationPage {
  const { namespace, value, scope } = options, limit = options.limit ?? 20, cursor = options.cursor ?? 0;
  if (!identifier(namespace, 128) || !identifier(value, 1024) || !identifier(scope, 1024) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new TraceLinkError('BAD_REQUEST', 'Invalid native tool observation query');
  }
  return db.transaction(() => {
    assertIdentityOwner(db, { source: 'scan', key: sessionKey });
    const owner = 'scan:' + sessionKey, args = [owner, namespace, value, scope];
    const source = cachedStmt(db, 'SELECT ' + TRACE_IDENTITY_SOURCE_COLS + ' FROM trace_identity_sources WHERE id=?').get(owner) as Row | undefined;
    const roots = cachedStmt(db, "SELECT DISTINCT namespace, value FROM trace_identities INDEXED BY idx_trace_identities_source WHERE source_id=? AND kind='session' AND scope IS NULL").all(owner) as Array<{ namespace: string; value: string }>;
    const nativeOwners = cachedStmt(db, "SELECT COUNT(DISTINCT i.source_id) AS total FROM json_each(?) k CROSS JOIN trace_identities i INDEXED BY idx_trace_identities_native " +
      "JOIN trace_identity_sources s ON s.id=i.source_id WHERE i.namespace=json_extract(k.value,'$[0]') AND i.value=json_extract(k.value,'$[1]') AND i.kind='session' AND i.scope IS NULL AND s.session_key IS NOT NULL")
      .get(JSON.stringify(roots.filter(root => root.value === scope).map(root => [root.namespace, root.value]))) as { total: number };
    const totals = cachedStmt(db, 'SELECT COUNT(DISTINCT e.id) AS total, COUNT(DISTINCT e.turn_key) AS turns, ' +
      'SUM(CASE WHEN i.event_id IS NULL OR e.id IS NULL THEN 1 ELSE 0 END) AS dangling, ' +
      "SUM(CASE WHEN e.id IS NOT NULL AND e.kind<>'tool' THEN 1 ELSE 0 END) AS non_tools " +
      'FROM trace_identities i INDEXED BY idx_trace_identities_source LEFT JOIN events e ON e.session_id=? AND e.id=i.event_id ' +
      "WHERE i.source_id=? AND i.kind='tool_call' AND i.namespace=? AND i.value=? AND i.scope=?")
      .get(sessionKey, ...args) as { total: number; turns: number; dangling: number | null; non_tools: number | null };
    const conflicts = cachedStmt(db, 'SELECT COUNT(DISTINCT i.event_id) AS total FROM trace_identities i INDEXED BY idx_trace_identities_source ' +
      'JOIN trace_identities other INDEXED BY idx_trace_identities_source ON other.source_id=i.source_id AND other.event_id=i.event_id ' +
      "WHERE i.source_id=? AND i.kind='tool_call' AND i.namespace=? AND i.value=? AND i.scope=? AND other.kind='tool_call' " +
      'AND (other.namespace<>i.namespace OR other.value<>i.value OR other.scope IS NOT i.scope)').get(...args) as { total: number };
    const rows = cachedStmt(db, TOOL_OBSERVATION_EVENTS_SQL).all(...args, sessionKey, cursor, limit + 1) as Row[];
    const result: NativeToolObservationPage = { sessionKey, identity: { namespace, value, scope }, state: 'retained_reference',
      events: rows.slice(0, limit).map(slim), eventTotal: totals.total, identities: [],
      completeness: { complete: true, omittedCount: 0, reasons: [] }, nextCursor: null, hasMore: rows.length > limit };
    const omit = (reason: string, count = 1): void => {
      result.completeness.complete = false; result.completeness.omittedCount += count;
      if (!result.completeness.reasons.includes(reason)) result.completeness.reasons.push(reason);
    };
    if (source === undefined) omit('identity_not_collected');
    else if (source.complete !== 1) {
      omit('identity_collection_incomplete', Math.max(1, Number(source.omitted_count)));
      for (const reason of JSON.parse(source.reasons_json as string) as string[]) if (!result.completeness.reasons.includes(reason)) result.completeness.reasons.push(reason);
    }
    if (new Set(roots.map(root => root.value)).size !== 1 || !roots.some(root => root.value === scope)) omit('owner_scope_incomplete');
    if ((totals.dangling ?? 0) > 0) omit('unbound_native_identity', totals.dangling!);
    const ambiguous = nativeOwners.total > 1 || totals.turns > 1 || conflicts.total > 0 || (totals.non_tools ?? 0) > 0;
    if (ambiguous) { result.state = 'ambiguous'; omit('ambiguous_native_binding'); }
    else if (!result.completeness.complete) result.state = 'incomplete';
    else if (totals.total === 0) result.state = 'unresolved';
    const identityRows = cachedStmt(db, 'SELECT ' + TRACE_IDENTITY_COLS + ' FROM trace_identities INDEXED BY idx_trace_identities_source WHERE ' + refs +
      ' AND event_id IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 1001').all(...args, JSON.stringify(result.events.map(event => event.id))) as Row[];
    result.identities = identityRows.slice(0, 1000).map(row => ({ id: row.id as string, source: 'scan', sourceKey: sessionKey, namespace: row.namespace as string,
      kind: 'tool_call', value: row.value as string, scope: row.scope as string | null, eventId: row.event_id as string | null, sourcePath: row.source_path as string } satisfies TraceSourceIdentity));
    if (identityRows.length > 1000) { omit('identity_limit'); if (result.state === 'retained_reference') result.state = 'incomplete'; }
    result.nextCursor = result.hasMore ? result.events.at(-1)?.sequence ?? null : null;
    while (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) {
      if (result.events.length <= 1) throw new LinkedExecutionLimitError();
      result.events.pop(); const retained = new Set(result.events.map(event => event.id));
      result.identities = result.identities.filter(identity => identity.eventId !== null && retained.has(identity.eventId));
      result.hasMore = true; result.nextCursor = result.events.at(-1)!.sequence; omit('response_budget'); if (result.state === 'retained_reference') result.state = 'incomplete';
    }
    result.nextCursor = result.hasMore ? result.events.at(-1)?.sequence ?? null : null;
    return result;
  })();
}
