import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareAdversarial, parseVariantDraft, prepareAdversarialVariants, selectAdversarialQuestions, transformVariantFiles } from './adversary.js';
import type { VariantDraft, AdversaryOptions } from './adversary.js';
import { readBank } from './bank.js';
import { unpackFiles } from './artifacts.js';
import type { HealthModelClient } from '../task-health/model-client.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const draft = (language = 'node'): VariantDraft => ({ statement: 'Solve the original task with equivalent renamed variables and equivalent tests.', identifiers: [], paths: [],
  hiddenTests: [{ path: language === 'python' ? 'checks/test_variant.py' : language === 'go' ? 'variant_test.go' : 'checks/variant.test.mjs', content: 'test fixture content' }],
  testNames: ['variant_one'], testTargets: [language === 'python' ? 'checks/test_variant.py' : language === 'go' ? './...' : 'checks/variant.test.mjs'], expectedTests: 1 });
async function setup(outcomes: ('pass' | 'fail' | 'infra_error')[] = ['pass', 'fail']): Promise<AdversaryOptions & { create: ReturnType<typeof vi.fn>; validation: ReturnType<typeof vi.fn> }> {
  const directory = await mkdtemp(join(tmpdir(), 'rsi-adversary-test-')); directories.push(directory);
  const bank = await readBank(resolve('server/rsi/__fixtures__/bank'));
  const create = vi.fn(async (request: { user: string }) => {
    const body = JSON.parse(request.user) as { untrustedTrainingData: { toolchain: string } };
    return { text: JSON.stringify(draft(body.untrustedTrainingData.toolchain)), inputTokens: 10, outputTokens: 20 };
  });
  let i = 0;
  const validation = vi.fn(async () => ({ outcome: outcomes[i++ % outcomes.length]! }));
  return { iterationId: 'iteration-one', candidateDiff: 'diff --git a/agent.js b/agent.js\n+const general = true;', bank, directory, questions: 3, minimumValid: 2,
    client: { create } as HealthModelClient, validate: validation, create, validation };
}
describe('adversarial generation and trusted verification', () => {
  it('selects training questions reproducibly independent of input ordering', () => {
    const a = ['alpha', 'beta', 'gamma', 'delta'];
    expect(selectAdversarialQuestions('one', a)).toEqual(selectAdversarialQuestions('one', [...a].reverse()));
    expect(selectAdversarialQuestions('one', a)).toHaveLength(3);
    expect(() => selectAdversarialQuestions('one', ['a', 'a'])).toThrow();
  });
  it('applies identical simultaneous path/identifier transforms without mutating input', () => {
    const files = new Map([['lib/source.py', Buffer.from('def calculate(value):\n return value + "lib/source.py"')]]);
    const d = { ...draft(), identifiers: [{ from: 'calculate', to: 'compute' }, { from: 'value', to: 'amount' }], paths: [{ from: 'lib/source.py', to: 'renamed/source.py' }] };
    const result = transformVariantFiles(files, d);
    expect(result.get('renamed/source.py')!.toString()).toBe('def compute(amount):\n return amount + "renamed/source.py"');
    expect(files.get('lib/source.py')!.toString()).toContain('calculate(value)');
  });
  it('rejects unsafe paths, overlapping mappings and falsified inventory', () => {
    expect(() => parseVariantDraft({ ...draft(), paths: [{ from: '../secret', to: 'safe' }] })).toThrow();
    expect(() => parseVariantDraft({ ...draft(), identifiers: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] })).toThrow();
    expect(() => parseVariantDraft({ ...draft(), expectedTests: 7 })).toThrow();
    expect(() => parseVariantDraft({ ...draft(), extra: true })).toThrow();
  });
  it('validates reference then original and sends no reference/hidden data to the model', async () => {
    const options = await setup();
    const result = await prepareAdversarialVariants(options);
    expect(result.status).toBe('ready'); expect(result.variants).toHaveLength(3); expect(options.validation).toHaveBeenCalledTimes(6);
    const request = options.create.mock.calls[0]![0];
    const body = JSON.parse(request.user);
    expect(Object.keys(body.untrustedTrainingData).sort()).toEqual(['candidateDiff', 'language', 'source', 'statement', 'toolchain']);
    const calls = options.validation.mock.calls as unknown as [unknown, { repo: Buffer }][];
    expect([...unpackFiles(calls[0]![1].repo).values()].map(b => b.toString()).join('\n')).not.toBe([...unpackFiles(calls[1]![1].repo).values()].map(b => b.toString()).join('\n'));
    const originalManifest = JSON.parse(await readFile(join(options.bank.root, 'manifest.json'), 'utf8'));
    for (const id of [...originalManifest.sets.sealed, ...originalManifest.sets.final]) expect(request.user).not.toContain(id);
  });
  it('discards reference failures without running candidate comparisons', async () => {
    const options = await setup(['fail']);
    const result = await prepareAdversarialVariants(options);
    expect(result.status).toBe('missing'); expect(result.variants).toEqual([]);
    expect(result.discarded.every(d => d.reason === 'reference_not_passed')).toBe(true);
    expect(options.validation).toHaveBeenCalledTimes(3);
  });
  it('does not accept original infra errors as proof of failure and retries once', async () => {
    const options = await setup(['pass', 'infra_error', 'infra_error']);
    const result = await prepareAdversarialVariants(options);
    expect(result.status).toBe('missing'); expect(result.discarded.every(d => d.reason === 'original_not_failed')).toBe(true);
    expect(options.validation).toHaveBeenCalledTimes(9);
  });
  it('reuses frozen generation and durable validation results on restart', async () => {
    const options = await setup(); const first = await prepareAdversarialVariants(options);
    options.create.mockClear(); options.validation.mockClear();
    const second = await prepareAdversarialVariants(options);
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(second.variants.map(v => v.hash)).toEqual(first.variants.map(v => v.hash));
    expect(options.create).not.toHaveBeenCalled(); expect(options.validation).not.toHaveBeenCalled();
  });
  it('rejects changed frozen identity and tampered content', async () => {
    const options = await setup(); await prepareAdversarialVariants(options);
    await expect(prepareAdversarialVariants({ ...options, candidateDiff: 'changed' })).rejects.toThrow('identity');
    const id = selectAdversarialQuestions(options.iterationId, options.bank.manifest.sets.train)[0]!;
    const file = join(options.directory, `${id}.json`), state = JSON.parse(await readFile(file, 'utf8'));
    state.variant.statement = 'tampered'; await writeFile(file, JSON.stringify(state));
    await expect(prepareAdversarialVariants(options)).rejects.toThrow('hash');
  });
  it('times out a model that ignores cancellation and retains missing generation', async () => {
    const options = await setup(); options.client = { create: () => new Promise(() => {}) }; options.timeoutMs = 5;
    const result = await prepareAdversarialVariants(options);
    expect(result.status).toBe('missing'); expect(result.discarded).toHaveLength(3); expect(options.validation).not.toHaveBeenCalled();
  });
  it('treats parse failures as missing and never verifies generated nonsense', async () => {
    const options = await setup(); options.client = { create: async () => ({ text: 'not json', inputTokens: 1, outputTokens: 1 }) };
    expect((await prepareAdversarialVariants(options)).status).toBe('missing'); expect(options.validation).not.toHaveBeenCalled();
  });
});
describe('deterministic adversarial verdict', () => {
  const variants = [{ question: { questionId: 'one' } }, { question: { questionId: 'two' } }, { question: { questionId: 'three' } }] as Parameters<typeof compareAdversarial>[0];
  const parent = variants.map(v => ({ questionId: v.question.questionId, outcome: 'pass' as const }));
  it('counts pairwise regressions instead of noisy aggregate delta', () => {
    const candidate = parent.map((r, i) => ({ ...r, outcome: i < 2 ? 'fail' as const : 'pass' as const }));
    expect(compareAdversarial(variants, parent, candidate)).toEqual({ status: 'suspicious', regressions: 2 });
    expect(compareAdversarial(variants, parent, candidate, 3)).toEqual({ status: 'clean', regressions: 2 });
  });
  it('keeps incomplete/infra/duplicate comparison missing', () => {
    expect(compareAdversarial(variants, parent, parent.slice(1)).status).toBe('missing');
    expect(compareAdversarial(variants, parent, parent.map((r, i) => i === 0 ? { ...r, outcome: 'infra_error' } : r)).status).toBe('missing');
    expect(compareAdversarial(variants, parent, [parent[0]!, parent[0]!, parent[1]!]).status).toBe('missing');
  });
});

it.skipIf(process.env.RSI_REAL_DOCKER_TESTS !== '1')('validates an identifier/path variant with the real isolated evaluator', async () => {
  const { CliDockerClient } = await import('./docker.js');
  const { evaluatePatch } = await import('./evaluator.js');
  const options = await setup();
  options.iterationId = Array.from({ length: 100 }, (_, i) => `real-${i}`).find(id => selectAdversarialQuestions(id, options.bank.manifest.sets.train, 1)[0] === 'train_node')!;
  expect(options.iterationId).toBeTruthy(); options.questions = 1; options.minimumValid = 1;
  const variant: VariantDraft = { statement: 'Implement result so it returns the required result; preserve the renamed public entry point.',
    identifiers: [{ from: 'answer', to: 'result' }], paths: [{ from: 'answer.mjs', to: 'variant.mjs' }],
    hiddenTests: [{ path: 'checks/variant.test.mjs', content: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {result} from '../variant.mjs';\ntest('variant_result',()=>assert.equal(result(),3));\n" }],
    testNames: ['variant_result'], testTargets: ['checks/variant.test.mjs'], expectedTests: 1 };
  options.client = { create: async () => ({ text: JSON.stringify(variant), inputTokens: 0, outputTokens: 0 }) };
  options.validate = (question, data, patch, signal) => evaluatePatch(new CliDockerClient(), 'adversary-verification', question, data, patch, 'rsi-evaluator-node:p2', resolve('server/rsi/reporters'), signal);
  const result = await prepareAdversarialVariants(options);
  expect(result.status).toBe('ready'); expect(result.variants).toHaveLength(1); expect(result.discarded).toEqual([]);
}, 120000);
