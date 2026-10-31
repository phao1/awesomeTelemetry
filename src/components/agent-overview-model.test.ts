import { describe, expect, it } from 'vitest';
import type { AgentOverviewRow, SessionIndexEntry } from '../core/trace-types.js';
import { groupRecentOverviewSessions, overviewGroupKey, overviewTotals, recentOverviewSessions, sortOverviewRows } from './agent-overview-model.js';

const group = (sourceAgent: string, patch: Partial<AgentOverviewRow> = {}): AgentOverviewRow => ({
  provider: 'codex', sourceAgent, sessionCount: 2, eventCount: 10,
  tokenInput: 10, tokenOutput: 20, tokenTotal: 30, costUsd: 9, pricedSessionCount: 0,
  avgWallClockMs: 1000, latestUpdatedAt: '2026-10-18T00:00:00.000Z',
  avgToolDurationMs: null, errorRate: null, verificationCoverage: null, debugEntryRate: null,
  durationByPhase: { understand: 0, plan: 0, implement: 0, debug: 0, verify: 0, report: 0 }, ...patch,
});
const index = (id: string, sourceAgent: string, patch: Partial<SessionIndexEntry> = {}): SessionIndexEntry => ({
  id, sourceAgent, provider: 'codex', title: id, startedAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z', status: 'success', cwd: null,
  eventCount: 2, messageCount: 0, tokenTotal: 4, costUsd: 0, dataSource: 'scan',
  sourcePath: '/synthetic/session', detailLoaded: false, mergeGroupId: null, hasSystemPrompt: false, tags: [], ...patch,
});

describe('Agent overview metadata-only interpretation', () => {
  it('sums sessions/events/tokens and counts groups without inventing means or quality scores', () => {
    expect(overviewTotals([group('A'), group('B', { sessionCount: 98, eventCount: 90, tokenTotal: 70 })]))
      .toEqual({ sessions: 100, events: 100, tokens: 100, groups: 2 });
  });
  it('uses an unambiguous provider/sourceAgent identity', () => {
    expect(overviewGroupKey(group('A/B'))).not.toBe(overviewGroupKey(group('A')));
    expect(overviewGroupKey(group('A'))).not.toBe(overviewGroupKey(group('A', { provider: 'claude' })));
  });
  it.each(['asc', 'desc'] as const)('sorts null after observed zero and positive values (%s), without mutating input', direction => {
    const rows = [group('unknown'), group('zero', { errorRate: 0 }), group('recorded', { errorRate: 0.5 })];
    const result = sortOverviewRows(rows, { key: 'errorRate', direction });
    expect(result.map(row => row.sourceAgent)).toEqual(direction === 'asc' ? ['zero', 'recorded', 'unknown'] : ['recorded', 'zero', 'unknown']);
    expect(rows.map(row => row.sourceAgent)).toEqual(['unknown', 'zero', 'recorded']);
  });
  it('sorts provider/source names as strings, not NaN, and keeps the original default order', () => {
    const rows = [group('Zulu'), group('Alpha'), group('Other', { provider: 'claude' })];
    expect(sortOverviewRows(rows, { key: 'provider', direction: 'asc' }).map(row => row.sourceAgent)).toEqual(['Other', 'Alpha', 'Zulu']);
    expect(sortOverviewRows(rows, null)).toEqual(rows);
  });
  it('matches the exact scan group, orders newest first with stable ties, caps10 and never alters the shared index', () => {
    const sessions = [
      index('wrong-group', 'B'), index('wrong-source', 'A', { dataSource: 'proxy' }),
      index('wrong-provider', 'A', { provider: 'claude' }),
      ...Array.from({ length: 12 }, (_, n) => index(`a-${String(n).padStart(2, '0')}`, 'A', { startedAt: `2026-10-${String(n + 1).padStart(2, '0')}T00:00:00.000Z` })),
    ];
    const ids = sessions.map(row => row.id);
    expect(recentOverviewSessions(group('A'), sessions).map(row => row.id)).toEqual(['a-11', 'a-10', 'a-09', 'a-08', 'a-07', 'a-06', 'a-05', 'a-04', 'a-03', 'a-02']);
    expect(sessions.map(row => row.id)).toEqual(ids);
  });
  it('builds bounded projections for the available groups only, with deterministic equal-time ordering', () => {
    const rows = [group('A'), group('B')];
    const sessions = [index('z', 'A'), index('b', 'B'), index('a', 'A'), index('ignored', 'Other')];
    const grouped = groupRecentOverviewSessions(rows, sessions);
    expect(grouped.size).toBe(2);
    expect(grouped.get(overviewGroupKey(rows[0]!))?.map(row => row.id)).toEqual(['a', 'z']);
    expect(grouped.get(overviewGroupKey(rows[1]!))?.map(row => row.id)).toEqual(['b']);
  });
});
