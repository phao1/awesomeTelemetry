import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxyHandler } from './model-proxy.mjs';
import { request, response, upstream } from './test-support.mjs';
const completion = JSON.stringify({ choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } } });
function setup(overrides = {}) {
  const logs = [];
  const sent = [];
  const handler = createProxyHandler({ runs: [{ runId: 'a', token: 'temporary', budget: 10000 }],
    baseURL: 'https://example.invalid/v1', apiKey: 'real-secret', model: 'forced', maxTokens: 64,
    log: async row => logs.push(row), transport: async (url, options, body) => {
      sent.push({ url, options, body: JSON.parse(body) }); return upstream(completion);
    }, ...overrides });
  return { handler, logs, sent };
}
test('bad bearer is 401 and never forwarded', async () => {
  const { handler, sent } = setup(); const res = response();
  await handler(request({}, { token: 'wrong' }), res);
  assert.equal(res.statusCode, 401); assert.equal(sent.length, 0);
});
test('forces model, max output, single choice and replaces token', async () => {
  const { handler, logs, sent } = setup(); const res = response();
  await handler(request({ model: 'evil', n: 8, max_completion_tokens: 9999 }, { stream: false }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].body.model, 'forced'); assert.equal(sent[0].body.max_tokens, 64);
  assert.equal(sent[0].body.max_completion_tokens, undefined); assert.equal(sent[0].body.n, 1);
  assert.equal(sent[0].options.headers.authorization, 'Bearer real-secret');
  assert.equal(logs[0].usage.total, 120); assert.equal(logs[0].cacheHitRate, 0.1);
  assert.equal(logs[0].runId, 'a'); assert.equal(logs[0].complete, true);
  assert.ok(logs[0].firstByteMs >= 0); assert.ok(logs[0].durationMs >= logs[0].firstByteMs);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
  assert.equal(JSON.stringify(logs).includes('temporary'), false);
});
test('small budget refuses before upstream', async () => {
  const { handler, sent } = setup({ runs: [{ runId: 'a', token: 'temporary', budget: 2 }] }); const res = response();
  await handler(request({}), res); assert.equal(res.statusCode, 429); assert.equal(sent.length, 0);
});
test('request reservation includes system/tool bytes', async () => {
  const { handler, sent } = setup({ runs: [{ runId: 'a', token: 'temporary', budget: 500 }] }); const res = response();
  await handler(request({ messages: [{ role: 'system', content: 'a'.repeat(1000) }] }), res);
  assert.equal(res.statusCode, 429); assert.equal(sent.length, 0);
});
test('SSE streaming is byte-identical and usage is collected', async () => {
  const sse = `data: ${completion}\n\ndata: [DONE]\n\n`;
  const { handler, logs } = setup({ transport: async (_url, _options, body) => {
    assert.deepEqual(JSON.parse(body).stream_options, { include_usage: true });
    return upstream(sse);
  } });
  const res = response(); await handler(request({}), res);
  assert.equal(res.body(), sse); assert.equal(logs[0].usage.total, 120);
});
test('missing usage is explicit and charged conservatively', async () => {
  const { handler, logs } = setup({ transport: async () => upstream('data: [DONE]\n\n') });
  await handler(request({}), response());
  assert.equal(logs[0].usage, null); assert.equal(logs[0].error, 'incomplete_or_missing_usage');
  assert.ok(logs[0].chargedTokens > 64);
});
test('upstream errors cannot leak vendor response or credential', async () => {
  const { handler, logs } = setup({ transport: async () => upstream('real-secret', 401) });
  const res = response(); await handler(request({}), res);
  assert.equal(res.statusCode, 502); assert.equal(res.body().includes('real-secret'), false);
  assert.equal(logs[0].error, 'upstream_rejected');
});
test('transport failure is explicit and sanitized', async () => {
  const { handler, logs } = setup({ transport: async () => { throw new Error('real-secret'); } });
  const res = response(); await handler(request({}), res);
  assert.equal(res.statusCode, 502); assert.equal(JSON.stringify(logs).includes('real-secret'), false);
});
test('run budgets are isolated across bearer identities', async () => {
  const { handler, logs } = setup({ runs: [{ runId: 'a', token: 'temporary', budget: 2 }, { runId: 'b', token: 'second', budget: 10000 }] });
  const a = response(); await handler(request({}), a);
  const b = response(); await handler(request({}, { token: 'second', stream: false }), b);
  assert.equal(a.statusCode, 429); assert.equal(b.statusCode, 200); assert.equal(logs.at(-1).runId, 'b');
});
test('socket integration outside sandbox', { skip: 'Sandbox forbids binding ports; run Docker real/mock workflows in runbook' }, () => {});

test('observed usage exhausts budget across repeated calls', async () => {
  const { handler } = setup({ runs: [{ runId: 'a', token: 'temporary', budget: 230 }] });
  const first = response(); await handler(request({}, { stream: false }), first);
  assert.equal(first.statusCode, 200);
  const second = response(); await handler(request({}, { stream: false }), second);
  assert.equal(second.statusCode, 429);
});
test('invalid token limits never forward', async () => {
  for (const max_tokens of [-1, 0, 'unlimited']) {
    const { handler, sent } = setup(); const res = response();
    await handler(request({ max_tokens }), res);
    assert.equal(res.statusCode, 400); assert.equal(sent.length, 0);
  }
});
test('per-run reservation blocks concurrent over-admission', async () => {
  let release;
  const entered = new Promise(resolve => { release = resolve; });
  let finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  let forwards = 0;
  const { handler } = setup({ runs: [{ runId: 'a', token: 'temporary', budget: 230 }],
    transport: async () => { forwards++; release(); await blocked; return upstream(completion); } });
  const first = response(); const pending = handler(request({}, { stream: false }), first);
  await entered;
  const second = response(); await handler(request({}, { stream: false }), second);
  assert.equal(second.statusCode, 429); assert.equal(forwards, 1);
  finish(); await pending; assert.equal(first.statusCode, 200);
});
