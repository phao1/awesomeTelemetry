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
- [x] 1.10 Run `openspec validate add-trajectory-inspector --strict` and `npm run typecheck`; do not proceed until both pass. (evidence: 由 §9.1/9.2 门槛证据覆盖 —— `openspec validate add-trajectory-inspector --strict` exit 0 无警告；`npm run typecheck` exit 0。此前该框未勾，本轮 §9 门槛产生完全相同证据后勾选)

## 2. Storage — schema v8, annotations, tag filter

**Depends on:** §1

- [x] 2.1 Add the `session_annotations` DDL and its index to `SCHEMA_SQL`; bump `SCHEMA_VERSION` to 8.
- [x] 2.2 Add the idempotent v7→v8 migration; it creates only the table and index and throws visible rebuild guidance on failure, never a silent catch.
- [x] 2.3 Add fresh-schema, v7 upgrade, repeated-init, and newer-version-refusal coverage to `server/storage/schema.test.ts`.
- [x] 2.4 Add a test proving Change A's destructive migration, run against a database that already holds annotations, leaves those rows intact.
- [x] 2.5 Add the annotation column constants to `server/storage/columns.ts`; never `SELECT *`.
- [x] 2.6 Create `server/storage/annotations.ts` with `readAnnotations`, `writeAnnotations`, and `listTagVocabulary`, all using module-level cached prepared statements.
- [x] 2.7 Implement tag normalisation exactly per D13 — trim, lowercase, de-duplicate, sort ascending — and enforce all four bounds by throwing a typed error, never truncating.
- [x] 2.8 Implement partial-update semantics: absent key untouched, empty array clears tags, null clears the note; convert `undefined` to `null` before writing.
- [x] 2.9 Extend the session-list query with an OR tag filter and a `tags` array on each row, joining `session_annotations` with no per-row query and no body column.
- [x] 2.10 Add `EXPLAIN QUERY PLAN` assertions: annotation read is a primary-key lookup; the session list with the tag join gains no `USE TEMP B-TREE`.
- [x] 2.11 Measure the session list before and after the join against the 524-entry baseline (447.8KB / 5.33ms) and record the delta; stop and report if it degrades materially.
- [x] 2.12 Add `server/storage/annotations.test.ts` covering empty read creating no row, round trip with normalisation, both partial updates, both clears, every bound violation, a unicode tag, cascade delete, tag vocabulary counts, and OR filtering across two tags.
- [x] 2.13 Run targeted storage tests, then `npm run typecheck && npm run test && npm run lint`.

## 3. API — annotations and tag filtering

**Depends on:** §2

- [x] 3.1 Register `GET` and `PUT /api/sessions/:key/annotations`, ordered so existing `:key` routes are not shadowed.
- [x] 3.2 Register `GET /api/annotations/tags` returning the tag vocabulary with counts.
- [x] 3.3 Add the `tags` query parameter to `GET /api/sessions`: comma-separated, OR semantics, max 32, invalid → `400 BAD_REQUEST`.
- [x] 3.4 Map storage bound errors to `400` and unknown session keys to `404 SESSION_NOT_FOUND` through the unified `ApiError` envelope; never leak a stack trace or SQL text.
- [x] 3.5 Send every response through the existing gzip-aware `sendJson`.
- [x] 3.6 Add typed client methods to `src/api/client.ts` preserving structured error codes.
- [x] 3.7 Add contract tests: empty read `200`, round trip, each partial update, each clear, every bound violation, unknown key `404`, malformed body `400`, tag vocabulary shape, OR filtering, 33-tag filter rejection, gzip.
- [x] 3.8 Add a regression test proving session list and detail shapes are unchanged apart from the added `tags` array.
- [x] 3.9 Run targeted API tests, then `npm run typecheck && npm run test && npm run lint`.

## 4. Turn model

**Depends on:** §1 (parallel with §2, §5, §7)

- [x] 4.1 Create `src/core/turn-model.ts` with `deriveTurns(events, session, turnKeySource)`, pure, single pass, no I/O.
- [x] 4.2 Implement the D3 four-step strategy selection and expose `segmentationSource` on the result.
- [x] 4.3 Implement `turn_key` segmentation: a changed key opens a turn; a `null` key attaches to the open turn and never opens one.
- [x] 4.4 Implement the `llm_boundary`, `user_prompt_boundary`, and `sequence_fallback` paths; in fallback emit one turn for everything the user rule does not carve out, and do not chunk by count or time gap.
- [x] 4.5 Implement turn 0, including the case where it is absent; never shift indices to close the gap.
- [x] 4.5a Implement the user-input rule: a `user_prompt` after turn 0 always opens a turn of kind `user`, under every strategy, taking precedence over the strategy's own boundary rule; it is never absorbed into an adjacent turn.
- [x] 4.5b Count all three turn kinds in the turn total, and expose a separate round count derived from `init` plus `user` turns.
- [x] 4.6 Implement aggregation: wall-clock duration floored at 0, `aggregateTokenUsage` reuse, model resolution, message and tool counts, status precedence error → running → success.
- [x] 4.7 Implement the D8 badges including `compact`; do not add a `length` badge.
- [x] 4.8 Implement the D4 event-to-message mapping, including the tool-family kind set and the assistant/reasoning grouping; expose each tool message's `event.id` as its call identity without parsing it.
- [x] 4.9 Implement completeness from `hasMore` / `eventTotal`.
- [x] 4.10 Add `src/core/turn-model.test.ts` covering all four segmentation sources, interleaved null keys, turn 0 present and absent, a mid-session user prompt opening its own turn under each of the four strategies, a user prompt sandwiched between two cycles joining neither, wall-clock versus sum on a fixture where they differ, token aggregation against a hand-computed fixture, every badge, each status precedence, all three kinds counted, the round count, empty session, system-and-user-only session, and completeness propagation.
- [x] 4.11 Add a benchmark asserting 1,000 synthetic events derive in under 20 ms.
- [x] 4.12 Run targeted core tests, then `npm run typecheck && npm run test && npm run lint`.

## 5. Ribbon geometry

**Depends on:** §1 (parallel with §2, §4, §7)

- [x] 5.1 Create `src/core/turn-ribbon.ts` with the exact D10 constants and `computeRibbon(turns, mode, containerWidthPx)`.
- [x] 5.2 Implement proportional widths for both modes with the minimum-width floor.
- [x] 5.3 Implement the zero-total case as equal widths with no division by zero.
- [x] 5.4 Implement bucketing above `RIBBON_MAX_SEGMENTS` into equal turn-count buckets carrying their turn range; drop no turn.
- [x] 5.5 Implement dominant-role selection with the six-role tie order from D10.
- [x] 5.6 Emit an accessible label per segment naming turn index or range, duration, and token total.
- [x] 5.7 Add `src/core/turn-ribbon.test.ts` covering proportionality in both modes, the floor, zero total, exactly 200 turns, 201, 500, a single turn, dominant-role ties across all six roles, and label content.
- [x] 5.8 Add a benchmark asserting 200 turns compute in under 5 ms.
- [x] 5.9 Run targeted core tests, then `npm run typecheck && npm run test && npm run lint`. (evidence: 200-turn ribbon benchmark <5ms in turn-ribbon.test; full gates green after §6)

## 6. Detail-view replacement and panels

**Depends on:** §3, §4, §5, §7

- [x] 6.1 Delete `TraceTimeline.tsx`, `EventInspector.tsx`, and their tests; delete `inspector-text.tsx` and its test only if nothing else imports it; prune the dead selectors from `src/styles/components/timeline.css`. (evidence: files deleted; inspector-text kept — SettingsModal/TokenTextModal still import it; `rg TraceTimeline|EventInspector` tree-wide = 0 imports; timeline.css pruned, tokens.test green)
- [x] 6.2 Remove the `layout` hash key and add `turn`, `ribbon`, and `tags`; drop invalid values without throwing; extend `src/hash-router.test.ts` with round-trip, invalid-value, and stored-`layout`-ignored cases. (evidence: hash-router.test 10/10)
- [x] 6.3 Add the two layout persistence keys with the 240–300 clamp to `src/layout.ts`; extend `src/layout.test.ts`. (evidence: layout.test 8/8 incl. 240/300 clamp + legacy .layout removal)
- [x] 6.4 Add every `trajectory.*` string to both locales in `src/i18n.ts`, including the four segmentation criteria lines, the adapter-provenance criteria line, the incompleteness banner, all four states, and every unavailable-value tooltip; extend `src/i18n.test.ts` for locale parity. (evidence: i18n.test zh/en parity 3/3; ~110 trajectory.* keys both locales)
- [x] 6.5 Add the six role token groups and `--ribbon-active` to `src/styles/tokens.css` for both themes; create `src/styles/components/trajectory.css` and import it from `components.css`; keep `src/styles/tokens.test.ts` green with zero colour literals in the new CSS. (evidence: tokens.test 10/10 T1-T7; trajectory.css T2/T3 clean)
- [x] 6.6 Create `TrajectoryPane` replacing the deleted timeline and inspector inside the session detail view, keeping `SessionHeaderCard`, `PhaseRibbon`, and `PhaseTiles` above it, and wiring the D16 request budget. (evidence: TrajectoryPane.test 9/9 — detail-open = slim+1 annotations, agent switch 1 batched fetch, mode switch/turn toggle 0 requests, 200-turn node stability)
- [x] 6.7 Create `TrajectoryRail` using the existing split-pane atom with the clamped, persisted width and the sub-1024px collapse. (evidence: TrajectoryRail.test 3/3 — persist key, <1024 collapse, user collapse)
- [x] 6.8 Create `AgentHierarchyPanel` per D9: merge-group resolution, one batched key fetch, depth-5 tree, accent selection, unknown-type handling, single-agent root, and agent switching. (evidence: AgentHierarchyPanel.test 5/5)
- [x] 6.9 Create `AnnotationsPanel` per D13: immediate tag save, explicit note save disabled when unchanged, success and error toasts carrying the error code, and the never-annotated empty case. (evidence: AnnotationsPanel.test 5/5)
- [x] 6.10 Create `TrajectoryStatBar` with the D6 agent-scoped pills, the agent name label, the segmentation criteria line, the ribbon mode switch, and the analysis trigger. (evidence: TrajectoryPane.test criteria-line cases + segmentationCriteriaKey unit cases)
- [x] 6.11 Create `TurnRibbon` rendering computed segments in one commit, with the six-entry legend (swatch + icon + name), hover detail, keyboard activation, and two-way highlight throttled to one update per animation frame. (evidence: TurnRibbon.test 4/4)
- [x] 6.12 Create `TurnList` and `TurnCard`: fixed collapsed row height, virtualisation above 50 turns via the existing hook, expanded turns at natural height outside virtualisation, and the incompleteness banner. (evidence: TurnList.test 6/6 incl. banner, 200-turn virtualisation, 50-turn threshold, D4 grouping)
- [x] 6.13 Create `MessageCard` and `ToolCallBlock` per D4 and D12: assistant card with a collapsed reasoning section and nested tool-call blocks, tool result cards below in order, system / user / compact / subagent cards, the three-state view control, on-demand body and raw fetches, the 100-entry LRU, and all four states. (evidence: MessageCard.test 7/7 — 1 body request + 1 raw, reasoning collapsed, 2 nested blocks, empty state, compact single-line, error+retry, duration criteria line, D5 id fallback)
- [x] 6.14 Add the tag column and OR tag filter to `SessionList` and `SessionToolbar`, with free-text entry and the vocabulary fetched once when the filter opens. (evidence: SessionList.test 10/10 incl. tag column + OR multi-select + typed tag + no per-keystroke request; SessionToolbar.test 7/7 tags + back)
- [x] 6.15 Wire everything in `src/App.tsx` without restructuring existing view state; add a back affordance to the detail header. (evidence: App.test 4/4 incl. trajectory surface, turn rows, SSE turn-count update, D16 request-count assertions)
- [x] 6.16 Add component tests: detail-open request count, agent switch issuing one batched fetch, card body fetched once and cached, Raw fetched once, ribbon mode switch issuing zero requests, node-count stability at 200 turns, two tool calls rendering as two nested blocks plus two result cards in order, a compact card, all four states in each panel, annotations success and failure, criteria line per segmentation source and per adapter provenance, tag filter OR behaviour, and locale parity. (evidence: new tests above + i18n.test parity)
- [x] 6.17 Re-run the existing session, compare, proxy, mission, and command-palette tests; remove or rewrite only those that tested the deleted components, and list each in your report. (evidence: full suite 137 files / 1127 tests green; deleted TraceTimeline.test.tsx + EventInspector.test.tsx; rewrote App.test.tsx 会话视图 IA; CompareTimeline.test.tsx unchanged — mini timeline keeps .gantt-wrap/.timeline-mode DOM)
- [x] 6.18 Run targeted frontend tests, then `npm run typecheck && npm run test && npm run lint`. (evidence: npm run typecheck / npx vitest run 137 files / npm run lint all green; npm run build green)

## 7. Tool renderers

**Depends on:** §1 (parallel with §2, §4, §5; integrated in §6)

- [x] 7.1 Create `renderers/index.ts` with the D11 registry types, `registerToolRenderer`, `resolveToolRenderer`, exact-lowercase matching, and the four shared bounds.
- [x] 7.2 Create `renderers/json-tree.tsx`: collapsible tree, depth 3, 5-element root array preview, non-JSON fallback to preformatted text.
- [x] 7.3 Create the `read` renderer per D11.
- [x] 7.4 Create the `bash` renderer, reusing `src/core/error-classifier.ts` for error lines rather than writing a second pattern list.
- [x] 7.5 Create the `todowrite` renderer with an icon plus label per status and a priority badge; a coloured dot alone is prohibited.
- [x] 7.6 Create the `grep` renderer with marked matches.
- [x] 7.7 Create the `glob` renderer.
- [x] 7.8 Create the `edit` renderer whose diff rows carry their `+` / `-` sign in addition to background colour.
- [x] 7.9 Create the `write` renderer.
- [x] 7.10 Make every renderer total: unparseable input returns `fallback`, never throws; the card then shows raw with a `raw` marker.
- [x] 7.11 Enforce `RENDER_MAX_CHARS` before parsing so an oversized body never enters a renderer.
- [x] 7.12 Add renderer tests: a happy path and a malformed path for each built-in, both bounds, registry override of a built-in, unmatched tool falling to default, and a null tool name.
- [x] 7.13 Run targeted renderer tests, then `npm run typecheck && npm run test && npm run lint`.

## 8. Trajectory analysis

**Depends on:** §4 (integrated in §6)

- [x] 8.1 Create `src/core/turn-analysis.ts` computing the five sections plus anomalies from `TurnModel`, pure and request-free.
- [x] 8.2 Implement tool-usage grouping with count-descending, name-ascending ordering.
- [x] 8.3 Implement both top-ten lists with turn-index-ascending tie-breaking.
- [x] 8.4 Implement the cache-rate trend with null for a zero denominator.
- [x] 8.5 Implement the four anomaly rules at exactly the stated thresholds, each entry naming the measured value and the threshold crossed.
- [x] 8.6 Propagate model incompleteness into the analysis result.
- [x] 8.7 Create `TrajectoryAnalysisPanel` rendering all sections with the existing chart atoms, icon plus text per anomaly, `—` for every unavailable value, and the incompleteness banner. (shipped with §6; evidence: TrajectoryAnalysisPanel.tsx + TrajectoryAnalysisPanel.test 4/4)
- [x] 8.8 Add `src/core/turn-analysis.test.ts` against a hand-computed fixture, a boundary test per anomaly rule at the threshold and one step past it, a null-cache-rate case, and a zero-turn case.
- [x] 8.9 Add a panel test asserting zero network requests on open and `—` totals when incomplete. (shipped with §6; evidence: TrajectoryAnalysisPanel.test zero-request fetch stub + incomplete banner)
- [x] 8.10 Run targeted tests, then `npm run typecheck && npm run test && npm run lint`.

> Blocked note (8.7 / 8.9): the panel needs §6's `TrajectoryStatBar` (B6) to
> mount it, and B6 has not landed (`src/components/trajectory/` holds only
> `renderers`). Per the §8 brief, 8.1–8.6 and 8.8 are delivered now; 8.7 and
> 8.9 (including the panel's zero-network-request test) ship with §6. The
> request-free property itself is already covered at the core level by the
> fetch-stub assertion in `turn-analysis.test.ts`.

## 9. Verification and sign-off

**Depends on:** all groups

- [x] 9.1 Run `openspec validate add-trajectory-inspector --strict` with no warnings. (evidence: `openspec validate add-trajectory-inspector --strict` → "Change 'add-trajectory-inspector' is valid", exit 0, no warnings)
- [x] 9.2 Run `npm run typecheck && npm run test && npm run lint && npm run build && npm run perf:check`; fix implementation, never relax assertions. (evidence: typecheck 0; vitest 137 files / 1128 passed + 1 skipped; lint 0; build 0 (dist + server-dist); perf:check 全绿 —— listSessions(500) 0.424ms、worst detail 9.755ms、Overview 冷 51.48ms、事件循环 p99 0.00ms、Mission 冷 32.59ms。期间 3 处实现缺陷由活体验证发现并修复 —— AgentHierarchyPanel 组形状、trajectory.css 画布高度，断言未放宽)
- [x] 9.3 Audit the diff against the D20 whitelist; revert unrelated edits and stop for confirmation if any required file lies outside it. (evidence: `git diff 71e7c9b..HEAD` 全量审计 —— 白名单内实现文件 + change 自身治理文档；白名单外仅 B2.1 机械 `tags:[]` 补齐（7 文件，bf63d0d）与 B6 授权比较视图重写（CompareKPI/CompareTimeline，因删除 TraceTimeline/EventInspector 必需，6.17）；`src/generated/local-samples.ts` 为机械打补丁而非重生成（生成脚本未更新，见报告 Needs confirmation）；无无关编辑，无必需文件落在白名单外)
- [x] 9.4 Prove no runtime dependency was added. (evidence: `git diff 71e7c9b..HEAD -- package.json package-lock.json` 空；dependencies 仍恰为 better-sqlite3/chokidar/http-mitm-proxy/node-forge 四个)
- [x] 9.5 Grep every new CSS and TSX file for hex, rgb, and named colour literals; the count must be zero. (evidence: 对 B 新增全部 css/tsx 文件 grep hex/rgb/命名色 = 0 命中（仅 `white-space` 属性误报，已排除）；tokens.test T2 同断言绿)
- [x] 9.6 Audit all AGENTS.md prohibitions, in particular no `SELECT *`, no body leakage into the list projection, no prepare-in-loop, no frontend fetch-per-item, and no `ORDER BY LENGTH`. (evidence: 触碰文件无 `SELECT *`（注释除外）、SESSION_LIST_COLS 无 body 列、annotations.ts 模块级 cachedStmt 无循环 prepare、前端无 `.map(fetch)`/循环内 fetch（agent 切换恰 1 次批量 keys 拉取）、无 `ORDER BY LENGTH`；spawnSync/execFileSync 0)
- [x] 9.7 Confirm `TraceTimeline` and `EventInspector` have no remaining imports anywhere in the tree. (evidence: `rg "import[^;]*(TraceTimeline|EventInspector)"` = 0；两组件文件已删；inspector-text 保留（SettingsModal/TokenTextModal 仍引用，6.1 允许）)
- [x] 9.8 Serve the production build on `127.0.0.1`, open a real rescanned Codex session, and record: turn count, `segmentationSource`, the adapter's declared provenance, first-paint duration, detail-open request count, and how turn 1 renders — assistant card, nested call blocks, result cards. (evidence: 127.0.0.1:4173 + headless Chrome；`codex-d2eaa46703228f` 回合 597、口径行 = turn_key + stream structure、详情打开 3 请求（slim detail + session-groups + annotations，无逐回合/逐消息）、hash→turn 列表首屏 62ms、turn 1 = assistant 卡 + 2 嵌套 call block（展开后，id `#sequence`——ctc_/ctco_ 非 toolu_/call_/msg_ 形态）+ 2 tool result 卡)
- [x] 9.9 Open a real Claude session and confirm no fabricated user card appears after a tool call and that tool results render inside their tool cards. (evidence: `claude-0be2a9071b490d` 465 回合；扫描 turn 0–7：tool call 后无伪造 user 卡，turn 1–5 = [assistant, tool, tool] 且 `toolu_…` id 原样、2/2 tool result 正文有内容；DB 交叉核对 claude user_prompt 修复后仅真实事件)
- [x] 9.10 Open the one real codearts sub-agent session, confirm the hierarchy renders, and confirm switching agents issues exactly one batched key fetch. (evidence: `codearts-87fa32238de9b5` 层级 2 节点渲染；切换 subagent 恰好 1 次 `GET /api/sessions?keys=main,sub`（绝无逐成员）；修复 AgentHierarchyPanel 组形状缺陷后通过 —— 修复前主会话只渲染 1 节点且 0 次批量拉取)
- [x] 9.11 Annotate two sessions with overlapping tags, confirm OR filtering on the list, restart the server, confirm the annotations survived, then delete one session and confirm its annotation row is gone. (evidence: 两会话写重叠 tag `e2e-run`；API + UI OR 过滤均返回两会话（today 范围）；重启后注解保留；DELETE 一会话 → 注解行级联清除（0 残留、404、另一会话注解完好、词汇表计数更新）；已强制重扫恢复会话)
- [x] 9.12 Re-measure the session list against the 524-entry baseline with the tag join active and record the delta. (evidence: 524 合成库 + D15 注解表（52 行带注解）：join 0.642ms/205,730B（gzip 12.9KB）vs join-less 0.445ms/192,464B → 增量 +0.197ms；2-tag OR 0.237ms/26 行；EXPLAIN 无 TEMP B-TREE；相对 5.33ms 负面基线 −88%；增量已记 PERF-BASELINE)
- [x] 9.13 Append derivation time, ribbon computation time, first paint, scroll node counts, and the list delta to `PERF-BASELINE.md`. (evidence: deriveTurns 1,000 事件 worst 0.175ms、computeRibbon 200 回合 worst 0.154ms、首屏 60–64ms、滚动节点 17→17（折叠虚拟化）/597（展开设计内）、列表 delta +0.197ms —— 已追加 PERF-BASELINE.md「add-trajectory-inspector perf:check 与活体验证」节)
- [x] 9.14 Mark only evidenced tasks complete and report Delivered / Contract mapping / Verification / Needs confirmation exactly as `AGENTS.md` requires, listing prefill/decode, deployment-only session fields, per-message comments, and the separate list page as explicitly not implemented, and naming every deleted test. (evidence: 本 §9 全部勾选均带实测证据；报告见本轮最终回复；not-implemented 列表与 6.17 删除测试已列)
