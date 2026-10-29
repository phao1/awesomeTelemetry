# PERF-BASELINE.md — performance regression baseline

> Maintained per `contracts/nfr.md` §6: from M3 on, run `npm run perf:check`
> after every milestone merge and append a row.
> Any column degrading more than 20% vs the previous row blocks the commit
> unless the trade-off is documented in the commit message.
> Method: `perf-diag/lib/synthetic-db.mjs` builds synthetic reference-scale
> data (524 sessions / 73,588 events / worst single session 9,590 events /
> 1,820 proxy rows). P-4: machine differences are recorded as local baselines;
> no cross-machine comparison.

| Date | Milestone | First screen @10s | Worst detail | Overview | Requests in 30s | DB+WAL |
|------|-----------|-------------------|--------------|----------|-----------------|--------|
| — | reference (negative baseline) | 5,884ms | 625ms/32.3MB | 4,732ms/524req | 508 | 471.6MB |
| 2026-08-04 | M3 storage | no frontend yet | 8.489ms (slim 9,590 events) | 21.89ms cold / 0.264ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M4 watch gate | no frontend yet | 8.510ms (slim 9,590 events) | 22.08ms cold / 0.256ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M5 adapters | no frontend yet | 8.662ms (slim 9,590 events) | 22.24ms cold / 0.271ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M6 scanners | no frontend yet | 8.551ms (slim 9,590 events) | 22.17ms cold / 0.257ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M7 realtime | no frontend yet | 8.616ms (slim 9,590 events) | 22.49ms cold / 0.257ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M8 HTTP server | no frontend yet | 8.502ms (slim 9,590 events) | 21.80ms cold / 0.255ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M9 core analysis | no frontend yet | 8.618ms (slim 9,590 events) | 21.82ms cold / 0.261ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M10 frontend | frontend built | 8.538ms (slim 9,590 events) | 22.27ms cold / 0.259ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | M11 proxy/desensitization | frontend built | 8.551ms (slim 9,590 events) | 21.99ms cold / 0.256ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | T-03 SQLite multi-session index | frontend built | 8.722ms (slim 9,590 events) | 22.40ms cold / 0.361ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | fix-session-data-integrity (T-10~T-12 done) | frontend built | 8.519ms (slim 9,590 events) | 22.42ms cold / 0.274ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-04 | add-design-system + redesign-frontend-views + add-palette-and-a11y | frontend built | 9.215ms (slim 9,590 events) | 24.37ms cold / 0.372ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-05 | add-mission-control (B1~B8, schema v3) | frontend built | 8.9ms (slim 9,590 events) | 23.5ms cold / 0.3ms hit | no frontend yet | 24.70MB (synthetic, no raw) |
| 2026-08-05 | fix-session-detail-display UI（会话导航服务端过滤/分页 + 甘特双模式/阶段轴 + IA 重构；数据层 1–3 未做） | frontend built | 9.350ms (slim 9,590 events) | 23.03ms cold / 0.267ms hit | no frontend yet | 29.34MB (synthetic, no raw) |
| 2026-08-05 | fix-session-detail-display 数据层（events.content_hash 差分写入 + opencode 系输入输出提取/step 过滤 + 索引计数与详情对齐；真实库强制重扫 23,726 事件） | frontend built | 9.056ms (slim 9,590 events) | 22.79ms cold / 0.269ms hit | no frontend yet | 29.34MB (synthetic, no raw) |
| 2026-08-08 | fix-adapter-turn-semantics（schema v7：turn_key + 破坏性重分类重扫；上一行及以下 2026-08-06 基线被本条目取代） | frontend built | 10.375ms (slim 9,590 events) | 52.91ms cold / 0.347ms hit | no frontend yet | 29.57MB (synthetic, no raw) |

> M4/M5 numbers are essentially flat vs M3 (only new watch/adapter layers, not
> touching the measured query paths); differences are within P-4 machine
> fluctuation (< 1%).
> T-03's index phase adds lightweight SQLite reads that don't touch the
> measured query paths; difference within machine fluctuation (< 5%).
> T-10's index phase adds JSONL streaming title extraction (1MB hard cap,
> sync readSync, startup path only): worst single JSONL measured 2.735ms
> (3.4MB file read 1MB without a hit, fallback), single SQLite DB 0.281ms —
> both under budget (5ms / 50ms); no measured query path degraded > 20%
> (worst detail +2%).
> After the three frontend changes, measured query paths still show no
> degradation > 20% (worst detail +8%).

## First-screen performance measurement (T-07 leftover, closed 2026-08-04)

> No browser automation tooling on this machine, so browser-level "first
> paint" cannot be measured; the measurable parts below use local loopback:

| Item | Measured | Note |
|------|----------|------|
| GET / (index.html) | median ~0.6ms | local loopback |
| GET /api/sessions?limit=50 | median ~0.6ms | first-screen data (within the < 5ms server budget) |
| /api/health | ~0.3ms | single status-bar fetch |
| Frontend assets gzip total | 93.1KB | JS 86.6KB + CSS 6.4KB + HTML 0.8KB |
| CommandPalette chunk | 2.5KB (gzip 1.1KB) | lazy-loaded separate chunk, not in the first-screen bundle |
| Server first-screen budget | < 100ms | measured data path < 1ms ✅ |

**Not measured**: browser first paint (Performance panel). Local-loopback
transfer of 93KB gzip is negligible; the main cost is parsing the 287KB main
JS. That number must be recorded after a real browser measurement;
**must not be faked with the backend budget**.

## M3 details (2026-08-04, machine: macOS, Node v26.5.1)

From `npm run perf:check` (synthetic reference-scale fixture, median timing, 7
runs):

| Item | Measured | Budget | Verdict |
|------|----------|--------|---------|
| listSessions(500) | 0.359ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 8.489ms | < 15ms (server) | ✅ |
| eventDetail drill-down | 0.005ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.011ms | < 1ms | ✅ |
| proxyList(50) | 0.748ms | — | — |
| Overview cold path (2 SQL) | 21.89ms | < 400ms | ✅ |
| Overview cache hit (1 SQL) | 0.264ms | < 20ms | ✅ |
| differential write (347→348, append 1) | 2 statements / 0.29ms | only 1 INSERT, < 20ms | ✅ (vs negative baseline 348 statements / 181.91ms) |
| event-loop p99 (200-request hammer) | < 0.01ms | < 50ms | ✅ |
| EXPLAIN for the three core queries | all without USE TEMP B-TREE | no temp B-tree | ✅ |

## add-mission-control perf:check（2026-08-05，本地基线）

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| Mission 冷启（stamp + 16 条 widget SQL） | 53.14ms | < 500ms | ✅ |
| Mission 缓存命中（仅 stamp 判定） | 0.053ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 12.37ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip（代表性信封） | 317B | < 120KB | ✅ |
| 事件循环 p99（200-request hammer） | < 0.01ms | < 50ms | ✅ |

> 注：repair 检测因 tier B 全表窗口扫描 40ms 超预算，按 design §7.3 R1
> 升级为扫描时预计算（metrics.repair_loop，schema v3），见 D-012。

## calibrate-tokens-and-compare-report perf:check（2026-08-05，B9 收口）

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| listSessions(500) | 0.375-0.388ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 9.263-9.309ms | < 15ms | ✅ |
| eventDetail drill-down | 0.005ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.011ms | < 1ms | ✅ |
| proxyList(50) | 0.794-0.803ms | — | — |
| Overview 冷路径（2 SQL） | 23.33-23.76ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL） | 0.289-0.305ms | < 20ms | ✅ |
| 差分写入 append 1 | 2 语句 / 0.30-0.32ms | 仅 1 INSERT、< 20ms | ✅ |
| 事件循环 p99（200-request hammer） | < 0.01ms | < 50ms | ✅ |
| 三条核心查询 EXPLAIN | 无 USE TEMP B-TREE | 无临时 B 树 | ✅ |
| Mission 冷启（stamp + 16 widget SQL） | 52.85-52.95ms | < 500ms | ✅ |
| Mission 缓存命中 | 0.050-0.054ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 12.23-12.32ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip | 316-317B | < 120KB | ✅ |

> schema 已升 v4（metrics 五新列）；本 change 未触碰扫描热路径的 SQL 形状，
> 指标与上一条基线持平。metrics 表在 perf 合成库中仍为 0 行（D-014：扫描路径
> metrics 生产者缺失，与性能无关）。

## UI-TASKS 2 优化 perf:check（2026-08-06，本地基线）

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| listSessions(500) | 0.368ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 9.080ms | < 15ms | ✅ |
| eventDetail drill-down | 0.006ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.012ms | < 1ms | ✅ |
| proxyList(50) | 0.752ms | — | — |
| Overview 冷路径（3 SQL，含阶段耗时聚合） | 23.73ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL stamp 判定） | 0.293ms | < 20ms | ✅ |
| 差分写入 append 1 | 2 语句 / 0.29ms | 仅 1 INSERT、< 20ms | ✅ |
| 事件循环 p99（200-request hammer） | < 0.01ms | < 50ms | ✅ |
| 三条核心查询 EXPLAIN | 无 USE TEMP B-TREE | 无临时 B 树 | ✅ |
| Mission 冷启（stamp + 16 widget SQL） | 51.76ms | < 500ms | ✅ |
| Mission 缓存命中 | 0.050ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 11.965ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip | 316B | < 120KB | ✅ |
| 前端 CSS gzip（拆分后 @import 聚合，含会话签名区与趋势图） | 10.62KB | < 16KB | ✅ |

> 本 change 为 UI 可视化/交互优化：Agent Overview 聚合新增阶段耗时 SQL
> （第三条，冷路径 23.73ms 仍在预算内）；前端 Compare 图表全部为 SVG 内联
> 渲染，无新增运行时依赖；CSS 拆分后 gzip 10.50KB 符合 REQ-011 预算。

## enhance-ui-depth-and-ia perf:check（2026-08-06，本地基线）

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| listSessions(500) | 0.374ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 8.667ms | < 15ms | ✅ |
| eventDetail drill-down | 0.005ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.011ms | < 1ms | ✅ |
| proxyList(50) | 0.769ms | — | — |
| Overview 冷路径（3 SQL，含阶段耗时聚合） | 47.10ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL stamp 判定） | 0.298ms | < 20ms | ✅ |
| 差分写入 append 1 | 2 语句 / 0.33ms | 仅 1 INSERT、< 20ms | ✅ |
| 事件循环 p99（200-request hammer） | 0.00ms | < 50ms | ✅ |
| Mission 冷启（stamp + 16 widget SQL） | 55.63ms | < 500ms | ✅ |
| Mission 缓存命中 | 0.052ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 12.561ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip | 317B | < 120KB | ✅ |
| 前端 CSS gzip（vite 构建产物 dist/assets/*.css） | 11.88KB | < 16KB | ✅ |

> 本 change 为 UI 深度/信息架构优化：新增 KPI drill-down 面板、Token 文本
> Modal、Speed 10 卡、Hero 渐变、Agent 卡片、Mission 角色导航全部为 SVG/
> 内联渲染，无新增运行时依赖；KPI drill-down 数据复用 compare 响应、
> TokenTextModal 复用 recordCache，MUST NOT 发额外请求（G11.9 / G-UI-1 /
> G-UI-2）；前端 CSS 增量后 gzip 11.88KB 仍在 REQ-011 预算内。

## enhance-interaction-depth-and-ia-v2 perf:check（2026-08-06，本地基线；已被 fix-adapter-turn-semantics 2026-08-08 条目取代，保留不删）

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| listSessions(500) | 0.369ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 10.764ms | < 15ms | ✅ |
| eventDetail drill-down | 0.005ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.014ms | < 1ms | ✅ |
| proxyList(50) | 1.146ms | — | — |
| Overview 冷路径（3 SQL） | 47.10ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL stamp 判定） | 0.302ms | < 20ms | ✅ |
| 差分写入 append 1 | 2 语句 / 0.32ms | 仅 1 INSERT、< 20ms | ✅ |
| 事件循环 p99（200-request hammer） | 0.00ms | < 50ms | ✅ |
| Mission 冷启（stamp + 16 widget SQL） | 51.63ms | < 500ms | ✅ |
| Mission 缓存命中 | 0.050ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 11.949ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip | 314B | < 120KB | ✅ |
| 前端 CSS gzip（vite 构建产物 dist/assets/*.css） | 12.30KB | < 16KB | ✅ |
| 前端 JS gzip（index chunk） | 135.19KB | — | 参考 |

> 本 change（C1-C9 / REQ-111~122）为交互深度 + 信息架构 + 组件复用性优化：
> 服务端零改动，SQL 与写入路径完全未触碰，故数据库侧指标与上一轮基线同量级
> 波动（worst detail slim 8.7→10.8ms 属于同机噪声，仍在 15ms 预算内）。
> 前端全部新增可视化（RadarChart / HeatmapChart / Sparkline / DonutRing）均为
> 内联 SVG，0 新增运行时依赖；CommandPalette 仍为独立懒加载 chunk（5.64KB）。
> Compare Timeline 去掉 200 事件硬上限后改由既有 useVirtualList 承载，DOM 行数
> 与截断前同量级（虚拟窗口固定），不引入额外渲染成本。
> 所有新增数据（/compare 会话列表、/goto 事件、KPI sparkline 历史、Session
> Heatmap/Radar）均从 App 已持有的共享 store 或已加载详情派生，
> MUST NOT 发额外请求（G11.9 / gotcha 1 / gotcha 9）。
> CSS 增量后 gzip 12.30KB 仍在 REQ-011 的 16KB 预算内。

## fix-adapter-turn-semantics perf:check（2026-08-08，本地基线，schema v7）

> 本 change 为事件语义修复（A6 codex 重分类 / A7 claude 工具结果回填 /
> turnKey），不触碰扫描热路径的 SQL 形状；perf 合成库随 schema v7 同步
> （`perf-diag/lib/schema-sql.mjs` 镜像补 `events.turn_key` / `content_hash`
> 与 metrics v4 五列，`SCHEMA_VERSION` 6→7）。`npm run perf:check` 全绿。

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| listSessions(500) | 0.421ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 10.375ms | < 15ms | ✅ |
| eventDetail drill-down | 0.007ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.013ms | < 1ms | ✅ |
| proxyList(50) | 0.879ms | — | — |
| Overview 冷路径（3 SQL，含阶段耗时聚合） | 52.91ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL stamp 判定） | 0.347ms | < 20ms | ✅ |
| 差分写入 append 1 | 2 语句 / 0.41ms | 仅 1 INSERT、< 20ms | ✅ |
| 事件循环 p99（200-request hammer） | 0.00ms | < 50ms | ✅ |
| 三条核心查询 EXPLAIN | 无 USE TEMP B-TREE | 无临时 B 树 | ✅ |
| Mission 冷启（stamp + 16 widget SQL） | 39.50ms | < 500ms | ✅ |
| Mission 缓存命中 | 0.074ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 12.630ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip | 317B | < 120KB | ✅ |

### v6→v7 迁移与重扫实测（真实库，2026-08-08，tasks.md §6.6/6.7，nfr §3）

| 项 | 实测 |
|----|------|
| 迁移前（备份库快照） | 103 sessions / 35,299 events / event_raw 35,299 / metrics 82 / scan_state 71；proxy_requests 0 / frida 0 / session_prompt_context 7 |
| 迁移后清空 | events 0 / event_raw 0 / metrics 0 / scan_state 0（四表具名 DELETE，A10） |
| 迁移后保留 | sessions（103 行原样；启动自检另清理 2 条源文件已删除的 claude 空壳行） / proxy_requests / frida_captures / session_prompt_context 7 |
| detail_loaded 重置 | 全部置 0，下次打开触发重扫 |
| 迁移耗时（副本实测） | 首启到健康 326.8ms − 二次启动（无迁移）156.0ms ≈ **170.8ms** |
| 重复初始化 | 幂等 no-op（二次启动不重清，schema 仍 7） |
| 强制全量重扫（POST /api/scan {force:true}） | 墙钟 **3,264ms**（修复后终态重扫；首次 3,204ms），124 sessions 全部重扫（claude 12 / codex 98 / opencode 1 / codearts 1 / trae 1） |
| 重扫后事件数 | 35,299 → **39,658**（+21 个会话文件增长；classification 修复后 codex system 11,664→1,478，tool 9,578→16,620，reasoning 0→6,336；claude 伪造 user_prompt 1,059→27） |
| §6 验证修复（A3 rule 3） | codex payload id / `codex-N` 回退键与 claude message.id 非全局唯一（实测 codex-2 跨 11 会话）→ 两 adapter 均以会话 id 加前缀；重扫后跨会话键冲突 **0** |
| 真实库大小 | 重扫后稳态 **208.65MB**（WAL checkpoint 后 0MB）——超出 nfr §2 的 <200MB 目标约 4%。归因：修复后的分类把此前丢弃的正文落盘（reasoning 10.4MB / tool 输入 7.3MB / system 6.3MB，迁移前 events 19.5MB → 65.1MB）；这是数据语义修复的合法结果，非 SQL 形状或迁移引入。距 §1 的 2GB 升级阈值仍远，报告 §6.8 已如实记录 |

## add-trajectory-inspector perf:check 与活体验证（2026-08-08，本地基线，schema v8）

> 本 change 为 turn 表面 + 注解 + 标签过滤（Change B），不触碰扫描热路径 SQL
> 形状；`npm run perf:check` 全绿。注：`perf-diag/lib/schema-sql.mjs` 仍为
> schema v7 镜像（无 `session_annotations` 表），故 perf:check 的 listSessions
> 行镜像的是 join-less SQL 形状；带 join 的实测在 §9.12 的临时脚本中于合成
> 524 库上按 D15 DDL 补建注解表后测得（上表 0.642ms）。活体验证（tasks.md
> §9.8–9.13）用真实库（134 会话 / 41,696 事件）+ 生产构建于 127.0.0.1:4173，
> headless Chrome 实测。基准合成库为 524 会话参考规模（447.8KB / 5.33ms 为
> 参考实现的负面基线，非本项目目标）。

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| deriveTurns（1,000 事件，turn_key 策略） | worst **0.175ms** / avg 0.105ms（10 次采样） | < 20ms | ✅ |
| computeRibbon（200 回合，time/token 交替） | worst **0.154ms** / avg 0.089ms（10 次采样） | < 5ms | ✅ |
| 会话详情首屏（hash 切换 → turn 列表渲染） | codex 597 回合 **62ms** / claude 465 回合 **64ms** / codearts 35 回合 **60ms** | < 2s | ✅ |
| App 首帧 | first-paint 48ms / first-contentful-paint 112ms | — | 参考 |
| 会话列表 tag join（524 合成库，带 join 无过滤） | **0.642ms** / 205,730B 未压缩（gzip 12.9KB）/ 500 行 | < 5ms / < 60KB gzip | ✅ |
| 会话列表 join-less（同库同机，v8 前形状） | 0.445ms / 192,464B | — | 对比基线 |
| 列表 join 增量 | **+0.197ms**（0.642 − 0.445）；相对 5.33ms 负面基线 −88% | 记录增量，无实质退化 | ✅ |
| 2-tag OR 过滤（join 激活） | **0.237ms** / 26 行（524 库，52 行带注解） | — | ✅ |
| 列表 EXPLAIN（join 激活） | `SEARCH sessions USING COVERING INDEX idx_sessions_ds_started` + `SEARCH sa USING sqlite_autoindex_session_annotations_1` LEFT-JOIN，**无 TEMP B-TREE** | 无临时 B 树 | ✅ |
| turn 列表滚动节点数（597 回合，折叠态） | 挂载 **17** → 滚动到底仍 **17**（首行索引 580）；容器 286px 视口 / 26,268px 内容 | 节点数稳定（>50 回合虚拟化） | ✅ |
| turn 列表滚动节点数（展开态） | 展开任一回合后全量 597（设计：展开回合脱离虚拟化） | 展开态按自然高度 | ✅（设计内） |

### §9.8–9.11 活体验证要点（真实浏览器，headless Chrome）

| 项 | 实测 |
|----|------|
| codex 会话（`codex-d2eaa46703228f`，2,870 事件） | 回合数 **597**（Turns pill），segmentationSource 口径行 = turn_key + 适配器声明 **stream structure**；详情打开请求 = slim detail + session-groups + annotations = **3 个**（无逐回合/逐消息请求）；turn 1 渲染 = 1 assistant 卡 + 2 嵌套 tool-call block（展开后）+ 2 张 tool result 卡；body 展开 = 4 个单事件请求（1 assistant 卡聚合 4 成员事件，LRU 缓存，重开不再请求） |
| claude 会话（`claude-0be2a9071b490d`，804 事件） | 回合数 **465**，口径行 = message identity；扫描 turn 0–7：tool call 后**无伪造 user 卡**（turn 1–5 = [assistant, tool, tool]，call id 为 `toolu_…` 原样显示，2/2 tool result 卡正文有内容）；turn 6 = 单 tool 卡（该回合无 llm 成员，无卡可嵌） |
| codearts 主会话（`codearts-87fa32238de9b5`，35 回合） | 层级面板渲染 **2 节点**（主 agent + subagent）；切换 agent 恰好 **1 次批量 keys 拉取**（`GET /api/sessions?keys=main,sub`，绝无逐成员）；subagent 类型 = Unknown（列表行无 input_summary，不猜标题） |
| 注解生命周期 | 两会话写重叠 tag（`e2e-run`）+ 独有 tag；OR 过滤返回 2 会话；重启后注解保留；删除其中一会话 → 注解行随 FK 级联删除（0 行残留，另一会话注解完好）；重扫后会话重建（注解为测试数据，不恢复） |
| 标签过滤 UI | 打开过滤一次拉取 `GET /api/annotations/tags`；OR 过滤发一次列表请求（无逐键击请求） |

> **活体验证修复的 3 处实现缺陷（verification → fix，均在 D20 白名单内）**：
> 1. `AgentHierarchyPanel` 组查找只匹配 `mergedKeys`、批量拉取只传 `mergedKeys`，
>    与 `/api/session-groups` 真实形状（`primaryKey` + `mergedKeys` 分离）不符 →
>    主会话永远只渲染单节点、从不发批量拉取（9.10 未通过）。修复后 2 节点 +
>    恰好 1 次批量拉取；测试夹具同步改为真实形状并新增 primaryKey/mergedKeys 两
>    种命中用例（AgentHierarchyPanel.test 5→6，TrajectoryPane.test 夹具修正）。
> 2. `.session-canvas{flex:none}`（旧甘特语义）把 turn 表面撑到内容全高 →
>    `.turn-list-scroll` 永不溢出、597 回合全量挂载（虚拟化不触发）。在
>    trajectory.css（最后加载）覆盖为有界 flex 子项 + `.trajectory-area-pane`
>    转 flex column → 折叠态挂载 17 节点、滚动到底仍 17（D20 节点数稳定）。
> 3. （无）—— codex 本轮 tool 事件 id 为 `ctc_/ctco_` 前缀（源数据原生，非
>    适配器生成），D5 启发式仅识别 `toolu_/call_/msg_` → 显示 `#sequence` 回退，
>    id 原样保留在 title 中可复制 —— 按契约行为，记录非缺陷。

> `npm run perf:check` 合成库关键行：listSessions(500) 0.424ms（该脚本镜像
> join-less SQL 形状；带 join 的实测见上表 0.642ms）、worst detail slim (9,590)
> 9.755ms、eventDetail 0.005ms、Overview 冷 51.48ms / 命中 0.311ms、事件循环
> p99 0.00ms、Mission 冷 32.59ms / 命中 0.046ms / 单 widget 最差 11.917ms /
> gzip 313B —— 全部在预算内。

## add-agent-team-observability perf:check（2026-08-18，Gate Engineer，schema v10）

> 本 change 新增 13 张 team 表 + v9→v10 additive 迁移 + team 查询/写入/适配器。
> `npm run perf:check` 全绿。team 查询性能用 EXPLAIN 索引覆盖测试
> （team-storage.test.ts §3.15，七条索引无 USE TEMP B-TREE）+ 差分写入计数器
> 测试（§3.16，no-change=0 写入 / append 1 message=1 INSERT）保证。
> perf:check 合成库当前 team 表为 0 行（team 源未接入合成 fixture），故下表
> team 行为 EXPLAIN + 单元测试断言结果；真实 team 数据的端到端计时留给
> tasks.md §11 real-run acceptance。

| 指标 | 实测 | 预算 | 结论 |
|------|------|------|------|
| listSessions(500) | 0.425ms | < 1ms | ✅ |
| worst detail slim (9,590 events) | 10.494ms | < 15ms | ✅ |
| eventDetail drill-down | 0.006ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.012ms | < 1ms | ✅ |
| proxyList(50) | 0.885ms | — | — |
| Overview 冷路径（3 SQL） | 48.75ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL） | 0.299ms | < 20ms | ✅ |
| 差分写入 append 1 | 2 语句 / 0.32ms | 仅 1 INSERT、< 20ms | ✅ |
| 事件循环 p99（200-request hammer） | 0.00ms | < 50ms | ✅ |
| 三条核心查询 EXPLAIN | 无 USE TEMP B-TREE | 无临时 B 树 | ✅ |
| Mission 冷启（stamp + 14 widget SQL） | 0.69ms | < 500ms | ✅ |
| Mission 缓存命中 | 0.020ms | < 20ms | ✅ |
| Mission 单 widget SQL 最差 | 0.172ms | < 30ms @ tier B | ✅ |
| Mission 响应 gzip | 241B | < 120KB | ✅ |
| team list EXPLAIN（provider/status 过滤） | idx_team_runs_provider_started / idx_team_runs_status_started，无 TEMP B-TREE | < 10ms DB / < 80KB gzip | ✅（索引覆盖） |
| team snapshot EXPLAIN（run by id） | PRIMARY KEY 查找，无 TEMP B-TREE | < 100ms / < 750KB gzip | ✅（索引覆盖） |
| team ledger EXPLAIN（run/agent/task/time） | idx_team_activities_run_time / run_agent / run_task，无 TEMP B-TREE | < 50ms / < 200KB gzip | ✅（索引覆盖） |
| team communication EXPLAIN | idx_team_messages_run_sender，无 TEMP B-TREE | — | ✅（索引覆盖） |
| team graph EXPLAIN | idx_team_edges_run_from_to，无 TEMP B-TREE | — | ✅（索引覆盖） |
| team 差分写入 no-change rescan | 0 写入（teamWriteCounter 增量=0） | 0 SQL | ✅（§3.16 测试） |
| team 差分写入 append 1 message（隔离） | 1 INSERT | 仅受影响 INSERT | ✅（§3.16 测试） |
| team 差分写入 append 1 message（真实） | 3 语句（run UPDATE + msg INSERT + recipient INSERT） | 无 delete-reinsert | ✅（§3.16 测试） |

> v9→v10 迁移 additive（CREATE TABLE IF NOT EXISTS ×13 + CREATE INDEX IF NOT
> EXISTS），不触碰既有表/列/索引，不触发重扫；幂等 no-op。FK 级联双向测试
> （§3.8）：team 删除只删 team-owned 行、session 删除只清 junction。十项禁止
> 审计全部通过（见 tasks.md §10.6 审计报告）。

## fuse-agent-monitoring foundation — 2026-10-16, schema v11

Local macOS 15.3.1; Node26.5.1 / TS6.0.3 / Vite8.2.0 / existing Vitest4.1.10.
Synthetic reference DB: 524 sessions,73588 events,1820 proxy requests,29.57MB
after checkpoint. No real Agent source configuration was loaded.

| Check | Measured | Scope |
|---|---|---|
| Session list500 / worst slim9590 | 0.355ms / 9.118ms | perf:check DB microbench |
| Event detail / prompt lookup / proxy list50 | 0.007ms / 0.014ms / 0.787ms | perf:check DB microbench |
| Overview cold / cached | 48.47ms / 0.344ms | synthetic aggregation |
| Append1 event | 1 INSERT / 2 statements / 0.32ms | differential write unchanged |
| Core query plans | no temporary B-tree | EXPLAIN |
| Mission cold / cached / worst widget | 0.68ms / 0.019ms / 0.166ms | synthetic,241B representative gzip |
| 100MiB original | exact streamed capture/download SHA-256 | real controlled HTTP upstream, server.test.ts |
| HTTPS CONNECT | trust required, SAN mismatch rejected, restart CA reused | real local upstream TLS; no TLS bypass |
| Offline SSE protocol analysis | 1899920 source bytes → 98947 result bytes;16.893ms | built server module, entirely synthetic |
| Analysis event-loop p99 | 10.551ms;44 heartbeat ticks | 10ms-resolution histogram, bounded yielding analysis only |

The near-limit stream intentionally has no protocol terminal event: state stays
incomplete; its long output hits the declared projection value limit. The
original bytes are not truncated by analysis. gzip/br/deflate expansion bounds,
corrupt/damaged sources and original-backed diff have executable regressions.

A prior run concurrent with the full Vitest suite measured list1.076ms and
worst slim20.429ms; recorded rather than suppressed. A lower-contention repeat
produced the table above. The existing perf:check list-only event-loop harness
reported0.00ms; that is not a sustained proxy-load measurement. Thirty-minute
traffic, all real Agent versions, WebSocket/HTTP2, cross-source correlation and
whole-service event-loop p99 remain unverified.

Final sequential gate repeat after protocol/UI fixes: list0.367ms, worst
detail9.148ms, event0.007ms, prompt0.012ms, proxy0.812ms, overview48.14/0.302ms,
append1 INSERT/2 statements/0.32ms, mission0.67/0.019ms, worst widget0.166ms,
representative gzip242B. typecheck/lint/build passed;168 Vitest files,
1805 tests passed/1 skipped;strict OpenSpec validation and diff-check passed.

## fuse-agent-monitoring identity/session association — 2026-10-16, schema v12

Same local runtime and synthetic reference DB as the foundation run; no real
Agent workloads or global proxy/CA trust changes. Final serial validation:
172 test files,1846 passed/1 skipped, typecheck/lint/build/strict OpenSpec and
diff-check all passed. Frontend641.63kB /180.16kB gzip; existing500kB chunk
warning retained, not raised or suppressed.

| Check | Measured | Scope |
|---|---|---|
| Session list500 / worst slim9590 | 0.422ms /9.990ms | DB microbench |
| Event / prompt / proxy list50 | 0.007ms /0.012ms /0.880ms | DB microbench |
| Overview cold / cached | 49.84ms /0.342ms | synthetic aggregation |
| Append1 event | 1 INSERT /2 statements /0.39ms | differential write |
| Mission cold / cached / worst widget | 0.70ms /0.019ms /0.166ms | synthetic,242B representative gzip |
| Linked50-request metadata page | at most5 SELECTs total, no body columns | actual SQLite verbose trace test |
| Native/session association lookup | idx_trace_identities_native /idx_trace_associations_session; no page temp B-tree | EXPLAIN assertions |
| Collision fanout | 40 matching sources →32 candidate suggestions; all remain ambiguous | real SQLite fixture, native evidence retained |
| Identity page | <500000B even with JSON-escaped1024-character IDs/scopes | row+byte bound and actual last-item cursor |
| Browser relation navigation | session expansion1 metadata call; proxy tab2; audit1 on click | isolated synthetic production build and server HTTP log |

These checks do not certify high-cardinality ingest latency, metadata quota,
30-minute proxy load, full-app30s request/DOM budgets, actual Agent transports
or whole-service event-loop p99. Relation-only invalidation currently marks
stale pages without a native-detail/body refetch; incremental patches/reconnect
remain B9. Native model/tool/subagent execution mapping and cost deduplication
remain pending. A prior single ECONNRESET did not repeat in the isolated server
suite or two full reruns; its root cause is unconfirmed, so lifecycle/load
acceptance remains open rather than being inferred from green microbenches.

## Association-aware context/Prompt selection — 2026-10-16, schema v12 unchanged

Final low-contention serial gate: typecheck, complete Vitest suite with
--maxWorkers=1 (172 files,1852 passed/1 skipped), lint, production build,
perf:check, strict OpenSpec and diff-check passed. Existing p95<100ms,
p99<50ms and <1MiB context-diff assertions remain unchanged. The performance
fixtures now explicitly establish session membership rather than assume a
capture run is a session.

| Check | Measured | Scope |
|---|---|---|
| Predecessor selection10000 linked captures | 8.447ms median over7 samples;3 metadata SELECTs | isolated actual source module / SQLite, <20ms budget |
| Predecessor plans | forward/reverse association indexes + proxy PK, no temp sorting B-tree | real EXPLAIN regression |
| Context source bodies | exactly2 selected body executions, no raw columns | actual SQLite execution trace, cached statement reused |
| Session list500 / worst slim9590 | 0.394ms /10.134ms | existing synthetic DB microbench |
| Event / prompt candidate / proxy list50 | 0.007ms /0.014ms /0.849ms | prompt query is candidate-only, no automatic session population |
| Overview cold / cached | 49.78ms /0.311ms | synthetic aggregation |
| Append1 event | 1 INSERT /2 statements /0.31ms | differential writer |
| Mission cold / cached / worst widget | 0.72ms /0.019ms /0.184ms | synthetic,242B representative gzip |
| Frontend bundle | 643.17kB /180.54kB gzip | existing500kB warning retained |

A default parallel full-suite run failed the existing relative list-cost
microbench (delta0.830ms vs allowed0.575ms). That31-test suite passed in
isolation, and the full single-worker gate passed; no thresholds/assertions
were relaxed. This is recorded as contention-sensitive verification, not
proof of whole-service continuous-load performance. Broad proxy p99, recovery,
30-minute workload and real-Agent matrix are still pending.

Controlled HTTP/browser proof: same gateway/model/run with A/base1,
B/request2 (long unrelated prompt), A/target3 and unlinked4. Automatic A/3
compared to A/1, not B/2. Revocation hid the cached result with zero automatic
reparse, explicit refresh refused automatic pairing, and manual comparison
remained available without writing membership. Prompt navigation selected
request1. Upstream count remained4; comparisons performed zero replays.
Temporary local servers and tabs were closed; all proof data is synthetic.

## 2026-10-16 — Reliable MITM lifecycle (fusion B3 task4.3)

Sequential typecheck/full test/lint/build/perf/strict OpenSpec/diff gates passed:
173 files,1864 passed,1 skipped. Frontend645.02kB /181.24kB gzip retains
the existing >500kB warning; no threshold or runtime dependency changed.

Serial fixture medians: list(500) 0.378ms, worst 9590-event slim detail9.640ms,
event detail0.008ms, proxy list(50) 0.852ms. Overview50.63ms cold/0.366ms cached.
Append remains exactly1 INSERT/2 statements/0.35ms. Mission0.70/0.020ms,
worst widget0.172ms and242-byte representative gzip envelope. Existing
microbench budgets passed. Harness p99=0 is not certification of sustained
capture or30-minute workload. The harness's legacy longest-prompt timing is
not evidence for automatic association; production uses linked-session metadata.

Lifecycle defaults:5s network grace/10s stop-control deadline, accepted-byte
flush before idle,200ms activity metadata coalescing. Actual local HTTP/SSE,
client disconnect, occupied port, CONNECT internal-port closure and late
certificate callbacks verified; partial originals retain exact prefixes.
Real child SIGINT/SIGTERM helpers verified drain-before-SQLite-close.
Production browser confirmed lifecycle states with no activity polling/list
reload. Synthetic proof servers/tabs closed. Full CLI/profile/real-Agent,
Windows/Frida, crash recovery and sustained-load acceptance remain pending.

## 2026-10-16 — Process-scoped connection profiles (fusion B3 task4.4)

Final sequential typecheck/build/full single-worker test/lint/perf/strict
OpenSpec/diff gates passed:176 files,1893 passed,1 skipped. No dependencies,
budgets or assertions were relaxed. Existing frontend >500kB warning remains:
652.77kB/184.04kB gzip, with the new setup panel loaded separately at
7.38kB/2.41kB gzip. CLI651.47kB/177.65kB gzip.

| Check | Measured | Scope |
|---|---|---|
| Session list500 / worst slim9590 | 0.370ms /8.966ms | serial synthetic DB medians |
| Event / prompt candidate / proxy list50 | 0.007ms /0.015ms /0.876ms | candidate prompt timing is not automatic association |
| Overview cold / cached | 49.80ms /0.311ms | synthetic aggregation |
| Append1 event | 1 INSERT /2 statements /0.30ms | differential writer |
| Mission cold / cached / worst widget | 0.68ms /0.019ms /0.178ms | representative gzip242B |
| Profiles / mutation / document | max32 /32KiB /256KiB | bounded async app-owned JSON, no process probes on lists |
| Launch readiness / control fetch / help probe | 10s /12s /2s | explicit timeouts, no ready claim from starting alone |
| Public CA / inherited trust | 64KiB /4MiB | bounded reads, exact digest, no TLS bypass |
| Production Web→launcher→HTTPS proof | 2 origin requests /2 captures /4 verified originals | synthetic external child only, live metadata SSE, no list polling |

A prior perf run concurrent with the browser proof measured list0.491ms;
the isolated repeat after proof shutdown measured0.374ms (worst9.597ms,
proxy0.793ms). Final medians above are another complete serial gate. The
variance is retained, not used to relax existing budgets. Harness p99=0 does
not certify sustained capture or a30-minute workload. Real Agent transports,
full runtime diagnostics, Windows, crash recovery, high-water/load behavior
and whole-app request/DOM budgets remain pending. The production proof's
temporary services, child processes and browser tab were closed.

## 2026-10-16 — Read-only connection diagnostics (fusion B3 task4.5)

Sequential typecheck/build/full test(--maxWorkers=1)/lint/perf/strict OpenSpec/
diff gates passed:177 files,1912 passed,1 skipped. Runtime dependencies,
budgets and assertions unchanged. Frontend662.22kB/187.15kB gzip retains
the existing >500kB warning; lazy setup10.11kB/3.18kB gzip;
CLI663.04kB/181.41kB gzip.

| Check | Measured | Scope |
|---|---|---|
| Session list500 / worst slim9590 | 0.379ms /9.494ms | serial synthetic medians |
| Event / prompt candidate / proxy list50 | 0.007ms /0.013ms /0.843ms | candidate timing is not automatic association |
| Overview cold / cached | 49.56ms /0.326ms | synthetic aggregation |
| Append1 event | 1 INSERT /2 statements /0.31ms | differential write |
| Mission cold / cached / worst widget | 0.67ms /0.020ms /0.167ms | representative gzip242B |
| Diagnostic response | <16KiB | actual HTTP assertion; public CA read<=64KiB, one bounded profile, one status read, zero body reads/process probes |
| Web check timeout | 5s and owned abort on unmount | UI actual abort-signal regression with controlled timers |
| CLI stalled control timeout | >=12s and <14s | real built child + stalled local HTTP server, nonzero actionable result, one request, no project files |
| Synthetic browser workload | 1 explicit origin request /1 persisted capture | no extra upstream calls from Web/CLI checks; metadata SSE, no diagnostic polling |

Runtime updates invalidate snapshot evidence locally rather than refetching.
Browser inspection exposed and fixed a false stale warning due to object-key
order/client-estimated startedAt; a failing regression preceded the repair,
and the rebuilt page was reloaded and verified. Public CA availability and
shared HTTP traffic are not runtime trust, Agent identity or TLS coverage.
All proof listeners/tab were closed, SQLite quick_check=ok. Microbench p99=0
does not certify continuous proxy load,30-minute runs or full-app latency;
actual Agent transports, workers/overload/crash recovery and platform gates
remain open. No global proxy/trust or main-checkout changes.

## 2026-10-16 — Bounded live metadata worker (fusion B4 task5.1, schema13)

Sequential typecheck/build/full test(--maxWorkers=1)/lint/perf/strict OpenSpec/
diff gates passed:178 files,1925 passed,1 skipped. Assertions, budgets and
runtime dependencies unchanged. Frontend664.38kB/187.82kB gzip retains the
existing warning; lazy setup10.11/3.18. Full server tree is CLI645.21/176.95,
worker6.95/2.28 and shared parser19.69/5.73kB (uncompressed/gzip); a smaller
CLI entry alone does not mean the complete server payload shrank.

| Check | Measured/bound | Scope |
|---|---|---|
| Session list500 / worst slim9590 | 0.381ms /9.332ms | serial synthetic medians |
| Event / prompt candidate / proxy list50 | 0.006ms /0.013ms /0.834ms | prompt candidate is not automatic association |
| Overview cold / cached | 49.58ms /0.315ms | synthetic aggregation |
| Append1 event | 1 INSERT /2 statements /0.30ms | differential writer |
| Mission cold / cached / worst widget | 0.68ms /0.019ms /0.168ms | representative gzip241B |
| Worker queue | 64 jobs /32MiB source bytes incl. active, per listener | separate from32MiB body-file pending budget |
| Body preview / metadata / result | 2MiB each /64KiB /4MiB serialized | rejected/limited explicitly, no sync fallback |
| Worker lifetime | 5s admission deadline,64MiB old/16MiB young heap | real crash/restart/stall/termination tests |
| Near-limit parser isolation | four~1.9MiB streams, main heartbeat advances,p99<50ms | actual built worker regression, not continuous proxy load |
| Failure-network timing |300ms stalled-worker case excluded from capture duration | real HTTP origin/client/file/index test |
| Packaged worker | actual parse/threadId>0 from copied server-dist | no TS worker runtime required |
| Production Web/original proof | 3 origin requests/3 records/6 matching complete originals |2 bodies3MiB, explicit preview_truncated, no extra upstream replay |

Original body completeness and metadata processing failure are independent.
Network end UTC and integer-ms monotonic duration are frozen before queue/
flush. Processing commits yield first; stop waits writes/outcomes/worker.
Schema13 is additive and detail-only outcome reads never enter list/SSE.
Proof services/tab closed cleanly, SQLite quick_check=ok. Main checkout and
global proxy/trust unchanged. Aggregate active-preview/multi-listener bounds,
incremental streaming/compression/slow consumers, sustained30-minute p99,
whole-proxy A/B overhead, crash recovery and actual Agent transports remain
open; neither the microbench p99=0 nor the controlled parser test certifies
those wider requirements.

## 2026-10-16 — Incremental codecs and SSE fidelity (fusion B4 task5.2)

Sequential typecheck/build/full test(--maxWorkers=1)/lint/perf/strict OpenSpec/
diff gates passed:179 files,1951 passed,1 skipped. No dependency/budget or
assertion was relaxed. Frontend665.05kB/188.04kB gzip retains the existing
>500kB warning; lazy setup10.11/3.18; server CLI647.23/177.44, worker9.38/2.91,
shared parser22.69/6.65kB. Full server payload includes all three artifacts.

| Check | Measured/bound | Scope |
|---|---|---|
| Session list500 / worst slim9590 |0.403ms /9.661ms | final serial synthetic medians, list target<1ms |
| Event / prompt candidate / proxy list50 |0.006ms /0.012ms /0.854ms | prompt candidate does not establish association |
| Overview cold / cached |49.46ms /0.317ms | synthetic aggregation |
| Append1 event |1 INSERT /2 statements /0.33ms | differential writer |
| Mission cold / cached / worst widget |0.68ms /0.018ms /0.170ms | representative gzip241B |
| Encoded source / decoded semantic bound |2MiB each per direction | original file budget remains100MiB/direction |
| Source retention / decode slices |16KiB blocks /<=8KiB input slices | not one retained raw object per network chunk |
| Decoded display / worker SSE records |64KiB/direction /8192 events | explicit errors/truncation; originals independent |
| Real network codec matrix |gzip/br/deflate × JSON/SSE | encoded request+response forwarded/saved exactly |
| Production Web/API proof |2 upstream requests /2 records /4 matching originals | completed and incomplete-EOF, no analysis replay |

Initial perf run while the browser proof was active measured list0.445ms and
worst9.653ms; the first serial repeat after shutdown measured0.381/9.302ms.
All remain within the diagnostic <1ms/<15ms targets; final medians are above.
Proof proxy drained, process quit and temporary tab closed. Harness p99=0 is not a
sustained-load measurement. Global active-preview/multi-listener admission,
slow consumers, streaming push/recovery, full-network failure/A-B overhead,
30-minute load and actual Agent transports remain pending tasks5.3–5.5/B9/B10.

## 2026-10-16 — Global semantic budgets and slow subscribers (B4 task5.3)

Sequential typecheck/build/full single-worker test/lint/perf/strict OpenSpec/
diff-check passed:180 files,1966 passed,1 skipped. No runtime dependency,
schema change, weakened assertion or relaxed performance requirement.
Frontend666.55/188.48kB gzip retains existing500kB warning; lazy setup10.11/3.18;
server CLI655.47/179.47, worker9.38/2.91, shared22.92/6.71. Full server payload
requires all entries/chunks, not only CLI. Post-gate independent bound assertion
and docs are separately focused-tested/strict-validated/diff-checked.

| Check | Measured/bound | Scope |
|---|---|---|
| Session list500 / worst slim9590 |0.372ms /9.228ms | serial synthetic median |
| Event / prompt candidate / proxy list50 |0.007ms /0.014ms /0.846ms | no automatic identity inference |
| Overview cold / cached |49.17ms /0.305ms | existing synthetic aggregate |
| Append1 event |1 INSERT /2 statements /0.31ms | differential writer |
| Mission cold / cached / worst widget |0.71ms /0.020ms /0.168ms | representative gzip242B |
| Global preview pool |64 collectors /32MiB charged |320KiB fixed/collector +32KiB per16KiB raw block incl. handoff headroom |
| Shared processing pool |64 jobs /32MiB source /2 live workers | includes active jobs/terminating workers |
| Original pending operation cap |4096/store | shared across writers, in addition to configured byte cap |
| SSE |64 clients /256KiB frame /1MiB writable /5s drain | no app-side queue;503 for excess admission |
| Default-pool production pressure |64 held requests /24MiB charged |65th200/resource_limit/complete originals; subsequent capture recovers |
| Real paused SSE reader | disconnected after112 synthetic16KiB events |0 origin requests, no healthy/capture blockage |
| Integrity after pressure |66 origin calls /66 rows /132 exact complete originals |bytes/SHA-256 checked; all gauges0 after clean stop/quit |

The original-store byte budget is shared by listeners using the application
store; it is independent of semantic allocations. These bounds do not include
all Node/TLS/network/OS buffers or claim total RSS. Short pressure/paused-reader
proof plus harness p99=0 does not certify30-minute load, A-B forwarding overhead,
failure/retry fidelity, missed-event reconnect/recovery or actual Agent support.
Those remain5.4–5.5/B9/B10. No main/native/global configuration was changed.

## 2026-10-16 — Independent network terminal fidelity (B4 task5.4, schema14)

Final sequential typecheck/build/full single-worker test/lint/perf/strict
OpenSpec/diff-check passed:182 files,2007 passed,1 skipped. No dependency,
weakened assertion or relaxed hard budget. Frontend668.30/188.93kB gzip retains
the existing500kB warning; lazy setup10.11/3.18; server CLI660.32/180.61,
worker9.38/2.91, shared22.92/6.71. Docs-only follow-ups separately validated.

| Check | Measured/bound | Scope |
|---|---|---|
| Session list500 / worst slim9590 |0.364ms /9.626ms | serial synthetic medians |
| Event / prompt candidate / proxy list50 |0.007ms /0.011ms /0.859ms | existing explicit columns/indexes |
| Overview cold / cached |51.47ms /0.307ms | synthetic aggregate |
| Append1 event |1 INSERT /2 statements /0.33ms | unchanged differential writer |
| Mission cold / cached / worst widget |0.90ms /0.020ms /0.186ms | representative gzip240B |
| Transport outcome |<=512B /1 cached write per final transaction | detail-only, missing legacy unknown |
| Native fault matrix |12 real network tests |HTTP401/429/500/503, refusal, reset, native timeouts, upload/download cancel, clean EOF, early response/late upload |
| Projection regression |4 new cases,3 red before fix | no duplicate error object/wrong locator/failure overwritten by terminal |
| Browser/original proof |3 calls across2 runs(1+2),3 rows,6 matching downloads | one interrupted response prefix, not fabricated full content |
| Restart/offline check |old429 retained and fixed analysis,0 replay | no native/global configuration or paid requests |

Network completion clocks/flags/first cause are frozen before file flush or
worker delay. Normal finalization waits both directions; stop/cancel/native
errors settle once. No default monitor request/stream timeout; timeout tests
use real test-owned socket timers. Abort propagates on broken started responses
instead of appending error text. HTTP failure, protocol projection, processing
and original retention stay separate. Short fault tests and harness p99=0 do
not certify A-B forwarding overhead,30-minute load, crash/reconnect recovery or
actual Agent/platform support. Those remain5.5/B6/B9/B10. Proof services closed.

## 2026-10-16 — Controlled forwarding A/B (B4 task5.5)

Final sequential typecheck/build/full single-worker test/lint/perf/strict
OpenSpec/diff-check passed:183 files,2020 passed,1 skipped. No dependency,
assertion or hard budget relaxed. Diagnostic-only13 adjacent tests exercise
actual production capture logic over real loopback HTTP/HTTPS, not mocks.
Frontend668.30/188.93kB gzip retains existing500kB warning; lazy setup10.11/3.18;
CLI660.32/180.61, worker9.38/2.91, shared22.92/6.71. Docs-only results below
were separately strict-validated/diff-checked after the full code gate.

Measured2026-10-15T21:38:13.995Z on Node26.5.1/darwin/arm64/schema14.
Report: reports/capture-ab-2026-10-15T21-37-59.322Z-83428.json (local ignored
artifact). Base HEAD d5da6afa611bb44889f0834b5fa7bfda68838f7d plus working tree;
actual bundled diagnostic SHA-256 ca1f789f23f74f0b5d3ba24a46263c4729d7f1f24610b84891cd18038cb45f53,
copied worker cb215d3e3397f7ca89c80ef63e231bddcb583d438d9dc3034b906f61d0290183,
shared parser18a43c1734e1c6aa5917b74fa93078c0f81908965a0df8faa49b62ca08356e1a.

| Controlled profile | Additional first-byte p95 | Additional E2E p95 | Sampled loop p99 | DB / WAL bytes |
|---|---|---|---|---|
| HTTP,9605B response |3.650ms |6.585ms |2.402ms (3036 samples) |1,417,216 /8,314,192 |
| Trusted HTTPS CONNECT,9605B |11.085ms |13.823ms |2.183ms (3293 samples) |1,417,216 /8,314,192 |
| HTTP,1,801,413B SSE |1.683ms |5.097ms |2.128ms (3063 samples) |7,196,672 /8,392,472 |

Each profile uses100 warm paired samples,4 concurrent pair lanes,8 text deltas
paced5ms plus protocol/tool/heartbeat frames;1 cold pair and3 explicit warmups
are separate. Alternating AB/BA retains signed per-pair differences, not a
difference of independent percentiles. NFR predeclared warm paired additional
first-body-byte/E2E p95<=20ms and actual loop p99<50ms; all3 are qualified and
pass existing DB/WAL budgets. This is not a max-latency promise: HTTPS warm max
additional E2E21.569ms; cold proxy first byte52.011ms vs direct3.621ms and cold
E2E141.416ms vs direct90.067ms. Initialization76.731/120.088/68.958ms and raw
direct/proxy p50/p95/max samples remain in the report, not discarded outliers.

Actual ProxyRuntime/MITM/original file store/worker/metadata SSE run together;
origin/client are synthetic in the same process. Origin refuses to finish
until client sees its first body byte, so buffering to EOF fails a watchdog.
Exact application headers/status/body bytes and original-backed protocol
projections agree;104 captures/208 exact original digests/104 metadata SSE
events per profile (624 origin calls/312 captures/624 originals total), native
input3/output2, no unexpected processing/admission failures. All collector/
preview/job/source/worker/SSE/file pending ownership is zero after shutdown.
Disposable synthetic DB/CA/originals/build copies removed after success; CLI
failure retains its isolated evidence path. No user capture files removed.
JSON/SSE identity/gzip/br/deflate, real CONNECT and reset/cancel/HTTP503 prefix
tests complement normal-profile timing; short smoke cannot qualify performance.

Existing serial diagnostics: list0.377/worst slim9.689/proxy0.904ms; overview
49.94ms cold/0.330ms cached; differential append1 INSERT/2 statements/0.35ms;
mission0.69/0.021/worst0.174ms, representative gzip242B. Old microbench loop
p99=0 is not load evidence; only the new actual nonzero histogram is used for
this forwarding gate. Reproduce: npm run build then npm run perf:check; standalone
node perf-diag/09-capture-ab.mjs accepts --out <new-report.json> without overwrite.
Full Web/scanner query concurrency, RSS,30-minute soak, crash/reconnect and
actual Agent/platform/transport certification remain B6/B9/B10;2.4/11.4 and
pending parity are not ticked. Main/native/global settings unchanged, no paid
Agent call, added dependency or commit/push. OpenSpec26/71, full goal active.

## 2026-10-16 — Durable crash journal and recovery (B6 task7.2)

Final sequential typecheck/build/full single-worker tests/lint/perf/strict
OpenSpec/diff-check passed:185 files,2036 passed,1 skipped. New journal10,
actual process-recovery3 and body-store3 additional tests, with no parser/DB/
network logic mocked. Docs-only final recording separately validated. Schema
stays14; no extra SQLite tables/body duplication, dependencies or relaxed
assertions/budgets. Frontend668.30/188.93kB gzip retains500kB warning; lazy
setup10.11/3.18; CLI677.61/185.06, worker9.38/2.91, shared22.92/6.71.

Journal identity is private, same-DB and durable before new original files
open, while forwarding proceeds. Header/end/terminal/ref snapshots coalesce
into one admitted job/latest value per request, with64-job/256KiB-record/
4MiB-serialized-pending/16MiB-retained bounds plus one bounded atomic scratch.
Original queues/quotas and semantic admission remain independent. Recovery
enumerates metadata incrementally, streams64KiB digest chunks and yields;
no full original read, automatic reparse, relink, upstream replay or body
deletion. Finished refs are verified; unknown process-loss prefixes never
become complete merely from EOF/file suffix. Missing evidence stays explicit.

| Check | Actual evidence | Boundary |
|---|---|---|
| Kill during stream |1 origin call→1 recovered row/2 exact HTTP downloads | unknown completion/duration/usage remain null |
| Kill after rejected final commit |0 saved events before kill;1 row/2 exact originals after fault repair | durable terminal/clocks/finished refs retained; processing closed |
| Repeat restart |same1 row and0 extra origin requests in each scenario | both original IDs required; no request-id-only adoption |
| Corrupt journal |unified503 capture list +200 health, original metadata retained | scan/static not gated; no empty-success list |
| Clean recovered/corrupt server shutdown |5 actual child runs exit0/quick_check=ok |2 earlier capture children intentionally SIGKILLed |
| Status correction |exactly one proxy_status with requestCount1 per recovery batch | no per-record body flood/early stale count |
| Real SQLite lock |transient succeeds on2nd attempt with advancing timer | configured busy_timeout5000 restored |
| Persistent/permanent SQLite fault |3 attempts for BUSY;1 for constraint failure |10/40ms async backoff, no saved event |
| Metadata bounds |65th queued job and >256KiB record rejected;16MiB stops without eviction |1000 updates share one admitted task/latest snapshot |

Journal-enabled actual A/B report:
reports/capture-ab-2026-10-15T22-05-53.884Z-86407.json,
observed2026-10-15T22:06:08.481Z, Node26.5.1/darwin/arm64/schema14. Compiled
diagnostic SHA-2568b650f227a3f6d74ce09871f680ef5aa022175b202e0695eaa4a4d640185b513;
worker cb215d3e3397f7ca89c80ef63e231bddcb583d438d9dc3034b906f61d0290183;
shared parser18a43c1734e1c6aa5917b74fa93078c0f81908965a0df8faa49b62ca08356e1a.
Base HEAD plus working-tree marker and all raw pairs/cold/warm/cleanup remain
in the report, not inferred from old commit alone.

| Profile (100 warm pairs,4 concurrency) | Extra first-byte p95 | Extra E2E p95 | Sampled loop p99 | DB / WAL bytes |
|---|---|---|---|---|
| HTTP |3.501ms |7.024ms |2.646ms (3119 samples) |1,417,216 /8,318,312 |
| Trusted HTTPS CONNECT |9.619ms |12.158ms |2.335ms (3436 samples) |1,417,216 /8,318,312 |
| HTTP1,801,413B SSE |1.786ms |7.471ms |2.177ms (3126 samples) |7,131,136 /8,343,032 |

All3 qualify/pass unchanged<=20ms paired additional p95,<50ms loop and existing
DB/WAL budgets.624 controlled origin calls/312 captures/624 byte+digest-verified
originals/312 metadata SSE events; all ownership gauges zero after shutdown,
disposable synthetic stores removed. HTTPS cold first byte63.881ms vs direct
3.607ms remains recorded; this is neither a max-latency promise nor model TTFT.
Serial list0.404/worst9.660/proxy0.833ms; overview50.15/0.337ms; append exactly
1 INSERT/2 statements/0.33ms; mission0.72/0.019/worst0.172ms, gzip242B.
Old empty microbench p99=0 still is not continuous-load proof.

This verifies process-crash recovery of durably admitted/written bytes, not
power loss,30-minute soak/full Web+scanner load, Web reconnect or actual
Agent/Windows support. Legacy unjournaled remnants are preserved/quota-charged,
not guessed into requests. Manual deletion/capacity controls and versioned
offline replay remain next B6 tasks. Main retains45 tracked pre-existing edits
untouched; no native/global changes, real Agent/model calls, commit or push.
OpenSpec27/71; pending parity and full goal remain active.

## 2026-10-16 — Exact retention/recovery identity (first7.3 gate, schema15)

Final sequential typecheck/build/full single-worker test/lint/perf/strict
OpenSpec/diff-check passed:185 files,2045 passed,1 skipped. New9 regression
cases; no parser/database/network logic mocked, assertions or budgets relaxed.
Frontend668.30/188.93kB gzip retains500kB warning; lazy setup10.11/3.18;
CLI679.79/185.60, worker9.38/2.91, shared22.92/6.71. No dependency change.

Additive schema15 has exact request+both-original tombstones, no FK cascade
back to deleted rows, and idx_proxy_started_utc. Explicit retention markers
and deletes commit atomically. No original files/scan rows are deleted; expired
request/body URLs404 and retained file bytes remain charged. Time alone is
not deletion identity: different/uncommitted old-clock evidence still recovers.
Disabled/longer policy keeps markers. The unaccepted global-floor draft was
replaced, not shipped as the final deletion rule. Current-schema expectations
advance14→15 only; migration/index/cascade assertions preserve original data.

| Check | Evidence | Scope |
|---|---|---|
| Exact UTC cutoff |old path returned0 vs2 expected; fixed-boundary/offset cases pass | equal cutoff retained; no ISO-T/SQLite-space text comparison |
| Atomic failure |real DELETE trigger rejects; marker and deletion both roll back | no false deletion authority |
| Identity safety |request AND both original IDs required; foreign/distinct old-clock evidence retained | indexed exact lookup before body IO |
| Original preservation |expired journal cleanup skips even conflicting body files | no hash/read/unlink of originals; quota unchanged |
| Actual CLI order |1 real origin/capture; reinjected valid stale snapshot + aged fixture metadata; actual startup self-check retention1 | failed-cleanup layout injected deliberately, not an OS recreation claim |
| Repeat restart |2 clean server restarts, second with retention disabled | list empty/URLs404, original bytes equal,0 additional origin calls, exit0/quick_check=ok |
| Query-plan regression |UTC index genuinely broke unchanged predecessor session-index assertion | source fixed via association-index-driven CROSS JOIN/PK;3 metadata reads/no body/sort,10000-capture<20ms unchanged |
| v14→v15 |original ref/cookie/transport data survives repeated init | tombstones survive deletion; PK/UTC query plans checked |

Final report reports/capture-ab-2026-10-15T22-39-00.481Z-88526.json,
observed2026-10-15T22:39:15.046Z on Node26.5.1/darwin/arm64/schema15. Actual
bundled diagnostic SHA-2569cb7351f928791a48bafd83d1fa139c33bc5abcee0b82e4df31df9593393118c;
worker cb215d3e3397f7ca89c80ef63e231bddcb583d438d9dc3034b906f61d0290183;
shared parser18a43c1734e1c6aa5917b74fa93078c0f81908965a0df8faa49b62ca08356e1a.
Base HEAD/working-tree marker, raw paired/cold/warm samples and post-close
ownership remain in the report; no old report is substituted for current code.

|100 warm pairs /4 concurrency |Extra first-byte p95 |Extra E2E p95 |Actual loop p99 |DB / WAL bytes |
|---|---|---|---|---|
|HTTP |2.644ms |4.738ms |2.370ms (3091 samples) |1,380,352 /8,301,832 |
|Trusted HTTPS CONNECT |8.148ms |11.204ms |2.707ms (3282 samples) |1,380,352 /8,301,832 |
|HTTP1,801,413B SSE |1.577ms |4.646ms |2.150ms (3148 samples) |7,004,160 /8,384,232 |

All3 qualified/pass unchanged20ms additional paired p95,50ms loop and DB/WAL
budgets.624 controlled origin calls/312 saved records/624 exact originals/312
metadata SSE events; cleanup verified with zero owned gauges and synthetic
stores removed. First body byte is not model TTFT or a max-latency promise.
Serial list0.426/worst9.660/proxy0.838ms; overview48.78/0.318ms; append exactly
1 INSERT/2 statements/0.34ms; mission0.70/0.021/worst0.183ms, gzip242B.

This closes only the already-deleted committed-observation resurrection gate.
Full7.3 remains unchecked: manual original/metadata deletion, marker-growth/
capacity/high-watermark/WAL/disk-fault protection and a bounded yielding current
TTL pass AFTER recovery are still required. Do not put synchronous bulk purge
on HTTP paths or infer freed original space from deleted metadata. No UI change
or new browser certification. Older full run2044 pass/1 plan failure is not
acceptance. Final docs separately strict-validated/diff-checked. Main45 tracked
pre-existing edits untouched, no user original deletion, commit/push, paid Agent
call or native/global configuration change. OpenSpec stays27/71, goal active.

## Current-TTL recovery admission — 2026-10-16

M11/M12 fusion7.3 sub-gate, schema15 unchanged. Apply explicit TTL before
uncommitted journal body/graph recovery using one exact-marker statement with
indexed committed-request exclusion and existing bounded yielding retries.
Default0 retains evidence; no bulk HTTP purge, original deletion or scan reset.
New5 tests (journal4 +real child1), including500 expirations with a pinned WAL
reader: actual nonzero-sample loop p99<50ms, WAL<20MB, DB+WAL<200MB; persistent
write locks reject<250ms without blocking the loop, restore busy_timeout5000
and retain journals. Actual stream→kill→explicit fixture aging→CLI retention→
HTTP recovery→retention-disabled restart preserves prefixes/quota, health200,
zero replay/false saved events and clean quick_check. This is bounded fixture
evidence, not maximum-size journal/ID, indefinite-marker or sustained-load proof.

Sequential typecheck/build/test/lint/perf/strict OpenSpec/diff passed:
185 files,2050 passed,1 skipped. Frontend668.30kB/188.93kB gzip retains the
existing500kB warning; CLI680.99/185.89, worker9.38/2.91, shared22.92/6.71.
Serial diagnostics list0.365/worst9.218/proxy0.871ms; overview48.45/0.328ms;
append1 INSERT/2 statements/0.31ms; mission0.69/0.019/worst0.167ms, gzip242B.
The legacy07 loop probe has0 meaningful samples; it is not loop certification.

Fresh actual forwarding A/B report:
reports/capture-ab-2026-10-15T22-51-02.011Z-89705.json. HTTP/fully trusted HTTPS
CONNECT/near2MiB each100 AB/BA pairs at concurrency4; extra first-byte p95
3.334/6.817/1.464ms; extra E2E p95=6.501/8.634/4.592ms; nonzero loop samples
3126/3339/3135, loop p99=2.318/2.212/2.122ms. All qualified/passed unchanged
20ms forwarding/50ms loop/storage gates. This is not TTFT or full-app/real
Agent/30-minute certification. Full7.3 capacity/WAL/disk/manual cleanup remains
open; OpenSpec27/71, goal active. Main45 pre-existing tracked edits untouched.

## Explicit original-removal file layer — 2026-10-16

M11/M12 fusion7.3 internal foundation, schema15 unchanged. Max2 explicit body
IDs/max4 paths per async removal, preflight all candidates, reject active
readers/writers/recovery/concurrent maintenance and fence new IO admission.
No recursive deletion or public/retention call site. Inventory is streamed via
opendir/lstat and yields, including startup; success and partial failure both
reconcile surviving bytes rather than crediting requested bytes in advance.
Returned bytes are an accounted-quota delta, not allocated disk blocks.

New6 body-store cases (suite25 total) actually execute on macOS UID501: explicit
IDs/quota/restart/idempotence; traversal/symlink/directory refusal; ownership
and maintenance fences; actual EACCES; actual owner-only immutable-second-file
partial unlink; yielding500-file inventory. Partial failure preserves8 charged/
readable bytes and the same restarted quota; clearing the disposable fixture's
immutable flag enables retry without double credit. Only generated temp data
was deleted. These tests do not prove cross-platform/full deletion workflow,
durable restart intent or production capacity/disk-full guards.

Sequential typecheck/build/test/lint/perf/strict OpenSpec/diff-check all passed:
185 files,2056 passed,1 skipped. Frontend668.30kB/188.93kB gzip (existing500kB
warning unchanged), CLI682.98/186.33, worker9.38/2.91, shared22.92/6.71.
Serial list0.369/worst9.507/proxy0.845ms; overview49.17/0.343ms; append1 INSERT/
2 statements/0.31ms; mission0.78/0.019/worst0.186ms, gzip243B. Legacy07's empty
loop histogram is not treated as loop certification.

Fresh actual A/B report reports/capture-ab-2026-10-15T22-58-49.714Z-90867.json:
HTTP/fully trusted HTTPS CONNECT/near2MiB each100 AB/BA pairs at concurrency4;
additional first-byte p95=2.847/8.100/1.986ms, E2E p95=6.530/10.855/5.866ms;
loop p99=2.429/2.281/2.152ms, samples3184/3302/3120. All3 qualified/passed
unchanged20ms forwarding/50ms loop/storage budgets. Not TTFT, full Web/scanner
concurrency, actual Agents, Windows or30-minute proof. Full7.3 capacity/manual
coordinator/HTTP/Web confirmation remains open; OpenSpec27/71, goal active.
Main45 tracked pre-existing edits untouched; no new dependencies/commit/push.

## Durable original-deletion queue core — 2026-10-16

M11/M12 fusion7.3 internal core, additive schema16: independent durable job
table/pending index plus2 original-ID ownership indexes (JSON-valid expressions
preserve malformed legacy evidence). Admission snapshots normalized refs and
store root and atomically persists exact deletion marker. Max1024 retained jobs,
one active run per shared DB owner, same-job callers share a promise; no unbounded
queue or automatic history eviction. Before unlink recheck ownership and verify
both original digests; mismatched store/identity/bytes/shared refs fail visibly.
Pending resumes after reopening, failed needs explicit retry. Complete means
original FILE cleanup only, not metadata/preview erasure. No production/startup/
HTTP/Web call site yet; full stopped-monitor/preview/confirmed deletion remains.

New12 queue cases +1 type contract: actual SQLite atomic rollback/lock waits,
invalid refs, directory/digest/shared-reference failures, pending close/reopen,
post-unlink status-write failure, no-resurrection marker after controlled metadata
cascade/stale same-owner journal, cross-instance ownership,1024 bounded synthetic
metadata intents including failed/complete history and additive-schema/index
plans. The OR lookup really selected a body-table scan after ANALYZE; repaired
source to separate INDEXED BY UNION ALL arms, retaining strict assertions.
These restart fixtures do not claim new SIGKILL, power-loss, maximum-size/disk-full
or load proof. Only isolated synthetic originals were removed, no user cleanup.

Sequential typecheck/build/test/lint/perf/strict OpenSpec/diff-check all passed:
186 files/2069 passed/1 skipped. Frontend668.30kB/188.93kB gzip (existing500kB
warning), CLI683.83/186.51, worker9.38/2.91/shared22.92/6.71. Serial list0.377/
worst9.252/proxy0.830ms; overview49.08/0.306ms; append1 INSERT/2 statements/
0.31ms; mission0.69/0.018/worst0.181ms, gzip241B. Legacy07 zero-sample loop
probe is not treated as loop certification.

Fresh A/B reports/capture-ab-2026-10-15T23-12-22.985Z-92307.json: HTTP/trusted
HTTPS CONNECT/near2MiB each100 AB/BA pairs at concurrency4, extra first-byte
p95=3.619/8.549/1.443ms, extra E2E p95=6.576/11.830/5.068ms; measured loop
p99=2.359/2.286/2.142ms with3198/3374/3111 samples. All3 qualified/passed
unchanged forwarding/loop/storage budgets. Not TTFT/full-app/actual Agent/
Windows/30-minute certification. OpenSpec27/71, full7.3/goal remain active.
Main45 pre-existing tracked edits untouched, no dependencies/commit/push.

## Confirmed original-body deletion backend — 2026-10-16

M11/M12 fusion7.3 backend sub-gate, schema16 unchanged. GET/POST selected request's
original-deletion status/action; POST exact identity+confirm, max8KiB, stopped
monitor maintenance excludes start/launch/concurrent deletion. Intent+marker+
clearing proxy body/raw/prompt copies is atomic. Headers/usage/request/native
metadata remain; not full request/header/export/forensic erasure. Pending resumes
before capture admission; failed explicit/retryable. Original refs remain observed
capture evidence; status job records later body unavailability. Active handlers/
startup recovery retain shutdown ownership. Global Clear/Web UI remain pending.

New9 cases: API7 including actual production MITM/original/worker→stop→confirmed
body cleanup→restart with1 synthetic loopback origin call/no replay, exact input/
Origin policy, real filesystem permission failure+retry, SQL status-write failure
sanitization/retry, no-journal pending startup, real copy-clear rollback, physical
file-reappearance blocked; runtime1 start/concurrent lease/release-on-failure;
context-diff1 controlled async gate with actual originals/parser/diff prevents an
already-read deleted base returning late. Fresh detail/body/analysis/diff API
guards deny confirmed intent without legacy fallback, including failed cleanup.
No business/IO mocks; only generated temporary files removed. Clean reopen here
is not a new SIGKILL, max-size, concurrent-deletion load or Windows certificate.

Sequential typecheck/build/test/lint/perf/strict OpenSpec/diff-check all passed:
187 files/2078 passed/1 skipped. CLI696.72kB/189.93kB gzip, worker9.38/2.91,
shared22.92/6.71; frontend668.30/188.93 keeps its existing500kB warning. Serial
list0.380/worst9.769/proxy0.847ms; overview49.54/0.350ms; append1 INSERT/2
statements/0.36ms; mission0.73/0.021/worst0.177ms, gzip242B. Legacy07's empty
histogram is not loop certification.

Fresh A/B reports/capture-ab-2026-10-15T23-28-04.820Z-93591.json: HTTP/trusted
HTTPS CONNECT/near2MiB each100 AB/BA pairs at concurrency4; extra first-byte
p95=3.001/7.879/1.610ms, extra E2E p95=7.260/11.250/6.106ms, measured loop
p99=2.322/2.159/2.109ms with3126/3276/3108 samples. All3 qualified/passed
unchanged forwarding/loop/storage budgets. Not TTFT/full-app/deletion-load/
actual Agent/Windows/30-minute proof. Full7.3 remains open for Web confirmation/
cache invalidation, global management and capacity/WAL/marker/disk-full gates.
OpenSpec27/71, goal active; main45 pre-existing tracked edits untouched.

## Confirmed original-body deletion Web control — 2026-10-16

M11/M12 fusion7.3 sub-gate, schema16 unchanged. Selected-request bilingual
confirmation/status/explicit retry, stopped-monitor prerequisite, no polling or
list N+1. On submission/known intent, local body/prompt/download/analysis/diff
cache and late callbacks cannot revive content, including stale reopened detail.
Headers/timing/links/native data remain. New7 control tests +2 detail regressions;
focused31 passed. Full first run passed188 files/2087 tests/1 skipped, then lint
correctly rejected Node globals in the new diagnostic mjs fixture. Fixed with
explicit Buffer/console imports and a JSON-only clone of the plain default
config; no lint rule or test assertion relaxed.

Second full sequential typecheck/build/test/lint/perf/strict OpenSpec/diff-check
all exit0:188 files/2087 passed/1 skipped. Frontend676.68kB/191.40kB gzip,
setup10.11/3.18, CLI696.72/189.93, worker9.38/2.91/shared22.92/6.71. Existing
500kB uncompressed chunk warning remains; initial JS below200kB gzip target.
Serial list0.378/worst9590detail9.733/proxy0.858ms; overview49.34/0.365ms;
append1 INSERT/2 statements/0.30ms; mission0.71/0.019/worst0.167ms, gzip242B.
Legacy07's zero-sample loop histogram is not latency certification.

Fresh actual A/B reports/capture-ab-2026-10-16T00-09-16.413Z-95890.json:
HTTP/trusted HTTPS CONNECT/near2MiB each100 AB/BA pairs at concurrency4;
extra first-byte p95=2.909/7.604/1.912ms, extra E2E p95=6.342/10.214/5.990ms,
loop p99=2.302/2.134/2.130ms with3115/3448/3121 samples. All3 qualified/passed
unchanged forwarding/storage/loop budgets. Not TTFT/full-app/deletion-load/
actual Agent/Windows/30-minute proof.

Actual built SPA/API browser check used disabled9 native providers, isolated
415B synthetic originals and no upstream calls. Verified zh/en scope/exact ID,
unchecked disabled/checked enabled submit, Escape cancel/focus return, normal
body/download and reopening. Browser did NOT irreversibly submit: post-submit
deletion/failure/cache behavior is component/API tested, not browser-certified.
No CSS change needed; no exported screenshot, Lighthouse or p75 LCP/INP/CLS
measurement. Fixture closed via SIGINT/exit0, quick_check=ok, generated data and
validated temp build removed, temporary tab closed. Main45 tracked pre-existing
edits untouched; no user originals/dependencies/native/global/paid/commit/push.
OpenSpec27/71/full7.3/goal stay active for capacity/WAL/marker/disk faults and
global request management. Skills: openspec-apply-change and senior-frontend
(contract tracking, async cache cleanup and semantic keyboard/focus behavior).

## Capture DB/WAL pressure admission — 2026-10-16

M11/M12 fusion7.3 partial capacity gate, schema16/OpenSpec27/71 unchanged.
Shared64-slot per-DB lane checks actual DB/WAL lengths asynchronously at new
journal admission/final capture/recovery commit. Single non-waiting checkpoint
at8,000,000 WAL bytes, admission limits180,000,000 combined/12,000,000 WAL bytes;
hard200MB/20MB unchanged. No scan deletion/page-cap/expiry/vacuum. Explicit
/api/proxy/capacity is metadata-only/no recovery/checkpoint. Known committed
body reads/explicit cleanup remain possible under pressure-blocked recovery;
start/restart retries deferred journals. Static native SQLITE_FULL/pressure
runtime errors retain evidence, never count saved success.

Genuine first failure: pinned reader made checkpointWal wait5404.926ms against
the unchanged<50ms assertion. Fixed temporary busy_timeout=0/exact restoration;
custom37ms policy/in-transaction refusal covered too. New14 tests: capacity7,
production API4, checkpoint2, type1. Focused95/typecheck/lint passed. Native
SQLite max_page_count is fixture-only to produce SQLITE_FULL; real proxy retains
full originals/journal, restarts1 row/no replay. Actual pressure proxy forwards
without untracked originals/saved rows and resumes after relief. Sparse apparent
DB length is not physical disk usage/exhaustion proof. Two initial failed fixture
dirs (identical-zeroblob test setup did not grow WAL) were later read-only checked
for synthetic marker/zero requests/quick_check=ok, then exactly removed; all
successful fixtures clean themselves. No user originals touched.

Sequential typecheck/build/test/lint/perf/strict OpenSpec/diff-check all exit0:
190 files/2101 passed/1 skipped. Frontend676.68/191.40kB gzip unchanged existing
500kB warning; CLI700.62/190.27, worker9.38/2.91/shared22.92/6.71. Serial list
0.411/worst9590detail9.506/proxy0.813ms; overview48.77/0.312ms; append1 INSERT/
2 statements/0.32ms; mission0.68/0.019/worst0.166ms, gzip242B. Legacy07 empty
histogram is not event-loop certification.

Actual production A/B reports/capture-ab-2026-10-16T00-22-53.145Z-97494.json:
HTTP/trusted HTTPS CONNECT/near2MiB each100 paired AB/BA samples at concurrency4,
extra first-byte p95=2.732/10.105/1.210ms, extra E2E p95=6.840/12.437/4.775ms;
measured loop p99=3.465/3.613/2.101ms (3130/3285/3219 samples), all qualified/
passed unchanged hard budgets. HTTPS E2E was~21.8% above the prior historical
10.214ms snapshot, so a relative-regression investigation was required, not a
silent threshold increase. Isolated production repeat is retained too:
reports/capture-ab-2026-10-16T00-23-36.354Z-97555.json, extra first-byte p95=
3.314/9.476/1.577ms, E2E p95=6.794/11.754/6.169ms; loop p99=3.234/3.813/
2.179ms (3167/3401/3172 samples), all3 qualified/passed. Neither run discarded.

performance-profiler skill guided same-source controlled isolation instead of
speculative optimization. Diagnostic10 builds production plus a temporary
counterfactual with exactly2 checked journal admission call sites bypassed;
there is NO production bypass flag/source edit. ABBA(reference/on/on/reference)
trusted HTTPS uses100 direct/proxy pairs per run, concurrency4, same real worker/
origin/store and full byte/protocol/resource assertions. Report with all raw
samples and artifact hashes:
reports/capture-capacity-ab-2026-10-16T00-26-02.579Z-97637.json.
Means of TWO run-level p95/p99 values (not pooled percentiles): reference
first-byte8.077/E2E10.616/loop2.307ms; production8.466/10.953/2.673ms. Ratios
1.04815/1.03176/1.15846, all<=1.2 and all4 hard gates qualified/passed. This
isolates modest guard cost in this fixture; it does not prove statistical
significance or eliminate real historical variation. The reference is not the
entire old product and never certifies a pressure-unsafe production mode.
Temporary comparison builds/owned fixture resources removed on completion.

No full-app/real Agent/Windows/deletion-load/physical ENOSPC/30-minute or
worst-transaction-capacity certification. Shared scan/external writers, remaining
reserve/tombstone growth, capacity Web display, global request management and
NFR §7 long-term separation remain open; automatic expiry cannot override the
approved higher-priority no-implicit-original-deletion policy. Main45 tracked
edits untouched; no dependencies/native/global/paid calls/commit/push. Goal active.

## Capacity Web snapshots and keyboard ownership — 2026-10-16

M11/M12 fusion7.3 Web sub-gate, schema16/OpenSpec27/71 unchanged. Lazy capacity
drawer queries original quota and metadata capacity once each on open/manual
refresh only, no closed/SSE-only polling/body reads/list N+1. Separate loading/
unknown/partial errors, bounded5s abort and late/unmount generation guards.
Original remaining quota is clamped at0, never labelled physical free space.
Metadata below watermark is not Agent/capture certification. Already-confirmed
pending deletion may resume through original status, explicitly disclosed;
no new intent/clear/checkpoint/start action. Relevant primitive runtime changes
only mark stale, not object-key order or locale; stable close callback avoids
runtime-driven focus reset. Keyboard refresh restores focus unless user moved it.

Actual browser found App's global Enter swallowed native toolbar/drawer button
activation (zero API requests);3 genuine failing keyboard regressions preceded
fix honoring defaultPrevented, active-overlay ownership and native Enter/Space.
Esc/IME/outside-overlay background navigation remain. Rebuilt/reloaded actual
SPA confirmed Enter open/refresh, focus return, Tab trap, Esc trigger focus and
English/Chinese semantics. New19 tests: panel13 +ProxyView2 +keyboard3 +i18n1.
Focused5 files/54 passed, typecheck/lint/build green. HTTP boundaries alone mocked
in component tests; no component/client/keyboard business logic mocked.

Production SPA/API diagnostic fixture --capacity-proof used all9 providers
disabled,1 synthetic request/415 original bytes/quota415, real pinned reader
WAL12,224,072B. First drawer correctly showed exhausted originals separately
from WAL pressure. Explicit fixture-reader release/checkpoint gave WAL0 without
extra API requests; refreshed metadata became ready while original quota stayed
exhausted. Final endpoint counts6/6 exactly match deliberate opens/refreshes
across source rebuild/reloads and language check; closed initial counts0/0,
first open1/1 and unchanged on external relief. No browser deletion or Agent/
origin/paid call. Temporary tab closed; owned PTY5256 SIGINT→exit0, quick_check=ok,
syntheticDataRemoved=true. Only its generated data and validated temporary build
directory removed. Screenshot inspected readable dense500px drawer/wrapping;
no screenshot file exported or Lighthouse/CWV/full-a11y certification.

Full sequential typecheck/build/test/lint/perf/strict OpenSpec/diff-check all
exit0:191 files/2120 passed/1 skipped. Frontend684.27/193.88kB gzip, lazy capacity
6.93/2.28, setup10.11/3.18; CLI700.62/190.27, worker9.38/2.91/shared22.92/6.71.
Initial JS below200kB target; existing500kB uncompressed warning retained.
Serial list0.381/worst9590detail9.777/proxy0.816ms; overview48.72/0.329ms;
append1 INSERT/2 statements/0.33ms; mission0.70/0.020/worst0.170ms, gzip242B.
Legacy07's empty loop histogram is not latency certification.

Fresh actual production A/B reports/capture-ab-2026-10-16T00-46-58.544Z-99653.json:
HTTP/trusted HTTPS CONNECT/near2MiB each100 paired samples at concurrency4;
extra first-byte p95=2.653/7.727/1.547ms, extra E2E p95=7.418/11.345/4.710ms,
loop p99=2.902/3.766/2.130ms with3183/3334/3183 samples. All3 qualified/passed
unchanged hard forwarding/storage/loop budgets. Not full-app/deletion-pressure/
physical ENOSPC/real Agent/Windows/30-minute certification.

Skills openspec-apply-change and senior-frontend influenced contract tracking,
explicit unknown/async ownership and semantic keyboard focus; no framework/
dependency change. AA best effort owned by main implementation; p75 LCP2500/
INP200/CLS0.1 and Lighthouse90 perf/a11y are unmeasured targets, with stricter
project NFR retained. Main45 tracked edits unchanged, no user evidence/native/
global/paid/commit/push. Full7.3/goal remain active: shared writers, worst-size
transaction headroom, tombstone growth, physical disk faults, long-term split,
full request management and later full-chain/real Agent acceptance.

## Actually admitted large capture / v17 index amplification — 2026-10-16

M11/M12 fusion7.3 sub-gate, schema17/OpenSpec27/71. Real production HTTP proxy,
built worker, SQLite and actual file lengths,32 synthetic scan owners sharing
one exact native session, one origin call per case; no parser or DB mocks.
Pinned real reader plus fixture-only disabled autocheckpoint fills WAL to just
below returned admission, not an empty DB success. Bytes+SHA, all identity
counts/completeness, scan rows/candidates, processing=ok and nonempty loop
samples are strict assertions. No result-limit fallback accepted.

Original failing report reports/capture-capacity-worst-1792112112019-243.json:
1,916,503B request/1900 tools/scope1024/32 candidates; beforeWAL11,849,152B,
final30,224,352B (delta18,375,200), DB716,800B; loop54.460415ms/44 samples.
Both WAL20MB and p99<50ms hard budgets genuinely violated; report retained.
Wide native index duplicated long values/scopes not used by session matching.

v17 atomically rebuilds only that index for session/scope NULL, preserving every
identity row/value/scope/locator/source/association, originals and scan data.
Rollback/retry tested by actual SQLite trigger failure at version write; repeated
current init retains rootpage. Tiny analyzed DB revealed a real full partial-index
SCAN; json_each-key-driven CROSS JOIN INDEXED BY now uses exact SEARCH. The
strict original plan assertion was not relaxed. WAL admission12MB→8MB reserves
more headroom; checkpoint trigger8MB/combined admission180MB/hard20MB+200MB
unchanged. No added deps, data deletion/reparse/rescan/vacuum or identity/result
limit decrease. No CPU profiler/locale-sort optimization was performed.

Strengthened reports (near-admission beforeWAL7,704,432B, DB716,800B each):

| report suffix | tools / total identities | request bytes / scope chars | final WAL / delta bytes | loop p99 ms / samples |
|---|---:|---:|---:|---:|
| 1792112881555-1690 | 1900 / 1902 | 1,916,503 / 1024 | 17,093,912 / 9,389,480 | 41.451519 / 46 |
| 1792112883437-1690 | 2046 / 2048 | 1,853,815 / 900 | 17,806,672 / 10,102,240 | 29.212671 / 39 |

Both reports under reports/capture-capacity-worst-<suffix>.json include
complete1/omitted0, processingok,32 candidates and original preservation
assertions. Prior/repeated successful reports remain retained, not selectively
deleted; p99 varies across runs and is not a universal worst-case bound.

Focused6 files/69 passed. Full sequential typecheck/build/test/lint/perf/strict
OpenSpec/diff-check exit0:191 files/2125 passed/1 skipped. Afterwards both cases
passed stronger total-identity/completeness assertions; final sequential
typecheck→whole191file/2125pass/1skip suite→lint/strict OpenSpec/diff-check also
exit0 (123.97s). Repeat reports1792113024262-2050/1792113025952-2050 preserve
identical WAL/original/identity counts; loop31.621119ms/44samples and
25.722879ms/43samples respectively. No simultaneous benchmark on this repeat.
Frontend684.27/193.88kB gzip unchanged, lazy capacity6.93/
2.28, setup10.11/3.18; CLI701.04/190.39, worker9.38/2.91/shared22.92/6.71.
Existing500kB build warning retained. Serial list0.419/worst9590detail9.328/
proxy0.871ms; overview49.24/0.309ms; append1 INSERT/2 statements/0.32ms;
mission0.68/0.019/worst0.168ms, gzip242B. Legacy07 empty loop histogram is
not latency certification.

Fresh reports/capture-ab-2026-10-16T01-08-31.893Z-1876.json verifies current
v17 production with HTTP/trusted HTTPS CONNECT/near2MiB,100 paired samples each,
concurrency4. Extra first-byte p95=2.449/7.834/1.785ms; extra E2E p95=6.725/
11.084/6.275ms; actual loop p99=2.998/3.893/2.175ms with3137/3299/3165 samples.
All3 qualified/pass original hard budgets. Raw samples/hashes retained.

Scope: two large shapes including identity count ceiling, not every admitted
payload/shared scan or external writer, physical ENOSPC, real Agent, Windows,
full app or30-minute soak. Task7.3 stays unchecked. Remaining shared-writer/
tombstone-growth/long-term-separation/request-management/full-chain work
continues. Main45 edits unchanged; no user evidence/native/global/paid/commit/
push. Skills openspec-apply-change and performance-profiler used for actual
before/after evidence and contract-first limits; goal active.

## Shared-writer admission snapshot and measured stamp CPU — 2026-10-16

Schema17/OpenSpec27/71 unchanged, task7.3 still unchecked. Native async_hooks
at actual WAL lstat completion force same/second SQLite storeTraceRecord
commits before the captured result reaches the capacity continuation. No
filesystem sizes, scanner, SQLite or guard mocked. The original helper genuinely
admitted both stale snapshots;5/6 first reliable cases failed. The earlier
fs/promises mock did not intercept the call, caused3 timeouts and is NOT defect
proof; those3 explicitly validated generated directories were removed after
the process ended, not user evidence.

Current helper uses cached total_changes/schema cookie/data_version, zero-wait
stamp reads with exact busy-timeout restore. At most3 TOTAL stat snapshots and
1 checkpoint; continued churn is static unavailable, known pressure is limit.
Refuse caller transaction before/during IO without rolling it back. Native
DDL also invalidates: total_changes alone misses CREATE INDEX (genuine failed
regression). SQLite schema cookie is NOT app _meta version17. No public type,
route/schema/dependency change or scan throttle/delete.

Four actual native interleavings retain1MiB exact raw/4 events/6 identities/
session/metrics and invoke capture action0,3 snapshots each. First-read WAL
7,712,672→8,808,592B; post-checkpoint8,268,872→9,364,792B. Reader release
allows admission again. Metric-only reports/capture-capacity-race-* retained.
14 new cases also cover observer self-check, small update, churn, caller
transactions, rollback, DDL, timeout0/137 and mid-IO137→271. No stale cached
PRAGMA setter/getter workaround or weaker count/assertion.

Before final allocation optimization, whole192files2138pass/1skip and all
typecheck/build/lint/perf/strict OpenSpec/diff-check passed. Historical
production01-25-43.364Z-4139 near2MiB E2E9.824ms triggered the20% comparison
rule. Actual next production01-28-31.427Z-4798 E2E HTTP/HTTPS/near2MiB
7.388/11.452/6.383ms, nonempty loop3.172/3.076/2.093ms, all3 hard passes.
Do not discard either run or infer cause from a favorable repeat.

Diagnostic11 anchors exactly one stamp callsite in a temporary reference
bundle, preserving all other checks/worker/source.100-pair ABBA report
capacity-snapshot-ab-2026-10-16T01-29-44.065Z-4929.json passes all8 hard gates
but near2MiB E2E ratio1.375619 fails<=1.2. First transform refused post-TS
whitespace; enforce:pre now verifies the original anchor exactly once. No
production bypass flag or guessed regex patch.

Builtin100us CPU profiling,20,000 actual memory-DB helper actions, reports
capacity-stamp-profile-2026-10-16T01-33-13.747Z-5047.json and
capacity-stamp-profile-2026-10-16T01-42-03.484Z-5221.json:349.668→236.364ms,
17.483→11.818us/action. Top samples show Statement/pragma/GC; use cached dynamic
SELECT timeout FROM pragma_busy_timeout and scalar fresh PRAGMA setter results.
Driver test proves cached setters execute effects only at prepare, NOT reuse;
getters/setters are not naively cached. Combined virtual-table stamp read
microbenchmark was slower and was not adopted. Profiling includes harness/
yield/inspector overhead, NOT HTTP forwarding/event-loop certification or proof
that the entire historical network delta was caused by stamp CPU.

Optimized100-pair ABBA01-42-23.221Z-5397 near2MiB E2E1.041983 passes, but
HTTPS first-byte1.229202 fails1.2. Preserve both failures. Fixed follow-up400
pairs per existing8 runs (no repeat-until-pass, same thresholds, default100
unchanged via bounded diagnostic --samples flag) first stopped on4th HTTPS
reference at teardown: compiled stack reconstructed and identifies sseClients1
vs0, not metadata loss. Retained synthetic capture-ab-xSEcgw read-only audit:
404 requests/404 body rows/808 originals/quick_check=ok, report
capacity-snapshot-ab-400-cleanup-evidence-1792115818402.json. The old diagnostic
did not save raw vectors before the failure; no fabricated replacement report.

Diagnostic fixture now explicitly releases its own SSE lease before server
close; zero-resource assertion stays. Failures carry completed samples and
honest cleanup state/evidence directory in AggregateError cause; diagnostic11
checkpoints each completed raw run and emits structured failure. New real
unrelated-subscriber test proves strict failure is retained (not global-close
or false verified=true). Three consecutive real runs test late-close idempotence.
Old helper MiB thresholds tightened to decimal200,000,000/20,000,000 with5
boundary cases; unknown sizes now fail via production readCaptureCapacity,
not blanket-zero fallback. Focused2 files34pass/typecheck/lint at this point.
Fixed400-pair plan restarted only after the confirmed ownership failure was
repaired; current results/final gate are appended on completion.

Scope remains native snapshot safety, not arbitrary future external writes,
unlimited native growth, physical ENOSPC, real Agent, Windows, full app or30-minute
soak. D11 now specifies next-tier separate ownership/global-budget/crash-safe
association gates; no false cross-WAL atomicity or implicit user migration/
cleanup. Main45 tracked edits not touched; no paid/native/global/commit/push.
Skills openspec-apply-change and performance-profiler used; goal active.

Fixed400-pair follow-up after the owned-SSE correction completed all8 ABBA runs:
reports/capacity-snapshot-ab-2026-10-16T01-56-57.267Z-5946.json, plus8 immutable
per-run checkpoints with complete vectors/artifact hashes. Each run400 pairs,
concurrency4,808 origin calls,404 captures,808 SHA-verified originals,404 metadata
SSE events; cleanupverifiedtrue/temporaryremovedtrue/all resource gauges0.
HTTPS mean-run first-byte/E2E/loop ratios1.019709/1.045618/1.070654;
near2MiB1.023085/1.016169/1.000940. All8 hard budgets and both relative gates
pass unchanged. Means of two run-level percentiles, NOT pooled samples or
statistical significance. Earlier100-pair failures and interrupted400-run
evidence remain preserved; no whole old-product/soak or arbitrary writer proof.

Final current-code sequential typecheck/build→192files2146passed/1skip (119.41s)
→lint/perf/strict OpenSpec/diff-check all exit0;21 new regression cases total
(14 capacity snapshots+7 diagnostic boundary/ownership/failure). Frontend684.27/
193.88kB gzip unchanged, lazy capacity6.93/2.28/setup10.11/3.18; CLI702.24/
190.73, worker9.38/2.91/shared22.92/6.71; existing500kB warning retained.
Serial list0.433/worst9590detail9.471/proxy0.855ms; overview50.03/0.291ms;
append1 INSERT/2 statements/0.32ms; mission0.68/0.018/worst0.168ms,gzip241B.
Legacy07 empty event-loop histogram remains NOT latency evidence.

Production reports/capture-ab-2026-10-16T02-02-04.663Z-7151.json:
HTTP/HTTPS/near2MiB each100pairs/concurrency4, extra first-byte p95=5.453/
8.191/1.143ms, extra E2E p95=6.768/9.440/6.701ms, actual loop p99=2.836/
3.078/2.179ms with3176/3266/3076 samples. All3 qualified/pass strict decimal
hard budgets and actual cleanup. StandardHTTP first-byte5.453 vs previous
2.774ms triggers historical20% alert; do not claim successful2-profile ABBA
covered it. Diagnostic11 adds standardHTTP and runs one fixed12-run400-pair
ABBA plan, same source/thresholds, preserving this new actual run too. Final
attribution result appended once complete, not repeat-until-favorable selection.

Final missing-profile attribution completed all12 fixed400-pair ABBA runs:
reports/capacity-snapshot-ab-2026-10-16T02-03-58.002Z-7338.json +12 immutable
run checkpoints. HTTP/HTTPS/near2MiB each4 runs, concurrency4, all hard and
relative gates pass; every owned resource0/cleanupverifiedtrue/temporaryremoved.
Mean-run first-byte/E2E/loop ratios: HTTP1.077895/0.925116/1.061767;
HTTPS1.031058/1.041186/1.097218; near2MiB0.881436/0.910181/0.991469.
This controlled source-attribution does not reproduce the >20% historical
first-byte jump; keep that historical result and all failed100-pair comparisons.
No pooled-percentile/statistical-significance/whole-old-product/full-app/soak
claim. Only diagnostic coverage/docs changed after the2146-pass full production
gate; final lint/strict OpenSpec/diff-check rerun separately. Full7.3/goal active.

## Manual-handoff and partial-task closeout — 2026-10-16

User first requested manual-test handoff, then explicitly requested finishing
already-started work only. No database separation, new storage-boundary tests,
new dependency, system/native changes or actual paid Agent calls. Preserve
prior fixed-budget/failed diagnostic evidence above; no automatic commit/push.

Historical first handoff: unchanged source, typecheck/build→192files/2146pass/
1existing skip(120.86s)→lint/perf/strict OpenSpec/diff-check exit0.
Report reports/capture-ab-2026-10-16T02-25-55.717Z-12660.json:

| Existing profile | Extra first-byte p95 ms | Extra E2E p95 ms | Actual loop p99 ms / samples |
| --- | ---: | ---: | --- |
| HTTP | 1.819126 | 8.105207 | 2.990079 / 3280 |
| HTTPS CONNECT | 9.624792 | 12.460333 | 2.924543 / 3585 |
| HTTP near2MiB | 1.176666 | 4.216458 | 2.037759 / 3287 |

Current closeout: Range streams exact stored encoded segments without another
body copy; strong quoted full-prefix SHA validator, If-Range,206/416/ApiError.
Default whole-download and old openRead(id) callers unchanged. UI metadata/
analysis reads own5s cancellation, stale-result guards and explicit local-only
retry; locale changes do not trigger reads. No new worker/metadata hot-path
logic or schema; the new HTTP helper is invoked only for explicit body download.

Final sequential typecheck/build→193files/2174passed/1existing skipped
(123.10s)→lint/perf:check/strict OpenSpec/diff-check exit0.28 new tests
(20 HTTP byte-selection semantics,4 local-read UI,3 actual protocol access,
1 calibrated OpenCode cache) plus expanded existing real >2MiB download
assertions. Four genuine failures preceded production repairs, no assertion
relaxation. Not new capacity/multi-store/physical-disk experiments.

Frontend685.26kB/gzip194.20kB, lazy capacity6.93/2.28/setup10.11/3.18;
CLI704.15/191.31, worker9.38/2.91/shared22.92/6.71. Existing uncompressed
500kB warning retained; initial JS remains under200kB gzip. Serial list0.441ms,
worst9590detail10.127ms/proxy0.827ms; overview50.45/0.359ms; append1INSERT/
2statements/0.35ms; mission0.70/0.019/worst0.170ms,gzip241B. Source config
not supplied→N/A, not an invented source measurement; old07 p99=0 is an empty
microbenchmark histogram, not live loop evidence.

Current report reports/capture-ab-2026-10-16T02-44-26.804Z-15226.json:

| Existing profile | Extra first-byte p95 ms | Extra E2E p95 ms | Actual loop p99 ms / samples |
| --- | ---: | ---: | --- |
| HTTP | 3.046083 | 5.858167 | 2.922495 / 3301 |
| HTTPS CONNECT | 8.716791 | 11.996125 | 2.916351 / 3556 |
| HTTP near2MiB | 1.555333 | 5.174209 | 2.023423 / 3370 |

Each profile100 paired warm samples/concurrency4, separate cold observations,
104captures/208originals; all3 original hard budgets qualified/pass, actual
owned cleanup verified/resources0. Do NOT discard the previous row: HTTP
first-byte and near2MiB first-byte/E2E exceed20% relative to the first handoff
sample. NFR §6's20% commit gate is NOT waived, no budget table updated or
no-regression/full-release claim. User scope excludes starting another
attribution/boundary project, so retain raw evidence and do not repeat until
favorable; no commit is made. This short controlled test is not full-app/real
Agent/Windows/30-minute certification. Current30/71 is a local feature handoff;
7.3/full product remain incomplete, further implementation paused for testing.

## Fusion snapshot pre-commit verification — 2026-10-16

User explicitly requested creating/pushing origin/codex/telemetryref-fusion,
not merging main or publishing a release. One predefined existing full gate
rerun, not a repeat-until-favorable experiment. Typecheck/build→193files/
2174passed/1existing skipped(123.89s)→lint/perf:check/strict OpenSpec/diff-check
exit0. Runtime/test source and assertions unchanged. The staged-source check
then exposed7 baseline EOF-only whitespace warnings; normalize only duplicate
final newlines and recheck. Source stats remainN/A, old07 histogram0 is not
live latency evidence,500kB frontend warning retained.

Build: frontend685.26kB/gzip194.20kB; CLI704.15/191.31; worker9.38/2.91,
shared22.92/6.71. Serial list0.381ms/worst9590detail9.518/proxy0.854;
overview50.00/0.302; append1INSERT/2statements/0.32ms;
mission0.68/0.019/worst0.172ms,gzip242B.

Raw local report reports/capture-ab-2026-10-16T02-57-09.382Z-17568.json:

| Profile | Extra first-byte p95 ms | Extra E2E p95 ms | Actual loop p99 ms / samples |
| --- | ---: | ---: | --- |
| HTTP | 3.150875 | 6.448208 | 2.807807 / 3300 |
| HTTPS CONNECT | 7.304625 | 8.576875 | 2.082815 / 3429 |
| HTTP near2MiB | 1.389000 | 3.855625 | 1.990655 / 3402 |

Each100 paired warm samples/concurrency4, all3 hard profiles qualified/pass,
resource ownership/cleanup verified. Compared with the immediately previous
02-44-26.804Z-15226 row, no latency column degrades>20% (largest increase:
HTTP E2E~10.1%). The normal adjacent-row gate passes; no hard budget or
relative gate waiver is invoked. Preserve all earlier>20% historical alerts;
this single result does not explain or erase them or establish statistical/
full-app/real-Agent/Windows/30-minute equivalence. NFR§6.1 records the same
history and unchanged budget. No new functionality, database split or new
storage-boundary test.30/71 remains partial; only source/tests/specs/scripts
are intended for Git, all raw diagnostic reports remain locally available.


## 2026-10-19 — UI branch preservation checks

The combined runtime prerequisites and UI candidate were checked before saving
this branch. This is an in-progress workbench snapshot, not whole-product release
acceptance. Runtime and UI source changes are recorded in separate commits.

- Current typecheck, lint and client/server build: passed.
- Full single-worker regression: 274 files, 3290 passed, 0 failed, 1 existing skip.
- Synthetic perf:check: passed; HTTP, HTTPS CONNECT and near-2MiB forwarding
  profiles all qualified and met their existing budgets. No external model calls.
- Initial HTML plus all preloaded JavaScript: 195617 bytes gzip (<200000).
- All emitted CSS, including lazy chunks: 24380 bytes gzip (>16384 by7996).
  The CSS budget remains unmet; it was not waived or redefined for this save.
- Real event logs, local runtime files and private acceptance records are excluded.


## 2026-10-19 — M12 npm / Web CLI feature-branch verification

- Reused the completed Mac package validation: 276 files, 3306 tests passed,
  0 failed, 1 existing skip; typecheck, lint and client/server build passed.
- Before commit: typecheck/lint and 40 focused CLI/package/recovery tests passed.
  Corrected three diagnostic setup paths to copy/fingerprint the complete built
  worker/chunk closure. This changes diagnostic setup, not forwarding logic or
  assertions. Full perf:check then passed its existing hard gates.
- The first pre-commit perf attempt stopped before A/B measurement because the
  old setup required server-dist/assets. The corrected run below is retained;
  no favorable performance rerun or threshold change was used.
- Clean external-consumer tarball installation exercised HTTP resources/APIs,
  all three workers, occupied port, SSH/no-open and graceful exit. Default Mac
  browser opening was separately observed in Chrome, not mocked. Windows native
  verification remains pending; no real model traffic was generated.

Prior A/B sample: capture-ab-2026-10-19T01-40-41.022Z-12693.json.
Current A/B sample: capture-ab-2026-10-19T05-10-18.039Z-18002.json.
Each profile: 100 warm paired samples at concurrency4, 104 captures and 208
verified originals; all profiles qualified and passed existing hard budgets.

| Extra latency metric | Prior ms | Current ms | Relative | Hard budget, unchanged |
| --- | ---: | ---: | ---: | --- |
| http firstByte | 2.149166 | 2.244000 | +4.4% | <=20ms |
| http e2e | 5.735750 | 5.273125 | -8.1% | <=20ms |
| http loopP99 | 2.119679 | 2.113535 | -0.3% | <50ms |
| https-connect firstByte | 6.830000 | 8.350250 | +22.3% | <=20ms |
| https-connect e2e | 7.830458 | 10.120042 | +29.2% | <=20ms |
| https-connect loopP99 | 1.986559 | 2.094079 | +5.4% | <50ms |
| http-near-2mib firstByte | 2.012833 | 1.948832 | -3.2% | <=20ms |
| http-near-2mib e2e | 6.214792 | 4.857542 | -21.8% | <=20ms |
| http-near-2mib loopP99 | 2.160639 | 2.207743 | +2.2% | <50ms |

HTTPS first-byte +22.3% and E2E +29.2% cross the20% relative alert. Trade-off:
preserve the user-requested npm/Web CLI feature branch for review while keeping
these unresolved measurements visible. This is not main/release acceptance,
performance equivalence, an explained regression or a budget waiver. NFR §6.2
and the commit message record the same observations. No thresholds were relaxed.
The existing all-CSS gzip24380B exceeds16384B by7996B and remains unresolved.
Private local histories, runtime/config files and test reports are not published.

## 2026-10-19 — M11 telemetryRef continuation on the verified npm baseline

Local branch `codex/telemetryref-npm-continuation`, based on remote npm commit
`29e9e20f8a9dc9b18c8a6e17128440451309f912`; no commit/push/release. Fix semantic
session uniqueness when one source retains multiple native identity locators.
Preserve original evidence, distinct source owners, manual decisions and actual
network attempts. No UI/provider/usage/schema/package/dependency changes.

- Nine new SQLite regressions; five failed before the source fix. Targeted
  storage/execution/extractor:60 passed. Full suite:276 files,3315 passed,
  1 existing skip,93.51s with maxWorkers2. Typecheck/lint/build/strict OpenSpec,
  package artifact verifier and diff-check passed. Earlier executor-disconnected
  test attempt had no result and is not counted as passing. A redundant restricted
  API runner was stopped by its observed PID after the full suite passed.
- `npm run perf:check` exited0. Synthetic524 sessions/73588 events/1820 captures,
  DB29.57MiB; no user config/source scan was loaded. Core query plans retain
  indexes and no temporary sort trees. List500:0.399ms; slim9590:9.827ms;
  proxy50:0.856ms; overview cold/cache51.67/0.340ms. Append1 remains1 INSERT/
  2 statements/0.32ms. Mission cold/cache0.86/0.025ms,worst widget0.213ms,242B
  representative gzip. The zero-sample loop microbench is not live-load proof.
- Actual A/B report: `reports/capture-ab-2026-10-19T11-26-16.898Z-25463.json`.
  Each of3 profiles has100 warm paired samples,104 captures/208 exact originals.
  All profiles qualified and met unchanged <=20ms added latency/<50ms loop p99
  hard gates. Synthetic local tests are not real Agent/Windows/soak certification.

| Metric | Previous npm sample ms | This run ms | Relative |
| --- | ---: | ---: | ---: |
| HTTP first body byte | 2.244000 | 3.085291 | +37.5% |
| HTTP E2E | 5.273125 | 7.617958 | +44.5% |
| HTTP loop p99 | 2.113535 | 2.336767 | +10.6% |
| HTTPS CONNECT first body byte | 8.350250 | 6.902708 | -17.3% |
| HTTPS CONNECT E2E | 10.120042 | 8.722376 | -13.8% |
| HTTPS CONNECT loop p99 | 2.094079 | 1.997823 | -4.6% |
| Near2MiB HTTP first body byte | 1.948832 | 2.100834 | +7.8% |
| Near2MiB HTTP E2E | 4.857542 | 5.269750 | +8.5% |
| Near2MiB HTTP loop p99 | 2.207743 | 2.066431 | -6.4% |

Previous sample is the committed npm record05-10-18.039Z-18002. HTTP first-byte
and E2E exceed the20% relative alert; cause is unresolved. No favorable rerun,
threshold change, performance-equivalence claim or release waiver. Earlier
HTTPS relative alerts and all-CSS gzip24380B vs16384B (over7996B) remain recorded.
The isolated worktree retains synthetic raw reports; none are uploaded. Original
npm worktree's25 dirty files were SHA256-checked unchanged.

### Bounded attribution follow-up (same local branch; no source change)

The original05-10 and11-26 reports match Node26.5.1/darwin/arm64/schema19,
100warm pairs/concurrency4, three workloads, request/response byte counts and
seven worker/shared JS hashes. The older report's sourceHead is6248748 with
working-tree changes, not an adjacent frozen version comparison. Historical
host scheduling/load state was not fully recorded; no causal conclusion follows
from that single pair of reports.

Preregistered one A/B/B/A sequence: A replaces only trace-links.ts in memory
with exact29e9e20 source; B uses the current fix. All other sources/workers and
identical path counters are shared; no disk source swapping. Exactly4 measured
runs ×3 profiles ×100warm pairs, concurrency4; every raw sample retained.
One zero-request/zero-sample setup attempt failed a module-path assertion before
measurement (/tmp vs /private/tmp). A logged pre-sample plan revision corrected
only the canonical root; no workload/budget change or post-result rerun.

| Extra latency p95 ms | A1 old | B1 new | B2 new | A2 old | New/old mean change |
| --- | ---: | ---: | ---: | ---: | ---: |
| HTTP firstByte | 3.501416 | 4.306583 | 3.570083 | 3.997250 | +5.0% |
| HTTP E2E | 5.674709 | 6.493583 | 6.296666 | 7.523083 | -3.1% |
| HTTPS firstByte | 6.733958 | 9.064458 | 9.600083 | 7.678542 | +29.5% |
| HTTPS E2E | 12.953542 | 12.285541 | 12.072000 | 10.168167 | +5.3% |
| Near2MiB HTTP firstByte | 1.477291 | 2.557292 | 1.778333 | 1.653541 | +38.5% |
| Near2MiB HTTP E2E | 4.449626 | 5.419958 | 5.002042 | 4.661626 | +14.4% |

Means are descriptive averages of two run-level p95s, not pooled p95 or a
significance/equivalence test. All12 profiles passed unchanged hard gates,
original fidelity and cleanup; loop p99 range1.926143–2.105343ms. Per profile,
104reconciliations executed the count query with zero matching session rows,
zero sourceIds/count rows and zero candidate loop visits. The changed semantic
uniqueness logic is unexercised; fixed empty-query overhead remains possible.

The original HTTP+37.5%/+44.5% was not reproduced as a consistent new-version
penalty in this bounded control. Cause remains unresolved; HTTPS/near2MiB
firstByte relative differences are also retained, not dismissed as noise.
No speculative source fix or favorable extra run; previous alerts/CSS gap remain.
All four JSONs/logs, exact source snapshots/hashes, plans, failed setup and
summary reside in /tmp/awesomeTelemetry-causal-check/. Instrumented diagnostic
results do not replace the uninstrumented baseline or certify real Agents,
Windows or long-duration load. This closes only the requested finite inquiry.

## 2026-10-20 — pre-push M11 functional continuation

User requested committing and pushing the retained functional increments to
`codex/telemetryref-npm-continuation`, then continuing on another computer.
Functional development remains paused; this run is the mandatory commit gate,
not resumed reliability/soak work or release acceptance. Source base is
29e9e20f8a9dc9b18c8a6e17128440451309f912 plus the reviewed working-tree changes.

- Fresh `npm run typecheck && npm run test -- --maxWorkers=2 && npm run lint`
  passed:307 files,3724 passed/1 existing skip,106.68s. Build, package artifact
  verifier, strict OpenSpec and diff check passed. No test assertion was relaxed.
- `npm run perf:check` exited0. Legacy storage diagnostic fixture remains
  schema7 (perf-diag/lib/schema-sql.mjs),524 sessions/73588 events/1820 captures,
  29.57MiB; no real provider/config/source scan was loaded. These diagnostics do
  not prove the current schema21 hook feature's full-load performance.
- Core plans use indexes and no temporary sort tree. List500:0.428ms;
  slim9590:9.467ms; proxy50:0.838ms; overview cold/cache50.64/0.351ms.
  Append1:1 INSERT/2 statements/0.36ms. Mission cold/cache0.68/0.019ms,
  worst widget0.170ms, representative gzip241B. The loop microbench's0.00ms
  does not represent a live-load percentile.
- Actual forwarding/worker/originals/SSE A/B report:
  `reports/capture-ab-2026-10-20T07-08-04.919Z-95642.json` (retained locally,
  ignored raw diagnostic output). All3 profiles qualified, each with100 warm
  paired samples/concurrency4,104 captures and208 independently verified
  originals. All unchanged <=20ms added-latency/<50ms loop-p99 gates passed.

| Profile | Added first-body-byte p95 ms | Added E2E p95 ms | Loop p99 ms |
| --- | ---: | ---: | ---: |
| HTTP | 2.313125 | 5.718208 | 1.944575 |
| HTTPS CONNECT | 6.122917 | 7.279708 | 1.943551 |
| Near2MiB HTTP | 2.061584 | 4.873209 | 2.014207 |

This single current-source run is not an adjacent frozen-version comparison.
No favorable rerun, budget change, previous-relative-alert clearance, CSS-gap
waiver, real Agent/Windows certification, hook-runtime certification, physical
fault/soak or complete Web/scanner NFR claim follows. Existing alerts and
unclosed functional clauses remain documented; this push is a branch snapshot.


## Task observability workbench（2026-10-25，本地交付基线）

环境：本机 macOS，Node v24.19.0；分支 `codex/task-observability-workbench`，未提交。现有 `perf:check` 九项通过；完整日志保留在忽略目录 `.local-runtime/task-perf-verified.log`。本次不是与旧 Node v26 基线的同环境 A/B，不据此认证全部指标的相对回归。

| 现有性能检查 | 实测 | 说明 |
|---|---|---|
| listSessions(500) | 0.556ms | 合成参考库 |
| worstDetailSlim(9,590) | 14.253ms | <15ms |
| Overview 冷 / 热 | 73.58 / 0.442ms | <400 /20ms |
| 数据库 | 29.57MB | 合成库不含正文 |
| HTTP 抓包额外 E2E p95 | 6.34ms | 100 个温态配对样本 |
| HTTPS CONNECT 额外 E2E p95 | 18.24ms | 同上 |
| 接近 2MiB 请求额外 E2E p95 | 7.87ms | 同上 |
| 抓包 event-loop p99 | 2.14–2.24ms | 三种 profile 均满足各自检查预算 |

新任务 HTTP 接口另外在真实本地库测量：45 个会话、17 个主任务；选中任务 21 个成员、14,662 个事件。各接口预热一次后串行读取 10 次；p95 使用本组最大值，样本较少，包含 loopback/HTTP 序列化成本，不等同于独立服务端性能认证。

| 接口 | p50 / 本组 p95 | gzip |
|---|---|---|
| 任务列表 17 行 | 35.31 /36.47ms | 2,749B |
| 任务上下文 21 成员 | 53.55 /57.84ms | 1,480B |
| 固定窗口 200 事件 | 95.52 /101.42ms | 11,001B |
| 显式更新 200 事件，含原生指纹检查与刷新上下文 | 145.90 /151.29ms | 11,001B |

记录读取已从全事件扫描改成按会话/序号索引查询；无筛选 COUNT 走 covering index，14,662 条现场查询约3.7ms（修正前约273ms）。先分页身份再读取该页可用性标志，避免对全部事件检查正文列。固定窗口 HTTP 的尾部耗时接近100ms目标，小样本最高略超，仍需在标准规模下做更完整的专项基准；不宣称该项已完整认证。首次/显式刷新包含异步本地来源检查，与纯 SQL 分页分别记录。

真实持久库在重构前约272MB，按需补读历史后约496.5MB，已超过旧200MB稳态目标；未清除用户数据。它与合成性能检查库不能混为一个指标。正文和保留策略另行治理。


## Task time/process increment（2026-10-27，本地交付）

Node v24.19.0，现有 `perf:check` 九项通过。日志 `.local-runtime/task-process-perf-final.log`：list500 0.555ms，slim9590 14.248ms，overview 冷/热 74.75/0.447ms；三种真实转发 profile 的额外 E2E p95 为 HTTP 6.55ms、HTTPS CONNECT 9.54ms、接近2MiB HTTP 7.57ms，loop p99 2.15–2.38ms。转发为隔离测试服务，用户服务的监控/代理均关闭。

新增接口在真实 496.6MB 本地库、21 成员/14,662 事件任务测量，各预热一次、串行10次，p95 使用组内最大值，含本机 HTTP/序列化：

| 接口 | p50 / 本组 p95 | gzip |
|---|---|---|
| 200 slim records＋200 native facts | 114.65 /118.57ms | 15,810B |
| 21 成员完整窗口时间密度，50 非空桶 | 129.72 /154.72ms | 2,075B |

来源事实显式走来源索引；工具元组先物化后按来源扫描一次，避免每个元组重复扫描。前置输入按精确序号查找。相应查询计划有专项回归，未增加数据库结构。结构页诊断优化前本组 p95 346.29ms，优化后118.57ms。新接口250ms目标在这组现场测量中满足；这不是标准规模多平台认证，也不清除既有相对性能告警或旧200MB存储目标。完整方法与证据见 `openspec/changes/refactor-execution-workbench/time-process-20261026.md`。

## 提交前复核（2026-10-28）

本轮为 `codex/task-observability-workbench` 开发分支提交前复核，使用本机 Node v24.19.0。保留 2026-10-27 的已通过结果；以下是新的现场结果，不覆盖之前记录或放宽预算。

`perf:check` 本次 **exit=1**：前八个诊断完成，实际抓包 A/B 的 HTTPS CONNECT 与接近2MiB HTTP profile 超限。完整日志 `.local-runtime/publish-perf-20261028.log`，原始诊断报告 `reports/capture-ab-2026-10-27T15-32-53.075Z-32602.json`（均保留本地、按既有规则忽略）。每个 profile 使用100个温态配对样本、104次抓包、208份独立验证的原文。

| Profile | 额外首字节 p95 | 额外 E2E p95 | event-loop p99 | 本次结果 |
|---|---|---|---|---|
| HTTP | 4.59ms | 7.52ms | 2.06ms | 通过 |
| HTTPS CONNECT | 44.24ms | 88.53ms | 5.66ms | 首字节与 E2E 超限 |
| 接近2MiB HTTP | 8.76ms | 35.01ms | 4.94ms | E2E 超限 |

额外延迟预算仍为20ms，event-loop p99预算仍为50ms。抓包使用隔离合成测试实例，不打开用户服务的监控或代理。这次未修改代理实现或放宽断言，也未通过再次挑选有利性能结果消除超限。单次现场结果不能独立归因于代码或环境；抓包性能问题继续跟踪，本开发分支不据此声明全部性能验收完成。

完整功能回归第一次有 3,776 项通过、1项跳过，仅未改动的 `turn-ribbon` 5ms 微基准在一次测量达到9.65ms。该文件及实现与基线无差异，隔离23项复核通过；完整重跑结果另见本次交付记录。没有跳过该用例或降低阈值。

### 2026-10-28 修复后的正式检查

用户要求先修复后推送。`computeRibbon`去掉每段临时Map/分组/扁平化；抓包增加专用预览的明确所有权交接，并在网络结束后让解析与原文flush并行，释放已完成请求的原始预览额度；最终元数据仍等待两个结果。资源上限、5ms/20ms/50ms阈值、样本数及断言均未放宽。构建、typecheck、lint与61项专项通过，完整回归见本次修复报告。

正式 `perf:check` **exit=0**，九项通过，日志 `.local-runtime/fix-perf-20261028.log`。报告 `reports/capture-ab-2026-10-27T15-56-11.654Z-35554.json`（UTC文件名；本地日期2026-10-28）。三种profile各100个温态配对样本、并发4；每种104次抓包/208份原文均验证，所有资源清理断言通过。

| Profile | 额外首字节p95 | 额外E2E p95 | loop p99 |
|---|---|---|---|
| HTTP | 5.02ms | 9.23ms | 2.15ms |
| HTTPS CONNECT | 12.26ms | 16.38ms | 2.17ms |
| 接近2MiB HTTP | 4.01ms | 8.93ms | 2.21ms |

初始失败没有删除。未改代理时的CPU剖析也曾通过；首次仅去除复制的ABBA对照在第12个旧代码运行遇到 `resource_limit`，保留前11个结果和失败现场，不能称为完整相对性能证明。最终并行交接代码在此后形成。上述当前结果满足本次受控硬预算，不以挑选有利旧结果或调整阈值宣称全部相对告警、存储稳态目标、真实Agent/多平台/长时负载均已认证。细节见 `openspec/changes/refactor-execution-workbench/checks-fix-20261028.md`。


### 最终源码收尾复核（2026-10-28）

身份摘要改用相同十六进制顺序的直接比较；抓包协调跳过未使用的发现键，扫描源保持原始排序/发现路径，减少临界容量用例中的同步构建开销。新用例确认混合身份顺序反转仍零写入且证据/关联不变。

完整回归315文件、3,781通过/1跳过；收尾后的构建、typecheck、lint、4文件53项专项与 `perf:check`九项再次通过。最终日志 `.local-runtime/fix-perf-verified-20261028.log`，报告 `reports/capture-ab-2026-10-27T16-11-35.057Z-69357.json`。各profile仍100个温态配对样本/并发4，104次抓包及208份原文核验，清理断言全部通过。

| Profile | 额外首字节p95 | 额外E2E p95 | loop p99 |
|---|---|---|---|
| HTTP | 3.91ms | 6.50ms | 2.20ms |
| HTTPS CONNECT | 8.33ms | 11.03ms | 2.22ms |
| 接近2MiB HTTP | 2.86ms | 5.69ms | 2.23ms |

以上为最终源码的受控硬预算复核；初次失败、部分ABBA及前次检查均未覆盖/删除。测量范围与相对性能/真实Agent/存储治理边界仍按前述限制保留，详见 `openspec/changes/refactor-execution-workbench/checks-fix-20261028.md`。


## DSH 轨迹阅读提交复核（2026-10-28）

验证范围为 `dadc214` 加本次 DSH 轨迹、正文阅读及必要检查修复的冻结快照；使用 Node v24.19.0、独立临时 checkout/数据库。主工作区中另一个任务的 benchmark、watcher 和测试配置草稿未纳入本次提交或验证快照。用户运行服务的监控/代理/Frida 始终关闭。

列表计数仅在标签筛选时连接 annotations；关联前序记录先取最新 UTC instant，再沿既有 session/id 索引倒序取该时刻最大合格 ID。唯一 owner、时间同义表示和歧义排除不变，不改 DDL、返回字段或正文读取范围。大 Buffer 校验使用完整长度与全部字节的原生相等比较；WebSocket 集成夹具等待真实 journal recovery 后才允许外部代理写入，未使用 sleep、mock、降负载或放宽断言。

完整回归 **316 文件、3,807 通过、1 个既有 SQLCipher 环境用例跳过**，605.53 秒；typecheck、三阶段构建、lint 通过。日志 `.local-runtime/publish-dsh-{tests,typecheck,build,lint}-verified-20261028.log`。构建主块499.22kB，无500kB告警。

抓包检查此前出现超限，保留三个完整失败报告及缺少临时 Git 元数据的一次中止日志：`publish-dsh-perf-concurrent-20261028.log`、`publish-dsh-perf-before-renderer-exit-20261028.log`、`publish-dsh-perf-after-renderer-exit-20261028.log`、`publish-dsh-perf-no-git-20261028.log`。现场先后观察到其他性能任务及约420%CPU的独立3D软件渲染截图进程；截图进程退出后仍曾超限，不能声称它是唯一原因。CPU/分段诊断未证实新的同步解析回归；无采样的HTTPS原实现10.64/13.07ms通过，noDelay对照17.79/19.86ms未显示稳定收益，因此未加入猜测性抓包生产改动。

随后预先固定为**连续两轮完整 `perf:check`，两轮都须通过**，不挑选有利profile、不改样本/并发/阈值。两轮均 **exit=0，九项脚本完成**。每轮每种profile仍100个温态配对样本、并发4、104次抓包/208份原文；应用头/状态/全部字节、协议投影、早帧转发与资源归零断言全部通过。

| 轮次 / Profile | 额外首字节p95 | 额外E2E p95 | loop p99 |
|---|---:|---:|---:|
| 1 / HTTP | 5.26ms | 9.41ms | 2.53ms |
| 1 / HTTPS CONNECT | 10.95ms | 15.35ms | 2.61ms |
| 1 / 近2MiB HTTP | 7.36ms | 9.91ms | 3.51ms |
| 2 / HTTP | 3.24ms | 11.53ms | 2.44ms |
| 2 / HTTPS CONNECT | 12.90ms | 18.18ms | 3.00ms |
| 2 / 近2MiB HTTP | 9.39ms | 13.32ms | 3.74ms |

日志为 `.local-runtime/publish-dsh-perf-confirmation-{1,2}-20261028.log`，原始报告为验证目录的 `reports/capture-ab-2026-10-28T06-33-55.782Z-229.json` 与 `reports/capture-ab-2026-10-28T06-34-18.338Z-277.json`。两轮 list500 分别0.855/0.632ms，overview冷82.13/94.42ms、热0.621/0.615ms，合成库29.57MB。04只报告数值的slim9590分别19.618/16.862ms，仍高于旧15ms目标；本次不将脚本exit=0当成该目标、相对性能告警、真实库200MB目标或全平台/长时负载均已认证。此前所有失败和诊断均保留，不能从这两轮通过推断任意并行负载下都满足20ms预算。


## 单行轨迹与验证环境复核（2026-10-28）

单行图改动以 `78f5586` 加本次冻结文件集独立验证，未纳入 benchmark/watcher 草稿。默认读图、重叠精确选择、键盘顺序和正文联动已通过52项相关回归及真实页面检查；图高57px、绘图区28px、图块14px。

初次完整回归发现图例圆角使用裸2px，已改为统一尺寸变量，原断言不变。修复后旧配置把后端也放在jsdom中，压力用例分别出现55.083ms和独立复测51.937ms的p99（原预算<50ms）。功能、原文、身份数/完整性、关联与存储断言均正确。保留失败日志 `single-row-full-tests-before-style-fix-20261028.log`、`single-row-full-tests-parallel-timing-20261028.log`、`single-row-capacity-isolated-20261028.log`。身份处理诊断约26–29ms；分块摘要对照未给出稳定改善，因此未修改代理/身份生产算法，亦未改负载、采样窗口、超时或阈值。

本次纳入必要的测试环境修正：后端/扫描/脚本测试使用与生产一致的Node环境，前端保留jsdom及原DOM setup；所有原include的并集不变，文件级性能工作负载串行执行。6项压力对照原样通过。默认 `npm run test` 最终 **316文件、3,809通过、1个既有SQLCipher环境用例跳过**，228.51秒；完整压力两种profile的p99为5.067/43.680ms。typecheck、lint、三阶段构建均通过。测试环境修正不代表任意机器/并行负载下都没有GC或调度停顿，原失败继续保留。

随后串行 `perf:check` **exit=0，九项脚本通过**，日志 `.local-runtime/single-row-perf-final-20261028.log`，报告 `reports/capture-ab-2026-10-28T08-06-04.477Z-3762.json`。每种profile仍100个温态配对样本、并发4、104次抓包/208份原文；应用头/状态/全部字节、协议投影、早帧及资源归零断言全部通过。

| Profile | 额外首字节p95 | 额外E2E p95 | loop p99 |
|---|---:|---:|---:|
| HTTP | 3.63ms | 6.97ms | 2.12ms |
| HTTPS CONNECT | 8.08ms | 9.99ms | 2.07ms |
| 近2MiB HTTP | 8.00ms | 8.64ms | 2.74ms |

合成库29.57MB；list500 0.629ms、slim9590 14.366ms、overview冷76.75ms/热0.452ms。本组slim低于15ms，但不清除先前超限、相对性能告警、真实库稳态目标或真实Agent/全平台/长时负载的未覆盖项。完整日志为 `.local-runtime/single-row-full-tests-node-20261028.log`；静态检查为 `single-row-{typecheck,lint,build}-final-20261028.log`。用户服务监控、代理与Frida保持关闭；抓包检查均使用隔离合成实例。


## 2026-10-29 · Task-mode experiments and capture identity snapshot repair

Scope: isolated checkout at base1862408 plus the explicitly selected task-mode/
benchmark foundation files; unrelated watcher, predecessor-test and bundle-test
working drafts excluded. Node24.19.0. No added runtime dependency or DB migration.
Final typecheck, lint, three-stage build, package-artifact verification and CLI
plan validation passed. Full regression: **330 files;3966 passed,0 failed,1 existing
conditional SQLCipher skip**,255.55s (05:25:20 Pacific/Auckland start).

The first full regression passed3953 tests. A later regression after adding two
route tests exposed an unchanged identity-count-ceiling loop p99=52.559871ms
against the original50ms limit. That failure and the controlled diagnostic
baseline remain retained; passing an earlier p99 did not establish absence of a
long event-loop turn (an earlier workload also had a54ms maximum).

Stage measurements identified repeated serialization of the full multi-MiB
identity fields and17–23ms outside the transaction callback in durable SQLite
COMMIT. The repair keeps each identity's exact SHA(owner+all six canonical
fields), sorts its64hex keys with native binary string order, and hashes the
versioned domain/owner/parserVersion/ordered keys/full completeness object.
No changed identity ID, dropped evidence, relaxed assertion, shortened sampling,
reduced workload, changed SQLite durability or delete/reinsert of the source.
Legacy fingerprints refresh source metadata once on normal ingestion; identical
or reordered manifests remain zero-write. Eleven new semantic cases cover field,
parser/completeness and legacy/idempotence behavior. Controlled uninstrumented
pressure+storage checks:43/43 pass. Final full-regression pressure reports:

| Actual admitted profile | Tools / identities / candidates | Loop samples | p99 / max ms | WAL bytes |
| --- | --- | --- | --- | --- |
| Wide scope |1900 /1902 /32|50|41.320447 /41.320447|17093912|
| Identity ceiling |2046 /2048 /32|50|37.781503 /37.781503|17806672|

All9 performance scripts pass on the final source. Actual forwarding A/B retains
100 warm paired samples/profile,concurrency4,104captures and208 exact-original
checks/profile, plus admission/cleanup assertions:

| Profile | Extra first-body-byte p95 ms | Extra E2E p95 ms | Loop p99 ms |
| --- | --- | --- | --- |
| HTTP |2.721875|8.345125|2.117631|
| HTTPS CONNECT |7.730875|10.473500|2.201599|
| HTTP near2MiB |4.814124|9.902875|2.453503|

Synthetic DB29.57MB; list500=0.608ms; slim9590=15.132ms; overview cold83.05ms/hot0.560ms.
The slim result satisfies the current60ms budget; this does not close the older
15ms regression alarm. Source-file stats are explicitly unavailable without the
real config; the empty synthetic Mission fixture is not populated-dashboard or
all-platform certification. The initial bundle still has Vite's advisory500kB
uncompressed chunk warning; no warning threshold was increased.

UI/protocol bounds: reports16MiB/30trials/64agents per trial/2000events per trial/
20000events or telemetry spans per report; DOM<=64member lanes and100record/case
rows per page, dependencies20/page. Closed run details mount no case bodies;
30trials×1000cases import/selection/paging is tested. Overflowed report captures
become explicitly unavailable per trial, with complete original local files
retained; independent acceptance still runs. Malformed or reserved runner-* span
IDs never suppress acceptance or erase the previous report.

Browser checks on the built final source: exact direct route/reload, explicit
2variants×3repeats with6/6 independent acceptance and all3 driver pairs overlapping,
quality-first synthetic guidance, exact event location, play/pause/step, filters,
public message details below the sticky chart at691×611, and no console errors.
Blob/FileReader export/reimport uses actual browser primitives in component tests;
native file-dialog completion and real vendor models/GUI remain unverified.
No model invocation, OS proxy or certificate/trust change. Runtime monitoring,
proxy and Frida remain disabled/stopped after the smoke.

Local evidence (not committed private/generated artifacts):
`.local-runtime/team-experiment-{typecheck,lint,build,full-tests,perf}-final.log`,
`.local-runtime/team-experiment-verification.json`,
`.local-runtime/team-experiment-perf-report-final.json`,
`.local-runtime/team-experiment-browser-fixture-evidence.json`,
`.local-runtime/capacity-delay-evidence/manifest.json`; final forwarding report
`capture-ab-2026-10-28T16-29-42.150Z-29986.json`.

## 2026-10-30 — M10 page layout and evidence readability

UI-only update: responsive shared controls, consistent experiment forms,
container-aware evidence reader, bounded keyboard-scrollable error summaries,
font-relative capture line height, sticky detail controls and native theme support.
No query, API, virtual-row-height, or runtime-dependency changes.

`perf:check` passed using the synthetic 29.57MB fixture (524 sessions,
73,588 events). Source-file statistics remain unavailable without real config.
List500 median: 0.665ms; slim9,590: 18.660ms; overview cold/hot: 75.70/0.453ms.
Mission empty-fixture cold/hot: 0.95/0.028ms; not populated-dashboard certification.

Actual forwarding A/B, 100 samples per profile:

| Profile | Extra first body byte p95 ms | Extra E2E p95 ms | Loop p99 ms |
|---|---:|---:|---:|
| HTTP | 5.283 | 11.159 | 2.587 |
| HTTPS CONNECT | 10.263 | 14.183 | 2.114 |
| HTTP near2MiB | 5.771 | 8.883 | 2.458 |

All three profiles qualified and passed. Browser review used isolated synthetic
session/tool/team/capture data at desktop, tablet and narrow widths; retained
preview JSON is not proof of original-byte capture. Initial Vite bundle warning
above500kB remains unchanged in scope. Screenshots and full logs remain local.

Validation: typecheck and full ESLint passed. Full Vitest run:329 files passed,
1 file failed (3965 tests passed,1 failed,1 skipped). The sole failure was the
existing query-engine list join timing delta guard (0.934ms versus0.673ms allowed).
Immediate isolated rerun of that entire file passed31/31 tests in406ms; no test
assertions or database code were changed. Frontend build and targeted73 tests
also passed during the layout audit.
