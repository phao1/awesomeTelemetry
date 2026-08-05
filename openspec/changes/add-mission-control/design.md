# Design: add-mission-control

> 输入：`tengu-lab-dashboard-spec.md`（本地参考，未入库；Tengu Lab 逐面板清单，35 项可评估内容 =
> 图1 的 7 项 + 图2 的 28 个 widget；D/E 两区 4 个 widget 源截图未覆盖，无内容）
> 输出：逐项裁决 + 可融入者的融合方案 + 不可融入者的理由。
>
> **裁决符号**：✅ 直接融入（口径基本一致） · 🔶 改口径融入（数据能支撑但含义
> 必须重新定义） · ❌ 不融入（数据底座缺失，且补齐的代价/副作用不成立）
>
> 统计：**✅ 18 项 · 🔶 18 项 · ❌ 5 项 = 41 个裁决行**。
> 41 > 35 是因为把 Tengu 的「统计卡片」拆成 4 项分别裁决，并额外补入一项源文档
> 没单列、但本项目最该做的 F1-3+（并行度）。
>
> 落到 Mission 视图的 widget 共 **25 个**（A 区 6 · B 区 15 · C 区 4）；
> 图1 的 7 项落在已有的 session 视图，不新开面板。

---

## 0. 结论摘要

Tengu Lab 的**信息架构**几乎可以全盘移植，**数据源**一项都不能移植。

| | Tengu Lab | 本项目 |
|---|---|---|
| 主数据源 | Claude Code 官方遥测 `tengu_*` 事件（1P，需开 `CLAUDE_CODE_ENABLE_TELEMETRY`）| 9 家厂商本地会话文件（JSONL / SQLite / SQLCipher）|
| 结构化 Trace | OTLP collector :4318 收 OTel span（含父子关系、真实 start/end）| 无 OTel 通道；只有 opencode 的可选 otel 源 |
| 抓包 | MITM :8080 | MITM / CDP / Frida（`proxy_requests` 表）|
| 覆盖厂商 | Claude Code 一家 | 9 家，且**跨厂商可比是核心定位**（`project.md` §1）|
| 成本 | 遥测直接给 `$` | **无定价表，`costUsd` 恒为 0** |
| 事件时长 | span end−start，真实 | **主力 provider 恒为 0** |

这张表解释了后面所有 ❌ 和大部分 🔶 的成因：凡是**只能由官方遥测事件属性提供**的
指标（权限模式、SDK 结果、阻塞时长、prompt effort/source），本项目要么拿不到，
要么拿到了也只对 Claude 一家成立 —— 后者比拿不到更糟，因为它会在一个跨厂商对比
产品里制造一列只有一家有数的指标。

---

## 1. 前置基建（P0：不落地这四项，后面 20 个 widget 里有 13 个是空的）

### P0-A 事件时长推导（`durationMs`）

**现状（已核对源码）**：

| Adapter | `durationMs` | 位置 |
|---|---|---|
| claude-code | 恒 0 | `src/adapters/claude-code.ts:111,143,167,195` |
| codex | 恒 0 | `src/adapters/codex.ts:88` |
| opencode（db/jsonl 源）| 恒 0 | `src/adapters/opencode.ts:134` |
| codeagent | 恒 0 | 包装 claude-code（G9.2）|
| opencode（otel 源）| 真实 | `opencode.ts:209` span end−start |
| workbuddy / trae / qoder | 相邻时间戳推导 | `workbuddy.ts:69` / `trae.ts:100` / `qoder.ts:65` |

**影响面**：`avgToolDurationMs`（四维指标之一）、`computeTimeComposition`
（model/tool/idle/userWait 四段）、Tengu 的 F1-3 / B11 / B15 —— 在
claude/codex/codeagent 上全部恒为 0。这是**当前就存在的数据缺陷**，不是这个
change 引入的。

**方案**：`src/adapters/helpers.ts` 抽出

```ts
/** 相邻时间戳推导事件时长。qoder.ts:65 已有先例，此处统一。 */
export function deriveDurations(events: EventWithRaw[]): EventWithRaw[]
```

规则（必须逐条实现，否则推导值会比 0 更有害）：

1. 按时间排序后，`durationMs = next.startedAt − this.startedAt`，最后一个事件为 0。
2. **`user_prompt` 事件不参与推导**，其后的间隔是"用户在思考"，不是模型或工具耗时；
   该间隔归到 `TimeComposition.userWait`（模块已有该语义）。
3. 单事件推导值上限 `DERIVED_DURATION_CAP_MS = 300_000`（5 分钟）。超过说明中间
   隔了一次人类离开，不是执行耗时，截断并计入 `idle`。
4. 推导出的时长**必须标注**：`sessions.duration_source ∈ {'measured','derived','unknown'}`。
   opencode 同时有 db 源和 otel 源，取值按实际解析路径决定，不能按 provider 硬编码。

**红线**：所有消费时长的 UI 面板必须读 `durationSource`，为 `'derived'` 时在口径行
标注「时长为相邻时间戳推导，含调度间隙」。不标注 = 把推导值当测量值卖，属于
`gotchas.md` G4.1 同类错误（Kernel-Inference 含工具时间被当纯推理时间用）。

### P0-B 模型归因（`model`）

源数据已有（`claude-code.ts:33` 声明了 `ClaudeRawMessage.model` 但从未读取），
`proxy_requests` 也有 `model` 列，唯独 `sessions` / `events` 没有。

- `events.model TEXT`（llm 事件写入，其余 null）
- `sessions.primary_model TEXT`（该会话 token 占比最高的模型）

解锁 B13（模型分布）、B6（缓存命中按模型）、B12（上下文窗口按模型）、P0-C（定价按
模型）。**这是跨厂商对比工具的核心维度，优先级高于 Tengu 原生的多数指标。**

### P0-C 成本（`costUsd`）

**现状**：`claude-code.ts:235` / `codex.ts:197` / `opencode.ts:290` /
`qoder.ts:128` / `trae.ts:171` 全部 `costUsd: 0`；只有 `workbuddy.ts:74` 累加
credit。全仓 grep 无任何 pricing / price / perMillion 表。

**方案**：

```ts
// src/core/pricing.ts
export type CostSource = 'reported' | 'estimated' | 'unknown';
export interface ModelPrice {
  /** USD per 1M tokens */
  input: number; output: number; cacheRead: number; cacheWrite: number;
  contextWindow: number;   // B12 复用
  source: string;          // 价格出处 URL + 抓取日期，必填
}
export function computeCostUsd(
  tokens: TokenUsage, model: string | null,
): { costUsd: number; costSource: CostSource }
```

- 价格表放 `config/model-pricing.json`，走 `gotchas.md` G2.3 的三层覆盖
  （内置默认 → 项目级 → 用户级），用户可自己改。
- **未知模型返回 `{ costUsd: 0, costSource: 'unknown' }`，UI 必须渲染 `—`**。
  `specs/frontend` REQ-017/REQ-018 已经规定「null 显示 `—`，禁止用 0 冒充」，
  这里是同一条规则的延伸。
- ⚠️ **内置默认价格严禁凭记忆写**。Anthropic 模型价格查 `claude-api` skill；
  其他厂商（glm / deepseek / qwen 等）逐个查官方定价页，每条记 `source` 字段
  （URL + 日期）。查不到的模型就不写，让它走 `unknown`——空着比编错好。
  数据来源确认后登记 `DECISIONS-PENDING.md` D-010。

### P0-D 聚合端点

Mission 的每一个 widget 都是跨会话聚合。硬约束：

- `gotchas.md` G11.9：任何 `sessions.map(s => fetch(...))` 是设计错误
- `specs/frontend` REQ-003：聚合视图 = **1 个请求**
- `contracts/nfr.md` §2：Agent Overview 的负面基线是 524 请求 / 299.6MB / 4,732ms

⚠️ **本 change 最大的性能风险**：better-sqlite3 是**同步 API**。一条 300ms 的
`GROUP BY` 会把事件循环整整堵 300ms，直接顶穿 `nfr.md` §2 的
「事件循环延迟 p99 < 50ms」。`gotchas.md` G11.6 骂 `spawnSync` 骂的就是这件事，
同步大查询是同一个病。

**约束**（写进 tasks 验收）：

1. 单条 widget SQL 实测 < 30ms @ tier B（524 会话 / 73,588 事件）；超了就必须
   加索引或降级为按时间窗过滤。
2. handler 按 A / B / C 三区分组执行，**组间 `await setTimeout(0)` 让出**一整轮
   事件循环（复用 `specs/session-scanning` REQ-014 的让出模式）。
3. 结果按 `stamp = MAX(sessions.updated_at)` 缓存，复用
   `server/storage/overview.ts` 已有的 `cacheByDb` WeakMap 模式。
4. 新增 `perf-diag/08-mission.mjs` 守门，纳入 `npm run perf:check`。
5. 若 tier B 实测就超预算 → 按 `nfr.md` §7 升级为「扫描后写日粒度 rollup 表」，
   不要靠加索引硬撑。

---

## 2. 逐指标裁决表 —— 图1 · Sessions / Trace 瀑布页

| # | Tengu 项 | 裁决 | 融合方案 / 拒绝理由 |
|---|---|---|---|
| F1-1a | 统计卡：Sessions / Events | ✅ | `COUNT(sessions)` / `SUM(event_count)`，纯 SQL |
| F1-1b | 统计卡：API calls | 🔶 | 只能取 `COUNT(proxy_requests)`，**仅 proxy 通道有效**。scan 通道不经过 MITM，没有"API 调用"概念。口径行必须写「仅 MITM 抓包通道」 |
| F1-1c | 统计卡：Cost Σ | 🔶 | 依赖 P0-C。`cost_source='unknown'` 的会话不计入合计，并在卡片角标注「N 个会话缺定价」 |
| F1-1d | 统计卡：有建议 / 目录规则 | ❌ | Claude Code 专有的 suggestion / directory-rule 埋点概念。本地会话文件不落这两类信号，其他 8 家厂商更没有对应物 |
| F1-2 | 数据源选择器 | ✅ | 已有（`dataSource=scan\|proxy`，G7.4 分开展示）|
| F1-3 | 阶段耗时 LLM/Tool/Blocked/Other | 🔶 | 项目已有 `computeTimeComposition`，四段是 model/tool/idle/**userWait**，比 Tengu 的 Blocked/Other 语义更准。映射 LLM→model、Tool→tool、Blocked→userWait、Other→idle，**沿用本项目命名，不改成 Tengu 的**。前置 P0-A |
| F1-3+ | **span 累加 vs wall-clock = 并行度** | ✅ | ⭐ 整份 Tengu spec 里最有价值的一条口径（53.9s 累加 vs 40.1s wall = 有并行 subagent）。本项目 100% 可复现：`totalDurationMs` 已是 wall-clock（G4.6 明令不许求和），逐事件 `durationMs` 求和即累加值。新增 `parallelismRatio = Σdurations / wallMs`，> 1.2 判定存在并行执行。**两个数必须分开存、分开算**，这条要写进 spec |
| F1-4 | Trace 选择器 / Session 统一视图 | 🔶 | 对应物是 `specs/session-merge`（G10.3 两种模式）。差异：本项目的合并是 `config/session-groups.json` **手工配置**驱动，Tengu 是自动按 trace 拼接。要做到「lead + teammate 拼一条跨 Agent 瀑布」需新增**自动归属**逻辑（按 Task/Agent 工具调用的时间窗 + subagent 会话 `isSubagent` 标志匹配）。可行但属独立能力，本 change 列 P2 |
| F1-5 | 执行 Trace 瀑布图 | ✅ | 已有 `TraceTimeline`（REQ-017：时间比例条 + 树缩进 ≤3 层 + 折叠 + 零时长渲染 2px 竖线）。增量仅两点：父级标签旁显示子 span 数、按 subagent 名区分色阶。前置 P0-A，否则所有条宽为 0 |
| F1-6 | 故事时间线（噪声折叠）| ✅ | 已有 `TranscriptModal` + `event-groups.ts` + `isGenuineUserPrompt`（G10.5 过滤 `<system-reminder>` 等注入）。Tengu 的「tengu 噪声埋点默认折叠」与本项目的降噪规则是同一件事，直接复用 |
| F1-7 | 对话正文查看器 | ✅ | 已有 Inspector tabs。⚠️ 守 G7.8/G11.1：必须分页 + 禁止一次拉 `mode=full` |

---

## 3. 逐指标裁决表 —— 图2 · A 区使用行为

| # | Tengu 项 | 裁决 | 融合方案 / 拒绝理由 |
|---|---|---|---|
| A1 | 工具调用 TOP 榜 | ✅ | `SELECT tool, COUNT(*) AS n, SUM(status='error') AS err FROM events WHERE tool IS NOT NULL GROUP BY tool`。Tengu 的 `WebFetch〔error-only〕3` 标红（全部失败）直接复刻：`err = n` 时标 danger 色。需新增索引 `idx_events_tool` |
| A2 | Skill 使用频率 | 🔶 | 可做：`tool IN ('Skill','SlashCommand')` 的调用计数 + 从 `input_summary` 取 skill 名。**不可做**：Tengu 的「无调用则显示 loaded」分支需要扫 `~/.claude/skills` 目录，超出 `specs/session-scanning` REQ-006 定义的数据边界（只扫 projects 目录）。降级为纯「调用频率」，砍掉 loaded 分支和「近 7 天新见」标记 |
| A3 | Subagent 调用分布 | ✅ | `TraceKind` 已有 `agent` / `subagent_prompt` 两个值。按 `kind='agent'` 聚合，`subagent_type` 从 `input_summary` 的 JSON 里取（新增 `extractSubagentType()`）。`avg subagent/session` 直接可算 |
| A4 | 活跃热力图（星期×小时）| ✅ | 纯 SQL，零新数据。⚠️ **时区**：`contracts/data-model.md` §0 规定所有时间戳是 **UTC ISO**，Tengu 用的是本地 UTC+8。分桶后无法再转换，所以端点必须接 `tz=<offsetMinutes>` 参数在 SQL 里偏移，不能让前端事后转 |
| A5 | Permission Mode 分布 | ❌ | **来源 `tengu_init.permissionMode` 是官方遥测事件属性**。本地 JSONL 无此字段（`ClaudeRawRow` 类型是照真实数据写的，无该键）。要拿到必须开 `CLAUDE_CODE_ENABLE_TELEMETRY` + 自建 OTLP collector —— 那是与 scan/proxy 并列的**第三条数据通道**，不在本项目架构内（`project.md` §3.2 只有两条），且只对 Claude 一家成立。在一个 9 厂商对比产品里做一列只有 1/9 有数的指标，比不做更糟。若确需，另开独立 change `official-telemetry-ingest` |
| A6 | Prompt 习惯 | 🔶 | ✅ length p50/p95：从 `user_prompt` 的 `inputSummary` 长度算（必须先过 `isGenuineUserPrompt` 过滤注入，否则统计的是 `<system-reminder>` 的长度）。✅ keep_going / negative：关键词匹配，属启发式，口径行标注。❌ effort（high/xhigh）/ source（sdk/typed/queued）：遥测属性，本地文件无 |
| A7 | 会话活跃曲线（柱+折线双轴）| ✅ | 纯 SQL：每小时 `COUNT(DISTINCT session_id)` 柱 + `SUM(message_count)` 折线。同 A4 的时区处理 |

---

## 4. 逐指标裁决表 —— 图2 · B 区效能质量

| # | Tengu 项 | 裁决 | 融合方案 / 拒绝理由 |
|---|---|---|---|
| B1 | 任务闭环 · E2E | 🔶 **重定义** | `tengu_sdk_result` 只覆盖 print/SDK 模式（Tengu 自己的脚注也承认了）。本项目无此事件 → 重定义为**会话完成度**：成功率 = `status='success'` 会话占比（adapter 已归一化 completed→success，`specs/adapters` REQ-010）；E2E p50/p90/p99 = `total_duration_ms` 分位数（wall-clock，G4.6）；turns = `message_count`。⚠️ **口径与 Tengu 完全不同，面板脚注必须写死，禁止沿用 Tengu 的数字含义对比**。`repair sess` → 复用已有 `session-findings.ts` 的 `repairLoop` 规则命中会话数（这是个现成的好映射）。`saw_retry` ❌ 无对应信号 |
| B2 | 重试与人工接管 | 🔶 **大幅降级** | ① API retries：🔶 仅 proxy 通道（`proxy_requests` 里同 URL 短窗重复 + 5xx/429），scan 通道无。② **blocked_on_user ≥500ms：❌ 不做**。本地会话文件不记录权限等待时长；唯一可推断的代理信号是「assistant tool_use → tool_result 时间差」，但那里面混着工具真实执行时间，**无法分离**。做一个说不清的数比不做更糟。③ deny/reject：🔶 启发式 —— tool_result 里被拒绝会带固定文案，属文本匹配，有误报，口径行标「启发式」。④ **Handoff rate 整体删除**：Tengu 的精确公式是 `blocked≥500ms ∪ tool_decision deny/reject ∪ permission reject` 三个条件的并集，本项目三缺二，凑出来的比率会误导 |
| B3 | 成本效率 | 🔶 | 前置 P0-C。`$/turn = costUsd / message_count`；`$/成功工具 = costUsd / 成功 tool 事件数`；`$/sdk 成功` → 改为 `$/成功会话`。`cost_source='unknown'` 的会话从分子分母同时剔除并公示剔除数 |
| B4 | 工具失败率榜 | ✅ | 纯 SQL。分母 = 该工具总尝试，分子 = `status='error'`。⚠️ Tengu 的分子含 permission reject，本项目只有 error → 口径行注明差异 |
| B5 | Token 消耗趋势（堆叠面积）| ✅ | 按日 `SUM(token_input/output/cache_read/cache_write)`。⚠️ **必须在 SQL 注释里写死 G4.4/G4.5**：cacheRead 是**增量**语义用 SUM 不用 MAX（2026-08-03 实测推翻旧假设）；total 含 cacheWrite；reasoning 是否入 total 看 adapter 的 `reasoningInTotal`（#6）。不写清楚，跨 provider 的日趋势会串味 |
| B6 | API 质量 · TTFT / Cache | 🔶 **拆两半** | ① **Cache hit ✅**：`SUM(cache_read) / SUM(input + cache_read + cache_write)`，零新数据、纯 SQL、高价值，是本区性价比最高的一格。② **TTFT 🔶**：已有 `computeSpeedMetrics.ttftMs`（#1：首个 user_prompt → 首个 llm 的**时间差**，不是 llm 的 durationMs），但**运行时计算不持久化** → 跨会话聚合会触发 N+1（G11.9 红线）。必须给 `metrics` 表加 `ttft_ms` / `e2e_ms` 列并 bump `METRICS_CALC_VERSION`（G11.11：改算法不 bump 版本 = 脏数据无声留库）。③ API calls / error rate 🔶：仅 proxy 通道 |
| B7 | Token 用量 · Session 场景分布 | 🔶 **新能力，P2** | 需要一个 prompt→场景 分类器（12 类）。项目有 `user_prompt` 正文，可做。⚠️ 两条硬约束：(a) 正文必须先过脱敏引擎，**且聚合端点只返回 `{scene, sessionCount, tokenSum}`，正文绝不出服务端**（Tengu 自己也标了"正文不回传"）；(b) 规则/关键词分类准确率有限 → 必须保留「未分类」「其它」两个逃生舱，Tengu 也是这么做的 |
| B8 | 重任务 Session 场景分布 | ✅ | 依赖 B7 + token 阈值（≥10万/20万/50万）。B7 落地后近乎零成本 |
| B9 | 失败原因分布 | 🔶 | `events.error` 是自由文本，无结构化 errorCode。新增 `classifyErrorText(error)` 归一到有限类（network / timeout / permission / shell / parse / notfound / other）。口径行标「派生分类，非厂商原始错误码」。⚠️ Tengu 脚注「合并计数可能双计一次失败」的坑本项目不存在（只有一个来源）|
| B10 | 高风险命令审计 | ✅ ⭐ | 高价值且**数据已经在库里**：`kind='bash'` 或 shell 类工具，正则扫 `input_summary`。⚠️ 三条红线：(a) 返回的命令预览必须走脱敏引擎（`specs/desensitization`）；(b) 预览限长 200 字符并计入响应预算（G11.1 精神：列表不带 body）；(c) 正则禁止嵌套量词（G11.13 回溯爆炸）|
| B11 | 性能漂移 · 日序列 | ✅ | 按日聚合成功率 / E2E p95 / tool fail / $ per turn。依赖 P0-A + P0-C + B6 的持久化 |
| B12 | 上下文压力 · 压缩 | 🔶 **拆两半** | ① **利用率 ✅**：单次 LLM 请求的 context ≈ `input + cacheRead + cacheWrite`（`events.tokens_json` 里已有）。窗口大小取 P0-C 定价表的 `contextWindow` 字段（**禁止硬编码 200k** —— glm/deepseek 窗口不同，硬编码会算错）。peak / P50 / P95 / ≥80% / ≥95% + 利用率直方图全可算。② **压缩检测 🔶**：Claude JSONL 是否带 compact 标记**本次未能实地验证**（无权读取 `~/.claude/projects`）。给两条路：(a) 先验证字段，有则用；(b) 无则用**上下文骤降启发式** —— 相邻两次 LLM 请求 context 从 X 掉到 Y 且 `Y < X*0.5`，判定发生压缩，`saved = X−Y`。③ **manual vs auto ❌**：无信号可区分，删掉这个维度 |
| B13 | 模型分布 · 成本 | 🔶 | 前置 P0-B + P0-C，之后是纯 SQL。⭐ **跨厂商对比工具的核心表，优先级应高于 Tengu 原生的多数指标** —— Tengu 只有一家厂商所以这张表对它是附属品，对本项目是主菜 |
| B14 | 任务纵深分布 | ✅ | `metrics.tool_call_count` 直方图，分桶 0 / 1-5 / 6-15 / 16-40 / 41+。零新数据，指标已持久化（G5.3 v5 改为持久化的直接受益）|
| B15 | 工具生态 · 耗时 / I/O | 🔶 | ① duration p50/p95：前置 P0-A。② bytes in/out：`length(input_summary)` 是**全表扫描**，events 表到 500k 行会拖垮预算 → 随 P0-B 一起加冗余列 `input_len` / `output_len`（与 G11.3 的 `system_prompt_len` 是同一套路，项目已有先例）。③ MCP：工具名前缀 `mcp__` 判定 ✅。④ reject：同 B2 启发式 |
| B16 | 权限门禁 · Allowed | ❌ | 来源 `tengu_tool_use_can_use_tool_allowed` 是遥测事件，理由同 A5。且**退化后等于 A1**（工具调用计数）—— 做一个和 A1 数字几乎一样的面板，只会让人怀疑两个面板哪个是错的 |
| B17 | 权限门禁 · Rejected/Errors | 🔶 **不独立立面板** | errors 部分已被 B4 完全覆盖；rejected 部分是 B2 的启发式。合并进 B4 的"失败率榜"，用不同色标区分 error 与 疑似 reject |

---

## 5. 逐指标裁决表 —— 图2 · C 区可观测性健康

C 区是 Tengu spec 里**唯一没有现成对应模块**的部分（源文档 §4 自己也说了「12 个
模块里没有直接对应的」）。但它的**精神**恰恰是本项目最需要的：

> `gotchas.md` G11.5 的教训原文：「缓存和增量机制需要一个**它确实生效了的正向
> 断言**，否则会完全无声地失效」——`scan_state` 实测 0 行，表在、索引在、就是没
> 数据，增量扫描整个是假的，没有任何告警。

C1 面板就是把这条教训变成常驻可见的 UI。这是整份 Tengu spec 里**最应该抄的一格**。

| # | Tengu 项 | 裁决 | 融合方案 |
|---|---|---|---|
| C1 | 观测栈探活 | 🔶 **改造后价值最高** ⭐ | Tengu 探的是它自己的栈（collector:4318 / mitm:8080 / Langfuse / `TENGU_DROP_UPSTREAM`）。本项目的栈不同 → 重定义为**采集健康**，且 80% 数据已存在只是没汇总：<br>· 9 个 provider 扫描状态 —— `GET /api/providers/status` 已有（enabled / sessionCount / lastScanAt / ready / blockedBy，含 Trae 的 `TRAE_KEY_MISSING`）<br>· proxy running/starting/port —— `/api/proxy/status` 已有<br>· frida running/pid —— `/api/frida/status` 已有<br>· DB / WAL 大小 + schemaVersion + uptime —— `/api/health` 已有<br>· **`SELECT COUNT(*) FROM scan_state`** —— G11.5 的正向断言，为 0 时红色告警<br>· watcher 存活（chokidar / poll 各 provider 最近一次触发时间）<br>Tengu 的"服务日志 mtime"子表 → 替换为"各 provider 最近扫描时间" |
| C2 | 双通道覆盖 | 🔶 **改造后价值高** ⭐ | Tengu 的双通道 = OTel(3P) ∩ Tengu(1P)。本项目的双通道 = **scan ∩ proxy**。`proxy_requests.parsed_session_id` + 时间窗关联（G5.4）已具备关联能力 → 可算 双通道 N / 仅 scan N / 仅 proxy N。Tengu 那两个**成因提示 tag** 的做法值得直接抄：「仅 scan × N —— 检查 MITM 是否在跑 / CA 证书是否已信任」「仅 proxy × N —— 检查该 provider 是否 enabled / 路径是否配对」<br>⚠️ **与 G7.4 的关系必须显式声明**：G7.4「scan/proxy 分开展示，不混」禁止的是**混列会话行**；本面板只对比**计数**、不并列会话条目，不构成违反。这一点最容易被误判，登记 `DECISIONS-PENDING.md` D-011 |
| C3 | 任务日历 | ✅ | 纯 SQL：按日 `COUNT(DISTINCT session_id)` + `MAX(status='error')` 标红。同 A4 的时区处理 |
| C4 | 热会话 · 成本 / 下钻 | ✅ | 现在按 token 排序，P0-C 落地后按 `$` 排序。下钻复用已有 hash 路由（`specs/frontend` REQ-024：`#/sessions?key=<id>`），零新增机制 |
| D 区 | 知识资产 | ❌ | **源文档截图未覆盖，无内容可复刻**。且从标题推断（Skill / Memory / CLAUDE.md 资产盘点）其数据在 `~/.claude/skills`、`CLAUDE.md` 等**会话文件之外**，超出本项目数据边界 |
| E 区 | 趣味洞察 | ❌（P3 可选）| 同样无源内容。若要自造，可从现有数据零成本派生（熬夜编码时段分布、最长会话、最贵单次调用、连续工作天数）。不属于"融合 Tengu"，属于自研，本 change 不做 |

---

## 6. 视觉与工程规范的移植（Tengu spec §3）

| Tengu §3 条目 | 裁决 | 说明 |
|---|---|---|
| 深色主题优先 | ✅ 已有 | `contracts/design-tokens.md` 双主题全变量集，T1 断言强制两套 key 相等 |
| 语义配色 | ✅ 已有 | `--phase-*` 六阶段色 + 四态语义色。⚠️ 项目 `specs/design-system` REQ-004 明确「颜色不单独承载语义」（必须配图标/文字），比 Tengu 的纯色区分更严，**以本项目为准** |
| **图表类型分工规则** | ✅ **升格为 REQ** | Tengu spec 原话「这个"图表类型选择规则"本身就值得直接写进 frontend 模块规范」—— 采纳。写入 `specs/design-system` REQ-010：占比→环形图 · 趋势→面积/折线 · 时间×类目→热力图 · 排行→横向条形 · 明细→表格 · Trace→甘特 |
| **每个面板标题下一行"数据口径"小字** | ✅ **升格为强制** ⭐ | 整份 Tengu spec 里性价比最高的一条工程习惯，零成本。本项目 `gotchas.md` G4.2 / G4.4 / G5.3 三条都是"口径没钉死导致返工"，这行小字正是它们的预防措施。写入 `specs/design-system` REQ-010：**每个 widget 必须携带 `criteria` 字段**（表名 / 字段 / 计算方式 / 覆盖范围），由服务端随数据一起下发，前端不得自行编写 —— 服务端下发才能保证 SQL 改了口径行跟着改 |

---

## 7. 契约变更

### 7.1 Schema v1 → v2

首次启用 `contracts/database.md` §2 预留的 `migrations/` 机制（当前为空目录）。

```sql
-- v1 → v2
ALTER TABLE events   ADD COLUMN model        TEXT;
ALTER TABLE events   ADD COLUMN input_len    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events   ADD COLUMN output_len   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN primary_model   TEXT;
ALTER TABLE sessions ADD COLUMN cost_source     TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE sessions ADD COLUMN duration_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE metrics  ADD COLUMN ttft_ms      REAL;
ALTER TABLE metrics  ADD COLUMN e2e_ms       REAL;

CREATE INDEX IF NOT EXISTS idx_events_tool          ON events(tool);
CREATE INDEX IF NOT EXISTS idx_events_session_kind  ON events(session_id, kind);
CREATE INDEX IF NOT EXISTS idx_sessions_started_prov ON sessions(started_at DESC, provider);
```

- `ADD COLUMN` 非破坏性，新列随**下一轮扫描自然回填**，不需要全量重建 DB。
- `METRICS_CALC_VERSION` 2 → 3，触发四维指标 + 新增 ttft/e2e 重算（G11.11）。
- ⚠️ 新增索引会增加写成本。`contracts/database.md` §4 有一条明确警告：**不要建
  已被复合索引前缀覆盖的单列索引**。`idx_events_tool` 不是任何现有复合索引的
  前缀，成立；`idx_events_session_kind` 与已有 `idx_events_session_seq` /
  `idx_events_session_phase` 并列，需实测确认收益后再决定是否保留。

### 7.2 `GET /api/mission`

| Param | Type | Default | 说明 |
|---|---|---|---|
| `range` | `'7d' \| '30d' \| 'all'` | `'7d'` | 时间窗 |
| `dataSource` | `'scan' \| 'proxy'` | `'scan'` | G7.4 |
| `tz` | number | `0` | 本地时区偏移分钟数，用于 A4/A7/C3 分桶 |

```ts
/** 每个 widget 的统一信封 —— 这是本设计的核心机制 */
interface MissionWidget<T> {
  id: string;
  /** 数据口径：表名/字段/计算方式/覆盖范围。服务端下发，前端不得自撰。 */
  criteria: string;
  /** false 时 data 为 null，前端渲染 EmptyState + reason，禁止渲染 0。 */
  available: boolean;
  /** available=false 时必填，如 'NO_PRICING_TABLE' / 'DURATION_NOT_MEASURED' */
  unavailableReason: string | null;
  data: T | null;
}

interface MissionResponse {
  meta: {
    range: string; generatedAt: string; tz: number;
    widgetCount: number; durationMs: number;   // ← Tengu 顶部那行 meta，值得抄
    stamp: string; cached: boolean;
  };
  usage:   { toolTop; skillTop; subagent; heatmap; promptHabits; activity };
  quality: { closure; retry; costEfficiency; toolFailure; tokenTrend; apiQuality;
             scenes; heavyScenes; errorReasons; riskyCommands; drift;
             contextPressure; models; depth; toolEcology };
  health:  { collectors; dualChannel; calendar; hotSessions };
}
```

`MissionWidget` 信封是这套设计的关键：**一个算不出来的 widget 要说出它为什么算
不出来，而不是渲染 0**。这直接落实 `specs/frontend` REQ-017/018 的
「null 显示 `—`，禁止用 0 冒充」，也让 P0 基建未完成时视图仍然可用可解释。

### 7.3 NFR 新增预算行

| 场景 | 预算 | 验证 |
|---|---|---|
| `GET /api/mission` 冷启 | **< 500ms / 1 请求 / < 120KB (gzip)** | `perf-diag/08-mission.mjs` |
| `GET /api/mission` 缓存命中 | **< 20ms** | 同上 |
| 单 widget SQL | **< 30ms @ tier B** | 逐条 EXPLAIN + 计时断言 |
| 事件循环 p99（mission 请求期间）| **< 50ms**（沿用 §2）| 三区之间 `await setTimeout(0)` 让出 |

### 7.4 自动刷新：**显式否决 Tengu 的做法**

Tengu 顶部有「60s 自动刷新」复选框。本项目**不做轮询**：

- `specs/frontend` REQ-023 已明令「状态栏禁止轮询 `/api/health`」
- 项目已有 SSE + `stamp` 失效机制（`contracts/api.md` §3.1）
- `nfr.md` §2 有「30s 窗口内总请求 < 15」的预算

→ 改为 **SSE `sessions_changed` 驱动的 stamp 失效 + 手动刷新按钮**。这是一条
有意偏离参考实现的决定，写进 tasks 验收。

---

## 8. UI 落位

新增第 6 个视图 `mission`（当前 5 个：session / agent / compare / proxy / frida）。

- `specs/frontend` REQ-001：五视图 → **六视图**
- `specs/design-system` REQ-008：快捷键 `1`-`5` → **`1`-`6`**
- `specs/frontend` REQ-024：hash 路由新增 `#/mission?range=7d`
- 单列主区（非三栏），三个区块 chip 导航（A 使用行为 / B 效能质量 / C 采集健康）

**需新增 7 个手写 SVG 图表原子**（现有只有 `BarMeter` + `Sparkline`）：
`HBarChart` / `DonutChart` / `HeatmapGrid` / `StackedAreaChart` / `Histogram` /
`CalendarGrid` / `ComboBarLine`。

⚠️ **0 新增依赖**（AGENTS.md 硬约束：只有 `@tanstack/react-virtual` 一个前端例外）。
这 7 个组件是本 change 前端侧的主要工作量，不要低估。

---

## 9. 优先级与分批

| 批次 | 内容 | 产出 |
|---|---|---|
| **P0** | A/B/C/D 四项前置基建 | 时长、模型、成本、聚合端点就位 |
| **P1** | 零新数据的 8 个 widget：A1 A3 A4 A7 B4 B14 C1 C3 | 不依赖 P0-A/B/C，可与 P0 并行，先出可见成果 |
| **P2** | 依赖 P0 的 9 个 widget：F1-3 B1 B3 B5 B6 B11 B12 B13 B15 C4 | 主体 |
| **P3** | 新能力：B7/B8 场景分类器、B9 错误归类、B10 高风险命令、A2 Skill 频率、A6 Prompt 长度、F1-4 自动 trace 归属 | 增量 |
| **不做** | A5 · B16 · B17（独立面板）· B2 handoff · F1-1d · D 区 · E 区 | 见 §3-§5 理由 |

**建议先做 P1**：这 8 个 widget 一行 schema 都不用改、一个 adapter 都不用动，纯
SQL + 前端，能在 P0 落地前就把 Mission 视图的骨架立起来，也能提前暴露 §7.3 的
性能风险。

---

## 10. 风险清单

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 同步 SQL 堵事件循环，顶穿 nfr p99 50ms | 单 widget < 30ms + 三区之间让出 + perf-diag 守门；超标则升级为日粒度 rollup 表 |
| R2 | 推导时长被当测量时长用 | `duration_source` 落库 + 口径行强制标注 + UI 读该字段 |
| R3 | 定价表写错导致成本全错 | 每条价格必带 `source`（URL + 日期）；查不到就留空走 `unknown` 显示 `—`；Anthropic 价格查 `claude-api` skill，禁止凭记忆 |
| R4 | C2 被误判为违反 G7.4 | 设计中已显式声明「只对比计数、不混列会话行」；登记 D-011 |
| R5 | B7 场景分类把正文泄漏出服务端 | 端点只返回 `{scene, count, tokenSum}`；正文先过脱敏；加契约测试断言响应体不含 prompt 文本 |
| R6 | B10 命令预览泄漏敏感信息 | 走脱敏引擎 + 限长 200 字符 + 正则禁嵌套量词（G11.13）|
| R7 | schema v2 迁移失败导致库不可用 | `ADD COLUMN` 非破坏性；迁移失败时回退到"重建 DB"路径并告知用户需重新扫描 |
| R8 | 20 个 widget 的口径随 SQL 改写悄悄漂移 | 每个 widget 一条口径断言测试（给定 fixture，断言具体数值），这是唯一能防漂移的手段 |
