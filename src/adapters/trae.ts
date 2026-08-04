import type { TraceEvent, TracePhase, TraceRecord, TraceSession, TraceStatus } from '../core/trace-types.js';
import {
  aggregateTokenUsage,
  dedupeEventIds,
  type EventWithRaw,
  minMaxIso,
  normalizeStatus,
  orderEventsByTime,
  titleFromText,
  toIsoFromSeconds,
  wallClockDurationMs,
} from './helpers.js';
import type { Adapter, RawSample } from './sample-loader.js';

export interface TraeTurn {
  id: string;
  sessionId?: string;
  type: string;
  status?: string;
  /** 秒级时间戳，adapter 内 ×1000 转 ISO（database.md §5 唯一例外）。 */
  startTime?: number;
  endTime?: number;
  content?: string;
  command?: string;
  /** 只有 content_source === 'llm_default' 时计入 outputTokens（G4.3）。 */
  contentSource?: string;
  /** 双向累计 token，需 /2 校准（G4.2）。 */
  tokenUsage?: number;
  outputTokens?: number;
}

export interface TraeRecordShape {
  session: { id?: string; title?: string; startTime?: number; endTime?: number };
  turns: TraeTurn[];
}

/** REQ-006：phase 内联映射。bash 命中测试正则时为 verify。 */
const TRAE_PHASE: Record<string, TracePhase> = {
  read_file: 'understand',
  write_file: 'implement',
  reasoning: 'plan',
  bash: 'implement',
  llm: 'implement',
  message: 'implement',
  user: 'understand',
};

const TEST_CMD = /(npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint)/;

function kindOfType(type: string): TraceEvent['kind'] {
  switch (type) {
    case 'read_file':
      return 'file_read';
    case 'write_file':
      return 'file_write';
    case 'reasoning':
    case 'llm':
      return 'llm';
    case 'bash':
      return 'bash';
    case 'user':
      return 'user_prompt';
    case 'message':
      return 'message';
    default:
      return 'tool';
  }
}

export function normalizeTraeSample(
  sample: RawSample<TraeRecordShape['session'], TraeTurn>,
  sourcePath: string,
): TraceRecord {
  const record = sample.session;
  const turns = sample.events;
  const events: EventWithRaw[] = [];

  for (const turn of turns) {
    const status: TraceStatus = normalizeStatus(turn.status ?? 'completed');
    const type = turn.type ?? 'tool';
    const phase = TRAE_PHASE[type] ?? 'implement';
    const startedAt =
      turn.startTime !== undefined ? toIsoFromSeconds(turn.startTime) : new Date(0).toISOString();
    const durationMs =
      turn.startTime !== undefined && turn.endTime !== undefined
        ? Math.max(0, Math.round((turn.endTime - turn.startTime) * 1000))
        : 0;

    let tokens: EventWithRaw['tokens'] = null;
    if (turn.contentSource === 'llm_default') {
      // G4.2：token_usage / 2 校准；G4.3：仅 llm_default 计入 outputTokens
      const output = Math.round((turn.tokenUsage ?? turn.outputTokens ?? 0) / 2);
      tokens = { input: 0, output, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: output };
    }

    events.push({
      id: turn.id,
      sessionId: turn.sessionId ?? record.id ?? '',
      sequence: 0,
      kind: kindOfType(type),
      phase: type === 'bash' && turn.command !== undefined && TEST_CMD.test(turn.command) ? 'verify' : phase,
      title: titleFromText(turn.content ?? turn.command ?? type),
      startedAt,
      durationMs,
      status,
      actor: type === 'user' ? 'user' : 'assistant',
      tool: ['read_file', 'write_file', 'bash'].includes(type) ? type : null,
      tokens,
      error: status === 'error' ? titleFromText(turn.content ?? 'error', 500) : null,
      hasInput: turn.content !== undefined && turn.content !== undefined,
      hasOutput: turn.content !== undefined,
      hasRaw: true,
      inputSummary: null,
      outputSummary: turn.content !== undefined ? titleFromText(turn.content, 5000) : null,
      raw: JSON.stringify(turn),
    } as EventWithRaw);
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  const times = minMaxIso(deduped);
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const session: TraceSession = {
    id: record.id ?? `trae-${sourcePath}`,
    provider: 'trae',
    sourceAgent: 'Trae',
    title: titleFromText(record.title ?? ''),
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: deduped.at(-1)?.status ?? 'unknown',
    cwd: null,
    messageCount: turns.length,
    eventCount: deduped.length,
    tokenUsage: aggregateTokenUsage(deduped, semantics),
    costUsd: 0,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath,
    totalDurationMs: wallClockDurationMs(deduped),
    isSubagent: false,
  };
  return { session, events: deduped, tokenSemantics: semantics };
}

export const traeAdapter: Adapter<TraeRecordShape['session'], TraeTurn> = {
  sourceAgent: 'Trae',
  normalize: normalizeTraeSample,
};
