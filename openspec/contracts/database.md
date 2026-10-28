# Contract: Database

## v21 local Claude hook observations

Current SCHEMA_VERSION=21; supersedes older labels. Add only this table/indexes;
no native/capture rewrite, rescan, association or accounting mutation.

```sql
CREATE TABLE IF NOT EXISTS claude_hook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK(event_name IN ('SessionStart','SessionEnd','PreToolUse','PostToolUse','PostToolUseFailure','SubagentStart','SubagentStop','Stop')),
  native_session_id TEXT NOT NULL CHECK(length(native_session_id) BETWEEN 1 AND 512),
  agent_id TEXT CHECK(agent_id IS NULL OR length(agent_id) BETWEEN 1 AND 512),
  agent_type TEXT CHECK(agent_type IS NULL OR length(agent_type)<=512),
  tool_use_id TEXT CHECK(tool_use_id IS NULL OR length(tool_use_id) BETWEEN 1 AND 512),
  tool_name TEXT CHECK(tool_name IS NULL OR length(tool_name) BETWEEN 1 AND 128),
  native_duration_ms REAL CHECK(native_duration_ms IS NULL OR native_duration_ms>=0),
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 0 AND 262144),
  payload_ref TEXT NOT NULL CHECK(json_valid(payload_ref) AND length(payload_ref)<=1536)
);
CREATE INDEX IF NOT EXISTS idx_claude_hooks_session ON claude_hook_events(native_session_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_claude_hooks_tool ON claude_hook_events(native_session_id,tool_use_id,agent_id,id DESC);
```

§5.2 adds verbatim constants:
`CLAUDE_HOOK_LIST_COLS = 'id, received_at, event_name, native_session_id, agent_id, agent_type, tool_use_id, tool_name, native_duration_ms, payload_bytes'`;
`CLAUDE_HOOK_DETAIL_COLS = CLAUDE_HOOK_LIST_COLS + ', payload_ref'`.
Lists exclude payload_ref and never load raw originals. Details read one ref.
Hard10000-row admission uses cached count plus existing withCaptureCapacity and
an atomic recheck/insert; no dedupe, automatic expiration or source cascade.
CH-001..006 in claude-hooks.md owns semantics and boundaries.

## v20 reverse native parent lookup

Current SCHEMA_VERSION=20; supersedes historical version labels below. Add only
this metadata index, no source rewrite/backfill/table/column/accounting changes.
Existing v19 index+version upgrade is atomic; repeated init preserves the index.

```sql
CREATE INDEX IF NOT EXISTS idx_trace_identities_parent
  ON trace_identities(namespace, value, source_id, id)
  WHERE kind='parent_session';
```

Use exact indexed native keys for family children. Existing source/session
indexes stay unchanged; page bounds never determine native owner uniqueness.

## v19 TraceLog metadata only

Current SCHEMA_VERSION=19; additive tables/index below, no native/proxy changes,
reparse/backfill/source IO on startup. Preserve historical v18 version-write gate
for failed migration retries. JSON originals/unknown fields are body files only.
Manifest <=4096 bytes; turn metadata <=2048 bytes; one job <=2000 turns/16files.
Use cached statements, one transaction for all new manifests/turns after file
copy; duplicate SHA is read, never delete/reinsert or overwritten. Existing
capture DB/WAL admission applies; max1024 imported sessions, explicit refusal.
Internal session_offset/session_length locate <=64KiB original session object.

```sql
CREATE TABLE IF NOT EXISTS trace_log_imports (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  session_offset INTEGER NOT NULL,
  session_length INTEGER NOT NULL,
  session_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trace_log_turns (
  import_id TEXT NOT NULL REFERENCES trace_log_imports(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY(import_id,sequence)
);
CREATE INDEX IF NOT EXISTS idx_trace_log_imported ON trace_log_imports(imported_at DESC,id);
```

§5.2 additional column constants:
`TRACE_LOG_IMPORT_COLS='id, imported_at, metadata_json, session_offset, session_length, session_sha256'`;
`TRACE_LOG_TURN_COLS='import_id, sequence, metadata_json, byte_offset, byte_length, body_sha256'`.
Lists explicitly select metadata_json only, no body-file IO and no per-row SQL.
Turn detail reads indexed ranges and verifies raw session and turn SHA; unavailable/corrupt
originals fail explicitly, not fallback to another import/native observation.

## v18 explicit capture reparse summary

Historical v18 increment (current version19 above). Additive v17→v18,one bounded metadata row per existing
capture; no backfill/reparse,source cleanup,scan reset,original mutation or index
rebuild. Fresh creation/idempotent current init uses the same table; a compatible
empty new table may remain on a failed version write,retry must preserve sources.
The historical v17 atomic index cutover below remains required for older DBs.

```sql
CREATE TABLE IF NOT EXISTS proxy_capture_analysis (
  proxy_id INTEGER PRIMARY KEY REFERENCES proxy_requests(id) ON DELETE CASCADE,
  parser_version INTEGER NOT NULL CHECK (parser_version > 0),
  metric_version INTEGER NOT NULL CHECK (metric_version > 0),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint)=64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*'),
  parsed_at TEXT NOT NULL,
  request_format TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('completed','incomplete','failed','unknown')),
  usage_json TEXT NOT NULL CHECK (json_valid(usage_json)),
  completeness_json TEXT NOT NULL CHECK (json_valid(completeness_json))
);
```

Column constant `PROXY_CAPTURE_ANALYSIS_COLS = 'proxy_id, parser_version, metric_version, source_fingerprint, parsed_at, request_format, state, usage_json, completeness_json'`.
usage_json/completeness_json adopt only the metadata shapes/limits in data-model;
never persist analysis text/snapshots/headers or unknown extra fields. Cached
explicit-column SELECT by primary key,INSERT ON CONFLICT(proxy_id) DO UPDATE,
bounded summary<=8192B. Caller owns synchronous transaction with fresh identity/
fingerprint/deletion checks and existing capacity-admitted finite commit retry.
No new queue/capture/billing row. Confirmed body deletion's existing intent/body
clear transaction DELETEs this one summary too; metadata expiry FK-cascades only
summary,never source files. No startup reparse or body file read from status.

Functional selected capture comparison/native parent-reference projections use
the existing capture/body/processing/transport/deletion and identity/source/
session tables only. No schema version, table or index changes. Parent refs
are source-indexed; matching owner sessions use exact native session/scope NULL
index keys. No global parent_session index scan, source reparse or mutation.

## v17 session-only native lookup index

Historical v17. The v16→v17 cutover atomically replaces only
idx_trace_identities_native with the definition below and writes schema_version.
Rollback retains the previous index/version on failure. Keep every identity row,
value/scope/locator, source manifest, association/decision, scan state, capture
ref and original file; no reparse/rescan/vacuum or automatic data cleanup.

```sql
DROP INDEX IF EXISTS idx_trace_identities_native;
CREATE INDEX IF NOT EXISTS idx_trace_identities_native
  ON trace_identities(namespace, kind, value, scope, source_id)
  WHERE kind='session' AND scope IS NULL;
```

Fresh creation uses the partial CREATE directly; current-v17 init MUST NOT drop
or rebuild it. Current automatic matching queries constrain session/scope NULL
and must retain indexed exact native-key lookups after ANALYZE. Drive matching
from json_each native keys using CROSS JOIN trace_identities INDEXED BY
idx_trace_identities_native, so even tiny analyzed databases use SEARCH rather
than scanning every native identity. Other retained
identity kinds are paged by idx_trace_identities_source, not silently discarded
or falsely described as indexed cross-tool matching. Future tool-edge queries
need their own bounded index design. The old wide index duplicated long scoped
tool IDs and produced18.38MB WAL in one actually admitted capture. Keep original
values unchanged; reducing this unused index coverage is not evidence truncation.

## Capture metadata pressure admission (no schema change)

Capture transactions share one per-Database admission lane, max64 queued/active
operations. Before each capture commit/retry and first journal admission, read
actual database/WAL sizes asynchronously; missing WAL is zero, other stat faults
fail closed. Memory-only fixtures use page_count*page_size and zero WAL. At WAL
>=8,000,000 bytes, attempt checkpointWal once, then remeasure. Checkpoint MUST
temporarily set busy_timeout=0 for synchronous TRUNCATE and restore the exact
previous value on every path; busy is skipped without retry. Diagnostic reads
never checkpoint. Refuse capture transactions at combined>=180,000,000 bytes or
WAL>=8,000,000 bytes, reserving headroom under200MB/20MB hard budgets. No DELETE,
VACUUM, max_page_count mutation, scan policy change or original eviction.
Existing admitted journal updates retain their bounded evidence; a refused
final commit keeps the journal/originals and emits no saved notification. Recovery
inserts use the same gate. Other writers are NOT governed by this lane, so this
does not certify indefinite shared-DB growth or replace NFR escalation work.

Async stat results MUST NOT authorize a capture mutation if another SQLite
write invalidated the snapshot before the synchronous action. Sample cached
SELECT total_changes(), PRAGMA schema_version and PRAGMA data_version around each async size read,
including the post-checkpoint read. The former detects writes on this connection
(rollback is conservatively dirty); schema_version also detects same-connection
DDL/index creation that does not increment total_changes. This PRAGMA is SQLite's
schema cookie, NOT the application's _meta.schema_version (currently19).
data_version detects observed commits on
other connections. Stamp reads temporarily use busy_timeout=0 and restore the
exact prior value before invoking user code; failures use the static unavailable
error, never expose driver messages. Reject pre-existing caller transactions rather than measuring
an uncommitted snapshot or retaining a stale read transaction. Retry at most3
size snapshots per admitted action INCLUDING any post-checkpoint snapshot, at
most one checkpoint attempt total, with no busy wait, and fail closed with
CAPTURE_METADATA_UNAVAILABLE on continued churn; retain the existing64 lane
bound and original/journal evidence. No promise to reserve space against an
arbitrary future external write; native writers remain unthrottled and the
long-term separate-DB architecture is still required by NFR §7.

Read the current timeout via cached SELECT timeout FROM pragma_busy_timeout;
unlike a prepared PRAGMA busy_timeout getter, this remains dynamic at step time.
Timeout setters MUST stay fresh db.pragma executions: SQLite applies them at
prepare time, so reusing a prepared setter does not reapply it. Use simple:true
scalar results for setters rather than allocating unused result arrays. Cache
only the safe read statements, never trade exact restore semantics for speed.

## v16 durable original-deletion queue (fuse-agent-monitoring)

Historical v16 addition. Additive v15→v16 only; no backfill, original/file
cleanup, scanner reset or automatic queue execution during migration.

```sql
CREATE TABLE IF NOT EXISTS proxy_original_deletions (
  id TEXT PRIMARY KEY,
  proxy_id INTEGER NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  request_ref TEXT NOT NULL,
  response_ref TEXT NOT NULL,
  store_directory TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','failed','complete')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_original_deletions_pending
  ON proxy_original_deletions(state,created_at,id);
CREATE INDEX IF NOT EXISTS idx_capture_request_original
  ON proxy_capture_bodies(CASE WHEN json_valid(request_ref) THEN json_extract(request_ref,'$.id') END,proxy_id);
CREATE INDEX IF NOT EXISTS idx_capture_response_original
  ON proxy_capture_bodies(CASE WHEN json_valid(response_ref) THEN json_extract(response_ref,'$.id') END,proxy_id);
```

`PROXY_ORIGINAL_DELETION_COLS = 'id, proxy_id, request_id, request_ref, response_ref, store_directory, state, error, created_at, updated_at, completed_at'`.
`PROXY_ORIGINAL_REF_COLS = 'request_ref, response_ref'` is the bounded two-column
projection for admission/execution; do not load response headers/processing or
transport merely to validate file ownership.
`ORIGINAL_DELETION_STATUS_COLS = 'id, proxy_id, request_id, state, error, created_at, updated_at, completed_at'`
is the public status projection; no body refs/path are read for status guards.

Confirmed API integration:
new intent and idempotent retry also atomically clear the target's request_body,
response_body,raw_request_body,raw_response_body,system_prompt and set
system_prompt_len=0. Revalidate request/body identity before clearing on resume.
Do not change headers, usage, transport, identities, associations, scan/team data.
No schema change/backfill/automatic full-row deletion. Original refs retain their
observed capture status. API guards consult the indexed job status even after
failed file cleanup; never fall back to body copies for a confirmed intent.
No FK: confirmed intent must survive proxy metadata deletion. Admission (max1024
retained jobs, request ID<=1024 chars, directory<=4096 chars, normalized refs
<=1536 UTF8 bytes each) and exact request+both-body tombstone insert MUST share
one transaction. Idempotence uses the unique AUTOINCREMENT proxy ID plus exact
request/body identity, never request ID alone. Check both body ownership indexes
for other proxy owners at admission AND execution. Use separate INDEXED BY
request/response UNION ALL arms with LIMIT1; do not let OR become a whole-table
JSON scan after ANALYZE. Unknown/malformed refs fail
without intent or file IO; JSON-valid index expressions tolerate legacy bad refs.
One active run, no hidden unbounded queue; pending resume uses indexed key order.
Verify snapshotted original digests before unlink; missing files are idempotent.
Directory/identity/shared-reference conflicts stop cleanup visibly. Write completion
only after file removal/reconciliation; status-write failure retains durable intent
and throws rather than sending success. Failed jobs require explicit retry.
The per-request confirmed API holds the monitor stopped/serializes starts,
clears body/prompt copies and exposes metadata-only status/explicit retry.
Pending cleanup resumes before capture admission; failed jobs do not auto-retry.
This is not full request erasure: scan/team and request metadata rows remain.
All SQL columns explicit/cached; bounded nonblocking retries. Web confirmation is
implemented per frontend REQ-020; this is not full request erasure/global Clear.

## v15 exact capture deletion markers (historical addition)

At version15, additive v14→v15 creates the following table; markers
have no FK to proxy_requests because deletion must not cascade them away.

```sql
CREATE TABLE IF NOT EXISTS proxy_capture_tombstones (
  request_id TEXT NOT NULL,
  request_body_id TEXT NOT NULL,
  response_body_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (request_id, request_body_id, response_body_id)
) WITHOUT ROWID;
```

Column constant: `PROXY_CAPTURE_TOMBSTONE_COLS = 'request_id, request_body_id, response_body_id, deleted_at'`.
Add `CREATE INDEX IF NOT EXISTS idx_proxy_started_utc ON proxy_requests(julianday(started_at), id);`
for indexed UTC startup expiry. Startup's legacy synchronous helper keeps its
signature and MUST NOT be used as an unbounded HTTP-path purge. Current-TTL
admission for uncommitted journals is defined in §6; full capacity/WAL/manual
cleanup remains required before7.3 completion. No arbitrary vacuum, scanner
purge or original deletion.
The new UTC index MUST NOT change linked-context predecessors to global-time
scans: drive from trace_associations INDEXED BY idx_trace_associations_session,
CROSS JOIN proxy_requests by PK; the ambiguity probe uses the reverse proxy
index. Preserve fixed metadata reads, no body columns or temporary sort tree.
Only exact request+both-original identity matches suppress journal recovery.
Markers are inserted atomically before explicit metadata deletion, never from
age alone during recovery. Existing no-original legacy rows have no journal
and require no fabricated body IDs/marker. Equal request ID with different
original IDs is not a deleted observation. No original file deletion, capture
backfill, scanner reset or existing identity/association rewrite. Markers stay
after policy is disabled/lengthened. A global time floor is not authoritative:
it could discard previously uncommitted or newly admitted old-clock evidence.

## Crash journal ownership (fuse-agent-monitoring, no DDL change)

The schema14 journal amendment introduced _meta.capture_journal_owner, an opaque UUID
created idempotently when a configured capture journal is first opened. It
survives restart and never identifies an Agent session. Internal journal files
under capture-directory/.capture-journal contain CaptureJournalEntry only, at
most256KiB/file and16MiB retained metadata/store, with bounded async updates.
No bodies or extra tables are added to SQLite. Original files are not deleted.
Recovery creates the same existing proxy_requests/body/processing/transport
shape in one transaction; unknown end timestamps/durations remain SQL NULL.
It does not reparse, relink or change already committed rows. A request_id hit
is idempotent only when BOTH original IDs match the journal, otherwise report
conflict and preserve evidence. No replace/delete-reinsert or scan reset.
Final metadata transactions retry only SQLITE_BUSY/SQLITE_LOCKED, at most3
attempts with10ms/40ms async backoff. Temporarily use busy_timeout=0 only inside
the synchronous metadata transaction and restore its exact previous value in
finally, so the shared event loop never waits5s on a foreign writer. Normal
connection initialization remains the eight §1 PRAGMAs, unchanged. Failed
commits publish no saved notification and keep their journal for recovery.

## v14 independent transport outcome (fuse-agent-monitoring)

SCHEMA_VERSION=14. Additive v13→v14 introduces only the following table; existing
captures, files, native identities, sessions and scan state remain unchanged.

```sql
CREATE TABLE IF NOT EXISTS proxy_capture_transport (
  proxy_id INTEGER PRIMARY KEY REFERENCES proxy_requests(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL
);
```

Column constant: `PROXY_CAPTURE_TRANSPORT_COLS = 'proxy_id, result_json'`.
result_json encodes CaptureTransportResult, max4096 bytes including optional
CaptureNetworkTiming or CaptureWebSocketConnection (<=512B, independently
validated). No new table,
schema bump or backfill. WS original refs refer to AWSP1 application-message
containers, not HTTP bodies or compressed wire bytes. WS previews remain
bounded existing body columns; metadata lists/SSE never contain them. Optional
Error alone remains a static/native code of at most128
characters. No new DDL/schema bump/backfill or rewrite is needed. Timing is
detail-only and current captures write it atomically with existing outcomes.
Legacy missing timing stays unknown. Original headers remain independently
retained without truncation; the timing header projection is bounded as in
data-model.md. The pre-timing outcome alone retains its existing512B envelope.
Use static/native error
codes only. Missing legacy outcome is absent, not completed. Current MITM
writes it atomically with metadata/processing/body index even without a body
store. Detail reads are fixed-count; no transport-body join on lists/SSE.
Deletion cascades this outcome only; no file deletion, migration backfill,
startup parsing or scan reset.

## v13 capture processing outcome (fuse-agent-monitoring)

SCHEMA_VERSION=13. Additive v12→v13 introduces a separate optional processing
outcome, never changes body completeness or rewrites historical originals:

```sql
CREATE TABLE IF NOT EXISTS proxy_capture_processing (
  proxy_id INTEGER PRIMARY KEY REFERENCES proxy_requests(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL
);
```

Column constant: `PROXY_CAPTURE_PROCESSING_COLS = 'proxy_id, result_json'`.
result_json encodes CaptureProcessingResult, max1024 bytes, static error codes
only (no payload or arbitrary worker exception). Absence means not recorded,
not processing ok. Current MITM atomically writes it with its request/body
index even when original-file capture is not configured. Detail-only reads
are fixed-count, never added to metadata lists or SSE; deletion cascades only
this outcome, not original files/opposite-source records. Existing tables and
scan state remain intact. No startup reparse/backfill or user DB reset.

## v12 native identity and association index (fuse-agent-monitoring)

Additive v11→v12, SCHEMA_VERSION=12: adopt the following DDL verbatim. No startup reparse, rewrite, deletion or scanner reset. Absent manifests remain explicitly not_collected until normal ingestion. Manifests own identities; source deletion cascades only its manifests, associations and decision history, never the opposite source or body files. Identity source ids are scan:<sessionKey> or proxy:<numericId>. Identity and association ids are deterministic SHA-256 hex keys, never a new model-call identity.

```sql
CREATE TABLE IF NOT EXISTS trace_identity_sources (
  id TEXT PRIMARY KEY,
  session_key TEXT UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  proxy_id INTEGER UNIQUE REFERENCES proxy_requests(id) ON DELETE CASCADE,
  parser_version INTEGER NOT NULL,
  complete INTEGER NOT NULL,
  omitted_count INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((session_key IS NOT NULL) != (proxy_id IS NOT NULL))
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS trace_identities (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES trace_identity_sources(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  scope TEXT,
  event_id TEXT,
  source_path TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_trace_identities_source ON trace_identities(source_id, id);
CREATE INDEX IF NOT EXISTS idx_trace_identities_native ON trace_identities(namespace, kind, value, scope, source_id) WHERE kind='session' AND scope IS NULL;
CREATE TABLE IF NOT EXISTS trace_associations (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  proxy_id INTEGER NOT NULL REFERENCES proxy_requests(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_key, proxy_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_trace_associations_session ON trace_associations(session_key, proxy_id DESC);
CREATE INDEX IF NOT EXISTS idx_trace_associations_proxy ON trace_associations(proxy_id, session_key);
CREATE TABLE IF NOT EXISTS trace_association_evidence (
  association_id TEXT NOT NULL REFERENCES trace_associations(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES trace_identities(id) ON DELETE CASCADE,
  PRIMARY KEY (association_id, identity_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS trace_association_decisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id TEXT NOT NULL REFERENCES trace_associations(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  note TEXT,
  decided_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_decisions_association ON trace_association_decisions(association_id, sequence);
```

Column constants:
```ts
export const TRACE_IDENTITY_SOURCE_COLS = 'id, session_key, proxy_id, parser_version, complete, omitted_count, reasons_json, content_sha256, updated_at';
export const TRACE_IDENTITY_COLS = 'id, source_id, namespace, kind, value, scope, event_id, source_path';
export const TRACE_ASSOCIATION_COLS = 'id, session_key, proxy_id, state, reason, created_at, updated_at';
export const TRACE_ASSOCIATION_DECISION_COLS = 'sequence, association_id, state, note, decided_at';
```

Idempotent differential identity writes delete only stale identity IDs after inserting/updating changed rows, never delete/reinsert a whole source. Identical manifests perform no SQL writes. Native session matching uses idx_trace_identities_native and explicit owner checks; ambiguous/new contradictory evidence downgrades affected automatic links. User decisions are never overwritten by refresh. Every manual state transition appends one decision inside the same transaction; repeated identical state/note is a no-op. Relation pages use bulk evidence reads and proxy-list columns only. First confirmedCount counts distinct proxy rows in direct/confirmed states; candidateCount is separate. No cross-source billing aggregation is inferred by this table.

Association-aware context lookup (no new DDL): resolve at most2 active direct/confirmed owners through idx_trace_associations_proxy. A unique owner permits metadata-only predecessor lookup through idx_trace_associations_session joined to proxy_requests by integer PK; exclude a base with another accepted owner using the reverse index. A scalar MAX selects the latest earlier UTC instant (julianday); an index-ordered descending scan with LIMIT 1 selects the maximum eligible id at that instant. Both reads avoid a temporary ORDER BY tree and treat equivalent ISO timestamp spellings consistently. Finally read only the selected base body by PK. This orders observed captures, not native model turns; no heuristic fallback. Legacy parsed-session/capture-group predecessor helpers are candidate lookup utilities only, not automatic context authority. The time-window longest system_prompt lookup is likewise legacy candidate evidence only: it MUST NOT fill a scan session or linked Trace prompt automatically. Select an individual capture's prompt through its existing request/original/analysis views.

## v11 original capture index (fuse-agent-monitoring)

Additive v10→v11: create the following table idempotently; preserve all existing rows/tables/indexes. SCHEMA_VERSION=11. This index stores only body references and response headers, never full body text. Monitoring previews in proxy_requests are at most 64KiB per direction. Original files outlive metadata deletion and are never implicitly removed by cascading SQL; explicit file cleanup is separate.

```sql
CREATE TABLE IF NOT EXISTS proxy_capture_bodies (
  proxy_id INTEGER PRIMARY KEY REFERENCES proxy_requests(id) ON DELETE CASCADE,
  request_ref TEXT,
  response_ref TEXT,
  request_preview_truncated INTEGER NOT NULL DEFAULT 0,
  response_preview_truncated INTEGER NOT NULL DEFAULT 0,
  response_headers TEXT NOT NULL DEFAULT '{}'
);
```

Column constant: `PROXY_CAPTURE_BODY_COLS = 'proxy_id, request_ref, response_ref, request_preview_truncated, response_preview_truncated, response_headers'`. The refs encode CaptureBodyRef as JSON; SQL NULL maps to null. Original acquisition uses a 2MiB bounded analysis preview in memory and stores at most64KiB in SQLite; larger original downloads remain available.

> Original-capture amendment (2026-10-15): full bodies reside outside SQLite in a user-configured local directory. SQLite stores CaptureBodyRef metadata and bounded previews only; body status, byte count and digest must remain queryable. Original headers and content are not redacted. File deletion requires an explicit user action; legacy proxy metadata expiry must not delete original files implicitly. The external body store has a separate 10GB default budget. New SQL integration follows the DDL amendment in this change before schema implementation.


> **Authoritative source.** This is a fresh build; the schema starts at **v1**
> and is currently at **v18** (fusion amendments at the top of this contract).
> Historical **v10** (add-agent-team-observability) added the additive
> team table family — `team_runs`, `team_agents`, `team_agent_edges`,
> `team_tasks`, `team_task_dependencies`, `team_assignments`, `team_messages`,
> `team_activities`, `team_rounds`, `team_artifacts`, `team_evidence`,
> `team_activity_bodies`, `team_metrics`, plus the `team_run_sessions` junction
> table and their indexes. Preceding versions: v8 add-trajectory-inspector
> `session_annotations`; **v9 (2026-08-11 cost_currency calibration audit,
> pre-existing uncommitted change) added `sessions.cost_currency`** — see §3.2;
> before that fix-adapter-turn-semantics `events.turn_key` plus the destructive
> v6→v7 reclassification rescan migration, add-request-context-diff proxy
> capture-group correlation + request-format classification,
> add-mission-control model attribution + cost / duration sources +
> ttft/e2e persistence + scan-time repair rollup,
> calibrate-tokens-and-compare-report TraceMetrics five new fields,
> show-trae-prompt-context `session_prompt_context`. All DDL must be adopted
> verbatim — no column renames, no added or removed columns beyond this
> contract. Corresponding source file: `server/storage/schema.ts`
>
> Numbers marked "reference-implementation measured" come from the recreated
> project's performance diagnostic report (524 sessions / 73,588 events /
> 800.21MB source files) and are the basis for these design decisions.

## 0. Design points at a glance

| Decision | Basis (reference-implementation measured) |
|----------|------------------------------------------|
| `raw` split into its own `event_raw` table, not in `events` | that column was 64.2% of the reference DB (147.82MB); kept in the main table every detail query is forced to load it |
| `events` uses a `(session_id, id)` composite PK, `WITHOUT ROWID` | supports differential upsert instead of delete-and-reinsert (reference changed 1 event with 348 SQL statements) |
| Composite indexes instead of single-column | all 4 hot queries in the reference showed `USE TEMP B-TREE`, worst 210.48ms |
| `metrics` persists four-dimension metrics + `calc_version` | not persisting forces N+1 on callers (reference Agent Overview: 524 requests / 299.6MB) |
| `proxy_requests` carries redundant `system_prompt_len` | avoids `ORDER BY LENGTH(col)` which cannot use an index |
| `scan_state` is a mandatory path; write failures must throw | the reference table had 0 rows, incremental scanning completely dead and silent |
| PRAGMA set fixed in code | the reference never set `wal_autocheckpoint`; WAL grew to 151.82MB |

## 1. Connection initialization

`openWritable(path)` MUST create the parent dir first, then set all 8 PRAGMAs
**in this order**:

```ts
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');        // crash-safe under WAL, much faster writes
db.pragma('wal_autocheckpoint = 2000');
db.pragma('cache_size = -65536');         // 64MB page cache (negative = KB)
db.pragma('mmap_size = 268435456');       // 256MB
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 5000');
```

`openReadonly(path)` uses `{ readonly: true, fileMustExist: true }` and only
sets `mmap_size` and `busy_timeout`.

**Active checkpoint**: called once after each scan round. Returns busy when a
read transaction is active; catch and skip, **never retry blocking**.

```ts
export function checkpointWal(db: Database): void {
  const timeout = db.pragma('busy_timeout', { simple: true }) as number;
  try { db.pragma('busy_timeout=0'); db.pragma('wal_checkpoint(TRUNCATE)'); }
  catch { /* next round */ }
  finally { db.pragma(`busy_timeout=${timeout}`); }
}
```

## 2. Initialization flow

Fresh-DB creation MUST be a single idempotent path with no multi-version
branches:

```ts
export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL);            // §3, all CREATE TABLE IF NOT EXISTS
  db.exec(INDEX_SQL);             // §4, all CREATE INDEX IF NOT EXISTS
  db.prepare(
    "INSERT INTO _meta(key, value) VALUES('schema_version', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(SCHEMA_VERSION));  // SCHEMA_VERSION = 8
  db.exec('ANALYZE');
}
```

On startup, if the read `schema_version` is greater than the code constant,
MUST abort with "Database was created by a newer version". When it is lower,
run the migration chain implemented in `server/storage/schema.ts`
(`migrateSchema`):

- **v1 → v2** (the first landed migration): eight `ALTER TABLE ADD COLUMN`
  statements (see §3) plus three `CREATE INDEX IF NOT EXISTS` (see §4).
- **v2 → v3** (performance escalation, design.md §7.3 R1): `metrics.repair_loop`
  — the Mission closure widget's repair detection moved from a per-request
  full-table window scan (measured 40ms at tier B, over the 30ms budget) to a
  scan-time precompute; the per-request read is now a rollup `COUNT`.
  All `ADD COLUMN` are non-destructive — existing rows keep their values and
  the new columns are backfilled naturally on the next scan round.
- **v4 → v5** (show-trae-prompt-context): create the additive
  `session_prompt_context` table. Existing session/event rows are unchanged;
  prompt context is populated by the next changed or forced Trae scan.
- **v5 → v6** (add-request-context-diff): exactly two additive column
  operations on `proxy_requests` (`capture_group_id TEXT`,
  `request_format TEXT NOT NULL DEFAULT 'unknown'`) plus the two composite
  predecessor indexes from §4. Historical proxy rows remain readable with
  `capture_group_id = NULL` and `request_format = 'unknown'`; no body is
  parsed or backfilled during migration. Rollback uses the prior binary:
  SQLite ignores additive columns and indexes, and new proxy rows remain
  readable through the old explicit column lists.
- **v6 → v7** (fix-adapter-turn-semantics A10): a **destructive
  reclassification rescan**. In order:
  1. `ALTER TABLE events ADD COLUMN turn_key TEXT` — idempotent; a
     duplicate-column failure is tolerated, any other failure throws with
     rebuild guidance.
  2. Clear the derived event data by **named table**, never as "everything
     except": `DELETE FROM events; DELETE FROM event_raw; DELETE FROM metrics;
     DELETE FROM scan_state;`
  3. Leave the preserved tables untouched: `sessions`, `proxy_requests`,
     `frida_captures`, `session_prompt_context`. The deletion list is
     enumerated explicitly so tables added by later changes (e.g. a
     session-level annotations table from add-trajectory-inspector) survive by
     default.
  4. Set `detail_loaded = 0` on every session so the next open triggers a scan.
  5. Record completion in `_meta` so a second run is a no-op.

  No in-place reclassification is attempted: existing rows lack the
  information needed to reconstruct turn keys. The rescan is safe because every
  source file is still on disk and scanning is deterministic; startup after
  upgrade is slower once (contracts/nfr.md §3 records the one-time cost).
- **v7 → v8** (add-trajectory-inspector D15): **additive only** — create the
  `session_annotations` table (§3.10) and its index (§4). No existing table,
  column, index, or projection is modified, and no rescan is triggered.

  **Change A's destructive v6→v7 migration must preserve this table.** That is
  why Change A enumerates the tables it clears (`events`, `event_raw`,
  `metrics`, `scan_state`) instead of writing an exclusion list: a table added
  by a later change such as `session_annotations` is not on that named list and
  therefore survives by default. Storage window task §2.4 must prove this by
  running Change A's migration against a database that already holds
  annotation rows and asserting the rows are still present afterwards.

  The v7→v8 migration is idempotent (`CREATE TABLE IF NOT EXISTS` +
  `CREATE INDEX IF NOT EXISTS`); a second run changes nothing and does not
  fail. Migration failure throws with rebuild guidance — a silent catch is
  prohibited. Rollback uses the prior binary: the new table and index are
  simply unused.
- **v8 → v9** (2026-08-11 cost_currency calibration audit, pre-existing
  uncommitted change): a single idempotent
  `ALTER TABLE sessions ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'`.
  A duplicate-column failure is tolerated (fresh DBs already build it via
  `SCHEMA_SQL`); any other failure throws. No rescan, no semantic change to
  historical rows. **This step is recorded as already-shipped state; the team
  migration below starts at v10.**
- **v9 → v10** (add-agent-team-observability D11): **additive only** — create
  the 13 team-owned tables (§3.11) plus the `team_run_sessions` junction table
  (§3.12) and all their indexes (§4). No existing table, column, index, or
  projection is modified, and no rescan is triggered. The migration is
  idempotent (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`); a
  second run changes nothing and does not fail. Migration failure throws with
  rebuild guidance — a silent catch is prohibited. Rollback uses the prior
  binary: the new tables and indexes are simply unused; the schema marker MUST
  NOT be downgraded, so a documented backup/restore path is required before
  migration (design Migration Plan step 3).
  - Foreign keys cascade **inside** team-owned tables only. `team_run_sessions`
    references both `team_runs` and `sessions`: deleting a session clears the
    junction link (and the activity `session_key` link stays a dangling
    reference that renders "no trajectory"), but does **not** delete the team
    run; deleting a team run deletes team-owned rows but never the sessions.
- Migration failure MUST throw with a "delete the DB and rescan" hint; the
  database is a rebuildable cache of local session files, and a half-migrated
  state is more dangerous than a rescan (decision: tasks.md "已做的决策" #3).
- `initSchema(db)` is idempotent: `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN`
  (duplicate-column errors are caught per statement) + `CREATE INDEX IF NOT
  EXISTS` + `schema_version` upsert + `ANALYZE`.

## 3. Table definitions

### 3.1 `_meta`

```sql
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
```

### 3.2 `sessions`

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT    PRIMARY KEY,
  provider          TEXT    NOT NULL,
  source_agent      TEXT    NOT NULL,
  title             TEXT    NOT NULL DEFAULT '',
  started_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'unknown',
  cwd               TEXT,
  message_count     INTEGER NOT NULL DEFAULT 0,
  event_count       INTEGER NOT NULL DEFAULT 0,
  token_input       INTEGER NOT NULL DEFAULT 0,
  token_output      INTEGER NOT NULL DEFAULT 0,
  token_reasoning   INTEGER NOT NULL DEFAULT 0,
  token_cache_read  INTEGER NOT NULL DEFAULT 0,
  token_cache_write INTEGER NOT NULL DEFAULT 0,
  token_total       INTEGER NOT NULL DEFAULT 0,
  cost_usd          REAL    NOT NULL DEFAULT 0,
  system_prompt     TEXT,
  source_path       TEXT    NOT NULL,
  data_source       TEXT    NOT NULL DEFAULT 'scan',
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  is_subagent       INTEGER NOT NULL DEFAULT 0,
  detail_loaded     INTEGER NOT NULL DEFAULT 0,
  primary_model     TEXT,
  cost_source       TEXT    NOT NULL DEFAULT 'unknown',
  duration_source   TEXT    NOT NULL DEFAULT 'unknown',
  cost_currency     TEXT    NOT NULL DEFAULT 'USD'
) WITHOUT ROWID;
```

> v9 column (pre-existing 2026-08-11 cost_currency calibration audit):
> - `cost_currency` ∈ `USD | CNY` (`PriceCurrency` in `contracts/data-model.md`
>   §12.4), default `USD`. The field name `cost_usd` is retained only to avoid
>   renaming the column; domestic gateways (DeepSeek etc.) price in CNY and the
>   display MUST render `¥` vs `$` by this value. This change is additive-only
>   and recorded here so the contract matches the already-shipped
>   `server/storage/schema.ts`; the team migration below is therefore **v10**,
>   not v9.
>
> `system_prompt` stays in this table (reference 524-row index query at
> 447.8KB / 5.33ms is acceptable), but **list queries must list columns
> explicitly, never `SELECT *`**.

### 3.3 `events`

```sql
CREATE TABLE IF NOT EXISTS events (
  session_id     TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id             TEXT    NOT NULL,
  sequence       INTEGER NOT NULL,
  kind           TEXT    NOT NULL,
  phase          TEXT    NOT NULL,
  title          TEXT    NOT NULL DEFAULT '',
  started_at     TEXT    NOT NULL,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'unknown',
  actor          TEXT    NOT NULL DEFAULT '',
  tool           TEXT,
  input_summary  TEXT,
  output_summary TEXT,
  tokens_json    TEXT,
  error          TEXT,
  model          TEXT,
  content_hash   TEXT    NOT NULL DEFAULT '',
  input_len      INTEGER NOT NULL DEFAULT 0,
  output_len     INTEGER NOT NULL DEFAULT 0,
  turn_key       TEXT,
  PRIMARY KEY (session_id, id)
) WITHOUT ROWID;
```

> **No `raw` column.** raw lives in `event_raw`.
> `content_hash`（fix-session-detail-display §1）：差分写入的内容判等列，
> FNV-1a 64bit hex，覆盖全部可变列；同 (id, sequence) 内容变化时据此触发 UPDATE。
> Duplicate event ids within a session get a `:{sequence}` suffix from the
> adapter; they are unique before hitting the DB.
> `turn_key`（fix-adapter-turn-semantics §1.5）：决策周期标识，nullable；
> `null` 是一等值（源格式无边界信号），不是错误。由 adapter 填充。

### 3.4 `event_raw`

```sql
CREATE TABLE IF NOT EXISTS event_raw (
  session_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  raw        TEXT,
  PRIMARY KEY (session_id, event_id)
) WITHOUT ROWID;
```

> **Deliberately no foreign key**: raw is discardable debug data; cascade
> deletes are executed explicitly by `deleteSession()` to avoid FK checks
> slowing bulk writes.

### 3.5 `metrics`

```sql
CREATE TABLE IF NOT EXISTS metrics (
  session_id            TEXT    PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  total_steps           INTEGER NOT NULL DEFAULT 0,
  duration_by_phase     TEXT    NOT NULL DEFAULT '{}',
  tool_call_count       INTEGER NOT NULL DEFAULT 0,
  verification_present  INTEGER NOT NULL DEFAULT 0,
  avg_tool_duration_ms  REAL    NOT NULL DEFAULT 0,
  verification_coverage REAL    NOT NULL DEFAULT 0,
  error_rate            REAL    NOT NULL DEFAULT 0,
  entered_debug         INTEGER NOT NULL DEFAULT 0,
  tokens_per_step       REAL    NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0,
  calc_version          INTEGER NOT NULL DEFAULT 0,
  ttft_ms               REAL,
  e2e_ms                REAL,
  repair_loop           INTEGER NOT NULL DEFAULT 0,
  total_tool_duration_ms INTEGER NOT NULL DEFAULT 0,
  llm_call_count         INTEGER NOT NULL DEFAULT 0,
  user_interaction_rounds INTEGER NOT NULL DEFAULT 0,
  has_unit_tests         INTEGER NOT NULL DEFAULT 0,
  failed_command_count   INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
```

> v2 columns:
> - `events.model` — llm 事件的模型标识；非 llm 事件或源数据无 model 时为
>   null（design.md §1 P0-B）。
> - `events.input_len` / `events.output_len` — 冗余长度列，避免
>   `ORDER BY LENGTH(col)` 全表扫描（design.md §4 B15，同
>   `proxy_requests.system_prompt_len` 套路）。
> - `sessions.primary_model` — 该会话 token 占比最高的模型（adapter 侧
>   `pickPrimaryModel` 产出，design.md §1 P0-B）。
> - `sessions.cost_source` ∈ `reported | estimated | unknown` — costUsd 的
>   可信度（design.md §1 P0-C）。
> - `sessions.duration_source` ∈ `measured | derived | unknown` — 逐事件
>   durationMs 的来源（design.md §1 P0-A）。
>   This is a session-level adapter declaration, not retained per-event proof:
>   mixed events can include missing/derived values. Linked execution selects
>   this single scalar and batch-reads existing proxy_capture_transport explicit
>   columns via json_each(id page); no schema/index/body duplication is needed.
> - `metrics.ttft_ms` / `metrics.e2e_ms` — 持久化的速度指标，避免跨会话聚合
>   触发 N+1（design.md §4 B6；G11.11：改算法必须 bump
>   `METRICS_CALC_VERSION`）。
> - `metrics.repair_loop`（v3）— 修复循环命中（W-F-W-F-W ≥2 轮，与
>   session-findings repairLoop 同口径），扫描时预计算（design.md §7.3 R1：
>   逐请求窗口扫描 40ms 超预算 → rollup 化）。
> - `metrics.total_tool_duration_ms` / `metrics.llm_call_count` /
>   `metrics.user_interaction_rounds` / `metrics.has_unit_tests` /
>   `metrics.failed_command_count`（v4，calibrate-tokens-and-compare-report
>   §4）— TraceMetrics 五新字段；v3 → v4 迁移同为幂等 ADD COLUMN，
>   新列默认 0/false，随下一轮扫描回填。

> `calc_version` defaults to 0, unequal to the code constant
> `METRICS_CALC_VERSION` (initially 1), so the first read always triggers
> computation and write-back.

### 3.6 `scan_state`

```sql
CREATE TABLE IF NOT EXISTS scan_state (
  source_path   TEXT    PRIMARY KEY,
  provider      TEXT    NOT NULL,
  session_id    TEXT,
  file_size     INTEGER NOT NULL,
  file_mtime_ms INTEGER NOT NULL,
  content_hash  TEXT    NOT NULL,
  byte_offset   INTEGER NOT NULL DEFAULT 0,
  last_scan_at  TEXT    NOT NULL,
  event_count   INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
```

### 3.7 `proxy_requests`

```sql
CREATE TABLE IF NOT EXISTS proxy_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id        TEXT    NOT NULL UNIQUE,
  method            TEXT    NOT NULL,
  url               TEXT    NOT NULL,
  hostname          TEXT    NOT NULL,
  request_headers   TEXT,
  request_body      TEXT,
  response_status   INTEGER,
  response_body     TEXT,
  content_type      TEXT,
  is_streaming      INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT    NOT NULL,
  completed_at      TEXT,
  duration_ms       INTEGER,
  capture_method    TEXT    NOT NULL DEFAULT 'mitm',
  ttnet_encrypted   INTEGER NOT NULL DEFAULT 0,
  system_prompt     TEXT,
  system_prompt_len INTEGER NOT NULL DEFAULT 0,
  model             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  parsed_session_id TEXT,
  parser_route      TEXT,
  capture_group_id  TEXT,
  request_format    TEXT    NOT NULL DEFAULT 'unknown',
  raw_request_body  TEXT,
  raw_response_body TEXT
);
```

> v6 columns:
> - `capture_group_id` — nullable UUID identifying one successful proxy run
>   (design D2); correlation evidence only, never an agent session. Historical
>   rows are null; a later proxy run receives a different value.
> - `request_format` — closed phase-1 classification
>   (`anthropic_messages | openai_chat | openai_responses | unknown`, design
>   D3), default `unknown`; historical rows stay `unknown` (no startup
>   backfill by body parsing).

### 3.8 `frida_captures`

```sql
CREATE TABLE IF NOT EXISTS frida_captures (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  pid                INTEGER NOT NULL,
  captured_at        TEXT    NOT NULL,
  capture_type       TEXT    NOT NULL,
  json_data          TEXT    NOT NULL,
  model              TEXT,
  session_id         TEXT,
  capture_session_id TEXT,
  message_count      INTEGER,
  tokens_json        TEXT
);
```

### 3.9 `session_prompt_context` (show-trae-prompt-context)

One latest Prompt Context snapshot per stored session. Large dynamic bodies are
kept outside `sessions` so list and ordinary detail queries cannot select them
accidentally.

```sql
CREATE TABLE IF NOT EXISTS session_prompt_context (
  session_id        TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  source            TEXT NOT NULL,
  completeness      TEXT NOT NULL,
  captured_at       TEXT NOT NULL,
  sections_json     TEXT NOT NULL DEFAULT '[]',
  model_config_json TEXT NOT NULL DEFAULT '{}',
  analysis_json     TEXT NOT NULL DEFAULT '{}',
  full_system_prompt TEXT
) WITHOUT ROWID;
```

The `trae_db` source MUST store `completeness='dynamic_only'` and
`full_system_prompt=NULL`. Reads use the primary-key index; no additional index
is required.

### 3.10 `session_annotations` (add-trajectory-inspector)

One optional annotations row per stored session: tags (as a JSON array) plus a
free-text note. Added by the additive v7→v8 migration (design D15); it is the
only new table in schema v8 and it touches no existing table.

```sql
CREATE TABLE IF NOT EXISTS session_annotations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  tags_json  TEXT NOT NULL DEFAULT '[]',
  note       TEXT,
  updated_at TEXT NOT NULL
);
```

- `session_id` — session primary key; the FK cascade removes the annotation row
  when the session is deleted.
- `tags_json` — normalised tag array as JSON (`[]` when empty). Normalisation
  (trim, lowercase, de-duplicate, sort ascending) and the four bounds
  (`ANNOTATION_MAX_TAGS = 32`, `ANNOTATION_TAG_MAX_CHARS = 64`,
  `ANNOTATION_TAG_PATTERN`, `ANNOTATION_NOTE_MAX_CHARS = 8192`) are defined in
  `contracts/data-model.md` §3.2.
- `updated_at` — ISO 8601 UTC string, written on every create/update.
- Reads and writes use module-level cached prepared statements and explicit
  column lists, never `SELECT *`; the read plan is a primary-key lookup.

### 3.11 Team table family (add-agent-team-observability, v10)

All team tables use a deterministic canonical `TEXT` primary key (design D4).
Timestamps are ISO 8601 UTC strings. Boolean flags are `INTEGER 0/1`. Arrays are
stored as JSON `TEXT` (`'[]'` when empty). Every team-owned table cascades from
`team_runs`; the slim graph/ledger tables carry **no body column** — bodies live
only in `team_activity_bodies` (§3.11.12). Column names are snake_case; the
camelCase mapping lives in the storage layer and never leaks to the API
(`contracts/data-model.md` §0).

```sql
-- 3.11.1 team_runs — identity, lifecycle, topology, counts, fingerprints, stamp
CREATE TABLE IF NOT EXISTS team_runs (
  id                      TEXT    PRIMARY KEY,
  provider                TEXT    NOT NULL,
  native_run_id           TEXT    NOT NULL,
  run_identity_confidence TEXT    NOT NULL DEFAULT 'native',
  title                   TEXT    NOT NULL DEFAULT '',
  goal_fingerprint        TEXT,
  status                  TEXT    NOT NULL DEFAULT 'unknown',
  started_at              TEXT,
  ended_at                TEXT,
  topology_kind           TEXT    NOT NULL DEFAULT 'unknown',
  agent_count             INTEGER NOT NULL DEFAULT 0,
  task_count              INTEGER NOT NULL DEFAULT 0,
  communication_count     INTEGER NOT NULL DEFAULT 0,
  activity_count          INTEGER NOT NULL DEFAULT 0,
  round_count             INTEGER NOT NULL DEFAULT 0,
  artifact_count          INTEGER NOT NULL DEFAULT 0,
  token_available         INTEGER NOT NULL DEFAULT 0,
  cost_available          INTEGER NOT NULL DEFAULT 0,
  cost_currency           TEXT,
  completeness_json       TEXT    NOT NULL DEFAULT '{}',
  updated_at              TEXT    NOT NULL,
  stamp                   TEXT    NOT NULL
) WITHOUT ROWID;

-- 3.11.2 team_agents — participant identity, role/model/state/lifetime
CREATE TABLE IF NOT EXISTS team_agents (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  native_id         TEXT    NOT NULL,
  display_name      TEXT    NOT NULL DEFAULT '',
  role              TEXT    NOT NULL DEFAULT '',
  role_class        TEXT    NOT NULL DEFAULT 'unknown',
  model             TEXT,
  state             TEXT    NOT NULL DEFAULT 'unknown',
  created_at        TEXT,
  ended_at          TEXT,
  session_keys_json TEXT    NOT NULL DEFAULT '[]',
  evidence_ids_json TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.3 team_agent_edges — versioned structural/overlay relationships
CREATE TABLE IF NOT EXISTS team_agent_edges (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  from_agent_id     TEXT    NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  to_agent_id       TEXT    NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  kind              TEXT    NOT NULL,
  valid_from        TEXT,
  valid_to          TEXT,
  confidence        TEXT    NOT NULL DEFAULT 'native',
  evidence_ids_json TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.4 team_tasks — slim task identity/state/times/body flags (no descriptions/results)
CREATE TABLE IF NOT EXISTS team_tasks (
  id                    TEXT    PRIMARY KEY,
  run_id                TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  native_id             TEXT    NOT NULL,
  title                 TEXT    NOT NULL DEFAULT '',
  description_available INTEGER NOT NULL DEFAULT 0,
  priority              INTEGER,
  status                TEXT    NOT NULL DEFAULT 'unknown',
  created_at            TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  cancelled_at          TEXT,
  failed_at             TEXT,
  result_available      INTEGER NOT NULL DEFAULT 0,
  evidence_ids_json     TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.5 team_task_dependencies — versioned DAG edges
CREATE TABLE IF NOT EXISTS team_task_dependencies (
  id                 TEXT    PRIMARY KEY,
  run_id             TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  upstream_task_id   TEXT    NOT NULL REFERENCES team_tasks(id) ON DELETE CASCADE,
  downstream_task_id TEXT    NOT NULL REFERENCES team_tasks(id) ON DELETE CASCADE,
  valid_from         TEXT,
  valid_to           TEXT,
  confidence         TEXT    NOT NULL DEFAULT 'native',
  evidence_ids_json  TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.6 team_assignments — versioned task ownership
CREATE TABLE IF NOT EXISTS team_assignments (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  task_id           TEXT    NOT NULL REFERENCES team_tasks(id) ON DELETE CASCADE,
  agent_id          TEXT    NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  assigned_at       TEXT,
  unassigned_at     TEXT,
  assignment_kind   TEXT    NOT NULL DEFAULT 'assigned',
  evidence_ids_json TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.7 team_messages — slim logical communication metadata (no message body)
CREATE TABLE IF NOT EXISTS team_messages (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  sender_agent_id   TEXT    NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  recipient_ids_json TEXT   NOT NULL DEFAULT '[]',
  mode              TEXT    NOT NULL DEFAULT 'unknown',
  category          TEXT    NOT NULL DEFAULT 'unknown',
  task_id           TEXT,
  correlation_id    TEXT,
  reply_to_id       TEXT,
  sent_at           TEXT,
  received_at       TEXT,
  body_available    INTEGER NOT NULL DEFAULT 0,
  body_chars        INTEGER,
  body_bytes        INTEGER,
  content_hash      TEXT,
  evidence_ids_json TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.8 team_message_recipients — normalized recipient junction (design D11)
CREATE TABLE IF NOT EXISTS team_message_recipients (
  message_id TEXT NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, agent_id)
) WITHOUT ROWID;

-- 3.11.9 team_activities — ordered slim execution ledger (no tool/raw/artifact body)
CREATE TABLE IF NOT EXISTS team_activities (
  id                TEXT    PRIMARY KEY,
  run_id            TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  agent_id          TEXT,
  task_id           TEXT,
  round_id          TEXT,
  kind              TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'unknown',
  started_at        TEXT,
  ended_at          TEXT,
  native_sequence   INTEGER,
  session_key       TEXT,
  event_id          TEXT,
  turn_key          TEXT,
  message_id        TEXT,
  artifact_id       TEXT,
  tokens_json       TEXT,
  cost_usd          REAL,
  cost_source       TEXT,
  cost_currency     TEXT,
  has_input         INTEGER NOT NULL DEFAULT 0,
  has_output        INTEGER NOT NULL DEFAULT 0,
  has_raw           INTEGER NOT NULL DEFAULT 0,
  evidence_ids_json TEXT    NOT NULL DEFAULT '[]',
  order_confidence  TEXT    NOT NULL DEFAULT 'native'
) WITHOUT ROWID;

-- 3.11.10 team_rounds — per-agent round boundaries and aggregates (no bodies)
CREATE TABLE IF NOT EXISTS team_rounds (
  id                      TEXT    PRIMARY KEY,
  run_id                  TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  agent_id                TEXT    NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  native_id               TEXT,
  idx                     INTEGER NOT NULL DEFAULT 0,
  segmentation_source     TEXT    NOT NULL DEFAULT 'unavailable',
  started_at              TEXT,
  ended_at                TEXT,
  status                  TEXT    NOT NULL DEFAULT 'unknown',
  task_ids_json           TEXT    NOT NULL DEFAULT '[]',
  output_artifact_ids_json TEXT   NOT NULL DEFAULT '[]',
  wall_clock_ms           INTEGER,
  active_ms               INTEGER,
  tokens_json             TEXT,
  cost_usd                REAL,
  tool_call_count         INTEGER NOT NULL DEFAULT 0,
  message_count           INTEGER NOT NULL DEFAULT 0,
  completeness            TEXT    NOT NULL DEFAULT 'unavailable'
) WITHOUT ROWID;

-- 3.11.11 team_artifacts — metadata, redacted path, hash, acceptance (no content)
CREATE TABLE IF NOT EXISTS team_artifacts (
  id                      TEXT    PRIMARY KEY,
  run_id                  TEXT    NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  native_id               TEXT,
  name                    TEXT    NOT NULL DEFAULT '',
  kind                    TEXT    NOT NULL DEFAULT 'file',
  path_redacted           TEXT,
  content_hash            TEXT,
  producer_agent_ids_json TEXT    NOT NULL DEFAULT '[]',
  task_ids_json           TEXT    NOT NULL DEFAULT '[]',
  created_at              TEXT,
  accepted_at             TEXT,
  has_content             INTEGER NOT NULL DEFAULT 0,
  evidence_ids_json       TEXT    NOT NULL DEFAULT '[]'
) WITHOUT ROWID;

-- 3.11.12 team_evidence — locators, native ids/sequences, confidence, parser version (no source body)
CREATE TABLE IF NOT EXISTS team_evidence (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  source_kind     TEXT NOT NULL,
  source_locator  TEXT NOT NULL,
  native_id       TEXT,
  native_sequence INTEGER,
  captured_at     TEXT NOT NULL,
  confidence      TEXT NOT NULL DEFAULT 'native',
  parser_version  TEXT NOT NULL
) WITHOUT ROWID;

-- 3.11.13 team_activity_bodies — optional desensitized bodies (detail-only)
CREATE TABLE IF NOT EXISTS team_activity_bodies (
  activity_id  TEXT PRIMARY KEY REFERENCES team_activities(id) ON DELETE CASCADE,
  input_body   TEXT,
  output_body  TEXT,
  message_body TEXT,
  result_body  TEXT,
  raw_body     TEXT
) WITHOUT ROWID;

-- 3.11.14 team_metrics — versioned per-run aggregate JSON (no bodies)
CREATE TABLE IF NOT EXISTS team_metrics (
  run_id       TEXT PRIMARY KEY REFERENCES team_runs(id) ON DELETE CASCADE,
  calc_version INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT    NOT NULL,
  metrics_json TEXT    NOT NULL DEFAULT '{}'
) WITHOUT ROWID;
```

> **Body policy (design D11 / D18)**: the only body-bearing table is
> `team_activity_bodies`; message/tool/raw/artifact content is reachable there
> via its owning activity (`message_body` for `message_sent`/`message_received`,
> `input_body`/`output_body` for `tool_call`/`tool_result`, `result_body` for
> `verification`/`artifact`/`integration`, `raw_body` for raw references). The
> slim tables above must never be joined to it by list/graph/ledger queries.
>
> **Cross-reference note**: `team_activities.agent_id` / `task_id` / `round_id` /
> `message_id` / `artifact_id` are deliberately **not** foreign keys — they may
> be null for run-level activities and must survive as dangling history when a
> referenced entity is replaced (design D6, storage REQ-021). Structural
> relations (`team_agent_edges`, `team_task_dependencies`, `team_assignments`,
> `team_message_recipients`) do cascade from their parent entities.
>
> `team_metrics.metrics_json` stores the serialized `TeamMetrics` shape
> (`contracts/data-model.md` §12.4) — numeric values + availability only, never
> bodies. `team_runs.completeness_json` stores the nine-dimension
> `TeamCompleteness` map.

### 3.12 `team_run_sessions` junction (add-agent-team-observability, v10)

Many-to-many membership between team runs and session trajectories. Session
deletion clears the junction link (and the team activity's `session_key` becomes
a dangling "no trajectory" reference) but does **not** delete the team run;
team deletion deletes team-owned rows but never the sessions (design D11).

```sql
CREATE TABLE IF NOT EXISTS team_run_sessions (
  run_id     TEXT NOT NULL REFERENCES team_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, session_id)
) WITHOUT ROWID;
```

## 4. Indexes (full set)

```sql
-- events: the only hot path is WHERE session_id = ? ORDER BY sequence
CREATE INDEX IF NOT EXISTS idx_events_session_seq    ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_session_phase  ON events(session_id, phase);
CREATE INDEX IF NOT EXISTS idx_events_kind           ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_phase          ON events(phase);
-- v2 (add-mission-control)：Mission A1/B4/B15 按 tool 聚合
CREATE INDEX IF NOT EXISTS idx_events_tool           ON events(tool);
-- v2：Mission 按 (session, kind) 过滤；不是 idx_events_session_seq 的前缀
CREATE INDEX IF NOT EXISTS idx_events_session_kind   ON events(session_id, kind);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_ds_started   ON sessions(data_source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at   ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_provider     ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_source_agent ON sessions(source_agent);
-- v2：Mission 按 provider 过滤 + started_at 排序的复合索引
CREATE INDEX IF NOT EXISTS idx_sessions_started_prov ON sessions(started_at DESC, provider);

-- scan_state
CREATE INDEX IF NOT EXISTS idx_scan_state_provider   ON scan_state(provider);
CREATE INDEX IF NOT EXISTS idx_scan_state_session    ON scan_state(session_id);

-- proxy_requests
CREATE INDEX IF NOT EXISTS idx_proxy_started_len     ON proxy_requests(started_at, system_prompt_len DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_hostname        ON proxy_requests(hostname);
CREATE INDEX IF NOT EXISTS idx_proxy_started_utc ON proxy_requests(julianday(started_at), id);
CREATE INDEX IF NOT EXISTS idx_proxy_parsed_session  ON proxy_requests(parsed_session_id);
-- v6 (add-request-context-diff, design D4): nearest-earlier predecessor lookup
CREATE INDEX IF NOT EXISTS idx_proxy_session_format_id ON proxy_requests(parsed_session_id, request_format, id DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_group_format_model_id ON proxy_requests(capture_group_id, request_format, model, id DESC);

-- frida_captures
CREATE INDEX IF NOT EXISTS idx_frida_captured_at     ON frida_captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_frida_session         ON frida_captures(session_id);
CREATE INDEX IF NOT EXISTS idx_frida_capture_session ON frida_captures(capture_session_id);

-- session_annotations (v8, add-trajectory-inspector D14/D15)
CREATE INDEX IF NOT EXISTS idx_session_annotations_updated
  ON session_annotations(updated_at);

-- team_activities (v10): ledger ordering + agent/task filters (design D11)
CREATE INDEX IF NOT EXISTS idx_team_activities_run_time
  ON team_activities(run_id, started_at, native_sequence, id);
CREATE INDEX IF NOT EXISTS idx_team_activities_run_agent
  ON team_activities(run_id, agent_id, started_at, id);
CREATE INDEX IF NOT EXISTS idx_team_activities_run_task
  ON team_activities(run_id, task_id, started_at, id);

-- team_messages (v10): communication view by sender + normalized recipient junction
CREATE INDEX IF NOT EXISTS idx_team_messages_run_sender
  ON team_messages(run_id, sender_agent_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_team_message_recipients_agent
  ON team_message_recipients(agent_id, message_id);

-- team_tasks (v10): run + status + started-at (design D11)
CREATE INDEX IF NOT EXISTS idx_team_tasks_run_status
  ON team_tasks(run_id, status, started_at);

-- team_agent_edges (v10): relationship membership (design D11)
CREATE INDEX IF NOT EXISTS idx_team_edges_run_from_to
  ON team_agent_edges(run_id, from_agent_id, to_agent_id, kind);

-- team_artifacts / team_evidence (v10): recent ordering per run (design D11
-- "updated_at DESC" intent; the contract columns are created_at / captured_at)
CREATE INDEX IF NOT EXISTS idx_team_artifacts_run_created
  ON team_artifacts(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_evidence_run
  ON team_evidence(run_id, source_kind);

-- team_runs (v10): list filters
CREATE INDEX IF NOT EXISTS idx_team_runs_provider_started
  ON team_runs(provider, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_runs_status_started
  ON team_runs(status, started_at DESC);

-- team_rounds / team_assignments / team_task_dependencies (v10)
CREATE INDEX IF NOT EXISTS idx_team_rounds_run_agent
  ON team_rounds(run_id, agent_id, idx);
CREATE INDEX IF NOT EXISTS idx_team_assignments_run_task
  ON team_assignments(run_id, task_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_team_assignments_run_agent
  ON team_assignments(run_id, agent_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_team_deps_run_up
  ON team_task_dependencies(run_id, upstream_task_id);

-- team_run_sessions (v10): session→run membership
CREATE INDEX IF NOT EXISTS idx_team_run_sessions_session
  ON team_run_sessions(session_id, run_id);
```

> `idx_session_annotations_updated` supports the tag-vocabulary ordering and
> any updated-at sorting on the annotations table. Tag matching on the session
> list uses a JSON-array containment predicate on the joined row — verify with
> `EXPLAIN QUERY PLAN` that the session list's existing ordering plan gains no
> temporary B-tree (storage window tasks §2.10, §2.11).

> **Do not create single-column `idx_events_session_id` or
> `idx_sessions_data_source`.** They are prefixes of the two composite indexes
> above and SQLite uses them automatically; standalone versions only add write
> cost. The reference built only the single-column versions, forcing a temp
> B-tree sort every time.

## 5. Query rules

### 5.1 Mandatory rules

1. **No `SELECT *`** — always list return columns explicitly
2. All statements reuse module-level cached `db.prepare()`, **no prepare inside
   loops**
3. Bulk writes must be wrapped in `db.transaction()`
4. Timestamps are always ISO strings for comparison (lexicographic order
   equals time order)

### 5.2 Column constants

Frida's additive bounded reader follows the existing §3.8 fields, with no DDL
change. Constants owned by server/storage/frida-captures.ts:

~~~ts
export const FRIDA_METADATA_COLS = 'id, pid, captured_at, capture_type, model, session_id, capture_session_id, message_count';
export const FRIDA_DETAIL_COLS = `${FRIDA_METADATA_COLS}, json_data, tokens_json`;
~~~

List projection selects substr(json_data,1,500), never a full json_data value,
and NULL tokens_json; selected detail enforces frida-capture-flow.md byte bounds
before fetching full retained fields. Prepared statements remain cached and
preview/read failure never mutates retained captures.

```ts
export const SESSION_LIST_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'event_count', 'message_count', 'token_total', 'cost_usd',
  'data_source', 'source_path', 'detail_loaded',
  "CASE WHEN system_prompt IS NOT NULL AND system_prompt != '' THEN 1 ELSE 0 END AS has_system_prompt",
].join(', ');

export const EVENT_SLIM_COLS = [
  'session_id', 'id', 'sequence', 'kind', 'phase', 'title', 'started_at',
  'duration_ms', 'status', 'actor', 'tool', 'tokens_json', 'error', 'model',
  'turn_key',
  "CASE WHEN input_summary  IS NOT NULL AND input_summary  != '' THEN 1 ELSE 0 END AS has_input",
  "CASE WHEN output_summary IS NOT NULL AND output_summary != '' THEN 1 ELSE 0 END AS has_output",
].join(', ');

export const EVENT_FULL_COLS = `${EVENT_SLIM_COLS}, input_summary, output_summary`;

export const SESSION_DETAIL_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'message_count', 'event_count', 'token_input',
  'token_output', 'token_reasoning', 'token_cache_read', 'token_cache_write',
  'token_total', 'cost_usd', 'system_prompt', 'source_path', 'data_source',
  'total_duration_ms', 'is_subagent', 'detail_loaded', 'primary_model',
  'cost_source', 'duration_source',
].join(', ');

export const PROXY_LIST_COLS = [
  'id', 'request_id', 'method', 'url', 'hostname', 'response_status',
  'content_type', 'is_streaming', 'started_at', 'completed_at', 'duration_ms',
  'capture_method', 'ttnet_encrypted', 'model', 'input_tokens', 'output_tokens',
  'parsed_session_id', 'parser_route', 'capture_group_id', 'request_format',
  'CASE WHEN system_prompt_len > 0 THEN 1 ELSE 0 END AS has_system_prompt',
].join(', ');

// ── v10 (add-agent-team-observability) team 列常量，禁止 SELECT * ──────────

export const TEAM_RUN_LIST_COLS = [
  'id', 'provider', 'native_run_id', 'run_identity_confidence', 'title',
  'goal_fingerprint', 'status', 'started_at', 'ended_at', 'topology_kind',
  'agent_count', 'task_count', 'communication_count', 'activity_count',
  'round_count', 'artifact_count', 'token_available', 'cost_available',
  'cost_currency', 'completeness_json', 'updated_at', 'stamp',
].join(', ');

export const TEAM_AGENT_COLS = [
  'id', 'run_id', 'native_id', 'display_name', 'role', 'role_class', 'model',
  'state', 'created_at', 'ended_at', 'session_keys_json', 'evidence_ids_json',
].join(', ');

export const TEAM_EDGE_COLS = [
  'id', 'run_id', 'from_agent_id', 'to_agent_id', 'kind', 'valid_from',
  'valid_to', 'confidence', 'evidence_ids_json',
].join(', ');

export const TEAM_TASK_COLS = [
  'id', 'run_id', 'native_id', 'title', 'description_available', 'priority',
  'status', 'created_at', 'started_at', 'completed_at', 'cancelled_at',
  'failed_at', 'result_available', 'evidence_ids_json',
].join(', ');

export const TEAM_DEP_COLS = [
  'id', 'run_id', 'upstream_task_id', 'downstream_task_id', 'valid_from',
  'valid_to', 'confidence', 'evidence_ids_json',
].join(', ');

export const TEAM_ASSIGNMENT_COLS = [
  'id', 'run_id', 'task_id', 'agent_id', 'assigned_at', 'unassigned_at',
  'assignment_kind', 'evidence_ids_json',
].join(', ');

export const TEAM_MESSAGE_COLS = [
  'id', 'run_id', 'sender_agent_id', 'recipient_ids_json', 'mode', 'category',
  'task_id', 'correlation_id', 'reply_to_id', 'sent_at', 'received_at',
  'body_available', 'body_chars', 'body_bytes', 'content_hash',
  'evidence_ids_json',
].join(', ');

export const TEAM_ACTIVITY_SLIM_COLS = [
  'id', 'run_id', 'agent_id', 'task_id', 'round_id', 'kind', 'status',
  'started_at', 'ended_at', 'native_sequence', 'session_key', 'event_id',
  'turn_key', 'message_id', 'artifact_id', 'tokens_json', 'cost_usd',
  'cost_source', 'cost_currency', 'has_input', 'has_output', 'has_raw',
  'evidence_ids_json', 'order_confidence',
].join(', ');

export const TEAM_ROUND_COLS = [
  'id', 'run_id', 'agent_id', 'native_id', 'idx', 'segmentation_source',
  'started_at', 'ended_at', 'status', 'task_ids_json',
  'output_artifact_ids_json', 'wall_clock_ms', 'active_ms', 'tokens_json',
  'cost_usd', 'tool_call_count', 'message_count', 'completeness',
].join(', ');

export const TEAM_ARTIFACT_COLS = [
  'id', 'run_id', 'native_id', 'name', 'kind', 'path_redacted', 'content_hash',
  'producer_agent_ids_json', 'task_ids_json', 'created_at', 'accepted_at',
  'has_content', 'evidence_ids_json',
].join(', ');

export const TEAM_EVIDENCE_COLS = [
  'id', 'run_id', 'source_kind', 'source_locator', 'native_id',
  'native_sequence', 'captured_at', 'confidence', 'parser_version',
].join(', ');

export const TEAM_METRICS_COLS = [
  'run_id', 'calc_version', 'generated_at', 'metrics_json',
].join(', ');

export const TEAM_RUN_SESSION_COLS = ['run_id', 'session_id'].join(', ');
```

The full proxy row column list (used by the request-detail and context-diff
paths) also carries `capture_group_id` and `request_format` in addition to the
existing columns. No list body/header/system-prompt exclusion changes.

> `has_raw` would require joining `event_raw`; cost exceeds benefit. The slim
> tier uniformly sets `hasRaw = true`; the drill-down endpoint returns null
> when the raw does not actually exist.

### 5.3 Expected plans for the three core queries

`EXPLAIN QUERY PLAN` output **must not contain** `USE TEMP B-TREE`:

| Query | Expected plan | Budget |
|-------|---------------|--------|
| `SELECT {SESSION_LIST_COLS} FROM sessions WHERE data_source=? ORDER BY started_at DESC LIMIT ?` | `SEARCH sessions USING INDEX idx_sessions_ds_started` | < 1ms |
| `SELECT {EVENT_SLIM_COLS} FROM events WHERE session_id=? ORDER BY sequence LIMIT ? OFFSET ?` | `SEARCH events USING INDEX idx_events_session_seq` | < 15ms @ 9,590 rows |
| `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1` | `SEARCH proxy_requests USING INDEX idx_proxy_started_len` | < 1ms |
| `SELECT {predecessor cols} FROM proxy_requests WHERE parsed_session_id IS NOT NULL AND parsed_session_id = ? AND request_format = ? AND id < ? ORDER BY id DESC LIMIT 1` (exact-session predecessor, design D4) | `SEARCH proxy_requests USING INDEX idx_proxy_session_format_id` | < 1ms @ tier B |
| `SELECT {predecessor cols} FROM proxy_requests WHERE capture_group_id = ? AND request_format = ? AND model IS ? AND id < ? ORDER BY id DESC LIMIT 1` (capture-group predecessor, design D4, null-safe model equality) | `SEARCH proxy_requests USING INDEX idx_proxy_group_format_model_id` | < 1ms @ tier B |

Both predecessor queries list columns explicitly, never `SELECT *`, and the
plans must not contain `USE TEMP B-TREE`.

## 6. Data retention

CLI default retention is0 (disabled); the legacy helper's omitted argument
remains30 for compatibility. A nonzero explicit policy computes one canonical
ISO8601 UTC cutoff before its transaction. Insert exact identity tombstones for
expiring rows with both original refs, then delete rows strictly older than
this invocation's cutoff in that SAME transaction:

```sql
DELETE FROM proxy_requests
 WHERE julianday(started_at) < julianday(:cutoff);
```

Use actual UTC instants, including equivalent offset spellings and same-day
boundary times, not ISO-T vs SQLite-space lexical comparisons. Unknown/invalid
stored timestamps are not guessed into expiry. Days must be a nonnegative
safe integer and the computed cutoff SQLite-representable; invalid input fails
without mutation. A failed delete rolls back its markers too. Disabled0 does
not write/reset markers; later longer/disabled policy cannot revive these exact
deleted observations. Other old-clock/uncommitted observations remain distinct.

During same-DB journal recovery, validate owner/entry first, then suppress only
entries with an exact request+both-original tombstone before body IO/insert.
Remove only their internal journal metadata, never original .part/.body files
or opposite scan/team data. Files remain quota-charged; missing/modified body
files cannot block an exactly deleted journal. Foreign journals are untouched.
Uncommitted old journals are not labelled previously deleted by their timestamp.
Recovery receives the current explicit metadata retention days (default0), with
one validated canonical cutoff for the invocation. Before original IO/insertion,
an uncommitted same-owner entry strictly older than this cutoff may expire NOW:
insert its exact request+both-original marker only if no proxy request with that
request_id exists. One cached INSERT SELECT/NOT EXISTS statement is atomic;
request-id collisions remain conflicts, not permission to delete another record.
Use existing bounded nonblocking SQLite retries and yield per entry. Only after
marker success remove internal journal metadata. Failure retains the journal;
originals remain unchanged/quota-charged, no saved notification or upstream call.
Default0 does not mark expired entries; equal cutoff timestamps remain retained.
This admission gate avoids materializing old graphs then bulk deleting them on
the HTTP thread. Startup retention of already committed rows stays separate;
full capacity/manual deletion and sustained WAL admission remain7.3 work.
When more than1000 rows are deleted, trigger one checkpointWal as before.
