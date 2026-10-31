import type { Database } from 'better-sqlite3';
import type { CaptureBodyRef } from '../../src/core/trace-types.js';

export interface CodexSource {
  proxyId?: number;
  hostname?: string;
  requestId: string;
  startedAt: string;
  active: boolean;
  directory: string;
  headers: Record<string, string | string[]>;
  request: CaptureBodyRef;
  response: CaptureBodyRef;
}
const sources = new WeakMap<Database, Map<string, () => CodexSource>>();
export function registerCodexSource(db: Database, id: string, read: () => CodexSource): () => void {
  let entries = sources.get(db);
  if (entries === undefined) { entries = new Map(); sources.set(db, entries); }
  if (!entries.has(id) && entries.size >= 64) return () => {};
  entries.set(id, read);
  return () => { if (entries.get(id) === read) entries.delete(id); };
}
export function liveCodexSource(db: Database, id: string): CodexSource | null { return sources.get(db)?.get(id)?.() ?? null; }
export function liveCodexInventory(db: Database): { items: Array<{ requestId: string; hostname: string; startedAt: string; ended: false }> } {
  return { items: [...(sources.get(db)?.values() ?? [])].map(read => {
    const source = read(); return { requestId: source.requestId, hostname: (source.hostname ?? 'unknown').slice(0, 255), startedAt: source.startedAt, ended: false };
  }) };
}

export function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && ![...value].some(char => char.charCodeAt(0) < 32) ? value : null;
}
function metadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 8192) return null;
  try { return object(JSON.parse(value) as unknown); } catch { return null; }
}
/** Codex's explicit client fields only; never URL, model, time or handshake turn. */
export function codexIdentity(headers: CodexSource['headers'], request: Record<string, unknown>): { sessionId: string | null; turnId: string | null; conflict: boolean } {
  const header = (name: string): unknown => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  const client = object(request.client_metadata);
  const hm = metadata(header('x-codex-turn-metadata')), cm = metadata(client?.['x-codex-turn-metadata']);
  if (hm === null && cm === null) return { sessionId: null, turnId: null, conflict: false };
  const ids = [header('session-id'), header('thread-id'), hm?.session_id, hm?.thread_id, client?.session_id, client?.thread_id, cm?.session_id, cm?.thread_id];
  const supplied = ids.filter(value => value !== undefined && value !== null && value !== '');
  const valid = supplied.map(identifier), unique = new Set(valid);
  const conflict = valid.some(value => value === null) || unique.size > 1;
  const turns = [client?.turn_id, cm?.turn_id].filter(value => value !== undefined && value !== null && value !== '').map(identifier);
  return { sessionId: !conflict && unique.size === 1 ? valid[0]! : null,
    turnId: !conflict && turns.length > 0 && turns.every(value => value !== null && value === turns[0]) ? turns[0]! : null, conflict };
}
