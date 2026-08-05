# Tasks: calibrate-tokens-and-compare-report

> 裁决依据与理由：本目录 `design.md`。**开工前必须读完 design.md §1 与 §2。**
> 每批结束跑 `npm run typecheck && npm run test && npm run lint`，全绿再提交。
> 一个批次一次提交，提交信息格式见 `AGENTS.md`。做完把对应 `[ ]` 勾成 `[x]`。

## ⚠️ 三条最容易做错的事（先看这个）

1. **§2.1 / §2.2-A / §2.2-B / §2.3 的 cache.read 部分，本仓库已经落地了。**
   全仓没有 `TOKEN_DIVISOR`，`src/adapters/trae.ts:110` 已是正确算法，
   `helpers.ts:109` 已是 incremental 求和。**去改会把对的改成错的。**
   核对方式：`grep -rn "TOKEN_DIVISOR" .` 应该零命中。
2. **变更说明 §2.2-C 的代码片段不能照抄。** 它会制造它自己 §4.1 承认的重复计算。
   必须按 design.md §2 的方式做（纯函数归因，不写回 `event.tokens`）。
3. **变更说明里的文件路径大半在本仓库不存在**（`src/i18n/index.ts`、`src/App.css`、
   `CompareSelectorBar.tsx` 等）。本仓库对应物见 design.md §1 表格最后一列。

## 建议执行批次

| 批次 | 范围 | 依赖 | 可否并行 |
|---|---|---|---|
| B1 | §1 Token 归因 + 反双计回归测试 | — | 起点，必须先做 |
| B2 | §2 SpeedMetrics / TokenUsage 新字段 | B1 | — |
| B3 | §3 TraceMetrics 新字段 + schema v4 | B2 | — |
| B4 | §4 Trae adapter 增强 | — | 可与 B1-B3 并行 |
| B5 | §5 对比报告 4→3 维 + i18n | B2, B3 | — |
| B6 | §6 品牌改名 + teal + favicon | — | 可与任意批次并行 |
| B7 | §7 服务端端口探测 + systemPrompt 调查 | — | 可并行 |
| B8 | §8 Trae 子代理关联（含调查闸门） | B4 | 最后做 |
| B9 | §9 收口验收 | 全部 | — |

---

## §1 Token 归因（B1）

**看 design.md §2 的完整裁决再动手。**

- [x] 1.1 在 `src/core/speed-metrics.ts` 新增导出纯函数
      `attributeTokensToLlmEvents(record: TraceRecord): Map<string, TokenUsage>`
- [x] 1.2 实现三条归因规则：**1:1（carrier 消费后标记已用）**、
      **同 `message.id` 内才归因**、**方向按实测确定**
- [x] 1.3 先用 `src/adapters/__fixtures__/opencode.ts` 实测 step part 与 llm part 的
      前后顺序，把实测结论写进函数注释；**不要照抄说明里的 `i+1..i+5`**
- [x] 1.4 `computeSpeedMetrics` 改为 `event.tokens ?? attributed.get(event.id)` 取数，
      使 OpenCode/CodeArts 的 `tps` / `tpotMs` 不再恒为 `null`
- [x] 1.5 测试：`speed-metrics.test.ts` 断言 OpenCode fixture 归因后
      `tps !== null && tpotMs !== null`，且**归因 output 总和 == carrier output 总和**
- [x] 1.6 **回归护栏**：`opencode.test.ts` 断言 `computeTokenBreakdown(record).total`
      在调用归因函数前后**完全相等**（锁死说明 §4.1 的双计 bug）
- [x] 1.7 在 `helpers.ts` 的 `aggregateTokenUsage` 上方加注释：
      "归因结果禁止写回 `event.tokens`，见 change design §2"
- [x] 1.8 确认 `event.tokens` / `isTokenCarrier` / `aggregateTokenUsage` /
      `server/storage/writers.ts` **零改动**（`git diff --stat` 自查）

## §2 SpeedMetrics / TokenUsage 新字段（B2）

- [x] 2.1 `trace-types.ts`：`SpeedMetrics` 加 `avgLlmDurationMs` / `cacheHitRate` /
      `avgTokensPerCall`（均为 `number | null`）
- [x] 2.2 `trace-types.ts`：`TokenUsage` 加 `netInput: number`（`input - cacheRead`，下限 0）
- [x] 2.3 `helpers.ts` 的 `aggregateTokenUsage` 返回值补 `netInput`
      （**只加这一个字段，其余逻辑不动**）
- [x] 2.4 `speed-metrics.ts` 实现三个新指标；分母为 0 一律返回 `null`，**禁止用 0 冒充**
- [x] 2.5 Trae systemPrompt token 估算：`session.systemPrompt !== null` 时按
      `length / 4` 估算，`null` 时保持 `null`；**不得进入 `TokenUsage.input`**
- [x] 2.6 同步 `openspec/contracts/data-model.md` 的 `SpeedMetrics` / `TokenUsage` 定义
- [x] 2.7 测试：三个新指标各一条正常用例 + 一条"分母为 0 返回 null"用例
- [x] 2.8 确认**没有**新增 `TokenBreakdown.totalTokens`（design.md §3）

## §3 TraceMetrics 新字段 + schema v4（B3）

- [ ] 3.1 `trace-types.ts`：`TraceMetrics` 加 `totalToolDurationMs` / `llmCallCount` /
      `userInteractionRounds` / `hasUnitTests` / `failedCommandCount`
- [ ] 3.2 `src/core/metrics.ts` 实现五个字段（口径见 design.md §4 表格）
- [ ] 3.3 **`METRICS_CALC_VERSION 3 → 4`**（metrics.ts:18）+ 更新其上方的版本注释
- [ ] 3.4 **`SCHEMA_VERSION 3 → 4`**（`server/storage/schema.ts:12`）
- [ ] 3.5 `metrics` 表加 5 列 + 迁移数组追加 5 条 `ALTER TABLE`
      （照 schema.ts:206-213 的既有格式）
- [ ] 3.6 `server/storage/writers.ts` 写入 5 个新列
- [ ] 3.7 `server/storage/query-engine.ts` 读取 5 个新列（**禁止 `SELECT *`**，
      按 AGENTS.md 禁令 1 显式列出列名）
- [ ] 3.8 同步 `openspec/contracts/database.md`（metrics 表 + SCHEMA_VERSION）
      与 `contracts/data-model.md`（TraceMetrics）
- [ ] 3.9 测试：五个字段各一条断言 + 一条 v3→v4 迁移测试
- [ ] 3.10 **实测**：拿现有 `agent-observe-data/observe.sqlite` 的副本跑一次升级，
      确认新列**真的有值**（不是全默认值）—— 见 design.md R7

## §4 Trae adapter 增强（B4）

- [ ] 4.1 `src/adapters/trae.ts` 新增基于 `turn.toolName` 的二级 kind 映射
      （清单见 design.md §5.1，**小写归一化后匹配**，`type` 优先级高于 `toolName`）
- [ ] 4.2 若能访问真实 Trae 库：跑 `SELECT DISTINCT tool_name FROM chat_message_task`
      校正清单，把实测输出贴进最终报告；不能访问则记 `D-###` 标注"清单未实测"
- [ ] 4.3 修 `startTime` 缺失回退：`new Date(0)` → 继承前一事件的 `startedAt`
      （首个事件用会话 `startedAt`）
- [ ] 4.4 同时间戳事件组时长分摊：`gap / n`，余数给最后一个，
      复用 `DERIVED_DURATION_CAP_MS`，`user_prompt` 不参与
- [ ] 4.5 tool_call 状态兜底：**仅当 `turn.status` 缺失/为空时**才用 `toolResult`
      关键词判定（design.md §5.4）
- [ ] 4.6 测试：工具名映射三类各一条、时长分摊求和 == gap、
      **"成功的 `grep error` 不判失败"**（design.md R6）
- [ ] 4.7 确认 `orderEventsByTime` **零改动**（design.md §5.2）

## §5 对比报告 4→3 维（B5）

- [ ] 5.1 `CompareBoard.tsx`：`VerdictDim.key` 改为 `'fast' | 'frugal' | 'quality'`，
      同步 `DIM_ICON` / `DIM_LABEL_KEY` / `computeVerdict`（stability 判据并入 quality）
- [ ] 5.2 质维度 8 项指标接线：边读边写比、文件写入数、代码精炼度、验证覆盖率、
      单元测试、失败数、修复循环数、用户交互轮次
- [ ] 5.3 **代码精炼度口径写死为 `totalSteps / fileWriteCount`**，
      写进 spec Scenario 与 UI criteria 行（design.md §6.3）
- [ ] 5.4 `compare-report.ts` 的 `competitiveDims` 区块同步改三维 + 新增指标
- [ ] 5.5 i18n（`src/i18n.ts`，**不是 `src/i18n/index.ts`**）中英文同步新增：
      `compare.dim.quality` / `qualityDesc`、`compare.kpi.{llmCalls,totalLlmDuration,
      avgLlmDuration,totalToolDuration,cacheHitRate,cacheRead,netInput,fileWrites,
      hasUnitTests,userRounds,codeConciseness,fixLoops}`、`compare.yes` / `compare.no`
- [ ] 5.6 `compare.dimensions` 的值 `'四维对比'` → `'三维对比'`（en 同步）
- [ ] 5.7 `compare.why.stability` / `compare.stabilityDetail` 保留 + 标 deprecated 注释
      （**不要删**，design.md §6.2）
- [ ] 5.8 `src/styles/components.css` 加 `.cmp-detail-table` 样式
      （**T2/T3 断言**：禁止字面量 hex，禁止非 `var()` 的 px）
- [ ] 5.9 测试：`compare-report.test.ts` 断言输出含三维、不含四维残留

## §6 品牌改名 + teal + favicon（B6）

- [ ] 6.1 显示层改名：`index.html` `<title>`、`server/cli.ts:273` 横幅、
      报告页脚、i18n 中的品牌串 → `AwesomeTelemetry`
- [ ] 6.2 `package.json`：`name` → `awesome-telemetry`，`bin` 加 `awesome-telemetry`
- [ ] 6.3 数据目录 `agent-observe-data` → `awesome-telemetry-data`，
      **带回退**：新目录不存在且老目录存在 → 用老目录 + 打提示，**不自动搬运**
- [ ] 6.4 localStorage 键 → `awesome-telemetry.theme`，**带回退**：
      读不到新键则读老键并回写新键（`index.html` 内联脚本）
- [ ] 6.5 `bin/agent-observe.js` 保留为转发入口，README 注明
- [ ] 6.6 `src/styles/tokens.css` accent 三件套改 teal，**取值直接抄 design.md §9 表格**
- [ ] 6.7 同步 `openspec/contracts/design-tokens.md` §2.2 的 accent 行
- [ ] 6.8 新建 `public/favicon.svg`（teal 圆角方块 + WiFi 波纹）+ `index.html`
      加 `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- [ ] 6.9 `npm run test` 确认 `src/styles/tokens.test.ts` 的 T1/T4/T5 **全绿**
- [ ] 6.10 **实测**：`npm run dev` 打开页面，确认主题切换无闪白、老 localStorage 键能迁移
- [ ] 6.11 确认 `--phase-implement` 与 `--seg-model` **零改动**（design.md §9）

## §7 服务端（B7）

- [ ] 7.1 `server/cli.ts`：`listen` 前用 `net.createServer` 探测端口占用，
      给可操作的中文报错；**保留原 `listen` error 处理**（TOCTOU）
- [ ] 7.2 测试：端口被占用时报错信息包含端口号与建议
- [ ] 7.3 **调查**（不许跳过）：Trae 解密库 / MITM 抓包里到底有没有 system prompt？
      结论写进最终报告
- [ ] 7.4 有数据源 → 实现加载 + `GET /api/sessions/:key` 注入 `session.systemPrompt`
- [ ] 7.5 无数据源 → **停手，记 `D-###`**，不要发明一个约定文件路径（design.md §7.2）

## §8 Trae 子代理会话关联（B8）

**这是唯一必须先调查再设计的任务。看 design.md §10 的决策闸门。**

- [ ] 8.1 调查并回答三个问题：distinct `session_id` 数量、有无 `parent_session_id`
      等父子字段（`PRAGMA table_info` 全表列一遍）、子代理的 `agent_type` / `agent_name`
- [ ] 8.2 按 design.md §10 的闸门表选定方案 A / A' / B / 停手，**把选择理由写进报告**
- [ ] 8.3 实现选定方案；`src/adapters/trae.ts:176` 的硬编码 `isSubagent: false` 改为
      按调查结论赋值
- [ ] 8.4 顺带修 `local-sessions/trae.ts` 的 `llmIndex` 错位：
      `readHistoryLlmMessages` 与 `rows` 的 session 口径必须一致
- [ ] 8.5 **不许打破 T-03**：索引与详情的 key 都必须是
      `deriveSessionKey(config.key, filePath)`（trae.ts:261 / :280）
- [ ] 8.6 **不要新写一套合并逻辑**，复用 `buildSubagentMergeGroups`（session-merge.ts:74）
- [ ] 8.7 测试：多 session_id 的 fixture → 子代理事件并入主时间线 / 正确成组
- [ ] 8.8 拿不到真实库 → 只做 `isSubagent` 赋值 + fixture 测试，记 `D-###`

## §9 收口验收（B9）

- [ ] 9.1 `openspec validate calibrate-tokens-and-compare-report --strict` 通过
- [ ] 9.2 `npm run typecheck && npm run test && npm run lint` 全绿
- [ ] 9.3 `npm run perf:check`，结果追加到 `PERF-BASELINE.md`
- [ ] 9.4 **真机验证**（不要用"测试全绿"冒充"产品能用"）：
      `npm run build && npm start`，贴出一个真实会话的 `GET /api/sessions/:key`
      响应片段，含新增指标字段的**真实值**
- [ ] 9.5 贴出对比页三维卡片的实际渲染截图或 DOM 片段
- [ ] 9.6 `PROGRESS.md` 追加一行；新增的 `D-###` 汇总进 `DECISIONS-PENDING.md`
- [ ] 9.7 **诚实报告**：哪些结论未经真机验证（尤其 B4 工具名清单、B8 子代理），
      明确写出来，不要含糊
