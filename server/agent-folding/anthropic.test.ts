import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicFoldingClient, foldingProviderStatus } from './anthropic.js';
import type { FoldingModelRequest } from './anthropic.js';
import { DEFAULT_FOLDING_PLAN, loadFoldingExample, loadSupportDeskFixture } from './catalog.js';
import { FixtureFoldingClient } from './fixture.js';
import { freshFoldingProject, runFoldingExperiment } from './runner.js';

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function endpoint(handler: RequestListener) {
  const server = createServer(handler); servers.push(server); await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/messages`;
}
function request(): FoldingModelRequest { return { agentId: 'router', model: 'explicit-fixture-model', system: 'Fixture conformance', tools: [{ name: 'lookup', description: 'Lookup', input_schema: { type: 'object' }, defer_loading: true }, { name: 'tool_search_tool_bm25', description: '', input_schema: {}, ...{ type: 'tool_search_tool_bm25_20251119' } }], messages: [{ role: 'user', content: 'Read' }], maxTokens: 123, signal: new AbortController().signal }; }
it('sends the actual Messages wire protocol over local HTTP, with correct server-tool shape and cache accounting', async () => {
  let body: Record<string, unknown> | null = null, authenticated = false;
  const url = await endpoint(async (req, res) => {
    authenticated = req.headers['x-api-key'] === 'test-only-secret';
    let text = ''; for await (const chunk of req) text += String(chunk); body = JSON.parse(text) as Record<string, unknown>;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'explicit-fixture-model', stop_reason: 'tool_use', content: [{ type: 'server_tool_use', id: 'search-1', name: 'tool_search_tool_bm25', input: { query: 'lookup' } }, { type: 'tool_search_tool_result', tool_use_id: 'search-1', content: { tool_references: [{ type: 'tool_reference', tool_name: 'lookup' }] } }, { type: 'tool_use', id: 'call-1', name: 'lookup', input: {} }], usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 6 } }));
  });
  const client = new AnthropicFoldingClient({ endpoint: url, env: { ANTHROPIC_API_KEY: 'test-only-secret' }, fixture: true }), result = await client.create(request());
  expect(authenticated).toBe(true); expect(body).toMatchObject({ model: 'explicit-fixture-model', max_tokens: 123 });
  expect((body as unknown as { tools: unknown[] }).tools[1]).toEqual({ name: 'tool_search_tool_bm25', type: 'tool_search_tool_bm25_20251119' });
  expect(result.inputTokens).toBe(12); expect(result.outputTokens).toBe(6); expect(result.content).toHaveLength(3); expect(client.fixture).toBe(true);
});
it('does not retry or echo remote error bodies, and cancels an owned HTTP request', async () => {
  let calls = 0;
  const bad = await endpoint((_req, res) => { calls++; res.writeHead(429); res.end('test-only-secret'); });
  await expect(new AnthropicFoldingClient({ endpoint: bad, env: { ANTHROPIC_API_KEY: 'test-only-secret' } }).create(request())).rejects.toThrow('HTTP 429'); expect(calls).toBe(1);
  const hanging = await endpoint((_req, _res) => { calls++; }), controller = new AbortController();
  const pending = new AnthropicFoldingClient({ endpoint: hanging, env: { ANTHROPIC_API_KEY: 'fixture' } }).create({ ...request(), signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toThrow();
});
it('reports only environment configuration booleans and rejects missing credentials', () => {
  expect(foldingProviderStatus({ ANTHROPIC_API_KEY: 'do-not-display', FOLDING_MODEL: 'explicit' })).toEqual({ anthropicConfigured: true, modelConfigured: true, model: 'explicit', paidExecution: 'cli_only' });
  expect(() => new AnthropicFoldingClient({ env: {} })).toThrow('environment');
});
it('rejects duplicate tool IDs and unsafe token totals in real HTTP response parsing', async () => {
  for (const duplicate of [true, false]) {
    const url = await endpoint((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'fixture', stop_reason: 'tool_use', content: duplicate ? [{ type: 'tool_use', id: 'same', name: 'write', input: {} }, { type: 'tool_use', id: 'same', name: 'write', input: {} }] : [], usage: { input_tokens: duplicate ? 1 : Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, output_tokens: 1 } })); });
    await expect(new AnthropicFoldingClient({ endpoint: url, env: { ANTHROPIC_API_KEY: 'fixture' }, fixture: true }).create(request())).rejects.toThrow(duplicate ? 'Duplicate' : 'usage total');
  }
});
it('executes a complete baseline/fold graph through native fetch and an actual local HTTP Messages stand-in, without vendor calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'folding-http-fixture-')), received: Record<string, unknown>[] = [], fake = new FixtureFoldingClient();
  try {
    const url = await endpoint(async (req, res) => {
      let text = ''; for await (const chunk of req) text += String(chunk); const body = JSON.parse(text) as Record<string, unknown>; received.push(body);
      const system = String(body.system), agentId = /support router/.test(system) ? 'router' : system.startsWith('RETURNS') ? 'returns' : 'other';
      const response = await fake.create({ agentId, model: String(body.model), system, tools: body.tools as FoldingModelRequest['tools'], messages: body.messages as FoldingModelRequest['messages'], maxTokens: Number(body.max_tokens), signal: new AbortController().signal });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ content: response.content, stop_reason: response.stopReason, model: body.model, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
    const project = freshFoldingProject(await loadFoldingExample()), fixture = await loadSupportDeskFixture();
    const plan = { ...structuredClone(DEFAULT_FOLDING_PLAN), skillAblation: false, caseIds: ['t04'], repetitions: 1 };
    const report = await runFoldingExperiment(project, plan, { output: join(directory, 'run'), fixture, client: new AnthropicFoldingClient({ endpoint: url, env: { ANTHROPIC_API_KEY: 'local-http-fixture' }, fixture: true }) });
    expect(report.trials).toHaveLength(2); expect(report.trials.every(t => t.grade === null && t.harnessError === null && t.inputTokens! > 0)).toBe(true);
    expect(received.length).toBeGreaterThan(6);
    expect(received.some(r => (r.messages as Array<{ content: unknown }>).some(m => Array.isArray(m.content) && m.content.some((b: { type: string }) => b.type === 'tool_result')))).toBe(true);
    expect(report.sources.find(s => s.kind === 'offline_smoke')?.limitations.join(' ')).toContain('no quality');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
