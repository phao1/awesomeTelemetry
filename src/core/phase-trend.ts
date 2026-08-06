import type { TraceEventSlim, TracePhase } from './trace-types.js';
import { TRACE_PHASES } from './trace-types.js';

/**
 * 建议 10：PhaseTiles 阶段趋势 sparkline 数据源。
 * 把会话时间轴分成 N 个桶，每桶累计该 phase 的事件时长 —— 即该阶段在
 * 会话进程内的历史趋势（"如果数据允许"：事件不足时返回空数组，UI 不画）。
 * 纯前端计算，无新增请求（G11.9）。
 */
export function computePhaseTrends(
  events: TraceEventSlim[],
  buckets = 8,
): Record<TracePhase, number[]> {
  const out = Object.fromEntries(
    TRACE_PHASES.map((phase) => [phase, [] as number[]]),
  ) as Record<TracePhase, number[]>;
  if (events.length === 0) {
    return out;
  }
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  const start = Date.parse(sorted[0]!.startedAt);
  const end = Math.max(
    start + 1,
    ...sorted.map((e) => Date.parse(e.startedAt) + e.durationMs),
  );
  const span = end - start;
  const bucketByPhase = Object.fromEntries(
    TRACE_PHASES.map((phase) => [phase, new Array<number>(buckets).fill(0)]),
  ) as Record<TracePhase, number[]>;
  for (const event of sorted) {
    const t = Date.parse(event.startedAt);
    const index = Math.min(
      buckets - 1,
      Math.max(0, Math.floor(((t - start) / span) * buckets)),
    );
    const bucket = bucketByPhase[event.phase];
    if (bucket !== undefined) {
      bucket[index] = (bucket[index] ?? 0) + event.durationMs;
    }
  }
  for (const phase of TRACE_PHASES) {
    out[phase] = bucketByPhase[phase];
  }
  return out;
}
