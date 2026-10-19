import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractTraceArchive } from './archive.js';

function member(name: string, bytes: Buffer, type = '0'): Buffer {
  const header = Buffer.alloc(512); header.write(name, 0, 100, 'utf8'); header.write('0000600\0', 100); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257);
  const sum = header.reduce((a, b) => a + b, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
async function extract(bytes: Buffer, check: (value: Awaited<ReturnType<typeof extractTraceArchive>>, directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'trace-archive-'));
  try { const path = join(directory, 'upload.gz'); await writeFile(path, gzipSync(bytes)); await check(await extractTraceArchive(path, directory), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
describe('bounded TraceLog gzip tar selection without extraction', () => {
  it('writes only exact regular traces JSON using generated names, never project source or executables', async () => {
    const json = Buffer.from('{"session":{"session_id":"s","ide_type":"codex"},"turns":[]}');
    await extract(Buffer.concat([member('round/project_copy/evil.sh', Buffer.from('DO_NOT_EXECUTE')), member('./round/traces/a.json', json), Buffer.alloc(1024)]), async (result, directory) => {
      expect(result.ignoredEntries).toBe(1); expect(result.files).toEqual([{ path: join(directory, 'trace-0.json'), member: 'round/traces/a.json' }]);
      expect(await readFile(result.files[0]!.path)).toEqual(json); expect((await readdir(directory)).sort()).toEqual(['trace-0.json', 'upload.gz']);
    });
  });
  it.each(['../traces/a.json', '/traces/a.json', 'C:\\traces\\a.json', 'round/../traces/a.json'])('rejects traversal or absolute member %s', async name => {
    await expect(extract(Buffer.concat([member(name, Buffer.from('{}')), Buffer.alloc(1024)]), async () => undefined)).rejects.toThrow('TRACE_IMPORT_INVALID');
  });
  it.each(['1', '2', '5'])('rejects selected nonregular trace type %s', async type => {
    await expect(extract(Buffer.concat([member('traces/a.json', Buffer.from('{}'), type), Buffer.alloc(1024)]), async () => undefined)).rejects.toThrow('TRACE_IMPORT_INVALID');
  });
  it('rejects broken checksum and truncated trailers rather than successful partial import', async () => {
    const broken = member('traces/a.json', Buffer.from('{}')); broken[0] = 120;
    await expect(extract(Buffer.concat([broken, Buffer.alloc(1024)]), async () => undefined)).rejects.toThrow('TRACE_IMPORT_INVALID');
    await expect(extract(member('traces/a.json', Buffer.from('{}')), async () => undefined)).rejects.toThrow('TRACE_IMPORT_INVALID');
  });
  it('supports bounded PAX extended path records', async () => {
    const value = 'path=round/traces/中文.json\n'; let size = Buffer.byteLength(value) + 3;
    while (Buffer.byteLength(String(size) + ' ' + value) !== size) size = Buffer.byteLength(String(size) + ' ' + value);
    await extract(Buffer.concat([member('PaxHeader', Buffer.from(String(size) + ' ' + value), 'x'), member('placeholder', Buffer.from('{}')), Buffer.alloc(1024)]), async result => {
      expect(result.files[0]!.member).toBe('round/traces/中文.json'); expect(result.ignoredEntries).toBe(1);
    });
  });
  it('accepts GNU long names when the unused legacy header cuts a UTF-8 character', async () => {
    const name = 'round/project_copy/' + '中'.repeat(60) + '.txt';
    await extract(Buffer.concat([member('././@LongLink', Buffer.from(name + '\0'), 'L'), member(name, Buffer.from('not a trace')),
      member('traces/valid.json', Buffer.from('{}')), Buffer.alloc(1024)]), async result => {
      expect(result.files).toHaveLength(1); expect(result.files[0]!.member).toBe('traces/valid.json'); expect(result.ignoredEntries).toBe(2);
    });
  });
});
