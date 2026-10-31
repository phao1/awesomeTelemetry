# Claude official HTTP hook observation (CH-001..006)

## CH-001 Wire types

Defined verbatim in src/core/claude-hooks.ts; normalized native/proxy records and
identity/source unions remain unchanged. The endpoint accepts declared Claude
hook JSON from a token-holding local sender; it does not authenticate a binary.

```ts
export const CLAUDE_HOOK_EVENTS = ['SessionStart','SessionEnd','PreToolUse','PostToolUse','PostToolUseFailure','SubagentStart','SubagentStop','Stop'] as const;
export type ClaudeHookEvent = typeof CLAUDE_HOOK_EVENTS[number];
export interface ClaudeHookStatus {
  enabled: boolean;
  revision: number;
  receivedCount: number;
  lastReceivedAt: string | null;
}
export interface ClaudeHookSummary {
  id: number;
  receivedAt: string;
  eventName: ClaudeHookEvent;
  nativeSessionId: string;
  agentId: string | null;
  agentType: string | null;
  toolUseId: string | null;
  toolName: string | null;
  nativeDurationMs: number | null;
  payloadBytes: number;
  nativeSessionKey: string | null;
  nativeSessionState: 'unique' | 'ambiguous' | 'unresolved' | 'manifest_incomplete';
}
export interface ClaudeHookDetail extends ClaudeHookSummary {
  rawJson: string;
  sha256: string;
}
export interface ClaudeHookPage {
  status: ClaudeHookStatus;
  items: ClaudeHookSummary[];
  nextCursor: number | null;
  hasMore: boolean;
}
export interface ClaudeHookSettings {
  hooks: Record<string, Array<{ hooks: Array<{ type: 'http'; url: string; timeout: number; headers: { Authorization: string } }> }>>;
}
export interface ClaudeHookConfigureResult { status: ClaudeHookStatus; settings: ClaudeHookSettings | null }
```

Only receivedAt is generated (ISO UTC admission instant); never a tool start/end
clock. Optional duration_ms from PostToolUse/Failure is native-reported duration,
not derived from receipt gaps. PreToolUse is not proof execution began or passed
permission; terminal hooks are reported outcomes only. Same tool ID is scoped by
session_id plus agent_id (null is its own scope). Subagent IDs are not invented
native session IDs. No content/time/name/hash correlation or charge aggregation.

## CH-002 Control and ingress

All routes use existing local connection/Host/Origin and foreground guards;
no-store, static ApiError for non-2xx. No CA/global proxy/Agent-config mutation.
GET `/api/hooks/claude/status` returns ClaudeHookStatus, no secret/config path.
POST `/api/hooks/claude/configure`: object with expectedRevision nonnegative safe
integer and enabled boolean; enabling/rotating additionally confirmRaw:true.
No unknown keys. Returns ClaudeHookConfigureResult. Enabling always rotates a
32random-byte base64url token; returned only inside settings HTTP Authorization.
User manually merges fragment with existing hooks; never replace permissions or
other settings. Fragment covers8 events, uses actual127.0.0.1 backend socket port,
timeout5, no decisions/context/output mutations. Uses official default failure
continuation; unsupported Claude versions remain unverified, no guessed fallback.

Persist only {version:1,revision,enabled,tokenHash:string|null} atomically in
app-owned claude-hook-receiver.json (<=4096B,0600); missing means disabled rev0.
Validate before adoption, reject malformed/nonregular/symlink/oversized config.
No hash/path in responses. SHA256/timing-safe token comparison; after restart
already-applied tokens remain valid. Disable persists false before waiting for
already-admitted writes; new admissions reject. Rotation permits already-admitted
deliveries to finish but rejects new old-token deliveries. One configuration write.

POST `/api/hooks/claude/events`: only enabled receiver plus Authorization Bearer
token, application/json, <=256KiB raw UTF8,2s request-read deadline. Success204
EMPTY only after complete raw-file+metadata commit (never hook decision JSON).
Unknown event or malformed known fields400 BAD_REQUEST, over-size413 HOOK_LIMIT;
disabled409 HOOK_DISABLED; absent/wrong token401 HOOK_AUTH_REQUIRED;
stale expectedRevision409 HOOK_CONFLICT; concurrent configure409 HOOK_BUSY;
capacity/in-flight/row bound503 HOOK_LIMIT; file/DB/config/read error503
HOOK_UNAVAILABLE; closing503 SERVER_SHUTTING_DOWN. Unexpected fields survive in
raw JSON unchanged; no transcript/cwd/path is followed and auth headers are not
telemetry payload. Require nonempty session_id<=512 and known hook_event_name.
Tool events require tool_name nonempty<=128; tool_use_id optional/null<=512.
SubagentStart/Stop require agent_id nonempty<=512. Optional agent_id/agent_type
other events null/absent allowed; empty agent_type preserved (internal agents).
Known malformed IDs/duration reject, never truncate; absent values stay null.
Projected string fields and exact query IDs must not contain NUL; reject them
before SQLite's length() could treat a NUL-terminated prefix as the whole ID.

## CH-003 Storage and failure boundary

Schema21 only adds claude_hook_events and indexes from database.md. Preserve
every delivery as its own id; no hash dedupe. Store original payload in existing
CaptureBodyStore; raw JSON never in SQLite/list/SSE. Max10000 retained metadata
rows, explicit refusal; no auto eviction. At most4 accepted writes/1MiB input,
one complete256KiB raw ref per row, same original quota and metadata capacity
admission. Ack/notify only after metadata commits. Failed/unacknowledged writes
may leave quota-counted raw originals, never delete evidence automatically or
claim saved. Crash-journal/reconciliation for hooks remains a later reliability
gate; it does not weaken successful-ack persistence. Disable/close await owners.

## CH-004 Bounded inspection and retained native resolution

GET `/api/hooks/claude/events?cursor=<positive>&limit=50&sessionId=...&toolUseId=...&agentId=...`:
ClaudeHookPage, descending id keyset; limit1..50, default50. Unknown/duplicate
params400. Optional exact sessionId<=512; toolUseId nonempty<=512 requires both
sessionId and explicit agentId (empty means null/root, otherwise<=512). Without
toolUseId, agentId still requires sessionId. No fuzzy/path/time filter. One count/
last query, one metadata page and one batch native-owner query, <=64KiB JSON.
Get native owner via exact indexed agent:claude/session/nativeSessionId/scopeNULL,
scan Claude source only; unique AND complete may return one original session key.
Multiple owners ambiguous; incomplete manifest never unique. This means matching
declared identity, not verified hook sender or child-session/runtime causality.
No writes to native identity/association/team tables.

GET `/api/hooks/claude/events/:id`: exactly one <=256KiB raw file, verify byte
count/SHA/UTF8 and metadata fields against the retained row, bounded1MiB JSON.
Missing404 HOOK_EVENT_NOT_FOUND; missing/corrupt source503 HOOK_UNAVAILABLE.
No transcript/cwd read, model/tool execution or raw per-row fan-out.

## CH-005 Notifications/UI

BusEvents adds hook_events_changed:{latestId:number}; one latest saved ID per
200ms unref window, no bodies/per-session events. App's one SSE forwards hint to
Proxy's explicit collapsed OfficialHooksPanel; no new global view or EventSource.
Panel opens with one bounded page/status read, independent explicit controls,
raw-retention acknowledgement, expected revision and uncertain command recovery.
Generated settings are visible only after configure and never auto-installed or
sent to another service. Hide secret snippet on close/source/control uncertainty.
Read/selected-body waits5s, configure10s owned cancel/late suppression. Explicit
refresh/paging/exact-tool-scope query; no body fetch until selected detail. Saved
hints mark metadata stale; at most one active metadata refresh/5s while panel is
open, hints exist and no prior error; pause/manual refresh remain available.
Unknown/empty/error/unavailable/incomplete states and copy bilingual; inert text,
64KiB initial raw preview,8..28px controls, original native-session jumps only.
All visible received counts are observations, not distinct executions/costs.

## CH-006 Official evidence (checked2026-10-20)

https://code.claude.com/docs/en/hooks#http-hook-fields documents HTTP JSON POST,
headers and default failure continuation. Common input, PreToolUse,
PostToolUse/Failure, SubagentStart/Stop sections define the retained keys.
PreToolUse may precede permission denial; SubagentStop can be an internal agent.
Actual installed version, real hook invocation and platform remain unverified
until separately exercised. No fixture test certifies those.
