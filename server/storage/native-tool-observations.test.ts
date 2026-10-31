import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeCodexSample } from '../../src/adapters/codex.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { initSchema } from './schema.js';
import { writeNativeIdentities } from './trace-links.js';
import { getNativeToolObservations, TOOL_OBSERVATION_EVENTS_SQL } from './native-tool-observations.js';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const stamp = '2026-10-19T00:00:00.000Z';
const query = { namespace: 'protocol:openai', value: 'native-tool-a', scope: 'native-s' };
function fixture(verbose?: (sql: unknown) => void) {
  const db = new Database(':memory:', { verbose }); databases.push(db); db.pragma('foreign_keys=ON'); initSchema(db); return db;
}
function seed(db: Database.Database, key = 's', scope = 'native-s', fillers = 0) {
  const record = normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: [
    { type: 'session_meta', timestamp: stamp, payload: { id: scope, cwd: '/PRIVATE_SOURCE_DO_NOT_LIST' } },
    { type: 'response_item', timestamp: stamp, payload: { type: 'function_call', id: 'input', call_id: 'native-tool-a', name: 'read_file', arguments: 'SECRET_INPUT' } },
    { type: 'response_item', timestamp: '2026-10-19T00:00:01.000Z', payload: { type: 'function_call_output', id: 'output', call_id: 'native-tool-a', output: 'SECRET_OUTPUT' } },
  ] }, 'fixture://' + key);
  if (fillers > 0) {
    const input = record.events[0]!, output = record.events[1]!;
    record.events = [input, ...Array.from({ length: fillers }, (_, index) => ({ ...input, id: 'filler-' + index, kind: 'reasoning' as const, title: 'Synthetic context', tool: null, hasInput: false, hasOutput: false, hasRaw: false, inputSummary: null, outputSummary: null })), output];
    record.events.forEach((event, index) => { event.sequence = index + 1; }); record.session.eventCount = record.events.length;
  }
  storeTraceRecord(db, record, 'fixture://' + key, key); return record;
}

describe('cross-page native tool observations', () => {
  it('looks up exact scoped members across ordinary execution pages with actual sequence cursors', () => {
    const db = fixture(); seed(db, 's', 'native-s', 220);
    const first = getNativeToolObservations(db, 's', { ...query, limit: 1 });
    expect(first).toMatchObject({ state: 'retained_reference', eventTotal: 2, events: [{ id: 'input', sequence: 1 }], hasMore: true, nextCursor: 1 });
    const second = getNativeToolObservations(db, 's', { ...query, cursor: first.nextCursor!, limit: 1 });
    expect(second).toMatchObject({ events: [{ id: 'output', sequence: 222 }], eventTotal: 2, nextCursor: null, hasMore: false });
    expect(second.identities).toHaveLength(1); expect(second.identities[0]).toMatchObject({ eventId: 'output', value: 'native-tool-a', sourceKey: 's' });
  });
  it('does not mix another session or namespace with identical call text', () => {
    const db = fixture(); seed(db); seed(db, 'other', 'other-native');
    expect(getNativeToolObservations(db, 's', query).events.every(event => event.sessionId === 's')).toBe(true);
    expect(getNativeToolObservations(db, 's', { ...query, namespace: 'other' })).toMatchObject({ state: 'unresolved', events: [] });
    expect(getNativeToolObservations(db, 's', { ...query, scope: 'other-native' })).toMatchObject({ state: 'incomplete', events: [] });
  });
  it('sees duplicate native session owners outside any visible page', () => {
    const db = fixture(); seed(db); seed(db, 'duplicate', 'native-s');
    expect(getNativeToolObservations(db, 's', { ...query, limit: 1 }).state).toBe('ambiguous');
  });
  it('retains incomplete manifests and their reasons without resolving a reference', () => {
    const db = fixture(); const record = seed(db);
    writeNativeIdentities(db, { source: 'scan', key: 's' }, { ...record.nativeIdentities!, completeness: { complete: false, omittedCount: 2, reasons: ['source_truncated'] } }, stamp);
    const result = getNativeToolObservations(db, 's', query);
    expect(result.state).toBe('incomplete'); expect(result.completeness.reasons).toContain('source_truncated'); expect(result.events).toHaveLength(2);
  });
  it('detects conflicting turn bindings beyond the selected page', () => {
    const db = fixture(); seed(db);
    db.prepare("UPDATE events SET turn_key='other' WHERE session_id='s' AND id='output'").run();
    const result = getNativeToolObservations(db, 's', { ...query, limit: 1 });
    expect(result.state).toBe('ambiguous'); expect(result.events).toHaveLength(1);
  });
  it('does not choose one of multiple native call IDs bound to a member', () => {
    const db = fixture(); const record = seed(db);
    writeNativeIdentities(db, { source: 'scan', key: 's' }, { ...record.nativeIdentities!, items: [...record.nativeIdentities!.items,
      { namespace: query.namespace, kind: 'tool_call', value: 'conflict', scope: query.scope, eventId: 'output', sourcePath: 'synthetic.conflict' }] }, stamp);
    expect(getNativeToolObservations(db, 's', { ...query, limit: 1 }).state).toBe('ambiguous');
  });
  it('marks missing retained event bindings as incomplete', () => {
    const db = fixture(); const record = seed(db);
    writeNativeIdentities(db, { source: 'scan', key: 's' }, { ...record.nativeIdentities!, items: [...record.nativeIdentities!.items,
      { namespace: query.namespace, kind: 'tool_call', value: query.value, scope: query.scope, eventId: null, sourcePath: 'synthetic.unbound' }] }, stamp);
    expect(getNativeToolObservations(db, 's', query)).toMatchObject({ state: 'incomplete', completeness: { reasons: ['unbound_native_identity'] } });
  });
  it('returns no fabricated execution for an absent call and rejects unknown scan owners', () => {
    const db = fixture(); seed(db);
    expect(getNativeToolObservations(db, 's', { ...query, value: 'absent' })).toMatchObject({ state: 'unresolved', eventTotal: 0, events: [], identities: [] });
    expect(() => getNativeToolObservations(db, 'missing', query)).toThrow('Scan session not found');
  });
  it.each([{ limit: 0 }, { limit: 101 }, { cursor: -1 }, { cursor: 1.5 }, { value: '' }, { scope: '' }, { namespace: '\u0000' }, { value: '\u007f' }])('rejects invalid bounds %j', invalid => {
    const db = fixture(); seed(db); expect(() => getNativeToolObservations(db, 's', { ...query, ...invalid })).toThrow('Invalid native tool observation query');
  });
  it('uses fixed-count metadata reads and no writes or secret body/source fields', () => {
    const statements: string[] = []; const db = fixture(sql => statements.push(String(sql))); seed(db, 's', 'native-s', 300);
    const before = db.prepare('SELECT total_changes() AS count').get(); statements.length = 0;
    const result = getNativeToolObservations(db, 's', query);
    expect(statements.filter(sql => /^(SELECT|WITH)\b/i.test(sql.trim())).length).toBeLessThanOrEqual(9);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_INPUT|SECRET_OUTPUT|PRIVATE_SOURCE_DO_NOT_LIST|inputSummary|outputSummary|"raw"/);
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + TOOL_OBSERVATION_EVENTS_SQL).all('scan:s', query.namespace, query.value, query.scope, 's', 0, 21);
    expect(JSON.stringify(plan)).toContain('idx_trace_identities_source');
  });
  it('refuses an oversized single metadata record without clipping identity or looping', () => {
    const db = fixture(); seed(db);
    db.prepare("UPDATE events SET actor=? WHERE session_id='s' AND id='input'").run('x'.repeat(1024 * 1024));
    expect(() => getNativeToolObservations(db, 's', query)).toThrow('Execution metadata exceeds response budget');
  });
});
