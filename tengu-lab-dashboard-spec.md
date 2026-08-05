# Tengu Lab 页面组件清单（复刻参考）

基于两张截图逐面板核对整理（放大核对过 B 区表格数值，比初看时精确不少，部分数字做了修正）。仍有极少数地方因截图边缘裁切/字号过小无法确认，会标注出来，不编造。

## 全局导航（两页共用）
顶部导航条：`Tengu Lab`（橙色 logo）+ 首页 / 指挥中心 / 看板 / 事件 / **Sessions** 五个 tab，当前页高亮为深色胶囊。右上角常驻 `OTel :7200` + 一个被截断的 `AP...`（疑似另一服务端口状态）。

---

## 一、图1：Sessions · Trace 瀑布图页

### 1.1 左侧信息栏（约 380px 宽）

| 元素 | 内容 |
|---|---|
| 标题 | "Tengu Sessions"（大号，半透明叠底效果） |
| 说明 | "基于官方 tengu_* + 本地 OTel 对话正文" |
| 链接 | "Session 故事：`/v1/session/{id}`" |
| 面包屑 | "导航：Tengu 首页 · 事件 · tengu_view" |
| 统计卡片（2列×3行） | Sessions **57** ／ Events **9610** ／ API calls **284** ／ Cost Σ **$11.8075** ／ 有建议 **0** ／ 目录规则 **0** |
| 数据源选择器 | 下拉框，当前值 "SQLite（推荐，全量）" |
| 搜索框 | placeholder："session / model / entrypoint..." |
| 操作按钮 | "刷新"（蓝色主按钮）＋ "列表"（深色次按钮） |
| 底部图例 | "阶段颜色：lifecycle · context · capability · api · runtime"（这套标签和下方阶段耗时图的 LLM/Tool/Blocked/Other 不是同一套分类，具体对应关系图上看不出来） |

### 1.2 顶部残留的对话查看器
页面最上方被裁到一小段：`RESPONSE :` 标签 + 一条回复气泡 "I'll spawn the two teammates in parallel. Each will read README.md and return bullets only."。推测是完整的"对话正文"面板，这张图没截全。

### 1.3 阶段耗时条形图

标题："执行 Trace（OTel spans）"
说明：一次用户回合 = 一条 Trace（interaction → llm / tool / blocked）；多 Trace 时默认选中 "Session 统一视图"，把 lead + Agent/teammate 回合拼成一条跨 Agent 瀑布图。当前样本 4 traces · 24 spans。

Trace 选择器（下拉）："Session 统一 · 40.1s · 24 spans · 4 traces"

子标题："阶段耗时（span 累加；wall 40.1s）· Session 统一（合并 4 traces）"

| 阶段 | 耗时 | 占比 |
|---|---|---|
| LLM | 53.9s | 100% |
| Tool | 90ms | 0% |
| Blocked | 38ms | 0% |
| Other | 0ms | 0% |

⚠️ **关键口径**：53.9s 是 span 耗时**累加值**，Trace 实际 wall-clock 只有 40.1s——说明存在并行 LLM 调用（两个 teammate 同时在跑）。复刻时这两个数必须分开存、分开算，累加值 − wall 值本身就是"并行度"的隐含信号。

下方三行是控制按钮（非数据条，右对齐文字）："全部展开" / "折叠 Agent" / "全部折叠"。

### 1.4 执行 Trace 瀑布图（甘特图）

结构：**缩进层级（父子 span 树）+ 横向时间轴条 + 右侧时长数字**。横向位置 = span 起始时间偏移，条宽 = 持续时间，颜色 = span 类型（紫=`llm_request`，蓝=`interaction`，青色两档=`tool·Agent·<teammate名>`，按 teammate 区分深浅）。父级标签旁的括号数字 = 子 span 数。

| 层级 | Span | 子项数 | 时长 |
|---|---|---|---|
| 0 | llm_request · claude-haiku-4-5 | — | 2.1s |
| 0 | ▼ interaction | 4 | 32.1s |
| 1 | └ llm_request · claude-opus-4-8[1m] | — | 22.9s |
| 1 | └ ▶ tool · Agent · ux | 2 | 10.8s（已折叠） |
| 1 | └ ▶ tool · Agent · arch | 2 | 7.5s（已折叠） |
| 1 | └ llm_request · claude-opus-4-8[1m] | — | 1.8s |
| 0 | ▼ interaction | 1 | 2.3s |
| 1 | └ llm_request · claude-opus-4-8[1m] | — | 2.3s |
| 0 | ▼ interaction | 1 | 6.8s |
| 1 | └ llm_request · claude-opus-4-8[1m] | — | 6.8s |

模型名后 `[1m]` 大概率是上下文窗口标注（1M context）。

### 1.5 故事时间线（可读）

说明："优先展示：用户输入、工具、模型回复、关键 API；tengu 噪声埋点默认折叠在下方。"

条目结构：`时间戳（毫秒精度）+ 类型徽标（彩色胶囊）+ 类型标签 + 正文内容块`

可见第一条：`09:19:54.712` ｜ 徽标 **User prompt**（绿底）｜ 类型 `conversation` ｜ 正文为完整的 Agent Team 任务指令原文（要求 spawn 2 个 teammate 分别做 UX 和架构探索）。图到此截断，往下应还有更多条目未截到。

---

## 二、图2：指挥中心 · Mission Control

### 2.1 顶部控制区

- 大标题："指挥中心 · Mission Control"
- 副标题："五大战区 · 可观测性指挥中心 · 数据源：SQLite tengu_*（1P）+ OTel（3P）+ 本地 Skill/Memory + 栈探活。API: `/v1/db/analytics/mission` · Tengu 看板 · Sessions · OTel Lab"
- 时间窗口："近 7 天"（选中）／"近 30 天"／"全部" ＋ "刷新指挥中心" 按钮 ＋ "60s 自动刷新" 复选框
- 元信息："range=7d · generated 2026-07-29 03:16:33 · widgets 32 · 721ms"
- **五个区块导航 chip**："A·使用行为"（橙）"B·效能质量"（红/橙）"C·可观测性健康"（蓝）"D·知识资产"（紫）"E·趣味洞察"（青绿）

> ⚠️ 这张截图内容只到 **C 区末尾**，D 区（知识资产）和 E 区（趣味洞察）虽然导航里有，但截图范围没有覆盖到。widgets 总数 32，下面 A+B+C 三区能对上 **28** 个（7+17+4），说明 D/E 两区合计还有 **4 个** widget 没截到，复刻时这块需要你们再补一张图或直接看原页面。

### 2.2 A 区 · 使用行为（7 widgets）

| # | 组件 | 图表类型 | 数据 |
|---|---|---|---|
| A1 | 工具调用 TOP 榜 | 横向条形图 | 副标题 "tengu_tool_use_success · 支持 7d/30d/全部"。Read 95、Grep 33、PowerShell 28、Glob 19、Agent 7、TaskOutput 5、Write 4、Edit 3、Workflow 2、WebSearch 1、SendMessage 1、**WebFetch〔error-only〕3**（特殊标红，代表这 3 次全部报错） |
| A2 | Skill 使用频率 | 横向条形图 | 副标题 "调用优先；若无调用则显示 loaded，并标记近 7 天新见技能"。条目：loop〔新·7d〕、compact、simplify〔新·7d〕、goal、init |
| A3 | Subagent 调用分布 | 环形饼图 + 按日堆叠小条 | "avg 1.75 subagent/session" · "4 个会话派出过"。Explore 66.7%-6、Plan 22.2%-2、general-purpose 11.1%-1 |
| A4 | 活跃热力图 | 星期×小时 网格 | "星期 × 小时·本地时区（默认 UTC+8）·颜色越亮越高产"，横轴 0-23 时，纵轴一~日 |
| A5 | Permission Mode 分布 | 环形饼图 | 副标题 "tengu_init.permissionMode · 启动次数占比"。"inits 51"。default 58.8%-30、bypassPermissions 23.5%-12、acceptEdits 17.6%-9 |
| A6 | Prompt 习惯 | 多组小型横向条形图 | "n=64 · length p50=27 · p95=1519.7 · keep_going=0 · negative=0"。effort：high(长)/xhigh(短)；source：sdk(长)/typed(中)/queued(短) |
| A7 | 会话活跃曲线 | 柱状+折线组合图（双轴） | "每小时会话数（柱）与消息轮次（折线）·本地时区"，X 轴 07-28 11:00 → 07-29 10:00 左右，峰值在 07-28 16:00 |

### 2.3 B 区 · 效能质量（17 widgets，本区是全页信息密度最高的部分）

**KPI 卡片组（3 张并排）**

| # | 组件 | 数据 |
|---|---|---|
| B1 | 任务闭环 · E2E | 副标题 "tengu_sdk_result · 成功率 · duration P50/P90/P99"。成功率 **96.9%**；sdk_result 32（ok 31 / err 1）；E2E p50 **6.1s**，p90/p99 **25.0s / 57.2s**；turns p50 1 · avg 2.25 · repair sess 5 · rounds p50 1 · saw_retry 0。脚注："成功率/E2E 仅覆盖发出 tengu_sdk_result 的会话（多为 print/SDK）" |
| B2 | 重试与人工接管 | 副标题 "api_retry · blocked≥500ms · deny/reject"。Retry rate **9.1%**；API retries 25；**Handoff rate 33.3%**；OTel tool OK 96.5%。明细："attempt p50/p95 2/5 · blocked 562（handoff sess≥500ms 19）· wait p95 2.9s · deny 2 · tengu rej 2"。下方两条小条形图：Connection error. 24、502 `<api-error-body>` 1。**脚注给了接管的精确公式**："接管 = blocked_on_user≥500ms ∪ tool_decision deny/reject ∪ tengu permission reject" |
| B3 | 成本效率 | 副标题 "$/turn · $/成功工具 · $/sdk 成功"。窗口成本合计 $11.8075；$/turn $0.1845；$/成功工具 $0.0596；$/sdk 成功 $0.3809；turns 64 · tools 198 · sdk ok 31 |

**其余 14 个面板**

| # | 组件 | 图表类型 | 数据 |
|---|---|---|---|
| B4 | 工具失败率榜 | 横向条形图 | "error + permission reject / 总尝试"：WebFetch 100.0%(3)、PowerShell 28.2%(11) |
| B5 | Token 消耗趋势 | 堆叠面积图 | "每日 input/output 面积·cost 标注"。总量 **7,716,690**（in 1,434,984 / out 90,986 / cached 6,190,720），窗口成本合计 $11.8075；图例 input／output |
| B6 | API 质量 · TTFT/Cache | KPI 卡片 | "tengu_api_success · 延迟·缓存命中·错误率"。TTFT p50/p95 **1.4s / 6.4s**；**Cache hit 81.2%**；API calls 275 · error rate 0.0%；duration p50/p95 4.2s / 23.7s · cost $11.8075 |
| B7 | Token 用量 · Session 场景分布 | 横向条形图（12类，无数值标注，只有条长） | 副标题 "OTel prompt 数据驱动分类·噪声票过滤·无 prompt=未分类·未命中=其它·正文不回传"。"Σtok 1,525,970 · sessions 48 · labeled 34 · 未分类 5 · 其它 9 · peak 318,654"。分类：观测优化、评测 Harness、机制调研、架构重构、未分类、性能优化、冒烟探测、项目初始化、变更回顾、其它、代码解释、技能斜杠 |
| B8 | 重任务 Session · 场景分布 | 横向条形图（同上分类体系） | 副标题 "单 session tokens ≥ 门槛·场景同左（万=10,000）"，右上角门槛切换 **≥10万**（选中）/≥20万/≥50万。"sessions 5 · Σtok 838,634 · labeled 5 · 未分类 0 · 其它 0 · peak 318,654"。分类：观测优化、机制调研、架构重构、性能优化、项目初始化 |
| B9 | 失败原因分布 | 横向条形图 | "tengu.errorCode ∪ OTel error_type"：DomainCheckFailedError 12、ShellError 11、AgentTypeError 2。脚注 "tengu 2 类·otel 3 类（合并计数可能双计一失败）" |
| B10 | 高风险命令审计 | 条形图 + 明细表 | "OTel shell tool_input 正则·可下钻 session"。pattern `remove_item_force`，2 hits，均为 PowerShell，preview 展示了截断的 shell 命令原文（一条是清理临时目录，一条是清理测试残留）。脚注 "仅扫描 OTel shell tool_input；tengu 成功事件不含命令正文" |
| B11 | 性能漂移 · 日序列 | 表格 | "sdk 成功率·E2E p95·retry·tool fail·$/turn"。07-28：96.5% / 50.4s / 25 / 10.3% / $0.1008；07-29：100.0% / 20.5s / 0 / 2.1% / $0.9936 |
| B12 | 上下文压力 · 压缩 | KPI + 直方图 + 饼图 | "messageTokens/200k·peak/P50/P95·≥80%/≥95%·manual vs auto compact"。Peak 50.7%、P50 10.2%、P95 33.7%、≥80% 0.0%、≥95% 0.0%（"window 200,000 · API samples 253 · sessions 48"）。利用率直方图：0-20%→203、20-40%→45、40-60%→5、60-80%→0、80-95%→0、95+%→0。压缩成功 manual 100.0% / auto 0.0% · saved 26,425 tok · fail m/a 1/0；"日 peak：07-28 33.8% · 07-29 50.7%" |
| B13 | 模型分布 · 成本 | 表格 | "按 model 聚合 calls/tokens/$"：**glm-5.2** 253 calls / in 1,346,343 / out 90,827 / cached 5,737,088 / $11.8075；**claude-sonnet-4-6** 20 calls / 88,641 / 159 / 453,632 / $0.0000；unknown 2 calls / 0 / 0 / 0 / $0.0000 |
| B14 | 任务纵深分布 | 横向条形直方图 | "每会话工具调用次数直方图（轻咨询 vs 重任务）"，分桶：0（最长）、1-5、6-15、16-40、41+；"采样会话 57" |
| B15 | 工具生态 · 耗时/I/O | 表格 | "tengu_tool_use_success · duration p50/p95 · bytes · MCP · reject"，列为 工具/n/p50/p95/in/out/mcp：Read 95/6ms/40ms/17.4K/563.4K/0；Grep 33/81ms/130ms/7.5K/40.6K/0；PowerShell 28/819ms/1.7s/9.3K/27.8K/0；Glob 19/75ms/159ms/695B/17.2K/0；Agent 7/8ms/14ms/10.6K/8.4K/0；TaskOutput 5/**1.4分钟/4.5分钟**/297B/64.1K/0（注意单位是分钟不是毫秒）；Write 4/28ms/73ms/1000B/1.1K/0；Edit 3/51ms/80ms/2.8K/550B/0；Workflow 2/17ms/26ms/3.3K/3.5K/0 |
| B16 | 权限门禁 · Allowed | 横向条形图（绿） | "tengu_tool_use_can_use_tool_allowed"：Read 95、Grep 32、PowerShell 29、Glob 19、Agent 7、TaskOutput 5、Write 4、Edit 3、WebFetch 2、Workflow 2、WebSearch 1、SendMessage 1 |
| B17 | 权限门禁 · Rejected/Errors | 横向条形图（红/橙） | "rejected · errors · cancelled"。Rejected：PowerShell；Errors：WebFetch、PowerShell —— ⚠️ 这三条的具体数字被截图右边缘裁掉了，图上只能看到条形接近满宽，看不到数字，需要你们对着原页面补一下 |

### 2.4 C 区 · 可观测性健康（4 widgets）

| # | 组件 | 数据 |
|---|---|---|
| C1 | 观测栈探活 | "Collector / MITM / UI / TENGU_DROP / Langfuse"，chip "栈健康 6/6 · 100%"。说明："Cursor Automations 仍无本地运行状态查；本区改为可观测性栈健康 + 双通道覆盖"。检查项/状态/详情表：OTLP Collector:4318=OK/health ok；MITM tengu intercept:8080=OK/listening；Tengu Lab UI:7100=OK/up；OTel Lab UI:7200=OK/up；TENGU_DROP_UPSTREAM=OK/value=1（1=不向 Anthropic 回传）；Langfuse forward=OK/enabled=True traces=True logs=True err=None。下方还有"服务日志 mtime"子表（服务/状态/最近日志）：collector、mitmdump、web-tengu、web-otel 均为 observed，时间戳分别是 2026-07-29 02:25:32 / 03:16:32 / 01:23:28 / 01:23:29 |
| C2 | 双通道覆盖 | "OTel(3P) ∩ Tengu(1P)·内容面只在 OTel"。双通道 **52 · 71.2%**、仅 OTel **16**、仅 Tengu **5**。"内容面事件：prompts 99 · responses 359 · tool I/O 1,098"。"OTel 正文长度（不展示正文）：prompt p50/p95 68/1630.8 chars · response p50/p95 93/2287.4 · sampled 458"。"JSONL 落盘：otel logs 850 · traces 747 · official events 1,198 · SQLite dual 71.2%"。两个成因提示 tag："official_only×5 有tengu无OTel — 检查 CLAUDE_OTEL_* 环境变量是否注入"、"otel_only×16 有OTel无tengu — 检查 MITM:8080/CA/是否被 DISABLE_TELEMETRY 抑制" |
| C3 | 任务日历 | 副标题 "本月 Tengu 活动；工具/API 错误日标红"。日历网格（一~日表头），数据部分截图没截到 |
| C4 | 热会话 · 成本/下钻 | 副标题 "按 $ 排序·链到 Sessions/Story API"，"按成本" 排序标签，具体列表内容截图没截到 |

---

## 三、视觉规范速记

- 深色主题（近黑色背景），KPI 数字用浅色/白色大字号
- 语义配色：紫=LLM/llm_request，蓝=interaction（回合级），青色两档=tool·Agent（按 teammate 区分深浅），绿=成功/允许，红=失败/拒绝/高风险，橙/琥珀=主 KPI 强调色
- 图表类型分工明确：占比→饼图/环形图；趋势→面积图/折线；时间×类目分布→热力图；排行→横向条形图；明细→表格；Trace 专用甘特图。这个"图表类型选择规则"本身就值得直接写进你们的 frontend 模块规范
- 几乎每个面板标题下都跟一行"数据口径"小字（表名/字段/计算方式），这个习惯很值得抄——比如 B2 直接把 handoff 的布尔组合公式写在脚注里，复刻时口径不会走样

## 四、和你们现有模块的对应关系（仅供归档参考）

- A/B 区绝大部分指标 → **metrics-analysis**：本质是 tengu_* 表 + OTel span 的聚合统计，口径定义（尤其 B1 成功率覆盖范围、B2 handoff 公式、B12 压缩阈值）比图表样式更需要先在 spec 里钉死
- Trace 瀑布图（span 树、展开折叠、时间轴渲染）→ **frontend** + **trace-model**：父子关系/颜色映射是数据模型层的事，甘特图渲染是前端层的事，建议拆开写
- C 区可观测性健康（链路探活、双通道覆盖）→ 12 个模块里没有直接对应的，可能要挂在 realtime 下，或新开一个轻量的 self-health 类模块
- 故事时间线"噪声埋点默认折叠" → 和 desensitization/session-merge 的降噪清洗逻辑比较像，可以复用那边的过滤规则
- D/E 两区这次没截到内容，如果要补全 32 个 widget 的全貌，还得从原页面再拿一版

---

标了⚠️的地方（B17 具体数字、C3/C4 数据内容、D/E 两区）是这两张截图本身没提供的信息，其余都是逐面板放大核对过的。
