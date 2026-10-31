import type { Database } from 'better-sqlite3';
import { FridaStoreError, getFridaCapture, listFridaCaptures } from '../storage/frida-captures.js';
import type { Router, RouteHandler } from './router.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';

export function registerFridaCaptureRoutes(router: Router, db: Database): void {
  const bounded = (handler: RouteHandler): RouteHandler => async (req, res, params) => {
    try { await handler(req, res, params); }
    catch (error) {
      if (error instanceof FridaStoreError && error.reason === 'invalid') sendApiError(res, 400, 'BAD_REQUEST', 'Invalid Frida capture parameters', undefined, req);
      else sendApiError(res, 503, 'INTERNAL_ERROR', 'Frida capture unavailable', { reason: error instanceof FridaStoreError ? error.reason : 'storage_failed' }, req);
    }
  };
  router.register('GET', '/api/frida/captures', bounded((req, res) => {
    const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
    const limit = query.get('limit');
    if ([...query.keys()].some(key => key !== 'limit' && key !== 'cursor') || query.getAll('limit').length > 1 || query.getAll('cursor').length > 1 || (limit !== null && !/^[1-9]\d{0,2}$/.test(limit))) throw new FridaStoreError('invalid');
    sendJson(res, 200, listFridaCaptures(db, { limit: limit === null ? undefined : Number(limit), cursor: query.get('cursor') ?? undefined }), req);
  }));
  router.register('GET', '/api/frida/captures/:id', bounded((req, res, params) => {
    if (!/^[1-9]\d{0,15}$/.test(params.id ?? '')) throw new FridaStoreError('invalid');
    const capture = getFridaCapture(db, Number(params.id));
    if (capture === null) sendApiError(res, 404, 'ROUTE_NOT_FOUND', 'Frida capture not found', undefined, req);
    else sendJson(res, 200, capture, req);
  }));
}
