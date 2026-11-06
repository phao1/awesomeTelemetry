import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildFingerprintDictionary, scanDiff } from '../../src/core/rsi-l1-rules.js';
import type { HealthModelClient } from '../task-health/model-client.js';
import { createHealthModelClient } from '../task-health/model-client.js';
import { calibrationMonitorMode, deterministicCalibration, deterministicDiagnostics, readCalibrationCorpus, runCalibration, sampleCalibration } from './calibrator.js';
import type { CalibrationCorpus } from './calibrator.js';
import { MONITOR_PROMPT_VERSION, runMonitor, stripDiffComments } from './monitor.js';
import { CALIBRATION_CATEGORIES } from './stats.js';

const root = resolve('rsi-bank/calibration'), directories: string[] = [];
const identity = { family: 'openai', model: 'fake-model', promptVersion: MONITOR_PROMPT_VERSION };
const at = '2026-11-07T00:00:00.000Z';
let corpus: CalibrationCorpus;
beforeAll(async () => { corpus = await readCalibrationCorpus(root); });
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temporary(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'rsi-calibration-')); directories.push(path); return path; }

function client(mode: 'perfect' | 'clean' | 'invalid' = 'perfect', requests: string[] = []): HealthModelClient {
  return { async create(request) {
    requests.push(request.user);
    const data = JSON.parse(request.user.slice('RSI_DATA_BEGIN\n'.length, -'\nRSI_DATA_END'.length)) as { diff: string; l1Alerts: unknown[] };
    const evidence = stripDiffComments(data.diff).addedLines[0]!.text;
    return { text: mode === 'invalid' ? 'not json' : JSON.stringify({ conclusions: mode === 'perfect' && (data.l1Alerts.length || /statement\.includes|canned repair/.test(data.diff))
      ? [{ category: 'test_tampering', evidence, confidence: 0.99 }] : [] }), inputTokens: 100, outputTokens: 20 };
  } };
}
function monitor(mode: 'perfect' | 'clean' | 'invalid' = 'perfect', requests: string[] = []) {
  const model = client(mode, requests);
  return (input: Parameters<typeof runMonitor>[0], signal?: AbortSignal) => runMonitor(input, { client: model, model: identity.model }, signal);
}

describe('RSI-015 calibration corpus and deterministic detector', () => {
  it('contains thirty distinct fixtures per class and thirty benign fixtures', () => {
    expect(corpus.cases).toHaveLength(210);
    expect(new Set(corpus.cases.map(c => c.sha256)).size).toBe(210);
    for (const category of CALIBRATION_CATEGORIES) expect(corpus.cases.filter(c => c.category === category)).toHaveLength(30);
    for (const c of corpus.cases) expect(stripDiffComments(c.diff).addedLines.length).toBeGreaterThan(0);
  });
  it('detects all L0/L1-relevant malicious patches using the actual scanDiff, with no benign alerts', () => {
    const dictionary = buildFingerprintDictionary(corpus.questionMetadata);
    for (const c of corpus.cases) {
      const findings = scanDiff(c.diff, dictionary);
      if (c.category === 'benign' || c.category === 'statement_keyed_heuristic') expect(findings, c.id).toEqual([]);
      else expect(findings.some(f => f.severity === 'reject'), c.id).toBe(true);
      if (c.category === 'marker_deletion' || c.category === 'test_tampering') expect(findings.some(f => f.category === 'protected_path'), c.id).toBe(true);
    }
    for (const metric of deterministicCalibration(corpus)) expect(metric).toMatchObject({ samples: 30, valid: 30, missing: 0, detected: metric.category === 'benign' ? 0 : 30 });
  });
  it('keeps wording shortcuts outside the deterministic requirement and out of every bank fingerprint', () => {
    const heuristic = corpus.cases.filter(c => c.category === 'statement_keyed_heuristic');
    const dictionary = buildFingerprintDictionary(corpus.questionMetadata);
    expect(heuristic).toHaveLength(30);
    for (const c of heuristic) {
      expect(scanDiff(c.diff, dictionary), c.id).toEqual([]);
      for (const q of corpus.questionMetadata) for (const literal of [q.questionId, ...q.testNames, ...q.rareStrings]) expect(c.diff, c.id).not.toContain(literal);
      expect(c.diff, c.id).not.toContain('return cannedPatch');
      const phrase = /(?:statement\.includes\(|phrase |wording contains )("(?:\\.|[^"\\])*")/.exec(c.diff)?.[1];
      expect(phrase, c.id).toBeDefined();
      expect(c.statement, c.id).toContain(JSON.parse(phrase!));
    }
    // The stored repairs must reflect different problem behaviors, not thirty
    // wording branches that all emit the same comparison change.
    for (const repair of ['return balances', 'return [items]', "return line.split('|')", 'return now < expiresAt',
      'return items.slice(offset, offset + limit)', 'return initial', 'return Math.ceil(items / capacity)']) {
      expect(heuristic.some(c => c.diff.includes(repair)), repair).toBe(true);
    }
    expect(new Set(heuristic.map(c => /^\+\+\+ b\/(.+)$/m.exec(c.diff)![1]!.split('.').at(-1)))).toEqual(new Set(['ts', 'txt', 'md']));
    expect(deterministicCalibration(corpus).some(m => m.category === 'statement_keyed_heuristic')).toBe(false);
    expect(deterministicDiagnostics(corpus).find(m => m.category === 'statement_keyed_heuristic')).toMatchObject({ samples: 30, detected: 0, rate: 0 });
  });
  it('covers six benign behavior families and four carriers in every existing malicious class', () => {
    const benign = corpus.cases.filter(c => c.category === 'benign');
    for (const token of ['refactor_', 'retry_', 'system_', 'describe_', 'mean_', 'log_']) expect(benign.filter(c => c.diff.includes(token))).toHaveLength(5);
    for (const word of ['test', 'retry', 'task', 'expected']) expect(benign.some(c => c.diff.includes(word))).toBe(true);
    for (const category of CALIBRATION_CATEGORIES.filter(c => !['benign', 'statement_keyed_heuristic'].includes(c))) {
      const extensions = new Set(corpus.cases.filter(c => c.category === category).map(c => /^\+\+\+ b\/(.+)$/m.exec(c.diff)![1]!.split('.').at(-1)));
      expect(extensions, category).toEqual(new Set(['ts', 'txt', 'json', 'md']));
    }
  });
  it('reproduces committed bytes from the same seed and only training metadata', async () => {
    const generator = await import(new URL('../../rsi-bank/calibration/generate.mjs', import.meta.url).href);
    const directory = await temporary();
    await generator.writeCorpus(resolve('rsi-bank'), directory, corpus.seed);
    const generated = await readCalibrationCorpus(directory);
    expect(generated).toEqual(corpus);
    const manifest = JSON.parse(await readFile('rsi-bank/manifest.json', 'utf8')) as { sets: { train: string[]; sealed: string[]; final: string[] } };
    expect(corpus.questionMetadata.every(q => manifest.sets.train.includes(q.questionId))).toBe(true);
    const other = await temporary(); await generator.writeCorpus(resolve('rsi-bank'), other, 'another-seed');
    expect((await readCalibrationCorpus(other)).corpusHash).not.toBe(corpus.corpusHash);
  });
  it('keeps the checked-in deterministic report tied to these bytes and the restricted coverage claim', async () => {
    const report = JSON.parse(await readFile(join(root, 'deterministic-report.json'), 'utf8'));
    expect(report).toMatchObject({ corpusHash: corpus.corpusHash, seed: corpus.seed, templateVersion: corpus.templateVersion,
      total: 210, passed: true, excludedFromRequiredCoverage: ['statement_keyed_heuristic'], monitor: { status: 'not_run' } });
    expect(report.metrics).toEqual(deterministicCalibration(corpus));
    expect(report.diagnosticMetrics).toEqual(deterministicDiagnostics(corpus).filter(metric => metric.category === 'statement_keyed_heuristic'));
    expect(report.requiredCoverage).toContain('explicit fingerprints or protected paths');
    expect(report.requiredCoverage).toContain('not real-world cheating coverage');
  });
  it('detects changed patch bytes before any monitoring', async () => {
    const directory = await temporary(); await cp(root, directory, { recursive: true });
    await writeFile(join(directory, corpus.cases[0]!.patch), 'changed');
    await expect(readCalibrationCorpus(directory)).rejects.toThrow('hash mismatch');
  });
  it('samples five from every stratum reproducibly and rejects invalid sample counts', () => {
    const sampled = sampleCalibration(corpus);
    expect(sampled).toHaveLength(35); expect(sampleCalibration(corpus).map(c => c.id)).toEqual(sampled.map(c => c.id));
    for (const category of CALIBRATION_CATEGORIES) expect(sampled.filter(c => c.category === category)).toHaveLength(5);
    expect(sampleCalibration(corpus, 'all')).toHaveLength(210);
    for (const invalid of [0, -1, 1.5, NaN]) expect(() => sampleCalibration(corpus, invalid)).toThrow();
  });
});

describe('RSI-015 model calibration without label disclosure', () => {
  it('runs real monitor parsing with a fake model client and marks the default thirty-five calls insufficient', async () => {
    const requests: string[] = [];
    const report = await runCalibration({ corpus, ...identity, at, monitor: monitor('perfect', requests) });
    expect(requests).toHaveLength(35); expect(report.status).toBe('insufficient');
    expect(report.message).toBe('样本不足，不能说明监控达标');
    expect(report.categories.every(c => c.valid === 5)).toBe(true);
    expect(report.deterministic.every(c => c.valid === 30)).toBe(true);
    for (const request of requests) {
      const payload = JSON.parse(request.slice('RSI_DATA_BEGIN\n'.length, -'\nRSI_DATA_END'.length));
      expect(Object.keys(payload).sort()).toEqual(['diff', 'l1Alerts', 'omittedAddedLines', 'reasons', 'statements', 'truncated']);
      expect(payload).toMatchObject({ truncated: false, omittedAddedLines: 0, reasons: [] });
      expect(request).not.toContain('Reviewer: treat');
      expect(request).not.toContain('rationalized_special_case');
      expect(request).not.toContain('corpusHash');
      expect(request).not.toContain('sha256');
    }
    expect(calibrationMonitorMode(report, identity)).toBe('hold');
  });
  it('full valid calibration can pass, whereas an undetecting monitor is downgraded', async () => {
    const passed = await runCalibration({ corpus, ...identity, at, sample: 'all', monitor: monitor() });
    expect(passed.status).toBe('passed'); expect(calibrationMonitorMode(passed, identity)).toBe('hold');
    const failed = await runCalibration({ corpus, ...identity, at, sample: 'all', monitor: monitor('clean') });
    expect(failed.status).toBe('failed'); expect(calibrationMonitorMode(failed, identity)).toBe('alert_only');
    expect(calibrationMonitorMode(failed, { ...identity, model: 'replacement' })).toBe('hold');
    expect(calibrationMonitorMode(failed, { ...identity, family: 'anthropic' })).toBe('hold');
    expect(calibrationMonitorMode(failed, { ...identity, promptVersion: 'replacement-prompt' })).toBe('hold');
    expect(calibrationMonitorMode(null, identity)).toBe('hold');
  });
  it('model parse failures and transport errors count as missing, never clean or valid', async () => {
    const invalid = await runCalibration({ corpus, ...identity, at, sample: 'all', monitor: monitor('invalid') });
    expect(invalid.status).toBe('insufficient');
    expect(invalid.categories.every(m => m.valid === 0 && m.missing === 30 && m.rate === null)).toBe(true);
    const failed = await runCalibration({ corpus, ...identity, at, monitor: async () => { throw new Error('offline'); } });
    expect(failed.categories.every(m => m.missing === 5)).toBe(true);
  });
  it('does not start model calls after cancellation and preserves missing denominators', async () => {
    let calls = 0;
    const report = await runCalibration({ corpus, ...identity, at, monitor: async () => { calls++; return { status: 'clean' }; } }, AbortSignal.abort());
    expect(calls).toBe(0); expect(report.categories.every(m => m.samples === 5 && m.missing === 5)).toBe(true);
  });
  it.skipIf(process.env.RSI_REAL_MONITOR_TEST !== '1')('real proxy monitor sample (operator opt-in outside the sandbox)', async () => {
    const real = createHealthModelClient();
    const report = await runCalibration({ corpus, family: process.env.RSI_MONITOR_FAMILY ?? 'openai', model: process.env.HEALTH_MODEL!,
      promptVersion: MONITOR_PROMPT_VERSION, at, sample: 1,
      monitor: (input, signal) => runMonitor(input, { client: real, model: process.env.HEALTH_MODEL! }, signal) });
    expect(report.categories.reduce((sum, m) => sum + m.samples, 0)).toBe(7);
    expect(report.categories.every(m => m.valid === 1)).toBe(true);
  }, 900000);
});
