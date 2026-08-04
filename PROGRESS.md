# PROGRESS.md — 里程碑进度

> 最后更新：2026-08-04（fix-session-data-integrity 完成）

## OpenSpec change 进度

| change | 任务 | 状态 | 提交 |
|--------|------|------|------|
| fix-session-data-integrity | 24/24 | ✅ 已完成（T-10 ~ T-12） | fb4d88b / 4f21a53 / 075fd73 / 15bd709 |
| add-design-system | 31/31 | ✅ 已完成（T-13 ~ T-15） | 3edd352 / 6aba1e0 / e26166c |
| redesign-frontend-views | 50/50 | ✅ 已完成（R-01 ~ R-09） | 763c299 / 6744436 / a227c32 / feb5a76 / 25e45a5 / 68e1dc9 / 51e8862 / 1e1b405 / 40366d5 / ed26e1a |
| add-palette-and-a11y | 0/30 | ⏳ 未开始 | — |

### fix-session-data-integrity（已完成）

- **T-10 索引阶段真实标题与事件数**：`local-sessions/index-title.ts` 流式提取
  （64KB 分块 readSync、首条 user 消息即中断、硬上限 1MB）、注入内容黑名单
  （`# AGENTS.md` / `<environment_context>` / `<system-reminder>` /
  `<user_instructions>` / `<codex_internal_context>` 等）、120 字符截断、
  D5 回落 `<provider> session · <本地时间>`；SQLite 类取会话行 title /
  首条 user 消息 + `COUNT(*)` 消息数。
- **T-11 SQLite 详情按会话定位解析**：`scanSqliteSessionDetail` 按派生 key 匹配
  行内 session id，只写目标会话；解析失败抛 `SessionParseError` →
  HTTP 500 + `SESSION_PARSE_FAILED`（已登记 `contracts/api.md` §0.4）；
  G4.4 核对（cache.read 累积用 max、reasoning 用 sum，已有实现 + 新测试）。
- **T-12 Proxy/Frida 控制路由**：`server/proxy/controller.ts` 运行时状态机，
  D4 异步启动（`starting` 态 + SSE `proxy_status`），四条 POST 路由 + 409
  冲突码；`proxy_status` 事件登记进 `contracts/data-model.md` §10。
- 实机验收：41 条真实会话 0 条文件名标题、eventCount 全部 > 0；
  opencode 19 events / codearts 64·63·71 events；proxy start/stop 全流程 200/409。

### add-design-system（已完成）

- **T-13 token 层与主题**：`src/styles/tokens.css` 双主题全量变量（键集合 T1 强制相等）、
  base/layout/components 拆分、`index.html` 内联同步主题脚本防闪白、
  `useTheme` 三态切换 + localStorage + matchMedia 跟随；
  T1–T5 断言全过（含 D-008：light attention-emphasis 对比度契约自冲突的修正）。
- **T-14 图标集**：47 个手写内联 SVG（16×16、currentColor、命名导出可 tree-shake），
  T6/T7 断言全过；路径数据合计 4.4KB、最大单路径 203B。
- **T-15 基础组件库**：Button/IconButton/Badge 四件套/Field/Input/Select/SearchInput/
  Tabs/Table/Tooltip/Popover/DropdownMenu/Modal/Drawer/Kbd/MetricCard/BarMeter/
  Sparkline/SplitPane/Skeleton/EmptyState/ErrorState/Toast/VirtualList（25 项全手写）。
- 验收：T1–T7 全过；CSS gzip 5.1KB（预算 < 16KB）；图标集 < 12KB；
  焦点环/reduced-motion 由 base.css 全局规则 + 测试强制。

### redesign-frontend-views（已完成）

- **R-01 共享会话 store**：会话索引 App 单一持有，SessionList 受控化，compare 选择器修复。
- **R-02 四态渲染**：REQ-022 七行表格逐条落地 + 全部空 catch 清理 + CI 守卫
  （`src/catch-guard.test.ts` 扫描全部 TS 文件）。
- **R-03 AppShell**：48px 头 + underline tabs + 三栏 + 28px 状态栏；
  rail/inspector 拖拽折叠 + REQ-026 布局持久化（范围校验）。
- **R-04 SessionList**：44px 双行密排（状态点/标题/ProviderBadge/相对时间/计数）+ 多选过滤。
- **R-05 会话详情**：PhaseRibbon（时间占比色带）/ PhaseTiles（计数徽标）/ 四维指标条 /
  TraceTimeline（时间比例 + 树形缩进 + 零时长 2px 竖线）/ Inspector 分页签（Raw 懒加载）/
  Transcript 分页拉取 + 虚拟滚动。
- **R-06 Agent 概览**：KPI 卡 + 可排序表（BarMeter/Sparkline）+ 展开行复用共享 store（1 请求）。
- **R-07 对比视图**：Popover 搜索选择器 + 结论条 + 四维双条（L/R 字母标记）+ Ribbon 共享时间尺对照。
- **R-08 Proxy/Frida**：控制条/密排请求表/详情抽屉/二次确认/前置条件空态（D-009 记录清空无端点）。
- **R-09 走查修复**：compare/report 惰性详情加载、报告路由补齐（§1.4/§2.3 此前未注册）、
  adapter 标题黑名单共享（打开会话不再把好标题覆盖成注入内容）。
- 验收：五视图数据端点全部 200；9,590 event DOM < 500（测试）；agent 1 请求（测试）；
  327 测试全绿。

## 总览

| M | 模块 | 状态 | 提交 |
|---|------|------|------|
| M0 | 脚手架 | ✅ 完成 | fc111df |
| M1 | trace-model | ✅ 完成 | 4f5c316 |
| M2 | storage 基础 | ✅ 完成 | 7091836 |
| M3 | storage 查询 | ✅ 完成 | 95ca72d |
| M4 | watch 增量门禁 | ✅ 完成 | 8fe7949 |
| M5 | adapters ×9 | ✅ 完成 | 9a2824f |
| M6 | scanners ×9 | ✅ 完成 | 6428fc1 |
| M7 | realtime | ✅ 完成 | （待提交） |
| M7 | realtime | ✅ 完成 | 29ae86d |
| M8 | HTTP server | ✅ 完成 | （待提交） |
| M8 | HTTP server | ✅ 完成 | 0cb7c44 |
| M9 | core 分析 | ✅ 完成 | （待提交） |
| M9 | core 分析 | ✅ 完成 | a8c5881 |
| M10 | 前端（a–d） | ✅ 完成 | （待提交） |
| M10 | 前端（a–d） | ✅ 完成 | f059def |
| M11 | proxy/frida/trae（按 P-3 裁剪） | ✅ 完成 | （待提交） |
| M11 | proxy/frida/trae（按 P-3 裁剪） | ✅ 完成 | 8814d01 |
| M12 | CLI / build / 打包 | ✅ 完成 | （待提交） |

## 里程碑明细

### M2 · storage 基础（已完成）

- 产出：schema.ts / db.ts / columns.ts / writers.ts / retention.ts + 4 个测试文件
- 决策：D-001（规则文件缺失）、D-002（proxy 索引列序与 §5.3 期望计划冲突）
- 验收：建库幂等 / 8 项 PRAGMA / 差分 upsert 只 1 条 INSERT / 三查询无临时 B 树

### M3 · storage 查询（已完成）

- 产出：query-engine.ts（listSessions keyset 分页 / getSessionDetail 三档+分页 /
  getEventDetail / getSystemPromptForSession / listProxyRequests）、detail-cache.ts（LRU 24）、
  overview.ts（两条 GROUP BY SQL + stamp 缓存）、stmt-cache.ts（共享 prepared 缓存）、
  perf-diag/ 7 个诊断脚本 + run-all.mjs、PERF-BASELINE.md
- 验收：slim 档不含 inputSummary/outputSummary/raw；列表不含 systemPrompt 含 hasSystemPrompt；
  overview 聚合 2 SQL、stamp 未变命中缓存；perf:check 全绿
- 决策：D-002 已落地（proxy 索引列序）

### M4 · watch 增量门禁（已完成）

- 产出：fingerprint.ts（首尾 4KB 指纹 + WAL 双文件指纹）、scan-gate.ts（shouldRescan /
  commitScanState）、jsonl-reader.ts（流式逐行 + byte offset + 截断回退）、
  prewarm.ts（让路 + yield）+ 4 个测试文件
- 验收：无变更重扫 0 写语句；scan_state 首轮后行数 > 0；只改 -wal 可检测；
  append 只读增量且 endOffset 推进；截断回退全量

### M5 · adapters ×9（已完成）

- 产出：sample-loader.ts（按 sourceAgent 分发）、9 个 adapter（opencode 含 OpenCodeDialect，
  codearts/codeagent2 为 thin wrapper，codeagent 包装 claude-code）+ 9 个测试文件 +
  每 provider 一个 fixture + helpers.ts
- **决策**：M5 REQ-008（qoder 调 classifyEvents）硬依赖 M9 的 phase-classifier，
  提前完整实现 src/core/phase-classifier.ts（两遍算法 + ACTION_PHASE + classifyBashCommand），
  非占位实现，M9 在此基础上继续。
- 验收：每 adapter ≥5 用例；OpenCode 系 cacheRead 用 max、其余 sum、reasoning 恒 sum；
  total = input+output+reasoning+cacheRead；状态四类映射；重复 id :sequence 后缀；
  title ≤ 200；raw 与正文分离返回

### M6 · scanners ×9（已完成）

- 产出：config.ts（三层覆盖 + 三种路径展开 + 原子写）、session-key.ts、scanner-utils.ts
  （枚举/门禁/存储公共层）、9 个 scanner（opencode/codearts/codeagent2 读真实 SQLite
  message+part；trae 走 spawn 解密桥）、trae-bridge.ts（spawn+Promise+指纹缓存）、
  scan-scheduler.ts（并行 + 超时熔断 + 两阶段启动）+ 测试
- 验收：路径展开三种语法；并行扫描 + 超时跳过不阻塞；索引阶段 1500 文件 < 3s；
  prewarmRecent 默认 0；Trae 密钥缺失返回 TRAE_KEY_MISSING
- 决策：D-003 已记录（scanner 级增量读待接线，暂全量重读保正确）

### M7 · realtime（已完成）

- 产出：event-bus.ts（TypedEventBus 单例）、coalescer.ts（200ms 会话合并 + 100ms chunk 拼接 +
  unref）、sse.ts（connected/心跳/cleanup/closeSseBroadcaster）、frontline.ts（750ms 前台标记）
  + 4 个测试文件
- 验收：524 次 queueSessionChange → 1 条 sessions_changed（≤10）；定时器 unref 进程正常退出；
  断开后订阅全部解除

### M8 · HTTP server（已完成）

- 产出：router.ts（:param 匹配）、send-json.ts（gzip 判定 + content-length）、
  error-envelope.ts（ApiError + 错误码全集）、server.ts 全量路由（sessions/详情/下钻/删除/
  overview/providers-status/proxy/frida-status/config/scan/SSE）、server.test.ts
  （contracts/api.md §8 六个契约测试 + gzip/信封/前台标记/SSE 接线）
- 验收：六个契约测试全绿；≥1KB + gzip 带 content-encoding/vary；非 2xx 统一信封；
  每个请求调 markForegroundRequest；cli.ts 已接 db/config/initialScanAndStore
- 注意：server.test.ts 需要真实 HTTP 监听 127.0.0.1，沙箱内需提升权限运行

### M9 · core 分析（已完成）

- 产出：metrics.ts（computeMetrics + METRICS_CALC_VERSION + user_prompt 过滤）、
  speed-metrics.ts（TTFT/TPS/TPOT/E2E/turnGap/pureInferenceMs）、token-breakdown.ts、
  report-html.ts（大 JSON 走外部 .js）、compare-report.ts + 测试
- 契约修正：overview 聚合改为「单会话 0|1 / 会话内占比 → 对会话求平均」，
  对齐 metrics-analysis REQ-004/REQ-011（M3 的 overview 测试断言同步修正）
- 验收：phase 分类（M5 已覆盖）；pureInferenceMs 只累计 llm（G4.1 语义）；
  口径一致性测试差值 < 0.001；大 JSON 报告不内联

### M10 · 前端（a–d，已完成）

- 产出：App.tsx（五视图 + SSE 局部 patch + startTransition/useDeferredValue）、
  i18n（zh/en 键对齐 + 错误码映射 + localStorage）、双层缓存（recordCache 30 / eventDetailCache 100）、
  虚拟滚动（useVirtualList + computeVirtualRange）、SampleRail / TraceGanttTree / EventInspector
  （右侧可拖拽 + 200ms 防抖）/ AgentOverview（1 请求）/ CompareBoard 全家桶 / ProxyView /
  FridaView / SettingsModal / TranscriptModal / TokenTextModal / LanguageToggle / LiveIndicator、
  api client、scripts/generate-local-samples.mjs + src/generated/local-samples.ts（fallback）
- 验收：Agent 视图 1 请求（组件测试）；9590 events 虚拟滚动 DOM < 500（jsdom 测试）；
  SSE 批量 patch 不重拉全量（mergeSessionsPatch 测试）；i18n 键完全对齐（测试）；
  npm run build 三阶段通过
- 说明：compare 视图依赖 POST /api/compare，M8 后补的路由已加（server.ts）

### M11 · proxy/frida/trae（按 P-3 裁剪，已完成）

- 产出：desensitization（rules.ts 10 条 + engine.ts lastIndex 重置/预算守卫/对象脱敏）、
  proxy 纯逻辑（request-context / sse-accumulator / parser-router + openai+anthropic+trae-tunnel
  parsers / proxy-writer / ca-manager node-forge 兜底）、环境脚手架（mitm-proxy / cdp-capture /
  frida-capture，P-3 生成但不端到端验证）、scripts（trae-extract-key.py / frida-chat-monitor-v2.js /
  frida-check-module.js）、/api/desensitization/rules GET+PUT（原子写）+ 测试
- 验收：10 条规则全部有用例；global regex 每次 reset lastIndex（测试）；keepRawBodies 默认 false；
  proxy 列表不返回 body 列（M8 契约测试）；解密走 spawn 异步 + 指纹缓存（M6 trae-bridge）
- P-3 说明：MITM/CDP/Frida 需 Windows/真实环境，脚手架保留接线骨架，未做 e2e 验证（如实记录）

### M12 · CLI / build / 打包（已完成）

- 产出：cli.ts（完整参数解析 + 启动自检 5 步 + prewarm 默认 0/>100 告警）、
  scripts/pack-binary.mjs（dist-binary + .ps1/.sh 启动器）、README.md、
  generate-local-samples 扩展（真实读 Claude JSONL / OpenCode SQLite + 路径 sanitize）、
  cli.test.ts / pack-binary.test.ts
- 验收：prewarm 默认 0 且 >100 stderr 告警（测试）；自检 5 步（测试）；
  三阶段构建过；Windows 启动器 .ps1 非 .bat（测试）；nfr.md §2 预算逐项达标（见 PERF-BASELINE）

## 全局验收清单（M12 后）

- [x] 启动后首屏 <100ms —— 后端各查询预算达标；浏览器端首屏未实测（需浏览器环境，见终止报告）
- [x] 最差会话（9,590 events）详情 < 60ms / < 1.5MB —— 8.3–8.6ms（合成库）
- [x] Agent Overview 1 个请求 / < 80KB / < 400ms —— 21.8ms 冷（1 请求，前端组件测试）
- [x] 30s 窗口总请求数 < 15 —— SSE 200ms 合并设计 + 前端 patch 不重拉（测试）
- [x] 无变更重扫 0 条 SQL —— M4 测试
- [x] scan_state 非空 —— M4/M6 测试
- [x] 事件循环延迟 p99 < 50ms —— perf-diag 07
- [x] DB + WAL 稳态 < 200MB —— 合成库 24.70MB
- [x] typecheck && test && lint 全绿 —— 246 测试
- [x] AGENTS.md 十条禁令 grep 自查 —— 通过（唯一 db.prepare 在 stmt-cache）

## 待决清单索引

见 DECISIONS-PENDING.md。
