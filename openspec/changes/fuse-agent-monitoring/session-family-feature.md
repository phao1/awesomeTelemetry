# Agent 会话家族与网络尝试浏览器

2026-10-19。M11融合功能批；基线29e9e20，当前隔离分支
codex/telemetryref-npm-continuation。保留上一批trace-links修复、9项测试与全部记录。
用户最新优先级：只交付一项页面可验收的非费用功能；费用、性能归因、长稳与可靠性
专项后置。必要正确性/隐私/回归保留；不推送、发布、部署或合并。

## 原计划与本批闭环

原8.3/10.3明确要求子Agent已知关系读模型及层次浏览/Trace入口，尚未完整实现。
现有parents API和面板只有单向父级引用，execution API已有独立尝试与原生事件。
本批完整产品功能是一个可打开、双向浏览、展开、查看执行/尝试详情及跳转Trace的
“会话家族浏览器”，不将它包装为整个8.3/10.3或全平台运行时拓扑已完成。

只使用原生parent_session的namespace/value/scope、完整性及全量唯一owner；
显示声明来源，不推断运行时spawn/通信。重试缺少明确来源时保持未知；失败后成功、
同host/model/时间/previous_response_id不能自动变成重试。独立尝试保留且可逐条查看。

## 精确文件白名单（先定义契约，再采用其类型）

- 本文件：范围、验收、截图与非费用backlog。
- openspec/contracts/data-model.md、database.md、api.md、nfr.md。
- openspec/specs/storage/spec.md、frontend/spec.md。
- src/core/trace-types.ts。
- server/storage/session-family.ts、session-family.test.ts。
- server/storage/schema.ts、schema.test.ts（仅v20反向父级索引）。
- server/server.ts、server/session-family.test.ts。
- src/api/client.ts。
- src/components/SessionFamilyPanel.tsx、SessionFamilyPanel.test.tsx。
- src/components/TraceLinksPanel.tsx、TraceLinksPanel.test.tsx。
- src/styles/components/session.css。
- scripts/demo-session-family.mjs（独立合成目录/禁用真实扫描，显式启动实际CLI）。

既有费用/provider逻辑、原25脏文件、旧调查样本均不改。合成fixture/截图/应用状态
放独立/tmp目录，不提交真实trace或凭据。截图使用Library skill明确授权的交付流程；
上传失败如实给本机路径，不宣称已交付附件。

## 验收场景

1. 合成主会话→两个子会话→明确的更深层子会话，可展开并看到真实原生定位。
2. 选择子会话，查看其两次独立捕获（一次网络失败、一次完成）；是否重试保持未知。
3. 展开一个尝试的独立网络证据，读取一个原生事件详情，跳转对应抓包/原生Trace。
4. 缺少父级声明、没有子级、没有关联捕获、歧义/不完整均显示清楚的状态。
5. 真实运行页面的总览、展开/详情至少两张可读截图；合成标识可见。

## 后续非费用backlog（本批不铺开）

- 有明确原生声明的重试关系/调用图、完整工具执行及跨来源因果证据。
- 更多Agent/平台的父子标识映射与真机多轮/工具/取消/交错并发。
- 全层级实时恢复与完整浏览器验收、标准Trace/OTel导出、受控任务结果标签。
- 费用相关全部暂缓；性能归因、长期可靠性、分库/磁盘边界均不在本批。

## 实现与验证记录

已实现 storage REQ-024 / frontend REQ-035，使用冻结的 NativeSessionFamilyPage
类型及 GET /api/sessions/:key/family；schema20只加parent_session反向部分索引，
19→20事务迁移不重写既有会话/抓包。默认20/max50子级，单页<=1MiB，固定批量查询。
元数据树虚拟化、显式展开至4层；可选择节点为新中心继续浏览。详情按需读取，
不启动Agent、不访问上游、不轮询、不做费用计算。双语、焦点归还、5秒读取期限、
取消/过期响应隔离与显式错误重读均已覆盖。

新增34项测试：storage家族11、HTTP12、schema迁移2、家族组件8、入口整合1。
全量 `npm run test -- --maxWorkers=2`：279文件通过，3349项通过、1项既有跳过，
退出码0；日志 `/tmp/awesomeTelemetry-family-regression.log`，退出记录
`/tmp/awesomeTelemetry-family-regression-result.json`。终端会话中断的两次未完成运行
不计通过；最终独立进程完整运行96.01秒。早期schema版本断言及CSS token检查发现
的问题均修正实现/对应新契约版本，未放松断言；单独的51项相关检查也通过。
`npm run typecheck`、`npm run lint`、`npm run build`、`node --check scripts/demo-session-family.mjs`、
`git diff --check`、`npx openspec validate fuse-agent-monitoring --strict` 及
`node scripts/verify-package.mjs`通过。构建产物已用于实际页面；本批不运行性能归因/长稳，
不宣称既有NFR差距关闭。family懒加载chunk gzip5.93kB；构建仍报告既有CSS预算差距。

原npm worktree的25个脏文件逐个SHA-256复核均未变化；旧trace-links修复及调查记录保留。
没有新增依赖，没有费用/provider逻辑变更，没有提交、推送、发布、部署或合并。

### 本机启动与验收

实际应用已启动在 `http://127.0.0.1:4187/`，独立进程PID32792。
日志 `/tmp/awesomeTelemetry-family-app.log`；进程记录
`/tmp/awesomeTelemetry-family-app-process.json`。本轮保留服务和验收标签页。
启动命令（当前服务运行时无需重复执行）：

```sh
cd /tmp/awesomeTelemetry-telemetryref-npm
npm run build
node scripts/demo-session-family.mjs --port 4187
```

入口：
`http://127.0.0.1:4187/#/session?key=codex-f12fb7cb8c7e20&time=all`。
独立合成目录为
`/var/folders/s0/hq9xh_155zn9xb35dg87fhcc0000gn/T/awesomeTelemetry-family-acceptance`；
有SYNTHETIC标记及session-keys.json，所有真实provider扫描均禁用，未修改HOME、
系统代理/信任或用户原始数据库。重复启动保留合成数据、不删库重置。
首次实际启动曾暴露示例key不符合现有deriveSessionKey导致清理；已改为使用真实key派生，
保留合成JSONL/抓包并补齐缺失会话。现实际页面稳定显示5会话/10事件/2捕获。

1. 打开上述入口，点击“Agent 家族与尝试”。主会话显示两个已解析子级声明。
2. 展开“接口研究 Agent”，可见“字段校验子 Agent”；选择节点看来源定位，
   或“以此会话为中心”双向浏览其父级/子级。
3. 选择研究Agent的“执行与尝试”：两条捕获分别网络失败和完成，重试关系保持未知。
   展开失败记录，检查HTTP200与网络失败可同时存在，保留原生response标识。
4. 点“读取事件详情”，可按A−/A+/R阅读正文；文本中的script标签作为文字显示。
   “打开抓包Trace”实际进入请求#1并显示ECONNRESET；“打开原生Trace”进入所选会话。
5. 选择列表中的“未关联会话（空状态）”并打开同一入口：显示没有父级声明、
   0个子级及“没有已确认关联的网络尝试”。不把缺失声明断言为真实根节点。

以上操作均在实际构建应用及浏览器完成，包含孙级原生Trace和失败抓包Trace跳转。
自动测试另覆盖歧义/不完整/命名空间隔离/重复定位/自引用/分页/字节边界，
浏览器演示不冒充九平台真机认证。

### 实际页面截图

全部为浏览器原始JPEG截图，978×815，未重绘或缩小文字：

- `/tmp/awesomeTelemetry-family-screenshots/01-family-overview.jpg`：父级概览。
- `/tmp/awesomeTelemetry-family-screenshots/06-family-network-detail.jpg`：三层家族、两个独立尝试、网络状态/原生匹配及抓包入口（主交付）。
- `/tmp/awesomeTelemetry-family-screenshots/02-family-expanded-attempt.jpg`：三层展开与两次尝试。
- `/tmp/awesomeTelemetry-family-screenshots/03-family-evidence-detail.jpg`：按需事件正文与字体控制。
- `/tmp/awesomeTelemetry-family-screenshots/04-capture-trace.jpg`：跳转后的抓包详情。
- `/tmp/awesomeTelemetry-family-screenshots/05-family-empty.jpg`：无父子关联的空状态。

Library截图交付阻塞已解决。按后续明确指令使用正式本地绝对路径批量上传接口，
两项逐一返回succeeded；未使用私有下载URL、未重复上传，也未扩展开发范围。

- 01-family-overview.jpg：library_file_id `libfile_e4382dcde0488191b6985668fa6988da`，
  file_id `file_000000007c1881f5959c3b6405a6b393`。
- 06-family-network-detail.jpg：library_file_id `libfile_5d751c27f488819192a03241718ea336`，
  file_id `file_00000000ef848246b968bc878a582fa1`。

两份原始本机截图的返回属性 `user.library-file-version=0` 已用系统xattr命令写入并逐项
读取校验。交付回执保存于 `/tmp/awesomeTelemetry-family-screenshots/library-upload-receipt.json`。
此前辅助脚本包不可用的记录仅为上传前历史阻塞，现无截图交付阻塞。验收应用继续保留。

原计划8.3/10.3为复合项，本批不虚报整项关闭，原41/76闭合统计不因此增加。
本轮到此停止，等待用户验收这一项，再决定下一项非费用功能。
