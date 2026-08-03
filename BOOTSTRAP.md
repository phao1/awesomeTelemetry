# BOOTSTRAP.md — 0-1 开发计划

> 13 个里程碑（M0–M12）。每个里程碑独立可验收、独立可提交。
> **不要跳步。** 依赖顺序是按"下游需要上游的类型"排的，跳步会导致大量返工。

## 总览

| M | 模块 | 产出文件数 | 预估 | 关键风险 |
|---|------|-----------|------|---------|
| M0 | 脚手架 | ~12 | 半天 | better-sqlite3 编译 |
| M1 | trace-model | 2 | 半天 | 枚举写全 |
| M2 | storage 基础 | 6 | 1 天 | 索引与列常量 |
| M3 | storage 查询 | 5 | 1 天 | slim/full 三档切分 |
| M4 | watch 增量门禁 | 5 | 1 天 | 指纹要覆盖 `-wal` |
| M5 | adapters ×9 | 20 | 2–3 天 | token 语义 max vs sum |
| M6 | scanners ×9 | 14 | 2 天 | 路径展开 + 并行熔断 |
| M7 | realtime | 5 | 半天 | 事件合并 |
| M8 | HTTP server | 8 | 1 天 | 错误信封 + gzip |
| M9 | core 分析 | 8 | 1–2 天 | phase 两遍算法 |
| M10 | 前端 | ~25 | 3–4 天 | 虚拟滚动 + 局部 patch |
| M11 | proxy / frida / trae | ~18 | 3–5 天 | 环境强依赖 |
| M12 | CLI / build / 打包 | 8 | 1 天 | 三阶段顺序 |

M0–M10 完成即可得到一个**完整可用的 scan-only 版本**。M11 是增量能力，可以延后。

---

## M0 · 脚手架

**目标**：`npm run dev` 能起来，`npm test` 能跑（0 个测试也算通过），`npm run build` 三阶段能过。

**产出**
```
package.json  tsconfig.json  tsconfig.app.json  tsconfig.node.json
vite.config.ts  vite.cli.config.ts  vitest.config.ts  eslint.config.js
.gitignore  index.html  src/main.tsx  src/App.tsx（空壳）
bin/agent-observe.js  server/cli.ts（空壳）  server/server.ts（只有 /api/health）
src/test/setup.ts
config/local-sessions.example.json  config/session-groups.example.json
```

**验收**
- `npm run typecheck` 绿
- `npm run dev` 起得来，浏览器打开是空白页不报错
- `curl 127.0.0.1:4173/api/health` 返回 `{ok:true,...}`
- `npm run build` 三阶段全过，`server-dist/cli.js` 存在

**注意**：better-sqlite3 在 Windows 需要 MSVC 工具链。M0 就要确认它能装上，别拖到 M2 才发现。

---

## M1 · trace-model

**依赖**：无
**读**：`contracts/data-model.md` 全文、`specs/trace-model/spec.md`

**产出**
```
src/core/trace-types.ts       ← 逐字实现 contracts/data-model.md 全部类型与常量
src/core/trace-types.test.ts  ← contracts/data-model.md §11 的类型级断言
```

**验收**
- `TRACE_PHASES` / `TRACE_KINDS` / `PROVIDER_KEYS` 三个常量数组长度分别为 6 / 11 / 9
- 类型断言测试全绿
- **零运行时逻辑**——这个文件只有类型和常量
- [x] 删除 vitest.config.ts 的 passWithNoTests，删除后 npm run test 仍绿

---

## M2 · storage 基础（建库 + 写入）

**依赖**：M1
**读**：`contracts/database.md` 全文、`specs/storage/spec.md` REQ-001~005 / 010~013 / 016~017

**产出**
```
server/storage/schema.ts          SCHEMA_SQL + INDEX_SQL + SCHEMA_VERSION + initSchema
server/storage/db.ts              openWritable / openReadonly / checkpointWal
server/storage/columns.ts         §5.2 四个列常量
server/storage/writers.ts         upsertSessionFrom* / upsertEvents（差分）/ upsertMetrics / deleteSession
server/storage/retention.ts       proxy_requests 保留清理
server/storage/*.test.ts
```

**验收**
- 建库幂等：连调 3 次 `initSchema` 无副作用
- 8 项 PRAGMA 全部生效（`db.pragma('journal_mode')` 返回 `wal` 等）
- `upsertEvents` 差分测试：已有 347 event，append 1 个 → **只产生 1 条 INSERT**
- 索引断言：三条核心查询的 `EXPLAIN QUERY PLAN` 都不含 `USE TEMP B-TREE`

---

## M3 · storage 查询（三档 + 聚合）

**依赖**：M2
**读**：`specs/storage/spec.md` REQ-006~009 / 014~015、`contracts/api.md` §1–2

**产出**
```
server/storage/query-engine.ts    listSessions（keyset分页）/ getSessionDetail（三档+分页）
                                  / getEventDetail / getSystemPromptForSession / listProxyRequests
server/storage/detail-cache.ts    LRU 24 条
server/storage/overview.ts        getAgentOverview（两条 GROUP BY SQL + stamp 缓存）
server/storage/*.test.ts
perf-diag/                        从参考诊断报告移植 7 个脚本
```

**验收**
- slim 档返回的 event 对象**不含** `inputSummary` / `outputSummary` / `raw` 三个键
- 会话列表返回项**不含** `systemPrompt`，含 `hasSystemPrompt` 布尔
- `getAgentOverview` 只发两条 SQL，`stamp` 未变时命中缓存
- **从这里开始建立 `PERF-BASELINE.md`**

---

## M4 · watch 增量门禁

**依赖**：M2
**读**：`specs/session-scanning/spec.md` REQ-001~003 / 008 / 013~018、`gotchas.md` G11.5 / G11.15

**产出**
```
server/watch/fingerprint.ts    fingerprintFile（size + 首尾 4KB）+ WAL 型双文件指纹
server/watch/scan-gate.ts      shouldRescan / commitScanState
server/watch/jsonl-reader.ts   readJsonlFrom（流式 + byte offset）
server/watch/prewarm.ts        backgroundPrewarm（让路 + yield）
server/watch/*.test.ts
```

**验收**
- 无变更重扫：**0 条 SQL 写语句**，读取字节数 < 每文件 8KB
- `scan_state` 首轮扫描后行数 > 0（这是回归防线）
- WAL 型指纹测试：只改 `-wal` 文件也能检测到变更
- JSONL 增量：append 一行后只读增量部分，`endOffset` 正确推进
- 文件被截断时回退全量

---

## M5 · adapters ×9

**依赖**：M1
**读**：`specs/adapters/spec.md` 全文、`gotchas.md` 第 4 章 + 第 9 章

**产出**
```
src/adapters/sample-loader.ts
src/adapters/claude-code.ts  codeagent.ts  codex.ts
src/adapters/opencode.ts（含 OpenCodeDialect）  codearts.ts  codeagent2.ts
src/adapters/trae.ts  qoder.ts  workbuddy.ts
+ 每个一个 .test.ts
src/adapters/__fixtures__/   每 provider 一个最小 fixture
```

**建议顺序**：`opencode.ts` 先做（被 3 个复用）→ `claude-code.ts` → 其余。

**验收（每个 adapter 至少 5 个用例）**
1. 最小 fixture 的完整 TraceRecord 快照
2. **token 聚合语义**：OpenCode 系 `cacheRead` 用 max，其余用 sum；`reasoning` 恒 sum
3. `total = input + output + reasoning + cacheRead`（不含 cacheWrite）
4. 状态归一化四类映射
5. 重复 event id 的 `:{sequence}` 后缀
6. `title` 截断到 200 字符，`raw` 与正文分离返回

---

## M6 · scanners ×9

**依赖**：M4、M5
**读**：`specs/session-scanning/spec.md` REQ-004~012

**产出**
```
local-sessions/config.ts          三层覆盖 + 路径展开 + 原子写
local-sessions/session-key.ts     sessionKey(provider, id, sourcePath)
local-sessions/claude.ts codex.ts opencode.ts codearts.ts codeagent2.ts
                          codeagent.ts workbuddy.ts trae.ts
local-sessions/trae-bridge.ts     spawn + Promise（**不是 spawnSync**）
server/watch/scan-scheduler.ts    并行 + 超时熔断 + 两阶段启动
+ 测试
```

**验收**
- 路径展开三种语法（`~` / `~\` / `%VAR%`）
- provider 并行扫描；单个 provider 超时 30s 被跳过，不阻塞其他
- `initialScanAndStore` 索引阶段 < 3s @ 1500 文件
- `prewarmRecent` 默认 0
- Trae 密钥缺失时返回 `TRAE_KEY_MISSING`，不静默跳过

---

## M7 · realtime

**依赖**：M2
**读**：`specs/realtime/spec.md` 全文、`contracts/data-model.md` §10

**产出**
```
server/realtime/event-bus.ts    TypedEventBus
server/realtime/coalescer.ts    queueSessionChange（200ms 窗口 + unref）
server/realtime/sse.ts          addSseClient / 心跳 / cleanup
server/realtime/frontline.ts    markForegroundRequest / isForegroundBusy
+ 测试
```

**验收**
- 524 次 `queueSessionChange` 在 200ms 内 → **发出 ≤ 10 条** `sessions_changed`
- 定时器 `unref()`，进程能正常退出（用 `vitest --run` 验证不挂住）
- 客户端断开后订阅全部解除（无内存泄漏）

---

## M8 · HTTP server

**依赖**：M3、M7
**读**：`contracts/api.md` 全文

**产出**
```
server/http/router.ts          路径匹配（含 :param）
server/http/send-json.ts       gzip 判定 + content-length
server/http/error-envelope.ts  ApiError + 错误码常量
server/server.ts               createAgentObservabilityServer + 全部路由
server/server.test.ts          contracts/api.md §8 的六个契约测试
```

**验收**
- `contracts/api.md` §8 六个契约测试全绿
- 响应 ≥ 1KB 且 accept-encoding 含 gzip → 带 `content-encoding: gzip` 与 `vary`
- 所有非 2xx 走统一信封
- 每个请求都调了 `markForegroundRequest()`

---

## M9 · core 分析

**依赖**：M1
**读**：`specs/metrics-analysis/spec.md` 全文、`gotchas.md` G4.1 / G10.4 / G7.6

**产出**
```
src/core/phase-classifier.ts   两遍算法 + ACTION_PHASE 表 + classifyBashCommand
src/core/metrics.ts            computeMetrics + METRICS_CALC_VERSION
src/core/speed-metrics.ts      TTFT / TPS / TPOT / E2E / turnGap / pureInferenceMs
src/core/token-breakdown.ts
src/core/report-html.ts        buildTraceReportHtml（大 JSON 走外部 .js）
src/core/compare-report.ts
+ 测试
```

**验收**
- phase 分类：bash 测试命令 → verify；错误后写文件 → debug
- `pureInferenceMs` 取 `InferHub.inference_duration` 而非 Kernel-Inference
- **口径一致性测试**：SQL 聚合结果与逐会话 `computeMetrics` 求平均，差值 < 0.001
- 报告 HTML 中大 JSON 不内联

---

## M10 · 前端

**依赖**：M8、M9
**读**：`specs/frontend/spec.md` 全文、`gotchas.md` 第 7 章

**建议拆成 4 个子任务**：

- **M10a shell**：`App.tsx` 五视图切换 + SSE 接入 + 双层缓存 + i18n
- **M10b 列表与树**：`SampleRail` + `TraceGanttTree`（**都要虚拟滚动**）+ `PhaseTiles`
- **M10c 详情与聚合**：`EventInspector`（右侧、可拖拽、单 event 下钻）+ `AgentOverview`（**1 个请求**）
- **M10d 对比与设置**：`CompareBoard` 全家桶 + `SettingsModal` + 两个 Modal

**验收**
- Agent 视图网络面板请求数 **= 1**
- 打开 9,590 event 的会话：DOM 节点 < 500，首绘 < 200ms
- SSE `sessions_changed` 只触发一次批量补丁请求，**不重拉全量**
- i18n 两个 locale 键完全对齐（写个测试断言 `Object.keys(zh)` 等于 `Object.keys(en)`）

---

## M11 · proxy / frida / trae 解密

**依赖**：M8
**读**：`specs/proxy-capture/spec.md`、`specs/trae-decryption/spec.md`、`specs/desensitization/spec.md`

**产出**
```
server/desensitization/rules.ts + engine.ts
server/proxy/ca-manager.ts mitm-proxy.ts request-context.ts sse-accumulator.ts
server/proxy/parser-router.ts + parsers/{openai,anthropic,trae-tunnel}.ts
server/proxy/proxy-writer.ts cdp-capture.ts frida-capture.ts
scripts/trae-extract-key.py frida-chat-monitor-v2.js frida-check-module.js
```

**环境强依赖，建议标记为"生成但不端到端验证"**：Frida / Trae 解密需要 Windows + 特定 Trae 版本 + Python `sqlcipher3`。让 agent 在没有真实环境时写单元测试而非集成测试，**不要允许它 mock 掉真实逻辑来让集成测试变绿**。

**验收**
- 脱敏 10 条规则全部有用例；global regex 每次 reset `lastIndex`
- `keepRawBodies` 默认 false
- proxy 列表接口不返回任何 body 列
- 解密走 `spawn` 异步；不在请求路径上；结果缓存指纹覆盖 `-wal`

---

## M12 · CLI / build / 打包

**依赖**：全部
**读**：`specs/cli-build/spec.md` 全文

**产出**
```
server/cli.ts（完整参数解析）  bin/agent-observe.js
scripts/generate-local-samples.mjs  scripts/pack-binary.mjs
PERF-BASELINE.md  README.md
```

**验收**
- `--prewarm-recent` 默认 0；> 100 时 stderr 告警
- 启动自检 5 步全部执行并输出摘要
- 三阶段构建过；`dist-binary/` 里 Windows 启动器是 `.ps1` 不是 `.bat`
- **`contracts/nfr.md` §2 的全部预算达标**（这是最终验收）

---

## 全局验收清单

M12 完成后逐条核对：

- [ ] 启动后 10s / 60s / 180s 首屏均 < 100ms
- [ ] 最差会话（9,590 events）详情 < 60ms / < 1.5MB
- [ ] Agent Overview 1 个请求 / < 80KB / < 400ms
- [ ] 30s 窗口总请求数 < 15
- [ ] 无变更重扫 0 条 SQL
- [ ] `scan_state` 非空
- [ ] 事件循环延迟 p99 < 50ms
- [ ] DB + WAL 稳态 < 200MB
- [ ] `npm run typecheck && test && lint` 全绿
- [ ] `AGENTS.md` 十条禁令逐条 grep 自查
