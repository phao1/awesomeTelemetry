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
  titleFromText,
  wallClockDurationMs,
} from './helpers.js';
import { computeCostUsd } from '../core/pricing.js';
import { extractTitleFromUserText } from '../core/title-utils.js';
import type { Adapter, RawSample } from './sample-loader.js';

export interface CodexRawPayload {
  type?: string;
  role?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  output?: string;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }> | string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  status?: string;
  session_id?: string;
  cwd?: string;
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> | string };
}

export interface CodexRawRow {
  timestamp?: string;
  type?: string;
  payload?: CodexRawPayload;
}

function usageToTokens(usage: CodexRawPayload['usage']): TokenUsage | null {
  if (usage === undefined) {
    return null;
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const reasoning = usage.reasoning_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return { input, output, reasoning, cacheRead, cacheWrite, total: input + output + reasoning + cacheRead };
}

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

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const payload = row.payload ?? {};
    const timestamp = row.timestamp ?? '1970-01-01T00:00:00.000Z';
    if (payload.cwd !== undefined && cwd === null) {
      cwd = payload.cwd;
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
      tokens: usageToTokens(payload.usage),
      error: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      inputSummary: null,
      outputSummary: null,
    };

    const type = payload.type;
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
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const tokenUsage = aggregateTokenUsage(classified, semantics);
  const primaryModel = pickPrimaryModel(classified);
  const cost = computeCostUsd(tokenUsage, primaryModel);
  const session: TraceSession = {
    id: sessionId,
    provider: 'codex',
    sourceAgent: 'Codex',
    title:
      classified.find(
        (e) =>
          e.kind === 'user_prompt' &&
          e.inputSummary !== null &&
          extractTitleFromUserText(e.inputSummary) !== null,
      )?.title ??
      classified.find((e) => e.kind === 'user_prompt')?.title ??
      '',
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: classified.at(-1)?.status ?? 'unknown',
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
