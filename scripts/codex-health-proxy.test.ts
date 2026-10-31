// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
// @ts-expect-error Standalone JavaScript CLI intentionally has no TypeScript build output.
import { completionResponse, createCodexHealthProxy, promptFrom, resolveCodexBin, unfence } from './codex-health-proxy.mjs';
let dir: string, server: Server, url: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'health-proxy-test-'));
  const bin = join(dir, 'codex');
  await writeFile(bin, `#!${process.execPath}
let prompt = '';
process.stdin.on('data', c => prompt += c);
process.stdin.on('end', () => {
  if (prompt.includes('FAIL')) process.exit(7);
  const run = () => {
    console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'old'}}));
    console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify('```json\n{"ok":true}\n```')}}}));
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:22859,output_tokens:1505}}));
  };
  setTimeout(run, prompt.includes('SLOW') ? 500 : 0);
});
`, { mode: 0o700 });
});
async function startServer() {
  server = createCodexHealthProxy({ CODEX_BIN: join(dir, 'codex'), PROXY_TOKEN: 'test-token' });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
  url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
}
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } await rm(dir, { recursive: true, force: true }); });
const request = (content: string, token = 'test-token') => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'fixture', messages: [{ role: 'system', content: 'Instructions' }, { role: 'user', content }] }) });
it('composes prompts, strips only outer fences and constructs a deterministic completion', () => {
  expect(promptFrom([{ role: 'system', content: 'safe' }, { role: 'user', content: 'data' }])).toBe('# Instructions\n\nsafe\n\n# Input\n\ndata\n');
  expect(unfence('```json\n{}\n```')).toEqual({ text: '{}', unfenced: true }); expect(unfence('prefix ```json\n{}\n```').unfenced).toBe(false);
  expect(completionResponse('m', 'reply', { input_tokens: 10, output_tokens: 2 }, 1000, 'id')).toMatchObject({ id: 'chatcmpl-id', created: 1, choices: [{ finish_reason: 'stop', message: { content: 'reply' } }], usage: { total_tokens: 12 } });
});
it('returns the last agent message and completed usage without writing replies', async () => {
  await startServer();
  const response = await request('success'); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ model: 'fixture', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 22859, completion_tokens: 1505, total_tokens: 24364 } });
  expect(await readdir(dir)).toEqual(['codex']);
});
it('returns 502 on a nonzero Codex exit, then releases concurrency', async () => { await startServer(); expect((await request('FAIL')).status).toBe(502); expect((await request('success')).status).toBe(200); });
it('returns 401 on a wrong token', async () => { await startServer(); expect((await request('success', 'wrong')).status).toBe(401); });
it('returns 429 for a concurrent second request', async () => {
  await startServer();
  const admitted = new Promise<void>(resolve => server.once('request', () => resolve()));
  const first = request('SLOW');
  await admitted;
  expect((await request('success')).status).toBe(429); expect((await first).status).toBe(200);
});
it('resolves explicit CODEX_BIN and PATH, failing a missing explicit binary', () => {
  expect(resolveCodexBin({ CODEX_BIN: join(dir, 'codex') })).toBe(join(dir, 'codex'));
  expect(resolveCodexBin({ PATH: dir })).toBe(join(dir, 'codex'));
  expect(() => resolveCodexBin({ CODEX_BIN: join(dir, 'missing') })).toThrow('not found');
});
