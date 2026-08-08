import { describe, expect, it } from 'vitest';

import type { SpeedMetrics, TraceEventSlim, TraceSession } from './trace-types.js';
import {
  HEATMAP_TARGET_BUCKETS,
  RADAR_REFERENCE,
  SESSION_RADAR_AXES,
  buildEventDensity,
  computeSessionRadar,
  heatmapBucketMinutes,
} from './session-visuals.js';

const MIN = 60_000;

// core 测试不跨项目引用 components 的 fixtures（tsconfig 项目边界）。
function makeSession(id: string, over: Partial<TraceSession> = {}): TraceSession {
  return {
    id,
    provider: 'codex',
    sourceAgent: 'Codex',
    title: `session ${id}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 3,
    eventCount: 5,
    tokenUsage: {
      input: 100,
      output: 50,
      reasoning: 20,
      cacheRead: 30,
      cacheWrite: 10,
      netInput: 130,
      total: 210,
    },
    costUsd: 0.02,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    totalDurationMs: 5000,
    isSubagent: false,
    ...over,
  };
}

function makeSpeed(over: Partial<SpeedMetrics> = {}): SpeedMetrics {
  return {
    ttftMs: 100,
    tps: 50,
    tpotMs: 20,
    e2eMs: 5000,
    turnGapMedianMs: 800,
    pureInferenceMs: 4000,
    avgLlmResponseLatencyMs: 200,
    avgLlmDurationMs: 1000,
    cacheHitRate: 0.5,
    avgTokensPerCall: 100,
    systemPromptTokensEstimate: 200,
    ...over,
  };
}

function event(over: Partial<TraceEventSlim>): TraceEventSlim {
  return {
    id: 'e',
    sessionId: 's',
    sequence: 1,
    turnKey: null,
    kind: 'tool',
    phase: 'implement',
    title: 'step',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 0,
    status: 'success',
    actor: 'assistant',
    tool: 'Bash',
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...over,
  };
}

describe('REQ-121 Heatmap 桶大小算法（G-C7 gotcha 8）', () => {
  it('会话 < 10 分钟 → 桶大小固定 1 分钟', () => {
    expect(heatmapBucketMinutes(0)).toBe(1);
    expect(heatmapBucketMinutes(5 * MIN)).toBe(1);
    expect(heatmapBucketMinutes(9.99 * MIN)).toBe(1);
  });

  it('会话 >= 10 分钟 → ceil(时长分钟 / 30)', () => {
    expect(heatmapBucketMinutes(10 * MIN)).toBe(1); // ceil(10/30) = 1
    expect(heatmapBucketMinutes(31 * MIN)).toBe(2); // ceil(31/30) = 2
    expect(heatmapBucketMinutes(90 * MIN)).toBe(3);
    expect(heatmapBucketMinutes(600 * MIN)).toBe(20);
    expect(HEATMAP_TARGET_BUCKETS).toBe(30);
  });

  it('长会话桶数不超过期望值太多（30 分钟以内的桶数 ≈ 30）', () => {
    const durationMin = 300;
    const bucket = heatmapBucketMinutes(durationMin * MIN);
    expect(Math.ceil(durationMin / bucket)).toBeLessThanOrEqual(HEATMAP_TARGET_BUCKETS);
  });
});

describe('REQ-121 buildEventDensity', () => {
  it('空事件返回空桶', () => {
    expect(buildEventDensity([])).toEqual({ buckets: [], bucketMinutes: 1, startMs: 0, peak: 0 });
  });

  it('短会话按 1 分钟桶归类（桶相对首事件对齐），桶内计数正确', () => {
    const events = [
      event({ id: 'a', startedAt: '2026-08-01T00:00:10.000Z' }),
      event({ id: 'b', startedAt: '2026-08-01T00:00:40.000Z' }),
      event({ id: 'c', startedAt: '2026-08-01T00:01:20.000Z' }),
      event({ id: 'd', startedAt: '2026-08-01T00:03:15.000Z' }),
    ];
    const density = buildEventDensity(events);
    expect(density.bucketMinutes).toBe(1);
    // 相对首事件的偏移：0s / 30s → 桶0；70s → 桶1；185s → 桶3
    expect(density.buckets).toEqual([2, 1, 0, 1]);
    expect(density.peak).toBe(2);
    expect(density.startMs).toBe(Date.parse('2026-08-01T00:00:10.000Z'));
  });

  it('长会话（60 分钟）桶大小为 2 分钟，事件按比例落桶', () => {
    const events = [
      event({ id: 'a', startedAt: '2026-08-01T00:00:00.000Z' }),
      event({ id: 'b', startedAt: '2026-08-01T00:59:00.000Z', durationMs: 60_000 }),
    ];
    const density = buildEventDensity(events);
    expect(density.bucketMinutes).toBe(2);
    expect(density.buckets.length).toBe(30);
    expect(density.buckets[0]).toBe(1);
    expect(density.buckets[29]).toBe(1);
  });

  it('乱序事件仍按时间归桶', () => {
    const events = [
      event({ id: 'late', startedAt: '2026-08-01T00:03:00.000Z' }),
      event({ id: 'early', startedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const density = buildEventDensity(events);
    expect(density.buckets).toEqual([1, 0, 1]);
  });
});

describe('REQ-121 computeSessionRadar（8 轴）', () => {
  const speed: SpeedMetrics = makeSpeed();

  it('返回 8 个轴，顺序与 SESSION_RADAR_AXES 一致，值都在 0..1', () => {
    const session = makeSession('s1');
    const events = [event({ id: 'a' }), event({ id: 'b', status: 'error', tool: null })];
    const radar = computeSessionRadar(session, events, speed);
    expect(radar.map((p) => p.axis)).toEqual([...SESSION_RADAR_AXES]);
    expect(radar.length).toBe(8);
    for (const point of radar) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(1);
    }
  });

  it('稳定性轴 = 1 - 错误率；工具占比轴 = tool 事件比例', () => {
    const session = makeSession('s1');
    const events = [
      event({ id: 'a', status: 'error', tool: 'Bash' }),
      event({ id: 'b', status: 'success', tool: 'Bash' }),
      event({ id: 'c', status: 'success', tool: null }),
      event({ id: 'd', status: 'success', tool: null }),
    ];
    const radar = computeSessionRadar(session, events, speed);
    const by = Object.fromEntries(radar.map((p) => [p.axis, p]));
    expect(by.errorRate!.value).toBeCloseTo(0.75, 6);
    expect(by.errorRate!.raw).toBeCloseTo(0.25, 6);
    expect(by.toolUsage!.value).toBeCloseTo(0.5, 6);
  });

  it('指标为 null 时该轴取 0 且 raw 保持 null（不用 0 冒充）', () => {
    const session = makeSession('s1');
    const radar = computeSessionRadar(session, [event({ id: 'a' })], makeSpeed({ ttftMs: null, tps: null }));
    const by = Object.fromEntries(radar.map((p) => [p.axis, p]));
    expect(by.ttft!.value).toBe(0);
    expect(by.ttft!.raw).toBeNull();
    expect(by.tps!.value).toBe(0);
    expect(by.tps!.raw).toBeNull();
  });

  it('超过参考上限的值被 clamp 到 0/1', () => {
    const session = makeSession('s1', { totalDurationMs: RADAR_REFERENCE.durationMs * 10 });
    const radar = computeSessionRadar(
      session,
      [event({ id: 'a' })],
      makeSpeed({ e2eMs: RADAR_REFERENCE.e2eMs * 5, tps: RADAR_REFERENCE.tps * 3 }),
    );
    const by = Object.fromEntries(radar.map((p) => [p.axis, p]));
    expect(by.duration!.value).toBe(1);
    expect(by.speed!.value).toBe(0);
    expect(by.tps!.value).toBe(1);
  });
});
