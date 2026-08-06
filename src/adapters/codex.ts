import type { TraceRecord, TraceSession, TokenUsage } from '../core/trace-types.js';
import { classifyEvents } from '../core/phase-classifier.js';
import {
  aggregateTokenUsage,
  dedupeEventIds,
  deriveDurations,
  type EventWithRaw,
  minMaxIso,
  normalizeStatus,
  orderEventsByTime,
  pickPrimaryModel,
  rollupSessionStatus,
  sessionTitleFromEvents,
  titleFromText,
  wallClockDurationMs,
} from './helpers.js';
import { computeCostUsd } from '../core/pricing.js';
import type { Adapter, RawSample } from './sample-loader.js';

/**
 * Codex `event_msg` / `token_count` 的用量结构。
 * `total_token_usage` 是会话累计快照，`last_token_usage` 是本轮增量；
 * 两者 key 与 Anthropic 完全不同（`cached_input_tokens` 而非
 * `cache_read_input_tokens`），且 `input_tokens` **已包含** cached 与 cache_write，
 * `reasoning_output_tokens` 是 `output_tokens` 的子集。
 */
export interface CodexTokenUsageInfo {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexRawPayload {
  type?: string;
  role?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  output?: string;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }> | string;
  info?: {
    total_token_usage?: CodexTokenUsageInfo;
    last_token_usage?: CodexTokenUsageInfo;
  };
  status?: string;
  session_id?: string;
  cwd?: string;
  /** session_meta 带 model_provider，turn_context 带具体 model。 */
  model?: string;
  model_provider?: string;
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> | string };
}

export interface CodexRawRow {
  timestamp?: string;
  type?: string;
  payload?: CodexRawPayload;
}

/**
 * Codex 的 `input_tokens` 是「本轮全部输入」，其中 cached / cache_write 是子集，
 * 而本项目 TokenUsage 约定 input 为**新鲜输入**（与 cacheRead / cacheWrite 不相交）。
 * 因此这里把子集减出去，让 input + cacheRead + cacheWrite 恰好还原 input_tokens，
 * 聚合后的 total 才等于 Codex 自报的 total_tokens。
 * reasoning ⊂ output，故 tokenSemantics.reasoningInTotal = false。
 */
function usageToTokens(usage: CodexTokenUsageInfo | undefined): TokenUsage | null {
  if (usage === undefined) {
    return null;
  }
  const rawInput = usage.input_tokens ?? 0;
  const cacheRead = usage.cached_input_tokens ?? 0;
  const cacheWrite = usage.cache_write_input_tokens ?? 0;
  const input = Math.max(0, rawInput - cacheRead - cacheWrite);
  const output = usage.output_tokens ?? 0;
  const reasoning = usage.reasoning_output_tokens ?? 0;
  if (rawInput === 0 && output === 0) {
    return null;
  }
  return {
    input, output, reasoning, cacheRead, cacheWrite,
    netInput: input,
    total: input + output + cacheRead + cacheWrite,
  };
}

/** 只承载会话元数据、不代表一次实际动作的行类型。 */
const METADATA_ROW_TYPES = new Set(['session_meta', 'turn_context', 'world_state']);

function contentText(payload: CodexRawPayload): string {
  if (typeof payload.content === 'string') {
    return payload.content;
  }
  return (payload.content ?? []).map((p) => p.text ?? '').join('\n');
}

export function normalizeCodexSample(
  sample: RawSample<Record<string, never>, CodexRawRow>,
  sourcePath: string,
): TraceRecord {
  const rows = sample.events;
  const events: EventWithRaw[] = [];
  const sessionId =
    rows.find((r) => r.payload?.session_id !== undefined && r.payload?.session_id !== '')
      ?.payload?.session_id ?? `codex-${sourcePath}`;
  let cwd: string | null = null;
  // turn_context 会随每轮更新（用户可中途换模型），事件按「当时生效的模型」标注。
  let currentModel: string | null = null;
  /** 末条 token_count 的累计快照，作为会话总量的权威口径。 */
  let finalTotalUsage: TokenUsage | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const payload = row.payload ?? {};
    const timestamp = row.timestamp ?? '1970-01-01T00:00:00.000Z';
    if (payload.cwd !== undefined && cwd === null) {
      cwd = payload.cwd;
    }
    if (payload.model !== undefined && payload.model !== '') {
      currentModel = payload.model;
    }
    // 元数据行只供上面提取 cwd / model，本身不是轨迹事件，不进时间线。
    if (METADATA_ROW_TYPES.has(row.type ?? '')) {
      continue;
    }
    const status = normalizeStatus(payload.status ?? 'completed');
    const base = {
      id: payload.call_id ?? `codex-${i}`,
      sessionId,
      sequence: 0,
      phase: 'implement' as const,
      title: '',
      startedAt: timestamp,
      durationMs: 0,
      status,
      actor: 'assistant',
      tool: null,
      tokens: null as TokenUsage | null,
      error: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      inputSummary: null,
      outputSummary: null,
      model: currentModel,
    };

    const type = payload.type;
    // Codex 把用量单独记在 event_msg/token_count 里，而不是挂在消息上。
    // last_token_usage 是本轮增量，逐条累加即等于末条 total_token_usage。
    if (type === 'token_count') {
      finalTotalUsage = usageToTokens(payload.info?.total_token_usage) ?? finalTotalUsage;
      const tokens = usageToTokens(payload.info?.last_token_usage);
      if (tokens === null) {
        continue;
      }
      events.push({
        ...base,
        kind: 'llm',
        title: titleFromText('token_count'),
        tokens,
        hasRaw: true,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }
    if (type === 'function_call') {
      const name = payload.name ?? 'function_call';
      events.push({
        ...base,
        kind: 'tool',
        title: titleFromText(name),
        tool: name,
        hasInput: payload.arguments !== undefined,
        hasRaw: true,
        inputSummary: payload.arguments ?? null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }
    if (type === 'function_call_output') {
      const output = payload.output ?? '';
      const failed = /error|failed/i.test(output.slice(0, 200));
      events.push({
        ...base,
        kind: 'tool',
        title: titleFromText('function_call_output'),
        tool: 'function_call_output',
        status: failed ? 'error' : status,
        hasOutput: output.length > 0,
        hasRaw: true,
        outputSummary: output.length > 0 ? titleFromText(output, 5000) : null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    const role = payload.role ?? payload.message?.role;
    if (type === 'message' || type === 'agent_message') {
      const text = payload.message !== undefined ? contentText({ ...payload, content: payload.message.content }) : contentText(payload);
      if (role === 'user') {
        events.push({
          ...base,
          kind: 'user_prompt',
          title: titleFromText(text),
          actor: 'user',
          hasInput: text.length > 0,
          hasRaw: true,
          inputSummary: text.length > 0 ? text : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
      } else {
        events.push({
          ...base,
          kind: 'llm',
          title: titleFromText(text),
          hasOutput: text.length > 0,
          hasRaw: true,
          outputSummary: text.length > 0 ? text : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
      }
      continue;
    }

    // 未知类型：降级为 system/message
    events.push({
      ...base,
      kind: 'system',
      title: titleFromText(type ?? 'system'),
      actor: 'system',
      hasRaw: true,
      raw: JSON.stringify(row),
    } as EventWithRaw);
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  // P0-A：Codex JSONL 不记录事件耗时，按相邻时间戳推导
  const timed = deriveDurations(deduped);
  const classified = classifyEvents(timed);
  const times = minMaxIso(classified);
  // last_token_usage 是逐轮增量，供事件级归因；
  // reasoning_output_tokens ⊂ output_tokens，计入 total 会双计。
  const semantics = {
    cacheRead: 'incremental' as const,
    reasoning: 'incremental' as const,
    reasoningInTotal: false,
  };
  // 会话总量以 Codex 自己维护的累计快照为准：实测逐轮增量之和会比末条
  // total_token_usage 高出 0.3%~0.5%（重试轮会重复计入 last_token_usage），
  // 而累计快照正是 Codex 自身向用户展示的口径。快照缺失时才退回逐事件求和。
  const tokenUsage = finalTotalUsage ?? aggregateTokenUsage(classified, semantics);
  const primaryModel = pickPrimaryModel(classified);
  const cost = computeCostUsd(tokenUsage, primaryModel);
  const session: TraceSession = {
    id: sessionId,
    provider: 'codex',
    sourceAgent: 'Codex',
    title: sessionTitleFromEvents(classified),
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: rollupSessionStatus(classified),
    cwd,
    messageCount: rows.length,
    eventCount: classified.length,
    tokenUsage,
    costUsd: cost.costUsd,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath,
    totalDurationMs: wallClockDurationMs(classified),
    isSubagent: false,
    primaryModel,
    costSource: cost.costSource,
    durationSource: 'derived',
  };
  return { session, events: classified, tokenSemantics: semantics };
}

export const codexAdapter: Adapter<Record<string, never>, CodexRawRow> = {
  sourceAgent: 'Codex',
  normalize: normalizeCodexSample,
};
