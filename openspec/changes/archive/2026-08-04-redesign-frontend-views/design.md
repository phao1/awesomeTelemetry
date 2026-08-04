## Context

前置两个 change 完成后，数据是真的、token 与组件就位。本 change 是把它们拼成页面。

约束仍然是 `specs/frontend/spec.md` 的既有性能条款：agent 视图 1 个请求（REQ-003）、
9,590 event 会话 DOM < 500（REQ-006）、详情默认 slim（G11.1）。
设计不能以牺牲这些为代价——v4 正是在「界面好看了」之后掉到首屏 5.9–12.4 秒。

## Goals / Non-Goals

**Goals:**
- 五个视图全部可用（当前 compare 完全不可用、proxy/frida 无入口）
- 任何失败都有可见、可诊断、可重试的呈现
- 首屏列表可扫视，详情能一眼看出「时间花在哪」

**Non-Goals:**
- 不做命令面板与快捷键（在 `add-palette-and-a11y`）
- 不做 URL 状态同步（同上）
- 不改任何后端 API（数据层由 `fix-session-data-integrity` 负责）

## Decisions

**D1 · 会话 store 提到 `App.tsx`，`SessionList` 变纯受控组件。**
备选是 Context / 状态库——被否，Context 会让整棵树在列表更新时重渲，
状态库违反零依赖。单一 `useState` + props 下传最简单且够用，
配合既有的 `startTransition` 已能满足调度需求。

**D2 · 四态是组件级契约，不是「加个 if」。**
统一 `Skeleton` / `EmptyState` / `ErrorState` 三个组件 + 一个 `useAsyncState` 约定，
让「忘了写空态」变成显式缺失而不是隐式空白。
配 lint/测试断言禁止空 `catch` 回潮。

**D3 · PhaseRibbon 是产品 signature，优先级高于甘特细节。**
「一眼看出这次会话把时间花在哪」是本产品相对纯日志查看器的核心差异。
按时间占比铺满宽度的色带，成本低、信息密度高。

**D4 · 甘特按真实时间比例定位，不用等宽行。**
等宽行等于把时间信息丢掉——那就只是一个列表。
零时长事件渲染为最小 2px 竖线，保证不隐身。

**D5 · 对比视图先给「结论条」再给图表。**
开发者要的是「谁快多少」，不是两列数字自己去比。
结论用一句话，图表作为佐证。

**D6 · 每个视图一个 commit。**
本 change 改动面最大，细粒度提交才能在出问题时精确回退（AUTOPILOT §三）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 改动面大，容易在中途留下半成品 | 每视图一个 commit；AUTOPILOT §七 要求停在完整提交上 |
| 组件改名破坏既有测试 | 改名与测试同步；测试断言本身不放宽（禁令 A） |
| 甘特时间比例计算在极端数据下失真（单事件占 99%） | 设最小/最大宽度钳制；零时长最小 2px |
| 新增视觉元素拖慢渲染 | 行内禁 `box-shadow`/`filter`；虚拟滚动容器内禁过渡（G-DS-4） |
| Agent 概览展开行诱使逐会话 fetch | 展开行复用共享 store；G11.9 是禁令，评审重点看这条 |
| 四态改造漏掉某处 | 按 `specs/frontend/spec.md` REQ-022 的 7 行表格逐条核对，表格即清单 |
