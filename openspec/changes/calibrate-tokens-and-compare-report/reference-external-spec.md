> ⚠️ **这是外部参考资料，不是本仓库的待办清单。**
>
> 来源：另一个代码库 2026-08-04 会话的变更说明（27 文件 +1306/-536）。
> 它描述的"修改前"代码在本仓库**一行都不存在**，文件路径大半对不上，
> 其中三项结论本仓库已独立落地，一项照抄会引入 bug。
>
> **判定结果见同目录 `design.md` §1 的逐项对照表。以 design.md 为准。**
> 本文件只保留原文供追溯（尤其是它的 DeepSeek 计费对账数据，那部分是可信的实测）。

---

# Token 校准与对比报告重构 — 变更规格说明（外部来源原文）

> 2026-08-04 会话变更。27 个文件，+1306/-536 行。

## 1. 背景与目标

对比 CodeArts vs Trae 在同一任务（密码重置功能）下的表现时，发现 Token 数据与
DeepSeek 计费真实值存在巨大偏差：

| Agent | 修复前 Token | DeepSeek 计费真实值 | 偏差 |
|-------|-------------|-------------------|------|
| Trae | 1,387,071 | 6,902,336 | **-79.9%** |
| CodeArts | 6,217,079 | 4,783,792 | **+30.0%** |

根因：
- **Trae**：扫描器错误地将 `token_usage` 除以 5（基于"只有 1/5 行对应 DeepSeek"的错误假设）
- **CodeArts**：适配器将 step-finish token 传播到 LLM 事件后，会话级聚合对所有事件求和，导致翻倍

## 2. 变更清单（原文摘要）

- §2.1 Trae 扫描器移除 `TOKEN_DIVISOR = 5`；`input = total - output`；
  `historyTimeCreated` 用 `server_history_info.created_at` 真实时间戳
- §2.2 OpenCode 适配器：cache.read 由 `Math.max` 改为求和；reasoning 不加进 output；
  step-finish token 前向传播到 LLM 事件
- §2.3 speed-metrics 同步 cache.read 求和；新增 `cacheRead` / `netInput` /
  `totalTokens` / `avgLlmDurationMs` / `cacheHitRate` / `avgTokensPerCall`；
  Trae system prompt 按 `length / 4` 估算
- §2.4 Trae 适配器：工具名映射扩展到 PascalCase、事件按时间戳稳定排序、
  同时间戳事件组的时长均分、tool_call 状态改读 `toolResult` 关键词
- §2.5 对比报告 4 维（快/准/稳/省）→ 3 维（快/省/质），准+稳合并入质，
  质维度 8 项指标
- §2.6 `TraceMetrics` 新增 `totalToolDurationMs` / `llmCallCount` /
  `userInteractionRounds` / `hasUnitTests`；`failedCommandCount` 扩展检测范围
- §2.7 品牌重命名 + favicon + 主题色改 teal `#0d9488`
- §2.8 服务端端口占用检测 + Trae system prompt 加载
- §2.9 UI/CSS：`.cmp-detail-table` 样式、主题色切换、Compare 组件布局
- §2.10 i18n 中英文同步新增词条

## 3. 校准验证（**这部分是可信实测，本仓库结论与之独立吻合**）

### Trae

| 指标 | 修复后值 | DeepSeek 计费 | 误差 |
|------|---------|--------------|------|
| Total tokens | 6,898,746 | 6,902,336 | -0.05% |
| LLM 调用数 | 85 | 85 | 0% |

数据库中全部 85 行 `llm_default` 的 `config_name` 均为 `deepseek-v4-pro`，
100% 是 DeepSeek 调用，不需要除法。

### CodeArts (Set1 合并)

| 指标 | 修复后值 | DeepSeek 计费 | 误差 |
|------|---------|--------------|------|
| Total tokens | 4,955,089 | 4,783,792 | +3.6% |

Token 语义实测结论：`total = input + output + cache.read + cache.write`，
`reasoning ⊂ output`（不是加法关系）；`step-finish` 的 `tokens.cache.read` 是
**增量**（每步的缓存命中量），应求和。

## 4. 原文「已发现未修复的问题」

### 4.1 CodeArts 适配器 Token 重复计算

**根因**：step-finish token 传播到 LLM 事件（用于速度指标），但会话级 `reduce`
对所有事件求和时，LLM 事件和 step-finish 事件的 token 被计算了两次。

**影响**：CodeArts 主会话 input = 6,217,079，正确值应为 3,249,125。

> 📌 **本仓库注**：这是 §2.2 传播方案的直接后果。本仓库用
> `isTokenCarrier()` 从设计上规避，**因此 §2.2-C 不得照抄**。见 design.md §2。

### 4.2 Trae 子代理会话未关联

**现象**：Trae 会话中有 37 分钟"空闲 gap"，实际是后台 subagent
（`refactor_scoper` / `refactor_finder` / `refactor_planner`）在运行，
消耗 454,933 token（31 次 LLM 调用），但这些是独立 `session_id`，未关联到主会话。

**修复方向**：扫描器识别 Trae 的 parent_session_id 关系，将子代理事件合并到主会话时间线。

> 📌 **本仓库注**：已纳入本 change 的 B8，但**必须先实地调查再设计** ——
> 本仓库的 Trae 扫描器查询没有 `WHERE session_id`，多 session 行其实已经读进来了，
> 症状可能与原文不同。见 design.md §10。
