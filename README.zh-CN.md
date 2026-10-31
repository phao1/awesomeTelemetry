# Agent Observability

「数据接入 → OpenTelemetry」可显式启用自研 Agent 的本地 OTLP/HTTP JSON 接收；「文件导入」支持 OTLP、Langfuse / LangSmith 导出，详见[接入自研 Agent](docs/custom-agent-opentelemetry.md)，采集默认关闭。

## Agent 边界评测：该合并谁、保留谁

「Agent 边界评测」默认进入逐 Agent 决策工作台。已接入 Anthropic
single-agent-loop-kit 的两个公开历史模型实验（132 条运行记录）、19 个任务定义及
标明来源的生成流量。逐边界审计 fold / merge / as-tool / keep，任一任务退步优先
阻止采纳，支持追到具体重复、失败检查、完整动作参数和调用序列。

支持原生任务候选、自有多轮任务与外部驱动计划、真实 skill-off 第三组、迁移材料和
独立人工决策。免费离线按钮只验证流程、不评分；真实 Messages API 与外部驱动必须
显式 CLI 执行，密钥只在环境中读取。监控、抓包和 Frida 继续默认关闭。
详见[逐边界评测与 API 接入](docs/agent-folding.md)。

## Agent 边界评测内的任务模式对比

顶部「Agent 边界评测」以同一个任务和独立验收为基线，支持每组不同提示词、配对并行或
顺序执行、逐用例差异、用量与时间对比，以及成员活动和消息的同步回放。四种离线
模拟与真实本地子进程流程验证均明确标注，不代表真实模型成绩。真实驱动经
`npm run team:experiment -- <plan.json> --execute --output <new-directory>` 显式启动。
监控和抓包继续默认关闭。设计依据、指标口径和接入方法见
[任务模式对比说明](docs/team-experiment.md)。

任务页「分析拆分与合并」及实验页「分析真实任务 telemetry」可检查上下文增长、
工具契约冲突和交接引用缺口，逐项定位真实事件 / 捕获 / Codex 逻辑调用，并给出
拆子 Agent、渐进披露、修复契约或合回主循环的适用条件与复测方法。覆盖不足会明确
说明，不用模拟成绩推断架构。详见[过程证据分析说明](docs/architecture-diagnosis.md)。

## 同任务自动评测（稳准快省）

顶部「评测中心」支持任务/模型配置、重复运行报告、完整指标对照、规则诊断和泳道
证据定位。先用 `npm run benchmark:demo` 验证本地执行与验收闭环，再接入真实 GUI
驱动；Qoder / CodeArts 真实自动操控需要按安装环境适配，合成示例不代表产品成绩。
详见 [任务评测与驱动接入](docs/benchmark.md)。

## npm / npx local Web UI (package preparation — unpublished)

The intended public package name is `awesome-telemetry`; registry ownership has
not been confirmed and this version has **not been published**. `private: true`
remains a publication guard. Do not assume `npx awesome-telemetry web` currently
resolves to this project. After a separately approved publication, that will be
the entry command; `agent-observe` remains a compatibility alias.

From source (Node >=20.19, npm):

```bash
npm install
npm run build
npm start -- web
npm start -- web --no-open
```

Startup uses existing `dist/` and `server-dist/`; it never runs a build. Missing
artifacts give build/reinstall guidance. The server defaults to
`http://127.0.0.1:4173/`, opens the default browser after listening, and keeps
serving if opening fails. `--no-open` disables opening. An inherited
`SSH_CONNECTION` or `SSH_TTY` also disables opening and prints the server URL;
use your SSH client's actual forwarded URL/port. No forwarded port is guessed.
`--port 0` selects a free port and prints the actual port. `--host` controls the
bind address; wildcard binds display a loopback browser URL on that host.
Existing local API Host/Origin restrictions still apply. Config/data remain in
the chosen `--config-root` (default current directory), outside installed code.

To verify an unpublished tarball:

```bash
npm run build
npm pack --pack-destination /tmp
npm run pack:smoke -- /tmp/awesome-telemetry-0.1.0.tgz --open-browser
# Or from a separate directory:
npm install /tmp/awesome-telemetry-0.1.0.tgz
npx --offline awesome-telemetry web --no-open
```

`npm pack` verifies existing artifacts without rebuilding. The tarball contains
built Web/server/worker JavaScript, required helper scripts, README and license;
it excludes node_modules, source maps, source/tests, local databases, captures,
certificates and development notes. Native `better-sqlite3` is installed for the
consumer's OS/architecture/Node ABI. A missing prebuilt binary requires a native
build toolchain (Windows: MSVC plus Python/node-gyp requirements; macOS: Xcode
Command Line Tools plus Python). Optional Trae SQLCipher/Frida integrations still
require their separately installed Python/tools. Copying macOS node_modules is
not Windows compatibility testing. Windows browser-command branches are tested
in simulation; actual platform validation must be reported separately.

This independently implemented flow was informed by the
[dsh Web runtime](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/src/index.ts)
and [clean packed-install verification](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/release/verify-packed-install.ts).
No dsh source code or package namespace is included.


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

## 默认关闭采集

Web 启动默认关闭自动监控与抓包，不扫描本机会话、团队源，也不注册文件监听/轮询；可继续查看历史数据与手动重扫。
显式传 `--enable-monitoring` 才开启启动扫描与自动监听，`--enable-proxy` 才启动抓包代理。
通过 `/api/health` 的 `monitoringEnabled` 和 `/api/proxy/status` 的 `running` / `starting` 可检查实际状态。

## 任务健康首页与概览

一级导航为：**概览 / 任务 / 评测中心 / Agent 边界评测 / 数据接入 / 设置**。
任务页默认显示健康列表，与侧栏共用分页、任务选择及 A/B 勾选状态。可按开始时间、
时长、错误记录数、修正 Token、指定币种费用排序，并按工具、时间、错误或告警筛选。
点击任务进入证据；“健康监测”直接打开该任务抽屉。最近标准报告显示已存结论、问题数与
生成日期，列表不会生成报告。未知数据不冒充零；部分 Token 与费用显示已知成员覆盖。

概览保留原指挥中心全部 widget 和计算口径，提供页内分组、可展开的 Agent 概览，以及
六个可点击跳转任务筛选的近 7 天指标。失败是记录状态；工具失败率使用有终态结果的工具
记录作为分母，不计未完成的输入记录，不据此推断真实执行生命周期。

设置中展开“模型价格与告警阈值”，录入模型名、USD/CNY 币种、每百万 Token 的
input/output/cacheRead/cacheWrite 价格、正整数上下文窗口，以及来源（URL 或文档名与抓取日期）。
继续采用内置 → 项目 `config/model-pricing.json` → 用户配置目录 `model-pricing.json`
三层覆盖。保存只更新所编辑模型的用户覆盖项。费用优先使用已报告金额，否则仅对可信用量
按有出处的价格估算并标注；不同币种分开显示，不换汇。

告警阈值默认**全部关闭**，留空表示关闭，仅在可信值严格超过阈值时本地标记。
上下文压力可设为 80（%），模型窗口未知不触发；任务总量覆盖不完整时不触发对应总量告警。
阈值保存在用户配置目录的 `alert-thresholds.json`。不会发送外部通知或 webhook。
保存价格、阈值后会刷新相关显示。

旧 `#/session?key=…` 链接进入对应任务并保留证据锚点；`#/proxy`、`#/frida`、`#/cdp`
进入数据接入对应通道；`#/agent`、`#/mission` 进入概览。旧 `#/compare` 可通过任务页
“旧版对比”进入。快捷键：**1 概览、2 任务、3 评测中心、4 Agent 边界评测、5 数据接入、6 设置**；
`/` 聚焦任务搜索，`⌘K` / `Ctrl K` 打开命令面板，`?` 打开帮助。

首页会为**当前可见页**中尚未解析的本地成员建立可取消的后台加载队列（全局最多并发 2），
复用原有 scanner；列表请求本身不解析文件，也不会启动监测、采集或 Agent。翻页、筛选、
进入详情、离开首页或切到后台标签页时停止排队；已经开始的解析可完成并留作缓存。
加载中的未知格显示“加载中”，文件缺失仍保留任务并在悬停说明。完成提示合并刷新摘要，
不会为每个成员发起前端请求。桌面列名仅显示在表头，窄屏卡片显示行内标签。

费用缺少模型价格时，“未设置价格”可直接打开模型价格分区并预填模型名；不预填价格或来源。
首页告警筛选旁和概览“告警任务”旁的“配置阈值”会直接展开、滚动并聚焦告警阈值分区。
