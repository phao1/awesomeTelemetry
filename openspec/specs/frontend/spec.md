# Spec: Frontend

> React 19 SPA。源文件：`src/`
>
> 视觉与原子组件见 `specs/design-system/spec.md`，数值见 `contracts/design-tokens.md`。
> 本文件描述**页面怎么拼、数据怎么流、每个视图长什么样**。
>
> **REQ-001 – REQ-014 是既有编号，语义保持不变**（代码注释引用它们做溯源）。
> REQ-015 起为本次设计刷新新增。

## Purpose

单页应用，展示 scan 会话轨迹、proxy 捕获、对比分析。`App.tsx` 是唯一 stateful shell。

产品定位：**开发者最愿意打开的 Agent 可观测工具**。参照 GitHub / Linear / Grafana 的取舍——
暗色优先、信息密集、键盘可达、语义克制。

---

## Requirements

### REQ-001: 五视图 shell
`App.tsx` SHALL 提供 5 个视图：session / agent / compare / proxy / frida。

### REQ-002: 状态管理
用 useState / useCallback / useMemo。phase、kind 过滤用 `useDeferredValue`，视图切换用 `startTransition`。

> 注意：这两个是**调度**优化，不减少 DOM 节点数。渲染量问题由 REQ-006 的虚拟滚动解决。v4 把二者混为一谈是性能问题的成因之一。

### REQ-003: 数据加载策略
| 视图 | 请求 | 禁止 |
|------|------|------|
| session 列表 | `GET /api/sessions?dataSource=scan&limit=50` + 滚动加载 | 一次拉全量 |
| session 详情 | `GET /api/sessions/:key`（slim） | 请求 `mode=full` |
| event 正文 | `GET /api/sessions/:key/events/:id`（点击时，200ms 防抖） | 随详情一起拉 |
| agent 视图 | `GET /api/agent-overview`（**1 个请求**） | 逐会话拉详情 |
| compare | `POST /api/compare` | 分别拉两次详情 |

#### Scenario: Agent 视图请求数
- **GIVEN** 用户切到 agent 视图
- **THEN** 网络面板中该视图产生的请求数 MUST 等于 1
- **AND** v4 实测为 524 请求 / 299.6MB / 4,732ms

### REQ-004: SSE 局部 patch
收到 `sessions_changed { keys }` 时 SHALL：
1. 失效 `recordCache` 中对应 key
2. 发起一次 `GET /api/sessions?keys=<逗号分隔>` 取回这些索引行
3. 在 `startTransition` 中把返回行合并进**共享会话 store**（REQ-015）并按 `startedAt` 降序重排

MUST NOT 重新拉取全量索引。

### REQ-005: 双层缓存
前端 SHALL 维护两层缓存：
- `recordCache` — 会话详情（slim），上限 30 条 LRU
- `eventDetailCache` — 单 event 正文，上限 100 条 LRU

### REQ-006: 虚拟滚动
`SessionList`（会话列表）与 `TraceTimeline`（事件树）MUST 窗口化渲染，仅挂载视口内正负 10 行。
命令面板的结果列表（REQ-025）同样 MUST 虚拟滚动。

#### Scenario: 最差会话渲染
- **GIVEN** 打开 9,590 event 的会话
- **THEN** DOM 节点数 < 500，首次绘制 < 200ms

### REQ-007: 详情分页衔接
`TraceTimeline` 滚动接近已加载数据末尾时 SHALL 请求下一页（`offset` 递增 2000），追加而非替换。

### REQ-008: 组件清单

| 组件 | 职责 | 消费的数据档位 |
|------|------|--------------|
| `AppShell` | 全局头 + 视图 tabs + 三栏骨架 + 状态栏（REQ-015） | — |
| `SessionList` | 左栏会话选择器 + 搜索 + 过滤（虚拟滚动，REQ-016） | SessionIndexEntry |
| `SessionHeaderCard` | 会话元数据 + 四维指标条 + system prompt 入口（REQ-017） | TraceSession |
| `PhaseRibbon` | 会话 phase 时间分布带（REQ-017） | slim events |
| `PhaseTiles` | 6 phase 过滤 tile | slim events |
| `TraceTimeline` | 时间比例甘特 + 树形缩进（虚拟滚动，REQ-017） | slim events |
| `EventInspector` | **右栏**详情面板，拖拽调宽 + 分页签（REQ-017） | 单 event 下钻 |
| `AgentOverview` | 跨会话聚合：KPI 卡 + 可排序对比表（REQ-018） | AgentOverviewRow[] |
| `CompareBoard` | 左右并排对比（REQ-019） | slim events + SpeedMetrics |
| `ProxyView` | MITM 控制 + 请求列表 + 详情抽屉（REQ-020） | ProxyRequestListItem[] |
| `FridaView` | Frida 控制 + 捕获列表（REQ-021） | FridaCapture |
| `StatusBar` | 连接/扫描/库状态（REQ-023） | health + SSE |
| `CommandPalette` | ⌘K 全局跳转（REQ-025，懒加载） | SessionIndexEntry |
| `SettingsModal` | provider 配置 | LocalSessionConfig |
| `TranscriptModal` | 完整 transcript | mode=full（REQ-017 约束） |
| `TokenTextModal` | token 分解下钻 | mode=full |
| `LanguageToggle` / `ThemeToggle` | zh/en 切换、主题三态 | — |

> 组件重命名：`SampleRail` → `SessionList`、`TraceGanttTree` → `TraceTimeline`。
> 旧名描述的是「样本轨」与「甘特树」，与实际职责不符。改名时同步改测试文件名。

### REQ-009: pending 状态
详情响应 `pending: true` 时 SHALL 展示"解密中"占位，并等待 SSE 通知后自动重取。MUST NOT 轮询。

### REQ-010: i18n
`t(key, locale)` 函数，`zh` / `en` 双字典。新字符串 MUST 同时加两个 locale。locale 存 localStorage 键 `agent-observability.locale`。错误码到人类可读文案的映射也走 i18n（后端只返回英文 message 与稳定 code）。

**本次新增的 key 前缀**：`nav.*`、`state.*`（空/错/加载文案）、`metric.*`（快准稳省）、
`palette.*`、`shortcut.*`、`theme.*`、`proxy.*`、`frida.*`。

### REQ-011: 紧凑 UI
列表用紧凑密排行，不用留白型卡片。分组默认折叠。表格默认 `compact` 密度。

> **对原文「紧凑单行」的细化（见 D-005）**：会话列表行为 `--row-lg`(44px) 的**双行密排**——
> 首行标题、次行 meta。单行会强制截断唯一有意义的标签（现状即：一行只放得下
> `rollout-2026-08-04T14-08-32-019fcb63…jsonl`）。
> 约束的实质是「密排、非卡片」，不是「物理一行」。事件行仍为 `--row-sm`(28px) 单行。

### REQ-012: 字体调整
长文本区域（inspector body、transcript、report）SHALL 支持 A- / A+ / R 调整，范围 8–28px。
MUST NOT 影响 chrome（头、tabs、侧栏、状态栏）。

### REQ-013: scan/proxy 分开展示
scan 会话与 proxy 捕获是独立视图，不混在一起。

### REQ-014: bundled fallback
`src/generated/local-samples.ts`（机器生成）提供 API 不可用时的 fallback 样本。
使用 fallback 时 MUST 在状态栏显示「离线样本」标识，MUST NOT 让用户误以为是真实数据。

---

### REQ-015: 应用骨架与共享会话 store

SHALL 采用固定三栏 + 上下 chrome 的骨架：

```
┌─────────────────────────────────────────────────────────────────┐
│ AppHeader        ⌘K 搜索        [scan] [⚙] [☾] [文A]           │ 48px
├─────────────────────────────────────────────────────────────────┤
│ ViewTabs   Sessions │ Agents │ Compare │ Proxy │ Frida          │ 40px
├──────────────┬──────────────────────────────┬───────────────────┤
│ SessionList  │  Main                        │  EventInspector   │
│ 300px 可拖   │  flex, min-width 0           │  420px 可拖       │
│ 260–480      │                              │  280–900          │
├──────────────┴──────────────────────────────┴───────────────────┤
│ StatusBar  ● live · 38 sessions · db 2.4MB · scan idle          │ 28px
└─────────────────────────────────────────────────────────────────┘
```

- ViewTabs 用 `underline` 变体（GitHub 式），选中项底部 2px `--accent-emphasis`。
- 左/右栏可折叠（`[` / `]`），折叠状态与宽度持久化（REQ-026）。
- 只有 session 视图是三栏；agent / compare / proxy / frida 为单栏主区（proxy 的请求详情走 `Drawer`）。

**共享会话 store**：会话索引列表 SHALL 由 `App.tsx` 单一持有并向下传递，
`SessionList` MUST NOT 维护自己的会话数组。

#### Scenario: 对比视图能选到会话（修复既有缺陷）
- **GIVEN** 应用刚启动，用户直接切到 compare 视图
- **THEN** 左右两个会话选择器 MUST 已填充与 session 视图相同的会话列表
- **AND** MUST NOT 为空

> **现状缺陷**：`App.tsx` 的 `sessions` state 只被 SSE patch 写入，
> 而 `SampleRail` 持有另一份独立 state。`CompareBoard sessions={sessions}` 收到的
> 永远是 `[]`，两个下拉框永远为空，对比功能 100% 不可用。
> 这是「点击后无法加载」中**最确凿**的一条。

---

### REQ-016: 会话列表行

行高 `--row-lg`(44px)，双行密排：

```
┌────────────────────────────────────────────────┐
│ ●  修复 SQLite 索引展开逻辑                     │  ← 状态点 + 标题（省略号截断）
│    ⟨C⟩ claude · 2h ago · 110 events · 1.9M tok │  ← provider 章 + 相对时间 + 计数
└────────────────────────────────────────────────┘
```

| 元素 | 规则 |
|------|------|
| 状态点 | `StatusBadge` 的点形态，色见契约 §2.4 |
| 标题 | `--text-base`，`--fg-default`，单行省略号 |
| provider | `ProviderBadge` 字母章 12px |
| 时间 | 相对时间（`2h ago` / `3天前`），`title` 属性给绝对时间 |
| 计数 | events 与 token，`--font-mono`，`--text-xs`，`--fg-muted` |
| 选中 | 底 `--accent-subtle` + 左侧 2px `--accent-emphasis` 竖条 |
| hover | 底 `--canvas-raised`，无过渡（G-DS-4） |

**过滤区**（列表顶部，`--row-md` 高）：`SearchInput`（`/` 聚焦）+ provider 多选 + status 多选。
过滤条件 MUST 反映在 URL hash，便于分享与刷新保持。

#### Scenario: 列表显示真实标题而非文件名
- **GIVEN** 库中存在尚未加载详情的会话（`detailLoaded = false`）
- **THEN** 列表行 MUST 显示真实会话标题与真实 `eventCount`
- **AND** MUST NOT 显示 `rollout-2026-08-04T14-08-32-019fcb63-566f-70d1-….jsonl` 这类源文件名
- **AND** MUST NOT 显示 `0 events`

> **现状缺陷**：索引阶段不解析正文，38 条会话里 34 条的 title 是源文件名、`eventCount` 是 0，
> 只有点开过的 4 条才有真值。用户看到的是一屏无法辨认的文件名——
> 「点了才知道是什么」正是本条要消灭的体感。
> **依赖后端**：由 `specs/session-scanning/spec.md` REQ-021 提供轻量标题提取。

#### Scenario: 已加载与未加载视觉一致
- **GIVEN** 同屏内既有 `detailLoaded=true` 也有 `false` 的行
- **THEN** 两者渲染结构 MUST 完全一致，MUST NOT 出现某些行缺字段导致的高度差

---

### REQ-017: 会话详情主区

自上而下四段：

**① SessionHeaderCard**
- 第一行：`ProviderBadge` + 会话标题（`--text-xl`）+ `StatusBadge` + 溢出菜单（重扫 / 删除 / 复制 id / 导出报告）
- 第二行 meta：`cwd`（等宽、可复制）· 起止时间 · 时长 · model
- 第三行**四维指标条**：4 个 `MetricCard`

  | 维度 | 图标 | 主数 | 副文 |
  |------|------|------|------|
  | 快 | `IconSpeed` | TTFT / TPS | 端到端时长 |
  | 准 | `IconAccuracy` | verificationCoverage | 是否跑过测试 |
  | 稳 | `IconStability` | errorRate | 是否进入过 debug |
  | 省 | `IconCost` | tokenTotal | costUsd · tokensPerStep |

  数值为 `null` 时显示 `—` 并加 tooltip 说明为何不可用，MUST NOT 显示 `0` 冒充。

**② PhaseRibbon**（产品 signature）
按时间轴铺满宽度的横向色带，每段宽度 = 该 phase 的时间占比，色 = `--phase-*`。
悬停显示 phase 名 + 时长 + 事件数；点击等价于只勾选该 phase。
高度 8px，`--radius-full`。这是「一眼看出这次会话把时间花在哪」的核心视觉。

**③ PhaseTiles**
6 个 tile，选中态用该 phase 的 `-subtle` 底 + 本色文字 + 图标；每个 tile 带计数徽标。
附「全选 / 反选」与当前可见事件数。

**④ TraceTimeline**
行高 `--row-sm`(28px)，虚拟滚动。每行：

```
│ ▸ │ #142 │ ⟨icon⟩ │ ████▌        │ Read src/App.tsx      │ 1.2s │ ✓ │
   ↑     ↑      ↑         ↑               ↑                   ↑     ↑
 折叠  序号  phase图标  时间比例条      标题（树形缩进）      时长  状态
```

| 要求 | 说明 |
|------|------|
| 时间比例条 | 左偏移与宽度按事件在会话时间轴上的真实位置/时长计算，**不是等宽条** |
| 树形缩进 | tool 调用相对其父 message 缩进一级，最多 3 级；父行可折叠 |
| phase | 图标 + 色（REQ-004 of design-system：颜色不单独承载语义） |
| 零时长事件 | 渲染为最小 2px 竖线，MUST NOT 不可见 |
| 选中行 | `--accent-subtle` 底 + 左侧竖条 |

**⑤ EventInspector**（右栏）
- 头部：`#序号` + 事件标题 + 复制 id + 关闭
- 分页签：`Summary` / `Input` / `Output` / `Raw` / `Tokens`
- `Raw` 页签**按需拉取**（`include=raw`），切到该页签才请求
- 正文区域受 REQ-012 字号调整控制，代码块 `--font-mono` + `--canvas-inset` 底 + 复制按钮

#### Scenario: transcript 不拉全量
- **GIVEN** 用户在一个 648 event 的会话中打开 Transcript
- **THEN** MUST NOT 一次性请求整个会话的 `mode=full`
- **AND** SHALL 分页拉取（复用 REQ-007 的 offset/limit 机制）并在弹层内虚拟滚动

> **现状缺陷**：`App.tsx` 的 `openTranscript` 无条件 `api.sessionDetail(key, 'full')`，
> 对大会话会拉出数十 MB 阻塞主线程——违反 `gotchas.md` G11.1。

---

### REQ-018: Agent 概览视图

**① 顶部 KPI 行**：4 张 `MetricCard`，为全部 provider 的加权聚合（快 / 准 / 稳 / 省）。

**② Provider 对比表**：可排序，密度 `compact`，表头 sticky。

| 列 | 渲染 |
|----|------|
| Provider | `ProviderBadge` + 名称 + sourceAgent |
| Sessions | 数字 |
| Events | 数字 + `Sparkline`（按时间分桶） |
| Tokens | 数字（千分位）+ `BarMeter`（相对最大值） |
| Cost | `$x.xxx` + `BarMeter` |
| 验证覆盖 | 百分比 + `BarMeter`（tone=success） |
| 错误率 | 百分比 + `BarMeter`（tone=danger） |
| Debug 率 | 百分比 + `BarMeter`（tone=attention） |
| 平均工具耗时 | `xxxms` |

- 数值列右对齐、`--font-mono`；`null` 显示 `—` 而非 `0`（现状表格把 `null` 和 `0` 混淆）。
- 行可展开，展开后列出该 provider 下最近 10 条会话（点击跳到 session 视图并选中）。
- 表头显示数据新鲜度（`cached` / `fresh` + 时间戳），带手动刷新按钮。

仍受 REQ-003 约束：整个视图 **1 个请求**。展开行复用已有会话 store，MUST NOT 逐会话 fetch（G11.9）。

---

### REQ-019: 对比视图

**① 选择条**：左右两个会话选择器。SHALL 用 `Popover` + 搜索的选择器（复用命令面板的匹配逻辑），
MUST NOT 用原生 `<select>` 罗列数百条会话。左标 `L`、右标 `R`，配色 accent / attention，
且 MUST 附字母标记（颜色不单独承载语义）。

**② 结论条**：对比加载后，顶部用一句话给结论 —— 例如
「Claude 快 2.3×，但 token 多 41%」。这是开发者最想先看到的东西。

**③ 四维对比**：4 组 `BarMeter` 双条（L/R 各一条），差值用 `+41%` / `−2.3×` 标注，
颜色按「谁更优」着色而非固定左右色。

**④ PhaseRibbon 对照**：两条 ribbon 上下堆叠、共享同一时间比例尺，直观看出阶段分布差异。

**⑤ 时间线并排**：两列虚拟滚动，同屏最多各 100 行；行结构复用 `TraceTimeline`。

#### Scenario: 未选择时的引导
- **GIVEN** 用户刚进入 compare 视图，尚未选择会话
- **THEN** SHALL 渲染 `EmptyState`：图标 + 「选择两个会话开始对比」+ 直接打开左侧选择器的按钮
- **AND** MUST NOT 只渲染两个空下拉框

---

### REQ-020: 代理视图

**① 控制条**
- 状态指示：`stopped` / `running :8888` / `starting`
- 主按钮：启动 / 停止（停止为破坏性，需二次确认）
- 端口输入（停止态可改）
- 「下载 CA 证书」按钮 + 一句安装指引链接
- 请求计数 + 清空按钮（破坏性，二次确认）

对应后端端点 `POST /api/proxy/start`、`POST /api/proxy/stop`
（已在 `contracts/api.md` §4 定义，**当前未实现**，见 `UI-TASKS.md` T-12）。

**② 请求列表**：密排表格，虚拟滚动。列：方法（色标 badge）· URL（省略中段保留域名与末段）·
状态码（2xx success / 3xx neutral / 4xx attention / 5xx danger）· 耗时 · 大小 · 时间。
支持按方法/状态码/域名过滤。

**③ 详情抽屉**：点击行右侧滑出，分页签 `Request` / `Response` / `Headers` / `Timing`，
正文 `--font-mono` + 复制按钮，脱敏后的字段用 `Badge` 标注「已脱敏」。

#### Scenario: 代理未启动时的空态
- **GIVEN** 代理从未启动，请求列表为空
- **THEN** SHALL 渲染 `EmptyState`：说明「代理未运行」+ 启动按钮 + CA 证书安装提示
- **AND** MUST NOT 只渲染一句「暂无数据」

---

### REQ-021: Frida 视图

**① 控制条**：状态（`stopped` / `running pid=xxxx`）· 启动/停止按钮 · 目标进程选择（省略则自动发现）。
对应 `POST /api/frida/start`、`POST /api/frida/stop`（`contracts/api.md` §5 已定义，**当前未实现**）。

**② 捕获列表**：密排表格，列：类型 badge · model · 时间 · 大小；点击进详情抽屉。

**③ 前置条件未满足时**：Frida 未安装 / 无目标进程 → `EmptyState` 说明具体缺什么、怎么装，
MUST NOT 只显示 `stopped`。

---

### REQ-022: 四态落地（**本次核心修复**）

下列每一处 SHALL 实现 `design-system` REQ-006 的四态，且 `catch` 块 MUST NOT 为空：

| 位置 | 现状 | 要求 |
|------|------|------|
| `SessionList` 列表加载 | `catch {}` 静默 | skeleton / empty / error+重试 |
| `App.selectSession` 详情加载 | `catch {}` 静默 | 主区 skeleton；失败显示错误码 + 重试 |
| `EventInspector` 事件正文 | `catch` → `setDetail(null)` 与「无数据」不可区分 | 区分 empty 与 error |
| `AgentOverview` | 有 error 但无 skeleton / empty | 补齐四态 |
| `CompareBoard` | 有 error 但无 empty 引导 | 补齐 |
| `ProxyView` / `FridaView` | 空列表与失败不可区分 | 补齐 |
| `SettingsModal` | `catch` → `setConfig(null)` 永久停在「加载中」 | 失败显示 error + 重试 |

#### Scenario: 后端不可达
- **GIVEN** 后端进程被杀死
- **WHEN** 用户点击任意会话
- **THEN** 主区 MUST 在 5 秒内显示错误态（错误码 + 文案 + 重试按钮）
- **AND** 状态栏的 live 指示 MUST 变为断开
- **AND** MUST NOT 停留在空白或无限骨架

#### Scenario: SQLite 类 provider 详情为空
- **GIVEN** 用户点击一条 opencode 或 codearts 会话，后端返回 `events: []` 且 `title` 为空
- **THEN** SHALL 渲染 `EmptyState` 说明「该会话未解析出事件」并提供「重新扫描」动作
- **AND** MUST NOT 渲染一个什么都没有的空白主区

> **现状缺陷**：`GET /api/sessions/opencode-7ff9bf5edb628d` 与
> `.../codearts-c79b25e584d002` 实测返回 `events: 0`、`title: ""`、`pending: undefined`。
> 前端对此没有任何呈现，表现为纯白空白。后端修复见 `UI-TASKS.md` T-11。

---

### REQ-023: 状态栏

底部固定 28px，左起：

| 段 | 内容 |
|----|------|
| 连接 | SSE 状态点 + `live` / `disconnected`（`aria-live="polite"`） |
| 数据 | `38 sessions · 12,405 events` |
| 扫描 | `idle` / `scanning claude…` / `last scan 2m ago`，可点击触发手动扫描 |
| 库 | `db 2.4MB · wal 0.03MB`（来自 `/api/health`） |
| 右侧 | 数据源标识：`scan` / `offline samples`（REQ-014）· 版本号 |

状态栏 MUST NOT 轮询 `/api/health`——数据随 SSE 心跳更新，或用户手动刷新时更新。

---

### REQ-024: URL 状态同步

视图、选中会话、过滤条件 SHALL 反映在 URL hash，形如：

```
#/sessions?key=claude-09893f87625581&phase=implement,debug&provider=claude
#/agents
#/compare?left=claude-xxx&right=codex-yyy
```

刷新页面 MUST 恢复到同一状态。不引入路由库（`project.md` §2：SPA 无路由），
用 `hashchange` + 一个 60 行以内的解析/序列化模块。

---

### REQ-025: 命令面板与快捷键

按 `design-system` REQ-008 实现。命令面板的会话搜索 SHALL 复用共享会话 store（REQ-015），
MUST NOT 另发请求。首次按 `⌘K` 才懒加载组件。

首屏 SHALL 在主区显示一行极轻的提示（`⌘K 搜索会话 · ? 查看快捷键`），
让快捷键可被发现；用户使用过一次后不再显示（localStorage 标记）。

---

### REQ-026: 布局持久化

下列偏好 SHALL 存 localStorage，键统一前缀 `agent-observability.`：

| 键 | 内容 |
|----|------|
| `.theme` | `system` / `dark` / `light` |
| `.locale` | `zh` / `en`（既有） |
| `.layout.railWidth` | 数字 px |
| `.layout.inspectorWidth` | 数字 px |
| `.layout.railCollapsed` / `.layout.inspectorCollapsed` | 布尔 |
| `.fontSize` | 长文本区字号（REQ-012） |
| `.paletteHintSeen` | 布尔（REQ-025） |

读取时 MUST 做范围校验（宽度越界回落到默认），MUST NOT 因 localStorage 脏数据崩溃。

---

## Gotchas

- G7.1：详情面板放右侧非底部，支持拖拽调宽
- G7.3：列表密排非卡片，分组默认折叠（细化见 REQ-011 与 D-005）
- G7.4：scan/proxy 分开展示
- G7.5：`useDeferredValue` + `startTransition` 是调度优化，**不能替代虚拟滚动**
- G7.2：字体 A-/A+/R 调整，且不影响 chrome
- `src/generated/` 勿手改，改 generator
- G11.9：任何"遍历会话数组逐个 fetch"的代码都是设计错误，正确做法是新增服务端聚合端点
- **G7.6（新）**：任何组件都不得持有第二份会话索引数组。现状 `SampleRail` 的私有
  `sessions` state 让 `CompareBoard` 永远拿到空数组——这是 100% 复现的功能缺失，
  不是边缘情况。
- **G7.7（新）**：空 `catch` 块在本项目里等价于「功能不可用且无人知道」。
  已确认 7 处（REQ-022 表），全部要改。评审时把空 catch 当编译错误看。
- **G7.8（新）**：`mode=full` 只在用户显式要 raw/transcript 时用，且必须分页。
  一次全量 full 对 648 event 会话即数十 MB。
