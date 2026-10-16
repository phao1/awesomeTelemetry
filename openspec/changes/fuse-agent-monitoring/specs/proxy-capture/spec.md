## MODIFIED Requirements

### Requirement: REQ-007: Proxy control API
Per-request original-body deletion SHALL use an exact identity/confirmation and stopped-monitor maintenance lease excluding start/launch. Durable intent and proxy body/prompt clearing SHALL commit atomically; body/analysis/diff APIs SHALL reject confirmed intent even after failed cleanup, while metadata/headers/native sessions remain. Pending cleanup resumes before capture admission, failure is explicit/retryable and shutdown retains IO ownership. This is not global Clear or full request erasure.

#### Scenario: Deletion races with monitor start or analysis
- **WHEN** 用户确认正文删除，同时其他调用尝试启动监控或先前分析尚未返回
- **THEN** 启动返回明确维护冲突，已删除来源不能通过迟到分析结果重新显示，真实文件清理和状态写入结束前不报告完成或释放关闭所有权

### Requirement: REQ-002: CA certificate management
系统 SHALL 在稳定用户配置目录维护唯一生效的根 CA 及按域名签发的证书，并以其实际公钥证书供下载；签发结果 SHALL 有正确 SAN，可缓存。私钥 MUST NOT 通过 API/日志/导出暴露。首次信任 SHALL 由用户明确操作，目标运行时的信任检测与 OS 信任分别展示。生成能力 SHALL 在没有 OpenSSL 时仍可用。

#### Scenario: Downloaded CA matches intercepted traffic
- **WHEN** 使用下载并受信任的 CA 连接本地测试 HTTPS 上游
- **THEN** CONNECT 可正常转发，收到的叶证书由同一 CA 签发，重启后 CA 不变，且未使用跳过证书校验

### Requirement: REQ-008: parser-router hostname routing
系统 SHALL 优先根据明确协议配置、路径和 payload 结构解析请求及响应；域名只作为辅助线索，不能覆盖明确协议证据。OpenAI Chat、OpenAI Responses、Anthropic Messages SHALL 在官方域名和自定义网关获得相同行为；无法判断 SHALL 保留 unknown 和诊断证据。加密隧道 SHALL 标记不可解析，不强行按明文协议处理。

#### Scenario: Anthropic through a custom gateway
- **WHEN** 自定义域名发送 Anthropic Messages 结构，包含 system 数组和工具 schema
- **THEN** 系统提取完整可见内容和 usage，不能因为域名未知而选择 Chat 语义

### Requirement: REQ-009: token and system prompt extraction
系统 SHALL 从 Chat 的 messages、Responses 的 instructions/input、Messages 的 string/array system 中保留结构化上下文，并提取模型、工具声明/调用/结果、公开 reasoning、结束原因、错误及实际存在的 usage。流式 usage SHALL 按协议处理最终值或更新，不盲目累加多个快照；缺失值保持未知。解析失败的启发式结果 SHALL 标注推断，不冒充完整解析；所有原文按用户批准范围直接保存与展示。

#### Scenario: Protocol streaming usage
- **WHEN** Anthropic message_start 提供 input usage、message_delta 提供 output usage，或 Responses response.completed.response 提供 usage
- **THEN** 对应值准确保留，系统提示不遗漏，重复终止事件不导致重复统计

## ADDED Requirements

### Requirement: CAP-001 Incremental capture fidelity
系统 SHALL 增量处理 UTF-8、SSE 多行 data、CRLF、事件跨网络块、注释/心跳、空 delta、结束/错误/取消和非流式 JSON；并在不修改转发语义的前提下处理支持的压缩响应。网络块 MUST NOT 被当作完整字符、完整事件或单个 token。未支持的编码/传输 SHALL 明示，不能报告完整采集。

#### Scenario: Fragmented stream
- **WHEN** 中文、工具参数 JSON 和一个 SSE 事件分别跨多个网络块，且响应含心跳
- **THEN** 重建后的字符、事件顺序、工具调用 ID/参数及 usage 正确；心跳不触发首内容时间

#### Scenario: Compressed bytes and semantic view
- **WHEN** JSON/SSE 请求响应使用 gzip、br 或 deflate，且字符和事件跨块到达
- **THEN** 转发和原文下载保持编码字节及摘要不变，worker 和按需分析使用有界增量解码；Web 明示正文视图与原文字节的区别，Context Diff 比较解码内容但保留原文来源摘要

#### Scenario: EOF is not event dispatch
- **WHEN** data/终止/usage 帧尚无空行分隔就到 EOF，或编码损坏、不支持、UTF-8 无效
- **THEN** 不采信未派发帧的 usage/完成标识，处理结果明确降级，原文完整性独立保留且不会重放上游请求

#### Scenario: Controlled direct and proxy comparison
- **WHEN** 本地可控上游交替执行直连/真实代理配对，并等待客户端首字节反馈后才允许流结束
- **THEN** 应用头、状态、原文字节/摘要、协议投影及错误/取消前缀一致；HTTP、受信 HTTPS CONNECT、近2MiB HTTP 各100组4并发记录冷启动和原始暖态样本，额外首字节/E2E p95<=20ms、实际事件循环p99<50ms，退出后资源归零；不宣称模型TTFT、完整应用压测或真机认证

### Requirement: CAP-002 Failure and resource accounting
系统 SHALL 在连接错误、4xx/5xx、超时、取消、提前断流和停止监控时保留已获取的元数据与不完整原因。每个真实请求最终至多一条权威捕获记录；采集失败不能静默成为成功。采集内存、队列、正文与解压大小 SHALL 有明确上限；超限 SHALL 继续尽可能转发并报告采集降级，不能无限增长或静默截断。

#### Scenario: Storage cannot keep up
- **WHEN** 写入失败或采集队列达到上限
- **THEN** UI 显示可核对的失败/丢弃计数与原因，未持久化数据不标记保存成功；分析失败不额外阻塞已正常转发的请求

#### Scenario: Metadata worker cannot process the capture
- **WHEN** 有界解析队列已满，或真实 worker 崩溃／超时／结果超限
- **THEN** 不回退到主线程解析，不改变正常转发与已保存原文；原文状态与处理结果分别记录，未知语义字段不伪造成完整解析，完成时间不包含排队延迟，停止需等待已接受任务与线程清理

#### Scenario: Shared preview admission is exhausted
- **WHEN** 多监听器或在途请求耗尽进程级预览/任务/worker 预算
- **THEN** 拒绝额外语义采集并计数，resource_limit 独立标记丢弃预览字节；原文与转发继续，已接受资源在完成/故障/终止后释放，空闲预算可再次采集

#### Scenario: Network outcome is independent of saved evidence
- **WHEN** HTTP4xx/5xx、正常 EOF 缺少协议终止、原生超时、客户端取消或上游半截断流发生
- **THEN** 每请求只保存一个首因冻结的网络终态、方向结束标志及实际上游状态；网络/协议/文件完整性分别展示，已收前缀不夹入代理错误文本，重复事件不覆写终态，未结束上传不因响应提前结束而丢失
