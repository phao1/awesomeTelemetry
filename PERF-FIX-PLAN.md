# Agent Observability performance fix plan

> Basis: `PERF-DIAGNOSIS.md` (measured 2026-08-03)
> Scale tier: **B** (524 sessions / 73,588 events / 800MB source files /
> 9,590 events in the largest session)
> Each fix includes: evidence → approach → code → acceptance criteria

---

## 0. Overview

### 0.1 Core judgment

Group B (prewarm off) first screen is **10-20ms**. The system itself has no
performance problem; all latency comes from three kinds of self-inflicted
useless work:

1. **Repeated labor** — `scan_state` being empty makes every scan round
   reprocess 800MB of source files
2. **Excessive transfer** — the detail endpoint returns `events.raw`
   (147.82MB total) and full summaries together
3. **Broadcast storm** — per-session SSE events trigger full frontend
   refetches

So the fix mainline is **stopping useless work**, not making slow operations
fast.

### 0.2 Fix priority

| Priority | ID | Fix | Bottleneck basis | Expected gain |
|----------|----|-----|------------------|---------------|
| P0 | F1 | fix `scan_state` incremental state (hidden root cause) | #1 #6 | no-change scan 18,235 SQL → 0 |
| P0 | F2 | prewarm → on-demand + LRU (full prewarm off by default) | #1 | first screen 5,884ms → <100ms |
| P0 | F3 | slim the detail endpoint: slim events + single-event drill-down | #2 #5 | worst detail 32.3MB → ~1.2MB |
| P0 | F4 | add two composite indexes | #4 | events sort 210ms → <15ms |
| P1 | F5 | Agent Overview server-side aggregation | #2 | 524 requests 299.6MB → 1 request <80KB |
| P1 | F6 | SSE event coalescing + frontend local patches | #3 | 508 requests in 30s → <15 |
| P1 | F7 | Trae `spawnSync` → async + decrypt result cache | #7 | main-thread blocking 6,074ms → 0 |
| P1 | F8 | split `events.raw` table + WAL checkpoint + PRAGMAs | #5 #8 | DB 471.6MB → ~175MB |
| P2 | F9 | gzip response compression | global | transfer volume down another 8-10x |
| P2 | F10 | `upsertEvents` differential writes | #6 | writes on change 182ms → <20ms |
| P2 | F11 | JSONL byte-offset tail incremental reads | #1 | codeagent 739MB reread → tail only |
| P2 | F12 | frontend virtual scrolling | #2 | 9,590-event DOM → ~40 in viewport |

### 0.3 Things we are NOT doing (data disproved them)

| Suspected | Measured | Conclusion |
|-----------|----------|------------|
| `listSessions` without pagination fields too large | 5.33ms / 447.8KB | not a bottleneck at current scale; leave for now |
| `getSystemPromptForSession`'s `LENGTH()` sort | 0.79ms (1,820 rows, only 5 with values) | not a bottleneck; leave for now |
| SQL execution itself slow | CPU profile only 4.2% | no need to switch storage engines |

> Note: these two become real bottlenecks above thousands of proxy_requests
> rows. When doing the F8 migration, add the `(started_at, system_prompt_len)`
> composite index as a side effect, but it is not a goal this round.

---

## F1 · Fix `scan_state` incremental state

**Evidence**: `scan_state` row count = 0 (Step 0). The
`idx_scan_state_provider` index exists but the table is empty → the write path
never took effect. 1,514 source files / 800.21MB reprocessed in full every
round.

**Approach**: three things. (a) locate and fix the write break; (b) upgrade
the granularity from mtime to content fingerprint; (c) compare before
scanning and skip the whole chain when unchanged.

### F1.1 Table structure upgrade (part of migration v5)

```sql
-- if a scan_state table already exists, add columns; otherwise create
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

### F1.2 Fingerprint computation (does not read the whole file)

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

/** Reads only the first/last 4KB + size + mtime; constant cost, independent of file size */
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

### F1.3 Pre-scan gate

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

### F1.4 Wire into `scanAndStoreDetail`

```ts
// server/watch/scan-scheduler.ts —— key: the gate is outermost; on skip, no IO and no DB writes
export function scanAndStoreDetail(db: Database, key: string, opts?: { force?: boolean }) {
  const entry = resolveSourcePath(db, key);        // from sessions.source_path
  if (!entry) return null;

  const gate = shouldRescan(db, entry.sourcePath);
  if (!gate.changed && !opts?.force) {
    return { skipped: true as const, key };        // ← zero IO zero SQL
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

**Acceptance**
- after the first full scan, `SELECT COUNT(*) FROM scan_state` >= 1,514
- immediately rerun a scan round: SQL write count = 0, time < 2s (stat + 8KB
  reads × 1,514 only)
- modify any JSONL file then rescan: only that file's session is rewritten

---

## F2 · Prewarm → on-demand + LRU

**Evidence**: A/B experiment 10s/60s/180s = 5,884 / 3,896 / 12,399ms vs
control 20 / 19 / 10ms, a 200-1240x ratio (Step 4). Median on-demand session
detail read is only 1.57ms, P95 12.94ms (Step 2) — **on-demand is fully
sufficient; full prewarm is pure burden**.

**Approach**: full prewarm off by default; replace with "read on first request
+ LRU cache". Keep a controlled optional prewarm covering only the most recent
N sessions, yielding to foreground requests.

### F2.1 LRU detail cache

```ts
// server/storage/detail-cache.ts
import type { TraceRecord } from '../../src/core/trace-types.js';

const MAX_ENTRIES = 24;
const cache = new Map<string, TraceRecord>();

export function getCachedDetail(key: string): TraceRecord | undefined {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }   // touch promotes
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

### F2.2 Foreground-first semaphore

```ts
// server/realtime/frontline.ts
let lastRequestAt = 0;
const QUIET_MS = 750;

export function markForegroundRequest(): void { lastRequestAt = Date.now(); }
export function isForegroundBusy(): boolean { return Date.now() - lastRequestAt < QUIET_MS; }
export const yieldTick = () => new Promise<void>(r => setTimeout(r, 0));
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
```

Call `markForegroundRequest()` in the HTTP server's outermost middleware.

### F2.3 Startup flow changes

```ts
// server/watch/scan-scheduler.ts
export interface InitialScanOptions {
  db: Database;
  /** prewarm the most recent N sessions; 0 = fully on demand (default, recommended) */
  prewarmRecent?: number;
}

export async function initialScanAndStore(opts: InitialScanOptions): Promise<void> {
  // phase 1: index only; must be fast. No detail reads, no decryption.
  const entries = scanLocalSessions();          // directory traversal + lightweight metadata only
  const tx = opts.db.transaction((list: SessionIndexEntry[]) => {
    for (const e of list) upsertSessionFromIndex(opts.db, e);
  });
  tx(entries);
  eventBus.emit('scan_completed', { provider: 'all', count: entries.length });

  // phase 2: optional prewarm, off by default
  const n = opts.prewarmRecent ?? 0;
  if (n <= 0) return;

  const keys = listSessions(opts.db, { dataSource: 'scan', limit: n }).map(s => s.id);
  void backgroundPrewarm(opts.db, keys);        // not awaited, does not block listen
}

async function backgroundPrewarm(db: Database, keys: string[]): Promise<void> {
  for (const key of keys) {
    while (isForegroundBusy()) await sleep(250);   // someone is using it → yield fully
    try { scanAndStoreDetail(db, key); } catch { /* prewarm failure must not affect service */ }
    await yieldTick();                              // yield a full event-loop round between sessions
  }
}
```

### F2.4 Detail endpoint goes through the cache

```ts
// server/server.ts —— GET /api/sessions/:key
const cached = getCachedDetail(key);
if (cached) return sendJson(res, shapeDetail(cached, mode));

const stored = getSessionDetail(db, key);
if (!stored || stored.events.length === 0) {
  scanAndStoreDetail(db, key);                    // lazy fill
}
const record = getSessionDetail(db, key);
if (record) putCachedDetail(key, record);
sendJson(res, shapeDetail(record, mode));
```

**CLI flag**: new `--prewarm-recent <n>`, default `0`. Docs state clearly:
setting a non-zero value sacrifices response speed for the first minutes
after startup.

**Acceptance**
- first screen at 10s / 60s / 180s after startup all < 100ms (aligned with
  Group B's 10-20ms order)
- cold session first open < 50ms (median) / < 700ms (worst 9,590-event
  session; should drop to < 60ms after F3)
- reopening the same session < 5ms (LRU hit)

---

## F3 · Slim the detail endpoint

**Evidence**: worst-session response 32,332.3KB / 625.29ms (Step 2);
`events.raw` totals 147.82MB / 64.2%, `input_summary` + `output_summary`
another 82.28MB (Step 0). Agent Overview pulls 299.6MB in one view.

**Approach**: detail lists return only **the fields needed to render the Gantt
tree**; bodies never included. EventInspector is a per-event panel, naturally
suited to "fetch on open".

### F3.1 Three-tier response modes

| mode | Use | Fields per event | Estimated size (9,590 events) |
|------|-----|------------------|-------------------------------|
| `slim` (default) | Gantt tree rendering | id, kind, phase, title, startedAt, durationMs, status, actor, tool, tokens | ~1.2MB → gzip ~150KB |
| `full` | export / report generation | slim + input_summary + output_summary | ~11MB |
| `raw` | debugging | full + raw | ~32MB |

```ts
// server/storage/query-engine.ts
export type EventMode = 'slim' | 'full' | 'raw';

const SLIM_COLS =
  'id, session_id, sequence, kind, phase, title, started_at, duration_ms, status, actor, tool, tokens_json, error';
const FULL_COLS = `${SLIM_COLS}, input_summary, output_summary`;

export function getSessionEvents(db: Database, sessionId: string, mode: EventMode = 'slim') {
  const cols = mode === 'slim' ? SLIM_COLS : FULL_COLS;   // raw fetched separately from event_raw, see F8
  return db
    .prepare(`SELECT ${cols} FROM events WHERE session_id = ? ORDER BY sequence`)
    .all(sessionId);
}
```

### F3.2 Single-event drill-down endpoint

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

### F3.3 Large-session pagination

Events per session: p99 = 3,332, max = 9,590. Enable pagination for sessions
with `> 2000` events:

```
GET /api/sessions/:key?events=slim&offset=0&limit=2000
```

The response carries `{ eventTotal, eventOffset, eventLimit, hasMore }`. The
frontend Gantt appends the next page when scrolling to the bottom (with F12).

### F3.4 Frontend change points

- `TraceGanttTree` consumes slim data only; it only draws phase/kind/duration
  bars anyway
- `EventInspector` issues `GET /api/sessions/:key/events/:eventId` on event
  selection, with 200ms debounce
- `TranscriptModal` / `TokenTextModal` / report generation use `mode=full`
- `recordCache` splits into two layers: `indexCache` (slim) and
  `eventDetailCache` (single events, Map capped at 100)

**Acceptance**
- worst session (9,590 events) detail response < 1.5MB, server < 60ms
- P95 session (401 events) response < 80KB
- EventInspector opening any event < 20ms

---

## F4 · Add composite indexes

**Evidence**: all 4 query plans show `USE TEMP B-TREE FOR ORDER BY` (Step 1).
Worst-session events sort 210.48ms.

```sql
-- migration v5

-- 1) events: covers WHERE session_id = ? ORDER BY sequence
CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
DROP INDEX IF EXISTS idx_events_session_id;          -- covered by the composite index prefix above

-- 2) sessions: covers WHERE data_source = ? ORDER BY started_at DESC
CREATE INDEX IF NOT EXISTS idx_sessions_ds_started ON sessions(data_source, started_at DESC);
DROP INDEX IF EXISTS idx_sessions_data_source;       -- COUNT(*) taken over by the composite covering index

-- 3) Agent Overview aggregation (see F5)
CREATE INDEX IF NOT EXISTS idx_events_session_phase ON events(session_id, phase);

ANALYZE;
```

**Kept unchanged**: `idx_events_kind`, `idx_events_phase`,
`idx_sessions_provider`, `idx_sessions_started_at`,
`idx_sessions_source_agent`, `idx_proxy_requests_*`.

> SQLite can reverse-scan ascending indexes, so `DESC` is not strictly
> required, but writing it explicitly reads better.

**Acceptance**
- `EXPLAIN QUERY PLAN` for the four queries above **no longer contains**
  `USE TEMP B-TREE`
- worst-session events query < 15ms (was 210.48ms)
- `listSessions` < 1ms (was 2.48ms)

---

## F5 · Agent Overview server-side aggregation

**Evidence**: 524 detail requests / 4,732ms / 299.6MB (Step 2 §4.2); browser
side 508 requests / 151.2MB in a 30s window (Step 3).

**Approach**: add an aggregation endpoint; two SQL statements produce all the
data; the frontend issues zero detail requests.

### F5.1 Endpoint

```
GET /api/agent-overview?dataSource=scan
```

### F5.2 Query implementation

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

Maps to Speed·Accuracy·Stability·Cost: `avgToolDurationMs` → Speed;
`verificationCoverage` → Accuracy; `errorRate` + `debugEntryRate` →
Stability; `tokenTotal` / `costUsd` → Cost.

### F5.3 Result cache

`EVENT_AGG` scans 73,588 rows, estimated 200-400ms. Use
`MAX(sessions.updated_at)` as the invalidation key:

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

**Frontend**: `AgentOverview.tsx` removes the `setTimeout` loop that fetches
details per session (report §9 item 4 mentions `App.tsx:246-254`) and issues a
single `fetch('/api/agent-overview')` instead.

**Acceptance**
- Agent view request count = 1, response < 80KB, end-to-end < 400ms (cache hit
  < 20ms)
- 30s window total transfer < 2MB (was 151.2MB)

---

## F6 · SSE event coalescing

**Evidence**: `scanAndStore` emits `session_updated` per session, repeatedly
triggering the frontend's `reloadSessionIndex` (Step 3).

### F6.1 Backend coalescer

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

Replace every `eventBus.emit('session_updated', …)` in scan-scheduler with
`queueSessionChange(key)`. Keep `session_created` / `session_deleted` as-is
(low frequency).

Add to the `TypedEventBus` event definitions:
`sessions_changed { keys: string[]; count: number }`.

### F6.2 Frontend local patches

```ts
// src/App.tsx
es.addEventListener('sessions_changed', (ev) => {
  const { keys } = JSON.parse((ev as MessageEvent).data) as { keys: string[] };
  keys.forEach(k => recordCache.delete(k));                 // invalidate detail cache
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

The backend `GET /api/sessions` supports a `keys` param
(`WHERE id IN (…)`, max 200; above that, fall back to full).

### F6.3 proxy_stream_chunk throttling

`realtime/spec.md` itself noted "high frequency, frontend should throttle"
without defining a mechanism. Complete it: chunks of the same `requestId` are
concatenated server-side on a 100ms window before emission; the frontend does
no per-chunk rendering.

**Acceptance**
- one full scan round (524 sessions) emits <= 10 SSE events (was 524)
- Playwright 30s window total requests < 15
- LiveIndicator still reflects connection state correctly

---

## F7 · Trae decryption without blocking

**Evidence**: CPU profile shows 4 `spawnSync` calls totaling 6,074ms, 37.5%
of CPU (Step 5). `readFileSync` + `readFileUtf8` another 3,601ms (22.2%).

**Approach**: three layers.

### F7.1 `spawnSync` → `spawn` + Promise

```ts
// local-sessions/trae-bridge.ts
import { spawn } from 'node:child_process';

export function runPythonBridge(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [script, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },   // G7 encoding pitfall, keep
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

The call chain `trae.ts` scanner → `readLocalSessionDetail` →
`scanAndStoreDetail` all become `async`.

### F7.2 Decrypt result cache

Trae source: 19 files / 30.61MB, but every decrypt copies the whole DB +
`wal_checkpoint(FULL)` + full-table joins. Add a file-level cache:

```ts
interface TraeCacheEntry { fp: string; decryptedAt: number; payload: TraeRecord[] }
const traeCache = new Map<string, TraeCacheEntry>();
const TRAE_TTL_MS = 30_000;   // aligned with the 30s poll (G5.2)

export async function readTraeSessions(dbPath: string): Promise<TraeRecord[]> {
  const fp = fingerprintFile(dbPath) .hash + ':' + fingerprintFile(dbPath + '-wal').hash;
  const hit = traeCache.get(dbPath);
  if (hit && hit.fp === fp && Date.now() - hit.decryptedAt < TRAE_TTL_MS) return hit.payload;

  const payload = JSON.parse(await runPythonBridge(BRIDGE_SCRIPT, ['--db', dbPath]));
  traeCache.set(dbPath, { fp, decryptedAt: Date.now(), payload });
  return payload;
}
```

> Key: the fingerprint must **also look at the `-wal` file**. This is exactly
> the correct solution to the G5.2 pitfall — the main DB's mtime never changes
> in WAL mode, but `-wal` does.

### F7.3 Trae off the request path

Trae decryption runs only in the 30s polling, never on the synchronous
`GET /api/sessions/:key` path. When the request path finds the Trae detail
missing, return the existing index data + `{ pending: true }`; SSE pushes
after decryption completes.

**Acceptance**
- `spawnSync` self time in the CPU profile = 0
- event-loop delay (`perf_hooks.monitorEventLoopDelay`) p99 < 50ms during
  request handling
- Trae sessions trigger no Python process when source files are unchanged

---

## F8 · Split `events.raw` + WAL management

**Evidence**: `events.raw` 147.82MB / 64.2% (Step 0); WAL 151.82MB
uncheckpointed (Step 0; report §9 item 1 listed as unverified guess).

### F8.1 migration v5: raw split

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

ALTER TABLE events DROP COLUMN raw;    -- SQLite >= 3.35; the version bundled with better-sqlite3 qualifies

UPDATE _meta SET schema_version = 5 WHERE key = 'schema_version';

COMMIT;

VACUUM;                                -- reclaim 147MB; must run outside the transaction
```

> Back up `agent-observe.db` before migrating. `VACUUM` needs temp space about
> equal to the current DB size (~320MB).

### F8.2 WAL management

```ts
// server/storage/db.ts —— openWritable()
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');        // safe under WAL, much faster writes
db.pragma('wal_autocheckpoint = 2000');   // default 1000 pages; set explicitly
db.pragma('cache_size = -65536');         // 64MB page cache
db.pragma('mmap_size = 268435456');       // 256MB
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 5000');

// after every scan round, checkpoint proactively (no active read transactions then)
export function checkpointWal(db: Database): void {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* readers present; skip, next round */ }
}
```

> `TRUNCATE` mode truncates the WAL to 0 bytes. With concurrent read
> transactions it fails and returns busy; catch and skip, never retry
> blocking.

**Acceptance**
- `agent-observe.db` < 180MB, `-wal` steady state < 20MB
- detail queries never touch the `event_raw` table (unless `include=raw`)
- all existing tests pass; raw data fully retrievable via the F3.2 endpoint

---

## F9 · gzip response compression

Plain Node HTTP server, native `zlib`, no Express:

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

**Acceptance**: `GET /api/sessions` transfer size 447.8KB → < 60KB.

---

## F10 · `upsertEvents` differential writes

**Evidence**: 1 DELETE + 347 INSERT = 348 statements / 181.91ms (Step 6); full
prewarm 18,235 statements.

F1 already zeroes "no-change" writes. This one handles "on change":

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
    // G4.8: duplicate event ids within a session get a :sequence suffix; keep the defensive measure
    let id = e.id;
    if (seen.has(id)) id = `${e.id}:${i + 1}`;
    seen.add(id);
    return toRow(sessionId, id, i + 1, e);   // undefined → null
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

Prerequisite: `events` needs a `UNIQUE(session_id, id)` constraint (the report
shows `sqlite_autoindex_events_1` exists; confirm it is that composite unique
key; if not, migration v5 creates it).

**Acceptance**: rescan appending 1 event → 1 INSERT, < 20ms.

---

## F11 · JSONL byte-offset tail incremental reads

**Evidence**: codeagent alone is 948 files / 739.21MB (Step 0b), 92.4% of
total source size. JSONL is append-only.

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
    try { rows.push(JSON.parse(line)); } catch { /* truncated tail line: stop here */ break; }
    consumed += bytes;
  }
  return { rows, endOffset: consumed };
}
```

Safety prerequisites (all must hold to take the incremental path; otherwise
fall back to full):
1. `scan_state.file_size >= prevOffset` (the file wasn't truncated or
   rewritten)
2. the first-4KB hash is unchanged (not a new file reusing the same path)
3. under CRLF, `+1` must use the actual newline length — on Windows prefer
   per-chunk `Buffer.byteLength` accounting instead of +1 per line

> Note: the CPU profile shows `RegExp: \r?\n` self time 459.8ms — the current
> implementation regex-splits the whole file string; this item goes to zero
> after switching to streaming.

**Acceptance**: one no-change scan round for the codeagent provider reads
< 10MB (was 739MB).

---

## F12 · Frontend virtual scrolling

**Evidence**: max events per session 9,590; p99 = 3,332. `useDeferredValue` is
a scheduling optimization; it doesn't reduce DOM nodes.

- `TraceGanttTree`: window rendering, mounting only ±10 rows around the
  viewport
- `SampleRail`: the 524-session list also windowed
- dependency hygiene: the project deliberately has only 4 runtime deps. An
  ~80-line hand-written windowing implementation suffices (fixed row height),
  or accept `@tanstack/react-virtual` (pure frontend dep, not in server
  bundle externals, doesn't affect G1.2's three-stage build)

**Acceptance**: opening a 9,590-event session: DOM node count < 500, first
paint < 200ms.

---

## 1. Expected results summary

| Metric | Current (measured) | Target after fixes |
|--------|--------------------|--------------------|
| first screen (within 10s of startup) | 5,884ms | < 100ms |
| first screen (within 180s) | 12,399ms | < 100ms |
| worst-session detail | 625ms / 32,332KB | < 60ms / < 1,500KB |
| P95 session detail | 12.94ms / 1,621KB | < 8ms / < 80KB |
| Agent Overview | 4,732ms / 524 requests / 299.6MB | < 400ms / 1 request / < 80KB |
| requests in a 30s window | 508 / 151.2MB | < 15 / < 2MB |
| events sort query (worst) | 210.48ms | < 15ms |
| no-change incremental scan | 18,235 SQL / 800MB reread | 0 SQL / < 20MB read |
| CPU: spawnSync blocking | 6,074ms (37.5%) | 0 |
| DB size (incl. WAL) | 471.64MB | < 200MB |

---

## 2. Implementation order and dependencies

```
migration v5 ──┬── F4 composite indexes        (independent; do first, lowest risk)
               ├── F8 raw split + WAL          (needs DB backup)
               └── F1 scan_state table structure
                        │
F1 incremental gate ────┴──→ F10 differential writes ──→ F11 byte-offset incremental reads
                        │
F2 on-demand + LRU ──────┘
        │
        ├──→ F3 detail slimming ──→ F12 virtual scrolling
        ├──→ F5 Overview aggregation
        ├──→ F6 SSE coalescing
        └──→ F7 Trae async (async contagion; separate PR)

F9 gzip: independent, wire at any time
```

**Suggested 4 PRs**:
1. `migration v5 + F4 + F8` (pure storage layer, independently verifiable)
2. `F1 + F2 + F10` (scanning and prewarm; biggest gain)
3. `F3 + F5 + F6 + F9` (API contract changes; frontend and backend in sync)
4. `F7 + F11 + F12` (async contagion + frontend rendering)

After each PR merge, rerun Step 4 (A/B) and Step 2 (segment timing) of
`PERF-DIAGNOSIS.md`, append the new numbers to the report, and form a
regression baseline.

---

## 3. Regression protection

Turn the performance budgets into assertions in CI:

```ts
// server/storage/perf.test.ts
it('detail queries do not produce TEMP B-TREE', () => {
  const plan = db.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM events WHERE session_id = ? ORDER BY sequence'
  ).all('x');
  expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
});

it('slim detail responses stay within budget', () => {
  const rec = getSessionDetail(db, worstKey, 'slim');
  expect(Buffer.byteLength(JSON.stringify(rec))).toBeLessThan(1_500_000);
});

it('no-change rescan produces no writes', () => {
  scanAndStoreDetail(db, key);
  const before = countWrites(db);
  const r = scanAndStoreDetail(db, key);
  expect(r?.skipped).toBe(true);
  expect(countWrites(db)).toBe(before);
});
```

These three assertions lock down F4, F3, and F1 respectively — the three
points most easily broken unintentionally in later iterations.
