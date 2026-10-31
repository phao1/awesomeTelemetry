import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { openWritable } from '../storage/db.js';
import { enforceProxyRetention } from '../storage/retention.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureJournal, committedCaptureId, retryCaptureCommit } from './capture-journal.js';
import { readCaptureBodies, writeCaptureBodies } from './capture-storage.js';
import { writeRecoveredCapture } from './proxy-writer.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-journal-test-')), path = join(directory, 'state.sqlite');
  const db = openWritable(path), store = await CaptureBodyStore.create(join(directory, 'bodies')), journal = await CaptureJournal.open(db, store);
  const begin = () => journal.begin({ requestId: 'req-' + randomUUID(), method: 'POST', url: '/v1/messages', hostname: 'synthetic', requestHeaders: { authorization: 'Bearer synthetic-original' }, startedAt: '2026-10-16T00:00:00.000Z', captureGroupId: null,
    requestBodyId: randomUUID(), responseBodyId: randomUUID(), requestEnded: false, responseEnded: false, responseStatus: null, responseHeaders: {}, completedAt: null, durationMs: null, transport: null, requestRef: null, responseRef: null });
  return { directory, path, db, store, journal, begin, async close() { db.close(); await rm(directory, { recursive: true, force: true }); } };
}
describe('durable same-database capture journal', () => {
  it('applies current explicit TTL before body IO, preserving exact boundaries, original prefixes and quota', async () => {
    const f = await fixture(), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00.000Z'));
    try {
      const old = f.begin(), equal = f.begin(); await Promise.all([old.ready, equal.ready]);
      await f.journal.write({ ...old.entry, startedAt: '2026-10-15T13:59:59.999+02:00' });
      await f.journal.write({ ...equal.entry, startedAt: '2026-10-15T12:00:00.000Z' });
      const part = join(f.store.directory, old.entry.requestBodyId + '.part'), body = join(f.store.directory, old.entry.requestBodyId + '.body');
      // Conflicting original suffixes prove expired entries do not read/promote/hash originals.
      await writeFile(part, '原文-prefix'); await writeFile(body, 'unmodified-original');
      const before = (await CaptureBodyStore.create(f.store.directory)).status().usedBytes;
      expect(await f.journal.recover(f.db, 1)).toBe(1);
      expect(f.db.prepare('SELECT request_id FROM proxy_requests').all()).toEqual([{ request_id: equal.entry.requestId }]);
      expect(f.db.prepare('SELECT request_id,request_body_id,response_body_id FROM proxy_capture_tombstones').all()).toEqual([{ request_id: old.entry.requestId, request_body_id: old.entry.requestBodyId, response_body_id: old.entry.responseBodyId }]);
      expect(await readFile(part, 'utf8')).toBe('原文-prefix'); expect(await readFile(body, 'utf8')).toBe('unmodified-original');
      expect((await CaptureBodyStore.create(f.store.directory)).status().usedBytes).toBe(before);
      await f.journal.write(old.entry); expect(await f.journal.recover(f.db, 0)).toBe(0);
    } finally { clock.mockRestore(); await f.close(); }
  });
  it('retains expired journals on real marker failure and never masks committed request-id conflicts', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready; const entry = { ...ticket.entry, startedAt: '2000-01-01T00:00:00.000Z' }; await f.journal.write(entry);
      f.db.exec("CREATE TRIGGER reject_expiry BEFORE INSERT ON proxy_capture_tombstones BEGIN SELECT RAISE(ABORT, 'controlled expiry failure'); END");
      await expect(f.journal.recover(f.db, 1)).rejects.toThrow('controlled expiry failure');
      expect(await readdir(f.journal.directory)).toEqual([entry.captureId + '.json']);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      f.db.exec('DROP TRIGGER reject_expiry'); writeRecoveredCapture(f.db, entry);
      await expect(f.journal.recover(f.db, 1)).rejects.toMatchObject({ code: 'CAPTURE_RECOVERY_CONFLICT' });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 0 });
      expect(await readdir(f.journal.directory)).toEqual([entry.captureId + '.json']);
    } finally { await f.close(); }
  });
  it('suppresses only exactly deleted same-owner journals before body IO, preserving quota/foreign and distinct old-clock evidence', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready;
      await f.journal.write({ ...ticket.entry, startedAt: '2000-01-01T00:00:00.000Z' });
      const expired = { ...ticket.entry, startedAt: '2000-01-01T00:00:00.000Z' }, id = writeRecoveredCapture(f.db, expired);
      const ref = (id: string) => ({ id, bytes: 0, sha256: '0'.repeat(64), status: 'interrupted' as const, error: null });
      writeCaptureBodies(f.db, id, { request: ref(expired.requestBodyId), response: ref(expired.responseBodyId), requestPreviewTruncated: true, responsePreviewTruncated: true, responseHeaders: {} });
      const body = join(f.store.directory, ticket.entry.requestBodyId + '.body'), part = join(f.store.directory, ticket.entry.requestBodyId + '.part');
      await writeFile(body, 'retained-original'); await writeFile(part, 'retained-conflicting-prefix');
      const counted = await CaptureBodyStore.create(f.store.directory), before = counted.status().usedBytes;
      const foreign = { ...ticket.entry, ownerId: randomUUID(), captureId: randomUUID(), startedAt: '2000-01-01T00:00:00.000Z' };
      const foreignPath = join(f.journal.directory, foreign.captureId + '.json'); await writeFile(foreignPath, JSON.stringify(foreign));
      expect(enforceProxyRetention(f.db, 30)).toBe(1); expect(await f.journal.recover(f.db)).toBe(0);
      expect(await readdir(f.journal.directory)).toEqual([foreign.captureId + '.json']);
      expect(await readFile(body, 'utf8')).toBe('retained-original'); expect(await readFile(part, 'utf8')).toBe('retained-conflicting-prefix');
      expect((await CaptureBodyStore.create(f.store.directory)).status().usedBytes).toBe(before);
      expect(JSON.parse(await readFile(foreignPath, 'utf8'))).toEqual(foreign);
      const boundary = { ...ticket.entry, captureId: randomUUID(), startedAt: '1999-01-01T00:00:00.000Z', requestBodyId: randomUUID(), responseBodyId: randomUUID() };
      await f.journal.write(boundary); expect(enforceProxyRetention(f.db, 0)).toBe(0); expect(await f.journal.recover(f.db)).toBe(1);
      expect(f.db.prepare('SELECT started_at FROM proxy_requests').get()).toEqual({ started_at: boundary.startedAt });
    } finally { await f.close(); }
  });
  it('bounds expiry lock waits and preserves the original journal for retry', async () => {
    const f = await fixture(), locker = new Database(f.path);
    try {
      const ticket = f.begin(); await ticket.ready; await f.journal.write({ ...ticket.entry, startedAt: '2000-01-01T00:00:00.000Z' });
      locker.exec('BEGIN IMMEDIATE'); const started = performance.now(); let ticked = false;
      const tick = setTimeout(() => { ticked = true; }, 5);
      try { await expect(f.journal.recover(f.db, 1)).rejects.toMatchObject({ code: 'SQLITE_BUSY' }); } finally { clearTimeout(tick); }
      expect(ticked).toBe(true); expect(performance.now() - started).toBeLessThan(250);
      expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(await readdir(f.journal.directory)).toEqual([ticket.entry.captureId + '.json']);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 0 });
      locker.exec('ROLLBACK'); expect(await f.journal.recover(f.db, 1)).toBe(0);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 1 });
    } finally { if (locker.inTransaction) locker.exec('ROLLBACK'); locker.close(); await f.close(); }
  });
  it('yields across500 expired journal identities under a pinned WAL reader without graph/body writes', async () => {
    const f = await fixture(), reader = new Database(f.path), loop = monitorEventLoopDelay({ resolution: 1 });
    try {
      const ticket = f.begin(); await ticket.ready; await ticket.remove();
      for (let index = 0; index < 500; index += 1) await f.journal.write({ ...ticket.entry, requestId: randomUUID(), captureId: randomUUID(), requestBodyId: randomUUID(), responseBodyId: randomUUID(), startedAt: '2000-01-01T00:00:00.000Z' });
      f.db.pragma('wal_checkpoint(TRUNCATE)'); reader.exec('BEGIN'); reader.prepare('SELECT request_id FROM proxy_capture_tombstones').all();
      loop.enable(); let ticks = 0; const ticker = setInterval(() => { ticks += 1; }, 1);
      try { expect(await f.journal.recover(f.db, 1)).toBe(0); } finally { clearInterval(ticker); loop.disable(); }
      expect(ticks).toBeGreaterThan(10); expect(loop.count).toBeGreaterThan(10); expect(loop.percentile(99) / 1e6).toBeLessThan(50);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_capture_tombstones').get()).toEqual({ n: 500 });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      expect((await stat(f.path + '-wal')).size).toBeLessThan(20_000_000);
      expect((await stat(f.path)).size + (await stat(f.path + '-wal')).size).toBeLessThan(200_000_000);
      expect(await readdir(f.journal.directory)).toEqual([]);
    } finally { loop.disable(); if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); await f.close(); }
  });
  it('does not guess an uncommitted old journal was deleted just because explicit retention was previously applied', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready;
      await f.journal.write({ ...ticket.entry, startedAt: '2000-01-01T00:00:00.000Z' });
      expect(enforceProxyRetention(f.db, 30)).toBe(0); expect(enforceProxyRetention(f.db, 0)).toBe(0);
      expect(await f.journal.recover(f.db)).toBe(1);
      expect(f.db.prepare('SELECT started_at FROM proxy_requests').get()).toEqual({ started_at: '2000-01-01T00:00:00.000Z' });
    } finally { await f.close(); }
  });
  it('persists original headers with private permissions and stable DB ownership, without any original body spool', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready;
      const path = join(f.journal.directory, ticket.entry.captureId + '.json');
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(ticket.entry); expect((await stat(path)).mode & 0o777).toBe(0o600);
      const second = openWritable(f.path);
      try { expect((await CaptureJournal.open(second, f.store)).ownerId).toBe(f.journal.ownerId); } finally { second.close(); }
      expect(await readdir(f.store.directory)).toEqual(['.capture-journal']);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
    } finally { await f.close(); }
  });
  it('recovers exact crash prefixes once and leaves unknown clocks/model/usage null', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready;
      await writeFile(join(f.store.directory, ticket.entry.requestBodyId + '.part'), 'request🙂');
      await writeFile(join(f.store.directory, ticket.entry.responseBodyId + '.part'), 'data: prefix\n\n');
      await ticket.update({ requestEnded: true, responseStatus: 200, responseHeaders: { 'content-type': 'text/event-stream', 'set-cookie': ['one=original', 'two=original'] } });
      expect(await f.journal.recover(f.db)).toBe(1); expect(await f.journal.recover(f.db)).toBe(0);
      const row = f.db.prepare('SELECT id,completed_at,duration_ms,model,input_tokens,output_tokens,request_headers FROM proxy_requests').get() as { id: number; request_headers: string };
      expect(row).toMatchObject({ completed_at: null, duration_ms: null, model: null, input_tokens: null, output_tokens: null });
      expect(JSON.parse(row.request_headers)).toEqual({ authorization: 'Bearer synthetic-original' });
      expect(readCaptureBodies(f.db, row.id)).toMatchObject({ request: { status: 'interrupted', bytes: Buffer.byteLength('request🙂') }, response: { status: 'interrupted', bytes: 14 }, processing: { status: 'closed' }, transport: { state: 'interrupted', error: 'CAPTURE_PROCESS_LOST', requestEnded: true, responseEnded: false, statusCode: 200 } });
      expect((await readFile(join(f.store.directory, ticket.entry.requestBodyId + '.body'))).toString()).toBe('request🙂');
    } finally { await f.close(); }
  });
  it('preserves durable terminal clocks and finished refs but does not invent completed processing', async () => {
    const f = await fixture();
    try {
      const a = f.store.begin(), b = f.store.begin(); a.append(Buffer.from('request')); b.append(Buffer.from('response'));
      const requestRef = await a.finish(), responseRef = await b.finish();
      const base = f.begin(); await base.ready; await base.remove();
      const entry = { ...base.entry, requestBodyId: a.id, responseBodyId: b.id, requestRef, responseRef, completedAt: '2026-10-16T00:00:00.100Z', durationMs: 100, requestEnded: true, responseEnded: true, responseStatus: 503,
        transport: { version: 1 as const, state: 'http_error' as const, error: 'HTTP_ERROR', requestEnded: true, responseEnded: true, statusCode: 503 } };
      await f.journal.write(entry); expect(await f.journal.recover(f.db)).toBe(1);
      expect(readCaptureBodies(f.db, 1)).toMatchObject({ request: requestRef, response: responseRef, transport: entry.transport, processing: { status: 'closed' } });
      expect(f.db.prepare('SELECT completed_at,duration_ms FROM proxy_requests').get()).toEqual({ completed_at: entry.completedAt, duration_ms: 100 });
    } finally { await f.close(); }
  });
  it('cleans only a matching committed journal and refuses equal request IDs with different original IDs', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready;
      const id = writeRecoveredCapture(f.db, ticket.entry);
      await expect(f.journal.recover(f.db)).rejects.toThrow('CAPTURE_RECOVERY_CONFLICT');
      expect(await readdir(f.journal.directory)).toContain(ticket.entry.captureId + '.json');
      const ref = (id: string) => ({ id, bytes: 0, sha256: '0'.repeat(64), status: 'interrupted' as const, error: 'test' });
      writeCaptureBodies(f.db, id, { request: ref(ticket.entry.requestBodyId), response: ref(ticket.entry.responseBodyId), requestPreviewTruncated: true, responsePreviewTruncated: true, responseHeaders: {} });
      expect(committedCaptureId(f.db, ticket.entry)).toBe(id); expect(await f.journal.recover(f.db)).toBe(0);
      expect(await readdir(f.journal.directory)).toEqual([]); expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
    } finally { await f.close(); }
  });
  it('does not adopt foreign-owner journals, delete malformed evidence or claim missing originals complete', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready;
      const other = openWritable(join(f.directory, 'other.sqlite'));
      try { expect(await (await CaptureJournal.open(other, f.store)).recover(other)).toBe(0); } finally { other.close(); }
      expect(await f.journal.recover(f.db)).toBe(1); expect(readCaptureBodies(f.db, 1).request).toMatchObject({ status: 'write_error', error: 'CAPTURE_BODY_MISSING' });
      const invalid = join(f.journal.directory, randomUUID() + '.json'); await writeFile(invalid, '{broken');
      await expect(f.journal.recover(f.db)).rejects.toThrow('CAPTURE_RECOVERY_INVALID'); expect(await readFile(invalid, 'utf8')).toBe('{broken');
    } finally { await f.close(); }
  });
  it('bounds admission queues and serialized metadata, without creating untracked originals', async () => {
    const f = await fixture();
    try {
      const tickets = Array.from({ length: 64 }, () => f.begin()), overflow = f.begin();
      await expect(overflow.ready).rejects.toMatchObject({ code: 'CAPTURE_JOURNAL_LIMIT' });
      await Promise.all(tickets.map(ticket => ticket.ready));
      const huge = { ...tickets[0]!.entry, requestHeaders: { huge: 'x'.repeat(256 * 1024) } };
      await expect(f.journal.write(huge)).rejects.toMatchObject({ code: 'CAPTURE_JOURNAL_LIMIT' });
      expect(await readdir(f.journal.directory)).toHaveLength(64);
    } finally { await f.close(); }
  });
  it('coalesces repeated updates into one admitted job/latest snapshot instead of a hidden promise queue', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(), updates = Array.from({ length: 1000 }, () => ticket.update({ requestEnded: true, responseStatus: 200 }));
      expect(new Set(updates).size).toBe(1); await ticket.ready; await Promise.all(updates);
      const saved = JSON.parse(await readFile(join(f.journal.directory, ticket.entry.captureId + '.json'), 'utf8'));
      expect(saved).toEqual(ticket.entry); expect(saved.requestEnded).toBe(true); expect(saved.responseStatus).toBe(200);
    } finally { await f.close(); }
  });
  it('stops journal growth at16MiB without evicting retained metadata', async () => {
    const f = await fixture();
    try {
      const ticket = f.begin(); await ticket.ready; await ticket.remove();
      let accepted = 0;
      for (let index = 0; index < 80; index += 1) {
        const entry = { ...ticket.entry, captureId: randomUUID(), requestHeaders: { retained: 'x'.repeat(240 * 1024) } };
        if (index < 68) { await f.journal.write(entry); accepted += 1; }
        else { await expect(f.journal.write(entry)).rejects.toMatchObject({ code: 'CAPTURE_JOURNAL_LIMIT' }); break; }
      }
      expect(accepted).toBe(68); expect(await readdir(f.journal.directory)).toHaveLength(accepted);
    } finally { await f.close(); }
  });
  it('retries real SQLite locks without blocking the loop, restoring the configured busy timeout', async () => {
    const f = await fixture(), locker = new Database(f.path); let attempts = 0, released = false;
    try {
      const statement = f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,?)');
      locker.exec('BEGIN IMMEDIATE');
      const release = setTimeout(() => { locker.exec('ROLLBACK'); released = true; }, 5);
      try { await retryCaptureCommit(f.db, () => { attempts += 1; statement.run('retry-proof', 'saved'); }); } finally { clearTimeout(release); }
      expect(released).toBe(true); expect(attempts).toBe(2); expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(f.db.prepare('SELECT value FROM _meta WHERE key=?').get('retry-proof')).toEqual({ value: 'saved' });
    } finally { if (locker.inTransaction) locker.exec('ROLLBACK'); locker.close(); await f.close(); }
  });
  it('limits persistent locks to3 attempts and never retries permanent constraint errors', async () => {
    const f = await fixture(), locker = new Database(f.path); let attempts = 0;
    try {
      const statement = f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,?)');
      locker.exec('BEGIN IMMEDIATE'); const started = performance.now();
      await expect(retryCaptureCommit(f.db, () => { attempts += 1; statement.run('locked', 'value'); })).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
      expect(attempts).toBe(3); expect(performance.now() - started).toBeLessThan(250); expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
      locker.exec('ROLLBACK'); attempts = 0;
      await expect(retryCaptureCommit(f.db, () => { attempts += 1; statement.run('capture_journal_owner', 'duplicate'); })).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
      expect(attempts).toBe(1); expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally { if (locker.inTransaction) locker.exec('ROLLBACK'); locker.close(); await f.close(); }
  });
});
