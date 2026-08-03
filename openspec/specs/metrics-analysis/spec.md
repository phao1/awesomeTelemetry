# Spec: Metrics & Analysis

> 指标计算、phase 分类、speed metrics、报告生成。源文件：`src/core/`

## Purpose

基于 TraceRecord 计算「快准稳省」四维指标 + 速度指标，生成 HTML 报告。

## Requirements

### REQ-001: Phase 分类器（两遍算法）
`classifyEvents(events)` SHALL 用两遍算法：
- **Pass 1** — 每个 event 标注 certainty：`explicit`（action 直接映射）/ `meta`（system、step-start、step-finish）/ `propagate`（message、reasoning、function_call）
- **Pass 2** — propagate 与 meta 继承最近 explicit 的 phase；前后取近者，LLM 偏前，agent 与 message 偏后

#### Scenario: bash 测试命令
- **GIVEN** bash event 命令匹配 `npm test|vitest|jest|pytest|cargo test|go test|tsc|eslint`
- **THEN** phase = `verify`

#### Scenario: 错误后写文件
- **GIVEN** 前一个 bash 或 test event 状态为 error，当前是 file_write
- **THEN** 当前 phase = `debug`

### REQ-002: ACTION_PHASE 查找表
维护约 30 个 action 名到 phase 的映射：read/glob/grep→understand、write/edit/patch→implement、todowrite→plan 等。

### REQ-003: bash 命令分类
`classifyBashCommand(cmd)` SHALL 用正则分四类：VERIFY_CMD / REPORT_CMD（git commit、push、pr）/ UNDERSTAND_CMD（cat、ls、find、grep）/ IMPLEMENT_CMD（rm、cp、mv、mkdir、git add）。

### REQ-004: 四维指标
`computeMetrics(record)` SHALL 计算 `TraceDimensionMetrics` 全部六个字段。

### REQ-005: 指标持久化与版本失效
四维指标 MUST 随 base metrics 一起持久化。代码中 MUST 定义常量 `METRICS_CALC_VERSION`，算法变更时 bump。

#### Scenario: 算法升级后重算
- **GIVEN** 库中某会话的 `metrics.calc_version` 小于 `METRICS_CALC_VERSION`
- **WHEN** 读取该会话指标
- **THEN** 重算并回写，`calc_version` 更新为当前值

> v4 的 G5.3「四维指标不持久化是设计选择」在 v5 被推翻。该设计是 Agent Overview 需要 524 次 N+1 的直接成因。

### REQ-006: Speed 指标
`computeSpeedMetrics(record)` SHALL 计算 TTFT、TPS、TPOT、E2E、turn gap 中位数、`pureInferenceMs`。运行时计算，不持久化。

#### Scenario: 纯推理时长取值
- **GIVEN** provider 为 CodeArts，event 同时含 Kernel-Inference duration 与 InferHub.inference_duration
- **THEN** `pureInferenceMs` MUST 取 `InferHub.inference_duration`
- **AND** Kernel-Inference 的 duration 包含 Tool 执行时间，用它会高估

### REQ-007: Token 分解
`computeTokenBreakdown(record)` SHALL 分解 input / output / reasoning / cacheRead / cacheWrite。`extractTokenText()` 提取可读文本。

### REQ-008: 单会话报告
`buildTraceReportHtml(record)` SHALL 生成自包含 HTML 报告（含 SVG 可视化）。

#### Scenario: 大 JSON 嵌入
- **GIVEN** 报告需嵌入的 JSON 超过 100KB
- **THEN** MUST 写入外部 `.js` 文件并用 `<script src>` 引用
- **AND** MUST NOT 用内联 `<script>var data = {...}</script>`（JSON 中的 `</script>` 与特殊字符会破坏 HTML 解析）

### REQ-009: 对比报告
`buildCompareReportHtml(left, right)` SHALL 生成左右对比 HTML（雷达图、时间线、优缺点卡片）。

### REQ-010: user_prompt 过滤
`isGenuineUserPrompt(text)` SHALL 过滤 `<system-reminder>` 等系统注入。`cleanPromptText(text)` 清理标签。

### REQ-011: 服务端聚合口径一致
`getAgentOverview()` 的 SQL 聚合结果 MUST 与 `computeMetrics()` 的单会话结果口径一致。

#### Scenario: 口径一致性测试
- **GIVEN** 一组固定 fixture 会话
- **WHEN** 分别用 SQL 聚合与逐会话 `computeMetrics` 后求平均
- **THEN** 两者的 errorRate、verificationCoverage、avgToolDurationMs 差值 < 0.001

> 这是唯一能防止「服务端聚合走捷径导致数字对不上」的测试，必须有。

## Gotchas
- G4.1：Kernel-Inference duration 含 Tool 时间，纯 LLM 时长用 InferHub.inference_duration
- G4.6：总时长用 wall-clock
- G10.4：phase 分类两遍算法必须完整移植
- G7.6：报告 HTML 里大 JSON 必须用外部 JS 文件
- G7.2：报告字体支持 A-/A+/R 调整
- G11.11（新）：四维指标改为持久化后，任何算法改动都必须 bump `METRICS_CALC_VERSION`，否则库里留着旧口径的脏数据且无人察觉
