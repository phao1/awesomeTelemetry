# Design: calibrate-tokens-and-compare-report

> **开工前必读 §1 与 §2。** §1 决定你不该做什么，§2 决定你唯一能怎么做。
> 本文件里每条"已落地"的结论都附了行号，动手前请自己打开确认一遍 ——
> 行号会随提交漂移，以文件实际内容为准。

---

## §0 这份变更说明的来历（决定了怎么读它）

来源文档《Token 校准与对比报告重构 — 变更规格说明》描述的是**另一个代码库**
2026-08-04 的一次会话变更。它与本仓库的关系是：

- **结论可信**：Trae 6,898,746 vs DeepSeek 计费 6,902,336（误差 0.05%）、
  CodeArts 4,955,089 vs 4,783,792（+3.6%）都是真实对账数据，不是推理。
- **代码不可移植**：它的"修改前"代码在本仓库一行都找不到。本仓库是 v5 重写版
  （见 `openspec/README.md`），模块划分、文件名、类型系统都不同。
- **部分结论本仓库已独立得出**：`gotchas.md` G4.2 / G4.4 / G4.5 是本项目
  2026-08-03 自己对账 DeepSeek 账单写下的，与该说明的结论一致。两边独立验证到同一
  个答案，这反而是这些结论可信的最强证据。

**读它的正确姿势：把它当作一份"外部实测报告"，不是一份"待应用的 patch"。**

---

## §1 逐项判定表（最重要的一张表）

| 说明章节 | 本仓库现状 | 判定 | 依据 |
|---|---|---|---|
| §2.1 Trae token `/5` 除数 | 无 `TOKEN_DIVISOR`。`src/adapters/trae.ts:110-113` 已是 `output = item_token_usage, input = token_usage - item`（注释 `#2/#3 审查 P0, 2026-08-03 校准`） | ✅ **已落地，跳过** | `gotchas.md` G4.2 |
| §2.1 `historyTimeCreated` 真实时间戳 | 结构不同：本仓库 `local-sessions/trae.ts:85` 直接 `ORDER BY start_time`，无"靠位置推断"。但 `src/adapters/trae.ts:99` 在 `startTime` 缺失时回退 `new Date(0)`（epoch），会把事件甩到时间线最前 | ⚠️ **变体缺口，纳入 B4** | — |
| §2.2-A cache.read 求和 | `src/adapters/helpers.ts:109-113` 已按 `semantics.cacheRead === 'incremental'` 求和；`opencode.ts:283` 已声明 incremental | ✅ **已落地，跳过** | G4.4 |
| §2.2-B reasoning 不加进 output | 已用 `reasoningInTotal` 方言开关（`opencode.ts:29-30, 100-106`），CodeArts 系为 false | ✅ **已落地，跳过** | G4.5 |
| §2.2-C step-finish token 传播到 LLM 事件 | 问题真实存在（见 §2），但**不能按它写的方式做** | 🔴 **改写实现，B1** | 见 §2 |
| §2.3 speed-metrics cache.read 求和 | 同 §2.2-A，已落地 | ✅ **跳过** | G4.4 |
| §2.3 SpeedMetrics 新字段 | `trace-types.ts:307-329` 无 `avgLlmDurationMs` / `cacheHitRate` / `avgTokensPerCall`；`TokenUsage` 无 `netInput` | ❌ **真实缺口，B2** | — |
| §2.4 Trae 工具名映射 / 排序 / 时长 / 状态 | `src/adapters/trae.ts:66-84` 只映射 7 个 type，无 Trae 实际 PascalCase 工具名；排序已有 `orderEventsByTime`（helpers.ts:141，已稳定排序 + 重排 sequence）；同时间戳分摊无；状态用 `normalizeStatus(turn.status)` 不读 `toolResult` | ⚠️ **部分缺口，B4**（排序已有，勿重做） | — |
| §2.5 对比报告 4→3 维 | `CompareBoard.tsx:172` 现为 `fast / frugal / quality / stability` 四维 | ❌ **真实缺口，B5** | — |
| §2.6 TraceMetrics 新字段 | 五个字段全无；`failedCommandCount` 在本仓库**根本不存在**（不是"扩展检测范围"，是新增） | ❌ **真实缺口，B3** | — |
| §2.7 品牌改名 | 本仓库品牌是 `Agent Observability`，不是 `AwesomeTelemetry` | ❌ **目标名以用户裁定为准 = AwesomeTelemetry，B6** | 用户 2026-08-05 裁定 |
| §2.8 端口占用检测 | `server/cli.ts:283-292` 只 `server.listen` 后 reject，无预探测 | ❌ **真实缺口，B7** | — |
| §2.8 Trae systemPrompt 注入 | 本仓库**没有任何 system prompt 捕获机制**，无文件可读 | ⚠️ **前置调查后再定，B7** | 见 §7 |
| §2.9 UI/CSS | `src/App.css` 不存在（本仓库是 `src/styles/{tokens,base,layout,components}.css`）；三个 Compare 子组件不存在（只有 `CompareBoard.tsx`） | ⚠️ **只做 `.cmp-detail-table` + teal，B5/B6** | — |
| §2.10 i18n | `src/i18n/index.ts` 不存在（本仓库是 `src/i18n.ts`）；`compare.*` 已有 40+ 词条 | ⚠️ **按本仓库键名补，B5** | — |
| §4.1 CodeArts 重复计算 | 本仓库用 `isTokenCarrier`（opencode.ts:114-120）从设计上规避 | ✅ **无需修复，但必须加回归测试防 B1 引回，B1** | — |
| §4.2 Trae 子代理未关联 | 本仓库已有 `buildSubagentMergeGroups`（session-merge.ts:74），但 `src/adapters/trae.ts:176` 硬编码 `isSubagent: false`，机制接不上 | ❌ **真实缺口，B8** | 用户裁定纳入 |

**净结论：10 项变更里 3 项已落地跳过、1 项改写、6 项真做，外加 §4.2 一项。**

---

## §2 【最关键裁决】Token 归因绝不写回 `event.tokens`

### 问题是真的

`computeSpeedMetrics` 只从 `kind === 'llm'` 且 `tokens !== null` 的事件算 TPS/TPOT
（`src/core/speed-metrics.ts:31-34`）。而 OpenCode/CodeArts 系的 token 只挂在
`part.type === 'step'` 的事件上，这类事件被映射成 `kind: 'agent'`
（`opencode.ts:176-179`）。两个集合的交集是空的 → **这些 provider 的 tps / tpotMs
恒为 `null`**。变更说明 §2.2-C 想修的就是这个，问题成立。

### 但它给的解法会引爆它自己 §4.1 的 bug

说明里的代码是 `classified[i].inputTokens = classified[j].inputTokens` —— **把 token
写进事件本身**。本仓库的会话级聚合 `aggregateTokenUsage`（helpers.ts:92-128）对所有
`event.tokens !== null` 的事件无差别求和。写回去 = carrier 与被归因的 llm 事件各算
一遍 = 精确复现说明 §4.1 描述的"6,217,079 而正确值 3,249,125"。

这不是推测：`isTokenCarrier` 的注释（opencode.ts:109-113）写着这个坑本项目已经踩过
一次 —— "一条消息的多个 part 共享同一份 message.tokens，若每个 part 都挂 tokens，
会话级聚合会把 token 膨胀 N 倍"。

### 裁决

**新增纯函数做归因，不碰任何持久化字段。**

```
// src/core/speed-metrics.ts（导出，单独测试）
export function attributeTokensToLlmEvents(record: TraceRecord): Map<string, TokenUsage>
```

- 返回 `eventId → TokenUsage` 的**只读映射**，调用方自取，**不写回 record**；
- `event.tokens`、`aggregateTokenUsage`、`isTokenCarrier`、DB 写入路径**一行都不改**；
- `computeSpeedMetrics` 与 `compare-report` 从这个 map 取数。

### 归因规则（三条，缺一不可）

1. **1:1，不是 1:N。** 一个 carrier 的 token 只能归因给**一个** llm 事件。
   说明里的循环对每个无 token 的 llm 事件都去找 carrier，多个 llm 事件会拿到同一份
   token —— TPS 是"每事件 output/duration 的算术平均"（G #11，speed-metrics.ts:47），
   同一份 output 被 3 个事件各算一次，TPS 直接虚高 3 倍。
   **实现方式：carrier 消费后标记已用，不再参与后续匹配。**
2. **方向以实测为准，不要照抄 `i+1..i+5`。** 说明里向后找 5 格是它那个数据结构的经验值。
   本仓库必须先用 `src/adapters/__fixtures__/opencode.ts` 和真实
   `~/.local/share/opencode` 库确认 step part 与 llm part 的实际前后顺序，
   **测试断言按实测写**，不要凭这份说明的数字写。
3. **跨消息不归因。** 只在同一 `message.id` 的 part 之间归因（事件 id 形如
   `${message.id}-${partIndex}`）。跨消息归因会把上一轮的 token 算到下一轮头上。

### 验收（B1 必须有的两条测试）

- `speed-metrics.test.ts`：OpenCode fixture 归因后 `tps !== null && tpotMs !== null`，
  且**归因后的 output 总和 == carrier 的 output 总和**（1:1 的直接断言）。
- `opencode.test.ts`（回归护栏，锁死 §4.1）：
  `computeTokenBreakdown(record).total` 在**调用 `attributeTokensToLlmEvents` 前后
  完全相等**。这条测试的存在意义就是让"把归因写回事件"这个改法一提交就红。

---

## §3 SpeedMetrics / TokenUsage 新字段（B2）

新增到 `src/core/trace-types.ts`，同步 `contracts/data-model.md`：

| 字段 | 所在类型 | 定义 | 算不出来时 |
|---|---|---|---|
| `avgLlmDurationMs` | `SpeedMetrics` | 单次推理平均耗时 = `pureInferenceMs / llmCallCount` | `null` |
| `cacheHitRate` | `SpeedMetrics` | `cacheRead / (input + cacheRead)` | `null`（**不是 0**） |
| `avgTokensPerCall` | `SpeedMetrics` | `total / llmCallCount` | `null` |
| `netInput` | `TokenUsage` | `input - cacheRead`，下限 0 | `0` 合法（真的没缓存） |

> `TokenBreakdown.totalTokens` **不新增**。本仓库 `computeTokenBreakdown` 返回的就是
> `TokenUsage`，它已经有 `total`（helpers.ts:121-127，口径由 G4.5 定义）。再加一个
> `totalTokens` 就是同一个数两个名字，必然有一天两边算法漂移。

**红线：禁止用 `0` 冒充 `null`。** 沿用 add-mission-control 的既定约定 ——
分母为 0 时返回 `null`，UI 渲染 `—`。一个说不清口径的 0 比没有这个数字更糟。

### Trae systemPrompt token 估算

说明提出"无 cache 数据但有 `session.systemPrompt` 时按 `length / 4` 估算"。
**采纳，但必须打标：**

- 只在 `session.systemPrompt !== null` 时估算，`null` 时保持 `null`，**不得填 0**；
- 估算值不得进入 `TokenUsage.input`（那是计费口径，会污染成本计算），只作为
  `SpeedMetrics` 的独立展示字段；
- UI/报告展示时必须标注"估算值（按字符数 ÷ 4）"，criteria 行写明。
- 前置依赖 §7 —— 本仓库当前 Trae 的 `systemPrompt` 恒为 `null`
  （`src/adapters/trae.ts:172`），这条估算在 §7 落地前**永远走不到**。
  先实现 + 单测，不要为了让它生效而去伪造数据源。

---

## §4 TraceMetrics 新字段与 schema v4（B3）

五个新字段进 `TraceMetrics`（`trace-types.ts:293`），跟随既有持久化机制：

| 字段 | 类型 | 口径 |
|---|---|---|
| `totalToolDurationMs` | `number` | `tool !== null` 事件的 `durationMs` 求和 |
| `llmCallCount` | `number` | `kind === 'llm'` 事件数 |
| `userInteractionRounds` | `number` | `kind === 'user_prompt'` 事件数 |
| `hasUnitTests` | `boolean` | 存在 `phase === 'verify'` 且命令/标题命中 `TEST_CMD` 正则的事件 |
| `failedCommandCount` | `number` | `status === 'error'` 且 `kind ∈ {bash, test, tool, file_write, file_read, agent}` 的事件数 |

**连带动作（照抄 add-mission-control B4 的先例，不要自创）：**

1. `SCHEMA_VERSION 3 → 4`（`server/storage/schema.ts:12`）
2. `metrics` 表加 5 列 + 迁移数组追加 5 条 `ALTER TABLE metrics ADD COLUMN`
   （现有迁移在 schema.ts:206-213，照那个格式写）
3. `METRICS_CALC_VERSION 3 → 4`（`src/core/metrics.ts:18`）—— **必须 bump**，
   否则老行的 `calc_version` 已是 3，永远不会触发重算（REQ-005 / G11.11）
4. `server/storage/writers.ts` 与 `query-engine.ts` 读写这 5 列 —— add-mission-control
   的血泪教训是"schema 加了列但存储层没接，widget 全读到空值"，别再犯
5. `server/realtime/sse.test.ts` 里跟随 `SCHEMA_VERSION` 常量的断言会自动过，别去改它

**`failedCommandCount` 与既有 `errorRate` 的关系**：`errorRate` 的分母是 `STEP_KINDS`
事件数（metrics.ts:42-50，含 `llm`）。`failedCommandCount` 是**绝对计数**且**不含
`llm`**（llm 的 error 是模型报错不是命令失败）。两者口径不同是有意的，不要"统一"。

---

## §5 Trae adapter 增强（B4）

### 5.1 工具名映射

现状 `kindOfType`（`src/adapters/trae.ts:66-84`）只按 `turn.type` 映射 7 个值。
Trae 的真实工具名来自 `chat_message_task` 表的 `tool_name`
（`local-sessions/trae.ts:212`），是 PascalCase，当前**全部落进 `'tool'` 兜底**。

新增按 `turn.toolName` 的二级映射（**小写归一化后匹配**）：

- `bash`：`bash` / `terminal` / `runcommand` / `run_command` / `executecommand`
- `file_read`：`read` / `readfile` / `read_file` / `glob` / `grep` / `ls` /
  `codesearch` / `search` / `view`
- `file_write`：`write` / `writefile` / `write_file` / `edit` / `searchreplace` /
  `search_replace` / `str_replace` / `create`

**顺序**：先看 `turn.type`（已有逻辑，优先级高），`type` 落兜底时再看 `toolName`。
**不要**把 `toolName` 提到 `type` 前面 —— `type` 是 Trae 自己的一级分类，更可信。

⚠️ **这份清单是那份外部说明给的，本仓库无法验证。** 落地时必须：
先跑一遍真实 Trae 库统计 `SELECT DISTINCT tool_name FROM chat_message_task`，
按实测结果调整清单，并把实测输出贴进最终报告。拿不到真实库时（见 §7），
按清单实现 + fixture 测试，并记 `D-###` 说明"清单未经实测验证"。

### 5.2 事件排序

**已有 `orderEventsByTime`（helpers.ts:141-148），已经是"时间戳相同则按 sequence
保序 + 排序后重排 sequence"，与说明要求一致。B4 不要重新实现排序。**

真正的缺口在 `src/adapters/trae.ts:98-99`：`startTime` 缺失时回退
`new Date(0).toISOString()`，这些事件会被排到 1970 年，甩在时间线最前面。
改为：缺失时继承**前一个事件**的 `startedAt`（首个事件才用会话 `startedAt`），
让它留在原位而不是飞走。

### 5.3 同时间戳事件组的时长分摊

Trae 的 tool_call 共享父消息时间戳 → 一组事件 `startTime` 完全相同 → 组内除最后一个
外 `durationMs` 全是 0。规则：

- 按 `startedAt` 分组，组内 n 个事件；
- `gap = 下一组的 startedAt - 本组 startedAt`；
- 组内每个事件 `durationMs = gap / n`（整数除，余数给最后一个，保证求和不丢）；
- 单值上限沿用既有 `DERIVED_DURATION_CAP_MS = 300_000`（helpers.ts，**复用，别新定义**）；
- `user_prompt` 不参与（它的 gap 属于 `TimeComposition.userWait`，REQ-012 已定）；
- 会话仍标 `durationSource: 'derived'`（trae.ts:178 已是），UI criteria 行照旧标注
  "含调度间隙"。

### 5.4 tool_call 状态检测

现状 `normalizeStatus(turn.status ?? 'completed')`。新增：当 `turn.toolResult` 存在时，
用正则 `/\b(error|failed|failure|exception|traceback)\b/i` 命中则判 `'error'`。

⚠️ **误判风险已知**：一个成功的 `grep "error" app.log` 的 toolResult 里必然有 "error"。
所以规则限定为：**只在 `turn.status` 缺失或为空时**才用 toolResult 兜底判定；
`turn.status` 有值时以它为准。宁可漏判也不要把成功的搜索判成失败 ——
`failedCommandCount` 和 `errorRate` 都会被污染。

---

## §6 对比报告 4→3 维（B5）

### 6.1 只改展示层，不动契约类型

- **改**：`CompareBoard.tsx` 的 `VerdictDim.key`（:172）、`DIM_ICON`（:332）、
  `DIM_LABEL_KEY`（:339）、`computeVerdict`（:177）、`compare-report.ts` 的
  `competitiveDims` 区块、i18n 的 `compare.dimensions`（现为 `'四维对比'`）。
- **不改**：`TraceDimensionMetrics`（trace-types.ts:280-291）。那是**指标模型**，
  由 `contracts/data-model.md` 与 `metrics-analysis` REQ-004 管辖，
  和"对比页面展示几张卡"是两件事。把它一起改会连带 `AgentOverviewRow`、
  Mission 视图、SQL 聚合一起塌。

### 6.2 三维定义

| 维度 | i18n 键 | 合并来源 | 新增指标 |
|---|---|---|---|
| ⚡ 快 fast | `metric.speed` | 不变 | LLM 调用数、工具总耗时 |
| 💰 省 frugal | `metric.cost` | 不变 | — |
| ✨ 质 quality | `metric.accuracy` | **quality + stability** | 文件写入数、代码精炼度、单元测试、用户交互轮次 |

质维度 8 项指标：边读边写比、文件写入数、代码精炼度、验证覆盖率、单元测试、
失败数、修复循环数、用户交互轮次。

`compare.stabilityDetail` / `compare.why.stability` 两个键**保留但不再被引用** ——
删键会让任何漏改的引用点在运行时静默显示 key 名。留着，加注释标 deprecated。

### 6.3 代码精炼度的口径必须写死

"代码精炼度"在说明里没有定义。**裁决：`totalSteps / fileWriteCount`**（平均每次写入
花掉多少步）。这个口径必须写进 `metrics-analysis` spec 的 Scenario 和 UI 的 criteria
行。**禁止实现一个说不清怎么算的数字。** 如果落地时发现这个口径不合理，
记 `D-###` 换口径，但不许留着不写定义。

---

## §7 服务端（B7）

### 7.1 端口占用探测

在 `startServer` 调 `listen` 前，用 `net.createServer().listen(port, host)` 探测再
`close()`。占用时给出可操作的报错（"端口 X 已被占用，换 `--port` 或先停掉占用进程"），
而不是抛裸 `EADDRINUSE`。
⚠️ 探测与真正 listen 之间存在 TOCTOU 窗口，**`listen` 的 error 处理必须保留**，
探测只是把错误信息变友好，不是替代品。

### 7.2 Trae systemPrompt —— 前置调查，不要硬做

说明里写"从文件加载已捕获的 system prompt"。**本仓库没有这个捕获机制**：
`agent-observe-data/` 下只有 sqlite 三件套，`specs/trae-decryption` 没有 systemPrompt
条目，全仓 grep `systemPrompt` 只有类型定义和读取端。

**执行顺序（不许跳过第 1 步）：**

1. 先确认数据源是否存在：Trae 解密库里有没有 system prompt 字段？
   MITM 抓包（`server/proxy/parsers/trae-tunnel.ts`）能不能拿到？
2. **有** → 实现加载与注入，`GET /api/sessions/:key` 返回时填 `session.systemPrompt`。
3. **没有** → **停在这里，记 `D-###`，不要造一个"约定路径下的文件"**。
   凭空发明一个没人会去写的文件路径，等于让这个功能永远是死代码。
   §3 的 systemPrompt 估算逻辑照常实现（它有单测），只是线上取不到值。

---

## §8 品牌改名 → AwesomeTelemetry（B6）

用户 2026-08-05 裁定：品牌名是 **AwesomeTelemetry**（不是说明里的 myAwesomeTelemetry），
**全量改名**。

| 层 | 现值 | 新值 | 风险 |
|---|---|---|---|
| 页面标题 | `Agent Observability` | `AwesomeTelemetry` | 无 |
| CLI 横幅 (`cli.ts:273`) | `Agent Observability is running at` | `AwesomeTelemetry is running at` | 无 |
| 报告页脚 / i18n | 同上 | 同上 | 无 |
| package name | `agent-observability` | `awesome-telemetry` | 低（private 包） |
| bin 命令 | `agent-observe` | `awesome-telemetry` | 中 |
| 数据目录 | `agent-observe-data` | `awesome-telemetry-data` | **高** |
| localStorage 键 | `agent-observability.theme` | `awesome-telemetry.theme` | **中** |

### 两条兼容回退（不做就是删用户数据）

1. **数据目录**：`defaultDbPath()`（cli.ts:46-49）先看新目录；新目录不存在**且**老目录
   存在 → 继续用老目录并打一行提示。**不要自动搬运**，也**不要静默新建空库**
   —— 用户会以为几个月的扫描历史丢了。
2. **localStorage**：`index.html` 的内联主题脚本先读新键，读不到再读老键
   （读到就顺手写一份新键）。这段脚本在任何 CSS 之前同步执行（G-DS-2），
   **改动后必须实测无闪白**。

`bin/agent-observe.js` 保留为旧名的软链/转发入口一个版本周期，README 里注明。

---

## §9 主题色 → teal（B6）

用户 2026-08-05 授权由本设计裁定。**裁决：做，但按契约做完整。**

理由：既然品牌整体改名，accent 是品牌色的唯一载体；成本有界（6 个 token 值 + 1 处
契约更新），且本仓库已有 T1/T4 断言自动兜住 a11y 回归 —— 这正是当初写那些断言的用途。

### 取值（已按 `tokens.test.ts` 的 WCAG 公式实测，直接用，不要自己挑颜色）

| Token | dark (`:root`, canvas `#0d1117`) | light (`[data-theme="light"]`, canvas `#ffffff`) |
|---|---|---|
| `--accent-fg` | `#2dd4bf` → 对比度 **10.17** ✅ | `#0f766e` → 对比度 **5.47** ✅ |
| `--accent-emphasis` | `#0f766e` → 白字其上 **5.47** ✅ | `#0f766e` → 白字其上 **5.47** ✅ |
| `--accent-subtle` | `rgba(45, 212, 191, 0.15)` | `rgba(15, 118, 110, 0.1)` |

（T4 要求 `--accent-fg` vs canvas ≥ 4.5，`--fg-on-emphasis`(#fff) on `--accent-emphasis`
≥ 4.5。四项全部达标，余量充足。）

### 三条约束

1. **`--phase-implement` 不动**（`#58a6ff` / `#0969da`）。它受 T5 管辖（6 个 phase 色
   两两 ΔE > 15），改它要重算 15 组组合。accent 不是 phase 色，不参与 T5。
2. **`--seg-model` 不动**（`#14b8a6` / `#0d9488`）。实测与新 accent 的 ΔE 为
   45.1（dark）/ 39.7（light），都远超本项目 15 的可辨阈值，无需改。
   若视觉评审仍嫌撞色，备选 `#a78bfa`(dark, 对比度 6.95) / `#7c3aed`(light, 5.70)，
   两者都已验过对比度 —— 但这属于**另开任务**，不在 B6 范围。
3. **同步改 `openspec/contracts/design-tokens.md` §2.2 的 accent 行。** 契约是代码生成
   的权威输入（AGENTS.md 文档优先级第 1 档），代码改了契约没改 = 下一个人按契约写回蓝色。

### favicon

新建 `public/favicon.svg`（本仓库当前**没有 public/ 目录，也没有 favicon**），
teal 圆角方块 + WiFi 波纹，`index.html` 加 `<link rel="icon" type="image/svg+xml">`。
颜色用字面量 hex 即可 —— T2 断言（`tokens.css` 之外无字面量 hex）只扫
`src/styles/**/*.css`，不管 SVG。

---

## §10 Trae 子代理会话关联（B8）

用户裁定纳入。**这是全场唯一必须先调查再设计的任务，禁止直接写代码。**

### 现状（已核实）

- `local-sessions/trae.ts:85` 的查询 **没有 `WHERE session_id`** —— 一个 DB 文件里
  所有 session 的行都被读进来了；
- 但 `sessionId = rows[0].session_id`（:87），而
  `readSessionMeta` / `readHistoryLlmMessages`（:89-90）**只按这一个 session_id 查**；
- `readHistoryLlmMessages` 返回的数组用 `llmMessages[llmIndex++]` 顺序消费（:96）
  —— **如果文件里真有多个 session_id，正文与行的对应关系是错位的**；
- `src/adapters/trae.ts:176` 硬编码 `isSubagent: false`，所以既有的
  `buildSubagentMergeGroups`（session-merge.ts:74）**永远匹配不到 Trae 的子会话**。

### 必须先回答的三个问题（B8-1，产出写进最终报告）

1. 真实 Trae 库的 `server_history_info` 里有几个 distinct `session_id`？
2. 有没有 `parent_session_id` 或等价的父子字段？（`PRAGMA table_info` 全表列一遍）
3. `chat_session` 里子代理会话（`refactor_scoper` / `refactor_finder` /
   `refactor_planner`）的 `agent_type` / `agent_name` 长什么样？

### 决策闸门（B8-2）

| 调查结果 | 走法 |
|---|---|
| 单文件内多 session_id + 有父子字段 | **方案 A**：保持 T-03「1 文件 = 1 会话 key」，在 adapter 内把子代理事件并入主时间线，`actor: 'subagent'` 标记。改动最小，直接消除 37 分钟假空闲 |
| 单文件内多 session_id + 无父子字段 | **方案 A'**：同上，但父子关系按 `agent_type` 是否属于已知子代理名单 + 时间窗推断，`isSubagent` 据此赋值，交给既有 `buildSubagentMergeGroups` |
| 子代理在**独立文件** | **方案 B**：给 Trae 的 session 正确赋 `isSubagent`，复用既有 `buildSubagentMergeGroups`，**不要新写一套合并逻辑** |
| 拿不到真实库（见风险 R1） | **停**。记 `D-###`，只做 `isSubagent` 的赋值逻辑 + fixture 测试，不做合并 |

### 无论走哪条，两条硬约束

- **不许打破 T-03**（索引阶段不解密 → 索引/详情 key 必须都是
  `deriveSessionKey(config.key, filePath)`，trae.ts:261 与 :280）。
  改成"一个文件产出多条 session"会让索引与详情的 key 对不上，制造重复行。
- **顺带修 `llmIndex` 错位**：无论最终方案是什么，`readHistoryLlmMessages` 与
  `rows` 的 session 口径必须一致。这是上面调查过程中一定会撞到的既有 bug。

---

## §11 风险清单

| # | 风险 | 触发条件 | 处置 |
|---|---|---|---|
| R1 | **拿不到真实 Trae / CodeArts 数据** | `config/local-sessions.example.json` 里 `traeKeyPath: null`，Trae 路径是 `%APPDATA%/...`（Windows），当前机器是 macOS | B4/B8 降级为 fixture 驱动 + 记 `D-###`；**禁止编造校准数字**。最终报告必须诚实写明"未经真机验证" |
| R2 | **B1 的归因被后人写回 `event.tokens`** | 有人觉得"存起来更方便" | 回归测试（§2 验收第 2 条）+ `aggregateTokenUsage` 上方加注释警告 |
| R3 | **schema v4 迁移失败** | 老库 ADD COLUMN 冲突 | 沿用既定策略：抛错提示删库重扫，不静默降级 |
| R4 | **品牌改名弄丢用户数据** | 数据目录改名无回退 | §8 的两条兼容回退是**验收项**，不是可选项 |
| R5 | **teal 撞 `--seg-model`** | 视觉评审主观判断 | 已实测 ΔE 39.7/45.1 达标；备选色已备好，但另开任务 |
| R6 | **`failedCommandCount` 被 toolResult 误判撑爆** | `grep "error"` 类命令 | §5.4 已限定"仅 status 缺失时兜底"；B4 必须有一条"成功的 grep error 不判失败"的测试 |
| R7 | **METRICS_CALC_VERSION 忘了 bump** | B3 只加字段不 bump | 老行 calc_version=3 永不重算，新字段全是默认值且无人发现。B3 验收必须实测一次"老库升级后新列有值" |

---

## §12 有意不做的事（不要"顺手修正"回去）

1. **不新建 `TOKEN_DIVISOR`**，也不做任何除法。G4.2 已定死。
2. **不改 `aggregateTokenUsage` / `isTokenCarrier`**。它们是 §4.1 那个 bug 的疫苗。
3. **不改 `TraceDimensionMetrics`**。展示层三维 ≠ 指标模型四维，见 §6.1。
4. **不加 `TokenBreakdown.totalTokens`**。`TokenUsage.total` 已经是它，见 §3。
5. **不重写 `orderEventsByTime`**。已满足说明的排序要求，见 §5.2。
6. **不改 `--phase-implement`**。受 T5 管辖，见 §9。
7. **不为 systemPrompt 发明一个不存在的文件路径**。见 §7.2。
8. **不新增运行时依赖**。沿用全仓约定，favicon 手写 SVG。
