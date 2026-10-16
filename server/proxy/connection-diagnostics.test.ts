import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import type { MonitorConnectionProfile, ProxyRuntimeStatus } from '../../src/core/trace-types.js';
import { ensureInterceptCa } from './ca-manager.js';
import { inspectConnection } from './connection-diagnostics.js';

let directory: string, pem: string;
const profile: MonitorConnectionProfile = { id: '00000000-0000-4000-8000-000000000001', label: 'Synthetic', agent: 'claude', projectDirectory: '/synthetic/project', executable: null, proxyPort: 7779, noProxy: null, revision: 1, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' };
const idle = (): ProxyRuntimeStatus => ({ running: false, starting: false, port: null, requestCount: 99, startedAt: null, diagnostics: { phase: 'idle', runId: null, listening: false, cleanupPending: false, observedRequests: 0, activeRequests: 0, pendingWrites: 0, persistedRequests: 0, interruptedRequests: 0, captureErrors: 0, lastError: null, lastRequestAt: null } });
const listening = (): ProxyRuntimeStatus => ({ ...idle(), running: true, port: 7779, diagnostics: { ...idle().diagnostics!, phase: 'waiting_for_traffic', listening: true, runId: 'synthetic-run' } });
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'connection-diagnostics-')); pem = await ensureInterceptCa(join(directory, 'valid')); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('read-only connection evidence', () => {
  it('reports a missing CA/listener without creating files or counting historical requests as current traffic', async () => {
    const path = join(directory, 'missing');
    const report = await inspectConnection(profile, path, idle);
    expect(report).toMatchObject({ profileId: profile.id, profileRevision: 1, expectedPort: 7779, listener: 'idle', ca: { state: 'missing', sha256: null, validUntil: null }, traffic: { state: 'unavailable', scope: 'shared_listener' } });
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['listener_idle', 'ca_missing', 'trust_unverified']));
    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
    expect(await readdir(directory)).not.toContain('missing');
  });

  it('reports valid public certificate metadata without claiming OS/runtime/Agent trust', async () => {
    const path = join(directory, 'valid', 'certs', 'ca.pem');
    const original = await readFile(path);
    const report = await inspectConnection({ ...profile, agent: 'codex' }, join(directory, 'valid'), listening);
    expect(report.listener).toBe('listening');
    expect(report.ca.state).toBe('available');
    expect(report.ca.sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(new Date(report.ca.validUntil!).toISOString()).toBe(report.ca.validUntil);
    expect(report.trust).toEqual({ scope: 'selected_child_runtime', variable: 'CODEX_CA_CERTIFICATE', runtimeVerified: false, osTrust: 'not_checked' });
    expect(report.traffic.state).toBe('waiting');
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['traffic_waiting', 'transport_unverified', 'bypass_review']));
    expect(await readFile(path)).toEqual(original);
    expect(JSON.stringify(report)).not.toContain('BEGIN CERTIFICATE');
  });

  it('uses current-run shared traffic, never a per-profile or TLS verification claim', async () => {
    const status = listening();
    Object.assign(status.diagnostics!, { observedRequests: 2, persistedRequests: 1, activeRequests: 1, lastRequestAt: '2026-10-16T00:00:01.000Z', phase: 'capturing' });
    const report = await inspectConnection({ ...profile, noProxy: '' }, join(directory, 'valid'), () => status);
    expect(report.traffic).toEqual({ state: 'observed', scope: 'shared_listener' });
    expect(report.trust.runtimeVerified).toBe(false);
    expect(report.issues.some(issue => issue.code === 'shared_traffic')).toBe(true);
    expect(report.issues.some(issue => issue.code === 'bypass_review')).toBe(false);
    expect(report.status.diagnostics?.observedRequests).toBe(2);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(16 * 1024);
    for (const issue of report.issues) { expect(issue.message.length).toBeLessThanOrEqual(512); expect(issue.nextStep.length).toBeLessThanOrEqual(512); }
  });

  it.each(['starting', 'stopping', 'failed', 'port_conflict'] as const)('does not reuse old traffic while %s and gives a next step', async phase => {
    const status = listening();
    status.diagnostics!.observedRequests = 3;
    if (phase === 'starting') { status.running = false; status.starting = true; status.diagnostics!.phase = 'starting'; }
    if (phase === 'stopping') { status.running = false; status.diagnostics!.cleanupPending = true; status.diagnostics!.phase = 'stopping'; }
    if (phase === 'failed') { status.running = false; status.diagnostics!.phase = 'failed'; status.diagnostics!.lastError = 'EADDRINUSE'; }
    if (phase === 'port_conflict') status.port = 7780;
    const report = await inspectConnection(profile, join(directory, 'valid'), () => status);
    expect(report.listener).toBe(phase);
    expect(report.traffic.state).toBe('unavailable');
    expect(report.issues.every(issue => issue.nextStep.length > 0)).toBe(true);
    if (phase === 'failed') expect(report.issues.find(issue => issue.code === 'listener_failed')!.nextStep).toContain('EADDRINUSE');
  });

  it('keeps capture failures distinct from traffic arrival and legacy missing activity unknown', async () => {
    const status = listening();
    Object.assign(status.diagnostics!, { observedRequests: 1, captureErrors: 1, phase: 'degraded', lastError: 'PROXY_TRANSPORT_ERROR' });
    const report = await inspectConnection(profile, join(directory, 'valid'), () => status);
    expect(report.traffic.state).toBe('observed');
    expect(report.issues.find(issue => issue.code === 'capture_errors')?.severity).toBe('error');
    delete status.diagnostics;
    const legacy = await inspectConnection(profile, join(directory, 'valid'), () => status);
    expect(legacy.traffic.state).toBe('unavailable');
    expect(legacy.issues.map(issue => issue.code)).toContain('traffic_unavailable');
  });

  it('preserves malformed/oversized/symlinked/private-key CA evidence and returns a diagnostic, not an exception', async () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nsynthetic-not-a-key\n-----END PRIVATE KEY-----';
    for (const [name, content] of [['malformed', 'broken'], ['large', 'x'.repeat(65537)], ['private', `${pem}\n${privateKey}`]] as const) {
      const path = join(directory, name, 'certs'); await mkdir(path, { recursive: true });
      const file = join(path, 'ca.pem'); await writeFile(file, content);
      const report = await inspectConnection(profile, join(directory, name), idle);
      expect(report.ca).toEqual({ state: 'invalid', sha256: null, validUntil: null });
      expect(report.issues.map(issue => issue.code)).toContain('ca_invalid');
      expect(JSON.stringify(report)).not.toContain(privateKey);
      expect(await readFile(file, 'utf8')).toBe(content);
    }
    const path = join(directory, 'symlink', 'certs'); await mkdir(path, { recursive: true });
    await symlink(join(directory, 'valid', 'certs', 'ca.pem'), join(path, 'ca.pem'));
    expect((await inspectConnection(profile, join(directory, 'symlink'), idle)).ca.state).toBe('invalid');
  });

  it('rejects expired/non-CA public certificates even when PEM parsing succeeds', async () => {
    const root = forge.pki.certificateFromPem(pem);
    const key = forge.pki.privateKeyFromPem(await readFile(join(directory, 'valid', 'keys', 'ca.private.key'), 'utf8'));
    root.validity.notBefore = new Date(Date.now() - 2 * 86400000); root.validity.notAfter = new Date(Date.now() - 86400000);
    root.sign(key, forge.md.sha256.create());
    const path = join(directory, 'expired', 'certs'); await mkdir(path, { recursive: true }); await writeFile(join(path, 'ca.pem'), forge.pki.certificateToPem(root));
    expect((await inspectConnection(profile, join(directory, 'expired'), idle)).ca.state).toBe('invalid');
    root.validity.notAfter = new Date(Date.now() + 86400000); root.setExtensions([{ name: 'basicConstraints', cA: false }]); root.sign(key, forge.md.sha256.create());
    await writeFile(join(path, 'ca.pem'), forge.pki.certificateToPem(root));
    expect((await inspectConnection(profile, join(directory, 'expired'), idle)).ca.state).toBe('invalid');
  });
});
