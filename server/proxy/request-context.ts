import { StringDecoder } from 'node:string_decoder';
import type { CaptureResources } from './capture-resources.js';

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
  private readonly startedMonotonic = performance.now();
  private transportEnd: { completedAt: string; durationMs: number } | null = null;

  constructor(init: RequestContextInit, counter = 0, resources?: CaptureResources) {
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

  appendResponseBytes(chunk: Buffer): void {
    this.responseObserved += chunk.length;
    if (this.previewResourceLimited) return;
    const accepted = this.responseBytes.append(chunk); this.responseAccepted += accepted;
    this.responsePreviewTruncated ||= accepted < chunk.length;
    if (this.responseBytes.budgetLimited) { this.limitResources(); return; }
    const remaining = Math.max(0, 64 * 1024 - this.responsePreviewBytes);
    const part = chunk.subarray(0, remaining);
    this.responseDisplayTruncated ||= part.length < chunk.length;
    this.responsePreviewBytes += part.length;
    const text = this.responseDecoder.write(part);
    if (text !== '') this.appendChunk(text);
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

  get previewDroppedBytes(): { request: number; response: number } {
    return { request: this.requestObserved - this.requestAccepted, response: this.responseObserved - this.responseAccepted };
  }
  releaseRawPreviews(): void { this.requestBytes.clear(); this.responseBytes.clear(); }
  releasePreviews(): void {
    this.releaseRawPreviews(); this.body = ''; this.chunks.length = 0;
    this.collectorRelease?.(); this.collectorRelease = null;
  }
  private limitResources(): void {
    if (this.previewResourceLimited) return;
    this.previewResourceLimited = true; this.resources?.notePreviewLimit();
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
    this.transportEnd ??= { completedAt: new Date().toISOString(), durationMs: Math.max(0, Math.round(performance.now() - this.startedMonotonic)) };
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
