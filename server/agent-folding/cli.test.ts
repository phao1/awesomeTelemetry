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

it('reads existing SQLite without writes, exports only to a new directory, and rejects execution flags', async () => {
  const { openWritable } = await import('../storage/db.js');
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'folding-cli-readonly-')); dirs.push(dir);
  const path = join(dir, 'state.sqlite'), db = openWritable(path);
  const { claudeScanner } = await import('../../local-sessions/claude.js');
  const source = join(dir, 'root.jsonl');
  await writeFile(source, JSON.stringify({ type: 'user', sessionId: 'root', timestamp: '2026-10-30T00:00:00.000Z', message: { content: '[test]' } }) + '\n');
  await claudeScanner.scanFile({ key: 'claude', enabled: false, path: dir, sourceKind: 'jsonl', watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude' }, source, { db });
  db.close();
  const snapshot = await readFile(path), before = join(dir, 'before.jsonl'), after = join(dir, 'after.jsonl');
  await writeFile(before, '{"prompt_id":"case","grade":{"pass":1},"in_tokens":100,"out_tokens":20}\n');
  await writeFile(after, '{"prompt_id":"case","grade":{"pass":0},"in_tokens":80,"out_tokens":10}\n');
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await runAgentFoldingCli(['compare', '--db', path, '--before', before, '--after', after]);
  expect(JSON.parse(output.mock.calls.at(-1)![0] as string).status).toBe('worse');
  await runAgentFoldingCli(['estimate', '--db', path, '--before', before, '--reps', '2']);
  expect(JSON.parse(output.mock.calls.at(-1)![0] as string).input.likely).toBe(200);
  const target = join(dir, 'export'); await runAgentFoldingCli(['export', '--db', path, '--output', target]);
  expect(await readdir(target)).toEqual(['PLAN.md', 'inventory.tsv', 'traces.jsonl']);
  await expect(runAgentFoldingCli(['export', '--db', path, '--output', target])).rejects.toThrow();
  await expect(runAgentFoldingCli(['compare', '--db', path, '--execute'])).rejects.toThrow('Invalid');
  expect(await readFile(path)).toEqual(snapshot);
});
