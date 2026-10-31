import { StringDecoder } from 'node:string_decoder';
import type { CaptureResources } from './capture-resources.js';
import type { CaptureNetworkTiming } from '../../src/core/trace-types.js';
import { ARRIVAL_BYTES, ARRIVAL_POINT_LIMIT, type ResponseArrivalTimeline } from './network-timing.js';

/** Fixed-size blocks prevent one retained object per tiny network chunk. */
class BytePreview {
  private blocks: Buffer[] = [];
  private size = 0;
  private charged = 0;
  budgetLimited = false;
  private readonly resources?: CaptureResources;
  constructor(resources?: CaptureResources) { this.resources = resources; }
  append(chunk: Buffer): number {
    const length = Math.min(chunk.length, 2 * 1024 * 1024 - this.size);
    let offset = 0;
    while (offset < length) {
      const blockIndex = Math.floor(this.size / 16384), position = this.size % 16384;
      if (this.blocks[blockIndex] === undefined) {
        if (this.resources !== undefined && !this.resources.reservePreview(32768)) { this.budgetLimited = true; break; }
        if (this.resources !== undefined) this.charged += 32768;
        this.blocks[blockIndex] = Buffer.allocUnsafeSlow(16384);
      }
      const block = this.blocks[blockIndex]!;
      const count = Math.min(length - offset, block.length - position);
      chunk.copy(block, position, offset, offset + count); this.size += count; offset += count;
    }
    return offset;
  }
  take(): Uint8Array {
    const bytes = new Uint8Array(this.size);
    let offset = 0;
    for (const block of this.blocks) { const count = Math.min(block.length, bytes.length - offset); bytes.set(block.subarray(0, count), offset); offset += count; }
    this.blocks = []; this.size = 0; return bytes;
  }
  clear(): void { this.blocks = []; this.size = 0; this.resources?.releasePreview(this.charged); this.charged = 0; }
}

/** REQ-006：TTNet 加密检测（x-tt-encrypt-* 头）。 */
export function hasTtnetEncryption(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase().startsWith('x-tt-encrypt-'));
}

export interface RequestContextInit {
  method: string;
  url: string;
  hostname: string;
  headers: Record<string, string>;
  startedAt?: string;
  requestId?: string;
}

/**
 * REQ-011：单请求生命周期跟踪。
 * requestId 格式 req-{timestamp}-{counter}。
 */
export class RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly url: string;
  readonly hostname: string;
  readonly headers: Record<string, string>;
  readonly startedAt: string;
  readonly ttnetEncrypted: boolean;
  body = '';
  responseStatus: number | null = null;
  readonly chunks: string[] = [];
  private readonly requestDecoder = new StringDecoder('utf8');
  private readonly responseDecoder = new StringDecoder('utf8');
  private requestEnded = false;
  private responseEnded = false;
  private requestPreviewBytes = 0;
  private responsePreviewBytes = 0;
  private readonly requestBytes: BytePreview;
  private readonly responseBytes: BytePreview;
  private collectorRelease: (() => void) | null = null;
  private readonly resources?: CaptureResources;
  private requestObserved = 0;
  private responseObserved = 0;
  private requestAccepted = 0;
  private responseAccepted = 0;
  previewResourceLimited = false;
  private requestDisplayTruncated = false;
  private responseDisplayTruncated = false;
  requestPreviewTruncated = false;
  responsePreviewTruncated = false;
  private readonly startedMonotonic: number;
  private readonly monotonic: () => number;
  private headersMs: number | null = null;
  private bodyByteMs: number | null = null;
  private completedMs: number | null = null;
  private serverTiming: string | null = null;
  private serverTimingTruncated = false;
  private arrivalOffsets: Uint32Array | null = null;
  private arrivalElapsed: Float64Array | null = null;
  private arrivalCount = 0;
  private arrivalCharge = 0;
  private arrivalLimited = false;
  private arrivalTaken = false;
  private transportEnd: { completedAt: string; durationMs: number } | null = null;

  constructor(init: RequestContextInit, counter = 0, resources?: CaptureResources, monotonic: () => number = () => performance.now()) {
    this.monotonic = monotonic; this.startedMonotonic = monotonic();
    this.resources = resources;
    this.requestBytes = new BytePreview(resources); this.responseBytes = new BytePreview(resources);
    if (resources !== undefined) {
      this.collectorRelease = resources.acquireCollector();
      if (this.collectorRelease === null) this.limitResources();
    }
    this.requestId = init.requestId ?? `req-${Date.now()}-${counter}`;
    this.method = init.method;
    this.url = init.url;
    this.hostname = init.hostname;
    this.headers = init.headers;
    this.startedAt = init.startedAt ?? new Date().toISOString();
    this.ttnetEncrypted = hasTtnetEncryption(init.headers);
  }

  /** REQ-003：SSE 流式 chunk 累积。 */
  appendChunk(chunk: string): void {
    this.chunks.push(chunk);
  }

  appendRequestBytes(chunk: Buffer): void {
    this.requestObserved += chunk.length;
    if (this.previewResourceLimited) return;
    const accepted = this.requestBytes.append(chunk); this.requestAccepted += accepted;
    this.requestPreviewTruncated ||= accepted < chunk.length;
    if (this.requestBytes.budgetLimited) { this.limitResources(); return; }
    const remaining = Math.max(0, 64 * 1024 - this.requestPreviewBytes);
    const part = chunk.subarray(0, remaining);
    this.requestDisplayTruncated ||= part.length < chunk.length;
    this.requestPreviewBytes += part.length;
    this.body += this.requestDecoder.write(part);
  }

  finishRequestBody(): void {
    if (this.requestEnded) return;
    this.requestEnded = true;
    if (!this.requestDisplayTruncated) this.body += this.requestDecoder.end();
  }

  appendResponseBytes(chunk: Buffer): string {
    const elapsed = this.elapsed();
    if (chunk.length > 0) this.bodyByteMs ??= elapsed;
    this.responseObserved += chunk.length;
    if (this.previewResourceLimited) { this.arrivalLimited ||= chunk.length > 0; return ''; }
    const accepted = this.responseBytes.append(chunk); this.responseAccepted += accepted;
    this.responsePreviewTruncated ||= accepted < chunk.length;
    if (this.responseBytes.budgetLimited) { this.limitResources(); return ''; }
    if (accepted > 0) this.recordArrival(this.responseAccepted, elapsed);
    this.arrivalLimited ||= accepted < chunk.length;
    const remaining = Math.max(0, 64 * 1024 - this.responsePreviewBytes);
    const part = chunk.subarray(0, remaining);
    this.responseDisplayTruncated ||= part.length < chunk.length;
    this.responsePreviewBytes += part.length;
    const text = this.responseDecoder.write(part);
    if (text !== '') this.appendChunk(text);
    return text;
  }

  finishResponseBody(): void {
    if (this.responseEnded) return;
    this.responseEnded = true;
    const text = this.responseDisplayTruncated ? '' : this.responseDecoder.end();
    if (text !== '') this.appendChunk(text);
  }

  get streamedBody(): string {
    return this.chunks.join('');
  }

  takeBytePreviews(): { requestBytes: Uint8Array; responseBytes: Uint8Array } {
    return { requestBytes: this.requestBytes.take(), responseBytes: this.responseBytes.take() };
  }

  markResponseHeaders(headers: Record<string, string | string[]>): void {
    if (this.headersMs !== null) return;
    this.headersMs = this.elapsed();
    const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'server-timing')?.[1];
    const raw = Array.isArray(value) ? value.join(',') : value;
    this.serverTiming = raw === undefined ? null : raw.slice(0, 512);
    this.serverTimingTruncated = raw !== undefined && raw.length > 512;
  }

  networkTiming(): CaptureNetworkTiming {
    const ms = (value: number | null): number | null => value === null ? null : Math.round(value);
    return { version: 1, clock: 'proxy_monotonic', responseHeadersMs: ms(this.headersMs), firstBodyByteMs: ms(this.bodyByteMs),
      firstContentMs: null, firstContentKind: null, firstContentBasis: null, completedMs: ms(this.completedMs),
      contentTimingStatus: this.arrivalLimited ? 'preview_limit' : 'not_collected', serverTiming: this.serverTiming, serverTimingTruncated: this.serverTimingTruncated };
  }

  /** Transfer ownership logically; the processor clones before worker transfer. */
  takeResponseTimeline(): ResponseArrivalTimeline | undefined {
    if (this.arrivalTaken || this.arrivalOffsets === null && !this.arrivalLimited) return undefined;
    this.arrivalTaken = true;
    const result = { offsets: this.arrivalOffsets ?? new Uint32Array(0), elapsedMs: this.arrivalElapsed ?? new Float64Array(0),
      count: this.arrivalCount, limited: this.arrivalLimited };
    this.arrivalOffsets = null; this.arrivalElapsed = null;
    return result;
  }

  private elapsed(): number { return Math.max(0, this.monotonic() - this.startedMonotonic); }

  private recordArrival(offset: number, elapsed: number): void {
    if (this.arrivalLimited || this.arrivalTaken) return;
    if (this.arrivalCount >= ARRIVAL_POINT_LIMIT) { this.arrivalLimited = true; return; }
    if (this.arrivalOffsets === null) {
      if (this.resources !== undefined && !this.resources.reservePreview(ARRIVAL_BYTES)) { this.arrivalLimited = true; return; }
      this.arrivalCharge = this.resources === undefined ? 0 : ARRIVAL_BYTES;
      this.arrivalOffsets = new Uint32Array(ARRIVAL_POINT_LIMIT); this.arrivalElapsed = new Float64Array(ARRIVAL_POINT_LIMIT);
    }
    this.arrivalOffsets[this.arrivalCount] = offset; this.arrivalElapsed![this.arrivalCount] = elapsed;
    this.arrivalCount += 1;
  }

  get previewDroppedBytes(): { request: number; response: number } {
    return { request: this.requestObserved - this.requestAccepted, response: this.responseObserved - this.responseAccepted };
  }
  releaseRawPreviews(): void {
    this.requestBytes.clear(); this.responseBytes.clear();
    this.arrivalOffsets = null; this.arrivalElapsed = null;
    this.resources?.releasePreview(this.arrivalCharge); this.arrivalCharge = 0;
  }
  releasePreviews(): void {
    this.releaseRawPreviews(); this.body = ''; this.chunks.length = 0;
    this.collectorRelease?.(); this.collectorRelease = null;
  }
  private limitResources(): void {
    if (this.previewResourceLimited) return;
    this.previewResourceLimited = true; this.resources?.notePreviewLimit();
    this.arrivalLimited = true;
    this.requestAccepted = 0; this.responseAccepted = 0;
    this.requestPreviewTruncated = true; this.responsePreviewTruncated = true;
    this.requestDisplayTruncated = true; this.responseDisplayTruncated = true;
    this.releasePreviews();
  }

  get displayPreviewsTruncated(): { request: boolean; response: boolean } {
    return { request: this.requestDisplayTruncated, response: this.responseDisplayTruncated };
  }

  /** Capture once at transport end, before worker queue/flush/SQLite latency. */
  markTransportEnd(): { completedAt: string; durationMs: number } {
    if (this.transportEnd === null) {
      this.completedMs = this.elapsed();
      this.transportEnd = { completedAt: new Date().toISOString(), durationMs: Math.round(this.completedMs) };
    }
    return { ...this.transportEnd };
  }

  completeRequest(status: number, completedAt?: string): {
    durationMs: number;
    body: string;
  } {
    this.responseStatus = status;
    const end = Date.parse(completedAt ?? new Date().toISOString());
    const start = Date.parse(this.startedAt);
    const durationMs = this.transportEnd?.durationMs ?? Math.max(0, end - start);
    return { durationMs, body: this.chunks.length > 0 ? this.streamedBody : this.body };
  }
}
