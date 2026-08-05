import type { SpeedMetrics, TraceRecord } from './trace-types.js';

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
  const llmEvents = allLlmEvents.filter(
    (e) => e.tokens !== null && e.tokens.output > 0 && e.durationMs > 0,
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
    perEventTps.push((e.tokens!.output / e.durationMs) * 1000);
    validLlmMs += e.durationMs;
    validOutputTokens += e.tokens!.output;
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
