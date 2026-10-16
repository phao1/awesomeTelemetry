# 源码复核与融合取舍

核查日期：2026-10-15。当前主项目 HEAD d5da6afa611bb44889f0834b5fa7bfda68838f7d（另有未提交更改）；telemetryRef/trace-analysis HEAD 2d3567b33ef11079ef00451f1f024b5bb46edbd1（tracked 工作区干净）。这是代码审查与合成输入检查，不是真实 Agent 全链路认证。

## 一句话结论

awesomeTelemetry 更适合作为产品骨架；telemetryRef 更适合作为协议场景和字段提取的参考。双方都不能直接宣称“完整、可信的一键 Agent 全链路监控”。融合价值是“网络实测 + 原生语义 + 来源可信度 + 可交互诊断”，不是简单拼接两个代理。

## 对比

| 维度 | awesomeTelemetry 实际现状 | telemetryRef 实际现状 | 取舍 |
|---|---|---|---|
| 产品形态 | TypeScript/Node、本地 Web、SQLite、9 scanner、统一模型/指标 | Python 脚本集合：snap-proxy、LiteLLM callback、Trae CLI 代理是不同路径 | 保留本项目主体 |
| 网络入口 | http-mitm-proxy 转发已实现，CA 与 UI 下载闭环未接好 | snap-proxy 使用 mitmproxy 普通前向代理；Trae CLI 路径是固定上游反向代理 | 修补本地监控入口，不照搬启动脚本 |
| 协议识别 | 已能 classify request format，但实际 parser dispatch 仍按 host | 多协议专用脚本，Responses nested usage 等更丰富，口径散落重复 | 复用协议知识，重建统一 parser/fixtures |
| 深度上下文 | 已有 context-normalizer/diff，支持多协议请求结构 | 原请求与专用解析结果丰富，部分路径 raw 截断 | 保留现有 normalizer，扩展响应与工具 |
| 流式实时性 | response chunk 无时间戳；主要完成后解析；UI 事件 producer 未连通 | 部分路径完整响应后处理，Trae read(4096) 时刻并不等于内容时刻 | 重写增量 decode/parse/timing 链路 |
| 会话关联 | parsed_session_id 写 null；captureGroup 明确不是 session | header/body 多种策略不一致；部分 trace-id/请求 hash 被当 session | 统一身份，启发式只做候选 |
| token/速度 | proxy usage 较少，原生 scanner 语义更完整 | 字段更多但有补零、E2E 当推理、重复相加风险 | 先校准口径再扩字段 |
| 工具/子 Agent | 本地记录有潜在原生证据，网络关联未闭环 | Responses parser 声明 tool_calls 但未填充，部分 Chat 分片有实现 | 网络声明 + 原生执行关联，不能只看数组存在 |
| 隐私 | 有脱敏模块，但 header/systemPrompt/超预算存在旁路 | capture 可保留完整 headers/body；参考启动含不安全 TLS/全局配置方式 | 两边均须安全审计，不整体复制 |
| 长期运行 | WAL/分页/聚合/perf 约束是已有优势，代理正文仍可无限累积 | JSON+JSONL/SQLite 多路径、保留与质量控制不足 | SQLite 统一证据，明确容量和完整性 |
| Trae CN | TTNet 检测存在，Frida/CDP 非完整可交付闭环 | Trae CLI 代理不等于 Trae CN IDE 的 TTNet 解密 | 独立支持矩阵，Windows 真机后验收 |

## 关键证据与严重性

### A. 本项目：融合前必须修正

1. **安全 P0：超预算返回原文。** [engine.ts](/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry/server/desensitization/engine.ts:37) 在计时结束后返回输入 text，且 desensitize() 丢弃 skipped 信息。它既不能提前中止失控正则，也不能安全回退。强制预算分支合成测试已验证，不代表普通 100KB 输入已实测超时。
2. **安全 P0：派生字段/headers 绕开正文脱敏。** [proxy-writer.ts](/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry/server/proxy/proxy-writer.ts:34) 直接写请求 headers 与 parser 从原始请求提取的 systemPrompt。即使 HTTP 返回层另做过滤，落盘旁路仍存在。raw 开关 true 时当前写的是传入的脱敏正文，也不符合“原始证据”含义。
3. **完整性 P1：分类和执行分离。** [parser-router.ts](/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry/server/proxy/parser-router.ts:146) 识别为 Responses/Messages 不保证相应 parser 真正运行；Anthropic 分支没有处理传入 SSE events。
4. **完整性 P1：流内容和时间。** [mitm-proxy.ts](/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry/server/proxy/mitm-proxy.ts:109) 对每个 chunk 独立 UTF-8 转字符串，未保存内容到达时间；完成路径同步解析/脱敏/写 DB，不能据此计算真实首内容时间。普通 body/chunks 缺少硬容量上限。
5. **体验 P1：实时通知未接通。** [controller.ts](/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry/server/proxy/controller.ts:142) 创建 proxy 未传 notify；[coalescer.ts](/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry/server/realtime/coalescer.ts:48) 有流事件合并函数，但采集链路未调用。存在事件定义不等于真实实时产品完成。
6. **接入 P1：CA/监听错误生命周期。** ca-manager 自有生成器未被当前代理使用，代理库默认 CA 路径与之不同；listen 包装未处理错误回调。必须测试真实 CONNECT 与端口占用、启动/停止竞态，不只 mock 控制器。
7. **覆盖 P1：CDP/Frida 不应标完整支持。** CDP 处理响应 body 的路径与 request id 存在待修项，缺少完整生产接线；Frida 回调当前偏状态处理、未完成完整持久化通知，解析 marker/HEX/分段及目标模块探测需补足。不能以文件存在判定功能完成。
8. **关联 P1：不能用“时间窗最长 system prompt”做精确事实。** 现有 time-window/context predecessor 只能做候选，在并发同模型会话上需显式关联；captureGroup 不是 Agent session。

### B. telemetryRef：值得借鉴但不可直接相信

1. [proxy_intercept.py](/Users/howell/Documents/Coding/telemetryRef/trace-analysis/snap-proxy/core/proxy_intercept.py:95) 保存请求/响应与 session header，有原始证据价值；response_start_ts 在 responseheaders 回调设置，代表响应头时刻，而非首个模型内容。flow 顶层 timestamp_start/end 的取值需用所用 mitmproxy 版本实测核验，当前只标记可疑，不宣称已证实库行为。
2. [parse_codex_responses_trace.py](/Users/howell/Documents/Coding/telemetryRef/trace-analysis/snap-proxy/tools/parse_codex_responses_trace.py:58) 能取 response.completed.response.usage 和 proprietary timing；但 tool_calls 初始化为空后没有填入 function_call。不能把它描述成完整 Responses 工具 Trace。
3. [trace_proxy.py](/Users/howell/Documents/Coding/telemetryRef/trace-analysis/litellm/trae/proxy/trace_proxy.py:106) 缺少 timing 时用 E2E 补 TTFT/模型推理，缺失 rate 补零，total 直接把各计数相加。它有工具参数分片处理可参考，但指标和未知语义必须重写。
4. 同文件 first_token_at 取第一次 read(4096) 返回时刻；raw_response 仅保留尾部/限长，request hash 兜底 session 会随内容变化。不等于 token 精确计时、完整 raw 或稳定会话。
5. [custom_callbacks.py](/Users/howell/Documents/Coding/telemetryRef/trace-analysis/litellm/src/custom_callbacks.py:182) prehook 删除 thinking。它位于变换网关而非透明观测位置；原请求与网关变换后的数据必须区分，R1 不引入此行为。
6. 启动脚本存在关闭上游 TLS 验证、修改全局代理、停止时不恢复原配置等危险模式；源码包含硬编码认证信息（本报告不复述值）。不能执行或复制到新项目。
7. 多套指标脚本与 pipeline 内联逻辑可能不同；以每条实际调用路径建立 golden fixture，不能任选一个 metrics_calculator 作为“参考真值”。
8. 当前 checkout 未发现 LICENSE/COPYING/NOTICE 文件。直接移植须确认复用授权；本报告只做工程提醒，不作法律结论。

## 本轮执行验证

主目录执行：
`npx vitest run server/proxy/mitm-proxy.test.ts server/proxy/parser-router.test.ts server/proxy/proxy-writer.test.ts server/proxy/ca-manager.test.ts server/realtime/coalescer.test.ts`

结果：**5 个测试文件、43 个用例全部通过**，Vitest 4.1.10，2026-10-15。说明已有断言通过，不说明安全/协议覆盖完整。

通过现有 TypeScript 代码的临时内存 transpile/调用，使用纯合成数据复现：

| 输入 | 期望 | 实际 |
|---|---|---|
| Anthropic SSE message_start input=12 + message_delta output=7 | 12 / 7 | null / null |
| Responses completed nested usage=12/7，instructions 存在 | usage 与 system 可见 | usage null/null，systemPrompt null |
| 自定义网关 Messages，system 为数组 | Messages 解析并保留 system | requestFormat 是 Messages，但 parserRoute 是 openai，systemPrompt null |
| 脱敏 budget=-1 强制失败分支 | 安全不可用结果 | skipped=true 且 text 等于输入原文 |
| 中文 Buffer 在字符中间拆分后逐块转 UTF-8 | 原文无损 | 字符损坏 |

以上不是新增持久化测试文件；B1/B2 必须先把这些用例正式加入相邻测试，再实现修复。没有修改应用代码，没有运行真实云模型请求、系统证书安装、全局代理改写、Windows Frida、HTTP/2/WebSocket 或完整 perf。当前测试依赖 Vitest 4.1.10，与 AGENTS 中 Vitest 3 的描述有现存漂移，B0 明示，不擅自改依赖。

## 必须按文档优先级解决的冲突

| 当前描述 | 冲突/风险 | 推荐处理 |
|---|---|---|
| trace-model REQ-003 cacheRead cumulative/max | 与 data-model §2 incremental/sum 相反 | 依权威契约修正旧 spec |
| trace-model REQ-004 不计 cacheWrite、总加 reasoning | 与 data-model §2 及当前记录语义不一致 | 依权威契约并补协议映射 |
| G8.3 / raw 字段注释“脱敏开启即保留原文” | 与 keepRawBodies 默认 false/显式开关不一致 | B1 统一为显式授权，不默认保留 |
| G11.13 超预算 skip | 容易实现成泄露原文 | 改成跳过正文采集、保留安全元数据，不阻塞转发 |
| frontend REQ-013 / G7.4 完全分离 | 用户需要关联全链路 | 原始视图独立，新增明确关联视图例外，先批准 |
| storage REQ-017 只启动清理 | 无法保证持续采集容量 | 周期保留 + 字节上限 |
| 现有 NFR DB+WAL <200MB vs 尽可能多正文 | 不可能无限保留 | 明确限额内完整正文和过期状态；扩容另批 |
| schema/version/milestone 旧文字 | 主目录含新 schema/team 改动 | B0 确定基线，不能旧代码接新 DB |

## 建议取舍

- **直接保留并回归验证**：Web/SQLite/扫描框架、规范化模型思想、context-normalizer/diff、查询分层、聚合和虚拟化。
- **修正后复用**：现有代理、CA/生命周期、脱敏、SSE 接线、usage/parser、关联与指标。
- **只参考后重新实现**：telemetryRef 的各协议提取、工具分片、metadata 路径、评测数据组织。
- **不纳入默认链路**：硬编码认证、ssl-insecure、全局代理脚本、LiteLLM 请求改写、重复计数或补零指标、把 Trae CLI 当 IDE 解密。
