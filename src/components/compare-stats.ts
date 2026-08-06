import type {
  SessionDetailResponse,
  SpeedMetrics,
  TraceEventSlim,
  TraceKind,
  TracePhase,
} from '../core/trace-types.js';
import { groupEvents } from '../core/event-groups.js';
import { fmtDur } from '../core/session-findings.js';

/** §6.3（calibrate-tokens-and-compare-report）：代码精炼度 = totalSteps / fileWriteCount。 */
export const STEP_KINDS = new Set([
  'llm', 'tool', 'file_read', 'file_write', 'bash', 'test', 'agent',
]);
export const TEST_CMD = /(npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint)/;
export const FAILED_COMMAND_KINDS = new Set([
  'bash', 'test', 'tool', 'file_write', 'file_read', 'agent',
]);

export interface CompareSideStats {
  llmCalls: number;
  totalLlmDuration: number;
  avgLlmDuration: number | null;
  totalToolDuration: number;
  cacheHitRate: number | null;
  cacheRead: number;
  netInput: number;
  fileWrites: number;
  fileReads: number;
  totalSteps: number;
  hasUnitTests: boolean;
  userRounds: number;
  codeConciseness: number | null;
  fixLoops: number;
  failedCommands: number;
}

export function compareSideStats(
  events: TraceEventSlim[],
  speed: SpeedMetrics,
  session: SessionDetailResponse['session'],
): CompareSideStats {
  const llmEvents = events.filter((e) => e.kind === 'llm');
  const toolEvents = events.filter((e) => e.tool !== null);
  const fileWrites = events.filter((e) => e.kind === 'file_write').length;
  const fileReads = events.filter((e) => e.kind === 'file_read').length;
  const totalSteps = events.filter((e) => STEP_KINDS.has(e.kind)).length;
  const verifyEvents = events.filter((e) => e.phase === 'verify');
  const cacheRead = events.reduce((sum, e) => sum + (e.tokens?.cacheRead ?? 0), 0);
  const fixLoops = groupEvents(events).filter(
    (r) => r.kind === 'group' && r.group.type === 'repair_loop',
  ).length;
  return {
    llmCalls: llmEvents.length,
    totalLlmDuration: llmEvents.reduce((sum, e) => sum + e.durationMs, 0),
    avgLlmDuration: speed.avgLlmDurationMs,
    totalToolDuration: toolEvents.reduce((sum, e) => sum + e.durationMs, 0),
    cacheHitRate: speed.cacheHitRate,
    cacheRead,
    netInput: session.tokenUsage.netInput,
    fileWrites,
    fileReads,
    totalSteps,
    hasUnitTests: verifyEvents.some((e) => TEST_CMD.test(e.title)),
    userRounds: events.filter((e) => e.kind === 'user_prompt').length,
    codeConciseness: fileWrites === 0 ? null : totalSteps / fileWrites,
    fixLoops,
    failedCommands: events.filter(
      (e) => e.status === 'error' && FAILED_COMMAND_KINDS.has(e.kind),
    ).length,
  };
}

/** P2 差异优先：差异百分比。0/0 或相等 → 0。 */
export function diffPct(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  const base = Math.max(
    1,
    absA === 0 || absB === 0 ? Math.max(absA, absB) : Math.min(absA, absB),
  );
  return (Math.abs(a - b) / base) * 100;
}

export const SIGNIFICANT_DIFF = 10; // 差异 < 10% 视为不显著

export function fmtMs(ms: number | null): string {
  return ms === null ? '—' : fmtDur(ms);
}

/** 阶段累计耗时（口径与 PhaseRibbon 一致：SUM(durationMs)）。 */
export function phaseDurations(events: TraceEventSlim[]): Record<TracePhase, number> {
  const out = {
    understand: 0,
    plan: 0,
    implement: 0,
    debug: 0,
    verify: 0,
    report: 0,
  } as Record<TracePhase, number>;
  for (const e of events) {
    out[e.phase] += e.durationMs;
  }
  return out;
}

/** 事件 kind 计数（10+ 种，含 0 键）。 */
export function eventKindCounts(events: TraceEventSlim[]): Map<TraceKind, number> {
  const map = new Map<TraceKind, number>();
  for (const e of events) {
    map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
  }
  return map;
}

export interface ErrorBucket {
  tool: string;
  lf: number;
  rf: number;
}

/** 失败原因分布：按失败事件的「动作」分组（tool 名，非工具事件用 kind），
 * 左右各计错误次数，按总错误数降序。 */
export function errorDistribution(
  leftEvents: TraceEventSlim[],
  rightEvents: TraceEventSlim[],
): ErrorBucket[] {
  const map = new Map<string, ErrorBucket>();
  const bump = (events: TraceEventSlim[], side: 'l' | 'r'): void => {
    for (const e of events) {
      if (e.status !== 'error') {
        continue;
      }
      const tool = e.tool ?? e.kind;
      const v = map.get(tool) ?? { tool, lf: 0, rf: 0 };
      if (side === 'l') {
        v.lf += 1;
      } else {
        v.rf += 1;
      }
      map.set(tool, v);
    }
  };
  bump(leftEvents, 'l');
  bump(rightEvents, 'r');
  return [...map.values()].sort((a, b) => b.lf + b.rf - (a.lf + a.rf)).slice(0, 12);
}
