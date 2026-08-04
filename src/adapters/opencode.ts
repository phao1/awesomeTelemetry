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
  type EventWithRaw,
  isSubagentTitle,
  minMaxIso,
  normalizeStatus,
  orderEventsByTime,
  titleFromText,
  toIsoFromMs,
  wallClockDurationMs,
} from './helpers.js';
import type { Adapter, RawSample } from './sample-loader.js';

/** G9.1：CodeArts / CodeAgent2 复用 opencode，用 dialect 区分。 */
export interface OpenCodeDialect {
  provider: 'opencode' | 'codearts' | 'codeagent2';
  sourceAgent: string;
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

function toEventTokens(tokens: OpenCodeTokenData | null | undefined): TokenUsage | null {
  if (tokens === undefined || tokens === null) {
    return null;
  }
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  return { input, output, reasoning, cacheRead, cacheWrite, total: input + output + reasoning + cacheRead };
}

function partToEvent(
  message: OpenCodeMessage,
  part: OpenCodePart,
  partIndex: number,
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
    tokens: toEventTokens(message.tokens),
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
          events.push(partToEvent(message, parts[partIndex]!, partIndex));
        }
      }
      for (const span of otelSpans) {
        events.push(otelSpanToEvent(span));
      }

      const title = titleFromText(raw.title ?? '');
      const times = minMaxIso(events);
      const ordered = orderEventsByTime(events);
      const deduped = dedupeEventIds(ordered);
      const classified = classifyEvents(deduped);
      const semantics = { cacheRead: 'cumulative' as const, reasoning: 'incremental' as const };
      const sessionId = raw.id ?? messages[0]?.sessionID ?? `opencode-${sourcePath}`;
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
        tokenUsage: aggregateTokenUsage(classified, semantics),
        costUsd: 0,
        systemPrompt: null,
        dataSource: 'scan',
        sourcePath,
        totalDurationMs: wallClockDurationMs(classified),
        isSubagent: isSubagentTitle(title),
      };
      return { session, events: classified, tokenSemantics: semantics };
    },
  };
}

export const opencodeAdapter = createOpencodeAdapter({
  provider: 'opencode',
  sourceAgent: 'OpenCode',
});

/** 供 thin wrapper（codearts / codeagent2）与测试使用。 */
export function normalizeOpenCode(
  sample: RawSample<OpenCodeRawSample['session'], OpenCodeAdapterEvent>,
  sourcePath: string,
): TraceRecord {
  return opencodeAdapter.normalize(sample, sourcePath);
}
