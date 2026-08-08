# Implementation spec — add-trajectory-inspector (Change B)

Handoff index. Read `proposal.md` for the boundary, this file for the requirement map and
conflict resolutions, `design.md` for fixed decisions, `tasks.md` for execution.

Source: `tempspec0806/new_view.md` v0.1.0 plus the reference screenshot, both reviewed
2026-08-07. **Prerequisite: `fix-adapter-turn-semantics` (Change A) is landed and green.**

---

## 1. Source requirement → delivery map

| Source FR | Title | Delivered as | Group |
|---|---|---|---|
| FR-T-001 | 三栏式布局 | session list ǀ `TrajectoryRail` ǀ turn area, inside the existing detail view | §6 |
| FR-T-002 | Session 信息面板 | existing `SessionHeaderCard` (kept) + `TrajectoryStatBar` agent pills | §6 |
| FR-T-003 | Agent 层级面板 | `AgentHierarchyPanel` per D9 | §6 |
| FR-T-004 | 可视化时间轴 | `TurnRibbon` + `src/core/turn-ribbon.ts` per D10 | §5 §6 |
| FR-T-005 | Turn 列表与详情 | `TurnList` / `TurnCard` + `src/core/turn-model.ts` per D3 | §4 §6 |
| FR-T-006 | Assistant 消息卡片 | `MessageCard role=assistant`, nested `ToolCallBlock`s, reasoning section | §6 |
| FR-T-007 | Tool Call 卡片 | `ToolCallBlock` **inside** the assistant card per D4 | §6 §7 |
| FR-T-008 | Tool Result 卡片 | `MessageCard role=tool` below the assistant card per D4 | §6 §7 |
| FR-T-009 | System 消息卡片 | `MessageCard role=system` + source/raw control | §6 |
| FR-T-010 | User 消息卡片 | `MessageCard role=user` | §6 |
| FR-T-011 | 统计标签栏 | `TrajectoryStatBar`, agent-scoped per D6 | §6 |
| FR-T-012 | 标签管理 | `AnnotationsPanel` tags + `session_annotations` | §2 §3 §6 |
| FR-T-013 | 轨迹备注 | `AnnotationsPanel` note + explicit save | §2 §3 §6 |
| FR-T-014 | 时间/Token 切换 | ribbon `mode` per D10 / D18 | §5 §6 |
| FR-T-015 | 工具结果渲染器 | `renderers/*` registry per D11 | §7 |
| FR-T-016 | 源码查看模式 | per-card `渲染 / 源码 / Raw` control per D12 | §6 §7 |
| FR-T-017 | 分析报告 | `TrajectoryAnalysisPanel` + `turn-analysis.ts`, client-side | §8 |
| FR-T-018 | 会话列表页 | **not a new page** — the existing list gains a tag column and OR filter | §3 §6 |

Screenshot-only elements: `← 历史轨迹` back affordance (the existing list is already
adjacent; a back control is added to the detail header), `Main Agent` label in the stat
bar, `渲染` control at card top-right, `时间 / Token` toggle on the legend row.
`💬 评论` is **declined** (see C10).

| Source NFR | Delivered as |
|---|---|
| NFR-T-001 first paint < 2s | D20 budget, `PERF-BASELINE.md` entry |
| NFR-T-002 200 blocks < 500ms | D10 bucketing + `computeRibbon` < 5 ms |
| NFR-T-003 browsers | unchanged from `contracts/nfr.md` |
| NFR-T-004 renderer extensibility | `registerToolRenderer` per D11 |
| NFR-T-005 200 turns / 500 msgs / 100KB | virtual list > 50 turns, `RENDER_MAX_CHARS` 100_000 |

---

## 2. Analysis panel (FR-T-017)

`src/core/turn-analysis.ts` — pure, no I/O, over `TurnModel`.

| Section | Computation |
|---|---|
| overview | total turn count and its split by kind, round count, total duration, input / output / cacheRead totals, cache rate |
| tool usage | member events grouped by `tool`: count, mean duration, summed `tokens.total`; count desc, ties by name asc |
| top duration | 10 turns by `durationMs` desc, ties by index asc |
| top tokens | 10 turns by `tokens.total` desc, ties by index asc |
| cache trend | per turn `cacheRead / (input + cacheRead)`, `null` when the denominator is 0 |

Anomaly rules — fixed thresholds, not tunable during implementation:

| Rule | Condition | Severity |
|---|---|---|
| `slow_turn` | `durationMs > 30_000` | danger |
| `high_input` | `tokens.input > 50_000` | attention |
| `tool_error` | a member with `tool !== null` has `status === 'error'` | danger |
| `low_cache` | cache rate non-null and `< 0.5` | attention |

Entries carry `{ rule, turnIndex, detail }`; `detail` names the measured value and the
threshold crossed. Incomplete models render the banner and `—` for every total. Charts
reuse `src/components/charts/`; adding a chart library is prohibited.

---

## 3. Conflict register — source spec vs this design

Each row is deliberate. "Fixing" one back to the source spec is a regression.

| # | Source says | This project requires | Resolution |
|---|---|---|---|
| C1 | literal light-only palette (`#F5F5F5`, `#FFFFFF`, `#1A202C`) | design-system REQ-002 forbids literal style values; dark-first with an equal light theme | D19 — six role tokens + `--ribbon-active`; components read tokens only |
| C2 | colour-only legend, todo dots, diff rows | colour never carries meaning alone (REQ-009) | every legend item, badge, todo row, and diff row carries an icon or a sign |
| C3 | red border marks the selected agent and the active ribbon mode | red is `--danger-` and means failure | D9 / D19 — selection uses accent |
| C4 | `/api/trajectory/{sessionId}` route family | convention is `/api/sessions/:key/*` | D13 — annotations route pair plus a tags-vocabulary route |
| C5 | a separate session-list page | the existing list already filters | FR-T-018 delivered as a tag column and OR filter on the existing list (D14) |
| C6 | per-turn `prefill` / `decode` | no adapter emits it; `proxy_requests` empty, `parsed_session_id` fill 0% | D7 — omitted, never estimated, no proxy correlation attempted |
| C7 | ~~no tool-call id exists~~ | **corrected 2026-08-07**: `event.id` carries the native call id (`toolu_…`, `call_00_…`, `msg_…`) | D5 — display `event.id` verbatim; no `toolCallId` field is added and none is generated |
| C8 | env tag / employee id / client version / plugin version | not present in a local-first scanner | D6 — omitted, recorded as not-implemented |
| C9 | `stop` / `length` stop-reason badges | `stop_reason` is not in the contract | D8 — `stop` derived from zero tool calls; no `length` badge |
| C10 | `💬 评论` on every card | declined by the user 2026-08-07 | not implemented; session tags and note are the annotation surface |
| C11 | `分析` implies a service call | source §1.4 forbids model calls | §2 — client-side arithmetic, zero requests |
| C12 | Canvas for 200+ blocks | Canvas needs its own hit-testing and a11y layer | D10 — ≤200 DOM segments with bucketing |
| C13 | turn indices renumbered contiguous | derivation must stay honest | D3 — turn 0 omitted when absent; indices never shifted |
| C14 | cache rate = cached / input | data-model §2 defines `netInput` and warns semantics are per-adapter | rate = `cacheRead / (input + cacheRead)`, `—` when the denominator is 0, with a criteria line |
| C15 | Tool Call and Tool Result are two sibling cards | after Change A one tool event carries both sides, and a tool call *is* part of the assistant message | D4 — call block nested in the assistant card, result as its own card. **This follows the reference screenshot, not the spec text.** |
| C16 | left sidebar holds session info + agents + tags | the app's left rail is the session list, which this change keeps and extends | D2 — panels live in a rail inside the detail pane; three-column reading is preserved |

---

## 4. Acceptance criteria

A checkbox may be marked `[x]` only when its evidence exists.

**AC-1 Contract freeze.** `openspec validate add-trajectory-inspector --strict` and
`npm run typecheck` pass; five contracts carry the turn types, annotations table, route
pair, `tags` list parameter, role tokens, and budgets; `trace-types.ts` copies them
verbatim. Change A is confirmed landed.

**AC-2 Storage.** Fresh v8, v7→v8 migration, repeated init, newer-version refusal;
annotations round-trip with normalisation; cascade delete; every bound violation;
`EXPLAIN QUERY PLAN` shows a primary-key lookup; **Change A's migration run against a
database holding annotations leaves them intact**; the session-list tag join adds no
temporary B-tree and its measured cost delta is recorded.

**AC-3 API.** Both annotation routes and the tags-vocabulary route return exact shapes;
bounds → `400`; unknown key on `PUT` → `404`; unannotated `GET` → `200` empty shape;
`tags` list filter is OR, capped at 32, invalid → `400`; responses use gzip-aware
`sendJson`; existing list and detail shapes gain only `tags`.

**AC-4 Turn model.** All four segmentation sources; `turnKey` grouping with interleaved
`null` keys; turn 0 present and absent; wall-clock duration versus a sum; token
aggregation against a hand-computed fixture; every badge; status precedence;
`init` excluded from turn counts; incompleteness propagation; 1,000-event benchmark
< 20 ms.

**AC-5 Ribbon.** Proportionality in both modes; minimum-width floor; zero-total safety;
bucketing above 200; dominant-role ties; mode switch issues zero requests; two-way
highlight; every segment labelled and keyboard-reachable.

**AC-6 Shell.** `TraceTimeline` and `EventInspector` are gone with their tests; `layout`
hash key removed and `turn` / `ribbon` / `tags` added with invalid values dropped; rail
width clamped and persisted; agent switch issues exactly one batched fetch; four states
everywhere; criteria line correct for each segmentation source and each declared adapter
provenance.

**AC-7 Renderers.** Each built-in renders its happy path and returns `fallback` on
malformed input without throwing; both bounds enforced; `registerToolRenderer` overrides a
built-in; the view control is per-card; Raw fetches once.

**AC-8 Analysis.** Every section matches a hand-computed fixture; each anomaly fires
exactly at its threshold and not below; zero requests on open; incompleteness forces `—`.

**AC-9 Global.** `typecheck && test && lint && build && perf:check` pass; no runtime
dependency; zero colour literals in new CSS/TSX; every AGENTS.md prohibition audited;
verified against a real session and recorded in `PERF-BASELINE.md`.

---

## 5. Edge cases that must have a test

| Case | Expected |
|---|---|
| session with 0 events | empty state, no ribbon, no crash |
| only `system` + `user_prompt` events | turn 0 only |
| adapter declared `unavailable`, no `llm` events, has `user_prompt` | `user_prompt_boundary` + criteria line |
| adapter declared `unavailable`, neither | one turn, `sequence_fallback` + criteria line |
| `turnKey` present on some events, `null` on others | null-keyed events attach to the open turn and never open one |
| mid-session user prompt, `turn_key` strategy | opens its own `user` turn even though the key did not change |
| user prompt between two cycles | joins neither; three turns result |
| session with 3 user prompts and 411 cycles | 415 turns total (init + 3 user + 411 cycle), one flat list, no round nesting |
| `turnKey` present but adapter provenance is `message_identity` | segmentation `turn_key`, criteria line names the provenance |
| paginated detail (`hasMore`) | banner + `—` totals |
| all turn weights 0 | ribbon equal-width, no divide-by-zero |
| 500-turn session | ribbon buckets to 200, list virtualises |
| turn with 2 tool calls | 2 nested call blocks in one assistant card, 2 result cards below, in order |
| tool event with `hasOutput: false` | result card shows `EmptyState`, not an empty box |
| tool event whose `event.id` is not call-shaped | header shows `#sequence` |
| `compact` event in a turn | compact card + `compact` badge + ribbon legend entry |
| `reasoning` events with no `llm` event in the turn | assistant card renders with reasoning only |
| 200 KB tool argument | raw pane + truncation notice, renderer skipped |
| malformed JSON in `todowrite` args | fallback to raw with `raw` marker, no throw |
| tag `"  Résumé  "` | normalised to `résumé` |
| 33 tags submitted | `400`, nothing persisted |
| 8,193-char note | `400`, nothing persisted |
| `PUT` on a deleted session | `404 SESSION_NOT_FOUND` |
| session deleted while annotated | cascade removes the row |
| Change A migration on a database with annotations | annotations survive |
| list filtered by two tags | returns sessions having **either** |
| agent group 5 levels deep | tree to depth 5, one batched fetch |
| single-agent session | one root node, not an empty tree |
| expand the same card twice | exactly one body request; Raw exactly one more |

---

## 6. Stop conditions

Stop and report — do not guess through — when: Change A is not landed; a contract and this
design disagree after freeze; a required field, route, error code, or token is missing;
implementation needs a file outside D20; a performance budget cannot be met within the
D10/D11 bounds; the session-list tag join degrades the measured list baseline; or turn
segmentation would require inventing a boundary the data does not support.

Report the requirement id, the blocker, the options, a recommendation, and blocked tasks.
