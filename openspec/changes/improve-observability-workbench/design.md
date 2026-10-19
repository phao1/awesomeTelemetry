## Context

See proposal.md. Base commit `f424c2d`, branch `codex/observability-ui`, separate
managed worktree. The 204 non-ignored changed source/document files from the
fusion working snapshot were mechanically copied and SHA256-checked (3357012B).
The original worktree and main remain unchanged; inherited changes are not new
frontend delivery. Baseline manifest is `/tmp/awesome-telemetry-observability-ui-baseline-20261017.json`.

## Goals / Non-Goals

Goals: a complete usable, understandable and visually coherent workbench across
all existing features, with purposeful motion and evidence-first investigation.
Non-goals: backend rearchitecture, new capture certification, automatic model
requests, cloud dependencies, animation libraries or fabricated Team messages.

## Decisions

1. Keep the existing React SPA and App-owned state. Preserve six-view navigation,
   local hash identities, lazy command palette, native/proxy separation and
   right-side evidence inspection. Improve task flow rather than replace it with
   a marketing dashboard. Team stays in the existing task/run exploration model.
2. Retain the contract teal palette and semantic colors, system fonts, token-only
   styles and constant virtual row sizes. Create hierarchy with surfaces, borders,
   typography and grouped controls, not card shadows or decorative gradients.
3. Motion uses existing 80/160/240ms tokens and only approved composited/color
   properties. No transitions inside virtual-scroll containers; no width/height
   animation. Reduced-motion remains a global hard override.
4. Reference research checked 2026-10-17: [dsh trajectory](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-trajectory/README.md)
   informs Turn/Step ledger and on-demand record detail; [Langfuse](https://langfuse.com/docs/observability/overview)
   informs LLM context/usage/tool evidence presentation; [SigNoz](https://signoz.io/docs/userguide/span-details/)
   informs linked selection, error navigation and operation detail. Reimplement
   interaction ideas independently, without importing their stacks or promising
   their scalability/performance. No broad source copying.
5. Desktop/local SPA, not SEO-driven. Targets: LCP2500ms, INP200ms, CLS0.1 p75
   on the primary desktop; existing initial HTML+preloaded JS<200000B gzip and
   total CSS<16KB gzip remain hard budgets. Target Lighthouse performance>=90,
   accessibility>=95; WCAG AA, with implementation/audit owned by this task.
   Field p75 and Lighthouse scores are not claimed from one local screenshot.
6. New worktree reserves UI5193/backend4193/proxy7793. Do not copy credentials,
   production captures or application DBs. A read-only preview may explicitly
   target the existing4183 API; any mutating acceptance uses an isolated backend
   and data store. No startup monitor or automatic paid requests.

## Implementation batches and whitelists

Planning: this change's `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`,
`specs/observability-workbench/spec.md`, `implementation.md`; root
`.worktree-ports.json`. Baseline copy is separate from implementation edits.

Batch1 foundation whitelist:
- `src/components/AppShell.tsx`, `src/components/AppShell.test.tsx`
- `src/components/ui/Tabs.tsx`, `src/components/ui/Tabs.test.tsx`
- `src/App.tsx`, `src/i18n.ts`
- `src/styles/layout.css`, `src/styles/components.css`,
  `src/styles/components/workbench.css`, `src/styles/workbench.test.ts`
- `vite.config.ts`

Batch1 interaction closure (explicit focus ownership and integration evidence):
- `src/components/ui/Modal.tsx`, `src/components/ui/modal.test.tsx`,
  `src/components/ui/focus-trap.ts`
- `src/components/CommandPalette.tsx`, `src/components/CommandPalette.test.tsx`
- `src/App.test.tsx`
- `src/styles/components/overlay.css` (entry-only modal/drawer motion, outside
  virtual rows; reduced-motion hard override remains binding)

The palette requests its search field as the initial focus target; other dialogs
keep their existing safe first-control default. Focus must return to the actual
trigger, remain in the top overlay, and survive callback/parent rerenders.
Nested tab lists must have unique IDs; do not emit `aria-controls` references
to panel elements that do not exist. Navigation still uses existing view keys.

Batch2 session discovery whitelist:
- `src/components/SessionList.tsx`, `src/components/SessionList.test.tsx`
- `src/components/SessionStart.tsx`, `src/components/SessionStart.test.tsx`
- `src/App.tsx`, `src/App.test.tsx`, `src/i18n.ts`
- `src/styles/components/session.css`, `src/styles/components/workbench.css`
- `openspec/specs/frontend/spec.md`

Keep server-owned filters and fixed 44px rows. Distinguish empty/error/loading,
offer reset-to-all filters, retain an explicit reopen control when collapsed,
make ordinary row selection keyboard operable, and expose existing Team runs
within task exploration (not a seventh global tab). Ignore stale list responses
after a newer filter/request; no extra body reads or duplicate session store.

Subsequent feature batches must add exact file lists here before editing. No
other copied baseline source is implicitly open for changes. Tests stay next
to source; use real components/state behavior, never mock the logic under test.

Batch3 trace investigation whitelist:
- `src/App.tsx`, `src/App.test.tsx` (new-session selection must not reuse an
  unrelated run's Turn/event focus; explicit hash restore still takes precedence)
- `src/components/trajectory/InvestigationToolbar.tsx`, `InvestigationToolbar.test.tsx`
- `src/components/trajectory/RecordInspector.tsx`, `RecordInspector.test.tsx`
- `src/components/trajectory/investigation-test-fixtures.ts`
- `src/components/trajectory/TrajectoryPane.tsx`, `TrajectoryPane.test.tsx`
- `src/components/trajectory/TurnList.tsx`, `TurnList.test.tsx`, `TurnCard.tsx`
- `src/components/trajectory/MessageCard.tsx`, `MessageCard.test.tsx`
- `src/cache/event-detail-loader.ts`, `event-detail-loader.test.ts`
- `src/cache/lru.ts`, `lru.test.ts`
- `src/components/SessionToolbar.tsx`, `SessionToolbar.test.tsx`
- `src/components/ScanTimingCriteria.tsx`, `ScanTimingCriteria.test.tsx`
- `src/i18n.ts`, `src/styles/components/trajectory.css`,
  `src/styles/components/session.css`, `src/styles/workbench.test.ts`
- `openspec/specs/frontend/spec.md`

Add a bounded loaded-metadata operation finder, explicit-error navigation and
longest retained interval entry, linked to the owning Turn and an additive right
record inspector. Do not revive the legacy Gantt/EventInspector or remove inline
reading. The inspector loads only its selected event; concurrent surfaces share
one in-flight request, and cache invalidation cannot be undone by stale promises.
Keep measured/derived/unknown time declarations explicit; positive duration is not
proof of model latency. Fold long explanations behind a short visible scope line,
keeping incomplete/partial warnings visible. No new HTTP/data-model field.

Batch4 evidence/quality semantics whitelist:
- `src/App.tsx` (pass authoritative detail pagination to the toolbar)
- `src/core/turn-model.ts`, `src/core/turn-model.test.ts`
- `src/components/trajectory/MessageCard.tsx`, `MessageCard.test.tsx`
- `src/components/trajectory/TrajectoryPane.test.tsx`
- `src/components/SessionToolbar.tsx`, `SessionToolbar.test.tsx`
- `src/components/SessionVisuals.tsx`, `SessionVisuals.test.tsx`
- `src/i18n.ts`, `src/styles/components/session.css`,
  `src/styles/components/trajectory.css`
- `openspec/specs/frontend/spec.md`
- `openspec/changes/add-trajectory-inspector/design.md`,
  `openspec/changes/add-trajectory-inspector/specs/frontend/spec.md`

Observed CodeArts step-finish usage/error carriers are retained as kind=agent
by the existing adapter; neither that kind nor its legacy actor="subagent"
proves delegation. Preserve all source events/usage/Raw and backend behavior.
Derived messages use the existing neutral system role for generic agent events,
labelled "Agent record"; only explicit subagent_prompt retains the subagent role
and badge. No new enum, relationship, Agent count or inferred execution edge.
This intentionally supersedes the old trajectory D4/D8 assumption that every
agent-kind event was a subagent; actual hierarchy/session evidence is unchanged.

Toolbar ratios follow existing metrics REQ-004: verify-phase event count / step
count and error-step count / step count. Name those observed ratios explicitly,
never measured correctness/stability. Incomplete pages or zero steps show no
whole-run ratio, with loaded scope and formulas accessible beside the values.
Unknown pricing remains unknown through the existing formatter; the pending
pricedSessionCount contract decision does not block this non-monetary correction.
The optional session radar remains a fixed-reference log profile, not an Agent
capability/quality score. Label actual total tokens (not context length), retained
wall-clock/rates and inverted error-event share; show original values and the
formula/direction beside the plot. Omit event-derived axes for incomplete pages
and the error axis with unknown statuses, rather than drawing invented scores.
No persisted numeric algorithm or pricing/overview contract changes in this batch.

Batch5 comparison workflow whitelist:
- `src/components/CompareBoard.tsx`, `CompareBoard.test.tsx`
- `src/components/CompareRunEvidence.tsx`, `CompareRunEvidence.test.tsx`
- `src/components/CompareVerdict.tsx`, `CompareVerdict.test.tsx`
- `src/components/CompareHeroHeader.tsx`, `CompareHeroHeader.test.tsx`
- `src/components/CompareDimensions.tsx`, `CompareDimensions.test.tsx`
- `src/api/client.ts`, `src/api/client-compare.test.ts`
- `src/App.tsx`, `src/App.test.tsx`, `src/i18n.ts`
- `src/styles/components/compare.css`, `src/styles/workbench.test.ts`
- `openspec/specs/frontend/spec.md`

Give each requested L/R pair owned cancellation/deadline and one automatic read
on explicit pair selection. Failures never auto-loop; retry is explicit. Hide old
results immediately on pair change/reload, reject late responses and abort on
unmount. Locale/parent rerenders must not issue another comparison request.
Picker identity includes L/R, title, provider/source and ID, with keyboard focus,
clear empty/no-match states and no implicit per-session detail reads.

Show comparison source/model/page coverage and unproven task/tool/config/quality
equivalence before derived views. Reuse loaded metadata for bounded error/longest
interval locators that open the actual run/record. No body fetching on summary
render, fabricated timing/quality winner, billing sum or external API field.
Replace the old overall wins/losses bar with descriptive observations, preserving
guarded wall-clock side values/ratios. This intentionally supersedes legacy
frontend styling/tests that required a score despite absent correctness evidence.
Compare can return5000slim events while an ordinary run initially reads2000.
An explicit selected-event jump bypasses an insufficient cached page and reads
that one run at the existing5000cap, so a retained locator beyond the initial
page is actually reachable. It never injects an older comparison snapshot into
the live run cache or fetches unrelated event bodies.
The broader comparison task stays open until all KPI/chart/detail and selected
call paths have been audited, not just this pair-request/summary batch.

Batch6 comparison detail investigation whitelist:
- `src/components/CompareKPI.tsx`, `CompareKPI.test.tsx`
- `src/components/CompareCharts.tsx`, `CompareCharts.test.tsx`
- `src/components/compare-stats.ts`, `compare-stats.test.ts`
- `src/components/CompareBoard.tsx`, `CompareBoard.test.tsx`
- `src/i18n.ts`, `src/styles/components/compare.css`
- `src/styles/workbench.test.ts` (comparison chart column/readability guard)
- `openspec/specs/frontend/spec.md`

Make retained error and top-token records exact, keyboard-accessible run/event
locators via the existing App callback. Summary render/expansion performs no body
IO. Counts explicitly describe loaded events; incomplete/no-step/unknown-status
ratios remain unavailable, with existing step denominators. Numeric deltas are
descriptive R-minus-L values, not Agent winners. Keep six primary summaries and
fold additional activity metrics rather than removing them. The radar becomes
an observed-magnitude profile, with raw values/scales inspectable and missing or
partial axes omitted, never replaced with favorable zero. No new price/currency
field, aggregate, API, persisted metric algorithm or source mutation. Existing
monetary formatting is outside this batch pending the contract-field decision.
Expanded KPI evidence occupies a full grid row rather than a narrow metric cell;
close/Escape restores focus to its exact trigger. With fewer than three usable
profile axes, preserve the raw-value table rather than draw a degenerate polygon.

Batch7 consistent comparison token/timing presentation whitelist:
- `src/components/ContextBar.tsx`, `ContextBar.test.tsx` (retained section
  heading on anchor navigation and reduced-motion-aware scrolling)
- `src/components/CompareTokenUsage.tsx`, `CompareTokenUsage.test.tsx`
- `src/components/CompareCharts.tsx`, `CompareCharts.test.tsx`
- `src/components/CompareSpeedMetrics.tsx`, `CompareSpeedMetrics.test.tsx`
- `src/components/charts/DonutChart.tsx`, `DonutChart.test.tsx`
- `src/components/CompareBoard.tsx`, `CompareBoard.test.tsx`
- `src/App.tsx`, `src/App.test.tsx` (lazy Agent overview only, with existing
  error/loading boundaries, to preserve the initial-JS budget)
- `src/i18n.ts`, `src/styles/components/compare.css`
- `src/styles/workbench.test.ts` (comparison chart column/readability guard)
- `openspec/specs/frontend/spec.md`

Share one loaded-only token composition for rings/bars, retain native total and
all five recorded components including caches. A system estimate is separate,
never added to the total or used as a cache allocation. Draw composition only
when finite nonnegative parts reconcile exactly to a positive native total;
otherwise retain raw observations and explain non-additive/unknown coverage
without guessing the adapter's missing reasoning semantics. Each ring represents
its own total and uses its actual radius. Only supported text classes activate
the existing explicit text inspector; cache segments are noninteractive.
Preserve existing explicit source access, no body fetch on chart render.
Timing/detail differences are descriptive, not Agent winners; retain independent
clock guards and incomplete-event limitations. No monetary fields or algorithm
changes. Composite4.2 remains open until its remaining source/detail paths and
currency coverage decisions are verified, not merely this batch's tests.
Rendered evidence found four narrow chart columns at1280px; use token-based
minimum readable widths and min(100%,...) containment so the actual value tables
remain readable at wide/narrow desktop sizes. Reuse existing surfaces and motion
constraints; do not shrink text or hide observations to fit more columns.

Batch8 administration entry whitelist:
- `src/components/SettingsModal.tsx`, `SettingsModal.test.tsx`
- `src/components/FridaView.tsx`, `FridaView.test.tsx`
- `src/components/ProxyView.test.tsx` (only the legacy Frida empty-state case:
  replace unsupported installation/platform inferences with stronger independent
  unknown-state/explicit-prerequisite assertions)
- `src/api/client.ts`, `src/api/client-admin.test.ts`
- `src/App.tsx`, `src/App.test.tsx` (view loading boundaries only if needed)
- `src/i18n.ts`, `src/styles/components/workbench.css`,
  `src/styles/workbench.test.ts`
- `openspec/specs/frontend/spec.md`

Use the shared focus-trapped Modal for settings, separate immediate local display
preferences from explicit persisted scan-provider edits, retain all contract
config fields and show loaded paths/source/watch metadata. One5s owned load,
explicit retry/reload, draft/unsaved/dirty-close handling, one10s owned save,
success/failure/uncertain outcome without auto retry. Unmount/locale/parent
rerenders cannot duplicate reads/writes or let late results restore old state.
Pass AbortSignal through existing client routes; do not change API payloads.
Browser checks only inspect/cancel; no user configuration writes.

Frida API routes are wired, contrary to the old frontend REQ-021 note. Runtime
status has no host-platform/installation/readiness field; do not invent one or
infer readiness/absence from an empty history. Preserve explicit experimental
start/stop, label prerequisites and incomplete persistence/Windows acceptance,
validate optional PID, require deliberate prerequisite acknowledgement, and show
owned loading/action/error/uncertain states with stop confirmation. No actual
Frida process or platform/trust/config changes during browser acceptance. TraceLog
import and whole5.2 remain separately open until their workflows are verified.
Source inspection also found the contractual single-capture GET is not registered
by the current service. Keep the detail drawer requirement open; do not expose a
fake raw/size/detail action or add a backend implementation to this UI-only batch.
Status and history have independent5s read ownership/retry; commands have10s
ownership, stop confirmation, explicit wait cancellation and uncertain-outcome
recovery. No automatic polling, command retry or Agent readiness claim. Lazy
administration code may use the existing App loading/error boundaries without
removing entry points or changing API effects.

## Risks / Trade-offs

Batch9 user-directed no-money presentation whitelist (2026-10-18):
- `src/components/SessionToolbar.tsx`, `SessionToolbar.test.tsx`,
  `SessionHeaderCard.tsx`, `SessionHeaderCard.test.tsx`
- `src/components/AgentOverview.tsx`, `AgentOverview.test.tsx`
- `src/components/CompareKPI.tsx`, `CompareKPI.test.tsx`,
  `CompareDimensions.tsx`, `CompareDimensions.test.tsx`,
  `CompareBoard.tsx`, `CompareBoard.test.tsx`
- `src/components/MissionControl.tsx`, `MissionControl.test.tsx`
- `src/components/team/TeamShell.tsx`, `TeamShell.test.tsx`,
  `TeamCompareView.tsx`, `TeamCompareView.test.tsx`
- `src/core/compare-report.ts`, `compare-report.test.ts`, `report-html.test.ts`
- `src/components/icons/index.tsx`, `icons/icons.test.tsx`, `src/i18n.ts`
- `src/components/CompareVerdict.tsx`, `trajectory/TrajectoryStatBar.tsx`
  (Token glyph only), `CaptureComparisonPanel.tsx`, `CaptureComparisonPanel.test.tsx`
  (remove the money-only unknown notice; preserve clocks/usage/other warnings)
- `src/components/money-display.test.tsx`
- `openspec/specs/frontend/spec.md` and own planning/evidence documents.

The user rejected the pending costCurrency/pricedSessionCount contract addition
and requested removal of all monetary presentation because unit prices vary.
This supersedes previous monetary UI requirements, not source schemas. Remove
currency/amount columns, totals, price rankings/trends, monetary deltas/derived
claims and generated report summaries across sessions/overview/compare/Mission/
Team. Keep token/cache/call counts, source IDs, original data and API/DB fields.
Mixed Team cost dimensions retain token rows under a Token usage heading, while
totalCostUsd/costGini and their generated verdicts/availability notes are omitted.
No monetary formatter or missing contract field is introduced. Explicit raw
evidence/downloads stay byte/content faithful, including source-reported amounts;
do not redact raw JSON to make a presentation test pass. TraceLog UI work was
inspected but not edited before this higher-priority user change.

- Existing spec drift (font scaling, quality wording, generic agent-step roles)
  → preserve higher-priority contracts, inspect source evidence and write failing
  regressions before semantic corrections; do not hide problems with CSS.
- Feature breadth → maintain one task for each existing area and a workflow
  acceptance matrix; a successful shell batch never closes the whole objective.
- Motion versus large traces → bounded transitions on controls/overlays only,
  retain row measurement/selection and verify large-session behavior.
- Styling regressions across themes/overlays → both-theme screenshots and
  keyboard checks, existing contrast/focus/bundle tests, no blanket overrides.

Batch10 TraceLog administration whitelist (2026-10-18):
- `src/components/TraceLogImportPanel.tsx`, `TraceLogImportPanel.test.tsx`
- `src/components/TraceLogImportPanel.integration.test.tsx` (real component/client/
  HTTP/worker round trip, synthetic bytes, fresh in-memory DB and owned temporary
  original/config/CA paths only; never real provider scan or production upload)
- `src/components/ProxyView.tsx`, `ProxyView.test.tsx` (TraceLog drawer containment only)
- `src/App.tsx`, `src/App.test.tsx` (lazy Team view behind existing loading/error
  boundaries, preserving route/list/SSE semantics and the initial-JS hard budget)
- `src/i18n.ts`, `src/styles/components/workbench.css`, `src/styles/workbench.test.ts`
- `openspec/specs/trace-import/spec.md`, `openspec/specs/frontend/spec.md`
- This change's planning and implementation evidence documents.

Keep the existing lazy Proxy drawer, widened only for this evidence workspace.
Group optional upload, metadata-only session discovery and selected Turn reading;
use compact bounded20-row pages, accurate visible ranges, explicit selection and
right-side evidence rather than an unbounded bottom dump. Each read owns its
identity/generation,5s deadline, cancellation, local retry and stale suppression.
List refresh does not reread a selected Turn; locale/parent/field/font changes
perform no IO. Hide prior session/Turn data immediately when its identity changes.
Use the existing roving Tabs and inert text, preserve exact source downloads and
exporter-reported boundaries. The64KiB preview is UTF-8 bytes, without cutting
surrogate pairs; full field expansion remains explicit within source detail caps.
Upload is explicit/single-flight,120s owned deadline; cancellation/timeout must
release local waiting even when fetch ignores abort. Late results cannot restore
success. An uncertain write blocks another upload until an explicitly refreshed
session page succeeds; failed refresh is not recovery. Keep source/API/DB fields
and routes unchanged. Browser checks reuse retained synthetic imports read-only;
any new end-to-end upload requires an isolated app/data store, never4183.
Whole5.2 remains open while the separately missing Frida detail route/persistence
and full administration acceptance are unresolved. No test-threshold relaxation.
The first populated bilingual build measured200162B initialHTML+all preloadedJS,
above200000B. Defer TeamShell code until its existing task-scoped view opens;
retain all CSS in the total budget, not an initial-only or per-route redefinition.

Batch11 CSS ownership and conservative cleanup whitelist (2026-10-18):
- `src/styles/components/team.css`, new `team-views.css`, `team-compare.css`,
  `agent-collab.css`
- `src/components/AgentCollabReplay.tsx`
- `src/components/agent-collab/TopologyGraph.tsx`, `TopologyGraph.test.tsx`,
  `src/i18n.ts` (existing wide-graph readability and keyboard-scroll entry only)
- `src/components/team/TopologyView.tsx`, `TaskDagView.tsx`, `TeamTimeline.tsx`,
  `CommunicationView.tsx`, `EntityInspector.tsx`, `TeamCompareView.tsx`, `TeamShell.tsx`
- New `src/components/team/token-only-comparison.ts`, `token-only-comparison.test.ts`
  (move the unchanged presentation policy out of a component's stylesheet side effect)
- `src/styles/components/compare.css`, `inspector.css`, `misc.css`, `timeline.css`,
  `trajectory.css` (only individually reviewed orphan rules)
- New `src/styles/style-ownership.test.ts`; own planning/evidence documents.

Keep every presentational component and its styles, including currently unwired
specialized Team views. Attach their existing CSS to their actual feature owner;
do not require navigating to another page first. In particular, task-session
AgentCollabReplay cannot depend on the lazy TeamShell stylesheet. Preserve copied
declarations/order byte-for-byte, and retain any specialized-style override that
also applies to the current inline shell. No automated broad CSS purge based on
one screenshot or naive substring matching. Review orphan selectors against all
source literals/template fragments/dynamic prefixes and owning components before
removing them; preserve active focus, virtual row sizes, scroll/wrap, both themes
and reduced-motion behavior. Existing CSS parser/minifier are analysis-only tools,
not new project dependencies. All edits use apply_patch.

Measure ALL emitted CSS chunks together, including lazy ones. Unwired components
still import their own available styles; no feature is deleted to pass a budget.
If16KiB is still unmet, keep7.2 open and record the actual remaining gap rather
than weakening the limit or substituting initial-route-only CSS. Keep the whole
frontend objective and remaining functional/visual verification tasks intact.
Actual fresh-session inspection found a30-Agent SVG compressed to a thin unreadable
line by max-width:100%, despite the existing horizontal scroll container and SVG
intrinsic dimensions. After verifying the unchanged copy, replace only that rule
with max-width:none; retain original geometry and local overflow. Add a named,
focusable scroll region plus bilingual navigation hint, no zoom/inference/new
graph data or API. Cover CSS and real30-node DOM geometry/focus with regressions
and browser proof. This is an existing6.1 usability repair, not Team acceptance.

Batch12 Agent overview investigation whitelist (2026-10-18):
- `src/components/AgentOverview.tsx`, `AgentOverview.test.tsx`
- New `src/components/agent-overview-model.ts`, `agent-overview-model.test.ts`
- `src/api/client.ts`, new `src/api/client-overview.test.ts` (optional read signal only)
- `src/App.tsx`, `src/App.test.tsx` (exact selected source-group preselection and
  explicit browse-source navigation; no background list/detail fetch)
- `src/components/ui/Table.tsx`, colocated Table tests (optional contextual
  expansion labels and semantic column sort state, preserving other callers)
- `src/i18n.ts`, `src/styles/components/agent-overview.css`,
  `src/styles/workbench.test.ts`
- `openspec/specs/frontend/spec.md`; this change's planning/evidence documents.

Replace the unsupported fastest/frugal/stable verdicts and aggregate tool/s,
accuracy and inverse-error scores with exact session/event/token/group counts.
Do not average group means or fill missing metric values with zero. Keep every
existing per-group raw non-monetary metric available in both view modes and
explain server means, unknown eligible denominators, source/task/clock differences
and overlapping recorded phase intervals. The view reads all-history scan data,
not the currently filtered/paged shared index. The update stamp is a source
invalidation timestamp, not generation time or an Agent-readiness certificate.

Use one5s owned aggregation read with cancellation, explicit retry and late-result
suppression even if the loader ignores abort. Locale/parent/sort/view/expansion
changes never reread. Expose loading/empty/error/cancelled states without
auto-retry/polling; preserve source/API/DB payloads. Numeric missing values sort
last in either direction; string sorting must actually compare strings.

Recent session discovery and tiny event charts reuse only shared loaded metadata,
matching provider AND sourceAgent AND scan source, newest first and at most10.
Label partial/filtered index scope and any per-day UTC chart rather than imply
the entire group's newest sessions or trend. Both table/card modes allow exact
session navigation and explicit source browsing. Contextual expansion/compare
names, normal keyboard activation and local narrow-table overflow remain usable.
Provider comparison additionally passes the two selected sourceAgent identities
to App; never substitute another group or retain an old compare key when a
selected group has no loaded matching session. These are local component props,
not new external fields. No task/quality equivalence or monetary advantage claim.
Rendered inspection also found desktop overflow escaping the fixed app shell
and a table wrapper with no vertical scroll ownership, so its sticky headers did
not stick. Scope overflow to the overview; give the table the remaining flexible
height with a token-based readable minimum, while long definitions/card content
remain scrollable in the overview. Verify the final record is reachable, header
position is retained during table scrolling, and document height stays contained.

Batch13 capture workbench whitelist (2026-10-18):
- `src/components/ProxyView.tsx`, `ProxyView.test.tsx`, new
  `ProxyView.workflow.test.tsx`, `ProxyView.integration.test.tsx`
- New `src/components/CaptureRequestList.tsx`, `CaptureRequestList.test.tsx`,
  `CaptureBodyText.tsx`, `CaptureBodyText.test.tsx`
- `src/api/client.ts`, new `src/api/client-capture.test.ts` (owned signals and
  existing cursor envelope only; no new route or payload field)
- `src/App.tsx`, `src/App.test.tsx` (lazy capture entry, same SSE/source ownership)
- `src/components/ui/Modal.tsx`, colocated modal tests (optional controlled Drawer
  width only; existing focus-trap/overlay behavior stays binding)
- `src/i18n.ts`, `src/styles/components/workbench.css`, `src/styles/workbench.test.ts`
- `openspec/specs/frontend/spec.md`; this change's planning/evidence documents.

Separate one5s status read from one5s metadata page read, with local errors,
explicit retry/cancel and late-result suppression. Preserve later SSE evidence
across a pending snapshot; do not create a start timestamp or zero unknown count.
One12s start/stop wait is single-flight; validate an optional decimal1..65535
port, require safe-focus Stop confirmation, and treat timeout/cancel as uncertain
backend work. Only explicit status recovery or later runtime evidence unlocks
new control after uncertainty. No polling/automatic control retry/model request.

Keep run diagnostics independently labelled from historical total and process-
wide/lifetime resource values. Group setup, controls, read-only capture discovery
and secondary administration rather than a flat toolbar. The listener is shared;
listening/traffic/transport/parser/original completeness never certify an Agent.
Source inspection confirms global DELETE /proxy/requests is not registered in
the current service or API contract. Its UI semantics are awaiting the user's
choice; do not invent or implement a bulk-deletion endpoint in this UI batch.

Use existing50-row cursor pages on explicit load-more, append metadata without
dropping prior pages, preserve SSE snapshot races and never fetch per row. Window
render at the existing28px event-row token, with bounded overscan and a clear
loaded/filter scope. Method/status and hostname/URL/request/model search operate
only on loaded metadata; unknown status stays distinct. URL, protocol/model and
network/WS connection interval labels must be readable. Size has no list field:
do not invent one or load bodies for it; explain that selected details expose it.
Keep original-key selected navigation, native keyboard controls and focus return.

Selected request reads own5s timeout/cancel/generation; retain all deletion,
reparse, association, comparison and WS call-chain guards. Widen the right Drawer
with optional controlled width and accessible mouse/keyboard resizing; no new
persistent setting/API field. Body text remains inert, with byte-bounded initial
preview, explicit retained-field expansion and8..28px text-only font controls;
full encoded original download/completeness remains separate. Group maintenance
and export controls without deferring the required deletion-availability check.
Keep both themes/narrow containment, reduced-motion and all emitted CSS budgets.

Browser acceptance reads existing metadata/synthetic retained records only. Any
start/stop/clear/full forwarding acceptance uses a fresh in-memory DB, disabled
providers, temporary config/CA/originals and loopback synthetic origin. No user
monitor/config/trust/source deletion or paid traffic. Initial code may be lazy
behind existing App boundaries; all emitted CSS stays in the hard16KiB total.

Batch14 connection recipe workflow whitelist (2026-10-18):
- `src/components/MonitorSetupPanel.tsx`, `MonitorSetupPanel.test.tsx`, new
  `MonitorSetupPanel.workflow.test.tsx`, `MonitorSetupPanel.integration.test.tsx`
- `src/api/client.ts`, new `src/api/client-monitor.test.ts` (optional owned signals
  and no-store recovery reads; existing routes, payload fields and expectedRevision stay unchanged)
- `src/components/ProxyView.tsx`, `ProxyView.workflow.test.tsx` (local setup
  draft/close and shared-runtime uncertainty coordination, not Clear semantics)
- `src/i18n.ts`, `src/styles/components/workbench.css`, `src/styles/workbench.test.ts`
- `openspec/specs/frontend/spec.md`; this change's planning/evidence documents.

Give the bounded profile list and explicit plan/diagnostic/status/copy reads5s
owned waits, save/delete10s and listener-start/self-test12s. Cancel/timeout releases
local waiting even if a loader ignores abort; unmount, selection and edits revoke
old results. Single-flight ref guards prevent double submission. A failed or
cancelled mutation may have taken effect: preserve drafts, show uncertainty and
require explicit relevant profile/status recovery before another mutation. No
automatic polling/retry/Agent launch. Runtime uncertainty also reaches the parent
shared-listener controls; profile reload is not runtime recovery.

Profile reload preserves the draft and original revision, never silently adopting
new server settings for a write. Missing/changed selected revisions require
explicit review/reselection. Changing a dirty selection or closing a dirty/busy
setup needs a safe-focus confirmation; cancelling a wait does not undo backend
work. Group saved-recipe discovery, essential editable fields, collapsed optional
executable/bypass settings and explicit command/check/self-test actions. Explain
that these are three terminal-process recipes, not all nine scanners, Codex desktop
or CodeArts IDE certification. Keep exact inert commands, both shell variants,
copy feedback, independent diagnostics and synthetic-test limitations. No source
config/credential/system-trust/proxy mutation during browser verification; any
save/start/self-test/delete acceptance uses a fresh isolated backend/temp recipe.
Recovery/profile/plan/diagnostic GETs explicitly bypass browser caching; the current
server's generic JSON sender sets no cache policy. Preserve original IO counts.

Batch15 approved reversible list clear whitelist (2026-10-18):
- `src/components/ProxyView.tsx`, `ProxyView.test.tsx`,
  `ProxyView.workflow.test.tsx`, `ProxyView.integration.test.tsx`
- `src/components/CaptureRequestList.tsx`, `CaptureRequestList.test.tsx`
- `src/api/client.ts`, `src/api/client-capture.test.ts`
- `src/i18n.ts`, `openspec/specs/frontend/spec.md`
- This change's `design.md`, `tasks.md`, `implementation.md` and
  `specs/observability-workbench/spec.md`.

The user approved “清空当前列表”: hide the already-loaded rows in this mounted
view, without any request, original deletion, historical-count reset or listener
change. Place the reversible action beside list refresh, with bilingual scope
and completion feedback; no destructive confirmation is needed. Keep Stop and
per-request original-deletion confirmations unchanged. Remove the unused client
method for the unimplemented bulk DELETE route, not add a backend endpoint.
After clear, move keyboard focus to the now-enabled Refresh list button, including
when a cursor page was pending. Preserve visible search/method/status filters;
a selected method remains an available option even while the list is empty.

Cancel owned pending list reads and reject their late results even if abort is
ignored. Retained parent SSE buffers/updates must not resurrect hidden IDs; newly
observed IDs still appear. Repeated clear accumulates local exclusions. Only a
successful explicit replacement page clears exclusions and restores saved rows;
failed/cancelled refresh retains the hidden state and retry guidance. Reset stale
cursor ownership on clear and preserve explicit append paging/SSE merge after
restore. List GETs bypass browser caching. Unmount/reopen also drops local hiding;
no storage/config field or persisted preference is introduced. Validate no IO on
clear and byte-exact original durability against the actual isolated backend;
the production preview may exercise only this now-proven browser-local action.
This approval supersedes the earlier batches' pending semantics note, not their
no-bulk-deletion boundary or broader Agent acceptance limitations.

## Migration Plan

Batch16 user-requested Team readability scope (2026-10-18):
- `src/components/team/TeamWorkbench.tsx`, `TeamWorkbench.test.tsx`
- `src/styles/components/team-workbench.css`
- `src/components/AgentCollabReplay.tsx`, `AgentCollabReplay.test.tsx`
- `src/components/team/TeamShell.tsx`, `TeamShell.test.tsx`
- `src/components/agent-collab/TaskReplayControls.tsx`, `TaskReplayControls.test.tsx`
- this change's design/tasks/implementation evidence documents.

Replace graph-first reading with an observed-snapshot overview, searchable bounded
member/responsibility and task/status lists, and a linked right detail panel
(existing Drawer on narrow containers). Keep the relationship graph and original
explorers available as secondary disclosures. Selection links only explicit
assignments/dependencies/edges; distinguish structure from communication and
unknown coverage from zero. No new API, body read, dependency, backend mutation,
source rewrite or fabricated state. Keep the existing shared Team hash selection.
Retain the inherited two timing failures and CSS overage as open gates; do not
claim rendered verification while the Mac/browser is locked.

Iterate on this branch without changing the user's existing services. Validate
each batch before continuing; keep inherited baseline changes separate in the
handoff. A rollback stops only owned preview processes and returns to the
untouched fusion worktree; no reset, automatic commit, push or data deletion.


## Batch17 — evidence-based collaboration stage replay

User explicitly authorized continued development and write-producing local tests,
caches, reports and builds on the isolated UI branch. This extends Batch16's
frontend-only scope to CodeArts team normalization, scanner native-link lookup,
and the existing storage body tier; original services and source databases stay
untouched. No commit, merge, deployment or new dependency is part of this batch.

Files: src/adapters/team-codearts{,-replay}.ts and colocated tests;
local-sessions/team-scanner.ts/test; server/storage/team-storage.ts/test;
src/components/agent-collab/StageReplay.tsx/test and stage-replay-model.ts/test;
src/components/AgentCollabReplay.tsx; src/components/team/TeamShell.tsx/test;
src/styles/components/{stage-replay,team}.css; src/styles/style-ownership.test.ts;
and this change's specification/design/tasks/implementation evidence.

Scope parts to root/contact membership before control parsing and metrics; never
assign ordinary work by time proximity or final ownership. Resolve normalized
source events only through exact provider/session/native-scope/callID identities
with a complete manifest and a unique retained event. Original part IDs remain
source evidence, not normalized event IDs. Bump the parser fingerprint so a later
scan can invalidate the prior projection without restarting a service here.

Use existing TeamActivityKind/task/evidence/link/body fields. Publish/assignment/
status/ownership-confirmation/output-read/send-attempt evidence is preserved;
republication is not a second creation, idempotent ownership checks are not new
claims, and finish acknowledgments do not imply result delivery or acceptance.
Missing recipient/delivery leaves communication unavailable. Bodies are bounded,
redacted, fail closed on redaction budget, and read only on explicit expansion;
raw retention remains disabled by default.

Default playback to collaboration checkpoints. Keep all execution turns available
by explicit native-turn grouping; no idle-time or event-count segmentation.
Timed and undated records have separate navigation. Playback advances by step,
not simulated wall time, with pause/previous/next/range seek and interval control.
Current actor/task highlights use the selected event only; final snapshot states
and ownership never become historical facts. Same-time ordering is ambiguous.
The current snapshot remains a separately labelled disclosure. Narrow Team views
reuse one list state and switch list/main surfaces without vertical tab wrapping.
