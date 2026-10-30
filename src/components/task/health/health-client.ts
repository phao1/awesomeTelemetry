import { fetchJson } from '../../../api/client.js';
import type { BudgetDeepHealthPack } from '../../../core/task-health/deep-pack.js';
import type { DeepHealthReport, HealthReport, HealthScope } from '../../../core/task-health/types.js';
export interface HealthReportIndexItem { id: string; generatedAt: string; mode: 'standard' | 'deep'; revision: string; expired: boolean; reportId: string | null }
const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}/health-reports`;
const reportPath = (id: string) => `/health-reports/${encodeURIComponent(id)}`;
function checked(report: HealthReport, taskId: string): HealthReport {
  if (report.version !== 1 || report.mode !== 'standard' || report.taskId !== taskId || !Array.isArray(report.metrics) || !Array.isArray(report.evidence) || !Array.isArray(report.findings) || !report.coverage || !report.dimensions) throw new Error('INVALID_HEALTH_REPORT');
  return report;
}
export interface HealthModelStatus { configured: boolean; provider: 'anthropic' | 'openai-compatible' | null; model: string | null }
export interface HealthDeepPreview { pack: BudgetDeepHealthPack; digest: string; estimate: { inputTokens: number; outputTokens: number; bytes: number; approximate: true } }
export const healthApi = {
  modelStatus: (signal: AbortSignal) => fetchJson<HealthModelStatus>('/task-health/model-status', { signal, cache: 'no-store' }),
  preview: (id: string, signal: AbortSignal) => fetchJson<HealthDeepPreview>(reportPath(id) + '/deep/preview', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: '{}' }),
  deep: async (id: string, digest: string, signal: AbortSignal) => {
    const r = await fetchJson<DeepHealthReport>(reportPath(id) + '/deep', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest }) });
    if (r.version !== 1 || r.reportId !== id || r.timing !== 'model_judged' || !['accepted', 'partial', 'rejected'].includes(r.status)) throw new Error('INVALID_DEEP_REPORT');
    return r;
  },
  readDeep: async (id: string, taskId: string, signal: AbortSignal) => {
    const r = await fetchJson<DeepHealthReport>(reportPath(id), { signal, cache: 'no-store' });
    if (r.id !== id || r.taskId !== taskId || r.version !== 1 || r.timing !== 'model_judged' || !Array.isArray(r.rejected)) throw new Error('INVALID_DEEP_REPORT');
    return r;
  },
  list: async (id: string, signal: AbortSignal) => {
    const result = await fetchJson<{ items: HealthReportIndexItem[] }>(taskPath(id), { signal, cache: 'no-store' });
    if (!Array.isArray(result?.items) || result.items.length > 50 || result.items.some(item => !item || typeof item.id !== 'string' || typeof item.generatedAt !== 'string' || !['standard', 'deep'].includes(item.mode) || typeof item.expired !== 'boolean' || typeof item.revision !== 'string')) throw new Error('INVALID_HEALTH_HISTORY');
    return result;
  },
  read: async (id: string, taskId: string, signal: AbortSignal) => {
    const report = checked(await fetchJson<HealthReport>(reportPath(id), { signal, cache: 'no-store' }), taskId);
    if (report.id !== id) throw new Error('INVALID_HEALTH_REPORT');
    return report;
  },
  generate: async (id: string, scope: HealthScope, signal: AbortSignal) => {
    const report = checked(await fetchJson<HealthReport>(taskPath(id), { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'standard', member: scope.member, ...(scope.from && scope.to ? { from: scope.from, to: scope.to } : {}) }) }), id);
    if (report.scope.member !== scope.member || report.scope.from !== scope.from || report.scope.to !== scope.to) throw new Error('INVALID_HEALTH_SCOPE');
    return report;
  },
  exportUrl: (id: string, format: 'html' | 'md' | 'json') => '/api' + reportPath(id) + '/export?format=' + format,
};
