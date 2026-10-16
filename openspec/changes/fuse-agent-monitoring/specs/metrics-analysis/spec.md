## ADDED Requirements

### Requirement: MET-001 Measurement domains remain distinct
系统 SHALL 区分代理观测的响应头时间、首个有效内容时间、完成时间，供应商报告的服务端时间，原生 Agent span 时长及相邻事件推导时长。时长 SHALL 来自同一时钟域；外部时间为 UTC。原有扫描 TTFT/TPS 口径 SHALL 保留标签，不与新的网络指标混合比较。未知值不能用 E2E 或零补齐；网络延迟不称为模型纯推理时长。

#### Scenario: Headers arrive before content
- **WHEN** 响应头在 100ms、心跳在 150ms、首个可见内容在 800ms、结束在 2000ms 到达
- **THEN** 响应头延迟为 100ms，代理首内容延迟为 800ms，代理 E2E 为 2000ms；不会把 100ms 当成首 token 延迟

### Requirement: MET-002 Comparable usage and rates
系统 SHALL 保存原生 usage 与口径证据，明确每请求快照/增量及子集关系；按已确认的单次实际调用统计 token 与成本。TPS/TPOT SHALL 给出分子、时间区间、计数来源和聚合方式；没有足够证据时保持未知。价格 SHALL 保留来源和日期，未知价格不得显示为免费。自动诊断 SHALL 区分事实、推导和建议。

#### Scenario: A request is observed twice
- **WHEN** 一个请求被原生日志和代理共同观测且能精确关联
- **THEN** 总调用量、token 和估算费用只计一次，但两份观测证据都可查看；不同口径的时长保留各自含义

#### Scenario: An interrupted stream has no final usage
- **WHEN** 流被取消，没有最终 token 使用量
- **THEN** 计费量显示未知或清楚标注估算，不从 SSE 块数推算真实 token，也不报告 0 成本
