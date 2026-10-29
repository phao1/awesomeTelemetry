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
full action name+arguments and failed checks. Do not union agents across reps
or ignore order when checking a chain. Distinguish chain occurrence from a
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
