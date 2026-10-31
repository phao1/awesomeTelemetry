/** Port of Anthropic single-agent-loop-kit @ c437962, Apache-2.0.
 * See data/agent-folding/NOTICE.md. These functions never execute evaluations. */
export interface FoldingKitTrace {
  trace_id: string; ts: string | number; agent: string; duration_ms?: number | null; input_tokens?: number | null;
}
export interface FoldingKitResult {
  prompt_id: string; status?: string; grade?: Record<string, number>;
  latency_s?: number | null; in_tokens?: number | null; out_tokens?: number | null; model_calls?: number | null;
  by_agent?: Record<string, { calls?: number; input_tokens?: number }>; actions?: Array<{ name: string }>;
}
const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b), m = Math.floor(v.length / 2);
  return v.length ? v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2 : null;
};
const clean = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/[\\|`]/g, '\\$&');
function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) { const k = key(row), list = result.get(k) ?? []; list.push(row); result.set(k, list); }
  return result;
}
function when(ts: string | number): number | string {
  if (typeof ts === 'number') return ts;
  const parsed = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(ts) ? ts : `${ts}Z`);
  return Number.isFinite(parsed) ? parsed / 1000 : ts;
}
function orderedTraces(rows: FoldingKitTrace[], exclude: string[] = []) {
  const traces = group(rows.filter(r => !exclude.includes(r.agent)), r => r.trace_id);
  for (const calls of traces.values()) calls.sort((a, b) => {
    const x = when(a.ts), y = when(b.ts);
    return typeof x === 'number' ? typeof y === 'number' ? x - y : -1 : typeof y === 'number' ? 1 : lex(x, y);
  });
  return traces;
}
export function kitCoupling(rows: FoldingKitTrace[], options: { exclude?: string[]; minCoupling?: number; minShare?: number } = {}) {
  const traces = orderedTraces(rows, options.exclude);
  if (!traces.size) throw new Error('No subagent calls found');
  const visits = new Map<string, number>(), pairs = new Map<string, { first: string; then: string; traces: number }>();
  const sequences = new Map<string, number>();
  for (const calls of traces.values()) {
    const names = calls.map(c => c.agent), seq = names.join(' -> ');
    sequences.set(seq, (sequences.get(seq) ?? 0) + 1);
    for (const name of new Set(names)) visits.set(name, (visits.get(name) ?? 0) + 1);
    const seen = new Set<string>();
    for (let i = 1; i < names.length; i++) {
      const first = names[i - 1]!, then = names[i]!, key = JSON.stringify([first, then]);
      if (first === then || seen.has(key)) continue;
      seen.add(key); const pair = pairs.get(key) ?? { first, then, traces: 0 }; pair.traces++; pairs.set(key, pair);
    }
  }
  const calls = [...traces.values()].flat(), byAgent = group(calls, c => c.agent);
  const time = calls.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0);
  const volume = [...byAgent].sort(([a], [b]) => visits.get(b)! - visits.get(a)! || lex(a, b)).map(([agent, calls]) => ({
    agent, calls: calls.length, trace_share: visits.get(agent)! / traces.size,
    median_ms: median(calls.flatMap(c => c.duration_ms == null ? [] : [c.duration_ms])),
    time_share: time ? calls.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0) / time : null,
    median_input_tokens: median(calls.flatMap(c => c.input_tokens == null ? [] : [c.input_tokens])),
  }));
  const sorted = [...pairs.values()].sort((a, b) => b.traces - a.traces || lex(a.first, b.first) || lex(a.then, b.then)).map(p => {
    const rarer = visits.get(p.first)! <= visits.get(p.then)! ? p.first : p.then, rarer_traces = visits.get(rarer)!;
    return { ...p, rarer, rarer_traces, coupling: p.traces / rarer_traces, share: p.traces / traces.size };
  });
  const stamps = calls.map(c => String(c.ts)).sort(lex);
  return { traces: traces.size, calls: calls.length, first_ts: stamps[0]!, last_ts: stamps.at(-1)!, volume,
    sequences: [...sequences].sort((a, b) => b[1] - a[1]).slice(0, 8), pairs: sorted,
    candidates: sorted.filter(p => p.coupling >= (options.minCoupling ?? .5) && p.share >= (options.minShare ?? .05)) };
}
const ok = (rows: FoldingKitResult[]) => rows.filter(r => r.status === undefined || r.status === 'ok');
export function kitCoverage(rows: FoldingKitTrace[], results: FoldingKitResult[], options: { exclude?: string[]; minTraces?: number; agents?: string[] } = {}) {
  const traces = orderedTraces(rows, options.exclude), tasks = group(ok(results), r => clean(r.prompt_id));
  if (!ok(results).some(r => r.by_agent !== undefined)) throw new Error('No by_agent measurements');
  const chains = new Map<string, { chain: string[]; traces: number }>();
  for (const calls of traces.values()) {
    const chain = [...new Set(calls.map(c => c.agent))], key = JSON.stringify([...chain].sort(lex));
    const item = chains.get(key) ?? { chain, traces: 0 }; item.traces++; chains.set(key, item);
  }
  const selected = [...chains.values()].filter(c => c.traces >= (options.minTraces ?? 2)
    && (!options.agents?.length || c.chain.some(a => options.agents!.includes(a)))).sort((a, b) => b.traces - a.traces).map(c => ({
      ...c, share: c.traces / traces.size,
      covering: [...tasks].sort(([a], [b]) => lex(a, b)).flatMap(([caseId, rows]) => {
        const agents = new Set(rows.flatMap(r => Object.keys(r.by_agent ?? {})).filter(a => !options.exclude?.includes(a)));
        return c.chain.every(a => agents.has(a)) ? [{ caseId, passes: rows.filter(r => (Object.values(r.grade ?? {})[0] ?? 0) >= 1).length, reps: rows.length }] : [];
      }),
    }));
  return { traces: traces.size, tasks: tasks.size, chains: selected,
    status: !selected.length ? 'no_chains' as const : selected.some(c => !c.covering.length) ? 'gaps' as const : 'covered' as const };
}
function scored(rows: FoldingKitResult[]) {
  const originals = new Map<string, string>();
  for (const row of ok(rows)) {
    const id = clean(row.prompt_id), previous = originals.get(id);
    if (previous !== undefined && previous !== row.prompt_id) throw new Error('Task IDs collide in report');
    originals.set(id, row.prompt_id);
    if (!Number.isFinite(Object.values(row.grade ?? {})[0])) throw new Error(`Missing or nonfinite grade: ${id}`);
  }
  return group(ok(rows), r => clean(r.prompt_id));
}
export function kitCompare(before: FoldingKitResult[], after: FoldingKitResult[]) {
  const a = scored(before), b = scored(after), common = [...a.keys()].filter(k => b.has(k)).sort(lex);
  if (!common.length) throw new Error('No common scored task IDs');
  const summarize = (tasks: Map<string, FoldingKitResult[]>) => {
    const perCase = Object.fromEntries(common.map(k => [k, mean(tasks.get(k)!.map(r => Object.values(r.grade!)[0]!))!]));
    const rows = common.flatMap(k => tasks.get(k)!);
    const metric = (k: 'latency_s' | 'model_calls' | 'in_tokens' | 'out_tokens') => mean(rows.flatMap(r => r[k] == null ? [] : [r[k]]));
    return { score: mean(Object.values(perCase))!, perCase, latency_s: metric('latency_s'), model_calls: metric('model_calls'), in_tokens: metric('in_tokens'), out_tokens: metric('out_tokens') };
  };
  const sa = summarize(a), sb = summarize(b), onlyBefore = [...a.keys()].filter(k => !b.has(k)).sort(lex), onlyAfter = [...b.keys()].filter(k => !a.has(k)).sort(lex);
  const worse = common.filter(k => sb.perCase[k]! < sa.perCase[k]!), better = common.filter(k => sb.perCase[k]! > sa.perCase[k]!);
  const writes = (rows: FoldingKitResult[]) => {
    if (rows.some(r => !Array.isArray(r.actions))) return null;
    const reps = rows.map(r => r.actions!.map(a => clean(a.name)).sort(lex).join(', ') || 'none');
    return new Set(reps).size === 1 ? reps[0]! : reps.join(' / ');
  };
  const writesChanged = common.flatMap(caseId => {
    const before = writes(a.get(caseId)!), after = writes(b.get(caseId)!);
    return before !== null && after !== null && before !== after ? [{ caseId, before, after }] : [];
  });
  return { common, onlyBefore, onlyAfter, before: sa, after: sb, worse, better, writesChanged,
    status: onlyBefore.length ? 'missing_tasks' as const : sb.score < sa.score ? 'worse' as const : worse.length ? 'mixed' as const : 'holds' as const };
}
export function kitEstimate(results: FoldingKitResult[], options: { tasks?: number; reps?: number; heavy?: number; only?: string[] } = {}) {
  let measured = group(ok(results).filter(r => r.in_tokens != null && r.out_tokens != null), r => clean(r.prompt_id));
  if (options.only) {
    if (!options.only.length || options.only.some(k => !measured.has(k))) throw new Error('Unmeasured selected task');
    measured = new Map([...measured].filter(([k]) => options.only!.includes(k)));
  }
  const covered = measured.size, tasks = options.tasks ?? covered, reps = options.reps ?? 1;
  if (!covered || !Number.isInteger(tasks) || tasks < covered || !Number.isInteger(reps) || reps < 1
    || (options.heavy !== undefined && (!Number.isInteger(options.heavy) || options.heavy < 0 || options.heavy > tasks))) throw new Error('Invalid estimate scope');
  const estimate = (field: 'in_tokens' | 'out_tokens') => {
    const means = [...measured.values()].map(rows => mean(rows.map(r => r[field]!))!);
    if (covered === tasks) { const value = means.reduce((a, b) => a + b, 0) * reps; return { low: value, high: value, likely: value }; }
    const low = Math.min(...means) * tasks * reps;
    if (covered === 1) return { low: null, high: null, likely: low };
    if (field === 'out_tokens') return { low, high: null, likely: null };
    return { low, high: Math.max(...means) * tasks * reps,
      likely: options.heavy === undefined ? null : (options.heavy * Math.max(...means) + (tasks - options.heavy) * Math.min(...means)) * reps };
  };
  return { tasks, reps, covered, rows: [...measured.values()].reduce((s, r) => s + r.length, 0), input: estimate('in_tokens'), output: estimate('out_tokens') };
}
export function kitRoundEstimate(value: number): string {
  if (value <= 0) return '0';
  const step = 10 ** Math.max(String(Math.trunc(value)).length - 2, 0), n = value / step, floor = Math.floor(n);
  const rounded = n - floor === .5 ? floor % 2 ? floor + 1 : floor : Math.round(n);
  return (rounded * step).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
