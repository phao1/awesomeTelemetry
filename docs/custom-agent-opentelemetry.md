# 接入自研 Agent（OpenTelemetry）

在「数据接入 → OpenTelemetry」显式启用接收器。页面显示当前进程实际端口的
`http://127.0.0.1:<port>/v1/traces`，可选生成 Bearer token。token 只在启用时
显示一次，可复制；丢失时停用、重新启用即可轮换。设置存于用户配置目录旁的
`opentelemetry.json`（0600），GET 状态和日志不返回 token。每次重启仍默认关闭。

接收器只接受回环连接，并检查 Host / Origin。应用和 Agent 应在同一台机器的同一
网络命名空间；容器的 127.0.0.1 指向容器自身。不要把此接收器暴露到公网。
本功能只接收数据，不执行 Agent、工具或模型请求；新增接收及文件导入数据留在本机。
客户端框架自身的云端 tracing 是独立设置，需要在客户端按其文档管理。

## 通用 OTLP/HTTP JSON 环境变量

先在应用中接好 OTel instrumentation 和 **支持 HTTP JSON 的 trace exporter**，
再在启动该应用的终端设置以下三个标准变量。端口以页面为准；未启用 token 时省略
第三行。此示例适用于已接上 OTel exporter 的 OpenAI Agents SDK、LangGraph /
LangChain、LlamaIndex、Vercel AI SDK 应用，不会仅凭环境变量自动为框架安装或启用
instrumentation。部分 SDK / exporter 只有 protobuf 实现，须先选择支持 JSON 的
实现或在客户端完成协议转换。

```sh
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4173/v1/traces
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_HEADERS='Authorization=Bearer <页面生成的token>'
```

PowerShell：

```powershell
$env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://127.0.0.1:4173/v1/traces'
$env:OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json'
$env:OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer <页面生成的token>'
```

| 应用 | 接到上述标准 exporter 前需要做什么 |
|---|---|
| OpenAI Agents SDK | SDK 内建 tracing 与 OTLP 接收器并非同一协议；在应用侧通过适配的 tracing processor / OTel instrumentation 输出 OTLP JSON。仅设置这些变量不能重定向默认云端 tracing。参考 [OpenAI 官方 observability 文档](https://developers.openai.com/api/docs/guides/agents/integrations-observability)。 |
| LangGraph / LangChain | 应用侧接入 OTel/OpenInference instrumentation，并将其 tracer provider 接到 JSON exporter。已有 LangSmith tracing 可先导出 runs 文件；参见 [官方 tracing 说明](https://docs.langchain.com/oss/javascript/langchain/observability)。 |
| LlamaIndex | 按安装版本的 [observability 文档](https://developers.llamaindex.ai/python/framework/module_guides/observability/) 接好 instrumentation，再使用上面的标准变量。 |
| Vercel AI SDK | 按安装版本的 [telemetry 文档](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) 接好应用的 tracer provider，再使用上面的标准变量。 |

这些是 OTel exporter 的通用配置，未宣称完成各 SDK 的真实模型联调；这里不提供
未经确认的框架私有参数。标准变量定义见 [OTel exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)。

## 发送与排错

`POST /v1/traces` 请求体是 OTLP `ExportTraceServiceRequest` 的 JSON 映射，
`Content-Type: application/json`，可用 `Content-Encoding: gzip`。traceId 是32位
十六进制，spanId / parentSpanId 是16位十六进制；枚举用整数。成功返回 `200 {}`。

- 403：接收器关闭，请先在页面启用。
- 401：缺少或无效 Bearer token。
- 400：非本机 Host / Origin，或 JSON、ID、格式无效。
- 415：不支持二进制 protobuf、gRPC 或其他 Content-Type；设置
  `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`。本项目不包含 protobuf 解码依赖。
- 413 `TELEMETRY_LIMIT`：请求、属性或单次归并大小超限。
- 413 `TELEMETRY_QUOTA`：遥测自身配额已满，消息说明 span 数、归一化字节数或任务/成员限制。
- 413 `TELEMETRY_WAL_LIMIT`：WAL 过大，尝试一次非阻塞检查点后仍未降至8MB以下；
  先结束长时间持有的读取事务再重试。不会通过删除证据释放空间。
- 503 `TELEMETRY_CAPACITY`：无法读取或稳定校验 WAL 状态，请稍后重试。
  以上拒绝均不部分写入，已有证据保留。
- 429：另一个接收/导入操作正在进行，稍后重试。

页面「刷新统计」按需读取本次进程已接收 span / trace 次数、拒绝请求数和静态原因码，
不轮询。接收计数包含合法重传；持久化按来源、traceId、spanId 去重，重传不重复计算
任务 usage，也不重写未变化的事件。

## 映射与数据边界

支持 OTel GenAI 和 OpenInference 的模型、工具、Agent、usage、错误与消息事件；
未知 span 保留为通用步骤。优先用 conversation ID / session ID 归并任务，否则使用
trace ID。没有分组属性的同 trace span 仅在已有唯一显式分组时继承；冲突不猜测。
父子 span ID 按 trace 隔离保存；invoke_agent / AGENT 形成主 Agent 和子 Agent，
子步骤属于最近可解析的 Agent 祖先。缺失父项和循环保持未解析，不推断通信或委派。

任务详情的「来源」可查看 span / parent ID、原始报告时间和 nullable usage 元数据。
任务摘要、健康监测、对比及已有 trace-export 入口可用。OTLP 导出保留父子结构与
报告的时间/计数，不导出提示或输出正文。导出按 offset/limit 分页（最多200），导出
本身的页覆盖不表示上游原始 trace 已完整。仓库原生 scan/linked OTLP 导出也可直接
导入；scan observation point 不被升级为模型/工具执行区间。

新增遥测数据只保存脱敏、有界预览（每方向最多2048个字符），不保留原文。未知属性
不写入原文库；已识别的身份字段和 nullable usage 保留。既有 TraceLog 和抓包原文
策略独立。未报告的时间、token、cache、reasoning、费用保持未知；不把 `endTime`
单独当作执行成功，不猜测 input/cache 或 output/reasoning 的包含关系。健康监测的
span 区间标为来源观察值，TTFT 未知；主 Agent 包含子调用的包络不重复算成模型工作。

接收限制：压缩与解压后均不超过8MiB；每批1000 spans；每 span / resource / event
最多128个属性、每 span128个事件；key256字符、单值64Ki字符、嵌套深度32。每任务
最多2000 spans / 100成员；保留最多20000 spans / 256任务、32MiB归一化 JSON。
一次归并读取/重建最多2000条、2MiB归一化数据，超过则整批413。
遥测配额与抓包配额独立：telemetry_quota 的 span_count 只统计去重后的遥测 span，
bytes 只统计其归一化 span_json 的 UTF-8 字节（包含脱敏预览），不含原生日志扫描、
抓包数据、SQLite 页和重复投影；默认上限20000 spans / 33554432 bytes（32MiB），
另限制256个任务。更新只计字节差额，重传不重复占用。整个数据库即使因原生日志
超过180MB，仍可接收和导入遥测。抓包原有的整库180MB准入闸门保持原样。

遥测仍有独立 WAL 保护：WAL达到8000000字节时至多尝试一次非阻塞 TRUNCATE
检查点，重新读取后仍超限则拒绝，以预留20MB WAL预算余量。准入与抓包共用同库
串行队列及新鲜写入戳校验，避免异步检查过期。配额不会自动删除既有数据。
停止接收不停止 Agent。

HTTP接收任务的 origin 是 collected，可用
`GET /api/tasks?origin=collected&range=all` 查找；文件导入任务的 origin 是 imported，
使用 `GET /api/tasks?origin=imported&range=all`。两者的任务 ID 都保留
`collected:otel:...` 存储地址，筛选以 origin 字段为准。
`GET /api/tasks/:id` 返回成员（包括 gen_ai.agent.name），
`GET /api/tasks/:id/summary` 返回带 metrics 的 TaskSummary；
`POST /api/tasks/:id/health-reports` 使用 JSON
`{"mode":"standard","member":"all"}` 生成标准健康报告，无需模型调用。

## Langfuse / LangSmith / OTLP 文件导入

打开「数据接入 → 文件导入 → OTLP / Langfuse / LangSmith 文件」，选择 `.json`、
`.jsonl` 或 `.ndjson`。接收器不必开启，导入不依赖抓包监听器是否运行。校验通过后
整批提交，结果显示格式、span数和任务数，在「导入任务」查看。无法识别的格式给出
明确错误；CSV、Parquet 和厂商压缩归档需先由导出方转为 JSON / JSONL。

- **OTLP**：选择含 `resourceSpans` 的 JSON，包括本仓库导出文件；JSONL 每行可为
  一个完整 OTLP request。保留未知步骤，不将生成的导出 ID 当作原生助手身份。
- **Langfuse**：支持 `{ "traces": [...], "observations": [...] }`、observation 数组或
  单条记录；JSONL 支持 observation 行及混合 trace 元数据行。以 `traceId`（或公开
  blob-export 的 `trace_id`）关联 trace，读取 `parentObservationId`、type、model、
  usage / usageDetails、startTime / endTime、sessionId。若 traces / observations
  分文件，先合成上述对象或同一 JSONL，才能继承 trace 的 sessionId；只有 observations
  时缺失的 sessionId 保持未知，按 trace 分组。
- **LangSmith**：支持 runs 数组、`{ "runs": [...] }`、单条 run 或每行一个 run。
  读取 run_type、parent_run_id、trace_id、start_time / end_time、inputs / outputs、
  prompt_tokens / completion_tokens 或 usage_metadata，以及 extra.metadata 中已有的
  thread_id / session_id / ls_model_name。项目 session_id 不被当作会话线程 ID。
  LangSmith 的 `start_time` / `end_time` 若为不带时区的 ISO 日期时间，按其 UTC 存储
  约定视为 UTC（先补 `Z`，不使用机器本地时区）；已有 `Z` 或显式偏移保持原意。
  此假设只适用于 LangSmith，其他格式不变；无效时间仍保持未知。

参见 [Langfuse Public API](https://langfuse.com/docs/api-and-data-platform/features/public-api)、
[Langfuse 文件格式](https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage)、
[LangSmith 导出](https://docs.langchain.com/langsmith/export-traces)和
[run 字段定义](https://docs.langchain.com/langsmith/run-data-format)。本产品不登录这些
服务或自动下载导出文件；导入只读取用户显式选择的本地文件。
