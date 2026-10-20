// Internal dev-only helper; see openspec/contracts/cdp-capture-flow.md.
// Chromium Network does not observe/decrypt Trae TTNet (G6.5).
export interface CdpTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}
export interface CdpCaptureEntry { url: string; body: string }
export type CdpIssueCode =
  | 'invalid_message' | 'resource_limit' | 'request_timeout' | 'ambiguous_request'
  | 'loading_failed' | 'http_error' | 'command_error' | 'command_timeout'
  | 'connection_error' | 'connection_timeout' | 'disconnected' | 'invalid_body'
  | 'callback_error' | 'discovery_error' | 'target_limit';
export interface CdpCaptureIssue {
  code: CdpIssueCode;
  requestId: string | null;
  commandId: number | null;
}
export type CdpWebSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onerror' | 'onclose' | 'send' | 'close'>;
export interface CdpCaptureOptions {
  signal?: AbortSignal;
  webSocketFactory?: (url: string) => CdpWebSocket;
  onIssue?: (issue: CdpCaptureIssue) => void;
  onDisconnect?: () => void;
}
export interface CdpDiscoveryOptions {
  signal?: AbortSignal;
  fetch?: typeof fetch;
}
export const CDP_LIMITS = Object.freeze({
  connectTimeoutMs: 5000, commandTimeoutMs: 5000, requestTimeoutMs: 30000,
  discoveryTimeoutMs: 5000, discoveryIntervalMs: 10000, maxTargets: 16,
  maxDiscoveryTargets: 64, maxDiscoveryBytes: 65536, maxRequests: 256,
  maxSeenRequestIds: 4096, maxPendingCommands: 128, maxBodyBytes: 1048576,
  maxMessageBytes: 8388608, maxUrlChars: 4096, maxIdChars: 256,
});

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function socketUrl(value: string, port?: number): boolean {
  try {
    const url = new URL(value);
    return value.length <= CDP_LIMITS.maxUrlChars && ['ws:', 'wss:'].includes(url.protocol)
      && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.hash
      && (port === undefined || Number(url.port || (url.protocol === 'ws:' ? 80 : 443)) === port);
  } catch { return false; }
}

/** Bounded loopback discovery. Never starts an application or debugging port. */
export async function discoverCdpTargets(port = 9222, options: CdpDiscoveryOptions = {}): Promise<CdpTarget[]> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
  if (options.signal?.aborted) throw new Error('CDP discovery aborted');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, CDP_LIMITS.discoveryTimeoutMs);
  timer.unref?.();
  let rejectAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error('CDP discovery aborted'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    const fetching = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('CDP discovery aborted');
      return (options.fetch ?? fetch)(`http://127.0.0.1:${port}/json`, {
        signal: controller.signal, redirect: 'error',
      });
    }).then((res) => {
      // A dependency may resolve after abort; it never transfers body ownership.
      if (controller.signal.aborted) {
        void res.body?.cancel().catch(() => undefined);
        throw new Error('CDP discovery aborted');
      }
      return res;
    });
    const res = await Promise.race([fetching, aborted]);
    if (!res.ok || !res.body) {
      void res.body?.cancel().catch(() => undefined);
      throw new Error('CDP discovery failed');
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), aborted]);
        if (controller.signal.aborted) throw new Error('CDP discovery aborted');
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > CDP_LIMITS.maxDiscoveryBytes) throw new Error('CDP discovery limit');
        chunks.push(chunk.value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!Array.isArray(body) || body.length > CDP_LIMITS.maxDiscoveryTargets) throw new Error('Invalid CDP targets');
    const targets: CdpTarget[] = [];
    for (const item of body) {
      const t = object(item);
      if (!t || !boundedString(t.id, CDP_LIMITS.maxIdChars)
        || typeof t.title !== 'string' || t.title.length > CDP_LIMITS.maxUrlChars
        || typeof t.url !== 'string' || t.url.length > CDP_LIMITS.maxUrlChars
        || typeof t.webSocketDebuggerUrl !== 'string' || !socketUrl(t.webSocketDebuggerUrl, port)) continue;
      targets.push({ id: t.id, title: t.title, url: t.url, webSocketDebuggerUrl: t.webSocketDebuggerUrl });
    }
    return targets;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectAbort);
    options.signal?.removeEventListener('abort', abort);
  }
}

interface RequestState {
  id: string;
  url?: string;
  responseUrl?: string;
  status?: number;
  finished: boolean;
  commandId?: number;
  timer: ReturnType<typeof setTimeout>;
}
interface Command {
  method: 'Network.enable' | 'Page.enable' | 'Network.getResponseBody';
  request?: RequestState;
  timer: ReturnType<typeof setTimeout>;
}

/** Resolves only after both enable ACKs. Optional dependencies keep tests off real browsers. */
export async function connectCdpCapture(
  target: CdpTarget,
  onCapture: (entry: CdpCaptureEntry) => void,
  options: CdpCaptureOptions = {},
): Promise<() => void> {
  if (options.signal?.aborted) throw new Error('CDP stopped');
  if (!socketUrl(target.webSocketDebuggerUrl)) throw new Error('Invalid CDP socket URL');
  const ws = options.webSocketFactory
    ? options.webSocketFactory(target.webSocketDebuggerUrl)
    : new WebSocket(target.webSocketDebuggerUrl);
  const requests = new Map<string, RequestState>();
  const seen = new Set<string>();
  const pending = new Map<number, Command>();
  let nextCommandId = 0;
  let active = true;
  let ready = false;
  let opened = false;
  let enableAcks = 0;
  let resolveReady: (stop: () => void) => void;
  let rejectReady: (error: Error) => void;
  const readiness = new Promise<() => void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const report = (code: CdpIssueCode, requestId: string | null = null, commandId: number | null = null) => {
    try { options.onIssue?.({ code, requestId, commandId }); } catch { /* diagnostics cannot break cleanup */ }
  };
  const connectTimer = setTimeout(() => shutdown('connection_timeout'), CDP_LIMITS.connectTimeoutMs);
  connectTimer.unref?.();
  function shutdown(code?: CdpIssueCode) {
    if (!active) return;
    active = false;
    clearTimeout(connectTimer);
    for (const req of requests.values()) clearTimeout(req.timer);
    for (const cmd of pending.values()) clearTimeout(cmd.timer);
    requests.clear(); seen.clear(); pending.clear();
    options.signal?.removeEventListener('abort', stop);
    ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
    try { ws.close(); } catch { /* already closed/connecting; ownership is detached */ }
    if (!ready) rejectReady(new Error(code ?? 'CDP stopped'));
    if (code) {
      report(code);
      try { options.onDisconnect?.(); } catch { report('callback_error'); }
    }
  }
  function stop() { shutdown(); }
  function retire(req: RequestState, code?: CdpIssueCode) {
    clearTimeout(req.timer);
    if (req.commandId !== undefined) {
      const command = pending.get(req.commandId);
      if (command) clearTimeout(command.timer);
      pending.delete(req.commandId);
    }
    requests.delete(req.id);
    if (code) report(code, req.id, req.commandId ?? null);
  }
  function getRequest(id: string): RequestState | undefined {
    const current = requests.get(id);
    if (current) return current;
    if (seen.has(id)) return undefined;
    if (requests.size >= CDP_LIMITS.maxRequests || seen.size >= CDP_LIMITS.maxSeenRequestIds) {
      shutdown('resource_limit');
      return undefined;
    }
    seen.add(id);
    const req: RequestState = {
      id, finished: false,
      timer: setTimeout(() => retire(req, 'request_timeout'), CDP_LIMITS.requestTimeoutMs),
    };
    req.timer.unref?.();
    requests.set(id, req);
    return req;
  }
  function command(method: Command['method'], req?: RequestState) {
    if (!active) return;
    if (pending.size >= CDP_LIMITS.maxPendingCommands || nextCommandId >= Number.MAX_SAFE_INTEGER) {
      shutdown('resource_limit'); return;
    }
    const id = ++nextCommandId;
    const timer = setTimeout(() => {
      pending.delete(id);
      if (req) retire(req, 'command_timeout');
      else shutdown('command_timeout');
    }, CDP_LIMITS.commandTimeoutMs);
    timer.unref?.();
    pending.set(id, { method, request: req, timer });
    if (req) req.commandId = id;
    const params = req ? { requestId: req.id } : method === 'Network.enable' ? {
      maxTotalBufferSize: 16 * 1024 * 1024,
      maxResourceBufferSize: CDP_LIMITS.maxBodyBytes,
      maxPostDataSize: 0,
    } : undefined;
    try { ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}) })); }
    catch { shutdown('connection_error'); }
  }
  function maybeBody(req: RequestState) {
    if (!active || !ready || req.commandId !== undefined || !req.finished || !req.url || !req.responseUrl) return;
    if (req.url !== req.responseUrl) { retire(req, 'ambiguous_request'); return; }
    command('Network.getResponseBody', req);
  }
  function reply(msg: Record<string, unknown>) {
    if (typeof msg.id !== 'number' || !Number.isSafeInteger(msg.id)) { shutdown('invalid_message'); return; }
    const cmd = pending.get(msg.id);
    if (!cmd) return; // late, duplicate or unknown command result
    pending.delete(msg.id);
    clearTimeout(cmd.timer);
    const result = object(msg.result);
    if (msg.error !== undefined || !result) {
      if (cmd.request) retire(cmd.request, 'command_error');
      else shutdown('command_error');
      return;
    }
    if (!cmd.request) {
      enableAcks++;
      if (enableAcks === 2) {
        ready = true;
        resolveReady(stop);
        for (const req of requests.values()) maybeBody(req);
      }
      return;
    }
    const req = cmd.request;
    if (requests.get(req.id) !== req) return;
    if (typeof result.body !== 'string' || typeof result.base64Encoded !== 'boolean') {
      retire(req, 'invalid_body'); return;
    }
    let body: string;
    try {
      if (result.base64Encoded) {
        // Buffer.from(base64) is permissive; canonical roundtrip rejects invalid input.
        if (result.body.length > Math.ceil(CDP_LIMITS.maxBodyBytes / 3) * 4) throw new Error('limit');
        const bytes = Buffer.from(result.body, 'base64');
        if (bytes.length > CDP_LIMITS.maxBodyBytes || bytes.toString('base64') !== result.body) throw new Error('base64');
        body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } else {
        if (Buffer.byteLength(result.body, 'utf8') > CDP_LIMITS.maxBodyBytes) throw new Error('limit');
        body = result.body;
      }
    } catch { retire(req, 'invalid_body'); return; }
    const url = req.url;
    retire(req);
    if (url && active) {
      try { onCapture({ url, body }); } catch { report('callback_error', req.id, msg.id); }
    }
  }
  function network(method: string, params: Record<string, unknown>) {
    if (!boundedString(params.requestId, CDP_LIMITS.maxIdChars)) { shutdown('invalid_message'); return; }
    const id = params.requestId;
    const req = getRequest(id);
    if (!req) return;
    if (method === 'Network.loadingFailed') { retire(req, 'loading_failed'); return; }
    if (method === 'Network.requestWillBeSent') {
      const url = object(params.request)?.url;
      if (!boundedString(url, CDP_LIMITS.maxUrlChars)) { retire(req, 'invalid_message'); return; }
      if (params.redirectResponse !== undefined) {
        const redirect = object(params.redirectResponse);
        if (!req.url || redirect?.url !== req.url || req.finished || req.commandId !== undefined) {
          retire(req, 'ambiguous_request'); return;
        }
        req.responseUrl = undefined; req.status = undefined;
      } else if (req.url !== undefined) { retire(req, 'ambiguous_request'); return; }
      req.url = url;
    } else if (method === 'Network.responseReceived') {
      const response = object(params.response);
      const url = response?.url;
      const status = response?.status;
      if (!boundedString(url, CDP_LIMITS.maxUrlChars) || typeof status !== 'number'
        || !Number.isInteger(status) || status < 100 || status > 599) {
        retire(req, 'invalid_message'); return;
      }
      if (status >= 400) { retire(req, 'http_error'); return; }
      if (req.responseUrl !== undefined && (req.responseUrl !== url || req.status !== status)) {
        retire(req, 'ambiguous_request'); return;
      }
      req.responseUrl = url; req.status = status;
    } else req.finished = true;
    if (req.url && req.responseUrl && req.url !== req.responseUrl) { retire(req, 'ambiguous_request'); return; }
    maybeBody(req);
  }
  ws.onmessage = (event) => {
    if (!active) return;
    if (typeof event.data !== 'string' || event.data.length > CDP_LIMITS.maxMessageBytes
      || Buffer.byteLength(event.data, 'utf8') > CDP_LIMITS.maxMessageBytes) {
      shutdown('invalid_message'); return;
    }
    let msg: Record<string, unknown> | undefined;
    try { msg = object(JSON.parse(event.data)); } catch { shutdown('invalid_message'); return; }
    if (!msg) { shutdown('invalid_message'); return; }
    if (msg.id !== undefined) { reply(msg); return; }
    if (typeof msg.method !== 'string') { shutdown('invalid_message'); return; }
    if (!['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'].includes(msg.method)) return;
    const params = object(msg.params);
    if (!params) { shutdown('invalid_message'); return; }
    network(msg.method, params);
  };
  ws.onopen = () => {
    if (!active || opened) return;
    opened = true;
    clearTimeout(connectTimer);
    command('Network.enable');
    command('Page.enable');
  };
  ws.onerror = () => shutdown('connection_error');
  ws.onclose = () => shutdown('disconnected');
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();
  return readiness;
}
