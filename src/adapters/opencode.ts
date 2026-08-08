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
  rollupSessionStatus,
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
  state?: { status?: string; title?: string; input?: unknown; output?: unknown };
  /** 真实 CodeArts step-finish part 顶层自带 tokens（与 message.tokens 并存）。 */
  tokens?: OpenCodeTokenData | null;
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
    netInput: Math.max(0, input - cacheRead),
    total:
      input +
      output +
      (reasoningInTotal ? reasoning : 0) +
      cacheRead +
      cacheWrite,
  };
}

/** step 系 part：'step'（fixture 旧 schema）与真实 'step-start' / 'step-finish'。 */
function isStepFamily(type: string): boolean {
  return type === 'step' || type === 'step-start' || type === 'step-finish';
}

/** 纯控制标记：step 系 + 无 text/tokens/error + status completed（不产出事件）。 */
function isPureStepMarker(
  message: OpenCodeMessage,
  part: OpenCodePart,
  partIndex: number,
): boolean {
  if (!isStepFamily(part.type)) {
    return false;
  }
  const hasText = part.text !== undefined && part.text.trim() !== '';
  const hasPartTokens = part.tokens !== null && part.tokens !== undefined;
  const hasMessageTokens = message.tokens !== null && message.tokens !== undefined;
  // 真实 CodeArts：message.data.tokens 与 step-finish part.tokens 是同一份拷贝。
  // 只要存在 part 级 tokens，message.tokens 就是冗余，不需要额外的载体 part。
  const hasPartTokensAnywhere =
    (message.content ?? []).some((p) => p.tokens !== null && p.tokens !== undefined);
  const needsMessageCarrier = hasMessageTokens && !hasPartTokensAnywhere;
  const parts = message.content ?? [];
  const firstStepIndex = parts.findIndex((p) => isStepFamily(p.type));
  if (hasText || hasPartTokens) {
    return false;
  }
  // message.tokens 需要一个载体：第一条 step 系 part 保留（否则 token 数据会丢）
  if (needsMessageCarrier && firstStepIndex === partIndex) {
    return false;
  }
  if (message.error != null) {
    return false;
  }
  return normalizeStatus(part.state?.status ?? 'completed') === 'success';
}

/** state.input / state.output → 摘要正文；缺失或空返回 null。 */
function summaryFrom(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined || serialized === '' ? null : serialized;
}

function partToEvent(
  message: OpenCodeMessage,
  part: OpenCodePart,
  partIndex: number,
  tokens: TokenUsage | null,
): EventWithRaw | null {
  const startedAt = toIsoFromMs(message.time?.created ?? 0);
  const status = normalizeStatus(message.error ?? part.state?.status ?? 'completed');
  const base = {
    id: `${message.id}-${partIndex}`,
    sessionId: message.sessionID,
    sequence: 0,
    // fix-adapter-turn-semantics A4：opencode/codearts/codeagent2 共用此路径。
    // 边界信号 = 源记录自带的 message.id（一个 inference 的所有 part 共享同一 id）。
    // 直接从源记录取，绝不从公开 id 字段（`${message.id}-${partIndex}`）反解。
    turnKey: message.id ?? null,
    phase: 'understand' as const,
    title: '',
    startedAt,
    durationMs: 0,
    status,
    actor: message.role,
    tool: null,
    // P0-B：模型归因，源 message 自带
    model: message.model ?? null,
    tokens,
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
    const inputSummary = summaryFrom(part.state?.input);
    const outputSummary = summaryFrom(part.state?.output);
    return {
      ...base,
      kind,
      title: titleFromText(title),
      tool: tool || null,
      status: normalizeStatus(part.state?.status ?? message.error ?? 'completed'),
      hasInput: inputSummary !== null,
      hasOutput: outputSummary !== null,
      inputSummary,
      outputSummary,
      hasRaw: true,
      // raw 与正文分离（G11.10）
      raw: JSON.stringify(part),
    } as EventWithRaw;
  }
  if (isStepFamily(part.type)) {
    const status = normalizeStatus(message.error ?? part.state?.status ?? 'completed');
    return {
      ...base,
      kind: 'agent',
      // 确定性标题，避免甘特里一排空标题行（fix-session-detail-display §2.2）
      title: `agent step: ${status}`,
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
    // OTel span 没有 message id，源格式在此路径上无边界信号 → null（A4 opencode 行）。
    turnKey: null,
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
        // §2.2：纯 step 标记不产出事件；token 载体解析放在过滤之后，
        // 保证 message.tokens / part.tokens 恰好挂载到一个保留事件上（不膨胀、不丢失）
        const kept = parts
          .map((part, partIndex) => ({ part, partIndex }))
          .filter(({ part, partIndex }) => !isPureStepMarker(message, part, partIndex));
        const hasPartLevelTokens = kept.some(({ part }) => part.tokens != null);
        const firstKeptStep = kept.findIndex(({ part }) => isStepFamily(part.type));
        const carrierIndex =
          hasPartLevelTokens
            ? -1
            : firstKeptStep >= 0
            ? kept[firstKeptStep]!.partIndex
            : kept[kept.length - 1]?.partIndex ?? -1;
        for (const { part, partIndex } of kept) {
          const partTokens =
            part.tokens !== null && part.tokens !== undefined
              ? toEventTokens(part.tokens, dialect.reasoningInTotal)
              : null;
          const messageTokens =
            partIndex === carrierIndex
              ? toEventTokens(message.tokens, dialect.reasoningInTotal)
              : null;
          const event = partToEvent(
            message,
            part,
            partIndex,
            partTokens ?? messageTokens,
          );
          if (event !== null) {
            events.push(event);
          }
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
        status: rollupSessionStatus(classified),
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
      return {
        session,
        events: classified,
        tokenSemantics: semantics,
        // fix-adapter-turn-semantics A5：opencode/codearts/codeagent2 均按源消息 id
        // 分组（A4 表），OTel span 无 id 时退化为 null —— provenance 仍如实声明为
        // message_identity。
        turnKeySource: 'message_identity',
      };
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
