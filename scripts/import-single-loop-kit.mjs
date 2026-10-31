/** Import the pinned Apache-2.0 reference as reviewable data; never called by HTTP. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const command = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = 'c43796287b83bec847db923f07131d1cc8de750d';
const reference = resolve(process.argv[2] ?? join(root, '.local-runtime/reference/single-agent-loop-kit'));
const destination = join(root, 'data/agent-folding'), vendor = join(destination, 'single-agent-loop-kit');
const head = (await command('git', ['rev-parse', 'HEAD'], { cwd: reference })).stdout.trim();
const publishedAt = new Date((await command('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: reference })).stdout.trim()).toISOString();
if (head !== revision || (await command('git', ['diff', '--name-only', 'HEAD'], { cwd: reference })).stdout.trim()) throw new Error('Use the unmodified pinned upstream checkout.');
const upstream = `https://github.com/anthropics/single-agent-loop-kit/blob/${revision}/`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = (await command('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: reference })).stdout.trim().split('\n');
const files = {};
for (const name of tracked) {
  if (!name || name.startsWith('.') || name.startsWith('tests/')) continue;
  const bytes = await readFile(join(reference, name)); files[name] = { sha256: digest(bytes), bytes: bytes.byteLength, url: upstream + name };
  const target = join(vendor, name); await mkdir(dirname(target), { recursive: true }); await copyFile(join(reference, name), target);
}
const jsonl = async name => {
  const rows = []; let line = 0;
  for await (const value of createInterface({ input: createReadStream(join(reference, name)), crlfDelay: Infinity })) {
    line++; if (value.trim()) rows.push({ value: JSON.parse(value), line });
  }
  return rows;
};
const sources = [
  { id: 'published-returns', kind: 'official_recording', title: 'Published returns fold · 12 tasks × 2 reps', url: upstream + 'examples/support-desk/example-run/README.md', revision, observedAt: null, model: 'claude-opus-5', limitations: ['One person and one recorded model; two repetitions only.', 'Retailer names were changed after execution; no run.json for this experiment.', 'Historical experimental revisions are not in the published initial-commit history.', 'Current code, safety rules and tasks changed after the recordings.'] },
  { id: 'published-diagnostics', kind: 'official_recording', title: 'Published diagnostics as-tool · 17 tasks plus targeted reruns', url: upstream + 'examples/support-desk/example-run/as-tool/README.md', revision, observedAt: null, model: 'claude-opus-5', limitations: ['One person and one recorded model; supplemental reruns cover t01/t10 only.', 't18/t19 were not run on a real model; main loop lacks independent diagnosis lookup.', 'Recorded historical commits are provenance only, not publicly checkoutable revisions.'] },
  { id: 'generated-traffic', kind: 'synthetic_traffic', title: 'Seed-7 fictional traffic · 200 traces', url: upstream + 'examples/support-desk/traces/traces.jsonl', revision, observedAt: null, model: null, limitations: ['Generated synthetic traffic, not real enterprise production.', 'Adjacent calls and token/time shares identify candidates, not causal benefit.'] },
  { id: 'reference-code', kind: 'source_code', title: 'Pinned reference code and current 19-case golden set', url: upstream + 'README.md', revision, observedAt: null, model: null, limitations: ['Unmaintained reference implementation; no production guarantee.', 'The finished single_loop, merge/upkeep and no-eval workflow were not real-model validated.', 'Fictional appliance retailer and made-up customer records.'] },
];
const evidence = [], evidenceIndex = new Map();
function add(sourceId, path, pointer, kind, content, complete = true) {
  const identity = `${sourceId}:${path}:${pointer}`; if (evidenceIndex.has(identity)) return evidenceIndex.get(identity);
  const id = 'ref-' + digest(identity).slice(0, 20), body = content == null ? null : String(content), buffer = body === null ? null : Buffer.from(body);
  const limit = buffer === null || buffer.length <= 16384;
  evidence.push({ id, sourceId, path, pointer, sha256: files[path]?.sha256 ?? null, kind, excerpt: body?.slice(0, 240) ?? null,
    text: limit ? body : null, complete: complete && limit, native: null }); evidenceIndex.set(identity, id); return id;
}
const code = async (path, pointer = null) => add('reference-code', path, pointer, 'code', await readFile(join(reference, path), 'utf8'));
const roles = ['router', 'orders', 'shipping', 'returns', 'account', 'diagnostics', 'claims'];
const proposals = { router: 'main', orders: 'merge', shipping: 'merge', returns: 'fold', account: 'fold', diagnostics: 'as_tool', claims: 'keep' };
const reasons = {
  router: ['保留统一主循环与端到端质量责任；审查主提示和工具目录的邻域影响。', 'Keep one main loop and end-to-end ownership; inspect neighboring effects of prompt and tool changes.'],
  orders: ['与 shipping 形成顺序数据依赖；合并为 track_order 是候选，尚无该合并的真实对照。', 'Orders and shipping have a sequential data dependency. A track_order merge is a candidate, not a measured merge win.'],
  shipping: ['配送日期来自 tracking，而不是订单状态；合并仍必须保留该步骤及终端验收。', 'The delivery date comes from tracking, not order status. A merge must preserve that step and its terminal check.'],
  returns: ['退货流程可变成 skill 与带政策前置校验的工具，但已发布折叠试验有邻域回归。', 'Return procedure can become a skill plus policy-checked tools, but the published fold has a neighboring regression.'],
  account: ['薄 API 包装可折入工具；隐私与用户身份应由执行层约束，尚缺独立折叠实测。', 'Thin account wrappers can become tools; privacy and identity require runtime enforcement. A measured account-only fold is missing.'],
  diagnostics: ['大设备日志有隔离价值，可保留为返回结构化结论的工具；需检验更小日志输出替代方案。', 'Large device logs can justify isolation behind a structured tool; test whether smaller log outputs remove that need.'],
  claims: ['保险方拥有对话，且需要直接多轮澄清；保留完整交接，不能擅自删除外部职责。', 'The insurer owns a direct multi-turn conversation. Preserve handoff and external responsibility.'],
};
// Export only reviewed, pinned module data. No SDK import or model call is made.
const python = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom app import backend,tools,orchestrator\np=Path(sys.argv[1]); data={"today":backend.TODAY,"returnWindowDays":backend.RETURN_WINDOW_DAYS,"customers":backend._CUSTOMERS,"orders":backend._ORDERS,"tracking":backend._TRACKING,"errorCodes":backend._ERROR_CODES,"serials":backend._DEVICE_SERIALS,"deviceLogs":{s:backend._device_log(s) for s in backend._DEVICE_SERIALS},"prompts":{s.stem:s.read_text() for s in (p/"app/prompts").glob("*.md")},"toolsByAgent":tools.TOOLS_BY_AGENT,"routerTools":orchestrator.ROUTER_TOOLS,"writes":sorted(tools.WRITES),"returnsSkill":(p/"single_loop/skills/returns/SKILL.md").read_text(),"systemPrompt":(p/"single_loop/system.md").read_text(),"diagnosticsPrompt":(p/"single_loop/diagnostics_agent.md").read_text()}\nprint(json.dumps(data))`;
const fixture = JSON.parse((await command(process.env.PYTHON ?? 'python3', ['-c', python, join(reference, 'examples/support-desk')], { maxBuffer: 2 * 1024 * 1024 })).stdout);
const agents = [];
for (const id of roles) {
  const ref = await code(`examples/support-desk/app/prompts/${id}.md`);
  const definitions = id === 'router' ? fixture.routerTools : fixture.toolsByAgent[id];
  const toolPath = id === 'router' ? 'examples/support-desk/app/orchestrator.py' : 'examples/support-desk/app/tools.py';
  const toolDefinitions = definitions.map((tool, index) => ({ name: tool.name, description: tool.description, inputSchema: tool.input_schema, writes: fixture.writes.includes(tool.name), preconditions: ['Retained source declares runtime write gate for write tools; verify deployment ownership and permission checks separately.'], evidenceIds: [add('reference-code', toolPath, `${id === 'router' ? 'ROUTER_TOOLS' : 'TOOLS_BY_AGENT.' + id}[${index}]`, 'code', JSON.stringify(tool))] }));
  agents.push({ id, name: id, owner: id === 'claims' ? 'Harbor Mutual (fictional external insurer)' : 'Tamberwick Home (fictional retailer)', isMain: id === 'router',
    prompt: fixture.prompts[id], tools: id === 'router' ? ['delegate', 'handoff_to_claims'] : fixture.toolsByAgent[id].map(tool => tool.name), invokedBy: id === 'router' ? [] : ['router'],
    returns: id === 'claims' ? 'Direct customer conversation and claim action' : 'Final text summary', talksToUser: id === 'router' || id === 'claims', externalOwner: id === 'claims',
    toolDefinitions, contextNeed: id === 'diagnostics' ? 'large_input' : 'none', proposed: proposals[id], rationale: { zh: reasons[id][0], en: reasons[id][1] }, evidenceIds: [ref] });
}
const orchestration = await code('examples/support-desk/app/orchestrator.py'), finished = await code('examples/support-desk/single_loop/agent.py');
const boundaries = [
  { id: 'orders-shipping', targets: ['orders', 'shipping'], proposed: 'merge' },
  { id: 'returns', targets: ['returns'], proposed: 'fold' }, { id: 'account', targets: ['account'], proposed: 'fold' },
  { id: 'diagnostics', targets: ['diagnostics'], proposed: 'as_tool' }, { id: 'claims', targets: ['claims'], proposed: 'keep' },
].map(row => ({ id: row.id, fromAgentId: 'router', targetAgentIds: row.targets, proposed: row.proposed,
  title: { zh: row.id, en: row.id }, rationale: agents.find(agent => agent.id === row.targets[0]).rationale,
  requirements: row.id === 'claims' ? ['external ownership', 'direct multi-turn dialogue'] : ['shared end-to-end eval', 'neighboring cases', 'runtime permission and write gates'],
  evidenceIds: [orchestration, finished, ...row.targets.flatMap(id => agents.find(agent => agent.id === id).evidenceIds)] }));
const caseRows = await jsonl('examples/support-desk/evals/golden.jsonl');
const cases = caseRows.map(({ value, line }) => {
  const checks = [];
  const push = (kind, expected) => checks.push({ id: `${value.id}-check-${checks.length}`, kind, expected, required: true });
  for (const pattern of value.checks.answer_includes ?? []) push('answer_includes', pattern);
  for (const action of value.checks.actions ?? []) push('action', action);
  for (const name of value.checks.forbidden_actions ?? []) push('forbidden_action', name);
  for (const pattern of value.checks.answer_excludes ?? []) push('answer_excludes', pattern);
  if (value.checks.only_expected_writes) push('only_expected_writes', true);
  const chains = value.id === 't13' ? [['account', 'returns']] : value.id === 't11' ? [['orders', 'shipping', 'returns']] : value.tags.includes('orders+shipping') && value.id !== 't03' ? [['orders', 'shipping']] : [];
  const terminal = checks.findLast(check => check.kind === 'action') ?? checks.findLast(check => check.kind === 'answer_includes');
  return { id: value.id, title: value.turns[0].slice(0, 120), turns: value.turns, customerId: value.customer ?? null, tags: value.tags, checks,
    requiredChains: chains, chainChecks: terminal ? chains.map(chain => ({ chain, checkId: terminal.id })) : [], split: ['t18', 't19'].includes(value.id) ? 'confirmation' : 'train',
    evidenceIds: [add('reference-code', 'examples/support-desk/evals/golden.jsonl', `line:${line}`, 'grade', JSON.stringify(value))] };
});
const traffic = (await jsonl('examples/support-desk/traces/traces.jsonl')).map(({ value, line }, sequence) => ({ traceId: value.trace_id, sequence,
  agentId: value.agent, callerId: value.caller ?? null, timestamp: new Date(value.ts).toISOString(), durationMs: value.duration_ms ?? null, inputTokens: value.input_tokens ?? null,
  evidenceId: add('generated-traffic', 'examples/support-desk/traces/traces.jsonl', `line:${line}`, 'trace', JSON.stringify(value)) }));
const trials = [], experiments = [];
async function importTrialSet(experimentId, variantId, path, sourceId, offset = 0) {
  const rows = await jsonl(path + '/results.jsonl');
  for (const { value: row, line } of rows) {
    const id = `${experimentId}:${variantId}:${row.prompt_id}:${row.rep + offset}`;
    const refId = add(sourceId, path + '/results.jsonl', `line:${line}`, 'grade', JSON.stringify(row));
    const tracePath = `${path}/traces/${row.prompt_id}_rep${row.rep}.json`, trace = JSON.parse(await readFile(join(reference, tracePath), 'utf8'));
    const events = trace.map((event, sequence) => {
      const role = ['user', 'assistant', 'tool_call', 'tool_result'].includes(event.role) ? event.role : 'assistant';
      const name = typeof event.name === 'string' ? event.name : null;
      const target = name?.endsWith('.delegate') ? /['"]agent['"]\s*:\s*['"]([a-z_]+)['"]/.exec(event.content)?.[1] ?? null : name?.endsWith('.handoff_to_claims') ? 'claims' : null;
      const agentId = name?.split('.')[0] ?? null;
      const eventRef = add(sourceId, tracePath, `/${sequence}`, 'trace', JSON.stringify(event), !(event.role === 'tool_result' && event.content.length >= 2000));
      return { id: `${id}:event:${sequence}`, sequence, role, agentId: roles.includes(agentId) || agentId === 'main' ? agentId : null, targetAgentId: target,
        name, content: Buffer.byteLength(event.content) <= 16384 ? event.content : null, startMs: null, durationMs: null, evidenceId: eventRef, complete: Buffer.byteLength(event.content) <= 16384 && !(event.role === 'tool_result' && event.content.length >= 2000) };
    });
    trials.push({ id, experimentId, variantId, caseId: row.prompt_id, repetition: row.rep + offset, sourceId,
      grade: row.status === 'ok' && row.model !== 'fake' ? row.grade.task_complete : null,
      checks: row.checks.map((check, index) => ({ id: `${row.prompt_id}-check-${index}`, label: check.check, passed: check.ok, evidenceId: refId })), answer: row.answer,
      latencyMs: row.latency_s * 1000, inputTokens: row.in_tokens, outputTokens: row.out_tokens, modelCalls: row.model_calls, toolCalls: row.tool_calls, model: row.model,
      byAgent: Object.fromEntries(Object.entries(row.by_agent).map(([agent, value]) => [agent, { calls: value.calls, inputTokens: value.input_tokens, outputTokens: value.output_tokens }])),
      actions: row.actions.map(action => ({ name: action.name, args: action.args, evidenceId: refId })), events, harnessError: null, evidenceIds: [refId] });
  }
}
const returnsRoot = 'examples/support-desk/example-run/results', diagnosticsRoot = 'examples/support-desk/example-run/as-tool/results';
for (const [variant, folder] of [['baseline', 'baseline'], ['folded', 'v1']]) await importTrialSet('returns-fold', variant, `${returnsRoot}/${folder}`, 'published-returns');
for (const [variant, folder] of [['baseline', 'baseline'], ['as-tool', 'v1']]) {
  await importTrialSet('diagnostics-as-tool', variant, `${diagnosticsRoot}/${folder}`, 'published-diagnostics');
  await importTrialSet('diagnostics-as-tool', variant, `${diagnosticsRoot}/${folder}-t01-t10`, 'published-diagnostics', 2);
}
for (const [id, boundaryId, operation, candidateVariantId, sourceId, count, baselineRevision, candidateRevision] of [
  ['returns-fold', 'returns', 'fold', 'folded', 'published-returns', 12, null, null],
  ['diagnostics-as-tool', 'diagnostics', 'as_tool', 'as-tool', 'published-diagnostics', 17, '0610370', '52251d4'],
]) {
  const expTrials = trials.filter(trial => trial.experimentId === id);
  const path = id === 'returns-fold' ? 'examples/support-desk/example-run/results/v1/change.md' : 'examples/support-desk/example-run/as-tool/results/v1/change.md';
  const refId = add(sourceId, path, null, 'document', await readFile(join(reference, path), 'utf8'));
  experiments.push({ id, title: id === 'returns-fold' ? 'Returns fold · published 12-case experiment' : 'Diagnostics as-tool · published 17-case experiment + 4 targeted reps', boundaryId, operation,
    baselineVariantId: 'baseline', candidateVariantId, caseIds: cases.slice(0, count).map(value => value.id), expectedRepetitions: 2,
    controls: { taskSet: 'declared', grader: 'declared', model: 'same_recorded', nonTarget: 'declared', intervention: 'declared', execution: 'unknown', baselineRevision, candidateRevision,
      skillAblation: 'not_run', notes: ['Published historic evidence; no reconstruction of an unrecorded model request or source revision.', 'Targeted extra repetitions are retained individually, not silently mixed into every case.'] },
    trialIds: expTrials.map(trial => trial.id), evidenceIds: [refId], chainMappings: [] });
}
const decisionRef = add('published-diagnostics', 'examples/support-desk/example-run/as-tool/README.md', null, 'document', await readFile(join(reference, 'examples/support-desk/example-run/as-tool/README.md'), 'utf8'));
const project = { version: 1, kind: 'agent-folding-project', id: 'official-support-desk', title: 'Single-agent-loop-kit · published support-desk evidence', createdAt: publishedAt,
  sources, agents, boundaries, cases, traffic, experiments, trials, evidence,
  humanDecisions: [{ id: 'upstream-diagnostics-keep', boundaryId: 'diagnostics', action: 'keep_change', note: 'Decision documented in the publication (exact decision UTC time unavailable): the upstream author kept the as-tool change after targeted reruns; this human choice does not erase t01 regression, t10 route/cost changes, or missing tests.', decidedAt: null, evidenceIds: [decisionRef] }],
  limitations: ['Published measurements are historical and confined to one fictional support system, one person and one recorded model.', 'Traffic is synthetic; fake smoke is not model evaluation. Do not infer enterprise generalization.', 'Trace events have sequence only: no per-event timestamps, explicit call IDs or complete model context.', 'Current 19-case/source snapshot differs from the historical 12/17-task experiments; no claim of exact historical rerun.', 'Public confirmation tasks are not a secret held-out benchmark; use your own confirmation set for release decisions.'] };
await mkdir(destination, { recursive: true });
const projectBytes = Buffer.from(JSON.stringify(project)), fixtureBytes = Buffer.from(JSON.stringify(fixture));
if (projectBytes.byteLength > 8 * 1024 * 1024 || evidence.length > 2000 || trials.flatMap(trial => trial.events).length > 20000) throw new Error('Pinned catalog exceeds the documented bounds.');
await writeFile(join(destination, 'support-desk-project.json'), projectBytes);
await mkdir(join(destination, 'support-desk'), { recursive: true }); await writeFile(join(destination, 'support-desk/fixture.json'), fixtureBytes);
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ version: 1, repository: 'https://github.com/anthropics/single-agent-loop-kit', revision,
  license: 'Apache-2.0', projectSha256: digest(projectBytes), fixtureSha256: digest(fixtureBytes), files }, null, 2) + '\n');
await writeFile(join(destination, 'NOTICE.md'), `# Third-party reference\n\nCopyright 2026 Anthropic PBC. Apache-2.0; see single-agent-loop-kit/LICENSE.\nPinned source: https://github.com/anthropics/single-agent-loop-kit/tree/${revision}\n\nOriginal files are copied unchanged. Our importer derives normalized project/fixture JSON,\nadds distinct experiment/variant identities and source pointers, retains every published\ntrial and supplemental rep, and labels synthetic traffic and historical limitations.\nNo API call or model rerun is performed by this import.\n`);
console.log(JSON.stringify({ revision, trials: trials.length, cases: cases.length, evidence: evidence.length, events: trials.flatMap(trial => trial.events).length, projectBytes: projectBytes.length }));
