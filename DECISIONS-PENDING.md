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

---

## D-011 C2 双通道覆盖与 G7.4 的关系（add-mission-control §6.12 / design §5）

- **Problem**: C2 面板按「scan ∩ proxy」对比计数，容易被误判为违反 G7.4
  「scan/proxy 分开展示，不混」。
- **Approaches tried**: 复核 G7.4 原文与 frontend REQ-013 —— G7.4 禁止的是
  **混列会话行**（一个列表里同时出现 scan 会话与 proxy 捕获）；C2 只对比
  计数（双通道 N / 仅 scan N / 仅 proxy N），不并列任何会话条目。
- **Why they failed**: 无失败 —— 这是口径澄清，不是绕过规则。
- **Temporary approach**: C2 按 design §5 落地（`widgetDualChannel`），只返回
  计数 + 两个成因提示 tag，并在 criteria 行写明「只对比计数不混列会话行
  （不违反 G7.4，D-011）」。
- **Suggested next step**: 人工确认该声明后，可将 D-011 的结论写进
  `openspec/gotchas.md` G7.4 条目作为官方解释，避免后续 change 反复误判。

---

## D-012 repair 检测触发 design §7.3 R1 升级：schema v2 → v3（metrics.repair_loop）

- **Problem**: Mission closure 的 repairSessions 若逐请求做全表 repair 检测，
  在 tier B（524 会话 / 73,588 事件）实测 40ms，超过「单 widget SQL < 30ms」
  预算。design.md §7.3 R1 明令超标 → 升级为扫描后写 rollup，不要靠加索引硬撑。
- **Approaches tried**: ① window 函数方案（LAG over 全表）= 40ms；
  ② sequence 偏移自连接 = 43ms；③ 逐会话循环 = 40ms；④ 单条全量流 SQL + JS
  滚动扫描 = SQL 46-63ms。全部超过预算。
- **Why they failed**: repair 模式要求按 sequence 连续的完整事件流，
  tier B 的全表扫描无论如何都 ≥40ms；预过滤会破坏 sequence 连续性。
- **Temporary approach**: schema v2 → v3 —— `metrics.repair_loop`（W-F-W-F-W
  ≥2 轮，与 session-findings repairLoop 同口径）在扫描时由 computeMetrics
  预计算落库；Mission closure 改为 rollup `COUNT(... WHERE repair_loop=1)`，
  单条 SQL 12ms。migrateSchema 增加 v2→v3 迁移（幂等 ADD COLUMN）。
- **Suggested next step**: 人工确认 v3 升级符合预期；schema 版本现在为 3，
  `contracts/database.md` 已同步。若未来有其他全表聚合 widget 超预算，沿用
  同一条 rollup 路径（design §7.3 R1 / nfr §7）。

---

## D-013 Trae 工具名映射清单未经真机验证（B4.2）

- **Problem**: design §5.1 的 bash / file_read / file_write 工具名清单
  （PascalCase 归一化后匹配）来自外部变更说明，本仓库无法在真实 Trae 库上
  跑 `SELECT DISTINCT tool_name FROM chat_message_task` 校正 ——
  `config/local-sessions.example.json` 里 `traeKeyPath: null`，Trae 路径是
  Windows `%APPDATA%/Trae CN/...`，当前机器是 macOS，没有真实 Trae 库。
- **Approaches tried**: 检查本机 `%APPDATA%` 等价路径（~/.config / ~/Library/
  Application Support）下有无 Trae CN 数据目录，无；`traeKeyPath` 为 null，
  解密流程本身也无法启动（TRAE_KEY_MISSING）。
- **Why they failed**: 数据源不存在于本机，无法实测。
- **Temporary approach**: 按 design §5.1 清单实现二级映射（`turn.toolName`
  小写归一化）+ fixture 测试；实现处注释标明「清单未经实测」（trae.ts
  kindOfTurn 上方）。B8 的 Trae 子代理调查同样降级为 fixture 驱动。
- **Suggested next step**: 在真实 Trae 库可访问的机器上跑
  `SELECT DISTINCT tool_name FROM chat_message_task`，按实测结果校正清单
  （增删条目都在 kindOfTurn 的两个 Set 内）。

---

## D-014 扫描路径 metrics 生产者缺失（B3 前置调查发现，非本 change 引入）

- **Problem**: `metrics` 表只有写入端（writers.upsertMetrics + schema），但
  `local-sessions/scanner-utils.ts` 的 `storeTraceRecord` 仅在
  `record.metrics !== undefined` 时写入，而**没有任何 adapter 或扫描路径
  设置 record.metrics**（全仓 `computeMetrics` 仅被 report-html /
  compare-report 在运行时调用）。实测 `agent-observe-data/observe.sqlite`：
  50 会话 / 8754 事件，`metrics` 表 **0 行** —— mission 的
  repair_loop / ttft_ms / tool_call_count 聚合全部读空。
- **Approaches tried**: 全仓 grep `record.metrics` / `computeMetrics` /
  `upsertMetrics` 调用点；翻查 makeSqliteScanner / scanSqliteFile /
  scanJsonlFile 的存储路径 —— 全部只走 storeTraceRecord，无 metrics 生产者。
- **Why they failed**: 这是 add-mission-control「持久化 metrics」落地时留下的
  接线缺口（v5 推翻 G5.3 后只有 schema/writers，没有 scan-time producer）。
- **Temporary approach**: B3 按 design 文件清单落地（字段 / schema v4 /
  METRICS_CALC_VERSION / writers / 迁移），3.10 老库升级实测用文档化的
  `upsertMetrics` 写入路径 + 真实会话的 `computeMetrics` 结果验证新列有真实值
  （total_tool_duration_ms=308638 / llm_call_count=108 /
  user_interaction_rounds=124 / calc_version=4）。未改 scanner-utils
  （不在本 change 文件清单内）。
- **Suggested next step**: 独立 change 在 `storeTraceRecord` 中当
  `record.metrics === undefined` 时用 `computeMetrics(record)` 补齐并
  upsert（一行接线），然后重扫即可回填整个 metrics 表；mission 各 widget
  随即读到真实值。

---

## D-015 Trae systemPrompt 无任何捕获机制（B7.3 调查结论，design §7.2 分支 3）

- **Problem**: 外部变更说明要求「从文件加载已捕获的 system prompt」，但本仓库
  对 Trae 的 systemPrompt **没有捕获机制**，凭空约定文件路径只会产出永远没人
  写入的死代码。design §7.2 明确：先调查数据源，没有就停手记 D-###。
- **Approaches tried / 调查证据**：
  1. **解密库**：`local-sessions/trae.ts` 只读 `server_history_info` /
     `chat_session`（title/agent_type/agent_name）/ `history_v2`（reasoning）/
     `chat_message_task`（tool calls），全仓没有任何代码读取 system prompt
     字段；本机 `traeKeyPath=null`（Windows %APPDATA% 路径），无真实 Trae 库
     可跑 `PRAGMA table_info` 验证是否存在该列。
  2. **MITM 抓包**：`server/proxy/parsers/trae-tunnel.ts` 硬编码
     `systemPrompt: null` —— Trae 请求带 `x-tt-encrypt-*` 头，TTNet body 在
     应用层之前加密，MITM 无法解密（G6.2）。
  3. **通用关联**：`getSystemPromptForSession`（query-engine.ts:396，G5.4）
     只在 openai/anthropic 格式的 proxy_requests 上按时间窗关联，且当前
     没有任何调用方接线到 `GET /api/sessions/:key`；它也不覆盖 Trae。
- **Why they failed**: Trae 的 system prompt 在加密隧道内且解密库侧无读取实现，
  当前架构不存在可注入的数据源。
- **Temporary approach**: 按 design §7.2 分支 3 **停手**，不发明「约定路径下的
  文件」。B2 的 systemPrompt 估算逻辑（length / 4，只作 SpeedMetrics 展示字段，
  不进 TokenUsage.input）照常实现且有单测，只是线上 `session.systemPrompt`
  恒为 null，估算值不会出现。
- **Suggested next step**: 未来若 Trae 客户端提供明文导出（如 settings/
  agent-config 文件）或解密库被证实含 system_prompt 列，再开独立 change 接线
  到 `GET /api/sessions/:key`；在此之前 UI 保持不显示估算值（不伪造数据源）。
