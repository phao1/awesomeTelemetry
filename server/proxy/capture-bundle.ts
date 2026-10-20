import { createHash } from 'node:crypto';
import { fstat, type ReadStream, type Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CAPTURE_BUNDLE_MAX_FILE_BYTES, CAPTURE_BUNDLE_MAX_PLAN_BYTES } from '../../src/core/capture-bundle.js';
import type { CaptureBundleFile, CaptureBundlePlan, CaptureBundleReceipt } from '../../src/core/capture-bundle.js';
import type { CaptureBodyRef, CaptureEvidenceExport } from '../../src/core/trace-types.js';
import { sendApiError } from '../http/error-envelope.js';
import type { ErrorCode } from '../http/error-envelope.js';
import { CaptureExportLimitError, stringifyCaptureEvidenceExport } from './capture-export.js';
import type { CaptureBodyStore } from './body-store.js';

const README = Buffer.from(`AwesomeTelemetry original capture bundle v1\n\nThis archive contains one retained capture, not a complete Agent execution.\nevidence.json preserves bounded metadata/headers and first identity/link pages.\noriginals/*.body are exact retained ENCODED bytes, including AWSP1 for WebSockets.\nRead capture.request/response.status and transport/processing independently.\nMissing or interrupted original history cannot be reconstructed by this export.\nmanifest.json records expected SHA256/byte counts. Require receipt.json, verify\nits revision and compare every file's SHA256 and length before accepting a bundle.\nA missing receipt, interrupted HTTP download or hash mismatch is incomplete.\nThe receipt verifies transferred retained files, not complete network/Agent history.\nHeaders and originals may contain credentials. Keep the local archive private.\nNo model/tool was replayed, no collector uploaded and no native log copied.\nLater local deletion cannot revoke an already downloaded copy.\n`, 'utf8');
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const padding = (bytes: number) => (512 - bytes % 512) % 512;
const bodyStates = new Set(['complete', 'body_limit', 'quota_exceeded', 'queue_full', 'write_error', 'interrupted']);
export class CaptureBundleFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode) { super(code); this.status = status; this.code = code; }
}
function fail(status: number, code: ErrorCode): never { throw new CaptureBundleFailure(status, code); }
function checkRef(ref: CaptureBodyRef) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ref.id) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 ||
    ref.bytes > CAPTURE_BUNDLE_MAX_FILE_BYTES || !/^[0-9a-f]{64}$/.test(ref.sha256) || !bodyStates.has(ref.status)) fail(503, 'CAPTURE_EXPORT_LIMIT');
}
/** Fixed regular member names, standard ustar headers; no user paths/links. */
function header(path: string, bytes: number): Buffer {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > CAPTURE_BUNDLE_MAX_FILE_BYTES || !['manifest.json', 'evidence.json', 'README.txt', 'originals/request.body', 'originals/response.body', 'receipt.json'].includes(path)) fail(503, 'CAPTURE_EXPORT_LIMIT');
  const value = Buffer.alloc(512);
  value.write(path, 0, 100, 'ascii'); value.write('0000600\0', 100, 'ascii');
  value.write('0000000\0', 108, 'ascii'); value.write('0000000\0', 116, 'ascii');
  value.write(bytes.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  value.write('00000000000\0', 136, 'ascii'); value.fill(32, 148, 156);
  value.write('0', 156, 'ascii'); value.write('ustar\0', 257, 'ascii'); value.write('00', 263, 'ascii');
  value.write([...value].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return value;
}
interface Original { file: CaptureBundleFile; ref: CaptureBodyRef }
export interface CaptureBundleDependencies {
  snapshot: (id: number, generatedAt: string) => CaptureEvidenceExport | null;
  current: (id: number, requestId: string, refs: { request: CaptureBodyRef | null; response: CaptureBodyRef | null }, originals: boolean) => boolean;
  getStore: () => Promise<Pick<CaptureBodyStore, 'directory' | 'openRead'>>;
}

/** One service owner, no persistent/temp archive and no upstream execution. */
export class CaptureBundleExporter {
  private readonly deps: CaptureBundleDependencies;
  private readonly jobs = new Map<AbortController, Promise<void>>();
  private closed = false;
  constructor(deps: CaptureBundleDependencies) { this.deps = deps; }

  private prepare(id: number, mode: 'originals' | 'metadata', generatedAt: string) {
    if (this.closed) fail(503, 'SERVER_SHUTTING_DOWN');
    const snapshot = this.deps.snapshot(id, generatedAt);
    if (!snapshot) fail(404, 'PROXY_REQUEST_NOT_FOUND');
    if (mode === 'originals' && snapshot.originalDeletion) fail(409, 'CAPTURE_ORIGINALS_DELETED');
    const metadata = Buffer.from(stringifyCaptureEvidenceExport(snapshot));
    const files: CaptureBundleFile[] = [{ path: 'evidence.json', bytes: metadata.length, sha256: sha(metadata) }, { path: 'README.txt', bytes: README.length, sha256: sha(README) }];
    const originals: Original[] = [], omissions = ['bounded_metadata_pages', 'source_history_completeness_unknown', 'native_log_files_not_included', 'body_derived_analysis_not_included'];
    for (const direction of ['request', 'response'] as const) {
      const ref = snapshot.capture[direction];
      if (mode === 'metadata') { omissions.push(direction + '_original_excluded'); continue; }
      if (!ref) { omissions.push(direction + '_reference_missing'); continue; }
      checkRef(ref);
      const file = { path: 'originals/' + direction + '.body', bytes: ref.bytes, sha256: ref.sha256 };
      files.push(file); originals.push({ file, ref });
      if (ref.status !== 'complete') omissions.push(direction + '_retained_prefix:' + ref.status);
    }
    if (snapshot.identities.hasMore) omissions.push('identity_page_has_more');
    if (snapshot.traceLinks.hasMore) omissions.push('trace_link_page_has_more');
    const base = { format: 'awesome-telemetry.capture-bundle' as const, formatVersion: 1 as const, proxyId: id, requestId: snapshot.request.requestId,
      generatedAt, mode, files, originalBytes: originals.reduce((sum, item) => sum + item.ref.bytes, 0), omissions };
    const plan: CaptureBundlePlan = { ...base, revision: sha(Buffer.from(JSON.stringify(base))) };
    const manifest = Buffer.from(JSON.stringify(plan));
    const receipt: CaptureBundleReceipt = { format: 'awesome-telemetry.capture-bundle-receipt', formatVersion: 1, revision: plan.revision, integrity: 'verified_in_transfer',
      files: [...files, { path: 'manifest.json', bytes: manifest.length, sha256: sha(manifest) }] };
    const receiptBytes = Buffer.from(JSON.stringify(receipt));
    if (manifest.length > CAPTURE_BUNDLE_MAX_PLAN_BYTES || receiptBytes.length > CAPTURE_BUNDLE_MAX_PLAN_BYTES) fail(503, 'CAPTURE_EXPORT_LIMIT');
    return { plan, snapshot, metadata, originals, manifest, receiptBytes };
  }
  plan(id: number, mode: 'originals' | 'metadata', generatedAt = new Date().toISOString()): CaptureBundlePlan {
    return this.prepare(id, mode, generatedAt).plan;
  }

  async transfer(req: IncomingMessage, res: ServerResponse, id: number, mode: 'originals' | 'metadata', at: string, revision: string): Promise<void> {
    if (this.closed) { sendApiError(res, 503, 'SERVER_SHUTTING_DOWN', 'Capture bundle service is shutting down', undefined, req); return; }
    if (this.jobs.size >= 2) { sendApiError(res, 503, 'CAPTURE_BUNDLE_BUSY', 'Capture bundle transfers are busy', undefined, req); return; }
    const controller = new AbortController();
    // Defer work until its promise has entered the ownership map.
    const task = Promise.resolve().then(() => this.send(req, res, controller, id, mode, at, revision));
    this.jobs.set(controller, task);
    try { await task; } finally { this.jobs.delete(controller); }
  }
  private async send(req: IncomingMessage, res: ServerResponse, controller: AbortController, id: number, mode: 'originals' | 'metadata', at: string, revision: string) {
    const streams: ReadStream[] = [], signal = controller.signal;
    const abort = () => { if (!res.writableFinished) controller.abort(); };
    const abortSources = () => { for (const stream of streams) stream.destroy(); };
    const timer = setTimeout(() => controller.abort(), 120000); timer.unref();
    res.once('close', abort); signal.addEventListener('abort', abortSources);
    try {
      signal.throwIfAborted(); const prepared = this.prepare(id, mode, at);
      if (prepared.plan.revision !== revision) fail(409, 'CAPTURE_BUNDLE_CHANGED');
      const guard = () => {
        signal.throwIfAborted();
        if (!this.deps.current(id, prepared.plan.requestId, { request: prepared.snapshot.capture.request, response: prepared.snapshot.capture.response }, mode === 'originals')) fail(409, 'CAPTURE_BUNDLE_CHANGED');
      };
      guard();
      if (prepared.originals.length) {
        const store = await this.deps.getStore(); guard();
        for (const original of prepared.originals) {
          const info = await lstat(join(store.directory, original.ref.id + '.body')); guard();
          if (!info.isFile() || info.isSymbolicLink() || info.size !== original.ref.bytes) fail(503, 'CAPTURE_BUNDLE_UNAVAILABLE');
          const stream = store.openRead(original.ref.id); streams.push(stream); stream.on('error', () => { /* iterator/once owns errors; protect paused preflight streams */ });
          await once(stream, 'open'); guard();
          const actual = await new Promise<Stats>((resolve, reject) => fstat((stream as ReadStream & { fd: number }).fd, (error, stat) => error ? reject(error) : resolve(stat))); guard();
          if (!actual.isFile() || actual.ino !== info.ino || actual.dev !== info.dev || actual.size !== original.ref.bytes) fail(503, 'CAPTURE_BUNDLE_UNAVAILABLE');
        }
      }
      guard(); if (this.prepare(id, mode, at).plan.revision !== revision) fail(409, 'CAPTURE_BUNDLE_CHANGED');
      const initial = [{ path: 'manifest.json', value: prepared.manifest }, { path: 'evidence.json', value: prepared.metadata }, { path: 'README.txt', value: README }];
      const memberLength = (bytes: number) => 512 + bytes + padding(bytes);
      const length = initial.reduce((sum, item) => sum + memberLength(item.value.length), 0) + prepared.originals.reduce((sum, item) => sum + memberLength(item.ref.bytes), 0) + memberLength(prepared.receiptBytes.length) + 1024;
      async function* archive() {
        for (const item of initial) { guard(); yield header(item.path, item.value.length); yield item.value; yield Buffer.alloc(padding(item.value.length)); }
        for (let index = 0; index < prepared.originals.length; index++) {
          const original = prepared.originals[index]!, digest = createHash('sha256'); let bytes = 0;
          guard(); yield header(original.file.path, original.ref.bytes);
          for await (const value of streams[index]!) {
            guard(); const chunk = value as Buffer; bytes += chunk.length;
            if (bytes > original.ref.bytes) fail(503, 'CAPTURE_BUNDLE_UNAVAILABLE');
            digest.update(chunk); yield chunk;
          }
          guard(); if (bytes !== original.ref.bytes || digest.digest('hex') !== original.ref.sha256) fail(503, 'CAPTURE_BUNDLE_UNAVAILABLE');
          yield Buffer.alloc(padding(bytes));
        }
        guard(); yield header('receipt.json', prepared.receiptBytes.length); yield prepared.receiptBytes;
        yield Buffer.alloc(padding(prepared.receiptBytes.length)); guard(); yield Buffer.alloc(1024);
      }
      res.writeHead(200, { 'content-type': 'application/x-tar', 'content-disposition': `attachment; filename="capture-${id}.tar"`, 'cache-control': 'no-store', 'content-length': length });
      await pipeline(Readable.from(archive()), res, { signal });
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      const failure = error instanceof CaptureBundleFailure ? error : error instanceof CaptureExportLimitError ? new CaptureBundleFailure(503, 'CAPTURE_EXPORT_LIMIT') : new CaptureBundleFailure(503, 'CAPTURE_BUNDLE_UNAVAILABLE');
      sendApiError(res, failure.status, failure.code, 'Capture bundle is unavailable; prepare it again or inspect the retained source', undefined, req);
    } finally {
      clearTimeout(timer); res.off('close', abort); signal.removeEventListener('abort', abortSources);
      await Promise.all(streams.map(async stream => {
        if (stream.closed) return;
        const closed = new Promise<void>(resolve => stream.once('close', resolve)); stream.destroy(); await closed;
      }));
    }
  }
  async close(): Promise<void> {
    this.closed = true; for (const controller of this.jobs.keys()) controller.abort();
    await Promise.allSettled(this.jobs.values());
  }
}
