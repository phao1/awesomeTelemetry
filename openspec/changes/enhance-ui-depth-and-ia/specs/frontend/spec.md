# Spec: enhance-ui-depth-and-ia (Frontend)

> 增量 spec，编号从 REQ-100 起，不修改现有 REQ-001~REQ-027 语义。
> 所有新增颜色 MUST 从 `tokens.css` 取值，禁止硬编码 hex（T2/T3 断言）。

---

## ADDED Requirements

### Requirement: KPI drill-down (REQ-100)

CompareBoard 的 4 张 KPI 卡（Events / Tokens / Failures / LLM Calls）SHALL
支持点击展开 inline drill-down 面板，展示指标构成明细。

| KPI 卡 | drill-down 内容 |
|--------|----------------|
| Events | 事件类型分布双条形图（L vs R，按 kind 分组） |
| Tokens | Top-10 token 消耗事件双列对比表（事件标题 + token 数 + 占比条） |
| Failures | 失败事件列表（L/R 各列，事件标题 + 错误类型 + 时间） |
| LLM Calls | 双 TraceTimeline 对比（compact 模式，20 行上限） |

- 展开/折叠用 `aria-expanded`，动画用 `--motion-base`（160ms）
- 同一时刻仅允许一张卡展开（手风琴模式）
- drill-down 数据从已有 `POST /api/compare` 响应中提取，MUST NOT 发额外请求
- 每张卡右上角显示 `IconChevronDown`，展开时旋转 180°

#### Scenario: KPI 卡展开不额外请求
- **GIVEN** compare 数据已加载
- **WHEN** 用户点击 Tokens KPI 卡
- **THEN** 网络面板不产生新请求
- **AND** drill-down 面板在 160ms 内展开
- **AND** 面板内显示 Top-10 token 事件双列对比

#### Scenario: 手风琴模式
- **GIVEN** Tokens KPI 已展开
- **WHEN** 用户点击 Failures KPI 卡
- **THEN** Tokens 面板折叠，Failures 面板展开
- **AND** 仅一个面板同时展开

---

### Requirement: Token 文本 drill-down (REQ-101)

CompareCharts 的 TokenDonutChart 和 CompareSpeedMetrics 的 Token 堆叠条
SHALL 支持点击 token 段（system / input / output / reasoning）打开
`TokenTextModal`，显示该段对应的实际文本内容。

Modal 内容：
- Header：provider badge + agent 名 + 段类型 + token 数 + 字符数
- 警告 banner：当文本缺失时（如 system prompt 未持久化）显示原因
- 正文：`<pre>` 格式化文本，`--font-mono`，受 REQ-012 字体调节控制
- 截断：超过 10000 字符时截断，显示"Show all"按钮
- 复制按钮：2 秒 `IconSuccess` 反馈

数据来源：复用 `extractTokenTexts(record)`（metrics-analysis REQ-007）。
当 `record` 为 slim 模式（无 raw）时，SHALL 懒加载 `mode=full` 后再提取。

#### Scenario: 点击 token 段打开 Modal
- **GIVEN** compare 页面 TokenDonutChart 已渲染
- **WHEN** 用户点击 output 段
- **THEN** TokenTextModal 打开
- **AND** 显示 output 文本内容 + token 数 + 字符数
- **AND** 文本超过 10000 字符时显示截断提示

#### Scenario: slim 模式懒加载
- **GIVEN** compare 数据为 slim 模式（无 raw events）
- **WHEN** 用户点击 token 段
- **THEN** Modal 先显示 Skeleton
- **AND** 发起一次 `GET /api/sessions/:key?mode=full` 请求
- **AND** 加载完成后显示文本内容

#### Scenario: 文本缺失
- **GIVEN** system prompt 未持久化（`session.systemPrompt === null`）
- **WHEN** 用户点击 system 段
- **THEN** Modal 显示警告 banner："System prompt not persisted for this session"
- **AND** 正文区域为空

---

### Requirement: Speed Metrics 扩展到 6+ 指标 (REQ-102)

CompareSpeedMetrics SHALL 从当前 3 核心指标（e2e/TTFT/TPS）扩展为完整 6 指标
+ 4 辅助指标，共 10 卡。

核心 6 指标（独立卡片，L/R 值 + winner 标记）：

| 指标 | 含义 | 越低越好 |
|------|------|---------|
| e2e | 端到端时长 | ✅ |
| TTFT | 首 Token 时间 | ✅ |
| TPS | 每秒 Token 数 | ❌ |
| TPOT | 每 Token 生成时间 | ✅ |
| turnGap | 轮次间隔中位数 | ✅ |
| pureInference | 纯推理时长 | ✅ |

辅助 4 指标（紧凑排列，仅 L/R 值 + delta）：

| 指标 | 含义 |
|------|------|
| LLM Calls | LLM 调用次数 |
| avgLlmDuration | 平均 LLM 时长 |
| totalToolDuration | 工具总时长 |
| cacheHitRate | 缓存命中率 |

- 当 `TTFT > 5000ms` 时，SHALL 在 TTFT 卡下方显示启动开销警告条
  （`--attention-subtle` 背景 + `IconWarning` + "Startup overhead: Xs"）
- `null` 值显示 `—`，MUST NOT 显示 `0` 冒充
- winner 判定：lower-is-better 取较小值，higher-is-better 取较大值

#### Scenario: TTFT 启动开销警告
- **GIVEN** 左侧会话 TTFT = 6200ms
- **WHEN** Speed Metrics 渲染
- **THEN** TTFT 卡下方显示警告条
- **AND** 警告条文本为 "Startup overhead: 6.2s"
- **AND** 背景为 `--attention-subtle`

#### Scenario: null 值不显示 0
- **GIVEN** 某会话无 cache 数据（`cacheHitRate === null`）
- **WHEN** cacheHitRate 卡渲染
- **THEN** 显示 `—`
- **AND** MUST NOT 显示 `0%` 或 `0.0`

---

### Requirement: Session Header 系统 Prompt 展开区 (REQ-103)

SessionToolbar 下方 SHALL 增加可折叠的系统 Prompt 展开区（L0 上下文层）。

布局：
```
┌─────────────────────────────────────────────────────┐
│ ▸ System Prompt  · 8,721 chars · ~2,180 tokens  [📋] │  ← 折叠态
└─────────────────────────────────────────────────────┘
```
展开后：
```
┌─────────────────────────────────────────────────────┐
│ ▾ System Prompt  · 8,721 chars · ~2,180 tokens  [📋] │
│ ┌─────────────────────────────────────────────────┐ │
│ │ You are a helpful coding assistant...           │ │
│ │ (前 5000 字符，超出截断)                         │ │
│ │ … Show more (3,721 chars remaining)             │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- 字符数：`session.systemPrompt.length`
- 估算 token 数：`Math.ceil(length / 4)`
- 截断阈值：5000 字符，"Show more" 按钮展开全部
- 复制按钮：2 秒 `IconSuccess` 反馈
- 键盘可访问：`role="button"` + `tabIndex={0}` + Enter/Space 切换
- `session.systemPrompt === null` 时整个区域不渲染（不显示空状态）
- 折叠/展开状态持久化到 `localStorage` key `awesome-telemetry.sysPromptExpanded`

#### Scenario: 系统 Prompt 展开
- **GIVEN** 会话有 system prompt（8721 字符）
- **WHEN** 用户点击展开区
- **THEN** 显示前 5000 字符
- **AND** 显示 "Show more (3,721 chars remaining)" 按钮
- **AND** 点击 Show more 后显示全部内容

#### Scenario: 无系统 Prompt
- **GIVEN** `session.systemPrompt === null`
- **THEN** 展开区不渲染
- **AND** MUST NOT 显示 "No system prompt" 空状态

---

## ADDED Requirements

### Requirement: Compare Hero Header 渐变 (REQ-104)

CompareBoard 顶部 SHALL 增加 Hero Header，使用双方 provider 色渐变背景。

布局：
```
┌─────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░  ⟨C⟩ Claude Code              ⟨T⟩ Trae           ░ │
│ ░  Fix SQLite index logic       Add auth middleware ░ │
│ ░  2.3× faster · 41% more tokens                    ░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────────────────────────────┘
```

- 背景：`linear-gradient(135deg, var(--provider-L-subtle) 0%, var(--provider-R-subtle) 100%)`
- 颜色来源：从 `tokens.css` 的 `--provider-{key}-subtle` 取值，MUST NOT 硬编码
- L 侧：ProviderBadge + agent 名 + 会话标题
- R 侧：同上
- 中间：关键比率摘要（如 "2.3× faster · 41% more tokens"），取自 Verdict 结论
- 文字颜色：`--canvas-overlay-fg`（确保渐变背景上可读）
- 圆角：`--radius-lg`

#### Scenario: 渐变取 token 色
- **GIVEN** L = claude, R = trae
- **THEN** 背景渐变为 `var(--provider-claude-subtle)` → `var(--provider-trae-subtle)`
- **AND** CSS 中无硬编码 hex 值

---

### Requirement: Compare section 顺序重排 (REQ-105)

CompareBoard 的 9 section 顺序 SHALL 调整为：

| 序号 | Section | 变化 |
|------|---------|------|
| 1 | Hero Header | **新增** (REQ-104) |
| 2 | Verdict | 保持 |
| 3 | KPI Grid | 增强 (REQ-100 drill-down) |
| 4 | Speed Metrics | 增强 (REQ-102) |
| 5 | **Charts** | **提前**（从第9提前到第5） |
| 6 | Time & Phase | 保持 |
| 7 | Tool Analysis | 保持 |
| 8 | Timelines | 保持 |
| 9 | Detail Metrics Table | 保持（最后，最详细） |

调整理由：Charts（雷达图/环形图）提供视觉总览，应先于数字细节呈现。
用户需要先看"一眼定胜负"的雷达图，再深入具体指标。

ContextBar 锚点导航 SHALL 同步更新顺序。

#### Scenario: Charts 在 Speed Metrics 之后
- **GIVEN** compare 页面加载完成
- **WHEN** 用户从上往下滚动
- **THEN** section 顺序为 Hero → Verdict → KPI → Speed → Charts → ...
- **AND** ContextBar 锚点顺序与 section 顺序一致

---

### Requirement: Inspector JSON 语法高亮升级 + 密钥脱敏增强 (REQ-106)

EventInspector 的 Raw tab JSON 高亮 SHALL 覆盖 6 种 token 类型：

| Token 类型 | CSS class | 颜色 token |
|-----------|-----------|-----------|
| key | `.json-key` | `--done-fg` |
| string | `.json-string` | `--success-fg` |
| number | `.json-number` | `--accent-fg` |
| boolean | `.json-boolean` | `--attention-fg` |
| null | `.json-null` | `--neutral-fg` |
| punctuation | `.json-punct` | `--fg-muted` |

密钥脱敏正则 SHALL 覆盖以下模式（当前已有，需确认覆盖完整）：
- `token` / `secret` / `api_key` / `api-key` / `apikey`
- 格式：`$1=<REDACTED>`
- 大小写不敏感

脱敏开关 SHALL 默认开启，用户可手动关闭（已有功能，确认默认值）。

#### Scenario: JSON 高亮 6 种类型
- **GIVEN** Raw tab 显示 `{"key": "value", "num": 42, "bool": true, "nil": null}`
- **THEN** key 为 `--done-fg`，string 为 `--success-fg`，number 为 `--accent-fg`
- **AND** boolean 为 `--attention-fg`，null 为 `--neutral-fg`

#### Scenario: 密钥脱敏
- **GIVEN** JSON 中包含 `"api_key": "sk-abc123"`
- **THEN** 显示为 `"api_key": "<REDACTED>"`
- **AND** 脱敏开关为 ON 时生效

---

## ADDED Requirements

### Requirement: Agent Overview 卡片网格视图 (REQ-107)

AgentOverview SHALL 增加视图切换按钮（表格/卡片网格），默认保持表格视图。

卡片网格视图：
- 每张卡：ProviderBadge + agent 名 + 会话数 + 堆叠 Phase 条 + 6 指标列表 + Phase 分解
- 响应式 grid：`repeat(auto-fit, minmax(320px, 1fr))`
- 堆叠 Phase 条：6 段比例条，颜色用 `--phase-*`
- 视图切换持久化到 `localStorage` key `awesome-telemetry.agentViewMode`

#### Scenario: 切换到卡片视图
- **GIVEN** AgentOverview 在表格视图
- **WHEN** 用户点击卡片网格按钮
- **THEN** 切换到卡片网格布局
- **AND** 每张卡显示堆叠 Phase 条 + 6 指标
- **AND** 视图模式持久化

---

### Requirement: Compare Timeline 独立模式切换 (REQ-108)

Compare Timelines section 的左右两条 Timeline SHALL 支持独立 time/sequence
模式切换（当前可能为同步切换）。

- 左侧 Timeline 有自己的 mode toggle，右侧也有自己的
- 互不影响，允许左 time 右 sequence
- 模式状态不持久化（每次进入 compare 重置为 time）

#### Scenario: 独立模式
- **GIVEN** compare Timelines section
- **WHEN** 用户将左侧切换为 sequence，右侧保持 time
- **THEN** 左侧按事件序列等宽排列，右侧按时间戳比例排列

---

### Requirement: Mission Control widget 分组导航 (REQ-109)

MissionControl SHALL 增加角色分组侧边栏（可折叠），将 25+ widget 按角色分为
3 组：

| 角色 | 包含 widget |
|------|------------|
| 管理者 | 活动趋势 / 成本效率 / 错误率 / 采集器健康 |
| 工程师 | 工具生态 / 场景分类 / 并行度 / 上下文压力 / 模型分布 |
| 运维 | 采集器状态 / 双通道 / 日历 / 热点会话 |

- 侧边栏可折叠（`[` 键或按钮）
- 点击角色名滚动到对应 section（smooth scroll）
- 当前可见 section 的角色名高亮（`--accent-emphasis`）
- 默认全展开（不隐藏其他角色的 widget），侧边栏仅做导航

#### Scenario: 角色导航
- **GIVEN** Mission view 加载完成
- **WHEN** 用户点击"工程师"角色名
- **THEN** 页面平滑滚动到工程师 section
- **AND** "工程师"角色名高亮

---

### Requirement: Command Palette 动作扩展 (REQ-110)

CommandPalette（REQ-025）SHALL 从仅支持会话 fuzzy 搜索扩展为 3 类动作：

| 类型 | 动作 |
|------|------|
| 会话 | fuzzy 搜索会话（已有） |
| 导航 | 切换视图 / 跳转到指定 session / 跳转到 Compare |
| 动作 | 导出报告 / 切换主题 / 切换语言 / 重新扫描 / 打开设置 |

- 输入 `/` 前缀过滤动作类型：`/nav` 导航、`/act` 动作、`/s` 会话
- 无前缀时混合搜索，按相关性排序
- 动作类条目显示 `IconChevronRight`，会话类显示 `ProviderBadge`

#### Scenario: 搜索动作
- **GIVEN** 命令面板打开
- **WHEN** 用户输入 "theme"
- **THEN** 显示 "Toggle Theme" 动作条目
- **AND** 选中后执行主题切换

#### Scenario: 前缀过滤
- **GIVEN** 命令面板打开
- **WHEN** 用户输入 "/act export"
- **THEN** 仅显示动作类结果
- **AND** 显示 "Export Report" 动作

---

## Gotchas

- **G-UI-1**: KPI drill-down 数据必须从已有 compare 响应提取，MUST NOT 发额外
 请求（G11.9: 禁止 `sessions.map(s => fetch(...))` 模式）
- **G-UI-2**: TokenTextModal 懒加载 `mode=full` 时，MUST 复用 `recordCache`
 (REQ-005)，避免重复请求同一会话
- **G-UI-3**: Hero Header 渐变色 MUST 从 `--provider-{key}-subtle` 取值。如果
 provider key 不在 tokens.css 的 9 个已知 provider 中，回退到 `--accent-subtle`
- **G-UI-4**: Speed Metrics 新增 4 辅助指标中，`cacheHitRate` 和 `avgLlmDuration`
 已在 `calibrate-tokens-and-compare-report` B2 中实现（SpeedMetrics 类型），
 本 change 只需在 UI 层接线展示，MUST NOT 重复实现计算逻辑
- **G-UI-5**: 系统 Prompt 展开区的折叠状态持久化 key 必须用 `awesome-telemetry.`
 前缀（品牌改名后的新前缀），MUST NOT 用老前缀 `agent-observability.`
- **G-UI-6**: Compare section 重排时，ContextBar 的锚点顺序 MUST 同步更新，
 否则锚点跳转会指向错误的 section
- **G-UI-7**: JSON 语法高亮颜色 MUST 从 token 系统取值，MUST NOT 硬编码 hex。
 T2/T3 断言会拦截 `tokens.css` 外的字面量颜色
- **G-UI-8**: Mission widget 分组导航仅做滚动定位，MUST NOT 隐藏其他角色的
 widget。用户可能同时需要多角色的数据
