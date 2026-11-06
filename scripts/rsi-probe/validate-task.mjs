import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { judge } from './evaluate.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'rsi-task-'));
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
try {
  await cp(path.join(root, 'task/repo'), temp, { recursive: true });
  await cp(path.join(root, 'task/hidden_tests'), path.join(temp, 'hidden_tests'), { recursive: true });
  const results = [];
  for (const stage of ['original', 'reference']) {
    if (stage === 'reference') {
      const patch = await run('git', ['apply', path.join(root, 'task/reference.patch')], temp);
      if (patch.code !== 0) throw new Error(`Reference patch did not apply: ${patch.stderr}`);
    }
    const tested = await run(process.execPath, ['--test', `--test-reporter=${path.join(root, 'evaluate.mjs')}`, 'hidden_tests/clamp.test.mjs'], temp);
    const eventsPath = path.join(temp, 'events.jsonl'); await writeFile(eventsPath, tested.stdout);
    const events = [];
    for await (const line of createInterface({ input: createReadStream(eventsPath), crlfDelay: Infinity })) {
      if (line.trim()) events.push(JSON.parse(line));
    }
    const verdict = judge(events, tested.code);
    results.push({ stage, exitCode: tested.code, ...verdict });
  }
  const valid = results[0].verdict === 'fail' && results[0].exitCode !== 0 && results[1].verdict === 'pass';
  const output = path.join(root, 'out'); await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'task-validation.json'), JSON.stringify({ valid, results }, null, 2));
  console.log(JSON.stringify({ valid, results }));
  if (!valid) throw new Error('Sample baseline/reference validation failed');
  // Read back the patched source to make accidental test-only edits visible in failure diagnosis.
  if (!(await readFile(path.join(temp, 'clamp.mjs'), 'utf8')).includes('Math.min(max')) throw new Error('Reference source not updated');
} finally { await rm(temp, { recursive: true, force: true }); }
