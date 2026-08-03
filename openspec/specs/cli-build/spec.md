# Spec: CLI & Build

> CLI 入口、构建打包、脚本。源文件：`server/cli.ts` + `bin/` + `scripts/` + vite configs

## Purpose

提供可执行的 CLI 启动 server + 打包为二进制分发。

## Requirements

### CLI

### REQ-001: CLI 参数
| Flag | 默认 | 说明 |
|------|------|------|
| `--host <host>` | `127.0.0.1` | 绑定地址（**不用 localhost**，G3.1） |
| `--port <port>` | `4173` | 端口 |
| `--no-open` | 默认开 | 不自动开浏览器 |
| `--config-root <path>` | `process.cwd()` | config 目录 |
| `--db-path <path>` | auto | SQLite 路径 |
| `--proxy-port <port>` | `7779` | MITM 端口 |
| `--enable-proxy` | false | 启动即开 MITM |
| `--prewarm-recent <n>` | **`0`** | 预热最近 N 个会话；0 = 完全按需 |
| `--proxy-retention-days <n>` | `30` | proxy_requests 保留天数；0 = 不清理 |
| `--no-gzip` | 默认开 | 关闭响应压缩（仅调试用） |

#### Scenario: prewarm 的默认值与警告
- **GIVEN** 用户传入 `--prewarm-recent` 且值 > 100
- **THEN** MUST 在 stderr 输出警告，说明这会显著拖慢启动后前几分钟的响应
- **AND** 默认值 MUST 为 0

### REQ-002: CLI 入口
`bin/agent-observe.js`（`#!/usr/bin/env node`）→ import `runCli` from `server-dist/cli.js` → `createAgentObservabilityServer()` → listen → 可选开浏览器（open / `cmd /c start` / xdg-open）。

#### Scenario: listen 不被预热阻塞
- **GIVEN** `--prewarm-recent 50`
- **WHEN** 服务启动
- **THEN** `server.listen()` 的回调 MUST 在索引阶段完成后立即触发
- **AND** 预热在其后以 `void backgroundPrewarm(...)` 方式进行，MUST NOT 被 await

### REQ-003: server 工厂
`createAgentObservabilityServer(opts)` SHALL 返回纯 Node HTTP server（不用 Express/Fastify），挂载 `contracts/api.md` 定义的全部路由。

请求处理链固定为：`markForegroundRequest()` → 路由匹配 → handler → `sendJson()`（含 gzip 判定）→ 异常统一转 `ApiError` 信封。

### REQ-004: 启动自检
启动时 SHALL 依次执行并在失败时给出可操作提示：
1. `initSchema(db)`（幂等建表建索引）；若读到的 `schema_version` 高于代码常量则中止
2. 校验关键索引存在（见 `contracts/database.md` §4），缺失则补建
3. 执行一次 `checkpointWal()`
4. 按 `--proxy-retention-days` 清理过期 proxy 记录
5. 输出启动摘要：`schemaVersion` / 会话数 / DB 与 WAL 体积 / 各 provider 状态

### Build

### REQ-005: 三阶段构建
`npm run build` = `tsc -b && vite build && vite build --config vite.cli.config.ts`

1. **类型检查** `tsc -b`（tsconfig 引用 app + node 两个子配置）
2. **前端 SPA** `vite build` → `dist/`
3. **服务端 bundle** `vite build --config vite.cli.config.ts` → `server-dist/cli.js`（`ssr: 'server/cli.ts'`）

外部依赖不打包：`better-sqlite3`、`chokidar`、`http-mitm-proxy`、`node-forge`。顺序不可颠倒。

### REQ-006: 测试配置
`vitest.config.ts`：jsdom env、globals enabled、setup `./src/test/setup.ts`。测试 colocated（`*.test.ts`），不放 `__tests__/`。

CI MUST 执行 `contracts/nfr.md` §5 的全部性能断言。

### Scripts

### REQ-007: generate-local-samples
`scripts/generate-local-samples.mjs` SHALL 读 Claude JSONL + OpenCode SQLite，sanitize 路径，生成 `src/generated/local-samples.ts`。支持 `--claude-source=` / `--opencode-db=` 参数或 env。

### REQ-008: pack-binary
`scripts/pack-binary.mjs` SHALL 复制 `server-dist/` + `dist/` + `bin/` + 原生 node_modules + package.json 到 `dist-binary/`，生成平台启动器。

Windows 启动器 MUST 用 `.ps1`（UTF-8 编码），MUST NOT 用 `.bat`（中文路径下乱码）。

### REQ-009: trae-extract-key
`scripts/trae-extract-key.py` SHALL 提取 Trae SQLCipher key（需 `sqlcipher3`），`--save` 存到配置目录。

### REQ-010: perf-diag 脚本保留
`perf-diag/` 目录下的 7 个诊断脚本 MUST 随仓库保留，作为回归基线工具。README 中 SHALL 说明如何重跑并更新 `PERF-DIAGNOSIS.md` 的历史基线表。

## Gotchas
- G1.1：better-sqlite3 Windows 需 MSVC 工具链
- G1.2：构建三阶段顺序不能错，server-dist 外部依赖不打包
- G1.3：Node ≥ 20 硬性要求
- G3.1：CLI 默认 host `127.0.0.1`
- G2.1：Windows 中文路径启动脚本用 `.ps1`
- `src/generated/` 勿手改
- G11.17（新）：`--prewarm-recent` 的默认值是 0 而非某个"合理值"。任何非 0 默认值都会重现 v4 的 200–1240 倍劣化
