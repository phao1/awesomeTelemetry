# 功能继续实施：第二批

最新用户指令再次授权开始实现所有功能项、功能优先、独立功能可新起会话。
此指令取代此前仅收尾/不新增功能的数量范围。保留费用、性能归因/长稳专项、
真实执行重放暂缓；不新增凭据/付费模型或真实工具执行、不安装软件或改系统设置，
不提交/推送/发布。旧rawCDP浏览器自动化的明确拒绝继续有效。

仍只在 /tmp/awesomeTelemetry-telemetryref-npm 工作，M11功能增量、M12 npm基线。
原主checkout不编辑，旧npm工作树25脏文件保留。本批不重复未知的浏览器下载，
不重复上批SYNTHETIC实验记录；已有服务不重复启动，最终接线后只更新自有合成服务。

## 功能与独立文件所有权

1. Frida持久化与详情：独立任务只可编辑下列文件：
   openspec/contracts/frida-capture-flow.md、openspec/changes/fuse-agent-monitoring/frida-capture-feature.md；
   server/proxy/frida-capture.ts及.test.ts、server/proxy/controller.ts及controller.test.ts；
   server/storage/frida-captures.ts及.test.ts、server/http/frida-capture-routes.ts及.test.ts；
   src/api/frida-captures.ts、src/components/FridaView.tsx及FridaView.test.tsx；
   src/components/FridaCaptureInspector.tsx及.test.tsx、src/styles/components/frida-captures.css。
   保留其他ProxyRuntime行为，不能改server.ts/全局DTO/DBschema/共享client/根契约。
2. 标准Electron产品CDP采集：另一任务只可编辑
   openspec/contracts/cdp-capture-flow.md、openspec/changes/fuse-agent-monitoring/cdp-capture-feature.md；
   server/proxy/cdp-capture.ts及.test.ts、server/proxy/cdp-session.ts及.test.ts。
   仅产品实现/合成协议测试；不启动Chrome/Electron，不控制本机浏览器，不实际采集用户数据。
3. 关联会话跨来源OTLP导出第三个独立任务，仅可编辑
   openspec/contracts/linked-trace-export.md、openspec/changes/fuse-agent-monitoring/linked-trace-export-feature.md；
   src/core/linked-trace-export.ts及.test.ts、server/http/linked-trace-export-route.ts及.test.ts；
   src/api/linked-trace-export.ts、src/components/LinkedTraceExportPanel.tsx及.test.tsx、
   src/styles/components/linked-trace-export.css。复用现有v1导出，不修改其语义和代码。
4. 主任务：共享根文件顺序接线、集成与最终验收，不与独立任务互改文件。

新文件须先更新各任务feature白名单，不能越过另一任务所有权；最终任务返回接线接口。

## 主任务精确白名单

- 本文件、npm-continuation.md与trace-export-feature.md（进度/证据）。
- openspec/contracts/trace-export.md、data-model.md、api.md、nfr.md、
  openspec/specs/storage/spec.md、frontend/spec.md、proxy-capture/spec.md。
- src/core/trace-export.ts及.test.ts、server/http/trace-export-route.ts及.test.ts。
- src/api/trace-export.ts、src/components/TraceExportPanel.tsx及.test.tsx。
- 共享顺序接线：server/server.ts、server/functional-integration.test.ts、
  src/styles/components.css、src/components/TraceLinksPanel.tsx及.test.tsx。

只依照保留的原生身份、现有已接受关联、已有传输时钟导出；源数据/正文原样保留，
不把网络观测与日志点拼成虚构执行/重试链，不合并重复计费。先冻结扩展契约再写代码。
所有新UI用既有设计tokens、lazy显式入口、单事件按需正文、取消/失效/未知结果。
最后统一运行适当回归/类型/lint/build，源码实现不等于真机/完整复合大项验收。

## 新会话

- Frida模块：01a1551d-f5ac-7241-ad76-693e1f812891。
- CDP模块：01a1551e-1239-7d61-9bc0-ec423ffb0a13。
- 跨来源导出模块：01a15520-5b65-7b50-9359-12fefe873ace。

共享集成预审发现现有Frida路径未进入本地Host/Origin保护；本批接线时一并纳入，
防止将新详情或既有启动/停止暴露到不同Origin。PID请求须为可精确表示的正整数。

追加主任务白名单 openspec/contracts/database.md：仅把独立Frida模块从既有§3.8
提取的显式列常量记入§5.2及有界预览规则，不改DDL/index/schema。

追加主任务白名单 scripts/demo-functional-rollout.mjs：只扩充原native-tools-v1合成
fixture的一个Frida保存记录和一个明确原生ID关联的合成proxy记录，幂等且不改旧实验。
仅在全部模块/构建通过后替换自有4188进程，不启动真实Agent/Frida/CDP或额外服务。

## 本批结果与验证

- Frida：增量UTF-8/UTF-16LE/HEX完整帧、入库后通知、进程代际/停止所有权、
  有界列表/详情和独立抽屉完成。独立6文件70项回归通过；保持ProxyRuntime行为。
- CDP：真实相关器/管理器实现，54协议/发现/生命周期测试，加4能力与1生产404
  检查通过。没有产品调用点；dev路由仍未接线，真实Electron与TTNet不认证。
- 跨来源OTLP：LTX-001..005独立转换/严格client校验/handler/双分页面板完成，
  65项新增、30项v1回归通过；真实SQLite读为11 SELECT、一个快照、零写入。
- 主任务接线：Frida路由与数据库依赖、stop/shutdown等待、Host/Origin保护和
  安全整数PID；会话页保留v1并增加独立linked导出入口。生产HTTP/入口36项通过。
- 根类型检查发现核心测试导入服务端导致TS6307，已由独立任务修复测试分层；
  保留全部转换断言与服务端ID测试，不改tsconfig/契约或弱化断言。
- 最终全量299文件、3675通过/1跳过，比上一批增加176项；typecheck、lint、
  build、package产物核对、git diff --check通过。没有提交、推送或发布。
  日志 /tmp/awesomeTelemetry-functional2-regression.log、functional2-build.log、
  functional2-lint.log。原npm工作树25个保护文件SHA256核对全部未变。

## 合成演示与验收边界

确认旧PID69158命令后已停止，仅替换同一4188自有服务，现PID85346，命令
`node scripts/demo-functional-rollout.mjs --port 4188`。真实scanner全部禁用，
仍3会话111事件；幂等增加1个SYNTHETIC Frida保存记录和1个明确原生ID关联的
SYNTHETIC网络记录，没有启动真实Frida/CDP/Agent。既有手工实验文件逐字节未变。

生产HTTP实际返回Frida #1完整JSON且未知model/session/tokens为null；linked
OTLP125005B，100个scan点与1个network独立trace，no-store，生成traceID互不重叠。
独立HTTP产物与摘要回执在 /tmp/awesomeTelemetry-functional2-delivery/：
linked-metadata-page-0.otlp.json、synthetic-frida-detail.json、acceptance-receipt.json。
它们不是浏览器下载回执。

仅正常cua_repl绑定既有iab4、显式重载新构建并切到Frida，页面当时显示加载中。
随后只读状态等待发生Transport closed；一次只读连接检查同样失败，未再操作。
新Frida详情/linked导出页面闭环仍受浏览器连接阻塞，不能列作已通过。没有触发本批
浏览器下载、实际Frida启动或旧v1未知下载重试；此前rawCDP自动化拒绝仍未绕过。

## 剩余边界与总账

仍76个复合大项、41关闭/35未关闭（32部分、3尚未实现），未以源码/合成测试
提高关闭数。12.4协议子模块和12.5保存详情子模块有新证据；12.4产品dev入口、
12.5实际版本hook/Windows目标、12.2官方hook权限接入、真实多Agent/平台认证
仍未完成。13.1现支持跨来源元数据，但原始证据包装/collector互通未认证；
13.2已有手工记录/比较，不等于真实受控执行。真实重放、真实优化质量验证、
费用及性能长稳专项按既有边界暂缓。下一轮不得重复已完成合成写入或未知下载。

## 后续独立功能：Frida实时保存入口

继续核查发现App未监听已有Frida保存/运行事件，已按 frida-live-feature.md 的精确
白名单补齐：共享SSE保留20个去重保存ID，显式点击才读详情；运行通知和控制快照/
未知命令结果分开，断线标未知，reset关闭/取消旧详情并清空通知。不增加API或正文
预取。3项新增测试后，全量299文件/3678通过、1跳过；类型/lint/build/package/
diff通过。未再改fixture、重启demo或操作浏览器；35个复合大项仍未关闭。

## 下一步契约确认点：CDP产品开发入口（草案，未实现）

API §8只保留四个路由名，未定义公开请求/响应。内部 cdp-capture-flow.md
已有port选项、status与target类型，但明确不提供public DTO。因此不能直接把
内部对象冒充已批准HTTP契约。按AGENTS“Field not defined in the contract →
stop, list the fields you need and why, and wait for an answer”停在此处。

待确认的最小草案：POST /api/cdp/start接受可选port（默认9222、安全正整数
1..65535），start/stop/status返回既有{state,discovering,targetCount,
connectedTargetCount}，GET /api/cdp/targets返回{items:CdpTarget[]}，每个target
仅含既有{id,title,url,webSocketDebuggerUrl}。用途是显式开发控制/目标诊断，
不是新增原生身份或未定义的采集成功计数。沿用本地Host/Origin、no-store、
ApiError与有界目标；生产server保持404，开发启动必须显式操作，绝不自动
扫描端口/启动Chrome/Electron。只写代码和合成测试，不激活真实捕获。
正文持久化仍需另行冻结可观测请求/时钟与原始字节语义，不能把现有url/body
callback补成虚构完整请求。此草案未写入权威契约/未实现端点，等待用户答复。

其他阻塞保持：浏览器transport关闭、实际Windows目标/模块版本hook缺失、
官方hook目标与接入边界未确认。真实Agent执行/费用、长稳与发布仍按已有边界。
可用工具元数据中未找到stop_goal，因此无法调用该目标控制操作；不冒充已停止。
