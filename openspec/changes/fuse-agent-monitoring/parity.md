# telemetryRef capability acceptance

Reference: /Users/howell/Documents/Coding/telemetryRef/trace-analysis, commit 2d3567b. Status is evidence-based; pending rows block a claim of parity. This table is a release floor, not a promise that a source file's existence proves support.

| ID | Reference capability | Fusion acceptance | Current evidence |
|---|---|---|---|
| P01 | HTTP/HTTPS proxy capture | Exact request/response bytes, headers/status, real CONNECT + CA | Verified controlled HTTP and trusted HTTPS upstreams; untrusted CA/SAN rejected; CA reused after restart. Actual Agent matrix pending. |
| P02 | 100MiB body recording | Stream original bodies >=100MiB without main-thread buffering | Verified real 100MiB upstream → proxy → file → HTTP download, exact bytes/digest; bounded preview/queue. Not sustained-load certification. |
| P03 | No redaction | Headers/body/prompt/tools displayed and exported unchanged | Original capture/download/diff/projection values, authorization and cookies verified. Full export workflow and other transports pending. |
| P04 | Chat completions | JSON/SSE content, tools, usage, errors, finish reason | JSON/SSE fixtures and real gzip-SSE proxy/API verified: parallel choice/tool fragments, functions, usage-only snapshots, finish/error/EOF. Actual Agent pending. |
| P05 | Anthropic Messages | string/array system, content blocks, tool_use/result, split usage | JSON/SSE fixtures and real HTTPS model/system/input/output capture verified. Actual CLI multi-turn/tools pending. |
| P06 | Responses | instructions/input, output items/tools/reasoning, nested usage | JSON/SSE fixtures and controlled capture/diff verified: final snapshots replace fragments, failed/incomplete states retained. Actual CLI transport/tools pending. |
| P07 | Qoder/nested SSE | Verified wrapper decoding with retained outer evidence | pending |
| P08 | Session/trace metadata | Header/body native IDs retained with namespaces and provenance | Native Claude/Codex/OpenCode-family and explicit network declarations retained with namespaces/scopes/locators/completeness. Indexed session-level associations, collision downgrade and audited manual choices verified by storage/HTTP/browser tests. Actual Agent client mappings, per-event/call links and complete native coverage pending. |
| P09 | Performance metrics | Header/content/end times, native timing distinct, TPS/TPOT with basis | pending |
| P10 | Usage/cache/reasoning | Native counters + subset accounting, null distinct from zero | Per-call projection verified: OpenAI100/20/cache40/reasoning5→120, Anthropic additive cache, bounded native snapshots. Cross-source dedup/aggregation pending. |
| P11 | Tool reconstruction | Parallel fragmented arguments, results and native execution evidence | pending |
| P12 | Local export and offline analysis | Original evidence download, normalized records, reparse without API calls | Original download/analysis verified; repeated analysis makes zero upstream calls. Full export workflow/versioned replay pending. |
| P13 | Repeated evaluation/comparison | Reproducible task/config/results and evidence comparison | pending |
| P14 | Trae CLI routing scenario | Explicit endpoint/proxy configuration and capture; preserve client credentials and request semantics | pending |
| P15 | OTel integration scenario | Standards-based local export with correct IDs, times and usage | pending |
| P16 | Custom upstream/gateway support | Same protocol outcomes for custom and official hosts | Protocol-first routing fixtures and controlled custom-host requests verified. Nested/proprietary transports pending. |
| P17 | Continuous recording | Configurable budget, explicit exhaustion/errors, restart accounting, no silent eviction | Quota/queue/body/write-error/restart accounting and reliable MITM stop verified: HTTP/SSE drain, client disconnect, interrupted prefix persistence, real bind errors, CONNECT listener closure and late certificate guards. HTTP server closes its own SSE/watcher and awaits actual scan tasks; built CLI signal helper passes real Unix child-process tests. Same-DB journal recovery now passes real process-kill/final-commit-failure and repeat-restart/download tests; see supplement. Long-duration load, power loss, manual deletion and Windows lifecycle remain pending. |
| P18 | Agent end-to-end product gain | Network + native session/tool/subagent evidence in real-time Web | Synthetic session↔capture navigation, direct/manual/revoked evidence, audit after restart and unique-session context/Prompt selection verified in production-build browser. App profile→revision-pinned terminal launcher→real HTTPS CONNECT→live Web/original inspection also verified with2 synthetic requests/2 captures/4 matching original digests, stale-command refusal and Unix trust-file cleanup. Recipes are not process filters or native identities. Revocation hides stale context conclusions; manual comparison does not re-confirm identity. Tool/subagent execution graph, full diagnostics, automatic real-time relation updates/reconnect and actual Agent acceptance pending. |

External gateway rewriting is a distinct user-enabled action, not something the monitor applies to the observed workload. If a reference scenario requires optional conversion rather than observation, record that adapter separately and obtain the requested behavior through explicit configuration. Reference timestamp/session heuristics must not become falsely authoritative facts.

Retention identity supplement (first7.3 gate, not all storage management):
schema15 records exact request+both-original deletion markers atomically with
explicit startup metadata expiry. Same-owner matching stale journals cannot
recreate deleted rows even when policy is later disabled/lengthened. Other
old-clock/uncommitted observations are not dropped by age alone. Original
files remain byte-equal/quota-charged, deleted HTTP body routes return404.
Real CLI self-check/restart test makes1 actual capture, explicitly reinjects
its valid stale journal/ages fixture metadata, then verifies2 clean restarts
without replay/resurrection; not an OS-created-remnant claim. UTC boundary,
rollback, distinct identity, schema preservation/index and corruption cases
pass. New UTC index's predecessor-plan regression was fixed in source with
association-driven CROSS JOIN, unchanged assertions. Final2045 tests and3 A/B
profiles pass original budgets. Manual original deletion, marker growth/
capacity controls and bounded post-recovery current-TTL enforcement remain
pending; this does not certify all nonzero-retention/storage/reconnect/platform
workflows or close P17/full parity. Main/user originals unchanged.

Crash recovery supplement (B6 task7.2) for P02/P03/P12/P17/P18: bounded private
same-DB metadata journaling precedes new original-file writes while forwarding
continues. Actual process-kill tests cover an unfinished stream and complete
originals followed by failed final SQLite commit: each1 origin call→1 recovered
row/2 exact downloaded originals→repeat restart without duplication/replay.
Unknown timestamps/usage stay null; actual terminal clocks/finished refs survive,
processing closed stays independent. Real DB locks verify bounded nonblocking
retry and no false saved notification on permanent failure. Corrupt metadata
returns unified503 without blocking health; evidence retained. Recovery sends
one status correction, not per-record bodies. Journal identity alone cannot
adopt another DB/request; both original IDs must match committed data. Defaults
are64 jobs/256KiB record/4MiB pending/16MiB journal metadata, no original eviction.
Final185 files/2036 tests pass, journal-enabled A/B passes unchanged budgets
(E2E p95 additional7.024/12.158/7.471ms; actual loop p99<=2.646ms). This verifies
durably admitted/written process-crash prefixes, not power loss, manual cleanup,
versioned replay/export,30-minute load, Web reconnect or real Agent/platforms.
Old unjournaled remnants remain preserved/quota-charged, never guessed into a
request. Older supplements' pending process-crash gap is superseded only within
this measured scope; other pending parity requirements remain open.

Forwarding A/B supplement (B4 task5.5) for P01/P02/P05/P17/P18: actual runtime,
file originals/SQLite, copied production worker and real metadata SSE subscriber
pass100 interleaved warm pairs at4 concurrency for HTTP, trusted HTTPS CONNECT
and1,801,413B HTTP SSE. A producer waiting for client first-byte feedback proves
forwarding before EOF; exact application headers/status/encoded bytes, original
digests and protocol projections agree.13 real-network tests add4 codecs ×
JSON/SSE and reset/cancel/HTTP503 prefix fidelity. Final report
reports/capture-ab-2026-10-15T21-37-59.322Z-83428.json retains raw pairs/cold/warm/
compiled hashes: additional E2E p95=6.585/13.823/5.097ms, actual sampled loop
p99=2.402/2.183/2.128ms, all3 qualified under predeclared budgets.624 controlled
origin calls/312 captures/624 exact originals/312 metadata SSE events; ownership
zero after shutdown and disposable synthetic data removed. HTTPS cold/max
outliers remain recorded; first body byte is not model TTFT. This closes the
scoped forwarding gate, not actual Agent/full Web/scanner concurrency,30-minute
soak, total RSS, recovery/reconnect or pending parity rows. Older supplements
below are historical snapshots; this batch supersedes their pending A/B gap.

Transport supplement (B4 task5.4) for P01/P04/P05/P06/P17/P18: additive schema14
records independent first-cause network outcomes, actual upstream status/end
flags and exact original completeness.12 real fault cases prove HTTP error,
refusal, native socket timeout before/after headers, upload/download cancel,
broken/clean SSE and early response/late upload, with1 record and released
ownership. Already-started responses receive only observed prefixes before
abort, not appended engine errors. Protocol failure precedence/one projection
per error object and actual source locators are red→fixed regressions. Web proof
shows failed429/full original, clean EOF/protocol-incomplete and broken200 with
terminal marker/incomplete call/retained prefix;3 origin calls across restart,
3 rows/6 matching downloads, no replays. Whole-proxy A-B/overhead, long-duration
load/crash/reconnect recovery and actual Agent/platform gates remain pending.

Resource supplement (B4 task5.3) for P02/P17/P18: shared process-wide semantic
preview/job/worker admission and explicit eviction/rejection counters now bound
concurrent listeners. Original-store pending operation counts supplement its
byte cap. SSE client/frame/writable/drain bounds disconnect one slow subscriber
without blocking healthy clients/capture. Production proof used a real paused
subscriber (disconnected), then64 held requests/24MiB charged previews;65th
still forwarded200 and retained complete originals while semantic parsing was
resource-limited. Release followed by66th request proves reuse;66 records/132
matching complete original digests, all gauges0 after clean shutdown. This is
not sustained30-minute load, total RSS, replay/resume, full failure matrix or
actual Agent acceptance; those pending parity requirements remain unchanged.

Connection diagnostics supplement P01/P17/P18: Web and built CLI now share
bounded read-only listener/CA/current-shared-traffic findings and actionable
timeout/bind/capture/bypass guidance. A synthetic production browser proof
verified missing CA without generation, waiting then observed traffic, stale
snapshot invalidation and no false stale result after refresh; stopped-run
count1 remains unavailable current traffic. Runtime trust, Agent identity and
full platform support remain unverified; diagnostics do not close pending
parity rows or substitute for actual Agent validation.

Capture-worker supplement for P09/P17/P18: live metadata parsing now runs in
a bounded actual Node worker with explicit queue/crash/timeout/result-limit
outcomes, separate original completeness and pre-processing monotonic network
duration. Real fault requests preserve response/original bytes and do not
invent parsed usage. The copied packaged worker executes successfully; a
synthetic production browser verified3 requests/3 records/6 exact originals
and clearly marked preview limits. Global active-preview/streaming/slow-client,
sustained-load/crash-recovery and full timing/Agent/full-chain gates remain
pending; this does not close those parity rows.

Codec supplement for P01/P04/P05/P06/P12/P17: incremental identity/gzip/br/
deflate decoding now consumes byte-preserving bounded previews, not text
re-encoding. Six real proxy cases (3 codecs × JSON/SSE) verify exact forwarded
request/response bytes, decoded model/system/usage and original-file fidelity.
UTF-8 split characters, BOM/comments/CRLF/multiline, empty data/deltas and
pending EOF frames have regressions. Worker/on-demand protocol/Context Diff
share decoding; Context Diff provenance still names encoded source bytes.
Production Web proof shows decoded Chinese and a completed stream, then an
explicit incomplete EOF with complete originals;2 upstream requests/2 rows/
4 original downloads match bytes/digests and repeated analysis adds no traffic.
Unknown/stacked/corrupt encoding, invalid UTF-8 and expansion limits report
semantic degradation independently from originals. No new runtime dependency.
Global active-preview/slow-consumer and sustained-load/failure/Agent matrices
remain pending; task5.2 is complete, not full CAP-001 or parity acceptance.
