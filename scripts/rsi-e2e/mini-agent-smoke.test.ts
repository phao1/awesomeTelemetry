import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { runProcess } from '../../server/rsi/docker.js';
const { argumentsFor } = await import(pathToFileURL(resolve('scripts/rsi-e2e/mini-agent-smoke.mjs')).href);
const { executeTool, tools } = await import(pathToFileURL(resolve('rsi-agents/mini-agent/source/agent.mjs')).href);
it('mini harness needs no OpenCode source and rejects unknown flags', () => {
  expect(argumentsFor([])).toEqual({});
  expect(argumentsFor(['--root', '/tmp/run', '--docker-context', 'rsi'])).toEqual({ root: '/tmp/run', 'docker-context': 'rsi' });
  expect(() => argumentsFor(['--repository', '/opencode'])).toThrow('Usage');
});
it('mini Agent executes its declared tools on actual local files and processes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mini-tools-'));
  try {
    const path = join(root, 'nested/file.txt');
    expect(tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(['shell', 'read_file', 'write_file']);
    await executeTool('write_file', { path, content: 'hello' });
    expect(await readFile(path, 'utf8')).toBe('hello'); expect(await executeTool('read_file', { path })).toBe('hello');
    expect(await executeTool('shell', { command: 'printf mini-agent' })).toBe('exit=0\nmini-agent');
    await expect(executeTool('unknown', {})).rejects.toThrow('Unknown tool');
  } finally { await rm(root, { recursive: true, force: true }); }
});
it.skipIf(process.env.RSI_DOCKER_E2E !== '1')('runs the second Agent through real Docker baseline/smoke/train/held', async () => {
  const r = await runProcess(process.execPath, ['scripts/rsi-e2e/mini-agent-smoke.mjs'], { timeoutMs: 3600000, maxOutputBytes: 16 * 1024 * 1024 });
  expect(r.code, r.stderr.toString()).toBe(0);
}, 3600000);
