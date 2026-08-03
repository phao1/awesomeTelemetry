# Spec: Adapters

> 9 个 provider 适配器：原始数据转规范 TraceRecord。源文件：`src/adapters/`

## Purpose

每个 provider 的原始数据格式不同，adapter 负责归一化到 `TraceRecord`。

## Requirements

### REQ-001: sample-loader 分发
`sample-loader.ts` SHALL 按 `sourceAgent` 分发到对应 adapter。新增 provider = 加 adapter + 注册 + 更新 `PROVIDER_KEYS` + 两个 i18n locale。

### REQ-002: 必须声明 token 语义
每个 adapter MUST 返回 `TokenSemantics`。这是编译期强制字段，不是约定。

| Provider | cacheRead | reasoning |
|----------|-----------|-----------|
| claude / codeagent | incremental | incremental |
| codex | incremental | incremental |
| opencode / codearts / codeagent2 | **cumulative** | incremental |
| trae | incremental | incremental |
| qoder / workbuddy | incremental | incremental |

### REQ-003: 正文截断与分离
adapter MUST 把每个 event 拆成三部分：slim 字段（title ≤ 200 字符）、`inputSummary` / `outputSummary`、`raw`。`raw` MUST 独立返回，由 storage 写入 `event_raw` 表。

### REQ-004: Claude Code 适配
`claude-code.ts` SHALL 把 Claude JSONL 转 TraceRecord。`codeagent.ts` 包装它：drop `file-history-snapshot` 行，relabel actor。

### REQ-005: OpenCode 适配（被复用）
`opencode.ts` SHALL 处理 SQLite DB 行（part 表 join message 表）/ JSONL / OTel span 三源，用 `OpenCodeDialect` 参数区分 CodeArts / CodeAgent2 / OpenCode。后两者是 thin wrapper。

#### Scenario: subagent 检测
- **GIVEN** 会话标题匹配 `/\(@.*\bsubagent\)/i`
- **THEN** `session.isSubagent = true`

#### Scenario: cacheRead 累积
- **GIVEN** 一个 OpenCode 会话有 100 个 event，各自的 `cacheRead` 为递增值
- **WHEN** 计算会话级 tokenUsage
- **THEN** `cacheRead` 取 `Math.max()` 而非 sum
- **AND** `total = input + output + reasoning + cacheRead`

### REQ-006: Trae 适配
`trae.ts` SHALL 把 TraeRecord 转 TraceRecord：
- turn status 映射：completed→success、paused→running、canceled→cancelled
- phase 内联映射：read_file→understand、write_file→implement、reasoning→plan、bash→implement（命中 test 正则时为 verify）
- **`token_usage / 2` 校准**（双向累计）
- 非 LLM 行的纯数字 `token_usage` 是 message size，MUST 跳过；只有 `content_source === 'llm_default'` 计入 outputTokens
- 秒级时间戳 MUST 乘 1000

### REQ-007: Codex 适配
`codex.ts` SHALL 把 Codex JSONL 转 TraceRecord：`function_call`→tool/implement、`function_call_output`→tool/implement、`user`→user_prompt、`assistant`→llm。

### REQ-008: Qoder 适配
`qoder.ts` SHALL 把 Qoder JSONL 转 TraceRecord，调 `classifyEvents`，`durationMs` 从相邻时间戳算。

### REQ-009: WorkBuddy 适配
`workbuddy.ts` SHALL：
- 按 `callId` 配对 `function_call` 与 `function_call_result`（注意 `function_call` 不等于 `tool_use`）
- 从 `<user_query>` 标签提取用户问题
- 按 tool name 检测 kind：Bash/PowerShell→bash、Read/Glob/Grep→file_read、Write/Edit→file_write、Agent→subagent_prompt、Skill→agent
- 错误检测：`Exit Code: [1-9]` 正则 + `skipRun` 标志
- cost 从 `rawUsage.credit` 累计

### REQ-010: 状态归一化表
| 原生值 | TraceStatus |
|--------|-------------|
| completed / done / finished / ok | success |
| failed / error / exception | error |
| running / in_progress / paused / pending | running |
| canceled / cancelled / aborted / interrupted | cancelled |
| 其他 | unknown |

### REQ-011: normalizeRawSample
`normalizeRawSample(rawSample)` SHALL 把含 `sourceAgent` 的 RawSample 转 TraceRecord，供 scan-scheduler 调用。

### REQ-012: 每 adapter 必备测试
每个 adapter MUST 有 colocated `*.test.ts`，至少覆盖：
1. 一个最小 fixture 的完整 TraceRecord 快照
2. token 聚合语义（尤其 OpenCode 系的 max vs sum）
3. 状态归一化的四类映射
4. 重复 event id 的 `:sequence` 后缀
5. slim 字段中 title 的截断

## Gotchas
- G4.4：cacheRead 累积用 max，reasoning 增量用 sum（最易踩坑）
- G4.2：Trae `token_usage` 需 /2 校准
- G4.3：Trae 非 LLM 行 token_usage 是 message size，不重复计数
- G4.6：总时长用 wall-clock
- G9.1：CodeArts / CodeAgent2 复用 opencode（dialect 参数），先实现 opencode 再 2 行 wrapper
- G9.2：CodeAgent 3.0 包装 claude-code（drop file-history-snapshot）
- G9.3：OpenCode subagent 标题正则检测
- G11.10（新）：adapter 必须把 raw 与正文分离返回，混在一起会让 storage 无法实现三档切分
