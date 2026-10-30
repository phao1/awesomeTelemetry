import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { modelRules } from './model.js';
it('exporter P50 triggers only when it strictly exceeds the threshold', () => { expect(modelRules(context(fixture('g6-tracelog'), { firstOutputMs: 2000 })).some(x => x.rule === 'model.slow_first_output')).toBe(true); expect(modelRules(context(fixture('g6-tracelog'), { firstOutputMs: 3000 })).some(x => x.rule === 'model.slow_first_output')).toBe(false); });
it('reasoning split requires enough raw samples in both same-layer groups', () => { expect(modelRules(context(fixture('g6-tracelog'), { reasoningGroupMin: 2 })).find(x => x.rule === 'model.reasoning_split')!.facts.ratio).toBeCloseTo(5650 / 750); expect(modelRules(context(fixture('g6-tracelog'))).some(x => x.rule === 'model.reasoning_split')).toBe(false); });
it('unknown reasoning and usage never imply always-thinking or low-cache', () => { expect(modelRules(context(fixture('g5-missing')))).toEqual([]); });
it('all known reasoning states can trigger high reasoning share', () => { const i = fixture('g6-tracelog'); for (const r of i.records)
    r.importedTurn!.reported.thoughts_token_count = 1; expect(modelRules(context(i, { reasoningMinRounds: 4 })).find(x => x.rule === 'model.always_reasoning')!.facts.pct).toBe(100); });
it('low-cache excludes round1 and requires inclusion facts', () => { const i = fixture(); for (const r of i.records.filter(r => r.event!.kind === 'llm' || r.event!.kind === 'reasoning' || r.event!.hasInput && r.tool)) {
    r.native.usage = { input: 100, output: 10, reasoning: 0, cacheRead: 10, cacheWrite: 0, inputIncludesCache: true, outputIncludesReasoning: true };
} expect(modelRules(context(i)).some(x => x.rule === 'model.low_cache')).toBe(true); for (const r of i.records)
    if (r.native.usage)
        r.native.usage.inputIncludesCache = null; expect(modelRules(context(i)).some(x => x.rule === 'model.low_cache')).toBe(false); });
