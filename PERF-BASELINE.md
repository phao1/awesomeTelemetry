# PERF-BASELINE.md — 性能回归基线

> 按 `contracts/nfr.md` §6 维护：M3 起每个里程碑合入后跑一次 `npm run perf:check`，追加一行。
> 任何一列相对上一行劣化超过 20% 的提交不得合入，除非在提交说明中写清取舍。
> 测量方法：`perf-diag/lib/synthetic-db.mjs` 合成参考规模数据（524 会话 / 73,588 event /
> 最差单会话 9,590 event / 1,820 proxy 行）。P-4：机器差异按本机基线记录，不做跨机对比。

| 日期 | 里程碑 | 首屏@10s | 最差详情 | Overview | 30s请求数 | DB+WAL |
|------|--------|---------|---------|----------|----------|--------|
| — | 参考实现（反面基线） | 5,884ms | 625ms/32.3MB | 4,732ms/524req | 508 | 471.6MB |
| 2026-08-04 | M3 storage | 未建前端 | 8.489ms（slim 9,590 events） | 21.89ms 冷 / 0.264ms 命中 | 未建前端 | 24.70MB（合成库，无 raw） |

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
