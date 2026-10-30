import type { BenchmarkReport } from '../../core/benchmark-types.js';
import type { TeamExperimentReport } from '../../core/team-experiment-types.js';
import { parseArchitectureTransfer } from '../../core/agent-folding-transfer.js';
import { fetchJson } from '../../api/client.js';
import type { FoldingNativeScope, FoldingProject } from '../../core/agent-folding-types.js';
import type { FoldingMetricRun } from '../../core/agent-folding-metrics.js';
import { validateFoldingProject } from '../../core/agent-folding-validation.js';
export const architectureApi = {
  scope: async (scope: FoldingNativeScope, signal?: AbortSignal) => validateFoldingProject(await fetchJson<FoldingProject>('/agent-folding/scope', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scope), signal })),
  compare: (a: string[], b: string[], signal?: AbortSignal) => fetchJson<{ a: FoldingMetricRun[]; b: FoldingMetricRun[] }>('/agent-folding/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, b }), signal }),
};
export function downloadArchitecture(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function readArchitectureFile(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('File exceeds 8MiB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader(), timer = setTimeout(() => { reader.abort(); reject(new Error('Read timeout')); }, 10000);
    reader.onload = () => { clearTimeout(timer); resolve(String(reader.result)); };
    reader.onerror = () => { clearTimeout(timer); reject(new Error('Read failed')); }; reader.onabort = () => clearTimeout(timer); reader.readAsText(file);
  });
}

export function transferArchitectureReport(report: BenchmarkReport | TeamExperimentReport) {
  const text = JSON.stringify(report); parseArchitectureTransfer(text);
  sessionStorage.setItem('agent-architecture-comparison', text); window.location.hash = '#/task?compareImport=1';
}
