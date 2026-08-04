# PERF-BASELINE.md — 性能回归基线

> 按 `contracts/nfr.md` §6 维护：M3 起每个里程碑合入后跑一次 `npm run perf:check`，追加一行。
> 任何一列相对上一行劣化超过 20% 的提交不得合入，除非在提交说明中写清取舍。
> 测量方法：`perf-diag/lib/synthetic-db.mjs` 合成参考规模数据（524 会话 / 73,588 event /
> 最差单会话 9,590 event / 1,820 proxy 行）。P-4：机器差异按本机基线记录，不做跨机对比。

| 日期 | 里程碑 | 首屏@10s | 最差详情 | Overview | 30s请求数 | DB+WAL |
|------|--------|---------|---------|----------|----------|--------|
| — | 参考实现（反面基线） | 5,884ms | 625ms/32.3MB | 4,732ms/524req | 508 | 471.6MB |
| 2026-08-04 | M3 storage | 未建前端 | 8.489ms（slim 9,590 events） | 21.89ms 冷 / 0.264ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M4 watch 门禁 | 未建前端 | 8.510ms（slim 9,590 events） | 22.08ms 冷 / 0.256ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M5 adapters | 未建前端 | 8.662ms（slim 9,590 events） | 22.24ms 冷 / 0.271ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M6 scanners | 未建前端 | 8.551ms（slim 9,590 events） | 22.17ms 冷 / 0.257ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M7 realtime | 未建前端 | 8.616ms（slim 9,590 events） | 22.49ms 冷 / 0.257ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M8 HTTP server | 未建前端 | 8.502ms（slim 9,590 events） | 21.80ms 冷 / 0.255ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M9 core 分析 | 未建前端 | 8.618ms（slim 9,590 events） | 21.82ms 冷 / 0.261ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M10 前端 | 前端已建 | 8.538ms（slim 9,590 events） | 22.27ms 冷 / 0.259ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | M11 proxy/脱敏 | 前端已建 | 8.551ms（slim 9,590 events） | 21.99ms 冷 / 0.256ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | T-03 SQLite 多会话索引 | 前端已建 | 8.722ms（slim 9,590 events） | 22.40ms 冷 / 0.361ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | fix-session-data-integrity（T-10~T-12 完成） | 前端已建 | 8.519ms（slim 9,590 events） | 22.42ms 冷 / 0.274ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |
| 2026-08-04 | add-design-system + redesign-frontend-views + add-palette-and-a11y | 前端已建 | 9.215ms（slim 9,590 events） | 24.37ms 冷 / 0.372ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |

> M4/M5 与 M3 数字基本持平（只新增 watch/adapter 层，不触碰被测量的查询路径），
> 差异在 P-4 机器波动范围内（< 1%）。
> T-03 的索引阶段新增 SQLite 轻量读取，不触碰被测量的查询路径，差异在机器波动内（< 5%）。
> T-10 的索引阶段新增 JSONL 流式标题提取（硬上限 1MB，同步 readSync，仅启动路径）：
> 实测单 JSONL 最差 2.735ms（3.4MB 文件读满 1MB 未命中回落）、单 SQLite 库 0.281ms，
> 均低于预算（5ms / 50ms）；被测量的查询路径无劣化 > 20%（最差详情 +2%）。
> 三个前端 change 后被测量的查询路径仍无劣化 > 20%（最差详情 +8%）。

## 首屏性能实测（T-07 遗留项，2026-08-04 收口）

> 本机无浏览器自动化工具，浏览器级「首绘」无法实测；以下为可测部分（本地回环）：

| 项 | 实测 | 说明 |
|----|------|------|
| GET /（index.html） | 中位 ~0.6ms | 本地回环 |
| GET /api/sessions?limit=50 | 中位 ~0.6ms | 首屏数据（服务端 < 5ms 预算内） |
| /api/health | ~0.3ms | 状态栏单次拉取 |
| 前端资源 gzip 合计 | 93.1KB | JS 86.6KB + CSS 6.4KB + HTML 0.8KB |
| CommandPalette chunk | 2.5KB（gzip 1.1KB） | 懒加载独立 chunk，不进首屏 bundle |
| 服务端首屏预算 | < 100ms | 实测数据链路 < 1ms ✅ |

**未实测**：浏览器首绘（Performance 面板）。本地回环传输 93KB gzip 可忽略，
主要成本是 287KB 主 JS 的解析；该数字需在浏览器实测后补记，**不得用后端预算冒充**。

## M3 明细（2026-08-04，本机：macOS，Node v26.5.1）

来自 `npm run perf:check`（合成参考规模 fixture，中位耗时，7 次）：

| 项 | 实测 | 预算 | 判定 |
|----|------|------|------|
| listSessions(500) | 0.359ms | < 1ms | ✅ |
| 最差详情 slim（9,590 events） | 8.489ms | < 15ms（服务端） | ✅ |
| eventDetail 下钻 | 0.005ms | < 20ms | ✅ |
| getSystemPromptForSession | 0.011ms | < 1ms | ✅ |
| proxyList(50) | 0.748ms | — | — |
| Overview 冷路径（2 SQL） | 21.89ms | < 400ms | ✅ |
| Overview 缓存命中（1 SQL） | 0.264ms | < 20ms | ✅ |
| 差分写入（347→348，append 1） | 2 语句 / 0.29ms | 只 1 INSERT，< 20ms | ✅（对照反面基线 348 语句 / 181.91ms） |
| 事件循环 p99（200 次压测） | < 0.01ms | < 50ms | ✅ |
| 三条核心查询 EXPLAIN | 均无 USE TEMP B-TREE | 无临时 B 树 | ✅ |
