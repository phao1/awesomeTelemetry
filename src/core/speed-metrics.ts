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

/**
 * REQ-006：速度指标（运行时计算，不持久化）。
 * G4.1：pureInferenceMs 只累计 llm 事件 durationMs——adapter 层取 InferHub.inference_duration
 * 写入 durationMs，Kernel-Inference（含 Tool 时间）不得进入。
 */
export function computeSpeedMetrics(record: TraceRecord): SpeedMetrics {
  const events = record.events;
  const llmEvents = events.filter((e) => e.kind === 'llm');
  const userEvents = events.filter((e) => e.kind === 'user_prompt');

  const ttftMs = llmEvents.length > 0 ? llmEvents[0]!.durationMs : null;
  const totalLlmMs = llmEvents.reduce((sum, e) => sum + e.durationMs, 0);
  const outputTokens = record.session.tokenUsage.output;
  const tps =
    outputTokens > 0 && totalLlmMs > 0 ? (outputTokens / totalLlmMs) * 1000 : null;
  const tpotMs =
    outputTokens > 0 && totalLlmMs > 0 ? totalLlmMs / outputTokens : null;

  const turnGaps: number[] = [];
  for (let i = 1; i < userEvents.length; i += 1) {
    turnGaps.push(
      Date.parse(userEvents[i]!.startedAt) - Date.parse(userEvents[i - 1]!.startedAt),
    );
  }

  return {
    ttftMs,
    tps,
    tpotMs,
    e2eMs: record.session.totalDurationMs,
    turnGapMedianMs: median(turnGaps),
    pureInferenceMs: totalLlmMs,
  };
}
