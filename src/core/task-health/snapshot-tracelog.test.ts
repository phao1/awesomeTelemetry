import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HealthInput } from './types.js';
import { traceLogSnapshot } from './snapshot-tracelog.js';
const fixture = () => JSON.parse(readFileSync('src/core/__fixtures__/task-health/g6-tracelog.input.json', 'utf8')) as HealthInput;
it('retains exporter timing, zero/present reasoning and reported request envelopes', () => { const i = fixture(), s = traceLogSnapshot(i, i.records[0]!, 1); expect(s.round.id).toBe('main:import:0'); expect(s.spans[0]).toMatchObject({ timing: 'reported', kind: 'other', firstContentMs: 800, firstContentLayer: 'exporter', reasoning: 'zero' }); expect(traceLogSnapshot(i, i.records[1]!, 2).round.reasoning).toBe('present'); });
it('does not invent placement from reported cumulative tool/model durations', () => { const i = fixture(); i.records[0]!.importedTurn!.reported.tool_time_ms = 5000; const s = traceLogSnapshot(i, i.records[0]!, 1); expect(s.spans.every(x => x.kind === 'other')).toBe(true); expect(s.round.modelEndMs).toBeNull(); });
it('invalid/missing clocks and TTFT stay unavailable', () => { const i = fixture(); i.records[0]!.importedTurn!.responseTime = null; i.records[0]!.importedTurn!.reported.ttft_ms = -1; const s = traceLogSnapshot(i, i.records[0]!, 1); expect(s.round.endMs).toBeNull(); expect(s.spans[0]!.firstContentMs).toBeNull(); });
