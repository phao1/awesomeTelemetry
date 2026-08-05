# Proposal: add-mission-control

## Why

`tengu-lab-dashboard-spec.md`（外部参考实现 Tengu Lab 的逐面板清单）给出了一套
成熟的「Agent 可观测性指挥中心」信息架构：五大战区 32 个 widget + Trace 瀑布页。
逐项核对后，其中**大部分指标的口径本项目已经有数据可以支撑**，只是散落在
`session` 单会话视图里，缺一个跨会话的聚合面。

但 Tengu Lab 的数据底座和本项目**不是一回事**，直接照抄会踩三个坑：

1. Tengu 的一半指标来自 **Claude Code 官方遥测事件**（`tengu_tool_use_success` /
   `tengu_init.permissionMode` / `tengu_sdk_result` / `tengu_api_retry`），需要开
   `CLAUDE_CODE_ENABLE_TELEMETRY` + 自建 OTLP collector。本项目的数据来源是
   **9 家厂商落在本地磁盘的会话文件**（`specs/session-scanning` REQ-006）+ 可选
   MITM 抓包，没有也不应该有这条通道 —— 它只对 Claude 一家成立，会破坏
   `project.md` §1 的跨厂商可比性定位。
2. Tengu 的 Trace 瀑布依赖 **OTel span 的父子关系和真实 start/end**。本项目
   `events.duration_ms` 对 claude / codex / codeagent / opencode-db 恒为 0
   （`src/adapters/claude-code.ts:111,143,167,195`、`codex.ts:88`、
   `opencode.ts:134`），所有「耗时」类面板在当前数据上会全部渲染成 0。
3. Tengu 满屏的 `$` 金额，本项目 `costUsd` 除 workbuddy（credit）外**恒为 0**，
   全仓没有任何定价表。

所以这个 change 做的是**移植口径、不是移植数据源**：先补齐 4 项前置基建，再把
能站得住的指标做成一个服务端聚合的 Mission 视图；站不住的明确拒绝并写下理由，
避免以后反复讨论。

同时 Tengu spec §3 里有一条零成本、高价值的工程习惯值得直接升格为硬要求：
**每个面板标题下必须跟一行「数据口径」小字**（表名 / 字段 / 计算方式）。本项目
`gotchas.md` 里 G4.2 / G4.4 / G5.3 三条都是"口径没钉死导致返工"，这行小字正是
它们的预防措施。

## What Changes

**前置基建（P0，不做这四项后面全是空面板）**

- 事件时长推导：抽出共享 helper，把 `qoder.ts:65` 已有的「相邻时间戳推导」推广到
  claude / codex / opencode-db；新增 `duration_source` 标注真实测量还是推导。
- 模型归因：`events.model` + `sessions.primary_model` 落库（源数据已有，
  `claude-code.ts:33` 的 `ClaudeRawMessage.model` 从未被读取）。
- 成本计算：新增 `src/core/pricing.ts` + `config/model-pricing.json`
  （三层覆盖，同 `gotchas.md` G2.3）；未知模型走 `cost_source='unknown'`
  显示 `—`，**禁止用 0 冒充**。
- 聚合端点：`GET /api/mission`，一次请求返回全部 widget（G11.9 红线：禁止前端
  逐会话拉取）。

**新增视图**

- 第 6 个视图 `mission`：三区（A 使用行为 6 · B 效能质量 15 · C 采集健康 4），
  共 25 个可落地 widget。图1（Trace 瀑布页）的 7 项改进落在已有 session 视图，
  不新开面板。
- 7 个手写 SVG 图表原子（横条 / 环形 / 热力网格 / 堆叠面积 / 直方图 / 日历 /
  柱线组合），**0 新增依赖**。

**明确不做**（理由见 `design.md` §5）

- 权限门禁三件套（A5 Permission Mode / B16 Allowed / B17 Rejected 独立面板）
- B2 的 handoff rate（人工接管率）
- F1-1 的「有建议」「目录规则」
- D 区知识资产 / E 区趣味洞察（源文档截图未覆盖，无内容可复刻）

Schema v1 → v2（首次启用 `contracts/database.md` §2 预留的 `migrations/`）。
无 BREAKING API 变更（纯新增端点 + 新增可空列）。

## Capabilities

### New Capabilities

- `mission-control` — 跨会话指挥中心聚合与展示。

### Modified Capabilities

| Spec | Delta |
|------|-------|
| `contracts/database.md` | schema v1→v2：新增 8 列 + 3 索引 + `migrations/` 首次启用 |
| `contracts/data-model.md` | `TraceEventSlim.model`、`TraceSession.primaryModel/costSource/durationSource`、`MissionResponse` 全套类型 |
| `contracts/api.md` | 新增 `GET /api/mission` §2.4 + 契约测试 |
| `contracts/nfr.md` | §2 新增 mission 端点预算行 + 事件循环让出要求 |
| `specs/metrics-analysis/spec.md` | REQ-012 时长推导 / REQ-013 定价 / REQ-014 错误归类 / REQ-015 场景分类；`METRICS_CALC_VERSION` 2→3 |
| `specs/frontend/spec.md` | REQ-001 五视图→六视图；新增 REQ-027 Mission 视图；REQ-024 hash 增加 `#/mission` |
| `specs/design-system/spec.md` | REQ-008 快捷键 `1`-`5`→`1`-`6`；新增 REQ-010 图表类型选择规则 + 口径行强制要求 |
| `specs/adapters/spec.md` | 时长推导与 model 提取的 adapter 侧要求 |

## Impact

| Area | Impact |
|------|--------|
| Code | 新增 `server/storage/mission.ts`（聚合 SQL）、`src/core/pricing.ts`、`src/core/scene-classifier.ts`、`src/core/error-classifier.ts`、`src/components/MissionControl.tsx` + 7 个图表原子；改动 4 个 adapter |
| Schema | v1→v2，`ALTER TABLE ADD COLUMN` 非破坏性；新列随下一轮扫描回填，无需全量重建 |
| Dependencies | **0 新增运行时依赖**（图表全部手写 SVG，AGENTS.md 硬约束） |
| Performance | ⚠️ 最大风险点：better-sqlite3 是同步 API，一条 300ms 的 `GROUP BY` 会直接把事件循环 p99 顶穿 `nfr.md` §2 的 50ms 预算。要求单 widget SQL < 30ms + 分组间 `await setTimeout(0)` 让出，并新增 `perf-diag/08-mission.mjs` 守门 |
| Tests | 每个 widget 一条口径断言测试（防止 SQL 改写后口径悄悄漂移）；`GET /api/mission` 契约测试；pricing 未知模型返回 null 而非 0 的断言 |
| Docs | `PROGRESS.md` 新增一行；`DECISIONS-PENDING.md` 预留 D-010（定价表数据来源）/ D-011（C2 与 G7.4 的关系） |
