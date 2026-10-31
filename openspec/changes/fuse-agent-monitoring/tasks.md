## 当前交付边界 — 2026-10-16 用户手测交接

用户要求先把现有工作收尾，不再开新任务，交由用户自行测试；此前已明确暂不做分库或新增存储边界测试。此决定优先于历史记录中的“下一步继续 D11 / 全链路开发”。保留现有单库实现和全部已有回归，不删除、放宽测试或调整容量契约。

后续用户补充“如果有做的一半的任务就做完”，本批仅收尾已开始的原文访问、协议usage验收与详情错误恢复。3.2、3.3、9.2已有逐字段/实际网络/组件证据后勾选，进度30/71、41项待完成；完整回归见 implementation.md，逐项关闭与暂缓边界见 partial-task-closure.md。当前可测试能力和启动方式见 manual-test.md。7.3、完整全链路、实时断线补齐、指标去重和真机支持矩阵均不因本次交接变为完成；测试交接不等于R1发布或telemetryRef全量能力对齐。

## 1. B0 — 基线与实施范围门禁（R1，最先执行）

- [x] 1.1 复读 AGENTS.md、BOOTSTRAP.md、PROGRESS.md；记录当前 milestone 与 M11 trimmed 缺口，确认分支/HEAD/worktree。
- [x] 1.2 对主目录 tracked/untracked 变更仅做相关性清点，列出契约/schema/team/scanner/UI 与本方案的交叉，向用户提交“推荐纳入/独立保留/冲突”清单；按已批准范围纳入，清单见baseline.md。
- [x] 1.3 按用户授权安全整合选定基线，记录具体来源提交/补丁及未纳入项；保留主目录所有成果，不 reset/stash/自动提交其他任务代码。
- [ ] 1.4 核对实际安装 Agent/版本/OS/传输，形成首批支持矩阵和真机验收清单；如目标关键路径是 WebSocket 而 R1 未覆盖，先呈现范围冲突，不能强制降级掩盖。
- [x] 1.5 记录现有 Vitest 文档与锁版本漂移，跑当前基线 typecheck/test/lint/perf 并分类已有失败；不升级依赖或降低断言。
- [x] 1.6 确认 telemetryRef 直接移植授权；未确认时采用独立实现与合成 fixtures，不复制真实数据/凭据。为所有后续阶段建立逐文件白名单，新增文件须先列出。

门禁：用户认可基线/首批范围；工作分支来源明确；使用独立测试 DB/配置，不读写主目录运行 DB。

## 2. B1 — 契约与验收样本先行（依赖 B0）

- [ ] 2.1 先提交字段需求与原因清单：身份层次、关联证据、原生/规范化 usage、时钟域、完整性、能力矩阵、诊断和 retention；按已批准契约扩展授权更新 data-model，再实现。
- [ ] 2.2 定义元数据/正文/来源引用/关联的 SQL DDL、索引、唯一约束、schema version、删除语义和三层 column constants；核对已纳入的 team 模型，避免重复造 run/agent。
- [ ] 2.3 定义 API/BusEvents/错误码、批量查询、分页、取消、恢复游标、raw 访问控制及所有 null/unknown 含义；现有 route 保持兼容或注明破坏性变化。
- [ ] 2.4 明确 NFR 新采集限额、容量水位、队列、转发开销和监控开关/实时更新延迟预算；保留现有 p99<50ms、DB+WAL<200MB/WAL<20MB 等硬约束，不擅自放宽。
- [ ] 2.5 修正 audit.md 列出的 module/gotcha 冲突，并核对 OpenSpec legacy REQ 标题和 delta 映射；同步前逐条预览，不在仅提案完成时归档变更。
- [ ] 2.6 创建三协议合成 golden fixtures：请求、JSON/SSE 响应、期望 context/usage/tool/finish/error、来源说明；将本轮 5 项复现改为相邻回归测试，保证先见失败。
- [ ] 2.7 创建原文完整性 fixture：header/systemPrompt/raw/SSE/diff/export 原值不变、中文跨块、100MiB存储与下载。

门禁：四份权威契约一致；新字段已确认；每项目标有可执行或真机验收方法。候选落点：openspec/contracts/{data-model,database,api,nfr}.md、8 个相关 module spec、gotchas.md、src/core/trace-types.ts 及相邻 tests；精确清单以 B0 审定为准。

## 3. B2 — 原文文件存储与访问（依赖 B1）

- [x] 3.1 实现独立异步原文文件存储、100MiB单方向默认上限、10GB可配置总配额和32MiB全局待写预算。
- [x] 3.2 接通 headers/URL/body/derived systemPrompt/tool/reasoning 原样持久化和展示，监控不调用脱敏。
- [x] 3.3 实现原文按需/分段读取与下载，不受context-diff分析大小限制；不在SQLite重复存放大正文。
- [x] 3.4 验证跨块UTF-8/二进制原文、digest、并发配额、写失败、重启容量统计；原有文件不自动淘汰。
- [x] 3.5 加入本地控制 API Host/Origin 检查和 UI 内容转义测试；CA私钥不作为业务payload公开。

门禁：原文完整性与有界资源测试通过，满额/异常可见；本批文件见implementation.md。

## 4. B3 — 可靠代理与首次接入（依赖 B2）

- [x] 4.1 统一 CA 签发/保存/下载为真实代理使用的一套，实现已有 CA 下载接口和私钥权限/拒绝访问检查。
- [x] 4.2 补充本地真实 HTTPS CONNECT 集成测试：信任/未信任、SAN、重启复用；不使用禁用 TLS 校验绕过。
- [x] 4.3 修复 listen 错误处理、端口占用、重复启动、启动中停止/再启动、退出清理和在途请求取消。
- [x] 4.4 按已批准 profile 实现进程级接入/用户显式配置与可逆恢复，不改系统全局代理、不静默重启外部进程。
- [x] 4.5 实现接入诊断：监听状态、证书信任范围、代理流量是否抵达、超时/错误下一步；CLI 与 Web 共用控制逻辑。

门禁：MON-001/002、proxy REQ-002；监听成功但没有请求必须显示“待流量”。候选落点：server/proxy/{ca-manager,mitm-proxy,controller}.ts、server/server.ts、server/cli.ts、配置模块与相邻测试。

## 5. B4 — 增量传输与失败完整性（依赖 B3）

- [x] 5.1 建立有界采集队列/worker，时间戳在捕获点产生，转发回调不做完整 JSON parse/regex/大批 DB 写。
- [x] 5.2 实现增量 UTF-8、SSE 跨块/多行/CRLF/comment、空 delta/结束事件解码，JSON 与支持的 gzip/br/deflate 路径分别测试。
- [x] 5.3 实现解码后正文/解压/队列上限、丢弃计数、慢消费者处理和安全降级；超限不能无限分配或默默丢数据。
- [x] 5.4 补网络错误/4xx/5xx/超时/取消/半截流/正常 EOF，区分 transport EOF 与协议完成，确保每请求幂等最终状态。
- [x] 5.5 在本地可控上游做直连与代理 A/B：字节/协议语义等价、流式顺序不被缓冲到结束、错误/取消传播正确；按 B1 预算记录开销。

门禁：CAP-001/002；任何传输未验证必须在能力矩阵降级。候选落点：server/proxy/{request-context,mitm-proxy,sse-accumulator}.ts、新 worker/队列模块和相邻测试（新增路径先声明）。

## 6. B5 — 三协议、上下文和工具解析（依赖 B4）

- [x] 6.1 协议优先 dispatch，加入 path/body/配置与 host 冲突、unknown/encrypted 测试，自定义网关不再误分发。
- [x] 6.2 Chat：system/developer、结构化 content、tools/functions、流式多 tool index/arguments、usage-only chunk、JSON 响应。
- [x] 6.3 Responses：instructions/input、output text/reasoning/function call、arguments 分片、completed/incomplete/failed、nested usage。
- [x] 6.4 Messages：string/array system、content blocks、tool_use/tool_result、message_start input 与 message_delta output/cache usage、error/stop。
- [x] 6.5 统一原生 usage 与原始证据输出，unknown events 不使请求整体消失；工具声明/调用/执行分开。
- [x] 6.6 与已有 context-normalizer/context-diff 对齐，复用实现并验证规范化不修改原文或role/tool ID；不另建重复 normalizer。

门禁：proxy REQ-008/009；三个协议的 fixture 字段级断言通过，禁止只断言响应字符串存在。候选落点：server/proxy/parser-router.ts、parsers/{openai,anthropic}.ts、新 Responses parser、既有 context 相关模块及相邻测试。

## 7. B6 — 有界持久化、查询与恢复（依赖 B5）

- [ ] 7.1 落地 B1 schema/column constants/缓存 statements，元数据与大正文按契约分层，所有 undefined 转 null。
- [x] 7.2 接入进行中/完成/失败记录的幂等写入、有限重试和崩溃后不完整标记；写失败不发送保存成功通知。
- [ ] 7.3 实现容量保护与用户明确删除（原文默认无自动过期），禁止为腾空间删除 scan 数据；协调显式保留期/删除与恢复日志，重启不得复活已删除记录；测试满额停止、剩余指标、WAL/DB 大小与磁盘满故障。

阶段证据（不代表7.3完成）：schema15精确删除标记、UTC临界和实际CLI/HTTP重启防复活已通过；当前显式TTL已在未提交日志的恢复准入前生效，避免恢复后批量级联删除。容量/标记增长/WAL/磁盘故障与完整请求管理仍待完成。

文件删除基础已实现：最多两个原文ID、读写/恢复互斥、全路径预检、异步删除与部分失败后流式配额核算；真实权限/不可变临时文件故障已覆盖。

持久任务与确认API已接通（schema16）：精确标记/任务/正文提示词副本清空同事务，最多1024任务、同DB共享执行，pending启动续处理、失败显式重试；维护锁拒绝监控启动/并发删除，正文/分析/diff拒绝删除意图且不会通过迟到结果回退。保留headers、请求元数据和原生会话，不等于完整请求擦除。

Web已接通单请求中英文确认、状态/重试和缓存失效：选中后只读一次元数据，显式刷新，不轮询；勾选前禁用、停止监控限制、Escape焦点返回、未知结果不报成功，提交后正文/分析/diff及迟到/重开详情均不能复活缓存。浏览器以隔离合成数据验证到勾选/取消（未点击不可撤销提交）；真实删除及失败/缓存回归由组件和生产API测试覆盖。余下容量/WAL/磁盘/完整请求管理门槛仍未完成，7.3不勾选。

采集DB/WAL准入已接通：同DB最多64任务，异步实测文件，8,000,000 WAL字节触发一次零等待checkpoint，180,000,000组合/8,000,000 WAL字节拒绝新日志/提交/恢复插入。真实固定读者测试先复现5.4s阻塞，再修复busy timeout临时归零/原值恢复；原生SQLITE_FULL及真实代理→失败保留→重启恢复/不重放已覆盖。独立GET /api/proxy/capacity不恢复/不checkpoint；压力下既有正文仍可读及明确清理。共享其他写入者、最坏单事务余量、标记增长、物理ENOSPC和长期分库门槛仍待完成，不能以此勾选7.3。容量Web交付见下段。

v17大事务实测修复：旧全宽native索引在1900长scope工具/32候选的正常解析捕获中，将WAL推至30,224,352B、事件循环p99=54.460ms。仅将native索引改为session/scope NULL局部索引并收紧WAL准入8MB，全部身份及原文保留；1900长scope与2046工具两种实际生产请求已在固定WAL近准入水位下通过原硬预算。新增索引/版本原子回滚、重复启动rootpage不变及ANALYZE后按键SEARCH检查。此为7.3子门槛，不能替代任意输入/共享写入者/物理磁盘满/真机Agent/长稳验收，7.3不勾选。

容量Web已接通：按需抽屉各查询一次原文配额/DB-WAL，手动刷新、5秒取消、独立失败/未知、原文剩余与元数据水位分离；运行状态变化仅本地标过时，不轮询、不创建删除意图。真实隔离页面验证415B原文满额与12,224,072B固定WAL受限，解除后DB/WAL恢复而原文仍满额。浏览器发现全局Enter抢走按钮原生激活，先补3项失败回归再修浮层/原生控件优先级；回车打开/刷新、刷新焦点、Tab循环、Esc归还与中英文已实际核对。完整7.3仍待共享写入者、最坏单事务余量、标记增长、物理ENOSPC/分库及完整请求管理，不勾选完成。

- [ ] 7.4 实现批量/聚合/详情按需 API 和索引查询计划验证，无 SELECT *、无列表正文、无 ORDER BY LENGTH。

共享写入快照子门槛：实际lstat完成时插入storeTraceRecord写入，同连接/第二连接及checkpoint后二次测量均复现旧快照误准入。现以total_changes/SQLite schema cookie/data_version重验，每动作最多3次总测量/1次checkpoint、持续变更明确不可确认，拒绝调用方事务且不回滚/不删原生数据。14项新回归保留1MiB原文、4事件、6身份/指标，并验证IO中timeout137→271不被旧PRAGMA值覆盖。另7项诊断十进制边界/实际SSE所有权/失败证据回归；全量192文件2146通过/1跳过，构建/类型/lint/perf/strict通过。CPU采样优化不弱化校验，失败历史保留；最终3类场景12组×400对ABBA硬预算/相对门槛均通过且资源归零，报告02-03-58.002Z-7338及12个原始checkpoint。只关闭已失效快照竞态，不等于任意未来外部写入或长期共库容量保护；D11记录下一阶分离/跨库崩溃一致性门槛。7.3仍不勾选。
- [ ] 7.5 实现离线证据重解析及 parser/metric 版本失效策略，同一 fixture 重复摄取不重复计费、不发外部请求。

门禁：STORE-001、storage REQ-017、现有 storage/NFR 回归。候选落点：server/storage/{schema,query-engine}.ts、server/proxy/proxy-writer.ts、retention/原始证据查询模块及相邻测试。

## 8. B7 — 跨来源全链路关联（依赖 B6）

- [ ] 8.1 从已确认的原生 scanner/adapters 提取可用 session/turn/request/tool/parent 标识，按命名空间保留，不修改原始来源身份。
- [x] 8.2 实现显式证据关联与来源引用；单独记录候选/用户确认/撤销，不能使用同 host/model/time/hash 自动确认。
- [ ] 8.3 实现模型调用/重试尝试/工具执行/子 Agent 已知关系的关联读模型；原始 scan/proxy 数据仍独立。
- [ ] 8.4 构造两个同模型并发会话、重复日志、重试、乱序/晚到、重启后续会话 fixture，断言不串会话、不重复统计。
- [x] 8.5 修正关联 Trace 的 system prompt 与前一轮 context 选择：时间窗最长/同 captureGroup 的上一条仅可作候选，用户可显式选择比较对象。

门禁：MON-003、TRACE-001；至少一条具有明确关联证据的“用户请求→模型→工具→模型→完成”全链路 fixture 可从 Web API 读取，缺少原生时长时如实标未知。候选落点：已批准 scanner/adapter、storage 关联模块、现有 context-diff-service 与相邻测试。

## 9. B8 — 可信指标和优化诊断（依赖 B7）

- [ ] 9.1 实现代理响应头/首内容类别/结束时间及 native timing 并列，单调时钟计算；受控时间 fixture 验证 100/800/2000ms 示例。
- [x] 9.2 按协议映射 cache/reasoning 子集、快照/增量和 native total；回归 input100/output20/cached40/reasoning5→total120 及 OpenCode cache sum12016。
- [ ] 9.3 实现去重后的调用/重试/token/cost 聚合、来源口径、未知价格展示；与明细逐条计算结果一致。
- [ ] 9.4 实现有证据的上下文增长、重复请求、缓存利用、慢调用和工具失败诊断，每条链接相关证据，不承诺 Accuracy 真值。
- [ ] 9.5 保留旧 scan 指标标签并阻止不同口径直接做速度倍数结论，更新 metrics version 与相邻测试。

门禁：MET-001/002、MON-004；未知≠0，TTFB≠首内容，E2E≠纯推理。候选落点：src/core 现有 metrics/speed/cost 模块、server 聚合与诊断模块及相邻测试。

## 10. B9 — 实时 Web 闭环（依赖 B8）

- [ ] 10.1 将真实采集 producer 连到 event bus/coalescer/SSE，完成 100ms stream 与 200ms session 合并、有限恢复游标和断线补齐。
- [ ] 10.2 Proxy 控制区接入能力矩阵/向导/范围选择/开关/待流量/降级/错误状态，保持现有导航与唯一 App shell。
- [ ] 10.3 增加关联 Trace 入口、分页虚拟化层次时间线、来源/候选标记；正文与 raw 按需加载。
- [ ] 10.4 详情展示上下文/响应/tools/timing/usage/error/完整性，接入现有 diff，提供两个运行/调用的证据化比较与诊断。
- [ ] 10.5 完成中文/英文、键盘操作、loading/empty/error、隐私警告；测试慢浏览器、断线重连、乱序重复通知和无手动刷新更新。
- [ ] 10.6 浏览器实际验证网络请求数量、列表无正文、无 N+1、虚拟化 DOM 与现有 NFR，保存结果记录。

门禁：LIVE-001/002、UI-MON-001/002/003、frontend REQ-013；用户流程不是空壳按钮。候选落点：server/realtime、src/App.tsx、ProxyView/TraceTimeline/EventInspector/CompareBoard 与 API/i18n/hooks 的确切相关文件，动手前逐一列出。

## 11. B10 — R1 发布验收（依赖 B9，未过不得宣布完成）

- [ ] 11.1 执行 handoff-6.1.md 的 A01–A12 全部验收，记录每项 command/环境/版本/结果/证据路径，不用 mock 冒充网络或真机。
- [ ] 11.2 在用户授权的首批实际 Agent 上各完成至少一次新会话、多轮、工具、失败/取消测试，记录关联是否有直接证据；无环境组合不标已验证。
- [ ] 11.3 做 2 个并发 Agent 同模型交错请求验证，确保不串会话、不重复计 token；若无真实并发环境，保留 fixture 通过但真机项未完成。
- [ ] 11.4 测试30分钟受控持续流量、容量高水位、慢消费者、队列过载、异常退出与恢复；记录无丢失范围以及实际降级计数，不追求隐藏丢弃。
- [ ] 11.5 运行 npm run typecheck && npm run test && npm run lint && npm run perf:check，按合同数据集追加 PERF-BASELINE.md；所有失败修实现，不松断言。
- [ ] 11.6 更新使用文档/支持矩阵/首次证书步骤/恢复指引/保留边界，提交前检查无敏感样本、无额外 runtime dependency；按 AGENTS 英文 milestone commit 规则提交。

门禁：可重复演示首次接入后“点击监控→真实数据→关联 Trace→问题诊断→停止恢复”；不可观测范围已标注，现有扫描/比较/聚合没有回归。

## 12. B11 — R2 扩展 Agent 与特殊传输（后续范围，不冒充 R1）

- [ ] 12.1 根据用户优先 Agent 与真实样本更新规格/契约/白名单；按平台逐个确定 CodeArts/CodeAgent/Qoder/Trae 等接入，保留当前 scanner。
- [ ] 12.2 对缺少工具/子 Agent 原生证据的目标评估官方 hook/插件，先确认接入权限与边界，再实现，禁止篡改 Agent 内核。
- [ ] 12.3 实现经过样本验证的嵌套协议 adapter；若需要 HTTP/2/WebSocket/gRPC，先验证现有引擎与支持边界，新增依赖必须另批。
- [ ] 12.4 标准 Electron CDP：修 request/response id 匹配、body 读取、target 重发现、生命周期与生产/dev 能力声明；不能用于声称解密 TTNet。
- [ ] 12.5 Windows Trae CN Frida：修 PID+模块探测、完整 marker 帧/HEX/UTF-16、持久化/通知/停止清理；拿实际目标版本真机验收，不能以 Trae CLI 代理替代。
- [ ] 12.6 每新增 Agent/OS/传输均补安全与并发关联回归，再更新能力矩阵；未取得真机证据保持部分/实验性状态。

## 13. B12 — R3 标准导出与评测闭环（后续范围）

- [ ] 13.1 另提标准 Trace/OTel 导出契约，定义跨来源 ID、时间、原文保留及未知属性映射；不自动发送云端。
- [ ] 13.2 建立同任务/模型/参数/工具集/输入版本可比的实验记录与结果标签，区分自然流量对比和受控实验。
- [ ] 13.3 需要真实重放时先单独设计权限、工具副作用隔离、费用上限与人工确认，默认仍为离线解析 replay。
- [ ] 13.4 用真实优化前后样本验证建议是否降低成本/延迟且质量未退化，再扩展自动适配；不凭监控指标自动修改用户 Agent。
