# Agent Observability

[English](README.md) | **简体中文**

本地 Web UI：读取并分析 9 种 AI 编码助手（Claude Code / Codex / OpenCode /
CodeArts / CodeAgent / CodeMate / Trae CN / Qoder / WorkBuddy）的会话轨迹，按
「快 · 准 · 稳 · 省」四维度衡量。数据来自本地文件扫描（scan）与可选的
MITM/CDP/Frida 实时捕获（proxy）。

## 快速开始

```bash
npm install        # 需要 Node ≥ 20；Windows 需 MSVC 工具链（better-sqlite3）
npm run build      # 三阶段构建：tsc -b → vite build → server-dist
npm start          # 生产启动：node bin/agent-observe.js
```

生产模式下 `npm start` 同时提供 API 与前端静态资源，浏览器访问
`http://127.0.0.1:4173/`（G3.1：不要用 localhost，企业代理可能拦截）。

开发模式（前后端分离，前端热更新）：

```bash
终端 1：npm start          # 后端 API 于 http://127.0.0.1:4173/
终端 2：npm run dev        # Vite 于 http://127.0.0.1:5173/，/api 代理到 4173
```

`npm run dev` 只起 Vite 前端（端口 5173），后端必须另开 `npm start`，否则
`/api/*` 请求会代理失败。

## CLI 参数

| Flag | 默认 | 说明 |
|------|------|------|
| `--host <host>` | `127.0.0.1` | 绑定地址 |
| `--port <port>` | `4173` | HTTP 端口 |
| `--no-open` | 开 | 不自动打开浏览器 |
| `--config-root <path>` | cwd | config 目录 |
| `--db-path <path>` | `<config-root>/agent-observe-data/observe.sqlite` | SQLite 路径 |
| `--proxy-port <port>` | `7779` | MITM 端口 |
| `--enable-proxy` | false | 启动即开 MITM（P-3：macOS 未端到端验证） |
| `--prewarm-recent <n>` | `0` | 预热最近 N 个会话；0 = 完全按需（>100 会 stderr 告警） |
| `--proxy-retention-days <n>` | `30` | proxy_requests 保留天数；0 = 不清理 |
| `--no-gzip` | 关 | 关闭响应压缩（仅调试用） |

启动时执行 5 步自检：建库/版本校验 → 关键索引校验补建 → WAL checkpoint →
proxy 保留清理 → 启动摘要（schemaVersion / 会话数 / DB+WAL 体积）。

## Trae CN SQLCipher 解密

Trae CN 用 SQLCipher 加密本地数据库。`scripts/trae-extract-key.py` 负责两段：

- **密钥提取**（Windows）：通过 `OpenProcess` + `VirtualQueryEx` +
  `ReadProcessMemory` 扫描运行中的 `Trae CN.exe` 进程内存，搜索
  `PRAGMA key = x'...'` 模式，`--save` 保存 64 字符 hex 密钥。
- **解密**（跨平台）：`--decrypt <db> --key <key-file> --out <plain.db>`
  复制 `db` + `-wal` + `-shm`，用 `sqlcipher3` 打开副本，执行
  `PRAGMA wal_checkpoint(FULL)` 后通过 `sqlcipher_export` 导出明文 SQLite。
  需要 `sqlcipher3` Python 包。

扫描器通过异步 `spawn` 桥（`local-sessions/trae-bridge.ts`）+ 30 秒指纹缓存
执行解密，绝不阻塞 HTTP 事件循环。密钥文件通过本地会话配置的 `traeKeyPath`
指定；密钥缺失时 provider 上报 `TRAE_KEY_MISSING`。Trae 默认路径：
Windows 为 `%APPDATA%\Trae CN\ModularData\ai-agent`，macOS 为
`~/Library/Application Support/Trae CN/ModularData/ai-agent`。

真实 SQLCipher 端到端测试可本地运行：

```bash
TRAE_TEST_PYTHON=/path/to/python-with-sqlcipher3 npm run test -- local-sessions/trae-bridge.test.ts
```

## 目录

```
server/          后端（http / storage / realtime / watch / proxy / desensitization）
local-sessions/  config + 9 个 scanner + trae-bridge
src/             React 前端 + core 分析 + adapters + generated（机器生成）
openspec/        规格与契约（真相来源）
perf-diag/       7 个性能诊断脚本
```

## 性能基线（perf-diag）

从 M3 起，每个里程碑合入后跑一次基线并把数字追加到 `PERF-BASELINE.md`：

```bash
npm run perf:check     # 顺序执行 perf-diag/ 的 7 个脚本（合成参考规模数据）
```

任何一列相对上一行劣化超过 20% 的提交不得合入，除非在提交说明中写清取舍。

## 构建与打包

```bash
npm run build          # 三阶段：tsc -b → vite build → server-dist（cli.js）
npm run pack:binary    # scripts/pack-binary.mjs → dist-binary/
```

`pack-binary` 复制 `server-dist/` + `dist/` + `bin/` + node_modules +
package.json，并生成平台启动器：Windows 用 `agent-observe.ps1`（UTF-8），
Unix 用 `agent-observe.sh`。

## 脚本

- `npm run gen:samples` — 生成 `src/generated/local-samples.ts`（fallback 样本；
  支持 `--claude-source=` / `--opencode-db=` 或同名 env）
- `scripts/trae-extract-key.py` — Trae SQLCipher 密钥提取（Windows）与解密
  （跨平台，sqlcipher3）
- `scripts/frida-*.js` — Frida monitor / 模块探测（Windows + Trae，P-3）

## 文档与验收

- 规格与契约：`openspec/`（类型/DDL/API/性能预算的权威来源）
- 里程碑进度：`PROGRESS.md`；待决决策：`DECISIONS-PENDING.md`
- 提交前必须：`npm run typecheck && npm run test && npm run lint` 全绿
