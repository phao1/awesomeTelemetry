import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type {
  SessionDetailResponse,
  SessionIndexEntry,
  TraceSession,
} from '../../src/core/trace-types.js';

/**
 * #17（审查 P3）：会话合并（specs/session-merge）。
 * 合并组由 config/session-groups.json（gitignored）驱动，不做自动检测（G10.3）。
 * 纯函数部分（mergeSessionIndex / mergeSessionDetail）与 IO（loadSessionGroups）
 * 分离，便于测试。
 */

export interface SessionMergeGroup {
  id: string;
  primaryKey: string;
  title: string;
  sourceAgent: string;
  mergedKeys: string[];
  reason: string;
}

export interface SessionGroupsConfig {
  groups: SessionMergeGroup[];
}

let cache: { configRoot: string; mtimeMs: number; groups: SessionMergeGroup[] } | null = null;

/** REQ-003：按 mtime 缓存加载 session-groups.json；文件缺失返回空组。 */
export function loadSessionGroups(configRoot: string): SessionMergeGroup[] {
  const file = join(configRoot, 'session-groups.json');
  if (!existsSync(file)) {
    return [];
  }
  const st = statSync(file);
  if (cache !== null && cache.configRoot === configRoot && cache.mtimeMs === st.mtimeMs) {
    return cache.groups;
  }
  let parsed: SessionGroupsConfig;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as SessionGroupsConfig;
  } catch {
    return [];
  }
  const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
  cache = { configRoot, mtimeMs: st.mtimeMs, groups };
  return groups;
}

export function clearSessionGroupsCache(): void {
  cache = null;
}

/** F1-4 自动归属（add-mission-control §7.7）：subagent 候选的最小形状。 */
export interface SubagentCandidate {
  id: string;
  provider: string;
  title: string;
  sourceAgent: string;
  startedAt: string;
  updatedAt: string;
  isSubagent: boolean;
}

/**
 * F1-4：按「Task/Agent 工具调用时间窗 + isSubagent 匹配」自动归属。
 * subagent 会话归入同 provider、非 subagent、且 startedAt 落在
 * [parent.startedAt, parent.updatedAt] 窗口内的父会话；返回可补充手工
 * session-groups.json 的合并组（reason = auto-subagent-time-window）。
 */
export function buildSubagentMergeGroups(entries: SubagentCandidate[]): SessionMergeGroup[] {
  const parents = entries
    .filter((e) => !e.isSubagent)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const groups: SessionMergeGroup[] = [];
  const byParent = new Map<string, SessionMergeGroup>();
  for (const sub of entries) {
    if (!sub.isSubagent) {
      continue;
    }
    const parent = parents.find(
      (p) =>
        p.provider === sub.provider &&
        p.id !== sub.id &&
        sub.startedAt >= p.startedAt &&
        sub.startedAt <= p.updatedAt,
    );
    if (parent === undefined) {
      continue;
    }
    let group = byParent.get(parent.id);
    if (group === undefined) {
      group = {
        id: `${parent.id}:auto-subagents`,
        primaryKey: parent.id,
        title: parent.title,
        sourceAgent: parent.sourceAgent,
        mergedKeys: [],
        reason: 'auto-subagent-time-window',
      };
      groups.push(group);
      byParent.set(parent.id, group);
    }
    group.mergedKeys.push(sub.id);
  }
  return groups;
}

/** REQ-004：traceId（primaryKey + mergedKeys）→ 合并组反向映射。 */
export function buildGroupLookup(groups: SessionMergeGroup[]): Map<string, SessionMergeGroup> {
  const lookup = new Map<string, SessionMergeGroup>();
  for (const group of groups) {
    lookup.set(group.primaryKey, group);
    for (const key of group.mergedKeys) {
      lookup.set(key, group);
    }
  }
  return lookup;
}

/** REQ-008：key 是否属于某合并组（primaryKey 或 mergedKeys 命中即 true）。 */
export function getMergeGroup(key: string, groups: SessionMergeGroup[]): SessionMergeGroup | null {
  return buildGroupLookup(groups).get(key) ?? null;
}

/** REQ-009：任意成员 key → 组的 primaryKey（用于 SSE 通知与详情定位）。 */
export function primaryKeyFor(key: string, groups: SessionMergeGroup[]): string {
  return getMergeGroup(key, groups)?.primaryKey ?? key;
}

/**
 * REQ-005：索引合并。同组会话替换为单条目：
 * eventCount/messageCount/tokenTotal/costUsd 求和，startedAt 最早，updatedAt 最晚，
 * mergeGroupId 置组 id。主会话缺失时以组内首个成员为数据底座。
 */
export function mergeSessionIndex(
  entries: SessionIndexEntry[],
  groups: SessionMergeGroup[],
): SessionIndexEntry[] {
  if (groups.length === 0) {
    return entries;
  }
  const lookup = buildGroupLookup(groups);
  const byGroup = new Map<string, SessionIndexEntry[]>();
  const standalone: SessionIndexEntry[] = [];
  for (const entry of entries) {
    const group = lookup.get(entry.id);
    if (group === undefined) {
      standalone.push(entry);
    } else {
      const list = byGroup.get(group.id) ?? [];
      list.push(entry);
      byGroup.set(group.id, list);
    }
  }

  const merged: SessionIndexEntry[] = [];
  for (const group of groups) {
    const members = byGroup.get(group.id);
    if (members === undefined || members.length === 0) {
      continue;
    }
    const primary = members.find((m) => m.id === group.primaryKey) ?? members[0]!;
    merged.push({
      ...primary,
      id: group.primaryKey,
      title: group.title !== '' ? group.title : primary.title,
      sourceAgent: group.sourceAgent !== '' ? group.sourceAgent : primary.sourceAgent,
      startedAt: members.reduce((min, m) => (m.startedAt < min ? m.startedAt : min), primary.startedAt),
      updatedAt: members.reduce((max, m) => (m.updatedAt > max ? m.updatedAt : max), primary.updatedAt),
      eventCount: members.reduce((sum, m) => sum + m.eventCount, 0),
      messageCount: members.reduce((sum, m) => sum + m.messageCount, 0),
      tokenTotal: members.reduce((sum, m) => sum + m.tokenTotal, 0),
      costUsd: members.reduce((sum, m) => sum + m.costUsd, 0),
      mergeGroupId: group.id,
      detailLoaded: members.every((m) => m.detailLoaded),
    });
  }
  return [...standalone, ...merged];
}

/**
 * REQ-006/007：详情合并。各组成会话 events 按 startedAt 重排、sequence 重编号，
 * token 总计求和；分页（offset/limit）在合并后的完整序列上做，MUST NOT 分页后拼接。
 */
export async function mergeSessionDetail(
  primaryKey: string,
  fetchDetail: (key: string) => Promise<SessionDetailResponse | null>,
  groups: SessionMergeGroup[],
  opts: { offset?: number; limit?: number } = {},
): Promise<SessionDetailResponse | null> {
  const group = getMergeGroup(primaryKey, groups);
  if (group === null || group.primaryKey !== primaryKey) {
    // 非合并组主键：原样返回
    return fetchDetail(primaryKey);
  }
  const keys = [group.primaryKey, ...group.mergedKeys];
  const details = await Promise.all(keys.map((key) => fetchDetail(key)));
  const present = details.filter((d): d is SessionDetailResponse => d !== null);
  if (present.length === 0) {
    return null;
  }
  const mode = present[0]!.mode;
  const events = present
    .flatMap((d) => d.events)
    .sort((a, b) =>
      a.startedAt === b.startedAt ? a.sequence - b.sequence : a.startedAt < b.startedAt ? -1 : 1,
    )
    .map((event, index) => ({ ...event, sequence: index + 1 }));

  const session: TraceSession = mergeSessions(present.map((d) => d.session), events, group);
  const eventTotal = events.length;
  const offset = Math.max(opts.offset ?? 0, 0);
  const limit = Math.min(Math.max(opts.limit ?? eventTotal, 1), 5000);
  const sliced =
    eventTotal <= 2000 ? events : events.slice(offset, offset + limit);
  return {
    session,
    events: sliced,
    mode,
    eventTotal,
    eventOffset: eventTotal <= 2000 ? 0 : offset,
    eventLimit: limit,
    hasMore: eventTotal <= 2000 ? false : offset + sliced.length < eventTotal,
    pending: present.some((d) => d.pending),
  };
}

function mergeSessions(
  sessions: TraceSession[],
  events: SessionDetailResponse['events'],
  group: SessionMergeGroup,
): TraceSession {
  const first = sessions[0]!;
  const tokens = sessions.reduce(
    (acc, s) => {
      acc.input += s.tokenUsage.input;
      acc.output += s.tokenUsage.output;
      acc.reasoning += s.tokenUsage.reasoning;
      acc.cacheRead += s.tokenUsage.cacheRead;
      acc.cacheWrite += s.tokenUsage.cacheWrite;
      acc.total += s.tokenUsage.total;
      return acc;
    },
    {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  );
  // G4.6：合并后的 wall-clock 以合并事件序列的起止为准。
  const startedAt =
    events.length === 0
      ? sessions.reduce((min, s) => (s.startedAt < min ? s.startedAt : min), first.startedAt)
      : events.reduce((min, e) => (e.startedAt < min ? e.startedAt : min), events[0]!.startedAt);
  const updatedAt =
    events.length === 0
      ? sessions.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), first.updatedAt)
      : events.reduce((max, e) => (e.startedAt > max ? e.startedAt : max), events[0]!.startedAt);
  const totalDurationMs = Math.max(0, Date.parse(updatedAt) - Date.parse(startedAt));
  return {
    ...first,
    id: group.primaryKey,
    title: group.title !== '' ? group.title : first.title,
    sourceAgent: group.sourceAgent !== '' ? group.sourceAgent : first.sourceAgent,
    startedAt,
    updatedAt,
    eventCount: sessions.reduce((sum, s) => sum + s.eventCount, 0),
    messageCount: sessions.reduce((sum, s) => sum + s.messageCount, 0),
    tokenUsage: tokens,
    costUsd: sessions.reduce((sum, s) => sum + s.costUsd, 0),
    totalDurationMs,
  };
}
