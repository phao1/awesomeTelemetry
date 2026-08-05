# Spec: Metrics & Analysis

> Metric computation, phase classification, speed metrics, report generation.
> Source files: `src/core/`

## Purpose

Compute the four-dimension metrics (Speed · Accuracy · Stability · Cost) plus
speed metrics from TraceRecord, and generate HTML reports.

## Requirements

### REQ-001: Phase classifier (two-pass algorithm)
`classifyEvents(events)` SHALL use a two-pass algorithm:
- **Pass 1** — label each event's certainty: `explicit` (direct action
  mapping) / `meta` (system, step-start, step-finish) / `propagate` (message,
  reasoning, function_call)
- **Pass 2** — propagate and meta inherit the nearest explicit phase; when
  equally near, prefer the earlier one; LLM leans forward, agent and message
  lean backward

#### Scenario: bash test command
- **GIVEN** a bash event whose command matches
  `npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint`
- **THEN** phase = `verify`

#### Scenario: file write after error
- **GIVEN** the previous bash or test event status is error and the current
  one is file_write
- **THEN** current phase = `debug`

### REQ-002: ACTION_PHASE lookup table
Maintain ~30 action-name → phase mappings: read/glob/grep→understand,
write/edit/patch→implement, todowrite→plan, etc.

### REQ-003: bash command classification
`classifyBashCommand(cmd)` SHALL classify into four classes by regex:
VERIFY_CMD / REPORT_CMD (git commit, push, pr) / UNDERSTAND_CMD (cat, ls,
find, grep) / IMPLEMENT_CMD (rm, cp, mv, mkdir, git add).

### REQ-004: Four-dimension metrics
`computeMetrics(record)` SHALL compute all six `TraceDimensionMetrics` fields.

#### Scenario: errorRate denominator (#14)
- **GIVEN** a session with 1 error user_prompt and 1 success tool event
- **THEN** `errorRate` MUST only count step events (STEP_KINDS): 0/1 = 0, not
  1/2

#### Scenario: verificationCoverage ratio (#15)
- **GIVEN** a session with 3 step events, 1 of which has phase=verify
- **THEN** `verificationCoverage` = 1/3 (no longer always 0 or 1)

### REQ-005: Metric persistence and version invalidation
Four-dimension metrics MUST be persisted together with base metrics. The code
MUST define the constant `METRICS_CALC_VERSION`, bumped on algorithm changes.

#### Scenario: recompute after algorithm upgrade
- **GIVEN** a session's `metrics.calc_version` in the DB is less than
  `METRICS_CALC_VERSION`
- **WHEN** reading that session's metrics
- **THEN** recompute and write back, updating `calc_version` to the current
  value

> v4's G5.3 "four-dimension metrics not persisted is a design choice" is
> overturned in v5. That design is the direct cause of Agent Overview needing
> 524 N+1 requests. v2 (2026-08-04): errorRate denominator changed to step
> event count (#14); verificationCoverage changed to verify event count / step
> count ratio (#15). The algorithm change bumped `METRICS_CALC_VERSION = 2`.
> v3 (add-mission-control): `metrics.ttft_ms` / `metrics.e2e_ms` are persisted
> with the base metrics (design.md §4 B6), so `METRICS_CALC_VERSION = 3` to
> force a recompute of existing rows (G11.11).

### REQ-006: Speed metrics
`computeSpeedMetrics(record)` SHALL compute TTFT, TPS, TPOT, E2E, median turn
gap, and `pureInferenceMs`. Computed at runtime, not persisted.

#### Scenario: TTFT (#1)
- **GIVEN** first user_prompt at 00:00:00, first llm at 00:00:01, llm
  durationMs = 5000
- **THEN** `ttftMs` = 1000 (time difference), **not** the llm's durationMs
  (5000)

#### Scenario: TPS per-event average (#11/#13)
- **GIVEN** two valid llm events: 30 tokens/200ms, 20 tokens/300ms
- **THEN** `tps` = (150 + 66.7)/2 ≈ 108.3 (arithmetic mean per event),
  `tpotMs` = 500/50 = 10 (aggregated)
- **AND** llm events with tokens.output <= 0 or durationMs <= 0 do not
  participate in TPS/TPOT but still count into `pureInferenceMs`

#### Scenario: response latency (#12)
- **GIVEN** llm appears 1s after user_prompt A and 2s after user_prompt B
- **THEN** `avgLlmResponseLatencyMs` = 1500ms; `turnGapMedianMs` stays the
  median gap between two user inputs

#### Scenario: pure inference time source
- **GIVEN** a CodeArts provider whose event carries both Kernel-Inference
  duration and InferHub.inference_duration
- **THEN** `pureInferenceMs` MUST take `InferHub.inference_duration`
- **AND** Kernel-Inference duration includes tool execution time; using it
  overestimates

### REQ-007: Token breakdown
`computeTokenBreakdown(record)` SHALL break down input / output / reasoning /
cacheRead / cacheWrite. `extractTokenText()` extracts readable text.

#### Scenario: real text extraction (#19)
- **GIVEN** a record with a user_prompt (inputSummary), llm (outputSummary),
  OpenCode raw `{"type":"reasoning","text":...}`, Trae raw
  `{"reasoningContent":...}`, and session.systemPrompt
- **THEN** `extractTokenTexts(record)` returns the four text classes
  system/input/output/reasoning; unparseable raw is ignored without throwing

### REQ-008: Single-session report
`buildTraceReportHtml(record)` SHALL generate a self-contained HTML report
(incl. SVG visualizations).

#### Scenario: large JSON embedding
- **GIVEN** the JSON to embed in the report exceeds 100KB
- **THEN** MUST write it to an external `.js` file referenced by
  `<script src>`
- **AND** MUST NOT inline `<script>var data = {...}</script>` (`</script>` and
  special chars in JSON break HTML parsing)

### REQ-009: Compare report
`buildCompareReportHtml(left, right)` SHALL generate a left/right compare HTML
(radar chart, timeline, pros/cons cards).

### REQ-010: user_prompt filtering
`isGenuineUserPrompt(text)` SHALL filter out `<system-reminder>` and other
system injections. `cleanPromptText(text)` strips tags.

### REQ-011: server aggregation consistency
`getAgentOverview()`'s SQL aggregation results MUST agree with per-session
`computeMetrics()` on the same accounting.

#### Scenario: consistency test
- **GIVEN** a fixed fixture session set
- **WHEN** aggregating via SQL and via per-session `computeMetrics` averaged
- **THEN** the errorRate, verificationCoverage, and avgToolDurationMs
  differences between the two < 0.001

> This is the only test that prevents "server aggregation cuts corners so the
> numbers don't match"; it must exist.

### REQ-012: Event duration derivation (add-mission-control)
`deriveDurations(events)` in `src/adapters/helpers.ts` SHALL derive missing
event durations from adjacent timestamps. All four rules MUST be implemented
exactly; a derived value is worse than 0 when any rule is skipped:

1. After sorting by time, `durationMs = next.startedAt − this.startedAt`; the
   last event stays 0.
2. **`user_prompt` events never participate** — the gap after a user prompt is
   "user thinking", not model/tool time, and belongs to
   `TimeComposition.userWait`.
3. A single derived value is capped at `DERIVED_DURATION_CAP_MS = 300_000`
   (5 minutes); a larger gap means a human left, truncate it (counts as idle).
4. The caller MUST label the session `durationSource: 'derived'`; the value is
   only ever presented with a criteria line stating "durations derived from
   adjacent timestamps, includes scheduling gaps".

#### Scenario: derived durations on claude/codex fixtures
- **GIVEN** a claude fixture whose raw events all have `durationMs = 0`
- **WHEN** `deriveDurations` is applied and metrics are computed
- **THEN** `avgToolDurationMs > 0`
- **AND** the gap after a `user_prompt` lands in `TimeComposition.userWait`,
  not `model` / `tool`
- **AND** a gap longer than 5 minutes is truncated to
  `DERIVED_DURATION_CAP_MS`

#### Scenario: measured sources stay measured
- **GIVEN** an opencode session parsed from the OTel source with real span
  durations
- **THEN** its events keep their measured durations and
  `durationSource = 'measured'`
- **AND** the choice MUST follow the actual parse path, never a per-provider
  hardcode

### REQ-013: Model pricing & cost estimation (add-mission-control)
`src/core/pricing.ts` SHALL expose `ModelPrice` / `computeCostUsd(tokens,
model)` / `lookupContextWindow(model)`. Every built-in price MUST carry a
`source` (URL or doc name + fetch date); model ids are normalized by
`normalizeModelId()` before lookup. Unknown models return
`{ costUsd: 0, costSource: 'unknown' }`.

#### Scenario: unknown model renders dash, never $0.0000
- **GIVEN** a model not present in any pricing layer
- **WHEN** computing cost
- **THEN** the result is `{ costUsd: 0, costSource: 'unknown' }`
- **AND** UI tests assert the rendered cell is `—`, NOT `$0.0000`

#### Scenario: context window comes from the pricing table
- **GIVEN** `lookupContextWindow(model)` for a known model
- **THEN** it returns the model's `contextWindow` from the pricing table
- **AND** for an unknown model it returns `null` — hardcoding 200k is
  forbidden (glm / deepseek windows differ)

### REQ-014: Error text classification (add-mission-control)
`classifyErrorText(error)` SHALL normalize free-text `events.error` into a
finite set (`network / timeout / permission / shell / parse / notfound /
other`). The criteria line MUST state "derived classification, not the
vendor's original error code".

#### Scenario: deterministic mapping
- **GIVEN** error texts containing timeout / ENOENT / permission-denied /
  connection-refused style patterns
- **THEN** each maps to exactly one of the finite classes and unknown text
  maps to `other`

### REQ-015: Prompt scene classification (add-mission-control)
`src/core/scene-classifier.ts` SHALL classify genuine user prompts into ~12
scene buckets via keyword/rule matching. Two escape hatches MUST exist:
`unclassified` and `other`. **Aggregation endpoints return only
`{scene, count, tokenSum}` — prompt bodies never leave the server.** Bodies
must pass through the desensitization engine before classification.

#### Scenario: no prompt body leaves the server
- **GIVEN** a mission endpoint that aggregates scene distribution
- **THEN** its response body contains only `{scene, count, tokenSum}` rows
- **AND** a contract test asserts the response does not contain any known
  prompt text from the fixture

## Gotchas
- G4.1: Kernel-Inference duration includes tool time; pure LLM time uses
  InferHub.inference_duration
- G4.6: total duration uses wall-clock
- G10.4: the two-pass phase classification algorithm must be ported in full
- G7.6: large JSON in report HTML must use an external JS file
- G7.2: report fonts support A-/A+/R adjustment
- G11.11 (new): after persisting four-dimension metrics, any algorithm change
  must bump `METRICS_CALC_VERSION`, otherwise stale dirty data stays in the DB
  unnoticed
