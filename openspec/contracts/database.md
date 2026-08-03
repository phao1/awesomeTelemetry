# Contract: 数据库

> **权威来源。** 本项目为全新构建，schema 从 **v1** 起，无历史迁移负担。
> 所有 DDL 逐字采用，不得改列名、不得增删列。
> 对应源文件：`server/storage/schema.ts`
>
> 文中标注「参考实现实测」的数字来自被复刻项目的性能诊断报告
> （524 会话 / 73,588 event / 源文件 800.21MB），是这些设计决策的依据。

## 0. 设计要点速览

| 决策 | 依据（参考实现实测） |
|------|-------------------|
| `raw` 独立成 `event_raw` 表，不放 `events` | 该列占参考实现 DB 总量 64.2%（147.82MB），留在主表会让任何详情查询都被迫加载 |
| `events` 用 `(session_id, id)` 复合主键，`WITHOUT ROWID` | 支撑差分 upsert，取代全删全插（参考实现改 1 个 event 要 348 条 SQL） |
| 索引一律用复合而非单列 | 参考实现 4 条热查询全部 `USE TEMP B-TREE`，最差 210.48ms |
| `metrics` 持久化四维指标 + `calc_version` | 不持久化会逼上游做 N+1（参考实现 Agent Overview 524 请求 / 299.6MB） |
| `proxy_requests` 带冗余列 `system_prompt_len` | 避免 `ORDER BY LENGTH(col)` 无法走索引 |
| `scan_state` 为必经路径，写入失败必须抛错 | 参考实现该表为 0 行，增量扫描完全失效且无声 |
| PRAGMA 组合固化在代码里 | 参考实现未设 `wal_autocheckpoint`，WAL 涨到 151.82MB |

## 1. 连接初始化

`openWritable(path)` MUST 先创建父目录，再**按此顺序**设置全部 8 项 PRAGMA：

```ts
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');        // WAL 下崩溃安全，写入快数倍
db.pragma('wal_autocheckpoint = 2000');
db.pragma('cache_size = -65536');         // 64MB page cache（负数 = KB）
db.pragma('mmap_size = 268435456');       // 256MB
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 5000');
```

`openReadonly(path)` 用 `{ readonly: true, fileMustExist: true }`，只设 `mmap_size` 与 `busy_timeout`。

**主动 checkpoint**：每轮扫描结束后调用一次。有活跃读事务时返回 busy，捕获后跳过，**不得重试阻塞**。

```ts
export function checkpointWal(db: Database): void {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* 下轮再来 */ }
}
```

## 2. 初始化流程

全新库的建库流程 MUST 是幂等的单一路径，不存在多版本分支：

```ts
export function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL);            // §3 全部 CREATE TABLE IF NOT EXISTS
  db.exec(INDEX_SQL);             // §4 全部 CREATE INDEX IF NOT EXISTS
  db.prepare(
    "INSERT INTO _meta(key, value) VALUES('schema_version', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(SCHEMA_VERSION));  // SCHEMA_VERSION = 1
  db.exec('ANALYZE');
}
```

启动时若读到的 `schema_version` 大于代码常量，MUST 中止并提示"数据库由更新版本创建"。小于时（未来才会出现）预留 `migrations/` 目录但当前为空。

## 3. 表定义

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
  detail_loaded     INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
```

> `system_prompt` 留在本表（参考实现 524 行索引查询 447.8KB / 5.33ms，可接受），但**列表查询必须显式列出返回列，绝不 `SELECT *`**。

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
  PRIMARY KEY (session_id, id)
) WITHOUT ROWID;
```

> **没有 `raw` 列。** raw 在 `event_raw`。
> 同 session 内重复 event id 由 adapter 追加 `:{sequence}` 后缀，写库前已唯一。

### 3.4 `event_raw`

```sql
CREATE TABLE IF NOT EXISTS event_raw (
  session_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  raw        TEXT,
  PRIMARY KEY (session_id, event_id)
) WITHOUT ROWID;
```

> 故意**不加外键**：raw 是可丢弃的调试数据，级联删除由 `deleteSession()` 显式执行，避免外键检查拖慢批量写入。

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
  calc_version          INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
```

> `calc_version` 默认 0，与代码常量 `METRICS_CALC_VERSION`（初始为 1）不等，因此首次读取必然触发计算并回写。

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
  raw_request_body  TEXT,
  raw_response_body TEXT
);
```

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

## 4. 索引（全集）

```sql
-- events：唯一热路径是 WHERE session_id = ? ORDER BY sequence
CREATE INDEX IF NOT EXISTS idx_events_session_seq    ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_session_phase  ON events(session_id, phase);
CREATE INDEX IF NOT EXISTS idx_events_kind           ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_phase          ON events(phase);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_ds_started   ON sessions(data_source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at   ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_provider     ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_source_agent ON sessions(source_agent);

-- scan_state
CREATE INDEX IF NOT EXISTS idx_scan_state_provider   ON scan_state(provider);
CREATE INDEX IF NOT EXISTS idx_scan_state_session    ON scan_state(session_id);

-- proxy_requests
CREATE INDEX IF NOT EXISTS idx_proxy_started_len     ON proxy_requests(started_at, system_prompt_len DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_hostname        ON proxy_requests(hostname);
CREATE INDEX IF NOT EXISTS idx_proxy_parsed_session  ON proxy_requests(parsed_session_id);

-- frida_captures
CREATE INDEX IF NOT EXISTS idx_frida_captured_at     ON frida_captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_frida_session         ON frida_captures(session_id);
CREATE INDEX IF NOT EXISTS idx_frida_capture_session ON frida_captures(capture_session_id);
```

> **不要建单列的 `idx_events_session_id` 或 `idx_sessions_data_source`。**
> 它们是上面两个复合索引的前缀，SQLite 会自动利用；单独建只会增加写入成本。
> 参考实现正是只建了单列版本，导致每次排序都走临时 B 树。

## 5. 查询规范

### 5.1 强制规则

1. **禁止 `SELECT *`**，一律显式列出返回列
2. 所有语句用模块级缓存的 `db.prepare()` 复用，**禁止在循环内 prepare**
3. 批量写入必须包在 `db.transaction()` 内
4. 时间戳一律 ISO 字符串比较（字典序等于时序）

### 5.2 列常量

```ts
export const SESSION_LIST_COLS = [
  'id', 'provider', 'source_agent', 'title', 'started_at', 'updated_at',
  'status', 'cwd', 'event_count', 'message_count', 'token_total', 'cost_usd',
  'data_source', 'source_path', 'detail_loaded',
  "CASE WHEN system_prompt IS NOT NULL AND system_prompt != '' THEN 1 ELSE 0 END AS has_system_prompt",
].join(', ');

export const EVENT_SLIM_COLS = [
  'session_id', 'id', 'sequence', 'kind', 'phase', 'title', 'started_at',
  'duration_ms', 'status', 'actor', 'tool', 'tokens_json', 'error',
  "CASE WHEN input_summary  IS NOT NULL AND input_summary  != '' THEN 1 ELSE 0 END AS has_input",
  "CASE WHEN output_summary IS NOT NULL AND output_summary != '' THEN 1 ELSE 0 END AS has_output",
].join(', ');

export const EVENT_FULL_COLS = `${EVENT_SLIM_COLS}, input_summary, output_summary`;

export const PROXY_LIST_COLS = [
  'id', 'request_id', 'method', 'url', 'hostname', 'response_status',
  'content_type', 'is_streaming', 'started_at', 'completed_at', 'duration_ms',
  'capture_method', 'ttnet_encrypted', 'model', 'input_tokens', 'output_tokens',
  'parsed_session_id', 'parser_route',
  'CASE WHEN system_prompt_len > 0 THEN 1 ELSE 0 END AS has_system_prompt',
].join(', ');
```

> `has_raw` 需 join `event_raw`，成本高于收益。slim 档统一置 `hasRaw = true`，由下钻接口返回 null 表示实际不存在。

### 5.3 三条核心查询的期望计划

`EXPLAIN QUERY PLAN` 输出中**不得出现** `USE TEMP B-TREE`：

| 查询 | 期望计划 | 预算 |
|------|---------|------|
| `SELECT {SESSION_LIST_COLS} FROM sessions WHERE data_source=? ORDER BY started_at DESC LIMIT ?` | `SEARCH sessions USING INDEX idx_sessions_ds_started` | < 1ms |
| `SELECT {EVENT_SLIM_COLS} FROM events WHERE session_id=? ORDER BY sequence LIMIT ? OFFSET ?` | `SEARCH events USING INDEX idx_events_session_seq` | < 15ms @ 9,590 行 |
| `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1` | `SEARCH proxy_requests USING INDEX idx_proxy_started_len` | < 1ms |

## 6. 数据保留

`proxy_requests` 无上限增长是长期风险。启动时执行一次：

```sql
DELETE FROM proxy_requests
 WHERE started_at < datetime('now', '-' || :retentionDays || ' days');
```

默认 `retentionDays = 30`，CLI 参数 `--proxy-retention-days`，设为 `0` 表示不清理。删除行数 > 1000 时触发一次 `checkpointWal()`。
