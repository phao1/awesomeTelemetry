import { describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import { initSchema } from './schema.js';
import { captureWasDeleted, enforceProxyRetention } from './retention.js';

type Db = InstanceType<typeof Database>;

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertProxyRequest(db: Db, startedAt: string): void {
  db.prepare(
    'INSERT INTO proxy_requests (request_id, method, url, hostname, started_at) VALUES (?, ?, ?, ?, ?)',
  ).run(`req-${startedAt}`, 'GET', 'http://x', 'x', startedAt);
}

function attachOriginals(db: Db, startedAt: string) {
  const requestBodyId = randomUUID(), responseBodyId = randomUUID();
  db.prepare('INSERT INTO proxy_capture_bodies(proxy_id,request_ref,response_ref) SELECT id,?,? FROM proxy_requests WHERE request_id=?')
    .run(JSON.stringify({ id: requestBodyId }), JSON.stringify({ id: responseBodyId }), 'req-' + startedAt);
  return { requestBodyId, responseBodyId };
}

describe('REQ-017 数据保留', () => {
  it('uses UTC instants across the exact cutoff day and commits exact deletion identity with its rows', () => {
    const db = newDb(), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00.000Z'));
    try {
      insertProxyRequest(db, '2026-09-16T11:59:59.999Z');
      insertProxyRequest(db, '2026-09-16T12:00:00.000Z');
      insertProxyRequest(db, '2026-09-16T12:00:00.001Z');
      insertProxyRequest(db, '2026-09-16T13:59:59.999+02:00');
      const originals = attachOriginals(db, '2026-09-16T11:59:59.999Z');
      expect(enforceProxyRetention(db, 30)).toBe(2);
      expect(db.prepare('SELECT started_at FROM proxy_requests ORDER BY started_at').all()).toEqual([{ started_at: '2026-09-16T12:00:00.000Z' }, { started_at: '2026-09-16T12:00:00.001Z' }]);
      expect(db.prepare('SELECT request_id,request_body_id,response_body_id,deleted_at FROM proxy_capture_tombstones').all()).toEqual([{ request_id: 'req-2026-09-16T11:59:59.999Z', request_body_id: originals.requestBodyId, response_body_id: originals.responseBodyId, deleted_at: '2026-10-16T12:00:00.000Z' }]);
    } finally { clock.mockRestore(); db.close(); }
  });
  it('rolls back exact deletion markers when a real SQLite delete trigger rejects the transaction', () => {
    const db = newDb();
    try {
      insertProxyRequest(db, '2000-01-01T00:00:00.000Z');
      attachOriginals(db, '2000-01-01T00:00:00.000Z');
      db.exec("CREATE TRIGGER prevent_retention BEFORE DELETE ON proxy_requests BEGIN SELECT RAISE(ABORT, 'controlled failure'); END");
      expect(() => enforceProxyRetention(db, 30)).toThrow('controlled failure');
      expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
    } finally { db.close(); }
  });
  it('keeps exact deletion markers after policy is lengthened/disabled without deleting other old-clock observations', () => {
    const db = newDb(), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00.000Z'));
    try {
      const old = '2000-01-01T00:00:00.000Z'; insertProxyRequest(db, old); const originals = attachOriginals(db, old);
      expect(enforceProxyRetention(db, 30)).toBe(1);
      expect(captureWasDeleted(db, 'req-' + old, originals.requestBodyId, originals.responseBodyId)).toBe(true);
      insertProxyRequest(db, '2026-09-01T00:00:00.000Z');
      expect(enforceProxyRetention(db, 90)).toBe(0);
      expect(captureWasDeleted(db, 'req-' + old, originals.requestBodyId, originals.responseBodyId)).toBe(true);
      const changes = db.prepare('SELECT total_changes() AS n').get();
      expect(enforceProxyRetention(db, 0)).toBe(0); expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
      expect(captureWasDeleted(db, 'req-' + old, originals.requestBodyId, originals.responseBodyId)).toBe(true);
      expect(captureWasDeleted(db, 'req-' + old, randomUUID(), originals.responseBodyId)).toBe(false);
      expect(db.prepare('SELECT started_at FROM proxy_requests').all()).toEqual([{ started_at: '2026-09-01T00:00:00.000Z' }]);
    } finally { clock.mockRestore(); db.close(); }
  });
  it('rejects invalid policy or malformed persisted refs without deleting records or making false markers', () => {
    const db = newDb();
    try {
      insertProxyRequest(db, '2000-01-01T00:00:00.000Z');
      for (const days of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => enforceProxyRetention(db, days)).toThrow(RangeError);
      expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 0 });
      attachOriginals(db, '2000-01-01T00:00:00.000Z'); db.exec("UPDATE proxy_capture_bodies SET request_ref='malformed'");
      expect(() => enforceProxyRetention(db, 30)).toThrow('malformed JSON');
      expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
    } finally { db.close(); }
  });
  it('retains unknown stored timestamps rather than treating them as expired', () => {
    const db = newDb();
    try {
      insertProxyRequest(db, 'not-an-instant'); insertProxyRequest(db, '2000-01-01T00:00:00.000Z');
      expect(enforceProxyRetention(db, 30)).toBe(1);
      expect(db.prepare('SELECT started_at FROM proxy_requests').all()).toEqual([{ started_at: 'not-an-instant' }]);
    } finally { db.close(); }
  });
  it('REQ-017 默认 30 天清理过期行，保留近期行', () => {
    const db = newDb();
    // Relative fixtures preserve the exact 30-day assertion as real time advances.
    const now = Date.now();
    const daysAgo = (days: number): string => new Date(now - days * 86_400_000).toISOString();
    insertProxyRequest(db, daysAgo(90));
    insertProxyRequest(db, daysAgo(60));
    const recent = [daysAgo(15), daysAgo(1)];
    for (const startedAt of recent) insertProxyRequest(db, startedAt);

    const deleted = enforceProxyRetention(db);

    expect(deleted).toBe(2);
    const remaining = db
      .prepare('SELECT started_at FROM proxy_requests ORDER BY started_at')
      .all() as Array<{ started_at: string }>;
    expect(remaining.map((r) => r.started_at)).toEqual(recent);
    db.close();
  });

  it('REQ-017 retentionDays = 0 表示不清理', () => {
    const db = newDb();
    insertProxyRequest(db, '2026-01-01T00:00:00.000Z');
    insertProxyRequest(db, '2026-08-03T00:00:00.000Z');

    const deleted = enforceProxyRetention(db, 0);

    expect(deleted).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM proxy_requests').get() as { c: number };
    expect(count.c).toBe(2);
    db.close();
  });

  it('REQ-017 删除超过 1000 行触发 checkpointWal 不抛错', () => {
    const db = newDb();
    const insert = db.prepare(
      'INSERT INTO proxy_requests (request_id, method, url, hostname, started_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 1001; i += 1) {
      insert.run(`req-${i}`, 'GET', 'http://x', 'x', '2026-01-01T00:00:00.000Z');
    }

    expect(() => {
      const deleted = enforceProxyRetention(db);
      expect(deleted).toBe(1001);
    }).not.toThrow();

    const count = db.prepare('SELECT COUNT(*) AS c FROM proxy_requests').get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });
});
