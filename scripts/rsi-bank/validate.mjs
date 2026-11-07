import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BANK = join(ROOT, 'rsi-bank');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const exact = (value, fields, label) => insist(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), `Invalid ${label} fields`);
const strings = value => Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0) && new Set(value).size === value.length;
const rank = text => createHash('sha256').update(text).digest('hex');
const quotas = { easy: [2, 1, 0], medium: [2, 1, 1], hard: [1, 1, 1] };

// Keep the original bank strict; the hard corpus has four tasks per language.
export function bankProfile(questions) {
  if (questions.length === 12 && questions.every(q => q.difficulty === 'hard')) return 'hard';
  return 'standard';
}
export function partition(questions, seed) {
  if (bankProfile(questions) === 'hard') {
    const sets = { smoke: [], train: [], sealed: [], final: [] };
    for (const language of ['javascript', 'python', 'go']) {
      const pool = questions.filter(q => q.language === language).map(q => q.id)
        .sort((a, b) => rank(`${seed}:${a}`).localeCompare(rank(`${seed}:${b}`)));
      insist(pool.length === 4, `Invalid hard stratum ${language}`);
      const counts = [2, 1, 1];
      let start = 0;
      for (const [j, name] of ['train', 'sealed', 'final'].entries()) {
        sets[name].push(...pool.slice(start, start + counts[j])); start += counts[j];
      }
      sets.smoke.push(sets.train.filter(id => pool.includes(id))
        .sort((a, b) => rank(`${seed}:smoke:${a}`).localeCompare(rank(`${seed}:smoke:${b}`)))[0]);
    }
    for (const ids of Object.values(sets)) ids.sort();
    return sets;
  }
  const sets = { smoke: [], train: [], sealed: [], final: [] };
  for (const language of ['javascript', 'python', 'go']) {
    for (const [difficulty, counts] of Object.entries(quotas)) {
      const pool = questions.filter(q => q.language === language && q.difficulty === difficulty).map(q => q.id)
        .sort((a, b) => rank(`${seed}:${a}`).localeCompare(rank(`${seed}:${b}`)));
      insist(pool.length === counts.reduce((a, b) => a + b, 0), `Invalid stratum ${language}/${difficulty}`);
      let start = 0;
      for (const [i, name] of ['train', 'sealed', 'final'].entries()) {
        sets[name].push(...pool.slice(start, start + counts[i])); start += counts[i];
      }
    }
    const eligible = sets.train.filter(id => questions.find(q => q.id === id).language === language);
    sets.smoke.push(eligible.sort((a, b) => rank(`${seed}:smoke:${a}`).localeCompare(rank(`${seed}:smoke:${b}`)))[0]);
  }
  for (const ids of Object.values(sets)) ids.sort();
  return sets;
}

export async function filesUnder(directory) {
  insist(!(await lstat(directory)).isSymbolicLink(), `Symlink forbidden: ${directory}`);
  const paths = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      insist(!entry.isSymbolicLink(), `Symlink forbidden: ${join(dir, entry.name)}`);
      if (entry.isDirectory()) { insist(entry.name !== '.git', 'Snapshots must not contain .git'); await walk(join(dir, entry.name)); }
      else { insist(entry.isFile(), 'Only regular files allowed'); paths.push(relative(directory, join(dir, entry.name)).split(sep).join('/')); }
    }
  }
  await walk(directory);
  return paths.sort();
}
export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && ![...path].some(c => c.codePointAt(0) < 32);
}

export async function readBank(bank = BANK) {
  const manifest = await json(join(bank, 'manifest.json'));
  exact(manifest, ['version', 'seed', 'mutationKillMin', 'sets', 'questions'], 'manifest');
  insist(manifest.version === 1 && typeof manifest.seed === 'string' && manifest.seed.length > 0, 'Invalid manifest identity');
  insist(Number.isFinite(manifest.mutationKillMin) && manifest.mutationKillMin >= 0 && manifest.mutationKillMin <= 1, 'Invalid mutation threshold');
  exact(manifest.sets, ['smoke', 'train', 'sealed', 'final'], 'sets');
  insist(Array.isArray(manifest.questions), 'Invalid questions');
  const hard = bankProfile(manifest.questions) === 'hard';
  insist(manifest.questions.length === (hard ? 12 : 30), 'Expected 30 questions or 12 hard questions');
  if (hard) insist(manifest.mutationKillMin >= 0.7, 'Hard mutation threshold must be at least 0.7');
  const ids = manifest.questions.map(q => q.id);
  insist(strings(ids) && ids.every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)), 'Invalid or duplicate question IDs');
  for (const [name, count] of Object.entries(hard ? { smoke: 3, train: 6, sealed: 3, final: 3 } : { smoke: 3, train: 15, sealed: 9, final: 6 })) {
    insist(strings(manifest.sets[name]) && manifest.sets[name].length === count && manifest.sets[name].every(id => ids.includes(id)), `Invalid ${name}`);
  }
  insist(manifest.sets.smoke.every(id => manifest.sets.train.includes(id)), 'Smoke must be a train subset');
  insist(new Set([...manifest.sets.train, ...manifest.sets.sealed, ...manifest.sets.final]).size === manifest.questions.length, 'Main sets must be disjoint and exhaustive');
  const expectedSets = partition(manifest.questions, manifest.seed);
  insist(Object.keys(expectedSets).every(name => JSON.stringify(expectedSets[name]) === JSON.stringify([...manifest.sets[name]].sort())), 'Seeded stratification mismatch');
  const directories = (await readdir(join(bank, 'tasks'))).sort();
  insist(JSON.stringify(directories) === JSON.stringify([...ids].sort()), 'Task directory inventory mismatch');
  const questions = [];
  for (const q of manifest.questions) {
    exact(q, ['id', 'language', 'difficulty', 'mutationKillRatio'], 'question summary');
    insist(Number.isFinite(q.mutationKillRatio) && q.mutationKillRatio >= 0 && q.mutationKillRatio <= 1, `Invalid mutation ratio: ${q.id}`);
    const directory = join(bank, 'tasks', q.id);
    const meta = await json(join(directory, 'meta.json'));
    exact(meta, ['questionId', 'repository', 'testNames', 'filePaths', 'rareStrings', 'expectedValues', 'version', 'language', 'difficulty', 'toolchain', 'testTargets', 'report', 'expectedTests', 'timeoutSeconds'], 'meta');
    insist(meta.version === 1 && meta.questionId === q.id && meta.language === q.language && meta.difficulty === q.difficulty, `Metadata mismatch: ${q.id}`);
    const toolchain = { javascript: 'node', typescript: 'node', python: 'python', go: 'go' }[meta.language];
    insist(toolchain && meta.toolchain === toolchain && meta.report === { node: 'node-test-events', python: 'unittest-json', go: 'go-test-json' }[toolchain], `Invalid language/report: ${q.id}`);
    insist(['easy', 'medium', 'hard'].includes(meta.difficulty), 'Invalid difficulty');
    insist(typeof meta.repository === 'string' && meta.repository.length > 0, 'Invalid repository');
    for (const field of ['testNames', 'filePaths', 'rareStrings', 'expectedValues', 'testTargets']) insist(strings(meta[field]), `Invalid ${field}: ${q.id}`);
    insist(Number.isSafeInteger(meta.expectedTests) && meta.expectedTests > 0 && meta.expectedTests === meta.testNames.length, `Invalid expectedTests: ${q.id}`);
    insist(Number.isSafeInteger(meta.timeoutSeconds) && meta.timeoutSeconds > 0 && meta.timeoutSeconds <= 300, 'Invalid timeout');
    const repoFiles = await filesUnder(join(directory, 'repo'));
    const hiddenFiles = await filesUnder(join(directory, 'hidden_tests'));
    insist(hiddenFiles.length > 0 && repoFiles.length > 0, `Empty fixture: ${q.id}`);
    const paths = [...new Set([...repoFiles, ...hiddenFiles])].sort();
    if (hard) insist(meta.filePaths.every(p => !/^(?:README\.md|index\.[^/]+|main\.[^/]+|go\.mod|package\.json)$/i.test(p.split('/').at(-1))), `Common fingerprint path: ${q.id}`);
    insist((hard ? meta.filePaths.every(p => safePath(p) && paths.includes(p))
      : JSON.stringify(paths) === JSON.stringify([...meta.filePaths].sort())) && paths.every(safePath), `filePaths inventory mismatch: ${q.id}`);
    insist(meta.testTargets.length > 0 && meta.testTargets.every(p => toolchain === 'go' ? p === './...' || (p.startsWith('./') && safePath(p.slice(2)) && hiddenFiles.some(file => file.startsWith(p.slice(2) + '/'))) : safePath(p) && hiddenFiles.includes(p)), `Invalid targets: ${q.id}`);
    const testText = (await Promise.all(hiddenFiles.map(p => readFile(join(directory, 'hidden_tests', p), 'utf8')))).join('\n');
    for (const value of [...meta.testNames, ...meta.rareStrings]) insist(testText.includes(value), `Untruthful test fingerprint ${q.id}: ${value}`);
    for (const value of meta.expectedValues) insist(testText.includes(value) || testText.includes(JSON.stringify(value).slice(1, -1)) || testText.includes(value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")), `Untruthful expected fingerprint ${q.id}: ${value}`);
    const statement = await readFile(join(directory, 'statement.md'), 'utf8');
    insist(statement.trim().length > 80, `Empty statement: ${q.id}`);
    for (const value of [q.id, meta.repository, ...meta.testNames, ...meta.expectedValues, ...meta.rareStrings]) insist(!statement.toLowerCase().includes(value.toLowerCase()), `Statement leakage ${q.id}: ${value}`);
    const patch = await readFile(join(directory, 'reference.patch'), 'utf8');
    insist(patch.startsWith('diff --git ') && !patch.includes('GIT binary patch'), `Invalid reference patch: ${q.id}`);
    const changed = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]);
    insist(changed.length > 0 && changed.every(p => safePath(p) && repoFiles.includes(p) && !hiddenFiles.includes(p) && !/(?:test|go\.mod|package\.json)/.test(p)), `Reference must modify only source: ${q.id}`);
    if (hard) {
      const sources = repoFiles.filter(p => /\.(?:mjs|js|py|go)$/.test(p) && !/(?:^|\/)(?:test_|.*(?:\.test\.|_test\.))/.test(p));
      const lines = (await Promise.all(sources.map(p => readFile(join(directory, 'repo', p), 'utf8'))))
        .reduce((sum, text) => sum + text.trimEnd().split('\n').length, 0);
      insist(sources.length >= 1 && sources.length <= 40 && lines >= 1 && lines <= 3000, `Hard source size: ${q.id}: ${sources.length} files / ${lines} lines`);
      insist(changed.length >= 1 && patch.split('\n').filter(line => /^[+-]/.test(line) && !/^(?:---|\+\+\+)/.test(line)).length >= 4, `Hard reference too small: ${q.id}`);
      const hiddenCount = toolchain === 'go' ? [...testText.matchAll(/^func Test[A-Za-z0-9_]+\(t \*testing\.T\)/gm)].length : meta.expectedTests;
      insist(hiddenCount >= 40 && meta.timeoutSeconds <= 60, `Hard test budget: ${q.id}`);
    }
    questions.push({ ...q, meta, directory });
  }
  return { manifest, questions };
}

/** Bounded asynchronous execution; callers distinguish build and test timeouts. */
export function command(program, args, { cwd, timeout = 30000, env = {} } = {}) {
  return new Promise(resolveResult => {
    let output = '', timedOut = false, overflow = false, spawnError = null;
    const child = spawn(program, args, { cwd, env: { ...process.env, ...env }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const terminate = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Process may have exited between check and kill. */ } };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeout);
    const collect = chunk => { output += chunk.toString(); if (output.length > 8 * 1024 * 1024) { overflow = true; output = output.slice(0, 8 * 1024 * 1024); terminate(); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { spawnError = error.message; });
    child.on('close', code => { clearTimeout(timer); resolveResult({ code, output, timedOut, overflow, spawnError }); });
  });
}

const NODE_REPORTER = `export default async function* (events) {
  for await (const e of events) {
    if (e.type === 'test:dequeue') yield JSON.stringify({rsiStart:true, name:e.data.name}) + '\\n';
    if ((e.type === 'test:pass' || e.type === 'test:fail') && e.data.details?.type !== 'suite') {
      yield JSON.stringify({rsiCase: true, passed: e.type === 'test:pass' && !e.data.skip && !e.data.todo, name:e.data.name}) + '\\n';
    }
  }
}\n`;
const PYTHON_REPORTER = `import importlib.util, json, os, sys, unittest
sys.path.insert(0, os.getcwd())
suite = unittest.TestSuite()
for index, path in enumerate(sys.argv[1:]):
    spec = importlib.util.spec_from_file_location('case_module_' + str(index), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
class Result(unittest.TestResult):
    def startTest(self, test):
        super().startTest(test)
        self.failed_current = False
        print(json.dumps({'rsiStart': True, 'name': test._testMethodName}), flush=True)
    def addFailure(self, test, err):
        self.failed_current = True
        super().addFailure(test, err)
    def addError(self, test, err):
        self.failed_current = True
        super().addError(test, err)
    def addSkip(self, test, reason):
        self.failed_current = True
        super().addSkip(test, reason)
    def addExpectedFailure(self, test, err):
        self.failed_current = True
        super().addExpectedFailure(test, err)
    def addUnexpectedSuccess(self, test):
        self.failed_current = True
        super().addUnexpectedSuccess(test)
    def addSubTest(self, test, subtest, err):
        if err is not None: self.failed_current = True
        super().addSubTest(test, subtest, err)
    def stopTest(self, test):
        print(json.dumps({'rsiCase': True, 'passed': not self.failed_current, 'name': test._testMethodName}))
        super().stopTest(test)
result = Result()
suite.run(result)
sys.exit(0 if result.wasSuccessful() and not result.skipped else 1)
`;

export function parseReport(output, toolchain) {
  const cases = [];
  for (const line of output.split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (toolchain === 'go') {
      if (event.Test && !event.Test.includes('/') && ['pass', 'fail', 'skip'].includes(event.Action)) cases.push({ name: event.Test, passed: event.Action === 'pass' });
    } else if (event.rsiCase === true && typeof event.passed === 'boolean' && typeof event.name === 'string') cases.push({ name: event.name, passed: event.passed });
  }
  return cases;
}

export async function availability(toolchain, docker = false) {
  const executable = docker ? 'docker' : { node: process.execPath, python: 'python3', go: 'go' }[toolchain];
  const args = !docker && toolchain === 'go' ? ['version'] : ['--version'];
  const result = await command(executable, args);
  return result.code === 0 && !result.spawnError && !result.timedOut;
}

export async function workspace(question, reference = false) {
  const temporary = await mkdtemp(join(tmpdir(), 'rsi-bank-'));
  try {
    const work = join(temporary, 'repo');
    await cp(join(question.directory, 'repo'), work, { recursive: true });
    if (reference) {
      const applied = await command('git', ['apply', join(question.directory, 'reference.patch')], { cwd: work });
      insist(applied.code === 0 && !applied.timedOut && !applied.spawnError, `Reference patch failed: ${question.id}: ${applied.output}`);
    }
    await cp(join(question.directory, 'hidden_tests'), work, { recursive: true, force: true });
    const reporters = join(temporary, 'reporters');
    const goCache = join(temporary, 'go-cache');
    await mkdir(goCache);
    await mkdir(reporters);
    await writeFile(join(temporary, 'node-reporter.mjs'), NODE_REPORTER);
    await writeFile(join(temporary, 'python-reporter.py'), PYTHON_REPORTER);
    // Separate read-only reporter mount; never copy reporters into the candidate repo.
    await cp(join(temporary, 'node-reporter.mjs'), join(reporters, 'node-reporter.mjs'), { recursive: true });
    await cp(join(temporary, 'python-reporter.py'), join(reporters, 'python-reporter.py'));
    return { temporary, work, reporters, goCache, cleanup: () => rm(temporary, { recursive: true, force: true }) };
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

export async function runTests(question, space, docker = false) {
  const { meta } = question;
  const prefix = docker ? '/rsi-tools' : space.reporters;
  const [program, args] = meta.toolchain === 'node' ? [docker ? 'node' : process.execPath, ['--test', '--test-reporter', `${prefix}/node-reporter.mjs`, ...meta.testTargets]]
    : meta.toolchain === 'python' ? ['python3', [`${prefix}/python-reporter.py`, ...meta.testTargets]]
      : ['go', ['test', '-json', '-count=1', '-vet=off', ...meta.testTargets]];
  let result;
  if (docker) {
    const image = { node: 'node:24-bookworm-slim', python: 'python:3.9-slim', go: 'golang:1.23-bookworm' }[meta.toolchain];
    const name = `rsi-bank-${randomUUID()}`;
    try {
      result = await command('docker', ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m', '--cpus=1', '--tmpfs', '/tmp:rw,exec,size=384m', '-e', 'GOCACHE=/rsi-cache/build', '-e', 'GOPATH=/rsi-cache/path', '-e', 'GOPROXY=off', '-e', 'GOSUMDB=off', '-e', 'GOTOOLCHAIN=local', '-e', 'CGO_ENABLED=0', '-e', 'PYTHONDONTWRITEBYTECODE=1', '-v', `${space.work}:/workspace:rw`, '-v', `${space.reporters}:/rsi-tools:ro`, '-v', `${space.goCache}:/rsi-cache:rw`, '-w', '/workspace', image, program, ...args], { timeout: meta.timeoutSeconds * 1000 });
    } finally { await command('docker', ['rm', '-f', name], { timeout: 10000 }); }
  } else result = await command(program, args, { cwd: space.work, timeout: meta.timeoutSeconds * 1000, env: { GOCACHE: join(space.temporary, 'go-cache'), GOPATH: join(space.temporary, 'go'), GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', CGO_ENABLED: '0', PYTHONDONTWRITEBYTECODE: '1' } });
  const cases = parseReport(result.output, meta.toolchain);
  const started = result.output.split('\n').some(line => {
    try { const event = JSON.parse(line); return meta.toolchain === 'go' ? event.Action === 'run' && meta.testNames.includes(event.Test) : event.rsiStart === true && meta.testNames.includes(event.name); } catch { return false; }
  });
  const complete = cases.length === meta.expectedTests && new Set(cases.map(c => c.name)).size === meta.expectedTests && cases.every(c => meta.testNames.includes(c.name));
  const infra = result.timedOut || result.overflow || result.spawnError;
  return { ...result, cases, complete, started, passed: !infra && complete && result.code === 0 && cases.every(c => c.passed) };
}

/** Visible suites are part of a hard snapshot's supported development workflow. */
export async function runVisibleTests(question, space, docker = false) {
  const paths = (await filesUnder(join(question.directory, 'repo'))).filter(path =>
    question.meta.toolchain === 'node' ? /\.test\.m?js$/.test(path)
      : question.meta.toolchain === 'python' ? /(?:^|\/)test_[^/]+\.py$/.test(path) : /_test\.go$/.test(path));
  insist(paths.length > 0, `Missing visible tests: ${question.id}`);
  let testTargets = paths;
  const names = [];
  if (question.meta.toolchain === 'go') {
    for (const path of paths) {
      const source = await readFile(join(question.directory, 'repo', path), 'utf8');
      names.push(...[...source.matchAll(/^func (Test[A-Za-z0-9_]+)\(t \*testing\.T\)/gm)].map(match => match[1]));
    }
    insist(names.length > 0, `Missing visible Go cases: ${question.id}`);
    testTargets = ['-run', `^(?:${names.join('|')})$`, './...'];
  }
  const outcome = await runTests({ ...question, meta: { ...question.meta, testTargets } }, space, docker);
  const passed = !outcome.timedOut && !outcome.overflow && !outcome.spawnError && outcome.code === 0
    && outcome.cases.length > 0 && outcome.cases.every(test => test.passed)
    && (!names.length || outcome.cases.length === names.length);
  return { ...outcome, passed };
}

export async function validate({ bank = BANK, docker = false, log = console.log } = {}) {
  const { manifest, questions } = await readBank(bank);
  const result = { passed: [], skipped: [], failed: [] };
  const hard = bankProfile(manifest.questions) === 'hard';
  const available = {};
  for (const toolchain of ['node', 'python', 'go']) available[toolchain] = await availability(toolchain, docker);
  for (const question of questions) {
    let original, reference;
    try {
      reference = await workspace(question, true);
      if (!available[question.meta.toolchain]) { result.skipped.push(question.id); log(`SKIP ${question.id}: ${docker ? 'docker' : question.meta.toolchain} toolchain unavailable; reference patch applies`); continue; }
      original = await workspace(question);
      if (hard) {
        const visibleOriginal = await runVisibleTests(question, original, docker);
        const visibleFixed = await runVisibleTests(question, reference, docker);
        insist(visibleOriginal.passed && visibleFixed.passed, `Visible tests must pass before and after: ${question.id}\n${visibleOriginal.output}\n${visibleFixed.output}`);
      }
      const baseline = await runTests(question, original, docker);
      const fixed = await runTests(question, reference, docker);
      insist(baseline.complete && !baseline.passed && baseline.cases.some(c => !c.passed) && !baseline.timedOut && !baseline.spawnError, `Original must execute exactly ${question.meta.expectedTests} cases and fail: ${question.id}\n${baseline.output}`);
      insist(fixed.passed, `Reference must pass exactly ${question.meta.expectedTests} cases: ${question.id}\n${fixed.output}`);
      insist(question.mutationKillRatio >= manifest.mutationKillMin, `Mutation threshold not met: ${question.id}; run mutate.mjs`);
      result.passed.push(question.id); log(`PASS ${question.id}: original fails; reference ${fixed.cases.length}/${question.meta.expectedTests}; mutation=${question.mutationKillRatio.toFixed(3)}`);
    } catch (error) { result.failed.push(question.id); log(`FAIL ${error.message}`); }
    finally { await original?.cleanup(); await reference?.cleanup(); }
  }
  log(JSON.stringify({ mode: docker ? 'docker' : 'local', ...result }));
  return result;
}
export function options(argv) {
  const result = { bank: BANK, docker: false };
  let selected = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--docker' && !result.docker) result.docker = true;
    else if (argv[i] === '--bank' && !selected && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      result.bank = resolve(argv[++i]); selected = true;
    } else throw new Error('Usage: node scripts/rsi-bank/{validate,mutate}.mjs [--docker] [--bank <directory>]');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await validate(options(process.argv.slice(2))); if (result.failed.length) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
