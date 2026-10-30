import type { FindingDraft, RuleContext } from '../metrics.js';
import { fact, metric } from '../metrics.js';
export function modelRules(c: RuleContext): FindingDraft[] {
    const { thresholds: t } = c, out: FindingDraft[] = [];
    for (const layer of ['proxy', 'exporter'] as const) {
        const row = metric(c, 'model.ttft', {}, 'p50', layer);
        if (row?.value != null && row.value > t.firstOutputMs)
            out.push(fact('model.slow_first_output', 'model', { layer, delay: row.value }, [], row.evidenceIds));
    }
    const pct = c.metrics.find(m => m.key === 'model.reasoning_rounds' && m.unit === 'pct'), n = c.snapshot.rounds.length;
    if (n >= t.reasoningMinRounds && pct?.value != null && pct.value >= t.reasoningPct)
        out.push(fact('model.always_reasoning', 'model', { pct: pct.value, count: n }, [], c.snapshot.records.map(r => 'evidence:' + r.recordId)));
    for (const layer of ['proxy', 'exporter', 'log_upper_bound'] as const) {
        const a = metric(c, 'model.reasoning_split', { group: 'present', component: 'first_output' }, 'mean', layer), b = metric(c, 'model.reasoning_split', { group: 'zero', component: 'first_output' }, 'mean', layer);
        if (a?.value != null && b?.value != null && a.samples >= t.reasoningGroupMin && b.samples >= t.reasoningGroupMin && a.value >= t.reasoningRatio * b.value && b.value > 0)
            out.push(fact('model.reasoning_split', 'model', { layer, ratio: a.value / b.value }, [], [...a.evidenceIds, ...b.evidenceIds]));
    }
    const cache = metric(c, 'model.cache_hit', { component: 'rounds2+' });
    if (cache?.value != null && cache.value < t.cacheHitPct)
        out.push(fact('model.low_cache', 'model', { pct: cache.value }, [], cache.evidenceIds));
    return out;
}
