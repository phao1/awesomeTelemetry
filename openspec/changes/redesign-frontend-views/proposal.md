## Why

实机验证确认三个**前端**确定性缺陷（`UI-TASKS.md` §2 的 P1-4 / P1-5 / P1-6）：

1. **对比视图 100% 不可用**——`App.tsx` 与 `SampleRail` 各持一份会话数组，
   `CompareBoard` 永远收到 `[]`，两个下拉框永远为空。
2. **7 处空 `catch` 静默吞错**——任何失败的用户可见表现都是「点了纹丝不动」，
   没有错误码、没有提示、没有重试。`SettingsModal` 失败会永久停在「加载中」。
3. **Transcript 无条件拉 `mode=full`**——648 event 会话即数十 MB，违反 G11.1。

同时五个视图的呈现停留在「能跑」级别：列表是三个 span，甘特是等宽行，
Agent 概览是一张裸表，Proxy / Frida 没有任何控制入口。

## What Changes

- **共享会话 store**：会话索引由 `App.tsx` 单一持有，`SessionList` 改受控组件——修复对比视图。
- **四态渲染**：所有异步区域实现 loading / empty / error+重试 / ready，
  消灭全部空 `catch`，并加 CI 断言禁止回潮。
- **AppShell**：全局头 + underline tabs + 三栏 + 状态栏，左右栏可拖可折叠且持久化。
- **五视图重做**：会话列表双行密排；详情主区新增 **PhaseRibbon** 与时间比例甘特；
  Agent 概览 KPI 卡 + 内联条形图；对比视图搜索式选择器 + 结论条；
  Proxy / Frida 补齐控制条与详情抽屉。
- Transcript 改为分页拉取 + 弹层内虚拟滚动。

**BREAKING**（仅内部）：`SampleRail` → `SessionList`、`TraceGanttTree` → `TraceTimeline`，
测试文件同步改名。无对外 API 变更。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无 delta。本 change 实现 `specs/frontend/spec.md` REQ-015~023 与 REQ-026、
`specs/design-system/spec.md` REQ-006/007，规格已于 2026-08-04 先行落地，
故 `.openspec.yaml` 设 `skip_specs: true`。

## Impact

| 面 | 影响 |
|----|------|
| 代码 | `src/App.tsx` 重构；`src/components/` 全部视图组件重做；两个组件改名 |
| 依赖 | 前置 `add-design-system`（token + 图标 + 基础组件）与 `fix-session-data-integrity`（数据非空） |
| 测试 | 现有 `AgentOverview.test.tsx` / `TraceGanttTree.test.tsx` 需随改名与结构调整同步更新 |
| 性能 | 仍受 REQ-003（agent 视图 1 个请求）、REQ-006（9,590 event DOM < 500）约束 |
| 风险 | 改动面最大的一个 change；建议每个视图一个 commit |
