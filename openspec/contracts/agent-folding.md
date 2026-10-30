# Agent boundary evaluation workbench

User-authorized goal,2026-10-29: faithfully operationalize Anthropic's article
and pinned single-agent-loop-kit, combining measured task evals with this
product's observability. Post-M12 M8/M9/M10/M12 increment. Canonical additive
DTOs: src/core/agent-folding-types.ts. Existing v1 team experiments and native
architecture diagnosis remain compatible; no new database schema/runtime deps.

## AF-001 sources, inventory, and audit

Pinned reference: anthropics/single-agent-loop-kit commit
c43796287b83bec847db923f07131d1cc8de750d, Apache-2.0. Preserve license, copyright,
file hashes, origin URLs and modification notes for copied code/data. The kit
is an unmaintained reference, not a supported service or universal optimizer.
Its published model records, fictional tasks, generated production-like
traffic, fake smoke, new local model executions and user imports are distinct.
Imported provenance is user-reported; it cannot self-certify as trusted local
capture or official publication. No script/HTML/path/URL execution on import.

Inventory includes the main loop and each specialist's owner, prompt, tools,
callers, return contract, user dialogue, external control, context need and
source refs. Verdicts are fold/merge/as-tool/keep/main. Organization, persona,
long prompt and tool count alone do not justify independent agents. Actual
context isolation/parallel independent work/tool or instruction conflicts are
conditional reasons; external ownership/direct dialogue can protect a boundary.
Source code/owner declarations/observed traces/inferences are labelled separately.
Native diagnosis creates candidates, not eval outcomes; preserve its original
limits and exact source locators. Arbitrary missing owner/eval data stays missing.

Traffic coupling uses one trace at a time, ordered calls, exact distinct traces
and same-trace adjacency. Synthetic traffic must remain labelled. Common traffic
and shared data create candidates, not proof that a merge improves quality.

## AF-002 cases, controls, and experiments

An evaluation case is an independent customer/task input (possibly multiple
turns) with initial identity/state and explicit checks; assertions are not
separate cases. Fix the case set, grader, model/configuration, tools/skills,
runner/environment/version, and budget. Keep training and final-confirmation
sets separate. Each trial identity is experiment+variant+case+repetition.
Never mix baseline/v1 belonging to different experiments. Harness errors are
separate unknown outcomes and stay in expected denominators.

One experiment changes one declared boundary: combine a coupled pair, fold a
specialist into skill+tools, keep context but expose structured agent-as-tool,
or preserve dialogue handoff. Retain all non-target roles and independent
verification. Main prompt/tool-list changes expose neighboring tasks to risk;
list them and test every relevant chain/rule. Track skill-off ablation separately.
Optional plan.skillAblation executes a third candidate-without-skill variant with
the same tools/gates, recorded under experiment.ablationVariantId. Only actual
complete per-case ablation evidence can mark the control complete. A verified
tools-only fold with no skill loader can use not_applicable.
External drivers declare controls; hashes alone cannot prove semantic isolation.
Portable external plans may carry their own external.project inventory/cases/
evidence. The CLI imports it as user-reported and never substitutes the official
support-desk graph or fabricates missing references. Agent toolDefinitions are
optional: export actual retained schemas/preconditions when present, unknown
otherwise. Imported verified flags are not execution attestation.
Built-in graph transformations can verify which graph fields changed. Version
provenance recorded in old logs is not a claim those commits are checkoutable.

## AF-003 decisions from results AND process

For each boundary show audit proposal separately from experimental disposition:
candidate/supported/regression/needs_evidence/protected. Task completion is
computed per task across repetitions then equally across tasks; also display
raw trial pass counts, unknowns, paired metrics and95% intervals. A pass-to-fail
in ANY task blocks automatic adoption even if the overall average improves.
Show both directions of flips, missing tasks/reps, harness errors, model/control
mismatches and untested confirmation cases. >=3 complete comparable real reps
and full relevant-case/chain/check coverage are necessary for a supported
recommendation, not universal causal proof. Offline fake runs cannot be scored.

Inspect ordered routes per individual rep, tool/skill discovery/load/call,
full action name+arguments and failed checks. For the independent ordered,
per-repetition diagnostic, do not union agents across reps or ignore order.
Architecture r4 chain coverage instead matches the pinned kit: production chains
are agent sets; evaluation agents are unioned across successful rows of each case.
These are distinct results, never interchangeable (user confirmed 2026-10-30). Distinguish chain occurrence from a
successful end-to-end assertion of its terminal fact. New direct tools may
replace logical steps, but only declared verified mappings establish equivalent
chain coverage; absence is unknown otherwise.
Case chainChecks ties each chain to a specific terminal check; an overall pass
alone does not verify that chain's final fact. Controls.execution covers runner,
environment/tool/budget alignment. Each optional chainMapping names its variant,
before/after ordered steps, verification basis and original evidence refs.
Generic errors/name frequency, parent edges and missing preview text do not
prove wrong tool or lost meaning. Trial repetitions are canonical zero-based;
expected slots are0..expectedRepetitions-1 and extra observed reps are retained
per case, never invented for other cases.

Process facts retain original source/row/JSON pointer and bounded text. Historic
kit traces lack timings/call IDs/full result bodies: use sequence navigation,
never invent time or full request/receipt. Show observable path and write changes
even when task grades stay equal. Context volume, nested usage and tool selection
are diagnostics, not added billable totals or proof of cause. Human keep/revert/
fix/rerun decisions and notes never overwrite regressions or measurement limits.

## AF-004 execution and actual API

Support a runnable offline support-desk smoke and real Anthropic Messages driver
using Node native fetch, plus an external driver adapter using the existing
isolated Git/argv/independent-evaluator infrastructure. No new SDK dependency.
No model/tool execution on page load, import, analysis, export or replay. Browser
runs only the fixed offline fixture. Real execution is CLI-only, explicit
--execute and --allow-paid for Anthropic, after a concrete plan/token estimate.
Credentials stay in the process environment; status reveals configured booleans,
never key values. Current model name is explicit, not inferred from old logs.
No live API is claimed tested without a real authorized request.

One stable graph intervention per experiment; each case gets fresh backend /
isolated driver workspace. Keep each completed trial and an atomic partial
report when cancelled. Stop owned process groups/requests; no auto retry. Per-case
wall deadline, call cap, max output/request, input chars/request, tool batch cap
and measured token budget include nested agents. Token budget charged after a
response cannot guarantee an exact maximum bill; show this limitation. Parallel
read-only tools are bounded; writes require a runtime gate and execute in order.
The fictional fixture writes only its in-memory backend; external writes are
explicit driver scope. Direct tool precondition/permission/policy tests must
reject bypass attempts independently of model cooperation.

Local skills load by name with path/duplicate guards, deferred tool discovery
and bounded tool batches; structured subagent results use conclusion/evidence/
actions_taken/confidence/caveats and preserve a low-confidence invalid-result
state. Main verification and verifier rejection are observable; do not fabricate
independent validation. API Skills/code execution, Message Batches, tool search,
and Claude Code /claude-api commands are different capabilities; no invented
HTTP build-eval/hillclimb API. Commands may be exported as integration recipes.

## AF-005 UI, artifacts, and limits

Primary workflow inside #/team-experiment: sources → inventory/boundaries →
baseline+case/chain gaps → one-boundary trial → regressions+process → decision /
next change. Official recorded examples are directly loadable, not synthetic
score cards. Keep old overall-mode experiments as advanced compatible view.
Task reader/native analysis remains linked. No eager source scans or acquisition.

Show per-agent action, evidence strength and next missing check; regression list
before overall averages; drill to case/rep/check/action/trace with sequence/time
only as available. Bilingual, inert text, collapsible controls, explicit owned
read/run cancellation, no polling/fan-out, stale-result suppression, bounded
DOM (<=50cases/100events/20decisions visible per page). Source authenticity and
synthetic limits remain visible on every report and export.

Export/import strict portable project/report JSON and reviewable migration
artifacts: inventory, decision log, shared eval+confirmation tasks, per-boundary
change plan, skill/tool specs, structured result schema, contribution/upkeep
ownership and estimates. Never overwrite the user's Agent repository. Approval
or human adoption decision applies to concrete artifacts, not a blank proposal.

Bounds: project/report<=8MiB UTF8; <=32agents/64boundaries/200cases/20experiments/
4000trials/20000trace events/2000evidence refs; each source/evidence text<=16KiB,
<=64checks/case, turns<=16 and<=64KiB combined/case; traffic<=10000rows. HTTP
no-store, loopback Host/Origin/foreground guards, ApiError. Browser report reads
10s owned; fixed smoke<=45s/server,50s/browser, one active job/server. Bodies are
read only on explicit project/report load or selected evidence. All omissions /
limits are explicit, never silently certified complete. Existing NFRs stand.

## File scope

New: this contract; openspec/specs/agent-folding/spec.md;
src/core/agent-folding-{types,validation,analysis}.ts + adjacent tests;
server/agent-folding/{catalog,kit-import,native,runner,anthropic,fixture,external,artifacts,cli}.ts
+ adjacent tests; server/http/agent-folding-routes.ts + test;
src/components/agent-folding/AgentFoldingWorkbench.tsx + test;
src/styles/components/agent-folding.css;
scripts/import-single-loop-kit.mjs; data/agent-folding/** (licensed pinned sources/
fixtures and manifest); docs/agent-folding.md; bin/agent-folding.js;
config/agent-folding.example.json. Integration: TeamExperimentCenter.tsx + tests,
App.tsx/AppShell.tsx and tests, server/server.ts, vite.cli.config.ts, package.json /
package-lock.json, scripts/verify-package.mjs, README.zh-CN.md, PERF-BASELINE.md,
openspec/contracts/{api,nfr,data-model}.md. Preserve existing32-file uncommitted
architecture-diagnosis increment and unrelated watcher/bundle/predecessor drafts.
Add necessary extensions to this scope before editing; no silent dependency or
schema expansion.

## Architecture r4 P0 source mapping

Scope: src/adapters/claude-code.ts, native-identities.ts and adjacent tests;
local-sessions/claude.ts and scanner-utils.test.ts; sanitized adapter fixtures;
openspec/research/agent-architecture-evidence.md; this contract and data-model.md.
Existing native identity types and storage suffice; no new tables or routes.
Claude sidechain rows carry the parent sessionId and their own agentId. A unique
nonempty agentId on isSidechain=true rows is the child session identity. The
parent sessionId becomes parent_session scoped to that agentId; it must not
also be emitted as the child's session identity. Conflicting/missing identifiers
remain incomplete and must not create a resolved parent relationship.

When explicitly scanning Claude, an existing identity snapshot older than parser
version 3 must be refreshed even if the source fingerprint is unchanged. This
uses trace_identity_sources.parser_version, not a new table or eager startup scan.
After refresh, unchanged scans remain write-free.

## Architecture r4 P1 native scope

User authorized continuous P1–P7 delivery on 2026-10-30; routine stage confirmation
is no longer required. OpenCode real-record work and the disclosed P0 performance
investigation remain deferred. Each stage still has its own checks and commit.

`FoldingNativeScope` selects optional provider (`claude` or `codex`), exact project
working directory, inclusive ISO UTC `from`/`to`, or `taskIds` (1..40 unique collected
root task IDs). Filters intersect. Missing filters mean all retained collected
roots, bounded at 40; excess is an explicit error, never a silent partial sample.
`createNativeScopeCollector(db).collect(scope, signal?)` returns FoldingProject;
`close()` drops its cache. No execution, model calls, new tables or HTTP routes.
Scope builder lives in server/agent-folding/native-scope.ts with adjacent tests.

Read retained task membership and source locations, then stream existing local
JSONL on explicit collection. At most 32MiB of source bytes per collection;
existing project limits also apply. Cancellation and source changes fail the read.
Cache at most 8 scopes, keyed by canonical scope, database data_version plus
connection total_changes and source size/mtime. Never silently reuse a stale read.

Claude Agent/Task calls use unique tool-use IDs and result-row toolUseResult.agentId;
Codex spawn_agent calls use call_id and the returned agent_id. Only a uniquely
resolved child with the declared parent counts as a confirmed target. Missing
results remain traffic with an explicitly unknown definition and a limitation.
Definition identity is provider plus declared subagent_type (Claude), or child
session metadata agent_role/thread_spawn.agent_role (Codex); unknown definitions
are isolated by task and call instead of merged by display name. Main loops merge
only within a provider. Every unique delegation supplies one traffic row with
traceId=root task ID and an exact caller sessionKey/eventId evidence locator.
Unknown duration and input token values stay null. No task outcomes are invented.

A delegation present on disk but absent from retained event identities fails with
a refresh-scan requirement; source text must not produce an invented event locator.
Repeated retained instances of the same native tool-call ID use the earliest
matching input event as their locator while counting the delegation once.

P1 validation observations also extend openspec/research/agent-architecture-evidence.md.

## Architecture r4 P2 decisions

FoldingAction adds `insufficient`; it is an audit result, never an executable run
operation. Existing native member-only inventories use insufficient for non-main
members until independent context evidence is supplied. No model execution.

`FoldingRuleEvidence`: agentId:string; sampleCount:number; codeSupported:boolean;
traceSupported:boolean; inputTokens:number|null; returnTokens:number|null;
parallel:boolean|null; independentVerification:boolean|null;
filteringSuffices:boolean|null; skillCannotResolveConflict:boolean|null;
talksToUser:boolean|null; externalControl:boolean|null;
mergeCandidate:{agentId:string,coupling:number,share:number}|null;
counterEvidence:string[]; evidenceIds:string[]. Booleans are explicit evidence,
not guessed from names/teams/personas/prompt length/tool count/fixed steps.

`FoldingRuleThresholds`: version:string (default architecture-r4-1), minSamples:2,
largeInputTokens:10000, inputReturnRatio:10, minCoupling:0.5, minShare:0.05.
These are configurable heuristic defaults, not formulas attributed to the article.
`FoldingRuleDecision`: agentId; action:FoldingAction; mergeWith:string|null;
confidence:'high'|'medium'|'low'; sampleCount; thresholds:FoldingRuleThresholds;
reasons:Array<{rule:string,met:boolean|null,value:number|null,threshold:number|null}>;
counterEvidence:string[]; evidenceIds:string[]; ownerQuestions:string[].

Rules: main stays main. Explicit multi-turn direct-user dialogue or external
control protects keep. Adequate supported samples permit as_tool for large input
and ratio when filtering does not suffice, observed parallel/independent verification,
or explicit skill-unresolvable conflict. A qualifying merge candidate is considered
when no independent-context reason is met. Otherwise fold is the default when
samples/support are adequate; missing samples/support means insufficient.
Confidence: code+trace high, either medium, neither low. Counter-evidence is always
retained, never converted to a success grade. Missing skill-conflict assessment
produces an owner question. Implementation: src/core/agent-folding-rules.ts and
adjacent tests; types/validation, native.ts/native-scope.ts, workbench action labels.

`decideFoldingInventory(project, overrides?)` derives rule evidence from retained
traffic counts, source-kind evidence and explicit inventory declarations, returning
FoldingRuleDecision[] without mutating the project. It never interprets tool count,
name/persona or prompt length as isolation evidence. Missing per-call return-token
measurements keep the volume ratio unknown. Scope proposals use these decisions;
full reasons remain available through the shared rule function for P6 rendering.

## Architecture r4 P3 kit parity

Implementation files: src/core/agent-folding-kit.ts and adjacent tests,
scripts/kit-parity-golden.mjs, src/core/__fixtures__/agent-folding-kit-golden.json;
existing analysis/types and tests integrate the same functions. Apache-2.0
algorithm attribution is retained. Golden values come only from the pinned
Python scripts, never from TS. Tests require no Python.

`FoldingKitResult`: prompt_id:string; status?:string; grade?:Record<string,number>;
latency_s?:number|null; in_tokens?:number|null; out_tokens?:number|null;
model_calls?:number|null; by_agent?:Record<string,{calls?:number,input_tokens?:number}>;
actions?:Array<{name:string}>. Missing metrics remain null. Failed harness rows
are excluded from kit calculations, separately retained in original diagnostics.
`FoldingKitTrace`: trace_id:string; ts:string|number; agent:string;
duration_ms?:number|null; input_tokens?:number|null.

`kitCoupling(traces, {exclude?,minCoupling?,minShare?}?)` returns the Python JSON
shape: traces,calls,first_ts,last_ts; volume[{agent,calls,trace_share,median_ms,
time_share,median_input_tokens}]; sequences:[string,number][];
pairs and candidates [{first,then,traces,rarer,rarer_traces,coupling,share}].
Default thresholds .5/.05. Coupling denominator is the smaller number of traces
visiting either agent. Calls are ordered by timestamp; native null timestamps
use retained sequence for ordering, with no invented measured time.

`kitCoverage(traces, results, {exclude?,minTraces?,agents?}?)` returns
{traces,tasks,chains:[{chain:string[],traces,share,covering:[{caseId,passes,reps}]}],
status:'covered'|'gaps'|'no_chains'}. Default minTraces=2. Chains are sets;
representative order is first observed. by_agent is unioned across each task's
non-error rows. No chains is never a claim of coverage.

`kitCompare(before,after)` returns {common:string[],onlyBefore:string[],
onlyAfter:string[],before,after,worse:string[],better:string[],
writesChanged:[{caseId,before:string,after:string}],
status:'missing_tasks'|'worse'|'mixed'|'holds'}. Each summary contains
score:number,perCase:Record<string,number>,latency_s,model_calls,in_tokens,out_tokens
(number|null). Scores are task-weighted; other means are row-weighted.
Missing grades/nonfinite grades and no common cases fail explicitly. Actions
compare sorted names per repetition, independent of full-argument diagnostics.
No cost is shown without explicit prices.

`kitEstimate(results,{tasks?,reps?,heavy?,only?}?)` returns
{tasks,reps,covered,rows,input:{low,high,likely},output:{low,high,likely}};
token numbers are unrounded numbers or null. Full coverage uses sum of case means
times reps. Partial probe input bounds use smallest/largest measured case;
output has no upper bound with multiple probe tasks; a single probe has only a
conditional likely value, not an asserted upper bound. `kitRoundEstimate` formats
the Python two-significant-digit, ties-to-even display. Existing whole-experiment
estimate multiplies shared per-version totals by planned variants, retaining its
provenance/model safeguards and unrounded budget figures.

FoldingExperimentAnalysis adds `kitComparison` (kitCompare result or null when
unscored/no common cases) and `kitCoverage` (kitCoverage result or null when no
by_agent measurements). Existing coverage and adoption blockers remain distinct
ordered/per-repetition diagnostics. No persisted schema or new route.

## Architecture r4 P4 kit interchange and read-only CLI

Files: src/core/agent-folding-interchange.ts + tests; server/agent-folding/cli.ts
+ tests and artifacts.ts; docs/agent-folding.md. No table or schema migration.
`buildKitArtifacts(project)` returns FoldingArtifact[] with traces.jsonl,
inventory.tsv, PLAN.md and results/<experiment-id>/<variant-id>/results.jsonl.
Safe encoded path segments prevent traversal. JSONL rows use FoldingKitTrace and
FoldingKitResult; missing grade stays omitted with status unscored/error.
Original call sequence is exported as numeric ts only when time is unknown;
README/PLAN explicitly distinguishes sequence ordering from measured time.
Exported results retain observed by_agent and action names, never invent them.
Only measured/official/user-import grades can be exported as scored.

`parseKitResults(lines:Iterable<string>)` validates and normalizes bounded JSONL
records (<=4000 rows, <=8MiB), accepting prompt_id/id/case_id aliases and kit fields;
extra prose is discarded. Finite nonnegative usage/latency, finite grade values,
<=32 agent records and <=64 action names per row. Duplicate task IDs differing
only in report escaping are rejected by comparison. Error rows remain retained.
`parseKitInventory(text)` returns rows {agent,owner:string|null,talksToUser:boolean|null,
action:FoldingAction,mergeWith:string|null,evals:string|null}; recognizes all pinned
headers and verdict aliases as-tool/as_tool, merge:<agent>. Unknown names or
merge targets fail when applying to a project. `applyKitInventory(project,rows)`
returns a validated cloned project updating only owner/dialogue/proposed decisions
and adding user-supplied eval mappings to an independent `FoldingKitImport` result.
It never upgrades source provenance or measurement confidence.
`parseKitPlan(text)` extracts checkbox progress [{text:string,done:boolean}] only;
all remaining Markdown is inert. `FoldingKitImport` = {project:FoldingProject,
evalsByAgent:Record<string,string|null>,progress:Array<{text,done}>,
variants:Record<string,FoldingKitResult[]>}. This is an in-memory/import-export
workspace, not a new database table. Main remains main; non-main cannot become main.

CLI: `telemetry-agent-folding <coupling|coverage|compare|estimate|export>
--db <existing sqlite> [--scope <scope.json>] [--before <results.jsonl>]
[--after <results.jsonl>] [--reps <positive integer>] [--output <new directory>]`.
All five open SQLite readonly and collect existing scoped native records;
coverage/estimate require --before; compare requires --before and --after.
No scanning, capture, evaluator, driver or model execution. JSON output to stdout;
export alone writes review artifacts into a new directory, exclusive creation,
never overwrites files. Existing plan validation and --execute semantics unchanged.
Input JSONL is streamed. Abort/close cleanup releases collector and database.

`kitLines(text)` is a bounded line iterator for browser text inputs;
`projectKitTraces` and `projectKitResults` are the shared adapters for analysis,
export and CLI (agent-folding-analysis.ts integration). Native collection rejects
empty scopes and mixed-provider scopes explicitly: each audit project retains
one provider's main-loop identity. Choose the tool filter before auditing across
many roots; cross-tool architecture ranking is outside r4. Native-scope.ts/tests
are included for this validation clarification. Import progress overflow fails,
not silently truncates.

## Architecture r4 P5 metrics and reports

Files: server/agent-folding/run-metrics.ts + tests;
src/core/agent-folding-{metrics,report}.ts + tests; benchmark accounting/types/
validation + tests; compare-report.ts shared HTML shell; fixture JSON under
src/core/__fixtures__, user-supplied docs/agent-architecture/data/*.md.

`FoldingMetricRun`: {id:string,taskId:string|null,run:BenchmarkRun,
expectedTests:number|null,labels:FoldingMetricLabels,architecture:{subAgents:number|null,
delegations:number|null,linkedDelegations:number|null,subagentTokens:number|null,
mainWaitMs:number|null},recorded?:Partial<BenchmarkMetrics>&{cacheCombined?:number|null,
reportedTokens?:number|null,reportedCacheHit?:number|null},limitations:string[]}.
Labels: productMode,environment,model,definitionFingerprint,instructionFile,
toolPermissions,acceptanceSource,cliVersion,caseId,host,qualitySource,qualityScope
(all string|null); ttftSource:'proxy'|'reported'|'unknown'. Recorded values are
explicitly imported per-run aggregates, never synthetic spans or raw conversations.
They do not override corrected tokens/hit/cache-read/cache-write accounting.

`foldingRunMetrics` calls benchmarkMetrics/correctedUsage, then supplies recorded
aggregate values and derived uncachedInput,tokensPerPassed,warningsPerKloc,
modelShare,toolShare,otherShare,subAgents,delegations,subagentShare,mainWaitMs,
linkCompleteness. Derived unknowns remain null; overlapping model/tool sums do
not imply disjoint wall-clock shares (negative residual => all three unavailable).
Native TTFT/TPOT require exact call-bound proxy evidence; reported aggregates are
labelled reported and never presented as proxy measurements.
`foldingComparison(a,b)` accepts 1..40 runs/group and returns {rows,changes,
confounded,limitations,regressions}. Each row {key,label,section,a,b,comparable,
reason,delta,ratio}; summary {n,mean,median,min,max,cv,single,variable} uses
benchmarkStats; variable iff CV>30; single iff n<2. Delta/ratio compare medians;
zero denominator => null. Unknown or mixed token conventions, timing source, or
quality scanner/scope makes those rows incomparable. Confound dimensions are the
eight identifiers in r4 §4; missing metadata is a limitation, never sameness.
Per-case flips require verdict.cases in every run; otherwise explicitly unknown.

Report order: quality, responsibilities, chains, process/timing, tokens/cost,
per-run details. HTML reuses compare-report.ts's new shared static shell;
Markdown/HTML/CSV escape all user text (CSV also spreadsheet-formula prefixes).
No session body, prompt or generated answer in reports. No price => no cost.

`collectFoldingMetricRun(db, taskId, project, signal?)` reads only existing members
and bounded source metadata, returns FoldingMetricRun for root+all linked children.
No new SQL table. Explicit columns, cached statements, <=2000 model/tool spans
per task; exceeding bound is an explicit error. Raw JSONL is streamed up to32MiB
per task. Claude usage is last snapshot per message.id; Codex cumulative totals
use the last token_count snapshot. Missing fields stay null. Measured source
inclusion flags come from P0; counts remain unavailable when source evidence is
missing, not guessed from legacy zero counters. Original per-event duration
inference does not become measured latency. Exact proxy matches reuse existing
linked-execution metadata; no capture is started. Unknown acceptance and runtime
configuration remain unknown. No raw file contents are returned or committed.

Metric diagnostics expose configurable `FoldingMetricThresholds` with version
`architecture-metrics-r4-1`, durationToleranceMinutes=.11, duplicationPct=30,
toolAvgSeconds=3. These only flag aggregate-data review hints and are not article
formulas. `foldingDataIssues(item,thresholds?)` retains the version in its notes.
The r4-defined CV>30% flag remains the specified fixed reporting convention.
Raw reported combined-cache/total/hit columns remain in per-run report details,
separate from corrected metrics. Source-file/database revisions are checked before
returning native metrics; a concurrent source change requires refresh.

## Architecture r4 P6 task-center integration

TaskMode adds architecture. TaskRoute optional overview:boolean, compareA:string[],
compareB:string[],compareImport:boolean. URL uses overview=1, repeated a/b values,
compareImport=1 for a client-local report transfer. Groups contain 1..40 unique
collected/imported task refs each, <=1024chars/ref; overlapping/malformed groups
are discarded, never truncated. Native compare API accepts collected refs only.
Up to40 selected tasks form A or B; groups cannot overlap. Keyboard checkbox
selection and Shift contiguous selection; route survives reload for native groups.

New UI files src/components/agent-folding/TaskArchitecture.tsx,
ArchitectureCompare.tsx, architecture-client.ts and adjacent tests, shared CSS.
TaskWorkbench starts one owned local audit read for an opened collected task,
renders it only in architecture mode. Existing ArchitectureDiagnosisPanel moves
there unchanged. Overview drawer uses explicit scope selection, exposes inventory,
rule evidence and source locators, coupling/chain gap imports and kit files.
Inventory/PLAN/results import is client-local and bounded. Reports use shared P5
functions. No top-level menu. Task-route.ts + tests, TaskWorkbench + tests,
server/server.ts and agent-folding-routes.ts + tests integrate projections.

BenchmarkCenter and TeamExperimentCenter retain their existing entry points,
adding "在任务中心对比" links. Bounded validated report transfers use sessionStorage
key agent-architecture-comparison; URLs contain only compareImport=1, with a
visible temporary-import notice. Canonical `benchmarkToFoldingRuns(report)` and
`teamExperimentToFoldingRuns(report)` adapt retained declarations; missing flags,
scanner, original evidence and metadata stay unknown. No synthetic timing spans.
Source warnings and synthetic provenance remain visible. All P5/P6 additions
stay inside agent-folding and existing benchmark/task modules.

P6 result transfer stores only a validated existing BenchmarkReport or
TeamExperimentReport in sessionStorage (8 MiB max); the task comparison view
revalidates it and adapts runs in memory. It never persists session bodies.
The view offers explicit variant A/B selectors; synthetic status stays visible.
Benchmark labels use declared variant configuration, verdict metadata and report
fingerprints. Unknown scanner scope and telemetry source remain unknown.
Read-only scope/compare jobs have a separate pool of at most four owned requests;
they do not block the existing single smoke/native job slot.
P6 local inventory edits use existing owner/talksToUser/externalOwner fields and
are exported through kit files. Threshold controls reuse FoldingRuleThresholds;
a user edit uses version architecture-r4-1-user and does not modify defaults.
Overview scope applies the list's provider/time and explicit cwd/task selection.
