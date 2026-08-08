import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  SessionDetailResponse,
  SessionIndexEntry,
  TraceSession,
} from '../../src/core/trace-types.js';
import {
  buildSubagentMergeGroups,
  buildGroupLookup,
  clearSessionGroupsCache,
  getMergeGroup,
  loadSessionGroups,
  mergeSessionDetail,
  mergeSessionIndex,
  primaryKeyFor,
  type SessionMergeGroup,
} from './session-merge.js';

const GROUP: SessionMergeGroup = {
  id: 'g1',
  primaryKey: 's-main',
  title: '合并会话',
  sourceAgent: 'codearts',
  mergedKeys: ['s-sub-1', 's-sub-2'],
  reason: 'SDD 子会话',
};

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-merge-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  clearSessionGroupsCache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function index(id: string, over: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    id,
    provider: 'codearts',
    sourceAgent: 'codearts',
    title: `t ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: null,
    eventCount: 1,
    messageCount: 1,
    tokenTotal: 10,
    costUsd: 0.01,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    detailLoaded: true,
    mergeGroupId: null,
    hasSystemPrompt: false,
    tags: [],
    ...over,
  };
}

function session(id: string, over: Partial<TraceSession> = {}): TraceSession {
  return {
    id,
    provider: 'codearts',
    sourceAgent: 'codearts',
    title: `t ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: null,
    messageCount: 1,
    eventCount: 1,
    tokenUsage: { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 5, total: 10 },
    costUsd: 0.01,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    totalDurationMs: 60_000,
    isSubagent: false,
    ...over,
  };
}

function detail(
  sessionId: string,
  events: Array<{ id: string; startedAt: string; sequence: number }>,
  over: Partial<SessionDetailResponse> = {},
): SessionDetailResponse {
  return {
    session: session(sessionId),
    events: events.map((e) => ({
      id: e.id,
      sessionId,
      sequence: e.sequence,
      // fix-adapter-turn-semantics 5.5：slim 事件契约新增必填 turnKey。
      turnKey: null,
      kind: 'llm',
      phase: 'implement',
      title: '',
      startedAt: e.startedAt,
      durationMs: 0,
      status: 'success',
      actor: 'assistant',
      tool: null,
      tokens: null,
      error: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: true,
    })),
    mode: 'slim',
    eventTotal: events.length,
    eventOffset: 0,
    eventLimit: events.length,
    hasMore: false,
    pending: false,
    ...over,
  };
}

describe('REQ-003 session-groups 加载', () => {
  it('缺失文件返回空组', () => {
    expect(loadSessionGroups(tempDir())).toEqual([]);
  });

  it('读取配置且按 mtime 缓存', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'session-groups.json'),
      JSON.stringify({ groups: [GROUP] }),
      'utf8',
    );
    expect(loadSessionGroups(dir)).toEqual([GROUP]);
    // 命中缓存（文件未变）
    expect(loadSessionGroups(dir)).toEqual([GROUP]);
    // 文件变更后重读
    writeFileSync(join(dir, 'session-groups.json'), JSON.stringify({ groups: [] }), 'utf8');
    expect(loadSessionGroups(dir)).toEqual([]);
  });
});

describe('REQ-004/008/009 反向查找', () => {
  it('getMergeGroup / primaryKeyFor', () => {
    const lookup = buildGroupLookup([GROUP]);
    expect(lookup.get('s-main')?.id).toBe('g1');
    expect(lookup.get('s-sub-2')?.id).toBe('g1');
    expect(getMergeGroup('s-main', [GROUP])?.id).toBe('g1');
    expect(getMergeGroup('other', [GROUP])).toBeNull();
    expect(primaryKeyFor('s-sub-1', [GROUP])).toBe('s-main');
    expect(primaryKeyFor('other', [GROUP])).toBe('other');
  });
});

describe('REQ-005 索引合并', () => {
  it('同组会话替换为单条目：计数求和、时间取极值、mergeGroupId 置位', () => {
    const result = mergeSessionIndex(
      [
        index('s-sub-1', { startedAt: '2026-08-01T00:00:10.000Z', eventCount: 3, messageCount: 2, tokenTotal: 10, costUsd: 0.01 }),
        index('s-main', { startedAt: '2026-08-01T00:00:20.000Z', eventCount: 5, messageCount: 4, tokenTotal: 30, costUsd: 0.03 }),
        index('other', { provider: 'claude', sourceAgent: 'Claude' }),
        index('s-sub-2', { startedAt: '2026-08-01T00:00:30.000Z', updatedAt: '2026-08-01T00:05:00.000Z', eventCount: 7, messageCount: 6, tokenTotal: 10, costUsd: 0.01 }),
      ],
      [GROUP],
    );
    const merged = result.find((r) => r.id === 's-main');
    expect(merged?.mergeGroupId).toBe('g1');
    expect(merged?.title).toBe('合并会话');
    expect(merged?.eventCount).toBe(15);
    expect(merged?.messageCount).toBe(12);
    expect(merged?.tokenTotal).toBe(50);
    expect(merged?.costUsd).toBeCloseTo(0.05);
    expect(merged?.startedAt).toBe('2026-08-01T00:00:10.000Z'); // 最早
    expect(merged?.updatedAt).toBe('2026-08-01T00:05:00.000Z'); // 最晚
    expect(result.map((r) => r.id).sort()).toEqual(['other', 's-main']);
  });

  it('主会话缺失时以组内首个成员为底座', () => {
    const result = mergeSessionIndex([index('s-sub-1', { eventCount: 2 })], [GROUP]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('s-main');
    expect(result[0]?.eventCount).toBe(2);
  });

  it('无组配置时原样返回', () => {
    const entries = [index('a'), index('b')];
    expect(mergeSessionIndex(entries, [])).toEqual(entries);
  });
});

describe('REQ-006/007 详情合并', () => {
  it('events 重排、sequence 重编号、token 求和', async () => {
    const fetched = new Map<string, SessionDetailResponse>([
      [
        's-main',
        detail('s-main', [
          { id: 'm2', startedAt: '2026-08-01T00:00:20.000Z', sequence: 2 },
          { id: 'm1', startedAt: '2026-08-01T00:00:10.000Z', sequence: 1 },
        ]),
      ],
      [
        's-sub-1',
        detail(
          's-sub-1',
          [{ id: 's1', startedAt: '2026-08-01T00:00:05.000Z', sequence: 1 }],
          { session: session('s-sub-1', { startedAt: '2026-08-01T00:00:05.000Z' }) },
        ),
      ],
    ]);
    const merged = await mergeSessionDetail(
      's-main',
      async (key) => fetched.get(key) ?? null,
      [GROUP],
    );
    expect(merged).not.toBeNull();
    expect(merged!.session.id).toBe('s-main');
    expect(merged!.session.eventCount).toBe(2);
    expect(merged!.session.tokenUsage.total).toBe(20);
    expect(merged!.session.startedAt).toBe('2026-08-01T00:00:05.000Z'); // 事件最早
    expect(merged!.session.updatedAt).toBe('2026-08-01T00:00:20.000Z'); // 事件最晚
    expect(merged!.events.map((e) => e.id)).toEqual(['s1', 'm1', 'm2']);
    expect(merged!.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('分页在合并后的完整序列上做', async () => {
    const oneSub = { ...GROUP, mergedKeys: ['s-sub-1'] };
    const iso = (sec: number): string => {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      return `2026-08-01T00:${mm}:${ss}.000Z`;
    };
    const eventsA = Array.from({ length: 1001 }, (_, i) => ({
      id: `a${i}`,
      startedAt: iso(i),
      sequence: i + 1,
    }));
    const eventsB = Array.from({ length: 1001 }, (_, i) => ({
      id: `b${i}`,
      startedAt: iso(i + 2000),
      sequence: i + 1,
    }));
    const merged = await mergeSessionDetail(
      's-main',
      async (key) =>
        key === 's-main'
          ? detail('s-main', eventsA)
          : detail('s-sub-1', eventsB),
      [oneSub],
      { offset: 1, limit: 2 },
    );
    expect(merged!.eventTotal).toBe(2002);
    expect(merged!.events.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(merged!.hasMore).toBe(true);
  });

  it('非主键调用原样返回单会话', async () => {
    const d = detail('other', [{ id: 'x', startedAt: '2026-08-01T00:00:00.000Z', sequence: 1 }]);
    const merged = await mergeSessionDetail('other', async () => d, [GROUP]);
    expect(merged).toEqual(d);
  });
});

describe('F1-4 自动 subagent 归属（add-mission-control §7.7）', () => {
  it('subagent 会话归入同 provider 时间窗内的父会话，reason 标注 auto', () => {
    const groups = buildSubagentMergeGroups([
      { id: 'parent', provider: 'claude', title: 'Main task', sourceAgent: 'Claude', startedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:30:00.000Z', isSubagent: false },
      { id: 'sub1', provider: 'claude', title: 'subagent (task)', sourceAgent: 'Claude', startedAt: '2026-08-01T00:05:00.000Z', updatedAt: '2026-08-01T00:10:00.000Z', isSubagent: true },
      { id: 'sub2', provider: 'claude', title: 'subagent (task)', sourceAgent: 'Claude', startedAt: '2026-08-01T00:12:00.000Z', updatedAt: '2026-08-01T00:15:00.000Z', isSubagent: true },
      { id: 'outside', provider: 'codex', title: 'Other', sourceAgent: 'Codex', startedAt: '2026-08-01T00:06:00.000Z', updatedAt: '2026-08-01T00:07:00.000Z', isSubagent: true },
      { id: 'late', provider: 'claude', title: 'subagent (task)', sourceAgent: 'Claude', startedAt: '2026-08-01T01:00:00.000Z', updatedAt: '2026-08-01T01:01:00.000Z', isSubagent: true },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primaryKey).toBe('parent');
    expect(groups[0]!.mergedKeys).toEqual(['sub1', 'sub2']);
    expect(groups[0]!.reason).toBe('auto-subagent-time-window');
  });

  it('窗口外 / 不同 provider / 无父会话时不归属', () => {
    const groups = buildSubagentMergeGroups([
      { id: 'parent', provider: 'claude', title: 't', sourceAgent: 'Claude', startedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:10:00.000Z', isSubagent: false },
      { id: 'sub-late', provider: 'claude', title: 's', sourceAgent: 'Claude', startedAt: '2026-08-01T00:11:00.000Z', updatedAt: '2026-08-01T00:12:00.000Z', isSubagent: true },
      { id: 'sub-other-prov', provider: 'codex', title: 's', sourceAgent: 'Codex', startedAt: '2026-08-01T00:01:00.000Z', updatedAt: '2026-08-01T00:02:00.000Z', isSubagent: true },
    ]);
    expect(groups).toEqual([]);
  });
});
