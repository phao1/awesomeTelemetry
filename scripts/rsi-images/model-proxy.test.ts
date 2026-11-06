import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
const { createProxyHandler } = await import(pathToFileURL(resolve('scripts/rsi-images/model-proxy.mjs')).href);
const { request, response, upstream } = await import(pathToFileURL(resolve('scripts/rsi-images/test-support.mjs')).href);
const { selectScript, replay } = await import(pathToFileURL(resolve('scripts/rsi-images/mock-model.mjs')).href);
const completion = JSON.stringify({ choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
function setup(budget = 10000, extra = {}) {
  const sent: { body: Record<string, unknown>; auth: string }[] = [], logs: Record<string, unknown>[] = [];
  const handler = createProxyHandler({ runs: [{ runId: 'run', token: 'temporary', budget }], baseURL: 'https://example.invalid/v1', apiKey: 'real-secret', model: 'forced', maxTokens: 64,
    log: async (row: Record<string, unknown>) => { logs.push(row); }, transport: async (_url: URL, options: { headers: { authorization: string } }, body: string) => {
      sent.push({ body: JSON.parse(body), auth: options.headers.authorization }); return upstream(completion);
    }, ...extra });
  return { handler, sent, logs };
}
describe('productized model proxy without sockets', () => {
  it('forces model, output limit and attribution without logging secrets', async () => {
    const { handler, sent, logs } = setup(), res = response(); await handler(request({ model: 'evil', max_tokens: 1000 }, { stream: false }), res);
    expect(res.statusCode).toBe(200); expect(sent[0]!.body.model).toBe('forced'); expect(sent[0]!.body.max_tokens).toBe(64);
    expect(sent[0]!.auth).toBe('Bearer real-secret'); expect(logs.at(-1)!.runId).toBe('run'); expect(logs.at(-1)!.chargedTokens).toBe(120);
    expect(JSON.stringify(logs)).not.toMatch(/real-secret|temporary/);
  });
  it('does not reserve one token per byte of a large tool definition', async () => {
    const { handler, sent } = setup(), res = response();
    await handler(request({ tools: [{ type: 'function', function: { name: 'shell', description: 'a'.repeat(20000) } }] }, { stream: false }), res);
    expect(res.statusCode).toBe(200); expect(sent).toHaveLength(1);
  });
  it('rejects invalid bearer and hard blocks exhausted budgets before forwarding', async () => {
    const { handler, sent } = setup(2), res = response(); await handler(request({}), res); expect(res.statusCode).toBe(429); expect(sent).toHaveLength(0);
    const wrong = response(); await handler(request({}, { token: 'wrong' }), wrong); expect(wrong.statusCode).toBe(401);
  });
  it('calibrates observed input and prevents a subsequent overspend', async () => {
    const { handler, sent } = setup(120), first = response(); await handler(request({}, { stream: false }), first);
    expect(first.statusCode).toBe(200); const second = response(); await handler(request({}, { stream: false }), second); expect(second.statusCode).toBe(429); expect(sent).toHaveLength(1);
  });
  it('serializes concurrent requests per run before budget admission', async () => {
    let release!: () => void, enter!: () => void;
    const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    let count = 0;
    const { handler } = setup(120, { transport: async () => { count++; enter(); await held; return upstream(completion); } });
    const first = response(), pending = handler(request({}, { stream: false }), first); await entered;
    const second = response(), other = handler(request({}, { stream: false }), second); release(); await Promise.all([pending, other]);
    expect(count).toBe(1); expect(second.statusCode).toBe(429);
  });
  it('streams unchanged SSE while retaining metered usage', async () => {
    const sse = `data: ${completion}\n\ndata: [DONE]\n\n`, { handler, logs } = setup(10000, { transport: async () => upstream(sse) });
    const res = response(); await handler(request({}), res); expect(res.body()).toBe(sse); expect(logs.at(-1)!.chargedTokens).toBe(120);
  });
  it('burns reserved usage on incomplete replies and sanitizes transport errors', async () => {
    const { handler, logs } = setup(10000, { transport: async () => upstream('data: [DONE]\n\n') }); await handler(request({}), response());
    expect(logs.at(-1)!.complete).toBe(true); expect(logs.at(-1)!.error).toBe('incomplete_or_missing_usage'); expect(logs.at(-1)!.chargedTokens).toBeGreaterThan(0);
    const broken = setup(10000, { transport: async () => { throw new Error('real-secret'); } }); const res = response(); await broken.handler(request({}), res);
    expect(res.statusCode).toBe(502); expect(res.body()).not.toContain('real-secret'); expect(JSON.stringify(broken.logs)).not.toContain('real-secret');
  });
  it('mock tables choose pass/fail/flaky by attributed repetition', () => {
    const table = { q: { outcome: 'flaky', passCommand: 'fix', failCommand: 'true', repetitions: [false, true, false] } };
    expect([0, 1, 2].map(repetition => selectScript({ questionId: 'q', repetition }, table))).toEqual(['true', 'fix', 'true']);
    expect(selectScript({ questionId: 'q' }, { q: { outcome: 'pass', passCommand: 'fix' } })).toBe('fix');
    expect(selectScript({ questionId: 'q' }, { q: { outcome: 'fail', passCommand: 'fix' } })).toBe('true');
    expect(() => selectScript({ questionId: 'missing' }, table)).toThrow();
    const r = replay({ messages: [], tools: [{ function: { name: 'shell' } }] }, 'fix');
    expect(JSON.parse(r.choices[0].message.tool_calls[0].function.arguments).command).toBe('fix');
  });
});
