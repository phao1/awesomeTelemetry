import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openWritable } from '../storage/db.js';
import { captureWasDeleted } from '../storage/retention.js';
import { CaptureBodyStore } from './body-store.js';
import { readCaptureBodies, writeCaptureBodies } from './capture-storage.js';
import { OriginalDeletionQueue, PENDING_ORIGINAL_DELETION_SQL, SHARED_ORIGINAL_SQL } from './original-deletions.js';
import { SCHEMA_VERSION, initSchema } from '../storage/schema.js';
import { CaptureJournal } from './capture-journal.js';
import type { CaptureReparseSnapshot } from '../../src/core/trace-types.js';
import { readCaptureAnalysis, writeCaptureAnalysis } from '../storage/capture-analysis.js';

function analysisSnapshot(): CaptureReparseSnapshot {
  return { parserVersion: 3, metricVersion: 1, sourceFingerprint: 'a'.repeat(64), parsedAt: '2026-10-16T00:00:00.000Z', requestFormat: 'unknown', state: 'unknown',
    usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'unknown' },
    completeness: { complete: false, omittedCount: 1, reasons: ['protocol_unknown'] } };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'original-deletions-')), path = join(directory, 'state.sqlite');
  const db = openWritable(path), store = await CaptureBodyStore.create(join(directory, 'bodies'));
  const a = store.begin(), b = store.begin(); a.append(Buffer.from('request原文')); b.append(Buffer.from('response🙂'));
  const [request, response] = await Promise.all([a.finish(), b.finish()]);
  const requestId = randomUUID(), id = Number(db.prepare('INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES(?,?,?,?,?)').run(requestId, 'POST', '/synthetic', 'synthetic', new Date().toISOString()).lastInsertRowid);
  writeCaptureBodies(db, id, { request, response, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
  return { directory, path, db, store, id, requestId, request, response, queue: new OriginalDeletionQueue(db, store), async close() { if (db.open) db.close(); await rm(directory, { recursive: true, force: true }); } };
}

describe('durable explicitly authorized original-file deletion queue core', () => {
  it('adds v16 without rewriting v15 evidence and uses indexed shared-owner/pending lookup plans', async () => {
    const f = await fixture();
    try {
      const before = readCaptureBodies(f.db, f.id);
      f.db.exec("DROP TABLE proxy_original_deletions; DROP INDEX idx_capture_request_original; DROP INDEX idx_capture_response_original; UPDATE _meta SET value='15' WHERE key='schema_version'");
      // Legacy malformed JSON must not make additive index creation fail.
      const insert = f.db.prepare('INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES(?,?,?,?,?)');
      const legacy = Number(insert.run('legacy-malformed', 'GET', '/', 'h', new Date().toISOString()).lastInsertRowid);
      f.db.prepare('INSERT INTO proxy_capture_bodies(proxy_id,request_ref) VALUES(?,?)').run(legacy, 'malformed');
      initSchema(f.db); initSchema(f.db);
      expect(readCaptureBodies(f.db, f.id)).toEqual(before);
      expect(f.db.prepare("SELECT value FROM _meta WHERE key='schema_version'").get()).toEqual({ value: String(SCHEMA_VERSION) });
      expect(f.db.prepare('SELECT request_ref FROM proxy_capture_bodies WHERE proxy_id=?').get(legacy)).toEqual({ request_ref: 'malformed' });
      const shared = JSON.stringify(f.db.prepare('EXPLAIN QUERY PLAN ' + SHARED_ORIGINAL_SQL).all({ proxyId: f.id, a: f.request.id, b: f.response.id }));
      expect(shared).toContain('idx_capture_request_original'); expect(shared).toContain('idx_capture_response_original'); expect(shared).not.toContain('SCAN proxy_capture_bodies');
      const pending = JSON.stringify(f.db.prepare('EXPLAIN QUERY PLAN ' + PENDING_ORIGINAL_DELETION_SQL).all());
      expect(pending).toContain('idx_original_deletions_pending'); expect(pending).not.toContain('USE TEMP B-TREE');
    } finally { await f.close(); }
  });
  it('atomically records exact intent without file IO, then removes originals idempotently while retaining request metadata', async () => {
    const f = await fixture();
    try {
      const before = f.store.status().usedBytes, job = await f.queue.request(f.id, f.requestId);
      expect(job).toMatchObject({ proxyId: f.id, requestId: f.requestId, state: 'pending', error: null, completedAt: null });
      expect(Object.keys(job).sort()).toEqual(['completedAt','createdAt','error','id','proxyId','requestId','state','updatedAt'].sort());
      expect(f.store.status().usedBytes).toBe(before); expect(await readFile(join(f.store.directory, f.request.id + '.body'))).toEqual(Buffer.from('request原文'));
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(true);
      expect((await f.queue.request(f.id, f.requestId)).id).toBe(job.id);
      const done = await f.queue.run(job.id); expect(done).toMatchObject({ state: 'complete', error: null }); expect(done.completedAt).toMatch(/Z$/);
      expect(await f.queue.run(job.id)).toEqual(done); expect(f.queue.get(job.id)).toEqual(done);
      expect(await readdir(f.store.directory)).toEqual([]); expect(f.store.status().usedBytes).toBe(0);
      expect(f.db.prepare('SELECT request_id FROM proxy_requests').all()).toEqual([{ request_id: f.requestId }]);
      expect(readCaptureBodies(f.db, f.id).request).toEqual(f.request);
    } finally { await f.close(); }
  });
  it('clears the bounded reparse summary in the confirmed-intent transaction without creating captures or deleting originals early', async () => {
    const f = await fixture();
    try {
      writeCaptureAnalysis(f.db, f.id, analysisSnapshot());
      const before = f.store.status().usedBytes, job = await f.queue.request(f.id, f.requestId);
      expect(readCaptureAnalysis(f.db, f.id)).toBeNull(); expect(job.state).toBe('pending');
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(true);
      expect(f.store.status().usedBytes).toBe(before); expect(await readFile(join(f.store.directory, f.request.id + '.body'))).toEqual(Buffer.from('request原文'));
      expect(f.db.prepare('SELECT id,request_id FROM proxy_requests').all()).toEqual([{ id: f.id, request_id: f.requestId }]);
      // Defensive pre-existing-intent path also clears any externally reintroduced summary.
      writeCaptureAnalysis(f.db, f.id, analysisSnapshot()); await f.queue.request(f.id, f.requestId); expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
      writeCaptureAnalysis(f.db, f.id, analysisSnapshot()); await f.queue.run(job.id); expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
    } finally { await f.close(); }
  });
  it('rolls back intent, tombstone, body clearing and summary deletion together when the summary clear fails', async () => {
    const f = await fixture();
    try {
      writeCaptureAnalysis(f.db, f.id, analysisSnapshot());
      f.db.prepare('UPDATE proxy_requests SET request_body=?,response_body=?,system_prompt=?,system_prompt_len=? WHERE id=?').run('kept-request', 'kept-response', 'kept-system', 11, f.id);
      f.db.exec("CREATE TRIGGER reject_analysis_clear BEFORE DELETE ON proxy_capture_analysis BEGIN SELECT RAISE(ABORT,'synthetic-summary-clear-failure'); END");
      await expect(f.queue.request(f.id, f.requestId)).rejects.toThrow('synthetic-summary-clear-failure');
      expect(readCaptureAnalysis(f.db, f.id)).toEqual(analysisSnapshot());
      expect(f.db.prepare('SELECT request_body,response_body,system_prompt,system_prompt_len FROM proxy_requests WHERE id=?').get(f.id)).toEqual({ request_body: 'kept-request', response_body: 'kept-response', system_prompt: 'kept-system', system_prompt_len: 11 });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 0 });
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(false);
      f.db.exec('DROP TRIGGER reject_analysis_clear'); await f.queue.request(f.id, f.requestId); expect(readCaptureAnalysis(f.db, f.id)).toBeNull();
    } finally { await f.close(); }
  });
  it('rolls back job and tombstone together on actual SQLite marker failure', async () => {
    const f = await fixture();
    try {
      f.db.exec("CREATE TRIGGER reject_intent BEFORE INSERT ON proxy_capture_tombstones BEGIN SELECT RAISE(ABORT,'controlled intent failure'); END");
      await expect(f.queue.request(f.id, f.requestId)).rejects.toThrow('controlled intent failure');
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 0 });
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(false);
      expect(await readFile(join(f.store.directory, f.response.id + '.body'))).toEqual(Buffer.from('response🙂'));
    } finally { await f.close(); }
  });
  it('rejects unsupported/malformed refs without writing intent or reading unrelated response-header metadata', async () => {
    const f = await fixture();
    try {
      const update = f.db.prepare('UPDATE proxy_capture_bodies SET request_ref=? WHERE proxy_id=?');
      for (const value of ['malformed', 'null', JSON.stringify({ ...f.request, id: '../outside' }), JSON.stringify({ ...f.request, sha256: 'unknown' })]) {
        update.run(value, f.id); await expect(f.queue.request(f.id, f.requestId)).rejects.toMatchObject({ code: 'CAPTURE_DELETE_INVALID_REF' });
      }
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 0 });
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(false);
      update.run(JSON.stringify(f.request), f.id); f.db.prepare('UPDATE proxy_capture_bodies SET response_headers=? WHERE proxy_id=?').run('unrelated-malformed', f.id);
      expect(await f.queue.request(f.id, f.requestId)).toMatchObject({ state: 'pending' });
    } finally { await f.close(); }
  });
  it('keeps exact intent independent of metadata cascades and suppresses a surviving same-owner journal', async () => {
    const f = await fixture();
    try {
      const journal = await CaptureJournal.open(f.db, f.store);
      const ticket = journal.begin({ requestId: f.requestId, method: 'POST', url: '/synthetic', hostname: 'synthetic', requestHeaders: {}, startedAt: new Date().toISOString(), captureGroupId: null,
        requestBodyId: f.request.id, responseBodyId: f.response.id, requestEnded: true, responseEnded: true, responseStatus: 200, responseHeaders: {}, completedAt: null, durationMs: null, transport: null, requestRef: f.request, responseRef: f.response });
      await ticket.ready; const job = await f.queue.request(f.id, f.requestId);
      // Controlled metadata-cascade fixture; the queue itself does not erase rows.
      f.db.prepare('DELETE FROM proxy_requests WHERE id=?').run(f.id);
      expect(f.queue.get(job.id)).toMatchObject({ state: 'pending' });
      await f.queue.resumePending(); expect(f.queue.get(job.id)).toMatchObject({ state: 'complete' });
      expect(await journal.recover(f.db)).toBe(0); expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      expect(await readdir(journal.directory)).toEqual([]); expect(f.store.status().usedBytes).toBe(0);
    } finally { await f.close(); }
  });
  it('rejects wrong identity/shared refs before intent and rechecks late shared ownership before unlink', async () => {
    const f = await fixture();
    try {
      await expect(f.queue.request(f.id, 'wrong')).rejects.toMatchObject({ code: 'CAPTURE_DELETE_CONFLICT' });
      const statement = f.db.prepare('INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES(?,?,?,?,?)');
      const other = Number(statement.run(randomUUID(), 'POST', '/', 'h', new Date().toISOString()).lastInsertRowid);
      writeCaptureBodies(f.db, other, readCaptureBodies(f.db, f.id));
      await expect(f.queue.request(f.id, f.requestId)).rejects.toMatchObject({ code: 'CAPTURE_DELETE_SHARED_ORIGINAL' });
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(false);
      f.db.prepare('DELETE FROM proxy_requests WHERE id=?').run(other);
      const job = await f.queue.request(f.id, f.requestId);
      const late = Number(statement.run(randomUUID(), 'POST', '/', 'h', new Date().toISOString()).lastInsertRowid);
      writeCaptureBodies(f.db, late, { ...readCaptureBodies(f.db, f.id), request: f.response, response: f.request });
      expect(await f.queue.run(job.id)).toMatchObject({ state: 'failed', error: 'CAPTURE_DELETE_SHARED_ORIGINAL', completedAt: null });
      expect(await readFile(join(f.store.directory, f.request.id + '.body'))).toEqual(Buffer.from('request原文'));
    } finally { await f.close(); }
  });
  it('refuses a changed store directory or modified digest without deleting the other original', async () => {
    const f = await fixture();
    try {
      const job = await f.queue.request(f.id, f.requestId), wrong = await CaptureBodyStore.create(join(f.directory, 'different'));
      expect(await new OriginalDeletionQueue(f.db, wrong).run(job.id)).toMatchObject({ state: 'failed', error: 'CAPTURE_DELETE_STORE_MISMATCH' });
      const failed = f.queue.get(job.id); await f.queue.resumePending(); expect(f.queue.get(job.id)).toEqual(failed);
      await writeFile(join(f.store.directory, f.response.id + '.body'), 'tampered');
      expect(await f.queue.run(job.id)).toMatchObject({ state: 'failed', error: 'CAPTURE_RECOVERY_INTEGRITY_FAILED' });
      expect(await readFile(join(f.store.directory, f.request.id + '.body'))).toEqual(Buffer.from('request原文'));
      expect(await readFile(join(f.store.directory, f.response.id + '.body'), 'utf8')).toBe('tampered');
    } finally { await f.close(); }
  });
  it('resumes pending intent after reopening and leaves completed state idempotent', async () => {
    const f = await fixture();
    try {
      const job = await f.queue.request(f.id, f.requestId); f.db.close();
      const db = openWritable(f.path), store = await CaptureBodyStore.create(f.store.directory), queue = new OriginalDeletionQueue(db, store);
      try {
        await queue.resumePending(); expect(queue.get(job.id)).toMatchObject({ state: 'complete' });
        expect(store.status().usedBytes).toBe(0); expect(captureWasDeleted(db, f.requestId, f.request.id, f.response.id)).toBe(true);
        const done = queue.get(job.id); await queue.resumePending(); expect(queue.get(job.id)).toEqual(done);
      } finally { db.close(); }
    } finally { await f.close(); }
  });
  it('keeps restartable pending intent when file deletion succeeds but all state updates fail', async () => {
    const f = await fixture();
    try {
      const job = await f.queue.request(f.id, f.requestId);
      f.db.exec("CREATE TRIGGER reject_state BEFORE UPDATE ON proxy_original_deletions BEGIN SELECT RAISE(ABORT,'controlled state failure'); END");
      await expect(f.queue.run(job.id)).rejects.toMatchObject({ code: 'CAPTURE_DELETE_STATE_WRITE_FAILED' });
      expect(f.queue.get(job.id)).toMatchObject({ state: 'pending', completedAt: null }); expect(await readdir(f.store.directory)).toEqual([]);
      f.db.exec('DROP TRIGGER reject_state'); f.db.close(); const db = openWritable(f.path), store = await CaptureBodyStore.create(f.store.directory);
      try { const queue = new OriginalDeletionQueue(db, store); await queue.resumePending(); expect(queue.get(job.id)).toMatchObject({ state: 'complete' }); expect(store.status().usedBytes).toBe(0); }
      finally { db.close(); }
    } finally { await f.close(); }
  });
  it('bounds real SQLite lock waits and does not write an uncommitted intent', async () => {
    const f = await fixture(), locker = new Database(f.path); let ticked = false;
    try {
      locker.exec('BEGIN IMMEDIATE'); const timer = setTimeout(() => { ticked = true; }, 5), started = performance.now();
      try { await expect(f.queue.request(f.id, f.requestId)).rejects.toMatchObject({ code: 'SQLITE_BUSY' }); } finally { clearTimeout(timer); }
      expect(ticked).toBe(true); expect(performance.now() - started).toBeLessThan(250); expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 0 });
      expect(captureWasDeleted(f.db, f.requestId, f.request.id, f.response.id)).toBe(false);
    } finally { if (locker.inTransaction) locker.exec('ROLLBACK'); locker.close(); await f.close(); }
  });
  it('shares one active run across queue instances without enqueuing other jobs', async () => {
    const f = await fixture();
    try {
      const job = await f.queue.request(f.id, f.requestId), second = new OriginalDeletionQueue(f.db, f.store), task = f.queue.run(job.id);
      expect(second.run(job.id)).toBe(task); await expect(second.run(randomUUID())).rejects.toMatchObject({ code: 'CAPTURE_DELETE_BUSY' });
      await task;
    } finally { await f.close(); }
  });
  it('bounds retained intents at1024 without evicting completed/failed jobs or writing an over-limit marker', async () => {
    const f = await fixture();
    try {
      const initial = await f.queue.request(f.id, f.requestId); await f.queue.run(initial.id);
      const wrong = new OriginalDeletionQueue(f.db, await CaptureBodyStore.create(join(f.directory, 'wrong-capacity-store'))); let failedId = '';
      const insert = f.db.prepare('INSERT INTO proxy_requests(request_id,method,url,hostname,started_at) VALUES(?,?,?,?,?)');
      for (let index = 1; index <= 1024; index += 1) {
        const requestId = randomUUID(), id = Number(insert.run(requestId, 'POST', '/', 'h', new Date().toISOString()).lastInsertRowid);
        const request = { ...f.request, id: randomUUID() }, response = { ...f.response, id: randomUUID() };
        writeCaptureBodies(f.db, id, { request, response, requestPreviewTruncated: true, responsePreviewTruncated: true, responseHeaders: {} });
        if (index < 1024) {
          const job = await f.queue.request(id, requestId);
          if (index === 1) { failedId = job.id; expect(await wrong.run(job.id)).toMatchObject({ state: 'failed' }); }
        }
        else {
          await expect(f.queue.request(id, requestId)).rejects.toMatchObject({ code: 'CAPTURE_DELETE_LIMIT' });
          expect(captureWasDeleted(f.db, requestId, request.id, response.id)).toBe(false);
        }
      }
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_original_deletions').get()).toEqual({ n: 1024 });
      expect(f.queue.get(initial.id)).toMatchObject({ state: 'complete' }); expect(f.queue.get(failedId)).toMatchObject({ state: 'failed' });
    } finally { await f.close(); }
  });
});
