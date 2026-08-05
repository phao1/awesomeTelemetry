## Context

The index/detail division of labor is fixed in `project.md` §3.3: **do no
useless work, no heavy work on the request path, transfer size by tier**.
The current implementation misread "don't parse bodies" as "produce no
titles", so the index phase is fast but meaningless — 34 of its 38 output rows
are unrecognizable.

T-03 expanded the SQLite-class **index** by session, but the **detail** phase
still assumed file-level granularity, so it is necessarily empty.

The `server/proxy/` MITM implementation was completed in M11 with tests; the
only missing piece is HTTP route wiring.

## Goals / Non-Goals

**Goals:**
- every first-screen list row is recognizable (real title + real event
  count), without violating the index-phase performance budget
- OpenCode / CodeArts / CodeAgent2 sessions open with content
- "parse failure" and "genuinely empty" are distinguishable at the API layer
- Proxy / Frida can be started from the UI

**Non-Goals:**
- no D-003 JSONL tail incremental reads (lowest priority; wait until real
  large files become the bottleneck)
- no changes to the Trae SQLCipher decryption chain (P-3 trimming still
  applies; no Windows machine)
- no schema changes, no data migration

## Decisions

**D1 · Title extraction uses "stream until the first user message, then
stop", not the full adapter pipeline.**
The alternative — running the full adapter in the index phase — was rejected:
it cancels the index/detail layering, and the worst session would stretch the
5ms budget into seconds. Interrupting streaming gets both the title and the
budget.

**D2 · Injected content is filtered by a prefix/tag blacklist, no semantic
judgment.**
Measured injection blocks have stable signatures: `# AGENTS.md`,
`<environment_context>`, `<system-reminder>`, `<user_instructions>`. A
blacklist is sufficient and zero-cost; semantic judgment is both slow and
untestable.

**D3 · Parse failure returns non-2xx + `SESSION_PARSE_FAILED`, never 200 +
empty.**
This is the precondition for the frontend's four-state distinction
(`specs/design-system/spec.md` REQ-006). Returning 200 + an empty array makes
"empty session" and "backend broken" look identical, leaving the frontend no
way to act.

**D4 · Proxy/frida startup is async; the HTTP handler returns "starting"
immediately, readiness signaled via SSE.**
Follows architecture principle ②. Synchronously waiting for MITM to bring up
CA + listen would block the event loop for hundreds of milliseconds.

**D5 · When no title is obtainable, fall back to
`<provider> session · <local time>`, never the file name.**
File names are the problem itself; an honest placeholder beats a misleading
identifier.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| streaming reads may still be slow on huge JSONL (739MB class) | the first user message is usually near the file head; set a hard cap (fall back to D5 if 1MB is read without a hit) |
| the blacklist misses some provider's injection format | add a real-structure fixture test per provider; extend the blacklist, never change tests |
| OpenCode dialect reuse (codearts/codeagent2) behavior forks | all three share the same test matrix; mind G4.4: cache.read cumulative uses max, reasoning uses sum |
| proxy async startup leaves inconsistent state | `status` gains a `starting` intermediate state; frontend renders three states |
| index slowing down startup | `perf:check` hard gate: degradation > 20% rolls back |
