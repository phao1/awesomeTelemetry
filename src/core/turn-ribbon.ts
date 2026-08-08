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

import type { MessageRole, TraceTurn, TurnMessage } from './trace-types.js';

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

interface TurnGroup {
  readonly turns: readonly TraceTurn[];
  readonly weight: number;
}

function turnWeight(turn: TraceTurn, mode: RibbonMode): number {
  return mode === 'time' ? turn.durationMs : turn.tokens.total;
}

/**
 * Split turns into segments. At or below `RIBBON_MAX_SEGMENTS` each turn is
 * its own segment. Above it, group into `RIBBON_MAX_SEGMENTS` equal turn-count
 * buckets (counts differ by at most one), preserving order and dropping no
 * turn.
 */
function groupTurns(
  turns: readonly TraceTurn[],
  mode: RibbonMode,
): TurnGroup[] {
  const count = turns.length;
  if (count === 0) {
    return [];
  }
  if (count <= RIBBON_MAX_SEGMENTS) {
    return turns.map((turn) => ({
      turns: [turn],
      weight: turnWeight(turn, mode),
    }));
  }
  const base = Math.floor(count / RIBBON_MAX_SEGMENTS);
  const extra = count % RIBBON_MAX_SEGMENTS;
  const groups: TurnGroup[] = [];
  let pos = 0;
  for (let bucket = 0; bucket < RIBBON_MAX_SEGMENTS; bucket += 1) {
    const size = base + (bucket < extra ? 1 : 0);
    const members = turns.slice(pos, pos + size);
    let weight = 0;
    for (const turn of members) {
      weight += turnWeight(turn, mode);
    }
    groups.push({ turns: members, weight });
    pos += size;
  }
  return groups;
}

/**
 * Dominant role by message count, ties broken by `RIBBON_ROLE_ORDER`. Only the
 * six ribbon roles compete; `subagent` messages never count toward a ribbon
 * role (no legend entry, no token). Returns null when no ribbon-role message
 * exists in the group.
 */
function dominantRole(messages: readonly TurnMessage[]): MessageRole | null {
  const counts = new Map<MessageRole, number>();
  for (const message of messages) {
    if (RIBBON_ROLE_ORDER.includes(message.role)) {
      counts.set(message.role, (counts.get(message.role) ?? 0) + 1);
    }
  }
  let best: MessageRole | null = null;
  let bestCount = 0;
  for (const role of RIBBON_ROLE_ORDER) {
    const count = counts.get(role) ?? 0;
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

function buildAriaLabel(
  group: readonly TraceTurn[],
  durationMs: number,
  tokenTotal: number,
): string {
  const indices = group.map((turn) => turn.index);
  const range = indices.length === 1
    ? `Turn ${indices[0]}`
    : `Turns ${indices[0]}-${indices[indices.length - 1]}`;
  return `${range}: duration ${durationMs} ms, tokens ${tokenTotal}`;
}

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
  const groups = groupTurns(turns, mode);
  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);

  const segments: RibbonSegment[] = groups.map((group) => {
    const durationMs = group.turns.reduce(
      (sum, turn) => sum + turn.durationMs,
      0,
    );
    const tokenTotal = group.turns.reduce(
      (sum, turn) => sum + turn.tokens.total,
      0,
    );
    const messages = group.turns.flatMap((turn) => turn.messages);
    const widthPx = totalWeight === 0
      ? Math.max(RIBBON_MIN_SEGMENT_PX, containerWidthPx / groups.length)
      : Math.max(
        RIBBON_MIN_SEGMENT_PX,
        (group.weight / totalWeight) * containerWidthPx,
      );
    return {
      turnIndices: group.turns.map((turn) => turn.index),
      weight: group.weight,
      widthPx,
      dominantRole: dominantRole(messages),
      durationMs,
      tokenTotal,
      ariaLabel: buildAriaLabel(group.turns, durationMs, tokenTotal),
    };
  });

  return {
    segments,
    totalWidthPx: segments.reduce((sum, segment) => sum + segment.widthPx, 0),
    mode,
  };
}
