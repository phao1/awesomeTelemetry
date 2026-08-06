## Context

See `proposal.md` for motivation. Readable SQLite providers already expand a database into records keyed by in-row session IDs, while JSONL providers use one file per session. Trae is the exception: decryption currently returns one record whose metadata comes from the first resolved session while its turns span the whole database. Startup must remain synchronous and must not decrypt SQLCipher data.

The live macOS database confirms the relevant schema: `chat_session` supplies `session_id`, `session_title`, `created_at`, and `updated_at`; current `server_history_info.session_id` values are message IDs and resolve through `chat_message.message_id -> chat_message.session_id`.

## Goals / Non-Goals

**Goals:**

- Make the stored session row the universal card boundary.
- Split Trae in one decrypt/read pass without per-session prepared queries.
- Reconcile a source's complete native-session set, including placeholder and stale-row cleanup.
- Preserve startup and no-change scan performance.

**Non-Goals:**

- Merging semantically similar conversations across native session IDs.
- Changing session-list HTTP shapes or frontend card rendering.
- Decrypting Trae during the startup index phase or an HTTP request.
- Changing manually configured subagent merge groups.

## Decisions

### D1: Group at the scanner boundary, not in the UI

`readTraeDb` will return an array of native sessions, each with metadata and turns filtered to one resolved `session_id`. The adapter will normalize each item independently. This keeps list, detail, metrics, search, SSE, and reports aligned automatically. A UI-only split was rejected because it would leave storage keys, detail routes, counts, and metrics incorrect.

### D2: Bulk-read metadata and group in memory

The decrypted database will be read with a bounded set of explicit-column queries: all session metadata, agent metadata, history rows, message-to-session mapping, LLM fallback rows, and tool calls. Maps keyed by `session_id` will assemble records without `db.prepare()` inside loops. This is preferred over one SQL query per session because the project explicitly prohibits per-loop prepares and the full source is already the authoritative scan unit.

### D3: Reuse the existing multi-session key rule

Every Trae record key will be `deriveSessionKey('trae', sourcePath, sessionId)`, matching readable SQLite providers. Duplicate titles remain distinct because titles do not participate in identity. JSONL providers retain their file-derived keys.

### D4: Source-scoped authoritative reconciliation

A shared reconciliation helper will store all records produced by a complete database scan, query existing scan-generated rows for the same provider/source, and cascade-delete rows absent from the new key set. It will notify every added, changed, or removed key. Trae uses this to remove its file-level placeholder; readable SQLite providers use the same lifecycle so all multi-session database providers converge on one rule.

### D5: Preserve asynchronous placeholder semantics

The startup index phase creates a Trae placeholder only when no expanded native rows already exist for that source. HTTP detail access to a pending Trae placeholder returns `pending: true` and never invokes decryption. The polling scanner performs expansion in the background. This avoids a transient 404 caused by deleting the requested placeholder during its own request.

### D6: Native metadata supplies empty-session time bounds

Trae session shapes will carry `chat_session.created_at/updated_at`. Normalization will use event bounds when events exist and native metadata as the fallback for empty sessions, so a real empty conversation does not appear at the Unix epoch.

## Risks / Trade-offs

- [Risk] A successful expansion changes old Trae file-level keys and invalidates bookmarked detail URLs. -> This is an intentional one-time migration; realtime notifications remove the old key and expose stable native keys.
- [Risk] Reconciliation could delete rows after a partial parse. -> Reconcile only after decryption and all grouping complete successfully; failed decrypts preserve existing rows and placeholders.
- [Risk] Startup could recreate a placeholder while an unchanged expanded set exists. -> Suppress the placeholder when source-scoped native rows are already stored, and cover restart behavior with a regression test.
- [Risk] Bulk reads may include hidden/deleted Trae sessions. -> Preserve Trae's native session rows as the source of truth initially; filtering semantics can be specified separately if product requirements demand it.

## Migration Plan

1. Deploy the scanner and cleanup changes without a schema migration.
2. Run one forced Trae scan so the existing aggregate row expands into native session rows.
3. Confirm list/detail parity and realtime removal of the old file-level key.
4. Rollback is code-only; existing native rows remain valid scan data, while the previous implementation would recreate its file-level row on the next forced scan.
