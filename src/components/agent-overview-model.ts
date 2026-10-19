import type { AgentOverviewRow, SessionIndexEntry } from '../core/trace-types.js';

export interface OverviewSort {
  key: string;
  direction: 'asc' | 'desc';
}

export function overviewGroupKey(row: Pick<AgentOverviewRow, 'provider' | 'sourceAgent'>): string {
  return JSON.stringify([row.provider, row.sourceAgent]);
}

/** Only additive source counts. Eligible denominators for group means are absent. */
export function overviewTotals(rows: AgentOverviewRow[]): { sessions: number; events: number; tokens: number; groups: number } {
  return rows.reduce((total, row) => ({
    sessions: total.sessions + row.sessionCount,
    events: total.events + row.eventCount,
    tokens: total.tokens + row.tokenTotal,
    groups: total.groups + 1,
  }), { sessions: 0, events: 0, tokens: 0, groups: 0 });
}

export function sortOverviewRows(rows: AgentOverviewRow[], sort: OverviewSort | null): AgentOverviewRow[] {
  if (sort === null) return rows;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'provider') {
      return (a.provider.localeCompare(b.provider) || a.sourceAgent.localeCompare(b.sourceAgent)) * direction;
    }
    const av = a[sort.key as keyof AgentOverviewRow];
    const bv = b[sort.key as keyof AgentOverviewRow];
    const an = typeof av === 'number' && Number.isFinite(av) ? av : null;
    const bn = typeof bv === 'number' && Number.isFinite(bv) ? bv : null;
    if (an === null || bn === null) return an === bn ? 0 : an === null ? 1 : -1;
    return (an - bn) * direction;
  });
}

/** This is a bounded projection, not a second index or a claim about global recency. */
export function recentOverviewSessions(row: Pick<AgentOverviewRow, 'provider' | 'sourceAgent'>, sessions: SessionIndexEntry[]): SessionIndexEntry[] {
  return groupRecentOverviewSessions([row], sessions).get(overviewGroupKey(row)) ?? [];
}

/** Sort the shared metadata once, not once per rendered group. Keep at most10 refs/group. */
export function groupRecentOverviewSessions(rows: Array<Pick<AgentOverviewRow, 'provider' | 'sourceAgent'>>, sessions: SessionIndexEntry[]): Map<string, SessionIndexEntry[]> {
  const groups = new Map(rows.map(row => [overviewGroupKey(row), [] as SessionIndexEntry[]]));
  for (const session of [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id))) {
    if (session.dataSource !== 'scan') continue;
    const group = groups.get(overviewGroupKey(session));
    if (group !== undefined && group.length < 10) group.push(session);
  }
  return groups;
}
