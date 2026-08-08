# Codex `/goal` prompts — fix-adapter-turn-semantics (Change A)

Six windows, one per task group. Paste into a fresh Codex window after `/goal`.
Do not shorten a prompt before its first run.

**Model:** codex + deepseek-v4-flash. **Working directory:** repo root.
**Change B (`add-trajectory-inspector`) must not start until A6 reports green.**

| Window | Task group | Depends on | Parallel with |
|---|---|---|---|
| A1 | §1 contract freeze | — | nothing |
| A2 | §2 codex adapter | A1 | A3, A4 |
| A3 | §3 claude adapter | A1 | A2, A4 |
| A4 | §4 remaining seven adapters | A1 | A2, A3 |
| A5 | §5 storage + phase + metrics | A2, A3, A4 | — |
| A6 | §6 sign-off | all | — |

---

## Shared preamble

Every prompt carries this block. It is repeated on purpose — a fresh window has no memory
of the others.

```text
Read first, in this exact order:
1. AGENTS.md — document priority, ten prohibitions, five must-dos, output format
2. openspec/changes/fix-adapter-turn-semantics/proposal.md — why this exists
3. openspec/changes/fix-adapter-turn-semantics/design.md — fixed decisions A1-A12,
   including the measured baseline in A1 and the file whitelist in A12
4. openspec/changes/fix-adapter-turn-semantics/specs/*/spec.md — the delta specs
5. openspec/changes/fix-adapter-turn-semantics/tasks.md — your task group
6. openspec/contracts/{data-model,database,nfr}.md, openspec/specs/adapters/spec.md,
   openspec/specs/trace-model/spec.md, and openspec/gotchas.md before each edit

Field names, enum values, table names, and limits come from those files. Do not write
any of them from memory.

Context: this change repairs event semantics BEFORE any turn UI is built. Measured on
the live database 2026-08-07: about 64% of Codex events are misclassified as `system`,
Codex emits 6,492 phantom `llm` events from usage records, and every Claude tool result
is emitted as a fabricated user message. design.md A1 has the full measurement.

Rules that apply to every window:
- Touch only the files in design.md A12. Expected-value updates in existing tests
  elsewhere are the ONE permitted exception (design A9) — record every such file.
- No new runtime dependency. The project allows exactly four.
- Never loosen, widen, or delete an assertion to make a test pass. When a metric value
  legitimately moved, RECOMPUTE the expectation from the corrected classification and
  say so in a comment naming this change.
- Never synthesise a turn key from timestamp proximity, event count, or a guess. A
  correct `null` beats a wrong key, because a wrong key silently mis-slices every
  downstream turn.
- Tests live next to source as foo.ts + foo.test.ts, never in __tests__/.
- Convert undefined to null before writing to the database.
- Mark a tasks.md checkbox [x] only when the evidence for it exists.
- Do not commit or push unless the user separately asks.

Stop and ask — do not guess through — if: a contract conflicts with the design; a source
format turns out not to carry the signal design A4 assumes; the A1 measurement no longer
matches the live database; you need a file outside A12; or the token-total invariant in
A6 cannot be satisfied.

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

## A1 — Contract freeze

```text
/goal Freeze the contracts for openspec/changes/fix-adapter-turn-semantics/, then stop. Keep working until every task in §1 of that change's tasks.md is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Your scope is tasks.md §1 only (1.1 through 1.9). Write no adapter code.

Start with task 1.2: re-measure the design A1 baseline against
agent-observe-data/observe.sqlite. If any number has moved materially, report it before
continuing — the whole change is justified by those numbers and a stale measurement
invalidates the rules built on it.

Then amend three contracts:
1. data-model.md — add `reasoning` and `compact` to TraceKind/TRACE_KINDS with the A2
   rationale; add `turnKey: string | null` with all five A3 rules stated normatively;
   add the TurnKeySource provenance enum.
2. database.md — add `turn_key TEXT` and the schema v7 migration. The migration is
   DESTRUCTIVE for derived data: it clears events, event_raw, metrics, and scan_state,
   and preserves sessions, proxy_requests, frida_captures, and session_prompt_context.
   Name both lists explicitly. Do NOT write it as "clear everything except …" — a later
   change adds an annotations table that must survive by default.
3. nfr.md — the one-time rescan cost.

Then copy the enum, field, and provenance type verbatim into src/core/trace-types.ts and
extend trace-types.test.ts with membership assertions for both new kinds and a
null-is-valid assertion for turnKey.

Task 1.8 matters more than it looks: run npm run typecheck and let the compiler enumerate
every exhaustive switch over TraceKind. That list IS the work surface for windows A2-A5.
Put it in your report verbatim. Do not silence any of those sites with a default branch.

Definition of done: openspec validate fix-adapter-turn-semantics --strict passes,
typecheck/test/lint pass, §1 boxes checked with evidence, and the exhaustive-switch site
list is in your report.
```

---

## A2 — Codex adapter repair

```text
/goal Implement task group §2 of openspec/changes/fix-adapter-turn-semantics/tasks.md — repair Codex event classification and add its turn keys. Keep working until every §2 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete — TraceKind carries `reasoning` and `compact`, and the event
type carries `turnKey`. If not, STOP and report.

Your scope is tasks.md §2 only (2.1 through 2.16). Files: src/adapters/codex.ts and its
test, plus src/adapters/helpers.ts if a shared helper is genuinely needed.

Before writing anything, open the real rollout file quoted in design.md A1 and read it end
to end. It is 48 lines. Every rule below was verified against it, and your fixture in task
2.14 is built from it.

This adapter is where the damage is concentrated. Live measurement: Codex produces 11,664
`system` events, of which about 10,700 are actually tool calls, tool outputs, patch
applications, or reasoning. It also produces 6,492 `llm` events that are `token_count`
usage records, not messages. design.md A6 has the complete mapping table — implement it
exactly.

Three things that will decide whether this window succeeds:

1. TOKEN TOTALS MUST NOT MOVE. You are removing 6,492 standalone events whose only
   content was usage. Their usage must be attached to the decision cycle's assistant
   event instead. Task 2.7 requires an assertion that per-session aggregated token usage
   is identical to the pre-repair value, on a fixture whose totals were computed
   independently of the adapter. If that assertion fails, the attachment is wrong — do
   not adjust the expected total.

2. PAIR BY CALL ID, NOT ADJACENCY. Live data shows the call event id is
   `call_00_FUHEa1XZOVIWinblpRnH4144` and its output is the same id with a `:38` suffix.
   Use that relationship. Adjacency breaks the moment two tools run concurrently.

3. `task_started` IS NOT THE TURN BOUNDARY. This is the trap in this window. It looks
   like one and an earlier draft of this design used it. Measured: per-session
   `task_started` counts track user submissions almost exactly (21/24, 2/3, 2/3, 11/12).
   One session with 411 assistant messages and 724 tool calls carries TWO `task_started`
   records — segmenting on it would give that session two turns.

   The real boundary is the item stream: a new cycle opens at a `response_item` whose
   immediately preceding `response_item` was a `function_call_output`. Verified on the A1
   file: 48 lines yield 9 cycles. The key is the opening item's payload id, `event_msg`
   records attach to the open cycle, and provenance is `stream_structure` — NOT
   `native_boundary`, because the boundary is derived from stream shape rather than
   labelled by the source, and the UI will say so.

Three smaller repairs in the same window, all verified on the A1 file:
- `response_item/message` with role `developer` or `system` is the SYSTEM PROMPT. It is
  currently emitted as an assistant reply. Map it to `system`.
- `event_msg/agent_message` duplicates `response_item/message` where both exist (lines
  16/17 and 34/35 of the A1 file). Emit one message per cycle, preferring the
  `response_item`; keep the `event_msg` only when the cycle has no message item.
- `session_meta` is not an event at all. `turn_context` and `world_state` stay as system
  events.

Also required: a payload type NOT named in design A6 must still fall through to `system`.
Task 2.13 wants a test for that — the repair narrows the fallback, it does not remove it.

Definition of done: §2 boxes checked with evidence, targeted adapter tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## A3 — Claude adapter repair

```text
/goal Implement task group §3 of openspec/changes/fix-adapter-turn-semantics/tasks.md — stop Claude tool results from being emitted as user messages, and add Claude turn keys. Keep working until every §3 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete. If TraceKind lacks the new members or the event type lacks
turnKey, STOP and report.

Your scope is tasks.md §3 only (3.1 through 3.10). Files: src/adapters/claude-code.ts and
its test, plus src/adapters/helpers.ts if a shared helper is genuinely needed.

The defect: Claude Code stores tool results as `type: 'user'` rows. The adapter converts
every user row into a `user_prompt` event. Live data therefore reads
`llm > tool(Bash) > user_prompt > tool(Bash) > user_prompt` — 1,059 user_prompt events
against 624 real assistant messages. A turn view built on this would show a fabricated
user message after every single tool call, and the tool events themselves would keep
`hasOutput: false` forever even though the result is right there in the file.

The repair (design A7):
- a user row whose content is a tool_result block is NOT a user prompt;
- attach its text to the tool event whose id equals the block's tool_use_id, and set
  hasOutput true — this fills the hole those events carry today;
- an unmatched tool_result becomes a result-only tool event carrying is_error as status.
  Never drop it. Never turn it back into a user message;
- genuine user rows keep emitting user_prompt, and the existing isGenuineUserPrompt
  system-reminder filter is untouched — it solves a different problem.

Turn keys (design A4): the assistant row's `message.id` is the key. Its tool_use parts
and the results answering them inherit it. Declare `message_identity` provenance.
Task 3.6 is deliberate: carry the message id explicitly rather than string-parsing
event.id. The public id field is `toolu_…` for tool parts, so parsing it would not even
work — and a contract field is not a place to hide structure.

Task 3.7 is easy to skip and expensive to skip: all parts of one assistant row share one
timestamp, so an unstable sort in orderEventsByTime can shuffle them and break the
relationship between turnKey grouping and sequence. Make the sort stable with source
order as tie-break and test it with three same-timestamp parts.

Definition of done: §3 boxes checked with evidence, including the 3.9 regression test
that the llm > tool > user_prompt > tool > user_prompt pattern is gone; targeted adapter
tests green; then npm run typecheck && npm run test && npm run lint all green.
```

---

## A4 — Remaining seven adapters

```text
/goal Implement task group §4 of openspec/changes/fix-adapter-turn-semantics/tasks.md — turn keys for codearts, opencode, trae, codeagent, codeagent2, qoder, and workbuddy. Keep working until every §4 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 is complete. If the event type lacks turnKey, STOP and report.

Your scope is tasks.md §4 only (4.1 through 4.8). Files: the seven adapters and their
tests, plus fixtures under src/adapters/__fixtures__/ (you may ADD a fixture; you must
not delete or weaken one).

Read this before you write anything. Only ONE of these seven has meaningful live data:
codearts, with 155 events. opencode has 15, trae has 43, and codeagent / codeagent2 /
qoder / workbuddy have zero. Your evidence base is each adapter's fixture file, and every
one of the nine has one.

That makes task 4.1 the real work: for each adapter, read its fixture and WRITE DOWN what
boundary signal the source actually carries. Then implement only what the fixture
supports.

The failure mode to avoid: inventing a plausible-looking rule for an adapter you cannot
verify, so that the field is non-null and looks finished. A turn key that is wrong is
worse than null — null makes the consumer fall back and disclose that it did, while a
wrong key silently mis-slices the whole trajectory and nobody finds out.

So: where the fixture shows a message or round identifier, use it and declare
`message_identity`. Where it shows nothing, return null for every event, declare
`unavailable`, and say in the test name or a comment that this adapter carries no
boundary signal in its fixture. That is a complete, correct outcome for this task — not
a gap.

codearts is the one with live evidence: event ids look like
`msg_e5a6706dd001EO50ARXbYTFmlW-1`, so the key is the message id without the part
ordinal. Obtain it from the source record, not by string-parsing the public id field.

Tasks 4.6 and 4.7 are cross-cutting guards: one test proving no adapter synthesises a key
from timestamp proximity or event count, one proving every adapter declares a provenance
value. Both must exist.

Definition of done: §4 boxes checked with evidence, every adapter's rule justified by its
fixture in your report, targeted adapter tests green, then
npm run typecheck && npm run test && npm run lint all green.
```

---

## A5 — Storage, phase classification, metric movement

```text
/goal Implement task group §5 of openspec/changes/fix-adapter-turn-semantics/tasks.md — persist turn keys, ship the destructive-rescan migration, classify the new kinds, and recompute the metric expectations that moved. Keep working until every §5 task is done and evidenced.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §2, §3, and §4 are all complete and green. If any adapter still lacks its
turn-key rule, STOP and report — this window's migration assumes the adapters can
repopulate correct data.

Your scope is tasks.md §5 only (5.1 through 5.12). Files: server/storage/{schema,
columns,writers,query-engine,overview}.ts with their tests, and
src/core/{phase-classifier,metrics}.ts with theirs.

The migration (design A10) is destructive for DERIVED data and must be exact:
  1. ALTER TABLE events ADD COLUMN turn_key TEXT   (idempotent)
  2. clear events, event_raw, metrics, scan_state — NAMED EXPLICITLY
  3. preserve sessions, proxy_requests, frida_captures, session_prompt_context
  4. set detail_loaded = 0 on every session
  5. record completion so a second run is a no-op
Failure throws with rebuild guidance. A silent catch is a rework condition.

Task 5.3 is not stylistic. Write the cleared list explicitly, never as "everything except
the following". Change B adds a session_annotations table holding the user's hand-written
tags and notes; if this migration is written as an exclusion list, that table gets wiped
by a migration that predates it, and the user's own data is gone. Enumerate what you
delete.

Phase classification (design A8): reasoning inherits the phase of its own decision
cycle's inference event — it is not an activity of its own. compact is `understand`.
Compaction events are excluded from average tool duration and error rate on BOTH
computation paths, not just the one you happen to be editing.

Tasks 5.10 and 5.11 are where this window is most likely to go wrong. Repairing 6,400+
codex events genuinely moves errorRate, avgToolDurationMs, and phase distribution. When
an existing test fails on a value:
  - RECOMPUTE the expectation from the corrected classification and comment it with this
    change's name — that is correct and expected;
  - do NOT widen a tolerance, relax a comparison, or delete an assertion.
The one test you may never adjust is the SQL-versus-computeMetrics consistency check at
tolerance 0.001. If that fails, your two paths disagree — fix the implementation.

Definition of done: §5 boxes checked with evidence, targeted storage and metrics tests
green, then npm run typecheck && npm run test && npm run lint all green.
```

---

## A6 — Verification and sign-off

```text
/goal Run task group §6 of openspec/changes/fix-adapter-turn-semantics/tasks.md — full verification and sign-off. Keep working until every §6 task is either done and evidenced or explicitly reported as blocked. Do not mark a box optimistically.

<PASTE SHARED PREAMBLE HERE>

Prerequisite: §1 through §5 are complete. Begin by reading tasks.md and listing every
unchecked box from an earlier group — those are inputs to your report, not things to
quietly finish.

Your scope is tasks.md §6 only (6.1 through 6.13). This window verifies; it does not add
features. If verification finds a defect, fix the implementation.

Gates first: 6.1 openspec validate --strict; 6.2 typecheck, test, lint, build,
perf:check; 6.3 diff audit against the A12 whitelist — every file outside it must be an
expected-value update and must be listed; 6.4 no runtime dependency; 6.5 AGENTS.md
prohibition audit.

Then the part that actually proves this change worked. BACK UP THE DATABASE FIRST
(6.6) — the migration clears four tables and there is no undo.

  6.6  run the migration against a copy of the live database; record rows cleared per
       table, rows preserved per table, and migration duration
  6.7  trigger a full rescan; record wall-clock duration, sessions repopulated, and event
       count before versus after
  6.8  re-run the design A1 measurement queries. Codex `system` must have dropped by
       roughly the reclassified volume (~10,700) and `tool` plus `reasoning` must have
       risen correspondingly. If they have not, the repair did not take effect on real
       data — report it rather than passing the gate.
  6.9  turn-key coverage per provider: non-null count, and the provenance each adapter
       declared
  6.10 re-run the A1 segmentation check on the largest codex and claude sessions. The
       codex session that previously produced 864 turns must now produce a count
       consistent with its task_started count. This is the single number that says
       whether Change B is worth starting.
  6.11 before-and-after phase distribution, errorRate, avgToolDurationMs, and tool event
       count for one codex session and one claude session
  6.12 append the new performance baseline; annotate the superseded entry rather than
       deleting it

Your final report must state plainly, for each of the nine adapters, whether its
turn-key rule is backed by live data or only by a fixture. Change B's UI will write a
criteria line from that distinction, so it must be accurate.

Report Delivered / Contract mapping / Verification / Needs confirmation exactly as
AGENTS.md requires. tasks.md must reflect evidence, not optimism.
```

---

## Recovery prompt

```text
/goal Resume task group §<N> of openspec/changes/fix-adapter-turn-semantics/tasks.md.

First: read AGENTS.md, then this change's proposal.md, design.md, the delta specs for the
modules in §<N>, and tasks.md.

Then: run `git status` and `git diff` to see what already exists, run the targeted tests
for §<N>, and report which §<N> tasks are genuinely done versus partially done, before
writing anything new.

Then continue §<N> from the first genuinely incomplete task, under the same rules as the
original window: A12 file whitelist only, no new dependency, no synthesised turn keys, no
relaxed assertions, evidence before a checked box. Do not commit or push unless asked.
```
