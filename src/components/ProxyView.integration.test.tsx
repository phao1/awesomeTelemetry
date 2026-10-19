import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import type { LocalSessionConfig, ProxyRuntimeStatus } from '../core/trace-types.js';
import { ProxyView } from './ProxyView.js';

const listen = (server: Server): Promise<void> => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = (server: Server): Promise<void> => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

it('drives real isolated start → forwarding → local-only clear/restore → exact originals/analysis → confirmed stop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capture-workbench-ui-'));
  const runtime = await createViteServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } });
  const { DEFAULT_LOCAL_SESSION_CONFIG } = await runtime.ssrLoadModule('/local-sessions/config.ts');
  const { createAgentObservabilityServer } = await runtime.ssrLoadModule('/server/server.ts');
  const { initSchema } = await runtime.ssrLoadModule('/server/storage/schema.ts');
  const db = new Database(':memory:');db.pragma('foreign_keys=ON');initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG) as LocalSessionConfig;
  for (const provider of Object.values(config.providers)) { provider.enabled = false;provider.path = join(directory, 'disabled-source'); }
  const server = createAgentObservabilityServer({ db, config, captureDirectory: join(directory, 'originals'), caDirectory: join(directory, 'ca'),
    projectConfigPath: join(directory, 'project.json'), userConfigPath: join(directory, 'user.json') });
  const answer = JSON.stringify({ id: 'synthetic-chat-ui', object: 'chat.completion', model: 'synthetic-local-only',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ISOLATED_RESPONSE_ONLY' }, finish_reason: 'stop' }], usage: { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 } });
  let originRequests = 0;
  const upstream = createServer((req, res) => {
    originRequests += 1;req.resume();req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' });res.end(answer); });
  });
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container), nativeFetch = fetch;
  const pending = new Set<Promise<Response>>(), calls: Array<{ method: string; path: string }> = [];
  try {
    await listen(server);await listen(upstream);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Reserve a validated ephemeral port; never reuse the user's configured listener.
    const probe = createServer();await listen(probe);const proxyPort = (probe.address() as AddressInfo).port;await close(probe);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), origin);
      if (url.origin !== origin || !url.pathname.startsWith('/api/proxy/')) throw new Error('Unexpected non-isolated capture IO');
      calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search });
      const result = nativeFetch(url, init).then(async value => { await value.clone().arrayBuffer();return value; });pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));return result;
    });
    const settle = async (): Promise<void> => {
      for (let pass = 0; pass < 10; pass += 1) { await act(async () => { await Promise.all([...pending]); });if (pending.size === 0) return; }
      throw new Error('Unexpected repeated capture IO');
    };
    const button = (text: string): HTMLButtonElement => {
      const node = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text);expect(node, text).toBeDefined();return node!;
    };
    const status = async (): Promise<ProxyRuntimeStatus> => (await nativeFetch(origin + '/api/proxy/status')).json() as Promise<ProxyRuntimeStatus>;
    await act(async () => root.render(<ProxyView locale="en" />));await settle();
    expect(calls).toEqual([{ method: 'GET', path: '/api/proxy/status' }, { method: 'GET', path: '/api/proxy/requests?limit=50' }]);
    act(() => {
      const input = container.querySelector<HTMLInputElement>('.capture-port')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(proxyPort));input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Start proxy').click());await settle();
    // Harness-only readiness check; the UI never polls or automatically retries controls.
    await vi.waitFor(async () => expect((await status()).running).toBe(true), { timeout: 5000 });
    await act(async () => button('Refresh monitor status').click());await settle();
    expect(button('Stop proxy').disabled).toBe(false);
    const source = JSON.stringify({ model: 'synthetic-local-only', messages: [{ role: 'user', content: '<script>ISOLATED_REQUEST_ONLY</script>' }] });
    const forwarded = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: proxyPort, method: 'POST', path: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1/chat/completions`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(source) } }, res => {
        const chunks: Buffer[] = [];res.on('data', (chunk: Buffer) => chunks.push(chunk));res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });req.on('error', reject);req.end(source);
    });
    expect(forwarded).toBe(answer);expect(originRequests).toBe(1);
    await vi.waitFor(async () => expect((await status()).requestCount).toBe(1), { timeout: 5000 });
    await act(async () => button('Refresh list').click());await settle();
    expect(container.querySelectorAll('.capture-request-open')).toHaveLength(1);
    expect(calls.some(call => /\/requests\/\d+/.test(call.path))).toBe(false);
    await act(async () => button('Refresh monitor status').click());await settle();
    expect(container.textContent).toContain('1 req');
    const beforeClear = calls.length, requestName = container.querySelector('.capture-request-open')!.getAttribute('aria-label');
    act(() => button('Clear current list').click());
    expect(calls).toHaveLength(beforeClear);expect(container.querySelectorAll('.capture-request-open')).toHaveLength(0);
    expect(container.textContent).toContain('1 req');expect(container.textContent).toContain('Refresh list to restore');
    expect((await status()).running).toBe(true);expect((await status()).requestCount).toBe(1);
    await act(async () => button('Refresh list').click());await settle();
    expect(calls).toHaveLength(beforeClear + 1);expect(calls.at(-1)).toEqual({ method: 'GET', path: '/api/proxy/requests?limit=50' });
    expect(container.querySelectorAll('.capture-request-open')).toHaveLength(1);
    expect(container.querySelector('.capture-request-open')!.getAttribute('aria-label')).toBe(requestName);
    await act(async () => container.querySelector<HTMLButtonElement>('.capture-request-open')!.click());await settle();
    expect(container.textContent).toContain('ISOLATED_REQUEST_ONLY');expect(container.querySelector('script')).toBeNull();
    expect(calls.filter(call => /\/requests\/\d+$/.test(call.path))).toHaveLength(1);
    expect(calls.some(call => call.path.endsWith('/analysis'))).toBe(false);
    const download = container.querySelector<HTMLAnchorElement>('a[href$="/body/request"]')!;expect(download).not.toBeNull();
    expect(Buffer.from(await (await fetch(download.getAttribute('href')!)).arrayBuffer())).toEqual(Buffer.from(source));
    await act(async () => button('Response').click());await settle();expect(container.textContent).toContain('ISOLATED_RESPONSE_ONLY');
    await act(async () => button('Protocol Analysis').click());await settle();
    expect(container.textContent).toContain('openai_chat');expect(container.textContent).toContain('ISOLATED_RESPONSE_ONLY');
    expect(calls.filter(call => call.path.endsWith('/analysis'))).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>('.capture-detail-drawer .ui-drawer-header button')!.click());
    act(() => button('Stop proxy').click());expect(calls.some(call => call.path.endsWith('/stop'))).toBe(false);
    await act(async () => button('Confirm').click());await settle();
    expect((await status()).running).toBe(false);expect(button('Start proxy').disabled).toBe(false);
    expect(calls.filter(call => call.method === 'POST').map(call => call.path)).toEqual(['/api/proxy/start', '/api/proxy/stop']);expect(originRequests).toBe(1);
    expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  } finally {
    act(() => root.unmount());container.remove();vi.unstubAllGlobals();
    await close(server);await close(upstream);db.close();await runtime.close();await rm(directory, { recursive: true, force: true });
  }
});
