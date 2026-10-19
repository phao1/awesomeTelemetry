// D-002（已裁决 ①）：http-mitm-proxy v1.1.0 实际生命周期接线。
// 旧实现使用不存在的 ctx.onData/onEnd，真实转发返回 200 但 proxy_requests 写 0 行。
// v1.1.0 真实事件序列（lib/proxy.ts + ProxyFinal{Request,Response}Filter）：
//   onRequest -> (onRequestData x N) -> onRequestEnd -> onResponse ->
//   (onResponseData x N) -> onResponseEnd
// 数据回调必须回调 (null, chunk) 透传，否则请求/响应流会被吞掉。
import type { Database } from 'better-sqlite3';
import { Proxy } from 'http-mitm-proxy';
import type { IncomingMessage, IncomingHttpHeaders, ServerResponse, ClientRequest } from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import type { Agent as HttpsAgent } from 'node:https';

import type { CaptureMethod, CaptureProcessingResult, CaptureTransportResult, ProxyCaptureActivity } from '../../src/core/trace-types.js';
import type { DesensitizeOptions } from '../desensitization/engine.js';
import { writeProxyRequest } from './proxy-writer.js';
import { CaptureCapacityError } from './capture-capacity.js';
import { RequestContext } from './request-context.js';
import type { CaptureBodyStore, CaptureBodyWriter } from './body-store.js';
import { writeCaptureBodies, writeCaptureProcessing, writeCaptureTransport } from './capture-storage.js';
import { createIdentityCollector } from '../../src/adapters/native-identities.js';
import { CaptureProcessor, CaptureProcessingError } from './capture-processor.js';
import { writeNativeIdentities } from '../storage/trace-links.js';
import { TransportLifecycle } from './transport-lifecycle.js';
import { captureResources, type CaptureResources } from './capture-resources.js';
import { contentEncoding } from './body-decoder.js';
import { observedNetworkCode, transportResult } from './transport-result.js';
import { CaptureJournal, committedCaptureId, retryCaptureCommit, type CaptureJournalTicket } from './capture-journal.js';
import { eventBus } from '../realtime/event-bus.js';
import { flushProxyStreamChunk, queueProxyStreamChunk, queueProxySourceChange } from '../realtime/coalescer.js';
import { WS_ARCHIVE_MAGIC, wsPayloadParts, wsRecordHeader, wsRecordText, type WsKind } from './websocket-archive.js';
import { registerCodexSource } from '../codex/source.js';

export interface MitmProxyOptions {
  db: Database;
  port?: number;
  keepRawBodies?: boolean;
  desensitizeOptions?: DesensitizeOptions;
  notify?: (id: number) => void;
  notifySession?: (key: string, proxyId: number) => void;
  /** design D2：本次成功 proxy run 的不透明 UUID，写入该 run 捕获的每一行。 */
  captureGroupId?: string;
  bodyStore?: CaptureBodyStore;
  caDirectory?: string;
  httpsAgent?: HttpsAgent;
  onActivity?: (activity: ProxyCaptureActivity) => void;
  /** Caller-owned processor for explicit bounds/fault testing; never a mock parser. */
  processor?: CaptureProcessor;
  resources?: CaptureResources;
}

/**
 * http-mitm-proxy v1.1.0 IContext 的最小本地视图（lib/types.ts）。
 * ctx.tags 是该库文档化的用户状态槽（IBaseContext.tags），onRequest 阶段写入，
 * 后续 onRequestData / onResponse 系列 / onError 回调复用同一个 ctx。
 */
interface MitmHandlerContext {
  uuid: string;
  isSSL: boolean;
  clientToProxyRequest: IncomingMessage;
  proxyToClientResponse: ServerResponse;
  serverToProxyResponse?: IncomingMessage;
  proxyToServerRequest?: ClientRequest;
  tags?: Record<string, unknown>;
}

/** v1.1.0 OnRequestDataCallback：(err, chunk) 必须透传 chunk。 */
type MitmDataCallback = (err?: Error | null, chunk?: Buffer) => void;
type MitmRequestCallback = (err?: Error | null) => void;

export interface ProxyServerLike {
  onRequest(cb: (ctx: MitmHandlerContext, callback: MitmRequestCallback) => void): void;
  onRequestData(cb: (ctx: MitmHandlerContext, chunk: Buffer, callback: MitmDataCallback) => void): void;
  onRequestEnd(cb: (ctx: MitmHandlerContext, callback: MitmRequestCallback) => void): void;
  onResponse(cb: (ctx: MitmHandlerContext, callback: MitmRequestCallback) => void): void;
  onResponseData(cb: (ctx: MitmHandlerContext, chunk: Buffer, callback: MitmDataCallback) => void): void;
  onResponseEnd(cb: (ctx: MitmHandlerContext, callback: MitmRequestCallback) => void): void;
  onError(cb: (ctx: MitmHandlerContext | null, err?: Error | null, errorKind?: string) => void): void;
  listen(opts: { port: number; host?: string; sslCaDir?: string; httpsAgent?: HttpsAgent }, cb: (error?: Error | null) => void): void;
  close(): void;
  shutdown?(options?: { graceMs?: number }): Promise<void>;
  captureActivity?(): ProxyCaptureActivity;
}

export interface ManagedProxyServer extends ProxyServerLike {
  shutdown(options?: { graceMs?: number }): Promise<void>;
  captureActivity(): ProxyCaptureActivity;
}

/** 每个 ctx 的捕获状态，存于 ctx.tags[TAG]。 */
interface CaptureState {
  requestCtx: RequestContext;
  finalized: boolean;
  requestEnded: boolean;
  responseEnded: boolean;
  finalization: Promise<void> | null;
  requestWriter: CaptureBodyWriter | null;
  responseWriter: CaptureBodyWriter | null;
  journal: CaptureJournalTicket | null;
  liveStarted: boolean;
  liveStreaming: boolean;
  releaseCodexSource?: () => void;
}

type WebSocketContext = Parameters<Parameters<Proxy['onWebSocketConnection']>[0]>[0];
interface WsCapture {
  capture: CaptureState;
  ctx: WebSocketContext;
  started: number;
  sequence: number;
  liveBytes: number;
  headers: IncomingHttpHeaders;
  outcome: NonNullable<CaptureTransportResult['websocket']>;
  reason?: string;
  code?: string | null;
  status?: number;
  clientClosed: boolean;
  upstreamClosed: boolean;
}

const CAPTURE_TAG = 'awesomeTelemetryCapture';

let counter = 0;

function readCaptureState(ctx: MitmHandlerContext): CaptureState | null {
  const value = ctx.tags?.[CAPTURE_TAG];
  return value !== null && typeof value === 'object' ? (value as CaptureState) : null;
}

function responseContentType(headers: IncomingHttpHeaders | undefined): string | null {
  const value = headers?.['content-type'];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
}

/** REQ-001：MITM 捕获接线（D-002 修复：真实 v1.1.0 生命周期回调）。 */
export async function createMitmProxy(opts: MitmProxyOptions): Promise<ManagedProxyServer> {
  const journal = opts.bodyStore === undefined ? null : await CaptureJournal.open(opts.db, opts.bodyStore);
  const engine = new Proxy();
  const resources = opts.resources ?? captureResources;
  const processor = opts.processor ?? new CaptureProcessor({ resources });
  const proxy = engine as unknown as ManagedProxyServer;
  let rejectStartup: ((error: Error) => void) | null = null;
  const transport = new TransportLifecycle(engine, opts.httpsAgent === undefined, error => {
    if (rejectStartup !== null) { rejectStartup(error); rejectStartup = null; }
    else captureError('PROXY_LISTENER_ERROR');
  });
  const active = new Set<MitmHandlerContext>();
  const wsActive = new Set<WsCapture>();
  const wsStates = new WeakMap<WebSocketContext, WsCapture>();
  const wsSockets = new Set<NonNullable<WebSocketContext['clientToProxyWebSocket']>>();
  const ownWs = (socket: WebSocketContext['clientToProxyWebSocket']): void => {
    if (socket === undefined || wsSockets.has(socket)) return;
    wsSockets.add(socket); socket.once('close', () => wsSockets.delete(socket));
    if (transport.stopping) socket.terminate();
  };
  const writes = new Set<Promise<void>>();
  const activity: ProxyCaptureActivity = {
    listening: false, observedRequests: 0, activeRequests: 0, pendingWrites: 0,
    persistedRequests: 0, interruptedRequests: 0, captureErrors: 0,
    lastRequestAt: null, lastError: null,
  };
  const publish = (): void => {
    activity.activeRequests = active.size + wsActive.size;
    activity.pendingWrites = writes.size;
    opts.onActivity?.({ ...activity });
  };
  const captureError = (code: string): void => {
    activity.captureErrors += 1;
    activity.lastError = code.slice(0, 1024);
    publish();
  };
  const beginCapture = (requestCtx: RequestContext): CaptureState => {
    let admit!: () => void, rejectAdmission!: (error: unknown) => void;
    const admission = new Promise<void>((resolve, reject) => { admit = resolve; rejectAdmission = reject; });
    const requestWriter = opts.bodyStore?.begin(admission) ?? null, responseWriter = opts.bodyStore?.begin(admission) ?? null;
    const ticket = journal === null || requestWriter === null || responseWriter === null ? null : journal.begin({
      requestId: requestCtx.requestId, method: requestCtx.method, url: requestCtx.url, hostname: requestCtx.hostname, requestHeaders: requestCtx.headers,
      startedAt: requestCtx.startedAt, captureGroupId: opts.captureGroupId ?? null, requestBodyId: requestWriter.id, responseBodyId: responseWriter.id,
      requestEnded: false, responseEnded: false, responseStatus: null, responseHeaders: {}, completedAt: null, durationMs: null, transport: null, requestRef: null, responseRef: null,
    });
    if (ticket === null) admit();
    else void ticket.ready.then(admit, error => { rejectAdmission(error); captureError(error instanceof CaptureCapacityError ? error.code : 'CAPTURE_JOURNAL_FAILED'); });
    activity.observedRequests += 1; activity.lastRequestAt = requestCtx.startedAt;
    return { requestCtx, finalized: false, requestEnded: false, responseEnded: false, finalization: null,
      requestWriter, responseWriter, journal: ticket, liveStarted: false, liveStreaming: false };
  };
  const finishState = (state: CaptureState, headers: IncomingHttpHeaders | undefined, outcome: CaptureTransportResult, reason?: string): Promise<void> => {
    if (state.finalization !== null) return state.finalization;
    state.finalized = true; state.requestCtx.markTransportEnd();
    if (state.liveStarted) {
      state.liveStreaming = false; flushProxyStreamChunk(state.requestCtx.requestId);
      eventBus.emit('proxy_stream_ended', { requestId: state.requestCtx.requestId });
    }
    const task = finalizeCapture(opts, state, headers, processor, outcome, reason).then(problem => {
      activity.persistedRequests += 1;
      if (reason !== undefined) activity.interruptedRequests += 1;
      if (problem !== null) captureError(reason ?? problem);
    }).catch((error: unknown) => {
      const sqliteFull = typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_FULL';
      captureError(error instanceof CaptureCapacityError ? error.code : sqliteFull ? 'CAPTURE_METADATA_SQLITE_FULL' : 'CAPTURE_WRITE_FAILED');
      console.error('mitm capture write failed: CAPTURE_WRITE_FAILED');
    }).finally(() => { state.releaseCodexSource?.(); state.requestCtx.releasePreviews(); writes.delete(task); publish(); });
    state.finalization = task; writes.add(task); publish(); return task;
  };
  const settle = (ctx: MitmHandlerContext, reason?: string, code?: string | null): Promise<void> => {
    const state = readCaptureState(ctx);
    if (state === null) return Promise.resolve();
    if (state.finalization !== null) return state.finalization;
    state.requestCtx.markTransportEnd();
    const outcome = transportResult({ requestEnded: state.requestEnded, responseEnded: state.responseEnded,
      statusCode: ctx.serverToProxyResponse?.statusCode, reason: code === 'UPSTREAM_ABORTED' ? code : reason, code });
    outcome.timing = state.requestCtx.networkTiming();
    return finishState(state, ctx.serverToProxyResponse?.headers, outcome, reason);
  };
  const cancel = (ctx: MitmHandlerContext, reason: string, code?: string | null): void => {
    void settle(ctx, reason, code);
    ctx.proxyToServerRequest?.destroy();
    ctx.serverToProxyResponse?.destroy();
    // The engine's generic fallback appends error text to already-started
    // responses. Abort instead, preserving the observed upstream prefix.
    if (ctx.proxyToClientResponse.headersSent) ctx.proxyToClientResponse.destroy();
  };
  let shutdown: Promise<void> | null = null;
  proxy.captureActivity = () => ({ ...activity, activeRequests: active.size + wsActive.size, pendingWrites: writes.size });
  proxy.shutdown = (options = {}) => {
    if (shutdown !== null) return shutdown;
    const grace = options.graceMs ?? 5000;
    if (!Number.isFinite(grace) || grace < 0) return Promise.reject(new RangeError('Invalid shutdown grace'));
    // Freeze explicit Stop before the engine terminates inbound WS clients.
    for (const ws of wsActive) { ws.reason ??= 'PROXY_STOPPED'; ws.ctx.clientToProxyWebSocket?.terminate(); ws.ctx.proxyToServerWebSocket?.terminate(); }
    for (const socket of wsSockets) socket.terminate();
    transport.beginStop();
    activity.listening = false;
    publish();
    shutdown = (async () => {
      const deadline = Date.now() + grace;
      while (active.size > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))));
      }
      for (const ctx of active) cancel(ctx, 'PROXY_STOPPED');
      const closing = transport.finishStop();
      while (wsActive.size > 0 || wsSockets.size > 0) await new Promise(resolve => setTimeout(resolve, 5));
      await Promise.all([...writes, closing]);
      if (opts.processor === undefined) await processor.close();
      publish();
    })().catch(error => { shutdown = null; throw error; });
    return shutdown;
  };
  // Compatibility only. Owners must await shutdown() before closing SQLite.
  proxy.close = () => { void proxy.shutdown({ graceMs: 0 }).catch(() => captureError('PROXY_STOP_FAILED')); };
  proxy.onRequest((ctx, callback) => {
    if (transport.stopping) { callback(new Error('PROXY_STOPPED')); return; }
    try {
      counter += 1;
      const hostname = (ctx.clientToProxyRequest.headers?.host ?? '').split(':')[0] ?? '';
      const requestCtx = new RequestContext(
        {
          method: ctx.clientToProxyRequest.method ?? 'GET',
          url: ctx.clientToProxyRequest.url ?? '',
          hostname,
          headers: (ctx.clientToProxyRequest.headers as Record<string, string>) ?? {},
        },
        counter, resources,
      );
      ctx.tags = { ...(ctx.tags ?? {}), [CAPTURE_TAG]: beginCapture(requestCtx) };
      active.add(ctx);
      ctx.clientToProxyRequest.once('aborted', () => cancel(ctx, 'CLIENT_DISCONNECTED'));
      ctx.clientToProxyRequest.once('close', () => {
        if (!ctx.clientToProxyRequest.complete && !readCaptureState(ctx)?.finalized) cancel(ctx, 'CLIENT_DISCONNECTED');
      });
      ctx.proxyToClientResponse.once('finish', () => { if (readCaptureState(ctx)?.requestEnded || readCaptureState(ctx)?.finalized) active.delete(ctx); publish(); });
      ctx.proxyToClientResponse.once('close', () => {
        if (!readCaptureState(ctx)?.finalized && !ctx.proxyToClientResponse.writableFinished) cancel(ctx, 'CLIENT_DISCONNECTED');
        if (readCaptureState(ctx)?.requestEnded || readCaptureState(ctx)?.finalized) active.delete(ctx);
        publish();
      });
      publish();
    } catch (err) {
      // 捕获初始化失败不阻断转发（HTTP 转发优先，捕获尽力而为）。
      void err;
      captureError('CAPTURE_INIT_FAILED');
      console.error('mitm capture init failed: CAPTURE_INIT_FAILED');
    }
    callback();
  });

  proxy.onRequestData((ctx, chunk, callback) => {
    const state = readCaptureState(ctx);
    if (state !== null && !state.finalized) {
      state.requestWriter?.append(chunk);
      state.requestCtx.appendRequestBytes(chunk);
    }
    // v1.1.0：必须透传 chunk，否则请求体被吞、上游请求不完整。
    callback(null, chunk);
  });

  proxy.onRequestEnd((ctx, callback) => {
    const state = readCaptureState(ctx);
    if (state !== null && !state.finalized) {
      state.requestEnded = true;
      void state.journal?.update({ requestEnded: true }).catch(() => captureError('CAPTURE_JOURNAL_FAILED'));
      state.requestCtx.finishRequestBody();
      if (state.responseEnded) void settle(ctx);
      if (ctx.proxyToClientResponse.writableFinished) { active.delete(ctx); publish(); }
    }
    callback();
  });

  proxy.onResponse((ctx, callback) => {
    const state = readCaptureState(ctx);
    if (state !== null && !state.finalized) {
      const responseHeaders = Object.fromEntries(Object.entries(ctx.serverToProxyResponse?.headers ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string | string[]>;
      state.requestCtx.markResponseHeaders(responseHeaders);
      void state.journal?.update({ responseStatus: ctx.serverToProxyResponse?.statusCode ?? null, responseHeaders }).catch(() => captureError('CAPTURE_JOURNAL_FAILED'));
      const encoding = responseHeaders['content-encoding'];
      if (!state.liveStarted && (responseContentType(ctx.serverToProxyResponse?.headers) ?? '').toLowerCase().includes('text/event-stream') &&
        (encoding === undefined || typeof encoding === 'string' && encoding.trim().toLowerCase() === 'identity')) {
        state.liveStarted = true;
        state.liveStreaming = true;
        eventBus.emit('proxy_stream_started', { requestId: state.requestCtx.requestId, hostname: state.requestCtx.hostname, startedAt: state.requestCtx.startedAt });
      }
    }
    ctx.serverToProxyResponse?.once('aborted', () => cancel(ctx, 'UPSTREAM_ERROR', 'UPSTREAM_ABORTED'));
    callback();
  });

  proxy.onResponseData((ctx, chunk, callback) => {
    const state = readCaptureState(ctx);
    let liveText = '';
    if (state !== null && !state.finalized) {
      state.responseWriter?.append(chunk);
      liveText = state.requestCtx.appendResponseBytes(chunk);
    }
    callback(null, chunk);
    // No protocol parsing here: this is only the existing bounded display
    // decoder's new text. Network fragments are neither SSE events nor tokens.
    if (state !== null && !state.finalized && state.liveStreaming) {
      const accepted = queueProxyStreamChunk(state.requestCtx.requestId, liveText);
      if (!accepted || state.requestCtx.displayPreviewsTruncated.response || state.requestCtx.previewResourceLimited) {
        state.liveStreaming = false;
        captureError('CAPTURE_LIVE_PREVIEW_LIMIT');
      }
    }
  });

  proxy.onResponseEnd((ctx, callback) => {
    const state = readCaptureState(ctx);
    if (state !== null && !state.finalized) {
      state.responseEnded = true;
      void state.journal?.update({ responseEnded: true }).catch(() => captureError('CAPTURE_JOURNAL_FAILED'));
      if (state.requestEnded) void settle(ctx);
    }
    callback();
  });

  const appendWs = (ws: WsCapture, direction: 'request' | 'response', kind: WsKind, binary: boolean, parts: Buffer[]): void => {
    if (ws.capture.finalized) return;
    const bytes = parts.reduce((sum, part) => sum + part.length, 0);
    const sequence = ++ws.sequence, elapsedMs = performance.now() - ws.started;
    const header = wsRecordHeader(kind, binary, sequence, elapsedMs, bytes);
    const writer = direction === 'request' ? ws.capture.requestWriter : ws.capture.responseWriter;
    const append = (part: Buffer): void => {
      writer?.append(part);
      if (direction === 'request') ws.capture.requestCtx.appendRequestBytes(part);
      else ws.capture.requestCtx.appendResponseBytes(part);
    };
    append(header); for (const part of parts) append(part);
    if (kind === 'message') {
      if (direction === 'request') ws.outcome.requestMessages += 1; else ws.outcome.responseMessages += 1;
      queueProxySourceChange(ws.capture.requestCtx.requestId);
    }
    // Only a bounded message prefix is decoded for the selected live feed;
    // full payloads are never stringified or JSON-parsed on this callback.
    const remaining = 65536 - ws.liveBytes;
    if (remaining > 0 && ws.capture.liveStreaming) {
      const prefix: Buffer[] = []; let count = 0;
      for (const part of parts) { const slice = part.subarray(0, Math.min(4096 - count, remaining)); if (slice.length > 0) prefix.push(slice); count += slice.length; if (count >= Math.min(4096, remaining)) break; }
      const rendered = wsRecordText({ kind, binary, sequence, elapsedMs, payload: Buffer.concat(prefix, count) }, direction);
      const encoded = Buffer.from(rendered + (count < bytes ? '[message preview truncated]\n' : ''));
      const limit = Math.max(0, remaining - 80), limited = encoded.length > limit;
      const text = new StringDecoder('utf8').write(encoded.subarray(0, limit)) + (limited ? '\n[WS live preview limit; inspect saved archives]\n' : '');
      ws.liveBytes += Buffer.byteLength(text);
      if (!queueProxyStreamChunk(ws.capture.requestCtx.requestId, text) || limited) { ws.capture.liveStreaming = false; captureError('CAPTURE_LIVE_PREVIEW_LIMIT'); }
    }
  };
  const finishWs = (ws: WsCapture): void => {
    if (!ws.clientClosed || !ws.upstreamClosed || ws.capture.finalized) return;
    wsActive.delete(ws);
    const normal = ws.reason === undefined;
    const outcome = transportResult({ requestEnded: normal, responseEnded: normal, statusCode: ws.status, reason: ws.reason, code: ws.code });
    outcome.websocket = { ...ws.outcome };
    void finishState(ws.capture, ws.headers, outcome, ws.reason);
  };
  engine.onWebSocketConnection((ctx, callback) => {
    let ws: WsCapture | undefined;
    let allocated: RequestContext | undefined;
    ownWs(ctx.clientToProxyWebSocket);
    queueMicrotask(() => ownWs(ctx.proxyToServerWebSocket));
    try {
      const socket = ctx.clientToProxyWebSocket;
      const request = socket === undefined ? undefined : transport.webSocketRequest(socket);
      const url = new URL(ctx.proxyToServerWebSocketOptions!.url!);
      if (request === undefined) throw new Error('WS_UPGRADE_METADATA_UNAVAILABLE');
      const requestCtx = new RequestContext({ requestId: `ws-${ctx.uuid}`, method: 'WS', url: url.href, hostname: url.hostname,
        headers: request.headers as Record<string, string> }, 0, resources);
      allocated = requestCtx;
      ws = { capture: beginCapture(requestCtx), ctx, started: performance.now(), sequence: 0, liveBytes: 0, headers: {},
        outcome: { version: 1, scope: 'connection', archive: 'awsp1', requestMessages: 0, responseMessages: 0, clientCloseCode: null, upstreamCloseCode: null },
        clientClosed: false, upstreamClosed: false };
      wsStates.set(ctx, ws); wsActive.add(ws);
      if (opts.bodyStore !== undefined && ws.capture.requestWriter !== null && ws.capture.responseWriter !== null) {
        const state = ws.capture, store = opts.bodyStore;
        state.releaseCodexSource = registerCodexSource(opts.db, requestCtx.requestId, () => ({
          requestId: requestCtx.requestId, startedAt: requestCtx.startedAt, active: true,
          hostname: requestCtx.hostname,
          directory: store.directory, headers: request.headers as Record<string, string | string[]>,
          request: state.requestWriter!.snapshot(), response: state.responseWriter!.snapshot(),
        }));
      }
      for (const direction of ['request', 'response'] as const) {
        if (direction === 'request') { ws.capture.requestWriter?.append(WS_ARCHIVE_MAGIC); requestCtx.appendRequestBytes(WS_ARCHIVE_MAGIC); }
        else { ws.capture.responseWriter?.append(WS_ARCHIVE_MAGIC); requestCtx.appendResponseBytes(WS_ARCHIVE_MAGIC); }
      }
      const observeClose = (fromServer: boolean, code: number, reason: Buffer): void => {
        if (ws === undefined) return;
        if (fromServer) { ws.upstreamClosed = true; ws.outcome.upstreamCloseCode = code; }
        else { ws.clientClosed = true; ws.outcome.clientCloseCode = code; }
        if (![1000, 1001, 1005].includes(code)) ws.reason ??= fromServer ? 'UPSTREAM_ERROR' : 'CLIENT_DISCONNECTED';
        const close = Buffer.alloc(2); close.writeUInt16BE(code);
        try { appendWs(ws, fromServer ? 'response' : 'request', 'close', false, [close, reason]); }
        catch { captureError('WS_ARCHIVE_APPEND_FAILED'); }
        finishWs(ws);
      };
      socket!.once('close', (code: number, reason: Buffer) => observeClose(false, code, reason));
      // The actual engine creates its upstream socket synchronously inside
      // callback(). Attach before asynchronous upgrade/message/close delivery.
      queueMicrotask(() => {
        const upstream = ctx.proxyToServerWebSocket;
        if (ws === undefined) return;
        if (upstream === undefined) { ws.upstreamClosed = true; ws.reason ??= 'UPSTREAM_ERROR'; socket!.terminate(); finishWs(ws); return; }
        upstream.once('upgrade', (response: IncomingMessage) => {
          if (ws === undefined || ws.capture.finalized) return;
          ws.status = response.statusCode; ws.headers = response.headers;
          void ws.capture.journal?.update({ responseStatus: response.statusCode ?? null, responseHeaders: response.headers as Record<string, string | string[]> }).catch(() => captureError('CAPTURE_JOURNAL_FAILED'));
        });
        upstream.once('close', (code: number, reason: Buffer) => observeClose(true, code, reason));
        if (transport.stopping) { ws.reason ??= 'PROXY_STOPPED'; socket!.terminate(); upstream.terminate(); }
      });
      ws.capture.liveStarted = true; ws.capture.liveStreaming = true;
      eventBus.emit('proxy_stream_started', { requestId: requestCtx.requestId, hostname: requestCtx.hostname, startedAt: requestCtx.startedAt });
      publish();
    } catch { if (ws === undefined) allocated?.releasePreviews(); captureError('WS_CAPTURE_INIT_FAILED'); }
    callback();
  });
  engine.onWebSocketFrame((ctx, type: unknown, fromServer, message: unknown, flags: unknown, callback) => {
    const ws = wsStates.get(ctx);
    if (ws !== undefined && !ws.capture.finalized) {
      try {
        if (type === 'message' || type === 'ping' || type === 'pong') appendWs(ws, fromServer ? 'response' : 'request', type, flags === true, wsPayloadParts(message));
        else captureError('WS_FRAME_KIND_UNSUPPORTED');
      } catch { captureError('WS_ARCHIVE_APPEND_FAILED'); }
    }
    callback(null, message, flags);
  });
  engine.onWebSocketError((ctx, error) => {
    const ws = wsStates.get(ctx);
    if (ws === undefined || ws.capture.finalized) return;
    // The engine can observe a queued pong after a normal close has begun.
    // Its local send-state notification is not an upstream reset: preserve
    // the ongoing close handshake and let the actual two close events decide.
    if (error instanceof Error && /^Cannot send (message|ping|pong) because (clientToProxy|proxyToServer) WebSocket connection state is not OPEN$/.test(error.message) &&
      (ctx.clientToProxyWebSocket?.readyState >= 2 || ctx.proxyToServerWebSocket?.readyState >= 2)) return;
    // If a close event caused the engine error (e.g. forwarding1006 as a
    // close code), our actual per-leg close observer runs next. Its observed
    // code decides client-abort versus a reset during a normal handshake.
    if (!ctx.closedByClient && !ctx.closedByServer) ws.reason ??= 'UPSTREAM_ERROR';
    ws.code ??= observedNetworkCode(error);
    ctx.clientToProxyWebSocket?.terminate(); ctx.proxyToServerWebSocket?.terminate();
  });

  proxy.onError((ctx, err, errorKind) => {
    if (ctx === null && rejectStartup !== null) {
      const reject = rejectStartup;
      rejectStartup = null;
      reject(err ?? new Error(errorKind ?? 'Proxy failed to listen'));
      return;
    }
    // v1.1.0：onError(ctx, err, errorKind) —— 上游连接失败/响应中断等。
    // 有捕获状态时写出已捕获的部分行，避免请求静默丢失（finalized 防重复写）。
    if (ctx !== null) {
      const state = readCaptureState(ctx);
      if (state !== null && !state.finalized) cancel(ctx,
        errorKind?.startsWith('CLIENT_TO_PROXY_') || errorKind?.startsWith('PROXY_TO_CLIENT_') ? 'CLIENT_DISCONNECTED' : 'UPSTREAM_ERROR', observedNetworkCode(err));
    } else {
      captureError('PROXY_TRANSPORT_ERROR');
    }
    if (ctx?.proxyToClientResponse.headersSent && !ctx.proxyToClientResponse.writableFinished) ctx.proxyToClientResponse.destroy();
    console.error('mitm proxy error: PROXY_TRANSPORT_ERROR');
  });

  try { await new Promise<void>((resolve, reject) => {
    rejectStartup = reject;
    // 显式绑定 127.0.0.1：默认 'localhost' 在部分 macOS 上解析为 ::1，
    // 与项目统一的 127.0.0.1 客户端约定不一致。
    proxy.listen({ port: opts.port ?? 7779, host: '127.0.0.1', sslCaDir: opts.caDirectory, httpsAgent: opts.httpsAgent }, (error) => {
      rejectStartup = null;
      if (error !== null && error !== undefined) {
        reject(error);
      } else resolve();
    });
  }); } catch (error) {
    transport.beginStop();
    await transport.finishStop();
    if (opts.processor === undefined) await processor.close();
    throw error;
  }
  transport.track(engine.httpServer, engine.wsServer);
  activity.listening = true;
  publish();
  return proxy;
}

/**
 * 在 onResponseEnd（或 onError 兜底）时把当前请求写为 proxy_requests 行。
 * 请求体来自 onRequestData 累积（ctx.body），响应体来自 onResponseData
 * 累积（chunks / streamedBody），状态码与 content-type 取自真实上游响应。
 */
async function finalizeCapture(opts: MitmProxyOptions, state: CaptureState, responseHeaders: IncomingHttpHeaders | undefined, processor: CaptureProcessor, transport: CaptureTransportResult, reason?: string): Promise<string | null> {
  const requestCtx = state.requestCtx;
  requestCtx.finishRequestBody();
  requestCtx.finishResponseBody();
  const { completedAt, durationMs } = requestCtx.markTransportEnd();
  let journalFailed = false;
  const updateJournal = async (patch: Parameters<CaptureJournalTicket['update']>[0]): Promise<void> => {
    try { await state.journal?.update(patch); } catch { journalFailed = true; }
  };
  await updateJournal({ transport, responseStatus: transport.statusCode, requestEnded: transport.requestEnded, responseEnded: transport.responseEnded, completedAt, durationMs });
  const [requestRef, responseRef] = await Promise.all([
    state.requestWriter?.finish(!transport.requestEnded, reason) ?? Promise.resolve(null),
    state.responseWriter?.finish(!transport.responseEnded, reason) ?? Promise.resolve(null),
  ]);
  await updateJournal({ requestRef, responseRef });
  const hostname = requestCtx.hostname;
  const contentType = responseContentType(responseHeaders);
  const isStreaming = (contentType ?? '').toLowerCase().includes('text/event-stream');
  const responseBody = requestCtx.chunks.length > 0 ? requestCtx.streamedBody : null;
  const responseHeaderValues = Object.fromEntries(Object.entries(responseHeaders ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string | string[]>;
  let projection;
  try {
    if (requestCtx.previewResourceLimited) throw new CaptureProcessingError('resource_limit');
    const pending = processor.submit({ hostname, url: requestCtx.url, requestBody: '', responseBody: null, isStreaming, ...requestCtx.takeBytePreviews(),
      ...(transport.websocket === undefined ? {} : { evidenceFormat: 'websocket_archive_v1' as const }),
      requestHeaders: requestCtx.headers, responseHeaders: responseHeaderValues,
      timing: transport.timing, responseTimeline: transport.websocket === undefined ? requestCtx.takeResponseTimeline() : undefined,
      previewTruncated: requestCtx.requestPreviewTruncated || requestCtx.responsePreviewTruncated || !transport.requestEnded || !transport.responseEnded,
      requestTruncated: requestCtx.requestPreviewTruncated || !transport.requestEnded, responseTruncated: requestCtx.responsePreviewTruncated || !transport.responseEnded });
    requestCtx.releaseRawPreviews();
    projection = await pending;
  } catch (error) {
    const failure = error instanceof CaptureProcessingError ? error : new CaptureProcessingError('worker_error');
    const errorCode = failure.status === 'resource_limit' ? 'CAPTURE_PREVIEW_BUDGET_EXCEEDED' : failure.message;
    const collector = createIdentityCollector(); collector.omit(errorCode);
    projection = { parsed: { parserRoute: 'unknown', requestFormat: 'unknown' as const, model: null, systemPrompt: null, systemPromptLen: 0, inputTokens: null, outputTokens: null },
      identities: collector.finish(), processing: { version: 1 as const, status: failure.status, error: errorCode } };
  }
  const { parsed, identities } = projection;
  if ('timing' in projection && projection.timing !== undefined) {
    transport.timing = projection.timing;
    await updateJournal({ transport });
  }
  const encodingOf = (headers: Record<string, string | string[]>): string | undefined => {
    const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1];
    return Array.isArray(value) ? value.join(',') : value;
  };
  const processing: CaptureProcessingResult = { ...projection.processing, previewDroppedBytes: requestCtx.previewDroppedBytes,
    contentDecoding: projection.processing.contentDecoding ?? { request: contentEncoding(encodingOf(requestCtx.headers)), response: contentEncoding(encodingOf(responseHeaderValues)) } };
  // Frozen upstream evidence, not a later local synthetic504 or error callback.
  requestCtx.responseStatus = transport.statusCode;
  // User-approved REQ-004: preserve original observed content without redaction.
  const keepRaw = opts.keepRawBodies ?? false;
  const preview = (text: string): string => new StringDecoder('utf8').write(Buffer.from(text).subarray(0, 64 * 1024));
  const fallbackText = (headers: Record<string, string | string[]>, text: string | null): string | null => {
    if (transport.websocket !== undefined) return null;
    const encoding = headers['content-encoding'];
    return encoding !== undefined && encoding !== 'identity' ? null : text === null || text === '' ? null : preview(text);
  };
  const decoded = 'previews' in projection ? projection.previews : undefined;
  const desensitizedRequestBody = decoded === undefined ? fallbackText(requestCtx.headers, requestCtx.body) : decoded.request;
  const desensitizedResponseBody = decoded === undefined ? fallbackText(responseHeaderValues, responseBody) : decoded.response;
  // Never commit metadata in the forwarding callback or as a parser fallback.
  await yieldImmediate();
  const affected: string[] = [];
  const id = await retryCaptureCommit(opts.db, () => opts.db.transaction(() => {
    if (state.journal !== null) { const existing = committedCaptureId(opts.db, state.journal.entry); if (existing !== null) return existing; }
    const inserted = writeProxyRequest({
    db: opts.db,
    ctx: requestCtx,
    parsed: parsed ?? {
      parserRoute: 'unknown',
      model: null,
      systemPrompt: null,
      systemPromptLen: 0,
      inputTokens: null,
      outputTokens: null,
      requestFormat: 'unknown',
    },
    desensitizedRequestBody,
    desensitizedResponseBody,
    contentType,
    isStreaming,
    captureMethod: 'mitm' as CaptureMethod,
    desensitizeOptions: { ...opts.desensitizeOptions, keepRawBodies: keepRaw },
    completedAt,
    captureGroupId: opts.captureGroupId,
  });
    if (opts.bodyStore !== undefined) {
      writeCaptureBodies(opts.db, inserted, {
        request: requestRef, response: responseRef,
        requestPreviewTruncated: decoded?.requestTruncated ?? (requestCtx.requestPreviewTruncated || requestCtx.displayPreviewsTruncated.request),
        responsePreviewTruncated: decoded?.responseTruncated ?? (requestCtx.responsePreviewTruncated || requestCtx.displayPreviewsTruncated.response),
        responseHeaders: responseHeaderValues, processing,
      });
    } else writeCaptureProcessing(opts.db, inserted, processing);
    writeCaptureTransport(opts.db, inserted, transport);
    affected.push(...writeNativeIdentities(opts.db, { source: 'proxy', key: String(inserted) }, identities, completedAt));
    return inserted;
  })(), true);
  try { await state.journal?.remove(); } catch { journalFailed = true; }
  for (const key of affected) opts.notifySession?.(key, id);
  opts.notify?.(id);
  return journalFailed ? 'CAPTURE_JOURNAL_FAILED' : processing.error ?? ([requestRef, responseRef].some(ref => ref !== null && ref.status !== 'complete') ? 'CAPTURE_INCOMPLETE' : null);
}
