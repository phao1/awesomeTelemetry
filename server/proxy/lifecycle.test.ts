import { createServer, request, type ServerResponse } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as connectTls } from 'node:tls';
import type { Proxy } from 'http-mitm-proxy';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { CaptureBodyStore } from './body-store.js';
import { readCaptureBodies } from './capture-storage.js';
import { createMitmProxy } from './mitm-proxy.js';
import type { CaptureNetworkTiming } from '../../src/core/trace-types.js';

/** These fixtures forward non-JSON SSE data; byte timing is observed, content timing is not. */
function assertMalformedStreamTiming(timing: CaptureNetworkTiming | undefined): void {
  expect(timing).toBeDefined();
  expect(Object.keys(timing!).sort()).toEqual([
    'version', 'clock', 'responseHeadersMs', 'firstBodyByteMs', 'firstContentMs', 'firstContentKind',
    'firstContentBasis', 'completedMs', 'contentTimingStatus', 'serverTiming', 'serverTimingTruncated',
  ].sort());
  expect(timing).toEqual({
    version: 1, clock: 'proxy_monotonic', responseHeadersMs: timing!.responseHeadersMs,
    firstBodyByteMs: timing!.firstBodyByteMs, firstContentMs: null, firstContentKind: null, firstContentBasis: null,
    completedMs: timing!.completedMs, contentTimingStatus: 'decode_error', serverTiming: null, serverTimingTruncated: false,
  });
  for (const key of ['responseHeadersMs', 'firstBodyByteMs', 'completedMs'] as const) {
    expect(timing![key]).not.toBeNull();
    expect(Number.isSafeInteger(timing![key])).toBe(true);
    expect(timing![key]!).toBeGreaterThanOrEqual(0);
  }
  expect(timing!.firstBodyByteMs!).toBeGreaterThanOrEqual(timing!.responseHeadersMs!);
  expect(timing!.completedMs!).toBeGreaterThanOrEqual(timing!.firstBodyByteMs!);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('lifecycle condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-lifecycle-'));
  const db = new Database(':memory:');
  initSchema(db);
  const store = await CaptureBodyStore.create(join(directory, 'bodies'));
  let upstream: ServerResponse | undefined;
  const origin = createServer((req, res) => {
    req.resume();
    req.once('end', () => {
      upstream = res;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
    });
  });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const originPort = (origin.address() as AddressInfo).port;
  const proxy = await createMitmProxy({ db, port: 0, caDirectory: join(directory, 'ca'), bodyStore: store });
  const port = (proxy as unknown as { httpPort: number }).httpPort;
  let firstByte!: () => void;
  const first = new Promise<void>(resolve => { firstByte = resolve; });
  let responseBody = '';
  const client = request({ hostname: '127.0.0.1', port, method: 'POST', path: `http://127.0.0.1:${originPort}/v1/chat/completions` }, res => {
    res.on('data', chunk => { responseBody += String(chunk); firstByte(); });
    res.on('error', () => { /* forced shutdown is an expected client error */ });
  });
  client.on('error', () => { /* forced shutdown may reset the request */ });
  client.end('{"model":"synthetic","messages":[]}');
  await first;
  return {
    db, store, proxy, port, client, directory,
    response: () => upstream!, body: () => responseBody,
    async cleanup() {
      client.destroy();
      await proxy.shutdown({ graceMs: 0 });
      origin.closeAllConnections();
      await new Promise<void>(resolve => origin.close(() => resolve()));
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('real proxy shutdown and original persistence', () => {
  it('prevents a late CONNECT certificate callback from binding a new TLS listener after stop', async () => {
    const f = await fixture();
    const engine = f.proxy as unknown as Proxy;
    const requireCertificate = engine.onCertificateRequired.bind(engine);
    let release: (() => void) | undefined;
    engine.onCertificateRequired = (hostname, callback) => {
      release = () => requireCertificate(hostname, callback);
    };
    let lateTlsAttempts = 0;
    const createTls = engine._createHttpsServer.bind(engine);
    engine._createHttpsServer = (options, callback) => { lateTlsAttempts += 1; createTls(options, callback); };
    const tunnel = request({ host: '127.0.0.1', port: f.port, method: 'CONNECT', path: '127.0.0.1:1' });
    tunnel.on('error', () => {});
    tunnel.on('connect', (_response, socket) => {
      const tls = connectTls({ socket, ca: [] });
      tls.on('error', () => { /* handshake intentionally interrupted, no TLS bypass */ });
    });
    tunnel.end();
    try {
      await waitFor(() => release !== undefined);
      await f.proxy.shutdown({ graceMs: 0 });
      release!();
      await waitFor(() => lateTlsAttempts === 1);
      expect(Object.values(engine.sslServers).filter(server => server.server?.listening)).toHaveLength(0);
      expect(engine.httpServer?.listening).toBe(false);
      expect(f.store.status()).toMatchObject({ activeBodies: 0, pendingBytes: 0 });
    } finally { tunnel.destroy(); await f.cleanup(); }
  });
  it('rejects an occupied listen port without an uncaught server error', async () => {
    const f = await fixture();
    try {
      await expect(createMitmProxy({ db: f.db, port: f.port, caDirectory: join(f.directory, 'ca') })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(f.proxy.captureActivity().listening).toBe(true);
    } finally { await f.cleanup(); }
  });
  it('drains a finishing stream, waits for originals/index, closes the port and permits restart', async () => {
    const f = await fixture();
    try {
      expect(f.proxy.captureActivity()).toMatchObject({ listening: true, observedRequests: 1, activeRequests: 1 });
      const stopping = f.proxy.shutdown({ graceMs: 1000 });
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(f.store.status().activeBodies).toBe(2);
      f.response().end('data: done\n\n');
      await stopping;
      const row = f.db.prepare('SELECT id FROM proxy_requests').get() as { id: number };
      const bodies = readCaptureBodies(f.db, row.id);
      expect(bodies.request?.status).toBe('complete');
      expect(bodies.response?.status).toBe('complete');
      const { timing, ...outcome } = bodies.transport!;
      expect(outcome).toEqual({ version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200 });
      assertMalformedStreamTiming(timing);
      expect(await readFile(join(f.directory, 'bodies', `${bodies.response!.id}.body`), 'utf8')).toBe('data: first\n\ndata: done\n\n');
      expect(f.body()).toBe('data: first\n\ndata: done\n\n');
      expect(f.store.status()).toMatchObject({ activeBodies: 0, pendingBytes: 0 });
      expect(f.proxy.captureActivity()).toMatchObject({ listening: false, activeRequests: 0, pendingWrites: 0, persistedRequests: 1, interruptedRequests: 0 });
      await new Promise<void>(resolve => {
        const socket = createConnection({ host: '127.0.0.1', port: f.port });
        socket.on('error', err => { expect((err as NodeJS.ErrnoException).code).toBe('ECONNREFUSED'); resolve(); });
        socket.on('connect', () => { socket.destroy(); throw new Error('proxy listener survived stop'); });
      });
      const restarted = await createMitmProxy({ db: f.db, port: f.port, caDirectory: join(f.directory, 'ca'), bodyStore: f.store });
      await restarted.shutdown();
    } finally { await f.cleanup(); }
  });

  it('force-stops only the unfinished response and durably retains its accepted prefix exactly once', async () => {
    const f = await fixture();
    try {
      await f.proxy.shutdown({ graceMs: 15 });
      const rows = f.db.prepare('SELECT id FROM proxy_requests').all() as Array<{ id: number }>;
      expect(rows).toHaveLength(1);
      const bodies = readCaptureBodies(f.db, rows[0]!.id);
      expect(bodies.request).toMatchObject({ status: 'complete', error: null });
      expect(bodies.response).toMatchObject({ status: 'interrupted', error: 'PROXY_STOPPED' });
      const { timing, ...outcome } = bodies.transport!;
      expect(outcome).toEqual({ version: 1, state: 'interrupted', error: 'PROXY_STOPPED', requestEnded: true, responseEnded: false, statusCode: 200 });
      assertMalformedStreamTiming(timing);
      expect(await readFile(join(f.directory, 'bodies', `${bodies.response!.id}.body`), 'utf8')).toBe('data: first\n\n');
      expect(f.proxy.captureActivity()).toMatchObject({ activeRequests: 0, pendingWrites: 0, persistedRequests: 1, interruptedRequests: 1 });
      await f.proxy.shutdown({ graceMs: 0 });
      expect(f.db.prepare('SELECT COUNT(*) AS count FROM proxy_requests').get()).toEqual({ count: 1 });
      expect(f.store.status()).toMatchObject({ activeBodies: 0, pendingBytes: 0 });
    } finally { await f.cleanup(); }
  });

  it('persists a client-disconnected stream before the monitor itself is stopped', async () => {
    const f = await fixture();
    try {
      f.client.destroy();
      await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const row = f.db.prepare('SELECT id FROM proxy_requests').get() as { id: number };
      expect(readCaptureBodies(f.db, row.id).response).toMatchObject({ status: 'interrupted', error: 'CLIENT_DISCONNECTED' });
      expect(readCaptureBodies(f.db, row.id).transport?.state).toBe('cancelled');
      expect(f.proxy.captureActivity()).toMatchObject({ listening: true, activeRequests: 0, pendingWrites: 0 });
    } finally { await f.cleanup(); }
  });
});
