# RUNBOOK.md — 里程碑执行手册

> 本文件在 2026-08-04 长跑开始时缺失，由代理按当日目标指令中内嵌的规则重建。
> 原始版本若存在，以其为准。

## 一、总则

- 每个里程碑独立可验收、独立可提交（提交信息格式见 AGENTS.md）。
- 开工前完成 AGENTS.md 的四步检查。
- 权威文档优先级以 AGENTS.md 为准。

## 二、通用检查

- 提交前 `npm run typecheck && npm run test && npm run lint` 全绿。
- M3 起提交前跑 `npm run perf:check`，结果追加到 PERF-BASELINE.md。
- 验收标准以 BOOTSTRAP.md 对应里程碑的「验收」栏为准。

## 三、里程碑内部五阶段流程

1. **状态恢复**：确认上一里程碑提交完整、工作区干净；核对本里程碑要产出的文件清单；
   读 BOOTSTRAP 对应行 + 相关 spec/contracts/gotchas。
2. **测试先行**：先写测试（与源码同目录 `foo.test.ts`），测试即契约的可执行形式；
   测试必须用真实依赖，禁止 mock fs / child_process / better-sqlite3。
3. **实现**：逐条实现 spec REQ；类型逐字采用契约；`undefined` 写库前转 `null`；
   卡住按 AUTOPILOT.md §三/§四 处理。
4. **验收**：跑该里程碑验收项（测试、EXPLAIN QUERY PLAN、性能断言等），
   不通过就改实现，不改测试断言。
5. **收尾**：全量门禁通过后提交（`M<n>: <模块名> — <一句话>`），更新 PROGRESS.md。
