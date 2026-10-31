import { setTimeout, clearTimeout } from 'node:timers';
import type { IncomingMessage } from 'node:http';
import type { ExperimentRegistry } from '../experiments/registry.js';
import { ExperimentError, objectFields } from '../experiments/registry.js';
import type { Router, RouteHandler } from './router.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';

async function readMutation(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ExperimentError('INVALID');
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const cleanup = (): void => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const error = (): void => { cleanup(); reject(new ExperimentError('INVALID')); };
    const aborted = (): void => { error(); };
    const data = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > 20 * 1024) { cleanup(); req.resume(); reject(new ExperimentError('LIMIT', 413)); return; }
      chunks.push(chunk);
    };
    const end = (): void => {
      cleanup();
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown); }
      catch { reject(new ExperimentError('INVALID')); }
    };
    const timer = setTimeout(() => { cleanup(); req.resume(); reject(new ExperimentError('INVALID')); }, 5000);
    timer.unref();
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
}

/** Caller MUST install the existing loopback Host/Origin and foreground guard. */
export function registerExperimentRoutes(router: Router, registry: ExperimentRegistry,
  existingScanKeys: (keys: string[]) => Promise<string[]> | string[]): void {
  const guard = (handler: RouteHandler): RouteHandler => async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    try { await handler(req, res, params); }
    catch (error) {
      const err = error instanceof ExperimentError ? error : new ExperimentError('UNAVAILABLE', 503);
      sendApiError(res, err.status, err.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST', err.message, { reason: err.reason }, req);
    }
  };
  router.register('GET', '/api/experiment-records', guard(async (req, res) => { sendJson(res, 200, await registry.list(), req); }));
  for (const [method, action] of [['POST', 'create'], ['PUT', 'update'], ['DELETE', 'delete']] as const) {
    router.register(method, `/api/experiment-records${action === 'create' ? '' : '/:id'}`, guard(async (req, res, params) => {
      const body = objectFields(await readMutation(req), action === 'delete' ? ['confirmed', 'expectedRevision'] : ['confirmed', 'expectedRevision', 'record']);
      if (body.confirmed !== true) throw new ExperimentError('INVALID');
      const result = await registry.mutate(action, params.id ?? null, body.expectedRevision, body.record, existingScanKeys);
      sendJson(res, action === 'create' ? 201 : 200, result, req);
    }));
  }
}
