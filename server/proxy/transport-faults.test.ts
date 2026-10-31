import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import type { Proxy } from 'http-mitm-proxy';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureResources } from './capture-resources.js';
import { readCaptureBodies } from './capture-storage.js';
import { createMitmProxy } from './mitm-proxy.js';
import { analyzeProtocol } from './protocol-analysis.js';
import type { CaptureNetworkTiming, ProxyCaptureBodies } from '../../src/core/trace-types.js';

const body = '{"model":"synthetic","system":"原文🙂","messages":[]}';
function assertTiming(capture: ProxyCaptureBodies, contentTimingStatus: CaptureNetworkTiming['contentTimingStatus'], headersObserved: boolean, bodyObserved: boolean): void {
  const timing = capture.transport?.timing;
  expect(timing).toBeDefined();
  expect(Object.keys(timing!).sort()).toEqual(['version', 'clock', 'responseHeadersMs', 'firstBodyByteMs', 'firstContentMs', 'firstContentKind', 'firstContentBasis', 'completedMs', 'contentTimingStatus', 'serverTiming', 'serverTimingTruncated'].sort());
  expect(timing).toEqual({ version: 1, clock: 'proxy_monotonic', responseHeadersMs: headersObserved ? timing!.responseHeadersMs : null,
    firstBodyByteMs: bodyObserved ? timing!.firstBodyByteMs : null, firstContentMs: null, firstContentKind: null, firstContentBasis: null,
    completedMs: timing!.completedMs, contentTimingStatus, serverTiming: null, serverTimingTruncated: false });
  for (const key of ['responseHeadersMs', 'firstBodyByteMs', 'completedMs'] as const) {
    const value = timing![key];
    if (key === 'completedMs' || key === 'responseHeadersMs' && headersObserved || key === 'firstBodyByteMs' && bodyObserved) {
      expect(value).not.toBeNull(); expect(Number.isSafeInteger(value)).toBe(true); expect(value!).toBeGreaterThanOrEqual(0);
    }
  }
  if (headersObserved) expect(timing!.responseHeadersMs!).toBeLessThanOrEqual(timing!.completedMs!);
  if (bodyObserved) {
    expect(timing!.firstBodyByteMs!).toBeGreaterThanOrEqual(timing!.responseHeadersMs!);
    expect(timing!.firstBodyByteMs!).toBeLessThanOrEqual(timing!.completedMs!);
  }
}
function outcome(capture: ProxyCaptureBodies) {
  const { timing: _timing, ...network } = capture.transport!;
  return network;
}
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Transport fixture condition timed out'); await yieldImmediate(); }
}
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'capture-transport-'));
  const db = new Database(':memory:'); initSchema(db);
  const store = await CaptureBodyStore.create(join(directory, 'bodies')), resources = new CaptureResources();
  let calls = 0;
  const origin = createServer((req, res) => { calls += 1; handler(req, res); });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const originPort = (origin.address() as AddressInfo).port, ids: number[] = [];
  const proxy = await createMitmProxy({ db, port: 0, bodyStore: store, resources, caDirectory: join(directory, 'ca'), notify: id => ids.push(id) });
  const port = (proxy as unknown as { httpPort: number }).httpPort;
  return {
    db, store, resources, origin, proxy, port, originPort, ids, calls: () => calls,
    async original(direction: 'request' | 'response'): Promise<Buffer> { const ref = readCaptureBodies(db, ids[0]!)[direction]!; return readFile(join(directory, 'bodies', ref.id + '.body')); },
    async one() {
      await waitFor(() => ids.length === 1 && proxy.captureActivity().pendingWrites === 0);
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(ids).toHaveLength(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
      expect(store.status()).toMatchObject({ pendingBytes: 0, activeBodies: 0 });
      expect(resources.snapshot()).toMatchObject({ previewCollectors: 0, previewBytes: 0, queuedJobs: 0, queuedBytes: 0 });
      return readCaptureBodies(db, ids[0]!);
    },
    async dispose() {
      await proxy.shutdown({ graceMs: 0 }); origin.closeAllConnections();
      await new Promise<void>(resolve => origin.close(() => resolve())); db.close();
      await rm(directory, { recursive: true, force: true });
      expect(resources.snapshot()).toMatchObject({ workers: 0, previewCollectors: 0, queuedJobs: 0 });
    },
  };
}
function send(f: Awaited<ReturnType<typeof fixture>>, onData?: () => void) {
  let client!: ReturnType<typeof request>;
  const reply = new Promise<{ status: number | null; bytes: Buffer; aborted: boolean }>((resolve, reject) => {
    let status: number | null = null, settled = false; const chunks: Buffer[] = [];
    const timeout = setTimeout(() => { client.destroy(); reject(new Error('Transport test client watchdog')); }, 3000); timeout.unref();
    const finish = (aborted: boolean): void => { if (settled) return; settled = true; clearTimeout(timeout); resolve({ status, bytes: Buffer.concat(chunks), aborted }); };
    client = request({ host: '127.0.0.1', port: f.port, method: 'POST', path: `http://127.0.0.1:${f.originPort}/v1/messages`, headers: { 'content-type': 'application/json' } }, res => {
      status = res.statusCode ?? null;
      res.on('data', chunk => { chunks.push(Buffer.from(chunk)); onData?.(); });
      res.once('end', () => finish(false)); res.once('aborted', () => finish(true)); res.on('error', () => finish(true));
    });
    client.on('error', () => finish(true)); client.end(body);
  });
  return { client, reply };
}

describe('real transport terminal fidelity and single-record finalization', () => {
  it.each([401, 429, 500, 503])('keeps HTTP%d error bytes/headers complete and distinct from processing success', async status => {
    const errorBody = '{"type":"error","error":{"type":"synthetic_error","message":"literal 原文🙂"}}';
    const f = await fixture((req, res) => { req.resume(); req.once('end', () => { res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': ['one=original', 'two=original'] }); res.end(errorBody); }); });
    try {
      const reply = await send(f).reply; expect(reply).toEqual({ status, bytes: Buffer.from(errorBody), aborted: false });
      const capture = await f.one();
      expect(outcome(capture)).toEqual({ version: 1, state: 'http_error', error: 'HTTP_ERROR', requestEnded: true, responseEnded: true, statusCode: status });
      assertTiming(capture, 'no_content', true, true);
      expect(capture.processing?.status).toBe('ok'); expect(capture.response?.status).toBe('complete');
      expect(capture.responseHeaders['set-cookie']).toEqual(['one=original', 'two=original']);
      expect(await f.original('request')).toEqual(Buffer.from(body)); expect(await f.original('response')).toEqual(Buffer.from(errorBody));
      const analysis = await analyzeProtocol({ format: 'anthropic_messages', requestBody: body, responseBody: errorBody, streaming: false, transport: capture.transport });
      expect(analysis.state).toBe('failed'); expect(analysis.usage.inputTokens).toBeNull(); expect(f.calls()).toBe(1);
    } finally { await f.dispose(); }
  });
  it('records connection refusal without mistaking a locally synthesized error response for upstream status/body', async () => {
    const f = await fixture((_req, res) => res.end('not reached'));
    await new Promise<void>(resolve => f.origin.close(() => resolve()));
    try {
      const reply = await send(f).reply; expect(reply.status).toBe(504);
      const capture = await f.one();
      expect(capture.transport).toMatchObject({ state: 'network_error', error: 'ECONNREFUSED', responseEnded: false, statusCode: null });
      assertTiming(capture, 'not_collected', false, false);
      expect(capture.response).toMatchObject({ bytes: 0, status: 'interrupted', error: 'UPSTREAM_ERROR' });
      expect(await f.original('response')).toEqual(Buffer.alloc(0)); expect(f.calls()).toBe(0);
    } finally { await f.dispose(); }
  });
  it('aborts a broken response after its observed prefix instead of appending an engine error or finalizing twice', async () => {
    const prefix = 'data: {"type":"message_stop"}\n\n'; let upstream: ServerResponse | undefined;
    const f = await fixture((req, res) => { req.resume(); req.once('end', () => { upstream = res; res.writeHead(200, { 'content-type': 'Text/Event-Stream; charset=UTF-8' }); res.write(prefix); }); });
    try {
      const flight = send(f, () => upstream!.destroy()); const reply = await flight.reply;
      expect(reply.bytes).toEqual(Buffer.from(prefix)); expect(reply.aborted).toBe(true);
      const capture = await f.one();
      expect(outcome(capture)).toEqual({ version: 1, state: 'network_error', error: 'UPSTREAM_ABORTED', requestEnded: true, responseEnded: false, statusCode: 200 });
      assertTiming(capture, 'not_collected', true, true);
      expect(capture.response).toMatchObject({ status: 'interrupted', error: 'UPSTREAM_ERROR' });
      expect(await f.original('response')).toEqual(Buffer.from(prefix));
      const analysis = await analyzeProtocol({ format: 'anthropic_messages', requestBody: body, responseBody: prefix, streaming: true, transport: capture.transport });
      expect(analysis.state).toBe('incomplete'); expect(analysis.completeness.reasons).toContain('transport:network_error');
      expect(f.db.prepare('SELECT is_streaming FROM proxy_requests').get()).toEqual({ is_streaming: 1 }); expect(f.calls()).toBe(1);
    } finally { await f.dispose(); }
  });
  it.each([false, true])('classifies a genuinely fired native timeout without a monitor deadline (headers observed=%s)', async afterHeaders => {
    const prefix = 'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n';
    const f = await fixture((req, res) => { req.resume(); req.once('end', () => { if (afterHeaders) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(prefix); } }); });
    // Fault injection uses a real Node ClientRequest socket timer, not a mocked
    // parser/classifier or a production default stream timeout.
    if (afterHeaders) (f.proxy as unknown as Proxy).onResponse((ctx, callback) => {
      ctx.proxyToServerRequest?.setTimeout(30, () => ctx.proxyToServerRequest?.destroy(Object.assign(new Error('synthetic observed timeout'), { code: 'ETIMEDOUT' })));
      callback();
    });
    else (f.proxy as unknown as Proxy).onRequest((ctx, callback) => {
      ctx.clientToProxyRequest.once('end', () => ctx.proxyToServerRequest?.setTimeout(30, () => ctx.proxyToServerRequest?.destroy(Object.assign(new Error('synthetic observed timeout'), { code: 'ETIMEDOUT' }))));
      callback();
    });
    try {
      const reply = await send(f).reply;
      if (afterHeaders) { expect(reply.aborted).toBe(true); expect(reply.bytes).toEqual(Buffer.from(prefix)); }
      else expect(reply.status).toBe(504);
      const capture = await f.one();
      expect(capture.transport).toMatchObject({ state: 'timeout', error: 'ETIMEDOUT', requestEnded: true, responseEnded: false, statusCode: afterHeaders ? 200 : null });
      assertTiming(capture, 'not_collected', afterHeaders, afterHeaders);
      expect(await f.original('response')).toEqual(Buffer.from(afterHeaders ? prefix : '')); expect(f.calls()).toBe(1);
    } finally { await f.dispose(); }
  });
  it('records client cancellation independently from explicit monitor stop and ignores late upstream errors', async () => {
    const prefix = 'data: {"type":"message_start","message":{"id":"synthetic"}}\n\n';
    const f = await fixture((req, res) => { req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(prefix); }); });
    try {
      const flight = send(f, () => flight.client.destroy());
      await flight.reply; const capture = await f.one();
      expect(capture.transport).toMatchObject({ state: 'cancelled', error: 'CLIENT_DISCONNECTED', requestEnded: true, responseEnded: false, statusCode: 200 });
      assertTiming(capture, 'not_collected', true, true);
      expect(capture.response?.status).toBe('interrupted'); expect(await f.original('response')).toEqual(Buffer.from(prefix));
      await f.proxy.shutdown(); expect(readCaptureBodies(f.db, f.ids[0]!).transport).toEqual(capture.transport);
    } finally { await f.dispose(); }
  });
  it('retains an aborted upload prefix with both unfinished directions and exactly one cancellation record', async () => {
    let received = '';
    const f = await fixture((req) => { req.on('data', chunk => { received += String(chunk); }); });
    const client = request({ host: '127.0.0.1', port: f.port, method: 'POST', path: `http://127.0.0.1:${f.originPort}/v1/messages` });
    client.on('error', () => {}); client.write(body.slice(0, 10));
    try {
      await waitFor(() => received.length === 10); client.destroy();
      const capture = await f.one();
      expect(capture.transport).toMatchObject({ state: 'cancelled', error: 'CLIENT_DISCONNECTED', requestEnded: false, responseEnded: false, statusCode: null });
      assertTiming(capture, 'not_collected', false, false);
      expect(capture.request).toMatchObject({ bytes: 10, status: 'interrupted', error: 'CLIENT_DISCONNECTED' });
      expect(await f.original('request')).toEqual(Buffer.from(body.slice(0, 10))); expect(await f.original('response')).toEqual(Buffer.alloc(0));
    } finally { client.destroy(); await f.dispose(); }
  });
  it('distinguishes normally ended SSE without a protocol terminal marker from a successfully completed call', async () => {
    const response = 'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n';
    const f = await fixture((req, res) => { req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(response); }); });
    try {
      expect((await send(f).reply).aborted).toBe(false);
      const capture = await f.one(); expect(capture.transport?.state).toBe('completed'); expect(capture.response?.status).toBe('complete');
      assertTiming(capture, 'no_content', true, true);
      const analysis = await analyzeProtocol({ format: 'anthropic_messages', requestBody: body, responseBody: response, streaming: true, transport: capture.transport });
      expect(analysis.state).toBe('incomplete'); expect(analysis.usage.inputTokens).toBe(3); expect(analysis.usage.outputTokens).toBeNull();
    } finally { await f.dispose(); }
  });
  it('does not finalize early response EOF while a real keep-alive request upload is still arriving', async () => {
    const response = '{"usage":{"input_tokens":3,"output_tokens":2}}';
    const f = await fixture((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(response); });
    (f.proxy as unknown as Proxy).keepAlive = true;
    let client!: ReturnType<typeof request>;
    const responseEnded = new Promise<void>((resolve, reject) => {
      client = request({ host: '127.0.0.1', port: f.port, method: 'POST', path: `http://127.0.0.1:${f.originPort}/v1/messages`, headers: { 'content-type': 'application/json', 'proxy-connection': 'keep-alive' } }, res => { res.resume(); res.once('end', resolve); res.on('error', reject); });
      client.on('error', reject); client.write(body.slice(0, 10));
    });
    try {
      await responseEnded; await yieldImmediate();
      expect(f.ids).toHaveLength(0); expect(f.resources.snapshot().previewCollectors).toBe(1);
      client.end(body.slice(10));
      const capture = await f.one();
      expect(outcome(capture)).toEqual({ version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200 });
      assertTiming(capture, 'no_content', true, true);
      expect(await f.original('request')).toEqual(Buffer.from(body)); expect(await f.original('response')).toEqual(Buffer.from(response));
    } finally { client.destroy(); await f.dispose(); }
  });
});
