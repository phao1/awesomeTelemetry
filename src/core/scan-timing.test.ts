import { describe, expect, it } from 'vitest';
import { scanTimingRatio, scanTimingReason, scanTimingValue } from './scan-timing.js';
import type { TraceSession } from './trace-types.js';

const session = (overrides: Partial<TraceSession> = {}): TraceSession => ({ id: 'scan', provider: 'codex', sourceAgent: 'Codex', title: 'Synthetic scan',
  startedAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:02.000Z', status: 'success', cwd: null, messageCount: 0, eventCount: 0,
  tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 0 }, costUsd: 0, systemPrompt: null,
  dataSource: 'scan', sourcePath: 'fixture://scan', totalDurationMs: 2000, isSubagent: false, durationSource: 'measured', ...overrides });
const side = (overrides: Partial<TraceSession> = {}) => ({ session: session(overrides), pending: false, hasMore: false, eventOffset: 0 });

describe('scan-only timing interpretation policy', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity, -1, '0', {}])('keeps invalid/absent display input %s unknown', value => expect(scanTimingValue(value)).toBeNull());
  it('preserves zero and fractional finite native observations without changing their numerical algorithm', () => {
    expect(scanTimingValue(0)).toBe(0); expect(scanTimingValue(0.25)).toBe(0.25); expect(scanTimingValue(42.5)).toBe(42.5);
  });
  it('compares wall-clock independently of per-event measured/derived/unknown basis and provider', () => {
    expect(scanTimingReason(side({ durationSource: 'unknown' }), side({ provider: 'claude', sourceAgent: 'Claude', durationSource: 'derived' }), 'e2e', 1000, 2000)).toBeNull();
    expect(scanTimingReason({ session: session({ durationSource: undefined }) }, { session: session({ durationSource: undefined }), hasMore: true, eventOffset: 2000 }, 'e2e', 1000, 2000)).toBeNull();
  });
  it.each(['ttft', 'tps', 'tpot', 'turnGap', 'eventDuration'] as const)('allows like-for-like declared %s observations, including genuine zero', metric => {
    expect(scanTimingReason(side(), side(), metric, 0, 20)).toBeNull();
    expect(scanTimingReason(side({ durationSource: 'derived' }), side({ durationSource: 'derived' }), metric, 10, 20)).toBeNull();
  });
  it.each(['ttft', 'tps', 'tpot', 'turnGap', 'eventDuration'] as const)('rejects absent, unknown or mixed %s basis without classifying it as equality', metric => {
    expect(scanTimingReason(side({ durationSource: undefined }), side(), metric, 10, 20)).toBe('duration_basis_unknown');
    expect(scanTimingReason(side({ durationSource: 'unknown' }), side(), metric, 10, 20)).toBe('duration_basis_unknown');
    expect(scanTimingReason(side({ durationSource: 'derived' }), side(), metric, 10, 20)).toBe('duration_basis_mismatch');
  });
  it('rejects cross-source records and absent side metadata, never guessing from equal metric numbers', () => {
    expect(scanTimingReason(null, side(), 'e2e', 10, 10)).toBe('source_mismatch');
    expect(scanTimingReason(side({ dataSource: 'proxy' }), side(), 'e2e', 10, 10)).toBe('source_mismatch');
    expect(scanTimingReason(side(), side({ provider: 'claude' }), 'tps', 10, 10)).toBe('source_mismatch');
    expect(scanTimingReason(side(), side({ sourceAgent: 'Different logger' }), 'tps', 10, 10)).toBe('source_mismatch');
  });
  it('requires ready sessions and complete event pages only for event-derived comparisons', () => {
    expect(scanTimingReason({ ...side(), pending: true }, side(), 'e2e', 10, 20)).toBe('partial_evidence');
    expect(scanTimingReason({ ...side(), hasMore: true }, side(), 'tps', 10, 20)).toBe('partial_evidence');
    expect(scanTimingReason(side(), { ...side(), eventOffset: 1 }, 'eventDuration', 10, 20)).toBe('partial_evidence');
  });
  it('does not rank unknown, nonfinite, negative or zero wall-clock observations', () => {
    expect(scanTimingReason(side(), side(), 'tps', null, 20)).toBe('missing_value');
    for (const invalid of [NaN, Infinity, -1]) expect(scanTimingReason(side(), side(), 'e2e', invalid, 20)).toBe('invalid_value');
    expect(scanTimingReason(side(), side(), 'e2e', 0, 20)).toBe('invalid_value');
  });
  it('ratios require an admissible policy and positive nonzero denominator', () => {
    expect(scanTimingRatio(side(), side(), 'e2e', 10, 20)).toBe(2);
    expect(scanTimingRatio(side(), side(), 'eventDuration', 0, 20)).toBeNull();
    expect(scanTimingRatio(side({ durationSource: 'derived' }), side(), 'eventDuration', 10, 20)).toBeNull();
    expect(scanTimingRatio(side(), side(), 'tps', null, 20)).toBeNull();
    expect(scanTimingRatio(side(), side(), 'e2e', Number.MIN_VALUE, 1)).toBeNull();
  });
  it('is deterministic and does not mutate source provenance or metric values', () => {
    const left = side(), right = side({ durationSource: 'derived' }); const before = structuredClone([left, right]);
    expect(scanTimingReason(left, right, 'tps', 10, 20)).toBe(scanTimingReason(left, right, 'tps', 10, 20)); expect([left, right]).toEqual(before);
  });
});
