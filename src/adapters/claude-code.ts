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
  /** 每行都带工作目录；此前从未被读取，导致 cwd 全库为 NULL。 */
  cwd?: string;
  message?: ClaudeRawMessage;
}

/** fix-adapter-turn-semantics A7：user 行的 content 可能是 tool_result 块。 */
interface ClaudeToolResultPart extends ClaudeContentPart {
  type: 'tool_result';
  tool_use_id?: string;
  is_error?: boolean;
}

function isToolResultPart(part: ClaudeContentPart): part is ClaudeToolResultPart {
  return part.type === 'tool_result';
}

/** 从 tool_result 的 content（string | 内容块数组 | 含 text 的对象）提取文本。 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => toolResultText(block))
      .filter((text) => text.length > 0)
      .join('\n');
  }
  if (content !== null && typeof content === 'object' && 'text' in content) {
    return toolResultText((content as { text?: unknown }).text);
  }
  return '';
}

function usageToTokens(usage: ClaudeRawMessage['usage']): TokenUsage | null {
  if (usage === undefined) {
    return null;
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  // #8：total 与 aggregateTokenUsage 一致，含 cacheWrite。
  return {
    input,
    output,
    reasoning: 0,
    cacheRead,
    cacheWrite,
    netInput: Math.max(0, input - cacheRead),
    total: input + output + cacheRead + cacheWrite,
  };
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

  // A4 claude 行（A3 规则 5）：genuine user prompt 与 system 行携带「其后第一条
  // assistant 消息的 message.id」作为下一周期的 key；之后没有 assistant 时为 null。
  const nextAssistantIds: Array<string | null> = new Array(rows.length).fill(null);
  {
    let next: string | null = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      nextAssistantIds[i] = next;
      const id = rows[i]?.message?.id;
      if (rows[i]?.type === 'assistant' && id !== undefined && id !== '') {
        next = id;
      }
    }
  }

  // A7：tool_use part 的事件按 toolu_… id 登记；tool_result 行据此回填输出侧。
  const toolEventsById = new Map<string, EventWithRaw>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    const timestamp = row.timestamp ?? '1970-01-01T00:00:00.000Z';
    const message = row.message;
    const parts = partsOf(message ?? {});
    const status = normalizeStatus(message?.status ?? 'completed');

    if (row.type === 'user') {
      const toolResults = parts.filter(isToolResultPart);
      if (toolResults.length > 0) {
        // A7：user 行的 content 是 tool_result 块 → 不是 user prompt，不产生
        // user_prompt 事件，也不计入 messageCount。
        for (const block of toolResults) {
          const text = toolResultText(block.content);
          const target = toolEventsById.get(block.tool_use_id ?? '');
          if (target !== undefined) {
            // 结果回填到调用它的 tool 事件；turnKey 继承该事件的 key（A4：
            // tool_result 经 toolu_… id 解析后继承 assistant 消息的 message.id）。
            target.outputSummary = text.length > 0 ? text : null;
            target.hasOutput = true;
          } else {
            // 无匹配 tool_use → 只带结果侧的 tool 事件，status 反映 is_error。
            // 绝不丢弃，也绝不转回 user message。
            events.push({
              id: block.tool_use_id ?? `tool-result-${events.length}`,
              sessionId,
              sequence: 0,
              turnKey: null,
              kind: 'tool',
              phase: 'implement',
              title: titleFromText(text),
              startedAt: timestamp,
              durationMs: 0,
              status: block.is_error === true ? 'error' : 'success',
              actor: 'assistant',
              tool: null,
              tokens: null,
              error: null,
              hasInput: false,
              hasOutput: true,
              hasRaw: true,
              inputSummary: null,
              outputSummary: text.length > 0 ? text : null,
              raw: JSON.stringify(block),
            } as EventWithRaw);
          }
        }
        continue;
      }

      messageCount += 1;
      const text = parts.map((p) => p.text ?? '').join('\n');
      events.push({
        id: message?.id ?? `user-${events.length}`,
        sessionId,
        sequence: 0,
        turnKey: nextAssistantIds[rowIndex],
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
      // A4 claude 行：assistant 行的 message.id 是本周期 key。3.6：显式携带
      // message id，绝不从 event.id 反解析（tool 事件的公共 id 是 toolu_…）。
      const turnKey = message?.id ?? null;
      let partIndex = 0;
      for (const part of parts) {
        partIndex += 1;
        if (part.type === 'tool_use') {
          const tool = part.name ?? '';
          const event: EventWithRaw = {
            id: part.id ?? `${message?.id ?? 'assistant'}-${partIndex}`,
            sessionId,
            sequence: 0,
            turnKey,
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
          } as EventWithRaw;
          events.push(event);
          if (part.id !== undefined) {
            toolEventsById.set(part.id, event);
          }
          continue;
        }
        events.push({
          id: `${message?.id ?? 'assistant'}-${partIndex}`,
          sessionId,
          sequence: 0,
          turnKey,
          kind: 'llm',
          phase: 'implement',
          title: titleFromText(part.text),
          startedAt: timestamp,
          durationMs: 0,
          status,
          actor: 'assistant',
          tool: null,
          // P0-B：源数据一直带 model，此前从未被读取
          model: message?.model ?? null,
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
        turnKey: nextAssistantIds[rowIndex],
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
  // P0-A：Claude JSONL 不记录事件耗时，按相邻时间戳推导（durationSource='derived'）
  const timed = deriveDurations(deduped);
  const classified = classifyEvents(timed);
  const times = minMaxIso(classified);
  const semantics = { cacheRead: 'incremental' as const, reasoning: 'incremental' as const };
  const tokenUsage = aggregateTokenUsage(classified, semantics);
  const primaryModel = pickPrimaryModel(classified);
  const cost = computeCostUsd(tokenUsage, primaryModel);
  const session: TraceSession = {
    id: sessionId,
    provider: 'claude',
    sourceAgent: 'Claude',
    title: sessionTitleFromEvents(classified),
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
    status: rollupSessionStatus(classified),
    cwd: rows.find((r) => r.cwd !== undefined && r.cwd !== '')?.cwd ?? null,
    messageCount,
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
    // A5：按源自身的消息标识（assistant message.id）分组 → message_identity。
    turnKeySource: 'message_identity',
  };
}

export const claudeAdapter: Adapter<Record<string, never>, ClaudeRawRow> = {
  sourceAgent: 'Claude',
  normalize: normalizeClaudeSample,
};
