# telemetryRef 融合：npm 基线续作盘点

2026-10-19。当前 milestone 为 M11 融合续作；M12 npm 打包是独立成果。

## 基线与保护范围

- `git ls-remote origin refs/heads/codex/npm-web-cli` 实测最新提交：
  `29e9e20f8a9dc9b18c8a6e17128440451309f912`。
- 隔离分支 `codex/telemetryref-npm-continuation`，工作树
  `/tmp/awesomeTelemetry-telemetryref-npm`，从该提交创建。
- 原 npm 工作树 25 项未提交配置/历史文档完整保留；修改前记录逐文件 SHA256。
  主目录与其余 worktree 均未 reset、clean、stash 或复制覆盖。
- 参考仓库 `/Users/howell/Documents/Coding/telemetryRef/trace-analysis`，
  HEAD `2d3567b`；只读文档与文件，不运行其中脚本或读取真实 trace/密钥。
- 不提交、推送、创建 PR、合并、发布 npm 或部署。不执行付费模型调用。

开始时 `git worktree list --porcelain` 的全部7个既有工作树及
`git status --porcelain --untracked-files=normal` 条目数如下（目录条目并非文件总数）：

| 工作树 | HEAD | 状态条目 |
| --- | --- | ---: |
| 主目录 awesomeTelemetry/awesomeTelemetry | d5da6af | 320 |
| ~/.codex/worktrees/6123/awesomeTelemetry | 3f6f56b | 242 |
| ~/.codex/worktrees/8c01/awesomeTelemetry | 472c3a6 | 0 |
| ~/.codex/worktrees/d867/awesomeTelemetry | 3f6f56b | 242 |
| ~/.codex/worktrees/observability-ui/awesomeTelemetry | 29e9e20 | 25 |
| ~/.codex/worktrees/sticky-turn-navigation/awesomeTelemetry | d5da6af | 0 |
| ~/.codex/worktrees/telemetryref-fusion/awesomeTelemetry | f424c2d | 190 |

## 本批精确文件白名单

1. 本文件：原定任务盘点、来源、证据、剩余优先级与最终验证。
2. `server/storage/trace-links.ts`：相同来源内重复身份的关联判定。
3. `server/storage/trace-links.test.ts`：真实 SQLite 的重复证据、并发和重启回归。
4. `PERF-BASELINE.md`：仅追加本次实际门禁结果，不修改旧失败记录或预算。

构建产物、隔离测试临时数据及本地依赖引用不加入交付；不修改 UI、provider、
计费算法、契约、schema、依赖或 npm 文件清单。读取 storage 全规格、相关 delta、
权威身份类型/DDL/API/NFR 与 G4.8/G5.1–2/G11.2–4 后实施。

## 盘点结论（实施前）

原定清单是 `openspec/changes/fuse-agent-monitoring/tasks.md`，共 71 项。
npm 提交中的旧版仍勾选 30 项；原 npm 工作树保留的后续记录勾选 41/76，
其中新增 14.1–14.5 五项。原始范围实际关闭 36 项，仍有 35 个复合项未关闭。
这些是任务状态计数，不是完成工作量、产品成熟度或 telemetryRef 对等百分比。
源码已在 npm 提交中，不能把未同步文档当成没有实现，也不能把打包成功当成对等验收。

按“存在与本任务直接对应的实现/受控测试，但完整子句或真机门禁未通过”定义部分完成，
原始 71 项分为 **36 已关闭、30 部分完成、5 尚未实现**；新增五项均有源码/相邻测试。
尚未实现：12.2 官方 hook 接入、13.1 标准 OTel、13.2 受控实验、13.3 安全真实重放、
13.4 优化后质量/成本/延迟验证。部分完成不等于本轮已重跑真机或完整验收。

后续记录关闭而 npm 旧清单未同步的六项：7.5、9.1、9.4、9.5、10.2、10.4。
历史证据与本次实测结果须分别记录，所有原始大项保留完整范围。

## 本批实现目标

检查发现 `reconcile` 以 session 身份行数和候选行数判断唯一性；存储契约允许
同一 namespace/value 在不同 sourcePath/eventId 保留独立证据。计划补回归验证：
同一来源内多个出处不能被误算成多个会话；不同 scan owner、不同 namespace/value
和不完整来源仍须降级，不改变用户决定或把重复网络请求合并成一个收费调用。
普通 adapter collector 本身会去重，此修复针对存储入口允许的多出处 manifest，
不能宣称所有当前 Agent 已实际遇到或通过真机验证。

## 验证

- 新增9项回归，修改实现前5项失败，均为重复出处误降级；其余保护断言通过。
- 修复后 `trace-links`/`linked-execution`/`identity-extractor` 三文件60项通过；
  本批 `trace-links.test.ts` 共25项（新增9项）。普通 collector 已去重，
  修复覆盖存储入口允许保留的多出处身份，不声称真实 Agent 全量认证。
- `npm run typecheck && npm run lint && npm run build` 实际全部退出0；
  前端及 CLI/三 workers 构建成功；未修改 UI/provider/包清单/依赖。
- 全量 `npm run test -- --maxWorkers=2` 重跑完成：276文件，3315通过/1既有跳过，
  退出0，93.51s；日志 `/tmp/awesomeTelemetry-fusion-tests-final.log`。
- 初次全量因 `exec-server transport disconnected` 中断，无完成结果；
  原日志 `/tmp/awesomeTelemetry-fusion-tests.log` 保留，不计通过。恢复后先用进程表
  确认无残留，再运行上述完整套件。不是自动审批拒绝。
- 受限环境的单独 HTTP API 回归等待未结束；完整套件已在允许合成 loopback/
  子进程的环境通过同一批文件，随后仅对核实的本任务独立 runner PID24835 发TERM。
  没有向其他工作树服务或未知进程发送信号。
- `openspec validate fuse-agent-monitoring --strict`、`git diff --check`、
  `node scripts/verify-package.mjs` 均通过。原 npm25文件SHA256核对全部一致。
- `npm run perf:check` 退出0；三类真实本地转发A/B各100暖态配对，硬预算通过。
  但相对上一份已记录npm样本，HTTP首字节+37.5%、E2E+44.5%触发20%相对告警；
  原因未证实，没有重复挑有利样本或放宽预算。完整数据追加至 PERF-BASELINE.md。
- 历史 Mac3306通过/1跳过与 npm消费者安装测试属于上批记录，不能冒充本次重跑；
  Windows 尚无实测。本批没有关闭原8.4复合任务或增加41/76的完成数。

本批实现 storage REQ-018 的唯一身份/差分来源证据语义及 MON-003 的关联边界，
推进8.4的重复摄取/晚到冲突/重启回归子项。9.3跨来源计费去重与完整8.4仍未完成。
既有持久化行不会在启动时批量重算；已存错误candidate在下一次相关manifest发生变化
并触发reconcile时修正。完全相同manifest仍为0写入，不为了修复而偷偷全库回扫。

## 逐项状态和证据索引

状态为本次核对，不改写旧 tasks.md。已关闭指历史交付范围已有实现与回归；
真机/长稳/对等认证仍由对应开放项约束。历史临时验收报告可能未入库，
不能因此声称本轮重复浏览器/真实 Agent 验收。下表同组共享证据入口，详见随后说明。

| 任务 | 状态 | 已有证据与剩余边界 |
| --- | --- | --- |
| 1.1 | 已关闭 | [baseline.md; audit.md; support-matrix.md](../../../openspec/changes/fuse-agent-monitoring/baseline.md) |
| 1.2 | 已关闭 | [baseline.md; audit.md; support-matrix.md](../../../openspec/changes/fuse-agent-monitoring/baseline.md) |
| 1.3 | 已关闭 | [baseline.md; audit.md; support-matrix.md](../../../openspec/changes/fuse-agent-monitoring/baseline.md) |
| 1.4 | 部分完成 | [baseline.md; audit.md; support-matrix.md](../../../openspec/changes/fuse-agent-monitoring/baseline.md) |
| 1.5 | 已关闭 | [baseline.md; audit.md; support-matrix.md](../../../openspec/changes/fuse-agent-monitoring/baseline.md) |
| 1.6 | 已关闭 | [baseline.md; audit.md; support-matrix.md](../../../openspec/changes/fuse-agent-monitoring/baseline.md) |
| 2.1 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 2.2 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 2.3 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 2.4 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 2.5 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 2.6 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 2.7 | 部分完成 | [openspec/contracts/{data-model,database,api,nfr}.md; server/proxy/{protocol-analysis,body-store}.test.ts](../../../openspec/contracts/data-model.md) |
| 3.1 | 已关闭 | [server/proxy/body-store.ts; body-store.test.ts; body-range.test.ts](../../../server/proxy/body-store.test.ts) |
| 3.2 | 已关闭 | [server/proxy/body-store.ts; body-store.test.ts; body-range.test.ts](../../../server/proxy/body-store.test.ts) |
| 3.3 | 已关闭 | [server/proxy/body-store.ts; body-store.test.ts; body-range.test.ts](../../../server/proxy/body-store.test.ts) |
| 3.4 | 已关闭 | [server/proxy/body-store.ts; body-store.test.ts; body-range.test.ts](../../../server/proxy/body-store.test.ts) |
| 3.5 | 已关闭 | [server/proxy/body-store.ts; body-store.test.ts; body-range.test.ts](../../../server/proxy/body-store.test.ts) |
| 4.1 | 已关闭 | [server/proxy/{ca-manager,monitored-launch,connection-diagnostics}.ts 及相邻测试；https-capture.test.ts](../../../server/proxy/https-capture.test.ts) |
| 4.2 | 已关闭 | [server/proxy/{ca-manager,monitored-launch,connection-diagnostics}.ts 及相邻测试；https-capture.test.ts](../../../server/proxy/https-capture.test.ts) |
| 4.3 | 已关闭 | [server/proxy/{ca-manager,monitored-launch,connection-diagnostics}.ts 及相邻测试；https-capture.test.ts](../../../server/proxy/https-capture.test.ts) |
| 4.4 | 已关闭 | [server/proxy/{ca-manager,monitored-launch,connection-diagnostics}.ts 及相邻测试；https-capture.test.ts](../../../server/proxy/https-capture.test.ts) |
| 4.5 | 已关闭 | [server/proxy/{ca-manager,monitored-launch,connection-diagnostics}.ts 及相邻测试；https-capture.test.ts](../../../server/proxy/https-capture.test.ts) |
| 5.1 | 已关闭 | [server/proxy/{capture-processor,body-decoder,sse-accumulator,transport-faults,capture-ab}.test.ts](../../../server/proxy/capture-ab.test.ts) |
| 5.2 | 已关闭 | [server/proxy/{capture-processor,body-decoder,sse-accumulator,transport-faults,capture-ab}.test.ts](../../../server/proxy/capture-ab.test.ts) |
| 5.3 | 已关闭 | [server/proxy/{capture-processor,body-decoder,sse-accumulator,transport-faults,capture-ab}.test.ts](../../../server/proxy/capture-ab.test.ts) |
| 5.4 | 已关闭 | [server/proxy/{capture-processor,body-decoder,sse-accumulator,transport-faults,capture-ab}.test.ts](../../../server/proxy/capture-ab.test.ts) |
| 5.5 | 已关闭 | [server/proxy/{capture-processor,body-decoder,sse-accumulator,transport-faults,capture-ab}.test.ts](../../../server/proxy/capture-ab.test.ts) |
| 6.1 | 已关闭 | [server/proxy/{protocol-analysis,parser-router,context-normalizer,nested-sse}.test.ts; parsers/*.test.ts](../../../server/proxy/protocol-analysis.test.ts) |
| 6.2 | 已关闭 | [server/proxy/{protocol-analysis,parser-router,context-normalizer,nested-sse}.test.ts; parsers/*.test.ts](../../../server/proxy/protocol-analysis.test.ts) |
| 6.3 | 已关闭 | [server/proxy/{protocol-analysis,parser-router,context-normalizer,nested-sse}.test.ts; parsers/*.test.ts](../../../server/proxy/protocol-analysis.test.ts) |
| 6.4 | 已关闭 | [server/proxy/{protocol-analysis,parser-router,context-normalizer,nested-sse}.test.ts; parsers/*.test.ts](../../../server/proxy/protocol-analysis.test.ts) |
| 6.5 | 已关闭 | [server/proxy/{protocol-analysis,parser-router,context-normalizer,nested-sse}.test.ts; parsers/*.test.ts](../../../server/proxy/protocol-analysis.test.ts) |
| 6.6 | 已关闭 | [server/proxy/{protocol-analysis,parser-router,context-normalizer,nested-sse}.test.ts; parsers/*.test.ts](../../../server/proxy/protocol-analysis.test.ts) |
| 7.1 | 部分完成 | [server/proxy/{capture-recovery,capture-capacity,original-deletions,capture-reparse}.test.ts; server/storage/columns.test.ts](../../../server/proxy/capture-reparse.test.ts) |
| 7.2 | 已关闭 | [server/proxy/{capture-recovery,capture-capacity,original-deletions,capture-reparse}.test.ts; server/storage/columns.test.ts](../../../server/proxy/capture-reparse.test.ts) |
| 7.3 | 部分完成 | [server/proxy/{capture-recovery,capture-capacity,original-deletions,capture-reparse}.test.ts; server/storage/columns.test.ts](../../../server/proxy/capture-reparse.test.ts) |
| 7.4 | 部分完成 | [server/proxy/{capture-recovery,capture-capacity,original-deletions,capture-reparse}.test.ts; server/storage/columns.test.ts](../../../server/proxy/capture-reparse.test.ts) |
| 7.5 | 已关闭 | [server/proxy/{capture-recovery,capture-capacity,original-deletions,capture-reparse}.test.ts; server/storage/columns.test.ts](../../../server/proxy/capture-reparse.test.ts) |
| 8.1 | 部分完成 | [server/storage/{trace-links,linked-execution,native-session-parents}.test.ts; src/adapters/native-identities.test.ts](../../../server/storage/trace-links.test.ts) |
| 8.2 | 已关闭 | [server/storage/{trace-links,linked-execution,native-session-parents}.test.ts; src/adapters/native-identities.test.ts](../../../server/storage/trace-links.test.ts) |
| 8.3 | 部分完成 | [server/storage/{trace-links,linked-execution,native-session-parents}.test.ts; src/adapters/native-identities.test.ts](../../../server/storage/trace-links.test.ts) |
| 8.4 | 部分完成 | [server/storage/{trace-links,linked-execution,native-session-parents}.test.ts; src/adapters/native-identities.test.ts](../../../server/storage/trace-links.test.ts) |
| 8.5 | 已关闭 | [server/storage/{trace-links,linked-execution,native-session-parents}.test.ts; src/adapters/native-identities.test.ts](../../../server/storage/trace-links.test.ts) |
| 9.1 | 已关闭 | [server/proxy/network-timing.test.ts; src/core/{scan-timing,capture-diagnostics}.test.ts; src/components/CaptureComparisonPanel.test.tsx](../../../src/core/capture-diagnostics.test.ts) |
| 9.2 | 已关闭 | [server/proxy/network-timing.test.ts; src/core/{scan-timing,capture-diagnostics}.test.ts; src/components/CaptureComparisonPanel.test.tsx](../../../src/core/capture-diagnostics.test.ts) |
| 9.3 | 部分完成 | [server/proxy/network-timing.test.ts; src/core/{scan-timing,capture-diagnostics}.test.ts; src/components/CaptureComparisonPanel.test.tsx](../../../src/core/capture-diagnostics.test.ts) |
| 9.4 | 已关闭 | [server/proxy/network-timing.test.ts; src/core/{scan-timing,capture-diagnostics}.test.ts; src/components/CaptureComparisonPanel.test.tsx](../../../src/core/capture-diagnostics.test.ts) |
| 9.5 | 已关闭 | [server/proxy/network-timing.test.ts; src/core/{scan-timing,capture-diagnostics}.test.ts; src/components/CaptureComparisonPanel.test.tsx](../../../src/core/capture-diagnostics.test.ts) |
| 10.1 | 部分完成 | [server/realtime/replay-log.test.ts; src/components/{ProxyView.workflow,LinkedExecutionPanel,ProxyLivePanel}.test.tsx](../../../src/components/ProxyView.workflow.test.tsx) |
| 10.2 | 已关闭 | [server/realtime/replay-log.test.ts; src/components/{ProxyView.workflow,LinkedExecutionPanel,ProxyLivePanel}.test.tsx](../../../src/components/ProxyView.workflow.test.tsx) |
| 10.3 | 部分完成 | [server/realtime/replay-log.test.ts; src/components/{ProxyView.workflow,LinkedExecutionPanel,ProxyLivePanel}.test.tsx](../../../src/components/ProxyView.workflow.test.tsx) |
| 10.4 | 已关闭 | [server/realtime/replay-log.test.ts; src/components/{ProxyView.workflow,LinkedExecutionPanel,ProxyLivePanel}.test.tsx](../../../src/components/ProxyView.workflow.test.tsx) |
| 10.5 | 部分完成 | [server/realtime/replay-log.test.ts; src/components/{ProxyView.workflow,LinkedExecutionPanel,ProxyLivePanel}.test.tsx](../../../src/components/ProxyView.workflow.test.tsx) |
| 10.6 | 部分完成 | [server/realtime/replay-log.test.ts; src/components/{ProxyView.workflow,LinkedExecutionPanel,ProxyLivePanel}.test.tsx](../../../src/components/ProxyView.workflow.test.tsx) |
| 11.1 | 部分完成 | [handoff-6.1.md; support-matrix.md; PERF-BASELINE.md；完整真机/长稳/发布未过](../../../openspec/changes/fuse-agent-monitoring/handoff-6.1.md) |
| 11.2 | 部分完成 | [handoff-6.1.md; support-matrix.md; PERF-BASELINE.md；完整真机/长稳/发布未过](../../../openspec/changes/fuse-agent-monitoring/handoff-6.1.md) |
| 11.3 | 部分完成 | [handoff-6.1.md; support-matrix.md; PERF-BASELINE.md；完整真机/长稳/发布未过](../../../openspec/changes/fuse-agent-monitoring/handoff-6.1.md) |
| 11.4 | 部分完成 | [handoff-6.1.md; support-matrix.md; PERF-BASELINE.md；完整真机/长稳/发布未过](../../../openspec/changes/fuse-agent-monitoring/handoff-6.1.md) |
| 11.5 | 部分完成 | [handoff-6.1.md; support-matrix.md; PERF-BASELINE.md；完整真机/长稳/发布未过](../../../openspec/changes/fuse-agent-monitoring/handoff-6.1.md) |
| 11.6 | 部分完成 | [handoff-6.1.md; support-matrix.md; PERF-BASELINE.md；完整真机/长稳/发布未过](../../../openspec/changes/fuse-agent-monitoring/handoff-6.1.md) |
| 12.1 | 部分完成 | [server/proxy/{monitor-capabilities,nested-sse,websocket-capture}.test.ts; cdp-capture.ts; frida-capture.ts；平台认证未过](../../../server/proxy/monitor-capabilities.test.ts) |
| 12.2 | 部分完成 | [Claude 官方 HTTP hook 接收、配置片段、持久化、精确范围查询、详情及共享 SSE/UI 已接线并经真实本地 HTTP 测试；实际 Claude 版本调用及其他目标插件仍未验收](official-hooks-feature.md) |
| 12.3 | 部分完成 | [server/proxy/{monitor-capabilities,nested-sse,websocket-capture}.test.ts; cdp-capture.ts; frida-capture.ts；平台认证未过](../../../server/proxy/monitor-capabilities.test.ts) |
| 12.4 | 部分完成 | [CDP协议与管理器、Vite开发入口、目标快照及单条响应查看已接线；真实Electron/平台认证未过](functional-rollout-3.md) |
| 12.5 | 部分完成 | [server/proxy/{monitor-capabilities,nested-sse,websocket-capture}.test.ts; cdp-capture.ts; frida-capture.ts；平台认证未过](../../../server/proxy/monitor-capabilities.test.ts) |
| 12.6 | 部分完成 | [server/proxy/{monitor-capabilities,nested-sse,websocket-capture}.test.ts; cdp-capture.ts; frida-capture.ts；平台认证未过](../../../server/proxy/monitor-capabilities.test.ts) |
| 13.1 | 部分完成 | [原生/关联元数据OTLP](linked-trace-export-feature.md)与[选中采集原文tar证据包](capture-bundle-feature.md)已接线；完整原生来源会话归档/collector互通未完成，浏览器保存回执未知 |
| 13.2 | 部分完成 | [本轮已接入手工条件/结果标签CRUD与既有比较流程，真实生产HTTP和组件通过；浏览器页面实测被连接中断阻塞](experiment-records-feature.md) |
| 13.3 | 尚未实现 | [parity.md P13/P15；源码未发现对应标准导出/受控评测/真实重放闭环](../../../openspec/changes/fuse-agent-monitoring/parity.md) |
| 13.4 | 尚未实现 | [parity.md P13/P15；源码未发现对应标准导出/受控评测/真实重放闭环](../../../openspec/changes/fuse-agent-monitoring/parity.md) |
| 14.5 | 已关闭 | [server/{capture-self-test,codex-calls}.test.ts; server/codex/{archive,projector,native-links}.test.ts; server/trace-import.test.ts](../../../server/codex/projector.test.ts) |
| 14.4 | 已关闭 | [server/{capture-self-test,codex-calls}.test.ts; server/codex/{archive,projector,native-links}.test.ts; server/trace-import.test.ts](../../../server/codex/projector.test.ts) |
| 14.3 | 已关闭 | [server/{capture-self-test,codex-calls}.test.ts; server/codex/{archive,projector,native-links}.test.ts; server/trace-import.test.ts](../../../server/codex/projector.test.ts) |
| 14.1 | 已关闭 | [server/{capture-self-test,codex-calls}.test.ts; server/codex/{archive,projector,native-links}.test.ts; server/trace-import.test.ts](../../../server/codex/projector.test.ts) |
| 14.2 | 已关闭 | [server/{capture-self-test,codex-calls}.test.ts; server/codex/{archive,projector,native-links}.test.ts; server/trace-import.test.ts](../../../server/codex/projector.test.ts) |

### 提交归属与历史证据

- `f424c2d`：M11 初始融合快照（原文/代理/协议/关联与回归基础）。
- `c3cc8b7`：M11 补入后续运行时、契约及相邻测试；提交说明记录组合候选 3290 测试。
- `6248748`：M10 新观测工作台/UI 和 Team 回放；不得全部归为 telemetryRef 成果。
- `29e9e20`：M12 npm/Web CLI 包装；历史 `PERF-BASELINE.md` 记录 3306 通过/1 跳过、
  消费者安装与 workers 验证，不增加融合任务的完成数。
- 7.5 对应 `capture-reparse` 实现/HTTP/组件回归；9.1/9.5 对应网络与 scan 时序口径；
  9.4/10.4 对应诊断、选定请求比较与 Context Diff；10.2 对应能力矩阵/接入工作流。
- 新增14.1 本地自检；14.2 WS/WSS 双向归档；14.3 TraceLog 导入；14.4 Codex 逐调用；
  14.5 长连接分页和实时更新。实现/受控测试存在，不替代远端付费模型/Windows 认证。

### 剩余优先级

1. P0：8.1/8.3/8.4/9.3 调用/重试/工具/子 Agent 明确身份及跨来源计费；
   本批只修多出处 manifest 的错误歧义，不推断收费同一性。
2. P0：1.4/11.2/11.3 首批真实 Agent 多轮/工具/取消/交错并发；
   需要明确模型费用和工具范围，当前只执行本地合成测试。
3. P1：2.1–2.7/7.1/7.4 契约与 golden/查询门禁总审；
   10.1/10.3/10.5/10.6 全层级实时恢复和完整生产浏览器 NFR 验收。
4. P1：11.1/11.5/11.6 完整 A01–A12、文档与最终发布验收；本批不发布。
5. 后续：12.1–12.6 特殊 Agent/传输/平台；13.1–13.4 标准导出和受控评测。
6. 延后边界：7.3 完整长期存储预算/物理磁盘故障；11.4 长稳综合验收。
   本次不扩展分库/新磁盘边界，不把旧定向测试当完整通过。

### 已有文档冲突

- `tasks.md` 提交版30/71与保留记录41/76存在时间漂移；本报告按共同原始71项
  与新增5项分开核对，未复制覆盖原 npm 工作树的脏文档。
- storage spec 标题提 v18、G5.1提 v4，与权威 database.md 和实际 schema19不同；
  依权威契约采用19，本批不改 schema。AGENTS 写 Vitest3，实际锁定4.1.10；
  使用已有锁版本，不升级或改依赖。
- 已有 CSS gzip24380B >16384B（超7996B）及前批 HTTPS A/B 相对告警仍开放；
  本批通过构建或 perf 硬门槛不能消除这些历史风险。

## 有限性能归因收尾：预先固定方案

父任务要求只核查本批HTTP相对告警，不扩展无限性能专项；结束后停止本轮实现。
只追加本文件和 PERF-BASELINE.md；应用源码/测试白名单不扩展。临时诊断脚本、
计划、原始JSON与日志保存在 `/tmp/awesomeTelemetry-causal-check/`，不加入npm包。

在运行前固定：仅执行一次 **A→B→B→A**，A为HEAD中原始trace-links.ts，B为本批
修复版；其余运行时代码、依赖、worker闭包与诊断配置共用同一隔离工作树。
通过临时Vite transform替换内存中的这一个模块，不覆盖磁盘源码、不切换工作树。
两版本注入相同只计数探针，记录reconcile次数、匹配session行数与候选循环访问数。
这属于受控归因实验，不能把带探针结果替换上一份未带探针性能基线。

每轮均运行原有HTTP、HTTPS CONNECT、近2MiB HTTP三配置，每配置100暖态配对、
4并发、1冷态+3预热，8帧/5ms、identity SSE；预算和字节/摘要/资源释放断言不变。
使用原始direct/proxy交替配对及同进程loopback方法。恰好4轮，不因好坏增补轮次；
保留全部1200组暖态配对与12份profile结果、构建/源哈希。若基础设施故障，保留失败
并停止，不选择性补跑。比较每轮和两轮均值/范围，不能用最小值宣布无回归。

先检查旧05-10样本：它记录sourceHead6248748且包含当时工作区，当前为29e9e20加
本批补丁，因此不是同一次连续受控版本对照。Node26.5.1/darwin/arm64/schema19、
样本100/并发4/3种负载、worker依赖摘要一致；运行时负载/温度/调度状态未被旧报告
完整记录。历史相对告警保留，新的有限对照仅帮助判断本批改动是否存在一致惩罚。

静态路径显示：fixture没有x-agent-provider/session或metadata.session_id；
因此预期proxyRows为空，distinct聚合输入为空且新candidateOwners循环不执行。
仍需探针核实；空聚合SQL本身的固定开销不能只凭静态阅读排除。

采样前设置修订（未产生请求/样本）：第一次module transform计数检查因macOS
`/tmp`→`/private/tmp`真实路径不匹配退出，日志1-A.log/execution.json保留。
在任何性能结果产生前记录plan-v2.json，仅修正临时脚本的canonical root路径；
这不是按性能好坏补测。仍只有4个测量轮次、同一ABBA顺序、全部样本保留；
不再修订设置或追加轮次。应用磁盘源码未被覆盖。

### 收尾核查结果

4个测量轮次A/B/B/A均退出0，12个profile共1200暖态配对全部保留，原有硬门槛、
字节/摘要/协议等价与清理断言全部通过。执行连接中断后只查已有execution-v2.json
与进程表，确认4轮已完成且无残留；未重复启动或增补测量。

| profile / 额外耗时p95(ms) | A1旧版 | B1新版 | B2新版 | A2旧版 | 新/旧两轮均值变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| HTTP首字节 | 3.501416 | 4.306583 | 3.570083 | 3.997250 | +5.0% |
| HTTP E2E | 5.674709 | 6.493583 | 6.296666 | 7.523083 | -3.1% |
| HTTPS CONNECT首字节 | 6.733958 | 9.064458 | 9.600083 | 7.678542 | +29.5% |
| HTTPS CONNECT E2E | 12.953542 | 12.285541 | 12.072000 | 10.168167 | +5.3% |
| 近2MiB HTTP首字节 | 1.477291 | 2.557292 | 1.778333 | 1.653541 | +38.5% |
| 近2MiB HTTP E2E | 4.449626 | 5.419958 | 5.002042 | 4.661626 | +14.4% |

此处是每版两轮p95的算术均值比较，不是合并样本p95，也不是统计显著性/等效性证明。
全部实际loop p99在1.926143–2.105343ms；所有首字节/E2E额外p95低于原20ms硬门槛。
每个profile实测countQueries=104、匹配proxy/scan session行、sourceIds、count结果行
和proxy候选循环访问次数全为0；改动中的candidateOwners和唯一性判断不执行。
COUNT(DISTINCT)仍作为空输入SQL执行，不能据此排除其固定开销或其他交互。

结论：原HTTP+37.5%/+44.5%在这次有限同源对照中没有重现为一致的新版惩罚；
但不能证明原告警只是噪声，也不能排除本批任何回归。HTTPS/近2MiB首字节的新相对
差异同样保留。只有每版2轮，不继续追加有利样本、不推断原因、不做猜测性源码优化。
没有定位出可证实由本批引入的缺陷，因此应用源码保持上一批版本，本轮实现到此停止。

旧05-10与新11-26样本的环境/config/请求响应字节数/样本数完全一致，7个worker/共享
依赖JS摘要相同；capture-ab和CLI构建摘要不同。6248748→29e9e20的采集相关差异是
Frida脚本资源路径与诊断复制完整闭包，未运行Frida路径；旧工作区状态/调度负载不完整，
历史单次报告不能提供本批因果结论。

临时可复核证据目录 `/tmp/awesomeTelemetry-causal-check/`：plan.json及采样前修订
plan-v2.json、两版精确TS快照与SHA256、两个设置脚本、v1失败日志、4个v2原始JSON/
日志、execution-v2.json、summary.json。每个报告内plan字段指初始plan.json，设置修订
以plan-v2.json和本节为准。没有删除或上传任何样本。

### 原始5项尚未实现任务（保留原文范围）

- **12.2** 对缺少工具/子 Agent 原生证据的目标评估官方 hook/插件，先确认接入权限
  与边界，再实现，禁止篡改 Agent 内核。
- **13.1** 另提标准 Trace/OTel 导出契约，定义跨来源 ID、时间、原文保留及未知属性
  映射；不自动发送云端。
- **13.2** 建立同任务/模型/参数/工具集/输入版本可比的实验记录与结果标签，
  区分自然流量对比和受控实验。
- **13.3** 需要真实重放时先单独设计权限、工具副作用隔离、费用上限与人工确认，
  默认仍为离线解析 replay。
- **13.4** 用真实优化前后样本验证建议是否降低成本/延迟且质量未退化，再扩展
  自动适配；不凭监控指标自动修改用户 Agent。

以上准确范围来自原tasks.md；本次临时性能A/B只测观测器自身，不是13.2/13.4
所需Agent受控任务实验或优化后质量验收。30项部分完成、真实Agent/Windows/
长稳限制与下一批优先级均保持不变，不提高41/76完成数。

## 最新授权后的功能第二批（2026-10-20）

用户再次明确要求开始全部功能性任务、功能优先、独立项可新起会话。
因此此前“本轮到此停止”仅记录当时性能归因收尾，不限制本轮授权。
本批精确白名单、会话与共享接线记录见 functional-rollout-2.md；实现
Frida保存/详情闭环、标准Electron CDP协议helper和跨来源OTLP元数据导出。
不提交/推送/发布，不重复旧未知浏览器下载或既有实验记录；真实平台、
真实重放/质量优化及性能长稳不因合成测试被宣布完成。

第二批已接线并通过全量299文件/3675测试（1跳过）、类型/lint/build/package
核对。详情与证据见 functional-rollout-2.md；自有合成服务更新到PID85346/4188。
CDP仍无产品dev调用点，真实Windows hook未实现。浏览器切到新Frida页面后
连接中断，因此新详情/导出UI闭环尚未验收；HTTP产物独立保存且未冒充浏览器回执。
76项总账仍41关闭/35未关闭，按功能子项增加证据，不宣称全部功能已完成。

第三批（2026-10-20）已补CDP开发产品入口与响应查看，生产仍404。新增长驻
开发预览 http://127.0.0.1:5188/#/proxy，仅代理既有4188合成后端，不启动真实
CDP/Agent。全量301文件3689通过/1跳过，构建/类型/lint/OpenSpec/包检查通过。
浏览器已核对CDP展开与显式空闲快照，也实际打开既有SYNTHETIC Frida#1详情；
这两处不再受旧浏览器断连阻塞。修正Frida中英文旧文案后，24项定向复验通过。
证据、白名单、截图与剩余功能边界见 functional-rollout-3.md。41关闭/32部分/
3未实现总账保持；功能目标继续，可靠性/长稳/数据库拆分等按用户指令留待功能验收。

第四批补齐选中请求的原始证据包：先取无正文清单，再原生流式tar下载元数据和
可用原文，SHA/长度校验后才输出receipt；缺失、前缀、删除和来源变化明确处理。
新增7个真实HTTP/文件/tar解包测试（含100MiB原文）、5个UI测试；全量303文件/
3701通过、1跳过，类型/构建/lint/OpenSpec/打包检查通过。未更改旧测试断言。
同一4188合成后端已换新编译CLI（PID82679），5188开发预览保留；真实scanner全禁用，
未再运行seed脚本，实验记录SHA保持。浏览器清单和一次新tar请求已点通，保存回执仍
未知且未重试；新的功能证据见capture-bundle-feature.md。13.1整体及功能目标仍开放。

第五批补齐 Claude 官方 HTTP hooks 产品入口：默认关闭；显式确认原文保留后，
启用/轮换并生成手工合并配置；只保存令牌哈希，不修改 Agent 设置。真实本地 HTTP
验证空204仅在原文与元数据提交后返回，重复投递保留，原生工具按会话+Agent 精确
隔离，列表不含正文，选中原文做 SHA/字节校验，保存提示走共享 SSE 200ms 合并。
控制、存储、9项真实HTTP、6项UI及新增schema/SSE测试已通过；全量307文件3724通过/
1既有跳过，构建/类型/lint/打包/OpenSpec通过。浏览器实际展开并刷新新版面板，
保持停用、0投递；没有生成真实令牌、安装hook配置或运行真实Claude。
详细证据与限制见 official-hooks-feature.md。12.2变为部分完成，总账仍41关闭，
现为33部分/2未实现；真实版本、Windows hook、完整归档/collector互通、真实重放
与优化质量实验等仍未关闭。此处不是全部功能完成或可靠性验收；功能目标继续。
