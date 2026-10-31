import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from './types.js';
import { analyzeTaskHealth } from './report.js';
import { unionDuration } from './intervals.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
const analyze = (i: HealthInput) => analyzeTaskHealth(i, undefined, { id: 'report', generatedAt: '2026-10-30T00:10:00.000Z' });
it('copies caller metadata, has no score and locally resolves every evidence reference', () => { const r = analyze(fixture()); expect(r.id).toBe('report'); expect(r.generatedAt).toBe('2026-10-30T00:10:00.000Z'); expect(r).not.toHaveProperty('score'); const ids = new Set(r.evidence.map(e => e.id)); for (const item of [...r.metrics, ...r.findings])
    for (const id of item.evidenceIds)
        expect(ids.has(id)).toBe(true); });
it('G5 keeps all dimensions insufficient while retaining supported coverage finding', () => { const r = analyze(fixture('g5-missing')); expect(Object.values(r.dimensions).every(x => x === 'insufficient')).toBe(true); expect(r.findings.some(f => f.rule === 'cov.incomplete')).toBe(true); });
it('same waiting interval in two suggestions never creates summed savings', () => { const r = analyze(fixture()), a = r.findings.find(f => f.rule === 'act.long_tool')!, b = r.findings.find(f => f.rule === 'perceived.long_gap')!; expect(unionDuration([...a.intervalMs!, ...b.intervalMs!])).toBe(120000); expect(a.facts).not.toHaveProperty('savedMs'); expect(b.facts).not.toHaveProperty('savedMs'); });
it('no acceptance source or build-only verification cannot certify quality', () => { const i = fixture(); for (const r of i.records)
    if (r.native.command === 'npm test')
        r.native.command = 'npm run build'; expect(analyze(i).dimensions.quality).toBe('insufficient'); });
it('all retained records contribute even if only 200 were opened', () => { const i = fixture('g5-missing'); i.members = i.members.slice(0, 1); const base = structuredClone(i.records[1]!); i.records = i.records.slice(0, 1); for (let k = 1; k <= 2000; k++) {
    const r = structuredClone(base);
    r.recordId = 'r' + k;
    r.event!.sequence = k + 1;
    r.event!.turnKey = 'turn' + k;
    r.event!.startedAt = new Date(Date.parse(i.t0) + k * 1000).toISOString();
    r.round = null;
    i.records.push(r);
} const r = analyze(i); expect(r.rounds).toHaveLength(2000); expect(r.metrics.find(m => m.key === 'plan.rounds')!.value).toBe(2000); expect(r.metrics.find(m => m.key === 'overview.e2e_ms')!.value).toBe(2000000); });
it('unparsed child remains in denominator, and running status cannot imply final failure', () => { const i = fixture('g5-missing'); i.running = true; i.recordedStatus = 'error'; const r = analyze(i); expect(r.coverage.members).toEqual({ loaded: 1, total: 2 }); expect(r.findings.some(f => f.rule === 'quality.error_end')).toBe(false); });
it('an anomaly at retained record 2000 is analyzed and linked locally', () => { const i = fixture(); const context = structuredClone(i.records[1]!); const prefix = Array.from({ length: 1986 }, (_, k) => { const r = structuredClone(context); r.recordId = 'bookkeeping' + k; r.event!.sequence = k + 1; r.event!.kind = 'system'; r.event!.title = 'context'; return r; }); for (const r of i.records)
    r.event!.sequence += 1986; i.records = [...prefix, ...i.records]; const report = analyze(i), finding = report.findings.find(f => f.rule === 'act.long_tool')!; expect(i.records).toHaveLength(2000); expect(finding.evidenceIds).toContain('evidence:main:event:e13'); expect(report.evidence.find(e => e.id === 'evidence:main:event:e13')!.recordIds).toEqual(['main:event:e13']); });
it('member-budget prefixes keep omitted members in the coverage denominator', () => {
    const i=fixture();i.members=Array.from({length:101},(_,index)=>({...i.members[0]!,id:index===0?'main':'m'+index,detailLoaded:index===0}));
    const r=analyze(i);expect(r.coverage.members).toEqual({loaded:1,total:101});expect(r.coverage.limits).toContain('members');expect(Object.values(r.dimensions).every(x=>x==='insufficient')).toBe(true);
});
it('retains the input origin for presentation and uses null if the origin field is absent', () => {
  const input = fixture(); expect(analyze(input).t0).toBe(input.t0);
  const missingOrigin = { ...input, t0: undefined } as unknown as HealthInput;
  expect(analyze(missingOrigin).t0).toBeNull();
});
