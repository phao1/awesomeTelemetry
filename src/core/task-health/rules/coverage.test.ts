import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { coverageRules } from './coverage.js';
it('triggers on unparsed members, missing semantics and limits', () => { const c = context(fixture('g5-missing')); expect(coverageRules(c)[0]!.rule).toBe('cov.incomplete'); c.snapshot.limits.push('events'); expect(coverageRules(c)[0]!.facts.reason).toContain('events'); });
it('does not trigger for complete paired scope', () => expect(coverageRules(context())).toEqual([]));
it('all derived timing is insufficient coverage rather than a clean result', () => { const c = context(fixture('g7-capped')); expect(coverageRules(c)[0]!.facts.reason).toContain('no_observed_timing'); });
