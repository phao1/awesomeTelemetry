import { EMPTY_QUALITY } from './benchmark-types.js';
import type { BenchmarkManifest, BenchmarkReport, BenchmarkRun, BenchmarkSpan } from './benchmark-types.js';

export const BENCHMARK_TEMPLATE: BenchmarkManifest = {
  version: 1, name: 'Qoder GUI vs CodeArts GUI', repetitions: 3,
  task: { id: 'ruoyi-perf-management', repository: '/absolute/path/to/task-repository', ref: 'HEAD',
    prompt: '完成绩效管理任务，遵循仓库规范并运行验收用例。', expectedTests: 371,
    evaluator: ['/absolute/path/to/independent-evaluator'], timeoutMs: 5400000 },
  variants: [
    { id: 'qoder', product: 'Qoder GUI', model: 'set-exact-model-id', environment: 'local', parameters: 'default', toolSet: 'fixed task tools', driver: ['/absolute/path/to/qoder-gui-driver'] },
    { id: 'codearts', product: 'CodeArts GUI', model: 'set-exact-model-id', environment: 'local', parameters: 'default', toolSet: 'fixed task tools', driver: ['/absolute/path/to/codearts-gui-driver'] },
  ],
};
/** Preview only. These values never claim actual vendor performance. */
export function demoBenchmarkReport(): BenchmarkReport {
  const manifest: BenchmarkManifest = { ...BENCHMARK_TEMPLATE, name: 'SYNTHETIC · 评测流程示例',
    variants: BENCHMARK_TEMPLATE.variants.map(v => ({ ...v, model: 'synthetic-model', environment: 'synthetic' })) };
  const runs: BenchmarkRun[] = manifest.variants.flatMap((v, group) => [1, 2, 3].map(repetition => {
    const span = (id: string, kind: 'model' | 'tool', startMs: number, durationMs: number, status: 'ok' | 'error' = 'ok'): BenchmarkSpan => ({
      id, kind, name: kind === 'model' ? 'Synthetic model request' : status === 'error' ? 'Synthetic test failure' : 'Synthetic file edit',
      startMs, durationMs, timing: 'measured', status, firstTokenMs: kind === 'model' ? (group ? 6000 : 1800) : null, outputTokens: kind === 'model' ? 1000 : null, sessionKey: null, eventId: null,
    });
    const factor = 1 + repetition / 10 + group / 3;
    return { id: `${v.id}-${repetition}`, variantId: v.id, repetition, startedAt: '2026-10-28T00:00:00.000Z', status: 'completed', host: 'synthetic-host', e2eMs: 60000 * factor, error: null, phases: [],
      telemetry: { actualModel: 'synthetic-model', sessionKey: null, complete: true,
        usage: { input: 20000, output: 2000, reasoning: 800, cacheRead: group ? 2000 : 16000, cacheWrite: 0, inputIncludesCache: true, outputIncludesReasoning: true },
        spans: [span('model-1', 'model', 0, 20000 * factor), span('edit-1', 'tool', 20000 * factor, 5000), span('model-2', 'model', 26000 * factor, 18000 * factor), span('test-1', 'tool', 45000 * factor, 4000, group ? 'error' : 'ok')] },
      verdict: { passed: group ? 250 + repetition : 371, total: 371, quality: { ...EMPTY_QUALITY, loc: 4900, vulnerabilities: 0, duplicationPct: group ? 14 : 3, complexity: 2.4, buildWarnings: 0 } },
    };
  }));
  return { version: 1, synthetic: true, manifest, commit: '0'.repeat(40), promptSha256: '0'.repeat(64), createdAt: '2026-10-28T00:00:00.000Z', runs };
}
