# Spec: Trace Model

> 规范化的 trace 数据模型。所有 adapter 把原始数据转成这套类型，所有下游基于它。
> **类型定义的权威来源是 `contracts/data-model.md`，本文件只定义行为需求。**
> 源文件：`src/core/trace-types.ts`

## Purpose

定义一套 provider 无关的 trace 数据模型，让 9 种异构 Agent 数据源统一到同一形状。

## Requirements

### REQ-001: 类型定义单一来源
所有类型 MUST 逐字采用 `contracts/data-model.md`。任何模块 MUST NOT 自行定义结构相同但字段名不同的类型。

#### Scenario: 遇到未定义的枚举值
- **GIVEN** 某 adapter 遇到 `contracts/data-model.md` 未定义的 phase 值
- **WHEN** 归一化
- **THEN** 映射到六个合法值之一；无法映射时归入 `implement`，并在 `event.error` 记录原值
- **AND** MUST NOT 向 `TracePhase` 联合类型新增成员

### REQ-002: 三档事件形状
系统 SHALL 区分 `TraceEventSlim` / `TraceEvent` / `TraceEventRaw` 三档。

#### Scenario: slim 档不含正文
- **GIVEN** 任意 slim 档事件
- **THEN** 该对象 MUST NOT 含 `inputSummary`、`outputSummary`、`raw` 三个键中的任何一个
- **AND** 用 `hasInput` / `hasOutput` / `hasRaw` 三个布尔量代替

> 依据：v4 中 `events.raw` 单列占 DB 总量 64.2%（147.82MB），`inputSummary` + `outputSummary` 另占 82.28MB。三档切分是把最差会话详情从 32.3MB 降到 1.5MB 的关键。

### REQ-003: token 聚合语义显式化
每个 adapter MUST 返回 `TokenSemantics`，声明其 `cacheRead` 与 `reasoning` 是累积值还是增量值。storage 层 SHALL 依此选择 `Math.max()` 或 `sum`。

#### Scenario: OpenCode 系累积 cacheRead
- **GIVEN** provider 属于 opencode / codearts / codeagent2
- **THEN** `tokenSemantics.cacheRead === 'cumulative'`
- **AND** 会话级 cacheRead 取所有 event 的 `Math.max()`

#### Scenario: reasoning 恒为增量
- **GIVEN** 任意 provider
- **THEN** `tokenSemantics.reasoning === 'incremental'`，会话级用 sum

> v4 把这条写成 gotcha（G4.4）靠人记；v5 把它变成类型系统强制的字段，adapter 不声明就无法通过编译。

### REQ-004: total 计算公式
`tokenUsage.total` MUST 等于 `input + output + reasoning + cacheRead`。MUST NOT 漏 `reasoning`，MUST NOT 计入 `cacheWrite`。

### REQ-005: 时长用 wall-clock
`TraceSession.totalDurationMs` MUST 等于末 event 的 `startedAt` 减首 event 的 `startedAt`。MUST NOT 用各 event 的 `durationMs` 求和（存在重叠与间隙）。

### REQ-006: 状态归一化
adapter MUST 把各 provider 原生状态映射到 `TraceStatus` 五值：completed→success、paused→running、canceled→cancelled、未知值→unknown。

### REQ-007: title 长度上限
`TraceEventSlim.title` MUST 不超过 200 字符，`error` MUST 不超过 500 字符，由 adapter 截断。超长正文归入 `inputSummary` / `outputSummary`。

> 依据：slim 档每 event 目标体积约 120 字节。9,590 events 乘 120B 约 1.15MB，符合 NFR 预算。

### REQ-008: 时间戳格式
所有对外时间戳 MUST 为 ISO 8601 UTC 字符串。秒级或毫秒级数值戳的转换 MUST 在 adapter 内部完成（如 Trae 的秒级戳需乘 1000）。

## Gotchas
- G4.4：cacheRead 累积用 max，reasoning 增量用 sum —— v5 已由 `TokenSemantics` 类型强制
- G4.5：total 公式不要漏 reasoning
- G4.6：总时长用 wall-clock
- G11.1（新）：slim 档一旦泄漏正文字段，最差会话响应会从 1.5MB 回弹到 32MB
