# Gotchas & Avoidance Guide（复刻避坑核心）

> 本文档汇总本项目开发过程中踩过的所有坑，按类别组织。复刻时**每做一个模块先读对应章节**。
> 这些坑大多无法从代码直接看出，是真实调试经验的沉淀。
>
> **第 11 章是性能类踩坑，全部有实测数字支撑。**
> 它们是参考实现首屏 5.9–12.4 秒的直接成因，优先级等同于第 4 章的 token 计算类。
> 本项目为 0-1 构建，这些坑**从第一行代码就要绕开**，不是等到出问题再修。

---

## 1. 环境与构建

### G1.1 better-sqlite3 Windows 需要 MSVC 工具链
- **现象**：`npm install` 时 better-sqlite3 编译失败
- **原因**：原生模块，prebuilt binary 不一定匹配 Node 版本
- **对策**：装 Visual Studio Build Tools（C++ 工作负载），或锁定 Node 版本用 prebuilt
- **复刻**：README 里明确写 Node ≥ 20 + Windows 需 MSVC

### G1.2 构建必须三阶段，顺序不能错
- `tsc -b` 必须在 `vite build` 前，否则类型错误带进 bundle
- `vite build --config vite.cli.config.ts` 是**服务端 bundle**，不能省，否则 `bin/agent-observe.js` 无 `server-dist/cli.js` 可加载
- server-dist 的外部依赖（better-sqlite3 等）**不打包**，运行时从 node_modules 解析

### G1.3 Node ≥ 20 硬性要求
- 用了原生 fetch、structuredClone、subtle crypto 等 20+ API

---

## 2. 平台与路径

### G2.1 Windows 中文路径不用 .bat，用 .ps1
- **现象**：.bat 脚本在中文路径下乱码 / 失败
- **对策**：启动脚本用 PowerShell（.ps1），编码 UTF-8
- **复刻**：pack-binary.mjs 生成 .cmd/.sh 启动器时注意编码

### G2.2 路径展开必须支持三种语法
- `~` → home（Unix 风格）
- `~\` → home（Windows 风格，反斜杠）
- `%VAR%` → 环境变量（Windows 风格）
- `expandLocalSessionPath()` 必须三者都处理，否则 Windows 用户配置失效

### G2.3 config 三层覆盖顺序
- 内置默认 → `config/local-sessions.local.json`（项目级，gitignored）→ 用户配置（`%APPDATA%/agent-observe/agent-observe.json` 或 `~/.config/agent-observe/agent-observe.json`）
- 后者覆盖前者，**用户配置优先级最高**
- 写入用户配置要原子写（tmp + rename），避免半写状态

---

## 3. 网络与代理

### G3.1 dev URL 必须用 127.0.0.1，不能用 localhost ⚠️ 关键
- **现象**：华为企业网络下，浏览器访问 `localhost:5173` 走代理失败
- **原因**：华为代理 ProxyOverride 含 `127.0.0.1*` 但**不含 localhost**
- **对策**：所有 dev/文档 URL 一律用 `127.0.0.1`
- **复刻**：cli.ts 默认 host 是 `127.0.0.1`，README 示例也用 127.0.0.1

### G3.2 MITM 需要用户信任 CA 证书
- CA 首次运行生成（OpenSSL 优先，node-forge 兜底）
- 用户必须把 `proxy-ca-cert.pem` 导入系统/浏览器信任区
- 提供 `GET /api/ca-cert` 下载端点

### G3.3 OpenSSL 依赖
- CA 生成 shell out 到 `openssl` CLI。Windows 不一定有
- 代码"建议装 node-forge"但**实际没用 node-forge 兜底**（已知缺口，复刻时可补全）

---

## 4. 数据与 Token 计算（最容易踩坑）

### G4.1 Kernel-Inference duration 含 Tool 时间 ⚠️
- **现象**：某些 provider（CodeArts）的 Kernel-Inference duration 不是纯 LLM 时间，包含了 Tool 执行
- **对策**：纯 LLM 推理时长必须用 `InferHub.inference_duration`，不能用 Kernel-Inference
- **复刻**：speed-metrics 计算时明确区分

### G4.2 Trae token_usage 需要 /2 校准 ⚠️
- **现象**：Trae 面板显示的 token 和 DB 里 `server_history_info.token_usage` 对不上
- **原因**：`token_usage` 是双向累计，需除以 2
- **对策**：`token_usage / 2` 校准

### G4.3 Trae 非 LLM 行的 token_usage 是 message size，不重复计数
- **现象**：非 LLM 行也有 `token_usage`（纯数字），容易误加
- **原因**：这些是 message size，已计入 LLM input context
- **对策**：只有 `content_source === 'llm_default'` 的行才计入 outputTokens，其他跳过

### G4.4 CodeArts/OpenCode cache.read 是累积值，用 max 不用 sum ⚠️
- **现象**：直接 sum cache.read 会重复计数，token 虚高
- **原因**：`cache.read` 是 session 级运行总计
- **对策**：`totalCacheReadTokens = Math.max(...all events)`，不是 sum
- **对比**：reasoning tokens 是增量，用 sum

### G4.5 CodeArts/OpenCode total = input + output + reasoning + cache.read
- 累积 cache.read 计入 total
- 不要漏 reasoning

### G4.6 总 duration 用 wall-clock，不用 sum of durations
- `totalDurationMs = lastEvent.startedAt - firstEvent.startedAt`
- 不能把每个 event 的 durationMs 相加（有重叠/间隙）

### G4.7 会话 key 用 SHA1 哈希前 14 位 + provider 前缀
- `sessionKey(provider, id, sourcePath)` = `provider-` + SHA1(`provider:id:sourcePath`).slice(0,14)
- 必须包含 sourcePath，否则同 provider 同 id 不同文件会撞 key

### G4.8 event ID 去重
- 部分 provider 生成重复 event ID
- `upsertEvents()` 对同 session 内重复 ID 追加 `:sequence` 后缀
- 这是防御性措施，复刻时必须保留

---

## 5. SQLite 与文件监视

### G5.1 WAL 模式
- `openWritable()` 必须设 `journal_mode = WAL` + `foreign_keys = ON`
- schema 版本当前 v4，用 `_meta` 表的 `schema_version` 跟踪

### G5.2 SQLite/SQLCipher 文件监视不可靠，改轮询 ⚠️
- **现象**：chokidar 监视 Trae/CodeArts 的 .db 文件不触发变更
- **原因**：WAL 模式下写入走 -wal 文件，主文件 mtime 不变
- **对策**：trae 和 codearts 两个 provider 改为 **30 秒轮询**，不用 chokidar
- **复刻**：file-watcher.ts 里对 db 类 provider 单独走 polling 分支

### G5.3 metrics 维度字段不持久化 —— **v5 已推翻此设计** ⚠️
- **v4 现象**：`getMetrics()` 读回的四维字段都是默认值（0 或 -1）
- **v4 说法**："这是设计选择，不是 bug"
- **实测后果**：不持久化 → Agent Overview 必须逐会话拉详情重算 → **524 次 N+1 / 299.6MB / 4,732ms**
- **v5 对策**：四维指标**持久化**，metrics 表加 `calc_version` 列，算法变更时 bump 触发重算
- **教训**：一个"设计选择"如果让上游被迫做 N+1，它就是 bug。判断标准是它对调用方施加了什么代价，不是它本身合不合理

### G5.4 系统提示词通过时间窗口关联
- `getSystemPromptForSession(startedAt, endedAt)` 找 proxy_requests 表里时间窗口内**最长**的 system_prompt
- scan 会话本身没有 system prompt，靠 MITM 捕获的关联

---

## 6. 加密与解密（Trae 专属，坑最深）

### G6.1 Trae SQLCipher 需 Python 提取 key
- `python scripts/trae-extract-key.py --save`，需 `sqlcipher3` pip 包
- key 存到用户配置目录
- **复刻**：scanner 必须先检查 key 存在，不存在给清晰提示

### G6.2 TTNet 加密
- Trae 请求带 `x-tt-encrypt-*` 头，body 加密
- `request-context.ts` 检测这些头设 `ttnetEncrypted` 标志
- MITM **无法**解密 TTNet body（加密在应用层之前）

### G6.3 Frida Rust heap 碎片化 ⚠️
- **现象**：Frida 一次性堆扫描抓不全 prompt（Rust 对象分散）
- **对策**：用 monitor 模式（持续监听）比一次性 scan 更可靠
- **复刻**：frida-capture 用 monitor 脚本，不是 scan 脚本

### G6.4 Electron / UTF-16LE 特殊处理
- Frida 抓 Electron 应用字符串要处理 UTF-16LE 编码
- 直接按 UTF-8 decode 会乱码

### G6.5 CDP 对 Trae 无效
- **现象**：CDP 连 Trae CN 的远程调试端口抓不到请求
- **原因**：Trae 用 TTNet 自定义网络栈，不走 Chromium Network domain
- **对策**：Trae 只能用 Frida 或 MITM，CDP 无效
- **复刻**：CDP 仅对标准 Electron 应用有效

---

## 7. UI 与交互

### G7.1 详情面板放右侧，不是底部
- 用户偏好：详情面板在右侧，支持拖拽调宽 + 滚动
- 不要放底部

### G7.2 字体大小调整 A-/A+/R
- 长文本区域（仪表盘/报告）字体默认太小
- 必须支持 A-（缩小）/ A+（放大）/ R（重置），范围 8-28px

### G7.3 列表紧凑单行，分组默认折叠
- 不用多行卡片
- 分组默认折叠，展开看详情

### G7.4 scan/proxy 分开展示
- scan 会话和 proxy 捕获是两个独立视图，不要混在一起

### G7.5 性能：useDeferredValue + startTransition
- phase/kind 过滤用 `useDeferredValue`
- 视图切换用 `startTransition`
- Agent overview 加载所有会话详情，要懒加载

### G7.6 HTML JSON 嵌入用外部 JS 文件 ⚠️
- **现象**：报告 HTML 里用 `<script>var data = {...}</script>` 大 JSON 会解析失败
- **原因**：JSON 里的 `</script>`、特殊字符破坏 HTML 解析
- **对策**：大 JSON 用**外部 .js 文件**（最可靠）> `var` 赋值 > `<script type="application/json">`
- **复刻**：report.ts / compare-report.ts 生成报告时务必外部文件

---

## 8. 数据安全

### G8.1 不上传 captured-prompts/ 等到 git
- captured-prompts/、captures/、compare/、*.log 等含敏感数据，必须 gitignore
- 逆向捕获的系统提示词属敏感资产

### G8.2 脱敏 aws_secret_key 默认禁用
- 40 字符 base64 正则误报太多
- 默认 disabled，其余 9 条规则默认 enabled

### G8.3 脱敏后仍保留 raw body
- proxy_requests 表有 `rawRequestBody`/`rawResponseBody` 列存未脱敏原文
- 仅在脱敏开启时填充，便于调试

---

## 9. 适配器复用

### G9.1 CodeArts / CodeAgent 2.0 复用 OpenCode
- opencode.ts scanner + adapter 用 `OpenCodeDialect` 参数区分 provider/agent/label
- codearts.ts / codeagent2.ts 是 thin wrapper
- **复刻**：先实现 opencode 完整，再 2 行 wrapper 出 codearts/codeagent2

### G9.2 CodeAgent 3.0 包装 Claude Code
- codeagent.ts adapter 包装 claude-code.ts
- 差异：drop `file-history-snapshot` 行，relabel actor
- scanner 独立（codeagent.ts in local-sessions/）

### G9.3 OpenCode subagent 检测
- 标题匹配 `/\(@.*\bsubagent\)/i` 判定子 agent 会话
- 影响 token 累计方式

---

## 10. 其他

### G10.1 启动时预热要非阻塞 —— **v5 进一步改为默认不预热** ⚠️
- **v4 对策**：先建索引，再后台 `setImmediate` 逐个预热详情
- **为什么不够**：`setImmediate` 只保证不卡死单次 tick，不保证不抢 CPU。而 `scanAndStoreDetail` 内部是同步的 `readFileSync` + `spawnSync` + DB 写入，单个会话就要 182ms 起
- **实测**：A/B 对照 10s/60s/180s → 开启预热 5,884 / 3,896 / 12,399ms，关闭 20 / 19 / 10ms，**比值 200–1240 倍**
- **v5 对策**：`--prewarm-recent` 默认 **0**，纯按需 + LRU。按需读取实测中位 1.57ms、P95 12.94ms，预热省下的时间远抵不过它造成的劣化
- **教训**："优化"如果没有对照实验，很可能是在制造问题

### G10.2 CDP 路由只在 dev 模式
- `cdp-capture.ts` 只在 `vite-plugin.ts` 接线，生产 `server.ts` 没暴露 CDP 路由
- **复刻**：要么补全到生产，要么明确文档标注 dev-only

### G10.3 会话合并两种模式
- CodeArts SDD：主会话 + 3 个子 agent 会话（spec-requirement/design/task-agent）
- Trae 空壳：0-event 会话 + 真实会话
- 都靠 `config/session-groups.json`（gitignored）手动配置驱动

### G10.4 phase 分类是两遍算法
- Pass 1：explicit（action 直接映射）/ meta（system/step）/ propagate（message/reasoning）
- Pass 2：propagate/meta 继承最近 explicit 的 phase
- bash 命令按正则分 verify/report/understand/implement
- 错误后跟 file_write → debug
- **复刻**：phase-classifier.ts 逻辑复杂但关键，必须完整移植

### G10.5 user_prompt 过滤系统注入
- `isGenuineUserPrompt()` 过滤掉 `<system-reminder>` 等系统注入
- `cleanPromptText()` 清理标签
- 不要把系统注入当用户输入


---

## 11. 性能（v5 新增，全部有实测支撑）

> 数据来源：`PERF-DIAGNOSIS.md`（524 会话 / 73,588 event / 源文件 800.21MB）。
> 每条都是 v4 复刻出的系统实际踩到的坑，不是理论风险。

### G11.1 slim 档一旦泄漏正文字段，体积回弹 20 倍 ⚠️
- **现象**：详情接口返回 32,332KB，服务端 625ms
- **原因**：`events` 表的 `raw`（147.82MB / 64.2%）+ `input_summary`（37.33MB）+ `output_summary`（44.95MB）合计占 DB 的 96%，而详情查询用 `SELECT *` 全带上
- **对策**：三档切分（slim / full / raw），默认 slim；Gantt 树本来就只需要 phase、kind、duration
- **验收**：契约测试断言 slim 响应对象不含这三个键

### G11.2 `events.raw` 必须独立成表
- 留在主表时，任何 `SELECT *` 都会拖上 147MB；且行宽导致 page 数暴涨，连纯元数据查询也变慢
- 拆表后主 DB 从 320MB 降到约 172MB

### G11.3 `ORDER BY LENGTH(col)` 无法走索引
- v4 的 `getSystemPromptForSession` 用它找"最长的 system prompt"，必然临时排序
- 对策：加冗余列 `system_prompt_len` 并建复合索引 `(started_at, system_prompt_len DESC)`
- 注：该查询在 1,820 行的 proxy_requests 上实测仅 0.79ms，**当前规模下不是瓶颈**。列入是因为长期开启采集后它会变成瓶颈，属于预防性修复

### G11.4 单列索引不能替代复合索引 ⚠️
- **现象**：4 条热查询的 `EXPLAIN QUERY PLAN` 全部出现 `USE TEMP B-TREE FOR ORDER BY`
- **原因**：v4 建了 `idx_events_session_id` 和 `idx_sessions_data_source`，但查询是「按 A 过滤 + 按 B 排序」，需要 `(A, B)` 复合索引
- **实测**：最差会话 events 排序 210.48ms
- **对策**：`(session_id, sequence)` 与 `(data_source, started_at DESC)`；原单列索引可删（被复合索引前缀覆盖）
- **自检**：任何 `WHERE x = ? ORDER BY y` 都应该有 `(x, y)` 索引

### G11.5 `scan_state` 写入静默失败，增量扫描形同虚设 ⚠️⚠️
- **现象**：`scan_state` 表实测 **0 行**，表在、索引在，就是没数据
- **后果**：每轮扫描重处理全部 1,514 文件 / 800.21MB；一次完整预热执行 18,235 条 SQL
- **为什么没被发现**：写入路径的异常被静默 catch，功能上"一切正常"，只是每次都在重做
- **对策**：写入失败 MUST 抛错；加 CI 断言 `SELECT COUNT(*) FROM scan_state > 0`
- **教训**：缓存与增量机制必须有"它确实生效了"的正向断言，否则失效时完全无声

### G11.6 `spawnSync` 是单线程 Node 的绝对禁区 ⚠️
- **实测**：4 次 `spawnSync`（Trae SQLCipher 解密）合计 6,074ms，占 CPU profile 的 37.5%；单次 834–2,251ms
- **期间**：所有 HTTP 请求排队，用户观感是"整个应用卡死"
- **对策**：改 `spawn` + Promise；且解密只在后台轮询做，不在请求路径上
- **同类**：`execFileSync`、`readFileSync` 大文件、同步 `JSON.parse` 超大字符串

### G11.7 SSE 事件的心智模型 ⚠️
- **v4 做法**：`scanAndStore` 对每个 session 发一条 `session_updated`，前端每收到一条就 `reloadSessionIndex()`
- **实测后果**：浏览器 30s 窗口内 508 请求 / 151.2MB
- **正确模型**：事件说的是「哪些 key 变了」，不是「有变化了快去重新拉」。前者复杂度 O(变更数)，后者 O(总数 × 变更数)
- **对策**：服务端 200ms 窗口合并成 `sessions_changed { keys }`；前端只失效对应缓存 + 一次批量补丁请求

### G11.8 合并窗口的定时器必须 `unref()`
- 否则 CLI 进程挂住不退出，`npm test` 也会超时

### G11.9 前端遍历会话逐个 fetch 是设计错误 ⚠️
- **v4 现象**：Agent Overview 用 `setTimeout(…, 0)` 循环拉 524 个会话详情
- **实测**：4,732ms / 524 请求 / 299.6MB
- **对策**：新增服务端聚合端点，两条 `GROUP BY` SQL 出全部数据，1 个请求 < 80KB
- **自检**：代码里出现 `sessions.map(s => fetch(...))` 一律视为红线

### G11.10 adapter 必须把 raw 与正文分离返回
- 混在一起时 storage 层无法实现三档切分，G11.1 就无解

### G11.11 指标持久化后必须有版本失效机制
- 四维指标改为持久化后，算法改动若不 bump `METRICS_CALC_VERSION`，库里会留着旧口径的脏数据且无人察觉

### G11.12 `proxy_requests` 是增速最快的表
- 长期开启 MITM 采集时增速比 sessions 快一到两个数量级
- 必须有保留策略（默认 30 天），否则会成为下一个 320MB

### G11.13 脱敏正则在请求同步路径上
- 回溯爆炸会直接卡住代理转发。所有规则必须避免嵌套量词
- 单次调用预算 < 5ms @ 100KB，超时跳过并记录

### G11.14 合并组的 SSE 通知要发 primaryKey
- 发组成会话自己的 key，前端会去失效一个它列表里根本不存在的条目

### G11.15 WAL 型数据源的变更指纹必须覆盖 `-wal` 文件 ⚠️
- 这是 G5.2 那条坑的**正解**。WAL 模式下写入走 `-wal`，主 DB 的 mtime 不变
- v4 只看主文件，所以既检测不到变更（被迫改 30s 轮询），轮询时又无法判断"其实没变"（每轮都白解密一次）
- 对策：指纹 = hash(主DB) + ':' + hash(-wal)

### G11.16 解密永远不要出现在 HTTP 请求处理路径上
- 未就绪就返回 `pending: true`，后台补齐后由 SSE 通知前端重取
- 前端不要轮询等待

### G11.17 `--prewarm-recent` 的默认值必须是 0
- 任何"看起来合理"的非 0 默认值都会重现 v4 的 200–1240 倍劣化

### G11.18 用正则 split 整个文件解析 JSONL
- CPU profile 中 `RegExp: \r?\n` self time 459.8ms
- 对策：`createReadStream` + `readline` 流式逐行；配合 byte-offset 可只读增量部分

### G11.19 性能问题的定位顺序
- v4 的经验：**先做 A/B 对照实验，再看 profile，最后才看 SQL**
- 本项目 SQL 执行只占 CPU 的 4.2%，如果一上来就去优化 SQL，会在错误的地方花掉全部时间
- A/B 实验（关掉某个可疑组件对比）是信息量最大、成本最低的手段
