import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

import Database from 'better-sqlite3';

import type { BusEvents, ProxyCaptureActivity } from '../../src/core/trace-types.js';
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
  it('excludes start and concurrent maintenance synchronously, releasing ownership on success and failure', async () => {
    const { db, runtime } = setup({}); let release!: () => void;
    try {
      const work = runtime.withStoppedMonitor(() => new Promise<void>(resolve => { release = resolve; }));
      expect(() => runtime.start({})).toThrow('cleanup');
      await expect(runtime.withStoppedMonitor(async () => {})).rejects.toMatchObject({ code: 'PROXY_MAINTENANCE' });
      release(); await work;
      await expect(runtime.withStoppedMonitor(async () => { throw new Error('controlled failure'); })).rejects.toThrow('controlled failure');
      expect(await runtime.withStoppedMonitor(async () => 'released')).toBe('released');
    } finally { release?.(); db.close(); }
  });
  it('bounds readiness waits without polling or releasing a pending startup', async () => {
    let release!: (proxy: ProxyServerLike) => void;
    const { db, runtime } = setup({ createProxy: () => new Promise(resolve => { release = resolve; }) });
    runtime.start({ port: 19010 });
    await waitFor(() => release !== undefined);
    await expect(runtime.waitUntilReady(10)).rejects.toMatchObject({ code: 'MONITOR_NOT_READY' });
    expect(runtime.status()).toMatchObject({ starting: true, running: false, port: 19010 });
    release(fakeProxy());
    expect((await runtime.waitUntilReady()).running).toBe(true);
    await runtime.stop(); db.close();
  });

  it('rejects a cancelled readiness wait rather than authorizing launch into another run', async () => {
    let release!: (proxy: ProxyServerLike) => void;
    const { db, runtime } = setup({ createProxy: () => new Promise(resolve => { release = resolve; }) });
    runtime.start({ port: 19011 });
    await waitFor(() => release !== undefined);
    const ready = runtime.waitUntilReady();
    const stopped = runtime.stop();
    release(fakeProxy());
    await expect(ready).rejects.toMatchObject({ code: 'MONITOR_NOT_READY' });
    await stopped;
    expect(runtime.status().diagnostics?.phase).toBe('idle');
    db.close();
  });
  it('coalesces activity, does not poll status and ignores a closed run after restart', async () => {
    const created: MitmProxyOptions[] = [];
    const { db, runtime, emit } = setup({ createProxy: async options => { created.push(options); return fakeProxy(); } });
    runtime.start({ port: 19008 });
    await waitFor(() => runtime.status().running);
    const before = emit.mock.calls.length;
    const activity: ProxyCaptureActivity = { listening: true, observedRequests: 10, activeRequests: 2, pendingWrites: 1, persistedRequests: 7, interruptedRequests: 0, captureErrors: 0, lastRequestAt: '2026-10-16T00:00:00.000Z', lastError: null };
    for (let i = 0; i < 20; i += 1) created[0]!.onActivity!({ ...activity, observedRequests: i + 1 });
    expect(emit).toHaveBeenCalledTimes(before);
    await waitFor(() => emit.mock.calls.length > before);
    expect(emit).toHaveBeenCalledTimes(before + 1);
    expect(emit.mock.calls.at(-1)?.[0].diagnostics?.observedRequests).toBe(20);
    await runtime.stop();
    runtime.start({ port: 19009 });
    await waitFor(() => runtime.status().running);
    created[0]!.onActivity!({ ...activity, captureErrors: 3, lastError: 'OLD_RUN_ERROR' });
    expect(runtime.status().diagnostics).toMatchObject({ observedRequests: 0, captureErrors: 0, lastError: null });
    await runtime.stop();
    db.close();
  });
  it('a cancelled successful startup is closed before a replacement startup is allowed', async () => {
    const pending: Array<(proxy: ProxyServerLike) => void> = [];
    const { db, runtime } = setup({ createProxy: () => new Promise(resolve => pending.push(resolve)) });
    const old = fakeProxy(), current = fakeProxy();
    old.close = vi.fn(); current.close = vi.fn();
    runtime.start({ port: 19001 });
    await waitFor(() => pending.length === 1);
    const stopped = runtime.stop();
    expect(runtime.status().diagnostics).toMatchObject({ phase: 'stopping', cleanupPending: true });
    expect(() => runtime.start({ port: 19002 })).toThrow('代理已在运行或正在启动');
    pending[0]!(old);
    await stopped;
    expect(old.close).toHaveBeenCalledOnce();
    expect(runtime.status()).toMatchObject({ starting: false, running: false, port: null });
    runtime.start({ port: 19002 });
    await waitFor(() => pending.length === 2);
    pending[1]!(current);
    await waitFor(() => runtime.status().running);
    expect(runtime.status().port).toBe(19002);
    await runtime.stop();
    expect(current.close).toHaveBeenCalledOnce();
    db.close();
  });

  it('a cancelled failed startup is settled before a new run and cannot overwrite it', async () => {
    let rejectOld: (error: Error) => void = () => { throw new Error('not initialized'); };
    let call = 0;
    const { db, runtime, emit } = setup({ createProxy: () => {
      call += 1;
      return call === 1 ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve(fakeProxy());
    } });
    runtime.start({ port: 19003 });
    await waitFor(() => call === 1);
    const stopped = runtime.stop();
    expect(() => runtime.start({ port: 19004 })).toThrow();
    rejectOld(new Error('old bind failed'));
    await stopped;
    runtime.start({ port: 19004 });
    await waitFor(() => runtime.status().running);
    const count = emit.mock.calls.length;
    await Promise.resolve();
    expect(runtime.status()).toMatchObject({ running: true, port: 19004 });
    expect(emit).toHaveBeenCalledTimes(count);
    await runtime.stop(); db.close();
  });

  it('passes committed capture notifications into the actual proxy creation options', async () => {
    const notify = vi.fn();
    let created: MitmProxyOptions | undefined;
    const { db, runtime } = setup({ notify, createProxy: async options => { created = options; return fakeProxy(); } });
    runtime.start({ port: 19005 });
    await waitFor(() => runtime.status().running);
    created!.notify!(42);
    expect(notify).toHaveBeenCalledWith(42);
    await runtime.stop(); db.close();
  });
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

    await runtime.stop();
    expect(runtime.currentCaptureGroupId).toBeNull();
    db.close();
  });

  it('重启后使用不同的 captureGroupId（重启轮换）', async () => {
    const seq = ['00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000cc'];
    const created: MitmProxyOptions[] = [];
    let i = 0;
    const { runtime, db } = setup({
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

    await runtime.stop();
    i += 1;
    runtime.start({ port: 0 });
    await waitFor(() => runtime.status().running);
    const second = created[1]?.captureGroupId ?? null;
    expect(second).toBe(seq[1]);
    expect(second).not.toBe(first);
    await runtime.stop();
    db.close();
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
    await runtime.stop();
    db.close();
  });

  it('concurrent stops await one real cleanup; a deadline retains ownership and blocks restart', async () => {
    let release!: () => void;
    const proxy = fakeProxy();
    proxy.shutdown = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const { runtime, db } = setup({ createProxy: async () => proxy, stopTimeoutMs: 20 });
    runtime.start({ port: 19006 });
    await waitFor(() => runtime.status().running);
    expect(runtime.status().diagnostics).toMatchObject({ phase: 'waiting_for_traffic', observedRequests: 0 });
    const first = runtime.stop();
    expect(runtime.stop()).toBe(first);
    await expect(first).rejects.toMatchObject({ code: 'PROXY_STOP_FAILED' });
    expect(runtime.status().diagnostics).toMatchObject({ phase: 'failed', cleanupPending: true, lastError: 'PROXY_STOP_FAILED' });
    expect(() => runtime.start({})).toThrow();
    expect(proxy.shutdown).toHaveBeenCalledOnce();
    const retried = runtime.stop();
    release();
    await retried;
    expect(runtime.status().diagnostics).toMatchObject({ phase: 'idle', cleanupPending: false });
    expect(proxy.shutdown).toHaveBeenCalledOnce();
    db.close();
  });
});

// Real Frida parser + in-memory SQLite; only child transport is injected.
describe('Frida saved capture lifecycle', () => {
  async function setupFrida() {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    const { FridaRuntime } = await import('./controller.js');
    const { runFridaMonitor } = await import('./frida-capture.js');
    const db = new Database(':memory:'); initSchema(db);
    const processes: ChildProcess[] = [];
    const monitor: typeof runFridaMonitor = (pid, path, data, error) => runFridaMonitor(pid, path, data, error, () => {
      const child = new EventEmitter() as ChildProcess;
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = vi.fn(() => true); processes.push(child); return child;
    });
    const notify = vi.fn(), onError = vi.fn(), emit = vi.fn();
    const deps = { db, notify, onError, monitor, validateScript: async () => {}, uuid: () => 'synthetic-local-run', stopTimeoutMs: 20 };
    return { db, processes, notify, onError, emit, deps, runtime: new FridaRuntime(emit, deps), FridaRuntime };
  }
  it('notifies only after real commit, stops until close and rejects old-child callbacks/duplicate close', async () => {
    const { db, runtime, processes, notify, emit } = await setupFrida();
    try {
      await runtime.start({ pid: 12 }); const first = processes[0]!; first.emit('spawn');
      notify.mockImplementation(({ id }: { id: number }) => { expect(db.prepare('SELECT id FROM frida_captures WHERE id=?').get(id)).toBeDefined(); });
      first.stdout!.emit('data', Buffer.from('[NEW CHAT DATA]{"x":1}[END]')); expect(notify).toHaveBeenCalledExactlyOnceWith({ id: 1 });
      const stop = runtime.stop(); await Promise.resolve(); expect(runtime.status().running).toBe(true); await expect(runtime.start({ pid: 13 })).rejects.toThrow('cleanup');
      first.emit('close', 0); await stop; expect(runtime.status().running).toBe(false);
      await runtime.start({ pid: 13 }); const second = processes[1]!; second.emit('spawn'); const count = emit.mock.calls.length;
      first.emit('exit', 1); first.emit('close', 0); first.stdout!.emit('data', Buffer.from('[NEW CHAT DATA]{"old":1}[END]'));
      expect(emit).toHaveBeenCalledTimes(count); expect(runtime.status().pid).toBe(13); expect(notify).toHaveBeenCalledTimes(1);
      const final = runtime.stop(); await Promise.resolve(); second.emit('close', 0); await final;
    } finally { db.close(); }
  });
  it('write failure kills owned child and never publishes saved success', async () => {
    const { db, runtime, processes, notify, onError } = await setupFrida();
    try { await runtime.start({ pid: 12 }); const child = processes[0]!; child.emit('spawn'); db.exec('DROP TABLE frida_captures');
      child.stdout!.emit('data', Buffer.from('[NEW CHAT DATA]{"x":1}[END]')); expect(notify).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledTimes(1); expect(child.kill).toHaveBeenCalledTimes(1);
      child.emit('close', 1); expect(runtime.status().running).toBe(false);
    } finally { db.close(); }
  });
  it('malformed/incomplete data never becomes a saved capture', async () => {
    const { db, runtime, processes, notify, onError } = await setupFrida();
    try { await runtime.start({ pid: 12 }); const child = processes[0]!; child.emit('spawn'); child.stdout!.emit('data', Buffer.from('[NEW CHAT DATA]{bad}[END]')); child.emit('error', new Error('synthetic')); child.emit('close', 1);
      expect(notify).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledTimes(1); expect(db.prepare('SELECT id FROM frida_captures').all()).toEqual([]);
    } finally { db.close(); }
  });
  it('stop during discovery waits for ownership, rejects late target and does not spawn', async () => {
    const { db, deps, FridaRuntime, processes } = await setupFrida(); let resolve!: (pid: number) => void;
    const runtime = new FridaRuntime(vi.fn(), { ...deps, discover: () => new Promise(done => { resolve = done; }) });
    try { const start = runtime.start({}); const stop = runtime.stop(); await expect(runtime.start({ pid: 13 })).rejects.toThrow('cleanup'); resolve(12); await start; await stop; expect(processes).toHaveLength(0); expect(runtime.status()).toEqual({ running: false, starting: false, pid: null }); }
    finally { db.close(); }
  });
  it('stop timeout retains ownership and permits explicit retry after actual close', async () => {
    const { db, runtime, processes } = await setupFrida();
    try { await runtime.start({ pid: 12 }); const child = processes[0]!; child.emit('spawn'); await expect(runtime.stop()).rejects.toThrow('cleanup'); expect(runtime.status().running).toBe(true); await expect(runtime.start({ pid: 13 })).rejects.toThrow('cleanup');
      const retry = runtime.stop(); await Promise.resolve(); child.emit('close', 0); await retry; expect(runtime.status().pid).toBeNull();
    } finally { db.close(); }
  });
});
