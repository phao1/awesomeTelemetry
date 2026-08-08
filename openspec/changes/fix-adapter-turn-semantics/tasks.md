# Tasks — fix-adapter-turn-semantics

Change A of two. Six task groups, one execution window each.

```
§1 契约冻结 ──┬── §2 codex 修复 ──┐
              ├── §3 claude 修复 ─┼── §5 存储与迁移 ── §6 签收
              └── §4 其余 7 adapter ┘
```

Parallel-safe after §1: {§2}, {§3}, {§4}. §5 needs §2–§4. §6 needs everything.

At the end of every group: run that group's targeted tests, then
`npm run typecheck && npm run test && npm run lint`. Mark `[x]` only with evidence.
Do not commit or push unless the user separately asks.

---

## 1. Contract freeze

- [x] 1.1 Read `AGENTS.md`, this change's `proposal.md`, `design.md`, and all four delta specs; record every conflict before touching implementation.
- [x] 1.2 Re-measure the A1 baseline against the live database and record any number that has moved; do not proceed on a stale measurement.
- [x] 1.3 Add `reasoning` and `compact` to `TraceKind` and `TRACE_KINDS` in `openspec/contracts/data-model.md`, with the A2 rationale for each.
- [x] 1.4 Add `turnKey: string | null` to the event contract in `data-model.md` with the five A3 rules stated normatively, and add the `TurnKeySource` provenance enum.
- [x] 1.5 Add `turn_key TEXT` and the schema v7 destructive-rescan migration to `openspec/contracts/database.md`, naming the cleared tables explicitly and the preserved tables explicitly.
- [x] 1.6 Add the one-time rescan cost to `openspec/contracts/nfr.md`.
- [x] 1.7 Copy the enum, the field, and the provenance type verbatim into `src/core/trace-types.ts`; extend `src/core/trace-types.test.ts` with membership assertions for both new kinds and a `null`-is-valid assertion for `turnKey`.
- [x] 1.8 Run `npm run typecheck` and let the compiler enumerate every exhaustive `switch` over `TraceKind`; list those sites in your report as the work surface for §2–§5.
- [x] 1.9 Run `openspec validate fix-adapter-turn-semantics --strict`; do not proceed until it and typecheck pass.

## 2. Codex adapter repair

**Depends on:** §1

- [x] 2.1 Map `custom_tool_call`, `custom_tool_call_output`, `mcp_tool_call_end`, `web_search_call`, `web_search_end`, `tool_search_call`, and `tool_search_output` to tool-family events with real tool names.
- [x] 2.2 Map `patch_apply_end` to `file_write`.
- [x] 2.3 Map `reasoning` and `agent_reasoning` to `reasoning`.
- [x] 2.4 Map `context_compacted` to `compact`.
- [x] 2.5 Make `turn_aborted` set a cancelled status on the affected cycle rather than emitting a bare system event.
- [x] 2.6 Stop emitting a standalone event for `token_count`; attach its usage to the cycle's assistant event, and emit a single carrier only when the cycle has no assistant message.
- [x] 2.7 Assert that per-session aggregated token usage is byte-identical to the pre-repair value on a fixture whose totals were computed independently of the adapter.
- [x] 2.8 Implement the A4 codex turn-key rule: a new cycle opens at a `response_item` whose immediately preceding `response_item` was a `function_call_output`; the key is the opening item's payload id; `event_msg` records attach to the open cycle. Declare `stream_structure` provenance. **`task_started` is not a boundary** — A1 conclusion 1.
- [x] 2.9 Map `response_item/message` with role `developer` or `system` to `system` rather than `llm`.
- [x] 2.10 Drop `event_msg/agent_message` when the same cycle carries a `response_item/message`; keep it only when the cycle has none.
- [x] 2.11 Stop emitting an event for `session_meta`; keep `turn_context` and `world_state` as system events and let `turn_context` inform session-level model and cwd fields.
- [x] 2.12 Pair tool calls with their outputs through the source call identifier, not adjacency; cover the `call_X` / `call_X:N` form seen in live data.
- [x] 2.13 Add adapter tests for every mapping in A6, the token-total invariant, turn-key grouping across a full cycle, an aborted turn, and a payload type not named in A6 still falling to `system`.
- [x] 2.14 Add a fixture built from the real 48-line rollout recorded in A1 and assert it yields exactly 9 cycles with the boundaries shown there, one assistant message for each of the two mirrored pairs, and the three developer-role messages classified as system.
- [x] 2.15 Add a regression test asserting `task_started` does not open a turn, using a fixture where its count differs from the cycle count.
- [x] 2.16 Run targeted adapter tests, then `npm run typecheck && npm run test && npm run lint`.

## 3. Claude adapter repair

**Depends on:** §1 (parallel with §2, §4)

- [x] 3.1 Detect whether a `type: 'user'` row's content is a tool-result block before deciding what to emit.
- [x] 3.2 Attach a tool result to the tool event whose id equals the block's tool-use id, setting the output side and `hasOutput: true`.
- [x] 3.3 Emit an unmatched tool result as a result-only tool event carrying the block's error flag as status; never drop it and never convert it back to a user message.
- [x] 3.4 Keep genuine user rows emitting `user_prompt`, with the existing system-injection filter unchanged.
- [x] 3.5 Implement the A4 claude turn-key rule: the assistant row's `message.id`, inherited by its `tool_use` parts and by the results that answer them; declare `message_identity` provenance.
- [x] 3.6 Make the assistant row's parts carry the message id in a way that does not depend on parsing `event.id`.
- [x] 3.7 Apply A11 stable ordering so same-timestamp parts of one message keep source order.
- [x] 3.8 Add adapter tests for a tool-result row not producing a user prompt, result attachment by id, an unmatched result, an error result, a genuine prompt still emitted, turn-key grouping across an assistant message with two tool calls, and same-timestamp ordering stability.
- [x] 3.9 Add a regression test asserting the `llm > tool > user_prompt > tool > user_prompt` pattern seen in live data no longer appears for a tool-result fixture.
- [x] 3.10 Run targeted adapter tests, then `npm run typecheck && npm run test && npm run lint`.

## 4. Remaining seven adapters

**Depends on:** §1 (parallel with §2, §3)

- [x] 4.1 For each of codearts, opencode, trae, codeagent, codeagent2, qoder, workbuddy: read its fixture and record what boundary signal, if any, the source actually carries.
- [x] 4.2 Implement the codearts rule from A4 (message id prefix of the event id, obtained without string-parsing the public id field) and declare `message_identity`.
- [x] 4.3 Implement opencode and trae rules if their fixtures expose a message or round identifier; otherwise return `null` and declare `unavailable`.
- [x] 4.4 Implement codeagent, codeagent2, qoder, and workbuddy rules from their fixtures; return `null` and declare `unavailable` where no signal exists.
- [x] 4.5 Add a fixture test per adapter asserting the grouping its fixture actually supports, and stating in the test name or a comment that the rule is fixture-derived when no live data backs it.
- [x] 4.6 Add a shared test asserting no adapter synthesises a turn key from timestamp proximity or event count.
- [x] 4.7 Add a shared test asserting every adapter declares a turn-key provenance value.
- [x] 4.8 Run targeted adapter tests, then `npm run typecheck && npm run test && npm run lint`.

## 5. Storage, phase classification, and metric movement

**Depends on:** §2, §3, §4

- [x] 5.1 Add `turn_key TEXT` to the events DDL and bump `SCHEMA_VERSION` to 7.
- [x] 5.2 Implement the A10 migration in order: add column, clear the four named tables, mark all sessions as detail-not-loaded, record completion; throw visible rebuild guidance on failure.
- [x] 5.3 Enumerate cleared tables explicitly so tables added by later changes are preserved by default.
- [x] 5.4 Add `turn_key` to the explicit column lists in `columns.ts` and to the slim projection; no wildcard select.
- [x] 5.5 Map `turnKey` through the writer and the query engine, preserving `null`.
- [x] 5.6 Add schema tests: fresh v7, v6 upgrade clearing exactly the four tables and preserving the rest, repeated init being a no-op, newer-version refusal, and migration failure throwing.
- [x] 5.7 Add a round-trip test proving `turn_key` survives write and read, including `null`.
- [x] 5.8 Add both new kinds to the phase classifier per A8, with reasoning inheriting its cycle's phase and compaction assigned understand.
- [x] 5.9 Exclude compaction events from average tool duration and error rate on both computation paths.
- [x] 5.10 Recompute every expected value that moved; never loosen an assertion.
- [x] 5.11 Re-run the metrics-consistency test between SQL aggregation and per-session computation; fix the implementation if it disagrees, never the tolerance.
- [x] 5.12 Run targeted storage and metrics tests, then `npm run typecheck && npm run test && npm run lint`.

## 6. Verification and sign-off

**Depends on:** all groups

- [ ] 6.1 Run `openspec validate fix-adapter-turn-semantics --strict` with no warnings.
- [ ] 6.2 Run `npm run typecheck && npm run test && npm run lint && npm run build && npm run perf:check`; fix implementation, never relax assertions.
- [ ] 6.3 Audit the diff against the A12 whitelist; list every file touched outside it and confirm each was an expected-value update only.
- [ ] 6.4 Prove no runtime dependency was added.
- [ ] 6.5 Audit the AGENTS.md prohibitions on every file touched, in particular no `SELECT *`, no prepare-in-loop, no silent scan-state catch, and no whole-file regex split.
- [ ] 6.6 Back up the live database, run the migration against it, and record: rows cleared per table, rows preserved per table, and migration duration.
- [ ] 6.7 Trigger a full rescan and record wall-clock duration, sessions repopulated, and event count before versus after.
- [ ] 6.8 Re-run the A1 measurement queries after the rescan and record the new provider-by-kind distribution; codex `system` must have dropped by roughly the reclassified volume and `tool` plus `reasoning` must have risen correspondingly.
- [ ] 6.9 Record turn-key coverage per provider: how many events carry a non-null key, and the provenance each adapter declared.
- [ ] 6.10 Re-run the A1 segmentation check on the largest codex and claude sessions and record turns-per-session before versus after; a codex session that previously produced 864 turns must now produce a count consistent with its `task_started` count.
- [ ] 6.11 Record before-and-after phase distribution, error rate, average tool duration, and tool event count for one codex and one claude session, per A9.
- [ ] 6.12 Append the new performance baseline and annotate the superseded entry.
- [ ] 6.13 Mark only evidenced tasks complete and report Delivered / Contract mapping / Verification / Needs confirmation exactly as `AGENTS.md` requires, listing every adapter whose rule is fixture-derived and unverified against live data.
