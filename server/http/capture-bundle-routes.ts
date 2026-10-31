import type { Router } from './router.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';
import { CaptureBundleFailure } from '../proxy/capture-bundle.js';
import type { CaptureBundleExporter } from '../proxy/capture-bundle.js';
import { CaptureExportLimitError } from '../proxy/capture-export.js';

/** Caller dispatches after its existing local/foreground guard. */
export function registerCaptureBundleRoutes(router: Router, exporter: CaptureBundleExporter): void {
  for (const preview of [true, false]) router.register('GET', '/api/proxy/requests/:id/bundle' + (preview ? '/manifest' : ''), async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    try {
      const id = Number(params.id), query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
      const allowed = preview ? ['mode'] : ['mode', 'at', 'revision'];
      if (!/^[1-9]\d*$/.test(params.id ?? '') || !Number.isSafeInteger(id) || [...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) throw new CaptureBundleFailure(400, 'BAD_REQUEST');
      const mode = query.get('mode') ?? 'originals';
      if (mode !== 'originals' && mode !== 'metadata') throw new CaptureBundleFailure(400, 'BAD_REQUEST');
      if (preview) { sendJson(res, 200, exporter.plan(id, mode), req); return; }
      const at = query.get('at') ?? '', revision = query.get('revision') ?? '';
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at || !/^[0-9a-f]{64}$/.test(revision)) throw new CaptureBundleFailure(400, 'BAD_REQUEST');
      await exporter.transfer(req, res, id, mode, at, revision);
    } catch (error) {
      if (res.destroyed || res.headersSent) { if (!res.destroyed) res.destroy(); return; }
      const fault = error instanceof CaptureBundleFailure ? error : error instanceof CaptureExportLimitError ? new CaptureBundleFailure(503, 'CAPTURE_EXPORT_LIMIT') : new CaptureBundleFailure(503, 'CAPTURE_BUNDLE_UNAVAILABLE');
      sendApiError(res, fault.status, fault.code, 'Capture bundle request could not be prepared', undefined, req);
    }
  });
}
