# Spec: Frontend

The linked execution entry SHALL load only on explicit expansion, with paged
virtualized native-event metadata and accepted capture memberships. Exact shared
identity references, unbound/candidate and incomplete evidence are distinct;
opening one native event/capture loads only its own detail. Relation invalidation
marks the page stale until explicit refresh; old asynchronous results cannot
restore a revoked conclusion. No new router/shell or per-row fetch.

Selected capture Timing SHALL separately label headers/first byte/first content/
network end, explicit SSE/JSON basis, unavailable status and raw vendor timing.
No network-chunk TPS, hidden reasoning or cross-domain speed ratio is invented.
An explicit versioned JSON evidence export uses one bounded local download,
with loading/error/retry/cancel ownership,10s deadline and bilingual limitations.
Deleted bodies may export retained metadata only; a pending/unknown deletion
transition must not allow a late browser download to restore stale analysis.

Monitoring detail includes a lazy protocol-analysis tab: model/protocol terminal state, native usage and accounting basis, declarations, public reasoning/text, proposed tool calls and observed request tool-result history. Analysis is not fetched from lists or until that tab is opened. Display incomplete/legacy/over-limit reasons, unknown counters as unavailable, and observed history/proposals as such (not invented executions). Render observed strings as React text, never HTML.

Capture-metadata and lazy analysis reads SHALL have independent loading/error
and explicit retry controls, owned cancellation and5s timeout. Retry only the
chosen local read; never resend the model request or fetch unrelated bodies.
Clear the prior error before retry, ignore late aborted/unmounted/deleted-body
results and prevent overlapping retries. A successful metadata/analysis retry
must not leave a stale error or infinite loading indicator. Locale changes do
not refetch otherwise-valid evidence. Deletion availability guards remain in
force and analysis stays lazy until explicitly selected.

Monitor lifecycle diagnostics distinguish waiting_for_traffic from capturing and stopping from idle. Show per-run observed/active/pending/persisted/interrupted counters independently of the historical total; activity SSE patches them without status polling or list reload. A failed stop with cleanupPending blocks start and permits retry stop. A stopped-state response is authoritative, never set optimistically before cleanup succeeds. Legacy status payloads remain readable but do not certify Agent readiness.

Capture workbench status and metadata-page reads SHALL independently own5s
deadlines, explicit retry/cancel and late-result suppression. Unknown runtime is
not stopped; controls require a confirmed state. Shared-listener start/stop is
single-flight with12s local wait, valid optional decimal1..65535port and safe-focus
Stop confirmation. Cancellation/timeout is an uncertain backend outcome, not
rollback; recover through explicit status or later runtime evidence, never polling
or automatic mutation retry. Later observed SSE metadata survives older snapshots.

Saved requests SHALL use explicit50-row cursor pagination, append previous pages
and window-render28px native keyboard-activatable rows. Method, HTTP-status and
hostname/URL/model/ID filters apply only to loaded metadata, with unknown status
distinct; never read row bodies for filtering/size or imply a network/WS connection
interval is model inference. Selected detail owns5s read/retry/cancel, an accessible
viewport-clamped resizable Drawer, and inert byte-bounded64KiB initial body text
with explicit retained-field expansion and local8..28px font controls. Original
byte download/completeness and deletion availability remain separate and binding.
Secondary maintenance is grouped, but collapsing it does not defer the required
availability check. Capture and active-stream inventory load only at their own
explicit entries; shared shell SSE and selected live subscription ownership stay
unchanged. User-approved “Clear current list” is browser-local: hide already-loaded
rows in this mounted view without IO, count reset, original deletion or listener
changes. Place it beside list refresh with bilingual scope and restoration
feedback; no destructive confirmation is needed. Revoke owned pending snapshots
and suppress old SSE IDs, while allowing new IDs. Only successful explicit
replacement refresh releases hiding; failed/cancelled refresh retains it. Reopen
also restores saved rows; cursor paging and lazy bodies stay intact. No bulk
DELETE endpoint is added; per-request original deletion retains its confirmation.

> React 19 SPA. Source files: `src/`
>
> Visuals and atomic components: `specs/design-system/spec.md`; numeric
> values: `contracts/design-tokens.md`. This file describes **how the pages
> are assembled, how data flows, and what each view looks like**.
>
> **REQ-001 through REQ-014 are existing numbers whose semantics are
> unchanged** (code comments reference them for traceability). REQ-015 onward
> are new in this design refresh.

## Purpose

A single-page app showing scan session traces, proxy captures, and compare
analysis. `App.tsx` is the only stateful shell.

Product positioning: **the agent observability tool developers most want to
open**. Modeled on GitHub / Linear / Grafana trade-offs — dark first,
information-dense, keyboard-reachable, semantically restrained.

---

## Requirements

User-directed presentation amendment (2026-10-18, supersedes legacy cost/currency
columns in REQ-017/018/019/027): omit all monetary summaries, currency badges,
price coverage, money trends/rankings, monetary deltas and generated HTML-report
amounts. Show Token/cache/call evidence instead; do not equate lower token usage
with quality or a monetary saving. Hide the monetary-only Mission costEfficiency
widget and money parts of mixed model/Team views. Team token rows remain readable
without totalCostUsd/costGini or money-derived verdicts. Backend schemas, API
payloads, raw evidence and explicit original downloads remain unchanged and
faithful; this is presentation removal, not deletion/redaction of captured data.

### REQ-034: WebSocket connection transcript inspection
Selected WS capture SHALL label connection scope, observed message counts,
close codes, AWSP1 download provenance and bounded readable transcripts.
Never label connection lifetime as model inference or count usage across its
possibly multiple turns. HTTP-only reparse/context/protocol controls are hidden
for WS, with bilingual explanation; retained headers/deletion/download remain.
Selected live preview includes WS message prefixes under existing gap/bounds.

### REQ-033: Explicit local capture self-test
Saved connection setup SHALL offer a separate explicit local HTTP/SSE self-test,
warn that it creates one retained synthetic capture, display each verified stage
and a capture-detail action. No automatic execution/polling/retry. Missing listener
and failures have start/check/retry guidance; editing/selection/unmount invalidates
old results. Show actual Agent and HTTPS trust as unverified even when passed.

### REQ-031: Distinct native, scan and network timing
Legacy scan timings SHALL expose formulas, retained session duration declaration
and partial-event evidence without refetching data. Unknown/mixed/native versus
network domains never produce speedup/equality/winner/radar advantages. Preserve
raw side values and existing scan field labels. E2E differences describe session
wall-clock, not model inference or a causal optimization. Apply consistently in
Hero/verdict/KPI/speed/details/dimensions/charts/header and exported reports.
Linked execution SHALL separately display selected normalized native log
duration (per-event measurement unknown) and existing accepted capture network
timing with shared-ID locator limitations, no additional body/metadata reads.
Derived declarations explicitly include scheduling gaps; zero-duration logs
must not imply measured instantaneous tool execution. All copy bilingual and
rendered as text; source invalidation hides stale evidence without polling.

### REQ-030: Explicit versioned offline reparse control
Selected detail SHALL offer expandable bilingual metadata status/current/old
parser+capture-metric versions,parsedAt and explicit refresh/reparse. No reads
before expansion or from list rows,no polling/locale/invalidation refetch. Only
explicit POST revalidates originals; current status alone does not certify file
integrity. Clear old analysis/diff/comparison conclusions at action start; accept
returned analysis only for the same still-available request. Delete/unmount/
invalidation cancels owned requests and hides stale callbacks.10s timeout/cancel
shows uncertain local outcome,not rollback; refresh status explicitly. No new
model/tool request,automatic optimization,charge or extra analysis GET on success.

### REQ-029: Actionable capability setup and selected evidence diagnosis
The explicit lazy capability matrix SHALL distinguish implementation scope and
controlled transport tests from actual Agent/platform verification; unknown
installation is not absent. Only existing process recipes can enter a new blank
form, never modify saved/dirty profiles or act as a process traffic filter.
Reuse real setup/start/stop/diagnostic paths,5s owned metadata loading/explicit
refresh, no polling or locale/per-row fan-out. All copy and errors bilingual.

Selected-pair diagnosis SHALL reuse the current response with editable visible
slow threshold (default10000ms), independent validated per-side clock evidence
and original capture jumps. Repeated encoded request candidates need complete
nonempty matching SHA/byte refs and endpoint/protocol; missing/deleted/incomplete
stays unavailable. Headers/semantics/retry/charge/quality equivalence is not
proven. Existing Context Diff growth, cache and tool-error source navigation
remain distinct and usable. No extra source/API fetch, request replay, cost sum,
automatic causal conclusion or hidden threshold; invalidation hides old findings.

### REQ-028: Explicit call comparison and native parent references
Selected capture comparison SHALL require an explicit pair action, show usage,
separate clock-basis timings, network/protocol/error/completeness differences
and unproven task/tool/config/quality equivalence. Reuse Context Diff explicitly
for that same pair, not a new normalizer. No automatic source fetch from lists,
causal speedup verdict, missing-as-zero or charge aggregation. Mode/pair/source
invalidation hides old derived content; owned10s cancellation/retry, bilingual
keyboard-accessible states. Parent-reference exploration is lazy metadata with
5s owned deadline, paging/refresh and distinct resolved/ambiguous/incomplete/
unresolved states. Only resolved retained parent/fork references navigate to one
original native session; not proof of runtime spawn, communication or billing.

### REQ-001: Six-view shell
`App.tsx` SHALL provide 6 views: session / agent / compare / proxy / frida /
mission.

### REQ-002: State management
Use useState / useCallback / useMemo. phase/kind filtering uses
`useDeferredValue`; view switching uses `startTransition`.

> Note: these are **scheduling** optimizations; they don't reduce DOM node
> counts. Rendering volume is solved by REQ-006 virtual scrolling. v4
> conflating the two was one cause of its performance problems.

### REQ-003: Data loading strategy
| View | Request | Forbidden |
|------|---------|-----------|
| session list | `GET /api/sessions?dataSource=scan&limit=50` + scroll loading | fetching all at once |
| session detail | `GET /api/sessions/:key` (slim) | requesting `mode=full` |
| event body | `GET /api/sessions/:key/events/:id` (on click, 200ms debounce) | fetching with the detail |
| agent view | `GET /api/agent-overview` (**1 request**) | per-session detail fetches |
| compare | `POST /api/compare` | fetching the two details separately |

#### Scenario: Agent view request count
- **GIVEN** the user switches to the agent view
- **THEN** the number of requests this view produces in the network panel MUST
  equal 1
- **AND** v4 measured 524 requests / 299.6MB / 4,732ms

### REQ-004: SSE local patching
On `sessions_changed { keys }`, SHALL:
1. invalidate the matching keys in `recordCache`
2. issue one `GET /api/sessions?keys=<comma-separated>` to fetch those index
   rows
3. merge the returned rows into the **shared session store** (REQ-015) inside
   `startTransition`, sorted by `startedAt` descending

MUST NOT refetch the full index.

### REQ-005: Two-layer cache
The frontend SHALL maintain two cache layers:
- `recordCache` — session details (slim), LRU capped at 30
- `eventDetailCache` — single-event bodies, LRU capped at 100

### REQ-006: Virtual scrolling
`SessionList` (session list) and `TraceTimeline` (event tree) MUST
window-render, mounting only 10 rows above and below the viewport. The command
palette's result list (REQ-025) MUST also virtualize.

#### Scenario: worst-session rendering
- **GIVEN** opening a session with 9,590 events
- **THEN** DOM node count < 500, first paint < 200ms

### REQ-007: Detail pagination continuity
When `TraceTimeline` scrolls near the end of loaded data, SHALL request the
next page (`offset` incremented by 2000), appending rather than replacing.

### REQ-008: Component list

| Component | Responsibility | Data tier consumed |
|-----------|----------------|--------------------|
| `AppShell` | global header + view tabs + three-column skeleton + status bar (REQ-015) | — |
| `SessionList` | left rail session selector + search + filters (virtual scroll, REQ-016) | SessionIndexEntry |
| `SessionHeaderCard` | session metadata + four-dimension metric strip + system prompt entry (REQ-017) | TraceSession |
| `PhaseRibbon` | session phase time-distribution band (REQ-017) | slim events |
| `PhaseTiles` | 6 phase filter tiles | slim events |
| `TraceTimeline` | time-proportional Gantt + tree indentation (virtual scroll, REQ-017) | slim events |
| `EventInspector` | **right-rail** detail panel, draggable width + tabs (REQ-017) | single-event drill-down |
| `AgentOverview` | cross-session aggregation: KPI cards + sortable compare table (REQ-018) | AgentOverviewRow[] |
| `CompareBoard` | left/right side-by-side compare (REQ-019) | slim events + SpeedMetrics |
| `ProxyView` | MITM control + request list + detail drawer (REQ-020) | ProxyRequestListItem[] |
| `FridaView` | Frida control + capture list (REQ-021) | FridaCapture |
| `StatusBar` | connection/scan/DB status (REQ-023) | health + SSE |
| `CommandPalette` | ⌘K global jump (REQ-025, lazy-loaded) | SessionIndexEntry |
| `SettingsModal` | provider config | LocalSessionConfig |
| `TranscriptModal` | full transcript | mode=full (REQ-017 constraint) |
| `TokenTextModal` | token breakdown drill-down | mode=full |
| `LanguageToggle` / `ThemeToggle` | zh/en switch, three-state theme | — |

> Component renames: `SampleRail` → `SessionList`, `TraceGanttTree` →
> `TraceTimeline`. The old names described "sample rail" and "Gantt tree",
> which don't match actual responsibilities. Rename test files in sync.

### REQ-009: pending state
When the detail response has `pending: true`, SHALL show a "decrypting"
placeholder and wait for the SSE notification to refetch. MUST NOT poll.

### REQ-010: i18n
`t(key, locale)` with `zh` / `en` dictionaries. New strings MUST be added to
both locales. locale persists in localStorage key `agent-observability.locale`.
Error-code → human-readable copy also goes through i18n (the backend only
returns English messages and stable codes).

**New key prefixes this round**: `nav.*`, `state.*` (empty/error/loading copy),
`metric.*` (Speed/Accuracy/Stability/Cost), `palette.*`, `shortcut.*`,
`theme.*`, `proxy.*`, `frida.*`.

### REQ-011: Compact UI
Lists use compact dense rows, not whitespace cards. Groups collapsed by
default. Tables default to `compact` density.

> **Refinement of the original "compact single row" (see D-005)**: session list
> rows are **two-line dense** at `--row-lg` (44px) — first line title, second
> line meta. A single line forces truncating the only meaningful label (today:
> one line fits only
> `rollout-2026-08-04T14-08-32-019fcb63…jsonl`). The essence of the constraint
> is "dense, not cards", not "physically one line". Event rows stay single-line
> at `--row-sm` (28px).

### REQ-012: Font adjustment
Long-text areas (inspector body, transcript, report) SHALL support A- / A+ /
R, range 8-28px. MUST NOT affect chrome (header, tabs, side rails, status
bar).

### REQ-013: scan/proxy shown separately
Scan sessions and proxy captures retain independent originals/views. A lazy associated-Trace entry MAY link them using explicitly labelled direct/candidate/user-confirmed evidence. It MUST NOT overwrite source sessions, infer execution from a model proposal or count another charged copy.

Associated requests with a system prompt SHALL offer explicit request-context inspection. Prompt selection is request-specific, not the longest prompt in a time window. Context Diff SHALL distinguish linked_session automatic comparison from manual comparison, retain the manual picker when automatic pairing is unavailable and explain that captured-order membership is not proven native turn adjacency. Historical exact/capture_group labels may remain readable but MUST NOT authorize new automatic pairing.

### REQ-014: Bundled fallback
`src/generated/local-samples.ts` (machine-generated) provides fallback samples
when the API is unavailable. When using the fallback, MUST show an "offline
samples" marker in the status bar; MUST NOT let the user mistake it for real
data.

---

### REQ-015: App skeleton and shared session store

SHALL use a fixed three-column + top/bottom chrome skeleton:

```
┌─────────────────────────────────────────────────────────────────┐
│ AppHeader        ⌘K search       [scan] [⚙] [☾] [EN]            │ 48px
├─────────────────────────────────────────────────────────────────┤
│ ViewTabs   Sessions │ Agents │ Compare │ Proxy │ Frida          │ 40px
├──────────────┬──────────────────────────────┬───────────────────┤
│ SessionList  │  Main                        │  EventInspector   │
│ 300px drag   │  flex, min-width 0           │  420px drag       │
│ 260–480      │                              │  280–900          │
├──────────────┴──────────────────────────────┴───────────────────┤
│ StatusBar  ● live · 38 sessions · db 2.4MB · scan idle          │ 28px
└─────────────────────────────────────────────────────────────────┘
```

- ViewTabs uses the `underline` variant (GitHub-style), selected item has a
  2px `--accent-emphasis` bottom bar.
- Left/right rails collapsible (`[` / `]`); collapse state and widths persist
  (REQ-026).
- A collapsed session rail retains a labelled, keyboard-accessible reopen control.
  The Tasks exploration header exposes existing Team runs without adding a global tab.
- Only the session view is three-column; agent / compare / proxy / frida are
  single-column main areas (proxy detail goes in a `Drawer`).

**Shared session store**: the session index list SHALL be owned solely by
`App.tsx` and passed down; `SessionList` MUST NOT maintain its own session
array.

#### Scenario: compare view can select sessions (fixes an existing defect)
- **GIVEN** the app just started and the user switches directly to compare
- **THEN** both left and right session pickers MUST be populated with the same
  session list as the session view
- **AND** MUST NOT be empty

> **Current defect**: App.tsx's `sessions` state is only written by SSE
> patches, while `SampleRail` holds a separate independent state.
> `CompareBoard sessions={sessions}` always receives `[]`, so both dropdowns
> are always empty and compare is 100% unusable. This is the most
> unequivocal "click and nothing loads" case.

---

### REQ-016: Session list rows

Row height `--row-lg` (44px), two-line dense:

```
┌────────────────────────────────────────────────┐
│ ●  Fix SQLite index expansion logic            │  ← status dot + title (ellipsis truncation)
│    ⟨C⟩ claude · 2h ago · 110 events · 1.9M tok │  ← provider monogram + relative time + counts
└────────────────────────────────────────────────┘
```

| Element | Rule |
|---------|------|
| Status dot | `StatusBadge` dot form, color per contract §2.4 |
| Title | `--text-base`, `--fg-default`, single-line ellipsis |
| Provider | `ProviderBadge` monogram 12px |
| Time | relative (`2h ago` / `3d ago`); `title` attribute gives absolute time |
| Counts | events and tokens, `--font-mono`, `--text-xs`, `--fg-muted` |
| Selected | `--accent-subtle` background + 2px `--accent-emphasis` left bar |
| Hover | `--canvas-raised` background, no transition (G-DS-4) |

**Filter area** (list top, `--row-md` height): `SearchInput` (`/` focus) +
provider multi-select + status multi-select. Filters MUST be reflected in the
URL hash for sharing and refresh persistence.

#### Scenario: list shows real titles, not file names
- **GIVEN** the DB contains sessions whose details were never loaded
  (`detailLoaded = false`)
- **THEN** list rows MUST show the real session title and real `eventCount`
- **AND** MUST NOT show source file names like
  `rollout-2026-08-04T14-08-32-019fcb63-566f-70d1-….jsonl`
- **AND** MUST NOT show `0 events`

> **Current defect**: the index phase doesn't parse bodies, so of 38 sessions
> 34 had file-name titles and `eventCount` 0; only the 4 opened ones had real
> values. The user sees a screen of unidentifiable file names — "you only know
> after clicking" is exactly the feel this REQ eliminates. **Backend
> dependency**: lightweight title extraction per
> `specs/session-scanning/spec.md` REQ-021.

#### Scenario: loaded and unloaded look identical
- **GIVEN** both `detailLoaded=true` and `false` rows on screen
- **THEN** both render identically; MUST NOT have height differences from
  missing fields on some rows

---

### REQ-017: Session detail main area

Four segments top to bottom:

**① SessionHeaderCard**
- First row: `ProviderBadge` + session title (`--text-xl`) + `StatusBadge` +
  overflow menu (rescan / delete / copy id / export report)
- Second row meta: `cwd` (monospace, copyable) · start/end times · duration ·
  model
- Third row **four-dimension metric strip**: 4 `MetricCard`s

  | Dimension | Icon | Primary | Secondary |
  |-----------|------|---------|-----------|
  | Speed | `IconSpeed` | TTFT / TPS | end-to-end duration |
  | Accuracy | `IconAccuracy` | verificationCoverage | whether tests ran |
  | Stability | `IconStability` | errorRate | whether debug was entered |
  | Cost | `IconCost` | tokenTotal | costUsd · tokensPerStep |

  `null` values display `—` with a tooltip explaining why; MUST NOT show `0`
  as a stand-in.

The active compact toolbar SHALL label verification activity and step-error
ratios explicitly, not measured answer accuracy or a stability score. Follow
metrics-analysis REQ-004's existing verify-phase/step and error-step/step
denominators. Show loaded scope and accessible formulas, including unknown
step-status coverage. With incomplete detail pages or no execution steps, do
not present a whole-session ratio; a complete observed zero remains distinct.
Use detail eventTotal/hasMore when available, not an older session index count.
No additional body/aggregation request or persisted metric-algorithm change.

The optional session radar SHALL be labelled as a fixed-reference log profile,
not an Agent capability/quality score. Its original values and actual reference
scales SHALL be inspectable without IO; cumulative session tokens MUST NOT be
called context length. Incomplete pages omit event-derived ratio axes, and
unknown statuses omit the no-error axis. Missing axes remain explicitly
unavailable, never zero-filled. Do not infer Agent superiority from plot area.

**② PhaseRibbon** (product signature)
A horizontal color band spanning the full width on the time axis; each
segment's width = that phase's time share, color = `--phase-*`. Hover shows
phase name + duration + event count; click equals selecting only that phase.
Height 8px, `--radius-full`. This is the core visual for "see at a glance
where this session spent its time".

**③ PhaseTiles**
6 tiles; selected state uses that phase's `-subtle` background + same-hue text
+ icon; each tile carries a count badge. Plus "select all / deselect all" and
the currently visible event count.

**④ TraceTimeline**
Row height `--row-sm` (28px), virtual scroll. Each row:

```
│ ▸ │ #142 │ ⟨icon⟩ │ ████▌        │ Read src/App.tsx      │ 1.2s │ ✓ │
   ↑     ↑      ↑         ↑               ↑                   ↑     ↑
fold  seq  phase icon  time bar       title (tree indent)  duration  status
```

| Requirement | Description |
|-------------|--------------|
| Time-proportional bar | left offset and width computed from the event's real position/duration on the session timeline, **not equal-width bars** |
| Tree indentation | tool calls indent one level under their parent message, max 3 levels; parent rows collapsible |
| phase | icon + color (design-system REQ-004: color alone carries no meaning) |
| zero-duration events | render as a minimum 2px vertical line, MUST NOT be invisible |
| selected row | `--accent-subtle` background + left bar |

**⑤ EventInspector** (right rail)
- Header: `#sequence` + event title + copy id + close
- Tabs: `Summary` / `Input` / `Output` / `Raw` / `Tokens`
- The `Raw` tab fetches **on demand** (`include=raw`); request only when the
  tab is switched to
- Body area controlled by REQ-012 font adjustment; code blocks
  `--font-mono` + `--canvas-inset` background + copy button

#### Scenario: transcript does not fetch everything
- **GIVEN** the user opens Transcript in a 648-event session
- **THEN** MUST NOT request the whole session's `mode=full` at once
- **AND** SHALL paginate (reusing the REQ-007 offset/limit mechanism) and
  virtualize inside the modal

> **Current defect**: App.tsx's `openTranscript` unconditionally calls
> `api.sessionDetail(key, 'full')`; for large sessions this pulls tens of MB
> and blocks the main thread — violating `gotchas.md` G11.1.

---

### REQ-018: Agent overview view

**① Top KPI row**: 4 `MetricCard`s aggregating all providers (Speed /
Accuracy / Stability / Cost).

Workbench clarification (WB-003): use additive stored session/event/token counts
and provider+sourceAgent group count, not an unweighted average of group means,
invented tool/s, correctness/inverse-error scores or fastest/stablest winner.
The source is all-history scan aggregation, independent of the filtered/paged
task index. Explain per-session means and missing eligible sample/status coverage
without adding API fields or treating null as0. Recorded tool/phase intervals
are not measured model execution; phase sums may overlap. Keep raw per-group
non-monetary metrics and accessible definitions in both table/card views.
Each5s read owns cancellation, timeout and late-result suppression; retry is
explicit, never driven by locale, rendering, sort, view mode or expansion.

**② Provider compare table**: sortable, density `compact`, sticky header.

| Column | Render |
|--------|--------|
| Provider | `ProviderBadge` + name + sourceAgent |
| Sessions | number |
| Events | number + `Sparkline` (time-bucketed) |
| Tokens | number (thousands separator) + `BarMeter` (relative to max) |
| Cost | `$x.xxx` + `BarMeter` |
| Verification coverage | percent + `BarMeter` (tone=success) |
| Error rate | percent + `BarMeter` (tone=danger) |
| Debug rate | percent + `BarMeter` (tone=attention) |
| Avg tool duration | `xxxms` |

- Numeric columns right-aligned, `--font-mono`; `null` shows `—` not `0` (the
  current table confuses `null` and `0`).
- Rows expandable; expanding lists the provider's 10 most recent sessions
  (click jumps to the session view and selects).
- Table header shows data freshness (`cached` / `fresh` + timestamp) with a
  manual refresh button.

Still constrained by REQ-003: the whole view is **1 request**. Expanded rows
reuse the existing session store; MUST NOT fetch per session (G11.9).

Both view modes expose at most10 matching loaded scan sessions, using provider
AND sourceAgent, not provider alone. Disclose the filtered/paged index boundary;
do not claim these are globally latest. Tiny event charts bucket only this subset
by recorded UTC dates, not a complete activity trend. Source browsing is explicit
navigation; group comparison passes both source identities and leaves unmatched
sides blank instead of retaining a prior pair or substituting another group.
Missing numeric values sort last in both directions; provider strings sort as
strings. The freshness stamp is MAX source updatedAt, not a generation timestamp.

---

### REQ-019: Compare view

**① Selector strip**: left/right session pickers. SHALL use a `Popover` +
search picker (reusing the command palette's matching logic), MUST NOT use a
native `<select>` listing hundreds of sessions. Left marked `L`, right `R`,
colors accent / attention, and MUST also carry letter markers (color alone
carries no meaning).

**② Verdict strip**: after loading, one sentence at the top — e.g. "Claude is
2.3× faster but uses 41% more tokens". This is what developers want to see
first.

Workbench amendment (WB-003 / REQ-031 takes precedence over the legacy example):
show a descriptive observation summary, not an overall wins/losses score or
measured correctness verdict. Verify-phase/step ratios and observed repair
patterns are not proof of passing tests or code quality. Null/partial ratios
remain unavailable. Raw total tokens are not a currency saving; do not call an
absolute min-based difference percentage a percentage saved.

Each selected L/R pair owns one read,5s deadline, cancellation and explicit retry.
Changing the pair or unmounting aborts old ownership; late results cannot restore
old conclusions. Failure/cancel/timeout never auto-retries, nor does a locale or
parent rerender. Reload hides the prior result while reading. Selecting the same
run twice is actionable guidance, not a request. The frozen compare API stays slim.

Selection names and source/coverage stay readable even when a selected ID is not
in the currently filtered shared index. Picker opening focuses search; no-match
and empty scope differ, and clearing/closing preserves focus. Reuse only loaded
metadata for bounded error/longest-interval locators, explicitly naming partial
coverage and unproven task/tool/config/quality equivalence. Selected locators open
the original run and event; an event beyond a cached2000-page may trigger one
selected slim read at the existing5000cap, never per-row/unrelated body reads or
injection of an old comparison snapshot into the live run cache. Network call
comparison retains its separate explicit Proxy workflow and measurement domain.

**③ Four-dimension compare**: 4 pairs of `BarMeter` double bars (one per L/R),
deltas labeled `+41%` / `−2.3×`, colored by "who is better" rather than fixed
left/right colors.

Workbench amendment: descriptive observed magnitudes take precedence over the
legacy winner-color rule. Six primary KPI summaries precede a labelled, initially
collapsed additional-activity disclosure; all existing metrics remain reachable.
Show exact signed R-minus-L values with units, not minimum-based "percent saved"
or winner arrows. Loaded counts carry their scope; incomplete whole-run ratios,
no-step denominators and unknown error-step statuses remain unavailable. Verify
activity uses verify-phase events / execution steps, not total event count.
KPI error/top-token lists expose bounded keyboard-accessible exact original-run
and event locators, never a per-row body read on render or expansion.

The comparison radar is a recorded-magnitude profile, not a quality score.
Normalize available raw values by the larger side value without a lower-better
inversion, disclose raw side values and scales, omit partial/missing axes rather
than zero-filling, and use the raw-value disclosure without a plot when fewer
than three comparable axes remain. Do not infer test success or model latency
from title patterns, record intervals or plot area. Existing pricing/currency
contract-gap resolution and remaining detailed comparison audit stay separate.

Token rings and speed-panel stacks SHALL share one presentation of the five
recorded components (input/output/reasoning/cacheRead/cacheWrite) and native
total. System-prompt estimates remain separately labelled and nullable, never
added into that total. If nonnegative finite components do not reconcile exactly
with a positive native total, or metadata is pending, retain raw numbers and
explain why no share chart is drawn; do not guess missing reasoning semantics.
Each ring uses its actual radius and its own total as100%. Cache slices have
no fabricated text drill-down. Actual text classes retain explicit inspection;
rendering the chart performs no body IO. Invalid and empty observations are not
converted to favorable zero shares or billed-consumption claims.

Speed/detail displays SHALL show readable bilingual labels and signed observed
differences, not overall parity, favorable borders, lower-better grades or Agent
winner badges. Keep native/network/partial clock guards and raw side values.
Detail activity ratios use complete step evidence; unknown error status remains
unavailable, and cache-write records remain inspectable. A retained TTFT above
the visible5s threshold is an observation, not a diagnosed startup cause.

Agent overview MAY lazy-load its view code behind labelled loading/error
boundaries; this MUST preserve navigation, existing properties and the single
aggregation-read/no per-session fan-out contract. Lazy code is not proof that
the overview's remaining metric/coverage presentation has been corrected.
The task-scoped Team view MAY likewise defer its code until explicit navigation,
with labelled loading/error states. Preserve its existing hash restoration,
single initial run-list read, selection caches and SSE invalidation; no eager
Team API read is introduced by the ordinary Tasks screen.

**④ PhaseRibbon comparison**: two ribbons stacked, sharing one time scale, to
see phase-distribution differences at a glance.

**⑤ Side-by-side timelines**: two columns of virtual scroll, at most 100 rows
each on screen; row structure reuses `TraceTimeline`.

#### Scenario: guidance when nothing is selected
- **GIVEN** the user just entered compare without selecting sessions
- **THEN** SHALL render `EmptyState`: icon + "select two sessions to compare"
  + a button that opens the left picker directly
- **AND** MUST NOT just render two empty dropdowns

---

### REQ-020: Proxy view

A lazy capacity drawer SHALL explicitly load one CaptureMetadataCapacity and one
CaptureStorageStatus on opening/manual refresh only, with5s abort and independent
loading/error/unknown states. Never poll or fetch per capture row. Clear previous
snapshots on refresh, cancel unmounted/late responses and mark snapshots stale
on relevant runtime changes without a network request. Show exact original
used/quota/remaining/pending/active/body/pending limits separately from physical
DB/WAL lengths, admission thresholds/hard budgets and server checkedAt. Quota
remaining=max(0,quota-used), not filesystem free space. Unknown is not0/ready;
below admission is not Agent/capture/full-disk certification. Explain static
SQLite-full/pressure errors and next steps; no auto-clear/vacuum/checkpoint/start.
Storage status may resume previously confirmed pending deletion, which SHALL
be disclosed; opening never creates a deletion intent. New text is bilingual,
keyboard-reachable and uses semantic headings/live/error regions.

Selected capture details SHALL load one metadata-only original-deletion status,
not per-row/list queries. Explicit bilingual body deletion requires a stopped
monitor, valid retained refs, visible exact request ID/scope warning and a
separate acknowledgement before POST. Show pending/failed/complete and explicit
status refresh/retry without polling or treating HTTP200/unknown response as
successful cleanup. Headers/timing/native data remain. Submission or confirmed
intent immediately hides cached body/prompt/download/analysis/diff content;
cancel late callbacks and unmount cached diff. Reopening the same selected ID
within this view cannot revive an uncertain/confirmed body's old snapshot.
Loading/failed availability must not masquerade as available/deleted success.
Use semantic keyboard-reachable controls, labelled acknowledgement and live
status; do not wire global Clear to this per-request operation.

A lazy Agent connection drawer SHALL fetch one bounded profile list only on opening. Users explicitly save/select a CLI/project recipe, inspect pinned-revision POSIX/PowerShell commands and start its proxy listener through the shared API. No browser action launches a shell/Agent. Show existing-process, shared-listener, NO_PROXY, runtime-trust and unverified-transport boundaries. Dirty/changed profiles cannot generate a stale launch command; conflicted/corrupt configuration exposes reload/review actions without overwriting files. New text is bilingual and rendered inertly. Windows remains platform-unverified until tested.

Connection profile/plan/diagnostic/status/copy operations SHALL own5s waits,
save/delete10s and start/self-test12s, releasing local waiting even when a loader
ignores abort. Prevent overlapping submission and reject late/unmounted results.
Preserve draft fields and the originally reviewed revision through profile reload;
a newer/missing saved version requires explicit review/reselection, never silent
adoption for a compare-and-swap write. A failed refresh is not recovery after an
uncertain write. Unknown profile outcomes require explicit successful list refresh;
listener uncertainty requires fresh runtime evidence, not a profile reload.
Propagate uncertain setup start to shared parent controls. No automatic mutation
retry, status polling, shell/Agent launch or trust/proxy configuration changes.

Switching a dirty recipe or closing dirty/pending setup SHALL have a safe-focus
confirmation. Cancellation/closing cannot promise rollback or suppress the warning
that a synthetic capture may still finish saving. Separate essential fields from
collapsed executable/bypass options and recipe maintenance; identify the three
terminal recipes separately from desktop/IDE/nine-scanner acceptance. Commands
retain both shell encodings, reviewed revision and manual execution/copy feedback.
Selected diagnostics/self-test results must match profile ID AND revision; a
contradictory passed self-test or unconfirmed listener readiness is not success.
Recipe deletion names its exact identity and affects neither Agent configuration
nor retained captures. All controls remain labelled and contain wide paths/text.

The explicit connection check SHALL render the shared backend diagnostic snapshot: expected/actual port, public CA availability/digest/expiry, unverified selected-runtime trust and unchecked OS trust, current shared-listener traffic and actionable findings. Activity/status SSE invalidates a previous snapshot locally without polling. Display checkedAt and a stale warning rather than upgrading unknown Agent identity/trust to success. Abort after5s with retry guidance, clear previous evidence before refresh, reject stale recipe revisions and abort owned requests on unmount. Dirty/changed recipes cannot check old settings; never fetch diagnostics for every list item.

Original-capture amendment: request/response details SHALL fetch ProxyCaptureBodies on demand, display actual retained byte count and completeness status, mark bounded previews, and provide direct original download links. Response headers (including multiple values) SHALL be inspectable. Opening the list MUST NOT fetch any full body file.

When recorded, display CaptureProcessingResult separately from original
completeness: an executed parser job is not protocol/full-chain success, and
queue/worker/timeout/result-limit failure is not Agent failure or original
loss. Retained original download/offline inspection remains available; never
automatically retry a model request. Legacy outcomes remain absent/unknown.

When contentDecoding identifies a non-identity view, explicitly distinguish
bounded decoded body text from original encoded download bytes/digests.
decode_error includes encoding/UTF-8/framing limits, not automatic Agent failure.

Render optional process-wide resource gauges and lifetime preview-limit,
processing-admission-reject and slow-SSE-disconnect counters from diagnostics;
absence in legacy snapshots is unknown. Resource snapshots do not introduce
polling. resource_limit and previewDroppedBytes explicitly describe missing
semantic previews, not lost originals; original status/downloads stay separate.

When recorded, render the independent network outcome, native/static error,
actual upstream status (null as unknown) and request/response end flags.
Network completed MUST NOT be labelled Agent/protocol success; HTTP failure
can still have complete originals and an executed parser. A broken stream's
retained prefix is not labelled a complete response, even with status200 or a
protocol terminal marker. Legacy missing transport remains absent/unknown.

**① Control strip**
- Status indicator: `stopped` / `running :8888` / `starting`
- Primary buttons: start / stop (stop is destructive, needs confirmation)
- Port input (editable while stopped)
- "Download CA cert" button + one-line install guide link
- Historical request count (unchanged by local hiding). “Clear current list”
  lives beside list refresh, is reversible/local-only, and does not delete data
  or require a destructive confirmation (user amendment 2026-10-18).

Backend endpoints `POST /api/proxy/start`, `POST /api/proxy/stop`
are implemented shared controls (defined in `contracts/api.md` §4); stop waits
for real cleanup and startup acceptance is not Agent readiness.

**② Request list**: dense table, virtual scroll. Columns: method (colored
badge) · URL (ellipsized middle, keeping host and tail) · status code (2xx
success / 3xx neutral / 4xx attention / 5xx danger) · duration · size · time.
Filterable by method/status/hostname.

**③ Detail drawer**: slides in from the right on row click, tabs `Request` /
`Response` / `Headers` / `Timing`, with lazy protocol/evidence/context tabs.
Bodies render original retained content as text, with bounded-preview and
completeness labels and original download; monitoring does not redact fields.

#### Scenario: empty state when proxy never started
- **GIVEN** the proxy never started and the request list is empty
- **THEN** SHALL render `EmptyState`: "proxy is not running" + start button +
  CA cert install hint
- **AND** MUST NOT just render "no data"

---

### REQ-021: Frida view

**① Control strip**: status (`stopped` / `running pid=xxxx`) · start/stop
buttons · target process picker (auto-discover when omitted). Backend
`POST /api/frida/start`, `POST /api/frida/stop` (defined in
`contracts/api.md` §5) are wired. This is an experimental target-specific entry,
not generic Codex/CodeArts integration or platform acceptance. Status is a
snapshot, not installation/readiness detection or proof of successful capture.

**② Capture list**: dense table, columns: type badge · model · time · size;
click opens a detail drawer.

**③ Prerequisites not met**: Frida not installed / no target process →
`EmptyState` explaining exactly what's missing and how to install; MUST NOT
just show `stopped`.

Workbench clarification: the current status contract cannot detect installation,
platform support or permissions. Empty history MUST NOT assert a missing install
or target. Show known runtime/starting/unknown states, manual prerequisites,
experimental/incomplete-persistence limits and deliberate acknowledgement instead.
PID is optional and, when entered, must be an exactly representable positive
integer. Separate status/history reads have5s owned deadlines, cancellation and
explicit per-region retry, no polling or locale-driven refetch.10s command waits
are single-flight; Stop requires confirmation. Failure/timeout/cancelled waiting
never becomes optimistic stopped/capture success or automatic command retry.
Read status explicitly to recover an uncertain outcome. Cancelling local waiting
does not undo backend work. Saved-capture history and explicit selected detail
now follow [frida-capture-flow.md](../../contracts/frida-capture-flow.md)
FC-001..004: bounded metadata paging, separately owned detail read, inert JSON,
unknown/error states, retry/cancel and stale-result suppression. The packaged
monitor remains a known skeleton and is rejected before spawning; fixture
history/detail acceptance does not certify a real Windows target hook.

The shared App SSE forwards existing `frida_capture`/`frida_status` metadata.
Keep <=20 unique recent saved IDs, distinct from the paged history snapshot;
explicit selection alone reads that ID's detail. Runtime notices describe the
last received process event and never resolve an uncertain control command,
prove readiness or invent missing metadata. Disconnect discloses unknown
freshness. Journal reset clears notices and closes/aborts selected detail,
reloading only the mounted bounded status/history snapshot. No per-notice IO,
second EventSource, polling or automatic target action.

---

### REQ-022: Four states landed (the core fix this round)

Every location below SHALL implement the design-system REQ-006 four states,
and `catch` blocks MUST NOT be empty:

| Location | Current | Required |
|----------|---------|----------|
| `SessionList` list loading | `catch {}` silent | skeleton / empty / error+retry |
| `App.selectSession` detail loading | `catch {}` silent | main-area skeleton; failure shows code + retry |
| `EventInspector` event body | `catch` → `setDetail(null)` indistinguishable from "no data" | distinguish empty and error |
| `AgentOverview` | has error but no skeleton / empty | complete the four states |
| `CompareBoard` | has error but no empty guidance | complete |
| `ProxyView` / `FridaView` | empty list and failure indistinguishable | complete |
| `SettingsModal` | `catch` → `setConfig(null)` stuck at "loading" forever | failure shows error + retry |

Settings uses the shared focus-trapped Modal and one5s owned configuration read.
Provider enabled/path edits preserve all other LocalSessionConfig fields and
require an explicit, single-flight10s Save. Parent/locale rerenders do not reload
or discard a draft. Dirty close/reload requires deliberate discard; closing a
pending save only stops waiting, never rolls back. Show error codes, retained
drafts, saved snapshots and uncertain write outcomes without automatic retries.
Rereading the current service config is not proof of disk-final state or scanner
hot reload. Immediate browser-only display preferences are separately labelled;
they never rewrite captured originals or wait for the provider Save action.

#### Scenario: backend unreachable
- **GIVEN** the backend process is killed
- **WHEN** the user clicks any session
- **THEN** the main area MUST show the error state within 5 seconds (error
  code + copy + retry button)
- **AND** the status bar's live indicator MUST turn disconnected
- **AND** MUST NOT stay blank or on an infinite skeleton

#### Scenario: SQLite-class provider detail empty
- **GIVEN** the user clicks an opencode or codearts session and the backend
  returns `events: []` with an empty `title`
- **THEN** SHALL render `EmptyState` saying "no events parsed for this
  session" with a "rescan" action
- **AND** MUST NOT render an empty blank main area

> **Current defect**: `GET /api/sessions/opencode-7ff9bf5edb628d` and
> `.../codearts-c79b25e584d002` measurably returned `events: 0`, `title: ""`,
> `pending: undefined`. The frontend has no presentation for this — pure
> white blank. Backend fix: `UI-TASKS.md` T-11.

---

### REQ-023: Status bar

Fixed 28px bottom, left to right:

| Segment | Content |
|---------|---------|
| Connection | SSE status dot + `live` / `disconnected` (`aria-live="polite"`) |
| Data | `38 sessions · 12,405 events` |
| Scan | `idle` / `scanning claude…` / `last scan 2m ago`, clickable to trigger manual scan |
| DB | `db 2.4MB · wal 0.03MB` (from `/api/health`) |
| Right | data-source marker: `scan` / `offline samples` (REQ-014) · version |

The status bar MUST NOT poll `/api/health` — data updates with SSE heartbeats
or manual refresh.

---

### REQ-024: URL state sync

View, selected session, and filters SHALL be reflected in the URL hash:

```
#/sessions?key=claude-09893f87625581&phase=implement,debug&provider=claude
#/agents
#/compare?left=claude-xxx&right=codex-yyy
#/mission?range=7d
```

Refreshing MUST restore the same state. No router library
(`project.md` §2: SPA without routing); use `hashchange` + a parse/serialize
module within 60 lines.

---

### REQ-025: Command palette & shortcuts

Implement per design-system REQ-008. The palette's session search SHALL reuse
the shared session store (REQ-015), MUST NOT issue additional requests. The
component lazy-loads on the first `⌘K`.

First screen SHALL show a light hint line in the main area
(`⌘K search sessions · ? shortcuts`) to make shortcuts discoverable; hidden
after first use (localStorage marker).

---

### REQ-026: Layout persistence

The following preferences SHALL persist to localStorage, key prefix
`agent-observability.`:

| Key | Content |
|-----|---------|
| `.theme` | `system` / `dark` / `light` |
| `.locale` | `zh` / `en` (existing) |
| `.layout.railWidth` | number px |
| `.layout.inspectorWidth` | number px |
| `.layout.railCollapsed` / `.layout.inspectorCollapsed` | booleans |
| `.fontSize` | long-text font size (REQ-012) |
| `.paletteHintSeen` | boolean (REQ-025) |

Reading MUST range-check (out-of-range widths fall back to defaults) and
MUST NOT crash on dirty localStorage data.

### REQ-027: Mission view (add-mission-control)
The 6th view `mission` SHALL render `MissionControl`, a single-column main
area (NOT three columns) with A/B/C section chip navigation:

```
┌─────────────────────────────────────────────────────┐
│ Mission                                    [刷新]    │
│ 7d · 30d · all            generated … · N widgets · xms │  ← meta 行
├─────────────────────────────────────────────────────┤
│ [A 使用行为] [B 效能质量] [C 采集健康]                 │  ← chip 导航
├─────────────────────────────────────────────────────┤
│ …widgets (single column)…                            │
└─────────────────────────────────────────────────────┘
```

| Requirement | Description |
|-------------|-------------|
| Data loading | `GET /api/mission?range=&dataSource=&tz=` — the whole view is **exactly 1 request** (REQ-003 / G11.9). No per-session fetches. |
| meta row | `generated <time> · N widgets · xxxms` — expose the server-side duration, which doubles as the nfr budget readout. |
| range | 7d / 30d / all, reflected in the hash (`#/mission?range=7d`). |
| refresh | Manual refresh button + SSE `sessions_changed` stamp invalidation. **Explicitly no polling** — timer-based 60s auto-refresh is rejected (REQ-023 / nfr §2 30s-window budget). |
| criteria line | Every widget MUST render the server-provided `criteria` line below its title (design-system REQ-010); the frontend MUST NOT write its own criteria text. |
| unavailable widgets | `available=false` renders `EmptyState` + `unavailableReason` (REQ-022 four states + REQ-017 "null shows —, never 0"). |
| tz | The frontend passes its local `-new Date().getTimezoneOffset()` as `tz`; time bucketing happens server-side (A4/A7/C3). |
| Drill-down | Hot sessions reuse the existing hash route `#/sessions?key=<id>` (REQ-024); no new navigation mechanism. |

#### Scenario: mission request count
- **GIVEN** the user switches to the mission view
- **THEN** the network panel shows exactly 1 request for the view's data
- **AND** no `sessions.map(s => fetch(...))` pattern exists anywhere in the
  mission components

#### Scenario: pricing gap renders dash
- **GIVEN** sessions whose `cost_source = 'unknown'`
- **WHEN** the cost widgets render
- **THEN** those sessions show `—` and are excluded from `$/turn` numerator
  and denominator

---

## Gotchas

- G7.1: detail panel on the right, not the bottom, draggable width
- G7.3: lists dense, not cards; groups collapsed by default (refined in
  REQ-011 and D-005)
- G7.4: scan/proxy shown separately
- G7.5: `useDeferredValue` + `startTransition` are scheduling optimizations;
  **they cannot replace virtual scrolling**
- G7.2: font A-/A+/R adjustment without affecting chrome
- `src/generated/` must not be hand-edited; change the generator
- G11.9: any "loop over sessions and fetch each" code is a design error; the
  correct approach is a server-side aggregation endpoint
- **G7.6 (new)**: no component may hold a second session-index array. The
  current `SampleRail` private `sessions` state makes `CompareBoard` always
  receive an empty array — a 100%-reproducible missing feature, not an edge
  case.
- **G7.7 (new)**: an empty `catch` block here equals "feature broken and
  nobody knows". Seven confirmed locations (REQ-022 table) all need fixing.
  Treat empty catches as compile errors in review.
- **G7.8 (new)**: `mode=full` is only for explicit raw/transcript needs, and
  must paginate. One full fetch for a 648-event session is tens of MB.
## Codex call inspection amendment

UI-CODEX-001: lazy metadata pages and selected details for retained and active
WS sources, explicit refresh, prior-response navigation, exact native session
entry and tool input-reference evidence. Show partial/unknown/error and source
bounds, do not promise full inherited context, execution timing or Agent success.
Invalidate/abort detail on source change, confirmed deletion, unmount and
relation changes. No HTML execution from captured content or automatic replay.
UI-CODEX-002: selected live inspectors default to metadata-hint-driven updates,
at most one page plus changed selected detail per5s, serial not concurrent.
Preserve current selection/expanded completed detail, expose pause/manual
refresh, suspend while hidden/unmounted and stop automatic retry on error.
One explicit CODEX_SOURCE_CHANGED live-to-saved convergence reread is allowed
under the same limits; a second failure is visible until explicit manual retry.
Large selected details SHALL delay auto cycles under the30s byte budget,
display that delay, and retain the manual action; no hidden large-body polling.
No hints means no polling; reconnect/end requests a final bounded snapshot.

### REQ-035: Session family and attempt explorer
A discoverable explicit family entry opens a focus-trapped drawer with parent/child browsing, explicit branch expansion, selected-session evidence, independent attempts and original Trace/capture navigation. Read family metadata once per explicit selection/expansion and execution/body only on demand. Show unknown retry, absent relations, incomplete/ambiguous evidence, loading/error/retry/stale states bilingually. Abort owned reads on close/selection/invalidation, suppress late results, no polling/N+1. No money summaries or automatic workload execution.

### REQ-036: Native tool execution investigation
An explicit standalone lazy drawer SHALL show a virtual native event process and
current-page tool groups per ToolInspectionGroup, with retained scoped identity
locators, exact event membership, input/output hints, normalized status and error.
Show source/page coverage and unknown lifecycle/timing; never equate proposals,
missing outputs, same-name/time events or incomplete identity with tool success.
Filters use loaded metadata only. Explicit previous/next pages use actual counts,
not requested limits. Selected event body and raw read independently on demand;
no eager member body fan-out. Bilingual four-state and stale handling, focus
return,5s owned waits/abort/late suppression,8..28px text controls, inert output.
No polling, replay, shell/model invocation, fee summaries or new App shell.

### REQ-037: Explicit cross-page native tool lookup
Selected exact native tool evidence MAY open an explicit bounded same-ID lookup across native event pages. Preserve scope, completeness, ambiguity and original source locators. Paginate explicitly and select exact members for existing single-event body/raw reads. Own5s cancellation/retry and hide source-invalidated snapshots without polling; no invented execution identity.
### REQ-038: Explicit local scan trace export
Eligible non-offline scan sessions offer a lazy explicit OTLP metadata download
per TX-001..004. Opening/locale/invalidation never reads or downloads; one chosen
bounded range owns10s wait/cancel and rejects stale results. Display coverage,
unknown source completeness and generated-ID/observation-point limitations.

### REQ-039: Manual experimental record workflow
Compare view offers lazy manual record CRUD per EXP-001..004, preserving loaded
session-store ownership. Explicit confirmed writes, revision review and uncertain
outcomes remain distinct. Compare only two available selected refs through the
existing comparison callback; do not duplicate its pair-change read or execute
experiments. User declarations never become inferred pass/fail/causal quality.

### REQ-040: Explicit linked-source OTLP export
Eligible native sessions retain the v1 export and offer a separate lazy
LTX-001..005 entry. Opening and locale changes perform no IO. Explicit bounded
download owns cancellation, timeout and stale-result suppression. Native and
capture ranges paginate independently with disclosed coverage; source identity,
transport state and unknown clocks do not establish causality or billing.

### REQ-041: Development CDP control and response inspection
Proxy provides a collapsed explicit development CDP entry, with start/stop,
status/target refresh and metadata-only response refresh. Only explicit actions
perform IO; no polling or new global shell. Production404 shows dev-only
guidance. Selected response text reads independently, as inert bounded text
with8..28px font controls. Display body-acquisition time and decoded byte count,
unknown network/native/model identity, memory-only lifetime, capacity rejects
and static issues. A running manager is not proven traffic or Agent success.
Commands own12s waits; reads5s, cancellation/unmount hides late results, mutation
timeout/cancel is uncertain and requires explicit status reconciliation. Copy
is bilingual; locale changes do not fetch, controls remain keyboard reachable.

### REQ-042: Original evidence bundle download
The selected capture offers lazy bilingual CB-005 preparation and a validated
native streaming download link. No automatic preparation/body fan-out or JS
buffer of large original files. Show included files, omitted source history,
captured-prefix and bounded metadata scope. Deletion/selection/invalidation
aborts preparation and hides stale links; cancellation, errors and saving-unknown
states remain distinct. Existing JSON/individual-original downloads remain.

### REQ-043: Official hook setup and observation explorer
Proxy offers explicit CH-005 receiver configuration and bounded paged observations,
raw-retention acknowledgement, generated settings fragment and native source
jumps. Never auto-install hooks or execute an Agent. Distinguish before-tool,
reported success/failure/native duration, receipt time, agent lifecycle and
unverified sender/history. Shared SSE hints drive only bounded active metadata;
detail raw reads are explicit, inert, owned and bounded. Both locales and all
loading/empty/error/uncertain/stale states are required.

## Task workbench supersedes legacy navigation (2026-10-25)

REQ-TASK-001: Task center is the default; primary navigation is Tasks, Data intake, Settings. Legacy analytics/compare links remain secondary. Old session/team paths resolve within the task context and preserve explicit event/member anchors; unresolved run links retain the legacy evidence view with an explanation.
REQ-TASK-002: Collected/imported tabs share task list/detail. A native root is one row regardless of child count. Task header shows origin, recorded time/status and coverage, never claims a live Agent from log status.
REQ-TASK-003: Conversation, Trajectory and Raw events share selected task/member/record. Native scope reads are paged; selected body and Raw are lazy. Multiagent all-scope is a labelled ledger, not an invented serial conversation. Member navigation retains parent anchors.
REQ-TASK-004: Live hints preserve history; explicit refresh fixes a new sequence window. Replay is opt-in with pause/step controls and is independent of actual execution time. Stable event anchors restore a bounded page on reload. Metadata search/status filters remain scoped to the selected task/member and match metadata rather than unloaded body text. Shared links retain these filters and an explicit UTC time window. Ancestor context projection is deferred.
REQ-TASK-005: Intake explains native logs/proxy/CDP/Frida/import applicability and actual support. Viewing does not start capture. Local monitoring and proxy runtime controls report actual server state; monitoring defaults off on a normal restart. Stop acquisition never stops an external Agent. Imported sessions show occurrence/import times separately.

These requirements supersede REQ-001 six-view primary navigation and the old separate Session/Team replay composition. Existing single-evidence, privacy, i18n, virtual-scroll and cache constraints remain in force. App.tsx remains the only global shell; task components own only task-scoped request/reading state.

REQ-TASK-006 (2026-10-26): Implement [task-process.md](../../contracts/task-process.md)
TP-004/005. Process uses virtualized round/step/model-observation/native-tool
groups; incomplete groups and absent attempt identities remain explicit. The
fixed-window full-scope time overview and zoomable detail axis retain context
through filtering, offer activity/member lanes, inclusive brush, exact selected
marks and keyboard/pointer zoom/pan/reset. Histogram clicks read a bounded time
page. Counts are observations, log intervals are not measured inference, and
model-output completion cannot imply tool/round completion. Preserve original
record selection, lazy single evidence, cancellation and explicit stale refresh.
