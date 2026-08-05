# Spec: Session Scanning

> Local session file scanning: config, scanners, incremental gate,
> file-watcher, scan-scheduler. Source files: `local-sessions/` +
> `server/watch/`

## Purpose

Read the session files each agent leaves on local disk, produce
`SessionIndexEntry`, write to SQLite, and push to the UI in real time.
**Core constraint: do no useless work.** In v4, because `scan_state` was dead,
every round reprocessed 1,514 files / 800.21MB.

## Requirements

### REQ-001: Incremental gate (v5 core)
Before any detail read, MUST first pass through the `shouldRescan(db,
sourcePath)` gate. When the gate decides nothing changed, MUST return directly
— **zero file reads, zero JSON parsing, zero SQL writes**.

#### Scenario: rescan with no changes
- **GIVEN** no source file changed since the last scan
- **WHEN** a full scan round runs
- **THEN** SQL write statement count = 0
- **AND** bytes read < 20MB (stat + 8KB fingerprint probe per file only)
- **AND** time < 2s

> v4 measured: 18,235 SQL statements / rereading 800MB.

### REQ-002: File fingerprints
`fingerprintFile(path)` SHALL return `{ size, mtimeMs, hash }` where hash =
SHA1(size + first 4KB + last 4KB). Constant cost, independent of file size.

#### Scenario: fingerprinting WAL-type databases
- **GIVEN** a provider's `sourceKind` is `sqlite` or `sqlcipher`
- **WHEN** computing the fingerprint
- **THEN** MUST also fingerprint the `-wal` file and concatenate both
- **AND** watching only the main file always reports "unchanged" (the main
  file's mtime never changes in WAL mode)

> This is the correct solution to the G5.2 pitfall. v4 was forced into 30s
> polling only because it never realized it had to look at `-wal`.

### REQ-003: scan_state writes are mandatory
After every successful detail scan, MUST call `commitScanState()`. Write
failures MUST throw; MUST NOT silently catch.

#### Scenario: empty scan_state
- **GIVEN** the first full scan completes
- **THEN** `SELECT COUNT(*) FROM scan_state` MUST be >= source file count
- **AND** v4 measured 0; this is the regression line that must be held

### REQ-004: Three-layer config override
`loadLocalSessionConfig()` SHALL merge in order: built-in defaults →
`config/local-sessions.local.json` (project-level, gitignored) → user config
(`%APPDATA%/agent-observe/agent-observe.json` or
`~/.config/agent-observe/agent-observe.json`). Later wins. User-config writes
MUST be atomic (tmp + rename).

### REQ-005: Path expansion
`expandLocalSessionPath()` SHALL support `~`, `~\`, `%VAR%`.

### REQ-006: Default paths (env preferred)
| Provider | Default path | sourceKind | watchStrategy |
|----------|--------------|------------|---------------|
| claude | `$CLAUDE_CONFIG_DIR/projects` → `~/.claude/projects` | jsonl | chokidar |
| codex | `$CODEX_HOME/sessions` → `~/.codex/sessions` | jsonl | chokidar |
| opencode | `~/.local/share/opencode` (Win: `%APPDATA%/opencode`) | sqlite | poll |
| codearts | `$CODEARTS_HOME` → `~/.codeartsdoer/codearts-data` | sqlite | poll |
| codeagent | `$CAC_HOME/projects` → `~/.cac/projects` | jsonl | chokidar |
| codeagent2 | `~/.local/share/codemate` | sqlite | poll |
| trae | `%APPDATA%\Trae CN\ModularData\ai-agent` | sqlcipher | poll |
| qoder | `~/.qoder` (disabled by default) | jsonl | chokidar |
| workbuddy | `$WORKBUDDY_HOME/projects` → `~/.workbuddy/projects` | jsonl | chokidar |

### REQ-007: Session key generation
`sessionKey(provider, id, sourcePath)` SHALL equal `provider-` plus the first
14 chars of SHA1(`provider:id:sourcePath`). MUST include sourcePath to avoid
key collisions.

**The index phase and the detail phase MUST use the same derived function
`deriveSessionKey(provider, sourcePath, innerId?)` — the two places must never
derive independently** (T-02: the root cause of P0-2):

- JSONL class (one session per file, `innerId` defaulted): stable source id =
  file name; `deriveSessionKey(p, path) == sessionKey(p, basename(path), path)`
- SQLite class (one DB, many sessions, `innerId` = the DB row's session id):
  stable source id = db path + row id;
  `deriveSessionKey(p, path, id) == sessionKey(p, id, path)`

Key constraint: **the index phase can compute it and the detail phase can
compute the same value.** The session id parsed by the adapter only
participates in key derivation in the SQLite multi-session case; JSONL always
uses the file path.

### REQ-008: JSONL tail incremental reads
For `sourceKind` = `jsonl`, `readJsonlFrom(path, startOffset)` SHALL use
`createReadStream({ start })` to stream line by line, returning
`{ rows, endOffset }`.

MUST NOT regex-split the whole file string.

#### Scenario: conditions for falling back to full read
- **GIVEN** any of: `file_size < prevOffset` (file truncated), first-4KB hash
  changed (file rewritten)
- **THEN** MUST fall back to a full parse from offset 0

> Basis: codeagent alone is 948 files / 739.21MB, 92.4% of total source size,
> and JSONL is append-only. In the CPU profile, `RegExp: \r?\n` self time was
> 459.8ms — that was v4's whole-string split implementation.

### REQ-009: SQLite readonly open
`openReadonly(dbPath)` SHALL use better-sqlite3 readonly +
`fileMustExist: true`.

### REQ-010: Scanner behaviors
- **claude.ts** — scans `.jsonl`; sessionId from the first line; title from the
  first user message
- **codex.ts** — scans `.jsonl` + reads `session_index.jsonl` +
  `state_5.sqlite` (threads table) for titles
- **opencode.ts** — supports db / logs / otel sources, customized via the
  `OpenCodeDialect` param. The db source MUST expand by `session` row into N
  sessions (T-03: 1 .db file ≠ 1 session); detail reads also group by session
  and normalize one by one.
- **codearts.ts / codeagent2.ts** — thin wrappers calling opencode.ts with
  different dialects, inheriting the multi-session expansion
- **codeagent.ts** — scans `.jsonl`, filters `file-history-snapshot` rows
- **trae.ts** — see REQ-012
- **workbuddy.ts** — scans `.jsonl` + reads `workbuddy.db` for titles, filters
  `file-history-snapshot`, extracts the user question from `<user_query>`

### REQ-011: Provider parallelism + circuit breaker
`scanLocalSessions()` SHALL scan all enabled providers in parallel, with an
independent timeout per provider (default 30s). Timed-out providers MUST be
skipped and recorded, MUST NOT block others.

### REQ-012: Trae decryption is async
Trae's Python bridge MUST use `spawn` + Promise, MUST NOT use `spawnSync`.

#### Scenario: decryption not on the request path
- **GIVEN** a user requests a Trae session detail but decryption is not done
- **THEN** MUST immediately return existing index data + `pending: true`
- **AND** MUST NOT trigger decryption while handling the request
- **AND** after decryption completes, SSE `sessions_changed` notifies the
  frontend

#### Scenario: decryption result caching
- **GIVEN** the Trae DB and `-wal` fingerprints are unchanged and less than 30s
  since the last decryption
- **THEN** return the cached result directly; MUST NOT spawn the Python
  process

> Basis: in the CPU profile, 4 `spawnSync` calls totaled 6,074ms, 37.5% of CPU.

### REQ-013: Startup flow
`initialScanAndStore(opts)` SHALL run in two phases:
1. **Index phase (synchronous, must be fast)** — directory traversal + light
   metadata only; upsert index; emit `scan_completed`. MUST NOT read details,
   decrypt, or spawn child processes. Time < 3s @ 1,514 files.
   SQLite-class providers (opencode / codearts / codeagent2) MUST expand by
   in-DB session row into N entries with lightweight SQL reading only
   id / title / timestamps (no message/part bodies), < 50ms per DB;
   unreadable .db files (corrupt / wrong provider format) are skipped during
   the index phase without blocking startup (detail phase exposes them via
   provider-level error records). Trae stays at "1 file = 1 entry" granularity
   because SQLCipher needs decryption to read rows (REQ-013 forbids
   decryption in the index phase).
2. **Prewarm phase (optional, off by default)** — `opts.prewarmRecent` defaults
   to `0`. Non-zero runs `void backgroundPrewarm(...)`, MUST NOT `await`.

#### Scenario: no prewarm by default
- **GIVEN** `--prewarm-recent` not specified
- **WHEN** the server starts
- **THEN** first screen at 10s / 60s / 180s after startup is all < 100ms

> Basis: in the A/B experiment the prewarm-off group measured 20 / 19 / 10ms,
> the prewarm-on group 5,884 / 3,896 / 12,399ms — a 200-1240x ratio.
> On-demand reads measured median 1.57ms, P95 12.94ms; prewarm's benefit is
> far smaller than its cost.

### REQ-014: Prewarm yields
`backgroundPrewarm()` MUST check `isForegroundBusy()` (a request within 750ms)
before each session; when busy, loop `await sleep(250)`. Between sessions MUST
`await setTimeout(0)` to yield a full event-loop round.

### REQ-015: Lazy detail loading
`GET /api/sessions/:key` SHALL trigger one synchronous `scanAndStoreDetail`
when `sessions.detail_loaded = 0`, then set `detail_loaded = 1` and write into
the LRU cache.

### REQ-020: Startup self-healing cleanup (T-02)
The startup self-check MUST call `cleanupDuplicateSessionRows()` (only
`data_source = 'scan'`), deleting the three residue classes one by one along
with their events / event_raw / metrics / scan_state rows:

1. old key-mismatch residue: **orphan rows** with `detail_loaded = 0` where a
   `detail_loaded = 1` sibling with the same `source_path` and provider
   exists;
2. JSONL class: rows with `id ≠ deriveSessionKey(provider, source_path)`
   (unreachable residue derived from old adapter ids; rebuilt by the index
   phase while the source file still exists);
3. readable SQLite class (opencode / codearts / codeagent2): **file-level
   pseudo-sessions** with `id == deriveSessionKey(provider, source_path)`
   (since T-03 the index expands by session row and no longer produces this
   key).

Normal unopened sessions (canonical key and no loaded sibling) MUST NOT be
cleaned.

### REQ-016: LRU detail cache
`detail-cache.ts` SHALL provide an LRU capped at 24 entries; hits promote.
`sessions_changed` events MUST invalidate the matching keys' cache entries.

### REQ-017: File watcher
`file-watcher.ts` SHALL use chokidar for `watchStrategy = chokidar` providers
(300ms debounce, `awaitWriteFinish` 500ms stability threshold / 100ms poll,
ignore dotfiles) and 30s polling for `watchStrategy = poll` providers.

### REQ-018: Change event coalescing
The watcher and scheduler MUST report changes through
`queueSessionChange(key)`; the coalescer emits `sessions_changed` on a 200ms
window. MUST NOT emit per-session events.

### REQ-019: vite-plugin (dev mode)
`local-sessions/vite-plugin.ts` SHALL expose the same API routes as production
`server.ts` in dev mode, **additionally** providing CDP capture routes and CA
cert management routes.

### REQ-021: Real titles and event counts in the index phase

`SessionIndexEntry` produced in the index phase SHALL carry a **readable real
title** and the **real `eventCount`**; MUST NOT fake titles with source file
names, MUST NOT fake unknown event counts with `0`.

| Source type | Title source | Event-count source |
|-------------|--------------|--------------------|
| JSONL class (claude / codex / codeagent / qoder / workbuddy) | first **user-role** message's first 120 chars from streaming scan | stream-count the message rows |
| SQLite class (opencode / codearts / codeagent2) | the session row's own title column; if empty, that session's first user message | lightweight `COUNT(*)` |
| Trae (SQLCipher) | `null` + `pending` until decryption is ready, then backfill | same |

Constraints:

1. **MUST NOT read the full body.** JSONL-class only allows streaming until
   the first user message, then stop; MUST NOT load the whole file into
   memory, MUST NOT run the full adapter parse pipeline.
2. Titles MUST skip injected content: system prompts, `<environment_context>`,
   `# AGENTS.md …`, `<system-reminder>`, and IDE-injected context blocks. Take
   the **first thing the user actually said**.
3. Budget: a single JSONL file < 5ms; all sessions of one SQLite DB < 50ms
   (inheriting the T-03 budget).
4. When no title is obtainable (empty session, system-only messages) SHALL
   fall back to `<provider> session · <localized start time>`, MUST NOT fall
   back to the file name.

#### Scenario: first-screen list is recognizable
- **GIVEN** a clean DB never opened, containing claude / codex / opencode
  sources
- **WHEN** calling `GET /api/sessions?limit=50`
- **THEN** every `title` MUST NOT end with `.jsonl` / `.db`
- **AND** every `title` MUST NOT start with `rollout-`
- **AND** `eventCount` MUST > 0 (except genuinely empty sessions)

> **Current measured state (2026-08-04, 38 sessions)**: 34 titles were source
> file names with `eventCount = 0`; opened codex sessions picked up
> `# AGENTS.md instructions for /Users/…` and `<environment_context>` — all
> injected content, not user intent.

### REQ-022: SQLite-class provider detail parsing

The detail phase for `opencode` / `codearts` / `codeagent2` SHALL locate the
specific session by "db path + in-row session id" (per the T-03 expansion) and
parse its events; MUST NOT return `events: []` + empty title.

On parse failure SHALL return an explicit error code (`SESSION_PARSE_FAILED`),
MUST NOT return 200 + empty result — the frontend cannot tell "empty session"
from "parse failure", and the correct UI differs completely.

#### Scenario: an OpenCode session can be opened
- **GIVEN** N real sessions exist in `~/.local/share/opencode/opencode.db`
- **WHEN** requesting `GET /api/sessions/<key>` one by one
- **THEN** every response's `events.length` MUST > 0
- **AND** `session.title` MUST be non-empty

> **Current measured state**: `GET /api/sessions/opencode-7ff9bf5edb628d` and
> `GET /api/sessions/codearts-c79b25e584d002` both returned
> `events: 0` / `title: ""` / `pending: undefined` — 200 but empty.
> T-03 expanded the index phase; the detail phase did not follow.

## Gotchas
- G2.2: three path-expansion syntaxes
- G5.2: db-class providers must poll; **fingerprints must cover `-wal`**
- G6.1: Trae SQLCipher needs a Python-extracted key; the scanner must check
  the key exists first and return `TRAE_KEY_MISSING` when missing
- G10.1: startup prewarm must be non-blocking — v5 further defaults to **no
  prewarm**
- G10.2: CDP routes are dev-only
- G11.5 (new): `scan_state` write failures must throw. v4's silent failures
  left the table empty, making incremental scanning fake with zero alarms
- G11.6 (new): `spawnSync` is absolutely forbidden in single-threaded Node;
  one call eats 1.5-2.3s of the event loop
- **G5.4 (new)**: "index phase must not parse bodies" ≠ "index phase produces
  no titles". Confusing the two produced a screen full of file names
  (REQ-021). The correct solution is to **stream until the first user message
  and stop** — within budget and still getting a title
- **G5.5 (new)**: session titles must skip injected content. Claude/Codex
  first messages are often `# AGENTS.md …`, `<environment_context>`,
  `<system-reminder>` — taking them names every session the same thing
- **G5.6 (new)**: parse failures MUST return an error code, MUST NOT return
  200 + empty array. The frontend cannot distinguish "this session is
  genuinely empty" from "the backend failed to parse", and the correct UI for
  the two differs completely (REQ-022)
