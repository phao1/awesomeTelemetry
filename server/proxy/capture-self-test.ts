import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Database } from 'better-sqlite3';
import type { MonitorCaptureSelfTest, MonitorConnectionProfile } from '../../src/core/trace-types.js';
import { eventBus } from '../realtime/event-bus.js';
import { getProxyRequestListItemById } from '../storage/query-engine.js';
import { readAnalysisBody } from './analysis-source.js';
import type { CaptureBodyStore } from './body-store.js';
import { readCaptureBodies } from './capture-storage.js';
import type { ProxyRuntime } from './controller.js';
import { getOriginalDeletionForProxy } from './original-deletions.js';

type Code = 'MONITOR_SELF_TEST_NOT_READY' | 'MONITOR_SELF_TEST_BUSY' | 'MONITOR_SELF_TEST_FAILED' | 'SERVER_SHUTTING_DOWN';
export class CaptureSelfTestError extends Error {
  readonly code: Code;
  constructor(code: Code) { super(code); this.name = 'CaptureSelfTestError'; this.code = code; }
}
const MODEL = 'agent-observe-self-test';

/** Explicit synthetic HTTP only. Never certifies TLS, a target Agent or identity. */
export class CaptureSelfTester {
  private active: Promise<MonitorCaptureSelfTest> | null = null;
  private cancel: (() => void) | null = null;
  private closed = false;
  private readonly db: Database;
  private readonly runtime: ProxyRuntime;
  private readonly store: () => Promise<CaptureBodyStore>;

  constructor(db: Database, runtime: ProxyRuntime, store: () => Promise<CaptureBodyStore>) {
    this.db = db; this.runtime = runtime; this.store = store;
  }

  run(profile: MonitorConnectionProfile, signal?: AbortSignal): Promise<MonitorCaptureSelfTest> {
    if (this.closed) return Promise.reject(new CaptureSelfTestError('SERVER_SHUTTING_DOWN'));
    if (this.active !== null) return Promise.reject(new CaptureSelfTestError('MONITOR_SELF_TEST_BUSY'));
    const status = this.runtime.status(); const runId = status.diagnostics?.runId;
    if (!status.running || status.port !== profile.proxyPort || !runId || status.diagnostics?.cleanupPending) {
      return Promise.reject(new CaptureSelfTestError('MONITOR_SELF_TEST_NOT_READY'));
    }
    const controller = new AbortController(); this.cancel = () => controller.abort();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 10_000); timer.unref();
    const job = this.execute(profile, runId, controller.signal).catch((error: unknown) => {
      throw error instanceof CaptureSelfTestError ? error : new CaptureSelfTestError('MONITOR_SELF_TEST_FAILED');
    }).finally(() => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      this.cancel = null; this.active = null;
    });
    this.active = job; return job;
  }

  async close(): Promise<void> {
    this.closed = true; this.cancel?.(); await this.active?.catch(() => {});
  }

  private async execute(profile: MonitorConnectionProfile, runId: string, signal: AbortSignal): Promise<MonitorCaptureSelfTest> {
    const marker = randomUUID();
    const path = `/v1/chat/completions?agent_observe_self_test=${marker}`;
    const input = JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'user', content: `Synthetic local self-test ${marker}` }] });
    const output = `data: ${JSON.stringify({ id: marker, object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: { content: '本地抓包自检' }, finish_reason: null }] })}\n\n`
      + `data: ${JSON.stringify({ id: marker, object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })}\n\n`
      + 'data: [DONE]\n\n';
    const sockets = new Set<Socket>();
    const origin = createServer((req, res) => {
      void (async () => {
        let body = ''; let bytes = 0;
        for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 4096) throw new Error('Limit'); body += String(chunk); }
        if (req.method !== 'POST' || req.url !== path || body !== input) { res.writeHead(400).end(); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'close' });
        // Two application writes exercise SSE framing, without claiming token timing.
        const split = output.indexOf('\n\n') + 2; res.write(output.slice(0, split)); res.end(output.slice(split));
      })().catch(() => res.destroy());
    });
    origin.maxConnections = 2;
    origin.maxRequestsPerSocket = 1;
    origin.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    const stopOrigin = () => { for (const socket of sockets) socket.destroy(); };
    signal.addEventListener('abort', stopOrigin, { once: true });
    let unsubscribe = () => {};
    let removeWaitAbort = () => {};
    try {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => { origin.once('error', reject); origin.listen(0, '127.0.0.1', resolve); });
      signal.throwIfAborted();
      const originPort = (origin.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${originPort}${path}`;
      const saved = new Promise<number>((resolve, reject) => {
        const aborted = () => reject(new CaptureSelfTestError('MONITOR_SELF_TEST_FAILED'));
        signal.addEventListener('abort', aborted, { once: true }); removeWaitAbort = () => signal.removeEventListener('abort', aborted);
        // The actual proxy engine normalizes absolute-form HTTP URLs to paths.
        unsubscribe = eventBus.on('proxy_request', event => { if (event.item?.url === path && event.item.captureGroupId === runId) resolve(event.id); });
        if (signal.aborted) aborted();
      });
      const forwarded = new Promise<boolean>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: profile.proxyPort, method: 'POST', path: url, signal, agent: false,
          headers: { host: `127.0.0.1:${originPort}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(input), 'x-agent-observe-self-test': marker, connection: 'close' } }, res => {
          const chunks: Buffer[] = []; let size = 0;
          res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 4096) { res.destroy(new Error('Limit')); return; } chunks.push(chunk); });
          res.once('error', reject); res.once('end', () => resolve(res.statusCode === 200 && Buffer.concat(chunks).toString('utf8') === output));
        });
        req.once('error', reject); req.end(input);
      });
      const [proxyId, forwarding] = await Promise.all([saved, forwarded]);
      const row = getProxyRequestListItemById(this.db, proxyId);
      const capture = readCaptureBodies(this.db, proxyId);
      const store = await this.store(); signal.throwIfAborted();
      const reader = { openRead: (id: string) => {
        const stream = store.openRead(id); const abort = () => stream.destroy(new Error('Self-test cancelled'));
        signal.addEventListener('abort', abort, { once: true }); stream.once('close', () => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort(); return stream;
      } };
      const [a, b] = await Promise.all([
        capture.request === null ? null : readAnalysisBody(reader, capture.request, 4096),
        capture.response === null ? null : readAnalysisBody(reader, capture.response, 4096),
      ]);
      signal.throwIfAborted();
      const current = this.runtime.status();
      if (!current.running || current.port !== profile.proxyPort || current.diagnostics?.runId !== runId || current.diagnostics.cleanupPending) throw new CaptureSelfTestError('MONITOR_SELF_TEST_NOT_READY');
      const checks = {
        forwarding,
        persistence: row?.url === path && row.captureGroupId === runId && row.responseStatus === 200 && capture.transport?.state === 'completed'
          && capture.transport.requestEnded && capture.transport.responseEnded,
        originals: a?.ok === true && a.body === input && b?.ok === true && b.body === output && getOriginalDeletionForProxy(this.db, proxyId) === null,
        parsing: capture.processing?.status === 'ok' && row?.requestFormat === 'openai_chat' && row.model === MODEL && row.isStreaming && row.inputTokens === 0 && row.outputTokens === 0,
      };
      return { profileId: profile.id, profileRevision: profile.revision, checkedAt: new Date().toISOString(), runId, proxyId,
        scope: 'local_http_sse', synthetic: true, checks, passed: Object.values(checks).every(Boolean), agentVerified: false, tlsVerified: false };
    } finally {
      unsubscribe(); removeWaitAbort(); signal.removeEventListener('abort', stopOrigin); stopOrigin();
      await new Promise<void>((resolve, reject) => origin.close(error => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
    }
  }
}
