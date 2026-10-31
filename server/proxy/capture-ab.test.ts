import { describe, expect, it } from 'vitest';
import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { addSseClient, sseResourceStatus } from '../realtime/sse.js';
import { captureStorageViolations, runCaptureAb, timingDistribution } from './capture-ab.js';

describe('actual direct/proxy forwarding A/B diagnostic', () => {
  it.each([
    { db: 199_999_999, wal: 0, violations: [] },
    { db: 200_000_000, wal: 0, violations: ['db_size'] },
    { db: 0, wal: 19_999_999, violations: [] },
    { db: 0, wal: 20_000_000, violations: ['wal_size'] },
    { db: 180_000_000, wal: 20_000_000, violations: ['db_size', 'wal_size'] },
  ])('enforces decimal hard limits at database=$db and WAL=$wal', ({ db, wal, violations }) => {
    expect(captureStorageViolations(db, wal)).toEqual(violations);
  });
  it('releases only owned SSE leases before asserting zero and tolerates late close events between runs', async () => {
    for (let index = 0; index < 3; index += 1) {
      const report = await runCaptureAb({ samples: 1, concurrency: 1, frameBytes: 32, frames: 2, intervalMs: 1, format: 'json' });
      expect(report.cleanup).toMatchObject({ verified: true, temporarySyntheticDataRemoved: true, sse: { sseClients: 0 } });
      await yieldTurn(); expect(sseResourceStatus().sseClients).toBe(0);
    }
  });
  it('retains completed raw samples and honest cleanup state on a real non-isolated subscriber failure', async () => {
    let release = (): void => {};
    const server = createServer((_req, res) => { release = addSseClient(res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    let connected!: () => void;
    const ready = new Promise<void>(resolve => { connected = resolve; });
    const subscriber = get({ host: '127.0.0.1', port: (server.address() as AddressInfo).port }, res => { res.on('error', () => {}); res.once('data', connected); res.resume(); });
    subscriber.on('error', () => {});
    try {
      await ready; expect(sseResourceStatus().sseClients).toBe(1);
      let failure: unknown;
      try { await runCaptureAb({ samples: 1, concurrency: 1, frameBytes: 32, frames: 2, intervalMs: 1, format: 'json' }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure).toMatchObject({ cause: { evidenceDirectory: null, report: {
        samples: [expect.objectContaining({ direct: expect.any(Object), proxy: expect.any(Object) })], integrity: { captures: 5 },
        cleanup: { verified: false, temporarySyntheticDataRemoved: true, sse: { sseClients: 1 } },
      } } });
      expect(sseResourceStatus().sseClients).toBe(1);
    } finally {
      release(); subscriber.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
    expect(sseResourceStatus().sseClients).toBe(0);
  });
  it.each(['identity', 'gzip', 'br', 'deflate'] as const)('preserves %s JSON request/response bytes, headers and original-backed semantics', async encoding => {
    const report = await runCaptureAb({ samples: 2, concurrency: 1, frameBytes: 32, frames: 2, intervalMs: 1, encoding, format: 'json' });
    expect(report.integrity).toMatchObject({ originCalls: 12, captures: 6, originalsVerified: 12, metadataSseEvents: 6, bodyBytesEqual: true, applicationHeadersEqual: true, protocolProjectionEqual: true, nativeInput: 3, nativeOutput: 2, projectedState: 'completed' });
    expect(report.budget.qualified).toBe(false); expect(report.samples).toHaveLength(2);
    expect(report.cleanup).toMatchObject({ verified: true, temporarySyntheticDataRemoved: true, resources: { queuedJobs: 0, queuedBytes: 0, previewCollectors: 0, previewBytes: 0, workers: 0 }, sse: { sseClients: 0 }, store: { activeBodies: 0, pendingBytes: 0 } });
  });
  it.each(['identity', 'gzip', 'br', 'deflate'] as const)('forwards %s SSE before a feedback-gated origin can finish, including Unicode/tool data', async encoding => {
    const report = await runCaptureAb({ samples: 2, concurrency: 1, frameBytes: 32, frames: 2, intervalMs: 1, encoding });
    expect(report.integrity).toMatchObject({ originCalls: 12, captures: 6, originalsVerified: 12, earlyDirect: 6, earlyProxy: 6, nativeInput: 3, nativeOutput: 2, projectedState: 'completed' });
    expect(report.budget.qualified).toBe(false);
  });
  it('validates both sides of a real HTTPS CONNECT A/B without disabling TLS verification', async () => {
    const report = await runCaptureAb({ samples: 2, concurrency: 1, frameBytes: 32, frames: 2, intervalMs: 1, transport: 'https' });
    expect(report.config.transport).toBe('https'); expect(report.integrity).toMatchObject({ originCalls: 12, captures: 6, originalsVerified: 12, earlyDirect: 6, earlyProxy: 6, protocolProjectionEqual: true });
    expect(report.budget.qualified).toBe(false);
  });
  it.each(['reset', 'cancel', 'http_error'] as const)('propagates matching %s prefixes/status and independently saves the real transport outcome', async mode => {
    const report = await runCaptureAb({ samples: 2, concurrency: 1, frameBytes: 32, frames: 2, intervalMs: 1, mode });
    expect(report.integrity).toMatchObject({ originCalls: 12, captures: 6, originalsVerified: 12, bodyBytesEqual: true, protocolProjectionEqual: true, projectedState: mode === 'http_error' ? 'failed' : 'incomplete' });
    expect(report.budget.qualified).toBe(false);
  });
  it('retains negative paired deltas and never labels smoke samples performance-qualified', () => {
    expect(timingDistribution([-4, -3, 1, 8])).toEqual({ p50: -3, p95: 8, max: 8 });
    expect(() => timingDistribution([])).toThrow(RangeError);
    expect(() => timingDistribution([NaN])).toThrow(RangeError);
  });
});
