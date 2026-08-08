## Why

Change B of two. `fix-adapter-turn-semantics` (Change A) repairs the event stream so that
decision-cycle boundaries, reasoning, compaction, tool results, and native call identity
all survive into the contract. This change spends that data.

Today a session's detail view shows a flat gantt of events plus a right-rail inspector.
A developer debugging an agent has to reconstruct "what happened on turn 7" by eye, and
has to open a drawer to read anything. The unit they think in — a Think → Act → Observe
cycle — is not a unit the UI has.

This change replaces the gantt and the inspector with a turn-granular reading surface:
a proportional turn ribbon, an expandable turn list, and in-place message cards where an
assistant reply carries its own tool calls and each tool result follows as its own card.
It also adds the only persisted state the workflow needs — session tags and a note — and
surfaces those tags back on the session list so a labelled session can be found again.

## What Changes

- **Replace** `TraceTimeline` and `EventInspector` in the session detail view with a turn
  ribbon plus a turn list. `SessionHeaderCard`, `PhaseRibbon`, and `PhaseTiles` stay: they
  answer "how did this session go", which the turn list does not.
- Add a **turn model** derived from `turnKey`, with a declared fallback chain and a
  criteria line whenever the adapter's provenance is not `native_boundary`. The frontend
  never invents a boundary and always says which rule it used.
- Add **role message cards** — system, user, assistant, tool, reasoning, compact. An
  assistant card carries its own tool-call blocks (name, native call id, arguments)
  because a tool call *is* part of the assistant message; each tool result renders as its
  own card below.
- Sink the removed inspector's capabilities **into the cards**: a per-card
  rendered / source / raw control, with raw fetched on demand exactly as the inspector
  did. Token figures live in the card header and the turn meta row, so no separate tab is
  needed.
- Add **tool-specific renderers** (`read`, `bash`, `todowrite`, `grep`, `glob`, `edit`,
  `write`, default JSON tree) behind a registry, each total and bounded.
- Add a **turn ribbon** with time and token width modes, hover detail, click-to-scroll,
  and two-way highlight with the turn list.
- Add an **agent hierarchy panel** built from existing merge-group and subagent data.
- Add **session annotations**: tags and a free-text note, persisted in one additive table
  behind one route pair.
- Add a **tag column and tag filter** to the existing session list — multi-select with
  OR semantics, matching the existing provider and status filters, with free-text tag
  entry.
- Add a **trajectory analysis panel** computed entirely client-side: tool-usage table,
  top-10 duration, top-10 tokens, cache-rate trend, rule-based anomalies. No model call,
  no new endpoint.

## Capabilities

### New Capabilities

- `trajectory-inspector`: turn derivation and provenance disclosure, turn aggregation, the
  message-card contract, the tool-renderer registry, ribbon geometry, agent-hierarchy
  resolution, annotation lifecycle, and unavailable-data rendering rules.

### Modified Capabilities

- `trace-model`: adds the derived turn types and the rule that derivation is pure,
  re-runnable, and never persisted.
- `storage`: adds a `session_annotations` table, its indexed lookup, and tag filtering for
  the session list.
- `frontend`: replaces the timeline and inspector in the session detail view, adds the
  turn surface and sidebar panels, and adds the session-list tag column and filter.
- `design-system`: adds role tokens with mandatory icon pairings and forbids the source
  spec's literal palette and red-for-selection.
- `metrics-analysis`: adds turn-level aggregation and the anomaly detector.

## Impact

- **Contracts:** additive changes to `data-model.md` (turn and annotation types),
  `database.md` (schema v8 annotations table), `api.md` (annotations route pair, session
  list `tags` parameter), `design-tokens.md` (role tokens), `nfr.md` (derivation and
  ribbon budgets).
- **Backend:** schema, an annotations reader/writer, two routes, one list-query extension.
- **Frontend:** two components deleted, ~14 added, 3 core modules, a renderer registry,
  bilingual strings, styles, colocated tests.
- **Removed:** `TraceTimeline` and `EventInspector` with their tests, and the
  `layout=time|sequence` hash key they own.
- **Performance:** derivation is O(events) and runs once per detail load; the ribbon
  renders at most 200 segments; the turn list reuses `useVirtualList`. Rendering a turn
  issues no request.
- **Dependencies:** none added.
- **Source spec:** `tempspec0806/new_view.md` v0.1.0 plus the reference screenshot
  reviewed 2026-08-07. Its literal palette, red-for-selection, `/api/trajectory/*` routes,
  separate list page, per-message comment control, and deployment-only session fields are
  deliberately not adopted; see `implementation-spec.md` §3.
