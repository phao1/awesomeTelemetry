import { setTimeout, clearTimeout } from 'node:timers';
import { analyzeArchitectureDiagnosis, validateArchitectureThresholds } from '../../src/core/architecture-diagnosis-analysis.js';
import type { ArchitectureThresholds } from '../../src/core/architecture-diagnosis-types.js';
import { ArchitectureDiagnosisError, type ArchitectureDiagnosisCollector } from '../architecture-diagnosis/collector.js';
import { TaskReadError } from '../storage/task-workbench.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';
import type { Router } from './router.js';

const thresholdKeys: Array<keyof ArchitectureThresholds> = ['minSamples', 'minContextTokens', 'minContextChars', 'growthRatio', 'duplicateRatio', 'toolCatalogLimit', 'repeatedToolErrors', 'minHandoffAnchors'];
/** Caller installs the shared loopback Host/Origin and foreground guard before dispatch. */
export function registerArchitectureDiagnosisRoutes(router: Router, collector: ArchitectureDiagnosisCollector): () => void {
  let active: AbortController | null = null, closed = false;
  router.register('GET', '/api/tasks/:id/architecture-diagnosis', async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    let member: string, thresholds: Partial<ArchitectureThresholds>;
    try {
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
      if ([...query.keys()].some(key => !['member', ...thresholdKeys].includes(key) || query.getAll(key).length !== 1)) throw new Error('Invalid query');
      member = query.get('member') ?? 'all'; if (!member || member.length > 1024) throw new Error('Invalid member');
      thresholds = {};
      for (const key of thresholdKeys) if (query.has(key)) {
        const value = query.get(key)!; if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('Invalid threshold');
        thresholds[key] = Number(value);
      }
      validateArchitectureThresholds(thresholds);
    } catch { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid task diagnosis scope or thresholds.', undefined, req); return; }
    if (closed || active) { sendApiError(res, 409, 'BAD_REQUEST', 'A task analysis is running or the server is closing.', { reason: 'BUSY' }, req); return; }
    const controller = new AbortController(); active = controller;
    const cancel = (): void => controller.abort(); res.once('close', cancel);
    const deadline = setTimeout(cancel, 45000); deadline.unref();
    try {
      const input = await collector.collect(params.id!, member, controller.signal);
      controller.signal.throwIfAborted();
      const report = analyzeArchitectureDiagnosis(input, thresholds);
      if (Buffer.byteLength(JSON.stringify(report)) > 512 * 1024) throw new ArchitectureDiagnosisError('LIMIT', 503);
      if (!res.destroyed) sendJson(res, 200, report, req);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof TaskReadError) sendApiError(res, error.code === 'SESSION_NOT_FOUND' ? 404 : 400, error.code, error.message, undefined, req);
      else if (error instanceof ArchitectureDiagnosisError) sendApiError(res, error.status, error.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST', 'Task evidence changed or analysis is unavailable; retry explicitly.', { reason: error.reason }, req);
      else sendApiError(res, 503, 'INTERNAL_ERROR', 'Task analysis stopped or its evidence is unavailable.', { reason: controller.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE' }, req);
    } finally { clearTimeout(deadline); res.off('close', cancel); if (active === controller) active = null; }
  });
  return () => { closed = true; active?.abort(); collector.close(); };
}
