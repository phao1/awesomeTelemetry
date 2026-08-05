import type { SpeedMetrics, TokenUsage, TraceEvent, TraceRecord } from './trace-types.js';

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * change calibrate-tokens-and-compare-report §2（最重要裁决）：Token 归因纯函数。
 *
 * 实测方向（2026-08-05，`~/.local/share/opencode/opencode.db`）：
 * 真实 OpenCode v2+ 的 assistant 消息 part 顺序为
 *   step-start → reasoning → text/tool → step-finish（token 载体，位于最后）
 * —— 本仓库适配器里 step-finish 因 type !== 'step' 落入 kind='llm' 且按
 * `isTokenCarrier` 挂在最后 part 上，所以真实数据不需要归因；但旧形状/夹具里
 * `type === 'step'` 的 part 会被映射成 kind='agent' 并携带 token，使同一消息内的
 * llm 文本事件无 token，tps / tpotMs 恒为 null。归因就是为这个形状准备的。
 *
 * 三条规则（design §2，缺一不可）：
 * 1. **1:1，不是 1:N** —— 一个 carrier 的 token 只归因给同一消息内**一个** llm 事件；
 *    消费后不再参与匹配（carrier 只能属于一个消息，同消息内只取第一个 carrier）。
 * 2. 方向按实测：carrier 优先归给同一消息内**紧邻其前**的 llm 事件（真实数据 text
 *    在 step-finish 之前）；carrier 之前无 llm 时，归给 carrier 之后最近的 llm。
 * 3. **跨消息不归因** —— 事件 id 必须形如 `${message.id}-${partIndex}`（含去重
 *    `:N` 后缀），否则跳过。
 *
 * ⚠️ 返回的 Map 是只读归因结果，**禁止写回 `event.tokens`**：写回会让
 * `aggregateTokenUsage` 把 carrier 与归因事件各算一遍，精确复现外部变更说明 §4.1
 * 的双计 bug（6,217,079 vs 正确值 3,249,125）。回归护栏见 opencode.test.ts。
 */
const MESSAGE_PART_ID = /^(.*)-(\d+)(?::\d+)?$/;

export function attributeTokensToLlmEvents(record: TraceRecord): Map<string, TokenUsage> {
  const attributed = new Map<string, TokenUsage>();
  const byMessage = new Map<string, Array<{ event: TraceEvent; partIndex: number }>>();
  for (const event of record.events) {
    const match = MESSAGE_PART_ID.exec(event.id);
    if (match === null) {
      continue; // 非 `${message.id}-${partIndex}` 形状（OTel span 等），不参与归因
    }
    const messageId = match[1]!;
    const partIndex = Number(match[2]!);
    const list = byMessage.get(messageId) ?? [];
    list.push({ event, partIndex });
    byMessage.set(messageId, list);
  }

  for (const list of byMessage.values()) {
    // isTokenCarrier 语义下每条消息至多一个 carrier；防御性只取第一个有 token 的。
    const carrier = list.find((entry) => entry.event.tokens !== null);
    if (carrier === undefined) {
      continue;
    }
    const llmCandidates = list
      .filter((entry) => entry.event.kind === 'llm' && entry.event.tokens === null)
      .sort((a, b) => a.partIndex - b.partIndex);
    if (llmCandidates.length === 0) {
      continue;
    }
    // 规则 2：真实数据 text 在 step-finish 之前 → 优先取 carrier 前最近的 llm；
    // carrier 之前没有 llm（旧形状 step 在开头）→ 取 carrier 之后最近的 llm。
    const before = llmCandidates.filter((entry) => entry.partIndex < carrier.partIndex);
    const target = before.length > 0 ? before[before.length - 1]! : llmCandidates[0]!;
    // carrier 由 find(tokens !== null) 选出，此处必为非 null
    attributed.set(target.event.id, carrier.event.tokens!);
  }
  return attributed;
}

/**
 * REQ-006：速度指标（运行时计算，不持久化）。
 * G4.1：pureInferenceMs 只累计 llm 事件 durationMs——adapter 层取 InferHub.inference_duration
 * 写入 durationMs，Kernel-Inference（含 Tool 时间）不得进入。
 *
 * 2026-08-04 审查校准：
 * - #1 TTFT = 首个 user_prompt 到首个 llm 的 startedAt 时间差（不是 llm 自身 duration）
 * - #11 TPS = 每事件 output/duration 的算术平均（与主项目对齐），不再是聚合比率
 * - #12 avgLlmResponseLatencyMs = user_prompt 到下一个 llm 的响应延迟均值
 * - #13 TPS/TPOT 只纳入 tokens.output > 0 且 durationMs > 0 的有效 llm 事件
 */
export function computeSpeedMetrics(record: TraceRecord): SpeedMetrics {
  const events = record.events;
  const allLlmEvents = events.filter((e) => e.kind === 'llm');
  // §2：llm 事件自身无 token 时，从归因 Map 取数（不写回 event.tokens）。
  const attributed = attributeTokensToLlmEvents(record);
  const tokensOf = (event: TraceEvent): TokenUsage | null =>
    event.tokens ?? attributed.get(event.id) ?? null;
  const llmEvents = allLlmEvents.filter(
    (e) => {
      const tokens = tokensOf(e);
      return tokens !== null && tokens.output > 0 && e.durationMs > 0;
    },
  );
  const userEvents = events.filter((e) => e.kind === 'user_prompt');

  // #1：TTFT 是「用户输入 → 首 token」的时间差，与 LLM 调用自身耗时无关。
  const ttftMs =
    userEvents.length > 0 && allLlmEvents.length > 0
      ? Math.max(0, Date.parse(allLlmEvents[0]!.startedAt) - Date.parse(userEvents[0]!.startedAt))
      : null;

  // G4.1：纯推理时长累计全部 llm 事件（含零输出事件，它们仍是推理过程的一部分）。
  const totalLlmMs = allLlmEvents.reduce((sum, e) => sum + e.durationMs, 0);

  // #11：TPS = 每事件 TPS 的算术平均；#13：只算有效事件。
  const perEventTps: number[] = [];
  let validLlmMs = 0;
  let validOutputTokens = 0;
  for (const e of llmEvents) {
    const tokens = tokensOf(e)!;
    perEventTps.push((tokens.output / e.durationMs) * 1000);
    validLlmMs += e.durationMs;
    validOutputTokens += tokens.output;
  }
  const tps = mean(perEventTps);
  const tpotMs =
    validOutputTokens > 0 && validLlmMs > 0 ? validLlmMs / validOutputTokens : null;

  const turnGaps: number[] = [];
  for (let i = 1; i < userEvents.length; i += 1) {
    turnGaps.push(
      Date.parse(userEvents[i]!.startedAt) - Date.parse(userEvents[i - 1]!.startedAt),
    );
  }

  // #12：模型响应延迟 = user_prompt 到时间序中下一个 llm 事件的间隔。
  const responseLatencies: number[] = [];
  for (const userEvent of userEvents) {
    const nextLlm = allLlmEvents.find(
      (e) => Date.parse(e.startedAt) >= Date.parse(userEvent.startedAt),
    );
    if (nextLlm !== undefined) {
      responseLatencies.push(Date.parse(nextLlm.startedAt) - Date.parse(userEvent.startedAt));
    }
  }

  return {
    ttftMs,
    tps,
    tpotMs,
    e2eMs: record.session.totalDurationMs,
    turnGapMedianMs: median(turnGaps),
    pureInferenceMs: totalLlmMs,
    avgLlmResponseLatencyMs: mean(responseLatencies),
  };
}
