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

  constructor(init: RequestContextInit, counter = 0) {
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

  get streamedBody(): string {
    return this.chunks.join('');
  }

  completeRequest(status: number, completedAt?: string): {
    durationMs: number;
    body: string;
  } {
    this.responseStatus = status;
    const end = Date.parse(completedAt ?? new Date().toISOString());
    const start = Date.parse(this.startedAt);
    const durationMs = Math.max(0, end - start);
    return { durationMs, body: this.chunks.length > 0 ? this.streamedBody : this.body };
  }
}
