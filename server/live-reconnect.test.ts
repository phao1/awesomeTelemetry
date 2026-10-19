import { createServer, request, type ClientRequest, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../local-sessions/config.js';
import { createAgentObservabilityServer } from './server.js';
import { initSchema } from './storage/schema.js';
import { closeSseBroadcaster } from './realtime/sse.js';

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Live HTTP evidence timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function subscribe(port: number, path = '/api/events', headers: Record<string, string> = {}): { text: () => string; close: () => void } {
  let text = '';
  const req = request({ host: '127.0.0.1', port, path, headers }, res => {
    res.setEncoding('utf8'); res.on('data', chunk => { text += String(chunk); }); res.on('error', () => {});
  });
  req.on('error', () => {}); req.end();
  return { text: () => text, close: () => req.destroy() };
}

async function json(port: number, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: unknown }> {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(encoded === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) }) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += String(chunk); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(text) as unknown }));
    });
    req.on('error', reject); req.end(encoded);
  });
}

it('real proxy → selected HTTP live preview → disconnect → committed metadata replay, no body broadcast', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fusion-live-http-'));
  const db = new Database(':memory:'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG);
  for (const provider of Object.values(config.providers)) provider.enabled = false;
  const app = createAgentObservabilityServer({ db, config, captureDirectory: join(directory, 'originals'), caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'settings.json') });
  let held: ServerResponse | undefined;
  const origin = createServer((req, res) => { req.resume(); req.once('end', () => {
    held = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': first heartbeat\n\n');
  }); });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const port = (app.address() as AddressInfo).port;
  const originPort = (origin.address() as AddressInfo).port;
  const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const proxyPort = (reservation.address() as AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const subscriptions: Array<{ close: () => void }> = [];
  let client: ClientRequest | undefined;
  try {
    const global = subscribe(port); subscriptions.push(global);
    await waitFor(() => global.text().includes('event: connected'));
    expect((await json(port, '/api/proxy/start', 'POST', { port: proxyPort })).status).toBe(200);
    await waitFor(() => global.text().includes('"running":true'));
    let forwarded = '';
    client = request({ host: '127.0.0.1', port: proxyPort, method: 'POST', path: `http://127.0.0.1:${originPort}/v1/chat/completions`, headers: { host: `127.0.0.1:${originPort}`, 'content-type': 'application/json' } }, res => {
      res.setEncoding('utf8'); res.on('data', chunk => { forwarded += String(chunk); }); res.on('error', () => {});
    });
    client.on('error', () => {}); client.end('{"model":"local-fixture","messages":[]}');
    await waitFor(() => global.text().includes('event: proxy_stream_started'));
    const start = /event: proxy_stream_started\ndata: ([^\n]+)/.exec(global.text())!;
    const stream = JSON.parse(start[1]!) as { requestId: string };
    const selected = subscribe(port, `/api/events?requestId=${encodeURIComponent(stream.requestId)}`); subscriptions.push(selected);
    await waitFor(() => selected.text().includes('event: connected'));
    const secret = 'data: {"choices":[{"index":0,"delta":{"content":"private-live-中文"}}]}\n\n';
    held!.write(secret);
    await waitFor(() => selected.text().includes('private-live-中文'));
    expect(held!.writableEnded).toBe(false);
    expect(forwarded).toContain('private-live-中文');
    expect(global.text()).not.toContain('private-live-中文');
    const cursor = [...global.text().matchAll(/id: ([^\n]+)/g)].at(-1)![1]!;
    global.close();
    held!.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}\n\ndata: [DONE]\n\n');
    await waitFor(() => selected.text().includes('event: proxy_stream_ended'));
    await waitFor(() => Number((db.prepare('SELECT COUNT(id) AS count FROM proxy_requests').get() as { count: number }).count) === 1);
    const resumed = subscribe(port, '/api/events', { 'last-event-id': cursor }); subscriptions.push(resumed);
    await waitFor(() => resumed.text().includes('event: proxy_request'));
    expect(resumed.text()).toContain('"resume":"replayed"');
    expect(resumed.text().match(/event: proxy_request/g)).toHaveLength(1);
    expect(resumed.text()).not.toContain('private-live-中文');
    const listing = await json(port, '/api/proxy/requests');
    expect(JSON.stringify(listing.data)).not.toContain('private-live-中文');
    expect((listing.data as { items: unknown[] }).items).toHaveLength(1);
    const invalid = await json(port, '/api/events?requestId=a&requestId=b');
    expect(invalid).toMatchObject({ status: 400, data: { error: { code: 'BAD_REQUEST' } } });
    expect(await json(port, '/api/events', 'GET', undefined, { 'last-event-id': 'a'.repeat(129) })).toMatchObject({ status: 400, data: { error: { code: 'BAD_REQUEST' } } });
    expect(await json(port, '/api/events?requestId=selected', 'GET', undefined, { origin: 'https://untrusted.example' })).toMatchObject({ status: 400, data: { error: { code: 'BAD_REQUEST' } } });
  } finally {
    for (const subscription of subscriptions) subscription.close();
    client?.destroy(); held?.destroy();
    await new Promise<void>(resolve => app.close(() => resolve()));
    origin.closeAllConnections(); await new Promise<void>(resolve => origin.close(() => resolve()));
    closeSseBroadcaster(); db.close(); await rm(directory, { recursive: true, force: true });
  }
});
