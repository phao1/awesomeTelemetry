# Proposal: calibrate-tokens-and-compare-report

## Why

外部来源的《Token 校准与对比报告重构 — 变更规格说明》（2026-08-04 会话，27 文件
+1306/-536）记录了一次针对 CodeArts vs Trae 对比场景的 Token 校准与报告重构。
它的**结论有真实计费数据背书**（DeepSeek 账单对账，Trae 误差 0.05%），值得吸收。

但它**不是针对本仓库写的**。逐文件核对后确认：

- 它描述的"修改前"状态（`local-sessions/trae.ts` 里的 `TOKEN_DIVISOR = 5`、
  `Math.max` 取 cache.read、`src/i18n/index.ts`、`src/App.css`、
  `CompareSelectorBar/CompareSpeedMetrics/CompareTimeline` 三个组件）
  **在本仓库全部不存在**；
- 它的三条核心校准结论（Trae token 不做除法、cache.read 求和、reasoning ⊄ 加法）
  **本仓库已经落地**，并已写进 `openspec/gotchas.md` G4.2 / G4.4 / G4.5 —— 是本项目
  2026-08-03 自己对账得出的，与该说明独立同源；
- 它 §2.2 问题 C 提出的"把 step-finish token 前向传播到 LLM 事件"，**如果照抄会
  直接制造它自己在 §4.1 里承认的重复计算 bug**。本仓库用
  `src/adapters/opencode.ts:114` `isTokenCarrier()` 从设计上规避了这个坑
  （注释 `#5（审查 P0）`），照抄等于把已经填平的坑重新挖开。

所以本 change **不是"应用那份 diff"，而是"把那份说明里对本仓库仍然成立的部分，
按本仓库的架构重新实现"**。判定结果见 `design.md` §1 对照表：10 项变更中
3 项已落地（跳过）、1 项必须改写实现方式、6 项是真实缺口。

真实缺口里最有价值的一条：**本仓库 OpenCode/CodeArts 系的 TPS / TPOT 恒为 `null`**。
原因是 token 只挂在 `kind='agent'` 的 step 事件上（`isTokenCarrier`），而
`computeSpeedMetrics` 只从 `kind='llm'` 事件取数（`src/core/speed-metrics.ts:31`），
两边永不相交。这正是那份说明 §2.2-C 想解决的问题，问题真实存在，只是解法要换。

## What Changes

九个批次，`tasks.md` 有逐条清单：

1. **Token 归因（不改聚合）** —— 新增纯函数把 carrier 事件的 token **1:1** 归因到
   最近的 llm 事件，只供速度指标与报告读取；`event.tokens` 与
   `aggregateTokenUsage` 一字不动，并补回归测试锁死"不得双计"。
2. **SpeedMetrics / TokenUsage 新字段** —— `avgLlmDurationMs` / `cacheHitRate` /
   `avgTokensPerCall` / `netInput`；Trae 无 cache 数据时按 systemPrompt 估算。
3. **TraceMetrics 新字段 + schema v4** —— `totalToolDurationMs` / `llmCallCount` /
   `userInteractionRounds` / `hasUnitTests` / `failedCommandCount`；
   `SCHEMA_VERSION 3→4` + `METRICS_CALC_VERSION 3→4`。
4. **Trae adapter 增强** —— 工具名映射覆盖 Trae 实际 PascalCase 工具名、同时间戳
   事件组的时长分摊、tool_call 状态改为读 `toolResult` 关键词。
5. **对比报告 4→3 维** —— 展示层 `fast / frugal / quality` 三维（stability 并入
   quality）+ 详细指标表；`TraceDimensionMetrics` 契约类型**不动**。
6. **品牌统一为 AwesomeTelemetry** —— 显示层 + package/bin/数据目录/localStorage
   全量改名，老路径与老 key 带兼容回退。
7. **主题色改 teal + 新 favicon** —— 同步更新 `contracts/design-tokens.md`，
   给出实测对比度值，T1/T4/T5 断言必须继续通过。
8. **服务端** —— 启动前端口占用探测；Trae systemPrompt 注入（需前置调查）。
9. **Trae 子代理会话关联** —— 先实地调查再设计，含决策闸门。

## Impact

- **Affected specs**: `metrics-analysis`（REQ-004/005/006/007/009 修改 + 2 条新增）、
  `adapters`（Trae 工具名/状态/时长）、`design-system`（accent token）、
  `session-merge`（Trae 子代理）
- **Affected contracts**: `contracts/data-model.md`（SpeedMetrics/TokenUsage/
  TraceMetrics 字段）、`contracts/database.md`（metrics 5 个新列 + SCHEMA_VERSION 4）、
  `contracts/design-tokens.md`（accent 三件套）
- **Affected code**: `src/core/{speed-metrics,metrics,compare-report,token-breakdown,
  trace-types}.ts`、`src/adapters/trae.ts`、`src/components/CompareBoard.tsx`、
  `src/i18n.ts`、`src/styles/tokens.css`、`server/{cli,server}.ts`、
  `server/storage/{schema,writers,query-engine}.ts`、`local-sessions/trae.ts`、
  `index.html`、`public/favicon.svg`（新建）
- **不受影响（明确划出）**: `aggregateTokenUsage` / `isTokenCarrier` /
  `TraceDimensionMetrics` 类型 / `TOKEN_DIVISOR`（不存在，勿新建）
- **Breaking**: schema v3→v4 走既有 ADD COLUMN 迁移，失败抛错提示删库重扫
  （沿用 add-mission-control 的既定策略）；品牌改名涉及数据目录与 localStorage 键，
  必须带兼容回退，不得让老用户数据消失
