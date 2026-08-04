import type { TraceEventSlim } from './trace-types.js';

/**
 * ui-design-v2 §3.2 时间构成：把总时长按「执行语义」拆分——
 * 模型推理 / 工具执行 / 空转 / 用户等待。这是甘特图里看不出来的归因信息。
 */
export type TimeSegmentKey = 'model' | 'tool' | 'idle' | 'userWait';

export interface TimeSegment {
  key: TimeSegmentKey;
  ms: number;
  /** 0–100，占 totalMs 比例。 */
  pct: number;
  /** 点击分段后用于过滤甘特图的对应事件。 */
  eventIds: string[];
}

export interface TimeComposition {
  totalMs: number;
  modelMs: number;
  toolMs: number;
  idleMs: number;
  userWaitMs: number;
  segments: TimeSegment[];
}

/** 工具执行语义包含的事件 kind（分段过滤与归因共用）。 */
export const TIME_TOOL_KINDS = new Set(['tool', 'file_read', 'file_write', 'bash', 'test', 'agent']);
const METADATA_KINDS = new Set(['system', 'message']);

export function computeTimeComposition(events: TraceEventSlim[]): TimeComposition {
  if (events.length === 0) {
    return { totalMs: 0, modelMs: 0, toolMs: 0, idleMs: 0, userWaitMs: 0, segments: [] };
  }
  const sorted = [...events].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  let modelMs = 0;
  let toolMs = 0;
  const modelIds: string[] = [];
  const toolIds: string[] = [];
  let spanStart = Number.POSITIVE_INFINITY;
  let spanEnd = 0;
  for (const e of sorted) {
    const start = Date.parse(e.startedAt);
    const end = start + e.durationMs;
    if (start < spanStart) {
      spanStart = start;
    }
    if (end > spanEnd) {
      spanEnd = end;
    }
    if (e.kind === 'llm') {
      modelMs += e.durationMs;
      modelIds.push(e.id);
    } else if (TIME_TOOL_KINDS.has(e.kind)) {
      toolMs += e.durationMs;
      toolIds.push(e.id);
    }
  }
  const totalMs = Math.max(0, spanEnd - spanStart);

  // 空档归属：向前看最近的 user_prompt → 用户等待；否则看最近的非元数据事件 → 空转。
  let idleMs = 0;
  let userWaitMs = 0;
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const prev = sorted[i]!;
    const next = sorted[i + 1]!;
    const gap = Date.parse(next.startedAt) - (Date.parse(prev.startedAt) + prev.durationMs);
    if (gap <= 0) {
      continue;
    }
    let anchor: TraceEventSlim | null = null;
    for (let j = i; j >= 0; j -= 1) {
      const candidate = sorted[j]!;
      if (candidate.kind === 'user_prompt') {
        anchor = candidate;
        break;
      }
      if (candidate.durationMs > 0 && !METADATA_KINDS.has(candidate.kind)) {
        break;
      }
    }
    if (anchor !== null && anchor.kind === 'user_prompt') {
      userWaitMs += gap;
    } else {
      idleMs += gap;
    }
  }

  // 钳制：空档总和不得超过未被模型/工具覆盖的时间。
  const remaining = Math.max(0, totalMs - modelMs - toolMs);
  const gapTotal = idleMs + userWaitMs;
  if (gapTotal > remaining && gapTotal > 0) {
    const scale = remaining / gapTotal;
    idleMs *= scale;
    userWaitMs *= scale;
  }

  const segments: TimeSegment[] = [
    { key: 'model', ms: modelMs, pct: totalMs > 0 ? (modelMs / totalMs) * 100 : 0, eventIds: modelIds },
    { key: 'tool', ms: toolMs, pct: totalMs > 0 ? (toolMs / totalMs) * 100 : 0, eventIds: toolIds },
    { key: 'idle', ms: idleMs, pct: totalMs > 0 ? (idleMs / totalMs) * 100 : 0, eventIds: [] },
    { key: 'userWait', ms: userWaitMs, pct: totalMs > 0 ? (userWaitMs / totalMs) * 100 : 0, eventIds: [] },
  ];

  return {
    totalMs,
    modelMs,
    toolMs,
    idleMs,
    userWaitMs,
    segments: segments.filter((segment) => segment.ms > 0),
  };
}
