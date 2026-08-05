# Project: Agent Observability

> Project-level conventions and overview. Per-module behavior specs live in
> `specs/<domain>/spec.md`. **The four contracts for types, DDL, API, and
> performance budget live in `contracts/` — they are the authoritative codegen
> input.** Core pitfalls are in `gotchas.md`.

## 1. Positioning

A local web UI for viewing, analyzing, and comparing session traces of AI
coding assistants (Claude Code / Codex / OpenCode / CodeArts / CodeAgent /
Trae CN / Qoder / WorkBuddy).

Core value proposition: measure agent quality on four dimensions —
**Speed · Accuracy · Stability · Cost**.

| Dimension | Metrics |
|-----------|---------|
| Speed | TTFT / TPS / TPOT / end-to-end latency / avgToolDurationMs |
| Accuracy | verificationCoverage (whether tests ran) |
| Stability | errorRate / enteredDebug |
| Cost | tokensPerStep / costUsd |

Two data sources: **Scan** (reads local session files) and **Proxy**
(MITM + CDP + Frida live capture), shown separately in the UI.

## 2. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node.js >= 20 | hard requirement |
| Language | TypeScript ~6.0.2 | `verbatimModuleSyntax`, `erasableSyntaxOnly`, strict |
| Frontend | React 19.2 + Vite 8 | SPA, no router lib |
| Backend | plain Node HTTP server | no Express/Fastify |
| Storage | better-sqlite3 (WAL, schema v1) | native module, needs MSVC on Windows; fresh DB, no migration |
| File watching | chokidar 5 | 300ms debounce; db providers use 30s polling |
| MITM | http-mitm-proxy 1.1 | HTTPS CONNECT + per-domain certs |
| Crypto | node-forge 1.4 | CA generation (fallback when OpenSSL unavailable) |
| Compression | node:zlib | response gzip, no third-party |
| Tests | Vitest 3 | jsdom env, globals, colocated `*.test.ts` |
| Lint | ESLint 10 flat config | |

Deliberately light: 4 runtime dependencies + an optional frontend virtual
scrolling lib.

## 3. Architecture overview

### 3.1 One-way data flow

```
Raw vendor JSONL / SQLite / SQLCipher
  → incremental gate (scan_state fingerprint)   ← unchanged input stops here, zero IO zero SQL
  → Scanner (local-sessions/)                   produces SessionIndexEntry
  → Adapter (src/adapters/)                     raw data → TraceRecord (slim / body / raw split)
  → Storage (server/storage/)                   sessions + events + event_raw + metrics
  → Core (src/core/)                            phase classification / metrics / reports
  → UI (src/components/)                        Gantt tree / detail panel / compare board
```

### 3.2 Dual data sources

```
scan  : chokidar or 30s poll → incremental gate → scan-scheduler → SQLite → SSE (coalesced) → UI
proxy : MITM / CDP / Frida  → desensitize → proxy-writer → SQLite → SSE (throttled) → UI
```

### 3.3 Three non-negotiable architecture principles

These three are the root cause of all v4 performance problems; v5 promotes them
to architecture constraints:

1. **Do no useless work** — before any read, parse, or write, ask "has this
   changed since last time?". If the answer is "no", the correct behavior is to
   **return immediately**, not "quickly redo it".
2. **No heavy work on the request path** — synchronous file IO, child process
   spawns, and full-table aggregations must never appear in HTTP handlers.
   Return `pending: true` when not ready and let the background fill it in +
   SSE notify.
3. **Transfer size by tier** — lists carry no bodies, details carry no raw,
   bodies load on demand. Data is by default "not returned"; request the tier
   you need explicitly.

## 4. Directory layout

```
agent-observability-main/
├── server/
│   ├── server.ts              # createAgentObservabilityServer() + all API routes
│   ├── cli.ts                 # CLI entry
│   ├── http/                  # send-json (incl. gzip) + error-envelope + route matching
│   ├── proxy/                 # MITM + CDP + Frida + CA + parsers
│   ├── storage/               # schema + writers + query-engine
│   │                          #   + detail-cache (LRU) + overview (aggregation) + session-merge
│   ├── realtime/              # TypedEventBus + coalescer (200ms merge) + SSE + frontline
│   ├── watch/                 # fingerprint + scan-gate + chokidar + poll + scan-scheduler
│   └── desensitization/       # PII desensitization engine
├── local-sessions/            # 9 scanners + config + trae-bridge + vite-plugin(dev)
├── src/
│   ├── App.tsx                # single stateful shell, 5 views
│   ├── adapters/              # 9 provider adapters + sample-loader
│   ├── core/                  # trace-types + phase-classifier + metrics + speed + report
│   ├── components/            # ~20 React components (list and Gantt both virtualized)
│   ├── i18n/                  # zh/en bilingual (incl. error-code copy)
│   └── generated/             # machine-generated, do not hand-edit
├── config/                    # session-groups.json (gitignored) + *.example.json
├── scripts/                   # generate-local-samples + pack-binary + trae-* + frida-*
├── perf-diag/                 # 7 performance diagnostic scripts (regression baseline tooling, kept in repo)
├── bin/agent-observe.js
└── openspec/                  # this spec
    ├── contracts/             # ← authoritative codegen input
    └── specs/
```

## 5. Three-stage build

```
npm run build = tsc -b && vite build && vite build --config vite.cli.config.ts
```

Order cannot change; server-dist does not bundle external dependencies.

## 6. Conventions

- Tests live next to source (`*.test.ts`), never in `__tests__/`
- New i18n strings must be added to both `en` and `zh`
- `src/generated/` is machine-generated; change the generator, not the output
- Config is a three-layer override: built-in defaults → `config/local-sessions.local.json` (gitignored) → user config
- Path expansion supports `~`, `~\`, `%VAR%`
- Do not commit `captured-prompts/`, `captures/`, `compare/`, `*.log` to git
- All external timestamps are ISO 8601 UTC strings
- All non-2xx responses use the unified `ApiError` envelope

## 7. Provider adapter matrix

| Provider | Input source | sourceKind | Watch | Scanner | Adapter | cacheRead semantics | Special handling |
|----------|-------------|-----------|-------|---------|---------|--------------------|------------------|
| Claude Code | JSONL | jsonl | chokidar | claude.ts | claude-code.ts | incremental | — |
| Codex | JSONL | jsonl | chokidar | codex.ts | codex.ts | incremental | reads session_index.jsonl + state_5.sqlite for title |
| OpenCode | SQLite+JSONL+OTel | sqlite | poll | opencode.ts | opencode.ts | **incremental** | dialect param, reused; reasoning counts into total (#6) |
| CodeArts | SQLite | sqlite | poll | codearts.ts | reuses opencode | **incremental** | thin wrapper; reasoning is subset of output, not in total (#6) |
| CodeAgent 2.0 | SQLite | sqlite | poll | codeagent2.ts | reuses opencode | **incremental** | thin wrapper; reasoning not in total (#6) |
| CodeAgent 3.0 | JSONL | jsonl | chokidar | codeagent.ts | codeagent.ts | incremental | wraps claude-code, drops file-history-snapshot |
| Trae CN | SQLCipher | sqlcipher | poll | trae.ts | trae.ts | incremental | needs python key; input = token_usage - item_token_usage; async decryption |
| Qoder | JSONL | jsonl | chokidar | (config only) | qoder.ts | incremental | disabled by default |
| WorkBuddy | JSONL+SQLite | jsonl | chokidar | workbuddy.ts | workbuddy.ts | incremental | function_call ≠ tool_use |

## 8. Scale tier

Designed for **tier B** (measured baseline: 524 sessions / 73,588 events /
800MB source files / 9,590 events in the largest session).
Design ceiling and scale-up signals are in `contracts/nfr.md` §1 and §7.
