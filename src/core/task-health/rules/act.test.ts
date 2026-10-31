import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { actRules } from './act.js';
it('long tools and cd-prefix count use exact durations; capped values have lower-bound facts', () => { const fs = actRules(context(fixture('g3-install'))); expect(fs.filter(x => x.rule === 'act.long_tool')).toHaveLength(2); expect(fs.find(x => x.rule === 'act.cd_prefix_long')!.facts.count).toBe(2); expect(fs.find(x => x.rule === 'act.duplicate_install')!.facts.count).toBe(3); expect(actRules(context(fixture('g7-capped')))[0]!.facts.duration).toBe('≥300s（推导值封顶）'); });
it('does not trigger at the long-tool threshold or for overlapping independent reads', () => { expect(actRules(context(fixture(), { longToolMs: 120000 })).some(x => x.rule === 'act.long_tool')).toBe(false); expect(actRules(context(fixture('g2-parallel'))).some(x => x.rule === 'act.serial_independent')).toBe(false); });
it('missing endpoints, fingerprints and targets are insufficient evidence', () => { const i = fixture(); for (const r of i.records) {
    r.native.command = null;
    r.native.targets = [];
    r.pairing = 'unavailable';
    r.event!.durationMs = 0;
} expect(actRules(context(i))).toEqual([]); });
it('environment resets split repeated install groups', () => { const i = fixture('g3-install'); i.records[3]!.native.environmentReset = true; i.records[5]!.native.environmentReset = true; expect(actRules(context(i)).some(x => x.rule === 'act.duplicate_install')).toBe(false); });
it('per-tool error rate and explicit consecutive error signatures trigger once per tool', () => { const i = fixture('g3-install'); for (const r of i.records.slice(1)) {
    r.event!.status = 'error';
    r.event!.error = 'ENOENT';
} expect(actRules(context(i)).find(x => x.rule === 'act.tool_errors')!.facts.errors).toBe(3); });
it('serial distinct-target reads trigger but missing targets cannot imply independence', () => { const i = fixture('g3-install'); for (const r of i.records.slice(1)) {
    r.event!.tool = 'read_file';
    r.native.command = null;
    r.native.targets = ['/f' + Math.ceil((r.event!.sequence - 1) / 2)];
} expect(actRules(context(i)).find(x => x.rule === 'act.serial_independent')!.facts.count).toBe(3); });
it('small write batches requires file-count and rate boundaries', () => { const i = fixture('g3-install'); for (const r of i.records.slice(1)) {
    r.event!.tool = 'write_file';
    r.native.command = null;
    r.native.targets = ['/f' + Math.ceil((r.event!.sequence - 1) / 2)];
} expect(actRules(context(i, { writeFiles: 3 })).find(x => x.rule === 'act.small_write_batches')!.facts.pct).toBe(100); expect(actRules(context(i)).some(x => x.rule === 'act.small_write_batches')).toBe(false); });
