import type { TraceEvent, TraceRecord, TraceSession } from '../core/trace-types.js';
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
import type { Adapter, RawSample } from './sample-loader.js';

export interface WorkBuddyRawMessage {
  id?: string;
  callId?: string;
  role?: string;
  type?: string;
  toolName?: string;
  content?: string;
  rawUsage?: { credit?: number; [key: string]: unknown };
  skipRun?: boolean;
  timestamp?: string;
  status?: string;
}

const USER_QUERY_RE = /<user_query>([\s\S]*?)<\/user_query>/;
const EXIT_CODE_ERROR_RE = /Exit Code: [1-9]/;

function kindByToolName(tool: string): TraceEvent['kind'] {
  if (/^(Bash|PowerShell)/i.test(tool)) {
    return 'bash';
  }
  if (/^(Read|Glob|Grep)/i.test(tool)) {
    return 'file_read';
  }
  if (/^(Write|Edit)/i.test(tool)) {
    return 'file_write';
  }
  if (/^Agent/i.test(tool)) {
    return 'subagent_prompt';
  }
  if (/^Skill/i.test(tool)) {
    return 'agent';
  }
  return 'tool';
}

export function extractUserQuery(content: string | null | undefined): string | null {
  const m = USER_QUERY_RE.exec(content ?? '');
  return m?.[1]?.trim() ?? null;
}

export function normalizeWorkBuddySample(
  sample: RawSample<{ id?: string; title?: string }, WorkBuddyRawMessage>,
  sourcePath: string,
): TraceRecord {
  const messages = sample.events;
  const events: EventWithRaw[] = [];
  let costUsd = 0;
  const sessionId = sample.session.id ?? `workbuddy-${sourcePath}`;
  const byCallId = new Map<string, EventWithRaw>();

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    const next = messages[i + 1];
    const timestamp = message.timestamp ?? '1970-01-01T00:00:00.000Z';
    const durationMs =
      next?.timestamp !== undefined
        ? Math.max(0, Date.parse(next.timestamp) - Date.parse(timestamp))
        : 0;
    const credit = message.rawUsage?.credit ?? 0;
    costUsd += credit;
    const tool = message.toolName ?? '';
    const kind = message.role === 'user' ? 'user_prompt' : kindByToolName(tool);
    const status = normalizeStatus(message.status ?? 'completed');
    const content = message.content ?? '';

    if (message.type === 'function_call_result' && message.callId !== undefined) {
      const paired = byCallId.get(message.callId);
      if (paired !== undefined) {
        const output = titleFromText(content, 5000);
        const hasError = EXIT_CODE_ERROR_RE.test(content) || message.skipRun === true;
        byCallId.delete(message.callId);
        events.push({
          ...paired,
          hasOutput: output.length > 0,
          outputSummary: output.length > 0 ? output : null,
          status: hasError ? 'error' : paired.status,
          error: hasError ? titleFromText(content, 500) : paired.error,
          durationMs,
          raw: JSON.stringify(message),
        } as EventWithRaw);
        continue;
      }
    }

    const event: EventWithRaw = {
      id: message.id ?? message.callId ?? `wb-${i}`,
      sessionId,
      sequence: 0,
      kind,
      phase: 'understand',
      title: titleFromText(content !== '' ? content : tool),
      startedAt: timestamp,
      durationMs,
      status,
      actor: message.role === 'user' ? 'user' : 'assistant',
      tool: tool || null,
      tokens: null,
      error: null,
      hasInput: kind === 'user_prompt' && content.length > 0,
      hasOutput: kind !== 'user_prompt' && content.length > 0,
      hasRaw: true,
      inputSummary: null,
      outputSummary: null,
      raw: JSON.stringify(message),
    } as EventWithRaw;

    if (message.type === 'function_call' && message.callId !== undefined) {
      byCallId.set(message.callId, event);
      continue; // 等待配对结果，未配对者循环结束后补推
    }
    events.push(event);
  }
  for (const event of byCallId.values()) {
    events.push(event);
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  const classified = classifyEvents(deduped);
  const times = minMaxIso(classified);
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const session: TraceSession = {
    id: sessionId,
    provider: 'workbuddy',
    sourceAgent: 'WorkBuddy',
    title: sample.session.title ?? extractUserQuery(messages.map((m) => m.content ?? '').join('\n')) ?? '',
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: classified.at(-1)?.status ?? 'unknown',
    cwd: null,
    messageCount: messages.length,
    eventCount: classified.length,
    tokenUsage: aggregateTokenUsage(classified, semantics),
    costUsd,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath,
    totalDurationMs: wallClockDurationMs(classified),
    isSubagent: false,
  };
  return { session, events: classified, tokenSemantics: semantics };
}

export const workbuddyAdapter: Adapter<{ id?: string; title?: string }, WorkBuddyRawMessage> = {
  sourceAgent: 'WorkBuddy',
  normalize: normalizeWorkBuddySample,
};
