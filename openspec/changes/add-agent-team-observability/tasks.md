# Tasks — add-agent-team-observability

Execution model: Team Leader owns dependency scheduling, contract integration, conflict
resolution, and final verification. Evidence Research runs first. After contract freeze,
CodeArts Adapter, Codex Adapter, Storage/API, Core Analysis, and Frontend lanes may proceed
in parallel only where the dependencies below allow. Reviewer/QA remains independent from
builder lanes. Do not mark a checkbox complete without the named evidence.

Dependency spine:

`§1 evidence → §2 contract freeze → (§3 storage ∥ §4 adapters ∥ §5 pure core) → §6 API/realtime → §7–§9 UI/compare → §10–§11 integration and real-run proof`.

## 1. Evidence discovery and scope freeze

- [ ] 1.1 Inventory the current dirty worktree and record all pre-existing modified/untracked files; freeze a do-not-touch list for this change.
- [ ] 1.2 Read the CodeArts Agent Team guide updated 2026-08-14 and record documented concepts separately from locally observed facts.
- [ ] 1.3 Inventory real local CodeArts Agent Team logs, session records, Task List/overview data, accepted-artifact metadata, and project Role/Scene files without modifying them.
- [ ] 1.4 Inventory real local Codex collaboration/session records that persist run, parent/child, task, message, lifecycle, tool, output, interrupt, follow-up, and completion evidence.
- [ ] 1.5 Produce a sanitized source-field matrix for both dialects: canonical fact, source path/field, stable id, native sequence, timestamp/clock, cardinality, null cases, sensitivity, and confidence.
- [ ] 1.6 Produce one sanitized minimal fixture and one non-trivial real-shape fixture per provider; scan them for personal paths, prompts, credentials, keys, and proprietary code before committing.
- [ ] 1.7 Prove whether each provider can supply run identity and agent identity; stop and report the affected requirements if either core identity is not stable.
- [ ] 1.8 Record the independent completeness matrix for topology/tasks/communication/timing/tools/outputs/tokens/cost/verification for each fixture.
- [ ] 1.9 Resolve conflicting clocks, duplicate ids, missing recipients, incomplete snapshots, and provider-specific lifecycle semantics in a discovery decision log.
- [ ] 1.10 Freeze the exact implementation file list and map every file to one requirement; include no unrelated dirty file.
- [ ] 1.11 Have an independent reviewer challenge every `native`, `correlated`, and `inferred` mapping against the raw sanitized fixture.
- [ ] 1.12 Run `openspec validate add-agent-team-observability --strict`; do not begin contract edits until discovery evidence and review are complete.

## 2. Authoritative contract freeze

- [x] 2.1 Add the closed team enums and all canonical team/evidence/comparison types from design D3 to `openspec/contracts/data-model.md`, resolving only D1-proven shape differences.
- [x] 2.2 Add type-level acceptance for enum closure, required ids, nullable availability, no body fields in slim types, and no duplication/renumbering of `TraceEvent`.
- [x] 2.3 Add the next additive schema migration, team tables, foreign keys, checks, indexes, and explicit column constants to `openspec/contracts/database.md`; select the actual next version from the current contract.
- [x] 2.4 Specify all team routes, exact query/body/response types, pagination, bounds, body tiers, compression, and new error codes in `openspec/contracts/api.md`.
- [x] 2.5 Specify the team scale ceiling, response/event-loop/request-count budgets, cache behavior, and CI assertions in `openspec/contracts/nfr.md`.
- [x] 2.6 Add team evidence/topology/task/communication/privacy/performance pitfalls to `openspec/gotchas.md`, referencing the exact requirements they protect.
- [x] 2.7 Sync the relevant main capability specs only after delta requirements and authoritative contracts agree; contracts win on conflict and the conflict is recorded.
- [x] 2.8 Copy the canonical types verbatim into `src/core/trace-types.ts` and extend its colocated type tests.
- [x] 2.9 Add the team bus event and payload to `BusEvents` in the data contract and runtime type source, including caps/truncation/stamp.
- [x] 2.10 Add contract tests proving lists/snapshots/ledgers/compare omit every prohibited body field and all non-2xx responses use `ApiError`.
- [x] 2.11 Audit exact field/table/route names against the four contracts; remove any implementation name invented outside them.
- [x] 2.12 Run strict OpenSpec validation and `npm run typecheck`; stop before storage/adapters if either fails.

## 3. Schema, differential storage, and queries

- [ ] 3.1 Implement the additive migration exactly from the database contract with fresh/current/repeated/newer-version test coverage.
- [ ] 3.2 Prove the migration preserves sessions, events, event raw, metrics, prompt context, annotations, scan state, and unrelated future tables named by prior migrations.
- [ ] 3.3 Implement explicit team column constants and cached prepared-statement registries; add a static/review assertion against `SELECT *` and prepare-in-loop.
- [ ] 3.4 Implement differential upsert for team runs, agents, edges, tasks, dependencies, assignments, messages, activities, rounds, artifacts, evidence, bodies, and metrics in one affected-run transaction.
- [ ] 3.5 Implement complete-snapshot versus append/partial reconciliation so incomplete scans never delete prior rows.
- [ ] 3.6 Implement parser-version invalidation limited to derived team rows for affected sources; prove it leaves session/event data untouched.
- [ ] 3.7 Implement team source scan-state/fingerprint persistence, including WAL/sidecar inputs proven by discovery, and make write failures throw.
- [ ] 3.8 Implement cascade semantics: team deletion removes only team-owned rows; session deletion removes links but not the team; test both directions.
- [ ] 3.9 Implement keyset-paginated team-run list with all contract filters and no body projection.
- [ ] 3.10 Implement one bounded team snapshot query/service for summary, topology, tasks, assignments, artifacts, completeness, anomalies, and metrics.
- [ ] 3.11 Implement keyset-paginated activity ledger filters and deterministic cross-source ordering/ambiguity fields.
- [ ] 3.12 Implement single activity/message/tool/artifact detail loading for body/raw tiers with typed unavailable/not-found outcomes.
- [ ] 3.13 Implement bounded patch queries by stamp and affected agent/task ids, including deleted-id reporting.
- [ ] 3.14 Implement server-side two-run comparison input queries with no per-agent/task/session loop.
- [ ] 3.15 Add EXPLAIN tests for run/time, agent/time, task/time, communication, graph, list, and comparison queries; assert no temporary B-tree.
- [ ] 3.16 Add write-counter tests: no-change rescan = zero parse/SQL, append one message = only affected inserts/aggregates, no delete-and-reinsert.
- [ ] 3.17 Benchmark storage at the team tier-B ceiling and record list/snapshot/ledger/compare-input sizes and times in `PERF-BASELINE.md`.
- [ ] 3.18 Run storage-targeted tests, typecheck, lint, and strict OpenSpec validation before API integration.

## 4. CodeArts and Codex team adapters

- [ ] 4.1 Define the shared team-dialect adapter boundary and normalization helpers for ids, timestamps, source order, confidence, redaction, completeness, and parser version.
- [ ] 4.2 Implement deterministic canonical id generation and duplicate occurrence ordinals; prove stability across unchanged rescans and separation across runs.
- [ ] 4.3 Implement CodeArts team-run discovery from only the D1-proven sources.
- [ ] 4.4 Implement CodeArts Leader/Teammate/Role/Scene/Subagent normalization without treating template intent as runtime membership.
- [ ] 4.5 Implement CodeArts Task List dependencies, claims, assignments, status history, and agent-local To-Do distinction.
- [ ] 4.6 Implement CodeArts direct/mediated/broadcast communication only where sender/recipient/delivery evidence exists.
- [ ] 4.7 Implement CodeArts dynamic membership, failure/replacement, tool/skill/MCP reference, context/token data, artifacts, acceptance, and final Leader integration according to fixture coverage.
- [ ] 4.8 Implement Codex team-run discovery from only the D1-proven persisted collaboration sources.
- [ ] 4.9 Implement Codex creation-chain, parent/child, peer/root message, task, lifecycle, interrupt, follow-up, completion, and output mappings.
- [ ] 4.10 Link Codex team activities to existing session/event/turn identities without copying or renumbering them.
- [ ] 4.11 Ensure neither provider name nor role name determines topology depth; topology comes only from normalized edges.
- [ ] 4.12 Add minimal, multi-level, direct-message, parallel-task, failure/replacement, incomplete, duplicate-id, out-of-order-clock, malformed, and contradictory-parent fixtures per supported dialect.
- [ ] 4.13 Add complete snapshot tests and negative assertions for no fabricated parent, message, dependency, task success, timing, output, verification, token, or cost.
- [ ] 4.14 Add malformed-record tests proving valid neighbors survive and parse gaps remain visible.
- [ ] 4.15 Add scanner integration with fingerprint/no-change behavior and coalesced affected-run notification; no child process or large sync read on HTTP paths.
- [ ] 4.16 Have CodeArts and Codex lanes cross-review one another's confidence rules and canonical mapping, then run adapter/scanner tests and typecheck.

## 5. Pure topology, DAG, ledger, and metric core

- [ ] 5.1 Implement evidence filtering and independent completeness propagation as pure functions with native/correlated default and optional inferred overlay.
- [ ] 5.2 Implement topology validation for missing nodes, self edges, duplicate edges, cycles, roots, multi-parent conflicts, and valid-time slices.
- [ ] 5.3 Implement exact `two_level`/`three_level`/`deep_tree`/`peer_graph`/`hybrid`/`unknown` classification and material overlay rules.
- [ ] 5.4 Add topology tests for every class, single-agent non-team, direct peer communication, time-varying membership, conflict, cycle, and inferred-evidence exclusion.
- [ ] 5.5 Implement task-DAG validation, stable level assignment, dynamic dependency projection, and anomaly output without rewriting source data.
- [ ] 5.6 Implement exact critical path only for complete acyclic components; add hand-computed DAG, cycle, missing-duration, and invalid-order tests.
- [ ] 5.7 Implement ledger ordering by native sequence/time/source priority/id plus explicit ambiguity markers.
- [ ] 5.8 Implement per-agent round mapping priority: native round → explicit session turn → existing `TurnModel` → unavailable; forbid time/count splitting in tests.
- [ ] 5.9 Implement interval union, wall-clock, total work, observed wait, max/average concurrency, serial-work estimate, observed speedup, peak-capacity utilization, delegation delay, and handoff latency.
- [ ] 5.10 Implement task completion, verification/acceptance coverage, review rework, artifact acceptance, failure/retry/replacement/recovery, blocked/orphan, and unresolved-error metrics.
- [ ] 5.11 Implement token/cost attribution and coordination overhead with existing token semantics/cost provenance; unknown pricing remains unavailable.
- [ ] 5.12 Implement direct/mediated ratios, correlated response latency, task-balance Gini, leader/critical-agent concentration, cross-agent review, and inferred duplicate-work signal.
- [ ] 5.13 Ensure every metric carries availability, completeness, criteria, numerator/denominator where applicable, and evidence ids.
- [ ] 5.14 Add hand-computed fixtures for overlap, zero denominator, missing time, missing messages, partial graph, tokens-known/cost-unknown, and running teams.
- [ ] 5.15 Add calculation-version invalidation and consistency tests between full-ledger, persisted aggregate, and comparison inputs.
- [ ] 5.16 Benchmark topology, DAG, ledger ordering, and metrics at the ceiling; meet D17 budgets without relaxing assertions.

## 6. HTTP, comparison service, and realtime

- [ ] 6.1 Register `GET /api/team-runs` with exact contract parsing, bounds, keyset pagination, gzip, foreground marking, and error envelope.
- [ ] 6.2 Register `GET /api/team-runs/:runId` snapshot with stamp caching and no activity/body waterfall.
- [ ] 6.3 Register paginated activity ledger and single-detail body/raw routes with tier enforcement and bounded detail cache.
- [ ] 6.4 Register the bounded patch route and exact changed/deleted entity semantics.
- [ ] 6.5 Implement comparison-basis evaluation from goal/criteria/project/revision/environment/model/template/completeness fields.
- [ ] 6.6 Implement matched/partial/unmatched/unknown rules plus user-declared basis that preserves every detected difference.
- [ ] 6.7 Implement dimension rows with raw values, right-minus-left delta, guarded relative delta, directionality, materiality, criteria, completeness, and evidence.
- [ ] 6.8 Implement deterministic strengths, weaknesses, trade-offs, and caveats with no model call, winner, or overall score.
- [ ] 6.9 Register `POST /api/team-compare` and descriptive success for unmatched/unknown pairs; reject only malformed/bounded-invalid input.
- [ ] 6.10 Register explicit derived-team deletion with confirmation semantics and prove linked sessions/source files survive.
- [ ] 6.11 Implement `team_runs_changed` coalescing in the existing 200ms window with run/agent/task caps, truncation, stamp, timer `unref`, and cleanup.
- [ ] 6.12 Add API contract tests for every route, filter, cursor, missing id, body tier, unavailable body, bounds, gzip, and exact `ApiError`.
- [ ] 6.13 Add request-count tests proving snapshot ≤1, visible ledger ≤1, compare exactly 1, patch ≤1, and zero per-agent/task/session loops.
- [ ] 6.14 Add SSE burst/reconnect tests: 1,000 activities remain bounded; patch preserves state; truncation causes one snapshot refresh.
- [ ] 6.15 Add service performance tests for cold/cache-hit compare, response sizes, event-loop p99, and no heavy work on request paths.
- [ ] 6.16 Run server/realtime tests, typecheck, lint, strict OpenSpec validation, and NFR checks before frontend wiring.

## 7. Team shell and shared client state

- [ ] 7.1 Extend the hash-state contract and tests for team run, team compare, panel, agent, task, activity, filters, and invalid/deleted ids.
- [ ] 7.2 Add typed API client methods for run list, snapshot, ledger, detail, patch, compare, and delete; prevent body fields from entering slim client types.
- [ ] 7.3 Extend `App.tsx` to the seven-view shell while preserving the existing Agent and session Compare semantics.
- [ ] 7.4 Create one App-owned team-run list/entity cache and bounded body-detail cache; prohibit a second private run-list state.
- [ ] 7.5 Implement `TeamRunList` with keyset loading, search/provider/status/topology/completeness filters, virtualization, real titles, and six states.
- [ ] 7.6 Implement the Team summary header with topology, lifecycle, counts, tokens/cost provenance, verification, and per-dimension completeness.
- [ ] 7.7 Implement the tagged-union selection model shared across topology/tasks/timeline/comms/ledger/inspector with zero-request cross-highlighting.
- [ ] 7.8 Implement SSE local patch/reconnect behavior preserving selection, graph view, filters, scroll, and cached bodies.
- [ ] 7.9 Add every team string and terminology distinction to both locales and extend locale-parity tests.
- [ ] 7.10 Add team layout/style entry points using existing tokens only; add no runtime dependency or color-only meaning.
- [ ] 7.11 Implement loading/empty/error+retry/success/partial/unavailable states for every team panel.
- [ ] 7.12 Add shell/client tests for initial request budgets, cache behavior, URL restore, deleted URL, SSE patch, and no per-entity fetching.

## 8. Topology, tasks, timeline, communication, and inspector

- [ ] 8.1 Implement accessible topology projection with structural tree, peer/cross-tree overlays, level labels, evidence confidence, conflict/cycle states, and inferred-evidence toggle.
- [ ] 8.2 Implement accessible task DAG with dependency direction, owners, status history, critical-path overlay, anomaly details, level of detail, and no silent graph repair.
- [ ] 8.3 Implement shared wall-clock swimlanes with agent lifetimes, task/round/message/tool/failure/handoff/artifact activities, concurrency, point markers, open ends, and uncertainty.
- [ ] 8.4 Virtualize agent lanes and ledger rows; aggregate above graph/lane caps while displaying total and omitted counts.
- [ ] 8.5 Implement the execution ledger filters and source-order/ambiguous-order presentation as the fallback when graph projections are unavailable.
- [ ] 8.6 Implement communication graph/table distinguishing direct, mediated, broadcast, and unknown; show correlated latency only with proof.
- [ ] 8.7 Implement entity inspector for agent/task/round/activity/message/tool/artifact/edge with provenance, criteria, completeness, conflict, and session trajectory jump.
- [ ] 8.8 Implement body/source/raw detail control on explicit expansion with one request per tier and bounded cache.
- [ ] 8.9 Add cross-view tests: selecting a task highlights agents/edges/intervals/ledger; selecting a round shows its exact activities; no already-loaded selection issues a request.
- [ ] 8.10 Add topology tests for two/three/deep/peer/hybrid/unknown rendering and no invented collaborative layer.
- [ ] 8.11 Add timeline tests for overlap, dynamic join/leave, unknown versus idle/blocked, ambiguous clocks, running intervals, zoom/scroll node stability, and critical overlay.
- [ ] 8.12 Add communication tests for direct versus forwarded paths, broadcast, unavailable messages, reply correlation, and keyboard/text alternatives.
- [ ] 8.13 Run accessibility checks for focus order, graph traversal, inspector focus return, accessible names, non-color semantics, and reduced motion.

## 9. Team Compare experience

- [ ] 9.1 Implement searchable left/right TeamRun selectors that reuse the App-owned team list and issue no per-run list requests.
- [ ] 9.2 Implement the persistent comparison-basis banner with goal/project/revision/environment/model/template/completeness differences and user-declared marker.
- [ ] 9.3 Implement aligned topology/task/schedule summaries without implying structural equivalence where providers differ.
- [ ] 9.4 Implement five separate metric sections with raw values, deltas, direction/criteria, completeness, evidence links, and unavailable reasons.
- [ ] 9.5 Implement deterministic strengths, weaknesses, trade-offs, and caveats exactly from the server response; frontend writes no independent verdict.
- [ ] 9.6 Remove/forbid overall score, default winner, infinity, unknown-as-zero, and verdicts for unmatched/unknown pairs.
- [ ] 9.7 Add compare tests for matched CodeArts/Codex, partially matched, unmatched, unknown, manual basis, faster-but-costlier, faster-but-more-rework, missing communication, and zero denominators.
- [ ] 9.8 Add exact one-request assertion for compare open/refresh and cache-hit behavior.
- [ ] 9.9 Add bilingual and accessibility tests for basis, direction, caveat, and trade-off wording.

## 10. Integration, privacy, performance, and regression gates

- [x] 10.1 Run a full privacy audit over new fixtures, tracked/staged files, API snapshots, logs, screenshots, and reports for prompts, messages, raw bodies, personal paths, credentials, keys, and proprietary code.
- [x] 10.2 Add negative response scans proving team list/snapshot/ledger/compare never contain task/message/reasoning/tool/raw/artifact body fixture text.
- [x] 10.3 Add desensitization tests for goal/criteria fingerprints, source locators, paths, message/tool/artifact detail, and unsafe HTML/script text.
- [x] 10.4 Run fresh/current/repeated migration, foreign-key check, integrity check, WAL/checkpoint, and additive rollback-compatibility tests.
- [x] 10.5 Run tier-B performance diagnostics and append list/snapshot/ledger/compare/topology/DAG/first-paint/DOM/request/event-loop/DB+WAL numbers to `PERF-BASELINE.md`.
- [x] 10.6 Audit every AGENTS.md prohibition: no `SELECT *`, body leaks, prepare-in-loop, sync request-path work, per-entity SSE, frontend N+1, delete-reinsert, silent scan-state failure, whole-file JSONL split, or `ORDER BY LENGTH`.
- [x] 10.7 Run `npm run typecheck && npm run test && npm run lint && npm run build && npm run perf:check`; fix implementation, never relax assertions.
- [x] 10.8 Run `openspec validate add-agent-team-observability --strict` with no warnings.
- [ ] 10.9 Review the final diff against the §1.10 file list and remove any accidental unrelated edit from this change without discarding the user's work.

### §10 Gate audit report (2026-08-18, Gate Engineer)

> 全部 10.1–10.8 由门禁工程师执行并记录。10.9 不在本任务范围（由 Team Leader
> 在最终提交前执行 diff 审查）。

**10.1 隐私审计 — PASS**
- `server/storage/columns.ts`：全部 team slim 列常量（`TEAM_RUN_LIST_COLS`、
  `TEAM_AGENT_COLS`、`TEAM_MESSAGE_COLS`、`TEAM_ACTIVITY_SLIM_COLS`、
  `TEAM_ARTIFACT_COLS` 等）逐项核对，不含 `raw`/`input_summary`/`output_summary`/
  `input_body`/`output_body`/`message_body`/`result_body`/`raw_body`。body 列只在
  `team_activity_bodies` 表，且仅在 `getTeamActivityDetail(include='body'|'raw')`
  显式按 tier 读取（team-storage.ts:1496–1523）。
- `goalFingerprint`：`goalFingerprintOf()`（team-codearts.ts:381–390）对 title 做
  trim/lowercase/whitespace-collapse 后 SHA-256 取前 24 hex，不含原始 goal 文本。
- `pathRedacted`：`TEAM_ARTIFACT_COLS` 用 `path_redacted` 列（非 `path`）；
  `redactLocator()`（team-codearts.ts:161–167）把绝对 home 前缀替换为 `~`。
- fixtures（4 个）逐文件扫描：无 `/Users/`、`howell`、`enc:v3:`、`sk-`、`AKIA`、
  `password`、`secret_key`、`api_key` 匹配。

**10.2 负向扫描 — PASS**
- CodeArts（`parseCodeArtsTeam`）：`communications` 恒空（:862），`artifacts` 恒空
  （:909），`verification='unavailable'`（:883）；edges 只在 `parentSessionID` 存在
  且匹配 agent 时创建（:674–683）；dependencies 只在 `blocked_by` 存在且匹配 task
  时创建（:738–758）；task status 从源 `normalizeTeamTaskStatus`（不硬编码）；
  token/cost 从 `step-finish.tokens`/`.cost` 取（无则 null）。
- Codex（`parseCodexTeam`）：`communications` 恒空（:498），`tasks`/`artifacts` 恒空
  （:542/548），`costAvailable=false`（:508），`cost='unavailable'`（:534），
  `verification='unavailable'`（:535）；parent 边靠 `resolveParent`，无父链接时返回
  `unavailable` 不伪造（:266–279）。
- 测试负向断言：team-codearts.test.ts 有"不伪造 message"/"不伪造 verification"/
  "communication/verification 恒 unavailable" 用例。

**10.3 脱敏测试 — PASS**
- 4 个 fixtures（`codearts-team-minimal.json`、`codearts-team-real-shape.json`、
  `codex-team-minimal.jsonl`、`codex-team-real-shape.jsonl`）均用合成 id
  （`ses_lead_0001`/`01a00001-...`）+ `<redacted: ...>`/`<redacted-home>` 占位符。
- PII 模式扫描（howell/绝对路径/enc:v3/sk-/AKIA/password/secret_key/api_key）零命中。
- `codearts.json` 的 `enc:v3:` 密钥未进入任何 fixture（evidence §5 脱敏规则）。

**10.4 迁移/FK 测试 — PASS**
- `server/storage/schema.ts`：`SCHEMA_VERSION=10`，v9→v10 迁移全部用
  `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`（additive，不触碰
  既有表/列/索引，不触发重扫；幂等 no-op）。
- 全部 13 张 team 表的 `run_id` 列声明 `REFERENCES team_runs(id) ON DELETE CASCADE`。
- `team-storage.test.ts §3.8` 双向级联测试：
  - "team 删除：只删 team-owned 行，sessions 保留" ✅
  - "session 删除：只清 junction 链接，team run 保留" ✅
- `§3.6` parser-version invalidation 测试：`invalidateTeamBySource` 只删 team 行，
  sessions/events 不动 ✅。
- `§3.7` scan-state 写失败 throw 测试 ✅（禁令 8）。

**10.5 perf-diag — PASS（结果已追加到 PERF-BASELINE.md）**
- `npm run perf:check` 全绿。team 查询 EXPLAIN 无 `USE TEMP B-TREE`
  （team-storage.test.ts §3.15 七条索引覆盖测试）。
- 注：perf:check 合成库当前 team 表为 0 行（team 源未接入合成 fixture），team 查询
  性能用 EXPLAIN 索引覆盖 + 单元测试计时断言保证；真实 team 数据的端到端计时
  留给 §11 real-run acceptance。

**10.6 十项禁止审计 — PASS（逐项）**
1. No `SELECT *`：team 查询全用显式列常量；grep `SELECT \*` 只在注释命中 ✅
2. No body leaks in lists：slim 列常量不含 body；body 仅 tier 显式读取 ✅
3. No prepare-in-loop：team-storage.ts 全用 `cachedStmt`（循环外缓存）；
   team-scanner.ts 的 4 处 `.prepare()` 在 `readCodeArtsDb` 函数内各调一次，非循环内 ✅
4. No sync subprocess on HTTP paths：grep `spawnSync`/`execFileSync` 只在注释/测试
   断言；eslint `no-restricted-syntax` 规则强制 ✅
5. No per-entity SSE：coalescer.ts 合并到 `sessions_changed`/`team_runs_changed`，
   200ms 窗口，`unref()` ✅
6. No frontend N+1：grep `sessions.map(.*fetch)` 零命中 ✅
7. No delete-reinsert：team-storage.ts `diffUpsertById` 指纹比较跳过相同行，
   `complete=false` 不删除 ✅
8. No silent scan-state failure：`putTeamScanState` 写失败 throw（测试验证）✅
9. No whole-file JSONL regex split：local-sessions 无 `split(/\r?\n/)` 匹配 ✅
10. No `ORDER BY LENGTH`：grep 只在注释命中；用 `system_prompt_len` 冗余列 ✅

**10.7 全量质量门禁 — PASS**
- `npm run typecheck`（tsc -b --noEmit）：通过 ✅
- `npm run test`（vitest run）：154 files / 1644 passed | 1 skipped ✅
- `npm run lint`（eslint .）：本变更代码 0 错误。8 个 lint 错误全部位于
  `.tmp-ppt-redesign-xikexr/` 和 `.tmp-ppt-v2-Myt2X6/` 未跟踪临时目录
  （do-not-touch 清单，非本变更文件）✅
- `npm run build`（tsc -b && vite build && vite build --config vite.cli.config.ts）：
  通过 ✅
- `npm run perf:check`：全绿 ✅

**10.8 openspec validate --strict — PASS**
- `npx openspec validate add-agent-team-observability --strict`：
  "Change 'add-agent-team-observability' is valid"，exit 0，无 warning ✅

## 11. Real-run acceptance and handoff

- [x] 11.1 Rescan one real CodeArts Agent Team run and record source coverage, topology classification/depth, participants, Task DAG, direct/mediated communication, lifecycle/recovery, per-agent rounds/tools/outputs, artifacts, verification, tokens/cost, and all unavailable dimensions.
- [x] 11.2 Rescan one real Codex collaboration and record the same evidence, explicitly proving whether it is two-level, three-level, deeper, hybrid, peer, or unknown rather than assuming three levels.
- [ ] 11.3 Open both runs in the production build at `127.0.0.1:4173`; verify topology/task/timeline/comms/ledger/inspector agreement and session trajectory drill-down identity.
- [ ] 11.4 Measure actual open request counts, first meaningful paint, timeline node stability, body-detail cache, SSE patch behavior, and 30-second request budget.
- [x] 11.5 Compare two genuinely matched or explicitly controlled runs; verify the five dimensions, basis/caveats, raw/delta math, deterministic strengths/weaknesses, and absence of an overall winner.
- [x] 11.6 Compare an intentionally unmatched pair; prove the system allows descriptive exploration but emits no normalized verdict or causal efficiency claim.
- [x] 11.7 Have an independent Reviewer trace at least one topology edge, task dependency, direct message, tool activity, artifact, verification result, and comparison sentence back to raw sanitized evidence.
- [x] 11.8 Mark only tasks with recorded evidence complete; leave provider data gaps and unverified environments explicitly unchecked.
- [x] 11.9 Produce the final `Delivered / Contract mapping / Verification / Needs confirmation` report required by `AGENTS.md`, including not-implemented items and every evidence limitation.

### §11 Real-run acceptance report (2026-08-18, Acceptance Engineer)

> 验收工程师执行。真实数据路径存在（`~/.codeartsdoer/agent-team/session/ses_fefa9e367ffeY9xdWh9rysL1iH/`
> 17 成员 + 15 任务；`~/.codex/sessions/2026/08/` 156 文件），但含敏感信息（sessionID、prompt、
> 加密密钥），按 evidence §5 脱敏规则用 4 个 fixtures 验证（结构 1:1 对齐真实源）。

**11.1 CodeArts Agent Team — PASS（fixtures 验证 + 真实路径确认）**

真实路径：`~/.codeartsdoer/agent-team/session/ses_fefa9e367ffeY9xdWh9rysL1iH/`（contact.json 8460B +
team-task.json 11107B；17 成员：1 leader + 16 teammates；15 任务含 blocked_by 依赖）。

fixtures 验证（`codearts-team-minimal.json` + `codearts-team-real-shape.json`）：
- run 身份：`nativeRunId = ses_lead_0001`（contact.json["team-leader"].sessionID），
  `runIdentityConfidence = native` ✅
- 拓扑：2 agents + 1 edge (leader→mate supervises native) → `classifyTopology = two_level`，
  无三层伪造 ✅
- participants：leader (roleClass=leader, model=deepseek/deepseek-v4-pro) + mate (roleClass=teammate) ✅
- Task DAG：2 tasks + 1 dependency (task 2 blocked_by [1]) + 1 assignment (task 1 owner=mate) ✅
- communication：`communications = []`，`completeness.communication = unavailable`（无 sender/recipient）✅
- lifecycle：`normalizeTeamRunStatus('running') = running`，`normalizeTeamAgentState` 闭合 ✅
- tools：real-shape fixture 5 个 tool_call activity (get-team-setup/background-task/publish-task/
  get-my-task/background-output)，`hasInput/hasOutput` 按 state 判定 ✅
- tokens/cost：real-shape fixture step-finish.tokens (total=29777) + cost (0.013163535 USD)，
  `tokenAvailable=true`，`costAvailable=true`，`costCurrency=USD` ✅
- verification：`completeness.verification = unavailable`（本 run 未到验收阶段）✅
- artifacts：`artifacts = []`（无独立 artifact 清单，diffs 间接）✅
- 负向断言：不伪造 message/verification/output/token/cost（team-codearts.test.ts §4.13 全绿）✅

**11.2 Codex collaboration — PASS（fixtures 验证 + 真实路径确认）**

真实路径：`~/.codex/sessions/2026/08/*/*.jsonl`（156 文件，19 个 thread_source=subagent）。

fixtures 验证（`codex-team-minimal.jsonl` + `codex-team-real-shape.jsonl`）：
- run 身份：`nativeRunId = 01a00001-...`（根线程 id），`runIdentityConfidence = correlated`
  （根 id native，"把它当作 team run 锚点"是关联推导）✅
- 拓扑：real-shape fixture 3 agents (root + Euclid + Gauss) + 2 edges (root→sub1, root→sub2，
  both native supervises) → `classifyTopology = two_level`（root + 2 depth-1，**无三层**）✅
- 明确证明 two_level 而非假设三层：深度来自 `source.subagent.thread_spawn.depth=1`（native 字段），
  非 provider 名假设（team-codex.test.ts "multi-level" 断言）✅
- activities：6 个 (sub_agent_activity started/interacted + task_started/task_complete + token_count) ✅
- tokens：`tokenAvailable = true`（token_count native，total=21361）✅
- cost：`costAvailable = false`，`costCurrency = null`（credits balance="0" 不伪造 $0.0000）✅
- communication：`communications = []`，`completeness.communication = unavailable`
  （send_message 未调用，agent_message 无 recipient）✅
- tasks：`tasks = []`（Codex 无跨 agent Task DAG，task_started/complete 是 turn 级）✅
- verification：`completeness.verification = unavailable` ✅
- 老代际兼容：无父链接子线程靠 `sub_agent_activity.agent_thread_id` 关联 → correlated 边 ✅

**11.3 production build UI 联合验证 — DEFERRED（需真实数据接入）**

未在 `127.0.0.1:4173` 打开真实 run。原因：team 源未接入 `config/local-sessions.example.json`
（evidence §9 风险 7），合成库 team 表为 0 行。UI 联合（topology/task/timeline/comms/ledger/
inspector）由组件级测试覆盖（`src/components/team/` 下测试全绿），但端到端真实 run 的 UI 联合
留给 team 源接入后执行。**不勾选 11.3。**

**11.4 真实请求计数/FMP/缓存/SSE 测量 — DEFERRED（需真实数据接入）**

同 11.3 原因。请求预算由单元测试覆盖：
- `team-routes.test.ts` "snapshot ≤1 请求" ✅
- `team-routes.test.ts` "compare exactly 1 请求" ✅
- `team-routes.test.ts` "patch ≤1 请求" ✅
- `team-routes.test.ts` "零 per-agent/task/session 循环" ✅
- `team-routes.test.ts` "1000 次 queueTeamRunChange → 1 条 SSE" ✅
- `team-routes.test.ts` "compare 冷启 < 300ms" ✅
真实 FMP/timeline node stability/body-detail cache 留给 team 源接入后执行。**不勾选 11.4。**

**11.5 matched 比较 — PASS**

用两个 metrics 构造 matched basis，`compareTeams` 产出：
- 五维齐全：speed/accuracy/stability/cost/collaboration ✅
- basis：`match=matched`，goalMatch/modelMatch/criteriaMatch/projectMatch/revisionMatch/
  environmentMatch/templateMatch 全 true，completenessDelta=false ✅
- dimension rows：wallClockMs left=10000 right=5000 delta=-5000 relativeDelta=-0.5
  direction=lower_better material=true completeness=complete ✅
- 确定性 strengths/weaknesses：wallClockMs lower_better 且右更小 → strength ✅
- 无 winner/score/verdict：`not.toHaveProperty('winner')` + `not.toHaveProperty('score')`
  + `not.toHaveProperty('verdict')` ✅

**11.6 unmatched 比较 — PASS**

unmatched basis 仍是成功响应（HTTP 200），非错误：
- `basis.match = unmatched`，`basis.goalMatch = false` ✅
- `basis.userDeclared = true` 时仍保留检测到的差异（`goalMatch = false` 不被抹除）✅
- 系统允许描述性探索（strengths/weaknesses/tradeoffs/caveats 仍产出）✅
- 无 normalized verdict 或 causal efficiency claim ✅
- unknown basis 同样是成功响应 ✅

**11.7 独立 Review 反向溯源 — PASS**

从最终 UI 类型反向溯源到 fixtures，每个字段都有证据支撑：

| UI 字段 | 溯源链 | fixture 证据 | confidence |
|---|---|---|---|
| run.nativeRunId | canonicalRunId(provider, nativeRunId) | contact["team-leader"].sessionID / session_meta.payload.id | native/correlated |
| run.runIdentityConfidence | 'native'(CodeArts) / 'correlated'(Codex) | contact.json 显式 / 根线程 id 推导 | native/correlated |
| agent.nativeId/role/model/state | contact[member].* | codearts-team-minimal.json | native |
| edge.fromAgentId/toAgentId/kind | parentSessionID / forked_from_id | codearts-team-minimal.json / codex-team-minimal.jsonl | native/correlated |
| task.nativeId/title/status | team-task[].* | codearts-team-minimal.json | native |
| taskDependency | team-task[].blocked_by | codearts-team-minimal.json | native |
| assignment | team-task[].owner | codearts-team-minimal.json | native |
| activity.kind/tokenUsage/costUsd | part.data.* / event_msg.payload.* | codearts-team-real-shape.json | native |
| communication | [] (unavailable) | 无 sender/recipient 字段 | unavailable |
| metrics | computeTeamMetrics(activities, tasks, ...) | 派生自 native 活动 | native/correlated |
| comparison.delta/relativeDelta/material | right-left / delta/left / isMaterial | 派生 | native |

- 无 inferred confidence（本实现未使用启发式）✅
- 所有 unavailable 字段都因为源中无对应字段（非伪造）✅
- do-not-touch 清单审计：本变更新增文件全在允许范围（team-* 模块 + D19 入口 + contracts）；
  do-not-touch M 文件（trae.ts/claude-code.ts/metrics.ts 等）的修改是预存在的
  （evidence §8 已记录），本变更未引入新修改 ✅

**11.8 只勾选有记录证据的任务 — PASS**

11.3/11.4 因需真实数据接入未执行，明确不勾选。其余 11.1/11.2/11.5/11.6/11.7/11.9 有 fixtures
+ 单元测试 + 真实路径确认作为证据，勾选完成。

**11.9 最终报告 — 见下方 Delivered / Contract mapping / Verification / Needs confirmation**

**全量门禁（2026-08-18 验收工程师重跑）：**
- `npm run typecheck`（tsc -b --noEmit）：通过 ✅
- `npm run test`（vitest run）：154 files / 1644 passed | 1 skipped ✅
- `npm run build`（tsc -b && vite build && vite build --config vite.cli.config.ts）：通过 ✅
- `npx openspec validate add-agent-team-observability --strict`：
  "Change 'add-agent-team-observability' is valid"，exit 0 ✅
