import { QUALITY_KEYS } from './benchmark-types.js';
import type { BenchmarkDemoInput, BenchmarkManifest, BenchmarkReport, BenchmarkRun, BenchmarkSpan, BenchmarkTelemetry, BenchmarkUsage, BenchmarkVerdict } from './benchmark-types.js';

export const BENCHMARK_MAX_BYTES = 16 * 1024 * 1024;
function invalid(path: string): never { throw new Error(`Invalid benchmark: ${path}`); }
function obj(v: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid(path);
  const r = v as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !(k in r))) invalid(path);
  return r;
}
function str(v: unknown, path: string, max = 1000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) invalid(path);
  return v;
}
function num(v: unknown, path: string, max = Number.MAX_SAFE_INTEGER, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || (integer && !Number.isSafeInteger(v))) invalid(path);
  return v;
}
function nullable(v: unknown, path: string, max?: number, integer = false): number | null { return v === null ? null : num(v, path, max, integer); }
function textOrNull(v: unknown, path: string): string | null { return v === null ? null : str(v, path); }
function bool(v: unknown, path: string): boolean { if (typeof v !== 'boolean') invalid(path); return v; }
function oneOf<T extends string>(v: unknown, values: readonly T[], path: string): T { if (!values.includes(v as T)) invalid(path); return v as T; }
function list(v: unknown, path: string, max: number): unknown[] { if (!Array.isArray(v) || v.length > max) invalid(path); return v; }
function argv(v: unknown, path: string): string[] { const a = list(v, path, 64).map(x => str(x, path, 8192)); if (!a.length) invalid(path); return a; }
function stamp(v: unknown, path: string): string { const s = str(v, path); if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) invalid(path); return s; }
function unique(ids: string[], path: string): void { if (new Set(ids).size !== ids.length) invalid(path); }
function id(v: unknown, path: string): string { const s = str(v, path, 80); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s)) invalid(path); return s; }

export function validateBenchmarkDemo(value: unknown): BenchmarkDemoInput {
  const v = obj(value, ['name', 'repetitions', 'variants'], 'demo');
  const repetitions = num(v.repetitions, 'repetitions', 10, true);
  const variants = list(v.variants, 'variants', 8).map(x => { const r = obj(x, ['product', 'model'], 'demo variant'); return { product: str(r.product, 'product', 120), model: str(r.model, 'model', 120) }; });
  if (repetitions < 1 || !variants.length) invalid('empty demo');
  return { name: str(v.name, 'name', 120), repetitions, variants };
}

export function validateBenchmarkManifest(value: unknown): BenchmarkManifest {
  const v = obj(value, ['version', 'name', 'repetitions', 'task', 'variants'], 'manifest');
  if (v.version !== 1) invalid('version');
  const t = obj(v.task, ['id', 'repository', 'ref', 'prompt', 'expectedTests', 'evaluator', 'timeoutMs'], 'task');
  const variants = list(v.variants, 'variants', 8).map(x => {
    const r = obj(x, ['id', 'product', 'model', 'environment', 'parameters', 'toolSet', 'driver'], 'variant');
    return { id: id(r.id, 'variant.id'), product: str(r.product, 'product'), model: str(r.model, 'model'), environment: str(r.environment, 'environment'), parameters: str(r.parameters, 'parameters'), toolSet: str(r.toolSet, 'toolSet'), driver: argv(r.driver, 'driver') };
  });
  unique(variants.map(x => x.id), 'variant ids');
  const repetitions = num(v.repetitions, 'repetitions', 10, true);
  const expectedTests = num(t.expectedTests, 'expectedTests', 1000000, true);
  const timeoutMs = num(t.timeoutMs, 'timeoutMs', 86400000, true);
  if (!variants.length || repetitions < 1 || expectedTests < 1 || timeoutMs < 100) invalid('empty/zero manifest');
  return { version: 1, name: str(v.name, 'name', 120), repetitions, variants,
    task: { id: str(t.id, 'task.id', 256), repository: str(t.repository, 'repository', 4096), ref: str(t.ref, 'ref', 256), prompt: str(t.prompt, 'prompt', 32000), expectedTests, evaluator: argv(t.evaluator, 'evaluator'), timeoutMs } };
}
export function validateBenchmarkSpan(value: unknown): BenchmarkSpan {
  const v = obj(value, ['id', 'kind', 'name', 'startMs', 'durationMs', 'timing', 'status', 'firstTokenMs', 'outputTokens', 'sessionKey', 'eventId'], 'span');
  const durationMs = nullable(v.durationMs, 'durationMs', 86400000);
  const firstTokenMs = nullable(v.firstTokenMs, 'firstTokenMs', 86400000);
  if (firstTokenMs !== null && durationMs !== null && firstTokenMs > durationMs) invalid('firstTokenMs > duration');
  return { id: str(v.id, 'span.id', 256), kind: oneOf(v.kind, ['model', 'tool', 'runner'], 'kind'), name: str(v.name, 'span.name'),
    startMs: num(v.startMs, 'startMs', 86400000), durationMs, firstTokenMs, outputTokens: nullable(v.outputTokens, 'outputTokens', undefined, true),
    timing: oneOf(v.timing, ['measured', 'observed', 'derived'], 'timing'), status: oneOf(v.status, ['ok', 'error', 'unknown'], 'status'),
    sessionKey: textOrNull(v.sessionKey, 'sessionKey'), eventId: textOrNull(v.eventId, 'eventId') };
}
export function validateBenchmarkTelemetry(value: unknown): BenchmarkTelemetry {
  const v = obj(value, ['actualModel', 'sessionKey', 'complete', 'usage', 'spans'], 'telemetry');
  const u = obj(v.usage, ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'inputIncludesCache', 'outputIncludesReasoning'], 'usage');
  const usage = Object.fromEntries(['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'].map(k => [k, nullable(u[k], k, undefined, true)])) as unknown as BenchmarkUsage;
  for (const k of ['inputIncludesCache', 'outputIncludesReasoning'] as const) usage[k] = u[k] === null ? null : bool(u[k], k);
  const spans = list(v.spans, 'spans', 2000).map(validateBenchmarkSpan);
  if (spans.some(s => s.kind === 'runner')) invalid('driver runner span');
  unique(spans.map(s => s.id), 'span ids');
  return { actualModel: textOrNull(v.actualModel, 'actualModel'), sessionKey: textOrNull(v.sessionKey, 'sessionKey'), complete: bool(v.complete, 'complete'), usage, spans };
}
export function validateBenchmarkVerdict(value: unknown): BenchmarkVerdict {
  const v = obj(value, ['passed', 'total', 'quality'], 'verdict');
  const q = obj(v.quality, [...QUALITY_KEYS], 'quality');
  const quality = Object.fromEntries(QUALITY_KEYS.map(k => [k, nullable(q[k], k, k === 'duplicationPct' ? 100 : undefined, !['duplicationPct', 'complexity'].includes(k))])) as BenchmarkVerdict['quality'];
  const passed = num(v.passed, 'passed', 1000000, true), total = num(v.total, 'total', 1000000, true);
  if (passed > total || total < 1) invalid('passed/total');
  return { passed, total, quality };
}
export function validateBenchmarkReport(value: unknown): BenchmarkReport {
  const v = obj(value, ['version', 'synthetic', 'manifest', 'commit', 'promptSha256', 'createdAt', 'runs'], 'report');
  if (v.version !== 1) invalid('report version');
  const manifest = validateBenchmarkManifest(v.manifest);
  const runs: BenchmarkRun[] = list(v.runs, 'runs', 80).map(x => {
    const r = obj(x, ['id', 'variantId', 'repetition', 'startedAt', 'status', 'host', 'e2eMs', 'telemetry', 'verdict', 'phases', 'error'], 'run');
    const variantId = str(r.variantId, 'variantId');
    if (!manifest.variants.some(a => a.id === variantId)) invalid('unknown variant');
    const repetition = num(r.repetition, 'repetition', manifest.repetitions, true);
    if (repetition < 1) invalid('repetition');
    const telemetry = r.telemetry === null ? null : validateBenchmarkTelemetry(r.telemetry);
    const phases = list(r.phases, 'phases', 8).map(validateBenchmarkSpan);
    if (phases.some(s => s.kind !== 'runner')) invalid('phase kind');
    unique([...phases, ...telemetry?.spans ?? []].map(s => s.id), 'run span ids');
    return { id: id(r.id, 'run.id'), variantId, repetition, startedAt: stamp(r.startedAt, 'startedAt'),
      status: oneOf(r.status, ['completed', 'failed', 'timeout', 'cancelled'], 'run.status'), host: str(r.host, 'host'),
      e2eMs: nullable(r.e2eMs, 'e2eMs', 86400000), telemetry,
      verdict: r.verdict === null ? null : validateBenchmarkVerdict(r.verdict), phases, error: textOrNull(r.error, 'error') };
  });
  unique(runs.map(r => r.id), 'run ids'); unique(runs.map(r => `${r.variantId}:${r.repetition}`), 'duplicate trial');
  if (runs.reduce((n, r) => n + (r.telemetry?.spans.length ?? 0), 0) > 20000) invalid('total spans');
  const commit = str(v.commit, 'commit'), promptSha256 = str(v.promptSha256, 'promptSha256');
  if (!/^[a-f0-9]{40,64}$/.test(commit) || !/^[a-f0-9]{64}$/.test(promptSha256)) invalid('fingerprint');
  return { version: 1, synthetic: bool(v.synthetic, 'synthetic'), manifest, commit, promptSha256, createdAt: stamp(v.createdAt, 'createdAt'), runs };
}
