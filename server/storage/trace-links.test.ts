import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeIdentitySet } from '../../src/core/trace-types.js';
import { initSchema, SCHEMA_VERSION } from './schema.js';
import { decideTraceAssociation, findLinkedCapturePredecessor, listProxyTraceLinks, listSessionCaptureLinks, listTraceDecisions, listTraceIdentities, LINKED_PREDECESSOR_TIME_SQL, LINKED_PREDECESSOR_ID_SQL, SESSION_IDENTITY_SQL, writeNativeIdentities } from './trace-links.js';
import { cachedStmt } from './stmt-cache.js';

type Db = InstanceType<typeof Database>;
const instances: Db[] = [];
const directories: string[] = [];
const time = '2026-10-16T00:00:00.000Z';
afterEach(() => {
  for (const db of instances.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function database(path = ':memory:', verbose?: (sql: string) => void): Db {
  const db = new Database(path, { verbose: verbose === undefined ? undefined : message => verbose(String(message)) }); db.pragma('foreign_keys = ON'); initSchema(db); instances.push(db); return db;
}
function session(db: Db, key: string, provider = 'claude'): void {
  cachedStmt(db, 'INSERT INTO sessions (id, provider, source_agent, started_at, updated_at, source_path) VALUES (?, ?, ?, ?, ?, ?)').run(key, provider, provider, time, time, '/synthetic/' + key);
}
function proxy(db: Db, id: number): void {
  cachedStmt(db, 'INSERT INTO proxy_requests (id, request_id, method, url, hostname, started_at, model, request_body, response_body, system_prompt, system_prompt_len) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'req-' + id, 'POST', '/v1/messages', 'same.gateway.test', time, 'same-model', 'PRIVATE_BODY', 'PRIVATE_OUTPUT', 'PRIVATE_SYSTEM', 14);
}
function identities(value: string, namespace = 'agent:claude', complete = true): NativeIdentitySet {
  return { parserVersion: 1, items: [{ namespace, kind: 'session', value, scope: null, eventId: null, sourcePath: 'native.sessionId' }], completeness: { complete, omittedCount: 0, reasons: complete ? [] : ['partial_source'] } };
}
function bindScan(db: Db, key: string, value: string, namespace = 'agent:claude'): string[] {
  return writeNativeIdentities(db, { source: 'scan', key }, identities(value, namespace), time);
}
function bindProxy(db: Db, id: number, value: string, namespace = 'agent:claude'): string[] {
  return writeNativeIdentities(db, { source: 'proxy', key: String(id) }, identities(value, namespace), time);
}

describe('native identity and association storage', () => {
  it('selects a predecessor at10000 captures with fixed indexed metadata reads and no sorting tree', () => {
    const log: string[] = []; const db = database(':memory:', sql => log.push(sql)); session(db, 'long-session');
    const insertProxy = cachedStmt(db, "INSERT INTO proxy_requests (id, request_id, method, url, hostname, started_at, request_format) VALUES (?, ?, 'POST', '/v1/messages', 'synthetic.test', ?, 'anthropic_messages')");
    const insertLink = cachedStmt(db, "INSERT INTO trace_associations (id, session_key, proxy_id, state, reason, created_at, updated_at) VALUES (?, 'long-session', ?, 'direct', 'synthetic', ?, ?)");
    db.transaction(() => {
      for (let index = 1; index <= 10_000; index += 1) {
        const started = new Date(Date.parse(time) + index * 1000).toISOString();
        insertProxy.run(index, 'synthetic-' + index, started); insertLink.run(String(index).padStart(64, '0'), index, time, time);
      }
    })();
    const target = { id: 10_000, requestFormat: 'anthropic_messages', startedAt: new Date(Date.parse(time) + 10_000_000).toISOString() };
    log.length = 0;
    expect(findLinkedCapturePredecessor(db, target)).toEqual({ id: 9999, sessionKey: 'long-session' });
    const reads = log.filter(sql => sql.startsWith('SELECT'));
    expect(reads).toHaveLength(3);
    expect(reads.join('\n')).not.toMatch(/\b(?:request_body|response_body|raw_request_body|raw_response_body|system_prompt)\b/);
    for (const sql of [LINKED_PREDECESSOR_TIME_SQL, LINKED_PREDECESSOR_ID_SQL]) {
      const params: Array<string | number> = ['long-session', target.requestFormat, target.startedAt, target.startedAt, target.id];
      if (sql === LINKED_PREDECESSOR_ID_SQL) params.push(2_461_330);
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params) as Array<{ detail: string }>;
      expect(plan.some(row => row.detail.includes('idx_trace_associations_session'))).toBe(true);
      expect(plan.some(row => row.detail.includes('idx_trace_associations_proxy'))).toBe(true);
      expect(plan.some(row => row.detail.includes('USE TEMP B-TREE'))).toBe(false);
    }
    log.length = 0;
    const times: number[] = [];
    for (let index = 0; index < 7; index += 1) { const started = performance.now(); findLinkedCapturePredecessor(db, target); times.push(performance.now() - started); }
    expect(times.sort((left, right) => left - right)[3]).toBeLessThan(20);
  });
  it('bounds collision suggestions while preserving full-group ambiguity and explicit user choices', () => {
    const db = database(); proxy(db, 1); session(db, 's00'); bindScan(db, 's00', 'shared'); bindProxy(db, 1, 'shared');
    for (let index = 1; index < 40; index += 1) {
      const key = 's' + String(index).padStart(2, '0'); session(db, key); bindScan(db, key, 'shared');
    }
    const links = listProxyTraceLinks(db, 1, { limit: 100 });
    expect(links.items).toHaveLength(32);
    expect(links.items.every(item => item.state === 'candidate')).toBe(true);
    expect(links.items.some(item => item.sessionKey === 's00')).toBe(true);
    expect(listTraceIdentities(db, { source: 'scan', key: 's39' }).items).toHaveLength(1);
    decideTraceAssociation(db, 1, 's39', 'confirmed', 'explicit choice beyond suggestions');
    expect(listSessionCaptureLinks(db, 's39').confirmedCount).toBe(1);
  });
  it('bounds identity pages by serialized bytes as well as row count', () => {
    const db = database(); session(db, 's1');
    const bundle: NativeIdentitySet = { parserVersion: 1, completeness: { complete: true, omittedCount: 0, reasons: [] },
      items: Array.from({ length: 100 }, (_, index) => ({ namespace: 'protocol:anthropic', kind: 'request', value: '\u0000'.repeat(1020) + index, scope: '\u0000'.repeat(1024), eventId: null, sourcePath: 'x'.repeat(512) })) };
    writeNativeIdentities(db, { source: 'scan', key: 's1' }, bundle, time);
    const page = listTraceIdentities(db, { source: 'scan', key: 's1' }, { limit: 100 });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(500_000);
    expect(page.items.length).toBeLessThan(100);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(page.items.at(-1)?.id);
  });
  it('uses fixed bulk reads and indexed native/session lookups, not per-request queries', () => {
    const log: string[] = []; const db = database(':memory:', sql => log.push(sql)); session(db, 's1'); bindScan(db, 's1', 'a');
    for (let index = 1; index <= 50; index += 1) { proxy(db, index); bindProxy(db, index, 'a'); }
    log.length = 0;
    const page = listSessionCaptureLinks(db, 's1');
    expect(page.items).toHaveLength(50);
    const reads = log.filter(sql => sql.trimStart().startsWith('SELECT'));
    expect(reads.length).toBeLessThanOrEqual(5);
    expect(reads.join('\n')).not.toMatch(/\b(?:request_body|response_body|raw_request_body|raw_response_body|system_prompt|input_summary|output_summary|raw)\b/);
    const nativePlan = db.prepare('EXPLAIN QUERY PLAN ' + SESSION_IDENTITY_SQL).all(JSON.stringify([['agent:claude', 'a']])) as Array<{ detail: string }>;
    expect(nativePlan.some(row => row.detail.includes('idx_trace_identities_native'))).toBe(true);
    const pagePlan = db.prepare("EXPLAIN QUERY PLAN SELECT id, proxy_id FROM trace_associations WHERE session_key=? AND proxy_id<? ORDER BY proxy_id DESC LIMIT 51").all('s1', 999) as Array<{ detail: string }>;
    expect(pagePlan.some(row => row.detail.includes('idx_trace_associations_session'))).toBe(true);
    expect(pagePlan.some(row => row.detail.includes('USE TEMP B-TREE'))).toBe(false);
  });
  it('uses additive v12 tables and preserves previous sessions/proxies on repeated init', () => {
    const db = database(); session(db, 's1'); proxy(db, 1);
    db.exec('DROP TABLE trace_association_decisions; DROP TABLE trace_association_evidence; DROP TABLE trace_associations; DROP TABLE trace_identities; DROP TABLE trace_identity_sources;');
    db.prepare("UPDATE _meta SET value='11' WHERE key='schema_version'").run();
    initSchema(db); initSchema(db);
    expect(db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({ value: String(SCHEMA_VERSION) });
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 's1' }]);
    expect(db.prepare('SELECT id FROM proxy_requests').all()).toEqual([{ id: 1 }]);
  });
  it('does not associate same model/host/time or a capture run without exact native session evidence', () => {
    const db = database(); session(db, 's1'); proxy(db, 1); proxy(db, 2);
    const bundle: NativeIdentitySet = { parserVersion: 1, items: [{ namespace: 'protocol:anthropic', kind: 'response', value: 'shared-msg', scope: null, eventId: null, sourcePath: 'message.id' }], completeness: { complete: true, omittedCount: 0, reasons: [] } };
    writeNativeIdentities(db, { source: 'scan', key: 's1' }, bundle, time);
    writeNativeIdentities(db, { source: 'proxy', key: '1' }, bundle, time);
    expect(listSessionCaptureLinks(db, 's1').items).toEqual([]);
    expect(listProxyTraceLinks(db, 1).items).toEqual([]);
  });
  it('separates concurrent sessions and namespaces; late scan ingestion finds earlier proxy evidence', () => {
    const db = database(); session(db, 's-a'); session(db, 's-b'); session(db, 'codex-s', 'codex');
    for (const id of [1, 2, 3]) proxy(db, id);
    bindProxy(db, 2, 'b'); bindProxy(db, 1, 'a'); bindProxy(db, 3, 'a', 'agent:codex');
    bindScan(db, 's-b', 'b'); bindScan(db, 's-a', 'a'); bindScan(db, 'codex-s', 'a', 'agent:codex');
    expect(listSessionCaptureLinks(db, 's-a').items.map(item => item.request.id)).toEqual([1]);
    expect(listSessionCaptureLinks(db, 's-b').items.map(item => item.request.id)).toEqual([2]);
    expect(listSessionCaptureLinks(db, 'codex-s').items.map(item => item.request.id)).toEqual([3]);
    const link = listProxyTraceLinks(db, 1).items[0]!;
    expect(link.state).toBe('direct');
    expect(link.evidenceIds).toHaveLength(2);
  });
  it('downgrades existing direct links when duplicate native session evidence arrives', () => {
    const db = database(); session(db, 'first'); session(db, 'duplicate'); proxy(db, 1);
    bindScan(db, 'first', 'a'); bindProxy(db, 1, 'a');
    expect(listProxyTraceLinks(db, 1).items[0]?.state).toBe('direct');
    bindScan(db, 'duplicate', 'a');
    expect(listProxyTraceLinks(db, 1).items.map(item => item.state)).toEqual(['candidate', 'candidate']);
    expect(listSessionCaptureLinks(db, 'first')).toMatchObject({ confirmedCount: 0, candidateCount: 1 });
  });
  it('does not directly associate multiple contradictory session IDs or incomplete identity snapshots', () => {
    const db = database(); session(db, 's1'); proxy(db, 1);
    bindScan(db, 's1', 'a');
    const bundle = identities('a');
    bundle.items.push({ ...bundle.items[0]!, value: 'b' });
    writeNativeIdentities(db, { source: 'proxy', key: '1' }, bundle, time);
    expect(listProxyTraceLinks(db, 1).items[0]?.state).toBe('candidate');
    writeNativeIdentities(db, { source: 'proxy', key: '1' }, identities('a', 'agent:claude', false), time);
    expect(listProxyTraceLinks(db, 1).items[0]).toMatchObject({ state: 'candidate', reason: 'identity_collection_incomplete' });
  });
  it('does no SQL writes on identical source ingestion, and keeps real retries as distinct attempts', () => {
    const db = database(); session(db, 's1'); proxy(db, 1); proxy(db, 2);
    bindScan(db, 's1', 'a'); bindProxy(db, 1, 'a'); bindProxy(db, 2, 'a');
    const before = db.prepare('SELECT total_changes() AS count').get();
    bindScan(db, 's1', 'a'); bindProxy(db, 1, 'a');
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(listSessionCaptureLinks(db, 's1')).toMatchObject({ confirmedCount: 2, candidateCount: 0 });
  });
  it('retracts stale automatic matches rather than rewriting native session IDs', () => {
    const db = database(); session(db, 's1'); proxy(db, 1);
    bindScan(db, 's1', 'a'); bindProxy(db, 1, 'a');
    bindScan(db, 's1', 'new-native-id');
    expect(listProxyTraceLinks(db, 1).items).toEqual([]);
    expect(listTraceIdentities(db, { source: 'scan', key: 's1' }).items[0]?.value).toBe('new-native-id');
  });
  it('persists user confirmation/rejection/revocation, audits transitions, and makes identical retries idempotent', () => {
    const db = database(); session(db, 's1'); proxy(db, 1);
    const confirmed = decideTraceAssociation(db, 1, 's1', 'confirmed', 'selected manually');
    expect(confirmed.state).toBe('confirmed');
    decideTraceAssociation(db, 1, 's1', 'confirmed', 'selected manually');
    expect(listTraceDecisions(db, 1, 's1').items).toHaveLength(1);
    bindScan(db, 's1', 'a'); bindProxy(db, 1, 'a');
    expect(listProxyTraceLinks(db, 1).items[0]?.state).toBe('confirmed');
    decideTraceAssociation(db, 1, 's1', 'rejected');
    bindProxy(db, 1, 'different');
    expect(listProxyTraceLinks(db, 1).items[0]?.state).toBe('rejected');
    decideTraceAssociation(db, 1, 's1', 'revoked');
    bindProxy(db, 1, 'a');
    expect(listSessionCaptureLinks(db, 's1').items).toEqual([]);
    expect(listTraceDecisions(db, 1, 's1').items.map(item => item.state)).toEqual(['confirmed', 'rejected', 'revoked']);
  });
  it('pages identities, attempts and decisions without leaking bodies', () => {
    const db = database(); session(db, 's1'); bindScan(db, 's1', 'a');
    for (const id of [1, 2, 3]) { proxy(db, id); bindProxy(db, id, 'a'); }
    const first = listSessionCaptureLinks(db, 's1', { limit: 2 });
    expect(first.items.map(item => item.request.id)).toEqual([3, 2]);
    expect(first).toMatchObject({ nextCursor: 2, hasMore: true });
    const last = listSessionCaptureLinks(db, 's1', { limit: 2, cursor: 2 });
    expect(last.items.map(item => item.request.id)).toEqual([1]);
    expect(last.hasMore).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE_BODY|PRIVATE_OUTPUT|PRIVATE_SYSTEM|requestBody|responseBody|rawRequestBody/);
    const bundle = identities('a'); bundle.items.push({ ...bundle.items[0]!, kind: 'turn', value: 'turn1', scope: 'a' });
    writeNativeIdentities(db, { source: 'scan', key: 's1' }, bundle, time);
    const identityPage = listTraceIdentities(db, { source: 'scan', key: 's1' }, { limit: 1 });
    expect(identityPage.hasMore).toBe(true);
    expect(listTraceIdentities(db, { source: 'scan', key: 's1' }, { limit: 1, cursor: identityPage.nextCursor! }).items).toHaveLength(1);
  });
  it('keeps missing manifests distinct and rejects invalid owners/cursors', () => {
    const db = database(); session(db, 's1');
    expect(listTraceIdentities(db, { source: 'scan', key: 's1' })).toMatchObject({ parserVersion: null, completeness: { complete: false, reasons: ['not_collected'] } });
    expect(() => listSessionCaptureLinks(db, 'missing')).toThrow('Scan session not found');
    expect(() => listProxyTraceLinks(db, 0)).toThrow('Invalid proxy id');
    expect(() => listSessionCaptureLinks(db, 's1', { cursor: -1 })).toThrow('Invalid capture cursor');
    expect(() => listTraceIdentities(db, { source: 'scan', key: 's1' }, { cursor: 'not-a-digest' })).toThrow('Invalid identity cursor');
  });
  it('deletes only source-owned manifests/links/decisions and never the other source', () => {
    const db = database(); session(db, 's1'); session(db, 's2'); proxy(db, 1); proxy(db, 2);
    bindScan(db, 's1', 'a'); bindProxy(db, 1, 'a');
    decideTraceAssociation(db, 2, 's2', 'confirmed');
    db.prepare('DELETE FROM sessions WHERE id=?').run('s1');
    expect(listProxyTraceLinks(db, 1).items).toEqual([]);
    expect(listTraceIdentities(db, { source: 'proxy', key: '1' }).items).toHaveLength(1);
    db.prepare('DELETE FROM proxy_requests WHERE id=?').run(2);
    expect(db.prepare('SELECT id FROM sessions WHERE id=?').get('s2')).toEqual({ id: 's2' });
    expect(db.prepare('SELECT sequence FROM trace_association_decisions').all()).toEqual([]);
  });
  it('preserves links and native evidence after reopening an actual database file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trace-links-')); directories.push(directory);
    const path = join(directory, 'trace.sqlite'); const first = database(path);
    session(first, 's1'); proxy(first, 1); bindScan(first, 's1', 'a'); bindProxy(first, 1, 'a');
    decideTraceAssociation(first, 1, 's1', 'confirmed', 'persistent');
    first.close();
    const reopened = database(path);
    expect(listProxyTraceLinks(reopened, 1).items[0]?.state).toBe('confirmed');
    expect(listTraceDecisions(reopened, 1, 's1').items[0]?.note).toBe('persistent');
    expect(listTraceIdentities(reopened, { source: 'proxy', key: '1' }).items[0]?.value).toBe('a');
  });
});
