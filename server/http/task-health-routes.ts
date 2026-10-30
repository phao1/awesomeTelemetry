import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from 'better-sqlite3';
import type { HealthInput, HealthReport, HealthScope, HealthThresholds } from '../../src/core/task-health/types.js';
import { validateHealthThresholds, DEFAULT_HEALTH_THRESHOLDS } from '../../src/core/task-health/thresholds.js';
import { renderTaskHealthHtml, renderTaskHealthMarkdown } from '../../src/core/task-health/render.js';
import { collectTaskHealth, generateHealthReport, healthRevision, HealthError } from '../task-health/collector.js';
import type { HealthReportStore } from '../task-health/store.js';
import { TaskReadError, validateTaskRange, getTask } from '../storage/task-workbench.js';
import { sendJson } from './send-json.js';
import type { Router } from './router.js';

// JSON.parse normally loses duplicate object keys. This small token walk checks
// every object (including escaped keys) before the validated JSON is consumed.
export function parseHealthJson(text: string): unknown {
  const value: unknown = JSON.parse(text), tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  let i = 0;
  function walk(): void {
    const t = tokens[i++];
    if (t === '{') {
      const seen = new Set<string>();
      while (tokens[i] !== '}') { const key = JSON.parse(tokens[i++]!) as string; if (seen.has(key)) throw new HealthError('BAD_REQUEST', 400); seen.add(key); i++; walk(); if (tokens[i] === ',') i++; else break; }
      i++;
    } else if (t === '[') { while (tokens[i] !== ']') { walk(); if (tokens[i] === ',') i++; else break; } i++; }
  }
  walk(); return value;
}
async function body(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  if (Number(req.headers['content-length'] ?? 0) > 16384) throw new HealthError('HEALTH_INPUT_LIMIT', 413);
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) throw new HealthError('BAD_REQUEST', 400);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', fail); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(new HealthError('HEALTH_SOURCE_UNAVAILABLE'));
    const data = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16384) { fail(new HealthError('HEALTH_INPUT_LIMIT', 413)); req.resume(); } else chunks.push(chunk); };
    const end = () => { cleanup(); try { resolve(parseHealthJson(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HealthError('BAD_REQUEST', 400)); } };
    req.on('data', data); req.once('end', end); req.once('error', fail); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HealthError('BAD_REQUEST', 400); return v as Record<string, unknown>; };
export function validateHealthRequest(value: unknown, query: URLSearchParams): { scope: HealthScope; thresholds: HealthThresholds } {
  const v = object(value), allowed = ['mode', 'member', 'from', 'to', 'profile', 'thresholds'];
  if (Object.keys(v).some(key => !allowed.includes(key)) || v.mode !== 'standard' || typeof v.member !== 'string' || !v.member || v.member.length > 512 || v.profile !== undefined && v.profile !== 'codearts-perf-v1' || v.from !== undefined && typeof v.from !== 'string' || v.to !== undefined && typeof v.to !== 'string') throw new HealthError('BAD_REQUEST', 400);
  const range = validateTaskRange({ ...(v.from === undefined ? {} : { from: v.from as string }), ...(v.to === undefined ? {} : { to: v.to as string }) });
  const overrides = v.thresholds === undefined ? {} : object(v.thresholds);
  if (Object.hasOwn(overrides, 'profile')) throw new HealthError('BAD_REQUEST', 400);
  for (const key of query.keys()) {
    if (key === 'profile' || !Object.hasOwn(DEFAULT_HEALTH_THRESHOLDS, key) || query.getAll(key).length !== 1 || Object.hasOwn(overrides, key)) throw new HealthError('BAD_REQUEST', 400);
    const raw = query.get(key)!;
    if (key === 'roundBaseline' && raw === 'null') overrides[key] = null;
    else { if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) throw new HealthError('BAD_REQUEST', 400); overrides[key] = Number(raw); }
  }
  if (Object.values(overrides).some(value => typeof value === 'number' && Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new HealthError('BAD_REQUEST', 400);
  try { return { scope: { member: v.member, from: range.from || null, to: range.to || null }, thresholds: validateHealthThresholds(overrides) }; }
  catch { throw new HealthError('BAD_REQUEST', 400); }
}
const messages: Record<string, string> = { BAD_REQUEST: 'Invalid health report request.', BUSY: 'A health analysis is running or the server is closing.', HEALTH_REPORT_LIMIT: 'Report capacity reached. Manually remove saved reports before generating another.', SOURCE_CHANGED: 'Task sources changed. Refresh and retry explicitly.', HEALTH_REPORT_NOT_FOUND: 'Health report not found.', HEALTH_TIMEOUT: 'Health analysis deadline exceeded.' };
/** The caller installs the existing loopback Host/Origin and foreground guards. */
export function registerTaskHealthRoutes(router: Router, deps: {
  db: Database; store: HealthReportStore;
  collect?: (id: string, scope: HealthScope, signal: AbortSignal) => Promise<HealthInput>;
  generate?: (input: HealthInput, thresholds: HealthThresholds, signal: AbortSignal) => Promise<HealthReport>;
}): () => void {
  let active: AbortController | null = null, closed = false;
  const error = (req: IncomingMessage, res: ServerResponse, e: unknown, timedOut = false) => {
    if (res.destroyed) return;
    const code = timedOut ? 'HEALTH_TIMEOUT' : e instanceof TaskReadError ? e.code : e instanceof HealthError ? e.code : 'HEALTH_SOURCE_UNAVAILABLE';
    const status = timedOut ? 503 : e instanceof TaskReadError ? e.code === 'SESSION_NOT_FOUND' ? 404 : 400 : e instanceof HealthError ? e.status : 503;
    // Additive contract codes are emitted in the same ApiError envelope. The
    // shared error-code registry predates TH-007 and is outside this increment.
    sendJson(res, status, { error: { code, message: messages[code] ?? 'Health report operation is unavailable.' } }, req);
  };
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    const local = (host: string) => host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
    if (req.method === 'GET' && (Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined)) { error(req, res, new HealthError('BAD_REQUEST', 400)); req.resume(); return false; }
    const remote = req.socket.remoteAddress ?? '';
    let trusted = remote === '::1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.');
    try { trusted &&= local(new URL(`http://${req.headers.host ?? ''}`).hostname); if (req.headers.origin !== undefined) trusted &&= local(new URL(req.headers.origin).hostname); }
    catch { trusted = false; }
    if (!trusted) error(req, res, new HealthError('BAD_REQUEST', 400));
    return trusted;
  };
  router.register('POST', '/api/tasks/:id/health-reports', async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    if (!guard(req, res)) return;
    if (closed || active) { error(req, res, new HealthError('BUSY', 409)); return; }
    const controller = new AbortController(); active = controller; let timedOut = false;
    const cancel = () => controller.abort(); res.once('close', cancel); req.once('aborted', cancel);
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000); timer.unref();
    try {
      const { scope, thresholds } = validateHealthRequest(await body(req, controller.signal), new URL(req.url ?? '/', 'http://localhost').searchParams);
      // Race owns the HTTP deadline even if a dependency is slow to honor abort.
      const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new HealthError(timedOut ? 'HEALTH_TIMEOUT' : 'HEALTH_SOURCE_UNAVAILABLE')), { once: true }));
      const work = (async () => {
        const input = await (deps.collect ?? ((id, s, signal) => collectTaskHealth(deps.db, id, s, signal)))(params.id!, scope, controller.signal);
        controller.signal.throwIfAborted();
        const existing = await deps.store.reusable(input.taskId, input.revision, input.scope, thresholds);
        if (existing) { if (input.revision !== await healthRevision(deps.db, input.taskId)) throw new HealthError('SOURCE_CHANGED', 409); return existing; }
        const report = await (deps.generate ?? generateHealthReport)(input, thresholds, controller.signal);
        controller.signal.throwIfAborted();
        if (Buffer.byteLength(JSON.stringify(report)) > 1024 * 1024) throw new HealthError('HEALTH_SIZE_LIMIT');
        if (input.revision !== await healthRevision(deps.db, input.taskId)) throw new HealthError('SOURCE_CHANGED', 409);
        controller.signal.throwIfAborted(); return deps.store.save(report, controller.signal);
      })();
      const report = await Promise.race([work, stopped]);
      if (!res.destroyed) sendJson(res, 200, report, req);
    } catch (e) { error(req, res, e, timedOut); }
    finally { clearTimeout(timer); res.off('close', cancel); req.off('aborted', cancel); if (active === controller) active = null; }
  });
  router.register('GET', '/api/tasks/:id/health-reports', async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    if (!guard(req, res)) return;
    try {
      if (new URL(req.url ?? '/', 'http://localhost').search) throw new HealthError('BAD_REQUEST', 400);
      let revision: string | null = null, taskId = params.id!;
      try { taskId = getTask(deps.db, taskId).task.id; revision = await healthRevision(deps.db, taskId); } catch (e) { if (!(e instanceof TaskReadError) || e.code !== 'SESSION_NOT_FOUND') throw e; }
      sendJson(res, 200, await deps.store.list(taskId, revision), req);
    } catch (e) { error(req, res, e); }
  });
  router.register('GET', '/api/health-reports/:reportId', async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    if (!guard(req, res)) return;
    try { if (new URL(req.url ?? '/', 'http://localhost').search) throw new HealthError('BAD_REQUEST', 400); sendJson(res, 200, await deps.store.get(params.reportId!), req); }
    catch (e) { error(req, res, e); }
  });
  router.register('GET', '/api/health-reports/:reportId/export', async (req, res, params) => {
    res.setHeader('cache-control', 'no-store');
    if (!guard(req, res)) return;
    try {
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams, format = query.get('format');
      if ([...query.keys()].some(k => k !== 'format') || query.getAll('format').length !== 1 || !['html', 'md', 'json'].includes(format ?? '')) throw new HealthError('BAD_REQUEST', 400);
      const report = await deps.store.get(params.reportId!);
      const text = format === 'json' ? await deps.store.bytes(report.id) : format === 'html' ? renderTaskHealthHtml(report) : renderTaskHealthMarkdown(report);
      if (Buffer.byteLength(text) > (format === 'json' ? 1 : 4) * 1024 * 1024) throw new HealthError('HEALTH_SIZE_LIMIT');
      res.setHeader('content-type', format === 'html' ? 'text/html; charset=utf-8' : format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="task-health-${report.id}.${format}"`);
      res.setHeader('content-length', Buffer.byteLength(text)); res.end(text);
    } catch (e) { error(req, res, e); }
  });
  return () => { closed = true; active?.abort(); };
}
