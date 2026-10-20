# 非费用功能继续实施

2026-10-19。最新用户目标：开始实现所有功能性任务，功能优先，独立功能可以新起会话。
这一目标取代此前“仅做一项后停止”的数量限制；费用、真实执行重放、性能归因和
可靠性专项仍暂缓。必要正确性、隐私、回归及原契约硬界限不省略，不假称全平台认证。

工作树 /tmp/awesomeTelemetry-telemetryref-npm，分支codex/telemetryref-npm-continuation；
不改原工作树25脏文件，不reset/clean/提交/推送/发布/PR。仅合成演示数据，
不新增凭据、不安装软件、不改网络/安全设置、不发付费模型或真实工具调用。
之前独立Chrome/CDP备用验收遭明确拒绝；本轮不重试或通过新任务绕过，缺少
cua_repl/browser-use时报告阻塞。用户的新目标不是该方法的新批准。

## 独立任务与写入所有权

- 工具调查台浏览器验收：01a154b1-9760-7da2-8fa5-b72d1720e66f。
  只写其交付记录、/tmp截图/回执，不改应用源码，不重复服务/全量测试。
- OTLP本地Trace导出：01a154b3-9db9-71d0-81a7-24a834f87e97。
  仅trace-export新契约/feature记录、core转换、独立HTTP handler、独立API client、
  TraceExportPanel与独立CSS及相邻测试；共享根文件由本任务顺序接线。
- 手工受控实验记录：01a154b3-b8b6-7092-ac50-855b53f1ed4a。
  仅experiment-records新契约/feature记录、独立registry/handler/client/panel/CSS及
  相邻测试；不执行实验或改原始会话/DB，根任务顺序接线。
- 当前任务：原生工具同ID跨页证据读取与共享集成；先写契约再实现，互不覆盖上述文件。

## 当前任务精确白名单

- 本文件。
- openspec/contracts/native-tool-observations.md（字段/查询/界限）。
- src/core/native-tool-observations.ts（契约类型）。
- server/storage/native-tool-observations.ts及.test.ts。
- server/native-tool-observations.test.ts（生产HTTP）。
- src/api/native-tool-observations.ts。
- src/components/NativeToolObservationsPanel.tsx及.test.tsx。
- src/components/ToolExecutionPanel.tsx及.test.tsx（同ID跨页显式入口）。
- src/styles/components/native-tool-observations.css。
- 集成所需共享文件：server/server.ts、src/components/TraceLinksPanel.tsx及.test.tsx、
  src/components/CompareBoard.tsx及.test.tsx、src/styles/components.css、openspec/contracts/
  data-model.md、api.md、nfr.md、openspec/specs/frontend/spec.md、storage/spec.md。
  只顺序整合已完成独立模块及本功能，确切接线先在本记录追加，不顺带重构。

不在白名单内的新文件必须先追加。真实Agent/特殊传输/hook仍须先明确原生证据和
实际安装环境；缺条件不能凭推测字段或模拟测试冒充真机支持。

## 当前跨页功能验收范围

仅由显式namespace/value/scope选中同一scan会话中的保留tool_call引用，跨事件页查询
其全部成员的有界元数据；保留事件原始ID与来源定位，用户显式分页和读取单事件。
同名、相邻、时间与事件ID形态不参与匹配；重复原生会话owner、冲突turn或绑定、
缺少scope或清单不完整须明确，不能把归组包装成执行/重试/成功证明。
不合并/加总scan与proxy用量、不改采集/原始数据、不做新工具调用。

原总账41/76关闭、30部分/5未实现保持；新功能须有完整证据后才更新对应范围，
不把组件存在、模块测试或新任务启动计为端到端交付。

## 共享接线固定范围

追加白名单 src/App.tsx（仅为现有会话入口传入非离线scan导出资格），
server/functional-integration.test.ts（新模块生产路由/Host-Origin/批量查询验收）。
实验记录注册到现有Router，在config目录独立原子JSON文件；新增引用以单条显式列
SELECT+json_each批量验证，不使用逐key列表查询。CompareBoard显式lazy入口复用原比较
回调；同pair显式重读，改pair仅由现有效果读取一次。Trace导出注册GET和既有本地
保护，独立显式lazy入口仅scan且非离线可见；聚合CSS导入其样式。
跨页引用面板由工具组显式打开，组切换/来源失效/关闭解除所有读请求所有权。

集成回归发现独立模块CSS含硬编码px，违反设计tokens契约。两个独立实现任务已结束；
追加 src/styles/components/experiment-records.css、trace-export.css 及两个feature记录
到共享收尾白名单，按已有spacing/focus tokens修复，不改断言或新增tokens。

## 本批集成结果与证据

- 原生同ID跨页lookup：存储18项，独立UI/client11项，现有工具调查台选中离页成员
  后仅按需读取一个精确正文；冲突/缺失/scope/来源失效/取消明确。生产路由已保护。
- OTLP元数据导出：独立模块45项，接入会话显式入口，非scan/离线不展示资格。
  生成导出ID与原生ID分开，无代理/正文/调用执行/云端collector行为。
- 手工实验记录：独立模块38项，原子CAS JSON与确认CRUD，既有CompareBoard接线；
  条件和结果均为用户声明，缺失引用保留，新增引用单查询，未执行实验。
- 共享生产HTTP15项，既有入口/比较/工具组件新增3项；总新增130项。
- 完整回归：290文件，3499通过、1跳过。初次仅新CSS token断言失败；修复实现后
  31项样式检查及完整回归均通过。typecheck、lint、build、package产物与diff检查通过。
  日志 /tmp/awesomeTelemetry-functional-regression-final.log、functional-build.log。
- 原npm工作树25个已有脏文件SHA256再次核对全部未变；未改主checkout，未提交/推送/发布。

合成服务保留127.0.0.1:4188，PID69158；仍为原native-tools-v1数据/3会话111事件，
所有真实scanner禁用。仅新增一条SYNTHETIC手工记录，CAS revision1，源会话未改。
入口 http://127.0.0.1:4188/#/session?key=codex-033c7e8c263ca3&time=all 。
比较页有手工实验入口；标准Trace导出在会话页，工具跨页入口在选中明确ID组后。

真实浏览器通过明确scope/成员/选中输出正文及导出范围展示。原生工具截图：
/tmp/awesomeTelemetry-functional-delivery/01-native-tool-evidence.jpg（未编辑像素）。
导出click+download等待时cua_repl连接中断；点击结果/浏览器下载完成未知。
随后一次只读页面检查立即失败，停止浏览器动作，未重试点击、未走rawCDP或绕过拒绝。
实验页面浏览器创建/编辑/比较仍阻塞。独立生产HTTP已验证OTLP100条及实验创建后重读，
与浏览器验收严格区分。完整回执/SHA256及实际OTLP文件均在该/tmp交付目录。

工具调查台上批两张截图已由主任务正式Library批量创建并核验返回xattrs，原交付记录
已有真实IDs；本批新增截图随后已正式上传Library，见下方交付补记。

## 最新总账（替代实施前状态分布）

保持76个复合大项，41已关闭、35未关闭；现在32部分完成、3尚未实现。
13.1/13.2由尚未实现改为部分完成，未提高关闭数。其余12.2官方hook、13.3真实重放、
13.4真实优化后质量/成本/延迟验证尚未实现。大项剩余子句/真机/全链路/性能长稳范围
不因模块存在或本批合成测试而算完成；费用、真实性依赖和既定暂缓边界保持。

## 仅交付补记（不再扩功能）

01-native-tool-evidence.jpg 已正式创建于本人Library：
library_file_id `libfile_713b1bd5eaf88191802af80cbc66094a`，
file_id `file_0000000026988206b5fdf7abe07ceb4a`，version0。
当前原始helper已执行元数据写回，全部返回xattrs及Library identity核验成功。
回执 /tmp/awesomeTelemetry-functional-delivery/library-upload-receipt.json。

仅通过cua_repl重新绑定已有iab标签页3进行只读核验（未打开新页、未重载、未点击）。
原导出面板仍为offset0/limit100下载表单，没有成功/失败/覆盖回执。未取得原download
事件或对应浏览器下载文件，因此结果仍未知；独立HTTP保存文件不能代替浏览器回执。
浏览器只读连接现已恢复，但按本次“仅补交付”指令不新做实验面板验收。
原工具调查台A/B、错误Raw、missing/noID、过滤/分页/不同scope/空态与焦点验收已补齐；
本轮跨页lookup及精确正文和导出范围展示通过，实验面板点击未执行。

本轮无待批准操作。获准的本地HTTP测试、全量回归、构建、旧合成demo停止/重启及
一条SYNTHETIC实验记录创建均已实际结束；PID69158服务继续运行。浏览器下载是
未确认结果，不是待审批。此前备用rawCDP动作被拒绝且未执行，未重试/绕过。
本补记只上传既有截图、保存交付回执/本记录；未再下载/写实验/改源码/启服务/提交/发布。

## 后续只读浏览器收尾

正常cua_repl/iab连接可用。原标签页3已不在清单，只新开既有服务的只读比较页，
未重启服务、修改配置、再下载或新增/修改/删除任何实验。已保存记录显示完整的
SYNTHETIC名称、受控条件声明、输入版本/模型参数/工具集、两个原始会话引用及
mixed/unrated手工标签。加载索引筛选“同 ID”保留1个候选、无匹配清空候选，
已关联运行仍保留；清除筛选恢复3个候选。

选择已有两次运行后比较按钮启用，实际点击进入准确L/R比较；实验面板关闭，
返回现有比较结果，L107/107、R2/2，任务/工具/质量等价未验证说明仍在。
后置只读读取应用自身合成registry确认revision1、1记录及原ID/标签未变。
创建/保存/编辑/删除、写失败/超时/冲突等本轮仍未通过浏览器执行（已有测试覆盖）。

最终已保留验收页：
http://127.0.0.1:4188/#/compare?left=codex-033c7e8c263ca3&right=codex-524de9e3f5d8d7
服务仍为PID69158。回执 /tmp/awesomeTelemetry-functional-delivery/readonly-ui-acceptance.json，
内部AX/比较截图同目录；没有新增Library上传或把本地文件当成已送达附件。

原导出download事件句柄已不可取得；正常浏览器可用能力只有visibility/viewport，
无既有下载历史检索。只读核对预期本机Downloads精确文件名未找到；这不是失败证明。
原浏览器下载仍未知，不再次触发；独立HTTP导出文件不替代原浏览器下载回执。
原工具调查台与新增同ID查询的已有验收保持，未新增任何功能或改源码。
