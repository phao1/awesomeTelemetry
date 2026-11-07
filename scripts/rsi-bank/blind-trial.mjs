#!/usr/bin/env node
// Blind difficulty check, run OUTSIDE any sandbox. A model gets only statement.md and repo/, one question at a time, and the hidden tests decide.
// Line counts and mutation scores say nothing about difficulty; this does. Needs the Codex CLI and the host toolchain of each question.
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readBank, runTests, workspace } from './validate.mjs';

const run = promisify(execFile), DEFAULT_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const USAGE = 'Usage: blind-trial.mjs --bank <dir> --model <model> [--effort low] [--codex <path>] <question-id>...';
export function flagsFor(args) {
  const out = { effort: 'low', codex: DEFAULT_CODEX, ids: [] };
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { out.ids.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!['bank', 'model', 'effort', 'codex'].includes(key) || !args[i + 1]) throw new Error(USAGE);
    out[key] = args[++i];
  }
  if (!out.bank || !out.model || !out.ids.length) throw new Error(USAGE);
  return out;
}
async function trial(question, flags) {
  const home = await mkdtemp(join(tmpdir(), 'rsi-blind-')), repo = join(home, 'repo');
  try {
    await cp(join(question.directory, 'repo'), repo, { recursive: true });
    for (const argv of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-qm', 'base']]) await run('git', ['-C', repo, ...argv]);
    const statement = await readFile(join(question.directory, 'statement.md'), 'utf8'), started = Date.now();
    // codex exec also reads piped stdin, so an open pipe makes it wait forever.
    const pending = run(flags.codex, ['exec', '-m', flags.model, '-c', `model_reasoning_effort="${flags.effort}"`, '-s', 'workspace-write', '-C', repo, '--skip-git-repo-check', statement], { timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
    pending.child.stdin.end();
    const failure = await pending.then(() => null, error => String(error.message).slice(0, 200));
    const space = await workspace(question);
    try {
      await rm(space.work, { recursive: true, force: true });
      await cp(repo, space.work, { recursive: true });
      await cp(join(question.directory, 'hidden_tests'), space.work, { recursive: true, force: true });
      const tests = await runTests(question, space);
      return { id: question.id, language: question.language, passed: tests.passed, cases: `${tests.cases.filter(c => c.passed).length}/${question.meta.expectedTests}`, minutes: ((Date.now() - started) / 60000).toFixed(1), failure };
    } finally { await space.cleanup(); }
  } finally { await rm(home, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = flagsFor(process.argv.slice(2)), bank = await readBank(resolve(flags.bank)), results = [];
  for (const id of flags.ids) {
    const question = bank.questions.find(q => q.id === id); if (!question) throw new Error(`Unknown question ${id}`);
    const result = await trial(question, flags); results.push(result); console.log(JSON.stringify(result));
  }
  console.log(`${results.filter(r => r.passed).length}/${results.length} passed with ${flags.model} at ${flags.effort} effort`);
}
