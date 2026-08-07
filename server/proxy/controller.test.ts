import { describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import type { BusEvents } from '../../src/core/trace-types.js';
import { initSchema } from '../storage/schema.js';
import { ProxyRuntime, type ProxyRuntimeDeps } from './controller.js';
import type { MitmProxyOptions, ProxyServerLike } from './mitm-proxy.js';
import { parseProxyRequest } from './parser-router.js';
import { writeProxyRequest } from './proxy-writer.js';
import { RequestContext } from './request-context.js';

function fakeProxy(): ProxyServerLike {
  return {
    onRequest() {},
    onRequestData() {},
    onRequestEnd() {},
    onResponse() {},
    onResponseData() {},
    onResponseEnd() {},
    onError() {},
    listen(_opts, cb) {
      cb();
    },
    close() {},
  };
}

function setup(deps: ProxyRuntimeDeps) {
  const db = new Database(':memory:');
  initSchema(db);
  const emit = vi.fn<(payload: BusEvents['proxy_status']) => void>();
  const runtime = new ProxyRuntime(db, emit, deps);
  return { db, emit, runtime };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function anthropicParsed() {
  return parseProxyRequest({
    hostname: 'api.anthropic.com',
    url: '/v1/messages',
    requestBody: JSON.stringify({
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
}

describe('ProxyRuntime captureGroupId 生命周期（design D2 / tasks §3.1-§3.2）', () => {
  it('同一次成功 run 内所有行共享同一个 captureGroupId，stop 后清理', async () => {
    const created: MitmProxyOptions[] = [];
    const { db, runtime } = setup({
      uuid: () => '00000000-0000-4000-8000-0000000000aa',
      createProxy: async (opts) => {
        created.push(opts);
        return fakeProxy();
      },
    });

    runtime.start({ port: 0 });
    await waitFor(() => runtime.status().running);
    expect(created).toHaveLength(1);
    const groupId = created[0]?.captureGroupId ?? null;
    expect(groupId).not.toBeNull();
    expect(runtime.currentCaptureGroupId).toBe(groupId);

    // 模拟该 run 内连续三次请求写入：全部携带同一组 ID（同 run 稳定）
    for (let i = 0; i < 3; i += 1) {
      const ctx = new RequestContext(
        {
          method: 'POST',
          url: '/v1/messages',
          hostname: 'api.anthropic.com',
          headers: {},
        },
        i + 1,
      );
      writeProxyRequest({
        db,
        ctx,
        parsed: anthropicParsed(),
        desensitizedRequestBody: '{"messages":[]}',
        desensitizedResponseBody: null,
        contentType: 'application/json',
        isStreaming: false,
        captureMethod: 'mitm',
        captureGroupId: groupId,
      });
    }
    const rows = db
      .prepare('SELECT capture_group_id FROM proxy_requests ORDER BY id')
      .all() as Array<{ capture_group_id: string | null }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.capture_group_id).toBe(groupId);
    }

    runtime.stop();
    expect(runtime.currentCaptureGroupId).toBeNull();
    db.close();
  });

  it('重启后使用不同的 captureGroupId（重启轮换）', async () => {
    const seq = ['00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000cc'];
    const created: MitmProxyOptions[] = [];
    let i = 0;
    const { runtime } = setup({
      uuid: () => seq[i] ?? 'fallback',
      createProxy: async (opts) => {
        created.push(opts);
        return fakeProxy();
      },
    });

    runtime.start({ port: 0 });
    await waitFor(() => runtime.status().running);
    const first = created[0]?.captureGroupId ?? null;
    expect(first).toBe(seq[0]);

    runtime.stop();
    i += 1;
    runtime.start({ port: 0 });
    await waitFor(() => runtime.status().running);
    const second = created[1]?.captureGroupId ?? null;
    expect(second).toBe(seq[1]);
    expect(second).not.toBe(first);
    runtime.stop();
  });

  it('启动失败清理 captureGroupId：不暴露为活跃，失败组的 ID 不进入任何行', async () => {
    let fail = true;
    const created: MitmProxyOptions[] = [];
    const { db, runtime } = setup({
      uuid: () => (fail ? '00000000-0000-4000-8000-0000000000dd' : '00000000-0000-4000-8000-0000000000ee'),
      createProxy: async (opts) => {
        created.push(opts);
        if (fail) {
          throw new Error('EADDRINUSE: listen failed');
        }
        return fakeProxy();
      },
    });

    runtime.start({ port: 0 });
    await waitFor(() => !runtime.status().starting && !runtime.status().running);
    // 失败清理：不暴露为活跃
    expect(runtime.currentCaptureGroupId).toBeNull();
    expect(created).toHaveLength(1);

    // 修复后再次启动：新 UUID，且失败的组 ID 未写入任何行
    fail = false;
    runtime.start({ port: 0 });
    await waitFor(() => runtime.status().running);
    expect(runtime.currentCaptureGroupId).toBe('00000000-0000-4000-8000-0000000000ee');
    expect(created).toHaveLength(2);

    const ctx = new RequestContext(
      {
        method: 'POST',
        url: '/v1/messages',
        hostname: 'api.anthropic.com',
        headers: {},
      },
      1,
    );
    writeProxyRequest({
      db,
      ctx,
      parsed: anthropicParsed(),
      desensitizedRequestBody: '{"messages":[]}',
      desensitizedResponseBody: null,
      contentType: 'application/json',
      isStreaming: false,
      captureMethod: 'mitm',
      captureGroupId: created[1]?.captureGroupId ?? null,
    });
    const rows = db
      .prepare('SELECT capture_group_id FROM proxy_requests')
      .all() as Array<{ capture_group_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capture_group_id).toBe('00000000-0000-4000-8000-0000000000ee');
    db.close();
  });
});
