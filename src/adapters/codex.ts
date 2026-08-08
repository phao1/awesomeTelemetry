import type {
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
  minMaxIso,
  normalizeStatus,
  orderEventsByTime,
  pickPrimaryModel,
  rollupSessionStatus,
  sessionTitleFromEvents,
  titleFromText,
  wallClockDurationMs,
} from './helpers.js';
import { computeCostUsd } from '../core/pricing.js';
import type { Adapter, RawSample } from './sample-loader.js';

/**
 * Codex `event_msg` / `token_count` 的用量结构。
 * `total_token_usage` 是会话累计快照，`last_token_usage` 是本轮增量；
 * 两者 key 与 Anthropic 完全不同（`cached_input_tokens` 而非
 * `cache_read_input_tokens`），且 `input_tokens` **已包含** cached 与 cache_write，
 * `reasoning_output_tokens` 是 `output_tokens` 的子集。
 */
export interface CodexTokenUsageInfo {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexRawPayload {
  type?: string;
  id?: string;
  role?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  input?: string;
  output?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }> | string;
  info?: {
    total_token_usage?: CodexTokenUsageInfo;
    last_token_usage?: CodexTokenUsageInfo;
    model_context_window?: number;
  };
  status?: string;
  session_id?: string;
  cwd?: string;
  /** task_started / task_complete / turn_aborted / turn_context 的轮次 id。 */
  turn_id?: string;
  /** world_state 的完整快照标记。 */
  full?: boolean;
  /** session_meta 带 model_provider，turn_context 带具体 model。 */
  model?: string;
  model_provider?: string;
  /** event_msg/agent_message 的正文是字符串；response_item/message 走 content。 */
  message?: string | { role?: string; content?: Array<{ type?: string; text?: string }> | string };
  /** event_msg/mcp_tool_call_end 的工具调用描述。 */
  invocation?: {
    server?: string;
    tool?: string;
    arguments?: unknown;
    title?: string;
  };
  /** mcp_tool_call_end 的结果体（{ Ok: ... } 或 { Err: ... }）。 */
  result?: unknown;
  /** web_search_end 的查询与动作。 */
  query?: string;
  action?: { type?: string; url?: string; [key: string]: unknown };
  /** tool_search_output 的候选工具列表。 */
  tools?: unknown[];
  /** patch_apply_end 的输出/错误/变更。 */
  stdout?: string;
  stderr?: string;
  success?: boolean;
  changes?: unknown;
  /** thread_goal_updated 的目标体。 */
  goal?: { objective?: string; [key: string]: unknown };
  threadId?: string;
  /** thread_rolled_back 回退的轮数。 */
  num_turns?: number;
  /** turn_aborted 的中断信息。 */
  reason?: string;
  started_at?: number;
  completed_at?: number;
  duration_ms?: number;
}

export interface CodexRawRow {
  timestamp?: string;
  type?: string;
  payload?: CodexRawPayload;
}

/**
 * Codex 的 `input_tokens` 是「本轮全部输入」，其中 cached / cache_write 是子集，
 * 而本项目 TokenUsage 约定 input 为**新鲜输入**（与 cacheRead / cacheWrite 不相交）。
 * 因此这里把子集减出去，让 input + cacheRead + cacheWrite 恰好还原 input_tokens，
 * 聚合后的 total 才等于 Codex 自报的 total_tokens。
 * reasoning ⊂ output，故 tokenSemantics.reasoningInTotal = false。
 */
function usageToTokens(usage: CodexTokenUsageInfo | undefined): TokenUsage | null {
  if (usage === undefined) {
    return null;
  }
  const rawInput = usage.input_tokens ?? 0;
  const cacheRead = usage.cached_input_tokens ?? 0;
  const cacheWrite = usage.cache_write_input_tokens ?? 0;
  const input = Math.max(0, rawInput - cacheRead - cacheWrite);
  const output = usage.output_tokens ?? 0;
  const reasoning = usage.reasoning_output_tokens ?? 0;
  if (rawInput === 0 && output === 0) {
    return null;
  }
  return {
    input, output, reasoning, cacheRead, cacheWrite,
    netInput: input,
    total: input + output + cacheRead + cacheWrite,
  };
}

/**
 * A4 / A6：`response_item` 流中代表「工具结果」的 payload 类型。
 * 新决策周期在**紧邻前一条 response_item 为工具结果**时开启（design A4）：
 * A1 文件里该形态是 `function_call_output`，08/06 起真实文件里同角色由
 * `custom_tool_call_output` 承担，`tool_search_output` 同理。
 * `task_started` **不是**边界（A1 结论 1）。
 */
const TOOL_RESULT_ITEM_TYPES = new Set([
  'function_call_output',
  'custom_tool_call_output',
  'tool_search_output',
]);

/** 一个决策周期的缓冲。 */
interface CycleState {
  /** 周期 key：开启该周期的 response_item 的 payload.id（A4）。 */
  key: string | null;
  rows: CodexRawRow[];
  /** 周期内是否存在 response_item/message role=assistant（agent_message 去重依据）。 */
  hasAssistantMessage: boolean;
  /** 周期内所有 token_count 的 last_token_usage 增量（A6：不产生独立事件）。 */
  usageIncrements: TokenUsage[];
  /** 周期内是否出现 event_msg/turn_aborted（A6：受影响事件置 cancelled）。 */
  hasTurnAborted: boolean;
}

/**
 * 周期 key 的兜底：payload.id 缺失（老 fixture）时退回 call_id，再退回行号。
 * 行号在同一源文件内稳定，跨重扫不漂移（A3.2）；不是时间/计数启发式（A4 禁项）。
 */
function cycleKeyOf(row: CodexRawRow, rowIndex: number): string {
  const payload = row.payload ?? {};
  if (typeof payload.id === 'string' && payload.id !== '') {
    return payload.id;
  }
  if (typeof payload.call_id === 'string' && payload.call_id !== '') {
    return payload.call_id;
  }
  return `codex-${rowIndex}`;
}

function contentText(payload: CodexRawPayload): string {
  if (typeof payload.content === 'string') {
    return payload.content;
  }
  return (payload.content ?? []).map((p) => p.text ?? '').join('\n');
}

/** agent_message 的正文是字符串字段，不是 content 数组。 */
function agentMessageText(payload: CodexRawPayload): string {
  return typeof payload.message === 'string' ? payload.message : contentText(payload);
}

/** 工具结果文本的错误探测：沿用现状（输出头 200 字符内命中 error/failed）。 */
function isErrorOutput(output: string): boolean {
  return /error|failed/i.test(output.slice(0, 200));
}

/** 把多次 token_count 的 last_token_usage 增量合并为一个 TokenUsage（增量相加）。 */
function mergeUsage(usages: TokenUsage[]): TokenUsage | null {
  if (usages.length === 0) {
    return null;
  }
  return usages.reduce<TokenUsage>(
    (acc, u) => ({
      input: acc.input + u.input,
      output: acc.output + u.output,
      reasoning: acc.reasoning + u.reasoning,
      cacheRead: acc.cacheRead + u.cacheRead,
      cacheWrite: acc.cacheWrite + u.cacheWrite,
      netInput: acc.netInput + u.netInput,
      total: acc.total + u.total,
    }),
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 0 },
  );
}

/**
 * A6：把 response_item / event_msg 映射到事件。
 *
 * 逐周期缓冲的原因：
 * - `event_msg/agent_message` 与 `response_item/message` 成对出现（A1 文件 16/17、
 *   34/35 行），必须先看完整周期才能决定去留（A6「UI 镜像是第二份消息」）；
 * - `token_count` 的用量要挂到周期的 assistant 事件，或在该周期无 assistant
 *   消息时生成单个 llm carrier（A6），同样需要先扫完整周期。
 */
function emitCycleEvents(
  cycle: CycleState,
  sessionId: string,
  modelState: { currentModel: string | null },
  syntheticId: { next: number },
): EventWithRaw[] {
  const events: EventWithRaw[] = [];
  /** carrier（无 assistant 消息的周期）要携带的原始 token_count 行。 */
  let carrierRaw: string | null = null;
  let carrierTimestamp: string | null = null;

  // 第一遍：收集 hasAssistantMessage 与 token_count 增量。
  for (const row of cycle.rows) {
    const payload = row.payload ?? {};
    if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      cycle.hasAssistantMessage = true;
    }
    if (payload.type === 'token_count') {
      const tokens = usageToTokens(payload.info?.last_token_usage);
      if (tokens !== null) {
        cycle.usageIncrements.push(tokens);
        if (carrierRaw === null) {
          carrierRaw = JSON.stringify(row);
          carrierTimestamp = row.timestamp ?? null;
        }
      }
    }
    if (payload.type === 'turn_aborted') {
      cycle.hasTurnAborted = true;
    }
  }

  const cancelled = cycle.hasTurnAborted;
  const usage = mergeUsage(cycle.usageIncrements);
  let assistantEvent: EventWithRaw | null = null;

  for (let i = 0; i < cycle.rows.length; i += 1) {
    const row = cycle.rows[i]!;
    const payload = row.payload ?? {};
    const timestamp = row.timestamp ?? '1970-01-01T00:00:00.000Z';
    const rowType = row.type ?? '';
    const type = payload.type ?? '';
    const status = normalizeStatus(payload.status ?? 'completed');
    // turn_context.model 标注其后的行（与现有行为一致，按行序生效）。
    if (payload.model !== undefined && payload.model !== '') {
      modelState.currentModel = payload.model;
    }
    const base = {
      id: payload.id ?? payload.call_id ?? `codex-${syntheticId.next++}`,
      sessionId,
      sequence: 0,
      phase: 'implement' as const,
      title: '',
      startedAt: timestamp,
      durationMs: 0,
      status,
      actor: 'assistant',
      tool: null,
      tokens: null as TokenUsage | null,
      error: null,
      hasInput: false,
      hasOutput: false,
      hasRaw: false,
      inputSummary: null,
      outputSummary: null,
      model: modelState.currentModel,
    };

    // ── session_meta 不是事件（A6），直接跳过 ──
    if (rowType === 'session_meta') {
      continue;
    }

    // ── token_count 不产生独立事件（A6）；用量由周期末尾统一挂载 ──
    if (type === 'token_count') {
      continue;
    }

    // ── response_item / message ──
    if (rowType === 'response_item' && type === 'message') {
      const role = payload.role;
      const text = contentText(payload);
      // A6：developer / system 角色是系统提示词（A1 结论 4），不是模型回复。
      if (role === 'developer' || role === 'system') {
        events.push({
          ...base,
          kind: 'system',
          title: titleFromText(text),
          actor: 'system',
          hasInput: text.length > 0,
          hasRaw: true,
          inputSummary: text.length > 0 ? text : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
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
        continue;
      }
      // role === assistant：模型的回复，A6 的 token 挂载目标。
      const event = {
        ...base,
        kind: 'llm',
        title: titleFromText(text),
        hasOutput: text.length > 0,
        hasRaw: true,
        outputSummary: text.length > 0 ? text : null,
        raw: JSON.stringify(row),
      } as EventWithRaw;
      events.push(event);
      assistantEvent = event;
      continue;
    }

    // ── response_item / reasoning ──
    if (rowType === 'response_item' && type === 'reasoning') {
      const text = contentText(payload);
      events.push({
        ...base,
        kind: 'reasoning',
        title: titleFromText(text),
        hasOutput: text.length > 0,
        hasRaw: true,
        outputSummary: text.length > 0 ? text : null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    // ── 工具调用（response_item 侧）──
    if (type === 'function_call' || type === 'custom_tool_call') {
      const name = payload.name ?? type;
      const input = type === 'custom_tool_call' ? payload.input : payload.arguments;
      events.push({
        ...base,
        kind: 'tool',
        title: titleFromText(name),
        tool: name,
        hasInput: input !== undefined && input !== '',
        hasRaw: true,
        inputSummary: input ?? null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    // ── 工具结果（response_item 侧）：按 call_id 配对（A6 / 2.12），不按相邻。
    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      const output = payload.output ?? '';
      const name = cycleToolName(cycle.rows, payload.call_id) ?? (type === 'custom_tool_call_output' ? 'custom_tool_call_output' : 'function_call_output');
      events.push({
        ...base,
        kind: 'tool',
        title: titleFromText(name),
        tool: name,
        status: isErrorOutput(output) ? 'error' : status,
        hasOutput: output.length > 0,
        hasRaw: true,
        outputSummary: output.length > 0 ? titleFromText(output, 5000) : null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    // ── web_search / tool_search（response_item 侧）──
    if (type === 'web_search_call') {
      const url = typeof payload.action?.url === 'string' ? payload.action.url : '';
      events.push({
        ...base,
        kind: 'tool',
        title: 'web_search',
        tool: 'web_search',
        hasInput: url.length > 0,
        hasRaw: true,
        inputSummary: url.length > 0 ? url : null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }
    if (type === 'tool_search_call') {
      const args = payload.arguments ?? '';
      events.push({
        ...base,
        kind: 'tool',
        title: 'tool_search',
        tool: 'tool_search',
        hasInput: typeof args === 'string' && args.length > 0,
        hasRaw: true,
        inputSummary: typeof args === 'string' ? args : JSON.stringify(args),
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }
    if (type === 'tool_search_output') {
      const toolsJson = JSON.stringify(payload.tools ?? null);
      const name = cycleToolName(cycle.rows, payload.call_id) ?? 'tool_search';
      events.push({
        ...base,
        kind: 'tool',
        title: name,
        tool: name,
        hasOutput: toolsJson !== 'null',
        hasRaw: true,
        outputSummary: toolsJson !== 'null' ? titleFromText(toolsJson, 5000) : null,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    // ── event_msg 侧 ──
    if (rowType === 'event_msg') {
      // A6：agent_reasoning 是推理记录。
      if (type === 'agent_reasoning') {
        const text = payload.text ?? '';
        events.push({
          ...base,
          kind: 'reasoning',
          title: titleFromText(text),
          hasOutput: text.length > 0,
          hasRaw: true,
          outputSummary: text.length > 0 ? text : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
      // A6：agent_message 是 UI 镜像；与 response_item/message 成对时丢弃，
      // 周期无 assistant 消息时才保留为模型回复。
      if (type === 'agent_message') {
        if (cycle.hasAssistantMessage) {
          continue;
        }
        const text = agentMessageText(payload);
        const event = {
          ...base,
          kind: 'llm',
          title: titleFromText(text),
          hasOutput: text.length > 0,
          hasRaw: true,
          outputSummary: text.length > 0 ? text : null,
          raw: JSON.stringify(row),
        } as EventWithRaw;
        events.push(event);
        assistantEvent = event;
        continue;
      }
      // A6：patch_apply_end → file_write。
      if (type === 'patch_apply_end') {
        const stdout = payload.stdout ?? '';
        const failed = payload.success === false || isErrorOutput(stdout);
        events.push({
          ...base,
          kind: 'file_write',
          title: 'patch_apply_end',
          tool: 'patch_apply_end',
          status: failed ? 'error' : status,
          hasOutput: stdout.length > 0,
          hasRaw: true,
          outputSummary: stdout.length > 0 ? titleFromText(stdout, 5000) : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
      // A6：mcp_tool_call_end → tool（名称取自 invocation）。
      if (type === 'mcp_tool_call_end') {
        const name = payload.invocation?.tool ?? payload.invocation?.server ?? 'mcp_tool_call_end';
        const args = payload.invocation?.arguments;
        const result = payload.result;
        const argsJson = args === undefined ? null : JSON.stringify(args);
        const resultJson = result === undefined ? null : JSON.stringify(result);
        events.push({
          ...base,
          kind: 'tool',
          title: titleFromText(name),
          tool: name,
          hasInput: argsJson !== null,
          hasOutput: resultJson !== null,
          hasRaw: true,
          inputSummary: argsJson,
          outputSummary: resultJson !== null ? titleFromText(resultJson, 5000) : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
      // A6：web_search_end → tool（与 web_search_call 同 key 配对）。
      if (type === 'web_search_end') {
        const query = payload.query ?? '';
        const name = cycleToolName(cycle.rows, payload.call_id) ?? 'web_search';
        events.push({
          ...base,
          kind: 'tool',
          title: name,
          tool: name,
          hasOutput: query.length > 0,
          hasRaw: true,
          outputSummary: query.length > 0 ? query : null,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
      // A6：context_compacted → compact。
      if (type === 'context_compacted') {
        events.push({
          ...base,
          kind: 'compact',
          title: 'context_compacted',
          actor: 'system',
          hasRaw: true,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
      // A6：turn_aborted → system 且置 cancelled（周期事件统一由 hasTurnAborted 处理）。
      if (type === 'turn_aborted') {
        events.push({
          ...base,
          kind: 'system',
          title: 'turn_aborted',
          actor: 'system',
          status: 'cancelled',
          hasRaw: true,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
      // A6：task_started / task_complete / thread_* / user_message 保持 system。
      if (
        type === 'task_started' ||
        type === 'task_complete' ||
        type === 'thread_settings_applied' ||
        type === 'thread_goal_updated' ||
        type === 'thread_rolled_back' ||
        type === 'user_message'
      ) {
        events.push({
          ...base,
          kind: 'system',
          title: type,
          actor: 'system',
          hasRaw: true,
          raw: JSON.stringify(row),
        } as EventWithRaw);
        continue;
      }
    }

    // ── turn_context / world_state（顶层类型，payload.type 为空）保持 system ──
    if (rowType === 'turn_context' || rowType === 'world_state') {
      events.push({
        ...base,
        kind: 'system',
        title: rowType,
        actor: 'system',
        hasRaw: true,
        raw: JSON.stringify(row),
      } as EventWithRaw);
      continue;
    }

    // A6 / 2.13：未在 A6 命名的 payload 类型仍然回落 system —— 修复收窄了
    // 兜底分支，但没有移除它。
    events.push({
      ...base,
      kind: 'system',
      title: titleFromText(type ?? 'system'),
      actor: 'system',
      hasRaw: true,
      raw: JSON.stringify(row),
    } as EventWithRaw);
  }

  // A6：token_count 的用量挂到周期的 assistant 事件；周期无 assistant 消息时
  // 生成单个 llm carrier（不产生独立 token_count 事件）。
  if (usage !== null) {
    if (assistantEvent !== null) {
      assistantEvent.tokens = usage;
    } else {
      events.push({
        id: `codex-${syntheticId.next++}`,
        sessionId,
        sequence: 0,
        kind: 'llm',
        phase: 'implement' as const,
        title: 'token_count',
        startedAt: carrierTimestamp ?? cycle.rows[0]?.timestamp ?? '1970-01-01T00:00:00.000Z',
        durationMs: 0,
        status: 'success',
        actor: 'assistant',
        tool: null,
        tokens: usage,
        error: null,
        hasInput: false,
        hasOutput: false,
        hasRaw: true,
        inputSummary: null,
        outputSummary: null,
        model: modelState.currentModel,
        raw: carrierRaw,
      } as EventWithRaw);
    }
  }

  // A6：turn_aborted 令受影响周期的事件全部携带 cancelled 状态。
  if (cancelled) {
    return events.map((event) => ({ ...event, status: 'cancelled' as const }));
  }
  return events;
}

/**
 * 工具结果按源 call_id 配对（A6 / 2.12）。A1 实测量到的形态：
 * 调用的 call_id 为 `call_00_…`，结果侧可能是同一 id 或带 `:N` 后缀
 * （`call_00_…:38`，旧实现 id=call_id 去重后的数据库形态）。配对比较前剥离
 * `:N` 后缀，绝不依赖相邻关系 —— 并发工具（08/06 文件里两把调用的输出相邻
 * 成对）会破坏相邻假设。
 */
function cycleToolName(rows: CodexRawRow[], callId: string | undefined): string | null {
  if (callId === undefined || callId === '') {
    return null;
  }
  const normalized = callId.replace(/:\d+$/, '');
  for (const row of rows) {
    const payload = row.payload ?? {};
    if (
      (payload.type === 'function_call' || payload.type === 'custom_tool_call') &&
      payload.call_id !== undefined &&
      payload.call_id.replace(/:\d+$/, '') === normalized
    ) {
      return payload.name ?? payload.type;
    }
  }
  return null;
}

export function normalizeCodexSample(
  sample: RawSample<Record<string, never>, CodexRawRow>,
  sourcePath: string,
): TraceRecord {
  const rows = sample.events;
  const sessionId =
    rows.find((r) => r.payload?.session_id !== undefined && r.payload?.session_id !== '')
      ?.payload?.session_id ?? `codex-${sourcePath}`;
  let cwd: string | null = null;
  /** 末条 token_count 的累计快照，作为会话总量的权威口径。 */
  let finalTotalUsage: TokenUsage | null = null;

  // ── 周期切分（A4）：新周期在紧邻前一条 response_item 为工具结果时开启 ──
  const cycles: CycleState[] = [];
  let open: CycleState | null = null;
  let prevResponseItemType: string | null = null;
  /** 首个 response_item 之前的行（如 task_started）挂到首个周期（A3.5）。 */
  const preCycleRows: CodexRawRow[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const payload = row.payload ?? {};
    // session 元数据提取（session_meta 同时被跳过，不产生事件）。
    if (payload.cwd !== undefined && cwd === null) {
      cwd = payload.cwd;
    }
    if (payload.type === 'token_count' && payload.info?.total_token_usage !== undefined) {
      finalTotalUsage = usageToTokens(payload.info.total_token_usage) ?? finalTotalUsage;
    }

    if (row.type === 'response_item') {
      if (open === null) {
        open = {
          key: cycleKeyOf(row, i),
          rows: [...preCycleRows],
          hasAssistantMessage: false,
          usageIncrements: [],
          hasTurnAborted: false,
        };
        cycles.push(open);
      } else if (
        prevResponseItemType !== null &&
        TOOL_RESULT_ITEM_TYPES.has(prevResponseItemType) &&
        // 工具结果本身不开启周期：并发工具的结果会连续出现（08/06 真实文件里
        // 两把并发调用的输出相邻成对），逐条开周期会把一次推理的工具批次切成
        // 两把 key，违背 A3
        // 「一次推理与它触发的工具活动共享一把 key」与 A1 结论 2 的
        // 「落在读者会画的地方」。
        !TOOL_RESULT_ITEM_TYPES.has(payload.type ?? '')
      ) {
        open = {
          key: cycleKeyOf(row, i),
          rows: [],
          hasAssistantMessage: false,
          usageIncrements: [],
          hasTurnAborted: false,
        };
        cycles.push(open);
      }
      open.rows.push(row);
      prevResponseItemType = payload.type ?? '';
    } else {
      if (open === null) {
        preCycleRows.push(row);
      } else {
        open.rows.push(row);
      }
    }
  }

  const modelState = { currentModel: null as string | null };
  const syntheticId = { next: 0 };
  // 无任何 response_item 的退化样本（如只有 token_count 的旧会话）：把所有行
  // 并入一个隐式周期，turnKey 为 null（A3.4），用量仍以 carrier 形式保留。
  if (cycles.length === 0 && preCycleRows.length > 0) {
    cycles.push({
      key: null,
      rows: preCycleRows,
      hasAssistantMessage: false,
      usageIncrements: [],
      hasTurnAborted: false,
    });
  }
  const events: EventWithRaw[] = [];
  for (const cycle of cycles) {
    const cycleEvents = emitCycleEvents(cycle, sessionId, modelState, syntheticId);
    events.push(
      ...cycleEvents.map((event) => ({
        ...event,
        turnKey: cycle.key,
      })),
    );
  }

  const ordered = orderEventsByTime(events);
  const deduped = dedupeEventIds(ordered);
  // P0-A：Codex JSONL 不记录事件耗时，按相邻时间戳推导
  const timed = deriveDurations(deduped);
  const classified = classifyEvents(timed);
  const times = minMaxIso(classified);
  // last_token_usage 是逐轮增量，供事件级归因；
  // reasoning_output_tokens ⊂ output_tokens，计入 total 会双计。
  const semantics = {
    cacheRead: 'incremental' as const,
    reasoning: 'incremental' as const,
    reasoningInTotal: false,
  };
  // 会话总量以 Codex 自己维护的累计快照为准：实测逐轮增量之和会比末条
  // total_token_usage 高出 0.3%~0.5%（重试轮会重复计入 last_token_usage），
  // 而累计快照正是 Codex 自身向用户展示的口径。快照缺失时才退回逐事件求和。
  const tokenUsage = finalTotalUsage ?? aggregateTokenUsage(classified, semantics);
  const primaryModel = pickPrimaryModel(classified);
  const cost = computeCostUsd(tokenUsage, primaryModel);
  const session: TraceSession = {
    id: sessionId,
    provider: 'codex',
    sourceAgent: 'Codex',
    title: sessionTitleFromEvents(classified),
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: rollupSessionStatus(classified),
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
  return {
    session,
    events: classified,
    tokenSemantics: semantics,
    // A5：周期边界由 response_item 流自身的形状推导，源格式没有显式标注。
    turnKeySource: 'stream_structure',
  };
}

export const codexAdapter: Adapter<Record<string, never>, CodexRawRow> = {
  sourceAgent: 'Codex',
  normalize: normalizeCodexSample,
};
