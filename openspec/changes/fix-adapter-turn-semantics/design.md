# Design — fix-adapter-turn-semantics

Fixed decisions A1–A12. Normative. Where this document and a frozen contract disagree,
the contract wins; report the conflict rather than resolving it silently.

---

## A1. Measured baseline (2026-08-07, live local database)

Every number below was read from `agent-observe-data/observe.sqlite`. Re-measure before
changing any rule that cites one.

**Volume:** 103 sessions, 35,299 events.

**Events by provider and kind**

| provider | kinds |
|---|---|
| codex | system 11,664 · llm 10,869 · tool 9,578 · user_prompt 247 |
| claude | user_prompt 1,059 · tool 1,026 · llm 624 · system 19 |
| codearts | file_read 52 · agent 49 · llm 21 · bash 21 · user_prompt 7 · tool 4 · file_write 1 |
| trae | llm 21 · file_read 12 · user_prompt 10 |
| opencode | llm 7 · agent 4 · user_prompt 3 · tool 1 |
| codeagent / codeagent2 / qoder / workbuddy | no live data; fixtures only |

**Codex `kind='system'` titles** (the title field carries the raw payload type)

```
reasoning 4701 · custom_tool_call_output 2211 · custom_tool_call 2211
patch_apply_end 1548 · agent_reasoning 350 · task_started 160 · task_complete 147
user_message 143 · thread_settings_applied 72 · mcp_tool_call_end 54
thread_goal_updated 19 · web_search_end 18 · turn_aborted 10 · web_search_call 9
system 4 · context_compacted 4 · tool_search_output 1 · tool_search_call 1
thread_rolled_back 1
```

**Codex `kind='llm'` titles**: `token_count` 6,492 · `""` 2,034 · other 240.

**Native call identity already in `event.id`**

| provider | sample | pairing |
|---|---|---|
| claude | `toolu_0117nwDWENk6VtST1KBHjGxX` | one event carries call and result |
| codex | `call_00_FUHEa1XZOVIWinblpRnH4144` and `call_00_FUHEa1XZOVIWinblpRnH4144:38` | result id = call id + `:N` |
| codearts | `msg_e5a6706dd001EO50ARXbYTFmlW-1` | message id + part ordinal |

**Other fill rates:** `duration_ms > 0` — codex 76.5%, trae 62.8%, claude 60.9%,
codearts 29.0%, opencode 20.0%. `proxy_requests` is empty and `parsed_session_id` fill is
0%, which is why no proxy-derived timing is attempted anywhere in this change.

**Codex rollout structure, read from the source file** (not the database) on 2026-08-07:
`~/.codex/sessions/2026/08/05/rollout-…-019fd1d9-bc0b-7cb0-93c9-b46cf3be52d4.jsonl`,
48 lines. Top-level `type` is one of `session_meta`, `turn_context`, `world_state`,
`event_msg`, `response_item`. The model's own output lives entirely in `response_item`;
`event_msg` is the UI mirror.

```
  2  event_msg     task_started
  3  response_item message   role=developer   ← system prompt
  4  response_item message   role=developer
  5  response_item message   role=developer
  6  response_item message   role=user        ← replayed initial context
  7  world_state
  8  turn_context
  9  response_item message   role=user        ← the actual prompt
 10  event_msg     user_message
 11  response_item reasoning          ┐
 12  response_item function_call      │ cycle 1
 13  response_item function_call_output ┘
 14  event_msg     token_count
 15  response_item reasoning          ┐
 16  event_msg     agent_message      │ cycle 2   ← duplicates line 17
 17  response_item message role=assistant │
 18  response_item function_call      │
 19  response_item function_call_output ┘
 20  event_msg     token_count
 …
```

Type counts in that file: `response_item/message` 8 · `response_item/reasoning` 8 ·
`response_item/function_call` 8 · `response_item/function_call_output` 8 ·
`event_msg/token_count` 8 · `event_msg/agent_message` 2 · one each of `session_meta`,
`task_started`, `world_state`, `turn_context`, `user_message`, `turn_aborted`.

Four conclusions, each load-bearing:

1. **`task_started` is a user submission, not a decision cycle.** Per-session counts track
   `user_prompt` almost exactly (21/24, 2/3, 2/3, 11/12). A session with 411 assistant
   messages and 724 tool calls carries **2** `task_started` records. Segmenting on it
   would produce two turns for that session. It is **not** the turn boundary.
2. **The cycle boundary is the `response_item` chain.** A new cycle opens at a
   `response_item` whose immediately preceding `response_item` was a
   `function_call_output`. Applied to the 48-line file this yields 9 cycles that land
   exactly where a reader would draw them.
3. **`event_msg/token_count` occurs once per cycle** (8 for 8 cycles), confirming that its
   usage belongs to the cycle's inference event rather than to an event of its own.
4. **`role: 'developer'` messages are the system prompt**, and `event_msg/agent_message`
   duplicates `response_item/message` where both are present.

---

## A2. Two new kinds

`TraceKind` gains exactly two members. No third is added in this change.

| kind | Meaning | Why not an existing kind |
|---|---|---|
| `reasoning` | model thinking emitted separately from the user-visible reply | folding it into `llm` makes a turn card unable to separate deliberation from answer, which is the single most useful distinction when reading a trajectory |
| `compact` | context compaction or auto-summary performed by the client | it is neither a model message nor a tool; the trajectory ribbon needs it as its own band |

Both are added to `TRACE_KINDS` and to every exhaustive `switch` over the enum. The
compiler finds those sites; do not silence one with a `default` branch.

---

## A3. `turnKey` — contract and semantics

```ts
/**
 * Decision-cycle identity. All events produced by one model inference and the
 * tool activity it triggered share one key. Null means the source format carries
 * no boundary signal; consumers then fall back to their own segmentation and must
 * disclose that they did.
 */
turnKey: string | null;
```

Rules:

1. `turnKey` is **opaque**. No consumer parses it, sorts by it, or derives an index from
   it. Turn ordering comes from `sequence`.
2. `turnKey` is stable across rescans of unchanged source data.
3. `turnKey` is unique within a session and MUST NOT be reused across sessions; prefix it
   with a session-scoped value when the source identifier is not globally unique.
4. `null` is a first-class value, not an error. An adapter that cannot find a boundary
   signal in its real source data returns `null` for every event and the reason is
   recorded in A5.
5. A tool event and the `llm` / `reasoning` events of the inference that requested it
   share one `turnKey`. Turn 0 material (system prompt, first user message) carries the
   key of the cycle it precedes, or `null` when no cycle follows.

---

## A4. Per-provider turn-key rules

Each rule must be justified by that adapter's fixture, and each gets a fixture test. The
first two are backed by live data; the rest are backed by fixtures only and their tests
must say so.

| provider | Rule | Evidence |
|---|---|---|
| codex | a new cycle opens at a `response_item` whose immediately preceding `response_item` was a `function_call_output`. The key is the opening item's payload `id`. `event_msg` records attach to the open cycle. **`task_started` is not a boundary** — see A1 conclusion 1. | live file, verified: 48 lines → 9 cycles |
| claude | key = the assistant row's `message.id`. Its `tool_use` parts and the `tool_result` rows that answer them inherit it (resolved through the `toolu_…` id). A `type: 'user'` row that is a genuine prompt opens the next cycle and takes the following assistant message's id. | live: 624 assistant messages, `toolu_…` ids intact |
| codearts | key = the `msg_…` prefix of `event.id`, i.e. the source message id without the part ordinal | live sample `msg_e5a6706dd001EO50ARXbYTFmlW-1` |
| opencode | key = the source message id if the fixture exposes one; otherwise `null` | fixture only |
| trae | key = the source message/round id if the fixture exposes one; otherwise `null` | fixture only |
| codeagent | derive from the fixture's real shape; `null` if no signal | fixture only |
| codeagent2 | derive from the fixture's real shape; `null` if no signal | fixture only |
| qoder | derive from the fixture's real shape; `null` if no signal | fixture only |
| workbuddy | derive from the fixture's real shape; `null` if no signal | fixture only |

**Do not invent a rule to avoid returning `null`.** Grouping by timestamp proximity, by
event count, or by "looks like a new turn" is prohibited. A `null` that is honest is worth
more than a key that is wrong, because a wrong key silently mis-slices every downstream
turn.

---

## A5. Confidence disclosure

Each adapter declares how it produced turn keys, alongside the existing
`tokenSemantics` / `reasoningInTotal` declarations:

```ts
export type TurnKeySource =
  | 'native_boundary'   // the source format marks cycles explicitly
  | 'stream_structure'  // cycles derived from the item stream's own shape
  | 'message_identity'  // grouped by the source's own message identifier
  | 'unavailable';      // no signal in the source; turnKey is null
```

`codex` is `stream_structure` — the boundary is real and verified, but it is read from the
`response_item` chain rather than from an explicit marker, and the UI must not present it
as if the source had labelled it. `claude` and `codearts` are `message_identity`. Any
adapter returning `null` is `unavailable`. No adapter currently qualifies for
`native_boundary`; the value exists because a future source may mark cycles outright.

The UI reads this to write its criteria line; it must never infer confidence from whether
keys happen to be non-null.

---

## A6. Codex classification repair

| payload type | today | after |
|---|---|---|
| `custom_tool_call` | `system` | `tool`, `tool` = the call's tool name |
| `custom_tool_call_output` | `system` | `tool`, result side, paired by call-id prefix |
| `patch_apply_end` | `system` | `file_write` |
| `mcp_tool_call_end` | `system` | `tool` |
| `web_search_call` / `web_search_end` | `system` | `tool` |
| `tool_search_call` / `tool_search_output` | `system` | `tool` |
| `reasoning` / `agent_reasoning` | `system` | `reasoning` |
| `context_compacted` | `system` | `compact` |
| `task_started` / `task_complete` / `turn_aborted` | `system` | `system`, but they carry the turn key and `turn_aborted` sets status `cancelled` |
| `thread_settings_applied` / `thread_goal_updated` / `thread_rolled_back` / `user_message` | `system` | unchanged |
| `token_count` | `llm` event | **not an event**; its usage attaches to the cycle's assistant event, or to a single `llm` carrier when no assistant message exists |
| `response_item/message` with `role: 'developer'` or `'system'` | `llm` | `system` — these are the system prompt (A1 conclusion 4) |
| `event_msg/agent_message` | `llm` | **dropped when the same cycle has a `response_item/message`**; `response_item` is the source of truth and `event_msg` is the UI mirror. Kept only when no `response_item/message` exists for that cycle. |
| `session_meta` (top-level) | `system` | **not an event**; it is session metadata |
| `turn_context` (top-level) | `system` | `system`, and its model/cwd fields feed session metadata rather than a message body |
| `world_state` (top-level) | `system` | `system`, unchanged |

Three of these are the difference between a readable trajectory and a misleading one:

- **`token_count`** removes 6,492 phantom `llm` events. Token totals must not change:
  assert per-session `tokenUsage` is equal before and after, on a fixture whose expected
  totals were computed independently of the adapter.
- **`developer` role** currently makes the Codex system prompt render as assistant replies.
  After the repair it renders in the initialisation turn where a reader expects it.
- **`agent_message` de-duplication** stops one assistant reply being counted and displayed
  twice. Verify on the A1 file: lines 16/17 and 34/35 are pairs and must yield one message
  each.

---

## A7. Claude classification repair

A `type: 'user'` row is a genuine prompt only when its content is not a `tool_result`
block. When it is:

- locate the tool event whose `event.id` equals the block's `tool_use_id`;
- write the result text into that event's `outputSummary` and set `hasOutput: true`;
- do **not** emit a `user_prompt` event for that row.

An unmatched `tool_result` (no tool event with that id) is emitted as a `tool` event with
only a result side and a status reflecting the block's `is_error`. It is never silently
dropped, and it is never converted back into a user message.

The existing `isGenuineUserPrompt` filter stays where it is; it removes
`<system-reminder>` injections and is orthogonal to this repair.

---

## A8. Phase classification for the new kinds

| kind | phase | Rationale |
|---|---|---|
| `reasoning` | inherit the phase the two-pass classifier assigns the cycle's `llm` event | reasoning is not its own activity; it belongs to whatever the model was doing |
| `compact` | `understand` | compaction restores working context |

Both kinds are added to the classifier's `switch`. `compact` events are excluded from
`avgToolDurationMs` and from `errorRate` denominators — they are infrastructure, not agent
work.

---

## A9. Accepted metric movement

Repairing 6,400+ Codex events and Claude's tool results changes computed metrics. This is
accepted. Requirements:

1. Existing tests whose expected values move are **recomputed**, never loosened. A test
   that asserted `errorRate === 0.12` becomes a test asserting the new correct value, with
   a comment naming this change.
2. The metrics-consistency test (`metrics-analysis` REQ-011, SQL aggregation versus
   `computeMetrics`, tolerance 0.001) must still pass. If it fails, the repair is
   inconsistent between the two paths — fix the implementation, never the tolerance.
3. Before/after values for one Codex session and one Claude session are recorded in the
   final report: phase distribution, `errorRate`, `avgToolDurationMs`, tool event count.
4. `PERF-BASELINE.md` gets a new entry; the old one is annotated as superseded rather than
   deleted.

---

## A10. Schema bump and forced rescan

`SCHEMA_VERSION` 6 → 7.

```sql
ALTER TABLE events ADD COLUMN turn_key TEXT;
```

Migration behaviour, in order:

1. Add the column (idempotent; a duplicate-column failure is tolerated, any other failure
   throws with rebuild guidance).
2. `DELETE FROM events; DELETE FROM event_raw; DELETE FROM metrics; DELETE FROM scan_state;`
3. Leave `sessions`, `proxy_requests`, `frida_captures`, and `session_prompt_context`
   untouched. Session-level annotations do not exist yet; when
   `add-trajectory-inspector` adds them they must survive this migration too, which is why
   the deletion list is enumerated explicitly rather than expressed as "everything except".
4. Set `detail_loaded = 0` on every session so the next open triggers a scan.
5. Record the migration in `_meta` so a second run is a no-op.

The rescan is safe because every source file is still on disk and scanning is
deterministic. Startup after upgrade is slower once; the final report records how much.

Do not attempt an in-place reclassification of existing rows. The old rows lack the
information needed to reconstruct turn keys.

---

## A11. Ordering and stability

Adapters that call `orderEventsByTime` must not let it reorder events that share a
timestamp — all parts of one Claude assistant message carry the same `timestamp`, and a
reorder there would break `turnKey` grouping's relationship with `sequence`. Sorting must
be **stable**, with source order as the tie-break. Add a test that a fixture with three
same-timestamp parts keeps its source order after ordering.

---

## A12. File whitelist

**Contracts**
```
openspec/contracts/data-model.md
openspec/contracts/database.md
openspec/contracts/nfr.md
```

**Core / frontend types**
```
src/core/trace-types.ts            + trace-types.test.ts
src/core/phase-classifier.ts       + phase-classifier.test.ts
src/core/metrics.ts                + metrics.test.ts
```

**Adapters** (each with its colocated test)
```
src/adapters/helpers.ts
src/adapters/claude-code.ts
src/adapters/codex.ts
src/adapters/codearts.ts
src/adapters/opencode.ts
src/adapters/trae.ts
src/adapters/codeagent.ts
src/adapters/codeagent2.ts
src/adapters/qoder.ts
src/adapters/workbuddy.ts
src/adapters/__fixtures__/*        (may gain fixtures; must not lose one)
```

**Storage**
```
server/storage/schema.ts           + schema.test.ts
server/storage/columns.ts
server/storage/writers.ts          + writers.test.ts
server/storage/query-engine.ts     + query-engine.test.ts
server/storage/overview.ts         + overview.test.ts
```

Any other file — components, routes, styles, scanners, proxy — is out of scope. Existing
tests elsewhere may need **expected-value** updates under A9; that is permitted and is the
only reason to touch a file outside this list. Record every such file in the final report.
