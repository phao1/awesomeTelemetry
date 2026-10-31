import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureBodyStore } from '../proxy/body-store.js';
import { WS_ARCHIVE_MAGIC, wsRecordHeader } from '../proxy/websocket-archive.js';
import { readCodexArchive, type DirectedRecord } from './archive.js';
import { projectCodex } from './projector.js';
import type { CodexSource } from './source.js';

const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const message = (sequence: number, value: unknown): Buffer => {
  const bytes = Buffer.from(JSON.stringify(value)); return Buffer.concat([wsRecordHeader('message', false, sequence, sequence, bytes.length), bytes]);
};
async function fixture(request: Buffer, response: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-archive-')), store = await CaptureBodyStore.create(directory);
  const a = store.begin(), b = store.begin(); a.append(request); b.append(response);
  const [requestRef, responseRef] = await Promise.all([a.finish(), b.finish()]);
  const source: CodexSource = { directory, requestId: 'synthetic-archive', active: false, startedAt: '2026-10-16T00:00:00.000Z', headers: {}, request: requestRef, response: responseRef };
  return { source, store, close: () => rm(directory, { recursive: true, force: true }) };
}
async function records(source: CodexSource, reasons = new Set<string>()): Promise<DirectedRecord[]> { const rows = []; for await (const row of readCodexArchive(source, reasons)) rows.push(row); return rows; }

describe('streamed Codex archive inspection', () => {
  it('merges original directions by observation sequence and verifies exact bytes', async () => {
    const request = Buffer.concat([WS_ARCHIVE_MAGIC, message(1, { type: 'response.create', input: 'synthetic' }), message(4, { type: 'response.create' })]);
    const response = Buffer.concat([WS_ARCHIVE_MAGIC, message(2, { type: 'response.created', response: { id: 'one' } }), message(3, { type: 'response.completed', response: { id: 'one' } })]);
    const f = await fixture(request, response);
    try {
      expect((await records(f.source)).map(row => row.sequence)).toEqual([1, 2, 3, 4]);
      expect(f.source.request.sha256).toBe(hash(request)); expect(f.source.response.sha256).toBe(hash(response));
      expect((await projectCodex(f.source)).page.items.map(call => call.state)).toEqual(['completed', 'incomplete']);
    } finally { await f.close(); }
  });
  it('streams a source larger than the old 2MiB preview bound', async () => {
    const request = Buffer.concat([WS_ARCHIVE_MAGIC, ...Array.from({ length: 3 }, (_, index) => message(index + 1, { type: 'unrelated', payload: 'x'.repeat(800000) }))]);
    const f = await fixture(request, WS_ARCHIVE_MAGIC);
    try { expect((await records(f.source))).toHaveLength(3); expect(f.source.request.bytes).toBeGreaterThan(2 * 1024 * 1024); }
    finally { await f.close(); }
  });
  it('rejects altered digest, file size, malformed frames and duplicate global sequence', async () => {
    const f = await fixture(Buffer.concat([WS_ARCHIVE_MAGIC, message(1, {})]), Buffer.concat([WS_ARCHIVE_MAGIC, message(2, {})]));
    try {
      expect(await records(f.source)).toHaveLength(2);
      await expect(records({ ...f.source, request: { ...f.source.request, sha256: 'f'.repeat(64) } })).rejects.toBeTruthy();
      await expect(records({ ...f.source, request: { ...f.source.request, bytes: f.source.request.bytes + 1 } })).rejects.toBeTruthy();
    } finally { await f.close(); }
    const duplicate = await fixture(Buffer.concat([WS_ARCHIVE_MAGIC, message(1, {})]), Buffer.concat([WS_ARCHIVE_MAGIC, message(1, {})]));
    try { await expect(records(duplicate.source)).rejects.toMatchObject({ code: 'CODEX_INSPECTION_FAILED' }); } finally { await duplicate.close(); }
    const invalid = await fixture(Buffer.from('BADWS!'), WS_ARCHIVE_MAGIC);
    try { await expect(records(invalid.source)).rejects.toMatchObject({ code: 'CODEX_INSPECTION_FAILED' }); } finally { await invalid.close(); }
  });
  it('retains complete records before a partial live frame, and does not parse the partial payload', async () => {
    const f = await fixture(Buffer.concat([WS_ARCHIVE_MAGIC, message(1, { type: 'response.create' }), message(3, { type: 'response.create' }).subarray(0, 20)]), WS_ARCHIVE_MAGIC);
    const reasons = new Set<string>();
    try { expect(await records({ ...f.source, active: true }, reasons)).toHaveLength(1); expect([...reasons]).toContain('request_partial_record'); }
    finally { await f.close(); }
  });
  it('reads a written live prefix without waiting for writer finish and rejects symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-prefix-')), store = await CaptureBodyStore.create(directory);
    const a = store.begin(), b = store.begin(); a.append(Buffer.concat([WS_ARCHIVE_MAGIC, message(1, { type: 'response.create' })])); b.append(WS_ARCHIVE_MAGIC);
    try {
      expect(a.snapshot().bytes).toBe(0);
      while (store.status().pendingBytes !== 0) await new Promise(resolve => setTimeout(resolve, 1));
      const source: CodexSource = { directory, requestId: 'live', active: true, startedAt: '2026-10-16T00:00:00.000Z', headers: {}, request: a.snapshot(), response: b.snapshot() };
      expect(await records(source)).toHaveLength(1);
      await Promise.all([a.finish(), b.finish()]);
      const link = '22222222-2222-4222-8222-222222222222'; await symlink(join(directory, a.id + '.body'), join(directory, link + '.body'));
      await expect(records({ ...source, active: false, request: { ...source.request, id: link } })).rejects.toBeTruthy();
    } finally { await Promise.all([a.finish(), b.finish()]); await rm(directory, { recursive: true, force: true }); }
  });
});
