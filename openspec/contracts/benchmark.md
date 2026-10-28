# Reproducible task benchmarks (2026-10-28)

User-authorized post-M12 increment. This is separate from EXP-001..004 manual
records; their declarations never become automated results. Canonical additive
DTOs live in `src/core/benchmark-types.ts`; validation in benchmark-validation.ts.
No native DTO/schema, original evidence or existing manual record changes.

## BENCH-001: experiment and execution

A version1 manifest fixes one task ID, local Git repository/ref, exact prompt,
expected test count, independent evaluator argv, timeout, 1..10 repetitions and
1..8 variants. Each variant declares product/model/environment/parameters/toolset
and driver argv. Commands are argv arrays, never shell interpolation. Execution
is explicit CLI `--execute`; default validates/prints the plan without execution.
Resolve the ref once to a commit; fresh local clones for every run, sequential
round-robin rotated variant order; retain workspace/artifacts. Never reset the
source repository. Same prompt/commit/evaluator/test count are shared. Runner
exports BENCHMARK_CONTEXT, BENCHMARK_RESULT_PATH, BENCHMARK_VERDICT_PATH and
BENCHMARK_WORKSPACE; drivers must wait for GUI completion, record actual model,
return explicit telemetry and identify native session/event references if known.
No vendor-specific GUI support is claimed by configuring an arbitrary driver.
Timeout/cancellation terminates owned process group on POSIX; external GUI
processes remain the driver's responsibility. Windows process-tree cleanup is
unverified. A timeout stops the experiment to avoid overlapping GUI work.

Evaluator runs separately after a successful driver, never parses assistant
claims. Success requires successful evaluator exit plus valid passed/total equal
to the fixed nonzero expected count. Missing verdict => unknown; process failure
or timeout => failed. Agent E2E excludes checkout and evaluator time, which are
separate phase spans. Model/tool timing and usage require driver evidence.
Driver offsets are relative to agent start; report offsets are relative to run
preparation start, preserving setup/evaluator phases without adding them to E2E.
Fixture runs are explicitly synthetic, never real Qoder/CodeArts measurements.

## BENCH-002: accounting and statistical scope

Metrics cover user-requested metadata, passed/total/success, E2E, TTFT, TPOT,
model/tool counts, average/summed duration, five usage counters/cache hit+write,
corrected total/cache-hit ratio and evaluator quality fields (LOC, vulnerabilities,
duplication, complexity, redundancy, build/static warnings/severity distribution).
Missing is null, never zero. Complete span coverage is required for call totals;
only measured spans supply model/tool latency. Sums may overlap and never equal
E2E by construction. TTFT = mean measured per-model-call first-token offset;
TPOT = summed (duration-firstToken)/(outputTokens-1) over valid measured calls.
Unknown clocks/partial samples remain unavailable; retain raw spans for inspection.
Corrected total counts cache and reasoning exactly once using explicit inclusion
flags; unknown inclusion or inconsistent subsets => null. No money estimates.

Aggregate by variant, retain sample counts, success-known denominator, median,
p95 nearest-rank, population SD and CV; CV needs >=2 values and positive mean.
Show planned vs retained repetitions; <3 is insufficient stability evidence.
Cross-model trials compare configurations, never isolate product causality.
Actual model mismatch/unknown remains a comparability warning. No global winner
or fabricated weighted score. Diagnostics are transparent rules/hypotheses with
visible thresholds, evidence span IDs, recommended action and verification step.

## BENCH-003: report and bounds

Version1 local JSON report includes manifest, resolved commit, prompt SHA256,
ISO UTC timestamps, run IDs/variant/repetition/actual model/host/status, runner
E2E, driver telemetry, evaluator verdict, phase spans and error. Validate imports
strictly: max16MiB, <=80 runs, <=2000 spans/run, <=20000 total spans, unique IDs,
valid references/finite nonnegative values/ratios/counts, UTC, bounded strings.
No untrusted HTML, file path dereference or execution from imported reports.
Persist each completed run atomically to new experiment directory; interruption
retains finished runs. Never overwrite an existing experiment directory.

## BENCH-004: UI

Primary lazy Benchmark view, local report import/export, editable manifest
template export, explicit synthetic preview, variant statistics and all metric
rows, selected-run model/tool/runner lanes, paged200 span list and selected
evidence. Relative timelines align at run preparation start, do not stack overlapping
durations. Rules select exact retained spans; original task link only when an
explicit sessionKey/eventId was supplied. No per-row reads, automatic capture,
upstream calls or HTTP shell launcher. Own bounded5s local file reads and suppress
late/unmounted results. Keyboard accessible and bilingual. Existing task reading
changes are preserved; App remains the only shell.

## File scope

New: this contract; openspec/specs/benchmark/spec.md;
src/core/benchmark-{types,validation,analysis,demo}.ts and adjacent tests;
server/benchmark/{runner,cli}.ts and tests; bin/benchmark.js;
src/components/benchmark/BenchmarkCenter.tsx and test;
src/styles/components/benchmark.css; config/benchmark.example.json;
scripts/benchmark-demo.mjs; docs/benchmark.md.
Integration only: src/App.tsx, src/components/AppShell.tsx, src/hash-router.ts,
vite.cli.config.ts, package.json, package-lock.json (root bin metadata only),
README.zh-CN.md. Additive example workflow (user clarification):
server/benchmark/demo.ts, server/http/benchmark-routes.ts and tests,
src/components/benchmark/BenchmarkSetup.tsx, server/server.ts route/guard only.

## BENCH-005: executable example workflow

User confirmed Qoder/CodeArts may be examples and default repetitions=3.
Add primary structured setup and explicit "Run example" action. Fixed built-in
addition fixture and independent3-case evaluator; requested product/model labels
are illustrative, no vendor GUI/model/API is invoked. Demo input is exactly
{name,repetitions,variants:[{product,model}]}, 1..8 variants,1..10 repetitions.
POST /api/benchmarks/demo accepts only that bounded4KiB JSON. Same existing
loopback/Host/Origin guard and ApiError envelope; no user executable/path/prompt.
One active job/server,60s total deadline, abort on disconnect/server shutdown;
no automatic retries. Returns validated synthetic BenchmarkReport, no-store.
Write artifacts only to a new UUID directory under app-owned benchmark-demos.
Each completed run remains on disk; failed/cancelled client response is uncertain
and cannot claim rollback. Browser owns65s deadline/single-flight/cancel/late
suppression. Viewing/importing/locale never executes. Form handles common fields;
advanced manifest JSON remains for real CLI driver configuration. Completed
example loads immediately into the existing comparison and evidence view.
