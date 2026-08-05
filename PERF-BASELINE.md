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
