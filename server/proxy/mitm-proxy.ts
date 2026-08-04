// P-3：MITM 需要真实 HTTPS 环境，macOS CI 无法端到端验证。
// 本模块保留真实接线骨架（http-mitm-proxy），事件细节在真实环境验证时补全。
import type { Database } from 'better-sqlite3';
import { Proxy } from 'http-mitm-proxy';

import type { CaptureMethod } from '../../src/core/trace-types.js';
import { desensitize, type DesensitizeOptions } from '../desensitization/engine.js';
import { parseProxyRequest, type ParsedRequest } from './parser-router.js';
import { writeProxyRequest } from './proxy-writer.js';
import { RequestContext } from './request-context.js';
import { parseSseChunk } from './sse-accumulator.js';

export interface MitmProxyOptions {
  db: Database;
  port?: number;
  keepRawBodies?: boolean;
  desensitizeOptions?: DesensitizeOptions;
  notify?: (id: number) => void;
}

interface MitmHandlerContext {
  clientToProxyRequest: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
  };
  proxyToClientResponse?: {
    statusCode?: number;
    headers?: Record<string, string>;
  };
  onData?: (cb: (chunk: Buffer | string) => void) => void;
  onEnd?: (cb: () => void) => void;
  onError?: (cb: (err: Error) => void) => void;
}

interface ProxyServerLike {
  onRequest(cb: (ctx: MitmHandlerContext, callback: () => void) => void): void;
  onError(cb: (err: Error) => void): void;
  listen(opts: { port: number }, cb: () => void): void;
  close(): void;
}

let counter = 0;

/** REQ-001：MITM 捕获接线（P-3：生成但不端到端验证）。 */
export async function createMitmProxy(opts: MitmProxyOptions): Promise<ProxyServerLike> {
  const proxy = new Proxy() as unknown as ProxyServerLike;

  proxy.onRequest((ctx, callback) => {
    counter += 1;
    const hostname = (ctx.clientToProxyRequest.headers?.host ?? '').split(':')[0] ?? '';
    const requestCtx = new RequestContext(
      {
        method: ctx.clientToProxyRequest.method ?? 'GET',
        url: ctx.clientToProxyRequest.url ?? '',
        hostname,
        headers: ctx.clientToProxyRequest.headers ?? {},
      },
      counter,
    );
    let contentType: string | null = null;
    let isStreaming = false;
    let parsed: ParsedRequest | null = null;

    ctx.onData?.((chunk) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (ctx.proxyToClientResponse !== undefined) {
        requestCtx.appendChunk(text);
      } else {
        requestCtx.body += text;
      }
    });
    ctx.onEnd?.(() => {
      const responseHeaders = ctx.proxyToClientResponse?.headers ?? {};
      contentType = Object.entries(responseHeaders)
        .find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? null;
      isStreaming = (contentType ?? '').includes('text/event-stream');
      const body = requestCtx.chunks.length > 0 ? requestCtx.streamedBody : requestCtx.body;
      parsed = parseProxyRequest({
        hostname,
        requestBody: requestCtx.body,
        responseBody: requestCtx.chunks.length > 0 ? body : null,
        isStreaming,
        sseEvents: isStreaming ? parseSseChunk(body) : undefined,
      });
      const status = ctx.proxyToClientResponse?.statusCode ?? 200;
      requestCtx.completeRequest(status);
      // REQ-004：存储前脱敏
      const keepRaw = opts.keepRawBodies ?? false;
      const desensitizedRequestBody = requestCtx.body === '' ? null : desensitize(requestCtx.body, opts.desensitizeOptions);
      const desensitizedResponseBody =
        requestCtx.chunks.length > 0 ? desensitize(requestCtx.streamedBody, opts.desensitizeOptions) : null;
      writeProxyRequest({
        db: opts.db,
        ctx: requestCtx,
        parsed: parsed ?? { parserRoute: 'unknown', model: null, systemPrompt: null, systemPromptLen: 0, inputTokens: null, outputTokens: null },
        desensitizedRequestBody,
        desensitizedResponseBody,
        contentType,
        isStreaming,
        captureMethod: 'mitm' as CaptureMethod,
        desensitizeOptions: { ...opts.desensitizeOptions, keepRawBodies: keepRaw },
        notify: opts.notify,
      });
    });
    ctx.onError?.((err) => {
      console.error(`mitm capture error: ${err.message}`);
    });
    callback();
  });

  proxy.onError((err) => {
    console.error(`mitm proxy error: ${err.message}`);
  });

  await new Promise<void>((resolve) => {
    proxy.listen({ port: opts.port ?? 8080 }, () => resolve());
  });
  return proxy;
}
