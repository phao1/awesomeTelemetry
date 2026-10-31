# Task mode experiments

User-authorized post-M12 increment (2026-10-29). Extends the task-centred reader
and reuses benchmark timing, usage and independent acceptance types. Canonical
additive DTOs: `src/core/team-experiment-types.ts`. No native trace/schema change.

## TEAM-EXP-001: controlled execution

One plan fixes a task, local Git ref resolved once, an external independent
evaluator and named acceptance cases. Two or three variants declare
`single_loop`, `subagents` or `agent_team`, their own exact prompt, product,
model, environment, parameters, toolset and argv driver. Repetitions:1..10.
Parallel paired execution is explicit; sequential is available to investigate
resource contention. Every repetition prepares all workspaces before starting
drivers. Workspace and output directories are new, never reset the source.
No shell interpolation. No real model execution on page load/import/replay.

Driver context retains BENCHMARK_* paths and adds mode, common task prompt,
per-variant prompt and TEAM_EXPERIMENT_EVIDENCE_PATH. The evaluator alone receives
TEAM_EXPERIMENT_CASES_PATH and supplies named passed/failed/unknown cases.
The evaluator runs even if a successful driver produced malformed telemetry.
Telemetry failure does not replace acceptance with failure. Abort/timeouts stop
owned process groups; no retry. Save each finished trial atomically, preserving
completed evidence. Concurrent writes to report.json are serialized.

## TEAM-EXP-002: evidence and validation

An experiment report contains plan, resolved commit, creation UTC, synthetic flag
and trial records with exact prompt SHA256, BenchmarkRun, optional case verdicts,
optional collaboration evidence and explicit evidence errors. Named case sets
must exactly match the fixed plan; aggregate and named verdict disagreements
are unknown, never a quality win. Trial/variant/repetition identities are unique.
Import <=16MiB, <=30 trials, <=64 agents/trial, <=2000 events/trial and <=20000
events/report; bounded strings, finite nonnegative clocks, unique IDs and valid
references. Validate parent/dependency cycles and unknown references. No HTML,
file dereference or command execution from imported reports.
Driver telemetry IDs beginning `runner-` are reserved for execution phases.
Invalid/reserved/out-of-clock capture is unavailable with an explicit error;
independent acceptance still runs. At the total report event/span limit, omit
the affected trial's entire capture section with an explicit capacity error and
keep its original local file, rather than truncate and claim complete coverage.

Collaboration evidence has independent roster/activity/communication coverage.
Agents have explicit ID, name, parent ID and native session locator. Events have
exact ID, agent, target, kind, start/duration, measured/observed/derived timing,
status, name, public detail, dependencies, optional token count and native event
locator. Kinds: model/tool/task/message/wait/handoff/verification/artifact/rework/
context. Driver clocks are relative to agent start. Report clocks use that same
agent start for collaboration, while BenchmarkRun spans retain run-start clocks.
Do not derive waits from gaps, redundant work from same-file access, causality
from sequence, or team mode from number of agents/messages alone. Declared mode
and observed structure are separately labelled. Missing coverage stays unknown.
Task intervals used for work diagnostics must represent recorded work, not an
entire task lifecycle containing waits. Activity overlap is not CPU occupancy or
live model concurrency; it never substitutes for the paired E2E measurement.

## TEAM-EXP-003: comparison and guidance

Quality first: show per-case pass/fail flips for paired repetitions, unknowns and
aggregate verdicts. Reuse benchmark E2E, corrected tokens, calls, TTFT/TPOT and
repeated-run statistics. Compare actual paired single-loop vs multi-agent E2E;
never label sum(activity duration)/wall clock as measured speedup.
Show independently recorded work overlap, peak active agents, accumulated
per-agent wait (union within agent), message/handoff/rework counts and context
tokens. These are diagnostics, not additional billable usage or proof of cause.

Recommendations are transparent hypotheses scoped to this task/configuration:
quality gates precede efficiency; require >=3 complete real repetitions and
confirmed model/accounting for a firm configuration preference. Synthetic data
always yields illustrative guidance; missing/incomparable evidence yields
insufficient evidence. Different prompts/models/tools/environment must be
visible and prevent architecture-only attribution. Parallel resource contention
is always disclosed. No fabricated universal winner, weighted score or money.
References and user feedback are methodological evidence, not measured outcomes.
Actual model confirmation is a driver declaration for the entire participating
configuration, including workers. A lead-only observation must remain unknown;
matching a string does not independently certify the provider's model identity.
Observed cross-host differences, contradictory complete rosters and known
paired quality regressions block a firm preference for the affected configuration.

## TEAM-EXP-004: presentation and replay

Lazy task-mode experiment entry within the existing shell. Structured task and
variant prompt configuration; four explicit synthetic scenarios (single wins,
subagents wins, team improves acceptance, incomplete evidence); import/export
and executable plan export. Explicit local paired fixture execution proves
concurrent drivers, independent workspaces and acceptance without model calls.
Real driver execution is explicit CLI only; document its integration protocol.

Paired replay shares a task-relative cursor: play/pause, seek, next/previous
event, speed, variant/repetition/member/type filters. Replay reveals only recorded
events at/before the cursor and never executes requests/tools. Each member has
one colored activity row. Task name, compact controls and trajectory remain
sticky; the main document scrolls through detailed records. Select an exact
event to inspect public content, parameters/results, timing, dependencies and
native locator. Keyboard accessible, bilingual, no per-event network reads.
Bound DOM with <=100 visible events/page and <=64 member rows. Empty/unknown
states, owned cancellation,5s file reads and late-response suppression required.

## File scope

New: this contract; openspec/specs/team-experiment/spec.md;
src/core/team-experiment-{types,validation,analysis,demo}.ts and adjacent tests;
server/team-experiment/{runner,demo,cli}.ts and tests;
server/http/team-experiment-routes.ts and tests;
src/components/team-experiment/{TeamExperimentCenter,TeamExperimentReplay}.tsx
and tests; src/styles/components/team-experiment.css;
docs/team-experiment.md; config/team-experiment.example.json;
bin/team-experiment.js. Integrations: App.tsx, AppShell.tsx, hash-router.ts,
server/server.ts, vite.cli.config.ts, package.json/package-lock.json,
README.zh-CN.md, PERF-BASELINE.md. Existing benchmark foundation is preserved
and reviewed; fix runner telemetry/acceptance separation with its real-process
test. Do not include unrelated watcher/storage drafts without necessity.
Package artifact integration may update `scripts/verify-package.mjs` for both
new CLI entry points; integration tests may update the existing shell/server tests.
Verification-driven storage repair may touch `server/storage/trace-links.ts`,
new adjacent `trace-identity-snapshot.test.ts` and the internal snapshot-digest
note in `contracts/database.md`. Preserve the existing unrelated predecessor
test draft. The capture ceiling workload, thresholds and identity/association
semantics are unchanged; eliminate redundant serialization only if controlled
phase evidence and the full workload validate it.
