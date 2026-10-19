import type { Database } from 'better-sqlite3';
import type { CodexCallSummary, CodexNativeLink } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import { TRACE_IDENTITY_COLS } from '../storage/columns.js';

/** Three bounded cached queries, not one event-body lookup per tool. */
export function nativeCodexLink(db: Database, call: CodexCallSummary, proxyId?: number): CodexNativeLink {
  const missing: CodexNativeLink = { state: 'missing', sessionKey: null, matches: [] };
  if (call.nativeSessionId === null) return missing;
  // Query only scan owners: proxy manifests must not crowd an owner off this bound.
  const owners = cachedStmt(db, `SELECT DISTINCT s.session_key,s.complete,
    (SELECT a.state FROM trace_associations a WHERE a.session_key=s.session_key AND a.proxy_id=?) AS decision
    FROM trace_identities i INDEXED BY idx_trace_identities_native
    JOIN trace_identity_sources s ON s.id=i.source_id
    WHERE i.namespace='agent:codex' AND i.kind='session' AND i.scope IS NULL AND i.value=? AND s.session_key IS NOT NULL LIMIT 3`).all(proxyId ?? null, call.nativeSessionId) as Array<{ session_key: string; complete: number; decision: string | null }>;
  if (owners.length === 0) return missing;
  if (owners.some(row => row.decision === 'rejected' || row.decision === 'revoked')) return { ...missing, state: 'blocked' };
  const keys = new Set(owners.map(row => row.session_key));
  if (keys.size !== 1 || owners.length === 3) return { ...missing, state: 'ambiguous' };
  const sessionKey = owners[0]!.session_key;
  if (owners.some(row => !row.complete)) return { ...missing, state: 'incomplete' };
  const identities = cachedStmt(db, `SELECT ${TRACE_IDENTITY_COLS} FROM trace_identities WHERE source_id=? LIMIT 2049`).all('scan:' + sessionKey) as Array<{
    namespace: string; kind: string; value: string; scope: string | null; event_id: string | null; source_path: string;
  }>;
  if (identities.length > 2048) return { ...missing, state: 'incomplete' };
  const sessions = new Set(identities.filter(row => row.kind === 'session' && row.scope === null && row.namespace.startsWith('agent:')).map(row => row.namespace + ':' + row.value));
  if (sessions.size !== 1 || !sessions.has('agent:codex:' + call.nativeSessionId)) return { ...missing, state: 'ambiguous' };
  const tools = new Set([...call.proposedToolIds, ...call.returnedToolIds]);
  const matches = identities.filter(row => row.scope === call.nativeSessionId && row.event_id !== null &&
    (row.namespace === 'protocol:openai' && (row.kind === 'tool_call' && tools.has(row.value) || row.kind === 'response' && row.value === call.responseId)
      || row.namespace === 'agent:codex' && row.kind === 'turn' && row.value === call.nativeTurnId));
  const retained = new Set((cachedStmt(db, 'SELECT id FROM events WHERE session_id=? AND id IN (SELECT value FROM json_each(?))')
    .all(sessionKey, JSON.stringify([...new Set(matches.map(row => row.event_id))])) as Array<{ id: string }>).map(row => row.id));
  return { state: 'linked', sessionKey, matches: matches.filter(row => retained.has(row.event_id!)).map(row => ({ eventId: row.event_id!, kind: row.kind as 'response' | 'tool_call' | 'turn', value: row.value, sourcePath: row.source_path })) };
}
