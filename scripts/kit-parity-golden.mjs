/** Python reference outputs only. Pinned Anthropic kit, Apache-2.0; see data/agent-folding/NOTICE.md. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
const run = promisify(execFile);
const root = 'data/agent-folding/single-agent-loop-kit';
const scripts = `${root}/skill/scripts`;
const example = `${root}/examples/support-desk`;
const traces = `${example}/traces/traces.jsonl`;
async function jsonl(path) {
  const rows = [];
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}
async function python(script, args) {
  try { return { code: 0, stdout: (await run(process.env.PYTHON ?? 'python3', [`${scripts}/${script}.py`, ...args])).stdout }; }
  catch (error) { if (error.code === 1 && error.stdout) return { code: 1, stdout: error.stdout }; throw error; }
}
const hashes = {};
for (const script of ['coupling_map', 'chain_coverage', 'compare', 'estimate']) {
  hashes[script] = createHash('sha256').update(await readFile(`${scripts}/${script}.py`)).digest('hex');
}
const golden = { revision: 'c43796287b83bec847db923f07131d1cc8de750d', hashes, traces: await jsonl(traces), coupling: JSON.parse((await python('coupling_map', [traces, '--json'])).stdout), runs: [] };
// Retain only fields consumed by the four algorithms, not example answers/prompts.
const keys = ['prompt_id', 'status', 'grade', 'latency_s', 'in_tokens', 'out_tokens', 'model_calls', 'by_agent', 'actions'];
for (const path of ['example-run/results', 'example-run/as-tool/results']) {
  const flow = `${example}/${path}`;
  const before = (await jsonl(`${flow}/baseline/results.jsonl`)).map(row => Object.fromEntries(keys.filter(k => k in row).map(k => [k, k === 'actions' ? row[k].map(a => ({ name: a.name })) : row[k]])));
  const after = (await jsonl(`${flow}/v1/results.jsonl`)).map(row => Object.fromEntries(keys.filter(k => k in row).map(k => [k, k === 'actions' ? row[k].map(a => ({ name: a.name })) : row[k]])));
  golden.runs.push({ path, before, after, coverage: await python('chain_coverage', [traces, flow, 'baseline', '--exclude', 'router']), compare: await python('compare', [flow, 'baseline', 'v1', '--fail-if-worse']), estimate: await python('estimate', [flow, 'baseline', '--reps', '2']) });
}
await mkdir('src/core/__fixtures__', { recursive: true });
await writeFile('src/core/__fixtures__/agent-folding-kit-golden.json', JSON.stringify(golden, null, 2) + '\n');
console.log('Generated Python-only kit parity golden (2 recorded runs, 4 reference scripts).');
