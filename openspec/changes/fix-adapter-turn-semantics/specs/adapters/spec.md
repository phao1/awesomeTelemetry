## ADDED Requirements

### Requirement: Every adapter supplies turn identity

All nine adapters SHALL populate `turnKey` from their own source format, or return `null`
for every event when the format carries no boundary signal. Each rule SHALL be justified
by that adapter's fixture and covered by a fixture test.

#### Scenario: Explicit boundary markers
- **GIVEN** a source that marks the start and end of a decision cycle
- **WHEN** the adapter runs
- **THEN** the marker's identifier becomes the turn key for every event of that cycle

#### Scenario: Message-identity grouping
- **GIVEN** a source that groups one inference's parts under one message identifier
- **WHEN** the adapter runs
- **THEN** that identifier becomes the turn key
- **AND** tool calls requested by the message and the results answering them inherit it

#### Scenario: No signal available
- **GIVEN** a fixture containing no boundary signal
- **WHEN** the adapter runs
- **THEN** every event receives `null` and the adapter declares `unavailable` provenance
- **AND** the adapter's test states that the rule is fixture-derived and unverified against live data

#### Scenario: Fixture evidence
- **WHEN** an adapter's turn-key rule is implemented
- **THEN** a test drives it from that adapter's fixture and asserts the grouping the fixture actually supports
- **AND** no fixture is deleted or weakened to make a rule pass

### Requirement: Codex event classification

The Codex adapter SHALL classify tool activity, reasoning, and compaction as their real
kinds instead of falling through to the unknown-type branch.

#### Scenario: Tool activity
- **WHEN** a custom tool call, its output, a patch application, an MCP tool result, a web search, or a tool search is read
- **THEN** it is emitted as a tool-family event with its tool name
- **AND** it is not emitted as a system event

#### Scenario: Call and result pairing
- **WHEN** a tool call and its output are read
- **THEN** they are paired through the source's own call identifier
- **AND** pairing SHALL NOT rely on adjacency alone

#### Scenario: Reasoning
- **WHEN** a reasoning or agent-reasoning record is read
- **THEN** it is emitted as a `reasoning` event

#### Scenario: Compaction
- **WHEN** a context-compaction record is read
- **THEN** it is emitted as a `compact` event

#### Scenario: Aborted turn
- **WHEN** a turn-abort record is read
- **THEN** the affected events carry a cancelled status

#### Scenario: Cycle boundary comes from the item stream
- **WHEN** the model's output items are read
- **THEN** a new decision cycle opens at an output item that immediately follows a tool-result item
- **AND** a submission marker such as a task-start record SHALL NOT be treated as a cycle boundary
- **AND** the adapter declares `stream_structure` provenance

#### Scenario: System prompt messages
- **GIVEN** an output message whose role is developer or system
- **WHEN** the adapter runs
- **THEN** it is emitted as a system event, not as a model reply

#### Scenario: UI mirror is not a second message
- **GIVEN** a cycle containing both a UI-level assistant message record and the model's own message item
- **WHEN** the adapter runs
- **THEN** exactly one assistant message event is emitted for that cycle
- **AND** the model's own item is the source of truth
- **AND** the UI record is used only when the cycle has no model message item

#### Scenario: Session metadata is not an event
- **WHEN** a session-metadata record is read
- **THEN** no event is emitted for it
- **AND** its contents may inform session-level fields

#### Scenario: Usage records are not messages
- **WHEN** a token-count record is read
- **THEN** its usage is attached to the decision cycle's assistant event
- **AND** no standalone assistant-message event is emitted for it
- **AND** the session's total token usage is identical to what the previous behaviour produced

### Requirement: Claude tool results are results, not user messages

The Claude adapter SHALL recognise that tool results arrive as user-role rows and
SHALL attach them to their tool event rather than emitting them as user prompts.

#### Scenario: Tool result row
- **GIVEN** a user-role row whose content is a tool-result block
- **WHEN** the adapter runs
- **THEN** the result text is written to the matching tool event's output side and that event reports having output
- **AND** no user-prompt event is emitted for that row

#### Scenario: Matching
- **WHEN** a tool result is attached
- **THEN** it is matched to the tool event whose identifier equals the block's tool-use identifier

#### Scenario: Unmatched result
- **GIVEN** a tool-result block with no matching tool event
- **WHEN** the adapter runs
- **THEN** a tool event carrying only the result is emitted with a status reflecting the block's error flag
- **AND** the result is neither dropped nor converted back into a user message

#### Scenario: Genuine user prompt
- **GIVEN** a user-role row that is not a tool result
- **WHEN** the adapter runs
- **THEN** it is emitted as a user prompt as before
- **AND** the existing system-injection filter continues to apply

### Requirement: Stable ordering for same-timestamp events

Adapters that order events by time SHALL use a stable sort with source order as the
tie-break, so that parts of one message sharing a timestamp keep their original order.

#### Scenario: Same-timestamp parts
- **GIVEN** three events produced from one message with identical timestamps
- **WHEN** ordering runs
- **THEN** their relative order is unchanged
- **AND** their turn-key grouping remains consistent with their assigned sequence numbers
