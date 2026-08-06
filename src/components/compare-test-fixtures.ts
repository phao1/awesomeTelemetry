import type {
  SessionDetailResponse,
  SpeedMetrics,
  TraceEventSlim,
  TraceSession,
  TokenUsage,
} from '../core/trace-types.js';
import type { CompareResult } from './compare-types.js';

export function makeTokenUsage(over: Partial<TokenUsage> = {}): TokenUsage {
  return {
    input: 100,
    output: 50,
    reasoning: 20,
    cacheRead: 30,
    cacheWrite: 10,
    netInput: 130,
    total: 210,
    ...over,
  };
}

export function makeSpeed(over: Partial<SpeedMetrics> = {}): SpeedMetrics {
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

export function makeSession(
  id: string,
  over: Partial<TraceSession> = {},
): TraceSession {
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
    tokenUsage: makeTokenUsage(),
    costUsd: 0.02,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: `/tmp/${id}.jsonl`,
    totalDurationMs: 5000,
    isSubagent: false,
    ...over,
  };
}

export function makeEvent(over: Partial<TraceEventSlim>): TraceEventSlim {
  return {
    id: 'e1',
    sessionId: 's1',
    sequence: 1,
    kind: 'llm',
    phase: 'implement',
    title: 'run tests',
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...over,
  };
}

export function makeDetail(
  id: string,
  events: TraceEventSlim[],
  over: Partial<SessionDetailResponse> = {},
): SessionDetailResponse {
  return {
    session: makeSession(id),
    events,
    mode: 'slim',
    eventTotal: events.length,
    eventOffset: 0,
    eventLimit: 2000,
    hasMore: false,
    pending: false,
    ...over,
  };
}

export function makeResult(over: {
  left?: SessionDetailResponse;
  right?: SessionDetailResponse;
  speed?: { left: SpeedMetrics; right: SpeedMetrics };
} = {}): CompareResult {
  return {
    left: over.left ?? makeDetail('left', [makeEvent({ id: 'l1', tool: 'Bash', status: 'error', error: 'timeout' })]),
    right: over.right ?? makeDetail('right', [makeEvent({ id: 'r1', tool: 'Read', phase: 'verify', title: 'vitest run' })]),
    speed: over.speed ?? { left: makeSpeed(), right: makeSpeed({ e2eMs: 3000, ttftMs: 80, tps: 60, tpotMs: 15 }) },
  };
}
