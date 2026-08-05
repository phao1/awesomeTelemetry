# Tasks: add-mission-control

> 裁决依据与理由：本目录 `design.md`。**开工前必须读完 design.md §0/§1/§10。**
> 前置：`add-palette-and-a11y` 已 archive。
> 每个批次结束都要跑 `npm run typecheck && npm run test && npm run lint`；
> M3 起还要 `npm run perf:check` 并把结果追加到 `PERF-BASELINE.md`。

## ⚠️ 已落地的前置工作（2026-08-05，勿重做）

以下已写入仓库，`npm run typecheck` 与 `npm run test`（382 passed）均绿。
**接手时先读这些文件再动手，不要重新实现。**

| 文件 | 已完成 | 仍缺 |
|---|---|---|
| `src/core/trace-types.ts` | `CostSource` / `DurationSource` 枚举；`TraceEventSlim.model`；`TraceSession.primaryModel/costSource/durationSource`；**`MissionWidget<T>` + `MissionResponse` 全套类型** | — |
| `src/core/pricing.ts`（新） | `computeCostUsd` / `lookupContextWindow` / `normalizeModelId`；内置 9 个 Anthropic 模型价格（含 cacheRead=input×0.1、cacheWrite=input×1.25、contextWindow），每条带 `source` | 未接 `config/model-pricing.json` 加载器（`setModelPriceOverrides` 已导出，没人调用） |
| `config/model-pricing.example.json`（新） | 覆盖层模板 + 填写规范 | — |
| `src/adapters/helpers.ts` | `deriveDurations()`（四条规则全实现）、`pickPrimaryModel()`、`DERIVED_DURATION_CAP_MS` | — |
| `claude-code.ts` / `codex.ts` / `opencode.ts` | 接入 deriveDurations + model 提取 + computeCostUsd；opencode 按 otel/db 源动态取 measured/derived | — |
| `trae.ts` / `workbuddy.ts` / `qoder.ts` | 标注 `durationSource: 'derived'` | 无 model 字段，costSource 保持 unknown（符合预期） |
| `server/storage/schema.ts` | **SCHEMA_VERSION 1→2**；sessions/events/metrics 共 8 个新列；`idx_events_tool`；`migrateSchema()` v1→v2（ADD COLUMN 幂等 + 失败抛错提示删库重扫） | — |
| `server/realtime/sse.test.ts` | 断言改为跟随 `SCHEMA_VERSION` 常量 | — |

**下一步的第一件事（最关键的缺口）**：`server/storage/writers.ts` 与
`server/storage/query-engine.ts` **还没有读写这 8 个新列** —— adapter 已经产出
`primaryModel/costSource/durationSource/model`，但存储层把它们丢了；schema 里
的列目前无人写入。§2.2 / §2.3 / §3.5 就是这件事，必须先补，否则后面所有
widget 读到的都是空值。

已做的决策（**不要再问，也不要推翻**）：

1. **定价表** —— 只收录有权威出处的 Anthropic 模型（出处：`claude-api` skill
   models 表，cached 2026-06-24）。glm/deepseek/qwen 等**故意留空**走 `unknown`
   显示 `—`。编一个错价格比留空更糟，且错得极难发现。
2. **compact 检测** —— 放弃"读 Claude JSONL 的 compact 字段"这条路（无法实地
   验证），只做**上下文骤降启发式**（相邻 LLM 请求 context 掉超过 50%）。它对
   9 家厂商都成立，比只对 Claude 成立的字段法更符合本项目定位。
   `manual vs auto` 维度删除。
3. **schema 迁移失败的回退** —— `ADD COLUMN` 非破坏性，真失败就抛错，由启动
   自检提示用户删库重扫。DB 是本地文件的派生缓存，半迁移状态比重扫危险得多。
   （已实现，见 `migrateSchema`）

---

## 建议执行批次（按真实依赖排，一次会话做一批）

| 批 | 章节 | 内容 | 为什么是这个顺序 |
|---|---|---|---|
| **B1** | §0 | 8 处契约改动 | AGENTS.md 文档优先级第 1-4 条：契约是代码生成的权威输入，先改契约再改代码 |
| **B2** | §4 + §8.1 | 聚合端点骨架 + 7 个 SVG 图表原子 | **任何 widget 都要先有这两样**。§4 出 `MissionWidget` 信封和 schema v2 迁移，§8.1 出渲染能力 |
| **B3** | §5 + §8.2/8.3/8.5/8.6 | P1 八个零新数据 widget + Mission 视图外壳 | 不依赖 §1-§3，能最快跑通端到端，并提前把 §7.3 的性能风险打出来 |
| **B4** | §1 + §2 | 时长推导 + 模型归因 | 两者都动 adapter，一起做避免重复回归 |
| **B5** | §3 | 定价与成本 | 依赖 §2 的 model |
| **B6** | §6 | P2 十个 widget | 依赖 B4 + B5 |
| **B7** | §7 | P3 新能力 | 纯增量，可随时停 |
| **B8** | §8.4/8.7 + §9 | SSE 刷新 + i18n + 全量验收 | 收口 |

> ⚠️ 原先写的「§5 可与 §1-§4 并行」只在**不含前端渲染**时成立。B2 是所有
> widget 的硬前置，不要跳。

---

## 0. 契约先行（改代码之前先改契约，AGENTS.md 文档优先级第 1-4 条）

- [x] 0.1 `contracts/database.md`：schema v1→v2，写入 design.md §7.1 的 8 列 +
      3 索引；`SCHEMA_VERSION` 常量 1→2；§2 的 `migrations/` 从"预留空目录"
      改为"首个迁移已落地"
- [x] 0.2 `contracts/data-model.md`：新增 `TraceEventSlim.model`、
      `TraceSession.primaryModel / costSource / durationSource`、
      `CostSource` 枚举、`MissionWidget<T>` / `MissionResponse` 全套类型
- [x] 0.3 `contracts/api.md`：新增 §2.4 `GET /api/mission`（含 `range`/
      `dataSource`/`tz` 三参数）+ §8 契约测试用例
- [x] 0.4 `contracts/nfr.md` §2：新增 design.md §7.3 的 4 行预算
- [x] 0.5 `specs/metrics-analysis/spec.md`：新增 REQ-012（时长推导）/
      REQ-013（定价）/ REQ-014（错误归类）/ REQ-015（场景分类）；
      `METRICS_CALC_VERSION` 2→3
- [x] 0.6 `specs/frontend/spec.md`：REQ-001 五视图→六视图；新增 REQ-027
      Mission 视图；REQ-024 hash 增加 `#/mission`
- [x] 0.7 `specs/design-system/spec.md`：REQ-008 快捷键 `1`-`6`；新增 REQ-010
      （图表类型选择规则 + **每个 widget 必须携带服务端下发的 `criteria` 口径行**）
- [x] 0.8 `specs/adapters/spec.md`：时长推导 + model 提取的 adapter 侧要求

---

## 1. P0-A 事件时长推导（design.md §1 P0-A）

- [ ] 1.1 `src/adapters/helpers.ts` 新增 `deriveDurations(events)`，严格实现
      design.md §1 P0-A 的 4 条规则（`user_prompt` 不参与推导 / 上限 5 分钟截断 /
      末事件为 0 / 返回 `durationSource`）
- [ ] 1.2 接入 `claude-code.ts`、`codex.ts`、`opencode.ts`(db+jsonl 源)；
      `codeagent.ts` 经 claude-code 包装自动继承（G9.2）
- [ ] 1.3 opencode 的 **otel 源保持 `measured`**（`opencode.ts:209` 已是真实
      span 时长），不要被 db 源的推导覆盖 —— `duration_source` 按实际解析路径取值，
      **禁止按 provider 硬编码**
- [ ] 1.4 `sessions.duration_source` 落库；`AgentOverviewRow` / Mission 的所有
      耗时类 widget 的 `criteria` 行读该字段，为 `derived` 时标注
      「时长为相邻时间戳推导，含调度间隙」
- [ ] 1.5 测试：claude fixture 推导后 `avgToolDurationMs > 0`；`user_prompt`
      后的间隔计入 `TimeComposition.userWait` 而非 `model`/`tool`；
      超 5 分钟的间隔被截断
- [ ] 1.6 ⚠️ 回归确认：`computeTimeComposition` / `session-findings` 的
      `idleHigh`/`ttft` 规则在时长从 0 变为非 0 后行为仍正确（这两处此前是在
      "全 0" 的输入上跑的，可能有隐含假设）

## 2. P0-B 模型归因

- [ ] 2.1 `claude-code.ts` 读取 `message.model`（类型已声明于 `:33`，从未被读）
      写入 llm 事件；codex / opencode / trae / workbuddy 各自找到对应字段，
      **找不到就写 null，不要猜**
- [ ] 2.2 `events.model` + `sessions.primary_model`（按 token 占比最高者）落库
- [ ] 2.3 `events.input_len` / `output_len` 冗余列（design.md §4 B15：避免
      `length()` 全表扫描，同 G11.3 `system_prompt_len` 套路）
- [ ] 2.4 测试：claude fixture 的 model 正确落库；无 model 的 provider 为 null
      且不报错

## 3. P0-C 定价与成本

- [ ] 3.1 `src/core/pricing.ts`：`ModelPrice` / `CostSource` /
      `computeCostUsd(tokens, model)`
- [ ] 3.2 `config/model-pricing.json` + `.example.json`，三层覆盖（G2.3）
- [ ] 3.3 ⚠️ **内置默认价格严禁凭记忆写**：Anthropic 模型价格用 `claude-api`
      skill 查证；其他厂商逐个查官方定价页。每条必填 `source`（URL + 抓取日期）
      和 `contextWindow`。**查不到的模型不写**，让它走 `unknown`
- [ ] 3.4 未知模型返回 `{ costUsd: 0, costSource: 'unknown' }`，
      UI 渲染 `—`；测试断言**不得渲染 `$0.0000`**
- [ ] 3.5 `sessions.cost_source` 落库；workbuddy 的 credit 路径标 `reported`
- [ ] 3.6 在 `DECISIONS-PENDING.md` 登记 **D-010**：定价表数据来源与更新责任人

## 4. P0-D 聚合端点骨架

- [x] 4.1 `server/storage/mission.ts`：`getMission(db, {range, dataSource, tz})`
- [x] 4.2 `MissionWidget<T>` 信封：每个 widget 必带 `criteria` /
      `available` / `unavailableReason`（design.md §7.2）
- [x] 4.3 stamp 缓存：复用 `server/storage/overview.ts` 的 `cacheByDb`
      WeakMap 模式（**不要新造一套**）
- [x] 4.4 ⚠️ 三区之间 `await setTimeout(0)` 让出事件循环（design.md §7.3 R1）
- [x] 4.5 `GET /api/mission` 路由；入口调 `markForegroundRequest()`（api §0.6）
- [x] 4.6 schema v2 迁移：`server/storage/migrations/001-v1-to-v2.ts`；
      迁移失败时回退"重建 DB + 提示需重新扫描"，不得让库处于半迁移状态
- [x] 4.7 `perf-diag/08-mission.mjs` + 纳入 `npm run perf:check`

## 5. P1 零新数据 widget（**可与 §1-§4 并行，建议先做完这批**）

> 这 8 个不改 schema、不动 adapter，纯 SQL + 前端。先立骨架，也提前暴露性能风险。

- [ ] 5.1 A1 工具调用 TOP 榜（含 error-only 全失败标红）
- [ ] 5.2 A3 Subagent 分布 + `extractSubagentType(inputSummary)`
- [ ] 5.3 A4 活跃热力图（⚠️ `tz` 偏移在 SQL 里做，分桶后无法再转换）
- [ ] 5.4 A7 会话活跃曲线（柱 + 折线双轴）
- [ ] 5.5 B4 工具失败率榜（口径行注明：分子只含 error，不含 permission reject）
- [ ] 5.6 B14 任务纵深直方图（`metrics.tool_call_count` 分桶）
- [ ] 5.7 **C1 采集健康**（design.md §5：汇总 providers/proxy/frida/health 四个
      已有端点 + **`SELECT COUNT(*) FROM scan_state` 为 0 时红色告警** —— 这是
      G11.5 那条教训的正向断言，是本区最有价值的一格）
- [ ] 5.8 C3 任务日历
- [ ] 5.9 逐 widget 口径断言测试（给定 fixture 断言具体数值，design.md §10 R8：
      这是唯一能防止口径随 SQL 改写漂移的手段）

## 6. P2 依赖 P0 的 widget

- [ ] 6.1 F1-3 阶段耗时四段（沿用本项目 model/tool/idle/userWait 命名，
      **不要改成 Tengu 的 LLM/Tool/Blocked/Other**）
- [ ] 6.2 ⭐ **F1-3+ 并行度**：`parallelismRatio = Σdurations / wallMs`，
      两个数分开存分开算，> 1.2 判定存在并行执行（design.md §2：这是整份
      Tengu spec 最有价值的一条口径）
- [ ] 6.3 B1 会话完成度（⚠️ **口径与 Tengu 的 `tengu_sdk_result` 完全不同**，
      脚注必须写死；`repair sess` 复用 `session-findings.ts` 的 `repairLoop`）
- [ ] 6.4 B3 成本效率（unknown 成本的会话从分子分母同时剔除并公示剔除数）
- [ ] 6.5 B5 Token 日趋势（⚠️ SQL 注释里写死 G4.4/G4.5：cacheRead 增量用 SUM
      不用 MAX；total 含 cacheWrite；reasoning 看 `reasoningInTotal` #6）
- [ ] 6.6 B6-a **Cache hit 命中率**（零新数据、纯 SQL、本区性价比最高）
- [ ] 6.7 B6-b TTFT/E2E 持久化：`metrics.ttft_ms` / `e2e_ms` +
      `METRICS_CALC_VERSION` 2→3（G11.11：不 bump 版本 = 脏数据无声留库）
- [ ] 6.8 B11 性能漂移日序列
- [ ] 6.9 B12 上下文压力（窗口取定价表的 `contextWindow`，
      ⚠️ **禁止硬编码 200k**）+ 压缩检测：先实地验证 Claude JSONL 是否有 compact
      标记，无则用"上下文骤降 > 50%"启发式；**manual/auto 维度直接删掉**
- [ ] 6.10 B13 模型分布 · 成本（⭐ 跨厂商工具的核心表）
- [ ] 6.11 B15 工具生态耗时/IO（bytes 用 §2.3 的冗余列，不用 `length()`）
- [ ] 6.12 C2 双通道覆盖（scan ∩ proxy）+ 两个成因提示 tag；
      在 `DECISIONS-PENDING.md` 登记 **D-011**：本面板只对比计数、不混列会话行，
      不构成违反 G7.4
- [ ] 6.13 C4 热会话（按 `$` 排序，下钻复用 `#/sessions?key=` hash 路由）

## 7. P3 新能力

- [ ] 7.1 B9 `classifyErrorText()` 错误归类（口径行标「派生分类，非厂商原始错误码」）
- [ ] 7.2 B10 高风险命令审计（⚠️ 三条红线：走脱敏引擎 / 预览限长 200 字符 /
      正则禁嵌套量词 G11.13）
- [ ] 7.3 B7 场景分类器（⚠️ **端点只返回 `{scene, count, tokenSum}`，正文绝不
      出服务端**；保留"未分类"/"其它"逃生舱；加契约测试断言响应体不含 prompt 文本）
- [ ] 7.4 B8 重任务场景分布（B7 + token 阈值切换）
- [ ] 7.5 A2 Skill 调用频率（**砍掉 loaded 分支与"近 7 天新见"标记** ——
      需扫 `~/.claude/skills`，超出 REQ-006 数据边界）
- [ ] 7.6 A6 Prompt 长度分布（⚠️ 先过 `isGenuineUserPrompt` 过滤注入，
      否则统计的是 `<system-reminder>` 的长度；**砍掉 effort/source 维度**）
- [ ] 7.7 F1-4 subagent 自动 trace 归属（按 Task/Agent 工具调用时间窗 +
      `isSubagent` 匹配，补充现有手工 `config/session-groups.json`）

## 8. 前端

- [x] 8.1 7 个手写 SVG 图表原子：`HBarChart` / `DonutChart` / `HeatmapGrid` /
      `StackedAreaChart` / `Histogram` / `CalendarGrid` / `ComboBarLine`
      （⚠️ **0 新增依赖**，AGENTS.md 硬约束；这是前端侧主要工作量）
- [ ] 8.2 `MissionControl.tsx` 单列主区 + A/B/C 三区 chip 导航
- [ ] 8.3 顶部控制条：`range` 7d/30d/all + 手动刷新 + meta 行
      （`generated / widgets N / xxxms` —— Tengu 这行值得抄，它把耗时暴露给用户，
      正好配合 nfr 预算）
- [ ] 8.4 ⚠️ **显式否决 Tengu 的 60s 自动刷新**：改为 SSE `sessions_changed`
      驱动的 stamp 失效 + 手动刷新（REQ-023 禁止轮询 / nfr「30s 窗口 < 15 请求」）
- [ ] 8.5 每个 widget 渲染服务端下发的 `criteria` 口径行；
      `available=false` 时渲染 `EmptyState` + `unavailableReason`，
      **禁止渲染 0**（REQ-022 四态 + REQ-017「null 显示 —，不许用 0 冒充」）
- [ ] 8.6 第 6 个视图接入：`AppShell` tab、快捷键 `6`、hash `#/mission?range=`
- [ ] 8.7 i18n：所有新增字符串 zh + en 双份（REQ-010），含 `criteria` 口径文案
      和 `unavailableReason` 的人话映射

## 9. 验收

- [ ] 9.1 `GET /api/mission` 契约测试：1 请求返回全部区块；每个 widget 都有
      非空 `criteria`；`available=false` 时 `data === null` 且
      `unavailableReason !== null`
- [ ] 9.2 性能：冷启 < 500ms / 缓存 < 20ms / < 120KB gzip / 单 widget SQL < 30ms；
      mission 请求期间事件循环 p99 < 50ms
- [ ] 9.3 前端网络面板实测：进入 mission 视图**请求数 = 1**（G11.9 红线）
- [ ] 9.4 定价缺失路径：未知模型的会话在成本类 widget 里显示 `—`，
      且从 `$/turn` 的分子分母同时剔除
- [ ] 9.5 口径漂移守门：§5.9 的逐 widget 数值断言全绿
- [ ] 9.6 脱敏：B10 命令预览、B7 场景分布的响应体断言不含未脱敏正文
- [ ] 9.7 schema 迁移：v1 库升 v2 后原有会话可正常打开；新列在下一轮扫描后回填
- [ ] 9.8 `PROGRESS.md` 追加一行；`PERF-BASELINE.md` 追加 perf:check 结果
- [ ] 9.9 `openspec validate add-mission-control --strict` 通过

---

## 10. 明确不做（改口径前先回头读 design.md §3-§5 的理由）

- [ ] 10.1 A5 Permission Mode 分布 —— 遥测专有字段，且只对 Claude 一家成立
- [ ] 10.2 B16 权限门禁 Allowed —— 同上，且退化后等于 A1，做了只会让人怀疑
      两个面板哪个是错的
- [ ] 10.3 B17 独立面板 —— errors 已被 B4 覆盖，rejected 是启发式，合并进 B4
- [ ] 10.4 B2 handoff rate —— Tengu 的三条件并集本项目三缺二，凑出来会误导
- [ ] 10.5 F1-1d 「有建议」/「目录规则」—— Claude Code 专有埋点概念
- [ ] 10.6 D 区知识资产 / E 区趣味洞察 —— 源文档截图未覆盖，无内容可复刻；
      且 D 区数据在会话文件之外

> 这 6 项若后续要翻案，**必须先补齐 design.md §0 表格里对应的那行数据底座**，
> 不要靠"凑个近似值"落地 —— 一个说不清口径的数字比没有这个数字更糟。
