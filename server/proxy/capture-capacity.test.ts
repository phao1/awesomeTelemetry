import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { checkpointWal, openReadonly, openWritable } from '../storage/db.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureJournal, retryCaptureCommit } from './capture-journal.js';
import { readCaptureCapacity, withCaptureCapacity } from './capture-capacity.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-capacity-')), path = join(directory, 'state.sqlite'), db = openWritable(path);
  return { directory, path, db, async close() { if (db.open) db.close(); await rm(directory, { recursive: true, force: true }); } };
}
function pinAndFill(db: Database.Database, path: string): Database.Database {
  checkpointWal(db); db.pragma('wal_autocheckpoint=0');
  const reader = openReadonly(path); reader.exec('BEGIN'); reader.prepare('SELECT value FROM _meta WHERE key=?').get('schema_version');
  const insert = db.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(393216)) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (let i = 0; i < 100 && statSync(path + '-wal').size < 12_000_000; i += 1) insert.run('capacity-pressure-' + i);
  expect(statSync(path + '-wal').size).toBeGreaterThanOrEqual(12_000_000);
  return reader;
}
describe('capture-only database pressure admission', () => {
  it('reports actual sizes without writes or checkpoint and never exposes internal paths', async () => {
    const f = await fixture();
    try {
      const changes = f.db.prepare('SELECT total_changes() AS n');
      const before = changes.get(), wal = (await stat(f.path + '-wal')).size, value = await readCaptureCapacity(f.db);
      expect(value).toMatchObject({ state: 'ready', reason: null, databaseBytes: (await stat(f.path)).size, walBytes: wal,
        combinedLimitBytes: 200_000_000, walLimitBytes: 20_000_000, combinedAdmissionBytes: 180_000_000, walAdmissionBytes: 8_000_000 });
      expect(new Date(value.checkedAt).toISOString()).toBe(value.checkedAt);
      expect(JSON.stringify(value)).not.toContain(f.directory); expect(changes.get()).toEqual(before);
      expect((await stat(f.path + '-wal')).size).toBe(wal);
    } finally { await f.close(); }
  });
  it('fails closed on a real missing database file rather than inventing zero capacity', async () => {
    const f = await fixture();
    try {
      await rename(f.path, f.path + '.held');
      try {
        expect(await readCaptureCapacity(f.db)).toMatchObject({ state: 'unavailable', reason: 'stat_error', databaseBytes: null, walBytes: null });
        await expect(withCaptureCapacity(f.db, () => { throw new Error('must not run'); })).rejects.toMatchObject({ code: 'CAPTURE_METADATA_UNAVAILABLE' });
      } finally { await rename(f.path + '.held', f.path); }
      expect((await readCaptureCapacity(f.db)).state).toBe('ready');
    } finally { await f.close(); }
  });
  it('rejects an actual apparent-size combined high watermark without mutating scan data', async () => {
    const f = await fixture(), size = (await stat(f.path)).size;
    try {
      // Sparse extension is a file-length fixture, not a physical disk-full test.
      await truncate(f.path, 180_000_000);
      expect(await readCaptureCapacity(f.db)).toMatchObject({ state: 'limited', reason: 'database_limit' });
      await expect(withCaptureCapacity(f.db, () => f.db.exec('DELETE FROM sessions'))).rejects.toMatchObject({ code: 'CAPTURE_METADATA_LIMIT' });
    } finally { await truncate(f.path, size); await f.close(); }
  });
  it('bounds shared admission to64 actions, preserves order and releases a failed owner', async () => {
    const db = new Database(':memory:'), calls: number[] = [];
    try {
      const tasks = Array.from({ length: 65 }, (_, index) => withCaptureCapacity(db, () => { calls.push(index); if (index === 0) throw new Error('synthetic-action-failure'); return index; }));
      const result = await Promise.allSettled(tasks);
      expect(result[0]).toMatchObject({ status: 'rejected', reason: { message: 'synthetic-action-failure' } });
      expect(result[64]).toMatchObject({ status: 'rejected', reason: { code: 'CAPTURE_METADATA_QUEUE_FULL' } });
      expect(calls).toEqual(Array.from({ length: 64 }, (_, i) => i));
      expect(await withCaptureCapacity(db, () => 99)).toBe(99);
    } finally { db.close(); }
  });
  it('refuses pinned WAL growth without waiting and resumes after the reader releases', async () => {
    const f = await fixture(), reader = pinAndFill(f.db, f.path);
    try {
      const before = (await stat(f.path + '-wal')).size, started = performance.now();
      expect(await readCaptureCapacity(f.db)).toMatchObject({ state: 'limited', reason: 'wal_limit' });
      await expect(withCaptureCapacity(f.db, () => f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,?)').run('no-admission', 'no'))).rejects.toMatchObject({ code: 'CAPTURE_METADATA_LIMIT' });
      expect(performance.now() - started).toBeLessThan(50); expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect((await stat(f.path + '-wal')).size).toBe(before); expect(before).toBeLessThan(20_000_000);
      reader.exec('ROLLBACK');
      expect(await withCaptureCapacity(f.db, () => 42)).toBe(42);
      expect((await readCaptureCapacity(f.db)).state).toBe('ready'); expect((await stat(f.path + '-wal')).size).toBe(0);
    } finally { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); await f.close(); }
  });
  it('retains an admitted journal and real original on native SQLITE_FULL, then recovers exactly once', async () => {
    const f = await fixture(), store = await CaptureBodyStore.create(join(f.directory, 'bodies')), journal = await CaptureJournal.open(f.db, store);
    try {
      const ticket = journal.begin({ requestId: 'native-full', method: 'POST', url: '/v1/messages', hostname: 'synthetic', requestHeaders: {}, startedAt: new Date().toISOString(), captureGroupId: null,
        requestBodyId: randomUUID(), responseBodyId: randomUUID(), requestEnded: false, responseEnded: false, responseStatus: null, responseHeaders: {}, completedAt: null, durationMs: null, transport: null, requestRef: null, responseRef: null });
      await ticket.ready; const original = join(store.directory, ticket.entry.requestBodyId + '.part'); await writeFile(original, '保留原文🙂');
      const maximum = f.db.pragma('max_page_count', { simple: true }) as number, pages = f.db.pragma('page_count', { simple: true }) as number;
      f.db.pragma(`max_page_count=${pages}`);
      await expect(retryCaptureCommit(f.db, () => f.db.transaction(() => {
        f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(1048576))').run('native-sqlite-full');
      })(), true)).rejects.toMatchObject({ code: 'SQLITE_FULL' });
      expect(f.db.prepare('SELECT value FROM _meta WHERE key=?').get('native-sqlite-full')).toBeUndefined();
      expect(await readFile(original, 'utf8')).toBe('保留原文🙂'); expect(await readdir(journal.directory)).toEqual([ticket.entry.captureId + '.json']);
      expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000); f.db.pragma(`max_page_count=${maximum}`);
      expect(await journal.recover(f.db)).toBe(1); expect(await journal.recover(f.db)).toBe(0);
      expect(await readFile(join(store.directory, ticket.entry.requestBodyId + '.body'), 'utf8')).toBe('保留原文🙂');
    } finally { await f.close(); }
  });
  it('rejects new journal admission but preserves accepted updates and pressure-blocked recovery', async () => {
    const f = await fixture(), store = await CaptureBodyStore.create(join(f.directory, 'bodies')), journal = await CaptureJournal.open(f.db, store);
    const input = { requestId: 'pressure-journal', method: 'POST', url: '/v1/messages', hostname: 'synthetic', requestHeaders: {}, startedAt: new Date().toISOString(), captureGroupId: null,
      requestBodyId: randomUUID(), responseBodyId: randomUUID(), requestEnded: false, responseEnded: false, responseStatus: null, responseHeaders: {}, completedAt: null, durationMs: null, transport: null, requestRef: null, responseRef: null };
    const ticket = journal.begin(input); await ticket.ready; const reader = pinAndFill(f.db, f.path);
    try {
      const rejected = journal.begin({ ...input, requestId: 'rejected-new' }); await expect(rejected.ready).rejects.toMatchObject({ code: 'CAPTURE_METADATA_LIMIT' });
      await ticket.update({ requestEnded: true });
      await expect(journal.recover(f.db)).rejects.toMatchObject({ code: 'CAPTURE_METADATA_LIMIT' });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      expect(await readdir(journal.directory)).toEqual([ticket.entry.captureId + '.json']);
      expect(JSON.parse(await readFile(join(journal.directory, ticket.entry.captureId + '.json'), 'utf8'))).toMatchObject({ requestEnded: true });
      reader.exec('ROLLBACK'); expect(await journal.recover(f.db)).toBe(1);
    } finally { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); await journal.drain(); await f.close(); }
  });
});
