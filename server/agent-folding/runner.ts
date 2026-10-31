import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FoldingCase, FoldingEvidence, FoldingExperiment, FoldingJson, FoldingProject, FoldingRunPlan, FoldingTraceEvent, FoldingTrial } from '../../src/core/agent-folding-types.js';
import { validateFoldingProject, validateFoldingRunPlan } from '../../src/core/agent-folding-validation.js';
import { AnthropicFoldingClient } from './anthropic.js';
import type { FoldingBlock, FoldingMessage, FoldingModelClient, FoldingToolDefinition } from './anthropic.js';
import { checkSupportDeskCase, FOLDING_WRITES, FixtureFoldingClient, SupportDeskBackend } from './fixture.js';
import type { SupportDeskFixture } from './fixture.js';
import { runExternalFoldingExperiment } from './external.js';

export interface FoldingRunnerOptions {
  output: string; signal?: AbortSignal; allowPaid?: boolean; onProgress?: (message: string) => void;
  client?: FoldingModelClient; fixture?: SupportDeskFixture;
}
interface GraphAgent { prompt: string; tools: FoldingToolDefinition[] }
export interface FoldingRuntimeGraph { main: GraphAgent; delegates: Record<string, GraphAgent>; structured: string[]; skills: Record<string, string>; claims: GraphAgent }
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): FoldingToolDefinition => ({ name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } });
const unique = (items: FoldingToolDefinition[]) => [...new Map(items.map(t => [t.name, t])).values()];
export function buildFoldingGraph(fixture: SupportDeskFixture, plan: FoldingRunPlan, candidate: boolean, skillOff = false): FoldingRuntimeGraph {
  const delegates = Object.fromEntries(Object.entries(fixture.toolsByAgent).filter(([id]) => id !== 'claims').map(([id, tools]) => [id, { prompt: fixture.prompts[id] ?? '', tools: structuredClone(tools) }]));
  const graph: FoldingRuntimeGraph = { main: { prompt: fixture.prompts.router ?? '', tools: [] }, delegates, structured: [], skills: {}, claims: { prompt: fixture.prompts.claims ?? '', tools: structuredClone(fixture.toolsByAgent.claims ?? []) } };
  if (candidate) {
    const targets = plan.targetAgentIds;
    if (plan.operation === 'fold') {
      if (targets.length !== 1 || !['returns', 'account'].includes(targets[0]!)) throw new Error('Built-in fold supports exactly returns or account.');
      const id = targets[0]!, agent = delegates[id]; if (!agent) throw new Error('Unknown fold target.');
      graph.main.tools = agent.tools.map(t => ({ ...t, ...(id === 'returns' ? { defer_loading: true } : {}) }));
      if (id === 'returns') graph.skills[id] = fixture.returnsSkill;
      graph.main.prompt = graph.main.prompt.replace(/^CRITICAL:.*$/m, 'For retained domains, delegate to a specialist. You may answer directly for folded domains.');
      graph.main.prompt += `\nThe ${id} boundary is folded into this loop. Do that work yourself using its skill and tools, and answer the customer. Other work still uses the remaining specialists. The old ${id} route is unavailable.`;
      if (id === 'account') graph.main.prompt += `\n${agent.prompt}`;
      delete delegates[id];
    } else if (plan.operation === 'merge') {
      if (targets.length !== 2 || !targets.includes('orders') || !targets.includes('shipping')) throw new Error('Built-in merge supports orders and shipping only.');
      const a = delegates.orders!, b = delegates.shipping!;
      delegates.orders_shipping = { prompt: `${a.prompt}\n\n${b.prompt}\nYou are the merged orders_shipping specialist; perform both responsibilities with shared context.`, tools: unique([...a.tools, ...b.tools]) };
      delete delegates.orders; delete delegates.shipping;
      graph.main.prompt += '\nThe orders and shipping boundaries are merged. Use orders_shipping for either responsibility; orders and shipping are unavailable.';
    } else {
      if (targets.length !== 1 || targets[0] !== 'diagnostics') throw new Error('Built-in as-tool supports diagnostics only.');
      graph.structured.push('diagnostics');
      graph.main.prompt += '\nCall diagnose_device for diagnostics. You keep the customer conversation, ask for the serial when missing, and verify the structured conclusion against its cited evidence. The old diagnostics delegation route is unavailable.';
    }
  }
  const names = Object.keys(delegates).filter(id => !graph.structured.includes(id));
  graph.main.tools.push(tool('delegate', 'Ask one retained specialist to complete a bounded brief.', { agent: { type: 'string', enum: names }, brief: { type: 'string' } }, ['agent', 'brief']),
    tool('handoff_to_claims', 'Transfer direct customer conversation to the externally owned claims specialist.', { summary: { type: 'string' } }, ['summary']));
  if (graph.structured.length) graph.main.tools.push(tool('diagnose_device', 'Diagnose a device in an isolated context, returning conclusion/evidence/actions_taken/confidence/caveats. Ask for the serial first.', { serial: { type: 'string' }, brief: { type: 'string' } }, ['serial', 'brief']));
  if (Object.keys(graph.skills).length) {
    graph.main.tools.push(tool('load_skill', 'Load instructions before doing work covered by this skill.', { name: { type: 'string', enum: Object.keys(graph.skills) } }, ['name']));
    graph.main.prompt += `\nAvailable skills (load with load_skill): ${Object.keys(graph.skills).join(', ')}.`;
    graph.main.tools.unshift({ name: 'tool_search_tool_bm25', description: '', input_schema: {}, ...{ type: 'tool_search_tool_bm25_20251119' } } as FoldingToolDefinition);
  }
  if (skillOff) { graph.skills = {}; graph.main.prompt = graph.main.prompt.replace(/\nAvailable skills \(load with load_skill\):[^\n]*/g, ''); }
  return graph;
}
export async function saveFoldingProject(path: string, project: FoldingProject): Promise<void> {
  validateFoldingProject(project);
  const text = JSON.stringify(project, null, 2);
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Report exceeds 8 MiB; completed trial files remain locally.');
  const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  try { await rename(temporary, path); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
interface TrialRuntime {
  plan: FoldingRunPlan; model: string; client: FoldingModelClient; backend: SupportDeskBackend; graph: FoldingRuntimeGraph;
  trial: FoldingTrial; origin: number; signal: AbortSignal; claimsMessages: FoldingMessage[] | null;
}
function event(rt: TrialRuntime, role: FoldingTraceEvent['role'], agentId: string, name: string | null, content: string, targetAgentId: string | null = null, durationMs: number | null = null): void {
  const bytes = Buffer.from(content), decoder = new TextDecoder(), chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 15000) chunks.push(decoder.decode(bytes.subarray(offset, offset + 15000), { stream: offset + 15000 < bytes.length }));
  if (!chunks.length) chunks.push('');
  if (rt.trial.events.length + chunks.length > 1000) throw new Error('Trial event limit reached.');
  const startMs = performance.now() - rt.origin;
  for (const [index, text] of chunks.entries()) rt.trial.events.push({ id: `${rt.trial.id}-event-${rt.trial.events.length + 1}`, sequence: rt.trial.events.length + 1, role, agentId, targetAgentId, name: index === 0 ? name : `${name ?? role} [segment ${index + 1}/${chunks.length}]`, content: chunks.length === 1 ? text : `[segment ${index + 1}/${chunks.length}]\n${text}`,
    startMs, durationMs: index === 0 ? durationMs : null, evidenceId: rt.trial.evidenceIds[0]!, complete: true });
}
function guard(rt: TrialRuntime): void {
  if (rt.signal.aborted) throw new Error('Trial cancelled or wall deadline reached.');
  if ((rt.trial.modelCalls ?? 0) >= rt.plan.budgets.maxCallsPerCase) throw new Error('Shared model-call budget reached (nested loops included).');
  if ((rt.trial.inputTokens ?? 0) + (rt.trial.outputTokens ?? 0) >= rt.plan.budgets.maxTotalTokensPerCase) throw new Error('Shared measured token budget reached (nested loops included).');
}
export function parseFoldingStructuredResult(text: string): FoldingJson {
  try {
    const value = JSON.parse(text) as Record<string, FoldingJson>;
    const strings = (v: FoldingJson | undefined) => Array.isArray(v) && v.length <= 100 && v.every(x => typeof x === 'string' && x.length <= 16000);
    if (value && !Array.isArray(value) && Object.keys(value).length === 5 && ['conclusion', 'evidence', 'actions_taken', 'confidence', 'caveats'].every(k => Object.hasOwn(value, k)) && typeof value.conclusion === 'string' && value.conclusion.trim() && value.conclusion.length <= 16000 && strings(value.evidence) && strings(value.actions_taken) && ['low', 'medium', 'high'].includes(String(value.confidence)) && strings(value.caveats)) return value;
  } catch { /* Invalid structured output remains visible and low confidence. */ }
  return { conclusion: text.trim().slice(0, 8000) || '[Invalid empty structured result]', evidence: [], actions_taken: [], confidence: 'low', caveats: ['Invalid structured subagent result; conclusion has not been independently validated.'] };
}
async function executeTool(rt: TrialRuntime, agentId: string, definition: GraphAgent, call: FoldingBlock): Promise<FoldingBlock> {
  const name = call.name!, args = call.input!, started = performance.now();
  event(rt, 'tool_call', agentId, name, JSON.stringify(args));
  let output: FoldingJson;
  if (rt.signal.aborted) throw new Error('Cancelled.');
  const declared = definition.tools.find(t => t.name === name);
  if (!declared) output = { error: 'Tool was not declared to this agent.' };
  else if (name === 'load_skill') {
    const skill = typeof args.name === 'string' && Object.hasOwn(rt.graph.skills, args.name) ? rt.graph.skills[args.name] : undefined;
    output = skill ?? { error: 'Unknown skill; arbitrary paths are not accepted.' };
    if (skill !== undefined) event(rt, 'skill', agentId, String(args.name), skill);
  } else if (name === 'delegate') {
    const target = String(args.agent), child = Object.hasOwn(rt.graph.delegates, target) ? rt.graph.delegates[target] : undefined;
    if (!child || rt.graph.structured.includes(target) || typeof args.brief !== 'string') output = { error: 'Unknown specialist or missing brief.' };
    else { event(rt, 'handoff', agentId, 'delegate', args.brief, target); output = await loop(rt, target, child, [{ role: 'user', content: args.brief }]); }
  } else if (name === 'diagnose_device') {
    if (typeof args.serial !== 'string' || !args.serial || typeof args.brief !== 'string') output = { error: 'Serial and brief are required.' };
    else {
      event(rt, 'handoff', agentId, 'diagnose_device', String(args.brief), 'diagnostics');
      const child = rt.graph.delegates.diagnostics!;
      const answer = await loop(rt, 'diagnostics', { ...child, prompt: `${child.prompt}\nSTRUCTURED_RESULT: Return JSON with conclusion (string), evidence (array), actions_taken (array), confidence (low/medium/high), caveats (array).` }, [{ role: 'user', content: `Serial: ${args.serial}\n${args.brief}` }]);
      output = parseFoldingStructuredResult(answer);
      event(rt, 'verification', agentId, 'structured_result', JSON.stringify(output), 'diagnostics');
    }
  } else if (name === 'handoff_to_claims') {
    rt.claimsMessages = [{ role: 'user', content: typeof args.summary === 'string' ? args.summary : '' }];
    event(rt, 'handoff', agentId, name, String(args.summary), 'claims');
    output = 'Claims owns the customer dialogue until the claim is completed.';
  } else output = rt.backend.call(name, args);
  const error = output !== null && typeof output === 'object' && !Array.isArray(output) && 'error' in output;
  const content = typeof output === 'string' ? output : JSON.stringify(output);
  event(rt, 'tool_result', agentId, name, content, null, performance.now() - started);
  return { type: 'tool_result', tool_use_id: call.id!, content, ...(error ? { is_error: true } : {}) };
}
async function loop(rt: TrialRuntime, agentId: string, definition: GraphAgent, messages: FoldingMessage[]): Promise<string> {
  while (true) {
    guard(rt);
    const system = `${definition.prompt}\nSigned-in customer: ${rt.backend.customerId ?? 'unknown'}. All tool permissions and policies are enforced by the runtime.`;
    if (JSON.stringify({ model: rt.model, max_tokens: rt.plan.budgets.maxOutputTokens, system, tools: definition.tools, messages }).length > rt.plan.budgets.maxInputChars) throw new Error('Per-request input character budget reached.');
    const started = performance.now(); rt.trial.modelCalls = (rt.trial.modelCalls ?? 0) + 1;
    const response = await rt.client.create({ agentId, model: rt.model, system, tools: definition.tools, messages, maxTokens: rt.plan.budgets.maxOutputTokens, signal: rt.signal });
    if (rt.trial.model !== null && rt.trial.model !== rt.plan.model && rt.trial.model !== response.model) throw new Error('Model identity changed within one trial.');
    rt.trial.model = response.model;
    rt.trial.inputTokens = (rt.trial.inputTokens ?? 0) + response.inputTokens; rt.trial.outputTokens = (rt.trial.outputTokens ?? 0) + response.outputTokens;
    if (!Number.isSafeInteger(rt.trial.inputTokens) || !Number.isSafeInteger(rt.trial.outputTokens) || !Number.isSafeInteger(rt.trial.inputTokens + rt.trial.outputTokens)) throw new Error('Invalid cumulative token accounting.');
    const usage = rt.trial.byAgent[agentId] ?? { calls: 0, inputTokens: 0, outputTokens: 0 }; usage.calls++; usage.inputTokens += response.inputTokens; usage.outputTokens += response.outputTokens; rt.trial.byAgent[agentId] = usage;
    event(rt, 'model', agentId, response.stopReason, JSON.stringify({ model: response.model, inputTokens: response.inputTokens, outputTokens: response.outputTokens, content: response.content }), null, performance.now() - started);
    messages.push({ role: 'assistant', content: response.content });
    if ((rt.trial.inputTokens ?? 0) + (rt.trial.outputTokens ?? 0) > rt.plan.budgets.maxTotalTokensPerCase) throw new Error('Measured token budget exceeded after response; no further tools executed.');
    for (const block of response.content.filter(b => b.type === 'server_tool_use' || b.type === 'tool_search_tool_result')) event(rt, 'tool_result', agentId, block.name ?? block.type, JSON.stringify(block));
    if (response.stopReason === 'pause_turn') continue;
    const calls = response.content.filter(b => b.type === 'tool_use');
    if (new Set(calls.map(c => c.id)).size !== calls.length) throw new Error('Duplicate tool-call IDs; batch was not executed.');
    if (!calls.length) {
      if (response.stopReason !== 'end_turn') throw new Error(`Model stopped without a complete answer (${response.stopReason}).`);
      return response.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
    }
    if (response.stopReason !== 'tool_use') throw new Error('Model returned incomplete tool calls.');
    const results = new Map<string, FoldingBlock>(), accepted = calls.slice(0, rt.plan.budgets.maxToolBatch);
    rt.trial.toolCalls = (rt.trial.toolCalls ?? 0) + calls.length;
    for (const call of calls.slice(rt.plan.budgets.maxToolBatch)) {
      event(rt, 'tool_call', agentId, call.name!, JSON.stringify(call.input));
      event(rt, 'tool_result', agentId, call.name!, 'Tool batch cap exceeded; call did not execute.');
      results.set(call.id!, { type: 'tool_result', tool_use_id: call.id!, is_error: true, content: 'Tool batch cap exceeded; call did not execute.' });
    }
    const readCalls = accepted.filter(c => !FOLDING_WRITES.has(c.name!) && !['delegate', 'diagnose_device', 'handoff_to_claims'].includes(c.name!));
    // Only bounded independent backend reads run together. Nested loops and writes keep order.
    for (let offset = 0; offset < readCalls.length; offset += 4) await Promise.all(readCalls.slice(offset, offset + 4).map(async c => { results.set(c.id!, await executeTool(rt, agentId, definition, c)); }));
    for (const call of accepted) if (!results.has(call.id!)) results.set(call.id!, await executeTool(rt, agentId, definition, call));
    messages.push({ role: 'user', content: calls.map(c => results.get(c.id!)!) });
    if (agentId === 'router' && rt.claimsMessages) return loop(rt, 'claims', rt.graph.claims, rt.claimsMessages);
  }
}
async function runTrial(project: FoldingProject, fixture: SupportDeskFixture, plan: FoldingRunPlan, client: FoldingModelClient, experimentId: string, variantId: string, sourceId: string, task: FoldingCase, repetition: number, signal?: AbortSignal): Promise<{ trial: FoldingTrial; evidence: FoldingEvidence }> {
  const id = `${experimentId}-${variantId}-${createHash('sha256').update(task.id).digest('hex').slice(0, 12)}-${repetition}`, evidenceId = `${id}-trace`, controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, plan.budgets.timeoutMs); timer.unref(); const origin = performance.now();
  const gradeEvidenceId = `${id}-grade`, trial: FoldingTrial = { id, experimentId, variantId, caseId: task.id, repetition, sourceId, grade: null, checks: [], answer: null, latencyMs: null, inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0, model: client.fixture ? 'offline-keyword-fixture' : plan.model, byAgent: {}, actions: [], events: [], harnessError: null, evidenceIds: [evidenceId, gradeEvidenceId] };
  const backend = new SupportDeskBackend(fixture, task.customerId, () => true), graph = buildFoldingGraph(fixture, plan, variantId !== 'baseline', variantId === 'candidate_without_skill');
  const rt: TrialRuntime = { plan, client, model: plan.model ?? 'offline-keyword-fixture', backend, graph, trial, origin, signal: controller.signal, claimsMessages: null };
  const messages: FoldingMessage[] = [];
  try {
    const answers: string[] = [];
    for (const turn of task.turns) {
      event(rt, 'user', rt.claimsMessages ? 'claims' : 'router', null, turn);
      const history = rt.claimsMessages ?? messages; history.push({ role: 'user', content: turn });
      const answer = await loop(rt, rt.claimsMessages ? 'claims' : 'router', rt.claimsMessages ? graph.claims : graph.main, history);
      answers.push(answer); event(rt, 'assistant', rt.claimsMessages ? 'claims' : 'router', null, answer);
      if (backend.actions.some(a => a.name === 'open_claim') && rt.claimsMessages) {
        messages.push({ role: 'assistant', content: `[claims specialist completed] ${answer}` });
        rt.claimsMessages = null;
      }
    }
    trial.answer = answers.join('\n');
    if (Buffer.byteLength(trial.answer) > 16000) throw new Error('Final answer exceeds bounded report evidence; no complete answer is claimed.');
    const checks = checkSupportDeskCase(task, trial.answer, backend.actions);
    trial.checks = checks.map(c => ({ ...c, passed: client.fixture ? null : c.passed, evidenceId: gradeEvidenceId }));
    if (!client.fixture) trial.grade = trial.checks.some(c => c.passed === false && task.checks.find(k => k.id === c.id)?.required) ? 0 : trial.checks.some(c => c.passed === null && task.checks.find(k => k.id === c.id)?.required) ? null : 1;
    event(rt, 'verification', 'router', 'deterministic_case_verifier', JSON.stringify({ independentModel: false, unscored: client.fixture, checks: trial.checks, accepted: trial.grade === 1 }));
    if (backend.privateAddressIn(trial.answer)) {
      event(rt, 'verification', 'router', 'privacy_verifier_rejected', 'Full street address detected; final answer withheld. This deterministic gate is shared by both variants.');
      trial.answer = '[Answer withheld by the shared address privacy verifier.]'; if (!client.fixture) trial.grade = 0;
    }
  } catch (error) { if (trial.answer !== null && Buffer.byteLength(trial.answer) > 16000) trial.answer = null; trial.harnessError = error instanceof Error ? error.message.slice(0, 1000) : 'Trial failed.'; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  trial.actions = backend.actions.map(a => ({ ...a, evidenceId })); trial.latencyMs = performance.now() - origin;
  if (project.trials.reduce((n, t) => n + t.events.length, 0) + trial.events.length > 20000) throw new Error('Report event capacity exceeded; completed trials are retained.');
  return { trial, evidence: { id: evidenceId, sourceId, path: `trials/${id}.json`, pointer: null, sha256: createHash('sha256').update(JSON.stringify(trial, null, 2)).digest('hex'), kind: 'trace', excerpt: null, text: null, complete: true, native: null } };
}
export async function runFoldingExperiment(input: FoldingProject, rawPlan: FoldingRunPlan, options: FoldingRunnerOptions): Promise<FoldingProject> {
  const project = structuredClone(validateFoldingProject(input)), plan = validateFoldingRunPlan(rawPlan);
  if (plan.adapter === 'external') return runExternalFoldingExperiment(project, plan, options);
  if (plan.provider === 'anthropic' && !options.allowPaid) throw new Error('Paid execution requires explicit --allow-paid.');
  if (plan.provider === 'anthropic' && !plan.model) throw new Error('An explicit model is required.');
  const client = options.client ?? (plan.provider === 'fixture' ? new FixtureFoldingClient() : new AnthropicFoldingClient());
  if (plan.provider === 'fixture' && !client.fixture) throw new Error('Fixture plans cannot execute a paid client.');
  const fixture = options.fixture ?? await (await import('./catalog.js')).loadSupportDeskFixture();
  buildFoldingGraph(fixture, plan, true);
  const boundary = project.boundaries.find(b => b.id === plan.boundaryId);
  if (!boundary || boundary.proposed !== plan.operation || JSON.stringify([...boundary.targetAgentIds].sort()) !== JSON.stringify([...plan.targetAgentIds].sort())) throw new Error('Plan does not match the declared boundary.');
  const cases = plan.caseIds.map(id => { const task = project.cases.find(c => c.id === id); if (!task) throw new Error(`Unknown case ${id}.`); return task; });
  if (!options.fixture) {
    const installed = await (await import('./catalog.js')).loadFoldingExample();
    if (cases.some(task => JSON.stringify(task.checks) !== JSON.stringify(installed.cases.find(c => c.id === task.id)?.checks))) throw new Error('Built-in execution accepts only the installed fixed support-desk checks. Use an independent external evaluator for custom tasks.');
  }
  if (plan.operation === 'merge' && !project.agents.some(a => a.id === 'orders_shipping')) project.agents.push({ id: 'orders_shipping', name: 'orders_shipping', owner: null, isMain: false, prompt: null, tools: unique([...(fixture.toolsByAgent.orders ?? []), ...(fixture.toolsByAgent.shipping ?? [])]).map(t => t.name), invokedBy: ['router'], returns: 'free_text', talksToUser: false, externalOwner: false, contextNeed: 'unknown', proposed: 'fold', rationale: { zh: '本实验候选图中合并的订单与物流角色。', en: 'Merged orders and shipping role in this candidate graph.' }, evidenceIds: [] });
  const output = resolve(options.output); await mkdir(dirname(output), { recursive: true }); await mkdir(output, { mode: 0o700 }); await mkdir(join(output, 'trials'), { mode: 0o700 });
  const experimentId = `local-${randomUUID()}`, sourceId = `${experimentId}-source`, createdAt = new Date().toISOString();
  project.sources.push({ id: sourceId, kind: client.fixture ? 'offline_smoke' : 'live_api', title: client.fixture ? 'Local unscored keyword fixture' : 'Local Anthropic Messages execution', url: null, revision: null, observedAt: createdAt, model: client.fixture ? 'offline-keyword-fixture' : plan.model, limitations: [client.fixture ? 'Offline stand-in only; no quality grades.' : 'Authorized CLI execution; response usage measured; invoice cost unavailable.', 'Measured token budgets are charged after responses and cannot guarantee an exact bill cap.', 'Shared deterministic verifier is not an independent model verifier.'] });
  const hasSkill = Object.keys(buildFoldingGraph(fixture, plan, true).skills).length > 0, ablation = hasSkill && plan.skillAblation === true;
  const experiment: FoldingExperiment = { id: experimentId, title: plan.title, boundaryId: plan.boundaryId, operation: plan.operation, baselineVariantId: 'baseline', candidateVariantId: 'candidate', caseIds: plan.caseIds, expectedRepetitions: plan.repetitions,
    controls: { taskSet: 'verified', grader: 'verified', model: 'same_recorded', nonTarget: 'verified', intervention: 'verified', execution: 'verified', baselineRevision: null, candidateRevision: null, skillAblation: hasSkill ? 'not_run' : 'not_applicable', notes: ['Built-in graph transformation only; permissions, policy checks and deterministic verifier are shared.', 'No independent model validation is claimed.', 'Long local payloads are losslessly segmented into labelled UTF-8 evidence events, each at most 16 KiB.'] }, trialIds: [], evidenceIds: [], ...(ablation ? { ablationVariantId: 'candidate_without_skill' } : {}) };
  const manifestId = `${experimentId}-graph`, manifest = { plan, node: process.version, createdAt, baseline: buildFoldingGraph(fixture, plan, false), candidate: buildFoldingGraph(fixture, plan, true), ...(ablation ? { ablation: buildFoldingGraph(fixture, plan, true, true) } : {}), verifier: 'shared deterministic installed support-desk checks; not an independent model', policies: 'signed-in record ownership, return window/final-sale, claims photos, write gate, address redaction' };
  const manifestText = JSON.stringify(manifest, null, 2), manifestFile = await open(join(output, 'run-manifest.json'), 'wx', 0o600);
  try { await manifestFile.writeFile(manifestText); await manifestFile.sync(); } finally { await manifestFile.close(); }
  project.evidence.push({ id: manifestId, sourceId, path: 'run-manifest.json', pointer: null, sha256: createHash('sha256').update(manifestText).digest('hex'), kind: 'code', excerpt: 'Exact baseline and candidate graphs, concrete budgets, environment and shared verifier. No credential value is stored.', text: null, complete: true, native: null });
  experiment.evidenceIds.push(manifestId);
  const chains = [...new Map(cases.flatMap(c => c.requiredChains).map(chain => [JSON.stringify(chain), chain])).values()];
  experiment.chainMappings = chains.filter(chain => chain.some(id => plan.targetAgentIds.includes(id))).flatMap(before => {
    const mapped = before.flatMap(id => !plan.targetAgentIds.includes(id) ? [id] : plan.operation === 'merge' ? ['orders_shipping'] : plan.operation === 'as_tool' ? ['diagnose_device'] : id === 'returns' ? ['load_skill', 'check_return_eligibility'] : ['load_skill']);
    const mapping = { variantId: 'candidate', before, after: mapped.filter((id, i) => id !== mapped[i - 1]), verified: true, evidenceIds: [manifestId] };
    if (!hasSkill && plan.operation === 'fold') mapping.after = before.flatMap(id => id === 'account' ? ['router'] : [id]);
    return ablation ? [mapping, { ...mapping, variantId: 'candidate_without_skill', after: mapping.after.filter(id => id !== 'load_skill') }] : [mapping];
  });
  project.experiments.push(experiment); await saveFoldingProject(join(output, 'report.json'), project);
  let writing = Promise.resolve();
  const execute = async (task: FoldingCase, repetition: number, variant: string) => {
    const result = await runTrial(project, fixture, plan, client, experimentId, variant, sourceId, task, repetition, options.signal);
    await saveTrial(join(output, 'trials', `${result.trial.id}.json`), result.trial);
    const gradeId = result.trial.evidenceIds[1]!;
    const gradeText = JSON.stringify({ grade: result.trial.grade, checks: result.trial.checks, harnessError: result.trial.harnessError });
    const gradeFile = await open(join(output, 'trials', `${result.trial.id}.grade.json`), 'wx', 0o600); try { await gradeFile.writeFile(gradeText); await gradeFile.sync(); } finally { await gradeFile.close(); }
    project.trials.push(result.trial); project.evidence.push(result.evidence, { ...result.evidence, id: gradeId, path: `trials/${result.trial.id}.grade.json`, kind: 'grade', sha256: createHash('sha256').update(gradeText).digest('hex') }); experiment.trialIds.push(result.trial.id); experiment.evidenceIds.push(result.evidence.id, gradeId);
    writing = writing.then(() => saveFoldingProject(join(output, 'report.json'), project)); await writing;
    options.onProgress?.(`${variant}/${task.id}/${repetition}: ${result.trial.harnessError ?? (client.fixture ? 'unscored' : result.trial.grade === 1 ? 'passed' : 'failed/unknown')}`);
  };
  for (const task of cases) for (let repetition = 0; repetition < plan.repetitions; repetition++) {
    if (options.signal?.aborted) break;
    const order = repetition % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']; if (ablation) order.push('candidate_without_skill');
    if (plan.schedule === 'parallel') { const results = await Promise.allSettled(order.map(v => execute(task, repetition, v))); const failure = results.find(r => r.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason; }
    else for (const variant of order) { if (options.signal?.aborted) break; await execute(task, repetition, variant); }
  }
  await writing;
  if (ablation) {
    const trials = project.trials.filter(t => t.experimentId === experimentId && t.variantId === experiment.ablationVariantId);
    if (trials.length === cases.length * plan.repetitions && trials.every(t => t.grade !== null && !t.harnessError && t.checks.length === cases.find(c => c.id === t.caseId)!.checks.length && t.checks.every(c => c.passed !== null) && t.events.every(e => e.complete))) experiment.controls.skillAblation = 'complete';
    await saveFoldingProject(join(output, 'report.json'), project);
  }
  return project;
}
async function saveTrial(path: string, trial: FoldingTrial): Promise<void> { const file = await open(path, 'wx', 0o600); try { await file.writeFile(JSON.stringify(trial, null, 2)); await file.sync(); } finally { await file.close(); } }

/** A new local run must not append to the official recorded experiment. */
export function freshFoldingProject(input: FoldingProject): FoldingProject {
  const project = structuredClone(input), references = new Set([...project.agents.flatMap(a => [...a.evidenceIds, ...(a.toolDefinitions?.flatMap(t => t.evidenceIds) ?? [])]), ...project.boundaries.flatMap(b => b.evidenceIds), ...project.cases.flatMap(c => c.evidenceIds)]);
  project.id = `runtime-${randomUUID()}`; project.createdAt = new Date().toISOString(); project.experiments = []; project.trials = []; project.traffic = []; project.humanDecisions = [];
  project.evidence = project.evidence.filter(e => references.has(e.id));
  const sources = new Set(project.evidence.map(e => e.sourceId)); project.sources = project.sources.filter(s => sources.has(s.id));
  project.limitations.push('Fresh runtime experiment; official historical model trials are loaded separately.');
  return validateFoldingProject(project);
}
export async function runFoldingSmoke(directory: string, signal?: AbortSignal): Promise<FoldingProject> {
  const catalog = await import('./catalog.js'), project = freshFoldingProject(await catalog.loadFoldingExample());
  const plan = { ...structuredClone(catalog.DEFAULT_FOLDING_PLAN), provider: 'fixture' as const, model: null };
  return runFoldingExperiment(project, plan, { output: join(directory, randomUUID()), signal });
}
