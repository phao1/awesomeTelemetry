import type { TraceRecord, TraceSession, TokenUsage } from '../core/trace-types.js';
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

export interface QoderRawRow {
  id?: string;
  type?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string; [key: string]: unknown }>;
  timestamp?: string;
  toolName?: string;
  command?: string;
  status?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

function contentText(row: QoderRawRow): string {
  if (typeof row.content === 'string') {
    return row.content;
  }
  return (row.content ?? []).map((p) => p.text ?? '').join('\n');
}

function tokensOf(row: QoderRawRow): TokenUsage | null {
  const t = row.tokens;
  if (t === undefined) {
    return null;
  }
  const input = t.input ?? 0;
  const output = t.output ?? 0;
  const reasoning = t.reasoning ?? 0;
  const cacheRead = t.cache_read ?? 0;
  const cacheWrite = t.cache_write ?? 0;
  return {
    input, output, reasoning, cacheRead, cacheWrite,
    netInput: Math.max(0, input - cacheRead),
    total: input + output + reasoning + cacheRead,
  };
}

export function normalizeQoderSample(
  sample: RawSample<{ id?: string; title?: string }, QoderRawRow>,
  sourcePath: string,
): TraceRecord {
  const rows = sample.events;
  const events: EventWithRaw[] = [];
  const sessionId = sample.session.id ?? `qoder-${sourcePath}`;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const next = rows[i + 1];
    const timestamp = row.timestamp ?? '1970-01-01T00:00:00.000Z';
    // REQ-008：durationMs 从相邻时间戳算
    const durationMs =
      next?.timestamp !== undefined
        ? Math.max(0, Date.parse(next.timestamp) - Date.parse(timestamp))
        : 0;
    const text = contentText(row);
    const type = row.type ?? '';
    const role = row.role ?? '';
    const status = normalizeStatus(row.status ?? 'completed');
    const tool = row.toolName ?? row.command ?? null;
    const kind: EventWithRaw['kind'] =
      role === 'user'
        ? 'user_prompt'
        : type === 'tool' || type === 'bash'
          ? type === 'bash' ? 'bash' : 'tool'
          : type === 'test'
            ? 'test'
            : type === 'system'
              ? 'system'
              : type === 'agent'
                ? 'agent'
                : 'llm';

    events.push({
      id: row.id ?? `qoder-${i}`,
      sessionId,
      sequence: 0,
      kind,
      phase: 'understand',
      title: titleFromText(row.command ?? (text !== '' ? text : (tool ?? type))),
      startedAt: timestamp,
      durationMs,
      status,
      actor: role === 'user' ? 'user' : type === 'tool' || type === 'bash' ? 'assistant' : 'assistant',
      tool,
      tokens: tokensOf(row),
      error: status === 'error' ? titleFromText(text, 500) : null,
      hasInput: role === 'user' && text.length > 0,
      hasOutput: role !== 'user' && text.length > 0,
      hasRaw: true,
      inputSummary: role === 'user' && text.length > 0 ? text : null,
      outputSummary: role !== 'user' && text.length > 0 ? text : null,
      raw: JSON.stringify(row),
    } as EventWithRaw);
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  const classified = classifyEvents(deduped);
  const times = minMaxIso(classified);
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const session: TraceSession = {
    id: sessionId,
    provider: 'qoder',
    sourceAgent: 'Qoder',
    title: sample.session.title ?? classified.find((e) => e.kind === 'user_prompt')?.title ?? '',
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: classified.at(-1)?.status ?? 'unknown',
    cwd: null,
    messageCount: rows.length,
    eventCount: classified.length,
    tokenUsage: aggregateTokenUsage(classified, semantics),
    costUsd: 0,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath,
    totalDurationMs: wallClockDurationMs(classified),
    isSubagent: false,
    // qoder.ts:65 已按相邻时间戳算 durationMs（REQ-008）
    durationSource: 'derived' as const,
  };
  return { session, events: classified, tokenSemantics: semantics };
}

export const qoderAdapter: Adapter<{ id?: string; title?: string }, QoderRawRow> = {
  sourceAgent: 'Qoder',
  normalize: normalizeQoderSample,
};
