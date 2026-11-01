import { mkdtemp, writeFile, appendFile, rm, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { FOLDING_SOURCE_BYTE_LIMIT, openSourceStream, relevantSourceLine, sourceBudget, sourceFingerprint } from './source.js';
it('uses stable missing/readability fingerprints and detects appearance, growth and disappearance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-source-')), file = join(dir, 'source');
  try {
    expect(await sourceFingerprint(file)).toBe('missing');
    expect(await sourceFingerprint(dir)).toBe('missing');
    await writeFile(file, 'x'); const before = await sourceFingerprint(file);
    expect(before).not.toBe('missing');
    await appendFile(file, 'xx'); expect(await sourceFingerprint(file)).not.toEqual(before);
    await chmod(file, 0); expect(await sourceFingerprint(file)).toBe('missing');
    await chmod(file, 0o600); await rm(file); expect(await sourceFingerprint(file)).toBe('missing');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('counts unique file bytes including UTF8/CRLF across readers and accumulates different files', async () => {
  expect(FOLDING_SOURCE_BYTE_LIMIT).toBe(512 * 1024 * 1024);
  const dir = await mkdtemp(join(tmpdir(), 'folding-budget-')), file = join(dir, 'source');
  try {
    await writeFile(file, '中文\r\n'); const signal = new AbortController().signal, budget = sourceBudget(signal, 10);
    const read = async () => { const stream = await openSourceStream(file, budget, signal); for await (const chunk of stream) expect(chunk.length).toBe(8); };
    await read(); expect(budget.bytes).toBe(8); expect(sourceBudget(signal)).toBe(budget);
    await read(); expect(budget.bytes).toBe(8);
    const alias = join(dir, 'alias'); await link(file, alias);
    for await (const chunk of await openSourceStream(alias, budget, signal)) expect(chunk.length).toBe(8);
    expect(budget.bytes).toBe(8);
    const other = join(dir, 'other'); await writeFile(other, '中文\r\n');
    await expect(openSourceStream(other, budget, signal)).rejects.toMatchObject({ reason: 'TOO_LARGE', details: { bytes: 16, limit: 10 } });
    expect(budget.bytes).toBe(16);
    // A different owned job has its own file set.
    expect(sourceBudget(new AbortController().signal).bytes).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('adds distinct file sizes and charges only new bytes when a previously read file grows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-growth-')), first = join(dir, 'first'), second = join(dir, 'second');
  try {
    await writeFile(first, '1234'); await writeFile(second, '5678');
    const budget = sourceBudget(undefined, 10);
    const read = async (path: string) => { for await (const chunk of await openSourceStream(path, budget)) expect(chunk.length).toBeGreaterThan(0); };
    await read(first); await read(second); expect(budget.bytes).toBe(8);
    await appendFile(first, '90'); await read(first); expect(budget.bytes).toBe(10);
    await read(second); expect(budget.bytes).toBe(10);
    await appendFile(first, 'x');
    await expect(read(first)).rejects.toMatchObject({ reason: 'TOO_LARGE', details: { bytes: 11, limit: 10 } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('prefilters only irrelevant lines and preserves unicode-escaped property/value names', () => {
  expect(relevantSourceLine('{"type":"other","text":"padding"}', ['assistant'])).toBe(false);
  const escaped = '{"type":"assista\\u006et"}';
  expect(JSON.parse(escaped)).toEqual({ type: 'assistant' });
  expect(relevantSourceLine(escaped, ['assistant'])).toBe(true);
});
