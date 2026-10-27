# Spec: CLI & Build

> CLI entry, build packaging, scripts. Source files: `server/cli.ts` + `bin/`
> + `scripts/` + vite configs

## Purpose

Provide an executable CLI to start the server and package it for binary
distribution.

## Requirements

### CLI

### REQ-001: CLI flags

`agent-observe diagnose --server <loopback-http-origin> --profile <uuid> --revision <n> [--json]` SHALL retrieve the same read-only connection snapshot as Web, before opening any DB/config/scanner. It SHALL not start a listener/Agent or send test/model traffic. Include actionable next steps in human output, preserve the same findings in JSON, refuse stale revisions and give local-server retry guidance on failure. Exit0 means retrieval without error findings, not Agent certification; exit2 means an error finding; request/validation failure exits nonzero. See api.md §4 for bounds.

`agent-observe launch --server <loopback-http-origin> --profile <uuid> --revision <n> -- [agent arguments...]` is the explicit process-scoped terminal launcher. It pins the reviewed recipe revision, starts/awaits the same monitor listener through its local API, validates the actual CA digest, appends child-only trust/proxy environment, then spawns the Agent directly with inherited terminal stdio in its selected project. It does not open an observability DB, spawn another web server, edit Agent configuration, start a shell, change models/credentials/permissions or stop a shared proxy on child exit. Existing remote/daemon attachment modes are outside this local-process profile. Codex standalone support must be confirmed by bounded --help before adding --no-daemon; never disable a transport. Process/child signal and exit cleanup touches only launcher-owned temporary public CA bundles.
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
| `--proxy-retention-days <n>` | `0` | explicit proxy metadata retention days; 0 = never purge; never implicitly deletes original files |
| `--capture-directory <path>` | auto | independent original body directory |
| `--capture-quota-gb <n>` | `10` | original body file quota in decimal GB; positive fractional values supported |
| `--capture-max-body-mib <n>` | `100` | per-direction body limit in MiB; positive fractional values supported |
| `--no-gzip` | on by default | disable response compression (debug only) |

#### Scenario: prewarm default and warning
- **GIVEN** the user passes `--prewarm-recent` with a value > 100
- **THEN** MUST print a warning on stderr that this significantly slows
  responses for the first minutes after startup
- **AND** the default MUST be 0

### REQ-002: CLI entry

SIGINT/SIGTERM SHALL asynchronously close the shared HTTP server (including its proxy/watcher/own SSE and in-flight work), await startup background prewarm, then checkpoint and close SQLite. Do not force process.exit before writes drain. Failed cleanup retains ownership/database and gives an actionable retry message; startup bind failure also cleans acquired resources. Unix signal integration is tested separately from Windows, which remains platform-unverified.

`--enable-proxy` SHALL actually invoke the shared proxy start control after HTTP startup, using --proxy-port and the configured original body store. A starting-state acceptance is not reported as fully connected Agent traffic.
`bin/agent-observe.js` (`#!/usr/bin/env node`) → imports `runCli` from
`server-dist/cli.js` → `createAgentObservabilityServer()` → listen →
optionally open the browser (open / rundll32 / xdg-open; no shell).

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

Pass the same explicit `--proxy-retention-days` to the shared server's lazy
journal recovery. Uncommitted expired identities are marked before body IO,
not reinserted then bulk-deleted on an HTTP path (storage REQ-017/019).

### Build

### REQ-005: Three-stage build
`npm run build` = `tsc -b && vite build && vite build --config vite.cli.config.ts`

1. **typecheck** `tsc -b` (tsconfig references both app and node sub-configs)
2. **frontend SPA** `vite build` → `dist/`
3. **server entries** `vite build --config vite.cli.config.ts` →
   `server-dist/cli.js`, `capture-worker.js`, `trace-import-worker.js`,
   `codex-worker.js` and required shared chunks, built for Node20. All
   entries/chunks must ship together; workers
   never depend on source TS execution. The normal CLI entry/path is unchanged.

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

Copy the complete server-dist tree including the actual worker and its shared
chunks. Verify the copied worker executes protocol parsing outside the source
checkout, not merely that a worker filename exists.

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


### REQ-011: npm Web distribution
`awesome-telemetry web [options]` SHALL reuse the legacy CLI. Bare options and
`agent-observe` remain compatible. Use existing build outputs only; missing
artifacts fail with build/reinstall guidance. Print the bound address and a
usable host-local URL using the actual listener port (including port 0 and IPv6).
Default bind remains 127.0.0.1. Open locally only after listen; inherited
SSH_CONNECTION/SSH_TTY or --no-open suppress opening. Never infer SSH forwarding.
Browser launching SHALL pass argument arrays without a shell and failure SHALL
leave the server running. Existing API/security/static constraints remain.

The npm files allowlist SHALL include built frontend/server/workers/shared chunks
and optional runtime helper scripts with package-relative paths, excluding local
data, credentials, node_modules and source maps. Pack SHALL validate artifacts
without building. Keep private=true until registry ownership and publication are
separately confirmed; pack/install tests do not publish. Validate the tarball in
a fresh consumer directory without NODE_PATH/NODE_OPTIONS/repository dependencies,
including actual HTTP resources/API, workers, occupied port and graceful exit.
Platform-branch unit tests do not count as actual Windows validation.

### REQ-012: Collection disabled on normal Web startup
The Web CLI defaults to `--enable-monitoring` absent (false) and `--enable-proxy` absent (false). Without monitoring, skip initial session indexing/prewarm, team-source discovery/scanning, and automatic file watchers/polling. Historical data and explicit manual scans remain available. `--enable-monitoring` explicitly restores automatic startup collection. Never infer consent from enabled provider paths.
