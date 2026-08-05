## Context

With the two prerequisite changes done, the data is real and the tokens and
components are in place. This change assembles them into pages.

The constraints remain the existing performance clauses of
`specs/frontend/spec.md`: agent view 1 request (REQ-003), 9,590-event session
DOM < 500 (REQ-006), detail defaults to slim (G11.1). Design cannot sacrifice
these — v4 fell to a 5.9-12.4s first screen precisely after "the UI looked
nicer".

## Goals / Non-Goals

**Goals:**
- all five views usable (currently compare is completely unusable, and
  proxy/frida have no entry points)
- every failure has a visible, diagnosable, retryable presentation
- first-screen list is scannable; detail shows "where the time went" at a
  glance

**Non-Goals:**
- no command palette or shortcuts (in `add-palette-and-a11y`)
- no URL state sync (same)
- no backend API changes (the data layer is `fix-session-data-integrity`'s job)

## Decisions

**D1 · The session store moves up to `App.tsx`; `SessionList` becomes a pure
controlled component.**
The alternatives — Context / state library — were rejected: Context
re-renders the whole tree on list updates, and a state library violates
zero-dependencies. A single `useState` + props down is the simplest sufficient
approach, and with the existing `startTransition` already covers scheduling
needs.

**D2 · Four states are a component-level contract, not "just add an if".**
Unified `Skeleton` / `EmptyState` / `ErrorState` components + a
`useAsyncState` convention, making "forgot the empty state" an explicit
missing piece rather than an implicit blank. Plus lint/test assertions
forbidding empty-`catch` regression.

**D3 · PhaseRibbon is the product signature, prioritized over Gantt details.**
"See at a glance where this session spent its time" is this product's core
difference from a plain log viewer. A color band spanning full width by time
share is low cost and high information density.

**D4 · The Gantt positions by real time proportion, not equal-width rows.**
Equal-width rows throw away the time information — that's just a list.
Zero-duration events render as a minimum 2px vertical line so they never
vanish.

**D5 · Compare view gives a "verdict strip" before charts.**
Developers want "who is faster by how much", not two columns of numbers to
compare themselves. One sentence as the verdict, charts as evidence.

**D6 · One commit per view.**
This change has the largest surface; fine-grained commits enable precise
rollback when something breaks (AUTOPILOT §3).

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| large surface, easy to leave half-finished pieces | one commit per view; AUTOPILOT §7 requires stopping on a complete commit |
| component renames break existing tests | rename and tests in sync; assertions themselves never loosened (prohibition A) |
| Gantt time-proportion math distorts on extreme data (one event = 99%) | min/max width clamps; zero-duration minimum 2px |
| new visual elements slow rendering | no `box-shadow`/`filter` in rows; no transitions inside virtual-scroll containers (G-DS-4) |
| Agent overview expanded rows tempt per-session fetches | expanded rows reuse the shared store; G11.9 is a prohibition — review focuses on this |
| four-state refactor misses a spot | check one by one against the 7-row table in `specs/frontend/spec.md` REQ-022; the table is the checklist |
