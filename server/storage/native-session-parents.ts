import type { Database } from 'better-sqlite3';
import type { NativeSessionParentPage, TraceSourceIdentity } from '../../src/core/trace-types.js';
import { TRACE_IDENTITY_COLS, TRACE_IDENTITY_SOURCE_COLS } from './columns.js';
import { LinkedExecutionLimitError } from './linked-execution.js';
import { cachedStmt } from './stmt-cache.js';
import { assertIdentityOwner, TraceLinkError } from './trace-links.js';

type Row = Record<string, unknown>;
export const NATIVE_PARENT_MATCH_SQL = `WITH owners AS (
  SELECT DISTINCT k.key AS key_index, i.namespace, i.value, s.id AS source_id,
    s.session_key, s.complete AS source_complete, p.id, p.provider, p.source_agent, p.title, p.started_at
  FROM json_each(?) k CROSS JOIN trace_identities i INDEXED BY idx_trace_identities_native
  JOIN trace_identity_sources s ON s.id=i.source_id
  JOIN sessions p ON p.id=s.session_key AND p.data_source='scan'
  WHERE i.namespace=json_extract(k.value,'$[0]') AND i.value=json_extract(k.value,'$[1]')
    AND i.kind='session' AND i.scope IS NULL
), ranked AS (
  SELECT key_index, namespace, value, source_id, session_key, source_complete, id, provider, source_agent, title, started_at,
    ROW_NUMBER() OVER (PARTITION BY key_index ORDER BY session_key) AS owner_rank,
    COUNT(*) OVER (PARTITION BY key_index) AS owner_count FROM owners
) SELECT key_index, namespace, value, source_id, session_key, source_complete, id, provider, source_agent, title, started_at, owner_count
  FROM ranked WHERE owner_rank<=20 ORDER BY key_index, owner_rank`;

/** First-level declared parent/fork evidence only, never inferred runtime topology. */
export function getNativeSessionParents(db: Database, sessionKey: string, options: { limit?: number; cursor?: string } = {}): NativeSessionParentPage {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (options.cursor !== undefined && !/^[0-9a-f]{64}$/.test(options.cursor))) {
    throw new TraceLinkError('BAD_REQUEST', 'Invalid native parent pagination');
  }
  return db.transaction(() => {
    assertIdentityOwner(db, { source: 'scan', key: sessionKey });
    const sourceId = 'scan:' + sessionKey;
    const source = cachedStmt(db, `SELECT ${TRACE_IDENTITY_SOURCE_COLS} FROM trace_identity_sources WHERE id=?`).get(sourceId) as Row | undefined;
    const rows = cachedStmt(db, `SELECT ${TRACE_IDENTITY_COLS} FROM trace_identities INDEXED BY idx_trace_identities_source
      WHERE source_id=? AND kind='parent_session' AND id>? ORDER BY id LIMIT ?`).all(sourceId, options.cursor ?? '', limit + 1) as Row[];
    const page = rows.slice(0, limit);
    const keys: Array<[string, string]> = [];
    const keyIndexes = new Map<string, number>();
    for (const row of page) {
      const key: [string, string] = [row.namespace as string, row.value as string];
      const encoded = JSON.stringify(key);
      if (!keyIndexes.has(encoded)) { keyIndexes.set(encoded, keys.length); keys.push(key); }
    }
    const candidates = cachedStmt(db, NATIVE_PARENT_MATCH_SQL).all(JSON.stringify(keys)) as Row[];
    const candidateSources = [...new Set([sourceId, ...candidates.map(row => row.source_id as string)])];
    const nativeRows = cachedStmt(db, `SELECT source_id, namespace, value FROM trace_identities INDEXED BY idx_trace_identities_source
      WHERE source_id IN (SELECT value FROM json_each(?)) AND kind='session' AND scope IS NULL`).all(JSON.stringify(candidateSources)) as Array<{ source_id: string; namespace: string; value: string }>;
    const nativeSessions = new Map<string, Set<string>>();
    for (const row of nativeRows) {
      const key = JSON.stringify([row.source_id, row.namespace]); const values = nativeSessions.get(key) ?? new Set<string>();
      values.add(row.value); nativeSessions.set(key, values);
    }
    const byKey = new Map<number, Row[]>();
    for (const row of candidates) { const index = Number(row.key_index); const group = byKey.get(index) ?? []; group.push(row); byKey.set(index, group); }
    const result: NativeSessionParentPage = { sessionKey, items: [], nextCursor: rows.length > page.length ? page.at(-1)!.id as string : null,
      hasMore: rows.length > page.length, completeness: { complete: true, omittedCount: 0, reasons: [] } };
    const omit = (reason: string, count = 1): void => {
      result.completeness.complete = false; result.completeness.omittedCount += count;
      if (!result.completeness.reasons.includes(reason)) result.completeness.reasons.push(reason);
    };
    if (source === undefined) omit('identity_not_collected');
    else if (source.complete !== 1) {
      omit('identity_collection_incomplete', Math.max(1, source.omitted_count as number));
      for (const reason of JSON.parse(source.reasons_json as string) as string[]) if (!result.completeness.reasons.includes(reason)) result.completeness.reasons.push(reason);
    }
    let responseBytes = Buffer.byteLength(JSON.stringify(result));
    for (const row of page) {
      const identity: TraceSourceIdentity = { id: row.id as string, source: 'scan', sourceKey: sessionKey, namespace: row.namespace as string,
        kind: 'parent_session', value: row.value as string, scope: row.scope as string | null, eventId: row.event_id as string | null, sourcePath: row.source_path as string };
      const key = keyIndexes.get(JSON.stringify([identity.namespace, identity.value]))!;
      const owners = byKey.get(key) ?? [];
      const count = Number(owners[0]?.owner_count ?? 0);
      const ownSessions = nativeSessions.get(JSON.stringify([sourceId, identity.namespace]));
      const ownScopeValid = ownSessions?.size === 1 && identity.scope !== null && identity.scope !== '' && ownSessions.has(identity.scope);
      let state: NativeSessionParentPage['items'][number]['state'];
      if (source?.complete !== 1 || !ownScopeValid) { state = 'incomplete'; omit('owner_scope_incomplete'); }
      else if (identity.value === identity.scope || owners.some(owner => owner.session_key === sessionKey)) { state = 'unresolved'; omit('self_reference'); }
      else if (count > 1) { state = 'ambiguous'; omit('ambiguous_parent_owner'); }
      else if (count === 0) { state = 'unresolved'; omit('parent_owner_not_found'); }
      else {
        const owner = owners[0]!;
        const ownerNative = nativeSessions.get(JSON.stringify([owner.source_id, identity.namespace]));
        if (owner.source_complete !== 1 || ownerNative?.size !== 1 || !ownerNative.has(identity.value)) { state = 'incomplete'; omit('parent_owner_incomplete'); }
        else state = 'resolved';
      }
      const matchesTruncated = count > owners.length;
      if (matchesTruncated) omit('parent_matches_limit', count - owners.length);
      const item: NativeSessionParentPage['items'][number] = { identity, state, matches: owners.map(owner => ({ id: owner.id as string, provider: owner.provider as NativeSessionParentPage['items'][number]['matches'][number]['provider'],
        sourceAgent: owner.source_agent as string, title: owner.title as string, startedAt: owner.started_at as string })), matchesTruncated };
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (responseBytes + size > 512 * 1024 - 1024) {
        if (result.items.length === 0) throw new LinkedExecutionLimitError();
        result.hasMore = true; result.nextCursor = result.items.at(-1)!.identity.id;
        omit('response_budget', page.length - result.items.length); break;
      }
      result.items.push(item); responseBytes += size;
    }
    // Whole references remain intact; advancing from the last returned identity
    // preserves byte-reduced pagination without clipping opaque native values.
    if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw new LinkedExecutionLimitError();
    return result;
  })();
}
