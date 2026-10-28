import { validateBenchmarkManifest, validateBenchmarkReport } from './benchmark-validation.js';
import type { TeamExperimentCase, TeamExperimentDemoInput, TeamExperimentEvidence, TeamExperimentPlan, TeamExperimentReport } from './team-experiment-types.js';

export const TEAM_EXPERIMENT_MAX_BYTES = 16 * 1024 * 1024;
const modes = ['single_loop', 'subagents', 'agent_team'] as const;
function invalid(path: string): never { throw new Error(`Invalid team experiment: ${path}`); }
function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) invalid(path);
  return r;
}
function text(value: unknown, path: string, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > max) invalid(path);
  return value;
}
function optionalText(value: unknown, path: string, max = 1000): string | null { return value === null ? null : text(value, path, max); }
function number(value: unknown, path: string, max = 86400000, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) invalid(path);
  return value;
}
function nullableNumber(value: unknown, path: string, max?: number, integer = false): number | null { return value === null ? null : number(value, path, max, integer); }
function boolean(value: unknown, path: string): boolean { if (typeof value !== 'boolean') invalid(path); return value; }
function choice<T extends string>(value: unknown, options: readonly T[], path: string): T { if (!options.includes(value as T)) invalid(path); return value as T; }
function array(value: unknown, path: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(path); return value; }
function unique(values: readonly string[], path: string): void { if (new Set(values).size !== values.length) invalid(path); }
function fingerprint(value: unknown, path: string, pattern: RegExp): string { const s = text(value, path); if (!pattern.test(s)) invalid(path); return s; }
function utc(value: unknown, path: string): string { const s = text(value, path); if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) invalid(path); return s; }
function bounded(value: unknown): void {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { invalid('JSON'); }
  if (!json || new TextEncoder().encode(json).length > TEAM_EXPERIMENT_MAX_BYTES) invalid('report bytes');
}
function acyclic(ids: readonly string[], links: (id: string) => readonly string[], path: string): void {
  const done = new Set<string>(), active = new Set<string>();
  for (const id of ids) {
    const stack: Array<{ id: string; exit: boolean }> = [{ id, exit: false }];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.exit) { active.delete(current.id); done.add(current.id); continue; }
      if (done.has(current.id)) continue;
      if (active.has(current.id)) invalid(path);
      active.add(current.id); stack.push({ id: current.id, exit: true });
      for (const next of links(current.id)) stack.push({ id: next, exit: false });
    }
  }
}

/** SHA-256 over UTF-8, kept synchronous so imported reports can be verified in the browser. */
export function teamExperimentPromptSha256(input: string): string {
  const bytes = new TextEncoder().encode(input), blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64); padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 4, bytes.length * 8);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits)), w = new Int32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; w[i] = w[i - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)); }
    let [a, b, c, d, e, f, g, z] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!;
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      z = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    for (const [i, v] of [a, b, c, d, e, f, g, z].entries()) h[i] = (h[i]! + v) | 0;
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

export function validateTeamExperimentPlan(value: unknown): TeamExperimentPlan {
  const r = object(value, ['version', 'kind', 'name', 'repetitions', 'schedule', 'task', 'variants'], 'plan');
  if (r.version !== 1 || r.kind !== 'team-experiment') invalid('plan version/kind');
  const task = object(r.task, ['id', 'repository', 'ref', 'prompt', 'expectedTests', 'evaluator', 'timeoutMs', 'caseIds'], 'task');
  const caseIds = array(task.caseIds, 'caseIds', 1000).map(x => text(x, 'caseId', 256)); unique(caseIds, 'caseIds');
  const variants = array(r.variants, 'variants', 3).map(value => {
    const v = object(value, ['id', 'product', 'model', 'environment', 'parameters', 'toolSet', 'driver', 'mode', 'prompt'], 'variant');
    const { mode, prompt, ...base } = v;
    return { base, mode: choice(mode, modes, 'mode'), prompt: text(prompt, 'variant.prompt', 32000) };
  });
  if (variants.length < 2 || !caseIds.length || task.expectedTests !== caseIds.length) invalid('variant/case count');
  const { caseIds: _cases, ...baseTask } = task; void _cases;
  const base = validateBenchmarkManifest({ version: 1, name: r.name, repetitions: r.repetitions, task: baseTask, variants: variants.map(v => v.base) });
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(base.task.repository)) invalid('repository must be an absolute local path');
  return { ...base, kind: 'team-experiment', schedule: choice(r.schedule, ['parallel', 'sequential'], 'schedule'), task: { ...base.task, caseIds }, variants: base.variants.map((v, i) => ({ ...v, mode: variants[i]!.mode, prompt: variants[i]!.prompt })) };
}

export function validateTeamExperimentCases(value: unknown, expectedCaseIds: readonly string[]): TeamExperimentCase[] {
  const cases = array(value, 'cases', 1000).map(value => {
    const c = object(value, ['id', 'status', 'detail'], 'case');
    return { id: text(c.id, 'case.id', 256), status: choice(c.status, ['passed', 'failed', 'unknown'], 'case.status'), detail: optionalText(c.detail, 'case.detail', 32000) };
  });
  unique(cases.map(c => c.id), 'duplicate cases');
  if (cases.length !== expectedCaseIds.length || cases.some(c => !expectedCaseIds.includes(c.id))) invalid('case set');
  return cases;
}

export function validateTeamExperimentEvidence(value: unknown): TeamExperimentEvidence {
  bounded(value);
  const r = object(value, ['coverage', 'agents', 'events'], 'evidence');
  const c = object(r.coverage, ['roster', 'activities', 'communication'], 'coverage');
  const agents = array(r.agents, 'agents', 64).map(value => {
    const a = object(value, ['id', 'name', 'parentId', 'sessionKey'], 'agent');
    return { id: text(a.id, 'agent.id', 256), name: text(a.name, 'agent.name', 256), parentId: optionalText(a.parentId, 'parentId', 256), sessionKey: optionalText(a.sessionKey, 'sessionKey') };
  });
  unique(agents.map(a => a.id), 'agent ids');
  const roster = new Map(agents.map(a => [a.id, a]));
  if (agents.some(a => a.parentId !== null && !roster.has(a.parentId))) invalid('parent reference');
  acyclic([...roster.keys()], id => roster.get(id)!.parentId === null ? [] : [roster.get(id)!.parentId!], 'parent cycle');
  const events = array(r.events, 'events', 2000).map(value => {
    const e = object(value, ['id', 'agentId', 'targetAgentId', 'kind', 'name', 'detail', 'startMs', 'durationMs', 'timing', 'status', 'dependsOn', 'tokens', 'sessionKey', 'eventId'], 'event');
    const startMs = number(e.startMs, 'startMs'), durationMs = nullableNumber(e.durationMs, 'durationMs');
    if (startMs + (durationMs ?? 0) > 86400000) invalid('event end');
    const dependsOn = array(e.dependsOn, 'dependsOn', 2000).map(x => text(x, 'dependency', 256)); unique(dependsOn, 'duplicate dependency');
    return { id: text(e.id, 'event.id', 256), agentId: text(e.agentId, 'agentId', 256), targetAgentId: optionalText(e.targetAgentId, 'targetAgentId', 256), kind: choice(e.kind, ['model', 'tool', 'task', 'message', 'wait', 'handoff', 'verification', 'artifact', 'rework', 'context'], 'event.kind'), name: text(e.name, 'event.name'), detail: optionalText(e.detail, 'event.detail', 32000), startMs, durationMs, timing: choice(e.timing, ['measured', 'observed', 'derived'], 'timing'), status: choice(e.status, ['ok', 'error', 'unknown'], 'status'), dependsOn, tokens: nullableNumber(e.tokens, 'tokens', Number.MAX_SAFE_INTEGER, true), sessionKey: optionalText(e.sessionKey, 'sessionKey'), eventId: optionalText(e.eventId, 'eventId') };
  });
  unique(events.map(e => e.id), 'event ids');
  const index = new Map(events.map(e => [e.id, e]));
  if (events.some(e => !roster.has(e.agentId) || (e.targetAgentId !== null && !roster.has(e.targetAgentId)) || e.dependsOn.some(id => !index.has(id)))) invalid('event reference');
  acyclic([...index.keys()], id => index.get(id)!.dependsOn, 'dependency cycle');
  return { coverage: { roster: boolean(c.roster, 'coverage.roster'), activities: boolean(c.activities, 'coverage.activities'), communication: boolean(c.communication, 'coverage.communication') }, agents, events };
}

export function validateTeamExperimentReport(value: unknown): TeamExperimentReport {
  bounded(value);
  const r = object(value, ['version', 'kind', 'synthetic', 'plan', 'commit', 'createdAt', 'trials'], 'report');
  if (r.version !== 1 || r.kind !== 'team-experiment-report') invalid('report version/kind');
  const plan = validateTeamExperimentPlan(r.plan), commit = fingerprint(r.commit, 'commit', /^[a-f0-9]{40,64}$/), createdAt = utc(r.createdAt, 'createdAt'), synthetic = boolean(r.synthetic, 'synthetic');
  const { kind: _kind, schedule: _schedule, ...manifest } = plan; void _kind; void _schedule;
  const baseManifest = { ...manifest, task: { id: plan.task.id, repository: plan.task.repository, ref: plan.task.ref, prompt: plan.task.prompt, expectedTests: plan.task.expectedTests, evaluator: plan.task.evaluator, timeoutMs: plan.task.timeoutMs }, variants: plan.variants.map(({ mode: _mode, prompt: _prompt, ...v }) => { void _mode; void _prompt; return v; }) };
  const trials = array(r.trials, 'trials', 30).map(value => {
    const t = object(value, ['id', 'variantId', 'repetition', 'promptSha256', 'run', 'cases', 'evidence', 'evidenceError'], 'trial');
    const variant = plan.variants.find(v => v.id === t.variantId); if (!variant) invalid('trial variant');
    const promptSha256 = fingerprint(t.promptSha256, 'promptSha256', /^[a-f0-9]{64}$/);
    if (promptSha256 !== teamExperimentPromptSha256(variant.prompt)) invalid('prompt fingerprint mismatch');
    const base = validateBenchmarkReport({ version: 1, synthetic, manifest: baseManifest, commit, promptSha256, createdAt, runs: [t.run] });
    const run = base.runs[0]!;
    if (run.id !== t.id || run.variantId !== t.variantId || run.repetition !== t.repetition) invalid('run identity mismatch');
    const evidence = t.evidence === null ? null : validateTeamExperimentEvidence(t.evidence);
    if (run.e2eMs !== null && evidence?.events.some(e => e.startMs + (e.durationMs ?? 0) > run.e2eMs! + 1)) invalid('event outside agent clock');
    return { id: run.id, variantId: run.variantId, repetition: run.repetition, promptSha256, run, cases: t.cases === null ? null : validateTeamExperimentCases(t.cases, plan.task.caseIds), evidence, evidenceError: optionalText(t.evidenceError, 'evidenceError') };
  });
  unique(trials.map(t => t.id), 'trial ids'); unique(trials.map(t => `${t.variantId}:${t.repetition}`), 'trial pair');
  if (trials.reduce((n, t) => n + (t.evidence?.events.length ?? 0), 0) > 20000 || trials.reduce((n, t) => n + (t.run.telemetry?.spans.length ?? 0), 0) > 20000) invalid('report event count');
  return { version: 1, kind: 'team-experiment-report', synthetic, plan, commit, createdAt, trials };
}

export function validateTeamExperimentDemo(value: unknown): TeamExperimentDemoInput {
  const r = object(value, ['name', 'repetitions', 'schedule', 'variants'], 'demo');
  const variants = array(r.variants, 'demo.variants', 3).map(value => { const v = object(value, ['mode', 'prompt'], 'demo.variant'); return { mode: choice(v.mode, modes, 'mode'), prompt: text(v.prompt, 'prompt', 32000) }; });
  const repetitions = number(r.repetitions, 'repetitions', 10, true); if (repetitions < 1 || variants.length < 2) invalid('demo count');
  return { name: text(r.name, 'name', 120), repetitions, schedule: choice(r.schedule, ['parallel', 'sequential'], 'schedule'), variants };
}
