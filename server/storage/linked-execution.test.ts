import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureTransportResult, NativeIdentitySet } from '../../src/core/trace-types.js';
import { writeCaptureTransport } from '../proxy/capture-storage.js';
import { normalizeClaudeSample } from '../../src/adapters/claude-code.js';
import { extractNetworkIdentities } from '../proxy/identity-extractor.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { initSchema } from './schema.js';
import { cachedStmt } from './stmt-cache.js';
import { decideTraceAssociation, listTraceIdentities, writeNativeIdentities } from './trace-links.js';
import { EXECUTION_EVENTS_SQL, EXECUTION_IDENTITIES_SQL, getLinkedExecution, LinkedExecutionLimitError } from './linked-execution.js';

type Db = InstanceType<typeof Database>;
const databases: Db[] = [];
const time = '2026-10-16T00:00:00.000Z';
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database(log?: string[]): Db {
  const db = new Database(':memory:', { verbose: log === undefined ? undefined : message => log.push(String(message)) });
  db.pragma('foreign_keys=ON'); initSchema(db); databases.push(db); return db;
}
function scan(db: Db, key = 'scan-a', nativeSession = 'native-a'): void {
  const record = normalizeClaudeSample({ sourceAgent: 'Claude', session: {}, events: [
    { type: 'user', sessionId: nativeSession, timestamp: time, message: { id: 'user', content: [{ type: 'text', text: 'do the synthetic task' }] } },
    { type: 'assistant', sessionId: nativeSession, timestamp: time, message: { id: 'model-first', content: [{ type: 'text', text: 'call a tool' }, { type: 'tool_use', id: 'same-tool-id', name: 'Read', input: { path: 'synthetic' } }] } },
    { type: 'user', sessionId: nativeSession, timestamp: time, message: { content: [{ type: 'tool_result', tool_use_id: 'same-tool-id', content: 'ORIGINAL_TOOL_OUTPUT_MUST_NOT_LEAK' }] } },
    { type: 'assistant', sessionId: nativeSession, timestamp: time, message: { id: 'model-final', content: [{ type: 'text', text: 'done' }] } },
  ] }, '/synthetic/' + key);
  storeTraceRecord(db, record, '/synthetic/' + key, key);
}
function proxy(db: Db, id: number, nativeSession = 'native-a'): void {
  cachedStmt(db, `INSERT INTO proxy_requests (id, request_id, method, url, hostname, started_at, model, request_body, response_body, system_prompt, system_prompt_len)
    VALUES (?, ?, 'POST', '/v1/messages', 'same.example.test', ?, 'same-model', 'ORIGINAL_BODY_MUST_NOT_LEAK', 'ORIGINAL_RESPONSE_MUST_NOT_LEAK', 'ORIGINAL_PROMPT_MUST_NOT_LEAK', 29)`).run(id, 'req-' + id, time);
  writeNativeIdentities(db, { source: 'proxy', key: String(id) }, extractNetworkIdentities({
    format: 'anthropic_messages', requestHeaders: { 'x-agent-provider': 'claude', 'x-agent-session-id': nativeSession }, requestBody: '{"messages":[]}',
    responseBody: JSON.stringify({ id: 'model-final', content: [{ type: 'tool_use', id: 'same-tool-id', name: 'Read', input: {} }] }),
  }), time);
}

describe('evidence-backed linked execution metadata', () => {
  it.each(['derived', 'measured', 'unknown', 'invalid', null])('retains only the session duration declaration %s without changing event durations', source => {
    const db = database(); scan(db);
    if (source !== null) db.prepare('UPDATE sessions SET duration_source=? WHERE id=?').run(source, 'scan-a');
    else db.prepare("UPDATE sessions SET duration_source='unknown' WHERE id=?").run('scan-a');
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.sessionDurationSource).toBe(source === 'derived' || source === 'measured' ? source : 'unknown');
    expect(result.events.every(event => event.durationMs === 0 && !('durationSource' in event))).toBe(true);
  });

  it('batch-reads retained 100/800/2000ms transport metadata independently of native duration and identity binding', () => {
    const log: string[] = []; const db = database(log); scan(db);
    for (let id = 1; id <= 50; id += 1) proxy(db, id);
    const transport: CaptureTransportResult = { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
      timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150, firstContentMs: 800,
        firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', completedMs: 2000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } };
    writeCaptureTransport(db, 50, transport);
    const manifest = listTraceIdentities(db, { source: 'proxy', key: '50' });
    writeNativeIdentities(db, { source: 'proxy', key: '50' }, { parserVersion: 1, items: manifest.items.filter(identity => identity.kind === 'session'), completeness: manifest.completeness }, time);
    log.length = 0;
    const result = getLinkedExecution(db, 'scan-a', { captureLimit: 50 });
    expect(result.attempts).toHaveLength(50);
    expect(result.attempts[0]).toMatchObject({ transport, matches: [] });
    expect(result.attempts.slice(1).every(attempt => attempt.transport === null)).toBe(true);
    expect(result.events.every(event => event.durationMs === 0)).toBe(true);
    const reads = log.filter(sql => sql.startsWith('SELECT'));
    expect(reads.filter(sql => sql.includes('FROM proxy_capture_transport'))).toHaveLength(1);
    expect(reads.filter(sql => sql.includes('duration_source'))).toHaveLength(1);
    expect(reads.length).toBeLessThanOrEqual(8);
    expect(reads.join('\n')).not.toMatch(/SELECT\s+\*|\b(?:request_body|response_body|raw_request_body|raw_response_body|system_prompt|response_headers|request_ref|response_ref)\b|SELECT raw\b/);
    expect(JSON.stringify(result)).not.toContain('ORIGINAL_');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
  });

  it('uses real adapter/extractor/storage paths for prompt → model/tool/result → model completion without body reads or mutations', () => {
    const log: string[] = []; const db = database(log); scan(db); proxy(db, 1);
    const changes = db.prepare('SELECT total_changes() AS value').get() as { value: number }; log.length = 0;
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.events.map(event => event.kind)).toEqual(['user_prompt', 'llm', 'tool', 'llm']);
    expect(result.events.find(event => event.id === 'same-tool-id')).toMatchObject({ hasInput: true, hasOutput: true });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.association.state).toBe('direct');
    expect(result.attempts[0]!.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'same-tool-id', namespace: 'protocol:anthropic', kind: 'tool_call', value: 'same-tool-id', scope: 'native-a' }),
      expect.objectContaining({ eventId: 'model-final-1', namespace: 'protocol:anthropic', kind: 'response', value: 'model-final', scope: 'native-a' }),
    ]));
    const reads = log.filter(sql => sql.startsWith('SELECT'));
    expect(reads.length).toBeLessThanOrEqual(8);
    expect(reads.join('\n')).not.toMatch(/SELECT\s+\*|\b(?:request_body|response_body|raw_request_body|raw_response_body|system_prompt)\b|SELECT raw\b/);
    expect(JSON.stringify(result)).not.toContain('ORIGINAL_');
    expect(result.events.every(event => !('raw' in event) && !('inputSummary' in event) && !('outputSummary' in event))).toBe(true);
    expect(db.prepare('SELECT total_changes() AS value').get()).toEqual(changes);
  });

  it('isolates simultaneous sessions sharing model/tool ids by native scope', () => {
    const db = database(); scan(db, 'scan-a', 'native-a'); scan(db, 'scan-b', 'native-b'); proxy(db, 1, 'native-a'); proxy(db, 2, 'native-b');
    for (const [key, scope, id] of [['scan-a', 'native-a', 1], ['scan-b', 'native-b', 2]] as const) {
      const result = getLinkedExecution(db, key);
      expect(result.attempts.map(attempt => attempt.request.id)).toEqual([id]);
      expect(result.attempts[0]!.matches.length).toBeGreaterThan(0);
      expect(result.attempts[0]!.matches.every(match => match.scope === scope)).toBe(true);
    }
  });

  it('never promotes accepted session-only membership into an event link', () => {
    const db = database(); scan(db); proxy(db, 1);
    const manifest = listTraceIdentities(db, { source: 'proxy', key: '1' });
    writeNativeIdentities(db, { source: 'proxy', key: '1' }, { parserVersion: 1, items: manifest.items.filter(identity => identity.kind === 'session'), completeness: manifest.completeness }, time);
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.matches).toEqual([]);
  });

  it('does not upgrade provider-scoped tool ids into a different protocol namespace', () => {
    const db = database(); scan(db); proxy(db, 1);
    const manifest = listTraceIdentities(db, { source: 'scan', key: 'scan-a' });
    writeNativeIdentities(db, { source: 'scan', key: 'scan-a' }, { parserVersion: 3, items: manifest.items.map(identity => identity.kind === 'session' ? identity : { ...identity, namespace: 'agent:codearts' }), completeness: manifest.completeness }, time);
    expect(getLinkedExecution(db, 'scan-a').attempts[0]!.matches).toEqual([]);
  });

  it('checks native bindings outside the current event page before claiming uniqueness', () => {
    const db = database(); scan(db); proxy(db, 1);
    const manifest = listTraceIdentities(db, { source: 'scan', key: 'scan-a' });
    const original = manifest.items.find(identity => identity.kind === 'tool_call')!;
    writeNativeIdentities(db, { source: 'scan', key: 'scan-a' }, { parserVersion: 3, items: [...manifest.items, { ...original, eventId: 'model-final-1', sourcePath: 'synthetic.duplicate' }], completeness: manifest.completeness }, time);
    const result = getLinkedExecution(db, 'scan-a', { eventOffset: 2, eventLimit: 1 });
    expect(result.events.map(event => event.id)).toEqual(['same-tool-id']);
    expect(result.attempts[0]!.matches).toEqual([]);
    expect(result.identityCompleteness.reasons).toContain('ambiguous_native_binding');
  });

  it('retains unbound scan evidence without fabricating a binding', () => {
    const db = database(); scan(db); proxy(db, 1);
    const manifest = listTraceIdentities(db, { source: 'scan', key: 'scan-a' });
    writeNativeIdentities(db, { source: 'scan', key: 'scan-a' }, { parserVersion: 1, items: manifest.items.map(identity => ({ ...identity, eventId: null })), completeness: manifest.completeness }, time);
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.attempts[0]!.matches).toEqual([]);
    expect(result.identities.some(identity => identity.source === 'scan' && identity.kind === 'tool_call' && identity.eventId === null)).toBe(true);
    expect(result.identityCompleteness.reasons).toContain('unbound_native_identity');
  });

  it('lists multiply owned accepted memberships without a false call match', () => {
    const db = database(); scan(db); scan(db, 'scan-b', 'native-b'); proxy(db, 1);
    decideTraceAssociation(db, 1, 'scan-b', 'confirmed');
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.matches).toEqual([]);
    expect(result.identityCompleteness.reasons).toContain('ambiguous_capture_membership');
  });

  it('excludes candidates and revoked decisions, while explicit confirmations retain separate ownership', () => {
    const db = database(); scan(db); proxy(db, 1);
    decideTraceAssociation(db, 1, 'scan-a', 'revoked');
    expect(getLinkedExecution(db, 'scan-a').attempts).toHaveLength(0);
    decideTraceAssociation(db, 1, 'scan-a', 'confirmed');
    expect(getLinkedExecution(db, 'scan-a').attempts[0]!.association.state).toBe('confirmed');
  });

  it('paginates small event sets and accepted attempts independently without duplicate ids or N+1 reads', () => {
    const log: string[] = []; const db = database(log); scan(db); for (let id = 1; id <= 3; id += 1) proxy(db, id);
    log.length = 0;
    const first = getLinkedExecution(db, 'scan-a', { eventLimit: 2, captureLimit: 2 });
    expect(first.events).toHaveLength(2); expect(first.eventsHasMore).toBe(true);
    expect(first.attempts.map(attempt => attempt.request.id)).toEqual([3, 2]);
    expect(first.nextCaptureCursor).toBe(2); expect(first.capturesHasMore).toBe(true);
    expect(log.filter(sql => sql.startsWith('SELECT')).length).toBeLessThanOrEqual(8);
    const second = getLinkedExecution(db, 'scan-a', { eventOffset: 2, eventLimit: 2, captureLimit: 2, captureCursor: first.nextCaptureCursor! });
    expect(second.events.map(event => event.id)).toEqual(['same-tool-id', 'model-final-1']);
    expect(second.attempts.map(attempt => attempt.request.id)).toEqual([1]);
    expect(second.eventsHasMore).toBe(false); expect(second.capturesHasMore).toBe(false);
  });

  it('marks truncated identity sources explicitly and never uses a partial prefix to manufacture uniqueness', () => {
    const db = database(); scan(db); proxy(db, 1);
    const manifest = listTraceIdentities(db, { source: 'scan', key: 'scan-a' });
    const extra: NativeIdentitySet['items'] = Array.from({ length: 1100 }, (_, index) => ({ namespace: 'synthetic', kind: 'message', value: 'item-' + index, scope: 'native-a', eventId: null, sourcePath: 'synthetic[' + index + ']' }));
    writeNativeIdentities(db, { source: 'scan', key: 'scan-a' }, { parserVersion: 3, items: [...manifest.items, ...extra], completeness: manifest.completeness }, time);
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.identities).toHaveLength(1000);
    expect(result.attempts[0]!.matches).toEqual([]);
    expect(result.identityCompleteness.reasons).toContain('identity_limit');
  });

  it('exposes original manifest incompleteness reasons and refuses exact links from incomplete sources', () => {
    const db = database(); scan(db); proxy(db, 1);
    const source = listTraceIdentities(db, { source: 'proxy', key: '1' });
    writeNativeIdentities(db, { source: 'proxy', key: '1' }, { parserVersion: 1, items: source.items, completeness: { complete: false, omittedCount: 2, reasons: ['source_preview_truncated'] } }, time);
    decideTraceAssociation(db, 1, 'scan-a', 'confirmed');
    const result = getLinkedExecution(db, 'scan-a');
    expect(result.attempts[0]!.matches).toEqual([]);
    expect(result.identityCompleteness).toMatchObject({ complete: false, reasons: expect.arrayContaining(['identity_collection_incomplete', 'source_preview_truncated']) });
  });

  it('bounds metadata bytes without truncating identity values or keeping matches to removed evidence', () => {
    const db = database(); scan(db); proxy(db, 1);
    const manifest = listTraceIdentities(db, { source: 'scan', key: 'scan-a' });
    const items: NativeIdentitySet['items'] = Array.from({ length: 900 }, (_, index) => ({ namespace: 'synthetic', kind: 'message', value: '\u0000'.repeat(1020) + index, scope: 'native-a', eventId: null, sourcePath: 'synthetic[' + index + ']' }));
    writeNativeIdentities(db, { source: 'scan', key: 'scan-a' }, { parserVersion: 3, items: [...manifest.items, ...items], completeness: manifest.completeness }, time);
    const result = getLinkedExecution(db, 'scan-a');
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
    expect(result.identityCompleteness.reasons).toContain('response_budget');
    expect(result.attempts[0]!.matches).toEqual([]);
    expect(result.identities.filter(identity => identity.namespace === 'synthetic').every(identity => identity.value.length >= 1021)).toBe(true);
  });

  it('fails explicitly when even one existing metadata item cannot fit without rewriting its URL', () => {
    const db = database(); scan(db); proxy(db, 1);
    db.prepare('UPDATE proxy_requests SET url=? WHERE id=1').run('/' + 'x'.repeat(1024 * 1024));
    expect(() => getLinkedExecution(db, 'scan-a')).toThrow(LinkedExecutionLimitError);
    try { getLinkedExecution(db, 'scan-a'); } catch (error) { expect(error).toMatchObject({ code: 'EXECUTION_METADATA_LIMIT' }); }
  });

  it('advances a byte-shortened capture page from its last actually returned attempt', () => {
    const db = database(); scan(db); proxy(db, 1); proxy(db, 2);
    db.prepare('UPDATE proxy_requests SET url=?').run('/' + 'x'.repeat(600_000));
    const first = getLinkedExecution(db, 'scan-a', { captureLimit: 2 });
    expect(first.attempts.map(attempt => attempt.request.id)).toEqual([2]);
    expect(first.capturesHasMore).toBe(true); expect(first.nextCaptureCursor).toBe(2);
    expect(first.identityCompleteness.reasons).toContain('response_budget');
    expect(first.attempts[0]!.request.url).toHaveLength(600_001);
    expect(getLinkedExecution(db, 'scan-a', { captureCursor: first.nextCaptureCursor! }).attempts.map(attempt => attempt.request.id)).toEqual([1]);
  });

  it('keeps indexed source/event reads and no global native-key join', () => {
    const db = database(); scan(db); proxy(db, 1); db.exec('ANALYZE');
    const identityPlan = db.prepare('EXPLAIN QUERY PLAN ' + EXECUTION_IDENTITIES_SQL).all(JSON.stringify(['scan:scan-a', 'proxy:1'])) as Array<{ detail: string }>;
    expect(identityPlan.some(row => row.detail.includes('SEARCH i USING INDEX idx_trace_identities_source'))).toBe(true);
    expect(identityPlan.some(row => row.detail.includes('SCAN i'))).toBe(false);
    const eventPlan = db.prepare('EXPLAIN QUERY PLAN ' + EXECUTION_EVENTS_SQL).all('scan-a', 100, 0) as Array<{ detail: string }>;
    expect(eventPlan.some(row => row.detail.includes('USE TEMP B-TREE'))).toBe(false);
  });

  it.each([{ eventOffset: -1 }, { eventLimit: 0 }, { eventLimit: 201 }, { captureCursor: 0 }, { captureLimit: 51 }, { eventOffset: Number.MAX_SAFE_INTEGER + 1 }])('rejects invalid pagination %j', options => {
    expect(() => getLinkedExecution(database(), 'missing', options)).toThrow('Invalid execution pagination');
  });
  it('reports missing scan sessions with the existing error code', () => {
    expect(() => getLinkedExecution(database(), 'missing')).toThrow(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
  });
  it('keeps the scan-owner guard when reading session declaration and count together', () => {
    const db = database(); scan(db);
    db.prepare("UPDATE sessions SET data_source='proxy' WHERE id='scan-a'").run();
    expect(() => getLinkedExecution(db, 'scan-a')).toThrow(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
  });
});
