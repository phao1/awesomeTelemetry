import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RsiLedgerEntry, RsiLedgerInput } from '../../src/core/rsi-types.js';
import {
  appendLedger, canonicalJson, computeLedgerHash, LedgerIntegrityError,
  RSI_LEDGER_GENESIS_HASH, verifyLedger,
} from './ledger.js';

const execFileAsync = promisify(execFile);
const at = '2026-11-07T00:00:00.000Z';
let directory: string;
let path: string;

function input(index = 1, taskId = 'task_1'): RsiLedgerInput {
  return {
    taskId, at, actor: 'human', event: 'instruction_put',
    payload: { id: `instruction_${index}`, taskId, kind: 'idea', text: `Synthetic idea ${index}`, effectiveFromSeq: 1, at },
  };
}

async function seed(count = 3): Promise<RsiLedgerEntry[]> {
  const entries: RsiLedgerEntry[] = [];
  for (let index = 1; index <= count; index += 1) entries.push(await appendLedger(path, input(index)));
  return entries;
}

async function overwrite(entries: RsiLedgerEntry[]): Promise<void> {
  await writeFile(path, `${entries.map(canonicalJson).join('\n')}\n`, 'utf8');
}

function withHash(entry: RsiLedgerEntry): RsiLedgerEntry {
  const { hash: _hash, ...unsigned } = entry;
  return { ...unsigned, hash: computeLedgerHash(unsigned) };
}

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rsi-ledger-')); path = join(directory, 'ledger.jsonl'); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('RSI-007 canonical serialization', () => {
  it('sorts every object by UTF16 keys, retains array order, escapes strings and normalizes -0', () => {
    expect(canonicalJson({ z: [3, { z: false, a: null }], a: 'line\n"quote"', n: -0 }))
      .toBe(String.raw`{"a":"line\n\"quote\"","n":0,"z":[3,{"a":null,"z":false}]}`);
    expect(canonicalJson({ '\uE000': 1, '\u{10000}': 2 })).toBe('{"𐀀":2,"":1}');
  });
  it('accepts null-prototype and cross-realm JSON objects without losing fields', () => {
    const object: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    object.b = 2; object.a = 1;
    expect(canonicalJson(object)).toBe('{"a":1,"b":2}');
    expect(canonicalJson(runInNewContext('({b:1,a:[2,3]})'))).toBe('{"a":[2,3],"b":1}');
  });
  it.each([undefined, NaN, Infinity, -Infinity, 1n, new Date(), new Map(), () => 1, Symbol('x')])('rejects non-JSON value %s', value => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
  it('rejects sparse/extended arrays, cycles, hidden fields and accessors without invoking getters', () => {
    expect(() => canonicalJson(new Array(2))).toThrow();
    const extended = [1]; Object.defineProperty(extended, 'extra', { value: 1 });
    expect(() => canonicalJson(extended)).toThrow();
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
    const getter = { get secret() { throw new Error('GETTER WAS CALLED'); } };
    expect(() => canonicalJson(getter)).toThrow('accessors');
    const hidden = {}; Object.defineProperty(hidden, 'secret', { value: 'lost' });
    expect(() => canonicalJson(hidden)).toThrow('hidden fields');
    expect(() => canonicalJson({ missing: undefined })).toThrow();
  });
  it('rejects excessive nesting before overflowing the call stack', () => {
    let value: unknown = null;
    for (let index = 0; index < 66; index += 1) value = [value];
    expect(() => canonicalJson(value)).toThrow('nesting exceeds 64');
  });
  it('hashes the exact canonical UTF8 representation with SHA256', () => {
    const unsigned = { ...input(), version: 1 as const, seq: 1, prevHash: RSI_LEDGER_GENESIS_HASH };
    expect(computeLedgerHash(unsigned)).toBe(createHash('sha256').update(canonicalJson(unsigned), 'utf8').digest('hex'));
  });
});

describe('RSI-007 append and streaming verification', () => {
  it('creates a private durable chain with contiguous sequence and verifies a trusted prefix', async () => {
    const entries = await seed();
    const received: RsiLedgerEntry[] = [];
    const verification = await verifyLedger(path, { taskId: 'task_1', expectedHead: { seq: 2, hash: entries[1]!.hash }, onEntry: entry => { received.push(entry); } });
    expect(verification).toEqual({
      valid: true, head: { seq: 3, hash: entries[2]!.hash }, entryCount: 3,
      issues: [], partialTail: null, anchored: true, tampered: false,
    });
    expect(received).toEqual(entries);
    expect(entries.map(entry => entry.prevHash)).toEqual([RSI_LEDGER_GENESIS_HASH, entries[0]!.hash, entries[1]!.hash]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(stat(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFile(path, 'utf8')).endsWith('\n')).toBe(true);
  });
  it('reports a missing/empty ledger as unanchored empty data, but detects disappearance with a trusted head', async () => {
    expect(await verifyLedger(path)).toMatchObject({ valid: true, anchored: false, entryCount: 0, head: { seq: 0, hash: RSI_LEDGER_GENESIS_HASH } });
    expect(await verifyLedger(path, { expectedHead: { seq: 1, hash: 'a'.repeat(64) } })).toMatchObject({ valid: false, tampered: true, issues: [{ code: 'tail_truncated', line: 1 }] });
  });
  it('snapshots inputs before asynchronous queueing', async () => {
    const value = input();
    const result = appendLedger(path, value);
    value.payload.id = 'changed_after_call';
    const entry = await result;
    expect(entry.payload.id).toBe('instruction_1');
    expect((await verifyLedger(path)).valid).toBe(true);
  });
  it('awaits staging callbacks in order and propagates their failures', async () => {
    await seed();
    const sequences: number[] = [];
    await expect(verifyLedger(path, { onEntry: async entry => {
      await Promise.resolve(); sequences.push(entry.seq);
      if (entry.seq === 2) throw new Error('synthetic staging failure');
    } })).rejects.toThrow('synthetic staging failure');
    expect(sequences).toEqual([1, 2]);
    expect((await verifyLedger(path)).valid).toBe(true);
  });
  it('snapshots the trusted anchor so a staging callback cannot weaken verification', async () => {
    const entries = await seed(2);
    const expectedHead = { seq: 3, hash: 'a'.repeat(64) };
    const result = await verifyLedger(path, { expectedHead, onEntry: () => {
      expectedHead.seq = 2; expectedHead.hash = entries[1]!.hash;
    } });
    expect(result).toMatchObject({ valid: false, issues: [{ code: 'tail_truncated', line: 3 }] });
  });
  it('verifies a bounded file snapshot even if new records arrive during staging', async () => {
    await seed(1);
    const seen: number[] = [];
    const result = await verifyLedger(path, { onEntry: async entry => {
      seen.push(entry.seq);
      await appendLedger(path, input(2));
    } });
    expect(result).toMatchObject({ valid: true, entryCount: 1, head: { seq: 1 } });
    expect(seen).toEqual([1]);
    expect((await verifyLedger(path)).entryCount).toBe(2);
  });
  it('rejects malformed input and invalid limits without poisoning later appends', async () => {
    await expect(appendLedger(path, { ...input(), at: 'invalid' })).rejects.toThrow();
    await expect(appendLedger(path, input(), { maxLineBytes: 0 })).rejects.toThrow();
    await expect(appendLedger(path, input(), { maxLineBytes: 50 })).rejects.toThrow('maxLineBytes');
    expect((await appendLedger(path, input())).seq).toBe(1);
  });
  it('rejects oversized lines while streaming and never follows a ledger symlink', async () => {
    await seed(1);
    expect(await verifyLedger(path, { maxLineBytes: 32 })).toMatchObject({ valid: false, issues: [{ code: 'line_too_large', line: 1 }] });
    const link = join(directory, 'alias.jsonl');
    await symlink(path, link);
    await expect(appendLedger(link, input(2))).rejects.toMatchObject({ code: 'ELOOP' });
    expect((await verifyLedger(path)).entryCount).toBe(1);
  });
});

describe('RSI-007 tamper detection and crash residues', () => {
  it('detects payload modification', async () => {
    const entries = await seed();
    entries[1]!.payload.id = 'modified';
    await overwrite(entries);
    expect(await verifyLedger(path)).toMatchObject({ valid: false, tampered: true, issues: [{ code: 'hash_mismatch', line: 2 }] });
  });
  it('detects middle deletion', async () => {
    const entries = await seed(); await overwrite([entries[0]!, entries[2]!]);
    expect(await verifyLedger(path)).toMatchObject({ valid: false, issues: [{ code: 'sequence_mismatch', line: 2 }] });
  });
  it('detects inserted records', async () => {
    const entries = await seed(); await overwrite([entries[0]!, entries[0]!, entries[1]!, entries[2]!]);
    expect(await verifyLedger(path)).toMatchObject({ valid: false, issues: [{ code: 'sequence_mismatch', line: 2 }] });
  });
  it('detects reordered records', async () => {
    const entries = await seed(); await overwrite([entries[1]!, entries[0]!, entries[2]!]);
    expect(await verifyLedger(path)).toMatchObject({ valid: false, issues: [{ code: 'sequence_mismatch', line: 1 }] });
  });
  it('detects duplicate seq even when that record hash has been recomputed', async () => {
    const entries = await seed(); entries[1] = withHash({ ...entries[1]!, seq: 1 }); await overwrite(entries);
    expect(await verifyLedger(path)).toMatchObject({ valid: false, issues: [{ code: 'sequence_mismatch', line: 2 }] });
  });
  it('detects a broken prevHash even when the new record hash is correct', async () => {
    const entries = await seed(); entries[1] = withHash({ ...entries[1]!, prevHash: 'a'.repeat(64) }); await overwrite(entries);
    expect(await verifyLedger(path)).toMatchObject({ valid: false, issues: [{ code: 'prev_hash_mismatch', line: 2 }] });
  });
  it('detects tail truncation using the cached trusted head', async () => {
    const entries = await seed(); const expectedHead = { seq: 3, hash: entries[2]!.hash };
    await overwrite(entries.slice(0, 2));
    expect(await verifyLedger(path, { expectedHead })).toMatchObject({ valid: false, tampered: true, issues: [{ code: 'tail_truncated', line: 3 }] });
    expect(await verifyLedger(path)).toMatchObject({ valid: true, anchored: false, entryCount: 2 });
    await expect(appendLedger(path, input(4), { expectedHead })).rejects.toBeInstanceOf(LedgerIntegrityError);
  });
  it('detects a fully rehashed chain diverging from its trusted prefix anchor', async () => {
    const entries = await seed(); const expectedHead = { seq: 3, hash: entries[2]!.hash };
    entries[0]!.payload.id = 'replacement'; entries[0] = withHash(entries[0]!);
    for (let index = 1; index < entries.length; index += 1) entries[index] = withHash({ ...entries[index]!, prevHash: entries[index - 1]!.hash });
    await overwrite(entries);
    expect(await verifyLedger(path, { expectedHead })).toMatchObject({ valid: false, issues: [{ code: 'anchor_mismatch', line: 3 }] });
  });
  it('rejects an unexpected task identity and an append for a different task', async () => {
    await seed(1);
    expect(await verifyLedger(path, { taskId: 'other_task' })).toMatchObject({ valid: false, issues: [{ code: 'task_mismatch', line: 1 }] });
    await expect(appendLedger(path, input(2, 'other_task'))).rejects.toBeInstanceOf(LedgerIntegrityError);
  });
  it('detects formatting modification, invalid JSON, invalid UTF8 and malformed complete entries', async () => {
    const entries = await seed(1);
    await writeFile(path, ` ${canonicalJson(entries[0])}\n`);
    expect((await verifyLedger(path)).issues[0]!.code).toBe('non_canonical');
    await writeFile(path, '{"broken":\n');
    expect((await verifyLedger(path)).issues[0]!.code).toBe('invalid_json');
    await writeFile(path, Buffer.from([0xff, 0x0a]));
    expect((await verifyLedger(path)).issues[0]!.code).toBe('invalid_json');
    await writeFile(path, '{}\n');
    expect((await verifyLedger(path)).issues[0]!.code).toBe('invalid_entry');
  });
  it('reports a crash half-line separately, preserves it and refuses further append', async () => {
    const entries = await seed(1);
    const bytes = `${canonicalJson(entries[0])}\n{"actor":"worker","payload":`;
    await writeFile(path, bytes);
    const report = await verifyLedger(path, { expectedHead: { seq: 1, hash: entries[0]!.hash } });
    expect(report).toMatchObject({ valid: false, tampered: false, entryCount: 1, partialTail: { line: 2, byteLength: 28 }, issues: [{ code: 'partial_tail', line: 2 }] });
    await expect(appendLedger(path, input(2))).rejects.toBeInstanceOf(LedgerIntegrityError);
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });
  it('treats even a complete final JSON object without LF as uncommitted partial tail', async () => {
    const entries = await seed(1); await writeFile(path, canonicalJson(entries[0]));
    expect(await verifyLedger(path)).toMatchObject({ valid: false, tampered: false, entryCount: 0, issues: [{ code: 'partial_tail', line: 1 }] });
  });
});

describe('RSI-007 writer serialization and lock ownership', () => {
  it('serializes concurrent local appends without loss, duplicated seq or broken links', async () => {
    const entries = await Promise.all(Array.from({ length: 24 }, (_, index) => appendLedger(path, input(index))));
    expect(new Set(entries.map(entry => entry.seq)).size).toBe(24);
    const ids: string[] = [];
    const result = await verifyLedger(path, { onEntry: entry => { ids.push(entry.payload.id); } });
    expect(result).toMatchObject({ valid: true, entryCount: 24, head: { seq: 24 } });
    expect(new Set(ids).size).toBe(24);
  });
  it('never steals a live lock merely because its timestamp has expired', async () => {
    const lockPath = `${path}.lock`;
    const expiredAt = new Date(Date.now() - 60_000);
    await writeFile(lockPath, canonicalJson({ version: 1, pid: process.pid, owner: 'live-owner', createdAt: expiredAt.toISOString() }));
    await utimes(lockPath, expiredAt, expiredAt);
    await expect(appendLedger(path, input(), { lockStaleMs: 1, lockTimeoutMs: 25, lockRetryMs: 2 })).rejects.toThrow('lock acquisition timed out');
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ owner: 'live-owner', pid: process.pid });
  });
  it('recovers an expired lock whose owner process is known dead', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    const lockPath = `${path}.lock`;
    const expiredAt = new Date(Date.now() - 60_000);
    await writeFile(lockPath, canonicalJson({ version: 1, pid: Number(stdout), owner: 'dead-owner', createdAt: expiredAt.toISOString() }));
    await utimes(lockPath, expiredAt, expiredAt);
    expect((await appendLedger(path, input(), { lockStaleMs: 1, lockTimeoutMs: 1000 })).seq).toBe(1);
    await expect(stat(`${lockPath}.reclaim`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('fails closed on malformed stale lock files and abandoned recovery guards', async () => {
    const lockPath = `${path}.lock`;
    const expiredAt = new Date(Date.now() - 60_000);
    await writeFile(lockPath, '{"pid":'); await utimes(lockPath, expiredAt, expiredAt);
    await expect(appendLedger(path, input(), { lockStaleMs: 1, lockTimeoutMs: 20, lockRetryMs: 2 })).rejects.toThrow('timed out');
    expect(await readFile(lockPath, 'utf8')).toBe('{"pid":');
    await writeFile(`${lockPath}.reclaim`, 'orphan guard');
    await expect(appendLedger(path, input(), { lockStaleMs: 1, lockTimeoutMs: 20, lockRetryMs: 2 })).rejects.toThrow('timed out');
    expect(await readFile(`${lockPath}.reclaim`, 'utf8')).toBe('orphan guard');
  });
  it.skipIf(Number(process.versions.node.slice(0, process.versions.node.indexOf('.'))) < 24)(
    'serializes actual independent Node writer processes through O_EXCL locks', async () => {
      const ledgerUrl = pathToFileURL(fileURLToPath(new URL('./ledger.ts', import.meta.url))).href;
      const { stdout } = await execFileAsync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
      const expiredAt = new Date(Date.now() - 120_000);
      await writeFile(`${path}.lock`, canonicalJson({ version: 1, pid: Number(stdout), owner: 'dead-concurrent-owner', createdAt: expiredAt.toISOString() }));
      await utimes(`${path}.lock`, expiredAt, expiredAt);
      const source = `
        import { registerHooks } from 'node:module';
        registerHooks({ resolve(specifier, context, nextResolve) {
          try { return nextResolve(specifier, context); }
          catch (error) {
            if (specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) return nextResolve(specifier.slice(0, -3) + '.ts', context);
            throw error;
          }
        }});
        const { appendLedger } = await import(process.argv[1]);
        const event = JSON.parse(process.argv[3]);
        for (let i = 0; i < 6; i += 1) {
          event.payload.id = 'process_' + process.pid + '_' + i;
          await appendLedger(process.argv[2], event);
        }
      `;
      await Promise.all(Array.from({ length: 3 }, () => execFileAsync(process.execPath,
        ['--no-warnings', '--input-type=module', '-e', source, ledgerUrl, path, JSON.stringify(input())],
        { timeout: 15_000, maxBuffer: 1_048_576 })));
      const ids: string[] = [];
      const result = await verifyLedger(path, { onEntry: entry => { ids.push(entry.payload.id); } });
      expect(result).toMatchObject({ valid: true, entryCount: 18, head: { seq: 18 } });
      expect(new Set(ids).size).toBe(18);
    }, 25_000,
  );
});
