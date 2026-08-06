import type { SpeedMetrics, TraceEventSlim, TraceSession } from './trace-types.js';

/**
 * REQ-121：单会话可视化（事件密度 Heatmap + 8 轴能力 Radar）的纯计算层。
 * 全部只依赖已加载的 slim 详情，MUST NOT 发额外请求（G11.9）。
 */

/** 期望桶数（G-C7 gotcha 8）。 */
export const HEATMAP_TARGET_BUCKETS = 30;
/** 短会话阈值：低于该时长桶大小固定为 1 分钟。 */
export const HEATMAP_SHORT_SESSION_MIN = 10;

/**
 * 桶大小（分钟）：会话 < 10 分钟固定 1 分钟；否则 ceil(时长分钟 / 30)。
 * 固定桶大小会让短会话全挤一个桶、长会话桶太碎，所以按时长自适应。
 */
export function heatmapBucketMinutes(durationMs: number): number {
  const minutes = durationMs / 60_000;
  if (minutes < HEATMAP_SHORT_SESSION_MIN) {
    return 1;
  }
  return Math.max(1, Math.ceil(minutes / HEATMAP_TARGET_BUCKETS));
}

export interface EventDensity {
  /** 每桶事件数。 */
  buckets: number[];
  /** 桶大小（分钟）。 */
  bucketMinutes: number;
  /** 首事件时间戳（ms）。 */
  startMs: number;
  /** 峰值桶事件数（0 表示无事件）。 */
  peak: number;
}

/** 按时间桶统计事件密度。events 可乱序，内部按 startedAt 归桶。 */
export function buildEventDensity(events: readonly TraceEventSlim[]): EventDensity {
  if (events.length === 0) {
    return { buckets: [], bucketMinutes: 1, startMs: 0, peak: 0 };
  }
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  for (const event of events) {
    const at = Date.parse(event.startedAt);
    if (Number.isNaN(at)) {
      continue;
    }
    startMs = Math.min(startMs, at);
    endMs = Math.max(endMs, at + event.durationMs);
  }
  if (!Number.isFinite(startMs)) {
    return { buckets: [], bucketMinutes: 1, startMs: 0, peak: 0 };
  }
  const bucketMinutes = heatmapBucketMinutes(Math.max(0, endMs - startMs));
  const bucketMs = bucketMinutes * 60_000;
  const count = Math.max(1, Math.ceil((endMs - startMs) / bucketMs));
  const buckets = new Array<number>(count).fill(0);
  for (const event of events) {
    const at = Date.parse(event.startedAt);
    if (Number.isNaN(at)) {
      continue;
    }
    const index = Math.min(count - 1, Math.floor((at - startMs) / bucketMs));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  return { buckets, bucketMinutes, startMs, peak: Math.max(0, ...buckets) };
}

/** REQ-121 Radar 的 8 个轴。 */
export const SESSION_RADAR_AXES = [
  'speed',
  'ttft',
  'tps',
  'tokenEfficiency',
  'toolUsage',
  'errorRate',
  'contextLength',
  'duration',
] as const;

export type SessionRadarAxis = (typeof SESSION_RADAR_AXES)[number];

/**
 * 各轴归一化参考上限。单会话没有对比基线，所以用固定参考量纲把绝对值映射到 0..1，
 * 保证同一会话在不同时间、不同 provider 之间的雷达图可直接叠看。
 */
export const RADAR_REFERENCE = {
  /** e2e 参考上限 10 分钟（越短分越高）。 */
  e2eMs: 600_000,
  /** TTFT 参考上限 5s（越短分越高，与 REQ-102 的启动开销阈值一致）。 */
  ttftMs: 5_000,
  /** TPS 参考上限 100 tok/s（越高分越高）。 */
  tps: 100,
  /** 每事件 token 参考上限 5000（越省分越高）。 */
  tokensPerEvent: 5_000,
  /** 上下文长度参考上限 200k token（越长值越大，中性刻度）。 */
  contextTokens: 200_000,
  /** 会话时长参考上限 30 分钟（越长值越大，中性刻度）。 */
  durationMs: 1_800_000,
} as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export interface SessionRadarPoint {
  axis: SessionRadarAxis;
  /** 归一化到 0..1 的雷达值。 */
  value: number;
  /** 原始值（null 表示该指标不可用，雷达值按 0 绘制）。 */
  raw: number | null;
}

/**
 * 8 轴能力雷达：speed / ttft / tps 越短越快得分越高；tokenEfficiency 越省越高；
 * errorRate 取 1-错误率；toolUsage / contextLength / duration 为中性刻度
 * （值越大表示越"重"，不代表越好）。
 */
export function computeSessionRadar(
  session: TraceSession,
  events: readonly TraceEventSlim[],
  speed: SpeedMetrics,
): SessionRadarPoint[] {
  const total = events.length;
  const errorCount = events.filter((e) => e.status === 'error').length;
  const toolCount = events.filter((e) => e.tool !== null).length;
  const errorRate = total === 0 ? 0 : errorCount / total;
  const tokensPerEvent = total === 0 ? 0 : session.tokenUsage.total / total;
  const durationMs = session.totalDurationMs;

  const point = (axis: SessionRadarAxis, value: number, raw: number | null): SessionRadarPoint => ({
    axis,
    value: raw === null ? 0 : clamp01(value),
    raw,
  });

  return [
    point('speed', 1 - speed.e2eMs / RADAR_REFERENCE.e2eMs, speed.e2eMs),
    point(
      'ttft',
      speed.ttftMs === null ? 0 : 1 - speed.ttftMs / RADAR_REFERENCE.ttftMs,
      speed.ttftMs,
    ),
    point('tps', speed.tps === null ? 0 : speed.tps / RADAR_REFERENCE.tps, speed.tps),
    point('tokenEfficiency', 1 - tokensPerEvent / RADAR_REFERENCE.tokensPerEvent, tokensPerEvent),
    point('toolUsage', total === 0 ? 0 : toolCount / total, toolCount),
    point('errorRate', 1 - errorRate, errorRate),
    point('contextLength', session.tokenUsage.total / RADAR_REFERENCE.contextTokens, session.tokenUsage.total),
    point('duration', durationMs / RADAR_REFERENCE.durationMs, durationMs),
  ];
}
