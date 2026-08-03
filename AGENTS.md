# AGENTS.md

> 这个文件会被 Codex / Claude Code / Cursor 等 agent 自动读取。
> **每次开始任何任务前，先完整读完本文件。**

## 项目一句话

Agent Observability：本地 Web UI，读取并分析 9 种 AI 编码助手的会话轨迹，按「快·准·稳·省」四维度衡量。
**0-1 全新构建**，不迁移任何历史数据。

## 权威文档优先级

冲突时，**上面的赢**：

1. `openspec/contracts/data-model.md` — 类型定义
2. `openspec/contracts/database.md` — SQL DDL / 索引 / PRAGMA
3. `openspec/contracts/api.md` — HTTP 契约
4. `openspec/contracts/nfr.md` — 性能预算（硬需求，等同功能需求）
5. `openspec/specs/<module>/spec.md` — 模块行为需求
6. `openspec/gotchas.md` — 踩坑清单
7. `openspec/project.md` — 总览

**任何时候都不要凭记忆写字段名、表名、路由。去文档里查。**

## 开工前的四步检查

1. 读 `BOOTSTRAP.md`，确认当前处在哪个里程碑（M0–M12）
2. 读本次任务对应模块的 `openspec/specs/<module>/spec.md` 全文
3. 读该 spec 底部 Gotchas 指向的 `openspec/gotchas.md` 条目
4. 确认你要产出的文件清单，**不碰清单外的任何文件**

## 十条禁令（违反即返工）

1. **禁止 `SELECT *`** —— 一律显式列出返回列，用 `contracts/database.md` §5.2 的列常量
2. **禁止在详情列表返回 `raw` / `inputSummary` / `outputSummary`** —— 这三列占 DB 的 96%
3. **禁止在循环内 `db.prepare()`** —— 用模块级缓存复用
4. **禁止 `spawnSync` / `execFileSync` / 大文件 `readFileSync` 出现在 HTTP 请求处理路径上**
5. **禁止逐 session 发射 SSE 事件** —— 必须 200ms 窗口合并成 `sessions_changed { keys }`
6. **禁止前端 `sessions.map(s => fetch(...))`** —— 需要聚合就加服务端聚合端点
7. **禁止全删全插式 `upsertEvents`** —— 必须差分 upsert
8. **禁止静默 catch `scan_state` 写入失败** —— 必须抛错
9. **禁止用正则 split 整个文件字符串解析 JSONL** —— 必须流式逐行
10. **禁止 `ORDER BY LENGTH(col)`** —— 用冗余长度列 + 索引

## 五条必做

1. **类型逐字采用契约。** 契约里没有的字段不要发明；契约里有的字段不要省略。
2. **每个模块的测试与源码同目录**（`foo.ts` + `foo.test.ts`），不放 `__tests__/`。
3. **`undefined` 写库前一律转 `null`。**
4. **所有对外时间戳是 ISO 8601 UTC 字符串。**
5. **所有非 2xx 响应用 `contracts/api.md` §0.3 的统一 `ApiError` 信封。**

## 遇到歧义怎么办

**停下来问，不要猜。** 具体地说：

- 契约里没定义的字段 → 停下来，列出你需要的字段和用途，等人回答
- 两份文档冲突 → 按上面的优先级取高的那份，并在输出里明确指出这处冲突
- 某个 gotcha 看不懂 → 照做，不要"优化"掉。那些都是真实调试出来的
- 测试跑不过 → 修实现，不要改测试的断言。断言是契约的可执行形式

**绝对不要**为了让测试通过而 mock 掉被测逻辑，或把断言改松。

## 技术栈约束

| 项 | 值 | 备注 |
|----|----|----- |
| Node | ≥ 20 | 硬性 |
| TypeScript | ~6.0 | `verbatimModuleSyntax` / `erasableSyntaxOnly` / strict |
| 前端 | React 19.2 + Vite 8 | 无路由库，`App.tsx` 是唯一 stateful shell |
| 后端 | 纯 Node `http` | **不用 Express / Fastify / Koa** |
| DB | better-sqlite3（WAL） | 同步 API，注意别阻塞事件循环 |
| 压缩 | `node:zlib` | 不引第三方 |
| 测试 | Vitest 3 | jsdom env、globals |

**runtime 依赖只有 4 个**：`better-sqlite3`、`chokidar`、`http-mitm-proxy`、`node-forge`。
前端可额外用 `@tanstack/react-virtual`（只进前端 bundle）。
**不要引入其他任何 runtime 依赖。** 需要新依赖时先问。

**devDependency 例外（已批准）**：`globals` —— ESLint 官方配套包，零传递依赖，flat config 需要 Node/浏览器全局声明。

## 已知偏差

- `@types/better-sqlite3@9.6.0` 与 runtime `better-sqlite3@12.x` 大版本错配：v12 不自带 `.d.ts`，DefinitelyTyped 最高只发布到 9.6.0（无 12.x）。M2 起 typecheck 若遇到 v12 新增 API 的类型缺口，按此条目排查。

## 目录约定

```
server/          后端。server.ts 是唯一 HTTP 入口
  http/          send-json（含 gzip）+ error-envelope + 路由匹配
  storage/       schema + writers + query-engine + detail-cache + overview
  realtime/      event-bus + coalescer + sse + frontline
  watch/         fingerprint + scan-gate + watcher + scan-scheduler
  proxy/         mitm + cdp + frida + ca-manager + parsers
  desensitization/
local-sessions/  9 个扫描器 + config + trae-bridge + vite-plugin(dev)
src/             前端 + adapters + core
  generated/     机器生成，勿手改
config/          *.example.json（真实配置 gitignored）
scripts/         generate-local-samples / pack-binary / trae-* / frida-*
perf-diag/       7 个性能诊断脚本
openspec/        规格（本项目的真相来源）
```

## 提交约定

- 一个里程碑一个提交，提交信息格式：`M<n>: <模块名> — <一句话>`
- 提交前必须：`npm run typecheck && npm run test && npm run lint` 全绿
- 从 M3 起，提交前跑 `npm run perf:check`，结果追加到 `PERF-BASELINE.md`

## 输出格式要求

完成任务时，用这个格式收尾：

```
## 已产出
- path/to/file.ts — 一句话说明
- path/to/file.test.ts — N 个用例

## 契约对照
- 实现了 <module> 的 REQ-001 / REQ-002 / ...
- 未实现：REQ-00X（原因）

## 需要确认
- （没有就写"无"）
```
