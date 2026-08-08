## Why

An agent trajectory is a sequence of decision cycles: the model observes, reasons, acts,
and receives feedback. The user-facing question — "what happened on turn 7?" — is only
answerable if the event stream preserves those cycle boundaries.

It does not. Measured against the live local database on 2026-08-07 (103 sessions,
35,299 events):

| Finding | Evidence |
|---|---|
| `llm` is not one inference | Codex emits `llm` for both `token_count` usage records (6,492) and assistant messages (2,034). One 3,125-event session segments into **864 turns**, 165 of them holding a single event. |
| Claude splits one inference across events | The adapter emits one event per assistant content part, so one API message becomes 2–3 `llm` events plus one `tool` event per `tool_use` block. |
| Codex tool calls are filed as `system` | `custom_tool_call` (2,211), `custom_tool_call_output` (2,211), and `patch_apply_end` (1,548) all fall through to the unknown-type branch. **About 64% of Codex events are misclassified**, so a turn view built on today's data would show Codex sessions with almost no tool activity. |
| Reasoning is invisible | `reasoning` (4,701) and `agent_reasoning` (350) also land in `system`. |
| Claude tool results are filed as user messages | Claude Code stores tool results as `type: 'user'` rows; the adapter converts them to `user_prompt`. The stream reads `llm > tool(Bash) > user_prompt > tool(Bash) > user_prompt`, and every tool result would render as a fabricated user message. |
| Context compaction is unlabelled | `context_compacted` (4) is indistinguishable from any other unknown type. |

Two facts point at the fix. First, the boundary information **exists in the source data
and is being discarded** — Codex writes `task_started` (160) / `task_complete` (147),
Claude groups assistant parts under one `message.id`. Second, native tool-call identity
already survives into `event.id` (`toolu_…` for Claude, `call_00_…` and `call_00_…:38`
for Codex), so call/result pairing needs no invention either.

This change repairs the event semantics at the layer that knows the source format — the
adapter — before any UI is built on top of it. It is the prerequisite for
`add-trajectory-inspector`.

## What Changes

- Extend `TraceKind` with `reasoning` and `compact`. The enum is documented as closed;
  extending it is a deliberate contract amendment, not an oversight.
- Add `turnKey: string | null` to the event contract. Events belonging to one decision
  cycle share one key. The adapter supplies it because only the adapter knows the source
  format; `null` means "this source carries no boundary signal" and is an honest,
  supported value.
- Implement `turnKey` in all nine adapters, each derived from that adapter's real source
  shape and covered by a fixture test. An adapter whose fixture contains no boundary
  signal returns `null` and records why.
- Repair Codex classification: `custom_tool_call` / `custom_tool_call_output` /
  `patch_apply_end` / `mcp_tool_call_end` / `web_search_call` become tool-family events;
  `reasoning` / `agent_reasoning` become `reasoning`; `context_compacted` becomes
  `compact`; `token_count` stops being an `llm` message and becomes a usage carrier only.
- Repair Claude classification: a `type: 'user'` row whose content is `tool_result` is
  attached to its tool event's `outputSummary` instead of being emitted as a
  `user_prompt`, which also fills the `hasOutput: false` hole those events carry today.
- Bump the schema, clear derived event data, and force a full rescan so no session is
  served with the old classification.
- Accept the resulting movement in phase distribution, four-dimension metrics, and agent
  overview. Today's numbers are computed over misclassified events and are not a baseline
  worth preserving.

## Capabilities

### Modified Capabilities

- `trace-model`: adds two kinds and the `turnKey` field, and states that turn identity is
  an adapter responsibility with a supported unknown value.
- `adapters`: adds a per-provider turn-key rule, repairs Codex and Claude classification,
  and requires fixture evidence for every provider's rule.
- `storage`: adds the `turn_key` column, the schema bump, and the destructive-rescan
  migration with its data-preservation boundary.
- `metrics-analysis`: maps the two new kinds into phase classification and records that
  metric values move as a consequence of the repair.

## Impact

- **Contracts:** `data-model.md` (enum + field), `database.md` (column + migration),
  `nfr.md` (rescan cost). No API route changes.
- **Backend:** nine adapters, the phase classifier, the event writer, the schema.
- **Frontend:** type updates and any exhaustive `switch` over `TraceKind`; no visual work.
- **Data:** `events`, `event_raw`, `metrics`, and `scan_state` are cleared on upgrade;
  `sessions`, `proxy_requests`, `frida_captures`, and `session_prompt_context` are
  preserved. Source files are untouched, so the rescan is fully reproducible.
- **Metrics:** phase distribution, `errorRate`, `avgToolDurationMs`, and agent-overview
  aggregates all move. Expected-value updates in existing tests are part of this change.
- **Dependencies:** none added.
- **Evidence:** live database measurement 2026-08-07, recorded in `design.md` D1.
