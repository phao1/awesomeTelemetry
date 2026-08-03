# Agent Observability 性能修复方案

> 依据：`PERF-DIAGNOSIS.md`（2026-08-03 实测）
> 规模定档：**B 档**（524 会话 / 73,588 event / 源文件 800MB / 单会话最大 9,590 event）
> 每条修复包含：证据 → 改法 → 代码 → 验收标准

---

## 0. 总览

### 0.1 核心判断

Group B（关闭预热）首屏 **10–20ms**。系统本身没有性能问题，全部延迟来自三类自造的无用功：

1. **重复劳动** —— `scan_state` 为空导致每轮扫描重处理 800MB 源文件
2. **过量传输** —— 详情接口把 `events.raw`（147.82MB 总量）和全文 summary 一起返回
3. **广播风暴** —— 逐 session 发 SSE 触发前端全量重拉

因此修复主线是**停止做无用功**，而不是把慢操作优化快。

### 0.2 修复优先级

| 优先级 | 编号 | 修复项 | 依据瓶颈 | 预期收益 |
|--------|------|--------|---------|---------|
| P0 | F1 | 修复 `scan_state` 增量状态（隐藏根因） | #1 #6 | 无变更扫描 18,235 SQL → 0 |
| P0 | F2 | 预热改按需 + LRU（默认关闭全量预热） | #1 | 首屏 5,884ms → <100ms |
| P0 | F3 | 详情接口瘦身：slim events + 单 event 下钻 | #2 #5 | 最差详情 32.3MB → ~1.2MB |
| P0 | F4 | 补两条复合索引 | #4 | events 排序 210ms → <15ms |
| P1 | F5 | Agent Overview 服务端聚合 | #2 | 524 请求 299.6MB → 1 请求 <80KB |
| P1 | F6 | SSE 事件合并 + 前端局部 patch | #3 | 30s 内 508 请求 → <15 |
| P1 | F7 | Trae `spawnSync` 改异步 + 解密结果缓存 | #7 | 主线程阻塞 6,074ms → 0 |
| P1 | F8 | `events.raw` 拆表 + WAL checkpoint + PRAGMA | #5 #8 | DB 471.6MB → ~175MB |
| P2 | F9 | gzip 响应压缩 | 全局 | 传输体积再降 8–10x |
| P2 | F10 | `upsertEvents` 差分写入 | #6 | 有变更时写入 182ms → <20ms |
| P2 | F11 | JSONL byte-offset 尾部增量读 | #1 | codeagent 739MB 重读 → 仅读增量 |
| P2 | F12 | 前端虚拟滚动 | #2 | 9,590 event DOM → 视口内 ~40 |

### 0.3 不做的事（数据已证伪）

| 曾怀疑 | 实测 | 结论 |
|--------|------|------|
| `listSessions` 无分页字段过大 | 5.33ms / 447.8KB | 当前规模不是瓶颈，暂不改 |
| `getSystemPromptForSession` 的 `LENGTH()` 排序 | 0.79ms（1,820 行，仅 5 行有值） | 不是瓶颈，暂不改 |
| SQL 执行本身慢 | CPU profile 仅占 4.2% | 不需要换存储引擎 |

> 注：这两条在**千级 proxy_requests 以上**会变成真瓶颈。做 F8 迁移时顺手加复合索引 `(started_at, system_prompt_len)` 即可，但不作为本轮目标。

---

## F1 · 修复 `scan_state` 增量状态

**证据**：`scan_state` 行数 = 0（Step 0）。索引 `idx_scan_state_provider` 存在但表为空 → 写入路径从未生效。源文件 1,514 个 / 800.21MB 每轮全量重处理。

**改法**：三件事。(a) 定位并修复写入断点；(b) 把粒度从 mtime 升级为内容指纹；(c) 扫描前先比对，未变更直接跳过整条链路。

### F1.1 表结构升级（migration v5 的一部分）

```sql
-- 若已有 scan_state 表，补列；否则新建
CREATE TABLE IF NOT EXISTS scan_state (
  source_path   TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  session_id    TEXT,
  file_size     INTEGER NOT NULL,
  file_mtime_ms INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  byte_offset   INTEGER NOT NULL DEFAULT 0,
  last_scan_at  TEXT NOT NULL,
  event_count   INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_scan_state_provider ON scan_state(provider);
CREATE INDEX IF NOT EXISTS idx_scan_state_session  ON scan_state(session_id);
```

### F1.2 指纹计算（不读全文件）

```ts
// server/watch/fingerprint.ts
import { createHash } from 'node:crypto';
import { statSync, openSync, readSync, closeSync } from 'node:fs';

const PROBE = 4096;

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
  hash: string;
}

/** 只读首尾各 4KB + size + mtime，恒定成本，与文件大小无关 */
export function fingerprintFile(path: string): FileFingerprint {
  const st = statSync(path);
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(PROBE, st.size));
    readSync(fd, head, 0, head.length, 0);

    const tailLen = Math.min(PROBE, Math.max(0, st.size - head.length));
    const tail = Buffer.alloc(tailLen);
    if (tailLen > 0) readSync(fd, tail, 0, tailLen, st.size - tailLen);

    const h = createHash('sha1');
    h.update(String(st.size));
    h.update(head);
    h.update(tail);
    return { size: st.size, mtimeMs: Math.floor(st.mtimeMs), hash: h.digest('hex') };
  } finally {
    closeSync(fd);
  }
}
```

### F1.3 扫描前置门禁

```ts
// server/watch/scan-gate.ts
import type { Database } from 'better-sqlite3';
import { fingerprintFile } from './fingerprint.js';

let selectStmt: any = null;
let upsertStmt: any = null;

export function shouldRescan(db: Database, sourcePath: string): {
  changed: boolean;
  fp: ReturnType<typeof fingerprintFile>;
  prevOffset: number;
} {
  selectStmt ??= db.prepare(
    'SELECT file_size, file_mtime_ms, content_hash, byte_offset FROM scan_state WHERE source_path = ?'
  );
  const fp = fingerprintFile(sourcePath);
  const prev = selectStmt.get(sourcePath) as
    | { file_size: number; file_mtime_ms: number; content_hash: string; byte_offset: number }
    | undefined;

  if (!prev) return { changed: true, fp, prevOffset: 0 };

  const changed =
    prev.file_size !== fp.size ||
    prev.file_mtime_ms !== fp.mtimeMs ||
    prev.content_hash !== fp.hash;

  return { changed, fp, prevOffset: prev.byte_offset };
}

export function commitScanState(
  db: Database,
  sourcePath: string,
  provider: string,
  sessionId: string | null,
  fp: ReturnType<typeof fingerprintFile>,
  byteOffset: number,
  eventCount: number
): void {
  upsertStmt ??= db.prepare(`
    INSERT INTO scan_state
      (source_path, provider, session_id, file_size, file_mtime_ms, content_hash,
       byte_offset, last_scan_at, event_count)
    VALUES (@source_path, @provider, @session_id, @file_size, @file_mtime_ms, @content_hash,
            @byte_offset, @last_scan_at, @event_count)
    ON CONFLICT(source_path) DO UPDATE SET
      provider      = excluded.provider,
      session_id    = excluded.session_id,
      file_size     = excluded.file_size,
      file_mtime_ms = excluded.file_mtime_ms,
      content_hash  = excluded.content_hash,
      byte_offset   = excluded.byte_offset,
      last_scan_at  = excluded.last_scan_at,
      event_count   = excluded.event_count
  `);
  upsertStmt.run({
    source_path: sourcePath,
    provider,
    session_id: sessionId,
    file_size: fp.size,
    file_mtime_ms: fp.mtimeMs,
    content_hash: fp.hash,
    byte_offset: byteOffset,
    last_scan_at: new Date().toISOString(),
    event_count: eventCount,
  });
}
```

### F1.4 接入 `scanAndStoreDetail`

```ts
// server/watch/scan-scheduler.ts —— 关键：门禁在最外层，跳过时不做任何 IO 与 DB 写入
export function scanAndStoreDetail(db: Database, key: string, opts?: { force?: boolean }) {
  const entry = resolveSourcePath(db, key);        // 从 sessions.source_path 取
  if (!entry) return null;

  const gate = shouldRescan(db, entry.sourcePath);
  if (!gate.changed && !opts?.force) {
    return { skipped: true as const, key };        // ← 零 IO 零 SQL
  }

  const detail = readLocalSessionDetail(key);
  if (!detail) return null;

  const record = normalizeRawSample(detail);
  upsertSessionFromTrace(db, record);
  upsertEvents(db, record);
  upsertMetrics(db, record);

  commitScanState(
    db, entry.sourcePath, entry.provider, record.session.id,
    gate.fp, gate.fp.size, record.events.length
  );
  return { skipped: false as const, key, eventCount: record.events.length };
}
```

**验收标准**
- 首次全量扫描后，`SELECT COUNT(*) FROM scan_state` ≥ 1,514
- 立刻重跑一轮扫描：SQL 写语句数 = 0，耗时 < 2s（仅 stat + 8KB 读 × 1,514）
- 修改任意一个 JSONL 文件后重扫：仅该文件对应 session 被重写

---

## F2 · 预热改按需 + LRU

**证据**：A/B 实验 10s/60s/180s = 5,884 / 3,896 / 12,399ms，对照组 20 / 19 / 10ms，比值 200–1240x（Step 4）。中位 session 详情按需读取仅 1.57ms，P95 仅 12.94ms（Step 2）——**按需完全够用，全量预热是纯负担**。

**改法**：默认关闭全量预热，改为「首次请求时读取 + LRU 缓存」。保留一个受控的可选预热，仅覆盖最近 N 个会话，且对前台请求让路。

### F2.1 LRU 详情缓存

```ts
// server/storage/detail-cache.ts
import type { TraceRecord } from '../../src/core/trace-types.js';

const MAX_ENTRIES = 24;
const cache = new Map<string, TraceRecord>();

export function getCachedDetail(key: string): TraceRecord | undefined {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }   // 触碰即提升
  return hit;
}

export function putCachedDetail(key: string, record: TraceRecord): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, record);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
}

export function invalidateDetail(key: string): void { cache.delete(key); }
export function invalidateAllDetails(): void { cache.clear(); }
```

### F2.2 前台优先信号量

```ts
// server/realtime/frontline.ts
let lastRequestAt = 0;
const QUIET_MS = 750;

export function markForegroundRequest(): void { lastRequestAt = Date.now(); }
export function isForegroundBusy(): boolean { return Date.now() - lastRequestAt < QUIET_MS; }
export const yieldTick = () => new Promise<void>(r => setTimeout(r, 0));
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
```

在 HTTP server 的最外层中间件调用 `markForegroundRequest()`。

### F2.3 启动流程改造

```ts
// server/watch/scan-scheduler.ts
export interface InitialScanOptions {
  db: Database;
  /** 预热最近 N 个会话；0 = 完全按需（默认，推荐） */
  prewarmRecent?: number;
}

export async function initialScanAndStore(opts: InitialScanOptions): Promise<void> {
  // 阶段 1：只建索引，必须快。不读详情，不解密。
  const entries = scanLocalSessions();          // 仅目录遍历 + 轻量元数据
  const tx = opts.db.transaction((list: SessionIndexEntry[]) => {
    for (const e of list) upsertSessionFromIndex(opts.db, e);
  });
  tx(entries);
  eventBus.emit('scan_completed', { provider: 'all', count: entries.length });

  // 阶段 2：可选预热，默认不做
  const n = opts.prewarmRecent ?? 0;
  if (n <= 0) return;

  const keys = listSessions(opts.db, { dataSource: 'scan', limit: n }).map(s => s.id);
  void backgroundPrewarm(opts.db, keys);        // 不 await，不阻塞 listen
}

async function backgroundPrewarm(db: Database, keys: string[]): Promise<void> {
  for (const key of keys) {
    while (isForegroundBusy()) await sleep(250);   // 有人在用 → 完全退让
    try { scanAndStoreDetail(db, key); } catch { /* 预热失败不影响服务 */ }
    await yieldTick();                              // 每个会话之间让出整轮事件循环
  }
}
```

### F2.4 详情端点走缓存

```ts
// server/server.ts —— GET /api/sessions/:key
const cached = getCachedDetail(key);
if (cached) return sendJson(res, shapeDetail(cached, mode));

const stored = getSessionDetail(db, key);
if (!stored || stored.events.length === 0) {
  scanAndStoreDetail(db, key);                    // 惰性补齐
}
const record = getSessionDetail(db, key);
if (record) putCachedDetail(key, record);
sendJson(res, shapeDetail(record, mode));
```

**CLI 参数**：新增 `--prewarm-recent <n>`，默认 `0`。文档明确说明：设为非 0 会牺牲启动后前几分钟的响应速度。

**验收标准**
- 启动后 10s / 60s / 180s 三个时间点首屏均 < 100ms（对齐 Group B 的 10–20ms 量级）
- 冷会话首次打开 < 50ms（中位）/ < 700ms（9,590 event 的最差会话，F3 后应降到 < 60ms）
- 二次打开同一会话 < 5ms（命中 LRU）

---

## F3 · 详情接口瘦身

**证据**：最差 session 响应 32,332.3KB / 625.29ms（Step 2）；`events.raw` 全表 147.82MB 占 64.2%，`input_summary` + `output_summary` 另占 82.28MB（Step 0）。Agent Overview 单次拉取 299.6MB。

**改法**：详情列表只返回**渲染 Gantt 树所需的字段**，正文一律不带。EventInspector 是逐个 event 的面板，天然适配「点开才拉」。

### F3.1 三档响应模式

| mode | 用途 | 每 event 字段 | 预估体积（9,590 events） |
|------|------|--------------|------------------------|
| `slim`（默认） | Gantt 树渲染 | id, kind, phase, title, startedAt, durationMs, status, actor, tool, tokens | ~1.2MB → gzip ~150KB |
| `full` | 导出 / 报告生成 | slim + input_summary + output_summary | ~11MB |
| `raw` | 调试 | full + raw | ~32MB |

```ts
// server/storage/query-engine.ts
export type EventMode = 'slim' | 'full' | 'raw';

const SLIM_COLS =
  'id, session_id, sequence, kind, phase, title, started_at, duration_ms, status, actor, tool, tokens_json, error';
const FULL_COLS = `${SLIM_COLS}, input_summary, output_summary`;

export function getSessionEvents(db: Database, sessionId: string, mode: EventMode = 'slim') {
  const cols = mode === 'slim' ? SLIM_COLS : FULL_COLS;   // raw 从 event_raw 表单独取，见 F8
  return db
    .prepare(`SELECT ${cols} FROM events WHERE session_id = ? ORDER BY sequence`)
    .all(sessionId);
}
```

### F3.2 单 event 下钻端点

```
GET /api/sessions/:key/events/:eventId?include=raw
```

```ts
export function getEventDetail(db: Database, sessionId: string, eventId: string, includeRaw: boolean) {
  const row = db.prepare(
    'SELECT * FROM events WHERE session_id = ? AND id = ?'
  ).get(sessionId, eventId);
  if (!row) return null;
  if (!includeRaw) return row;
  const raw = db.prepare(
    'SELECT raw FROM event_raw WHERE session_id = ? AND event_id = ?'
  ).get(sessionId, eventId);
  return { ...row, raw: raw?.raw ?? null };
}
```

### F3.3 超大会话分页

单会话 event 数 p99 = 3,332，max = 9,590。对 `> 2000` 的会话启用分页：

```
GET /api/sessions/:key?events=slim&offset=0&limit=2000
```

响应体带 `{ eventTotal, eventOffset, eventLimit, hasMore }`。前端 Gantt 虚拟滚动到底部时追加下一页（配合 F12）。

### F3.4 前端改造要点

- `TraceGanttTree` 消费 slim 数据即可，它本来只画 phase/kind/duration 条
- `EventInspector` 选中 event 时发起 `GET /api/sessions/:key/events/:eventId`，加 200ms 防抖
- `TranscriptModal` / `TokenTextModal` / 报告生成走 `mode=full`
- `recordCache` 分两层：`indexCache`（slim）与 `eventDetailCache`（单 event，Map 上限 100 条）

**验收标准**
- 最差 session（9,590 events）详情响应 < 1.5MB、服务端 < 60ms
- P95 session（401 events）响应 < 80KB
- EventInspector 点开任意 event < 20ms

---

## F4 · 补复合索引

**证据**：4 条查询计划全部出现 `USE TEMP B-TREE FOR ORDER BY`（Step 1）。最差 session events 排序 210.48ms。

```sql
-- migration v5

-- 1) events：覆盖 WHERE session_id = ? ORDER BY sequence
CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
DROP INDEX IF EXISTS idx_events_session_id;          -- 已被上面的复合索引前缀覆盖

-- 2) sessions：覆盖 WHERE data_source = ? ORDER BY started_at DESC
CREATE INDEX IF NOT EXISTS idx_sessions_ds_started ON sessions(data_source, started_at DESC);
DROP INDEX IF EXISTS idx_sessions_data_source;       -- COUNT(*) 由复合索引接管 covering

-- 3) Agent Overview 聚合用（见 F5）
CREATE INDEX IF NOT EXISTS idx_events_session_phase ON events(session_id, phase);

ANALYZE;
```

**保留不动**：`idx_events_kind`、`idx_events_phase`、`idx_sessions_provider`、`idx_sessions_started_at`、`idx_sessions_source_agent`、`idx_proxy_requests_*`。

> SQLite 可反向扫描升序索引，`DESC` 关键字非必须，但显式写出可读性更好。

**验收标准**
- 上述四条查询的 `EXPLAIN QUERY PLAN` 输出中**不再出现** `USE TEMP B-TREE`
- 最差 session events 查询 < 15ms（原 210.48ms）
- `listSessions` < 1ms（原 2.48ms）

---

## F5 · Agent Overview 服务端聚合

**证据**：524 次详情请求 / 4,732ms / 299.6MB（Step 2 §4.2）；浏览器侧 30s 窗口 508 请求 / 151.2MB（Step 3）。

**改法**：新增聚合端点，两条 SQL 出全部数据，前端零详情请求。

### F5.1 端点

```
GET /api/agent-overview?dataSource=scan
```

### F5.2 查询实现

```ts
// server/storage/overview.ts
const SESSION_AGG = `
SELECT
  provider,
  source_agent                                   AS sourceAgent,
  COUNT(*)                                       AS sessionCount,
  SUM(COALESCE(event_count, 0))                  AS eventCount,
  SUM(COALESCE(token_input, 0))                  AS tokenInput,
  SUM(COALESCE(token_output, 0))                 AS tokenOutput,
  SUM(COALESCE(token_total, 0))                  AS tokenTotal,
  SUM(COALESCE(cost_usd, 0))                     AS costUsd,
  AVG((julianday(updated_at) - julianday(started_at)) * 86400000.0) AS avgWallClockMs,
  MAX(updated_at)                                AS latestUpdatedAt
FROM sessions
WHERE data_source = ?
GROUP BY provider, source_agent`;

const EVENT_AGG = `
SELECT
  s.provider,
  AVG(e.duration_ms)                                                   AS avgToolDurationMs,
  SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) * 1.0
    / NULLIF(COUNT(e.id), 0)                                           AS errorRate,
  COUNT(DISTINCT CASE WHEN e.phase = 'verify' THEN s.id END) * 1.0
    / NULLIF(COUNT(DISTINCT s.id), 0)                                  AS verificationCoverage,
  COUNT(DISTINCT CASE WHEN e.phase = 'debug' THEN s.id END) * 1.0
    / NULLIF(COUNT(DISTINCT s.id), 0)                                  AS debugEntryRate
FROM sessions s
JOIN events e ON e.session_id = s.id
WHERE s.data_source = ?
GROUP BY s.provider`;
```

映射到「快准稳省」：`avgToolDurationMs` → 快；`verificationCoverage` → 准；`errorRate` + `debugEntryRate` → 稳；`tokenTotal` / `costUsd` → 省。

### F5.3 结果缓存

`EVENT_AGG` 要扫 73,588 行，预估 200–400ms。用 `MAX(sessions.updated_at)` 作失效键：

```ts
let cached: { stamp: string; payload: unknown } | null = null;

export function getAgentOverview(db: Database, dataSource: string) {
  const stamp = String(
    db.prepare('SELECT COALESCE(MAX(updated_at), \'\') AS s FROM sessions WHERE data_source = ?')
      .get(dataSource)?.s ?? ''
  );
  if (cached?.stamp === stamp) return cached.payload;

  const sessionRows = db.prepare(SESSION_AGG).all(dataSource);
  const eventRows   = db.prepare(EVENT_AGG).all(dataSource);
  const byProvider  = new Map(eventRows.map((r: any) => [r.provider, r]));
  const payload = sessionRows.map((r: any) => ({ ...r, ...(byProvider.get(r.provider) ?? {}) }));

  cached = { stamp, payload };
  return payload;
}
```

**前端**：`AgentOverview.tsx` 删掉遍历拉详情的 `setTimeout` 循环（报告 §9 第 4 条提到的 `App.tsx:246-254`），改为单次 `fetch('/api/agent-overview')`。

**验收标准**
- Agent 视图请求数 = 1，响应 < 80KB，端到端 < 400ms（缓存命中 < 20ms）
- 30s 窗口总传输 < 2MB（原 151.2MB）

---

## F6 · SSE 事件合并

**证据**：`scanAndStore` 对每个 session 发 `session_updated`，前端 `reloadSessionIndex` 被重复触发（Step 3）。

### F6.1 后端合并器

```ts
// server/realtime/coalescer.ts
import { eventBus } from './event-bus.js';

const WINDOW_MS = 200;
const pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;

export function queueSessionChange(key: string): void {
  pending.add(key);
  if (timer) return;
  timer = setTimeout(flush, WINDOW_MS);
  timer.unref?.();
}

function flush(): void {
  timer = null;
  if (pending.size === 0) return;
  const keys = [...pending];
  pending.clear();
  eventBus.emit('sessions_changed', { keys, count: keys.length });
}
```

把 `scan-scheduler` 里所有 `eventBus.emit('session_updated', …)` 换成 `queueSessionChange(key)`。保留 `session_created` / `session_deleted` 原样（低频）。

在 `TypedEventBus` 事件定义中新增：`sessions_changed { keys: string[]; count: number }`。

### F6.2 前端局部 patch

```ts
// src/App.tsx
es.addEventListener('sessions_changed', (ev) => {
  const { keys } = JSON.parse((ev as MessageEvent).data) as { keys: string[] };
  keys.forEach(k => recordCache.delete(k));                 // 详情缓存失效
  startTransition(() => {
    fetch(`/api/sessions?keys=${encodeURIComponent(keys.join(','))}`)
      .then(r => r.json())
      .then((rows: SessionIndexEntry[]) => {
        setSessions(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          for (const row of rows) map.set(row.id, row);
          return [...map.values()].sort(
            (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
          );
        });
      });
  });
});
```

后端 `GET /api/sessions` 支持 `keys` 参数（`WHERE id IN (…)`，上限 200 个，超过则回退全量）。

### F6.3 proxy_stream_chunk 节流

`realtime/spec.md` 自己标注了「频率高，前端要做节流」但没定义机制。补上：同一 `requestId` 的 chunk 在服务端按 100ms 窗口拼接后再发，前端不做逐 chunk 渲染。

**验收标准**
- 一轮完整扫描（524 会话）产生的 SSE 事件数 ≤ 10（原 524）
- Playwright 30s 窗口总请求数 < 15
- LiveIndicator 仍能正常反映连接状态

---

## F7 · Trae 解密去阻塞

**证据**：CPU profile 中 4 次 `spawnSync` 合计 6,074ms，占 37.5% CPU（Step 5）。`readFileSync` + `readFileUtf8` 另占 3,601ms（22.2%）。

**改法**：三层。

### F7.1 `spawnSync` → `spawn` + Promise

```ts
// local-sessions/trae-bridge.ts
import { spawn } from 'node:child_process';

export function runPythonBridge(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [script, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },   // G7 编码坑，保留
      windowsHide: true,
    });
    let out = '', err = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += String(d); });
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve(out) : reject(new Error(`trae bridge exit ${code}: ${err.slice(0, 500)}`))
    );
  });
}
```

调用链 `trae.ts` scanner → `readLocalSessionDetail` → `scanAndStoreDetail` 全部改 `async`。

### F7.2 解密结果缓存

Trae 源文件 19 个 / 30.61MB，但每次都要复制整个 DB + `wal_checkpoint(FULL)` + 全表 join。加一层文件级缓存：

```ts
interface TraeCacheEntry { fp: string; decryptedAt: number; payload: TraeRecord[] }
const traeCache = new Map<string, TraeCacheEntry>();
const TRAE_TTL_MS = 30_000;   // 与 30s 轮询对齐（G5.2）

export async function readTraeSessions(dbPath: string): Promise<TraeRecord[]> {
  const fp = fingerprintFile(dbPath) .hash + ':' + fingerprintFile(dbPath + '-wal').hash;
  const hit = traeCache.get(dbPath);
  if (hit && hit.fp === fp && Date.now() - hit.decryptedAt < TRAE_TTL_MS) return hit.payload;

  const payload = JSON.parse(await runPythonBridge(BRIDGE_SCRIPT, ['--db', dbPath]));
  traeCache.set(dbPath, { fp, decryptedAt: Date.now(), payload });
  return payload;
}
```

> 关键：指纹必须**同时看 `-wal` 文件**。这正是 G5.2 那条坑的正解——主 DB 的 mtime 在 WAL 模式下不变，但 `-wal` 会变。

### F7.3 Trae 移出请求路径

Trae 解密只在 30 秒轮询里做，绝不在 `GET /api/sessions/:key` 的同步路径上触发。请求路径若发现 Trae 详情缺失，返回已有索引数据 + `{ pending: true }`，由 SSE 在解密完成后推送。

**验收标准**
- CPU profile 中 `spawnSync` self time = 0
- 请求处理期间事件循环延迟（`perf_hooks.monitorEventLoopDelay`）p99 < 50ms
- Trae 会话在源文件未变时不触发任何 Python 进程

---

## F8 · `events.raw` 拆表 + WAL 治理

**证据**：`events.raw` 147.82MB / 64.2%（Step 0）；WAL 151.82MB 未 checkpoint（Step 0，报告 §9 第 1 条列为未验证猜测）。

### F8.1 migration v5：raw 拆表

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS event_raw (
  session_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  raw        TEXT,
  PRIMARY KEY (session_id, event_id)
) WITHOUT ROWID;

INSERT OR REPLACE INTO event_raw(session_id, event_id, raw)
  SELECT session_id, id, raw
  FROM events
  WHERE raw IS NOT NULL AND raw != '';

ALTER TABLE events DROP COLUMN raw;    -- SQLite ≥ 3.35，better-sqlite3 自带版本满足

UPDATE _meta SET schema_version = 5 WHERE key = 'schema_version';

COMMIT;

VACUUM;                                -- 回收 147MB，必须在事务外执行
```

> 迁移前务必备份 `agent-observe.db`。`VACUUM` 需要约等于当前 DB 大小的临时空间（~320MB）。

### F8.2 WAL 治理

```ts
// server/storage/db.ts —— openWritable()
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');        // WAL 下安全，写入快数倍
db.pragma('wal_autocheckpoint = 2000');   // 默认 1000 页；显式设置
db.pragma('cache_size = -65536');         // 64MB page cache
db.pragma('mmap_size = 268435456');       // 256MB
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 5000');

// 每轮扫描结束后主动 checkpoint（此时无活跃读事务）
export function checkpointWal(db: Database): void {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* 有读者时跳过，下轮再来 */ }
}
```

> `TRUNCATE` 模式会把 WAL 文件截到 0 字节。如果有并发读事务会失败并返回 busy，捕获后跳过即可，不要重试阻塞。

**验收标准**
- `agent-observe.db` < 180MB，`-wal` 稳态 < 20MB
- 详情查询不再触碰 `event_raw` 表（除非 `include=raw`）
- 所有既有测试通过，raw 数据可通过 F3.2 端点完整取回

---

## F9 · gzip 响应压缩

纯 Node HTTP server，用原生 `zlib`，不引入 Express：

```ts
// server/http/send-json.ts
import { createGzip } from 'node:zlib';
import type { ServerResponse, IncomingMessage } from 'node:http';

const MIN_COMPRESS_BYTES = 1024;

export function sendJson(req: IncomingMessage, res: ServerResponse, body: unknown, status = 200): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf-8');
  const accepts = String(req.headers['accept-encoding'] ?? '').includes('gzip');

  if (!accepts || payload.length < MIN_COMPRESS_BYTES) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.length),
    });
    res.end(payload);
    return;
  }

  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-encoding': 'gzip',
    vary: 'accept-encoding',
  });
  const gz = createGzip({ level: 6 });
  gz.pipe(res);
  gz.end(payload);
}
```

**验收标准**：`GET /api/sessions` 传输体积 447.8KB → < 60KB。

---

## F10 · `upsertEvents` 差分写入

**证据**：1 DELETE + 347 INSERT = 348 语句 / 181.91ms（Step 6）；全量预热 18,235 语句。

F1 已经让「无变更时」的写入归零。本条处理「有变更时」：

```ts
export function upsertEvents(db: Database, record: TraceRecord): void {
  const sessionId = record.session.id;

  const existing = db
    .prepare('SELECT id, sequence FROM events WHERE session_id = ? ORDER BY sequence')
    .all(sessionId) as { id: string; sequence: number }[];
  const existingIds = new Set(existing.map(r => r.id));

  const insert = db.prepare(`
    INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at,
                        duration_ms, status, actor, tool, input_summary, output_summary,
                        tokens_json, error)
    VALUES (@session_id, @id, @sequence, @kind, @phase, @title, @started_at,
            @duration_ms, @status, @actor, @tool, @input_summary, @output_summary,
            @tokens_json, @error)
    ON CONFLICT(session_id, id) DO UPDATE SET
      sequence = excluded.sequence, kind = excluded.kind, phase = excluded.phase,
      title = excluded.title, started_at = excluded.started_at,
      duration_ms = excluded.duration_ms, status = excluded.status,
      actor = excluded.actor, tool = excluded.tool,
      input_summary = excluded.input_summary, output_summary = excluded.output_summary,
      tokens_json = excluded.tokens_json, error = excluded.error
  `);

  const seen = new Set<string>();
  const rows = record.events.map((e, i) => {
    // G4.8：同 session 内重复 event id 追加 :sequence 后缀，防御性措施保留
    let id = e.id;
    if (seen.has(id)) id = `${e.id}:${i + 1}`;
    seen.add(id);
    return toRow(sessionId, id, i + 1, e);   // undefined 一律转 null
  });

  const staleIds = [...existingIds].filter(id => !rows.some(r => r.id === id));

  db.transaction(() => {
    for (const r of rows) insert.run(r);
    if (staleIds.length > 0) {
      const del = db.prepare('DELETE FROM events WHERE session_id = ? AND id = ?');
      for (const id of staleIds) del.run(sessionId, id);
      const delRaw = db.prepare('DELETE FROM event_raw WHERE session_id = ? AND event_id = ?');
      for (const id of staleIds) delRaw.run(sessionId, id);
    }
  })();
}
```

前提：`events` 需要 `UNIQUE(session_id, id)` 约束（报告显示已有 `sqlite_autoindex_events_1`，确认其为该复合唯一键；若不是，migration v5 补建）。

**验收标准**：append 1 个 event 的重扫 → 1 条 INSERT，耗时 < 20ms。

---

## F11 · JSONL byte-offset 尾部增量读

**证据**：codeagent 单 provider 948 文件 / 739.21MB（Step 0b），占源文件总量 92.4%。JSONL 是 append-only。

```ts
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function readJsonlFrom(
  path: string,
  startOffset: number
): Promise<{ rows: unknown[]; endOffset: number }> {
  const rows: unknown[] = [];
  let consumed = startOffset;

  const stream = createReadStream(path, { start: startOffset, encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const bytes = Buffer.byteLength(line, 'utf-8') + 1;   // +1 for \n
    if (!line.trim()) { consumed += bytes; continue; }
    try { rows.push(JSON.parse(line)); } catch { /* 截断的尾行：停在此处 */ break; }
    consumed += bytes;
  }
  return { rows, endOffset: consumed };
}
```

安全前提（必须同时满足才走增量路径，否则退回全量）：
1. `scan_state.file_size >= prevOffset`（文件没被截断或重写）
2. 文件首 4KB 的 hash 未变（不是新文件复用了同一路径）
3. CRLF 环境下 `+1` 改为按实际换行符长度计算——Windows 上建议直接用 `Buffer.byteLength` 逐块统计而非按行加 1

> 注意 CPU profile 里 `RegExp: \r?\n` 自耗时 459.8ms —— 现有实现用正则 split 整个文件字符串，改流式后这一项也会归零。

**验收标准**：codeagent provider 一轮无变更扫描读取字节数 < 10MB（原 739MB）。

---

## F12 · 前端虚拟滚动

**证据**：单会话最大 9,590 event；p99 = 3,332。`useDeferredValue` 是调度优化，不减少 DOM 节点。

- `TraceGanttTree`：窗口化渲染，仅挂载视口内 ±10 行
- `SampleRail`：524 条会话列表同样窗口化
- 依赖洁癖考虑：项目刻意只有 4 个 runtime 依赖。可用 ~80 行手写 windowing（固定行高场景足够），或接受引入 `@tanstack/react-virtual`（纯前端依赖，不进 server bundle 的 external 列表，不影响 G1.2 的三阶段构建）

**验收标准**：打开 9,590 event 的会话，DOM 节点数 < 500，首次绘制 < 200ms。

---

## 1. 预期效果汇总

| 指标 | 现状（实测） | 修复后目标 |
|------|------------|-----------|
| 首屏（启动 10s 内） | 5,884ms | < 100ms |
| 首屏（启动 180s） | 12,399ms | < 100ms |
| 最差 session 详情 | 625ms / 32,332KB | < 60ms / < 1,500KB |
| P95 session 详情 | 12.94ms / 1,621KB | < 8ms / < 80KB |
| Agent Overview | 4,732ms / 524 请求 / 299.6MB | < 400ms / 1 请求 / < 80KB |
| 30s 窗口请求数 | 508 / 151.2MB | < 15 / < 2MB |
| events 排序查询（最差） | 210.48ms | < 15ms |
| 无变更增量扫描 | 18,235 SQL / 800MB 重读 | 0 SQL / < 20MB 读 |
| CPU：spawnSync 阻塞 | 6,074ms (37.5%) | 0 |
| DB 体积（含 WAL） | 471.64MB | < 200MB |

---

## 2. 实施顺序与依赖

```
migration v5 ──┬── F4 复合索引        （独立，最先做，风险最低）
               ├── F8 raw 拆表 + WAL  （需备份 DB）
               └── F1 scan_state 表结构
                        │
F1 增量门禁 ────────────┴──→ F10 差分写入 ──→ F11 byte-offset 增量读
                        │
F2 按需 + LRU ──────────┘
        │
        ├──→ F3 详情瘦身 ──→ F12 虚拟滚动
        ├──→ F5 Overview 聚合
        ├──→ F6 SSE 合并
        └──→ F7 Trae 异步化（涉及 async 传染，单独一个 PR）

F9 gzip：任意时点独立接入
```

**建议切成 4 个 PR**：
1. `migration v5 + F4 + F8`（纯存储层，可独立验证）
2. `F1 + F2 + F10`（扫描与预热，收益最大）
3. `F3 + F5 + F6 + F9`（API 契约变更，前后端同步改）
4. `F7 + F11 + F12`（async 传染 + 前端渲染）

每个 PR 合入后重跑一遍 `PERF-DIAGNOSIS.md` 的 Step 4（A/B）与 Step 2（分段耗时），把新数字追加进报告，形成回归基线。

---

## 3. 回归防护

把性能预算写成断言，进 CI：

```ts
// server/storage/perf.test.ts
it('详情查询不产生 TEMP B-TREE', () => {
  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM events WHERE session_id = ? ORDER BY sequence'
  ).all('x');
  expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
});

it('slim 模式详情响应控制在预算内', () => {
  const rec = getSessionDetail(db, worstKey, 'slim');
  expect(Buffer.byteLength(JSON.stringify(rec))).toBeLessThan(1_500_000);
});

it('无变更重扫不产生写入', () => {
  scanAndStoreDetail(db, key);
  const before = countWrites(db);
  const r = scanAndStoreDetail(db, key);
  expect(r?.skipped).toBe(true);
  expect(countWrites(db)).toBe(before);
});
```

这三条断言分别锁住 F4、F3、F1，是最容易在后续迭代中被无意破坏的三个点。
