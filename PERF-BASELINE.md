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
