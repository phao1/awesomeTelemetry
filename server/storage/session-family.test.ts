import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeIdentitySet } from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import { cachedStmt } from './stmt-cache.js';
import { writeNativeIdentities } from './trace-links.js';
import { FAMILY_CHILDREN_SQL, getNativeSessionFamily } from './session-family.js';

type Db = InstanceType<typeof Database>;
const databases: Db[] = [];
const stamp = '2026-10-19T00:00:00.000Z';
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database(log?: string[]): Db {
  const db = new Database(':memory:', { verbose: log === undefined ? undefined : sql => log.push(String(sql)) });
  db.pragma('foreign_keys=ON'); initSchema(db); databases.push(db); return db;
}
function source(db: Db, key: string, native: string, parent?: string, complete = true, namespace = 'agent:codex'): void {
  cachedStmt(db, 'INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(key, 'codex', 'Codex', 'Synthetic ' + key, stamp, stamp, '/PRIVATE_SYNTHETIC_SOURCE/' + key);
  const items: NativeIdentitySet['items'] = [{ namespace, kind: 'session', value: native, scope: null, eventId: null, sourcePath: 'session.id' }];
  if (parent !== undefined) items.push({ namespace, kind: 'parent_session', value: parent, scope: native, eventId: null, sourcePath: 'session.parent_thread_id' });
  writeNativeIdentities(db, { source: 'scan', key }, { parserVersion: 3, items, completeness: { complete, omittedCount: complete ? 0 : 1, reasons: complete ? [] : ['synthetic_incomplete'] } }, stamp);
}

describe('one-hop native session family', () => {
  it('opens a parent, two children and a further generation only on explicit reads', () => {
    const db = database(); source(db, 'parent', 'p'); source(db, 'child-a', 'a', 'p'); source(db, 'child-b', 'b', 'p'); source(db, 'grandchild', 'g', 'a');
    const family = getNativeSessionFamily(db, 'parent');
    expect(family.session).toMatchObject({ id: 'parent', title: 'Synthetic parent' });
    expect(family.children.map(child => [child.session.id, child.state])).toEqual([['child-a', 'resolved'], ['child-b', 'resolved']]);
    expect(family.children[0]!.identity).toMatchObject({ sourceKey: 'child-a', value: 'p', scope: 'a', sourcePath: 'session.parent_thread_id' });
    expect(family.parents.items).toEqual([]);
    const child = getNativeSessionFamily(db, 'child-a');
    expect(child.parents.items[0]).toMatchObject({ state: 'resolved', matches: [{ id: 'parent' }] });
    expect(child.children.map(value => value.session.id)).toEqual(['grandchild']);
    expect(JSON.stringify(family)).not.toContain('grandchild');
    expect(JSON.stringify(family)).not.toContain('/PRIVATE_SYNTHETIC_SOURCE/');
  });

  it('does not invent relations from equal labels or a different namespace', () => {
    const db = database(); source(db, 'parent', 'p'); source(db, 'unrelated', 'u'); source(db, 'other-provider', 'o', 'p', true, 'agent:claude');
    expect(getNativeSessionFamily(db, 'parent')).toMatchObject({ children: [], hasMore: false, nextCursor: null });
    expect(getNativeSessionFamily(db, 'unrelated').parents.items).toEqual([]);
  });

  it('preserves full-owner ambiguity beyond a one-child page', () => {
    const db = database(); source(db, 'parent', 'p'); source(db, 'duplicate-parent', 'p'); source(db, 'child-a', 'a', 'p'); source(db, 'child-b', 'b', 'p');
    const family = getNativeSessionFamily(db, 'parent', { limit: 1 });
    expect(family.children[0]!.state).toBe('ambiguous');
    expect(family.completeness.reasons).toContain('parent_owner_ambiguous');
    expect(family.hasMore).toBe(true);
  });

  it.each(['parent', 'child'])('never resolves an incomplete %s source', incomplete => {
    const db = database(); source(db, 'parent', 'p', undefined, incomplete !== 'parent'); source(db, 'child', 'a', 'p', incomplete !== 'child');
    expect(getNativeSessionFamily(db, 'parent').children[0]!.state).toBe('incomplete');
  });

  it('requires the child declaration scope and keeps duplicate locators as one child', () => {
    const db = database(); source(db, 'parent', 'p'); source(db, 'child', 'a', 'p');
    const insert = cachedStmt(db, 'INSERT INTO trace_identities (id,source_id,namespace,kind,value,scope,event_id,source_path) VALUES (?,?,?,?,?,?,NULL,?)');
    insert.run('f'.repeat(64), 'scan:child', 'agent:codex', 'parent_session', 'p', 'a', 'session.forked_from_id');
    expect(getNativeSessionFamily(db, 'parent').children).toHaveLength(1);
    cachedStmt(db, "UPDATE trace_identities SET scope='wrong' WHERE source_id='scan:child' AND kind='parent_session'").run();
    expect(getNativeSessionFamily(db, 'parent').children[0]!.state).toBe('incomplete');
  });

  it('does not treat native self claims as resolved edges', () => {
    const db = database(); source(db, 'parent', 'p'); source(db, 'child', 'p', 'p');
    expect(getNativeSessionFamily(db, 'parent').children[0]!.state).toBe('unresolved');
  });

  it('uses bounded keyset pages without losing or duplicating children', () => {
    const db = database(); source(db, 'parent', 'p');
    for (let n = 0; n < 5; n += 1) source(db, 'child-' + n, 'c-' + n, 'p');
    const first = getNativeSessionFamily(db, 'parent', { limit: 2 });
    expect(first.children.map(child => child.session.id)).toEqual(['child-0', 'child-1']);
    expect(first.nextCursor).toBe('child-1');
    const second = getNativeSessionFamily(db, 'parent', { limit: 2, cursor: first.nextCursor! });
    const last = getNativeSessionFamily(db, 'parent', { limit: 2, cursor: second.nextCursor! });
    expect(last.children.map(child => child.session.id)).toEqual(['child-4']); expect(last.hasMore).toBe(false);
  });

  it('uses the reverse index and fixed metadata queries without writes or body reads', () => {
    const log: string[] = []; const db = database(log); source(db, 'parent', 'p');
    for (let n = 0; n < 20; n += 1) source(db, 'child-' + n, 'c-' + n, 'p');
    db.exec('ANALYZE'); const before = cachedStmt(db, 'SELECT total_changes() AS n').get(); log.length = 0;
    expect(getNativeSessionFamily(db, 'parent').children).toHaveLength(20);
    const reads = log.filter(sql => /^(SELECT|WITH)/.test(sql));
    expect(reads.length).toBeLessThanOrEqual(12);
    expect(reads.join('\n')).not.toMatch(/SELECT\s+\*|\b(raw|input_summary|output_summary|system_prompt|request_body|response_body)\b/);
    expect(cachedStmt(db, 'SELECT total_changes() AS n').get()).toEqual(before);
    const plan = cachedStmt(db, 'EXPLAIN QUERY PLAN ' + FAMILY_CHILDREN_SQL).all('agent:codex', 'p', 'parent', '', 21) as Array<{ detail: string }>;
    expect(plan.some(row => row.detail.includes('SEARCH i USING') && row.detail.includes('idx_trace_identities_parent'))).toBe(true);
    expect(plan.some(row => /^SCAN i\b/.test(row.detail))).toBe(false);
  });

  it('preserves byte-heavy children and advances from the actual returned last child', () => {
    const db = database(); source(db, 'parent', 'p'); source(db, 'child-a', 'a', 'p'); source(db, 'child-b', 'b', 'p');
    cachedStmt(db, "UPDATE sessions SET title=? WHERE id LIKE 'child-%'").run('x'.repeat(600_000));
    const family = getNativeSessionFamily(db, 'parent');
    expect(family.children).toHaveLength(1); expect(family.nextCursor).toBe('child-a'); expect(family.hasMore).toBe(true);
    expect(family.children[0]!.session.title).toHaveLength(600_000);
    expect(getNativeSessionFamily(db, 'parent', { cursor: family.nextCursor! }).children[0]!.session.id).toBe('child-b');
  });

  it('rejects invalid pagination and missing sessions with the frozen error codes', () => {
    const db = database(); source(db, 'parent', 'p');
    for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: '' }, { cursor: '\u0000' }]) {
      expect(() => getNativeSessionFamily(db, 'parent', options)).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    }
    expect(() => getNativeSessionFamily(db, 'absent')).toThrow(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
  });
});
