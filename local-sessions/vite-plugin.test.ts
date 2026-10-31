import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCdpDevController, localSessionsPlugin } from './vite-plugin.js';
import type { CdpWebSocket } from '../server/proxy/cdp-capture.js';

// Substitute only the remote CDP wire. HTTP routing, discovery ownership,
// correlation, body acquisition and retention all execute the actual source.
class Socket implements CdpWebSocket {
  onopen: CdpWebSocket['onopen'] = null;
  onmessage: CdpWebSocket['onmessage'] = null;
  onerror: CdpWebSocket['onerror'] = null;
  onclose: CdpWebSocket['onclose'] = null;
  closed = false;
  body = 'SYNTHETIC 中文 <script>inert</script>';
  send(data: string) {
    const message = JSON.parse(data) as { id: number; method: string }, body = this.body;
    queueMicrotask(() => this.message({ id: message.id, result: message.method === 'Network.getResponseBody' ? { body, base64Encoded: false } : {} }));
  }
  close() { this.closed = true; }
  message(value: unknown) { this.onmessage?.call(this as unknown as WebSocket, { data: JSON.stringify(value) } as MessageEvent); }
  open() { this.onopen?.call(this as unknown as WebSocket, {} as Event); }
  capture(id: string, body = this.body) {
    this.body = body;
    const url = 'https://synthetic.invalid/' + id;
    this.message({ method: 'Network.requestWillBeSent', params: { requestId: id, request: { url } } });
    this.message({ method: 'Network.responseReceived', params: { requestId: id, response: { url, status: 200 } } });
    this.message({ method: 'Network.loadingFinished', params: { requestId: id } });
  }
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return (server.address() as AddressInfo).port;
}
async function fixture(discovery?: (port?: number, options?: { signal?: AbortSignal }) => Promise<never[]>) {
  const sockets: Socket[] = [];
  const discover = vi.fn(discovery ?? (async (port = 9222) => [{ id: 'synthetic-target', title: 'Synthetic Electron', url: 'https://synthetic.invalid/', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/target` }]));
  const controller = createCdpDevController({ discover, webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); queueMicrotask(() => socket.open()); return socket; } });
  const server = createServer((req, res) => { void controller.handle(req, res, () => { res.writeHead(418); res.end('downstream'); }); });
  cleanup.push(async () => { await controller.close(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return { port: await listen(server), controller, sockets, discover };
}
async function call(port: number, path: string, method = 'GET', body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; cache: string | undefined }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body), 'content-type': 'application/json' }), ...headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString('utf8'), cache: res.headers['cache-control'] }));
    }); req.once('error', reject); req.end(body);
  });
}
describe('development CDP product integration', () => {
  it('is inert on construction/status/targets/list and forwards non-CDP traffic', async () => {
    const f = await fixture();
    expect((await call(f.port, '/api/cdp/status')).body).toBe(JSON.stringify({ state: 'idle', discovering: false, targetCount: 0, connectedTargetCount: 0 }));
    expect((await call(f.port, '/api/cdp/targets')).body).toBe('{"items":[]}');
    expect(JSON.parse((await call(f.port, '/api/cdp/captures')).body)).toEqual({ items: [], totalBytes: 0, rejectedCount: 0, lastIssue: null });
    expect(f.discover).not.toHaveBeenCalled(); expect(f.sockets).toHaveLength(0);
    expect((await call(f.port, '/api/health')).status).toBe(418);
    expect(JSON.parse((await call(f.port, '/api/cdp/invalid')).body).error.code).toBe('ROUTE_NOT_FOUND');
  });
  it('acquires an exact selected decoded response, keeps metadata body-free and retains it after stop', async () => {
    const f = await fixture(); const started = await call(f.port, '/api/cdp/start', 'POST', '{"port":9233}');
    expect(started.status).toBe(200); expect(f.discover.mock.calls[0]?.[0]).toBe(9233);
    expect(JSON.parse((await call(f.port, '/api/cdp/targets')).body).items[0].id).toBe('synthetic-target');
    f.sockets[0]!.capture('a'); await new Promise(resolve => setImmediate(resolve));
    const listing = await call(f.port, '/api/cdp/captures'), page = JSON.parse(listing.body);
    expect(listing.cache).toBe('no-store'); expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty('body'); expect(listing.body).not.toContain('SYNTHETIC 中文');
    expect(page.items[0].capturedAt).toMatch(/Z$/); expect(page.items[0].bodyBytes).toBe(Buffer.byteLength(f.sockets[0]!.body));
    const detail = await call(f.port, '/api/cdp/captures/1'); expect(JSON.parse(detail.body).body).toBe(f.sockets[0]!.body);
    expect(JSON.parse((await call(f.port, '/api/cdp/stop', 'POST')).body).state).toBe('idle'); expect(f.sockets[0]!.closed).toBe(true);
    expect((await call(f.port, '/api/cdp/captures/1')).body).toBe(detail.body);
    expect(JSON.parse((await call(f.port, '/api/cdp/captures/2')).body).error.code).toBe('CDP_CAPTURE_NOT_FOUND');
  });
  it('rejects nonlocal Host, cross-origin requests and invalid controls before discovery', async () => {
    const f = await fixture();
    const rejectedHeaders: Record<string, string>[] = [{ host: 'evil.invalid' }, { origin: 'https://evil.invalid' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of rejectedHeaders) {
      const response = await call(f.port, '/api/cdp/start', 'POST', '{}', headers);
      expect(response.status).toBe(403); expect(JSON.parse(response.body).error.code).toBe('BAD_REQUEST');
    }
    for (const body of ['[]', '{', 'null', '{"port":null}', '{"port":"9222"}', '{"port":0}', '{"port":65536}', '{"port":1.5}', '{"extra":true}', '{"x":"' + 'a'.repeat(1024) + '"}']) {
      expect((await call(f.port, '/api/cdp/start', 'POST', body)).status, body.slice(0, 40)).toBe(400);
    }
    expect((await call(f.port, '/api/cdp/stop', 'POST', '{"port":9222}')).status).toBe(400);
    expect((await call(f.port, '/api/cdp/captures/1e2')).status).toBe(400);
    expect(f.discover).not.toHaveBeenCalled();
  });
  it('joins a same-port start, rejects port changes and stops pending discovery', async () => {
    let invoked: () => void = () => undefined;
    const began = new Promise<void>(resolve => { invoked = resolve; });
    const f = await fixture(async (_port, options) => new Promise<never[]>((_resolve, reject) => {
      invoked(); options?.signal?.addEventListener('abort', () => reject(Error('synthetic abort')), { once: true });
    }));
    const first = call(f.port, '/api/cdp/start', 'POST', '{}'); await began;
    const second = call(f.port, '/api/cdp/start', 'POST', '{}');
    expect((await call(f.port, '/api/cdp/start', 'POST', '{"port":9223}')).status).toBe(409);
    expect((await call(f.port, '/api/cdp/stop', 'POST', '{}')).status).toBe(200);
    expect((await first).status).toBe(200); expect((await second).status).toBe(200); expect(f.discover).toHaveBeenCalledOnce();
    expect(JSON.parse((await call(f.port, '/api/cdp/status')).body).state).toBe('idle');
  });
  it('rejects excess diagnostics without evicting accepted responses and exposes acquisition issues', async () => {
    const f = await fixture(); await call(f.port, '/api/cdp/start', 'POST', '{}');
    for (let id = 0; id < 66; id++) f.sockets[0]!.capture('response-' + id);
    await new Promise(resolve => setImmediate(resolve));
    const page = JSON.parse((await call(f.port, '/api/cdp/captures')).body);
    expect(page.items).toHaveLength(64); expect(page.rejectedCount).toBe(2); expect(page.lastIssue).toBe('capture_limit');
    expect(JSON.parse((await call(f.port, '/api/cdp/captures/1')).body).url).toBe('https://synthetic.invalid/response-0');
    await f.controller.close(); expect((await call(f.port, '/api/cdp/start', 'POST', '{}')).status).toBe(503);
  });
  it('installs in a real Vite server before the backend API proxy without discovery', async () => {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ configFile: false, plugins: [localSessionsPlugin()], server: { host: '127.0.0.1', port: 0, proxy: { '/api': 'http://127.0.0.1:1' } } });
    cleanup.push(() => vite.close()); await vite.listen(); const port = (vite.httpServer!.address() as AddressInfo).port;
    expect(JSON.parse((await call(port, '/api/cdp/status')).body).state).toBe('idle');
    expect((await call(port, '/api/cdp/captures')).status).toBe(200);
  });
});
