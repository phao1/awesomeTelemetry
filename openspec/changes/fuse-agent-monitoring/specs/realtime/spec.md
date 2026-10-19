## ADDED Requirements

### Requirement: LIVE-001 Connected capture updates
真实采集 SHALL 触发 UI 可消费的增量状态、请求变化和安全流片段，不能只有孤立事件定义或测试。流更新 SHALL 沿用每请求 100ms 合并窗口，scan 更新沿用 200ms 合并窗口；前端 SHALL 按变更键批量补齐数据，不全量刷新、不逐请求抓详情。已提交记录和 UI 展示 SHALL 可核对。

#### Scenario: A stream finishes without manual refresh
- **WHEN** 在已开启监控的页面发起一个测试 SSE 请求直至结束
- **THEN** 页面自动出现进行中和最终状态，安全内容可增量查看，列表无正文且不需要手动刷新

### Requirement: LIVE-002 Reconnect and slow consumers
实时订阅 SHALL 有有界缓冲及断线恢复策略；重连 SHALL 能补齐遗漏的元数据，重复通知不得重复插入。慢浏览器 MUST NOT 拖慢代理转发；超出恢复窗口 SHALL 显示并走有界重新同步，而不是无限重放。

#### Scenario: Browser reconnects after completion
- **WHEN** 浏览器断开期间请求完成，随后重新连接
- **THEN** 可以获得完整的最终记录且只显示一次；未持久化的中间流片段不冒充可恢复历史

#### Scenario: Subscriber exceeds its writable budget
- **WHEN** 一个订阅的写缓冲超过预算或5秒仍不能排空
- **THEN** 只断开该客户端，释放其订阅/定时器并计数，其他订阅和真实代理转发继续；不得据此宣称已补齐重连期间的历史
