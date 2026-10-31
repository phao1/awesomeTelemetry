# Evidence-backed agent architecture diagnosis

User-authorized post-M12 M8/M9/M10 increment,2026-10-29. Canonical additive DTOs
are `src/core/architecture-diagnosis-types.ts`; no native DTO/schema mutation.
This augments the task-mode experiment with automatic diagnosis of real retained
telemetry, rather than inferring architecture from final scores.

## AD-001 real source collection

Explicit GET `/api/tasks/:id/architecture-diagnosis?member=...` analyzes only a
verified task/member scope. Optional numeric threshold query parameters use the
canonical Thresholds keys, bounded and validated. Existing loopback/Host/Origin,
no-store, ApiError and foreground guards apply. No collection/start/CA/proxy/
upstream/model/tool execution, automatic retries, body deletion or native writes.
One analysis job/server; AbortSignal on disconnect/shutdown; bounded deadline.
Observe source revisions before/after and reject stale/deleted/rebound evidence.

Native model/token/tool facts come from actual retained records with exact IDs;
generic session totals or event usage are not automatically context-window size.
Only explicit per-call/last-call input usage may be contextTokens. Native Claude
full-envelope observations deduplicate by session/message.id, keeping the last
visible snapshot; absent call identity cannot establish multiple calls. Retain the
token basis and separate native/capture streams; no double-counted occurrences.
HTTP capture reads reuse verified original/body deletion/integrity/decoding
guards. Only accepted current task membership is eligible; session membership
does not prove model-call ownership or communication. WS connection intervals,
usage and previews are not model calls: use Codex logical-call projection in one
bounded worker pass, not per-call repeated full-connection parsing. Explicit
previous-response incremental requests are partial context unless reconstructed;
actual call usage may still describe input tokens with its recorded basis.

Budgets: <=400 native metadata records,<=64 native body reads capped64KiB each,
<=8 captures,<=32 logical calls,<=32 handoffs,<=128 context parts/call,<=256 tools/
call,<=128 proposals/call,<=512 evidence refs,<=64 findings,<=512KiB report. WS
diagnosis retains <=64KiB request and <=64KiB response events per logical call,
<=4MiB internal worker projection; over-limit evidence is explicitly partial. All
omissions and unavailable data are visible. Async originals and worker parsing;
yield between bounded native processing; prepared statements cached outside
loops; one frontend request, no fan-out/polling or per-row body reads. Do not
scan all sources, rehydrate an unparsed task automatically or overwrite input
payloads. Unsupported imported sources remain explicit, not simulated.

## AD-002 detection and reasoning

Pure `analyzeArchitectureDiagnosis(input, thresholds?, analyzedAt?)` returns
three category states, observed/heuristic findings, measured facts, source refs,
an adjustment action, conditions and a controlled verification step. Default
numeric thresholds are public heuristics, not Anthropic's universal cutoffs.

Context bloat: compare >=3 same-stream samples with consistent per-call token
basis or full-context character basis. Report substantial growth and its actual
source points; duplicate complete message/tool hashes identify repeated content.
Large/redundant catalogs first suggest deferred tools/skills and progressive
disclosure. Large tool-result/history context can suggest isolating a genuinely
independent disposable-context branch, conditional on checking that boundary.
Growth alone never proves quality degradation or that splitting is required.
Within one complete request, substantial same-kind/hash extra copies may be
reported as visible duplication under the size/ratio thresholds. Natural
cross-turn carried history without growth is not independently a bloat verdict.

Tool conflicts: confirm same-name/different-schema declarations in one complete
request; check actual proposals against complete callable definitions, forced
tool choice and required top-level arguments. Flatten supported namespace tools;
built-ins/unknown catalogs cannot authorize undeclared-tool findings. Proposals
are not executions. Actual explicit unknown-tool/argument failures are separate
outcomes, never inferred from arbitrary tool error/frequency or name changes.
Recommend contract/name repair first; isolating conflicting specialist tools is
a conditional experiment, not an automatic architecture win.

Handoff: only actual send/spawn calls with explicit target/result identities may
link sender and recipient. Parent edges, declarations and timestamp proximity
never create a message. Missing/truncated/unresolved receiver evidence yields
insufficient coverage. Compare explicit required references when retained, and
conservative literal URL/path/code/constraint anchors from actual sent text with
complete recorded received input. Missing exact text is an observed reference
gap but only a heuristic for semantic loss; paraphrases/additional context may
preserve meaning. No text-length/embedding-similarity/LLM rubric proves loss.
Multiple such gaps/tight sequential exchanges support trying to merge coupled
steps; preserve independent verification and require rerunning fixed task evals.
Repeated gaps across one sender's actual delegation boundaries to multiple
recipients may also support a conditional merge experiment. Neither gap count
nor multiple children proves coupling; verify shared details and sequence
dependency first, and avoid double-counting a pair already summarized.

Statuses: findings when supported evidence exists; not_observed only on complete
coverage for that dimension; otherwise insufficient. Missing is not zero and
absence in a bounded sample never certifies the whole task. Always show source
scope, coverage and limitations; no automatic prompt edits, refactors or replays.

## AD-003 interaction

In the real selected-task reader, explicit Analyze reveals all three categories,
facts → evidence → split/merge/progressive-disclosure/contract-repair action →
verification. Evidence opens the exact native event or capture/Codex call, with
path and bounded public excerpt. Current task source/window/member changes or
relevant invalidation clears stale conclusions; refresh is explicit. One owned
request with deadline/cancel/retry and late-result suppression. Language does
not refetch. UI bilingual and inert text, <=20 findings/page, evidence<=8/finding.

The experiment page reuses the same real-task selector/analyzer. Imported driver
detail/tokens/native locators never become verified native facts automatically;
simulated report results stay separate. No new global navigation or source store.

## File scope

New: this contract; openspec/specs/architecture-diagnosis/spec.md;
src/core/architecture-diagnosis-{types,analysis}.ts and adjacent tests;
server/architecture-diagnosis/{collector,native,capture}.ts and tests;
server/http/architecture-diagnosis-routes.ts and tests;
src/components/diagnosis/ArchitectureDiagnosisPanel.tsx and test;
src/styles/components/architecture-diagnosis.css;
docs/architecture-diagnosis.md.
Integration: server/server.ts (route,guard,existing source loader wiring),
src/App.tsx (source invalidation metadata only),
server/codex/{service,worker,projector}.ts and existing related types/tests,
src/components/task/TaskWorkbench.tsx and test,
src/components/team-experiment/TeamExperimentCenter.tsx and test,
openspec/contracts/{api,nfr}.md, README.zh-CN.md, PERF-BASELINE.md.
No changes to unrelated watcher/predecessor/bundle-test drafts, no new runtime
dependency. Add files/fields here before necessary implementation extensions.

Verification integration: eslint.config.js excludes only the app-owned ignored
awesome-telemetry-data runtime/import/experiment workspace. Source rules stay in
force; generated driver scripts are not submitted project source.
