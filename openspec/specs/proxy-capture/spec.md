# Spec: Proxy Capture

> 三种实时捕获：MITM 代理 + CDP + Frida 堆扫描。源文件：`server/proxy/`

## Purpose

实时拦截 Agent 的 HTTP 流量、浏览器 DevTools 协议、内存堆，捕获 system prompt、token usage、模型名等 scan 拿不到的数据。

## Requirements

### MITM 代理

### REQ-001: HTTPS CONNECT 拦截
`mitm-proxy.ts` SHALL 处理 Plain HTTP（转发 + 捕获）与 HTTPS CONNECT（生成 per-domain TLS 证书 → 本地 TLS server 解密 → 转发真实 HTTPS → 捕获）。

### REQ-002: CA 证书管理
`ca-manager.ts` SHALL 首次运行生成自签名 root CA，存到配置目录，按需生成 per-domain 证书（CSR + CA 签名 + SAN），内存缓存 + 持久化到 `proxy-certs/`。

#### Scenario: OpenSSL 不可用
- **GIVEN** 系统 PATH 中没有 `openssl`
- **THEN** MUST 用 node-forge 兜底生成
- **AND** v4 声称有兜底但**实际未实现**，v5 必须补全

### REQ-003: SSE 流式捕获与服务端节流
content-type 含 `text/event-stream` 时 SHALL 通过 `appendChunk()` 累积。`proxy_stream_chunk` 事件 MUST 按 100ms 窗口拼接后发出，MUST NOT 逐 chunk 发射。

### REQ-004: 脱敏与 raw 保留
request/response body 存储前 MUST 脱敏。脱敏开启时 raw 原文存入 `raw_request_body` / `raw_response_body`。

#### Scenario: raw 保留的开关
- **GIVEN** 配置项 `keepRawBodies` 为 false（默认）
- **THEN** MUST NOT 写入 raw 列
- **AND** 双份存储会让 proxy_requests 体积翻倍，且明文入库与脱敏初衷相悖，因此默认关闭

### REQ-005: system_prompt_len 冗余列
写入 `system_prompt` 时 MUST 同时写 `system_prompt_len = LENGTH(system_prompt)`，供时间窗口关联查询用索引排序。

### REQ-006: TTNet 检测
`request-context.ts` SHALL 检查 `x-tt-encrypt-*` 头，设 `ttnetEncrypted` 标志。

### REQ-007: 代理控制 API
端点定义见 `contracts/api.md` §4。`/api/proxy/requests` MUST 排除全部 4 个 body 列与 system_prompt 正文。

### REQ-008: parser-router 主机名路由
`parser-router.ts` SHALL 按 hostname 路由：`api.openai.com` / `api.anthropic.com` / `openai.azure.com` → 对应 parser；ByteDance 域 → openai parser；`console.enterprise.trae.cn` → traeTunnelParser；无精确匹配时按关键词启发式（openai / gpt / claude / trae / siliconflow / bytedance / huawei）。

### REQ-009: token 与 system prompt 提取
parser SHALL 从 request body 提取 model，从 SSE chunk 或 JSON response 提取 token usage（OpenAI 用 `prompt_tokens` / `completion_tokens`，Anthropic 用 `input_tokens` / `output_tokens`）。system prompt 从 `messages[role='system']` 提取，JSON parse 失败时降级为字符串扫描。

### REQ-010: SSE accumulator
`sse-accumulator.ts` SHALL 提供 `parseSseChunk(chunk)` 返回 SseEvent[]，`extractTokenUsageFromSse(events)` 扫描 usage 字段。

### REQ-011: request-context 生命周期
`RequestContext` SHALL 跟踪单请求：`requestId`（`req-{timestamp}-{counter}`）、method、url、hostname、headers、body、startedAt、responseStatus、chunks[]、ttnetEncrypted。`completeRequest(ctx)` 算 durationMs 与最终 body。

### CDP 捕获

### REQ-012: CDP 连接
`cdp-capture.ts` SHALL 连接 Electron 远程调试端口（默认 9222）via WebSocket，enable `Network` 与 `Page`，`loadingFinished` 时 `getResponseBody`，每 10 秒重新发现 targets。

#### Scenario: 仅 dev 模式
- **GIVEN** 生产 `server.ts`
- **THEN** CDP 路由不暴露，请求返回 404 `ROUTE_NOT_FOUND`
- **AND** `/api/health` 的 `devOnly` 字段 MUST 列出这些路由，避免前端静默失败

### Frida 捕获

### REQ-013: Frida 堆扫描
`frida-capture.ts` SHALL spawn `frida -p <PID> -l <script.js>`，解析结构化 stdout（`[NEW CHAT DATA]` / `[HEX]` / `[END]` 标记），存 `frida_captures` 表，emit `frida_capture` 与 `frida_status`。

MUST 用 `spawn` 异步方式，MUST NOT 用 `spawnSync`。

### REQ-014: 自动发现 target
`discoverFridaTarget()` SHALL 用 `tasklist` 找 Trae CN.exe PID，用最小 Frida 脚本探测 `ai_agent.dll` 是否加载（`[AI_AGENT_FOUND]` 标记）。未找到返回 409 `FRIDA_TARGET_NOT_FOUND`。

### REQ-015: monitor 模式
Frida MUST 用 monitor 脚本（持续监听），MUST NOT 用一次性 scan 脚本。Rust heap 碎片化导致一次性扫描抓不全。

## Gotchas
- G3.1：dev URL 必须 127.0.0.1（华为代理 ProxyOverride 不含 localhost）
- G3.2：MITM 需用户信任 CA 证书
- G3.3：node-forge 兜底 v4 未实现，v5 必须补全
- G6.2：TTNet body 无法 MITM 解密
- G6.3：Frida Rust heap 碎片化，用 monitor 模式
- G6.4：Electron 字符串要处理 UTF-16LE
- G6.5：CDP 对 Trae 无效（TTNet 不走 Chromium Network domain）
- G10.2：CDP 路由只在 dev 模式
- G11.12（新）：`proxy_requests` 是增速最快的表，长期开启采集时必须走保留策略，否则会成为下一个 320MB
