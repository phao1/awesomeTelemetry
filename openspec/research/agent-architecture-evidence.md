# Agent architecture r4 — P0 evidence (2026-10-30)

## Scope and provenance

Read existing local Claude Code and Codex JSONL line by line; no model execution,
monitoring, proxy activation or Agent configuration changes. Source bodies, prompts,
paths, native IDs and credentials are not copied into this repository.
OpenCode deferred by explicit user instruction on 2026-10-30 (the configured
source contained only an empty database). It is not claimed verified for P0.

## Claude Code

One observed root has three distinct Agent tool-use IDs (six retained tool-use
blocks, hence counting blocks would double-count). Three result rows carry
`toolUseResult.agentId`; all three match existing child files. Observed linkage
completeness: 3 / 3 = 100%, scoped to this root and these retained records only.
The denominator is distinct delegation tool-use IDs, not message blocks or files.
A missing result or missing corresponding child would remain unresolved.

Each child contains `isSidechain: true`, its own `agentId`, and the parent's
`sessionId`. The old adapter emitted that parent ID as the child's session identity,
creating multiple native owners and preventing unique parent resolution.
The fix emits child `agentId` as session identity and `sessionId` as parent_session,
scoped to the child. Message/request/tool identifiers also use the child scope.
Missing/conflicting identifiers mark the identity bundle incomplete; no parent is
invented from titles, timestamps, filename conventions or message similarity.
Existing scanner keys use file paths and recursive discovery includes subagents.
The scanner refreshes an old identity snapshot on an explicit scan even when the
file fingerprint is unchanged; subsequent unchanged scans are skipped. Integration tests
exercise the real scanner, SQLite persistence and task projection, including
child-before-parent scan ordering and unchanged-file skip behavior.

`src/adapters/__fixtures__/claude-sidechain.json` retains two observed message-row
shapes. All native IDs, timestamps and content were replaced with fixed neutral
values; extra fields were omitted. It is a structural regression fixture, not
production traffic or an evaluation outcome.

Usage observed: input_tokens can be 2 while cache_read_input_tokens and
cache_creation_input_tokens are tens of thousands, so input excludes cache.
Cache creation is explicitly reported separately. output_tokens_details.thinking_tokens
is present in these records; the existing adapter does not yet expose that detail.
Do not claim the old adapter's reasoning=0 means no reasoning occurred.
The observed detail is a subset of output in the inspected samples. Anthropic
[documents thinking_tokens as part of billed output](https://platform.claude.com/docs/en/build-with-claude/extended-thinking),
corroborating outputIncludesReasoning=true for this observed format. This combines
local field evidence with the upstream definition, not an independent billing audit.
Repeated assistant rows can share message.id and usage: do not sum copies as calls.
This P0 changes identities only, not the existing token aggregation implementation.

## Codex

95 local session_meta rows have a parent declaration (top-level
parent_thread_id or source.subagent.thread_spawn.parent_thread_id).
Counting the first metadata row of each file gives 94 child declarations; 93
have a parent file in the inspected directory. The missing parent is unresolved,
not fabricated. The existing identity collector already reads both and scopes parent_session to
the child metadata id. No Codex source change is needed for those shapes.
Existing native identity tests exercise these mappings.

At inspection, 9,485 last_token_usage records explicitly carried
cache_write_input_tokens; do not hardcode cacheWriteReported=false for Codex.
7,212 had positive reasoning_output_tokens and every one satisfied
`total_tokens = input_tokens + output_tokens`, supporting that output already
includes reasoning. cached_input_tokens is a subset counter within input;
no additional cached-input charge is added to the native total. These observations
are local/version-specific, not a guarantee for every Codex release or provider.

## Confirmed specification decision

User confirmed r4/kit set-based chain coverage, including union across repetitions
of a case; existing ordered/per-repetition checks remain independent diagnostics.
This is documented in AF-003; P3 will implement and verify parity separately.

## Remaining verification

OpenCode real-record verification is deferred by user instruction. Provider/version
semantics must be rechecked for other formats; no independent billing audit was run.
P1 scope aggregation and P5 metric conversion are not implemented in P0.

## Validation status

Typecheck, lint, build and full tests passed (348 files, 4188 passed, one existing
skip). Four new cases cover valid sidechain identity, missing/conflicting child
identity, and real scanner/storage/task integration including stale-parser refresh.
All hard performance budgets passed, but the near-2MiB forwarding p95 exceeded
the previous local baseline by more than 20% in two measurements; see
PERF-BASELINE.md. On 2026-10-30 the user explicitly deferred performance
investigation ("先不管性能 先搞"), authorizing P0 delivery with this unresolved
relative regression disclosed. No assertion, threshold or performance budget changed.

## P1 native scope verification

On 2026-10-30, an isolated in-memory database was populated by the real Claude
scanner from the same local parent and child files. The scope collector returned
four definition entries, three distinct delegations, three confirmed child
relationships, three retained event locators and two coupling pairs. Only these
aggregate observations are retained here, not the original records. A Vite
module-loader hot-reload socket was denied by the environment; collection itself
completed successfully without a model or monitoring service. This is service-level
verification, not browser acceptance (scheduled for P6).

Adjacent tests use real temporary JSONL files, scanners, SQLite and task projection:
Claude definition merging across two roots, duplicate delegation deduplication,
filters, cache isolation/invalidation, invalid inputs and cancellation; Codex spawn
result/child-role matching. No tested collector logic is mocked. Scope traffic has
unknown timing/token values rather than fabricated zeroes. The P3 kit parity work
is still pending; P1 does not certify the existing coupling formula as kit parity.

P1 checks: npm run typecheck, npm run test and npm run lint passed: 349 test files,
4,191 tests passed, one existing skip. Performance investigation remains deferred
by the user; no threshold was changed. Browser screenshots remain scheduled for P6.
