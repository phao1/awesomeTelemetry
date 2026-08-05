# Spec: Proxy Capture

> Three kinds of live capture: MITM proxy + CDP + Frida heap scan. Source
> files: `server/proxy/`

## Purpose

Intercept the agent's HTTP traffic, browser DevTools protocol, and memory heap
in real time to capture system prompts, token usage, model names, and other
data scan cannot reach.

## Requirements

### MITM proxy

### REQ-001: HTTPS CONNECT interception
`mitm-proxy.ts` SHALL handle plain HTTP (forward + capture) and HTTPS CONNECT
(generate a per-domain TLS cert → local TLS server to decrypt → forward real
HTTPS → capture).

### REQ-002: CA certificate management
`ca-manager.ts` SHALL generate a self-signed root CA on first run, store it in
the config dir, generate per-domain certs on demand (CSR + CA signature +
SAN), with in-memory cache + persistence in `proxy-certs/`.

#### Scenario: OpenSSL unavailable
- **GIVEN** no `openssl` on the system PATH
- **THEN** MUST fall back to node-forge for generation
- **AND** v4 claimed the fallback but **never implemented it**; v5 must
  complete it

### REQ-003: SSE streaming capture and server-side throttling
When content-type contains `text/event-stream`, SHALL accumulate via
`appendChunk()`. `proxy_stream_chunk` events MUST be emitted after a 100ms
window concatenation, MUST NOT be emitted chunk by chunk.

### REQ-004: Desensitization and raw retention
Request/response bodies MUST be desensitized before storage. When
desensitization is enabled, raw originals go into `raw_request_body` /
`raw_response_body`.

#### Scenario: the raw retention switch
- **GIVEN** config `keepRawBodies` is false (default)
- **THEN** MUST NOT write the raw columns
- **AND** double storage doubles proxy_requests size and puts plaintext in the
  DB, contradicting the purpose of desensitization, so it defaults off

### REQ-005: system_prompt_len redundant column
When writing `system_prompt`, MUST also write `system_prompt_len =
LENGTH(system_prompt)` so the time-window association query can sort by index.

### REQ-006: TTNet detection
`request-context.ts` SHALL check `x-tt-encrypt-*` headers and set the
`ttnetEncrypted` flag.

### REQ-007: Proxy control API
Endpoint definitions in `contracts/api.md` §4. `/api/proxy/requests` MUST
exclude all 4 body columns and the system_prompt body.

### REQ-008: parser-router hostname routing
`parser-router.ts` SHALL route by hostname: `api.openai.com` /
`api.anthropic.com` / `openai.azure.com` → the matching parser; ByteDance
domains → openai parser; `console.enterprise.trae.cn` → traeTunnelParser; no
exact match → keyword heuristics (openai / gpt / claude / trae / siliconflow /
bytedance / huawei).

### REQ-009: token and system prompt extraction
Parsers SHALL extract the model from the request body and token usage from SSE
chunks or JSON responses (OpenAI: `prompt_tokens` / `completion_tokens`;
Anthropic: `input_tokens` / `output_tokens`). The system prompt comes from
`messages[role='system']`; on JSON parse failure, fall back to string
scanning.

### REQ-010: SSE accumulator
`sse-accumulator.ts` SHALL provide `parseSseChunk(chunk)` returning SseEvent[]
and `extractTokenUsageFromSse(events)` scanning usage fields.

### REQ-011: request-context lifecycle
`RequestContext` SHALL track a single request: `requestId`
(`req-{timestamp}-{counter}`), method, url, hostname, headers, body,
startedAt, responseStatus, chunks[], ttnetEncrypted. `completeRequest(ctx)`
computes durationMs and the final body.

### CDP capture

### REQ-012: CDP connection
`cdp-capture.ts` SHALL connect to the Electron remote-debugging port (default
9222) via WebSocket, enable `Network` and `Page`, call `getResponseBody` on
`loadingFinished`, and rediscover targets every 10 seconds.

#### Scenario: dev mode only
- **GIVEN** production `server.ts`
- **THEN** CDP routes are not exposed; requests return 404 `ROUTE_NOT_FOUND`
- **AND** the `devOnly` field of `/api/health` MUST list those routes so the
  frontend never fails silently

### Frida capture

### REQ-013: Frida heap scan
`frida-capture.ts` SHALL spawn `frida -p <PID> -l <script.js>`, parse
structured stdout (`[NEW CHAT DATA]` / `[HEX]` / `[END]` markers), store into
the `frida_captures` table, and emit `frida_capture` and `frida_status`.

MUST use async `spawn`, MUST NOT use `spawnSync`.

### REQ-014: Auto-discover target
`discoverFridaTarget()` SHALL find Trae CN.exe PIDs with `tasklist` and probe
whether `ai_agent.dll` is loaded with a minimal Frida script
(`[AI_AGENT_FOUND]` marker). Not found → 409 `FRIDA_TARGET_NOT_FOUND`.

### REQ-015: monitor mode
Frida MUST use a monitor script (continuous listening), MUST NOT use a
one-shot scan script. Rust heap fragmentation makes one-shot scans incomplete.

## Gotchas
- G3.1: dev URLs must be 127.0.0.1 (Huawei proxy ProxyOverride does not
  include localhost)
- G3.2: MITM requires the user to trust the CA cert
- G3.3: the node-forge fallback was not implemented in v4; v5 must complete it
- G6.2: TTNet bodies cannot be MITM-decrypted
- G6.3: Frida Rust heap fragmentation; use monitor mode
- G6.4: Electron strings need UTF-16LE handling
- G6.5: CDP is useless for Trae (TTNet does not use the Chromium Network
  domain)
- G10.2: CDP routes are dev-only
- G11.12 (new): `proxy_requests` is the fastest-growing table; long-term
  capture must use the retention policy or it becomes the next 320MB
