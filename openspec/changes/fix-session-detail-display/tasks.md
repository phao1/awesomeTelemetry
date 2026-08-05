# Tasks: fix-session-detail-display

> 裁决依据：本目录 `design.md`；开工前先读 `design.md` 与四个 delta spec。
> 前置：`add-mission-control` 的存储层缺口（writers/query-engine 读写 8 个新列）
> 先落地，本 change 的 schema 迁移叠加在其 v3 之上。
> 每个批次结束跑 `npm run typecheck && npm run test && npm run lint`；
> 提交前追加 `npm run perf:check` 结果到 `PERF-BASELINE.md`。

## 1. 存储层：schema v4 + 差分写入自愈

- [ ] 1.1 `server/storage/schema.ts`：`SCHEMA_VERSION = 4`，`events` 加
  `content_hash TEXT NOT NULL DEFAULT ''`，迁移 `v3→v4` 用幂等 `ADD COLUMN`
- [ ] 1.2 `server/storage/writers.ts`：`EVENT_COLS` 加 `content_hash`；
  `upsertEvents` 改为读现有 `(id, sequence, content_hash)`，只有
  id+sequence+hash 全同才跳过；`DO UPDATE` 时刷新 hash
- [ ] 1.3 `server/storage/columns.ts`：查询列补 `content_hash`（显式列，禁
  `SELECT *`）；`mapEvent`/`mapSession` 读取不受影响
- [ ] 1.4 `server/storage/writers.ts`：`upsertSessionFromIndex` 的 conflict 保留
  列表加 `detail_loaded`（与 event_count/message_count 同机制），watcher 不再
  把已加载会话重置为 0
- [ ] 1.5 哈希工具：`src/core/event-hash.ts`（或 writers 内私有函数，FNV-1a 64bit
  hex），输入全部可变列的规范化字符串，含单测（内容变化→hash 变化）
- [ ] 1.6 `server/storage/writers.test.ts`：新增「同 id+sequence 内容变化仍
  UPDATE」「内容不变跳过」「迁移幂等」「detail_loaded 不被索引 upsert 重置」用例

## 2. 适配器：opencode 系输入输出与噪音行

- [ ] 2.1 `src/adapters/opencode.ts` `partToEvent`：tool part 从
  `state.input`/`state.output` 生成 `inputSummary`/`outputSummary`
  （对象 JSON 序列化 + REQ-003 截断），`hasInput`/`hasOutput` 随数据成立
- [ ] 2.2 `src/adapters/opencode.ts`：过滤纯 `step-start`/`step-finish` 标记
  （无 text/tokens/error 且 completed）；携带 tokens/error 的 step 保留为
  `agent` 事件并给确定性标题 `agent step: <status>`
- [ ] 2.3 `src/adapters/opencode.ts`：tokens 归属转移——被过滤的 step 若为
  token 代表 part，把 message.tokens 挂到该消息最后一个保留事件，计量不丢
- [ ] 2.4 `src/adapters/codearts.test.ts` / `opencode.test.ts`：真实
  `state.input/output` tool part、纯 step 标记、tokens 转移三类用例
- [ ] 2.5 跑 `npm run typecheck && npm run test && npm run lint` 全绿

## 3. 索引计数：与详情同口径

- [ ] 3.1 `local-sessions/index-title.ts`：`readJsonlIndexMeta` 改为流式数完全
  文件 message 行（cap 16MB/10 万行，超出标记 approximate），标题仍取首条真实
  user 消息；`eventCount = messageCount`
- [ ] 3.2 `local-sessions/opencode.ts` `readOpenCodeSessionIndex`：增加轻量
  `COUNT(part)`（排除纯 step 标记）按会话聚合，`eventCount = messages +
  nonMarkerParts`，`messageCount` 保持消息数
- [ ] 3.3 索引/扫描测试：真实 codex JSONL（2350 行）与 CodeArts（25 消息/57
  非标记 part → 82）断言索引计数 = 详情计数；`detail_loaded=1` 会话在索引重扫后
  保持 1
- [ ] 3.4 `server/storage/overview.test.ts` / `server/server.test.ts` 受影响
  断言同步修正（messageCount/eventCount 语义分离后）
- [ ] 3.5 跑 `npm run typecheck && npm run test && npm run lint` 全绿

## 4. 前端：会话 ID + 甘特双模式 + 输入输出徽标

- [ ] 4.1 `src/components/SessionList.tsx`：meta 行显示 session ID（mono、
  `--text-xs`、截断、完整 ID 进 `title`）；搜索 placeholder 改为「title / id」，
  ID 匹配保持 `s.id` 包含匹配
- [ ] 4.2 `src/components/TraceTimeline.tsx`：新增 `layoutMode: 'time' |
  'sequence'` 状态与工具栏切换 chip；sequence 模式按 sequence 等宽排布、
  序号轴、隐藏时间轴 zoom/相对绝对时间，时长列照常
- [ ] 4.3 `src/components/TraceTimeline.tsx`：事件行在 `hasInput`/`hasOutput`
  时渲染 `in`/`out` 徽标（复用 slim 的 computed has_input/has_output）
- [ ] 4.4 `src/i18n.ts`：`timeline.modeTime` / `timeline.modeSequence` /
  `session.searchById` 等中英文案
- [ ] 4.5 样式：`src/styles/`（或所在 CSS 文件）补 sequence 模式与徽标样式，
  保持 G-DS 令牌体系
- [ ] 4.6 `TraceTimeline.test.tsx` / `SessionList.test.tsx`：双模式切换、
  0 时长会话 sequence 模式全可见、ID 展示与搜索、徽标断言
- [ ] 4.7 跑 `npm run typecheck && npm run test && npm run lint` 全绿

## 5. 端到端验收

- [ ] 5.1 本地起服（`npm start`），对真实 codearts 库：列表 CodeArts 会话
  `eventCount` 与详情一致且打开前后不变
- [ ] 5.2 打开 CodeArts 会话：tool/file_read/bash 事件在 EventInspector
  Input/Output tab 有真实内容；Raw tab 按需返回原始 part
- [ ] 5.3 甘特 sequence 模式：0 时长会话每行等宽可见、可点击进详情；time 模式
  行为不回归（搜索/分组/缩放/键盘导航）
- [ ] 5.4 会话列表搜索 `codearts-87fa` 前缀/ID 片段命中；meta 行 ID 可见
- [ ] 5.5 全量门禁 + `npm run perf:check`：索引计数增量记录进
  `PERF-BASELINE.md`，无 >20% 劣化
