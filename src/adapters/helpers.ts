import type {
  TokenSemantics,
  TokenUsage,
  TraceEvent,
  TraceEventRaw,
  TraceStatus,
} from '../core/trace-types.js';
import { extractTitleFromUserText } from '../core/title-utils.js';

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

/**
 * 会话状态汇总。
 *
 * 早期各 adapter 直接取 `events.at(-1).status`，但会话最后一条往往是
 * token_count / system 这类没有状态的辅助事件，于是整个会话被判成 'unknown' ——
 * 实测 80 个会话里 73 个如此，直接让「准 / 稳」两个评测维度和状态筛选失去数据。
 * 改为按全量事件汇总：未结束的以末条为准，否则「有失败即失败，有成功即成功」。
 */
export function rollupSessionStatus(events: TraceEvent[]): TraceStatus {
  const last = events.at(-1)?.status;
  if (last === 'running' || last === 'cancelled') {
    return last;
  }
  let sawSuccess = false;
  for (const event of events) {
    if (event.status === 'error') {
      return 'error';
    }
    if (event.status === 'success') {
      sawSuccess = true;
    }
  }
  return sawSuccess ? 'success' : 'unknown';
}

/**
 * 会话标题：取第一条真实用户提问，并走 extractTitleFromUserText 净化。
 *
 * 各 adapter 此前只把 extractTitleFromUserText 当作「是不是注入内容」的判据，
 * 真正取用的却是事件自身的 title（原始首行前 200 字符）。结果是详情扫描
 * 又把索引阶段清洗好的标题覆盖成 `<command-name>/goal</command-name>` 这类原文。
 */
export function sessionTitleFromEvents(events: TraceEvent[]): string {
  for (const event of events) {
    if (event.kind !== 'user_prompt' || event.inputSummary === null) {
      continue;
    }
    const title = extractTitleFromUserText(event.inputSummary);
    if (title !== null && title !== '') {
      return title;
    }
  }
  return events.find((e) => e.kind === 'user_prompt')?.title ?? '';
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
 * G4.4/G4.5（2026-08-03 校准后）：会话级 token 聚合。
 * - cacheRead：cumulative → Math.max，incremental → sum（OpenCode 系实测为增量，用 sum）
 * - reasoning：恒 sum
 * - total = input + output + reasoning + cacheRead + cacheWrite
 *   （#6：reasoningInTotal === false 时排除 reasoning——CodeArts/DeepSeek 的
 *   reasoning 是 output 子集，真实 total 不含它）
 *
 * ⚠️ 归因结果禁止写回 `event.tokens`（change calibrate-tokens-and-compare-report
 * design §2）：本函数对所有 `event.tokens !== null` 的事件无差别求和，写回会让
 * carrier 与归因事件各算一遍，精确复现外部变更说明 §4.1 的双计 bug。
 * 归因必须走 speed-metrics 的只读纯函数 attributeTokensToLlmEvents。
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
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    // §3（calibrate-tokens-and-compare-report）：净输入 = input - cacheRead，下限 0。
    netInput: Math.max(0, input - cacheRead),
    total:
      input +
      output +
      (semantics.reasoningInTotal === false ? 0 : reasoning) +
      cacheRead +
      cacheWrite,
  };
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

/**
 * 按 startedAt 排序，保证 sequence 连续且 phase 两遍算法按时间序工作。
 * fix-adapter-turn-semantics A11：同时间戳的事件必须以**源顺序**为 tie-break，
 * 而不是依赖稳定排序的附带行为——一条 Claude assistant 消息的所有 part 共享同一
 * timestamp，若在此打乱，turnKey 分组与 sequence 的对应关系就被破坏。
 */
export function orderEventsByTime(events: TraceEvent[]): TraceEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.startedAt !== b.event.startedAt) {
        return a.event.startedAt < b.event.startedAt ? -1 : 1;
      }
      // A11：同时间戳 → 源顺序 tie-break（显式 index，不依赖稳定排序附带行为）。
      return a.index - b.index;
    })
    .map(({ event }, index) => ({ ...event, sequence: index + 1 }));
}

/** OpenCode 系 subagent 标题检测（G9.3）。 */
export function isSubagentTitle(title: string): boolean {
  return /\(@.*\bsubagent\)/i.test(title);
}

/**
 * add-mission-control §1 P0-A：相邻时间戳推导事件时长。
 *
 * 背景：claude / codex / opencode-db 的 durationMs 此前恒为 0，
 * 导致 avgToolDurationMs、TimeComposition、所有耗时类面板在主力 provider 上全是 0。
 * qoder.ts:65 已有同样的推导先例，此处统一。
 *
 * 四条规则（缺一条推导值就会比 0 更有害）：
 * 1. 按时间排序后 durationMs = next.startedAt − this.startedAt，末事件为 0
 * 2. **user_prompt 不参与推导** —— 其后的间隔是"用户在思考"，不是模型/工具耗时，
 *    该段由 computeTimeComposition 归入 userWait
 * 3. 单事件上限 5 分钟，超出说明中间隔了一次人类离开，截断（归入 idle）
 * 4. 调用方必须把 session.durationSource 标为 'derived'，UI 口径行据此标注
 */
export const DERIVED_DURATION_CAP_MS = 300_000;

export function deriveDurations<T extends TraceEvent>(events: T[]): T[] {
  if (events.length === 0) {
    return events;
  }
  const sorted = events
    .slice()
    .sort((a, b) => (a.startedAt === b.startedAt ? a.sequence - b.sequence : a.startedAt < b.startedAt ? -1 : 1));
  const durationById = new Map<string, number>();
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!;
    if (current.kind === 'user_prompt') {
      continue; // 规则 2
    }
    const gap = Date.parse(sorted[i + 1]!.startedAt) - Date.parse(current.startedAt);
    if (!Number.isFinite(gap) || gap <= 0) {
      continue;
    }
    durationById.set(current.id, Math.min(gap, DERIVED_DURATION_CAP_MS)); // 规则 3
  }
  return events.map((event) =>
    event.durationMs > 0 || !durationById.has(event.id)
      ? event
      : { ...event, durationMs: durationById.get(event.id)! },
  );
}

/**
 * add-mission-control §1 P0-B：选出会话主模型 —— token 占比最高者。
 * 无 model 的事件不参与；全部无 model 时返回 null。
 */
export function pickPrimaryModel(events: TraceEvent[]): string | null {
  const weight = new Map<string, number>();
  for (const event of events) {
    const model = event.model;
    if (model === null || model === undefined || model === '') {
      continue;
    }
    const tokens = event.tokens?.total ?? 0;
    // 无 token 的事件也算一票，避免"有 model 但 token 全为 0"时退化成 null
    weight.set(model, (weight.get(model) ?? 0) + tokens + 1);
  }
  let best: string | null = null;
  let bestWeight = -1;
  for (const [model, w] of weight) {
    if (w > bestWeight) {
      best = model;
      bestWeight = w;
    }
  }
  return best;
}

/** 从文本取单行标题并截断。 */
export function titleFromText(text: string | null | undefined, max = 200): string {
  // 真实 codex JSONL 中部分 content.text 是对象而非 string（2026-08-05 强制重扫暴露）；
  // 强转为字符串，避免索引/详情扫描在标题阶段抛错
  const normalized =
    typeof text === 'string'
      ? text
      : text === null || text === undefined
        ? ''
        : typeof text === 'object'
          ? JSON.stringify(text)
          : String(text);
  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return truncateTitle(firstLine ?? '', max);
}
