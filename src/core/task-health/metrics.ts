import { benchmarkStats, correctedUsage } from '../benchmark-analysis.js';
import type { BenchmarkUsage } from '../benchmark-types.js';
import type { HealthFinding, HealthMetric, HealthRecord, HealthThresholds, Timing, TtftLayer } from './types.js';
import type { Snapshot, ToolObservation } from './snapshot.js';
import { isBookkeeping, isProduction, located, nativeKey, sequence } from './snapshot.js';
import { intersect, unionDuration } from './intervals.js';
import type { Interval } from './intervals.js';
import { relativeTime } from './snapshot-tracelog.js';
export const sum = (a: readonly number[]): number => a.reduce((n, v) => n + v, 0);
export const eligible = (t: ToolObservation): boolean => ['observed', 'measured'].includes(t.span.timing) && !t.span.capped && t.durationMs !== null;
export const duration = (t: ToolObservation): number | null => { const i = located(t.span); return i ? i[1] - i[0] : t.durationMs; };
export const scopePartial = (s: Snapshot): boolean => s.members.some(m => !m.detailLoaded) || s.limits.length > 0 || s.input.running || s.input.reasons.length > 0;
export const evidenceId = (recordId: string): string => 'evidence:' + recordId;
export const toolEvidence = (tools: ToolObservation[]): string[] => [...new Set(tools.flatMap(t => t.records.map(r => evidenceId(r.recordId))))];
export type FindingDraft = Omit<HealthFinding, 'recommendation'>;
export interface RuleContext {
    snapshot: Snapshot;
    metrics: HealthMetric[];
    thresholds: HealthThresholds;
}
export function fact(rule: string, dimension: HealthFinding['dimension'], facts: HealthFinding['facts'], tools: ToolObservation[] = [], evidenceIds: string[] = [], intervals?: Interval[]): FindingDraft {
    return { id: rule + ':' + JSON.stringify(facts), rule, dimension, severity: rule === 'quality.error_end' ? 'warning' : rule === 'cov.incomplete' ? 'info' : 'notice', confidence: dimension === 'coverage' || rule === 'quality.error_end' ? 'observed' : 'heuristic', facts, evidenceIds: [...new Set([...toolEvidence(tools), ...evidenceIds])], intervalMs: intervals ?? tools.flatMap(t => { const i = located(t.span); return i ? [i] : []; }) };
}
export function metric(context: RuleContext, key: string, facets: Record<string, string> = {}, stat: HealthMetric['stat'] = 'value', layer?: TtftLayer): HealthMetric | undefined {
    return context.metrics.find(m => m.key === key && m.stat === stat && (layer === undefined || m.layer === layer) && Object.entries(facets).every(([k, v]) => m.facets[k] === v));
}
export interface UsageObservation {
    record: HealthRecord;
    usage: BenchmarkUsage;
    roundId: string | null;
}
export function usageObservations(s: Snapshot): UsageObservation[] {
    const selected = new Map<string, UsageObservation>();
    for (const member of s.members) {
        const records = s.records.filter(r => r.memberId === member.id).sort((a, b) => sequence(a) - sequence(b));
        for (const r of records) {
            const reported = r.importedTurn?.reported;
            const sourceUsage = r.native.usage ?? (reported ? { input: reported.input_tokens ?? null, output: reported.output_tokens ?? null, reasoning: reported.thoughts_token_count ?? null, cacheRead: reported.cache_read_tokens ?? null, cacheWrite: reported.cache_creation_tokens ?? null, inputIncludesCache: null, outputIncludesReasoning: null } : null);
            if (!sourceUsage)
                continue;
            const at = relativeTime(s.input, r.event?.startedAt ?? r.importedTurn?.requestTime ?? null);
            if (s.bounds && at !== null && (at < s.bounds[0] || at > s.bounds[1]))
                continue;
            const round = [...s.roundRecords].find(([, rs]) => rs.some(x => x.recordId === r.recordId))?.[0] ?? null;
            const key = JSON.stringify([r.memberId, r.native.modelCall ? nativeKey(r.native.modelCall) : round ?? r.recordId, r.attempt ? nativeKey(r.attempt) : null]);
            selected.set(key, { record: r, usage: { ...sourceUsage }, roundId: round });
        }
    }
    const result = [...selected.values()];
    for (const member of s.members) {
        for (const component of ['cacheRead', 'reasoning'] as const) {
            if (member.tokenSemantics?.[component] !== 'cumulative')
                continue;
            let previous = 0;
            for (const observation of result.filter(x => x.record.memberId === member.id)) {
                const value = observation.usage[component];
                if (value === null)
                    continue;
                if (value < previous)
                    s.reasons.push('usage_counter_reset');
                observation.usage[component] = value >= previous ? value - previous : value;
                previous = value;
            }
        }
    }
    return result;
}
export function aggregateUsage(observations: UsageObservation[]): {
    total: number | null;
    hit: number | null;
    raw: Record<string, number | null>;
} {
    const raw: Record<string, number | null> = {};
    for (const k of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'] as const) {
        const values = observations.map(o => k === 'cacheWrite' && o.usage.cacheWriteReported === false ? 0 : o.usage[k]);
        raw[k] = values.length && values.every(v => v !== null) ? sum(values as number[]) : null;
    }
    const normalized = observations.map(o => correctedUsage(o.usage));
    const valid = observations.length > 0 && normalized.every(n => n.total !== null);
    const denominator = sum(observations.map(o => { const u = o.usage; return (u.input ?? 0) + (u.inputIncludesCache === false ? (u.cacheRead ?? 0) + (u.cacheWriteReported === false ? 0 : u.cacheWrite ?? 0) : 0); }));
    return { raw, total: normalized.length && normalized.every(n => n.total !== null) ? sum(normalized.map(n => n.total!)) : null, hit: valid && denominator > 0 ? 100 * (raw.cacheRead ?? 0) / denominator : null };
}
export function installGroups(s: Snapshot): Map<string, ToolObservation[]> {
    const groups = new Map<string, ToolObservation[]>(), resets = new Map<string, number>();
    for (const r of [...s.records].sort((a, b) => sequence(a) - sequence(b))) {
        if (r.native.environmentReset === true)
            resets.set(r.memberId, (resets.get(r.memberId) ?? 0) + 1);
        const t = s.tools.find(t => t.source.recordId === r.recordId);
        if (t?.span.toolClass !== 'install' || t.command.fingerprint === null)
            continue;
        const key = JSON.stringify([r.memberId, resets.get(r.memberId) ?? 0, t.command.fingerprint]);
        const group = groups.get(key) ?? [];
        group.push(t);
        groups.set(key, group);
    }
    return groups;
}
export function computeMetrics(s: Snapshot, thresholds: HealthThresholds): HealthMetric[] {
    const rows: HealthMetric[] = [], partial = scopePartial(s);
    const add = (key: string, value: number | null, unit: HealthMetric['unit'], timing: Timing = 'observed', options: Partial<HealthMetric> = {}): HealthMetric => {
        const missing = value === null;
        const row: HealthMetric = { key, value, unit, timing: missing ? 'unavailable' : timing, layer: null, coverage: missing ? 'unavailable' : partial ? 'partial' : 'complete', samples: missing ? 0 : 1, reason: missing ? 'missing_eligible_evidence' : partial ? 'partial_scope' : null, evidenceIds: [], facets: {}, stat: 'value', values: null, ...options };
        if (row.value === null && row.reason === null)
            row.reason = 'missing_eligible_evidence';
        if (row.coverage !== 'complete' && row.reason === null)
            row.reason = 'partial_scope';
        rows.push(row);
        return row;
    };
    const distribution = (key: string, values: number[], timing: Timing, opts: Partial<HealthMetric> = {}) => {
        const stats = benchmarkStats(values);
        for (const [stat, v] of [['mean', stats.mean], ['p50', stats.median], ['p95', values.length >= 5 ? stats.p95 : null], ['max', values.length ? Math.max(...values) : null]] as const)
            add(key, v, 'ms', timing, { ...opts, stat, values: [...values], samples: values.length, ...(stat === 'p95' && values.length < 5 ? { reason: 'fewer_than_5_samples', coverage: 'unavailable' as const } : {}) });
    };
    const bounds = s.bounds, e2e = bounds ? bounds[1] - bounds[0] : null;
    const clip = (i: Interval) => bounds ? intersect(i, bounds) : null;
    const wall = (spans: typeof s.spans) => unionDuration(spans.flatMap(x => { const i = located(x); return i ? [i] : []; }));
    const model = s.spans.filter(x => x.kind === 'model'), tools = s.tools;
    add('overview.e2e_ms', e2e, 'ms', s.records.some(r => r.importedTurn) ? 'reported' : 'observed');
    add('overview.e2e_ms', e2e === null ? null : e2e - unionDuration(s.userWait.flatMap(i => { const c = clip(i); return c ? [c] : []; })), 'ms', 'observed', { facets: { component: 'active' } });
    add('plan.rounds', partial ? null : s.rounds.length, 'count', s.records.some(r => r.importedTurn) ? 'reported' : 'observed', { samples: s.rounds.length });
    const imported = s.records.filter(r => r.importedTurn), native = s.records.filter(r => r.event);
    const identities = new Set(native.flatMap(r => r.native.modelCall ? [JSON.stringify([r.memberId, nativeKey(r.native.modelCall)])] : []));
    add('model.calls', imported.length ? imported.length : identities.size ? identities.size : null, 'count', imported.length ? 'reported' : 'observed', { samples: imported.length || identities.size });
    const toolIdentities = tools.every(t => t.source.tool !== null && t.source.pairing === 'exact');
    add('act.calls', imported.length ? imported.every(r => r.importedTurn!.reported.tool_call_count != null) ? sum(imported.map(r => r.importedTurn!.reported.tool_call_count!)) : null : toolIdentities && !partial ? tools.length : null, 'count', imported.length ? 'reported' : 'observed', { samples: imported.length || tools.length, evidenceIds: toolEvidence(tools) });
    for (const timing of ['observed', 'measured', 'derived', 'reported'] as const) {
        const timed = tools.filter(t => t.span.timing === timing && duration(t) !== null), models = model.filter(t => t.timing === timing && located(t));
        if (timed.length) {
            const v = timed.map(t => duration(t)!);
            add('act.sum_ms', sum(v), 'ms', timing, { samples: v.length, values: v, evidenceIds: toolEvidence(timed) });
            add('act.union_ms', wall(timed.map(t => t.span)), 'ms', timing, { samples: v.length, evidenceIds: toolEvidence(timed) });
        }
        if (models.length) {
            const v = models.map(t => t.endMs! - t.startMs!);
            add('model.sum_ms', sum(v), 'ms', timing, { samples: v.length, values: v, evidenceIds: models.flatMap(x => x.recordId ? [evidenceId(x.recordId)] : []) });
            add('model.union_ms', wall(models), 'ms', timing, { samples: v.length });
            add('model.round_avg_ms', sum(v) / v.length, 'ms', timing, { samples: v.length, values: v, stat: 'mean' });
        }
        if (timing === 'observed' || timing === 'measured') {
            const v = tools.filter(t => eligible(t) && t.span.timing === timing).map(t => duration(t)!);
            if (v.length) {
                const stats = benchmarkStats(v);
                for (const [key, value] of [['act.avg_ms', stats.mean], ['act.p50_ms', stats.median], ['act.p95_ms', v.length >= 5 ? stats.p95 : null], ['act.max_ms', Math.max(...v)]] as const)
                    add(key, value, 'ms', timing, { samples: v.length, values: v, evidenceIds: toolEvidence(tools.filter(t => eligible(t) && t.span.timing === timing)), reason: value === null ? 'fewer_than_5_samples' : null });
            }
        }
    }
    for (const [key, field] of [['model.sum_ms', 'model_inference_ms'], ['act.sum_ms', 'tool_time_ms']] as const) {
        const vs = imported.map(r => r.importedTurn!.reported[field]);
        if (imported.length)
            add(key, vs.every(v => v != null) ? sum(vs as number[]) : null, 'ms', 'reported', { samples: vs.filter(v => v != null).length, values: vs.filter((v): v is number => v != null) });
    }
    if (imported.length) {
        const values = imported.map(r => r.importedTurn!.reported.model_inference_ms).filter((v): v is number => v != null);
        add('model.round_avg_ms', values.length ? sum(values) / values.length : null, 'ms', 'reported', { stat: 'mean', samples: values.length, values });
    }
    const long = tools.filter(t => (eligible(t) || t.span.capped) && (duration(t) ?? 0) > thresholds.longToolMs);
    for (const timing of ['observed', 'measured', 'derived'] as const) {
        const population = tools.filter(t => t.span.timing === timing && duration(t) !== null);
        if (population.length) {
            add('act.long_tool_count', long.filter(t => t.span.timing === timing).length, 'count', timing, { samples: population.length });
            for (const cls of new Set(population.map(t => t.span.toolClass!)))
                add('act.long_tool_count', long.filter(t => t.span.timing === timing && t.span.toolClass === cls).length, 'count', timing, { facets: { class: cls }, samples: population.filter(t => t.span.toolClass === cls).length });
        }
    }
    const placedRounds = s.rounds.filter(r => r.toolSpanIds.length > 0 && r.toolSpanIds.every(id => tools.some(t => t.span.id === id && eligible(t))));
    add('act.parallel_rounds', placedRounds.length ? placedRounds.filter(r => r.parallelTools >= 2).length : null, 'count', 'observed', { samples: placedRounds.length });
    const writes = tools.filter(t => t.span.toolClass === 'write/edit'), reads = tools.filter(t => t.span.toolClass === 'read');
    const writeRounds = s.rounds.filter(r => writes.some(t => t.span.roundId === r.id));
    const fileCounts = writeRounds.map(r => r.writeFiles), knownTargets = writes.every(t => t.targets.length > 0);
    add('act.files_per_write_round', fileCounts.length && knownTargets ? sum(fileCounts) / fileCounts.length : null, 'count', 'observed', { samples: fileCounts.length, values: fileCounts });
    add('act.single_file_write_round_rate', fileCounts.length && knownTargets ? 100 * fileCounts.filter(n => n === 1).length / fileCounts.length : null, 'pct', 'observed', { samples: fileCounts.length });
    const observations = s.records.filter(r => !isBookkeeping(r)).flatMap(r => { const a = relativeTime(s.input, r.event?.startedAt ?? r.importedTurn?.requestTime ?? null), b = relativeTime(s.input, r.importedTurn?.responseTime ?? null); return [a, b].filter((n): n is number => n !== null && (!bounds || n >= bounds[0] && n <= bounds[1])); });
    observations.push(...s.spans.filter(x => ['measured', 'reported'].includes(x.timing)).flatMap(x => x.endMs === null ? [] : [x.endMs]));
    const sorted = [...new Set(observations)].sort((a, b) => a - b), gaps = sorted.slice(1).map((n, i) => n - sorted[i]!);
    const max = gaps.length ? Math.max(...gaps) : null, idx = max === null ? -1 : gaps.indexOf(max);
    const interval: Interval | null = idx < 0 ? null : [sorted[idx]!, sorted[idx + 1]!];
    const cause = interval ? tools.find(t => { const l = located(t.span); return l && l[0] <= interval[0] && l[1] >= interval[1]; }) : undefined;
    add('ux.max_gap_log', max, 'ms', 'observed', { samples: gaps.length, facets: { cause: cause?.command.command ?? cause?.span.toolClass ?? (interval && model.some(x => x.startMs! <= interval[0] && x.endMs! >= interval[1]) ? 'model' : 'unattributed'), ...(interval ? { startMs: String(interval[0]), endMs: String(interval[1]) } : {}) }, evidenceIds: cause ? toolEvidence([cause]) : s.records.filter(r => interval?.includes(relativeTime(s.input, r.event?.startedAt ?? r.importedTurn?.requestTime ?? null) ?? NaN)).map(r => evidenceId(r.recordId)) });
    const firstProduction = s.records.filter(isProduction).map(r => relativeTime(s.input, r.event?.startedAt ?? null)).filter((n): n is number => n !== null && (!bounds || n >= bounds[0] && n <= bounds[1]));
    add('ux.ttfr_log', firstProduction.length ? Math.min(...firstProduction) : null, 'ms');
    const completedWrites = writes.filter(t => eligible(t) && t.span.endMs !== null), writeEnds = completedWrites.map(t => t.span.endMs!), firstWrite = writeEnds.length ? Math.min(...writeEnds) : null, lastWrite = writeEnds.length ? Math.max(...writeEnds) : null;
    const modified = new Set(writes.flatMap(t => t.targets));
    const locatedReads = reads.filter(t => eligible(t) && t.targets.some(x => modified.has(x)) && t.span.endMs !== null);
    add('ux.first_locate_log', locatedReads.length ? Math.min(...locatedReads.map(t => t.span.endMs!)) : null, 'ms');
    for (const key of ['ux.first_write_log', 'ux.first_reviewable_log'])
        add(key, firstWrite, 'ms');
    const verification = tools.filter(t => eligible(t) && ['test', 'build', 'lint/typecheck'].includes(t.span.toolClass!) && t.span.status === 'ok' && t.span.endMs !== null && lastWrite !== null && t.span.endMs >= lastWrite && t.span.startMs! >= lastWrite);
    add('ux.first_verified_log', verification.length ? Math.min(...verification.map(t => t.span.endMs!)) : null, 'ms');
    add('ux.ttfmp_judged', null, 'ms');
    for (const component of ['assistant', 'reasoning', 'tool']) {
        const rs = s.records.filter(r => r.event && !isBookkeeping(r) && (component === 'tool' ? r.event.hasOutput && tools.some(t => t.records.includes(r)) : component === 'reasoning' ? r.event.kind === 'reasoning' : !['reasoning', 'user_prompt'].includes(r.event.kind) && !tools.some(t => t.records.includes(r))));
        add('ux.volume_log', imported.length ? null : rs.length && rs.every(r => r.outputLen !== null) ? sum(rs.map(r => r.outputLen!)) : rs.length || partial ? null : 0, 'chars', 'observed', { facets: { component }, samples: rs.length });
    }
    const n = s.rounds.length, states = ['present', 'zero', 'unknown'] as const, roundTiming = imported.length ? 'reported' : 'observed';
    for (const state of states)
        add('model.reasoning_rounds', s.rounds.filter(r => r.reasoning === state).length, 'count', roundTiming, { facets: { state }, samples: n });
    add('model.reasoning_rounds', n && !s.rounds.some(r => r.reasoning === 'unknown') ? 100 * s.rounds.filter(r => r.reasoning === 'present').length / n : null, 'pct', roundTiming, { facets: { state: 'present', component: 'percentage' }, samples: n });
    const ttfts: {
        value: number;
        layer: TtftLayer;
        timing: Timing;
        roundId: string | null;
        recordIds: string[];
    }[] = [];
    for (const r of s.rounds) {
        const span = s.spans.find(x => x.roundId === r.id && x.firstContentLayer !== null);
        if (span && span.firstContentMs !== null && span.startMs !== null && span.firstContentMs >= span.startMs)
            ttfts.push({ value: span.firstContentMs - span.startMs, layer: span.firstContentLayer!, timing: span.timing, roundId: r.id, recordIds: span.recordId ? [span.recordId] : [] });
    }
    const attempts = new Set(s.records.flatMap(r => r.attempt ? [JSON.stringify([r.memberId, r.native.modelCall ? nativeKey(r.native.modelCall) : null, nativeKey(r.attempt)])] : []));
    if (identities.size && attempts.size > identities.size)
        s.reasons.push(`model_attempts:${attempts.size};logical_calls:${identities.size}`);
    const captureKeys = new Set<string>();
    for (const capture of s.input.captures) {
        if (!['proxy', 'exporter'].includes(capture.layer))
            continue;
        const linked = capture.recordIds.map(id => s.records.find(r => r.recordId === id));
        if (!linked.length || linked.some(r => !r))
            continue;
        const ref = linked.find(r => r?.native.modelCall) ?? linked[0]!, identity = JSON.stringify([capture.layer, ref.memberId, ref.native.modelCall ? nativeKey(ref.native.modelCall) : ref.attempt ? nativeKey(ref.attempt) : ref.recordId, ref.attempt ? nativeKey(ref.attempt) : null]);
        if (ttfts.some(t => t.layer === capture.layer && t.recordIds.some(id => capture.recordIds.includes(id))))
            continue;
        if (captureKeys.has(identity))
            continue;
        if (capture.firstContentMs === null || capture.firstContentMs < capture.startedMs || capture.completedMs !== null && capture.firstContentMs > capture.completedMs || bounds && (capture.startedMs < bounds[0] || capture.firstContentMs > bounds[1]))
            continue;
        captureKeys.add(identity);
        const roundId = [...s.roundRecords].find(([, rs]) => rs.some(r => r.recordId === ref.recordId))?.[0] ?? null;
        ttfts.push({ value: capture.firstContentMs - capture.startedMs, layer: capture.layer, timing: capture.layer === 'proxy' ? 'measured' : 'reported', roundId, recordIds: capture.recordIds });
    }
    for (const layer of ['proxy', 'exporter', 'maas', 'inferhub', 'kernel', 'log_upper_bound'] as const) {
        const samples = ttfts.filter(t => t.layer === layer);
        distribution('model.ttft', samples.map(t => t.value), layer === 'log_upper_bound' ? 'derived' : layer === 'proxy' ? 'measured' : 'reported', { layer, evidenceIds: samples.flatMap(t => t.recordIds.map(evidenceId)) });
        const captures = s.input.captures.filter(c => c.layer === layer && samples.some(t => t.recordIds.some(id => c.recordIds.includes(id))) && c.completedMs !== null && c.firstContentMs !== null && c.completedMs >= c.firstContentMs && c.outputTokens !== null && c.outputTokens > 1);
        const reported = layer === 'exporter' ? imported.map(r => r.importedTurn!.reported.tpot_ms).filter((v): v is number => v != null) : [];
        if (layer !== 'log_upper_bound') {
            add('model.tpot', reported.length ? sum(reported) / reported.length : null, 'ms', 'reported', { layer, facets: { component: 'reported' }, samples: reported.length, stat: 'mean', values: reported });
            add('model.tpot', captures.length && layer === 'proxy' ? sum(captures.map(c => c.completedMs! - c.firstContentMs!)) / sum(captures.map(c => c.outputTokens! - 1)) : null, 'ms', layer === 'proxy' ? 'measured' : 'reported', { layer, facets: { component: 'normalized' }, samples: captures.length });
        }
        for (const group of ['present', 'zero'] as const) {
            const groupSamples = samples.filter(t => s.rounds.find(r => r.id === t.roundId)?.reasoning === group);
            add('model.reasoning_split', groupSamples.length ? sum(groupSamples.map(t => t.value)) / groupSamples.length : null, 'ms', layer === 'log_upper_bound' ? 'derived' : layer === 'proxy' ? 'measured' : 'reported', { layer, facets: { group, component: 'first_output' }, stat: 'mean', values: groupSamples.map(t => t.value), samples: groupSamples.length, evidenceIds: groupSamples.flatMap(t => t.recordIds.map(evidenceId)) });
        }
    }
    for (const group of ['present', 'zero'] as const) {
        const ms = model.filter(x => x.reasoning === group && located(x));
        const timings = new Set(ms.map(x => x.timing));
        for (const timing of timings) {
            const values = ms.filter(x => x.timing === timing).map(x => x.endMs! - x.startMs!);
            add('model.reasoning_split', sum(values) / values.length, 'ms', timing, { facets: { group, component: 'round_duration' }, stat: 'mean', samples: values.length, values });
        }
        const reported = imported.filter(r => s.rounds.find(x => x.id === `${r.memberId}:import:${r.importedTurn!.sequence}`)?.reasoning === group).map(r => r.importedTurn!.reported.model_inference_ms).filter((v): v is number => v != null);
        if (reported.length)
            add('model.reasoning_split', sum(reported) / reported.length, 'ms', 'reported', { facets: { group, component: 'round_duration' }, stat: 'mean', samples: reported.length, values: reported });
        if (!ms.length && !reported.length)
            add('model.reasoning_split', null, 'ms', 'unavailable', { facets: { group, component: 'round_duration' }, stat: 'mean', samples: 0, values: [] });
    }
    const usages = usageObservations(s), usage = aggregateUsage(usages), unknownUsage = s.rounds.some(r => !s.roundRecords.get(r.id)?.some(x => x.native.usage !== null || x.importedTurn !== null));
    add('model.cache_hit', unknownUsage ? null : usage.hit, 'pct', imported.length ? 'reported' : 'observed', { samples: usages.length });
    add('cost.tokens', unknownUsage ? null : usage.total, 'tokens', imported.length ? 'reported' : 'observed', { samples: usages.length });
    for (const [component, value] of Object.entries(usage.raw))
        add('cost.tokens', value, 'tokens', imported.length ? 'reported' : 'observed', { facets: { component }, samples: usages.length });
    const later = usages.filter(u => (s.rounds.find(r => r.id === u.roundId)?.index ?? 0) >= 2);
    add('model.cache_hit', s.rounds.some(r => r.index >= 2 && !later.some(u => u.roundId === r.id)) ? null : aggregateUsage(later).hit, 'pct', 'observed', { facets: { component: 'rounds2+' }, samples: later.length, evidenceIds: later.map(u => evidenceId(u.record.recordId)) });
    const knownStatus = tools.filter(t => t.span.status !== 'unknown'), errors = knownStatus.filter(t => t.span.status === 'error');
    add('act.tool_errors', knownStatus.length ? errors.length : null, 'count', 'observed', { samples: knownStatus.length, evidenceIds: toolEvidence(errors) });
    add('act.tool_errors', knownStatus.length ? 100 * errors.length / knownStatus.length : null, 'pct', 'observed', { samples: knownStatus.length, facets: { component: 'rate' } });
    const delegates = tools.filter(t => t.source.pairing === 'exact' && t.source.native.delegateMemberId && s.members.some(m => m.id === t.source.native.delegateMemberId));
    add('plan.delegations', delegates.length ? delegates.length : null, 'count', 'observed', { samples: delegates.length });
    const latencies = delegates.flatMap(t => { const first = s.records.filter(r => r.memberId === t.source.native.delegateMemberId).sort((a, b) => sequence(a) - sequence(b))[0]; const end = first ? relativeTime(s.input, first.event?.startedAt ?? first.importedTurn?.requestTime ?? null) : null; return end !== null && t.span.startMs !== null && end >= t.span.startMs ? [end - t.span.startMs] : []; });
    add('startup.delegate_latency_ms', latencies.length ? sum(latencies) / latencies.length : null, 'ms', 'observed', { samples: latencies.length, values: latencies });
    add('plan.main_wait_ms', delegates.length ? unionDuration(s.delegateWait.flatMap(i => { const c = clip(i); return c ? [c] : []; })) : null, 'ms');
    for (const component of ['time', 'rounds', 'reads'])
        add('plan.explore_before_first_write', firstWrite === null ? null : component === 'time' ? firstWrite : component === 'rounds' ? s.rounds.filter(r => r.endMs !== null && r.endMs < firstWrite).length : reads.filter(t => t.span.endMs !== null && t.span.endMs < firstWrite).length, component === 'time' ? 'ms' : 'count', 'observed', { facets: { component } });
    for (const [fingerprint, group] of installGroups(s)) {
        add('act.duplicate_install', group.length, 'count', 'observed', { facets: { fingerprint }, samples: group.length, evidenceIds: toolEvidence(group) });
        for (const timing of new Set(group.map(t => t.span.timing))) {
            const population = group.filter(t => t.span.timing === timing), durations = population.map(duration);
            // Unknown durations or unplaced spans keep the facet null, never 0.
            const known = durations.every(d => d !== null), placed = population.every(t => located(t.span) !== null);
            for (const component of ['sum', 'union'])
                add('act.duplicate_install', component === 'sum' ? (known ? sum(durations as number[]) : null) : (placed ? wall(population.map(t => t.span)) : null), 'ms', timing, { facets: { fingerprint, component }, samples: population.length, evidenceIds: toolEvidence(population) });
        }
    }
    for (const name of new Set(s.records.filter(r => isProduction(r) || r.importedTurn).map(r => r.event?.model ?? r.importedTurn?.model ?? 'unknown'))) {
        const rs = s.records.filter(r => (r.event?.model ?? r.importedTurn?.model ?? 'unknown') === name), population = model.filter(x => (x.model ?? 'unknown') === name);
        const calls = new Set(rs.flatMap(r => r.native.modelCall ? [JSON.stringify([r.memberId, nativeKey(r.native.modelCall)])] : r.importedTurn ? [r.recordId] : []));
        add('model.by_model', calls.size ? calls.size : null, 'count', 'observed', { facets: { model: name, component: 'calls' }, samples: calls.size });
        const observedUsage = usages.filter(u => (u.record.event?.model ?? u.record.importedTurn?.model ?? 'unknown') === name);
        add('model.by_model', aggregateUsage(observedUsage).total, 'tokens', 'observed', { facets: { model: name, component: 'tokens' }, samples: observedUsage.length });
        for (const timing of new Set(population.map(x => x.timing))) {
            const group = population.filter(x => x.timing === timing);
            add('model.by_model', sum(group.map(x => x.endMs! - x.startMs!)), 'ms', timing, { facets: { model: name, component: 'work' }, samples: group.length });
        }
        const reportedWork = rs.filter(r => r.importedTurn).map(r => r.importedTurn!.reported.model_inference_ms).filter((v): v is number => v != null);
        if (reportedWork.length)
            add('model.by_model', sum(reportedWork), 'ms', 'reported', { facets: { model: name, component: 'work' }, samples: reportedWork.length });
        if (!population.length && !reportedWork.length)
            add('model.by_model', null, 'ms', 'unavailable', { facets: { model: name, component: 'work' } });
        for (const layer of new Set(ttfts.map(x => x.layer))) {
            const group = ttfts.filter(x => x.layer === layer && x.recordIds.some(id => rs.some(r => r.recordId === id)));
            distribution('model.by_model', group.map(x => x.value), layer === 'log_upper_bound' ? 'derived' : layer === 'proxy' ? 'measured' : 'reported', { layer, facets: { model: name, component: 'ttft' } });
        }
    }
    const keys = ['act.avg_ms', 'act.p50_ms', 'act.p95_ms', 'act.max_ms', 'act.sum_ms', 'act.union_ms', 'model.sum_ms', 'model.union_ms', 'model.round_avg_ms', 'act.long_tool_count', 'act.duplicate_install', 'model.by_model'];
    for (const key of keys)
        if (!rows.some(m => m.key === key))
            add(key, null, key === 'act.long_tool_count' || key === 'act.duplicate_install' ? 'count' : 'ms');
    const populations = new Map<string, HealthMetric[]>();
    for (const row of rows) {
        const id = JSON.stringify([row.key, row.layer, row.facets, row.stat]);
        const group = populations.get(id) ?? [];
        group.push(row);
        populations.set(id, group);
    }
    for (const group of populations.values())
        if (group.length > 1)
            for (const row of group)
                row.facets = { ...row.facets, timing: row.timing };
    return rows;
}
