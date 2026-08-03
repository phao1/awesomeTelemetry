# Spec: Storage

> SQLite 存储层：schema、写入、查询。schema 版本 **v1**（全新构建，无历史迁移）。
> **DDL / 索引 / PRAGMA 的权威来源是 `contracts/database.md`，本文件只定义行为需求。**
> 源文件：`server/storage/`

## Purpose

持久化 scan 会话、proxy 请求、Frida 捕获、metrics。WAL 模式，单进程写。

## Requirements

### REQ-001: 连接初始化
`openWritable()` MUST 按 `contracts/database.md` §1 的顺序设置全部 8 项 PRAGMA，并创建父目录。
`openReadonly()` MUST 用 `{ readonly: true, fileMustExist: true }`。

#### Scenario: WAL 未受控增长
- **GIVEN** 未设置 `wal_autocheckpoint`
- **WHEN** 系统运行数日
- **THEN** WAL 文件涨到 151.82MB（v4 实测）
- **THEREFORE** MUST 显式设 `wal_autocheckpoint = 2000`，且每轮扫描结束调用一次 `checkpointWal()`

### REQ-002: checkpoint 不得阻塞
`checkpointWal()` MUST 用 `wal_checkpoint(TRUNCATE)`，遇 busy MUST 静默跳过并等下一轮。MUST NOT 重试或阻塞等待。

### REQ-003: 建库幂等
`initSchema(db)` SHALL 执行 `contracts/database.md` §3 全部建表、§4 全部建索引、写入 `_meta.schema_version = SCHEMA_VERSION`（常量为 1）、执行 `ANALYZE`。全过程 MUST 幂等，重复调用无副作用。

本项目为全新构建，**无历史迁移**。`migrations/` 目录预留但当前为空。

#### Scenario: 数据库版本高于代码
- **GIVEN** 读到的 `schema_version` 大于代码常量
- **THEN** MUST 中止启动并提示"数据库由更新版本创建"
- **AND** MUST NOT 尝试降级或改写

### REQ-004: 显式列查询
所有查询 MUST 显式列出返回列。MUST NOT 使用 `SELECT *`。列常量定义见 `contracts/database.md` §5.2。

### REQ-005: prepared statement 复用
所有语句 MUST 通过模块级缓存的 `db.prepare()` 复用。MUST NOT 在循环体内 prepare。

### REQ-006: 会话查询
- `listSessions(opts)` — 支持 `dataSource` / `provider` / `keys` 过滤，keyset 分页（`cursor` = 上页末条 `startedAt`），`ORDER BY started_at DESC`。返回 `SessionIndexEntry[]`，**MUST NOT 含 `systemPrompt` 正文**，用 `hasSystemPrompt` 布尔量代替。
- `getSessionDetail(key, opts)` — `opts.mode` 默认 `'slim'`，支持 `offset` / `limit`。

#### Scenario: 详情默认不返回正文
- **GIVEN** `GET /api/sessions/:key` 未指定 mode
- **THEN** 返回的每个 event MUST NOT 含 `inputSummary` / `outputSummary` / `raw`
- **AND** 9,590 events 的最差会话响应体 MUST < 1.5MB

### REQ-007: 大会话分页
event 数 > 2000 时 `getSessionDetail` SHALL 分页返回，响应含 `eventTotal` / `eventOffset` / `eventLimit` / `hasMore`。event 分页用 offset 而非 cursor（`sequence` 连续且稳定，且前端虚拟滚动需要随机跳转）。

### REQ-008: 单 event 下钻
`getEventDetail(sessionId, eventId, includeRaw)` SHALL 返回单条 `TraceEvent`；`includeRaw` 为真时从 `event_raw` 表补 `raw` 字段。

### REQ-009: Agent Overview 服务端聚合
`getAgentOverview(dataSource)` MUST 用两条 SQL（会话级 + event 级）在服务端完成聚合，返回 `AgentOverviewRow[]`。

#### Scenario: 禁止前端 N+1
- **GIVEN** 用户切到 Agent 视图
- **THEN** 前端 MUST 只发起 1 个请求
- **AND** MUST NOT 逐会话拉详情

> 依据：v4 该视图产生 524 请求 / 299.6MB / 4,732ms。

#### Scenario: 聚合结果缓存
- **GIVEN** `MAX(sessions.updated_at)` 未变化
- **WHEN** 再次请求 overview
- **THEN** 直接返回缓存结果，响应 < 20ms，`cached: true`

### REQ-010: 会话写入 upsert
`upsertSessionFromIndex()` / `upsertSessionFromTrace()` MUST 用 `INSERT ... ON CONFLICT(id) DO UPDATE`。

### REQ-011: 事件差分写入
`upsertEvents()` MUST 用差分策略：
1. 读现有 `(id, sequence)` 集合
2. 对新数据逐条 `INSERT ... ON CONFLICT(session_id, id) DO UPDATE`
3. 删除新数据中不存在的 stale id（同时删 `event_raw` 对应行）
4. 全部包在单个 `db.transaction()` 内

MUST NOT 使用「先 DELETE 全部再 INSERT」。

#### Scenario: append 一个 event
- **GIVEN** 某会话已有 347 个 event，源文件新增 1 条
- **WHEN** `upsertEvents` 执行
- **THEN** 只产生 1 条 INSERT，耗时 < 20ms
- **AND** v4 的行为是 1 DELETE + 347 INSERT / 181.91ms，是回归防线

### REQ-012: event id 去重
同 session 内重复 event id MUST 在 adapter 层追加 `:{sequence}` 后缀，写库前保证唯一。`undefined` MUST 转 `null`。

### REQ-013: metrics 持久化
`upsertMetrics()` MUST 写入基础指标**与四维指标**，并写 `calc_version`。
`getMetrics()` MUST 在 `calc_version` 不等于代码常量 `METRICS_CALC_VERSION` 时重算并回写。

> v4 的 G5.3「四维指标不持久化是设计选择」在 v5 被**推翻**。理由：不持久化导致 Agent Overview 必须逐会话重算，是 524 次 N+1 的直接成因。

### REQ-014: 系统提示词关联
`getSystemPromptForSession(startedAt, endedAt)` SHALL 用 `system_prompt_len` 冗余列排序，MUST NOT 使用 `ORDER BY LENGTH(system_prompt)`。

### REQ-015: proxy 查询
`listProxyRequests(opts)` MUST 排除 `request_body` / `response_body` / `raw_request_body` / `raw_response_body` / `system_prompt` 五列，返回 `ProxyRequestListItem[]`。

### REQ-016: 删除会话
`deleteSession(key)` MUST 级联删除 `events` + `event_raw` + `metrics` + `sessions` + 该会话对应的 `scan_state` 行。

### REQ-017: 数据保留
启动时 SHALL 按 `--proxy-retention-days`（默认 30，0 表示不清理）清理过期 `proxy_requests`。删除行数 > 1000 时触发一次 `checkpointWal()`。

## Gotchas
- G5.1：WAL 模式导致文件监视不可靠（见 session-scanning）
- G5.2：db 类 provider 必须轮询，且指纹要覆盖 `-wal` 文件
- G4.8：event id 去重必须保留
- G11.2（新）：`events.raw` 必须独立成表，留在主表会让详情查询无法避开 147MB
- G11.3（新）：`ORDER BY LENGTH(col)` 无法走索引，必须用冗余长度列
- G11.4（新）：v4 的四条查询全部产生 `USE TEMP B-TREE`，因为索引是单列而非复合。补索引前务必用 `EXPLAIN QUERY PLAN` 确认
