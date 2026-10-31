import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from '../types.js';
import type { RuleContext } from '../metrics.js';
import { buildSnapshot } from '../snapshot.js';
import { computeMetrics } from '../metrics.js';
import { validateHealthThresholds } from '../thresholds.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
function context(input = fixture(), overrides: Parameters<typeof validateHealthThresholds>[0] = undefined): RuleContext { const snapshot = buildSnapshot(input), thresholds = validateHealthThresholds(overrides); return { snapshot, thresholds, metrics: computeMetrics(snapshot, thresholds) }; }
import { startupRules } from './startup.js';
it('linked delegation exposes latency facts without an invented startup rule', () => { const c = context(fixture('g4-subagent')); expect(c.metrics.find(m => m.key === 'startup.delegate_latency_ms')!.value).toBe(2000); expect(startupRules(c)).toEqual([]); });
it('single member has no startup rule', () => expect(startupRules(context())).toEqual([]));
it('missing spawn/recipient link cannot invent latency', () => { const i = fixture('g4-subagent'); for (const r of i.records)
    r.native.delegateMemberId = null; const c = context(i); expect(c.metrics.find(m => m.key === 'startup.delegate_latency_ms')!.value).toBeNull(); expect(startupRules(c)).toEqual([]); });
