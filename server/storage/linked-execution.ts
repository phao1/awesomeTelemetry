import type { Database } from 'better-sqlite3';
import type { CaptureTransportResult, LinkedExecutionPage, NativeIdentityKind, TraceAssociation, TraceSourceIdentity, TraceEventSlim } from '../../src/core/trace-types.js';
import { EVENT_SLIM_COLS, PROXY_CAPTURE_TRANSPORT_COLS, TRACE_ASSOCIATION_COLS, TRACE_IDENTITY_COLS, TRACE_IDENTITY_SOURCE_COLS } from './columns.js';
import { getProxyRequestListItemsByIds } from './query-engine.js';
import { cachedStmt } from './stmt-cache.js';
import { TraceLinkError } from './trace-links.js';

type Row = Record<string, unknown>;
export class LinkedExecutionLimitError extends Error {
  readonly code = 'EXECUTION_METADATA_LIMIT';
  constructor() { super('Execution metadata exceeds response budget'); this.name = 'LinkedExecutionLimitError'; }
}
const MATCH_KINDS = new Set<NativeIdentityKind>(['request', 'response', 'tool_call', 'message', 'span']);
const identityColumns = TRACE_IDENTITY_COLS.split(', ').map(column => 'i.' + column).join(', ');
export const EXECUTION_IDENTITIES_SQL = `SELECT ${identityColumns} FROM json_each(?) k
  CROSS JOIN trace_identities i INDEXED BY idx_trace_identities_source WHERE i.source_id=k.value LIMIT 1001`;
export const EXECUTION_EVENTS_SQL = `SELECT ${EVENT_SLIM_COLS},
  EXISTS(SELECT 1 FROM event_raw r WHERE r.session_id=events.session_id AND r.event_id=events.id) AS has_raw
  FROM events WHERE session_id=? ORDER BY sequence LIMIT ? OFFSET ?`;

function integer(value: number | undefined, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TraceLinkError('BAD_REQUEST', 'Invalid execution pagination');
  return result;
}
function event(row: Row): TraceEventSlim {
  return { id: row.id as string, sessionId: row.session_id as string, sequence: row.sequence as number,
    turnKey: row.turn_key as string | null, kind: row.kind as TraceEventSlim['kind'], phase: row.phase as TraceEventSlim['phase'],
    title: row.title as string, startedAt: row.started_at as string, durationMs: row.duration_ms as number,
    status: row.status as TraceEventSlim['status'], actor: row.actor as string, tool: row.tool as string | null,
    tokens: row.tokens_json === null ? null : JSON.parse(row.tokens_json as string) as TraceEventSlim['tokens'],
    error: row.error as string | null, hasInput: Boolean(row.has_input), hasOutput: Boolean(row.has_output), hasRaw: Boolean(row.has_raw), model: row.model as string | null };
}
const nativeKey = (identity: TraceSourceIdentity): string => JSON.stringify([identity.namespace, identity.kind, identity.value, identity.scope]);

/** Read-only metadata projection. Membership and shared identity are not causal/billing identity. */
export function getLinkedExecution(db: Database, sessionKey: string, options: {
  eventOffset?: number; eventLimit?: number; captureCursor?: number; captureLimit?: number;
} = {}): LinkedExecutionPage {
  const eventOffset = integer(options.eventOffset, 0, 0);
  const eventLimit = integer(options.eventLimit, 100, 1, 200);
  const captureCursor = integer(options.captureCursor, Number.MAX_SAFE_INTEGER, 1);
  const captureLimit = integer(options.captureLimit, 20, 1, 50);
  return db.transaction(() => {
    const session = cachedStmt(db, `SELECT duration_source,
      (SELECT COUNT(*) FROM events WHERE session_id=sessions.id) AS total
      FROM sessions WHERE id=? AND data_source='scan'`).get(sessionKey) as { duration_source: unknown; total: number } | undefined;
    if (session === undefined) throw new TraceLinkError('SESSION_NOT_FOUND', 'Scan session not found');
    const sessionDurationSource = session.duration_source === 'measured' || session.duration_source === 'derived' ? session.duration_source : 'unknown';
    const { total } = session;
    const events = (cachedStmt(db, EXECUTION_EVENTS_SQL).all(sessionKey, eventLimit, eventOffset) as Row[]).map(event);
    const associations = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_COLS},
      EXISTS(SELECT 1 FROM trace_associations other WHERE other.proxy_id=trace_associations.proxy_id
        AND other.session_key<>trace_associations.session_key AND other.state IN ('direct','confirmed')) AS ambiguous_owner
      FROM trace_associations WHERE session_key=? AND state IN ('direct','confirmed') AND proxy_id<?
      ORDER BY proxy_id DESC LIMIT ?`).all(sessionKey, captureCursor, captureLimit + 1) as Row[];
    const page = associations.slice(0, captureLimit);
    const evidence = cachedStmt(db, 'SELECT association_id, identity_id FROM trace_association_evidence WHERE association_id IN (SELECT value FROM json_each(?)) ORDER BY association_id, identity_id')
      .all(JSON.stringify(page.map(row => row.id))) as Array<{ association_id: string; identity_id: string }>;
    const evidenceByAssociation = new Map<string, string[]>();
    for (const row of evidence) {
      const ids = evidenceByAssociation.get(row.association_id) ?? []; ids.push(row.identity_id); evidenceByAssociation.set(row.association_id, ids);
    }
    const requests = new Map(getProxyRequestListItemsByIds(db, page.map(row => row.proxy_id as number)).map(request => [request.id, request]));
    const transports = cachedStmt(db, `SELECT ${PROXY_CAPTURE_TRANSPORT_COLS} FROM proxy_capture_transport WHERE proxy_id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(page.map(row => row.proxy_id as number))) as Array<{ proxy_id: number; result_json: string }>;
    const transportById = new Map(transports.map(row => [row.proxy_id, JSON.parse(row.result_json) as CaptureTransportResult]));
    const sourceIds = ['scan:' + sessionKey, ...page.map(row => 'proxy:' + row.proxy_id)];
    const sources = cachedStmt(db, `SELECT ${TRACE_IDENTITY_SOURCE_COLS} FROM trace_identity_sources WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(sourceIds)) as Row[];
    const sourceMap = new Map(sources.map(row => [row.id as string, row]));
    const identityRows = cachedStmt(db, EXECUTION_IDENTITIES_SQL).all(JSON.stringify(sourceIds)) as Row[];
    const identities: TraceSourceIdentity[] = identityRows.slice(0, 1000).map(row => {
      const source = row.source_id as string;
      return { id: row.id as string, source: source.startsWith('scan:') ? 'scan' : 'proxy', sourceKey: source.slice(source.indexOf(':') + 1),
        namespace: row.namespace as string, kind: row.kind as NativeIdentityKind, value: row.value as string, scope: row.scope as string | null,
        eventId: row.event_id as string | null, sourcePath: row.source_path as string };
    });
    const result: LinkedExecutionPage = { sessionKey, sessionDurationSource, events, eventOffset, eventLimit, eventTotal: total,
      eventsHasMore: eventOffset + events.length < total, attempts: [], nextCaptureCursor: associations.length > page.length ? page.at(-1)!.proxy_id as number : null,
      capturesHasMore: associations.length > page.length, identities, identityCompleteness: { complete: true, omittedCount: 0, reasons: [] } };
    const omit = (reason: string, count = 1): void => {
      result.identityCompleteness.complete = false; result.identityCompleteness.omittedCount += count;
      if (!result.identityCompleteness.reasons.includes(reason)) result.identityCompleteness.reasons.push(reason);
    };
    for (const id of sourceIds) {
      const source = sourceMap.get(id);
      if (source === undefined) omit('identity_not_collected');
      else if (source.complete !== 1) {
        omit('identity_collection_incomplete', Math.max(1, source.omitted_count as number));
        for (const reason of JSON.parse(source.reasons_json as string) as string[]) {
          if (!result.identityCompleteness.reasons.includes(reason)) result.identityCompleteness.reasons.push(reason);
        }
      }
    }
    const identityLimit = identityRows.length > 1000;
    if (identityLimit) omit('identity_limit');
    const scanGroups = new Map<string, TraceSourceIdentity[]>();
    for (const identity of identities) if (identity.source === 'scan' && MATCH_KINDS.has(identity.kind)) {
      const key = nativeKey(identity); const group = scanGroups.get(key) ?? []; group.push(identity); scanGroups.set(key, group);
      if (identity.eventId === null) omit('unbound_native_identity');
    }
    const visibleEvents = new Set(events.map(value => value.id));
    let matchCount = 0;
    for (const row of page) {
      const proxyId = row.proxy_id as number;
      const association: TraceAssociation = { id: row.id as string, sessionKey, proxyId, state: row.state as TraceAssociation['state'], reason: row.reason as string,
        evidenceIds: evidenceByAssociation.get(row.id as string) ?? [], createdAt: row.created_at as string, updatedAt: row.updated_at as string };
      const attempt: LinkedExecutionPage['attempts'][number] = { association, request: requests.get(proxyId)!, transport: transportById.get(proxyId) ?? null, matches: [] };
      result.attempts.push(attempt);
      if (row.ambiguous_owner === 1) { omit('ambiguous_capture_membership'); continue; }
      if (identityLimit || sourceMap.get('scan:' + sessionKey)?.complete !== 1 || sourceMap.get('proxy:' + proxyId)?.complete !== 1) continue;
      for (const identity of identities) {
        if (identity.source !== 'proxy' || identity.sourceKey !== String(proxyId) || !MATCH_KINDS.has(identity.kind) || identity.scope === null || identity.scope === '') continue;
        const group = scanGroups.get(nativeKey(identity));
        if (group === undefined) continue;
        const eventIds = new Set(group.map(value => value.eventId));
        if (eventIds.size !== 1 || eventIds.has(null)) { omit('ambiguous_native_binding'); continue; }
        const eventId = group[0]!.eventId!;
        if (!visibleEvents.has(eventId)) continue;
        if (matchCount >= 1000) { omit('match_limit'); continue; }
        attempt.matches.push({ eventId, scanIdentityId: group[0]!.id, proxyIdentityId: identity.id, namespace: identity.namespace, kind: identity.kind, value: identity.value, scope: identity.scope });
        matchCount += 1;
      }
    }
    // Budget each bounded record once instead of repeatedly serializing a huge
    // identity page. Uniqueness above was checked against the complete loaded
    // source, not this display subset. Every retained match keeps both locators.
    const proposedMatches = result.attempts.map(attempt => attempt.matches);
    for (const attempt of result.attempts) attempt.matches = [];
    result.identities = [];
    let bytes = Buffer.byteLength(JSON.stringify(result));
    const reserve = 512; // bounded new completeness reasons/count spelling
    const maximum = 1024 * 1024;
    for (const identity of identities) {
      const size = Buffer.byteLength(JSON.stringify(identity)) + 1;
      if (bytes + size > maximum - reserve) { omit('response_budget', identities.length - result.identities.length); break; }
      result.identities.push(identity); bytes += size;
    }
    const retained = new Set(result.identities.map(identity => identity.id));
    result.attempts.forEach((attempt, attemptIndex) => {
      for (const match of proposedMatches[attemptIndex]!) {
        const size = Buffer.byteLength(JSON.stringify(match)) + 1;
        if (!retained.has(match.scanIdentityId) || !retained.has(match.proxyIdentityId) || bytes + size > maximum - reserve) { omit('response_budget'); continue; }
        attempt.matches.push(match); bytes += size;
      }
    });
    // Metadata itself can contain large imported URLs. Shrink a normal page,
    // but never return an empty looping page or rewrite a single oversized item.
    while (Buffer.byteLength(JSON.stringify(result)) > maximum) {
      omit('response_budget');
      if (result.attempts.length > 1) {
        result.attempts.pop(); result.capturesHasMore = true; result.nextCaptureCursor = result.attempts.at(-1)!.request.id;
      } else if (result.events.length > 1) { result.events.pop(); result.eventsHasMore = true; }
      else throw new LinkedExecutionLimitError();
    }
    const returnedEvents = new Set(result.events.map(value => value.id));
    for (const attempt of result.attempts) attempt.matches = attempt.matches.filter(match => returnedEvents.has(match.eventId));
    return result;
  })();
}
