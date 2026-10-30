import type { FoldingCase, FoldingJson, FoldingProject, FoldingRunPlan } from './agent-folding-types.js';

export const FOLDING_MAX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
function invalid(path: string): never { throw new TypeError(`Invalid agent folding: ${path}`); }
function object(value: unknown, keys: string[], path: string, optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid(path);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(result, key))) invalid(`${path} fields`);
  return result;
}
function string(value: unknown, path: string, max = 16 * 1024, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0') || encoder.encode(value).length > max) invalid(path);
  return value;
}
function nullableString(value: unknown, path: string, max?: number, empty = false): string | null { return value === null ? null : string(value, path, max, empty); }
function number(value: unknown, path: string, max = Number.MAX_SAFE_INTEGER, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) invalid(path);
  return value;
}
function nullableNumber(value: unknown, path: string, integer = true): number | null { return value === null ? null : number(value, path, Number.MAX_SAFE_INTEGER, integer); }
function boolean(value: unknown, path: string): boolean { if (typeof value !== 'boolean') invalid(path); return value; }
function nullableBoolean(value: unknown, path: string): boolean | null { return value === null ? null : boolean(value, path); }
function choice<T extends string>(value: unknown, options: readonly T[], path: string): T { if (!options.includes(value as T)) invalid(path); return value as T; }
function array(value: unknown, path: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(path); return value; }
function strings(value: unknown, path: string, max: number, itemMax = 1024): string[] { return array(value, path, max).map(item => string(item, path, itemMax)); }
function unique(values: string[], path: string): void { if (new Set(values).size !== values.length) invalid(`${path} duplicate`); }
function utc(value: unknown, path: string): string {
  const result = string(value, path, 64);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) invalid(path);
  return result;
}
function nullableUtc(value: unknown, path: string): string | null { return value === null ? null : utc(value, path); }
function bilingual(value: unknown, path: string) {
  const result = object(value, ['zh', 'en'], path); return { zh: string(result.zh, path), en: string(result.en, path) };
}
function bounded(value: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { invalid('JSON'); }
  if (!json || encoder.encode(json).length > FOLDING_MAX_BYTES) invalid('8MiB budget');
}
function json(value: unknown, path: string, depth = 0): FoldingJson {
  if (depth > 20) invalid(`${path} depth`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(path); return value; }
  if (typeof value === 'string') return string(value, path, 64 * 1024, true);
  if (Array.isArray(value)) return array(value, path, 1000).map(item => json(item, path, depth + 1));
  if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid(path);
  if (Object.keys(value).length > 1000) invalid(path);
  const result: Record<string, FoldingJson> = Object.create(null) as Record<string, FoldingJson>;
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid(`${path} unsafe key`);
    string(key, path, 1024); result[key] = json(item, path, depth + 1);
  }
  return result;
}
const actions = ['fold', 'merge', 'as_tool', 'keep', 'insufficient'] as const;

export function validateFoldingCases(value: unknown): FoldingCase[] {
  const result = array(value, 'cases', 200).map(item => {
    const c = object(item, ['id', 'title', 'turns', 'customerId', 'tags', 'checks', 'requiredChains', 'split', 'evidenceIds'], 'case', ['chainChecks']);
    const turns = strings(c.turns, 'case.turns', 16, 64 * 1024);
    if (!turns.length || encoder.encode(turns.join('')).length > 64 * 1024) invalid('case.turns budget');
    const checks = array(c.checks, 'checks', 64).map(item => {
      const check = object(item, ['id', 'kind', 'expected', 'required'], 'check');
      return { id: string(check.id, 'check.id', 256), kind: choice(check.kind, ['answer_includes', 'answer_excludes', 'action', 'forbidden_action', 'only_expected_writes', 'external'], 'check.kind'),
        expected: json(check.expected, 'check.expected'), required: boolean(check.required, 'check.required') };
    });
    unique(checks.map(check => check.id), 'checks');
    if (!checks.some(check => check.required)) invalid('case requires an explicit required check');
    const requiredChains = array(c.requiredChains, 'chains', 64).map(chain => {
      const result = strings(chain, 'chain', 32, 256); if (!result.length) invalid('empty chain'); return result;
    });
    const chainChecks = c.chainChecks === undefined ? undefined : array(c.chainChecks, 'chainChecks', 64).map(item => {
      const mapping = object(item, ['chain', 'checkId'], 'chain check');
      const chain = strings(mapping.chain, 'chain check.chain', 32, 256), checkId = string(mapping.checkId, 'chain check.checkId', 256);
      if (!requiredChains.some(required => JSON.stringify(required) === JSON.stringify(chain)) || !checks.some(check => check.id === checkId && check.required)) invalid('chain terminal check');
      return { chain, checkId };
    });
    return { id: string(c.id, 'case.id', 256), title: string(c.title, 'case.title'), turns,
      customerId: nullableString(c.customerId, 'customerId', 256), tags: strings(c.tags, 'tags', 64), checks, requiredChains,
      split: choice(c.split, ['train', 'confirmation'], 'case.split'), evidenceIds: strings(c.evidenceIds, 'case.evidenceIds', 2000, 256),
      ...(chainChecks === undefined ? {} : { chainChecks }) };
  });
  unique(result.map(item => item.id), 'cases'); return result;
}

/** Structural validation does not authenticate a source; use importFoldingProject at untrusted entry points. */
export function validateFoldingProject(value: unknown): FoldingProject {
  bounded(value);
  const p = object(value, ['version', 'kind', 'id', 'title', 'createdAt', 'sources', 'agents', 'boundaries', 'cases', 'traffic', 'experiments', 'trials', 'evidence', 'humanDecisions', 'limitations'], 'project');
  if (p.version !== 1 || p.kind !== 'agent-folding-project') invalid('project version/kind');
  const sources = array(p.sources, 'sources', 2000).map(item => {
    const s = object(item, ['id', 'kind', 'title', 'url', 'revision', 'observedAt', 'model', 'limitations'], 'source');
    return { id: string(s.id, 'source.id', 256), kind: choice(s.kind, ['official_recording', 'synthetic_traffic', 'offline_smoke', 'live_api', 'user_import', 'native_telemetry', 'source_code'], 'source.kind'),
      title: string(s.title, 'source.title'), url: nullableString(s.url, 'source.url'), revision: nullableString(s.revision, 'source.revision'),
      observedAt: nullableUtc(s.observedAt, 'observedAt'), model: nullableString(s.model, 'source.model'), limitations: strings(s.limitations, 'source.limitations', 100) };
  });
  const evidence = array(p.evidence, 'evidence', 2000).map(item => {
    const e = object(item, ['id', 'sourceId', 'path', 'pointer', 'sha256', 'kind', 'excerpt', 'text', 'complete', 'native'], 'evidence');
    const sha256 = nullableString(e.sha256, 'sha256', 64); if (sha256 !== null && !/^[a-f0-9]{64}$/u.test(sha256)) invalid('sha256');
    let native = null;
    if (e.native !== null) {
      const n = object(e.native, ['taskId', 'sessionKey', 'eventId', 'captureId', 'callSequence'], 'native');
      native = { taskId: string(n.taskId, 'native.taskId', 1024), sessionKey: nullableString(n.sessionKey, 'native.sessionKey', 1024),
        eventId: nullableString(n.eventId, 'native.eventId', 1024), captureId: nullableNumber(n.captureId, 'captureId'), callSequence: nullableNumber(n.callSequence, 'callSequence') };
      if ((native.captureId !== null && native.captureId < 1) || (native.callSequence !== null && native.captureId === null)
        || (native.eventId !== null && native.sessionKey === null)) invalid('native locator');
    }
    return { id: string(e.id, 'evidence.id', 256), sourceId: string(e.sourceId, 'evidence.sourceId', 256), path: string(e.path, 'evidence.path'),
      pointer: nullableString(e.pointer, 'pointer', undefined, true), sha256, kind: choice(e.kind, ['code', 'trace', 'grade', 'action', 'model_call', 'owner', 'document'], 'evidence.kind'),
      excerpt: nullableString(e.excerpt, 'excerpt', undefined, true), text: nullableString(e.text, 'text', undefined, true), complete: boolean(e.complete, 'complete'), native };
  });
  const agents = array(p.agents, 'agents', 32).map(item => {
    const a = object(item, ['id', 'name', 'owner', 'isMain', 'prompt', 'tools', 'invokedBy', 'returns', 'talksToUser', 'externalOwner', 'contextNeed', 'proposed', 'rationale', 'evidenceIds'], 'agent', ['toolDefinitions']);
    const toolDefinitions = a.toolDefinitions === undefined ? undefined : array(a.toolDefinitions, 'toolDefinitions', 256).map(item => {
      const tool = object(item, ['name', 'description', 'inputSchema', 'writes', 'preconditions', 'evidenceIds'], 'tool definition');
      return { name: string(tool.name, 'tool.name', 1024), description: string(tool.description, 'tool.description', 16 * 1024, true),
        inputSchema: json(tool.inputSchema, 'tool.inputSchema'), writes: nullableBoolean(tool.writes, 'tool.writes'),
        preconditions: strings(tool.preconditions, 'tool.preconditions', 64), evidenceIds: strings(tool.evidenceIds, 'tool.evidenceIds', 2000, 256) };
    });
    return { id: string(a.id, 'agent.id', 256), name: string(a.name, 'agent.name'), owner: nullableString(a.owner, 'owner'),
      isMain: boolean(a.isMain, 'isMain'), prompt: nullableString(a.prompt, 'prompt', undefined, true), tools: strings(a.tools, 'tools', 256), invokedBy: strings(a.invokedBy, 'invokedBy', 32, 256), returns: nullableString(a.returns, 'returns', undefined, true),
      talksToUser: nullableBoolean(a.talksToUser, 'talksToUser'), externalOwner: nullableBoolean(a.externalOwner, 'externalOwner'),
      contextNeed: choice(a.contextNeed, ['large_input', 'independent_parallel', 'independent_verification', 'tool_conflict', 'none', 'unknown'], 'contextNeed'),
      proposed: choice(a.proposed, [...actions, 'main'], 'proposed'), rationale: bilingual(a.rationale, 'rationale'), evidenceIds: strings(a.evidenceIds, 'agent.evidenceIds', 2000, 256),
      ...(toolDefinitions === undefined ? {} : { toolDefinitions }) };
  });
  const boundaries = array(p.boundaries, 'boundaries', 64).map(item => {
    const b = object(item, ['id', 'fromAgentId', 'targetAgentIds', 'proposed', 'title', 'rationale', 'requirements', 'evidenceIds'], 'boundary');
    const targets = strings(b.targetAgentIds, 'targetAgentIds', 31, 256); unique(targets, 'targets'); if (!targets.length) invalid('empty targets');
    return { id: string(b.id, 'boundary.id', 256), fromAgentId: string(b.fromAgentId, 'fromAgentId', 256), targetAgentIds: targets,
      proposed: choice(b.proposed, actions, 'boundary.proposed'), title: bilingual(b.title, 'boundary.title'), rationale: bilingual(b.rationale, 'boundary.rationale'),
      requirements: strings(b.requirements, 'requirements', 64), evidenceIds: strings(b.evidenceIds, 'boundary.evidenceIds', 2000, 256) };
  });
  const cases = validateFoldingCases(p.cases);
  const traffic = array(p.traffic, 'traffic', 10_000).map(item => {
    const row = object(item, ['traceId', 'sequence', 'agentId', 'callerId', 'timestamp', 'durationMs', 'inputTokens', 'evidenceId'], 'traffic');
    return { traceId: string(row.traceId, 'traceId', 256), sequence: number(row.sequence, 'traffic.sequence'), agentId: string(row.agentId, 'traffic.agentId', 256),
      callerId: nullableString(row.callerId, 'callerId', 256), timestamp: nullableUtc(row.timestamp, 'timestamp'), durationMs: nullableNumber(row.durationMs, 'durationMs', false),
      inputTokens: nullableNumber(row.inputTokens, 'inputTokens'), evidenceId: string(row.evidenceId, 'traffic.evidenceId', 256) };
  });
  const experiments = array(p.experiments, 'experiments', 20).map(item => {
    const e = object(item, ['id', 'title', 'boundaryId', 'operation', 'baselineVariantId', 'candidateVariantId', 'caseIds', 'expectedRepetitions', 'controls', 'trialIds', 'evidenceIds'], 'experiment', ['chainMappings', 'ablationVariantId']);
    const c = object(e.controls, ['taskSet', 'grader', 'model', 'nonTarget', 'intervention', 'execution', 'baselineRevision', 'candidateRevision', 'skillAblation', 'notes'], 'controls');
    const controls = { taskSet: choice(c.taskSet, ['verified', 'declared', 'changed', 'unknown'], 'taskSet'), grader: choice(c.grader, ['verified', 'declared', 'changed', 'unknown'], 'grader'),
      model: choice(c.model, ['same_recorded', 'different', 'unknown'], 'model control'), nonTarget: choice(c.nonTarget, ['verified', 'declared', 'changed', 'unknown'], 'nonTarget'),
      intervention: choice(c.intervention, ['verified', 'declared', 'unknown'], 'intervention'), execution: choice(c.execution, ['verified', 'declared', 'changed', 'unknown'], 'execution'), baselineRevision: nullableString(c.baselineRevision, 'baselineRevision'),
      candidateRevision: nullableString(c.candidateRevision, 'candidateRevision'), skillAblation: choice(c.skillAblation, ['complete', 'not_run', 'not_applicable'], 'skillAblation'), notes: strings(c.notes, 'controls.notes', 100) };
    const caseIds = strings(e.caseIds, 'experiment.caseIds', 200, 256); unique(caseIds, 'experiment.caseIds');
    const trialIds = strings(e.trialIds, 'trialIds', 4000, 256); unique(trialIds, 'trialIds');
    const expectedRepetitions = number(e.expectedRepetitions, 'expectedRepetitions', 100); if (!expectedRepetitions || !caseIds.length) invalid('empty experiment');
    const baselineVariantId = string(e.baselineVariantId, 'baselineVariantId', 256), candidateVariantId = string(e.candidateVariantId, 'candidateVariantId', 256);
    if (baselineVariantId === candidateVariantId) invalid('variant identity');
    const ablationVariantId = e.ablationVariantId === undefined ? undefined : string(e.ablationVariantId, 'ablationVariantId', 256);
    if (ablationVariantId !== undefined && [baselineVariantId, candidateVariantId].includes(ablationVariantId)) invalid('ablation variant identity');
    const chainMappings = e.chainMappings === undefined ? undefined : array(e.chainMappings, 'chainMappings', 64).map(item => {
      const m = object(item, ['variantId', 'before', 'after', 'verified', 'evidenceIds'], 'chain mapping');
      const variantId = string(m.variantId, 'mapping.variantId', 256), before = strings(m.before, 'mapping.before', 32, 256), after = strings(m.after, 'mapping.after', 32, 256);
      if (![baselineVariantId, candidateVariantId, ablationVariantId].includes(variantId) || !before.length || !after.length) invalid('chain mapping identity');
      const verified = boolean(m.verified, 'mapping.verified'), evidenceIds = strings(m.evidenceIds, 'mapping.evidenceIds', 2000, 256);
      if (verified && !evidenceIds.length) invalid('verified chain mapping evidence');
      return { variantId, before, after, verified, evidenceIds };
    });
    return { id: string(e.id, 'experiment.id', 256), title: string(e.title, 'experiment.title'), boundaryId: string(e.boundaryId, 'experiment.boundaryId', 256),
      operation: choice(e.operation, ['fold', 'merge', 'as_tool', 'keep'], 'operation'), baselineVariantId, candidateVariantId, caseIds, expectedRepetitions, controls, trialIds, evidenceIds: strings(e.evidenceIds, 'experiment.evidenceIds', 2000, 256),
      ...(chainMappings === undefined ? {} : { chainMappings }), ...(ablationVariantId === undefined ? {} : { ablationVariantId }) };
  });
  let eventCount = 0;
  const trials = array(p.trials, 'trials', 4000).map(item => {
    const t = object(item, ['id', 'experimentId', 'variantId', 'caseId', 'repetition', 'sourceId', 'grade', 'checks', 'answer', 'latencyMs', 'inputTokens', 'outputTokens', 'modelCalls', 'toolCalls', 'model', 'byAgent', 'actions', 'events', 'harnessError', 'evidenceIds'], 'trial');
    const grade = t.grade === null ? null : number(t.grade, 'grade', 1) as 0 | 1;
    const checks = array(t.checks, 'trial.checks', 64).map(item => {
      const c = object(item, ['id', 'label', 'passed', 'evidenceId'], 'check result'); return { id: string(c.id, 'check.id', 256), label: string(c.label, 'check.label'), passed: nullableBoolean(c.passed, 'passed'), evidenceId: nullableString(c.evidenceId, 'check.evidenceId', 256) };
    });
    unique(checks.map(check => check.id), 'trial checks');
    if (!t.byAgent || typeof t.byAgent !== 'object' || Array.isArray(t.byAgent) || Object.keys(t.byAgent).length > 32) invalid('byAgent');
    const byAgent: FoldingProject['trials'][number]['byAgent'] = Object.create(null) as FoldingProject['trials'][number]['byAgent'];
    for (const [id, value] of Object.entries(t.byAgent)) {
      string(id, 'byAgent.id', 256); const a = object(value, ['calls', 'inputTokens', 'outputTokens'], 'agent usage');
      byAgent[id] = { calls: number(a.calls, 'calls'), inputTokens: number(a.inputTokens, 'inputTokens'), outputTokens: number(a.outputTokens, 'outputTokens') };
    }
    const trialActions = array(t.actions, 'trial.actions', 1000).map(item => {
      const a = object(item, ['name', 'args', 'evidenceId'], 'action'); return { name: string(a.name, 'action.name'), args: json(a.args, 'action.args'), evidenceId: nullableString(a.evidenceId, 'action.evidenceId', 256) };
    });
    const events = array(t.events, 'events', 20_000).map(item => {
      const e = object(item, ['id', 'sequence', 'role', 'agentId', 'targetAgentId', 'name', 'content', 'startMs', 'durationMs', 'evidenceId', 'complete'], 'event');
      return { id: string(e.id, 'event.id', 256), sequence: number(e.sequence, 'event.sequence'), role: choice(e.role, ['user', 'assistant', 'tool_call', 'tool_result', 'model', 'skill', 'handoff', 'verification'], 'event.role'),
        agentId: nullableString(e.agentId, 'event.agentId', 256), targetAgentId: nullableString(e.targetAgentId, 'event.targetAgentId', 256), name: nullableString(e.name, 'event.name'), content: nullableString(e.content, 'event.content', undefined, true),
        startMs: nullableNumber(e.startMs, 'startMs', false), durationMs: nullableNumber(e.durationMs, 'durationMs', false), evidenceId: string(e.evidenceId, 'event.evidenceId', 256), complete: boolean(e.complete, 'event.complete') };
    });
    eventCount += events.length; if (eventCount > 20_000) invalid('trace event budget');
    unique(events.map(event => event.id), 'event ids'); unique(events.map(event => String(event.sequence)), 'event sequence');
    return { id: string(t.id, 'trial.id', 256), experimentId: string(t.experimentId, 'trial.experimentId', 256), variantId: string(t.variantId, 'variantId', 256), caseId: string(t.caseId, 'trial.caseId', 256),
      repetition: number(t.repetition, 'repetition', 100), sourceId: string(t.sourceId, 'trial.sourceId', 256), grade, checks, answer: nullableString(t.answer, 'answer', undefined, true),
      latencyMs: nullableNumber(t.latencyMs, 'latencyMs', false), inputTokens: nullableNumber(t.inputTokens, 'inputTokens'), outputTokens: nullableNumber(t.outputTokens, 'outputTokens'),
      modelCalls: nullableNumber(t.modelCalls, 'modelCalls'), toolCalls: nullableNumber(t.toolCalls, 'toolCalls'), model: nullableString(t.model, 'trial.model'), byAgent,
      actions: trialActions, events, harnessError: nullableString(t.harnessError, 'harnessError'), evidenceIds: strings(t.evidenceIds, 'trial.evidenceIds', 2000, 256) };
  });
  const humanDecisions = array(p.humanDecisions, 'humanDecisions', 1000).map(item => {
    const d = object(item, ['id', 'boundaryId', 'action', 'note', 'decidedAt', 'evidenceIds'], 'human decision');
    return { id: string(d.id, 'decision.id', 256), boundaryId: string(d.boundaryId, 'decision.boundaryId', 256), action: choice(d.action, ['keep_change', 'revert', 'fix', 'rerun'], 'decision.action'),
      note: string(d.note, 'note', 16 * 1024, true), decidedAt: nullableUtc(d.decidedAt, 'decidedAt'), evidenceIds: strings(d.evidenceIds, 'decision.evidenceIds', 2000, 256) };
  });
  const project: FoldingProject = { version: 1, kind: 'agent-folding-project', id: string(p.id, 'project.id', 256), title: string(p.title, 'project.title'), createdAt: utc(p.createdAt, 'createdAt'),
    sources, evidence, agents, boundaries, cases, traffic, experiments, trials, humanDecisions, limitations: strings(p.limitations, 'limitations', 200) };
  const maps = { sources: new Map(sources.map(item => [item.id, item])), evidence: new Map(evidence.map(item => [item.id, item])), agents: new Map(agents.map(item => [item.id, item])),
    boundaries: new Map(boundaries.map(item => [item.id, item])), cases: new Map(cases.map(item => [item.id, item])), experiments: new Map(experiments.map(item => [item.id, item])), trials: new Map(trials.map(item => [item.id, item])) };
  for (const [key, values] of Object.entries({ sources, evidence, agents, boundaries, cases, experiments, trials, humanDecisions })) unique(values.map(item => item.id), key);
  const evidenceRefs = (ids: string[]) => { if (ids.some(id => !maps.evidence.has(id))) invalid('evidence reference'); };
  if (agents.filter(agent => agent.isMain).length !== 1) invalid('exactly one main agent');
  for (const e of evidence) if (!maps.sources.has(e.sourceId)) invalid('evidence source');
  for (const a of agents) {
    evidenceRefs(a.evidenceIds);
    a.toolDefinitions?.forEach(tool => { evidenceRefs(tool.evidenceIds); if (!a.tools.includes(tool.name)) invalid('tool definition name'); });
    if (a.invokedBy.some(id => !maps.agents.has(id)) || (a.isMain && a.proposed !== 'main') || (!a.isMain && a.proposed === 'main')) invalid('agent inventory');
  }
  for (const b of boundaries) { evidenceRefs(b.evidenceIds); if (!maps.agents.has(b.fromAgentId) || b.targetAgentIds.some(id => !maps.agents.has(id) || maps.agents.get(id)!.isMain || id === b.fromAgentId)) invalid('boundary target'); }
  cases.forEach(c => evidenceRefs(c.evidenceIds));
  for (const row of traffic) if (!maps.agents.has(row.agentId) || (row.callerId !== null && !maps.agents.has(row.callerId)) || !maps.evidence.has(row.evidenceId)) invalid('traffic reference');
  unique(traffic.map(row => JSON.stringify([row.traceId, row.sequence])), 'traffic sequence');
  const identities: string[] = [];
  let expectedSlots = 0;
  for (const experiment of experiments) for (const caseId of experiment.caseIds) {
    expectedSlots += new Set([...Array.from({ length: experiment.expectedRepetitions }, (_, index) => index),
      ...trials.filter(trial => trial.experimentId === experiment.id && trial.caseId === caseId).map(trial => trial.repetition)]).size * (experiment.ablationVariantId === undefined ? 2 : 3);
  }
  if (expectedSlots > 4000) invalid('expected trial budget');
  for (const trial of trials) {
    const experiment = maps.experiments.get(trial.experimentId), c = maps.cases.get(trial.caseId), source = maps.sources.get(trial.sourceId);
    if (!experiment || !c || !source || !experiment.trialIds.includes(trial.id) || !experiment.caseIds.includes(trial.caseId)
      || ![experiment.baselineVariantId, experiment.candidateVariantId, experiment.ablationVariantId].includes(trial.variantId) || trial.repetition > 99) invalid('trial identity');
    identities.push(JSON.stringify([trial.experimentId, trial.variantId, trial.caseId, trial.repetition]));
    if ((source.kind === 'offline_smoke' || source.kind === 'synthetic_traffic') && (trial.grade !== null || trial.checks.some(check => check.passed !== null))) invalid('offline/synthetic grading');
    if (trial.checks.some(check => !c.checks.some(expected => expected.id === check.id))) invalid('unknown check');
    evidenceRefs(trial.evidenceIds); trial.checks.forEach(check => { if (check.evidenceId !== null) evidenceRefs([check.evidenceId]); });
    trial.actions.forEach(action => { if (action.evidenceId !== null) evidenceRefs([action.evidenceId]); });
    for (const event of trial.events) evidenceRefs([event.evidenceId]);
  }
  unique(identities, 'trial tuple');
  for (const e of experiments) {
    evidenceRefs(e.evidenceIds); if (!maps.boundaries.has(e.boundaryId) || e.caseIds.some(id => !maps.cases.has(id))
      || e.trialIds.some(id => maps.trials.get(id)?.experimentId !== e.id)) invalid('experiment reference');
    e.chainMappings?.forEach(mapping => evidenceRefs(mapping.evidenceIds));
  }
  for (const d of humanDecisions) { evidenceRefs(d.evidenceIds); if (!maps.boundaries.has(d.boundaryId)) invalid('decision boundary'); }
  bounded(project); return project;
}

/** Import provenance is user-reported, even when the file claims official or native origins. */
export function importFoldingProject(value: unknown): FoldingProject {
  const project = validateFoldingProject(value);
  const append = (items: string[], item: string) => items.includes(item) ? items : [...items, item];
  const imported: FoldingProject = { ...project,
    sources: project.sources.map(source => ({ ...source, kind: 'user_import', limitations: source.kind === 'user_import'
      && source.limitations.some(limit => limit.startsWith('User-reported import; original claimed kind:')) ? source.limitations
      : append(source.limitations, `User-reported import; original claimed kind: ${source.kind}. Source authenticity is unverified.`) })),
    evidence: project.evidence.map(evidence => ({ ...evidence, native: null })),
    experiments: project.experiments.map(experiment => ({ ...experiment,
      controls: { ...experiment.controls,
        taskSet: experiment.controls.taskSet === 'verified' ? 'declared' : experiment.controls.taskSet,
        grader: experiment.controls.grader === 'verified' ? 'declared' : experiment.controls.grader,
        nonTarget: experiment.controls.nonTarget === 'verified' ? 'declared' : experiment.controls.nonTarget,
        intervention: experiment.controls.intervention === 'verified' ? 'declared' : experiment.controls.intervention,
        execution: experiment.controls.execution === 'verified' ? 'declared' : experiment.controls.execution,
        notes: append(experiment.controls.notes, 'Imported controls are declarations, not local verification.') },
      ...(experiment.chainMappings === undefined ? {} : { chainMappings: experiment.chainMappings.map(mapping => ({ ...mapping, verified: false })) }),
    })),
    limitations: append(project.limitations, 'Imported source claims and locators are unverified; no file, URL, HTML, script or model was executed.'),
  };
  return validateFoldingProject(imported);
}

export function validateFoldingRunPlan(value: unknown): FoldingRunPlan {
  bounded(value);
  const p = object(value, ['version', 'kind', 'title', 'adapter', 'provider', 'model', 'boundaryId', 'operation', 'targetAgentIds', 'caseIds', 'repetitions', 'schedule', 'budgets', 'external'], 'plan', ['skillAblation']);
  const skillAblation = p.skillAblation === undefined ? undefined : boolean(p.skillAblation, 'skillAblation');
  if (p.version !== 1 || p.kind !== 'agent-folding-plan') invalid('plan version/kind');
  const b = object(p.budgets, ['maxCallsPerCase', 'maxOutputTokens', 'maxInputChars', 'maxTotalTokensPerCase', 'timeoutMs', 'maxToolBatch'], 'budgets');
  const budgets = { maxCallsPerCase: number(b.maxCallsPerCase, 'maxCallsPerCase', 100), maxOutputTokens: number(b.maxOutputTokens, 'maxOutputTokens', 64_000),
    maxInputChars: number(b.maxInputChars, 'maxInputChars', 1_000_000), maxTotalTokensPerCase: number(b.maxTotalTokensPerCase, 'maxTotalTokensPerCase', 2_000_000),
    timeoutMs: number(b.timeoutMs, 'timeoutMs', 600_000), maxToolBatch: number(b.maxToolBatch, 'maxToolBatch', 32) };
  if (Object.values(budgets).some(value => value < 1) || budgets.timeoutMs < 100) invalid('positive budgets');
  const adapter = choice(p.adapter, ['support-desk', 'external'], 'adapter');
  let external: FoldingRunPlan['external'] = null;
  if (p.external !== null) {
    const e = object(p.external, ['repository', 'ref', 'baselineDriver', 'candidateDriver', 'evaluator', 'cases'], 'external', ['project']);
    const argv = (value: unknown) => { const result = strings(value, 'argv', 128, 8192); if (!result.length) invalid('empty argv'); return result; };
    const repository = string(e.repository, 'repository', 8192); if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/u.test(repository)) invalid('absolute repository');
    external = { repository, ref: string(e.ref, 'ref', 1024), baselineDriver: argv(e.baselineDriver), candidateDriver: argv(e.candidateDriver), evaluator: argv(e.evaluator), cases: validateFoldingCases(e.cases),
      ...(e.project === undefined ? {} : { project: importFoldingProject(e.project) }) };
  }
  if ((adapter === 'external') !== (external !== null)) invalid('external adapter config');
  const provider = choice(p.provider, ['anthropic', 'fixture'], 'provider'), model = nullableString(p.model, 'model', 256);
  if (provider === 'anthropic' && (!model || !model.trim())) invalid('explicit live model');
  const targetAgentIds = strings(p.targetAgentIds, 'targetAgentIds', 31, 256), caseIds = strings(p.caseIds, 'caseIds', 200, 256);
  unique(targetAgentIds, 'targets'); unique(caseIds, 'caseIds');
  const repetitions = number(p.repetitions, 'repetitions', 100);
  if (!targetAgentIds.length || !caseIds.length || !repetitions || caseIds.length * repetitions * (skillAblation ? 3 : 2) > 4000) invalid('run count');
  if (external && (external.cases.length !== caseIds.length || external.cases.some(c => !caseIds.includes(c.id)))) invalid('external case set');
  return { version: 1, kind: 'agent-folding-plan', title: string(p.title, 'title'), adapter, provider, model,
    boundaryId: string(p.boundaryId, 'boundaryId', 256), operation: choice(p.operation, ['fold', 'merge', 'as_tool'], 'operation'), targetAgentIds, caseIds, repetitions,
    schedule: choice(p.schedule, ['sequential', 'parallel'], 'schedule'), budgets, external, ...(skillAblation === undefined ? {} : { skillAblation }) };
}
