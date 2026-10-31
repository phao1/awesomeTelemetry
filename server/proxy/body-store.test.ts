import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { CaptureBodyStore, DEFAULT_CAPTURE_STORAGE } from './body-store.js';

const directories: string[] = [];
async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-capture-store-'));
  directories.push(dir);
  return dir;
}
async function contents(store: CaptureBodyStore, id: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of store.openRead(id)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('original capture body store', () => {
  it('snapshots only written prefix bytes without consuming the digest or finishing the writer', async () => {
    const store = await CaptureBodyStore.create(await directory()), writer = store.begin();
    writer.append(Buffer.from('first')); expect(writer.snapshot().bytes).toBe(0);
    while (store.status().pendingBytes !== 0) await new Promise(resolve => setTimeout(resolve, 1));
    const prefix = writer.snapshot(); expect(prefix).toMatchObject({ bytes: 5, sha256: createHash('sha256').update('first').digest('hex'), status: 'interrupted', error: 'LIVE_PREFIX' });
    writer.append(Buffer.from('-second'));
    const final = await writer.finish();
    expect(prefix.bytes).toBe(5); expect(final).toMatchObject({ bytes: 12, sha256: createHash('sha256').update('first-second').digest('hex'), status: 'complete' });
    expect(writer.snapshot()).toEqual(final); expect(await writer.finish()).toEqual(final); expect(await contents(store, final.id)).toEqual(Buffer.from('first-second'));
  });
  it('explicitly removes only selected originals and reconciles quota across restart/idempotent retries', async () => {
    const root = await directory(), crashId = randomUUID();
    await writeFile(join(root, crashId + '.part'), 'prefix');
    await writeFile(join(root, 'unrelated.txt'), 'keep');
    const store = await CaptureBodyStore.create(root, { quotaBytes: 10 }), writer = store.begin(); writer.append(Buffer.from('原'));
    const ref = await writer.finish(); expect(store.status().usedBytes).toBe(9);
    expect(await store.removeOriginals([crashId])).toBe(6);
    expect(await contents(store, ref.id)).toEqual(Buffer.from('原'));
    expect(store.status().usedBytes).toBe(3); expect(await store.removeOriginals([crashId])).toBe(0);
    expect(await store.removeOriginals([ref.id, ref.id])).toBe(3); expect(store.status().usedBytes).toBe(0);
    expect((await CaptureBodyStore.create(root)).status().usedBytes).toBe(0);
    expect(await readdir(root)).toEqual(['unrelated.txt']); expect(await readFile(join(root, 'unrelated.txt'), 'utf8')).toBe('keep');
  });
  it('validates all IDs and paths before unlinking, refusing traversal/symlinks/directories', async () => {
    const root = await directory(), outside = await directory(), id = randomUUID(), unsafe = randomUUID();
    await writeFile(join(root, id + '.body'), 'keep-original'); await writeFile(join(outside, 'outside'), 'keep-outside');
    await symlink(join(outside, 'outside'), join(root, unsafe + '.body'));
    const store = await CaptureBodyStore.create(root);
    for (const ids of [[], [id, '../outside'], [id, unsafe, randomUUID()]]) await expect(store.removeOriginals(ids)).rejects.toThrow('CAPTURE_DELETE_INVALID_IDS');
    await expect(store.removeOriginals([id, unsafe])).rejects.toThrow('CAPTURE_DELETE_CONFLICT');
    expect(await readFile(join(root, id + '.body'), 'utf8')).toBe('keep-original'); expect(await readFile(join(outside, 'outside'), 'utf8')).toBe('keep-outside');
    await rm(join(root, unsafe + '.body')); await mkdir(join(root, unsafe + '.part'));
    await expect(store.removeOriginals([id, unsafe])).rejects.toThrow('CAPTURE_DELETE_CONFLICT');
    expect(store.status().usedBytes).toBe(Buffer.byteLength('keep-original'));
    expect(await readFile(join(root, id + '.body'), 'utf8')).toBe('keep-original');
  });
  it('refuses active writers/readers/recovery and fences new admission during removal', async () => {
    const store = await CaptureBodyStore.create(await directory()), writer = store.begin(); writer.append(Buffer.from('original'));
    await expect(store.removeOriginals([writer.id])).rejects.toThrow('CAPTURE_STORE_BUSY');
    const ref = await writer.finish(), reader = store.openRead(ref.id);
    await expect(store.removeOriginals([ref.id])).rejects.toThrow('CAPTURE_STORE_BUSY');
    const closed = once(reader, 'close'); reader.destroy(); await closed;
    const recovery = store.recover(ref.id, ref);
    await expect(store.removeOriginals([ref.id])).rejects.toThrow('CAPTURE_STORE_BUSY'); await recovery;
    const removing = store.removeOriginals([ref.id]);
    expect(() => store.openRead(ref.id)).toThrow('CAPTURE_STORE_BUSY'); expect(() => store.begin()).toThrow('CAPTURE_STORE_BUSY');
    await expect(store.recover(ref.id)).rejects.toThrow('CAPTURE_STORE_BUSY');
    await expect(store.removeOriginals([ref.id])).rejects.toThrow('CAPTURE_STORE_BUSY');
    expect(await removing).toBe(8); expect(store.status()).toMatchObject({ usedBytes: 0, activeBodies: 0, pendingBytes: 0 });
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports real unlink permission failure without falsely freeing quota or retaining a maintenance lock', async () => {
    const root = await directory(), store = await CaptureBodyStore.create(root), writer = store.begin(); writer.append(Buffer.from('retained'));
    const ref = await writer.finish(); await chmod(root, 0o500);
    try {
      await expect(store.removeOriginals([ref.id])).rejects.toThrow('CAPTURE_DELETE_FAILED');
      expect(store.status().usedBytes).toBe(8); expect(await contents(store, ref.id)).toEqual(Buffer.from('retained'));
    } finally { await chmod(root, 0o700); }
    expect(await store.removeOriginals([ref.id])).toBe(8); expect(store.status().usedBytes).toBe(0);
  });
  it.skipIf(process.platform !== 'darwin')('reconciles a real partial unlink failure and retries only the surviving immutable fixture', async () => {
    const root = await directory(), store = await CaptureBodyStore.create(root), first = store.begin(), second = store.begin();
    first.append(Buffer.from('removed')); second.append(Buffer.from('retained'));
    const [a, b] = await Promise.all([first.finish(), second.finish()]), protectedPath = join(root, b.id + '.body');
    // macOS owner-only immutable flag on this disposable fixture, not an IO mock.
    await promisify(execFile)('/usr/bin/chflags', ['uchg', protectedPath]);
    try {
      await expect(store.removeOriginals([a.id, b.id])).rejects.toThrow('CAPTURE_DELETE_FAILED');
      await expect(stat(join(root, a.id + '.body'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await contents(store, b.id)).toEqual(Buffer.from('retained')); expect(store.status().usedBytes).toBe(8);
      expect((await CaptureBodyStore.create(root)).status().usedBytes).toBe(8);
    } finally { await promisify(execFile)('/usr/bin/chflags', ['nouchg', protectedPath]); }
    expect(await store.removeOriginals([a.id, b.id])).toBe(8); expect(await store.removeOriginals([a.id, b.id])).toBe(0);
  });
  it('incrementally reconciles a large inventory while allowing event-loop progress', async () => {
    const root = await directory(), target = randomUUID(); await writeFile(join(root, target + '.body'), 'remove');
    for (let index = 0; index < 500; index += 1) await writeFile(join(root, randomUUID() + '.part'), 'x');
    const store = await CaptureBodyStore.create(root); let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 1);
    try { expect(await store.removeOriginals([target])).toBe(6); } finally { clearInterval(ticker); }
    expect(ticks).toBeGreaterThan(0); expect(store.status().usedBytes).toBe(500); expect(await readdir(root)).toHaveLength(500);
  });
  it('does not create untracked original files before durable admission, while retaining bounded queued bytes', async () => {
    const store = await CaptureBodyStore.create(await directory());
    let admit!: () => void;
    const writer = store.begin(new Promise<void>(resolve => { admit = resolve; }));
    writer.append(Buffer.from('原文🙂'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await readdir(store.directory)).toEqual([]);
    expect(store.status()).toMatchObject({ pendingBytes: Buffer.byteLength('原文🙂'), activeBodies: 1 });
    admit(); const ref = await writer.finish();
    expect(ref.status).toBe('complete'); expect((await contents(store, ref.id)).toString()).toBe('原文🙂');
  });
  it('recovers a crash prefix without guessing completeness, changing quota or deleting bytes', async () => {
    const root = await directory(), id = randomUUID(), bytes = Buffer.from('前缀🙂\u0000');
    await writeFile(join(root, id + '.part'), bytes, { mode: 0o600 });
    const store = await CaptureBodyStore.create(root);
    const ref = await store.recover(id);
    expect(ref).toEqual({ id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: 'interrupted', error: 'CAPTURE_PROCESS_LOST' });
    expect(await contents(store, id)).toEqual(bytes); expect(await store.recover(id)).toEqual(ref);
    expect(store.status()).toMatchObject({ usedBytes: bytes.length, activeBodies: 0, pendingBytes: 0 });
    expect(await readdir(root)).toEqual([id + '.body']);
  });
  it('retains verified finished refs and rejects modified or ambiguous files without overwriting evidence', async () => {
    const store = await CaptureBodyStore.create(await directory()), writer = store.begin(); writer.append(Buffer.from('original'));
    const ref = await writer.finish(); expect(await store.recover(ref.id, ref)).toEqual(ref);
    await expect(store.recover(ref.id, { ...ref, sha256: '0'.repeat(64) })).rejects.toThrow('CAPTURE_RECOVERY_INTEGRITY_FAILED');
    await writeFile(join(store.directory, ref.id + '.part'), 'other');
    await expect(store.recover(ref.id)).rejects.toThrow('CAPTURE_RECOVERY_CONFLICT');
    expect((await contents(store, ref.id)).toString()).toBe('original');
    expect(await readFile(join(store.directory, ref.id + '.part'), 'utf8')).toBe('other');
    expect(await store.recover(randomUUID())).toMatchObject({ bytes: 0, status: 'write_error', error: 'CAPTURE_BODY_MISSING' });
    const missing = { ...ref, id: randomUUID() };
    expect(await store.recover(missing.id, missing)).toEqual({ ...missing, status: 'write_error', error: 'CAPTURE_BODY_MISSING' });
  });
  it('caps tiny pending operations across writers and releases them after all accepted bytes persist', async () => {
    const store = await CaptureBodyStore.create(await directory());
    const first = store.begin(), second = store.begin();
    for (let index = 0; index < 4096; index += 1) expect(first.append(Buffer.from('x'))).toBe(true);
    expect(store.status().pendingBytes).toBe(4096);
    expect(second.append(Buffer.from('y'))).toBe(false);
    const [a, b] = await Promise.all([first.finish(), second.finish()]);
    expect(a).toMatchObject({ bytes: 4096, status: 'complete' });
    expect(b).toMatchObject({ bytes: 0, status: 'queue_full', error: 'CAPTURE_PENDING_OPERATIONS_LIMIT' });
    expect(await contents(store, a.id)).toEqual(Buffer.from('x'.repeat(4096)));
    const recovered = store.begin(); expect(recovered.append(Buffer.from('new'))).toBe(true);
    expect(await recovered.finish()).toMatchObject({ bytes: 3, status: 'complete' });
    expect(store.status()).toMatchObject({ pendingBytes: 0, activeBodies: 0 });
  });
  it('preserves split UTF-8, binary bytes and credentials exactly, with a verified digest', async () => {
    const store = await CaptureBodyStore.create(await directory());
    const original = Buffer.concat([Buffer.from('中文 Bearer synthetic-original-token\n'), Buffer.from([0, 255, 128])]);
    const writer = store.begin();
    expect(writer.append(original.subarray(0, 1))).toBe(true);
    expect(writer.append(original.subarray(1))).toBe(true);
    const result = await writer.finish();
    expect(result).toEqual({ id: writer.id, bytes: original.length, sha256: createHash('sha256').update(original).digest('hex'), status: 'complete', error: null });
    expect(await contents(store, result.id)).toEqual(original);
    expect(store.status()).toMatchObject({ usedBytes: original.length, pendingBytes: 0, activeBodies: 0 });
    expect((await stat(join(store.directory, `${result.id}.body`))).mode & 0o777).toBe(0o600);
  });

  it('copies input bytes before the caller reuses its buffer and finalizes idempotently', async () => {
    const store = await CaptureBodyStore.create(await directory());
    const input = Buffer.from('original');
    const writer = store.begin();
    writer.append(input);
    input.fill(0);
    const first = writer.finish();
    expect(writer.finish()).toBe(first);
    expect(writer.append(Buffer.from('late'))).toBe(false);
    expect((await contents(store, (await first).id)).toString()).toBe('original');
  });

  it('records body limit explicitly, preserving the accepted prefix', async () => {
    const store = await CaptureBodyStore.create(await directory(), { maxBodyBytes: 4 });
    const writer = store.begin();
    expect(writer.append(Buffer.from('1234'))).toBe(true);
    expect(writer.append(Buffer.from('5'))).toBe(false);
    const result = await writer.finish();
    expect(result).toMatchObject({ bytes: 4, status: 'body_limit', error: null });
    expect((await contents(store, result.id)).toString()).toBe('1234');
  });

  it('reserves quota across concurrent writers without evicting prior evidence', async () => {
    const store = await CaptureBodyStore.create(await directory(), { quotaBytes: 6 });
    const left = store.begin(), right = store.begin();
    expect(left.append(Buffer.from('1234'))).toBe(true);
    expect(right.append(Buffer.from('abc'))).toBe(false);
    expect(left.append(Buffer.from('56'))).toBe(true);
    const [a, b] = await Promise.all([left.finish(), right.finish()]);
    expect(a.status).toBe('complete');
    expect(b.status).toBe('quota_exceeded');
    expect(store.status()).toMatchObject({ usedBytes: 6, exhausted: true });
    expect((await contents(store, a.id)).toString()).toBe('123456');
  });

  it('bounds pending copies globally and reports overload separately from disk quota', async () => {
    const store = await CaptureBodyStore.create(await directory(), { maxPendingBytes: 4 });
    const a = store.begin(), b = store.begin();
    expect(a.append(Buffer.from('1234'))).toBe(true);
    expect(b.append(Buffer.from('x'))).toBe(false);
    expect(store.status().pendingBytes).toBe(4);
    const [first, second] = await Promise.all([a.finish(), b.finish()]);
    expect(first.status).toBe('complete');
    expect(second.status).toBe('queue_full');
    expect(store.status().pendingBytes).toBe(0);
  });

  it('counts completed files and crash remnants before accepting new capture after restart', async () => {
    const dir = await directory();
    const first = await CaptureBodyStore.create(dir, { quotaBytes: 10 });
    const writer = first.begin(); writer.append(Buffer.from('12345'));
    const saved = await writer.finish();
    const crashId = randomUUID();
    await writeFile(join(dir, `${crashId}.part`), '67890');
    const restarted = await CaptureBodyStore.create(dir, { quotaBytes: 10 });
    expect(restarted.status()).toMatchObject({ usedBytes: 10, exhausted: true });
    const next = restarted.begin();
    expect(next.append(Buffer.from('x'))).toBe(false);
    expect((await next.finish()).status).toBe('quota_exceeded');
    expect((await contents(restarted, saved.id)).toString()).toBe('12345');
    expect((await readFile(join(dir, `${crashId}.part`))).toString()).toBe('67890');
  });

  it('records a real filesystem failure and releases unwritten reservations', async () => {
    const dir = await directory();
    const store = await CaptureBodyStore.create(dir);
    await rm(dir, { recursive: true });
    const writer = store.begin();
    writer.append(Buffer.from('not-written'));
    expect(await writer.finish()).toMatchObject({ bytes: 0, status: 'write_error', error: 'ENOENT' });
    expect(store.status()).toMatchObject({ usedBytes: 0, pendingBytes: 0, activeBodies: 0 });
    await mkdir(dir);
  });

  it('keeps an interrupted prefix and rejects path traversal', async () => {
    const store = await CaptureBodyStore.create(await directory());
    const writer = store.begin(); writer.append(Buffer.from('partial'));
    const ref = await writer.finish(true);
    expect(ref.status).toBe('interrupted');
    expect((await contents(store, ref.id)).toString()).toBe('partial');
    expect(() => store.openRead('../outside')).toThrow('Invalid capture body id');
    expect(await readdir(store.directory)).toEqual([`${ref.id}.body`]);
  });

  it('streams a complete 100MiB body with bounded pending bytes and exact file size', async () => {
    const store = await CaptureBodyStore.create(await directory());
    const writer = store.begin();
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const expected = createHash('sha256');
    for (let i = 0; i < 100; i += 1) {
      // Yield to filesystem completion without assembling the full body in RAM.
      while (store.status().pendingBytes + chunk.length > DEFAULT_CAPTURE_STORAGE.maxPendingBytes) {
        await new Promise<void>(resolve => setTimeout(resolve, 1));
      }
      expect(writer.append(chunk)).toBe(true);
      expected.update(chunk);
      expect(store.status().pendingBytes).toBeLessThanOrEqual(DEFAULT_CAPTURE_STORAGE.maxPendingBytes);
    }
    const ref = await writer.finish();
    expect(ref).toMatchObject({ bytes: 104_857_600, status: 'complete', sha256: expected.digest('hex') });
    expect((await stat(join(store.directory, `${ref.id}.body`))).size).toBe(104_857_600);
  });

  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid limits: %s', async value => {
    await expect(CaptureBodyStore.create(await directory(), { quotaBytes: value })).rejects.toThrow(RangeError);
  });
});
