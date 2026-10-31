import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { Agent, createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:tls';
import { type EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { CaptureBodyStore } from './body-store.js';
import { createMitmProxy } from './mitm-proxy.js';
import { readCaptureBodies } from './capture-storage.js';
import { readWsArchive } from './websocket-archive.js';
import { CaptureResources } from './capture-resources.js';
import { ensureInterceptCa } from './ca-manager.js';
import { createAgentObservabilityServer } from '../server.js';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import { CodexInspector } from '../codex/service.js';
import { eventBus } from '../realtime/event-bus.js';
import type { CodexCallDetail, CodexCallPage } from '../../src/core/trace-types.js';
import { normalizeCodexSample } from '../../src/adapters/codex.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { listSessionCaptureLinks, decideTraceAssociation } from '../storage/trace-links.js';

// Fixture-only use of the already installed engine's own WS implementation.
const require = createRequire(import.meta.url);
interface FixtureSocket extends EventEmitter {
  send(data: string | Buffer, options?: { binary: boolean }): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(data: string): void;
}
interface FixtureWsServer extends EventEmitter { clients: Set<FixtureSocket>; close(callback: () => void): void }
const { WebSocket, WebSocketServer } = createRequire(require.resolve('http-mitm-proxy'))('ws') as {
  WebSocket: new (url: string, options?: Record<string, unknown>) => FixtureSocket;
  WebSocketServer: new (options: { server: ReturnType<typeof createServer> }) => FixtureWsServer;
};
async function waitFor(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error('WS capture wait timed out'); await new Promise(r => setTimeout(r, 10)); }
}
async function fixture(secure = false, semantic = false) {
  const directory = await mkdtemp(join(tmpdir(), 'telemetry-ws-'));
  const db = new Database(join(directory, 'index.sqlite')); initSchema(db);
  const store = await CaptureBodyStore.create(join(directory, 'bodies'));
  const resources = new CaptureResources();
  let upstreamAgent: Agent | undefined;
  const tls = (() => {
    if (!secure) return undefined;
    const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60_000); cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: 'commonName', value: '127.0.0.1' }]); cert.setIssuer(cert.subject.attributes);
    cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const pem = forge.pki.certificateToPem(cert); upstreamAgent = new Agent({ ca: pem });
    return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: pem };
  })();
  const origin = tls === undefined ? createServer() : createHttpsServer(tls), wss = new WebSocketServer({ server: origin });
  wss.on('connection', (socket: FixtureSocket) => {
    let call = 0;
    socket.on('message', (data: Buffer, binary: boolean) => {
      if (!semantic) { socket.send(data, { binary }); return; }
      const request = JSON.parse(data.toString()) as { type: string; generate?: boolean };
      if (request.type !== 'response.create') return;
      call += 1; const id = 'synthetic-response-' + call;
      const send = (value: unknown): void => socket.send(JSON.stringify(value));
      send({ type: 'response.created', response: { id, status: 'in_progress' } });
      const item = request.generate === false ? null : call === 2
        ? { type: 'function_call', id: 'synthetic-item', name: 'Read', call_id: 'synthetic-tool', arguments: '{"path":"synthetic-only"}' }
        : { type: 'message', id: 'synthetic-message', content: [{ type: 'output_text', text: 'SYNTHETIC_OK' }] };
      if (item !== null) send({ type: 'response.output_item.done', response_id: id, output_index: 0, item });
      if (call === 3) send({ type: 'response.output_text.delta', response_id: id, output_index: 0, delta: 'SYNTHETIC_OK' });
      send({ type: 'response.completed', response: { id, status: 'completed', output: item === null ? [] : [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } });
    });
  });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const originPort = (origin.address() as AddressInfo).port;
  const proxy = await createMitmProxy({ db, port: 0, bodyStore: store, caDirectory: join(directory, 'ca'), resources, httpsAgent: upstreamAgent });
  const proxyPort = ((proxy as unknown as { httpServer: ReturnType<typeof createServer> }).httpServer.address() as AddressInfo).port;
  return { db, store, resources, proxy, wss, originPort, proxyPort, directory, caDirectory: join(directory, 'ca'), async close() {
    await proxy.shutdown({ graceMs: 0 });
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => origin.close(() => resolve()));
    upstreamAgent?.destroy(); db.close(); await rm(directory, { recursive: true, force: true });
  } };
}
async function original(store: CaptureBodyStore, id: string) {
  const chunks: Buffer[] = []; for await (const chunk of store.openRead(id)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('native real-engine WS capture', () => {
  it('keeps opaque source notifications working after the64KiB live preview is exhausted', async () => {
    const f = await fixture();
    const hints: string[][] = [], unsubscribe = eventBus.on('proxy_sources_changed', value => hints.push(value.requestIds));
    const client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } });
    try {
      await once(client, 'open');
      const large = 'SYNTHETIC_PREVIEW_EXHAUSTION_' + 'x'.repeat(100000);
      let received = once(client, 'message'); client.send(large); expect(String((await received)[0])).toBe(large);
      await waitFor(() => hints.length >= 1);
      const count = hints.length, requestId = hints.at(-1)![0]!;
      received = once(client, 'message'); client.send('SYNTHETIC_AFTER_PREVIEW'); expect(String((await received)[0])).toBe('SYNTHETIC_AFTER_PREVIEW');
      await waitFor(() => hints.length > count);
      expect(hints.at(-1)).toContain(requestId);
      expect(JSON.stringify(hints)).not.toContain('SYNTHETIC_');
      const closed = once(client, 'close'); client.close(1000); await closed;
      await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const capture = readCaptureBodies(f.db, 1);
      expect(readWsArchive(await original(f.store, capture.response!.id)).records.filter(row => row.kind === 'message').map(row => row.payload.toString())).toEqual([large, 'SYNTHETIC_AFTER_PREVIEW']);
    } finally { unsubscribe(); client.terminate(); await f.close(); }
  });
  it.each([false, true])('joins warmup → model/tool → result → model to exact native evidence before and after closing (TLS=%s)', async secure => {
    const f = await fixture(secure, true), inspector = new CodexInspector(f.db, async () => f.store);
    let liveId = '', client: FixtureSocket | undefined;
    const unsubscribe = eventBus.on('proxy_stream_started', value => { liveId = value.requestId; });
    try {
      const stamp = '2026-10-16T00:00:00.000Z';
      const record = normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: [
        { type: 'session_meta', timestamp: stamp, payload: { id: 'synthetic-native-session' } },
        { type: 'response_item', timestamp: stamp, payload: { type: 'function_call', name: 'Read', call_id: 'synthetic-tool', arguments: '{"path":"synthetic-only"}' } },
        { type: 'response_item', timestamp: stamp, payload: { type: 'function_call_output', call_id: 'synthetic-tool', output: 'SYNTHETIC_TOOL_RESULT' } },
      ] }, '/synthetic/codex-chain.jsonl');
      storeTraceRecord(f.db, record, '/synthetic/codex-chain.jsonl', 'synthetic-scan');
      if (secure) {
        const ca = await ensureInterceptCa(f.caDirectory);
        const tunnel = request({ host: '127.0.0.1', port: f.proxyPort, method: 'CONNECT', path: `127.0.0.1:${f.originPort}` });
        const connected = once(tunnel, 'connect'); tunnel.end(); const [response, socket, head] = await connected;
        expect(response.statusCode).toBe(200); if (head.length) socket.unshift(head);
        const tls = connect({ socket, host: '127.0.0.1', ca, rejectUnauthorized: true }); await once(tls, 'secureConnect'); expect(tls.authorized).toBe(true);
        client = new WebSocket(`wss://127.0.0.1:${f.originPort}/v1/responses`, { createConnection: () => tls });
      } else client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } });
      await once(client, 'open');
      const received: Array<{ type: string; response?: { id: string } }> = [];
      client.on('message', (bytes: Buffer) => received.push(JSON.parse(bytes.toString())));
      const metadata = { session_id: 'synthetic-native-session', thread_id: 'synthetic-native-session', turn_id: 'synthetic-turn',
        'x-codex-turn-metadata': JSON.stringify({ session_id: 'synthetic-native-session', thread_id: 'synthetic-native-session' }) };
      const inputs = [{ generate: false, input: [] }, { previous_response_id: 'synthetic-response-1', input: [{ role: 'user', content: 'Read synthetic fixture' }] },
        { previous_response_id: 'synthetic-response-2', input: [{ type: 'function_call_output', call_id: 'synthetic-tool', output: 'SYNTHETIC_TOOL_RESULT' }] }];
      for (const [index, input] of inputs.entries()) {
        client.send(JSON.stringify({ type: 'response.create', model: 'synthetic', client_metadata: metadata, ...input }));
        await waitFor(() => received.some(value => value.type === 'response.completed' && value.response?.id === 'synthetic-response-' + (index + 1)));
      }
      await waitFor(() => f.store.status().pendingBytes === 0);
      const page = await inspector.read({ requestId: liveId }, {}) as CodexCallPage;
      expect(page).toMatchObject({ active: true, total: 3, complete: false });
      expect(page.items.map(call => [call.warmup, call.state, call.predecessorSequence])).toEqual([[true, 'completed', null], [false, 'completed', 0], [false, 'completed', 1]]);
      const liveDetail = await inspector.read({ requestId: liveId }, { selected: 2 }) as CodexCallDetail;
      expect(liveDetail.native).toMatchObject({ state: 'linked', sessionKey: 'synthetic-scan' });
      expect(liveDetail.native.matches.some(value => value.kind === 'tool_call' && value.value === 'synthetic-tool')).toBe(true);
      expect(liveDetail.toolReferences).toEqual([{ callId: 'synthetic-tool', proposalSequence: 1 }]);
      expect(f.db.prepare('SELECT COUNT(id) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      const closed = once(client, 'close'); client.close(1000); await closed; await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const final = await inspector.read({ requestId: liveId }, { selected: 2 }) as CodexCallDetail;
      expect(final).toMatchObject({ active: false, call: { state: 'completed' }, analysis: { state: 'completed' }, native: { state: 'linked' } });
      expect(final.analysis.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool_result', content: 'SYNTHETIC_TOOL_RESULT' })]));
      expect(listSessionCaptureLinks(f.db, 'synthetic-scan').items).toEqual(expect.arrayContaining([expect.objectContaining({ association: expect.objectContaining({ state: 'direct' }) })]));
      decideTraceAssociation(f.db, 1, 'synthetic-scan', 'rejected', 'Synthetic decision test');
      expect((await inspector.read({ id: 1 }, { selected: 2 }) as CodexCallDetail).native).toEqual({ state: 'blocked', sessionKey: null, matches: [] });
      expect(f.resources.snapshot()).toMatchObject({ queuedJobs: 0 });
    } finally { unsubscribe(); client?.terminate(); await inspector.close(); await f.close(); }
  });
  it('forwards two Responses turns and binary messages unchanged, then persists one connection archive', async () => {
    const f = await fixture();
    const client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}`, 'x-ws-evidence': 'unredacted' } });
    try {
      await once(client, 'open');
      const messages = [Buffer.from('{"type":"response.create","input":"中文","model":"synthetic"}'), Buffer.from('{"type":"response.completed","response":{"id":"r1","usage":{"input_tokens":10}}}'), Buffer.from([0, 255, 128]), Buffer.from('{"type":"response.create","previous_response_id":"r1"}')];
      for (const [i, data] of messages.entries()) {
        const received = once(client, 'message'); client.send(data, { binary: i === 2 });
        const [echo, binary] = await received; expect(Buffer.from(echo as Buffer)).toEqual(data); expect(binary).toBe(i === 2);
      }
      const pong = once(client, 'pong'); client.ping('control'); await pong;
      const closed = once(client, 'close'); client.close(1000, 'done'); await closed;
      await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const row = f.db.prepare('SELECT id,method,request_body,response_body,input_tokens,output_tokens,request_format,response_status,request_headers FROM proxy_requests').get() as Record<string, unknown>;
      expect(row).toMatchObject({ method: 'WS', input_tokens: null, output_tokens: null, request_format: 'unknown', response_status: 101 });
      expect(row.request_body).toContain('中文'); expect(row.response_body).toContain('response.completed');
      expect(row.request_headers).toContain('sec-websocket-key');
      const capture = readCaptureBodies(f.db, Number(row.id));
      expect(capture.transport).toMatchObject({ state: 'completed', websocket: { scope: 'connection', requestMessages: 4, responseMessages: 4, clientCloseCode: 1000, upstreamCloseCode: 1000 } });
      expect(capture.transport?.timing).toBeUndefined();
      expect(capture.processing?.status).toBe('ok');
      const request = readWsArchive(await original(f.store, capture.request!.id)).records.filter(r => r.kind === 'message');
      const response = readWsArchive(await original(f.store, capture.response!.id)).records.filter(r => r.kind === 'message');
      expect(request.map(r => r.payload)).toEqual(messages); expect(response.map(r => r.payload)).toEqual(messages);
      expect(request.map(r => r.sequence)).toEqual([1, 3, 5, 7]); expect(response.map(r => r.sequence)).toEqual([2, 4, 6, 8]);
      const controls = readWsArchive(await original(f.store, capture.request!.id)).records.filter(r => r.kind === 'ping');
      expect(controls[0]?.payload.toString()).toBe('control');
      expect(f.proxy.captureActivity()).toMatchObject({ activeRequests: 0, pendingWrites: 0, captureErrors: 0 });
    } finally { client.terminate(); await f.close(); }
  });
  it('captures WSS through a real trusted CONNECT without disabling either TLS verification', async () => {
    const f = await fixture(true);
    let client: FixtureSocket | undefined;
    try {
      const ca = await ensureInterceptCa(f.caDirectory);
      const tunnel = request({ host: '127.0.0.1', port: f.proxyPort, method: 'CONNECT', path: `127.0.0.1:${f.originPort}` });
      const connected = once(tunnel, 'connect'); tunnel.end();
      const [response, socket, head] = await connected;
      expect(response.statusCode).toBe(200); if (head.length) socket.unshift(head);
      const tls = connect({ socket, host: '127.0.0.1', ca, rejectUnauthorized: true });
      await once(tls, 'secureConnect'); expect(tls.authorized).toBe(true);
      client = new WebSocket(`wss://127.0.0.1:${f.originPort}/v1/responses`, { createConnection: () => tls });
      await once(client, 'open');
      const received = once(client, 'message'); client.send('{"type":"response.output_text.delta","delta":"OK 中文"}');
      expect(String((await received)[0])).toContain('OK 中文');
      const closed = once(client, 'close'); client.close(1000); await closed;
      await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const row = f.db.prepare('SELECT url,response_body FROM proxy_requests').get() as { url: string; response_body: string };
      expect(row.url).toMatch(/^wss:\/\//); expect(row.response_body).toContain('OK 中文');
      expect(readCaptureBodies(f.db, 1).transport).toMatchObject({ state: 'completed', statusCode: 101, websocket: { requestMessages: 1, responseMessages: 1 } });
    } finally { client?.terminate(); await f.close(); }
  });
  it('Stop interrupts a still-open connection, saves its prefix exactly once and releases both legs', async () => {
    const f = await fixture();
    const client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } });
    try {
      await once(client, 'open'); const received = once(client, 'message'); client.send('retained prefix'); await received;
      await f.proxy.shutdown({ graceMs: 0 });
      expect(f.proxy.captureActivity()).toMatchObject({ observedRequests: 1, persistedRequests: 1, interruptedRequests: 1, activeRequests: 0, pendingWrites: 0 });
      const capture = readCaptureBodies(f.db, 1);
      expect(capture.transport).toMatchObject({ state: 'interrupted', error: 'PROXY_STOPPED', requestEnded: false, responseEnded: false });
      expect(capture.request?.status).toBe('interrupted'); expect(capture.response?.status).toBe('interrupted');
      expect(readWsArchive(await original(f.store, capture.response!.id), true).records[0]!.payload.toString()).toBe('retained prefix');
      await waitFor(() => f.wss.clients.size === 0);
      expect(f.resources.snapshot()).toMatchObject({ previewCollectors: 0, queuedJobs: 0, workers: 0, previewBytes: 0 });
    } finally { client.terminate(); await f.close(); }
  });
  it('keeps two interleaved same-endpoint connections and their message order separate', async () => {
    const f = await fixture();
    const clients = [1, 2].map(() => new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } }));
    try {
      await Promise.all(clients.map(client => once(client, 'open')));
      for (let turn = 0; turn < 2; turn += 1) await Promise.all(clients.map(async (client, index) => {
        const received = once(client, 'message'); client.send(`connection-${index}:turn-${turn}`); expect(String((await received)[0])).toBe(`connection-${index}:turn-${turn}`);
      }));
      const closed = clients.map(client => once(client, 'close')); clients.forEach(client => client.close(1000)); await Promise.all(closed);
      await waitFor(() => f.proxy.captureActivity().persistedRequests === 2);
      const rows = f.db.prepare('SELECT id,request_id,request_body FROM proxy_requests ORDER BY id').all() as { id: number; request_id: string; request_body: string }[];
      expect(new Set(rows.map(row => row.request_id)).size).toBe(2);
      for (const row of rows) {
        const capture = readCaptureBodies(f.db, row.id);
        const records = readWsArchive(await original(f.store, capture.request!.id)).records.filter(r => r.kind === 'message');
        const values = records.map(r => r.payload.toString());
        const owner = values[0]!.includes('connection-0:') ? 0 : 1;
        expect(values).toEqual([`connection-${owner}:turn-0`, `connection-${owner}:turn-1`]);
        expect(row.request_body).not.toContain(`connection-${1 - owner}:`);
        expect(capture.transport?.websocket?.requestMessages).toBe(2);
      }
    } finally { clients.forEach(client => client.terminate()); await f.close(); }
  });
  it('preserves an abnormal upstream-close prefix as incomplete, without rewriting it to success', async () => {
    const f = await fixture();
    const client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } });
    try {
      await once(client, 'open'); const received = once(client, 'message'); client.send('partial evidence'); await received;
      const closed = once(client, 'close'); for (const upstream of f.wss.clients) upstream.terminate(); await closed;
      await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const capture = readCaptureBodies(f.db, 1);
      expect(capture.transport).toMatchObject({ state: 'network_error', statusCode: 101, responseEnded: false, websocket: { upstreamCloseCode: 1006 } });
      expect(capture.response?.status).toBe('interrupted');
      expect(readWsArchive(await original(f.store, capture.response!.id), true).records[0]!.payload.toString()).toBe('partial evidence');
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
    } finally { client.terminate(); await f.close(); }
  });
  it('classifies an abrupt native client exit as cancelled rather than an upstream model failure', async () => {
    const f = await fixture();
    const client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } });
    try {
      await once(client, 'open'); const received = once(client, 'message'); client.send('native exit'); await received;
      client.terminate(); await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      expect(readCaptureBodies(f.db, 1).transport).toMatchObject({ state: 'cancelled', error: 'CLIENT_DISCONNECTED', websocket: { clientCloseCode: 1006 } });
    } finally { client.terminate(); await f.close(); }
  });
  it('serves metadata-only lists, exact archive download and explicit HTTP-analysis/reparse limitations through production APIs', async () => {
    const f = await fixture();
    const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(f.directory, 'absent'); });
    const server = createAgentObservabilityServer({ db: f.db, config, captureDirectory: f.store.directory, caDirectory: f.caDirectory, userConfigPath: join(f.directory, 'config.json') });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const call = (path: string, method = 'GET', body?: unknown): Promise<{ status: number; bytes: Buffer }> => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json' } }, res => {
        const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.once('error', reject); res.once('end', () => resolve({ status: res.statusCode!, bytes: Buffer.concat(chunks) }));
      }); req.once('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    // This fixture owns an already-running external proxy. Await the Web
    // server's real journal recovery before allowing that proxy to write;
    // normal production proxy/start already performs this readiness step.
    const initial = await call('/api/proxy/requests?limit=50');
    expect(initial.status).toBe(200);
    expect(JSON.parse(initial.bytes.toString()).items).toEqual([]);
    const client = new WebSocket(`ws://127.0.0.1:${f.proxyPort}/v1/responses`, { headers: { host: `127.0.0.1:${f.originPort}` } });
    try {
      await once(client, 'open'); const received = once(client, 'message'); client.send('synthetic API evidence'); await received;
      const closed = once(client, 'close'); client.close(1000); await closed; await waitFor(() => f.proxy.captureActivity().persistedRequests === 1);
      const list = JSON.parse((await call('/api/proxy/requests?limit=50')).bytes.toString());
      expect(list.items).toHaveLength(1); expect(list.items[0].method).toBe('WS'); expect(list.items[0]).not.toHaveProperty('requestBody'); expect(list.items[0]).not.toHaveProperty('responseBody');
      const capture = readCaptureBodies(f.db, 1);
      const download = await call('/api/proxy/requests/1/body/response'); expect(download.status).toBe(200); expect(download.bytes).toEqual(await original(f.store, capture.response!.id));
      const analysis = JSON.parse((await call('/api/proxy/requests/1/analysis')).bytes.toString());
      expect(analysis.state).toBe('unknown'); expect(analysis.completeness.reasons).toEqual(['websocket_connection_not_model_call']); expect(analysis.usage.totalTokens).toBeNull();
      const status = JSON.parse((await call('/api/proxy/requests/1/reparse')).bytes.toString()); expect(status).toMatchObject({ state: 'unavailable', unavailableReason: 'originals_invalid' });
      const identity = f.db.prepare('SELECT request_id FROM proxy_requests WHERE id=1').get() as { request_id: string };
      const action = await call('/api/proxy/requests/1/reparse', 'POST', { expectedRequestId: identity.request_id });
      expect(action.status).toBe(422); expect(JSON.parse(action.bytes.toString()).error).toMatchObject({ code: 'CAPTURE_REPARSE_UNSUPPORTED' });
    } finally { client.terminate(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await f.close(); }
  });
});
