import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeIdentitySet } from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import { listTraceIdentities, writeNativeIdentities } from './trace-links.js';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const stamp = '2026-10-29T00:00:00.000Z';
const owner = { source: 'scan', key: 'fixture-session' } as const;
function fixture() {
  const sql: string[] = [];
  const db = new Database(':memory:', { verbose: text => sql.push(String(text)) }); databases.push(db);
  initSchema(db);
  db.prepare('INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path) VALUES(?,?,?,?,?,?,?)')
    .run(owner.key, 'codex', 'codex', 'Snapshot fixture', stamp, stamp, 'synthetic:snapshot');
  const bundle: NativeIdentitySet = { parserVersion: 1, completeness: { complete: true, omittedCount: 0, reasons: [] }, items: [
    { namespace: 'protocol:openai', kind: 'tool_call', value: 'call-a', scope: 'native-session', eventId: 'event-a', sourcePath: 'rows[0].call_id' },
    { namespace: 'protocol:openai', kind: 'message', value: 'message-b', scope: 'native-session', eventId: 'event-b', sourcePath: 'rows[1].id' },
  ] };
  const source = db.prepare('SELECT content_sha256 FROM trace_identity_sources WHERE id=?');
  const changes = db.prepare('SELECT total_changes() AS n');
  return { db, sql, bundle, digest: () => (source.get('scan:' + owner.key) as { content_sha256: string }).content_sha256,
    changes: () => (changes.get() as { n: number }).n };
}

describe('versioned native identity snapshot fingerprints', () => {
  it.each(['namespace', 'kind', 'value', 'scope', 'eventId', 'sourcePath'] as const)('detects a changed %s without rewriting unchanged identities', field => {
    const f = fixture(); writeNativeIdentities(f.db, owner, f.bundle, stamp);
    const before = listTraceIdentities(f.db, owner), digest = f.digest(), changes = f.changes();
    const item = f.bundle.items[0]!;
    if (field === 'kind') item.kind = 'request'; else item[field] = String(item[field]) + '-changed';
    writeNativeIdentities(f.db, owner, f.bundle, stamp);
    const after = listTraceIdentities(f.db, owner);
    expect(f.digest()).not.toBe(digest);
    expect(after.items).toHaveLength(2);
    expect(after.items.find(i => i.value === 'message-b')).toEqual(before.items.find(i => i.value === 'message-b'));
    expect(after.items.some(i => i[field] === item[field])).toBe(true);
    // One source update, one changed identity insert and one stale identity delete.
    expect(f.changes() - changes).toBe(3);
    const settled = f.changes(); writeNativeIdentities(f.db, owner, f.bundle, stamp);
    expect(f.changes()).toBe(settled);
  });

  it.each(['parserVersion', 'complete', 'omittedCount', 'reasons'] as const)('detects %s changes while retaining all identity rows', field => {
    const f = fixture(); writeNativeIdentities(f.db, owner, f.bundle, stamp);
    const before = listTraceIdentities(f.db, owner).items, digest = f.digest(), changes = f.changes();
    if (field === 'parserVersion') f.bundle.parserVersion += 1;
    else if (field === 'complete') f.bundle.completeness.complete = false;
    else if (field === 'omittedCount') f.bundle.completeness.omittedCount = 1;
    else f.bundle.completeness.reasons = ['fixture-incomplete'];
    writeNativeIdentities(f.db, owner, f.bundle, stamp);
    expect(f.digest()).not.toBe(digest);
    expect(listTraceIdentities(f.db, owner).items).toEqual(before);
    expect(f.changes() - changes).toBe(1);
    const settled = f.changes(); writeNativeIdentities(f.db, owner, f.bundle, stamp);
    expect(f.changes()).toBe(settled);
  });

  it('refreshes a legacy fingerprint once, preserving IDs and subsequent reorder idempotence', () => {
    const f = fixture(); writeNativeIdentities(f.db, owner, f.bundle, stamp);
    const before = listTraceIdentities(f.db, owner).items;
    const entries = before.map(({ id, namespace, kind, value, scope, eventId, sourcePath }) =>
      [id, { namespace, kind, value, scope, eventId, sourcePath }]);
    const legacy = createHash('sha256').update(JSON.stringify([f.bundle.parserVersion, entries, f.bundle.completeness])).digest('hex');
    f.db.prepare('UPDATE trace_identity_sources SET content_sha256=? WHERE id=?').run(legacy, 'scan:' + owner.key);
    const changes = f.changes(); f.sql.length = 0;
    writeNativeIdentities(f.db, owner, f.bundle, stamp);
    expect(f.digest()).not.toBe(legacy);
    expect(listTraceIdentities(f.db, owner).items).toEqual(before);
    expect(f.changes() - changes).toBe(1);
    expect(f.sql.some(sql => /(?:INSERT|UPDATE|DELETE)\s+(?:OR\s+IGNORE\s+)?(?:INTO\s+|FROM\s+)?trace_identities\b/i.test(sql))).toBe(false);
    const settled = f.changes(), digest = f.digest();
    writeNativeIdentities(f.db, owner, { ...f.bundle, items: [...f.bundle.items].reverse() }, '2026-10-29T01:00:00.000Z');
    expect(f.changes()).toBe(settled); expect(f.digest()).toBe(digest);
  });
});
