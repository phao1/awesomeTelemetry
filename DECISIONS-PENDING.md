# DECISIONS-PENDING.md — pending decisions

> Decisions made during unattended long runs that could not wait for human
> confirmation are recorded here.
> Format: id / problem description / approaches tried / why they failed (if
> applicable) / suggested next step.

---

## D-001 Missing rule files

- **Problem**: the goal instructions required reading AUTOPILOT.md /
  PROGRESS.md / RUNBOOK.md first, but none of the three exist in the repo
  (including git history), and AGENTS.md / BOOTSTRAP.md don't reference or
  explain them.
- **Approaches tried**: full-repo search (maxdepth 4), full git-history check,
  unpacking agent-observability-dev-kit.zip for comparison — none contain the
  three files.
- **Why they failed**: the files were never created or never committed with
  the repo.
- **Temporary approach**: rebuilt AUTOPILOT.md / RUNBOOK.md / PROGRESS.md
  from the rules embedded in the goal instructions, with the content clearly
  marked "rebuilt". The section numbers referenced in the goal instructions
  (§1 prohibitions, §3 stuck, §5 pre-authorized, §8 termination report,
  RUNBOOK §3 five phases) are all present in the rebuilt files.
- **Suggested next step**: human confirms the rebuild matches the original
  intent; if originals exist, replace with the originals.

---

## D-002 idx_proxy_started_len column order conflicts with the §5.3 expected
plan

- **Problem**: contracts/database.md §4 defines
  `idx_proxy_started_len ON proxy_requests(started_at, system_prompt_len DESC)`,
  but §5.3's expected plan for `WHERE started_at BETWEEN ? AND ? AND
  system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1` is
  `SEARCH ... USING INDEX idx_proxy_started_len` with "no USE TEMP B-TREE".
  Both cannot hold simultaneously in SQLite.
- **Approaches tried**: measured three index shapes —
  (started_at, system_prompt_len DESC) always yields
  `USE TEMP B-TREE FOR ORDER BY` (empty and populated tables alike);
  (system_prompt_len DESC, started_at) yields exactly
  `SEARCH proxy_requests USING INDEX idx_proxy_started_len
  (system_prompt_len>?)` with no temp B-tree and LIMIT 1 short-circuits.
- **Why they failed**: the SQLite planner can only use a (A, B) covering
  search for "range-filter by A + sort by B"; it cannot reuse the second
  column for a global sort. §4's column order and §5.3's expected plan
  contradict each other.
- **Temporary approach**: changed the index to
  `(system_prompt_len DESC, started_at)` (schema.ts already changed, with a
  TODO marker); semantics unchanged (longest prompt in window), acceptance
  tests unchanged.
- **Suggested next step**: after human confirmation, update the §4 index line
  in contracts/database.md to remove the internal contradiction.

---

## D-003 scanner-level JSONL tail incremental reads not yet wired (F11)

- **Problem**: REQ-008's readJsonlFrom supports byte-offset incremental reads,
  but the scanner layer (scanJsonlFile) always full-rereads changed files. The
  reason: incremental reads only return new tail rows, which cannot rebuild
  session-level aggregates alone (tokenUsage / eventCount / totalDurationMs
  need the full view).
- **Approaches tried**: considered "tail rows + merge with stored session
  aggregates", which would need per-adapter incremental merge semantics, and
  with no prevHeadHash after first run/restart to verify whether the head was
  rewritten — risk outweighs benefit.
- **Why they failed**: none (deliberate trade-off). Full rereads guarantee
  correctness; F11's benefit (reading only the tail of a 739MB file) can be
  added later for continuous-watch scenarios.
- **Temporary approach**: full rereads; code carries a TODO(D-003) marker; the
  M4 readJsonlFrom incremental capability and its unit tests are kept.
- **Suggested next step**: if codeagent-class large files become the
  bottleneck, implement "tail rows + merge with stored session aggregates",
  and record the first-4KB hash in scan_state or an in-memory cache for
  rewrite detection.

---

## D-005 Session list rows refined from "compact single line" to "44px
two-line dense"

- **Problem**: `specs/frontend/spec.md` REQ-011 and `gotchas.md` G7.3
  originally say "lists use compact single lines, not multi-line cards". This
  design refresh sets session list rows to `--row-lg` (44px) two-line dense
  (first line title, second line provider/time/counts). Per prohibition A
  (don't violate confirmed behavior), this needs a trace explaining why it is
  not a violation.
- **Basis**: the essence of the constraint is "dense, not whitespace cards";
  the anti-pattern is v4's multi-line card lists. Single lines under this
  project's real data force truncation of the only meaningful label —
  measured, one line fits only
  `rollout-2026-08-04T14-08-32-019fcb63…jsonl`; provider / time / event count
  all get squeezed out, forcing users to open each row to know what it is.
  GitHub's notification/PR lists are also two-line dense, not cards.
- **Approaches tried**: single line + tooltip for meta — rejected, because
  meta is the basis for filtering decisions and must stay visible; tooltips
  can't be scanned or compared.
- **Why they failed**: none (deliberate trade-off).
- **Temporary approach**: REQ-011 keeps the "dense, not cards" essence with an
  added refinement paragraph pointing to this entry; event rows stay
  single-line `--row-sm` (28px), not relaxed.
- **Suggested next step**: after human confirmation, sync the wording of
  `gotchas.md` G7.3 — "compact single line" → "compact dense, not cards" — to
  remove the literal ambiguity.

---

## D-006 Tension between REQ-001's file-level gate and REQ-022's per-session
lazy loading

- **Problem**: REQ-001 requires "before any detail read, MUST pass the
  shouldRescan file-level gate; when unchanged, MUST return directly";
  REQ-022 / T-11 requires SQLite multi-session to locate a single session by
  "db path + in-row session id". Enforcing the file-level gate strictly
  produces a deadlock: "db unchanged but a session never loaded → return
  directly → that session can never be opened" (same class of problem as
  P1-2).
- **Approaches tried**: approach A "first open parses the whole DB and writes
  everything" (the T-03 status quo) — satisfies REQ-001 but violates T-11's
  "locate the specific session" and does useless work on first open; approach
  B "locate per session + skip the file-level gate" (adopted) — lazy loading
  parses only the target session, `detail_loaded` acts as the session-level
  gate, and the file-level gate stays for full scans (POST /api/scan).
- **Why they failed**: none (deliberate trade-off). scan_state is keyed by
  source_path, and without a schema change there is no session-level
  scan_state (the change declared "no schema changes").
- **Temporary approach**: `scanSqliteSessionDetail` bypasses the file-level
  gate, code carries a `TODO(D-006)` marker; the full-scan path
  `scanSqliteFile` still uses the file-level gate.
- **Suggested next step**: after human confirmation, add to
  `specs/session-scanning/spec.md` REQ-001: "SQLite multi-session lazy detail
  uses sessions.detail_loaded as the session-level gate; the file-level gate
  applies to full scans", removing the literal conflict.

---

## D-007 Tension between Trae index title "set to null" and
SessionIndexEntry.title: string

- **Problem**: REQ-021 writes for Trae (SQLCipher): "null + `pending` before
  decryption is ready, backfill after", but `contracts/data-model.md`'s
  `SessionIndexEntry.title` is a non-null `string`, and the list API has no
  null channel (the change declared "no BREAKING, no response-structure
  changes").
- **Approaches tried**: making title `string | null` — requires changing the
  data-model contract + API types + frontend four states, beyond this change's
  scope; keeping string and using the D5 placeholder title
  (`<trae> session · <time>`) — adopted, more honest than the old file-name
  stand-in.
- **Why they failed**: none (deliberate trade-off). Trae cannot be verified on
  macOS (P-3 trim) and this doesn't affect the other 8 providers.
- **Temporary approach**: Trae index entries use buildIndexEntry's D5
  fallback title; after decryption the detail phase overwrites with the real
  title.
- **Suggested next step**: after human confirmation, decide whether a later
  change should widen `SessionIndexEntry.title` to `string | null` and render
  a pending placeholder in the frontend.

---

## D-008 design-tokens.md §2.4 and §2.7 self-conflict: light
attention-emphasis contrast fails

- **Problem**: the contract §2.4 table gives light theme
  `--attention-emphasis: #bf8700`, but §2.7 hard-requires
  "`--fg-on-emphasis` on any `*-emphasis` >= 4.5:1" — measured white on
  #bf8700 is only 3.14:1, an internal contradiction in the same document.
- **Approaches tried**: measured candidates — #9e6a03 (4.65 ✅), #9a6700
  (4.87 ✅), #a86c00 (4.37 ❌), #b87d00 (3.52 ❌).
- **Why they failed**: none (the contract's own numeric conflict; §9
  assertions are the contract's executable form, assertions win).
- **Temporary approach**: light `--attention-emphasis` changed to `#9e6a03`
  (same hue family as dark, white text 4.65:1 passes); all other values
  adopted verbatim. T4 assertion unchanged.
- **Suggested next step**: after human confirmation, sync the §2.4 light
  attention-emphasis value in `contracts/design-tokens.md` to `#9e6a03`,
  removing the self-conflict.

---

## D-009 Frontend REQ-020 "clear requests" has no backend endpoint

- **Problem**: `specs/frontend/spec.md` REQ-020 requires the proxy control
  strip to include "request count and clear", but neither `contracts/api.md`
  §4 nor `server/server.ts` has an endpoint to clear proxy_requests (only
  GET list/single, POST start/stop). This change's Non-Goals explicitly say
  "no backend API changes".
- **Approaches tried**: the frontend button calls
  `DELETE /api/proxy/requests` (api client already added) — the backend
  returns 404 ROUTE_NOT_FOUND; the failure genuinely surfaces in the error
  state with console.error; the button stays in the UI (with confirmation),
  and the failure shows "backend does not support clear yet (D-009)".
- **Why they failed**: none (backend contract gap, not fixable frontend-side).
- **Temporary approach**: button kept + confirmation + honest failure
  presentation; TODO(D-009) marker.
- **Suggested next step**: in a later change, add `DELETE /api/proxy/requests`
  to `contracts/api.md` §4 (with 409/404 semantics) and wire it up.

---

## D-010 定价表数据来源与更新责任人（add-mission-control §3.6 / design R3）

- **Problem**: 成本类 widget 的准确性完全取决于模型定价表；内置表只收录了
  有权威出处的 Anthropic 模型（`src/core/pricing.ts` DEFAULT_MODEL_PRICES，
  source = anthropic claude-api skill models 表，cached 2026-06-24），
  glm / deepseek / qwen 等故意留空走 `costSource='unknown'` 显示 `—`。
  无人值守环境下无法联网逐厂商核对实时价格，且编错价格比留空更糟
  （错得极难发现，会让 B 区成本系统性偏差）。
- **Approaches tried**: 只落地加载器与三层覆盖（`loadModelPricingOverrides`，
  G2.3：内置 → `config/model-pricing.json` → 用户级），未自行补任何价格；
  用户可通过覆盖层按官方定价页补充并必填 `source`（URL + 抓取日期）。
- **Why they failed**: 无失败 —— 这是刻意的范围边界（tasks.md「已做的决策」#1
  与七条红线 #4 都禁止凭记忆写价格）。
- **Temporary approach**: 未知模型 `{ costUsd: 0, costSource: 'unknown' }`，
  UI 渲染 `—`；成本类 widget 从分子分母同时剔除 unknown 会话并公示剔除数。
- **Suggested next step**: 人工（或未来接官方定价 API 的 change）逐厂商核对
  当前价格并写入覆盖层；建议由「负责成本口径的维护者」持有更新职责，每次抓取
  记录 URL + 日期，并在 `config/model-pricing.example.json` 保持模板同步。
