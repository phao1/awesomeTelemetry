# Task health 时间戳语义校准记录

日期：2026-10-30。阶段：M12 / P0。数据库仅以 `sqlite3 -readonly`
打开，没有写入、重扫、自动关联、抓包启动或原始正文导出。以下区分
**适配器映射/fixture 依据**与**抓包校准**；源码中的字段名不能证明真实
客户端在何时落盘，合成 fixture 也不能代替实测。

## 1. 源码与 fixture 对照

相对目录均从仓库根解析。健康层声明见 task-health.md TH-002。

| Provider | 原始时间字段→记录时间；源码依据 | fixture 依据 | 健康声明 / 限制 |
|---|---|---|---|
| codex | src/adapters/codex.ts:283/297 取 row.timestamp；:388–396 用同 call_id 的 output timestamp−call timestamp；结果仍单独成记录(:406)。会话仍标 derived，不能据此否定精确配对的 observed 区间。 | src/adapters/__fixtures__/codex.ts：call1 在1s、output在3s；原生结果与调用不同记录，同 call_id。 | completion（模型 item 完成/调用发出/结果返回的日志观测）；不是首 token，也不是请求开始；未实测校准。 |
| claude | src/adapters/claude-code.ts:160 取 row.timestamp；assistant 各块共享该时间；:165–202 匹配 tool_result 回填到 tool_use，没有保留结果的独立 slim 时间；未匹配结果才单独成记录。local-sessions/claude.ts 委托同一 normalizeClaudeSample，不改时间。 | src/adapters/__fixtures__/claude.ts：assistant/tool_use在5s，user/tool_result在7s，下一assistant在10s。归一化后不能把5→10当精确工具时间；原生端点应为5→7。claude-sidechain.json只说明同格式，不提供网络时序。 | completion 声明；工具结果需原生元数据补充，现有 slim 无法还原精确返回时刻。 |
| codeagent | src/adapters/codeagent.ts 过滤 snapshot，包装 Claude normalizer，改 provider/actor/namespace，未改 startedAt。 | src/adapters/__fixtures__/codeagent.ts 同 Claude timestamp 行形态。 | completion 继承格式映射；不声称真实版本已校准。 |
| opencode | src/adapters/opencode.ts:224 所有 message parts 取 message.time.created，duration先置0；:319–320 OTel单独用 startTime/endTime；:454 只要存在 OTel 就把会话标 measured，混合源不能逐事件照搬此标志。 | src/adapters/__fixtures__/opencode.ts：m-tool created=1754000010000、completed=1754000030000，但当前 partToEvent 未用 completed；fixture没有工具分片 state.time。 | db/jsonl 为 start；纯 verified OTel 为 interval；P1 后完整分片时间才可 interval。 |
| codearts | src/adapters/codearts.ts 包装 OpenCode dialect；当前时间映射同上。 | src/adapters/__fixtures__/codearts.ts 只有 message.time.created，无分片起止。 | 当前 start；真实 CodeArts 分片格式待样本确认，不能由公开 OpenCode 结构推断已经实测。 |
| codeagent2 | src/adapters/codeagent2.ts 包装 OpenCode dialect；当前时间映射同上。 | src/adapters/__fixtures__/codeagent2.ts 只有 message.time.created。 | 当前 start；P1按逐条原生端点验证后才升级 interval。 |
| trae | src/adapters/trae.ts:238–245 用 turn.startTime 秒→ISO；缺失继承前条/会话时间；有endTime时计算区间，其余同时间组分摊下一个时间差；会话仍为derived。 | src/adapters/__fixtures__/trae.ts 有 startTime/endTime 对，也有缺 endTime 的工具。 | 健康层 unknown；部分显式区间仍可提供累计工作量，不给完整分区或T_think。 |
| qoder | src/adapters/qoder.ts:69–75 取 row.timestamp，耗时由下一 timestamp 相减。 | src/adapters/__fixtures__/qoder.ts 在0/2/5s有记录，无独立网络开始/完成证据。 | unknown；仅知道源timestamp的值，不知道它是开始还是完成。 |
| workbuddy | src/adapters/workbuddy.ts:69–74 取 message.timestamp，耗时由下一 timestamp 相减。 | src/adapters/__fixtures__/workbuddy.ts 有1s function_call、3s function_call_result，但没有抓包确认时钟/落盘语义。 | unknown；调用名本身不能把全provider升级为completion。 |

独立导入（不是第10个 provider）：server/trace-import/format.ts:41–44 保留
request_time/response_time→requestTime/responseTime；reported保留 ttft_ms、
tpot_ms、model_inference_ms、tool_time_ms、thoughts_token_count等原值。
因此按 interval / reported / exporter 处理，不映射为 MaaS/InferHub/Kernel。

src/adapters/helpers.ts:225–244 的 DERIVED_DURATION_CAP_MS=300000，
把相邻时间差归到前条并封顶。这是推导算法，不是本次时间戳语义校准证据。
尤其不能把工具结果后的模型等待算成工具继续执行或空转。

## 2. 只读数据库检查与可复现查询

目标：`awesome-telemetry-data/observe.sqlite`。执行时文件大小562032640字节；
数据是当前保留快照，非全局产品样本。先读 contracts/database.md 表定义，
再读取实际 `.schema trace_associations`、`.schema proxy_capture_transport`。
所有投影显式列名；不读 raw/input_summary/output_summary/body/auth。

```sh
sqlite3 -readonly awesome-telemetry-data/observe.sqlite "
SELECT state,COUNT(id) AS n FROM trace_associations GROUP BY state;
SELECT COUNT(id) AS associations FROM trace_associations;
SELECT provider,duration_source,COUNT(id) AS sessions
FROM sessions GROUP BY provider,duration_source;
SELECT COUNT(id) AS requests FROM proxy_requests;
SELECT COUNT(proxy_id) AS transports FROM proxy_capture_transport;
SELECT COUNT(a.id) AS accepted,COUNT(t.proxy_id) AS with_transport
FROM trace_associations a
LEFT JOIN proxy_capture_transport t ON t.proxy_id=a.proxy_id
WHERE a.state IN ('direct','confirmed');
"
```

实际结果：

| 检查 | 结果 |
|---|---:|
| trace_associations 总数 | 0 |
| direct/confirmed accepted | 0 |
| accepted 且有 transport | 0 |
| proxy_requests | 1 |
| proxy_capture_transport | 0 |
| codex / derived sessions | 27 |
| codex / unknown sessions | 17 |
| 其余 provider sessions | 0 |

已执行以下关联时序投影，返回 **0行**，因此没有可合法对比的请求开始、
首包、完成、原生记录时刻。不能拿唯一的未关联抓包或时间相近的事件补样本。

```sh
sqlite3 -readonly awesome-telemetry-data/observe.sqlite "
SELECT s.provider,s.id AS session_key,a.proxy_id,
       p.started_at,p.completed_at,
       json_extract(t.result_json,'$.timing.firstContentMs') AS first_content_elapsed_ms,
       json_extract(t.result_json,'$.timing.completedMs') AS completed_elapsed_ms
FROM trace_associations a
JOIN sessions s ON s.id=a.session_key
JOIN proxy_requests p ON p.id=a.proxy_id
LEFT JOIN proxy_capture_transport t ON t.proxy_id=p.id
WHERE a.state IN ('direct','confirmed')
ORDER BY s.provider,s.id,a.proxy_id LIMIT 100;
"
```

后续样本足够时的逐调用方法（本次未产生观测结果）：

1. 只保留 direct/confirmed；再按完整 native request/response/message 身份
   唯一绑定调用与原生事件。会话级关联本身不足以确认逐调用所有权。
2. HTTP请求开始取p.started_at；首内容绝对时间=开始+timing.firstContentMs；
   完成=开始+timing.completedMs，并核对p.completed_at。elapsed使用同一捕获
   时钟，不能直接拿毫秒偏移与ISO相减。WS按逻辑调用投影，不用连接结束时间。
3. 原生记录取匹配的events.started_at与必要的原生tool_result时间；分别记录
   native−requestStart、native−firstContent、native−completed及身份和时钟依据。
   模型完成记录与工具返回记录分组，不把工具结果当网络响应结束。
4. 记录每provider/版本/记录类型的有效样本、分布、反例与覆盖限制。
   本次因步骤1无样本，未执行无身份依据的事件/正文读取，也未填任何时间差。

## 3. 每个 provider 的校准结论

| Provider | 有效逐调用样本 | 结论 |
|---|---:|---|
| claude | 0 | 未校准；保留源码completion声明，不能称实测确认。 |
| codex | 0 | 未校准；44个会话无direct/confirmed关联，不能验证completion判断。 |
| opencode | 0 | 未校准；源码区分start与OTel interval，尚无网络对照。 |
| codearts | 0 | 未校准；真实分片时间格式也待样本确认。 |
| codeagent | 0 | 未校准；仅继承Claude格式映射。 |
| codeagent2 | 0 | 未校准；仅继承OpenCode格式映射。 |
| trae | 0 | 未校准；健康语义维持unknown。 |
| qoder | 0 | 未校准；健康语义维持unknown。 |
| workbuddy | 0 | 未校准；健康语义维持unknown。 |

没有得到与plan.md §3.3相反的校准结果；同样也没有实测证据支持它。
本次交付的是可复现的“样本不足”记录，后续不得把这张表描述为已完成实测校准。
