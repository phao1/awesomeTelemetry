# Metrics & Analysis (delta)

## MODIFIED Requirements

### Requirement: Metric persistence and version invalidation
`METRICS_CALC_VERSION` SHALL be bumped from 2 to 3 (add-mission-control):
`metrics.ttft_ms` / `metrics.e2e_ms` are now persisted with the base metrics
(design.md §4 B6), and G11.11 requires an algorithm change to invalidate
existing rows.

#### Scenario: recompute after v3 algorithm upgrade
- **GIVEN** a session's `metrics.calc_version` in the DB is 2
- **WHEN** reading that session's metrics with `METRICS_CALC_VERSION = 3`
- **THEN** recompute and write back, updating `calc_version` to 3 and filling
  `ttft_ms` / `e2e_ms`

## ADDED Requirements

### Requirement: Event duration derivation
`deriveDurations(events)` in `src/adapters/helpers.ts` SHALL derive missing
event durations from adjacent timestamps with all four rules: sort by time and
`durationMs = next.startedAt − this.startedAt` with the last event 0;
`user_prompt` never participates (its gap belongs to
`TimeComposition.userWait`); single values capped at
`DERIVED_DURATION_CAP_MS = 300_000`; callers MUST label the session
`durationSource: 'derived'` and the UI criteria line MUST state "durations
derived from adjacent timestamps, includes scheduling gaps".

#### Scenario: derived durations on claude/codex fixtures
- **GIVEN** a claude fixture whose raw events all have `durationMs = 0`
- **WHEN** `deriveDurations` is applied and metrics are computed
- **THEN** `avgToolDurationMs > 0`
- **AND** the gap after a `user_prompt` lands in `userWait`, not model/tool
- **AND** a gap longer than 5 minutes is truncated to the cap

#### Scenario: measured sources stay measured
- **GIVEN** an opencode session parsed from the OTel source with real span
  durations
- **THEN** events keep their measured durations and `durationSource =
  'measured'`, chosen by the actual parse path, never by provider hardcode

### Requirement: Model pricing & cost estimation
`src/core/pricing.ts` SHALL expose `ModelPrice` / `computeCostUsd(tokens,
model)` / `lookupContextWindow(model)`. Every built-in price carries a
`source`; unknown models return `{ costUsd: 0, costSource: 'unknown' }` and
the UI renders `—`, never `$0.0000`.

#### Scenario: unknown model renders dash
- **GIVEN** a model not present in any pricing layer
- **WHEN** computing cost
- **THEN** the result is `{ costUsd: 0, costSource: 'unknown' }`
- **AND** UI tests assert the cell renders `—`, not `$0.0000`

#### Scenario: context window comes from the pricing table
- **GIVEN** `lookupContextWindow(model)` for a known model
- **THEN** it returns the pricing table's `contextWindow`
- **AND** for an unknown model it returns `null` (hardcoding 200k is
  forbidden)

### Requirement: Error text classification
`classifyErrorText(error)` SHALL normalize free-text errors into a finite set
(network / timeout / permission / shell / parse / notfound / other), with the
criteria line stating "derived classification, not the vendor's original error
code".

#### Scenario: deterministic mapping
- **GIVEN** timeout / ENOENT / permission-denied / connection-refused style
  texts
- **THEN** each maps to exactly one finite class and unknown text maps to
  `other`

### Requirement: Prompt scene classification
`src/core/scene-classifier.ts` SHALL classify genuine user prompts into ~12
scene buckets by keyword/rule matching with `unclassified` and `other`
escape hatches. Aggregation endpoints return only `{scene, count, tokenSum}`;
prompt bodies never leave the server and pass through the desensitization
engine first.

#### Scenario: no prompt body leaves the server
- **GIVEN** a mission endpoint aggregating scene distribution
- **THEN** the response contains only `{scene, count, tokenSum}` rows
- **AND** a contract test asserts no known fixture prompt text appears in the
  response
