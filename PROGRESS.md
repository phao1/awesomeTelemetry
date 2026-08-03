# PROGRESS.md — 里程碑进度

> 最后更新：2026-08-04（长跑开始时重建本文件；此前仓库中不存在）

## 总览

| M | 模块 | 状态 | 提交 |
|---|------|------|------|
| M0 | 脚手架 | ✅ 完成 | fc111df |
| M1 | trace-model | ✅ 完成 | 4f5c316 |
| M2 | storage 基础 | 🔄 进行中（实现已写，正在修复验收门禁） | — |
| M3 | storage 查询 | ⬜ 未开始 | — |
| M4 | watch 增量门禁 | ⬜ 未开始 | — |
| M5 | adapters ×9 | ⬜ 未开始 | — |
| M6 | scanners ×9 | ⬜ 未开始 | — |
| M7 | realtime | ⬜ 未开始 | — |
| M8 | HTTP server | ⬜ 未开始 | — |
| M9 | core 分析 | ⬜ 未开始 | — |
| M10 | 前端（a–d） | ⬜ 未开始 | — |
| M11 | proxy/frida/trae（按 P-3 裁剪） | ⬜ 未开始 | — |
| M12 | CLI / build / 打包 | ⬜ 未开始 | — |

## 里程碑明细

### M2 · storage 基础（进行中）

- 产出文件已齐：schema.ts / db.ts / columns.ts / writers.ts / retention.ts + 4 个测试文件
- 待修复：typecheck 已绿；schema.test.ts 中第三条核心查询产生 USE TEMP B-TREE
- 相关决策：D-001（规则文件缺失）、D-002（proxy 索引列序与 §5.3 期望计划冲突）
- 验收项：建库幂等 / 8 项 PRAGMA / 差分 upsert 只 1 条 INSERT / 三查询无临时 B 树

## 待决清单索引

见 DECISIONS-PENDING.md。
