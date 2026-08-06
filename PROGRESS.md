# PROGRESS.md — milestone progress

> Last updated: 2026-08-06 (enhance-interaction-depth-and-ia-v2 done, C1~C9)

## OpenSpec change progress

| change | Tasks | Status | Commits |
|--------|-------|--------|---------|
| fix-session-data-integrity | 24/24 | ✅ done (T-10 ~ T-12) | fb4d88b / 4f21a53 / 075fd73 / 15bd709 |
| add-design-system | 31/31 | ✅ done (T-13 ~ T-15) | 3edd352 / 6aba1e0 / e26166c |
| redesign-frontend-views | 50/50 | ✅ done (R-01 ~ R-09) | 763c299 / 6744436 / a227c32 / feb5a76 / 25e45a5 / 68e1dc9 / 51e8862 / 1e1b405 / 40366d5 / ed26e1a |
| add-palette-and-a11y | 30/30 | ✅ done (P-01 ~ P-05) | dff2c1b / a0032e5 |
| add-mission-control | 82/82 | ✅ done (MC-B1 ~ MC-B8) | c3e4580 / 33b8083 / 88f88a0 / bcc571e / aa36a4f / 5356de9 / 438e091 / MC-B8 |
| enhance-ui-depth-and-ia | 72/72 | ✅ done (UI-B1 ~ UI-B9) | 6997cd2 / da49771 / a3bd0c6 / 86ce9c6 / edda2a8 / 675c33e / 1f0543b / f8c5a6d / (UI-B9) |
| enhance-interaction-depth-and-ia-v2 | 60/60 | ✅ done (C1 ~ C9) | 15d61a2 / 871d1c5 / 2087b15 / 95042fc / f2c0b8b / c7401d0 / 3590dfb / 186cd5e / (C9) |

### enhance-interaction-depth-and-ia-v2（done，2026-08-06）

- **C1** CommandPalette 高级动作（REQ-111/112/113）：`/compare` 二段式挑选最近
  10 个会话直接发起对比、`/goto` 按事件序号或标题关键词定位（TraceTimeline 新增
  `focusEventId`，虚拟滚动下按行号 scrollTop 定位）、`/filter` 9 个 provider
  开关式过滤；禁用态（无会话 / 非 Session 视图）；数据全部来自共享 store。
- **C2** CompareTimeline 事件选择 + 去硬上限（REQ-114/115）：事件块可点选，
  右侧 `--inspector-width` 面板复用 EventInspector（新增 `initialTab` /
  `visibleTabs` / `fillParent`，只留 Summary + Raw）；Esc / 点空白取消；
  L/R 同 id 同步高亮；移除 `slice(0,200)` 改由既有 useVirtualList 承载，
  底部 "Showing X of Y events"；rAF 帧率哨兵 < 50 FPS 回退每页 200 分页。
- **C3** TokenTextModal 搜索（REQ-116）：inspector-text 提取共享
  `countMatches` / `highlightMatches`（EventInspector 同步改为复用），
  正文 > 500 字符出搜索图标，Ctrl/⌘+F 打开、实时高亮、"X / Y 匹配"、
  Enter / Shift+Enter 循环导航、无匹配红框 + aria-invalid。
- **C4** Mission 导航去冗余（REQ-117）：删除 A/B/C 标签页与
  `MissionSection`/`sectionIds`/`.mission-chips`，25 个 widget 一次性按角色
  分组全量呈现，默认定位「管理者」；新增 `redirectLegacyMissionHash`
  （`#mission-a|b|c` → `#mission-role-manager|engineer|ops`）。
- **C5** Agent 卡片 compare 复选框（REQ-118）：卡片与表格共享同一
  `compareSelection`，切换视图选中态保持，选满 2 个出「对比这两个 →」。
- **C6** 图表组件重构（REQ-119/120）：新增 `charts/RadarChart.tsx`（N 系列
  props 标准化）与 `DonutRing` 弧段原语（total / circumference / onSliceClick），
  CompareCharts 的 RadarChart / TokenDonutChart 退化为薄封装，逐像素一致断言。
- **C7** 会话详情可视化（REQ-121）：`core/session-visuals.ts`（桶算法
  <10min→1min 否则 ceil(分钟/30)、事件密度、8 轴雷达含固定参考量纲与 null 处理）
  + `charts/HeatmapChart.tsx` + `SessionVisuals.tsx`，接在 PhaseRibbon 下方。
- **C8** Compare KPI Sparkline（REQ-122）：`charts/Sparkline.tsx`（多系列共享
  纵轴 + 每点 title + hover tooltip），events/tokens/cost/userRounds 四卡带
  L/R 双线趋势，历史 < 3 个会话显示 "Need 3+ sessions for trend"。
- **C9** 收口：typecheck/test/lint 全绿（663 tests / 113 files）；
  `npm run build` 通过；perf:check 追加 PERF-BASELINE.md；hex 审计零命中；
  真机 build+start（:4188）CDP DOM 断言 + 截图覆盖 REQ-111~118 与 121/122，
  控制台零报错、零失败请求。

### enhance-ui-depth-and-ia（done，2026-08-06）

- **B1** KPI drill-down：CompareKPI 四卡（事件/Token/失败/LLM 调用）手风琴展开，
  DrillDownEvents 双 HBarChart / Tokens Top-10 / Errors L/R 列表 / Duration 双
  TraceTimeline；chevron 180° 旋转 + `--duration-base` 动效。
- **B2** Token 文本 drill-down：Donut 段与 Speed Token 堆叠条点击 →
  TokenTextModal（recordCache 懒加载 mode=full、10000 字符截断、复制反馈、
  缺失警告 banner）。
- **B3** Speed Metrics 10 卡：6 核心 + 4 辅助（avgLlmDuration/cacheHitRate
  直取 SpeedMetrics 不重算）+ TTFT>5s 启动开销警告条；null 显示 —。
- **B4** SessionToolbar 系统 Prompt 展开区：字符/token 估算、5000 截断、
  localStorage `awesome-telemetry.sysPromptExpanded` 持久化、键盘可访问。
- **B5** Compare Hero Header 渐变（`--provider-{key}-subtle`，G-UI-3 回退）+ 
  section 重排（Charts 提前，ContextBar 锚点同步；保留三维对比 section）。
- **B6** Inspector JSON 高亮色值对齐规格 + 脱敏正则扩展
  token/secret/api_key/api-key/apikey（`$1=<REDACTED>`）。
- **B7** Agent Overview 卡片网格视图 + `awesome-telemetry.agentViewMode`
  持久化（Timeline 独立 mode 切换已有）。
- **B8** Mission 角色分组侧边栏（`[` 折叠 + scroll-spy 高亮，不隐藏 widget）
  + CommandPalette 三类动作（`/s` `/nav` `/act` 前缀过滤 + 动作 chevron）。
- **B9** 收口：typecheck/test/lint 全绿（609 tests）；perf:check 追加
  PERF-BASELINE.md；真机 build+start + CDP DOM 断言与截图；hex 审计零命中；
  openspec validate --strict 通过。

### add-mission-control（done，2026-08-05）

- **B1 契约**：schema v1→v2 契约（8 列 + 3 索引）、`GET /api/mission` §2.4、
  NFR 4 行预算、4 模块 spec + delta specs（validate --strict 通过）。
- **B2 端点骨架**：`server/storage/mission.ts`（stamp 缓存 + A/B/C 三区
  `setTimeout(0)` 让出）、路由、schema v2 三索引、perf-diag 08 守门、
  7 个手写 SVG 图表原子（0 新增依赖）。
- **B3 P1**：A1/A3/A4/A7/B4/B14/C1/C3 八个零新数据 widget + Mission 视图
  外壳（tab / 快捷键 6 / `#/mission?range=` / 手动刷新 + SSE stamp 失效）。
- **B4 时长与模型落库**：writers/query-engine 读写 8 个新列 +
  input_len/output_len 冗余列 + 推导/回归测试。
- **B5 定价接线**：`loadModelPricingOverrides` 三层覆盖（G2.3）、workbuddy
  credit 标 reported、D-010。
- **B6 P2**：B1/B3/B5/B6/B11/B12/B13/B15/F1-3+/C2/C4 十一个 widget；
  ttft/e2e 持久化（v3）；repair 检测 rollup 化（design §7.3 R1，D-012）。
- **B7 P3**：B9 错误归类、B10 高风险命令审计（脱敏预览）、B7/B8 场景分类
  （正文不出服务端）、A2/A6、F1-4 自动 subagent 归属。
- **B8 收口**：criteria 口径 i18n（zh/en）、全量验收测试、perf:check +
  PERF-BASELINE 追加、真机 build+start 验证（见终止报告）。

### fix-session-data-integrity (done)

- **T-10 real titles and event counts in the index phase**:
  `local-sessions/index-title.ts` streaming extraction (64KB chunked readSync,
  stop at the first user message, 1MB hard cap), injection blacklist
  (`# AGENTS.md` / `<environment_context>` / `<system-reminder>` /
  `<user_instructions>` / `<codex_internal_context>` etc.), 120-char
  truncation, D5 fallback `<provider> session · <local time>`; SQLite class
  takes the session row's title / first user message + `COUNT(*)` messages.
- **T-11 SQLite detail located per session**: `scanSqliteSessionDetail`
  matches the in-row session id by derived key, writing only the target
  session; parse failure throws `SessionParseError` → HTTP 500 +
  `SESSION_PARSE_FAILED` (registered in `contracts/api.md` §0.4); G4.4 check
  (cache.read cumulative uses max, reasoning uses sum; existing
  implementation + new tests).
- **T-12 Proxy/Frida control routes**: `server/proxy/controller.ts` runtime
  state machine, D4 async startup (`starting` state + SSE `proxy_status`),
  four POST routes + 409 conflict codes; `proxy_status` event registered in
  `contracts/data-model.md` §10.
- Real-machine acceptance: 41 real sessions, 0 file-name titles, all
  `eventCount` > 0; opencode 19 events / codearts 64·63·71 events; proxy
  start/stop full flow 200/409.

### add-design-system (done)

- **T-13 token layer and theme**: `src/styles/tokens.css` dual-theme full
  variable set (key sets forced equal by T1), base/layout/components split,
  inline sync theme script in `index.html` preventing flash, `useTheme`
  three-state toggle + localStorage + matchMedia follow; T1-T5 assertions all
  pass (incl. D-008: corrected the design-tokens light attention-emphasis
  contrast self-conflict).
- **T-14 icon set**: 47 hand-written inline SVGs (16×16, currentColor, named
  exports tree-shakeable), T6/T7 assertions pass; path data totals 4.4KB, max
  single path 203B.
- **T-15 base component library**: Button/IconButton/Badge four-pack/
  Field/Input/Select/SearchInput/Tabs/Table/Tooltip/Popover/DropdownMenu/
  Modal/Drawer/Kbd/MetricCard/BarMeter/Sparkline/SplitPane/Skeleton/
  EmptyState/ErrorState/Toast/VirtualList (25 items, all hand-written).
- Acceptance: T1-T7 all pass; CSS gzip 5.1KB (budget < 16KB); icon set
  < 12KB; focus ring/reduced-motion enforced by base.css global rules +
  tests.

### redesign-frontend-views (done)

- **R-01 shared session store**: session index owned solely by App;
  SessionList controlled; compare pickers fixed.
- **R-02 four-state rendering**: the seven-row REQ-022 table landed one by
  one + all empty catches cleaned + CI guard (`src/catch-guard.test.ts`
  scans all TS files).
- **R-03 AppShell**: 48px header + underline tabs + three columns + 28px
  status bar; rail/inspector drag-collapse + REQ-026 layout persistence
  (range checks).
- **R-04 SessionList**: 44px two-line dense (status dot/title/ProviderBadge/
  relative time/counts) + multi-select filters.
- **R-05 session detail**: PhaseRibbon (time-share color band) / PhaseTiles
  (count badges) / four-dimension metric strip / TraceTimeline (time
  proportional + tree indent + zero-duration 2px lines) / Inspector tabs
  (Raw lazy) / Transcript paginated fetch + virtual scroll.
- **R-06 Agent overview**: KPI cards + sortable table
  (BarMeter/Sparkline) + expanded rows reuse the shared store (1 request).
- **R-07 compare view**: Popover search pickers + verdict strip +
  four-dimension double bars (L/R letter markers) + Ribbon shared-time-scale
  comparison.
- **R-08 Proxy/Frida**: control strips/dense request table/detail
  drawers/confirmation/prerequisite empty states (D-009 records that clear
  has no endpoint).
- **R-09 walkthrough fixes**: compare/report lazy detail loading, report
  routes completed (§1.4/§2.3 previously unregistered), shared adapter title
  blacklist (opening a session no longer overwrites good titles with injected
  content).
- Acceptance: all five views' data endpoints 200; 9,590-event DOM < 500
  (test); agent 1 request (test); 327 tests green.

### add-palette-and-a11y (done)

- **Shortcuts**: single global keydown dispatch (D1) + input/IME safety +
  Esc overlay stack (D2) + j/k/Enter list browsing + help overlay (i18n).
- **Command palette**: ⌘K lazy-loads a separate chunk (2.5KB) + reuses the
  shared store without requests + discovery hint.
- **URL hash**: hand-written parse/serialize (<= 60 lines) + one-way data
  flow (replaceState prevents loops) + dirty-hash fallback.
- **a11y**: listbox/tablist/dialog roles, overlay focus trap and return,
  aria-live, 200% zoom single-column fallback, keyboard full flow
  (session → event → Raw → close).
- **Close-out**: 335 tests green; end-to-end smoke script all pass;
  first-screen data path < 1ms, assets gzip 93.1KB (browser first paint left
  for real measurement, recorded honestly).

## Overview

| M | Module | Status | Commit |
|---|--------|--------|--------|
| M0 | scaffold | ✅ done | fc111df |
| M1 | trace-model | ✅ done | 4f5c316 |
| M2 | storage base | ✅ done | 7091836 |
| M3 | storage queries | ✅ done | 95ca72d |
| M4 | watch incremental gate | ✅ done | 8fe7949 |
| M5 | adapters ×9 | ✅ done | 9a2824f |
| M6 | scanners ×9 | ✅ done | 6428fc1 |
| M7 | realtime | ✅ done | (pending commit) |
| M7 | realtime | ✅ done | 29ae86d |
| M8 | HTTP server | ✅ done | (pending commit) |
| M8 | HTTP server | ✅ done | 0cb7c44 |
| M9 | core analysis | ✅ done | (pending commit) |
| M9 | core analysis | ✅ done | a8c5881 |
| M10 | frontend (a-d) | ✅ done | (pending commit) |
| M10 | frontend (a-d) | ✅ done | f059def |
| M11 | proxy/frida/trae (P-3 trimmed) | ✅ done | (pending commit) |
| M11 | proxy/frida/trae (P-3 trimmed) | ✅ done | 8814d01 |
| M12 | CLI / build / packaging | ✅ done | (pending commit) |

## Milestone details

### M2 · storage base (done)

- Output: schema.ts / db.ts / columns.ts / writers.ts / retention.ts + 4 test
  files
- Decisions: D-001 (missing rule files), D-002 (proxy index column order vs
  the §5.3 expected plan)
- Acceptance: idempotent schema creation / 8 PRAGMAs / differential upsert
  produces exactly 1 INSERT / three queries without temp B-trees

### M3 · storage queries (done)

- Output: query-engine.ts (listSessions keyset pagination /
  getSessionDetail three tiers + pagination / getEventDetail /
  getSystemPromptForSession / listProxyRequests), detail-cache.ts (LRU 24),
  overview.ts (two GROUP BY SQLs + stamp cache), stmt-cache.ts (shared
  prepared cache), perf-diag/ 7 diagnostic scripts + run-all.mjs,
  PERF-BASELINE.md
- Acceptance: slim tier without inputSummary/outputSummary/raw; list without
  systemPrompt but with hasSystemPrompt; overview 2 SQL, cache hit when stamp
  unchanged; perf:check all green
- Decisions: D-002 landed (proxy index column order)

### M4 · watch incremental gate (done)

- Output: fingerprint.ts (first/last 4KB fingerprint + WAL dual-file
  fingerprint), scan-gate.ts (shouldRescan / commitScanState),
  jsonl-reader.ts (streaming line by line + byte offset + truncation
  fallback), prewarm.ts (give way + yield) + 4 test files
- Acceptance: no-change rescan 0 writes; scan_state row count > 0 after the
  first round; changing only -wal is detected; append reads only the tail and
  endOffset advances; truncation falls back to full

### M5 · adapters ×9 (done)

- Output: sample-loader.ts (dispatch by sourceAgent), 9 adapters (opencode
  with OpenCodeDialect, codearts/codeagent2 as thin wrappers, codeagent wraps
  claude-code) + 9 test files + one fixture per provider + helpers.ts
- **Decision**: M5 REQ-008 (qoder calls classifyEvents) hard-depends on M9's
  phase-classifier, so `src/core/phase-classifier.ts` was fully implemented
  early (two-pass algorithm + ACTION_PHASE + classifyBashCommand) — not a
  placeholder; M9 builds on it.
- Acceptance: >= 5 cases per adapter; OpenCode-family cacheRead uses max,
  others sum, reasoning always sum; total = input+output+reasoning+cacheRead;
  four-class status mapping; duplicate ids get :sequence suffix; title <= 200;
  raw returned separately from body

> ⚠️ Translation note: "OpenCode-family cacheRead uses max" above is **stale**
> (see the 2026-08-03 calibration in contracts/data-model.md §2 and
> openspec/gotchas.md G4.4: incremental, use sum). Contract wins.

### M6 · scanners ×9 (done)

- Output: config.ts (three-layer override + three path expansions + atomic
  writes), session-key.ts, scanner-utils.ts (enumeration/gate/storage common
  layer), 9 scanners (opencode/codearts/codeagent2 read real SQLite
  message+part; trae goes through the spawn decrypt bridge), trae-bridge.ts
  (spawn+Promise+fingerprint cache), scan-scheduler.ts (parallel + timeout
  circuit breaker + two-phase startup) + tests
- Acceptance: three path-expansion syntaxes; parallel scan + timeout skip
  without blocking; index phase 1500 files < 3s; prewarmRecent defaults 0;
  Trae missing key returns TRAE_KEY_MISSING
- Decisions: D-003 recorded (scanner-level incremental reads pending; full
  reread for correctness for now)

### M7 · realtime (done)

- Output: event-bus.ts (TypedEventBus singleton), coalescer.ts (200ms session
  merge + 100ms chunk concatenation + unref), sse.ts (connected/heartbeat/
  cleanup/closeSseBroadcaster), frontline.ts (750ms foreground marking) + 4
  test files
- Acceptance: 524 queueSessionChange calls → 1 sessions_changed (<= 10);
  timer unref'd so the process exits; all subscriptions removed after
  disconnect

### M8 · HTTP server (done)

- Output: router.ts (:param matching), send-json.ts (gzip decision +
  content-length), error-envelope.ts (ApiError + full error code set),
  server.ts full routes (sessions/detail/drill-down/delete/overview/
  providers-status/proxy/frida-status/config/scan/SSE), server.test.ts (the
  six contract tests of contracts/api.md §8 + gzip/envelope/foreground
  marking/SSE wiring)
- Acceptance: six contract tests green; >= 1KB + gzip carries
  content-encoding/vary; non-2xx unified envelope; every request calls
  markForegroundRequest; cli.ts wired to db/config/initialScanAndStore
- Note: server.test.ts needs a real HTTP listener on 127.0.0.1; sandboxed
  runs may need elevated permissions

### M9 · core analysis (done)

- Output: metrics.ts (computeMetrics + METRICS_CALC_VERSION + user_prompt
  filtering), speed-metrics.ts (TTFT/TPS/TPOT/E2E/turnGap/pureInferenceMs),
  token-breakdown.ts, report-html.ts (large JSON via external .js),
  compare-report.ts + tests
- Contract fix: overview aggregation changed to "per-session 0|1 / in-session
  ratio → average over sessions", aligning with metrics-analysis REQ-004/
  REQ-011 (M3's overview test assertions fixed in sync)
- Acceptance: phase classification (covered by M5); pureInferenceMs only
  accumulates llm (G4.1 semantics); consistency test difference < 0.001;
  large-JSON reports not inlined

### M10 · frontend (a-d, done)

- Output: App.tsx (five views + SSE local patches +
  startTransition/useDeferredValue), i18n (zh/en key alignment + error-code
  mapping + localStorage), two-layer cache (recordCache 30 / eventDetailCache
  100), virtual scrolling (useVirtualList + computeVirtualRange), SampleRail /
  TraceGanttTree / EventInspector (right, draggable, 200ms debounce) /
  AgentOverview (1 request) / CompareBoard family / ProxyView / FridaView /
  SettingsModal / TranscriptModal / TokenTextModal / LanguageToggle /
  LiveIndicator, api client, scripts/generate-local-samples.mjs +
  src/generated/local-samples.ts (fallback)
- Acceptance: Agent view 1 request (component test); 9,590-event virtual
  scroll DOM < 500 (jsdom test); SSE batched patch without full refetch
  (mergeSessionsPatch test); i18n keys fully aligned (test); npm run build
  passes all three stages
- Note: compare depends on POST /api/compare; the route was added after M8
  (server.ts)

### M11 · proxy/frida/trae (P-3 trimmed, done)

- Output: desensitization (rules.ts 10 rules + engine.ts lastIndex reset/
  budget guard/object desensitization), proxy pure logic (request-context /
  sse-accumulator / parser-router + openai+anthropic+trae-tunnel parsers /
  proxy-writer / ca-manager node-forge fallback), environment scaffolding
  (mitm-proxy / cdp-capture / frida-capture, P-3 generated but not
  end-to-end verified), scripts (trae-extract-key.py /
  frida-chat-monitor-v2.js / frida-check-module.js),
  /api/desensitization/rules GET+PUT (atomic writes) + tests
- Acceptance: all 10 rules have cases; global regexes reset lastIndex every
  time (test); keepRawBodies defaults false; proxy list returns no body
  columns (M8 contract test); decryption via async spawn + fingerprint cache
  (M6 trae-bridge)
- P-3 note: MITM/CDP/Frida need Windows/real environments; the scaffold keeps
  wiring skeletons without e2e verification (recorded honestly)

### M12 · CLI / build / packaging (done)

- Output: cli.ts (full arg parsing + 5-step startup self check + prewarm
  default 0/>100 warning), scripts/pack-binary.mjs (dist-binary +
  .ps1/.sh launchers), README.md, generate-local-samples extended (reads real
  Claude JSONL / OpenCode SQLite + path sanitize), cli.test.ts /
  pack-binary.test.ts
- Acceptance: prewarm default 0 and >100 stderr warning (test); 5-step self
  check (test); three-stage build passes; Windows launcher .ps1 not .bat
  (test); every nfr.md §2 budget met (see PERF-BASELINE)

## Global acceptance checklist (after M12)

- [x] first screen < 100ms after startup — backend query budgets met;
  browser first screen not measured (needs a browser environment; see the
  termination report)
- [x] worst session (9,590 events) detail < 60ms / < 1.5MB — 8.3-8.6ms
  (synthetic DB)
- [x] Agent Overview 1 request / < 80KB / < 400ms — 21.8ms cold (1 request,
  frontend component test)
- [x] total requests in a 30s window < 15 — SSE 200ms coalescing design +
  frontend patch without refetch (test)
- [x] no-change rescan 0 SQL — M4 test
- [x] scan_state non-empty — M4/M6 tests
- [x] event-loop delay p99 < 50ms — perf-diag 07
- [x] steady-state DB + WAL < 200MB — synthetic DB 24.70MB
- [x] typecheck && test && lint all green — 246 tests
- [x] grep self-check against the ten AGENTS.md prohibitions — passed (the
  only db.prepare lives in stmt-cache)

## Pending decisions index

See DECISIONS-PENDING.md.

## calibrate-tokens-and-compare-report（2026-08-05，B1-B9 全部完成）

- [x] B1 token 归因纯函数 + 反双计回归护栏（不写回 event.tokens）
- [x] B2 SpeedMetrics/TokenUsage 新字段（avgLlmDurationMs/cacheHitRate/
      avgTokensPerCall/netInput + systemPrompt 估算）
- [x] B3 TraceMetrics 五新字段 + schema v4（SCHEMA_VERSION/METRICS_CALC_VERSION
      3→4，老库实测升级新列有值）
- [x] B4 Trae adapter 增强（toolName 二级映射 / startTime 继承 / 同时间戳时长
      分摊 / toolResult 状态兜底）
- [x] B5 对比报告 4→3 维（stability 并入 quality，质维度 8 项指标 + 代码精炼度
      口径 totalSteps/fileWriteCount）
- [x] B6 品牌改名 AwesomeTelemetry + teal + favicon（数据目录/localStorage 兼容
      回退）
- [x] B7 服务端端口占用预探测 + Trae systemPrompt 调查（无数据源，D-015）
- [x] B8 Trae 子代理关联（isSubagent 赋值 + llmIndex 错位修复；无真机数据，
      D-016）
- [x] B9 openspec validate --strict 通过；typecheck/test/lint 全绿（471 tests）；
      perf:check 追加到 PERF-BASELINE.md；真机 build+start 验证
      GET /api/sessions/:key 与 /api/compare 新字段真实值；对比页三维卡片
      渲染验证
