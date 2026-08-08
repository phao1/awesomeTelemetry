## ADDED Requirements

### Requirement: Derived turn model

The trace model SHALL define a derived turn layer over the ordered event stream. Turn
derivation SHALL be a pure function of the events, the session, and the adapter's declared
turn-key provenance. It SHALL run in a single pass, and SHALL NOT be persisted or computed
on the server.

```ts
export type TurnSegmentationSource =
  | 'turn_key'
  | 'llm_boundary'
  | 'user_prompt_boundary'
  | 'sequence_fallback';

export type TurnKind = 'init' | 'user' | 'cycle';

export type MessageRole =
  | 'system' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'compact' | 'subagent';

export interface TurnMessage {
  eventId: string;
  sequence: number;
  role: MessageRole;
  kind: TraceKind;
  title: string;
  tool: string | null;
  startedAt: string;
  durationMs: number;
  status: TraceStatus;
  tokens: TokenUsage | null;
  hasInput: boolean;
  hasOutput: boolean;
  hasRaw: boolean;
  error: string | null;
}

export type TurnBadge =
  | 'init' | 'user' | 'tools' | 'stop' | 'error' | 'subagent' | 'compact' | 'running';

export interface TraceTurn {
  index: number;
  kind: TurnKind;
  startedAt: string;
  durationMs: number;
  tokens: TokenUsage;
  model: string | null;
  messageCount: number;
  toolCount: number;
  status: TraceStatus;
  badges: TurnBadge[];
  messages: TurnMessage[];
}

export interface TurnModel {
  turns: TraceTurn[];
  segmentationSource: TurnSegmentationSource;
  complete: boolean;
  omittedEventCount: number;
}
```

#### Scenario: Adapter-supplied turn keys are preferred
- **GIVEN** any event carries a non-null turn key
- **WHEN** turns are derived
- **THEN** the segmentation source is `turn_key`
- **AND** a new turn opens whenever the key differs from the open turn's key

#### Scenario: Null keys attach rather than split
- **GIVEN** a session where some events carry a turn key and others carry null
- **WHEN** turns are derived
- **THEN** a null-keyed event attaches to the open turn
- **AND** a null key never opens a turn

#### Scenario: Fallback when no adapter key exists
- **GIVEN** every event carries a null turn key
- **WHEN** turns are derived
- **THEN** the source is `llm_boundary` if any inference event exists, else `user_prompt_boundary` if any user prompt exists, else `sequence_fallback`
- **AND** in `sequence_fallback` exactly one turn is emitted containing every event
- **AND** events SHALL NOT be chunked by count, by time gap, or by any other invented boundary

#### Scenario: Initialisation turn
- **GIVEN** a session whose leading events are system and/or user prompts
- **WHEN** turns are derived
- **THEN** those events form a turn with index 0 and kind `init`
- **AND** when no such leading run exists, no index-0 turn is emitted and the first cycle keeps index 1
- **AND** turn indices are never shifted to make the sequence contiguous

### Requirement: A user input is a turn

A turn is one piece of thinking plus the actions that thinking took. A user input is also
a turn. The model SHALL express all three kinds — initialisation, user input, and decision
cycle — in one flat ordered list, with no additional grouping layer above them.

#### Scenario: Mid-session user input
- **GIVEN** a user prompt occurring after the initialisation turn
- **WHEN** turns are derived
- **THEN** it opens a turn of kind `user`
- **AND** it is neither absorbed into the following decision cycle nor appended to the preceding one
- **AND** this holds under every segmentation strategy

#### Scenario: All three kinds are counted
- **WHEN** a turn count is reported
- **THEN** initialisation, user, and cycle turns are all counted
- **AND** each is rendered in the same ordered list

#### Scenario: No second grouping layer
- **WHEN** the model is produced
- **THEN** turns form one flat ordered sequence
- **AND** decision cycles are NOT nested inside a conversation-round container

#### Scenario: Turn duration is wall-clock
- **WHEN** a turn's duration is computed
- **THEN** it equals the last member's end instant minus the first member's start instant, floored at 0
- **AND** it SHALL NOT be the sum of member durations

#### Scenario: Turn token aggregation reuses the contract helper
- **WHEN** a turn's tokens are computed
- **THEN** the existing session-level token aggregation helper is applied to the members' non-null usages
- **AND** the per-adapter cache-read semantics are not re-derived locally

### Requirement: Message grouping within a turn

A turn's events SHALL be grouped so that an assistant reply carries the tool calls it
issued, and each tool result renders as its own message.

#### Scenario: Assistant message composition
- **WHEN** a turn contains inference and reasoning events
- **THEN** they produce one assistant message
- **AND** reasoning content is separable from the reply content

#### Scenario: Tool event feeds two places
- **GIVEN** a tool-family event carrying both an argument side and a result side
- **WHEN** the turn is rendered
- **THEN** its arguments appear as a call block belonging to the assistant message
- **AND** its result appears as a separate tool message ordered after the assistant message
- **AND** multiple tool events keep their sequence order in both places

#### Scenario: Tool call identity
- **WHEN** a tool call block is rendered
- **THEN** its identity is the event identifier supplied by the contract
- **AND** the identifier is displayed verbatim, never parsed, reformatted, or generated

#### Scenario: Compaction message
- **WHEN** a turn contains a compaction event
- **THEN** it produces a single-line compaction message rather than an expandable body

### Requirement: Turn badges are derived, never read

Badges SHALL be computed only from data the contract guarantees.

#### Scenario: Badge derivation
- **WHEN** badges are computed
- **THEN** `init` marks the initialisation turn, `user` a user-input turn, `tools` a turn with tool calls, `stop` a decision-cycle turn with none, `error` and `running` the turn status, `subagent` a turn containing agent or subagent-prompt events, and `compact` a turn containing a compaction event

#### Scenario: Stop reason is not fabricated
- **WHEN** the source data has no stop-reason field
- **THEN** no length badge exists
- **AND** `stop` means only that the cycle made no tool call

### Requirement: Turn model completeness is explicit

When the source detail response was paginated, the derived model SHALL declare itself
incomplete and report how many events were omitted.

#### Scenario: Paginated detail
- **GIVEN** a detail response reporting more events than it returned
- **WHEN** turns are derived
- **THEN** the model is marked incomplete with the omitted count
- **AND** consumers SHALL NOT present any total derived from it as final
