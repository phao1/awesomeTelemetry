## Context

见 proposal.md — Why。当前事实（2026-08-05 实测）：

- `readJsonlIndexMeta` 读到**首条 user 消息就停**，`eventCount = 已读 message 行数`，
  于是 2350 行的 codex 会话列表显示 `5 ev`；SQLite 索引只 `COUNT(message)`，
  CodeArts 25 条消息 vs 详情 71–82 个事件。
- `upsertEvents` 以 `(id, sequence)` 判等，adapter 升级后重扫产出的 duration /
  input / output 全部被跳过（实测强制 rescan 后仍是旧值）。
- 索引 upsert 的 conflict-update 覆盖 `detail_loaded`，watcher 每 30s 把已加载
  会话重置回 0，用户每次点开都重扫全文件。
- opencode 系 tool part 只存 raw，不映射 `state.input` / `state.output`；
  `step-start`/`step-finish` 纯标记产出大量空标题 llm 行。

## Goals / Non-Goals

**Goals:**

- 列表 eventCount/messageCount 与详情一致且稳定（打开前后数字不变）。
- adapter 升级后重扫能把新内容（时长、输入输出、标题、相位）真正写进 DB。
- CodeArts/OpenCode/CodeAgent2 的 tool 事件在 EventInspector 能看到输入/输出。
- 甘特提供时间/序列双模式，任意行可点击进入详情。
- 会话列表可见且可搜 session ID。

**Non-Goals:**

- 不改 API 契约（无新端点、无响应形状变化）。
- 不做服务端分页搜索（会话 ≤ 500 条，前端过滤足够，见 `contracts/api.md` §1.1 预算）。
- 不做 duration 推导本身（`add-mission-control` P0-A 已落地 `deriveDurations`，
  本 change 只修「推导结果写不进 DB」）。
- 不重做 TraceTimeline 的搜索/分组/键盘导航/虚拟滚动。

## Decisions

### D1. JSONL 索引计数：全文件流式数 message 行

保留「不读 JSON body、不跑 adapter」约束，但把「读到首条 user 消息就停」改为
「流式数完全文件的 message 行（含 cap：16MB / 10 万行，超出标记 approximate）」。
标题仍取首条真实 user 消息（首个 120 字符），与计数解耦。

替代方案：详情阶段回写 `COUNT(events)` 到 `event_count` —— 被拒：列表必须在
打开前就显示真实数字（REQ-016 场景），且 JSONL 一个文件一会话时详情计数就是
行数，索引阶段数行数成本极低。

### D2. SQLite 索引计数：message + 非标记 part 两级 COUNT

`readOpenCodeSessionIndex` 增加一条轻量 SQL：`COUNT(part)` 按 message 会话分组，
排除纯 `step-start`/`step-finish` 标记（与 adapter 过滤规则同口径，见 D4），
`eventCount = messages + nonMarkerParts`。真实 CodeArts 25 消息 + 57 非标记 part
→ 82，与详情一致；`messageCount` 保持消息数，不再用详情 events.length 覆盖。

### D3. 差分写入：`content_hash` 判等（schema v3→v4）

`events` 表加 `content_hash TEXT NOT NULL DEFAULT ''`。写入时对全部可变列
（kind/phase/title/started_at/duration_ms/status/actor/tool/input_summary/
output_summary/tokens_json/error/model）取稳定哈希（FNV-1a 64 位，hex），
`(id, sequence, content_hash)` 全同才跳过，否则 `DO UPDATE` 并刷新 hash。

- 迁移：`ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''` 幂等；存量行 hash 为
  空串 → 下次重扫必然不匹配 → 全量刷新，天然自愈旧数据。
- 替代方案 A：重扫时无条件 UPDATE 全部行 —— 违背差分意图，9,590 事件会话每次
  全量写。
- 替代方案 B：只在 `detail_loaded` 重置时重扫 —— 无法表达「adapter 逻辑升级后
  数据需要刷新」，且 D4 已修 detail_loaded 生命周期。

### D4. opencode tool 输入输出 + step 标记过滤

- tool part：`inputSummary = JSON.stringify(state.input)`、`outputSummary =
  state.output`（字符串直取，对象序列化），统一走 REQ-003 截断（5000 字符），
  `hasInput/hasOutput` 由现有 computed 列（input/output_summary 非空）自动成立。
- step 过滤：`step-start` / `step-finish` 满足「无 text、无 tokens、无 error、
  status=completed」时跳过；否则保留为 `agent` 事件，标题
  `agent step: <status>`。tokens 归属：先按 `isTokenCarrier` 找代表 part，若代表
  part 被过滤，则把 message.tokens 挂到该消息最后一个保留事件上，绝不丢计量。

### D5. `detail_loaded` 生命周期

`upsertSessionFromIndex` 的 conflict-update 排除列表加入 `detail_loaded`
（与 `event_count`/`message_count` 同一保留机制）：已加载会话不被 watcher 重置。
源文件删除/强制 rescan 路径（cleanup / force）仍可置 0 触发重扫。

### D6. 甘特双模式

`TraceTimeline` 内部持有 `layoutMode: 'time' | 'sequence'`，工具栏加切换 chip，
i18n 两条文案。实现上共享 `visibleRows` 与虚拟滚动：

- time 模式：现状不变（axis/zoom/相对绝对时间）。
- sequence 模式：bar `left = (sequence-1)/n`、`width = 1/n`（n=可见事件数），
  时间轴替换为序号刻度，zoom/时间切换隐藏，时长列照常显示，0 时长事件得到完整
  格子（不再 2px 线）。

模式切换不放 App 全局（单会话视图内部偏好），与 semanticGroup 的受控方式区分。

### D7. 会话 ID 展示与搜索

meta 行加 ID：`⟨C⟩ codearts-87fa3223… · 2h ago · 110 ev · 1.9M tok`，mono +
`--text-xs`，截断保留前缀，完整 ID 进 `title` 属性（不破坏 44px 两行布局）。
搜索匹配已有 `s.id` 逻辑，placeholder 改为「title / id」。

## Risks / Trade-offs

- [全文件流式计数拉长索引时间] → cap 16MB/10 万行 + approximate 标记；
  `perf:check` 记录真实增量（目标：单文件 ≤ 5ms + 1ms/MB）。
- [content_hash 一次迁移后首次全量刷新写入量大] → 单次事件，9.5k 事件 < 百 ms；
  DB 为本地派生缓存，可重建。
- [step 标记过滤改变既有会话事件数与 sequence] → 重扫后一次性自愈；sequence 由
  `orderEventsByTime` 确定性重排，G10.3 合并要求不受影响。
- [与 `add-mission-control` 同改 opencode.ts / schema.ts / writers.ts] → 实施顺序
  先 add-mission-control 存储层（其 tasks 已声明为第一缺口），本 change 的 v4
  迁移叠加在其 v3 之上；两 change 的 adapter 改动集中在不同函数。
- [meta 行拥挤] → ID 截断 + title 属性；若视觉验证仍挤，把 provider 移到状态点旁
  释放空间（不改 spec，属实现层调整）。

## Migration Plan

1. schema `v3→v4`：`ALTER TABLE events ADD COLUMN content_hash TEXT NOT NULL
   DEFAULT ''`（幂等），`SCHEMA_VERSION = 4`。
2. 存量库：下次任何会话重扫时自动刷新（hash 空串必不匹配）；无需删库。
3. 回滚：删除本 change 的列/行为即可（ADD COLUMN 非破坏性，旧代码读到未知列
   无影响——查询为显式列）。

## Open Questions

无（均为实现层细节，见 tasks）。
