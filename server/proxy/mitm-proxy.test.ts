// D-002（已裁决 ①）：真实 createMitmProxy 生命周期接线测试。
// 旧实现使用不存在的 ctx.onData/onEnd（死代码）：真实请求转发返回 200，
// 但 proxy_requests 写 0 行。本文件用真实 http 客户端 + 真实本地 origin
// 穿过真实 http-mitm-proxy 实例复现该故障，并验证修复后的写入行为。
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from '../storage/schema.js';
import { createMitmProxy, type ProxyServerLike } from './mitm-proxy.js';

const ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';

interface ProxyRow {
  id: number;
  request_id: string;
  method: string;
  url: string;
  hostname: string;
  request_body: string | null;
  response_status: number | null;
  response_body: string | null;
  content_type: string | null;
  is_streaming: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  capture_method: string;
  parser_route: string | null;
  model: string | null;
  system_prompt: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  capture_group_id: string | null;
  request_format: string | null;
  raw_request_body: string | null;
  raw_response_body: string | null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

interface Origin {
  server: HttpServer;
  port: number;
  close: () => Promise<void>;
}

async function startOrigin(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Origin> {
  const server = createHttpServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function anthropicHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      model: ANTHROPIC_MODEL,
      usage: { input_tokens: 12, output_tokens: 5 },
      content: [{ type: 'text', text: 'hello' }],
    }),
  );
}

interface ViaProxyOptions {
  method?: string;
  path: string;
  /** 覆盖 Host 头：parser 按 hostname 路由；实际连接仍走 originPort。 */
  host?: string;
  headers?: Record<string, string>;
  body?: string;
}

function requestViaProxy(
  proxyPort: number,
  originPort: number,
  opts: ViaProxyOptions,
): Promise<{ statusCode: number | undefined; headers: NodeJS.Dict<string | string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: opts.method ?? 'POST',
        path: `http://127.0.0.1:${originPort}${opts.path}`,
        headers: {
          host: opts.host ?? '127.0.0.1',
          'content-type': 'application/json',
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function setupProxy(opts: { keepRawBodies?: boolean; captureGroupId?: string } = {}) {
  const db = new Database(':memory:');
  initSchema(db);
  const notified: number[] = [];
  const proxyPromise: Promise<ProxyServerLike> = Promise.resolve().then(() =>
    createMitmProxy({
      db,
      port: 0,
      keepRawBodies: opts.keepRawBodies,
      captureGroupId: opts.captureGroupId,
      notify: (id) => notified.push(id),
    }),
  );
  return { db, notified, proxyPromise };
}

describe('createMitmProxy 真实网络级捕获（D-002）', () => {
  it('D-002 复现 + 修复：真实请求经代理转发返回 200 且 proxy_requests 写入 1 行完整字段', async () => {
    const { db, notified, proxyPromise } = setupProxy({ captureGroupId: '00000000-0000-4000-8000-000000000001' });
    const origin = await startOrigin(anthropicHandler);
    const proxy = await proxyPromise;
    try {
      const proxyPort = proxyAddressPort(proxy);
      const body = JSON.stringify({
        model: ANTHROPIC_MODEL,
        system: 'you are a helpful assistant',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
      });
      const res = await requestViaProxy(proxyPort, origin.port, {
        path: '/v1/messages',
        host: 'api.anthropic.com',
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('msg_1');
      await waitFor(() => notified.length >= 1);

      const rows = db.prepare('SELECT * FROM proxy_requests').all() as ProxyRow[];
      // 旧死代码接线：0 行 —— 本断言在旧实现下必然失败。
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.method).toBe('POST');
      expect(row.url).toBe('/v1/messages');
      expect(row.hostname).toBe('api.anthropic.com');
      expect(row.request_body).toContain('"model"');
      expect(row.request_body).toContain(ANTHROPIC_MODEL);
      expect(row.response_status).toBe(200);
      expect(row.response_body).toContain('"usage"');
      expect(row.content_type).toBe('application/json');
      expect(row.is_streaming).toBe(0);
      expect(row.capture_group_id).toBe('00000000-0000-4000-8000-000000000001');
      expect(row.request_format).toBe('anthropic_messages');
      expect(row.parser_route).toBe('anthropic');
      expect(row.model).toBe(ANTHROPIC_MODEL);
      expect(row.input_tokens).toBe(12);
      expect(row.output_tokens).toBe(5);
      expect(row.system_prompt).toBe('you are a helpful assistant');
      expect(row.duration_ms).toBeGreaterThanOrEqual(0);
      expect(Date.parse(row.completed_at ?? '')).toBeGreaterThanOrEqual(Date.parse(row.started_at));
      expect(row.request_id).toMatch(/^req-/);
      // 默认 keepRawBodies=false：raw 列不写
      expect(row.raw_request_body).toBeNull();
      expect(row.raw_response_body).toBeNull();
    } finally {
      proxy.close();
      await origin.close();
      db.close();
    }
  });

  it('SSE 流式响应：is_streaming=1、content-type 与响应体完整捕获', async () => {
    const { db, notified, proxyPromise } = setupProxy({ captureGroupId: '00000000-0000-4000-8000-000000000002' });
    const origin = await startOrigin((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      res.write('event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":7,"output_tokens":3}}\n\n');
      res.end();
    });
    const proxy = await proxyPromise;
    try {
      const res = await requestViaProxy(proxyAddressPort(proxy), origin.port, {
        path: '/v1/messages',
        host: 'api.anthropic.com',
        body: JSON.stringify({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: 'x' }] }),
      });
      expect(res.statusCode).toBe(200);
      await waitFor(() => notified.length >= 1);

      const row = db.prepare('SELECT * FROM proxy_requests').all() as ProxyRow[];
      expect(row).toHaveLength(1);
      expect(row[0]!.is_streaming).toBe(1);
      expect(row[0]!.content_type).toBe('text/event-stream');
      expect(row[0]!.response_body).toContain('message_delta');
      expect(row[0]!.request_format).toBe('anthropic_messages');
    } finally {
      proxy.close();
      await origin.close();
      db.close();
    }
  });

  it('同一 run 内多行共享 captureGroupId；新 run 换组（design D2）', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const notifiedA: number[] = [];
    const proxyA = await createMitmProxy({
      db,
      port: 0,
      captureGroupId: '00000000-0000-4000-8000-0000000000aa',
      notify: (id) => notifiedA.push(id),
    });
    const notifiedB: number[] = [];
    const proxyB = await createMitmProxy({
      db,
      port: 0,
      captureGroupId: '00000000-0000-4000-8000-0000000000bb',
      notify: (id) => notifiedB.push(id),
    });
    const origin = await startOrigin(anthropicHandler);
    try {
      const body = JSON.stringify({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: 'a' }] });
      await requestViaProxy(proxyAddressPort(proxyA), origin.port, { path: '/v1/messages', host: 'api.anthropic.com', body });
      await requestViaProxy(proxyAddressPort(proxyA), origin.port, { path: '/v1/messages', host: 'api.anthropic.com', body });
      await requestViaProxy(proxyAddressPort(proxyB), origin.port, { path: '/v1/messages', host: 'api.anthropic.com', body });
      await waitFor(() => notifiedA.length >= 2 && notifiedB.length >= 1);

      const rows = db.prepare('SELECT id, capture_group_id FROM proxy_requests ORDER BY id').all() as Array<{
        id: number;
        capture_group_id: string | null;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows[0]!.capture_group_id).toBe('00000000-0000-4000-8000-0000000000aa');
      expect(rows[1]!.capture_group_id).toBe('00000000-0000-4000-8000-0000000000aa');
      expect(rows[2]!.capture_group_id).toBe('00000000-0000-4000-8000-0000000000bb');
    } finally {
      proxyA.close();
      proxyB.close();
      await origin.close();
      db.close();
    }
  });

  it('请求格式分类：openai_responses 与 unknown（design D3）', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const notified: number[] = [];
    const proxy = await createMitmProxy({ db, port: 0, notify: (id) => notified.push(id) });
    const origin = await startOrigin((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_1' }));
    });
    try {
      await requestViaProxy(proxyAddressPort(proxy), origin.port, {
        path: '/v1/responses',
        host: 'api.openai.com',
        body: JSON.stringify({ model: 'gpt-4o', instructions: 'be brief', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] }),
      });
      await requestViaProxy(proxyAddressPort(proxy), origin.port, {
        path: '/somewhere',
        host: 'example.com',
        body: JSON.stringify({ foo: 1 }),
      });
      await waitFor(() => notified.length >= 2);

      const rows = db.prepare('SELECT id, request_format, parser_route FROM proxy_requests ORDER BY id').all() as Array<{
        id: number;
        request_format: string;
        parser_route: string | null;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.request_format).toBe('openai_responses');
      expect(rows[0]!.parser_route).toBe('openai');
      expect(rows[1]!.request_format).toBe('unknown');
    } finally {
      proxy.close();
      await origin.close();
      db.close();
    }
  });

  it('raw retention：keepRawBodies=true 写 raw 列；脱敏 request_body 不含 sentinel（NFR-S1 捕获侧）', async () => {
    const { db, notified, proxyPromise } = setupProxy({ keepRawBodies: true, captureGroupId: '00000000-0000-4000-8000-0000000000cc' });
    const origin = await startOrigin(anthropicHandler);
    const proxy = await proxyPromise;
    try {
      const sentinel = 'sk-RAWONLYSENTINEL1234567890';
      await requestViaProxy(proxyAddressPort(proxy), origin.port, {
        path: '/v1/messages',
        host: 'api.anthropic.com',
        body: JSON.stringify({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: sentinel }] }),
      });
      await waitFor(() => notified.length >= 1);

      const row = db.prepare('SELECT * FROM proxy_requests').all() as ProxyRow[];
      expect(row).toHaveLength(1);
      // 既有 writer 契约：raw 列与脱敏体同值写入（proxy-writer.test.ts 既定行为）。
      expect(row[0]!.raw_request_body).not.toBeNull();
      expect(row[0]!.raw_response_body).not.toBeNull();
      expect(row[0]!.request_body).not.toContain(sentinel);
      expect(row[0]!.request_body).toContain('sk-***');
    } finally {
      proxy.close();
      await origin.close();
      db.close();
    }
  });

  it('上游连接失败：仍写出部分捕获行，避免静默丢失且不重复写', async () => {
    const { db, notified, proxyPromise } = setupProxy({ captureGroupId: '00000000-0000-4000-8000-0000000000dd' });
    const deadPort = await freePort(); // 端口已释放：连接必然拒绝
    const proxy = await proxyPromise;
    try {
      await requestViaProxy(proxyAddressPort(proxy), deadPort, {
        path: '/v1/messages',
        host: 'api.anthropic.com',
        body: JSON.stringify({ model: ANTHROPIC_MODEL, messages: [] }),
      }).catch(() => undefined); // 客户端可能收到 504 或连接重置，均属预期
      await waitFor(() => notified.length >= 1);

      const rows = db.prepare('SELECT * FROM proxy_requests').all() as ProxyRow[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.capture_group_id).toBe('00000000-0000-4000-8000-0000000000dd');
      expect(rows[0]!.method).toBe('POST');
      expect(rows[0]!.request_format).toBe('anthropic_messages');
      // 没有成功响应：状态码为 0（writer 对缺失状态的既定行为）
      expect(rows[0]!.response_status).toBe(0);
    } finally {
      proxy.close();
      db.close();
    }
  });
});

/** createMitmProxy({ port: 0 }) 实际绑定的端口（http-mitm-proxy 内部 httpPort）。 */
function proxyAddressPort(proxy: ProxyServerLike): number {
  const httpPort = (proxy as unknown as { httpPort: number }).httpPort;
  expect(httpPort).toBeGreaterThan(0);
  return httpPort;
}
