import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { CdpDevCaptureDetail, CdpDevCapturePage, CdpDevStatus } from '../src/core/trace-types.js';
import { sendApiError } from '../server/http/error-envelope.js';
import type { ErrorCode } from '../server/http/error-envelope.js';
import { sendJson } from '../server/http/send-json.js';
import { CDP_LIMITS } from '../server/proxy/cdp-capture.js';
import { CdpCaptureSession } from '../server/proxy/cdp-session.js';
import type { CdpCaptureSessionOptions } from '../server/proxy/cdp-session.js';

const MAX_RECORDS = 64, MAX_BYTES = 8 * 1024 * 1024, MAX_METADATA = 65536, MAX_DETAIL = 2 * 1024 * 1024;
const idle = (): CdpDevStatus => ({ state: 'idle', discovering: false, targetCount: 0, connectedTargetCount: 0 });
class ControlError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode, message: string) { super(message); this.status = status; this.code = code; }
}
function trusted(req: IncomingMessage): boolean {
  const local = (host: string) => ['127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1'].includes(host);
  try {
    if (!local(req.socket.remoteAddress ?? '') || !req.headers.host) return false;
    const host = new URL('http://' + req.headers.host);
    if (!local(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (req.headers.origin !== undefined) {
      const origin = new URL(req.headers.origin);
      if (origin.origin !== host.origin || req.headers.origin !== origin.origin) return false;
    }
    return true;
  } catch { return false; }
}
function readControl(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted);
      if (error) { req.resume(); reject(error); }
    };
    const bad = () => new ControlError(400, 'BAD_REQUEST', 'Expected a JSON object of at most 1024 bytes');
    const data = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024) finish(bad()); else chunks.push(chunk); };
    const end = () => {
      finish();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const value: unknown = text === '' ? {} : JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
        resolve(value as Record<string, unknown>);
      } catch { reject(bad()); }
    };
    const failed = () => finish(bad()), aborted = () => finish(bad());
    const timer = setTimeout(() => finish(bad()), 5000); timer.unref();
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
  });
}

/** Actual manager/HTTP owner. Dependencies inject transport only, never capture logic. */
export function createCdpDevController(options: Pick<CdpCaptureSessionOptions, 'discover' | 'webSocketFactory'> = {}) {
  let session: CdpCaptureSession | undefined, port = 9222, closed = false, sequence = 0;
  let totalBytes = 0, rejectedCount = 0, lastIssue: string | null = null;
  const records = new Map<number, CdpDevCaptureDetail>();
  const page = (): CdpDevCapturePage => ({
    items: [...records.values()].map(({ body: _body, ...summary }) => summary), totalBytes, rejectedCount, lastIssue,
  });
  const rejectCapture = () => { rejectedCount++; lastIssue = 'capture_limit'; };
  const status = () => session?.getStatus() ?? idle();
  const close = async () => { closed = true; await session?.stop(); };
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== '/api/cdp' && !path.startsWith('/api/cdp/')) { next(); return; }
    res.setHeader('cache-control', 'no-store');
    try {
      if (!trusted(req)) throw new ControlError(403, 'BAD_REQUEST', 'CDP requires a local same-origin request');
      if (closed) throw new ControlError(503, 'SERVER_SHUTTING_DOWN', 'Development CDP is shutting down');
      const send = (value: unknown) => { if (!res.destroyed) sendJson(res, 200, value, req); };
      if (req.method === 'GET') {
        if (path === '/api/cdp/status') { send(status()); return; }
        if (path === '/api/cdp/targets') { send({ items: session?.getTargets() ?? [] }); return; }
        if (path === '/api/cdp/captures') { send(page()); return; }
        if (path.startsWith('/api/cdp/captures/')) {
          const idText = path.slice('/api/cdp/captures/'.length), id = Number(idText);
          if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(id)) throw new ControlError(400, 'BAD_REQUEST', 'Invalid CDP capture ID');
          const capture = records.get(id);
          if (!capture) throw new ControlError(404, 'CDP_CAPTURE_NOT_FOUND', 'No retained development CDP response');
          send(capture); return;
        }
      }
      if (req.method === 'POST' && (path === '/api/cdp/start' || path === '/api/cdp/stop')) {
        const body = await readControl(req);
        if (closed) throw new ControlError(503, 'SERVER_SHUTTING_DOWN', 'Development CDP is shutting down');
        if (req.aborted || res.destroyed) return;
        if (path === '/api/cdp/stop') {
          if (Object.keys(body).length) throw new ControlError(400, 'BAD_REQUEST', 'Stop accepts only an empty object');
          await session?.stop(); send(status()); return;
        }
        const selectedPort = body.port ?? 9222;
        if (Object.keys(body).some(key => key !== 'port') || typeof selectedPort !== 'number' || !Number.isSafeInteger(selectedPort) || selectedPort < 1 || selectedPort > 65535 || body.port === null) {
          throw new ControlError(400, 'BAD_REQUEST', 'port must be an integer from 1 to 65535');
        }
        const state = status().state;
        if (state === 'stopping' || (state !== 'idle' && port !== selectedPort)) throw new ControlError(409, 'CDP_BUSY', 'Stop the current CDP manager before changing ports');
        if (!session || state === 'idle') {
          port = selectedPort;
          session = new CdpCaptureSession({ ...options, devOnly: true, port, onIssue: issue => { lastIssue = issue.code; } }, (entry, target) => {
            const bodyBytes = Buffer.byteLength(entry.body);
            const detail: CdpDevCaptureDetail = { id: sequence + 1, targetId: target.id, url: entry.url, capturedAt: new Date().toISOString(), bodyBytes, body: entry.body };
            const { body: _body, ...summary } = detail;
            if (closed || records.size >= MAX_RECORDS || bodyBytes > CDP_LIMITS.maxBodyBytes || totalBytes + bodyBytes > MAX_BYTES ||
              Buffer.byteLength(JSON.stringify(detail)) > MAX_DETAIL || Buffer.byteLength(JSON.stringify({ ...page(), items: [...page().items, summary] })) > MAX_METADATA - 1024) { rejectCapture(); return; }
            sequence++; totalBytes += bodyBytes; records.set(sequence, detail);
          });
        }
        await session.start(); send(status()); return;
      }
      throw new ControlError(404, 'ROUTE_NOT_FOUND', 'No development CDP route for this method and path');
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const fault = error instanceof ControlError ? error : new ControlError(503, 'CDP_UNAVAILABLE', 'Development CDP control failed');
      sendApiError(res, fault.status, fault.code, fault.message, undefined, req);
    }
  };
  return { handle, close };
}

/** Dev-only, before Vite's /api proxy; build and production own no CDP transport. */
export function localSessionsPlugin(): Plugin {
  let controller: ReturnType<typeof createCdpDevController> | undefined;
  return {
    name: 'local-development-cdp', apply: 'serve',
    configureServer(server) {
      controller = createCdpDevController();
      server.middlewares.use((req, res, next) => { void controller!.handle(req, res, next); });
      server.httpServer?.once('close', () => { void controller?.close(); });
    },
    async closeBundle() { await controller?.close(); },
  };
}
