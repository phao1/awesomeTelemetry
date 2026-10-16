import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { PROVIDER_KEYS, type NativeIdentity, type NativeIdentitySet, type ProxyTraceLinkPage, type SessionCaptureLinkPage, type TraceAssociation, type TraceAssociationDecision, type TraceAssociationState, type TraceIdentityPage } from '../../src/core/trace-types.js';
import { TRACE_ASSOCIATION_COLS, TRACE_ASSOCIATION_DECISION_COLS, TRACE_IDENTITY_COLS, TRACE_IDENTITY_SOURCE_COLS } from './columns.js';
import { getProxyRequestListItemsByIds } from './query-engine.js';
import { cachedStmt } from './stmt-cache.js';

type Row = Record<string, unknown>;
export interface IdentityOwner { source: 'scan' | 'proxy'; key: string }
export class TraceLinkError extends Error {
  readonly code: 'BAD_REQUEST' | 'SESSION_NOT_FOUND' | 'PROXY_REQUEST_NOT_FOUND';
  constructor(code: TraceLinkError['code'], message: string) { super(message); this.name = 'TraceLinkError'; this.code = code; }
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceId = (owner: IdentityOwner): string => owner.source + ':' + owner.key;
const associationId = (sessionKey: string, proxyId: number): string => hash(['session-proxy', sessionKey, proxyId]);
const namespaceKnown = (namespace: string): boolean => PROVIDER_KEYS.some(provider => namespace === 'agent:' + provider);
const sourceColumns = TRACE_IDENTITY_SOURCE_COLS.split(', ').map(column => 's.' + column).join(', ');
const identityColumns = TRACE_IDENTITY_COLS.split(', ').map(column => 'i.' + column).join(', ');
export const SESSION_IDENTITY_SQL = `SELECT ${identityColumns}, s.session_key, s.proxy_id, s.complete
  FROM json_each(?) k CROSS JOIN trace_identities i INDEXED BY idx_trace_identities_native
  JOIN trace_identity_sources s ON s.id=i.source_id
  WHERE i.namespace=json_extract(k.value,'$[0]') AND i.value=json_extract(k.value,'$[1]')
    AND i.kind='session' AND i.scope IS NULL`;
const EVIDENCE_SQL = 'SELECT association_id, identity_id FROM trace_association_evidence WHERE association_id IN (SELECT value FROM json_each(?)) ORDER BY association_id, identity_id';
const SOURCE_IDENTITIES_SQL = `SELECT ${TRACE_IDENTITY_COLS} FROM trace_identities WHERE source_id=? ORDER BY id`;
const INSERT_ASSOC_SQL = 'INSERT INTO trace_associations (id, session_key, proxy_id, state, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
const UPDATE_ASSOC_SQL = 'UPDATE trace_associations SET state=?, reason=?, updated_at=? WHERE id=?';
const NATIVE_KINDS = new Set(['session', 'turn', 'message', 'request', 'response', 'tool_call', 'trace', 'span', 'parent_session', 'parent_span']);

const UNIQUE_LINKED_SESSION_SQL = "SELECT session_key FROM trace_associations WHERE proxy_id=? AND state IN ('direct','confirmed') LIMIT 2";
const ELIGIBLE_PREDECESSOR_FROM = `FROM trace_associations a INDEXED BY idx_trace_associations_session CROSS JOIN proxy_requests p
  WHERE p.id=a.proxy_id AND a.session_key=? AND a.state IN ('direct','confirmed') AND p.request_format=?
    AND (julianday(p.started_at)<julianday(?) OR (julianday(p.started_at)=julianday(?) AND p.id<?))
    AND NOT EXISTS (SELECT 1 FROM trace_associations other WHERE other.proxy_id=p.id
      AND other.session_key<>a.session_key AND other.state IN ('direct','confirmed'))`;
export const LINKED_PREDECESSOR_TIME_SQL = `SELECT MAX(julianday(p.started_at)) AS instant ${ELIGIBLE_PREDECESSOR_FROM}`;
export const LINKED_PREDECESSOR_ID_SQL = `SELECT MAX(p.id) AS id ${ELIGIBLE_PREDECESSOR_FROM} AND julianday(p.started_at)=?`;

/** Membership is independent of parsed_session_id, model, timing and capture run. */
export function getUniqueLinkedSession(db: Database, proxyId: number): string | null {
  const rows = cachedStmt(db, UNIQUE_LINKED_SESSION_SQL).all(proxyId) as Array<{ session_key: string }>;
  return rows.length === 1 ? rows[0]!.session_key : null;
}

/** Metadata only: late body finalization must not turn insertion ids into chronology. */
export function findLinkedCapturePredecessor(
  db: Database, target: { id: number; requestFormat: string; startedAt: string },
): { id: number; sessionKey: string } | null {
  if (target.requestFormat === 'unknown') return null;
  const sessionKey = getUniqueLinkedSession(db, target.id);
  if (sessionKey === null) return null;
  const params = [sessionKey, target.requestFormat, target.startedAt, target.startedAt, target.id];
  const { instant } = cachedStmt(db, LINKED_PREDECESSOR_TIME_SQL).get(...params) as { instant: number | null };
  if (instant === null) return null;
  const { id } = cachedStmt(db, LINKED_PREDECESSOR_ID_SQL).get(...params, instant) as { id: number | null };
  return id === null ? null : { id, sessionKey };
}

function bad(message: string): never { throw new TraceLinkError('BAD_REQUEST', message); }
export function assertIdentityOwner(db: Database, owner: IdentityOwner): void {
  if (owner.source === 'scan') {
    const row = cachedStmt(db, "SELECT id FROM sessions WHERE id=? AND data_source='scan'").get(owner.key);
    if (row === undefined) throw new TraceLinkError('SESSION_NOT_FOUND', 'Scan session not found');
  } else {
    if (!/^[1-9]\d*$/.test(owner.key) || !Number.isSafeInteger(Number(owner.key))) bad('Invalid proxy id');
    if (cachedStmt(db, 'SELECT id FROM proxy_requests WHERE id=?').get(Number(owner.key)) === undefined) throw new TraceLinkError('PROXY_REQUEST_NOT_FOUND', 'Proxy request not found');
  }
}
function pageLimit(limit = 50): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) bad('limit must be an integer from 1 to 100');
  return limit;
}
function evidenceMap(db: Database, ids: string[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  if (ids.length === 0) return output;
  const rows = cachedStmt(db, EVIDENCE_SQL).all(JSON.stringify(ids)) as Array<{ association_id: string; identity_id: string }>;
  for (const row of rows) {
    const values = output.get(row.association_id) ?? [];
    values.push(row.identity_id); output.set(row.association_id, values);
  }
  return output;
}
function association(row: Row, evidence: Map<string, string[]>): TraceAssociation {
  return { id: row.id as string, sessionKey: row.session_key as string, proxyId: row.proxy_id as number, state: row.state as TraceAssociationState,
    reason: row.reason as string, evidenceIds: evidence.get(row.id as string) ?? [], createdAt: row.created_at as string, updatedAt: row.updated_at as string };
}
function nativeKeys(rows: Row[]): Array<[string, string]> {
  const keys = new Map<string, [string, string]>();
  for (const row of rows) if (row.kind === 'session' && row.scope === null && namespaceKnown(row.namespace as string)) {
    const key: [string, string] = [row.namespace as string, row.value as string];
    keys.set(JSON.stringify(key), key);
  }
  return [...keys.values()];
}
function replaceEvidence(db: Database, id: string, previous: string[], next: string[]): void {
  const prev = new Set(previous); const future = new Set(next);
  const insert = cachedStmt(db, 'INSERT OR IGNORE INTO trace_association_evidence (association_id, identity_id) VALUES (?, ?)');
  const remove = cachedStmt(db, 'DELETE FROM trace_association_evidence WHERE association_id=? AND identity_id=?');
  for (const key of next) if (!prev.has(key)) insert.run(id, key);
  for (const key of previous) if (!future.has(key)) remove.run(id, key);
}

/** Refresh only proxy owners affected by this ingestion; all reads are batched. */
function reconcile(db: Database, owner: IdentityOwner, keys: Array<[string, string]>, now: string): string[] {
  const proxyIds = new Set<number>();
  if (owner.source === 'proxy') proxyIds.add(Number(owner.key));
  else {
    const matching = cachedStmt(db, SESSION_IDENTITY_SQL).all(JSON.stringify(keys)) as Row[];
    for (const row of matching) if (row.proxy_id !== null) proxyIds.add(row.proxy_id as number);
    const old = cachedStmt(db, 'SELECT proxy_id FROM trace_associations WHERE session_key=?').all(owner.key) as Array<{ proxy_id: number }>;
    for (const row of old) proxyIds.add(row.proxy_id);
  }
  if (proxyIds.size === 0) return [];
  const proxyJson = JSON.stringify([...proxyIds]);
  const proxyRows = cachedStmt(db, `SELECT ${identityColumns}, s.complete, s.proxy_id FROM trace_identity_sources s
    JOIN trace_identities i ON i.source_id=s.id WHERE s.proxy_id IN (SELECT value FROM json_each(?)) AND i.kind='session' AND i.scope IS NULL`).all(proxyJson) as Row[];
  const scanRows = cachedStmt(db, SESSION_IDENTITY_SQL).all(JSON.stringify(nativeKeys(proxyRows))) as Row[];
  const scans = scanRows.filter(row => row.session_key !== null);
  const sourceIds = [...new Set([...proxyRows, ...scans].map(row => row.source_id as string))];
  const counts = cachedStmt(db, "SELECT source_id, COUNT(*) AS count FROM trace_identities WHERE source_id IN (SELECT value FROM json_each(?)) AND kind='session' AND scope IS NULL AND namespace LIKE 'agent:%' GROUP BY source_id").all(JSON.stringify(sourceIds)) as Array<{ source_id: string; count: number }>;
  const countBySource = new Map(counts.map(row => [row.source_id, row.count]));
  const byNative = new Map<string, Row[]>();
  for (const row of scans) {
    const key = JSON.stringify([row.namespace, row.value]);
    const values = byNative.get(key) ?? [];
    values.push(row); byNative.set(key, values);
  }
  const existing = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_COLS} FROM trace_associations WHERE proxy_id IN (SELECT value FROM json_each(?))`).all(proxyJson) as Row[];
  const existingById = new Map(existing.map(row => [row.id as string, row]));
  const previousEvidence = evidenceMap(db, existing.map(row => row.id as string));
  const desired = new Map<string, { sessionKey: string; proxyId: number; state: 'direct' | 'candidate'; reason: string; evidence: string[] }>();
  const automaticOwners = new Map<number, Set<string>>();
  for (const row of existing) if (row.state === 'direct' || row.state === 'candidate') {
    const set = automaticOwners.get(row.proxy_id as number) ?? new Set<string>();
    set.add(row.session_key as string); automaticOwners.set(row.proxy_id as number, set);
  }
  const candidateCounts = new Map<number, number>();
  for (const proxy of proxyRows) {
    if (!namespaceKnown(proxy.namespace as string)) continue;
    const candidates = byNative.get(JSON.stringify([proxy.namespace, proxy.value])) ?? [];
    const previousOwners = automaticOwners.get(proxy.proxy_id as number);
    const ordered = [...candidates.filter(scan => previousOwners?.has(scan.session_key as string)), ...candidates.filter(scan => !previousOwners?.has(scan.session_key as string))];
    for (const scan of ordered) {
      const sessionKey = scan.session_key as string; const proxyId = proxy.proxy_id as number;
      const id = associationId(sessionKey, proxyId);
      if (!desired.has(id)) {
        if ((candidateCounts.get(proxyId) ?? 0) >= 32) continue;
        candidateCounts.set(proxyId, (candidateCounts.get(proxyId) ?? 0) + 1);
      }
      const complete = scan.complete === 1 && proxy.complete === 1;
      const direct = complete && candidates.length === 1 && countBySource.get(scan.source_id as string) === 1 && countBySource.get(proxy.source_id as string) === 1;
      const value = desired.get(id);
      const evidence = [...new Set([...(value?.evidence ?? []), proxy.id as string, scan.id as string])].slice(0, 8);
      desired.set(id, { sessionKey, proxyId, state: direct ? 'direct' : 'candidate',
        reason: !complete ? 'identity_collection_incomplete' : direct ? 'exact_native_session_id' : 'ambiguous_native_session_id', evidence });
    }
  }
  const affected = new Set<string>();
  const insert = cachedStmt(db, INSERT_ASSOC_SQL); const update = cachedStmt(db, UPDATE_ASSOC_SQL);
  const remove = cachedStmt(db, "DELETE FROM trace_associations WHERE id=? AND state IN ('direct','candidate')");
  for (const [id, value] of desired) {
    const old = existingById.get(id);
    if (old !== undefined && old.state !== 'direct' && old.state !== 'candidate') continue;
    if (old === undefined) { insert.run(id, value.sessionKey, value.proxyId, value.state, value.reason, now, now); affected.add(value.sessionKey); }
    else if (old.state !== value.state || old.reason !== value.reason) { update.run(value.state, value.reason, now, id); affected.add(value.sessionKey); }
    replaceEvidence(db, id, previousEvidence.get(id) ?? [], value.evidence);
  }
  for (const row of existing) if ((row.state === 'direct' || row.state === 'candidate') && !desired.has(row.id as string)) {
    remove.run(row.id); affected.add(row.session_key as string);
  }
  return [...affected];
}

/** Snapshot/identity/automatic association writes are one atomic differential transaction. */
export function writeNativeIdentities(db: Database, owner: IdentityOwner, bundle: NativeIdentitySet, updatedAt: string): string[] {
  assertIdentityOwner(db, owner);
  if (!Number.isSafeInteger(bundle.parserVersion) || bundle.parserVersion < 1 || bundle.items.length > (owner.source === 'scan' ? 50_000 : 2048)) bad('Invalid identity snapshot');
  const normalized = new Map<string, NativeIdentity>();
  for (const item of bundle.items) {
    const value: NativeIdentity = { namespace: item.namespace, kind: item.kind, value: item.value, scope: item.scope ?? null, eventId: item.eventId ?? null, sourcePath: item.sourcePath };
    if (!NATIVE_KINDS.has(value.kind) || !value.namespace || value.namespace.length > 128 || !value.value || value.value.length > 1024 || (value.scope?.length ?? 0) > 1024 || !value.sourcePath || value.sourcePath.length > 512 || (owner.source === 'proxy' && value.eventId !== null)) bad('Invalid native identity');
    normalized.set(hash([sourceId(owner), value.namespace, value.kind, value.value, value.scope, value.eventId, value.sourcePath]), value);
  }
  const entries = [...normalized.entries()].sort(([left], [right]) => left.localeCompare(right));
  const digest = hash([bundle.parserVersion, entries, bundle.completeness]);
  const id = sourceId(owner);
  const oldSource = cachedStmt(db, `SELECT ${TRACE_IDENTITY_SOURCE_COLS} FROM trace_identity_sources WHERE id=?`).get(id) as Row | undefined;
  if (oldSource?.content_sha256 === digest) return [];
  const now = new Date(updatedAt).toISOString();
  return db.transaction(() => {
    const oldRows = cachedStmt(db, SOURCE_IDENTITIES_SQL).all(id) as Row[];
    cachedStmt(db, `INSERT INTO trace_identity_sources (id, session_key, proxy_id, parser_version, complete, omitted_count, reasons_json, content_sha256, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET parser_version=excluded.parser_version, complete=excluded.complete,
      omitted_count=excluded.omitted_count, reasons_json=excluded.reasons_json, content_sha256=excluded.content_sha256, updated_at=excluded.updated_at`).run(
      id, owner.source === 'scan' ? owner.key : null, owner.source === 'proxy' ? Number(owner.key) : null, bundle.parserVersion,
      bundle.completeness.complete ? 1 : 0, bundle.completeness.omittedCount, JSON.stringify(bundle.completeness.reasons), digest, now);
    const insert = cachedStmt(db, 'INSERT OR IGNORE INTO trace_identities (id, source_id, namespace, kind, value, scope, event_id, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const remove = cachedStmt(db, 'DELETE FROM trace_identities WHERE id=?');
    const previous = new Set(oldRows.map(row => row.id as string));
    for (const [key, value] of entries) if (!previous.has(key)) insert.run(key, id, value.namespace, value.kind, value.value, value.scope, value.eventId, value.sourcePath);
    for (const row of oldRows) if (!normalized.has(row.id as string)) remove.run(row.id);
    return reconcile(db, owner, [...nativeKeys(oldRows), ...nativeKeys(entries.map(([key, value]) => ({ id: key, ...value })))], now);
  })();
}

export function listTraceIdentities(db: Database, owner: IdentityOwner, options: { limit?: number; cursor?: string } = {}): TraceIdentityPage {
  assertIdentityOwner(db, owner);
  const limit = pageLimit(options.limit); const id = sourceId(owner);
  if (options.cursor !== undefined && !/^[0-9a-f]{64}$/.test(options.cursor)) bad('Invalid identity cursor');
  const source = cachedStmt(db, `SELECT ${sourceColumns} FROM trace_identity_sources s WHERE s.id=?`).get(id) as Row | undefined;
  if (source === undefined) return { source: owner.source, sourceKey: owner.key, parserVersion: null, items: [], completeness: { complete: false, omittedCount: 0, reasons: ['not_collected'] }, nextCursor: null, hasMore: false };
  const rows = cachedStmt(db, `SELECT ${TRACE_IDENTITY_COLS} FROM trace_identities WHERE source_id=? AND id>? ORDER BY id LIMIT ?`).all(id, options.cursor ?? '', limit + 1) as Row[];
  const completeness = { complete: source.complete === 1, omittedCount: source.omitted_count as number, reasons: JSON.parse(source.reasons_json as string) as string[] };
  const page: Row[] = [];
  const mapped: TraceIdentityPage['items'] = [];
  let bytes = Buffer.byteLength(JSON.stringify(completeness)) + Buffer.byteLength(owner.key) + 512;
  for (const row of rows.slice(0, limit)) {
    const item = { id: row.id as string, source: owner.source, sourceKey: owner.key, namespace: row.namespace as string, kind: row.kind as NativeIdentity['kind'], value: row.value as string, scope: row.scope as string | null, eventId: row.event_id as string | null, sourcePath: row.source_path as string };
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes + size > 499_000) break;
    page.push(row); mapped.push(item); bytes += size;
  }
  const hasMore = rows.length > page.length;
  return { source: owner.source, sourceKey: owner.key, parserVersion: source.parser_version as number,
    items: mapped, completeness, hasMore, nextCursor: hasMore ? page.at(-1)!.id as string : null };
}

export function listSessionCaptureLinks(db: Database, sessionKey: string, options: { limit?: number; cursor?: number } = {}): SessionCaptureLinkPage {
  assertIdentityOwner(db, { source: 'scan', key: sessionKey });
  const limit = pageLimit(options.limit);
  if (options.cursor !== undefined && (!Number.isSafeInteger(options.cursor) || options.cursor <= 0)) bad('Invalid capture cursor');
  const rows = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_COLS} FROM trace_associations WHERE session_key=? AND proxy_id<? AND state IN ('direct','confirmed','candidate') ORDER BY proxy_id DESC LIMIT ?`).all(sessionKey, options.cursor ?? Number.MAX_SAFE_INTEGER, limit + 1) as Row[];
  const counts = cachedStmt(db, "SELECT SUM(CASE WHEN state IN ('direct','confirmed') THEN 1 ELSE 0 END) AS confirmed, SUM(CASE WHEN state='candidate' THEN 1 ELSE 0 END) AS candidate FROM trace_associations WHERE session_key=?").get(sessionKey) as { confirmed: number | null; candidate: number | null };
  const page = rows.slice(0, limit); const evidence = evidenceMap(db, page.map(row => row.id as string));
  const requests = new Map(getProxyRequestListItemsByIds(db, page.map(row => row.proxy_id as number)).map(request => [request.id, request]));
  return { sessionKey, items: page.map(row => ({ association: association(row, evidence), request: requests.get(row.proxy_id as number)! })),
    confirmedCount: counts.confirmed ?? 0, candidateCount: counts.candidate ?? 0, nextCursor: rows.length > limit ? page.at(-1)!.proxy_id as number : null, hasMore: rows.length > limit };
}

export function listProxyTraceLinks(db: Database, proxyId: number, options: { limit?: number; cursor?: string } = {}): ProxyTraceLinkPage {
  assertIdentityOwner(db, { source: 'proxy', key: String(proxyId) });
  const limit = pageLimit(options.limit);
  if (options.cursor !== undefined && (options.cursor.length === 0 || options.cursor.length > 1024)) bad('Invalid session cursor');
  const rows = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_COLS} FROM trace_associations WHERE proxy_id=? AND session_key>? ORDER BY session_key LIMIT ?`).all(proxyId, options.cursor ?? '', limit + 1) as Row[];
  const page = rows.slice(0, limit); const evidence = evidenceMap(db, page.map(row => row.id as string));
  return { proxyId, items: page.map(row => association(row, evidence)), nextCursor: rows.length > limit ? page.at(-1)!.session_key as string : null, hasMore: rows.length > limit };
}

export function decideTraceAssociation(db: Database, proxyId: number, sessionKey: string, state: TraceAssociationDecision['state'], note: string | null = null): TraceAssociation {
  assertIdentityOwner(db, { source: 'proxy', key: String(proxyId) });
  assertIdentityOwner(db, { source: 'scan', key: sessionKey });
  if (!['confirmed', 'rejected', 'revoked'].includes(state) || (note !== null && (typeof note !== 'string' || note.length > 1000))) bad('Invalid association decision');
  const id = associationId(sessionKey, proxyId);
  return db.transaction(() => {
    const old = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_COLS} FROM trace_associations WHERE id=?`).get(id) as Row | undefined;
    const latest = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_DECISION_COLS} FROM trace_association_decisions WHERE association_id=? ORDER BY sequence DESC LIMIT 1`).get(id) as Row | undefined;
    if (old !== undefined && old.state === state && latest?.note === note) return association(old, evidenceMap(db, [id]));
    const now = new Date().toISOString(); const reason = 'user_' + state;
    if (old === undefined) cachedStmt(db, INSERT_ASSOC_SQL).run(id, sessionKey, proxyId, state, reason, now, now);
    else cachedStmt(db, UPDATE_ASSOC_SQL).run(state, reason, now, id);
    cachedStmt(db, 'INSERT INTO trace_association_decisions (association_id, state, note, decided_at) VALUES (?, ?, ?, ?)').run(id, state, note ?? null, now);
    const row = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_COLS} FROM trace_associations WHERE id=?`).get(id) as Row;
    return association(row, evidenceMap(db, [id]));
  })();
}

export function listTraceDecisions(db: Database, proxyId: number, sessionKey: string, options: { limit?: number; cursor?: number } = {}): { items: TraceAssociationDecision[]; nextCursor: number | null; hasMore: boolean } {
  assertIdentityOwner(db, { source: 'proxy', key: String(proxyId) });
  assertIdentityOwner(db, { source: 'scan', key: sessionKey });
  const limit = pageLimit(options.limit);
  if (options.cursor !== undefined && (!Number.isSafeInteger(options.cursor) || options.cursor < 0)) bad('Invalid decision cursor');
  const rows = cachedStmt(db, `SELECT ${TRACE_ASSOCIATION_DECISION_COLS} FROM trace_association_decisions WHERE association_id=? AND sequence>? ORDER BY sequence LIMIT ?`).all(associationId(sessionKey, proxyId), options.cursor ?? 0, limit + 1) as Row[];
  const page = rows.slice(0, limit);
  return { items: page.map(row => ({ sequence: row.sequence as number, associationId: row.association_id as string, state: row.state as TraceAssociationDecision['state'], note: row.note as string | null, decidedAt: row.decided_at as string })), nextCursor: rows.length > limit ? page.at(-1)!.sequence as number : null, hasMore: rows.length > limit };
}
