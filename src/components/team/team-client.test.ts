import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TEAM_HASH,
  parseTeamHash,
  serializeTeamHash,
  serializeTeamViewHash,
  teamApi,
  TEAM_PANELS,
  type TeamHashState,
} from './team-client.js';

// ── fetch 桩：记录调用 URL，返回空 200 ──────────────────────
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(`${init?.method ?? 'GET'} ${url}`);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [], nextCursor: null, hasMore: false, total: 0 }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════
// §7.1 hash-state 往返
// ════════════════════════════════════════════════════════════════════

describe('team hash-state 往返', () => {
  it('默认状态序列化为空串，解析空串得默认状态', () => {
    expect(serializeTeamHash(DEFAULT_TEAM_HASH)).toBe('');
    expect(parseTeamHash('')).toEqual(DEFAULT_TEAM_HASH);
  });

  it('serializeTeamViewHash 产生 #/team 前缀', () => {
    expect(serializeTeamViewHash(DEFAULT_TEAM_HASH)).toBe('#/team');
    const state: TeamHashState = {
      ...DEFAULT_TEAM_HASH,
      runId: 'run-1',
      panel: 'tasks',
    };
    expect(serializeTeamViewHash(state)).toBe('#/team?runId=run-1&panel=tasks');
  });

  it('runId + panel 往返', () => {
    const state: TeamHashState = {
      ...DEFAULT_TEAM_HASH,
      runId: 'team-abc',
      panel: 'ledger',
    };
    const query = serializeTeamHash(state);
    expect(query).toBe('runId=team-abc&panel=ledger');
    expect(parseTeamHash(query)).toEqual(state);
  });

  it('tagged-union selection 往返（sel=kind:id）', () => {
    const state: TeamHashState = {
      ...DEFAULT_TEAM_HASH,
      runId: 'r1',
      selection: { kind: 'task', id: 't-3' },
    };
    const query = serializeTeamHash(state);
    expect(query).toContain('sel=task%3At-3');
    const parsed = parseTeamHash(query);
    expect(parsed.selection).toEqual({ kind: 'task', id: 't-3' });
  });

  it('selection 所有 kind 往返', () => {
    const kinds = ['agent', 'task', 'round', 'activity', 'message', 'artifact', 'edge'] as const;
    for (const kind of kinds) {
      const state: TeamHashState = {
        ...DEFAULT_TEAM_HASH,
        selection: { kind, id: 'x-1' },
      };
      const parsed = parseTeamHash(serializeTeamHash(state));
      expect(parsed.selection).toEqual({ kind, id: 'x-1' });
    }
  });

  it('compare left/right/manualBasis 往返', () => {
    const state: TeamHashState = {
      ...DEFAULT_TEAM_HASH,
      compareLeft: 'run-a',
      compareRight: 'run-b',
      compareManualBasis: true,
    };
    const query = serializeTeamHash(state);
    expect(query).toContain('cmpLeft=run-a');
    expect(query).toContain('cmpRight=run-b');
    expect(query).toContain('cmpManual=1');
    expect(parseTeamHash(query)).toEqual(state);
  });

  it('列表过滤 provider/status/topology/completeness/q/range 往返', () => {
    // TeamRunStatus = planned|running|blocked|success|error|cancelled|unknown
    // （trace-types.ts §12.1；provider 原生 completed 由 adapter 归一化为 success）
    const state: TeamHashState = {
      ...DEFAULT_TEAM_HASH,
      provider: ['codex', 'claude'],
      status: ['running', 'success'],
      topology: ['two_level', 'hybrid'],
      completeness: ['complete', 'partial'],
      q: 'fix build',
      range: '7d',
    };
    const query = serializeTeamHash(state);
    const parsed = parseTeamHash(query);
    expect(parsed.provider).toEqual(['codex', 'claude']);
    expect(parsed.status).toEqual(['running', 'success']);
    expect(parsed.topology).toEqual(['two_level', 'hybrid']);
    expect(parsed.completeness).toEqual(['complete', 'partial']);
    expect(parsed.q).toBe('fix build');
    expect(parsed.range).toBe('7d');
  });

  it('body/raw/invalid/deleted activity ids 往返', () => {
    const state: TeamHashState = {
      ...DEFAULT_TEAM_HASH,
      bodyActivityId: 'act-1',
      rawActivityId: 'act-2',
      invalidRunId: 'bad-run',
      deletedRunId: 'gone-run',
    };
    const query = serializeTeamHash(state);
    expect(query).toContain('body=act-1');
    expect(query).toContain('raw=act-2');
    expect(query).toContain('invalid=bad-run');
    expect(query).toContain('deleted=gone-run');
    expect(parseTeamHash(query)).toEqual(state);
  });

  it('全状态往返不丢字段', () => {
    const state: TeamHashState = {
      runId: 'r-full',
      panel: 'compare',
      selection: { kind: 'agent', id: 'a-1' },
      compareLeft: 'cl',
      compareRight: 'cr',
      compareManualBasis: true,
      provider: ['codex'],
      status: ['running'],
      topology: ['peer_graph'],
      completeness: ['unavailable'],
      q: 'search term',
      range: '30d',
      bodyActivityId: 'b-1',
      rawActivityId: 'rw-1',
      invalidRunId: 'inv',
      deletedRunId: 'del',
    };
    const roundTrip = parseTeamHash(serializeTeamHash(state));
    expect(roundTrip).toEqual(state);
  });
});

// ════════════════════════════════════════════════════════════════════
// §7.1 脏 hash 回落
// ════════════════════════════════════════════════════════════════════

describe('team hash-state 脏值回落', () => {
  it('非法 panel 回落 topology', () => {
    expect(parseTeamHash('panel=unknown').panel).toBe('topology');
    expect(parseTeamHash('panel=foo').panel).toBe('topology');
  });

  it('非法 selection 回落 null', () => {
    expect(parseTeamHash('sel=invalid').selection).toBeNull();
    expect(parseTeamHash('sel=foo:bar:baz').selection).toBeNull();
    expect(parseTeamHash('sel=unknownkind:id1').selection).toBeNull();
    expect(parseTeamHash('sel=agent:').selection).toBeNull();
    expect(parseTeamHash('sel=:id1').selection).toBeNull();
  });

  it('非法 range 回落 today', () => {
    expect(parseTeamHash('range=1y').range).toBe('today');
    expect(parseTeamHash('range=foo').range).toBe('today');
  });

  it('空 q 回落空串', () => {
    expect(parseTeamHash('q=').q).toBe('');
  });

  it('cmpManual 仅 "1" 为 true', () => {
    expect(parseTeamHash('cmpManual=1').compareManualBasis).toBe(true);
    expect(parseTeamHash('cmpManual=0').compareManualBasis).toBe(false);
    expect(parseTeamHash('cmpManual=true').compareManualBasis).toBe(false);
  });

  it('未知键被忽略', () => {
    const parsed = parseTeamHash('unknownKey=value&runId=r1');
    expect(parsed.runId).toBe('r1');
    expect(parsed).not.toHaveProperty('unknownKey');
  });

  it('不抛错（robustness）', () => {
    expect(() => parseTeamHash('')).not.toThrow();
    expect(() => parseTeamHash('???')).not.toThrow();
    expect(() => parseTeamHash('panel=')).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════
// §7.1 空值省略
// ════════════════════════════════════════════════════════════════════

describe('team hash-state 空值省略', () => {
  it('null runId 不输出', () => {
    expect(serializeTeamHash(DEFAULT_TEAM_HASH)).not.toContain('runId');
  });

  it('topology panel 不输出（缺省）', () => {
    expect(serializeTeamHash({ ...DEFAULT_TEAM_HASH, panel: 'topology' })).not.toContain('panel');
  });

  it('today range 不输出（缺省）', () => {
    expect(serializeTeamHash({ ...DEFAULT_TEAM_HASH, range: 'today' })).not.toContain('range');
  });

  it('空数组不输出', () => {
    const query = serializeTeamHash({
      ...DEFAULT_TEAM_HASH,
      provider: [],
      status: [],
    });
    expect(query).not.toContain('provider');
    expect(query).not.toContain('status');
  });

  it('false compareManualBasis 不输出', () => {
    expect(serializeTeamHash(DEFAULT_TEAM_HASH)).not.toContain('cmpManual');
  });
});

// ════════════════════════════════════════════════════════════════════
// §7.2 TEAM_PANELS 常量
// ════════════════════════════════════════════════════════════════════

describe('TEAM_PANELS', () => {
  it('七视图齐全', () => {
    expect(TEAM_PANELS).toHaveLength(7);
    expect(TEAM_PANELS).toEqual([
      'topology',
      'tasks',
      'timeline',
      'communication',
      'ledger',
      'inspector',
      'compare',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// §7.2 teamApi 调用路径
// ════════════════════════════════════════════════════════════════════

describe('teamApi 调用路径', () => {
  it('listRuns → GET /api/team-runs 带默认 limit=50', async () => {
    await teamApi.listRuns();
    expect(fetchCalls.some((c) => c === 'GET /api/team-runs?limit=50')).toBe(true);
  });

  it('listRuns 带 provider/status/q 参数', async () => {
    await teamApi.listRuns({
      provider: ['codex', 'claude'],
      status: ['running'],
      q: 'fix',
      range: '7d',
    });
    expect(
      fetchCalls.some(
        (c) =>
          c.startsWith('GET /api/team-runs?') &&
          c.includes('provider=codex%2Cclaude') &&
          c.includes('status=running') &&
          c.includes('q=fix') &&
          c.includes('range=7d'),
      ),
    ).toBe(true);
  });

  it('listRuns cursor keyset 分页', async () => {
    await teamApi.listRuns({ cursor: 'abc' });
    expect(fetchCalls.some((c) => c.includes('cursor=abc'))).toBe(true);
  });

  it('runSnapshot → GET /api/team-runs/:runId', async () => {
    await teamApi.runSnapshot('r-1');
    expect(fetchCalls.some((c) => c === 'GET /api/team-runs/r-1')).toBe(true);
  });

  it('runSnapshot 对 runId 做 encodeURIComponent', async () => {
    await teamApi.runSnapshot('r/special');
    expect(fetchCalls.some((c) => c.includes('/team-runs/r%2Fspecial'))).toBe(true);
  });

  it('listActivities → GET /api/team-runs/:runId/activities 带默认 limit=200', async () => {
    await teamApi.listActivities('r-1');
    expect(
      fetchCalls.some((c) => c === 'GET /api/team-runs/r-1/activities?limit=200'),
    ).toBe(true);
  });

  it('activityDetail 默认 slim（无 include 参数）', async () => {
    await teamApi.activityDetail('r-1', 'a-1');
    expect(fetchCalls.some((c) => c === 'GET /api/team-runs/r-1/activities/a-1')).toBe(true);
  });

  it('activityDetail include=body', async () => {
    await teamApi.activityDetail('r-1', 'a-1', 'body');
    expect(fetchCalls.some((c) => c.includes('include=body'))).toBe(true);
  });

  it('activityDetail include=raw', async () => {
    await teamApi.activityDetail('r-1', 'a-1', 'raw');
    expect(fetchCalls.some((c) => c.includes('include=raw'))).toBe(true);
  });

  it('patch → GET /api/team-runs/:runId/patch?stamp=', async () => {
    await teamApi.patch('r-1', 'stamp-123');
    expect(
      fetchCalls.some((c) => c === 'GET /api/team-runs/r-1/patch?stamp=stamp-123'),
    ).toBe(true);
  });

  it('compare → POST /api/team-compare', async () => {
    await teamApi.compare({ leftRunId: 'a', rightRunId: 'b' });
    expect(fetchCalls.some((c) => c === 'POST /api/team-compare')).toBe(true);
  });

  it('compare 带 manualBasis', async () => {
    await teamApi.compare({ leftRunId: 'a', rightRunId: 'b', manualBasis: true });
    expect(fetchCalls.some((c) => c === 'POST /api/team-compare')).toBe(true);
  });

  it('deleteRun → DELETE /api/team-runs/:runId', async () => {
    await teamApi.deleteRun('r-1');
    expect(fetchCalls.some((c) => c === 'DELETE /api/team-runs/r-1')).toBe(true);
  });
});
