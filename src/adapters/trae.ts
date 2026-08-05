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
  /** server_history_info.token_usage = 真实总 token（input+output），不做 /2（2026-08-03 校准）。 */
  tokenUsage?: number;
  /** server_history_info.item_token_usage = output/completion token。input = tokenUsage - itemTokenUsage。 */
  itemTokenUsage?: number;
  outputTokens?: number;
  /** #7：history_v2.messages[].reasoning_content（llm_default 行）。 */
  reasoningContent?: string;
  /** #7：chat_message_task 工具调用（名称/参数/结果）。 */
  toolName?: string;
  toolParams?: string;
  toolResult?: string;
}

export interface TraeRecordShape {
  session: {
    id?: string;
    title?: string;
    startTime?: number;
    endTime?: number;
    /** #7：chat_session.agent_type / agent_name（agent 元数据）。 */
    agentType?: string;
    agentName?: string;
  };
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
      // #2/#3（审查 P0，2026-08-03 校准）：token_usage 是真实总 token，不再 /2。
      // output = item_token_usage，input = token_usage - item_token_usage。
      // item_token_usage 缺失时（旧库）退化为 output = token_usage、input = 0。
      const item = turn.itemTokenUsage ?? 0;
      const total = turn.tokenUsage ?? turn.outputTokens ?? item;
      const output = item > 0 ? item : Math.round(total);
      const input = item > 0 && total > item ? total - item : 0;
      tokens = {
        input,
        output,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        // §3（calibrate-tokens-and-compare-report）：Trae 无 cacheRead，netInput = input。
        netInput: input,
        total: input + output,
      };
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
      tool: turn.toolName ?? (['read_file', 'write_file', 'bash'].includes(type) ? type : null),
      tokens,
      error: status === 'error' ? titleFromText(turn.content ?? 'error', 500) : null,
      hasInput: turn.content != null,
      hasOutput: turn.content != null || turn.reasoningContent != null,
      hasRaw: true,
      inputSummary: null,
      // #7：llm 行无正文但 history_v2 提供 reasoning_content 时回退展示。
      outputSummary:
        turn.content != null
          ? titleFromText(turn.content, 5000)
          : turn.reasoningContent != null
            ? titleFromText(turn.reasoningContent, 5000)
            : null,
      raw: JSON.stringify(turn),
    } as EventWithRaw);
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  const times = minMaxIso(deduped);
  // #16（审查 P3）：Trae server_history_info 不含 cache.read 字段，
  // cacheRead 恒为 0；声明 incremental 仅是形式，不产生真实累加。
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const session: TraceSession = {
    id: record.id ?? `trae-${sourcePath}`,
    provider: 'trae',
    sourceAgent: record.agentName ?? 'Trae',
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
    // trae.ts:100 已按相邻时间戳算 durationMs，语义同 deriveDurations
    durationSource: 'derived' as const,
  };
  return { session, events: deduped, tokenSemantics: semantics };
}

export const traeAdapter: Adapter<TraeRecordShape['session'], TraeTurn> = {
  sourceAgent: 'Trae',
  normalize: normalizeTraeSample,
};
