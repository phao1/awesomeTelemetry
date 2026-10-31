import type { IncomingMessage } from 'node:http';
import { setTimeout, clearTimeout } from 'node:timers';
import { validateTeamExperimentDemo } from '../../src/core/team-experiment-validation.js';
import { runTeamExperimentDemo } from '../team-experiment/demo.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';
import type { Router } from './router.js';

async function readInput(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('Invalid input');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', bad); req.off('error', bad); };
    const bad = () => { cleanup(); req.resume(); reject(new Error('Invalid input')); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > 512 * 1024) { bad(); return; } chunks.push(chunk); };
    const end = () => { cleanup(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new Error('Invalid input')); } };
    const timer = setTimeout(bad, 5000); timer.unref();
    req.on('data', data); req.on('end', end); req.on('aborted', bad); req.on('error', bad);
  });
}
/** The shared loopback/Host/Origin guard must run before router dispatch. */
export function registerTeamExperimentRoutes(router: Router, directory: string): () => void {
  let active: AbortController | null = null, closed = false;
  router.register('POST', '/api/team-experiments/demo', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    let input;
    try { input = validateTeamExperimentDemo(await readInput(req)); }
    catch { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid team experiment example configuration.', undefined, req); return; }
    if (active || closed) { sendApiError(res, 409, 'BAD_REQUEST', 'An example is running or the server is closing.', { reason: 'BUSY' }, req); return; }
    const controller = new AbortController(); active = controller;
    const cancel = () => controller.abort(); res.once('close', cancel);
    const timer = setTimeout(cancel, 60000); timer.unref();
    try {
      const report = await runTeamExperimentDemo(input, directory, controller.signal);
      if (controller.signal.aborted) throw new Error('Example cancelled');
      sendJson(res, 200, report, req);
    } catch {
      if (!res.destroyed) sendApiError(res, 503, 'INTERNAL_ERROR', 'Example stopped or failed. Completed artifacts may remain locally.', undefined, req);
    } finally { clearTimeout(timer); res.off('close', cancel); if (active === controller) active = null; }
  });
  return () => { closed = true; active?.abort(); };
}
