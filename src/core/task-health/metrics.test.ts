import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from './types.js';
import { aggregateUsage, computeMetrics, usageObservations } from './metrics.js';
import { buildSnapshot } from './snapshot.js';
import { DEFAULT_HEALTH_THRESHOLDS } from './thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
const metrics = (i: HealthInput) => computeMetrics(buildSnapshot(i), DEFAULT_HEALTH_THRESHOLDS);
const usage = { input: 100, output: 20, reasoning: 5, cacheRead: 80, cacheWrite: 10, inputIncludesCache: true, outputIncludesReasoning: true };
it('cache/reasoning subsets do not double-count tokens', () => { const s = buildSnapshot(fixture()); s.records[1]!.native.usage = usage; const a = aggregateUsage(usageObservations(s)); expect(a.total).toBe(120); expect(a.hit).toBe(80); });
it('missing usage and subset/inclusion violations stay unknown', () => { const i = fixture('g5-missing'); expect(metrics(i).find(m => m.key === 'model.cache_hit')!.value).toBeNull(); const s = buildSnapshot(i); s.records[1]!.native.usage = { ...usage, inputIncludesCache: null }; expect(aggregateUsage(usageObservations(s)).total).toBeNull(); s.records[1]!.native.usage = { ...usage, cacheRead: 200 }; expect(aggregateUsage(usageObservations(s)).total).toBeNull(); });
it('cacheWriteReported=false uses zero and absent reasoning can be included in output', () => { const s = buildSnapshot(fixture()); s.records[1]!.native.usage = { ...usage, reasoning: null, cacheWrite: null, cacheWriteReported: false }; expect(aggregateUsage(usageObservations(s)).total).toBe(120); });
it('native/capture mirrors are one logical call and usage observation', () => {
    const i = fixture();
    i.records = i.records.slice(0, 3);
    for (const r of i.records.slice(1)) {
        r.native.modelCall = { namespace: 'n', scope: 's', kind: 'request', value: 'one' };
        r.attempt = { namespace: 'n', scope: 's', kind: 'request', value: 'try1' };
        r.native.usage = usage;
    }
    i.captures = [{ id: 'capture', recordIds: [i.records[2]!.recordId], startedMs: 0, firstContentMs: 1000, completedMs: 5000, outputTokens: 20, layer: 'proxy' }];
    const ms = metrics(i);
    expect(ms.find(m => m.key === 'model.calls')!.value).toBe(1);
    expect(ms.find(m => m.key === 'cost.tokens' && !m.facets.component)!.value).toBe(120);
    expect(ms.find(m => m.key === 'model.ttft' && m.layer === 'proxy' && m.stat === 'p50')!.value).toBe(1000);
});
it('three attempts retain all known consumption but one logical call', () => {
    const i = fixture();
    i.records = i.records.slice(0, 1);
    const base = fixture().records[2]!;
    for (let n = 1; n <= 3; n++) {
        const r = structuredClone(base);
        r.recordId = 'attempt' + n;
        r.event!.sequence = n + 1;
        r.native.modelCall = { namespace: 'n', scope: 's', kind: 'request', value: 'one' };
        r.attempt = { namespace: 'n', scope: 's', kind: 'request', value: String(n) };
        r.native.usage = usage;
        i.records.push(r);
    }
    const ms = metrics(i);
    expect(ms.find(m => m.key === 'model.calls')!.value).toBe(1);
    expect(ms.find(m => m.key === 'cost.tokens' && !m.facets.component)!.value).toBe(360);
});
it('cumulative counters use deltas, disclose resets and preserve independent input/output', () => {
    const i = fixture();
    i.members[0]!.tokenSemantics = { cacheRead: 'cumulative', reasoning: 'cumulative' };
    for (const [idx, value] of [[1, 10], [5, 30], [8, 5]]) {
        const r = i.records[idx!]!;
        r.native.usage = { ...usage, inputIncludesCache: false, outputIncludesReasoning: false, cacheRead: value!, reasoning: value! };
        r.native.modelCall = { namespace: 'n', scope: 's', kind: 'request', value: String(idx) };
    }
    const s = buildSnapshot(i), us = usageObservations(s);
    expect(us.map(x => x.usage.cacheRead)).toEqual([10, 20, 5]);
    expect(s.reasons).toContain('usage_counter_reset');
});
it('raw samples preserve observation order, median and n<5 P95 unavailability', () => { const ms = metrics(fixture('g6-tracelog')); expect(ms.find(m => m.key === 'model.ttft' && m.layer === 'exporter' && m.stat === 'p50')).toMatchObject({ value: 3000, samples: 4, values: [800, 5200, 700, 6100] }); expect(ms.find(m => m.key === 'model.ttft' && m.layer === 'exporter' && m.stat === 'p95')).toMatchObject({ value: null, reason: 'fewer_than_5_samples' }); });
it('five eligible tools supply nearest-rank P95, unpaired derived tools never enter it', () => {
    const i = fixture('g3-install');
    for (let k = 0; k < 2; k++) {
        const a = structuredClone(i.records[1]!), b = structuredClone(i.records[2]!);
        for (const [j, r] of [a, b].entries()) {
            r.recordId = 'extra' + k + j;
            r.event!.sequence = 8 + k * 2 + j;
            r.event!.turnKey = 'extra' + k;
            r.tool!.value = 'extra' + k;
        }
        i.records.push(a, b);
    }
    expect(metrics(i).find(m => m.key === 'act.p95_ms')!.value).toBe(130000);
    expect(metrics(fixture('g7-capped')).find(m => m.key === 'act.p95_ms')!.value).toBeNull();
});
it('invalid capture clocks and unknown platform layers cannot supply samples', () => { const i = fixture(); i.captures = [{ id: 'bad', recordIds: [i.records[2]!.recordId], startedMs: 1000, firstContentMs: 500, completedMs: 5000, outputTokens: 20, layer: 'proxy' }, { id: 'platform', recordIds: [i.records[2]!.recordId], startedMs: 0, firstContentMs: 100, completedMs: 5000, outputTokens: 20, layer: 'kernel' }]; const ms = metrics(i); expect(ms.find(m => m.key === 'model.ttft' && m.layer === 'proxy')!.value).toBeNull(); expect(ms.find(m => m.key === 'model.ttft' && m.layer === 'kernel')!.value).toBeNull(); });
it('metric identities are unique and every missing/partial value has a reason', () => {
    for (const name of ['g1-serial', 'g5-missing', 'g6-tracelog', 'g7-capped']) {
        const ms = metrics(fixture(name)), ids = ms.map(m => JSON.stringify([m.key, m.layer, m.facets, m.stat]));
        expect(new Set(ids).size).toBe(ids.length);
        for (const m of ms)
            if (m.value === null || m.coverage !== 'complete')
                expect(m.reason).toBeTruthy();
    }
});
it('imported reported raw usage survives unknown inclusion flags', () => { const ms = metrics(fixture('g6-tracelog')); expect(ms.find(m => m.key === 'cost.tokens' && m.facets.component === 'reasoning')).toMatchObject({ value: 2100, timing: 'reported' }); expect(ms.find(m => m.key === 'model.cache_hit' && !m.facets.component)!.value).toBeNull(); });
it('one missing round usage makes full-scope corrected totals unknown', () => { const i = fixture(); i.records[1]!.native.usage = usage; expect(metrics(i).find(m => m.key === 'cost.tokens' && !m.facets.component)!.value).toBeNull(); expect(metrics(i).find(m => m.key === 'model.cache_hit' && !m.facets.component)!.value).toBeNull(); });
it('same-layer native/import mirrors cannot duplicate exporter TTFT samples', () => {
    const i = fixture('g6-tracelog');
    i.captures = [{ id: 'mirror', recordIds: [i.records[0]!.recordId], startedMs: 0, firstContentMs: 800, completedMs: 10000, outputTokens: 20, layer: 'exporter' }];
    expect(metrics(i).find(m => m.key === 'model.ttft' && m.layer === 'exporter' && m.stat === 'p50')).toMatchObject({ value: 3000, samples: 4 });
});
it('duplicate install time facets stay null when install durations are unknown', () => {
    const s = buildSnapshot(fixture('g3-install'));
    for (const t of s.tools.filter(x => x.span.toolClass === 'install'))
        Object.assign(t, { durationMs: null, span: { ...t.span, timing: 'unavailable', startMs: null, endMs: null } });
    const rows = computeMetrics(s, DEFAULT_HEALTH_THRESHOLDS).filter(m => m.key === 'act.duplicate_install' && m.unit === 'ms');
    expect(rows).toHaveLength(2);
    expect(rows.every(m => m.value === null)).toBe(true);
});
