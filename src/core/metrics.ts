import type {
  TraceMetrics,
  TracePhase,
  TraceRecord,
} from './trace-types.js';
import { TRACE_PHASES } from './trace-types.js';

/** REQ-005：算法变更时 bump，触发 metrics 重算回写。 */
export const METRICS_CALC_VERSION = 1;

const STEP_KINDS = new Set([
  'llm',
  'tool',
  'file_read',
  'file_write',
  'bash',
  'test',
  'agent',
]);

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** REQ-004：四维指标 + 基础指标。 */
export function computeMetrics(record: TraceRecord): TraceMetrics {
  const events = record.events;
  const toolEvents = events.filter((e) => e.tool !== null);
  const errorEvents = events.filter((e) => e.status === 'error');
  const totalSteps = events.filter((e) => STEP_KINDS.has(e.kind)).length;

  const durationByPhase = Object.fromEntries(
    TRACE_PHASES.map((phase) => [phase, 0]),
  ) as Record<TracePhase, number>;
  for (const event of events) {
    durationByPhase[event.phase] += event.durationMs;
  }

  const verificationPresent = events.some((e) => e.phase === 'verify');
  const enteredDebug = events.some((e) => e.phase === 'debug');
  return {
    totalSteps,
    durationByPhase,
    toolCallCount: toolEvents.length,
    verificationPresent,
    calcVersion: METRICS_CALC_VERSION,
    avgToolDurationMs: mean(toolEvents.map((e) => e.durationMs)),
    verificationCoverage: verificationPresent ? 1 : 0,
    errorRate: events.length === 0 ? 0 : errorEvents.length / events.length,
    enteredDebug,
    tokensPerStep: totalSteps === 0 ? 0 : record.session.tokenUsage.total / totalSteps,
    costUsd: record.session.costUsd,
  };
}

/** REQ-010：过滤 <system-reminder> 等系统注入。 */
export function isGenuineUserPrompt(text: string): boolean {
  return !/<system-reminder>|system_reminder|<system>/i.test(text);
}

/** REQ-010：清理标签。 */
export function cleanPromptText(text: string): string {
  return text
    .replace(/<user_query>|<\/user_query>/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<system>[\s\S]*?<\/system>/gi, '')
    .trim();
}
