import type {
  TraceRecord,
  TraceSession,
  TokenUsage,
} from '../core/trace-types.js';
import { classifyEvents } from '../core/phase-classifier.js';
import {
  aggregateTokenUsage,
  dedupeEventIds,
  type EventWithRaw,
  minMaxIso,
  normalizeStatus,
  orderEventsByTime,
  titleFromText,
  wallClockDurationMs,
} from './helpers.js';
import { extractTitleFromUserText } from '../core/title-utils.js';
import type { Adapter, RawSample } from './sample-loader.js';

export interface ClaudeContentPart {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

export interface ClaudeRawMessage {
  id?: string;
  role?: string;
  model?: string;
  content?: ClaudeContentPart[] | string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason?: string;
  status?: string;
}

export interface ClaudeRawRow {
  type?: string;
  subtype?: string;
  isMeta?: boolean;
  isSnapshot?: boolean;
  requestId?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  message?: ClaudeRawMessage;
}

function usageToTokens(usage: ClaudeRawMessage['usage']): TokenUsage | null {
  if (usage === undefined) {
    return null;
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return { input, output, reasoning: 0, cacheRead, cacheWrite, total: input + output + cacheRead };
}

function partsOf(message: ClaudeRawMessage): ClaudeContentPart[] {
  if (typeof message.content === 'string') {
    return [{ type: 'text', text: message.content }];
  }
  return message.content ?? [];
}

export function normalizeClaudeSample(
  sample: RawSample<Record<string, never>, ClaudeRawRow>,
  sourcePath: string,
): TraceRecord {
  const rows = sample.events;
  const events: EventWithRaw[] = [];
  let messageCount = 0;
  const sessionId =
    rows.find((r) => r.sessionId !== undefined && r.sessionId !== '')?.sessionId ??
    `claude-${sourcePath}`;

  for (const row of rows) {
    const timestamp = row.timestamp ?? '1970-01-01T00:00:00.000Z';
    const message = row.message;
    const parts = partsOf(message ?? {});
    const status = normalizeStatus(message?.status ?? 'completed');

    if (row.type === 'user') {
      messageCount += 1;
      const text = parts.map((p) => p.text ?? '').join('\n');
      events.push({
        id: message?.id ?? `user-${events.length}`,
        sessionId,
        sequence: 0,
        kind: 'user_prompt',
        phase: 'understand',
        title: titleFromText(text),
        startedAt: timestamp,
        durationMs: 0,
        status,
        actor: 'user',
        tool: null,
        tokens: null,
        error: null,
        hasInput: text.length > 0,
        hasOutput: false,
        hasRaw: true,
        inputSummary: text.length > 0 ? text : null,
        outputSummary: null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    if (row.type === 'assistant') {
      messageCount += 1;
      const tokens = usageToTokens(message?.usage);
      let partIndex = 0;
      for (const part of parts) {
        partIndex += 1;
        if (part.type === 'tool_use') {
          const tool = part.name ?? '';
          events.push({
            id: part.id ?? `${message?.id ?? 'assistant'}-${partIndex}`,
            sessionId: row.sessionId ?? '',
            sequence: 0,
            kind: 'tool',
            phase: 'implement',
            title: titleFromText(tool),
            startedAt: timestamp,
            durationMs: 0,
            status,
            actor: 'assistant',
            tool: tool || null,
            tokens: null,
            error: null,
            hasInput: part.input !== undefined,
            hasOutput: false,
            hasRaw: true,
            inputSummary:
              part.input === undefined ? null : titleFromText(JSON.stringify(part.input), 5000),
            outputSummary: null,
            raw: JSON.stringify(part),
          } as EventWithRaw);
          continue;
        }
        events.push({
          id: `${message?.id ?? 'assistant'}-${partIndex}`,
            sessionId,
          sequence: 0,
          kind: 'llm',
          phase: 'implement',
          title: titleFromText(part.text),
          startedAt: timestamp,
          durationMs: 0,
          status,
          actor: 'assistant',
          tool: null,
          tokens: partIndex === 1 ? tokens : null,
          error: null,
          hasInput: false,
          hasOutput: (part.text ?? '').length > 0,
          hasRaw: true,
          inputSummary: null,
          outputSummary: part.text ?? null,
          raw: JSON.stringify(part),
        } as EventWithRaw);
      }
      continue;
    }

    // system 行
    if (row.type === 'system' && row.isMeta !== true) {
      const text = parts.map((p) => p.text ?? '').join('\n');
      events.push({
        id: message?.id ?? `system-${events.length}`,
            sessionId,
        sequence: 0,
        kind: 'system',
        phase: 'understand',
        title: titleFromText(row.subtype ?? text),
        startedAt: timestamp,
        durationMs: 0,
        status: normalizeStatus(row.subtype === 'init' ? 'completed' : 'unknown'),
        actor: 'system',
        tool: null,
        tokens: null,
        error: null,
        hasInput: text.length > 0,
        hasOutput: false,
        hasRaw: true,
        inputSummary: text.length > 0 ? text : null,
        outputSummary: null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
    }
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  const classified = classifyEvents(deduped);
  const times = minMaxIso(classified);
  const firstUser = classified.find((e) => e.kind === 'user_prompt');
  const firstRealUser = classified.find(
    (e) =>
      e.kind === 'user_prompt' &&
      e.inputSummary !== null &&
      extractTitleFromUserText(e.inputSummary) !== null,
  );
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const session: TraceSession = {
    id: sessionId,
    provider: 'claude',
    sourceAgent: 'Claude',
    title: firstRealUser?.title ?? firstUser?.title ?? '',
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: classified.at(-1)?.status ?? 'unknown',
    cwd: null,
    messageCount,
    eventCount: classified.length,
    tokenUsage: aggregateTokenUsage(classified, semantics),
    costUsd: 0,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath,
    totalDurationMs: wallClockDurationMs(classified),
    isSubagent: false,
  };
  return { session, events: classified, tokenSemantics: semantics };
}

export const claudeAdapter: Adapter<Record<string, never>, ClaudeRawRow> = {
  sourceAgent: 'Claude',
  normalize: normalizeClaudeSample,
};
