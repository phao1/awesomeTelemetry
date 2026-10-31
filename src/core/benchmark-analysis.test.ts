import { describe, expect, it } from 'vitest';
import { benchmarkGroups, benchmarkMetrics, benchmarkStats, correctedUsage, diagnoseBenchmarkRun, runSuccess } from './benchmark-analysis.js';
import { demoBenchmarkReport } from './benchmark-demo.js';
import { validateBenchmarkManifest, validateBenchmarkReport } from './benchmark-validation.js';

describe('BENCH-002 metrics and comparability', () => {
  it('counts included cache and reasoning exactly once', () => {
    const u = demoBenchmarkReport().runs[0]!.telemetry!.usage;
    expect(correctedUsage(u)).toEqual({ total: 22000, hit: 80 });
    expect(correctedUsage({ ...u, inputIncludesCache: false, outputIncludesReasoning: false }).total).toBe(38800);
    expect(correctedUsage({ ...u, outputIncludesReasoning: null }).total).toBeNull();
    expect(correctedUsage({ ...u, reasoning: 3000 }).total).toBeNull();
    expect(correctedUsage({ ...u, cacheRead: 25000 }).total).toBeNull();
  });
  it('uses independent exact test counts, never completed status alone', () => {
    const r = demoBenchmarkReport().runs[0]!;
    expect(runSuccess(r, 371)).toBe(true);
    expect(runSuccess({ ...r, verdict: null }, 371)).toBeNull();
    expect(runSuccess(r, 400)).toBeNull();
    expect(runSuccess({ ...r, status: 'failed' }, 371)).toBe(false);
  });
  it('keeps partial evidence unavailable, including apparently zero calls', () => {
    const r = demoBenchmarkReport().runs[0]!;
    r.telemetry!.complete = false;
    const m = benchmarkMetrics(r, 371);
    expect(m.tokens).toBeNull(); expect(m.modelCalls).toBeNull(); expect(m.toolCalls).toBeNull();
    expect(m.passRate).toBe(100); expect(m.e2e).toBeCloseTo(1.1);
  });
  it('requires measured durations and first tokens, never substitutes legacy log gaps', () => {
    const r = demoBenchmarkReport().runs[0]!;
    const m = benchmarkMetrics(r, 371);
    expect(m.ttft).toBe(1800); expect(m.tpot).toBeCloseTo((41800 - 3600) / 1998);
    expect(m.modelCalls).toBe(2); expect(m.toolAvg).toBe(4.5);
    r.telemetry!.spans[0]!.timing = 'derived';
    const unknown = benchmarkMetrics(r, 371);
    expect(unknown.ttft).toBeNull(); expect(unknown.tpot).toBeNull(); expect(unknown.modelSum).toBeNull();
    expect(unknown.modelCalls).toBe(2);
  });
  it('reports valid-sample statistics without treating null as zero', () => {
    expect(benchmarkStats([null, 1, 3, 5])).toEqual({ n: 3, mean: 3, median: 3, p95: 5, sd: Math.sqrt(8 / 3), cv: Math.sqrt(8 / 3) / 3 * 100 });
    expect(benchmarkStats([null]).mean).toBeNull(); expect(benchmarkStats([0]).cv).toBeNull();
    expect(benchmarkStats([1, 2]).median).toBe(1.5);
  });
  it('groups repetitions and flags actual-model mismatches independently', () => {
    const report = demoBenchmarkReport(); report.runs[0]!.telemetry!.actualModel = 'different';
    const groups = benchmarkGroups(report);
    expect(groups[0]!.successes).toBe(3); expect(groups[0]!.known).toBe(3);
    expect(groups[0]!.modelVerified).toBe(false); expect(groups[1]!.successes).toBe(0);
    expect(groups[1]!.metrics.passed.mean).toBe(252);
  });
  it('links rule findings only to retained evidence', () => {
    const report = demoBenchmarkReport(), run = report.runs[3]!;
    const findings = diagnoseBenchmarkRun(run, report);
    expect(findings.map(f => f.rule)).toEqual(['failure', 'errors', 'slow', 'cache', 'quality']);
    expect(findings.find(f => f.rule === 'errors')!.spanIds).toEqual(['test-1']);
    expect(findings.find(f => f.rule === 'slow')!.spanIds).toEqual(['model-1', 'model-2']);
  });
});
describe('BENCH-003 report validation', () => {
  it('accepts a complete synthetic example without mutating it', () => {
    const report = demoBenchmarkReport(); expect(validateBenchmarkReport(report)).toEqual(report);
  });
  it.each(['duplicate', 'negative', 'nan', 'model', 'count', 'unknown-field', 'date', 'duration'])('rejects invalid %s evidence', mode => {
    const report = demoBenchmarkReport(), run = report.runs[0]!;
    if (mode === 'duplicate') report.runs.push(run);
    if (mode === 'negative') run.telemetry!.usage.input = -1;
    if (mode === 'nan') run.e2eMs = NaN;
    if (mode === 'model') run.variantId = 'absent';
    if (mode === 'count') run.verdict!.passed = 500;
    if (mode === 'unknown-field') Object.assign(run, { malicious: 'ignored?' });
    if (mode === 'date') run.startedAt = 'yesterday';
    if (mode === 'duration') run.telemetry!.spans[0]!.firstTokenMs = 100000;
    expect(() => validateBenchmarkReport(report)).toThrow('Invalid benchmark');
  });
  it('rejects empty plans and shell strings instead of argv', () => {
    const manifest = demoBenchmarkReport().manifest;
    expect(() => validateBenchmarkManifest({ ...manifest, repetitions: 0 })).toThrow();
    expect(() => validateBenchmarkManifest({ ...manifest, variants: [] })).toThrow();
    manifest.variants[0]!.driver = 'sh -c echo hi' as unknown as string[];
    expect(() => validateBenchmarkManifest(manifest)).toThrow();
  });
});

it('r4 keeps included unknown reasoning from poisoning totals and treats unreported cache writes as zero', () => {
  const base = { input: 100, output: 20, reasoning: null, cacheRead: 50, cacheWrite: null, inputIncludesCache: false, outputIncludesReasoning: true, cacheWriteReported: false };
  expect(correctedUsage(base)).toEqual({ total: 170, hit: 50 / 150 * 100 });
  expect(correctedUsage({ ...base, cacheWriteReported: true }).total).toBeNull();
  expect(correctedUsage({ ...base, outputIncludesReasoning: false }).total).toBeNull();
  expect(correctedUsage({ ...base, reasoning: 21 }).total).toBeNull();
});

it('preserves optional independent verdict source/labels/case results and rejects inconsistent case totals', async () => {
  const { validateBenchmarkVerdict, validateBenchmarkTelemetry } = await import('./benchmark-validation.js');
  const report = demoBenchmarkReport(), verdict = { ...report.runs[0]!.verdict!, passed: 1, total: 2, qualitySource: 'scanner-v1', labels: { product: 'test', environment: 'local', host: null, caseId: 'case' }, cases: [{ id: 'a', passed: true }, { id: 'b', passed: false }] };
  expect(validateBenchmarkVerdict(verdict)).toEqual(verdict);
  expect(() => validateBenchmarkVerdict({ ...verdict, passed: 2 })).toThrow('disagree');
  expect(() => validateBenchmarkVerdict({ ...verdict, cases: [verdict.cases[0], verdict.cases[0]] })).toThrow();
  const telemetry = { ...report.runs[0]!.telemetry!, usage: { ...report.runs[0]!.telemetry!.usage, cacheWriteReported: false, cacheWrite: null } };
  expect(validateBenchmarkTelemetry(telemetry).usage.cacheWriteReported).toBe(false);
  expect(() => validateBenchmarkTelemetry({ ...telemetry, usage: { ...telemetry.usage, cacheWriteReported: 'false' } })).toThrow();
});
