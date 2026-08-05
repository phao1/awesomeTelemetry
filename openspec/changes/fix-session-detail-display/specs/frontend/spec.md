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

**Filter area** (list top, `--row-md` height): `SearchInput` (`/` focus) +
provider multi-select + status multi-select. The search SHALL match both the
session title and the session ID (including prefix matches on the provider
key, e.g. `codearts-`), and the placeholder SHALL say "title / id". Filters
MUST be reflected in the URL hash for sharing and refresh persistence.

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

Four segments top to bottom:

**① SessionHeaderCard**
- First row: `ProviderBadge` + session title (`--text-xl`) + `StatusBadge` +
  overflow menu (rescan / delete / copy id / export report)
- Second row meta: `cwd` (monospace, copyable) · start/end times · duration ·
  model
- Third row **four-dimension metric strip**: 4 `MetricCard`s
  (Speed / Accuracy / Stability / Cost); `null` values display `—` with a
  tooltip explaining why; MUST NOT show `0` as a stand-in.

**② PhaseRibbon**
A horizontal color band spanning the full width on the time axis; each
segment's width = that phase's time share, color = `--phase-*`. Hover shows
phase name + duration + event count; click equals selecting only that phase.
Height 8px, `--radius-full`.

**③ PhaseTiles**
6 tiles; selected state uses that phase's `-subtle` background + same-hue text
+ icon; each tile carries a count badge. Plus "select all / deselect all" and
the currently visible event count.

**④ TraceTimeline**
Row height `--row-sm` (28px), virtual scroll, and a toolbar toggle with two
layout modes:

- **Time mode** (default): bars positioned on a real time axis; left offset and
  width computed from the event's position/duration; supports axis zoom and
  relative/absolute time labels; zero-duration events render as a minimum 2px
  vertical line, never invisible.
- **Sequence mode**: bars laid out uniformly by `sequence` order (equal-width
  cells, axis labeled by sequence number); duration text still shows the real
  duration; time-axis zoom is disabled.

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

#### Scenario: layout mode toggle keeps rows interactive
- **GIVEN** a session whose events all have `durationMs = 0`
- **WHEN** the user switches the timeline to sequence mode
- **THEN** every event renders as a distinct uniform-width row in sequence
  order with no time axis
- **AND** clicking any row still opens the EventInspector

#### Scenario: input/output badge reflects real data
- **GIVEN** an event whose full tier has `inputSummary` / `outputSummary`
  non-null
- **WHEN** the timeline renders the slim list
- **THEN** the row shows `in`/`out` badges
- **AND** opening the EventInspector Input / Output tabs shows the stored
  bodies, not empty text
