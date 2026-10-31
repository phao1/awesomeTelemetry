# Official Claude HTTP hooks — functional continuation 5

2026-10-20, M11 increment on M12 npm baseline. Previous goal turn is progress:
selected original archive implementation and actual HTTP/files/tar/UI evidence.
Full functional goal persists; reliability/soak/storage split remain deferred.
Proposal authorizes necessary contract extensions. No real Agent/config edits.

## Exact file whitelist

- This record and npm-continuation.md.
- openspec/contracts/{claude-hooks,data-model,database,api,nfr}.md.
- openspec/specs/{storage,frontend,proxy-capture}/spec.md.
- src/core/claude-hooks.ts.
- server/hooks/{claude-receiver,claude-control}.ts and adjacent .test.ts.
- server/storage/claude-hooks.ts and claude-hooks.test.ts.
- server/storage/{schema,columns}.ts; server/storage/schema.test.ts (additive21/version assertions only).
- server/http/claude-hook-routes.ts and claude-hook-routes.test.ts.
- server/http/error-envelope.ts (documented hook codes only).
- server/server.ts (guard, owner, routes, coalesced event and shutdown).
- src/App.tsx and src/core/trace-types.ts (shared SSE notification only).
- src/components/{OfficialHooksPanel,ProxyView}.tsx and OfficialHooksPanel.test.tsx.
- src/components/TraceLinksPanel.tsx (explicit selected-session entry if needed).
- server/realtime/sse.ts and sse.test.ts (forward the documented shared hint).

## Intended full increment

Explicit disabled-by-default authenticated local receiver; persistent hashed
receiver secret with explicit enable/rotate/disable; official HTTP settings
fragment returned only on explicit configuration, never installed automatically.
Preserve bounded raw JSON in the existing original store and immutable metadata
in an additive table. Empty204 acknowledgement never authorizes/blocks a tool,
injects context or rewrites results. No transcript/file paths from payload read.
Show paged metadata, exact session/agent/tool filters, directly reported native
duration and source/raw detail on demand. Native scan jumps require exact unique
complete retained session identity, not time/path/model inference. Preserve every
delivery; content hashes are not execution/retry/billing identity. Coalesce saved
hints200ms through existing shared SSE; no body/event-per-session fan-out.

Official reference checked2026-10-20:
https://code.claude.com/docs/en/hooks . HTTP fields, common fields, PreToolUse,
PostToolUse/Failure and SubagentStart/Stop are primary protocol evidence.
PreToolUse is before execution/permissions; SubagentStop also covers internal
agents and does not alone prove a spawn. Actual Claude/version certification
remains separate from functional protocol tests and generated settings.

## Delivered and verified

CH-001..006, storage REQ-031 and frontend REQ-043 now have a working local
receiver/control, additive schema21, bounded immutable metadata and original-file
storage, paged exact session/tool/agent scope queries, one selected integrity-
checked raw read, and shared coalesced200ms saved hints. The Proxy workspace is
collapsed by default. Opening reads one combined bounded page/status response;
configuration requires explicit raw-retention acknowledgement and revision.
Generated settings contain the one returned secret; disk contains only its hash.
Settings are never installed. UI owns cancellation/deadlines/late results and
uncertain configuration recovery; hinted metadata refresh is capped at5s and
can be paused; body reads remain manual. Original native jumps require exact
unique complete retained Claude scan identity. No native identity/team writes.

New tests:3 control,3 storage,9 real production HTTP,6 component,1 additive
schema and1 shared SSE forwarding case. The real HTTP tests exercise actual
original files and SQLite close/reopen, token persistence/rotation/disable,
empty204 bytes, whitespace/unknown-field preservation, repeated delivery,
strict UTF8 and exact256KiB boundary, root/child/session scope isolation,
SHA corruption, ten-thousand-row and quota refusal, failed metadata commit,
four in-flight requests, two-second stalled reads, shutdown ownership,
disable-before-drain ordering, coalesced hints and escaped64KiB pagination.
Schema tests preserve old rollback triggers/assertions; latest-version success
expectations change20→21 as required by the new contract, not weakened checks.
NUL-bearing projected strings/query IDs explicitly fail400 before SQLite can
interpret a shorter length than the actual ID. No original is silently clipped.

Focused64 tests passed; full307 files3724 passed/1 existing skipped107.87s,
typecheck/build/full lint/package and strict OpenSpec passed. Full regression
initially exposed the existing catch guard: malformed hook hints now return
explicitly instead of a comment-only catch; the assertion was retained.
Final validation after the NUL field guard: same307 files3724 passed/1 skipped,
109.49s; build (TypeScript included), full lint, package, strict OpenSpec and
diff check passed. Logs:
/tmp/awesomeTelemetry-hooks-{focused,regression,typecheck,build,lint,package,spec}.log.

## Real preview / acceptance boundary

Positively identified old owned backend82679/cwd/command and stopped only it.
Reused the same retained SYNTHETIC fixture, no seed rerun, no real scanner,
Agent, Frida or CDP execution. Merged isolated configuration verified all9
providers disabled. Initial compiled backend PID91233/exec96971 was refreshed
after the final NUL guard; final PID92008/exec24057 at127.0.0.1:4188 starts
schema21 with3 sessions/111 events; Vite76300 at5188 remains. Actual backend
status and Vite page reads report disabled revision0/count0; the control file
and plaintext token are not created by reads. Browser tab1 was reloaded, shared
SSE restored, official panel expanded and metadata refreshed. It visibly shows
disabled/0 deliveries, unchecked acknowledgement, disabled enable/disable
controls and an honest empty list. No enable/rotate/disable/config install or
hook delivery was performed in the retained preview. Screenshot:
/tmp/awesomeTelemetry-official-hooks-preview.png; tab marked deliverable.
Post-update readonly SQLite check:3 sessions/111 events/1 proxy/1 Frida/0 hooks.
Receiver control file remains absent. Experiment record remains byte-identical,
SHA256489d569475d7a3b9a0f94ea706a2d8c62453a94ed43e2e06db97e853249e912b.

Actual installed-Claude/version invocation is still unverified. Fixture tests
do not certify runtime callbacks, permission outcomes, spawning or Windows.
Hook crash journal/reconciliation, soak and database splitting remain later
reliability work per the user's ordering. The functional goal is still active:
12.2 is partial, not closed; ledger41 closed/33 partial/2 unimplemented. Remaining
functional clauses include other target hooks, actual Windows capture hook,
complete native-source archive and collector interoperability, safe real replay
and optimization quality experiments. No commit/merge/push/publication occurred.
