# Frontend (delta)

## MODIFIED Requirements

### Requirement: Session list rows

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
| Session ID | visible on the meta line in `--font-mono` / `--text-xs` /
  `--fg-muted`, ellipsis-truncated with the full ID in the `title` attribute |
| Provider | `ProviderBadge` monogram 12px |
| Time | relative (`2h ago` / `3d ago`); `title` attribute gives absolute time |
| Counts | events and tokens, `--font-mono`, `--text-xs`, `--fg-muted` |
| Selected | `--accent-subtle` background + 2px `--accent-emphasis` left bar |
| Hover | `--canvas-raised` background, no transition (G-DS-4) |

**Filter area** (list top): `SearchInput` (`/` focus) + a time-range segmented
control (`today` default / `7d` / `30d` / `all`) + provider multi-select +
status multi-select. The search SHALL match both the session title and the
session ID (including prefix matches on the provider key, e.g. `codearts-`),
and the placeholder SHALL say "title / id".

**All filters are server-side** (`GET /api/sessions?q=&range=&provider=&status=`):
the list SHALL NOT re-filter already-loaded pages in the frontend (that misses
rows beyond the first page). Any filter change refetches page one. The list
SHALL show a footer with the server `total` under the current filters and a
"load more" button for the keyset next page, replacing pure infinite scroll.
Filters MUST be reflected in the URL hash (`q` / `time`) for sharing and
refresh persistence.

#### Scenario: list shows real titles, not file names
- **GIVEN** the DB contains sessions whose details were never loaded
  (`detailLoaded = false`)
- **THEN** list rows MUST show the real session title and real `eventCount`
- **AND** MUST NOT show source file names like
  `rollout-2026-08-04T14-08-32-019fcb63-566f-70d1-….jsonl`
- **AND** MUST NOT show `0 events`

#### Scenario: session id is visible and searchable
- **GIVEN** a session `codearts-87fa32238de9b5` titled `财务看板下钻优化及FIRE计算`
- **WHEN** the user types `87fa3223` or `codearts-87fa` into the list search
- **THEN** the row is the only visible match
- **AND** the row's meta line renders the ID in monospace

#### Scenario: loaded and unloaded look identical
- **GIVEN** both `detailLoaded=true` and `false` rows on screen
- **THEN** both render identically; MUST NOT have height differences from
  missing fields on some rows

### Requirement: Session detail main area

Modern inspector layout, no longer a stacked card stream:

**① SessionToolbar** (sticky): `ProviderBadge` + session title (truncated) +
`StatusBadge` + copyable session ID + compact four-dimension metrics (Speed /
Accuracy / Stability / Cost; `null` shows `—`, never `0`) + overflow menu
(rescan / delete / copy id / export report). The timeline is the main canvas
below it — findings no longer push it off the first screen.

**② Findings panel**: collapsible (`<details>`), default open, placed between
the toolbar and the timeline.

**③ TraceTimeline** (main canvas)
Row height `--row-sm` (28px), virtual scroll, and a toolbar toggle with two
layout modes:

- **Time mode** (default): bars positioned on a real time axis; left offset and
  width computed from the event's position/duration; supports axis zoom and
  relative/absolute time labels; zero-duration events render as a minimum 2px
  vertical line, never invisible.
- **Sequence mode**: bars laid out uniformly by `sequence` order (equal-width
  cells, axis labeled by sequence number); duration text still shows the real
  duration; time-axis zoom is disabled.

The toolbar embeds the layout-mode toggle, timeline search, and six phase chips
(toggle = phase filter, App owns the state). Above the time axis there is a
**clickable phase axis**: time mode segments are proportional to each phase's
time share, sequence mode segments to each phase's event-count share; clicking
a segment scrolls the timeline to that phase's first event, highlights it, and
opens it in the right-side `EventInspector`.

In both modes every row stays clickable and opens `EventInspector`; event rows
SHALL show an `in` / `out` badge when `hasInput` / `hasOutput` is true.

| Requirement | Description |
|-------------|-------------|
| Time-proportional bar | left offset and width computed from the event's real position/duration, **not equal-width bars** (time mode) |
| Sequence layout | uniform cells by sequence order, no time axis (sequence mode) |
| Tree indentation | tool calls indent one level under their parent message, max 3 levels; parent rows collapsible |
| phase | icon + color (design-system REQ-004: color alone carries no meaning) |
| zero-duration events | minimum 2px vertical line (time mode), full-width cell (sequence mode) |
| selected row | `--accent-subtle` background + left bar |
| input/output badge | `in`/`out` marker on rows where `hasInput`/`hasOutput` is true |

**④ EventInspector** (right rail)
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

#### Scenario: layout mode toggle keeps rows interactive
- **GIVEN** a session whose events all have `durationMs = 0`
- **WHEN** the user switches the timeline to sequence mode
- **THEN** every event renders as a distinct uniform-width row in sequence
  order with no time axis
- **AND** clicking any row still opens the EventInspector

#### Scenario: phase axis click locates and opens the step
- **GIVEN** a session with events across `implement` and `debug` phases
- **WHEN** the user clicks the `debug` segment on the phase axis
- **THEN** the timeline scrolls to the first `debug` event, highlights it
  (`selected` style), and the right-side EventInspector shows that step's
  details

#### Scenario: list filters are server-side and paginated
- **GIVEN** more than 50 sessions match the current `q` / `range` / provider /
  status filters
- **WHEN** the user scrolls the list or types in the search
- **THEN** rows are never filtered from only the loaded page
- **AND** the footer shows the filtered `total` and a "load more" button that
  fetches the next keyset page

#### Scenario: input/output badge reflects real data
- **GIVEN** an event whose full tier has `inputSummary` / `outputSummary`
  non-null
- **WHEN** the timeline renders the slim list
- **THEN** the row shows `in`/`out` badges
- **AND** opening the EventInspector Input / Output tabs shows the stored
  bodies, not empty text
