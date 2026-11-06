# RSI P0 disposable probe

Only probe code; no product contract or runtime modification. Run from the repository root.
The complete procedure is in `docs/rsi/p0-runbook.md`. Requires Node 24, git, Docker CLI,
Colima on Apple Silicon. No npm dependencies are added. No Docker/network/port checks
were executed in the Codex sandbox. Do not interpret generated code as a feasibility result.

## Layout and boundaries

- `colima-start.sh`, `colima-stop.sh`: dedicated `rsi` profile, vz, 4 CPUs, 4 GiB.
  Custom single empty read-only mount replaces default mounts. Inspect actual VM mounts
  before proceeding; existing profile configuration must not expose HOME.
- `images/target.Dockerfile`: source build of the pinned CLI, Bun 1.4.4, linux/arm64,
  headless binary (web assets skipped). `OPENCODE_SRC` defaults to
  `/Users/penghao/Documents/code/CodingAgent/opencode/opencode`.
- `run-probe.mjs`: async CLI orchestration, no host bind mounts. Temporary directory
  receives `git archive` of commit `4d30794bcf4dccdcadbcb1f62bb35b4943a96426`.
  This deliberately builds committed source, ignoring uncommitted files. No `.git`,
  untracked files or host `node_modules` enter the source context. Build Dockerfile is
  supplied via `docker build -f`; proxy context contains only proxy sources; evaluator
  context is empty. Images acquire dependencies only at build time. No build secret args.
- `proxy/`: built-in Node HTTP(S) proxy and deterministic OpenAI chat mock; helpers and
  adjacent node:test tests. Memory doubles replace transport only, not tested logic.
- `evaluate.mjs`: trusted structured Node test reporter and inventory judge, separate
  from candidate code; `validate-task.mjs` verifies the real sample and reference patch.
- `session-tokens.mjs`: Node built-in SQLite read-only reader for the pinned schema.
- `optimizer-probe.sh`: pinned Codex CLI clean Linux arm64 image; no network or mounts
  at runtime, runs version/help/login-help/exec-help and reports account decisions.
  It does not authenticate or copy host credentials. CLI execution, authentication and
  authenticated inference are distinct results. The P0 chat proxy cannot serve Codex
  Responses calls; a Responses proxy is a P4 prerequisite for API-key inference.

Extra reporter/reader/validator modules separate trusted evaluation from untrusted
workspace code and permit real local verification without Docker or ports.

## Source audit (all relative to the pinned OpenCode repository)

The requested old `packages/opencode` directory is absent. Actual sources:

| Concern | Source and decision |
| --- | --- |
| Version/toolchain | root `package.json`: 2.1.3, bun@1.4.4 |
| Build | `packages/cli/script/build.ts`: `--single --skip-install --skip-web-ui`, output `dist/cli-linux-arm64/bin/opencode`; root workspace `bun install --frozen-lockfile` first |
| Shell tool | `packages/core/src/tool/plugin/shell.ts`: tool name `shell`, input `command`; no guessed legacy bash name |
| Run flags | `packages/cli/src/commands/commands.ts`, `commands/handlers/run.ts`, `run/run.ts`: `run --standalone --auto --format json --model probe/fixed`; standalone avoids service reuse |
| Flags/config | `packages/cli/src/server-process.ts`: `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_FFF`, `OPENCODE_DISABLE_FILEWATCHER`; config passed as container-only global config |
| Provider loading | `packages/core/src/provider.ts`: builtins map first, then local import resolution, then `npm.add` fallback. `@opencode/ai/providers/openai-compatible` is a builtin and bundled by the CLI build. No external provider install is needed for this probe |
| Legacy SDK | `packages/core/src/aisdk-native.ts` maps legacy `@ai-sdk/openai-compatible` to native; choosing the native package explicitly avoids reliance on migration or on dynamically installing an SDK. Bundled dependencies come from locked source installation, not host modules |
| Provider config | `packages/schema/src/config/provider.ts`, `packages/core/src/config/plugin/provider.ts`, `packages/ai/src/providers/openai-compatible.ts`: `providers.probe.package`, `settings.baseURL/apiKey`, model `limit/capabilities`; configured provider is enabled |
| Models metadata | `packages/core/src/models-dev.ts` and `models-dev/snapshot.txt`: bundled snapshot also copied to `/opt/models.json`; fetch disabled. Catalog may contain upstream prices, but probe reports never project them |
| Updates | `packages/cli/src/services/updater.ts`: `OPENCODE_DISABLE_AUTOUPDATE=1`; native config `update: "disable"` (`packages/schema/src/config.ts`) |
| LSP/formatters | `packages/schema/src/config/lsp.ts`, `formatter.ts`: both config values `false`; no LSP install flag guessed. `plugins: []`, no external plugin declarations; sharing disabled, snapshots disabled |
| Telemetry | `packages/cli/src/index.ts`, `packages/util/src/observability.ts`, `observability/otlp.ts`: endpoint comes from `OTEL_EXPORTER_OTLP_ENDPOINT`; absent endpoint returns no exporters. No OTEL variables inherited into containers, no invented disable flag |
| DB path | `packages/cli/src/database-path.ts`: absolute `OPENCODE_DB=/data/session.db` bypasses data-root-relative resolution |
| DB schema | `packages/core/src/session/sql.ts`, `session/projector.ts`, `session/usage.ts`; `packages/schema/src/token-usage.ts`: `session_v2` token counters accumulate usage, exclusive input/output with separate cache/reasoning components |

The existing awesomeTelemetry `local-sessions/opencode.ts:readOpenCodeDb` reads older
`session/message/part` tables. It cannot be used verbatim for this pinned checkout's
`session_v2` schema. P0 reads explicit columns from source SQL; product reader remains
unchanged. Existing `server/proxy/protocol-analysis.ts` informed the incremental SSE
and OpenAI subset accounting: cached input/reasoning output must not be double counted.
OTLP capture is not enabled in P0; export absence is intentional to prevent egress.

## Temporary output formats (P0 only)

All output is under ignored `out/`; archive it outside the worktree before another run.
No real API key or temporary run token is logged. Source/diff/trace/DB artifacts remain
sensitive; do not publish them blindly. No monetary fields in reports or usage logs.
Timestamps are UTC ISO 8601. Durations are milliseconds; memory/image sizes are bytes.
Null means unavailable, not zero. No reports are ingested into product storage.

### `probe-report.json`

| Field | Meaning |
| --- | --- |
| `schemaVersion` | P0 format revision, 1 |
| `startedAt`, `finishedAt` | Whole probe interval, includes builds and cleanup |
| `model`, `concurrency`, `sourceCommit` | `mock/real`, 1/2 independent targets, pinned source identity |
| `builds[]` | `image`, wall `durationMs`, Docker `sizeBytes`, build `exitCode`; cached rebuild timing differs from first build |
| `runs[]` | See below; each run has an independent temporary token and DB |
| `resources[]` | `at`, `containers[]` of `name/memoryBytes`, `vmUsedBytes`, sampling `error` |
| `memoryPeakBytes` | Sampled peak simultaneous container sum and VM MemTotal−MemAvailable; includes VM samples during build. Docker builder memory is represented by VM usage, not target stats |
| `hostSentinelVerified` | Host loopback server returned the expected marker before starting Docker |
| `errors`, `cleanupErrors` | Sanitized infrastructure diagnostics; partial report survives normal failures |
| `verdict` | `pass/fail/infra_error`; pass requires every evaluation pass, exact complete token reconciliation, no observed OOM, and VM samples. It is one probe observation, not a general stability claim |

Run fields: `runId`, `durationMs` (setup through evaluation/export), `targetExitCode`,
`timedOut` (290-second in-container target deadline, 310-second host guard), `oomKilled`,
`isolation` (check records), `containerEvidence` (actual network names and mount count), `evaluation` (`verdict/reason/observedTests/expectedTests`, optional
`retried`), `sessionTokens`, `reconciliation`, `error`. Agent timeout is fail; infrastructure
errors are not scored. Evaluator infra_error retries once in another fresh container.
Nonzero OpenCode startup is infrastructure error; failing assertions are fail.
`isolation` failure aborts that target before running OpenCode.

Session tokens: `input` excludes cached input, `output` excludes reasoning, `reasoning`,
`cached`, `cacheWrite`, `total` = all five components, `sessions` = rows exported.
Reconciliation: `proxyTotal`, `sessionTotal`, `delta` = proxy−session, `requests`,
`complete` = all calls have usage and terminal response, `match` = complete and delta=0.
Mock expects 120 tokens per request (100 prompt incl.10 cached, 20 completion); ordinarily
2 calls=240, but auxiliary OpenCode calls are recorded too and must reconcile. Do not
assume exactly two requests; tool-bearing calls use the pinned `shell` tool (legacy `bash` is also supported), while auxiliary calls without tools return a fixed title.

### `usage.jsonl`

One admitted/request-attempt record per authenticated request: `runId`, `startedAt`,
upstream `status` (or 429/null), `firstByteMs` (first upstream response body bytes, not
first visible content), `durationMs`, `usage` (`input/output/cached/reasoning/total`,
OpenAI input/output INCLUDE their cache/reasoning subsets), `cacheHitRate` = cached/input,
`toolCalls` (distinct tool indexes), `complete`, `error`, `chargedTokens`.
No request body, response body, credentials or headers are persisted by the proxy.
401 requests have no run attribution and no usage row.

Each run has a 100000-token admission budget. Concurrent calls reserve from the same per-run balance before forwarding.
The proxy fixes model, n=1 and max_tokens<=1024, requests streaming usage, and reserves
serialized UTF-8 request bytes plus max_tokens before forwarding. It rejects admission
when that conservative reservation does not fit. On valid complete usage it replaces
reservation with observed total; missing usage, upstream rejection and transport errors
burn reservation (fail closed). Unknown usage cannot be reported as zero. This is a
conservative admission approximation, not a model-specific tokenizer; real upstream
accounting must be checked before productizing an exact hard budget. No retries by proxy.
Unknown endpoints are rejected; upstream redirects/compression are not followed.
Upstream errors are replaced by static envelopes to avoid credential leakage.

### Other outputs

- `isolation.jsonl`: `name`, `expected`, `actual`, `pass` per check. HTTP error responses
  count reachable too; socket errors/timeouts count blocked. Denied DNS and denied
  routing both count blocked. Ports must have a proven live sentinel (see runbook).
- `test-events-N.jsonl`: reporter emits only pass/fail nesting/skip/todo flags and
  final summary counts. Names, test diagnostics and stdout are excluded. Five top-level
  tests required, no skip/todo/cancellation, and final summary required.
- `workspace.patch`, `data/` (DB plus WAL/SHM), `opencode.jsonl`, `opencode.stderr.log`:
  target exports. Container is stopped before DB copying, then destroyed before evaluation.
  Only clamp.mjs text diff without mode changes is eligible for this small probe.
- `task-validation.json`: original fails/reference passes, with exact inventory and exits.
- `optimizer-report.json`: startup result, `idleMemoryBytes` after help (not an inference peak), actual help support for stdin-key/device-auth,
  `authenticated:false`, required user decisions and limitations; no host credentials.
- `*.build*.log`, `optimizer-help.log`: full stdout/stderr build logs and CLI help.

## Limits to interpret honestly

A single or repeated mock run measures local process/VM behavior, not real model latency
or realistic context growth. Sampling every 2 seconds can miss spikes, especially during
Docker stats collection. VM usage is not macOS-wide pressure; use Activity Monitor and
`memory_pressure` too. Build and dependency install use network only at build time;
container execution has no host mounts and target-only internal network. Colima/Docker
network isolation is empirical: if any host check is reachable, stop and redesign the
network before real models. The dual-network proxy is trusted, not a general HTTP tunnel.

P0 is not a hardened multi-tenant evaluator: adversarial native code, kernel exploits,
`/proc` attacks and arbitrary malicious test runners need additional sandbox design.
The tiny diff allowlist and separate structured reporter are appropriate for this sample,
not sufficient evidence that arbitrary hostile programs cannot attack the evaluator.
