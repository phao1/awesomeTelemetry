## Why

前端在 T-01 后能打开了，但实机验证（2026-08-04，`6eb5f1a`，38 个真实会话）发现
**数据层是空的**：38 条会话里 34 条 `eventCount: 0` 且 title 是源文件名；
OpenCode / CodeArts 点开必返回 200 + `events: []` + `title: ""`；
`POST /api/proxy/start` 返回 404（`contracts/api.md` §4 早已定义，`server.ts` 从未注册）。

用户可见的表现统一是「点了没反应」。在数据层修好之前，任何 UI 改进都是在空壳上刷漆。

证据与精确定位见 `UI-TASKS.md` §1–§2（P1-1 / P1-2 / P1-3）。

## What Changes

- 索引阶段流式提取**真实会话标题与事件数**，跳过 `# AGENTS.md` / `<environment_context>` /
  `<system-reminder>` 等注入内容，不再用源文件名冒充标题。
- SQLite 类 provider（opencode / codearts / codeagent2）的**详情阶段按会话解析出事件**；
  解析失败返回 `SESSION_PARSE_FAILED` 错误码，**不再返回 200 + 空数组**。
- 注册 `POST /api/proxy/start|stop`、`POST /api/frida/start|stop` 四条路由，
  按 `contracts/api.md` §4/§5 的既有定义实现（含 409 冲突码）。

无 BREAKING：三项都是补齐既有契约未实现的部分，不改变已有响应结构。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无需 delta 文件——本 change 要实现的需求已于 2026-08-04 直接落入主 specs
（`specs/session-scanning/spec.md` REQ-021 / REQ-022，`contracts/api.md` §4/§5 为既有定义）。
故 `.openspec.yaml` 设 `skip_specs: true`，本 change 只承担**实现与执行追踪**。

> 说明：本仓库此前为 spec-only 模式（见 `openspec/README.md`），规格先行落地、
> 不走 delta。自本轮起启用 `changes/` 做执行追踪；**下一个新需求起**走完整
> proposal → spec delta → design → tasks → archive 流程。

## Impact

| 面 | 影响 |
|----|------|
| 代码 | `local-sessions/scanner-utils.ts`、`local-sessions/opencode.ts` 及其 dialect 复用方、`server/server.ts` 路由表、`server/proxy/` 接线 |
| API | `GET /api/sessions` 的 `title`/`eventCount` 由占位变真值；新增 4 条 POST 路由；新增错误码 `SESSION_PARSE_FAILED` |
| 数据 | 无 schema 变更。用户本地已脏的库由 T-02 的启动自愈清理覆盖 |
| 性能 | 索引阶段新增流式读取，预算：单 JSONL < 5ms、单 SQLite 库 < 50ms；`perf:check` 无劣化 > 20% |
| 依赖 | 无新增（AUTOPILOT 禁令 C） |
