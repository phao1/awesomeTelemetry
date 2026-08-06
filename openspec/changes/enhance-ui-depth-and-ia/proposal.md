```markdown
# Proposal: enhance-ui-depth-and-ia

## Why

awesomeTelemetry 在设计纪律（Token 契约）、交互体验（键盘优先）、工程品质
（虚拟化/ErrorBoundary/hash-router）上已领先 agent-observability-main。但在
**可视化交互深度**（KPI drill-down / Token 文本 drill-down）、**信息架构层次**
（缺少 L0 全局上下文层 / Compare section 顺序非最优 / Mission widget 过载）和
**视觉冲击力**（Compare Hero Header 朴素）三个维度存在可感知的差距。

本 change 将 agent-observability-main 中验证有效的 4 项 P0 能力移植到
awesomeTelemetry，同时做 3 项 P1 交互增强和 3 项 P2 信息架构调整。所有移植
代码必须映射到 awesomeTelemetry 的 Token 系统，禁止引入硬编码颜色。

## What Changes

| 批次 | 范围 | 优先级 |
|------|------|--------|
| B1 | KPI drill-down（4 卡可展开查看指标构成明细） | P0 |
| B2 | Token 文本 drill-down（堆叠条/环形图段可点击→Modal） | P0 |
| B3 | Speed Metrics 扩展到 6+ 指标 + 启动开销警告 | P0 |
| B4 | Session Header 增加系统 Prompt 展开区 | P0 |
| B5 | Compare Hero Header 渐变 + section 顺序重排 | P1 |
| B6 | Inspector JSON 语法高亮升级 + 密钥脱敏正则增强 | P1 |
| B7 | Agent Overview 卡片网格视图 + Compare Timeline 独立模式切换 | P2 |
| B8 | Mission Control widget 分组导航 + Command Palette 动作扩展 | P2 |
| B9 | 收口验收 | — |

## Impact

- **Affected specs**: `frontend`（REQ-017/018/019 增强 + 4 条新增）、
  `design-system`（REQ-005 组件增强）、`metrics-analysis`（REQ-006/007 增强）
- **Affected contracts**: `contracts/data-model.md`（SpeedMetrics 新字段）、
  `contracts/design-tokens.md`（drill-down 相关 token）
- **Affected code**: `src/components/{CompareBoard,CompareSpeedMetrics,
  CompareKPI,CompareCharts,EventInspector,SessionToolbar,AgentOverview,
  MissionControl,CommandPalette,TokenTextModal}.tsx`、`src/core/{speed-metrics,
  token-breakdown}.ts`、`src/styles/components/{compare,inspector,session}.css`、
  `src/i18n.ts`
- **不受影响**: `tokens.css` 色值体系 / `useVirtualList` / `hash-router` /
  键盘快捷键系统 / SSE 合并机制 / ErrorBoundary / 三主题系统
- **Breaking**: 无 — 纯增量增强，不删除现有功能

```