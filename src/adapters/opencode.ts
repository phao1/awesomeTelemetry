import type {
  ProviderKey,
  TraceRecord,
  TraceSession,
  TokenUsage,
} from '../core/trace-types.js';
import { classifyEvents } from '../core/phase-classifier.js';
import {
  aggregateTokenUsage,
  dedupeEventIds,
  deriveDurations,
  type EventWithRaw,
  isSubagentTitle,
  minMaxIso,
  normalizeStatus,
  orderEventsByTime,
  pickPrimaryModel,
  titleFromText,
  toIsoFromMs,
  wallClockDurationMs,
} from './helpers.js';
import { computeCostUsd } from '../core/pricing.js';
import type { Adapter, RawSample } from './sample-loader.js';

/** G9.1：CodeArts / CodeAgent2 复用 opencode，用 dialect 区分。 */
export interface OpenCodeDialect {
  provider: 'opencode' | 'codearts' | 'codeagent2';
  sourceAgent: string;
  /** #6：true = total 含 reasoning（OpenCode 实测）；false = reasoning 是 output 子集（CodeArts/DeepSeek 实测）。 */
  reasoningInTotal: boolean;
}

export interface OpenCodeTokenData {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number; creation?: number };
}

export interface OpenCodePart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; title?: string; input?: unknown; output?: string };
  [key: string]: unknown;
}

export interface OpenCodeMessage {
  id: string;
  role: 'user' | 'assistant';
  sessionID: string;
  time?: { created?: number; completed?: number };
  model?: string | null;
  tokens?: OpenCodeTokenData | null;
  error?: string | null;
  content?: OpenCodePart[];
}

export interface OpenCodeOtelSpan {
  name: string;
  kind?: string;
  startTime: number;
  endTime?: number;
  status?: string;
  attributes?: Record<string, unknown>;
}

export interface OpenCodeRawSample {
  session: {
    id?: string;
    title?: string;
    directory?: string;
    time?: { created?: number; updated?: number };
  };
  messages: OpenCodeMessage[];
  otel?: OpenCodeOtelSpan[];
}

/** adapter 的 TEvent：SQLite/JSONL 的 message 行 或 OTel span（REQ-005 三源）。 */
export type OpenCodeAdapterEvent = OpenCodeMessage | OpenCodeOtelSpan;

function toEventTokens(
  tokens: OpenCodeTokenData | null | undefined,
  reasoningInTotal: boolean,
): TokenUsage | null {
  if (tokens === undefined || tokens === null) {
    return null;
  }
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total:
      input +
      output +
      (reasoningInTotal ? reasoning : 0) +
      cacheRead +
      cacheWrite,
  };
}

/**
 * #5（审查 P0）：一条消息的多个 part 共享同一份 message.tokens，若每个 part 都挂
 * tokens，会话级聚合会把 token 膨胀 N 倍（N = part 数）。只把 tokens 挂在代表事件上：
 * 优先第一条 step part（step-finish 携带真实计量），无 step 时挂最后一个 part。
 */
function isTokenCarrier(message: OpenCodeMessage, partIndex: number): boolean {
  const parts = message.content ?? [];
  if (parts[partIndex]?.type === 'step') {
    return true;
  }
  return !parts.some((part) => part.type === 'step') && partIndex === parts.length - 1;
}

function partToEvent(
  message: OpenCodeMessage,
  part: OpenCodePart,
  partIndex: number,
  reasoningInTotal: boolean,
): EventWithRaw {
  const startedAt = toIsoFromMs(message.time?.created ?? 0);
  const status = normalizeStatus(message.error ?? part.state?.status ?? 'completed');
  const base = {
    id: `${message.id}-${partIndex}`,
    sessionId: message.sessionID,
    sequence: 0,
    phase: 'understand' as const,
    title: '',
    startedAt,
    durationMs: 0,
    status,
    actor: message.role,
    tool: null,
    // P0-B：模型归因，源 message 自带
    model: message.model ?? null,
    tokens: isTokenCarrier(message, partIndex)
      ? toEventTokens(message.tokens, reasoningInTotal)
      : null,
    error: message.error ?? null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
  };

  if (part.type === 'tool') {
    const tool = part.tool ?? part.state?.title ?? '';
    const title = part.state?.title ?? tool;
    const kind =
      /^(bash|shell)/i.test(tool)
        ? 'bash'
        : /^(write|edit|patch)/i.test(tool)
          ? 'file_write'
          : /^(read|glob|grep|search|list|view|cat|ls|find)/i.test(tool)
            ? 'file_read'
            : 'tool';
    return {
      ...base,
      kind,
      title: titleFromText(title),
      tool: tool || null,
      status: normalizeStatus(part.state?.status ?? message.error ?? 'completed'),
      hasRaw: true,
      // raw 与正文分离（G11.10）
      raw: JSON.stringify(part),
    } as EventWithRaw;
  }
  if (part.type === 'step') {
    return {
      ...base,
      kind: 'agent',
      title: titleFromText(part.state?.title ?? part.text),
      actor: message.role === 'user' ? 'user' : 'subagent',
      hasInput: part.text !== undefined,
      hasOutput: part.text !== undefined,
      inputSummary: part.text ?? null,
      outputSummary: part.text ?? null,
      hasRaw: true,
      raw: JSON.stringify(part),
    } as EventWithRaw;
  }
  if (message.role === 'user') {
    return {
      ...base,
      kind: 'user_prompt',
      title: titleFromText(part.text),
      hasInput: part.text !== undefined,
      inputSummary: part.text ?? null,
      hasRaw: true,
      raw: JSON.stringify(part),
    } as EventWithRaw;
  }
  return {
    ...base,
    kind: 'llm',
    title: titleFromText(part.text),
    hasOutput: part.text !== undefined,
    outputSummary: part.text ?? null,
    hasRaw: true,
    raw: JSON.stringify(part),
  } as EventWithRaw;
}

function otelSpanToEvent(span: OpenCodeOtelSpan): EventWithRaw {
  const startedAt = toIsoFromMs(span.startTime);
  const durationMs = span.endTime !== undefined ? Math.max(0, span.endTime - span.startTime) : 0;
  const name = span.name ?? '';
  const isTool = /tool|bash|shell|exec/i.test(name);
  return {
    id: `${name}-${span.startTime}`,
    sessionId: '',
    sequence: 0,
    kind: isTool ? 'tool' : 'llm',
    phase: 'understand',
    title: titleFromText(name),
    startedAt,
    durationMs,
    status: normalizeStatus(span.status ?? 'completed'),
    actor: 'assistant',
    tool: isTool ? name : null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    inputSummary: null,
    outputSummary: null,
    raw: JSON.stringify(span),
  } as EventWithRaw;
}

export function createOpencodeAdapter(
  dialect: OpenCodeDialect,
): Adapter<OpenCodeRawSample['session'], OpenCodeAdapterEvent> {
  return {
    sourceAgent: dialect.sourceAgent,
    normalize(
      sample: RawSample<OpenCodeRawSample['session'], OpenCodeAdapterEvent>,
      sourcePath: string,
    ): TraceRecord {
      const raw = sample.session;
      const messages = sample.events.filter(
        (e): e is OpenCodeMessage => 'content' in e || 'role' in e,
      );
      const otelSpans = sample.events.filter(
        (e): e is OpenCodeOtelSpan => 'startTime' in e,
      );
      const events: EventWithRaw[] = [];
      for (const message of messages) {
        const parts = message.content ?? [{ type: 'text' as const, text: '' }];
        if (parts.length === 0) {
          continue;
        }
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          events.push(partToEvent(message, parts[partIndex]!, partIndex, dialect.reasoningInTotal));
        }
      }
      for (const span of otelSpans) {
        events.push(otelSpanToEvent(span));
      }

      const title = titleFromText(raw.title ?? '');
      const times = minMaxIso(events);
      const ordered = orderEventsByTime(events);
      const deduped = dedupeEventIds(ordered);
      // P0-A：OTel span 自带真实起止（measured）；db/jsonl 源无耗时，按相邻时间戳推导。
      // ⚠️ durationSource 按实际解析路径取值，禁止按 provider 硬编码 —— 同一个
      // opencode provider 走 otel 源时是 measured，走 db 源时是 derived。
      const hasMeasured = otelSpans.length > 0;
      const timed = hasMeasured ? deduped : deriveDurations(deduped);
      const classified = classifyEvents(timed);
      // #4（审查 P0）：OpenCode/CodeArts/CodeAgent2 的 cache.read 实测为每步增量值，
      // 必须 sum；旧 gotcha G4.4 的 cumulative/max 假设已由校准数据推翻。
      const semantics = {
        cacheRead: 'incremental' as const,
        reasoning: 'incremental' as const,
        reasoningInTotal: dialect.reasoningInTotal,
      };
      const sessionId = raw.id ?? messages[0]?.sessionID ?? `opencode-${sourcePath}`;
      const tokenUsage = aggregateTokenUsage(classified, semantics);
      const primaryModel = pickPrimaryModel(classified);
      const cost = computeCostUsd(tokenUsage, primaryModel);
      const session: TraceSession = {
        id: sessionId,
        provider: dialect.provider as ProviderKey,
        sourceAgent: dialect.sourceAgent,
        title,
        startedAt: times.startedAt,
        updatedAt: times.updatedAt,
        status: classified.at(-1)?.status ?? 'unknown',
        cwd: raw.directory ?? null,
        messageCount: messages.length,
        eventCount: classified.length,
        tokenUsage,
        costUsd: cost.costUsd,
        systemPrompt: null,
        dataSource: 'scan',
        sourcePath,
        totalDurationMs: wallClockDurationMs(classified),
        isSubagent: isSubagentTitle(title),
        primaryModel,
        costSource: cost.costSource,
        durationSource: hasMeasured ? 'measured' : 'derived',
      };
      return { session, events: classified, tokenSemantics: semantics };
    },
  };
}

export const opencodeAdapter = createOpencodeAdapter({
  provider: 'opencode',
  sourceAgent: 'OpenCode',
  reasoningInTotal: true,
});

/** 供 thin wrapper（codearts / codeagent2）与测试使用。 */
export function normalizeOpenCode(
  sample: RawSample<OpenCodeRawSample['session'], OpenCodeAdapterEvent>,
  sourcePath: string,
): TraceRecord {
  return opencodeAdapter.normalize(sample, sourcePath);
}
