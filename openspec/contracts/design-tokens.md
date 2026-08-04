# Contract: Design Tokens

> 视觉系统的**权威数值来源**。与 `data-model.md` / `database.md` / `api.md` / `nfr.md` 同级：
> 组件实现冲突时以本文件为准。
>
> 落地位置：`src/styles/tokens.css`（唯一定义处）。
> **任何组件 CSS 中不得出现字面量颜色 / 字面量间距**，只允许引用 `var(--*)`。
> 这条是可测的，见 `specs/design-system/spec.md` REQ-002。

---

## 0. 设计立场

本项目是给开发者看的可观测工具，参照 GitHub / Linear / Grafana 一类工具的取舍：

| 原则 | 含义 | 反面 |
|------|------|------|
| **暗色优先** | 默认跟随系统，无系统偏好时用暗色 | 亮色默认，夜里刺眼 |
| **中性灰承担结构** | 层级靠 canvas 明度差 + 1px 描边表达 | 到处上色、彩色卡片 |
| **颜色只表达语义** | 颜色 = phase / status / diff，不做装饰 | 品牌色铺满界面 |
| **描边优于阴影** | 平面化，阴影只用于浮层（popover/modal） | 卡片投影堆叠 |
| **密度即尊重** | 单屏信息量最大化，等宽字承载 ID 与数字 | 大留白、大圆角、大卡片 |
| **颜色永不单独承载信息** | 颜色必配图标或文字 | 只靠色点区分 6 个 phase |

---

## 1. 主题机制

```
<html data-theme="dark">   ← 显式选择
<html data-theme="light">
<html>                     ← 未选择：跟随 prefers-color-scheme，无偏好时按 dark
```

- 持久化键：`agent-observability.theme`，取值 `dark` | `light` | `system`，默认 `system`。
  （与既有 `agent-observability.locale` 同一命名空间）
- 主题切换 MUST 不触发整页重载，MUST 不产生首帧闪白：
  token 定义在 `:root`，切换只改 `data-theme` 属性。
- 两套主题的 token **键名完全一致**，只有值不同。缺键即为契约违例。

---

## 2. 颜色

### 2.1 Canvas（背景层级，由深到浅）

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--canvas-inset` | `#010409` | `#f6f8fa` | 滚动容器底、代码块底 |
| `--canvas-default` | `#0d1117` | `#ffffff` | 应用主背景 |
| `--canvas-subtle` | `#161b22` | `#f6f8fa` | 侧栏、次级面板、表头 |
| `--canvas-raised` | `#1c2128` | `#ffffff` | 卡片、行 hover |
| `--canvas-overlay` | `#21262d` | `#ffffff` | 浮层：菜单 / popover / modal |

### 2.2 Border

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--border-default` | `#30363d` | `#d1d9e0` | 常规分隔线、输入框 |
| `--border-muted` | `#21262d` | `#e4e8ec` | 列表行内分隔（更弱） |
| `--border-strong` | `#6e7681` | `#8c959f` | hover 态、聚焦前的强调边 |

### 2.3 Foreground

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--fg-default` | `#e6edf3` | `#1f2328` | 正文 |
| `--fg-muted` | `#8b949e` | `#59636e` | 次要文字、标签 |
| `--fg-subtle` | `#6e7681` | `#818b98` | 占位符、禁用态 |
| `--fg-on-emphasis` | `#ffffff` | `#ffffff` | 实心强调底上的文字 |

### 2.4 语义色

每组三档：`-fg`（文字/图标）、`-emphasis`（实心底）、`-subtle`（浅底/badge 底）。

| 组 | Token 前缀 | Dark fg / emphasis / subtle | Light fg / emphasis / subtle | 语义 |
|----|-----------|------------------------------|-------------------------------|------|
| accent | `--accent-` | `#4493f8` / `#1f6feb` / `rgba(56,139,253,.15)` | `#0969da` / `#0969da` / `rgba(9,105,218,.1)` | 选中、链接、主按钮 |
| success | `--success-` | `#3fb950` / `#238636` / `rgba(46,160,67,.15)` | `#1a7f37` / `#1f883d` / `rgba(26,127,55,.1)` | 成功、验证通过 |
| attention | `--attention-` | `#d29922` / `#9e6a03` / `rgba(187,128,9,.15)` | `#9a6700` / `#bf8700` / `rgba(154,103,0,.1)` | 警告、进行中 |
| danger | `--danger-` | `#f85149` / `#da3633` / `rgba(248,81,73,.15)` | `#d1242f` / `#cf222e` / `rgba(209,36,47,.1)` | 错误、失败 |
| done | `--done-` | `#ab7df8` / `#8957e5` / `rgba(163,113,247,.15)` | `#8250df` / `#8250df` / `rgba(130,80,223,.1)` | 已完成、归档 |
| neutral | `--neutral-` | `#8b949e` / `#6e7681` / `rgba(110,118,129,.15)` | `#59636e` / `#6e7681` / `rgba(89,99,110,.1)` | 未知、空 |

**status → 语义色映射**（`TraceSession.status` / `TraceEvent.status`）：

| status | 组 | 图标 |
|--------|----|------|
| `success` | success | `check-circle` |
| `error` | danger | `x-circle` |
| `running` | attention | `dot-fill`（脉冲动画） |
| `pending` | neutral | `clock` |
| `cancelled` | neutral | `skip` |

### 2.5 Phase 色（产品signature，6 色）

`TRACE_PHASES` 的六个阶段。**MUST 同时使用图标**，颜色不得单独承载语义（见 §2.7）。

| phase | Token | Dark | Light | 图标 | 语义 |
|-------|-------|------|-------|------|------|
| understand | `--phase-understand` | `#39c5cf` | `#1b7c83` | `telescope` | 读代码、探索 |
| plan | `--phase-plan` | `#a371f7` | `#8250df` | `checklist` | 规划、拆解 |
| implement | `--phase-implement` | `#58a6ff` | `#0969da` | `code` | 写代码、改文件 |
| debug | `--phase-debug` | `#f0883e` | `#bc4c00` | `bug` | 排错、重试 |
| verify | `--phase-verify` | `#3fb950` | `#1a7f37` | `beaker` | 跑测试、校验 |
| report | `--phase-report` | `#db61a2` | `#bf3989` | `report` | 汇总、交付 |

每个 phase 另有 `-subtle` 变体（同色 15% alpha，Light 10%），用于 tile 底与甘特条底。

> **understand(cyan) 与 implement(blue) 是本组最接近的一对**，这是接受的取舍：
> 二者在时间线上通常不相邻，且图标（telescope vs code）差异明显。

### 2.6 Provider 标识色

9 个 provider 用**字母章（monogram badge）**而非厂商 logo——避免商标问题，且 9 个 logo 无法风格统一。
badge = 16×16 圆角方块，底为该色 `-subtle`，字为该色，1 个大写字母。

| provider | 字母 | Dark | Light |
|----------|------|------|-------|
| claude | `C` | `#d97757` | `#bc4c2e` |
| codex | `X` | `#10a37f` | `#0d7a5f` |
| opencode | `O` | `#4493f8` | `#0969da` |
| codearts | `A` | `#e5484d` | `#c0353a` |
| codeagent | `G` | `#f2a93b` | `#b87d1a` |
| codeagent2 | `2` | `#a371f7` | `#8250df` |
| trae | `T` | `#39c5cf` | `#1b7c83` |
| qoder | `Q` | `#db61a2` | `#bf3989` |
| workbuddy | `W` | `#8b949e` | `#59636e` |

### 2.7 对比度硬性要求

| 组合 | 最低对比度 | 依据 |
|------|-----------|------|
| `--fg-default` on `--canvas-default` | ≥ 12:1 | 正文 |
| `--fg-muted` on `--canvas-default` | ≥ 4.5:1 | WCAG AA 正文 |
| `--fg-subtle` on `--canvas-default` | ≥ 3:1 | WCAG AA 大字/非文本 |
| 任一 `*-fg` on `--canvas-default` | ≥ 4.5:1 | 语义文字 |
| 任一 phase 色 on `--canvas-default` | ≥ 3:1 | 非文本图形 |
| `--fg-on-emphasis` on 任一 `*-emphasis` | ≥ 4.5:1 | 实心按钮 |

**颜色不得单独承载信息**（WCAG 1.4.1）：phase 必带图标，status 必带图标，
compare 的左右必带 `L` / `R` 标记而不只是蓝/橙。

---

## 3. 字体

```css
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
           "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", "Courier New", monospace;
```

CJK 字族必须在栈内（UI 为 zh/en 双语），且 MUST NOT 引入任何 webfont（离线可用、零网络请求）。

### 3.1 字号刻度

| Token | size / line-height | 用途 |
|-------|-------------------|------|
| `--text-xs` | 11px / 16px | badge、状态栏、表格角标 |
| `--text-sm` | 12px / 18px | 列表次行、meta、mono ID |
| `--text-base` | 13px / 20px | **默认正文**（开发工具惯用密度） |
| `--text-md` | 14px / 21px | 强调正文、按钮 |
| `--text-lg` | 16px / 24px | 面板标题 |
| `--text-xl` | 20px / 28px | 会话标题 |
| `--text-2xl` | 24px / 32px | KPI 数字 |

字重只用三档：`--weight-normal: 400`、`--weight-medium: 500`、`--weight-semibold: 600`。

### 3.2 用户字号调整（既有 REQ-012）

A- / A+ / R 仅作用于**长文本区**（inspector body、transcript、report），
范围 8–28px，通过 `--user-font-size` 注入。
MUST NOT 影响 chrome（工具栏、侧栏、状态栏）——否则布局会散架。

---

## 4. 间距 / 圆角 / 尺寸

### 4.1 间距（4px 基准）

`--space-1: 4px` `--space-2: 8px` `--space-3: 12px` `--space-4: 16px`
`--space-5: 20px` `--space-6: 24px` `--space-8: 32px` `--space-10: 40px`

### 4.2 圆角

`--radius-sm: 4px`（badge、tag）
`--radius-md: 6px`（**默认**：按钮、输入框、卡片）
`--radius-lg: 8px`（modal、popover）
`--radius-full: 999px`（pill、状态点）

### 4.3 固定尺寸（布局骨架）

| Token | 值 | 用途 |
|-------|----|------|
| `--header-height` | `48px` | 全局头 |
| `--tabs-height` | `40px` | 视图切换条 |
| `--statusbar-height` | `28px` | 底部状态栏 |
| `--rail-width` | `300px` | 左侧列表默认宽（可拖，260–480） |
| `--inspector-width` | `420px` | 右侧详情默认宽（可拖，280–900） |
| `--row-sm` | `28px` | 事件行、紧凑表格行 |
| `--row-md` | `32px` | 常规表格行 |
| `--row-lg` | `44px` | 会话列表行（双行密排） |

> `--row-sm` / `--row-lg` 是虚拟滚动的 `itemHeight` 输入，**必须是常量**，
> 不得随内容变化——否则 `useVirtualList` 的 offset 计算失准（见 gotchas G11.x 虚拟滚动条目）。

---

## 5. 阴影与浮层

| Token | Dark | Light |
|-------|------|-------|
| `--shadow-sm` | `0 1px 0 rgba(1,4,9,.2)` | `0 1px 0 rgba(31,35,40,.04)` |
| `--shadow-md` | `0 8px 24px rgba(1,4,9,.6)` | `0 8px 24px rgba(66,74,83,.12)` |
| `--shadow-lg` | `0 16px 32px rgba(1,4,9,.85)` | `0 16px 32px rgba(66,74,83,.2)` |

阴影**只允许**用于：popover、dropdown、modal、toast、command palette。
列表行、卡片、面板一律用 `--border-default` 描边。

### 5.1 层叠顺序

`--z-sticky: 10` · `--z-drag: 20` · `--z-dropdown: 100` · `--z-popover: 200`
· `--z-modal: 300` · `--z-toast: 400` · `--z-palette: 500`

---

## 6. 动效

```css
--duration-fast: 80ms;    /* hover、按下 */
--duration-base: 160ms;   /* 展开、淡入 */
--duration-slow: 240ms;   /* 浮层、抽屉 */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

**硬性约束**：

1. `@media (prefers-reduced-motion: reduce)` 下所有 duration MUST 归零，
   且 skeleton 的 shimmer、running 状态的脉冲 MUST 停止。
2. MUST NOT 对 `width` / `height` / `top` / `left` 做过渡——只允许
   `opacity` / `transform` / `background-color` / `border-color` / `color`。
   虚拟滚动容器内**禁止任何过渡**。

---

## 7. 焦点与命中区

```css
--focus-ring: 0 0 0 2px var(--canvas-default), 0 0 0 4px var(--accent-emphasis);
```

- 所有可交互元素 MUST 有 `:focus-visible` 焦点环，MUST NOT `outline: none` 而不补偿。
- 最小命中区 24×24px（密排行内的图标按钮用透明 padding 撑开，不撑大视觉尺寸）。
- 键盘可达顺序 MUST 与视觉顺序一致。

---

## 8. 图标

- **零依赖**：手写内联 SVG，不引入任何图标库（`project.md` §2 的依赖约束）。
- 网格 16×16，`viewBox="0 0 16 16"`，`fill="currentColor"`，默认 `width/height = 16`。
- 允许尺寸：12 / 16 / 20 / 24，其它尺寸视为违例。
- 颜色**只能**继承 `currentColor`，SVG 内 MUST NOT 写死颜色。
- 每个图标 MUST 有 `aria-hidden="true"`（装饰）或 `role="img" + <title>`（独立承载语义）。
- 单个图标路径数据 ≤ 512 字节；全套 ≤ 12KB（未压缩）。

图标清单与命名见 `specs/design-system/spec.md` REQ-004。

---

## 9. 契约测试

以下断言 MUST 进 CI（`src/styles/tokens.test.ts`）：

| # | 断言 |
|---|------|
| T1 | `tokens.css` 中 `:root` 与 `[data-theme="light"]` 的 token 键集合**完全相等** |
| T2 | `src/**/*.css` 中除 `tokens.css` 外，MUST NOT 出现 `#[0-9a-f]{3,8}` 字面量颜色 |
| T3 | `src/**/*.css` 中除 `tokens.css` 外，MUST NOT 出现非 `var()` 的 `px` 间距（`0px`/`1px` 描边除外） |
| T4 | §2.7 全部对比度组合在两套主题下均达标（用 WCAG 相对亮度公式计算，不引库） |
| T5 | 6 个 phase 色两两 ΔE > 15（CIE76），保证可区分 |
| T6 | 图标集导出名与 REQ-004 清单**逐项相等**，无多无少 |
| T7 | 每个图标 SVG 均含 `viewBox="0 0 16 16"` 且不含 `fill="#`、`stroke="#` |
