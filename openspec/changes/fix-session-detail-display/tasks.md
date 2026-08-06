# Tasks: fix-session-detail-display

> 裁决依据：本目录 `design.md`；开工前先读 `design.md` 与四个 delta spec。
> 前置：`add-mission-control` 的存储层缺口（writers/query-engine 读写 8 个新列）
> 先落地，本 change 的 schema 迁移叠加在其 v3 之上。
> 每个批次结束跑 `npm run typecheck && npm run test && npm run lint`；
> 提交前追加 `npm run perf:check` 结果到 `PERF-BASELINE.md`。

## 1. 存储层：schema v4 + 差分写入自愈

- [x] 1.1 `server/storage/schema.ts`：`SCHEMA_VERSION` 保持 4（已被
  calibrate-tokens 占用），`events` 加 `content_hash TEXT NOT NULL DEFAULT ''`，
  新库 DDL 直接建出，既有库走 initSchema 幂等 `ADD COLUMN`（ensure 步骤）
- [x] 1.2 `server/storage/writers.ts`：`EVENT_COLS` 加 `content_hash`；
  `upsertEvents` 改为读现有 `(id, sequence, content_hash)`，只有
  id+sequence+hash 全同才跳过；`DO UPDATE` 时刷新 hash
- [x] 1.3 读取路径保持显式列（writers 的 SELECT 已显式列）；`content_hash`
  是写入侧内部判等列，不进 API tier，`mapEvent`/`mapSession` 不受影响
- [x] 1.4 `server/storage/writers.ts`：`upsertSessionFromIndex` 的 conflict 保留
  列表加 `detail_loaded`（与 event_count/message_count 同机制），watcher 不再
  把已加载会话重置为 0
- [x] 1.5 哈希工具：`src/core/event-hash.ts`（FNV-1a 64bit
  hex），输入全部可变列的规范化字符串，含单测（内容变化→hash 变化）
- [x] 1.6 `server/storage/writers.test.ts`：新增「同 id+sequence 内容变化仍
  UPDATE」「内容不变跳过」「迁移幂等」「detail_loaded 不被索引 upsert 重置」用例

## 2. 适配器：opencode 系输入输出与噪音行

- [x] 2.1 `src/adapters/opencode.ts` `partToEvent`：tool part 从
  `state.input`/`state.output` 生成 `inputSummary`/`outputSummary`
  （对象 JSON 序列化，字符串原样），`hasInput`/`hasOutput` 随数据成立
- [x] 2.2 `src/adapters/opencode.ts`：过滤纯 `step-start`/`step-finish` 标记
  （无 text/tokens/error 且 completed）；携带 tokens/error 的 step 保留为
  `agent` 事件并给确定性标题 `agent step: <status>`
- [x] 2.3 `src/adapters/opencode.ts`：tokens 归属——part.tokens（真实
  step-finish 顶层）优先，否则 message.tokens 挂到保留的 step 系 part；
  纯标记被过滤后挂到最后一个保留事件，计量不丢不膨胀
- [x] 2.4 `src/adapters/codearts.test.ts` / `opencode.test.ts`：真实
  `state.input/output` tool part、纯 step 标记、tokens 转移三类用例
- [x] 2.5 跑 `npm run typecheck && npm run test` 全绿；lint 本 change 文件无错误

## 3. 索引计数：与详情同口径

- [x] 3.1 `local-sessions/index-title.ts`：`readJsonlIndexMeta` 改为流式数完全
  文件 message 行（cap 16MB/10 万行，超出标记 approximate），标题仍取首条真实
  user 消息；`eventCount = messageCount`
- [x] 3.2 `local-sessions/opencode.ts` `readOpenCodeSessionIndex`：增加轻量
  `COUNT(part)`（排除纯 step 标记，与详情适配器同口径）按会话聚合，
  `eventCount = 保留 part 数`，`messageCount = 消息行数`（真实 CodeArts 库
  实测 4 会话：4/46/50/54 vs 详情一致，见验收 5.1）
- [x] 3.3 索引/扫描测试：JSONL 全文件计数 + approximate；SQLite 两类 schema
  （legacy/data 列）part 计数与 messageCount 分离断言；`detail_loaded=1`
  会话在索引 upsert 后保持 1
- [x] 3.4 受影响断言同步修正（sqlite-index / scanner-opencode 按 part 口径）
- [x] 3.5 跑 `npm run typecheck && npm run test` 全绿；lint 本 change 文件无错误

## 4. 前端：会话 ID + 甘特双模式 + 输入输出徽标

- [x] 4.1 `src/components/SessionList.tsx`：meta 行显示 session ID（mono、
  `--text-xs`、截断、完整 ID 进 `title`）；搜索 placeholder 改为「title / id」，
  ID 匹配保持 `s.id` 包含匹配
- [x] 4.2 `src/components/TraceTimeline.tsx`：新增 `layoutMode: 'time' |
  'sequence'` 状态与工具栏切换 chip；sequence 模式按 sequence 等宽排布、
  序号轴、隐藏时间轴 zoom/相对绝对时间，时长列照常
- [x] 4.3 `src/components/TraceTimeline.tsx`：事件行在 `hasInput`/`hasOutput`
  时渲染 `in`/`out` 徽标（复用 slim 的 computed has_input/has_output）
- [x] 4.4 `src/i18n.ts`：`timeline.modeTime` / `timeline.modeSequence` /
  `session.searchById` 等中英文案
- [x] 4.5 样式：`src/styles/`（或所在 CSS 文件）补 sequence 模式与徽标样式，
  保持 G-DS 令牌体系
- [x] 4.6 `TraceTimeline.test.tsx` / `SessionList.test.tsx`：双模式切换、
  0 时长会话 sequence 模式全可见、ID 展示与搜索、徽标断言
- [x] 4.7 跑 `npm run typecheck && npm run test` 全绿；`npm run lint` 仅剩
  未跟踪文件 `scripts/frida-trae-key-macos.js` 的既有错误（本 change 文件无
  lint 错误）

## 4b. 会话导航：服务端过滤 + 分页 + hash（proposal 追加）

- [x] 4.8 `GET /api/sessions` 追加过滤参数：`q`（标题/ID 子串、LIKE 转义）、
  `range`（today/7d/30d/all）、`provider`/`status` 逗号分隔多选（IN）；
  `query-engine.ts` / `server.ts` / `src/api/client.ts` /
  `contracts/api.md` §1.1 同步；非法值 400 INVALID_ENUM
- [x] 4.9 `SessionList` 时间范围分段控件（默认 today）+ 分页页脚（总数 +
  「加载更多」按钮，替代纯无限滚动）+ 服务端搜索（不再只过滤已加载页）；
  过滤状态进 URL hash（`q` / `time`，`hash-router.ts`）
- [x] 4.10 `App.tsx` 会话视图 IA 重构：粘性 `SessionToolbar`（四维紧凑指标 +
  操作菜单）+ findings 折叠面板 + 时间线主画布；移除 ContextBar /
  SessionHeaderCard / PhaseRibbon / PhaseTiles / TimeCompositionBar 的渲染
- [x] 4.11 `TraceTimeline` 新增可点击阶段轴：时间模式按时间占比、序列模式按
  事件数占比；点击片段滚动定位到该阶段首个事件、高亮并进入右侧 EventInspector
- [x] 4.12 测试补齐：query-engine `q`/`range`/`status` + LIKE 转义、
  server 路由过滤与非法值、SessionList 时间范围/分页/ID、TraceTimeline 双模式/
  阶段轴/徽标、hash-router 往返、App IA 冒烟

## 5. 端到端验收

- [x] 5.1 本地起服（`npm start`），真实 codearts/opencode/codex 库强制重扫后：
  codearts 4/47/104、opencode 15、codex 1307/181/48 全部 list=detail 一致
  （`detail.pending=false`，打开前后不变）
- [x] 5.2 打开 CodeArts 会话：tool 事件 hasInput/hasOutput=true，事件正文
  `inputSummary`（JSON）与 `outputSummary`（文本）非空（HTTP 实测）；Raw 由
  `include=raw` 按需返回（单测覆盖）
- [x] 5.3 甘特 sequence 模式：0 时长会话等宽可见、可点击进详情、time 模式
  不回归 —— TraceTimeline 单测覆盖（双模式/阶段轴/键盘）；in-app 浏览器本
  会话不可用，未做截图预览
- [x] 5.4 会话列表搜索 `codearts-87fa` 前缀命中 1 条（HTTP 实测）；meta 行
  ID 展示由 SessionList 单测覆盖
- [x] 5.5 全量门禁 typecheck/test(501)/lint（本 change 文件）全绿 +
  `npm run perf:check` 无 >20% 劣化（worstDetail 9.056ms / overview 22.79ms），
  已追加 `PERF-BASELINE.md`
