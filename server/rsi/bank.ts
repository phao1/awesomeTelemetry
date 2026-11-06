import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RsiQuestionMetadata } from '../../src/core/rsi-types.js';
import { canonicalJson } from './ledger.js';
import { relativePath, treeFiles, packTree } from './artifacts.js';

export type RsiBankToolchain = 'node' | 'python' | 'go';
export type RsiBankReport = 'node-test-events' | 'unittest-json' | 'go-test-json';
export interface RsiBankQuestion extends RsiQuestionMetadata {
  version: 1; language: 'javascript' | 'typescript' | 'python' | 'go';
  difficulty: 'easy' | 'medium' | 'hard'; toolchain: RsiBankToolchain;
  testTargets: string[]; report: RsiBankReport; expectedTests: number; timeoutSeconds: number;
}
export interface RsiBankManifest {
  version: 1; seed: string; mutationKillMin: number;
  sets: { smoke: string[]; train: string[]; sealed: string[]; final: string[] };
  questions: { id: string; language: RsiBankQuestion['language']; difficulty: RsiBankQuestion['difficulty']; mutationKillRatio: number }[];
}
export interface QuestionBank { root: string; manifest: RsiBankManifest; questions: Map<string, RsiBankQuestion>; datasetHash: string }
function shape(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error('Invalid bank object fields');
  return value as Record<string, unknown>;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100000 || value.some(v => typeof v !== 'string' || !v || v.length > 65536)
    || new Set(value).size !== value.length) throw new Error('Invalid bank string array');
  return value as string[];
}
function member(value: unknown, choices: string[]): void { if (!choices.includes(value as string)) throw new Error('Invalid bank enum'); }
function positive(value: unknown): void { if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('Invalid bank positive integer'); }
function ratio(value: unknown): void { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid bank ratio'); }
function id(value: unknown): void { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid bank ID'); }

export function validateQuestion(value: unknown): RsiBankQuestion {
  const q = shape(value, ['questionId', 'repository', 'testNames', 'filePaths', 'rareStrings', 'expectedValues',
    'version', 'language', 'difficulty', 'toolchain', 'testTargets', 'report', 'expectedTests', 'timeoutSeconds']);
  id(q.questionId);
  if (q.version !== 1 || typeof q.repository !== 'string' || !q.repository || q.repository.length > 65536) throw new Error('Invalid bank identity');
  member(q.language, ['javascript', 'typescript', 'python', 'go']); member(q.difficulty, ['easy', 'medium', 'hard']);
  member(q.toolchain, ['node', 'python', 'go']); member(q.report, ['node-test-events', 'unittest-json', 'go-test-json']);
  const chain = q.language === 'javascript' || q.language === 'typescript' ? 'node' : q.language;
  const reports = { node: 'node-test-events', python: 'unittest-json', go: 'go-test-json' };
  if (q.toolchain !== chain || q.report !== reports[chain as RsiBankToolchain]) throw new Error('Inconsistent bank toolchain/report');
  for (const key of ['testNames', 'filePaths', 'rareStrings', 'expectedValues', 'testTargets']) strings(q[key]);
  for (const file of q.filePaths as string[]) relativePath(file);
  const targets = q.testTargets as string[];
  if (!targets.length) throw new Error('Empty test targets');
  for (const target of targets) {
    const path = target.replace(/^\.\//, '');
    if (!(q.toolchain === 'go' && (path === '.' || path === '...'))) relativePath(path);
    if (target.startsWith('-') || /[\r\n]/.test(target) || (q.toolchain !== 'go' && target.includes('...'))) throw new Error('Invalid bank test target');
  }
  positive(q.expectedTests); positive(q.timeoutSeconds);
  return value as RsiBankQuestion;
}

export async function readBank(root: string): Promise<QuestionBank> {
  root = resolve(root);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Bank root cannot be a link');
  const files = await treeFiles(root);
  if (files.some(p => p.split('/').includes('.git'))) throw new Error('Bank contains .git');
  const json = async (file: string): Promise<unknown> => {
    const stat = await lstat(join(root, file)); if (stat.size > 1024 * 1024) throw new Error('Bank JSON limit');
    return JSON.parse(await readFile(join(root, file), 'utf8')) as unknown;
  };
  const raw = await json('manifest.json'), m = shape(raw, ['version', 'seed', 'mutationKillMin', 'sets', 'questions']);
  if (m.version !== 1 || typeof m.seed !== 'string' || !m.seed) throw new Error('Invalid bank manifest');
  ratio(m.mutationKillMin); shape(m.sets, ['smoke', 'train', 'sealed', 'final']);
  if (!Array.isArray(m.questions) || !m.questions.length) throw new Error('Empty bank');
  const manifest = raw as RsiBankManifest, questions = new Map<string, RsiBankQuestion>();
  for (const entry of manifest.questions) {
    shape(entry, ['id', 'language', 'difficulty', 'mutationKillRatio']); id(entry.id); ratio(entry.mutationKillRatio);
    if (questions.has(entry.id) || entry.mutationKillRatio < manifest.mutationKillMin) throw new Error('Duplicate/underqualified bank question');
    const q = validateQuestion(await json(`tasks/${entry.id}/meta.json`));
    if (q.questionId !== entry.id || q.language !== entry.language || q.difficulty !== entry.difficulty) throw new Error('Bank metadata mismatch');
    const directory = join(root, 'tasks', entry.id);
    for (const subdir of ['repo', 'hidden_tests']) if (!(await lstat(join(directory, subdir))).isDirectory()) throw new Error('Missing bank snapshot');
    await lstat(join(directory, 'reference.patch'));
    const statement = await readFile(join(directory, 'statement.md'), 'utf8');
    if (!statement.trim() || [q.questionId, q.repository, ...q.testNames, ...q.expectedValues].some(s => s && statement.toLowerCase().includes(s.toLowerCase()))) {
      throw new Error('Question statement leaks private metadata');
    }
    questions.set(entry.id, q);
  }
  const assigned = new Set<string>();
  for (const split of ['train', 'sealed', 'final', 'smoke'] as const) {
    const ids = strings(manifest.sets[split]);
    if (!ids.length || ids.some(id => !questions.has(id))) throw new Error('Invalid bank split');
    if (split === 'smoke') { if (ids.some(id => !manifest.sets.train.includes(id))) throw new Error('Smoke must be train subset'); }
    else {
      if (new Set(ids.map(id => questions.get(id)!.language)).size < 3) throw new Error('Split requires three languages');
      for (const id of ids) { if (assigned.has(id)) throw new Error('Bank split overlap'); assigned.add(id); }
    }
  }
  if (assigned.size !== questions.size || files.some(f => f.startsWith('tasks/') && !questions.has(f.split('/')[1]!))) throw new Error('Unassigned bank question');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const data = await readFile(join(root, file));
    hash.update(canonicalJson([file, data.length])); hash.update(data);
  }
  return { root, manifest, questions, datasetHash: hash.digest('hex') };
}

export interface QuestionData { repo: Buffer; hidden: Buffer; statement: string }
export async function readQuestionData(directory: string): Promise<QuestionData> {
  return { repo: await packTree(join(directory, 'repo')), hidden: await packTree(join(directory, 'hidden_tests')),
    statement: await readFile(join(directory, 'statement.md'), 'utf8') };
}
