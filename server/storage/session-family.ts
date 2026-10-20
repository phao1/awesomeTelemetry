import type { Database } from 'better-sqlite3';
import type { NativeSessionFamilyPage, TraceSourceIdentity } from '../../src/core/trace-types.js';
import { TRACE_IDENTITY_COLS } from './columns.js';
import { getNativeSessionParents } from './native-session-parents.js';
import { cachedStmt } from './stmt-cache.js';
import { TraceLinkError } from './trace-links.js';
import { LinkedExecutionLimitError } from './linked-execution.js';

type Row = Record<string, unknown>;
type Metadata = NativeSessionFamilyPage['session'];
const SESSION_META = 'id, provider, source_agent, title, started_at';
const identityColumns = TRACE_IDENTITY_COLS.split(', ').map(column => 'i.' + column).join(', ');
export const FAMILY_CHILDREN_SQL = `SELECT DISTINCT p.id, p.provider, p.source_agent, p.title, p.started_at
  FROM trace_identities i INDEXED BY idx_trace_identities_parent
  JOIN trace_identity_sources s ON s.id=i.source_id
  JOIN sessions p ON p.id=s.session_key AND p.data_source='scan'
  WHERE i.kind='parent_session' AND i.namespace=? AND i.value=? AND p.id<>? AND p.id>?
  ORDER BY p.id LIMIT ?`;
const meta = (row: Row): Metadata => ({ id: row.id as string, provider: row.provider as Metadata['provider'],
  sourceAgent: row.source_agent as string, title: row.title as string, startedAt: row.started_at as string });

/** One-hop declared family, fixed-count metadata reads; no source/body IO. */
export function getNativeSessionFamily(db: Database, sessionKey: string, options: { limit?: number; cursor?: string } = {}): NativeSessionFamilyPage {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (options.cursor !== undefined &&
    (options.cursor.length === 0 || options.cursor.length > 512 || Array.from(options.cursor).some(character => character.charCodeAt(0) < 32)))) {
    throw new TraceLinkError('BAD_REQUEST', 'Invalid session family pagination');
  }
  return db.transaction(() => {
    const current = cachedStmt(db, `SELECT ${SESSION_META} FROM sessions WHERE id=? AND data_source='scan'`).get(sessionKey) as Row | undefined;
    if (current === undefined) throw new TraceLinkError('SESSION_NOT_FOUND', 'Scan session not found');
    const parents = getNativeSessionParents(db, sessionKey);
    const result: NativeSessionFamilyPage = { session: meta(current), parents, children: [], nextCursor: null, hasMore: false,
      completeness: { ...parents.completeness, reasons: [...parents.completeness.reasons] } };
    const omit = (reason: string): void => {
      result.completeness.complete = false; result.completeness.omittedCount += 1;
      if (!result.completeness.reasons.includes(reason)) result.completeness.reasons.push(reason);
    };
    const nativeRows = cachedStmt(db, `SELECT namespace, value FROM trace_identities INDEXED BY idx_trace_identities_source
      WHERE source_id=? AND kind='session' AND scope IS NULL AND namespace LIKE 'agent:%' LIMIT 1001`).all('scan:' + sessionKey) as Array<{ namespace: string; value: string }>;
    const nativeKeys = new Map(nativeRows.map(row => [JSON.stringify([row.namespace, row.value]), row]));
    if (nativeRows.length > 1000 || nativeKeys.size !== 1) {
      omit(nativeRows.length > 1000 ? 'native_session_limit' : nativeKeys.size === 0 ? 'native_session_unavailable' : 'native_session_ambiguous');
    } else {
      const native = [...nativeKeys.values()][0]!;
      const owners = cachedStmt(db, `SELECT COUNT(DISTINCT s.session_key) AS owners
        FROM trace_identities i INDEXED BY idx_trace_identities_native JOIN trace_identity_sources s ON s.id=i.source_id
        WHERE i.kind='session' AND i.scope IS NULL AND i.namespace=? AND i.value=? AND s.session_key IS NOT NULL`)
        .get(native.namespace, native.value) as { owners: number };
      const rows = cachedStmt(db, FAMILY_CHILDREN_SQL).all(native.namespace, native.value, sessionKey, options.cursor ?? '', limit + 1) as Row[];
      const page = rows.slice(0, limit);
      const sourceIds = ['scan:' + sessionKey, ...page.map(row => 'scan:' + row.id)];
      const stats = cachedStmt(db, `SELECT s.id, s.complete,
        COUNT(DISTINCT CASE WHEN i.kind='session' AND i.scope IS NULL AND i.namespace LIKE 'agent:%' THEN json_array(i.namespace,i.value) END) AS native_count,
        MIN(CASE WHEN i.kind='session' AND i.scope IS NULL AND i.namespace LIKE 'agent:%' THEN i.namespace END) AS native_namespace,
        MIN(CASE WHEN i.kind='session' AND i.scope IS NULL AND i.namespace LIKE 'agent:%' THEN i.value END) AS native_value
        FROM trace_identity_sources s LEFT JOIN trace_identities i ON i.source_id=s.id
        WHERE s.id IN (SELECT value FROM json_each(?)) GROUP BY s.id`).all(JSON.stringify(sourceIds)) as Row[];
      const bySource = new Map(stats.map(row => [row.id as string, row]));
      const refs = cachedStmt(db, `WITH ranked AS (
        SELECT ${identityColumns}, ROW_NUMBER() OVER(PARTITION BY i.source_id ORDER BY i.id) AS reference_rank
        FROM trace_identities i INDEXED BY idx_trace_identities_source
        WHERE i.source_id IN (SELECT value FROM json_each(?)) AND i.kind='parent_session' AND i.namespace=? AND i.value=?
      ) SELECT ${TRACE_IDENTITY_COLS} FROM ranked WHERE reference_rank=1`)
        .all(JSON.stringify(page.map(row => 'scan:' + row.id)), native.namespace, native.value) as Row[];
      const byChild = new Map(refs.map(row => [row.source_id as string, row]));
      const ownerComplete = bySource.get('scan:' + sessionKey)?.complete === 1;
      if (!ownerComplete) omit('parent_source_incomplete');
      if (owners.owners !== 1) omit('parent_owner_ambiguous');
      for (const row of page) {
        const sourceId = 'scan:' + row.id;
        const ref = byChild.get(sourceId)!;
        const child = bySource.get(sourceId);
        const identity: TraceSourceIdentity = { id: ref.id as string, source: 'scan', sourceKey: row.id as string,
          namespace: ref.namespace as string, kind: 'parent_session', value: ref.value as string,
          scope: ref.scope as string | null, eventId: ref.event_id as string | null, sourcePath: ref.source_path as string };
        let state: NativeSessionFamilyPage['children'][number]['state'] = 'resolved';
        if (!ownerComplete || child?.complete !== 1 || child.native_count !== 1 || child.native_namespace !== identity.namespace ||
          !identity.scope || child.native_value !== identity.scope) state = 'incomplete';
        else if (identity.scope === identity.value) state = 'unresolved';
        else if (owners.owners !== 1) state = 'ambiguous';
        if (state !== 'resolved') omit('child_relation_' + state);
        result.children.push({ session: meta(row), identity, state });
      }
      result.hasMore = rows.length > page.length;
      result.nextCursor = result.hasMore ? result.children.at(-1)!.session.id : null;
    }
    while (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) {
      if (result.children.length <= 1) throw new LinkedExecutionLimitError();
      result.children.pop(); result.hasMore = true; result.nextCursor = result.children.at(-1)!.session.id; omit('response_budget');
    }
    return result;
  })();
}
