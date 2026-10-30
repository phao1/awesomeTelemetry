import { previewFoldingReview, runFoldingReview } from '../agent-folding/review.js';
import { validateFoldingNativeScope } from '../agent-folding/native-scope.js';
import type { IncomingMessage } from 'node:http';
import { importFoldingProject } from '../../src/core/agent-folding-validation.js';
import type { FoldingNativeScope, FoldingProject } from '../../src/core/agent-folding-types.js';
import { buildFoldingArtifacts } from '../agent-folding/artifacts.js';
import { foldingProviderStatus } from '../agent-folding/anthropic.js';
import { loadFoldingExample } from '../agent-folding/catalog.js';
import { runFoldingSmoke } from '../agent-folding/runner.js';
import { sendApiError } from './error-envelope.js';
import { sendJson } from './send-json.js';
import type { Router } from './router.js';
import { TaskReadError } from '../storage/task-workbench.js';

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('JSON required.');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', bad); req.off('error', bad); };
    const bad = () => { if (done) return; done = true; cleanup(); req.resume(); reject(new Error('Invalid or oversized JSON.')); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > max) bad(); else chunks.push(chunk); };
    const end = () => { if (done) return; done = true; cleanup(); try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { reject(new Error('Invalid JSON.')); } };
    const timer = setTimeout(bad, 10000); timer.unref(); req.on('data', data); req.on('end', end); req.on('aborted', bad); req.on('error', bad);
  });
}
export interface AgentFoldingRouteOptions { loadScope?: (scope: FoldingNativeScope, signal: AbortSignal) => Promise<FoldingProject>; loadComparison?: (a: string[], b: string[], signal: AbortSignal) => Promise<unknown>; loadNative?: (taskId: string, member: string, signal: AbortSignal) => Promise<FoldingProject> }
/** The server's shared loopback Host/Origin and foreground guard must run first. */
export function registerAgentFoldingRoutes(router: Router, directory: string, options: AgentFoldingRouteOptions = {}): () => void {
  const reads = new Set<AbortController>();
  let active: AbortController | null = null, closed = false;
  router.register('GET', '/api/agent-folding/status', (req, res) => { res.setHeader('cache-control', 'no-store'); sendJson(res, 200, foldingProviderStatus(), req); });
  router.register('GET', '/api/agent-folding/example', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    await runOwned(req, res, () => loadFoldingExample(), 10000);
  });
  router.register('POST', '/api/agent-folding/artifacts', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    try {
      const raw = await readJson(req, 8 * 1024 * 1024);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join() !== 'project') throw new Error('Invalid export request.');
      const project = importFoldingProject((raw as { project: unknown }).project);
      sendJson(res, 200, buildFoldingArtifacts(project), req);
    } catch { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid bounded agent boundary project.', undefined, req); }
  });
  const runOwned = async (req: IncomingMessage, res: Parameters<Parameters<Router['register']>[2]>[1], job: (signal: AbortSignal) => Promise<unknown>, deadline: number, readOnly = false) => {
    if (closed || (readOnly ? reads.size >= 4 : active !== null)) { sendApiError(res, 409, 'BAD_REQUEST', 'An owned boundary job is active or the server is closing.', { reason: 'BUSY' }, req); return; }
    const controller = new AbortController(); if (readOnly) reads.add(controller); else active = controller;
    const cancel = () => controller.abort(); res.once('close', cancel); const timer = setTimeout(cancel, deadline); timer.unref();
    try { const report = await job(controller.signal); if (controller.signal.aborted) throw new Error('Cancelled.'); if (Buffer.byteLength(JSON.stringify(report)) > 8 * 1024 * 1024) throw new Error('Report too large'); sendJson(res, 200, report, req); }
    catch (error) {
      if (!res.destroyed) {
        if (error instanceof TaskReadError) sendApiError(res, error.code === 'SESSION_NOT_FOUND' ? 404 : 400, error.code, error.message, undefined, req);
        else sendApiError(res, 503, 'INTERNAL_ERROR', 'Owned boundary job stopped; completed trial artifacts may remain locally.', undefined, req);
      }
    }
    finally { clearTimeout(timer); res.off('close', cancel); reads.delete(controller); if (active === controller) active = null; }
  };
  router.register('POST', '/api/agent-folding/review/preview', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    try { sendJson(res, 200, previewFoldingReview(await readJson(req, 65536)), req); }
    catch { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid bounded review evidence.', undefined, req); }
  });
  router.register('POST', '/api/agent-folding/review', async (req, res) => {
    res.setHeader('cache-control', 'no-store'); let body: unknown;
    try { body = await readJson(req, 65536); if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== 'digest,pack') throw new Error();
      const request = body as { pack: unknown; digest: unknown }; if (previewFoldingReview(request.pack).digest !== request.digest) throw new Error();
    } catch { sendApiError(res, 400, 'BAD_REQUEST', 'Review evidence changed; preview again.', undefined, req); return; }
    await runOwned(req, res, signal => runFoldingReview(body, signal), 30000);
  });
  router.register('POST', '/api/agent-folding/scope', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    let body: unknown;
    try { body = await readJson(req, 65536); if (!options.loadScope || !body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); body = validateFoldingNativeScope(body as FoldingNativeScope); }
    catch { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid architecture scope.', undefined, req); return; }
    await runOwned(req, res, signal => options.loadScope!(body as FoldingNativeScope, signal), 30000, true);
  });
  router.register('POST', '/api/agent-folding/compare', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    let a: string[], b: string[];
    try {
      const body = await readJson(req, 128 * 1024) as { a: string[]; b: string[] };
      if (!options.loadComparison || !body || Object.keys(body).sort().join() !== 'a,b') throw new Error();
      for (const group of [body.a, body.b]) if (!Array.isArray(group) || !group.length || group.length > 40 || new Set(group).size !== group.length || group.some(id => typeof id !== 'string' || !id.startsWith('collected:') || id.length > 1024)) throw new Error();
      if (body.a.some(id => body.b.includes(id))) throw new Error(); a = body.a; b = body.b;
    } catch { sendApiError(res, 400, 'BAD_REQUEST', 'Select disjoint groups of 1..40 root tasks.', undefined, req); return; }
    await runOwned(req, res, signal => options.loadComparison!(a, b, signal), 30000, true);
  });
  router.register('POST', '/api/agent-folding/smoke', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    try { const body = await readJson(req, 1024); if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new Error('Fixed fixture only.'); }
    catch { sendApiError(res, 400, 'BAD_REQUEST', 'The fixed offline smoke accepts only an empty JSON object.', undefined, req); return; }
    await runOwned(req, res, signal => runFoldingSmoke(directory, signal), 45000);
  });
  router.register('GET', '/api/agent-folding/tasks/:id', async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams, member = query.get('member') ?? 'all';
    if (!options.loadNative || !params.id || params.id.length > 1024 || member.length > 1024 || [...query.keys()].some(k => k !== 'member') || query.getAll('member').length > 1) { sendApiError(res, 400, 'BAD_REQUEST', 'Invalid native task selection.', undefined, req); return; }
    await runOwned(req, res, signal => options.loadNative!(params.id!, member, signal), 10000);
  });
  return () => { closed = true; active?.abort(); for (const read of reads) read.abort(); };
}
