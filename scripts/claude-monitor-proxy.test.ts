// @vitest-environment node
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
// @ts-expect-error Standalone JavaScript proxy has no TypeScript declaration output.
import { claudeCompletion, createClaudeMonitorHandler } from './claude-monitor-proxy.mjs';

const env = { PROXY_TOKEN: 'local-token', ANTHROPIC_API_KEY: 'private-key' };
const success = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"conclusions":[]}' }],
  usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } };
const body = { model: 'claude-test', messages: [{ role: 'system', content: 'review' }, { role: 'user', content: 'private diff' }], max_tokens: 123 };
class Response extends EventEmitter {
  headersSent = false; destroyed = false; writableEnded = false; status = 0; text = '';
  writeHead(status: number): void { this.status = status; this.headersSent = true; }
  end(value: string): void { this.text = value; this.writableEnded = true; }
}
function request(value: unknown = body, token = 'local-token') {
  return Object.assign(Readable.from([Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]), {
    method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${token}` },
  });
}
it('bridges only text via a no-tools request, includes cache usage and never logs secrets', async () => {
  const transport = vi.fn(async () => success), logs: unknown[] = [];
  const handler = createClaudeMonitorHandler(env, transport, (entry: unknown) => logs.push(entry)), res = new Response();
  await handler(request(), res);
  expect(res.status).toBe(200);
  expect(JSON.parse(res.text)).toMatchObject({ choices: [{ message: { content: '{"conclusions":[]}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 18, completion_tokens: 3, total_tokens: 21 } });
  const sent = transport.mock.calls[0] as unknown as [Record<string, unknown>, { env: unknown }];
  expect(sent[0]).toEqual({ model: 'claude-test', max_tokens: 123, system: 'review', messages: [{ role: 'user', content: 'private diff' }], stream: false });
  expect(sent[0]).not.toHaveProperty('tools');
  for (const secret of ['private-key', 'local-token', 'private diff', 'conclusions']) expect(JSON.stringify(logs)).not.toContain(secret);
});
it.each([{ tools: [] }, { functions: [] }, { tool_choice: 'none' }, { stream: true }, { messages: [{ role: 'tool', content: 'x' }] }])('rejects tool/stream requests before provider invocation', async extra => {
  const transport = vi.fn(), res = new Response();
  await createClaudeMonitorHandler(env, transport)(request({ ...body, ...extra }), res);
  expect(res.status).toBe(400); expect(transport).not.toHaveBeenCalled(); expect(JSON.parse(res.text).error.code).toBe('BAD_REQUEST');
});
it.each([
  { ...success, content: [{ type: 'tool_use', id: 'x', name: 'shell', input: {} }] },
  { ...success, stop_reason: 'tool_use' }, { ...success, stop_reason: 'max_tokens' },
  { ...success, usage: null }, { ...success, tool_calls: [] },
])('rejects unsafe, truncated or unaccounted provider responses', async raw => {
  const res = new Response();
  await createClaudeMonitorHandler(env, async () => raw)(request(), res);
  expect(res.status).toBe(502); expect(JSON.parse(res.text).error).toEqual({ code: 'PROXY_MODEL_FAILED', message: 'Claude request failed' });
});
it('checks bearer authorization and required environment without filesystem access', async () => {
  const transport = vi.fn(), res = new Response();
  await createClaudeMonitorHandler(env, transport)(request(body, 'bad'), res);
  expect(res.status).toBe(401); expect(transport).not.toHaveBeenCalled();
  expect(() => createClaudeMonitorHandler({ PROXY_TOKEN: 'x' }, transport)).toThrow('required');
});
it('caps max output tokens and permits a fixed Claude model', async () => {
  const transport = vi.fn(async () => success), res = new Response();
  await createClaudeMonitorHandler({ ...env, CLAUDE_MAX_TOKENS: '20', CLAUDE_MODEL: 'fixed' }, transport)(request(), res);
  const args = transport.mock.calls as unknown as [Record<string, unknown>][];
  expect(args[0]![0]).toMatchObject({ max_tokens: 20, model: 'fixed' });
});
it('uses bounded deadlines even when a provider ignores abort', async () => {
  const res = new Response();
  await createClaudeMonitorHandler({ ...env, CLAUDE_TIMEOUT_MS: '10' }, () => new Promise(() => {}))(request(), res);
  expect(res.status).toBe(504);
});
it('reserves concurrency and releases it after failed upstream work', async () => {
  let release: (value: unknown) => void = () => {}, entered: () => void = () => {};
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const transport = vi.fn(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const handler = createClaudeMonitorHandler(env, transport), first = new Response(), second = new Response();
  const pending = handler(request(), first); await ready;
  await handler(request(), second); expect(second.status).toBe(429);
  release(success); await pending; expect(first.status).toBe(200);
});
it('counts cache input exactly once in a pure completion conversion', () => {
  expect(claudeCompletion('m', success, 1000, 'id')).toMatchObject({ id: 'chatcmpl-id', created: 1, usage: { total_tokens: 21 } });
});
it.skipIf(process.env.RSI_REAL_CLAUDE_TEST !== '1')('calls a real externally started proxy only when explicitly enabled', async () => {
  const url = process.env.RSI_CLAUDE_PROXY_URL, token = process.env.RSI_CLAUDE_PROXY_TOKEN, model = process.env.RSI_CLAUDE_MODEL;
  if (!url || !token || !model) throw new Error('Set RSI_CLAUDE_PROXY_URL, RSI_CLAUDE_PROXY_TOKEN and RSI_CLAUDE_MODEL');
  const response = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ ...body, model }) });
  expect(response.status).toBe(200);
  const result = await response.json() as { choices: { finish_reason: string }[] };
  expect(result.choices[0]!.finish_reason).toBe('stop');
}, 125000);
