## Context

动机见 proposal.md；源码核查见 audit.md。项目记录 M0–M12 已完成，但 M11 标为 trimmed，不能据此推断网络采集全部链路完成。融合分支起点 d5da6af；主工作目录存在 45 个 tracked 修改及其他 untracked 内容，包括 team observability 与契约/schema 变更；分支没有自动包含它们。

用户已批准开发及契约修订。最新决定以 implementation.md 与权威契约为准。主目录109个相关文件已纳入融合工作树，原目录不变。

## Goals / Non-Goals

**Goals**

- R1 是可实际使用的监控产品闭环，而不只是代理请求列表、架构框架或 shadow 模式。
- 尽可能保留“有授权、可观察、可安全保存、可解释”的信息；数据缺口也是一等展示对象。
- 将原生执行上下文与网络实测互补，支持开发者定位“模型慢、工具慢、上下文浪费、重试异常、协议不兼容”的具体证据。
- 保持本地优先、现有扫描能力、四个批准 runtime dependencies 及当前 NFR。

**Non-Goals**

- 不保证一次点击就能解密任意已运行进程、证书固定客户端或 TTNet；不默认提升权限、信任 CA、改系统代理。
- 不恢复服务端未公开 reasoning、隐藏内部路由、未写日志的工具开始/结束事件。
- 不以 LiteLLM 自动转换协议作为“观测”；适配诊断属于 R1，实际改写网关或 Agent 行为属于后续单独授权工作。
- 不自动重放付费 API/文件写入/shell/MCP 工具，不把离线解析 replay 与真实执行 replay 混为一谈。
- 不引入云平台、远端多用户服务、ClickHouse/Langfuse 必选依赖；不处理历史数据迁移。

## Decisions

### D1. 以本项目为主体，融合语义与测试，不复制运行栈

保留 Node http + SQLite WAL + React 体系、scanner/adapters、context-normalizer/context-diff、现有聚合与虚拟化。参考 telemetryRef 的 Messages/Responses/嵌套 SSE、session metadata、工具分片、usage 与评测样本，先抽出合成 golden fixture，再写符合本项目契约的解析器。

替代方案：嵌入 mitmproxy/LiteLLM。优势是独立工具生态；代价是新增依赖/部署/进程、重复数据模型及请求变换。R1 不采用。若现有代理引擎经过真实协议测试确实存在不可修复缺口，再单独提出替换引擎的证据与依赖审批，不能边开发边装 Python 栈。

参考源码未发现仓库级 LICENSE；不直接复制其源码、密钥、真实请求、业务专有 prompt。直接移植前确认使用权；可先按协议语义和自建 fixture 独立实现。

### D2. 接入体验分两步，支持矩阵按实测发布

首次接入：发现安装/版本 → 选择 Agent/项目 → 选择进程级代理或显式配置 → 检查真实 CA → 用本地测试上游做连接诊断 → 必要时提示重启/受控启动。只有用户选择“通过监控启动”时才启动新进程；不能给已运行外部进程强塞环境变量。

以后：点击开启 → 建立采集运行 → 就绪/待流量 → 观测请求 → 扫描/关联 → 实时显示 → 停止并恢复本工具拥有的设置。暂不增加含糊的“暂停”语义，避免与停止、停止持久化混用。

R1 真机优先目标：macOS 上 Claude Code、Codex、OpenCode 的可配置 HTTP/SSE 路径；实际安装/版本及是否使用 WebSocket 必须在 B0 确认。若当前版本关键路径只有未支持传输，不强制降级协议，也不能宣称该 Agent 已验证。9 个 scanner 不等于 9 个网络集成。CodeArts/CodeAgent、Trae、Qoder 等按实际原生格式与平台进入 R2；已有扫描功能继续保留。

能力矩阵维度：Agent 版本 × OS × 接入方式 × 传输 × 原生日志 × tool start/end × 子 Agent × 精确关联 × 验证日期；状态包括已验证/仅 fixture/部分/不支持及原因，具体枚举先入契约。

### D3. 单一 CA 与可靠运行控制

以正在使用的 http-mitm-proxy CA 机制为唯一证书签发源，将 sslCaDir 固定到受控用户配置目录；ca-manager 封装读取公钥、状态、权限检查，不另生成一套不被代理使用的 CA。下载现有 /api/ca-cert 约定中的实际公钥，拒绝私钥访问。验证目标运行时信任，不用 ssl-insecure 绕过失败。

运行管理使用 generation/token 防止旧启动结果复活，监听失败必须 reject，关闭按契约限定等待在途请求，超时标记中断。状态仅在真实监听与终止事件后更新，保存最后失败原因；恢复配置前检查当前值仍是本工具写入的值，不能覆盖用户后续编辑。默认只绑定 127.0.0.1。

替代方案：系统全局代理，首次省配置但影响范围广，且不保证所有进程使用。仅作为以后显式可选模式，不是默认方案。

### D4. 转发与采集处理解耦，但诚实声明丢失边界

最小转发回调只记录单调时钟、复制有界字节并排入采集队列，及时向网络转发；增量 UTF-8 解码、解压上限、SSE 解析在受限工作执行单元中进行。优先用内置 worker_threads，不增加依赖；SQLite 仍按现有单进程写约束，用小批次、缓存 statement 和时间预算写入，测量后再调整。

队列按字节数和任务数双重限制；满了不无限等网络，而是停止该请求进一步正文收集、留下完整性/丢弃状态。不得将未经授权的原文临时落盘作为隐形溢出队列。分析错误尽量不影响转发，但代理本身崩溃或网络失败不能承诺 fail-open 直连；UI 必须说明当前请求可能受影响并指导恢复连接。

增量推送保留观测到的原文；列表与变更通知只带元数据，正文仅在选定请求后订阅。完成/取消/错误结果幂等；写失败明确可见，不先报告保存成功。

### D5. 三协议 canonical parser，加可选格式适配

协议判别优先级：用户明确协议配置且与数据可兼容 → path/body/response 强证据 → 域名辅助 → unknown。矛盾信号记录诊断，不强行选厂商。解析器消费同一规范化事件接口，但保留协议原生证据。

| 协议 | 请求上下文 | 响应核心 | 专门测试 |
|---|---|---|---|
| Chat Completions | system/developer/messages、tools、parameters | delta、tool_calls、finish_reason、usage | usage-only 最终块、多 tool index、JSON 响应 |
| Responses | instructions、input items、tools、previous response 引用 | text/reasoning/function call items、completed/incomplete/failed、nested usage | function_call arguments 分片、并行 item、嵌套 usage、缺少 instructions |
| Messages | string/array system、messages content blocks、tools | message_start、block delta、message_delta、message_stop/error | input usage 与 output usage 分处、tool_use/tool_result、多 block |
| 嵌套/私有格式 | 以已验证样本定义 | 包装层与里面协议分开 | Qoder/Trae body 包装、加密标志、未知事件保留 |

嵌套适配先保留 原始 shape 与字节，在 B11 获得协议 fixture 后逐个启用，不对所有含 body 字段的 JSON 递归猜测。HTTP/1.1 与常见 SSE/JSON 是 R1 明确范围；HTTP/2、WebSocket、gRPC 和证书固定须在矩阵中单独实测，不默认为支持。

### D6. 数据模型按证据组合，不把 captureGroup 当 session

概念层次（不是最终 TypeScript/SQL 字段名）：

监控运行 → 多个来源观察；原生会话 → 用户轮次/Agent 决策轮次 → 模型调用与重试尝试、工具执行；父子 Agent 关系是显式边，不仅是嵌套显示。用户轮次与现有 turnKey 决策周期不能混成一种概念。

模型调用记录可以链接多份观察，但每份证据只关联一次对应的调用。标识包含来源命名空间和原生 ID；traceparent 是 trace/span 证据，不天然是会话 ID。内容 hash 只用于相同证据去重，不作会话身份。精确原生/request/response/tool ID 优先；时间/模型/上下文相似仅供候选提示。用户手动确认需记录其来源和撤销方式。

扫描记录、proxy_requests、Frida 原始记录保留独立；关联层保存引用和置信级别，不凭空造一个 native session、也不把原数据复制为另一条收费调用。已有 team run/agent/task 模型先核对主目录基线，能复用的语义复用，不能仅因名字相近强套。

### D7. 采集信息目录与契约修订输入

下表是 B1 必须定义的数据语义需求，**不是允许开发者直接新增的字段名**：

| 数据组 | 需要的信息 | 不可见时 |
|---|---|---|
| 身份与来源 | Agent/版本、运行、原生 session/turn/request/span/tool IDs、父子关系、观察位置、关联依据 | unknown/未关联，不靠 hash 猜身份 |
| 网络证据 | method、原始 URL/headers、协议、状态、请求/响应结构、错误/取消、大小/编码、完整性 | 原因可区分；按用户要求原样保留 |
| 模型上下文 | system/developer/instructions、消息 role/content、工具 schema、可见采样参数、模型请求名与响应名 | 供应商内部实际模型未知，不把 alias 当事实 |
| 输出与工具 | 文本、公开 reasoning、tool ID/name/arguments/result、原生起止、文件操作/测试证据 | 不抓不到的内部思维、不伪造执行时长 |
| usage 与性能 | 原生计数、cache/reasoning 子集规则、时钟域、首头/首内容/结束、服务端原生 timing | null/未知，计费与速度分别标注来源 |
| 数据管理 | parser/metric/schema 版本、采集完整性、限额/失败原因、保留期限 | 可以看到采集质量而不是误判 Agent |

需扩展 data-model → database → api → nfr，定义 nullability、分页、统一 ApiError、版本与索引后再写代码。沿用现有 proxy start/stop/list/detail/CA routes；新监控配置、关联查询、恢复游标与聚合如需路由，由 B1 明确定义，不在这里杜撰 endpoint。

### D8. 指标口径：先可信，再丰富

- 代理 E2E：本地观察到请求开始至响应结束；用单调时钟差，UTC 时间用于对齐和展示。结束时间在解析之前取。
- 响应头延迟与首个有效内容延迟分开；心跳/空 delta 不算内容。文本、公开 reasoning、tool args 的首内容类别分别记录；没有 token 级观测时 UI 名称用“首内容延迟”，不假装真实首 token 采样时间。
- 供应商 server timing 原样保存并注明单位/时钟域，与代理时间并列；不能两边时间戳相减，也不能用 E2E 代替纯推理时间。
- TPS 只在输出计数与时间区间语义一致时计算；保留分子、分母和 aggregation。首内容到末内容短于粒度或输出 usage 含不可见部分时，不给“精确流式 TPS”。旧扫描 TPS 算法保留其标签，不悄悄修改既有测试。
- 每请求 usage 快照按协议合并；不能把累计 message_delta 每次相加。跨请求按实际调用去重后累加；重试可能实际收费，不能把重试本身去掉。
- OpenAI cached/reasoning 常为 input/output 的子集；与现有 TokenUsage 的规范化关系必须先签入映射契约。native total 优先作为核验，不一律 input+output+cache+reasoning。
- 工具耗时仅用直接起止；相邻调用间隔可显示“间隙估算”。Accuracy 使用测试/人工评测证据，不把验证动作覆盖率说成答案正确率。
- R1 规则诊断：异常重试、重复上下文、工具 schema 膨胀、已知缓存低利用率、慢调用、工具失败。每条附相关请求/事件和口径；不自动改 Agent。

### D9. 原文完整性与独立容量预算

用户已明确不需要脱敏。请求/响应 headers、URL、正文、prompt、公开 reasoning 和工具参数/结果均按观测值保存、展示与导出。原始字节保存在本地文件，SQLite 保存引用/指标/有界预览，避免双份大正文。采集不调用 legacy 脱敏规则。

默认总原文预算10,000,000,000字节（10GB）；单方向默认100MiB，可配置；全局待写入字节上限32MiB。异步分片写入，准确计算已完成文件、崩溃残片和在途预留。达到限额明确记录 body_limit/quota_exceeded/queue_full/write_error，不自动清理旧数据，也不静默截断。默认无原文自动过期。

SQLite 仍遵守 DB+WAL<200MB、WAL<20MB；文件另计容量。已有2MiB context-diff分析限制只影响分析，不能阻止完整原文存储与下载。大型正文按需流式下载，不整份塞进列表、SSE或JSON详情。

控制API保持本地访问检查，UI转义不可信输出，CA私钥不作为业务抓包内容导出。用户已授权原文模式，无需每次开监控重新批准。

### D10. Web 使用现有布局，新增关联探索

保留 Sessions / Agents / Compare / Proxy / Frida / Mission 原始入口。Proxy 控制区升级为接入/监控台；Sessions 详情增加“关联 Trace”入口/子视图，避免直接追加未经设计的顶层导航。App 仍为唯一状态 shell，无新 router。

监控条：范围 → 接入/证书 → 开关 → 待流量/采集中/降级 → 捕获/失败/丢弃计数。详情从 Session/Turn → Model Call/Tool 展开；右侧 inspector 分页按需看上下文、响应、工具、timing、usage、来源与缺口。上下文 diff 复用现有 normalizer，关联候选不自动当“上一轮”。

SSE 流事件 100ms、session patch 200ms；有界恢复游标具体进 API 契约。重连通过服务器批量补齐变更元数据；列表不带正文，慢客户端断开不拖垮代理。指标聚合在服务器完成，不逐行 fetch。

### D11. Long-term storage separation after the measured shared-writer race

**Deferred by the user, 2026-10-16:** do not implement database separation or
add storage-boundary tests now. Keep the existing single-database implementation
and regression coverage. The later request to close existing work for manual
testing also pauses new full-chain/Web feature work. This section records a
future design direction, not authority to resume it or a completed capability.

The v17 snapshot stamp fix closes already-stale capture admission only. Native
scan writes and arbitrary later external commits remain outside capture admission;
stopping native scans or deleting their rows is not the approved solution.
NFR §7's long-term monitoring signal therefore requires the next storage tier,
not an indefinite claim that the shared DB is protected.

Chosen next-tier direction: separate native index/detail ownership from capture
metadata/body ownership, with one explicit evidence-association boundary and
bounded bulk read projections. Preserve original source identities and stable
provenance; do not duplicate native rows as new billable calls. Search indexes
cover bounded metadata only, never duplicate full originals. Physical separation
must not silently reinterpret the existing DB+WAL budget as a larger per-file
allowance; budget/accounting scope must be explicit in the authoritative
contracts before implementation, with unknown lengths failing closed.

Implementation gates: inventory every cross-store join/FK and writer first;
define typed owner/ref and API consistency contracts before new fields; define
crash-safe journal/outbox and reconciliation before cross-DB mutations. SQLite
WAL transactions across attached databases are not claimed to be crash-atomic.
Fault-inject each boundary to prove no lost native evidence, orphan committed
originals, resurrection or duplicate billing. Aggregate reads must remain paged,
indexed and batched; no body-bearing list or per-row fetch as a shortcut.

Use new isolated development stores for the cutover; no silent user-DB rebuild,
data deletion or migration. Existing evidence remains readable until an explicit
compatible transition is proved. Higher-priority no-implicit-original-deletion
policy wins over the old escalation table's generic enforced-retention wording:
limits stop additional capture with a visible reason, while actual cleanup
requires explicit user policy/confirmation. FTS/search, original-retention and
recovery acceptance are still required, not certified by this design paragraph.

## Risks / Trade-offs

- [旧契约与新目标冲突] → B1 先修订，再实现；不能用本设计覆盖更高优先级契约。
- [主目录新功能未入融合基线] → B0 给出相关改动清单和建议，确认后整合；不整体 stash/reset。
- [“全链路”证据不足] → 发布矩阵与缺口；需要精准工具/子 Agent 关系的目标再做 native hook，不以时间窗替代。
- [代理改变时序或性能] → 本地受控上游 A/B 对照，保留首内容和 E2E 分布，严格压测；承诺透明语义而非零开销。
- [正则、SQLite、解压阻塞] → 工作执行隔离、有界队列/批次、事件循环监测；超过预算停止验收，不降低断言。
- [真实 OS/Agent 环境不可得] → fixture-only 状态；R2 真机门禁不能用 mock 充数。
- [权限/许可证/敏感内容] → 不直接搬真实数据或秘密；复用授权不清时独立实现，合成 fixture。
- [容量预算与“尽可能详细”冲突] → 原文独立存储，默认10GB/100MiB且可配置；达到限额停止新增并标明原因。

## Migration Plan

1. B0 冻结并确认源码基线，声明本批文件白名单；主目录未提交成果不丢失。核对当前 AGENTS 与 package 锁版本已有 Vitest 3/4 文档漂移。
2. B1 审阅与更新权威契约，修正过时 module/gotcha 描述：proxy CA/路由/raw、原文存储边界、scan/proxy 关联例外、trace token 公式、周期保留策略。
3. 在隔离 DB/配置目录完成 R1；不得让当前旧 worktree 的 schema 接触主目录较新 DB。沿用项目“0-1，无历史迁移”，不自动重建或删除用户 DB；如需保留已有运行数据，另行确认迁移范围。
4. B2–B10 按 tasks.md 门禁递进；每阶段记录验收证据和 perf。开始真实 Agent 验证前确认目标进程与可能的模型费用。
5. 回滚停止本工具运行并仅恢复自己仍拥有的设置；新运行使用隔离 DB，不改写旧数据；CA 信任撤销提供手动指引，不擅自改系统信任库。

## Approved scope

用户已批准本项目主导、关联视图、完整原文、不脱敏、独立文件存储和必要字段/接口修订。依照已授权范围持续实施，无需重复请求逐字段审批。parity.md 每一项均需实际验证后才可宣称融合完成。
