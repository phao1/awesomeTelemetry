## Why

Real-machine verification confirmed three **frontend** deterministic defects
(`UI-TASKS.md` §2 P1-4 / P1-5 / P1-6):

1. **Compare view is 100% unusable** — `App.tsx` and `SampleRail` each hold
   their own session array, so `CompareBoard` always receives `[]` and both
   dropdowns are always empty.
2. **7 empty `catch` blocks silently swallow errors** — every failure looks
   like "clicked but nothing moved": no error code, no message, no retry.
   `SettingsModal` failures stick at "loading" forever.
3. **Transcript unconditionally fetches `mode=full`** — tens of MB for a
   648-event session, violating G11.1.

Meanwhile all five views still render at "it runs" level: the list is three
spans, the Gantt is equal-width rows, Agent overview is a bare table, and
Proxy / Frida have no control entry points.

## What Changes

- **Shared session store**: the session index is owned solely by `App.tsx`;
  `SessionList` becomes a controlled component — fixing the compare view.
- **Four-state rendering**: all async regions implement loading / empty /
  error+retry / ready; every empty `catch` eliminated, with a CI assertion
  forbidding regression.
- **AppShell**: global header + underline tabs + three columns + status bar;
  left/right rails draggable, collapsible, and persisted.
- **Five views redone**: session list two-line dense; detail main area gains a
  **PhaseRibbon** and time-proportional Gantt; Agent overview KPI cards +
  inline bars; compare view search pickers + verdict strip; Proxy / Frida get
  control strips and detail drawers.
- Transcript switches to paginated fetch + virtual scroll inside the modal.

**BREAKING** (internal only): `SampleRail` → `SessionList`,
`TraceGanttTree` → `TraceTimeline`, test files renamed in sync. No external
API changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

No deltas. This change implements `specs/frontend/spec.md` REQ-015~023 and
REQ-026 plus `specs/design-system/spec.md` REQ-006/007; the specs landed on
2026-08-04, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

| Area | Impact |
|------|--------|
| Code | `src/App.tsx` refactored; all view components in `src/components/` redone; two component renames |
| Dependencies | depends on `add-design-system` (tokens + icons + base components) and `fix-session-data-integrity` (non-empty data) |
| Tests | existing `AgentOverview.test.tsx` / `TraceGanttTree.test.tsx` updated in sync with renames and structure |
| Performance | still bound by REQ-003 (agent view 1 request) and REQ-006 (9,590-event DOM < 500) |
| Risk | the largest change surface; one commit per view recommended |
