import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink, symlink } from 'node:fs/promises';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import type { CaptureBundlePlan, CaptureBundleReceipt } from '../../src/core/capture-bundle.js';
import type { CaptureBodyRef } from '../../src/core/trace-types.js';
import { createAgentObservabilityServer } from '../server.js';
import { openWritable } from '../storage/db.js';
import { writeCaptureBodies } from '../proxy/capture-storage.js';

const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const resources: Array<() => Promise<void>> = [];
afterEach(async () => { try { for (const close of resources.splice(0).reverse()) await close(); } finally { vi.useRealTimers(); } });
async function call(port: number, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; file?: string } = {}) {
  return new Promise<{ status: number; bytes: Buffer; complete: boolean; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...options.headers } }, res => {
      const chunks: Buffer[] = [];
      if (options.file && res.statusCode === 200) {
        void pipeline(res, createWriteStream(options.file)).then(() => resolve({ status: 200, bytes: Buffer.alloc(0), complete: true, headers: res.headers }), reject); return;
      }
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      const finish = (complete: boolean) => resolve({ status: res.statusCode ?? 0, bytes: Buffer.concat(chunks), complete, headers: res.headers });
      res.once('end', () => finish(true)); res.once('aborted', () => finish(false)); res.on('error', () => finish(false));
    }); req.once('error', reject); req.end(body);
  });
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'capture-bundle-')), bodies = join(directory, 'bodies'); await mkdir(bodies);
  const db = openWritable(join(directory, 'state.sqlite'));
  const requestBytes = gzipSync(Buffer.from('SYNTHETIC 中文 request\0'.repeat(25000)));
  const responseBytes = Buffer.from('SYNTHETIC binary response\0\u00ff'.repeat(100000));
  const ref = (bytes: Buffer): CaptureBodyRef => ({ id: randomUUID(), bytes: bytes.length, sha256: sha(bytes), status: 'complete', error: null });
  const requestRef = ref(requestBytes), responseRef = ref(responseBytes);
  await writeFile(join(bodies, requestRef.id + '.body'), requestBytes); await writeFile(join(bodies, responseRef.id + '.body'), responseBytes);
  const id = Number(db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,started_at,completed_at,duration_ms,request_format,request_headers,response_status,content_type)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-bundle', 'POST', 'https://synthetic.invalid/v1/messages?original=kept', 'synthetic.invalid', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:01.000Z', 1000, 'anthropic_messages',
    JSON.stringify({ authorization: 'SYNTHETIC_CREDENTIAL_UNCHANGED', 'content-encoding': 'gzip' }), 200, 'application/octet-stream').lastInsertRowid);
  const update = () => writeCaptureBodies(db, id, { request: requestRef, response: responseRef, requestPreviewTruncated: true, responsePreviewTruncated: true, responseHeaders: { 'x-synthetic': 'UNREDACTED_RESPONSE_HEADER' } }); update();
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(provider => { provider.enabled = false; provider.path = join(directory, 'no-scans'); });
  const server = createAgentObservabilityServer({ db, config, captureDirectory: bodies, userConfigPath: join(directory, 'config.json'), caDirectory: join(directory, 'ca') });
  resources.push(async () => { try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } finally { db.close(); await rm(directory, { recursive: true, force: true }); } });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const port = (server.address() as AddressInfo).port, path = `/api/proxy/requests/${id}/bundle`;
  const plan = async (mode = 'originals') => { const response = await call(port, path + '/manifest?mode=' + mode); expect(response.status).toBe(200); return JSON.parse(response.bytes.toString()) as CaptureBundlePlan; };
  const url = (plan: CaptureBundlePlan) => path + '?' + new URLSearchParams({ mode: plan.mode, at: plan.generatedAt, revision: plan.revision });
  return { directory, bodies, db, server, id, port, path, plan, url, requestBytes, responseBytes, requestRef, responseRef, update };
}
async function hashFile(path: string): Promise<string> {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest('hex');
}
describe('CB-001..005 real capture bundle routes', () => {
  it('prepares metadata only, then streams exact encoded originals in a tar readable by an independent system reader', async () => {
    const f = await fixture(); const changes = f.db.prepare('SELECT total_changes() AS n').get();
    const plan = await f.plan(); expect(plan.originalBytes).toBe(f.requestRef.bytes + f.responseRef.bytes);
    expect(JSON.stringify(plan)).not.toContain('SYNTHETIC_CREDENTIAL'); expect(plan.files).toHaveLength(4);
    const archive = join(f.directory, 'capture.tar'), response = await call(f.port, f.url(plan), { file: archive });
    expect(response.complete).toBe(true); expect(response.headers['content-type']).toBe('application/x-tar'); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toBe(`attachment; filename="capture-${f.id}.tar"`);
    const list = await promisify(execFile)('tar', ['-tf', archive]);
    expect(list.stdout.trim().split('\n')).toEqual(['manifest.json', 'evidence.json', 'README.txt', 'originals/request.body', 'originals/response.body', 'receipt.json']);
    const extracted = join(f.directory, 'extracted'); await mkdir(extracted); await promisify(execFile)('tar', ['-xf', archive, '-C', extracted]);
    // Compare the complete extracted bytes, without generic object traversal
    // of millions of Buffer indices in the DOM test environment.
    expect((await readFile(join(extracted, 'originals/request.body'))).equals(f.requestBytes)).toBe(true);
    expect((await readFile(join(extracted, 'originals/response.body'))).equals(f.responseBytes)).toBe(true);
    expect(JSON.parse(await readFile(join(extracted, 'manifest.json'), 'utf8'))).toEqual(plan);
    const receipt = JSON.parse(await readFile(join(extracted, 'receipt.json'), 'utf8')) as CaptureBundleReceipt;
    expect(receipt.integrity).toBe('verified_in_transfer'); expect(receipt.revision).toBe(plan.revision);
    for (const file of receipt.files) expect(await hashFile(join(extracted, file.path)), file.path).toBe(file.sha256);
    const metadata = await readFile(join(extracted, 'evidence.json'), 'utf8'); expect(metadata).toContain('SYNTHETIC_CREDENTIAL_UNCHANGED'); expect(metadata).toContain('UNREDACTED_RESPONSE_HEADER');
    expect(metadata).not.toContain(f.directory); expect(JSON.parse(metadata).analysis).toBeNull(); expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
  });
  it('preserves retained-prefix status and absence without empty placeholder originals', async () => {
    const f = await fixture(); f.responseRef.status = 'interrupted'; f.update();
    let plan = await f.plan(); expect(plan.omissions).toContain('response_retained_prefix:interrupted');
    writeCaptureBodies(f.db, f.id, { request: f.requestRef, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
    plan = await f.plan(); expect(plan.omissions).toContain('response_reference_missing'); expect(plan.files.some(file => file.path === 'originals/response.body')).toBe(false);
    expect((await call(f.port, f.url(plan))).complete).toBe(true);
  });
  it('binds an exact metadata revision and rejects source changes before attachment', async () => {
    const f = await fixture(), plan = await f.plan();
    f.db.prepare('UPDATE proxy_requests SET request_headers=? WHERE id=?').run('{"x-new":"changed"}', f.id);
    const changed = await call(f.port, f.url(plan)); expect(changed.status).toBe(409); expect(JSON.parse(changed.bytes.toString()).error.code).toBe('CAPTURE_BUNDLE_CHANGED'); expect(changed.headers['content-disposition']).toBeUndefined();
  });
  it('does not open files for preparation or metadata export and blocks originals after confirmed deletion', async () => {
    const f = await fixture(), plan = await f.plan();
    const deleted = await call(f.port, `/api/proxy/requests/${f.id}/original-deletion`, { method: 'POST', body: { expectedRequestId: 'synthetic-bundle', confirm: true } }); expect(deleted.status).toBe(200);
    expect((await call(f.port, f.url(plan))).status).toBe(409);
    const denied = await call(f.port, f.path + '/manifest'); expect(denied.status).toBe(409); expect(JSON.parse(denied.bytes.toString()).error.code).toBe('CAPTURE_ORIGINALS_DELETED');
    const metadata = await f.plan('metadata'); expect(metadata.originalBytes).toBe(0); expect(metadata.files).toHaveLength(2);
    const result = await call(f.port, f.url(metadata)); expect(result.status).toBe(200); expect(result.complete).toBe(true); expect(result.bytes.toString()).not.toContain('SYNTHETIC binary response');
  });
  it('fails visibly for missing/nonregular files and rejects altered bytes without a final integrity receipt', async () => {
    // Revisions bind generatedAt as well as metadata. Freeze only the clock so
    // the unchanged-metadata assertion does not depend on a millisecond race.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    const f = await fixture(), plan = await f.plan(); const source = join(f.bodies, f.responseRef.id + '.body');
    await unlink(source); expect((await f.plan()).revision).toBe(plan.revision);
    expect((await call(f.port, f.url(plan))).status).toBe(503);
    await writeFile(source, Buffer.alloc(f.responseRef.bytes, 65));
    const corrupt = await call(f.port, f.url(plan)); expect(corrupt.status).toBe(200); expect(corrupt.complete).toBe(false); expect(corrupt.bytes.toString()).not.toContain('"integrity":"verified_in_transfer"');
    await unlink(source); await symlink(join(f.bodies, f.requestRef.id + '.body'), source);
    expect((await call(f.port, f.url(plan))).status).toBe(503);
    const metadata = await f.plan('metadata'); expect((await call(f.port, f.url(metadata))).complete).toBe(true);
  });
  it('validates canonical IDs/query/timestamps and local access before starting attachments', async () => {
    const f = await fixture();
    for (const suffix of ['/manifest?mode=invalid', '/manifest?mode=metadata&mode=metadata', '?at=bad&revision=' + 'a'.repeat(64), '?at=9999-99-99T00:00:00.000Z&revision=' + 'a'.repeat(64), '?extra=1', '']) {
      expect((await call(f.port, f.path + suffix)).status, suffix).toBe(400);
    }
    expect((await call(f.port, '/api/proxy/requests/0/bundle/manifest')).status).toBe(400);
    expect((await call(f.port, '/api/proxy/requests/99999/bundle/manifest')).status).toBe(404);
    for (const suffix of ['/manifest', '?' + new URLSearchParams({ at: '2026-10-20T00:00:00.000Z', revision: 'a'.repeat(64) })]) {
      const response = await call(f.port, f.path + suffix, { headers: { host: 'untrusted.invalid' } }); expect(response.status).toBe(400); expect(response.headers['content-disposition']).toBeUndefined();
    }
  });
  it('exports an actual 100MiB original beyond analysis limits without a source buffer or archive spool', async () => {
    const f = await fixture(), block = Buffer.alloc(1024 * 1024, 67), digest = createHash('sha256');
    async function* source() { for (let index = 0; index < 100; index++) { digest.update(block); yield block; } }
    await pipeline(Readable.from(source()), createWriteStream(join(f.bodies, f.responseRef.id + '.body')));
    f.responseRef.bytes = 100 * 1024 * 1024; f.responseRef.sha256 = digest.digest('hex'); f.update();
    const plan = await f.plan(), archive = join(f.directory, 'large.tar'); expect(plan.originalBytes).toBe(f.responseRef.bytes + f.requestRef.bytes);
    expect((await call(f.port, f.url(plan), { file: archive })).complete).toBe(true);
    const extracted = join(f.directory, 'large'); await mkdir(extracted); await promisify(execFile)('tar', ['-xf', archive, '-C', extracted]);
    expect(await hashFile(join(extracted, 'originals/response.body'))).toBe(f.responseRef.sha256);
    expect(JSON.parse(await readFile(join(extracted, 'receipt.json'), 'utf8')).integrity).toBe('verified_in_transfer');
  });
});
