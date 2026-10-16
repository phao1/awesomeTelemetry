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
| `--enable-proxy` | false | request MITM startup on launch; a running listener does not prove Agent connectivity |
| `--prewarm-recent <n>` | `0` | prewarm the most recent N sessions; 0 = fully on demand (>100 warns on stderr) |
| `--proxy-retention-days <n>` | `0` | explicit metadata retention; 0 = never purge |
| `--capture-directory <path>` | beside user config | independent original body file store |
| `--capture-quota-gb <n>` | `10` | total original file quota, decimal GB |
| `--capture-max-body-mib <n>` | `100` | per-direction original body limit, MiB |
| `--no-gzip` | off | disable response compression (debug only) |

Startup runs a 5-step self check: schema init/version → key index rebuild →
WAL checkpoint → proxy retention cleanup → startup summary
(schemaVersion / session count / DB+WAL size).

## Original monitoring (fusion branch, in progress)

The Proxy view starts/stops the local listener. Agent traffic must explicitly
use that listener; enabling it does not reconfigure already-running Agents.
Download the actual CA from the view and configure trust for the intended
client if HTTPS interception is needed. No global proxy, system trust or
external process is changed automatically; TLS verification must stay enabled.

Monitoring retains original headers/bodies, including credentials and prompts,
without redaction. Keep the local data directory private. Originals stream to
separate files (10GB total and 100MiB per direction by default); SQLite holds
metadata and at most 64KiB previews per direction. Quota/body/queue failures are
explicit and do not automatically delete older files. Original downloads retain
the captured bytes, encoding and SHA-256, including clearly marked incomplete
prefixes.

Live metadata parsing uses a separate bounded Node worker (64 outstanding
jobs/32MiB source bytes shared across listeners,5s deadline). Parser queue/crash/timeout
and projection-limit outcomes are displayed separately from original-file
completeness; forwarding and retained original downloads remain independent.
Network completion/duration is sampled before queue/flush latency. Ship the
complete `server-dist/` directory, including `capture-worker.js` and shared
`assets/`, not only cli.js. Process-wide preview admission limits64 collectors/
32MiB charged memory and2 live workers including termination. Preview overload
is explicitly resource_limit, without modifying forwarding or accepted original
files. Web shows current resource gauges/lifetime limit counters and observed
bytes omitted from semantic previews. Full load/recovery acceptance is pending.

Realtime subscriptions are limited to64 clients,256KiB/frame and1MiB pending
bytes/client, with a5s drain deadline. Slow clients are individually disconnected
and counted; extra subscribers receive503 SSE_LIMIT_REACHED. Original-file
queues additionally cap4096 pending write operations across their writers, so
tiny fragments cannot evade the existing byte budget. These owned allocation
bounds do not claim whole-process RSS or reconnect/resume certification.

Live capture and on-demand analysis share incremental UTF-8 and streaming
gzip/br/deflate decoding. Encoded and decoded semantic previews each have a
separate2MiB bound; Web body previews remain64KiB. Downloads/digests always
refer to original encoded bytes, not the decoded view. Corrupt/unsupported
encoding, invalid UTF-8 and unterminated SSE frames are explicit decode errors;
EOF alone never dispatches a pending SSE completion/usage event. Context Diff
compares decoded requests while retaining original-byte provenance. These
codec tests do not certify sustained load or full reconnect/recovery behavior.

Request details separately show the observed network outcome (normal end,
HTTP error, native network error/timeout, client cancel or monitor interruption),
metadata processing and original-file completeness. Normal network EOF does not
prove protocol/Agent completion, and a full HTTP error body can still be saved
completely. No implicit request/stream deadline is introduced. Early response
EOF waits for the upload to end; broken downstream responses are aborted rather
than appended with a fabricated upstream error. Offline analysis retains the
observed content/usage but cannot call a broken transport completed. Recorded
native protocol errors are not duplicated or overwritten by later end markers.

Configured capture now keeps a private atomic metadata journal under
`<capture-directory>/.capture-journal/`. Its request/file identity is durable
before new original files are opened, while network forwarding continues.
Observed headers/end flags and terminal clocks/finished refs are checkpointed
asynchronously. SQLite final commits retry only transient locks, at most3
nonblocking attempts; a failed commit sends no saved notification and retains
its journal. Same-request updates coalesce into a bounded latest snapshot.
Limits are64 journal jobs,256KiB/record,4MiB serialized pending metadata and
16MiB retained journal metadata, independently from original-body quotas.

After a process crash, restart with the same DB and capture directory. The
server recovers only journals owned by that DB, verifies actual original
prefixes with streamed SHA-256 and makes them downloadable through the usual
request details. Unknown end time/duration/model/usage stay unknown; missing
terminal evidence is `interrupted / CAPTURE_PROCESS_LOST`, not Agent success.
Durably recorded terminal outcomes and verified finished refs stay unchanged;
unfinished parsing is separately `closed`. Repeated restart cannot duplicate
the capture: both original IDs must match, not only its request ID. A batch
status update corrects counts for clients connected during recovery. No Agent
or tool is replayed, and no original files are automatically deleted. Only the
now-committed journal/scratch metadata is removed. Older unjournaled crash
remnants still count against quota but cannot be guessed into a request.

Corrupt journals/conflicting originals fail visibly with503 `CAPTURE_RECOVERY_FAILED` on
capture queries and retain evidence; health, scan and static routes remain
available. Do not delete the evidence directory to dismiss that error. Server
reports missing originals as `write_error / CAPTURE_BODY_MISSING` (download404),
retaining a previously known size/digest rather than inventing an empty file.
Other original files remain available. Server
shutdown awaits its recovery IO. Actual process-kill/final-commit-failure tests
cover restart/download/idempotence; power loss,30-minute soak and full Web
reconnect recovery are not certified by these tests.

Explicit startup retention now atomically keeps exact request+both-original
deletion markers (schema15). A surviving journal cannot recreate that deleted
capture, even if retention is later disabled or lengthened; another old-clock
observation with different original IDs remains distinct. UTC instant comparisons
retain the exact cutoff and correctly expire earlier times on the same day.
Only matching internal journal metadata is removed: original files remain on
disk/quota, while deleted request/body HTTP URLs return404.

Default `--proxy-retention-days 0` preserves uncommitted old journals too.
An explicit nonzero policy now also expires uncommitted same-DB journals at
recovery admission, before body IO/insertion: each exact marker is written with
bounded yielding retries, then only internal journal metadata is removed. This
does not bulk-delete graphs on the HTTP thread, alter original files or free
their quota. Exact cutoff timestamps remain retained; marker failures preserve
the journal and report recovery failure.
Capture metadata admission now shares a bounded per-DB lane (64 active/queued
actions). It checks actual DB/WAL lengths asynchronously before new journal
admission and final/recovery commits. At 8,000,000 WAL bytes it attempts one
non-waiting checkpoint; a pinned reader cannot cause the old 5-second wait.
It refuses admission at 180,000,000 combined bytes or 8,000,000 WAL bytes,
leaving headroom under the unchanged 200MB/20MB budgets. Existing admitted
journal updates retain their evidence; failed commits keep originals/journals
and do not report saved success. Forwarding continues without rewriting data.

Admission also revalidates SQLite write stamps around async file-size reads:
native writes on the shared connection and observed commits from a second
connection invalidate the snapshot, including after checkpoint. At most three
size snapshots and one non-waiting checkpoint are allowed per action; continued
churn reports CAPTURE_METADATA_UNAVAILABLE without running the capture mutation.
Caller-owned transactions are refused without rollback; state reads restore the
exact busy timeout. This does not throttle/delete native evidence or reserve
space against arbitrary future external writes. Long-term store separation
remains required; a capacity diagnostic is still only a read-only snapshot.

Developer diagnostics: after `npm run build`, run
`node perf-diag/11-capacity-snapshot-ab.mjs --samples 400` for fixed ABBA
HTTP/HTTPS/near2MiB source attribution (default100, bounded100..1000).
Every completed raw run is checkpointed; a later failure retains partial samples
and honest cleanup status. Reference bundles exist only in temporary diagnostic
directories, never a production bypass. `node perf-diag/12-capacity-stamp-profile.mjs`
uses Node's builtin CPU profiler on the actual isolated memory-DB guard; those
microseconds are not HTTP latency, full-app or real-Agent certification.

Schema v17 removes unused wide-index duplication of scoped tool identities:
only unscoped session identities enter the native matching index; every original
identity/value/scope stays in the table and remains available through source
paging. The v16→v17 index/version cutover is atomic and rollback-tested, with no
scan reset, reparse, original-file deletion or data-row rewrite. Exact session
matching uses key-driven index searches even after SQLite ANALYZE. Two large
actually parsed localhost captures (1900 long-scoped and 2046 tool identities,
32 candidate owners each) pass the unchanged WAL/DB/event-loop limits with a
reader pinning WAL near admission. These cases do not certify all possible
transactions, unrelated writers, physical disk-full conditions or real Agents.

`GET /api/proxy/capacity` explicitly reports ready/limited/unavailable, actual
file sizes, thresholds and UTC checkedAt without checkpointing or recovery.
It is not free disk space; unreadable sizes are null, not zero. Original quota
remains separately visible through `/api/proxy/storage`. Pressure-blocked startup
recovery does not prevent reading or explicitly deleting committed evidence;
after pressure relief, start/restart retries unindexed journals. Native
SQLITE_FULL uses a static runtime error and preserves recoverable evidence.

In Web → Proxy → Capture capacity, open the lazy drawer to inspect original
used/quota/remaining/pending/active counts and body limits separately from DB/WAL
file lengths, admission watermarks, hard budgets and server UTC checkedAt.
These are snapshots, not physical free disk space or successful Agent-capture
certification. Each open/manual refresh issues exactly one request per endpoint,
no polling; runtime changes mark a snapshot stale without another request.
Partial errors remain independent; unknown sizes are not zero. Refresh clears
old results and aborts after5s; close cancels owned requests. Keyboard Enter
opens/refreshes, Tab stays inside, Escape returns focus. Runtime updates do not
reset focus; a keyboard refresh returns focus after completion/timeout without
stealing focus that the user moved elsewhere. No clear/checkpoint/start action
is provided here. Original-status reads may resume only previously confirmed
pending deletion, as disclosed in the drawer; they create no new intent.

Full storage management is not finished: unrelated shared-DB writers,
worst-size transaction headroom, physical disk-full faults
and full request management remain task7.3. The old Clear backend route is still absent;
no metadata-only cleanup is presented as freed original-file space.

For development-only capacity-overhead diagnosis, after `npm run build`, run
`node perf-diag/10-capture-capacity-ab.mjs`. It compares production with a
temporary same-source counterfactual (two journal admission checks omitted)
in ABBA order against trusted synthetic HTTPS, retaining raw reports and hashes.
It is not a production bypass option, a whole-old-build comparison, a substitute
for the normal forwarding gate or proof of full-app/physical-disk/soak behavior.

Confirmed per-request BODY deletion is available through the API and Web drawer:

- In Proxy, open one request and use Body retention above its detail tabs.
  Stop monitoring, choose Delete this request’s bodies, check the exact request
  identity/scope, acknowledge the irreversible action, then confirm. Escape
  cancels confirmation and returns focus; no deletion occurs on selection/refresh.
- Status is read only for the selected request. Refresh explicitly after an
  uncertain result; failed/pending cleanup can be retried with confirmation.
  A failure/timeout is not reported as freed space. Submission hides local body,
  analysis/diff caches and original downloads, including late/stale responses;
  headers/timing/association metadata remain visible. Browser/export copies
  already delivered outside this view cannot be recalled.

- `GET /api/proxy/requests/:id/original-deletion` returns its job or JSON null.
- Stop the monitor, then `POST` the same path with exactly
  `{"expectedRequestId":"the-exact-request-id","confirm":true}`.
- Intent, recovery marker and clearing SQLite body/raw/prompt copies commit
  atomically. New body downloads/analysis/diff are blocked even if file cleanup
  fails. Headers, metrics, request/association metadata, native scan sessions
  and existing external exports remain; this is not full/forensic erasure.
- The POST returns the explicit job state, including failed. Retry the same
  confirmed POST after resolving the failure. Pending jobs resume on restart;
  completed cleanup is idempotent. Starts/launches/concurrent deletions conflict
  during maintenance; shutdown waits owned IO. Previously delivered bytes cannot
  be recalled. Original refs retain historical observed capture status/digest.

Schema16's queue retains at most1024 jobs and refuses excess intent instead of
evicting history. File removal is async/bounded, refuses active readers/writers
and recounts surviving bytes after partial failure. Global Clear is not connected
yet. No existing originals are
removed by schema upgrade or ordinary retention; only previously confirmed
pending deletion jobs authorize restart cleanup.

To reproduce the controlled forwarding A/B gate (development dependencies
required):

```bash
npm run build
node perf-diag/09-capture-ab.mjs
# Optional: --out /absolute/path/to/a-new-report.json (never overwrites)
```

`npm run perf:check` also includes this gate; build first so its copied worker
and shared assets match the current source. It runs100 interleaved direct/proxy
pairs at4 concurrency for HTTP, trusted HTTPS CONNECT and near2MiB HTTP SSE.
Reports under `reports/capture-ab-*.json` retain raw timing pairs, cold/warm
results, byte/protocol/digest checks, compiled artifact SHA-256 fingerprints
and post-shutdown ownership. Warm paired additional first-body-byte/E2E p95
must stay<=20ms and sampled event-loop p99<50ms. First body byte is not model
TTFT. Separate real-network tests cover JSON/SSE codecs and reset/cancel/error
prefixes. Only synthetic loopback data is used; no Agent/model call or OS trust
change. Temporary synthetic DB/CA/originals are removed after success; CLI
failures retain their isolated evidence directory and print its path. This is
not a30-minute soak, full Web/scanner workload or actual Agent certification.

Open a request to download its originals. The lazy **Protocol Analysis** tab
projects Chat Completions, Responses or Messages text/public reasoning, tool
declarations, proposed calls, observed request-history results, native usage and
terminal/error evidence. It never executes tools or replays upstream requests.
OpenAI cache/reasoning subsets are not added twice; missing counters remain
unavailable. gzip/br/deflate decoding is bounded independently for analysis.
Analysis/context diff use at most 2MiB per source; larger originals remain
downloadable. Projection limits and legacy/incomplete sources are disclosed.

This is not yet the complete Agent integration: exact cross-source identity,
native tool/subagent execution links, live chunk/reconnect recovery, manual
storage cleanup/export and actual Agent acceptance remain in progress. The old
Clear button's backend deletion route is not implemented yet; do not treat it as
a way to free capture storage. See the
[support matrix](openspec/changes/fuse-agent-monitoring/support-matrix.md) and
[capability evidence](openspec/changes/fuse-agent-monitoring/parity.md).

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

## Process-scoped Agent connection (fusion branch)

In Proxy → Agent connection setup, save a terminal CLI (`claude`, `codex` or
`opencode`), an absolute project directory and a proxy port. An optional
absolute executable selects that installed binary; empty uses PATH. Generate
the launch command and run it explicitly in your own terminal. The page can
start the shared listener but does not start/adopt external Agent processes.

```bash
node /absolute/path/to/awesomeTelemetry/bin/agent-observe.js launch \
  --server http://127.0.0.1:4173 --profile <saved-profile-uuid> --revision <n> --
# Append your usual Agent arguments after -- if needed.
```

Copied commands pin the reviewed recipe revision. Edit/save a recipe and
regenerate the command when needed; old commands refuse to launch a changed
executable/project. The launcher waits for the real listener, checks its CA
digest, appends child-only runtime trust, inherits terminal stdio and forwards
arguments literally without a shell. Native model/auth/permission settings
and parent environment are unchanged. Temporary public CA files are removed
after child exit; system trust/Agent configuration is not edited or restored.

Force-killing a launcher (SIGKILL/power loss) cannot run its cleanup handler
and may leave its child or a temporary public-CA file behind. This is not
native configuration mutation; inspect/stop the exact owned process before
cleaning only its known temporary trust files. General crash recovery remains
an explicit unfinished acceptance item, not a guarantee of this launcher.

Codex requires verified `--no-daemon` support; no transport is disabled.
OpenCode needs localhost/127.0.0.1 bypass for its TUI, so local model gateways
may bypass capture. Other NO_PROXY matches also bypass collection. Child
tools using other runtimes, mTLS, pinning, remote/background services and
enterprise upstream proxy chaining need separate validation/configuration.
Inherited CA bundles are preserved; conflicting equal-issuer/different-key
roots are rejected rather than silently removed or made insecure.

Stopping the shared proxy can interrupt connected Agents. Agent exit does
not automatically stop that listener. A saved recipe/listening socket is not
proof of Agent connection or full tool/subagent coverage; see
`openspec/changes/fuse-agent-monitoring/support-matrix.md`. Windows command
quoting is provided, but Windows runtime behavior is not yet certified.

Profiles live in the app-owned `monitor-profiles.json` next to the user
configuration. Writes are locked, atomic, revision-checked and bounded to32
recipes/256KiB. Corrupt/unknown-version/symlinked files are not overwritten.
A crash lock is not automatically removed: first stop/inspect its exact owner
before explicitly removing only that application's stale `.lock` file.

### Read-only connection diagnosis

Select a saved recipe and click **Check connection status**. The snapshot
shows the expected/actual port, current-run shared traffic, public CA digest
and expiry, and specific next steps. Missing/invalid CA evidence does not
generate or replace a CA. Public CA availability is not runtime trust; OS
trust is not inspected. Old totals, other-port traffic and stopped runs do
not establish current connectivity or Agent identity.

The CLI reads the exact same backend findings without opening a DB,
starting a listener/Agent, modifying configuration or sending model traffic:

```bash
node /absolute/path/to/awesomeTelemetry/bin/agent-observe.js diagnose \
  --server http://127.0.0.1:4173 --profile <saved-profile-uuid> --revision <n>
# Add --json for the same machine-readable diagnostic snapshot.
```

Exit0 means the report was retrieved without error findings, **not** that
the Agent is connected. Exit2 means an error finding; a failed request or
stale recipe exits nonzero. Web checks abort after5s with retry guidance;
CLI requests time out after12s. Runtime SSE changes mark a Web snapshot stale
without polling. Click again explicitly to refresh it. Review CA/TLS errors,
NO_PROXY, daemon/remote attachment and transport support before treating an
empty capture as an Agent problem. Actual Agent/version coverage remains in
the support matrix, not inferred from a successful diagnostic response.

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
