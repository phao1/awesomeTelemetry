import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { normalizeCodexSample } from '../../src/adapters/codex.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { initSchema } from '../storage/schema.js';
import { nativeCodexLink } from './native-links.js';
import type { CodexCallSummary } from '../../src/core/trace-types.js';

const stamp = '2026-10-16T00:00:00.000Z';
const call: CodexCallSummary = { sequence: 0, responseId: 'response-one', previousResponseId: null, predecessorSequence: null,
  streamId: null, model: 'synthetic', warmup: false, nativeSessionId: 'native-one', nativeTurnId: 'turn-one',
  startedAt: stamp, startedMs: 0, firstContentMs: null, durationMs: null, state: 'completed', proposedToolIds: ['tool-one'], returnedToolIds: [],
  reasons: [], usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'openai_subsets' } };
function native(db: InstanceType<typeof Database>, key: string, id = 'native-one'): void {
  const record = normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: [
    { timestamp: stamp, type: 'session_meta', payload: { id } },
    { timestamp: stamp, type: 'turn_context', payload: { turn_id: 'turn-one' } },
    { timestamp: stamp, type: 'response_item', payload: { type: 'function_call', call_id: 'tool-one', name: 'Read', arguments: '{"path":"synthetic"}' } },
    { timestamp: stamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'tool-one', output: 'RAW_TOOL_OUTPUT_SHOULD_NOT_LEAK' } },
  ] }, '/synthetic/' + key);
  storeTraceRecord(db, record, '/synthetic/' + key, key);
}
describe('Codex exact native evidence links', () => {
  it('uses actual adapter-bound scoped tool events in fixed metadata-only queries without writes', () => {
    const log: string[] = [], db = new Database(':memory:', { verbose: sql => log.push(String(sql)) }); initSchema(db);
    try {
      native(db, 'one'); const before = db.prepare('SELECT total_changes() AS n').get(); log.length = 0;
      const result = nativeCodexLink(db, call);
      expect(result).toMatchObject({ state: 'linked', sessionKey: 'one' });
      expect(result.matches.filter(item => item.kind === 'tool_call').map(item => item.eventId)).toEqual(expect.arrayContaining(['tool-one', 'tool-one:3']));
      const reads = log.filter(sql => sql.startsWith('SELECT')); expect(reads.length).toBeLessThanOrEqual(3);
      expect(reads.join('\n')).not.toMatch(/SELECT\s+\*|\b(?:raw|input_summary|output_summary|request_body|response_body)\b/);
      expect(JSON.stringify(result)).not.toContain('RAW_TOOL_OUTPUT');
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    } finally { db.close(); }
  });
  it('does not guess owners from model/time and blocks ambiguous or incomplete native sources', () => {
    const db = new Database(':memory:'); initSchema(db);
    try {
      native(db, 'one');
      expect(nativeCodexLink(db, { ...call, nativeSessionId: 'not-found' }).state).toBe('missing');
      db.prepare("UPDATE trace_identity_sources SET complete=0 WHERE session_key='one'").run();
      expect(nativeCodexLink(db, call).state).toBe('incomplete');
      db.prepare("UPDATE trace_identity_sources SET complete=1 WHERE session_key='one'").run(); native(db, 'two');
      expect(nativeCodexLink(db, call)).toEqual({ state: 'ambiguous', sessionKey: null, matches: [] });
    } finally { db.close(); }
  });
});
