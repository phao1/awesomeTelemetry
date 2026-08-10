# Spec: Frontend

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
Scan sessions and proxy captures are independent views; never mixed.

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

**③ Four-dimension compare**: 4 pairs of `BarMeter` double bars (one per L/R),
deltas labeled `+41%` / `−2.3×`, colored by "who is better" rather than fixed
left/right colors.

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

**① Control strip**
- Status indicator: `stopped` / `running :8888` / `starting`
- Primary buttons: start / stop (stop is destructive, needs confirmation)
- Port input (editable while stopped)
- "Download CA cert" button + one-line install guide link
- Request count + clear button (destructive, confirmation)

Backend endpoints `POST /api/proxy/start`, `POST /api/proxy/stop`
(defined in `contracts/api.md` §4, **currently not implemented**; see
`UI-TASKS.md` T-12).

**② Request list**: dense table, virtual scroll. Columns: method (colored
badge) · URL (ellipsized middle, keeping host and tail) · status code (2xx
success / 3xx neutral / 4xx attention / 5xx danger) · duration · size · time.
Filterable by method/status/hostname.

**③ Detail drawer**: slides in from the right on row click, tabs `Request` /
`Response` / `Headers` / `Timing`, body `--font-mono` + copy button,
desensitized fields marked with a "desensitized" `Badge`.

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
`contracts/api.md` §5, **currently not implemented**).

**② Capture list**: dense table, columns: type badge · model · time · size;
click opens a detail drawer.

**③ Prerequisites not met**: Frida not installed / no target process →
`EmptyState` explaining exactly what's missing and how to install; MUST NOT
just show `stopped`.

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
