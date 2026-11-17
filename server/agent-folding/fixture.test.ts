import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runCommand } from '../benchmark/runner.js';
import { loadFoldingExample, loadSupportDeskFixture } from './catalog.js';
import { checkSupportDeskCase, SupportDeskBackend } from './fixture.js';

it('enforces return policy, record ownership, write gate, claim preconditions and address privacy on direct calls', async () => {
  const fixture = await loadSupportDeskFixture(), yes = () => true;
  const ana = new SupportDeskBackend(fixture, 'C-1001', yes);
  expect(ana.call('get_order', { order_id: '5003' })).toHaveProperty('error');
  expect(ana.call('get_tracking', { tracking_id: 'TRK-77003' })).toHaveProperty('error');
  expect(new SupportDeskBackend(fixture, 'C-1002', yes).call('create_return', { order_id: '5003', reason: 'old' })).toHaveProperty('error');
  expect(new SupportDeskBackend(fixture, 'C-1004', yes).call('create_return', { order_id: '5008', reason: 'final sale' })).toHaveProperty('error');
  expect(new SupportDeskBackend(fixture, 'C-1001').call('create_return', { order_id: '5001', reason: 'good' })).toHaveProperty('error');
  expect(ana.call('open_claim', { order_id: '5001', damage_description: 'broken', photos_received: false })).toHaveProperty('error');
  expect(ana.call('constructor', {})).toHaveProperty('error');
  expect(ana.actions).toHaveLength(0);
  expect(ana.call('create_return', { order_id: '5001', reason: 'too small' })).toHaveProperty('rma_id', 'RMA-5001');
  expect(JSON.stringify(ana.call('get_account', { customer_id: 'C-1001' }))).not.toContain('40 Mill');
  expect(JSON.stringify(ana.call('update_shipping_address', { customer_id: 'C-1001', address: 'A new secret address' }))).not.toContain('secret');
  expect(ana.privateAddressIn('Updated A new secret address')).toBe(true);
});
it('matches the pinned Python grader for every recorded trial and negative extra-write cases', async () => {
  const project = await loadFoldingExample();
  const rows = project.trials.filter(t => t.answer !== null).map(t => ({ task: project.cases.find(c => c.id === t.caseId)!, answer: t.answer!, actions: t.actions.map(a => ({ name: a.name, args: a.args })) }));
  // Test the real grader functions, extracted without importing the model driver.
  const source = await readFile(resolve('data/agent-folding/single-agent-loop-kit/examples/support-desk/evals/run_eval.py'), 'utf8');
  const script = `import ast, json, re, sys
with open(sys.argv[1], encoding='utf-8') as fixture:
    data = json.load(fixture)
nodes = [n for n in ast.parse(data['source']).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in ('_arg_matches', '_wanted', 'grade')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'pinned-grader', 'exec'))
out = []
for row in data['rows']:
    checks = {}
    for c in row['task']['checks']:
        k = {'action': 'actions', 'forbidden_action': 'forbidden_actions'}.get(c['kind'], c['kind'])
        if k == 'only_expected_writes':
            checks[k] = c['expected']
        else:
            checks.setdefault(k, []).append(c['expected'])
    out.append([v['ok'] for v in grade(checks, row['answer'], row['actions'])])
print(json.dumps(out))`;
  const temporary = await mkdtemp(join(tmpdir(), 'folding-pinned-grader-'));
  let python: boolean[][];
  try {
    const input = join(temporary, 'input.json');
    await writeFile(input, JSON.stringify({ source, rows }), { mode: 0o600 });
    const result = await runCommand(['python3', '-c', script, input], process.cwd(), process.env, 10000);
    expect(result.status).toBe('completed');
    python = JSON.parse(result.output) as boolean[][];
  } finally { await rm(temporary, { recursive: true, force: true }); }
  expect(rows.map(row => checkSupportDeskCase(row.task, row.answer, row.actions).map(c => c.passed))).toEqual(python);
  const task = project.cases.find(c => c.checks.some(k => k.kind === 'only_expected_writes'))!;
  expect(checkSupportDeskCase(task, '', [{ name: 'unexpected_write', args: {} }]).find(c => c.label.startsWith('only_expected_writes'))?.passed).toBe(false);
}, 20000);
