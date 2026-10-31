# 第二项：工具执行调查台

2026-10-19，M11融合功能批；隔离分支codex/telemetryref-npm-continuation，
基线29e9e20。保留上一批全部修改，原npm工作树25个脏文件不改。不提交/推送/发布。

## 功能与验收

补齐原计划8.3/10.3的原生工具过程调查，不重复家族浏览器。复用现有
LinkedExecutionPage与单事件正文/Raw API，不新增HTTP/DB/采集字段。
按完整清单内明确的namespace/scope/tool_call值归并当前页记录，保留各自事件ID、
序号、输入/输出标志、状态与来源定位；同名/相邻/时间不用于关联。
不同turnKey重复ID、多个ID绑定、无ID或不完整依据保留为独立记录。
归并是局部证据组织，不是新的执行ID、全会话工具次数或成功/因果证明。
分页以实际返回事件数前进，显式前后页；不跨页猜测缺失输出。不计算费用/质量分数。

验收：两次同名调用交错和输出乱序、明确错误、只有输入、缺少原生ID、分页；
选定事件按需读取输入/输出与Raw，字体可调，原生上下文与事件详情可浏览。
列表虚拟化，筛选只用当前页元数据，空/错误/过期/取消明确，双语，不轮询/N+1。
实际运行隔离合成fixture，至少两张真实页面截图上传本人Library后停止本轮。

## 本轮精确白名单

- 本文件（实现、测试、验收与截图回执）。
- openspec/contracts/data-model.md；src/core/trace-types.ts（仅客户端派生ToolInspectionGroup）。
- openspec/specs/frontend/spec.md（REQ-036）。
- src/core/tool-investigation.ts、tool-investigation.test.ts。
- src/components/ToolExecutionPanel.tsx、ToolExecutionPanel.test.tsx。
- src/components/TraceLinksPanel.tsx、TraceLinksPanel.test.tsx（独立惰性入口）。
- src/styles/components/session.css（新增调查台样式）。
- scripts/demo-tool-execution.mjs（独立合成目录/真实normalizer与CLI，禁用真实扫描）。

原API/DB/NFR界限不变，无新依赖。费用、真实执行重放、性能与可靠性专项均后置。
文档已有Vitest3/schema18与锁定Vitest4.1.10/schema20漂移，采用权威契约与已有锁版本。
原8.3/10.3复合项仍不整项关闭；更多平台真机、完整调用图、跨页全图、重试证明仍待办。

## 实现与验证

已实现frontend REQ-036，新增客户端ToolInspectionGroup契约；不修改HTTP/DB/采集器。
新增20项相邻测试：证据投影12、调查台7、独立入口1。当前页保留过程虚拟列表、
工具组与精确事件选择，双语元数据筛选、来源定位、单事件正文/Raw按需读取、
64KiB初始文字、8..28字体控制、显式前后页及5秒取消/超时/过期响应隔离。

`npm run typecheck`、`npm run lint`、`npm run build`、样式与相关61项测试通过。
最终完整回归281文件通过，3369项通过、1项既有跳过，退出0，96.70秒。
证据：`/tmp/awesomeTelemetry-tools-regression.log` 与
`/tmp/awesomeTelemetry-tools-regression-result.json`。
`git diff --check`、`npx openspec validate fuse-agent-monitoring --strict`、
`node scripts/verify-package.mjs`通过。无新依赖、无费用/性能归因/长稳扩展。
最初默认沙箱不能监听本机端口，应用启动失败EPERM；已确认原进程退出，
停止唯一自有测试runner，保留sandbox-interrupted日志，再在已授权本机环境启动。
最终结果仅计完整本机环境运行，不把中断或环境错误计为测试通过。

真实HTTP与同一投影函数逐项验收通过，回执：
`/tmp/awesomeTelemetry-tools-http-acceptance.json`。真实normalizer写入主会话107事件，
首100/次7；工具组5个：A输入/输出、B输入/输出、ERROR输入/错误输出、PENDING仅输入、
无原生ID独立记录。正文和Raw按选定事件可读；另一会话的同call_demo_A有独立scope，
没有串入主会话；空工具会话为0组。所有元数据事件均无正文/raw列。

### 本机验收页面与步骤

服务已保留：`http://127.0.0.1:4188/`，PID48263。
入口 `http://127.0.0.1:4188/#/session?key=codex-033c7e8c263ca3&time=all`。
日志 `/tmp/awesomeTelemetry-tools-app.log`；进程记录
`/tmp/awesomeTelemetry-tools-app-process.json`。上一项4187服务未停止。

```sh
cd /tmp/awesomeTelemetry-telemetryref-npm
npm run build
node scripts/demo-tool-execution.mjs --port 4188
```

所有样本在独立合成目录
`/var/folders/s0/hq9xh_155zn9xb35dg87fhcc0000gn/T/awesomeTelemetry-tools-acceptance`，
标记SYNTHETIC，禁用全部真实provider扫描；无付费/工具调用、凭据、代理或安全设置改动。

1. 打开入口，点击“工具执行调查台”；查看过程和当前页工具记录组。
2. 选择read_file的call_demo_A/B，核对分别对应#3/#6与#4/#5，选择事件后显式读取正文。
3. 选择run_tests，读取错误输出和Raw；选择write_file可见本页缺输出/结果未知。
4. 选择无ID记录，确认不凭同名猜测；使用“仅错误”或工具名/ID元数据筛选。
5. 下一页为7条上下文，工具为空时明确说明；上一页恢复事件0页。列表中无工具会话
   codex-acfe9df0f881b4和同ID独立会话codex-524de9e3f5d8d7也可分别检查。

### 浏览器/截图交付阻塞（尚未闭环）

已在实际浏览器打开4188合成页面，AX确认标题、107事件、独立“工具执行调查台”入口，
及3会话/111事件。随后调用浏览器说明/打开调查台的操作返回Transport closed；
按已知页面URL恢复已有标签页也返回Transport closed，无法读取后续状态。
这是连接故障，非安全审批拒绝；该只读点击是否完成尚未确认。
本轮两张截图尚未生成，Library上传动作尚未执行，无附件ID、无结果未知的写入。
不能用HTTP/组件测试或上一项截图冒充本轮实际浏览器闭环。
恢复浏览器控制后只需继续现有tab2/服务做上述点击验收并截图，随后按授权使用
create_library_file(files=[两张绝对路径], library_artifact_type='image')正式本地路径批量
上传、核对每项结果、将返回xattrs写回原始文件并返回library_file_id。不要重复开发、
重新启动或开启第三项。当前未宣布第二项全部验收完成。


### 浏览器恢复尝试补充

后续连接恢复后，先检查原PID48263与lsof：4188仍由同一进程监听，启动自检
schema20/3会话成功，未重启应用、未重跑测试。当前可调用工具目录未提供
cua_repl/browser-use，无法检查旧标签页的最后一次只读点击。

检查已安装Chrome与Node原生WebSocket能力后，提出独立临时Chrome配置、仅访问
4188合成页的CDP备用验收。自动审批在CreateProcess之前明确拒绝整条命令：
“launches a separate Chrome instance and drives it via raw CDP/WebSocket and DOM
 evaluation instead of the required cua_repl/browser-use route; the user authorized
 browser acceptance generally, not this computer-use bypass approach”。
未执行被拒绝命令，未创建该备用脚本/浏览器或调试端口，未尝试绕过。
恢复条件：重新提供可调用的cua_repl/browser-use；或由用户明确授权上述临时
Chrome/CDP验收路线后，按新的实质授权仅重试被拒绝操作一次。
截图仍未生成、上传未执行、无本轮Library ID；无结果未知的写操作。


### 2026-10-19 本聊天真实页面验收与本机截图

本次仅使用获准的 `cua_repl` / in-app browser。先用 lsof 确认
127.0.0.1:4188 仍由原 PID48263 监听；未重启服务、重跑测试或修改应用代码。
旧聊天标签页不在本聊天浏览器清单内，已打开同一入口的新标签页1，完成验收后
markDeliverable 保留主会话调查台（A输出正文）。旧标签页最后一次点击的历史状态
仍不可追溯，但已通过新页面重新完成对应只读操作，无结果未知的写操作。

本次实际页面通过：A的#3/#6与alpha输入输出；B的#4/#5与beta输入输出；
错误#7/#8的正文与Raw；PENDING#9明确显示本页未见输出/结果未知；
无ID#10保持独立记录；仅错误筛选只剩1组；按call_demo_B筛选只剩#4/#5。
下一页101–107/107为7条上下文、0工具组且下一页禁用；读取#101正文成功；
上一页恢复1–100/107及5组。另一会话同call_demo_A仅含#1/#2且scope为
native-tools-other，无串入主会话；无工具会话呈现0组明确空态。
关闭抽屉焦点返回入口，Raw A+操作可用。未发现本次验收范围内的实现问题。
未另行注入网络错误/取消/过期竞争，不将此前测试当作本轮浏览器验证；
英文、字体上下限、性能预算未在本轮另验。

两张真实浏览器JPEG截图（未编辑像素），均已核对可读：
- `/tmp/awesomeTelemetry-tools-delivery/01-native-id-interleaving.jpg`
  — A/B原生ID交错分组、选中A输出正文。
- `/tmp/awesomeTelemetry-tools-delivery/02-error-event-raw.jpg`
  — 错误原始事件、明确错误提示、完整Raw文字。

验收与SHA256回执：`/tmp/awesomeTelemetry-tools-delivery/acceptance-receipt.json`。
最终页面AX：`/tmp/awesomeTelemetry-tools-delivery/final-page-ax.txt`。

**验收任务交接时阻塞：正式Library上传能力缺失（现已解除，见下）。** 当时可调用工具目录没有
`library.create_library_file`，插件能力发现也未返回对应入口。没有上传尝试、
没有library_file_id、没有返回xattrs，因此未伪造或写入上传属性；未改用Page或
其他存储目的地。实际页面验收与本机截图已完成，但“上传本人Library并核验全部
xattrs”的最后交付步骤尚未完成，第二项不得宣称全部交付闭环。

此前独立Chrome/raw CDP路线的自动审批拒绝继续有效；本轮没有重试或绕过。
只新增/tmp截图/回执及本文件交付记录；无源码改动、提交、推送、发布或PR。

### 2026-10-19 主任务完成 Library 交付

主任务通过正式 Library 批量上传以上两张原始截图，每项均返回 succeeded：
- 01-native-id-interleaving.jpg：library_file_id `libfile_4c0caaa2a05881919192a3fac69c5b65`，file_id `file_000000008c5482068139b493d6616afb`。
- 02-error-event-raw.jpg：library_file_id `libfile_565e3e4772208191b8cca39b505ef8a0`，file_id `file_000000003f448206af43670a6f3f41f9`。

每项全部返回属性 user.library-file-version=0 已通过本机 xattr 写回原文件并读取核验。
完整回执：/tmp/awesomeTelemetry-tools-delivery/library-upload-receipt.json。
此前页面/本机截图验收保持有效；该功能的截图交付阻塞已解除，不代表原8.3/10.3大项全部关闭。
