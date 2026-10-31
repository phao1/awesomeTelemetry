import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHook } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { claudeFixture } from '../../src/adapters/__fixtures__/claude.js';
import type { TraceEventRaw } from '../../src/core/trace-types.js';
import { normalizeClaudeSample } from '../../src/adapters/claude-code.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { checkpointWal, openReadonly, openWritable } from '../storage/db.js';
import { readCaptureCapacity, withCaptureCapacity } from './capture-capacity.js';

// readCaptureCapacity launches exactly two actual lstat operations, DB then WAL.
// Insert a synchronous native commit after the WAL IO callback, before its
// Promise continuation consumes that real (now stale) file-size result. No IO,
// capacity, scanner or SQLite logic is mocked and no production hook is added.
function atWalSnapshot(write: (read: number) => void) {
  let calls = 0, reads = 0, failure: unknown = null;
  const wal = new Set<number>();
  const hook = createHook({
    init(id, type) { if (type === 'FSREQPROMISE' && ++calls % 2 === 0) wal.add(id); },
    after(id) { if (wal.delete(id)) { reads += 1; try { write(reads); } catch (error) { failure = error; } } },
  });
  hook.enable();
  return { get reads() { return reads; }, get failure() { return failure; }, close() { hook.disable(); } };
}
async function fixture(secondConnection = false) {
  const directory = await mkdtemp(join(tmpdir(), 'capture-snapshot-race-')), path = join(directory, 'state.sqlite');
  const db = openWritable(path), writer = secondConnection ? openWritable(path) : db;
  const source = join(directory, 'synthetic-native.jsonl'), key = 'synthetic-native';
  const record = normalizeClaudeSample(claudeFixture, source);
  storeTraceRecord(writer, record, source, key);
  checkpointWal(db); db.pragma('wal_autocheckpoint=0'); writer.pragma('wal_autocheckpoint=0');
  return { db, writer, directory, path, source, key, record, async close() {
    if (writer !== db) writer.close(); db.close(); await rm(directory, { recursive: true, force: true });
  } };
}
describe('capture admission snapshot versus native SQLite writers', () => {
  it('observes the actual WAL IO boundary without replacing filesystem results', async () => {
    const f = await fixture(), io = atWalSnapshot(() => {});
    try { expect((await readCaptureCapacity(f.db)).walBytes).toBe(statSync(f.path + '-wal').size); expect(io.reads).toBe(1); expect(io.failure).toBeNull(); }
    finally { io.close(); await f.close(); }
  });
  it.each([
    { second: false, postCheckpoint: false }, { second: true, postCheckpoint: false },
    { second: false, postCheckpoint: true }, { second: true, postCheckpoint: true },
  ])('revalidates native growth with second=$second and postCheckpoint=$postCheckpoint', async ({ second, postCheckpoint }) => {
    const f = await fixture(second), reader = openReadonly(f.path);
    let calls = 0, io: ReturnType<typeof atWalSnapshot> | null = null;
    try {
      reader.exec('BEGIN'); reader.prepare('SELECT value FROM _meta WHERE key=?').get('schema_version');
      const fill = f.writer.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(262144))');
      for (let i = 0; statSync(f.path + '-wal').size < (postCheckpoint ? 8_200_000 : 7_600_000); i += 1) fill.run('fixture-pressure-' + i);
      const before = (await stat(f.path + '-wal')).size;
      if (postCheckpoint) expect(before).toBeGreaterThanOrEqual(8_000_000); else expect(before).toBeLessThan(8_000_000);
      const raw = JSON.stringify({ synthetic: 'x'.repeat(1024 * 1024) });
      const event: TraceEventRaw = { ...f.record.events[0]!, raw }; f.record.events[0] = event;
      const changes = f.db.prepare('SELECT total_changes() AS n').get();
      io = atWalSnapshot(read => { if (read === (postCheckpoint ? 2 : 1)) storeTraceRecord(f.writer, f.record, f.source, f.key); });
      const outcome = await withCaptureCapacity(f.db, () => { calls += 1; return 'incorrectly-admitted'; }).then(value => ({ value }), error => ({ error }));
      io.close(); expect(io.failure).toBeNull();
      if (second) expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
      const after = (await stat(f.path + '-wal')).size; expect(after).toBeGreaterThanOrEqual(8_000_000); expect(after).toBeLessThan(20_000_000);
      expect(f.db.prepare('SELECT raw FROM event_raw WHERE session_id=? AND event_id=?').get(f.key, f.record.events[0]!.id)).toEqual({ raw });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: f.record.events.length });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM metrics').get()).toEqual({ n: 1 });
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM trace_identities WHERE source_id=?').get('scan:' + f.key)).toEqual({ n: f.record.nativeIdentities!.items.length });
      await mkdir(join(process.cwd(), 'reports'), { recursive: true });
      await writeFile(join(process.cwd(), 'reports', 'capture-capacity-race-' + Date.now() + '-' + process.pid + '-' + Number(second) + '-' + Number(postCheckpoint) + '.json'), JSON.stringify({
        observedAt: new Date().toISOString(), secondConnection: second, postCheckpoint, beforeWal: before, afterWal: after,
        snapshots: io.reads, admitted: 'value' in outcome, actionCalls: calls, nativeRawBytes: Buffer.byteLength(raw), nativeEvents: f.record.events.length,
        nativeIdentities: f.record.nativeIdentities!.items.length, scope: 'Real SQLite/native writer and lstat interleaving; no mocked sizes/logic. Not arbitrary future writer protection or long-term partition/soak proof.',
      }, null, 2), { flag: 'wx' });
      expect(outcome).toMatchObject({ error: { code: 'CAPTURE_METADATA_LIMIT' } }); expect(calls).toBe(0); expect(io.reads).toBe(3);
      expect(f.db.pragma('busy_timeout', { simple: true })).toBe(5000);
      reader.exec('ROLLBACK'); expect(await withCaptureCapacity(f.db, () => 42)).toBe(42);
      expect((await readCaptureCapacity(f.db)).state).toBe('ready');
    } finally { io?.close(); if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); await f.close(); }
  });
  it('rechecks a changed but still-small native snapshot and invokes the capture action exactly once', async () => {
    const f = await fixture(); let calls = 0;
    const io = atWalSnapshot(read => {
      if (read !== 1) return;
      const event: TraceEventRaw = { ...f.record.events[0]!, raw: JSON.stringify({ synthetic: 'native update' }) }; f.record.events[0] = event; storeTraceRecord(f.db, f.record, f.source, f.key);
    });
    try {
      expect(await withCaptureCapacity(f.db, () => { calls += 1; return 42; })).toBe(42); expect(calls).toBe(1); expect(io.reads).toBe(2); expect(io.failure).toBeNull();
    } finally { io.close(); await f.close(); }
  });
  it('bounds repeated native churn to3 snapshots, fails closed, and releases the shared lane', async () => {
    const f = await fixture(); let calls = 0, writes = 0;
    const update = f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,?)');
    const io = atWalSnapshot(() => { writes += 1; update.run('native-churn-' + writes, String(writes)); });
    try {
      await expect(withCaptureCapacity(f.db, () => { calls += 1; })).rejects.toMatchObject({ code: 'CAPTURE_METADATA_UNAVAILABLE' });
      expect(calls).toBe(0); expect(io.reads).toBe(3); expect(writes).toBe(3);
      expect(io.failure).toBeNull(); io.close(); expect(await withCaptureCapacity(f.db, () => 42)).toBe(42);
    } finally { io.close(); await f.close(); }
  });
  it('refuses a caller-owned transaction before any async stat and preserves the caller transaction', async () => {
    const f = await fixture(), io = atWalSnapshot(() => {}); let calls = 0;
    try {
      f.db.exec('BEGIN');
      await expect(withCaptureCapacity(f.db, () => { calls += 1; })).rejects.toMatchObject({ code: 'CAPTURE_METADATA_UNAVAILABLE' });
      expect(calls).toBe(0); expect(io.reads).toBe(0); expect(f.db.inTransaction).toBe(true);
      f.db.exec('ROLLBACK'); expect(await withCaptureCapacity(f.db, () => 42)).toBe(42);
    } finally { io.close(); if (f.db.inTransaction) f.db.exec('ROLLBACK'); await f.close(); }
  });
  it('refuses a transaction opened during IO without rolling back its owner', async () => {
    const f = await fixture(); let calls = 0;
    const io = atWalSnapshot(read => { if (read === 1) f.db.exec('BEGIN'); });
    try {
      await expect(withCaptureCapacity(f.db, () => { calls += 1; })).rejects.toMatchObject({ code: 'CAPTURE_METADATA_UNAVAILABLE' });
      io.close(); expect(io.failure).toBeNull(); expect(io.reads).toBe(1); expect(calls).toBe(0); expect(f.db.inTransaction).toBe(true);
      f.db.exec('ROLLBACK'); expect(await withCaptureCapacity(f.db, () => 42)).toBe(42);
    } finally { io.close(); if (f.db.inTransaction) f.db.exec('ROLLBACK'); await f.close(); }
  });
  it('conservatively rechecks rolled-back writes without retaining a fabricated native row', async () => {
    const f = await fixture(); let calls = 0;
    const update = f.db.prepare('INSERT INTO _meta(key,value) VALUES(?,?)');
    const io = atWalSnapshot(read => {
      if (read !== 1) return;
      f.db.exec('BEGIN'); update.run('rolled-back-native', 'not committed'); f.db.exec('ROLLBACK');
    });
    try {
      expect(await withCaptureCapacity(f.db, () => { calls += 1; return 42; })).toBe(42);
      io.close(); expect(io.failure).toBeNull(); expect(io.reads).toBe(2); expect(calls).toBe(1);
      expect(f.db.prepare('SELECT value FROM _meta WHERE key=?').get('rolled-back-native')).toBeUndefined();
    } finally { io.close(); if (f.db.inTransaction) f.db.exec('ROLLBACK'); await f.close(); }
  });
  it.each([0, 137])('restores the exact busy timeout %s before success or an action failure', async timeout => {
    const f = await fixture();
    try {
      f.db.pragma(`busy_timeout=${timeout}`);
      expect(await withCaptureCapacity(f.db, () => f.db.pragma('busy_timeout', { simple: true }))).toBe(timeout);
      const failure = new Error('synthetic-action-failure');
      await expect(withCaptureCapacity(f.db, () => { throw failure; })).rejects.toBe(failure);
      expect(f.db.pragma('busy_timeout', { simple: true })).toBe(timeout);
    } finally { await f.close(); }
  });
  it('revalidates same-connection schema writes that do not increment total_changes', async () => {
    const f = await fixture(); let calls = 0;
    const before = f.db.prepare('SELECT total_changes() AS n').get();
    const io = atWalSnapshot(read => { if (read === 1) f.db.exec('CREATE INDEX synthetic_native_schema_race ON events(title)'); });
    try {
      expect(await withCaptureCapacity(f.db, () => { calls += 1; return 42; })).toBe(42);
      io.close(); expect(io.failure).toBeNull(); expect(io.reads).toBe(2); expect(calls).toBe(1);
      expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    } finally { io.close(); await f.close(); }
  });
  it('observes a timeout changed during IO rather than restoring a stale prepared-PRAGMA value', async () => {
    const f = await fixture(); f.db.pragma('busy_timeout=137');
    const io = atWalSnapshot(read => { if (read === 1) f.db.pragma('busy_timeout=271'); });
    try {
      expect(await withCaptureCapacity(f.db, () => f.db.pragma('busy_timeout', { simple: true }))).toBe(271);
      io.close(); expect(io.failure).toBeNull(); expect(io.reads).toBe(1); expect(f.db.pragma('busy_timeout', { simple: true })).toBe(271);
    } finally { io.close(); await f.close(); }
  });
});
