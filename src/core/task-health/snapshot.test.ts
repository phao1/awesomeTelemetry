import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from './types.js';
import { buildSnapshot, located } from './snapshot.js';
import { computeMetrics } from './metrics.js';
import { DEFAULT_HEALTH_THRESHOLDS } from './thresholds.js';
import { analyzeTaskHealth } from './report.js';
const fixture = (name = 'g1-serial') => JSON.parse(readFileSync(`src/core/__fixtures__/task-health/${name}.input.json`, 'utf8')) as HealthInput;
const report = (i: HealthInput) => analyzeTaskHealth(i, undefined, { id: 'test', generatedAt: i.snapshotAt });
it('reconstructs same-round production/tool overlap without double subtraction', () => { const i = fixture(); const r = i.records[4]!; r.event!.kind = 'llm'; r.event!.hasInput = false; r.event!.hasOutput = true; r.event!.turnKey = 'main:r1'; r.tool = null; r.pairing = 'unavailable'; const s = buildSnapshot(i); expect(s.rounds[0]?.modelEndMs).toBe(7000); });
it('does not pair across native scopes or promote ambiguous/duplicate pairs', () => { const i = fixture(); i.records[4]!.tool!.scope = 'different'; let s = buildSnapshot(i); expect(s.tools.find(t => t.source.recordId === i.records[3]!.recordId)?.span.timing).not.toBe('observed'); i.records[4]!.tool!.scope = i.records[3]!.tool!.scope; i.records.push({ ...structuredClone(i.records[4]!), recordId: 'duplicate' }); s = buildSnapshot(i); expect(s.tools[0]?.span.timing).not.toBe('observed'); });
it('requires collapsed Claude endpoints; observed and measured durations never cap', () => { const i = fixture(); i.members[0]!.provider = 'claude'; i.records.splice(4, 1); let s = buildSnapshot(i); expect(s.tools[0]?.span.timing).not.toBe('observed'); i.records[3]!.native.toolStartedAt = i.t0; i.records[3]!.native.toolCompletedAt = '2026-10-30T00:10:02.000Z'; s = buildSnapshot(i); expect(s.tools[0]?.durationMs).toBe(602000); expect(s.tools[0]?.span.capped).toBe(false); expect(s.tools[0]?.span.timing).toBe('observed'); });
it('start semantics exposes undivided activity; unknown disables partition/think', () => { const i = fixture(); i.members[0]!.provider = 'opencode'; i.members[0]!.timestampSemantics = 'start'; let r = report(i); expect(r.partition!.undivided).toBeGreaterThan(0); expect(r.rounds.every(x => x.modelEndMs === null)).toBe(true); i.members[0]!.timestampSemantics = 'unknown'; r = report(i); expect(r.partition).toBeNull(); expect(r.metrics.find(m => m.key === 'model.sum_ms')?.value).toBeNull(); });
it('clips reconstructed crossing intervals to a window and preserves call duration internally', () => { const i = fixture(); i.scope.from = '2026-10-30T00:01:00.000Z'; i.scope.to = '2026-10-30T00:01:30.000Z'; const s = buildSnapshot(i), t = s.tools[0]!; expect(located(t.span)).toEqual([60000, 90000]); expect(t.durationMs).toBe(120000); const r = report(i); expect(r.metrics.find(m => m.key === 'act.union_ms')?.value).toBe(30000); expect(Object.values(r.partition!).reduce((a, b) => a + b, 0)).toBe(30000); });
it('a new user turn deducts between-turn idle without implying a correction', () => { const i = fixture(); const prompt = structuredClone(i.records[0]!); prompt.recordId = 'append'; prompt.event!.id = 'append'; prompt.event!.sequence = 15; prompt.event!.startedAt = '2026-10-30T00:03:00.000Z'; i.records.push(prompt); expect(report(i).partition!.userWait).toBe(10000); expect(buildSnapshot(i).memberWaits[0]?.component).toBe('between_turns'); expect(report(i).findings.some(f => /correction|intervention/.test(f.rule))).toBe(false); i.records[13]!.native.requestsUserInput = true; expect(report(i).partition!.userWait).toBe(10000); });
it('running reports end at supplied snapshot and retain partial coverage', () => { const i = fixture(); i.running = true; i.snapshotAt = '2026-10-30T00:03:00.000Z'; const r = report(i); expect(r.metrics.find(m => m.key === 'overview.e2e_ms')?.value).toBe(180000); expect(r.metrics.find(m => m.key === 'overview.e2e_ms')?.coverage).toBe('partial'); });
it('fallback segmentation excludes bookkeeping carriers', () => { const i = fixture(); for (const r of i.records) {
    r.event!.turnKey = null;
    r.round = null;
} const carrier = structuredClone(i.records[1]!); carrier.recordId = 'carrier'; carrier.event!.title = 'token_count'; carrier.event!.sequence = 20; carrier.event!.startedAt = '2026-10-30T00:10:00.000Z'; i.records.push(carrier); const s = buildSnapshot(i); expect(s.reasons).toContain('fallback_segmentation'); expect(s.rounds).toHaveLength(5); expect(s.bounds).toEqual([0, 170000]); });
it('full overlap tool work retains independent sum and union', () => { const i = fixture('g2-parallel'); for (const r of i.records.filter(r => r.event!.turnKey === 'main:r2' && r.event!.hasOutput && r.tool))
    r.event!.startedAt = '2026-10-30T00:00:26.000Z'; const s = buildSnapshot(i); const ms = computeMetrics(s, DEFAULT_HEALTH_THRESHOLDS); expect(ms.find(m => m.key === 'act.sum_ms')!.value).toBe(151200); expect(ms.find(m => m.key === 'act.union_ms')!.value).toBe(131200); });
it('unmatched derived duration cannot extend a completed task beyond semantic observations', () => { const i = fixture('g7-capped'); i.records[2]!.event!.startedAt = '2026-10-30T00:00:10.000Z'; const s = buildSnapshot(i); expect(s.bounds).toEqual([0, 10000]); expect(s.tools[0]!.span.capped).toBe(true); });
it('missing native model endpoints on interval declarations remain unavailable rather than measured', () => { const i = fixture(); i.members[0]!.provider = 'opencode'; i.members[0]!.timestampSemantics = 'interval'; i.members[0]!.durationSource = 'measured'; const s = buildSnapshot(i); expect(s.spans.filter(x => x.kind === 'model')).toEqual([]); expect(s.undivided.length).toBeGreaterThan(0); });
it('G8 resets readiness per genuine user turn, excludes bookkeeping and retains wait components', () => {
    const input = fixture('g8-multiturn'), s = buildSnapshot(input), r = report(input);
    expect(s.rounds.map(r => r.readyMs)).toEqual([0, 13000, 3616000, 3622000]);
    expect(s.memberWaits).toEqual([{ memberId: 'main', component: 'between_turns', intervalMs: [15000, 3616000], recordIds: ['main:event:e4', 'main:event:e8'] }]);
    expect(s.userWait).toEqual([[15000, 3616000]]);
    expect(r.partition).toEqual({ modelOnly: 12000, toolOnly: 12000, userWait: 3601000, overlap: 0, undivided: 0, delegateWait: 0, unattributed: 0 });
    for (const span of s.spans) { const i = located(span); if (i) expect(i[1] <= 15000 || i[0] >= 3616000).toBe(true); }
    expect(r.findings.some(f => f.rule === 'perceived.long_gap')).toBe(false);
});
it('TH-004a9 shields member waiting with another selected member model activity', () => {
    const input = fixture('g8-multiturn');
    input.members.push({ ...input.members[0]!, id: 'child', sessionKey: 'child', parentId: 'main', role: 'subagent', timestampSemantics: 'interval', durationSource: 'measured' });
    const childPrompt = structuredClone(input.records[0]!), childModel = structuredClone(input.records[3]!);
    for (const [index, r] of [childPrompt, childModel].entries()) { r.recordId = 'child:event:e' + index; r.memberId = 'child'; r.event!.id = 'child' + index; r.event!.sessionId = 'child'; r.event!.sequence = index; r.event!.turnKey = index ? 'child:r1' : null; }
    childPrompt.event!.startedAt = '2026-10-30T00:16:40.000Z'; childModel.event!.startedAt = '2026-10-30T00:33:20.000Z';
    childModel.native.modelStartedAt = childPrompt.event!.startedAt; childModel.native.modelCompletedAt = childModel.event!.startedAt;
    input.records.push(childPrompt, childModel);
    const s = buildSnapshot(input), r = report(input);
    expect(s.memberWaits.find(w => w.memberId === 'main')?.intervalMs).toEqual([15000, 3616000]);
    expect(s.userWait).toEqual([[15000, 1000000], [2000000, 3616000]]);
    expect(r.partition).toMatchObject({ userWait: 2601000, modelOnly: 1012000, toolOnly: 12000, unattributed: 0 });
    expect(r.metrics.find(m => m.key === 'overview.e2e_ms' && m.facets.component === 'active')?.value).toBe(1024000);
    expect(r.spans.find(s => s.memberId === 'child' && s.kind === 'model')).toMatchObject({ startMs: 1000000, endMs: 2000000 });
    // Main-only scope cannot use an excluded child's activity as a shield.
    input.scope.member = 'main'; expect(buildSnapshot(input).userWait).toEqual([[15000, 3616000]]);
});
it('TH-004a8 splits a repeated opaque turnKey without changing source records', () => {
    const input = fixture('g8-multiturn'); input.records[3]!.event!.turnKey = 'opaque';
    input.records[8]!.event!.turnKey = 'opaque'; input.records[9]!.event!.turnKey = 'opaque';
    const before = JSON.stringify(input), s = buildSnapshot(input);
    expect(s.rounds.map(r => r.id)).toEqual(['main:r1', 'opaque', 'opaque@main:event:e8', 'main:r4']);
    expect(s.rounds.map(r => r.readyMs)).toEqual([0, 13000, 3616000, 3622000]);
    expect(new Set(s.rounds.map(r => r.id)).size).toBe(s.rounds.length); expect(JSON.stringify(input)).toBe(before);
});
it('unknown or still-running tools keep a previous turn open instead of fabricating idle', () => {
    const input = fixture('g8-multiturn'); input.records.splice(2, 1); input.records[1]!.event!.status = 'running';
    const s = buildSnapshot(input); expect(s.userWait).toEqual([]); expect(s.reasons).toContain('turn_end_unknown');
});
it('explicit requested waiting keeps its component and does not double-count between-turn waiting', () => {
    const input = fixture('g8-multiturn'); input.records[3]!.native.requestsUserInput = true;
    const s = buildSnapshot(input); expect(s.memberWaits).toEqual([{ memberId: 'main', component: 'requested', intervalMs: [15000, 3616000], recordIds: ['main:event:e4', 'main:event:e8'] }]);
    expect(report(input).partition?.userWait).toBe(3601000);
});
it('clips tools at a new user boundary and leaves late results as pairing context', () => {
    const input = fixture('g8-multiturn'), prompt = structuredClone(input.records[7]!); prompt.recordId = 'interrupt'; prompt.event!.id = 'interrupt'; prompt.event!.startedAt = '2026-10-30T01:00:21.000Z';
    input.records.splice(9, 0, prompt); input.records.forEach((r, index) => { r.event!.sequence = index + 1; });
    const s = buildSnapshot(input), tool = s.tools.find(t => t.source.recordId === 'main:event:e9')!;
    expect(located(tool.span)).toEqual([3620000, 3621000]); expect(tool.durationMs).toBe(1000);
    expect(s.reasons).toContain('cross_turn_interval_clipped'); expect(s.rounds.at(-1)?.readyMs).toBe(3621000);
    expect(s.rounds).toHaveLength(4);
});
