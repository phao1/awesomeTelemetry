# Tasks: enhance-ui-depth-and-ia

> 每批结束跑 `npm run typecheck && npm run test && npm run lint`，全绿再提交。
> 一个批次一次提交，提交信息格式见 `AGENTS.md`。做完把对应 `[ ]` 勾成 `[x]`。

## ⚠️ 最容易做错的事

1. **所有颜色 MUST 从 `tokens.css` 取值**，禁止硬编码 hex。T2/T3 断言会拦截。
   Hero Header 渐变用 `var(--provider-{key}-subtle)`，JSON 高亮用 `var(--done-fg)` 等。
2. **KPI drill-down 数据从已有 compare 响应提取**，MUST NOT 发额外请求（G11.9）。
3. **Speed Metrics 的 `cacheHitRate` / `avgLlmDuration` 已在 B2 实现**，
   本 change 只需 UI 接线，MUST NOT 重复实现计算逻辑。
4. **TokenTextModal 懒加载 MUST 复用 `recordCache`**（REQ-005），避免重复请求。

## 建议执行批次

| 批次 | 范围 | 依赖 | 可否并行 |
|------|------|------|---------|
| B1 | §1 KPI drill-down | — | 起点 |
| B2 | §2 Token 文本 drill-down | — | 可与 B1 并行 |
| B3 | §3 Speed Metrics 扩展 | — | 可与 B1/B2 并行 |
| B4 | §4 系统 Prompt 展开区 | — | 可与 B1-B3 并行 |
| B5 | §5 Hero Header + section 重排 | B1, B3 | — |
| B6 | §6 JSON 高亮 + 脱敏增强 | — | 可与任意批次并行 |
| B7 | §7 Agent Overview 卡片视图 + Timeline 独立切换 | — | 可与任意批次并行 |
| B8 | §8 Mission 分组导航 + Command Palette 扩展 | — | 可与任意批次并行 |
| B9 | §9 收口验收 | 全部 | — |

---

## §1 KPI drill-down（B1）

- [x] 1.1 `CompareKPI.tsx`：4 张 KPI 卡增加 `expanded` 状态 + `onClick` 切换
- [x] 1.2 实现手风琴模式：`activeDrillDown` 状态，同一时刻仅一卡展开
- [x] 1.3 实现 4 个 drill-down 子组件：
  - `DrillDownEvents`：事件类型分布双条形图（复用 `HBarChart`）
  - `DrillDownTokens`：Top-10 token 事件双列对比表
  - `DrillDownErrors`：失败事件列表（L/R 各列）
  - `DrillDownDuration`：双 TraceTimeline compact 模式
- [x] 1.4 数据从已有 `compareResult` props 提取，MUST NOT 发额外请求
- [x] 1.5 展开/折叠动画用 `--motion-base`（160ms），`aria-expanded` 标注
- [x] 1.6 卡右上角 `IconChevronDown`，展开时旋转 180°
- [x] 1.7 CSS：`src/styles/components/compare.css` 加 `.kpi-drilldown` 样式
  （T2/T3：禁止字面量 hex）
- [x] 1.8 i18n：`src/i18n.ts` 新增 `compare.drilldown.*` 中英文 key
- [x] 1.9 测试：`CompareKPI.test.tsx` 断言点击展开、手风琴、数据渲染

## §2 Token 文本 drill-down（B2）

- [x] 2.1 `CompareCharts.tsx`：TokenDonutChart 段增加 `onClick` → 打开 `TokenTextModal`
- [x] 2.2 `CompareSpeedMetrics.tsx`：Token 堆叠条段增加 `onClick` → 同上
- [x] 2.3 `TokenTextModal.tsx` 增强：支持 compare 上下文（L/R 侧标记）
- [x] 2.4 数据来源：复用 `extractTokenTexts(record)`（`src/core/token-breakdown.ts`）
- [x] 2.5 slim 模式懒加载：`recordCache` miss 时发 `GET /api/sessions/:key?mode=full`
- [x] 2.6 文本缺失时显示警告 banner（`--attention-subtle` 背景）
- [x] 2.7 截断 10000 字符 + "Show all" 按钮
- [x] 2.8 复制按钮 2 秒 `IconSuccess` 反馈
- [x] 2.9 测试：`TokenTextModal.test.tsx` 断言正常/缺失/截断/懒加载场景

## §3 Speed Metrics 扩展（B3）

- [ ] 3.1 `CompareSpeedMetrics.tsx`：从 3 卡扩展为 6 核心 + 4 辅助 = 10 卡
- [ ] 3.2 核心 6 卡：e2e / TTFT / TPS / TPOT / turnGap / pureInference
  （L/R 值 + winner 标记）
- [ ] 3.3 辅助 4 卡：LLM Calls / avgLlmDuration / totalToolDuration / cacheHitRate
  （紧凑排列，仅 L/R 值 + delta）
- [ ] 3.4 TTFT > 5000ms 时显示启动开销警告条
  （`--attention-subtle` + `IconWarning` + "Startup overhead: Xs"）
- [ ] 3.5 `null` 值显示 `—`，MUST NOT 显示 `0`
- [ ] 3.6 winner 判定：lower-is-better / higher-is-better 逻辑
- [ ] 3.7 确认 `cacheHitRate` / `avgLlmDuration` 从 `SpeedMetrics` 类型取值
  （已在 calibrate B2 实现），MUST NOT 重复计算
- [ ] 3.8 i18n：新增 `compare.speed.{tpot,turnGap,pureInference,llmCalls,
  avgLlmDuration,totalToolDuration,cacheHitRate,startupOverhead}` key
- [ ] 3.9 测试：`CompareSpeedMetrics.test.tsx` 断言 10 卡渲染 + 警告条 + null 处理

## §4 系统 Prompt 展开区（B4）

- [ ] 4.1 `SessionToolbar.tsx` 下方新增可折叠 `SystemPromptSection` 组件
- [ ] 4.2 折叠态：`▸ System Prompt · X chars · ~Y tokens [📋]`
- [ ] 4.3 展开态：前 5000 字符 + "Show more (Z chars remaining)" 按钮
- [ ] 4.4 字符数：`session.systemPrompt.length`，token 估算：`Math.ceil(length / 4)`
- [ ] 4.5 复制按钮 2 秒 `IconSuccess` 反馈
- [ ] 4.6 `role="button"` + `tabIndex={0}` + Enter/Space 切换
- [ ] 4.7 `session.systemPrompt === null` 时整个区域不渲染
- [ ] 4.8 折叠状态持久化：`localStorage` key `awesome-telemetry.sysPromptExpanded`
- [ ] 4.9 CSS：`src/styles/components/session.css` 加样式（T2/T3）
- [ ] 4.10 i18n：新增 `session.sysPrompt.*` key
- [ ] 4.11 测试：`SessionToolbar.test.tsx` 断言展开/折叠/截断/null 场景

## §5 Hero Header + section 重排（B5）

- [ ] 5.1 `CompareBoard.tsx`：顶部新增 `CompareHeroHeader` 组件
- [ ] 5.2 渐变背景：`linear-gradient(135deg, var(--provider-L-subtle), var(--provider-R-subtle))`
- [ ] 5.3 L 侧：ProviderBadge + agent 名 + 会话标题
- [ ] 5.4 R 侧：同上
- [ ] 5.5 中间：关键比率摘要（取自 Verdict 结论）
- [ ] 5.6 文字颜色 `--canvas-overlay-fg`，圆角 `--radius-lg`
- [ ] 5.7 section 顺序重排：Hero → Verdict → KPI → Speed → **Charts** →
  Time&Phase → Tool → Timelines → DetailTable
- [ ] 5.8 ContextBar 锚点顺序同步更新
- [ ] 5.9 测试：`CompareBoard.test.tsx` 断言 section 顺序 + Hero 渲染

## §6 JSON 高亮 + 脱敏增强（B6）

- [ ] 6.1 `EventInspector.tsx`：确认 JSON 高亮覆盖 6 种 token 类型
  （key/string/number/boolean/null/punctuation）
- [ ] 6.2 `src/styles/components/inspector.css`：6 种 class 颜色从 token 取值
  （`.json-key` → `--done-fg` 等）
- [ ] 6.3 `inspector-text.ts`：确认脱敏正则覆盖
  `token/secret/api_key/api-key/apikey`，大小写不敏感
- [ ] 6.4 脱敏开关默认开启
- [ ] 6.5 测试：`inspector-text.test.tsx` 断言 6 种高亮 + 脱敏覆盖

## §7 Agent Overview 卡片视图 + Timeline 独立切换（B7）

- [ ] 7.1 `AgentOverview.tsx`：增加视图切换按钮（表格/卡片网格）
- [ ] 7.2 卡片网格视图：ProviderBadge + agent 名 + 堆叠 Phase 条 + 6 指标 + Phase 分解
- [ ] 7.3 响应式 grid：`repeat(auto-fit, minmax(320px, 1fr))`
- [ ] 7.4 视图模式持久化：`localStorage` key `awesome-telemetry.agentViewMode`
- [ ] 7.5 `CompareTimeline.tsx`：左右 Timeline 独立 mode toggle
- [ ] 7.6 测试：`AgentOverview.test.tsx` 断言切换 + 卡片渲染

## §8 Mission 分组导航 + Command Palette 扩展（B8）

- [ ] 8.1 `MissionControl.tsx`：增加角色分组侧边栏（管理者/工程师/运维）
- [ ] 8.2 侧边栏可折叠（`[` 键或按钮）
- [ ] 8.3 点击角色名 smooth scroll 到对应 section
- [ ] 8.4 当前可见 section 的角色名高亮
- [ ] 8.5 `CommandPalette.tsx`：扩展为 3 类动作（会话/导航/动作）
- [ ] 8.6 输入 `/` 前缀过滤动作类型
- [ ] 8.7 动作类条目显示 `IconChevronRight`，会话类显示 `ProviderBadge`
- [ ] 8.8 测试：`MissionControl.test.tsx` + `CommandPalette.test.tsx`

## §9 收口验收（B9）

- [ ] 9.1 `npm run typecheck && npm run test && npm run lint` 全绿
- [ ] 9.2 `npm run perf:check`，结果追加到 `PERF-BASELINE.md`
- [ ] 9.3 **真机验证**：`npm run build && npm start`
  - 贴出 compare 页面 KPI drill-down 展开截图
  - 贴出 TokenTextModal 打开截图
  - 贴出 Speed Metrics 10 卡 + TTFT 警告条截图
  - 贴出 Hero Header 渐变截图
  - 贴出系统 Prompt 展开区截图
- [ ] 9.4 确认 `tokens.css` 外无硬编码 hex（`grep -rn '#[0-9a-fA-F]\{3,6\}' src/`
  排除 tokens.css 后应零命中）
- [ ] 9.5 `PROGRESS.md` 追加一行
- [ ] 9.6 **诚实报告**：哪些功能未经真机验证，明确写出
