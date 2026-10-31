import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { CaptureBodyStore } from './body-store.js';
import { readAnalysisBody } from './analysis-source.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(bytes = Buffer.from('中文😀原文')) {
  const directory = await mkdtemp(join(tmpdir(), 'analysis-source-'));
  directories.push(directory);
  const store = await CaptureBodyStore.create(directory);
  const writer = store.begin();
  expect(writer.append(bytes)).toBe(true);
  return { directory, store, ref: await writer.finish(), bytes };
}

describe('original analysis source', () => {
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('decodes %s asynchronously while preserving the encoded original', async (contentEncoding, compress) => {
    const { store, ref } = await fixture(compress(Buffer.from('中文😀{"original":true}')));
    expect(await readAnalysisBody(store, ref, 1024, { contentEncoding })).toEqual({ ok: true, body: '中文😀{"original":true}' });
    expect(ref.status).toBe('complete');
  });
  it('bounds decompression expansion and reports corruption/unsupported codecs', async () => {
    const { store, ref } = await fixture(gzipSync(Buffer.from('x'.repeat(100_000))));
    expect(await readAnalysisBody(store, ref, 1024, { contentEncoding: 'gzip' })).toEqual({ ok: false, reason: 'decoded_too_large' });
    expect(await readAnalysisBody(store, ref, 1024, { contentEncoding: 'zstd' })).toEqual({ ok: false, reason: 'unsupported_content_encoding' });
    expect(await readAnalysisBody(store, ref, 1024, { contentEncoding: 'br' })).toEqual({ ok: false, reason: 'decode_failed' });
  });
  it('reads exact original text and validates digest', async () => {
    const { store, ref } = await fixture();
    expect(await readAnalysisBody(store, ref)).toEqual({ ok: true, body: '中文😀原文' });
  });
  it('rejects an original over the analysis limit, without changing capture', async () => {
    const { store, ref, bytes } = await fixture();
    expect(await readAnalysisBody(store, ref, 2)).toEqual({ ok: false, reason: 'source_too_large' });
    expect(ref.status).toBe('complete');
    expect(ref.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('rejects incomplete evidence even if the prefix is valid JSON', async () => {
    const { store, ref } = await fixture(Buffer.from('{}'));
    expect(await readAnalysisBody(store, { ...ref, status: 'interrupted' })).toEqual({ ok: false, reason: 'capture_incomplete' });
  });
  it('detects modified files of equal length rather than trusting the preview', async () => {
    const { directory, store, ref } = await fixture(Buffer.from('{"a":1}'));
    await writeFile(join(directory, ref.id + '.body'), '{"a":2}');
    expect(await readAnalysisBody(store, ref)).toEqual({ ok: false, reason: 'source_integrity_failed' });
  });
  it('reports a missing file without exposing filesystem paths', async () => {
    const { directory, store, ref } = await fixture();
    await rm(join(directory, ref.id + '.body'));
    expect(await readAnalysisBody(store, ref)).toEqual({ ok: false, reason: 'source_unavailable' });
  });
  it('rejects malformed UTF-8 instead of replacing original bytes', async () => {
    const { store, ref } = await fixture(Buffer.from([0xff, 0xc0]));
    expect(await readAnalysisBody(store, ref)).toEqual({ ok: false, reason: 'invalid_utf8' });
  });
  it('bounds reads even if an external edit grows the file after capture', async () => {
    const { directory, store, ref } = await fixture(Buffer.from('a'));
    await writeFile(join(directory, ref.id + '.body'), 'x'.repeat(1024));
    expect(await readAnalysisBody(store, ref, 16)).toEqual({ ok: false, reason: 'source_too_large' });
  });
});
