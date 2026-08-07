# Contract: HTTP API

> **Authoritative source.** All endpoint paths, params, response shapes, and
> status codes must be adopted verbatim. Type references:
> `contracts/data-model.md`. Corresponding source files:
> `server/server.ts` (production) + `local-sessions/vite-plugin.ts` (dev)

## 0. General conventions

### 0.1 Basics

- Base path: `/api`
- Requests and responses are `application/json; charset=utf-8`
- Server: plain Node `http`, no Express/Fastify
- Default bind address `127.0.0.1` (**not localhost**, G3.1)

### 0.2 Response compression

When the response body is >= 1024 bytes and the request carries
`accept-encoding: gzip`, respond with gzip and set:

```
content-encoding: gzip
vary: accept-encoding
```

Responses under 1024 bytes are not compressed and must carry `content-length`.

### 0.3 Error envelope

**All** non-2xx responses use the unified shape, no exceptions:

```ts
interface ApiError {
  error: {
    /** Machine-readable, stable. Full set in §0.4. */
    code: string;
    /** Human-readable, English. i18n is the frontend's job. */
    message: string;
    /** Optional context, debug display only. */
    details?: Record<string, unknown>;
  };
}
```

Example:

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "No session with key codeagent-abf46f48171c01", "details": { "key": "codeagent-abf46f48171c01" } } }
```

### 0.4 Error code full set

| code | HTTP | Meaning |
|------|------|---------|
| `BAD_REQUEST` | 400 | missing or malformed params |
| `INVALID_ENUM` | 400 | enum value outside the allowed set |
| `SESSION_NOT_FOUND` | 404 | session key does not exist |
| `EVENT_NOT_FOUND` | 404 | event id not in this session |
| `PROMPT_CONTEXT_NOT_FOUND` | 404 | session exists but has no captured Prompt Context |
| `PROXY_REQUEST_NOT_FOUND` | 404 | proxy request id does not exist |
| `ROUTE_NOT_FOUND` | 404 | path not registered |
| `PROVIDER_DISABLED` | 409 | provider disabled in config |
| `SESSION_PARSE_FAILED` | 500 | session source parse failed (corrupt / not this provider's format, G5.6) |
| `PROXY_ALREADY_RUNNING` | 409 | proxy already running |
| `PROXY_NOT_RUNNING` | 409 | proxy not running |
| `CONTEXT_DIFF_UNAVAILABLE` | 409 | target is valid but no trustworthy automatic predecessor exists |
| `CONTEXT_DIFF_UNSUPPORTED` | 422 | target/base source cannot be normalized safely within phase-1 rules |
| `FRIDA_TARGET_NOT_FOUND` | 409 | no Trae process or ai_agent.dll not loaded |
| `TRAE_KEY_MISSING` | 412 | Trae SQLCipher key not extracted (G6.1) |
| `SCAN_IN_PROGRESS` | 429 | a scan is already running |
| `INTERNAL_ERROR` | 500 | unclassified exception; `details` never contains a stack |
| `DECRYPT_FAILED` | 500 | Python bridge decryption failed |

### 0.5 Pagination conventions

List endpoints use `limit` + `cursor` (keyset), **never offset** (offset misses
rows / duplicates when data changes):

- `limit`: default 50, max 500
- `cursor`: the last item's `startedAt` from the previous page; omitted on the first page
- Response contains `{ items, nextCursor, hasMore }`; `nextCursor: null` means end

> Exception: in-session event pagination uses `offset` + `limit`, because
> `sequence` is continuous and immutable, offset semantics are stable, and the
> frontend virtual scroll needs random jumps.

### 0.6 Foreground request marking

**Every** `/api/*` request must call `markForegroundRequest()` on entry so
background prewarm yields (see `specs/session-scanning` REQ-012).

---

## 1. Sessions

### 1.1 `GET /api/sessions`

Session index list. **The response never contains the `systemPrompt` body or
any events.**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` | data source; scan/proxy shown separately (G7.4) |
| `provider` | `ProviderKey` | — | optional filter; comma-separated multi-select, `provider IN (...)` |
| `status` | `TraceStatus` | — | optional filter; comma-separated multi-select, `status IN (...)`; any invalid value returns `400 INVALID_ENUM` |
| `q` | string | — | title / session ID case-insensitive substring (SQL `LIKE` with `ESCAPE '\'`, `% _ \` treated literally) |
| `range` | `'today' \| '7d' \| '30d' \| 'all'` | — | `updated_at >= since` activity filter (`today` = local midnight); a long-running session updated today remains visible. Default no filter; frontend default is `today`; invalid value returns `400 INVALID_ENUM` |
| `limit` | number | 50 | max 500 |
| `cursor` | string | — | last item's `startedAt` of the previous page |
| `keys` | string | — | comma-separated key list for batched patches after SSE; max 200, more returns `BAD_REQUEST` |
| `merged` | `'1' \| '0'` | `'1'` | whether to apply session merging (see `specs/session-merge`) |

```ts
// 200
interface SessionListResponse {
  items: SessionIndexEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;          // total under the current filters, from COUNT(*)
}
```

> When `keys` is passed, `limit` / `cursor` / `total` are ignored; matching
> items are returned directly and `hasMore` is always `false`. The same
> applies to `q` / `range` / `provider` / `status` — the `keys` path ignores
> all filters.

**Budget**: 500 items < 60KB (gzipped), server < 5ms.

### 1.2 `GET /api/sessions/:key`

Session detail. **Defaults to `mode=slim`.**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `'slim' \| 'full'` | `'slim'` | `raw` is not supported here; use §1.3 |
| `offset` | number | 0 | event offset |
| `limit` | number | 2000 | max event count, cap 5000 |

Response: `SessionDetailResponse` (see `contracts/data-model.md` §5).

Behavior requirements:

1. LRU detail-cache hit returns directly
2. Miss and `sessions.detail_loaded = 0` → trigger one lazy `scanAndStoreDetail`
3. Session belongs to an async-decryption provider (Trae) and decryption is
   not done → return existing index data + `pending: true`, **non-blocking**;
   SSE `sessions_changed` notifies when decryption completes
4. Key does not exist → 404 `SESSION_NOT_FOUND`

**Budget**: worst session (9,590 events) slim tier < 1.5MB, server < 60ms.

### 1.3 `GET /api/sessions/:key/events/:eventId`

Single-event drill-down. Called when EventInspector clicks.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `include` | `'raw'` | — | when set, fills `raw` from the `event_raw` table |

```ts
// 200 → TraceEvent or TraceEventRaw
// 404 → EVENT_NOT_FOUND
```

**Budget**: < 20ms.

### 1.3a `GET /api/sessions/:key/prompt-context` (show-trae-prompt-context)

Returns the independently stored `SessionPromptContext` for an explicit UI
drill-down. It MUST NOT trigger Trae decryption or any child process.

```ts
// 200 → SessionPromptContext (contracts/data-model.md §3.1)
// 404 → SESSION_NOT_FOUND when the session key does not exist
// 404 → PROMPT_CONTEXT_NOT_FOUND when the session exists but has no context row
```

The session list and `GET /api/sessions/:key` MUST NOT contain
`dynamicSections`, `modelConfig`, or `analysis` from this endpoint.

**Budget**: < 20ms; gzip applies when the body is >= 1KB.

### 1.4 `GET /api/sessions/:key/report`

Generates a self-contained HTML report.

| Param | Type | Default |
|-------|------|---------|
| `format` | `'html'` | `'html'` |

Responds `text/html`. **Large JSON must be written to an external `.js` file
and referenced; inline `<script>var data=...</script>` is forbidden (G7.6).**

### 1.5 `DELETE /api/sessions/:key`

Cascade-deletes `events` + `event_raw` + `metrics` + `sessions` + the matching
`scan_state` row.

```ts
// 200 → { deleted: true, key: string }
```

### 1.6 `POST /api/sessions/:key/rescan`

Force-rescans a single session, bypassing the `scan_state` gate
(`force: true`).

```ts
// 200 → { key: string, eventCount: number, durationMs: number }
```

---

## 2. Aggregations

### 2.1 `GET /api/agent-overview`

**Replaces v4's frontend N+1.** Measured: v4's view produced 524 requests /
299.6MB / 4,732ms.

| Param | Type | Default |
|-------|------|---------|
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` |

```ts
// 200
interface AgentOverviewResponse {
  rows: AgentOverviewRow[];
  /** Cache invalidation key = MAX(sessions.updated_at). Frontend can use it
   * to decide whether to refresh. */
  stamp: string;
  cached: boolean;
}
```

**Implementation requirement**: three SQL queries (session-level aggregation +
event-level aggregation + phase-duration aggregation) merged server-side,
cached by `stamp`. The frontend **must not** fetch per-session details for
this view.

**Budget**: 1 request, < 80KB, < 400ms (cache hit < 20ms).

### 2.2 `GET /api/providers/status`

```ts
// 200
interface ProviderStatusResponse {
  providers: Array<{
    key: ProviderKey;
    enabled: boolean;
    sessionCount: number;
    lastScanAt: string | null;
    /** Trae-specific: whether the key is ready */
    ready: boolean;
    /** reason code when ready=false, e.g. TRAE_KEY_MISSING */
    blockedBy: string | null;
  }>;
}
```

### 2.3 `POST /api/compare`

```ts
// request
{ leftKey: string; rightKey: string }
// 200 → { left: SessionDetailResponse; right: SessionDetailResponse; speed: { left: SpeedMetrics; right: SpeedMetrics } }
```

`mode` is fixed to `slim`. The compare report HTML goes through
`GET /api/compare/report?left=&right=`.

### 2.4 `GET /api/mission`

Mission 指挥中心聚合：**一次请求返回全部 A/B/C 三区 widget**（G11.9 红线：
禁止前端逐会话拉取，frontend REQ-003）。响应形状见
`contracts/data-model.md` §5.1 `MissionResponse`。

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `range` | `'7d' \| '30d' \| 'all'` | `'7d'` | 时间窗（按 `sessions.started_at` 过滤） |
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` | G7.4：scan/proxy 分开展示，不混列 |
| `tz` | number | `0` | 本地时区偏移分钟数，用于 A4 活跃热力图 / A7 会话活跃曲线 / C3 任务日历的分桶（**分桶前在 SQL 里偏移**，分桶后无法再转换） |

```ts
// 200 → MissionResponse（见 contracts/data-model.md §5.1）
```

**实现要求**：

1. 每个 widget 必带非空 `criteria`（表名/字段/计算方式/覆盖范围，服务端下发）。
2. `available=false` 时 `data` 必须为 `null` 且 `unavailableReason` 非空
   （如 `'NO_PRICING_TABLE'` / `'DURATION_NOT_MEASURED'`）；**禁止用 0 冒充**。
3. stamp 缓存：`stamp = MAX(sessions.updated_at)`，复用
   `server/storage/overview.ts` 的 `cacheByDb` WeakMap 模式；stamp 未变直接
   返回缓存（`cached: true`）。
4. ⚠️ better-sqlite3 是同步 API：单 widget SQL 必须 < 30ms（tier B），
   A / B / C 三区之间 `await setTimeout(0)` 让出一整轮事件循环
   （design.md §7.3 R1）。
5. 入口由 `createServer` 的统一 handler 调 `markForegroundRequest()`（§0.6）。

**Budget**：冷启 < 500ms / 1 请求 / < 120KB (gzip)；缓存命中 < 20ms；
事件循环 p99 < 50ms（见 `contracts/nfr.md` §2）。

---

## 3. Realtime

### 3.1 `GET /api/events` (SSE)

`text/event-stream`. Sends a `connected` event immediately on connection.

Event types and payloads map exactly to `BusEvents` in
`contracts/data-model.md` §10.

```
event: connected
data: {"serverTime":"2026-08-03T02:38:49.000Z","schemaVersion":1}

event: sessions_changed
data: {"keys":["codeagent-1f07032d5edae5","trae-3fd3ab3a6128c5"],"count":2}

event: scan_completed
data: {"provider":"all","count":524}
```

**Mandatory requirements**:

1. `sessions_changed` is emitted by the server after coalescing on a **200ms
   window**. Per-session `session_updated` emission is **forbidden** (v4's
   approach, measured 508 requests / 151.2MB in 30s on the frontend).
2. `proxy_stream_chunk` is concatenated by the server on a **100ms window**;
   the frontend no longer renders chunk by chunk.
3. On client disconnect, cleanup must run and unsubscribe everything.
4. Send a comment-line heartbeat every 30s (`: ping\n\n`) to prevent
   proxy-layer timeouts.

**Frontend consumption rules**: on `sessions_changed`, do **only a local
patch** — invalidate the detail cache for the matching keys and fetch index
rows once via `GET /api/sessions?keys=...`. **Refetching the full index is
forbidden.**

---

## 4. Proxy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/proxy/start` | POST | body `{ port?: number }`; running → 409 `PROXY_ALREADY_RUNNING` |
| `/api/proxy/stop` | POST | not running → 409 `PROXY_NOT_RUNNING` |
| `/api/proxy/status` | GET | `{ running: boolean, starting: boolean, port: number \| null, requestCount: number, startedAt: string \| null }` (D4: `starting=true` during async startup) |
| `/api/proxy/requests` | GET | list, `ProxyRequestListItem[]`, **excludes all 4 body columns and the systemPrompt body** |
| `/api/proxy/requests/:id` | GET | full `ProxyRequest` incl. bodies |
| `/api/proxy/requests/:id/context-diff` | GET | bounded evidence-grade request-context diff (see §4.1) |
| `/api/ca-cert` | GET | `application/x-pem-file`, downloads the CA certificate |

`/api/proxy/requests` params: `limit` (default 50, max 500), `cursor`,
`hostname`, `captureMethod`.

### 4.1 `GET /api/proxy/requests/:id/context-diff` (add-request-context-diff)

On-demand comparison of the desensitized request context of the target
request `:id` with an eligible base request. Query:

```ts
interface RequestContextDiffQuery {
  base?: 'previous' | `${number}`; // omitted equals previous; numeric value MUST be a positive integer
}
```

Semantics:

- Omitted `base` is identical to `base=previous` (automatic pairing).
- Automatic pairing precedence (design D4): nearest earlier supported request
  with the same non-empty `parsed_session_id` and `request_format`, then
  nearest earlier supported request in the same non-empty `capture_group_id`
  with the same `request_format` and null-safe-equal `model`. Candidates with
  conflicting non-empty known session IDs are rejected. Never pair by
  timestamp alone.
- `base=<positive integer>` selects an explicit manual base; base→target
  order is preserved, confidence is `manual`, and identity mismatches are
  returned as warnings, never silently coerced.
- The route reads exactly the target row and at most one base row; it never
  scans a capture group/session and never selects raw body columns.

```ts
// 200 → RequestContextDiffResponse (contracts/data-model.md §7.1, verbatim
//       from design D10); uncompressed body < 1 MiB; gzip applies via §0.2.
```

Errors (all via the unified `ApiError` envelope, §0.3; `details` never
contains a source body, auth header, or stack):

| HTTP | Code | Trigger |
|---:|---|---|
| 400 | `BAD_REQUEST` | invalid target/base param or base equals target |
| 404 | `PROXY_REQUEST_NOT_FOUND` | target missing; manual base missing (`details.role='base'`, no body evidence) |
| 409 | `CONTEXT_DIFF_UNAVAILABLE` | no trustworthy automatic predecessor; `details.reason='pairing_unavailable'` |
| 422 | `CONTEXT_DIFF_UNSUPPORTED` | source cannot be normalized safely (missing/unknown/malformed/encrypted/oversized body, format disagreement) with a stable reason |
| 500 | `INTERNAL_ERROR` | unclassified failure; sanitized, no stack/body/partial diff |

**Budget**: service p95 < 100 ms, event-loop p99 < 50 ms, uncompressed
response < 1 MiB, two-row read (see `contracts/nfr.md` §2).

---

## 5. Frida

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/frida/start` | POST | body `{ pid?: number }`, auto-discover when omitted; failure → 409 `FRIDA_TARGET_NOT_FOUND` |
| `/api/frida/stop` | POST | |
| `/api/frida/status` | GET | `{ running: boolean, starting: boolean, pid: number \| null }` |
| `/api/frida/captures` | GET | paginated list; `jsonData` truncated to 500 chars |
| `/api/frida/captures/:id` | GET | full record |

---

## 6. Config

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config/providers` | GET | returns the merged `LocalSessionConfig` |
| `/api/config/providers` | PUT | writes the user config layer, **must be atomic** (tmp + rename, G2.3); returns the new merged config |
| `/api/session-groups` | GET | merge groups from `config/session-groups.json` (+ auto subagent groups); members are session keys usable with `GET /api/sessions?keys=` |
| `/api/desensitization/rules` | GET | current rule set (incl. enabled state) |
| `/api/desensitization/rules` | PUT | updates rules; also atomic write |
| `/api/scan` | POST | body `{ provider?: ProviderKey, force?: boolean }`; scan in progress → 429 `SCAN_IN_PROGRESS` |
| `/api/health` | GET | `{ ok: true, schemaVersion: 1, uptimeMs: number, dbSizeBytes: number, walSizeBytes: number }` |

---

## 7. Dev-only endpoints

The following are wired **only** in `local-sessions/vite-plugin.ts`; production
`server.ts` does not expose them (G10.2). Requests to a production instance
return 404 `ROUTE_NOT_FOUND`:

| Endpoint | Description |
|----------|-------------|
| `/api/cdp/start` `/api/cdp/stop` `/api/cdp/status` | CDP capture control |
| `/api/cdp/targets` | list connectable Electron targets |

> v4 known gap: CDP is dev-only. v5 keeps that but **must expose a
> `devOnly: string[]` field in the `/api/health` response** listing the
> dev-only routes the current instance does not provide, so the frontend never
> fails silently.

---

## 8. Contract tests

The following tests must exist in `server/server.test.ts` as executable API
contract acceptance:

```ts
describe('API contract', () => {
  it('session list does not leak the systemPrompt body', async () => {
    const r = await get('/api/sessions?limit=10');
    for (const item of r.items) {
      expect(item).not.toHaveProperty('systemPrompt');
      expect(typeof item.hasSystemPrompt).toBe('boolean');
    }
  });

  it('detail defaults to slim and contains no body', async () => {
    const r = await get(`/api/sessions/${key}`);
    expect(r.mode).toBe('slim');
    for (const e of r.events) {
      expect(e).not.toHaveProperty('inputSummary');
      expect(e).not.toHaveProperty('raw');
    }
  });

  it('proxy list excludes all body columns', async () => {
    const r = await get('/api/proxy/requests?limit=5');
    for (const item of r.items) {
      for (const col of ['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody']) {
        expect(item).not.toHaveProperty(col);
      }
    }
  });

  it('all errors use the unified envelope', async () => {
    const r = await getRaw('/api/sessions/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('agent-overview returns all providers in one request', async () => {
    const r = await get('/api/agent-overview');
    expect(Array.isArray(r.rows)).toBe(true);
    expect(typeof r.stamp).toBe('string');
  });

  it('production instance does not expose dev-only routes', async () => {
    const r = await getRaw('/api/cdp/status');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('mission returns all sections in one request with criteria on every widget', async () => {
    const r = await get('/api/mission?range=all');
    expect(r.meta.widgetCount).toBeGreaterThan(0);
    expect(typeof r.meta.stamp).toBe('string');
    const widgets = [
      ...Object.values(r.usage),
      ...Object.values(r.quality),
      ...Object.values(r.health),
    ] as Array<{ criteria: string; available: boolean; unavailableReason: string | null; data: unknown }>;
    for (const w of widgets) {
      expect(typeof w.criteria).toBe('string');
      expect(w.criteria.length).toBeGreaterThan(0);
      if (w.available === false) {
        expect(w.data).toBeNull();
        expect(w.unavailableReason).not.toBeNull();
      }
    }
  });

  it('mission validates range and tz params', async () => {
    const bad = await getRaw('/api/mission?range=99d');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ENUM');
  });
});
```
