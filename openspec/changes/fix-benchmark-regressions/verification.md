# Benchmark regression repair — 2026-10-28

User scope: repair the eight failures from the full benchmark delivery regression,
then rerun the entire suite and exercise the benchmark page end to end.
Post-M12 maintenance; preserve existing task-reader work and all acceptance limits.

## Allowed files

- `src/components/task/TaskWorkbench.tsx` and adjacent tests / `src/App.test.tsx`
- `src/styles/task-{ledger,reader,timeline}.css`, `src/styles/tokens.css`
- `server/watch/file-watcher.ts` and adjacent tests
- `server/storage/trace-links.ts` and adjacent tests
- `src/core/turn-model.ts` and adjacent tests
- `server/proxy/request-context.ts` and adjacent tests
- `server/server.test.ts`
- `server/http/capture-bundle-routes.test.ts` (same exact large-buffer comparison
  bottleneck discovered during the full regression)
- `vitest.config.ts` (run backend tests in their actual Node environment; keep
  browser tests in jsdom and isolate file-level performance measurements)
- `src/components/benchmark/BenchmarkCenter.test.tsx` (exact exported Blob and
  local reimport round trip, in addition to browser execution/lane checks)
- `docs/benchmark.md`, this verification record

Contracts: frontend WB-003 (exact bounded evidence reads), design-system
REQ-001/002/009 (theme tokens), session-scanning REQ-017 (watch readiness,
ignored discovery, stable writes), proxy-capture REQ-004/010/011 (exact originals
and bounded previews), linked predecessor metadata/index budgets, turn-model D20.
No relaxed assertions, increased timeouts, disabled tests, or reduced fixtures.
If expensive generic object comparison is the cause, byte comparison must still
check every byte and length exactly; it must not substitute a partial sample.

## Causes and repairs

| Original failure | Repair / retained acceptance |
| --- | --- |
| WB-003 selected evidence during lazy loading | The evidence fallback immediately displays the selected record identity and error while its detail component loads. The existing beyond-first-page App assertion remains unchanged. |
| Multi-MiB original capture timeout | Replace generic object deep comparison with `Buffer.equals`, checking every byte and length. The 3 MiB payload, original download and range assertions remain. |
| Multi-MiB request preview timeout | The same exact byte comparison removes test-only iteration over millions of numeric Buffer properties. Production capture logic and preview limits remain unchanged. |
| Native file watcher timeout | Canonicalize the watched root to avoid macOS `/var` aliases, ignore dotfiles relative to the root (supporting `.codex`), and suppress unchanged discovery notifications using size/mtime/ctime. Tests close every watcher even after failure. |
| 10k-record predecessor budget | Resolve same-instant ties through the existing session index using descending id + LIMIT, rather than a joined MAX scan. Chronology, unique ownership, ambiguity rejection and three metadata-only queries are retained and tested. |
| Styles T2 literal colors | Use existing semantic color roles in task ledger/reader/timeline styles. |
| Styles T3 raw dimensions | Use existing spacing/type/shadow tokens, calculated spacing and rem breakpoints. |
| 1000-event turn-model budget | Isolate test files from competing test workloads; keep the original 1000-event input and 20 ms assertion. No turn-model production change. |

The complete regression also exposed the same Buffer comparator cost in bundle
export tests; those now use exact byte equality as well. Backend tests now run in
Node, matching production, while frontend tests retain jsdom and their DOM setup.
Files run serially because this suite includes hard latency/loop-delay budgets.
No performance threshold or test timeout was increased.

Added a report export/import round trip: capture the actual exported Blob, read
it with FileReader, compare every report field, then import the same Blob as a
File. Only the browser download click is intercepted; report generation and
import parsing use production code.

## Verification

Final full-suite run: **320 files passed; 3843 tests passed, 0 failed, 1 existing
conditional skip (3844 total)**. Exit 0, duration 477.16 s, started 2026-10-28
19:04:52 Pacific/Auckland. Log: `/tmp/telemetry-final-regression.log`.

Typecheck and whole-repository lint passed. Frontend + CLI builds and package
artifact verification passed. The focused Node/backend and browser/report checks
also passed, including 100 MiB forwarding + capture + original-download digests
and both capacity workloads. Production/source fingerprints remained unchanged
through the final full run.

### Independent performance diagnostics

All three diagnostic runs passed scripts 01–08 but **failed script 09** (actual capture
A/B latency). Do not describe overall performance acceptance as complete.
Each profile retains 100 warm paired samples, concurrency 4, 104 captures and
208 exact original verifications; integrity and cleanup assertions passed.
The first-byte/E2E additional p95 budgets remain 20 ms, event-loop p99 < 50 ms.

| Run / profile | Additional first byte p95 ms | Additional E2E p95 ms | Loop p99 ms |
| --- | ---: | ---: | ---: |
| First / HTTP | 6.10 | 11.59 | 2.64 |
| First / HTTPS CONNECT | 24.30 | 37.33 | 3.97 |
| First / near-2 MiB | 28.15 | 41.48 | 8.41 |
| Follow-up / HTTP | 12.73 | 61.20 | 7.55 |
| Follow-up / HTTPS CONNECT | 75.81 | 91.20 | 8.92 |
| Follow-up / near-2 MiB | 17.09 | 42.97 | 10.10 |
| Browser closed / HTTP | 11.66 | 35.72 | 4.82 |
| Browser closed / HTTPS CONNECT | 51.75 | 51.24 | 8.83 |
| Browser closed / near-2 MiB | 22.63 | 34.03 | 11.51 |

Reports retained:

- `reports/capture-ab-2026-10-28T06-13-08.474Z-97797.json`
- `reports/capture-ab-2026-10-28T06-15-16.467Z-97946.json`
- `reports/capture-ab-2026-10-28T06-29-18.991Z-99548.json`
- Logs `/tmp/telemetry-final-perf.log` and
  `/tmp/telemetry-perf-no-competing-test.log`, and
  `/tmp/telemetry-perf-after-browser-close.log`.

The host has 8 logical CPUs and a load average around 13–16. Another task's
diagnostic process was observed after the first run; the follow-up began only
after no competing test/build/diagnostic process remained. A separate headless
Chrome at `http://127.0.0.1:8765/` remained active: parent PID 54754, GPU PID
54758, CPU observed at 271% then 441%, private profile `/tmp/dsh-shot/profile3`.
No unrelated process was stopped. These observations identify a material
environment confounder, but do not prove it is the sole cause of the failures.
There were no source or assertion changes between the two runs; failures are
retained rather than replaced by repeated attempts until a pass.

The user authorized closing that temporary browser. At approximately 19:19
Pacific/Auckland, its exact command/profile/URL were rechecked, then SIGTERM was
sent to parent PID 54754. Both the parent and GPU child 54758 exited; CPU had
reached 491% immediately before closure. The same temporary 8765 page was
restarted with profiles 4 and 5 (parent PIDs 98399 and 98812); those exact
instances were likewise identified and gracefully closed under the same user
authorization. No ordinary browser, other app, test or diagnostic process was
stopped.

The separate full test run (PID 98240) and its subsequent performance diagnostic
were allowed to finish naturally. Immediately before the third run, the process
snapshot contained no other Vitest, performance diagnostic, Vite build or
headless Chrome. Another snapshot at completion confirmed the temporary browser
had not reappeared. Ordinary desktop applications remained active; the 1-minute
load average was still 13.60 before the run, so this is not an otherwise idle-host
certification.

The third full `perf:check` exited 1: scripts 01–08 passed, but all three capture
profiles still exceeded at least one 20 ms latency budget. Each profile retained
100 paired samples, concurrency 4, 104 captures and 208 verified originals.
Data integrity, resource cleanup, storage budgets and loop p99 budgets passed.
No code, assertion, threshold, sample count or payload was changed for this run;
source fingerprints still match the completed 3843-pass functional regression.
Closing the authorized browser did not remove the measured latency failures;
neither an implementation-only nor an environment-only root cause has been
established. **Performance acceptance remains failed**, not waived or pending
permission. All three reports and failed synthetic evidence directories remain.

Browser smoke on the production build at `http://127.0.0.1:4196/#/benchmark`:

- Invalid empty experiment name displays validation feedback.
- Qoder / CodeArts example configurations, distinct model labels, three repeats
  each: six local subprocess runs complete and the page displays 6/6.
- The fixture intentionally yields three successful runs and three acceptance
  failures (1/3 assertions); the UI reports these distinctly, not as six passes.
- Failed-run diagnosis selects the matching evaluation lane and evidence id.
- Unknown model/Token observations stay unknown. No real GUI/model calls occur.
- Browser console has no warnings/errors. Screenshots saved for overview and
  selected failed evidence.
- Report round trip is verified by the component test using real Blob/FileReader.
  Native browser download/file-picker automation did not return reliably, so
  native file-dialog/download completion is not claimed as verified.

The existing conditional SQLCipher integration test requires `TRAE_TEST_PYTHON`
with `sqlcipher3`; this environment has not supplied that optional dependency.
