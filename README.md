# AwesomeTelemetry

**English** | [简体中文](README.zh-CN.md)

Local web UI that reads and analyzes session traces from 9 AI coding assistants
(Claude Code / Codex / OpenCode / CodeArts / CodeAgent / CodeMate / Trae CN /
Qoder / WorkBuddy), scored across four dimensions: **Speed · Accuracy ·
Stability · Cost**. Data comes from local file scanning (`scan`) plus optional
live capture via MITM / CDP / Frida (`proxy`).

## Quick start

```bash
npm install        # requires Node >= 20; Windows needs the MSVC toolchain (better-sqlite3)
npm run build      # three-stage build: tsc -b → vite build → server-dist
npm start          # production: node bin/agent-observe.js
```

In production, `npm start` serves both the API and the built frontend. Open
`http://127.0.0.1:4173/` in your browser (G3.1: use 127.0.0.1, not localhost —
corporate proxies may intercept it).

Development mode (separate frontend/backend with HMR):

```bash
Terminal 1: npm start          # backend API at http://127.0.0.1:4173/
Terminal 2: npm run dev        # Vite at http://127.0.0.1:5173/, /api proxied to 4173
```

`npm run dev` only starts the Vite frontend (port 5173); the backend must be
started separately with `npm start`, otherwise `/api/*` requests will fail to
proxy.

## CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--host <host>` | `127.0.0.1` | bind address |
| `--port <port>` | `4173` | HTTP port |
| `--no-open` | open | do not auto-open the browser |
| `--config-root <path>` | cwd | config directory |
| `--db-path <path>` | `<config-root>/awesome-telemetry-data/observe.sqlite` | SQLite path（旧目录 `agent-observe-data` 存在且新目录不存在时自动沿用，见下） |
| `--proxy-port <port>` | `7779` | MITM port |
| `--enable-proxy` | false | start MITM on launch (P-3: not E2E-verified on macOS) |
| `--prewarm-recent <n>` | `0` | prewarm the most recent N sessions; 0 = fully on demand (>100 warns on stderr) |
| `--proxy-retention-days <n>` | `30` | proxy_requests retention days; 0 = never purge |
| `--no-gzip` | off | disable response compression (debug only) |

Startup runs a 5-step self check: schema init/version → key index rebuild →
WAL checkpoint → proxy retention cleanup → startup summary
(schemaVersion / session count / DB+WAL size).

## Trae CN SQLCipher decryption

Trae CN encrypts its local database with SQLCipher. `scripts/trae-extract-key.py`
handles both halves:

- **Key extraction** (Windows): scans the memory of the running `Trae CN.exe`
  process (`OpenProcess` + `VirtualQueryEx` + `ReadProcessMemory`) for the
  `PRAGMA key = x'...'` pattern and saves the 64-character hex key with
  `--save`.
- **Decryption** (cross-platform): `--decrypt <db> --key <key-file> --out
  <plain.db>` copies `db` + `-wal` + `-shm`, opens the copy with `sqlcipher3`,
  runs `PRAGMA wal_checkpoint(FULL)`, then exports a plaintext SQLite file via
  `sqlcipher_export`. Requires the `sqlcipher3` Python package.

The scanner runs decryption through an async `spawn` bridge with a 30s
fingerprint cache (`local-sessions/trae-bridge.ts`) and never blocks the HTTP
event loop. Configure the key file via `traeKeyPath` in the local session
config; if the key is missing the provider reports `TRAE_KEY_MISSING`.
Trae default paths: `%APPDATA%\Trae CN\ModularData\ai-agent` on Windows,
`~/Library/Application Support/Trae CN/ModularData/ai-agent` on macOS.

Real SQLCipher end-to-end coverage is available locally with:

```bash
TRAE_TEST_PYTHON=/path/to/python-with-sqlcipher3 npm run test -- local-sessions/trae-bridge.test.ts
```

## Directory layout

```
server/           backend (http / storage / realtime / watch / proxy / desensitization)
local-sessions/   config + 9 scanners + trae-bridge
src/              React frontend + core analysis + adapters + generated (machine-generated)
openspec/         specs and contracts (source of truth)
perf-diag/        7 performance diagnostic scripts
```

## Performance baseline

Starting at M3, every milestone merge runs the baseline and appends the numbers
to `PERF-BASELINE.md`:

```bash
npm run perf:check     # runs the 7 perf-diag scripts sequentially (synthetic reference data)
```

Any column degrading more than 20% vs the previous row blocks the commit unless
the trade-off is documented in the commit message.

## Build & packaging

```bash
npm run build          # three stages: tsc -b → vite build → server-dist (cli.js)
npm run pack:binary    # scripts/pack-binary.mjs → dist-binary/
```

`pack-binary` copies `server-dist/` + `dist/` + `bin/` + node_modules +
package.json and generates platform launchers: `agent-observe.ps1` (UTF-8) on
Windows, `agent-observe.sh` on Unix.

## Scripts

- `npm run gen:samples` — generates `src/generated/local-samples.ts`
  (offline fallback samples; supports `--claude-source=` / `--opencode-db=` or
  the same env vars)
- `scripts/trae-extract-key.py` — Trae SQLCipher key extraction (Windows) and
  decryption (cross-platform, sqlcipher3)
- `scripts/frida-*.js` — Frida monitor / module probe (Windows + Trae, P-3)

## Docs & acceptance

- Specs and contracts: `openspec/` (authoritative for types / DDL / API / perf budget)
- Milestone progress: `PROGRESS.md`; pending decisions: `DECISIONS-PENDING.md`
- Gate before every commit: `npm run typecheck && npm run test && npm run lint`
