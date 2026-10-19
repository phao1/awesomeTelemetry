# Spec: Storage

> SQLite storage layer: schema, writers, queries. Current schema version is
> defined in contracts/database.md (v18 adds a bounded reparse summary).
> Fresh product build; no historical user-dataset migration is in scope.
> **The authoritative source for DDL / indexes / PRAGMAs is
> `contracts/database.md`; this file only defines behavior requirements.**
> Source files: `server/storage/`

## Purpose

Persist scan sessions, proxy requests, Frida captures, and metrics. WAL mode,
single-process writes.

## Requirements

### REQ-023: Same-capture versioned offline reparse summary
Explicit reparse SHALL update one bounded metadata-only summary per existing
capture with parser/usage-metric versions and source fingerprint. Current/stale/
unavailable are metadata states,not fresh original-file checks. Repeated actions
MUST NOT insert a new capture/charge or overwrite original/native/scan data.
Confirmed body deletion clears the summary in its intent transaction; no legacy
body fallback or startup reparse. Types/DDL/bounds follow contracts schema18.

### REQ-022: Native parent-reference projection
Read retained parent_session references and exact same-namespace native session
owners through existing source/session indexes, without source IO, global parent
scan, schema mutation or inferred topology. Complete unique non-self evidence
may resolve a declared parent/fork reference only; missing/ambiguous/incomplete
and truncated matches remain distinct. Paged bounded shape follows contracts.

### REQ-020: Linked execution metadata read model
Return the retained session duration declaration (unknown fallback) and one
batched projection of existing transport metadata, null for legacy absence.
This does not prove any native event's measured duration; do not load event raw
or source files just to populate the list. Preserve bounded pages and no N+1.

An explicit execution page SHALL combine fixed-size native slim event pages and
accepted direct/confirmed capture memberships, preserving both original sources.
Exact scoped native identities may link a retained event only when all relevant
source manifests are complete and unambiguous, including off-page collisions.
Session-only/absent evidence SHALL remain unbound. No generated causal/retry/
billing IDs or server TraceTurn derivation; no raw/summary/body columns, N+1,
source-file IO or automatic association writes. Bounds/shapes follow contracts.

### REQ-021: Local capture evidence snapshot export
An explicit capture export SHALL include bounded versioned analysis plus
metadata/headers/body references and paged identity/link evidence without
redaction or upstream execution. Full original files remain separately
downloadable; missing/truncated/deleted evidence is explicit. Recheck fresh
deletion intent after async analysis and never export cached body projections
after intent. No filesystem paths/journal/private CA data in the package.

### REQ-018: Evidence-backed capture association
Persist identity sources/entries, session-proxy associations and append-only user decisions per contracts. Differential/idempotent ingest MUST NOT rewrite original scan/proxy rows, charge a new call, or overwrite a confirmed/rejected/revoked user decision. Late conflicting session identities MUST downgrade previous automatic direct links to candidates. List APIs SHALL use indexed metadata pages and bulk evidence reads, with no raw/body/summary columns and no per-row query.

v17 native lookup index SHALL cover session/scope NULL only, matching current
automatic association lookups. Keep all other identity values/scopes/locators
and source-page index intact. Native keys SHALL drive exact index searches
after ANALYZE, never a scan of the whole retained identity index, even in tiny
databases. Atomic index+version migration rolls back on
failure; repeated current initialization never rebuilds it. Large admitted
captures must not exceed fixed WAL/DB/loop budgets through index amplification.

### REQ-001: Connection initialization
`openWritable()` MUST set all 8 PRAGMAs in the order of `contracts/database.md`
§1 and create the parent dir. `openReadonly()` MUST use
`{ readonly: true, fileMustExist: true }`.

#### Scenario: uncontrolled WAL growth
- **GIVEN** `wal_autocheckpoint` is not set
- **WHEN** the system runs for days
- **THEN** the WAL file grows to 151.82MB (measured in v4)
- **THEREFORE** MUST explicitly set `wal_autocheckpoint = 2000` and call
  `checkpointWal()` once after every scan round

### REQ-002: checkpoint must not block
`checkpointWal()` MUST use `wal_checkpoint(TRUNCATE)`; on busy, MUST silently
skip and wait for the next round. MUST NOT retry or block-wait.

Temporarily disable the synchronous busy handler only for this checkpoint and
restore its exact configured value in finally. Capture-only DB/WAL admission
uses shared bounded per-DB serialization and actual async file sizes per the
database contract; pressure blocks new journal/capture commits, not forwarding
or deletion of prior evidence. Recovery preserves refused journals/originals.
The independent read-only capacity diagnostic MUST remain reachable under
pressure and MUST NOT itself checkpoint/recover. No scan cleanup or global DB
page cap is introduced. This is not full long-term shared-writer certification.

Capacity admission SHALL reject SQLite writes that invalidate an async file-size
snapshot, using same-connection total_changes/schema_version and observed other-connection
data_version. Recheck at most3 snapshots total, including after at most1
checkpoint; continued churn fails explicitly without calling the mutation.
Reject caller-owned transactions before/during IO without rolling them back,
never hold a transaction across async stat, and restore the exact busy timeout
after zero-wait stamp reads. Native rows/raw/metrics/identities remain intact.
This fixes stale admission, not future external writes or unlimited native
growth; the NFR §7 separate-store escalation remains required.

### REQ-003: Idempotent DB creation
`initSchema(db)` SHALL execute all `contracts/database.md` §3 table creations,
§4 index creations, write `_meta.schema_version = SCHEMA_VERSION` from the current contract,
and run `ANALYZE`. The whole flow MUST be idempotent; repeated calls have no
side effects.

Existing development-cache compatibility steps are defined by the higher
priority database contract; this requirement does not override them with the
stale v1/empty-migrations description. The v12→v13 processing table is additive,
with no startup reparse, deletion or scanner-state reset. A missing legacy
processing outcome is unknown, not success. Current MITM writes its outcome
atomically with request/body/identity metadata; body completeness is separate.
The v13→v14 transport table is likewise additive with independent bounded
CaptureTransportResult, fixed-count detail queries and FK cascade. No legacy
backfill, original rewrite or scanner reset; absent outcomes remain unknown.

#### Scenario: DB version newer than code
- **GIVEN** the read `schema_version` is greater than the code constant
- **THEN** MUST abort startup with "Database was created by a newer version"
- **AND** MUST NOT attempt to downgrade or rewrite

### REQ-004: Explicit column queries
All queries MUST list return columns explicitly. MUST NOT use `SELECT *`.
Column constants defined in `contracts/database.md` §5.2.

### REQ-005: Prepared statement reuse
All statements MUST reuse module-level cached `db.prepare()`. MUST NOT prepare
inside loop bodies.

### REQ-006: Session queries
- `listSessions(opts)` — supports `dataSource` / `provider` / `keys` filters,
  keyset pagination (`cursor` = last item's `startedAt` of the previous page),
  `ORDER BY started_at DESC`. Returns `SessionIndexEntry[]`, **MUST NOT contain
  the `systemPrompt` body**; replaced by the `hasSystemPrompt` boolean.
- `getSessionDetail(key, opts)` — `opts.mode` defaults to `'slim'`, supports
  `offset` / `limit`.

#### Scenario: detail does not return body by default
- **GIVEN** `GET /api/sessions/:key` without mode
- **THEN** every returned event MUST NOT contain
  `inputSummary` / `outputSummary` / `raw`
- **AND** the worst-session (9,590 events) response body MUST be < 1.5MB

### REQ-007: Large-session pagination
When event count > 2000, `getSessionDetail` SHALL paginate, with the response
containing `eventTotal` / `eventOffset` / `eventLimit` / `hasMore`. Event
pagination uses offset, not cursor (`sequence` is continuous and stable, and
frontend virtual scroll needs random jumps).

### REQ-008: Single-event drill-down
`getEventDetail(sessionId, eventId, includeRaw)` SHALL return a single
`TraceEvent`; when `includeRaw` is true, fill `raw` from the `event_raw` table.

### REQ-009: Agent Overview server-side aggregation
`getAgentOverview(dataSource)` MUST aggregate server-side with two SQL queries
(session-level + event-level) and return `AgentOverviewRow[]`.

#### Scenario: no frontend N+1
- **GIVEN** the user switches to the Agent view
- **THEN** the frontend MUST issue exactly 1 request
- **AND** MUST NOT fetch per-session details

> Basis: v4's view produced 524 requests / 299.6MB / 4,732ms.

#### Scenario: aggregation result caching
- **GIVEN** `MAX(sessions.updated_at)` unchanged
- **WHEN** overview is requested again
- **THEN** return the cached result directly; response < 20ms, `cached: true`

### REQ-010: Session write upsert
`upsertSessionFromIndex()` / `upsertSessionFromTrace()` MUST use
`INSERT ... ON CONFLICT(id) DO UPDATE`.

#### Scenario: index-phase counts must not overwrite detail values (#9)
- **GIVEN** the Trae SQLCipher index phase cannot decrypt, so
  `event_count`/`message_count` report 0
- **WHEN** the detail scan writes 12 events, then the file mtime changes and
  triggers another index scan
- **THEN** `upsertSessionFromIndex` MUST use
  `CASE WHEN excluded.event_count > 0 THEN excluded.event_count ELSE sessions.event_count END`
  to preserve existing non-zero counts instead of overwriting with 0

### REQ-011: Differential event writes
`upsertEvents()` MUST use a differential strategy:
1. read the existing `(id, sequence)` set
2. `INSERT ... ON CONFLICT(session_id, id) DO UPDATE` per new row
3. delete stale ids absent from the new data (also deleting matching
   `event_raw` rows)
4. wrap everything in a single `db.transaction()`

MUST NOT use "DELETE all, then INSERT".

#### Scenario: appending one event
- **GIVEN** a session with 347 existing events and 1 new source row
- **WHEN** `upsertEvents` runs
- **THEN** only 1 INSERT is produced, < 20ms
- **AND** v4's behavior was 1 DELETE + 347 INSERT / 181.91ms; this is the
  regression guard

### REQ-012: Event id dedupe
Duplicate event ids within a session MUST get a `:{sequence}` suffix at the
adapter layer, unique before hitting the DB. `undefined` MUST become `null`.

### REQ-013: Metrics persistence
`upsertMetrics()` MUST write base metrics **and the four-dimension metrics**,
plus `calc_version`. `getMetrics()` MUST recompute and write back when
`calc_version` differs from the code constant `METRICS_CALC_VERSION`.

> v4's G5.3 "four-dimension metrics not persisted is a design choice" is
> **overturned** in v5. Reason: not persisting forces Agent Overview to
> recompute per session — the direct cause of 524 N+1 requests.

### REQ-014: System prompt association
`getSystemPromptForSession(startedAt, endedAt)` SHALL sort by the
`system_prompt_len` redundant column, MUST NOT use
`ORDER BY LENGTH(system_prompt)`.

This legacy time-window result is candidate evidence only, never an authoritative linked-session prompt. Linked Trace SHALL retain each request's own prompt and permit explicit request selection; never copy the longest nearby prompt into a scan session. Automatic context comparison requires unique direct/confirmed membership for both requests in the same existing scan session, ordered by observed UTC start instant and id tie-break. Same parsed_session_id/captureGroup/model alone is insufficient; candidate/rejected/revoked or multiply owned requests cannot authorize automatic pairing. A manual comparison does not mutate association state.

### REQ-015: Proxy queries
`listProxyRequests(opts)` MUST exclude
`request_body` / `response_body` / `raw_request_body` / `raw_response_body` /
`system_prompt` (five columns) and return `ProxyRequestListItem[]`.

### REQ-016: Session deletion
`deleteSession(key)` MUST cascade-delete `events` + `event_raw` + `metrics` +
`sessions` + the session's matching `scan_state` row.

### REQ-017: Data retention
Monitoring original body files SHALL have no implicit expiry or eviction. Default 10GB total quota and 100MiB per-direction cap are configurable. At quota exhaustion, stop new body collection and report status while preserving previous evidence. Legacy explicit proxy metadata retention remains independent and cannot silently delete original files. SQLite metadata/previews keep the existing NFR budget.

Explicit metadata retention SHALL atomically persist exact request+both-body
deletion markers. Recovery MUST NOT recreate those same-owner observations
when policy is later disabled/lengthened. Matching journal cleanup precedes
body IO and never deletes originals or scan/team rows. Other old timestamps
are not deletion identity. Use UTC instants, retain equal boundaries, do not
guess invalid dates and roll back markers on failure. Apply current explicit TTL
to uncommitted same-owner journal entries before body IO/insertion using a
bounded yielding exact-marker admission, not bulk HTTP deletion. A committed
request-id collision cannot be expired by another journal. Default0 preserves
uncommitted old evidence; failures retain journals and originals. Capacity and
manual deletion remain further7.3 gates.

The internal original-removal file operation SHALL be bounded to two validated
body IDs, reject active readers/writers/recovery and nonregular/traversal paths,
and stream-reconcile usedBytes even after partial failure. It is NOT a public
deletion workflow: a durable confirmed intent/restart coordinator must be wired
before exposing it, and default retention SHALL never invoke it. Surviving
originals, unrelated paths and scan/team data remain intact.

The internal durable original-file queue SHALL snapshot validated refs and store
directory and atomically persist the job with exact tombstone. Bound retained
jobs to1024, share one active run per DB owner, use indexed original-owner and
pending lookup, reject changed directory/identity/shared refs or changed original
digests, and persist complete only after IO. Failed state stays explicit and
requires retry; pending resumes idempotently after reopening. This core alone
alone is not full request erasure. Confirmed API admission SHALL clear proxy
body/prompt copies in the same transaction as intent/marker, reject new body/
analysis/diff access even if cleanup fails, retain metadata/headers/native data,
and resume pending cleanup before capture admission. Web confirmation/status and
local cache invalidation follow frontend REQ-020, not global Clear.

### REQ-019: Durable capture recovery
Before accepting original-file writes, persist bounded atomic same-DB journal
identity asynchronously. Retain observed headers/end/terminal/ref snapshots.
After process death, stream and verify original prefixes and commit one existing
request/body/processing/transport record atomically, without reparsing or replay.
Unknown clocks/usage remain null. Request-id equality alone cannot authorize
idempotence: both original IDs must agree. Retry only transient SQLite locks
with bounded nonblocking attempts; permanent failure keeps evidence and emits
no saved event. Restart capture queries/start share recovery, and shutdown
awaits it. No body deletion or scan reset; journal scratch cleanup is distinct.

## Gotchas
- G5.1: WAL mode makes file watching unreliable (see session-scanning)
- G5.2: db providers must poll, and fingerprints must cover the `-wal` file
- G4.8: event id dedupe must be kept
- G11.2 (new): `events.raw` must be a separate table; kept in the main table,
  detail queries cannot avoid 147MB
- G11.3 (new): `ORDER BY LENGTH(col)` cannot use an index; use a redundant
  length column
- G11.4 (new): v4's four queries all produced `USE TEMP B-TREE` because the
  indexes were single-column instead of composite. Confirm with
  `EXPLAIN QUERY PLAN` before adding indexes
