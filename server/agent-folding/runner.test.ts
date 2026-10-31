import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { validateFoldingProject } from '../../src/core/agent-folding-validation.js';
import type { FoldingBlock, FoldingModelClient, FoldingModelRequest } from './anthropic.js';
import { DEFAULT_FOLDING_PLAN, loadFoldingExample, loadSupportDeskFixture } from './catalog.js';
import { FixtureFoldingClient } from './fixture.js';
import { buildFoldingGraph, freshFoldingProject, parseFoldingStructuredResult, runFoldingExperiment } from './runner.js';

const dirs: string[] = []; afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'folding-runtime-')); dirs.push(dir); return { dir, project: freshFoldingProject(await loadFoldingExample()), fixture: await loadSupportDeskFixture(), plan: { ...structuredClone(DEFAULT_FOLDING_PLAN), skillAblation: false, repetitions: 1, caseIds: ['t04', 't05'], budgets: { ...DEFAULT_FOLDING_PLAN.budgets, timeoutMs: 2000 } } }; }
it('runs actual same-loop fixture protocol with fresh case state, skill discovery and atomic independent output', async () => {
  const f = await setup(), output = join(f.dir, 'run');
  const report = await runFoldingExperiment(f.project, f.plan, { output, fixture: f.fixture });
  expect(report.trials).toHaveLength(4); expect(report.trials.every(t => t.grade === null && t.harnessError === null && t.repetition === 0)).toBe(true);
  expect(report.trials.filter(t => t.caseId === 't04').every(t => t.actions.some(a => a.name === 'create_return'))).toBe(true);
  expect(report.trials.filter(t => t.caseId === 't05').every(t => !t.actions.length)).toBe(true);
  expect(report.trials.some(t => t.variantId === 'candidate' && t.events.some(e => e.role === 'skill'))).toBe(true);
  expect(report.trials.some(t => t.events.some(e => e.name === 'tool_search_tool_bm25'))).toBe(true);
  expect(validateFoldingProject(JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))).trials).toHaveLength(4);
  await expect(runFoldingExperiment(f.project, f.plan, { output, fixture: f.fixture })).rejects.toThrow();
});
it('changes only the declared graph boundary and retains claims plus neighboring roles', async () => {
  const f = await setup(), baseline = buildFoldingGraph(f.fixture, f.plan, false), fold = buildFoldingGraph(f.fixture, f.plan, true);
  expect(fold.delegates.returns).toBeUndefined(); expect(fold.delegates.account).toEqual(baseline.delegates.account); expect(fold.claims).toEqual(baseline.claims);
  const merge = buildFoldingGraph(f.fixture, { ...f.plan, operation: 'merge', targetAgentIds: ['orders', 'shipping'] }, true);
  expect(merge.delegates.orders).toBeUndefined(); expect(merge.delegates.shipping).toBeUndefined(); expect(merge.delegates.orders_shipping!.tools.map(t => t.name)).toContain('get_tracking'); expect(merge.delegates.returns).toEqual(baseline.delegates.returns);
  const asTool = buildFoldingGraph(f.fixture, { ...f.plan, operation: 'as_tool', targetAgentIds: ['diagnostics'] }, true);
  expect(asTool.main.tools.some(t => t.name === 'diagnose_device')).toBe(true); expect(asTool.structured).toEqual(['diagnostics']);
});
it('enforces shared nested call/token/input/batch budgets and preserves unknown trials on cancellation', async () => {
  const f = await setup();
  const callLimited = await runFoldingExperiment(f.project, { ...f.plan, caseIds: ['t04'], budgets: { ...f.plan.budgets, maxCallsPerCase: 1 } }, { output: join(f.dir, 'calls'), fixture: f.fixture });
  expect(callLimited.trials.every(t => t.modelCalls === 1 && t.harnessError?.includes('model-call'))).toBe(true);
  const tokenClient: FoldingModelClient = { fixture: true, create: async () => ({ content: [{ type: 'text', text: 'finished' }], stopReason: 'end_turn', inputTokens: 20, outputTokens: 10, model: 'offline-keyword-fixture' }) };
  const tokenLimited = await runFoldingExperiment(f.project, { ...f.plan, caseIds: ['t04'], budgets: { ...f.plan.budgets, maxTotalTokensPerCase: 10 } }, { output: join(f.dir, 'tokens'), fixture: f.fixture, client: tokenClient });
  expect(tokenLimited.trials.every(t => t.harnessError?.includes('after response') && t.actions.length === 0)).toBe(true);
  const inputLimited = await runFoldingExperiment(f.project, { ...f.plan, caseIds: ['t04'], budgets: { ...f.plan.budgets, maxInputChars: 10 } }, { output: join(f.dir, 'input'), fixture: f.fixture });
  expect(inputLimited.trials.every(t => t.modelCalls === 0 && t.harnessError?.includes('input character'))).toBe(true);
  const controller = new AbortController(), client: FoldingModelClient = { fixture: true, create: async (request: FoldingModelRequest) => { controller.abort(); return new FixtureFoldingClient().create(request); } };
  const cancelled = await runFoldingExperiment(f.project, f.plan, { output: join(f.dir, 'cancelled'), fixture: f.fixture, signal: controller.signal, client });
  expect(cancelled.trials).toHaveLength(1); expect(cancelled.trials[0]!.grade).toBeNull(); expect(cancelled.trials[0]!.harnessError).toBeTruthy();
});
it('rejects paid execution without explicit consent and a supported declared target', async () => {
  const f = await setup();
  await expect(runFoldingExperiment(f.project, { ...f.plan, provider: 'anthropic', model: 'explicit' }, { output: join(f.dir, 'never') })).rejects.toThrow('--allow-paid');
  await expect(runFoldingExperiment(f.project, { ...f.plan, targetAgentIds: ['claims'] }, { output: join(f.dir, 'unsupported'), fixture: f.fixture })).rejects.toThrow('supports');
});
it('runs a real third skill-off variant with identical tools, distinct traces and unscored offline results', async () => {
  const f = await setup(), plan = { ...f.plan, skillAblation: true, caseIds: ['t04'] };
  const withSkill = buildFoldingGraph(f.fixture, plan, true), without = buildFoldingGraph(f.fixture, plan, true, true);
  expect(withSkill.main.tools).toEqual(without.main.tools); expect(Object.keys(without.skills)).toHaveLength(0);
  const report = await runFoldingExperiment(f.project, plan, { output: join(f.dir, 'ablation'), fixture: f.fixture });
  expect(report.trials).toHaveLength(3); expect(report.experiments[0]!.ablationVariantId).toBe('candidate_without_skill');
  const ablation = report.trials.find(t => t.variantId === 'candidate_without_skill')!;
  expect(ablation.events.some(e => e.role === 'skill')).toBe(false); expect(ablation.harnessError).toBeNull(); expect(ablation.grade).toBeNull();
  expect(report.experiments[0]!.controls.skillAblation).toBe('not_run');
  expect(report.evidence.some(e => e.kind === 'grade' && e.complete)).toBe(true);
});
it('caps batches before execution, preserves ordered gated writes and rejects duplicate IDs before any write', async () => {
  const f = await setup();
  f.project.cases = [{ ...f.project.cases[0]!, id: 'write-order', customerId: 'C-1001', turns: ['Update account'], checks: [{ id: 'done', kind: 'answer_includes', expected: 'Done', required: true }], requiredChains: [], chainChecks: [], evidenceIds: [] }];
  const plan = { ...f.plan, boundaryId: 'account', targetAgentIds: ['account'], caseIds: ['write-order'], budgets: { ...f.plan.budgets, maxToolBatch: 2 } };
  const client = (duplicate: boolean): FoldingModelClient => ({ fixture: true, create: async request => {
    const started = request.messages.some(m => m.role === 'assistant');
    const delegated = request.tools.some(t => t.name === 'delegate') && !request.tools.some(t => t.name === 'update_shipping_address');
    const calls: FoldingBlock[] = delegated ? [{ type: 'tool_use', id: 'delegate', name: 'delegate', input: { agent: 'account', brief: 'Update account' } }] : [
      { type: 'tool_use', id: 'a', name: 'set_marketing_opt_in', input: { customer_id: 'C-1001', opt_in: false } },
      { type: 'tool_use', id: duplicate ? 'a' : 'b', name: 'update_shipping_address', input: { customer_id: 'C-1001', address: 'New fixture street' } },
      { type: 'tool_use', id: 'c', name: 'set_marketing_opt_in', input: { customer_id: 'C-1001', opt_in: true } },
    ];
    return { content: started ? [{ type: 'text', text: 'Done.' }] : calls, stopReason: started ? 'end_turn' : 'tool_use', inputTokens: 0, outputTokens: 0, model: 'offline-keyword-fixture' };
  } });
  const report = await runFoldingExperiment(f.project, plan, { output: join(f.dir, 'ordered'), fixture: f.fixture, client: client(false) });
  expect(report.trials.every(t => t.actions.map(a => a.name).join() === 'set_marketing_opt_in,update_shipping_address')).toBe(true);
  expect(report.trials.every(t => t.events.some(e => e.content?.includes('Tool batch cap exceeded')))).toBe(true);
  const duplicate = await runFoldingExperiment(f.project, plan, { output: join(f.dir, 'duplicate'), fixture: f.fixture, client: client(true) });
  expect(duplicate.trials.every(t => !t.actions.length && t.harnessError?.includes('Duplicate'))).toBe(true);
});
it('retains exact structured schema with a visible low-confidence invalid result and withholds address leaks', async () => {
  const valid = { conclusion: 'Brush motor stall', evidence: ['E42'], actions_taken: [], confidence: 'high', caveats: [] };
  expect(parseFoldingStructuredResult(JSON.stringify(valid))).toEqual(valid);
  for (const value of [{ ...valid, extra: true }, { ...valid, conclusion: '' }, { ...valid, evidence: [{}] }, { ...valid, actions_taken: [5] }, { ...valid, confidence: 'certain' }]) expect(parseFoldingStructuredResult(JSON.stringify(value))).toMatchObject({ confidence: 'low', caveats: ['Invalid structured subagent result; conclusion has not been independently validated.'] });
  const f = await setup(), client: FoldingModelClient = { fixture: true, create: async () => ({ content: [{ type: 'text', text: '40 Mill St, Burlington, VT 05401' }], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, model: 'offline-keyword-fixture' }) };
  const report = await runFoldingExperiment(f.project, { ...f.plan, caseIds: ['t04'] }, { output: join(f.dir, 'privacy'), fixture: f.fixture, client });
  expect(report.trials.every(t => t.answer?.includes('withheld') && t.events.some(e => e.name === 'privacy_verifier_rejected'))).toBe(true);
});
it('preserves externally owned claims dialogue and returns its completed outcome to the main history', async () => {
  const f = await setup();
  f.project.cases = [{ ...f.project.cases[0]!, id: 'claims-dialogue', customerId: 'C-1001', turns: ['Shipping damage on order 5001', 'Photos received, damage is broken housing.', 'What happened to the claim?'], checks: [{ id: 'claim', kind: 'answer_includes', expected: 'CLM-5001', required: true }], requiredChains: [], chainChecks: [], evidenceIds: [] }];
  let restored = 0;
  const client: FoldingModelClient = { fixture: true, create: async request => {
    const done = request.messages.some(m => typeof m.content === 'string' && m.content.includes('[claims specialist completed]'));
    if (request.agentId === 'router' && done) { restored++; return { content: [{ type: 'text', text: 'The claim CLM-5001 is complete.' }], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0, model: 'offline-keyword-fixture' }; }
    const last = request.messages.at(-1)?.content;
    const claimCall = request.agentId === 'claims' && typeof last === 'string' && last.startsWith('Photos');
    const content: FoldingBlock[] = request.agentId === 'router' ? [{ type: 'tool_use', id: 'handoff', name: 'handoff_to_claims', input: { summary: 'Damaged order 5001' } }] : claimCall ? [{ type: 'tool_use', id: 'claim', name: 'open_claim', input: { order_id: '5001', damage_description: 'broken housing', photos_received: true } }] : [{ type: 'text', text: Array.isArray(last) ? 'Claim CLM-5001 opened.' : 'Please supply photos.' }];
    return { content, stopReason: content[0]!.type === 'tool_use' ? 'tool_use' : 'end_turn', inputTokens: 0, outputTokens: 0, model: 'offline-keyword-fixture' };
  } };
  const report = await runFoldingExperiment(f.project, { ...f.plan, caseIds: ['claims-dialogue'] }, { output: join(f.dir, 'claims'), fixture: f.fixture, client });
  expect(restored).toBe(2); expect(report.trials.every(t => t.harnessError === null && t.actions.some(a => a.name === 'open_claim') && t.answer?.endsWith('complete.'))).toBe(true);
});
it('executes merge, thin account fold and structured diagnostics transforms while retaining every other role', async () => {
  const f = await setup();
  for (const [boundaryId, operation, targetAgentIds, caseId] of [['orders-shipping', 'merge', ['orders', 'shipping'], 't01'], ['account', 'fold', ['account'], 't07'], ['diagnostics', 'as_tool', ['diagnostics'], 't09']] as const) {
    const report = await runFoldingExperiment(f.project, { ...f.plan, boundaryId, operation, targetAgentIds: [...targetAgentIds], caseIds: [caseId] }, { output: join(f.dir, boundaryId), fixture: f.fixture });
    expect(report.trials.every(t => t.harnessError === null)).toBe(true);
    const candidate = report.trials.find(t => t.variantId === 'candidate')!;
    if (operation === 'merge') expect(candidate.events.some(e => e.agentId === 'orders_shipping')).toBe(true);
    if (boundaryId === 'account') { expect(candidate.events.some(e => e.role === 'skill')).toBe(false); expect(report.experiments[0]!.controls.skillAblation).toBe('not_applicable'); }
    if (operation === 'as_tool') { expect(candidate.events.some(e => e.name === 'structured_result')).toBe(true); expect(candidate.events.every(e => e.complete)).toBe(true); }
  }
});
