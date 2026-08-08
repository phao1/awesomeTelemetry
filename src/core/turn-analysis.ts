/**
 * Client-side trajectory analysis (add-trajectory-inspector §8, FR-T-017,
 * deviation C11).
 *
 * `analyzeTurns` computes the five sections — execution overview, tool usage,
 * top turns by duration, top turns by tokens, per-turn cache-rate trend —
 * plus the rule-based anomaly list, as pure arithmetic over the already
 * derived `TurnModel` (implementation-spec §2, metrics-analysis delta spec).
 * It issues ZERO network requests and makes NO model call: the source spec's
 * `分析` button implied a service, but source §1.4 forbids model calls, and
 * this change resolves that as client-side computation (C11).
 *
 * Determinism matters — humans compare these lists across runs:
 *   - tool usage orders by call count descending, ties by tool name ascending
 *   - both top-10 lists order descending, ties by turn index ascending
 *   - anomalies are emitted in turn order, then in the fixed rule order of
 *     the implementation-spec table (slow_turn, high_input, tool_error,
 *     low_cache)
 *
 * The four anomaly thresholds are FIXED contract constants. They SHALL NOT be
 * tuned to make a fixture pass (metrics-analysis delta spec: "Thresholds
 * SHALL NOT be tuned during implementation to make a fixture pass").
 */

import type { TraceTurn, TurnKind, TurnModel, TurnMessage } from './trace-types.js';
import { countRounds } from './turn-model.js';

/** Fixed anomaly thresholds (implementation-spec §2, metrics-analysis spec). */
export const SLOW_TURN_THRESHOLD_MS = 30_000;
export const HIGH_INPUT_THRESHOLD_TOKENS = 50_000;
/** Low-cache threshold on the cache rate, which is non-null by construction. */
export const LOW_CACHE_THRESHOLD = 0.5;

export type AnomalyRule = 'slow_turn' | 'high_input' | 'tool_error' | 'low_cache';

export type AnomalySeverity = 'danger' | 'attention';

const RULE_SEVERITY: Readonly<Record<AnomalyRule, AnomalySeverity>> = {
  slow_turn: 'danger',
  high_input: 'attention',
  tool_error: 'danger',
  low_cache: 'attention',
};

/** Execution overview (implementation-spec §2). */
export interface TurnAnalysisOverview {
  /** Total turn count across all three kinds (D3: all three are turns). */
  turnCount: number;
  /** Split of the total turn count by kind. */
  kindCounts: Record<TurnKind, number>;
  /** `init` turn (when present) plus every `user` turn (D6, countRounds). */
  roundCount: number;
  /** Summed turn durations (wall-clock per turn, D3). */
  totalDurationMs: number;
  /** Summed turn input tokens. */
  totalInputTokens: number;
  /** Summed turn output tokens. */
  totalOutputTokens: number;
  /** Summed turn cache-read tokens. */
  totalCacheReadTokens: number;
  /**
   * cacheRead / (input + cacheRead), `null` when the denominator is 0
   * (deviation C14 — NOT the source spec's cached/input formula; a null rate
   * renders an em dash, never 0).
   */
  cacheRate: number | null;
}

/** One row of the tool-usage table (implementation-spec §2). */
export interface ToolUsageRow {
  tool: string;
  /** Member-event call count for this tool. */
  count: number;
  /** Mean duration over the member events for this tool. */
  meanDurationMs: number;
  /**
   * Summed `tokens.total` over the member events carrying non-null usage.
   * Events with null usage cannot contribute a token figure and are skipped.
   */
  totalTokens: number;
}

/** One row of a top-10 turn list (implementation-spec §2). */
export interface TopTurnRow {
  turnIndex: number;
  /**
   * The measured value for the owning list: `durationMs` for
   * `topDurationTurns`, `tokens.total` for `topTokenTurns`.
   */
  value: number;
}

/** One point of the per-turn cache-rate trend (implementation-spec §2). */
export interface CacheTrendPoint {
  turnIndex: number;
  /** cacheRead / (input + cacheRead); `null` when the denominator is 0. */
  rate: number | null;
}

/**
 * One anomaly (implementation-spec §2, metrics-analysis "Anomaly entry shape"
 * scenario). Each entry carries the rule identifier, the turn index, and a
 * detail string naming the measured value and the threshold crossed.
 */
export interface TrajectoryAnomaly {
  rule: AnomalyRule;
  /** Severity of the rule (danger / attention); drives the panel's icon. */
  severity: AnomalySeverity;
  turnIndex: number;
  detail: string;
}

/** Complete result of `analyzeTurns`. */
export interface TrajectoryAnalysis {
  overview: TurnAnalysisOverview;
  toolUsage: ToolUsageRow[];
  topDurationTurns: TopTurnRow[];
  topTokenTurns: TopTurnRow[];
  cacheTrend: CacheTrendPoint[];
  anomalies: TrajectoryAnomaly[];
  /**
   * Propagates the model's completeness (metrics-analysis "Analysis inherits
   * model completeness"): when false the panel renders the incompleteness
   * banner and every total as an em dash, never a partial sum presented as a
   * total.
   */
  complete: boolean;
  omittedEventCount: number;
}

/**
 * Cache rate = cacheRead / (input + cacheRead), `null` when the denominator
 * is 0 (deviation C14; the source spec's cached/input formula is deliberately
 * not used — data-model §2 documents why).
 */
export function computeCacheRate(input: number, cacheRead: number): number | null {
  const denominator = input + cacheRead;
  return denominator === 0 ? null : cacheRead / denominator;
}

/** Tool-usage table: grouped by `tool`, count desc, ties by name asc. */
function computeToolUsage(turns: readonly TraceTurn[]): ToolUsageRow[] {
  const byTool = new Map<
    string,
    { count: number; durationSum: number; tokensSum: number }
  >();
  for (const turn of turns) {
    for (const message of turn.messages) {
      if (message.tool === null) {
        continue;
      }
      const entry = byTool.get(message.tool) ?? {
        count: 0,
        durationSum: 0,
        tokensSum: 0,
      };
      entry.count += 1;
      entry.durationSum += message.durationMs;
      if (message.tokens !== null) {
        entry.tokensSum += message.tokens.total;
      }
      byTool.set(message.tool, entry);
    }
  }
  return [...byTool.entries()]
    .map(([tool, entry]) => ({
      tool,
      count: entry.count,
      meanDurationMs: entry.durationSum / entry.count,
      totalTokens: entry.tokensSum,
    }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0),
    );
}

/**
 * Top-turn list: at most `limit` turns by the measured value descending,
 * ties broken by turn index ascending so the output is deterministic.
 */
function topTurns(
  turns: readonly TraceTurn[],
  valueOf: (turn: TraceTurn) => number,
  limit: number,
): TopTurnRow[] {
  return turns
    .map((turn) => ({ turnIndex: turn.index, value: valueOf(turn) }))
    .sort((a, b) => b.value - a.value || a.turnIndex - b.turnIndex)
    .slice(0, limit);
}

/** `tool_error`: a member with tool !== null has status 'error'. */
function isErroredToolMessage(message: TurnMessage): boolean {
  return message.tool !== null && message.status === 'error';
}

/**
 * Rule-based anomalies at exactly the fixed thresholds (implementation-spec
 * §2). Entries are emitted in turn order, then in the fixed rule order of the
 * table, so the list is deterministic across runs.
 */
function detectAnomalies(turns: readonly TraceTurn[]): TrajectoryAnomaly[] {
  const anomalies: TrajectoryAnomaly[] = [];
  for (const turn of turns) {
    // slow_turn: durationMs > 30_000 (danger)
    if (turn.durationMs > SLOW_TURN_THRESHOLD_MS) {
      anomalies.push({
        rule: 'slow_turn',
        severity: RULE_SEVERITY.slow_turn,
        turnIndex: turn.index,
        detail: `durationMs ${turn.durationMs} exceeds ${SLOW_TURN_THRESHOLD_MS}`,
      });
    }
    // high_input: tokens.input > 50_000 (attention)
    if (turn.tokens.input > HIGH_INPUT_THRESHOLD_TOKENS) {
      anomalies.push({
        rule: 'high_input',
        severity: RULE_SEVERITY.high_input,
        turnIndex: turn.index,
        detail: `tokens.input ${turn.tokens.input} exceeds ${HIGH_INPUT_THRESHOLD_TOKENS}`,
      });
    }
    // tool_error: a member with tool !== null errored (danger). One entry per
    // errored tool member, the detail naming the tool that errored.
    for (const message of turn.messages) {
      if (isErroredToolMessage(message)) {
        anomalies.push({
          rule: 'tool_error',
          severity: RULE_SEVERITY.tool_error,
          turnIndex: turn.index,
          detail: `tool ${message.tool} errored`,
        });
      }
    }
    // low_cache: cache rate non-null and < 0.5 (attention). A null rate
    // raises no anomaly.
    const rate = computeCacheRate(turn.tokens.input, turn.tokens.cacheRead);
    if (rate !== null && rate < LOW_CACHE_THRESHOLD) {
      anomalies.push({
        rule: 'low_cache',
        severity: RULE_SEVERITY.low_cache,
        turnIndex: turn.index,
        detail: `cache rate ${rate} below ${LOW_CACHE_THRESHOLD}`,
      });
    }
  }
  return anomalies;
}

/**
 * Compute the trajectory analysis over the derived turn model. Pure: a
 * function of the model alone, no I/O, no request, no model call.
 */
export function analyzeTurns(model: TurnModel): TrajectoryAnalysis {
  const turns = model.turns;
  const kindCounts: Record<TurnKind, number> = { init: 0, user: 0, cycle: 0 };
  let totalDurationMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;

  for (const turn of turns) {
    kindCounts[turn.kind] += 1;
    totalDurationMs += turn.durationMs;
    totalInputTokens += turn.tokens.input;
    totalOutputTokens += turn.tokens.output;
    totalCacheReadTokens += turn.tokens.cacheRead;
  }

  return {
    overview: {
      turnCount: turns.length,
      kindCounts,
      roundCount: countRounds(turns),
      totalDurationMs,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      cacheRate: computeCacheRate(totalInputTokens, totalCacheReadTokens),
    },
    toolUsage: computeToolUsage(turns),
    topDurationTurns: topTurns(turns, (turn) => turn.durationMs, 10),
    topTokenTurns: topTurns(turns, (turn) => turn.tokens.total, 10),
    cacheTrend: turns.map((turn) => ({
      turnIndex: turn.index,
      rate: computeCacheRate(turn.tokens.input, turn.tokens.cacheRead),
    })),
    anomalies: detectAnomalies(turns),
    complete: model.complete,
    omittedEventCount: model.omittedEventCount,
  };
}
