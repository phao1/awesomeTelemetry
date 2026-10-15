import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from './schema.js';
import { enforceProxyRetention } from './retention.js';

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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('REQ-017 数据保留', () => {
  it('REQ-017 默认 30 天清理过期行，保留近期行', () => {
    const db = newDb();
    const recent = [daysAgo(20), daysAgo(1)];
    insertProxyRequest(db, daysAgo(90));
    insertProxyRequest(db, daysAgo(60));
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
