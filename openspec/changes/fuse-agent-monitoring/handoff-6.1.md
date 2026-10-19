# Fusion implementation handoff

## Publication target — 2026-10-16

Latest user instruction: create the remote codex/telemetryref-fusion branch and
push the present development snapshot. Do not merge into main, restart the old
service or advance new functionality. This overrides older no-commit/push
notes for this snapshot only. NFR§6.1 records the historical relative-latency
alerts without changing hard budgets; the English commit must retain them.
The one normal pre-commit rerun passes the hard and adjacent-row20% gates;
no performance waiver is invoked.193files/2174pass/1skip(123.89s), all
sequential checks passed; raw report02-57-09.382Z-17568 remains local.
Product scope stays30/71 and incomplete. Source/tests/specs are published;
local reports, node_modules, builds, live data/config/CA remain local. See
publish.md for the selection and verification record.

## Current snapshot: existing partial tasks closed — 2026-10-16

The follow-up user instruction explicitly allowed finishing already-started
tasks. Closed3.2/3.3/9.2; current schema17/OpenSpec30/71,41 remain. Original
downloads now support bounded single-byte-range streaming, strong ETag/If-Range,
206/416 unified errors and full-prefix integrity labels. Metadata/lazy analysis
reads have independent5s cancellation and explicit bilingual retry; no model
request replay. Exact protocol/native usage acceptance is verified. See
partial-task-closure.md for the audit; do not restart unimplemented subsystems.

Final sequential typecheck/build→193files2174passed/1existing skip(123.10s)
→lint/perf:check/strict validation/diff-check passed, exit0.28 added cases plus
expanded existing download assertions; no new capacity-boundary tests/schema/
dependency. Frontend685.26/194.20kB gzip, CLI704.15/191.31; existing500kB
warning retained. Actual A/B02-44-26.804Z-15226 all3 hard budgets pass; raw
historical samples/relative>20% alerts remain documented in PERF-BASELINE,
not a no-regression certificate or waiver of the NFR commit gate. No commit/push.
No long-running fusion service was started. Hand back for user testing now;
database separation/storage boundary tests and new capabilities remain paused.

## Historical manual-test pause and verification

The user requests closeout of the existing implementation and will test it
personally. Do not start new features, split databases or add storage-boundary
tests. Preserve existing single-DB behavior and tests. Follow manual-test.md
for the current capability summary, isolated launch and expected limitations.
OpenSpec remains27/71, not a finished release. Resume only after the user asks;
older "continue D11/full-chain" instructions below are historical and superseded.
The already-running4173 service belongs to the main checkout/schema10, not
this fusion branch; do not stop it, upgrade its DB or present it as the new build.

Closeout rerun passed typecheck/build,192files/2146tests/1existing skip,
lint/perf:check/strict validation/diff-check (exit0,120.86s test duration).
Existing capture A/B report02-25-55.717Z-12660 passes all3 hard profiles;
no new feature/test/dependency, global/native change or commit/push. Built
artifacts are current; manual-test.md provides the separate4183/7789 launch.
Historical baseline/evidence below remains intact, not a pending action list.

Current verified snapshot: schema17/OpenSpec27/71; complete sequential
typecheck/build→192files2146passed/1skip→lint/perf/strict validation/diff-check
exit0. Final3-profile400-pair ABBA report02-03-58.002Z-7338 and12 immutable
checkpoints pass all12 hard/all3 relative gates:4848 captures/9696 exact originals/
4848 metadata SSE, resources0 after each run. Final docs/diagnostic-only
lint/strict/diff-check also exit0; main45 edits untouched, no commit/push.
Full7.3/goal NOT complete: next implement D11 storage ownership separation and
cross-store crash consistency; shared future/native growth, physical ENOSPC,
full-chain/real Agent/Windows/30-minute acceptance remain open. Lower snapshots
are chronological evidence, not a replacement current state.

Latest shared-writer snapshot batch supersedes the historical large-index
snapshot below. Real Node async_hooks at actual lstat completion reproduce
same/second SQLite connection native commits invalidating the file-size result;
old implementation admitted them. Current guard revalidates cached
total_changes/schema cookie/data_version, max3 TOTAL snapshots/max1 checkpoint,
no async-held transaction, exact busy-timeout restore and static failures.
Native1MiB raw/4 events/6 identities/session/metrics preserved; no scan cap or
cleanup, public field/route/schema/dependency change. Schema cookie is not
app _meta.schema_version17.14 regressions include pre/post-checkpoint, second
connection, churn, caller transactions, rollback, DDL and timeout137→271.

The initial fs/promises mock did not intercept calls and3 cases timed out;
not defect evidence. Actual async-hook observer self-test passes, then5 genuine
baseline failures prove stale admission. Only3 verified generated timeout
directories removed after their process ended; no user data. Same-connection
CREATE INDEX separately failed to invalidate total_changes-only stamping; schema
cookie now included. No assertion or watermark relaxed.

Before final safe allocation optimization, whole gate192files2138pass/1skip,
build/typecheck/lint/perf/strict validation/diff-check exit0. Actual A/B01-28-
31.427Z-4798 passes all3 hard profiles; frontend684.27/193.88gzip unchanged,
CLI702.11/190.68, existing500kB warning. Historical drift01-25-43.364Z-4139
near2MiB E2E9.824ms triggered diagnostic11. First ABBA01-29-44.065Z-4929
fails near2MiB relative E2E1.375619 despite all8 hard passes. Builtin CPU
profile12 verifies avoidable Statement/pragma/GC; current20k-action memory
microbenchmark349.668→236.364ms (17.483→11.818us/action), not network proof.
Keep fresh PRAGMA setters (effects happen at prepare), cached dynamic timeout
getter and scalar setter results; no naive cached-setter bug. Focused21 tests/
typecheck/lint pass. Optimized100-pair ABBA01-42-23.221Z-5397 near2MiB passes,
HTTPS first-byte1.229202 still fails1.2. All failures retained; fixed400-pair
ABBA and final current-source full gate recorded when complete, no cherry-pick.

Full7.3/goal still active; D11 defines next-tier native index/detail/capture
separation gates: explicit global budget, evidence boundary, crash-safe outbox,
no false cross-WAL atomicity, paged/batched reads and no silent user migration
or implicit cleanup. Current guard does not bound arbitrary later external or
native growth, physical ENOSPC, real Agent, Windows or30-minute soak. Main45
edits untouched; no paid/native/global/commit/push. Skills openspec-apply-change
and performance-profiler used; no extra dependencies or production bypass.

Historical v17 large-index batch follows.

Snapshot-batch verification continuation:400-pair plan first hit a real
fixture-owned SSE teardown race at4th HTTPS reference; retained audit404 rows/
808 originals/quick_checkok. Corrected explicit owned lease release, not global
broadcaster cleanup/zero-assertion relaxation. Failure cause now retains actual
cleanup/report; diagnostic11 checkpoints each raw run. Added7 A/B cases
(5 decimal budget boundaries, consecutive cleanup and real unrelated-subscriber
failure context); focused34 pass. Unknown file sizes fail via production helper,
and hard DB/WAL checks use decimal200MB/20MB, not old MiB allowance.

Fixed400-pair plan after this ownership fix completed all8 runs, report
capacity-snapshot-ab-2026-10-16T01-56-57.267Z-5946.json +8 immutable checkpoints.
Each400 pairs/concurrency4/808 origin calls/404 captures/808 exact originals/
404 SSE, cleanupverifiedtrue/removedtrue/resources0. HTTPS first-byte/E2E/loop
mean-run ratios1.019709/1.045618/1.070654; near2MiB1.023085/1.016169/1.000940,
all hard/relative gates pass. Not pooled percentiles/statistical/full-app proof;
do not delete earlier100-pair failures or relabel the interrupted400 plan a
completed test. Final full current-source gate: typecheck/build→192files2146
passed/1skip (119.41s)→lint/perf/strict OpenSpec/diff-check all exit0.
Production A/B02-02-04.663Z-7151 HTTP/HTTPS/near2MiB E2E6.768/9.440/6.701ms,
loop2.836/3.078/2.179ms, all3 qualified/pass exact hard budgets. CLI702.24/
190.73kB gzip, frontend unchanged. StandardHTTP first-byte5.453 vs2.774ms
historical alert remains, so diagnostic11 adds the missing standardHTTP profile
and one fixed12-run400-pair attribution plan. No source correctness rollback,
threshold relaxation or selective deletion of this new actual result.

Final attribution: reports/capacity-snapshot-ab-2026-10-16T02-03-58.002Z-7338.json
+12 immutable checkpoints. HTTP/HTTPS/near2MiB each4 ABBA runs/400pairs/
concurrency4, all12 hard and all3 relative gates pass; actual cleanup/resource0.
Mean-run first-byte/E2E/loop ratios: HTTP1.077895/0.925116/1.061767;
HTTPS1.031058/1.041186/1.097218; near2MiB0.881436/0.910181/0.991469.
Controlled source-attribution does not reproduce the historical >20% first-byte
jump, but does not erase it or prove statistical/full-app/soak equivalence.
Current production/test code remains the2146-pass full-gate version; final
lint/strict/diff-check rerun after diagnostic coverage/docs only. No commit/push.
Continue D11 storage separation/crash consistency and real Agent/full-chain
acceptance; do not mark7.3 or full fusion complete.

Latest v17 large-transaction pressure batch supersedes the historical v16
snapshots below. The original strict real-proxy/worker fixture failed with
1900 scoped tool identities/32 candidates: WAL30,224,352B, loop p99=54.460415ms
(reports/capture-capacity-worst-1792112112019-243.json). Full parsing was ok,
so accepting parser/result-limit fallback or cutting identity data is not a fix.

Current schema17 atomically replaces the wide native index with the same-name
partial session/scope NULL index; every row/value/scope/locator and source-page
index remains. v16 rollback/retry and repeated-v17 index rootpage are tested.
New strict small-DB EXPLAIN regression genuinely failed with SCAN i USING INDEX;
key-driven json_each CROSS JOIN/INDEXED BY now requires native SEARCH after
ANALYZE without relaxing that assertion. Native matching semantics unchanged.
WAL admission is now8,000,000B (was12,000,000), combined180,000,000B and hard
20,000,000/200,000,000B unchanged. No user DB upgrade/file deletion/rescan,
new dependency or weakened parser/output limits.

Strengthened localhost fixtures preserve exact original bytes+SHA,32 native
scan rows/32 candidates, normal parsing, complete=1/omitted_count=0 and one
origin call each. Near-admission pinned WAL before=7,704,432B, DB=716,800B:
- 1900 tools/1902 identities,1,916,503 request bytes, scope1024: finalWAL
  17,093,912B (delta9,389,480); p99=41.451519ms/46 samples in report
  capture-capacity-worst-1792112881555-1690.json.
- 2046 tools/2048 identities,1,853,815 request bytes, scope900: finalWAL
  17,806,672B (delta10,102,240); p99=29.212671ms/39 samples in report
  capture-capacity-worst-1792112883437-1690.json.
These reports are reproducible cases, not a maximum proof for all payloads,
shared writers, physical ENOSPC, Windows, real Agent or30-minute soak.

Focused6 files/69 passed; full production gate typecheck/build→191 files/2125
passed/1 skipped→lint/perf/strict OpenSpec/diff-check all exit0. Stronger
identity-total/completeness assertions then passed both targeted cases (other4
tests filtered, not new product skips); final sequential typecheck→whole191file/
2125pass/1skip suite→lint/strict OpenSpec/diff-check also exit0 (123.97s).
Repeat reports1792113024262-2050/1792113025952-2050 retain identical WAL/identity
totals with loop31.621119/25.722879ms and44/43 samples. Actual production A/B report
capture-ab-2026-10-16T01-08-31.893Z-1876.json: HTTP/HTTPS/near2MiB extra E2E
p95=6.725/11.084/6.275ms, loop p99=2.998/3.893/2.175ms, all3 qualified/pass.
Frontend684.27/193.88kB gzip unchanged; CLI701.04/190.39, worker9.38/2.91,
shared22.92/6.71; existing500kB warning retained. OpenSpec27/71 and full7.3/goal
remain incomplete. Main45 edits untouched; no paid/native/global/commit/push.
Skills openspec-apply-change and performance-profiler drove contract mapping,
real failure measurement and bounded regression; no CPU-profile claim.

Historical capacity-Web snapshot follows.

Current final sequential gate all exit0: typecheck/build→191 files/2120 passed/
1 skipped→lint/perf/strict OpenSpec/diff-check. Fresh actual A/B report:
reports/capture-ab-2026-10-16T00-46-58.544Z-99653.json; HTTP/HTTPS/near2MiB extra
E2E p95=7.418/11.345/4.710ms, loop p99=2.902/3.766/2.130ms, all3 qualified/
passed unchanged budgets. Frontend684.27/193.88kB gzip/lazy capacity6.93/2.28;
CLI700.62/190.27. Existing500kB warning retained, main45 edits untouched.
No full-app/physical ENOSPC/real Agent/Windows/soak claim; full7.3/goal active.

Latest capacity Web batch supersedes historical snapshots below. Lazy drawer
consumes existing typed /proxy/capacity +/proxy/storage once each on open/manual
refresh only;0 while closed/SSE-only. Original quota/remaining/pending/active/
limits separate from DB/WAL admission/hard budgets/server UTC time, not physical
free disk or Agent/capture success. Independent errors/unknown (never0),5s abort,
generation-based late/unmount rejection, explicit refresh, local stale signals.
Original-status reads may resume PREVIOUSLY confirmed pending deletion, disclosed
in UI; no new intent/delete/checkpoint/launch action. No backend/schema/dependency
change; stable close callback keeps focus on runtime updates.

New19 tests: panel13/detail integration2/keyboard3/i18n1; focused54/typecheck/lint/
build green. Actual browser found global Enter swallowed native refresh/open;
3 real failing regressions preceded fix honoring handled keys/overlay ownership/
native Enter-Space. Outside-overlay list shortcuts/Esc/IME remain. Native browser
retest after rebuild/reload proves Enter open/refresh, refresh focus return,
Tab cycle, Esc toolbar-focus restore and bilingual semantics. No assertion cuts.

Production SPA/API fixture used disabled9 providers,415B synthetic originals,
quota415 and real pinned-reader WAL12,224,072B. UI shows independent exhausted/
limited, then reader relief/manual refresh shows metadata ready but original
quota still exhausted. Counts0 closed→1 each open/unchanged on external relief→
6 each final, exactly opens/refreshes across deliberate reloads, no polling.
Tab closed; owned fixture SIGINT/exit0/quick_check=ok/syntheticDataRemoved=true;
validated temp build removed. No user data/native/global/paid/commit/push.
Initial JS684.27/193.88kB gzip; lazy capacity6.93/2.28. Existing500kB warning.
No Lighthouse/p75 CWV/full-a11y certification. Skills openspec-apply-change,
senior-frontend (async ownership/unknown evidence/keyboard focus).
Schema16/OpenSpec27/71 unchanged;7.3/goal remain incomplete for shared writers,
worst transaction/tombstone growth/physical ENOSPC/long-term split/full request
management and later full-chain/real Agent gates.

Historical pressure-core snapshot follows.

Current full production gate all exit0: typecheck/build→190 files/2101 passed/
1 skipped→lint/perf/strict OpenSpec/diff-check. Frontend676.68/191.40kB gzip,
CLI700.62/190.27; existing500kB warning. Main45 tracked edits untouched.
Production A/B00-22-53.145Z-97494 all hard budgets passed but HTTPS E2E+21.8%
vs historical snapshot triggered investigation; isolated repeat00-23-36.354Z-
97555 retained too. Do not discard either result. Diagnostic10 ABBA report:
reports/capture-capacity-ab-2026-10-16T00-26-02.579Z-97637.json. Temporary
counterfactual omits exactly2 journal admission sites, no production bypass flag.
Mean-of-two-run p95/p99 production/reference ratios first-byte1.04815/E2E1.03176/
loop1.15846, all<=1.2; all4 real trusted-HTTPS hard gates passed. Raw samples and
hashes retained, temporary builds removed. This is not pooled percentiles, whole
old-build comparison or statistical/full-app/soak certification. Profiling skill
guided measurement instead of speculative optimization; no dependencies added.

Latest pressure batch supersedes the acceptance snapshots below. Added bounded
shared per-DB capture admission and independent read-only /api/proxy/capacity
typed CaptureMetadataCapacity.180,000,000 combined/12,000,000 WAL byte admission
watermarks, one non-waiting checkpoint at8,000,000 WAL; hard200MB/20MB unchanged.
No scan deletion/page-cap/schema/dependency change. New journal admission/final
commit/recovery insertion refuse pressure; existing journal updates survive.
Capacity diagnostics do not checkpoint/recover. File-store-only committed reads/
explicit cleanup remain reachable if startup recovery is pressure-blocked;
start/restart retries deferred journals after relief. Other recovery corruption
still blocks. Native SQLITE_FULL and pressure report static lastError, not saved.

Checkpoint test genuinely failed at5404.926ms; busy_timeout=0 for checkpoint only,
exact restore/no retry fixes it without relaxing<50ms. New14 cases: module7,
production API4, checkpoint2, type1. Focused95/typecheck/lint green. Real SQLite
WAL pin/relief, metadata pressure,64 queue cap, actual forwarding and cleanup
under pressure, native SQLITE_FULL rollback→real proxy journal/full originals→
restart1 row/no replay are covered. SQLite page limit is test-only, NOT physical
disk-full certification. No actual Agent calls/native/global settings/user data.

Full7.3 stays open: worst-transaction reserve, unrelated shared writers, tombstone
growth, physical ENOSPC, capacity Web display, global request management and
long-term NFR §7 separation. No automatic expiry may override higher-priority
approved no-implicit-original-deletion policy. Schema16/OpenSpec27/71/goal active.

Historical Web snapshot follows.

Current full sequential acceptance: typecheck/build→188 files/2087 passed/
1 skipped→lint/perf/strict OpenSpec/diff-check all exit0. Fresh report:
reports/capture-ab-2026-10-16T00-09-16.413Z-95890.json; extra E2E p95 HTTP/
HTTPS/near2MiB=6.342/10.214/5.990ms, loop p99=2.302/2.134/2.130ms,
all3 qualified/passed unchanged budgets. Main45 tracked edits remain untouched.

Latest Web batch supersedes the backend-only snapshot below. Selected-request
Body retention control now reads one metadata status, offers bilingual exact-ID/
scope acknowledgement and known-stopped monitor prerequisite, explicit refresh/
confirmed retry. No polling/N+1/body read on mount.5s status/15s POST wait timeout
is unconfirmed, not successful deletion. Submission/intent latches blocked IDs,
strips body/raw/prompt copies, invalidates late analysis/detail, unmounts cached
diff and masks reopened stale detail; headers/timing/links/native sessions remain.
New7 control+2 detail regression tests; focused31/typecheck/lint green.

Production SPA browser proof on generated415B synthetic originals verified zh/en,
scope/exact ID, unchecked disabled/checked enabled submit, Escape/focus and cancel.
No irreversible browser submission; post-submit behavior is component/API tested,
not browser-certified. No actual Agent/network capture or Lighthouse certification.
Existing narrow layout needed no CSS. Owned fixture closed via SIGINT/exit0,
quick_check=ok, generated data and validated temp build removed; tab closed.
Initial JS676.68/191.40kB gzip; existing500kB warning remains. Skills used:
openspec-apply-change, senior-frontend (async cleanup/semantic keyboard flow).
Schema16/OpenSpec27/71 unchanged;7.3 and goal NOT complete. Next: capacity/WAL/
marker/disk-fault gates and full request management, then remaining fusion gates.
No user originals/dependencies/native/global/paid calls/commit/push changes.

Historical backend-only acceptance follows.

Latest acceptance: sequential typecheck/build→187 files/2078 passed/1 skipped→
lint/perf/strict OpenSpec/diff-check all passed. A/B report:
reports/capture-ab-2026-10-15T23-28-04.820Z-93591.json; HTTP/HTTPS/near2MiB
extra E2E p95=7.260/11.250/6.106ms, loop p99=2.322/2.159/2.109ms, all qualified/
passed unchanged budgets. CLI696.72/189.93kB gzip; frontend existing500kB warning
unchanged. Main45 tracked edits untouched, no dependencies/user originals/commit/
push/native/global/paid Agent changes. No UI/browser certification in this batch.

Latest batch: confirmed per-request BODY deletion BACKEND, schema16 unchanged,
OpenSpec27/71/full7.3 incomplete. GET/POST /api/proxy/requests/:id/original-deletion
now expose typed job/null and exact-ID+confirm:true action/retry. Requires stopped
monitor; synchronous maintenance lease excludes start/launch/concurrent deletes.
Intent+marker+proxy body/raw/prompt clearing is one transaction. Headers/metrics/
request/association/native data remain, not full/header/forensic erasure.
Intent blocks downloads/analysis/diff even on failed cleanup/file reappearance;
fresh detail masks body/prompt, late analysis/diff results cannot revive content.
Refs retain historical capture status/digest; job records current unavailability.
Pending startup resume precedes journal/capture admission; failures stay explicit,
active handlers/startup retain shutdown ownership. Global Clear/Web UI not wired.

New9 tests: API7 incl actual real proxy→store/worker→stop→confirmed deletion→
restart with1 synthetic origin call/no replay; strict confirmation/Host policy,
permissions failure/retry, state-write failure, atomic copy-clear rollback,
no-journal pending startup, reappearance blocked. Runtime1 exclusion/release,
diff1 already-read-source race using actual files/normalizer with controlled
async admission gate. Focused50 tests +typecheck/lint passed. No new SIGKILL or
Windows/full-capacity certification. Only generated temporary raw data removed.
Next Web confirm/status +cache/in-flight invalidation, then remaining7.3 capacity/
WAL/marker/disk/global management and later fusion gates; do not claim parity.

Older queue-core snapshot follows.

Latest acceptance: sequential typecheck/build→186 files/2069 passed/1 skipped→
lint/perf/strict OpenSpec/diff-check all passed. Current-build A/B report:
reports/capture-ab-2026-10-15T23-12-22.985Z-92307.json; HTTP/HTTPS/near2MiB
extra E2E p95=6.576/11.830/5.068ms, loop p99=2.359/2.286/2.142ms; all qualified/
passed unchanged budgets. Existing frontend500kB warning unchanged. Main45
tracked edits untouched; no user originals/dependencies/commit/push/Agent calls.

Latest batch: durable original-deletion QUEUE CORE, schema16, OpenSpec27/71.
Full7.3 is still incomplete. New original-deletions.ts/test plus type projection,
additive job table and3 indexes; intent+exact tombstone share one transaction.
Snapshot normalized refs/store directory; reject shared originals before admission
and before IO, verify digests, max1024 retained jobs/no eviction, one active task
per shared DB owner. Resume pending after reopening; failed requires explicit run;
completion only after file cleanup/status commit. Post-unlink state-write failure
keeps durable pending intent, so retry can complete with already absent files.
No graph/scan/team/request deletion or preview clearing in this core.

Queue12 cases +type1 cover real SQLite locks/rollback, migration/EXPLAIN, invalid
refs/shared ownership/changed directory or bytes, restartable intent/status-write
failure, marker suppression of a controlled surviving same-owner journal, shared
task ownership and1024 metadata-intent capacity incl failed/complete retention.
The initial OR plan really scanned the analyzed body table; source now uses two
INDEXED BY UNION ALL arms, not weakened assertions. Close/reopen/trigger fixtures
are NOT new SIGKILL or full-disk certification. Only generated temporary original
files are deleted; no current user cleanup. See implementation for acceptance.

NOT wired to startup/HTTP/Web yet. Job complete means original FILES only, NOT
full request erasure; do not expose it as such. Next implement stopped-monitor/
start serialization, preview+derived-copy clearing, explicit Web confirmation,
typed API/status/retry and owned startup/shutdown resume with actual child tests.
Keep full7.3 capacity/WAL/marker/disk faults and the later fusion gates open.

Historical file-layer snapshot follows.

Latest sub-batch: explicit original-removal FILE LAYER only; OpenSpec27/71,
full7.3 still incomplete. `body-store.ts` now has bounded async max2-ID removal,
all-path preflight, reader/writer/recovery/maintenance exclusion and streaming
post-success/partial-failure quota reconciliation. Startup inventory is streamed
too. No public route or production call site invokes removal yet; retention
still never deletes originals. Future coordinator must persist confirmed intent,
keep monitor stopped/serialize starts, resume partial cleanup after restart and
provide HTTP/Web confirmation before exposing this primitive. Do not wire the
old global Clear button straight to raw filesystem deletion.

Six new cases: explicit IDs/quota/restart/idempotence; traversal/symlink/directory
preflight; read/write/recovery/concurrent admission; real directory permission
failure; real macOS immutable-second-file partial unlink;500-file yielding
inventory. Only newly created isolated fixtures are removed, immutable flags
cleared before cleanup. Surviving bytes remain charged/readable after partial
failure/restart. Focused body-store25 and shared40 proxy/journal/TLS cases plus
typecheck/lint passed. Platform-conditional fault tests are not Windows proof.
See implementation.md for current acceptance and the remaining full7.3 gates.

Final sequential typecheck/build/185 files (2056 passed/1 skipped)/lint/perf/
strict OpenSpec/diff-check passed. All6 new cases executed on current macOS;
no newly added tests skipped here. Actual A/B report:
reports/capture-ab-2026-10-15T22-58-49.714Z-90867.json; HTTP/HTTPS/near2MiB
extra E2E p95=6.530/10.855/5.866ms, loop p99=2.429/2.281/2.152ms, all qualified/
passed unchanged limits. Main45 tracked edits untouched. No public removal
integration, schema/dependency change, commit/push or actual Agent call yet.

Older current-TTL admission snapshot follows.

Latest current-TTL admission sub-batch supersedes the older snapshots below;
OpenSpec remains27/71 and full7.3 is NOT complete. Server recovery now receives
the same explicit CLI retention policy. Before original IO, uncommitted expired
same-owner journal identity is atomically marked only if no committed request
with that request ID exists. This is expiry NOW under current policy, not an
inference that an old timestamp meant previously deleted. Default0 and exact
UTC boundaries still preserve evidence; originals remain untouched/charged.
No bulk HTTP DELETE, graph materialization, new schema/dependency or Agent call.

New5 regressions (journal4 +actual child1) cover current cutoff/offset/equality,
conflicting original suffixes untouched/quota retained, trigger rollback and
committed-ID conflicts, real persistent SQLite lock bounded<250ms with timeout
restored,500 yielding expirations under a pinned WAL reader (nonzero loop
samples, p99<50ms, WAL<20MB, DB+WAL<200MB), and real stream→SIGKILL→fixture
timestamp aging→CLI retention→HTTP recovery→restart with retention0. In that
child case health200, no saved status, no upstream replay, exact .part bytes
and quota survive, both closes quick_check=ok. The500 fixture is not maximum
journal/ID capacity, indefinite marker growth or sustained-load certification.
Full capacity/WAL/disk-fault/manual-original-deletion gates remain required.
Focused typecheck plus29 tests passed before the full acceptance run.

Final sequential typecheck/build/185 files (2050 passed/1 skipped)/lint/perf/
strict OpenSpec/diff-check passed. A/B report:
reports/capture-ab-2026-10-15T22-51-02.011Z-89705.json; HTTP/HTTPS/near2MiB
extra E2E p95=6.501/8.634/4.592ms, loop p99=2.318/2.212/2.122ms, all qualified/
passed unchanged budgets. Existing frontend500kB warning persists. Main45
tracked edits untouched, no dependencies/commit/push/global changes/Agent calls.

Historical completed committed-identity sub-batch follows (its pending
post-recovery TTL design is superseded by the pre-insertion admission above).

Latest safety sub-batch (first7.3 gate, NOT full task completion): OpenSpec27/71.
Schema15 adds exact request+both-original tombstones (no FK back to deleted
rows) and UTC expiry index; preserve v14 evidence/scan/native data. Explicit
startup retention inserts markers and deletes in one transaction; recovery
suppresses only same-owner exact matches before body IO. Originals remain
unchanged/quota-charged; later retention0/longer policy cannot resurrect that
deleted observation. An old timestamp or request-id-only match never suffices.
The discarded draft global time floor is NOT final behavior. Marker growth/
capacity and bounded post-recovery current-TTL application remain7.3 work.
Do not put the synchronous legacy bulk purge on HTTP handling paths.

Final sequential typecheck/build→185 files/2045 passed/1 skipped→lint/perf/
strict OpenSpec/diff passed. New9 cases include actual CLI self-check→HTTP
recovery across2 restarts with1 real capture/origin call, injected valid stale
journal and fixture aging; no replay, resurrection or original deletion, URLs404,
quota unchanged, both server closes exit0/quick_check=ok. This is explicit
fault-layout injection, not spontaneous journal recreation. UTC boundary test
was red before repair; UTC index also failed the old predecessor plan assertion.
Fixed association-index-driven CROSS JOIN/PK lookup; retained3 metadata reads,
reverse index, no body/sort and10000-capture<20ms assertion, not loosened tests.
Final A/B reports/capture-ab-2026-10-15T22-39-00.481Z-88526.json has all3 pass:
extra E2E p95=4.738/11.204/4.646ms, loop p99=2.370/2.707/2.150ms. Build CLI
679.79/185.60kB gzip; existing frontend500kB warning unchanged. Main45 tracked
edits untouched; no dependencies, commit/push/global/native changes/Agent calls.
No UI changes or new browser proof for this backend sub-batch. Next finish7.3
capacity/WAL/disk-fault and confirmed manual cleanup, then remaining B6 and
native/metrics/Web/actual Agent gates. Do not archive/claim parity or goal done.

Latest persistence batch supersedes older snapshots: OpenSpec27/71; B6 task7.2
complete. Read implementation.md's Durable crash journal section. Configured
capture durably journals same-DB request/file identity before opening originals,
without waiting in forwarding callbacks; atomic bounded header/end/terminal/ref
updates coalesce per request. Journal64 jobs/256KiB records/4MiB pending/16MiB
retained metadata, no original eviction. Schema14 unchanged; _meta DB-owner UUID
and internal CaptureJournalEntry contract added. Same-DB recovery streams and
verifies exact original prefixes, preserves unknown clocks/usage and durable
actual terminal states, marks process loss/closed parsing independently and
never parses/replays upstream. Both original IDs, not request-id alone, authorize
idempotent cleanup. Only journal/scratch metadata is removed after commit;
original files remain. Missing/modified/conflicting/foreign evidence is explicit
and retained. SQLite final writes retry only transient locks,3 nonblocking
attempts/10+40ms backoff, restoring the previous busy_timeout; failures send no
saved event. Startup capture queries/start share recovery; health/scan/static
remain independent, shutdown awaits it. Corrupt recovery returns unified503,
successful recovery emits one metadata-only status correction for early clients.

New10 journal +3 body-store +3 actual child-process cases pass. Real SIGKILL
during stream and after a rejected final DB insert each make1 origin request,
then recover1 row/2 exact HTTP downloads and survive another restart without
duplicate/replay.5 repaired/corrupt server runs assert clean exit0/quick_check=ok.
Corrupt evidence survives503 while health200; headers/cookies/lists/status count
and unknown/final clocks are checked. No parser/DB/network mock. Old missing
upstream0 is corrected to null for new records with an exact new expectation,
not historical backfill or weakened assertions. Recovery HTTP list envelope is
the existing items/nextCursor/hasMore shape, now explicitly documented.

Final sequential typecheck/build→185 files/2036 passed/1 skipped→lint/perf/
strict OpenSpec/diff passed. New journal-enabled A/B report
reports/capture-ab-2026-10-15T22-05-53.884Z-86407.json has all3 qualified/passed:
extra E2E p95 HTTP/HTTPS/near2MiB=7.024/12.158/7.471ms, actual loop p99=
2.646/2.335/2.177ms; raw pairs/cold/compiled hashes/zero cleanup retained.
No budget/dependency change. Main still45 tracked edits untouched, no commit/
push/native/global change/paid Agent call. Docs-only recording separately checked.
Power loss,30-minute soak, full Web/scanner concurrency, reconnect and actual
Agent/Windows support remain unverified. Next7.3 explicit capacity/deletion
and remaining B6/versioned replay, then native/full-chain/metrics/Web/real Agent
gates. Do not archive or declare full parity/goal achieved.

The earlier7.3 committed-journal resurrection edge is fixed by additive schema15
exact request+both-original tombstones, not a global time floor. CLI startup
retention and markers commit atomically; recovery drops only matched journal
metadata before body IO and leaves originals charged/intact. A distinct or
uncommitted old-clock journal is not labelled deleted. CLI0 remains default.
The still-pending7.3 gates are capacity/watermark/WAL/disk faults, explicit
manual metadata/original deletion and a bounded yielding post-recovery TTL
pass. Never invoke the legacy synchronous bulk purge on HTTP paths or silently
delete original files to hide this remaining work. See latest implementation
section for the schema/index side-effect regression and full acceptance data.

Latest forwarding batch supersedes older snapshots below: OpenSpec26/71;
B4 task5.5 complete. Diagnostic-only capture-ab.ts/test plus09-capture-ab.mjs
exercise actual runtime/MITM/file originals/production worker/metadata SSE.
Three100-pair,4-concurrency profiles (HTTP, trusted HTTPS CONNECT,1,801,413B
HTTP SSE) each retain1 cold pair, exclude3 declared warmups, alternate AB/BA,
prove first-byte delivery with origin feedback, compare exact request/response
application headers/status/bytes and original-backed protocol projections.
13 real-network tests additionally cover4 codecs × JSON/SSE and reset/cancel/
HTTP503 prefixes. No parser/network/DB logic is mocked. Smoke is unqualified.

Final sequential typecheck/build→183 files/2020 passed/1 skipped→lint/perf/
strict OpenSpec/diff passed. Report reports/capture-ab-2026-10-15T21-37-59.322Z-83428.json
records actual compiled SHA-256 fingerprints/base HEAD/working-tree marker,
raw timing pairs, cold/init/distributions and post-shutdown zero ownership.
Additional E2E p95 HTTP/HTTPS/large=6.585/13.823/5.097ms; additional first-byte
p95=3.650/11.085/1.683ms; sampled loop p99=2.402/2.183/2.128ms. All qualified
within predeclared<=20ms p95 and existing storage/loop budgets. HTTPS warm max
additional E2E21.569ms and cold first-byte52.011ms remain visible; not every
sample is promised below20ms. Total624 controlled origin calls/312 rows/624
exact originals/312 metadata SSE events, zero unexplained admission failures.
Successful synthetic DB/CA/original/build copies were removed, report retained;
CLI failure retains isolated synthetic evidence. No user data removed. Main
still45 tracked pre-existing changes untouched, no dependencies/commit/push/
native/global changes/paid calls. Docs-only recording separately validated.

Reproduce with npm run build then npm run perf:check (includes09), or
node perf-diag/09-capture-ab.mjs [--out <new-report.json>]. Scope excludes full
Web/scanner concurrency, total RSS,30-minute soak, crash/reconnect and actual
Agent support;2.4/11.4 and pending parity remain open. Next B6 persistence/
recovery/versioned offline replay, then native/full-chain/metrics/Web and
actual Agent gates. Goal active; do not archive or claim full parity/release.

User approved implementation, no redaction, full original capture, configurable 10GB total file budget and >=100MiB per direction, plus necessary contract additions without per-field reapproval. This supersedes the earlier raw-opt-in/redaction plan.

Worktree: /Users/howell/.codex/worktrees/telemetryref-fusion/awesomeTelemetry
Branch: codex/telemetryref-fusion
Main source directory remains unchanged. 109 relevant current files (team/scanner/schema/UI/metrics) were copied as the baseline; see baseline.md. Dependency runtime uses the existing local node_modules via symlink.

Read implementation.md, authoritative contracts, parity.md, then tasks.md. Do not re-ask permission for the decisions above. Follow each batch file whitelist and continue until the requested product works. Keep scan/proxy originals independent and link evidence through explicit IDs/provenance. Do not turn unknown timing, token counts or identity into fabricated certainty.

Latest transport batch supersedes snapshots below: OpenSpec25/71; B4 task5.4 complete. Schema14 adds only proxy_capture_transport with bounded512-byte CaptureTransportResult and explicit column constant; no originals/scan reset/backfill. Freeze first cause, actual upstream status and ended directions before IO/worker. Normal finalization waits both directions, including early response during upload; timeout evidence comes from actual native errors, not a new default monitor deadline. HTTP errors, network error, native timeout, client cancel and monitor stop are independent of processing and original retention. Started responses are aborted on failure instead of receiving the engine's appended error text. Late duplicates never overwrite the final record. Detail-only Web/analysis consumes this evidence; HTTP error→failed, interrupted call cannot be completed merely from a terminal marker. Source items/usage and original prefix remain available.

Browser-discovered protocol defects were reproduced red, then fixed: one error object was projected twice with the wrong generic locator, and Responses failure could be overwritten by later completed; errors now retain actual event/JSON locators and failure precedence, while separate error frames stay separate. Final gate typecheck/build→182 files/2007 passed/1 skipped→lint/perf/strict OpenSpec/diff passed. New transport-result13 and real transport-faults12 cover HTTP401/429/500/503, refusal, abort/prefix, socket timeout before/after headers, upload/download cancel, clean EOF and early response/late upload; existing stop/CONNECT/lifecycle/worker suites remain green. Production proof `/tmp/telemetry-transport-proof.CDljfh`:3 total controlled upstream calls across2 clean runs(1+2),3 rows/6 matching original downloads (one response interrupted), clean EOF stays protocol-incomplete, HTTP429 is failed with complete original, broken200 with terminal marker remains incomplete. First429 originals survive restart and fixed offline analysis without another upstream request. Both proof processes quit0, tabs/listeners closed, quick_check=ok. Next5.5 A-B/overhead/load, then B6 recovery/replay and later native/metrics/Web/actual Agent work. Main remains45 tracked pre-existing changes; no commits/pushes/native/global changes/paid calls. Goal active, full parity unproven.

Latest resource batch supersedes snapshots below: OpenSpec24/71; B4 task5.3 complete. Process-wide semantic admission now bounds64 collectors/32MiB charged preview memory,64 jobs/32MiB source bytes and2 live workers including termination, across listeners. Fixed collector display/header allowance and raw-block/handoff charges are explicit; failure evicts semantic buffers and records resource_limit/CAPTURE_PREVIEW_BUDGET_EXCEEDED with observed previewDroppedBytes, without changing forwarding/originals. Header encoding evidence survives failed processing. Queued/active/terminating reservations settle on every path. File queues additionally cap4096 pending operations per application body store; decoded expansion has separate decoded_too_large/DECODED_TOO_LARGE. Web optional resource snapshots are process-wide gauges/lifetime counters, not per-run counts or RSS. Existing schema13/dependencies unchanged.

SSE now admits64 subscribers, caps256KiB frames/1MiB pending bytes and disconnects a non-draining client after5s (or immediately on overflow/write fault), clearing all owned subscriptions/timers. Excess admission returns503 ApiError SSE_LIMIT_REACHED. Healthy subscribers/capture remain independent; missed-event replay/resume is NOT done and task10.1 stays open. Real HTTP writable-backlog plus actual paused-client proof supplement unit drain/limit/cleanup coverage. No application-side SSE queue.

Final sequential typecheck/build→180 files/1966 passed/1 skipped→lint/perf/strict OpenSpec/diff-check passed. Production proof `/tmp/telemetry-resource-proof.upXiSQ`: real paused HTTP SSE client disconnected after112 synthetic16KiB events, with0 origin requests. Then64 held real proxy requests used24MiB charged preview/64 collectors;65th response200 retained2 complete originals but had explicit resource_limit. Release→all64 finish, then66th captures normally.66 calls/66 rows/132 exact original bytes/SHA-256; resources/worker/SSE gauges zero after explicit Web stop and clean quit(exit0), quick_check=ok, tab closed. Main still45 tracked pre-existing changes, no commit/push/global/native changes or paid Agent calls. Next5.4 full network failure/final-state fidelity,5.5 A-B/load, then remaining B6/B7/B8/B9 and actual Agent matrix. Full parity/goal completion still unproven.

Latest codec batch supersedes snapshots below: OpenSpec23/71; B4 task5.2 complete. RequestContext retains owned raw byte previews in16KiB blocks (2MiB/direction) separately from64KiB text. The actual worker and original-backed on-demand analysis share bounded incremental identity/gzip/br/deflate decoding, strict UTF-8 and SSE blank-line framing, leading BOM/comments/CRLF/multiline/empty delta support. EOF discards pending frames and cannot invent terminal/usage evidence; malformed/stacked/unknown encoding, decoded expansion and framing failures are explicit decode_error outcomes. Raw forwarding/files/downloads/digests remain unchanged. Context Diff decodes recorded request encoding and retains original encoded source digest/bytes. Current outcomes carry optional-compatible contentDecoding, legacy absence remains absent; schema13 unchanged.

Final codec gate typecheck/build→179 files/1951 passed/1 skipped→lint/perf/strict OpenSpec/diff-check passed. Real network JSON and SSE tests cover each of gzip/br/deflate in both directions. Production browser proof `/tmp/telemetry-codec-proof.iDHqlk` used actual compiled server/worker, disabled all scanners and sent exactly2 synthetic compressed requests: normal completed and incomplete-EOF.2 rows/4 complete original downloads match bytes/SHA-256, analysis causes zero extra upstream requests and SQLite quick_check=ok. Web decoded Chinese/usage and explicit framing degradation were verified, then proxy stopped, proof quit exit0 and temporary tab closed. Main retains45 tracked pre-existing changes; no commits/pushes/global config/dependency changes. Next5.3 aggregate active-preview/multi-listener/slow-consumer admission, then5.4 network/final-state fidelity and5.5 A/B/load. B6/B7/B8/B9 and actual Agent matrix remain pending; no full parity/goal completion claim.

Latest worker batch supersedes snapshots below: OpenSpec22/71; B4 task5.1 done. Real JSON/SSE/native identity metadata parsing is isolated in an owned bounded Node worker, no synchronous fallback.64 jobs/32MiB source bytes per listener,5s deadline,4MiB result cap and bounded heap; independent processing outcomes preserve originals and forwarding on queue/crash/timeout/limit failures. Completion UTC/monotonic duration sampled before queue/flush; stop drains outcomes/worker. Schema13 adds only proxy_capture_processing; no original/scanner reset. Package the complete server-dist tree (CLI/worker/shared assets). New diagnostics/UI separate processing degradation from Agent/original failure, and a production-browser-discovered false PROXY_LOAD_FAILED was fixed with a red regression.

Final worker gate typecheck/build→178 files/1925 passed/1 skipped→lint/perf/strict OpenSpec/diff-check passed. Frontend664.38kB/187.82kB gzip retains warning; full server tree includes cli645.21/176.95, worker6.95/2.28 and shared19.69/5.73. Synthetic proof `/tmp/telemetry-worker-proof.MSXLHg` closed cleanly:3 origin requests/3 rows/6 matching complete originals, outcomes ok/preview_truncated/preview_truncated. Actual packed worker, real crash/restart/timeout/result-limit and network-original-preservation tests pass. The queue is per-listener finalization processing; global active-preview/multi-listener/slow-consumer/streaming budgets remain5.2–5.5 and must not be claimed complete. Next implement incremental decoding/compression/failure fidelity and global admission, then B6 crash/persistence/replay and B7/B8/B9 full-chain work. Exact actual Agent matrix1.4/11.2 remains pending; no transport downgrade or implicit paid/tool-side-effect tests. Main unchanged, no commits/pushes; keep the goal active.

Latest diagnostic batch supersedes snapshots below: OpenSpec21/71, B3 task4.5 implemented. Explicit Web check and `agent-observe diagnose --server <loopback-origin> --profile <uuid> --revision <n> [--json]` share the backend read-only evidence projection. Expected/current ports, bounded public CA digest/expiry, unverified selected-runtime trust/unchecked OS trust, current shared traffic and actionable errors are distinct. No CA generation/listener/Agent start/native config/process probe/upstream request happens in diagnostics. Web5s abort/unmount cancellation and local-only stale invalidation; CLI12s timeout, revision check, human/JSON output and exit0 retrieval/exit2 error semantics. Actual Agent trust/identity is never inferred from recipe/listening/HTTP counters. See implementation.md for the production browser-discovered JSON-order stale-state bug and its red→fixed regression. Browser proof services/tab are closed; only1 deliberate synthetic origin request/1 saved capture. Continue B4 bounded worker/streaming and B6 recovery, and obtain exact actual Agent transport evidence for1.4/11.2 without forcing a downgrade or making paid/tool-side-effect calls implicitly. Do not archive or mark full fusion complete.

Final diagnostic gate: sequential typecheck/build→177 files/1912 passed/1 skipped→lint/perf/strict OpenSpec/diff-check all passed. Existing frontend >500kB warning remains662.22kB/187.15kB gzip; setup lazy10.11kB/3.18kB gzip. Perf medians list0.379ms/worst9.494ms/proxy0.843ms; see PERF-BASELINE.md for scope. No dependencies/budgets/assertions changed. Main retains45 pre-existing tracked changes untouched; no commits/pushes. New diagnostic module10 tests, setup UI8,2 real server/CLI tests,2 real refusal/stall CLI tests and1 contract type case. Proof `/tmp/telemetry-diagnostic-proof.3dUAhP/observed-shared-not-verified.png` is the corrected production snapshot; old stale-snapshot.png predates the key-order repair. Proof process confirmed terminal after explicit proxy drain and exact-PID cleanup; no live service/tab remains.

Latest process-connection batch: OpenSpec20/71, B3 task4.4 implemented. App-owned profile CRUD (32/256KiB, exclusive writer/atomic writes, revision checks) and lazy bilingual setup drawer now generate explicit terminal commands pinned to a saved revision. `agent-observe launch --server <loopback-origin> --profile <uuid> --revision <n> -- ...` uses the real shared start/readiness/CA APIs, launches a direct child with inherited stdio/cwd/literal argv, preserves parent/native config and selected old CA files, and cleans its own temporary public trust bundle after normal/handled-signal exit. Codex help is checked for --no-daemon, with no WebSocket downgrade; OpenCode loopback bypass and other runtime trust/enterprise proxy limits are explicit. There is no HTTP arbitrary-process execution endpoint. A recipe is neither a process filter nor native session identity or actual Agent certification.

Actual synthetic production Web→profile→shared control→built launcher→HTTPS CONNECT→original inspection passed with2 origin requests/2 captures/4 verified original digests. An edited profile rejected the stale copied command without another origin request. A real PTY Ctrl-C delivered one interrupt, exit130 and trust-file cleanup; targeted Unix SIGINT/SIGTERM are integration tests too. Equal-issuer/different-key CA composition first failed TLS validation; it is now an explicit preserved-file conflict, and distinct inherited trust passes real CONNECT. Force-kill/crash/Windows/actual Agent cases remain unverified. Full diagnostic/support matrix task4.5 and all later pending tasks must still be finished; keep the goal active and do not archive/release.

Final process-connection gate: typecheck→build→176 test files/1893 passed/1 skipped→lint→perf:check→strict OpenSpec→diff-check passed sequentially. Frontend652.77kB/184.04kB gzip retains the existing >500kB warning; the setup panel is lazy7.38kB/2.41kB gzip. Profile storage7/launcher13/setup UI4 tests plus shared controller/server/CLI/UI regressions include corrupted config, writer ownership, revision overflow, stale commands, CA collision/digest, actual CONNECT, real child signals and malformed route encoding. Synthetic proof directory `/tmp/telemetry-connection-proof.T7Gktm`, all services/tabs closed. Main checkout still has its45 pre-existing tracked changes, untouched; no commits/pushes. Continue with4.5 actionable runtime trust/traffic diagnosis, then the remaining B4/B6/B7/B8/B9/B10 gates. Prior progress snapshots below are historical, not competing current status.

Latest lifecycle batch supersedes the earlier18/71 snapshot below: OpenSpec19/71, B3 task4.3 complete for the tested MITM/server/Unix signal path. Stop is asynchronous and bounded:5s stream grace,10s control deadline, per-direction interruption, flush-before-idle and no restart while cleanup owns resources. Current runtime always returns optional-compatible ProxyRuntimeStatus diagnostics; waiting_for_traffic is not Agent readiness. Active/pending/persisted counters use200ms metadata SSE; stale old-run activity is ignored. HTTP close waits its proxy/watcher/SSE/handlers and actual scan work even beyond provider timeout; CLI waits startup prewarm before SQLite close. See implementation.md for exact tests/browser proof. Next priorities are4.4 process-scoped setup and4.5 actionable Agent/trust diagnostics, then streaming/recovery and native call/tool/subagent read models. Full real-Agent/Windows/Frida validation remains pending; do not declare parity or release completion.

Final lifecycle gate: typecheck,173 test files /1864 passed /1 skipped, lint, build, perf:check, strict OpenSpec validation and diff-check all passed. Frontend645.02kB/181.24kB gzip retains the existing warning. No dependency/global settings/main-checkout changes or commits. Synthetic browser proof directory `/tmp/telemetry-lifecycle-proof.JcFmIs`; all proof servers/tabs closed.

Latest verification (2026-10-16): OpenSpec18/71 tasks complete, including B7 task8.2 session-level evidence association and8.5 association-aware previous capture/Prompt selection. Schema v12 adds indexed native identities, direct/candidate/manual/revoked membership and audited choices; lazy Web panels support session↔capture navigation and source/audit drill-down. Context Diff now requires unique accepted membership, orders actual captured UTC instants rather than insertion ids and explicitly warns that native turn adjacency is unproven. It never automatically falls back to parsed_session_id/captureGroup/time-window longest prompt. Revocation invalidates cached/in-flight context conclusions without automatic body reparse. Manual comparison remains available without confirming a relationship. Synthetic production-build browser verified these workflows and request-specific Prompt navigation. Native event/call/tool/subagent mapping and automatic relation patches/recovery are not complete. See identity-design.md and implementation.md for this boundary.

Original storage/download, controlled100MiB network round-trip, real CONNECT trust/SAN/restart, three-protocol offline evidence projection, lazy analysis UI and original-backed context diff remain implemented. Final sequential typecheck/test(--maxWorkers=1)/lint/build/perf/strict-validation/diff-check passed:172 test files,1852 passed,1 skipped. The >500kB build warning remains visible. See implementation.md for a prior unreproduced transport reset and default-parallel relative list-microbench failure; no assertion/budget was relaxed. Isolated10000-capture predecessor metadata lookup median8.447ms (<20ms). See support-matrix.md for installed CLI evidence. No actual Agent combination or full fusion parity is certified yet. The old Clear UI calls a backend DELETE route that still does not exist; explicit cleanup/export remains pending, not a completed feature.

Capture originals asynchronously to local files; SQLite keeps metadata and bounded previews. No automatic file eviction or expiry. Full quota, body limit, queue overload, interrupted streams and write errors must be visible. Context-diff analysis limits do not limit original capture/download. Existing redaction utilities may stay for compatibility but monitoring bypasses them.

Release acceptance: P01–P18 in parity.md, three-protocol golden tests, full original 100MiB round-trip, real HTTPS CONNECT/CA, parallel sessions without cross-linking, correct token subsets and timing domains, real-time Web without manual refresh, reconnect recovery, source evidence down to tools/subagents, comparison/export/evaluation, full typecheck/test/lint/build/performance regression and actual Agent validation. A source file or mock test is not real-platform evidence. Pending parity rows prevent a completion claim.

Baseline verification found typecheck/lint passing; full test run had 1719 passed, 1 skipped, 2 failed: pack-binary requires build output and retention has fixed-date fixtures that drift with current time. Original file store has a new 100MiB filesystem test. Record subsequent commands/results in implementation.md/PERF-BASELINE.md and only tick fully completed tasks. The goal remains active until the complete accepted scope is verified.
