import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { pageOptions } from './page-data.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rsi external ' bank ")); roots.push(root); return root;
}
it('discovers external bank metadata without needing or exposing hidden test content', async () => {
  const bank = await directory(), missing = await directory();
  await writeFile(join(bank, 'manifest.json'), await readFile(new URL('./__fixtures__/bank/manifest.json', import.meta.url)));
  vi.stubEnv('RSI_BANK_ROOT', bank); vi.stubEnv('RSI_HARD_BANK_ROOT', join(missing, 'absent'));
  const result = await pageOptions('/configuration/awesome-telemetry-data/rsi');
  expect(result.bank?.path).toBe(bank);
  expect(result.bank?.full.find(row => row.phase === 'train')).toEqual({ phase: 'train', count: 3, languages: { javascript: 1, python: 1, go: 1 } });
  expect(result.hardBank).toBeNull();
  expect(Object.keys(result.bank!).sort()).toEqual(['full', 'path', 'small']);
  vi.stubEnv('RSI_BANK_ROOT', join(missing, 'another'));
  expect((await pageOptions('/configuration/awesome-telemetry-data/rsi')).bank).toBeNull();
});
it('reports absent packaged banks as unavailable instead of inventing choices', async () => {
  const root = await directory();
  vi.stubEnv('RSI_BANK_ROOT', join(root, 'standard')); vi.stubEnv('RSI_HARD_BANK_ROOT', join(root, 'hard'));
  const result = await pageOptions('/configuration/awesome-telemetry-data/rsi');
  expect(result.bank).toBeNull(); expect(result.hardBank).toBeNull();
  expect(result.agents.length).toBeGreaterThan(0);
});
it('keeps the page usable when an optional bank path points to a regular file', async () => {
  const root = await directory(), file = join(root, 'not-a-directory'); await writeFile(file, 'not a bank');
  vi.stubEnv('RSI_BANK_ROOT', file); vi.stubEnv('RSI_HARD_BANK_ROOT', join(root, 'absent'));
  const result = await pageOptions('/configuration/awesome-telemetry-data/rsi');
  expect(result.bank).toBeNull(); expect(result.hardBank).toBeNull(); expect(result.agents.length).toBeGreaterThan(0);
});
it.each(['constructor', 'toString', '__proto__'])('rejects invalid language metadata %s before aggregating counts', async language => {
  const root = await directory();
  const manifest = JSON.parse(await readFile(new URL('./__fixtures__/bank/manifest.json', import.meta.url), 'utf8'));
  manifest.questions[0].language = language;
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  vi.stubEnv('RSI_BANK_ROOT', root); vi.stubEnv('RSI_HARD_BANK_ROOT', join(root, 'absent'));
  await expect(pageOptions('/configuration/awesome-telemetry-data/rsi')).rejects.toMatchObject({ code: 'RSI_INVALID_REQUEST' });
});
