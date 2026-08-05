import type { TraceEvent, TracePhase, TraceRecord, TraceSession, TraceStatus } from '../core/trace-types.js';
import {
  aggregateTokenUsage,
  dedupeEventIds,
  DERIVED_DURATION_CAP_MS,
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

/**
 * §5.1（calibrate-tokens-and-compare-report）：Trae 真实工具名来自
 * chat_message_task.tool_name（PascalCase），当前全部落进 'tool' 兜底。
 * 按 toolName 小写归一化后的二级映射；**turn.type 优先级更高**（Trae 自己的一级
 * 分类更可信），type 落兜底时才看 toolName。
 *
 * ⚠️ 清单来自外部变更说明，本仓库无真实 Trae 库可实测（traeKeyPath=null，
 * 路径为 Windows %APPDATA%），见 TODO(D-013)。
 */
const BASH_TOOL_NAMES = new Set([
  'bash', 'terminal', 'runcommand', 'run_command', 'executecommand',
]);
const READ_TOOL_NAMES = new Set([
  'read', 'readfile', 'read_file', 'glob', 'grep', 'ls', 'codesearch',
  'search', 'view',
]);
const WRITE_TOOL_NAMES = new Set([
  'write', 'writefile', 'write_file', 'edit', 'searchreplace',
  'search_replace', 'str_replace', 'create',
]);

/**
 * B8（calibrate-tokens §10）：Trae 子代理 agent_type 名单。
 * 外部变更说明实测的子代理是 refactor_scoper / refactor_finder /
 * refactor_planner（独立 session_id）；本仓库无真实 Trae 库可核验
 * （TODO(D-016)），名单未实测。匹配到名单 → isSubagent=true，交给既有
 * buildSubagentMergeGroups（session-merge.ts）按时间窗成组，不新写合并逻辑。
 */
const SUBAGENT_AGENT_TYPES = new Set([
  'refactor_scoper',
  'refactor_finder',
  'refactor_planner',
]);

function kindOfTurn(type: string, toolName: string | undefined): TraceEvent['kind'] {
  const byType = kindOfType(type);
  if (byType !== 'tool' || toolName === undefined || toolName === '') {
    return byType;
  }
  const name = toolName.toLowerCase();
  if (BASH_TOOL_NAMES.has(name)) {
    return 'bash';
  }
  if (READ_TOOL_NAMES.has(name)) {
    return 'file_read';
  }
  if (WRITE_TOOL_NAMES.has(name)) {
    return 'file_write';
  }
  return 'tool';
}

/**
 * §5.4：tool_call 状态兜底 —— 仅当 turn.status 缺失/为空时才读 toolResult
 * 关键词；`turn.status` 有值时以它为准。否则一个成功的 `grep "error" app.log`
 * 必然被误判失败（design §5.4 / R6：宁可漏判）。
 */
function turnStatus(turn: TraeTurn): TraceStatus {
  const raw = turn.status;
  if (raw !== undefined && raw !== null && raw.trim() !== '') {
    return normalizeStatus(raw);
  }
  if (turn.toolResult !== undefined && /\b(error|failed|failure|exception|traceback)\b/i.test(turn.toolResult)) {
    return 'error';
  }
  return normalizeStatus('completed');
}

/**
 * §5.3：同时间戳事件组的时长分摊。Trae 的 tool_call 共享父消息时间戳 → 一组事件
 * startedAt 完全相同 → 组内 durationMs 全为 0（无 endTime 时）。规则：
 * - 按 startedAt 分组（非 user_prompt 成员），gap = 下一组 startedAt − 本组 startedAt；
 * - 组内每个事件 durationMs = floor(gap / n)，余数给最后一个（组内求和 == gap）；
 * - 单值上限沿用 DERIVED_DURATION_CAP_MS（复用，不新定义）；
 * - user_prompt 不参与（gap 属于 TimeComposition.userWait，REQ-012）；
 * - 有实测 endTime 的组保持实测值不重算。
 */
function splitSameTimestampDurations(events: EventWithRaw[]): EventWithRaw[] {
  const byId = new Map<string, number>();
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.startedAt === b.event.startedAt
        ? a.index - b.index
        : a.event.startedAt < b.event.startedAt
          ? -1
          : 1,
    );
  for (let i = 0; i < sorted.length; ) {
    const startedAt = sorted[i]!.event.startedAt;
    let j = i;
    while (j < sorted.length && sorted[j]!.event.startedAt === startedAt) {
      j += 1;
    }
    const group = sorted.slice(i, j).filter(({ event }) => event.kind !== 'user_prompt');
    // 仅当组内全部成员无实测时长（durationMs === 0）时才分摊
    if (group.length > 0 && group.every(({ event }) => event.durationMs === 0)) {
      const next = sorted.slice(j).find(({ event }) => event.kind !== 'user_prompt');
      const gap =
        next === undefined
          ? 0
          : Date.parse(next.event.startedAt) - Date.parse(startedAt);
      if (gap > 0 && Number.isFinite(gap)) {
        const per = Math.floor(gap / group.length);
        const remainder = gap - per * group.length;
        group.forEach(({ event }, k) => {
          const share = k === group.length - 1 ? per + remainder : per;
          byId.set(event.id, Math.min(share, DERIVED_DURATION_CAP_MS));
        });
      }
    }
    i = j;
  }
  if (byId.size === 0) {
    return events;
  }
  return events.map((event) =>
    byId.has(event.id) ? { ...event, durationMs: byId.get(event.id)! } : event,
  );
}

export function normalizeTraeSample(
  sample: RawSample<TraeRecordShape['session'], TraeTurn>,
  sourcePath: string,
): TraceRecord {
  const record = sample.session;
  const turns = sample.events;
  const events: EventWithRaw[] = [];
  const sessionStartedAt =
    record.startTime !== undefined
      ? toIsoFromSeconds(record.startTime)
      : null;

  let previousStartedAt: string | null = null;
  for (const turn of turns) {
    const status: TraceStatus = turnStatus(turn);
    const type = turn.type ?? 'tool';
    const phase = TRAE_PHASE[type] ?? 'implement';
    // §5.2：startTime 缺失时继承前一个事件的 startedAt（首个事件用会话
    // startedAt），而不是 new Date(0) 甩到时间线最前。
    const startedAt: string =
      turn.startTime !== undefined
        ? toIsoFromSeconds(turn.startTime)
        : previousStartedAt ?? sessionStartedAt ?? new Date(0).toISOString();
    previousStartedAt = startedAt;
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
      kind: kindOfTurn(type, turn.toolName),
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

  // §5.3：分摊在排序/去重之前做，组按 startedAt 判定。
  const split = splitSameTimestampDurations(events);
  const ordered = orderEventsByTime(split);
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
    isSubagent:
      record.agentType !== undefined &&
      record.agentType !== '' &&
      SUBAGENT_AGENT_TYPES.has(record.agentType.toLowerCase()),
    // trae.ts:100 已按相邻时间戳算 durationMs，语义同 deriveDurations
    durationSource: 'derived' as const,
  };
  return { session, events: deduped, tokenSemantics: semantics };
}

export const traeAdapter: Adapter<TraeRecordShape['session'], TraeTurn> = {
  sourceAgent: 'Trae',
  normalize: normalizeTraeSample,
};
