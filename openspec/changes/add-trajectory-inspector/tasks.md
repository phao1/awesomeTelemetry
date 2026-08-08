# Tasks — add-trajectory-inspector (Change B)

**Prerequisite: `fix-adapter-turn-semantics` §6 is green.** Do not start otherwise.

Eight task groups, one execution window each.

```
§1 契约冻结 ──┬── §2 存储 ── §3 API ──┐
              ├── §4 Turn 模型 ───────┼── §6 外壳（最大）── §8 分析 ── §9 签收
              ├── §5 色带几何 ────────┤
              └── §7 渲染器 ──────────┘
```

Parallel-safe after §1: {§2}, {§4}, {§5}, {§7}. §3 needs §2. §6 needs §3, §4, §5, §7.
§8 needs §4. §9 needs everything.

At the end of every group: run that group's targeted tests, then
`npm run typecheck && npm run test && npm run lint`. Mark `[x]` only with evidence.
Do not commit or push unless the user separately asks.

---

## 1. Contract freeze

- [x] 1.1 Confirm Change A is landed: `turnKey`, `TurnKeySource`, the `reasoning` and `compact` kinds all exist in `src/core/trace-types.ts` and the live database has been rescanned. Stop and report if not.
- [x] 1.2 Read `AGENTS.md`, this change's `proposal.md`, `implementation-spec.md`, `design.md`, and all five delta specs; record every conflict before touching implementation.
- [x] 1.3 Add the derived turn types — `TurnSegmentationSource`, `TurnKind`, `MessageRole`, `TurnMessage`, `TurnBadge`, `TraceTurn`, `TurnModel` — to `openspec/contracts/data-model.md`, verbatim from the trace-model delta spec.
- [x] 1.4 Add `SessionAnnotations` and `SessionAnnotationsUpdate` from design D13, and add `tags: string[]` to `SessionIndexEntry`.
- [x] 1.5 Add schema v8 and the `session_annotations` DDL plus index from D15 to `openspec/contracts/database.md`, stating that it is additive and that Change A's migration must preserve it.
- [x] 1.6 Add the three routes from D13 and the `tags` list parameter from D14 to `openspec/contracts/api.md`, with bounds, OR semantics, `400` / `404` behaviour, and the empty-shape `200`.
- [x] 1.7 Add §2.8 Role colours (six groups, three tiers, both themes, mandatory icons) and `--ribbon-active` from D19 to `openspec/contracts/design-tokens.md`.
- [x] 1.8 Add the D20 budgets to `openspec/contracts/nfr.md`, including the session-list tag-join delta requirement.
- [x] 1.9 Copy the new types verbatim into `src/core/trace-types.ts`; extend `src/core/trace-types.test.ts` with shape assertions and a negative assertion that no `toolCallId` field is introduced (identity comes from `event.id`, per D5).
- [ ] 1.10 Run `openspec validate add-trajectory-inspector --strict` and `npm run typecheck`; do not proceed until both pass.

## 2. Storage — schema v8, annotations, tag filter

**Depends on:** §1

- [ ] 2.1 Add the `session_annotations` DDL and its index to `SCHEMA_SQL`; bump `SCHEMA_VERSION` to 8.
- [ ] 2.2 Add the idempotent v7→v8 migration; it creates only the table and index and throws visible rebuild guidance on failure, never a silent catch.
- [ ] 2.3 Add fresh-schema, v7 upgrade, repeated-init, and newer-version-refusal coverage to `server/storage/schema.test.ts`.
- [ ] 2.4 Add a test proving Change A's destructive migration, run against a database that already holds annotations, leaves those rows intact.
- [ ] 2.5 Add the annotation column constants to `server/storage/columns.ts`; never `SELECT *`.
- [ ] 2.6 Create `server/storage/annotations.ts` with `readAnnotations`, `writeAnnotations`, and `listTagVocabulary`, all using module-level cached prepared statements.
- [ ] 2.7 Implement tag normalisation exactly per D13 — trim, lowercase, de-duplicate, sort ascending — and enforce all four bounds by throwing a typed error, never truncating.
- [ ] 2.8 Implement partial-update semantics: absent key untouched, empty array clears tags, null clears the note; convert `undefined` to `null` before writing.
- [ ] 2.9 Extend the session-list query with an OR tag filter and a `tags` array on each row, joining `session_annotations` with no per-row query and no body column.
- [ ] 2.10 Add `EXPLAIN QUERY PLAN` assertions: annotation read is a primary-key lookup; the session list with the tag join gains no `USE TEMP B-TREE`.
- [ ] 2.11 Measure the session list before and after the join against the 524-entry baseline (447.8KB / 5.33ms) and record the delta; stop and report if it degrades materially.
- [ ] 2.12 Add `server/storage/annotations.test.ts` covering empty read creating no row, round trip with normalisation, both partial updates, both clears, every bound violation, a unicode tag, cascade delete, tag vocabulary counts, and OR filtering across two tags.
- [ ] 2.13 Run targeted storage tests, then `npm run typecheck && npm run test && npm run lint`.

## 3. API — annotations and tag filtering

**Depends on:** §2

- [ ] 3.1 Register `GET` and `PUT /api/sessions/:key/annotations`, ordered so existing `:key` routes are not shadowed.
- [ ] 3.2 Register `GET /api/annotations/tags` returning the tag vocabulary with counts.
- [ ] 3.3 Add the `tags` query parameter to `GET /api/sessions`: comma-separated, OR semantics, max 32, invalid → `400 BAD_REQUEST`.
- [ ] 3.4 Map storage bound errors to `400` and unknown session keys to `404 SESSION_NOT_FOUND` through the unified `ApiError` envelope; never leak a stack trace or SQL text.
- [ ] 3.5 Send every response through the existing gzip-aware `sendJson`.
- [ ] 3.6 Add typed client methods to `src/api/client.ts` preserving structured error codes.
- [ ] 3.7 Add contract tests: empty read `200`, round trip, each partial update, each clear, every bound violation, unknown key `404`, malformed body `400`, tag vocabulary shape, OR filtering, 33-tag filter rejection, gzip.
- [ ] 3.8 Add a regression test proving session list and detail shapes are unchanged apart from the added `tags` array.
- [ ] 3.9 Run targeted API tests, then `npm run typecheck && npm run test && npm run lint`.

## 4. Turn model

**Depends on:** §1 (parallel with §2, §5, §7)

- [ ] 4.1 Create `src/core/turn-model.ts` with `deriveTurns(events, session, turnKeySource)`, pure, single pass, no I/O.
- [ ] 4.2 Implement the D3 four-step strategy selection and expose `segmentationSource` on the result.
- [ ] 4.3 Implement `turn_key` segmentation: a changed key opens a turn; a `null` key attaches to the open turn and never opens one.
- [ ] 4.4 Implement the `llm_boundary`, `user_prompt_boundary`, and `sequence_fallback` paths; in fallback emit one turn for everything the user rule does not carve out, and do not chunk by count or time gap.
- [ ] 4.5 Implement turn 0, including the case where it is absent; never shift indices to close the gap.
- [ ] 4.5a Implement the user-input rule: a `user_prompt` after turn 0 always opens a turn of kind `user`, under every strategy, taking precedence over the strategy's own boundary rule; it is never absorbed into an adjacent turn.
- [ ] 4.5b Count all three turn kinds in the turn total, and expose a separate round count derived from `init` plus `user` turns.
- [ ] 4.6 Implement aggregation: wall-clock duration floored at 0, `aggregateTokenUsage` reuse, model resolution, message and tool counts, status precedence error → running → success.
- [ ] 4.7 Implement the D8 badges including `compact`; do not add a `length` badge.
- [ ] 4.8 Implement the D4 event-to-message mapping, including the tool-family kind set and the assistant/reasoning grouping; expose each tool message's `event.id` as its call identity without parsing it.
- [ ] 4.9 Implement completeness from `hasMore` / `eventTotal`.
- [ ] 4.10 Add `src/core/turn-model.test.ts` covering all four segmentation sources, interleaved null keys, turn 0 present and absent, a mid-session user prompt opening its own turn under each of the four strategies, a user prompt sandwiched between two cycles joining neither, wall-clock versus sum on a fixture where they differ, token aggregation against a hand-computed fixture, every badge, each status precedence, all three kinds counted, the round count, empty session, system-and-user-only session, and completeness propagation.
- [ ] 4.11 Add a benchmark asserting 1,000 synthetic events derive in under 20 ms.
- [ ] 4.12 Run targeted core tests, then `npm run typecheck && npm run test && npm run lint`.

## 5. Ribbon geometry

**Depends on:** §1 (parallel with §2, §4, §7)

- [ ] 5.1 Create `src/core/turn-ribbon.ts` with the exact D10 constants and `computeRibbon(turns, mode, containerWidthPx)`.
- [ ] 5.2 Implement proportional widths for both modes with the minimum-width floor.
- [ ] 5.3 Implement the zero-total case as equal widths with no division by zero.
- [ ] 5.4 Implement bucketing above `RIBBON_MAX_SEGMENTS` into equal turn-count buckets carrying their turn range; drop no turn.
- [ ] 5.5 Implement dominant-role selection with the six-role tie order from D10.
- [ ] 5.6 Emit an accessible label per segment naming turn index or range, duration, and token total.
- [ ] 5.7 Add `src/core/turn-ribbon.test.ts` covering proportionality in both modes, the floor, zero total, exactly 200 turns, 201, 500, a single turn, dominant-role ties across all six roles, and label content.
- [ ] 5.8 Add a benchmark asserting 200 turns compute in under 5 ms.
- [ ] 5.9 Run targeted core tests, then `npm run typecheck && npm run test && npm run lint`.

## 6. Detail-view replacement and panels

**Depends on:** §3, §4, §5, §7

- [ ] 6.1 Delete `TraceTimeline.tsx`, `EventInspector.tsx`, and their tests; delete `inspector-text.tsx` and its test only if nothing else imports it; prune the dead selectors from `src/styles/components/timeline.css`.
- [ ] 6.2 Remove the `layout` hash key and add `turn`, `ribbon`, and `tags`; drop invalid values without throwing; extend `src/hash-router.test.ts` with round-trip, invalid-value, and stored-`layout`-ignored cases.
- [ ] 6.3 Add the two layout persistence keys with the 240–300 clamp to `src/layout.ts`; extend `src/layout.test.ts`.
- [ ] 6.4 Add every `trajectory.*` string to both locales in `src/i18n.ts`, including the four segmentation criteria lines, the adapter-provenance criteria line, the incompleteness banner, all four states, and every unavailable-value tooltip; extend `src/i18n.test.ts` for locale parity.
- [ ] 6.5 Add the six role token groups and `--ribbon-active` to `src/styles/tokens.css` for both themes; create `src/styles/components/trajectory.css` and import it from `components.css`; keep `src/styles/tokens.test.ts` green with zero colour literals in the new CSS.
- [ ] 6.6 Create `TrajectoryPane` replacing the deleted timeline and inspector inside the session detail view, keeping `SessionHeaderCard`, `PhaseRibbon`, and `PhaseTiles` above it, and wiring the D16 request budget.
- [ ] 6.7 Create `TrajectoryRail` using the existing split-pane atom with the clamped, persisted width and the sub-1024px collapse.
- [ ] 6.8 Create `AgentHierarchyPanel` per D9: merge-group resolution, one batched key fetch, depth-5 tree, accent selection, unknown-type handling, single-agent root, and agent switching.
- [ ] 6.9 Create `AnnotationsPanel` per D13: immediate tag save, explicit note save disabled when unchanged, success and error toasts carrying the error code, and the never-annotated empty case.
- [ ] 6.10 Create `TrajectoryStatBar` with the D6 agent-scoped pills, the agent name label, the segmentation criteria line, the ribbon mode switch, and the analysis trigger.
- [ ] 6.11 Create `TurnRibbon` rendering computed segments in one commit, with the six-entry legend (swatch + icon + name), hover detail, keyboard activation, and two-way highlight throttled to one update per animation frame.
- [ ] 6.12 Create `TurnList` and `TurnCard`: fixed collapsed row height, virtualisation above 50 turns via the existing hook, expanded turns at natural height outside virtualisation, and the incompleteness banner.
- [ ] 6.13 Create `MessageCard` and `ToolCallBlock` per D4 and D12: assistant card with a collapsed reasoning section and nested tool-call blocks, tool result cards below in order, system / user / compact / subagent cards, the three-state view control, on-demand body and raw fetches, the 100-entry LRU, and all four states.
- [ ] 6.14 Add the tag column and OR tag filter to `SessionList` and `SessionToolbar`, with free-text entry and the vocabulary fetched once when the filter opens.
- [ ] 6.15 Wire everything in `src/App.tsx` without restructuring existing view state; add a back affordance to the detail header.
- [ ] 6.16 Add component tests: detail-open request count, agent switch issuing one batched fetch, card body fetched once and cached, Raw fetched once, ribbon mode switch issuing zero requests, node-count stability at 200 turns, two tool calls rendering as two nested blocks plus two result cards in order, a compact card, all four states in each panel, annotations success and failure, criteria line per segmentation source and per adapter provenance, tag filter OR behaviour, and locale parity.
- [ ] 6.17 Re-run the existing session, compare, proxy, mission, and command-palette tests; remove or rewrite only those that tested the deleted components, and list each in your report.
- [ ] 6.18 Run targeted frontend tests, then `npm run typecheck && npm run test && npm run lint`.

## 7. Tool renderers

**Depends on:** §1 (parallel with §2, §4, §5; integrated in §6)

- [ ] 7.1 Create `renderers/index.ts` with the D11 registry types, `registerToolRenderer`, `resolveToolRenderer`, exact-lowercase matching, and the four shared bounds.
- [ ] 7.2 Create `renderers/json-tree.tsx`: collapsible tree, depth 3, 5-element root array preview, non-JSON fallback to preformatted text.
- [ ] 7.3 Create the `read` renderer per D11.
- [ ] 7.4 Create the `bash` renderer, reusing `src/core/error-classifier.ts` for error lines rather than writing a second pattern list.
- [ ] 7.5 Create the `todowrite` renderer with an icon plus label per status and a priority badge; a coloured dot alone is prohibited.
- [ ] 7.6 Create the `grep` renderer with marked matches.
- [ ] 7.7 Create the `glob` renderer.
- [ ] 7.8 Create the `edit` renderer whose diff rows carry their `+` / `-` sign in addition to background colour.
- [ ] 7.9 Create the `write` renderer.
- [ ] 7.10 Make every renderer total: unparseable input returns `fallback`, never throws; the card then shows raw with a `raw` marker.
- [ ] 7.11 Enforce `RENDER_MAX_CHARS` before parsing so an oversized body never enters a renderer.
- [ ] 7.12 Add renderer tests: a happy path and a malformed path for each built-in, both bounds, registry override of a built-in, unmatched tool falling to default, and a null tool name.
- [ ] 7.13 Run targeted renderer tests, then `npm run typecheck && npm run test && npm run lint`.

## 8. Trajectory analysis

**Depends on:** §4 (integrated in §6)

- [ ] 8.1 Create `src/core/turn-analysis.ts` computing the five sections plus anomalies from `TurnModel`, pure and request-free.
- [ ] 8.2 Implement tool-usage grouping with count-descending, name-ascending ordering.
- [ ] 8.3 Implement both top-ten lists with turn-index-ascending tie-breaking.
- [ ] 8.4 Implement the cache-rate trend with null for a zero denominator.
- [ ] 8.5 Implement the four anomaly rules at exactly the stated thresholds, each entry naming the measured value and the threshold crossed.
- [ ] 8.6 Propagate model incompleteness into the analysis result.
- [ ] 8.7 Create `TrajectoryAnalysisPanel` rendering all sections with the existing chart atoms, icon plus text per anomaly, `—` for every unavailable value, and the incompleteness banner.
- [ ] 8.8 Add `src/core/turn-analysis.test.ts` against a hand-computed fixture, a boundary test per anomaly rule at the threshold and one step past it, a null-cache-rate case, and a zero-turn case.
- [ ] 8.9 Add a panel test asserting zero network requests on open and `—` totals when incomplete.
- [ ] 8.10 Run targeted tests, then `npm run typecheck && npm run test && npm run lint`.

## 9. Verification and sign-off

**Depends on:** all groups

- [ ] 9.1 Run `openspec validate add-trajectory-inspector --strict` with no warnings.
- [ ] 9.2 Run `npm run typecheck && npm run test && npm run lint && npm run build && npm run perf:check`; fix implementation, never relax assertions.
- [ ] 9.3 Audit the diff against the D20 whitelist; revert unrelated edits and stop for confirmation if any required file lies outside it.
- [ ] 9.4 Prove no runtime dependency was added.
- [ ] 9.5 Grep every new CSS and TSX file for hex, rgb, and named colour literals; the count must be zero.
- [ ] 9.6 Audit all AGENTS.md prohibitions, in particular no `SELECT *`, no body leakage into the list projection, no prepare-in-loop, no frontend fetch-per-item, and no `ORDER BY LENGTH`.
- [ ] 9.7 Confirm `TraceTimeline` and `EventInspector` have no remaining imports anywhere in the tree.
- [ ] 9.8 Serve the production build on `127.0.0.1`, open a real rescanned Codex session, and record: turn count, `segmentationSource`, the adapter's declared provenance, first-paint duration, detail-open request count, and how turn 1 renders — assistant card, nested call blocks, result cards.
- [ ] 9.9 Open a real Claude session and confirm no fabricated user card appears after a tool call and that tool results render inside their tool cards.
- [ ] 9.10 Open the one real codearts sub-agent session, confirm the hierarchy renders, and confirm switching agents issues exactly one batched key fetch.
- [ ] 9.11 Annotate two sessions with overlapping tags, confirm OR filtering on the list, restart the server, confirm the annotations survived, then delete one session and confirm its annotation row is gone.
- [ ] 9.12 Re-measure the session list against the 524-entry baseline with the tag join active and record the delta.
- [ ] 9.13 Append derivation time, ribbon computation time, first paint, scroll node counts, and the list delta to `PERF-BASELINE.md`.
- [ ] 9.14 Mark only evidenced tasks complete and report Delivered / Contract mapping / Verification / Needs confirmation exactly as `AGENTS.md` requires, listing prefill/decode, deployment-only session fields, per-message comments, and the separate list page as explicitly not implemented, and naming every deleted test.
