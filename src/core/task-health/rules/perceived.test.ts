import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { perceivedRules } from './perceived.js';
it('triggers with endpoint evidence and command attribution', () => { const f = perceivedRules(context())[0]!; expect(f.facts).toMatchObject({ gap: 120000, cause: 'npm test' }); expect(f.intervalMs).toEqual([[40000, 160000]]); expect(f.evidenceIds).not.toHaveLength(0); });
it('strict threshold equality does not trigger', () => expect(perceivedRules(context(fixture(), { gapMs: 120000 }))).toEqual([]));
it('one observation is insufficient', () => { const i = fixture(); i.records = i.records.slice(0, 1); expect(perceivedRules(context(i))).toEqual([]); });
