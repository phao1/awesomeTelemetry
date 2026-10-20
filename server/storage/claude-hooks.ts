import type { Database } from 'better-sqlite3';
import { CLAUDE_HOOK_EVENTS } from '../../src/core/claude-hooks.js';
import type { ClaudeHookEvent, ClaudeHookSummary } from '../../src/core/claude-hooks.js';
import type { CaptureBodyRef } from '../../src/core/trace-types.js';
import { CLAUDE_HOOK_DETAIL_COLS, CLAUDE_HOOK_LIST_COLS } from './columns.js';
import { cachedStmt } from './stmt-cache.js';
import { ClaudeHookError } from '../hooks/claude-control.js';

export type HookProjection = Pick<ClaudeHookSummary, 'eventName'|'nativeSessionId'|'agentId'|'agentType'|'toolUseId'|'toolName'|'nativeDurationMs'>;
type Row = { id: number; received_at: string; event_name: ClaudeHookEvent; native_session_id: string; agent_id: string | null; agent_type: string | null;
  tool_use_id: string | null; tool_name: string | null; native_duration_ms: number | null; payload_bytes: number; payload_ref?: string };
export interface HookQuery { limit: number; cursor?: number; sessionId?: string; toolUseId?: string; agentId?: string }
function invalid(): never { throw new ClaudeHookError(400, 'BAD_REQUEST'); }
function text(value: unknown, max: number, empty = false): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || (!empty && value.length === 0) || value.length > max || value.includes('\0')) return invalid();
  return value;
}
export function projectClaudeHook(value: unknown): HookProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>, event = v.hook_event_name;
  if (typeof event !== 'string' || !(CLAUDE_HOOK_EVENTS as readonly string[]).includes(event)) return invalid();
  const eventName = event as ClaudeHookEvent, nativeSessionId = text(v.session_id, 512), agentId = text(v.agent_id, 512), agentType = text(v.agent_type, 512, true);
  if (!nativeSessionId || (eventName === 'SubagentStart' || eventName === 'SubagentStop') && !agentId) return invalid();
  const tool = ['PreToolUse','PostToolUse','PostToolUseFailure'].includes(eventName);
  const toolName = tool ? text(v.tool_name, 128) : null, toolUseId = tool ? text(v.tool_use_id, 512) : null;
  if (tool && !toolName) return invalid();
  let nativeDurationMs: number | null = null;
  if (['PostToolUse','PostToolUseFailure'].includes(eventName) && v.duration_ms !== undefined && v.duration_ms !== null) {
    if (typeof v.duration_ms !== 'number' || !Number.isFinite(v.duration_ms) || v.duration_ms < 0) return invalid();
    nativeDurationMs = v.duration_ms;
  }
  return { eventName, nativeSessionId, agentId, agentType, toolUseId, toolName, nativeDurationMs };
}
export function hookTotals(db: Database): { receivedCount: number; lastReceivedAt: string | null } {
  const row = cachedStmt(db, 'SELECT COUNT(id) AS n, MAX(received_at) AS last FROM claude_hook_events').get() as { n: number; last: string | null };
  return { receivedCount: row.n, lastReceivedAt: row.last };
}
export function insertClaudeHook(db: Database, projection: HookProjection, ref: CaptureBodyRef, receivedAt: string): number {
  return db.transaction(() => {
    if (hookTotals(db).receivedCount >= 10000) throw new ClaudeHookError(503, 'HOOK_LIMIT');
    const result = cachedStmt(db, `INSERT INTO claude_hook_events(received_at,event_name,native_session_id,agent_id,agent_type,tool_use_id,tool_name,native_duration_ms,payload_bytes,payload_ref) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      receivedAt, projection.eventName, projection.nativeSessionId, projection.agentId, projection.agentType, projection.toolUseId, projection.toolName, projection.nativeDurationMs, ref.bytes, JSON.stringify(ref));
    return Number(result.lastInsertRowid);
  })();
}
const OWNERS = `SELECT k.value AS native_id, COUNT(DISTINCT s.session_key) AS owners, MIN(s.session_key) AS session_key, MIN(s.complete) AS complete
  FROM json_each(?) k CROSS JOIN trace_identities i INDEXED BY idx_trace_identities_native
  JOIN trace_identity_sources s ON s.id=i.source_id JOIN sessions n ON n.id=s.session_key
  WHERE i.namespace='agent:claude' AND i.kind='session' AND i.scope IS NULL AND i.value=k.value
  AND n.provider='claude' AND n.data_source='scan' GROUP BY k.value`;
function summaries(db: Database, rows: Row[]): ClaudeHookSummary[] {
  const identities = [...new Set(rows.map(row => row.native_session_id))];
  const owners = identities.length ? cachedStmt(db, OWNERS).all(JSON.stringify(identities)) as Array<{ native_id: string; owners: number; session_key: string; complete: number }> : [];
  const map = new Map(owners.map(owner => [owner.native_id, owner]));
  return rows.map(row => {
    const owner = map.get(row.native_session_id);
    const nativeSessionState = !owner ? 'unresolved' as const : owner.owners > 1 ? 'ambiguous' as const : !owner.complete ? 'manifest_incomplete' as const : 'unique' as const;
    return { id: row.id, receivedAt: row.received_at, eventName: row.event_name, nativeSessionId: row.native_session_id, agentId: row.agent_id, agentType: row.agent_type,
      toolUseId: row.tool_use_id, toolName: row.tool_name, nativeDurationMs: row.native_duration_ms, payloadBytes: row.payload_bytes,
      nativeSessionKey: nativeSessionState === 'unique' ? owner!.session_key : null, nativeSessionState };
  });
}
export function listClaudeHooks(db: Database, query: HookQuery): { items: ClaudeHookSummary[]; hasMore: boolean; nextCursor: number | null } {
  const conditions = ['id < ?'], values: Array<string|number> = [query.cursor ?? Number.MAX_SAFE_INTEGER];
  if (query.sessionId !== undefined) { conditions.push('native_session_id=?'); values.push(query.sessionId); }
  if (query.toolUseId !== undefined) { conditions.push('tool_use_id=?'); values.push(query.toolUseId); }
  if (query.agentId !== undefined) { if (query.agentId === '') conditions.push('agent_id IS NULL'); else { conditions.push('agent_id=?'); values.push(query.agentId); } }
  const rows = cachedStmt(db, `SELECT ${CLAUDE_HOOK_LIST_COLS} FROM claude_hook_events WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...values, query.limit + 1) as Row[];
  const hasMore = rows.length > query.limit, items = summaries(db, rows.slice(0, query.limit));
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null };
}
export function readClaudeHook(db: Database, id: number): { summary: ClaudeHookSummary; ref: CaptureBodyRef } | null {
  const row = cachedStmt(db, `SELECT ${CLAUDE_HOOK_DETAIL_COLS} FROM claude_hook_events WHERE id=?`).get(id) as Row | undefined;
  return row ? { summary: summaries(db, [row])[0]!, ref: JSON.parse(row.payload_ref!) as CaptureBodyRef } : null;
}
