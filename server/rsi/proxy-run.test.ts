import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { exportProxyArtifacts, startProxy, upstreamEnvironment } from './proxy-run.js';
import { packFiles } from './artifacts.js';
import type { CommandOptions, DockerClient } from './docker.js';

it('requires all upstream variables together, reporting names only', () => {
  expect(() => upstreamEnvironment({ RSI_UPSTREAM_API_KEY: 'private-key' })).toThrow('RSI_UPSTREAM_BASE_URL, RSI_UPSTREAM_MODEL');
  expect(upstreamEnvironment({ RSI_UPSTREAM_API_KEY: 'private-key', RSI_UPSTREAM_MODEL: 'model', RSI_UPSTREAM_BASE_URL: 'https://example.invalid/v1', OTHER_SECRET: 'ignored' })).toEqual({ RSI_UPSTREAM_API_KEY: 'private-key', RSI_UPSTREAM_MODEL: 'model', RSI_UPSTREAM_BASE_URL: 'https://example.invalid/v1' });
});
it('mock proxy receives no upstream credentials and exports all traces via tar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'proxy-'));
  const calls: Array<{ argv: string[]; options?: CommandOptions }> = [];
  const archive = packFiles(new Map([['usage.jsonl', Buffer.from('usage')], ['responses.jsonl', Buffer.from('response')], ['last-request.json', Buffer.from('{"messages":[]}')]]));
  const client: DockerClient = { run: async (argv, options) => {
    calls.push({ argv, options }); return { code: 0, stdout: argv.includes('-cf') ? archive : Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, cancelled: false, overflow: false };
  } };
  try {
    const proxy = await startProxy(client, 'task', 'run', 'question', 0, 10000, { mode: 'mock', maxTokens: 4096, inputTokensPerByte: 0.35, mockTable: {} });
    const create = calls.find(c => c.argv[0] === 'create')!;
    expect(Object.keys(create.options!.env!)).not.toContain('RSI_UPSTREAM_API_KEY');
    expect(create.argv).toContain('--cap-drop'); expect(create.argv).not.toContain('-v');
    await exportProxyArtifacts(client, proxy, root);
    expect(await readFile(join(root, 'proxy/responses.jsonl'), 'utf8')).toBe('response');
    expect(await readFile(join(root, 'proxy/last-request.json'), 'utf8')).toBe('{"messages":[]}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
