# PROGRESS.md — 里程碑进度

> 最后更新：2026-08-04（长跑开始时重建本文件；此前仓库中不存在）

## 总览

| M | 模块 | 状态 | 提交 |
|---|------|------|------|
| M0 | 脚手架 | ✅ 完成 | fc111df |
| M1 | trace-model | ✅ 完成 | 4f5c316 |
| M2 | storage 基础 | ✅ 完成 | 7091836 |
| M3 | storage 查询 | ✅ 完成 | 95ca72d |
| M4 | watch 增量门禁 | ✅ 完成 | 8fe7949 |
| M5 | adapters ×9 | ✅ 完成 | （待提交） |
| M6 | scanners ×9 | ⬜ 未开始 | — |
| M7 | realtime | ⬜ 未开始 | — |
| M8 | HTTP server | ⬜ 未开始 | — |
| M9 | core 分析 | ⬜ 未开始 | — |
| M10 | 前端（a–d） | ⬜ 未开始 | — |
| M11 | proxy/frida/trae（按 P-3 裁剪） | ⬜ 未开始 | — |
| M12 | CLI / build / 打包 | ⬜ 未开始 | — |

## 里程碑明细

### M2 · storage 基础（已完成）

- 产出：schema.ts / db.ts / columns.ts / writers.ts / retention.ts + 4 个测试文件
- 决策：D-001（规则文件缺失）、D-002（proxy 索引列序与 §5.3 期望计划冲突）
- 验收：建库幂等 / 8 项 PRAGMA / 差分 upsert 只 1 条 INSERT / 三查询无临时 B 树

### M3 · storage 查询（已完成）

- 产出：query-engine.ts（listSessions keyset 分页 / getSessionDetail 三档+分页 /
  getEventDetail / getSystemPromptForSession / listProxyRequests）、detail-cache.ts（LRU 24）、
  overview.ts（两条 GROUP BY SQL + stamp 缓存）、stmt-cache.ts（共享 prepared 缓存）、
  perf-diag/ 7 个诊断脚本 + run-all.mjs、PERF-BASELINE.md
- 验收：slim 档不含 inputSummary/outputSummary/raw；列表不含 systemPrompt 含 hasSystemPrompt；
  overview 聚合 2 SQL、stamp 未变命中缓存；perf:check 全绿
- 决策：D-002 已落地（proxy 索引列序）

### M4 · watch 增量门禁（已完成）

- 产出：fingerprint.ts（首尾 4KB 指纹 + WAL 双文件指纹）、scan-gate.ts（shouldRescan /
  commitScanState）、jsonl-reader.ts（流式逐行 + byte offset + 截断回退）、
  prewarm.ts（让路 + yield）+ 4 个测试文件
- 验收：无变更重扫 0 写语句；scan_state 首轮后行数 > 0；只改 -wal 可检测；
  append 只读增量且 endOffset 推进；截断回退全量

### M5 · adapters ×9（已完成）

- 产出：sample-loader.ts（按 sourceAgent 分发）、9 个 adapter（opencode 含 OpenCodeDialect，
  codearts/codeagent2 为 thin wrapper，codeagent 包装 claude-code）+ 9 个测试文件 +
  每 provider 一个 fixture + helpers.ts
- **决策**：M5 REQ-008（qoder 调 classifyEvents）硬依赖 M9 的 phase-classifier，
  提前完整实现 src/core/phase-classifier.ts（两遍算法 + ACTION_PHASE + classifyBashCommand），
  非占位实现，M9 在此基础上继续。
- 验收：每 adapter ≥5 用例；OpenCode 系 cacheRead 用 max、其余 sum、reasoning 恒 sum；
  total = input+output+reasoning+cacheRead；状态四类映射；重复 id :sequence 后缀；
  title ≤ 200；raw 与正文分离返回

## 待决清单索引

见 DECISIONS-PENDING.md。
