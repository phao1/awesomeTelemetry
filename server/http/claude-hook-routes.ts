import type { Router, RouteHandler } from './router.js';
import type { HookQuery } from '../storage/claude-hooks.js';
import type { ClaudeHookReceiver } from '../hooks/claude-receiver.js';
import { readHookJson } from '../hooks/claude-receiver.js';
import { ClaudeHookError } from '../hooks/claude-control.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';

const invalid = (): never => { throw new ClaudeHookError(400, 'BAD_REQUEST'); };
function positive(value: string): number {
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) return invalid();
  return Number(value);
}
/** Caller installs the existing local Host/Origin/foreground guard. */
export function registerClaudeHookRoutes(router: Router, receiver: ClaudeHookReceiver): void {
  const route = (handler: (args: Parameters<RouteHandler>, signal: AbortSignal) => Promise<void>): RouteHandler => async (...args) => {
    const [req, res] = args, controller = new AbortController(), abort = () => controller.abort();
    req.once('aborted', abort); res.once('close', abort); res.setHeader('cache-control', 'no-store');
    try { await handler(args, controller.signal); }
    catch (error) {
      if (!res.destroyed && !res.headersSent) {
        const failure = error instanceof ClaudeHookError ? error : new ClaudeHookError(503, 'HOOK_UNAVAILABLE');
        if (req.method === 'POST') res.setHeader('connection', 'close');
        sendApiError(res, failure.status, failure.code, failure.code, undefined, req);
      }
    } finally { req.off('aborted', abort); res.off('close', abort); }
  };
  const noQuery = (url: string | undefined) => { if ([...new URL(url ?? '/', 'http://127.0.0.1').searchParams].length) invalid(); };
  router.register('GET', '/api/hooks/claude/status', route(async ([req, res]) => { noQuery(req.url); sendJson(res, 200, await receiver.status(), req); }));
  router.register('POST', '/api/hooks/claude/configure', route(async ([req, res], signal) => {
    noQuery(req.url);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) invalid();
    const { value } = await readHookJson(req, 4096, signal);
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(key => !['expectedRevision','enabled','confirmRaw'].includes(key)) || !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0 || typeof v.enabled !== 'boolean' || v.confirmRaw !== undefined && typeof v.confirmRaw !== 'boolean') invalid();
    const result = await receiver.configure(v.expectedRevision as number, v.enabled as boolean, req.socket.localPort!, v.confirmRaw === true);
    if (!signal.aborted) sendJson(res, 200, result, req);
  }));
  router.register('POST', '/api/hooks/claude/events', route(async ([req, res], signal) => {
    noQuery(req.url); await receiver.receive(req, signal);
    if (!signal.aborted) { res.writeHead(204); res.end(); }
  }));
  router.register('GET', '/api/hooks/claude/events', route(async ([req, res]) => {
    const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
    if ([...params.keys()].some(key => !['limit','cursor','sessionId','toolUseId','agentId'].includes(key) || params.getAll(key).length !== 1)) invalid();
    const query: HookQuery = { limit: params.has('limit') ? positive(params.get('limit')!) : 50 };
    if (query.limit > 50) invalid(); if (params.has('cursor')) query.cursor = positive(params.get('cursor')!);
    for (const key of ['sessionId','toolUseId','agentId'] as const) if (params.has(key)) {
      const value = params.get(key)!; if (value.length > 512 || value.includes('\0') || key !== 'agentId' && !value.length) invalid(); query[key] = value;
    }
    if (query.agentId !== undefined && !query.sessionId || query.toolUseId !== undefined && (!query.sessionId || query.agentId === undefined)) invalid();
    sendJson(res, 200, await receiver.page(query), req);
  }));
  router.register('GET', '/api/hooks/claude/events/:id', route(async ([req, res, params], signal) => {
    noQuery(req.url); const value = await receiver.detail(positive(params.id ?? ''), signal); if (!signal.aborted) sendJson(res, 200, value, req);
  }));
}
