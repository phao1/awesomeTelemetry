import type { IncomingMessage } from 'node:http';
import { setTimeout, clearTimeout } from 'node:timers';
import { runBenchmarkDemo } from '../benchmark/demo.js';
import { validateBenchmarkDemo } from '../../src/core/benchmark-validation.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';
import type { Router } from './router.js';

async function readInput(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('Invalid input');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', bad); req.off('error', bad); };
    const bad = () => { cleanup(); req.resume(); reject(new Error('Invalid input')); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > 4096) { bad(); return; } chunks.push(chunk); };
    const end = () => { cleanup(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new Error('Invalid input')); } };
    const timer = setTimeout(bad, 5000); timer.unref();
    req.on('data', data); req.on('end', end); req.on('aborted', bad); req.on('error', bad);
  });
}
/** Caller installs the shared local/Host/Origin guard before dispatch. */
export function registerBenchmarkRoutes(router: Router, directory: string): () => void {
  let active: AbortController | null = null;
  let closed = false;
  router.register('POST', '/api/benchmarks/demo', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    let input;
    try { input = validateBenchmarkDemo(await readInput(req)); }
    catch { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid example configuration.', undefined, req); return; }
    if (active || closed) { sendApiError(res, 409, 'BAD_REQUEST', 'An example is running or the server is closing.', { reason: 'BUSY' }, req); return; }
    const controller = new AbortController(); active = controller;
    const close = () => controller.abort(); res.once('close', close);
    const timer = setTimeout(close, 60000); timer.unref();
    try {
      const report = await runBenchmarkDemo(input, directory, controller.signal);
      if (controller.signal.aborted) throw new Error('Example cancelled');
      sendJson(res, 200, report, req);
    } catch {
      if (!res.destroyed) sendApiError(res, 503, 'INTERNAL_ERROR', 'Example stopped or failed. Completed artifacts may remain locally.', undefined, req);
    } finally { clearTimeout(timer); res.off('close', close); if (active === controller) active = null; }
  });
  return () => { closed = true; active?.abort(); };
}
