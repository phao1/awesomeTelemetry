# Spec: Realtime

> 实时事件总线 + SSE 广播 + 事件合并。源文件：`server/realtime/`

## Purpose

后端事件实时推送到前端，驱动 live 指示器和列表增量刷新。
**核心约束：事件是给前端做局部 patch 的信号，不是让前端重新拉全量的触发器。**

## Requirements

### REQ-001: TypedEventBus
系统 SHALL 提供 `TypedEventBus`，事件与载荷严格对应 `contracts/data-model.md` §10 的 `BusEvents`。MUST NOT 定义该契约之外的事件。

### REQ-002: 单例 bus
`eventBus` SHALL 是模块级单例，全应用共享。

### REQ-003: 会话变更合并（v5 核心）
`queueSessionChange(key)` SHALL 把 key 累积到 pending 集合，按 **200ms 窗口**合并后发一条 `sessions_changed { keys, count }`。

MUST NOT 存在逐 session 发射的 `session_updated` 事件。

#### Scenario: 一轮完整扫描
- **GIVEN** 524 个会话在一轮扫描中被更新
- **WHEN** 事件合并生效
- **THEN** 发出的 `sessions_changed` 事件数 ≤ 10
- **AND** v4 逐条发射导致浏览器 30s 内产生 508 请求 / 151.2MB

#### Scenario: 定时器不阻止进程退出
- **GIVEN** 合并窗口定时器已排程
- **THEN** MUST 调用 `timer.unref()`，避免 CLI 无法正常退出

### REQ-004: 流式 chunk 服务端节流
MITM 捕获 SSE 流时，同一 `requestId` 的 chunk MUST 在服务端按 **100ms 窗口**拼接后再发 `proxy_stream_chunk`。前端 MUST NOT 再做二次节流。

> v4 的 spec 只写了「频率高，前端要做节流」但未定义机制，属于把责任推给下游的规格缺陷。

### REQ-005: SSE 广播器
`addSseClient(res)` SHALL：
- 写 200 + `text/event-stream` + `cache-control: no-cache` + `connection: keep-alive`
- 发初始 `connected` 事件，载荷含 `serverTime` 与 `schemaVersion`
- 每 30s 发一条注释行心跳 `: ping\n\n`，防止代理层超时断连
- 返回 cleanup 函数

### REQ-006: 事件转发
SSE 广播器 SHALL 订阅 `BusEvents` 全部事件并转发给所有客户端。客户端断开时 MUST 执行 cleanup 解除全部订阅。

### REQ-007: 前台请求标记
每个 `/api/*` 请求进入时 MUST 调用 `markForegroundRequest()`。`isForegroundBusy()` 在 750ms 内有请求时返回 true，供后台预热让路。

### REQ-008: 清理
`closeSseBroadcaster()` SHALL 取消所有订阅、清空合并器 pending 集合、关闭所有客户端连接。

## Gotchas
- SSE 连接要处理客户端断开
- G11.7（新）：SSE 事件的正确心智模型是「哪些 key 变了」，不是「有变化了快去重新拉」。前者是 O(变更数)，后者是 O(总数 × 变更数)
- G11.8（新）：合并窗口的定时器必须 `unref()`，否则 CLI 挂住不退出
