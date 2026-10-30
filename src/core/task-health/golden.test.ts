import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import type { HealthInput, HealthReport } from './types.js';
import { analyzeTaskHealth } from './report.js';
import { located } from './snapshot.js';
import { unionDuration } from './intervals.js';
const names = ['g1-serial', 'g2-parallel', 'g3-install', 'g4-subagent', 'g5-missing', 'g6-tracelog', 'g7-capped'];
export function fixture(name = 'g1-serial'): HealthInput { return JSON.parse(readFileSync(resolve(`src/core/__fixtures__/task-health/${name}.input.json`), 'utf8')) as HealthInput; }
export function analyze(input: HealthInput = fixture()): HealthReport { return analyzeTaskHealth(input, undefined, { id: 'golden-' + input.taskId, generatedAt: '2026-10-30T00:10:00.000Z' }); }
function equal(actual: unknown, expected: unknown): void {
    if (typeof expected === 'number') {
        expect(actual).toBeTypeOf('number');
        expect(actual).toBeCloseTo(expected, 1);
    }
    else if (Array.isArray(expected)) {
        expect(actual).toBeInstanceOf(Array);
        expected.forEach((x, i) => equal((actual as unknown[])[i], x));
    }
    else if (expected !== null && typeof expected === 'object') {
        for (const [key, value] of Object.entries(expected))
            equal((actual as Record<string, unknown>)?.[key], value);
    }
    else
        expect(actual).toEqual(expected);
}
function projection(r: HealthReport, expected: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...r };
    const metrics: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(expected.metrics as Record<string, unknown> ?? {})) {
        const rows = r.metrics.filter(m => m.key === key);
        if (value === null || typeof value === 'number')
            metrics[key] = rows.find(m => Object.keys(m.facets).length === 0)?.value ?? null;
        else if (key === 'ux.max_gap_log')
            metrics[key] = { value: rows[0]?.value, command: rows[0]?.facets.cause };
        else if (key === 'model.reasoning_rounds')
            metrics[key] = { ...Object.fromEntries(rows.filter(m => m.unit === 'count').map(m => [m.facets.state, m.value])), pct: rows.find(m => m.unit === 'pct')?.value, total: r.rounds.length, all: r.rounds.every(x => x.reasoning === 'unknown') ? 'unknown' : null };
        else if (key === 'act.duplicate_install')
            metrics[key] = { count: rows.find(m => m.unit === 'count')?.value, sumMs: rows.find(m => m.facets.component === 'sum')?.value, unionMs: rows.find(m => m.facets.component === 'union')?.value };
        else if (key === 'model.reasoning_split')
            metrics[key] = Object.fromEntries(['present', 'zero'].map(group => { const m = rows.find(m => m.facets.group === group && m.facets.component === 'first_output' && m.layer === 'exporter'); return [group, { samples: m?.samples, firstOutputMeanMs: m?.value }]; }));
        else if (key === 'model.ttft')
            metrics[key] = { layer: 'exporter', p50: rows.find(m => m.layer === 'exporter' && m.stat === 'p50')?.value, p95: rows.find(m => m.layer === 'exporter' && m.stat === 'p95')?.value };
        else if (typeof value === 'object' && 'includesMemberIds' in value!)
            metrics[key] = { includesMemberIds: [...new Set(r.spans.filter(s => key === 'model.sum_ms' ? s.kind === 'model' : s.kind === 'tool' || s.kind === 'delegate').map(s => s.memberId))].sort((a, b) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)) };
        else
            throw new Error('Unhandled expected metric ' + key);
    }
    result.metrics = metrics;
    result.rounds = (expected.rounds as {
        id: string;
    }[] ?? []).map(x => { const round = r.rounds.find(a => a.id === x.id)!; const tools = r.spans.filter(s => round.toolSpanIds.includes(s.id)).flatMap(s => { const l = located(s); return l ? [l] : []; }); return { ...round, thinkMs: round.modelEndMs !== null && round.readyMs !== null ? round.modelEndMs - round.readyMs : null, actSumMs: tools.reduce((n, [s, e]) => n + e - s, 0), actUnionMs: unionDuration(tools) }; });
    result.spans = (expected.spans as {
        recordId: string;
    }[] ?? []).map(x => r.spans.find(s => s.recordId === x.recordId));
    result.findings = Object.fromEntries(Object.keys(expected.findings as object ?? {}).map(rule => { const fs = r.findings.filter(f => f.rule === rule), f = fs[0]; return [rule, f ? { ...f.facts, triggered: true, messageContains: f.recommendation.action, recommendationContains: f.recommendation.action } : null]; }));
    return result;
}
describe('contract golden projections', () => {
    for (const name of names)
        it(name, () => {
            const expected = JSON.parse(readFileSync(resolve(`src/core/__fixtures__/task-health/${name}.expected.json`), 'utf8')) as Record<string, unknown>;
            const report = analyzeTaskHealth(fixture(name), undefined, { id: 'golden-' + name, generatedAt: '2026-10-30T00:10:00.000Z' });
            const actual = projection(report, expected);
            // Text projections assert substring templates; every other expected field is compared recursively.
            const findingExpected = expected.findings as Record<string, Record<string, unknown> | null>;
            for (const [rule, f] of Object.entries(findingExpected ?? {}))
                for (const key of ['messageContains', 'recommendationContains'])
                    if (f?.[key] !== undefined) {
                        expect((actual.findings as Record<string, Record<string, string>>)[rule]?.[key]).toContain(f[key]);
                        (actual.findings as Record<string, Record<string, unknown>>)[rule]![key] = f[key];
                    }
            equal(actual, expected);
        });
    it('is deterministic, does not mutate input, read the clock, or call fetch/http', () => {
        const input = fixture(), before = JSON.stringify(input);
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden'); });
        const h = vi.spyOn(http, 'request').mockImplementation(() => { throw new Error('http forbidden'); });
        const hs = vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('https forbidden'); });
        const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock forbidden'); });
        try {
            expect(analyze(input)).toEqual(analyze(input));
            expect(JSON.stringify(input)).toBe(before);
            expect(fetch).not.toHaveBeenCalled();
            expect(h).not.toHaveBeenCalled();
            expect(hs).not.toHaveBeenCalled();
            expect(now).not.toHaveBeenCalled();
        }
        finally {
            vi.restoreAllMocks();
        }
    });
});
