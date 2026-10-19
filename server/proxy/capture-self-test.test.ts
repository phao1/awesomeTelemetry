import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonitorConnectionProfile } from '../../src/core/trace-types.js';
import { eventBus } from '../realtime/event-bus.js';
import { openWritable } from '../storage/db.js';
import { getProxyRequestById } from '../storage/query-engine.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureSelfTester } from './capture-self-test.js';
import { readCaptureBodies, writeCaptureProcessing } from './capture-storage.js';
import { ProxyRuntime } from './controller.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-self-test-'));
  const db = openWritable(join(directory, 'state.sqlite'));
  const store = await CaptureBodyStore.create(join(directory, 'bodies'));
  const runtime = new ProxyRuntime(db, () => {}, { bodyStore: async () => store, caDirectory: join(directory, 'ca') });
  const tester = new CaptureSelfTester(db, runtime, async () => store);
  const portFinder = createServer(); await new Promise<void>(resolve => portFinder.listen(0, '127.0.0.1', resolve));
  const port = (portFinder.address() as AddressInfo).port; await new Promise<void>(resolve => portFinder.close(() => resolve()));
  const profile: MonitorConnectionProfile = { id: '00000000-0000-4000-8000-000000000001', revision: 1,
    label: 'Synthetic', agent: 'claude', projectDirectory: directory, executable: null, proxyPort: port, noProxy: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return { db, store, runtime, tester, profile, async start() { runtime.start({ port }); await runtime.waitUntilReady(); }, async close() {
    await tester.close(); if (runtime.status().running || runtime.status().diagnostics?.cleanupPending) await runtime.stop();
    db.close(); await rm(directory, { recursive: true, force: true });
  } };
}

describe('real local capture pipeline self-test', () => {
  it('requires the matching running listener and does not start it implicitly', async () => {
    const f = await fixture(); try {
      await expect(f.tester.run(f.profile)).rejects.toMatchObject({ code: 'MONITOR_SELF_TEST_NOT_READY' });
      expect(f.runtime.status().running).toBe(false);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
      await f.start(); await expect(f.tester.run({ ...f.profile, proxyPort: f.profile.proxyPort + 1 })).rejects.toMatchObject({ code: 'MONITOR_SELF_TEST_NOT_READY' });
    } finally { await f.close(); }
  });

  it('uses actual HTTP/SSE forwarding, committed worker metadata and both original files without Agent identity', async () => {
    const f = await fixture(); const subscriptions = eventBus.totalListenerCount(); try {
      await f.start(); const result = await f.tester.run(f.profile);
      expect(result).toMatchObject({ profileId: f.profile.id, profileRevision: 1, passed: true, synthetic: true,
        scope: 'local_http_sse', agentVerified: false, tlsVerified: false,
        checks: { forwarding: true, persistence: true, originals: true, parsing: true } });
      expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
      const row = getProxyRequestById(f.db, result.proxyId)!;
      expect(row.model).toBe('agent-observe-self-test'); expect(row.url).toContain('agent_observe_self_test=');
      expect(row.responseBody).toContain('本地抓包自检'); expect(row.parsedSessionId).toBeNull();
      const refs = readCaptureBodies(f.db, result.proxyId); expect(refs.request?.status).toBe('complete'); expect(refs.response?.status).toBe('complete');
      expect(refs.processing?.status).toBe('ok'); expect(refs.transport?.state).toBe('completed');
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 1 });
      expect(f.runtime.status().running).toBe(true); expect(eventBus.totalListenerCount()).toBe(subscriptions);
    } finally { await f.close(); }
  });

  it('rejects concurrent jobs, aborts and cleans its own subscription without stopping the shared proxy', async () => {
    const f = await fixture(); const subscriptions = eventBus.totalListenerCount(); try {
      await f.start(); const controller = new AbortController(); const job = f.tester.run(f.profile, controller.signal);
      await expect(f.tester.run(f.profile)).rejects.toMatchObject({ code: 'MONITOR_SELF_TEST_BUSY' });
      controller.abort(); await expect(job).rejects.toMatchObject({ code: 'MONITOR_SELF_TEST_FAILED' });
      expect(eventBus.totalListenerCount()).toBe(subscriptions); expect(f.runtime.status().running).toBe(true);
      const retry = await f.tester.run(f.profile); expect(retry.passed).toBe(true);
    } finally { await f.close(); }
  });

  it('server close cancels owned work and rejects future admission', async () => {
    const f = await fixture(); const subscriptions = eventBus.totalListenerCount(); try {
      await f.start(); const job = f.tester.run(f.profile); const rejected = expect(job).rejects.toMatchObject({ code: 'MONITOR_SELF_TEST_FAILED' });
      await f.tester.close(); await rejected;
      expect(eventBus.totalListenerCount()).toBe(subscriptions);
      await expect(f.tester.run(f.profile)).rejects.toMatchObject({ code: 'SERVER_SHUTTING_DOWN' });
    } finally { await f.close(); }
  });

  it('does not report green when actual saved processing metadata is degraded', async () => {
    const f = await fixture();
    const off = eventBus.on('proxy_request', event => { if (event.item?.model === 'agent-observe-self-test') writeCaptureProcessing(f.db, event.id, { version: 1, status: 'worker_error', error: 'SYNTHETIC_FAULT' }); });
    try {
      await f.start(); const result = await f.tester.run(f.profile);
      expect(result.passed).toBe(false); expect(result.checks).toEqual({ forwarding: true, persistence: true, originals: true, parsing: false });
    } finally { off(); await f.close(); }
  });

  it('checks actual original files instead of trusting complete reference metadata', async () => {
    const f = await fixture(); let proxyId = 0;
    const off = eventBus.on('proxy_request', event => { if (event.item?.model === 'agent-observe-self-test') proxyId = event.id; });
    const corrupted = new CaptureSelfTester(f.db, f.runtime, async () => {
      const ref = readCaptureBodies(f.db, proxyId).response!;
      await writeFile(join(f.store.directory, ref.id + '.body'), 'CORRUPTED_SYNTHETIC_FIXTURE'); return f.store;
    });
    try {
      await f.start(); const result = await corrupted.run(f.profile);
      expect(result.passed).toBe(false); expect(result.checks).toEqual({ forwarding: true, persistence: true, originals: false, parsing: true });
      expect(readCaptureBodies(f.db, proxyId).response?.status).toBe('complete');
    } finally { off(); await corrupted.close(); await f.close(); }
  });
});
