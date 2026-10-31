/** Diagnostic-only: real loopback traffic and production capture, never imported by the HTTP entry. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent as HttpsAgent, createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo, Socket } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import forge from 'node-forge';
import { openWritable } from '../storage/db.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { eventBus } from '../realtime/event-bus.js';
import { addSseClient, sseResourceStatus } from '../realtime/sse.js';
import { ProxyRuntime } from './controller.js';
import { createMitmProxy } from './mitm-proxy.js';
import { CaptureBodyStore } from './body-store.js';
import { captureResources } from './capture-resources.js';
import { ensureInterceptCa } from './ca-manager.js';
import { readCaptureBodies } from './capture-storage.js';
import { analyzeProtocol } from './protocol-analysis.js';
import { SseDecoder } from './sse-accumulator.js';
import { decodeBodyBytes } from './body-decoder.js';
import { readAnalysisBody } from './analysis-source.js';
import { readCaptureCapacity } from './capture-capacity.js';

export interface CaptureAbOptions {
  samples?: number;
  concurrency?: number;
  frameBytes?: number;
  frames?: number;
  intervalMs?: number;
  transport?: 'http' | 'https';
  encoding?: 'identity' | 'gzip' | 'br' | 'deflate';
  format?: 'json' | 'sse';
  mode?: 'ok' | 'http_error' | 'reset' | 'cancel';
  keepOnFailure?: boolean;
}
interface Timing { firstBodyByteMs: number; e2eMs: number }
interface Reply extends Timing { status: number; bytes: Buffer; headers: IncomingHttpHeaders; aborted: boolean; early: boolean }
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export function timingDistribution(values: readonly number[]): { p50: number; p95: number; max: number } {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) throw new RangeError('Finite timing samples required');
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * .5) - 1]!, p95: sorted[Math.ceil(sorted.length * .95) - 1]!, max: sorted.at(-1)! };
}
export function captureStorageViolations(databaseBytes: number, walBytes: number): string[] {
  return [databaseBytes + walBytes >= 200_000_000 ? 'db_size' : null, walBytes >= 20_000_000 ? 'wal_size' : null].filter((value): value is string => value !== null);
}
function applicationHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const hop = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'date']);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !hop.has(key)));
}
async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('A/B ownership condition timed out'); await delay(2); }
}
function originCertificate(): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 86400000);
  const subject = [{ name: 'commonName', value: '127.0.0.1' }]; cert.setSubject(subject); cert.setIssuer(subject);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
}

export async function runCaptureAb(options: CaptureAbOptions = {}) {
  const config = { samples: 100, concurrency: 4, frameBytes: 1024, frames: 8, intervalMs: 5,
    transport: 'http' as const, encoding: 'identity' as const, format: 'sse' as const, mode: 'ok' as const, keepOnFailure: false, ...options };
  for (const value of [config.samples, config.concurrency, config.frameBytes, config.frames, config.intervalMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Positive bounded A/B dimensions required');
  }
  if (config.samples > 1000 || config.concurrency > 8 || config.frameBytes * config.frames > 1_900_000 || config.frames > 100 || config.intervalMs > 100) throw new RangeError('A/B workload exceeds diagnostic bound');
  if ((config.mode === 'cancel' || config.mode === 'reset') && config.format !== 'sse') throw new RangeError('Prefix fault profiles require streaming');
  const initializationStarted = performance.now();
  const directory = await mkdtemp(join(tmpdir(), 'capture-ab-'));
  const cleanups: Array<() => void | Promise<void>> = [];
  let success = false, proxyReleased = true;
  let recordCleanup: ((temporarySyntheticDataRemoved: boolean, verified: boolean) => void) | undefined;
  const execute = async () => {
  const dbPath = join(directory, 'capture.sqlite'), db = openWritable(dbPath);
  cleanups.push(() => { if (!proxyReleased) throw new Error('A/B proxy still owns SQLite; refusing early close'); db.close(); });
  const store = await CaptureBodyStore.create(join(directory, 'bodies'));
  cleanups.push(() => {
    const resources = captureResources.snapshot();
    assert.equal(resources.queuedJobs, 0); assert.equal(resources.queuedBytes, 0); assert.equal(resources.previewBytes, 0); assert.equal(resources.previewCollectors, 0); assert.equal(resources.workers, 0);
    assert.equal(sseResourceStatus().sseClients, 0);
    assert.equal(store.status().pendingBytes, 0); assert.equal(store.status().activeBodies, 0);
  });
  const compress = (text: string): Buffer => config.encoding === 'identity' ? Buffer.from(text) : config.encoding === 'gzip' ? gzipSync(Buffer.from(text)) : config.encoding === 'br' ? brotliCompressSync(Buffer.from(text)) : deflateSync(Buffer.from(text));
  const requestText = JSON.stringify({ model: 'synthetic-ab', system: '原文🙂 synthetic-secret', messages: [{ role: 'user', content: '中文🙂' }], thinking: { type: 'enabled', budget_tokens: 1024 }, tools: [{ name: 'lookup', input_schema: { type: 'object', properties: { name: { type: 'string' } } } }] });
  const requestBytes = compress(requestText);
  const data = (value: unknown): string => 'data: ' + JSON.stringify(value) + '\n\n';
  const streamPieces = [': synthetic heartbeat\n\n', data({ type: 'message_start', message: { id: 'synthetic-response', model: 'synthetic-ab', usage: { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    data({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-ab', name: 'lookup', input: {} } }),
    data({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"name":"中文🙂"}' } }), data({ type: 'content_block_stop', index: 0 }),
    ...Array.from({ length: config.frames }, () => data({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '中文🙂' + 'x'.repeat(config.frameBytes) } })),
    data({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } }), data({ type: 'message_stop' })];
  const streaming = config.format === 'sse' && config.mode !== 'http_error';
  const responseText = config.mode === 'http_error' ? '{"type":"error","error":{"type":"synthetic_error","message":"observed failure"}}' : streaming ? streamPieces.join('') : JSON.stringify({ type: 'message', id: 'synthetic-response', stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'call-ab', name: 'lookup', input: { name: '中文🙂' } }] });
  const responseBytes = compress(responseText);
  const pieces = !streaming ? [responseBytes] : config.encoding === 'identity' ? streamPieces.map(text => Buffer.from(text)) : Array.from({ length: streamPieces.length }, (_, index) => responseBytes.subarray(Math.floor(index * responseBytes.length / streamPieces.length), Math.floor((index + 1) * responseBytes.length / streamPieces.length))).filter(piece => piece.length > 0);
  interface Gate { release: () => void; ready: Promise<void>; response: ServerResponse; ended: boolean }
  const gates = new Map<string, Gate>(); const originFailures: unknown[] = []; let originCalls = 0;
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    originCalls += 1; const hash = createHash('sha256');
    req.on('error', () => {}); req.on('data', (chunk: Buffer) => hash.update(chunk));
    req.once('end', () => { void (async () => {
      assert.equal(hash.digest('hex'), digest(requestBytes));
      const id = String(req.headers['x-ab-pair']);
      assert.deepEqual(applicationHeaders(req.headers), { host: `127.0.0.1:${originPort}`, 'content-type': 'application/json', authorization: 'Bearer synthetic-ab-unredacted', 'content-length': String(requestBytes.length), 'x-ab-pair': id, ...(config.encoding === 'identity' ? {} : { 'content-encoding': config.encoding }) });
      let release!: () => void;
      const ready = new Promise<void>(resolve => { release = resolve; }); const gate: Gate = { ready, release, response: res, ended: false }; gates.set(id, gate);
      const abort = new AbortController();
      res.once('close', () => { abort.abort(); release(); if (gates.get(id) === gate) gates.delete(id); });
      res.writeHead(config.mode === 'http_error' ? 503 : 200, { 'content-type': streaming ? 'text/event-stream; charset=utf-8' : 'application/json', 'set-cookie': ['one=original', 'two=original'], ...(config.encoding === 'identity' ? {} : { 'content-encoding': config.encoding }) });
      for (let index = 0; index < pieces.length; index += 1) {
        if (res.destroyed) return;
        if (!res.write(pieces[index]!)) await once(res, 'drain', { signal: abort.signal });
        if (index === 0 && streaming) {
          await ready;
          if (config.mode === 'cancel' || config.mode === 'reset') return;
        }
        if (streaming && index + 1 < pieces.length) await delay(config.intervalMs, undefined, { signal: abort.signal });
      }
      gate.ended = true; res.end();
    })().catch(error => { if (!res.destroyed) { originFailures.push(error); res.destroy(); } }); });
  };
  const credentials = config.transport === 'https' ? originCertificate() : null;
  const origin = credentials === null ? createServer(handler) : createHttpsServer(credentials, handler);
  cleanups.push(async () => { origin.closeAllConnections(); if (origin.listening) await new Promise<void>(resolve => origin.close(() => resolve())); });
  const originReady = once(origin, 'listening'); origin.listen(0, '127.0.0.1'); await originReady;
  const originPort = (origin.address() as AddressInfo).port;
  const upstreamAgent = credentials === null ? undefined : new HttpsAgent({ ca: credentials.cert, rejectUnauthorized: true });
  cleanups.push(() => upstreamAgent?.destroy());
  const caDirectory = join(directory, 'ca'), ca = await ensureInterceptCa(caDirectory);
  const runtime = new ProxyRuntime(db, payload => eventBus.emit('proxy_status', payload), { bodyStore: async () => store, caDirectory,
    createProxy: opts => createMitmProxy({ ...opts, httpsAgent: upstreamAgent }) });
  cleanups.push(async () => {
    const status = runtime.status();
    if (status.running || status.starting || status.diagnostics?.cleanupPending) await runtime.stop();
    proxyReleased = true;
  });
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve)); const proxyPort = (probe.address() as AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  proxyReleased = false; runtime.start({ port: proxyPort }); await runtime.waitUntilReady();
  let receivedSse = 0;
  const ownedSubscribers = new Set<() => void>();
  const subscriberServer = createServer((req, res) => {
    const release = addSseClient(res), cleanup = (): void => { ownedSubscribers.delete(cleanup); release(); };
    ownedSubscribers.add(cleanup); req.once('close', cleanup); res.once('close', cleanup);
  });
  cleanups.push(async () => {
    for (const cleanup of ownedSubscribers) cleanup();
    subscriberServer.closeAllConnections(); if (subscriberServer.listening) await new Promise<void>(resolve => subscriberServer.close(() => resolve()));
  });
  await new Promise<void>(resolve => subscriberServer.listen(0, '127.0.0.1', resolve));
  const subscriber = request({ host: '127.0.0.1', port: (subscriberServer.address() as AddressInfo).port }, res => {
    const decoder = new SseDecoder(); res.on('error', () => {});
    res.on('data', (chunk: Buffer) => { for (const event of decoder.push(chunk)) if (event.event === 'proxy_request') receivedSse += 1; });
  }); subscriber.on('error', () => {}); subscriber.end();
  cleanups.push(() => { subscriber.destroy(); });
  const initializationMs = performance.now() - initializationStarted;
  const measured: Array<{ direct: Timing; proxy: Timing }> = [];
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  cleanups.push(() => { histogram.disable(); });
  let earlyDirect = 0, earlyProxy = 0;
  const invoke = async (viaProxy: boolean, id: string): Promise<Reply> => {
    const started = performance.now();
    let secure: ReturnType<typeof tlsConnect> | undefined;
    if (viaProxy && credentials !== null) {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const tunnel = request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `127.0.0.1:${originPort}` });
        tunnel.setTimeout(10_000, () => tunnel.destroy(new Error('A/B CONNECT watchdog')));
        tunnel.on('error', reject); tunnel.on('connect', (response, channel, head) => { if (response.statusCode !== 200) { channel.destroy(); reject(new Error('A/B CONNECT failed')); return; } if (head.length > 0) channel.unshift(head); resolve(channel); }); tunnel.end();
      });
      secure = tlsConnect({ socket, host: '127.0.0.1', ca, rejectUnauthorized: true });
      secure.setTimeout(10_000, () => secure?.destroy(new Error('A/B TLS watchdog')));
      await once(secure, 'secureConnect'); assert.equal(secure.authorized, true); secure.setTimeout(0);
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []; let first: number | null = null, settled = false, early = false;
      const watchdog = setTimeout(() => { outgoing.destroy(); secure?.destroy(); reject(new Error('A/B request watchdog; streaming may be buffered')); }, 10_000); watchdog.unref();
      let status = 0, headers: IncomingHttpHeaders = {};
      const finish = (aborted: boolean): void => {
        if (settled) return; settled = true; clearTimeout(watchdog); secure?.destroy();
        if (first === null) { reject(new Error('A/B received no body bytes')); return; }
        resolve({ status, headers, bytes: Buffer.concat(chunks), aborted, early, firstBodyByteMs: first - started, e2eMs: performance.now() - started });
      };
      const receiver = (res: IncomingMessage): void => {
        status = res.statusCode ?? 0; headers = res.headers;
        if (!viaProxy && credentials !== null) assert.equal((res.socket as ReturnType<typeof tlsConnect>).authorized, true);
        res.on('data', (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
          if (first !== null) return;
          first = performance.now();
          if (streaming) {
            const gate = gates.get(id); assert(gate !== undefined);
            early = !gate.ended; assert(early, 'SSE data was buffered to EOF');
            if (viaProxy) earlyProxy += 1; else earlyDirect += 1;
            gate.release();
            if (config.mode === 'cancel') outgoing.destroy();
            if (config.mode === 'reset') gate.response.destroy();
          }
        });
        res.once('end', () => finish(false)); res.once('aborted', () => finish(true)); res.on('error', () => finish(true));
      };
      const headersIn = { host: `127.0.0.1:${originPort}`, 'content-type': 'application/json', authorization: 'Bearer synthetic-ab-unredacted', 'content-length': String(requestBytes.length), 'x-ab-pair': id, ...(config.encoding === 'identity' ? {} : { 'content-encoding': config.encoding }) };
      const outgoing = !viaProxy && credentials !== null ? httpsRequest({ host: '127.0.0.1', port: originPort, path: '/v1/messages', method: 'POST', headers: headersIn, ca: credentials.cert, rejectUnauthorized: true, agent: false }, receiver)
        : request({ host: '127.0.0.1', port: viaProxy && credentials === null ? proxyPort : originPort, path: viaProxy && credentials === null ? `http://127.0.0.1:${originPort}/v1/messages` : '/v1/messages', method: 'POST', headers: headersIn,
          ...(secure === undefined ? { agent: false as const } : { createConnection: () => secure! }) }, receiver);
      outgoing.on('error', error => { if (config.mode === 'cancel' && first !== null) finish(true); else if (!settled) { settled = true; clearTimeout(watchdog); secure?.destroy(); reject(error); } }); outgoing.end(requestBytes);
    });
  };
  const pair = async (index: number, prefix: string): Promise<{ direct: Reply; proxy: Reply }> => {
    const id = prefix + index;
    const first = await invoke(index % 2 !== 0, id), second = await invoke(index % 2 === 0, id);
    const direct = index % 2 === 0 ? first : second, proxy = index % 2 === 0 ? second : first;
    assert.equal(proxy.status, direct.status); assert.deepEqual(applicationHeaders(proxy.headers), applicationHeaders(direct.headers));
    assert.deepEqual(proxy.bytes, direct.bytes); assert.equal(proxy.aborted, direct.aborted);
    assert.deepEqual(proxy.bytes, config.mode === 'cancel' || config.mode === 'reset' ? pieces[0] : responseBytes);
    return { direct, proxy };
  };
    const cold = await pair(0, 'cold-');
    for (let index = 0; index < 3; index += 1) await pair(index, 'warmup-');
    await waitFor(() => runtime.status().requestCount === 4 && runtime.status().diagnostics?.pendingWrites === 0);
    histogram.enable(); let next = 0;
    await Promise.all(Array.from({ length: config.concurrency }, async () => {
      while (next < config.samples) { const index = next++; const result = await pair(index, 'sample-'); measured[index] = { direct: { firstBodyByteMs: result.direct.firstBodyByteMs, e2eMs: result.direct.e2eMs }, proxy: { firstBodyByteMs: result.proxy.firstBodyByteMs, e2eMs: result.proxy.e2eMs } }; }
    }));
    const expected = config.samples + 4;
    await waitFor(() => runtime.status().requestCount === expected && runtime.status().diagnostics?.pendingWrites === 0 && receivedSse === expected);
    await delay(2); histogram.disable();
    assert.equal(originCalls, expected * 2); assert.deepEqual(originFailures, []);
    const ids = db.prepare('SELECT id FROM proxy_requests ORDER BY id').all() as Array<{ id: number }>;
    assert.equal(ids.length, expected);
    let originals = 0;
    for (const { id } of ids) {
      const capture = readCaptureBodies(db, id);
      assert.equal(capture.transport?.state, config.mode === 'ok' ? 'completed' : config.mode === 'http_error' ? 'http_error' : config.mode === 'cancel' ? 'cancelled' : 'network_error');
      if (config.mode === 'ok' || config.mode === 'http_error') assert.equal(capture.processing?.status, 'ok');
      for (const direction of ['request', 'response'] as const) {
        const ref = capture[direction]!; assert(ref !== null);
        const expectedBytes = direction === 'request' ? requestBytes : config.mode === 'reset' || config.mode === 'cancel' ? pieces[0]! : responseBytes;
        assert.equal(ref.bytes, expectedBytes.length); assert.equal(ref.status, direction === 'response' && (config.mode === 'reset' || config.mode === 'cancel') ? 'interrupted' : 'complete');
        const hash = createHash('sha256'); for await (const chunk of store.openRead(ref.id)) hash.update(chunk as Buffer);
        assert.equal(ref.sha256, digest(expectedBytes)); assert.equal(hash.digest('hex'), ref.sha256); originals += 1;
      }
    }
    const original = readCaptureBodies(db, ids[0]!.id);
    const originalRequest = await readAnalysisBody(store, original.request!, 2 * 1024 * 1024, { contentEncoding: config.encoding }); assert(originalRequest.ok);
    const originalResponse = await readAnalysisBody(store, original.response!, 2 * 1024 * 1024, { contentEncoding: config.encoding, allowIncomplete: true });
    const directResponse = await decodeBodyBytes(cold.direct.bytes, { contentEncoding: config.encoding });
    const projection = await analyzeProtocol({ format: 'anthropic_messages', requestBody: originalRequest.body, responseBody: originalResponse.ok ? originalResponse.body : null, streaming });
    assert.deepEqual(await analyzeProtocol({ format: 'anthropic_messages', requestBody: requestText, responseBody: directResponse.ok ? directResponse.body : null, streaming }), projection);
    if (config.mode === 'ok') {
      assert.equal(projection.state, 'completed'); assert.equal(projection.usage.inputTokens, 3); assert.equal(projection.usage.outputTokens, 2);
    }
    const timing = (side: 'direct' | 'proxy', key: keyof Timing) => timingDistribution(measured.map(value => value[side][key]));
    const overhead = (key: keyof Timing) => timingDistribution(measured.map(value => value.proxy[key] - value.direct[key]));
    const p99Ms = histogram.percentile(99) / 1e6, eventLoopSamples = histogram.count;
    const capacity = await readCaptureCapacity(db);
    assert(capacity.databaseBytes !== null && capacity.walBytes !== null, 'Cannot certify unreadable database/WAL sizes');
    const { databaseBytes: dbBytes, walBytes } = capacity;
    const firstOverhead = overhead('firstBodyByteMs'), endOverhead = overhead('e2eMs');
    const qualified = config.samples >= 100 && config.concurrency === 4 && config.frames === 8 && config.intervalMs === 5 && config.encoding === 'identity' && streaming && config.mode === 'ok' && eventLoopSamples >= 100;
    const violations = [...[firstOverhead.p95 > 20 ? 'first_body_byte_overhead_p95' : null, endOverhead.p95 > 20 ? 'e2e_overhead_p95' : null, p99Ms >= 50 ? 'event_loop_p99' : null].filter((value): value is string => value !== null), ...captureStorageViolations(dbBytes, walBytes)];
    const report = { version: 1, observedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch, schemaVersion: SCHEMA_VERSION }, scope: 'One-process synthetic origin/client + actual ProxyRuntime/MITM/original/worker/metadata/SSE; not model TTFT or a soak test', config,
      integrity: { originCalls, captures: ids.length, originalsVerified: originals, metadataSseEvents: receivedSse, earlyDirect, earlyProxy, requestBytes: requestBytes.length, responseBytes: responseBytes.length, applicationHeadersEqual: true, bodyBytesEqual: true, protocolProjectionEqual: true, projectedState: projection.state, nativeInput: projection.usage.inputTokens, nativeOutput: projection.usage.outputTokens },
      initializationMs, cold: { direct: { firstBodyByteMs: cold.direct.firstBodyByteMs, e2eMs: cold.direct.e2eMs }, proxy: { firstBodyByteMs: cold.proxy.firstBodyByteMs, e2eMs: cold.proxy.e2eMs } },
      warm: { direct: { firstBodyByte: timing('direct', 'firstBodyByteMs'), e2e: timing('direct', 'e2eMs') }, proxy: { firstBodyByte: timing('proxy', 'firstBodyByteMs'), e2e: timing('proxy', 'e2eMs') }, pairedAdditional: { firstBodyByte: firstOverhead, e2e: endOverhead } },
      eventLoop: { samples: eventLoopSamples, p99Ms, maxMs: histogram.max / 1e6 }, storage: { dbBytes, walBytes }, budget: { qualified, violations, passed: qualified && violations.length === 0 }, samples: measured,
      cleanup: { verified: false, temporarySyntheticDataRemoved: false, resources: null as ReturnType<typeof captureResources.snapshot> | null, sse: null as ReturnType<typeof sseResourceStatus> | null, store: null as ReturnType<typeof store.status> | null } };
    recordCleanup = (removed, verified) => { report.cleanup.verified = verified; report.cleanup.temporarySyntheticDataRemoved = removed; report.cleanup.resources = captureResources.snapshot(); report.cleanup.sse = sseResourceStatus(); report.cleanup.store = store.status(); };
    success = violations.length === 0; return report;
  };
  let result: Awaited<ReturnType<typeof execute>> | undefined;
  const errors: unknown[] = [];
  try { result = await execute(); } catch (error) { errors.push(error); }
  for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch (error) { errors.push(error); } }
  if (errors.length > 0) success = false;
  const removeSyntheticData = success || !config.keepOnFailure;
  let removed = false;
  if (removeSyntheticData) { try { await rm(directory, { recursive: true, force: true }); removed = true; } catch (error) { errors.push(error); } }
  else console.error('A/B failed; isolated synthetic evidence retained at', directory);
  recordCleanup?.(removed, errors.length === 0);
  if (errors.length > 0) throw new AggregateError(errors, 'A/B execution or ownership cleanup failed', { cause: { report: result ?? null, evidenceDirectory: removed ? null : directory } });
  assert(result !== undefined); return result;
}
