/** Interchange with Anthropic single-agent-loop-kit @ c437962, Apache-2.0. See NOTICE.md. */
import type { FoldingAction, FoldingArtifact, FoldingProject } from './agent-folding-types.js';
import type { FoldingKitResult, FoldingKitTrace } from './agent-folding-kit.js';
import { validateFoldingProject } from './agent-folding-validation.js';
export interface FoldingKitInventoryRow { agent: string; owner: string | null; talksToUser: boolean | null; action: FoldingAction; mergeWith: string | null; evals: string | null }
export interface FoldingKitImport {
  project: FoldingProject; evalsByAgent: Record<string, string | null>; progress: Array<{ text: string; done: boolean }>;
  variants: Record<string, FoldingKitResult[]>;
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
const bounded = (s: string) => { if (bytes(s) > 8 * 1024 * 1024) throw new Error('Kit import exceeds 8MiB'); return s; };
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected object'); return v as Record<string, unknown>; };
const text = (v: unknown): string => { if (typeof v !== 'string' || !v.trim() || v.length > 4096) throw new Error('Invalid kit text'); return v; };
const cell = (v: string | null) => (v ?? 'unknown').replace(/[\t\r\n]/g, ' ');
/** Bounded text source convenience; line iteration does not split/copy the entire JSONL file. */
export function* kitLines(value: string): Generator<string> {
  bounded(value); let start = 0;
  for (;;) { const end = value.indexOf('\n', start); if (end < 0) { if (start < value.length) yield value.slice(start); return; } yield value.slice(start, end); start = end + 1; }
}
export function parseKitResults(lines: Iterable<string>): FoldingKitResult[] {
  let size = 0; const rows: FoldingKitResult[] = [];
  const number = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('Invalid kit metric'); return v;
  };
  for (const line of lines) {
    size += bytes(line) + 1; if (size > 8 * 1024 * 1024) throw new Error('Kit import exceeds 8MiB');
    if (!line.trim()) continue;
    if (rows.length >= 4000) throw new Error('Kit results exceed 4000 rows');
    const raw = obj(JSON.parse(line)), id = raw.prompt_id ?? raw.id ?? raw.case_id;
    const row: FoldingKitResult = { prompt_id: text(typeof id === 'number' ? String(id) : id) };
    if (raw.status !== undefined) row.status = text(raw.status);
    if (raw.grade != null) row.grade = Object.fromEntries(Object.entries(obj(raw.grade)).map(([k, v]) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Invalid kit grade'); return [text(k), v];
    }));
    for (const k of ['latency_s', 'in_tokens', 'out_tokens', 'model_calls'] as const) if (k in raw) row[k] = number(raw[k]);
    if (raw.by_agent != null) {
      const agents = Object.entries(obj(raw.by_agent)); if (agents.length > 32) throw new Error('Too many kit agents');
      row.by_agent = Object.fromEntries(agents.map(([name, v]) => { const u = obj(v); return [text(name), {
        ...(u.calls == null ? {} : { calls: number(u.calls)! }), ...(u.input_tokens == null ? {} : { input_tokens: number(u.input_tokens)! }),
      }]; }));
    }
    if (raw.actions != null) {
      if (!Array.isArray(raw.actions) || raw.actions.length > 64) throw new Error('Invalid kit actions');
      row.actions = raw.actions.map(a => ({ name: text(typeof a === 'string' ? a : obj(a).name) }));
    }
    rows.push(row);
  }
  return rows;
}
export function parseKitInventory(value: string): FoldingKitInventoryRow[] {
  const lines = [...kitLines(value)].filter(l => l.trim()), header = lines.shift()?.trimEnd().split('\t') ?? [];
  for (const name of ['agent', 'owner', 'talks_to_user', 'evals', 'verdict']) if (!header.includes(name)) throw new Error(`Missing inventory column: ${name}`);
  if (new Set(header).size !== header.length || lines.length > 32) throw new Error('Invalid inventory headers/rows');
  const seen = new Set<string>();
  return lines.map(line => {
    const values = line.replace(/\r$/, '').split('\t'); if (values.length !== header.length) throw new Error('Inventory column count differs');
    const row = Object.fromEntries(header.map((k, i) => [k, values[i]!])), agent = text(row.agent);
    if (seen.has(agent)) throw new Error('Duplicate inventory agent'); seen.add(agent);
    const verdict = text(row.verdict).replace(/^as-tool$/, 'as_tool'), action = verdict.startsWith('merge:') ? 'merge' : verdict;
    if (!['main', 'fold', 'merge', 'as_tool', 'keep', 'insufficient'].includes(action)) throw new Error('Unknown inventory verdict');
    const talk = row.talks_to_user!.trim().toLowerCase();
    if (!/^(yes|no|unknown|)(\s|$)/.test(talk)) throw new Error('Invalid dialogue declaration');
    return { agent, owner: !row.owner || row.owner === 'unknown' ? null : row.owner!, talksToUser: /^yes(\s|$)/.test(talk) ? true : /^no(\s|$)/.test(talk) ? false : null,
      action: action as FoldingAction, mergeWith: verdict.startsWith('merge:') ? text(verdict.slice(6)) : null, evals: !row.evals || row.evals === 'unknown' ? null : row.evals! };
  });
}
export function parseKitPlan(value: string): Array<{ text: string; done: boolean }> {
  const rows = [...kitLines(value)].flatMap(line => { const m = /^\s*- \[([ xX])\] (.+)$/.exec(line); return m ? [{ text: m[2]!, done: m[1]!.toLowerCase() === 'x' }] : []; });
  if (rows.length > 256) throw new Error('Too many plan progress items');
  return rows;
}
export function applyKitInventory(value: FoldingProject, rows: FoldingKitInventoryRow[]): FoldingKitImport {
  const project = structuredClone(validateFoldingProject(value)), evalsByAgent: Record<string, string | null> = Object.create(null);
  const find = (name: string) => {
    const exact = project.agents.find(a => a.id === name); if (exact) return exact;
    const matches = project.agents.filter(a => a.name === name); if (matches.length !== 1) throw new Error(`Unknown or ambiguous agent: ${name}`); return matches[0]!;
  };
  for (const row of rows) {
    const agent = find(row.agent); if (agent.isMain !== (row.action === 'main')) throw new Error('Main loop identity cannot change');
    const partner = row.mergeWith === null ? null : find(row.mergeWith);
    if (row.action === 'merge' && (!partner || partner.isMain || partner.id === agent.id)) throw new Error('Invalid merge partner');
    agent.owner = row.owner; agent.talksToUser = row.talksToUser; agent.proposed = row.action; evalsByAgent[agent.id] = row.evals;
    for (const boundary of project.boundaries.filter(b => b.targetAgentIds.includes(agent.id))) {
      if (row.action !== 'main') boundary.proposed = row.action;
      if (partner && !boundary.targetAgentIds.includes(partner.id)) boundary.targetAgentIds.push(partner.id);
    }
  }
  return { project: validateFoldingProject(project), evalsByAgent, progress: [], variants: {} };
}
export function projectKitTraces(project: FoldingProject): FoldingKitTrace[] {
  return project.traffic.map(r => ({ trace_id: r.traceId, ts: r.timestamp ?? r.sequence, agent: r.agentId, duration_ms: r.durationMs, input_tokens: r.inputTokens }));
}
export function projectKitResults(project: FoldingProject, experimentId: string, variantId: string): FoldingKitResult[] {
  const experiment = project.experiments.find(e => e.id === experimentId);
  if (!experiment) throw new Error('Unknown experiment');
  return project.trials.filter(t => t.experimentId === experimentId && t.variantId === variantId && experiment.trialIds.includes(t.id)).map(t => {
    const scored = t.grade !== null && ['official_recording', 'live_api', 'user_import'].includes(project.sources.find(s => s.id === t.sourceId)?.kind ?? '');
    const complete = (id: string | null) => project.evidence.find(e => e.id === id && e.complete && e.sourceId === t.sourceId);
    const actionsKnown = t.evidenceIds.some(id => complete(id)?.kind === 'grade')
      || (t.actions.length > 0 ? t.actions.every(a => complete(a.evidenceId)) : t.evidenceIds.some(id => { const e = complete(id); return e?.kind === 'trace' && e.pointer === null; }));
    return { prompt_id: t.caseId, status: t.harnessError !== null ? 'error' : scored ? 'ok' : 'unscored',
      ...(scored ? { grade: { task_complete: t.grade! } } : {}), latency_s: t.latencyMs === null ? null : t.latencyMs / 1000,
      in_tokens: t.inputTokens, out_tokens: t.outputTokens, model_calls: t.modelCalls,
      ...(Object.keys(t.byAgent).length ? { by_agent: Object.fromEntries(Object.entries(t.byAgent).map(([id, u]) => [id, { calls: u.calls, input_tokens: u.inputTokens }])) } : {}),
      ...(actionsKnown ? { actions: t.actions.map(a => ({ name: a.name })) } : {}),
    };
  });
}
export function buildKitArtifacts(value: FoldingProject): FoldingArtifact[] {
  const p = validateFoldingProject(value), artifacts: FoldingArtifact[] = [];
  const add = (path: string, content: string) => artifacts.push({ path, content, purpose: { zh: 'kit 互通文件（只读导出）', en: 'Read-only kit interchange' } });
  const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  add('traces.jsonl', jsonl(projectKitTraces(p)));
  const header = 'agent\towner\tprompt\ttools\tinvoked_by\treturns\ttalks_to_user\tcontext_read\ttraffic\tchains_with\tevals\tverdict\tevidence\tconfidence';
  add('inventory.tsv', header + '\n' + p.agents.map(a => {
    const partner = p.boundaries.find(b => b.proposed === 'merge' && b.targetAgentIds.includes(a.id))?.targetAgentIds.find(id => id !== a.id);
    return [a.id, a.owner, null, a.tools.join(', '), a.invokedBy.join(', '), a.returns, a.talksToUser === null ? 'unknown' : a.talksToUser ? 'yes' : 'no', a.contextNeed,
      String(p.traffic.filter(t => t.agentId === a.id).length), partner ?? null, null, a.proposed === 'merge' && partner ? `merge:${partner}` : a.proposed.replace('as_tool', 'as-tool'), a.evidenceIds.join(', '), 'unknown'].map(cell).join('\t');
  }).join('\n') + '\n');
  add('PLAN.md', '# Single loop plan\n\n## Status\n\n- [ ] Verdicts agreed with the person (end of step 0)\n- [ ] Main eval agreed and baseline measured (end of step 1)\n\n## Worklist\n\n' + p.boundaries.map((b, i) => `- [ ] ${i + 1}. ${cell(b.id)} · ${b.proposed}`).join('\n') + '\n\nUnknown times use numeric sequence solely for ordering. No execution, approval or measured timing is implied.\n');
  for (const e of p.experiments) for (const variant of [e.baselineVariantId, e.candidateVariantId, ...(e.ablationVariantId ? [e.ablationVariantId] : [])]) {
    add(`results/${encodeURIComponent(e.id).replace(/\./g, '%2E')}/${encodeURIComponent(variant).replace(/\./g, '%2E')}/results.jsonl`, jsonl(projectKitResults(p, e.id, variant)));
  }
  if (bytes(JSON.stringify(artifacts)) > 8 * 1024 * 1024) throw new Error('Kit export exceeds 8MiB');
  return artifacts;
}
