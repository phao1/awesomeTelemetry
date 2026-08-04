# Spec: Session Scanning

> 本地会话文件扫描：config、scanners、增量门禁、file-watcher、scan-scheduler。
> 源文件：`local-sessions/` + `server/watch/`

## Purpose

读取各 Agent 在本地磁盘留下的会话文件，产出 `SessionIndexEntry`，写入 SQLite，实时推送到 UI。
**核心约束：不做无用功。** v4 因 `scan_state` 失效，每轮重处理 1,514 个文件 / 800.21MB。

## Requirements

### REQ-001: 增量门禁（v5 核心）
任何详情读取前 MUST 先经过 `shouldRescan(db, sourcePath)` 门禁。门禁判定未变更时 MUST 直接返回，**零文件读取、零 JSON 解析、零 SQL 写入**。

#### Scenario: 无变更重扫
- **GIVEN** 全部源文件自上次扫描以来未变更
- **WHEN** 执行一轮完整扫描
- **THEN** SQL 写语句数 = 0
- **AND** 读取字节数 < 20MB（仅 stat + 每文件 8KB 指纹探测）
- **AND** 耗时 < 2s

> v4 实测：18,235 条 SQL / 重读 800MB。

### REQ-002: 文件指纹
`fingerprintFile(path)` SHALL 返回 `{ size, mtimeMs, hash }`，其中 hash = SHA1(size + 首 4KB + 尾 4KB)。成本恒定，与文件大小无关。

#### Scenario: WAL 型数据库的指纹
- **GIVEN** provider 的 `sourceKind` 为 `sqlite` 或 `sqlcipher`
- **WHEN** 计算指纹
- **THEN** MUST 同时计算主 DB 文件与 `-wal` 文件的指纹并拼接
- **AND** 仅看主文件会永远判定为未变更（WAL 模式下主文件 mtime 不变）

> 这是 G5.2 那条坑的正解。v4 只能被迫改 30s 轮询，是因为没意识到要看 `-wal`。

### REQ-003: scan_state 强制写入
每次成功的详情扫描后 MUST 调用 `commitScanState()`。写入失败 MUST 抛错，MUST NOT 静默 catch。

#### Scenario: scan_state 为空
- **GIVEN** 首轮全量扫描完成
- **THEN** `SELECT COUNT(*) FROM scan_state` MUST ≥ 源文件数
- **AND** v4 实测该值为 0，是必须守住的回归防线

### REQ-004: 配置三层覆盖
`loadLocalSessionConfig()` SHALL 按顺序合并：内置默认 → `config/local-sessions.local.json`（项目级，gitignored）→ 用户配置（`%APPDATA%/agent-observe/agent-observe.json` 或 `~/.config/agent-observe/agent-observe.json`）。后者覆盖前者。写入用户配置 MUST 原子写（tmp + rename）。

### REQ-005: 路径展开
`expandLocalSessionPath()` SHALL 支持 `~`、`~\`、`%VAR%` 三种语法。

### REQ-006: 默认路径（env 优先）
| Provider | 默认路径 | sourceKind | watchStrategy |
|----------|----------|-----------|---------------|
| claude | `$CLAUDE_CONFIG_DIR/projects` → `~/.claude/projects` | jsonl | chokidar |
| codex | `$CODEX_HOME/sessions` → `~/.codex/sessions` | jsonl | chokidar |
| opencode | `~/.local/share/opencode`（Win: `%APPDATA%/opencode`） | sqlite | poll |
| codearts | `$CODEARTS_HOME` → `~/.codeartsdoer/codearts-data` | sqlite | poll |
| codeagent | `$CAC_HOME/projects` → `~/.cac/projects` | jsonl | chokidar |
| codeagent2 | `~/.local/share/codemate` | sqlite | poll |
| trae | `%APPDATA%\Trae CN\ModularData\ai-agent` | sqlcipher | poll |
| qoder | `~/.qoder`（默认禁用） | jsonl | chokidar |
| workbuddy | `$WORKBUDDY_HOME/projects` → `~/.workbuddy/projects` | jsonl | chokidar |

### REQ-007: 会话 key 生成
`sessionKey(provider, id, sourcePath)` SHALL 等于 `provider-` 加 SHA1(`provider:id:sourcePath`) 的前 14 位。MUST 包含 sourcePath 防撞 key。

**索引阶段与详情阶段 MUST 使用同一个派生函数 `deriveSessionKey(provider, sourcePath, innerId?)`，禁止两处各算各的**（T-02：P0-2 的根因）：

- JSONL 类（每文件一会话，`innerId` 缺省）：稳定来源标识 = 文件名，
  `deriveSessionKey(p, path) == sessionKey(p, basename(path), path)`
- SQLite 类（一库多会话，`innerId` = db 行内 session id）：稳定来源标识 = db 路径 + 行内 id，
  `deriveSessionKey(p, path, id) == sessionKey(p, id, path)`

关键约束：**索引阶段拿得到、详情阶段算得出同一个值**。adapter 解析出的 session id
只在 SQLite 多会话场景参与 key 派生；JSONL 场景一律以文件路径为准。

### REQ-008: JSONL 尾部增量读
`sourceKind` 为 `jsonl` 时，`readJsonlFrom(path, startOffset)` SHALL 用 `createReadStream({ start })` 流式逐行解析，返回 `{ rows, endOffset }`。

MUST NOT 用正则 split 整个文件字符串。

#### Scenario: 回退全量的条件
- **GIVEN** 以下任一条件成立：`file_size < prevOffset`（文件被截断）、首 4KB hash 变化（文件被重写）
- **THEN** MUST 回退到 offset=0 的全量解析

> 依据：codeagent 单 provider 948 文件 / 739.21MB，占源文件总量 92.4%，且 JSONL 是 append-only。
> CPU profile 中 `RegExp: \r?\n` self time 459.8ms，即 v4 的整串 split 实现。

### REQ-009: SQLite 只读打开
`openReadonly(dbPath)` SHALL 用 better-sqlite3 readonly + `fileMustExist: true`。

### REQ-010: 各 scanner 行为
- **claude.ts** — 扫 `.jsonl`，首行取 sessionId，首条 user message 取 title
- **codex.ts** — 扫 `.jsonl` + 读 `session_index.jsonl` + `state_5.sqlite`（threads 表）取 title
- **opencode.ts** — 支持 db / logs / otel 三源，用 `OpenCodeDialect` 参数定制。
  db 源 MUST 按 `session` 行展开为 N 个会话（T-03，1 个 .db 文件 ≠ 1 个会话），
  详情读取同样按 session 分组后逐个 normalize。
- **codearts.ts / codeagent2.ts** — thin wrapper 调 opencode.ts，传不同 dialect，
  继承多会话展开行为
- **codeagent.ts** — 扫 `.jsonl`，过滤 `file-history-snapshot` 行
- **trae.ts** — 见 REQ-012
- **workbuddy.ts** — 扫 `.jsonl` + 读 `workbuddy.db` 取 title，过滤 `file-history-snapshot`，从 `<user_query>` 提取用户问题

### REQ-011: provider 并行 + 熔断
`scanLocalSessions()` SHALL 并行扫描所有 enabled provider，每个 provider 设独立超时（默认 30s）。超时的 provider MUST 被跳过并记录，MUST NOT 阻塞其他 provider。

### REQ-012: Trae 解密异步化
Trae 的 Python bridge MUST 用 `spawn` + Promise，MUST NOT 用 `spawnSync`。

#### Scenario: 解密不在请求路径
- **GIVEN** 用户请求某个 Trae 会话详情，但解密尚未完成
- **THEN** MUST 立即返回已有索引数据 + `pending: true`
- **AND** MUST NOT 在请求处理中触发解密
- **AND** 解密完成后由 SSE `sessions_changed` 通知前端

#### Scenario: 解密结果缓存
- **GIVEN** Trae 的 DB 与 `-wal` 指纹未变化且距上次解密 < 30s
- **THEN** 直接返回缓存结果，MUST NOT spawn Python 进程

> 依据：CPU profile 中 4 次 `spawnSync` 合计 6,074ms，占 37.5% CPU。

### REQ-013: 启动流程
`initialScanAndStore(opts)` SHALL 分两阶段：
1. **索引阶段（同步，必须快）** — 仅目录遍历 + 轻量元数据，upsert 索引，emit `scan_completed`。
   MUST NOT 读详情、解密、spawn 子进程。耗时 < 3s @ 1,514 文件。
   SQLite 类（opencode / codearts / codeagent2）MUST 按 db 内 session 行展开为 N 条，
   轻量 SQL 只取 id / title / 时间戳（不读 message/part 正文），单库 < 50ms；
   无法读取的 .db（损坏 / 非本 provider 格式）在索引阶段跳过该文件，
   不阻塞整体启动（详情阶段由 provider 级错误记录暴露）。Trae 因 SQLCipher
   需解密才能读行，索引粒度保持「1 文件 = 1 条目」（REQ-013 禁止索引阶段解密）。
2. **预热阶段（可选，默认关闭）** — `opts.prewarmRecent` 默认 `0`。非 0 时 `void backgroundPrewarm(...)`，MUST NOT `await`。

#### Scenario: 默认不预热
- **GIVEN** 未指定 `--prewarm-recent`
- **WHEN** 服务启动
- **THEN** 启动后 10s / 60s / 180s 三个时间点首屏均 < 100ms

> 依据：A/B 实验中关闭预热组为 20 / 19 / 10ms，开启组为 5,884 / 3,896 / 12,399ms，比值 200–1240 倍。
> 按需读取实测中位 1.57ms、P95 12.94ms，预热的收益远小于其代价。

### REQ-014: 预热让路
`backgroundPrewarm()` MUST 在每个会话前检查 `isForegroundBusy()`（750ms 内有前台请求），为真时 `await sleep(250)` 循环等待。每个会话之间 MUST `await setTimeout(0)` 让出整轮事件循环。

### REQ-015: 惰性详情加载
`GET /api/sessions/:key` 在 `sessions.detail_loaded = 0` 时 SHALL 触发一次同步 `scanAndStoreDetail`，成功后置 `detail_loaded = 1` 并写入 LRU 缓存。

### REQ-020: 启动自愈清理（T-02）
启动自检 MUST 调用 `cleanupDuplicateSessionRows()`（仅 `data_source = 'scan'`），
三类残留逐条删除并连同其 events / event_raw / metrics / scan_state 行：

1. 旧版 key 不一致残留：`detail_loaded = 0` 且同 `source_path`、同 provider 存在
   `detail_loaded = 1` 兄弟行的**孤儿行**；
2. JSONL 类：`id ≠ deriveSessionKey(provider, source_path)` 的行
   （旧 adapter-id 派生的不可达残留；源文件仍在时由索引阶段重建）；
3. 可读 SQLite 类（opencode / codearts / codeagent2）：
   `id == deriveSessionKey(provider, source_path)` 的**文件级伪会话**
   （T-03 后索引按 session 行展开，不再产生该 key）。

正常未打开的会话（key 规范且无 loaded 兄弟行）MUST NOT 被清理。

### REQ-016: LRU 详情缓存
`detail-cache.ts` SHALL 提供上限 24 条的 LRU，命中即提升。`sessions_changed` 事件 MUST 使对应 key 的缓存失效。

### REQ-017: 文件监视器
`file-watcher.ts` SHALL 对 `watchStrategy = chokidar` 的 provider 用 chokidar（300ms debounce、`awaitWriteFinish` 500ms 稳定阈值 / 100ms 轮询、忽略 dotfiles）；对 `watchStrategy = poll` 的 provider 用 30 秒轮询。

### REQ-018: 变更事件合并
监视器与调度器 MUST 通过 `queueSessionChange(key)` 上报变更，由合并器按 200ms 窗口发出 `sessions_changed`。MUST NOT 逐 session 发射事件。

### REQ-019: vite-plugin（dev 模式）
`local-sessions/vite-plugin.ts` SHALL 在 dev 模式提供与生产 `server.ts` 相同的 API 路由，**额外**提供 CDP 捕获路由与 CA 证书管理路由。

## Gotchas
- G2.2：路径展开三种语法
- G5.2：db 类 provider 必须轮询；**指纹必须覆盖 `-wal`**
- G6.1：Trae SQLCipher 需 python 提取 key，scanner 要先检查 key 存在，缺失时返回 `TRAE_KEY_MISSING`
- G10.1：启动预热必须非阻塞 —— v5 进一步改为**默认不预热**
- G10.2：CDP 路由只在 dev 模式
- G11.5（新）：`scan_state` 写入失败必须抛错。v4 静默失败导致该表为空，增量扫描形同虚设，且没有任何报警
- G11.6（新）：`spawnSync` 在单线程 Node 里是绝对禁区，一次调用就能吃掉 1.5–2.3 秒事件循环
