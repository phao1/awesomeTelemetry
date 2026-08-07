// D-002（已裁决 ①）：http-mitm-proxy v1.1.0 实际生命周期接线。
// 旧实现使用不存在的 ctx.onData/onEnd，真实转发返回 200 但 proxy_requests 写 0 行。
// v1.1.0 真实事件序列（lib/proxy.ts + ProxyFinal{Request,Response}Filter）：
//   onRequest -> (onRequestData x N) -> onRequestEnd -> onResponse ->
//   (onResponseData x N) -> onResponseEnd
// 数据回调必须回调 (null, chunk) 透传，否则请求/响应流会被吞掉。
import type { Database } from 'better-sqlite3';
import { Proxy } from 'http-mitm-proxy';
import type { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http';

import type { CaptureMethod } from '../../src/core/trace-types.js';
import { desensitize, type DesensitizeOptions } from '../desensitization/engine.js';
import { parseProxyRequest } from './parser-router.js';
import { writeProxyRequest } from './proxy-writer.js';
import { RequestContext } from './request-context.js';
import { parseSseChunk } from './sse-accumulator.js';

export interface MitmProxyOptions {
  db: Database;
  port?: number;
  keepRawBodies?: boolean;
  desensitizeOptions?: DesensitizeOptions;
  notify?: (id: number) => void;
  /** design D2：本次成功 proxy run 的不透明 UUID，写入该 run 捕获的每一行。 */
  captureGroupId?: string;
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
  listen(opts: { port: number; host?: string }, cb: () => void): void;
  close(): void;
}

/** 每个 ctx 的捕获状态，存于 ctx.tags[TAG]。 */
interface CaptureState {
  requestCtx: RequestContext;
  finalized: boolean;
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
export async function createMitmProxy(opts: MitmProxyOptions): Promise<ProxyServerLike> {
  const proxy = new Proxy() as unknown as ProxyServerLike;

  proxy.onRequest((ctx, callback) => {
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
        counter,
      );
      ctx.tags = { ...(ctx.tags ?? {}), [CAPTURE_TAG]: { requestCtx, finalized: false } satisfies CaptureState };
    } catch (err) {
      // 捕获初始化失败不阻断转发（HTTP 转发优先，捕获尽力而为）。
      console.error(`mitm capture init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    callback();
  });

  proxy.onRequestData((ctx, chunk, callback) => {
    const state = readCaptureState(ctx);
    if (state !== null) {
      state.requestCtx.body += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    }
    // v1.1.0：必须透传 chunk，否则请求体被吞、上游请求不完整。
    callback(null, chunk);
  });

  proxy.onRequestEnd((_ctx, callback) => {
    callback();
  });

  proxy.onResponse((_ctx, callback) => {
    callback();
  });

  proxy.onResponseData((ctx, chunk, callback) => {
    const state = readCaptureState(ctx);
    if (state !== null) {
      state.requestCtx.appendChunk(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    }
    callback(null, chunk);
  });

  proxy.onResponseEnd((ctx, callback) => {
    try {
      finalizeCapture(opts, ctx);
    } catch (err) {
      // 捕获/存储失败不阻断响应流；错误必须可见（不静默吞）。
      console.error(`mitm capture write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    callback();
  });

  proxy.onError((ctx, err, errorKind) => {
    // v1.1.0：onError(ctx, err, errorKind) —— 上游连接失败/响应中断等。
    // 有捕获状态时写出已捕获的部分行，避免请求静默丢失（finalized 防重复写）。
    if (ctx !== null) {
      const state = readCaptureState(ctx);
      if (state !== null && !state.finalized) {
        try {
          finalizeCapture(opts, ctx);
        } catch (writeErr) {
          console.error(`mitm capture write failed on error: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
        }
      }
    }
    const detail = err?.message ?? errorKind ?? 'unknown';
    console.error(`mitm proxy error: ${detail}`);
  });

  await new Promise<void>((resolve) => {
    // 显式绑定 127.0.0.1：默认 'localhost' 在部分 macOS 上解析为 ::1，
    // 与项目统一的 127.0.0.1 客户端约定不一致。
    proxy.listen({ port: opts.port ?? 8080, host: '127.0.0.1' }, () => resolve());
  });
  return proxy;
}

/**
 * 在 onResponseEnd（或 onError 兜底）时把当前请求写为 proxy_requests 行。
 * 请求体来自 onRequestData 累积（ctx.body），响应体来自 onResponseData
 * 累积（chunks / streamedBody），状态码与 content-type 取自真实上游响应。
 */
function finalizeCapture(opts: MitmProxyOptions, ctx: MitmHandlerContext): void {
  const state = readCaptureState(ctx);
  if (state === null || state.finalized) {
    return;
  }
  state.finalized = true;
  const requestCtx = state.requestCtx;
  const hostname = requestCtx.hostname;
  const responseHeaders = ctx.serverToProxyResponse?.headers;
  const contentType = responseContentType(responseHeaders);
  const isStreaming = (contentType ?? '').includes('text/event-stream');
  const responseBody = requestCtx.chunks.length > 0 ? requestCtx.streamedBody : null;
  const parsed = parseProxyRequest({
    hostname,
    url: requestCtx.url,
    requestBody: requestCtx.body,
    responseBody,
    isStreaming,
    sseEvents: isStreaming && responseBody !== null ? parseSseChunk(responseBody) : undefined,
  });
  const status = ctx.serverToProxyResponse?.statusCode;
  if (status !== undefined) {
    // 成功路径：真实上游状态码；错误兜底路径（无响应）保持 null，
    // writer 对缺失状态按既定行为写 0。
    requestCtx.responseStatus = status;
  }
  // REQ-004：存储前脱敏
  const keepRaw = opts.keepRawBodies ?? false;
  const desensitizedRequestBody = requestCtx.body === '' ? null : desensitize(requestCtx.body, opts.desensitizeOptions);
  const desensitizedResponseBody =
    requestCtx.chunks.length > 0 ? desensitize(requestCtx.streamedBody, opts.desensitizeOptions) : null;
  writeProxyRequest({
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
    notify: opts.notify,
    captureGroupId: opts.captureGroupId,
  });
}
