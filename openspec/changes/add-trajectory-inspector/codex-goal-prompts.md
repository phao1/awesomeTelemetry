# Codex `/goal` prompts — add-trajectory-inspector (Change B)

Eight windows, one per task group. Paste into a fresh Codex window after `/goal`.
Do not shorten a prompt before its first run.

**Model:** codex + deepseek-v4-flash. **Working directory:** repo root.
**Do not start any window until `fix-adapter-turn-semantics` (Change A) §6 is green.**

| Window | Task group | Depends on | Parallel with |
|---|---|---|---|
| B1 | §1 contract freeze | Change A | nothing |
| B2 | §2 storage | B1 | B4, B5, B7 |
| B3 | §3 API | B2 | B4, B5, B7 |
| B4 | §4 turn model | B1 | B2, B3, B5, B7 |
| B5 | §5 ribbon geometry | B1 | B2, B3, B4, B7 |
| B6 | §6 detail-view replacement | B3, B4, B5, B7 | B8 |
| B7 | §7 tool renderers | B1 | B2, B3, B4, B5 |
| B8 | §8 analysis | B4 | B6, B7 |
| B9 | §9 sign-off | all | nothing |

B2 / B4 / B5 / B7 touch disjoint files (design D20) and are safe to run concurrently.
B6 is the largest window and integrates B4, B5, and B7.

---

## Shared preamble

Repeated in every prompt on purpose — a fresh window has no memory of the others.

```text
Read first, in this exact order:
1. AGENTS.md — document priority, ten prohibitions, five must-dos, output format
2. openspec/changes/add-trajectory-inspector/proposal.md — boundary
3. openspec/changes/add-trajectory-inspector/implementation-spec.md — FR map, the
   16-row conflict register, acceptance criteria, and the edge-case table
4. openspec/changes/add-trajectory-inspector/design.md — fixed decisions D1-D20,
   including the file whitelist in D20
5. openspec/changes/add-trajectory-inspector/specs/*/spec.md — the delta specs
6. openspec/changes/add-trajectory-inspector/tasks.md — your task group
7. openspec/contracts/{data-model,database,api,design-tokens,nfr}.md and
   openspec/gotchas.md before each module edit

Field names, table names, routes, enum values, limits, error codes, tokens, and UI
states come from those files. Do not write any of them from memory.

Prerequisite: the change fix-adapter-turn-semantics is landed. Confirm that
src/core/trace-types.ts carries `turnKey`, `TurnKeySource`, and the `reasoning` and
`compact` kinds. If it does not, STOP and report — this whole change reads that data.

Source-spec note: tempspec0806/new_view.md and the reference screenshot are product
input, NOT the contract. implementation-spec.md §3 lists 16 deliberate deviations
(C1-C16). Restoring any of them to match the source is a regression, not a fix. Note
especially C7: an earlier draft claimed no tool-call id exists. That was wrong —
event.id carries the native call id. Display it verbatim; do not add a toolCallId field
and do not generate one.

Rules that apply to every window:
- Touch only the files in design.md D20. If another file is truly required, STOP and
  report the requirement id, the file, and the reason before editing.
- No new runtime dependency. The project allows exactly four.
- No hex/rgb/named colour literal in any new CSS or TSX. Read design tokens.
- Colour never carries meaning alone: always pair it with an icon or text.
- Selection is the accent group. Red is danger and means failure — never selection.
- Unknown values render an em dash with a tooltip, never 0.
- Tests live next to source as foo.ts + foo.test.ts, never in __tests__/.
- Convert undefined to null before writing to the database.
- Never mock the logic under test and never loosen an assertion to make a test pass.
- Mark a tasks.md checkbox [x] only when the evidence for it exists.
- Do not commit or push unless the user separately asks.

Stop and ask — do not guess through — if: Change A is not landed; a contract conflicts
with the design; a required field/route/error/token is missing; you need a file outside
D20; a performance budget cannot be met within the stated bounds; the session-list tag
join degrades the measured list baseline; or turn segmentation would require inventing a
boundary the data does not support.

Final response format:
## Delivered
- path — one-line result
## Contract mapping
- implements <requirement names>
- not implemented: <task ids and reasons>
## Verification
- exact commands and pass counts
## Needs confirmation
- none, or precise blockers only
```

---

## B1 — Contract freeze

```text
/goal Freeze the contracts for openspec/changes/add-trajectory-inspector/, then stop. Keep working until every task in §1 of that change's tasks.md is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Your scope is tasks.md §1 only (1.1 through 1.10). Write no implementation beyond type
definitions in src/core/trace-types.ts and their tests.

Task 1.1 is a gate, not a formality: confirm Change A landed AND that the live database
was rescanned. If events still carry null turn keys everywhere, this change's primary
segmentation path is dead on arrival — report it and stop.

Then amend five contracts:
1. data-model.md — the derived turn types verbatim from specs/trace-model/spec.md, plus
   SessionAnnotations / SessionAnnotationsUpdate from D13, plus `tags: string[]` on
   SessionIndexEntry.
2. database.md — schema v8, the session_annotations DDL and index from D15. State
   explicitly that Change A's destructive migration must preserve this table — that is
   why Change A enumerates the tables it clears instead of writing an exclusion list.
3. api.md — the three routes from D13 and the `tags` list parameter from D14, with
   bounds, OR semantics, 400/404 behaviour, and the empty-shape 200.
4. design-tokens.md — §2.8 Role colours: six groups, three tiers, both themes, each with
   a mandatory icon, plus --ribbon-active.
5. nfr.md — the D20 budgets including the session-list tag-join delta requirement.

Then copy the new types verbatim into src/core/trace-types.ts and extend its test with
shape assertions plus a NEGATIVE assertion that no toolCallId field is introduced —
identity comes from event.id (deviation C7).

Definition of done: openspec validate add-trajectory-inspector --strict passes, typecheck
passes, test and lint pass, §1 boxes checked with evidence, and every conflict you found
between the source spec, the design, and the existing contracts is listed in your report.
```

---

## B2 — Storage: schema v8, annotations, tag filter

```text
/goal Implement task group §2 of openspec/changes/add-trajectory-inspector/tasks.md — the annotations table, its reader and writer, and the session-list tag join. Keep working until every §2 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete. If openspec/contracts/database.md does not describe schema
v8, STOP and report.

Your scope is tasks.md §2 only (2.1 through 2.13). Files: server/storage/{schema,columns,
query-engine}.ts with their tests, and the new annotations.ts / annotations.test.ts. Do
not touch server/server.ts — routes are B3.

Non-negotiables:
- SCHEMA_VERSION 7 -> 8, one idempotent CREATE TABLE + CREATE INDEX, altering nothing.
- Migration failure throws with rebuild guidance. A silent catch is a rework condition.
- Module-level cached prepared statements. No db.prepare() in a loop. No SELECT *.
- Tag normalisation is exactly D13: trim, lowercase, de-duplicate, sort ascending. Bounds
  are 32 tags, 64 chars per tag, /^[\p{L}\p{N}_-]{1,64}$/u, 8192-char note. A violated
  bound throws a typed error. Silent truncation is prohibited.
- Partial update: absent key untouched, empty array clears tags, null clears the note.
- Reading a session with no row returns empty/null/null and creates nothing.

Task 2.4 protects the user's own data and is easy to overlook: Change A's migration
clears four tables by name. Write a test that runs Change A's migration against a
database that ALREADY holds annotations and asserts the rows survive. If they do not,
Change A's deletion list is wrong — report it rather than working around it here.

Tasks 2.9 through 2.11 are the risky part. The session list is the app's hottest query,
with a recorded baseline of 524 entries at 447.8KB / 5.33ms. You are adding a join.
Requirements: one join evaluated once, never a query per row; every existing body-column
exclusion preserved; EXPLAIN QUERY PLAN showing no USE TEMP B-TREE; and a measured
before/after cost recorded. If the cost degrades materially, STOP and report — do not
ship a slower list to get a tag column.

Definition of done: §2 boxes checked with evidence, targeted storage tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## B3 — API: annotations and tag filtering

```text
/goal Implement task group §3 of openspec/changes/add-trajectory-inspector/tasks.md — the annotation routes, the tag vocabulary route, and the session-list tags parameter. Keep working until every §3 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §2 is complete and green. If server/storage/annotations.ts does not exist,
STOP and report.

Your scope is tasks.md §3 only (3.1 through 3.9). Files: server/server.ts,
server/server.test.ts, src/api/client.ts. Build no UI — that is B6.

Routes, per the contract frozen in B1:
  GET  /api/sessions/:key/annotations
  PUT  /api/sessions/:key/annotations
  GET  /api/annotations/tags
Plus the `tags` query parameter on GET /api/sessions: comma-separated, OR semantics,
max 32, invalid -> 400 BAD_REQUEST.

Register the :key routes where the existing /api/sessions/:key routes will not shadow
them — read how prompt-context and events/:eventId are ordered in server.ts and follow
that pattern. Register /api/annotations/tags so it is not captured by a :key pattern.

Non-negotiables:
- All non-2xx responses use the unified ApiError envelope from contracts/api.md §0.3.
- Storage bound errors -> 400 BAD_REQUEST. Unknown session key on PUT -> the existing
  404 SESSION_NOT_FOUND code (look it up; do not invent one).
- GET on an unannotated session returns 200 with the empty shape, NOT 404. A user who has
  never tagged a session is not an error condition.
- Never leak a stack trace, SQL text, or the raw body in an error response.
- Everything goes through the existing gzip-aware sendJson.
- OR semantics for tags, matching the existing provider/status filters. Not AND.

Task 3.8: prove the session list and detail responses are unchanged apart from the added
tags array. That regression test is what lets B6 trust the list.

Definition of done: §3 boxes checked with evidence, targeted API tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## B4 — Turn model

```text
/goal Implement task group §4 of openspec/changes/add-trajectory-inspector/tasks.md — the derived turn model. Keep working until every §4 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete — the derived turn types exist in src/core/trace-types.ts.
If not, STOP and report.

Your scope is tasks.md §4 only (4.1 through 4.12). Files: src/core/turn-model.ts and its
test. Nothing else — no component, no route, no CSS.

This is the load-bearing module. The ribbon, the turn list, and the analysis panel all
read its output. Read design D3 and D4 and specs/trace-model/spec.md in full before
writing a line; the algorithm is fully specified there.

The product definition of a turn, stated by the user and normative here: a turn is one
piece of thinking plus the actions that thinking took, AND a user input is also a turn.
So there are three kinds — `init`, `user`, `cycle` — in ONE flat ordered list. All three
count. There is deliberately no second layer grouping cycles under conversation rounds:
a `user` turn is itself the round boundary, and nesting would add structure without
adding information.

The five things most likely to go wrong:

0. A USER INPUT ALWAYS OPENS ITS OWN TURN, under every strategy, taking precedence over
   that strategy's own boundary rule. It is never absorbed into the cycle that follows it
   and never appended to the cycle before it. This is easy to get wrong in the `turn_key`
   path specifically, where the key may not change at a user prompt — check the kind, not
   only the key.

1. TURN KEY FIRST, FALLBACK SECOND. If any event carries a non-null turnKey, segmentation
   is `turn_key`. A null key ATTACHES to the open turn and never opens one — Change A
   deliberately leaves keys null where a source has no boundary signal, and treating null
   as a boundary would shatter those sessions into one turn per event.

2. WALL-CLOCK DURATION. Last member end minus first member start, floored at 0. NOT the
   sum of member durations. Write the test on a fixture where the two differ.

3. INDICES ARE NEVER RENUMBERED. When there is no leading system/user run there is no
   turn 0, and the first turn keeps index 1. Closing that gap hides real information.

4. ONE TOOL EVENT FEEDS TWO PLACES (design D4). After Change A a tool event carries both
   its arguments and its result. Its arguments belong to the assistant message as a call
   block; its result is its own message ordered after. Model both from the one event —
   do not duplicate the event and do not drop either side. Expose event.id as the call
   identity WITHOUT parsing it.

Also: reuse aggregateTokenUsage from src/core/metrics.ts. Do not re-derive per-adapter
cache-read semantics locally — data-model §2 documents why that is a trap.

Definition of done: §4 boxes checked with evidence including the 1,000-event benchmark
under 20 ms, targeted core tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## B5 — Ribbon geometry

```text
/goal Implement task group §5 of openspec/changes/add-trajectory-inspector/tasks.md — the turn ribbon geometry module. Keep working until every §5 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete. This module depends only on the TraceTurn type, not on B4's
implementation, so it runs in parallel with B4.

Your scope is tasks.md §5 only (5.1 through 5.9). Files: src/core/turn-ribbon.ts and its
test. Pure geometry — no React, no DOM, no CSS. The component is B6.

Use the design D10 constants verbatim: RIBBON_HEIGHT_PX 28, RIBBON_MIN_SEGMENT_PX 2,
RIBBON_MAX_SEGMENTS 200, RIBBON_TRANSITION_MS 200. Do not raise a bound because a fixture
is awkward.

computeRibbon(turns, mode, containerWidthPx) -> { segments, totalWidthPx, mode }
'time' weight = durationMs; 'token' weight = tokens.total.

Four behaviours that must be right:

1. Width = max(RIBBON_MIN_SEGMENT_PX, weight / totalWeight * containerWidthPx). A
   zero-weight turn stays visible as a 2px line — an invisible turn is a lie about the
   session's shape.
2. totalWeight === 0 gives every segment equal width. Never divide by zero.
3. Above 200 turns, bucket into 200 equal turn-count buckets, each carrying its turn
   range. Drop no turn. Do not render 500 nodes.
4. Segment colour is the dominant role by message count, ties broken
   system > user > assistant > tool > reasoning > compact. Six roles now — reasoning and
   compact are real kinds after Change A. Every segment also carries an accessible label
   with turn index or range, duration, and token total; for a purely graphical element
   that label is what satisfies the colour-never-alone rule.

Definition of done: §5 boxes checked with evidence including the 200-turn benchmark under
5 ms, targeted core tests green, then npm run typecheck && npm run test && npm run lint
all green.
```

---

## B6 — Detail-view replacement and panels

```text
/goal Implement task group §6 of openspec/changes/add-trajectory-inspector/tasks.md — delete the event gantt and inspector, and build the turn surface, the context rail panels, and the session-list tag filter in their place. Keep working until every §6 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisites: §3, §4, §5, and §7 are all complete and green. If any is missing, STOP and
report rather than stubbing around it.

This is the largest window. Scope is tasks.md §6 only (6.1 through 6.18). Work in this
order and run targeted tests after each step — do not write fourteen components and then
start testing.

  6.1-6.5   deletion + plumbing: remove TraceTimeline / EventInspector / layout hash key,
            add hash and layout keys, i18n strings, tokens and CSS
  6.6-6.7   TrajectoryPane + TrajectoryRail
  6.8-6.9   AgentHierarchyPanel + AnnotationsPanel
  6.10-6.11 TrajectoryStatBar + TurnRibbon
  6.12-6.13 TurnList / TurnCard / MessageCard / ToolCallBlock
  6.14-6.18 session-list tags, App wiring, tests, regression, gate

What you are replacing, and what you are NOT (design D2): TraceTimeline and
EventInspector are DELETED. SessionHeaderCard, PhaseRibbon, and PhaseTiles STAY — they
answer "how did this session go", which the turn list does not answer. Do not delete them
and do not duplicate session identity into the rail.

The card structure is the part most likely to be built wrong (design D4, deviation C15).
For a turn with two tool calls the correct rendering is:

  [Assistant card]
     reasoning section (collapsed by default)
     reply text
     ┌ tool call block: name, call id, arguments ┐   <- nested INSIDE the assistant card
     └ tool call block: name, call id, arguments ┘
  [Tool result card #1]
  [Tool result card #2]

Not two sibling "Tool Call" cards. A tool call is part of the assistant message; a tool
result is a separate message. Both sides come from ONE event.

The request budget is a hard contract (design D16). Opening a detail issues its existing
slim request plus one annotations request. Expanding a card body issues one single-event
request; switching to Raw issues one more; both cached in a 100-entry LRU. Ribbon mode
switch, turn expand/collapse, and the analysis panel issue ZERO. Tests must assert exact
counts — "roughly right" is not acceptable here.

Five things the source spec and screenshot show that you must NOT do:
- No red selection. Red is danger. Selection is accent. (C3)
- No 💬 comment control on cards — explicitly declined. (C10)
- No environment / employee id / client version / plugin version rows. (C8)
- No prefill/decode unless session.durationSource === 'native'. Never estimate. (C6)
- No colour literals. src/styles/tokens.test.ts enforces this and must stay green. (C1)

Unknown values render an em dash with a tooltip. Rendering 0 for an unknown value
violates frontend REQ-017. Every async surface implements all four states.

Both locales get every trajectory.* string, including the FOUR segmentation criteria
lines and the adapter-provenance line. The frontend must not write its own criteria
wording.

Task 6.17: some existing tests only exist to test the deleted components. Remove or
rewrite exactly those, and list every one in your report. Do not delete a test that was
covering something still alive.

Definition of done: §6 boxes checked with evidence, targeted frontend tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## B7 — Tool renderers

```text
/goal Implement task group §7 of openspec/changes/add-trajectory-inspector/tasks.md — the tool renderer registry and its eight renderers. Keep working until every §7 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete. This window depends on no other implementation window and
runs in parallel with B2, B3, B4, and B5. B6 integrates the result.

Your scope is tasks.md §7 only (7.1 through 7.13). Files: everything under
src/components/trajectory/renderers/. Do not touch MessageCard, TurnList, or any other
component — integration is B6's task 6.13.

Build the registry first (7.1), then the default JSON tree (7.2), then the seven
built-ins (7.3-7.9). Read design D11 for each renderer's exact behaviour.

Registry: registerToolRenderer / resolveToolRenderer, matching on event.tool lowercased
and trimmed, exact; unmatched falls to default.

Bounds, verbatim: RENDER_MAX_LINES 200, RENDER_MAX_CHARS 100_000,
JSON_TREE_DEFAULT_DEPTH 3, JSON_TREE_ARRAY_PREVIEW 5.

Two rules decide whether this window succeeds:

1. EVERY RENDERER IS TOTAL. Unparseable input returns { kind: 'fallback' } — it never
   throws, and it never renders a half-parsed structure as if complete. The card then
   shows raw text with a small "raw" marker so the reader knows what they are looking at.
   A renderer that throws takes down the turn card around it.

2. RENDER_MAX_CHARS IS CHECKED BEFORE PARSING. A 200 KB tool result must not enter a JSON
   parser at all; show raw plus a truncation notice.

Colour never carries meaning alone (deviation C2 — the source spec used colour-only dots
and colour-only diff rows):
- todowrite status is an icon PLUS a label, never a coloured dot alone.
- edit diff rows carry their + or - sign in addition to the background colour.
- grep matches are marked structurally, not only by highlight colour.

Reuse src/core/error-classifier.ts to detect error lines in bash output. Do not write a
second error-pattern list.

Definition of done: §7 boxes checked with evidence, targeted renderer tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## B8 — Trajectory analysis

```text
/goal Implement task group §8 of openspec/changes/add-trajectory-inspector/tasks.md — the client-side trajectory analysis module and panel. Keep working until every §8 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §4 is complete — src/core/turn-model.ts exists and its tests pass. If not,
STOP and report. The panel (8.7) also needs B6's stat bar to mount it; if B6 has not
landed, deliver 8.1-8.6 and 8.8 and leave 8.7 / 8.9 unchecked with an honest note.

Your scope is tasks.md §8 only (8.1 through 8.10). Files: src/core/turn-analysis.ts and
its test, plus TrajectoryAnalysisPanel.tsx and its test.

Read implementation-spec.md §2 and specs/metrics-analysis/spec.md. The analysis is pure
arithmetic over the already-loaded TurnModel: ZERO network requests, NO model call. The
source spec's 分析 button implies a service, while §1.4 of that same spec forbids model
calls; this change resolves it as client-side computation (C11). A test asserts the
request count is zero.

Determinism matters — humans compare these lists across runs:
- tool usage orders by call count descending, ties by tool name ascending
- both top-10 lists order descending, ties by turn index ascending

Cache rate = cacheRead / (input + cacheRead), null when the denominator is 0. A null rate
renders an em dash, never 0. Note this is NOT the source spec's cached/input formula —
data-model §2 documents why (C14).

The four anomaly thresholds are FIXED. Do not tune one to make a fixture pass:
  slow turn   durationMs > 30_000                  danger
  high input  tokens.input > 50_000                attention
  tool error  a member with tool !== null errored  danger
  low cache   cache rate non-null and < 0.5        attention

Each entry carries { rule, turnIndex, detail }, and detail names the measured value and
the threshold crossed. In the panel each entry gets an icon plus text, not colour alone.

An incomplete turn model makes the analysis incomplete: banner shown, every total an em
dash.

Test the boundaries exactly: at the threshold no anomaly fires, one step past it one
does. Also cover a null cache rate raising no low-cache anomaly, and a zero-turn session
reporting empty rather than failing.

Definition of done: §8 boxes checked with evidence, targeted tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## B9 — Verification and sign-off

```text
/goal Run task group §9 of openspec/changes/add-trajectory-inspector/tasks.md — full verification and sign-off. Keep working until every §9 task is either done and evidenced or explicitly reported as blocked. Do not mark a box optimistically.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 through §8 are complete. Begin by reading tasks.md and listing every
unchecked box from an earlier group — those are inputs to your report, not things to
quietly finish.

Your scope is tasks.md §9 only (9.1 through 9.14). This window verifies; it does not add
features. If verification finds a defect, fix the implementation — never relax an
assertion and never widen a bound to make a measurement pass.

Gates, in order:
  9.1  openspec validate add-trajectory-inspector --strict, zero warnings
  9.2  typecheck, test, lint, build, perf:check
  9.3  diff audit against the D20 whitelist; STOP and ask if a required file is outside it
  9.4  package.json + package-lock.json diff proving no runtime dependency was added
  9.5  grep every new CSS and TSX file for hex, rgb, and named colour literals — zero
  9.6  AGENTS.md prohibition audit
  9.7  confirm TraceTimeline and EventInspector have no remaining imports anywhere

Live verification (9.8-9.12) is what tests cannot cover:

  9.8  serve the production build on 127.0.0.1, open a real rescanned Codex session.
       Record turn count, segmentationSource, the adapter's declared provenance,
       first-paint duration, detail-open request count, and how turn 1 renders —
       assistant card, nested call blocks, result cards. If the turn count still looks
       like one turn per event, Change A did not take effect on this data; report it
       rather than passing the gate.
  9.9  open a real Claude session. Confirm NO fabricated user card appears after a tool
       call and that tool results render inside their tool cards. This is the visible
       proof of Change A's §3 repair.
  9.10 open the one real codearts sub-agent session, confirm the hierarchy renders and
       that switching agents issues exactly one batched key fetch.
  9.11 annotate two sessions with overlapping tags, confirm OR filtering on the list,
       restart the server, confirm annotations survived, delete one session, confirm its
       annotation row is gone.
  9.12 re-measure the session list against the 524-entry / 447.8KB / 5.33ms baseline with
       the tag join active; record the delta.
  9.13 append derivation time, ribbon computation time, first paint, scroll node counts,
       and the list delta to PERF-BASELINE.md

Your final report must list these as explicitly NOT implemented, with reasons:
  - per-turn prefill / decode timing (no adapter emits it; proxy_requests is empty)
  - environment / employee id / client version / plugin version session rows
  - per-message comments (declined)
  - a separate session-list page (the existing list gained a tag column and filter)
It must also name every test file you deleted or rewrote in task 6.17.

Report Delivered / Contract mapping / Verification / Needs confirmation exactly as
AGENTS.md requires. tasks.md must reflect evidence, not optimism.
```

---

## Recovery prompt

```text
/goal Resume task group §<N> of openspec/changes/add-trajectory-inspector/tasks.md.

First: read AGENTS.md, then this change's proposal.md, implementation-spec.md, design.md,
the delta specs for the modules in §<N>, and tasks.md.

Then: run `git status` and `git diff` to see what already exists, run the targeted tests
for §<N>, and report which §<N> tasks are genuinely done versus partially done, before
writing anything new.

Then continue §<N> from the first genuinely incomplete task, under the same rules as the
original window: D20 file whitelist only, no new dependency, no colour literals, accent
for selection, no relaxed assertions, evidence before a checked box. Do not commit or
push unless asked.
```
