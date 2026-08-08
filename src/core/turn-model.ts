/**
 * Derived turn model (add-trajectory-inspector §4, design D3/D4).
 *
 * `deriveTurns` turns the ordered slim event stream into one flat list of
 * turns — `init`, `user`, `cycle` — with no second grouping layer above them
 * (trace-model delta spec: a `user` turn is itself the round boundary).
 * Derivation is pure: a function of the events, the session, and the
 * adapter's declared turn-key provenance. It runs in a single pass over
 * sequence-ascending input, is never persisted, and is never computed on the
 * server (design D2/D3).
 *
 * The algorithm is fully specified by design D3 (strategy selection, turn 0,
 * the universal user-input rule, cycle rules, per-turn aggregation) and D4
 * (event-to-message mapping). A tool event's call identity is the member
 * event's `id`, carried verbatim on `TurnMessage.eventId` — there is no
 * `toolCallId` field and none is generated (deviation C7, design D5).
 */

import type {
  MessageRole,
  TraceEvent,
  TraceEventSlim,
  TraceKind,
  TraceSession,
  TraceStatus,
  TraceTurn,
  TokenSemantics,
  TurnBadge,
  TurnKind,
  TurnMessage,
  TurnModel,
  TurnSegmentationSource,
  TurnKeySource,
} from './trace-types.js';
import { aggregateTokenUsage } from '../adapters/helpers.js';

/**
 * Input envelope for derivation (design D3's `session` argument).
 *
 * `TraceSession` alone cannot carry the detail response's pagination flags,
 * so the call site passes the session plus the pagination info the
 * completeness rule needs. A `SessionDetailResponse` satisfies this shape
 * structurally.
 */
export interface TurnDerivationSource {
  /** The session whose events are derived; used for model resolution. */
  readonly session: TraceSession;
  /** Detail-response pagination flag (`SessionDetailResponse.hasMore`). */
  readonly hasMore: boolean;
  /** Detail-response total event count (`SessionDetailResponse.eventTotal`). */
  readonly eventTotal: number;
}

/**
 * Token semantics passed to the shared session-level aggregation helper.
 *
 * Every adapter declares incremental cache-read semantics (G4.4,
 * calibrate-tokens-and-compare-report §3), so turn aggregation applies the
 * same semantics the session aggregation uses; `reasoningInTotal` keeps the
 * helper's documented default. Per-adapter cache-read semantics are
 * deliberately NOT re-derived here — data-model §2 documents why that is a
 * trap.
 */
const TURN_SEMANTICS: TokenSemantics = {
  cacheRead: 'incremental',
  reasoning: 'incremental',
};

/**
 * D4 event-to-role mapping. The `message` kind is an assistant-adjacent
 * message (Trae emits it with actor 'assistant'); there is no 'message'
 * MessageRole, so it maps to 'assistant'.
 */
const KIND_TO_ROLE: Readonly<Record<TraceKind, MessageRole>> = {
  llm: 'assistant',
  tool: 'tool',
  file_read: 'tool',
  file_write: 'tool',
  bash: 'tool',
  test: 'tool',
  agent: 'subagent',
  system: 'system',
  message: 'assistant',
  user_prompt: 'user',
  subagent_prompt: 'subagent',
  reasoning: 'reasoning',
  compact: 'compact',
};

/**
 * D3 strategy selection, in order: `turn_key` when any event carries a
 * non-null turn key, else `llm_boundary` when any inference event exists,
 * else `user_prompt_boundary` when any user prompt exists, else
 * `sequence_fallback`.
 */
function selectSegmentationSource(
  events: readonly TraceEventSlim[],
): TurnSegmentationSource {
  let hasLlm = false;
  let hasUserPrompt = false;
  for (const event of events) {
    if (event.turnKey !== null) {
      return 'turn_key';
    }
    if (event.kind === 'llm') {
      hasLlm = true;
    } else if (event.kind === 'user_prompt') {
      hasUserPrompt = true;
    }
  }
  if (hasLlm) {
    return 'llm_boundary';
  }
  if (hasUserPrompt) {
    return 'user_prompt_boundary';
  }
  return 'sequence_fallback';
}

/** D8 badge derivation, emitted in the D8 table order. */
function computeBadges(options: {
  kind: TurnKind;
  status: TraceStatus;
  toolCount: number;
  members: readonly TraceEventSlim[];
}): TurnBadge[] {
  const badges: TurnBadge[] = [];
  if (options.kind === 'init') {
    badges.push('init');
  }
  if (options.kind === 'user') {
    badges.push('user');
  }
  if (options.toolCount > 0) {
    badges.push('tools');
  }
  if (options.kind === 'cycle' && options.toolCount === 0) {
    badges.push('stop');
  }
  if (options.status === 'error') {
    badges.push('error');
  }
  if (
    options.members.some(
      (member) => member.kind === 'agent' || member.kind === 'subagent_prompt',
    )
  ) {
    badges.push('subagent');
  }
  if (options.members.some((member) => member.kind === 'compact')) {
    badges.push('compact');
  }
  if (options.status === 'running') {
    badges.push('running');
  }
  return badges;
}

/** D4: one event maps to one message; the call identity is `event.id`. */
function toTurnMessage(event: TraceEventSlim): TurnMessage {
  return {
    eventId: event.id,
    sequence: event.sequence,
    role: KIND_TO_ROLE[event.kind],
    kind: event.kind,
    title: event.title,
    tool: event.tool,
    startedAt: event.startedAt,
    durationMs: event.durationMs,
    status: event.status,
    tokens: event.tokens,
    hasInput: event.hasInput,
    hasOutput: event.hasOutput,
    hasRaw: event.hasRaw,
    error: event.error,
  };
}

/** D3 per-turn aggregation. */
function buildTurn(
  index: number,
  kind: TurnKind,
  members: TraceEventSlim[],
  session: TraceSession,
): TraceTurn {
  const first = members[0]!;
  const last = members[members.length - 1]!;
  const toolCount = members.reduce(
    (count, member) => (member.tool !== null ? count + 1 : count),
    0,
  );
  const status: TraceStatus = members.some((member) => member.status === 'error')
    ? 'error'
    : members.some((member) => member.status === 'running')
      ? 'running'
      : 'success';
  return {
    index,
    kind,
    startedAt: first.startedAt,
    // D3: wall-clock = last member end minus first member start, floored at 0.
    // NOT the sum of member durations (G4.6).
    durationMs: Math.max(
      0,
      Date.parse(last.startedAt) + last.durationMs - Date.parse(first.startedAt),
    ),
    // D3: reuse the session-level aggregation helper over the members'
    // non-null usages; never re-derive per-adapter cache-read semantics here
    // (data-model §2). The helper only reads `event.tokens`, which slim events
    // carry — the cast bridges the full-tier parameter type without adding
    // fields.
    tokens: aggregateTokenUsage(members as TraceEvent[], TURN_SEMANTICS),
    model:
      members.find(
        (member) => member.model !== null && member.model !== undefined,
      )?.model ??
      session.primaryModel ??
      null,
    messageCount: members.length,
    toolCount,
    status,
    badges: computeBadges({ kind, status, toolCount, members }),
    messages: members.map(toTurnMessage),
  };
}

/**
 * Derive the flat turn model from the ordered slim event stream.
 *
 * @param events          Sequence-ascending slim events (do not re-sort by
 *                        `startedAt`; the API already orders by sequence).
 * @param source          The session plus the detail response's pagination
 *                        flags (design D3's `session` argument).
 * @param _turnKeySource  The adapter's declared turn-key provenance. It is
 *                        part of the spec-mandated input tuple ("derivation
 *                        is a pure function of the events, the session, and
 *                        the adapter's declared turn-key provenance"), but
 *                        the D3 strategy table reads boundaries from the
 *                        events themselves, and the provenance feeds the §6
 *                        criteria line rather than this derivation — hence
 *                        the parameter is accepted but unused here.
 */
export function deriveTurns(
  events: readonly TraceEventSlim[],
  source: TurnDerivationSource,
  _turnKeySource: TurnKeySource,
): TurnModel {
  const segmentationSource = selectSegmentationSource(events);
  const turns: TraceTurn[] = [];
  let cursor = 0;
  // D3: indices are never shifted to close a gap. The first non-init turn
  // always keeps index 1 — when the leading run is empty no turn 0 is emitted
  // and the first turn still starts at 1.
  let nextIndex = 1;

  // D3 turn 0: consume the leading run of system / user_prompt events. When
  // the leading run is empty no index-0 turn is emitted and the first turn
  // keeps index 1 — indices are never shifted to close a gap.
  const leading: TraceEventSlim[] = [];
  let leadingEvent = events[cursor];
  while (
    leadingEvent !== undefined &&
    (leadingEvent.kind === 'system' || leadingEvent.kind === 'user_prompt')
  ) {
    leading.push(leadingEvent);
    cursor += 1;
    leadingEvent = events[cursor];
  }
  if (leading.length > 0) {
    turns.push(buildTurn(0, 'init', leading, source.session));
  }

  // Open-turn state. `openCycleKey` is the turn key of the open turn when it
  // is a cycle turn, else null — a `user` or `init` turn carries no key, so
  // the next keyed event opens a fresh cycle (D3).
  let openKind: TurnKind = 'cycle';
  let openCycleKey: string | null = null;
  let openMembers: TraceEventSlim[] = [];

  const closeOpenTurn = (): void => {
    if (openMembers.length === 0) {
      return;
    }
    turns.push(buildTurn(nextIndex, openKind, openMembers, source.session));
    nextIndex += 1;
  };

  for (; cursor < events.length; cursor += 1) {
    const event = events[cursor]!;

    // D3 user-input rule: a mid-session user prompt always opens its own
    // `user` turn, under every strategy, taking precedence over the
    // strategy's own boundary rule. Check the kind, not only the key — in the
    // `turn_key` path the key may not change at a user prompt.
    if (event.kind === 'user_prompt') {
      closeOpenTurn();
      openKind = 'user';
      openCycleKey = null;
      openMembers = [event];
      continue;
    }

    // D3 cycle rules. A null turn key attaches to the open turn and never
    // opens one: a null key carries no boundary signal (Change A leaves keys
    // null where a source has none; treating null as a boundary would shatter
    // those sessions into one turn per event).
    const shouldOpenCycle =
      openMembers.length === 0 ||
      (segmentationSource === 'turn_key' &&
        event.turnKey !== null &&
        (openCycleKey === null || event.turnKey !== openCycleKey)) ||
      (segmentationSource === 'llm_boundary' && event.kind === 'llm');

    if (shouldOpenCycle) {
      closeOpenTurn();
      openKind = 'cycle';
      openCycleKey =
        segmentationSource === 'turn_key' && event.turnKey !== null
          ? event.turnKey
          : null;
      openMembers = [event];
    } else {
      openMembers.push(event);
    }
  }
  closeOpenTurn();

  return {
    turns,
    segmentationSource,
    complete: !source.hasMore,
    omittedEventCount: source.hasMore
      ? source.eventTotal - events.length
      : 0,
  };
}

/**
 * D6 round count: the `init` turn (when present) plus every `user` turn.
 *
 * Distinct from the total turn count, which counts all three kinds (D3).
 */
export function countRounds(turns: readonly TraceTurn[]): number {
  let rounds = 0;
  for (const turn of turns) {
    if (turn.kind === 'init' || turn.kind === 'user') {
      rounds += 1;
    }
  }
  return rounds;
}
