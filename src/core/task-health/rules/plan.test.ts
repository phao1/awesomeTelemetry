import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { planRules } from './plan.js';
it('many rounds requires an explicit baseline and strict multiplier boundary', () => { expect(planRules(context(fixture(), { roundBaseline: 2 })).some(x => x.rule === 'plan.many_rounds')).toBe(true); expect(planRules(context(fixture(), { roundBaseline: 5, roundMultiplier: 1 })).some(x => x.rule === 'plan.many_rounds')).toBe(false); });
it('no baseline or unknown target is insufficient', () => { const i = fixture(); for (const r of i.records)
    r.native.targets = []; expect(planRules(context(i))).toEqual([]); });
it('exploration uses the first-write wall boundary', () => { expect(planRules(context(fixture(), { explorePct: 10 })).some(x => x.rule === 'plan.explore_heavy')).toBe(true); expect(planRules(context()).some(x => x.rule === 'plan.explore_heavy')).toBe(false); });
it('repeated reads clear after observed file changes', () => { const i = fixture('g3-install'); for (const r of i.records.slice(1)) {
    r.event!.tool = 'read_file';
    r.native.command = null;
    r.native.targets = ['/a'];
} expect(planRules(context(i)).find(x => x.rule === 'plan.repeated_reads')!.facts.count).toBe(3); for (const r of i.records.slice(3, 5))
    r.event!.tool = 'write_file'; expect(planRules(context(i)).some(x => x.rule === 'plan.repeated_reads')).toBe(false); });
it('same-target write-failed-verify-write chains are neutral facts, not user corrections', () => { const i = fixture('g3-install'); const template = structuredClone(i.records[1]!); i.records = i.records.slice(0, 1); for (let k = 0; k < 5; k++) {
    const call = structuredClone(template), result = structuredClone(template);
    call.recordId = 'c' + k;
    result.recordId = 'r' + k;
    for (const [j, r] of [call, result].entries()) {
        r.event!.sequence = 2 + k * 2 + j;
        r.event!.turnKey = 'round' + k;
        r.event!.startedAt = `2026-10-30T00:00:${String(1 + k * 2 + j).padStart(2, '0')}.000Z`;
        r.event!.tool = k % 2 ? 'test' : 'write_file';
        r.event!.hasInput = j === 0;
        r.event!.hasOutput = j === 1;
        r.event!.status = k % 2 ? 'error' : 'success';
        r.native.command = k % 2 ? 'npm test' : null;
        r.native.targets = ['/a'];
        r.tool!.value = 'tool' + k;
    }
    i.records.push(call, result);
} expect(planRules(context(i)).find(x => x.rule === 'plan.rework_chain')!.facts.count).toBe(3); });
