# Design — add-trajectory-inspector (Change B)

Fixed decisions D1–D20. Normative. Where this document and a frozen contract disagree
after contract freeze, the contract wins; report the conflict rather than resolving it.

**Prerequisite:** `fix-adapter-turn-semantics` (Change A) is landed and its §6 sign-off is
green. This design assumes `turnKey`, `TurnKeySource`, the `reasoning` and `compact`
kinds, repaired Codex classification, and Claude tool results attached to their tool
events. Do not start if Change A has not shipped.

---

## D1. Scope boundary

**In scope.** Replacing the session-detail timeline and inspector with a turn surface;
turn derivation from `turnKey`; role message cards with nested tool calls; per-card
rendered/source/raw control; tool renderer registry; turn ribbon; agent hierarchy panel;
session annotations plus session-list tag column and filter; client-side analysis panel.

**Out of scope — do not implement "while you are here".**

| Excluded | Reason |
|---|---|
| A new top-level view or hash route family | the turn surface replaces part of the existing session detail; adding a view would fork the session store |
| A second session-list page (source FR-T-018) | the existing list gains a tag column and filter instead |
| Per-message or per-turn comments (the reference screenshot's `💬 评论`) | explicitly declined; session tags and note are the annotation surface |
| `/api/trajectory/*` route family | project convention is `/api/sessions/:key/*` |
| Per-turn `prefill` / `decode` timing | no adapter emits it, and `proxy_requests` is empty with 0% session-id fill; see D7 |
| Environment / employee-id / client-version / plugin-version session fields | no such data in a local-first scanner; see D6 |
| LLM-generated analysis | source spec §1.4 forbids model calls; the panel is arithmetic |
| Persisting derived turns | derivation is cheap and version-fragile; see D2 |
| Canvas ribbon rendering | ≤200 DOM segments meets the budget; see D10 |
| Mobile / <1024px layout | source spec §9.4 excludes mobile |
| Any new runtime dependency | AGENTS.md hard limit of 4 |

---

## D2. Where the turn surface lives

There is **no new top-level view**. The session detail main area becomes:

```
SessionHeaderCard          ← kept (four-dimension metrics, title, status)
PhaseRibbon                ← kept (where the session's time went, by phase)
PhaseTiles                 ← kept (phase filter)
─────────────────────────────────────────────────────────────
TrajectoryStatBar          ← new: agent-scoped pills + ribbon mode + analysis
TurnRibbon                 ← new: replaces TraceTimeline
TurnList                   ← new: replaces TraceTimeline rows + EventInspector
```

`TraceTimeline.tsx`, `EventInspector.tsx`, and their tests are **deleted**. The
`layout=time|sequence` hash key is removed and replaced by `ribbon=time|token`.

The turn area is itself two columns:

```
┌ context rail 240–300px ┬ turn area ───────────────────────┐
│ AgentHierarchyPanel    │ TrajectoryStatBar                │
│ AnnotationsPanel       │ TurnRibbon                       │
│                        │ TurnList                         │
└────────────────────────┴──────────────────────────────────┘
```

The reference screenshot puts these panels in a full-height left sidebar. Here the app's
left rail is already the session list, which this change keeps (and extends with tags), so
the panels live in a rail inside the detail pane. The resulting three-column reading —
session list | context rail | turns — matches the screenshot's information architecture
without displacing an existing surface.

Session identity and metrics are already in `SessionHeaderCard`, so the rail carries no
duplicate session-info panel. `SessionHeaderCard` describes the **session**;
`TrajectoryStatBar` describes the **currently selected agent** and names which one. When
they differ, that difference is real information, not an inconsistency.

Rail width: 240–300px, resizable via the existing split-pane atom, persisted.

---

## D3. Turn derivation

`deriveTurns(events, session, turnKeySource)` in `src/core/turn-model.ts`. Pure, single
pass, never persisted, never computed on the server. Input is `sequence`-ascending; do not
re-sort by `startedAt`.

**Strategy selection, in order:**

| Condition | `segmentationSource` | Criteria line |
|---|---|---|
| any event has a non-null `turnKey` | `'turn_key'` | none when the adapter declared `native_boundary`; otherwise names the adapter's declared provenance. **No adapter currently declares `native_boundary`** — codex is `stream_structure`, claude and codearts are `message_identity` — so in practice every session renders a criteria line. That is intended: the reader should always know how the turns were determined. |
| else any `llm` event exists | `'llm_boundary'` | "turns inferred from model inference events; this source carries no turn marker" |
| else any `user_prompt` event exists | `'user_prompt_boundary'` | "turns segmented on user prompts; this source has no model inference events" |
| else | `'sequence_fallback'` | "this source carries no turn structure; all events shown as one turn" |

**Three turn kinds.** A turn is one of:

| `kind` | Meaning | Counts as a turn? |
|---|---|---|
| `init` | leading system prompt plus the opening user request | yes |
| `user` | a mid-session user input | yes |
| `cycle` | one thought plus the actions it triggered | yes |

The product definition, from the user: *a turn is one piece of thinking plus the actions
that thinking took; a user input is also a turn.* All three kinds are turns and all three
are counted. There is **no** second grouping layer above them — a `user` turn is itself
the visible boundary between conversation rounds, which is what a reader needs; nesting
cycles under rounds would add structure without adding information.

**Turn 0.** Consume the leading run of `system` / `user_prompt` events, stopping at the
first event that is neither. Those form a turn with `index: 0`, `kind: 'init'`, badge
`init`. If the leading run is empty, no turn 0 is emitted and the first turn keeps
`index: 1`. Indices are never shifted to close a gap.

**A user input always opens a turn.** In every strategy, a `user_prompt` event after turn
0 opens a turn of `kind: 'user'`. It is never absorbed into the cycle that follows it, and
never appended to the cycle that precedes it. This rule takes precedence over the strategy
rules below.

**Cycle turns.**
- `'turn_key'`: a new turn opens whenever `turnKey` differs from the open turn's key.
  Events with a `null` key attach to the open turn; a `null` key never opens a turn.
- `'llm_boundary'`: a new turn opens at every `llm` event.
- `'user_prompt_boundary'`: user inputs are the only boundaries available, so this
  strategy reduces to the user-input rule above, with each following run of events
  attached to that `user` turn.
- `'sequence_fallback'`: one turn holding everything except the `user` turns the rule above
  carves out. Do not chunk by count or by time gap — a fabricated boundary is worse than
  one honest turn.

**Aggregation per turn.**

| Field | Rule |
|---|---|
| `startedAt` | first member's `startedAt` |
| `durationMs` | `last.startedAt + last.durationMs − first.startedAt`, floored at 0 — wall-clock, **not** a sum |
| `tokens` | `aggregateTokenUsage` from `src/core/metrics.ts` over members' non-null usages |
| `model` | first member's non-null `model`, else `session.primaryModel ?? null` |
| `messageCount` | member count |
| `toolCount` | members with `tool !== null` |
| `status` | `error` if any member errored; else `running` if any is running; else `success` |
| `badges` | see D8 |

**Completeness.** When the detail response had `hasMore === true`, set `complete = false`
and `omittedEventCount = eventTotal − events.length`.

---

## D4. Message grouping inside a turn

A turn renders as an ordered list of cards. Grouping rules:

1. `llm` and `reasoning` events of the turn produce **one assistant card**. Reasoning text
   renders in a collapsed-by-default `思考 / Reasoning` section above the reply text, with
   its own token count. Multiple `llm` events in one turn concatenate in sequence order.
2. Every tool-family event (`tool`, `file_read`, `file_write`, `bash`, `test`) of the turn
   contributes **two** renderings from one event:
   - a **tool-call block nested inside the assistant card**, showing tool name, native call
     id, and arguments (`inputSummary`);
   - a **tool result card** below the assistant card, showing duration, tokens, and result
     (`outputSummary`).
   Call blocks appear in sequence order inside the card; result cards appear in the same
   order below it.
3. `system` and `user_prompt` events produce their own cards.
4. `compact` events produce a compact card: a single line naming the compaction with its
   token delta when available, not an expandable body.
5. `agent` and `subagent_prompt` events produce a sub-agent card linking to that agent.

This mirrors the source structure exactly: a tool call *is* part of an assistant message,
and a tool result *is* a separate message. It is also why one event feeds two places —
after Change A a tool event carries both sides.

---

## D5. Tool call identity

Native call identity is already in `event.id` and is displayed verbatim, monospace and
copyable:

| provider | form |
|---|---|
| claude | `toolu_0117nwDWENk6VtST1KBHjGxX` |
| codex | `call_00_FUHEa1XZOVIWinblpRnH4144` |
| codearts | `msg_e5a6706dd001EO50ARXbYTFmlW-1` |

Rules: display `event.id` as-is; do **not** parse it, reformat it, truncate it in the DOM
(CSS may truncate visually with the full value copyable), or generate one when absent.
When an id is not call-shaped, show `#sequence` instead. There is no `toolCallId` field in
the contract and none is added — `event.id` is the identity the contract guarantees.

---

## D6. Session fields — only what exists

`SessionHeaderCard` already renders session identity and the four-dimension metrics; do
not duplicate it. `TrajectoryStatBar` renders **agent-scoped** pills:

| Pill | Source | Unavailable |
|---|---|---|
| turns | total turn count across all three kinds | `—` when the model is incomplete |
| rounds | `user` turn count plus the `init` turn, shown only when > 1 | omitted when the session has a single round |
| model | `session.primaryModel` or the turns' resolved model | `—` |
| input tokens | summed turn `tokens.input` | `—` |
| output tokens | summed turn `tokens.output` | `—` |
| cache rate | `cacheRead / (input + cacheRead)`, one decimal | `—` when the denominator is 0 |
| duration | summed turn `durationMs` | `—` |
| tools | summed `toolCount` | `—` |

**Not rendered, and recorded as not-implemented:** environment tag, session count,
employee id, client version, plugin version. `null` renders `—` with a tooltip naming the
reason; rendering `0` for an unknown value violates frontend REQ-017.

---

## D7. Assistant timing

No adapter emits a prefill/decode split, and `proxy_requests` is empty with 0%
`parsed_session_id` fill, so no proxy-derived timing is attempted. The assistant card
header renders role marker, duration, output tokens, and — when
`session.durationSource !== 'native'` — the existing derived-duration criteria line
("durations derived from adjacent timestamps, includes scheduling gaps"). Never print an
estimate.

---

## D8. Turn badges

| Badge | Condition | Token | Icon |
|---|---|---|---|
| `init` | `turn.kind === 'init'` | `--accent-subtle` | `system` |
| `user` | `turn.kind === 'user'` | `--role-user-subtle` | `command` |
| `tools` | `toolCount > 0` | `--role-tool-subtle` | `tool` |
| `stop` | `kind === 'cycle'` with `toolCount === 0` | `--success-subtle` | `check-circle` |
| `error` | `status === 'error'` | `--danger-subtle` | `x-circle` |
| `subagent` | a member has kind `agent` or `subagent_prompt` | `--phase-understand-subtle` | `telescope` |
| `compact` | a member has kind `compact` | `--role-compact-subtle` | `chevron-down` |
| `running` | `status === 'running'` | `--attention-subtle` | `dot-fill` |

No `length` badge — `stop_reason` is not in the contract. `stop` means only "this cycle
made no tool call". Badges are icon plus text; colour alone is prohibited.

---

## D9. Agent hierarchy

Sources, in order: `GET /api/session-groups` for the group containing the current key;
`primaryKeyFor` for the main agent; `isSubagent` to mark members; `extractSubagentType`
for the label, with `unknown` rendered as `unknown` plus the existing heuristic tooltip.

Rendering: tree, max depth 5, 16px indent per level. Selected node uses `--accent-subtle`
with an `--accent-emphasis` left bar and a text indicator — **not** the reference
screenshot's red border, because red is `--danger-` and means failure in this product.

Member index rows load with **one** batched `GET /api/sessions?keys=…` (existing route,
≤200 keys). A per-member fetch loop is prohibited (AGENTS.md #6).

Selecting an agent changes the selected session key and reloads the turn area.
`SessionHeaderCard` follows the selected agent; `TrajectoryStatBar` names which agent it
describes.

Live data has exactly one real sub-agent session (codearts). A single-agent session
renders one root node, not an empty tree.

---

## D10. Ribbon geometry

`src/core/turn-ribbon.ts`, pure: `computeRibbon(turns, mode, containerWidthPx)`.

| Constant | Value |
|---|---|
| `RIBBON_HEIGHT_PX` | 28 |
| `RIBBON_MIN_SEGMENT_PX` | 2 |
| `RIBBON_MAX_SEGMENTS` | 200 |
| `RIBBON_TRANSITION_MS` | 200 (read the motion token, not the literal) |

- `'time'` weight = `durationMs`; `'token'` weight = `tokens.total`.
- Width = `max(RIBBON_MIN_SEGMENT_PX, weight / totalWeight * containerWidthPx)`.
- `totalWeight === 0` → equal widths; never divide by zero.
- Above `RIBBON_MAX_SEGMENTS`, bucket into 200 equal turn-count buckets; a bucket's tooltip
  names its turn range. Drop no turn.
- Segment colour = dominant role by message count, ties broken
  `system > user > assistant > tool > reasoning > compact`.
- Every segment carries an `aria-label` with turn index or range, duration, and tokens,
  and is keyboard-activatable.
- Rendered as flex `div`s in one React commit. Canvas is not permitted.

Legend: `System · User · Assistant · Tool · 思考 · 压缩`, each a swatch **plus icon plus
name**. The `压缩` entry is backed by real `compact` events after Change A.

Highlight sync: turn-list scroll writes the top-most fully visible turn index, throttled to
one update per animation frame; ribbon activation scrolls that turn into view and expands
it. Neither direction issues a request.

---

## D11. Tool renderer registry

`src/components/trajectory/renderers/index.ts`

```ts
export type ToolRenderResult = { kind: 'ok'; node: ReactNode } | { kind: 'fallback' };

export interface ToolRenderer {
  readonly tool: string;                       // exact, lowercased
  renderArguments(text: string): ToolRenderResult;
  renderResult(text: string): ToolRenderResult;
}

export function registerToolRenderer(renderer: ToolRenderer): void;
export function resolveToolRenderer(tool: string | null): ToolRenderer | null;
```

Built-ins: `read`, `bash`, `todowrite`, `grep`, `glob`, `edit`, `write`; unmatched tools
use the default JSON tree.

**Every renderer is total**: unparseable input returns `{ kind: 'fallback' }`, never
throws, and never renders a partially-parsed structure without saying so. The card then
shows raw text with a `raw` marker.

| Constant | Value |
|---|---|
| `RENDER_MAX_LINES` | 200 |
| `RENDER_MAX_CHARS` | 100_000 (checked **before** parsing) |
| `JSON_TREE_DEFAULT_DEPTH` | 3 |
| `JSON_TREE_ARRAY_PREVIEW` | 5 |

Behaviour: `read` — path with muted directory, emphasised basename; result as a fenced
block with extension-derived language and line numbers. `bash` — command on
`--canvas-inset` with `description` as a leading comment; result terminal-styled, error
lines detected via the existing `src/core/error-classifier.ts`. `todowrite` — task rows
with icon **plus** label per status and a priority badge. `grep` — pattern and path;
result rows of path, line, and marked match. `glob` — pattern; monospace path rows.
`edit` — path plus unified diff whose rows carry their `+`/`-` sign in addition to
background colour. `write` — path plus content block. Default — collapsible JSON tree,
non-JSON falling back to preformatted text.

---

## D12. Card view control — the inspector's replacement

Each card carries a three-state control replacing the removed `EventInspector` tabs:

| State | Content | Fetch |
|---|---|---|
| `渲染 / Rendered` (default for tool and system cards) | tool renderer or Markdown | none beyond the body fetch |
| `源码 / Source` | `inputSummary` / `outputSummary` verbatim, monospace, copyable | none beyond the body fetch |
| `Raw` | `GET /api/sessions/:key/events/:eventId?include=raw` | on demand, once |

Token figures live in the card header and the turn meta row, so the inspector's `Tokens`
tab has no successor and needs none.

Bodies (`mode=full` text) are fetched per event on first expansion via
`GET /api/sessions/:key/events/:eventId`, cached in a component-local LRU of 100 entries.
Raw is a separate on-demand fetch cached the same way. Re-expanding refetches nothing.

---

## D13. Annotations

Routes follow project convention, not the source spec:

```
GET  /api/sessions/:key/annotations
PUT  /api/sessions/:key/annotations
GET  /api/annotations/tags          → { tags: { tag: string; count: number }[] }
```

```ts
export interface SessionAnnotations {
  sessionKey: string;
  tags: string[];
  note: string | null;
  updatedAt: string | null;
}
export interface SessionAnnotationsUpdate {
  tags?: string[];
  note?: string | null;
}
```

| Rule | Value |
|---|---|
| `ANNOTATION_MAX_TAGS` | 32 |
| `ANNOTATION_TAG_MAX_CHARS` | 64 |
| `ANNOTATION_TAG_PATTERN` | `/^[\p{L}\p{N}_-]{1,64}$/u` |
| `ANNOTATION_NOTE_MAX_CHARS` | 8192 |

- Tags normalise: trim, lowercase, de-duplicate, sort ascending; stored as a JSON array.
- A violated bound returns `400 BAD_REQUEST` via the unified `ApiError` envelope. Silent
  truncation is prohibited.
- `GET` on an unannotated session returns `200` with `tags: []`, `note: null`,
  `updatedAt: null` — not `404`.
- `PUT` on an unknown key returns `404 SESSION_NOT_FOUND`.
- `PUT` replaces per present key: an absent key leaves that field untouched, `tags: []`
  clears tags, `note: null` clears the note.
- `DELETE /api/sessions/:key` cascades via the FK.
- Tags save immediately on add/remove; the note saves on an explicit button disabled while
  the textarea equals the persisted value. Success and failure both raise a `Toast`;
  failure carries the envelope `code` and leaves the button enabled. No autosave on
  keystroke.

---

## D14. Session-list tags

`GET /api/sessions` gains `tags` — comma-separated, **OR** semantics, matching the
existing `provider` / `status` filters (`IN (...)`), max 32 values, invalid values return
`400 BAD_REQUEST`.

`SessionIndexEntry` gains `tags: string[]`. The list query joins `session_annotations` and
returns the tag array; it adds **no** per-row query and **no** body column. The existing
list exclusions are untouched.

The filter UI is multi-select with free-text entry; the candidate list comes from
`GET /api/annotations/tags`, fetched once when the filter opens, never per keystroke.

Index: `CREATE INDEX IF NOT EXISTS idx_session_annotations_updated ON session_annotations(updated_at)`.
Tag matching uses a JSON-array containment predicate on the joined row; verify with
`EXPLAIN QUERY PLAN` that the session list's existing ordering plan gains no temporary
B-tree. If it does, stop and report rather than shipping a slower list.

The measured list baseline is 524 entries at 447.8KB / 5.33ms; re-measure after the join
and record the delta.

---

## D15. Schema v8

```sql
CREATE TABLE IF NOT EXISTS session_annotations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  tags_json  TEXT NOT NULL DEFAULT '[]',
  note       TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_annotations_updated
  ON session_annotations(updated_at);
```

`SCHEMA_VERSION` 7 → 8. Additive only; touches no existing table. Migration failure throws
with rebuild guidance; a silent catch is prohibited. Reads and writes use module-level
cached prepared statements; explicit column lists, never `SELECT *`.

**Change A's migration must not clear this table.** Change A's design A10 enumerates the
tables it deletes precisely so that a table added here survives. Verify that ordering
holds: run Change A's migration on a database that already has annotations and assert the
rows survive.

---

## D16. Request budget

| Trigger | Requests |
|---|---|
| session detail opens | existing slim detail + `GET …/annotations` |
| session-groups needed | `GET /api/session-groups` (existing, cached) |
| agent panel has ≥2 members | one batched `GET /api/sessions?keys=…` |
| expanding a card body | one single-event request for that event |
| switching a card to Raw | one `?include=raw` request for that event |
| tag filter opens | one `GET /api/annotations/tags` |
| analysis panel opens | **zero** |
| ribbon mode switch | **zero** |
| turn expand/collapse | **zero** beyond the body fetch |

No polling, no automatic retry. SSE `sessions_changed` invalidates the slim detail exactly
as the session view already does.

---

## D17. Four states and honest incompleteness

Every async surface implements design-system REQ-006 — loading, empty, error with retry,
success: the turn list, each card body, the agent panel, the annotations panel, the
analysis panel, the tag filter.

- `complete === false` → a persistent banner names the omitted event count, and every
  session-level total renders `—`, never a partial sum presented as a total.
- `segmentationSource !== 'turn_key'`, **or** `turn_key` with a declared provenance other
  than `native_boundary` → the stat bar renders the D3 criteria line for that case. The
  string comes from this change's i18n keys; the frontend must not write its own wording.
- A tool renderer that fell back renders a small `raw` marker.
- An adapter that declared `unavailable` provenance produces the `sequence_fallback` or
  `llm_boundary` path; the criteria line says so plainly rather than implying precision.

---

## D18. Hash state and persistence

`HASH_VIEWS` is unchanged — no view is added. In `HashState`:

| Key | Change |
|---|---|
| `layout` | **removed** (`time|sequence` belonged to the deleted gantt) |
| `turn` | added: selected turn index, integer ≥ 0 |
| `ribbon` | added: `'time' \| 'token'`, default `'time'` |
| `tags` | added: comma-separated session-list tag filter |

Invalid values are dropped without throwing, exactly as existing keys are.

`localStorage`, under the existing `awesome-telemetry.` namespace:

| Key | Value |
|---|---|
| `.trajectory.railWidth` | number, clamped 240–300 |
| `.trajectory.ribbonMode` | `'time' \| 'token'` |

A stored `.layout` key is ignored and may be removed on read. Hash wins over localStorage.

---

## D19. Design tokens

`design-tokens.md` gains §2.8 Role colours — six groups, three tiers each (`-fg`,
`-emphasis`, `-subtle`), both themes, each with a mandatory icon:

| Role | Prefix | Dark fg | Light fg | Icon |
|---|---|---|---|---|
| system | `--role-system-` | `#f85149` | `#d1242f` | `gear` |
| user | `--role-user-` | `#3fb950` | `#1a7f37` | `command` |
| assistant | `--role-assistant-` | `#ab7df8` | `#8250df` | `message` |
| tool | `--role-tool-` | `#39c5cf` | `#1b7c83` | `tool` |
| reasoning | `--role-reasoning-` | `#8b949e` | `#59636e` | `thought` |
| compact | `--role-compact-` | `#d29922` | `#9a6700` | `chevron-down` |

Plus `--ribbon-active` (dark `rgba(230,237,243,.28)`, light `rgba(31,35,40,.18)`).

Values reuse existing product hues so the palette stays single. **No component writes a
colour literal** (design-system REQ-002); `src/styles/tokens.test.ts` enforces it.

The source spec's light-only `#F5F5F5` / `#FFFFFF` / `#1A202C` palette and its
red-for-selection are not adopted: this product is dark-first with an equal light theme,
and red means failure.

---

## D20. Performance budget and file whitelist

| Scenario | Budget |
|---|---|
| `deriveTurns` over 1,000 events | < 20 ms |
| `computeRibbon` over 200 turns | < 5 ms |
| session detail first paint, 200-turn session | < 2 s |
| turn list scroll | 60 fps, stable DOM node count |
| ribbon mode switch | zero network, one React commit |
| card body / raw expansion | ≤ 1 request each, cached thereafter |
| session list with tag join | within the existing 524-entry baseline; record the delta |

Virtual scrolling activates above 50 turns. Collapsed turn row height is fixed
(`--row-lg`); an expanded turn opts out and renders at natural height.

**File whitelist.** Touch nothing else; if another file is genuinely required, stop and
report the requirement id, the file, and why.

*Contracts (task group 1 only)*
```
openspec/contracts/{data-model,database,api,design-tokens,nfr}.md
```

*Backend*
```
server/storage/schema.ts + schema.test.ts
server/storage/annotations.ts + annotations.test.ts        (new)
server/storage/columns.ts
server/storage/query-engine.ts + query-engine.test.ts
server/server.ts + server.test.ts
```

*Frontend core*
```
src/core/trace-types.ts + trace-types.test.ts
src/core/turn-model.ts + turn-model.test.ts                (new)
src/core/turn-ribbon.ts + turn-ribbon.test.ts              (new)
src/core/turn-analysis.ts + turn-analysis.test.ts          (new)
src/api/client.ts
src/hash-router.ts + hash-router.test.ts
src/layout.ts + layout.test.ts
src/i18n.ts + i18n.test.ts
src/App.tsx + App.test.tsx
src/components/SessionList.tsx + SessionList.test.tsx
src/components/SessionToolbar.tsx + SessionToolbar.test.tsx
```

*Deleted*
```
src/components/TraceTimeline.tsx + TraceTimeline.test.tsx
src/components/EventInspector.tsx + EventInspector.test.tsx
src/components/inspector-text.tsx + inspector-text.test.tsx   (only if nothing else imports it)
```

*Frontend components (new, under `src/components/trajectory/`)*
```
TrajectoryPane.tsx + .test.tsx
TrajectoryRail.tsx + .test.tsx
AgentHierarchyPanel.tsx + .test.tsx
AnnotationsPanel.tsx + .test.tsx
TrajectoryStatBar.tsx
TurnRibbon.tsx + .test.tsx
TurnList.tsx + .test.tsx
TurnCard.tsx
MessageCard.tsx + .test.tsx
ToolCallBlock.tsx
TrajectoryAnalysisPanel.tsx + .test.tsx
renderers/{index.ts,read.tsx,bash.tsx,todowrite.tsx,grep.tsx,glob.tsx,edit.tsx,write.tsx,json-tree.tsx}
renderers/{index.test.ts,json-tree.test.tsx,renderers.test.tsx}
```

*Styles*
```
src/styles/tokens.css
src/styles/components.css
src/styles/components/trajectory.css                       (new)
src/styles/components/timeline.css                         (prune deleted selectors)
```

Do not hand-edit `src/generated/**`. Do not touch any adapter, scanner, proxy, realtime, or
watch file — Change A owns those.
