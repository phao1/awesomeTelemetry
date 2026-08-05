# Spec: CLI & Build

> CLI entry, build packaging, scripts. Source files: `server/cli.ts` + `bin/`
> + `scripts/` + vite configs

## Purpose

Provide an executable CLI to start the server and package it for binary
distribution.

## Requirements

### CLI

### REQ-001: CLI flags
| Flag | Default | Description |
|------|---------|-------------|
| `--host <host>` | `127.0.0.1` | bind address (**not localhost**, G3.1) |
| `--port <port>` | `4173` | port |
| `--no-open` | open by default | do not auto-open the browser |
| `--config-root <path>` | `process.cwd()` | config directory |
| `--db-path <path>` | auto | SQLite path |
| `--proxy-port <port>` | `7779` | MITM port |
| `--enable-proxy` | false | start MITM on launch |
| `--prewarm-recent <n>` | **`0`** | prewarm the most recent N sessions; 0 = fully on demand |
| `--proxy-retention-days <n>` | `30` | proxy_requests retention days; 0 = never purge |
| `--no-gzip` | on by default | disable response compression (debug only) |

#### Scenario: prewarm default and warning
- **GIVEN** the user passes `--prewarm-recent` with a value > 100
- **THEN** MUST print a warning on stderr that this significantly slows
  responses for the first minutes after startup
- **AND** the default MUST be 0

### REQ-002: CLI entry
`bin/agent-observe.js` (`#!/usr/bin/env node`) → imports `runCli` from
`server-dist/cli.js` → `createAgentObservabilityServer()` → listen →
optionally open the browser (open / `cmd /c start` / xdg-open).

#### Scenario: listen is not blocked by prewarm
- **GIVEN** `--prewarm-recent 50`
- **WHEN** the server starts
- **THEN** `server.listen()`'s callback MUST fire immediately after the index
  phase
- **AND** prewarm runs after it via `void backgroundPrewarm(...)`, MUST NOT be
  awaited

### REQ-003: server factory
`createAgentObservabilityServer(opts)` SHALL return a plain Node HTTP server
(no Express/Fastify) mounting every route defined in `contracts/api.md`.

The request chain is fixed: `markForegroundRequest()` → route matching →
handler → `sendJson()` (incl. gzip decision) → exceptions uniformly converted
to the `ApiError` envelope.

### REQ-004: Startup self check
On startup SHALL run the following in order and give actionable messages on
failure:
1. `initSchema(db)` (idempotent table/index creation); abort if the read
   `schema_version` is higher than the code constant
2. verify the key indexes exist (`contracts/database.md` §4); rebuild if
   missing
3. run one `checkpointWal()`
4. purge expired proxy records per `--proxy-retention-days`
5. print a startup summary: `schemaVersion` / session count / DB and WAL sizes
   / per-provider status

### Build

### REQ-005: Three-stage build
`npm run build` = `tsc -b && vite build && vite build --config vite.cli.config.ts`

1. **typecheck** `tsc -b` (tsconfig references both app and node sub-configs)
2. **frontend SPA** `vite build` → `dist/`
3. **server bundle** `vite build --config vite.cli.config.ts` →
   `server-dist/cli.js` (`ssr: 'server/cli.ts'`)

External deps are not bundled: `better-sqlite3`, `chokidar`, `http-mitm-proxy`,
`node-forge`. Order cannot change.

### REQ-006: Test config
`vitest.config.ts`: jsdom env, globals enabled, setup `./src/test/setup.ts`.
Tests are colocated (`*.test.ts`), never in `__tests__/`.

CI MUST run all performance assertions from `contracts/nfr.md` §5.

### Scripts

### REQ-007: generate-local-samples
`scripts/generate-local-samples.mjs` SHALL read Claude JSONL + OpenCode
SQLite, sanitize paths, and generate `src/generated/local-samples.ts`.
Supports `--claude-source=` / `--opencode-db=` flags or env vars.

### REQ-008: pack-binary
`scripts/pack-binary.mjs` SHALL copy `server-dist/` + `dist/` + `bin/` +
native node_modules + package.json to `dist-binary/` and generate platform
launchers.

The Windows launcher MUST be `.ps1` (UTF-8); MUST NOT use `.bat` (garbles under
Chinese paths).

### REQ-009: trae-extract-key
`scripts/trae-extract-key.py` SHALL extract the Trae SQLCipher key (needs
`sqlcipher3`); `--save` stores it in the config dir.

### REQ-010: keep perf-diag scripts
The 7 diagnostic scripts under `perf-diag/` MUST stay in the repo as regression
baseline tooling. The README SHALL explain how to rerun them and update the
historical baseline table in `PERF-DIAGNOSIS.md`.

## Gotchas
- G1.1: better-sqlite3 needs the MSVC toolchain on Windows
- G1.2: three-stage build order cannot change; server-dist external deps are
  not bundled
- G1.3: Node >= 20 is a hard requirement
- G3.1: CLI default host `127.0.0.1`
- G2.1: Windows launcher for Chinese paths uses `.ps1`
- `src/generated/` must not be hand-edited
- G11.17 (new): `--prewarm-recent` defaults to 0, not some "reasonable"
  value. Any non-zero default reproduces v4's 200-1240x degradation
