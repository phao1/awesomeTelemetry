import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_FOLDING_PLAN } from './catalog.js';
import { runAgentFoldingCli } from './cli.js';
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
it('validates and estimates by default without creating output or running a model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-cli-')); dirs.push(dir); const config = join(dir, 'plan.json'); await writeFile(config, JSON.stringify(DEFAULT_FOLDING_PLAN));
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await runAgentFoldingCli([config]); expect(await readdir(dir)).toEqual(['plan.json']); expect(output.mock.calls.flat().join(' ')).toContain('Nothing executed');
  await expect(runAgentFoldingCli([config, '--execute'])).rejects.toThrow('--output');
  await expect(runAgentFoldingCli([config, '--driver', 'sh'])).rejects.toThrow('Invalid arguments');
});
it('requires separate execute and paid flags and an explicit model for Anthropic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'folding-cli-paid-')); dirs.push(dir); const config = join(dir, 'plan.json');
  await writeFile(config, JSON.stringify({ ...DEFAULT_FOLDING_PLAN, provider: 'anthropic', model: 'explicit-model' }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(runAgentFoldingCli([config, '--execute', '--output', join(dir, 'run')])).rejects.toThrow('--allow-paid');
  expect(await readdir(dir)).toEqual(['plan.json']);
});
