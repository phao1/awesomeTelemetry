# Contract: Database

> **Authoritative source.** This is a fresh build; the schema starts at **v1**
> and is currently at **v8** (add-trajectory-inspector: the additive
> `session_annotations` table plus its index; preceding versions:
> fix-adapter-turn-semantics `events.turn_key` plus the destructive v6→v7
> reclassification rescan migration, add-request-context-diff proxy
> capture-group correlation + request-format classification,
> add-mission-control model attribution + cost / duration sources +
> ttft/e2e persistence + scan-time repair rollup,
> calibrate-tokens-and-compare-report TraceMetrics five new fields,
> show-trae-prompt-context `session_prompt_context`). All DDL must be adopted
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
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* next round */ }
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
  duration_source   TEXT    NOT NULL DEFAULT 'unknown'
) WITHOUT ROWID;
```

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

Unbounded growth of `proxy_requests` is a long-term risk. On startup, run once:

```sql
DELETE FROM proxy_requests
 WHERE started_at < datetime('now', '-' || :retentionDays || ' days');
```

Default `retentionDays = 30`, CLI flag `--proxy-retention-days`; `0` disables
cleanup. When more than 1000 rows are deleted, trigger one `checkpointWal()`.
