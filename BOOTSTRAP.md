# BOOTSTRAP.md — 0-1 development plan

> 13 milestones (M0-M12). Each milestone is independently acceptable and
> independently committable. **No skipping.** The dependency order is driven
> by "downstream needs upstream types"; skipping causes massive rework.

## Overview

| M | Module | Output files | Estimate | Key risk |
|---|--------|--------------|----------|----------|
| M0 | scaffold | ~12 | half day | better-sqlite3 compilation |
| M1 | trace-model | 2 | half day | writing out the full enums |
| M2 | storage base | 6 | 1 day | index and column constants |
| M3 | storage queries | 5 | 1 day | slim/full three-tier split |
| M4 | watch incremental gate | 5 | 1 day | fingerprints must cover `-wal` |
| M5 | adapters ×9 | 20 | 2-3 days | token semantics max vs sum |
| M6 | scanners ×9 | 14 | 2 days | path expansion + parallel circuit breaker |
| M7 | realtime | 5 | half day | event coalescing |
| M8 | HTTP server | 8 | 1 day | error envelope + gzip |
| M9 | core analysis | 8 | 1-2 days | two-pass phase algorithm |
| M10 | frontend | ~25 | 3-4 days | virtual scrolling + local patches |
| M11 | proxy / frida / trae | ~18 | 3-5 days | environment-heavy |
| M12 | CLI / build / packaging | 8 | 1 day | three-stage order |

M0-M10 complete gives a **fully usable scan-only version**. M11 is an
incremental capability that can be deferred.

---

## M0 · Scaffold

**Goal**: `npm run dev` starts, `npm test` runs (0 tests passing also counts),
and `npm run build` passes all three stages.

**Output**
```
package.json  tsconfig.json  tsconfig.app.json  tsconfig.node.json
vite.config.ts  vite.cli.config.ts  vitest.config.ts  eslint.config.js
.gitignore  index.html  src/main.tsx  src/App.tsx (empty shell)
bin/agent-observe.js  server/cli.ts (empty shell)  server/server.ts (only /api/health)
src/test/setup.ts
config/local-sessions.example.json  config/session-groups.example.json
```

**Acceptance**
- `npm run typecheck` green
- `npm run dev` starts; the browser shows a blank page with no errors
- `curl 127.0.0.1:4173/api/health` returns `{ok:true,...}`
- `npm run build` passes all three stages; `server-dist/cli.js` exists

**Note**: better-sqlite3 needs the MSVC toolchain on Windows. Confirm it
installs at M0; don't defer it to M2.

---

## M1 · trace-model

**Depends on**: none
**Read**: `contracts/data-model.md` in full, `specs/trace-model/spec.md`

**Output**
```
src/core/trace-types.ts       ← implement contracts/data-model.md verbatim, all types and constants
src/core/trace-types.test.ts  ← type-level assertions from contracts/data-model.md §11
```

**Acceptance**
- the three constant arrays `TRACE_PHASES` / `TRACE_KINDS` / `PROVIDER_KEYS`
  have lengths 6 / 11 / 9 respectively
- type-assertion tests all green
- **zero runtime logic** — this file only contains types and constants
- [x] remove `passWithNoTests` from vitest.config.ts; `npm run test` stays
  green after removal

---

## M2 · storage base (schema + writers)

**Depends on**: M1
**Read**: `contracts/database.md` in full, `specs/storage/spec.md`
REQ-001~005 / 010~013 / 016~017

**Output**
```
server/storage/schema.ts          SCHEMA_SQL + INDEX_SQL + SCHEMA_VERSION + initSchema
server/storage/db.ts              openWritable / openReadonly / checkpointWal
server/storage/columns.ts         the four §5.2 column constants
server/storage/writers.ts         upsertSessionFrom* / upsertEvents (differential) / upsertMetrics / deleteSession
server/storage/retention.ts       proxy_requests retention cleanup
server/storage/*.test.ts
```

**Acceptance**
- DB creation idempotent: calling `initSchema` 3 times has no side effects
- all 8 PRAGMAs take effect (`db.pragma('journal_mode')` returns `wal` etc.)
- `upsertEvents` differential test: 347 existing events, append 1 →
  **exactly 1 INSERT**
- index assertions: `EXPLAIN QUERY PLAN` for the three core queries contains
  no `USE TEMP B-TREE`

---

## M3 · storage queries (three tiers + aggregation)

**Depends on**: M2
**Read**: `specs/storage/spec.md` REQ-006~009 / 014~015, `contracts/api.md` §1-2

**Output**
```
server/storage/query-engine.ts    listSessions (keyset pagination) / getSessionDetail (three tiers + pagination)
                                  / getEventDetail / getSystemPromptForSession / listProxyRequests
server/storage/detail-cache.ts    LRU, 24 entries
server/storage/overview.ts        getAgentOverview (two GROUP BY SQLs + stamp cache)
server/storage/*.test.ts
perf-diag/                        port the 7 scripts from the reference diagnostic report
```

**Acceptance**
- slim-tier event objects **do not contain** `inputSummary` / `outputSummary`
  / `raw`
- session list items **do not contain** `systemPrompt`; they contain the
  `hasSystemPrompt` boolean
- `getAgentOverview` issues only two SQL statements; cache hit when `stamp`
  unchanged
- **`PERF-BASELINE.md` is created from here**

---

## M4 · watch incremental gate

**Depends on**: M2
**Read**: `specs/session-scanning/spec.md` REQ-001~003 / 008 / 013~018,
`gotchas.md` G11.5 / G11.15

**Output**
```
server/watch/fingerprint.ts    fingerprintFile (size + first/last 4KB) + WAL dual-file fingerprint
server/watch/scan-gate.ts      shouldRescan / commitScanState
server/watch/jsonl-reader.ts   readJsonlFrom (streaming + byte offset)
server/watch/prewarm.ts        backgroundPrewarm (yield + give way)
server/watch/*.test.ts
```

**Acceptance**
- no-change rescan: **0 SQL write statements**; bytes read < 8KB per file
- `scan_state` row count > 0 after the first scan (regression guard)
- WAL fingerprint test: changing only the `-wal` file is still detected
- JSONL incremental: appending a line reads only the tail; `endOffset`
  advances correctly
- truncated files fall back to full reads

---

## M5 · adapters ×9

**Depends on**: M1
**Read**: `specs/adapters/spec.md` in full, `gotchas.md` chapter 4 + chapter 9

**Output**
```
src/adapters/sample-loader.ts
src/adapters/claude-code.ts  codeagent.ts  codex.ts
src/adapters/opencode.ts (incl. OpenCodeDialect)  codearts.ts  codeagent2.ts
src/adapters/trae.ts  qoder.ts  workbuddy.ts
+ one .test.ts per adapter
src/adapters/__fixtures__/    one minimal fixture per provider
```

**Suggested order**: `opencode.ts` first (reused by 3) → `claude-code.ts` →
the rest.

**Acceptance (at least 5 cases per adapter)**
1. full TraceRecord snapshot of a minimal fixture
2. **token aggregation semantics**: OpenCode-family `cacheRead` uses max, the
   rest use sum; `reasoning` always sum
3. `total = input + output + reasoning + cacheRead` (no cacheWrite)
4. four-class status normalization
5. `:{sequence}` suffix for duplicate event ids
6. `title` truncated to 200 chars; `raw` and body returned separately

> ⚠️ Translation note: acceptance item 2 is **stale**. The 2026-08-03
> calibration (see `contracts/data-model.md` §2, `openspec/gotchas.md` G4.4,
> and `specs/adapters/spec.md` REQ-002) established that OpenCode/CodeArts/
> CodeAgent2 `cacheRead` is **incremental per step and uses sum**, not max.
> Contract wins per AGENTS.md priority.

---

## M6 · scanners ×9

**Depends on**: M4, M5
**Read**: `specs/session-scanning/spec.md` REQ-004~012

**Output**
```
local-sessions/config.ts          three-layer override + path expansion + atomic writes
local-sessions/session-key.ts     sessionKey(provider, id, sourcePath)
local-sessions/claude.ts codex.ts opencode.ts codearts.ts codeagent2.ts
                          codeagent.ts workbuddy.ts trae.ts
local-sessions/trae-bridge.ts     spawn + Promise (**not spawnSync**)
server/watch/scan-scheduler.ts    parallelism + timeout circuit breaker + two-phase startup
+ tests
```

**Acceptance**
- path expansion: all three syntaxes (`~` / `~\` / `%VAR%`)
- providers scan in parallel; a single provider timing out at 30s is skipped
  without blocking others
- `initialScanAndStore` index phase < 3s @ 1500 files
- `prewarmRecent` defaults to 0
- Trae with a missing key returns `TRAE_KEY_MISSING`, never silently skipped

---

## M7 · realtime

**Depends on**: M2
**Read**: `specs/realtime/spec.md` in full, `contracts/data-model.md` §10

**Output**
```
server/realtime/event-bus.ts    TypedEventBus
server/realtime/coalescer.ts    queueSessionChange (200ms window + unref)
server/realtime/sse.ts          addSseClient / heartbeat / cleanup
server/realtime/frontline.ts    markForegroundRequest / isForegroundBusy
+ tests
```

**Acceptance**
- 524 `queueSessionChange` calls within 200ms → **at most 10** emitted
  `sessions_changed` events
- timers `unref()`; the process can exit normally (verify `vitest --run`
  doesn't hang)
- all subscriptions removed after client disconnect (no memory leaks)

---

## M8 · HTTP server

**Depends on**: M3, M7
**Read**: `contracts/api.md` in full

**Output**
```
server/http/router.ts          path matching (incl. :param)
server/http/send-json.ts       gzip decision + content-length
server/http/error-envelope.ts  ApiError + error code constants
server/server.ts               createAgentObservabilityServer + all routes
server/server.test.ts          the six contract tests from contracts/api.md §8
```

**Acceptance**
- the six `contracts/api.md` §8 contract tests all green
- responses >= 1KB with `accept-encoding` containing gzip → carry
  `content-encoding: gzip` and `vary`
- all non-2xx responses use the unified envelope
- every request calls `markForegroundRequest()`

---

## M9 · core analysis

**Depends on**: M1
**Read**: `specs/metrics-analysis/spec.md` in full, `gotchas.md` G4.1 /
G10.4 / G7.6

**Output**
```
src/core/phase-classifier.ts   two-pass algorithm + ACTION_PHASE table + classifyBashCommand
src/core/metrics.ts            computeMetrics + METRICS_CALC_VERSION
src/core/speed-metrics.ts      TTFT / TPS / TPOT / E2E / turnGap / pureInferenceMs
src/core/token-breakdown.ts
src/core/report-html.ts        buildTraceReportHtml (large JSON via external .js)
src/core/compare-report.ts
+ tests
```

**Acceptance**
- phase classification: bash test command → verify; file write after error →
  debug
- `pureInferenceMs` takes `InferHub.inference_duration`, not Kernel-Inference
- **consistency test**: SQL aggregation vs per-session `computeMetrics`
  averaged; difference < 0.001
- report HTML never inlines large JSON

---

## M10 · frontend

**Depends on**: M8, M9
**Read**: `specs/frontend/spec.md` in full, `gotchas.md` chapter 7

**Suggested split into 4 subtasks**:

- **M10a shell**: `App.tsx` five-view switching + SSE integration + two-layer
  cache + i18n
- **M10b list & tree**: `SampleRail` + `TraceGanttTree` (**both virtual
  scrolled**) + `PhaseTiles`
- **M10c detail & aggregation**: `EventInspector` (right side, draggable,
  single-event drill-down) + `AgentOverview` (**1 request**)
- **M10d compare & settings**: `CompareBoard` family + `SettingsModal` + two
  modals

**Acceptance**
- Agent view network-panel request count **= 1**
- opening a 9,590-event session: DOM nodes < 500, first paint < 200ms
- SSE `sessions_changed` triggers exactly one batched patch request, **no
  full refetch**
- the two i18n locales have exactly aligned keys (test asserts
  `Object.keys(zh)` equals `Object.keys(en)`)

> Note: `SampleRail` / `TraceGanttTree` were renamed to `SessionList` /
> `TraceTimeline` in the frontend redesign (see the archived
> `redesign-frontend-views` change).

---

## M11 · proxy / frida / trae decryption

**Depends on**: M8
**Read**: `specs/proxy-capture/spec.md`, `specs/trae-decryption/spec.md`,
`specs/desensitization/spec.md`

**Output**
```
server/desensitization/rules.ts + engine.ts
server/proxy/ca-manager.ts mitm-proxy.ts request-context.ts sse-accumulator.ts
server/proxy/parser-router.ts + parsers/{openai,anthropic,trae-tunnel}.ts
server/proxy/proxy-writer.ts cdp-capture.ts frida-capture.ts
scripts/trae-extract-key.py frida-chat-monitor-v2.js frida-check-module.js
```

**Heavily environment-dependent; mark as "generated but not end-to-end
verified"**: Frida / Trae decryption needs Windows + a specific Trae version +
Python `sqlcipher3`. Have the agent write unit tests rather than integration
tests when there is no real environment; **do not let it mock the real logic
to make integration tests green.**

**Acceptance**
- all 10 desensitization rules have cases; global regexes reset `lastIndex`
  every time
- `keepRawBodies` defaults to false
- the proxy list endpoint returns no body columns
- decryption uses async `spawn`; never on the request path; result cache
  fingerprints cover `-wal`

---

## M12 · CLI / build / packaging

**Depends on**: everything
**Read**: `specs/cli-build/spec.md` in full

**Output**
```
server/cli.ts (full arg parsing)  bin/agent-observe.js
scripts/generate-local-samples.mjs  scripts/pack-binary.mjs
PERF-BASELINE.md  README.md
```

**Acceptance**
- `--prewarm-recent` defaults to 0; warns on stderr when > 100
- all 5 startup self-check steps run and print a summary
- three-stage build passes; the Windows launcher in `dist-binary/` is `.ps1`,
  not `.bat`
- **every budget in `contracts/nfr.md` §2 is met** (final acceptance)

---

## Global acceptance checklist

Check one by one after M12:

- [ ] first screen at 10s / 60s / 180s after startup all < 100ms
- [ ] worst session (9,590 events) detail < 60ms / < 1.5MB
- [ ] Agent Overview 1 request / < 80KB / < 400ms
- [ ] total requests in a 30s window < 15
- [ ] no-change rescan: 0 SQL statements
- [ ] `scan_state` non-empty
- [ ] event-loop delay p99 < 50ms
- [ ] steady-state DB + WAL < 200MB
- [ ] `npm run typecheck && test && lint` all green
- [ ] grep self-check against each of the ten prohibitions in `AGENTS.md`
