# Proposal: fix-session-detail-display

## Why

真实机器验证（2026-08-05，49 个会话）发现详情/列表展示大面积失真：
列表里 codex 会话显示 `5 ev` 但详情实际 2350 个事件；CodeArts 会话索引 25 条、
详情 71–82 条；opencode 系 tool/bash/file_read/file_write 事件的
`inputSummary`/`outputSummary` 全部为空（真实数据在 `state.input`/`state.output`）；
CodeArts 事件 `duration_ms` 全为 0 导致时间比例甘特退化成等宽条；列表行不显示
session ID，且甘特只有时间模式、没有序列模式。用户体感就是「很多数据展示都是空」。

## What Changes

**数据一致性（P0，不做后面全是空/错面板）**

- 索引阶段 eventCount 与详情一致：JSONL 索引改为流式统计全文件 message 行（有上限，
  不再「读到首条 user 消息就停」）；SQLite 索引按「message + part」两级统计每会话
  事件数（轻量 SQL，不读正文）。`messageCount` 与 `eventCount` 语义分离：消息数 vs
  事件数（详情阶段不再用 events.length 冒充 messageCount）。
- 索引 upsert 不得把已加载会话的 `detail_loaded=1` 重置为 0（watcher 每 30s 一轮，
  当前会导致用户每点一次都重扫全文件）。
- `upsertEvents` 差分写入补内容变更检测：现在 (id, sequence) 相同就跳过，adapter
  升级后新产出的 duration / input / output 永远写不进去（实测重扫后仍是旧值）。
  方案：新增 `content_hash` 列（schema v3→v4），id+sequence+hash 全同才跳过。

**opencode 系适配器（CodeArts/OpenCode/CodeAgent2）输入输出与噪音行**

- tool 类 part 提取 `state.input` → `inputSummary`、`state.output` →
  `outputSummary`（对象 JSON 序列化 + 截断，沿用 REQ-003 截断规则）。
- 纯控制标记 `step-start`/`step-finish`（无 text、无 tokens、无 error、status
  completed）跳过不产出事件；携带 tokens 或 error 的 step 保留，并给确定性标题，
  避免甘特里一排空标题行。

**会话 ID 展示与搜索（frontend）**

- 会话列表第二行显示 session ID（mono、截断、可复制），搜索框提示注明
  「标题 / ID」；ID 匹配保持现有行为并显式化。

**轨迹甘特图：时间模式 + 序列模式（frontend）**

- `TraceTimeline` 增加 `layoutMode: 'time' | 'sequence'` 工具栏切换。
  - 时间模式：现有时间比例甘特（时间轴、缩放、相对/绝对时间）。
  - 序列模式：按 sequence 均匀排布（等宽 bar + 序号轴），时间轴/缩放禁用，
    时长列照常显示；两种模式下每一行都保持可点击、可进 EventInspector。
- 事件行显示 `hasInput` / `hasOutput` 徽标；EventInspector 的 Input/Output tab
  随适配器数据修复后展示真实内容（Raw tab 保持按需拉取）。

无 BREAKING API 变更（纯新增 UI 状态 + schema 加列 + 索引/写入口径修正）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `adapters`：REQ-005/REQ-013 扩展 —— opencode 系 tool 事件输入输出提取、纯 step
  标记跳过、tokens 转移。
- `session-scanning`：REQ-021 索引计数口径（全文件 message 计数 / SQLite 两级
  计数）、REQ-015 惰性详情与索引 upsert 不互相打架。
- `storage`：REQ-011 差分写入按内容哈希判等、`content_hash` 列与 schema v4 迁移。
- `frontend`：REQ-016 会话行展示 ID、REQ-017 甘特时间/序列双模式 + 输入输出徽标。

## Impact

- 适配器：`src/adapters/opencode.ts`（tool 输入输出、step 标记、tokens 转移）。
- 索引：`local-sessions/index-title.ts`（JSONL 全文件计数）、
  `local-sessions/opencode.ts`（SQLite 两级计数）。
- 存储：`server/storage/schema.ts`（v3→v4 + `content_hash`）、
  `server/storage/writers.ts`（hash 判等差分写入）、`server/storage/columns.ts`。
- 前端：`src/components/SessionList.tsx`、`src/components/TraceTimeline.tsx`、
  `src/App.tsx`（layoutMode 状态）、i18n、CSS。
- 测试：上述模块各加单元测试；`npm run typecheck && npm run test && npm run lint`
  全绿，M3 起追加 `npm run perf:check`。
- 与进行中的 `add-mission-control` 有文件交集（opencode.ts / schema.ts），
  实施顺序：先落 `add-mission-control` 存储层（其已声明是第一个缺口），
  本 change 的 schema 迁移叠加在其 v3 之上。
