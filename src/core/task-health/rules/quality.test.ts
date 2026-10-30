import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { qualityRules } from './quality.js';
it('unverified uses absence of observed successful verification after the LAST write', () => { const i = fixture(); i.records[12]!.event!.status = 'error'; expect(qualityRules(context(i)).some(x => x.rule === 'quality.unverified')).toBe(true); });
it('a successful verification after last write avoids the finding', () => expect(qualityRules(context())).toEqual([]));
it('missing suffix coverage is insufficient and running never asserts terminal failure', () => { const i = fixture('g5-missing'); i.running = true; i.recordedStatus = 'error'; expect(qualityRules(context(i))).toEqual([]); });
it('terminal cancelled/error is an observed quality gate', () => { const i = fixture(); i.recordedStatus = 'cancelled'; expect(qualityRules(context(i))[0]!.facts.status).toBe('cancelled'); });
