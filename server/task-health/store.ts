import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HealthReport, HealthScope, HealthThresholds } from '../../src/core/task-health/types.js';
import { HEALTH_CALC_VERSION, HEALTH_RULE_VERSION } from '../../src/core/task-health/report.js';
import { HealthError } from './collector.js';

export interface HealthReportIndexItem { id: string; generatedAt: string; mode: 'standard' | 'deep'; revision: string; expired: boolean; reportId: string | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = (taskId: string) => createHash('sha256').update(taskId).digest('hex');
const locks = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(run); locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Exclusive same-directory temp, flush, close, rename. No partial final file. */
export async function atomicHealthWrite(path: string, text: string, signal?: AbortSignal): Promise<void> {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    signal?.throwIfAborted(); const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(text, 'utf8'); signal?.throwIfAborted(); await file.sync(); } finally { await file.close(); }
    signal?.throwIfAborted(); await rename(temp, path);
  } finally { await unlink(temp).catch(error => { if (!missing(error)) throw error; }); }
}
function validate(value: unknown, taskHash: string, id: string): HealthReport {
  const r = value as HealthReport;
  if (!r || r.version !== 1 || r.mode !== 'standard' || r.id !== id || !uuid.test(id) || typeof r.taskId !== 'string' || digest(r.taskId) !== taskHash || typeof r.revision !== 'string' || !Number.isFinite(Date.parse(r.generatedAt)) || !r.scope || !r.thresholds || !Array.isArray(r.metrics) || !Array.isArray(r.evidence) || !Array.isArray(r.findings) || !r.coverage) throw new HealthError('HEALTH_STORAGE_FAILED');
  return r;
}
async function readReport(path: string, taskHash: string, id: string): Promise<HealthReport> {
  const file = await open(path, 'r');
  try { if ((await file.stat()).size > 1024 * 1024) throw new HealthError('HEALTH_STORAGE_FAILED'); return validate(JSON.parse(await file.readFile('utf8')), taskHash, id); }
  finally { await file.close(); }
}
const metadata = (r: HealthReport, revision: string | null): HealthReportIndexItem => ({ id: r.id, generatedAt: r.generatedAt, mode: 'standard', revision: r.revision, expired: r.revision !== revision, reportId: null });
const canonical = (v: unknown) => JSON.stringify(v, (_key, value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function createHealthReportStore(dataDirectory: string) {
  const root = join(resolve(dataDirectory), 'task-health-reports');
  const directory = (taskId: string) => join(root, digest(taskId));
  async function reports(taskId: string): Promise<HealthReport[]> {
    const dir = directory(taskId); let names: string[];
    try { names = await readdir(dir); } catch (error) { if (missing(error)) return []; throw error; }
    const result: HealthReport[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
      result.push(await readReport(join(dir, name), digest(taskId), name.slice(0, -5)));
    }
    return result.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.id.localeCompare(b.id));
  }
  async function index(taskId: string, values: HealthReport[], signal?: AbortSignal) {
    await atomicHealthWrite(join(directory(taskId), 'index.json'), JSON.stringify({ items: values.map(r => metadata(r, r.revision)) }), signal);
  }
  const guarded = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { if (error instanceof HealthError) throw error; throw new HealthError('HEALTH_STORAGE_FAILED'); } };
  return {
    async list(taskId: string, revision: string | null): Promise<{ items: HealthReportIndexItem[] }> {
      return guarded(() => serialized(directory(taskId), async () => {
        const values = await reports(taskId);
        // Explicit history reconciles validated orphan files after index-save failure.
        if (values.length) await index(taskId, values);
        const items = values.map(r => metadata(r, revision));
        if (items.length > 50 || Buffer.byteLength(JSON.stringify({ items })) > 64 * 1024) throw new HealthError('HEALTH_STORAGE_FAILED');
        return { items };
      }));
    },
    async reusable(taskId: string, revision: string, scope: HealthScope, thresholds: HealthThresholds): Promise<HealthReport | null> {
      return guarded(() => serialized(directory(taskId), async () => (await reports(taskId)).find(r => r.revision === revision && same(r.scope, scope) && same(r.thresholds, thresholds) && r.calcVersion === HEALTH_CALC_VERSION && r.ruleVersion === HEALTH_RULE_VERSION) ?? null));
    },
    async save(report: HealthReport, signal?: AbortSignal): Promise<HealthReport> {
      return guarded(() => serialized(directory(report.taskId), async () => {
        validate(report, digest(report.taskId), report.id);
        const text = JSON.stringify(report); if (Buffer.byteLength(text) > 1024 * 1024) throw new HealthError('HEALTH_SIZE_LIMIT');
        const values = await reports(report.taskId);
        const existing = values.find(r => r.revision === report.revision && same(r.scope, report.scope) && same(r.thresholds, report.thresholds) && r.calcVersion === report.calcVersion && r.ruleVersion === report.ruleVersion);
        if (existing) return existing;
        if (values.some(r => r.id === report.id)) throw new HealthError('HEALTH_STORAGE_FAILED');
        if (values.length >= 50) throw new HealthError('HEALTH_REPORT_LIMIT', 409);
        signal?.throwIfAborted(); await mkdir(directory(report.taskId), { recursive: true, mode: 0o700 });
        await atomicHealthWrite(join(directory(report.taskId), report.id + '.json'), text, signal);
        // Once report is durable, always finish index, including late cancellation.
        await index(report.taskId, [...values, report].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.id.localeCompare(b.id)));
        return report;
      }));
    },
    async get(id: string): Promise<HealthReport> {
      if (!uuid.test(id)) throw new HealthError('HEALTH_REPORT_NOT_FOUND', 404);
      return guarded(async () => {
        let directories: string[]; try { directories = await readdir(root); } catch (error) { if (missing(error)) throw new HealthError('HEALTH_REPORT_NOT_FOUND', 404); throw error; }
        for (const name of directories) {
          if (!/^[a-f0-9]{64}$/.test(name)) continue;
          try { return await readReport(join(root, name, id + '.json'), name, id); } catch (error) { if (!missing(error)) throw error; }
        }
        throw new HealthError('HEALTH_REPORT_NOT_FOUND', 404);
      });
    },
    async bytes(id: string): Promise<string> {
      const r = await this.get(id);
      return readFile(join(directory(r.taskId), id + '.json'), 'utf8');
    },
  };
}
export type HealthReportStore = ReturnType<typeof createHealthReportStore>;
