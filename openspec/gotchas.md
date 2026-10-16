# Gotchas & Avoidance Guide

> This document collects every pitfall hit while developing this project,
> organized by category. When rebuilding, **read the relevant chapter before
> working on each module**. Most of these cannot be seen from the code alone;
> they are the distilled experience of real debugging.
>
> **Chapter 11 covers performance pitfalls, all backed by measured numbers.**
> They are the direct cause of the reference implementation's 5.9-12.4s first
> screen, and rank equal to the chapter 4 token-calculation pitfalls. This is a
> 0-1 build, so these pitfalls are **avoided from the first line of code**, not
> fixed after they appear.

---

## 1. Environment & build

### G1.1 better-sqlite3 needs the MSVC toolchain on Windows
- **Symptom**: `npm install` fails compiling better-sqlite3
- **Cause**: native module; prebuilt binaries may not match the Node version
- **Fix**: install Visual Studio Build Tools (C++ workload), or pin the Node
  version to use prebuilt binaries
- **Rebuild**: README must state Node >= 20 and MSVC requirement on Windows

### G1.2 Build must be three stages, in order
- `tsc -b` must run before `vite build`, otherwise type errors leak into the bundle
- `vite build --config vite.cli.config.ts` is the **server bundle**; skipping it
  leaves `bin/agent-observe.js` with no `server-dist/cli.js` to load
- server-dist external deps (better-sqlite3 etc.) are **not bundled**; they
  resolve from node_modules at runtime

### G1.3 Node >= 20 is a hard requirement
- Uses 20+ APIs including native fetch, structuredClone, subtle crypto

---

## 2. Platform & paths

### G2.1 Use .ps1, not .bat, for Chinese paths on Windows
- **Symptom**: .bat scripts garble / fail under Chinese paths
- **Fix**: launchers in PowerShell (.ps1), UTF-8 encoding
- **Rebuild**: pack-binary.mjs must mind encoding when generating .cmd/.sh launchers

### G2.2 Path expansion must support all three syntaxes
- `~` → home (Unix style)
- `~\` → home (Windows style, backslash)
- `%VAR%` → environment variable (Windows style)
- `expandLocalSessionPath()` must handle all three, otherwise Windows user
  configs are broken

### G2.3 Three-layer config override order
- Built-in defaults → `config/local-sessions.local.json` (project-level,
  gitignored) → user config (`%APPDATA%/agent-observe/agent-observe.json` or
  `~/.config/agent-observe/agent-observe.json`)
- Later wins; **user config has the highest priority**
- User config writes must be atomic (tmp + rename) to avoid half-written state

---

## 3. Network & proxy

### G3.1 dev URLs must use 127.0.0.1, never localhost ⚠️ critical
- **Symptom**: under Huawei corporate network, the browser's `localhost:5173`
  requests fail through the proxy
- **Cause**: Huawei proxy ProxyOverride includes `127.0.0.1*` but **not
  localhost**
- **Fix**: every dev/doc URL uses `127.0.0.1`
- **Rebuild**: cli.ts default host is `127.0.0.1`; README examples use it too

### G3.2 MITM requires the user to trust the CA certificate
- The effective proxy engine CA is generated on first use; download its actual public certificate via `GET /api/ca-cert`.
- Trust scope is runtime-specific. The approved launcher appends child-only custom CA trust; it does not require or install global OS trust. Other browsers/runtimes need explicit trust configuration and independent verification.
- Listening/recipe generation is not evidence that an existing Agent process trusts that CA. Equal-issuer/different-key roots can fail verification; preserve prior CA files and report a conflict rather than bypassing TLS.

### G3.3 OpenSSL dependency
- Historical v4 had an unimplemented fallback. Current monitoring uses the actual http-mitm-proxy1.1.0 CA generator (node-forge), not a second independent root or an OpenSSL-only command.
- The canonical public certificate and private key stay under the controlled caDirectory; private material is never a capture/export/API payload. Actual CONNECT trust/SAN/restart tests establish the effective root, not a filename alone.

---

## 4. Data & token calculation (most error-prone)

### G4.1 Kernel-Inference duration includes Tool time ⚠️
- **Symptom**: some providers' (CodeArts) Kernel-Inference duration is not pure
  LLM time; it includes tool execution
- **Fix**: pure LLM inference time must use
  `InferHub.inference_duration`, never Kernel-Inference
- **Rebuild**: speed-metrics must distinguish them explicitly

### G4.2 Trae token calibration: token_usage is the real total, no /2 ⚠️
(calibrated 2026-08-03, overturns the old assumption)
- **Symptom**: the old assumption was that `server_history_info.token_usage` is
  bidirectional accumulation needing /2; measurement showed
  `token_usage` = real total (input+output) and `item_token_usage` =
  output/completion tokens
- **Fix**: `output = item_token_usage`, `input = token_usage - item_token_usage`;
  when `item_token_usage` is missing, fall back to `output = token_usage`,
  `input = 0`. /2 is forbidden.

### G4.3 Trae non-LLM rows' token_usage is message size, do not double count
- **Symptom**: non-LLM rows also carry numeric `token_usage`, easy to add by
  mistake
- **Cause**: those are message sizes, already counted in the LLM input context
- **Fix**: only rows with `content_source === 'llm_default'` count into
  outputTokens; skip everything else

### G4.4 CodeArts/OpenCode cache.read is per-step incremental, use sum not max
⚠️ (calibrated 2026-08-03, overturns the old assumption)
- **Symptom**: the old assumption was cache.read is a session-level running
  total, use max; measurement (DeepSeek billing input = SUM(input) +
  SUM(cache.read); three steps 6016/4000/2000 should total 12016) confirmed it
  is incremental
- **Fix**: `totalCacheReadTokens = SUM(cache.read)`, not max; reasoning tokens
  are also incremental, use sum

### G4.5 total = input + output + reasoning + cache.read + cache.write
- cacheRead/cacheWrite both count into total (#8: cache.write is the real cost
  of writing the prompt to cache on first processing)
- Whether reasoning counts depends on the adapter's `reasoningInTotal`
  declaration (#6, calibrated with real data 2026-08-04 and 2026-08-09):
  - OpenCode (measured ses_0fdca2dc): total = input+output+reasoning+cache,
    output excludes reasoning → counts
  - older CodeArts/DeepSeek (measured ses_1afaab585ffe): total =
    input+output+cache, reasoning is a subset of output → does not count
  - CodeArts/deepseek-v4-pro (measured 2026-08-09): native total =
    input+output+reasoning+cache → counts
- If OpenCode-family source tokens carry native `total`, infer the equation
  from the current record. A provider-wide hardcode is stale as soon as a
  model/version changes its output/reasoning accounting.

### G4.6 Total duration uses wall-clock, not the sum of durations
- `totalDurationMs = lastEvent.startedAt - firstEvent.startedAt`
- Do not sum each event's durationMs (they overlap / have gaps)

### G4.7 Session keys use first 14 chars of SHA1 + provider prefix
- `sessionKey(provider, id, sourcePath)` = `provider-` +
  SHA1(`provider:id:sourcePath`).slice(0,14)
- Must include sourcePath, otherwise the same provider+id in different files
  collides

### G4.8 Event ID dedupe
- Some providers generate duplicate event IDs
- `upsertEvents()` appends a `:sequence` suffix to duplicate IDs within a session
- Defensive measure; must be kept when rebuilding

---

## 5. SQLite & file watching

### G5.1 WAL mode
- `openWritable()` must set `journal_mode = WAL` + `foreign_keys = ON`
- Schema is currently v4, tracked via `schema_version` in the `_meta` table

### G5.2 SQLite/SQLCipher file watching is unreliable; switch to polling ⚠️
- **Symptom**: chokidar watching Trae/CodeArts .db files never fires
- **Cause**: in WAL mode writes go through the `-wal` file; the main file's
  mtime never changes
- **Fix**: trae and codearts providers use **30s polling**, not chokidar
- **Rebuild**: file-watcher.ts routes db providers through a polling branch

### G5.3 Metric dimension fields are not persisted — **v5 overturns this** ⚠️
- **v4 symptom**: `getMetrics()` read back default four-dimension values (0 or -1)
- **v4 claim**: "this is a design choice, not a bug"
- **Measured consequence**: not persisting → Agent Overview must pull details
  for every session and recompute → **524 N+1 requests / 299.6MB / 4,732ms**
- **v5 fix**: four-dimension metrics are **persisted**; the metrics table gains
  a `calc_version` column, bumped on algorithm changes to trigger recompute
- **Lesson**: a "design choice" that forces N+1 on callers is a bug. The
  standard is what cost it imposes on callers, not whether it is reasonable in
  isolation

### G5.4 System prompts associated via time window
- `getSystemPromptForSession(startedAt, endedAt)` finds the **longest**
  system_prompt in proxy_requests within the window
- Scan sessions have no system prompt themselves; association comes from MITM
  captures

---

## 6. Encryption & decryption (Trae-only, deepest pitfalls)

### G6.1 Trae SQLCipher needs a Python-extracted key
- `python scripts/trae-extract-key.py --save`, requires the `sqlcipher3` pip
  package
- Key saved to the user config directory
- **Rebuild**: the scanner must check the key exists first and give a clear
  message when it does not

### G6.2 TTNet encryption
- Trae requests carry `x-tt-encrypt-*` headers; the body is encrypted
- `request-context.ts` detects these headers and sets the `ttnetEncrypted` flag
- MITM **cannot** decrypt TTNet bodies (encryption happens before the
  application layer)

### G6.3 Frida Rust heap fragmentation ⚠️
- **Symptom**: one-shot Frida heap scans miss prompts (Rust objects are
  scattered)
- **Fix**: monitor mode (continuous listening) is more reliable than one-shot scan
- **Rebuild**: frida-capture uses a monitor script, not a scan script

### G6.4 Electron / UTF-16LE handling
- Frida captures of Electron app strings must handle UTF-16LE
- Direct UTF-8 decoding produces mojibake

### G6.5 CDP is useless for Trae
- **Symptom**: CDP attached to Trae CN's remote debugging port captures nothing
- **Cause**: Trae uses TTNet's custom network stack, not the Chromium Network domain
- **Fix**: Trae only works with Frida or MITM; CDP is ineffective
- **Rebuild**: CDP is only valid for standard Electron apps

---

## 7. UI & interaction

### G7.1 Detail panel on the right, not the bottom
- User preference: detail panel on the right, draggable width + scrollable
- Do not place it at the bottom

### G7.2 Font size adjustment A-/A+/R
- Long-text areas (dashboards/reports) default too small
- Must support A- (smaller) / A+ (larger) / R (reset), range 8-28px

### G7.3 Compact single-row lists, groups collapsed by default
- No multi-row cards
- Groups collapsed by default; expand for details

### G7.4 scan/proxy shown separately
- Scan sessions and proxy captures keep independent original views. Explicitly labelled association exploration is allowed by fuse-agent-monitoring; candidates are never authoritative membership and original rows are not merged.

### G7.5 Performance: useDeferredValue + startTransition
- phase/kind filtering uses `useDeferredValue`
- view switching uses `startTransition`
- Agent overview loads all session details; must be lazy

### G7.6 Embed large HTML JSON via external JS files ⚠️
- **Symptom**: `<script>var data = {...}</script>` with large JSON in report
  HTML fails to parse
- **Cause**: `</script>` and special chars in JSON break HTML parsing
- **Fix**: large JSON via **external .js file** (most reliable) > `var`
  assignment > `<script type="application/json">`
- **Rebuild**: report.ts / compare-report.ts must use external files

---

## 8. Data security

### G8.1 Do not commit captured-prompts/ etc. to git
- captured-prompts/, captures/, compare/, *.log contain sensitive data and must
  be gitignored
- Reverse-engineered system prompts are sensitive assets

### G8.2 Desensitization aws_secret_key is disabled by default
- 40-char base64 regex has too many false positives
- Disabled by default; the other 9 rules are enabled by default

### G8.3 Original capture policy (2026-10-15, user-approved)
- Fusion monitoring preserves original headers/bodies/prompts/tool data without redaction.
- Originals stream to an independent file store; default10GB total/100MiB per direction, configurable.
- No automatic original expiry or eviction. Analysis limits do not limit capture or download.

---

## 9. Adapter reuse

### G9.1 CodeArts / CodeAgent 2.0 reuse OpenCode
- opencode.ts scanner + adapter use the `OpenCodeDialect` param to distinguish
  provider/agent/label
- codearts.ts / codeagent2.ts are thin wrappers
- **Rebuild**: implement opencode fully first, then a 2-line wrapper produces
  codearts/codeagent2

### G9.2 CodeAgent 3.0 wraps Claude Code
- codeagent.ts adapter wraps claude-code.ts
- Differences: drop `file-history-snapshot` rows, relabel actor
- Independent scanner (codeagent.ts in local-sessions/)

### G9.3 OpenCode subagent detection
- Title matching `/\(@.*\bsubagent\)/i` marks subagent sessions
- Affects token accumulation method

---

## 10. Miscellaneous

### G10.1 Startup prewarm must be non-blocking — **v5 further defaults to no
prewarm** ⚠️
- **v4 fix**: build indexes first, then prewarm details one by one in the
  background via `setImmediate`
- **Why that was not enough**: `setImmediate` only guarantees a single tick
  doesn't freeze; it does not guarantee CPU isn't hogged. `scanAndStoreDetail`
  is internally synchronous `readFileSync` + `spawnSync` + DB writes — a single
  session takes 182ms or more
- **Measured**: A/B 10s/60s/180s → prewarm on: 5,884 / 3,896 / 12,399ms;
  prewarm off: 20 / 19 / 10ms, **ratio 200-1240x**
- **v5 fix**: `--prewarm-recent` defaults to **0**, purely on-demand + LRU.
  On-demand reads measured median 1.57ms, P95 12.94ms; what prewarm saves is
  nowhere near the degradation it causes
- **Lesson**: an "optimization" without a controlled experiment is likely
  creating a problem

### G10.2 CDP routes exist only in dev mode
- `cdp-capture.ts` is wired only in `vite-plugin.ts`; production `server.ts`
  does not expose CDP routes
- **Rebuild**: either complete them for production or explicitly document as
  dev-only

### G10.3 Two session-merge modes
- CodeArts SDD: main session + 3 subagent sessions
  (spec-requirement/design/task-agent)
- Trae shells: 0-event sessions + real sessions
- Both driven by manual `config/session-groups.json` (gitignored) config

### G10.4 Phase classification is a two-pass algorithm
- Pass 1: explicit (direct action mapping) / meta (system/step) / propagate
  (message/reasoning)
- Pass 2: propagate/meta inherit the nearest explicit phase
- bash commands classified into verify/report/understand/implement by regex
- file_write after an error → debug
- **Rebuild**: phase-classifier.ts logic is complex but critical; port it in full

### G10.5 user_prompt filters system injections
- `isGenuineUserPrompt()` filters out `<system-reminder>` and other system
  injections
- `cleanPromptText()` strips tags
- Never treat system injections as user input

---

## 11. Performance (v5, all backed by measurements)

> Source: `PERF-DIAGNOSIS.md` (524 sessions / 73,588 events / 800.21MB source
> files). Every entry is a pitfall the v4-rebuilt system actually hit, not a
> theoretical risk.

### G11.1 slim tier leaking body fields bloats responses 20x ⚠️
- **Symptom**: detail endpoint returned 32,332KB; server 625ms
- **Cause**: the `events` table's `raw` (147.82MB / 64.2%) + `input_summary`
  (37.33MB) + `output_summary` (44.95MB) total 96% of DB size, and the detail
  query used `SELECT *`
- **Fix**: three-tier split (slim / full / raw), default slim; the Gantt tree
  only needs phase, kind, duration anyway
- **Acceptance**: contract tests assert slim responses omit those three keys

### G11.2 `events.raw` must be a separate table
- Kept in the main table, any `SELECT *` drags 147MB; wide rows explode page
  counts and slow even pure-metadata queries
- After splitting, the main DB drops from ~320MB to ~172MB

### G11.3 `ORDER BY LENGTH(col)` cannot use an index
- v4's `getSystemPromptForSession` used it to find the "longest system
  prompt", forcing a temp sort
- Fix: add redundant column `system_prompt_len` with composite index
  `(started_at, system_prompt_len DESC)`
- Note: measured 0.79ms over 1,820 proxy_requests rows, **not a bottleneck at
  current scale**. Listed because it becomes one under long-term capture;
  preventive fix

### G11.4 A single-column index cannot replace a composite index ⚠️
- **Symptom**: all 4 hot queries show `USE TEMP B-TREE FOR ORDER BY` in
  EXPLAIN QUERY PLAN
- **Cause**: v4 built `idx_events_session_id` and `idx_sessions_data_source`,
  but the queries filter by A and sort by B, needing a `(A, B)` composite index
- **Measured**: worst-session event sort 210.48ms
- **Fix**: `(session_id, sequence)` and `(data_source, started_at DESC)`;
  the old single-column indexes can be dropped (covered by composite prefixes)
- **Self-check**: every `WHERE x = ? ORDER BY y` should have an `(x, y)` index

### G11.5 `scan_state` writes fail silently, making incremental scanning fake
⚠️⚠️
- **Symptom**: `scan_state` measured **0 rows** — table exists, index exists,
  just no data
- **Consequence**: every scan reprocesses all 1,514 files / 800.21MB; one full
  prewarm executes 18,235 SQL statements
- **Why unnoticed**: the write path's exceptions were silently caught —
  functionally "everything is fine", it just redoes everything every time
- **Fix**: write failures MUST throw; add CI assertion
  `SELECT COUNT(*) FROM scan_state > 0`
- **Lesson**: cache and incremental mechanisms need a positive assertion that
  they actually took effect; otherwise they fail completely silently

### G11.6 `spawnSync` is absolutely forbidden in single-threaded Node ⚠️
- **Measured**: 4 `spawnSync` calls (Trae SQLCipher decryption) totaled
  6,074ms, 37.5% of the CPU profile; single call 834-2,251ms
- **During**: every HTTP request queues; the user sees "the whole app froze"
- **Fix**: `spawn` + Promise; decryption only in background polling, never on
  the request path
- **Similar**: `execFileSync`, large-file `readFileSync`, synchronous
  `JSON.parse` of huge strings

### G11.7 The mental model of SSE events ⚠️
- **v4 behavior**: `scanAndStore` emits one `session_updated` per session; the
  frontend calls `reloadSessionIndex()` on every event
- **Measured**: 508 requests / 151.2MB in a 30s browser window
- **Correct model**: the event says "which keys changed", not "something
  changed, go refetch". The former is O(changes), the latter O(total × changes)
- **Fix**: server coalesces into `sessions_changed { keys }` in a 200ms
  window; frontend only invalidates matching caches + one batched patch request

### G11.8 The coalescing timer must `unref()`
- Otherwise the CLI process hangs and won't exit; `npm test` times out too

### G11.9 Frontend fetching per-session in a loop is a design error ⚠️
- **v4 symptom**: Agent Overview used `setTimeout(…, 0)` loops to pull 524
  session details
- **Measured**: 4,732ms / 524 requests / 299.6MB
- **Fix**: add a server-side aggregation endpoint; two `GROUP BY` SQLs produce
  everything, 1 request < 80KB
- **Self-check**: any `sessions.map(s => fetch(...))` in the code is a red line

### G11.10 Adapters must return raw and body separately
- Mixed together, storage cannot do the three-tier split and G11.1 has no fix

### G11.11 Persisted metrics need a version-invalidation mechanism
- After persisting four-dimension metrics, an algorithm change that does not
  bump `METRICS_CALC_VERSION` leaves stale dirty data in the DB unnoticed

### G11.12 Original bodies must not grow SQLite
- Keep body files separate from metadata/previews. Defaults:10GB files,100MiB per direction; full quota explicitly stops new body collection, never deletes old evidence.

### G11.13 Monitoring bypasses regex redaction
- Preserve original payload. Legacy redaction utilities are optional and are not used in the monitoring forwarding path.

### G11.14 Merge-group SSE notifications must emit the primaryKey
- Emitting the group members' own keys makes the frontend invalidate entries
  that don't exist in its list

### G11.15 WAL-source change fingerprints must cover the `-wal` file ⚠️
- This is the **correct solution** to G5.2. In WAL mode writes go through
  `-wal`; the main DB's mtime never changes
- v4 only watched the main file, so it neither detected changes (forcing 30s
  polling) nor could tell "actually unchanged" during polling (re-decrypting
  every round for nothing)
- Fix: fingerprint = hash(main DB) + ':' + hash(-wal)

### G11.16 Decryption must never appear on the HTTP request path
- Return `pending: true` when not ready; background completes it and SSE
  notifies the frontend to refetch
- Frontend must not poll-wait

### G11.17 `--prewarm-recent` default must be 0
- Any "reasonable-looking" non-zero default reproduces v4's 200-1240x
  degradation

### G11.18 Parsing JSONL by regex-splitting the whole file
- CPU profile: `RegExp: \r?\n` self time 459.8ms
- Fix: `createReadStream` + `readline` streaming line by line; with byte
  offsets you can read only the incremental tail

### G11.19 Performance triage order
- v4 experience: **A/B experiments first, then profiles, SQL last**
- SQL execution is only 4.2% of CPU in this project; optimizing SQL first
  wastes all time in the wrong place
- A/B experiments (disable a suspect component and compare) give the most
  information per unit cost

---

## 12. Team observability (add-agent-team-observability, backed by fixtures)

> Source: `openspec/research/agent-team-evidence.md` — field-mapping matrices
> derived from `codearts-team-minimal.json` and `codex-team-minimal.jsonl`. Every
> entry is a real shape discovered in the fixtures, not a theoretical risk. Do
> not "fix" these away by assuming a cleaner model.

### G12.1 Topology is measured, not assumed from the provider name ⚠️
- **Wrong assumption**: "CodeArts = two_level, Codex = three_level"
- **Measured**: both CodeArts (`contact.json` leader → teammate) and Codex
  (`root` → depth-1 subagent) resolve to **two_level** from real records
- **Fix**: `TeamTopologyKind` is derived from actual parent/child links; never
  hardcode a topology per provider. Codex may show three levels only if a
  depth-2 spawn is actually observed in a fixture (design D16)

### G12.2 communication is unavailable for both providers, do not fabricate ⚠️
- **Symptom**: neither provider's message records carry `sender`/`recipient`
- **CodeArts**: single member + no direct-send fields; coordination only via
  `background-task`/`output` and `get-my-task` tool-param sessionIDs (correlated)
- **Codex**: `send_message` exists only as a schema declaration, **0 real calls**;
  `agent_message` has no recipient field
- **Fix**: communication dimension is declared `unavailable`, never upgraded to
  direct messages from tool-param inference (adapters REQ-015/016)

### G12.3 Codex cost unavailable must not render as $0.0000 ⚠️
- **Symptom**: Codex carries no monetary amount; `rate_limits.credits.balance`
  is literally `"0"` and `has_credits=false`
- **Fix**: cost is `unavailable` (nullable), not zero. Never display `$0.0000`
  for a Codex run — that fabricates a cost signal (design D7/D9 keep a separate
  unavailable channel)

### G12.4 Mixed timestamp formats force an `ambiguous` order marker ⚠️
- **Measured**: CodeArts has **three** timestamp formats (contact.json ISO UTC;
  `team-task.json.startedAt` local string `"8/17/2026, 11:31:52 PM"`,
  `createdAt` ms; `opencode.db.time_created` ms). Codex has **two**
  (session_meta/event top-level ISO; `task_*` unix s; `sub_agent_activity.
  occurred_at_ms` ms)
- **Fix**: normalize everything to ISO 8601 UTC **before** persisting;
  `team-task.json.startedAt` local string parses as UTC+8 (`15:31:52Z ==
  23:31:52 +08:00`, same instant, different representation). Cross-source
  ordering records `orderConfidence = 'ambiguous'` (design D8)

### G12.5 Codex has three generational sub-thread shapes ⚠️
- **Measured** (fixtures): `08-01` has `thread_source=subagent` +
  `parent_thread_id` + `source.subagent.other="guardian"`; `08-07/08` has
  `thread_source=subagent` **only, no parent link**; `08-16` has
  `thread_source=subagent` + `forked_from_id` + `parent_thread_id` +
  `source.subagent.thread_spawn{depth,agent_path,agent_nickname,agent_role}`
- **Fix**: the Codex adapter must tolerate both with/without parent links; a
  missing `parent_thread_id` does not mean "root" — it means the link is absent
  in that generation, so the parent/child edge is `unavailable`, not assumed
  (design D16)

### G12.6 Template intent ≠ runtime membership ⚠️
- **Symptom**: `get-team-setup` output contains a full Role Table listing 7
  sub-agent types (team-spec-requirement-agent, …)
- **Fix**: that is recorded as "template intent" (documented/inferred boundary),
  **not** runtime members. Runtime membership comes only from `contact.json` /
  `background-task` actual creation records (design D16, adapters REQ-015)

### G12.7 To-Do ≠ Task List ⚠️
- **Symptom**: `opencode.db.todo` has 62 rows overall but **0 rows for the team
  session**; the real team Task List lives in `team-task.json` + the
  `publish-task` tool
- **Fix**: To-Do is agent-local metadata/activity, never a team DAG task unless
  the source explicitly promotes it (design D16)
