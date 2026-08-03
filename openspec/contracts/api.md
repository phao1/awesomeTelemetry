# Contract: HTTP API

> **权威来源。** 所有端点的路径、参数、响应形状、状态码逐字采用。
> 类型引用见 `contracts/data-model.md`。
> 对应源文件：`server/server.ts`（生产）+ `local-sessions/vite-plugin.ts`（dev）

## 0. 通用约定

### 0.1 基础

- Base path：`/api`
- 请求与响应均为 `application/json; charset=utf-8`
- 服务器：纯 Node `http`，不使用 Express/Fastify
- 绑定地址默认 `127.0.0.1`（**不是 localhost**，G3.1）

### 0.2 响应压缩

响应体 ≥ 1024 字节且请求头含 `accept-encoding: gzip` 时，必须以 gzip 返回，并设置：

```
content-encoding: gzip
vary: accept-encoding
```

< 1024 字节的响应不压缩，且必须带 `content-length`。

### 0.3 错误信封

**所有**非 2xx 响应使用统一形状，无例外：

```ts
interface ApiError {
  error: {
    /** 机器可读，稳定不变。见 §0.4 全集。 */
    code: string;
    /** 人类可读，英文。前端负责 i18n。 */
    message: string;
    /** 可选上下文，仅用于调试展示。 */
    details?: Record<string, unknown>;
  };
}
```

示例：

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "No session with key codeagent-abf46f48171c01", "details": { "key": "codeagent-abf46f48171c01" } } }
```

### 0.4 错误码全集

| code | HTTP | 含义 |
|------|------|------|
| `BAD_REQUEST` | 400 | 参数缺失或格式错误 |
| `INVALID_ENUM` | 400 | 枚举值不在允许集合内 |
| `SESSION_NOT_FOUND` | 404 | 会话 key 不存在 |
| `EVENT_NOT_FOUND` | 404 | event id 在该会话中不存在 |
| `PROXY_REQUEST_NOT_FOUND` | 404 | proxy 请求 id 不存在 |
| `ROUTE_NOT_FOUND` | 404 | 路径未注册 |
| `PROVIDER_DISABLED` | 409 | provider 在配置中被禁用 |
| `PROXY_ALREADY_RUNNING` | 409 | 代理已在运行 |
| `PROXY_NOT_RUNNING` | 409 | 代理未运行 |
| `FRIDA_TARGET_NOT_FOUND` | 409 | 未发现 Trae 进程或 ai_agent.dll 未加载 |
| `TRAE_KEY_MISSING` | 412 | Trae SQLCipher 密钥未提取（G6.1） |
| `SCAN_IN_PROGRESS` | 429 | 已有扫描在执行 |
| `INTERNAL_ERROR` | 500 | 未分类异常，`details` 不含堆栈 |
| `DECRYPT_FAILED` | 500 | Python bridge 解密失败 |

### 0.5 分页约定

列表端点统一使用 `limit` + `cursor`（keyset），**不使用 offset**（数据变动时会漏行/重复）：

- `limit`：默认 50，上限 500
- `cursor`：上一页最后一条的 `startedAt`，首页省略
- 响应含 `{ items, nextCursor, hasMore }`，`nextCursor` 为 `null` 表示到底

> 例外：会话内 event 分页用 `offset` + `limit`，因为 `sequence` 连续且不会变动，offset 语义稳定且前端虚拟滚动需要随机跳转。

### 0.6 前台请求标记

**每个** `/api/*` 请求进入时必须调用 `markForegroundRequest()`，供后台预热让路使用（见 `specs/session-scanning` REQ-012）。

---

## 1. 会话

### 1.1 `GET /api/sessions`

会话索引列表。**响应中绝不包含 `systemPrompt` 正文或任何 event。**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` | 数据来源，scan/proxy 分开展示（G7.4） |
| `provider` | `ProviderKey` | — | 可选过滤 |
| `limit` | number | 50 | 上限 500 |
| `cursor` | string | — | 上页末条 `startedAt` |
| `keys` | string | — | 逗号分隔的 key 列表，用于 SSE 后的批量补丁；上限 200 个，超出返回 `BAD_REQUEST` |
| `merged` | `'1' \| '0'` | `'1'` | 是否应用会话合并（见 `specs/session-merge`） |

```ts
// 200
interface SessionListResponse {
  items: SessionIndexEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;          // 当前过滤条件下的总数，来自 COUNT(*)
}
```

> 传 `keys` 时忽略 `limit` / `cursor` / `total`，直接返回匹配项，`hasMore` 恒为 `false`。

**预算**：500 条 < 60KB（gzip 后）、服务端 < 5ms。

### 1.2 `GET /api/sessions/:key`

会话详情。**默认 `mode=slim`。**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `mode` | `'slim' \| 'full'` | `'slim'` | `raw` 不在此端点支持，走 §1.3 |
| `offset` | number | 0 | event 偏移 |
| `limit` | number | 2000 | event 数上限，上限 5000 |

响应：`SessionDetailResponse`（见 `contracts/data-model.md` §5）。

行为要求：

1. 命中 LRU 详情缓存直接返回
2. 未命中且 `sessions.detail_loaded = 0` → 触发一次惰性 `scanAndStoreDetail`
3. 该会话属于需异步解密的 provider（Trae）且解密未完成 → 返回已有索引数据 + `pending: true`，**不阻塞**，解密完成后由 SSE `sessions_changed` 通知
4. key 不存在 → 404 `SESSION_NOT_FOUND`

**预算**：9,590 events 的最差会话 slim 档 < 1.5MB、服务端 < 60ms。

### 1.3 `GET /api/sessions/:key/events/:eventId`

单 event 下钻。EventInspector 点击时调用。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `include` | `'raw'` | — | 带上则从 `event_raw` 表补 `raw` 字段 |

```ts
// 200 → TraceEvent 或 TraceEventRaw
// 404 → EVENT_NOT_FOUND
```

**预算**：< 20ms。

### 1.4 `GET /api/sessions/:key/report`

生成自包含 HTML 报告。

| 参数 | 类型 | 默认 |
|------|------|------|
| `format` | `'html'` | `'html'` |

响应 `text/html`。**大 JSON 必须写入外部 `.js` 文件引用，禁止内联 `<script>var data=...</script>`（G7.6）。**

### 1.5 `DELETE /api/sessions/:key`

级联删除 `events` + `event_raw` + `metrics` + `sessions` + 对应 `scan_state` 行。

```ts
// 200 → { deleted: true, key: string }
```

### 1.6 `POST /api/sessions/:key/rescan`

强制重扫单个会话，绕过 `scan_state` 门禁（`force: true`）。

```ts
// 200 → { key: string, eventCount: number, durationMs: number }
```

---

## 2. 聚合

### 2.1 `GET /api/agent-overview`

**替代 v4 的前端 N+1。** 实测 v4 该视图产生 524 请求 / 299.6MB / 4,732ms。

| 参数 | 类型 | 默认 |
|------|------|------|
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` |

```ts
// 200
interface AgentOverviewResponse {
  rows: AgentOverviewRow[];
  /** 缓存失效键 = MAX(sessions.updated_at)。前端可用于判断是否需刷新。 */
  stamp: string;
  cached: boolean;
}
```

**实现要求**：两条 SQL（会话级聚合 + event 级聚合）在服务端合并，结果按 `stamp` 缓存。前端**不得**为此视图逐会话拉详情。

**预算**：1 个请求、< 80KB、< 400ms（缓存命中 < 20ms）。

### 2.2 `GET /api/providers/status`

```ts
// 200
interface ProviderStatusResponse {
  providers: Array<{
    key: ProviderKey;
    enabled: boolean;
    sessionCount: number;
    lastScanAt: string | null;
    /** Trae 专用：密钥是否就绪 */
    ready: boolean;
    /** ready=false 时的原因码，如 TRAE_KEY_MISSING */
    blockedBy: string | null;
  }>;
}
```

### 2.3 `POST /api/compare`

```ts
// 请求
{ leftKey: string; rightKey: string }
// 200 → { left: SessionDetailResponse; right: SessionDetailResponse; speed: { left: SpeedMetrics; right: SpeedMetrics } }
```

`mode` 固定为 `slim`。对比报告 HTML 走 `GET /api/compare/report?left=&right=`。

---

## 3. 实时

### 3.1 `GET /api/events`（SSE）

`text/event-stream`。连接建立后立即发一条 `connected`。

事件类型与载荷严格对应 `contracts/data-model.md` §10 的 `BusEvents`。

```
event: connected
data: {"serverTime":"2026-08-03T02:38:49.000Z","schemaVersion":1}

event: sessions_changed
data: {"keys":["codeagent-1f07032d5edae5","trae-3fd3ab3a6128c5"],"count":2}

event: scan_completed
data: {"provider":"all","count":524}
```

**强制要求**：

1. `sessions_changed` 由服务端按 **200ms 窗口**合并后发出。**禁止**逐 session 发射 `session_updated`（v4 的做法，实测导致前端 30s 内 508 请求 / 151.2MB）。
2. `proxy_stream_chunk` 由服务端按 **100ms 窗口**拼接后发出，前端不再逐 chunk 渲染。
3. 客户端断开时必须执行 cleanup，解除全部订阅。
4. 每 30s 发一条注释行心跳（`: ping\n\n`）防止代理层超时断连。

**前端消费规则**：收到 `sessions_changed` 后**只做局部 patch**——失效对应 key 的详情缓存，并用一次 `GET /api/sessions?keys=...` 补索引行。**禁止**重拉全量索引。

---

## 4. 代理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/proxy/start` | POST | body `{ port?: number }`；已运行返回 409 `PROXY_ALREADY_RUNNING` |
| `/api/proxy/stop` | POST | 未运行返回 409 `PROXY_NOT_RUNNING` |
| `/api/proxy/status` | GET | `{ running: boolean, port: number \| null, requestCount: number, startedAt: string \| null }` |
| `/api/proxy/requests` | GET | 列表，返回 `ProxyRequestListItem[]`，**排除全部 4 个 body 列与 systemPrompt 正文** |
| `/api/proxy/requests/:id` | GET | 完整 `ProxyRequest`，含 body |
| `/api/ca-cert` | GET | `application/x-pem-file`，下载 CA 证书 |

`/api/proxy/requests` 参数：`limit`（默认 50，上限 500）、`cursor`、`hostname`、`captureMethod`。

---

## 5. Frida

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/frida/start` | POST | body `{ pid?: number }`，省略则自动发现；失败 409 `FRIDA_TARGET_NOT_FOUND` |
| `/api/frida/stop` | POST | |
| `/api/frida/status` | GET | `{ running: boolean, pid: number \| null }` |
| `/api/frida/captures` | GET | 分页列表，`jsonData` 截断至 500 字符 |
| `/api/frida/captures/:id` | GET | 完整记录 |

---

## 6. 配置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config/providers` | GET | 返回合并后的 `LocalSessionConfig` |
| `/api/config/providers` | PUT | 写用户配置层，**必须原子写**（tmp + rename，G2.3）；返回合并后的新配置 |
| `/api/desensitization/rules` | GET | 当前规则集（含 enabled 状态） |
| `/api/desensitization/rules` | PUT | 更新规则；同样原子写 |
| `/api/scan` | POST | body `{ provider?: ProviderKey, force?: boolean }`；已有扫描进行中返回 429 `SCAN_IN_PROGRESS` |
| `/api/health` | GET | `{ ok: true, schemaVersion: 1, uptimeMs: number, dbSizeBytes: number, walSizeBytes: number }` |

---

## 7. dev-only 端点

以下**仅**在 `local-sessions/vite-plugin.ts` 中接线，生产 `server.ts` 不暴露（G10.2）。请求生产实例时返回 404 `ROUTE_NOT_FOUND`：

| 端点 | 说明 |
|------|------|
| `/api/cdp/start` `/api/cdp/stop` `/api/cdp/status` | CDP 捕获控制 |
| `/api/cdp/targets` | 列出可连接的 Electron target |

> v4 已知缺口：CDP 只在 dev 可用。v5 保持现状但**必须在 `/api/health` 响应中暴露 `devOnly: string[]` 字段**，列出当前实例未提供的 dev-only 路由，避免前端静默失败。

---

## 8. 契约测试

以下测试必须存在于 `server/server.test.ts`，作为 API 契约的可执行验收：

```ts
describe('API 契约', () => {
  it('会话列表不泄漏 systemPrompt 正文', async () => {
    const r = await get('/api/sessions?limit=10');
    for (const item of r.items) {
      expect(item).not.toHaveProperty('systemPrompt');
      expect(typeof item.hasSystemPrompt).toBe('boolean');
    }
  });

  it('详情默认 slim 且不含正文', async () => {
    const r = await get(`/api/sessions/${key}`);
    expect(r.mode).toBe('slim');
    for (const e of r.events) {
      expect(e).not.toHaveProperty('inputSummary');
      expect(e).not.toHaveProperty('raw');
    }
  });

  it('proxy 列表排除全部 body 列', async () => {
    const r = await get('/api/proxy/requests?limit=5');
    for (const item of r.items) {
      for (const col of ['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody']) {
        expect(item).not.toHaveProperty(col);
      }
    }
  });

  it('所有错误使用统一信封', async () => {
    const r = await getRaw('/api/sessions/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('agent-overview 单请求返回全部 provider', async () => {
    const r = await get('/api/agent-overview');
    expect(Array.isArray(r.rows)).toBe(true);
    expect(typeof r.stamp).toBe('string');
  });

  it('生产实例不暴露 dev-only 路由', async () => {
    const r = await getRaw('/api/cdp/status');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
```
