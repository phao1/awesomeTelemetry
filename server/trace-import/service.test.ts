import Database from 'better-sqlite3';
import { Readable, PassThrough } from 'node:stream';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { CaptureBodyStore } from '../proxy/body-store.js';
import { listImports, listImportTurns } from '../storage/trace-import.js';
import { TraceLogImporter } from './service.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0)) await action(); });
async function fixture(config: { quotaBytes?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'trace-service-')); const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); initSchema(db);
  const store = await CaptureBodyStore.create(join(directory, 'bodies'), config), importer = new TraceLogImporter(db, async () => store);
  cleanup.push(async () => { await importer.close(); db.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, db, store, importer };
}
function bytes(turns = 23, text = '中文<script>INERT</script>'): Buffer {
  return Buffer.from(JSON.stringify({ session: { session_id: 'native', ide_type: 'codex', model_name: 'synthetic', title: 'Synthetic import', extra_field: { preserve: true } },
    turns: Array.from({ length: turns }, (_, i) => ({ turn_id: 'turn-' + i, turn_number: i + 1, messages: JSON.stringify([{ role: 'user', content: text }]),
      system_prompt: 'SYSTEM_NOT_IN_DATABASE', output_text: i === 0 ? 'OUTPUT_NOT_IN_DATABASE' : undefined, tool_calls: JSON.stringify([{ function: { name: 'NEVER_EXECUTE', arguments: 'unchanged' } }]), total_tokens: 19 })) }, null, 2));
}
function tar(files: { name: string; bytes: Buffer }[]): Buffer {
  return gzipSync(Buffer.concat([...files.map(file => {
    const header = Buffer.alloc(512); header.write(file.name, 0); header.write(file.bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('0', 156); header.fill(32, 148, 156);
    header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    return Buffer.concat([header, file.bytes, Buffer.alloc((512 - file.bytes.length % 512) % 512)]);
  }), Buffer.alloc(1024)]));
}
describe('TraceLog import ownership, provenance and atomic metadata', () => {
  it('uses a real worker and indexes only metadata; pages/read/download preserve originals and unknown fields', async () => {
    const f = await fixture(), source = bytes(); const value = await f.importer.import(Readable.from([source]), 'trace.json');
    expect(value.items[0]!.state).toBe('imported'); const session = value.items[0]!.session;
    expect(session).toMatchObject({ nativeSessionId: 'native', ideType: 'codex', turnCount: 23, source: { bytes: source.length, status: 'complete' } });
    expect(session.importedAt).toBe(new Date(session.importedAt).toISOString()); expect(session.id).toBe(session.source.sha256);
    expect(listImports(f.db, 0, 20).items).toEqual([session]);
    expect(listImportTurns(f.db, session.id, 0, 20)).toMatchObject({ offset: 0, limit: 20, hasMore: true });
    expect(listImportTurns(f.db, session.id, 20, 20).items.map(item => item.sequence)).toEqual([20, 21, 22]);
    const detail = await f.importer.detail(session.id, 0);
    expect(detail.session).toMatchObject({ extra_field: { preserve: true } }); expect(detail.raw).toMatchObject({ output_text: 'OUTPUT_NOT_IN_DATABASE', system_prompt: 'SYSTEM_NOT_IN_DATABASE' });
    expect(await readFile(join(f.store.directory, session.source.id + '.body'))).toEqual(source);
    expect(JSON.stringify(f.db.prepare('SELECT metadata_json FROM trace_log_turns').all())).not.toMatch(/INERT|SYSTEM_NOT|OUTPUT_NOT|NEVER_EXECUTE/);
    expect(f.db.prepare('SELECT COUNT(1) AS n FROM sessions').get()).toEqual({ n: 0 }); expect(f.db.prepare('SELECT COUNT(1) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
    expect(f.store.status()).toMatchObject({ usedBytes: source.length, activeBodies: 0, pendingBytes: 0 });
  });
  it('deduplicates exact JSON across plain upload, archive and repeated members without charging/copying twice', async () => {
    const f = await fixture(), source = bytes(2); const first = await f.importer.import(Readable.from([source]), 'trace.json');
    const initial = f.store.status().usedBytes;
    const second = await f.importer.import(Readable.from([tar([{ name: 'round/traces/a.json', bytes: source }, { name: 'round/traces/b.json', bytes: source }, { name: 'round/project_copy/run.sh', bytes: Buffer.from('DO_NOT_EXECUTE') }])]), 'trace.tar.gz');
    expect(second.items.map(item => item.state)).toEqual(['duplicate', 'duplicate']); expect(second.items.map(item => item.session.id)).toEqual([first.items[0]!.session.id, first.items[0]!.session.id]);
    expect(second.ignoredEntries).toBe(1); expect(f.store.status().usedBytes).toBe(initial); expect(await readdir(f.store.directory)).toHaveLength(1);
  });
  it('validates all archive traces before copying any source or manifest', async () => {
    const f = await fixture(); const source = tar([{ name: 'traces/good.json', bytes: bytes(1) }, { name: 'traces/bad.json', bytes: Buffer.from('{}') }]);
    await expect(f.importer.import(Readable.from([source]), 'trace.gz')).rejects.toMatchObject({ code: 'TRACE_IMPORT_INVALID' });
    expect(listImports(f.db, 0, 20).items).toEqual([]); expect(f.store.status().usedBytes).toBe(0); expect(await readdir(f.store.directory)).toEqual([]);
  });
  it('rolls back all manifest/turn rows if a later insert fails while retaining charged original evidence', async () => {
    const f = await fixture(); f.db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON trace_log_turns WHEN NEW.sequence=1 BEGIN SELECT RAISE(ABORT,'synthetic insert failure'); END");
    await expect(f.importer.import(Readable.from([bytes(2)]), 'trace.json')).rejects.toMatchObject({ code: 'TRACE_IMPORT_FAILED' });
    expect(listImports(f.db, 0, 20).items).toEqual([]); expect(f.db.prepare('SELECT COUNT(1) AS n FROM trace_log_turns').get()).toEqual({ n: 0 });
    expect(f.store.status().usedBytes).toBeGreaterThan(0); expect(f.store.status()).toMatchObject({ activeBodies: 0, pendingBytes: 0 });
  });
  it('rejects quota exhaustion without reporting import success or deleting older originals', async () => {
    const f = await fixture({ quotaBytes: 10 }); const old = f.store.begin(); old.append(Buffer.from('old')); const ref = await old.finish();
    await expect(f.importer.import(Readable.from([bytes(1)]), 'trace.json')).rejects.toMatchObject({ code: 'TRACE_IMPORT_LIMIT' });
    expect(listImports(f.db, 0, 20).items).toEqual([]); expect(await readFile(join(f.store.directory, ref.id + '.body'), 'utf8')).toBe('old');
    expect(f.store.status()).toMatchObject({ activeBodies: 0, pendingBytes: 0 });
  });
  it('shares busy ownership by DB and closes a stalled upload without hanging shutdown or creating metadata', async () => {
    const f = await fixture(); const stalled = new PassThrough(); const task = f.importer.import(stalled, 'trace.json');
    const checked = expect(task).rejects.toMatchObject({ code: 'TRACE_IMPORT_FAILED' });
    await expect(f.importer.import(Readable.from([bytes(1)]), 'other.json')).rejects.toMatchObject({ code: 'TRACE_IMPORT_BUSY' });
    await new Promise(resolve => setTimeout(resolve, 20)); await f.importer.close(); await checked;
    expect(listImports(f.db, 0, 20).items).toEqual([]); expect(f.store.status()).toMatchObject({ activeBodies: 0, pendingBytes: 0 });
  });
  it('detects a modified selected turn instead of showing stale metadata as authentic content', async () => {
    const f = await fixture(), source = bytes(1), result = await f.importer.import(Readable.from([source]), 'trace.json'), session = result.items[0]!.session;
    const changed = Buffer.from(source); changed[changed.length - 20] = 32; await writeFile(join(f.store.directory, session.source.id + '.body'), changed);
    await expect(f.importer.detail(session.id, 0)).rejects.toMatchObject({ code: 'TRACE_IMPORT_FAILED' });
  });
  it('keeps an already-aborted upload out of the worker/store', async () => {
    const f = await fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.importer.import(Readable.from([bytes(1)]), 'trace.json', controller.signal)).rejects.toMatchObject({ code: 'TRACE_IMPORT_FAILED' }); expect(f.store.status().usedBytes).toBe(0);
  });
  it('verifies the selected session object as well as the turn, without hashing an entire large file on each read', async () => {
    const f = await fixture(), source = bytes(1), result = await f.importer.import(Readable.from([source]), 'trace.json'), session = result.items[0]!.session;
    const changed = Buffer.from(source.toString().replace('native', 'NATIVE')); await writeFile(join(f.store.directory, session.source.id + '.body'), changed);
    await expect(f.importer.detail(session.id, 0)).rejects.toMatchObject({ code: 'TRACE_IMPORT_FAILED' });
  });
  it('does not overwrite an earlier import when a changed export reuses the same native session ID', async () => {
    const f = await fixture(); const first = await f.importer.import(Readable.from([bytes(1)]), 'a.json');
    const second = await f.importer.import(Readable.from([bytes(2)]), 'b.json');
    expect(first.items[0]!.session.id).not.toBe(second.items[0]!.session.id); expect(listImports(f.db, 0, 20).items).toHaveLength(2);
    expect((await f.importer.detail(first.items[0]!.session.id, 0)).raw.output_text).toBe('OUTPUT_NOT_IN_DATABASE');
    const plan = JSON.stringify(f.db.prepare('EXPLAIN QUERY PLAN SELECT metadata_json FROM trace_log_imports ORDER BY imported_at DESC,id LIMIT ? OFFSET ?').all(21, 0));
    expect(plan).toContain('idx_trace_log_imported'); expect(plan).not.toContain('TEMP B-TREE');
    const turnsPlan = JSON.stringify(f.db.prepare('EXPLAIN QUERY PLAN SELECT metadata_json FROM trace_log_turns WHERE import_id=? ORDER BY sequence LIMIT ? OFFSET ?').all(first.items[0]!.session.id, 21, 0));
    expect(turnsPlan).toContain('SEARCH'); expect(turnsPlan).not.toContain('TEMP B-TREE');
  });
  it.each([{ source: bytes(2001), code: 'TRACE_IMPORT_LIMIT' }, { source: bytes(1, 'x'.repeat(2 * 1024 * 1024)), code: 'TRACE_IMPORT_LIMIT' },
    { source: Buffer.from('{"session":{"session_id":"s","ide_type":"codex"},"turns":[{"x":]}]}'), code: 'TRACE_IMPORT_INVALID' }])('rejects bounded malformed/oversized evidence without copying metadata or originals ($code)', async value => {
    const f = await fixture(); await expect(f.importer.import(Readable.from([value.source]), 'trace.json')).rejects.toMatchObject({ code: value.code });
    expect(listImports(f.db, 0, 20).items).toEqual([]); expect(f.store.status()).toMatchObject({ usedBytes: 0, activeBodies: 0, pendingBytes: 0 });
  });
});
