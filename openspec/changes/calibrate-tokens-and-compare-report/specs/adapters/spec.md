# Adapters (delta)

## MODIFIED Requirements

### Requirement: Trae event kind mapping
The Trae adapter SHALL map `turn.toolName` (from `chat_message_task.tool_name`,
case-normalized to lowercase) to a `TraceEvent.kind` when `turn.type` falls through
to the `'tool'` default. `turn.type` keeps priority — it is Trae's own first-class
classification and is more trustworthy than the tool label.

Coverage: `bash`/`terminal`/`runcommand`/`run_command`/`executecommand` → `bash`;
`read`/`readfile`/`read_file`/`glob`/`grep`/`ls`/`codesearch`/`search`/`view` →
`file_read`; `write`/`writefile`/`write_file`/`edit`/`searchreplace`/
`search_replace`/`str_replace`/`create` → `file_write`.

> The list above comes from an external change spec and is **not verified against
> this project's data**. It MUST be reconciled against
> `SELECT DISTINCT tool_name FROM chat_message_task` on a real Trae database before
> being treated as complete; if no real database is reachable, that MUST be recorded
> as a pending decision rather than silently assumed.

#### Scenario: PascalCase tool names classify correctly
- **GIVEN** a Trae turn with `type='tool'` and `toolName='SearchReplace'`
- **THEN** the event kind is `file_write`, not the `tool` fallback

#### Scenario: type wins over toolName
- **GIVEN** a Trae turn with `type='read_file'` and `toolName='Bash'`
- **THEN** the event kind is `file_read`

### Requirement: Trae event timing
Trae events with a missing `startTime` SHALL inherit the previous event's
`startedAt` (the session `startedAt` for the first event) instead of falling back to
the Unix epoch, which throws those events to the front of the timeline.

Groups of events sharing an identical timestamp (Trae tool calls inherit their
parent message's timestamp) SHALL split the gap to the next group evenly:
`durationMs = gap / n` with the remainder assigned to the last member so the group
sum equals the gap exactly. `user_prompt` events do not participate — their gap
belongs to `TimeComposition.userWait` (REQ-012). The existing
`DERIVED_DURATION_CAP_MS` cap applies; the session stays `durationSource: 'derived'`.

#### Scenario: even split across a same-timestamp group
- **GIVEN** 3 Trae tool events all at `T`, and the next event at `T + 1000ms`
- **THEN** each event gets `durationMs` summing to exactly 1000

### Requirement: Trae tool status detection
When `turn.status` is absent or empty, the Trae adapter SHALL derive status from
`turn.toolResult`, marking `error` on a match of
`/\b(error|failed|failure|exception|traceback)\b/i`. When `turn.status` has a value
it wins.

> The guard exists because a successful `grep "error" app.log` necessarily contains
> the word "error" in its result. Over-reporting failures would corrupt both
> `errorRate` and `failedCommandCount`; under-reporting is the safer error.

#### Scenario: successful grep is not a failure
- **GIVEN** a Trae turn with `status='completed'` and a `toolResult` containing
  "error"
- **THEN** the event status is `success`, not `error`

## Gotchas

- G4.2 / G4.3 / G4.4 / G4.5 are already implemented in this repository and MUST NOT
  be re-litigated. There is no `TOKEN_DIVISOR` anywhere in the tree, and none is to
  be introduced.
- `isTokenCarrier()` in `src/adapters/opencode.ts` is the defense against the
  N-times token inflation caused by attaching one message's tokens to every part.
  Attribution for speed metrics MUST stay read-only and outside it.
