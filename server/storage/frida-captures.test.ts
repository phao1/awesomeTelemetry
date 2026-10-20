import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { insertFridaCapture, listFridaCaptures, getFridaCapture } from './frida-captures.js';
const databases: Database.Database[] = [];
function setup() { const db = new Database(':memory:'); databases.push(db); initSchema(db); return db; }
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
describe('Frida SQLite records', () => {
  it('commits existing DTO with UTC timestamp/null unknown fields and a bounded list preview', () => {
    const db = setup(), jsonData = JSON.stringify({ text: '中'.repeat(1000) });
    const id = insertFridaCapture(db, { pid: 42, model: null, sessionId: null, jsonData }, 'local-run');
    const detail = getFridaCapture(db, id)!; expect(detail).toEqual({ id, pid: 42, capturedAt: expect.any(String), captureType: 'chat', model: null, sessionId: null, jsonData, captureSessionId: 'local-run', messageCount: null, tokens: null });
    expect(new Date(detail.capturedAt).toISOString()).toBe(detail.capturedAt);
    expect(listFridaCaptures(db).items[0]?.jsonData).toBe(jsonData.slice(0, 500));
  });
  it('uses tie-safe indexed keyset pagination without missing equal-time captures', () => {
    const db = setup(); for (let i = 0; i < 6; i++) insertFridaCapture(db, { pid: 1, model: null, sessionId: null, jsonData: '{}' });
    db.exec("UPDATE frida_captures SET captured_at='2026-10-20T00:00:00.000Z'");
    const first = listFridaCaptures(db, { limit: 3 }), second = listFridaCaptures(db, { limit: 3, cursor: first.nextCursor! });
    expect(first.items.map(row => row.id)).toEqual([6,5,4]); expect(second.items.map(row => row.id)).toEqual([3,2,1]); expect(second.hasMore).toBe(false);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM frida_captures WHERE (captured_at,id)<(?,?) ORDER BY captured_at DESC,id DESC LIMIT ?').all('2026', 99, 10);
    expect(JSON.stringify(plan)).toContain('idx_frida_captured_at'); expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
  });
  it('strictly rejects invalid pagination/id and preserves missing record distinction', () => {
    const db = setup(); for (const limit of [0, -1, 501, 1.5, NaN]) expect(() => listFridaCaptures(db, { limit })).toThrow();
    for (const cursor of ['', 'x', '["2026-10-20T00:00:00.000Z",-1]']) expect(() => listFridaCaptures(db, { cursor })).toThrow();
    expect(getFridaCapture(db, 42)).toBeNull(); expect(() => getFridaCapture(db, 1.1)).toThrow();
  });
  it('rejects oversized writes/legacy full rows without deleting retained data', () => {
    const db = setup(); const id = insertFridaCapture(db, { pid: 1, model: null, sessionId: null, jsonData: '{}' });
    const large = JSON.stringify({ text: 'x'.repeat(262144) });
    expect(() => insertFridaCapture(db, { pid: 1, model: null, sessionId: null, jsonData: large })).toThrow();
    db.prepare('UPDATE frida_captures SET json_data=? WHERE id=?').run(large, id); expect(() => getFridaCapture(db, id)).toThrow('limit'); expect(db.prepare('SELECT id FROM frida_captures').all()).toHaveLength(1);
  });
});
