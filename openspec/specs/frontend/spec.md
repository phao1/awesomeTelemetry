# Spec: Frontend

> React 19 SPA。源文件：`src/`

## Purpose

单页应用，展示 scan 会话轨迹、proxy 捕获、对比分析。`App.tsx` 是唯一 stateful shell。

## Requirements

### REQ-001: 五视图 shell
`App.tsx` SHALL 提供 5 个视图：session / agent / compare / proxy / frida。

### REQ-002: 状态管理
用 useState / useCallback / useMemo。phase、kind 过滤用 `useDeferredValue`，视图切换用 `startTransition`。

> 注意：这两个是**调度**优化，不减少 DOM 节点数。渲染量问题由 REQ-008 的虚拟滚动解决。v4 把二者混为一谈是性能问题的成因之一。

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
3. 在 `startTransition` 中把返回行合并进现有列表并按 `startedAt` 降序重排

MUST NOT 重新拉取全量索引。

### REQ-005: 双层缓存
前端 SHALL 维护两层缓存：
- `recordCache` — 会话详情（slim），上限 30 条 LRU
- `eventDetailCache` — 单 event 正文，上限 100 条 LRU

### REQ-006: 虚拟滚动
`SampleRail`（会话列表）与 `TraceGanttTree`（事件树）MUST 窗口化渲染，仅挂载视口内正负 10 行。

#### Scenario: 最差会话渲染
- **GIVEN** 打开 9,590 event 的会话
- **THEN** DOM 节点数 < 500，首次绘制 < 200ms

### REQ-007: 详情分页衔接
`TraceGanttTree` 滚动接近已加载数据末尾时 SHALL 请求下一页（`offset` 递增 2000），追加而非替换。

### REQ-008: 组件清单
| 组件 | 职责 | 消费的数据档位 |
|------|------|--------------|
| SampleRail | 左侧会话选择器 + 搜索 + 时间/provider 过滤（虚拟滚动） | SessionIndexEntry |
| SessionHeaderCard | 会话元数据 + system prompt 入口 | TraceSession |
| PhaseTiles | 6 phase 过滤 tile | slim events |
| TraceGanttTree | Gantt 风格时间线树（虚拟滚动） | slim events |
| EventInspector | **右侧**详情面板，拖拽调宽 + 滚动 | 单 event 下钻 |
| AgentOverview | 跨会话聚合 | AgentOverviewRow[] |
| CompareSelectorBar / CompareBoard | 左右并排对比 + CompareSpeedMetrics + CompareTimeline + AgentComparisonBand | slim events + SpeedMetrics |
| ProxyView | MITM 控制 + 请求列表 | ProxyRequestListItem[] |
| FridaView | Frida 控制 + 捕获列表 | FridaCapture |
| SettingsModal | provider 配置 | LocalSessionConfig |
| TranscriptModal | 完整 transcript | mode=full |
| TokenTextModal | token 分解下钻 | mode=full |
| LanguageToggle / LiveIndicator | zh/en 切换、SSE 连接状态 | — |

### REQ-009: pending 状态
详情响应 `pending: true` 时 SHALL 展示"解密中"占位，并等待 SSE 通知后自动重取。MUST NOT 轮询。

### REQ-010: i18n
`t(key, locale)` 函数，`zh` / `en` 双字典。新字符串 MUST 同时加两个 locale。locale 存 localStorage 键 `agent-observability.locale`。错误码到人类可读文案的映射也走 i18n（后端只返回英文 message 与稳定 code）。

### REQ-011: 紧凑 UI
列表用紧凑单行，不用多行卡片。分组默认折叠。

### REQ-012: 字体调整
长文本区域（仪表盘、报告）SHALL 支持 A- / A+ / R 调整，范围 8–28px。

### REQ-013: scan/proxy 分开展示
scan 会话与 proxy 捕获是独立视图，不混在一起。

### REQ-014: bundled fallback
`src/generated/local-samples.ts`（机器生成）提供 API 不可用时的 fallback 样本。

## Gotchas
- G7.1：详情面板放右侧非底部，支持拖拽调宽
- G7.3：列表紧凑单行，分组默认折叠
- G7.4：scan/proxy 分开展示
- G7.5：`useDeferredValue` + `startTransition` 是调度优化，**不能替代虚拟滚动**
- G7.2：字体 A-/A+/R 调整
- `src/generated/` 勿手改，改 generator
- G11.9（新）：任何"遍历会话数组逐个 fetch"的代码都是设计错误，正确做法是新增服务端聚合端点
