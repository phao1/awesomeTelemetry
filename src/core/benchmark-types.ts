/** Canonical additive benchmark DTOs: openspec/contracts/benchmark.md. */
export interface BenchmarkVariant {
  id: string; product: string; model: string; environment: string;
  parameters: string; toolSet: string; driver: string[];
}
export interface BenchmarkDemoInput { name: string; repetitions: number; variants: Array<{ product: string; model: string }> }
export interface BenchmarkManifest {
  version: 1; name: string; repetitions: number;
  task: { id: string; repository: string; ref: string; prompt: string;
    expectedTests: number; evaluator: string[]; timeoutMs: number };
  variants: BenchmarkVariant[];
}
export interface BenchmarkUsage {
  input: number | null; output: number | null; reasoning: number | null;
  cacheRead: number | null; cacheWrite: number | null;
  cacheWriteReported?: boolean | null;
  inputIncludesCache: boolean | null; outputIncludesReasoning: boolean | null;
}
export interface BenchmarkSpan {
  id: string; kind: 'model' | 'tool' | 'runner'; name: string;
  startMs: number; durationMs: number | null;
  timing: 'measured' | 'observed' | 'derived';
  status: 'ok' | 'error' | 'unknown';
  firstTokenMs: number | null; outputTokens: number | null;
  sessionKey: string | null; eventId: string | null;
}
export interface BenchmarkTelemetry {
  actualModel: string | null; sessionKey: string | null; complete: boolean;
  usage: BenchmarkUsage; spans: BenchmarkSpan[];
}
export const QUALITY_KEYS = ['loc', 'vulnerabilities', 'duplicationPct', 'complexity', 'redundancy', 'buildWarnings', 'staticWarnings', 'critical', 'major', 'minor', 'suggestion'] as const;
export type BenchmarkQuality = Record<typeof QUALITY_KEYS[number], number | null>;
export interface BenchmarkVerdict {
  passed: number; total: number; quality: BenchmarkQuality; qualitySource?: string | null;
  labels?: { product: string | null; environment: string | null; host: string | null; caseId: string | null };
  cases?: Array<{ id: string; passed: boolean }>;
}
export interface BenchmarkRun {
  id: string; variantId: string; repetition: number; startedAt: string;
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  host: string; e2eMs: number | null; telemetry: BenchmarkTelemetry | null;
  verdict: BenchmarkVerdict | null; phases: BenchmarkSpan[]; error: string | null;
}
export interface BenchmarkReport {
  version: 1; synthetic: boolean; manifest: BenchmarkManifest;
  commit: string; promptSha256: string; createdAt: string; runs: BenchmarkRun[];
}
export const EMPTY_USAGE: BenchmarkUsage = { input: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null, inputIncludesCache: null, outputIncludesReasoning: null };
export const EMPTY_QUALITY = Object.fromEntries(QUALITY_KEYS.map(key => [key, null])) as BenchmarkQuality;
