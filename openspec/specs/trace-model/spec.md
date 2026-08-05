# Spec: Trace Model

> The normalized trace data model. All adapters convert raw data into these
> types; everything downstream builds on them.
> **The authoritative type definitions live in `contracts/data-model.md`; this
> file only defines behavior requirements.**
> Source file: `src/core/trace-types.ts`

## Purpose

Define a provider-agnostic trace data model so 9 heterogeneous agent data
sources normalize into one shape.

## Requirements

### REQ-001: Single source of type definitions
All types MUST adopt `contracts/data-model.md` verbatim. No module MUST define
its own structurally identical types with different field names.

#### Scenario: encountering an undefined enum value
- **GIVEN** an adapter encounters a phase value not defined in
  `contracts/data-model.md`
- **WHEN** normalizing
- **THEN** map it to one of the six legal values; when unmappable, fall back
  to `implement` and record the original value in `event.error`
- **AND** MUST NOT add a member to the `TracePhase` union type

### REQ-002: Three event tiers
The system SHALL distinguish `TraceEventSlim` / `TraceEvent` /
`TraceEventRaw`.

#### Scenario: slim tier has no body
- **GIVEN** any slim-tier event
- **THEN** the object MUST NOT contain any of `inputSummary`,
  `outputSummary`, `raw`
- **AND** replace them with the booleans `hasInput` / `hasOutput` / `hasRaw`

> Basis: in v4, the single `events.raw` column was 64.2% of DB size
> (147.82MB), and `inputSummary` + `outputSummary` another 82.28MB. The
> three-tier split is the key to cutting the worst session detail from 32.3MB
> to 1.5MB.

### REQ-003: Explicit token aggregation semantics
Every adapter MUST return `TokenSemantics` declaring whether its `cacheRead`
and `reasoning` are cumulative or incremental. The storage layer SHALL pick
`Math.max()` or `sum` accordingly.

#### Scenario: OpenCode-family cumulative cacheRead
- **GIVEN** a provider in the opencode / codearts / codeagent2 family
- **THEN** `tokenSemantics.cacheRead === 'cumulative'`
- **AND** session-level cacheRead takes `Math.max()` over all events

#### Scenario: reasoning is always incremental
- **GIVEN** any provider
- **THEN** `tokenSemantics.reasoning === 'incremental'`; session level uses sum

> ⚠️ Translation note: the scenario above is **stale**. Measured calibration
> on 2026-08-03 overturned it: `contracts/data-model.md` §2 (higher priority)
> and `openspec/gotchas.md` G4.4 state that OpenCode/CodeArts/CodeAgent2
> `cacheRead` is **incremental per step** and must be summed, never
> `Math.max()`. Resolve per the priority list in AGENTS.md: contract wins; this
> scenario should be corrected when the spec is next revised.

> v4 kept this as a human-remembered gotcha (G4.4); v5 makes it a
> type-enforced field — an adapter that doesn't declare it cannot compile.

### REQ-004: total formula
`tokenUsage.total` MUST equal `input + output + reasoning + cacheRead`.
MUST NOT omit `reasoning`; MUST NOT include `cacheWrite`.

### REQ-005: Duration uses wall-clock
`TraceSession.totalDurationMs` MUST equal last event's `startedAt` minus first
event's `startedAt`. MUST NOT sum each event's `durationMs` (they overlap and
have gaps).

### REQ-006: Status normalization
Adapters MUST map provider-native statuses to the five-value `TraceStatus`:
completed→success, paused→running, canceled→cancelled, unknown values→unknown.

### REQ-007: Title length caps
`TraceEventSlim.title` MUST not exceed 200 chars and `error` MUST not exceed
500 chars, truncated by the adapter. Over-long body text goes into
`inputSummary` / `outputSummary`.

> Basis: target slim-tier size is ~120 bytes per event. 9,590 events × 120B ≈
> 1.15MB, within the NFR budget.

### REQ-008: Timestamp format
All external timestamps MUST be ISO 8601 UTC strings. Conversion of second- or
millisecond-level numeric timestamps MUST happen inside adapters (e.g. Trae's
second-level timestamps need ×1000).

## Gotchas
- G4.4: cacheRead cumulative uses max, reasoning incremental uses sum — since
  v5 enforced via the `TokenSemantics` type (see the calibration note under
  REQ-003)
- G4.5: the total formula must not omit reasoning
- G4.6: total duration uses wall-clock
- G11.1 (new): if the slim tier leaks body fields, the worst session response
  bounces from 1.5MB back to 32MB
