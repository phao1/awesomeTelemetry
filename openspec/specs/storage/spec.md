# Spec: Storage

> SQLite storage layer: schema, writers, queries. Schema version **v1** (fresh
> build, no historical migration).
> **The authoritative source for DDL / indexes / PRAGMAs is
> `contracts/database.md`; this file only defines behavior requirements.**
> Source files: `server/storage/`

## Purpose

Persist scan sessions, proxy requests, Frida captures, and metrics. WAL mode,
single-process writes.

## Requirements

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

### REQ-003: Idempotent DB creation
`initSchema(db)` SHALL execute all `contracts/database.md` §3 table creations,
§4 index creations, write `_meta.schema_version = SCHEMA_VERSION` (constant 1),
and run `ANALYZE`. The whole flow MUST be idempotent; repeated calls have no
side effects.

This is a fresh build, **no historical migration**. The `migrations/` dir is
reserved but currently empty.

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

### REQ-015: Proxy queries
`listProxyRequests(opts)` MUST exclude
`request_body` / `response_body` / `raw_request_body` / `raw_response_body` /
`system_prompt` (five columns) and return `ProxyRequestListItem[]`.

### REQ-016: Session deletion
`deleteSession(key)` MUST cascade-delete `events` + `event_raw` + `metrics` +
`sessions` + the session's matching `scan_state` row.

### REQ-017: Data retention
On startup SHALL purge expired `proxy_requests` per `--proxy-retention-days`
(default 30, 0 disables). When more than 1000 rows are deleted, trigger one
`checkpointWal()`.

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
