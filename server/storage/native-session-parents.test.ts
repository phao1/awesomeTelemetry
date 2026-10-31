import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeIdentitySet } from '../../src/core/trace-types.js';
import { initSchema } from './schema.js';
import { cachedStmt } from './stmt-cache.js';
import { writeNativeIdentities } from './trace-links.js';
import { getNativeSessionParents, NATIVE_PARENT_MATCH_SQL } from './native-session-parents.js';
import { LinkedExecutionLimitError } from './linked-execution.js';

type Db = InstanceType<typeof Database>;
const databases: Db[] = [];
const stamp = '2026-10-16T00:00:00.000Z';
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database(log?: string[]): Db {
  const db = new Database(':memory:', { verbose: log === undefined ? undefined : sql => log.push(String(sql)) });
  db.pragma('foreign_keys=ON'); initSchema(db); databases.push(db); return db;
}
function source(db: Db, key: string, nativeId: string, parents: string[] = [], options: { complete?: boolean; scope?: string | null; namespace?: string } = {}): void {
  cachedStmt(db, 'INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(key, 'codex', 'Codex', 'Session ' + key, stamp, stamp, '/synthetic/source-' + key);
  const namespace = options.namespace ?? 'agent:codex';
  const items: NativeIdentitySet['items'] = [{ namespace, kind: 'session', value: nativeId, scope: null, eventId: null, sourcePath: 'session_meta.id' },
    ...parents.map((value, index): NativeIdentitySet['items'][number] => ({ namespace, kind: 'parent_session', value, scope: options.scope === undefined ? nativeId : options.scope, eventId: null, sourcePath: 'session_meta.parents[' + index + ']' }))];
  writeNativeIdentities(db, { source: 'scan', key }, { parserVersion: 3, items, completeness: { complete: options.complete !== false, omittedCount: options.complete === false ? 1 : 0, reasons: options.complete === false ? ['source_preview_truncated'] : [] } }, stamp);
}

describe('native declared parent/fork references', () => {
  it('resolves only a complete explicit scoped reference and performs fixed-count metadata-only reads without writes', () => {
    const log: string[] = []; const db = database(log); source(db, 'parent', 'native-parent'); source(db, 'child', 'native-child', ['native-parent']);
    const before = db.prepare('SELECT total_changes() AS value').get(); log.length = 0;
    const result = getNativeSessionParents(db, 'child');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ state: 'resolved', matchesTruncated: false, identity: { source: 'scan', sourceKey: 'child', namespace: 'agent:codex', kind: 'parent_session', value: 'native-parent', scope: 'native-child', sourcePath: 'session_meta.parents[0]' }, matches: [{ id: 'parent', provider: 'codex', sourceAgent: 'Codex', title: 'Session parent', startedAt: stamp }] });
    expect(result.completeness.complete).toBe(true);
    expect(result.hasMore).toBe(false); expect(result.nextCursor).toBeNull();
    const reads = log.filter(sql => sql.startsWith('SELECT') || sql.startsWith('WITH'));
    expect(reads.length).toBeLessThanOrEqual(6);
    expect(reads.join('\n')).not.toMatch(/SELECT\s+\*|\b(?:raw|input_summary|output_summary|system_prompt|request_body|response_body)\b/);
    expect(JSON.stringify(result)).not.toContain('/synthetic/');
    expect(db.prepare('SELECT total_changes() AS value').get()).toEqual(before);
  });
  it.each([null, '', 'different-child'])('keeps a missing/conflicting child scope %j incomplete', scope => {
    const db = database(); source(db, 'parent', 'native-parent'); source(db, 'child', 'native-child', ['native-parent'], { scope });
    const result = getNativeSessionParents(db, 'child');
    expect(result.items[0]!.state).toBe('incomplete'); expect(result.completeness.complete).toBe(false);
  });
  it('does not resolve an owner whose own native session is ambiguous', () => {
    const db = database(); source(db, 'parent', 'native-parent'); source(db, 'child', 'native-child', ['native-parent']);
    const sourceId = 'scan:child';
    db.prepare('INSERT INTO trace_identities (id, source_id, namespace, kind, value, scope, event_id, source_path) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)')
      .run('f'.repeat(64), sourceId, 'agent:codex', 'session', 'another-child', 'synthetic.extra');
    expect(getNativeSessionParents(db, 'child').items[0]!.state).toBe('incomplete');
  });
  it.each(['child', 'parent'])('keeps incomplete %s evidence visibly incomplete', incomplete => {
    const db = database(); source(db, 'parent', 'native-parent', [], { complete: incomplete !== 'parent' }); source(db, 'child', 'native-child', ['native-parent'], { complete: incomplete !== 'child' });
    const result = getNativeSessionParents(db, 'child'); expect(result.items[0]!.state).toBe('incomplete'); expect(result.completeness.complete).toBe(false);
  });
  it('does not resolve a parent source with another contradictory native session id', () => {
    const db = database(); source(db, 'parent', 'native-parent'); source(db, 'child', 'native-child', ['native-parent']);
    db.prepare('INSERT INTO trace_identities (id, source_id, namespace, kind, value, scope, event_id, source_path) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)')
      .run('f'.repeat(64), 'scan:parent', 'agent:codex', 'session', 'another-parent', 'synthetic.extra');
    expect(getNativeSessionParents(db, 'child').items[0]!.state).toBe('incomplete');
  });
  it('retains self references without turning them into a resolved parent', () => {
    const db = database(); source(db, 'child', 'native-child', ['native-child']);
    const result = getNativeSessionParents(db, 'child'); expect(result.items[0]!.state).not.toBe('resolved');
    expect(result.completeness.reasons).toContain('self_reference');
  });
  it('does not guess unknown or cross-namespace parent owners', () => {
    const db = database(); source(db, 'parent', 'native-parent', [], { namespace: 'agent:claude' }); source(db, 'child', 'native-child', ['native-parent']);
    const result = getNativeSessionParents(db, 'child'); expect(result.items[0]).toMatchObject({ state: 'unresolved', matches: [], matchesTruncated: false });
  });
  it('reports all-owner collisions even beyond the retained candidate limit', () => {
    const db = database(); for (let index = 0; index < 25; index += 1) source(db, 'parent-' + String(index).padStart(2, '0'), 'same-parent');
    source(db, 'child', 'native-child', ['same-parent']);
    const result = getNativeSessionParents(db, 'child');
    expect(result.items[0]).toMatchObject({ state: 'ambiguous', matchesTruncated: true }); expect(result.items[0]!.matches).toHaveLength(20);
    expect(result.completeness.complete).toBe(false);
  });
  it('pages exact retained parent identity ids without skipping or repeating references', () => {
    const db = database(); source(db, 'child', 'native-child', ['p1', 'p2', 'p3']);
    const first = getNativeSessionParents(db, 'child', { limit: 2 }); expect(first.items).toHaveLength(2); expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(first.items.at(-1)!.identity.id);
    const second = getNativeSessionParents(db, 'child', { limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1); expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(item => item.identity.value)).size).toBe(3);
  });
  it('uses exact native session index searches after ANALYZE, not a global identity scan', () => {
    const db = database(); source(db, 'parent', 'native-parent'); source(db, 'child', 'native-child', ['native-parent']); db.exec('ANALYZE');
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + NATIVE_PARENT_MATCH_SQL).all(JSON.stringify([['agent:codex', 'native-parent']])) as Array<{ detail: string }>;
    expect(plan.some(row => row.detail.startsWith('SEARCH i ') && row.detail.includes('idx_trace_identities_native (namespace=? AND kind=? AND value=? AND scope=?)')), JSON.stringify(plan)).toBe(true);
    expect(plan.some(row => /^SCAN i\b/.test(row.detail))).toBe(false);
  });
  it('returns empty known sessions without inventing a root classification', () => {
    const db = database(); source(db, 'root-or-unknown', 'native');
    expect(getNativeSessionParents(db, 'root-or-unknown')).toMatchObject({ items: [], hasMore: false, nextCursor: null });
  });
  it('returns the existing owner and query error codes', () => {
    const db = database();
    expect(() => getNativeSessionParents(db, 'missing')).toThrow(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
    for (const options of [{ limit: 0 }, { limit: 51 }, { cursor: 'not-an-identity' }, { cursor: 'A'.repeat(64) }]) {
      expect(() => getNativeSessionParents(db, 'missing', options)).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    }
  });
  it('rejects an unprojectable single candidate title rather than altering fields', () => {
    const db = database(); source(db, 'parent', 'native-parent'); source(db, 'child', 'native-child', ['native-parent']);
    db.prepare('UPDATE sessions SET title=? WHERE id=?').run('x'.repeat(512 * 1024), 'parent');
    expect(() => getNativeSessionParents(db, 'child')).toThrow(LinkedExecutionLimitError);
  });
  it('shrinks a byte-heavy reference page and advances only from its actual last intact identity', () => {
    const db = database();
    for (let index = 1; index <= 3; index += 1) source(db, 'parent-' + index, 'native-parent-' + index);
    source(db, 'child', 'native-child', ['native-parent-1', 'native-parent-2', 'native-parent-3']);
    db.prepare('UPDATE sessions SET title=? WHERE id<>?').run('x'.repeat(190_000), 'child');
    const first = getNativeSessionParents(db, 'child', { limit: 3 });
    expect(first.items).toHaveLength(2); expect(first.hasMore).toBe(true); expect(first.nextCursor).toBe(first.items[1]!.identity.id);
    expect(first.items.every(item => item.matches[0]!.title.length === 190_000)).toBe(true);
    expect(first.completeness.reasons).toContain('response_budget');
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(512 * 1024);
    const second = getNativeSessionParents(db, 'child', { limit: 3, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1); expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(item => item.identity.id)).size).toBe(3);
  });
});
