import { afterEach, expect, it, vi } from 'vitest';
import { AnthropicHealthClient, healthModelStatus, OpenAICompatibleHealthClient } from './model-client.js';
import type { FoldingModelRequest } from '../agent-folding/anthropic.js';
const env = { HEALTH_MODEL_PROVIDER: 'openai-compatible', HEALTH_MODEL: 'fixture-model', HEALTH_MODEL_BASE_URL: 'https://fixture.invalid/v1', HEALTH_MODEL_API_KEY: 'fixture-only' };
const request = () => ({ system: 'system', user: 'untrusted data', maxTokens: 40, signal: new AbortController().signal });
afterEach(() => vi.restoreAllMocks());
it('requires an explicit model and exposes no secret or base URL', () => {
  expect(healthModelStatus(env)).toEqual({ configured: true, provider: 'openai-compatible', model: 'fixture-model' });
  expect(healthModelStatus({ ...env, HEALTH_MODEL: '' }).configured).toBe(false);
  expect(healthModelStatus({ ...env, HEALTH_MODEL_BASE_URL: 'https://user:secret@fixture.invalid' }).configured).toBe(false);
  expect(healthModelStatus({})).toEqual({ configured: false, provider: null, model: null });
});
it('sends one compatible chat completion with only server configuration and accounts usage', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 20, completion_tokens: 8 } })));
  const r = await new OpenAICompatibleHealthClient(env, fetcher).create(request());
  expect(r).toEqual({ text: '{}', inputTokens: 20, outputTokens: 8 }); expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0]!; expect(url).toBe('https://fixture.invalid/v1/chat/completions'); expect(init!.headers).toMatchObject({ authorization: 'Bearer fixture-only' }); expect(init!.redirect).toBe('error');
  expect(JSON.parse(init!.body as string)).toEqual({ model: 'fixture-model', messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'untrusted data' }], max_tokens: 40, stream: false });
});
it.each([401, 429, 500])('maps HTTP %i to a static failure without retry or remote body leakage', async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private remote error', { status }));
  await expect(new OpenAICompatibleHealthClient(env, fetcher).create(request())).rejects.toMatchObject({ code: 'HEALTH_MODEL_FAILED' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects streamed response over2MiB', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2 * 1024 * 1024)); c.enqueue(new Uint8Array(1)); c.close(); } })));
  await expect(new OpenAICompatibleHealthClient(env, fetcher).create(request())).rejects.toMatchObject({ code: 'HEALTH_SIZE_LIMIT' });
});
it.each(['not JSON', JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: '{}', tool_calls: [] } }] }), JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: -1 } })])('rejects malformed/unsafe transport output without retry', async text => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(text)); await expect(new OpenAICompatibleHealthClient(env, fetcher).create(request())).rejects.toMatchObject({ code: 'HEALTH_MODEL_FAILED' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('wraps the existing Anthropic client with zero tools and only HEALTH configuration', async () => {
  const create = vi.fn(async (r: FoldingModelRequest) => ({ model: r.model, content: [{ type: 'text', text: '{}' }], stopReason: 'end_turn', inputTokens: 4, outputTokens: 2 }));
  const client = new AnthropicHealthClient({ ...env, HEALTH_MODEL_PROVIDER: 'anthropic' }, { fixture: true, create });
  expect(await client.create(request())).toEqual({ text: '{}', inputTokens: 4, outputTokens: 2 }); expect(create.mock.calls[0]![0]).toMatchObject({ model: 'fixture-model', tools: [], messages: [{ role: 'user', content: 'untrusted data' }] });
});
