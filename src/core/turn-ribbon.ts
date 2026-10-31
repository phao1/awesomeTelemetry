/**
 * Turn ribbon geometry (add-trajectory-inspector §5, design D10).
 *
 * Pure geometry — no React, no DOM, no CSS. `computeRibbon` turns the derived
 * turn model (`TraceTurn`, trace-model delta spec) into proportional segments
 * for the `TurnRibbon` component (task group §6). The ribbon renders at most
 * `RIBBON_MAX_SEGMENTS` DOM segments: above the cap, turns are bucketed into
 * equal turn-count buckets so no turn is dropped and no segment goes
 * invisible.
 *
 * Constants are the D10 values verbatim. `RIBBON_TRANSITION_MS` is data for
 * the consumer; the component must read the motion token (design-tokens §6),
 * never write the literal.
 *
 * Widths: `max(RIBBON_MIN_SEGMENT_PX, weight / totalWeight * containerWidthPx)`.
 * A zero-weight turn stays visible as the 2px floor — an invisible turn is a
 * lie about the session's shape. When `totalWeight === 0` every segment gets
 * an equal width (still floored) and no division by zero occurs.
 */

import type { MessageRole, TraceTurn } from './trace-types.js';

/** D10 verbatim. */
export const RIBBON_HEIGHT_PX = 28;
/** D10 verbatim. */
export const RIBBON_MIN_SEGMENT_PX = 2;
/** D10 verbatim. */
export const RIBBON_MAX_SEGMENTS = 200;
/** D10 verbatim. */
export const RIBBON_TRANSITION_MS = 200;

/** Ribbon width modes (D10 / FR-T-014). */
export type RibbonMode = 'time' | 'token';

/**
 * Dominant-role tie order (D10): system > user > assistant > tool > reasoning
 * > compact. Six roles — `reasoning` and `compact` are real kinds after Change
 * A. `subagent` is a message role but not a ribbon role: it has no legend
 * entry and no role token, so it never wins ribbon dominance.
 */
export const RIBBON_ROLE_ORDER: readonly MessageRole[] = [
  'system', 'user', 'assistant', 'tool', 'reasoning', 'compact',
] as const;

/** One ribbon segment, backed by one turn or (above the cap) a turn bucket. */
export interface RibbonSegment {
  /** Turn indices covered by this segment, ascending. Length 1 unless bucketed. */
  readonly turnIndices: readonly number[];
  /** Segment weight in the active mode (sum of member turn weights). */
  readonly weight: number;
  /** Rendered width in px, after the minimum-width floor. */
  readonly widthPx: number;
  /**
   * Dominant role by message count across the segment's turns. Null when the
   * segment has no six-ribbon-role message (for example a subagent-only turn);
   * consumers render it with the neutral token rather than a role colour.
   */
  readonly dominantRole: MessageRole | null;
  /** Sum of member turn durations, ms. */
  readonly durationMs: number;
  /** Sum of member turn token totals. */
  readonly tokenTotal: number;
  /** Accessible label naming turn index or range, duration, and token total. */
  readonly ariaLabel: string;
}

/** Result of `computeRibbon`. */
export interface RibbonResult {
  readonly segments: readonly RibbonSegment[];
  /** Sum of the computed segment widths (may exceed the container when the
   * minimum-width floor bites; the flex container resolves the overflow). */
  readonly totalWidthPx: number;
  readonly mode: RibbonMode;
}

type RibbonSegmentDraft = Omit<RibbonSegment, 'widthPx'> & { widthPx: number };

/**
 * Compute ribbon segments from the derived turn model.
 *
 * - `'time'` weight = `durationMs`; `'token'` weight = `tokens.total`.
 * - Width = `max(RIBBON_MIN_SEGMENT_PX, weight / totalWeight * containerWidthPx)`.
 * - `totalWeight === 0` → every segment gets an equal width; never divide by zero.
 * - Above `RIBBON_MAX_SEGMENTS` turns, bucket into equal turn-count buckets,
 *   each carrying its turn range; no turn is dropped.
 * - Every segment carries an accessible label with turn index or range,
 *   duration, and token total.
 */
export function computeRibbon(
  turns: readonly TraceTurn[],
  mode: RibbonMode,
  containerWidthPx: number,
): RibbonResult {
  const count = Math.min(turns.length, RIBBON_MAX_SEGMENTS);
  if (count === 0) return { segments: [], totalWidthPx: 0, mode };
  const base = Math.floor(turns.length / count), extra = turns.length % count;
  const segments: RibbonSegmentDraft[] = [];
  const roleCounts = new Array<number>(RIBBON_ROLE_ORDER.length).fill(0);
  let position = 0, totalWeight = 0;
  // Walk the original turns directly: no sliced groups, flattened messages or
  // per-segment Maps. Only output indices/segments escape this calculation.
  for (let bucket = 0; bucket < count; bucket += 1) {
    const end = position + base + (bucket < extra ? 1 : 0);
    const indices: number[] = [];
    let durationMs = 0, tokenTotal = 0;
    roleCounts.fill(0);
    for (; position < end; position += 1) {
      const turn = turns[position]!;
      indices.push(turn.index); durationMs += turn.durationMs; tokenTotal += turn.tokens.total;
      for (const message of turn.messages) {
        const role = RIBBON_ROLE_ORDER.indexOf(message.role);
        if (role >= 0) roleCounts[role] = roleCounts[role]! + 1;
      }
    }
    let dominantRole: MessageRole | null = null, bestCount = 0;
    for (let role = 0; role < roleCounts.length; role += 1) {
      if (roleCounts[role]! > bestCount) { bestCount = roleCounts[role]!; dominantRole = RIBBON_ROLE_ORDER[role]!; }
    }
    const weight = mode === 'time' ? durationMs : tokenTotal;
    totalWeight += weight;
    const range = indices.length === 1 ? `Turn ${indices[0]}` : `Turns ${indices[0]}-${indices[indices.length - 1]}`;
    segments.push({ turnIndices: indices, weight, widthPx: 0, dominantRole, durationMs, tokenTotal,
      ariaLabel: `${range}: duration ${durationMs} ms, tokens ${tokenTotal}` });
  }
  let totalWidthPx = 0;
  for (const segment of segments) {
    segment.widthPx = Math.max(RIBBON_MIN_SEGMENT_PX, totalWeight === 0 ? containerWidthPx / count : segment.weight / totalWeight * containerWidthPx);
    totalWidthPx += segment.widthPx;
  }
  return { segments, totalWidthPx, mode };
}
