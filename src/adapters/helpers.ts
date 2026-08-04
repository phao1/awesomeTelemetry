import type {
  TokenSemantics,
  TokenUsage,
  TraceEvent,
  TraceEventRaw,
  TraceStatus,
} from '../core/trace-types.js';

/** adapter 产出的 event：slim/full 字段 + 独立 raw（G11.10），由 scanner 写入 event_raw。 */
export type EventWithRaw = TraceEvent | TraceEventRaw;

/** REQ-010：状态归一化表。 */
const STATUS_MAP: Record<string, TraceStatus> = {
  completed: 'success',
  done: 'success',
  finished: 'success',
  ok: 'success',
  success: 'success',
  failed: 'error',
  error: 'error',
  exception: 'error',
  running: 'running',
  in_progress: 'running',
  paused: 'running',
  pending: 'running',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  aborted: 'cancelled',
  interrupted: 'cancelled',
};

export function normalizeStatus(raw: string | null | undefined): TraceStatus {
  if (raw === null || raw === undefined) {
    return 'unknown';
  }
  const key = raw.trim().toLowerCase();
  return STATUS_MAP[key] ?? 'unknown';
}

/** REQ-003：title 上限 200 字符。 */
export function truncateTitle(title: string, max = 200): string {
  return title.length <= max ? title : title.slice(0, max);
}

export function toIsoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** REQ-006：Trae 秒级时间戳 ×1000 转 ISO。 */
export function toIsoFromSeconds(s: number): string {
  return new Date(Math.round(s * 1000)).toISOString();
}

export function minMaxIso(events: TraceEvent[]): { startedAt: string; updatedAt: string } {
  let startedAt: string | null = null;
  let updatedAt: string | null = null;
  for (const e of events) {
    if (startedAt === null || e.startedAt < startedAt) {
      startedAt = e.startedAt;
    }
    if (updatedAt === null || e.startedAt > updatedAt) {
      updatedAt = e.startedAt;
    }
  }
  return {
    startedAt: startedAt ?? new Date(0).toISOString(),
    updatedAt: updatedAt ?? new Date(0).toISOString(),
  };
}

/** G4.6：总时长用 wall-clock，不用 duration 求和。 */
export function wallClockDurationMs(events: TraceEvent[]): number {
  if (events.length === 0) {
    return 0;
  }
  if (events.length === 1) {
    return events[0]!.durationMs;
  }
  const first = Date.parse(events[0]!.startedAt);
  const last = Date.parse(events.at(-1)!.startedAt);
  return Math.max(0, last - first);
}

/**
 * G4.4/G4.5：会话级 token 聚合。
 * - cacheRead：cumulative → Math.max，incremental → sum
 * - reasoning：恒 sum
 * - total = input + output + reasoning + cacheRead（不含 cacheWrite）
 */
export function aggregateTokenUsage(
  events: TraceEvent[],
  semantics: TokenSemantics,
): TokenUsage {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const event of events) {
    if (event.tokens === null) {
      continue;
    }
    input += event.tokens.input;
    output += event.tokens.output;
    reasoning += event.tokens.reasoning;
    cacheWrite += event.tokens.cacheWrite;
    if (semantics.cacheRead === 'cumulative') {
      cacheRead = Math.max(cacheRead, event.tokens.cacheRead);
    } else {
      cacheRead += event.tokens.cacheRead;
    }
  }
  return { input, output, reasoning, cacheRead, cacheWrite, total: input + output + reasoning + cacheRead };
}

/** G4.8 / REQ-012：同 session 内重复 event id 追加 :{sequence} 后缀。 */
export function dedupeEventIds(events: TraceEvent[]): TraceEvent[] {
  const seen = new Map<string, number>();
  return events.map((event) => {
    const count = seen.get(event.id) ?? 0;
    seen.set(event.id, count + 1);
    return count === 0 ? event : { ...event, id: `${event.id}:${event.sequence}` };
  });
}

/** 按 startedAt 稳定排序，保证 sequence 连续且 phase 两遍算法按时间序工作。 */
export function orderEventsByTime(events: TraceEvent[]): TraceEvent[] {
  return events
    .slice()
    .sort((a, b) =>
      a.startedAt === b.startedAt ? a.sequence - b.sequence : a.startedAt < b.startedAt ? -1 : 1,
    )
    .map((event, index) => ({ ...event, sequence: index + 1 }));
}

/** OpenCode 系 subagent 标题检测（G9.3）。 */
export function isSubagentTitle(title: string): boolean {
  return /\(@.*\bsubagent\)/i.test(title);
}

/** 从文本取单行标题并截断。 */
export function titleFromText(text: string | null | undefined, max = 200): string {
  const firstLine = (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return truncateTitle(firstLine ?? '', max);
}
