# Spec: Design System

> 视觉与交互的原子层。数值来源：`contracts/design-tokens.md`（冲突时以契约为准）。
> 源文件：`src/styles/`、`src/components/ui/`、`src/components/icons/`
>
> 本 spec 描述**怎么用**这些 token 和组件；`frontend/spec.md` 描述**页面怎么拼**。

## Purpose

给 Agent Observability 一套开发者工具级别的视觉语言：暗色优先、信息密集、语义克制、零外部依赖。
消除现状——72 行硬编码 CSS、无主题、无图标、无加载/空/错态——带来的「能跑但不能用」体感。

---

## Requirements

### REQ-001: token 单一来源

全部设计 token SHALL 定义在 `src/styles/tokens.css` 的 `:root` 与 `[data-theme="light"]` 两个块中，
值逐条对齐 `contracts/design-tokens.md` §2–§7。

`src/styles.css`（现状 72 行硬编码）SHALL 被拆解为：

```
src/styles/
├── tokens.css      ← 只有 :root / [data-theme] 变量声明，无选择器规则
├── base.css        ← reset、html/body、滚动条、焦点环、选中态
├── layout.css      ← app shell 骨架（header/tabs/rail/main/inspector/statusbar）
└── components.css  ← 通用组件类（.btn/.badge/.field/.table/...）
```

`src/main.tsx` 按 `tokens → base → layout → components` 顺序引入，顺序不可颠倒。

#### Scenario: 主题切换无闪白
- **GIVEN** 用户在暗色主题下点击主题切换
- **WHEN** `data-theme` 从 `dark` 变为 `light`
- **THEN** MUST NOT 发生整页重载
- **AND** MUST NOT 出现任何一帧的白底闪烁（token 切换在同一帧内完成）

#### Scenario: 首帧无错误主题
- **GIVEN** 用户上次选择了 `light`，现在刷新页面
- **THEN** `index.html` 内的**内联**同步脚本 MUST 在 CSS 应用前读 localStorage 并设置 `data-theme`
- **AND** MUST NOT 先渲染暗色再跳到亮色

---

### REQ-002: 禁止字面量样式值

`src/**/*.css` 与组件内联 `style` 中，除 `tokens.css` 外 MUST NOT 出现：

- 字面量颜色（`#rgb` / `#rrggbb` / `rgb()` / `hsl()`）
- 字面量间距 / 字号（`0`、`0px`、`1px` 描边、`100%`、`999px` 等无歧义值除外）

只允许 `var(--*)`，以及由 token 参与的 `calc()`。

> **为什么**：现状 72 行 CSS 里散落 30+ 个硬编码 hex，没有任何一处能被主题覆盖。
> 这是「加不上暗色模式」的根因，不是审美问题。

由 `contracts/design-tokens.md` §9 的 T2 / T3 断言在 CI 中强制。

---

### REQ-003: 主题控制

SHALL 提供三态主题切换：`system`（默认）/ `dark` / `light`。

| 项 | 约定 |
|----|------|
| 持久化 | localStorage `agent-observability.theme` |
| 默认 | `system`；系统无偏好时解析为 `dark` |
| 入口 | 全局头右侧图标按钮，循环 system → dark → light |
| 图标 | `system` → `device-desktop`；`dark` → `moon`；`light` → `sun` |
| 系统联动 | `system` 下 MUST 监听 `matchMedia('(prefers-color-scheme: dark)')` 的 change 并实时跟随 |

---

### REQ-004: 图标集

SHALL 提供 `src/components/icons/index.tsx`，导出下列**且仅下列** 47 个图标组件。
实现约束见 `contracts/design-tokens.md` §8（16×16 网格、`currentColor`、零依赖、内联 SVG）。

统一封装：

```tsx
export interface IconProps {
  size?: 12 | 16 | 20 | 24;   // 默认 16
  className?: string;
  /** 省略 = aria-hidden 装饰图标；提供 = role="img" 并渲染 <title> */
  label?: string;
}
```

**导航 / 视图（8）**

| 名称 | 用途 |
|------|------|
| `IconSessions` | 会话视图 |
| `IconAgents` | Agent 概览视图 |
| `IconCompare` | 对比视图（git-compare 形） |
| `IconProxy` | 代理视图（双向箭头形） |
| `IconFrida` | Frida 视图（cpu 形） |
| `IconSidebar` | 折叠/展开左栏 |
| `IconPanel` | 折叠/展开右栏 |
| `IconCommand` | ⌘ 命令面板 |

**Phase（6）** — 与 `--phase-*` 一一对应，MUST 与颜色同时出现

`IconUnderstand`(telescope) · `IconPlan`(checklist) · `IconImplement`(code) ·
`IconDebug`(bug) · `IconVerify`(beaker) · `IconReport`(report)

**状态（6）**

`IconSuccess`(check-circle) · `IconError`(x-circle) · `IconRunning`(dot-fill) ·
`IconPending`(clock) · `IconCancelled`(skip) · `IconWarning`(alert)

**事件类型（6）** — 对应 `TraceEvent.kind`

`IconMessage` · `IconTool` · `IconFile` · `IconTerminal` · `IconThought` · `IconSystem`

**指标（4）** — 快 / 准 / 稳 / 省

`IconSpeed`(zap) · `IconAccuracy`(shield-check) · `IconStability`(pulse) · `IconCost`(coin)

**操作（12）**

`IconSearch` · `IconFilter` · `IconRefresh` · `IconCopy` · `IconDownload` ·
`IconExternalLink` · `IconTrash` · `IconClose` · `IconChevronRight` ·
`IconChevronDown` · `IconKebab` · `IconPlus`

**其它（5）**

`IconGear`(设置) · `IconGlobe`(语言) · `IconSun` · `IconMoon` · `IconDeviceDesktop`

> 合计 8+6+6+6+4+12+5 = **47**。清单以本表逐项枚举为准，
> `contracts/design-tokens.md` §9 的 T6 断言导出名集合与本表严格相等。
> 三个主题图标 MUST 各自独立，MUST NOT 互相复用路径。

#### Scenario: 图标不承载孤立语义
- **GIVEN** 甘特行渲染某个 phase
- **THEN** MUST 同时渲染 phase 图标与 phase 色
- **AND** 图标的 `label` MUST 为 i18n 后的 phase 名（供读屏器）

---

### REQ-005: 基础组件清单

SHALL 提供 `src/components/ui/` 下的通用组件。每个组件 MUST 是无业务逻辑的纯展示件。

| 组件 | 变体 / 关键 props | 说明 |
|------|------------------|------|
| `Button` | `variant: primary｜default｜danger｜ghost`，`size: sm(24px)｜md(28px)`，`icon`, `loading`, `disabled` | 默认 `default`；`ghost` 用于密排行内 |
| `IconButton` | 同上 + 必填 `label` | 命中区 ≥ 24×24，MUST 有 tooltip |
| `Badge` | `tone: accent｜success｜attention｜danger｜done｜neutral`，`variant: subtle｜solid` | 圆角 `--radius-sm`，`--text-xs` |
| `StatusBadge` | `status: TraceStatus` | 按契约 §2.4 映射色 + 图标 + i18n 文字 |
| `PhaseBadge` | `phase: TracePhase` | 色 + 图标 + i18n 文字 |
| `ProviderBadge` | `provider: ProviderKey`，`showLabel?` | 字母章，色见契约 §2.6 |
| `Field` | `label`, `hint`, `error`, 包裹 input/select | 统一表单行 |
| `Input` / `Select` | `size: sm｜md`，`icon?` | 与 Button 等高 |
| `SearchInput` | 内置 `IconSearch` + 清除按钮 + `/` 聚焦 | |
| `Tabs` | `variant: underline｜pill` | 视图切换用 `underline`（GitHub 式） |
| `Table` | `density: compact｜default`，`sortable`, `sticky header` | 表头 `--canvas-subtle` + sticky |
| `Tooltip` | `placement`, 延迟 400ms | 纯 CSS + 少量 JS 定位，不引库 |
| `Popover` / `DropdownMenu` | Esc 关闭、点外关闭、焦点回归 | |
| `Modal` | `size: sm｜md｜lg`，焦点陷阱 | 复用于 Transcript / Token / Settings |
| `Drawer` | 右侧滑入 | proxy 请求详情用 |
| `Skeleton` | `variant: text｜row｜block`，`count` | 见 REQ-006 |
| `EmptyState` | `icon`, `title`, `description`, `action?` | 见 REQ-006 |
| `ErrorState` | `code`, `message`, `onRetry` | 见 REQ-006 |
| `Toast` | `tone`, 自动消失 4s，可堆叠 | 见 REQ-007 |
| `Kbd` | 渲染键位 | `⌘K` / `j` / `Esc` |
| `MetricCard` | `icon`, `label`, `value`, `unit`, `trend?` | 快准稳省 KPI |
| `BarMeter` | `value`, `max`, `tone` | 表格内联条形图 |
| `Sparkline` | `points: number[]` | 内联 SVG，无依赖 |
| `SplitPane` | `direction`, `min`, `max`, 持久化宽度 | 左右栏拖拽 |
| `VirtualList` | 复用既有 `useVirtualList` | 见 frontend REQ-006 |

---

### REQ-006: 四态渲染契约（**修复「点击后无法加载」的核心**）

任何发起异步请求的界面区域 SHALL 显式渲染下列四态之一，MUST NOT 存在「什么都不显示」的第五态。

| 态 | 触发 | 渲染 |
|----|------|------|
| **loading** | 请求在途且无缓存 | `Skeleton`，形状贴合最终内容（列表→行骨架，表格→表骨架） |
| **empty** | 请求成功且结果为空 | `EmptyState`：图标 + 一句原因 + 可执行的下一步 |
| **error** | 请求 reject / 非 2xx | `ErrorState`：错误码 + i18n 文案 + **重试按钮** |
| **ready** | 有数据 | 正常内容 |

外加一个业务态：**pending**（详情 `pending: true`，解密中）→ 占位 + 等 SSE，MUST NOT 轮询（既有 REQ-009）。

#### Scenario: 禁止静默吞错
- **GIVEN** 任意 `fetch` 失败（网络断开、500、超时）
- **THEN** 该区域 MUST 进入 error 态并显示错误码与重试按钮
- **AND** `catch` 块 MUST NOT 为空、MUST NOT 只写注释
- **AND** MUST 同时 `console.error` 原始错误，便于开发者在控制台定位

> **为什么单列一条**：现状 `SampleRail.tsx:40`、`App.tsx` 的 `selectSession`、
> `EventInspector` 的 `loadDetail` 三处 `catch` 全是空注释。
> 任何一次失败的表现都是「点了没反应」——这正是本次要修的头号体感问题。
> 由 `frontend/spec.md` REQ-021 的测试强制。

#### Scenario: 骨架不跳变
- **GIVEN** 会话列表处于 loading 态
- **THEN** 骨架行高 MUST 等于真实行高（`--row-lg`）
- **AND** 数据到达时 MUST NOT 发生布局跳动（CLS = 0）

---

### REQ-007: 反馈与通知

- 破坏性操作（删除会话、停止代理）SHALL 二次确认（`Modal` 或行内确认），MUST NOT 直接执行。
- 后台动作结果（扫描完成、配置已存、代理已启动）SHALL 用 `Toast`，MUST NOT 用 `alert()`。
- 长耗时动作（首次扫描、Trae 解密）SHALL 在状态栏显示进行中指示，而非阻塞界面。
- 复制类操作 SHALL 就地反馈（图标短暂变 `IconSuccess`），无需 Toast。

---

### REQ-008: 键盘与命令面板

SHALL 支持下列快捷键。冲突时以输入框聚焦状态为准（聚焦输入框时只有 `Esc` 生效）。

| 键 | 行为 |
|----|------|
| `⌘K` / `Ctrl+K` | 打开命令面板 |
| `1`–`5` | 切到第 n 个视图 |
| `/` | 聚焦当前视图的搜索框 |
| `j` / `k` | 列表下移 / 上移 |
| `Enter` | 打开选中项 |
| `Esc` | 关闭浮层 / 清除选择 |
| `[` / `]` | 折叠 / 展开 左栏 / 右栏 |
| `⌘\` | 切换主题 |
| `?` | 快捷键帮助浮层 |

**命令面板**（`CommandPalette`）SHALL 支持：跳转会话（按标题/id 模糊匹配）、切换视图、
切换主题/语言、触发扫描、打开设置。列表 MUST 虚拟滚动（会话可达数百条）。

#### Scenario: 命令面板不拖慢首屏
- **GIVEN** 应用首次加载
- **THEN** 命令面板组件 MUST 懒加载（首次按 `⌘K` 才实例化）
- **AND** MUST NOT 在首屏预取会话全量列表

---

### REQ-009: 可访问性

| 项 | 要求 |
|----|------|
| 对比度 | 达到 `contracts/design-tokens.md` §2.7 全部组合 |
| 焦点 | 所有可交互元素有 `:focus-visible` 环；浮层内焦点陷阱；关闭后焦点回归触发元素 |
| 语义 | 视图切换用 `role="tablist"`；列表用 `role="listbox"` + `aria-selected`；模态用 `role="dialog"` + `aria-modal` |
| 动态区 | 状态栏的 live 指示、Toast 用 `aria-live="polite"` |
| 颜色 | 见 REQ-004 Scenario，颜色永不单独承载语义 |
| 减弱动效 | `prefers-reduced-motion` 下动画归零 |
| 缩放 | 200% 缩放下无横向滚动、无内容截断 |

---

### REQ-010: 性能约束

设计不得违反 `contracts/nfr.md` 的既有预算。额外约束：

| 项 | 预算 |
|----|------|
| CSS 总量（gzip 后） | < 16KB |
| 图标集总量（未压缩） | < 12KB |
| 主题切换到重绘完成 | < 16ms（一帧） |
| 新增 runtime 依赖 | **0**（`project.md` §2 硬约束） |
| 虚拟滚动容器内 CSS 过渡 | **禁止** |

#### Scenario: 密排列表滚动不掉帧
- **GIVEN** 会话列表 500 条、事件树 9,590 条
- **WHEN** 连续滚动 3 秒
- **THEN** 掉帧率 < 5%
- **AND** 行内 MUST NOT 有 `box-shadow` / `filter` / `backdrop-filter`

---

## Gotchas

- **G-DS-1**：`--row-sm` / `--row-lg` 是虚拟滚动的 `itemHeight` 输入，改动会同时改变
  offset 计算。改这两个 token 必须同步核对 `useVirtualList` 的测试。
- **G-DS-2**：主题脚本必须**内联同步**在 `index.html` 的 `<head>`，不能进 bundle——
  进 bundle 就晚于首帧 CSS，必闪。
- **G-DS-3**：`prefers-color-scheme` 的监听要用 `addEventListener('change')`，
  Safari 14 以下的 `addListener` 已废弃，本项目 Node ≥ 20 / 现代浏览器，不做兼容。
- **G-DS-4**：不要给 `.rail-row` 加 `transition: background`——列表虚拟滚动时行会被复用，
  过渡会造成 hover 色拖影。
- **G-DS-5**：CJK 字体栈里 `PingFang SC` 必须在 `Microsoft YaHei` 之前，
  否则 macOS 上中文会落到不存在的字体再回退，字重发虚。
