import type { TraceEventSlim, TracePhase } from './trace-types.js';

/**
 * ui-design-v2 §3.4 语义折叠：把噪音事件聚成有意义的块。
 * 分组规则按优先级（表 §3.4.1）先命中先生效，组不重叠。
 */
export type EventGroupType =
  | 'repair_loop'
  | 'retry_burst'
  | 'read_burst'
  | 'write_batch'
  | 'subagent';

export interface EventGroup {
  type: EventGroupType;
  /** 组 id = 组内首事件 sequence 前缀，保证稳定。 */
  id: string;
  eventIds: string[];
  start: TraceEventSlim;
  end: TraceEventSlim;
  /** 主导 phase（按组内累计时长，平局取首事件）。 */
  phase: TracePhase;
  /** wall-clock 跨度 = 末事件终点 − 首事件起点；全为 0 时长时回落为时长和。 */
  durationMs: number;
  /** 组内是否含失败事件（repair_loop 必然 true）。 */
  failed: boolean;
  stepCount: number;
  /** repair_loop：W→F→W 轮数（≥2）。 */
  rounds?: number;
  /** retry_burst：工具名。 */
  toolName?: string;
  /** retry_burst：失败次数。 */
  failCount?: number;
  /** write_batch：共同目录。 */
  dirName?: string;
  /** subagent：子 Agent 首条事件标题。 */
  subTitle?: string;
}

export type GanttRow =
  | { kind: 'event'; event: TraceEventSlim }
  | { kind: 'group'; group: EventGroup };

/** 从事件标题提取文件路径（工具标题如 "Edit src/auth/jwt.ts" / "ruoyi/.../dashboard.html"）。 */
const PATH_RE =
  /([\w@./-]+\.(?:html|graphql|svelte|tsx|jsonl|scss|yaml|yml|toml|mdx|proto|mjs|cjs|ts|jsx|js|py|rs|go|java|kt|swift|cpp|cc|hpp|css|less|json|php|sql|vue|h|c|rb|sh|zsh|bash|ps1|md|txt))/i;

export function extractPath(title: string): string | null {
  const match = PATH_RE.exec(title);
  return match === null ? null : match[1]!;
}

export function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '' : path.slice(0, index);
}

const WRITE_TOOLS = new Set(['write', 'edit', 'todowrite', 'apply_patch', 'patch']);
const WRITE_TITLE_RE = /^(edit|write|create|delete|apply_patch|patch)\b/i;

/** Write/Edit 判定：kind 优先，title 前缀兜底（部分 adapter 只给 tool kind + 标题）。 */
export function isWriteEventLike(e: TraceEventSlim): boolean {
  if (e.kind === 'file_write') {
    return true;
  }
  if (e.kind === 'tool' && e.tool !== null && WRITE_TOOLS.has(e.tool.toLowerCase())) {
    return true;
  }
  return e.kind === 'tool' && WRITE_TITLE_RE.test(e.title);
}

/** Read/Glob/Grep 判定。 */
export function isReadEventLike(e: TraceEventSlim): boolean {
  return e.kind === 'file_read';
}

function isFailCheck(e: TraceEventSlim | undefined): boolean {
  return e !== undefined && (e.kind === 'bash' || e.kind === 'test') && e.status === 'error';
}

function toolNameOf(e: TraceEventSlim): string {
  if (e.tool !== null && e.tool !== '') {
    return e.tool.toLowerCase();
  }
  if (e.kind === 'bash') {
    return 'bash';
  }
  if (e.kind === 'test') {
    return 'test';
  }
  if (e.kind === 'file_read') {
    return 'read';
  }
  if (e.kind === 'file_write') {
    return 'write';
  }
  return e.kind;
}

function isToolish(e: TraceEventSlim): boolean {
  return (
    e.kind === 'tool' ||
    e.kind === 'bash' ||
    e.kind === 'test' ||
    e.kind === 'file_read' ||
    e.kind === 'file_write'
  );
}

interface Span {
  end: number;
}

/** 规则 1（最高优先级）：Edit/Write → 失败的 Bash/Test → Edit/Write，≥2 轮。 */
function detectRepairLoop(events: TraceEventSlim[], start: number): { rounds: number } & Span | null {
  if (!isWriteEventLike(events[start]!)) {
    return null;
  }
  let cursor = start;
  let rounds = 0;
  while (cursor + 2 < events.length) {
    if (isFailCheck(events[cursor + 1]) && isWriteEventLike(events[cursor + 2]!)) {
      rounds += 1;
      cursor += 2;
    } else {
      break;
    }
  }
  return rounds >= 2 ? { rounds, end: cursor } : null;
}

/** 规则 2：同一工具连续调用 ≥3 次且含失败。 */
function detectRetryBurst(
  events: TraceEventSlim[],
  start: number,
): { count: number; failCount: number } & Span | null {
  const first = events[start]!;
  if (!isToolish(first)) {
    return null;
  }
  const tool = toolNameOf(first);
  let cursor = start;
  let count = 0;
  let failCount = 0;
  while (cursor < events.length && isToolish(events[cursor]!) && toolNameOf(events[cursor]!) === tool) {
    count += 1;
    if (events[cursor]!.status === 'error') {
      failCount += 1;
    }
    cursor += 1;
  }
  return count >= 3 && failCount >= 1 ? { count, failCount, end: cursor - 1 } : null;
}

/** 规则 3：连续 ≥3 个 Read/Glob/Grep，中间无写操作。 */
function detectReadBurst(events: TraceEventSlim[], start: number): { count: number } & Span | null {
  if (!isReadEventLike(events[start]!)) {
    return null;
  }
  let cursor = start;
  while (cursor < events.length && isReadEventLike(events[cursor]!)) {
    cursor += 1;
  }
  const count = cursor - start;
  return count >= 3 ? { count, end: cursor - 1 } : null;
}

/** 规则 4：连续 ≥3 个 Write/Edit 命中同一目录。 */
function detectWriteBatch(events: TraceEventSlim[], start: number): { count: number; dir: string } & Span | null {
  if (!isWriteEventLike(events[start]!)) {
    return null;
  }
  let cursor = start;
  const dirs: string[] = [];
  while (cursor < events.length && isWriteEventLike(events[cursor]!)) {
    const path = extractPath(events[cursor]!.title);
    if (path === null) {
      break;
    }
    dirs.push(dirnameOf(path));
    cursor += 1;
  }
  const count = cursor - start;
  const dir = count >= 3 ? dirs[0] : undefined;
  if (count >= 3 && dir !== undefined && dirs.every((d) => d === dir)) {
    return { count, dir, end: cursor - 1 };
  }
  return null;
}

/** 规则 5：subagent_prompt 到其结束之间的全部事件。 */
function detectSubagent(events: TraceEventSlim[], start: number): { count: number } & Span | null {
  if (events[start]!.kind !== 'subagent_prompt') {
    return null;
  }
  let cursor = start + 1;
  while (cursor < events.length) {
    const kind = events[cursor]!.kind;
    if (kind === 'user_prompt' || kind === 'message' || kind === 'subagent_prompt') {
      break;
    }
    cursor += 1;
  }
  const count = cursor - start;
  return count >= 2 ? { count, end: cursor - 1 } : null;
}

function makeGroup(
  type: EventGroupType,
  events: TraceEventSlim[],
  startIndex: number,
  endIndex: number,
  extra: Partial<EventGroup>,
): EventGroup {
  const members = events.slice(startIndex, endIndex + 1);
  const start = members[0]!;
  const end = members[members.length - 1]!;
  const wall = Date.parse(end.startedAt) + end.durationMs - Date.parse(start.startedAt);
  const sum = members.reduce((total, e) => total + e.durationMs, 0);
  const durationMs = wall > 0 ? wall : sum;
  const byPhase = new Map<TracePhase, number>();
  for (const e of members) {
    byPhase.set(e.phase, (byPhase.get(e.phase) ?? 0) + e.durationMs);
  }
  let phase = start.phase;
  let max = -1;
  for (const [candidate, ms] of byPhase) {
    if (ms > max) {
      max = ms;
      phase = candidate;
    }
  }
  return {
    type,
    id: `group-${start.sequence}`,
    eventIds: members.map((e) => e.id),
    start,
    end,
    phase,
    durationMs,
    failed: members.some((e) => e.status === 'error'),
    stepCount: members.length,
    ...extra,
  };
}

/** 按规则优先级把事件流折叠成分组树（平铺 GanttRow 列表，组件层负责展开/折叠）。 */
export function groupEvents(events: TraceEventSlim[]): GanttRow[] {
  const rows: GanttRow[] = [];
  let i = 0;
  while (i < events.length) {
    const repair = detectRepairLoop(events, i);
    const retry = repair === null ? detectRetryBurst(events, i) : null;
    const read = repair === null && retry === null ? detectReadBurst(events, i) : null;
    const write =
      repair === null && retry === null && read === null ? detectWriteBatch(events, i) : null;
    const sub =
      repair === null && retry === null && read === null && write === null
        ? detectSubagent(events, i)
        : null;

    if (repair !== null) {
      rows.push({
        kind: 'group',
        group: makeGroup('repair_loop', events, i, repair.end, { rounds: repair.rounds }),
      });
      i = repair.end + 1;
    } else if (retry !== null) {
      rows.push({
        kind: 'group',
        group: makeGroup('retry_burst', events, i, retry.end, {
          toolName: toolNameOf(events[i]!),
          failCount: retry.failCount,
        }),
      });
      i = retry.end + 1;
    } else if (read !== null) {
      rows.push({
        kind: 'group',
        group: makeGroup('read_burst', events, i, read.end, {}),
      });
      i = read.end + 1;
    } else if (write !== null) {
      rows.push({
        kind: 'group',
        group: makeGroup('write_batch', events, i, write.end, { dirName: write.dir }),
      });
      i = write.end + 1;
    } else if (sub !== null) {
      rows.push({
        kind: 'group',
        group: makeGroup('subagent', events, i, sub.end, { subTitle: events[i]!.title }),
      });
      i = sub.end + 1;
    } else {
      rows.push({ kind: 'event', event: events[i]! });
      i += 1;
    }
  }
  return rows;
}
