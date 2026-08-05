# Metrics & Analysis (delta)

## ADDED Requirements

### Requirement: LLM token attribution (read-only)
`attributeTokensToLlmEvents(record)` in `src/core/speed-metrics.ts` SHALL return a
read-only `Map<eventId, TokenUsage>` attributing each token-carrier event's usage to
exactly one `kind='llm'` event, so that speed metrics can be computed for providers
whose tokens live on non-llm carrier events.

The function MUST NOT mutate `record`, MUST NOT write into `event.tokens`, and MUST
NOT be consulted by `aggregateTokenUsage()`. Attribution is 1:1 — once a carrier is
consumed it MUST NOT be attributed again — and MUST NOT cross message boundaries.

> Rationale: OpenCode/CodeArts attach tokens only to the `step` part, which
> `src/adapters/opencode.ts` maps to `kind='agent'` via `isTokenCarrier()`.
> `computeSpeedMetrics` reads only `kind='llm'`, so `tps`/`tpotMs` are permanently
> `null` for those providers. Writing tokens back onto llm events would make the
> session-level `reduce` count them twice — the exact defect recorded as §4.1 of the
> source change spec.

#### Scenario: speed metrics become computable
- **GIVEN** an OpenCode record whose tokens live on `kind='agent'` step events
- **WHEN** `computeSpeedMetrics(record)` runs
- **THEN** `tps` and `tpotMs` are non-null
- **AND** the sum of attributed output tokens equals the sum of carrier output tokens
  (proving 1:1, not 1:N)

#### Scenario: aggregation is unaffected (double-count guard)
- **GIVEN** any record
- **WHEN** `computeTokenBreakdown(record).total` is read before and after calling
  `attributeTokensToLlmEvents(record)`
- **THEN** the two values are exactly equal

### Requirement: Extended session metrics
`computeMetrics(record)` SHALL additionally compute `totalToolDurationMs`
(sum of `durationMs` over events with `tool !== null`), `llmCallCount`
(`kind='llm'` count), `userInteractionRounds` (`kind='user_prompt'` count),
`hasUnitTests` (any `phase='verify'` event whose command/title matches the test
command pattern), and `failedCommandCount` (`status='error'` events whose kind is
one of `bash`/`test`/`tool`/`file_write`/`file_read`/`agent`).

`failedCommandCount` MUST exclude `kind='llm'` — a model error is not a command
failure — and is an absolute count, deliberately a different measure from
`errorRate`, whose denominator is `STEP_KINDS`.

#### Scenario: failedCommandCount excludes llm errors
- **GIVEN** a session with 1 errored `llm` event and 2 errored `bash` events
- **THEN** `failedCommandCount` = 2

## MODIFIED Requirements

### Requirement: Speed metrics
`computeSpeedMetrics(record)` SHALL additionally compute `avgLlmDurationMs`
(`pureInferenceMs / llmCallCount`), `cacheHitRate`
(`cacheRead / (input + cacheRead)`), and `avgTokensPerCall`
(`total / llmCallCount`). Each MUST return `null` when its denominator is 0 —
returning `0` is forbidden, because `0` is indistinguishable from a real measured
zero and the UI renders `—` for `null`.

When a session has no cache data but `session.systemPrompt` is non-null, a system
prompt token estimate of `systemPrompt.length / 4` MAY be exposed as a separate
display field. It MUST NOT be added into `TokenUsage.input` (that is the billing
figure and feeds cost computation), and any UI surfacing it MUST label it as an
estimate.

#### Scenario: null instead of zero
- **GIVEN** a session with 0 llm events
- **THEN** `avgLlmDurationMs` and `avgTokensPerCall` are `null`, not `0`

### Requirement: Token breakdown
`TokenUsage` SHALL carry `netInput` = `max(0, input − cacheRead)`.
No `totalTokens` field is added — `TokenUsage.total` already carries that value with
the accounting defined by G4.5, and two names for one number will drift apart.

#### Scenario: netInput excludes cache reads
- **GIVEN** a session with `input = 28494` and `cacheRead = 9716`
- **THEN** `netInput` = 18778

### Requirement: Metric persistence and version invalidation
`METRICS_CALC_VERSION` SHALL be bumped from 3 to 4, and `SCHEMA_VERSION` from 3 to
4, adding five persisted metric columns. Without the `METRICS_CALC_VERSION` bump,
existing rows keep `calc_version = 3` and the new columns stay at their defaults
forever with no visible error.

#### Scenario: recompute after v4 upgrade
- **GIVEN** a session whose `metrics.calc_version` in the DB is 3
- **WHEN** reading that session's metrics with `METRICS_CALC_VERSION = 4`
- **THEN** recompute and write back, updating `calc_version` to 4 and filling the
  five new columns with non-default values

### Requirement: Compare report
`buildCompareReportHtml(left, right)` SHALL present **three** competitive
dimensions — fast / frugal / quality — with the former `stability` dimension merged
into `quality`. The quality dimension carries eight metrics: read-write ratio, file
write count, code conciseness, verification coverage, unit tests, failure count,
repair loops, and user interaction rounds.

Code conciseness is defined as `totalSteps / fileWriteCount` (average steps spent
per file write). A metric whose formula is not written down MUST NOT ship.

This changes the **presentation layer only**. The `TraceDimensionMetrics` type
(`contracts/data-model.md`) is unchanged — the metric model and the number of
comparison cards are separate concerns.

#### Scenario: three dimensions rendered
- **GIVEN** two records
- **WHEN** `buildCompareReportHtml(left, right)` runs
- **THEN** the output contains exactly the fast / frugal / quality dimensions
- **AND** contains no separate stability dimension card
