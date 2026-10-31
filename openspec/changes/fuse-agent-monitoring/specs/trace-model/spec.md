## MODIFIED Requirements

### Requirement: REQ-003: Explicit token aggregation semantics
适配器 MUST 按权威 data-model 契约声明 TokenSemantics。OpenCode/CodeArts/CodeAgent2 的 cacheRead 是逐步增量，跨步 SHALL sum 而非 max；reasoning 按契约为增量。其他来源如含累计快照，SHALL 先按其原生语义规范化，不套用名称相似字段的公式。

#### Scenario: Incremental cache reads
- **WHEN** 三个步骤的 cacheRead 是 6016、4000、2000
- **THEN** 合计为 12016，不是 6016

### Requirement: REQ-004: total formula
规范化 token total MUST 遵循 contracts/data-model.md §2，包含 cacheWrite，并按 reasoningInTotal 及当前记录的原生 total 证据决定 reasoning 是否额外计入，不能沿用“总是加 reasoning、不计 cacheWrite”的旧描述。对于网络协议，SHALL 先处理 cached/reasoning 是 input/output 子集还是独立计数的区别；无法无歧义映射时保留原生值和未知口径，不能制造确定总额。

#### Scenario: Subset counters
- **WHEN** 某协议返回 input=100（含 cached=40）、output=20（含 reasoning=5）、native total=120
- **THEN** 网络请求总额保留 120，不变成 165；映射到现有 TokenUsage 前须依照已批准的协议映射契约

## ADDED Requirements

### Requirement: TRACE-001 Provenance and completeness
关联 Trace SHALL 保留原始来源引用、原生标识、关联依据、观察位置、解析/指标版本及完整性信息。缺失、未支持、截断、采集丢弃、过期正文 SHALL 可区分。新类型、字段、表和 API SHALL 在权威契约先定义，不得在实现内私自扩展现有 TraceEvent 或伪装为已有字段。

#### Scenario: Evidence is retained but a field is unavailable
- **WHEN** usage 未返回或正文已按策略清理
- **THEN** UI 和 API 能区分未知 usage 与真实零 token，也能区分已过期正文与空正文；不会抹掉仍有效的元数据和已计算指标
