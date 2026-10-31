# AwesomeTelemetry 界面设计规范 v2（"Calm Instrument"）

> 本文是 dev1031 界面重做的唯一设计依据。所有页面、所有组件都按本文实现；本文没写到的，按"同类已实现组件"推断，保持一致。
> 例外：任务详情里的 **执行轨迹** 与 **对话** 两个页签的内部内容不重做，只继承新的全局 token（颜色、圆角、字体）和新的页签外壳，不改它们的结构与交互。

## 0. 设计立场

目标用户是 Agent 开发者。他们每天在 Langfuse、Opik、Helicone、Laminar、LangWatch、Linear、Vercel 这类工具里工作，对"商业级"的判断标准是：

1. **安静**：中性灰阶为底，只有一个品牌强调色；颜色只用来表达状态和数据，不做装饰。
2. **有秩序**：所有东西落在 4px 网格上；同一行的控件同高；同类信息在每个页面出现在同一个位置。
3. **密而不挤**：信息密度高（13px 正文、36–40px 表格行），但每个区块有明确的边界（卡片、分隔线、留白），绝不出现"控件挤在一起、文字被换行"。
4. **数字是主角**：指标值用等宽数字（tabular-nums）、紧凑格式（12.3K / 4.56M），精确值放在悬停提示里。
5. **解释性文字收起来**：口径说明、限制说明放进 ⓘ 提示或可展开的说明，不要在页面上堆段落。

参考（只参考风格，不复制任何产品的布局像素、logo、文案或资源）：

| 产品 | 借鉴点 |
|---|---|
| Opik | 浅色后台整体布局：分组侧栏 + 面包屑 + 页面标题 + 下划线页签 + 两列图表卡片 |
| Helicone | 统计卡片（小标签 + 大数字 + 图）、时间范围分段按钮、环形图中心总数、横向条形排行（BarList） |
| Laminar | 深色主题的紧凑感、筛选工具条（Add filter / 列 / 时间范围 / 刷新）、表格左侧状态色条、详情侧栏时间线 |
| Langfuse | 克制的信息密度、灰底小药丸徽标（延迟 / Token / 模型）、图标 + 文字按钮 |
| LangWatch | 柔和的卡片（大圆角、浅阴影、带底色的图标块），适合入口/通道卡片 |

## 1. Token（落在 src/styles/tokens.css，契约 openspec/contracts/design-tokens.md 同步更新）

保留现有 token 名称体系（canvas / border / fg / accent / success / attention / danger / done / neutral / role / phase / provider / seg），**重设数值**，并新增下列 token。T1–T7 契约测试必须继续通过（T4 对比度不达标就调色值，不许放宽测试）。

### 1.1 颜色 · 浅色主题（默认跟随系统）

| token | 值 | 用途 |
|---|---|---|
| --canvas-inset | #f6f7f9 | 应用背景（卡片之下） |
| --canvas-default | #ffffff | 主表面：侧栏、卡片、表格 |
| --canvas-subtle | #f3f4f6 | 表头、行悬停、分段控件底、输入框禁用 |
| --canvas-raised | #ffffff | 卡片 |
| --canvas-overlay | #ffffff | 弹层、菜单、抽屉 |
| --border-default | #e5e7eb | 卡片、表格、输入框描边 |
| --border-muted | #eef0f3 | 表格行分隔、卡片内分隔 |
| --border-strong | #d1d5db | 悬停描边、分段控件选中描边 |
| --fg-default | #111827 | 正文、标题、数字 |
| --fg-muted | #4b5563 | 次要文字、表头 |
| --fg-subtle | #6b7280 | 标签、辅助说明、占位符（必须满足 T4） |
| --accent-fg | #4f46e5 | 链接、选中项文字、导航当前项 |
| --accent-emphasis | #4f46e5 | 强调实底（白字其上） |
| --accent-subtle | rgba(79,70,229,0.08) | 选中行、导航当前项底色 |
| --success-fg / -emphasis / -subtle | #15803d / #16a34a / rgba(22,163,74,0.10) | |
| --attention-fg / -emphasis / -subtle | #b45309 / #d97706 / rgba(217,119,6,0.10) | |
| --danger-fg / -emphasis / -subtle | #dc2626 / #dc2626 / rgba(220,38,38,0.08) | |
| --done-fg / -emphasis / -subtle | #7c3aed / #7c3aed / rgba(124,58,237,0.08) | |
| --neutral-fg / -emphasis / -subtle | #4b5563 / #6b7280 / rgba(107,114,128,0.10) | |

主按钮（primary）用**近黑实底**：背景 --fg-default、文字 --canvas-default（深色主题里自然变成近白实底黑字），这是 Vercel/Langfuse 式的高级感。强调色 indigo 只用于：导航当前项、链接、焦点环、选中态、图表第一序列、对比页 B 侧。

### 1.2 颜色 · 深色主题

| token | 值 |
|---|---|
| --canvas-inset | #09090b |
| --canvas-default | #111113 |
| --canvas-subtle | #1a1a1e |
| --canvas-raised | #141417 |
| --canvas-overlay | #1a1a1e |
| --border-default | #27272a |
| --border-muted | #1f1f23 |
| --border-strong | #3f3f46 |
| --fg-default | #f4f4f5 |
| --fg-muted | #a1a1aa |
| --fg-subtle | #8b8b94 |
| --accent-fg | #a5b4fc |
| --accent-emphasis | #5850ec（白字其上需 ≥4.5，按 T4 调） |
| --accent-subtle | rgba(129,140,248,0.14) |
| 语义色 fg | success #4ade80 · attention #fbbf24 · danger #f87171 · done #c4b5fd · neutral #a1a1aa |

角色色（role-*）、阶段色（phase-*）、provider 色保持色相，只在必要时为对比度微调。

### 1.3 新增 token

```
/* 图表分类色板（两主题各一套，色相固定，按序使用） */
--chart-1 indigo  浅 #6366f1 / 深 #818cf8
--chart-2 teal    浅 #14b8a6 / 深 #2dd4bf
--chart-3 amber   浅 #f59e0b / 深 #fbbf24
--chart-4 pink    浅 #ec4899 / 深 #f472b6
--chart-5 sky     浅 #0ea5e9 / 深 #38bdf8
--chart-6 violet  浅 #8b5cf6 / 深 #a78bfa
--chart-7 lime    浅 #84cc16 / 深 #a3e635
--chart-8 slate   浅 #64748b / 深 #94a3b8
--chart-grid      浅 #eef0f3 / 深 #1f1f23   网格线
--chart-axis      = --fg-subtle               坐标轴文字

/* Token 构成固定配色（全站一致） */
--token-input       = chart-1
--token-output      = chart-2
--token-cache-read  = chart-5
--token-cache-write = chart-6

/* 对比页两侧 */
--compare-a = 浅 #64748b / 深 #94a3b8   （基线：中性灰蓝）
--compare-b = 浅 #4f46e5 / 深 #818cf8   （改进：品牌色）

/* 控件与布局 */
--control-height-sm: 28px;  --control-height-md: 32px;  --control-height-lg: 36px;
--sidebar-width: 232px;     --sidebar-width-collapsed: 56px;
--page-header-height: 56px; --page-gutter: 24px;（<768px 时 16px）
--table-row-height: 40px;   --table-row-height-dense: 32px;
--radius-sm: 6px（控件）  --radius-md: 8px（小卡、弹层） --radius-lg: 12px（卡片） --radius-xl: 16px（对话框）
--shadow-xs: 0 1px 2px rgba(16,24,40,0.05)                       卡片
--shadow-sm: 0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)  悬停卡片、分段控件选中块
--shadow-md: 0 12px 24px -6px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06) 弹层、菜单
--shadow-lg: 0 24px 48px -12px rgba(16,24,40,0.24)                对话框、抽屉
（深色主题阴影用更高不透明度的黑，并依赖描边区分层级）
```

契约 §5"阴影只用于浮层"改为：shadow-xs/sm 可用于卡片与选中块，shadow-md/lg 只用于浮层。

### 1.4 字体

```
--font-ui: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
           "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
```

不打包字体文件（本地优先、零依赖），有 Inter 用 Inter，否则系统字体。

字号（全部乘 --ui-scale）：

| 用途 | 字号 / 行高 / 字重 |
|---|---|
| 页面标题 | 20 / 28 / 600，letter-spacing -0.01em |
| 区块标题（卡片标题） | 14 / 20 / 600 |
| 正文、表格 | 13 / 20 / 400 |
| 标签、表头、辅助 | 12 / 16 / 500（表头 fg-muted；标签 fg-subtle） |
| KPI 数字 | 24 / 32 / 600，tabular-nums |
| 大号 KPI（概览首行） | 28 / 36 / 600 |
| 代码、ID | mono 12 / 16 |

全局规则：所有数字所在元素加 `font-variant-numeric: tabular-nums`（提供工具类 `.num`）。

## 2. 布局骨架（App Shell）

```
┌──────────────┬─────────────────────────────────────────────────────────┐
│ ◧ Awesome     │ 任务 / 帮我更新下最新的代码仓…            [⌘K 搜索] [⋯]  │ ← 页面头 56px，sticky
│   Telemetry   ├─────────────────────────────────────────────────────────┤
│               │                                                         │
│ 观测          │   页面内容（padding 24px，背景 canvas-inset）            │
│  ▣ 概览       │   卡片 / 表格 白底，圆角 12，描边 border-default         │
│  ☰ 任务       │                                                         │
│  ⇄ 对比       │                                                         │
│ 评测          │                                                         │
│  ⚗ 评测中心   │                                                         │
│  ◎ Agent 边界 │                                                         │
│ 配置          │                                                         │
│  ⌁ 数据接入   │                                                         │
│  ⚙ 设置       │                                                         │
│               │                                                         │
│ ● 实时已连接   │                                                         │
│ 33 会话·57K事件│                                                        │
│ ☼ 中/EN  «    │                                                         │
└──────────────┴─────────────────────────────────────────────────────────┘
```

- **左侧导航**（232px，可折叠成 56px 图标栏，状态存 localStorage，读写 try/catch）：顶部品牌（图标块 + "AwesomeTelemetry"，不要副标题挤在一起）；分组标题 12px 大写字距（观测 / 评测 / 配置）；导航项 32px 高、图标 16px + 文字、圆角 6px；当前项：accent-subtle 底 + accent-fg 文字；悬停：canvas-subtle 底。底部：实时状态（绿点 + "实时已连接"）、会话/事件数与库大小（12px fg-subtle）、主题切换、语言切换、折叠按钮。
- **去掉现有的顶部大头部与底部状态栏**：A- / A+ / R / 设置 / EN / 主题这些按钮不再平铺在顶部。字号调整放进设置 → 外观；主题与语言放在侧栏底部；设置是导航项。全局搜索（⌘K）放在页面头右侧，是一个带图标、占位文字和 kbd 提示的搜索框按钮。
- **页面头**（56px，sticky，背景 canvas-inset，滚动后加底部描边）：左侧面包屑/标题，右侧页面级操作。详情页面包屑形如"任务 / 标题"，标题过长截断，悬停看全称。
- **页面内容**：padding 24px；区块间距 24px；卡片内 padding 16–20px。仪表盘类页面内容最大宽度 1600px 居中；表格类页面铺满。
- **响应式**：≥1280 完整；1024–1279 侧栏默认折叠为图标栏；768–1023 图标栏；<768 侧栏变为页面头左侧的菜单按钮 + 抽屉，页面 padding 16px，卡片单列，表格在卡片内部横向滚动，页面本身永不横向滚动。

## 3. 组件库（src/components/ui/，样式在 src/styles/components/ui.css 等，全部只用 token）

每个组件都要有：默认 / 悬停 / 按下 / 焦点（--focus-ring）/ 禁用 / 加载 状态；中英文案；键盘可用；不换行（`white-space: nowrap`，放不下就截断 + title）。

### 3.1 Button / IconButton
- 变体：`primary`（近黑实底）、`secondary`（白底 + border-default 描边 + shadow-xs）、`ghost`（透明，悬停 canvas-subtle）、`danger`（红实底）、`link`（accent-fg 文字）。
- 尺寸：sm 28px（padding 0 10px，12px 字）、md 32px（padding 0 12px，13px 字，默认）、lg 36px。
- 图标按钮：正方形，sm 28 / md 32，图标 16px，必须有 aria-label 与 title。
- 可带前置图标（16px，间距 6px）和后置 kbd。按钮组（ButtonGroup）相邻按钮合并圆角。

### 3.2 输入类
- **Input / SearchInput**：32px 高，圆角 6px，border-default，白底；悬停 border-strong；焦点 accent 描边 + focus-ring。SearchInput 左侧放搜索图标，右侧有清除按钮。
- **Select**（自研，不用原生弹出列表）：触发器外观同 Input（文字 + 右侧 chevron），点击弹出 Popover 列表（shadow-md、圆角 8px、选项 32px 高、选中项右侧 ✓、悬停 canvas-subtle），支持键盘（↑↓ Enter Esc、首字母跳转）、`role="combobox"` + `listbox/option` 语义，可带选项图标/色点（例如 provider 色点）。可选 `prefix` 标签（如"工具：全部"）。表单里如需原生 select，必须使用统一的 `.select-native` 样式（appearance:none + chevron 图标 + 同高同圆角）。
- **Combobox / MultiCombobox**：带搜索框的弹出列表，用于任务选择（对比页）、成员选择等；选中的项在触发器里显示为 Chip（可 × 移除），超过 2 个显示"+N"。列表项可以是两行（标题 + 元信息），支持分页加载"加载更多"。
- **SegmentedControl**：用于 2–5 个互斥选项（时间范围 24 小时/7 天/30 天/全部、来源 采集/导入、视图切换）。外框 canvas-subtle 底、圆角 8px、内边距 2px；选中块白底 + shadow-sm + fg-default 文字；未选 fg-muted。高度 32px（sm 28px）。
- **Checkbox / Radio / Switch**：自绘（appearance:none）。Checkbox 16px、圆角 4px，选中 accent-emphasis 实底 + 白色 ✓，半选态 —；Switch 32×18 胶囊，开启 accent-emphasis。
- **Field**：表单行：标签（13px 500）+ 描述（12px fg-subtle）在左或上，控件在右或下；错误文字 danger-fg 12px。

### 3.3 展示类
- **Badge**：高 20px、padding 0 6px、圆角 6px、12px 500 字；变体 neutral（canvas-subtle 底 fg-muted 字）、accent、success、attention、danger、done；可带 6px 圆点或 12px 图标。状态徽标统一：成功=success、失败=danger、进行中=accent（带脉冲点）、未知=neutral。
- **ProviderBadge**：provider 色 8px 圆点 + 名称（Codex、Claude Code…），neutral 底。
- **Pill（指标药丸，Langfuse 式）**：图标 + 值，例如 `⏱ 49.2s`、`⇅ 292.7K tokens`、`◎ 1 错误`，canvas-subtle 底，用于标题下的元信息行。
- **Card**：canvas-raised 底、border-default 描边、圆角 12px、shadow-xs。结构：CardHeader（标题 14/600 + 可选描述 12 fg-subtle + 右侧操作区 + 可选 ⓘ 口径提示）、CardBody、CardFooter（12px fg-subtle）。卡片内表格贴边（左右无 padding，首尾行与卡片对齐）。
- **StatCard（KPI）**：标签（12px 500 fg-subtle，可带 16px 图标）→ 数值（24/600 tabular，单位 13px fg-muted）→ 底部一行：变化 Chip（▲/▼ + 百分比，按"越高越好/越低越好"着色 success/danger，持平 neutral）+ 对比说明"较前 7 天"；右侧或底部可放 Sparkline（高 32px，chart-1 描线 + 10% 填充）。未知值显示"—"并在 ⓘ 里给原因。StatCard 网格：`repeat(auto-fit, minmax(200px, 1fr))`，间距 16px。
- **MetricStrip**（详情页摘要条）：一张卡片里横排多个"标签在上、数值在下"的指标项，项与项之间用竖分隔线；窄屏自动换成 2–3 列网格，**绝不出现一行文字串**。
- **Callout**：信息/警告/错误提示条：左侧 16px 图标、标题 13/600、正文 13 fg-muted，底色对应 subtle，圆角 8px。用于"单样本，不能证明因果"、限制说明、降级提示。
- **EmptyState**：居中；40px 图标块（canvas-subtle 底圆角 10px）+ 标题 14/600 + 描述 13 fg-muted（最多两行）+ 主操作按钮。
- **Skeleton**：canvas-subtle 底、圆角 6px、微弱 shimmer（尊重 prefers-reduced-motion）。表格加载用 6 行骨架行，卡片加载用骨架块，**不要出现"加载中..."裸文字**。
- **Tooltip**：深色小浮层（fg-default 底、canvas-default 字、12px、圆角 6px、最大宽 280px），300ms 延迟，键盘焦点同样触发。所有截断文字、精确数值、口径说明都用它。
- **Popover / DropdownMenu**：canvas-overlay 底、border-default、圆角 8px、shadow-md；菜单项 32px、图标 16px、分组标题 12px fg-subtle、分隔线 border-muted；危险项 danger-fg。
- **Sheet（右侧抽屉）**：宽 min(640px, 100vw)，canvas-overlay 底，shadow-lg，头部（标题 + 描述 + 关闭）sticky，底部操作区 sticky。用于健康报告、任务预览等。
- **Dialog**：圆角 16px、shadow-lg、遮罩 --backdrop 加 4px 背景模糊。
- **Toast**：右下角，canvas-overlay 底、shadow-md、图标 + 文字，3 秒自动消失（复制成功、保存成功、错误）。
- **Tabs**：两种。页面级 `underline`：40px 高，文字 13/500 fg-muted，当前项 fg-default + 2px accent 下划线，可带计数 Badge；卡片内 `pill`：canvas-subtle 底的小分段样式。
- **Steps**：横向步骤条（序号圆 20px + 标题），当前步 accent、已完成 ✓ success、未开始 fg-subtle，连接线 border-default。
- **Accordion / Disclosure**：替代现在裸露的 ▶ details：整行可点、右侧 chevron 旋转动画、标题 13/600、展开内容有上分隔线。
- **CopyField**：只读值（地址、token、ID）+ 复制按钮（复制后图标变 ✓ 并出 Toast）+ 可选"显示/隐藏"。
- **KeyValue / DescriptionList**：两列定义列表（标签 fg-subtle 12px、值 13px），用于详情与报告元信息。

### 3.4 表格（DataTable 样式与 Table 组件）
- 放在 Card 里；表头 canvas-subtle 底、12px 500 fg-muted、高 36px、sticky；行高 40px（dense 32px）；行分隔 border-muted；悬停 canvas-subtle；选中 accent-subtle；可点击行整行 cursor:pointer，并在行首显示 2px 状态色条（失败=danger，告警=attention，可选）。
- 数字列右对齐 + tabular-nums；文本列左对齐，单行截断 + Tooltip；时间列显示相对时间（"3 天前"）并在 Tooltip 给绝对时间。
- 首列复选框 40px 宽；行尾操作列只在悬停/聚焦时显示 ⋯ 菜单（触屏常显）。
- 表格宽度超出时**只在卡片内部**横向滚动，首列（标题）sticky。
- 底部分页：左"共 12 个任务"，右"1–12 / 12 ‹ ›"与每页条数 Select。
- 批量操作：选中 ≥1 行时，表格顶部出现浮起的操作条（"已选 2 项 · 设为基线 · 设为改进 · 对比 · 清除"），不要把这些按钮常驻在工具条里。
- 子行（例如任务下的请求）：缩进 24px、首列显示 ↳ 与序号、背景 canvas-subtle 的 50%。

### 3.5 图表（src/components/charts/，SVG 自绘，零依赖，统一外观）
统一规则：卡片内展示；标题 + 描述在 CardHeader；图例在右上（色点 + 名称 + 可选数值）；网格线 --chart-grid 水平虚线；坐标轴 12px --chart-axis，不画轴线；数值轴紧凑格式；悬停显示竖向参考线 + Tooltip 卡片（日期 + 每个序列的色点、名称、值）；空数据显示 EmptyState 而不是空白坐标系；图表随容器宽度自适应（ResizeObserver），高度固定（默认 220px）；动画 240ms ease-out（尊重 reduced-motion）。

需要的图表：
- **AreaChart / LineChart**：多序列、可堆叠；线宽 2px、面积 12% 填充渐变；点只在悬停显示。
- **BarChart**：纵向、可堆叠/分组，柱宽自适应、圆角顶部 3px、柱间距 30%。
- **BarList**（Helicone 式排行）：每行一个浅色底条（长度按占比，chart-1 的 12% 色）+ 左侧标签 + 右侧数值，行高 32px，最多 8 行，"查看全部"展开。
- **DonutChart**：环宽 14%，中心显示总数（24/600）与标签；扇区间 2px 间隙；右侧/下方图例带百分比。**不用实心饼图。**
- **Sparkline**：32px 高的迷你折线/面积，无坐标轴。
- **Meter / ProgressBar**：6px 高圆角条，用于缓存命中率、覆盖率；可带阈值着色。
- **Histogram**：用于任务列表顶部"按天任务数"（可选）。

### 3.6 图标（src/components/icons/）
16×16 viewBox、1.5px 描边、round 端点（Lucide 风格，自绘路径，不引依赖）。需要新增：dashboard、list、git-compare、flask、network、plug、settings、search、filter、chevron-down/up/left/right、check、x、plus、minus、more-horizontal、refresh、external-link、copy、download、upload、alert-triangle、alert-circle、check-circle、x-circle、info、clock、hourglass、cpu、database、zap（缓存）、coins 不要（不展示钱）、user、bot、users、wrench、terminal、file-text、eye、eye-off、sun、moon、languages、panel-left、arrow-up、arrow-down、trending-up、trending-down、play、pause、sparkles、layers、message-square、git-branch。契约 REQ-004 图标清单同步更新（T6）。

## 4. 格式规则（全站统一，集中在一个 format 模块）

| 类型 | 规则 | 示例 |
|---|---|---|
| Token | <1000 原样；K/M/B 紧凑，3 位有效数字；Tooltip 给精确值（千分位） | 292.7K · 53.3M · 1.21B |
| 百分比 | 一位小数；<0.1% 显示 "<0.1%" | 87.4% |
| 时长 | <1s 用 ms；<60s 一位小数秒；<1h "m 分 s 秒"；<1d "h 小时 m 分"；≥1d "d 天 h 小时" | 820ms · 49.2秒 · 1分3秒 · 4天7小时 |
| 时间（列表） | 相对时间："刚刚 / 5 分钟前 / 3 小时前 / 昨天 14:20 / 10月25日"，Tooltip 给 "2026-10-25 19:30:55" | |
| 时间（详情） | "10月25日 19:30:55"（同年省略年份） | |
| 计数 | 千分位 | 2,409 |
| 未知 | "—"（不是"未知"两个字堆满表格），ⓘ/Tooltip 说明原因 | |
| 部分覆盖 | 数值后跟小号 Badge "部分 16/21"，Tooltip 列出缺失成员 | |

英文界面同理（K/M/B、"3d ago"）。

## 5. 文案与密度规则
- 一个区块最多一句说明（12px fg-subtle，放在标题下）；更多口径/限制放进 ⓘ Tooltip 或 Accordion"计算口径"。
- 按钮文案 2–4 个字；同一动作全站同名（"设为基线""设为改进""对比""健康监测""导出"）。
- 不出现开发者术语与内部字段名（如 MissionDayPoint.day、calc 4 / rules 2 这类放进"报告详情"折叠区）。
- 所有页面不出现任何金钱信息（费用、价格、币种）。Token 与缓存命中率是成本的唯一代理指标。

## 6. 交互规则
- 列表行整行可点进入详情；复选框、⋯ 菜单阻止冒泡。
- 所有筛选状态进 URL（可分享），刷新不丢；改变筛选不重置滚动以外的状态。
- 加载用骨架；局部刷新不闪整页；错误用 Callout + "重试"。
- 键盘：⌘K 全局搜索；表格 ↑↓ 移动焦点行、Enter 打开；Esc 关闭弹层/抽屉。
- 动效只用于：弹层出现（160ms 淡入 + 4px 位移）、抽屉滑入（240ms）、Accordion 展开、骨架 shimmer。
- 复制、保存等动作给 Toast 反馈。

## 7. 页面蓝图

### 7.1 概览（#/overview）
- 页面头：标题"概览"；右侧：时间范围 SegmentedControl（24 小时 / 7 天 / 30 天 / 全部）、工具 Select（全部工具 + provider 色点）、刷新 IconButton。
- 第一行 StatCard（6 个，自适应网格）：任务数、Token 总量（修正口径）、缓存命中率、任务失败率、工具失败率、告警任务（可点 → 跳到任务列表"仅看告警"）。每个带 Sparkline（按天）与"较前一周期"变化（数据不足就不显示变化，不编造）。
- 图表区（≥1200 两列，窄屏一列）：
  1) Token 用量趋势（按天堆叠柱：输入/输出/缓存读/缓存写，固定 token 配色）
  2) 任务与失败（按天柱：任务数，失败数叠加为 danger 色）
  3) 缓存命中率趋势（折线，0–100%）
  4) 工具失败率排行（BarList：工具名、失败/调用、失败率）
  5) 模型 Token 分布（DonutChart）
  6) 工具（provider）任务分布（DonutChart 或 BarList）
  7) 最近告警任务（卡片内小表格：任务、告警、时间，行可点）
- 旧的"Agent 概览 / 页内分组（管理者/工程师/运维）"如仍有独有数据，合并进上面的图表或放到第二个页签"Agent 视角"，用同一套图表组件重画；纯重复的删掉。

### 7.2 任务列表（#/task，无选中任务时）
- **不再显示左侧任务栏**（表格就是列表）；页面铺满。
- 页面头：标题"任务" + 计数 Badge；右侧："健康阈值"ghost 按钮、刷新 IconButton。
- 工具条（一行，窄屏折两行，控件本身不换行）：SearchInput（搜索标题、会话 ID）· SegmentedControl 来源（采集 / 导入）· Select 工具 · SegmentedControl 时间（24 小时 / 7 天 / 30 天 / 全部）· DropdownMenu"筛选"（有告警 / 有错误 / 主会话记录失败 / 有工具失败结果，选中后按钮显示计数 Badge）· Select 排序（最近活动 / 开始时间 / 时长 / 错误数 / Token / 缓存命中）+ 升降序 IconButton。
- 表格列：☐ | 任务（标题单行截断 + 下方 12px 元信息：ProviderBadge · "8 个请求 ▾"可展开）| 状态（Badge + 告警图标带 Tooltip）| 最近活动（相对时间）| 时长 | 成员 | 工具调用 | 错误（>0 时 danger-fg）| Token（紧凑）| 缓存命中（百分比 + 48px Meter）| 健康（最近标准报告："3 个问题"attention / "无问题"success / "未分析"neutral）| ⋯（健康监测、设为基线、设为改进、复制链接）。
- 默认排序"最近活动"降序；列表显示的时间必须就是排序依据的时间（修复现在"按开始时间排却显示另一个时间"的问题），开始时间放 Tooltip。
- 选中行后出现批量操作条（设为基线 / 设为改进 / 对比 / 清除）。
- 展开请求：子行显示 序号、请求标题、时长、工具调用、错误、Token、缓存命中、告警。
- 空状态：图标 + "还没有任务" + "去数据接入"主按钮。

### 7.3 任务详情（#/task?task=…）
- 页面头：面包屑"任务 / 标题"；右侧：上一个/下一个任务 IconButton、分享（复制链接 IconButton）、"健康监测"primary 按钮、⋯ 菜单（设为基线、设为改进、在对比中打开、导出）。
- 标题区（卡片外、页面头下）：标题 20/600（两行截断）+ 元信息药丸行：ProviderBadge · 状态 Badge · `⏱ 时长` · `👥 成员` · `⚡ 事件` · 模型。
- **请求导航**：一个紧凑控件组：SegmentedControl"全任务 | 按请求"，选"按请求"时出现 `‹  请求 3 / 8 · 标题…  ›` 与可搜索的请求 Select（每项：序号、标题、时间、Token）。
- **MetricStrip** 指标卡：时长、工具调用、错误、输入、输出、缓存读、缓存命中率（Meter）、修正总量、模型；未知"—"+ⓘ，部分覆盖 Badge。
- 页签（underline）：执行轨迹 | 对话 | 原始事件 | 架构。前两个内部内容不动。原始事件用新表格样式；架构用新卡片 + 图。
- 左侧任务切换栏：默认隐藏；页面头有"任务列表"IconButton（panel-left），打开时作为 280px 左侧面板（紧凑卡片：标题 2 行、provider 点、相对时间、Token），不再放 A/B 按钮。
- **健康监测**：右侧 Sheet。头部：标题"健康监测"+ 范围（全任务 / 请求 N）Select + 生成按钮；内容：总览 StatCard（问题数按严重度、覆盖率 Meter），问题列表（每条：严重度 Badge、规则名、一句话结论、"查看证据"按钮组、建议），报告元信息放 Accordion"报告详情"。超过事件上限时顶部 Callout 引导按请求分析，并直接给请求列表。

### 7.4 对比（#/compare）
- 页面头：标题"对比"+ 一句说明（"比较优化前后的执行差异"）；右侧：最近对比 DropdownMenu、导出 DropdownMenu（Markdown / HTML）。
- **选择区**：两张并排卡片 A 基线（左侧 4px --compare-a 色条）/ B 改进（--compare-b 色条）。每张卡片：MultiCombobox（搜索任务、两行选项：标题 + provider·时间·Token），选中项为 Chip；单任务时下方出现"请求"Select（全任务 / 请求 N）。两卡片中间一个"⇄ 交换"IconButton。未选完整时，下面区域显示 EmptyState（"选择基线和改进任务开始对比"）。**任务列表不能折叠藏起来，点开选择器就能看到并搜索全部任务。**
- **结论**：标题"结论" + 样本说明 Callout（单样本时 attention："单样本，不能证明因果"）。VerdictCard 网格（auto-fit minmax(220px,1fr)）：指标名 · A 值 → B 值（tabular）· 变化 Chip（"▼ 41.2% 变好"success / "▲ 变坏"danger / "持平"neutral / "不可比"虚线描边 neutral + ⓘ 原因）。指标：时长、Token、缓存命中率、错误数、工具失败率、工具调用数、子 Agent 数、健康问题数。
- **指标明细**：Card 内表格：指标 | A | B | 差值 | B/A | 判定 Badge；数值悬停看 n/均值/范围/CV；"未知指标（N）"Accordion。
- **Token 构成**：分组柱状图（输入/输出/缓存读/缓存写，A 用 --compare-a、B 用 --compare-b）+ 缓存命中率 A vs B 两条 Meter。
- **健康差异**：一张卡片，pill Tabs：新出现（N）/ 已消失（N）/ 仍存在（N）/ 证据不足（N）；每条为一行：严重度 Badge、规则名、A 次数/B 次数、建议、"查看证据"按钮。顶部操作"为两侧生成/读取标准健康报告"secondary 按钮（带加载态）。
- **过程对照**：并排时间线（复用 CompareTimeline，套新卡片与配色）；工具差异表：工具 | A 调用 | B 调用 | Δ | A 失败 | B 失败 | 平均耗时 A/B，调用数列内嵌 A/B 双色细条。
- 375px：选择卡片纵向堆叠，VerdictCard 单列，表格卡内滚动。

### 7.5 评测中心（#/benchmark）
- 页面头：标题"评测中心" + 说明；右侧：导入报告（secondary，打开文件选择）、加载示例（ghost）。
- 无数据：大 EmptyState + 拖拽区（虚线边框卡片，"拖入 report.json 或点击选择"）。
- 有数据：报告列表（表格：名称、时间、样本数、通过率 Meter、Token）→ 报告详情：StatCard 行 + 图表（通过率按任务 BarList、Token 分布）+ 明细表。

### 7.6 Agent 边界评测（#/team-experiment）
- 页面头：标题 + 一句说明；右侧："加载官方示例"secondary、"导入项目"secondary（文件）。
- Steps 组件呈现 1 来源 → 2 分工与边界 → 3 案例与覆盖 → 4 单边界试验 → 5 退步与决定；当前步骤内容在下方卡片里。
- 三个现在裸露的 ▶ 折叠区改为 Accordion 卡片（"接入自己的 Agent""离线运行框架验证""高级兼容"），"选择已有任务"用 Combobox 而不是按钮 + 原生下拉。

### 7.7 数据接入（#/intake）
- 页面头：标题"数据接入" + 说明"数据只保存在本机"。
- 通道卡片网格（LangWatch 式：40px 带底色图标块 + 名称 14/600 + 一句描述 + 状态 Badge 已启用/未启用/有新记录 + 右下"配置 →"）：本地日志（9 种编码助手）、OpenTelemetry、文件导入（OTLP/Langfuse/LangSmith/TraceLog）、网络抓包（高级）、Frida（高级，折叠在"高级通道"下）。
- 点卡片进入通道详情（同页下方或二级路由）：
  - OpenTelemetry：启用 Switch；接收地址 CopyField；Bearer token CopyField（显示一次/重新生成）；环境变量示例代码块（带复制，mono）；统计 StatCard（span 数、trace 数、拒绝数）+ 拒绝原因表。
  - 文件导入：拖拽区 + 支持格式说明 + 导入历史表。
  - 本地日志：每个 provider 一行（ProviderBadge、路径、会话数、最近扫描时间、状态 Badge、"扫描"按钮）。

### 7.8 设置（#/settings 或设置页）
- 左侧子导航（常规 / 外观 / 健康监测 / 告警阈值 / 数据与存储 / 关于），右侧表单卡片，每项 Field 左标签描述右控件，布尔用 Switch。
- 外观：主题（SegmentedControl 浅色/深色/跟随系统）、语言、界面字号（SegmentedControl 小/标准/大，替代 A-/A+）。
- 删除模型价格编辑器（不展示钱）。
- 保存方式：即时保存 + Toast，或卡片底部"保存更改"按钮（有改动才可点）。

### 7.9 其他
- 命令面板（⌘K）：居中 Dialog，顶部大搜索框，分组结果（任务 / 页面 / 操作），每项图标 + 标题 + 右侧快捷键，选中项 accent-subtle。
- 错误边界、帮助弹窗、各类 Modal 统一用 Dialog 外观。
- 旧兼容视图（session/agent/proxy/frida/team 等仍可通过旧链接到达的）至少要继承新 token 与新组件外观，不得出现明显未设计的原生控件。

## 8. 质量门槛（协调者会逐条截图验收）
1. 视口 1440×900、1280×800、1024×768、768×1024、375×812，浅色与深色各一遍：页面无横向滚动；按钮、标签、表头、导航文字不换行；控件同行同高；没有元素贴着视口边缘（至少 page-gutter）。
2. 页面上没有任何原生样式的 select / checkbox / radio / file input / details 三角（文件选择用按钮触发隐藏 input）。
3. 没有"加载中..."裸文字、没有空白坐标系、没有"未知"堆满表格。
4. 所有数字 tabular-nums，紧凑格式 + Tooltip 精确值。
5. 任何地方不出现费用 / 价格 / 币种。
6. 执行轨迹、对话页签的内容与交互和改版前一致（只换了 token 外观）。
7. 中英文两种语言下布局都成立（英文更长，不能撑破）。
8. 键盘可达：Tab 顺序合理，焦点环可见，弹层 Esc 可关。
