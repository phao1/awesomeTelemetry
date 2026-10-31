# DSH 可观测实现参考与任务工作台改进

日期：2026 年 10 月 25 日。状态：源码调研与设计依据；本项目的实际实现见 [implementation.md](implementation.md)。

## 参考范围

参考本地 `deepseek-harness`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`（2026 年 10 月 17 日），远端为 `deepseek-ai/deepseek-harness`。结论来自该版本源码、包说明和已存在的测试用例；本轮没有启动 DSH，也没有重新运行其浏览器测试，不代表上游最新版本或现场交互验收。

本次重点是 Session、Trajectory、Session Inspector、子 Agent 导航和 telemetry 捕获。产品使用统计上报与会话执行分析是不同子系统。没有找到并验证可直接作为本项目通用文件导入方案的 DSH 页面，不将其日志持久化、反馈上传或测试回放描述成用户导入功能。

## 一 DSH 为什么能把过程展示得连贯

DSH 的优势首先来自数据结构：运行时本身写入有序会话事件，界面再从同一份事件生成不同读法。主会话、子会话、轮次、步骤、工具调用、模型尝试都有原生身份或边界，不需要主要依靠网络请求反推。

```text
Agent 执行
  → Session 有序事件日志
    → Chat：阅读对话
    → Trajectory：检查轮次、请求、工具和时序
    → Session Inspector：检查原始事件与界面对象
    → telemetry 捕获：复制事件、应用部署策略、交给后端
```

Session 日志是追加式记录。`assistant/message` 保存成功结算的模型消息和紧凑流记录；`assistant/attempt` 保存失败、重试、取消等尝试，不把它们重复变成正常模型历史。结算前进程突然丢失时，不能保证存在持久化的尝试流。

Telemetry 捕获将 ledger 事件与 ops 运维信号分开。前者可按会话、格式版本、序号识别；后者不伪装成会话事件。捕获游标表示已交给后端，不等于成功送达。脱敏作用于导出副本，不改写原生日志，是否脱敏取决于实际安装的策略。

**对本项目的启发：**让对话、轨迹、成员关系和证据共用原始记录身份及读取投影。我们是外部观察工具，不能直接获得 DSH 那样完整的内部状态；跨来源关联必须保留依据、缺口和冲突。

源码依据：[Session 类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts)、[Session 语义](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/README.md)、[捕获协调器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-telemetry/src/coordinator.ts)。

## 二 值得直接借鉴的交互

### 1. 会话始终是上下文

Trajectory 注册在当前会话的视图中；Session Inspector 位于当前会话的侧栏。查看日志不要求用户重新从另一个业务列表选择会话。

本项目对应为：先选择任务，随后切换执行过程的读法。来源、主会话、所选成员和所选记录持续保留。单 Agent 到多 Agent 的变化，只增加执行结构。

### 2. 轨迹按轮次和步骤组织

DSH 的 Trajectory 包含用户输入、模型调用、工具、嵌套工具及压缩记录，并保留轮次和步骤。原始日志表也使用真实 `turn/start`、`step/start` 作为分组头，缺少开始事件时不合成假的开始记录。

本项目默认按“用户轮次 → 模型尝试与工具执行”阅读。来源只能提供扁平事件时显示事件顺序与已知关联，不把推测阶段当成原生步骤。失败后重试成功时，当前结果显示成功，同时保留失败尝试及其耗时和用量口径。

### 3. 先扫读，再检查单条记录

DSH 轨迹行展示工具名、摘要、状态和已有指标，选中后打开当前记录的详情。详情按记录类型提供摘要、参数或代码、结果、schema、时序等内容；没有为每条记录强行提供完全相同的空标签。

本项目采用同样的渐进展开：列表只取轻量摘要，选择后读取一条正文。工具记录展示实际输入与结果；模型调用展示可用请求、响应、用量及重试；父子 Agent 事件展示关联身份和委派证据。Raw 始终表示原始内容，格式化摘要与解析内容另行标明。

### 4. 时间图服务于定位

DSH 在轨迹上方放置紧凑时间图，支持选择时间区间定位相关记录。存在数据时区分 TTFT 和生成时间。未完成记录保留开始标记，不伪造已完成耗时。首屏位于尾部，向上阅读后停止自动跟随。

本项目在同一任务中增加可展开的成员泳道。单 Agent 默认一条主线；多 Agent 可按主会话、全任务或所选成员观察。时间图不是独立统计首页，也不能由总耗时自动推断关键路径。等待、并行和因果依赖都需要明确证据。

源码依据：[TrajectoryView](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryView.tsx)、[记录检查器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryTable.tsx)、[时序与阅读规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/README.md)。

### 5. 对话和日志双向定位

Session Inspector 可从日志行定位当前显示的 Chat，也可使用拾取器从 Chat 元素寻找日志。优先使用 call ID、事件序号、Node、Step 和 Turn 等身份，不做文字相似匹配。没有精确渲染目标时，可能高亮相邻步骤或轮次；它不自动载入未显示历史，也不切换会话。

本项目首先实现明确的“查看证据”和“定位过程”按钮，无需先实现完整拾取器。精确定位与近似上下文定位要有不同提示。目标未加载时，按锚点有界加载目标附近的一页；目标已删除、无权限或未采集时明确说明，不能用邻近记录冒充目标。

### 6. 筛选仍保留上下文

DSH 的原始日志类型筛选保留命中行的祖先，区分命中行与上下文行。筛选通过确认生效；点击对象引用或拾取目标被筛选遮挡时，能够揭示目标。

本项目筛选错误或工具后仍保留任务、成员和轮次上下文。展示命中数及查询范围，不将祖先计入错误数。跨视图定位与筛选冲突时，提示“目标被当前筛选隐藏”，允许暂时显示并一键恢复筛选。

### 7. 子 Agent 在父会话内发现

DSH 在会话头部提供子会话目录，支持展开嵌套目录、查看标题和状态、进入成员会话或在右侧旁看。普通侧栏不把所有子 Agent 会话作为普通主会话铺开。子会话地址保留父子身份；名称只是显示信息。

本项目保留任务列表的一行，在任务内显示成员树与成员范围。侧栏旁看和主区域切换使用同一个成员引用；关闭旁看返回原事件与滚动位置。观察工具不照搬 DSH 的发送消息和 Stop Agent 操作，“停止采集”只作用于本系统的数据接入。

源码依据：[Inspector 注册与身份联动](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/session-inspector/src/client/views/index.ts)、[日志模型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/session-inspector/src/client/views/session-log/model.ts)、[真实分组](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/session-inspector/src/client/views/session-log/groups.ts)、[筛选](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/session-inspector/src/client/views/type-filter.ts)、[子会话导航](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx)。

## 三 对上一版设计的具体修订

| 上一版 | 修订后 | 理由 |
|---|---|---|
| 任务详情先进入概览 | 默认进入执行过程；摘要收进任务头部 | 点开任务即可开始阅读 |
| 概览、执行回放、遥测证据三页 | 过程区提供对话、执行轨迹、原始事件三种读法；右侧共享证据检查器 | 减少同一任务的重复选择与页面跳转 |
| 回放是主要入口 | 静态阅读默认可用，逐步回放是轨迹内的可选操作 | 排查通常先找具体记录，不需要先播放 |
| 团队关系占据专门页面 | 成员树按需展开，与主会话共享事件选择和时间范围 | 多 Agent 增加结构，不增加任务 |
| 来源作为任务标签 | 任务标签加每条证据的来源、覆盖和关联依据 | 一个任务可同时含本地日志、抓包和导入副本 |
| 只有分页读取 | 增加按事件锚点定位附近窗口的设计 | 分享和双向定位不必翻完历史 |

任务内三种读法共享任务和成员范围，但不承诺一一对应：一个工具调用可能对应调用和结果两条原始记录，一条模型尝试也可能包含多个流片段。切换时优先保留原始身份；无法映射则显示缺口，不随意选中第一条。

## 四 建议的页面布局

```text
任务中心                                        数据接入  设置
采集记录 / 导入记录
┌────────────────┬────────────────────────────────┬──────────────────┐
│ 任务列表       │ 修复某问题 · Codex · 采集记录    │ 所选记录         │
│ 搜索 / 筛选    │ 主会话 · 数据覆盖 · 最近接收    │ 摘要 / 输入      │
│                │ 主会话 / 全任务 / 成员          │ 输出 / 时序      │
│ 当前任务       │ 对话 | 执行轨迹 | 原始事件      │ 原文 / 来源      │
│ 其他任务       │ 紧凑时间图（可展开成员泳道）     │                  │
│                │ 第 3 轮                         │ 关联模型请求     │
│                │   模型调用 → 工具 → 结果        │ 关联原始事件     │
│                │   委派子 Agent ↗                │ 关联依据和缺口   │
│                │   成员返回 → 主会话继续         │ 返回原位置       │
└────────────────┴────────────────────────────────┴──────────────────┘
```

左侧列表可折叠，成员树在范围选择器中展开；不要求永久四列。中等屏宽隐藏列表，窄屏使用可返回的详情页。大屏允许临时旁看成员，避免挤压主过程成为不可读的细列。

对话视图默认读主会话。选择全任务时优先展示带成员泳道的执行轨迹，不把并行子会话拼成看似先后相接的一段对话。用户主动切回对话时可选成员；协作交接位置提供对应成员的上下文链接。

## 五 我们要比参考实现进一步解决什么

### 跨采集通道的一条证据链

同一次逻辑模型调用可能同时出现在原生日志、代理与导入包里。界面以逻辑活动展示一行，保留多份证据；仅在明确身份和已接受关联成立时合并，时间接近只作为候选提示。调用次数与 Token 去重必须固定统计来源和口径，不叠加副本。

选中工具或模型调用后，右侧直接列出“本地日志已采集、网络响应未采集”等可用情况。需要额外通道时跳到接入配置并带回当前任务，不在查看缺口时自动启动代理、CDP 或 Frida。

### 多 Agent 的完整调查路径

从父会话中的委派事件进入子 Agent，保留父步骤锚点；查看子 Agent 的请求、工具和结果后，返回原委派处。有明确结果引用时可跳到父会话接收结果的位置；没有时只显示父子关系，不虚构交接完成。

全任务时间图对齐各成员已知时间，未知或冲突时间单独处理。筛选错误保留成员和轮次，点击错误跳到该成员的局部过程。并行时长不能简单相加成任务总时长，缺少成员证据时也不能计算完整工作量占比。

### 可恢复的调查位置

DSH 参考版本的 Trajectory 选择主要是本地状态，README 明确没有锚点深链接。本项目将任务、来源作用域、成员、事件锚点、视图和时间窗纳入可恢复上下文；刷新或分享后有界加载目标窗口。正文、凭据和原始路径不写进 URL。

历史回放固定窗口版本。实时阅读只有用户明确处于尾部跟随时才自动前进；向上滚动、选中旧记录或进入逐步回放均暂停跟随，显示新记录数量和“回到最新”。补页不能移动当前可见锚点。

### 来源和能力始终可见

采集与导入两类入口共用读法。导入记录显示文件批次和导入时间，不显示当前在线；由本机监听补读的历史日志也不显示正在执行。混合证据逐条保留来源，未知能力显示未提供，不能填零。

DSH 已有记录可恢复部分模型请求，是因为它记录了 request header 和消息投影。本项目必须区分“实际抓到的请求”“按完整日志重建的请求”和“只保留的消息内容”，不能把重建结果称为网络原文。

## 六 采集和查看的边界

DSH 的 Session Inspector 属于可选实验开发工具。另一个 NodeJS Inspector 提供 Host/Client 调试和 Host fetch 捕获，两者不同；不能据此声称我们的 CDP 适配可以读取任意 CodeAgent 的原生日志。

本项目继续以受支持的本地日志监听获取任务结构，以网络抓包补充请求证据，按目标适配选择 CDP/Frida。查看旧记录、展开 Raw、播放过程和导入文件都不隐式启动监控。DSH 格式接入本项目需要单独适配其格式版本、事件、父子身份及用量，不能将 JSONL 后缀当成兼容证明。

参考：[Developer Tools 组合](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/inspector-profile/README.md)、[NodeJS Inspector](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/inspector/README.md)。

## 七 落地顺序和可验证结果

| 顺序 | 交付 | 核验重点 |
|---|---|---|
| 1 | 统一任务与证据身份、三种读法的映射 | 子 Agent 和多源副本不重复计任务 |
| 2 | 默认执行过程、共享单条检查器 | 打开任务即可阅读，查看正文仅请求所选记录 |
| 3 | 父子往返、双向定位、错误筛选 | 保留原位置，精确与近似定位明确区分 |
| 4 | 全任务时间图与稳定实时跟随 | 不虚构时间，翻历史不被新数据拉走 |
| 5 | 锚点深链接、导入副本对照 | 大记录只读目标附近窗口，不重复统计 |

不优先复制 DSH 的完整运行时对象树、Chrome DevTools、拾取遮罩或 Agent 控制功能。这些不直接解决当前用户的任务调查主线。先用现有真实单会话与多 Agent 数据走通“父任务 → 子成员 → 事件 → 原始证据 → 原位置”，再扩展高级诊断。

设计目标的验收包括：无需跨业务列表重新选择同一任务；一次选中即可打开该记录检查器；任意已保存的事件锚点可恢复或返回明确不可用原因；翻历史时新事件不改变阅读位置；相同逻辑调用的多份证据不增加调用数。这些是拟议验收目标，不是已完成的性能或易用性结果。

已阅读的测试依据包括 [Session Inspector 浏览器用例](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/web/tests/session-inspector.e2e.ts) 和 Inspector 下的分组、筛选、定位单元用例；本轮未执行这些测试。


## 八 2026-10-27 时间图与过程结构落地

新增紧凑活动泳道、全范围密度/局部精确事件双层导航、缩放平移与有界时间筛选，以及按成员轮次→步骤→模型观察/可识别尝试→工具记录阅读。明确区分原生身份、步骤内关联、局部窗口和缺口；没有复制 DSH 运行时，也没有假造内部请求、TTFT 或重试记录。保留按原始记录懒读的检查器。

本轮具体参考 `TrajectoryTimeline.tsx`、`timeline.ts`、`TrajectoryTimeline.module.css`、`TrajectoryTurnHeader.tsx`、`TrajectoryGroupHeader.tsx`，版本仍为本文固定的 `687f282e8625c6b8d11ff58211a90524be2e4317`。重写组件以适应外部采集的多成员与固定分页；原文级导入适配、完整尝试流及因果关键路径仍未实现。功能、证据与性能见 [本轮交付说明](time-process-20261026.md)。

## 九 2026-10-28 按 DSH 截图修订阅读交互

用户通过两张 DSH 截图指出上一版的具体问题：多层图表与控制区挤占高度，图块难以定位，记录及正文只能在很小的区域内滚动。本次明确替代本文此前的“双图、成员泳道”方案，改为单张紧凑输入/模型/工具图、连续记录阅读、任务名与图吸顶，以及可拖宽的右侧正文检查器。完整设计与待验收项见 [DSH 阅读交互重构](dsh-reading-20261028.md)。以下是源码阅读结论，不代表本轮浏览器验收已完成。

| 交互 | 固定版本源码定位 | 本次采用方式 |
|---|---|---|
| 单图和细行 | [TrajectoryTimeline.module.css 第 14–50 行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryTimeline.module.css#L14-L50)：plot 高 50px，输入、模型、工具三细行 | 只有一张紧凑图；不再额外展示密度总览、成员泳道和泳道翻页 |
| 易识别色块 | [同文件第 153–247 行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryTimeline.module.css#L153-L247)：细条保留最小可见宽度，hover/selected 有明确描边 | 一块对应一条当前页原始记录，颜色帮助区分输入/模型/工具，选中状态同时反映在图和列表 |
| 默认等宽阅读 | [timeline.ts 第 75–118 行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/timeline.ts#L75-L118)：sequence 投影按记录等宽排列 | 当前页最多 200 条记录可逐块定位，默认不让几天的空闲时间挤压有用记录；切换时长时才使用已知日志区间 |
| 控件语义 | [TrajectoryToolbar.tsx 第 55–123 行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx#L55-L123)：“时长”切换宽度，“轮次”“调用”折叠列表，搜索与它们同排 | 不将这三个按钮解释成三种时间尺度；减少单独占行的次要控制 |
| 点图定位 | [TrajectoryTimeline.tsx 第 538–568 行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryTimeline.tsx#L538-L568)、[TrajectoryTable.tsx 第 2388–2464 行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryTable.tsx#L2388-L2464)：精确块选择记录，列表揭示祖先并滚动到目标 | 精确原始 ID 驱动选择、分组展开和列表定位；不能用未加载密度桶或相邻记录冒充所点记录 |
| 直接读正文 | [TrajectoryTable.tsx 第 3092 行起的详情标签与第 3456 行起的参数预览](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-trajectory/src/client/TrajectoryTable.tsx#L3092-L3475) | 选中后的摘要直接显示可用参数/结果或思考/输出；来源、计时、原文仍可按需进入，正文仅对所选记录及一个精确工具配对懒读 |

DSH 同时实现了滚轮锚点缩放、右键拖动平移、左键框选和清除选择；其原生运行时还能够提供完整的助手请求计时。本项目继续保留“记录区间不等于推理计时”的边界，不增加缺少证据的 TTFT/生成分段，也不压缩后再将横轴宣称为完整墙钟。多 Agent 的入口仍是主会话/全任务/单成员范围，成员身份显示在记录中，不靠增加图表数量表达。

参考仓库的根许可证为 MIT，版权方为 DeepSeek（2026）。本次按交互与视觉规则自行实现，未实质复制 DSH 源文件、样式文件或运行时包；不引入 DSH 依赖。若后续改为直接移植实质源码，必须保留其版权与许可声明。
