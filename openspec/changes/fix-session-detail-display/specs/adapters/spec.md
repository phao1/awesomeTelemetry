# Adapters (delta)

## MODIFIED Requirements

### Requirement: OpenCode adapter (reused)
`opencode.ts` SHALL handle three sources — SQLite DB rows (part table joined
with message table) / JSONL / OTel spans — and use the `OpenCodeDialect` param
to distinguish CodeArts / CodeAgent2 / OpenCode. The latter two are thin
wrappers.

Tool-type parts (types `tool` and the tool-capable states in `state`) SHALL
extract their body into the full tier:

- `inputSummary` from the part's `state.input` (object → JSON serialization,
  then truncated per REQ-003; missing or empty → `null`),
- `outputSummary` from `state.output` (string kept as-is; object → JSON
  serialization; missing or empty → `null`),
- `hasInput` / `hasOutput` accordingly, and the Raw tab keeps the untouched
  original part.

Pure control markers (parts of type `step-start` / `step-finish` with no
text, no tokens, no error, and `status === 'completed'`) SHALL NOT become
events. When a message's tokens or error ride on a step part, the step SHALL
be kept as an `agent` event with a deterministic title (e.g. `agent step:
<status>`) so no token or error data is dropped.

#### Scenario: subagent detection
- **GIVEN** a session title matching `/\(@.*\bsubagent\)/i`
- **THEN** `session.isSubagent = true`

#### Scenario: cacheRead incremental (calibrated 2026-08-03)
- **GIVEN** an OpenCode session with 3 events whose `cacheRead` values are
  6016/4000/2000
- **WHEN** computing session-level tokenUsage
- **THEN** `cacheRead` takes the sum (12016), not max
- **AND** `total = input + output + reasoning + cacheRead + cacheWrite`

#### Scenario: tool event carries input and output
- **GIVEN** a CodeArts part `{"type":"tool","state":{"input":{...},
  "output":"...result..."}}`
- **WHEN** the adapter parses the part
- **THEN** the produced event has non-null `inputSummary` (serialized
  `state.input`) and non-null `outputSummary` (`state.output` text)
- **AND** `hasInput === true`, `hasOutput === true`
- **AND** the raw tier still returns the original part unchanged

#### Scenario: pure step markers are dropped
- **GIVEN** a message whose parts are only `step-start` and `step-finish`
  without text, tokens, error, and with `status: completed`
- **WHEN** the adapter parses the message
- **THEN** no events are produced for those parts

#### Scenario: tokens on step parts are preserved
- **GIVEN** a message whose `tokens` are attached to a `step-finish` part
- **WHEN** the adapter parses the message
- **THEN** exactly one `agent` event is produced for that part with the
  message's tokens and a non-empty deterministic title

## ADDED Requirements

### Requirement: OpenCode index event count matches detail
The SQLite index reader SHALL compute the index-phase `eventCount` from the
same part- and message-expansion semantics the detail phase uses: the session's
message count plus its non-marker part count (pure `step-start`/`step-finish`
markers excluded), via lightweight `COUNT` queries over `message` / `part`
without reading bodies.

#### Scenario: index count equals detail count
- **GIVEN** a CodeArts database whose session has 25 messages and 57
  non-marker parts
- **WHEN** the index reader builds `SessionIndexEntry`
- **THEN** `eventCount` equals the count the detail phase produces (82)
- **AND** `messageCount` equals 25

